'use strict';

const catalog = require('../data/dota.zh-CN.json');
const meta = require('../data/meta-builds.json');
const { RosterState } = require('./roster-state');
const { analyzeThreats } = require('./threat-analyzer');

const PHASES = [
  { key: 'starting', label: '出门', until: 0 },
  { key: 'early', label: '前期', until: 10 * 60 },
  { key: 'mid', label: '中期', until: 30 * 60 },
  { key: 'late', label: '后期', until: Number.POSITIVE_INFINITY }
];

const ROLE_LABELS = { 1: '一号位', 2: '二号位', 3: '三号位', 4: '四号位', 5: '五号位' };

function phaseForClock(clock) {
  const seconds = Number.isFinite(Number(clock)) ? Number(clock) : -1;
  return PHASES.find((phase) => seconds < phase.until) ?? PHASES.at(-1);
}

function roundPercentage(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

class AdviceService {
  constructor() {
    this.heroByName = new Map(catalog.heroes.map((hero) => [hero.name, hero]));
    this.heroById = new Map(catalog.heroes.map((hero) => [Number(hero.id), hero]));
    this.itemByName = new Map(catalog.items.map((item) => [item.name, item]));
    this.itemById = new Map(catalog.items.map((item) => [Number(item.id), item]));
    this.abilityByName = new Map(
      catalog.heroes.flatMap((hero) => hero.abilities.map((ability) => [ability.name, ability]))
    );
    this.abilityById = new Map(
      catalog.heroes.flatMap((hero) => hero.abilities.map((ability) => [Number(ability.id), ability]))
    );
    this.rosterState = new RosterState(this.heroById.keys());
    this.selectedRole = null;
  }

  getCatalog() {
    return {
      heroes: catalog.heroes
        .map((hero) => ({ id: hero.id, name: hero.name, nameZh: hero.nameZh }))
        .sort((left, right) => left.nameZh.localeCompare(right.nameZh, 'zh-CN')),
      roles: Object.entries(ROLE_LABELS).map(([id, label]) => ({ id: Number(id), label })),
      meta: { generatedAt: meta.generatedAt, patch: meta.patch }
    };
  }

  setRole(role) {
    if (role === null || role === '' || role === 'auto') {
      this.selectedRole = null;
      return;
    }
    const normalized = Number(role);
    if (!Number.isInteger(normalized) || !ROLE_LABELS[normalized]) throw new Error('分路无效');
    this.selectedRole = normalized;
  }

  setRosterSlot(side, index, heroId) {
    this.rosterState.setSlot(side, Number(index), heroId);
  }

  clearRoster() {
    this.rosterState.reset();
  }

  localizeItemName(name) {
    return this.itemByName.get(name)?.nameZh || this.fallbackName(name, 'item_');
  }

  localizeAbilityName(name) {
    return this.abilityByName.get(name)?.nameZh || this.fallbackName(name);
  }

  fallbackName(name, prefix = '') {
    const value = String(name ?? '').replace(prefix, '');
    return value ? value.split('_').filter(Boolean).join(' ') : '未知';
  }

  resolveRole(heroId) {
    const roles = meta.heroes?.[heroId]?.roles ?? {};
    const availableRoles = Object.entries(roles)
      .map(([role, build]) => ({ role: Number(role), matches: Number(build.roleMatches ?? build.matches) }))
      .sort((left, right) => right.matches - left.matches);
    const requested = this.selectedRole;
    const selected = requested && roles[requested] ? requested : availableRoles[0]?.role ?? null;
    return {
      selected,
      requested,
      fallback: Boolean(requested && selected !== requested),
      label: selected ? ROLE_LABELS[selected] : '自动',
      available: availableRoles.map((entry) => ({ ...entry, label: ROLE_LABELS[entry.role] }))
    };
  }

  localizeRoster(roster) {
    const localizeSlots = (slots) => slots.map((slot) => {
      if (!slot) return null;
      const hero = this.heroById.get(slot.heroId);
      return hero ? { ...slot, name: hero.name, nameZh: hero.nameZh } : null;
    });
    return { ...roster, allies: localizeSlots(roster.allies), enemies: localizeSlots(roster.enemies) };
  }

  matchupAdvice(heroId, enemyHeroes) {
    const rows = new Map((meta.matchups?.[heroId] ?? []).map((row) => [Number(row.heroId), row]));
    return enemyHeroes
      .map((enemy) => {
        const row = rows.get(enemy.id);
        if (!row || row.matches < 20) return null;
        const adjustedWinRate = (Number(row.wins) + 25) / (Number(row.matches) + 50);
        return {
          heroId: enemy.id,
          heroName: enemy.nameZh,
          matches: row.matches,
          winRate: adjustedWinRate,
          level: adjustedWinRate < 0.47 ? '困难' : adjustedWinRate > 0.53 ? '有利' : '接近'
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.winRate - right.winRate);
  }

  buildItemAdvice(snapshot, roster, roleInfo) {
    const phase = phaseForClock(snapshot.map.clock_time ?? snapshot.map.game_time);
    const build = meta.heroes?.[snapshot.hero.id]?.roles?.[roleInfo.selected];
    if (!build) {
      return {
        available: false,
        phase: phase.key,
        phaseLabel: phase.label,
        recommended: [],
        counters: [],
        alternatives: [],
        role: roleInfo
      };
    }

    const ownedNames = new Set(snapshot.items.map((item) => item.name));
    const ownedIds = new Set(
      snapshot.items.map((item) => this.itemByName.get(item.name)?.id).filter(Number.isFinite)
    );
    const minute = Number(snapshot.map.clock_time ?? snapshot.map.game_time ?? 0) / 60;
    const unowned = build.items.filter((item) => !ownedIds.has(item.id) && this.itemById.has(item.id));
    const timely = unowned.filter((item) => Number(item.averageMinute) >= minute - 6);
    const baseCandidates = (timely.length ? timely : unowned).slice(0, 3);
    const enemyHeroes = roster.enemies.filter(Boolean)
      .map((slot) => this.heroById.get(slot.heroId))
      .filter(Boolean);
    const applicableNames = new Set([...build.items, ...(build.situational ?? [])]
      .map((item) => this.itemById.get(item.id)?.name)
      .filter(Boolean));
    const counterAnalysis = analyzeThreats(
      enemyHeroes,
      roleInfo.selected,
      this.itemByName,
      ownedNames,
      applicableNames
    );
    const counterByName = new Map(counterAnalysis.recommendations.map((item) => [item.name, item]));
    const recommendedNames = new Set();
    const recommended = baseCandidates.map((entry) => {
      const item = this.itemById.get(entry.id);
      recommendedNames.add(item.name);
      const counter = counterByName.get(item.name);
      if (counter) counterByName.delete(item.name);
      return {
        name: item.name,
        displayName: item.nameZh,
        averageMinute: entry.averageMinute,
        pickRate: entry.pickRate,
        reason: counter?.reason ?? null,
        contextual: Boolean(counter)
      };
    });
    const counters = [...counterByName.values()]
      .filter((item) => !recommendedNames.has(item.name))
      .slice(0, 2);
    const counterNames = new Set(counters.map((item) => item.name));
    const alternatives = (build.situational ?? [])
      .filter((entry) => !ownedIds.has(entry.id))
      .map((entry) => ({ entry, item: this.itemById.get(entry.id) }))
      .filter(({ item }) => item && !recommendedNames.has(item.name) && !counterNames.has(item.name))
      .slice(0, 3)
      .map(({ entry, item }) => ({
        name: item.name,
        displayName: item.nameZh,
        averageMinute: entry.averageMinute,
        pickRate: entry.pickRate
      }));

    return {
      available: recommended.length > 0,
      phase: phase.key,
      phaseLabel: phase.label,
      recommended,
      counters,
      alternatives,
      threats: counterAnalysis.threats.map((threat) => threat.label),
      matchups: this.matchupAdvice(snapshot.hero.id, enemyHeroes),
      role: roleInfo,
      sampleMatches: build.matches,
      source: `D2PT ${meta.patch} · ${ROLE_LABELS[roleInfo.selected]} · ${build.matches.toLocaleString('zh-CN')} 场高分局`,
      sourceDate: String(meta.generatedAt).slice(0, 10)
    };
  }

  buildSkillAdvice(snapshot, localizedAbilities, roleInfo) {
    const build = meta.heroes?.[snapshot.hero.id]?.roles?.[roleInfo.selected];
    const route = build?.abilityOrder ?? [];
    if (!build || !route.length) {
      return {
        available: false,
        title: '暂无可靠加点数据',
        reason: '当前英雄或分路没有足够的近期高分局样本。',
        abilities: localizedAbilities,
        role: roleInfo
      };
    }

    const actualLevels = new Map(localizedAbilities.map((ability) => [ability.name, Number(ability.level) || 0]));
    const expected = new Map();
    let recommendation = null;
    let targetLevel = null;
    let overdue = false;

    for (let index = 0; index < route.length; index += 1) {
      const metadata = this.abilityById.get(Number(route[index]));
      if (!metadata) continue;
      const count = (expected.get(metadata.name) ?? 0) + 1;
      expected.set(metadata.name, count);
      const level = index + 1;
      if (!recommendation && level <= Number(snapshot.hero.level) && (actualLevels.get(metadata.name) ?? 0) < count) {
        recommendation = metadata;
        targetLevel = level;
        overdue = true;
      }
      if (!recommendation && level > Number(snapshot.hero.level)) {
        recommendation = metadata;
        targetLevel = level;
        break;
      }
    }

    if (!recommendation && Number(snapshot.hero.level) >= 10) {
      const ultimate = localizedAbilities
        .filter((ability) => ability.ultimate && !ability.innate)
        .map((ability) => this.abilityByName.get(ability.name))
        .find(Boolean);
      const allowedUltimateLevel = Math.min(3, Math.floor(Number(snapshot.hero.level) / 6));
      if (ultimate && (actualLevels.get(ultimate.name) ?? 0) < allowedUltimateLevel) {
        recommendation = ultimate;
        targetLevel = Number(snapshot.hero.level);
      } else {
        const priority = [...expected.entries()]
          .sort((left, right) => right[1] - left[1])
          .map(([name]) => this.abilityByName.get(name))
          .filter(Boolean);
        recommendation = priority.find((ability) => (
          !ability.ultimate && !ability.innate && (actualLevels.get(ability.name) ?? 0) < Number(ability.maxLevel)
        )) ?? null;
        targetLevel = recommendation ? Number(snapshot.hero.level) + 1 : null;
      }
    }

    return {
      available: Boolean(recommendation),
      title: recommendation?.nameZh ?? '技能路线已完成',
      ability: recommendation?.name ?? null,
      targetLevel,
      reason: recommendation
        ? `${overdue ? '当前优先补上' : '下一点建议'}：近期高分局最常见的前 10 级路线${build.abilityOrderMatches ? `（${build.abilityOrderMatches} 场）` : ''}`
        : '普通技能已满，请结合局势选择天赋或属性加成。',
      profile: `${ROLE_LABELS[roleInfo.selected]} · ${roundPercentage(build.abilityOrderPickRate)} 采用`,
      abilities: localizedAbilities,
      source: `D2PT ${meta.patch} · 数据快照 ${String(meta.generatedAt).slice(0, 10)}`,
      role: roleInfo
    };
  }

  decorate(viewModel) {
    if (!viewModel?.snapshot) return { ...viewModel, advice: null, roster: null };
    const snapshot = viewModel.snapshot;
    const heroMetadata = this.heroByName.get(snapshot.hero.name) ?? this.heroById.get(Number(snapshot.hero.id));
    const localizedAbilities = snapshot.abilities.map((ability) => {
      const metadata = this.abilityByName.get(ability.name);
      return {
        ...ability,
        displayName: metadata?.nameZh ?? this.localizeAbilityName(ability.name),
        maxLevel: metadata?.maxLevel ?? null,
        ultimate: metadata?.ultimate ?? Boolean(ability.ultimate),
        innate: metadata?.innate ?? false
      };
    });
    const localizedSnapshot = {
      ...snapshot,
      hero: {
        ...snapshot.hero,
        displayName: heroMetadata?.nameZh ?? this.fallbackName(snapshot.hero.name, 'npc_dota_hero_')
      },
      items: snapshot.items.map((item) => ({ ...item, displayName: this.localizeItemName(item.name) })),
      abilities: localizedAbilities
    };
    const roster = this.localizeRoster(this.rosterState.get(snapshot));
    const role = this.resolveRole(Number(snapshot.hero.id));

    return {
      ...viewModel,
      snapshot: localizedSnapshot,
      roster,
      advice: {
        items: this.buildItemAdvice(snapshot, roster, role),
        skill: this.buildSkillAdvice(snapshot, localizedAbilities, role),
        catalogGeneratedAt: catalog.generatedAt,
        metaGeneratedAt: meta.generatedAt,
        patch: meta.patch
      }
    };
  }
}

module.exports = { AdviceService, phaseForClock, ROLE_LABELS };

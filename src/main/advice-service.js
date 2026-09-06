'use strict';

const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../data/dota.zh-CN.json');
const skillBuilds = require('../data/skill-builds.zh-CN.json');
const { parseKeyValues } = require('./keyvalues');

const PHASES = [
  { key: 'starting', label: '出门', until: 0, buildKey: '#DOTA_Item_Build_Starting_Items' },
  { key: 'early', label: '前期', until: 10 * 60, buildKey: '#DOTA_Item_Build_Early_Game' },
  { key: 'mid', label: '中期', until: 30 * 60, buildKey: '#DOTA_Item_Build_Mid_Items' },
  { key: 'late', label: '后期', until: Number.POSITIVE_INFINITY, buildKey: '#DOTA_Item_Build_Late_Items' }
];

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function itemsInSection(section) {
  return asArray(section?.item);
}

function phaseForClock(clock) {
  const seconds = Number.isFinite(Number(clock)) ? Number(clock) : -1;
  return PHASES.find((phase) => seconds < phase.until) ?? PHASES.at(-1);
}

class AdviceService {
  constructor({ getDotaRoot }) {
    this.getDotaRoot = getDotaRoot;
    this.heroByName = new Map(catalog.heroes.map((hero) => [hero.name, hero]));
    this.heroById = new Map(catalog.heroes.map((hero) => [hero.id, hero]));
    this.itemByName = new Map(catalog.items.map((item) => [item.name, item]));
    this.abilityByName = new Map(
      catalog.heroes.flatMap((hero) => hero.abilities.map((ability) => [ability.name, ability]))
    );
    this.itemBuildCache = new Map();
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

  loadItemBuild(heroName) {
    const dotaRoot = this.getDotaRoot?.();
    const cacheKey = `${dotaRoot ?? ''}:${heroName ?? ''}`;
    if (this.itemBuildCache.has(cacheKey)) return this.itemBuildCache.get(cacheKey);

    let result = null;
    if (dotaRoot && heroName) {
      const suffix = heroName.replace(/^npc_dota_hero_/, '');
      const filePath = path.join(dotaRoot, 'game', 'dota', 'itembuilds', `default_${suffix}.txt`);
      try {
        const parsed = parseKeyValues(fs.readFileSync(filePath, 'utf8'));
        result = parsed.itembuilds?.Items ?? null;
      } catch {
        result = null;
      }
    }
    this.itemBuildCache.set(cacheKey, result);
    return result;
  }

  buildItemAdvice(snapshot) {
    const phase = phaseForClock(snapshot.map.clock_time ?? snapshot.map.game_time);
    const build = this.loadItemBuild(snapshot.hero.name);
    if (!build) {
      return { available: false, phase: phase.key, phaseLabel: phase.label, recommended: [], alternatives: [] };
    }

    const owned = new Set(snapshot.items.map((item) => item.name));
    const currentItems = unique(itemsInSection(build[phase.buildKey])).filter((name) => !owned.has(name));
    const laterPhases = PHASES.slice(PHASES.indexOf(phase) + 1)
      .flatMap((entry) => itemsInSection(build[entry.buildKey]));
    const otherItems = itemsInSection(build['#DOTA_Item_Build_Other_Items']);
    const candidates = unique([...currentItems, ...laterPhases]).filter((name) => !owned.has(name));
    const alternatives = unique(otherItems).filter((name) => !owned.has(name) && !candidates.includes(name));
    const toDisplay = (name) => ({ name, displayName: this.localizeItemName(name) });

    return {
      available: candidates.length > 0,
      phase: phase.key,
      phaseLabel: phase.label,
      recommended: candidates.slice(0, 3).map(toDisplay),
      alternatives: alternatives.slice(0, 3).map(toDisplay),
      source: '游戏内默认推荐出装'
    };
  }

  buildSkillAdvice(snapshot, localizedAbilities) {
    const profile = skillBuilds.profiles[snapshot.hero.name];
    if (!profile) {
      return {
        available: false,
        title: '暂无已验证加点',
        reason: '先显示当前技能等级，不对陌生英雄乱猜。',
        abilities: localizedAbilities,
        source: '本地技能路线'
      };
    }

    const actualLevels = new Map(localizedAbilities.map((ability) => [ability.name, Number(ability.level) || 0]));
    const expected = new Map();
    let recommendation = null;
    let overdue = false;

    for (const step of profile.steps) {
      const count = (expected.get(step.ability) ?? 0) + 1;
      expected.set(step.ability, count);
      if (!recommendation && step.level <= Number(snapshot.hero.level) && (actualLevels.get(step.ability) ?? 0) < count) {
        recommendation = step;
        overdue = true;
      }
    }

    if (!recommendation) {
      recommendation = profile.steps.find((step) => step.level > Number(snapshot.hero.level)) ?? null;
    }

    const metadata = recommendation ? this.abilityByName.get(recommendation.ability) : null;
    return {
      available: Boolean(recommendation && metadata),
      title: metadata?.nameZh ?? '本路线已完成',
      ability: recommendation?.ability ?? null,
      targetLevel: recommendation?.level ?? null,
      reason: recommendation
        ? `${overdue ? '当前优先补上' : `${recommendation.level} 级建议`}：${recommendation.reason}`
        : '核心技能路线已经完成，请按局势选择天赋和属性。',
      profile: profile.label,
      abilities: localizedAbilities,
      source: `本地人工路线 · ${skillBuilds.generatedAt}`
    };
  }

  decorate(viewModel) {
    if (!viewModel?.snapshot) return { ...viewModel, advice: null };
    const snapshot = viewModel.snapshot;
    const heroMetadata = this.heroByName.get(snapshot.hero.name) ?? this.heroById.get(snapshot.hero.id);
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

    return {
      ...viewModel,
      snapshot: localizedSnapshot,
      advice: {
        items: this.buildItemAdvice(snapshot),
        skill: this.buildSkillAdvice(snapshot, localizedAbilities),
        catalogGeneratedAt: catalog.generatedAt
      }
    };
  }
}

module.exports = { AdviceService, phaseForClock };

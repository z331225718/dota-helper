'use strict';

const THREAT_HEROES = {
  healing: ['abaddon', 'chen', 'dazzle', 'enchantress', 'huskar', 'wisp', 'marci', 'necrolyte', 'omniknight', 'oracle', 'phoenix', 'pugna', 'undying', 'warlock', 'winter_wyvern', 'witch_doctor'],
  evasion: ['brewmaster', 'phantom_assassin', 'windrunner'],
  illusions: ['arc_warden', 'chaos_knight', 'dark_seer', 'naga_siren', 'phantom_lancer', 'shadow_demon', 'terrorblade'],
  invisibility: ['bounty_hunter', 'clinkz', 'invoker', 'mirana', 'nyx_assassin', 'riki', 'sand_king', 'templar_assassin', 'treant', 'weaver'],
  passives: ['abaddon', 'bristleback', 'centaur', 'dragon_knight', 'huskar', 'necrolyte', 'phantom_assassin', 'spectre', 'tidehunter', 'shredder', 'viper'],
  magicBurst: ['invoker', 'leshrac', 'lina', 'lion', 'puck', 'pugna', 'queenofpain', 'skywrath_mage', 'storm_spirit', 'tinker', 'zuus'],
  silence: ['death_prophet', 'drow_ranger', 'earth_spirit', 'grimstroke', 'night_stalker', 'puck', 'silencer', 'skywrath_mage'],
  singleTarget: ['bane', 'beastmaster', 'doom_bringer', 'legion_commander', 'lion', 'necrolyte', 'pudge', 'shadow_shaman', 'spirit_breaker', 'winter_wyvern'],
  physicalBurst: ['clinkz', 'drow_ranger', 'juggernaut', 'legion_commander', 'nevermore', 'phantom_assassin', 'slardar', 'sven', 'templar_assassin', 'troll_warlord', 'ursa'],
  summons: ['beastmaster', 'broodmother', 'chen', 'enchantress', 'enigma', 'furion', 'lycan', 'visage']
};

const THREAT_LABELS = {
  healing: '高治疗/恢复', evasion: '闪避', illusions: '幻象', invisibility: '隐身',
  passives: '关键被动', magicBurst: '高魔法爆发', silence: '沉默', singleTarget: '强单体控制',
  physicalBurst: '物理爆发', summons: '召唤物'
};

const THREAT_DETAILS = {
  healing: '治疗和恢复会把短战拖成长战',
  evasion: '物理输出可能因闪避大幅折损',
  illusions: '单体技能容易浪费在幻象上',
  invisibility: '没有真视时容易丢失先手和追击',
  passives: '关键被动会改变集火收益',
  magicBurst: '短时间魔法伤害足以压低进场血线',
  silence: '沉默会切断逃生或反打技能',
  singleTarget: '单体控制容易抓死落单英雄',
  physicalBurst: '物理爆发会快速击穿低甲目标',
  summons: '多单位推进会挤压兵线和视野'
};

const RESPONSE_RULES = [
  { threats: ['invisibility'], title: '真视先行', text: '开团和追击前确保显影之尘或岗哨覆盖，不要把关键技能交给消失的目标。' },
  { threats: ['healing'], title: '压治疗窗口', text: '确认治疗和保命技能已交再持续追击；无法快速击杀时先拉开，不和对方换恢复。' },
  { threats: ['illusions', 'summons'], title: '先辨真身', text: '保留范围技能清场和识别真身，避免把单体爆发交给幻象或召唤物。' },
  { threats: ['silence', 'singleTarget'], title: '留解控再进场', text: '等第一轮沉默或单体控制交出后再进，位移和保命技能不要同时提前使用。' },
  { threats: ['magicBurst'], title: '错开魔法爆发', text: '不要多人站成一团吃第一轮技能；魔抗或免控窗口开启后再打持续输出。' },
  { threats: ['physicalBurst'], title: '拉开物理核心', text: '用地形和控制限制其贴身时间，低甲队友不要承担第一波视野。' },
  { threats: ['evasion'], title: '保证有效命中', text: '物理核心需要可靠命中；成装前优先用技能伤害和控制处理闪避目标。' },
  { threats: ['passives'], title: '确认被动机制', text: '集火前确认关键被动是否可被破坏，避免在减伤或自动保命窗口里硬换。' }
];

const ROLE_POSITIONING = {
  1: '你是主要持续输出，不要第一个露头；等敌方关键控制交出再进入射程。',
  2: '从侧面寻找后排，但先确认沉默和单体控制的位置，避免切入后没有退路。',
  3: '先逼出关键技能并隔开敌方前后排，为己方核心创造安全输出窗口。',
  4: '优先布置视野和打断敌方先手，保留一个控制处理切入己方后排的英雄。',
  5: '站在核心技能范围之外提供救援和真视，不要与己方核心同时被第一轮控制命中。'
};

const COUNTER_RULES = [
  { threat: 'invisibility', itemByRole: { all: ['item_dust'] }, priority: 100, why: '对面有隐身能力，随身真视比憋大件更重要' },
  { threat: 'healing', itemByRole: { 1: ['item_skadi'], 2: ['item_skadi'], 3: ['item_shivas_guard', 'item_spirit_vessel'], 4: ['item_spirit_vessel'], 5: ['item_spirit_vessel'] }, priority: 95, why: '压制治疗和高额生命恢复' },
  { threat: 'evasion', itemByRole: { 1: ['item_monkey_king_bar', 'item_bloodthorn'], 2: ['item_monkey_king_bar', 'item_bloodthorn'] }, priority: 90, why: '需要可靠命中处理闪避' },
  { threat: 'passives', itemByRole: { 1: ['item_silver_edge'], 2: ['item_silver_edge'], 3: ['item_silver_edge'] }, priority: 85, why: '破坏对面的关键被动效果' },
  { threat: 'illusions', itemByRole: { 1: ['item_mjollnir'], 2: ['item_mjollnir'], 3: ['item_crimson_guard'], 4: ['item_crimson_guard'], 5: ['item_crimson_guard'] }, priority: 80, why: '提升清幻象能力或降低多单位伤害' },
  { threat: 'summons', itemByRole: { 1: ['item_mjollnir'], 2: ['item_mjollnir'], 3: ['item_crimson_guard'], 4: ['item_crimson_guard'], 5: ['item_crimson_guard'] }, priority: 78, why: '处理大量召唤物和多单位推进' },
  { threat: 'silence', itemByRole: { 1: ['item_manta', 'item_black_king_bar'], 2: ['item_black_king_bar', 'item_manta'], 3: ['item_lotus_orb'], 4: ['item_lotus_orb'], 5: ['item_lotus_orb'] }, priority: 75, why: '解除或规避关键沉默' },
  { threat: 'singleTarget', itemByRole: { 1: ['item_sphere'], 2: ['item_sphere'], 3: ['item_lotus_orb'], 4: ['item_lotus_orb'], 5: ['item_lotus_orb'] }, priority: 72, why: '防住强单体先手和指向性控制' },
  { threat: 'magicBurst', itemByRole: { 1: ['item_black_king_bar'], 2: ['item_black_king_bar'], 3: ['item_pipe'], 4: ['item_glimmer_cape'], 5: ['item_glimmer_cape'] }, priority: 65, why: '降低对面高额魔法爆发的威胁' },
  { threat: 'physicalBurst', itemByRole: { 3: ['item_heavens_halberd'], 4: ['item_ghost'], 5: ['item_ghost'] }, priority: 60, why: '限制或规避对面物理爆发' }
];

function suffix(heroName) {
  return String(heroName ?? '').replace(/^npc_dota_hero_/, '');
}

function analyzeThreats(enemyHeroes, role, itemByName, ownedNames = new Set(), applicableNames = new Set()) {
  const threats = [];
  for (const [key, heroNames] of Object.entries(THREAT_HEROES)) {
    const matches = enemyHeroes.filter((hero) => heroNames.includes(suffix(hero.name)));
    if (matches.length) threats.push({ key, label: THREAT_LABELS[key], heroes: matches });
  }

  const recommendations = [];
  const usedItems = new Set();
  for (const rule of COUNTER_RULES.slice().sort((left, right) => right.priority - left.priority)) {
    const threat = threats.find((entry) => entry.key === rule.threat);
    if (!threat) continue;
    const candidates = rule.itemByRole[role] ?? rule.itemByRole.all ?? [];
    const itemName = candidates.find((name) => name === 'item_dust' || applicableNames.has(name));
    const item = itemByName.get(itemName);
    if (!item || ownedNames.has(itemName) || usedItems.has(itemName)) continue;
    usedItems.add(itemName);
    recommendations.push({
      ...item,
      displayName: item.nameZh,
      threat: threat.label,
      reason: `${rule.why}：${threat.heroes.map((hero) => hero.nameZh).join('、')}`
    });
    if (recommendations.length === 2) break;
  }

  return { threats, recommendations };
}

function buildLineupAnalysis(enemyHeroes, threats, matchups, role) {
  const enemyCount = enemyHeroes.length;
  const coverageNote = enemyCount === 5
    ? '敌方阵容已确认 5/5'
    : enemyCount > 0
      ? `敌方阵容已确认 ${enemyCount}/5，结论仅按已知英雄生成`
      : '敌方阵容尚未确认 0/5';
  if (!enemyCount) {
    return {
      available: false,
      enemyCount: 0,
      coverageNote,
      summary: '还没有可分析的敌方英雄。请在上方阵容栏补全，确认后会立即生成针对策略。',
      threats: [],
      priorities: [],
      enemyBreakdown: []
    };
  }

  const threatByHeroId = new Map(enemyHeroes.map((hero) => [hero.id, []]));
  for (const threat of threats) {
    for (const hero of threat.heroes) threatByHeroId.get(hero.id)?.push(threat);
  }
  const matchupByHeroId = new Map(matchups.map((matchup) => [matchup.heroId, matchup]));
  const rankedThreats = threats
    .map((threat) => ({
      key: threat.key,
      label: threat.label,
      detail: THREAT_DETAILS[threat.key],
      heroNames: threat.heroes.map((hero) => hero.nameZh),
      count: threat.heroes.length
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN'));
  const enemyBreakdown = enemyHeroes.map((hero) => {
    const heroThreats = threatByHeroId.get(hero.id) ?? [];
    const matchup = matchupByHeroId.get(hero.id) ?? null;
    const severity = (matchup?.winRate < 0.47 ? 2 : 0) + heroThreats.length;
    return {
      heroId: hero.id,
      heroName: hero.nameZh,
      tags: heroThreats.map((threat) => threat.label),
      level: severity >= 4 ? '高威胁' : severity >= 2 ? '需留意' : '常规',
      matchup: matchup ? {
        level: matchup.level,
        winRate: matchup.winRate,
        matches: matchup.matches
      } : null,
      reason: heroThreats.length
        ? heroThreats.map((threat) => THREAT_DETAILS[threat.key]).join('；')
        : matchup?.level === '困难'
          ? '历史对位样本偏难，避免无准备地单独接战'
          : '没有识别到突出的机制标签，仍需结合其实际出装'
    };
  }).sort((left, right) => {
    const order = { '高威胁': 3, '需留意': 2, '常规': 1 };
    return order[right.level] - order[left.level];
  });
  const knownThreatKeys = new Set(threats.map((threat) => threat.key));
  const priorities = RESPONSE_RULES
    .filter((rule) => rule.threats.some((key) => knownThreatKeys.has(key)))
    .slice(0, 3)
    .map(({ title, text }) => ({ title, text }));
  if (ROLE_POSITIONING[role]) priorities.unshift({ title: '你的站位', text: ROLE_POSITIONING[role] });
  const hardest = matchups[0];
  const profile = rankedThreats.slice(0, 3).map((threat) => threat.label).join('、');
  const summary = profile
    ? `已知敌方阵容的主要问题是${profile}${hardest ? `；历史对位最难处理的是${hardest.heroName}` : ''}。`
    : hardest
      ? `当前机制标签不突出；历史对位最难处理的是${hardest.heroName}。`
      : '当前已确认敌方英雄，但没有识别到集中的机制威胁。';

  return {
    available: true,
    enemyCount,
    coverageNote,
    summary,
    threats: rankedThreats,
    priorities: priorities.slice(0, 3),
    enemyBreakdown
  };
}

module.exports = { analyzeThreats, buildLineupAnalysis, THREAT_HEROES };

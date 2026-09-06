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

module.exports = { analyzeThreats, THREAT_HEROES };

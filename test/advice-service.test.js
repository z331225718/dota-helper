'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const catalog = require('../src/data/dota.zh-CN.json');
const { AdviceService, phaseForClock } = require('../src/main/advice-service');

function heroId(name) {
  return catalog.heroes.find((hero) => hero.name === `npc_dota_hero_${name}`).id;
}

function clinkzSnapshot() {
  return {
    map: { matchid: '42', clock_time: 17 * 60, game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' },
    player: { gold: 900, team_name: 'RADIANT' },
    hero: { id: 56, name: 'npc_dota_hero_clinkz', level: 6 },
    items: [{ slot: 'slot0', name: 'item_power_treads' }],
    abilities: [
      { slot: 'ability0', name: 'clinkz_strafe', level: 1 },
      { slot: 'ability1', name: 'clinkz_searing_arrows', level: 3 },
      { slot: 'ability2', name: 'clinkz_death_pact', level: 1 },
      { slot: 'ability3', name: 'clinkz_wind_walk', level: 0, ultimate: true }
    ],
    roster: { draft: { radiant: [], dire: [] }, spectator: { radiant: [], dire: [] } }
  };
}

test('phaseForClock selects stable phase boundaries', () => {
  assert.equal(phaseForClock(-20).key, 'starting');
  assert.equal(phaseForClock(0).key, 'early');
  assert.equal(phaseForClock(600).key, 'mid');
  assert.equal(phaseForClock(1800).key, 'late');
});

test('uses timely high-MMR build data and lineup-specific counters', () => {
  const service = new AdviceService();
  service.setRosterSlot('enemies', 0, heroId('phantom_assassin'));
  service.setRosterSlot('enemies', 1, heroId('abaddon'));
  const result = service.decorate({ status: { connected: true }, snapshot: clinkzSnapshot() });

  assert.equal(result.snapshot.hero.displayName, '克林克兹');
  assert.equal(result.snapshot.items[0].displayName, '动力鞋');
  assert.equal(result.roster.enemyCount, 2);
  assert.ok(result.advice.items.recommended.every((item) => item.averageMinute >= 11));
  assert.match(result.advice.items.source, /D2PT 7\./);
  assert.deepEqual(result.advice.items.counters.map((item) => item.name), ['item_monkey_king_bar']);
  assert.equal(result.advice.skill.title, '死亡契约');
  assert.match(result.advice.skill.reason, /高分局/);
});

test('falls back instead of inventing advice for an unknown hero', () => {
  const service = new AdviceService();
  const snapshot = clinkzSnapshot();
  snapshot.hero = { id: 9999, name: 'npc_dota_hero_unknown', level: 5 };
  snapshot.abilities = [];
  const result = service.decorate({ status: { connected: true }, snapshot });
  assert.equal(result.advice.skill.available, false);
  assert.equal(result.advice.skill.title, '暂无可靠加点数据');
  assert.equal(result.advice.items.available, false);
});

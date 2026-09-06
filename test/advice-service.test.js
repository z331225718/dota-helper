'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AdviceService, phaseForClock } = require('../src/main/advice-service');

function createDotaRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdh-advice-'));
  fs.mkdirSync(path.join(root, 'game', 'dota', 'itembuilds'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game', 'dota', 'itembuilds', 'default_clinkz.txt'), `
    "itembuilds" {
      "Items" {
        "#DOTA_Item_Build_Starting_Items" { "item" "item_tango" }
        "#DOTA_Item_Build_Early_Game" { "item" "item_boots" "item" "item_magic_wand" }
        "#DOTA_Item_Build_Mid_Items" { "item" "item_power_treads" "item" "item_desolator" }
        "#DOTA_Item_Build_Late_Items" { "item" "item_black_king_bar" }
        "#DOTA_Item_Build_Other_Items" { "item" "item_bloodthorn" }
      }
    }
  `);
  return root;
}

function clinkzSnapshot() {
  return {
    map: { clock_time: 360 },
    player: { gold: 900 },
    hero: { id: 56, name: 'npc_dota_hero_clinkz', level: 6 },
    items: [{ slot: 'slot0', name: 'item_boots' }],
    abilities: [
      { slot: 'ability0', name: 'clinkz_strafe', level: 1 },
      { slot: 'ability1', name: 'clinkz_searing_arrows', level: 3 },
      { slot: 'ability2', name: 'clinkz_death_pact', level: 1 },
      { slot: 'ability3', name: 'clinkz_wind_walk', level: 0, ultimate: true }
    ]
  };
}

test('phaseForClock selects stable phase boundaries', () => {
  assert.equal(phaseForClock(-20).key, 'starting');
  assert.equal(phaseForClock(0).key, 'early');
  assert.equal(phaseForClock(600).key, 'mid');
  assert.equal(phaseForClock(1800).key, 'late');
});

test('AdviceService localizes state and removes owned items from advice', (t) => {
  const dotaRoot = createDotaRoot();
  t.after(() => fs.rmSync(dotaRoot, { recursive: true, force: true }));
  const service = new AdviceService({ getDotaRoot: () => dotaRoot });
  const result = service.decorate({ status: { connected: true }, snapshot: clinkzSnapshot() });

  assert.equal(result.snapshot.hero.displayName, '克林克兹');
  assert.equal(result.snapshot.items[0].displayName, '速度之靴');
  assert.deepEqual(result.advice.items.recommended.map((item) => item.displayName), ['魔杖', '动力鞋', '黯灭']);
  assert.equal(result.advice.skill.title, '骨隐步');
  assert.match(result.advice.skill.reason, /当前优先补上/);
});

test('AdviceService declines to guess an unknown skill build', () => {
  const service = new AdviceService({ getDotaRoot: () => null });
  const snapshot = clinkzSnapshot();
  snapshot.hero = { id: 9999, name: 'npc_dota_hero_unknown', level: 5 };
  snapshot.abilities = [];
  const result = service.decorate({ status: { connected: true }, snapshot });
  assert.equal(result.advice.skill.available, false);
  assert.equal(result.advice.skill.title, '暂无已验证加点');
});

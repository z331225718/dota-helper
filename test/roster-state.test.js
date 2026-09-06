'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { RosterState } = require('../src/main/roster-state');

function snapshot(matchid = '1') {
  return {
    map: { matchid, game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS' },
    player: { team_name: 'RADIANT' },
    hero: { id: 1 },
    roster: {
      draft: { radiant: [{ slot: 0, heroId: 1 }, { slot: 1, heroId: 2 }], dire: [{ slot: 0, heroId: 3 }] },
      spectator: { radiant: [], dire: [] }
    }
  };
}

test('combines automatic and manual roster slots with source labels', () => {
  const roster = new RosterState([1, 2, 3, 4, 5]);
  roster.setSlot('enemies', 1, 4);
  const result = roster.get(snapshot());
  assert.equal(result.allyCount, 2);
  assert.equal(result.enemyCount, 2);
  assert.equal(result.allies[0].source, 'gsi');
  assert.equal(result.enemies[1].source, 'manual');
});

test('clears manual roster when the match id changes', () => {
  const roster = new RosterState([1, 2, 3, 4, 5]);
  roster.setSlot('enemies', 1, 4);
  roster.get(snapshot('1'));
  const result = roster.get(snapshot('2'));
  assert.equal(result.enemyCount, 1);
  assert.equal(result.enemies.some((entry) => entry?.heroId === 4), false);
});

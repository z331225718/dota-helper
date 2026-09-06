'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGsiPayload } = require('../src/main/state');

test('normalizes only the supported self-state fields', () => {
  const result = normalizeGsiPayload({
    map: { matchid: '42', clock_time: 123, secret: 'drop-me' },
    player: { gold: 900, kills: 2, hidden: 'drop-me' },
    hero: { name: 'npc_dota_hero_axe', level: 7, forbidden: 'drop-me' },
    items: { slot1: { name: 'item_blink', charges: 0, raw: 'drop-me' } },
    messages: [{ text: 'drop-me' }],
    arbitrary: { nested: true }
  }, 1000);

  assert.equal(result.receivedAt, 1000);
  assert.equal(result.inMatch, true);
  assert.deepEqual(result.map, { matchid: '42', clock_time: 123 });
  assert.deepEqual(result.player, { gold: 900, kills: 2 });
  assert.deepEqual(result.hero, { name: 'npc_dota_hero_axe', level: 7 });
  assert.deepEqual(result.items, [{ slot: 'slot1', name: 'item_blink', charges: 0 }]);
  assert.equal(Object.hasOwn(result, 'messages'), false);
  assert.equal(JSON.stringify(result).includes('drop-me'), false);
});

test('handles missing and malformed sections', () => {
  const result = normalizeGsiPayload({ map: null, player: [], hero: 'unknown', items: { slot0: null } });
  assert.deepEqual(result.map, {});
  assert.deepEqual(result.player, {});
  assert.deepEqual(result.hero, {});
  assert.deepEqual(result.items, []);
  assert.equal(result.inMatch, false);
});

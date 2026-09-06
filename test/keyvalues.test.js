'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseKeyValues, tokenizeKeyValues } = require('../src/main/keyvalues');

test('tokenizeKeyValues handles comments, braces and quoted strings', () => {
  assert.deepEqual(tokenizeKeyValues('"root" { // note\n "name" "value" }'), [
    'root', '{', 'name', 'value', '}'
  ]);
});

test('parseKeyValues preserves duplicate keys as an array', () => {
  const parsed = parseKeyValues('"root" { "item" "item_boots" "item" "item_wand" }');
  assert.deepEqual(parsed, { root: { item: ['item_boots', 'item_wand'] } });
});

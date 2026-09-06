'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  CONFIG_FILENAME,
  parseVdf,
  libraryRootsFromSteam,
  buildConfig,
  getConfigStatus,
  installConfig,
  removeConfig
} = require('../src/main/gsi-config');

test('parses Steam libraryfolders VDF without regex extraction', () => {
  const parsed = parseVdf(`
    "libraryfolders"
    {
      "0" { "path" "C:\\\\Program Files (x86)\\\\Steam" }
      "1" { "path" "D:\\\\Games" "apps" { "570" "123" } }
    }
  `);
  assert.equal(parsed.libraryfolders['1'].path, 'D:\\Games');
  assert.equal(parsed.libraryfolders['1'].apps['570'], '123');
});

test('reads configured Steam library roots', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdh-steam-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'steamapps'), { recursive: true });
  fs.writeFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), '"libraryfolders" { "1" { "path" "D:\\\\Games" } }');
  assert.deepEqual(libraryRootsFromSteam(root), [root, 'D:\\Games']);
});

test('builds a read-only GSI data request', () => {
  const config = buildConfig('a'.repeat(64), 4000);
  assert.match(config, /127\.0\.0\.1:4000\/gsi/);
  assert.match(config, /"hero" "1"/);
  assert.match(config, /"items" "1"/);
  assert.match(config, /"draft" "1"/);
  assert.doesNotMatch(config, /messages|buildings/i);
});

test('installs idempotently and removes only its managed config', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdh-dota-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'game', 'dota', 'cfg'), { recursive: true });

  const installed = installConfig(root, 'b'.repeat(64), 4000);
  assert.equal(installed.installed, true);
  assert.equal(installed.managed, true);
  installConfig(root, 'b'.repeat(64), 4000);
  assert.equal(removeConfig(root).installed, false);

  const foreignPath = path.join(root, 'game', 'dota', 'cfg', 'gamestate_integration', CONFIG_FILENAME);
  fs.mkdirSync(path.dirname(foreignPath), { recursive: true });
  fs.writeFileSync(foreignPath, '"foreign" {}');
  assert.equal(getConfigStatus(root).managed, false);
  assert.throws(() => removeConfig(root), /拒绝删除/);
});

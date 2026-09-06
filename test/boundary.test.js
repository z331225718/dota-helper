'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function sourceFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(resolved) : [resolved];
  });
}

test('application source excludes automation, process access, telemetry, and cloud clients', () => {
  const sourceRoot = path.join(__dirname, '..', 'src');
  const source = sourceFiles(sourceRoot).map((file) => fs.readFileSync(file, 'utf8')).join('\n').toLowerCase();
  const forbidden = [
    'robot' + 'js',
    'send' + 'input',
    'keybd' + '_event',
    'read' + 'processmemory',
    'open' + 'process',
    'supabase',
    'sentry',
    'clipboard'
  ];
  for (const term of forbidden) assert.equal(source.includes(term), false, `found forbidden capability: ${term}`);
});

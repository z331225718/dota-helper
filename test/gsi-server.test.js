'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { GsiServer } = require('../src/main/gsi-server');

function post(port, payload) {
  return new Promise((resolve, reject) => {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: '/gsi',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('accepts a valid local update and rejects a wrong token', async (context) => {
  const server = new GsiServer({ token: 'secret-token', port: 0 });
  context.after(() => server.stop());
  const address = await server.start();

  assert.equal(address.address, '127.0.0.1');
  assert.equal(await post(address.port, { auth: { token: 'wrong' }, player: { gold: 1 } }), 401);
  assert.equal(server.getStatus().connected, false);

  assert.equal(await post(address.port, { auth: { token: 'secret-token' }, player: { gold: 321 } }), 204);
  assert.equal(server.getStatus().connected, true);
  assert.equal(server.getViewModel().snapshot.player.gold, 321);
});

test('rejects malformed and oversized bodies', async (context) => {
  const server = new GsiServer({ token: 'secret-token', port: 0, maxBodyBytes: 64 });
  context.after(() => server.stop());
  const address = await server.start();

  assert.equal(await post(address.port, '{not-json'), 400);
  assert.equal(await post(address.port, JSON.stringify({ auth: { token: 'secret-token' }, padding: 'x'.repeat(100) })), 413);
});

test('marks old updates as disconnected', () => {
  const server = new GsiServer({ token: 'secret-token', port: 0, staleAfterMs: 10 });
  server.acceptTrustedPayload({ player: { gold: 321 } }, 1_000);
  assert.equal(server.getStatus(1_005).connected, false, 'a stopped server is never connected');
  server.server = { listening: true, address: () => ({ address: '127.0.0.1', port: 4000 }) };
  assert.equal(server.getStatus(1_005).connected, true);
  assert.equal(server.getStatus(1_011).connected, false);
});

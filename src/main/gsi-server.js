'use strict';

const http = require('node:http');
const { EventEmitter } = require('node:events');
const { normalizeGsiPayload } = require('./state');

const DEFAULT_MAX_BODY_BYTES = 128 * 1024;
const DEFAULT_STALE_AFTER_MS = 12_000;

class GsiServer extends EventEmitter {
  constructor({ token, port = 4000, maxBodyBytes = DEFAULT_MAX_BODY_BYTES, staleAfterMs = DEFAULT_STALE_AFTER_MS }) {
    super();
    if (!token) throw new Error('GSI token is required');

    this.token = token;
    this.port = port;
    this.maxBodyBytes = maxBodyBytes;
    this.staleAfterMs = staleAfterMs;
    this.server = null;
    this.snapshot = null;
    this.lastSeenAt = null;
    this.staleTimer = null;
    this.error = null;
  }

  async start() {
    if (this.server) return this.address();

    this.server = http.createServer((request, response) => this.handleRequest(request, response));
    this.server.on('clientError', (_error, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.error = error.message;
        this.server = null;
        reject(error);
      };
      this.server.once('error', onError);
      this.server.listen(this.port, '127.0.0.1', () => {
        this.server.off('error', onError);
        this.error = null;
        resolve();
      });
    });

    this.staleTimer = setInterval(() => this.emitStatusIfStale(), 1_000);
    this.staleTimer.unref?.();
    return this.address();
  }

  async stop() {
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.staleTimer = null;

    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(resolve));
  }

  address() {
    const address = this.server?.address();
    return typeof address === 'object' && address ? address : null;
  }

  getStatus(now = Date.now()) {
    const listening = Boolean(this.server?.listening);
    const connected = listening && this.lastSeenAt !== null && now - this.lastSeenAt <= this.staleAfterMs;

    return {
      listening,
      connected,
      host: '127.0.0.1',
      port: this.address()?.port ?? this.port,
      lastSeenAt: this.lastSeenAt,
      error: this.error
    };
  }

  getViewModel() {
    return {
      status: this.getStatus(),
      snapshot: this.getStatus().connected ? this.snapshot : null
    };
  }

  emitStatusIfStale() {
    if (this.lastSeenAt !== null && !this.getStatus().connected) {
      this.emit('update', this.getViewModel());
      this.lastSeenAt = null;
      this.snapshot = null;
    }
  }

  acceptTrustedPayload(payload, receivedAt = Date.now()) {
    this.snapshot = normalizeGsiPayload(payload, receivedAt);
    this.lastSeenAt = receivedAt;
    const viewModel = this.getViewModel();
    this.emit('update', viewModel);
    return viewModel;
  }

  handleRequest(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' });
      response.end();
      return;
    }

    if (request.url !== '/' && request.url !== '/gsi') {
      response.writeHead(404);
      response.end();
      return;
    }

    const chunks = [];
    let totalBytes = 0;
    let rejected = false;

    request.on('data', (chunk) => {
      if (rejected) return;
      totalBytes += chunk.length;
      if (totalBytes > this.maxBodyBytes) {
        rejected = true;
        response.writeHead(413);
        response.end();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      if (rejected) return;

      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        response.writeHead(400);
        response.end();
        return;
      }

      if (payload?.auth?.token !== this.token) {
        response.writeHead(401);
        response.end();
        return;
      }

      this.acceptTrustedPayload(payload);
      response.writeHead(204);
      response.end();
    });

    request.on('error', () => {
      if (!response.headersSent) response.writeHead(400);
      response.end();
    });
  }
}

module.exports = {
  GsiServer,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_STALE_AFTER_MS
};

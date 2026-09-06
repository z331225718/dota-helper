'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class SettingsStore {
  constructor(directory) {
    this.directory = directory;
    this.filePath = path.join(directory, 'settings.json');
    this.data = this.read();
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  write() {
    fs.mkdirSync(this.directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, this.filePath);
  }

  getOrCreateToken() {
    if (typeof this.data.gsiToken !== 'string' || !/^[a-f0-9]{64}$/i.test(this.data.gsiToken)) {
      this.data.gsiToken = crypto.randomBytes(32).toString('hex');
      this.write();
    }
    return this.data.gsiToken;
  }
}

module.exports = { SettingsStore };

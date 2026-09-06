'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CONFIG_FILENAME = 'gamestate_integration_personal_dota_helper.cfg';
const OWNERSHIP_MARKER = '// personal-dota-helper:managed';

function tokenizeVdf(text) {
  const tokens = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '/' && text[index + 1] === '/') {
      index = text.indexOf('\n', index + 2);
      if (index === -1) break;
      continue;
    }
    if (char === '{' || char === '}') {
      tokens.push(char);
      index += 1;
      continue;
    }
    if (char !== '"') {
      throw new Error(`Unexpected VDF token at ${index}`);
    }

    index += 1;
    let value = '';
    while (index < text.length && text[index] !== '"') {
      if (text[index] === '\\' && index + 1 < text.length) {
        const next = text[index + 1];
        value += next === '\\' || next === '"' ? next : `\\${next}`;
        index += 2;
      } else {
        value += text[index];
        index += 1;
      }
    }
    if (text[index] !== '"') throw new Error('Unterminated VDF string');
    tokens.push(value);
    index += 1;
  }

  return tokens;
}

function parseVdf(text) {
  const tokens = tokenizeVdf(text);
  let cursor = 0;

  function parseObject(expectClosingBrace = false) {
    const result = {};
    while (cursor < tokens.length) {
      if (tokens[cursor] === '}') {
        if (!expectClosingBrace) throw new Error('Unexpected closing brace');
        cursor += 1;
        return result;
      }

      const key = tokens[cursor++];
      const next = tokens[cursor++];
      if (next === '{') {
        result[key] = parseObject(true);
      } else if (typeof next === 'string' && next !== '}') {
        result[key] = next;
      } else {
        throw new Error(`Missing value for VDF key ${key}`);
      }
    }
    if (expectClosingBrace) throw new Error('Missing closing brace');
    return result;
  }

  return parseObject();
}

function uniqueExistingDirectories(candidates, fileSystem = fs) {
  const seen = new Set();
  return candidates.filter(Boolean).filter((candidate) => {
    const resolved = path.resolve(candidate);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) return false;
    seen.add(key);
    try {
      return fileSystem.statSync(resolved).isDirectory();
    } catch {
      return false;
    }
  });
}

function defaultSteamRoots(environment = process.env, platform = process.platform) {
  if (platform === 'win32') {
    return uniqueExistingDirectories([
      environment.STEAM_PATH,
      environment['ProgramFiles(x86)'] && path.join(environment['ProgramFiles(x86)'], 'Steam'),
      environment.ProgramFiles && path.join(environment.ProgramFiles, 'Steam')
    ]);
  }

  if (platform === 'darwin') {
    return uniqueExistingDirectories([
      path.join(os.homedir(), 'Library', 'Application Support', 'Steam')
    ]);
  }

  return uniqueExistingDirectories([
    path.join(os.homedir(), '.steam', 'steam'),
    path.join(os.homedir(), '.local', 'share', 'Steam')
  ]);
}

function libraryRootsFromSteam(steamRoot, fileSystem = fs) {
  const libraryFile = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
  let parsed;
  try {
    parsed = parseVdf(fileSystem.readFileSync(libraryFile, 'utf8'));
  } catch {
    return [steamRoot];
  }

  const folders = parsed.libraryfolders ?? parsed.LibraryFolders ?? {};
  const configured = Object.values(folders)
    .map((entry) => typeof entry === 'object' ? entry.path : null)
    .filter((entry) => typeof entry === 'string');

  return [steamRoot, ...configured];
}

function dotaRootFromLibrary(libraryRoot) {
  return path.join(libraryRoot, 'steamapps', 'common', 'dota 2 beta');
}

function configDirectoryFromDotaRoot(dotaRoot) {
  return path.join(dotaRoot, 'game', 'dota', 'cfg', 'gamestate_integration');
}

function resolveDotaRootFromSelection(selection, fileSystem = fs) {
  const resolved = path.resolve(selection);
  const candidates = [
    resolved,
    path.join(resolved, 'dota 2 beta'),
    path.join(resolved, 'common', 'dota 2 beta'),
    path.join(resolved, 'steamapps', 'common', 'dota 2 beta')
  ];

  return candidates.find((candidate) => {
    try {
      return fileSystem.statSync(path.join(candidate, 'game', 'dota', 'cfg')).isDirectory();
    } catch {
      return false;
    }
  }) ?? null;
}

function discoverDotaInstallations(steamRoots = defaultSteamRoots(), fileSystem = fs) {
  const libraryRoots = steamRoots.flatMap((root) => libraryRootsFromSteam(root, fileSystem));
  return uniqueExistingDirectories(libraryRoots.map(dotaRootFromLibrary), fileSystem);
}

function buildConfig(token, port = 4000) {
  if (!/^[a-f0-9]{32,128}$/i.test(token)) throw new Error('Invalid GSI token');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid GSI port');

  return `${OWNERSHIP_MARKER}
"Personal Dota Helper"
{
  "uri" "http://127.0.0.1:${port}/gsi"
  "timeout" "5.0"
  "buffer" "0.1"
  "throttle" "0.5"
  "heartbeat" "30.0"
  "auth"
  {
    "token" "${token}"
  }
  "data"
  {
    "provider" "1"
    "map" "1"
    "player" "1"
    "hero" "1"
    "abilities" "1"
    "items" "1"
    "draft" "1"
  }
}
`;
}

function getConfigStatus(dotaRoot, fileSystem = fs) {
  const configPath = path.join(configDirectoryFromDotaRoot(dotaRoot), CONFIG_FILENAME);
  try {
    const contents = fileSystem.readFileSync(configPath, 'utf8');
    return { configPath, installed: true, managed: contents.startsWith(OWNERSHIP_MARKER) };
  } catch {
    return { configPath, installed: false, managed: false };
  }
}

function installConfig(dotaRoot, token, port = 4000, fileSystem = fs) {
  const configDirectory = configDirectoryFromDotaRoot(dotaRoot);
  const configPath = path.join(configDirectory, CONFIG_FILENAME);
  const temporaryPath = `${configPath}.${process.pid}.tmp`;

  fileSystem.mkdirSync(configDirectory, { recursive: true });
  const existing = getConfigStatus(dotaRoot, fileSystem);
  if (existing.installed && !existing.managed) {
    throw new Error('目标配置文件不是本项目创建的，已拒绝覆盖');
  }

  fileSystem.writeFileSync(temporaryPath, buildConfig(token, port), { encoding: 'utf8', mode: 0o600 });
  fileSystem.renameSync(temporaryPath, configPath);
  return getConfigStatus(dotaRoot, fileSystem);
}

function removeConfig(dotaRoot, fileSystem = fs) {
  const status = getConfigStatus(dotaRoot, fileSystem);
  if (!status.installed) return status;
  if (!status.managed) throw new Error('目标配置文件不是本项目创建的，已拒绝删除');
  fileSystem.unlinkSync(status.configPath);
  return getConfigStatus(dotaRoot, fileSystem);
}

module.exports = {
  CONFIG_FILENAME,
  OWNERSHIP_MARKER,
  parseVdf,
  defaultSteamRoots,
  libraryRootsFromSteam,
  resolveDotaRootFromSelection,
  discoverDotaInstallations,
  configDirectoryFromDotaRoot,
  buildConfig,
  getConfigStatus,
  installConfig,
  removeConfig
};

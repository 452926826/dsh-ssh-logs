import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DEFAULTS = Object.freeze({
  maxBytes: 128 * 1024,
  connectTimeoutSeconds: 10,
  commandTimeoutMs: 120_000,
});

export function expandHome(value) {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return path.join(homedir(), value.slice(2));
  return value;
}

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value, name) {
  if (value === undefined) return undefined;
  return requiredString(value, name);
}

function normalizeRoots(value, serverName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`servers.${serverName}.roots must be a non-empty mapping`);
  }
  const roots = {};
  for (const [rootName, rootPath] of Object.entries(value)) {
    if (!NAME_RE.test(rootName)) {
      throw new Error(`servers.${serverName}.roots has invalid alias ${JSON.stringify(rootName)}`);
    }
    const normalized = path.posix.normalize(requiredString(rootPath, `servers.${serverName}.roots.${rootName}`));
    if (!normalized.startsWith('/') || normalized === '/') {
      throw new Error(`servers.${serverName}.roots.${rootName} must be an absolute non-root path`);
    }
    roots[rootName] = normalized.replace(/\/$/, '');
  }
  if (Object.keys(roots).length === 0) {
    throw new Error(`servers.${serverName}.roots must not be empty`);
  }
  return roots;
}

export function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('config must be a mapping');
  }
  const defaultsRaw = raw.defaults ?? {};
  if (typeof defaultsRaw !== 'object' || Array.isArray(defaultsRaw)) {
    throw new Error('defaults must be a mapping');
  }
  const defaults = {
    maxBytes: positiveInteger(defaultsRaw.maxBytes, DEFAULTS.maxBytes, 'defaults.maxBytes'),
    connectTimeoutSeconds: positiveInteger(defaultsRaw.connectTimeoutSeconds, DEFAULTS.connectTimeoutSeconds, 'defaults.connectTimeoutSeconds'),
    commandTimeoutMs: positiveInteger(defaultsRaw.commandTimeoutMs, DEFAULTS.commandTimeoutMs, 'defaults.commandTimeoutMs'),
  };
  if (defaults.maxBytes > 4 * 1024 * 1024) {
    throw new Error('defaults.maxBytes must not exceed 4194304');
  }

  if (!raw.servers || typeof raw.servers !== 'object' || Array.isArray(raw.servers)) {
    throw new Error('servers must be a non-empty mapping');
  }
  const servers = {};
  for (const [name, value] of Object.entries(raw.servers)) {
    if (!NAME_RE.test(name)) throw new Error(`invalid server alias ${JSON.stringify(name)}`);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`servers.${name} must be a mapping`);
    }
    servers[name] = {
      name,
      description: optionalString(value.description, `servers.${name}.description`),
      host: requiredString(value.host, `servers.${name}.host`),
      user: optionalString(value.user, `servers.${name}.user`),
      port: positiveInteger(value.port, 22, `servers.${name}.port`),
      identityFile: value.identityFile ? expandHome(requiredString(value.identityFile, `servers.${name}.identityFile`)) : undefined,
      knownHostsFile: expandHome(optionalString(value.knownHostsFile, `servers.${name}.knownHostsFile`) ?? '~/.ssh/known_hosts'),
      proxyJump: optionalString(value.proxyJump, `servers.${name}.proxyJump`),
      roots: normalizeRoots(value.roots, name),
      maxBytes: positiveInteger(value.maxBytes, defaults.maxBytes, `servers.${name}.maxBytes`),
      connectTimeoutSeconds: positiveInteger(value.connectTimeoutSeconds, defaults.connectTimeoutSeconds, `servers.${name}.connectTimeoutSeconds`),
      commandTimeoutMs: positiveInteger(value.commandTimeoutMs, defaults.commandTimeoutMs, `servers.${name}.commandTimeoutMs`),
    };
    if (servers[name].port > 65535) throw new Error(`servers.${name}.port must not exceed 65535`);
    if (servers[name].maxBytes > 4 * 1024 * 1024) throw new Error(`servers.${name}.maxBytes must not exceed 4194304`);
  }
  if (Object.keys(servers).length === 0) throw new Error('servers must not be empty');
  return { defaults, servers };
}

export async function loadConfig(configPath = process.env.DSH_SSH_LOGS_CONFIG) {
  if (!configPath) throw new Error('DSH_SSH_LOGS_CONFIG is not set');
  const resolved = path.resolve(expandHome(configPath));
  const text = await readFile(resolved, 'utf8');
  return { path: resolved, ...normalizeConfig(YAML.parse(text)) };
}

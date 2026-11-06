import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PERMISSIONS = new Set(['read-only', 'read-write']);

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function normalizePort(value) {
  const port = value === undefined ? 22 : Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('port must be an integer from 1 to 65535');
  return port;
}

function normalizeCommands(value, field, { required = false } = {}) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of command names`);
  const commands = [...new Set(value.map((command, index) => requiredString(command, `${field}[${index}]`)))];
  for (const command of commands) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(command)) {
      throw new Error(`${field} entries must be executable command names`);
    }
  }
  if (required && commands.length === 0) throw new Error(`${field} must not be empty`);
  return commands;
}

export function normalizeStoredServer(input, previous) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('server must be an object');
  const name = requiredString(input.name, 'name');
  if (!NAME_RE.test(name)) throw new Error('name must use letters, numbers, dot, underscore, or hyphen');
  const permission = input.permission ?? 'read-only';
  if (!PERMISSIONS.has(permission)) throw new Error('permission must be read-only or read-write');
  const host = requiredString(input.host, 'host');
  const port = normalizePort(input.port);
  const user = requiredString(input.user, 'user');
  const identityFile = input.identityFile ? requiredString(input.identityFile, 'identityFile') : undefined;
  const proxyJump = input.proxyJump ? requiredString(input.proxyJump, 'proxyJump') : undefined;
  const sameIdentity = previous && host === previous.host && port === previous.port && user === previous.user
    && identityFile === previous.identityFile && proxyJump === previous.proxyJump;
  const password = typeof input.password === 'string' && input.password.length > 0 ? input.password : sameIdentity ? previous.password : undefined;
  if (password && proxyJump) throw new Error('password authentication cannot be combined with proxyJump');
  if (!password && !identityFile) throw new Error('password or identityFile is required; changing connection identity requires new credentials');
  return {
    name,
    host,
    port,
    user,
    ...(password ? { password } : {}),
    ...(identityFile ? { identityFile } : {}),
    ...(proxyJump ? { proxyJump } : {}),
    permission,
    allowedCommands: normalizeCommands(input.allowedCommands, 'allowedCommands', { required: true }),
    deniedCommands: normalizeCommands(input.deniedCommands, 'deniedCommands'),
  };
}

export function publicServer(server) {
  return {
    name: server.name,
    host: server.host,
    port: server.port,
    user: server.user,
    ...(server.identityFile ? { identityFile: server.identityFile } : {}),
    ...(server.proxyJump ? { proxyJump: server.proxyJump } : {}),
    hasPassword: typeof server.password === 'string' && server.password.length > 0,
    permission: server.permission,
    allowedCommands: server.allowedCommands,
    deniedCommands: server.deniedCommands,
  };
}

export class SshServerStore {
  constructor(path) {
    this.path = resolve(path);
    this.mutateTail = Promise.resolve();
  }

  async listRaw() {
    return (await this.#load()).servers;
  }

  async listPublic() {
    return Object.values(await this.listRaw()).map(publicServer);
  }

  async upsert(input, originalName) {
    return await this.#mutate(async (state) => {
      const key = originalName ?? input.name;
      const previous = state.servers[key];
      const server = normalizeStoredServer(input, previous);
      if (key !== server.name && state.servers[server.name]) throw new Error(`server ${server.name} already exists`);
      if (key !== server.name) delete state.servers[key];
      state.servers[server.name] = server;
      return publicServer(server);
    });
  }

  async remove(name) {
    return await this.#mutate(async (state) => {
      if (!state.servers[name]) return { persist: false, value: false };
      delete state.servers[name];
      return true;
    });
  }

  async #load() {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('SSH server state must be an object');
      return { servers: parsed.servers && typeof parsed.servers === 'object' ? parsed.servers : {} };
    } catch (error) {
      if (error?.code === 'ENOENT') return { servers: {} };
      throw error;
    }
  }

  async #mutate(change) {
    const operation = this.mutateTail.then(async () => {
      const state = await this.#load();
      const result = await change(state);
      if (result?.persist === false) return result.value;
      await this.#persist(state);
      return result;
    });
    this.mutateTail = operation.catch(() => {});
    return await operation;
  }

  async #persist(state) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }
}

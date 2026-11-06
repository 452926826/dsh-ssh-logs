import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MAX_LINES = 5000;
const MAX_MATCHES = 1000;
const SHELL_CONTROL_RE = /[;&|`$\n\r<>]/u;

export function parseCommand(remoteCommand) {
  if (typeof remoteCommand !== 'string' || remoteCommand.trim() === '') throw new Error('command must be a non-empty string');
  if (SHELL_CONTROL_RE.test(remoteCommand)) throw new Error('command must be a single command without shell control operators or expansion');
  const args = [];
  let token = '', quote = '', started = false;
  for (const char of remoteCommand.trim()) {
    if (char === '\\') throw new Error('backslash escapes are not supported');
    if (quote) {
      if (char === quote) quote = ''; else token += char;
      started = true;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/u.test(char)) {
      if (started) { args.push(token); token = ''; started = false; }
    } else { token += char; started = true; }
  }
  if (quote) throw new Error('unterminated quote');
  if (started) args.push(token);
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(args[0])) throw new Error('command must begin with an executable command name');
  return args;
}

export function commandName(remoteCommand) {
  return parseCommand(remoteCommand)[0];
}

export function assertCommandAllowed(server, remoteCommand) {
  const name = commandName(remoteCommand);
  if ((server.deniedCommands ?? []).includes(name)) throw new Error(`command ${JSON.stringify(name)} is denied for server ${server.name}`);
  if (!(server.allowedCommands ?? []).includes(name)) throw new Error(`command ${JSON.stringify(name)} is not allowed for server ${server.name}`);
  return name;
}

export function resolveRemotePath(server, rootName, relativePath) {
  const root = (server.roots ?? {})[rootName];
  if (!root) throw new Error(`unknown root ${JSON.stringify(rootName)} for server ${server.name}`);
  if (typeof relativePath !== 'string' || relativePath.trim() === '') throw new Error('path must be a non-empty relative path');
  if (relativePath.includes('\0') || relativePath.startsWith('/') || relativePath.includes('\\')) throw new Error('path must be relative and use forward slashes');
  const normalized = path.posix.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('path must stay inside the configured log root');
  return path.posix.join(root, normalized);
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export function buildSshArgs(server, remoteCommand) {
  const args = ['-T', '-o', server.password ? 'BatchMode=no' : 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${server.knownHostsFile ?? path.join(process.env.HOME ?? '.', '.ssh/known_hosts')}`, '-o', `ConnectTimeout=${server.connectTimeoutSeconds}`, '-o', 'LogLevel=ERROR', '-p', String(server.port)];
  if (server.password) args.unshift('-F', '/dev/null');
  if (server.identityFile) args.push('-i', server.identityFile, '-o', 'IdentitiesOnly=yes');
  if (server.proxyJump) args.push('-J', server.proxyJump);
  args.push('--', server.user ? `${server.user}@${server.host}` : server.host, remoteCommand);
  return args;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], env: options.env });
    const stdout = [], stderr = [];
    let bytes = 0, settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error(`SSH operation timed out after ${options.timeoutMs}ms`)); }, options.timeoutMs);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > options.maxBytes) { child.kill('SIGKILL'); finish(new Error(`SSH output exceeded ${options.maxBytes} bytes`)); } else stdout.push(chunk); });
    child.stderr.on('data', chunk => { if (Buffer.concat(stderr).length < 16 * 1024) stderr.push(chunk); });
    child.on('error', error => finish(new Error(`failed to start ${command}: ${error.message}`)));
    child.on('close', (code, signal) => code === 0 ? finish(undefined, Buffer.concat(stdout).toString('utf8')) : finish(new Error(`SSH failed (${signal ?? `exit ${code}`}): ${Buffer.concat(stderr).toString('utf8').trim() || 'no error output'}`)));
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
  });
}

async function passwordContext(server) {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-ssh-'));
  const askpass = path.join(directory, 'askpass.sh');
  await writeFile(askpass, '#!/bin/sh\nprintf "%s\\n" "$DSH_SSH_PASSWORD"\n', { mode: 0o700 });
  await chmod(askpass, 0o700);
  return { directory, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force', DSH_SSH_PASSWORD: server.password, DISPLAY: ':0' } };
}

async function executeSsh(server, remoteCommand, maxBytes = server.maxBytes, stdin) {
  if (server.password && server.proxyJump) throw new Error('password authentication cannot be combined with proxyJump');
  let context;
  try {
    context = server.password ? await passwordContext(server) : undefined;
    const args = buildSshArgs(server, remoteCommand);
    return await run(server.password ? 'setsid' : 'ssh', server.password ? ['ssh', ...args] : args, { env: context?.env ?? { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }, timeoutMs: server.commandTimeoutMs, maxBytes, stdin });
  } finally {
    if (context) await rm(context.directory, { recursive: true, force: true });
  }
}

export async function testSshConnection(server) {
  // Fixed probe only; user-originated commands always pass through policy.
  await executeSsh(server, 'true', 1024);
  return { ok: true };
}

export async function runSsh(server, remoteCommand, maxBytes = server.maxBytes) {
  if (server.permission !== 'read-write') throw new Error(`server ${server.name} does not permit remote commands`);
  assertCommandAllowed(server, remoteCommand);
  return await executeSsh(server, parseCommand(remoteCommand).map(shellQuote).join(' '), maxBytes);
}

export async function runLogCommand(server, remoteCommand) {
  return await executeSsh(server, remoteCommand);
}

export function readCommand(remotePath, options) {
  const lines = Math.min(options.lines ?? 200, MAX_LINES), quoted = shellQuote(remotePath);
  if (options.mode === 'head') return `head -n ${lines} -- ${quoted}`;
  if (options.mode === 'range') { const start = options.startLine ?? 1; return `sed -n '${start},${Math.min(start + lines - 1, start + MAX_LINES - 1)}p' -- ${quoted}`; }
  return `tail -n ${lines} -- ${quoted}`;
}

export function searchCommand(remotePath, pattern, options = {}) {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 500) throw new Error('pattern must contain 1 to 500 characters');
  const matches = Math.min(options.maxMatches ?? 200, MAX_MATCHES), context = Math.min(options.context ?? 0, 20), flags = options.ignoreCase === false ? '-nF' : '-niF';
  return `grep ${flags} -C ${context} -m ${matches} -- ${shellQuote(pattern)} ${shellQuote(remotePath)}`;
}

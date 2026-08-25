import { spawn } from 'node:child_process';
import path from 'node:path';

const MAX_LINES = 5000;
const MAX_MATCHES = 1000;

export function resolveRemotePath(server, rootName, relativePath) {
  const root = server.roots[rootName];
  if (!root) throw new Error(`unknown root ${JSON.stringify(rootName)} for server ${server.name}`);
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    throw new Error('path must be a non-empty relative path');
  }
  if (relativePath.includes('\0') || relativePath.startsWith('/') || relativePath.includes('\\')) {
    throw new Error('path must be relative and use forward slashes');
  }
  const normalized = path.posix.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('path must stay inside the configured log root');
  }
  return path.posix.join(root, normalized);
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export function buildSshArgs(server, remoteCommand) {
  const args = [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${server.knownHostsFile}`,
    '-o', `ConnectTimeout=${server.connectTimeoutSeconds}`,
    '-o', 'LogLevel=ERROR',
    '-p', String(server.port),
  ];
  if (server.identityFile) args.push('-i', server.identityFile, '-o', 'IdentitiesOnly=yes');
  if (server.proxyJump) args.push('-J', server.proxyJump);
  const destination = server.user ? `${server.user}@${server.host}` : server.host;
  args.push('--', destination, remoteCommand);
  return args;
}

export async function runSsh(server, remoteCommand, maxBytes = server.maxBytes) {
  return await new Promise((resolve, reject) => {
    const child = spawn('ssh', buildSshArgs(server, remoteCommand), {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`SSH command timed out after ${server.commandTimeoutMs}ms`));
    }, server.commandTimeoutMs);
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBytes) {
        child.kill('SIGKILL');
        finish(new Error(`SSH output exceeded ${maxBytes} bytes; request fewer lines or matches`));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 16 * 1024) stderr.push(chunk);
    });
    child.on('error', (error) => finish(new Error(`failed to start ssh: ${error.message}`)));
    child.on('close', (code, signal) => {
      if (settled) return;
      const output = Buffer.concat(stdout).toString('utf8');
      const errorOutput = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0) {
        finish(new Error(`SSH failed (${signal ?? `exit ${code}`}): ${errorOutput || 'no error output'}`));
        return;
      }
      finish(undefined, output);
    });
  });
}

export function readCommand(remotePath, options) {
  const lines = Math.min(options.lines ?? 200, MAX_LINES);
  const quoted = shellQuote(remotePath);
  if (options.mode === 'head') return `head -n ${lines} -- ${quoted}`;
  if (options.mode === 'range') {
    const startLine = options.startLine ?? 1;
    const endLine = Math.min(startLine + lines - 1, startLine + MAX_LINES - 1);
    return `sed -n '${startLine},${endLine}p' -- ${quoted}`;
  }
  return `tail -n ${lines} -- ${quoted}`;
}

export function searchCommand(remotePath, pattern, options = {}) {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 500) {
    throw new Error('pattern must contain 1 to 500 characters');
  }
  const maxMatches = Math.min(options.maxMatches ?? 200, MAX_MATCHES);
  const context = Math.min(options.context ?? 0, 20);
  const flags = options.ignoreCase === false ? '-nF' : '-niF';
  return `grep ${flags} -C ${context} -m ${maxMatches} -- ${shellQuote(pattern)} ${shellQuote(remotePath)}`;
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConfig } from '../src/config.js';
import { buildSshArgs, readCommand, resolveRemotePath, searchCommand, shellQuote } from '../src/remote.js';

const config = normalizeConfig({
  servers: {
    prod: {
      host: 'example.com',
      user: 'reader',
      identityFile: '~/.ssh/logs',
      roots: { app: '/srv/app/logs' },
    },
  },
});
const server = config.servers.prod;

test('normalizes a multi-server compatible config', () => {
  assert.equal(server.port, 22);
  assert.equal(server.maxBytes, 128 * 1024);
  assert.equal(server.roots.app, '/srv/app/logs');
});

test('resolves only relative paths below an allowlisted root', () => {
  assert.equal(resolveRemotePath(server, 'app', 'api/current.log'), '/srv/app/logs/api/current.log');
  assert.throws(() => resolveRemotePath(server, 'app', '../secrets'), /stay inside/);
  assert.throws(() => resolveRemotePath(server, 'app', '/etc/passwd'), /relative/);
  assert.throws(() => resolveRemotePath(server, 'missing', 'a.log'), /unknown root/);
});

test('quotes shell metacharacters as data', () => {
  assert.equal(shellQuote("a'b;$(id)"), "'a'\\''b;$(id)'");
  const command = searchCommand('/logs/a.log', "x'; rm -rf /", { ignoreCase: true });
  assert.match(command, /grep -niF/);
  assert.match(command, /'x'\\''; rm -rf \/'/);
});

test('builds constrained ssh arguments', () => {
  const args = buildSshArgs(server, readCommand('/srv/app/logs/api.log', { mode: 'tail', lines: 20 }));
  assert.deepEqual(args.slice(0, 5), ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes']);
  assert.ok(args.includes('IdentitiesOnly=yes'));
  assert.equal(args.at(-2), 'reader@example.com');
  assert.equal(args.at(-1), "tail -n 20 -- '/srv/app/logs/api.log'");
});

test('rejects unsafe or excessive config', () => {
  assert.throws(() => normalizeConfig({ servers: { prod: { host: 'x', roots: { app: '/' } } } }), /non-root/);
  assert.throws(() => normalizeConfig({ defaults: { maxBytes: 5 * 1024 * 1024 }, servers: {} }), /must not exceed/);
});

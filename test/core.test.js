import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConfig } from '../src/config.js';
import { assertCommandAllowed, buildSshArgs, commandName, parseCommand, resolveRemotePath, runSsh, shellQuote, testSshConnection } from '../src/remote.js';

const config = normalizeConfig({
  servers: {
    prod: {
      host: 'example.com',
      user: 'reader',
      identityFile: '~/.ssh/logs',
      allowedCommands: ['tail', 'grep', 'ls'],
      deniedCommands: ['rm', 'sudo'],
    },
  },
});
const server = config.servers.prod;

test('normalizes a command-policy SSH config', () => {
  assert.equal(server.port, 22);
  assert.equal(server.maxBytes, 128 * 1024);
  assert.deepEqual(server.allowedCommands, ['tail', 'grep', 'ls']);
  assert.deepEqual(server.deniedCommands, ['rm', 'sudo']);
});

test('allows only one allowlisted command and prioritizes deny rules', () => {
  assert.equal(commandName('tail -n 20 /var/log/app.log'), 'tail');
  assert.equal(assertCommandAllowed(server, 'tail -n 20 /var/log/app.log'), 'tail');
  assert.throws(() => assertCommandAllowed(server, 'rm file'), /denied/u);
  assert.throws(() => assertCommandAllowed(server, 'cat /etc/passwd'), /not allowed/u);
  assert.throws(() => assertCommandAllowed(server, 'tail file | grep error'), /shell control/u);
  assert.throws(() => assertCommandAllowed(server, 'tail file; rm file'), /shell control/u);
  assert.throws(() => assertCommandAllowed(server, 'tail $(id)'), /shell control/u);
});

test('quotes shell metacharacters as data', () => {
  assert.equal(shellQuote("a'b;$(id)"), "'a'\\''b;$(id)'");
});

test('builds constrained ssh arguments', () => {
  const args = buildSshArgs(server, 'tail -n 20 /var/log/app.log');
  assert.deepEqual(args.slice(0, 5), ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes']);
  assert.ok(args.includes(`UserKnownHostsFile=${server.knownHostsFile}`));
  assert.ok(args.includes('IdentitiesOnly=yes'));
  assert.equal(args.at(-2), 'reader@example.com');
  assert.equal(args.at(-1), 'tail -n 20 /var/log/app.log');
});

test('password SSH ignores configuration while preserving explicit options', () => {
  const args = buildSshArgs({ ...server, password: 'secret', port: 2222, knownHostsFile: '/tmp/known_hosts' }, 'true');
  assert.deepEqual(args.slice(0, 2), ['-F', '/dev/null']);
  assert.ok(args.includes('BatchMode=no'));
  assert.ok(args.includes('StrictHostKeyChecking=yes'));
  assert.ok(args.includes('UserKnownHostsFile=/tmp/known_hosts'));
  assert.equal(args[args.indexOf('-p') + 1], '2222');
  assert.equal(args[args.indexOf('-i') + 1], server.identityFile);
  assert.equal(buildSshArgs(server, 'true').includes('-F'), false);
});

test('blocks expansion, quotes arguments and enforces read-only mode', async () => {
  for (const command of ['tail ${PATH}', 'tail $HOME', 'tail $(id)', 'tail `id`', 'tail x;id', 'tail x\\\\;id', 'tail "unterminated']) {
    assert.throws(() => parseCommand(command));
  }
  assert.deepEqual(parseCommand('tail "file name" *.log'), ['tail', 'file name', '*.log']);
  assert.equal(parseCommand('tail *.log').map(shellQuote).join(' '), "'tail' '*.log'");
  await assert.rejects(runSsh(server, 'tail file'), /does not permit remote commands/u);
  const rooted = { ...server, roots: { app: '/srv/logs' } };
  assert.equal(resolveRemotePath(rooted, 'app', 'service.log'), '/srv/logs/service.log');
  assert.throws(() => resolveRemotePath(rooted, 'app', '../etc/passwd'), /stay inside/u);
});

test('rejects password with proxyJump in YAML configuration', () => {
  assert.throws(() => normalizeConfig({ servers: { prod: { host: 'x', password: 'secret', proxyJump: 'jump' } } }), /cannot be combined with proxyJump/);
  const value = normalizeConfig({ servers: { prod: { host: 'x', identityFile: '/tmp/key', proxyJump: 'jump' } } });
  assert.equal(value.servers.prod.proxyJump, 'jump');
});

test('execution rejects existing password and proxyJump state before spawning SSH', async () => {
  await assert.rejects(testSshConnection({ ...server, password: 'secret', proxyJump: 'jump' }), /cannot be combined with proxyJump/);
});

test('rejects unsafe or excessive config', () => {
  assert.deepEqual(normalizeConfig({ servers: { prod: { host: 'x' } } }).servers.prod.allowedCommands, []);
  assert.throws(() => normalizeConfig({ servers: { prod: { host: 'x', allowedCommands: ['tail;rm'] } } }), /executable command names/u);
  assert.throws(() => normalizeConfig({ defaults: { maxBytes: 5 * 1024 * 1024 }, servers: {} }), /must not exceed/u);
});

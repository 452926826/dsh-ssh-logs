import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { SshServerStore, normalizeStoredServer, publicServer } from '../src/store.js';

const input = { name: 'prod', host: '10.0.0.1', port: 22, user: 'deploy', password: 'secret', allowedCommands: ['tail', 'grep'], deniedCommands: ['rm'] };

test('stored configuration rejects password with proxyJump but permits keys', () => {
  assert.throws(() => normalizeStoredServer({ ...input, proxyJump: 'jump' }), /cannot be combined with proxyJump/);
  const key = normalizeStoredServer({ ...input, password: '', identityFile: '/tmp/key', proxyJump: 'jump' });
  assert.equal(key.proxyJump, 'jump');
  assert.equal(key.password, undefined);
});

test('SSH server policy defaults and password is never public', () => {
  const server = normalizeStoredServer(input);
  assert.equal(server.permission, 'read-only');
  assert.deepEqual(publicServer(server), { name: 'prod', host: '10.0.0.1', port: 22, user: 'deploy', hasPassword: true, permission: 'read-only', allowedCommands: ['tail', 'grep'], deniedCommands: ['rm'] });
});

test('editing with a blank password preserves the stored password', () => {
  const previous = normalizeStoredServer(input);
  assert.equal(normalizeStoredServer({ ...input, password: '' }, previous).password, 'secret');
  for (const change of [{ host: '10.0.0.2' }, { port: 23 }, { user: 'other' }, { proxyJump: 'jump.example.com' }]) {
    assert.throws(() => normalizeStoredServer({ ...input, password: '', ...change }, previous), /requires new credentials/);
  }
  const switchedKey = normalizeStoredServer({ ...input, password: '', identityFile: '/tmp/key' }, previous);
  assert.equal(switchedKey.password, undefined);
  assert.equal(normalizeStoredServer({ ...input, host: '10.0.0.2', password: 'new' }, previous).password, 'new');
});

test('updating a different host cannot retain the previous password', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-identity-'));
  const store = new SshServerStore(join(root, 'servers.json'));
  await store.upsert(input);
  await assert.rejects(store.upsert({ ...input, host: 'other.example.com', password: '' }, 'prod'), /requires new credentials/);
  assert.equal((await store.listRaw()).prod.host, input.host);
  assert.equal((await store.listRaw()).prod.password, 'secret');
});

test('settings state immediately overrides same-name legacy YAML servers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-merge-'));
  const yamlPath = join(root, 'legacy.yml');
  const statePath = join(root, 'servers.json');
  await writeFile(yamlPath, 'servers:\n  prod:\n    host: old.example.com\n    user: reader\n    identityFile: /tmp/key\n    allowedCommands: [tail]\n  legacy:\n    host: legacy.example.com\n    user: reader\n    identityFile: /tmp/key\n    allowedCommands: [grep]\n');
  await new SshServerStore(statePath).upsert(input);
  const merged = await loadConfig(yamlPath, statePath);
  assert.equal(merged.servers.prod.host, '10.0.0.1');
  assert.equal(merged.servers.prod.password, 'secret');
  assert.deepEqual(merged.servers.prod.allowedCommands, ['tail', 'grep']);
  assert.equal(merged.servers.legacy.host, 'legacy.example.com');
});

test('serializes concurrent server updates without losing entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-concurrent-'));
  const store = new SshServerStore(join(root, 'servers.json'));
  await Promise.all(Array.from({ length: 8 }, (_, index) => store.upsert({ ...input, name: `server-${index}`, host: `10.0.0.${index + 1}` })));
  assert.equal((await store.listPublic()).length, 8);
});

test('stores multiple servers in an owner-only file and supports deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ssh-store-'));
  const path = join(root, 'servers.json');
  const store = new SshServerStore(path);
  await store.upsert(input);
  await store.upsert({ ...input, name: 'stage', host: '10.0.0.2', permission: 'read-write' });
  assert.deepEqual((await store.listPublic()).map(server => server.name), ['prod', 'stage']);
  assert.equal(await store.remove('prod'), true);
  assert.equal(await store.remove('missing'), false);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.servers.stage.password, 'secret');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

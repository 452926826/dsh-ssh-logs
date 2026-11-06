import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createServerApi } from '../src/index.js';

function request(method, url, value) {
  const stream = Readable.from(value === undefined ? [] : [Buffer.from(JSON.stringify(value))]);
  stream.method = method;
  stream.url = url;
  stream.headers = { 'content-type': 'application/json' };
  return stream;
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(text) { this.value = JSON.parse(text); },
  };
}

const connection = { requestRejection() {} };
const input = { name: 'prod', host: '10.0.0.1', port: 22, user: 'root', password: 'secret', allowedCommands: ['tail'], deniedCommands: ['rm'] };

test('server API never returns passwords and defaults to read-only', async () => {
  const values = new Map();
  const store = {
    async listPublic() { return [...values.values()].map(({ password, ...server }) => ({ ...server, hasPassword: Boolean(password) })); },
    async upsert(value) { const server = { ...value, permission: value.permission ?? 'read-only' }; delete server.acknowledgeWriteRisk; values.set(server.name, server); const { password, ...publicValue } = server; return { ...publicValue, hasPassword: Boolean(password) }; },
    async remove(name) { return values.delete(name); },
  };
  const api = createServerApi(store, connection);
  const created = response();
  await api(request('POST', '/api/plugins/ssh-logs/servers', input), created);
  assert.equal(created.statusCode, 201);
  assert.equal(created.value.server.permission, 'read-only');
  assert.equal(created.value.server.password, undefined);
  const listed = response();
  await api(request('GET', '/api/plugins/ssh-logs/servers'), listed);
  assert.equal(listed.value.servers[0].password, undefined);
  assert.equal(listed.value.servers[0].hasPassword, true);
});

test('test-connection route validates the unsaved server without persisting it', async () => {
  const api = createServerApi({ async listRaw() { return {}; }, async upsert() { throw new Error('must not persist'); } }, connection);
  const result = response();
  await api(request('POST', '/api/plugins/ssh-logs/servers/test-connection', { name: 'probe', host: '127.0.0.1', port: 22, user: 'tester', allowedCommands: ['tail'] }), result);
  assert.equal(result.statusCode, 400);
  assert.match(result.value.error, /password or identityFile/u);
});

test('server API fails closed without admission and enforces JSON', async () => {
  for (const admission of [undefined, { requestRejection() { return 401; } }, { requestRejection() { return 403; } }]) {
    let touched = false;
    const api = createServerApi({ async listPublic() { touched = true; return []; } }, admission);
    const result = response();
    await api(request('GET', '/api/plugins/ssh-logs/servers'), result);
    assert.ok([401, 403, 503].includes(result.statusCode));
    assert.equal(touched, false);
  }
  const api = createServerApi({}, connection);
  const req = request('POST', '/api/plugins/ssh-logs/servers', input);
  req.headers = { 'content-type': 'text/plain' };
  const result = response();
  await api(req, result);
  assert.equal(result.statusCode, 415);
});

test('test connection refuses to reuse credentials for a different destination', async () => {
  const api = createServerApi({ async listRaw() { return { prod: input }; } }, connection);
  for (const change of [{ host: 'other.example.com' }, { user: 'other' }, { port: 23 }, { proxyJump: 'jump.example.com' }]) {
    const result = response();
    await api(request('POST', '/api/plugins/ssh-logs/servers/test-connection', { ...input, ...change, originalName: 'prod', password: '' }), result);
    assert.equal(result.statusCode, 400);
    assert.match(result.value.error, /requires new credentials/);
  }
});

test('server API rejects read-write without explicit acknowledgement', async () => {
  const api = createServerApi({ async upsert() { throw new Error('must not persist'); } }, connection);
  const denied = response();
  await api(request('POST', '/api/plugins/ssh-logs/servers', { ...input, permission: 'read-write' }), denied);
  assert.equal(denied.statusCode, 400);
  assert.match(denied.value.error, /acknowledgement/u);
});

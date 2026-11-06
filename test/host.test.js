import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { apply } from '../src/index.js';

test('Cordis 4.1 registers and removes the API with the webServer service', async () => {
  const ctx = new Context();
  let registrations = 0;
  const fiber = ctx.plugin({ apply });
  await fiber.await();
  assert.equal(registrations, 0);
  const disposeService = ctx.provide('webServer', {
    register(route) {
      assert.equal(route.kind, 'prefix');
      registrations++;
      return () => { registrations--; };
    },
  });
  const disposeConnection = ctx.provide('connection', { requestRejection() {} });
  await fiber.await();
  assert.equal(registrations, 1);
  await disposeConnection();
  assert.equal(registrations, 0);
  await disposeService();
  assert.equal(registrations, 0);
});

test('host plugin defers API registration until webServer is available', () => {
  let services;
  let route;
  const ctx = {
    inject(names, callback) { services = names; callback({ connection: { requestRejection() {} }, webServer: { register(value) { route = value; return () => {}; } }, effect(factory) { return factory(); } }); },
  };
  apply(ctx);
  assert.deepEqual(services, ['webServer', 'connection']);
  assert.equal(route.path, '/api/plugins/ssh-logs/servers');
  assert.equal(route.kind, 'prefix');
  assert.equal(typeof route.handler, 'function');
});

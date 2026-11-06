import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

test('client registers settings and abortable @ server completions', async () => {
  let plugin, source, tab;
  const rows = [{ name: 'production', user: 'reader', host: 'example.com', port: 22, allowedCommands: ['tail'] }];
  const context = {
    window: { __ModuleLoader__: { load(entry) { assert.equal(entry.id, 'dsh-ssh-logs'); plugin = entry.factory(() => ({})); } } },
    document: { querySelector() { return true; } },
    async fetch() { return { ok: true, async json() { return { servers: rows }; } }; },
  };
  vm.runInNewContext(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'), context);
  plugin.apply({
    effect(factory) { return factory(); },
    inputTriggers: { registerSource(value) { source = value; return () => {}; } },
    locale: { register() { return () => {}; } },
    slots: { inject(_name, callback) { callback(); }, register(value) { tab = value; } },
  });
  assert.equal(tab.name, 'settings.plugins.tab');
  assert.equal(source.trigger, '@');
  const controller = new AbortController();
  const candidates = await source.candidates({ sessionId: 'test' }, { query: 'PRO', signal: controller.signal });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].name, 'production');
  assert.equal(source.onPick({ candidate: candidates[0] }).text, '@production ');
  controller.abort();
  assert.equal((await source.candidates({}, { query: '', signal: controller.signal })).length, 0);
});

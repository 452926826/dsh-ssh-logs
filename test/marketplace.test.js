import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';

const root = new URL('../', import.meta.url);

test('declares an installable marketplace bundle', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const entry = YAML.parse(await readFile(new URL('marketplace-entry.yml', root), 'utf8'));
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.main, 'src/index.js');
  assert.equal(pkg.bin['dsh-ssh-logs'], 'src/server.js');
  assert.equal(pkg.engines.dsh, '>=0.2.2-rc.1 <0.3.0-0');
  assert.equal(pkg.peerDependencies['@deepseek-ai/cordis'], '^4.1.0');
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-host-webserver'], '>=0.2.2-rc.1 <0.3.0-0');
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-input-trigger'));
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'));
  assert.equal(entry.url, 'https://github.com/452926826/dsh-ssh-logs');
  assert.equal(entry.name, '452926826/dsh-ssh-logs');
  assert.equal(entry.category, 'remote');
  assert.match(entry.description.en, /\.$/);
  assert.match(entry.description.zh, /。$/);
  assert.equal(pkg.repository.url, `git+${entry.url}.git`);
  assert.ok(pkg.keywords.includes('dsh-plugin'));
});

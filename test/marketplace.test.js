import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';

const root = new URL('../', import.meta.url);

test('declares an installable marketplace bundle', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const entry = YAML.parse(await readFile(new URL('marketplace-entry.yml', root), 'utf8'));
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(entry.url, 'https://github.com/452926826/dsh-ssh-logs');
  assert.equal(entry.name, '452926826/dsh-ssh-logs');
  assert.equal(entry.category, 'remote');
  assert.match(entry.description.en, /\.$/);
  assert.match(entry.description.zh, /。$/);
  assert.equal(pkg.repository.url, `git+${entry.url}.git`);
  assert.ok(pkg.keywords.includes('dsh-plugin'));
});

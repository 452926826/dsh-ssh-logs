import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('resolves the MCP server through the installed package location', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.doesNotMatch(patch, /!!js\s+resolve\(/u)
  assert.match(patch, /createRequire\(baseUrl\)\.resolve\('dsh-ssh-logs\/package\.json'\)/u)
})

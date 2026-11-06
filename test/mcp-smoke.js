import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = await mkdtemp(path.join(tmpdir(), 'dsh-ssh-logs-'));
const bin = path.join(root, 'bin');
await mkdir(bin);
await writeFile(path.join(root, 'config.yml'), `servers:\n  test:\n    host: example.invalid\n    user: reader\n    roots: { app: /srv/logs }\n    allowedCommands: [tail, grep]\n    deniedCommands: [rm]\n  ops:\n    host: example.invalid\n    user: reader\n    permission: read-write\n    allowedCommands: [tail]\n`);
await writeFile(path.join(bin, 'ssh'), `#!/bin/sh
last=""
for arg in "$@"; do last="$arg"; done
case "$last" in
  tail*) printf 'recent line 1\\nrecent line 2\\n' ;;
  "'tail' 'file name' '*.log'") printf 'quoted argv\\n' ;;
  grep*) printf '42:request-id=abc\\n' ;;
  *) exit 9 ;;
esac
`, { mode: 0o755 });

async function connect(configPath) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('src/server.js')],
    cwd: process.cwd(),
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      DSH_SSH_LOGS_CONFIG: configPath,
    },
  });
  const client = new Client({ name: 'smoke', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}

const { client } = await connect(path.join(root, 'config.yml'));
try {
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  if (names.join(',') !== 'list_log_servers,read_log,run_remote_command,search_log') {
    throw new Error(`unexpected tools: ${names.join(',')}`);
  }
  const read = await client.callTool({
    name: 'read_log',
    arguments: { server: 'test', root: 'app', path: 'api.log', mode: 'tail', lines: 20 },
  });
  const readText = read.content?.[0]?.text ?? '';
  if (!readText.includes('recent line 2')) throw new Error(`unexpected command result: ${readText}`);
  const denied = await client.callTool({
    name: 'run_remote_command',
    arguments: { server: 'test', command: 'rm /srv/logs/api.log' },
  });
  if (!denied.isError || !(denied.content?.[0]?.text ?? '').includes('does not permit remote commands')) throw new Error(`unexpected denied result: ${JSON.stringify(denied)}`);
  const quoted = await client.callTool({ name: 'run_remote_command', arguments: { server: 'ops', command: 'tail "file name" *.log' } });
  if (quoted.isError || !(quoted.content?.[0]?.text ?? '').includes('quoted argv')) throw new Error(`unexpected quoted result: ${JSON.stringify(quoted)}`);
  const expansion = await client.callTool({ name: 'run_remote_command', arguments: { server: 'ops', command: 'tail ${PATH}' } });
  if (!expansion.isError) throw new Error('shell expansion was not rejected');
  console.log(`MCP smoke passed: ${names.join(', ')}`);
} finally {
  await client.close();
}

const { client: missingConfigClient } = await connect(path.join(root, 'missing.yml'));
try {
  const result = await missingConfigClient.callTool({ name: 'list_log_servers', arguments: {} });
  const text = result.content?.[0]?.text ?? '';
  if (!result.isError || !text.includes('No SSH servers are configured')) {
    throw new Error(`unexpected missing-config result: ${JSON.stringify(result)}`);
  }
  console.log('MCP missing-config behavior passed');
} finally {
  await missingConfigClient.close();
}

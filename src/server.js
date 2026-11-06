#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { readCommand, resolveRemotePath, runLogCommand, runSsh, searchCommand } from './remote.js';

const textResult = text => ({ content: [{ type: 'text', text }] });
const errorResult = error => ({ isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] });

async function activeServer(alias) {
  const config = await loadConfig();
  const server = config.servers[alias];
  if (!server) throw new Error(`unknown server ${JSON.stringify(alias)}`);
  return server;
}

const mcp = new McpServer({ name: 'dsh-ssh-logs', version: '0.3.0' });

mcp.tool('list_log_servers', 'List configured SSH servers and their command allow/deny policy. Credentials are never returned.', {}, async () => {
  try {
    const config = await loadConfig();
    return textResult(JSON.stringify(Object.values(config.servers).map(server => ({
      server: server.name,
      description: server.description,
      host: server.host,
      port: server.port,
      user: server.user,
      roots: server.roots ?? {},
      allowedCommands: server.allowedCommands,
      deniedCommands: server.deniedCommands,
    })), null, 2));
  } catch (error) { return errorResult(error); }
});

mcp.tool('run_remote_command', 'Run one allowlisted command on a configured SSH server. Denied commands always win. Shell control operators, pipes, redirections, and command substitution are rejected.', {
  server: z.string().describe('Configured SSH server alias'),
  command: z.string().min(1).max(4096).describe('One command and its arguments; no shell operators'),
  maxBytes: z.number().int().min(1).max(4 * 1024 * 1024).optional().describe('Maximum stdout bytes to return'),
}, async args => {
  try {
    const server = await activeServer(args.server);
    const output = await runSsh(server, args.command, args.maxBytes ?? server.maxBytes);
    return textResult(output);
  } catch (error) { return errorResult(error); }
});

mcp.tool('read_log', 'Read bounded log output under a configured root.', {
  server: z.string(), root: z.string(), path: z.string(),
  mode: z.enum(['tail', 'head', 'range']).default('tail'),
  lines: z.number().int().min(1).max(5000).default(200),
  startLine: z.number().int().min(1).optional(),
}, async args => {
  try {
    const server = await activeServer(args.server);
    const remotePath = resolveRemotePath(server, args.root, args.path);
    return textResult(await runLogCommand(server, readCommand(remotePath, args)));
  } catch (error) { return errorResult(error); }
});

mcp.tool('search_log', 'Search literal text under a configured log root.', {
  server: z.string(), root: z.string(), path: z.string(),
  pattern: z.string().min(1).max(500),
  ignoreCase: z.boolean().default(true),
  context: z.number().int().min(0).max(20).default(0),
  maxMatches: z.number().int().min(1).max(1000).default(200),
}, async args => {
  try {
    const server = await activeServer(args.server);
    const remotePath = resolveRemotePath(server, args.root, args.path);
    return textResult(await runLogCommand(server, searchCommand(remotePath, args.pattern, args)));
  } catch (error) { return errorResult(error); }
});

await mcp.connect(new StdioServerTransport());

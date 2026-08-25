#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { readCommand, resolveRemotePath, runSsh, searchCommand } from './remote.js';

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: 'text', text: message }] };
}

let config;
let configError;
try {
  config = await loadConfig();
} catch (error) {
  config = { servers: {} };
  configError = error instanceof Error ? error.message : String(error);
}

function requireConfig() {
  if (configError) {
    throw new Error(`SSH log configuration is unavailable: ${configError}. Create the file specified by DSH_SSH_LOGS_CONFIG and restart DSH.`);
  }
  return config;
}

const mcp = new McpServer({ name: 'dsh-ssh-logs', version: '0.1.0' });

mcp.tool(
  'list_log_servers',
  'List configured SSH server aliases and allowed log roots. Credentials and raw SSH options are never returned.',
  {},
  async () => {
    try {
      const activeConfig = requireConfig();
      return textResult(JSON.stringify(Object.values(activeConfig.servers).map((server) => ({
        server: server.name,
        description: server.description,
        roots: server.roots,
      })), null, 2));
    } catch (error) {
      return errorResult(error);
    }
  },
);

mcp.tool(
  'read_log',
  'Read a bounded section of a log file from an allowlisted SSH server and log root. Use tail by default for recent entries.',
  {
    server: z.string().describe('Configured server alias, for example production'),
    root: z.string().describe('Configured log root alias, for example app'),
    path: z.string().describe('Relative path below the log root, for example service/api.log'),
    mode: z.enum(['tail', 'head', 'range']).default('tail'),
    lines: z.number().int().min(1).max(5000).default(200),
    startLine: z.number().int().min(1).optional().describe('First line for range mode'),
  },
  async (args) => {
    try {
      const server = requireConfig().servers[args.server];
      if (!server) throw new Error(`unknown server ${JSON.stringify(args.server)}`);
      const remotePath = resolveRemotePath(server, args.root, args.path);
      const output = await runSsh(server, readCommand(remotePath, args));
      return textResult(`[${server.name}:${remotePath}]\n${output}`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

mcp.tool(
  'search_log',
  'Search literal text in a remote log file from an allowlisted SSH server and log root. The pattern is not interpreted as a regular expression or shell code.',
  {
    server: z.string().describe('Configured server alias'),
    root: z.string().describe('Configured log root alias'),
    path: z.string().describe('Relative path below the log root'),
    pattern: z.string().min(1).max(500).describe('Literal text to find'),
    ignoreCase: z.boolean().default(true),
    context: z.number().int().min(0).max(20).default(0),
    maxMatches: z.number().int().min(1).max(1000).default(200),
  },
  async (args) => {
    try {
      const server = requireConfig().servers[args.server];
      if (!server) throw new Error(`unknown server ${JSON.stringify(args.server)}`);
      const remotePath = resolveRemotePath(server, args.root, args.path);
      const output = await runSsh(server, searchCommand(remotePath, args.pattern, args));
      return textResult(`[${server.name}:${remotePath}] matches for ${JSON.stringify(args.pattern)}\n${output}`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

await mcp.connect(new StdioServerTransport());

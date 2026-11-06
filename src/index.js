import { join } from 'node:path';
import { testSshConnection } from './remote.js';
import { SshServerStore, normalizeStoredServer } from './store.js';

export const name = 'ssh-logs';

function json(response, status, value) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 256 * 1024) throw new Error('request body is too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length === 0 ? {} : JSON.parse(text);
}

export function createServerApi(store, connection) {
  return async (request, response) => {
      try {
        const rejection = connection?.requestRejection(request) ?? (connection ? undefined : 503);
        if (rejection !== undefined) return json(response, rejection, { error: 'Request not authorized' });
        if ((request.method === 'POST' || request.method === 'PUT') && String(request.headers?.['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          return json(response, 415, { error: 'Content-Type must be application/json' });
        }
        const url = new URL(request.url ?? '/', 'http://localhost');
        const suffix = url.pathname.slice('/api/plugins/ssh-logs/servers'.length).replace(/^\//u, '');
        const name = suffix.length > 0 ? decodeURIComponent(suffix) : undefined;
        if (request.method === 'POST' && name === 'test-connection') {
          const input = await body(request);
          const server = normalizeStoredServer(input, input.originalName ? (await store.listRaw())[input.originalName] : undefined);
          await testSshConnection({ ...server, connectTimeoutSeconds: 10, commandTimeoutMs: 30_000, maxBytes: 1024 });
          return json(response, 200, { ok: true, message: 'SSH连接成功。' });
        }
        if (request.method === 'GET' && name === undefined) return json(response, 200, { servers: await store.listPublic() });
        if (request.method === 'POST' && name === undefined) {
          const input = await body(request);
          if (input.permission === 'read-write' && input.acknowledgeWriteRisk !== true) return json(response, 400, { error: 'Read-write permission requires explicit risk acknowledgement.' });
          return json(response, 201, { server: await store.upsert(input) });
        }
        if (request.method === 'PUT' && name !== undefined) {
          const input = await body(request);
          if (input.permission === 'read-write' && input.acknowledgeWriteRisk !== true) return json(response, 400, { error: 'Read-write permission requires explicit risk acknowledgement.' });
          return json(response, 200, { server: await store.upsert(input, name) });
        }
        if (request.method === 'DELETE' && name !== undefined) return json(response, 200, { removed: await store.remove(name) });
        return json(response, 404, { error: 'Not found' });
      } catch (error) {
        return json(response, 400, { error: error instanceof Error ? error.message : String(error) });
      }
  };
}

export function apply(ctx) {
  const home = process.env.DSH_HOME ?? join(process.env.HOME ?? '.', '.dsh');
  const statePath = process.env.DSH_SSH_LOGS_STATE ?? join(home, 'ssh-logs', 'servers.json');
  const store = new SshServerStore(statePath);
  ctx.inject(['webServer', 'connection'], child => child.effect(() => child.webServer.register({
    kind: 'prefix',
    path: '/api/plugins/ssh-logs/servers',
    handler: createServerApi(store, child.connection),
  }), 'ssh-logs: server configuration API'));
}

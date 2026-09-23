import { readFile, lstat } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { connectionSchema } from './utils/connectionSchema';
import { EXTENSION_VERSION } from './constants';

/** Bridges Cursor's stdio MCP transport to the authenticated instance selected by its extension window. @example await runCursorMcpBridge('/private/current.connection.json') */
export async function runCursorMcpBridge(descriptorPath: string): Promise<void> {
  const identity = await lstat(descriptorPath);
  if (!identity.isFile() || identity.isSymbolicLink() || (identity.mode & 0o077) !== 0) throw new Error('Codebook connection descriptor is not a private regular file.');
  const descriptor = connectionSchema.parse(JSON.parse(await readFile(descriptorPath, 'utf8')));
  const connectUpstream = async () => {
    const client = new Client({ name: 'codebook-cursor-bridge', version: EXTENSION_VERSION });
    const http = new StreamableHTTPClientTransport(new URL(descriptor.url), { requestInit: { headers: { Authorization: `Bearer ${descriptor.token}` } } });
    try { await client.connect(http); }
    catch (error) {
      // Initialize may have allocated a server session before the later initialized notification fails.
      try { await http.terminateSession(); } catch { /* No session may have been established. */ }
      await client.close(); throw error;
    }
    return { client, http };
  };
  const closeUpstream = async (connection: Awaited<ReturnType<typeof connectUpstream>>) => {
    // Releasing the HTTP session immediately keeps short Cursor restarts below the server's session limit.
    try { await connection.http.terminateSession(); } catch { /* The session may already have expired. */ }
    await connection.client.close();
  };
  let active = await connectUpstream();
  let reconnecting: Promise<void> | undefined, closed = false;
  const forward = async <Value>(request: (client: Client) => Promise<Value>): Promise<Value> => {
    const previous = active;
    try { return await request(previous.client); }
    catch (error) {
      // The local server rejects an expired session before dispatch, so this exact 404 is safe to retry once.
      if (!(error instanceof StreamableHTTPError) || error.code !== 404 || !error.message.includes('Unknown MCP session')) throw error;
      if (active === previous) {
        reconnecting ??= (async () => {
          const next = await connectUpstream();
          if (closed) { await closeUpstream(next); throw new Error('Codebook Cursor MCP bridge has closed.'); }
          active = next;
          await closeUpstream(previous);
        })().finally(() => { reconnecting = undefined; });
        await reconnecting;
      } else if (reconnecting) await reconnecting;
      return request(active.client);
    }
  };
  const capabilities = active.client.getServerCapabilities();
  const server = new Server(active.client.getServerVersion() ?? { name: 'codebook', version: EXTENSION_VERSION }, {
    capabilities: { tools: capabilities?.tools ?? {}, resources: capabilities?.resources ?? {} }, instructions: active.client.getInstructions(),
  });
  server.setRequestHandler(ListToolsRequestSchema, request => forward(client => client.listTools(request.params)));
  server.setRequestHandler(CallToolRequestSchema, request => forward(client => client.callTool(request.params)));
  server.setRequestHandler(ListResourcesRequestSchema, request => forward(client => client.listResources(request.params)));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, request => forward(client => client.listResourceTemplates(request.params)));
  server.setRequestHandler(ReadResourceRequestSchema, request => forward(client => client.readResource(request.params)));
  const stdio = new StdioServerTransport();
  let stopping: Promise<void> | undefined;
  const shutdown = () => stopping ??= (async () => {
    closed = true;
    await reconnecting?.catch(() => undefined);
    try { await closeUpstream(active); } finally { await server.close(); }
  })();
  stdio.onclose = () => { void shutdown().catch(() => undefined); };
  try { await server.connect(stdio); }
  catch (error) { await closeUpstream(active); throw error; }
  // The SDK stdio transport does not close itself on stdin EOF, so release the HTTP session explicitly.
  process.stdin.once('end', () => { void shutdown().catch(() => undefined); });
  const stopForSignal = () => { void shutdown().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; }); };
  process.once('SIGTERM', stopForSignal);
  process.once('SIGINT', stopForSignal);
}

if (require.main === module) {
  const descriptorPath = process.argv[2];
  if (!descriptorPath) throw new Error('Codebook Cursor MCP bridge requires the current private connection descriptor.');
  void runCursorMcpBridge(descriptorPath).catch(() => {
    // Input-derived parse errors can contain descriptor fragments, so stderr must never echo the exception.
    console.error('Codebook Cursor MCP bridge could not connect. Run Codebook: Set Up AI Chat in this Cursor window.');
    process.exitCode = 1;
  });
}

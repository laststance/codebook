import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { request } from 'node:http';
import { httpStatus } from './utils/httpStatus';
import { startServer, type ConnectionDescriptor } from '../server';
import { PROFILE_ID, SESSION_IDLE_TIMEOUT_MS } from '../constants';
import { createHarness } from './helpers';

/** Connects the actual SDK client rather than emulating JSON-RPC in tests. @example const connected = await connect(endpoint.descriptor) */
async function connect(descriptor: ConnectionDescriptor) {
  const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), { requestInit: { headers: { Authorization: `Bearer ${descriptor.token}` } } });
  const client = new Client({ name: 'codebook-protocol-test', version: '1.0' });
  try { await client.connect(transport); }
  catch (error) { await client.close(); throw error; }
  return { client, transport, async close() { try { await transport.terminateSession(); } finally { await client.close(); } } };
}
const receiptSchema = z.object({ instanceId: z.string(), runId: z.string(), runUri: z.string() });

test('real MCP discovery, action and reconnect retain one runtime and one click after GET 405', async () => {
  // Arrange
  const harness = await createHarness(), endpoint = await startServer(harness.service), first = await connect(endpoint.descriptor);
  let second: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    // Act
    const discovery = await first.client.listTools(); const templates = await first.client.listResourceTemplates();
    const started = await first.client.callTool({ name: 'codebook_start', arguments: { instanceId: endpoint.descriptor.instanceId, profile: PROFILE_ID, key: 'study' } });
    const receipt = z.object({ data: receiptSchema }).parse(started.structuredContent).data;
    await harness.service.record(receipt).preparation;
    const arguments_ = { instanceId: receipt.instanceId, runId: receipt.runId, key: 'click', action: 'add-to-cart' };
    const accepted = await first.client.callTool({ name: 'codebook_action', arguments: arguments_ });
    await first.client.close();
    second = await connect(endpoint.descriptor);
    const repeated = await second.client.callTool({ name: 'codebook_action', arguments: arguments_ });
    const state = await second.client.readResource({ uri: receipt.runUri });
    // Assert
    assert.deepEqual(discovery.tools.map(tool => tool.name).sort(), ['codebook_action', 'codebook_continue', 'codebook_explain', 'codebook_reveal', 'codebook_start', 'codebook_status', 'codebook_stop']);
    assert.equal(templates.resourceTemplates.length, 6); assert.equal(accepted.isError, undefined);
    assert.deepEqual(repeated.structuredContent, accepted.structuredContent); assert.equal(harness.runtimes[0]?.dispatches, 1);
    assert.match(JSON.stringify(state), /paused-server/);
    const get = await fetch(endpoint.descriptor.url, { headers: { Authorization: `Bearer ${endpoint.descriptor.token}` } }); assert.equal(get.status, 405);
    const stopped = await second.client.callTool({ name: 'codebook_stop', arguments: { instanceId: receipt.instanceId, runId: receipt.runId } }); assert.equal(stopped.isError, undefined);
    const history = await second.client.readResource({ uri: receipt.runUri }); assert.match(JSON.stringify(history), /stopped/);
  } finally { await first.client.close(); await second?.close(); await endpoint.close(); await harness.close(); }
});

test('authentication and Host Origin body boundaries reject requests even with a valid transport session', async () => {
  // Arrange
  const harness = await createHarness(), endpoint = await startServer(harness.service), connection = await connect(endpoint.descriptor);
  try {
    const authorization = `Bearer ${endpoint.descriptor.token}`, sessionId = connection.transport.sessionId!;
    const headers = { Authorization: authorization, 'mcp-session-id': sessionId, 'content-type': 'application/json', Accept: 'application/json, text/event-stream' };
    // Act / Assert
    assert.equal((await fetch(endpoint.descriptor.url, { method: 'POST', body: '{}', headers: { ...headers, Authorization: 'Bearer incorrect' } })).status, 401);
    assert.equal(await httpStatus(endpoint.descriptor.url, { ...headers, Host: 'evil.example' }, '{}'), 403);
    assert.equal((await fetch(endpoint.descriptor.url, { method: 'POST', body: '{}', headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(endpoint.descriptor.url, { method: 'POST', body: 'x'.repeat(65_537), headers })).status, 413);
    assert.equal(harness.runtimes.length, 0);
    const status = await connection.client.callTool({ name: 'codebook_status', arguments: {} }); assert.equal(z.object({ ok: z.boolean() }).parse(status.structuredContent).ok, true);
  } finally { await connection.close(); await endpoint.close(); await harness.close(); }
});

test('foreign instance and run errors are structured domain failures and invalid tool arguments dispatch nothing', async () => {
  // Arrange
  const harness = await createHarness(), endpoint = await startServer(harness.service), connection = await connect(endpoint.descriptor);
  try {
    // Act
    const foreign = await connection.client.callTool({ name: 'codebook_start', arguments: { instanceId: 'eeb4a708-853e-4f38-8eac-ddf6d1415f14', profile: PROFILE_ID, key: 'wrong' } });
    const invalid = await connection.client.callTool({ name: 'codebook_start', arguments: { instanceId: endpoint.descriptor.instanceId, profile: PROFILE_ID, key: '', arbitrary: 'eval' } });
    // Assert
    assert.equal(foreign.isError, true); assert.match(JSON.stringify(foreign.structuredContent), /STALE_INSTANCE/); assert.equal(invalid.isError, true); assert.equal(harness.runtimes.length, 0);
  } finally { await connection.close(); await endpoint.close(); await harness.close(); }
});

test('eight idle MCP clients exhaust capacity but expiry releases their slots without stopping a paused run', async () => {
  // Arrange
  let now = 0; const harness = await createHarness(), endpoint = await startServer(harness.service, () => now);
  const connections: Awaited<ReturnType<typeof connect>>[] = [];
  try {
    for (let index = 0; index < 8; index += 1) connections.push(await connect(endpoint.descriptor));
    const receipt = harness.service.start({ instanceId: harness.service.instanceId, profile: PROFILE_ID, key: 'retained' });
    await harness.service.record(receipt).preparation; harness.service.action({ ...receipt, key: 'click', action: 'add-to-cart' });
    // Act / Assert
    await assert.rejects(connect(endpoint.descriptor), /MCP session limit exceeded/);
    now = SESSION_IDLE_TIMEOUT_MS + 1; endpoint.expire();
    const recovered = await connect(endpoint.descriptor); connections.push(recovered);
    assert.equal(harness.runtimes[0]?.stopped, false); assert.equal(harness.runtimes[0]?.dispatches, 1);
    const result = await recovered.client.readResource({ uri: receipt.runUri }); assert.match(JSON.stringify(result), /paused-server/);
  } finally { await Promise.allSettled(connections.map(connection => connection.client.close())); await endpoint.close(); await harness.close(); }
});

test('a stalled authenticated body reaches its read deadline without dispatching a tool', async () => {
  // Arrange
  const harness = await createHarness(), endpoint = await startServer(harness.service);
  try {
    // Act: send a partial JSON body and deliberately never end it.
    const status = await new Promise<number>((resolve, reject) => {
      const pending = request(endpoint.descriptor.url, { method: 'POST', headers: { Authorization: `Bearer ${endpoint.descriptor.token}`, 'content-type': 'application/json' } }, response => {
        response.resume(); response.once('end', () => resolve(response.statusCode ?? 0)); response.once('error', reject);
      });
      pending.once('error', reject); pending.write('{');
    });
    // Assert
    assert.equal(status, 408); assert.equal(harness.runtimes.length, 0);
  } finally { await endpoint.close(); await harness.close(); }
});

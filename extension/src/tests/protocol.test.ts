import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { request } from 'node:http';
import { connect as connectSocket } from 'node:net';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
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
    assert.deepEqual(discovery.tools.map(tool => tool.name).sort(), ['codebook_action', 'codebook_continue', 'codebook_explain', 'codebook_playback', 'codebook_reveal', 'codebook_start', 'codebook_status', 'codebook_stop']);
    assert.equal(templates.resourceTemplates.length, 13); assert.equal(accepted.isError, undefined);
    assert.deepEqual(repeated.structuredContent, accepted.structuredContent); assert.equal(harness.runtimes[0]?.dispatches, 1);
    assert.match(JSON.stringify(state), /paused-server/);
    const get = await fetch(endpoint.descriptor.url, { headers: { Authorization: `Bearer ${endpoint.descriptor.token}` } }); assert.equal(get.status, 405);
    const stopped = await second.client.callTool({ name: 'codebook_stop', arguments: { instanceId: receipt.instanceId, runId: receipt.runId } }); assert.equal(stopped.isError, undefined);
    const history = await second.client.readResource({ uri: receipt.runUri }); assert.match(JSON.stringify(history), /stopped/);
  } finally { await first.client.close(); await second?.close(); await endpoint.close(); await harness.close(); }
});

test('MCP checkout discovers its action order and preserves the first receipt and observation after the second action', async () => {
  // Arrange: real HTTP/SDK/service, explicitly synthetic editor effects.
  const harness = await createHarness(), endpoint = await startServer(harness.service), connection = await connect(endpoint.descriptor);
  try {
    const discovery = await connection.client.callTool({ name: 'codebook_status', arguments: {} });
    const catalog = z.object({ data: z.object({ apiVersion: z.string(), profiles: z.array(z.object({ id: z.string(), actions: z.array(z.object({ id: z.string() })), items: z.array(z.object({ id: z.string() })), limits: z.object({ runTimeoutMs: z.number() }) })) }) }).parse(discovery.structuredContent).data;
    assert.equal(catalog.apiVersion, '1.2');
    const checkout = catalog.profiles.find(profile => profile.id === 'checkout-demo')!;
    assert.deepEqual(checkout.actions.map(action => action.id), ['add-to-cart', 'checkout']); assert.equal(checkout.items.length, 4); assert.equal(checkout.limits.runTimeoutMs, 300_000);
    const started = await connection.client.callTool({ name: 'codebook_start', arguments: { instanceId: endpoint.descriptor.instanceId, profile: 'checkout-demo', key: 'purchase' } });
    const receipt = z.object({ data: receiptSchema }).parse(started.structuredContent).data;
    const record = harness.service.record(receipt); await record.preparation;
    const identity = { instanceId: receipt.instanceId, runId: receipt.runId };
    const runtime = harness.runtimes[0]!; assert.equal(runtime.profile, 'checkout-demo');
    // Act / Assert: supported action in the wrong order is a recoverable domain error, not schema rejection.
    const early = await connection.client.callTool({ name: 'codebook_action', arguments: { ...identity, key: 'early', action: 'checkout' } });
    assert.equal(early.isError, true); assert.match(JSON.stringify(early.structuredContent), /BUSY.*Expected add-to-cart/); assert.equal(runtime.dispatches, 0);
    const firstInput = { ...identity, key: 'cart', action: 'add-to-cart' };
    const first = await connection.client.callTool({ name: 'codebook_action', arguments: firstInput });
    const original = harness.service.state(record).observations[0]!;
    const originalPause = harness.service.state(record).participants.server.continueArguments!;
    const originalBytes = await connection.client.readResource({ uri: original.snapshotUri });
    await connection.client.callTool({ name: 'codebook_continue', arguments: originalPause });
    runtime.status = 'ready'; // Synthetic completion boundary; the native matrix verifies actual cart completion.
    const second = await connection.client.callTool({ name: 'codebook_action', arguments: { ...identity, key: 'order', action: 'checkout' } }); assert.equal(second.isError, undefined);
    assert.equal(runtime.dispatches, 2); assert.equal(harness.service.state(record).observations.length, 2);
    assert.deepEqual(await connection.client.readResource({ uri: original.snapshotUri }), originalBytes);
    const replay = await connection.client.callTool({ name: 'codebook_action', arguments: firstInput }); assert.deepEqual(replay.structuredContent, first.structuredContent);
    const conflict = await connection.client.callTool({ name: 'codebook_action', arguments: { ...identity, key: 'cart', action: 'checkout' } }); assert.match(JSON.stringify(conflict.structuredContent), /IDEMPOTENCY_CONFLICT/);
    const stale = await connection.client.callTool({ name: 'codebook_continue', arguments: originalPause }); assert.match(JSON.stringify(stale.structuredContent), /STALE_PAUSE/);
    assert.equal(runtime.dispatches, 2);
    await connection.client.callTool({ name: 'codebook_stop', arguments: identity });
    assert.deepEqual((await connection.client.callTool({ name: 'codebook_action', arguments: firstInput })).structuredContent, first.structuredContent);
  } finally { await connection.close(); await endpoint.close(); await harness.close(); }
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

test('an incomplete HTTP header is rejected near the five-second read deadline before authentication', async () => {
  // Arrange
  const harness = await createHarness(), endpoint = await startServer(harness.service), address = new URL(endpoint.descriptor.url);
  const socket = connectSocket(Number(address.port), address.hostname); let response = '', closed = false;
  socket.on('data', bytes => { response += bytes.toString(); }); socket.on('close', () => { closed = true; }); socket.on('error', () => {});
  try {
    // Act
    socket.write('POST /mcp HTTP/1.1\r\n');
    await waitUntil(() => closed, 'incomplete header expires', 6_000);
    // Assert
    assert.match(response, /^HTTP\/1\.1 408 Request Timeout/); assert.equal(harness.runtimes.length, 0);
  } finally { socket.destroy(); await endpoint.close(); await harness.close(); }
});

test('deleting an in-flight MCP session settles its HTTP response and preserves capacity and the paused study', async () => {
  // Arrange
  const harness = await createHarness(), endpoint = await startServer(harness.service);
  const receipt = harness.service.start({ instanceId: harness.service.instanceId, profile: PROFILE_ID, key: 'study' });
  await harness.service.record(receipt).preparation; harness.service.action({ ...receipt, key: 'click', action: 'add-to-cart' });
  try {
    // Act: exceed the global thirty-two-request capacity through normal session deletion.
    for (let index = 0; index < 36; index += 1) {
      let entered = false, settled = false, release!: () => void;
      const barrier = new Promise<void>(resolve => { release = resolve; });
      harness.service.environment.prerequisites = async () => { entered = true; await barrier; return { ready: true, missing: [] }; };
      const connection = await connect(endpoint.descriptor);
      const pending = connection.client.callTool({ name: 'codebook_status', arguments: {} }).then(() => 'unexpected success', () => 'closed').finally(() => { settled = true; });
      try {
        await waitUntil(() => entered, 'held status', 1_000);
        await connection.transport.terminateSession();
        await waitUntil(() => settled, 'deleted response settles before handler completes', 1_000);
        assert.equal(await pending, 'closed');
      } finally { release(); await connection.client.close(); }
    }
    // Assert
    const recovered = await connect(endpoint.descriptor);
    try { assert.equal((await recovered.client.listTools()).tools.length, 8); }
    finally { await recovered.close(); }
    assert.equal(harness.runtimes[0]?.dispatches, 1); assert.equal(harness.runtimes[0]?.stopped, false);
  } finally { await endpoint.close(); await harness.close(); }
});

test('cancelled MCP calls release HTTP capacity without closing their shared session', async () => {
  // Arrange
  const harness = await createHarness(), endpoint = await startServer(harness.service), connection = await connect(endpoint.descriptor);
  try {
    // Act: cancellation suppresses handler responses, so transport cleanup must settle each POST.
    for (let index = 0; index < 36; index += 1) {
      let entered = false, release!: () => void;
      const barrier = new Promise<void>(resolve => { release = resolve; });
      harness.service.environment.prerequisites = async () => { entered = true; await barrier; return { ready: true, missing: [] }; };
      const abort = new AbortController();
      const pending = assert.rejects(connection.client.callTool({ name: 'codebook_status', arguments: {} }, undefined, { signal: abort.signal }));
      try { await waitUntil(() => entered, 'held cancellable status', 1_000); abort.abort(); await pending; }
      finally { release(); }
      assert.equal((await connection.client.listTools()).tools.length, 8);
    }
    // Assert
    assert.equal((await connection.client.listResourceTemplates()).resourceTemplates.length, 13);
    assert.equal(harness.runtimes.length, 0);
  } finally { await connection.close(); await endpoint.close(); await harness.close(); }
});

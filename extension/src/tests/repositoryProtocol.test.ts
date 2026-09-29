import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { sha256 } from '../runtimeSupport/utils/sha256';
import { waitUntil } from '../runtimeSupport/utils/waitUntil';
import { createHarness } from './helpers';
import { LearningLibrary } from '../learningLibrary';
import { RepositoryBookStore } from '../repositoryBook';
import { RepositorySourceService } from '../repositorySource';
import { startServer } from '../server';
import { readResource } from '../resources';
import { type BookDocument } from '../repositorySchemas';
import { StudyError } from '../errors';

const executeFile = promisify(execFile), sourceHash = '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b';

/** Connects actual MCP/HTTP/SDK boundaries to real tracked files while leaving all runtime prerequisites absent. @example const harness = await repositoryProtocolHarness() */
async function repositoryProtocolHarness() {
  const harness = await createHarness({ prerequisites: async () => ({ ready: false, missing: ['Chrome and debugger are unavailable.'] }) });
  await executeFile('git', ['init', '--quiet', harness.directory]); await writeFile(join(harness.directory, 'module.ts'), 'export const price = 24;\n');
  await executeFile('git', ['add', '--', 'module.ts'], { cwd: harness.directory });
  const library = new LearningLibrary(join(harness.directory, 'learning'), sha256(harness.directory));
  harness.service.repository = new RepositoryBookStore(new RepositorySourceService(harness.directory), library);
  const endpoint = await startServer(harness.service), transport = new StreamableHTTPClientTransport(new URL(endpoint.descriptor.url), { requestInit: { headers: { Authorization: `Bearer ${endpoint.descriptor.token}` } } });
  const client = new Client({ name: 'repository-protocol-test', version: '1.0' }); await client.connect(transport);
  return { ...harness, library, endpoint, client, transport, async close() { try { await transport.terminateSession(); } finally { await client.close(); await endpoint.close(); await harness.close(); } } };
}

/** Constructs a schema-valid ASCII document of an exact byte size to exercise transport and document limits separately. @example sizedDocument(1048576) */
function sizedDocument(bytes: number): BookDocument {
  const document: BookDocument = { title: 'Repository source', summary: 'Source interpretation', nodes: Array.from({ length: 10 }, (_, index) => ({ id: `node-${index}`, title: `Node ${index}`,
    sections: Array.from({ length: 10 }, (_, section) => ({ title: `Section ${section}`, text: 'x' })), anchors: [{ path: 'module.ts', hash: sourceHash, startLine: 1, endLine: 2 }], observations: [] })), edges: [] };
  for (const node of document.nodes) for (const section of node.sections) {
    const remaining = bytes - Buffer.byteLength(JSON.stringify(document)); if (remaining <= 0) return document;
    section.text += 'x'.repeat(Math.min(11_999, remaining));
  }
  return document;
}

test('installed SDK advertises object-shaped repository tools and source-only authoring works without runtime prerequisites', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness();
  try {
    const instanceId = harness.service.instanceId, discovery = await harness.client.listTools();
    // Act
    const status = await harness.client.callTool({ name: 'codebook_status', arguments: {} });
    const catalog = await harness.client.callTool({ name: 'codebook_sources', arguments: { instanceId } });
    const source = await harness.client.callTool({ name: 'codebook_source', arguments: { instanceId, path: 'module.ts' } });
    // Assert
    for (const name of ['codebook_sources', 'codebook_source', 'codebook_publish_book', 'codebook_open_book']) assert.equal(discovery.tools.find(tool => tool.name === name)?.inputSchema.type, 'object');
    const state = z.object({ data: z.object({ prerequisites: z.object({ ready: z.boolean() }), repository: z.object({ ready: z.boolean(), limits: z.object({ booksPerWorkspace: z.number() }) }) }) }).parse(status.structuredContent).data;
    assert.equal(state.prerequisites.ready, false); assert.equal(state.repository.ready, true);
    assert.equal(state.repository.limits.booksPerWorkspace, 64, 'agents can distinguish 16 retained books from the current admission limit');
    assert.equal(catalog.isError, undefined); assert.match(JSON.stringify(catalog), /module.ts/); assert.match(JSON.stringify(source), /5e707638ceba927d6f/);
    assert.equal(harness.runtimes.length, 0); assert.equal((await harness.library.readProgress()).decisions.length, 0);
  } finally { await harness.close(); }
});

test('the exact one-MiB document plus JSON-RPC envelope reaches publication while document and transport overflow retain old bytes', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness();
  try {
    const instanceId = harness.service.instanceId, document = sizedDocument(1_048_576), arguments_ = { instanceId, bookId: 'real-source', key: 'large', expectedRevision: 0, document };
    assert.equal(Buffer.byteLength(JSON.stringify(document)), 1_048_576);
    // Act
    const published = await harness.client.callTool({ name: 'codebook_publish_book', arguments: arguments_ });
    assert.equal(published.isError, undefined, JSON.stringify(published));
    const before = await readFile(join(harness.library.directory, 'real-source.book.v2.json'));
    const rejected = await harness.client.callTool({ name: 'codebook_publish_book', arguments: { ...arguments_, key: 'overflow', expectedRevision: 1, document: sizedDocument(1_048_577) } });
    const response = await fetch(harness.endpoint.descriptor.url, { method: 'POST', headers: { Authorization: `Bearer ${harness.endpoint.descriptor.token}`, 'mcp-session-id': harness.transport.sessionId!, 'content-type': 'application/json', Accept: 'application/json, text/event-stream' }, body: 'x'.repeat(1_114_113) });
    // Assert
    assert.equal(rejected.isError, true); assert.match(JSON.stringify(rejected), /LIMIT_EXCEEDED/); assert.equal(response.status, 413);
    assert.deepEqual(await readFile(join(harness.library.directory, 'real-source.book.v2.json')), before);
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('explicit MCP cancellation during preparation prevents a new publication while leaving the connection and retained bytes usable', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness(), store = harness.service.repository!;
  let release = () => {}, enter = () => {}, signal: AbortSignal | undefined;
  const held = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
  try {
    const input = { instanceId: harness.service.instanceId, bookId: 'source', key: 'first', expectedRevision: 0, document: sizedDocument(72_000) };
    await harness.client.callTool({ name: 'codebook_publish_book', arguments: input }); const before = await readFile(join(harness.library.directory, 'source.book.v2.json'));
    const prepare = store.sources.prepare.bind(store.sources);
    store.sources.prepare = async (...arguments_: Parameters<typeof prepare>) => { const result = await prepare(...arguments_); signal = arguments_[1]?.signal; enter(); await held; return result; };
    const cancellation = new AbortController();
    // Act
    const pending = harness.client.callTool({ name: 'codebook_publish_book', arguments: { ...input, key: 'cancelled', expectedRevision: 1 } }, undefined, { signal: cancellation.signal });
    const rejected = assert.rejects(pending, /Abort|cancel/i); await entered; cancellation.abort(); await rejected;
    await waitUntil(() => signal?.aborted, 'request cancellation reached preparation', 2_000); release(); await store.flush();
    // Assert
    assert.deepEqual(await readFile(join(harness.library.directory, 'source.book.v2.json')), before);
    assert.equal((await harness.client.listTools()).tools.length, 16); assert.equal(harness.runtimes.length, 0);
  } finally { release(); await harness.close(); }
});

test('public retry and immutable source resources survive a lost response followed by source deletion', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness();
  try {
    const input = { instanceId: harness.service.instanceId, bookId: 'source', key: 'one', expectedRevision: 0, document: sizedDocument(72_000) };
    const published = await harness.client.callTool({ name: 'codebook_publish_book', arguments: input });
    const receipt = z.object({ data: z.object({ uri: z.string(), revision: z.number() }) }).parse(published.structuredContent).data;
    // Act
    await rm(join(harness.directory, 'module.ts'));
    const repeated = await harness.client.callTool({ name: 'codebook_publish_book', arguments: input });
    const book = await harness.client.readResource({ uri: receipt.uri });
    const captured = await harness.client.readResource({ uri: `${receipt.uri}/sources/0` });
    // Assert
    assert.deepEqual(repeated.structuredContent, published.structuredContent); assert.equal(receipt.revision, 1);
    assert.match(JSON.stringify(book), /Source-derived/); assert.match(JSON.stringify(captured), /export const price = 24/);
    assert.equal((await harness.library.readProgress()).decisions.length, 0); assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('MCP cancellation reaches an accepted article open before pending reader work can reveal source', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness(); let release = () => {}, enter = () => {}, signal: AbortSignal | undefined, opened = false;
  const entered = new Promise<void>(resolve => { enter = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
  harness.service.repositoryReader = async (input, cancellation) => { signal = cancellation; enter(); await waiting; cancellation.throwIfAborted(); opened = true; return { ...input, anchorIndex: 0, sourceUri: 'captured-source' }; };
  try {
    const cancellation = new AbortController();
    // Act
    const pending = harness.client.callTool({ name: 'codebook_open_book', arguments: { instanceId: harness.service.instanceId, bookId: 'source', revision: 1, nodeId: 'node-0' } }, undefined, { signal: cancellation.signal });
    const rejected = assert.rejects(pending, /Abort|cancel/i); await entered; cancellation.abort(); await rejected;
    await waitUntil(() => signal?.aborted, 'MCP cancellation reaches article reader', 2_000); release();
    // Assert
    assert.equal((await harness.client.listTools()).tools.length, 16); assert.equal(opened, false); assert.equal(harness.runtimes.length, 0);
  } finally { release(); await harness.close(); }
});

test('Stop Agent Server cancels and drains pending article navigation before retirement completes', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness(); let release = () => {}, enter = () => {}, signal: AbortSignal | undefined;
  const entered = new Promise<void>(resolve => { enter = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; }), effects: string[] = [];
  harness.service.repositoryReader = async (input, cancellation) => { signal = cancellation; enter(); await waiting; effects.push('reader-settled'); cancellation.throwIfAborted(); effects.push('source-opened'); return { ...input, anchorIndex: 0, sourceUri: 'captured-source' }; };
  try {
    // Act
    const pending = harness.service.openBook({ instanceId: harness.service.instanceId, bookId: 'source', revision: 1, nodeId: 'node-0' });
    const rejected = assert.rejects(pending, /Abort/); await entered;
    const shutdown = harness.service.shutdown().then(() => { effects.push('shutdown-completed'); });
    await Promise.resolve(); assert.equal(signal?.aborted, true); assert.deepEqual(effects, []);
    release(); await rejected; await shutdown;
    // Assert
    assert.deepEqual(effects, ['reader-settled', 'shutdown-completed']); assert.equal(harness.runtimes.length, 0);
  } finally { release(); await harness.close(); }
});

test('foreign identities, changed workspace ownership and malformed repository URIs cannot read or write another target', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness();
  try {
    const instanceId = harness.service.instanceId;
    // Act / Assert
    const foreign = await harness.client.callTool({ name: 'codebook_sources', arguments: { instanceId: '11111111-1111-4111-8111-111111111111' } });
    assert.equal(foreign.isError, true); assert.match(JSON.stringify(foreign), /STALE_INSTANCE/);
    for (const suffix of ['books/source/01', 'books/source/1/sources/-1', 'books/source/1?current=true', 'books/source/1/sources/9007199254740992']) await assert.rejects(readResource(harness.service, `codebook://${instanceId}/${suffix}`));
    harness.service.environment.assertWorkspace = () => { throw new StudyError('STALE_INSTANCE', 'Workspace changed.'); };
    const changed = await harness.client.callTool({ name: 'codebook_source', arguments: { instanceId, path: 'module.ts' } });
    assert.equal(changed.isError, true); assert.match(JSON.stringify(changed), /STALE_INSTANCE/);
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

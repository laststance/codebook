import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { ReplayDebugAdapter } from '../replayDebugAdapter';
import { replayDebugSnapshotSchema, type ReplayDebugSnapshot } from '../replayDebugSchemas';
import { captureReplayDebugSnapshot } from '../utils/captureReplayDebugSnapshot';
import { shouldCaptureNodeHistoryScope } from '../utils/shouldCaptureNodeHistoryScope';
import { sha256 } from '../runtimeSupport/utils/sha256';
import { REPLAY_DEBUG_MAX_VARIABLES } from '../constants';

const source = { name: 'app/lib/actions.ts', text: 'const amountInCents = amount * 100;', hash: sha256('const amountInCents = amount * 100;'), line: 1 };
const stack: DebugProtocol.StackTraceResponse['body'] = { stackFrames: [{ id: 77, name: 'createInvoice', line: 1, column: 1 }], totalFrames: 1 };
/** Builds isolated historical data for protocol behavior tests, never an executable target. @example recorded().frames[0]?.name */
function recorded(): ReplayDebugSnapshot {
  return { version: 1, frames: [{ name: 'createInvoice', line: 1, column: 1, source: { ...source }, scopes: [{ name: 'Locals', variables: [0] }] }],
    variables: [{ name: 'amount', value: '120', type: 'number', children: [] }], limitations: [] };
}
/** Drives protocol messages without VS Code or any live debug connection. @example harness().request('threads').success */
function harness() {
  const messages: (DebugProtocol.Response | DebugProtocol.Event)[] = [];
  const adapter = new ReplayDebugAdapter(message => messages.push(message));
  let sequence = 0;
  return { adapter, messages, request(command: string, arguments_?: unknown): DebugProtocol.Response {
    const requestSequence = ++sequence;
    adapter.handleMessage({ seq: requestSequence, type: 'request', command, arguments: arguments_ });
    const response = messages.find(message => 'request_seq' in message && message.request_seq === requestSequence);
    assert.ok(response && 'request_seq' in response); return response;
  } };
}

test('historical stack, source and values remain inspectable without a live debugger', () => {
  // Arrange
  const { adapter, request } = harness(); adapter.select(recorded(), 'Recorded · 00:42');
  // Act
  const frames = request('stackTrace', { threadId: 1 }).body.stackFrames;
  const scopes = request('scopes', { frameId: frames[0].id }).body.scopes;
  const variables = request('variables', { variablesReference: scopes[0].variablesReference }).body.variables;
  // Assert
  assert.equal(frames[0].name, 'createInvoice'); assert.equal(frames[0].source.path, undefined);
  assert.equal(request('source', { sourceReference: frames[0].source.sourceReference }).body.content, 'const amountInCents = amount * 100;');
  assert.deepEqual(variables, [{ name: 'amount', value: '120', type: 'number', variablesReference: 0 }]);
});

test('matching recorded source opens at its immutable native document URI', () => {
  // Arrange
  const { adapter, request } = harness(), uri = `codebook-source://workspace/node-history/run/23/${source.hash}/Captured-actions.ts`;
  adapter.select(recorded(), 'Recorded Node test stop', { uri, hash: source.hash });

  // Act
  const frame = request('stackTrace', { threadId: 1 }).body.stackFrames[0]!;

  // Assert
  assert.equal(frame.source.path, uri);
  assert.equal(frame.source.sourceReference, 0, 'matching captured source is resolved by the native workspace URI');
});

test('seeking invalidates prior frame, source and variable handles even when revisiting identical history', () => {
  // Arrange
  const { adapter, request } = harness(); adapter.select(recorded(), 'First visit');
  const frame = request('stackTrace', { threadId: 1 }).body.stackFrames[0];
  const reference = request('scopes', { frameId: frame.id }).body.scopes[0].variablesReference;
  // Act
  adapter.select(recorded(), 'Second visit');
  // Assert
  assert.equal(request('scopes', { frameId: frame.id }).success, false);
  assert.equal(request('source', { sourceReference: frame.source.sourceReference }).success, false);
  assert.equal(request('variables', { variablesReference: reference }).success, false);
  assert.notEqual(request('stackTrace', { threadId: 1 }).body.stackFrames[0].id, frame.id);
});

test('missing history clears native stack and labels the selected moment truthfully', () => {
  // Arrange
  const { adapter, request, messages } = harness(); adapter.select(recorded(), 'Recorded'); request('configurationDone');
  // Act
  adapter.select(undefined, 'Not recorded at this moment');
  // Assert
  assert.deepEqual(request('stackTrace', { threadId: 2 }).body, { stackFrames: [], totalFrames: 0 });
  assert.deepEqual(request('threads').body, { threads: [{ id: 2, name: 'Not recorded at this moment' }] });
  assert.ok(messages.some(message => 'event' in message && message.event === 'stopped' && message.body.description === 'Not recorded at this moment'));
});

test('seeking retires the focused historical thread before a gap can retain native variable rows', () => {
  // Arrange
  const { adapter, request, messages } = harness(); adapter.select(recorded(), 'Recorded'); request('configurationDone');
  messages.length = 0;
  // Act
  adapter.select(undefined, 'Not recorded at this moment');
  // Assert
  assert.deepEqual(messages.map(message => 'event' in message ? { event: message.event, body: message.body } : {}), [
    { event: 'invalidated', body: { areas: ['variables'] } },
    { event: 'continued', body: { threadId: 1, allThreadsContinued: false } },
    { event: 'thread', body: { reason: 'started', threadId: 2 } },
    { event: 'stopped', body: { reason: 'pause', description: 'Not recorded at this moment', threadId: 2, allThreadsStopped: true } },
  ]);
});

test('leaving a recorded stop empties the still-focused native Variables before a newer moment can pair with old values', () => {
  // Arrange
  const { adapter, request, messages } = harness(); adapter.select(recorded(), 'Recorded · 21.82 s'); request('configurationDone');
  const frame = request('stackTrace', { threadId: 1 }).body.stackFrames[0];
  const reference = request('scopes', { frameId: frame.id }).body.scopes[0].variablesReference;
  messages.length = 0;
  // Act
  adapter.select(recorded(), 'Recorded · 110.15 s');
  const refetchedScopes = request('scopes', { frameId: frame.id });
  // Assert
  assert.deepEqual('event' in messages[0]! ? { event: messages[0].event, body: messages[0].body } : {}, { event: 'invalidated', body: { areas: ['variables'] } });
  assert.deepEqual(refetchedScopes.body, { scopes: [] });
  assert.equal(request('variables', { variablesReference: reference }).success, false);
});

test('leaving a missing-history moment sends no native Variables refresh because no values were shown', () => {
  // Arrange
  const { adapter, request, messages } = harness(); adapter.select(undefined, 'Not recorded at this moment'); request('configurationDone');
  messages.length = 0;
  // Act
  adapter.select(recorded(), 'Recorded · 55.87 s');
  // Assert
  assert.deepEqual(messages.map(message => 'event' in message ? message.event : 'response'), ['continued', 'thread', 'stopped']);
});

for (const command of ['continue', 'next', 'stepIn', 'stepOut', 'stepBack', 'reverseContinue', 'restart', 'evaluate', 'setVariable', 'setExpression']) {
  test(`replay refuses ${command} instead of executing or mutating the original target`, () => {
    // Arrange
    const { adapter, request } = harness(); adapter.select(recorded(), 'Recorded');
    // Act / Assert
    assert.equal(request(command, { expression: 'sendRequest()', value: '999', threadId: 1 }).success, false);
    assert.equal(request('stackTrace', { threadId: 1 }).body.stackFrames[0].name, 'createInvoice');
  });
}

test('tampered historical source clears previous state and cannot open the current checkout file', () => {
  // Arrange
  const { adapter, request } = harness(); adapter.select(recorded(), 'Recorded');
  const invalid = recorded(); invalid.frames[0]!.source!.text = 'changed';
  // Act / Assert
  assert.throws(() => adapter.select(invalid, 'Invalid'), /hash mismatch/);
  assert.deepEqual(request('loadedSources').body.sources, []);
  assert.deepEqual(request('stackTrace', { threadId: 1 }).body.stackFrames, []);
});

test('serialized histories reject cyclic, aliased and dangling variable graphs', () => {
  // Arrange
  const cyclic = recorded(); cyclic.variables[0]!.children = [0];
  const dangling = recorded(); dangling.frames[0]!.scopes[0]!.variables = [1];
  const alias = recorded(); alias.frames[0]!.scopes[0]!.variables = [0, 0];
  // Act / Assert
  assert.equal(replayDebugSnapshotSchema.safeParse(cyclic).success, false);
  assert.equal(replayDebugSnapshotSchema.safeParse(dangling).success, false);
  assert.equal(replayDebugSnapshotSchema.safeParse(alias).success, false);
});

test('live capture serializes nested scope values without retaining DAP handles', async () => {
  // Arrange
  const commands: string[] = [];
  // Act
  const actual = await captureReplayDebugSnapshot({ stack, verifiedSource: source, assertCurrent() {}, request(command, arguments_) {
    commands.push(command);
    if (command === 'scopes') return Promise.resolve({ scopes: [{ name: 'Locals', variablesReference: 555 }] });
    return Promise.resolve({ variables: arguments_.variablesReference === 555
      ? [{ name: 'invoice', value: 'Object', variablesReference: 888 }]
      : [{ name: 'amount', value: '120', type: 'number', variablesReference: 0 }] });
  } });
  // Assert
  assert.deepEqual(actual.frames[0]!.scopes, [{ name: 'Locals', variables: [0] }]);
  assert.deepEqual(actual.variables, [{ name: 'invoice', value: 'Object', type: undefined, children: [1], unavailable: undefined }, { name: 'amount', value: '120', type: 'number', children: [], unavailable: undefined }]);
  assert.deepEqual(commands, ['scopes', 'variables', 'variables']);
  assert.equal(JSON.stringify(actual).includes('variablesReference'), false);
});

test('capture rejects a resumed pause rather than saving mixed-generation values', async () => {
  // Arrange
  let resumed = false;
  // Act / Assert
  await assert.rejects(captureReplayDebugSnapshot({ stack, verifiedSource: source,
    assertCurrent() { if (resumed) throw new Error('Pause changed'); },
    request() { resumed = true; return Promise.resolve({ scopes: [] }); },
  }), /Pause changed/);
});

test('a failed scope read preserves the frame with an explicit capture limitation', async () => {
  // Arrange / Act
  const actual = await captureReplayDebugSnapshot({ stack, verifiedSource: source, assertCurrent() {}, request() { return Promise.reject(new Error('Scope unavailable')); } });
  // Assert
  assert.equal(actual.frames[0]!.name, 'createInvoice'); assert.equal(actual.frames[0]!.unavailable, 'Scope unavailable');
  assert.deepEqual(actual.frames[0]!.scopes, []);
});

test('recursive live handles terminate with an explicit missing-history leaf', async () => {
  // Arrange / Act
  const actual = await captureReplayDebugSnapshot({ stack, verifiedSource: source, assertCurrent() {}, request(command) {
    return Promise.resolve(command === 'scopes' ? { scopes: [{ name: 'Local', variablesReference: 555 }] }
      : { variables: [{ name: 'self', value: 'Object', variablesReference: 555 }] });
  } });
  // Assert
  assert.equal(actual.variables.length, 1);
  assert.equal(actual.variables[0]!.unavailable, 'Cyclic debugger reference was not expanded.');
});

test('oversized live scopes stop at the storage limit and disclose uncaptured values', async () => {
  // Arrange
  const variables = Array.from({ length: REPLAY_DEBUG_MAX_VARIABLES + 1 }, (_, index) => ({ name: `field${index}`, value: '1', variablesReference: 0 }));
  // Act
  const actual = await captureReplayDebugSnapshot({ stack, verifiedSource: source, assertCurrent() {}, request(command) {
    return Promise.resolve(command === 'scopes' ? { scopes: [{ name: 'Local', variablesReference: 555 }] } : { variables });
  } });
  // Assert
  assert.equal(actual.variables.length, 2_000);
  assert.equal(actual.frames[0]!.scopes[0]!.unavailable, 'Historical variable count limit reached.');
});

test('a Node test captures local values quickly and labels skipped global history', async () => {
  // Arrange
  const requests: string[] = [];
  const limitedStack: DebugProtocol.StackTraceResponse['body'] = { stackFrames: [stack.stackFrames[0]!, { id: 78, name: 'runner', line: 2, column: 1 }], totalFrames: 2 };
  // Act
  const actual = await captureReplayDebugSnapshot({ stack: limitedStack, verifiedSource: source, assertCurrent() {},
    limits: { timeoutMs: 1_500, maxFrames: 2, maxVariables: 2, maxDepth: 1,
      includeScope: (frameIndex, scopeName) => frameIndex === 0 && scopeName === 'Local' },
    request(command, arguments_) {
      requests.push(`${command}:${arguments_.frameId ?? arguments_.variablesReference}`);
      return Promise.resolve(command === 'scopes'
        ? { scopes: [{ name: 'Local', variablesReference: 555 }, { name: 'Global', variablesReference: 999 }] }
        : { variables: [{ name: 'listener', value: '() => undefined', variablesReference: 888 }] });
    } });
  // Assert
  assert.deepEqual(requests, ['scopes:77', 'variables:555', 'scopes:78']);
  assert.equal(actual.variables[0]?.name, 'listener');
  assert.equal(actual.variables[0]?.unavailable, 'Historical variable depth limit reached.');
  assert.equal(actual.frames[0]?.scopes[1]?.unavailable, 'This scope was not captured for the Node test.');
  assert.equal(actual.frames[1]?.scopes[0]?.unavailable, 'This scope was not captured for the Node test.');
});

test('a Node stop retains block-scoped data beside local values without copying globals or other frames', async () => {
  // Arrange
  const requests: string[] = [];
  const nodeStack: DebugProtocol.StackTraceResponse['body'] = { stackFrames: [stack.stackFrames[0]!, { id: 78, name: 'runner', line: 2, column: 1 }], totalFrames: 2 };
  const references = new Map([
    [11, [{ name: 'data', value: 'Array(1)', variablesReference: 0 }]],
    [12, [{ name: 'id', value: 'invoice-456', variablesReference: 0 }]],
    [13, [{ name: 'secret', value: 'private', variablesReference: 0 }]],
  ]);
  // Act
  const actual = await captureReplayDebugSnapshot({ stack: nodeStack, verifiedSource: source, assertCurrent() {},
    limits: { timeoutMs: 1_500, maxFrames: 2, maxVariables: 4, maxDepth: 1, includeScope: shouldCaptureNodeHistoryScope },
    request(command, arguments_) {
      requests.push(`${command}:${arguments_.frameId ?? arguments_.variablesReference}`);
      if (command === 'scopes') return Promise.resolve({ scopes: [
        { name: 'Block: fetchInvoiceById', variablesReference: 11 },
        { name: 'Local: fetchInvoiceById', variablesReference: 12 },
        { name: 'Global', variablesReference: 13 },
      ] });
      return Promise.resolve({ variables: references.get(arguments_.variablesReference ?? 0) ?? [] });
    } });
  // Assert
  assert.deepEqual(actual.frames[0]?.scopes.map(scope => scope.name), ['Block: fetchInvoiceById', 'Local: fetchInvoiceById', 'Global']);
  assert.deepEqual(actual.variables.map(variable => variable.name), ['data', 'id']);
  assert.equal(actual.frames[0]?.scopes[2]?.unavailable, 'This scope was not captured for the Node test.');
  assert.equal(actual.frames[1]?.scopes[0]?.unavailable, 'This scope was not captured for the Node test.');
  assert.deepEqual(requests, ['scopes:77', 'variables:11', 'variables:12', 'scopes:78']);
});


test('historical frames reuse the matching owned source document without suppressing native selection', () => {
  // Arrange
  const { adapter, request } = harness();
  // Act
  adapter.select(recorded(), 'Recorded', { uri: 'codebook-source:/recorded/actions.ts', hash: source.hash });
  // Assert
  assert.deepEqual(request('stackTrace', { threadId: 1 }).body.stackFrames[0].source,
    { name: 'app/lib/actions.ts', path: 'codebook-source:/recorded/actions.ts', sourceReference: 0 });
});

test('a different source document never substitutes for the recorded source', () => {
  // Arrange
  const { adapter, request } = harness();
  // Act
  adapter.select(recorded(), 'Recorded', { uri: 'codebook-source:/other/actions.ts', hash: sha256('other') });
  const frame = request('stackTrace', { threadId: 1 }).body.stackFrames[0];
  // Assert
  assert.equal(frame.source.path, undefined);
  assert.equal(request('source', { sourceReference: frame.source.sourceReference }).body.content, 'const amountInCents = amount * 100;');
});

test('current checkout source URIs are rejected and clear the previously selected history', () => {
  // Arrange
  const { adapter, request } = harness(); adapter.select(recorded(), 'Recorded');
  // Act / Assert
  assert.throws(() => adapter.select(recorded(), 'Invalid', { uri: 'file:///workspace/actions.ts', hash: source.hash }), /owned read-only/);
  assert.deepEqual(request('stackTrace', { threadId: 1 }).body.stackFrames, []);
});

test('revisiting a recorded moment replaces the missing-history thread label and rejects retired threads', () => {
  // Arrange
  const { adapter, request } = harness(); adapter.select(recorded(), 'First'); request('configurationDone');
  adapter.select(undefined, 'Not recorded at this moment');
  // Act
  adapter.select(recorded(), 'Recorded again');
  // Assert
  assert.deepEqual(request('threads').body, { threads: [{ id: 3, name: 'Recorded again' }] });
  assert.equal(request('stackTrace', { threadId: 1 }).success, false);
  assert.equal(request('stackTrace', { threadId: 2 }).success, false);
  assert.equal(request('stackTrace', { threadId: 3 }).body.stackFrames[0].name, 'createInvoice');
});


test('recorded history cannot cancel the editor cleanup of a missing-history stop', async () => {
  // Arrange: the editor queues continued cleanup and cancels it on thread exit.
  const { adapter, request, messages } = harness();
  request('configurationDone');
  const stopped = new Map<number, string>([[1, 'Not recorded at this moment']]);
  const cancelled = new Set<number>();
  const pending: Promise<void>[] = [];
  messages.length = 0;

  // Act
  adapter.select(recorded(), 'Recorded pause · 15.93 s');
  for (const message of messages) {
    if (!('event' in message)) continue;
    const threadId = message.body.threadId;
    if (message.event === 'continued') pending.push(Promise.resolve().then(() => {
      if (!cancelled.has(threadId)) stopped.delete(threadId);
    }));
    if (message.event === 'thread' && message.body.reason === 'exited') cancelled.add(threadId);
    if (message.event === 'stopped') stopped.set(threadId, message.body.description);
  }
  await Promise.all(pending);

  // Assert: session-level heading and discoverable history describe the same moment.
  assert.deepEqual([...stopped.values()], ['Recorded pause · 15.93 s']);
  assert.deepEqual(request('threads').body, { threads: [{ id: 2, name: 'Recorded pause · 15.93 s' }] });
  assert.equal(request('stackTrace', { threadId: 1 }).success, false);
  assert.equal(request('stackTrace', { threadId: 2 }).body.stackFrames[0].name, 'createInvoice');
});

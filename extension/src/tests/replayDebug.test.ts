import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { ReplayDebugAdapter } from '../replayDebugAdapter';
import { replayDebugSnapshotSchema, type ReplayDebugSnapshot } from '../replayDebugSchemas';
import { captureReplayDebugSnapshot } from '../utils/captureReplayDebugSnapshot';
import { shouldCaptureReplayScope } from '../utils/shouldCaptureReplayScope';
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

test('a live browser or server stop never copies global, closure or caller-frame values into saved history', async () => {
  // Arrange
  const requests: string[] = [];
  const serverStack: DebugProtocol.StackTraceResponse['body'] = { stackFrames: [stack.stackFrames[0]!, { id: 78, name: 'handleSubmit', line: 2, column: 1 }], totalFrames: 2 };
  const references = new Map([
    [11, [{ name: 'amount', value: '120', variablesReference: 0 }]],
    [12, [{ name: 'sql', value: 'postgres://user:password@db', variablesReference: 0 }]],
    [13, [{ name: 'process', value: 'process', variablesReference: 0 }]],
    [14, [{ name: 'cookie', value: 'session=private', variablesReference: 0 }]],
  ]);
  // Act
  const actual = await captureReplayDebugSnapshot({ stack: serverStack, verifiedSource: source, assertCurrent() {},
    request(command, arguments_) {
      requests.push(`${command}:${arguments_.frameId ?? arguments_.variablesReference}`);
      if (command === 'scopes') return Promise.resolve({ scopes: arguments_.frameId === 77
        ? [{ name: 'Local: createInvoice', variablesReference: 11 }, { name: 'Closure', variablesReference: 12 }, { name: 'Global', variablesReference: 13 }]
        : [{ name: 'Local: handleSubmit', variablesReference: 14 }] });
      return Promise.resolve({ variables: references.get(arguments_.variablesReference ?? 0) ?? [] });
    } });
  // Assert
  assert.deepEqual(actual.variables.map(variable => `${variable.name}=${variable.value}`), ['amount=120']);
  assert.deepEqual(actual.frames[0]?.scopes.map(scope => [scope.name, scope.unavailable]), [
    ['Local: createInvoice', undefined],
    ['Closure', 'This scope was not captured; replay keeps only the stopped frame\'s local values.'],
    ['Global', 'This scope was not captured; replay keeps only the stopped frame\'s local values.'],
  ]);
  assert.equal(actual.frames[1]?.scopes[0]?.unavailable, 'This scope was not captured; replay keeps only the stopped frame\'s local values.');
  assert.deepEqual(requests, ['scopes:77', 'variables:11', 'scopes:78']);
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
  assert.equal(actual.frames[0]?.scopes[1]?.unavailable, 'This scope was not captured; replay keeps only the stopped frame\'s local values.');
  assert.equal(actual.frames[1]?.scopes[0]?.unavailable, 'This scope was not captured; replay keeps only the stopped frame\'s local values.');
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
    limits: { timeoutMs: 1_500, maxFrames: 2, maxVariables: 4, maxDepth: 1, includeScope: shouldCaptureReplayScope },
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
  assert.equal(actual.frames[0]?.scopes[2]?.unavailable, 'This scope was not captured; replay keeps only the stopped frame\'s local values.');
  assert.equal(actual.frames[1]?.scopes[0]?.unavailable, 'This scope was not captured; replay keeps only the stopped frame\'s local values.');
  assert.deepEqual(requests, ['scopes:77', 'variables:11', 'variables:12', 'scopes:78']);
});

test('a replay stop keeps its local values when the editor shows localized scope names', async () => {
  // Arrange: js-debug translates scope names but keeps the language-neutral "locals" hint.
  const requests: string[] = [];
  const references = new Map([
    [12, [{ name: 'amount', value: '120', variablesReference: 0 }]],
    [13, [{ name: 'DATABASE_URL', value: 'postgres://private', variablesReference: 0 }]],
    [14, [{ name: 'client', value: 'Pool', variablesReference: 0 }]],
  ]);
  // Act
  const actual = await captureReplayDebugSnapshot({ stack, verifiedSource: source, assertCurrent() {},
    request(command, arguments_) {
      requests.push(`${command}:${arguments_.frameId ?? arguments_.variablesReference}`);
      if (command === 'scopes') return Promise.resolve({ scopes: [
        { name: 'ローカル: createInvoice', presentationHint: 'locals', variablesReference: 12 },
        { name: 'クロージャ', presentationHint: 'arguments', variablesReference: 14 },
        { name: 'グローバル', variablesReference: 13 },
      ] });
      return Promise.resolve({ variables: references.get(arguments_.variablesReference ?? 0) ?? [] });
    } });
  // Assert
  assert.deepEqual(actual.variables.map(variable => `${variable.name}=${variable.value}`), ['amount=120']);
  assert.deepEqual(requests.filter(request => request.startsWith('variables:')), ['variables:12']);
});

test('a caller scope filter cannot widen replay capture to globals or caller frames', async () => {
  // Arrange
  const requests: string[] = [];
  const callerStack: DebugProtocol.StackTraceResponse['body'] = { stackFrames: [stack.stackFrames[0]!, { id: 78, name: 'runner', line: 2, column: 1 }], totalFrames: 2 };
  const references = new Map([
    [12, [{ name: 'amount', value: '120', variablesReference: 0 }]],
    [13, [{ name: 'DATABASE_URL', value: 'postgres://private', variablesReference: 0 }]],
  ]);
  // Act
  const actual = await captureReplayDebugSnapshot({ stack: callerStack, verifiedSource: source, assertCurrent() {},
    limits: { timeoutMs: 1_500, maxFrames: 2, maxVariables: 4, maxDepth: 1, includeScope: () => true },
    request(command, arguments_) {
      requests.push(`${command}:${arguments_.frameId ?? arguments_.variablesReference}`);
      if (command === 'scopes') return Promise.resolve({ scopes: [{ name: 'Local', variablesReference: 12 }, { name: 'Global', variablesReference: 13 }] });
      return Promise.resolve({ variables: references.get(arguments_.variablesReference ?? 0) ?? [] });
    } });
  // Assert
  assert.deepEqual(actual.variables.map(variable => `${variable.name}=${variable.value}`), ['amount=120']);
  assert.deepEqual(requests, ['scopes:77', 'variables:12', 'scopes:78']);
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

test('native debugger paging returns only the requested recorded frames and values', () => {
  // Arrange
  const { adapter, request } = harness();
  const snapshot: ReplayDebugSnapshot = { version: 1, frames: [
    { name: 'createInvoice', line: 1, column: 1, scopes: [{ name: 'Locals', variables: [0, 1, 2] }] },
    { name: 'handleSubmit', line: 5, column: 3, scopes: [] },
    { name: 'dispatch', line: 9, column: 2, scopes: [] },
  ], variables: [
    { name: 'amount', value: '120', type: 'number', children: [] },
    { name: 'currency', value: '"USD"', type: 'string', children: [] },
    { name: 'status', value: '"pending"', type: 'string', children: [] },
  ], limitations: [] };
  adapter.select(snapshot, 'Recorded · 00:42');

  // Act
  const page = request('stackTrace', { threadId: 1, startFrame: 1, levels: 1 }).body;
  const firstFrameId = request('stackTrace', { threadId: 1 }).body.stackFrames[0].id;
  const reference = request('scopes', { frameId: firstFrameId }).body.scopes[0].variablesReference;
  const values = request('variables', { variablesReference: reference, start: 1, count: 1 }).body.variables;

  // Assert
  assert.equal(page.totalFrames, 3);
  assert.equal(page.stackFrames.length, 1);
  assert.equal(page.stackFrames[0].name, 'handleSubmit');
  assert.deepEqual(values, [{ name: 'currency', value: '"USD"', type: 'string', variablesReference: 0 }]);
});

test('recording limitations appear as a native Variables scope so uncaptured history is disclosed', () => {
  // Arrange
  const { adapter, request } = harness();
  const snapshot = recorded();
  snapshot.frames[0]!.unavailable = 'Scope unavailable';
  snapshot.limitations = ['Historical variable count limit reached.'];
  adapter.select(snapshot, 'Recorded · 00:42');

  // Act
  const frameId = request('stackTrace', { threadId: 1 }).body.stackFrames[0].id;
  const scopes = request('scopes', { frameId }).body.scopes;
  const limitationRows = request('variables', { variablesReference: scopes[1].variablesReference }).body.variables;

  // Assert
  assert.equal(scopes.length, 2);
  assert.equal(scopes[1].name, 'Recording limitations');
  assert.deepEqual(limitationRows, [{ name: 'Not recorded', value: 'Scope unavailable\nHistorical variable count limit reached.', variablesReference: 0 }]);
});

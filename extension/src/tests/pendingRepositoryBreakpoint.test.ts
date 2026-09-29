import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { DebugSession } from 'vscode';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { loadModule } from './utils/loadModule';

/** Supplies native API identities and explicit adapter messages without starting an editor or application. @example const harness = await breakpointHarness() */
async function breakpointHarness() {
  class Position { constructor(readonly line: number, readonly character: number) {} }
  class Location { readonly range; constructor(readonly uri: { fsPath: string }, start: Position) { this.range = { start }; } }
  let nextId = 0;
  class SourceBreakpoint { readonly id = String(++nextId); constructor(readonly location: Location) {} }
  const breakpoints: SourceBreakpoint[] = [];
  const module = await loadModule<typeof import('../ownedRepositoryBreakpoint')>(resolve(__dirname, '../ownedRepositoryBreakpoint.js'), { vscode: {
    Position, Location, SourceBreakpoint, Uri: { file: (fsPath: string) => ({ fsPath }) },
    debug: { breakpoints, addBreakpoints(values: SourceBreakpoint[]) { breakpoints.push(...values); },
      removeBreakpoints(values: SourceBreakpoint[]) { for (const value of values) { const index = breakpoints.indexOf(value); if (index >= 0) breakpoints.splice(index, 1); } } },
  } });
  const session: DebugSession = { id: 'owned-server', name: 'server', type: 'pwa-node', workspaceFolder: undefined,
    configuration: { type: 'pwa-node', name: 'server', request: 'attach' }, customRequest: async () => undefined, getDebugProtocolBreakpoint: async () => undefined };
  const breakpoint = new module.OwnedRepositoryBreakpoint('/repo/actions.ts', 20, 5);
  const request = (sequence = 1, positions = [{ line: 2, column: 1 }, { line: 20, column: 5 }]): DebugProtocol.Request => ({
    seq: sequence, type: 'request', command: 'setBreakpoints', arguments: { source: { path: '/repo/actions.ts' }, breakpoints: positions },
  });
  const response = (sequence = 1, selected: DebugProtocol.Breakpoint = { id: 8, verified: false, reason: 'pending' }): DebugProtocol.Response => ({
    seq: sequence + 100, type: 'response', command: 'setBreakpoints', request_seq: sequence, success: true,
    body: { breakpoints: [{ id: 7, verified: true, line: 2, column: 1 }, selected] },
  });
  return { breakpoint, session, request, response, signal: new AbortController().signal, editorBreakpoints: breakpoints };
}

test('an acknowledged lazy server breakpoint remains pending rather than claiming a loaded binding', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } = await breakpointHarness();
  // Act
  breakpoint.onRequest(session, request()); breakpoint.onResponse(session, response());
  const receipt = await breakpoint.registered(session, signal);
  // Assert
  assert.equal(JSON.stringify(receipt), '{"sessionId":"owned-server","requestSequence":1,"breakpointId":8,"status":"pending"}');
  assert.equal(breakpoint.retired, false);
});

test('a verified registration must resolve the exact requested source coordinates', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } = await breakpointHarness();
  // Act
  breakpoint.onRequest(session, request());
  breakpoint.onResponse(session, response(1, { id: 8, verified: true, line: 20, column: 5, source: { path: '/repo/actions.ts' } }));
  // Assert
  assert.equal((await breakpoint.registered(session, signal)).status, 'bound');
});

test('a mismatched adapter coordinate blocks continuation and identifies the rejected position', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } = await breakpointHarness();
  // Act
  breakpoint.onRequest(session, request());
  breakpoint.onResponse(session, response(1, { id: 8, verified: true, line: 20, column: 9 }));
  // Assert
  await assert.rejects(breakpoint.registered(session, signal), error => {
    assert.match(String(error), /Selected adapter did not acknowledge the exact breakpoint registration/);
    assert.match(String(error), /"expectedColumn":5/);
    assert.match(String(error), /"selectedColumn":9/);
    return true;
  });
});

test('failed missing duplicate and rebound adapter registrations cannot authorize application input', async () => {
  for (const selected of [
    { id: 8, verified: false, reason: 'failed' }, { verified: false }, { id: 7, verified: false },
    { id: 8, verified: true }, { id: 8, verified: true, line: 21, column: 5 },
    { id: 8, verified: false, line: 20, column: 6 }, { id: 8, verified: false, source: { path: '/repo/other.ts' } },
  ] satisfies DebugProtocol.Breakpoint[]) {
    // Arrange
    const { breakpoint, session, request, response, signal } = await breakpointHarness();
    // Act
    breakpoint.onRequest(session, request()); breakpoint.onResponse(session, response(1, selected));
    // Assert
    await assert.rejects(breakpoint.registered(session, signal), /did not acknowledge/);
  }
});

test('truncated and unsuccessful setBreakpoints replies cannot acknowledge a pending source stop', async () => {
  for (const kind of ['truncated', 'failed']) {
    // Arrange
    const { breakpoint, session, request, response, signal } = await breakpointHarness(), reply = response();
    if (kind === 'truncated') reply.body = { breakpoints: [{ id: 8, verified: false }] }; else reply.success = false;
    // Act
    breakpoint.onRequest(session, request()); breakpoint.onResponse(session, reply);
    // Assert
    await assert.rejects(breakpoint.registered(session, signal), /did not acknowledge/);
  }
});

test('a later breakpoint replacement invalidates earlier acknowledgements and ignores their delayed responses', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } = await breakpointHarness();
  breakpoint.onRequest(session, request()); breakpoint.onResponse(session, response());
  assert.equal((await breakpoint.registered(session, signal)).requestSequence, 1);
  // Act
  breakpoint.onRequest(session, request(2)); breakpoint.onResponse(session, response(1));
  const cancellation = new AbortController(), waiting = breakpoint.registered(session, cancellation.signal);
  cancellation.abort();
  // Assert
  await assert.rejects(waiting, { name: 'AbortError' });
  breakpoint.onResponse(session, response(2));
  assert.equal((await breakpoint.registered(session, signal)).requestSequence, 2);
});

test('another debugger session or source cannot acknowledge the selected registration', async () => {
  // Arrange
  const { breakpoint, session, request, response } = await breakpointHarness();
  const foreign = { ...session, id: 'foreign-server' }, wrongSource = request();
  wrongSource.arguments.source.path = '/repo/other.ts';
  // Act
  breakpoint.onRequest(session, wrongSource); breakpoint.onResponse(session, response());
  breakpoint.onRequest(session, request()); breakpoint.onResponse(foreign, response());
  const cancellation = new AbortController(), waiting = breakpoint.registered(session, cancellation.signal);
  cancellation.abort();
  // Assert
  await assert.rejects(waiting, { name: 'AbortError' });
});

test('removed or ambiguous requested positions revoke earlier pending registration', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } = await breakpointHarness();
  // Act / Assert
  breakpoint.onRequest(session, request(1, [{ line: 20, column: 5 }, { line: 20, column: 5 }]));
  await assert.rejects(breakpoint.registered(session, signal), /ambiguous/);
  breakpoint.onRequest(session, request(2, [{ line: 2, column: 1 }]));
  await assert.rejects(breakpoint.registered(session, signal), /absent/);
  breakpoint.onRequest(session, request(3)); breakpoint.onResponse(session, response(3));
  breakpoint.remove();
  await assert.rejects(breakpoint.registered(session, signal), /removed/);
});

test('conditional logpoint and modified-source requests cannot qualify the frozen unconditional stop', async () => {
  for (const property of ['condition', 'hitCondition', 'logMessage', 'sourceModified']) {
    // Arrange
    const { breakpoint, session, request, response, signal } = await breakpointHarness(), changed = request();
    if (property === 'sourceModified') changed.arguments.sourceModified = true;
    else changed.arguments.breakpoints[1][property] = 'changed';
    // Act
    breakpoint.onRequest(session, changed); breakpoint.onResponse(session, response());
    // Assert
    await assert.rejects(breakpoint.registered(session, signal), /changed source or pause behavior/);
  }
});

test('a malformed same-source replacement cannot retain an earlier valid acknowledgement', async () => {
  // Arrange
  const { breakpoint, session, request, response, signal } = await breakpointHarness();
  breakpoint.onRequest(session, request()); breakpoint.onResponse(session, response());
  assert.equal((await breakpoint.registered(session, signal)).requestSequence, 1);
  const malformed = request(2);
  malformed.arguments.breakpoints = 'invalid';
  // Act
  breakpoint.onRequest(session, malformed); breakpoint.onResponse(session, response(1));
  // Assert
  await assert.rejects(breakpoint.registered(session, signal), /Malformed breakpoint registration replacement/);
});

test('an owned breakpoint the learner already removed retires without waiting for another adapter reply', async () => {
  // Arrange: the stop was acknowledged, then the learner clicked the owned gutter breakpoint away during the pause.
  const { breakpoint, session, request, response, signal, editorBreakpoints } = await breakpointHarness();
  breakpoint.onRequest(session, request()); breakpoint.onResponse(session, response());
  await breakpoint.registered(session, signal);
  editorBreakpoints.splice(editorBreakpoints.indexOf(breakpoint.breakpoint), 1);
  breakpoint.onRequest(session, request(2, [{ line: 2, column: 1 }]));
  // Act: finishing the stop must not wait for a setBreakpoints request the editor will never send.
  await breakpoint.retire(session, AbortSignal.timeout(1_000));
  // Assert
  assert.equal(breakpoint.retired, true);
});

test('a learner-removed owned breakpoint still counts as retired only after the adapter releases it', async () => {
  // Arrange: the editor removed the breakpoint, but the adapter still reports it bound.
  const { breakpoint, session, request, response, signal, editorBreakpoints } = await breakpointHarness();
  breakpoint.onRequest(session, request()); breakpoint.onResponse(session, response());
  await breakpoint.registered(session, signal);
  editorBreakpoints.splice(editorBreakpoints.indexOf(breakpoint.breakpoint), 1);
  breakpoint.onRequest(session, request(2, [{ line: 2, column: 1 }]));
  const stillBound: DebugSession = { ...session, getDebugProtocolBreakpoint: async () => ({ id: 8, verified: true }) };
  // Act / Assert
  await assert.rejects(breakpoint.retire(stillBound, AbortSignal.timeout(300)));
  assert.equal(breakpoint.retired, false);
});

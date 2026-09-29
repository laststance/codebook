import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as vscode from 'vscode';
import { ReplayDebugger } from '../replayDebugger';
import type { ReplayDebugSnapshot } from '../replayDebugSchemas';

const firstSnapshot: ReplayDebugSnapshot = { version: 1, frames: [{ name: 'LoginButton', line: 90, column: 5, scopes: [] }], variables: [], limitations: [] };

/** Minimal editor event port for owned-session lifecycle tests. @example emitter.fire(session) */
class TestEmitter<Value> {
  private readonly listeners = new Set<(value: Value) => void>();
  readonly event: vscode.Event<Value> = (listener, thisArgs, disposables) => {
    const wrapped = (value: Value) => listener.call(thisArgs, value); this.listeners.add(wrapped);
    const disposable = { dispose: () => { this.listeners.delete(wrapped); } }; disposables?.push(disposable); return disposable;
  };
  fire(value: Value): void { for (const listener of this.listeners) listener(value); }
  dispose(): void { this.listeners.clear(); }
}
/** Exposes only the four native debug operations used by the historical owner. @example harness().stopped */
function harness(startGate?: Promise<void>, terminationGate?: Promise<void>) {
  const terminated = new TestEmitter<vscode.DebugSession>(), stopped: string[] = [], messages: vscode.DebugProtocolMessage[] = [];
  let factory: vscode.DebugAdapterDescriptorFactory | undefined, adapter: vscode.DebugAdapter | undefined, session: vscode.DebugSession | undefined;
  let sessionCount = 0;
  let signalStarted = () => {};
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  let signalStopRequested = () => {};
  const stopRequested = new Promise<void>(resolve => { signalStopRequested = resolve; });
  class Inline {
    constructor(public implementation: vscode.DebugAdapter) { adapter = implementation; implementation.onDidSendMessage(message => messages.push(message)); }
  }
  const editor: ConstructorParameters<typeof ReplayDebugger>[0] = { EventEmitter: TestEmitter, DebugAdapterInlineImplementation: Inline,
    debug: {
      registerDebugAdapterDescriptorFactory(_type, value) { factory = value; return { dispose() { factory = undefined; } }; },
      onDidTerminateDebugSession: terminated.event,
      async startDebugging(_folder, configuration) {
        if (typeof configuration === 'string') throw new Error('Expected an owned inline configuration');
        session = { id: ++sessionCount === 1 ? 'historical-owned' : `historical-owned-${sessionCount}`, type: 'codebook-replay', name: configuration.name, configuration, workspaceFolder: undefined,
          customRequest: async () => undefined, getDebugProtocolBreakpoint: async () => undefined };
        await factory?.createDebugAdapterDescriptor(session, undefined);
        adapter?.handleMessage({ type: 'request', seq: 1, command: 'configurationDone' }); signalStarted();
        await startGate; return true;
      },
      async stopDebugging(target) { assert.ok(target); stopped.push(target.id); signalStopRequested(); await terminationGate; terminated.fire(target); },
    } };
  const owner = new ReplayDebugger(editor);
  return { owner, stopped, messages, started, stopRequested, terminate: () => { assert.ok(session); terminated.fire(session); },
    terminateForeign: () => { assert.ok(session); terminated.fire({ ...session, id: 'unrelated-live-session' }); },
    foreignStart: async () => { assert.ok(factory); assert.ok(session); return factory.createDebugAdapterDescriptor({ ...session, id: 'foreign', configuration: { ...session.configuration, codebookReplayOwner: 'other-owner' } }, undefined); } };
}

test('historical workspace closure stops only its owned native session', async () => {
  // Arrange
  const { owner, stopped } = harness(); await owner.present(undefined, 'Not recorded at this moment', new AbortController().signal);
  // Act
  await owner.dispose(); await owner.dispose();
  // Assert
  assert.deepEqual(stopped, ['historical-owned']);
});

test('closing during delayed native startup retires the acquired session exactly once', async () => {
  // Arrange
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  const { owner, stopped, started } = harness(gate);
  const showing = owner.present(undefined, 'Missing', new AbortController().signal);
  const rejected = assert.rejects(showing, /closed during startup/); await started;
  // Act
  const closing = owner.dispose(); release(); await rejected; await closing;
  // Assert
  assert.deepEqual(stopped, ['historical-owned']);
});

test('a superseded seek cannot publish after native debugger startup completes', async () => {
  // Arrange
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  const { owner, started } = harness(gate);
  const showing = owner.present(undefined, 'Old requested moment', new AbortController().signal);
  const rejected = assert.rejects(showing, /superseded/); await started;
  // Act
  owner.invalidate(); release(); await rejected;
  // Assert
  await owner.present(undefined, 'Not recorded at this moment', new AbortController().signal);
  await owner.dispose();
});

test('manual native termination does not silently relaunch a session during playback', async () => {
  // Arrange
  const { owner, terminate, stopped } = harness(); await owner.present(undefined, 'Missing', new AbortController().signal);
  // Act
  terminate();
  // Assert
  await assert.rejects(owner.present(undefined, 'Missing', new AbortController().signal), /closed/);
  await owner.dispose(); assert.deepEqual(stopped, []);
});

test('seeking another recorded stop retires the old owned session before opening new native values', async () => {
  // Arrange
  const { owner, stopped } = harness();
  const signal = new AbortController().signal;
  await owner.present(firstSnapshot, 'First recorded stop', signal);
  // Act
  owner.invalidate();
  await owner.retire(undefined, signal);
  assert.deepEqual(stopped, ['historical-owned']);
  await owner.present(undefined, 'Second recorded stop', signal);
  await owner.dispose();
  // Assert
  assert.deepEqual(stopped, ['historical-owned', 'historical-owned-2']);
});

test('video frames within one recorded stop preserve their native debug session', async () => {
  // Arrange
  const { owner, stopped } = harness();
  const signal = new AbortController().signal;
  await owner.present(firstSnapshot, 'Recorded pause', signal);
  // Act
  await owner.retire(firstSnapshot, signal);
  await owner.present(firstSnapshot, 'Recorded pause', signal);
  // Assert
  assert.deepEqual(stopped, []);
  await owner.dispose();
});

test('a new recorded stop waits for native termination before replacing historical values', async () => {
  // Arrange
  let releaseTermination = () => {};
  const terminationGate = new Promise<void>(resolve => { releaseTermination = resolve; });
  const { owner, stopped, stopRequested } = harness(undefined, terminationGate);
  const signal = new AbortController().signal;
  await owner.present(firstSnapshot, 'First recorded stop', signal);

  // Act
  owner.invalidate();
  const retiring = owner.retire(undefined, signal);
  await stopRequested;
  let replacementPresented = false;
  const replacement = owner.present(undefined, 'Second recorded stop', signal).then(() => { replacementPresented = true; });

  // Assert
  assert.deepEqual(stopped, ['historical-owned']);
  assert.equal(replacementPresented, false);
  releaseTermination();
  await retiring; await replacement;
  assert.equal(replacementPresented, true);
  await owner.dispose();
  assert.deepEqual(stopped, ['historical-owned', 'historical-owned-2']);
});

test('a launch configuration cannot borrow another learning session owner', async () => {
  // Arrange
  const { owner, foreignStart } = harness(); await owner.present(undefined, 'Missing', new AbortController().signal);
  // Act / Assert
  await assert.rejects(foreignStart(), /Open historical debugging/); await owner.dispose();
});

test('an unrelated debugger ending does not detach or stop the selected historical session', async () => {
  // Arrange
  const { owner, stopped, terminateForeign } = harness();
  const signal = new AbortController().signal;
  await owner.present(firstSnapshot, 'Recorded pause', signal);

  // Act
  terminateForeign();
  await owner.present(firstSnapshot, 'Recorded pause', signal);

  // Assert
  assert.deepEqual(stopped, []);
  await owner.dispose();
  assert.deepEqual(stopped, ['historical-owned']);
});

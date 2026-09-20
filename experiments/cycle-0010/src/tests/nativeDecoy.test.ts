import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import type * as vscode from 'vscode';
import type * as DecoyModule from '../utils/createNativeDecoy';
import { awaitResponse } from 'codebook-cycle-0001/dist/utils/awaitResponse';

test('an unrelated parent console stays focused while inspection targets its stopped child', async () => {
  // Arrange: native debug consoles can focus a parent while its child owns the stopped frame.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-decoy-console-'));
  const filename = join(__dirname, '../utils/createNativeDecoy.js'), nativeRequire = createRequire(filename);
  const exports: Partial<typeof DecoyModule> = {}, inspected: string[] = [], stopped: string[] = [];
  let tracker: vscode.DebugAdapterTrackerFactory | undefined, focused: vscode.DebugSession | undefined;
  let terminated = (_session: vscode.DebugSession) => {};
  const root: vscode.DebugSession = { id: 'decoy-root', name: 'decoy', type: 'pwa-node', workspaceFolder: undefined,
    configuration: { type: 'pwa-node', request: 'launch', name: `unrelated repository QA ${directory}` },
    customRequest: async () => { throw new Error('The console root cannot inspect the stopped child'); }, getDebugProtocolBreakpoint: async () => undefined };
  const child: vscode.DebugSession = { ...root, id: 'decoy-child', parentSession: root,
    customRequest: async () => { inspected.push('decoy-child'); return { stackFrames: [{ id: 1, name: 'entry', source: { path: join(directory, 'decoy.cjs') }, line: 1, column: 1 }] }; } };
  const primary = { ...root, id: 'primary-root', configuration: { ...root.configuration, name: 'primary' } };
  focused = primary;
  runInNewContext(await readFile(filename, 'utf8'), {
    exports,
    require(name: string) {
      if (name === 'vscode') return { debug: {
        get activeDebugSession() { return focused; },
        registerDebugAdapterTrackerFactory: (_type: string, factory: vscode.DebugAdapterTrackerFactory) => { tracker = factory; return { dispose() {} }; },
        onDidStartDebugSession: () => ({ dispose() {} }),
        onDidTerminateDebugSession: (listener: typeof terminated) => { terminated = listener; return { dispose() {} }; },
        startDebugging: async () => {
          await tracker?.createDebugAdapterTracker(root);
          const childTracker = await tracker?.createDebugAdapterTracker(child);
          childTracker?.onDidSendMessage?.({ type: 'event', event: 'stopped', body: { threadId: 1 } });
          return true;
        },
        stopDebugging: async (target: vscode.DebugSession) => { stopped.push(target.id); terminated(child); terminated(root); },
      }, commands: { executeCommand: async () => { focused = focused === root ? primary : root; } } };
      return nativeRequire(name);
    },
  }, { filename });
  assert.ok(exports.createNativeDecoy); const decoy = exports.createNativeDecoy(directory, '/node');
  try {
    // Act
    await decoy.prepare(); const inspection = await decoy.inspect();
    // Assert
    assert.equal(focused.id, 'decoy-root'); assert.equal(decoy.view().focused, true);
    assert.equal(decoy.view().sessionId, 'decoy-child'); assert.equal(inspection.sessionId, 'decoy-child');
    assert.deepEqual(inspected, ['decoy-child']); assert.equal(decoy.view().continuedCount, 0);
    await decoy.close(); assert.deepEqual(stopped, ['decoy-root']);
  } finally { await decoy.close(); await rm(directory, { recursive: true, force: true }); }
});

test('a timed-out decoy launch preserves drafts and closes known and late sessions before releasing its tracker', async () => {
  // Arrange: acquisition remains pending after its caller times out.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-decoy-'));
  const filename = join(__dirname, '../utils/createNativeDecoy.js'), nativeRequire = createRequire(filename);
  const exports: Partial<typeof DecoyModule> = {}, stopped: string[] = [];
  let tracker: vscode.DebugAdapterTrackerFactory | undefined;
  let started = (_session: vscode.DebugSession) => {}, terminated = (_session: vscode.DebugSession) => {};
  let resolveLaunch = (_value: boolean) => {}, disposed = 0, releaseOptions: vscode.DebugSessionOptions | undefined;
  const launching = new Promise<boolean>(resolve => { resolveLaunch = resolve; });
  const session = (id: string): vscode.DebugSession => ({ id, name: 'decoy', type: 'pwa-node', workspaceFolder: undefined,
    configuration: { type: 'pwa-node', request: 'launch', name: `unrelated repository QA ${directory}` },
    customRequest: async () => undefined, getDebugProtocolBreakpoint: async () => undefined });
  const known = session('known'), late = session('late');
  const dispose = () => { disposed++; };
  runInNewContext(await readFile(filename, 'utf8'), {
    exports,
    require(name: string) {
      if (name === 'vscode') return { debug: {
        registerDebugAdapterTrackerFactory: (_type: string, factory: vscode.DebugAdapterTrackerFactory) => { tracker = factory; return { dispose }; },
        onDidStartDebugSession: (listener: typeof started) => { started = listener; return { dispose }; },
        onDidTerminateDebugSession: (listener: typeof terminated) => { terminated = listener; return { dispose }; },
        startDebugging: (_folder: unknown, _configuration: unknown, options: vscode.DebugSessionOptions) => { releaseOptions = options; tracker?.createDebugAdapterTracker(known); return launching; },
        stopDebugging: async (target: vscode.DebugSession) => { stopped.push(target.id); terminated(target); },
      } };
      if (name.endsWith('/utils/awaitResponse')) return { awaitResponse: <Value>(promise: PromiseLike<Value>, description: string) => description === 'unrelated QA launch' ? Promise.reject(new Error('Launch deadline exceeded')) : awaitResponse(promise, description) };
      return nativeRequire(name);
    },
  }, { filename });
  assert.ok(exports.createNativeDecoy); const decoy = exports.createNativeDecoy(directory, '/node');
  try {
    // Act
    await assert.rejects(decoy.prepare(), /Launch deadline exceeded/);
    const closing = decoy.close();
    assert.deepEqual(stopped, ['known']); assert.equal(disposed, 0);
    tracker?.createDebugAdapterTracker(late); started(late); resolveLaunch(true);
    await closing;
    // Assert
    assert.equal(releaseOptions?.suppressSaveBeforeStart, true);
    assert.deepEqual(stopped, ['known', 'late']); assert.equal(disposed, 3);
    assert.equal(decoy.view().activeSessionIds.length, 0);
  } finally { resolveLaunch(false); await rm(directory, { recursive: true, force: true }); }
});

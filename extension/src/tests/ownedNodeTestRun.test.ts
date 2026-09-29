import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type * as vscode from 'vscode';
import type { DebugProtocol } from '@vscode/debugprotocol';
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas';
import { loadModule } from './utils/loadModule';
import { sha256 } from '../runtimeSupport/utils/sha256';

/**
 * Drives one owned Node test run through fake editor/process ports, recording the order of breakpoint, continuation and release effects.
 *
 * @param options.declaredStops - Ordered checked stops, all at the same source line as a loop body would declare them.
 * @param options.observedLine - Line the native debugger reports for every breakpoint pause.
 * @param options.duringRetire - Learner action performed while the owned breakpoint is being retired.
 *
 * @example
 * ```ts
 * const harness = await nodeRunHarness({ declaredStops: 2 }); await harness.run.prepare(); await harness.run.advance();
 * ```
 */
async function nodeRunHarness({ declaredStops = 1, observedLine = 1, duringRetire }: { declaredStops?: number; observedLine?: number; duringRetire?: () => void } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-owned-node-run-'));
  const sourceText = 'export const nextTheme = "dark";\n', sourceFile = join(directory, 'theme.ts');
  await writeFile(sourceFile, sourceText);
  const source = { path: 'theme.ts', hash: sha256(sourceText), line: 1, column: 14 };
  const launch = { workspace: directory, testFile: join(directory, 'theme.test.ts'), sourceFile, program: 'vitest', args: [],
    stops: Array.from({ length: declaredStops }, () => ({ file: sourceFile, source, inspections: [] })) };
  const calls: string[] = [];
  let trackerFactory: vscode.DebugAdapterTrackerFactory | undefined, tracker: vscode.DebugAdapterTracker | undefined, continued = 0;
  const stopped = (reason: string) => tracker?.onDidSendMessage?.({ type: 'event', event: 'stopped', body: { threadId: 1, reason } });
  const session = { id: 'owned-node-session', type: 'pwa-node', name: '', workspaceFolder: undefined, configuration: { type: 'pwa-node', name: '', request: 'attach' },
    getDebugProtocolBreakpoint: async () => undefined,
    async customRequest(command: string): Promise<unknown> {
      if (command === 'continue') {
        calls.push('continue');
        // Each continuation before a declared stop reaches the line again; the final one lets the test finish.
        if (++continued <= declaredStops) queueMicrotask(() => stopped('breakpoint'));
        return {};
      }
      if (command === 'stackTrace') return { stackFrames: [{ id: 1, name: 'loadTheme', line: observedLine, column: source.column, source: { path: sourceFile } }] } satisfies DebugProtocol.StackTraceResponse['body'];
      if (command === 'scopes') return { scopes: [{ name: 'Local', variablesReference: 1, expensive: false }] } satisfies DebugProtocol.ScopesResponse['body'];
      throw new Error(`Unexpected request ${command}`);
    } };
  class Breakpoint {
    constructor() { calls.push('arm'); }
    async registered() { return { status: 'bound' }; }
    async retire() { calls.push('retire'); duringRetire?.(); }
    remove() { calls.push('remove'); }
    onRequest() {}
    onResponse() {}
  }
  class OutputTerminal {
    readonly terminal = { name: 'Codebook · Test output' };
    async ready() {}
    write() {}
    reveal() {}
    dispose() {}
  }
  const editor = {
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    workspace: { getWorkspaceFolder: () => undefined },
    debug: {
      registerDebugAdapterTrackerFactory(_type: string, factory: vscode.DebugAdapterTrackerFactory) { trackerFactory = factory; return { dispose() {} }; },
      onDidTerminateDebugSession: () => ({ dispose() {} }),
      async startDebugging(_folder: unknown, configuration: vscode.DebugConfiguration) {
        // The run recognizes only sessions carrying its own configuration name.
        session.name = configuration.name; session.configuration = { ...session.configuration, name: configuration.name };
        const created = await trackerFactory?.createDebugAdapterTracker(session);
        tracker = created ?? undefined;
        queueMicrotask(() => stopped('entry'));
        return true;
      },
      async stopDebugging() { calls.push('stop-debugging'); },
    },
  };
  const module = await loadModule<typeof import('../ownedNodeTestRun')>(resolve(__dirname, '../ownedNodeTestRun.js'), {
    vscode: editor,
    './ownedRepositoryBreakpoint': { OwnedRepositoryBreakpoint: Breakpoint },
    './nodeTestOutputTerminal': { NodeTestOutputTerminal: OutputTerminal },
    './utils/prepareNodeTestLaunch': { prepareNodeTestLaunch: async () => launch },
    './utils/launchNodeTest': { launchNodeTest: async () => ({ processGroup: 4242, inspectorEndpoint: async () => 'ws://127.0.0.1:9229/owned', elapsedMs: () => 10,
      async result() { calls.push('result'); return { exitCode: 0, signal: null, output: 'Tests 1 passed' }; }, async close() {} }) },
    './utils/bindOwnedNodeTestDebugSession': { bindOwnedNodeTestDebugSession: async (value: vscode.DebugSession) => ({ session: value, identity: { pid: 1, processGroup: 4242, workspace: directory }, cdp: { close() {} } }) },
    './utils/inspectNodeTestVariables': { inspectNodeTestVariables: async () => ({ variables: [], facts: [] }) },
    './utils/captureReplayDebugSnapshot': { captureReplayDebugSnapshot: async () => ({ version: 1, frames: [], variables: [], limitations: [] }) },
  });
  const configuration: NodeTestConfiguration = { version: 1, adapter: 'vitest-node', book: { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 0 },
    testFile: 'theme.test.ts', testHash: sha256('test'), source, inspections: [] };
  const run = new module.OwnedNodeTestRun(directory, configuration, process.execPath, () => undefined);
  return { run, calls, cleanup: () => rm(directory, { recursive: true, force: true }),
    // Another debugger control resumes the accepted source pause outside Codebook.
    resume: () => tracker?.onDidSendMessage?.({ type: 'event', event: 'continued', body: { threadId: 1 } }),
    // The learner steps in the native debugger and the adapter reports the new pause without a `continued` event.
    stepToLaterPause: () => stopped('step'),
    // The native debugger sends a resume request; adapters need not follow it with a `continued` event.
    requestResume: (command: string) => tracker?.onWillReceiveMessage?.({ type: 'request', seq: 90, command, arguments: { threadId: 1 } }) };
}

test('continuing the final declared stop retires its owned breakpoint first so a repeated line cannot pause the finished test again', async () => {
  // Arrange
  const harness = await nodeRunHarness();
  try {
    await harness.run.prepare();
    harness.calls.length = 0;

    // Act
    const result = await harness.run.complete();

    // Assert
    assert.deepEqual(harness.calls, ['retire', 'continue', 'result']);
    assert.equal(result.exitCode, 0);
  } finally { await harness.run.stop(); await harness.cleanup(); }
});

test('advancing to the next declared stop retires the captured breakpoint before arming and continuing to the next one', async () => {
  // Arrange
  const harness = await nodeRunHarness({ declaredStops: 2 });
  try {
    await harness.run.prepare();
    harness.calls.length = 0;

    // Act
    const next = await harness.run.advance();

    // Assert
    assert.deepEqual(harness.calls, ['retire', 'arm', 'continue']);
    assert.equal(next.index, 1);
    assert.equal(harness.run.hasNextStop(), false);
  } finally { await harness.run.stop(); await harness.cleanup(); }
});

test('a source pause resumed outside Codebook cannot advance and releases the owned test', async () => {
  // Arrange
  const harness = await nodeRunHarness({ declaredStops: 2 });
  try {
    await harness.run.prepare();
    harness.calls.length = 0;

    // Act
    harness.resume();
    const advancing = harness.run.advance();

    // Assert
    await assert.rejects(advancing, /resumed before the next declared stop/);
    assert.deepEqual(harness.calls, ['remove', 'stop-debugging']);
  } finally { await harness.run.stop(); await harness.cleanup(); }
});

test('a native stop at another line of the declared source fails preparation instead of recording the wrong position', async () => {
  // Arrange
  const harness = await nodeRunHarness({ observedLine: 2 });
  try {
    // Act
    const preparing = harness.run.prepare();

    // Assert
    await assert.rejects(preparing, /stopped at 2:14 instead of declared 1:14/);
    assert.deepEqual(harness.calls, ['arm', 'continue', 'remove', 'stop-debugging']);
  } finally { await harness.run.stop(); await harness.cleanup(); }
});

test('finishing the test is refused while another declared source stop remains uncaptured', async () => {
  // Arrange
  const harness = await nodeRunHarness({ declaredStops: 2 });
  try {
    await harness.run.prepare();
    harness.calls.length = 0;

    // Act
    const completing = harness.run.complete();

    // Assert
    await assert.rejects(completing, /no final owned source pause/);
    assert.deepEqual(harness.calls, []);
  } finally { await harness.run.stop(); await harness.cleanup(); }
});

test('a final Codebook continue is refused after the learner stepped to a later pause, so it cannot resume that unaccepted pause', async () => {
  // Arrange
  const harness = await nodeRunHarness();
  try {
    await harness.run.prepare();
    harness.calls.length = 0;
    harness.stepToLaterPause();

    // Act
    const completing = harness.run.complete();

    // Assert
    await assert.rejects(completing, /resumed before the final continuation/);
    assert.deepEqual(harness.calls, [], 'neither the owned breakpoint nor the later pause is touched');
  } finally { await harness.run.stop(); await harness.cleanup(); }
});

test('a final Codebook continue is refused when the learner resumes while the owned breakpoint is being retired', async () => {
  // Arrange
  let requestResume = (_command: string): void => undefined;
  const harness = await nodeRunHarness({ duringRetire: () => requestResume('continue') });
  requestResume = harness.requestResume;
  try {
    await harness.run.prepare();
    harness.calls.length = 0;

    // Act
    const completing = harness.run.complete();

    // Assert
    await assert.rejects(completing, /resumed before the final continuation/);
    assert.deepEqual(harness.calls, ['retire'], 'the stale continue request is never sent');
  } finally { await harness.run.stop(); await harness.cleanup(); }
});

test('a native step request revokes the accepted pause before Codebook advances to the next declared stop', async () => {
  // Arrange
  const harness = await nodeRunHarness({ declaredStops: 2 });
  try {
    await harness.run.prepare();
    harness.calls.length = 0;
    harness.requestResume('next');

    // Act
    const advancing = harness.run.advance();

    // Assert
    await assert.rejects(advancing, /resumed before the next declared stop/);
    assert.deepEqual(harness.calls, ['remove', 'stop-debugging']);
  } finally { await harness.run.stop(); await harness.cleanup(); }
});

test('advancing refuses a stale Codebook continue when the learner resumes while the previous owned breakpoint is being retired', async () => {
  // Arrange
  let requestResume = (_command: string): void => undefined;
  const harness = await nodeRunHarness({ declaredStops: 2, duringRetire: () => requestResume('continue') });
  requestResume = harness.requestResume;
  try {
    await harness.run.prepare();
    harness.calls.length = 0;

    // Act
    const advancing = harness.run.advance();

    // Assert
    await assert.rejects(advancing, /resumed before the next declared stop/);
    assert.equal(harness.calls.includes('continue'), false, 'the stale continue request is never sent');
  } finally { await harness.run.stop(); await harness.cleanup(); }
});

test('advancing is refused after the learner stepped to a later pause, so it cannot resume that unaccepted pause', async () => {
  // Arrange
  const harness = await nodeRunHarness({ declaredStops: 2 });
  try {
    await harness.run.prepare();
    harness.calls.length = 0;
    harness.stepToLaterPause();

    // Act
    const advancing = harness.run.advance();

    // Assert
    await assert.rejects(advancing, /resumed before the next declared stop/);
    assert.deepEqual(harness.calls, ['remove', 'stop-debugging']);
  } finally { await harness.run.stop(); await harness.cleanup(); }
});

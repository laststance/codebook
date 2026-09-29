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

/** Drives one owned Node test run through fake editor/process ports, recording the order of breakpoint and continuation effects. @example const harness = await nodeRunHarness(); await harness.run.prepare() */
async function nodeRunHarness() {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-owned-node-run-'));
  const sourceText = 'export const nextTheme = "dark";\n', sourceFile = join(directory, 'theme.ts');
  await writeFile(sourceFile, sourceText);
  const source = { path: 'theme.ts', hash: sha256(sourceText), line: 1, column: 14 };
  const launch = { workspace: directory, testFile: join(directory, 'theme.test.ts'), sourceFile, program: 'vitest', args: [],
    stops: [{ file: sourceFile, source, inspections: [] }] };
  const calls: string[] = [];
  let trackerFactory: vscode.DebugAdapterTrackerFactory | undefined, tracker: vscode.DebugAdapterTracker | undefined, continued = 0;
  const stopped = (reason: string) => tracker?.onDidSendMessage?.({ type: 'event', event: 'stopped', body: { threadId: 1, reason } });
  const session = { id: 'owned-node-session', type: 'pwa-node', name: '', workspaceFolder: undefined, configuration: { type: 'pwa-node', name: '', request: 'attach' },
    getDebugProtocolBreakpoint: async () => undefined,
    async customRequest(command: string): Promise<unknown> {
      if (command === 'continue') {
        calls.push('continue');
        // The entry continuation reaches the declared line; the final one lets the test finish.
        if (++continued === 1) queueMicrotask(() => stopped('breakpoint'));
        return {};
      }
      if (command === 'stackTrace') return { stackFrames: [{ id: 1, name: 'loadTheme', line: source.line, column: source.column, source: { path: sourceFile } }] } satisfies DebugProtocol.StackTraceResponse['body'];
      if (command === 'scopes') return { scopes: [{ name: 'Local', variablesReference: 1, expensive: false }] } satisfies DebugProtocol.ScopesResponse['body'];
      throw new Error(`Unexpected request ${command}`);
    } };
  class Breakpoint {
    constructor() { calls.push('arm'); }
    async registered() { return { status: 'bound' }; }
    async retire() { calls.push('retire'); }
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
      async stopDebugging() {},
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
  return { run, calls, cleanup: () => rm(directory, { recursive: true, force: true }) };
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

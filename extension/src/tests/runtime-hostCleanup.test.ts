import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse';
import type * as HostModule from '../runtimeSupport/hostBrowser';

/** Loads the compiled adapter with controlled non-cancellable editor calls for cleanup regressions. @example await loadHostBrowser(editorStub) */
async function loadHostBrowser(editor: object, modules: Record<string, unknown> = {}, globals: Record<string, unknown> = {}): Promise<typeof HostModule.HostBrowser> {
  const filename = join(__dirname, '../runtimeSupport/hostBrowser.js');
  const nativeRequire = createRequire(filename);
  const exports: Partial<typeof HostModule> = {};
  runInNewContext(await readFile(filename, 'utf8'), {
    exports, URL, fetch, AbortSignal, ...globals,
    require: (name: string) => name === 'vscode' ? editor : name === './utils/awaitResponse' ? { awaitResponse: (response: PromiseLike<unknown>, description: string, signal?: AbortSignal) => awaitResponse(response, description, signal, 20) } : modules[name] ?? nativeRequire(name),
  }, { filename });
  assert.ok(exports.HostBrowser);
  return exports.HostBrowser;
}

test('a timed-out native tab is closed when its handle arrives after cleanup also times out', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-late-tab-'));
  const descriptor = join(directory, 'endpoint.json');
  await writeFile(descriptor, '{"port":9222}');
  let releaseTab!: (tab: { success: boolean; browserId: string }) => void;
  const acquisition = new Promise<{ success: boolean; browserId: string }>(resolve => { releaseTab = resolve; });
  const liveTabs = new Set<string>();
  const events: string[] = [];
  const commands = ['newTab', 'selectTab', 'closeTab', 'listTabs'].map(name => `cursor.browserView.${name}`);
  const HostBrowser = await loadHostBrowser({ commands: {
    getCommands: async () => commands,
    executeCommand: async (command: string, browserId: string) => {
      if (command.endsWith('newTab')) return acquisition;
      if (command.endsWith('closeTab')) { liveTabs.delete(browserId); return { success: true }; }
      return { tabs: [...liveTabs] };
    },
  } });
  const browser = new HostBrowser({ id: 'cursor', productVersion: 'test', apiVersion: 'test', commit: 'test', endpointPath: descriptor }, 'owned-run', 'http://127.0.0.1/owned', type => events.push(type), 'normal');
  try {
    // Act
    await assert.rejects(browser.launch({ type: 'editor-browser', name: 'owned', request: 'launch' }, new AbortController().signal), /Timed out waiting for Cursor browser creation/);
    await assert.rejects(browser.close(), /Timed out waiting for owned browser and debugger acquisitions/);
    assert.equal(events.includes('browser.cleanup-verified'), false);
    liveTabs.add('late-owned');
    releaseTab({ success: true, browserId: 'late-owned' });
    await delay(0);
    // Assert
    assert.deepEqual([...liveTabs], []);
    await browser.close();
    assert.equal(events.filter(event => event === 'browser.cleanup-verified').length, 1);
  } finally { await rm(directory, { recursive: true }); }
});

test('a debugger acquisition deadline cannot certify cleanup while the native launch is still pending', async () => {
  // Arrange
  let releaseDebugger!: (launched: boolean) => void;
  const acquisition = new Promise<boolean>(resolve => { releaseDebugger = resolve; });
  const events: string[] = [];
  const HostBrowser = await loadHostBrowser({ debug: { startDebugging: () => acquisition }, window: { tabGroups: { all: [] } } });
  const browser = new HostBrowser({ id: 'vscode', productVersion: 'test', apiVersion: 'test', commit: 'test' }, 'owned-run', 'http://127.0.0.1/owned', type => events.push(type), 'normal');
  // Act
  await assert.rejects(browser.launch({ type: 'editor-browser', name: 'owned', request: 'launch' }, new AbortController().signal), /Timed out waiting for owned debugger launch/);
  await assert.rejects(browser.close(), /Timed out waiting for owned browser and debugger acquisitions/);
  // Assert
  assert.equal(events.includes('browser.cleanup-verified'), false);
  releaseDebugger(true);
  await browser.close();
  assert.equal(events.filter(event => event === 'browser.cleanup-verified').length, 1);
});

test('a pending debugger launch releases the already acquired Cursor tab and bridge before cleanup fails', async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-known-tab-'));
  const descriptor = join(directory, 'endpoint.json');
  await writeFile(descriptor, '{"port":9222}');
  const liveTabs = new Set(['unrelated']);
  const events: string[] = [];
  const url = 'http://127.0.0.1/owned';
  let releaseDebugger!: (launched: boolean) => void;
  const acquisition = new Promise<boolean>(resolve => { releaseDebugger = resolve; });
  let bridgeClosed = 0;
  const HostBrowser = await loadHostBrowser({
    commands: {
      getCommands: async () => ['newTab', 'selectTab', 'closeTab', 'listTabs'].map(name => `cursor.browserView.${name}`),
      executeCommand: async (command: string, browserId: string) => {
        if (command.endsWith('newTab')) { liveTabs.add('owned'); return { success: true, browserId: 'owned' }; }
        if (command.endsWith('closeTab')) { liveTabs.delete(browserId); return { success: true }; }
        return { tabs: [...liveTabs] };
      },
    },
    debug: { startDebugging: () => acquisition },
  }, { './cursorCdpBridge': { CursorCdpBridge: class {
    async listen() { return 9223; }
    async close() { bridgeClosed++; }
  } } }, { fetch: async (address: string) => ({ ok: true, json: async () => address.endsWith('/json/list') ? [{ id: 'owned', type: 'webview', url }] : { webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test' } }) });
  const browser = new HostBrowser({ id: 'cursor', productVersion: 'test', apiVersion: 'test', commit: 'test', endpointPath: descriptor }, 'owned-run', url, type => events.push(type), 'normal');
  try {
    // Act
    await assert.rejects(browser.launch({ type: 'editor-browser', name: 'owned', request: 'launch' }, new AbortController().signal), /Timed out waiting for owned debugger launch/);
    await assert.rejects(browser.close(), /Timed out waiting for owned browser and debugger acquisitions/);
    // Assert
    assert.equal(bridgeClosed, 1);
    assert.deepEqual([...liveTabs], ['unrelated']);
    assert.equal(events.includes('browser.cleanup-verified'), false);
    releaseDebugger(true);
    await browser.close();
    assert.equal(events.filter(event => event === 'browser.cleanup-verified').length, 1);
  } finally { releaseDebugger(true); await rm(directory, { recursive: true }); }
});

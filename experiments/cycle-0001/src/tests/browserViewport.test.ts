import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import type * as ViewportModule from '../browserViewport';
import type { Scenario } from '../constants';

/** Drives actual {@link BrowserViewport} through editor lifecycle boundaries without pretending to verify native paint. @example await viewportHarness('normal') */
async function viewportHarness(scenario: Scenario) {
  const filename = join(__dirname, '../browserViewport.js');
  const nativeRequire = createRequire(filename);
  const exports: Partial<typeof ViewportModule> = {};
  const messages: Record<string, unknown>[] = [];
  let receive: (message: unknown) => void = () => undefined;
  let visibilityChanged = () => undefined;
  let disposed = () => undefined;
  const panel = {
    visible: true,
    reveal() { panel.visible = true; visibilityChanged(); },
    dispose() { disposed(); },
    onDidDispose(callback: () => undefined) { disposed = callback; },
    onDidChangeViewState(callback: () => undefined) { visibilityChanged = callback; },
    webview: {
      html: '',
      onDidReceiveMessage(callback: (message: unknown) => void) { receive = callback; },
      postMessage(message: Record<string, unknown>) { messages.push(message); return Promise.resolve(true); },
    },
  };
  runInNewContext(await readFile(filename, 'utf8'), {
    exports, Buffer,
    require: (name: string) => name === 'vscode' ? { window: { createWebviewPanel: () => panel }, ViewColumn: { One: 1 } } : nativeRequire(name),
  }, { filename });
  assert.ok(exports.BrowserViewport);
  const viewport = new exports.BrowserViewport('owned-run', () => undefined, () => undefined, scenario);
  return {
    viewport, messages,
    hide() { panel.visible = false; visibilityChanged(); },
    ready(epoch: string) {
      receive({ type: 'ready', epoch });
      receive({ type: 'ready', epoch, requestId: messages.findLast(message => message.type === 'requestReady')?.requestId });
    },
    receive: (message: unknown) => receive(message),
  };
}

test('revealing a destroyed renderer cannot confirm an image using its old readiness response', async () => {
  // Arrange
  const harness = await viewportHarness('normal');
  const firstEpoch = '11111111-1111-1111-1111-111111111111';
  const secondEpoch = '22222222-2222-2222-2222-222222222222';
  harness.ready(firstEpoch);
  const oldRequest = harness.messages.findLast(message => message.type === 'requestReady');
  harness.hide();
  let revealed = false;
  const reveal = harness.viewport.reveal(new AbortController().signal).then(() => { revealed = true; });
  // Act
  harness.receive({ type: 'ready', epoch: firstEpoch, requestId: oldRequest?.requestId });
  await delay(0);
  // Assert
  assert.equal(revealed, false);
  harness.ready(secondEpoch);
  await reveal;
  const capture = harness.viewport.present('YWZ0ZXI=', 'after');
  await delay(0);
  const sent = harness.messages.findLast(message => message.type === 'frame');
  assert.equal(sent?.epoch, secondEpoch);
  harness.receive({ type: 'painted', epoch: secondEpoch, id: sent?.id });
  assert.equal((await capture).epoch, secondEpoch);
  harness.viewport.close();
});

test('continuation during renderer reload prevents the retired pause from being displayed or acknowledged', async () => {
  // Arrange
  const harness = await viewportHarness('viewport-reload');
  harness.ready('11111111-1111-1111-1111-111111111111');
  const capture = harness.viewport.present('cGF1c2U=', 'paused-1');
  const rejected = assert.rejects(capture, /presentation invalidated/);
  // Act
  harness.viewport.resume();
  harness.ready('22222222-2222-2222-2222-222222222222');
  await rejected;
  // Assert
  assert.equal(harness.messages.some(message => message.type === 'frame' && message.phase === 'paused-1'), false);
  harness.viewport.close();
});

test('invalidating a displayed pause rejects its late acknowledgement before any newer image can be certified', async () => {
  // Arrange
  const harness = await viewportHarness('normal');
  const epoch = '11111111-1111-1111-1111-111111111111';
  harness.ready(epoch);
  const capture = harness.viewport.present('cGF1c2U=', 'paused-1');
  const rejected = assert.rejects(capture, /Pause display invalidated/);
  await delay(0);
  const sent = harness.messages.findLast(message => message.type === 'frame');
  // Act
  harness.viewport.resume();
  harness.receive({ type: 'painted', epoch, id: sent?.id });
  // Assert
  await rejected;
  assert.equal(harness.messages.at(-1)?.type, 'reset');
  harness.viewport.close();
});

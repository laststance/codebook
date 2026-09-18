import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { PROFILE_ID } from '../constants';
import { LearningLibrary } from '../learningLibrary';
import { createHarness } from './helpers';
import { loadModule } from './utils/loadModule';

/** Keeps native presentation inert while exercising actual checkpoints, source watching and durable decisions. @example const reader = await workspaceHarness() */
async function workspaceHarness(attach = true) {
  const harness = await createHarness(), fixture = join(harness.directory, 'experiments/cycle-0004/fixture');
  await mkdir(fixture, { recursive: true });
  await writeFile(join(fixture, 'server.mts'), 'const price = 24;'); await writeFile(join(fixture, 'client.mts'), 'const count = 1;');
  let changed = () => {};
  const disposable = () => ({ dispose() {} });
  let outlineUpdates = 0;
  class EventEmitter { event = () => disposable(); fire() { outlineUpdates++; } dispose() {} }
  class Uri {
    readonly fsPath: string;
    constructor(readonly scheme: string, readonly authority: string, readonly path: string, readonly query = '', readonly fragment = '') { this.fsPath = path; }
    static from(value: { scheme: string; authority: string; path: string }) { return new Uri(value.scheme, value.authority, value.path); }
    static file(path: string) { return new Uri('file', '', path); }
    toString() { return `${this.scheme}://${this.authority}${this.path}`; }
  }
  class TabInputText { constructor(readonly uri: Uri) {} }
  type Tab = { input: TabInputText };
  const groups: { viewColumn: number; tabs: Tab[]; activeTab?: Tab }[] = [{ viewColumn: 2, tabs: [] }];
  let sourceProvider = async (_uri: Uri) => '';
  let nextOpen: { wait: Promise<void>; entered(): void } | undefined;
  let nextCommand: { name: string; wait: Promise<void>; entered(): void } | undefined;
  const commands: string[] = [];
  const panels = new Set<ReturnType<typeof panel>>();
  const receivers = new Map<string, (message: unknown) => void>();
  function panel(kind: string) {
    const value = { webview: { html: '', postMessage: async () => true, onDidReceiveMessage: (callback: (message: unknown) => void) => { receivers.set(kind, callback); return disposable(); } }, title: '', reveal() {}, onDidDispose: disposable, onDidChangeViewState: disposable, dispose() { panels.delete(value); } };
    panels.add(value); return value;
  }
  const initialSelection: string[] = [];
  const outline = { ...disposable(), visible: true, selection: initialSelection, onDidChangeCheckboxState: disposable, onDidChangeVisibility: disposable,
    reveal: async (participant: string, options: { select: boolean; focus: boolean }) => { assert.equal(options.focus, false); if (options.select) outline.selection = [participant]; } };
  const watcher = { onDidChange(callback: () => void) { changed = callback; return disposable(); }, onDidCreate: disposable, onDidDelete: disposable, dispose() {} };
  const boundary = await loadModule<typeof import('../studyWorkspace')>(resolve(__dirname, '../studyWorkspace.js'), {
    vscode: { EventEmitter, Uri, TabInputText, Position: class {}, Range: class {}, ViewColumn: { One: 1, Two: 2, Three: 3 }, ThemeColor: class {}, RelativePattern: class {},
      commands: { executeCommand: async (name: string) => { commands.push(name); const held = nextCommand; if (held?.name === name) { nextCommand = undefined; held.entered(); await held.wait; } } },
      window: { createTextEditorDecorationType: disposable, createTreeView: () => outline, registerWebviewViewProvider: disposable, onDidChangeActiveTextEditor: disposable, createWebviewPanel: panel,
        showTextDocument: async (document: { uri: Uri; getText(): string }) => { const tab = { input: new TabInputText(document.uri) }; groups[0]!.tabs.push(tab); groups[0]!.activeTab = tab; return { document, setDecorations() {} }; },
        tabGroups: { all: groups, close: async (tabs: Tab[]) => { groups[0]!.tabs = groups[0]!.tabs.filter(tab => !tabs.includes(tab)); return true; } } },
      workspace: { textDocuments: [], registerTextDocumentContentProvider: (_scheme: string, provider: { provideTextDocumentContent(uri: Uri): Promise<string> }) => { sourceProvider = provider.provideTextDocumentContent; return disposable(); },
        openTextDocument: async (uri: Uri) => { const held = nextOpen; nextOpen = undefined; if (held) { held.entered(); await held.wait; } const text = await sourceProvider(uri); return { uri, getText: () => text }; },
        onDidChangeTextDocument: disposable, createFileSystemWatcher: () => watcher } },
    './environment': { requireWorkspace: () => harness.directory }, 'codebook-cycle-0001/dist/browserViewport': {},
  });
  const controls = { start: async () => harness.service, connect: async () => {} };
  const createReader = () => new boundary.StudyWorkspace({ extensionPath: join(harness.directory, 'extension'), globalStorageUri: { fsPath: join(harness.directory, 'storage') }, subscriptions: [] }, controls);
  const reader = createReader();
  if (attach) { await reader.attach(harness.service); await reader.selectProfile('paired-cart-demo'); await reader.action('return-current'); }
  return { ...harness, reader, createReader, fixture, groups, controls, outline, commands, receive: (message: unknown) => receivers.get('codebook.studyContext')!(message), counts: () => ({ panels: panels.size, outlineUpdates }), changed: () => changed(),
    holdNextCommand(name: string) {
      let release = () => {}, entered = () => {};
      const started = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
      nextCommand = { name, wait, entered }; return { started, release };
    },
    holdNextSource() {
      let release = () => {}, reject = (_error: Error) => {}, entered = () => {};
      const started = new Promise<void>(resolve => { entered = resolve; });
      const wait = new Promise<void>((resolve, rejectPromise) => { release = resolve; reject = rejectPromise; });
      nextOpen = { wait, entered }; return { started, release, reject };
    },
    async close() { await reader.retire(harness.service); await reader.dispose(); await harness.close(); } };
}

test('retiring before the next polling tick preserves the last accepted interpretation and terminal state', async context => {
  // Arrange: the poll never fires; finalization must explicitly collect the latest service state.
  context.mock.timers.enable({ apis: ['setInterval'] });
  const harness = await workspaceHarness(), service = harness.service;
  try {
    const receipt = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'last-tick' });
    const record = service.record(receipt); await record.preparation;
    service.action({ instanceId: service.instanceId, runId: receipt.runId, action: 'add-to-cart', key: 'one' });
    const snapshotUri = service.state(record).participants.server.snapshotUri!;
    await service.explain({ instanceId: service.instanceId, runId: receipt.runId, key: 'last-explanation', snapshotUri, sourceHash: sha256('const price = 24;'), valuePaths: ['price'], interpretation: 'The captured price is 24 before this final shutdown.' });
    // Act
    await service.shutdown(); await harness.reader.retire(service);
    const directory = harness.reader.inspect().libraryDirectory!, library = new LearningLibrary(directory, directory.split('/').at(-1)!);
    const archives = await library.list(), archive = await library.readStudy(archives[0]!.id);
    // Assert
    assert.equal(archives.length, 1); assert.equal(archive.terminal, true); assert.equal(archive.observations.length, 1);
    assert.equal(archive.observations[0]!.interpretations[0]!.text, 'The captured price is 24 before this final shutdown.');
    assert.equal((await library.readProgress()).decisions.length, 0, 'Execution and explanation never mark understanding');
  } finally { await harness.close(); context.mock.timers.reset(); }
});

test('a fresh workspace offers four checkout learning items while an explicit paired choice keeps its two-item progress', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    // Act
    await harness.reader.open();
    const initial = harness.reader.inspect().view!;
    await harness.reader.selectProfile('paired-cart-demo');
    const paired = harness.reader.inspect().view!;
    // Assert
    assert.equal(initial.model.selection.profile, 'checkout-demo'); assert.equal(initial.model.selection.itemId, 'checkout-demo/cart-mutation');
    assert.deepEqual(initial.model.progressByItem.map(item => item.title), ['Cart mutation', 'Cart update', 'Order creation', 'Purchase confirmation']);
    assert.equal(initial.model.understoodCount, 0); assert.equal(paired.model.progressByItem.length, 2);
    assert.equal(paired.model.selection.itemId, 'paired-cart-demo/server');
  } finally { await harness.close(); }
});

test('a reader keeps the cart moment while the same server reaches order creation and only Return selects the live item', async () => {
  // Arrange
  const harness = await workspaceHarness(), service = harness.service;
  try {
    await harness.reader.selectProfile('checkout-demo'); await harness.reader.action('run');
    const record = [...service.records.values()][0]!; await record.preparation;
    await harness.reader.action('click'); await harness.reader.open();
    await harness.reader.select('checkout-demo/cart-mutation');
    const original = harness.reader.inspect().sourceUri;
    await service.continue(service.state(record).participants.server.continueArguments!);
    harness.runtimes[0]!.status = 'ready';
    // Act
    await harness.reader.action('click'); await harness.reader.open();
    const history = harness.reader.inspect().view!;
    await assert.rejects(harness.reader.selectProfile('paired-cart-demo'), /Stop the active study/);
    // Assert
    assert.equal(history.model.selection.itemId, 'checkout-demo/cart-mutation'); assert.equal(history.model.currentItemTitle, 'Order creation');
    assert.equal(history.model.observation?.values.cartCount, 0); assert.equal(history.model.continueArguments, undefined);
    assert.equal(harness.reader.inspect().sourceUri, original);
    await harness.reader.action('return-current');
    assert.equal(harness.reader.inspect().view!.model.selection.itemId, 'checkout-demo/order-creation');
    assert.equal(harness.reader.inspect().view!.model.observation?.values.cartCount, 1);
    assert.equal(harness.runtimes[0]!.dispatches, 2);
  } finally { await harness.close(); }
});

test('a successful runtime with a rejected final history write stays partial in both service and reader until Retry', async context => {
  // Arrange
  const harness = await workspaceHarness(), service = harness.service, saveStudy = LearningLibrary.prototype.saveStudy;
  let rejectFinal = true;
  context.mock.method(LearningLibrary.prototype, 'saveStudy', async function (this: LearningLibrary, study: Parameters<LearningLibrary['saveStudy']>[0]) {
    if (study.terminal && rejectFinal) throw new Error('Injected archive size limit');
    return saveStudy.call(this, study);
  });
  try {
    await harness.reader.action('run'); const record = [...service.records.values()][0]!; await record.preparation;
    const runtime = harness.runtimes[0]!, view = runtime.view.bind(runtime);
    runtime.view = () => ({ ...view(), finalOutcome: 'demonstrated' });
    await harness.reader.open();
    // Act
    await assert.rejects(harness.reader.action('stop'), /archive size limit/);
    const stopped = await service.stop({ instanceId: service.instanceId, runId: record.id }), reader = harness.reader.inspect().view!;
    // Assert
    assert.equal(stopped.finalOutcome, 'demonstrated'); assert.equal(stopped.historyOutcome.status, 'failed'); assert.equal(stopped.studyOutcome, 'partial');
    assert.equal(reader.study?.historyOutcome, 'failed'); assert.equal(reader.study?.studyOutcome, 'partial');
    rejectFinal = false; await harness.reader.action('retry');
    assert.equal(service.state(record).studyOutcome, 'demonstrated'); assert.equal(harness.reader.inspect().view!.study?.studyOutcome, 'demonstrated');
  } finally { rejectFinal = false; context.mock.restoreAll(); await harness.close(); }
});

test('a closed source file change marks prior understanding for review without changing the saved learner decision', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    await harness.reader.understand(true);
    const directory = harness.reader.inspect().libraryDirectory!, before = await readFile(join(directory, 'progress.v2.json'), 'utf8');
    const updatesBefore = harness.counts().outlineUpdates;
    assert.equal(harness.reader.inspect().view!.model.understoodCount, 1);
    // Act: the editor has no open source document; the filesystem watcher owns this update.
    await writeFile(join(harness.fixture, 'server.mts'), 'const price = 25;'); harness.changed();
    await waitUntil(() => harness.reader.inspect().view!.model.reviewCount === 1, 'closed source review signal', 1_000);
    // Assert
    assert.equal(harness.reader.inspect().view!.model.understoodCount, 0);
    assert.equal(await readFile(join(directory, 'progress.v2.json'), 'utf8'), before);
    assert.equal(harness.reader.inspect().view!.model.source.hash, sha256('const price = 25;'));
    assert.ok(harness.counts().outlineUpdates > updatesBefore, 'The closed reader still updates its installed outline');
  } finally { await harness.close(); }
});

test('returning to the original item while another source opens cannot display the obsolete source', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    await harness.reader.open(); await harness.reader.select('paired-cart-demo/server'); const held = harness.holdNextSource();
    const browserSelection = harness.reader.select('paired-cart-demo/browser'); await held.started;
    // Act
    const serverSelection = harness.reader.select('paired-cart-demo/server'); held.release();
    await Promise.all([browserSelection, serverSelection]);
    // Assert
    assert.equal(harness.reader.inspect().view!.model.selection.itemId, 'paired-cart-demo/server');
    assert.match(harness.reader.inspect().sourceUri!, /Captured-server\.mts$/);
    assert.equal(harness.reader.inspect().view!.loading, false);
  } finally { await harness.close(); }
});

test('reopening the reader restores a captured source tab after Close removed it', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    await harness.reader.open(); await harness.reader.close();
    assert.equal(harness.groups[0]!.tabs.length, 0);
    // Act
    await harness.reader.open();
    // Assert
    assert.equal(harness.groups[0]!.tabs.length, 1);
    assert.match(harness.groups[0]!.activeTab!.input.uri.toString(), /Captured-server\.mts$/);
  } finally { await harness.close(); }
});

test('an obsolete source failure cannot clear the loading guard of its replacement', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    await harness.reader.open(); const first = harness.holdNextSource();
    const selecting = harness.reader.select('paired-cart-demo/browser'); await first.started;
    const second = harness.holdNextSource(); const revealing = harness.reader.action('source');
    await waitUntil(() => harness.reader.inspect().view!.revision >= 3, 'replacement selection', 1_000);
    // Act
    first.reject(new Error('Obsolete open failed')); await second.started;
    // Assert: the replacement document is still unresolved.
    const loading = harness.reader.inspect().view!.loading, errors = harness.reader.inspect().view!.errors;
    second.release(); await Promise.all([selecting, revealing]);
    assert.equal(loading, true); assert.equal(errors.some(error => error.includes('Obsolete open failed')), false);
  } finally { await harness.close(); }
});

test('the first understanding command after reload applies to the restored item rather than the startup default', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    const key = sha256(await realpath(harness.directory));
    const library = new LearningLibrary(join(harness.directory, 'storage/learning', key), key);
    await library.select({ profile: 'paired-cart-demo', itemId: 'paired-cart-demo/browser', follow: false, tab: 'overview' });
    // Act
    await harness.reader.understand(true);
    // Assert
    const progress = await library.readProgress();
    assert.equal(progress.decisions[0]!.item, 'paired-cart-demo/browser');
    assert.equal(progress.decisions[0]!.sourceHash, sha256('const count = 1;'));
  } finally { await harness.close(); }
});

test('Close during initialization prevents the pending Open from recreating reader panes', async context => {
  // Arrange
  const harness = await workspaceHarness(false), readProgress = LearningLibrary.prototype.readProgress;
  let entered = () => {}, release = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  context.mock.method(LearningLibrary.prototype, 'readProgress', async function (this: LearningLibrary) { entered(); await held; return readProgress.call(this); });
  try {
    const opening = harness.reader.open(); await started;
    // Act
    await harness.reader.close(); release();
    await assert.rejects(opening, /closed/);
    // Assert
    assert.equal(harness.reader.inspect().opened, false); assert.equal(harness.counts().panels, 0);
  } finally { release(); context.mock.restoreAll(); await harness.close(); }
});

test('Close during service startup prevents the pending Run from launching execution afterward', async () => {
  // Arrange
  const harness = await workspaceHarness();
  let entered = () => {}, release = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  harness.controls.start = async () => { entered(); await held; return harness.service; };
  try {
    const running = harness.reader.action('run'); await started;
    // Act
    await harness.reader.close(); release();
    await assert.rejects(running, /closed/);
    // Assert
    assert.equal(harness.service.records.size, 0); assert.equal(harness.reader.inspect().opened, false);
  } finally { release(); await harness.close(); }
});

test('an unavailable current source cannot retain a current-understanding claim and restoring it recovers the saved decision', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    await harness.reader.understand(true);
    const path = join(harness.fixture, 'server.mts');
    // Act
    await unlink(path); harness.changed();
    await waitUntil(() => harness.reader.inspect().view!.errors.some(error => error.includes('unavailable')), 'unavailable source error', 1_000);
    const unavailableCount = harness.reader.inspect().view!.model.understoodCount;
    await writeFile(path, 'const price = 24;'); harness.changed();
    await waitUntil(() => harness.reader.inspect().view!.errors.length === 0, 'restored source baseline', 1_000);
    // Assert
    assert.equal(unavailableCount, 0); assert.equal(harness.reader.inspect().view!.model.understoodCount, 1);
    const directory = harness.reader.inspect().libraryDirectory!, progress = await new LearningLibrary(directory, directory.split('/').at(-1)!).readProgress();
    assert.equal(progress.decisions.length, 1);
  } finally { await harness.close(); }
});

test('a slow archive writer does not delay inspection of the committed live pause', async context => {
  // Arrange
  const harness = await workspaceHarness(), saveStudy = LearningLibrary.prototype.saveStudy;
  let entered = () => {}, release = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  context.mock.method(LearningLibrary.prototype, 'saveStudy', async function (this: LearningLibrary, study: Parameters<LearningLibrary['saveStudy']>[0]) { entered(); await held; return saveStudy.call(this, study); });
  try {
    const receipt = harness.service.start({ instanceId: harness.service.instanceId, profile: PROFILE_ID, key: 'slow-library' });
    await harness.service.record(receipt).preparation;
    harness.service.action({ instanceId: harness.service.instanceId, runId: receipt.runId, action: 'add-to-cart', key: 'one' });
    // Act
    const opening = harness.reader.open(); await started;
    const inspectedWhileSaving = await waitUntil(() => {
      const view = harness.reader.inspect().view!;
      return !view.loading && view.model.observation?.values.price === 24 && view.model.matching;
    }, 'inspection independent of archive write', 1_000).catch(() => false);
    release(); await opening;
    // Assert
    assert.equal(inspectedWhileSaving, true);
  } finally { release(); context.mock.restoreAll(); await harness.close(); }
});

test('the latest saved-study choice wins when the earlier archive read completes first', async context => {
  // Arrange
  const harness = await workspaceHarness(), readStudy = LearningLibrary.prototype.readStudy;
  let releaseFirst = () => {}, releaseLatest = () => {}, firstFinished = false, reads = 0;
  const firstHeld = new Promise<void>(resolve => { releaseFirst = resolve; }), latestHeld = new Promise<void>(resolve => { releaseLatest = resolve; });
  try {
    const directory = harness.reader.inspect().libraryDirectory!, workspaceKey = directory.split('/').at(-1)!;
    const library = new LearningLibrary(directory, workspaceKey), instanceId = randomUUID(), firstRun = randomUUID(), latestRun = randomUUID();
    const firstId = `${instanceId}_${firstRun}`, latestId = `${instanceId}_${latestRun}`;
    for (const runId of [firstRun, latestRun]) await library.saveStudy({ version: 2, workspaceKey, id: `${instanceId}_${runId}`, instanceId, runId, profile: 'paired-cart-demo', createdAt: '2026-09-18T10:00:00.000Z', savedAt: '2026-09-18T10:00:01.000Z', state: 'stopped', terminal: true, finalOutcome: 'partial', materialSignature: sha256('test-checkpoint'), observations: [], captures: [], links: [] });
    await harness.reader.action('retry'); await harness.reader.open();
    const revision = harness.reader.inspect().view!.revision;
    context.mock.method(LearningLibrary.prototype, 'readStudy', async function (this: LearningLibrary, id: string) {
      reads++; await (id === firstId ? firstHeld : latestHeld);
      const study = await readStudy.call(this, id); if (id === firstId) firstFinished = true; return study;
    });
    // Act
    harness.receive({ type: 'history', revision, studyId: firstId }); harness.receive({ type: 'history', revision, studyId: latestId });
    await waitUntil(() => reads === 2, 'both accepted history reads', 1_000);
    releaseFirst(); await waitUntil(() => firstFinished, 'earlier archive read', 1_000);
    releaseLatest(); await waitUntil(() => harness.reader.inspect().view!.model.selection.studyId === latestId && !harness.reader.inspect().view!.loading, 'latest selected history', 1_000);
    // Assert
    assert.equal(harness.reader.inspect().view!.study!.id, latestId);
  } finally { releaseFirst(); releaseLatest(); context.mock.restoreAll(); await harness.close(); }
});

test('selecting a browser moment updates the native outline without requesting keyboard focus', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    await harness.reader.open(); assert.deepEqual(harness.outline.selection, ['paired-cart-demo/server']);
    // Act
    harness.receive({ type: 'select', revision: harness.reader.inspect().view!.revision, itemId: 'paired-cart-demo/browser' });
    await waitUntil(() => harness.outline.selection[0] === 'paired-cart-demo/browser', 'native outline selection', 1_000);
    // Assert
    assert.equal(harness.reader.inspect().view!.model.selection.itemId, 'paired-cart-demo/browser');
  } finally { await harness.close(); }
});

test('repeated source edits replace the transient reader tab instead of accumulating revision tabs', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    await harness.reader.open();
    // Act
    for (let revision = 0; revision < 40; revision++) {
      const text = `const price = ${revision};`;
      await writeFile(join(harness.fixture, 'server.mts'), text); harness.changed();
      await waitUntil(() => harness.reader.inspect().sourceUri?.includes(sha256(text)) && !harness.reader.inspect().view!.loading, 'updated source reader', 1_000);
    }
    // Assert
    assert.equal(harness.groups[0]!.tabs.length, 1);
    assert.match(harness.groups[0]!.activeTab!.input.uri.toString(), /Captured-server\.mts$/);
  } finally { await harness.close(); }
});

test('an older successful save cannot erase the failed final archive from explicit Retry', async context => {
  // Arrange
  const harness = await workspaceHarness(), saveStudy = LearningLibrary.prototype.saveStudy;
  let releaseFirst = () => {}, releaseFinal = () => {}, writes = 0;
  const firstHeld = new Promise<void>(resolve => { releaseFirst = resolve; }), finalHeld = new Promise<void>(resolve => { releaseFinal = resolve; });
  context.mock.method(LearningLibrary.prototype, 'saveStudy', async function (this: LearningLibrary, study: Parameters<LearningLibrary['saveStudy']>[0]) {
    const attempt = ++writes;
    if (attempt === 1) await firstHeld;
    if (attempt === 2) { await finalHeld; throw new Error('Final archive write denied'); }
    return saveStudy.call(this, study);
  });
  try {
    const receipt = harness.service.start({ instanceId: harness.service.instanceId, profile: PROFILE_ID, key: 'retry-final' });
    await harness.service.record(receipt).preparation;
    const opening = harness.reader.open(); await waitUntil(() => writes === 1, 'initial archive write', 1_000);
    // Act
    const stopping = harness.reader.action('stop');
    await waitUntil(() => harness.service.record(receipt).stopped, 'runtime physically stopped', 1_000);
    releaseFirst(); await opening;
    await waitUntil(() => writes === 2, 'final archive write', 1_000);
    releaseFinal(); await assert.rejects(stopping, /Final archive write denied/);
    await harness.reader.action('retry');
    // Assert
    const directory = harness.reader.inspect().libraryDirectory!, library = new LearningLibrary(directory, directory.split('/').at(-1)!);
    assert.equal((await library.readStudy(`${receipt.instanceId}_${receipt.runId}`)).terminal, true);
    assert.ok(writes >= 3, 'Retry attempted the pending final projection');
  } finally { releaseFirst(); releaseFinal(); context.mock.restoreAll(); await harness.close(); }
});


test('Close drains an accepted arrangement without issuing another layout change afterward', async () => {
  // Arrange
  const harness = await workspaceHarness();
  let release = () => {};
  try {
    await harness.reader.open();
    const widthsBefore = harness.commands.filter(name => name === 'workbench.action.evenEditorWidths').length;
    const held = harness.holdNextCommand('vscode.setEditorLayout'); release = held.release;
    const arranging = harness.reader.action('arrange'); await held.started;
    let closed = false;
    // Act
    const closing = harness.reader.close().then(() => { closed = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    const closedWhileArrangementPending = closed;
    held.release(); await arranging.catch(() => undefined); await closing;
    // Assert
    assert.equal(closedWhileArrangementPending, false);
    assert.equal(harness.commands.filter(name => name === 'workbench.action.evenEditorWidths').length, widthsBefore);
    assert.equal(harness.reader.inspect().opened, false);
  } finally { release(); await harness.close(); }
});


test('Retry saves the failed learner choice for its original item exactly once after selection changes', async context => {
  // Arrange
  const harness = await workspaceHarness(), decide = LearningLibrary.prototype.decide;
  const attempts: Parameters<LearningLibrary['decide']>[0][] = [];
  context.mock.method(LearningLibrary.prototype, 'decide', async function (this: LearningLibrary, intent: Parameters<LearningLibrary['decide']>[0]) {
    attempts.push(intent);
    if (attempts.length === 1) throw new Error('Understanding write denied');
    return decide.call(this, intent);
  });
  try {
    await harness.reader.open();
    // Act
    await assert.rejects(harness.reader.understand(true), /Understanding write denied/);
    assert.equal(harness.reader.inspect().view!.model.selectedUnderstanding.understood, false);
    await harness.reader.select('paired-cart-demo/browser');
    await harness.reader.action('retry'); await harness.reader.action('retry');
    // Assert
    const directory = harness.reader.inspect().libraryDirectory!, library = new LearningLibrary(directory, directory.split('/').at(-1)!);
    const progress = await library.readProgress();
    assert.equal(progress.decisions.length, 1);
    assert.equal(progress.decisions[0]!.item, 'paired-cart-demo/server');
    assert.equal(progress.decisions[0]!.sourceHash, sha256('const price = 24;'));
    assert.equal(progress.decisions[0]!.understood, true);
    assert.equal(attempts[1]!.id, attempts[0]!.id);
    assert.equal(harness.reader.inspect().view!.model.selectedUnderstanding.understood, false);
    assert.equal(harness.reader.inspect().view!.model.understoodCount, 1);
  } finally { context.mock.restoreAll(); await harness.close(); }
});


test('saved history and explicit understanding recovery remain available without current fixture files', async () => {
  // Arrange
  const harness = await workspaceHarness();
  let cold: ReturnType<typeof harness.createReader> | undefined;
  try {
    const receipt = harness.service.start({ instanceId: harness.service.instanceId, profile: PROFILE_ID, key: 'offline-source' });
    await harness.service.record(receipt).preparation;
    harness.service.action({ instanceId: harness.service.instanceId, runId: receipt.runId, action: 'add-to-cart', key: 'one' });
    await harness.service.shutdown(); await harness.reader.retire(harness.service); await harness.reader.dispose();
    await unlink(join(harness.fixture, 'server.mts')); await unlink(join(harness.fixture, 'client.mts'));
    // Act
    cold = harness.createReader(); await cold.open();
    // Assert
    const view = cold.inspect().view!;
    assert.equal(view.model.observation!.source.text, 'const price = 24;');
    assert.equal(view.model.currentSourceAvailable, false);
    assert.equal(view.model.understoodCount, 0);
    assert.equal(view.model.continueArguments, undefined);
    assert.match(cold.inspect().sourceUri!, /Captured-server\.mts$/);
    assert.ok(view.errors.some(error => error.includes('unavailable')));
    const directory = cold.inspect().libraryDirectory!;
    await writeFile(join(directory, 'writer.lock'), 'Injected interrupted writer');
    await assert.rejects(cold.understand(true), /locked/);
    await unlink(join(directory, 'writer.lock')); await cold.action('retry');
    const progress = await new LearningLibrary(directory, directory.split('/').at(-1)!).readProgress();
    assert.equal(progress.decisions.length, 1);
    assert.equal(progress.decisions[0]!.sourceHash, sha256('const price = 24;'));
    assert.equal(cold.inspect().view!.model.currentSourceAvailable, false);
    assert.equal(cold.inspect().view!.model.selectedUnderstanding.understood, true);
  } finally { await cold?.dispose(); await harness.close(); }
});

test('an MCP source reveal rejects a host rendering failure instead of recording a successful reveal', async () => {
  // Arrange
  const harness = await workspaceHarness();
  let release = () => {};
  try {
    const receipt = harness.service.start({ instanceId: harness.service.instanceId, profile: PROFILE_ID, key: 'reveal-failure' });
    const record = harness.service.record(receipt); await record.preparation;
    harness.service.action({ instanceId: harness.service.instanceId, runId: receipt.runId, action: 'add-to-cart', key: 'one' });
    await harness.reader.open();
    const snapshot = harness.service.snapshot(record, harness.service.state(record).participants.server.snapshotUri!);
    const held = harness.holdNextSource(); release = held.release;
    // Act
    const revealing = harness.reader.presentation.revealSource(snapshot, 'server.mts'); await held.started;
    held.reject(new Error('Injected host source open failure'));
    // Assert
    await assert.rejects(revealing, /captured source.*not displayed/);
    assert.equal(harness.reader.inspect().view!.loading, true);
  } finally { release(); await harness.close(); }
});

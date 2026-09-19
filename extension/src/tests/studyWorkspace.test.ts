import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { PROFILE_ID } from '../constants';
import { LearningLibrary } from '../learningLibrary';
import { RecordingStore } from '../recordingStore';
import type { StudyViewMessage } from '../ui/studyHtml';
import { ControlledRuntime, createHarness } from './helpers';
import { loadModule } from './utils/loadModule';
import { bookObservationHash } from '../utils/bookObservationHash';
import type { BookObservationBinding } from '../repositorySchemas';

/** Keeps native presentation inert while exercising actual checkpoints, source watching and durable decisions. @example const reader = await workspaceHarness() */
async function workspaceHarness(attach = true, deterministicClock = false) {
  let clock = 0;
  const harness = await createHarness({ create: async (directory, profile) => { const runtime = new ControlledRuntime(directory, profile); if (deterministicClock) runtime.evidence.elapsedMs = () => clock; return runtime; } }), fixture = join(harness.directory, 'experiments/cycle-0004/fixture');
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
  class TabInputWebview { constructor(readonly viewType: string) {} }
  type Tab = { input: TabInputText | TabInputWebview; label?: string };
  const groups: { viewColumn: number; tabs: Tab[]; activeTab?: Tab }[] = [{ viewColumn: 2, tabs: [] }];
  let changedGroups = (_event: { opened: typeof groups; closed: typeof groups; changed: typeof groups }) => {};
  let sourceProvider = async (_uri: Uri) => '';
  let nextOpen: { wait: Promise<void>; entered(): void } | undefined;
  let nextCommand: { name: string; wait: Promise<void>; entered(): void } | undefined;
  const commands: string[] = [];
  let editorLayout: unknown = { orientation: 0, groups: [{}] };
  let transientLayout = false, settledLayout: unknown, failingCommand: string | undefined;
  const panels = new Set<ReturnType<typeof panel>>();
  const receivers = new Map<string, (message: unknown) => void>();
  let automaticContextReceipt = false, contextCoversSource = false, displayedImage: string | undefined;
  let nextImage: { wait: Promise<void>; entered(): void } | undefined;
  function panel(kind: string) {
    const value = { webview: { html: '', postMessage: async (message: StudyViewMessage) => {
      if (automaticContextReceipt && kind === 'codebook.studyContext' && message.type === 'study' && !message.loading) {
        receivers.get(kind)?.({ type: 'rendered', revision: message.revision, itemId: message.model.selection.itemId, snapshotUri: message.model.observation?.snapshotUri, ...(message.recording ? { presentationRevision: message.recording.presentationRevision } : {}) });
      }
      return true;
    }, onDidReceiveMessage: (callback: (message: unknown) => void) => { receivers.set(kind, callback); return disposable(); } }, title: '', reveal() { if (contextCoversSource && kind === 'codebook.studyContext') groups[0]!.activeTab = undefined; }, onDidDispose: disposable, onDidChangeViewState: disposable, dispose() { panels.delete(value); } };
    panels.add(value); return value;
  }
  const initialSelection: string[] = [];
  const outline = { ...disposable(), visible: true, selection: initialSelection, onDidChangeCheckboxState: disposable, onDidChangeVisibility: disposable,
    reveal: async (participant: string, options: { select: boolean; focus: boolean }) => { assert.equal(options.focus, false); if (options.select) outline.selection = [participant]; } };
  const watcher = { onDidChange(callback: () => void) { changed = callback; return disposable(); }, onDidCreate: disposable, onDidDelete: disposable, dispose() {} };
  const boundary = await loadModule<typeof import('../studyWorkspace')>(resolve(__dirname, '../studyWorkspace.js'), {
    vscode: { EventEmitter, Uri, TabInputText, TabInputWebview, Position: class {}, Range: class {}, ViewColumn: { One: 1, Two: 2, Three: 3 }, ThemeColor: class {}, RelativePattern: class {},
      commands: { async executeCommand(name: string, layout?: unknown): Promise<unknown> {
        commands.push(name); const held = nextCommand; if (held?.name === name) { nextCommand = undefined; held.entered(); await held.wait; }
        if (name === failingCommand) { failingCommand = undefined; throw new Error('Native layout command failed'); }
        if (name === 'runCommands') {
          assert.ok(layout && typeof layout === 'object' && 'commands' in layout && Array.isArray(layout.commands));
          // Both native hosts notify child failures without rejecting the accepted batch promise.
          try { for (const command of layout.commands) await this.executeCommand(typeof command === 'string' ? command : command.command, typeof command === 'string' ? undefined : command.args); } catch {}
          return;
        }
        if (name === 'vscode.getEditorLayout') return JSON.parse(JSON.stringify(editorLayout, (key, value) => key === 'groups' && Array.isArray(value) ? value.map(group => ({ size: 1, ...group })) : value));
        if (name === 'vscode.setEditorLayout') {
          settledLayout = structuredClone(layout);
          editorLayout = transientLayout ? { orientation: 0, groups: [{ size: 0.5, groups: [{ size: 0.5 }, { size: 475.83333333333326 }] }, { size: 659.5 }] } : structuredClone(layout);
          const opened: typeof groups = [];
          for (const column of [1, 3]) if (!groups.some(group => group.viewColumn === column)) { const group = { viewColumn: column, tabs: [] }; groups.push(group); opened.push(group); }
          if (opened.length) changedGroups({ opened, closed: [], changed: [] });
        }
        if (name === 'workbench.action.evenEditorWidths') editorLayout = structuredClone(settledLayout);
      } },
      window: { createTextEditorDecorationType: disposable, createTreeView: () => outline, registerWebviewViewProvider: disposable, onDidChangeActiveTextEditor: disposable, createWebviewPanel: panel,
        showTextDocument: async (document: { uri: Uri; getText(): string }) => { const tab = { input: new TabInputText(document.uri) }; groups[0]!.tabs.push(tab); groups[0]!.activeTab = tab; return { document, setDecorations() {} }; },
        tabGroups: { all: groups, onDidChangeTabGroups: (callback: typeof changedGroups) => { changedGroups = callback; return disposable(); }, close: async (tabs: Tab[]) => { groups[0]!.tabs = groups[0]!.tabs.filter(tab => !tabs.includes(tab)); return true; } } },
      workspace: { textDocuments: [], registerTextDocumentContentProvider: (_scheme: string, provider: { provideTextDocumentContent(uri: Uri): Promise<string> }) => { sourceProvider = provider.provideTextDocumentContent; return disposable(); },
        openTextDocument: async (uri: Uri) => { const held = nextOpen; nextOpen = undefined; if (held) { held.entered(); await held.wait; } const text = await sourceProvider(uri); return { uri, getText: () => text }; },
        onDidChangeTextDocument: disposable, createFileSystemWatcher: () => watcher } },
    './environment': { requireWorkspace: () => harness.directory }, 'codebook-cycle-0001/dist/browserViewport': { BrowserViewport: class {
      async reveal() {} async showLive() {} showHistory() {} close() {}
      clearRecorded() { displayedImage = undefined; }
      async present(image: string) { const held = nextImage; nextImage = undefined; if (held) { held.entered(); await held.wait; } displayedImage = image; }
      async presentMissing() { displayedImage = undefined; }
    } },
  });
  const controls = { start: async () => harness.service, connect: async () => {}, returnToRepository: async () => {} };
  const createReader = () => new boundary.StudyWorkspace({ extensionPath: join(harness.directory, 'extension'), globalStorageUri: { fsPath: join(harness.directory, 'storage') }, subscriptions: [] }, controls);
  const reader = createReader();
  if (attach) { await reader.attach(harness.service); await reader.selectProfile('paired-cart-demo'); await reader.action('return-current'); }
  return { ...harness, reader, createReader, fixture, groups, controls, outline, commands, receive: (message: unknown) => receivers.get('codebook.studyContext')!(message), counts: () => ({ panels: panels.size, outlineUpdates }), changed: () => changed(),
    clock(value: number) { clock = value; }, acknowledgeContext() { automaticContextReceipt = true; }, displayedImage: () => displayedImage,
    coverSourceWhenContextFocused() { contextCoversSource = true; },
    editorLayout: () => structuredClone(editorLayout), changeEditorLayout(layout: unknown) { editorLayout = structuredClone(layout); },
    showTransientNativeSizes() { transientLayout = true; },
    failNextCommand(name: string) { failingCommand = name; },
    addForeignDraft() { const tab = { input: new TabInputText(Uri.file(join(harness.directory, 'notes.txt'))), isDirty: true }; groups[0]!.tabs.push(tab); return tab; },
    resyncEditorGroups(change?: 'move' | 'replace') {
      // Give each fake group a distinct stable input, like the actual singleton panels/native source tabs.
      for (const group of groups) if (!group.tabs.length) group.tabs.push({ input: new TabInputText(Uri.file(`/group-${group.viewColumn}`)) });
      const previous = [...groups];
      groups.splice(0, groups.length, ...groups.map(group => ({ ...group, tabs: group.tabs.map(tab => ({ ...tab, label: 'Recorded application', input: tab.input instanceof TabInputText ? new TabInputText(tab.input.uri) : new TabInputWebview(tab.input.viewType) })) })));
      if (change === 'move') { const first = groups[0]!.tabs; groups[0]!.tabs = groups[1]!.tabs; groups[1]!.tabs = first; }
      changedGroups({ opened: change === 'replace' ? [...groups] : [], closed: change === 'replace' ? previous : [], changed: [...groups] });
    },
    seedPanelTabs(kind: 'known' | 'unknown' | 'duplicate') {
      for (const group of groups) {
        const type = group.viewColumn === 1 ? 'codebook.scopedBrowser' : group.viewColumn === 2 ? 'codebook.repositoryWiki' : 'codebook.studyContext';
        const tab = { label: 'Application', input: new TabInputWebview(`${kind === 'unknown' ? 'foreign-' : 'mainThreadWebview-'}${type}`) };
        group.tabs = kind === 'duplicate' ? [tab, { ...tab }] : [tab];
      }
    },
    holdNextImage() {
      let release = () => {}, entered = () => {};
      const started = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
      nextImage = { wait, entered }; return { started, release };
    },
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

/** Saves a real recording/context with deterministic synthetic runtime values; native paints remain an explicitly mocked boundary. @example const harness = await recordedReaderHarness() */
async function recordedReaderHarness() {
  const harness = await workspaceHarness(true, true), service = harness.service;
  service.environment.build.sourceHash = sha256('recorded-build'); harness.acknowledgeContext();
  await harness.reader.action('run'); const record = [...service.records.values()][0]!; await record.preparation;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=', 'base64');
  assert.ok(record.recording); record.recording.frame({ bytes: png, elapsedMs: 20, kind: 'stream' });
  harness.clock(100); await harness.reader.action('click');
  harness.clock(200); await harness.reader.action('stop');
  const studyId = record.recording.header.studyId, directory = harness.reader.inspect().libraryDirectory!;
  const store = new RecordingStore(directory, directory.split('/').at(-1)!);
  return { ...harness, studyId, store, record, png, controller: service.playbackController! };
}

test('book evidence opens the exact historical observation and retains a restart-safe Return to Wiki target', async () => {
  // Arrange
  const harness = await recordedReaderHarness(), library = await harness.reader.learningStorage();
  try {
    const study = await library.readStudy(harness.studyId), observation = study.observations[0]!;
    const binding: BookObservationBinding = { nodeId: 'cart', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
    await library.selectRepository({ bookId: 'architecture', revision: 1, nodeId: 'cart', anchorIndex: 0, location: { sectionIndex: 1, fraction: 0.5, focusId: 'section-1' } });
    // Act
    await harness.reader.openRepositoryEvidence(binding, false);
    const view = harness.reader.inspect().view!;
    // Assert
    assert.equal(view.model.observation?.id, observation.id); assert.equal(view.model.selection.follow, false); assert.equal(view.model.continueArguments, undefined);
    assert.equal(harness.runtimes[0]!.dispatches, 1); assert.equal((await library.readProgress()).repositorySelection?.location?.fraction, 0.5);
    assert.equal((await library.readProgress()).decisions.length, 0);
  } finally { await harness.close(); }
});

test('book recording links seek the exact captured observation time while playback stays paused and runtime input stays unchanged', async () => {
  // Arrange
  const harness = await recordedReaderHarness(), library = await harness.reader.learningStorage();
  try {
    const study = await library.readStudy(harness.studyId), observation = study.observations[0]!;
    const binding: BookObservationBinding = { nodeId: 'cart', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
    // Act
    await harness.reader.openRepositoryEvidence(binding, true);
    const view = harness.reader.inspect().view!;
    // Assert
    assert.equal(view.model.observation?.id, observation.id); assert.equal(view.recording?.presentedMs, 100); assert.equal(view.recording?.mode, 'paused');
    assert.equal(view.model.continueArguments, undefined); assert.equal(harness.runtimes[0]!.dispatches, 1); assert.equal((await library.readProgress()).decisions.length, 0);
  } finally { await harness.close(); }
});

for (const recording of [false, true]) test(`Wiki ${recording ? 'recording' : 'observation'} entry preserves hidden navigation panes while explicit Open Study still reveals them`, async () => {
  // Arrange
  const harness = await recordedReaderHarness(), library = await harness.reader.learningStorage();
  try {
    const study = await library.readStudy(harness.studyId), observation = study.observations[0]!;
    const binding: BookObservationBinding = { nodeId: 'cart', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
    harness.commands.length = 0;
    // Act
    await harness.reader.openRepositoryEvidence(binding, recording);
    const evidenceNavigation = harness.commands.filter(name => name === 'codebook.learningOutline.focus' || name === 'codebook.observedMoments.focus');
    await harness.reader.open();
    // Assert
    assert.deepEqual(evidenceNavigation, []);
    assert.deepEqual(harness.commands.filter(name => name === 'codebook.learningOutline.focus' || name === 'codebook.observedMoments.focus'), ['codebook.learningOutline.focus', 'codebook.observedMoments.focus']);
    assert.equal(harness.reader.inspect().view!.model.observation?.id, observation.id);
    assert.equal(harness.runtimes[0]!.dispatches, 1); assert.equal((await library.readProgress()).decisions.length, 0);
  } finally { await harness.close(); }
});

for (const recording of [false, true]) test(`explicit Open Study reveals navigation even while a Wiki ${recording ? 'recording' : 'observation'} entry is waiting for source`, async () => {
  // Arrange
  const harness = await recordedReaderHarness(), library = await harness.reader.learningStorage();
  const study = await library.readStudy(harness.studyId), observation = study.observations[0]!;
  const binding: BookObservationBinding = { nodeId: 'cart', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
  harness.commands.length = 0; const source = harness.holdNextSource();
  const navigation = harness.reader.openRepositoryEvidence(binding, recording);
  try {
    await source.started;
    // Act
    await harness.reader.open();
    // Assert
    assert.deepEqual(harness.commands.filter(name => name === 'codebook.learningOutline.focus' || name === 'codebook.observedMoments.focus'), ['codebook.learningOutline.focus', 'codebook.observedMoments.focus']);
  } finally { source.release(); await navigation; await harness.close(); }
});

test('book evidence rejects a changed captured observation before selecting history or opening replay', async () => {
  // Arrange
  const harness = await recordedReaderHarness(), library = await harness.reader.learningStorage();
  try {
    const study = await library.readStudy(harness.studyId), observation = study.observations[0]!;
    const binding: BookObservationBinding = { nodeId: 'cart', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: '0'.repeat(64), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
    // Act / Assert
    await assert.rejects(harness.reader.openRepositoryEvidence(binding, false), /exact saved checkpoint/);
    await assert.rejects(harness.reader.openRepositoryEvidence(binding, true), /exact saved checkpoint/);
    assert.equal(harness.runtimes[0]!.dispatches, 1); assert.equal(harness.reader.inspect().view?.recording, undefined);
  } finally { await harness.close(); }
});

test('closing the article during a pending checkpoint prevents the later evidence read from opening study panes', async () => {
  // Arrange
  const harness = await recordedReaderHarness(), library = await harness.reader.learningStorage(), originalRead = library.readCheckpoint.bind(library);
  let release = () => {}, enter = () => {};
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  try {
    const study = await library.readStudy(harness.studyId), observation = study.observations[0]!;
    const binding: BookObservationBinding = { nodeId: 'cart', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
    await harness.reader.close(); library.readCheckpoint = async (...arguments_: Parameters<typeof originalRead>) => { const checkpoint = await originalRead(...arguments_); enter(); await held; return checkpoint; };
    const cancellation = new AbortController();
    // Act
    const pending = harness.reader.openRepositoryEvidence(binding, false, cancellation.signal), rejected = assert.rejects(pending, /abort/i);
    await entered; cancellation.abort(); release(); await rejected;
    // Assert
    assert.equal(harness.reader.inspect().opened, false); assert.equal(harness.counts().panels, 0); assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { release(); library.readCheckpoint = originalRead; await harness.close(); }
});

for (const recording of [false, true]) test(`cancelling ${recording ? 'recording' : 'observation'} navigation during native source acquisition prevents its later source reveal and focus commands`, async () => {
  // Arrange
  const harness = await recordedReaderHarness(), library = await harness.reader.learningStorage();
  const study = await library.readStudy(harness.studyId), observation = study.observations[0]!;
  const binding: BookObservationBinding = { nodeId: 'cart', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
  await harness.reader.close(); const source = harness.holdNextSource(), cancellation = new AbortController();
  try {
    // Act
    const pending = harness.reader.openRepositoryEvidence(binding, recording, cancellation.signal), rejected = assert.rejects(pending, /abort/i);
    await source.started; const commands = [...harness.commands]; cancellation.abort(); source.release(); await rejected;
    // Assert
    assert.equal(harness.groups[0]!.tabs.length, 0); assert.deepEqual(harness.commands, commands); assert.equal(harness.reader.inspect().opened, false);
    assert.equal(harness.runtimes[0]!.dispatches, 1); assert.equal((await library.readProgress()).decisions.length, 0);
    await harness.reader.open(); assert.equal(harness.reader.inspect().opened, true);
  } finally { source.release(); await harness.close(); }
});

test('cancelling a first reader entry drains its accepted workbench layout batch without dispatching another mutation', async () => {
  // Arrange
  const harness = await workspaceHarness(false), cancellation = new AbortController(), layout = harness.holdNextCommand('runCommands');
  try {
    // Act
    const opening = harness.reader.open(cancellation.signal), rejected = assert.rejects(opening, /abort/i);
    await layout.started; const commands = [...harness.commands]; cancellation.abort(); layout.release(); await rejected;
    // Assert
    assert.deepEqual(harness.commands, [...commands, 'vscode.setEditorLayout', 'workbench.action.evenEditorWidths', 'vscode.getEditorLayout']); assert.equal(harness.reader.inspect().opened, false);
    await harness.reader.open(); assert.equal(harness.reader.inspect().opened, true);
  } finally { layout.release(); await harness.close(); }
});

test('returning to Wiki places source beside article without merging tabs and the next evidence entry restores Study panes', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    await harness.reader.open(); const groups = [...harness.groups], draft = harness.addForeignDraft();
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal); const readingLayout = harness.editorLayout();
    await harness.reader.open();
    // Assert
    assert.deepEqual(readingLayout, { orientation: 0, groups: [{}, {}, {}] });
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ groups: [{}, {}] }, {}] });
    assert.deepEqual(harness.groups, groups); assert.equal(harness.groups[0]!.tabs.includes(draft), true); assert.equal(draft.isDirty, true);
    assert.equal(harness.commands.filter(name => name === 'vscode.setEditorLayout').length, 3); assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

for (const change of ['shape', 'size', 'identity', 'extra-group']) test(`returning to Wiki preserves a learner's ${change} change to the native editor layout`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    await harness.reader.open();
    if (change === 'shape') harness.changeEditorLayout({ orientation: 1, groups: [{}, {}, {}] });
    if (change === 'size') harness.changeEditorLayout({ orientation: 0, groups: [{ size: 0.7, groups: [{ size: 0.3 }, { size: 0.7 }] }, { size: 0.3 }] });
    if (change === 'identity') harness.groups[0] = { ...harness.groups[0]! };
    if (change === 'extra-group') harness.groups.push({ viewColumn: 4, tabs: [] });
    const layout = harness.editorLayout(), groups = [...harness.groups], draft = harness.addForeignDraft();
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal); await harness.reader.open();
    // Assert
    assert.deepEqual(harness.editorLayout(), layout); assert.deepEqual(harness.groups, groups);
    assert.equal(harness.groups[0]!.tabs.includes(draft), true); assert.equal(harness.commands.filter(name => name === 'vscode.setEditorLayout').length, 1);
  } finally { await harness.close(); }
});

test('evidence entry preserves a learner resize made while reading the Wiki', async () => {
  // Arrange
  const harness = await workspaceHarness(false), layout = { orientation: 0, groups: [{ size: 0.2 }, { size: 0.6 }, { size: 0.2 }] };
  try {
    await harness.reader.open(); await harness.reader.arrangeRepository(new AbortController().signal); harness.changeEditorLayout(layout);
    // Act
    await harness.reader.open();
    // Assert
    assert.deepEqual(harness.editorLayout(), layout); assert.equal(harness.commands.filter(name => name === 'vscode.setEditorLayout').length, 2);
  } finally { await harness.close(); }
});

test('cancelling Wiki navigation while checking native layout ownership cannot rearrange the editor later', async () => {
  // Arrange
  const harness = await workspaceHarness(false), cancellation = new AbortController();
  let release = () => {};
  try {
    await harness.reader.open(); const held = harness.holdNextCommand('vscode.getEditorLayout'); release = held.release;
    // Act
    const navigation = harness.reader.arrangeRepository(cancellation.signal), rejected = assert.rejects(navigation, /abort/i);
    await held.started; cancellation.abort(); held.release(); await rejected;
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ groups: [{}, {}] }, {}] });
    assert.equal(harness.commands.filter(name => name === 'vscode.setEditorLayout').length, 1);
  } finally { release(); await harness.close(); }
});

test('returning to Wiki during a cancelled Study layout waits for the accepted host effect then restores side-by-side reading', async () => {
  // Arrange
  const harness = await workspaceHarness(false), cancellation = new AbortController();
  let release = () => {};
  try {
    await harness.reader.open(); await harness.reader.arrangeRepository(new AbortController().signal);
    const held = harness.holdNextCommand('runCommands'); release = held.release;
    const opening = harness.reader.open(cancellation.signal), rejected = assert.rejects(opening, /abort/i);
    // Act
    await held.started; cancellation.abort(); const returning = harness.reader.arrangeRepository(new AbortController().signal);
    held.release(); await rejected; await returning;
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{}, {}, {}] });
    assert.equal(harness.commands.filter(name => name === 'vscode.setEditorLayout').length, 4);
    assert.equal(harness.commands.filter(name => name === 'workbench.action.evenEditorWidths').length, 4);
    assert.equal(harness.runtimes.length, 0);
  } finally { release(); await harness.close(); }
});

for (const change of ['shape', 'size']) test(`a manual ${change} change during the host layout receipt never becomes Codebook-owned on the next Wiki return`, async () => {
  // Arrange
  const harness = await workspaceHarness(false), manual = change === 'shape' ? { orientation: 1, groups: [{}, {}, {}] } : { orientation: 0, groups: [{ size: 0.7, groups: [{ size: 0.3 }, { size: 0.7 }] }, { size: 0.3 }] };
  let release = () => {};
  try {
    await harness.reader.open(); const held = harness.holdNextCommand('vscode.getEditorLayout'); release = held.release;
    // Act
    const arranging = harness.reader.action('arrange'); await held.started;
    harness.changeEditorLayout(manual); held.release(); await arranging;
    await harness.reader.arrangeRepository(new AbortController().signal);
    // Assert
    assert.deepEqual(harness.editorLayout(), manual); assert.equal(harness.commands.filter(name => name === 'vscode.setEditorLayout').length, 2);
    assert.equal(harness.commands.filter(name => name === 'workbench.action.evenEditorWidths').length, 2);
  } finally { release(); await harness.close(); }
});

test('Cursor wrapper-only tab resync preserves Wiki and Study layout switching during an in-flight ownership read', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  let release = () => {};
  try {
    await harness.reader.open(); const held = harness.holdNextCommand('vscode.getEditorLayout'); release = held.release;
    // Act
    const returning = harness.reader.arrangeRepository(new AbortController().signal); await held.started;
    harness.resyncEditorGroups(); held.release(); await returning; const wiki = harness.editorLayout();
    harness.resyncEditorGroups(); await harness.reader.open();
    // Assert
    assert.deepEqual(wiki, { orientation: 0, groups: [{}, {}, {}] });
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ groups: [{}, {}] }, {}] });
    assert.equal(harness.commands.filter(name => name === 'vscode.setEditorLayout').length, 3);
  } finally { release(); await harness.close(); }
});

for (const change of ['move', 'replace'] as const) test(`a host tab resync cannot disguise a learner group ${change} as Codebook ownership`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    await harness.reader.open(); harness.resyncEditorGroups(change);
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal);
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ groups: [{}, {}] }, {}] });
    assert.equal(harness.commands.filter(name => name === 'vscode.setEditorLayout').length, 1);
  } finally { await harness.close(); }
});

for (const kind of ['known', 'unknown', 'duplicate'] as const) test(`Cursor ${kind} webview inputs ${kind === 'known' ? 'retain layout ownership across application title changes' : 'cannot acquire Codebook layout ownership during resync'}`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    await harness.reader.open(); harness.seedPanelTabs(kind);
    // Act
    harness.resyncEditorGroups(); await harness.reader.arrangeRepository(new AbortController().signal);
    // Assert
    assert.deepEqual(harness.editorLayout(), kind === 'known' ? { orientation: 0, groups: [{}, {}, {}] } : { orientation: 0, groups: [{ groups: [{}, {}] }, {}] });
    assert.equal(harness.commands.filter(name => name === 'vscode.setEditorLayout').length, kind === 'known' ? 2 : 1);
  } finally { await harness.close(); }
});

for (const newerSelection of [false, true]) test(`cancelling linked evidence during a shared refresh ${newerSelection ? 'preserves a newer learner profile' : 'keeps the existing study and prevents a later background source reveal'}`, async () => {
  // Arrange
  const harness = await recordedReaderHarness(), library = await harness.reader.learningStorage();
  clearInterval(harness.reader['timer']); harness.reader['timer'] = undefined;
  await harness.reader.open(); await harness.reader.select('paired-cart-demo/browser');
  const study = await library.readStudy(harness.studyId), observation = study.observations[0]!;
  const binding: BookObservationBinding = { nodeId: 'cart', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
  const checkpoint = harness.reader['checkpoint'].bind(harness.reader), open = harness.reader.open.bind(harness.reader);
  let release = () => {}, enter = () => {}, openEntered = () => {};
  const held = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; }), reachedOpen = new Promise<void>(resolve => { openEntered = resolve; });
  harness.reader['checkpoint'] = async (...arguments_: Parameters<typeof checkpoint>) => { await checkpoint(...arguments_); enter(); await held; };
  harness.reader.open = async signal => { openEntered(); await open(signal); };
  const cancellation = new AbortController();
  try {
    // Act
    const background = harness.reader['refresh'](); await entered;
    const pending = harness.reader.openRepositoryEvidence(binding, false, cancellation.signal), rejected = assert.rejects(pending, /abort/i);
    await reachedOpen; await new Promise<void>(resolve => setImmediate(resolve));
    if (newerSelection) await harness.reader.selectProfile('checkout-demo');
    const tabs = [...harness.groups[0]!.tabs], commands = [...harness.commands];
    cancellation.abort(); release(); await background; await rejected; await harness.reader['refresh']();
    // Assert
    assert.deepEqual(harness.groups[0]!.tabs, tabs); assert.deepEqual(harness.commands, commands);
    assert.equal(harness.reader.inspect().opened, true);
    assert.equal(harness.reader['sourceReady'](), true);
    assert.equal(harness.reader.inspect().view?.model.selection.itemId, newerSelection ? 'checkout-demo/cart-mutation' : 'paired-cart-demo/browser');
    assert.equal(harness.runtimes[0]!.dispatches, 1);
    await harness.reader.openRepositoryEvidence(binding, false); await harness.reader['refresh']();
    assert.equal(harness.reader.inspect().view?.model.observation?.id, observation.id);
  } finally { release(); harness.reader['checkpoint'] = checkpoint; harness.reader.open = open; await harness.close(); }
});

test('Recording opens paused with no future source and seeking binds captured values without executing or marking understanding', async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  try {
    // Act
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    const before = harness.reader.inspect().view!;
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    const observed = harness.reader.inspect().view!;
    // Assert
    assert.equal(before.contentTab, 'recording'); assert.equal(before.recording?.mode, 'paused'); assert.equal(before.model.observation, undefined);
    assert.equal(before.model.source.text, '// No source was observed by this recorded position.\n'); assert.equal(before.model.selectedUnderstanding.known, false);
    assert.equal(observed.recording?.readiness, 'ready', observed.recording?.reason); assert.equal(observed.model.observation?.values.cartCount, 0);
    assert.equal(observed.model.source.text, 'const price = 24;'); assert.equal(observed.model.continueArguments, undefined);
    assert.equal(harness.displayedImage(), harness.png.toString('base64')); assert.equal(harness.runtimes[0]!.dispatches, 1); assert.equal(harness.runtimes[0]!.releases, 1);
    const library = new LearningLibrary(harness.store.learningDirectory, harness.store.workspaceKey);
    assert.equal((await library.readProgress()).decisions.length, 0); assert.equal((await harness.store.readPreference())?.positionMs, 100);
  } finally { await harness.close(); }
});

test('returning from recording to Wiki keeps background study refresh from covering the article with captured source', async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    harness.controls.returnToRepository = async () => { harness.controller.hide(); harness.groups[0]!.activeTab = undefined; };
    const tabs = [...harness.groups[0]!.tabs], commands = [...harness.commands];
    // Act
    await harness.reader.action('return-wiki'); await harness.reader['refresh'](); await harness.reader.retire(harness.service);
    // Assert
    assert.deepEqual(harness.groups[0]!.tabs, tabs); assert.deepEqual(harness.commands, commands); assert.equal(harness.groups[0]!.activeTab, undefined);
    assert.equal(harness.controller.state().mode, 'paused'); assert.equal(harness.runtimes[0]!.dispatches, 1);
    harness.controller.reveal(); await harness.controller.settle();
    assert.equal(harness.controller.state().readiness, 'ready'); assert.equal(harness.reader.inspect().view?.model.observation?.elapsedMs, 100);
  } finally { await harness.close(); }
});

test('opening a recording restores its captured source after context focus covers the manually moved source group', async () => {
  // Arrange
  const harness = await recordedReaderHarness(); harness.coverSourceWhenContextFocused();
  try {
    // Act
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    // Assert
    const state = harness.reader.inspect();
    assert.equal(state.view?.recording?.readiness, 'ready', state.view?.recording?.reason);
    const input = harness.groups[0]?.activeTab?.input; assert.ok(input && 'uri' in input); assert.equal(input.uri.toString(), state.sourceUri);
  } finally { await harness.close(); }
});

test('Pause during a late recorded image restores the previous source and preserves only the confirmed position', async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle(); const delayed = harness.holdNextImage();
    // Act
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await delayed.started;
    assert.equal(harness.reader.inspect().view?.loading, true);
    harness.controller.command({ action: 'pause', studyId: harness.studyId, expectedRevision: harness.controller.state().revision }); delayed.release(); await harness.controller.settle();
    // Assert
    const view = harness.reader.inspect().view!;
    assert.equal(view.recording?.readiness, 'ready', view.recording?.reason); assert.equal(view.recording?.presentedMs, 0);
    assert.equal(view.model.observation, undefined); assert.equal(view.model.source.text, '// No source was observed by this recorded position.\n');
    assert.equal(harness.displayedImage(), undefined); assert.equal((await harness.store.readPreference())?.positionMs, 0);
  } finally { await harness.close(); }
});

test('a fresh reader restores the saved recording position paused and a live-runtime retirement does not exit playback', async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  const reloaded = harness.createReader();
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    await harness.reader.close();
    // Act
    await reloaded.attach(harness.service); await reloaded.openRecording(harness.studyId); await harness.service.playbackController!.settle();
    const restored = reloaded.inspect().view!;
    await reloaded.retire(harness.service);
    // Assert
    assert.equal(restored.recording?.readiness, 'ready', restored.recording?.reason); assert.equal(restored.recording?.presentedMs, 100); assert.equal(restored.recording?.mode, 'paused');
    assert.equal(reloaded.inspect().view?.contentTab, 'recording'); assert.equal(reloaded.inspect().view?.model.observation?.values.price, 24);
    assert.equal(harness.runtimes.length, 1); assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { await reloaded.dispose(); await harness.close(); }
});

test('retiring before the next polling tick preserves the last accepted interpretation and terminal state', async context => {
  // Arrange: the poll never fires; finalization must explicitly collect the latest service state.
  context.mock.timers.enable({ apis: ['setInterval'] });
  const harness = await workspaceHarness(), service = harness.service;
  try {
    const receipt = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, key: 'last-tick' });
    const record = service.record(receipt); await record.preparation;
    service.action({ instanceId: service.instanceId, runId: receipt.runId, action: 'add-to-cart', key: 'one' });
    const snapshotUri = service.state(record).participants.server!.snapshotUri!;
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
    await service.continue(service.state(record).participants.server!.continueArguments!);
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

for (const savedEarlier of [false, true]) test(`retiring a failed final checkpoint stays partial ${savedEarlier ? 'with an older saved projection' : 'without any saved catalog entry'}`, async context => {
  // Arrange
  const harness = await workspaceHarness(), service = harness.service, saveStudy = LearningLibrary.prototype.saveStudy;
  let rejecting = !savedEarlier;
  context.mock.method(LearningLibrary.prototype, 'saveStudy', async function (this: LearningLibrary, study: Parameters<LearningLibrary['saveStudy']>[0]) {
    if (rejecting) throw new Error('Injected final checkpoint rejection');
    return saveStudy.call(this, study);
  });
  try {
    await harness.reader.action('run'); const record = [...service.records.values()][0]!; await record.preparation;
    const runtime = harness.runtimes[0]!, originalView = runtime.view.bind(runtime);
    runtime.view = () => ({ ...originalView(), finalOutcome: 'demonstrated' });
    await harness.reader.open();
    if (savedEarlier) await harness.reader.action('retry');
    rejecting = true;
    // Act
    await service.shutdown();
    await assert.rejects(harness.reader.retire(service), /final reader history was not saved/);
    const retired = harness.reader.inspect().view!;
    // Assert
    assert.equal(retired.liveState, undefined); assert.equal(retired.studies.length, savedEarlier ? 1 : 0);
    assert.equal(retired.study?.finalOutcome, 'demonstrated'); assert.equal(retired.study?.historyOutcome, 'failed'); assert.equal(retired.study?.studyOutcome, 'partial');
    rejecting = false; await harness.reader.action('retry');
    assert.equal(harness.reader.inspect().view!.study?.historyOutcome, 'saved'); assert.equal(harness.reader.inspect().view!.study?.studyOutcome, 'demonstrated');
  } finally { rejecting = false; context.mock.restoreAll(); await harness.close(); }
});

test('opening paired history during checkout startup cannot change the accepted run profile', async () => {
  // Arrange
  const harness = await workspaceHarness();
  let release = () => {}, entered = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  try {
    const directory = harness.reader.inspect().libraryDirectory!, workspaceKey = directory.split('/').at(-1)!;
    const library = new LearningLibrary(directory, workspaceKey), instanceId = randomUUID(), runId = randomUUID(), studyId = `${instanceId}_${runId}`;
    await library.saveStudy({ version: 2, workspaceKey, id: studyId, instanceId, runId, profile: 'paired-cart-demo', createdAt: '2026-09-18T10:00:00.000Z', savedAt: '2026-09-18T10:00:01.000Z', state: 'stopped', terminal: true, finalOutcome: 'partial', materialSignature: sha256('startup-history'), observations: [], captures: [], links: [] });
    await harness.reader.selectProfile('checkout-demo'); await harness.reader.open();
    harness.controls.start = async () => { entered(); await waiting; return harness.service; };
    // Act
    const starting = harness.reader.action('run'); await started;
    harness.receive({ type: 'history', revision: harness.reader.inspect().view!.revision, studyId });
    await waitUntil(() => harness.reader.inspect().view!.model.selection.studyId === studyId && !harness.reader.inspect().view!.loading, 'paired history during pending startup', 1_000);
    release(); await starting;
    // Assert
    const record = [...harness.service.records.values()][0]!;
    assert.equal(record.profile, 'checkout-demo'); assert.equal(harness.reader.inspect().view!.model.selection.profile, 'checkout-demo');
    await record.preparation;
  } finally { release(); await harness.close(); }
});

test('an interpretation added to an earlier stopped run persists while the later run keeps execution ownership', async () => {
  // Arrange
  const harness = await workspaceHarness(), service = harness.service;
  try {
    await harness.reader.action('run'); const first = [...service.records.values()][0]!; await first.preparation;
    await harness.reader.action('click'); await harness.reader.open();
    const snapshotUri = service.state(first).participants.server!.snapshotUri!;
    await harness.reader.action('stop');
    await harness.reader.action('run'); const second = [...service.records.values()][1]!; await second.preparation;
    // Act
    await service.explain({ instanceId: service.instanceId, runId: first.id, key: 'earlier-run-note', snapshotUri, sourceHash: sha256('const price = 24;'), valuePaths: ['price'], interpretation: 'The earlier run captured price 24.' });
    await harness.reader.open(); await harness.reader.action('retry');
    const studyId = `${service.instanceId}_${first.id}`;
    harness.receive({ type: 'history', revision: harness.reader.inspect().view!.revision, studyId });
    await waitUntil(() => harness.reader.inspect().view!.model.selection.studyId === studyId && !harness.reader.inspect().view!.loading, 'updated earlier history', 1_000);
    // Assert
    const history = harness.reader.inspect().view!;
    assert.equal(service.state(first).historyOutcome.status, 'saved');
    assert.equal(history.study?.historyOutcome, 'saved'); assert.equal(history.model.observation?.interpretations[0]?.text, 'The earlier run captured price 24.');
    assert.equal(history.liveState, 'ready'); assert.equal(second.stopped, false); assert.equal(history.model.continueArguments, undefined);
    assert.equal(harness.runtimes[0]!.dispatches, 1); assert.equal(harness.runtimes[1]!.dispatches, 0);
  } finally { await harness.close(); }
});

test('history selected during a retained run save shows the new explanation before claiming saved evidence', async context => {
  // Arrange: freeze polling so the history selection falls between capture and its durable write.
  context.mock.timers.enable({ apis: ['setInterval'] });
  const harness = await workspaceHarness(), service = harness.service, saveStudy = LearningLibrary.prototype.saveStudy;
  let release = () => {}, entered = () => {};
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  try {
    await harness.reader.action('run'); const first = [...service.records.values()][0]!; await first.preparation;
    await harness.reader.action('click');
    const runtime = harness.runtimes[0]!, originalView = runtime.view.bind(runtime);
    runtime.view = () => ({ ...originalView(), finalOutcome: 'demonstrated' });
    await harness.reader.open(); await harness.reader.action('stop');
    const snapshotUri = service.state(first).participants.server!.snapshotUri!, studyId = `${service.instanceId}_${first.id}`;
    await harness.reader.action('run'); const second = [...service.records.values()][1]!; await second.preparation;
    await harness.reader.action('retry');
    context.mock.method(LearningLibrary.prototype, 'saveStudy', async function (this: LearningLibrary, study: Parameters<LearningLibrary['saveStudy']>[0]) {
      if (study.id === studyId && study.observations[0]?.interpretations.length === 1) { entered(); await held; }
      return saveStudy.call(this, study);
    });
    // Act
    await service.explain({ instanceId: service.instanceId, runId: first.id, key: 'selected-during-save', snapshotUri, sourceHash: sha256('const price = 24;'), valuePaths: ['price'], interpretation: 'The retained cart pause captured price 24 before mutation.' });
    await harness.reader.open(); await started;
    harness.receive({ type: 'history', revision: harness.reader.inspect().view!.revision, studyId });
    await waitUntil(() => harness.reader.inspect().view!.model.selection.studyId === studyId && !harness.reader.inspect().view!.loading, 'older history selected during save', 1_000);
    const pending = harness.reader.inspect().view!;
    assert.equal(pending.model.observation?.interpretations.length, 0);
    assert.equal(pending.study?.historyOutcome, 'pending'); assert.equal(pending.study?.studyOutcome, 'pending');
    release();
    await waitUntil(() => service.state(first).historyOutcome.status === 'saved', 'retained explanation checkpoint saved', 1_000);
    await harness.reader.open();
    // Assert
    const selected = harness.reader.inspect().view!, directory = harness.reader.inspect().libraryDirectory!;
    const archive = await new LearningLibrary(directory, directory.split('/').at(-1)!).readStudy(studyId);
    assert.equal(selected.model.observation?.interpretations.length, 1);
    assert.equal(selected.model.observation?.interpretations[0]?.text, 'The retained cart pause captured price 24 before mutation.');
    assert.equal(archive.observations[0]?.interpretations[0]?.text, 'The retained cart pause captured price 24 before mutation.');
    assert.equal(selected.study?.historyOutcome, 'saved'); assert.equal(selected.study?.studyOutcome, 'demonstrated');
    assert.equal(selected.liveState, 'ready'); assert.equal(second.stopped, false); assert.equal(selected.model.continueArguments, undefined);
  } finally { release(); context.mock.restoreAll(); await harness.close(); context.mock.timers.reset(); }
});

test('a failed latest image checkpoint stays failed and partial while the older captured facts remain readable until Retry', async context => {
  // Arrange: the runtime is synthetic; canonical image reads and durable archive writes remain real.
  context.mock.timers.enable({ apis: ['setInterval'] });
  const harness = await workspaceHarness(), service = harness.service;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  let imagePath: string | undefined;
  try {
    await harness.reader.action('run'); const record = [...service.records.values()][0]!; await record.preparation;
    await harness.reader.action('click');
    const runtime = harness.runtimes[0]!, originalView = runtime.view.bind(runtime);
    imagePath = join(runtime.evidence.directory, 'paused-server.png'); await writeFile(imagePath, png);
    runtime.view = () => ({ ...originalView(), finalOutcome: 'demonstrated', captures: { 'paused-server': { status: 'captured', file: 'paused-server.png', renderer: { epoch: 'test', id: 1, hash: sha256(png) } } } });
    const snapshotUri = service.state(record).participants.server!.snapshotUri!;
    await service.explain({ instanceId: service.instanceId, runId: record.id, key: 'saved-before-image-failure', snapshotUri, sourceHash: sha256('const price = 24;'), valuePaths: ['price'], interpretation: 'The original saved observation has price 24.' });
    await harness.reader.open(); await harness.reader.action('stop');
    const studyId = `${service.instanceId}_${record.id}`, directory = harness.reader.inspect().libraryDirectory!;
    const library = new LearningLibrary(directory, directory.split('/').at(-1)!), original = await library.readStudy(studyId);
    const originalImage = original.captures.find(capture => capture.phase === 'paused-server');
    assert.equal(original.terminal, true); assert.ok(originalImage?.status === 'captured'); assert.equal(originalImage.base64, png.toString('base64'));
    assert.equal(harness.reader.inspect().view!.study?.studyOutcome, 'demonstrated');
    // Act: a permitted post-stop explanation needs a new projection, but its canonical PNG is now corrupt.
    await service.explain({ instanceId: service.instanceId, runId: record.id, key: 'late-after-image-failure', snapshotUri, sourceHash: sha256('const price = 24;'), valuePaths: ['price'], interpretation: 'The later explanation also refers to the captured price 24.' });
    await writeFile(imagePath, 'corrupted canonical PNG');
    await assert.rejects(harness.reader.open(), /Captured image no longer matches its sealed hash/);
    await harness.reader.open();
    // Assert: the failure is settled; older readable facts cannot turn it into an indefinite pending state.
    const failed = harness.reader.inspect().view!, retained = await library.readStudy(studyId);
    assert.equal(service.state(record).historyOutcome.status, 'failed'); assert.equal(service.state(record).studyOutcome, 'partial');
    assert.equal(failed.study?.historyOutcome, 'failed'); assert.equal(failed.study?.studyOutcome, 'partial');
    assert.equal(failed.model.observation?.snapshotUri, snapshotUri); assert.equal(failed.model.observation?.values.price, 24);
    assert.equal(failed.model.observation?.interpretations.length, 1);
    assert.equal(failed.model.observation?.interpretations[0]?.text, 'The original saved observation has price 24.');
    assert.equal(failed.model.image?.status, 'captured'); assert.equal(failed.model.image?.base64, png.toString('base64'));
    assert.equal(retained.materialSignature, original.materialSignature); assert.equal(retained.observations[0]?.interpretations.length, 1);
    assert.equal(harness.reader['archiveWrites'].size, 0);
    // Act: recovery is explicit and must collect the new explanation before certifying the saved study.
    await writeFile(imagePath, png); await harness.reader.action('retry');
    // Assert
    const recovered = harness.reader.inspect().view!, saved = await library.readStudy(studyId);
    assert.equal(service.state(record).historyOutcome.status, 'saved'); assert.equal(service.state(record).studyOutcome, 'demonstrated');
    assert.equal(recovered.study?.historyOutcome, 'saved'); assert.equal(recovered.study?.studyOutcome, 'demonstrated');
    assert.equal(recovered.model.observation?.interpretations.length, 2);
    assert.equal(recovered.model.observation?.interpretations[1]?.text, 'The later explanation also refers to the captured price 24.');
    assert.equal(saved.observations[0]?.interpretations[1]?.text, 'The later explanation also refers to the captured price 24.');
    assert.equal(recovered.model.observation?.values.price, 24); assert.equal(harness.runtimes.length, 1); assert.equal(runtime.dispatches, 1);
  } finally { if (imagePath) await writeFile(imagePath, png); await harness.close(); context.mock.timers.reset(); }
});

test('a closed source file change marks prior understanding for review without changing the saved learner decision', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    await harness.reader.understand(true);
    const directory = harness.reader.inspect().libraryDirectory!, before = await readFile(join(directory, 'progress.v4.json'), 'utf8');
    const updatesBefore = harness.counts().outlineUpdates;
    assert.equal(harness.reader.inspect().view!.model.understoodCount, 1);
    // Act: the editor has no open source document; the filesystem watcher owns this update.
    await writeFile(join(harness.fixture, 'server.mts'), 'const price = 25;'); harness.changed();
    await waitUntil(() => harness.reader.inspect().view!.model.reviewCount === 1, 'closed source review signal', 1_000);
    // Assert
    assert.equal(harness.reader.inspect().view!.model.understoodCount, 0);
    assert.equal(await readFile(join(directory, 'progress.v4.json'), 'utf8'), before);
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
    const input = harness.groups[0]!.activeTab!.input; assert.ok('uri' in input); assert.match(input.uri.toString(), /Captured-server\.mts$/);
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
  const harness = await workspaceHarness(), readCheckpoint = LearningLibrary.prototype.readCheckpoint;
  let releaseFirst = () => {}, releaseLatest = () => {}, firstFinished = false, reads = 0;
  const firstHeld = new Promise<void>(resolve => { releaseFirst = resolve; }), latestHeld = new Promise<void>(resolve => { releaseLatest = resolve; });
  try {
    const directory = harness.reader.inspect().libraryDirectory!, workspaceKey = directory.split('/').at(-1)!;
    const library = new LearningLibrary(directory, workspaceKey), instanceId = randomUUID(), firstRun = randomUUID(), latestRun = randomUUID();
    const firstId = `${instanceId}_${firstRun}`, latestId = `${instanceId}_${latestRun}`;
    for (const runId of [firstRun, latestRun]) await library.saveStudy({ version: 2, workspaceKey, id: `${instanceId}_${runId}`, instanceId, runId, profile: 'paired-cart-demo', createdAt: '2026-09-18T10:00:00.000Z', savedAt: '2026-09-18T10:00:01.000Z', state: 'stopped', terminal: true, finalOutcome: 'partial', materialSignature: sha256('test-checkpoint'), observations: [], captures: [], links: [] });
    await harness.reader.action('retry'); await harness.reader.open();
    const revision = harness.reader.inspect().view!.revision;
    context.mock.method(LearningLibrary.prototype, 'readCheckpoint', async function (this: LearningLibrary, id: string) {
      reads++; await (id === firstId ? firstHeld : latestHeld);
      const checkpoint = await readCheckpoint.call(this, id); if (id === firstId) firstFinished = true; return checkpoint;
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

test('a cold reader keeps the newer selected study and its observation when an older Retry read completes', async context => {
  // Arrange: persist two real archives, then remove the live reader so no current run can repair selection.
  context.mock.timers.enable({ apis: ['setInterval'] });
  const harness = await workspaceHarness(), service = harness.service, readCheckpoint = LearningLibrary.prototype.readCheckpoint;
  let cold: ReturnType<typeof harness.createReader> | undefined, retry: Promise<void> | undefined;
  let release = () => {}, entered = () => {};
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  try {
    const studyIds: string[] = [];
    for (const label of ['A', 'B']) {
      await harness.reader.action('run'); const record = [...service.records.values()].at(-1)!; await record.preparation;
      await harness.reader.action('click');
      await service.explain({ instanceId: service.instanceId, runId: record.id, key: label, snapshotUri: service.state(record).participants.server!.snapshotUri!, sourceHash: sha256('const price = 24;'), valuePaths: ['price'], interpretation: `Study ${label} captured price 24.` });
      await harness.reader.action('stop'); studyIds.push(`${service.instanceId}_${record.id}`);
    }
    const firstStudyId = studyIds[0]!, secondStudyId = studyIds[1]!;
    const secondSnapshotUri = service.state([...service.records.values()][1]!).participants.server!.snapshotUri!;
    await service.shutdown(); await harness.reader.retire(service); await harness.reader.dispose();
    cold = harness.createReader(); await cold.open();
    await cold['receive']({ type: 'history', revision: cold.inspect().view!.revision, studyId: firstStudyId }, 'context');
    let firstStudyReads = 0;
    context.mock.method(LearningLibrary.prototype, 'readCheckpoint', async function (this: LearningLibrary, id: string) {
      const checkpoint = await readCheckpoint.call(this, id);
      // Retry first reconciles A; hold only its later reload of the selected archive.
      if (id === firstStudyId && ++firstStudyReads === 2) { entered(); await held; }
      return checkpoint;
    });
    // Act
    retry = cold.action('retry'); await started;
    await cold['receive']({ type: 'history', revision: cold.inspect().view!.revision, studyId: secondStudyId }, 'context');
    const selectedSourceUri = cold.inspect().sourceUri;
    assert.equal(cold.inspect().view!.study?.id, secondStudyId);
    assert.equal(cold.inspect().view!.model.observation?.interpretations[0]?.text, 'Study B captured price 24.');
    release(); await retry;
    // Assert
    const selected = cold.inspect();
    assert.equal(selected.view!.model.selection.studyId, secondStudyId); assert.equal(selected.view!.study?.id, secondStudyId);
    assert.equal(selected.view!.model.observation?.snapshotUri, secondSnapshotUri);
    assert.equal(selected.view!.model.observation?.interpretations[0]?.text, 'Study B captured price 24.');
    assert.equal(selected.view!.model.observation?.values.price, 24); assert.equal(selected.sourceUri, selectedSourceUri);
    assert.equal(selected.view!.loading, false); assert.equal(selected.view!.errors.length, 0); assert.equal(harness.runtimes.length, 2);
  } finally { release(); await retry?.catch(() => undefined); context.mock.restoreAll(); await cold?.dispose(); await harness.close(); context.mock.timers.reset(); }
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

test('opening history revalidates its checkpoint after another writer leaves the cached catalog incomplete', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    const directory = harness.reader.inspect().libraryDirectory!, workspaceKey = directory.split('/').at(-1)!;
    const library = new LearningLibrary(directory, workspaceKey), instanceId = randomUUID(), runId = randomUUID(), studyId = `${instanceId}_${runId}`;
    await library.saveStudy({ version: 2, workspaceKey, id: studyId, instanceId, runId, profile: 'paired-cart-demo', createdAt: '2026-09-18T10:00:00.000Z', savedAt: '2026-09-18T10:00:01.000Z', state: 'stopped', terminal: true, finalOutcome: 'demonstrated', materialSignature: sha256('persisted-projection'), observations: [], captures: [], links: [] });
    await harness.reader.action('retry'); await harness.reader.open();
    assert.equal(harness.reader.inspect().view!.studies[0]?.metadata, 'validated');
    // Act: archive bytes remain readable, but the separately required metadata write is absent.
    await unlink(join(directory, `${studyId}.study.meta.v2.json`));
    harness.receive({ type: 'history', revision: harness.reader.inspect().view!.revision, studyId });
    await waitUntil(() => harness.reader.inspect().view!.model.selection.studyId === studyId && !harness.reader.inspect().view!.loading, 'incomplete selected checkpoint', 1_000);
    // Assert
    const selected = harness.reader.inspect().view!;
    assert.equal(selected.study?.historyOutcome, 'failed'); assert.equal(selected.study?.studyOutcome, 'partial');
    assert.equal(selected.studies[0]?.metadata, 'unavailable'); assert.ok(selected.errors.some(error => error.includes('checkpoint incomplete')));
    await harness.reader.action('retry');
    assert.equal(harness.reader.inspect().view!.study?.historyOutcome, 'saved'); assert.equal(harness.reader.inspect().view!.study?.studyOutcome, 'demonstrated');
  } finally { await harness.close(); }
});

test('an obsolete failed history read cannot downgrade a newer verified reader or API checkpoint', async context => {
  // Arrange: the first read observes a real missing sidecar before a later read repairs and verifies it.
  context.mock.timers.enable({ apis: ['setInterval'] });
  const harness = await workspaceHarness(), service = harness.service, readCheckpoint = LearningLibrary.prototype.readCheckpoint;
  let release = () => {}, entered = () => {}, firstRead = true;
  let olderSelection: Promise<void> | undefined;
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  try {
    await harness.reader.action('run'); const record = [...service.records.values()][0]!; await record.preparation;
    const runtime = harness.runtimes[0]!, originalView = runtime.view.bind(runtime);
    runtime.view = () => ({ ...originalView(), finalOutcome: 'demonstrated' });
    await harness.reader.open(); await harness.reader.action('stop');
    const studyId = `${service.instanceId}_${record.id}`, directory = harness.reader.inspect().libraryDirectory!;
    const library = new LearningLibrary(directory, directory.split('/').at(-1)!);
    await unlink(join(directory, `${studyId}.study.meta.v2.json`));
    context.mock.method(LearningLibrary.prototype, 'readCheckpoint', async function (this: LearningLibrary, id: string) {
      const checkpoint = await readCheckpoint.call(this, id);
      if (firstRead) { firstRead = false; assert.equal(checkpoint.status, 'failed'); entered(); await held; }
      return checkpoint;
    });
    const revision = harness.reader.inspect().view!.revision;
    // Act: await the message boundary directly so the obsolete read finishes before the assertions.
    olderSelection = harness.reader['receive']({ type: 'history', revision, studyId }, 'context');
    await started; await library.reconcile();
    await harness.reader['receive']({ type: 'history', revision, studyId }, 'context');
    assert.equal(harness.reader.inspect().view!.study?.historyOutcome, 'saved');
    release(); await olderSelection.catch(() => undefined);
    // Assert
    const selected = harness.reader.inspect().view!;
    assert.equal((await readCheckpoint.call(library, studyId)).status, 'saved');
    assert.equal(selected.study?.id, studyId); assert.equal(selected.study?.historyOutcome, 'saved');
    assert.equal(selected.study?.studyOutcome, 'demonstrated'); assert.equal(selected.loading, false);
    assert.equal(service.state(record).historyOutcome.status, 'saved'); assert.equal(service.state(record).studyOutcome, 'demonstrated');
    assert.equal(selected.errors.length, 0);
  } finally { release(); await olderSelection?.catch(() => undefined); context.mock.restoreAll(); await harness.close(); context.mock.timers.reset(); }
});

for (const retired of [false, true]) test(`failed disk verification downgrades a formerly saved ${retired ? 'retired' : 'attached'} study and Retry restores the exact checkpoint`, async () => {
  // Arrange
  const harness = await workspaceHarness(), service = harness.service;
  try {
    await harness.reader.action('run'); const record = [...service.records.values()][0]!; await record.preparation;
    const runtime = harness.runtimes[0]!, originalView = runtime.view.bind(runtime);
    runtime.view = () => ({ ...originalView(), finalOutcome: 'demonstrated' });
    await harness.reader.open(); await harness.reader.action('stop');
    if (retired) { await service.shutdown(); await harness.reader.retire(service); }
    const studyId = `${service.instanceId}_${record.id}`;
    assert.equal(harness.reader.inspect().view!.study?.studyOutcome, 'demonstrated');
    // Act
    await unlink(join(harness.reader.inspect().libraryDirectory!, `${studyId}.study.meta.v2.json`));
    harness.receive({ type: 'history', revision: harness.reader.inspect().view!.revision, studyId });
    await waitUntil(() => harness.reader.inspect().view!.study?.historyOutcome === 'failed' && !harness.reader.inspect().view!.loading, 'failed current checkpoint verification', 1_000);
    // Assert
    assert.equal(harness.reader.inspect().view!.study?.studyOutcome, 'partial');
    if (!retired) assert.equal(service.state(record).studyOutcome, 'partial');
    await harness.reader.action('retry');
    assert.equal(harness.reader.inspect().view!.study?.historyOutcome, 'saved'); assert.equal(harness.reader.inspect().view!.study?.studyOutcome, 'demonstrated');
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
    const input = harness.groups[0]!.activeTab!.input; assert.ok('uri' in input); assert.match(input.uri.toString(), /Captured-server\.mts$/);
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


test('a coalesced newer checkpoint reports failure when its predecessor fails instead of remaining pending forever', async context => {
  // Arrange
  const harness = await workspaceHarness(), saveStudy = LearningLibrary.prototype.saveStudy;
  let rejectFirst = () => {}, writes = 0;
  const held = new Promise<void>((_resolve, reject) => { rejectFirst = () => reject(new Error('First checkpoint denied')); });
  context.mock.method(LearningLibrary.prototype, 'saveStudy', async function (this: LearningLibrary, study: Parameters<LearningLibrary['saveStudy']>[0]) {
    if (++writes === 1) await held;
    return saveStudy.call(this, study);
  });
  try {
    const receipt = harness.service.start({ instanceId: harness.service.instanceId, profile: PROFILE_ID, key: 'coalesced-failure' });
    const record = harness.service.record(receipt); await record.preparation;
    await harness.reader.open(); await waitUntil(() => writes === 1, 'initial held checkpoint', 1_000);
    // Act
    await harness.reader.action('click');
    rejectFirst();
    await waitUntil(() => harness.service.state(record).historyOutcome.status === 'failed', 'latest rejected checkpoint receipt', 1_000);
    // Assert
    assert.equal(writes, 1); assert.match(harness.service.state(record).historyOutcome.reason!, /latest checkpoint was not saved/);
    assert.equal(harness.reader.inspect().view!.study?.historyOutcome, 'failed');
    await harness.reader.action('retry');
    assert.equal(harness.service.state(record).historyOutcome.status, 'saved');
    assert.equal(harness.reader.inspect().view!.model.observation?.values.cartCount, 0);
  } finally { rejectFirst(); context.mock.restoreAll(); await harness.close(); }
});

test('Close drains an accepted workbench arrangement batch without dispatching another layout change afterward', async () => {
  // Arrange
  const harness = await workspaceHarness();
  let release = () => {};
  try {
    await harness.reader.open();
    const widthsBefore = harness.commands.filter(name => name === 'workbench.action.evenEditorWidths').length;
    const held = harness.holdNextCommand('runCommands'); release = held.release;
    const arranging = harness.reader.action('arrange'); await held.started;
    let closed = false;
    // Act
    const closing = harness.reader.close().then(() => { closed = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    const closedWhileArrangementPending = closed;
    held.release(); await arranging.catch(() => undefined); await closing;
    // Assert
    assert.equal(closedWhileArrangementPending, false);
    assert.equal(harness.commands.filter(name => name === 'workbench.action.evenEditorWidths').length, widthsBefore + 1);
    assert.equal(harness.reader.inspect().opened, false);
  } finally { release(); await harness.close(); }
});

test('native transient half-pixel layout sizes are finalized in the workbench before Wiki ownership is verified', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.showTransientNativeSizes();
  try {
    // Act
    await harness.reader.open(); await harness.reader.arrangeRepository(new AbortController().signal);
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{}, {}, {}] });
    assert.equal(harness.commands.filter(name => name === 'runCommands').length, 2);
    assert.equal(harness.commands.filter(name => name === 'workbench.action.evenEditorWidths').length, 2);
  } finally { await harness.close(); }
});

for (const command of ['vscode.setEditorLayout', 'workbench.action.evenEditorWidths']) test(`a host-suppressed ${command} failure warns the learner and cannot claim the incomplete layout for a later Wiki return`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.showTransientNativeSizes(); harness.failNextCommand(command);
  try {
    // Act
    await harness.reader.open(); const incompleteLayout = harness.editorLayout();
    await harness.reader.arrangeRepository(new AbortController().signal);
    // Assert
    assert.deepEqual(harness.editorLayout(), incompleteLayout);
    assert.equal(harness.commands.filter(name => name === 'runCommands').length, 1);
    assert.equal(harness.reader.inspect().view!.errors.includes('Error: The editor did not retain the requested Codebook layout. Use the focus commands or arrange the Codebook panes manually.'), true);
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
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
    const snapshot = harness.service.snapshot(record, harness.service.state(record).participants.server!.snapshotUri!);
    const held = harness.holdNextSource(); release = held.release;
    // Act
    const revealing = harness.reader.presentation.revealSource(snapshot, 'server.mts'); await held.started;
    held.reject(new Error('Injected host source open failure'));
    // Assert
    await assert.rejects(revealing, /captured source.*not displayed/);
    assert.equal(harness.reader.inspect().view!.loading, true);
  } finally { release(); await harness.close(); }
});

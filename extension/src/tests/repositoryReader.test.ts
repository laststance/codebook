import { createConfiguredStudy } from './utils/createConfiguredStudy';
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, matchesGlob, relative, resolve } from 'node:path';
import { sha256 } from '../runtimeSupport/utils/sha256';
import { waitUntil } from '../runtimeSupport/utils/waitUntil';
import { LearningLibrary } from '../learningLibrary';
import { repositoryHarness } from './utils/repositoryHarness';
import { loadModule } from './utils/loadModule';
import type { RepositorySelection } from '../learnerSchemas';
import type { BookDocument, BookObservationBinding } from '../repositorySchemas';

/** Exercises the real reader/storage while mocking only editor effects, retaining explicit source/render receipts. @example const harness = await readerHarness(context) */
async function readerHarness(context: TestContext) {
  const source = await repositoryHarness(context), root = await realpath(source.directory);
  await source.track('src/module.ts', 'export const price = 24;\n'); await source.track('src/order.ts', 'export const total = 48;\n');
  const library = new LearningLibrary(join(root, '.learning'), sha256(root));
  const disposable = () => ({ dispose() {} });
  class EventEmitter { event = () => disposable(); fire() {} dispose() {} }
  class RelativePattern { constructor(readonly base: string, readonly pattern: string) {} }
  class Uri {
    readonly fsPath: string;
    constructor(readonly scheme: string, readonly authority: string, readonly path: string, readonly query = '', readonly fragment = '') { this.fsPath = path; }
    static from(value: { scheme: string; authority?: string; path?: string; query?: string }) { return new Uri(value.scheme, value.authority ?? '', value.path ?? '', value.query); }
    static file(path: string) { return new Uri('file', '', path); }
    toString() { return `${this.scheme}://${this.authority}${this.path}?${this.query}`; }
  }
  class TabInputText { constructor(readonly uri: Uri) {} }
  class Position {
    constructor(readonly line: number, readonly character: number) {}
    isEqual(other: Position) { return this.line === other.line && this.character === other.character; }
  }
  class Range {
    readonly start: Position;
    readonly end: Position;
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) { this.start = new Position(startLine, startCharacter); this.end = new Position(endLine, endCharacter); }
  }
  type NativeDocument = { uri: Uri; version: number; getText(): string };
  type NativeEditor = { document: NativeDocument; viewColumn: number; selections: { anchor: Position; active: Position }[] };
  type NativeSelectionEvent = { kind: number; textEditor: NativeEditor };
  let activeEditor: NativeEditor | undefined;
  const focusListeners = new Set<() => void>(), selectionListeners = new Set<(event?: NativeSelectionEvent) => void>(), tabListeners = new Set<() => void>(), groupListeners = new Set<() => void>();
  const sourceGroup: { viewColumn: number; tabs: { input: TabInputText }[]; activeTab?: { input: TabInputText } } = { viewColumn: 1, tabs: [] };
  const otherGroup: typeof sourceGroup = { viewColumn: 2, tabs: [] }; let activeGroup = sourceGroup;
  let requiresSourceFocus = false, coldLayout = false, arrangements = 0;
  let sourceDocumentGate: { entered(): void; wait: Promise<void> } | undefined;
  let sourceDisplayGate: { entered(): void; wait: Promise<void> } | undefined;
  let arrangementGate: { entered(): void; wait: Promise<void> } | undefined;
  let layoutResponseGate: { entered(): void; wait: Promise<void> } | undefined;
  let nativeCitationActivation = false;
  let citationActivationGate: { stage: 'target tab' | 'text gap' | 'initial caret'; entered(): void; wait: Promise<void> } | undefined;
  const panelColumns: number[] = [], reveals: number[] = [];
  let provider = async (_uri: Uri) => '', workspace = source.directory, connections = 0;
  let receive = (_message: unknown) => {};
  const shown: { uri: Uri; text: string }[] = [], panels = new Set<object>(), linked: { binding: BookObservationBinding; recording: boolean }[] = [];
  const textDocuments: { isDirty: boolean; uri: Uri; getText(): string }[] = [];
  const watchers: { pattern: RelativePattern; listeners: ((uri: Uri) => void)[] }[] = [];
  const boundary = await loadModule<typeof import('../repositoryReader')>(resolve(__dirname, '../repositoryReader.js'), {
    './environment': { requireWorkspace: () => workspace },
    vscode: { EventEmitter, Uri, TabInputText, ViewColumn: { One: 1, Two: 2 }, RelativePattern, Range, TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2, Command: 3 },
      workspace: { textDocuments, registerTextDocumentContentProvider: (_scheme: string, value: { provideTextDocumentContent(uri: Uri): Promise<string> }) => { provider = value.provideTextDocumentContent; return disposable(); },
        onDidChangeTextDocument: disposable, createFileSystemWatcher: (pattern: RelativePattern) => {
          const watcher = { pattern, listeners: Array<(uri: Uri) => void>() }; watchers.push(watcher);
          const listen = (callback: (uri: Uri) => void) => { watcher.listeners.push(callback); return disposable(); };
          return { dispose() { watcher.listeners = []; }, onDidChange: listen, onDidCreate: listen, onDidDelete: listen };
        },
        openTextDocument: async (uri: Uri) => {
          const text = uri.scheme === 'file' ? await readFile(uri.fsPath, 'utf8') : await provider(uri);
          const held = sourceDocumentGate; sourceDocumentGate = undefined; if (held) { held.entered(); await held.wait; }
          const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), lines = normalized.split('\n');
          return { uri, version: 1, getText: () => normalized, validateRange: (range: Range) => {
            const startLine = Math.min(range.start.line, lines.length - 1), endLine = Math.min(range.end.line, lines.length - 1);
            return new Range(startLine, Math.min(range.start.character, lines[startLine]!.length), endLine, Math.min(range.end.character, lines[endLine]!.length));
          } };
        } },
      window: { registerTreeDataProvider: disposable, get activeTextEditor() { return activeEditor; }, tabGroups: { all: [sourceGroup, otherGroup], get activeTabGroup() { return activeGroup; },
        onDidChangeTabs(callback: () => void) { tabListeners.add(callback); return { dispose() { tabListeners.delete(callback); } }; },
        onDidChangeTabGroups(callback: () => void) { groupListeners.add(callback); return { dispose() { groupListeners.delete(callback); } }; } },
        onDidChangeActiveTextEditor(callback: () => void) { focusListeners.add(callback); return { dispose() { focusListeners.delete(callback); } }; },
        onDidChangeTextEditorSelection(callback: (event?: NativeSelectionEvent) => void) { selectionListeners.add(callback); return { dispose() { selectionListeners.delete(callback); } }; },
        showTextDocument: async (document: NativeDocument, options?: { viewColumn?: number; preserveFocus?: boolean; selection?: Range }) => {
          shown.push({ uri: document.uri, text: document.getText() });
          const editor = { document, viewColumn: options?.viewColumn ?? 1, selections: [{ anchor: options?.selection?.start ?? new Position(0, 0), active: options?.selection?.end ?? new Position(0, 0) }] }, tab = { input: new TabInputText(document.uri) };
          sourceGroup.tabs.push(tab); sourceGroup.activeTab = tab;
          if (!options?.preserveFocus && nativeCitationActivation) {
            const pauseAt = async (stage: NonNullable<typeof citationActivationGate>['stage']) => { const held = citationActivationGate; if (held?.stage === stage) { citationActivationGate = undefined; held.entered(); await held.wait; } };
            // Replay the ordinary Cursor trace: target tab, missing text editor, initial caret, requested command selection.
            for (const listener of tabListeners) listener(); await pauseAt('target tab');
            activeEditor = undefined; for (const listener of focusListeners) listener(); await pauseAt('text gap');
            activeEditor = { ...editor, selections: [{ anchor: new Position(0, 0), active: new Position(0, 0) }] };
            for (const listener of focusListeners) listener(); await pauseAt('initial caret');
            activeEditor = editor; for (const listener of selectionListeners) listener({ kind: 3, textEditor: editor });
          } else if (!options?.preserveFocus) { activeEditor = editor; for (const listener of focusListeners) listener(); }
          const held = sourceDisplayGate; sourceDisplayGate = undefined; if (held) { held.entered(); await held.wait; }
          return editor;
        },
        createWebviewPanel: (_kind: string, _title: string, options: number | { viewColumn: number; preserveFocus?: boolean }) => {
          const column = typeof options === 'number' ? options : options.viewColumn; panelColumns.push(column);
          if (typeof options === 'number' || !options.preserveFocus) { activeEditor = undefined; for (const listener of focusListeners) listener(); }
          let disposed = () => {}; const panel = { title: '', reveal(column: number) { reveals.push(column); }, dispose() { panels.delete(panel); disposed(); }, onDidDispose(callback: () => void) { disposed = callback; },
          webview: { html: '', postMessage: async () => true, onDidReceiveMessage: (callback: (value: unknown) => void) => { receive = callback; return disposable(); } } }; panels.add(panel); return panel; } },
    },
  });
  const createReader = () => new boundary.RepositoryReader({ storage: async () => library, connect: async () => { connections++; }, arrange: async (_signal, _selection, focus) => {
    arrangements++;
    const held = arrangementGate; arrangementGate = undefined; if (held) { held.entered(); await held.wait; }
    focus?.begin();
    const retained = coldLayout ? focus?.retainCurrentFocus?.() : undefined;
    const response = layoutResponseGate; layoutResponseGate = undefined; if (response) { response.entered(); await response.wait; }
    retained?.assertRetained();
    if (requiresSourceFocus) { assert.ok(focus?.acquireSourceFocus, 'Ambiguous main focus requires the actual selected citation.'); const assertFocused = await focus.acquireSourceFocus(); assertFocused(); }
  }, evidence: async (binding, recording) => { linked.push({ binding, recording }); } });
  const reader = createReader(), store = await reader.storage(); context.after(() => reader.dispose());
  const first = await source.sources.read('src/module.ts'), second = await source.sources.read('src/order.ts');
  const document: BookDocument = { title: 'Architecture', summary: 'Source-derived architecture.', nodes: [
    { id: 'module', title: 'Module', sections: [{ title: 'Price', text: 'The module exports price 24.' }, { title: 'Order', text: 'Order exports total 48.' }], anchors: [first, second].map(value => ({ path: value.path, hash: value.hash, startLine: 1, endLine: 2 })), observations: [] },
    { id: 'order', title: 'Order', sections: [{ title: 'Total', text: 'The order exports total 48.' }], anchors: [{ path: second.path, hash: second.hash, startLine: 1, endLine: 2 }], observations: [] },
  ], edges: [{ from: 'module', to: 'order', relationship: 'related', explanation: 'Both export pricing values.' }] };
  await store.publish({ bookId: 'architecture', key: 'first', expectedRevision: 0, document });
  const selection: RepositorySelection = { bookId: 'architecture', revision: 1, nodeId: 'module', anchorIndex: 0 };
  return { ...source, library, reader, store, selection, document, shown, panels, linked, textDocuments, Uri, createReader, panelColumns, reveals, receive: (message: unknown) => receive(message),
    requireSourceFocus() { requiresSourceFocus = true; }, arrangements: () => arrangements,
    useColdLayout() { coldLayout = true; },
    useNativeCitationActivation() { nativeCitationActivation = true; },
    holdCitationActivation(stage: NonNullable<typeof citationActivationGate>['stage']) { let entered!: () => void, release!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; }); citationActivationGate = { stage, entered, wait }; return { started, release }; },
    holdLayoutResponse() { let entered!: () => void, release!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; }); layoutResponseGate = { entered, wait }; return { started, release }; },
    holdArrangement() { let entered!: () => void, release!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; }); arrangementGate = { entered, wait }; return { started, release }; },
    holdSourceDocument() { let entered!: () => void, release!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; }); sourceDocumentGate = { entered, wait }; return { started, release }; },
    holdSourceDisplay() { let entered!: () => void, release!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; }); sourceDisplayGate = { entered, wait }; return { started, release }; },
    focusedSource: () => activeEditor, focusListenerCount: () => focusListeners.size + selectionListeners.size + tabListeners.size + groupListeners.size,
    selectSource(line: number, character: number, kind = 3) { assert.ok(activeEditor); activeEditor.selections = [{ anchor: new Position(line, character), active: new Position(line, character) }]; for (const listener of selectionListeners) listener({ kind, textEditor: activeEditor }); },
    focusSourceEditor(editor: NativeEditor) { activeEditor = editor; for (const listener of focusListeners) listener(); },
    roundtripCitationTab() { const citation = sourceGroup.activeTab, editor = activeEditor; sourceGroup.activeTab = { input: new TabInputText(Uri.file(join(root, 'unrelated-draft.txt'))) }; for (const listener of tabListeners) listener(); activeEditor = editor; sourceGroup.activeTab = citation; for (const listener of tabListeners) listener(); },
    switchTabGroup(toSource = false) { activeGroup = toSource ? sourceGroup : otherGroup; for (const listener of groupListeners) listener(); },
    focusChat() { activeEditor = undefined; for (const listener of focusListeners) listener(); },
    focusUnrelatedDraft(filename = 'unrelated-draft.txt') { const document = { uri: Uri.file(join(root, filename)), version: 1, getText: () => 'Keep my draft.' }, tab = { input: new TabInputText(document.uri) }; activeEditor = { document, viewColumn: 1, selections: [{ anchor: new Position(0, 0), active: new Position(0, 0) }] }; sourceGroup.tabs.push(tab); sourceGroup.activeTab = tab; for (const listener of focusListeners) listener(); },
    connections: () => connections, changeWorkspace: () => { workspace = '/another/workspace'; }, provider: (uri: Uri) => provider(uri),
    fileEvent: (path: string, kind: number) => { for (const watcher of watchers) if (matchesGlob(relative(watcher.pattern.base, path), watcher.pattern.pattern)) watcher.listeners[kind]?.(Uri.file(path)); } };
}

test('repository articles open retained source without connecting an agent or marking understanding', async context => {
  // Arrange
  const harness = await readerHarness(context);
  // Act
  await harness.reader.open(); const state = harness.reader.inspect();
  // Assert
  assert.equal(state.view.selection?.nodeId, 'module'); assert.equal(state.view.loading, false);
  assert.equal(harness.shown[0]?.text, 'export const price = 24;\n'); assert.equal(harness.connections(), 0);
  assert.equal(state.view.sources[0]?.status, 'current'); assert.equal((await harness.library.readProgress()).decisions.length, 0);
  assert.equal('sources' in state.view.book!.revision, false);
});

for (const entry of ['cold ordinary text', 'ambiguous primary'] as const) test(`${entry} Wiki opens after native citation activation reports a missing editor and initial caret`, async context => {
  // Arrange
  const harness = await readerHarness(context); harness.focusUnrelatedDraft(); harness.useNativeCitationActivation();
  if (entry === 'cold ordinary text') harness.useColdLayout();
  if (entry === 'ambiguous primary') harness.requireSourceFocus();
  const listeners = harness.focusListenerCount();
  // Act
  await harness.reader.open(harness.selection);
  // Assert
  assert.deepEqual(harness.reveals, [2]); assert.equal(harness.shown.length, 1); assert.equal(harness.reader.inspect().view.loading, false);
  assert.equal(harness.reader.inspect().view.selection?.nodeId, 'module'); assert.equal(harness.reader.inspect().view.sources[0]?.status, 'current');
  assert.equal(harness.focusListenerCount(), listeners); assert.equal((await harness.library.readProgress()).decisions.length, 0);
});

for (const interaction of ['selection', 'selection roundtrip', 'tab roundtrip', 'group', 'group roundtrip', 'editor retreat', 'text gap', 'Keyboard', 'Mouse', 'document version roundtrip'] as const) test(`cold Wiki preserves ${interaction} during native citation initial caret before the requested range arrives`, async context => {
  // Arrange
  const harness = await readerHarness(context); harness.useColdLayout(); harness.focusUnrelatedDraft(); harness.useNativeCitationActivation();
  const original = harness.focusedSource()!, listeners = harness.focusListenerCount(), held = harness.holdCitationActivation('initial caret');
  const opening = harness.reader.open(harness.selection), rejected = assert.rejects(opening, /focus changed/);
  try {
    await held.started;
    // Act
    if (interaction === 'selection' || interaction === 'selection roundtrip') harness.selectSource(0, 6);
    if (interaction === 'selection roundtrip') harness.selectSource(0, 0);
    if (interaction === 'tab roundtrip') harness.roundtripCitationTab();
    if (interaction === 'group' || interaction === 'group roundtrip') harness.switchTabGroup();
    if (interaction === 'group roundtrip') harness.switchTabGroup(true);
    if (interaction === 'editor retreat') harness.focusSourceEditor(original);
    if (interaction === 'text gap') harness.focusChat();
    if (interaction === 'Keyboard' || interaction === 'Mouse') harness.selectSource(0, 0, interaction === 'Keyboard' ? 1 : 2);
    if (interaction === 'document version roundtrip') { const editor = harness.focusedSource()!; editor.document.version = 2; harness.focusSourceEditor(editor); editor.document.version = 1; harness.focusSourceEditor(editor); }
    held.release(); await rejected;
    // Assert: the accepted host display can drain, but no later Wiki activation or learning-state write follows.
    assert.deepEqual(harness.reveals, []); assert.equal(harness.panels.size, 0); assert.equal(harness.shown.length, 1);
    assert.equal((await harness.library.readProgress()).repositorySelection, undefined); assert.equal(harness.focusListenerCount(), listeners);
  } finally { held.release(); await opening.catch(() => undefined); }
});

for (const stage of ['target tab', 'text gap'] as const) test(`cold Wiki rejects newer editor input during citation ${stage} before the target editor appears`, async context => {
  // Arrange
  const harness = await readerHarness(context); harness.useColdLayout(); harness.focusUnrelatedDraft(); harness.useNativeCitationActivation();
  const original = harness.focusedSource()!, held = harness.holdCitationActivation(stage), listeners = harness.focusListenerCount();
  const opening = harness.reader.open(harness.selection), rejected = assert.rejects(opening, /focus changed/);
  try {
    await held.started;
    // Act
    if (stage === 'target tab') harness.selectSource(0, 6);
    else harness.focusSourceEditor(original);
    held.release(); await rejected;
    // Assert
    assert.deepEqual(harness.reveals, []); assert.equal(harness.panels.size, 0); assert.equal(harness.focusListenerCount(), listeners);
    assert.equal((await harness.library.readProgress()).repositorySelection, undefined);
  } finally { held.release(); await opening.catch(() => undefined); }
});

for (const interaction of ['different file', 'selection', 'tab roundtrip', 'none'] as const) test(`cold Wiki reservation ${interaction === 'none' ? 'opens the actual citation without losing navigation ownership' : `preserves newer ${interaction} instead of revealing stale Wiki`}`, async context => {
  // Arrange
  const harness = await readerHarness(context); harness.useColdLayout(); harness.focusUnrelatedDraft('original-draft.txt');
  const draft = harness.focusedSource(), listeners = harness.focusListenerCount(), held = harness.holdLayoutResponse();
  const opening = harness.reader.open(harness.selection), outcome = interaction === 'none' ? opening : assert.rejects(opening, /focus changed/);
  try {
    await held.started;
    // Act
    if (interaction === 'different file') harness.focusUnrelatedDraft();
    if (interaction === 'selection') harness.selectSource(0, 6);
    if (interaction === 'tab roundtrip') harness.roundtripCitationTab();
    const latestFocus = harness.focusedSource(); held.release(); await outcome;
    // Assert
    assert.equal(harness.focusListenerCount(), listeners); assert.equal((await harness.library.readProgress()).decisions.length, 0);
    if (interaction === 'none') {
      assert.equal(harness.shown.length, 1); assert.deepEqual(harness.reveals, [2]);
      assert.equal(harness.reader.inspect().sourceUri, harness.shown[0]!.uri.toString());
    } else {
      assert.equal(harness.shown.length, 0); assert.deepEqual(harness.reveals, []); assert.equal(harness.panels.size, 0);
      assert.equal((await harness.library.readProgress()).repositorySelection, undefined);
      assert.equal(harness.focusedSource(), latestFocus);
      if (interaction === 'selection') assert.equal(draft!.selections[0]!.active.character, 6);
    }
  } finally { held.release(); await opening.catch(() => undefined); }
});

for (const boundary of ['source lookup', 'progress storage', 'source refresh'] as const) test(`cold Wiki preserves chat focus during ${boundary} after its native reservation`, async context => {
  // Arrange
  const harness = await readerHarness(context); harness.useColdLayout(); harness.focusUnrelatedDraft();
  const listeners = harness.focusListenerCount(); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const sourceLookup = boundary === 'source lookup' ? harness.holdSourceDocument() : undefined;
  if (boundary === 'progress storage') {
    const save = harness.library.selectRepository.bind(harness.library);
    harness.library.selectRepository = async selection => { entered(); await held; await save(selection); };
  }
  if (boundary === 'source refresh') {
    const inspect = harness.store.sources.inspect.bind(harness.store.sources);
    harness.store.sources.inspect = async anchors => { entered(); await held; return inspect(anchors); };
  }
  const opening = harness.reader.open(harness.selection), rejected = assert.rejects(opening, /focus changed/);
  try {
    await Promise.race([sourceLookup?.started ?? started, opening]);
    // Act
    harness.focusChat(); sourceLookup?.release(); release(); await rejected;
    // Assert
    assert.deepEqual(harness.reveals, []); assert.equal(harness.focusedSource(), undefined);
    assert.equal(harness.focusListenerCount(), listeners); assert.equal((await harness.library.readProgress()).decisions.length, 0);
    assert.equal(harness.shown.length, boundary === 'source lookup' ? 0 : 1);
  } finally { sourceLookup?.release(); release(); await opening.catch(() => undefined); }
});

test('cold Wiki with an empty library activates its empty reader without inventing a citation or retaining listeners', async context => {
  // Arrange
  const harness = await readerHarness(context); harness.useColdLayout(); harness.focusUnrelatedDraft();
  harness.store.list = async () => []; const listeners = harness.focusListenerCount();
  // Act
  await harness.reader.open();
  // Assert
  assert.equal(harness.shown.length, 0); assert.deepEqual(harness.reveals, [2]); assert.equal(harness.panels.size, 1);
  assert.equal(harness.reader.inspect().view.loading, false); assert.equal(harness.reader.inspect().sourceUri, undefined);
  assert.equal(harness.focusListenerCount(), listeners); assert.equal((await harness.library.readProgress()).repositorySelection, undefined);
});

for (const retirement of ['abort', 'Close', 'new Open'] as const) test(`${retirement} during cold Wiki reservation releases its own focus receipt without a stale reveal`, async context => {
  // Arrange
  const harness = await readerHarness(context); harness.useColdLayout(); harness.focusUnrelatedDraft();
  const listeners = harness.focusListenerCount(), held = harness.holdLayoutResponse(), cancellation = new AbortController();
  const opening = harness.reader.open(harness.selection, cancellation.signal), rejected = assert.rejects(opening, /abort|cancel|superseded|changed/i);
  try {
    await held.started;
    // Act
    if (retirement === 'abort') cancellation.abort();
    if (retirement === 'Close') harness.reader.close();
    if (retirement === 'new Open') await harness.reader.open({ ...harness.selection, nodeId: 'order' });
    held.release(); await rejected;
    // Assert
    assert.equal(harness.focusListenerCount(), listeners); assert.equal((await harness.library.readProgress()).decisions.length, 0);
    assert.deepEqual(harness.reveals, retirement === 'new Open' ? [2] : []);
    assert.equal(harness.shown.length, retirement === 'new Open' ? 1 : 0);
  } finally { held.release(); await opening.catch(() => undefined); }
});

test('Wiki opens its real retained citation before resolving an otherwise ambiguous primary pane', async context => {
  // Arrange
  const harness = await readerHarness(context); harness.requireSourceFocus();
  // Act
  await harness.reader.open(harness.selection);
  // Assert
  assert.deepEqual(harness.panelColumns, [2]); assert.deepEqual(harness.reveals, [2]);
  assert.equal(harness.shown.length, 1); assert.equal(harness.shown[0]!.text, 'export const price = 24;\n');
  assert.equal(harness.reader.inspect().sourceUri, harness.shown[0]!.uri.toString());
  assert.equal(harness.reader.inspect().view.selection?.nodeId, 'module'); assert.equal(harness.reader.inspect().view.loading, false);
  assert.equal(harness.connections(), 0); assert.equal((await harness.library.readProgress()).decisions.length, 0);
});

test('an unavailable Wiki citation cannot acquire native layout or focus as a temporary anchor', async context => {
  // Arrange
  const harness = await readerHarness(context); harness.requireSourceFocus();
  // Act
  await assert.rejects(harness.reader.open({ ...harness.selection, revision: 9 }), /revision 9 is unavailable/);
  // Assert
  assert.equal(harness.arrangements(), 0); assert.equal(harness.shown.length, 0); assert.equal(harness.panels.size, 0);
});

for (const entry of ['ambiguous scope', 'cold ordinary text'] as const) for (const interaction of ['selection', 'tab roundtrip', 'none'] as const) test(`${entry} Wiki citation display response preserves later ${interaction} without adopting new learner ownership`, async context => {
  // Arrange
  const harness = await readerHarness(context);
  if (entry === 'ambiguous scope') harness.requireSourceFocus();
  else { harness.useColdLayout(); harness.focusUnrelatedDraft(); }
  const held = harness.holdSourceDisplay();
  const listeners = harness.focusListenerCount(), opening = harness.reader.open(harness.selection);
  const outcome = interaction === 'none' ? opening : assert.rejects(opening, /focus changed/);
  try {
    await held.started; const source = harness.focusedSource(); assert.ok(source);
    // Act
    if (interaction === 'selection') harness.selectSource(0, 6);
    if (interaction === 'tab roundtrip') harness.roundtripCitationTab();
    held.release(); await outcome;
    // Assert
    assert.equal(harness.focusListenerCount(), listeners); assert.equal(harness.shown.length, 1);
    assert.equal((await harness.library.readProgress()).decisions.length, 0);
    if (interaction === 'none') {
      assert.deepEqual(harness.reveals, [2]); assert.equal(harness.reader.inspect().view.loading, false);
      assert.equal((await harness.library.readProgress()).repositorySelection?.nodeId, 'module');
    } else {
      assert.equal(harness.panels.size, 0); assert.deepEqual(harness.reveals, []); assert.equal(harness.focusedSource(), source);
      assert.equal((await harness.library.readProgress()).repositorySelection, undefined);
      assert.deepEqual(source.selections.map(selection => [selection.active.line, selection.active.character]), interaction === 'selection' ? [[0, 6]] : [[1, 0]]);
    }
  } finally { held.release(); await opening.catch(() => undefined); }
});

test('chat focus during Wiki progress storage prevents the old Open from revealing its reader again', async context => {
  // Arrange
  const harness = await readerHarness(context); harness.requireSourceFocus();
  const save = harness.library.selectRepository.bind(harness.library);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  harness.library.selectRepository = async selection => { entered(); await held; await save(selection); };
  const opening = harness.reader.open(harness.selection); void opening.catch(() => undefined);
  try {
    // Act
    await Promise.race([started, opening]); harness.focusChat(); release();
    await assert.rejects(opening, /focus changed/);
    // Assert
    assert.deepEqual(harness.reveals, []); assert.equal(harness.shown.length, 1);
    assert.equal((await harness.library.readProgress()).decisions.length, 0);
  } finally { release(); await opening.catch(() => undefined); }
});

test('manual draft focus while the Wiki catalog loads prevents later source focus acquisition', async context => {
  // Arrange
  const harness = await readerHarness(context); harness.requireSourceFocus();
  const list = harness.store.list.bind(harness.store);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  harness.store.list = async () => { entered(); await held; return list(); };
  const opening = harness.reader.open(harness.selection), rejected = assert.rejects(opening, /focus changed/);
  try {
    // Act
    await started; harness.focusUnrelatedDraft(); release(); await rejected;
    // Assert
    assert.equal(harness.arrangements(), 0); assert.equal(harness.shown.length, 0); assert.equal(harness.panels.size, 0);
    assert.equal((await harness.library.readProgress()).repositorySelection, undefined);
  } finally { release(); await opening.catch(() => undefined); }
});

for (const primary of ['opaque', 'text'] as const) test(`manual draft focus while ${primary}-primary Wiki layout waits prevents a later citation or reader reveal`, async context => {
  // Arrange
  const harness = await readerHarness(context);
  if (primary === 'opaque') harness.requireSourceFocus();
  const held = harness.holdArrangement();
  const opening = harness.reader.open(harness.selection), rejected = assert.rejects(opening, /focus changed/);
  try {
    // Act
    await held.started; harness.focusUnrelatedDraft(); held.release(); await rejected;
    // Assert
    assert.equal(harness.shown.length, 0); assert.equal(harness.panels.size, 0); assert.deepEqual(harness.reveals, []);
    assert.equal((await harness.library.readProgress()).repositorySelection, undefined);
  } finally { held.release(); await opening.catch(() => undefined); }
});

for (const interruption of ['manual focus', 'Close'] as const) test(`${interruption} during actual citation acquisition prevents a late native source or Wiki reveal`, async context => {
  // Arrange
  const harness = await readerHarness(context); harness.requireSourceFocus(); const held = harness.holdSourceDocument();
  const opening = harness.reader.open(harness.selection), rejected = assert.rejects(opening, /focus changed|superseded or closed/);
  try {
    // Act
    await held.started;
    if (interruption === 'Close') harness.reader.close();
    else harness.focusUnrelatedDraft();
    held.release(); await rejected;
    // Assert
    assert.equal(harness.shown.length, 0); assert.equal(harness.panels.size, 0); assert.deepEqual(harness.reveals, []);
    assert.equal((await harness.library.readProgress()).repositorySelection, undefined);
  } finally { held.release(); await opening.catch(() => undefined); }
});

test('publishing clearer prose advertises a newer revision without replacing the selected historical article or its understanding', async context => {
  // Arrange
  const harness = await readerHarness(context); await harness.reader.open(harness.selection); await harness.reader.understand(true);
  // Act
  await harness.store.publish({ bookId: 'architecture', key: 'second', expectedRevision: 1, document: { ...harness.document, title: 'Clearer architecture' } });
  await harness.reader.published(); const historical = harness.reader.inspect().view;
  await harness.reader.action('latest'); const latest = harness.reader.inspect().view;
  // Assert
  assert.equal(historical.selection?.revision, 1); assert.equal(historical.book?.latestRevision, 2); assert.equal(historical.understanding?.understood, true);
  assert.equal(latest.selection?.revision, 2); assert.equal(latest.understanding?.understood, true); assert.equal((await harness.library.readProgress()).decisions.length, 1);
});

test('secondary citation edits and unsaved editor changes require review while historical understanding stays retained', async context => {
  // Arrange
  const harness = await readerHarness(context); await harness.reader.open(); await harness.reader.understand(true);
  // Act
  await writeFile(join(harness.directory, 'src/order.ts'), 'export const total = 72;\n'); await harness.reader.action('refresh');
  const edited = harness.reader.inspect().view;
  harness.textDocuments.push({ uri: harness.Uri.file(join(harness.store.sources.workspace, 'src/module.ts')), isDirty: true, getText: () => 'export const price = 30;' });
  await harness.reader.action('refresh');
  // Assert
  assert.equal(edited.sources[1]?.status, 'changed'); assert.equal(edited.understanding?.understood, true);
  assert.equal(harness.reader.inspect().view.sources[0]?.status, 'changed'); assert.equal((await harness.library.readProgress()).decisions.length, 1);
});

test('a fresh reader restores exact revision article citation section-relative position and focus from the shared ledger', async context => {
  // Arrange
  const harness = await readerHarness(context), selection = { ...harness.selection, anchorIndex: 1, location: { sectionIndex: 1, fraction: 0.4, focusId: 'section-1' } };
  await harness.reader.open(selection); harness.reader.close(); const fresh = harness.createReader(); context.after(() => fresh.dispose());
  // Act
  await fresh.open();
  // Assert
  assert.equal(JSON.stringify(fresh.inspect().view.selection), JSON.stringify(selection)); assert.equal(harness.shown.at(-1)?.text, 'export const total = 48;\n');
  assert.equal((await harness.library.readProgress()).decisions.length, 0);
});

test('an unchanged BOM source opens in the current native editor while retained bytes keep their original hash', async context => {
  // Arrange
  const harness = await readerHarness(context); await harness.track('src/module.ts', '\uFEFFexport const price = 24;\n');
  const source = await harness.sources.read('src/module.ts'); harness.document.nodes[0]!.anchors[0]!.hash = source.hash;
  await harness.store.publish({ bookId: 'architecture', key: 'bom', expectedRevision: 1, document: harness.document });
  await harness.reader.open({ ...harness.selection, revision: 2 });
  // Act
  await harness.reader.action('current-file');
  // Assert
  assert.equal(harness.shown.at(-1)?.uri.scheme, 'file'); assert.equal(harness.shown.at(-1)?.text, 'export const price = 24;\n');
  assert.equal((await harness.store.read('architecture', 2)).revision.sources[0]?.text, '\uFEFFexport const price = 24;\n');
});

test('an old dirty buffer cannot certify a changed or unavailable cited file as current', async context => {
  // Arrange
  const harness = await readerHarness(context); await harness.reader.open();
  harness.textDocuments.push({ uri: harness.Uri.file(join(harness.store.sources.workspace, 'src/module.ts')), isDirty: true, getText: () => 'export const price = 24;\n' });
  const inspect = harness.store.sources.inspect.bind(harness.store.sources), values = await inspect(harness.document.nodes[0]!.anchors);
  // Act / Assert
  for (const status of ['changed', 'unavailable'] as const) {
    harness.store.sources.inspect = async () => values.map(value => ({ ...value, status }));
    await harness.reader.action('refresh'); assert.equal(harness.reader.inspect().view.sources[0]?.status, status);
  }
});

test('mixed and CR-only line endings retain bytes while citation lines and current-file reveal match the native text model', async context => {
  // Arrange
  const harness = await readerHarness(context);
  await harness.track('src/module.ts', 'export const price = 24;\rexport const total = 48;\r\n');
  const source = await harness.sources.read('src/module.ts'); harness.document.nodes[0]!.anchors[0] = { path: source.path, hash: source.hash, startLine: 2, endLine: 3 };
  // Act
  await harness.store.publish({ bookId: 'architecture', key: 'mixed-eol', expectedRevision: 1, document: harness.document });
  await harness.reader.open({ ...harness.selection, revision: 2 }); await harness.reader.action('current-file');
  // Assert
  assert.equal(source.lineCount, 3); assert.equal(harness.shown.at(-1)?.uri.scheme, 'file');
  assert.equal(harness.shown.at(-1)?.text, 'export const price = 24;\nexport const total = 48;\n');
  assert.equal((await harness.store.read('architecture', 2)).revision.sources[0]?.text, 'export const price = 24;\rexport const total = 48;\r\n');
});

test('bracket-named route citations update review status after external edit deletion and recreation without manual refresh', async context => {
  // Arrange
  const harness = await readerHarness(context); await harness.track('src/routes/[id]/page.ts', 'export const price = 24;\n');
  const source = await harness.sources.read('src/routes/[id]/page.ts'); harness.document.nodes[0]!.anchors[0] = { path: source.path, hash: source.hash, startLine: 1, endLine: 2 };
  await harness.store.publish({ bookId: 'architecture', key: 'bracket-route', expectedRevision: 1, document: harness.document });
  await harness.reader.open({ ...harness.selection, revision: 2 }); await harness.reader.understand(true);
  const path = join(harness.store.sources.workspace, source.path);
  // Act / Assert: the mock applies actual glob matching before delivering each filesystem event.
  await writeFile(path, 'export const price = 30;\n'); harness.fileEvent(path, 0);
  await waitUntil(() => harness.reader.inspect().view.sources[0]?.status === 'changed', 'external route edit requests review', 2_000);
  await rm(path); harness.fileEvent(path, 2);
  await waitUntil(() => harness.reader.inspect().view.sources[0]?.status === 'unavailable', 'deleted route becomes unavailable', 2_000);
  await writeFile(path, 'export const price = 24;\n'); harness.fileEvent(path, 1);
  await waitUntil(() => harness.reader.inspect().view.sources[0]?.status === 'current', 'restored cited bytes become current', 2_000);
  assert.equal(harness.reader.inspect().view.understanding?.understood, true); assert.equal((await harness.library.readProgress()).decisions.length, 1);
});

test('retiring an agent open before its checkpoint completes prevents source and selection effects while local reading remains available', async context => {
  // Arrange
  const harness = await readerHarness(context); await harness.reader.open(); const shown = harness.shown.length;
  const read = harness.store.read.bind(harness.store); let release = () => {}, enter = () => {}, held = true;
  const entered = new Promise<void>(resolve => { enter = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; }), cancellation = new AbortController();
  harness.store.read = async (...arguments_: Parameters<typeof read>) => { const result = await read(...arguments_); if (held) { held = false; enter(); await waiting; } return result; };
  // Act
  const pending = harness.reader.openFromAgent({ instanceId: '11111111-1111-4111-8111-111111111111', ...harness.selection, nodeId: 'order' }, cancellation.signal);
  const rejected = assert.rejects(pending, /superseded or closed/); await entered; cancellation.abort(); release(); await rejected;
  // Assert
  assert.equal(harness.shown.length, shown); assert.equal((await harness.library.readProgress()).repositorySelection?.nodeId, 'module');
  await harness.reader.open(); assert.equal(harness.reader.inspect().view.selection?.nodeId, 'module'); assert.equal(harness.reader.inspect().view.error, '');
});

test('missing saved history reports its exact revision instead of silently falling forward to the latest', async context => {
  // Arrange
  const harness = await readerHarness(context); await harness.library.selectRepository({ ...harness.selection, revision: 9 });
  // Act / Assert
  await assert.rejects(harness.reader.open(), /revision 9 is unavailable/);
  assert.equal(harness.shown.length, 0); assert.equal((await harness.library.readProgress()).repositorySelection?.revision, 9);
  assert.equal(harness.reader.inspect().view.catalog[0]?.revision, 1);
});

test('late article navigation cannot replace a newer selection or reopen a closed repository panel', async context => {
  // Arrange
  const harness = await readerHarness(context); await harness.reader.open();
  const read = harness.store.read.bind(harness.store); let release = () => {}, enter = () => {}, held = true;
  const entered = new Promise<void>(resolve => { enter = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
  harness.store.read = async (...arguments_: Parameters<typeof read>) => { const result = await read(...arguments_); if (held) { held = false; enter(); await waiting; } return result; };
  // Act
  const old = harness.reader.open(harness.selection); const rejected = assert.rejects(old, /superseded or closed/); await entered;
  await harness.reader.open({ ...harness.selection, nodeId: 'order' }); release(); await rejected;
  // Assert
  assert.equal(harness.reader.inspect().view.selection?.nodeId, 'order'); assert.equal(harness.reader.inspect().view.error, '');
  harness.reader.close(); assert.equal(harness.panels.size, 0); assert.equal(harness.reader.inspect().opened, false);
});

test('delayed scroll and render receipts from a previous article do not warn on the new article or overwrite its return context', async context => {
  // Arrange
  const harness = await readerHarness(context); await harness.reader.open(); const previous = harness.reader.inspect().view;
  await harness.reader.open({ ...harness.selection, nodeId: 'order' });
  // Act
  harness.receive({ type: 'rendered', revision: previous.revision, selection: previous.selection, width: 390 });
  harness.receive({ type: 'location', revision: previous.revision, selection: { ...previous.selection, location: { sectionIndex: 1, fraction: 0.5, focusId: 'section-0' } } });
  await Promise.resolve(); await harness.library.flush();
  // Assert
  assert.equal(harness.reader.inspect().view.error, ''); assert.equal((await harness.library.readProgress()).repositorySelection?.nodeId, 'order');
  assert.equal(harness.reader.inspect().rendered, undefined); assert.equal((await harness.library.readProgress()).decisions.length, 0);
});

test('Close during pending source acquisition prevents native source reveal and obsolete error publication', async context => {
  // Arrange
  const harness = await readerHarness(context); await harness.reader.open(); const before = harness.shown.length;
  const read = harness.store.read.bind(harness.store); let enter = () => {}, release = () => {}, calls = 0;
  const entered = new Promise<void>(resolve => { enter = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
  harness.store.read = async (...arguments_: Parameters<typeof read>) => { const result = await read(...arguments_); if (++calls === 2) { enter(); await waiting; } return result; };
  // Act
  const pending = harness.reader.open({ ...harness.selection, nodeId: 'order' }); const rejected = assert.rejects(pending, /superseded or closed/); await entered;
  harness.reader.close(); release(); await rejected;
  // Assert
  assert.equal(harness.shown.length, before); assert.equal(harness.panels.size, 0); assert.equal(harness.reader.inspect().opened, false);
});

test('Retry saves an unsaved choice for its original article exactly once after navigation', async context => {
  // Arrange
  const harness = await readerHarness(context); await harness.reader.open(); const decide = harness.library.decide.bind(harness.library);
  harness.library.decide = async () => { throw new Error('injected disk failure'); };
  // Act
  await assert.rejects(harness.reader.understand(true), /injected disk failure/);
  await harness.reader.open({ ...harness.selection, nodeId: 'order' }); harness.library.decide = decide;
  await harness.reader.action('retry'); await harness.reader.action('retry');
  // Assert
  const decisions = (await harness.library.readProgress()).decisions;
  assert.equal(decisions.length, 1); assert.equal(decisions[0]?.item, 'repository/architecture/module'); assert.equal(harness.reader.inspect().view.understanding?.understood, false);
});

test('corrupt shared progress leaves articles readable but understanding disabled without replacing the corrupt file', async context => {
  // Arrange
  const harness = await readerHarness(context); await writeFile(join(harness.library.directory, 'progress.repository.v4.json'), '{corrupt');
  // Act
  await harness.reader.open();
  // Assert
  assert.equal(harness.reader.inspect().view.book?.bookId, 'architecture'); assert.equal(harness.reader.inspect().view.understanding?.known, false);
  await assert.rejects(harness.reader.understand(true), /learning storage/); assert.equal(await readFile(join(harness.library.directory, 'progress.repository.v4.json'), 'utf8'), '{corrupt');
});

test('captured source URIs reject forged hashes and a reader rejects actions after workspace ownership changes', async context => {
  // Arrange
  const harness = await readerHarness(context); await harness.reader.open(); const uri = harness.shown[0]!.uri;
  // Act / Assert
  await assert.rejects(harness.provider(new harness.Uri(uri.scheme, uri.authority, uri.path, `hash=${'0'.repeat(64)}`)), /differs from the selected citation/);
  harness.changeWorkspace(); await assert.rejects(harness.reader.understand(true), /no longer owns/); assert.equal((await harness.library.readProgress()).decisions.length, 0);
});

test('evidence navigation persists exact return context and rejects changed checkpoints before entering a study', async context => {
  // Arrange
  const harness = await readerHarness(context);
  const study = { ...createConfiguredStudy(), workspaceKey: harness.library.workspaceKey, finalOutcome: 'partial' as const }, observation = study.observations[0]!;
  await harness.library.saveStudy(study);
  for (const source of study.descriptor!.sources) await harness.track(source.path, source.text);
  const document: BookDocument = { title: 'Interface', summary: 'Theme selection.', nodes: [{ id: 'theme', title: 'Theme',
    sections: [{ title: 'Selection', text: 'Choose the theme.' }, { title: 'Evidence', text: 'Review the captured selection.' }],
    anchors: study.descriptor!.anchors, observations: [{ studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash }] }], edges: [] };
  await harness.store.publish({ bookId: 'interface', key: 'linked', expectedRevision: 0, document });
  const selection = { bookId: 'interface', nodeId: 'theme', anchorIndex: 0, revision: 1, location: { sectionIndex: 1, fraction: 0.65, focusId: 'evidence-0-observation' } }; await harness.reader.open(selection);
  // Act
  await harness.reader.evidence(selection, 0, false);
  await writeFile(join(harness.library.directory, `${study.id}.study.meta.v3.json`), '{broken');
  // Assert
  assert.equal(harness.linked.length, 1); assert.equal(harness.linked[0]?.binding.observationId, observation.id); assert.equal(harness.linked[0]?.binding.outcome, 'partial');
  assert.equal(harness.reader.inspect().view.book?.links[0]?.recording.status, 'unavailable');
  assert.deepEqual((await harness.library.readProgress()).repositorySelection, selection);
  await assert.rejects(harness.reader.evidence(selection, 0, true), /missing or changed/); assert.equal(harness.linked.length, 1);
});

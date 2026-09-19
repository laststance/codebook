import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join, matchesGlob, relative, resolve } from 'node:path';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { LearningLibrary } from '../learningLibrary';
import { repositoryHarness } from './utils/repositoryHarness';
import { loadModule } from './utils/loadModule';
import type { RepositorySelection } from '../learnerSchemas';
import type { BookDocument, BookObservationBinding } from '../repositorySchemas';
import { decodeStudyArchive } from '../utils/decodeStudyArchive';

/** Exercises the real reader/storage while mocking only editor effects, retaining explicit source/render receipts. @example const harness = await readerHarness(context) */
async function readerHarness(context: TestContext) {
  const source = await repositoryHarness(context), root = await realpath(source.directory);
  await source.track('src/cart.ts', 'export const price = 24;\n'); await source.track('src/order.ts', 'export const total = 48;\n');
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
  let provider = async (_uri: Uri) => '', workspace = source.directory, connections = 0;
  let receive = (_message: unknown) => {};
  const shown: { uri: Uri; text: string }[] = [], panels = new Set<object>(), linked: { binding: BookObservationBinding; recording: boolean }[] = [];
  const textDocuments: { isDirty: boolean; uri: Uri; getText(): string }[] = [];
  const watchers: { pattern: RelativePattern; listeners: ((uri: Uri) => void)[] }[] = [];
  const boundary = await loadModule<typeof import('../repositoryReader')>(resolve(__dirname, '../repositoryReader.js'), {
    './environment': { requireWorkspace: () => workspace },
    vscode: { EventEmitter, Uri, ViewColumn: { One: 1, Two: 2 }, RelativePattern, Range: class {},
      workspace: { textDocuments, registerTextDocumentContentProvider: (_scheme: string, value: { provideTextDocumentContent(uri: Uri): Promise<string> }) => { provider = value.provideTextDocumentContent; return disposable(); },
        onDidChangeTextDocument: disposable, createFileSystemWatcher: (pattern: RelativePattern) => {
          const watcher = { pattern, listeners: Array<(uri: Uri) => void>() }; watchers.push(watcher);
          const listen = (callback: (uri: Uri) => void) => { watcher.listeners.push(callback); return disposable(); };
          return { dispose() { watcher.listeners = []; }, onDidChange: listen, onDidCreate: listen, onDidDelete: listen };
        },
        openTextDocument: async (uri: Uri) => { const text = uri.scheme === 'file' ? await readFile(uri.fsPath, 'utf8') : await provider(uri); return { uri, getText: () => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n') }; } },
      window: { registerTreeDataProvider: disposable, showTextDocument: async (document: { uri: Uri; getText(): string }) => { shown.push({ uri: document.uri, text: document.getText() }); },
        createWebviewPanel: () => { let disposed = () => {}; const panel = { title: '', reveal() {}, dispose() { panels.delete(panel); disposed(); }, onDidDispose(callback: () => void) { disposed = callback; },
          webview: { html: '', postMessage: async () => true, onDidReceiveMessage: (callback: (value: unknown) => void) => { receive = callback; return disposable(); } } }; panels.add(panel); return panel; } },
    },
  });
  const createReader = () => new boundary.RepositoryReader({ storage: async () => library, connect: async () => { connections++; }, arrange: async () => {}, evidence: async (binding, recording) => { linked.push({ binding, recording }); } });
  const reader = createReader(), store = await reader.storage(); context.after(() => reader.dispose());
  const first = await source.sources.read('src/cart.ts'), second = await source.sources.read('src/order.ts');
  const document: BookDocument = { title: 'Architecture', summary: 'Source-derived architecture.', nodes: [
    { id: 'cart', title: 'Cart', sections: [{ title: 'Price', text: 'The cart exports price 24.' }, { title: 'Order', text: 'Order exports total 48.' }], anchors: [first, second].map(value => ({ path: value.path, hash: value.hash, startLine: 1, endLine: 2 })), observations: [] },
    { id: 'order', title: 'Order', sections: [{ title: 'Total', text: 'The order exports total 48.' }], anchors: [{ path: second.path, hash: second.hash, startLine: 1, endLine: 2 }], observations: [] },
  ], edges: [{ from: 'cart', to: 'order', relationship: 'related', explanation: 'Both export pricing values.' }] };
  await store.publish({ bookId: 'architecture', key: 'first', expectedRevision: 0, document });
  const selection: RepositorySelection = { bookId: 'architecture', revision: 1, nodeId: 'cart', anchorIndex: 0 };
  return { ...source, library, reader, store, selection, document, shown, panels, linked, textDocuments, Uri, createReader, receive: (message: unknown) => receive(message),
    connections: () => connections, changeWorkspace: () => { workspace = '/another/workspace'; }, provider: (uri: Uri) => provider(uri),
    fileEvent: (path: string, kind: number) => { for (const watcher of watchers) if (matchesGlob(relative(watcher.pattern.base, path), watcher.pattern.pattern)) watcher.listeners[kind]?.(Uri.file(path)); } };
}

test('repository articles open retained source without connecting an agent or marking understanding', async context => {
  // Arrange
  const harness = await readerHarness(context);
  // Act
  await harness.reader.open(); const state = harness.reader.inspect();
  // Assert
  assert.equal(state.view.selection?.nodeId, 'cart'); assert.equal(state.view.loading, false);
  assert.equal(harness.shown[0]?.text, 'export const price = 24;\n'); assert.equal(harness.connections(), 0);
  assert.equal(state.view.sources[0]?.status, 'current'); assert.equal((await harness.library.readProgress()).decisions.length, 0);
  assert.equal('sources' in state.view.book!.revision, false);
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
  harness.textDocuments.push({ uri: harness.Uri.file(join(harness.store.sources.workspace, 'src/cart.ts')), isDirty: true, getText: () => 'export const price = 30;' });
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
  const harness = await readerHarness(context); await harness.track('src/cart.ts', '\uFEFFexport const price = 24;\n');
  const source = await harness.sources.read('src/cart.ts'); harness.document.nodes[0]!.anchors[0]!.hash = source.hash;
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
  harness.textDocuments.push({ uri: harness.Uri.file(join(harness.store.sources.workspace, 'src/cart.ts')), isDirty: true, getText: () => 'export const price = 24;\n' });
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
  await harness.track('src/cart.ts', 'export const price = 24;\rexport const total = 48;\r\n');
  const source = await harness.sources.read('src/cart.ts'); harness.document.nodes[0]!.anchors[0] = { path: source.path, hash: source.hash, startLine: 2, endLine: 3 };
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
  assert.equal(harness.shown.length, shown); assert.equal((await harness.library.readProgress()).repositorySelection?.nodeId, 'cart');
  await harness.reader.open(); assert.equal(harness.reader.inspect().view.selection?.nodeId, 'cart'); assert.equal(harness.reader.inspect().view.error, '');
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
  assert.equal(decisions.length, 1); assert.equal(decisions[0]?.item, 'repository/architecture/cart'); assert.equal(harness.reader.inspect().view.understanding?.understood, false);
});

test('corrupt shared progress leaves articles readable but understanding disabled without replacing the corrupt file', async context => {
  // Arrange
  const harness = await readerHarness(context); await writeFile(join(harness.library.directory, 'progress.v3.json'), '{corrupt');
  // Act
  await harness.reader.open();
  // Assert
  assert.equal(harness.reader.inspect().view.book?.bookId, 'architecture'); assert.equal(harness.reader.inspect().view.understanding?.known, false);
  await assert.rejects(harness.reader.understand(true), /learning storage/); assert.equal(await readFile(join(harness.library.directory, 'progress.v3.json'), 'utf8'), '{corrupt');
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
  const raw: unknown = JSON.parse(await readFile(resolve(__dirname, '../../src/tests/fixtures/cycle-0006-legacy/study.v1.json'), 'utf8'));
  const study = { ...decodeStudyArchive(raw, '67bf38abd3f309bf29b1eed73e4f3ea88863995c0f207b70a50eec48d36f8743'), workspaceKey: harness.library.workspaceKey }, observation = study.observations[0]!;
  await harness.library.saveStudy(study); await harness.track('src/cart.ts', observation.source.text);
  harness.document.nodes[0]!.anchors[0]!.hash = observation.source.hash;
  harness.document.nodes[0]!.observations = [{ studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash }];
  await harness.store.publish({ bookId: 'architecture', key: 'linked', expectedRevision: 1, document: harness.document });
  const selection = { ...harness.selection, revision: 2, location: { sectionIndex: 1, fraction: 0.65, focusId: 'evidence-0-observation' } }; await harness.reader.open(selection);
  // Act
  await harness.reader.evidence(selection, 0, false);
  await writeFile(join(harness.library.directory, `${study.id}.study.meta.v2.json`), '{broken');
  // Assert
  assert.equal(harness.linked.length, 1); assert.equal(harness.linked[0]?.binding.observationId, observation.id); assert.equal(harness.linked[0]?.binding.outcome, 'partial');
  assert.equal(harness.reader.inspect().view.book?.links[0]?.recording.status, 'unavailable');
  assert.equal(JSON.stringify((await harness.library.readProgress()).repositorySelection), JSON.stringify(selection));
  await assert.rejects(harness.reader.evidence(selection, 0, true), /missing or changed/); assert.equal(harness.linked.length, 1);
});

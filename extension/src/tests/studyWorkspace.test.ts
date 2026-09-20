import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
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
import type { RepositorySelection } from '../learnerSchemas';
import { RepositoryBookStore } from '../repositoryBook';
import { RepositorySourceService } from '../repositorySource';
import { createConfiguredStudy } from './utils/createConfiguredStudy';
import { ControlledConfiguredRuntime } from './utils/configuredServiceHarness';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { startServer } from '../server';

/** Keeps native presentation inert while exercising actual checkpoints, source watching and durable decisions. @example const reader = await workspaceHarness() */
async function workspaceHarness(attach = true, deterministicClock = false) {
  let clock = 0;
  const harness = await createHarness({ create: async (directory, profile) => { const runtime = new ControlledRuntime(directory, profile); if (deterministicClock) runtime.evidence.elapsedMs = () => clock; return runtime; } }), fixture = join(harness.directory, 'extension/dist/demo/fixture');
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
  class RelativePattern { constructor(readonly base: string, readonly pattern: string) {} }
  const watchedPatterns: RelativePattern[] = [];
  const textDocuments: { uri: Uri; getText(): string }[] = [];
  class TabInputWebview { constructor(readonly viewType: string) {} }
  type Tab = { input: TabInputText | TabInputWebview; label?: string; isPreview?: boolean; isDirty?: boolean };
  const groups: { viewColumn: number; tabs: Tab[]; activeTab?: Tab }[] = [{ viewColumn: 2, tabs: [] }];
  let activeTabGroup = groups[0]!;
  type SourceEditor = { document: { uri: Uri; getText(): string }; readonly viewColumn: number; setDecorations(): void; selections: string[]; visibleRanges: string[]; revealRange(range: unknown): void };
  let activeTextEditorChanged = (_editor: SourceEditor | undefined) => {};
  let lastSourceEditor: SourceEditor | undefined;
  let sourceFocusOnArrange: SourceEditor | undefined;
  let reportedSourceColumn: number | undefined;
  let nextSourceDisplay: (() => void) | undefined;
  const visibleSourceEditors: (SourceEditor & { group: typeof groups[number] })[] = [], decoratedColumns: number[] = [];
  let changedGroups = (_event: { opened: typeof groups; closed: typeof groups; changed: typeof groups }) => {};
  let sourceProvider = async (_uri: Uri) => '';
  let nextOpen: { wait: Promise<void>; entered(): void } | undefined;
  let nextCommand: { name: string; wait: Promise<void>; entered(): void } | undefined;
  const commands: string[] = [];
  let editorLayout: unknown = { orientation: 0, groups: [{}] };
  let nextMovedPanelLayout: unknown;
  let nativeLayout = false, cursorGroupWrappers = false, cursorTwoEventContraction = false;
  let transientLayout = false, settledLayout: unknown, failingCommand: string | undefined, settlementPending = false;
  const panels = new Set<ReturnType<typeof panel>>();
  const panelReveals: { kind: string; column?: number; preserveFocus?: boolean }[] = [];
  let deferredPanelFocus: { kind: string; remaining: number } | undefined;
  const postedMessages: StudyViewMessage[] = [];
  let heldPresentationMessage: { mode?: 'living-book'; wait: Promise<void>; entered(): void } | undefined;
  const receivers = new Map<string, (message: unknown) => void>();
  let automaticContextReceipt = false, contextCoversSource = false, displayedImage: string | undefined, sourceColumn = 2;
  let nextImage: { wait: Promise<void>; entered(): void } | undefined;
  /** Mirrors native group creation for the layout-return regressions without changing older fixtures. @example nativeGroup(3).viewColumn // 3 */
  function nativeGroup(column: number) {
    const existing = groups.find(group => group.viewColumn === column); if (existing) return existing;
    const group: typeof groups[number] = { viewColumn: column, tabs: [], activeTab: undefined };
    // Cursor replaces surviving wrappers in the same event that announces an opened group.
    const retained = cursorGroupWrappers ? groups.map(previous => ({ ...previous, tabs: [...previous.tabs] })) : [];
    if (cursorGroupWrappers) groups.splice(0, groups.length, ...retained);
    groups.push(group); if (nativeLayout) groups.sort((left, right) => left.viewColumn - right.viewColumn);
    changedGroups({ opened: [group], closed: [], changed: retained }); return group;
  }
  /** Counts native layout leaves so shrinking a grid merges only its removed groups in these tests. @example nativeGroupCount({ groups: [{}, {}] }) // 2 */
  function nativeGroupCount(value: unknown): number {
    const children = value && typeof value === 'object' ? Reflect.get(value, 'groups') : undefined;
    return Array.isArray(children) ? children.reduce((total: number, child: unknown) => total + nativeGroupCount(child), 0) : 1;
  }
  function panel(kind: string, _title?: string, options?: { viewColumn: number }) {
    const nativeTab = { input: new TabInputWebview(kind), isPreview: false };
    const disposed: (() => void)[] = [], viewChanged: (() => void)[] = [];
    // Native webviews create only one missing group, even when a later column was requested.
    const viewColumn = nativeLayout && options?.viewColumn ? Math.min(options.viewColumn, groups.length + 1) : options?.viewColumn;
    const value = { webview: { html: '', postMessage: async (message: StudyViewMessage) => {
      postedMessages.push(message);
      const held = heldPresentationMessage;
      if (held && kind === 'codebook.studyContext' && message.presentation?.state === 'applying' && (!held.mode || message.presentation.mode === held.mode)) {
        held.entered(); await held.wait;
        if (heldPresentationMessage === held) heldPresentationMessage = undefined;
      }
      if (kind === 'codebook.studyContext' && message.presentation?.state === 'applying') receivers.get(kind)?.({ type: 'presentation-pose', presentationId: message.presentation.presentationId, expectedRevision: message.presentation.presentationControlRevision });
      if ((automaticContextReceipt || message.presentation?.state === 'applying') && kind === 'codebook.studyContext' && message.type === 'study' && !message.loading) {
        receivers.get(kind)?.({ type: 'rendered', revision: message.revision, itemId: message.model.selection.itemId, snapshotUri: message.model.observation?.snapshotUri, presentationControlRevision: message.presentation?.presentationControlRevision, presentationMode: message.presentation?.mode, ...(message.recording ? { presentationRevision: message.recording.presentationRevision } : {}) });
      }
      return true;
    }, onDidReceiveMessage: (callback: (message: unknown) => void) => { receivers.set(kind, callback); return disposable(); } }, kind, nativeTab, viewColumn, title: '', get active() { return activeTabGroup.activeTab === nativeTab; }, get visible() { return groups.some(group => group.activeTab === nativeTab); }, reveal(column?: number, preserveFocus?: boolean) {
      panelReveals.push({ kind, column, preserveFocus });
      const previousColumn = value.viewColumn;
      if (column !== undefined) value.viewColumn = column;
      if (column !== undefined && previousColumn !== column && nextMovedPanelLayout) { editorLayout = nextMovedPanelLayout; nextMovedPanelLayout = undefined; }
      {
        for (const group of groups) { group.tabs = group.tabs.filter(tab => tab !== nativeTab); if (group.activeTab === nativeTab) group.activeTab = undefined; }
        const group = nativeGroup(value.viewColumn ?? 1);
        if (nativeLayout && previousColumn !== value.viewColumn && group.activeTab?.isPreview) { const replaced = [...panels].find(panel => panel.nativeTab === group.activeTab); replaced?.dispose(); }
        group.tabs.push(nativeTab); group.activeTab = nativeTab;
        if (column !== undefined && previousColumn !== column) nativeTab.isPreview = true;
        if (!preserveFocus) {
          // Native webview reveal returns before its focus notification reaches the extension host.
          if (deferredPanelFocus?.kind === kind && --deferredPanelFocus.remaining === 0) {
            deferredPanelFocus = undefined;
            setImmediate(() => { activeTabGroup = group; for (const listener of viewChanged) listener(); });
          } else activeTabGroup = group;
        }
        for (const listener of viewChanged) listener();
      }
      if (contextCoversSource && kind === 'codebook.studyContext') groups[0]!.activeTab = undefined;
    }, onDidDispose(callback: () => void) { disposed.push(callback); return disposable(); }, onDidChangeViewState(callback: () => void) { viewChanged.push(callback); return disposable(); }, dispose() { panels.delete(value); for (const group of groups) { group.tabs = group.tabs.filter(tab => tab !== nativeTab); if (group.activeTab === nativeTab) group.activeTab = undefined; } for (const listener of disposed) listener(); } };
    { const group = nativeGroup(value.viewColumn ?? 1); group.tabs.push(nativeTab); group.activeTab = nativeTab; }
    panels.add(value); return value;
  }
  const initialSelection: string[] = [];
  let outlineCheckbox = (_event: { items: [string, number][] }) => {};
  let outlineItem = (_itemId: string): { checkboxState?: number; description?: string; command?: unknown } => ({});
  const outline = { ...disposable(), visible: true, selection: initialSelection, onDidChangeCheckboxState: (callback: typeof outlineCheckbox) => { outlineCheckbox = callback; return disposable(); }, onDidChangeVisibility: disposable,
    reveal: async (participant: string, options: { select: boolean; focus: boolean }) => { assert.equal(options.focus, false); if (options.select) outline.selection = [participant]; } };
  const watcher = { onDidChange(callback: () => void) { changed = callback; return disposable(); }, onDidCreate: disposable, onDidDelete: disposable, dispose() {} };
  const boundary = await loadModule<typeof import('../studyWorkspace')>(resolve(__dirname, '../studyWorkspace.js'), {
    vscode: { EventEmitter, Uri, TabInputText, TabInputWebview, TreeItem: class {}, TreeItemCollapsibleState: { None: 0 }, TreeItemCheckboxState: { Unchecked: 0, Checked: 1 }, Position: class {}, Range: class {}, ViewColumn: { One: 1, Two: 2, Three: 3 }, TextEditorRevealType: { AtTop: 0 }, ThemeColor: class {}, RelativePattern,
      commands: { async executeCommand(name: string, layout?: unknown): Promise<unknown> {
        commands.push(name); const held = nextCommand; if (held?.name === name) { nextCommand = undefined; held.entered(); await held.wait; }
        if (name === failingCommand) { failingCommand = undefined; throw new Error('Native layout command failed'); }
        if (name === 'runCommands') {
          assert.ok(layout && typeof layout === 'object' && 'commands' in layout && Array.isArray(layout.commands));
          // Both native hosts notify child failures without rejecting the accepted batch promise.
          try { for (const command of layout.commands) await this.executeCommand(typeof command === 'string' ? command : command.command, typeof command === 'string' ? undefined : command.args); } catch {}
          if (sourceFocusOnArrange) activeTextEditorChanged(sourceFocusOnArrange);
          return;
        }
        if (name === 'workbench.action.keepEditor' && activeTabGroup.activeTab) activeTabGroup.activeTab.isPreview = false;
        if (name === 'vscode.getEditorLayout') {
          const layout = JSON.parse(JSON.stringify(editorLayout, (key, value) => key === 'groups' && Array.isArray(value) ? value.map(group => ({ size: 1, ...group })) : value));
          // The accepted grid settles without a second mutation; its first read can still contain native transient pixels.
          if (settlementPending) { editorLayout = structuredClone(settledLayout); settlementPending = false; }
          return layout;
        }
        if (name === 'vscode.setEditorLayout') {
          settledLayout = structuredClone(layout);
          editorLayout = transientLayout ? { orientation: 0, groups: [{ size: 0.5, groups: [{ size: 0.5 }, { size: 475.83333333333326 }] }, { size: 659.5 }] } : structuredClone(layout);
          settlementPending = transientLayout;
          if (nativeLayout) {
            const count = nativeGroupCount(layout);
            for (let column = 1; column <= count; column++) nativeGroup(column);
            let removed = groups.filter(group => group.viewColumn > count);
            // Preserve the old wrappers' pre-merge tabs so exact-equality matching cannot pass accidentally.
            if (cursorGroupWrappers && removed.length) {
              groups.splice(0, groups.length, ...groups.filter(group => cursorTwoEventContraction || group.viewColumn <= count).map(group => ({ ...group, tabs: [...group.tabs] })));
              if (cursorTwoEventContraction) removed = groups.filter(group => group.viewColumn > count);
            }
            const destination = nativeGroup(count);
            for (const group of removed) { destination.tabs.push(...group.tabs); if (group.activeTab) destination.activeTab = group.activeTab; for (const view of panels) if (group.tabs.includes(view.nativeTab)) view.viewColumn = count; }
            // Cursor first reports copied tabs in both groups, then closes the emptied source group in a second wrapper resync.
            if (cursorTwoEventContraction && removed.length) {
              changedGroups({ opened: [], closed: [], changed: [...groups] });
              for (const group of removed) { group.tabs = []; group.activeTab = undefined; }
              groups.splice(0, groups.length, ...groups.filter(group => group.viewColumn <= count).map(group => ({ ...group, tabs: [...group.tabs] })));
            }
            if (sourceColumn > count) sourceColumn = count;
            groups.splice(0, groups.length, ...groups.filter(group => group.viewColumn <= count));
            if (removed.length) changedGroups({ opened: [], closed: removed, changed: cursorGroupWrappers ? [...groups] : [destination] });
          } else {
            const opened: typeof groups = [];
            for (const column of [1, 3]) if (!groups.some(group => group.viewColumn === column)) { const group = { viewColumn: column, tabs: [] }; groups.push(group); opened.push(group); }
            if (opened.length) changedGroups({ opened, closed: [], changed: [] });
          }
        }
        if (name === 'workbench.action.evenEditorWidths') editorLayout = structuredClone(settledLayout);
      } },
      window: { get activeTextEditor() { return visibleSourceEditors.find(editor => activeTabGroup === editor.group && activeTabGroup.activeTab?.input instanceof TabInputText && activeTabGroup.activeTab.input.uri.toString() === editor.document.uri.toString()); }, showQuickPick: async () => undefined, createTextEditorDecorationType: disposable, createTreeView: (_id: string, options: { treeDataProvider: { getTreeItem: typeof outlineItem } }) => { outlineItem = options.treeDataProvider.getTreeItem; return outline; }, registerWebviewViewProvider: disposable, onDidChangeActiveTextEditor: (callback: typeof activeTextEditorChanged) => { activeTextEditorChanged = callback; return disposable(); }, createWebviewPanel: panel,
        get visibleTextEditors() { return visibleSourceEditors.filter(editor => editor.group.activeTab?.input instanceof TabInputText && editor.group.activeTab.input.uri.toString() === editor.document.uri.toString()); },
        showTextDocument: async (document: { uri: Uri; getText(): string }, options?: { viewColumn: number; preserveFocus?: boolean; preview?: boolean }) => {
          sourceColumn = options?.viewColumn ?? sourceColumn;
          const group = groups.find(candidate => candidate.viewColumn === sourceColumn) ?? groups[0]!, tab = group.tabs.find(tab => tab.input instanceof TabInputText && tab.input.uri.toString() === document.uri.toString()) ?? { input: new TabInputText(document.uri) };
          if (!group.tabs.includes(tab)) group.tabs.push(tab); group.activeTab = tab; if (!options?.preserveFocus) activeTabGroup = group;
          if (options?.preview !== undefined) tab.isPreview = options.preview;
          visibleSourceEditors.push({ group, document, get viewColumn() { return group.viewColumn; }, setDecorations() { decoratedColumns.push(group.viewColumn); }, selections: ['original selection'], visibleRanges: ['original range'], revealRange() {} });
          const displayed = nextSourceDisplay; nextSourceDisplay = undefined; displayed?.();
          return lastSourceEditor = { document, get viewColumn() { return reportedSourceColumn ?? group.viewColumn; }, setDecorations() { decoratedColumns.push(reportedSourceColumn ?? group.viewColumn); }, selections: ['original selection'], visibleRanges: ['original range'], revealRange() {} };
        },
        tabGroups: { all: groups, get activeTabGroup() { return activeTabGroup; }, onDidChangeTabGroups: (callback: typeof changedGroups) => { changedGroups = callback; return disposable(); }, close: async (tabs: Tab[]) => { for (const group of groups) group.tabs = group.tabs.filter(tab => !tabs.includes(tab)); return true; } } },
      workspace: { textDocuments, registerTextDocumentContentProvider: (_scheme: string, provider: { provideTextDocumentContent(uri: Uri): Promise<string> }) => { sourceProvider = provider.provideTextDocumentContent; return disposable(); },
        openTextDocument: async (uri: Uri) => { const held = nextOpen; nextOpen = undefined; if (held) { held.entered(); await held.wait; } const text = uri.scheme === 'file' ? await readFile(uri.fsPath, 'utf8') : await sourceProvider(uri); return { uri, getText: () => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n') }; },
        onDidChangeTextDocument: disposable, createFileSystemWatcher: (pattern: RelativePattern) => { watchedPatterns.push(pattern); return watcher; } } },
    './environment': { requireWorkspace: () => harness.directory }, 'codebook-cycle-0001/dist/browserViewport': { BrowserViewport: class {
      async reveal() {} async showLive() {} showHistory() {} close() {} async holdPlacement() { return () => {}; } async restorePlacement() {}
      clearRecorded() { displayedImage = undefined; }
      async present(image: string) { const held = nextImage; nextImage = undefined; if (held) { held.entered(); await held.wait; } displayedImage = image; }
      async presentMissing() { displayedImage = undefined; }
    } },
  });
  const articleOpens: RepositorySelection[] = [], articleReturns: RepositorySelection[] = [];
  const controls = { start: async () => harness.service, connect: async () => {}, returnToRepository: async (selection: RepositorySelection) => { articleReturns.push(selection); }, openArticle: async (selection: RepositorySelection) => { articleOpens.push(selection); } };
  const presentationPreferences = new Map<string, unknown>();
  let preferenceFailure = false;
  let nextPreference: { wait: Promise<void>; entered(): void } | undefined;
  const workspaceState = { get: <Value>(key: string) => presentationPreferences.get(key) as Value | undefined,
    update: async (key: string, value: unknown) => { const held = nextPreference; nextPreference = undefined; held?.entered(); await held?.wait; if (preferenceFailure) throw new Error('Injected preference failure'); presentationPreferences.set(key, structuredClone(value)); } };
  const createReader = (extensionPath = join(harness.directory, 'extension')) => new boundary.StudyWorkspace({ extensionPath, globalStorageUri: { fsPath: join(harness.directory, 'storage') }, subscriptions: [], workspaceState }, controls);
  const reader = createReader();
  if (attach) { await reader.attach(harness.service); await reader.selectProfile('paired-cart-demo'); await reader.action('return-current'); }
  return { ...harness, reader, createReader, fixture, groups, controls, outline, commands, articleOpens, articleReturns, receive: (message: unknown) => receivers.get('codebook.studyContext')!(message), counts: () => ({ panels: panels.size, outlineUpdates }), changed: () => changed(),
    addOpenSource(file: string, text: string) { textDocuments.push({ uri: Uri.file(join(fixture, file)), getText: () => text }); },
    outlineItem: (itemId: string) => outlineItem(itemId), changeOutlineCheckbox: (itemId: string, checked: boolean) => outlineCheckbox({ items: [[itemId, checked ? 1 : 0]] }),
    postedMessages: () => postedMessages, presentationPreferences, watchedPatterns,
    holdPresentationMessage(mode?: 'living-book') { let entered!: () => void, release!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; }); heldPresentationMessage = { mode, wait, entered }; return { started, release }; },
    failPresentationPreference(value: boolean) { preferenceFailure = value; },
    holdPresentationPreference() { let entered!: () => void, release!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; }); nextPreference = { wait, entered }; return { started, release }; },
    clock(value: number) { clock = value; }, acknowledgeContext() { automaticContextReceipt = true; }, displayedImage: () => displayedImage,
    coverSourceWhenContextFocused() { contextCoversSource = true; },
    panelColumn: (kind: string) => [...panels].find(panel => panel.kind === kind)?.viewColumn,
    panelReveals: () => [...panelReveals],
    deferPanelFocus(kind: string, reveal: number) { deferredPanelFocus = { kind, remaining: reveal }; },
    focusedPanel: () => activeTabGroup.activeTab?.input instanceof TabInputWebview ? activeTabGroup.activeTab.input.viewType : undefined,
    movePanel(kind: string, column: number) { const panel = [...panels].find(panel => panel.kind === kind); assert.ok(panel); panel.reveal(column); },
    sourceColumn: () => sourceColumn,
    restoreSourceFocusOnArrange() { sourceFocusOnArrange = lastSourceEditor; },
    reportSourceEditorInColumn(column: number) { reportedSourceColumn = column; },
    invalidateNextSourceRender() { nextSourceDisplay = () => { reader['revision']++; }; },
    abortAfterNextSourceDisplay(cancellation: AbortController) { nextSourceDisplay = () => cancellation.abort(); },
    clearDecorations() { decoratedColumns.length = 0; }, decoratedColumns: () => [...decoratedColumns],
    moveSource(column: number) {
      const editor = lastSourceEditor; assert.ok(editor);
      const matchesSource = (tab: Tab) => tab.input instanceof TabInputText && tab.input.uri.toString() === editor.document.uri.toString();
      const previous = groups.find(group => group.viewColumn === sourceColumn && group.tabs.some(matchesSource)) ?? groups.find(group => group.tabs.some(matchesSource))!, destination = groups.find(group => group.viewColumn === column)!;
      const tab = previous.tabs.find(matchesSource)!; previous.tabs = previous.tabs.filter(candidate => candidate !== tab); if (previous.activeTab === tab) previous.activeTab = undefined;
      destination.tabs.push(tab); destination.activeTab = tab; activeTabGroup = destination;
      sourceColumn = column;
      lastSourceEditor = { ...editor, get viewColumn() { return destination.viewColumn; } }; activeTextEditorChanged(lastSourceEditor);
    },
    editorLayout: () => structuredClone(editorLayout), changeEditorLayout(layout: unknown) { editorLayout = structuredClone(layout); },
    flattenOnNextPanelMove(layout: unknown) { nextMovedPanelLayout = structuredClone(layout); },
    useCursorGroupWrappers(twoEventContraction = false) { cursorGroupWrappers = true; cursorTwoEventContraction = twoEventContraction; },
    useNativeLayout(layout: unknown) {
      nativeLayout = true; const previous = [...groups]; groups.splice(0); editorLayout = structuredClone(layout);
      for (let column = 1; column <= nativeGroupCount(layout); column++) nativeGroup(column);
      groups[0]!.tabs.push({ input: new TabInputText(Uri.file(join(harness.directory, 'article-source.ts'))) });
      groups[1]?.tabs.push({ input: new TabInputWebview('codebook.repositoryWiki') });
      changedGroups({ opened: [...groups], closed: previous, changed: [] });
    },
    showTransientNativeSizes() { transientLayout = true; },
    failNextCommand(name: string) { failingCommand = name; },
    addForeignDraft(column = groups[0]!.viewColumn) { const tab = { input: new TabInputText(Uri.file(join(harness.directory, 'notes.txt'))), isDirty: true }; groups.find(group => group.viewColumn === column)!.tabs.push(tab); return tab; },
    addTextPreview(path: string, column: number, dirty = false) { const tab = { input: new TabInputText(Uri.file(path)), isPreview: true, isDirty: dirty }; groups.find(group => group.viewColumn === column)!.tabs.push(tab); return tab; },
    resyncEditorGroups(change?: 'move' | 'replace' | 'append' | 'unannounced' | 'remove' | 'reorder' | 'empty') {
      // Give each fake group a distinct stable input, like the actual singleton panels/native source tabs.
      for (const group of groups) if (!group.tabs.length && change !== 'empty') group.tabs.push({ input: new TabInputText(Uri.file(`/group-${group.viewColumn}`)) });
      const previous = [...groups];
      groups.splice(0, groups.length, ...groups.map(group => ({ ...group, tabs: group.tabs.map(tab => ({ ...tab, label: 'Recorded application', input: tab.input instanceof TabInputText ? new TabInputText(tab.input.uri) : new TabInputWebview(tab.input.viewType) })) })));
      if (change === 'move') { const first = groups[0]!.tabs; groups[0]!.tabs = groups[1]!.tabs; groups[1]!.tabs = first; }
      if (change === 'append') groups[0]!.tabs.splice(1, 0, { input: new TabInputText(Uri.file('/learner-added-notes.txt')) });
      if (change === 'remove') groups[0]!.tabs.pop();
      if (change === 'reorder') groups[0]!.tabs.reverse();
      changedGroups({ opened: change === 'replace' ? [...groups] : [], closed: change === 'replace' ? previous : [], changed: change === 'unannounced' ? [] : [...groups] });
    },
    seedPanelTabs(kind: 'known' | 'unknown' | 'duplicate' | 'ambiguous' | 'empty') {
      for (const group of groups) {
        const type = kind === 'ambiguous' || group.viewColumn === 1 ? 'codebook.scopedBrowser' : group.viewColumn === 2 ? 'codebook.repositoryWiki' : 'codebook.studyContext';
        const tab = { label: 'Application', input: new TabInputWebview(`${kind === 'unknown' ? 'foreign-' : 'mainThreadWebview-'}${type}`) };
        group.tabs = kind === 'empty' ? [] : kind === 'duplicate' ? [tab, { ...tab }] : [tab];
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
async function recordedReaderHarness(capturedApplication = false) {
  const harness = await workspaceHarness(true, true), service = harness.service;
  service.environment.build.sourceHash = sha256('recorded-build'); harness.acknowledgeContext();
  await harness.reader.action('run'); const record = [...service.records.values()][0]!; await record.preparation;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=', 'base64');
  assert.ok(record.recording); record.recording.frame({ bytes: png, elapsedMs: 20, kind: 'stream' });
  // Observation visibility tests retain a real PNG checkpoint while the native renderer remains mocked.
  if (capturedApplication) {
    const runtime = harness.runtimes[0]!, view = runtime.view.bind(runtime);
    await writeFile(join(runtime.evidence.directory, 'paused-server.png'), png);
    runtime.view = () => ({ ...view(), captures: { 'paused-server': { status: 'captured', file: 'paused-server.png', renderer: { epoch: 'test', id: 1, hash: sha256(png) } } } });
  }
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
    assert.deepEqual(harness.commands, [...commands, 'vscode.setEditorLayout', 'vscode.getEditorLayout']); assert.equal(harness.reader.inspect().opened, false);
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
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
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
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
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
    assert.equal(harness.commands.filter(name => name === 'workbench.action.evenEditorWidths').length, 2);
    assert.equal(harness.runtimes.length, 0);
  } finally { release(); await harness.close(); }
});

for (const change of ['shape', 'size']) test(`a manual ${change} change during the host layout receipt never becomes Codebook-owned on the next Wiki return`, async () => {
  // Arrange
  const harness = await workspaceHarness(false), manual = change === 'shape' ? { orientation: 1, groups: [{}, {}, {}] } : { orientation: 0, groups: [{ size: 0.7, groups: [{ size: 0.3 }, { size: 0.7 }] }, { size: 0.3 }] };
  let release = () => {};
  try {
    await harness.reader.open(); const placement = harness.holdNextCommand('vscode.setEditorLayout'); release = placement.release;
    // Act
    const arranging = harness.reader.action('arrange'); await placement.started;
    // Measure the receipt after the accepted mutation, rather than the new pre-placement geometry read.
    const held = harness.holdNextCommand('vscode.getEditorLayout'); release = () => { placement.release(); held.release(); }; placement.release(); await held.started;
    harness.changeEditorLayout(manual); held.release(); await arranging;
    await harness.reader.arrangeRepository(new AbortController().signal);
    // Assert
    assert.deepEqual(harness.editorLayout(), manual); assert.equal(harness.commands.filter(name => name === 'vscode.setEditorLayout').length, 2);
    assert.equal(harness.commands.filter(name => name === 'workbench.action.evenEditorWidths').length, 0);
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
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
    assert.equal(harness.commands.filter(name => name === 'vscode.setEditorLayout').length, 3);
  } finally { release(); await harness.close(); }
});

for (const change of ['move', 'replace', 'remove', 'reorder', 'unannounced'] as const) test(`a host tab resync cannot disguise a learner group ${change} as Codebook ownership`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    await harness.reader.open();
    if (change === 'remove' || change === 'reorder') { harness.seedPanelTabs('known'); harness.addForeignDraft(); }
    harness.resyncEditorGroups(change);
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal);
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
    assert.equal(harness.commands.filter(name => name === 'vscode.setEditorLayout').length, 1);
  } finally { await harness.close(); }
});

for (const kind of ['known', 'unknown', 'duplicate', 'ambiguous', 'empty'] as const) test(`Cursor ${kind} webview inputs ${kind === 'known' ? 'retain layout ownership across application title changes' : 'cannot acquire Codebook layout ownership during resync'}`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    await harness.reader.open(); harness.seedPanelTabs(kind);
    // Act
    harness.resyncEditorGroups(kind === 'empty' ? 'empty' : undefined); await harness.reader.arrangeRepository(new AbortController().signal);
    // Assert
    assert.deepEqual(harness.editorLayout(), kind === 'known' ? { orientation: 0, groups: [{}, {}, {}] } : { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
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
    const library = await harness.reader.learningStorage(), study = await library.readStudy(harness.studyId), observation = study.observations[0]!;
    const binding: BookObservationBinding = { nodeId: 'cart', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
    await harness.reader.openRepositoryEvidence(binding, true, undefined, { bookId: 'architecture', revision: 1, nodeId: 'cart', anchorIndex: 0, location: { sectionIndex: 1, fraction: 0.5, focusId: 'section-1' } });
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

test('explicit Arrange separates moved application, source and context while preserving unrelated tabs', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    await harness.reader.open(); const draft = harness.addForeignDraft();
    harness.movePanel('codebook.scopedBrowser', 2); harness.movePanel('codebook.studyContext', 2);
    const sourceGroup = harness.groups.find(group => group.viewColumn === 2)!, contextGroup = harness.groups.find(group => group.viewColumn === 3)!;
    sourceGroup.viewColumn = 3; contextGroup.viewColumn = 2;
    harness.changeEditorLayout({ orientation: 0, groups: [{}, {}] });
    harness.restoreSourceFocusOnArrange();
    harness.reportSourceEditorInColumn(3);
    harness.clearDecorations();

    // Act
    await harness.reader.action('arrange');

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.sourceColumn(), 2);
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.decoratedColumns().includes(2), true);
    assert.equal(sourceGroup.tabs.includes(draft), true); assert.equal(draft.isDirty, true);
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
    // A later Source action must retain Arrange's reader instead of reopening the older duplicate.
    await harness.reader.action('source');
    assert.equal(harness.sourceColumn(), 2);
    assert.equal(sourceGroup.tabs.includes(draft), true); assert.equal(draft.isDirty, true);
  } finally { await harness.close(); }
});

for (const moveImmediately of [false, true]) test(`Arrange retains its source region after replay visibility cancels rendering and respects ${moveImmediately ? 'an immediate' : 'a later'} manual move`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    await harness.reader.open(); const draft = harness.addForeignDraft();
    const original = harness.groups.find(group => group.viewColumn === 2)!, destination = harness.groups.find(group => group.viewColumn === 3)!;
    original.viewColumn = 3; destination.viewColumn = 2;
    harness.invalidateNextSourceRender();

    // Act
    await harness.reader.action('arrange');
    if (moveImmediately) harness.moveSource(1);
    await harness.reader.action('source');

    // Assert
    assert.equal(harness.sourceColumn(), moveImmediately ? 1 : 2);
    assert.equal(original.tabs.includes(draft), true); assert.equal(draft.isDirty, true);
    // A completed source render releases the explicit arrangement so later manual moves remain authoritative.
    harness.moveSource(1); await harness.reader.action('source');
    assert.equal(harness.sourceColumn(), 1);
  } finally { await harness.close(); }
});

test('Arrange reports interrupted source placement and a later explicit retry restores the three regions', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  let release = () => {};
  try {
    await harness.reader.open();
    const original = harness.groups.find(group => group.viewColumn === 2)!, destination = harness.groups.find(group => group.viewColumn === 3)!;
    original.viewColumn = 3; destination.viewColumn = 2;
    const held = harness.holdNextSource(); release = held.release;

    // Act
    const arranging = harness.reader.action('arrange'); await held.started;
    harness.reader['revision']++; release(); await arranging;

    // Assert
    assert.equal(harness.reader.inspect().view!.errors.some(error => error.includes('The selected source changed before it could be arranged')), true);
    await harness.reader.action('arrange'); await harness.reader.action('source');
    assert.equal(harness.sourceColumn(), 2);
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
  } finally { release(); await harness.close(); }
});

test('Source follows a learner move after Arrange while preserving the earlier duplicate and dirty draft', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    await harness.reader.open(); const draft = harness.addForeignDraft();
    const original = harness.groups.find(group => group.viewColumn === 2)!, destination = harness.groups.find(group => group.viewColumn === 3)!;
    original.viewColumn = 3; destination.viewColumn = 2;
    await harness.reader.action('arrange');
    const retainedTabs = [...original.tabs];

    // Act
    harness.moveSource(1); await harness.reader.action('source');

    // Assert
    assert.equal(harness.sourceColumn(), 1);
    assert.deepEqual(original.tabs, retainedTabs);
    assert.equal(original.tabs.includes(draft), true); assert.equal(draft.isDirty, true);
  } finally { await harness.close(); }
});

test('first Study entry from one editor group keeps empty Context separate from the application', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const draft = harness.addForeignDraft(1);
  try {
    // Act
    await harness.reader.open();

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
    assert.equal(harness.groups[0]!.tabs.includes(draft), true); assert.equal(draft.isDirty, true);
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('first configured Study pause keeps captured source visible beside Context without manual Arrange', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness();
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    // Act
    await harness.start(); await harness.reader.action('click');

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.sourceColumn(), 2);
    const source = harness.groups.find(group => group.viewColumn === 2)!.activeTab?.input;
    assert.ok(source && 'uri' in source);
    assert.equal(source.uri.toString(), harness.reader.inspect().sourceUri);
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    const observation = harness.reader.inspect().view!.model.observation;
    assert.ok(observation?.actionId === 'repository-click');
    assert.equal(observation.values['value:enabled'], false);
  } finally { await harness.close(); }
});

test('failed initial pane reservation remains visible and cannot silently retry or acquire the partial layout', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  harness.failNextCommand('vscode.setEditorLayout');
  try {
    // Act
    await harness.reader.open();
    const afterFailure = harness.editorLayout();
    await harness.reader.arrangeRepository(new AbortController().signal);

    // Assert
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, 1);
    assert.deepEqual(harness.editorLayout(), afterFailure);
    assert.equal(harness.reader.inspect().view!.errors.some(error => error.includes('The editor did not retain the requested Codebook layout')), true);
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('ordinary Study entry retains manually shared pane columns until the learner explicitly arranges them', async () => {
  // Arrange
  const harness = await workspaceHarness(false), manual = { orientation: 0, groups: [{}, {}] };
  try {
    await harness.reader.open();
    harness.movePanel('codebook.scopedBrowser', 2); harness.movePanel('codebook.studyContext', 2);
    harness.changeEditorLayout(manual);

    // Act
    await harness.reader.open();

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2);
    assert.equal(harness.panelColumn('codebook.studyContext'), 2);
    assert.deepEqual(harness.editorLayout(), manual);
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

test('updating the installed demo source and location preserves recorded bytes and learner history while requesting source review', async () => {
  // Arrange: persist actual archive/recording files; only editor and runtime effects are simulated.
  const harness = await recordedReaderHarness(); let reloaded: ReturnType<typeof harness.createReader> | undefined;
  try {
    await harness.reader.understand(true);
    const library = await harness.reader.learningStorage(), decisions = (await library.readProgress()).decisions;
    // Retire the original writer before freezing immutable bytes for the installation update.
    await harness.service.shutdown(); await harness.reader.retire(harness.service); await harness.reader.dispose();
    const archivePath = join(library.directory, `${harness.studyId}.study.v2.json`), archiveBefore = await readFile(archivePath);
    const recordingDirectory = harness.store.path(harness.studyId), recordingFiles = (await readdir(recordingDirectory)).sort();
    const recordingBefore = await Promise.all(recordingFiles.map(file => readFile(join(recordingDirectory, file))));
    const nextExtension = join(harness.directory, 'codebook-next-install'), nextFixture = join(nextExtension, 'dist/demo/fixture');
    await mkdir(nextFixture, { recursive: true });
    await writeFile(join(nextFixture, 'server.mts'), 'const price = 25;'); await writeFile(join(nextFixture, 'client.mts'), 'const count = 1;');

    // Act: a new reader uses the changed installation but the same real persisted workspace store.
    reloaded = harness.createReader(nextExtension); await reloaded.open();
    const restored = reloaded.inspect().view!;
    const currentSource = await readFile(join(nextFixture, 'server.mts'), 'utf8');

    // Assert: old evidence and decisions remain exact, while current-source progress needs review.
    assert.equal(restored.model.source.text, 'const price = 24;'); assert.equal(restored.model.observation?.values.price, 24);
    assert.equal(currentSource, 'const price = 25;'); assert.equal(restored.model.sourceChanged, true);
    assert.equal(harness.watchedPatterns.at(-1)?.base, nextFixture); assert.equal(harness.watchedPatterns.at(-1)?.pattern, '{server,client}.mts');
    assert.equal(restored.model.understoodCount, 0); assert.equal(restored.model.reviewCount, 1);
    assert.equal(restored.model.selectedUnderstanding.understood, true);
    assert.equal(decisions.length, 1); assert.deepEqual((await library.readProgress()).decisions, decisions);
    assert.deepEqual(await readFile(archivePath), archiveBefore);
    assert.deepEqual((await readdir(recordingDirectory)).sort(), recordingFiles);
    assert.deepEqual(await Promise.all(recordingFiles.map(file => readFile(join(recordingDirectory, file)))), recordingBefore);
    assert.equal(harness.runtimes.length, 1); assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { await reloaded?.dispose(); await harness.close(); }
});

test('starting a live viewport after closing recorded Study leaves its old film closed and preserves the saved replay position', async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    await harness.reader.close();
    // Act
    const liveViewport = harness.reader.presentation.createViewport!('next-live-run', () => {}, () => {}, 'normal');
    await harness.controller.settle();
    // Assert
    assert.equal(harness.reader.inspect().opened, false);
    assert.equal(harness.controller.state().studyId, undefined);
    assert.equal(harness.controller.state().readiness, 'idle');
    assert.equal((await harness.store.readPreference())?.positionMs, 100);
    liveViewport.close();
  } finally { await harness.close(); }
});

test('starting a live viewport while recorded Study is open preserves the independently selected film', async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    // Act
    const liveViewport = harness.reader.presentation.createViewport!('next-live-run', () => {}, () => {}, 'normal');
    await harness.controller.settle();
    // Assert
    assert.equal(harness.reader.inspect().opened, true);
    assert.equal(harness.reader.inspect().view?.contentTab, 'recording');
    assert.equal(harness.controller.state().studyId, harness.studyId);
    assert.equal(harness.controller.state().readiness, 'ready');
    assert.equal(harness.controller.state().presentedMs, 100);
    liveViewport.close();
  } finally { await harness.close(); }
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

test('unsaved demo source edits take priority over installed disk bytes without rewriting learner history', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    await harness.reader.understand(true); const library = await harness.reader.learningStorage(), decisions = (await library.readProgress()).decisions;
    harness.addOpenSource('server.mts', 'const price = 26;');
    // Act
    harness.changed(); await waitUntil(() => harness.reader.inspect().view!.model.reviewCount === 1, 'unsaved installed source review', 1_000);
    // Assert
    const model = harness.reader.inspect().view!.model;
    assert.equal(harness.watchedPatterns[0]?.base, harness.fixture);
    assert.equal(model.source.text, 'const price = 26;'); assert.equal(await readFile(join(harness.fixture, 'server.mts'), 'utf8'), 'const price = 24;');
    assert.equal(model.understoodCount, 0); assert.deepEqual((await library.readProgress()).decisions, decisions);
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

test('a queued checkbox from a previous configured profile cannot change demo understanding or raise an error', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    await harness.reader.open();
    const library = await harness.reader.learningStorage(), decisions = (await library.readProgress()).decisions;
    const selection = harness.reader.inspect().view!.model.selection;
    // Act: native TreeView can deliver a checkbox event from its previous children list.
    assert.doesNotThrow(() => harness.changeOutlineCheckbox('repository/interface/theme', true));
    await new Promise<void>(resolve => setImmediate(resolve));
    // Assert
    assert.deepEqual((await library.readProgress()).decisions, decisions);
    assert.deepEqual(harness.reader.inspect().view!.model.selection, selection);
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
  } finally { await harness.close(); }
});

for (const obsolete of [true, false]) test(`a delayed ${obsolete ? 'obsolete' : 'current'} outline failure ${obsolete ? 'cannot poison the selected study' : 'remains visible until a successful selection'}`, async () => {
  // Arrange
  const harness = await workspaceHarness();
  let rejectReveal = (_error: Error) => {};
  try {
    await harness.reader.open();
    await harness.reader['outlineRendering'];
    const original = harness.outline.reveal;
    harness.outline.reveal = async (itemId, options) => {
      if (itemId === 'paired-cart-demo/browser') await new Promise<void>((_resolve, reject) => { rejectReveal = reject; });
      else await original(itemId, options);
    };
    await harness.reader.select('paired-cart-demo/browser');
    // Act: a native reveal settles after a newer profile may already have replaced its tree.
    if (obsolete) await harness.reader.selectProfile('checkout-demo');
    rejectReveal(new Error('Cannot resolve obsolete native tree item'));
    await harness.reader['outlineRendering'];
    // Assert
    assert.equal(harness.reader.inspect().view?.errors.length, obsolete ? 0 : 1);
    if (!obsolete) {
      assert.match(harness.reader.inspect().view!.errors[0]!, /Cannot resolve obsolete native tree item/);
      await harness.reader.select('paired-cart-demo/server');
      await harness.reader['outlineRendering'];
      assert.equal(harness.reader.inspect().view?.errors.length, 0);
    }
  } finally { rejectReveal(new Error('Test cleanup')); await harness.close(); }
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

test('native transient half-pixel layout sizes are finalized in the workbench before Wiki ownership is verified', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.showTransientNativeSizes();
  try {
    // Act
    await harness.reader.open(); await harness.reader.arrangeRepository(new AbortController().signal);
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{}, {}, {}] });
    assert.equal(harness.commands.filter(name => name === 'runCommands').length, 2);
    assert.equal(harness.commands.filter(name => name === 'workbench.action.evenEditorWidths').length, 1);
  } finally { await harness.close(); }
});

for (const command of ['vscode.setEditorLayout']) test(`a host-suppressed ${command} failure warns the learner and cannot claim the incomplete layout for a later Wiki return`, async () => {
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

/** Connects actual Git/book/history/recording/reader code to a controlled configured runtime; native paint remains mocked. @example const harness = await configuredWorkspaceHarness() */
async function configuredWorkspaceHarness(sourceText?: string) {
  const harness = await workspaceHarness(false), directory = await realpath(harness.directory), library = await harness.reader.learningStorage(), study = createConfiguredStudy(sourceText);
  const git = promisify(execFile);
  await git('git', ['init', '--quiet', directory]); await mkdir(join(directory, 'src'));
  for (const source of study.descriptor!.sources) await writeFile(join(directory, source.path), source.text);
  await git('git', ['add', '--', 'src'], { cwd: directory });
  const books = new RepositoryBookStore(new RepositorySourceService(directory), library);
  await books.publish({ bookId: 'interface', expectedRevision: 0, key: 'configured-reader', document: { title: 'Interface', summary: 'Theme behavior', nodes: [{ id: 'theme', title: 'Theme', sections: [{ title: 'Theme', text: 'Source-derived theme explanation.' }], anchors: study.descriptor!.anchors, observations: [] }], edges: [] } });
  let clock = 0;
  const configuredRuntimes: ControlledConfiguredRuntime[] = [];
  harness.service.repository = books; harness.service.environment.build.sourceHash = sha256('configured-reader-build');
  harness.service.environment.createRuntime = async (root, definition) => {
    if (!definition || typeof definition === 'string') throw new Error('Configured reader harness expects a declared article.');
    const runtime = new ControlledConfiguredRuntime(root, definition); runtime.evidence.elapsedMs = () => clock; configuredRuntimes.push(runtime); return runtime;
  };
  await harness.reader.attach(harness.service); harness.acknowledgeContext();
  const start = async () => {
    const receipt = harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: study.configuration, key: randomUUID() });
    const record = harness.service.records.get(receipt.runId)!; await record.preparation; assert.equal(record.error, undefined);
    await harness.reader.open(); await harness.reader.action('return-current'); return record;
  };
  return { ...harness, directory, library, books, study, configuredRuntimes, start, configuredClock(value: number) { clock = value; },
    async close() { await books.dispose(); await harness.close(); } };
}

test('configured Study sends captured facts without copying retained source bodies into its webviews', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness();
  try {
    await harness.start();
    // Act
    await harness.reader.action('click');
    const posted = harness.postedMessages().findLast(message => message.model.observation?.actionId === 'repository-click');
    // Assert: native/archive source stays intact while webview metadata remains sufficient.
    assert.ok(posted?.model.observation?.actionId === 'repository-click');
    assert.equal(posted.model.source.text, ''); assert.equal(posted.model.observation.source.text, '');
    assert.equal(posted.model.observation.values['value:enabled'], false);
    assert.equal(harness.reader.inspect().view!.model.source.text, 'const nextTheme = "dark";\n');
    assert.equal(harness.reader.inspect().view!.model.observation!.source.text, 'const nextTheme = "dark";\n');
  } finally { await harness.close(); }
});

test('a delayed outline render from the previous profile stays inert after selecting a configured study', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness();
  try {
    await harness.start();
    const current = harness.reader.inspect();
    // Act: native TreeView may still request an item from the previous children list.
    const stale = harness.outlineItem('checkout-demo/cart-mutation');
    // Assert
    assert.equal(stale.description, 'No longer in the selected study');
    assert.equal(stale.command, undefined);
    assert.equal(stale.checkboxState, undefined);
    assert.deepEqual(harness.reader.inspect().view?.model.selection, current.view?.model.selection);
    assert.equal(harness.reader.inspect().view?.errors.length, 0);
    assert.equal(harness.outlineItem('repository/interface/theme').description, 'Not marked');
  } finally { await harness.close(); }
});

test('closing during configured citation verification never reopens a captured source tab', async context => {
  // Arrange
  context.mock.timers.enable({ apis: ['setInterval'] });
  const harness = await configuredWorkspaceHarness(), inspect = RepositorySourceService.prototype.inspect;
  let release = () => {}, entered = () => {};
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  let selection: Promise<void> | undefined;
  try {
    await harness.start(); await harness.reader.action('click'); await harness.reader.action('stop'); await harness.reader.selectProfile(PROFILE_ID);
    context.mock.method(RepositorySourceService.prototype, 'inspect', async function (this: RepositorySourceService, ...arguments_: Parameters<typeof inspect>) {
      const states = await inspect.apply(this, arguments_); entered(); await held; return states;
    });
    // Act
    selection = harness.reader.selectProfile('repository-browser'); void selection.catch(() => undefined); await started;
    await harness.reader.close(); release();
    // Assert
    await assert.rejects(selection, /workspace was closed/);
    assert.equal(harness.reader.inspect().opened, false); assert.equal(harness.reader.inspect().sourceUri, undefined);
    assert.equal(harness.groups.flatMap(group => group.tabs).length, 0);
  } finally { release(); await selection?.catch(() => undefined); context.mock.restoreAll(); await harness.close(); context.mock.timers.reset(); }
});

test('configured captured and current native readers accept unchanged BOM and mixed line endings without changing retained bytes', async () => {
  // Arrange
  const source = '\uFEFFconst nextTheme = "dark";\r\n// Retained second line.\r', harness = await configuredWorkspaceHarness(source);
  try {
    // Act
    const record = await harness.start(); await harness.reader.action('source'); await harness.reader.action('current-file');
    // Assert
    assert.equal(harness.reader.inspect().view!.loading, false);
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    assert.equal(harness.reader.inspect().view!.model.source.text, source);
    assert.equal(harness.reader.inspect().view!.model.source.hash, sha256(source));
    assert.equal(await readFile(join(harness.directory, 'src/theme.ts'), 'utf8'), source);
    // Capture and persist the custom bytes too; preparation alone cannot verify fixture fidelity.
    await harness.reader.action('click');
    assert.equal(harness.reader.inspect().view!.model.observation!.source.text, '\uFEFFconst nextTheme = "dark";\r\n// Retained second line.\r');
    await harness.reader.action('stop');
    const saved = await harness.library.readStudy(`${harness.service.instanceId}_${record.id}`);
    assert.equal(saved.observations[0]!.source.text, '\uFEFFconst nextTheme = "dark";\r\n// Retained second line.\r');
    assert.equal(saved.observations[0]!.source.hash, '1859ebb4deb7f0440871f8ddbc3cea090984845ce0cfde0ab648ebb493bf01f2');
  } finally { await harness.close(); }
});

test('failed evidence navigation preserves the previous exact article return pose in memory and after restart', async context => {
  // Arrange
  const harness = await configuredWorkspaceHarness(); let restarted: ReturnType<typeof harness.createReader> | undefined;
  try {
    const record = await harness.start(); await harness.reader.action('click'); await harness.reader.action('stop');
    const study = await harness.library.readStudy(`${harness.service.instanceId}_${record.id}`), observation = study.observations[0]!;
    const binding: BookObservationBinding = { nodeId: 'theme', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
    const origin = { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 1, location: { sectionIndex: 2, fraction: 0.75, focusId: 'section-2' } };
    await harness.reader.openRepositoryEvidence(binding, false, undefined, origin);
    context.mock.method(RecordingStore.prototype, 'readContext', async () => { throw new Error('Injected missing recording context'); });
    // Act
    await assert.rejects(harness.reader.openRepositoryEvidence(binding, true, undefined, { ...origin, anchorIndex: 0, location: { sectionIndex: 0, fraction: 0, focusId: 'section-0' } }), /Injected missing/);
    await harness.reader.action('return-wiki'); await harness.reader.close(); restarted = harness.createReader(); await restarted.open(); await restarted.action('return-wiki');
    // Assert
    assert.equal(JSON.stringify(harness.articleReturns), JSON.stringify([origin, origin]));
    assert.equal(JSON.stringify((await harness.library.readProgress()).repositoryReturn), JSON.stringify({ studyId: study.id, selection: origin }));
  } finally { context.mock.restoreAll(); await restarted?.dispose(); await harness.close(); }
});

test('agent-configured input uses the shared reader and complete article understanding without opening or closing a raw target tab', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness();
  try {
    const draft = harness.addForeignDraft();
    await harness.library.decide({ id: randomUUID(), item: 'repository/interface/theme', sourceHash: harness.study.configuration.source.hash, context: harness.study.descriptor!.citationContext, understood: true, at: '2026-09-20T00:00:00.000Z' });
    const record = await harness.start();
    // Act
    harness.configuredClock(2000); await harness.reader.action('click'); await harness.reader.presentation.revealSource(harness.configuredRuntimes[0]!.snapshots[0]!, 'unused raw path');
    const view = harness.reader.inspect().view!;
    // Assert
    assert.equal(view.model.selection.itemId, 'repository/interface/theme'); assert.equal(view.model.progressByItem.length, 1); assert.equal(view.nextAction, undefined);
    assert.equal(view.model.matching, true); assert.equal(view.model.currentItemTitle, 'Theme'); assert.equal(view.model.selectedUnderstanding.understood, true); assert.equal(view.model.understoodCount, 1);
    assert.ok(view.model.observation?.actionId === 'repository-click'); assert.equal(view.model.observation.values['value:selection'], null);
    assert.match(harness.reader.inspect().sourceUri!, /^codebook-source:/);
    assert.equal(harness.groups.flatMap(group => group.tabs).some(tab => tab.input instanceof Object && 'uri' in tab.input && tab.input.uri.fsPath === join(harness.directory, 'src/theme.ts')), false);
    assert.equal(harness.configuredRuntimes[0]!.dispatches, 1); assert.equal(record.profile, 'repository-browser');
    await harness.reader.close(); assert.equal(harness.groups[0]!.tabs.includes(draft), true); assert.equal(draft.isDirty, true);
  } finally { await harness.close(); }
});

test('configured recording-context failure remains visible beside independently saved observation history', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness();
  try {
    const saveContext = harness.service.recordings!.saveContext.bind(harness.service.recordings!);
    harness.service.recordings!.saveContext = async () => { throw new Error('Injected recording context write failure'); };
    // Act
    const record = await harness.start(); await harness.reader.action('click'); await harness.reader.action('stop');
    const view = harness.reader.inspect().view!;
    // Assert
    assert.equal(record.recordingReceipt?.status, 'failed'); assert.equal(view.study?.historyOutcome, 'saved');
    assert.equal(view.study?.recordingSave?.contextStatus, 'failed'); assert.match(view.study?.recordingSave?.contextReason ?? '', /Injected recording context write failure/);
    assert.ok(view.model.observation); assert.equal(view.model.continueArguments, undefined);
    harness.service.recordings!.saveContext = saveContext; await harness.reader.action('retry');
    assert.equal(harness.reader.inspect().view?.study?.recordingSave?.contextStatus, 'saved'); assert.equal(harness.configuredRuntimes[0]!.dispatches, 1);
  } finally { await harness.close(); }
});

test('configured history rejects learner Run and only a fresh agent request creates another run without dispatching input', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness();
  try {
    const first = await harness.start(); await harness.reader.action('click'); await harness.reader.action('stop');
    // Act
    assert.equal(harness.reader.inspect().view!.canRun, false);
    await assert.rejects(harness.reader.action('run'), /agent.*new configured study/i);
    assert.equal(harness.service.records.size, 1); assert.equal(harness.configuredRuntimes.length, 1);
    const second = await harness.start();
    // Assert
    assert.notEqual(second.id, first.id); assert.equal(second.profile, 'repository-browser'); assert.ok(second.profile === 'repository-browser');
    assert.equal(JSON.stringify(second.configuration), JSON.stringify(harness.study.configuration)); assert.notEqual(second.key, first.key);
    assert.equal(harness.configuredRuntimes[0]!.dispatches, 1); assert.equal(harness.configuredRuntimes[1]!.dispatches, 0);
    assert.equal(harness.reader.inspect().view!.model.selection.itemId, 'repository/interface/theme'); assert.equal(harness.reader.inspect().view!.canClick, true);
  } finally { await harness.close(); }
});

test('a configured article decision survives reader restart and secondary-file drift without changing its saved citation context', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness(); let restarted: ReturnType<typeof harness.createReader> | undefined;
  try {
    await harness.start(); await harness.reader.action('click'); await harness.reader.understand(true); await harness.reader.action('stop');
    const before = (await harness.library.readProgress()).decisions;
    await harness.reader.close(); restarted = harness.createReader(); await restarted.open();
    assert.equal(restarted.inspect().view!.model.understoodCount, 1);
    // Act
    await writeFile(join(harness.directory, 'src/mode.ts'), 'export const mode = "contrast";\n'); await restarted.action('retry');
    const view = restarted.inspect().view!;
    // Assert
    assert.equal(view.model.sourceChanged, true); assert.equal(view.model.reviewCount, 1); assert.equal(view.model.understoodCount, 0);
    assert.equal(view.model.selectedUnderstanding.understood, true); assert.equal(view.model.selectedUnderstanding.context?.anchors.length, 2);
    assert.equal(view.model.source.text, 'const nextTheme = "dark";\n'); assert.equal(view.model.continueArguments, undefined);
    assert.equal(JSON.stringify((await harness.library.readProgress()).decisions), JSON.stringify(before)); assert.equal(harness.configuredRuntimes.length, 1);
  } finally { await restarted?.dispose(); await harness.close(); }
});

test('a configured outline cannot write historical understanding after a secondary citation changes', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness();
  try {
    await harness.start(); await harness.reader.action('click'); await harness.reader.action('stop');
    assert.equal(harness.outlineItem('repository/interface/theme').checkboxState, 0);
    harness.changeOutlineCheckbox('repository/interface/theme', true);
    await waitUntil(() => harness.reader.inspect().view!.model.understoodCount === 1, 'current citation understanding', 1_000);
    assert.equal(harness.outlineItem('repository/interface/theme').checkboxState, 1);
    const before = JSON.stringify((await harness.library.readProgress()).decisions);
    // Act
    await writeFile(join(harness.directory, 'src/mode.ts'), 'export const mode = "contrast";\n'); await harness.reader.action('retry');
    const item = harness.outlineItem('repository/interface/theme');
    assert.equal(item.checkboxState, undefined); assert.equal(item.description, 'Review needed');
    harness.changeOutlineCheckbox('repository/interface/theme', false);
    await waitUntil(() => harness.reader.inspect().view!.errors.some(error => error.includes('Current citations differ')), 'rejected stale outline event', 1_000);
    // Assert
    assert.equal(JSON.stringify((await harness.library.readProgress()).decisions), before);
    assert.equal(harness.reader.inspect().view!.model.selectedUnderstanding.understood, true);
    assert.equal(harness.reader.inspect().view!.model.understoodCount, 0);
    await harness.reader.understand(false);
    assert.equal(harness.reader.inspect().view!.model.selectedUnderstanding.understood, false);
    const decisions = (await harness.library.readProgress()).decisions;
    assert.equal(decisions.length, 2); assert.equal(decisions[1]!.understood, false);
    assert.equal(JSON.stringify(decisions[1]!.context), JSON.stringify(decisions[0]!.context));
  } finally { await harness.close(); }
});

test('direct configured entry opens its article at the beginning while actual article origins restore their exact pose after restart', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness(); let restarted: ReturnType<typeof harness.createReader> | undefined;
  try {
    await harness.library.selectRepository({ bookId: 'unrelated', revision: 3, nodeId: 'other', anchorIndex: 0, location: { sectionIndex: 2, fraction: 0.9, focusId: 'section-2' } });
    const record = await harness.start(); await harness.reader.action('click'); await harness.reader.action('stop');
    assert.equal(harness.reader.inspect().view!.repositoryReturnAvailable, false); assert.equal(harness.reader.inspect().view!.repositoryArticleAvailable, true);
    await assert.rejects(harness.reader.action('return-wiki'), /No article return/);
    await harness.reader.action('open-article');
    assert.equal(JSON.stringify(harness.articleOpens), JSON.stringify([{ bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 0 }]));
    const study = await harness.library.readStudy(`${harness.service.instanceId}_${record.id}`), observation = study.observations[0]!;
    const binding: BookObservationBinding = { nodeId: 'theme', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
    const origin = { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 1, location: { sectionIndex: 1, fraction: 0.65, focusId: 'section-1' } };
    // Act
    await harness.reader.openRepositoryEvidence(binding, false, undefined, origin); await harness.reader.close();
    restarted = harness.createReader(); await restarted.open(); await restarted.action('return-wiki');
    // Assert
    assert.equal(restarted.inspect().view!.repositoryReturnAvailable, true); assert.equal(JSON.stringify(harness.articleReturns), JSON.stringify([origin]));
    assert.equal(JSON.stringify((await harness.library.readProgress()).repositoryReturn), JSON.stringify({ studyId: study.id, selection: origin }));
    assert.equal(harness.configuredRuntimes[0]!.dispatches, 1); assert.equal((await harness.library.readProgress()).decisions.length, 0);
  } finally { await restarted?.dispose(); await harness.close(); }
});

test('configured recording seeks actual facts through the shared reader after runtime exit with no future source or execution authority', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness();
  try {
    const record = await harness.start(), png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=', 'base64');
    assert.ok(record.recording); record.recording.frame({ bytes: png, elapsedMs: 100, kind: 'stream' });
    harness.configuredClock(2000); await harness.reader.action('click'); record.recording.frame({ bytes: png, elapsedMs: 2100, kind: 'stream' });
    harness.configuredClock(4000); await harness.reader.action('stop'); const controller = harness.service.playbackController!, studyId = record.recording.header.studyId;
    // Act
    await harness.reader.openRecording(studyId); await controller.settle(); const before = harness.reader.inspect().view!;
    controller.command({ action: 'seek', studyId, expectedRevision: controller.state().revision, positionMs: 2100 }); await controller.settle(); const paused = harness.reader.inspect().view!;
    // Assert
    assert.equal(before.recording?.readiness, 'ready', before.recording?.reason); assert.equal(before.model.observation, undefined);
    assert.equal(before.model.source.text, '// No source was observed by this recorded position.\n'); assert.equal(before.model.selectedUnderstanding.known, false);
    assert.equal(paused.recording?.readiness, 'ready', paused.recording?.reason); assert.equal(paused.recording?.presentedMs, 2100);
    assert.ok(paused.model.observation?.actionId === 'repository-click'); assert.equal(paused.model.observation.values['value:enabled'], false); assert.equal(paused.model.observation.values['value:selection'], null);
    assert.equal(paused.model.continueArguments, undefined); assert.equal(paused.model.matching, false); assert.equal(harness.configuredRuntimes[0]!.dispatches, 1);
    assert.equal(harness.displayedImage(), png.toString('base64')); assert.equal((await harness.library.readProgress()).decisions.length, 0);
  } finally { await harness.close(); }
});

for (const failure of ['corrupt', 'future', 'missing'] as const) test(`a ${failure} configured recording keeps the real article return pose, learner ledger and input count intact`, async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness();
  try {
    const record = await harness.start(); await harness.reader.action('click'); await harness.reader.understand(true); await harness.reader.action('stop');
    const study = await harness.library.readStudy(`${harness.service.instanceId}_${record.id}`), observation = study.observations[0]!;
    const binding: BookObservationBinding = { nodeId: 'theme', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
    const origin = { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 1, location: { sectionIndex: 2, fraction: 0.75, focusId: 'section-2' } };
    await harness.reader.openRepositoryEvidence(binding, false, undefined, origin);
    const ledger = JSON.stringify((await harness.library.readProgress()).decisions), store = new RecordingStore(harness.library.directory, harness.library.workspaceKey);
    const path = join(store.path(study.id, 2), 'header.json'), header = await readFile(path);
    // Act
    if (failure === 'missing') await unlink(path);
    else await writeFile(path, failure === 'corrupt' ? '{broken' : JSON.stringify({ ...JSON.parse(header.toString()), version: 99 }));
    await harness.reader.openRecording(study.id); await harness.service.playbackController!.settle();
    const failed = harness.reader.inspect().view!; await harness.reader.action('return-wiki');
    // Assert
    assert.equal(failed.recording?.readiness, 'failed'); assert.equal(failed.repositoryReturnAvailable, true); assert.equal(failed.model.continueArguments, undefined);
    assert.equal(JSON.stringify(harness.articleReturns), JSON.stringify([origin])); assert.equal(JSON.stringify((await harness.library.readProgress()).decisions), ledger);
    assert.equal(harness.configuredRuntimes[0]!.dispatches, 1); assert.equal(harness.service.playbackController!.state().mode, 'paused');
    if (failure !== 'missing') assert.equal(await readFile(path, 'utf8'), failure === 'corrupt' ? '{broken' : JSON.stringify({ ...JSON.parse(header.toString()), version: 99 }));
    await writeFile(path, header);
  } finally { await harness.close(); }
});

/** Starts each actual-Return regression from a saved recording and the learner's native two-row article layout. @example await articleRecordingLayoutHarness() */
async function articleRecordingLayoutHarness(capturedApplication = false) {
  const harness = await recordedReaderHarness(capturedApplication), library = await harness.reader.learningStorage();
  try {
    await harness.reader.close();
    harness.useNativeLayout({ orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
    const study = await library.readStudy(harness.studyId), observation = study.observations[0]!;
    const binding: BookObservationBinding = { nodeId: 'cart', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
    const origin: RepositorySelection = { bookId: 'architecture', revision: 1, nodeId: 'cart', anchorIndex: 0, location: { sectionIndex: 1, fraction: 0.65, focusId: 'evidence-0-recording' } };
    await library.selectRepository(origin);
    harness.controls.returnToRepository = async selection => { await harness.reader.arrangeRepository(new AbortController().signal, selection); };
    return { ...harness, library, binding, origin };
  } catch (error) { await harness.close(); throw error; }
}

for (const corrupt of [false, true]) test(`returning from ${corrupt ? 'a failed' : 'a healthy'} recording restores the article's two stacked groups and permits another evidence visit`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), { library, binding, origin } = harness;
  const headerPath = join(harness.store.path(harness.studyId), 'header.json'), header = await readFile(headerPath);
  try {
    const draft = harness.addForeignDraft(), decisions = (await library.readProgress()).decisions;
    await harness.reader.openRepositoryEvidence(binding, true, undefined, origin); await harness.controller.settle();
    assert.equal(harness.controller.state().readiness, 'ready');
    if (corrupt) { await writeFile(headerPath, '{broken'); await harness.reader.action('reload-recording'); await harness.controller.settle(); assert.equal(harness.controller.state().readiness, 'failed'); }
    const equalizations = harness.commands.filter(command => command === 'workbench.action.evenEditorWidths').length;
    // Act
    await harness.reader.action('return-wiki');
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
    assert.equal(harness.groups.length, 2); assert.equal(harness.panelColumn('codebook.studyContext'), 2);
    assert.equal(harness.groups[0]!.tabs.includes(draft), true); assert.equal(draft.isDirty, true);
    assert.deepEqual((await library.readProgress()).decisions, decisions);
    assert.equal(harness.commands.filter(command => command === 'workbench.action.evenEditorWidths').length, equalizations);
    await writeFile(headerPath, header);
    await harness.reader.openRepositoryEvidence(binding, true, undefined, origin); await harness.controller.settle();
    assert.equal(harness.controller.state().readiness, 'ready'); assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.sourceColumn(), 2); assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
  } finally { await writeFile(headerPath, header); await harness.close(); }
});

test('native minimum-width expansion keeps Wiki Return successful and the next observation in three visible panes', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  let releaseLayout = () => {}, releaseReceipt = () => {};
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 326 }, { size: 326 }] });
    const draft = harness.addForeignDraft(), decisions = (await harness.library.readProgress()).decisions;
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    const layout = harness.holdNextCommand('vscode.setEditorLayout'); releaseLayout = layout.release;
    // Act
    const returning = harness.reader.action('return-wiki'); await layout.started;
    const receipt = harness.holdNextCommand('vscode.getEditorLayout'); releaseReceipt = receipt.release;
    layout.release(); await receipt.started;
    harness.changeEditorLayout({ orientation: 0, groups: [{ size: 330 }, { size: 330 }] });
    receipt.release(); await returning;
    // Assert
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 330 }, { size: 330 }] });
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1); assert.equal(harness.sourceColumn(), 2); assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    const source = harness.groups.find(group => group.viewColumn === 2)?.activeTab?.input;
    assert.ok(source && 'uri' in source); assert.equal(source.uri.toString(), harness.reader.inspect().sourceUri);
    assert.equal(harness.groups[0]!.tabs.includes(draft), true); assert.equal(draft.isDirty, true);
    assert.deepEqual((await harness.library.readProgress()).decisions, decisions);
  } finally { releaseLayout(); releaseReceipt(); await harness.close(); }
});

test('a proportional learner resize after Wiki Return remains authoritative on the next observation', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    await harness.reader.action('return-wiki');
    harness.changeEditorLayout({ orientation: 1, groups: [{ size: 322 }, { size: 324 }] });
    const mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    // Act
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 322 }, { size: 324 }] });
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
    assert.equal(harness.panelColumn('codebook.studyContext'), 2);
  } finally { await harness.close(); }
});

for (const change of ['resize', 'source move', 'context move', 'application move', 'foreign tab', 'foreign group', 'replaced group']) test(`actual article Return preserves a learner's ${change} after opening recording evidence`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    if (change === 'resize') harness.changeEditorLayout({ orientation: 1, groups: [{ size: 0.7 }, { size: 0.2 }, { size: 0.1 }] });
    if (change === 'source move') harness.moveSource(1);
    if (change === 'context move') harness.movePanel('codebook.studyContext', 2);
    if (change === 'application move') harness.movePanel('codebook.scopedBrowser', 2);
    const draft = harness.addForeignDraft(change === 'foreign tab' ? 3 : 1);
    if (change === 'foreign group') harness.groups.push({ viewColumn: 4, tabs: [] });
    if (change === 'replaced group') harness.groups[0] = { ...harness.groups[0]! };
    const layout = harness.editorLayout(), groups = [...harness.groups], mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    // Act
    await harness.reader.action('return-wiki');
    // Assert
    assert.deepEqual(harness.editorLayout(), layout); assert.deepEqual(harness.groups, groups);
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft)), true); assert.equal(draft.isDirty, true);
  } finally { await harness.close(); }
});

for (const move of ['source', 'context']) test(`the next evidence visit preserves a manual ${move} move made after actual article Return`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    if (move === 'source') harness.moveSource(1); else harness.movePanel('codebook.studyContext', 1);
    const mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    // Act
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    // Assert
    assert.equal(harness.controller.state().readiness, 'ready');
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
    assert.equal(move === 'source' ? harness.sourceColumn() : harness.panelColumn('codebook.studyContext'), 1);
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
  } finally { await harness.close(); }
});

test('actual Return cannot consume another article origin when its native layout is still owned', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal, { ...harness.origin, nodeId: 'another-article' });
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
    await harness.reader.action('return-wiki');
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
  } finally { await harness.close(); }
});

test('cancelling actual Return during its ownership read preserves Study and permits a later explicit Return', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), cancellation = new AbortController();
  let release = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    const held = harness.holdNextCommand('vscode.getEditorLayout'); release = held.release;
    // Act
    const returning = harness.reader.arrangeRepository(cancellation.signal, harness.origin), rejected = assert.rejects(returning, /abort/i);
    await held.started; cancellation.abort(); held.release(); await rejected;
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
    await harness.reader.action('return-wiki');
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
  } finally { release(); await harness.close(); }
});

test('a new evidence visit drains a cancelled Return layout before restoring its three visible Study panes', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), cancellation = new AbortController();
  let release = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    const held = harness.holdNextCommand('vscode.setEditorLayout'); release = held.release;
    // Act
    const returning = harness.reader.arrangeRepository(cancellation.signal, harness.origin), rejected = assert.rejects(returning, /abort/i);
    await held.started; cancellation.abort();
    const opening = harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin);
    held.release(); await rejected; await opening; await harness.controller.settle();
    // Assert
    assert.equal(harness.controller.state().readiness, 'ready');
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1); assert.equal(harness.sourceColumn(), 2); assert.equal(harness.panelColumn('codebook.studyContext'), 3);
  } finally { release(); await harness.close(); }
});

test('Close drains an accepted article Return without retaining a layout origin or reopening owned panes', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  let release = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    const draft = harness.addForeignDraft(), held = harness.holdNextCommand('vscode.setEditorLayout'); release = held.release;
    // Act
    const returning = harness.reader.action('return-wiki'), rejected = assert.rejects(returning, /closed/);
    await held.started; const closing = harness.reader.close(); held.release(); await rejected; await closing;
    // Assert
    assert.equal(harness.reader.inspect().opened, false); assert.equal(harness.counts().panels, 0);
    assert.equal(harness.reader['repositoryLayoutOrigin'], undefined); assert.equal(harness.reader['repositoryLayoutRestored'], undefined);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft)), true); assert.equal(draft.isDirty, true);
  } finally { release(); await harness.close(); }
});

test('a manual context move during the restored-layout receipt remains authoritative on the next evidence visit', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  let releaseLayout = () => {}, releaseReceipt = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    const layout = harness.holdNextCommand('vscode.setEditorLayout'); releaseLayout = layout.release;
    // Act
    const returning = harness.reader.action('return-wiki'); await layout.started;
    const receipt = harness.holdNextCommand('vscode.getEditorLayout'); releaseReceipt = receipt.release;
    layout.release(); await receipt.started; harness.movePanel('codebook.studyContext', 1); receipt.release(); await returning;
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    // Assert
    assert.equal(harness.controller.state().readiness, 'ready'); assert.equal(harness.panelColumn('codebook.studyContext'), 1);
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
  } finally { releaseLayout(); releaseReceipt(); await harness.close(); }
});

test('cancelling a later article evidence visit keeps the previous actual Return layout and reading origin', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), cancellation = new AbortController();
  let release = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    const source = harness.holdNextSource(); release = source.release;
    // Act
    const opening = harness.reader.openRepositoryEvidence(harness.binding, true, cancellation.signal, { ...harness.origin, nodeId: 'later-article' }), rejected = assert.rejects(opening, /abort/i);
    await source.started; cancellation.abort(); source.release(); await rejected; await harness.controller.settle();
    await harness.reader.action('return-wiki');
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
    assert.deepEqual((await harness.library.readProgress()).repositoryReturn?.selection, { bookId: 'architecture', revision: 1, nodeId: 'cart', anchorIndex: 0, location: { sectionIndex: 1, fraction: 0.65, focusId: 'evidence-0-recording' } });
  } finally { release(); await harness.close(); }
});

test('a manual resize while the next evidence source loads is preserved after actual article Return', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), manual = { orientation: 1, groups: [{ size: 1 }, { size: 3 }, { size: 1 }] };
  let release = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    const source = harness.holdNextSource(); release = source.release;
    // Act
    const opening = harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await source.started;
    harness.changeEditorLayout(manual); source.release(); await opening; await harness.controller.settle();
    // Assert
    assert.equal(harness.controller.state().readiness, 'ready');
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 1 }, { size: 3 }, { size: 1 }] });
  } finally { release(); await harness.close(); }
});

for (const region of ['application', 'context', 'source']) test(`a manual ${region} move while a returning article observation loads preserves the learner layout`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  let release = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    const source = harness.holdNextSource(); release = source.release;
    // Act
    const opening = harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin); await source.started;
    if (region === 'source') harness.moveSource(1); else harness.movePanel(region === 'application' ? 'codebook.scopedBrowser' : 'codebook.studyContext', region === 'application' ? 2 : 1);
    const layout = harness.editorLayout(), mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    source.release(); await opening;
    // Assert
    assert.equal(region === 'source' ? harness.sourceColumn() : harness.panelColumn(region === 'application' ? 'codebook.scopedBrowser' : 'codebook.studyContext'), region === 'application' ? 2 : 1);
    assert.equal(harness.reader.inspect().view?.model.observation?.id, harness.binding.observationId);
    assert.deepEqual(harness.editorLayout(), layout); assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
  } finally { release(); await harness.close(); }
});

test('cancelling observation reentry after actual Return preserves the original article layout for another Return', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), cancellation = new AbortController();
  let release = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    const source = harness.holdNextSource(); release = source.release;
    // Act
    const opening = harness.reader.openRepositoryEvidence(harness.binding, false, cancellation.signal, harness.origin), rejected = assert.rejects(opening, /abort/i);
    await source.started; assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    cancellation.abort(); source.release(); await rejected;
    await harness.reader.action('return-wiki');
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
    assert.equal(harness.groups.length, 2); assert.equal(harness.panelColumn('codebook.studyContext'), 2);
    assert.deepEqual((await harness.library.readProgress()).repositoryReturn?.selection, harness.origin);
  } finally { release(); await harness.close(); }
});

test('retrying a cancelled observation reentry retains the article layout from before Codebook expanded its groups', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), cancellation = new AbortController();
  let release = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    const source = harness.holdNextSource(); release = source.release;
    const opening = harness.reader.openRepositoryEvidence(harness.binding, false, cancellation.signal, harness.origin), rejected = assert.rejects(opening, /abort/i);
    await source.started; cancellation.abort(); source.release(); await rejected;
    // Act
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    await harness.reader.action('return-wiki');
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
    assert.equal(harness.groups.length, 2); assert.equal(harness.panelColumn('codebook.studyContext'), 2);
  } finally { release(); await harness.close(); }
});

for (const cursor of [false, true]) test(`${cursor ? 'Cursor: ' : ''}reentry can restore the source column accepted by Study before the article Return contracted its group`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  if (cursor) harness.useCursorGroupWrappers();
  let release = () => {};
  try {
    const layout = harness.holdNextCommand('runCommands'); release = layout.release;
    const opening = harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin);
    await layout.started; harness.moveSource(3); layout.release(); await opening; await harness.controller.settle();
    assert.equal(harness.sourceColumn(), 3);
    await harness.reader.action('return-wiki'); assert.equal(harness.groups.length, 2);
    // Act
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    // Assert
    assert.equal(harness.sourceColumn(), 3); assert.equal(harness.groups.length, 3);
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
  } finally { release(); await harness.close(); }
});

test('a normal Wiki open after cancelled reentry does not consume the previous article Return layout', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), cancellation = new AbortController();
  let release = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    const source = harness.holdNextSource(); release = source.release;
    const opening = harness.reader.openRepositoryEvidence(harness.binding, false, cancellation.signal, harness.origin), rejected = assert.rejects(opening, /abort/i);
    await source.started; cancellation.abort(); source.release(); await rejected;
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal);
    await harness.reader.action('return-wiki');
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{}, {}, {}] });
    assert.equal(harness.groups.length, 3); assert.equal(harness.panelColumn('codebook.studyContext'), 3);
  } finally { release(); await harness.close(); }
});

test('actual Return after cancelled reentry preserves a foreign draft added to the expanded group', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), cancellation = new AbortController();
  let release = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    const source = harness.holdNextSource(); release = source.release;
    const opening = harness.reader.openRepositoryEvidence(harness.binding, false, cancellation.signal, harness.origin), rejected = assert.rejects(opening, /abort/i);
    await source.started; cancellation.abort(); source.release(); await rejected;
    const draft = harness.addForeignDraft(3), mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    // Act
    await harness.reader.action('return-wiki');
    // Assert
    assert.equal(harness.groups.length, 3); assert.equal(harness.groups.find(group => group.viewColumn === 3)?.tabs.includes(draft), true); assert.equal(draft.isDirty, true);
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
  } finally { release(); await harness.close(); }
});

test('cancelling during the accepted reentry layout read still lets actual Return restore the article groups', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), cancellation = new AbortController();
  let releaseBefore = () => {}, releasePrepared = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    const before = harness.holdNextCommand('vscode.getEditorLayout'); releaseBefore = before.release;
    // Act
    const opening = harness.reader.openRepositoryEvidence(harness.binding, false, cancellation.signal, harness.origin), rejected = assert.rejects(opening, /abort/i);
    await before.started; const prepared = harness.holdNextCommand('vscode.getEditorLayout'); releasePrepared = prepared.release; before.release();
    await prepared.started; assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    cancellation.abort(); prepared.release(); await rejected; await harness.reader.action('return-wiki');
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
    assert.equal(harness.groups.length, 2); assert.equal(harness.panelColumn('codebook.studyContext'), 2);
  } finally { releaseBefore(); releasePrepared(); await harness.close(); }
});

test('a source move during reentry loading overrides the previously planned source restoration', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  let releaseLayout = () => {}, releaseSource = () => {};
  try {
    const layout = harness.holdNextCommand('runCommands'); releaseLayout = layout.release;
    const initial = harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin);
    await layout.started; harness.moveSource(3); layout.release(); await initial; await harness.controller.settle();
    await harness.reader.action('return-wiki'); assert.equal(harness.sourceColumn(), 2);
    const source = harness.holdNextSource(); releaseSource = source.release;
    // Act
    const opening = harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin); await source.started;
    harness.moveSource(1); const mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    source.release(); await opening;
    // Assert
    assert.equal(harness.sourceColumn(), 1); assert.equal(harness.reader.inspect().view?.model.observation?.id, harness.binding.observationId);
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
  } finally { releaseLayout(); releaseSource(); await harness.close(); }
});

for (const cursor of [false, true]) test(`${cursor ? 'Cursor: ' : ''}Close during the accepted reentry layout read cannot acquire a new receipt or reopen owned panes`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  if (cursor) harness.useCursorGroupWrappers();
  let releaseBefore = () => {}, releasePrepared = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki'); const draft = harness.addForeignDraft();
    const before = harness.holdNextCommand('vscode.getEditorLayout'); releaseBefore = before.release;
    // Act
    const opening = harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin), rejected = assert.rejects(opening, /closed/);
    await before.started; const prepared = harness.holdNextCommand('vscode.getEditorLayout'); releasePrepared = prepared.release; before.release();
    await prepared.started; const closing = harness.reader.close(); prepared.release(); await rejected; await closing;
    // Assert
    assert.equal(harness.reader.inspect().opened, false); assert.equal(harness.counts().panels, 0);
    assert.equal(harness.reader['layoutReceipt'], undefined); assert.equal(harness.reader['repositoryLayoutOrigin'], undefined);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft)), true); assert.equal(draft.isDirty, true);
  } finally { releaseBefore(); releasePrepared(); await harness.close(); }
});

test('a manual pane move during a cancelled reentry layout read never becomes a Codebook-owned effect', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), cancellation = new AbortController();
  let releaseBefore = () => {}, releasePrepared = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    const before = harness.holdNextCommand('vscode.getEditorLayout'); releaseBefore = before.release;
    // Act
    const opening = harness.reader.openRepositoryEvidence(harness.binding, false, cancellation.signal, harness.origin), rejected = assert.rejects(opening, /abort/i);
    await before.started; const prepared = harness.holdNextCommand('vscode.getEditorLayout'); releasePrepared = prepared.release; before.release();
    await prepared.started; harness.movePanel('codebook.studyContext', 1); cancellation.abort(); prepared.release(); await rejected;
    const mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    await harness.reader.action('return-wiki');
    // Assert
    assert.equal(harness.panelColumn('codebook.studyContext'), 1); assert.equal(harness.groups.length, 3);
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
  } finally { releaseBefore(); releasePrepared(); await harness.close(); }
});

for (const cursor of [false, true]) test(`${cursor ? 'Cursor: ' : ''}a newer article visit drains accepted reentry effects without adopting the temporary grid as its return origin`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), latestOrigin = { bookId: 'architecture', revision: 1, nodeId: 'latest-article', anchorIndex: 0 };
  if (cursor) harness.useCursorGroupWrappers();
  let releaseBefore = () => {}, releasePrepared = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    const before = harness.holdNextCommand('vscode.getEditorLayout'); releaseBefore = before.release;
    const opening = harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin), rejected = assert.rejects(opening, /superseded/);
    await before.started; const prepared = harness.holdNextCommand('vscode.getEditorLayout'); releasePrepared = prepared.release; before.release();
    // Act
    await prepared.started; const latest = harness.reader.openRepositoryEvidence(harness.binding, false, undefined, latestOrigin);
    await waitUntil(() => harness.reader['repositoryOrigin']?.selection.nodeId === 'latest-article', 'newer article intent', 1_000);
    prepared.release(); await rejected; await latest; await harness.reader.action('return-wiki');
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
    assert.equal(harness.groups.length, 2); assert.deepEqual((await harness.library.readProgress()).repositoryReturn?.selection, latestOrigin);
  } finally { releaseBefore(); releasePrepared(); await harness.close(); }
});

test('a manual grid change during reentry certification is never adopted as a Codebook arrangement', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  let releaseBefore = () => {}, releasePrepared = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    const before = harness.holdNextCommand('vscode.getEditorLayout'); releaseBefore = before.release;
    // Act
    const opening = harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    await before.started; const prepared = harness.holdNextCommand('vscode.getEditorLayout'); releasePrepared = prepared.release; before.release();
    await prepared.started; harness.changeEditorLayout({ orientation: 1, groups: [{ size: 111 }, { size: 222 }, { size: 333 }] });
    const mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    prepared.release(); await opening;
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 111 }, { size: 222 }, { size: 333 }] });
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
  } finally { releaseBefore(); releasePrepared(); await harness.close(); }
});

test('source placement accepted before cancellation survives Return and the next evidence visit', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), cancellation = new AbortController();
  let release = () => {};
  try {
    const layout = harness.holdNextCommand('runCommands'); release = layout.release;
    const initial = harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin);
    await layout.started; harness.moveSource(3); layout.release(); await initial; await harness.controller.settle();
    await harness.reader.action('return-wiki'); assert.equal(harness.sourceColumn(), 2);
    harness.abortAfterNextSourceDisplay(cancellation);
    // Act
    await assert.rejects(harness.reader.openRepositoryEvidence(harness.binding, false, cancellation.signal, harness.origin), /abort/i);
    assert.equal(harness.sourceColumn(), 3);
    await harness.reader.action('return-wiki');
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    // Assert
    assert.equal(harness.sourceColumn(), 3); assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.reader.inspect().view?.model.observation?.id, harness.binding.observationId);
  } finally { release(); await harness.close(); }
});

for (const cursor of [false, true]) test(`${cursor ? 'Cursor: ' : ''}cancelling an accepted known Study grid restoration retains the original pane locations for Return and retry`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), cancellation = new AbortController();
  if (cursor) harness.useCursorGroupWrappers();
  let release = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    const layout = harness.holdNextCommand('vscode.setEditorLayout'); release = layout.release;
    // Act
    const opening = harness.reader.openRepositoryEvidence(harness.binding, false, cancellation.signal, harness.origin), rejected = assert.rejects(opening, /abort/i);
    await layout.started; assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    cancellation.abort(); layout.release(); await rejected;
    await harness.reader.action('return-wiki'); assert.equal(harness.groups.length, 2);
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1); assert.equal(harness.sourceColumn(), 2); assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.reader.inspect().view?.model.observation?.id, harness.binding.observationId);
  } finally { release(); await harness.close(); }
});

test('reentry restores the verified Study grid once without evening its saved split sizes', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    const mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length, equalizations = harness.commands.filter(command => command === 'workbench.action.evenEditorWidths').length;
    // Act
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length - mutations, 1);
    assert.equal(harness.commands.filter(command => command === 'workbench.action.evenEditorWidths').length, equalizations);
  } finally { await harness.close(); }
});

test('Cursor group creation preserves the article origin so actual Return restores its two stacked rows', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(); harness.useCursorGroupWrappers();
  try {
    const originalGroups = [...harness.groups];
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    assert.equal(harness.groups.length, 3); assert.equal(harness.groups[0] === originalGroups[0], false);
    // Act
    await harness.reader.action('return-wiki');
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
    assert.equal(harness.groups.length, 2); assert.equal(harness.panelColumn('codebook.studyContext'), 2);
    assert.deepEqual((await harness.library.readProgress()).repositoryReturn?.selection, harness.origin);
  } finally { await harness.close(); }
});

test('Cursor group contraction preserves pre-merge identities so the next evidence visit restores all three pane columns', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    const previous = harness.groups[1]!, previousTabs = [...previous.tabs]; harness.useCursorGroupWrappers();
    // Act
    await harness.reader.action('return-wiki');
    assert.deepEqual(previous.tabs, previousTabs); assert.equal(harness.groups[1] === previous, false);
    assert.equal(harness.groups[1]!.tabs.length, previousTabs.length + 1);
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1); assert.equal(harness.sourceColumn(), 2); assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
    assert.equal(harness.reader.inspect().view?.errors.length, 0);
  } finally { await harness.close(); }
});

for (const recording of [false, true]) test(`Cursor two-event contraction preserves error-free Return and separate application, source and context on ${recording ? 'recording' : 'observation'} reentry`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(); harness.useCursorGroupWrappers(true);
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    const previousGroups = [...harness.groups], previousTabs = previousGroups.map(group => [...group.tabs]);
    // Act
    await harness.reader.action('return-wiki');
    const returnErrorCount = harness.reader.inspect().view!.errors.length;
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
    assert.deepEqual(previousGroups.map(group => group.tabs), previousTabs);
    await harness.reader.openRepositoryEvidence(harness.binding, recording, undefined, harness.origin); await harness.controller.settle();
    // Assert
    assert.deepEqual({ returnErrorCount, appColumn: harness.panelColumn('codebook.scopedBrowser'), sourceColumn: harness.sourceColumn(), contextColumn: harness.panelColumn('codebook.studyContext') },
      { returnErrorCount: 0, appColumn: 1, sourceColumn: 2, contextColumn: 3 });
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    const application = harness.groups.find(group => group.viewColumn === 1)!.activeTab?.input, source = harness.groups.find(group => group.viewColumn === 2)!.activeTab?.input, context = harness.groups.find(group => group.viewColumn === 3)!.activeTab?.input;
    assert.ok(application && 'viewType' in application); assert.equal(application.viewType, 'codebook.scopedBrowser');
    assert.ok(source && 'uri' in source); assert.equal(source.uri.toString(), harness.reader.inspect().sourceUri);
    assert.ok(context && 'viewType' in context); assert.equal(context.viewType, 'codebook.studyContext');
  } finally { await harness.close(); }
});

test('Cursor preserves a uniquely added learner text tab while returning to the saved article grid', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    const previous = harness.groups[0]!, previousTabs = [...previous.tabs];
    // Act
    harness.resyncEditorGroups('append'); await harness.reader.action('return-wiki');
    // Assert
    assert.deepEqual(previous.tabs, previousTabs);
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
    assert.equal(harness.groups[0]!.tabs.some(tab => 'uri' in tab.input && tab.input.uri.path === '/learner-added-notes.txt'), true);
  } finally { await harness.close(); }
});

test('Cursor group creation cannot make a fourth learner group eligible for article Return contraction', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(); harness.useCursorGroupWrappers();
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    harness.groups.push({ viewColumn: 4, tabs: [] }); const draft = harness.addForeignDraft(4); harness.resyncEditorGroups();
    const layout = harness.editorLayout(), mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    // Act
    await harness.reader.action('return-wiki');
    // Assert
    assert.equal(harness.groups.length, 4); assert.equal(draft.isDirty, true);
    assert.equal(harness.groups[3]!.tabs.some(tab => 'uri' in tab.input && tab.input.uri.toString() === draft.input.uri.toString()), true);
    assert.deepEqual(harness.editorLayout(), layout); assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
  } finally { await harness.close(); }
});

for (const cursor of [false, true]) test(`${cursor ? 'Cursor' : 'VS Code'} explicit observation reentry reveals its captured application over the retained article tab`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(true);
  if (cursor) harness.useCursorGroupWrappers();
  try {
    const draft = harness.addForeignDraft();
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    const readingGroup = harness.groups.find(group => group.viewColumn === 1)!;
    readingGroup.activeTab = readingGroup.tabs.find(tab => 'uri' in tab.input && tab.input.uri.path.endsWith('/article-source.ts'));
    const reveals = harness.panelReveals().length;
    // Act
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    // Assert
    const image = harness.reader.inspect().view?.model.image;
    assert.equal(image?.status, 'captured'); assert.equal(image?.base64, harness.png.toString('base64'));
    const application = harness.groups.find(group => group.viewColumn === 1)!.activeTab?.input;
    assert.ok(application && 'viewType' in application); assert.equal(application.viewType, 'codebook.scopedBrowser');
    assert.deepEqual(harness.panelReveals().slice(reveals).filter(reveal => reveal.kind === 'codebook.scopedBrowser'), [{ kind: 'codebook.scopedBrowser', column: undefined, preserveFocus: true }]);
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1); assert.equal(harness.sourceColumn(), 2); assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft)), true); assert.equal(draft.isDirty, true);
    assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { await harness.close(); }
});

for (const sharedContext of [false, true]) test(`explicit observation entry preserves a manually moved application${sharedContext ? ' sharing the context group with Return visible' : ' in its current column'}`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(true), manual = { orientation: 1, groups: [{ size: 111 }, { size: 222 }, { size: 333 }] };
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    harness.movePanel('codebook.scopedBrowser', 3); harness.movePanel('codebook.studyContext', sharedContext ? 3 : 1); harness.changeEditorLayout(manual);
    const draft = harness.addForeignDraft(3); harness.groups.find(group => group.viewColumn === 3)!.activeTab = draft;
    const mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length, reveals = harness.panelReveals().length;
    // Act
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    // Assert
    const visible = harness.groups.find(group => group.viewColumn === 3)!.activeTab?.input;
    assert.ok(visible && 'viewType' in visible); assert.equal(visible.viewType, sharedContext ? 'codebook.studyContext' : 'codebook.scopedBrowser');
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 3); assert.equal(harness.panelColumn('codebook.studyContext'), sharedContext ? 3 : 1); assert.equal(harness.sourceColumn(), 2);
    assert.deepEqual(harness.editorLayout(), manual); assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
    assert.deepEqual(harness.panelReveals().slice(reveals), [{ kind: 'codebook.scopedBrowser', column: undefined, preserveFocus: true }, { kind: 'codebook.studyContext', column: undefined, preserveFocus: false }]);
    assert.equal(harness.groups.find(group => group.viewColumn === 3)!.tabs.includes(draft), true); assert.equal(draft.isDirty, true);
  } finally { await harness.close(); }
});

test('periodic study refresh preserves a learner text tab selected over the captured application', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(true);
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    const draft = harness.addForeignDraft(1); harness.groups.find(group => group.viewColumn === 1)!.activeTab = draft;
    const reveals = harness.panelReveals().filter(reveal => reveal.kind === 'codebook.scopedBrowser').length;
    // Act
    await harness.reader['refresh']();
    // Assert
    assert.equal(harness.reader.inspect().view?.model.image?.status, 'captured');
    assert.equal(harness.groups.find(group => group.viewColumn === 1)!.activeTab, draft);
    assert.equal(harness.panelReveals().filter(reveal => reveal.kind === 'codebook.scopedBrowser').length, reveals);
  } finally { await harness.close(); }
});

for (const retirement of ['cancel', 'Close'] as const) test(`${retirement} during observation source loading prevents a late application reveal over the article`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(true), cancellation = new AbortController();
  let release = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin); await harness.reader.action('return-wiki');
    const readingGroup = harness.groups.find(group => group.viewColumn === 1)!;
    readingGroup.activeTab = readingGroup.tabs.find(tab => 'uri' in tab.input && tab.input.uri.path.endsWith('/article-source.ts'));
    const source = harness.holdNextSource(); release = source.release;
    const reveals = harness.panelReveals().filter(reveal => reveal.kind === 'codebook.scopedBrowser').length;
    const opening = harness.reader.openRepositoryEvidence(harness.binding, false, cancellation.signal, harness.origin), rejected = assert.rejects(opening, retirement === 'cancel' ? /abort/i : /closed/);
    // Act
    await source.started;
    const closing = retirement === 'Close' ? harness.reader.close() : undefined;
    if (retirement === 'cancel') cancellation.abort();
    source.release(); await rejected; await closing;
    // Assert
    assert.equal(harness.panelReveals().filter(reveal => reveal.kind === 'codebook.scopedBrowser').length, reveals);
    const visible = harness.groups.find(group => group.viewColumn === 1)!.activeTab?.input;
    assert.ok(visible && 'uri' in visible); assert.equal(visible.uri.path.endsWith('/article-source.ts'), true);
    if (retirement === 'Close') assert.equal(harness.counts().panels, 0);
  } finally { release(); await harness.close(); }
});

for (const newer of ['selection', 'Open'] as const) test(`a newer ${newer} prevents a superseded observation entry from revealing its application`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(true);
  let release = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin); await harness.reader.action('return-wiki');
    const readingGroup = harness.groups.find(group => group.viewColumn === 1)!;
    readingGroup.activeTab = readingGroup.tabs.find(tab => 'uri' in tab.input && tab.input.uri.path.endsWith('/article-source.ts'));
    const source = harness.holdNextSource(); release = source.release;
    const reveals = harness.panelReveals().filter(reveal => reveal.kind === 'codebook.scopedBrowser').length;
    const opening = harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    const finished = newer === 'selection' ? assert.rejects(opening, /superseded/) : opening;
    await source.started;
    // Act
    const latest = newer === 'selection' ? harness.reader.select('paired-cart-demo/browser') : harness.reader.open();
    if (newer === 'selection') await waitUntil(() => harness.reader.inspect().view?.model.selection.itemId === 'paired-cart-demo/browser', 'newer learner selection', 1_000);
    else await latest;
    source.release(); await finished; await latest;
    // Assert
    assert.equal(harness.panelReveals().filter(reveal => reveal.kind === 'codebook.scopedBrowser').length, reveals);
    const visible = harness.groups.find(group => group.viewColumn === 1)!.activeTab?.input;
    assert.ok(visible && 'uri' in visible); assert.equal(visible.uri.path.endsWith('/article-source.ts'), true);
  } finally { release(); await harness.close(); }
});

test('all three presentation modes retain the exact panels, source, learning item and learner decisions', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); await harness.reader.understand(true);
    const initial = harness.reader.inspect(), library = await harness.reader.learningStorage(), progress = await library.readProgress();
    const app = harness.reader['app'], context = harness.reader['contextPanel'];
    const draft = harness.addForeignDraft(1);
    // Act
    let state = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2); assert.equal(harness.panelColumn('codebook.studyContext'), 1); assert.equal(harness.sourceColumn(), 3);
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.6 }, { size: 0.4, groups: [{ size: 0.5 }, { size: 0.5 }] }] });
    state = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' });
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
    state = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'select' });
    assert.equal(harness.reader['app'], app); assert.equal(harness.reader['contextPanel'], context);
    assert.equal(harness.reader.inspect().sourceUri, initial.sourceUri); assert.deepEqual(harness.reader.inspect().view!.model.selection, initial.view!.model.selection);
    assert.deepEqual(await library.readProgress(), progress); assert.equal(harness.runtimes.length, 0);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft)), true); assert.equal(draft.isDirty, true);
    assert.equal(harness.reader.presentationState().presentationControlRevision, 3); assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), { version: 1, mode: 'study-workspace' });
  } finally { await harness.close(); }
});

test('switching presentation waits for restored application focus before confirming the new mode', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); await harness.reader.action('focus-app');
    const state = harness.reader.presentationState();
    // Two earlier requests keep the owned panel; the third restores the initiating application focus.
    harness.deferPanelFocus('codebook.scopedBrowser', 3);
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    // Assert
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser');
    assert.equal(harness.reader.presentationState().mode, 'living-book');
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), { version: 1, mode: 'living-book' });
  } finally { await harness.close(); }
});

test('moving a presentation retains both measured axes when native tab relocation flattens the grid', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open();
    harness.changeEditorLayout({ orientation: 0, groups: [{ size: 352, groups: [{ size: 154 }, { size: 154 }] }, { size: 288 }] });
    harness.flattenOnNextPanelMove({ orientation: 0, groups: [{ size: 220 }, { size: 220 }, { size: 220 }] });
    const state = harness.reader.presentationState();
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'restore' });
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 384 }, { size: 256, groups: [{ size: 154 }, { size: 154 }] }] });
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
  } finally { await harness.close(); }
});

test('restoring a presentation clears its previous failure while retaining an unrelated control error', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open();
    harness.receive({ type: 'select', revision: harness.reader.inspect().view!.revision + 1, itemId: 'checkout-demo/cart-mutation' });
    await waitUntil(() => harness.reader.inspect().view!.errors.some(error => error.includes('displayed study changed')), 'unrelated control diagnostic', 1_000);
    harness.failNextCommand('vscode.setEditorLayout');
    let state = harness.reader.presentationState();
    harness.receive({ type: 'presentation', revision: harness.reader.inspect().view!.revision, presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    await waitUntil(() => harness.reader.inspect().view!.errors.some(error => error.includes('presentation was not confirmed')), 'presentation failure diagnostic', 1_000);
    state = harness.reader.presentationState();
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'restore' });
    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.reader.presentationState().reason, undefined);
    assert.deepEqual([...harness.reader.inspect().view!.errors], ['Error: The displayed study changed. Inspect the current view before acting.']);
  } finally { await harness.close(); }
});

test('reselecting a confirmed presentation clears a stale control warning and keeps the selector usable', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); let state = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    state = harness.reader.presentationState();
    harness.receive({ type: 'presentation', revision: harness.reader.inspect().view!.revision, presentationId: state.presentationId, expectedRevision: state.presentationControlRevision + 1, mode: 'living-book', action: 'select' });
    await waitUntil(() => harness.reader.inspect().view!.errors.some(error => error.includes('control revision changed')), 'stale presentation diagnostic', 1_000);
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    // Assert
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    assert.equal(harness.reader.presentationState().presentationControlRevision, 1);
    assert.equal(harness.postedMessages().at(-1)!.presentation!.state, 'open');
  } finally { await harness.close(); }
});

test('same-mode selection keeps its revision only while the actual native layout is still confirmed', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); let state = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    state = harness.reader.presentationState(); const commands = [...harness.commands];
    // Act / Assert
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    assert.equal(harness.reader.presentationState().presentationControlRevision, 1);
    assert.deepEqual(harness.commands, [...commands, 'vscode.getEditorLayout']);
    harness.changeEditorLayout({ orientation: 0, groups: [{ size: 0.5, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.5 }] });
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    assert.equal(harness.reader.presentationState().presentationControlRevision, 2);
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.6 }, { size: 0.4, groups: [{ size: 0.5 }, { size: 0.5 }] }] });
  } finally { await harness.close(); }
});

test('a failed mode preference keeps the applied layout and save-only recovery does not move any editor', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); harness.failPresentationPreference(true); let state = harness.reader.presentationState();
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    // Assert
    state = harness.reader.presentationState(); assert.equal(state.mode, 'living-book'); assert.equal(state.layoutConfirmed, true); assert.equal(state.preference.status, 'failed');
    const commands = [...harness.commands], reveals = harness.panelReveals(); harness.failPresentationPreference(false);
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'save-preference' });
    assert.equal(harness.reader.presentationState().preference.status, 'saved'); assert.deepEqual(harness.commands, commands); assert.deepEqual(harness.panelReveals(), reveals);
    assert.equal(harness.reader.presentationState().presentationControlRevision, 2);
  } finally { await harness.close(); }
});

test('pending presentation placement rejects stale and competing controls before dispatching any runtime input', async () => {
  // Arrange
  const harness = await workspaceHarness(); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const held = harness.holdNextCommand('workbench.action.keepEditor');
  try {
    await harness.reader.open(); const state = harness.reader.presentationState();
    const pending = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    await held.started;
    // Act / Assert
    assert.throws(() => harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' }), /revision changed/);
    assert.throws(() => harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision + 1, mode: 'guided-walkthrough', action: 'select' }), /pending/);
    assert.throws(() => harness.service.start({ instanceId: harness.service.instanceId, profile: 'paired-cart-demo', key: 'during-move' }), /pending/);
    assert.equal(harness.runtimes.length, 0); assert.equal(harness.service.records.size, 0);
    held.release(); await pending;
    assert.equal(harness.reader.presentationState().mode, 'living-book');
  } finally { held.release(); await harness.close(); }
});

test('Close retires the reader identity immediately and waits for an already accepted presentation preference write', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const held = harness.holdPresentationPreference();
  try {
    await harness.reader.open(); const state = harness.reader.presentationState();
    const pending = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    const rejected = assert.rejects(pending, /not confirmed/); await held.started;
    // Act
    let closed = false; const closing = harness.reader.close().then(() => { closed = true; });
    // Assert
    assert.notEqual(harness.reader.presentationState().presentationId, state.presentationId); assert.equal(harness.reader.presentationState().presentationControlRevision, 0); assert.equal(closed, false);
    assert.throws(() => harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: 1, mode: 'living-book', action: 'select' }), /lifetime has ended/);
    held.release(); await rejected; await closing;
    assert.equal(closed, true); assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), { version: 1, mode: 'living-book' });
    assert.equal(harness.reader.presentationState().mode, 'living-book'); assert.equal(harness.reader.presentationState().state, 'closed');
  } finally { held.release(); await harness.close(); }
});

test('real MCP presentation discovery and control preserve identities across response loss and reject stale clients', async () => {
  // Arrange
  const harness = await workspaceHarness(); harness.useNativeLayout({ orientation: 0, groups: [{}] }); await harness.reader.open();
  const endpoint = await startServer(harness.service);
  const transport = new StreamableHTTPClientTransport(new URL(endpoint.descriptor.url), { requestInit: { headers: { Authorization: `Bearer ${endpoint.descriptor.token}` } } });
  const client = new Client({ name: 'presentation-contract-test', version: '1.0' }); await client.connect(transport);
  try {
    // Act
    const tools = await client.listTools(), discovery = await client.callTool({ name: 'codebook_status', arguments: {} });
    const selected = z.object({ data: z.object({ instanceId: z.string(), presentation: z.object({ presentationId: z.string(), presentationControlRevision: z.number(), uri: z.string() }) }) }).parse(discovery.structuredContent).data;
    const input = { instanceId: selected.instanceId, presentationId: selected.presentation.presentationId, expectedRevision: selected.presentation.presentationControlRevision, mode: 'living-book' };
    const before = [...harness.commands];
    const wrong = await client.callTool({ name: 'codebook_presentation', arguments: { ...input, instanceId: randomUUID() } });
    // Assert
    assert.match(JSON.stringify(wrong.structuredContent), /STALE_INSTANCE/); assert.deepEqual(harness.commands, before);
    const tool = tools.tools.find(tool => tool.name === 'codebook_presentation')!;
    assert.equal(tool.annotations?.destructiveHint, false); assert.equal(tool.annotations?.openWorldHint, false);
    assert.deepEqual(tool.inputSchema.properties?.mode, { type: 'string', enum: ['study-workspace', 'living-book', 'guided-walkthrough'] });
    assert.equal(tool.inputSchema.required?.includes('action'), false);
    const applied = await client.callTool({ name: tool.name, arguments: input }); assert.equal(applied.isError, undefined);
    const resource = await client.readResource({ uri: selected.presentation.uri }); const contents = resource.contents[0]; assert.ok(contents && 'text' in contents);
    const receipt = z.object({ instanceId: z.string(), presentationId: z.string(), presentationControlRevision: z.number(), mode: z.string(), preference: z.object({ status: z.string() }) }).parse(JSON.parse(contents.text));
    assert.equal(receipt.presentationId, selected.presentation.presentationId); assert.equal(receipt.presentationControlRevision, 1); assert.equal(receipt.mode, 'living-book'); assert.equal(receipt.preference.status, 'saved');
    const commands = [...harness.commands];
    const stale = await client.callTool({ name: tool.name, arguments: input }); assert.match(JSON.stringify(stale.structuredContent), /STALE_PRESENTATION/); assert.deepEqual(harness.commands, commands);
    await harness.reader.close();
    const retired = await client.callTool({ name: tool.name, arguments: { ...input, expectedRevision: 1 } }); assert.match(JSON.stringify(retired.structuredContent), /PRESENTATION_INSTANCE_GONE/);
    assert.equal(harness.runtimes.length, 0); assert.equal(harness.service.records.size, 0);
  } finally { await client.close(); await endpoint.close(); await harness.close(); }
});

test('an unknown presentation preference survives opening and a cancelled picker until an explicit replacement', async () => {
  // Arrange
  const harness = await workspaceHarness(false); const stored = { version: 91, mode: 'future-mode', foreign: 'retained' };
  harness.presentationPreferences.set('codebook.presentation.v1', stored); harness.presentationPreferences.set('unrelated', { value: 'retained' });
  await harness.reader.close(); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    // Act
    await harness.reader.open(); await harness.reader.selectPresentation();
    // Assert
    let state = harness.reader.presentationState(); assert.equal(state.mode, 'study-workspace'); assert.equal(state.preference.status, 'unknown'); assert.equal(state.presentationControlRevision, 0);
    assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), stored);
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'select' });
    state = harness.reader.presentationState(); assert.equal(state.preference.status, 'saved'); assert.equal(state.presentationControlRevision, 1);
    assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), { version: 1, mode: 'study-workspace' }); assert.deepEqual(harness.presentationPreferences.get('unrelated'), { value: 'retained' });
  } finally { await harness.close(); }
});

test('a foreign preview is preserved without Keep Editor or relocation when selecting another presentation', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); const draft = harness.addForeignDraft(1); Reflect.set(draft, 'isPreview', true);
    const state = harness.reader.presentationState(), commands = [...harness.commands], reveals = harness.panelReveals();
    // Act / Assert
    await assert.rejects(harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' }), /not confirmed/);
    assert.deepEqual(harness.commands, commands); assert.deepEqual(harness.panelReveals(), reveals); assert.equal(Reflect.get(draft, 'isPreview'), true); assert.equal(draft.isDirty, true);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft)), true); assert.equal(harness.presentationPreferences.size, 0);
    assert.match(harness.reader.presentationState().reason ?? '', /foreign preview/);
  } finally { await harness.close(); }
});

test('a live pause with an uncommitted image or reserved resume rejects mode switching without native effects', async () => {
  // Arrange
  const harness = await workspaceHarness(); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); const receipt = harness.service.start({ instanceId: harness.service.instanceId, profile: 'paired-cart-demo', key: 'capture-gate' }); await harness.service.record(receipt).preparation;
    harness.service.action({ instanceId: harness.service.instanceId, runId: receipt.runId, key: 'click', action: 'add-to-cart' });
    const state = harness.reader.presentationState(), commands = [...harness.commands];
    // Act / Assert
    assert.throws(() => harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' }), /committed inspected pause/);
    const runtime = harness.runtimes[0]!; assert.ok(runtime.gate.current); runtime.gate.reserve(runtime.gate.current);
    assert.throws(() => harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' }), /continue request/);
    assert.deepEqual(harness.commands, commands); assert.equal(harness.reader.presentationState().presentationControlRevision, 0); assert.equal(runtime.dispatches, 1);
  } finally { await harness.close(); }
});

for (const boundary of ['reading pose', 'rendered context'] as const) test(`manual resume during presentation ${boundary} cannot certify or save a different live state`, async () => {
  // Arrange
  const harness = await workspaceHarness(); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {};
  try {
    await harness.reader.open(); await harness.reader.action('run');
    await [...harness.service.records.values()][0]!.preparation;
    const runtime = harness.runtimes[0]!, view = runtime.view.bind(runtime);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=', 'base64');
    await writeFile(join(runtime.evidence.directory, 'paused-server.png'), png);
    runtime.view = () => ({ ...view(), captures: { 'paused-server': { status: 'captured', file: 'paused-server.png', renderer: { epoch: 'test', id: 1, hash: sha256(png) } } } });
    await harness.reader.action('click');
    const state = harness.reader.presentationState(), reveals = harness.panelReveals();
    const held = harness.holdPresentationMessage(boundary === 'rendered context' ? 'living-book' : undefined); release = held.release;
    const transfer = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    const rejected = assert.rejects(transfer, /live pause changed/);
    await held.started;
    // Act: a native debugger action changes the pause while the webview acknowledgement is pending.
    runtime.gate.invalidate(); runtime.status = 'ready'; held.release();
    await rejected;
    // Assert
    assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    assert.equal(harness.presentationPreferences.size, 0);
    assert.equal(runtime.dispatches, 1);
    if (boundary === 'reading pose') assert.deepEqual(harness.panelReveals(), reveals);
  } finally { release(); await harness.close(); }
});

for (const learnerChange of ['pane movement', 'focus change'] as const) test(`presentation layout read preserves a later learner ${learnerChange} without saving the mode`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {};
  try {
    await harness.reader.open();
    const held = harness.holdNextCommand('vscode.getEditorLayout'); release = held.release;
    const state = harness.reader.presentationState();
    const transfer = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    const rejected = assert.rejects(transfer, /not confirmed/);
    await held.started;
    // Act: the reader still has three groups, but the learner now owns the changed pane or focus.
    harness.movePanel(learnerChange === 'pane movement' ? 'codebook.studyContext' : 'codebook.scopedBrowser', learnerChange === 'pane movement' ? 2 : 1);
    const reveals = harness.panelReveals(), commands = [...harness.commands];
    held.release(); await rejected;
    // Assert
    assert.equal(harness.panelColumn('codebook.studyContext'), learnerChange === 'pane movement' ? 2 : 3);
    assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    assert.equal(harness.presentationPreferences.size, 0);
    assert.deepEqual(harness.panelReveals(), reveals);
    assert.deepEqual(harness.commands, commands);
  } finally { release(); await harness.close(); }
});

test('a foreign preview opened during the layout read survives without relocation or a saved presentation', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {};
  try {
    await harness.reader.open();
    const held = harness.holdNextCommand('vscode.getEditorLayout'); release = held.release;
    const state = harness.reader.presentationState();
    const transfer = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    const rejected = assert.rejects(transfer, /not confirmed/);
    await held.started;
    // Act: preserve global Context focus while a learner preview opens in the later destination.
    const preview = harness.addTextPreview(join(harness.directory, 'learner-preview.txt'), 1);
    harness.groups.find(group => group.viewColumn === 1)!.activeTab = preview;
    const reveals = harness.panelReveals(), commands = [...harness.commands];
    held.release(); await rejected;
    // Assert
    assert.equal(harness.groups.find(group => group.viewColumn === 1)!.activeTab, preview);
    assert.equal(preview.isPreview, true);
    assert.deepEqual(harness.panelReveals(), reveals);
    assert.deepEqual(harness.commands, commands);
    assert.equal(harness.presentationPreferences.size, 0);
    assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    assert.match(harness.reader.presentationState().reason ?? '', /foreign preview/);
  } finally { release(); await harness.close(); }
});

test('mode transfer during a late replay image preserves the last confirmed time, source and explicit understanding', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {};
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    await harness.reader.understand(true);
    const source = harness.reader.inspect().sourceUri, library = await harness.reader.learningStorage(), decisions = (await library.readProgress()).decisions;
    const retained = harness.controller.bundle(), pendingImage = harness.holdNextImage(); release = pendingImage.release;
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 150 }); await pendingImage.started;
    const state = harness.reader.presentationState();
    // Act
    const transfer = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    await new Promise<void>(resolve => setImmediate(resolve)); release(); await transfer;
    // Assert
    assert.equal(harness.controller.state().mode, 'paused'); assert.equal(harness.controller.state().presentedMs, 100); assert.equal(harness.controller.state().requestedMs, 100);
    assert.equal(harness.controller.bundle(), retained); assert.equal(harness.controller.state().readiness, 'ready'); assert.equal(harness.reader.inspect().sourceUri, source);
    assert.equal(harness.reader.inspect().view?.contentTab, 'recording'); assert.equal(harness.displayedImage(), harness.png.toString('base64'));
    assert.deepEqual((await library.readProgress()).decisions, decisions); assert.equal(harness.runtimes.length, 1); assert.equal(harness.runtimes[0]!.dispatches, 1);
    assert.equal((await harness.store.readPreference())?.positionMs, 100); assert.equal(harness.reader.presentationState().mode, 'living-book');
    const next = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: next.presentationId, expectedRevision: next.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' });
    assert.equal(harness.controller.state().presentedMs, 100); assert.equal(harness.controller.state().mode, 'paused'); assert.equal(harness.reader.inspect().sourceUri, source);
  } finally { release(); await harness.close(); }
});

for (const dirty of [false, true]) test(`a ${dirty ? 'learner-edited' : 'clean'} prepared debugger preview ${dirty ? 'rejects switching without keeping tabs' : 'survives all three presentations'}`, async () => {
  // Arrange: native debugger stops open an owned fixture preview behind the application.
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); const path = join(harness.fixture, 'server.mts');
    await harness.reader.presentation.prepareSource(path);
    const preview = harness.addTextPreview(path, 1, dirty), commands = [...harness.commands], panels = harness.counts().panels;
    const library = await harness.reader.learningStorage(), decisions = (await library.readProgress()).decisions;
    // Act: the same public workspace coordinator handles the debugger preview and all entry points.
    const select = (mode: 'living-book' | 'guided-walkthrough' | 'study-workspace') => {
      const state = harness.reader.presentationState();
      return harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode, action: 'select' });
    };
    if (dirty) await assert.rejects(select('living-book'), /not confirmed/);
    else for (const mode of ['living-book', 'guided-walkthrough', 'study-workspace'] as const) await select(mode);
    // Assert: no source tab is discarded, dirty previews stay untouched, and learner progress is not inferred.
    assert.equal(harness.groups.some(group => group.tabs.includes(preview)), true);
    assert.equal(preview.isPreview, dirty); assert.equal(harness.counts().panels, panels);
    assert.deepEqual((await library.readProgress()).decisions, decisions);
    if (dirty) assert.deepEqual(harness.commands, commands);
    else { assert.equal(harness.reader.presentationState().mode, 'study-workspace'); assert.equal(harness.reader.presentationState().layoutConfirmed, true); }
  } finally { await harness.close(); }
});

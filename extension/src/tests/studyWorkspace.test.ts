import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { waitUntil } from '../runtimeSupport/utils/waitUntil';
import { sha256 } from '../runtimeSupport/utils/sha256';
import { REPOSITORY_BROWSER_PROFILE as PROFILE_ID } from '../constants';
import { LearningLibrary } from '../learningLibrary';
import { RecordingStore } from '../recordingStore';
import { NodeTestHistoryStore } from '../nodeTestHistoryStore';
import type { StudyViewMessage } from '../ui/studyHtml';
import type { PresentationPoseCapture, PresentationPoseRestore } from '../presentationSchemas';
import { ControlledRuntime, createHarness } from './helpers';
import { loadModule } from './utils/loadModule';
import { bookObservationHash } from '../utils/bookObservationHash';
import type { BookObservationBinding } from '../repositorySchemas';
import type { RepositorySelection } from '../learnerSchemas';
import { RepositoryBookStore } from '../repositoryBook';
import { RepositorySourceService } from '../repositorySource';
import type { ReplayDebugSnapshot } from '../replayDebugSchemas';
import { createConfiguredStudy } from './utils/createConfiguredStudy';
import { ControlledConfiguredRuntime } from './utils/configuredServiceHarness';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { startServer } from '../server';
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture';
import type { NodeTestSourceStop } from '../ownedNodeTestRun';

/** Keeps native presentation inert while exercising actual checkpoints, source watching and durable decisions. @example const reader = await workspaceHarness() */
async function workspaceHarness(attach = true, deterministicClock = false) {
  let clock = 0;
  let savedStudyCapacity: unknown;
  const harness = await createHarness({ create: async (directory, profile) => { const runtime = new ControlledRuntime(directory, profile); if (deterministicClock) runtime.evidence.elapsedMs = () => clock; return runtime; } });
  const saveStatus = { name: '', text: '', tooltip: '', command: undefined as unknown, visible: false, show() { this.visible = true; }, hide() { this.visible = false; }, dispose() { this.visible = false; } };
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
  class TabInputUnknown {}
  /** Supplies native position operations to the editor boundary fake used by workspace tests. @example new Position(22, 0).with(40, 0) */
  class Position {
    constructor(readonly line: number, readonly character: number) {}
    with(line = this.line, character = this.character) { return new Position(line, character); }
    isEqual(other: Position) { return this.line === other.line && this.character === other.character; }
  }
  /** Supplies native range membership/retention to workspace presentation tests. @example range.contains(new Position(22, 0)) */
  class Range {
    constructor(readonly start: Position, readonly end: Position) {}
    contains(value: Position | Range): boolean { return value instanceof Range ? this.contains(value.start) && this.contains(value.end) : value.line >= this.start.line && value.line <= this.end.line; }
    with(start = this.start, end = this.end) { return new Range(start, end); }
  }
  type Tab = { input: TabInputText | TabInputWebview | TabInputUnknown; label?: string; isPreview?: boolean; isDirty?: boolean; isPinned?: boolean };
  const groups: { viewColumn: number; tabs: Tab[]; activeTab?: Tab }[] = [{ viewColumn: 2, tabs: [] }];
  let activeTabGroup = groups[0]!;
  let separateEditorPart: { group: typeof groups[number]; layout: unknown; focused: boolean } | undefined;
  let separatePartLayoutReport: unknown;
  type SourceEditor = { document: { uri: Uri; getText(): string }; readonly viewColumn: number; setDecorations(): void; selections: { active: Position; anchor: Position }[]; visibleRanges: Range[]; revealRange(range: Range, revealType?: number): void };
  const activeEditorListeners = new Set<(editor: SourceEditor | undefined) => void>(), selectionListeners = new Set<() => void>();
  const activeTextEditorChanged = (editor: SourceEditor | undefined) => { for (const listener of activeEditorListeners) listener(editor); };
  let primaryNotificationOrder: 'together' | 'editor first' | 'group first' = 'together';
  let partialFocusEditor: { value: SourceEditor | undefined } | undefined;
  let lastSourceEditor: SourceEditor | undefined;
  let sourceFocusOnArrange: SourceEditor | undefined;
  let reportedSourceColumn: number | undefined;
  let nextSourceDisplay: ((editor: SourceEditor) => void) | undefined;
  let nextReadingReveal: (() => void) | undefined;
  const visibleSourceEditors: (SourceEditor & { group: typeof groups[number] })[] = [], decoratedColumns: number[] = [];
  let retainedReadingRange: Range | undefined;
  /** Models native scrolling for display and explicit reveal without conflating their callbacks. @example scrollReadingRange(new Range(position, position)) */
  const scrollReadingRange = (range: Range, revealType?: number) => {
    if (!retainedReadingRange) return;
    // Native AtTop includes five surrounding lines; revealing the whole old viewport repeatedly drifts upward.
    if (revealType === 3) { const first = Math.max(0, range.start.line - 5); retainedReadingRange = new Range(new Position(first, 0), new Position(first + 11, 0)); }
    else if (!retainedReadingRange.contains(range)) { const first = Math.max(0, range.start.line - 6); retainedReadingRange = new Range(new Position(first, 0), new Position(first + 11, 0)); }
  };
  /** Models native surrounding-line padding so workspace transfers expose lost reading positions. @example const editor = sourceEditor(document, group) */
  const sourceEditor = (document: SourceEditor['document'], group: typeof groups[number], reportedColumn?: number): SourceEditor => ({
    document, get viewColumn() { return reportedColumn ?? group.viewColumn; }, setDecorations() { decoratedColumns.push(reportedColumn ?? group.viewColumn); }, selections: [{ anchor: new Position(22, 0), active: new Position(22, 0) }],
    get visibleRanges() { return [retainedReadingRange ?? new Range(new Position(0, 0), new Position(100, 0))]; },
    revealRange(range, revealType) {
      const revealed = nextReadingReveal; nextReadingReveal = undefined; revealed?.();
      scrollReadingRange(range, revealType);
    },
  });
  type TabChanges = { opened: Tab[]; closed: Tab[]; changed: Tab[] };
  const tabChangeListeners = new Set<(event?: TabChanges) => void>();
  const groupChangeListeners = new Set<(event: { opened: typeof groups; closed: typeof groups; changed: typeof groups }) => void>();
  const changedGroups = (event: { opened: typeof groups; closed: typeof groups; changed: typeof groups }) => { for (const listener of groupChangeListeners) listener(event); };
  let sourceProvider = async (_uri: Uri) => '';
  const historicalDebugPresentations: Array<{ snapshot: ReplayDebugSnapshot | undefined; label: string; sourceDocument?: { uri: string; hash: string } }> = [];
  let historicalDebugInvalidations = 0;
  const historicalDebuggers: TestReplayDebugger[] = [];
  class TestReplayDebugger {
    available = true;
    constructor(_editor: unknown) { historicalDebuggers.push(this); }
    async present(snapshot: ReplayDebugSnapshot | undefined, label: string, signal: AbortSignal, sourceDocument?: { uri: string; hash: string }) {
      signal.throwIfAborted();
      // Mirrors the real owner: a learner-stopped session never silently relaunches.
      if (!this.available) throw new Error('Historical debugger closed. Reopen the learning replay to restore it.');
      historicalDebugPresentations.push({ snapshot, label, sourceDocument });
    }
    invalidate() { historicalDebugInvalidations++; }
    async dispose() { this.available = false; }
  }
  let sourceOpenFailure = false;
  let delayedPanelKind: string | undefined;
  let deferredPanelRegistration = false;
  let registerDelayedPanel = () => {};
  let nextOpen: { wait: Promise<void>; entered(): void } | undefined;
  let nextCommand: { name: string; wait: Promise<void>; entered(): void } | undefined;
  let nextPrimaryFocusResponse: { wait: Promise<void>; entered(): void } | undefined;
  let nextLayoutResponse: { wait: Promise<void>; entered(): void } | undefined;
  const commands: string[] = [];
  let constrainStudyGrid = false;
  let hideGridWhileMaximized = false;
  let editorLayout: unknown = { orientation: 0, groups: [{}] };
  let nextMovedPanelLayout: unknown;
  let nativeLayout = false, cursorGroupWrappers = false, cursorTwoEventContraction = false, explicitEditorLayout = false, maximizedEditorGroup = false;
  let closeEmptyGroupsOnMove = false;
  const automaticallyClosedColumns: number[] = [];
  let transientLayout = false, settledLayout: unknown, failingCommand: string | undefined, settlementPending = false;
  const panels = new Set<ReturnType<typeof panel>>();
  let peakPanels = 0;
  let nextPanelCreated: { kind: string; run(value: ReturnType<typeof panel>): void } | undefined;
  let failedPanelKind: string | undefined;
  let suppressNativeInnerFocus = false, innerFocusedPanel: string | undefined;
  let nextPanelActivity: { kind: string; wait: Promise<void>; entered(): void } | undefined, pendingPanelActivity: string | undefined;
  let nextTextFocusClear: { kind: string; wait: Promise<void>; observed(): void } | undefined;
  let retainedTextFocus: { kind: string; editor: SourceEditor; observed(): void } | undefined;
  const windowState = { focused: true, active: true }, windowListeners = new Set<(state: typeof windowState) => void>();
  const panelReveals: { kind: string; column?: number; preserveFocus?: boolean }[] = [];
  let deferredPanelFocus: { kind: string; remaining: number } | undefined;
  let deferPrimaryFocusEcho = false, pendingPrimaryFocusEcho: typeof activeTabGroup | undefined;
  let deferMovedFocusEcho = false, pendingMovedFocusEcho: typeof activeTabGroup | undefined;
  let deferKeptFocusEcho = false, pendingKeptFocusEcho: typeof activeTabGroup | undefined;
  let deferredMovedPanelPlacement: string | undefined, asynchronousLayoutReads = false;
  const postedMessages: StudyViewMessage[] = [];
  let heldPresentationMessage: { mode?: 'living-book'; wait: Promise<void>; entered(): void } | undefined;
  const receivers = new Map<string, (message: unknown) => void>();
  let automaticContextReceipt = false, contextCoversSource = false, displayedImage: string | undefined, sourceColumn = 2;
  let nextImage: { wait: Promise<void>; entered(): void } | undefined;
  /** Mirrors native group creation for the layout-return regressions without changing older fixtures. @example nativeGroup(3).viewColumn // 3 */
  function nativeGroup(column: number, preserveLayout = false) {
    const existing = groups.find(group => group !== separateEditorPart?.group && group.viewColumn === column); if (existing) return existing;
    const group: typeof groups[number] = { viewColumn: column, tabs: [], activeTab: undefined };
    // Cursor replaces surviving wrappers in the same event that announces an opened group.
    const retained = cursorGroupWrappers ? groups.map(previous => ({ ...previous, tabs: [...previous.tabs] })) : [];
    if (cursorGroupWrappers) {
      if (separateEditorPart) separateEditorPart.group = retained[groups.indexOf(separateEditorPart.group)]!;
      groups.splice(0, groups.length, ...retained);
    }
    groups.push(group);
    // A separate part follows the main grid in global columns without becoming one of its leaves.
    if (separateEditorPart) separateEditorPart.group.viewColumn = Math.max(...groups.filter(candidate => candidate !== separateEditorPart?.group).map(candidate => candidate.viewColumn)) + 1;
    if (nativeLayout) groups.sort((left, right) => left.viewColumn - right.viewColumn);
    // Creating a native pane also grows the measured grid; a supplied layout batch retains its own geometry.
    if (!preserveLayout && (nativeLayout || !explicitEditorLayout)) editorLayout = { orientation: 0, groups: groups.filter(candidate => candidate !== separateEditorPart?.group).map(() => ({})) };
    changedGroups({ opened: [group], closed: [], changed: retained }); return group;
  }
  /** Counts native layout leaves so shrinking a grid merges only its removed groups in these tests. @example nativeGroupCount({ groups: [{}, {}] }) // 2 */
  function nativeGroupCount(value: unknown): number {
    const children = value && typeof value === 'object' ? Reflect.get(value, 'groups') : undefined;
    return Array.isArray(children) ? children.reduce((total: number, child: unknown) => total + nativeGroupCount(child), 0) : 1;
  }
  /** Models Cursor's refusal to place a normal reader in its separate chat part; panel and text opens share this boundary. @example nativeReaderColumn(2) // 1 when only main column one and chat column two exist */
  function nativeReaderColumn(requested: number): number {
    if (!nativeLayout) return requested;
    if (separateEditorPart?.group.viewColumn === requested) return activeTabGroup.viewColumn;
    return Math.min(requested, groups.filter(group => group !== separateEditorPart?.group).length + 1);
  }
  /** Models the active-text receipt independently of native tab focus for workspace handoff regressions. @example focusedSourceEditor() // prior source until its native clear arrives */
  function focusedSourceEditor(): SourceEditor | undefined {
    if (partialFocusEditor) return partialFocusEditor.value;
    if (separateEditorPart?.focused) return undefined;
    const input = activeTabGroup.activeTab?.input;
    // A newer learner target wins immediately; the delayed clear never steals its focus.
    if (retainedTextFocus && input instanceof TabInputWebview && input.viewType === retainedTextFocus.kind) {
      retainedTextFocus.observed(); return retainedTextFocus.editor;
    }
    return visibleSourceEditors.find(editor => activeTabGroup === editor.group && input instanceof TabInputText && input.uri.toString() === editor.document.uri.toString());
  }
  /** Retains the old text receipt before either native or inner activation for delayed-notification tests. @example retainDelayedTextFocus('codebook.studyContext'); */
  function retainDelayedTextFocus(kind: string): void {
    const pending = nextTextFocusClear?.kind === kind ? nextTextFocusClear : undefined, editor = focusedSourceEditor();
    if (!pending || !editor) return;
    nextTextFocusClear = undefined; retainedTextFocus = { kind, editor, observed: pending.observed };
    void pending.wait.then(() => { retainedTextFocus = undefined; activeTextEditorChanged(focusedSourceEditor()); });
  }
  function panel(kind: string, _title?: string, options?: { viewColumn: number; preserveFocus?: boolean }) {
    if (failedPanelKind === kind) { failedPanelKind = undefined; throw new Error('Injected native panel creation failure'); }
    let nativeTab = { input: new TabInputWebview(kind), isPreview: false };
    const epoch = randomUUID(), messageListeners = new Set<(message: unknown) => void>();
    const emit = (message: unknown) => { for (const listener of messageListeners) listener(message); };
    let registered = delayedPanelKind !== kind;
    const disposed: (() => void)[] = [], viewChanged: (() => void)[] = [];
    // Native webviews create only one missing group, even when a later column was requested.
    const viewColumn = options?.viewColumn ? nativeReaderColumn(options.viewColumn) : options?.viewColumn;
    const value = { blockInnerFocus: false, webview: { html: '', postMessage: async (message: StudyViewMessage | PresentationPoseCapture | PresentationPoseRestore | { type: 'codebook-focus'; phase: string; requestId: string; epoch?: string }) => {
      if (message.type === 'capture-presentation-pose') {
        emit({ ...message, type: 'presentation-pose', pose: { anchorId: 'title', fraction: 0, leadingOffsetPx: 16, scrollY: 0, valuesScrollLeft: 0, expanded: [], visited: [] } });
        return true;
      }
      if (message.type === 'restore-presentation-pose') { emit({ type: 'presentation-pose-restored', captureId: message.captureId }); return true; }
      if (message.type === 'codebook-focus') {
        if (message.phase === 'prepare') emit({ type: 'codebook-focus-receipt', phase: 'prepared', requestId: message.requestId, epoch, focused: innerFocusedPanel === kind });
        if (message.phase === 'commit' && message.epoch === epoch) {
          const group = groups.find(group => group.activeTab === nativeTab); assert.ok(group);
          const held = nextPanelActivity?.kind === kind ? nextPanelActivity : undefined;
          retainDelayedTextFocus(kind);
          // Native tab selection and document focus can precede the panel's active notification.
          if (held) { nextPanelActivity = undefined; pendingPanelActivity = kind; }
          activeTabGroup = group;
          for (const listener of viewChanged) listener();
          // The current renderer reports native delivery; its commit cannot supply missing document focus.
          emit({ type: 'codebook-focus-receipt', phase: 'focused', requestId: message.requestId, epoch, focused: innerFocusedPanel === kind });
          if (held) {
            held.entered();
            void held.wait.then(() => { pendingPanelActivity = undefined; for (const listener of viewChanged) listener(); });
          }
        }
        return true;
      }
      postedMessages.push(message);
      const held = heldPresentationMessage;
      if (held && kind === 'codebook.studyContext' && message.presentation?.state === 'applying' && (!held.mode || message.presentation.mode === held.mode)) {
        held.entered(); await held.wait;
        if (heldPresentationMessage === held) heldPresentationMessage = undefined;
      }
      if ((automaticContextReceipt || message.presentation?.state === 'applying') && kind === 'codebook.studyContext' && message.type === 'study' && !message.loading) {
        emit({ type: 'rendered', revision: message.revision, itemId: message.model.selection.itemId, snapshotUri: message.model.observation?.snapshotUri, presentationControlRevision: message.presentation?.presentationControlRevision, presentationMode: message.presentation?.mode, ...(message.recording ? { presentationRevision: message.recording.presentationRevision } : {}) });
      }
      return true;
    }, onDidReceiveMessage: (callback: (message: unknown) => void) => { messageListeners.add(callback); receivers.set(kind, message => { for (const listener of messageListeners) listener(message); }); return { dispose() { messageListeners.delete(callback); } }; } }, kind, get nativeTab() { return nativeTab; }, emit, viewColumn, title: _title ?? '',
    /** Models a host model resync for registration tests while preserving the actual panel/tab relation. @example panel.refreshTabWrapper() */
    refreshTabWrapper() {
      const previous = nativeTab; nativeTab = { ...nativeTab };
      // Only the API wrapper changes; the native tab, selected group and panel lifetime remain the same.
      for (const group of groups) {
        group.tabs = group.tabs.map(tab => tab === previous ? nativeTab : tab);
        if (group.activeTab === previous) group.activeTab = nativeTab;
      }
    }, get active() { return !registered || pendingPanelActivity !== kind && !separateEditorPart?.focused && activeTabGroup.activeTab === nativeTab; }, get visible() { return !registered || groups.some(group => group.activeTab === nativeTab); }, reveal(column?: number, preserveFocus?: boolean) {
      panelReveals.push({ kind, column, preserveFocus });
      const previousColumn = value.viewColumn, previousFocusedGroup = activeTabGroup;
      if (column !== undefined) value.viewColumn = nativeReaderColumn(column);
      if (column !== undefined && previousColumn !== column && nextMovedPanelLayout) { editorLayout = nextMovedPanelLayout; nextMovedPanelLayout = undefined; }
      {
        for (const group of groups) { group.tabs = group.tabs.filter(tab => tab !== nativeTab); if (group.activeTab === nativeTab) group.activeTab = undefined; }
        const group = nativeGroup(value.viewColumn ?? 1);
        if (nativeLayout && previousColumn !== value.viewColumn && group.activeTab?.isPreview) { const replaced = [...panels].find(panel => panel.nativeTab === group.activeTab); replaced?.dispose(); }
        group.tabs.push(nativeTab); group.activeTab = nativeTab;
        if (column !== undefined && previousColumn !== column) nativeTab.isPreview = true;
        // Normal editors remove a vacated last-tab group and renumber later main and foreign columns.
        const emptied = groups.find(candidate => candidate !== separateEditorPart?.group && candidate.viewColumn === previousColumn && !candidate.tabs.length);
        if (closeEmptyGroupsOnMove && previousColumn !== value.viewColumn && emptied) {
          automaticallyClosedColumns.push(emptied.viewColumn);
          groups.splice(groups.indexOf(emptied), 1);
          for (const remaining of groups) if (remaining.viewColumn > emptied.viewColumn) remaining.viewColumn--;
          for (const retained of panels) retained.viewColumn = groups.find(candidate => candidate.tabs.includes(retained.nativeTab))?.viewColumn;
          editorLayout = { orientation: 0, groups: groups.filter(candidate => candidate !== separateEditorPart?.group).map(() => ({})) };
          changedGroups({ opened: [], closed: [emptied], changed: [...groups] });
        }
        if (!preserveFocus) {
          retainDelayedTextFocus(kind);
          if (!suppressNativeInnerFocus && !value.blockInnerFocus) innerFocusedPanel = kind;
          if (separateEditorPart) separateEditorPart.focused = false;
          // Refocusing an already kept Application can echo after the following Context acknowledgement.
          if (pendingKeptFocusEcho && kind === 'codebook.studyContext') {
            const previous = pendingKeptFocusEcho; pendingKeptFocusEcho = undefined;
            setImmediate(() => {
              activeTabGroup = group; for (const listener of viewChanged) listener();
              setImmediate(() => { activeTabGroup = previous; for (const listener of viewChanged) listener(); });
            });
            return;
          }
          if (deferKeptFocusEcho && kind === 'codebook.scopedBrowser' && previousColumn === value.viewColumn && !nativeTab.isPreview) {
            deferKeptFocusEcho = false; pendingKeptFocusEcho = group;
          }
          // Native relocation can refocus the first moved webview after the second move has acknowledged focus.
          if (pendingMovedFocusEcho && kind === 'codebook.studyContext' && previousColumn !== value.viewColumn) {
            const previous = pendingMovedFocusEcho; pendingMovedFocusEcho = undefined;
            setImmediate(() => {
              activeTabGroup = group; for (const listener of viewChanged) listener();
              setImmediate(() => { activeTabGroup = previous; for (const listener of viewChanged) listener(); });
            });
            return;
          }
          if (deferMovedFocusEcho && kind === 'codebook.scopedBrowser' && previousColumn !== value.viewColumn) {
            deferMovedFocusEcho = false; pendingMovedFocusEcho = group;
          }
          // The native primary webview can report focus again after a subsequent Context reveal has already acknowledged focus.
          if (pendingPrimaryFocusEcho && kind === 'codebook.studyContext') {
            const primary = pendingPrimaryFocusEcho; pendingPrimaryFocusEcho = undefined;
            setImmediate(() => {
              activeTabGroup = group; for (const listener of viewChanged) listener();
              setImmediate(() => { activeTabGroup = primary; for (const listener of viewChanged) listener(); });
            });
            return;
          }
          // Native webview reveal returns before its focus notification reaches the extension host.
          if (deferredPanelFocus?.kind === kind && --deferredPanelFocus.remaining === 0) {
            deferredPanelFocus = undefined;
            setImmediate(() => { activeTabGroup = group; for (const listener of viewChanged) listener(); });
          } else activeTabGroup = group;
        }
        // Native tab movement can precede the panel's column receipt; focus changes only when requested.
        if (previousColumn !== value.viewColumn && deferredMovedPanelPlacement === kind) {
          deferredMovedPanelPlacement = undefined;
          const destination = value.viewColumn; value.viewColumn = previousColumn;
          if (!preserveFocus) activeTabGroup = previousFocusedGroup;
          setImmediate(() => { value.viewColumn = destination; if (!preserveFocus) activeTabGroup = group; for (const listener of viewChanged) listener(); });
        }
        for (const listener of viewChanged) listener();
      }
      if (contextCoversSource && kind === 'codebook.studyContext') groups[0]!.activeTab = undefined;
    }, onDidDispose(callback: () => void) { disposed.push(callback); return { dispose() { const index = disposed.indexOf(callback); if (index >= 0) disposed.splice(index, 1); } }; }, notifyViewState() { for (const listener of viewChanged) listener(); }, viewListenerCount: () => viewChanged.length, onDidChangeViewState(callback: () => void) { viewChanged.push(callback); return { dispose() { const index = viewChanged.indexOf(callback); if (index >= 0) viewChanged.splice(index, 1); } }; }, dispose() { if (!panels.delete(value)) return; for (const group of groups) { group.tabs = group.tabs.filter(tab => tab !== nativeTab); if (group.activeTab === nativeTab) group.activeTab = undefined; } for (const listener of disposed) listener(); } };
    // Both hosts initialize optimistic panel flags before the native tab/view-state acknowledgement arrives.
    const register = () => { registered = true; const group = nativeGroup(value.viewColumn ?? 1); if (!group.tabs.includes(nativeTab)) group.tabs.push(nativeTab); group.activeTab = nativeTab; };
    if (registered) register();
    else {
      delayedPanelKind = undefined; registerDelayedPanel = register;
      if (deferredPanelRegistration) { deferredPanelRegistration = false; setImmediate(register); }
    }
    panels.add(value); peakPanels = Math.max(peakPanels, panels.size);
    const created = nextPanelCreated; if (created?.kind === kind) { nextPanelCreated = undefined; created.run(value); }
    return value;
  }
  const initialSelection: string[] = [];
  let outlineCheckbox = (_event: { items: [string, number][] }) => {};
  let outlineItem = (_itemId: string): { checkboxState?: number; description?: string; command?: unknown } => ({});
  const outline = { ...disposable(), visible: true, selection: initialSelection, onDidChangeCheckboxState: (callback: typeof outlineCheckbox) => { outlineCheckbox = callback; return disposable(); }, onDidChangeVisibility: disposable,
    reveal: async (participant: string, options: { select: boolean; focus: boolean }) => { assert.equal(options.focus, false); if (options.select) outline.selection = [participant]; } };
  const watcher = { onDidChange(callback: () => void) { changed = callback; return disposable(); }, onDidCreate: disposable, onDidDelete: disposable, dispose() {} };
  const viewportEvents: string[] = [], viewportInstances: WorkspaceViewport[] = [];
  /** Models the leased renderer contract so workspace tests fail when retirement precedes transfer. @example reader.presentation.createViewport('run', record, fail, 'normal') */
  class WorkspaceViewport {
    panel: ReturnType<typeof panel>;
    historical = false;
    private held = false;
    private closed = false;
    private rendererAttached = true;
    private listener?: { dispose(): void };
    constructor(_runId: string, readonly record: (type: string, detail?: unknown) => unknown, private readonly fail: (reason: string) => void, _scenario: unknown,
      private readonly lease: { panel: ReturnType<typeof panel>; released(): void }, _observer?: unknown, readonly mode = 'live') {
      this.panel = lease.panel; viewportInstances.push(this); this.bind();
    }
    /** Tracks only the current simulated renderer so old disposal exposes a missing rebind. @example this.bind() */
    private bind() {
      const current = this.panel;
      this.listener = current.onDidDispose(() => {
        if (this.panel !== current || this.closed) return;
        this.closed = true; viewportEvents.push(`unexpected-close:${this.mode}`); this.fail('Owned viewport closed before cleanup');
      });
    }
    /** Refuses renderer use after genuine native closure during replay integration. @example await viewport.reveal() */
    async reveal() { assert.equal(this.closed, false); this.rendererAttached = true; viewportEvents.push(`reveal:${this.mode}`); }
    /** Marks selected live presentation without starting another runtime. @example await viewport.showLive() */
    async showLive() { this.historical = false; this.rendererAttached = true; }
    /** Retains the hidden live lease while the workspace reads recorded evidence. @example viewport.showHistory() */
    showHistory(html: string) { this.historical = true; this.panel.webview.html = html; }
    /** Ends this simulated lease during workspace cleanup, using its original release callback. @example viewport.close() */
    close() { this.listener?.dispose(); this.closed = true; this.lease.released(); }
    /** Reserves the simulated renderer so workspace tests enforce drain before adoption. @example const release = await viewport.holdPlacement() */
    async holdPlacement() { assert.equal(this.closed, false); assert.equal(this.held, false); this.held = true; viewportEvents.push(`hold:${this.mode}`); return () => { this.held = false; viewportEvents.push(`release:${this.mode}`); }; }
    /** Exposes retirement ordering bugs by requiring the current placement hold. @example viewport.rebindPanel(replacement) */
    rebindPanel(replacement: ReturnType<typeof panel>) { assert.equal(this.held, true); assert.equal(this.closed, false); this.listener?.dispose(); this.panel = replacement; this.rendererAttached = false; this.bind(); viewportEvents.push(`rebind:${this.mode}`); }
    /** Confirms that selected pixels restore outside the native placement hold. @example await viewport.restorePlacement() */
    async restorePlacement() { assert.equal(this.held, false); assert.equal(this.closed, false); this.rendererAttached = true; viewportEvents.push(`restore:${this.mode}`); }
    /** Clears unavailable recorded pixels for playback readiness tests. @example viewport.clearRecorded() */
    clearRecorded() { displayedImage = undefined; }
    /** Delays only the requested replay image so workspace tests can interrupt pending paints. @example await viewport.present(png) */
    async present(image: string) { assert.equal(this.rendererAttached, true, 'Webview is not ready'); const held = nextImage; nextImage = undefined; if (held) { held.entered(); await held.wait; } displayedImage = image; }
    /** Models a confirmed missing-frame interval without retaining previous pixels. @example await viewport.presentMissing() */
    async presentMissing() { assert.equal(this.rendererAttached, true, 'Recorded viewport is not ready'); displayedImage = undefined; }
  }
  /** Resolves displayed URIs through the fake workspace loader so native source tabs keep real document text. @example (await openSourceDocument(Uri.file(path))).getText() */
  const openSourceDocument = async (uri: Uri) => {
    const held = nextOpen; nextOpen = undefined; if (held) { held.entered(); await held.wait; }
    if (sourceOpenFailure && uri.scheme !== 'file') throw new Error('Injected current source open failure');
    const text = uri.scheme === 'file' ? await readFile(uri.fsPath, 'utf8') : await sourceProvider(uri), normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    return { uri, getText: () => normalized, validatePosition: (position: Position) => { const lines = normalized.split('\n'), line = Math.min(position.line, lines.length - 1); return new Position(line, Math.min(position.character, lines[line]!.length)); } };
  };
  const summaryListeners = new Set<(message: unknown) => void>();
  const summaryVisibilityListeners = new Set<() => void>();
  const summary = {
    visible: false,
    webview: {
      options: {}, html: '',
      onDidReceiveMessage(callback: (message: unknown) => void) { summaryListeners.add(callback); return { dispose() { summaryListeners.delete(callback); } }; },
      async postMessage(message: StudyViewMessage) {
        postedMessages.push(message);
        if (summary.visible && automaticContextReceipt && message.type === 'study' && !message.loading) {
          for (const listener of summaryListeners) listener({ type: 'rendered', revision: message.revision, itemId: message.model.selection.itemId, snapshotUri: message.model.observation?.snapshotUri, presentationRevision: message.recording?.presentationRevision });
        }
        return true;
      },
    },
    onDidDispose: disposable,
    onDidChangeVisibility(callback: () => void) { summaryVisibilityListeners.add(callback); return { dispose() { summaryVisibilityListeners.delete(callback); } }; },
  };
  const playbackPanelMessages: StudyViewMessage[] = [];
  const playbackPanelListeners = new Set<(message: unknown) => void>();
  const playbackPanelVisibilityListeners = new Set<() => void>();
  const playbackPanelDisposeListeners = new Set<() => void>();
  const playbackPanel = {
    visible: false,
    webview: { options: {}, html: '',
      onDidReceiveMessage(callback: (message: unknown) => void) { playbackPanelListeners.add(callback); return disposable(); },
      async postMessage(message: StudyViewMessage) { playbackPanelMessages.push(message); return true; },
    },
    onDidDispose(callback: () => void) { playbackPanelDisposeListeners.add(callback); return disposable(); },
    onDidChangeVisibility(callback: () => void) { playbackPanelVisibilityListeners.add(callback); return disposable(); },
  };
  let playbackPanelProvider: { resolveWebviewView(view: typeof playbackPanel): void | Promise<void> } | undefined;
  let playbackPanelResolved = false;
  let summaryProvider: { resolveWebviewView(view: typeof summary): void | Promise<void> } | undefined;
  let summaryResolved = false;
  const editorDependencies = {
    vscode: { EventEmitter, Uri, TabInputText, TabInputWebview, TreeItem: class {}, TreeItemCollapsibleState: { None: 0 }, TreeItemCheckboxState: { Unchecked: 0, Checked: 1 }, Position, Range, ViewColumn: { One: 1, Two: 2, Three: 3 }, TextEditorRevealType: { Default: 0, AtTop: 3 }, ThemeColor: class {}, RelativePattern,
      commands: { async executeCommand(name: string, layout?: unknown): Promise<unknown> {
        if (name === 'codebook.observedMoments.focus') {
          assert.ok(playbackPanelProvider); playbackPanel.visible = true;
          if (!playbackPanelResolved) { playbackPanelResolved = true; await playbackPanelProvider.resolveWebviewView(playbackPanel); }
          for (const listener of playbackPanelVisibilityListeners) listener();
        }
        if (name === 'codebook.learningSummary.focus') {
          assert.ok(summaryProvider); summary.visible = true;
          if (!summaryResolved) { summaryResolved = true; await summaryProvider.resolveWebviewView(summary); }
          for (const listener of summaryVisibilityListeners) listener();
        }
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
        if (name === 'workbench.action.minimizeOtherEditors') {
          maximizedEditorGroup = false;
          // Native Expand also changes group proportions while exiting maximization.
          const layout = structuredClone(editorLayout);
          if (layout && typeof layout === 'object' && 'groups' in layout && Array.isArray(layout.groups) && layout.groups.length > 1) {
            for (const [index, group] of layout.groups.entries()) if (group && typeof group === 'object') group.size = index === 0 ? 0.8 : 0.2 / (layout.groups.length - 1);
            editorLayout = layout;
          }
        }
        if (name === 'workbench.action.toggleMaximizeEditorGroup') maximizedEditorGroup = !maximizedEditorGroup;
        if (name === 'workbench.action.maximizeEditorHideSidebar') maximizedEditorGroup = true;
        if (name === 'workbench.action.focusFirstEditorGroup') {
          const previousEditor = focusedSourceEditor(), previousGroup = activeTabGroup, primaryGroup = groups.find(group => group.viewColumn === 1)!;
          const primaryEditor = visibleSourceEditors.find(editor => editor.group === primaryGroup);
          // Native text and tab-group notifications have no cross-event ordering guarantee.
          if (primaryNotificationOrder === 'editor first') { partialFocusEditor = { value: primaryEditor }; activeTextEditorChanged(primaryEditor); }
          if (primaryNotificationOrder === 'group first') partialFocusEditor = { value: previousEditor };
          activeTabGroup = primaryGroup;
          if (deferPrimaryFocusEcho) pendingPrimaryFocusEcho = activeTabGroup;
          if (separateEditorPart) separateEditorPart.focused = false;
          if (primaryNotificationOrder !== 'together') changedGroups({ opened: [], closed: [], changed: [previousGroup, primaryGroup] });
          partialFocusEditor = undefined; activeTextEditorChanged(primaryEditor);
          // The command effect may precede its RPC response; newer learner input must not become the operation's baseline.
          const response = nextPrimaryFocusResponse; nextPrimaryFocusResponse = undefined;
          if (response) { response.entered(); await response.wait; }
        }
        if (name === 'vscode.getEditorLayout') {
          if (asynchronousLayoutReads) await new Promise<void>(resolve => setImmediate(resolve));
          if (hideGridWhileMaximized && maximizedEditorGroup) return undefined;
          const layout = JSON.parse(JSON.stringify(separateEditorPart?.focused ? separatePartLayoutReport ?? separateEditorPart.layout : editorLayout, (key, value) => key === 'groups' && Array.isArray(value) ? value.map(group => ({ size: 1, ...group })) : value));
          // The accepted grid settles without a second mutation; its first read can still contain native transient pixels.
          if (settlementPending) { editorLayout = structuredClone(settledLayout); settlementPending = false; }
          return layout;
        }
        if (name === 'vscode.setEditorLayout') {
          explicitEditorLayout = true;
          maximizedEditorGroup = false;
          // The public layout command changes the active part even while TabGroups still reports the old main active group.
          if (separateEditorPart?.focused) { separateEditorPart.layout = structuredClone(layout); return; }
          settledLayout = constrainStudyGrid && nativeGroupCount(layout) === 3
            ? { orientation: 0, groups: [{ size: 220, groups: [{ size: 70 }, { size: 70 }] }, { size: 220 }] } : structuredClone(layout);
          editorLayout = transientLayout ? { orientation: 0, groups: [{ size: 0.5, groups: [{ size: 0.5 }, { size: 475.83333333333326 }] }, { size: 659.5 }] } : structuredClone(settledLayout);
          settlementPending = transientLayout;
          if (nativeLayout) {
            const count = nativeGroupCount(layout);
            for (let column = 1; column <= count; column++) nativeGroup(column, true);
            let removed = groups.filter(group => group !== separateEditorPart?.group && group.viewColumn > count);
            // Preserve the old wrappers' pre-merge tabs so exact-equality matching cannot pass accidentally.
            if (cursorGroupWrappers && removed.length) {
              groups.splice(0, groups.length, ...groups.filter(group => group === separateEditorPart?.group || cursorTwoEventContraction || group.viewColumn <= count).map(group => group === separateEditorPart?.group ? group : ({ ...group, tabs: [...group.tabs] })));
              if (cursorTwoEventContraction) removed = groups.filter(group => group !== separateEditorPart?.group && group.viewColumn > count);
            }
            const destination = nativeGroup(count);
            for (const group of removed) { destination.tabs.push(...group.tabs); if (group.activeTab) destination.activeTab = group.activeTab; for (const view of panels) if (group.tabs.includes(view.nativeTab)) view.viewColumn = count; }
            // Cursor first reports copied tabs in both groups, then closes the emptied source group in a second wrapper resync.
            if (cursorTwoEventContraction && removed.length) {
              changedGroups({ opened: [], closed: [], changed: [...groups] });
              for (const group of removed) { group.tabs = []; group.activeTab = undefined; }
              groups.splice(0, groups.length, ...groups.filter(group => group === separateEditorPart?.group || group.viewColumn <= count).map(group => group === separateEditorPart?.group ? group : ({ ...group, tabs: [...group.tabs] })));
            }
            if (sourceColumn > count) sourceColumn = count;
            groups.splice(0, groups.length, ...groups.filter(group => group === separateEditorPart?.group || group.viewColumn <= count));
            if (separateEditorPart) separateEditorPart.group.viewColumn = count + 1;
            if (removed.length) changedGroups({ opened: [], closed: removed, changed: cursorGroupWrappers ? [...groups] : [destination] });
          } else {
            const opened: typeof groups = [];
            for (const column of [1, 3]) if (!groups.some(group => group.viewColumn === column)) { const group = { viewColumn: column, tabs: [] }; groups.push(group); opened.push(group); }
            if (opened.length) changedGroups({ opened, closed: [], changed: [] });
          }
        }
        // Native layout is already accepted before its delayed RPC response reaches the extension.
        if (name === 'vscode.setEditorLayout') { const response = nextLayoutResponse; nextLayoutResponse = undefined; if (response) { response.entered(); await response.wait; } }
        if (name === 'workbench.action.evenEditorWidths') editorLayout = structuredClone(settledLayout);
      } },
      StatusBarAlignment: { Right: 2 }, window: { createStatusBarItem: () => saveStatus, state: windowState, onDidChangeWindowState: (callback: (state: typeof windowState) => void) => { windowListeners.add(callback); return { dispose() { windowListeners.delete(callback); } }; }, get activeTextEditor() { return focusedSourceEditor(); }, showQuickPick: async () => undefined, createTextEditorDecorationType: disposable, createTreeView: (_id: string, options: { treeDataProvider: { getTreeItem: typeof outlineItem } }) => { outlineItem = options.treeDataProvider.getTreeItem; return outline; }, registerWebviewViewProvider: (id: string, provider: typeof summaryProvider) => { if (id === 'codebook.observedMoments') playbackPanelProvider = provider; if (id === 'codebook.learningSummary') { summaryProvider = provider; summaryResolved = false; summaryListeners.clear(); summaryVisibilityListeners.clear(); } return disposable(); }, onDidChangeActiveTextEditor: (callback: typeof activeTextEditorChanged) => { activeEditorListeners.add(callback); return { dispose() { activeEditorListeners.delete(callback); } }; }, onDidChangeTextEditorSelection: (callback: () => void) => { selectionListeners.add(callback); return { dispose() { selectionListeners.delete(callback); } }; }, createWebviewPanel: panel,
        get visibleTextEditors() { return visibleSourceEditors.filter(editor => editor.group.activeTab?.input instanceof TabInputText && editor.group.activeTab.input.uri.toString() === editor.document.uri.toString()); },
        showTextDocument: async (document: Uri | { uri: Uri; getText(): string }, options?: { viewColumn: number; preserveFocus?: boolean; preview?: boolean; selection?: Range }) => {
          const sourceDocument = document instanceof Uri ? await openSourceDocument(document) : document;
          sourceColumn = options?.viewColumn === undefined ? sourceColumn : nativeReaderColumn(options.viewColumn);
          const group = groups.find(candidate => candidate.viewColumn === sourceColumn) ?? groups[0]!, tab = group.tabs.find(tab => tab.input instanceof TabInputText && tab.input.uri.toString() === sourceDocument.uri.toString()) ?? { input: new TabInputText(sourceDocument.uri) };
          if (!group.tabs.includes(tab)) group.tabs.push(tab); group.activeTab = tab;
          if (!options?.preserveFocus) { activeTabGroup = group; innerFocusedPanel = undefined; if (separateEditorPart) separateEditorPart.focused = false; }
          if (options?.preview !== undefined) tab.isPreview = options.preview;
          const editor = sourceEditor(sourceDocument, group, reportedSourceColumn);
          const previous = visibleSourceEditors.find(value => value.group === group && value.document.uri.toString() === sourceDocument.uri.toString());
          // Revealing an existing native document without a selection keeps its learner cursor.
          if (!options?.selection && previous) editor.selections = previous.selections;
          // An explicit native selection reveals its statement even when playback reopens the same document.
          if (options?.selection) { editor.selections = [{ active: options.selection.start, anchor: options.selection.start }]; scrollReadingRange(options.selection); }
          // Native wrappers share selection state, while the deliberate stale-column control keeps its returned wrapper separate.
          const previousIndex = visibleSourceEditors.findIndex(value => value.group === group && value.document.uri.toString() === sourceDocument.uri.toString());
          if (previousIndex >= 0) visibleSourceEditors.splice(previousIndex, 1);
          const visible = Object.assign(sourceEditor(sourceDocument, group), { group });
          Object.defineProperty(visible, 'selections', { get: () => editor.selections, set: (selections: SourceEditor['selections']) => { editor.selections = selections; for (const listener of selectionListeners) listener(); } });
          visibleSourceEditors.push(visible);
          if (!options?.preserveFocus) activeTextEditorChanged(focusedSourceEditor());
          const displayed = nextSourceDisplay; nextSourceDisplay = undefined; displayed?.(editor);
          return lastSourceEditor = editor;
        },
        tabGroups: { all: groups, get activeTabGroup() { return activeTabGroup; }, onDidChangeTabs: (callback: (event: TabChanges) => void) => { const notify = (event: TabChanges = { opened: [], closed: [], changed: [] }) => callback(event); tabChangeListeners.add(notify); return { dispose() { tabChangeListeners.delete(notify); } }; }, onDidChangeTabGroups: (callback: typeof changedGroups) => { groupChangeListeners.add(callback); return { dispose() { groupChangeListeners.delete(callback); } }; }, close: async (tabs: Tab[]) => { for (const group of groups) group.tabs = group.tabs.filter(tab => !tabs.includes(tab)); return true; } } },
      workspace: { getConfiguration: (section: string) => ({ get: (key: string) => section === 'codebook' && key === 'savedStudyLimit' ? savedStudyCapacity : undefined }), textDocuments, registerTextDocumentContentProvider: (_scheme: string, provider: { provideTextDocumentContent(uri: Uri): Promise<string> }) => { sourceProvider = provider.provideTextDocumentContent; return disposable(); },
        openTextDocument: openSourceDocument,
        onDidChangeTextDocument: disposable, createFileSystemWatcher: (pattern: RelativePattern) => { watchedPatterns.push(pattern); return watcher; } } },
    './environment': { requireWorkspace: () => harness.directory }, './runtimeSupport/browserViewport': { BrowserViewport: WorkspaceViewport },
    './replayDebugger': { ReplayDebugger: TestReplayDebugger },
  };
  const boundary = await loadModule<typeof import('../studyWorkspace')>(resolve(__dirname, '../studyWorkspace.js'), editorDependencies);
  const repositoryBoundary = await loadModule<typeof import('../repositoryReader')>(resolve(__dirname, '../repositoryReader.js'), editorDependencies);
  const articleOpens: RepositorySelection[] = [], articleReturns: RepositorySelection[] = [];
  const controls = { start: async () => harness.service, connect: async () => {}, returnToRepository: async (selection: RepositorySelection) => { articleReturns.push(selection); }, openArticle: async (selection: RepositorySelection) => { articleOpens.push(selection); } };
  const presentationPreferences = new Map<string, unknown>();
  let preferenceFailure = false;
  let nextPreference: { wait: Promise<void>; entered(): void } | undefined;
  const workspaceState = { get: <Value>(key: string) => presentationPreferences.get(key) as Value | undefined,
    update: async (key: string, value: unknown) => { const held = nextPreference; nextPreference = undefined; held?.entered(); await held?.wait; if (preferenceFailure) throw new Error('Injected preference failure'); presentationPreferences.set(key, structuredClone(value)); } };
  const createReader = (extensionPath = join(harness.directory, 'extension')) => new boundary.StudyWorkspace({ extensionPath, globalStorageUri: { fsPath: join(harness.directory, 'storage') }, subscriptions: [], workspaceState }, controls);
  const reader = createReader();
  if (attach) { await reader.attach(harness.service); await reader.action('return-current'); }
  return { ...harness, playbackPanel, playbackPanelMessages, hidePlaybackPanel() { playbackPanel.visible = false; for (const listener of playbackPanelVisibilityListeners) listener(); }, disposePlaybackPanel() { for (const listener of playbackPanelDisposeListeners) listener(); }, receivePlaybackPanel(message: unknown) { for (const listener of playbackPanelListeners) listener(message); }, async resolveRestoredObservedMoments() { assert.ok(playbackPanelProvider); await playbackPanelProvider.resolveWebviewView(playbackPanel); }, summary, hideSummary() { summary.visible = false; for (const listener of summaryVisibilityListeners) listener(); }, setSavedStudyCapacity(value: unknown) { savedStudyCapacity = value; }, saveStatus, reader, createReader, groups, controls, outline, commands, articleOpens, articleReturns, receiveContext: (message: unknown) => receivers.get('codebook.studyContext')!(message), receive: (message: unknown) => { if (reader.inspect().view?.contentTab === 'recording') { for (const listener of summaryListeners) listener(message); } else receivers.get('codebook.studyContext')!(message); }, counts: () => ({ panels: panels.size, outlineUpdates }), peakPanels: () => peakPanels, onNextPanel(kind: string, run: (value: ReturnType<typeof panel>) => void) { nextPanelCreated = { kind, run }; }, failNextPanelCreation(kind: string) { failedPanelKind = kind; }, changed: () => changed(),
    retainReadingRange(first: number, last: number) { retainedReadingRange = new Range(new Position(first, 0), new Position(last, 0)); },
    /** Models a learner selecting source during native placement, letting preservation tests inspect the retained cursor. @example harness.changeFocusedSourceSelection(46).selections[0].active.line // 46 */
    changeFocusedSourceSelection(line: number) {
      const editor = lastSourceEditor; assert.ok(editor);
      const selection = [{ anchor: new Position(line, 0), active: new Position(line, 0) }]; editor.selections = selection;
      // Native wrappers for the same visible document share the changed selection.
      for (const visible of visibleSourceEditors) if (visible.group === activeTabGroup && visible.document.uri.toString() === editor.document.uri.toString()) visible.selections = selection;
      return editor;
    },
    isReadingLineVisible(line: number) { return retainedReadingRange?.contains(new Position(line, 0)); },
    outlineItem: (itemId: string) => outlineItem(itemId), changeOutlineCheckbox: (itemId: string, checked: boolean) => outlineCheckbox({ items: [[itemId, checked ? 1 : 0]] }),
    postedMessages: () => postedMessages, presentationPreferences, watchedPatterns, viewportEvents, viewportInstances, nativePanels: () => [...panels], maximizedEditorGroup: () => maximizedEditorGroup,
    historicalDebugPresentations, historicalDebuggers, historicalDebugInvalidations: () => historicalDebugInvalidations, readCapturedSource: (uri: string) => {
      const parsed = new URL(uri); return sourceProvider(new Uri(parsed.protocol.slice(0, -1), parsed.host, parsed.pathname, parsed.search, parsed.hash));
    },
    holdPresentationMessage(mode?: 'living-book') { let entered!: () => void, release!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; }); heldPresentationMessage = { mode, wait, entered }; return { started, release }; },
    failPresentationPreference(value: boolean) { preferenceFailure = value; },
    holdPresentationPreference() { let entered!: () => void, release!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; }); nextPreference = { wait, entered }; return { started, release }; },
    clock(value: number) { clock = value; }, acknowledgeContext() { automaticContextReceipt = true; }, displayedImage: () => displayedImage,
    coverSourceWhenContextFocused() { contextCoversSource = true; },
    panelColumn: (kind: string) => [...panels].find(panel => panel.kind === kind)?.viewColumn,
    displayedSourceText: (path: string) => visibleSourceEditors.find(editor => editor.document.uri.fsPath === path)?.document.getText(),
    panelReveals: () => [...panelReveals],
    suppressNativeInnerFocus() { suppressNativeInnerFocus = true; innerFocusedPanel = undefined; },
    /** Separates native tab focus from its panel notification for presentation ownership tests. @example const held = harness.holdPanelActivity('codebook.scopedBrowser'); await held.started; held.release(); */
    holdPanelActivity(kind: string) {
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
      nextPanelActivity = { kind, wait, entered }; return { started, release };
    },
    /** Delivers Cursor's delayed source deactivation after a handoff reads the stale receipt. @example const held = harness.holdTextFocusClear('codebook.studyContext'); await held.observed; held.release(); */
    holdTextFocusClear(kind: string) {
      let inspected!: () => void, release!: () => void;
      const observed = new Promise<void>(resolve => { inspected = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
      nextTextFocusClear = { kind, wait, observed: inspected }; return { observed, release };
    },
    innerFocusedPanel: () => innerFocusedPanel,
    changeWindowFocus(focused: boolean) { windowState.focused = focused; for (const listener of windowListeners) listener(windowState); },
    windowFocusListeners: () => windowListeners.size,
    delayPanelRegistration(kind: string, deferred = false) { delayedPanelKind = kind; deferredPanelRegistration = deferred; asynchronousLayoutReads ||= deferred; return () => registerDelayedPanel(); },
    deferPanelFocus(kind: string, reveal: number) { deferredPanelFocus = { kind, remaining: reveal }; asynchronousLayoutReads = true; },
    deferPrimaryFocusEcho() { deferPrimaryFocusEcho = true; asynchronousLayoutReads = true; },
    deferMovedFocusEcho() { deferMovedFocusEcho = true; asynchronousLayoutReads = true; },
    deferKeptFocusEcho() { deferKeptFocusEcho = true; asynchronousLayoutReads = true; },
    deferMovedPanelPlacement(kind: string) { deferredMovedPanelPlacement = kind; asynchronousLayoutReads = true; },
    focusedPanel: () => activeTabGroup.activeTab?.input instanceof TabInputWebview ? activeTabGroup.activeTab.input.viewType : undefined,
    /** Opens a modeled webview tab in the requested group so cold entry can preserve chat-like focus. @example const wiki = harness.openWiki(1); */
    openWiki(column = 2) { const wiki = panel('codebook.repositoryWiki', 'Repository Wiki', { viewColumn: column, preserveFocus: true }); wiki.reveal(undefined, false); return wiki; },
    /** Emits a tab-only learner change so registration tests cannot rely on a text-editor notification. @example harness.focusExistingWebviewTab(wiki.nativeTab); */
    focusExistingWebviewTab(tab: Tab) { const group = groups.find(group => group.tabs.includes(tab)); assert.ok(group); assert.ok(tab.input instanceof TabInputWebview); group.activeTab = tab; activeTabGroup = group; for (const listener of tabChangeListeners) listener(); },
    /** Emits real close/open membership changes so cold-focus tests distinguish replacement from wrapper refresh. @example harness.replaceActiveWebviewTab(); */
    replaceActiveWebviewTab() { const previous = activeTabGroup.activeTab; assert.ok(previous?.input instanceof TabInputWebview); const replacement = { ...previous, input: new TabInputWebview(previous.input.viewType) }; activeTabGroup.tabs = activeTabGroup.tabs.map(tab => tab === previous ? replacement : tab); activeTabGroup.activeTab = replacement; for (const listener of tabChangeListeners) listener({ opened: [replacement], closed: [previous], changed: [] }); return replacement; },
    focusedSource: focusedSourceEditor,
    focusListenerCount: () => activeEditorListeners.size + selectionListeners.size + tabChangeListeners.size + groupChangeListeners.size + [...panels].reduce((count, panel) => count + panel.viewListenerCount(), 0),
    retainRepositoryFocus: repositoryBoundary.RepositoryReader.prototype['retainNativeFocus'],
    /** Splits a native primary-focus handoff across actual event surfaces for cold Wiki integration tests. @example harness.usePrimaryFocusNotificationOrder('group first') */
    usePrimaryFocusNotificationOrder(order: typeof primaryNotificationOrder) { primaryNotificationOrder = order; },
    /** Models early panel notifications followed by same-group tab departure/reentry during a held response. @example harness.roundtripExistingPanelTab('codebook.studyContext', draft); */
    roundtripExistingPanelTab(kind: string, tab: Tab) {
      const panel = [...panels].find(candidate => candidate.kind === kind); assert.ok(panel);
      const group = groups.find(candidate => candidate.tabs.includes(panel.nativeTab)); assert.ok(group); assert.ok(group.tabs.includes(tab));
      panel.notifyViewState(); group.activeTab = tab;
      for (const listener of tabChangeListeners) listener();
      group.activeTab = panel.nativeTab;
      for (const listener of tabChangeListeners) listener();
      panel.notifyViewState();
    },
    /** Models a learner returning to an existing source during a held presentation response. @example harness.focusExistingSource(source); */
    focusExistingSource(editor: SourceEditor) {
      const group = groups.find(candidate => candidate.tabs.some(tab => tab.input instanceof TabInputText && tab.input.uri.toString() === editor.document.uri.toString())); assert.ok(group);
      group.activeTab = group.tabs.find(tab => tab.input instanceof TabInputText && tab.input.uri.toString() === editor.document.uri.toString()); activeTabGroup = group;
      innerFocusedPanel = undefined; activeTextEditorChanged(editor); changedGroups({ opened: [], closed: [], changed: [group] });
    },
    movePanel(kind: string, column: number) { const panel = [...panels].find(panel => panel.kind === kind); assert.ok(panel); panel.reveal(column); },
    /** Mirrors a native group reorder including each contained panel's new column, before an explicit Arrange request. @example harness.swapEditorGroups(sourceGroup, contextGroup) */
    swapEditorGroups(first: typeof activeTabGroup, second: typeof activeTabGroup) {
      [first.viewColumn, second.viewColumn] = [second.viewColumn, first.viewColumn];
      for (const panel of panels) panel.viewColumn = groups.find(group => group.tabs.includes(panel.nativeTab))?.viewColumn;
      changedGroups({ opened: [], closed: [], changed: [first, second] });
    },
    sourceColumn: () => sourceColumn,
    restoreSourceFocusOnArrange() { sourceFocusOnArrange = lastSourceEditor; },
    reportSourceEditorInColumn(column: number) { reportedSourceColumn = column; },
    invalidateNextSourceRender() { nextSourceDisplay = () => { reader['revision']++; }; },
    failCurrentSourceOpen() { sourceOpenFailure = true; },
    restoreCurrentSourceOpen() { sourceOpenFailure = false; },
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
    editorLayout: () => structuredClone(editorLayout), changeEditorLayout(layout: unknown) { explicitEditorLayout = true; editorLayout = structuredClone(layout); },
    flattenOnNextPanelMove(layout: unknown) { nextMovedPanelLayout = structuredClone(layout); },
    closeEmptyGroupsAfterPanelMove() { closeEmptyGroupsOnMove = true; },
    automaticallyClosedColumns: () => [...automaticallyClosedColumns],
    useCursorGroupWrappers(twoEventContraction = false) { cursorGroupWrappers = true; cursorTwoEventContraction = twoEventContraction; },
    useNativeLayout(layout: unknown) {
      nativeLayout = true; separateEditorPart = undefined; const previous = [...groups]; groups.splice(0); editorLayout = structuredClone(layout);
      for (let column = 1; column <= nativeGroupCount(layout); column++) nativeGroup(column, true);
      groups[0]!.tabs.push({ input: new TabInputText(Uri.file(join(harness.directory, 'article-source.ts'))) });
      groups[1]?.tabs.push({ input: new TabInputWebview('codebook.repositoryWiki') });
      activeTabGroup = groups[0]!; activeTabGroup.activeTab = activeTabGroup.tabs[0];
      changedGroups({ opened: [...groups], closed: previous, changed: [] });
    },
    constrainStudyGrid() { constrainStudyGrid = true; },
    hideGridWhileMaximized() { hideGridWhileMaximized = true; },
    /** Adds a real separate-part boundary without changing the main leaf count, matching the recorded Cursor probe. @example const chat = harness.addSeparateEditorPart(); chat.focus(); */
    addSeparateEditorPart() {
      assert.equal(nativeLayout, true); assert.equal(separateEditorPart, undefined);
      const chatTab = { input: new TabInputUnknown(), label: 'New Agent', isPreview: false, isDirty: false };
      const group = { viewColumn: groups.length + 1, tabs: [chatTab], activeTab: chatTab };
      separateEditorPart = { group, layout: { orientation: 1, groups: [{ size: 743 }] }, focused: false };
      groups.push(group); changedGroups({ opened: [group], closed: [], changed: [] });
      return { tab: chatTab, layout: () => structuredClone(separateEditorPart?.layout), focused: () => separateEditorPart?.focused, focus() { separateEditorPart!.focused = true; activeTextEditorChanged(undefined); },
        /** Refreshes only the foreign wrapper when presentation tests create a pane; lifecycle and movement remain distinct. @example chat.resync('wrapper') */
        resync(change: 'wrapper' | 'opened' | 'unannounced' | 'move') {
          const previous = separateEditorPart!.group, replacement = { ...previous, tabs: [...previous.tabs] };
          // The unchanged empty chat part is not a new native group; explicit lifecycle events cannot inherit it.
          if (change === 'move') replacement.viewColumn++;
          groups[groups.indexOf(previous)] = replacement; separateEditorPart!.group = replacement;
          changedGroups({ opened: change === 'opened' ? [replacement] : [], closed: change === 'opened' ? [previous] : [], changed: change === 'unannounced' ? [] : [replacement] });
        },
      };
    },
    reportSeparatePartLayout(layout: unknown) { separatePartLayoutReport = structuredClone(layout); },
    showTransientNativeSizes() { transientLayout = true; },
    failNextCommand(name: string) { failingCommand = name; },
    /** Gives presentation/scope regressions a learner-owned document whose edits do not move its tab. @example const draft = harness.focusMutableDraft('notes.txt', 2); draft.replaceContent('new text'); */
    focusMutableDraft(filename = 'mutable-notes.txt', column = groups[0]!.viewColumn) {
      let text = 'Original learner draft.\n';
      const document = { uri: Uri.file(join(harness.directory, filename)), version: 1, getText: () => text };
      const group = groups.find(group => group.viewColumn === column)!;
      const tab = { input: new TabInputText(document.uri), isPreview: false, isDirty: true };
      const editor = Object.assign(sourceEditor(document, group), { group });
      let selections = editor.selections;
      Object.defineProperty(editor, 'selections', { get: () => selections, set: (value: typeof selections) => { selections = value; for (const listener of selectionListeners) listener(); } });
      group.tabs.push(tab); group.activeTab = tab; activeTabGroup = group; visibleSourceEditors.push(editor);
      if (separateEditorPart) separateEditorPart.focused = false;
      activeTextEditorChanged(editor);
      return { document, tab, editor, replaceContent(value: string) { text = value; document.version++; }, focus() {
        group.activeTab = tab; activeTabGroup = group;
        if (separateEditorPart) separateEditorPart.focused = false;
        activeTextEditorChanged(editor);
      } };
    },
    useOpaquePrimary(kind: 'blank' | 'settings') {
      const group = groups.find(group => group.viewColumn === 1)!;
      const tab = kind === 'settings' ? { input: new TabInputUnknown(), label: 'Settings', isPreview: false, isDirty: false } : undefined;
      group.tabs = tab ? [tab] : []; group.activeTab = tab; return tab;
    },
    changeAfterNextSourceDisplay(change: (editor: SourceEditor) => void) { nextSourceDisplay = change; },
    changeAfterNextReadingReveal(change: () => void) { nextReadingReveal = change; },
    addForeignDraft(column = groups[0]!.viewColumn) { const tab = { input: new TabInputText(Uri.file(join(harness.directory, 'notes.txt'))), isDirty: true }; groups.find(group => group.viewColumn === column)!.tabs.push(tab); return tab; },
    addOpaqueTab(label: string, column: number) { const tab = { input: new TabInputUnknown(), label, isPreview: false, isDirty: false }; groups.find(group => group.viewColumn === column)!.tabs.unshift(tab); return tab; },
    addTextPreview(path: string, column: number, dirty = false) { const tab = { input: new TabInputText(Uri.file(path)), isPreview: true, isDirty: dirty }; groups.find(group => group.viewColumn === column)!.tabs.push(tab); return tab; },
    addNodeHistoryPreview(studyId: string, column: number, options: { dirty?: boolean; pinned?: boolean } = {}) {
      const uri = Uri.from({ scheme: 'codebook-source', authority: harness.service.nodeHistoryStore!.workspaceKey,
        path: `/node-history/${studyId}/1/hash/Captured-data.ts` });
      const tab = { input: new TabInputText(uri), isPreview: true, isDirty: Boolean(options.dirty), isPinned: Boolean(options.pinned) };
      groups.find(group => group.viewColumn === column)!.tabs.push(tab);
      return tab;
    },
    resyncEditorGroups(change?: 'move' | 'replace' | 'append' | 'unannounced' | 'remove' | 'reorder' | 'empty', preserveEmpty = false) {
      // Give each fake group a distinct stable input, like the actual singleton panels/native source tabs.
      for (const group of groups) if (!group.tabs.length && change !== 'empty' && !preserveEmpty) group.tabs.push({ input: new TabInputText(Uri.file(`/group-${group.viewColumn}`)) });
      const previous = [...groups];
      groups.splice(0, groups.length, ...groups.map(group => ({ ...group, tabs: group.tabs.map(tab => ({ ...tab, label: 'Recorded application', input: tab.input instanceof TabInputText ? new TabInputText(tab.input.uri) : tab.input instanceof TabInputWebview ? new TabInputWebview(tab.input.viewType) : new TabInputUnknown() })) })));
      // Full-model replacement keeps the same separate part behind its newly reported native wrapper.
      if (separateEditorPart) separateEditorPart.group = groups[previous.indexOf(separateEditorPart.group)]!;
      if (change === 'move') { const first = groups[0]!.tabs; groups[0]!.tabs = groups[1]!.tabs; groups[1]!.tabs = first; }
      if (change === 'append') groups[0]!.tabs.splice(1, 0, { input: new TabInputText(Uri.file('/learner-added-notes.txt')) });
      if (change === 'remove') groups[0]!.tabs.pop();
      if (change === 'reorder') groups[0]!.tabs.reverse();
      changedGroups({ opened: change === 'replace' ? [...groups] : [], closed: change === 'replace' ? previous : [], changed: change === 'unannounced' ? [] : [...groups] });
    },
    /** Models group-wrapper refresh during placement tests while retaining native panel/text ownership. @example harness.replaceEditorGroup('wrapper', 1) */
    replaceEditorGroup(change: 'wrapper' | 'opened' | 'unannounced', column = activeTabGroup.viewColumn, changeTabs?: (tabs: Tab[]) => void) {
      const previous = groups.find(group => group.viewColumn === column); assert.ok(previous);
      const replacement = { ...previous, tabs: [...previous.tabs] };
      changeTabs?.(replacement.tabs);
      groups[groups.indexOf(previous)] = replacement;
      if (activeTabGroup === previous) activeTabGroup = replacement;
      // Text-editor focus survives a wrapper refresh; opened and unannounced groups still require new ownership.
      for (const editor of visibleSourceEditors) if (editor.group === previous) editor.group = replacement;
      changedGroups({ opened: change === 'opened' ? [replacement] : [], closed: change === 'opened' ? [previous] : [], changed: change === 'unannounced' ? [] : [replacement] });
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
    /** Holds only the response after a native split so scope tests can change learner intent. @example const split = harness.holdNextLayoutResponse(); */
    holdNextLayoutResponse() {
      let release = () => {}, entered = () => {};
      const started = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
      nextLayoutResponse = { wait, entered }; return { started, release };
    },
    /** Lets scope regressions insert learner input after primary focus is applied but before its command response. @example const focus = harness.holdNextPrimaryFocusResponse(); */
    holdNextPrimaryFocusResponse() {
      let release = () => {}, entered = () => {};
      const started = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
      nextPrimaryFocusResponse = { wait, entered }; return { started, release };
    },
    holdNextSource() {
      let release = () => {}, reject = (_error: Error) => {}, entered = () => {};
      const started = new Promise<void>(resolve => { entered = resolve; });
      const wait = new Promise<void>((resolve, rejectPromise) => { release = resolve; reject = rejectPromise; });
      nextOpen = { wait, entered }; return { started, release, reject };
    },
    async close() { await reader.retire(harness.service); await reader.dispose(); await harness.close(); } };
}

/** Opens synthetic retained repository evidence for layout tests that need readable source without launching a runtime. @example await openRetainedStudy(harness) */
async function openRetainedStudy(harness: Awaited<ReturnType<typeof workspaceHarness>>) {
  const library = await harness.reader.learningStorage();
  const study = { ...createConfiguredStudy(), workspaceKey: library.workspaceKey };
  await library.saveStudy(study); await harness.reader.open();
  harness.receive({ type: 'history', revision: harness.reader.inspect().view!.revision, studyId: study.id });
  await waitUntil(() => harness.reader.inspect().view!.model.selection.studyId === study.id && !harness.reader.inspect().view!.loading, 'retained repository source', 1_000);
}

test('restored Observed moments leaves its loading state after workspace initialization', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    // Act: VS Code can restore the view before any Codebook command initializes this workspace.
    await harness.resolveRestoredObservedMoments();

    // Assert
    const message = harness.playbackPanelMessages.at(-1);
    assert.ok(message);
    assert.equal(message.type, 'study');
    assert.equal(message.loading, false);
    assert.equal(message.model.currentSourceAvailable, false);
  } finally {
    await harness.close();
  }
});

test('an unreadable Node history folder is reported while the saved-study reader still opens', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    const learningDirectory = join(harness.directory, 'storage', 'learning', harness.service.nodeHistoryStore!.workspaceKey);
    await rm(join(learningDirectory, 'node-tests.v1'), { recursive: true, force: true });
    await mkdir(learningDirectory, { recursive: true });
    await writeFile(join(learningDirectory, 'node-tests.v1'), 'not a history folder');

    // Act
    await harness.reader.open();

    // Assert
    await waitUntil(() => Boolean(harness.reader.inspect().view?.errors.some(error => /ENOTDIR/.test(error))), 'the Node history catalog failure is reported', 1_000);
    assert.ok(harness.postedMessages().slice(-1)[0]?.studies, 'Saved studies remain available beside the reported Node history failure');
  } finally { await harness.close(); }
});

test('saved Node history is selectable in the reader without entering browser playback', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    const store = harness.service.nodeHistoryStore!;
    const initialHeader = nodeTestHistoryHeader(store.workspaceKey), firstSourceText = 'const nextTheme = "dark";\n', secondSourceText = 'return applyTheme("dark");\n';
    const secondSource = { path: 'src/theme-next.ts', hash: sha256(secondSourceText), line: 1, column: 8 };
    const secondConfiguration = { ...initialHeader.configuration, additionalStops: [{ ...secondSource, anchorIndex: 0, inspections: initialHeader.configuration.inspections }] };
    const header = { ...initialHeader, configuration: secondConfiguration, configurationHash: sha256(JSON.stringify(secondConfiguration)) };
    const writer = await store.start(header);
    for (let sequence = 1; sequence <= 22; sequence++) {
      // Exercise the reader's bounded page boundary with ordinary captured output.
      await writer.appendOutput({ sequence, elapsedMs: sequence, channel: 'stdout', text: sequence === 1 ? 'RUN src/theme.test.ts' : `output ${sequence}` });
    }
    await writer.appendStop({ index: 0, runId: 'test-run', sessionId: 'test-session', threadId: 1, elapsedMs: 23, worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
      source: header.configuration.source, frame: { id: 1, name: 'notifyManager', line: 1, column: 1 }, variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
      facts: [{ path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' }],
      debuggerSnapshot: { version: 1, frames: [{ name: 'notifyManager', line: 1, column: 1, source: { name: header.configuration.source.path, text: firstSourceText, hash: sha256(firstSourceText), line: 1 }, scopes: [{ name: 'Local', variables: [0] }] }],
        variables: [{ name: 'nextTheme', value: 'dark', type: 'string', children: [] }], limitations: [] } } satisfies NodeTestSourceStop);
    await writer.appendOutput({ sequence: 23, elapsedMs: 24, channel: 'stdout', text: 'between stops\n' });
    await writer.appendStop({ index: 1, runId: 'test-run', sessionId: 'test-session', threadId: 1, elapsedMs: 25, worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
      source: secondSource, frame: { id: 2, name: 'applyTheme', line: 1, column: 8 }, variables: [{ name: 'themeName', value: 'dark', variablesReference: 0 }],
      facts: [{ path: 'themeName', mode: 'value', display: 'dark', type: 'string' }],
      debuggerSnapshot: { version: 1, frames: [{ name: 'applyTheme', line: 1, column: 8, source: { name: secondSource.path, text: secondSourceText, hash: secondSource.hash, line: 1 }, scopes: [{ name: 'Local', variables: [0] }] }],
        variables: [{ name: 'themeName', value: 'dark', type: 'string', children: [] }], limitations: [] } } satisfies NodeTestSourceStop);
    await writer.appendResult({ exitCode: 0, signal: null, output: 'Tests 1 passed' }, 26);
    await writer.finish('complete');
    await harness.reader.open();
    await waitUntil(() => Boolean(harness.postedMessages().slice(-1)[0]?.studies.some(entry => entry.id === header.studyId && entry.format === 'node-test-history')), 'Node history appears in Saved studies', 1_000);

    // Assert: the library exposes the journal as a distinct artifact and discloses missing replay media.
    const libraryMessage = harness.postedMessages().slice(-1)[0]!;
    const libraryEntry = libraryMessage.studies.find(entry => entry.id === header.studyId)!;
    assert.equal(libraryEntry.profile, 'node-test');
    assert.equal(libraryEntry.outcome, 'Node test complete; application video and synchronized replay unavailable');
    assert.equal(libraryEntry.metadata, 'validated');

    // Act: selecting the catalog entry routes to the Node journal while preserving browser-study selection.
    const revision = libraryMessage.revision;
    harness.receive({ type: 'node-history', revision, studyId: header.studyId });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistory?.header.studyId === header.studyId && !harness.postedMessages().slice(-1)[0]?.loading, 'selected Node history is verified and displayed', 1_000);
    const message = harness.postedMessages().slice(-1)[0]!;

    // Assert
    assert.equal(message.nodeHistory?.status, 'complete');
    assert.equal(message.nodeHistory?.entries.length, 20, 'reader messages include one bounded history page');
    assert.equal(message.nodeHistoryPageCount, 2);
    assert.equal(message.nodeHistory?.entries[0]?.type, 'output');
    assert.equal(message.recording, undefined, 'Node evidence does not masquerade as synchronized browser replay');
    assert.equal(message.model.selection.profile, 'repository-browser', 'Node history does not overwrite the browser-study selection');
    assert.equal(message.nodeHistoryLearningDecision, undefined, 'a passing test never marks understanding for the learner');
    const applicationHtml = harness.nativePanels().find(panel => panel.kind === 'codebook.scopedBrowser')?.webview.html ?? '';
    assert.match(applicationHtml, /Node test history · application video unavailable/);
    assert.doesNotMatch(applicationHtml, /<img alt="Application pixels captured/);

    // Act: only an explicit reader action writes a choice for this Node history.
    harness.receive({ type: 'node-history-understanding', revision: message.revision, studyId: header.studyId, understood: true });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryLearningDecision?.understood === true, 'learner understanding is saved', 1_000);
    const decisionMessage = harness.postedMessages().slice(-1)[0]!;
    const reopenMessageIndex = harness.postedMessages().length;
    harness.receiveContext({ type: 'node-history', revision: decisionMessage.revision, studyId: header.studyId });
    await waitUntil(() => harness.postedMessages().slice(reopenMessageIndex).some(view => view.loading),
      'reopening the Node history enters its loading state', 1_000);
    await waitUntil(() => {
      const view = harness.postedMessages().slice(-1)[0]!;
      return view.nodeHistory?.header.studyId === header.studyId && view.nodeHistoryPosition?.sequence === 1
        && view.nodeHistoryLearningDecision?.understood === true && !view.loading;
    }, 'learner choice and saved event are restored when the history reopens', 1_000);
    const restoredDecisionMessage = harness.postedMessages().slice(-1)[0]!;

    // Assert
    assert.equal(restoredDecisionMessage.nodeHistoryLearningDecision?.understood, true);
    assert.equal((await (await harness.reader.learningStorage()).readProgress()).decisions.length, 0,
      'Node understanding does not add a configured-study learner decision');

    // Act: step across the reader's page boundary using the global journal cursor.
    const beforePageStep = harness.postedMessages().slice(-1)[0]!;
    harness.receiveContext({ type: 'node-history-event', revision: beforePageStep.revision, studyId: header.studyId, sequence: 20 });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 20, 'last event on the first page is selected', 1_000);
    harness.receive({ type: 'node-history-step', revision: harness.postedMessages().slice(-1)[0]!.revision, studyId: header.studyId, direction: 'next' });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 21, 'next event crosses into the second page', 1_000);
    const pageBoundaryMessage = harness.postedMessages().slice(-1)[0]!;

    // Assert
    assert.equal(pageBoundaryMessage.nodeHistoryPage, 1);
    assert.equal(pageBoundaryMessage.nodeHistoryPosition?.eventIndex, 20);
    assert.equal(pageBoundaryMessage.nodeHistory?.entries[0]?.sequence, 21);

    // Act: select each recorded stop through the public reader message after reopening the history store.
    const reopenedLearningLibrary = await harness.reader.learningStorage();
    harness.reader['nodeHistoryStore'] = new NodeTestHistoryStore(reopenedLearningLibrary.directory, header.workspaceKey);
    harness.receiveContext({ type: 'node-history-stop', revision: message.revision, studyId: header.studyId, sequence: 23 });
    await waitUntil(() => harness.historicalDebugPresentations.length === 1, 'first historical Node stop reaches the native debugger', 1_000);
    const firstPresentation = harness.historicalDebugPresentations[0]!;
    assert.equal(firstPresentation.snapshot?.variables[0]?.name, 'nextTheme');
    assert.equal(firstPresentation.sourceDocument?.hash, header.configuration.source.hash);
    assert.equal(await harness.readCapturedSource(firstPresentation.sourceDocument!.uri), firstSourceText, 'source URI survives a fresh history store');
    const firstStopMessage = harness.postedMessages().slice(-1)[0]!;
    assert.equal(firstStopMessage.nodeHistoryPosition?.sequence, 23);
    assert.equal(firstStopMessage.nodeHistoryPosition?.index, 0);
    assert.equal(firstStopMessage.nodeHistoryPosition?.elapsedMs, 23);
    assert.match(firstStopMessage.nodeHistoryOutput!, /output 22/);
    assert.doesNotMatch(firstStopMessage.nodeHistoryOutput!, /between stops|Tests 1 passed/);
    await assert.rejects(harness.readCapturedSource(firstPresentation.sourceDocument!.uri.replace(header.configuration.source.hash, secondSource.hash)), /no longer matches its sealed history/i);

    // Act: an MCP-authored summary refreshes the selected Node history without moving its cursor or learner choice.
    const nodeLearningMaterial = { question: 'How does this test apply the theme?', title: 'Theme application', summary: 'The first stop records the selected theme before the test continues.',
      participants: [{ id: 'test', label: 'Theme test' }, { id: 'function', label: 'applyTheme' }],
      steps: [{ id: 'read-theme', from: 'test', to: 'function', label: 'Read selected theme', explanation: 'The captured debugger values show nextTheme is dark at this stop.',
        evidence: 'observed' as const, reference: { type: 'stop' as const, sequence: 23, sourceHash: header.configuration.source.hash } }] };
    await harness.service.explainNodeHistory({ studyId: header.studyId, expectedRevision: 0, content: nodeLearningMaterial });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryLearningMaterial?.revision === 1, 'saved Node learning material refreshes the open reader', 1_000);
    const materialMessage = harness.postedMessages().slice(-1)[0]!;

    // Assert
    assert.deepEqual(materialMessage.nodeHistoryLearningMaterial?.content, nodeLearningMaterial);
    assert.equal(materialMessage.nodeHistoryPosition?.sequence, 23, 'saving an explanation preserves the selected stop');
    assert.equal(materialMessage.nodeHistoryLearningDecision?.understood, true, 'saving an explanation does not change the learner choice');

    harness.receive({ type: 'node-history-stop', revision: message.revision, studyId: header.studyId, sequence: 25 });
    await waitUntil(() => harness.historicalDebugPresentations.length === 2, 'second historical Node stop replaces the selected native state', 1_000);
    const secondPresentation = harness.historicalDebugPresentations[1]!;
    assert.equal(secondPresentation.snapshot?.variables[0]?.name, 'themeName');
    assert.equal(secondPresentation.sourceDocument?.hash, secondSource.hash);
    assert.equal(await harness.readCapturedSource(secondPresentation.sourceDocument!.uri), secondSourceText);
    const secondStopMessage = harness.postedMessages().slice(-1)[0]!;
    assert.equal(secondStopMessage.nodeHistoryPosition?.sequence, 25);
    assert.equal(secondStopMessage.nodeHistoryPosition?.index, 1);
    assert.equal(secondStopMessage.nodeHistoryPosition?.elapsedMs, 25);
    assert.match(secondStopMessage.nodeHistoryOutput!, /between stops/);
    assert.doesNotMatch(secondStopMessage.nodeHistoryOutput!, /Tests 1 passed/);

    // Act: moving through output-only intervals clears the previously selected native debug context.
    harness.receive({ type: 'node-history-event', revision: message.revision, studyId: header.studyId, sequence: 24 });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 24, 'inter-stop output event is selected', 1_000);
    const interStopMessage = harness.postedMessages().slice(-1)[0]!;

    // Assert
    assert.equal(interStopMessage.nodeHistoryPosition?.type, 'output');
    assert.match(interStopMessage.nodeHistoryOutput!, /between stops/);
    assert.doesNotMatch(interStopMessage.nodeHistoryOutput!, /Tests 1 passed/);
    assert.equal(harness.historicalDebugInvalidations(), 1, 'the previous stop is cleared during an output-only interval');
    assert.equal(harness.historicalDebugPresentations.length, 2, 'an output-only interval does not claim a debugger snapshot');

    // Act: step forward and back across a stop and a gap, then select the terminal result.
    harness.receive({ type: 'node-history-step', revision: message.revision, studyId: header.studyId, direction: 'next' });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 25, 'next recorded stop is restored', 1_000);
    harness.receive({ type: 'node-history-step', revision: message.revision, studyId: header.studyId, direction: 'previous' });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 24, 'backward navigation restores the output gap', 1_000);
    harness.receive({ type: 'node-history-event', revision: message.revision, studyId: header.studyId, sequence: 26 });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 26, 'terminal result event is selected', 1_000);

    // Assert
    const terminalMessage = harness.postedMessages().slice(-1)[0]!;
    assert.equal(terminalMessage.nodeHistoryPosition?.type, 'result');
    assert.match(terminalMessage.nodeHistoryOutput!, /between stops/);
    assert.doesNotMatch(terminalMessage.nodeHistoryOutput!, /Tests 1 passed/);
    assert.equal(harness.historicalDebugInvalidations(), 3, 'terminal events do not retain historical debugger values');
    assert.equal(harness.historicalDebugPresentations[2]?.snapshot?.variables[0]?.name, 'themeName', 'revisiting a stop restores its captured values');

    // Act: reopen the same history through a new store and restore the previously selected stop.
    harness.receive({ type: 'node-history-stop', revision: message.revision, studyId: header.studyId, sequence: 25 });
    await waitUntil(() => harness.historicalDebugPresentations.length === 4, 'second stop is selected before reopening its history', 1_000);
    const library = await harness.reader.learningStorage();
    harness.reader['nodeHistoryStore'] = new NodeTestHistoryStore(library.directory, header.workspaceKey);
    const latestRevision = harness.postedMessages().slice(-1)[0]!.revision;
    harness.receive({ type: 'node-history', revision: latestRevision, studyId: header.studyId });
    await waitUntil(() => harness.historicalDebugPresentations.length === 5 && harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 25 && !harness.postedMessages().slice(-1)[0]?.loading,
      'a new history store restores the saved stop and its native snapshot', 1_000);

    // Assert
    const reopenedHistoryMessage = harness.postedMessages().slice(-1)[0]!;
    assert.equal(reopenedHistoryMessage.nodeHistoryPosition?.type, 'stop');
    assert.equal(reopenedHistoryMessage.nodeHistoryPosition?.debuggerAvailable, true);
    assert.equal(harness.historicalDebugPresentations[4]?.snapshot?.variables[0]?.name, 'themeName');
    assert.equal(reopenedHistoryMessage.nodeHistoryLearningMaterial?.revision, 1, 'a fresh history store restores the saved explanation');
    assert.equal(reopenedHistoryMessage.nodeHistoryLearningDecision?.understood, true, 'the separate learner choice survives material reload');
    assert.equal(await harness.readCapturedSource(harness.historicalDebugPresentations[4]!.sourceDocument!.uri), secondSourceText);

    // Act: persist an output-only interval, then reopen through another store instance.
    harness.receive({ type: 'node-history-event', revision: reopenedHistoryMessage.revision, studyId: header.studyId, sequence: 24 });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 24, 'output-only position replaces the saved stop', 1_000);
    const outputPositionMessage = harness.postedMessages().slice(-1)[0]!;
    assert.equal(outputPositionMessage.nodeHistoryPosition?.type, 'output');
    assert.equal(outputPositionMessage.nodeHistoryPosition?.debuggerAvailable, undefined);
    assert.match(outputPositionMessage.nodeHistoryOutput!, /between stops/);
    assert.doesNotMatch(outputPositionMessage.nodeHistoryOutput!, /Tests 1 passed/);
    const presentationsBeforeOutputRestore = harness.historicalDebugPresentations.length;
    harness.reader['nodeHistoryStore'] = new NodeTestHistoryStore(library.directory, header.workspaceKey);
    harness.receive({ type: 'node-history', revision: outputPositionMessage.revision, studyId: header.studyId });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 24 && !harness.postedMessages().slice(-1)[0]?.loading,
      'a fresh history store restores the output-only cursor', 1_000);

    // Assert
    const reopenedOutputMessage = harness.postedMessages().slice(-1)[0]!;
    assert.equal(reopenedOutputMessage.nodeHistoryPosition?.type, 'output');
    assert.equal(reopenedOutputMessage.nodeHistoryPosition?.debuggerAvailable, undefined);
    assert.match(reopenedOutputMessage.nodeHistoryOutput!, /between stops/);
    assert.doesNotMatch(reopenedOutputMessage.nodeHistoryOutput!, /Tests 1 passed/);
    assert.equal(harness.historicalDebugPresentations.length, presentationsBeforeOutputRestore, 'reopening an output event does not present a stale debugger stop');

    // Assert: replay ownership blocks mixing a Node stop into a browser recording session.
    harness.reader['recordingActive'] = true;
    harness.receiveContext({ type: 'node-history-stop', revision: reopenedOutputMessage.revision, studyId: header.studyId, sequence: 23 });
    await waitUntil(() => Boolean(harness.reader.inspect().view?.errors.length), 'browser playback refusal is reported to the reader', 1_000);
    assert.match(harness.reader.inspect().view!.errors.at(-1)!, /Close browser replay/);
    assert.equal(harness.historicalDebugPresentations.length, 5);
    harness.reader['recordingActive'] = false;

    // Act: advance the independent event page without opening browser playback.
    harness.receive({ type: 'node-history-page', revision: message.revision, studyId: header.studyId, page: 1 });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPage === 1, 'next Node history page', 1_000);
    const lastPage = harness.postedMessages().slice(-1)[0]!;

    // Assert
    assert.equal(lastPage.nodeHistory?.entries.length, 6);
    assert.equal(lastPage.nodeHistory?.entries[lastPage.nodeHistory.entries.length - 1]?.type, 'result');

    // Arrange: a native debugger preview from this Node history can outlive its selected journal.
    const obsoletePreview = harness.addNodeHistoryPreview(header.studyId, 2);
    const pinnedPreview = harness.addNodeHistoryPreview(header.studyId, 2, { pinned: true });
    const editedPreview = harness.addNodeHistoryPreview(header.studyId, 2, { dirty: true });
    const otherHistoryPreview = harness.addNodeHistoryPreview(randomUUID(), 2);
    const learnerPreview = harness.addTextPreview('/private/notes.ts', 2);
    const learningLibrary = await harness.reader.learningStorage();
    const browserStudy = { ...createConfiguredStudy(), workspaceKey: learningLibrary.workspaceKey };
    await learningLibrary.saveStudy(browserStudy);

    // Act: choosing browser history retires only the previous journal's disposable source preview.
    harness.receive({ type: 'history', revision: lastPage.revision, studyId: browserStudy.id });
    await waitUntil(() => harness.reader.inspect().view?.model.selection.studyId === browserStudy.id && !harness.reader.inspect().view?.loading,
      'browser study replaces the selected Node history', 1_000);

    // Assert: learner-pinned, edited and unrelated tabs remain available.
    const retainedTabs = harness.groups.flatMap(group => group.tabs);
    assert.equal(retainedTabs.includes(obsoletePreview), false);
    assert.equal(retainedTabs.includes(pinnedPreview), true);
    assert.equal(retainedTabs.includes(editedPreview), true);
    assert.equal(retainedTabs.includes(otherHistoryPreview), true);
    assert.equal(retainedTabs.includes(learnerPreview), true);
    assert.equal(harness.reader.inspect().view?.nodeHistory, undefined);
  } finally { await harness.close(); }
});

test('Node journal time seeking restores exact stops and clears debugger across output and result events', async () => {
  // Arrange: keep this playback contract isolated from unrelated reader reopen and pagination workflows.
  const harness = await workspaceHarness();
  try {
    const store = harness.service.nodeHistoryStore!;
    const header = nodeTestHistoryHeader(store.workspaceKey);
    const firstText = 'const nextTheme = "dark";\n';
    const secondText = 'return applyTheme("dark");\n';
    const secondSource = { path: 'src/theme-next.ts', hash: sha256(secondText), line: 1, column: 8 };
    const configuration = { ...header.configuration, additionalStops: [{ ...secondSource, anchorIndex: 0, inspections: header.configuration.inspections }] };
    const history = { ...header, configuration, configurationHash: sha256(JSON.stringify(configuration)) };
    const writer = await store.start(history);
    await writer.appendOutput({ sequence: 1, elapsedMs: 100, channel: 'stdout', text: 'RUN src/theme.test.ts\n' });
    await writer.appendStop({ index: 0, runId: 'test-run', sessionId: 'test-session', threadId: 1, elapsedMs: 200,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' }, source: history.configuration.source,
      frame: { id: 1, name: 'notifyManager', line: 1, column: 1 }, variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
      facts: [{ path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' }],
      debuggerSnapshot: { version: 1, frames: [{ name: 'notifyManager', line: 1, column: 1,
        source: { name: history.configuration.source.path, text: firstText, hash: sha256(firstText), line: 1 }, scopes: [{ name: 'Local', variables: [0] }] }],
      variables: [{ name: 'nextTheme', value: 'dark', type: 'string', children: [] }], limitations: [] } } satisfies NodeTestSourceStop);
    await writer.appendOutput({ sequence: 3, elapsedMs: 300, channel: 'stdout', text: 'between stops\n' });
    await writer.appendStop({ index: 1, runId: 'test-run', sessionId: 'test-session', threadId: 1, elapsedMs: 400,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' }, source: secondSource,
      frame: { id: 2, name: 'applyTheme', line: 1, column: 8 }, variables: [{ name: 'themeName', value: 'dark', variablesReference: 0 }],
      facts: [{ path: 'themeName', mode: 'value', display: 'dark', type: 'string' }],
      debuggerSnapshot: { version: 1, frames: [{ name: 'applyTheme', line: 1, column: 8,
        source: { name: secondSource.path, text: secondText, hash: secondSource.hash, line: 1 }, scopes: [{ name: 'Local', variables: [0] }] }],
      variables: [{ name: 'themeName', value: 'dark', type: 'string', children: [] }], limitations: [] } } satisfies NodeTestSourceStop);
    await writer.appendResult({ exitCode: 0, signal: null, output: 'Tests 1 passed' }, 500);
    await writer.finish('complete');
    await harness.reader.open();
    const initial = harness.postedMessages().slice(-1)[0]!;
    harness.receiveContext({ type: 'node-history', revision: initial.revision, studyId: history.studyId });
    await waitUntil(() => {
      const view = harness.postedMessages().slice(-1)[0]!;
      return view.nodeHistory?.header.studyId === history.studyId && view.nodeHistoryPosition?.sequence === 1 && !view.loading;
    }, 'the sealed Node history and its initial event are loaded', 1_000);

    // Act: seek to the second stop through the same message sent by the time slider.
    harness.receiveContext({ type: 'node-history-playback', revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: history.studyId, action: 'seek', positionMs: 400 });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPlayback?.positionMs === 400,
      'time seek presents the second verified stop', 1_000);

    // Assert: the historical debugger, output prefix and durable cursor all identify the same event.
    const secondStop = harness.postedMessages().slice(-1)[0]!;
    assert.equal(secondStop.nodeHistoryPosition?.sequence, 4);
    assert.equal(secondStop.nodeHistoryPosition?.type, 'stop');
    assert.equal(secondStop.nodeHistoryPosition?.debuggerAvailable, true);
    assert.equal(harness.historicalDebugPresentations.at(-1)?.snapshot?.variables[0]?.name, 'themeName');
    assert.match(secondStop.nodeHistoryOutput!, /between stops/);
    assert.doesNotMatch(secondStop.nodeHistoryOutput!, /Tests 1 passed/);
    assert.equal(await store.readReaderPosition(history.studyId), 4);

    // Act: seek into the output interval and then to the final result.
    harness.receiveContext({ type: 'node-history-playback', revision: secondStop.revision,
      studyId: history.studyId, action: 'seek', positionMs: 300 });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 3,
      'output seek clears the second debugger stop', 1_000);
    const outputEvent = harness.postedMessages().slice(-1)[0]!;
    harness.receiveContext({ type: 'node-history-playback', revision: outputEvent.revision,
      studyId: history.studyId, action: 'seek', positionMs: 500 });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 5,
      'result seek selects the final journal event', 1_000);

    // Assert: output and result do not imply application video or retain a stale debugger.
    const resultEvent = harness.postedMessages().slice(-1)[0]!;
    assert.equal(resultEvent.nodeHistoryPosition?.type, 'result');
    assert.equal(resultEvent.nodeHistoryPlayback?.mode, 'paused');
    assert.equal(resultEvent.recording, undefined);
    assert.equal(resultEvent.nodeHistoryPosition?.debuggerAvailable, undefined);
    assert.ok(harness.historicalDebugInvalidations() >= 2);
  } finally { await harness.close(); }
});

test('time seeking in a second opened Node history presents its own stop instead of reporting a changed history', async () => {
  // Arrange: two sealed one-stop histories whose captured values differ.
  const harness = await workspaceHarness();
  try {
    const store = harness.service.nodeHistoryStore!;
    const sourceText = 'const nextTheme = "dark";\n';
    const saveHistory = async (value: string) => {
      const history = nodeTestHistoryHeader(store.workspaceKey);
      const writer = await store.start(history);
      await writer.appendOutput({ sequence: 1, elapsedMs: 100, channel: 'stdout', text: 'RUN src/theme.test.ts\n' });
      await writer.appendStop({ index: 0, runId: 'test-run', sessionId: 'test-session', threadId: 1, elapsedMs: 200,
        worker: { pid: 1, processGroup: 1, workspace: '/private/test' }, source: history.configuration.source,
        frame: { id: 1, name: 'notifyManager', line: 1, column: 1 }, variables: [{ name: 'nextTheme', value, variablesReference: 0 }],
        facts: [{ path: 'nextTheme', mode: 'value', display: value, type: 'string' }],
        debuggerSnapshot: { version: 1, frames: [{ name: 'notifyManager', line: 1, column: 1,
          source: { name: history.configuration.source.path, text: sourceText, hash: sha256(sourceText), line: 1 }, scopes: [{ name: 'Local', variables: [0] }] }],
        variables: [{ name: 'nextTheme', value, type: 'string', children: [] }], limitations: [] } } satisfies NodeTestSourceStop);
      await writer.appendResult({ exitCode: 0, signal: null, output: 'Tests 1 passed' }, 300);
      await writer.finish('complete');
      return history;
    };
    const firstHistory = await saveHistory('"dark"'), secondHistory = await saveHistory('"light"');
    await harness.reader.open();
    for (const history of [firstHistory, secondHistory]) {
      harness.receiveContext({ type: 'node-history', revision: harness.postedMessages().slice(-1)[0]!.revision, studyId: history.studyId });
      await waitUntil(() => {
        const view = harness.postedMessages().slice(-1)[0]!;
        return view.nodeHistory?.header.studyId === history.studyId && view.nodeHistoryPosition?.sequence === 1 && !view.loading;
      }, 'the selected Node history and its initial event are loaded', 1_000);
    }

    // Act: seek the second history through the same message sent by the time slider.
    harness.receiveContext({ type: 'node-history-playback', revision: harness.postedMessages().slice(-1)[0]!.revision,
      studyId: secondHistory.studyId, action: 'seek', positionMs: 200 });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPlayback?.positionMs === 200,
      'time seek presents the second history stop', 1_000);

    // Assert: the native debugger shows the second history's captured value.
    const seeked = harness.postedMessages().slice(-1)[0]!;
    assert.equal(seeked.nodeHistory?.header.studyId, secondHistory.studyId);
    assert.equal(seeked.nodeHistoryPosition?.type, 'stop');
    assert.equal(harness.historicalDebugPresentations.at(-1)?.snapshot?.variables[0]?.value, '"light"');
  } finally { await harness.close(); }
});

test('reopening a Node history after the learner stops its historical debugger restores native values', async () => {
  // Arrange: a sealed one-stop history presented once through the native debugger.
  const harness = await workspaceHarness();
  try {
    const store = harness.service.nodeHistoryStore!;
    const history = nodeTestHistoryHeader(store.workspaceKey), sourceText = 'const nextTheme = "dark";\n';
    const writer = await store.start(history);
    await writer.appendOutput({ sequence: 1, elapsedMs: 100, channel: 'stdout', text: 'RUN src/theme.test.ts\n' });
    await writer.appendStop({ index: 0, runId: 'test-run', sessionId: 'test-session', threadId: 1, elapsedMs: 200,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' }, source: history.configuration.source,
      frame: { id: 1, name: 'notifyManager', line: 1, column: 1 }, variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
      facts: [{ path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' }],
      debuggerSnapshot: { version: 1, frames: [{ name: 'notifyManager', line: 1, column: 1,
        source: { name: history.configuration.source.path, text: sourceText, hash: sha256(sourceText), line: 1 }, scopes: [{ name: 'Local', variables: [0] }] }],
      variables: [{ name: 'nextTheme', value: 'dark', type: 'string', children: [] }], limitations: [] } } satisfies NodeTestSourceStop);
    await writer.appendResult({ exitCode: 0, signal: null, output: 'Tests 1 passed' }, 300);
    await writer.finish('complete');
    await harness.reader.open();
    harness.receiveContext({ type: 'node-history', revision: harness.postedMessages().slice(-1)[0]!.revision, studyId: history.studyId });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded', 1_000);
    harness.receiveContext({ type: 'node-history-stop', revision: harness.postedMessages().slice(-1)[0]!.revision, studyId: history.studyId, sequence: 2 });
    await waitUntil(() => harness.historicalDebugPresentations.length === 1, 'the recorded stop reaches the native debugger', 1_000);
    // The learner ends the "Codebook · Recorded learning" session from the native debugger.
    harness.historicalDebuggers[0]!.available = false;

    // Act: reopening the same history is the documented recovery.
    harness.receiveContext({ type: 'node-history', revision: harness.postedMessages().slice(-1)[0]!.revision, studyId: history.studyId });
    await waitUntil(() => harness.historicalDebugPresentations.length === 2 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the reopened history presents its saved stop through a fresh historical debugger', 1_000);

    // Assert
    assert.equal(harness.historicalDebuggers.length, 2);
    assert.equal(harness.historicalDebugPresentations[1]?.snapshot?.variables[0]?.name, 'nextTheme');
    assert.equal(harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence, 2);
  } finally { await harness.close(); }
});

/** Saves one sealed Node history with output, one verified stop and a passing result for historical debugger recovery tests. @example const history = await saveOneStopNodeHistory(store) */
async function saveOneStopNodeHistory(store: NodeTestHistoryStore) {
  const history = nodeTestHistoryHeader(store.workspaceKey), sourceText = 'const nextTheme = "dark";\n';
  const writer = await store.start(history);
  await writer.appendOutput({ sequence: 1, elapsedMs: 100, channel: 'stdout', text: 'RUN src/theme.test.ts\n' });
  await writer.appendStop({ index: 0, runId: 'test-run', sessionId: 'test-session', threadId: 1, elapsedMs: 200,
    worker: { pid: 1, processGroup: 1, workspace: '/private/test' }, source: history.configuration.source,
    frame: { id: 1, name: 'notifyManager', line: 1, column: 1 }, variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
    facts: [{ path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' }],
    debuggerSnapshot: { version: 1, frames: [{ name: 'notifyManager', line: 1, column: 1,
      source: { name: history.configuration.source.path, text: sourceText, hash: sha256(sourceText), line: 1 }, scopes: [{ name: 'Local', variables: [0] }] }],
      variables: [{ name: 'nextTheme', value: 'dark', type: 'string', children: [] }], limitations: [] } } satisfies NodeTestSourceStop);
  await writer.appendResult({ exitCode: 0, signal: null, output: 'Tests 1 passed' }, 300);
  await writer.finish('complete');
  return history;
}

test('returning to the current run leaves a selected Node history so its missing-video notice no longer masks the live application', async () => {
  // Arrange: the learner is reading a saved Node history, whose application pane explains that no video exists.
  const harness = await workspaceHarness();
  try {
    const history = await saveOneStopNodeHistory(harness.service.nodeHistoryStore!);
    await harness.reader.open();
    harness.receiveContext({ type: 'node-history', revision: harness.postedMessages().slice(-1)[0]!.revision, studyId: history.studyId });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistory?.header.studyId === history.studyId && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is displayed', 1_000);

    // Act
    await harness.reader.action('return-current');

    // Assert
    const view = harness.postedMessages().slice(-1)[0]!;
    const applicationHtml = harness.nativePanels().find(panel => panel.kind === 'codebook.scopedBrowser')?.webview.html ?? '';
    assert.equal(view.nodeHistory, undefined, 'the Node journal is no longer the selected reader content');
    assert.equal(view.model.selection.follow, true);
    assert.doesNotMatch(applicationHtml, /Node test history · application video unavailable/);
  } finally { await harness.close(); }
});

test('selecting a Node stop after the learner stops its historical debugger restarts it instead of freezing the reader', async () => {
  // Arrange: the stop was presented, then the learner ended "Codebook · Recorded learning" and stepped back to output.
  const harness = await workspaceHarness();
  try {
    const history = await saveOneStopNodeHistory(harness.service.nodeHistoryStore!);
    await harness.reader.open();
    harness.receiveContext({ type: 'node-history', revision: harness.postedMessages().slice(-1)[0]!.revision, studyId: history.studyId });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded', 1_000);
    harness.receiveContext({ type: 'node-history-stop', revision: harness.postedMessages().slice(-1)[0]!.revision, studyId: history.studyId, sequence: 2 });
    await waitUntil(() => harness.historicalDebugPresentations.length === 1, 'the recorded stop reaches the native debugger', 1_000);
    harness.historicalDebuggers[0]!.available = false;
    harness.receiveContext({ type: 'node-history-step', revision: harness.postedMessages().slice(-1)[0]!.revision, studyId: history.studyId, direction: 'previous' });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 1, 'the learner steps back to the output event', 1_000);

    // Act: the learner selects the stop again from the event list.
    harness.receiveContext({ type: 'node-history-event', revision: harness.postedMessages().slice(-1)[0]!.revision, studyId: history.studyId, sequence: 2 });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 2, 'the explicit selection reaches the stop', 1_000);

    // Assert
    assert.equal(harness.historicalDebuggers.length, 2, 'a fresh historical debugger replaces the one the learner stopped');
    assert.equal(harness.historicalDebugPresentations[1]?.snapshot?.variables[0]?.name, 'nextTheme');
    assert.equal(harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.debuggerAvailable, true);
  } finally { await harness.close(); }
});

test('seeking a Node history onto a stop after the learner stops its historical debugger explains how to restart it', async () => {
  // Arrange: the learner ended "Codebook · Recorded learning" while the output event was selected.
  const harness = await workspaceHarness();
  try {
    const history = await saveOneStopNodeHistory(harness.service.nodeHistoryStore!);
    await harness.reader.open();
    harness.receiveContext({ type: 'node-history', revision: harness.postedMessages().slice(-1)[0]!.revision, studyId: history.studyId });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded', 1_000);
    harness.receiveContext({ type: 'node-history-stop', revision: harness.postedMessages().slice(-1)[0]!.revision, studyId: history.studyId, sequence: 2 });
    await waitUntil(() => harness.historicalDebugPresentations.length === 1, 'the recorded stop reaches the native debugger', 1_000);
    harness.receiveContext({ type: 'node-history-step', revision: harness.postedMessages().slice(-1)[0]!.revision, studyId: history.studyId, direction: 'previous' });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 1, 'the learner steps back to the output event', 1_000);
    harness.historicalDebuggers[0]!.available = false;

    // Act: the time slider seeks onto the stop.
    harness.receiveContext({ type: 'node-history-playback', revision: harness.postedMessages().slice(-1)[0]!.revision, studyId: history.studyId, action: 'seek', positionMs: 200 });
    await waitUntil(() => Boolean(harness.reader.inspect().view?.errors.some(error => /historical Node debugger was stopped/.test(error))),
      'the seek reports why the stop was not presented', 1_000);

    // Assert
    assert.equal(harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence, 1, 'a stop the debugger cannot show is never reported as selected');
    assert.equal(harness.historicalDebuggers.length, 1, 'a seek never relaunches the debugger the learner stopped');
  } finally { await harness.close(); }
});

test('sealed repository source remains restorable before the first debugger observation', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    const library = await harness.reader.learningStorage(), fixture = createConfiguredStudy();
    const study = { ...fixture, workspaceKey: library.workspaceKey, state: 'ready', terminal: false, finalOutcome: 'pending-teardown' as const, operation: undefined, observations: [], captures: [] };
    await library.saveStudy(study); await harness.reader.open();
    harness.receive({ type: 'history', revision: harness.reader.inspect().view!.revision, studyId: study.id });
    await waitUntil(() => harness.reader.inspect().view!.model.selection.studyId === study.id && !harness.reader.inspect().view!.loading, 'sealed repository source', 1_000);
    const uri = harness.reader['sourceUri']; assert.ok(uri);
    // Act: an editor restart must resolve this URI from persisted bytes, without its transient cache.
    harness.reader['documents'].clear();
    const restored = await harness.reader['provideSource'](uri);
    // Assert
    assert.ok(uri.path.startsWith(`/${study.id}/`));
    assert.equal(restored, 'const nextTheme = "dark";\n');
    assert.equal(harness.reader.inspect().view!.model.observation, undefined);
  } finally { await harness.close(); }
});

/** Saves a real recording/context with deterministic synthetic runtime values; native paints remain an explicitly mocked boundary. @example const harness = await recordedReaderHarness() */
async function recordedReaderHarness(capturedApplication = false) {
  const harness = await workspaceHarness(true, true), service = harness.service;
  service.environment.build.sourceHash = sha256('recorded-build'); harness.acknowledgeContext();
  harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() }); const record = [...service.records.values()][0]!; await record.preparation;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=', 'base64');
  assert.ok(record.recording); record.recording.frame({ bytes: png, elapsedMs: 20, kind: 'stream' });
  // Observation visibility tests retain a real PNG checkpoint while the native renderer remains mocked.
  if (capturedApplication) {
    const runtime = harness.runtimes[0]!, view = runtime.view.bind(runtime);
    await writeFile(join(runtime.evidence.directory, 'paused-browser.png'), png);
    runtime.view = () => ({ ...view(), captures: { 'paused-browser': { status: 'captured', file: 'paused-browser.png', renderer: { epoch: 'test', id: 1, hash: sha256(png) } } } });
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
    const binding: BookObservationBinding = { nodeId: 'module', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
    await library.selectRepository({ bookId: 'architecture', revision: 1, nodeId: 'module', anchorIndex: 0, location: { sectionIndex: 1, fraction: 0.5, focusId: 'section-1' } });
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
    const binding: BookObservationBinding = { nodeId: 'module', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
    // Act
    await harness.reader.openRepositoryEvidence(binding, true);
    const view = harness.reader.inspect().view!;
    // Assert
    assert.equal(view.model.observation?.id, observation.id); assert.equal(view.recording?.presentedMs, 100); assert.equal(view.recording?.mode, 'paused');
    assert.equal(view.model.continueArguments, undefined); assert.equal(harness.runtimes[0]!.dispatches, 1); assert.equal((await library.readProgress()).decisions.length, 0);
  } finally { await harness.close(); }
});

for (const recording of [false, true]) test(`Wiki ${recording ? 'recording' : 'observation'} and explicit Study entry keep hidden navigation panes hidden until requested`, async () => {
  // Arrange
  const harness = await recordedReaderHarness(), library = await harness.reader.learningStorage();
  try {
    const study = await library.readStudy(harness.studyId), observation = study.observations[0]!;
    const binding: BookObservationBinding = { nodeId: 'module', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
    harness.commands.length = 0;
    // Act
    await harness.reader.openRepositoryEvidence(binding, recording);
    const evidenceNavigation = harness.commands.filter(name => name === 'codebook.learningOutline.focus' || name === 'codebook.observedMoments.focus');
    await harness.reader.open();
    // Assert
    assert.deepEqual(evidenceNavigation, []);
    assert.deepEqual(harness.commands.filter(name => name === 'codebook.learningOutline.focus' || name === 'codebook.observedMoments.focus'), []);
    assert.equal(harness.reader.inspect().view!.model.observation?.id, observation.id);
    assert.equal(harness.runtimes[0]!.dispatches, 1); assert.equal((await library.readProgress()).decisions.length, 0);
    await harness.reader.action('outline');
    assert.deepEqual(harness.commands.filter(name => name === 'codebook.learningOutline.focus' || name === 'codebook.observedMoments.focus'), ['codebook.learningOutline.focus']);
  } finally { await harness.close(); }
});

for (const recording of [false, true]) test(`explicit Open Study preserves hidden navigation while a Wiki ${recording ? 'recording' : 'observation'} entry waits for source`, async () => {
  // Arrange
  const harness = await recordedReaderHarness(), library = await harness.reader.learningStorage();
  const study = await library.readStudy(harness.studyId), observation = study.observations[0]!;
  const binding: BookObservationBinding = { nodeId: 'module', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
  harness.commands.length = 0; const source = harness.holdNextSource();
  const navigation = harness.reader.openRepositoryEvidence(binding, recording);
  try {
    await source.started;
    // Act
    await harness.reader.open();
    // Assert
    assert.deepEqual(harness.commands.filter(name => name === 'codebook.learningOutline.focus' || name === 'codebook.observedMoments.focus'), []);
  } finally { source.release(); await navigation; await harness.close(); }
});

test('book evidence rejects a changed captured observation before selecting history or opening replay', async () => {
  // Arrange
  const harness = await recordedReaderHarness(), library = await harness.reader.learningStorage();
  try {
    const study = await library.readStudy(harness.studyId), observation = study.observations[0]!;
    const binding: BookObservationBinding = { nodeId: 'module', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: '0'.repeat(64), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
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
    const binding: BookObservationBinding = { nodeId: 'module', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
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
  const binding: BookObservationBinding = { nodeId: 'module', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
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

test('Wiki reading layout cannot report the selected Study presentation as confirmed', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    await harness.reader.open();
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal);
    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.equal((await harness.reader.readPresentationState()).layoutConfirmed, false);
    await harness.reader.open();
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
  } finally { await harness.close(); }
});

test('Study reports why a captured source prevents layout confirmation after failed execution', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    await harness.reader.open();
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    // Act: a failed run invalidates the source receipt while the native panes remain visible.
    harness.reader['sourceRevision'] = undefined;
    const state = harness.reader.presentationState();
    // Assert
    assert.equal(state.layoutConfirmed, false);
    assert.match(state.reason ?? '', /captured source is not ready in its native pane/);
    assert.deepEqual({ ...state.panes }, { appColumn: 1, sourceColumn: 2, contextColumn: 3 });
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

test('an unchanged empty chat part cannot block Study reentry after Wiki tab resync', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.groups.at(-1)!.tabs = []; harness.groups.at(-1)!.activeTab = undefined;
  try {
    await harness.reader.open(); await harness.reader.arrangeRepository(new AbortController().signal);
    // Act
    harness.resyncEditorGroups('empty'); await harness.reader.open();
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.deepEqual(harness.groups.at(-1)!.tabs, []); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.groups[0]!.tabs.some(tab => 'uri' in tab.input && tab.input.uri.toString() === draft.document.uri.toString()), true);
    assert.equal(draft.document.getText(), 'Original learner draft.\n'); assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

for (const change of ['replace', 'unannounced', 'move', 'ambiguous'] as const) test(`an empty other-part ${change} cannot authorize Study to replace the reading layout`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.groups.at(-1)!.tabs = []; harness.groups.at(-1)!.activeTab = undefined;
  try {
    await harness.reader.open(); await harness.reader.arrangeRepository(new AbortController().signal);
    const layout = harness.editorLayout(), mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    if (change === 'move') harness.groups.at(-1)!.viewColumn = 5;
    if (change === 'ambiguous') harness.groups.push({ viewColumn: 5, tabs: [] });
    // Act
    harness.resyncEditorGroups(change === 'replace' || change === 'unannounced' ? change : 'empty', true);
    await harness.reader.open();
    // Assert
    assert.deepEqual(harness.editorLayout(), layout);
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.equal(harness.groups.filter(group => group.viewColumn > 3).every(group => group.tabs.length === 0), true);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(draft.document.getText(), 'Original learner draft.\n'); assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('explicit Study reentry reveals its application and captured source over retained reading tabs', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    await harness.reader.open(); await harness.reader.arrangeRepository(new AbortController().signal);
    const citation = harness.addTextPreview('/article-citation.ts', 1), article = harness.addTextPreview('/wiki-reader.html', 2);
    harness.groups.find(group => group.viewColumn === 1)!.activeTab = citation;
    harness.groups.find(group => group.viewColumn === 2)!.activeTab = article;
    // Act
    await harness.reader.open();
    // Assert
    const application = harness.groups.find(group => group.viewColumn === 1)!.activeTab?.input;
    const source = harness.groups.find(group => group.viewColumn === 2)!.activeTab?.input;
    assert.ok(application && 'viewType' in application); assert.equal(application.viewType, 'codebook.scopedBrowser');
    assert.ok(source && 'uri' in source); assert.equal(source.uri.toString(), harness.reader.inspect().sourceUri);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.groups.find(group => group.viewColumn === 1)!.tabs.includes(citation), true);
    assert.equal(harness.groups.find(group => group.viewColumn === 2)!.tabs.includes(article), true);
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
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

test('a retired renderer cannot select another layout while replay opens its summary sidebar', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true);
  try {
    await harness.reader.open();
    await harness.reader.openRecording(harness.studyId);
    const state = harness.reader.presentationState();

    // Act
    harness.receive({ type: 'presentation', revision: harness.reader.inspect().view!.revision, presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    await harness.controller.settle();

    // Assert
    assert.equal(harness.controller.state().readiness, 'ready');
    assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.summary.visible, true);
    assert.equal(harness.reader.inspect().view!.errors.some(error => error.includes('first confirmed replay position')), false);
    assert.equal(harness.reader.presentationState().reason?.includes('first confirmed replay position') ?? false, false);
    assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { await harness.close(); }
});

test('an MCP mode request before replay readiness clears its warning when the first position becomes ready', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true);
  try {
    await harness.reader.open();
    await harness.reader.openRecording(harness.studyId);
    const state = harness.reader.presentationState();

    // Act
    await assert.rejects(harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' }),
      { code: 'PRESENTATION_UNAVAILABLE', causeDetail: /first confirmed replay position/ });
    assert.match(harness.reader.presentationState().reason ?? '', /first confirmed replay position/);
    await harness.controller.settle();

    // Assert
    assert.equal(harness.controller.state().readiness, 'ready');
    assert.equal(harness.reader.presentationState().reason?.includes('first confirmed replay position') ?? false, false);
    assert.equal(harness.reader.presentationState().requestedMode, undefined);
    assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { await harness.close(); }
});

test('returning from recording to Wiki keeps background study refresh from covering the article with captured source', async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  try {
    const library = await harness.reader.learningStorage(), study = await library.readStudy(harness.studyId), observation = study.observations[0]!;
    const binding: BookObservationBinding = { nodeId: 'module', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
    await harness.reader.openRepositoryEvidence(binding, true, undefined, { bookId: 'architecture', revision: 1, nodeId: 'module', anchorIndex: 0, location: { sectionIndex: 1, fraction: 0.5, focusId: 'section-1' } });
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
    // Both manually retained owned tabs coexist; a real group cannot retain two replacing preview tabs.
    for (const tab of sourceGroup.tabs) if ('viewType' in tab.input) tab.isPreview = false;
    harness.swapEditorGroups(sourceGroup, contextGroup);
    harness.changeEditorLayout({ orientation: 0, groups: [{}, {}, {}] });
    harness.restoreSourceFocusOnArrange();
    harness.reportSourceEditorInColumn(3);
    harness.clearDecorations();

    // Act
    await harness.reader.action('arrange');

    // Assert
    assert.deepEqual([...harness.reader.inspect().view!.errors], []);
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

test('Restore separates a Study explanation from source after its third native group closes', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    await harness.reader.open();
    harness.closeEmptyGroupsAfterPanelMove();
    harness.movePanel('codebook.studyContext', 2);
    assert.equal(harness.groups.length, 2);
    assert.equal(harness.panelColumn('codebook.studyContext'), 2);

    // Act
    await harness.reader.action('arrange');

    // Assert
    assert.deepEqual([...harness.reader.inspect().view!.errors], []);
    assert.equal(harness.groups.length, 3);
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.sourceColumn(), 2);
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
  } finally { await harness.close(); }
});

for (const moveImmediately of [false, true]) test(`Arrange retains its source region after replay visibility cancels rendering and respects ${moveImmediately ? 'an immediate' : 'a later'} manual move`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    await harness.reader.open(); const draft = harness.addForeignDraft();
    const original = harness.groups.find(group => group.viewColumn === 2)!, destination = harness.groups.find(group => group.viewColumn === 3)!;
    harness.swapEditorGroups(original, destination);
    harness.invalidateNextSourceRender();

    // Act
    await harness.reader.action('arrange');
    if (moveImmediately) harness.moveSource(1);
    await harness.reader.action('source');

    // Assert
    assert.equal(harness.sourceColumn(), moveImmediately ? 1 : 2, harness.reader.inspect().view!.errors.join('\n'));
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
    harness.swapEditorGroups(original, destination);
    const held = harness.holdNextSource(); release = held.release;

    // Act
    const arranging = harness.reader.action('arrange'); await held.started;
    harness.reader['revision']++; release(); await arranging;

    // Assert
    assert.equal(harness.reader.inspect().view!.errors.some(error => error.includes('The selected source changed before it could be arranged')), true);
    await harness.reader.action('arrange'); await harness.reader.action('source');
    assert.equal(harness.sourceColumn(), 2, harness.reader.inspect().view!.errors.join('\n'));
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
  } finally { release(); await harness.close(); }
});

test('Source follows a learner move after Arrange while preserving the earlier duplicate and dirty draft', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  try {
    await harness.reader.open(); const draft = harness.addForeignDraft();
    const original = harness.groups.find(group => group.viewColumn === 2)!, destination = harness.groups.find(group => group.viewColumn === 3)!;
    harness.swapEditorGroups(original, destination);
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

test('cold Wiki entry reserves a second main pane without treating the separate chat part as its destination', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal);

    // Assert
    assert.equal(harness.groups.length, 3);
    assert.deepEqual(harness.groups[1]!.tabs, []);
    assert.equal(harness.groups[2]!.tabs.includes(chat.tab), true);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

for (const boundary of ['layout measurement', 'primary focus response'] as const) for (const interaction of ['selection', 'edit', 'none'] as const) test(interaction === 'none' ? `cold Wiki scope restores prior text focus after unchanged ${boundary}` : `cold Wiki scope preserves a newer primary ${interaction} during ${boundary}`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 490 }, { size: 490 }] });
  const chat = harness.addSeparateEditorPart();
  const primary = harness.focusMutableDraft('primary-notes.txt', 1), original = harness.focusMutableDraft('original-notes.txt', 2);
  const firstRead = boundary === 'primary focus response' ? harness.holdNextPrimaryFocusResponse() : harness.holdNextCommand('vscode.getEditorLayout');
  const opening = harness.reader.arrangeRepository(new AbortController().signal); void opening.catch(() => undefined);
  let releaseMeasured = () => {};
  try {
    await firstRead.started;
    const measured = boundary === 'primary focus response' ? firstRead : harness.holdNextCommand('vscode.getEditorLayout'); releaseMeasured = measured.release;
    if (boundary === 'layout measurement') { firstRead.release(); await measured.started; }
    assert.equal(harness.focusedSource()?.document.uri.toString(), primary.document.uri.toString());

    // Act
    if (interaction === 'selection') primary.editor.selections = [{ anchor: primary.editor.selections[0]!.active.with(27, 0), active: primary.editor.selections[0]!.active.with(27, 0) }];
    if (interaction === 'edit') primary.replaceContent('New learner text.\n');
    measured.release();

    // Assert
    if (interaction === 'none') { await opening; assert.equal(harness.focusedSource()?.document.uri.toString(), original.document.uri.toString()); }
    else {
      await assert.rejects(opening, /primary editor.*changed during scope measurement/i);
      assert.equal(harness.focusedSource()?.document.uri.toString(), primary.document.uri.toString());
      assert.equal(primary.editor.selections[0]!.active.line, interaction === 'selection' ? 27 : 22);
      assert.equal(primary.document.getText(), interaction === 'edit' ? 'New learner text.\n' : 'Original learner draft.\n');
    }
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(original.document.getText(), 'Original learner draft.\n'); assert.equal(harness.runtimes.length, 0);
  } finally { firstRead.release(); releaseMeasured(); await opening.catch(() => undefined); await harness.close(); }
});

for (const interaction of ['selection', 'other focus', 'none'] as const) test(`cold Wiki focus restoration ${interaction === 'none' ? 'keeps the unchanged learner reading position' : `preserves newer ${interaction} before its response arrives`}`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 490 }, { size: 490 }] });
  const chat = harness.addSeparateEditorPart();
  const primary = harness.focusMutableDraft('primary-notes.txt', 1), original = harness.focusMutableDraft('original-notes.txt', 2);
  harness.retainReadingRange(84, 96);
  let restored: Pick<typeof original.editor, 'selections'> | undefined;
  harness.changeAfterNextSourceDisplay(editor => {
    restored = editor;
    // Native display is already applied; learner input can precede the extension-host response and later selection RPC.
    if (interaction === 'selection') { editor.selections = [{ anchor: editor.selections[0]!.active.with(99, 0), active: editor.selections[0]!.active.with(99, 0) }]; original.editor.selections = editor.selections; harness.retainReadingRange(98, 110); }
    if (interaction === 'other focus') primary.focus();
  });
  try {
    // Act
    const opening = harness.reader.arrangeRepository(new AbortController().signal);
    if (interaction === 'none') await opening;
    else await assert.rejects(opening, /focus or selection changed while.*restored/i);

    // Assert
    assert.equal(harness.focusedSource()?.document.uri.toString(), interaction === 'other focus' ? primary.document.uri.toString() : original.document.uri.toString());
    assert.equal(restored?.selections[0]!.active.line, interaction === 'selection' ? 99 : 22);
    assert.equal(harness.isReadingLineVisible(interaction === 'selection' ? 104 : 90), true);
    assert.equal(original.document.getText(), 'Original learner draft.\n'); assert.equal(original.tab.isDirty, true);
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] }); assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('first Study entry reserves all three main panes when a separate chat part already occupies a global column', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  try {
    // Act
    await harness.reader.open();

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.groups.length, 4);
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.tab.isDirty, true);
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('a second cold Open Study reports busy without creating Context before the first native reservation completes', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  const held = harness.holdNextCommand('vscode.getEditorLayout'), first = harness.reader.open();
  let second: Promise<unknown> | undefined;
  const refreshProgress = harness.reader['refreshProgress'].bind(harness.reader);
  try {
    await held.started;
    let prepared = () => {};
    const preparation = new Promise<void>(resolve => { prepared = resolve; });
    harness.reader['refreshProgress'] = async () => { await refreshProgress(); prepared(); };

    // Act
    second = harness.reader.open().catch(error => error);
    await Promise.race([preparation, second]);
    await new Promise<void>(resolve => setImmediate(resolve));

    // Assert
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.reader.inspect().sourceUri, undefined);
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{}, {}] });
    assert.equal(harness.groups.length, 3); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    const duplicate = await second;
    assert.ok(duplicate instanceof Error && 'code' in duplicate); assert.equal(duplicate.code, 'BUSY');
    held.release(); await first;
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1); assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true); assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); await Promise.allSettled([first, second]); harness.reader['refreshProgress'] = refreshProgress; await harness.close(); }
});

test('a duplicate Open Study during initialization reports busy while the first entry remains usable', async () => {
  // Arrange
  const harness = await workspaceHarness(false), initialize = harness.reader['initialize'].bind(harness.reader);
  let release = () => {}, initializeCalls = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  harness.reader['initialize'] = async () => { initializeCalls++; await held; await initialize(); };
  const first = harness.reader.open();
  let second: Promise<unknown> | undefined;
  try {
    // Act
    second = harness.reader.open().catch(error => error);
    await new Promise<void>(resolve => setImmediate(resolve));

    // Assert
    assert.equal(initializeCalls, 1);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    const duplicate = await second;
    assert.ok(duplicate instanceof Error && 'code' in duplicate); assert.equal(duplicate.code, 'BUSY');
    release(); await first;
    assert.equal(harness.reader.inspect().opened, true);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.runtimes.length, 0);
  } finally { release(); await Promise.allSettled([first, second]); harness.reader['initialize'] = initialize; await harness.close(); }
});

test('a failed cold initialization allows the next explicit Open Study to retry', async () => {
  // Arrange
  const harness = await workspaceHarness(false), initialize = harness.reader['initialize'].bind(harness.reader);
  harness.reader['initialize'] = async () => { throw new Error('Learning storage is temporarily unavailable.'); };
  try {
    // Act
    await assert.rejects(harness.reader.open(), /Learning storage is temporarily unavailable/);
    harness.reader['initialize'] = initialize;
    await harness.reader.open();

    // Assert
    assert.equal(harness.reader.inspect().opened, true);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.runtimes.length, 0);
  } finally { harness.reader['initialize'] = initialize; await harness.close(); }
});

test('background refresh cannot open captured source into Application before cold Study reserves its panes', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  const arrange = harness.reader['arrange'].bind(harness.reader);
  let refreshed = false;
  harness.reader['arrange'] = async (...arguments_: Parameters<typeof arrange>) => {
    // Run the ordinary polling callback after admission but before the initial native reservation.
    if (!refreshed) { refreshed = true; await harness.reader['refresh'](); }
    return arrange(...arguments_);
  };
  try {
    // Act
    await harness.reader.open();
    // Assert
    assert.deepEqual({ ...harness.reader.presentationState().panes }, { appColumn: 1, sourceColumn: 2, contextColumn: 3 });
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.runtimes.length, 0);
  } finally { harness.reader['arrange'] = arrange; await harness.close(); }
});

test('first Study cannot confirm a learner source move that covers Application during final arrangement', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] });
  const arrange = harness.reader['arrange'].bind(harness.reader);
  harness.reader['arrange'] = async (...arguments_: Parameters<typeof arrange>) => {
    // The source is rendered before the final grid receipt; a learner move must not become successful placement.
    harness.moveSource(1);
    return arrange(...arguments_);
  };
  try {
    // Act
    await harness.reader.open();
    // Assert
    assert.deepEqual({ ...harness.reader.presentationState().panes }, { appColumn: 1, sourceColumn: 1, contextColumn: 3 });
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.equal(harness.runtimes.length, 0);
  } finally { harness.reader['arrange'] = arrange; await harness.close(); }
});

test('first Study entry waits for its explanation focus before confirming the final native layout', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.deferPanelFocus('codebook.studyContext', 1);
  try {
    // Act
    await harness.reader.open();
    // Assert
    assert.equal(harness.focusedPanel(), 'codebook.studyContext');
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
  } finally { await harness.close(); }
});

test('first Study entry confirms a visible explanation in the only editor part without a Context focus acknowledgement', async () => {
  // Arrange: another tab keeps native focus even after the Context tab becomes visible.
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const draft = harness.focusMutableDraft();
  harness.onNextPanel('codebook.studyContext', panel => {
    const reveal = panel.reveal.bind(panel);
    panel.reveal = (column, preserveFocus) => { reveal(column, preserveFocus); draft.focus(); };
  });
  try {
    // Act
    await harness.reader.open();
    // Assert: the owned three-pane layout is measured without adopting an unconfirmed focus receipt.
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.notEqual(harness.focusedPanel(), 'codebook.studyContext');
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
  } finally { await harness.close(); }
});

test('first Study entry refuses an unfocused explanation when a second editor part makes scope ambiguous', async () => {
  // Arrange: a separate chat editor part makes tab visibility insufficient to identify the main grid.
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  harness.addSeparateEditorPart();
  const draft = harness.focusMutableDraft();
  harness.onNextPanel('codebook.studyContext', panel => {
    const reveal = panel.reveal.bind(panel);
    panel.reveal = (column, preserveFocus) => { reveal(column, preserveFocus); draft.focus(); };
  });
  try {
    // Act / Assert: no layout proof is granted after the requested native focus fails.
    await assert.rejects(harness.reader.open(), /Study explanation native focus/);
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
  } finally { await harness.close(); }
});

test('first Study entry accepts its application tab registering during the initial native layout read', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.delayPanelRegistration('codebook.scopedBrowser', true);
  try {
    // Act
    await harness.reader.open();
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.groups.length, 4);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

for (const textReceipt of ['retained', 'cleared', 'cleared before registration', 'cleared during layout'] as const) test(`cold Study opens from Wiki when the covered background text receipt is ${textReceipt}`, async () => {
  // Arrange: ordinary VS Code keeps the most recent text editor while Wiki owns another group.
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const draft = harness.focusMutableDraft(), held = harness.holdTextFocusClear('codebook.repositoryWiki');
  const wiki = harness.openWiki(), registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const layout = textReceipt === 'cleared during layout' ? harness.holdNextCommand('vscode.getEditorLayout') : undefined;
  const opening = harness.reader.open(); void opening.catch(() => undefined);
  try {
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    assert.equal(harness.groups[1]!.activeTab, wiki.nativeTab);
    assert.equal(harness.focusedSource(), draft.editor);
    // Act: creation covers that background editor without changing the native Wiki tab.
    if (textReceipt === 'cleared before registration') { held.release(); await waitUntil(() => harness.focusedSource() === undefined, 'early background text clear', 1_000); }
    registerPanel();
    if (textReceipt === 'cleared') { held.release(); await Promise.resolve(); }
    if (layout) { await layout.started; held.release(); await waitUntil(() => harness.focusedSource() === undefined, 'late background text clear', 1_000); layout.release(); }
    await opening;
    // Assert
    assert.equal(harness.reader.presentationState().state, 'open');
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.groups.some(group => group.tabs.includes(wiki.nativeTab)), true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); registerPanel(); layout?.release(); await opening.catch(() => undefined); await harness.close(); }
});

for (const clearAt of ['before registration', 'during layout'] as const) for (const departure of ['different webview', 'webview roundtrip', 'different text', 'text roundtrip'] as const) test(`cold Wiki-to-Study layout preserves ${departure} when background text clears ${clearAt}`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] });
  const draft = harness.focusMutableDraft(), otherWiki = harness.openWiki(); draft.focus();
  const held = harness.holdTextFocusClear('codebook.repositoryWiki'), wiki = harness.openWiki();
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser'), layout = harness.holdNextCommand('vscode.getEditorLayout');
  const opening = harness.reader.open(), rejected = assert.rejects(opening, /Native pane, group or focus changed/);
  try {
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    if (clearAt === 'before registration') { held.release(); await waitUntil(() => harness.focusedSource() === undefined, 'early background text clear', 1_000); }
    registerPanel(); await layout.started;
    // Act: the clear belongs to background coverage, but the native Wiki tab no longer belongs to this Open.
    held.release(); await waitUntil(() => harness.focusedSource() === undefined, 'late background text clear', 1_000);
    if (departure.includes('text')) draft.focus();
    else harness.focusExistingWebviewTab(otherWiki.nativeTab);
    if (departure.endsWith('roundtrip')) harness.focusExistingWebviewTab(wiki.nativeTab);
    layout.release(); await rejected;
    // Assert
    assert.equal(harness.groups[1]!.activeTab, departure === 'different webview' ? otherWiki.nativeTab : wiki.nativeTab);
    assert.equal(harness.groups[1]!.tabs.includes(wiki.nativeTab), true);
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.reader.presentationState().state, 'closed');
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); registerPanel(); layout.release(); await opening.catch(() => undefined); await harness.close(); }
});

for (const replaceAt of ['registration', 'layout'] as const) test(`cold Study rejects closing Wiki and opening a lookalike during ${replaceAt}`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] });
  const draft = harness.focusMutableDraft(), held = harness.holdTextFocusClear('codebook.repositoryWiki'), wiki = harness.openWiki();
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const layout = replaceAt === 'layout' ? harness.holdNextCommand('vscode.getEditorLayout') : undefined;
  const opening = harness.reader.open(), rejected = assert.rejects(opening, /Native pane|Native panes/);
  try {
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    held.release(); await waitUntil(() => harness.focusedSource() === undefined, 'background text clear', 1_000);
    if (layout) { registerPanel(); await layout.started; }
    // Act: identical type/title/content cannot confer the closed tab's focus ownership on a new tab.
    const replacement = harness.replaceActiveWebviewTab(); registerPanel(); layout?.release(); await rejected;
    // Assert
    assert.equal(harness.groups[1]!.activeTab, replacement);
    assert.equal(harness.groups[1]!.tabs.includes(wiki.nativeTab), false);
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.reader.presentationState().state, 'closed');
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); registerPanel(); layout?.release(); await opening.catch(() => undefined); await harness.close(); }
});

test('failed cold application creation releases temporary native listeners and preserves learner panes', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const draft = harness.focusMutableDraft(), listeners = harness.focusListenerCount();
  harness.failNextPanelCreation('codebook.scopedBrowser');
  try {
    // Act
    await assert.rejects(harness.reader.open(), /Injected native panel creation failure/);
    // Assert
    assert.equal(harness.focusListenerCount(), listeners);
    assert.equal(harness.groups[0]!.activeTab, draft.tab);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.counts().panels, 0);
    assert.equal(harness.runtimes.length, 0);
    assert.equal(harness.reader.presentationState().state, 'closed');
  } finally { await harness.close(); }
});

test('presentation preserves a replacement Wiki while its prior background source receipt remains visible', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let releaseCapture = () => {}, releaseText = () => {}, changing: Promise<unknown> | undefined;
  try {
    await harness.reader.open();
    const draft = harness.focusMutableDraft('background-notes.txt', 1);
    const held = harness.holdTextFocusClear('codebook.repositoryWiki'); releaseText = held.release;
    harness.openWiki();
    const panel = harness.reader['contextPanel']; assert.ok(panel);
    const originalPost = panel.webview.postMessage.bind(panel.webview), state = harness.reader.presentationState();
    let observed!: () => void;
    const captureStarted = new Promise<void>(resolve => { observed = resolve; });
    panel.webview.postMessage = message => {
      if (message.type !== 'capture-presentation-pose') return originalPost(message);
      releaseCapture = () => { void originalPost(message); }; observed(); return Promise.resolve(true);
    };
    changing = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    const rejected = assert.rejects(changing, { code: 'PRESENTATION_UNAVAILABLE', causeDetail: /Native pane, group or focus changed/ });
    await captureStarted;
    const commandsBeforeDeparture = [...harness.commands];
    // Act: a group wrapper can legitimately refresh after a learner closes the old Wiki and opens a new one.
    const replacement = harness.replaceActiveWebviewTab(); harness.replaceEditorGroup('wrapper', 2);
    releaseCapture(); await rejected;
    // Assert
    assert.equal(harness.groups[1]!.activeTab, replacement);
    assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    assert.equal(harness.presentationPreferences.size, 0);
    assert.equal(harness.runtimes.length, 0);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(harness.commands, commandsBeforeDeparture);
  } finally { releaseCapture(); releaseText(); await changing?.catch(() => undefined); await harness.close(); }
});

for (const refreshAt of ['registration', 'layout'] as const) test(`cold Study accepts a verified Wiki group and tab wrapper refresh during ${refreshAt}`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const draft = harness.focusMutableDraft(), held = harness.holdTextFocusClear('codebook.repositoryWiki');
  const wiki = harness.openWiki();
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const layout = refreshAt === 'layout' ? harness.holdNextCommand('vscode.getEditorLayout') : undefined;
  const opening = harness.reader.open(); void opening.catch(() => undefined);
  try {
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    held.release(); await waitUntil(() => harness.focusedSource() === undefined, 'background text clear', 1_000);
    if (layout) { registerPanel(); await layout.started; }
    // Act: the host reports changed wrappers without closing or opening the underlying Wiki tab.
    wiki.refreshTabWrapper(); harness.replaceEditorGroup('wrapper', 2); registerPanel(); layout?.release(); await opening;
    // Assert
    assert.equal(harness.reader.presentationState().state, 'open');
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); registerPanel(); layout?.release(); await opening.catch(() => undefined); await harness.close(); }
});

test('cold Wiki-to-Study registration rejects clearing text in a group the new application does not cover', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] });
  const draft = harness.focusMutableDraft('third-group-notes.txt', 3), held = harness.holdTextFocusClear('codebook.repositoryWiki');
  const wiki = harness.openWiki(), registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const opening = harness.reader.open(), rejected = assert.rejects(opening, /Native panes or learner focus changed/);
  try {
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    // Act: this clear cannot be explained by the requested first-column application.
    registerPanel(); held.release(); await rejected;
    // Assert
    assert.equal(harness.groups[1]!.activeTab, wiki.nativeTab);
    assert.equal(harness.groups[2]!.activeTab, draft.tab);
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.reader.presentationState().state, 'closed');
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); registerPanel(); await opening.catch(() => undefined); await harness.close(); }
});

for (const departure of ['different webview', 'webview roundtrip', 'different text', 'text roundtrip'] as const) test(`${departure} during cold Wiki-to-Study registration preserves the newer learner choice`, async () => {
  // Arrange: both webviews already exist, so switching them does not change tab contents or group count.
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}] });
  const otherDraft = harness.focusMutableDraft('other-notes.txt', 2), source = harness.focusMutableDraft();
  const otherWiki = harness.openWiki(); source.focus();
  const held = harness.holdTextFocusClear('codebook.repositoryWiki'), wiki = harness.openWiki();
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const opening = harness.reader.open();
  const rejected = assert.rejects(opening, /Native panes or learner focus changed/);
  try {
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    // Act: deliver an actual tab-only event; unchanged background text cannot hide a newer webview choice.
    if (departure.includes('text')) otherDraft.focus();
    else harness.focusExistingWebviewTab(otherWiki.nativeTab);
    if (departure.endsWith('roundtrip')) harness.focusExistingWebviewTab(wiki.nativeTab);
    registerPanel(); await rejected;
    // Assert
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.reader.presentationState().state, 'closed');
    assert.equal(source.document.getText(), 'Original learner draft.\n');
    assert.equal(otherDraft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.groups[1]!.tabs.includes(otherDraft.tab), true);
    assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); registerPanel(); await opening.catch(() => undefined); await harness.close(); }
});

test('first Study entry does not resize chat while a new application panel only reports optimistic focus', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const focus = harness.holdNextCommand('workbench.action.focusFirstEditorGroup');
  chat.focus();
  const opening = harness.reader.open(); void opening.catch(() => undefined);
  try {
    // Act
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    // Assert: provisional wrapper flags must not authorize a layout command against the still-focused chat part.
    assert.equal(harness.commands.includes('workbench.action.focusFirstEditorGroup'), false);
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    registerPanel(); await focus.started; focus.release(); await opening;
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
  } finally { registerPanel(); focus.release(); await opening.catch(() => undefined); await harness.close(); }
});

test('chat focus acquired during application registration prevents first Study from arranging either editor part', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const opening = harness.reader.open();
  const rejected = assert.rejects(opening, /learner focus changed while the new application registered/);
  try {
    // Act
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    chat.focus(); registerPanel(); await rejected;
    // Assert
    assert.equal(chat.focused(), true);
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.commands.includes('workbench.action.focusFirstEditorGroup'), false);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true);
  } finally { registerPanel(); await opening.catch(() => undefined); await harness.close(); }
});

for (const change of ['foreign tab', 'replacement group'] as const) test(`a ${change} during application registration prevents first Study from adopting the changed layout`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const opening = harness.reader.open();
  const rejected = assert.rejects(opening, /Native panes or learner focus changed/);
  try {
    // Act
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    if (change === 'foreign tab') harness.addForeignDraft(1);
    else harness.resyncEditorGroups('replace');
    registerPanel(); await rejected;
    // Assert
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { registerPanel(); await opening.catch(() => undefined); await harness.close(); }
});

for (const retirement of ['cancel', 'Close'] as const) test(`${retirement} during application registration cannot reserve panes after the late native tab appears`, async () => {
  // Arrange
  const harness = await workspaceHarness(false), cancellation = new AbortController();
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const opening = harness.reader.open(cancellation.signal);
  const rejected = assert.rejects(opening, retirement === 'cancel' ? /abort/i : /closed/i);
  try {
    // Act
    await waitUntil(() => harness.panelColumn('codebook.scopedBrowser') !== undefined, 'pending native application', 1_000);
    if (retirement === 'cancel') cancellation.abort();
    const closing = retirement === 'Close' ? harness.reader.close() : Promise.resolve();
    registerPanel(); await rejected; await closing;
    // Assert
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
  } finally { await opening.catch(() => undefined); await harness.close(); }
});

test('an existing three-pane Study can restore its presentation while preserving a separate chat part', async () => {
  // Arrange
  const harness = await workspaceHarness();
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] });
  const chat = harness.addSeparateEditorPart();
  try {
    await harness.reader.open();
    const presentation = harness.reader.presentationState();

    // Act
    const result = await harness.reader.changePresentation({ presentationId: presentation.presentationId, expectedRevision: presentation.presentationControlRevision, mode: 'living-book', action: 'restore' });

    // Assert
    assert.equal(result.mode, 'living-book'); assert.equal(result.layoutConfirmed, true);
    assert.equal(harness.groups.length, 4); assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('Wiki entry from a retained Study keeps Context focus when the native primary webview emits a late focus event', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  await harness.reader.open();
  harness.deferPrimaryFocusEcho();
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal);
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{}, {}, {}] });
    assert.equal(harness.focusedPanel(), 'codebook.studyContext');
    assert.equal(harness.groups.length, 4); assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('Wiki entry from focused chat preserves its separate pane when its layout read reports a stale matching main grid', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] });
  const chat = harness.addSeparateEditorPart();
  const draft = harness.focusMutableDraft();
  await harness.reader.open(); chat.focus();
  // Fault injection changes only the API report; the separate part still contains exactly one real native group.
  harness.reportSeparatePartLayout({ orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal);
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{}, {}, {}] });
    // Explicit Wiki navigation establishes main focus; foreign chat contents and geometry remain untouched.
    assert.equal(chat.focused(), false);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.groups.length, 4); assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('a real fourth main pane remains learner-owned even when its tab list is empty and a separate chat part exists', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 220 }, { size: 220 }, { size: 220 }, { size: 220 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft(), originalLayout = harness.editorLayout();
  try {
    // Act
    await harness.reader.open();

    // Assert
    assert.deepEqual(harness.editorLayout(), originalLayout);
    assert.equal(harness.groups.length, 5); assert.deepEqual(harness.groups[3]!.tabs, []);
    assert.equal(harness.groups[4]!.tabs.includes(chat.tab), true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.reader.inspect().view!.errors.some(error => error.includes('Existing editor groups were preserved')), true);
  } finally { await harness.close(); }
});

test('cold Wiki entry from the focused chat measures and reserves only the main editor grid', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  const receipts: ReturnType<typeof harness.retainRepositoryFocus>[] = [];
  chat.focus();
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal, undefined, { begin() {}, retainCurrentFocus(acquire) {
      const receipt = harness.retainRepositoryFocus(acquire); receipts.push(receipt); return receipt;
    } });
    // Assert
    assert.equal(harness.groups.length, 3); assert.equal(harness.groups[2]!.tabs.includes(chat.tab), true);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.commands.filter(command => command === 'workbench.action.focusFirstEditorGroup').length, 1);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { for (const receipt of receipts) receipt.dispose(); await harness.close(); }
});

for (const primary of ['blank', 'settings'] as const) test(`cold Wiki resolves ${primary} primary focus through its real citation while retaining the draft and chat part`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 1, groups: [{ size: 330 }, { size: 330 }] });
  const original = harness.groups[0]!, opaqueTab = harness.useOpaquePrimary(primary), draft = harness.addForeignDraft(2);
  const chat = harness.addSeparateEditorPart(); chat.focus(); let acquisitions = 0;
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal, undefined, { begin() {}, acquireSourceFocus: async () => {
      acquisitions++; harness.focusMutableDraft(); return () => { assert.equal(chat.focused(), false); };
    }, retainCurrentFocus() {
      const focused = chat.focused(); let disposed = false;
      return { dispose() { disposed = true; }, assertRetained() { assert.equal(disposed, false); assert.equal(chat.focused(), focused); } };
    } });
    // Assert
    assert.equal(acquisitions, 1); assert.equal(harness.groups[0], original);
    if (opaqueTab) assert.equal(original.tabs.includes(opaqueTab), true);
    assert.equal(harness.groups[1]!.tabs.includes(draft), true); assert.equal(draft.isDirty, true);
    assert.equal(harness.groups[2]!.tabs.includes(chat.tab), true); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false); assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('opening Wiki after Study acquires its citation from a Settings-focused main pane without changing chat or drafts', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  await harness.reader.open();
  const retainedTabs = [...harness.groups[0]!.tabs], settings = harness.useOpaquePrimary('settings');
  harness.groups[0]!.tabs.push(...retainedTabs); chat.focus();
  let acquisitions = 0;
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal, undefined, { begin() {}, acquireSourceFocus: async () => {
      acquisitions++; harness.focusMutableDraft(); return () => { assert.equal(chat.focused(), false); };
    } });
    // Assert
    assert.equal(acquisitions, 1); assert.equal(harness.groups.length, 4);
    assert.equal(harness.groups[0]!.tabs.includes(settings!), true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{}, {}, {}] }); assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

for (const primary of ['application', 'text']) test(`a learner tab selected while borrowing ${primary} primary focus prevents a late Wiki arrangement or focus restoration`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  await harness.reader.open();
  if (primary === 'text') harness.focusMutableDraft('primary.ts');
  harness.movePanel('codebook.studyContext', 3);
  // A manual geometry change invalidates the retained scope proof and requires an observable primary-focus measurement.
  harness.changeEditorLayout({ orientation: 1, groups: [{ size: 200 }, { size: 300 }, { size: 400 }] });
  const original = harness.editorLayout(), mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
  const held = harness.holdNextCommand('workbench.action.focusFirstEditorGroup');
  const arranging = harness.reader.arrangeRepository(new AbortController().signal), rejected = assert.rejects(arranging, /primary editor selection changed/i);
  try {
    // Act
    await held.started; draft.focus(); held.release(); await rejected;
    // Assert
    assert.equal(harness.groups[0]!.activeTab, draft.tab); assert.equal(harness.focusedPanel(), undefined);
    assert.deepEqual(harness.editorLayout(), original);
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] }); assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); await arranging.catch(() => {}); await harness.close(); }
});

test('a queued Wiki after Study preserves later learner focus before measuring an owned layout', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const draft = harness.focusMutableDraft(), chat = harness.addSeparateEditorPart();
  await harness.reader.open(); const original = harness.editorLayout(), mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
  const held = harness.holdNextCommand('vscode.getEditorLayout');
  const earlier = harness.reader.arrangeRepository(new AbortController().signal), earlierRejected = assert.rejects(earlier, /changed/);
  await held.started; let retained = true, starts = 0;
  const queued = harness.reader.arrangeRepository(new AbortController().signal, undefined, { begin() { starts++; if (!retained) throw new Error('Original learner focus changed.'); } });
  const queuedRejected = assert.rejects(queued, /Original learner focus changed/);
  try {
    // Act
    retained = false; chat.focus(); held.release(); await earlierRejected; await queuedRejected;
    // Assert
    assert.equal(starts, 1); assert.equal(chat.focused(), true); assert.deepEqual(harness.editorLayout(), original);
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] }); assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); await Promise.allSettled([earlier, queued]); await harness.close(); }
});

test('cold Wiki retains ordinary text focus without invoking the optional cited-source acquisition', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  harness.focusMutableDraft(); const chat = harness.addSeparateEditorPart(); let acquisitions = 0;
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal, undefined, { begin() {}, acquireSourceFocus: async () => { acquisitions++; return () => {}; } });
    // Assert
    assert.equal(acquisitions, 0); assert.equal(harness.groups.length, 3); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
  } finally { await harness.close(); }
});

for (const origin of ['chat', 'secondary text'] as const) for (const boundary of ['primary response', 'main measurement'] as const) for (const interaction of ['tab roundtrip', 'selection roundtrip', 'none'] as const) test(`cold Wiki from ${origin} ${interaction === 'none' ? 'keeps its intentional focus handoff' : `remembers learner ${interaction}`} during ${boundary}`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{ size: 490 }, { size: 490 }] });
  const chat = harness.addSeparateEditorPart(), alternate = harness.focusMutableDraft('alternate.txt', 1), primary = harness.focusMutableDraft('primary.txt', 1), original = harness.focusMutableDraft('original.txt', 2);
  if (origin === 'chat') chat.focus();
  const listenerCount = harness.focusListenerCount(), receipts: ReturnType<typeof harness.retainRepositoryFocus>[] = [];
  const focus = { begin() {}, retainCurrentFocus(acquire?: Parameters<typeof harness.retainRepositoryFocus>[0]) { const receipt = harness.retainRepositoryFocus(acquire); receipts.push(receipt); return receipt; } };
  const held = boundary === 'primary response' ? harness.holdNextPrimaryFocusResponse() : harness.holdNextCommand('vscode.getEditorLayout');
  let measured: ReturnType<typeof harness.holdNextCommand> | undefined;
  const opening = harness.reader.arrangeRepository(new AbortController().signal, undefined, focus);
  const outcome = interaction === 'none' ? opening : assert.rejects(opening, /focus changed/);
  try {
    await held.started;
    if (boundary === 'main measurement') { measured = harness.holdNextCommand('vscode.getEditorLayout'); held.release(); await measured.started; }
    assert.equal(harness.focusedSource()?.document.uri.toString(), primary.document.uri.toString());
    // Act
    if (interaction === 'tab roundtrip') { alternate.focus(); primary.focus(); }
    if (interaction === 'selection roundtrip') { const selections = primary.editor.selections; primary.editor.selections = [{ anchor: selections[0]!.anchor.with(7, 0), active: selections[0]!.active.with(7, 0) }]; primary.editor.selections = selections; }
    measured?.release(); held.release(); await outcome;
    // Assert
    assert.equal(harness.focusedSource()?.document.uri.toString(), interaction === 'none' && origin === 'secondary text' ? original.document.uri.toString() : primary.document.uri.toString());
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false); assert.equal(harness.runtimes.length, 0);
    assert.equal(primary.document.getText(), 'Original learner draft.\n'); assert.equal(original.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
  } finally { measured?.release(); held.release(); await opening.catch(() => undefined); for (const receipt of receipts) receipt.dispose(); assert.equal(harness.focusListenerCount(), listenerCount); await harness.close(); }
});

for (const order of ['editor first', 'group first'] as const) test(`cold Wiki accepts the intended primary transition when native notifications arrive ${order}`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{ size: 490 }, { size: 490 }] });
  const chat = harness.addSeparateEditorPart(), primary = harness.focusMutableDraft('primary.txt', 1), original = harness.focusMutableDraft('original.txt', 2);
  harness.usePrimaryFocusNotificationOrder(order);
  const listenerCount = harness.focusListenerCount(), receipts: ReturnType<typeof harness.retainRepositoryFocus>[] = [];
  const focus = { begin() {}, retainCurrentFocus(acquire?: Parameters<typeof harness.retainRepositoryFocus>[0]) { const receipt = harness.retainRepositoryFocus(acquire); receipts.push(receipt); return receipt; } };
  try {
    // Act
    await harness.reader.arrangeRepository(new AbortController().signal, undefined, focus);
    // Assert
    assert.equal(harness.focusedSource()?.document.uri.toString(), original.document.uri.toString());
    assert.equal(harness.commands.filter(command => command === 'workbench.action.focusFirstEditorGroup').length, 1);
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false); assert.equal(primary.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
  } finally { for (const receipt of receipts) receipt.dispose(); assert.equal(harness.focusListenerCount(), listenerCount); await harness.close(); }
});

for (const interaction of ['chat', 'chat roundtrip', 'selection roundtrip', 'none'] as const) test(`cold Wiki ${interaction === 'none' ? 'accepts unchanged source' : `remembers learner ${interaction}`} before primary native focus arrives`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{ size: 490 }, { size: 490 }] });
  const chat = harness.addSeparateEditorPart(), primary = harness.focusMutableDraft('primary.txt', 1), original = harness.focusMutableDraft('original.txt', 2);
  const listenerCount = harness.focusListenerCount(), receipts: ReturnType<typeof harness.retainRepositoryFocus>[] = [];
  const focus = { begin() {}, retainCurrentFocus(acquire?: Parameters<typeof harness.retainRepositoryFocus>[0]) { const receipt = harness.retainRepositoryFocus(acquire); receipts.push(receipt); return receipt; } };
  const held = harness.holdNextCommand('workbench.action.focusFirstEditorGroup'); let restored = false;
  harness.changeAfterNextSourceDisplay(() => { restored = true; });
  const opening = harness.reader.arrangeRepository(new AbortController().signal, undefined, focus);
  const outcome = interaction === 'none' ? opening : assert.rejects(opening, /focus changed/);
  try {
    await held.started;
    // Act
    if (interaction === 'chat' || interaction === 'chat roundtrip') chat.focus();
    if (interaction === 'chat roundtrip') original.focus();
    if (interaction === 'selection roundtrip') { const selections = original.editor.selections; original.editor.selections = [{ anchor: selections[0]!.anchor.with(9, 0), active: selections[0]!.active.with(9, 0) }]; original.editor.selections = selections; }
    held.release(); await outcome;
    // Assert: an already issued native command may drain, but no later restoration or allocation may proceed.
    assert.equal(restored, interaction === 'none'); assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.focusedSource()?.document.uri.toString(), interaction === 'none' ? original.document.uri.toString() : primary.document.uri.toString());
    assert.equal(original.document.getText(), 'Original learner draft.\n'); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
  } finally { held.release(); await opening.catch(() => undefined); for (const receipt of receipts) receipt.dispose(); assert.equal(harness.focusListenerCount(), listenerCount); await harness.close(); }
});

for (const interaction of ['tab roundtrip', 'selection roundtrip', 'none'] as const) test(`cold Wiki restoration ${interaction === 'none' ? 'keeps its captured secondary editor' : `remembers learner ${interaction}`} before the native display response`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{ size: 490 }, { size: 490 }] });
  const chat = harness.addSeparateEditorPart(), primary = harness.focusMutableDraft('primary.txt', 1), original = harness.focusMutableDraft('original.txt', 2);
  const listenerCount = harness.focusListenerCount(), receipts: ReturnType<typeof harness.retainRepositoryFocus>[] = [];
  const focus = { begin() {}, retainCurrentFocus(acquire?: Parameters<typeof harness.retainRepositoryFocus>[0]) { const receipt = harness.retainRepositoryFocus(acquire); receipts.push(receipt); return receipt; } };
  let displayed = false;
  harness.changeAfterNextSourceDisplay(() => {
    displayed = true;
    if (interaction === 'tab roundtrip') { primary.focus(); original.focus(); }
    if (interaction === 'selection roundtrip') { const editor = harness.focusedSource()!, selections = editor.selections; editor.selections = [{ anchor: selections[0]!.anchor.with(8, 0), active: selections[0]!.active.with(8, 0) }]; editor.selections = selections; }
  });
  try {
    // Act
    const opening = harness.reader.arrangeRepository(new AbortController().signal, undefined, focus);
    if (interaction === 'none') await opening; else await assert.rejects(opening, /focus changed/);
    // Assert
    assert.equal(displayed, true); assert.equal(harness.focusedSource()?.document.uri.toString(), original.document.uri.toString());
    assert.equal(harness.focusedSource()?.selections[0]!.active.line, 22); assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(original.document.getText(), 'Original learner draft.\n'); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
  } finally { for (const receipt of receipts) receipt.dispose(); assert.equal(harness.focusListenerCount(), listenerCount); await harness.close(); }
});

for (const boundary of ['first measurement', 'split response', 'confirmation read'] as const) for (const interaction of ['selection', 'edit', 'chat', 'none'] as const) test(`cold Wiki ${boundary} ${interaction === 'none' ? 'retains ordinary text through accepted allocation' : `preserves newer learner ${interaction}`}`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const draft = harness.focusMutableDraft(), chat = harness.addSeparateEditorPart();
  const held = boundary === 'first measurement' ? harness.holdNextCommand('vscode.getEditorLayout') : harness.holdNextLayoutResponse();
  let confirmation: ReturnType<typeof harness.holdNextCommand> | undefined;
  const focus = { begin() {}, retainCurrentFocus() {
    const editor = harness.focusedSource(), version = draft.document.version, selections = JSON.stringify(editor?.selections);
    return { dispose() {}, assertRetained() { if (editor !== harness.focusedSource() || version !== draft.document.version || selections !== JSON.stringify(editor?.selections)) throw new Error('Native focus changed during cold Wiki reservation.'); } };
  } };
  const opening = harness.reader.arrangeRepository(new AbortController().signal, undefined, focus);
  const outcome = interaction === 'none' ? opening : assert.rejects(opening, /focus changed/);
  try {
    await held.started;
    if (boundary === 'confirmation read') { confirmation = harness.holdNextCommand('vscode.getEditorLayout'); held.release(); await confirmation.started; }
    // Act
    if (interaction === 'selection') draft.editor.selections = draft.editor.selections.map(selection => ({ anchor: selection.anchor.with(6, 0), active: selection.active.with(6, 0) }));
    if (interaction === 'edit') draft.replaceContent('My newer unsaved text.\n');
    if (interaction === 'chat') chat.focus();
    confirmation?.release(); held.release(); await outcome;
    // Assert
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(chat.focused(), interaction === 'chat'); assert.equal(harness.runtimes.length, 0);
    assert.equal(draft.document.getText(), interaction === 'edit' ? 'My newer unsaved text.\n' : 'Original learner draft.\n');
    if (interaction === 'selection') assert.equal(draft.editor.selections[0]!.active.line, 6);
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, boundary === 'first measurement' && interaction !== 'none' ? 0 : 1);
  } finally { confirmation?.release(); held.release(); await opening.catch(() => undefined); await harness.close(); }
});

test('a queued cold Wiki checks its original learner focus before any native scope work', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  harness.focusMutableDraft(); const chat = harness.addSeparateEditorPart(), held = harness.holdNextCommand('vscode.getEditorLayout');
  const earlier = harness.reader.arrangeRepository(new AbortController().signal), earlierRejected = assert.rejects(earlier, /changed/);
  await held.started; let starts = 0, retained = true;
  const queued = harness.reader.arrangeRepository(new AbortController().signal, undefined, { begin() { starts++; if (!retained) throw new Error('Original learner focus changed.'); } });
  const rejected = assert.rejects(queued, /Original learner focus changed/);
  try {
    // Act
    await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(starts, 0);
    retained = false; chat.focus(); held.release(); await earlierRejected; await rejected;
    // Assert
    assert.equal(starts, 1); assert.deepEqual(harness.commands, ['vscode.getEditorLayout']);
    assert.equal(chat.focused(), true); assert.equal(harness.groups.length, 2);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
  } finally { held.release(); await Promise.allSettled([earlier, queued]); await harness.close(); }
});

test('chat focus after cited-source acquisition prevents cold Wiki from reserving a late native pane', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] }); harness.useOpaquePrimary('settings');
  const chat = harness.addSeparateEditorPart(); chat.focus();
  let held: ReturnType<typeof harness.holdNextCommand> | undefined, acquired!: () => void;
  const started = new Promise<void>(resolve => { acquired = resolve; });
  const opening = harness.reader.arrangeRepository(new AbortController().signal, undefined, { begin() {}, acquireSourceFocus: async () => {
    harness.focusMutableDraft(); held = harness.holdNextCommand('vscode.getEditorLayout'); acquired();
    return () => { if (chat.focused()) throw new Error('Citation focus changed.'); };
  } }), rejected = assert.rejects(opening, /focus changed/);
  try {
    // Act
    await started; await held!.started; chat.focus(); held!.release(); await rejected;
    // Assert
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false); assert.equal(harness.groups.length, 2);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] }); assert.equal(chat.focused(), true);
  } finally { held?.release(); await opening.catch(() => undefined); await harness.close(); }
});

test('moving focus to chat during the cold Wiki measurement preserves both parts without a late layout mutation', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft(), original = harness.editorLayout();
  const held = harness.holdNextCommand('vscode.getEditorLayout');
  try {
    // Act
    const opening = harness.reader.arrangeRepository(new AbortController().signal), rejected = assert.rejects(opening, /focus changed/);
    await held.started; chat.focus(); held.release(); await rejected;
    // Assert
    assert.deepEqual(harness.editorLayout(), original); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(chat.focused(), true); assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
    assert.equal(harness.commands.includes('workbench.action.focusFirstEditorGroup'), false);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
  } finally { held.release(); await harness.close(); }
});

for (const retirement of ['cancel', 'Close'] as const) test(`${retirement} during cold Wiki scope measurement cannot mutate the main or chat part`, async () => {
  // Arrange
  const harness = await workspaceHarness(false), cancellation = new AbortController();
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft(), original = harness.editorLayout();
  const held = harness.holdNextCommand('vscode.getEditorLayout');
  try {
    // Act
    const opening = harness.reader.arrangeRepository(cancellation.signal), rejected = assert.rejects(opening, /abort|closed/i);
    await held.started;
    if (retirement === 'cancel') cancellation.abort();
    const closing = retirement === 'Close' ? harness.reader.close() : undefined;
    held.release(); await rejected; await closing;
    // Assert
    assert.deepEqual(harness.editorLayout(), original); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false); assert.equal(harness.counts().panels, 0);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); await harness.close(); }
});

test('cold Study reservation retains Cursor wrapper replacements without adopting the separate chat pane', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.useCursorGroupWrappers();
  try {
    // Act
    await harness.reader.open();
    // Assert
    assert.equal(harness.groups.length, 4); assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true);
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1); assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
  } finally { await harness.close(); }
});

test('cold Study reserves a third main pane before Context can target the existing chat column', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  try {
    // Act
    await harness.reader.open();
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1); assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.groups.length, 4); assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true);
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
  } finally { await harness.close(); }
});

test('a restored Living book preference positions its new application in the reserved main pane rather than the chat column', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.presentationPreferences.set('codebook.presentation.v1', { version: 1, mode: 'living-book' });
  const restored = harness.createReader();
  try {
    // Act
    await restored.open();
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2); assert.equal(harness.panelColumn('codebook.studyContext'), 1);
    assert.equal(harness.sourceColumn(), 3); assert.equal(restored.presentationState().layoutConfirmed, true);
    assert.equal(harness.groups.length, 4); assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
  } finally { await restored.dispose(); await harness.close(); }
});

test('Living book adopts an MCP-first application into its reserved main pane before confirming the initial layout', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.presentationPreferences.set('codebook.presentation.v1', { version: 1, mode: 'living-book' });
  const reader = harness.createReader(), viewport = reader.presentation.createViewport!('mcp-first-run', () => {}, () => {}, 'normal');
  try {
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    // Act
    await reader.open();
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2); assert.equal(harness.panelColumn('codebook.studyContext'), 1);
    assert.equal(harness.sourceColumn(), 3); assert.equal(reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.groups.length, 4); assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] }); assert.equal(harness.runtimes.length, 0);
  } finally { viewport.close(); await reader.dispose(); await harness.close(); }
});

test('MCP-first Study opens when its application covers the selected chat-like tab in the same editor group', async () => {
  // Arrange: Claude Code keeps an editor tab selected where the MCP-created Application appears.
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const chat = harness.openWiki(1);
  const reader = harness.createReader(), viewport = reader.presentation.createViewport!('mcp-chat-run', () => {}, () => {}, 'normal');
  try {
    // Act
    await reader.open();
    // Assert: Codebook's own Application selection can be attributed without changing the chat tab.
    assert.equal(reader.presentationState().state, 'open');
    assert.equal(reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.groups.some(group => group.tabs.includes(chat.nativeTab)), true);
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), true);
  } finally { viewport.close(); await reader.dispose(); await harness.close(); }
});

test('MCP-first Study preserves a newer chat tab choice during application registration', async () => {
  // Arrange: both tabs already exist, so a focus roundtrip does not change group contents.
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const other = harness.openWiki(1), chat = harness.openWiki(1);
  const registerPanel = harness.delayPanelRegistration('codebook.scopedBrowser');
  const reader = harness.createReader(), viewport = reader.presentation.createViewport!('mcp-chat-run', () => {}, () => {}, 'normal');
  try {
    // Act: the learner visits another existing tab before the Application finishes registering.
    harness.focusExistingWebviewTab(other.nativeTab);
    harness.focusExistingWebviewTab(chat.nativeTab);
    registerPanel();
    // Assert: returning to the original tab cannot make the later Application selection owned.
    await assert.rejects(reader.open(), /Native panes or learner focus changed/);
    assert.equal(harness.groups[0]!.tabs.includes(other.nativeTab), true);
    assert.equal(harness.groups[0]!.tabs.includes(chat.nativeTab), true);
    assert.equal(harness.commands.includes('vscode.setEditorLayout'), false);
  } finally { registerPanel(); viewport.close(); await reader.dispose(); await harness.close(); }
});

test('Living book preserves a learner move of its MCP-first application before the initial Open', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 320 }, { size: 320 }, { size: 340 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.presentationPreferences.set('codebook.presentation.v1', { version: 1, mode: 'living-book' });
  const reader = harness.createReader(), viewport = reader.presentation.createViewport!('mcp-first-run', () => {}, () => {}, 'normal');
  harness.movePanel('codebook.scopedBrowser', 1);
  try {
    // Act
    await reader.open();
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1); assert.equal(harness.panelColumn('codebook.studyContext'), 1);
    assert.equal(harness.sourceColumn(), 3); assert.equal(harness.groups.length, 4);
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { viewport.close(); await reader.dispose(); await harness.close(); }
});

test('Living book retry after an accepted reservation is cancelled separates its application from the explanation', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.presentationPreferences.set('codebook.presentation.v1', { version: 1, mode: 'living-book' });
  const reader = harness.createReader(), cancellation = new AbortController(), held = harness.holdNextCommand('runCommands');
  const opening = reader.open(cancellation.signal), rejected = assert.rejects(opening, /abort/i);
  try {
    // Act
    await held.started; cancellation.abort(); held.release(); await rejected;
    assert.equal(reader.inspect().opened, false); assert.equal(harness.groups.length, 4);
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    await reader.open();
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2); assert.equal(harness.panelColumn('codebook.studyContext'), 1);
    assert.equal(harness.sourceColumn(), 3); assert.equal(reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] }); assert.equal(harness.runtimes.length, 0);
  } finally { held.release(); await opening.catch(() => undefined); await reader.dispose(); await harness.close(); }
});

for (const mode of ['study-workspace', 'living-book'] as const) test(`an explicit ${mode} Open retry after a failed passive scope read still reserves separate main Study panes`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.presentationPreferences.set('codebook.presentation.v1', { version: 1, mode });
  const reader = harness.createReader();
  harness.failNextCommand('vscode.getEditorLayout');
  try {
    // Act
    await assert.rejects(reader.open(), /Native layout command failed/);
    assert.equal(reader.inspect().opened, false);
    await reader.open();
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), mode === 'living-book' ? 2 : 1); assert.equal(harness.panelColumn('codebook.studyContext'), mode === 'living-book' ? 1 : 3);
    assert.equal(harness.sourceColumn(), mode === 'living-book' ? 3 : 2); assert.equal(reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.groups.length, 4); assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.runtimes.length, 0);
  } finally { await reader.dispose(); await harness.close(); }
});

for (const operation of ['read', 'reselect'] as const) test(`a presentation ${operation} from chat reports unverified scope without stealing focus or invalidating the retained main grid`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(); harness.focusMutableDraft();
  try {
    await harness.reader.open(); const state = harness.reader.presentationState(), layout = harness.editorLayout();
    assert.equal(state.layoutConfirmed, true); chat.focus();
    // Act
    if (operation === 'read') {
      const result = await harness.reader.readPresentationState();
      assert.equal(result.layoutConfirmed, false); assert.match(result.reason!, /without changing focus/);
      assert.equal(result.presentationControlRevision, 0); assert.equal(result.presentationId, state.presentationId);
    } else await assert.rejects(harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'select' }), /cannot be checked from the current editor part/);
    // Assert
    assert.equal(chat.focused(), true); assert.deepEqual(harness.reader.presentationState(), state);
    assert.deepEqual(harness.editorLayout(), layout); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.runtimes.length, 0); assert.equal(harness.groups.length, 4);
    harness.movePanel('codebook.studyContext', 3);
    assert.equal((await harness.reader.readPresentationState()).layoutConfirmed, true);
    // Actual main geometry changes still invalidate confirmation after focus returns to the measured part.
    harness.changeEditorLayout({ orientation: 0, groups: [{ size: 0.2 }, { size: 0.2 }, { size: 0.6 }] });
    assert.equal((await harness.reader.readPresentationState()).layoutConfirmed, false);
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
  } finally { await harness.close(); }
});

test('a presentation read preserves changed learner focus and does not certify the returned editor part', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
  const chat = harness.addSeparateEditorPart(); harness.focusMutableDraft();
  let release = () => {};
  try {
    await harness.reader.open(); const state = harness.reader.presentationState();
    const held = harness.holdNextCommand('vscode.getEditorLayout'); release = held.release;
    // Act
    const reading = harness.reader.readPresentationState(); await held.started; chat.focus(); release();
    const result = await reading;
    // Assert
    assert.equal(result.layoutConfirmed, false); assert.equal(chat.focused(), true);
    assert.deepEqual(harness.reader.presentationState(), state); assert.equal(harness.runtimes.length, 0);
  } finally { release(); await harness.close(); }
});

test('an older presentation read cannot suppress original focus recovery after a newer mode change fails', async () => {
  // Arrange: the owned replacement uses the source anchor while its final layout command is pending.
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let releaseRead = () => {}, releaseKeep = () => {};
  try {
    await harness.reader.open(); const state = harness.reader.presentationState();
    const applicationTab = harness.groups.flatMap(group => group.tabs).find(tab => 'viewType' in tab.input && tab.input.viewType === 'codebook.scopedBrowser');
    assert.ok(applicationTab); applicationTab.isPreview = true;
    const source = harness.reader.inspect().sourceUri, draft = harness.addForeignDraft();
    assert.equal(harness.focusedPanel(), 'codebook.studyContext');
    const heldRead = harness.holdNextCommand('vscode.getEditorLayout'); releaseRead = heldRead.release;
    const reading = harness.reader.readPresentationState(); await heldRead.started;
    const heldKeep = harness.holdNextCommand('vscode.setEditorLayout'); releaseKeep = heldKeep.release;
    // Act: the obsolete passive read settles after the newer transition has borrowed native focus.
    const changing = assert.rejects(harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' }), {
      code: 'PRESENTATION_UNAVAILABLE', causeDetail: 'Error: Native layout command failed',
    });
    await heldKeep.started; assert.equal(harness.focusedPanel(), undefined);
    releaseRead(); const result = await reading;
    harness.failNextCommand('vscode.setEditorLayout'); releaseKeep(); await changing;
    // Assert: the failed mode leaves its original focus and evidence intact without saving a new preference.
    assert.equal(result.layoutConfirmed, false); assert.equal(harness.focusedPanel(), 'codebook.studyContext');
    assert.equal(harness.reader.presentationState().mode, 'study-workspace'); assert.equal(harness.presentationPreferences.size, 0);
    assert.equal(harness.reader.inspect().sourceUri, source); assert.equal(harness.groups.some(group => group.tabs.includes(draft)), true);
    assert.equal(draft.isDirty, true); assert.equal(harness.runtimes.length, 0);
  } finally { releaseRead(); releaseKeep(); await harness.close(); }
});

test('first configured Study pause keeps captured source visible beside the application without manual Arrange', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness();
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    // Act
    await harness.start(); await harness.reader.action('click');

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
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

test('compact Study opens a readable explanation when native minimum widths prevent the requested split', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] }); harness.constrainStudyGrid();
  harness.suppressNativeInnerFocus();
  const draft = harness.focusMutableDraft();
  try {
    // Act
    await harness.reader.open();

    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.sourceColumn(), 2);
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.focusedPanel(), 'codebook.studyContext');
    assert.equal(harness.maximizedEditorGroup(), true);
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.match(harness.reader.presentationState().reason ?? '', /focused explanation/i);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft.tab)), true);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
  } finally { await harness.close(); }
});

test('compact Study remains open when its optional first explanation read loses window focus', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] }); harness.constrainStudyGrid();
  const readStudyPane = harness.reader['readStudyPane'].bind(harness.reader);
  harness.reader['readStudyPane'] = (region, signal) => {
    harness.changeWindowFocus(false);
    return readStudyPane(region, signal);
  };
  try {
    // Act
    await harness.reader.open();

    // Assert
    assert.equal(harness.reader.inspect().opened, true);
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.sourceColumn(), 2);
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.equal(harness.reader.inspect().view!.errors.some(error => error.includes('Focus the Codebook work window')), true);
  } finally { harness.changeWindowFocus(true); await harness.close(); }
});

test('Read Explanation opens Study when the command runs before Open Study Workspace', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    assert.equal(harness.reader.inspect().opened, false);

    // Act
    await harness.reader.action('read-context');

    // Assert
    assert.equal(harness.reader.inspect().opened, true);
    assert.equal(harness.focusedPanel(), 'codebook.studyContext');
    assert.equal(harness.maximizedEditorGroup(), true);
    assert.match(harness.reader.presentationState().reason ?? '', /Focused explanation/);
  } finally { await harness.close(); }
});

test('Read Explanation stays readable when opening Study first needs a compact-layout focus', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  harness.constrainStudyGrid();
  harness.suppressNativeInnerFocus();
  try {
    // Act
    await harness.reader.action('read-context');

    // Assert
    assert.equal(harness.reader.inspect().opened, true);
    assert.equal(harness.focusedPanel(), 'codebook.studyContext');
    assert.equal(harness.maximizedEditorGroup(), true);
    assert.match(harness.reader.presentationState().reason ?? '', /Focused explanation/);
  } finally { await harness.close(); }
});

test('Read Explanation does not maximize after the work window leaves and returns during cold Open', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const openStudy = harness.reader.open.bind(harness.reader);
  harness.reader.open = async (signal, origin) => {
    await openStudy(signal, origin);
    harness.changeWindowFocus(false);
    harness.changeWindowFocus(true);
  };
  try {
    // Act
    await assert.rejects(harness.reader.action('read-context'), /work window lost focus/i);

    // Assert
    assert.equal(harness.reader.inspect().opened, true);
    assert.equal(harness.commands.filter(command => command === 'workbench.action.maximizeEditorHideSidebar').length, 0);
    assert.doesNotMatch(harness.reader.presentationState().reason ?? '', /Focused explanation/);
  } finally { await harness.close(); }
});

test('Read Explanation leaves a closed Study and foreign window untouched when unfocused', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  harness.changeWindowFocus(false);
  try {
    // Act
    await assert.rejects(harness.reader.action('read-context'), /Focus the Codebook work window/);

    // Assert
    assert.equal(harness.reader.inspect().opened, false);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.maximizedEditorGroup(), false);
  } finally { harness.changeWindowFocus(true); await harness.close(); }
});

test('Read Application does not maximize after the work window leaves during its webview reveal', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open();
    const application = harness.reader['app']!;
    const reveal = application.reveal.bind(application);
    application.reveal = (column, preserveFocus) => {
      reveal(column, preserveFocus);
      harness.changeWindowFocus(false);
      harness.changeWindowFocus(true);
    };
    const maximizations = harness.commands.filter(command => command === 'workbench.action.maximizeEditorHideSidebar').length;

    // Act
    await assert.rejects(harness.reader.action('read-app'), /work window lost focus/i);

    // Assert
    assert.equal(harness.reader.inspect().opened, true);
    assert.equal(harness.commands.filter(command => command === 'workbench.action.maximizeEditorHideSidebar').length, maximizations);
    assert.doesNotMatch(harness.reader.presentationState().reason ?? '', /Focused application/);
  } finally { await harness.close(); }
});

test('replay reads app, source and sidebar summary then restores their shared layout without changing history', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true);
  harness.useNativeLayout({ orientation: 0, groups: [{}] }); harness.hideGridWhileMaximized();
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    const selection = harness.reader.inspect().view!.model.selection, source = harness.reader.inspect().sourceUri;
    const bundle = harness.controller.bundle(), panels = harness.nativePanels();
    const progress = await (await harness.reader.learningStorage()).readProgress();

    // Act
    await harness.reader.action('read-app');
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser'); assert.equal(harness.maximizedEditorGroup(), true);
    await harness.reader.action('read-source');
    assert.equal(harness.sourceColumn(), 2); assert.equal(harness.maximizedEditorGroup(), true);
    await harness.reader.action('read-context');
    assert.equal(harness.summary.visible, true); assert.equal(harness.maximizedEditorGroup(), true);
    await harness.reader.action('arrange');

    // Assert
    assert.equal(harness.summary.visible, true); assert.equal(harness.maximizedEditorGroup(), false);
    assert.equal(harness.reader.presentationState().state, 'open');
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.reader.presentationState().reason, undefined);
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] });
    assert.deepEqual(harness.nativePanels(), panels); assert.equal(panels.length, 1);
    assert.deepEqual(harness.reader.inspect().view!.model.selection, selection);
    assert.equal(harness.reader.inspect().sourceUri, source);
    assert.equal(harness.controller.bundle(), bundle); assert.equal(harness.controller.state().presentedMs, 100);
    assert.deepEqual(await (await harness.reader.learningStorage()).readProgress(), progress);
    assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { await harness.close(); }
});

test('Restore after focused reading recovers the confirmed Study layout when native space is available', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open();
    await harness.reader.action('read-app');
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);

    // Act
    await harness.reader.action('arrange');

    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.maximizedEditorGroup(), false);
    assert.equal(harness.reader.presentationState().reason, undefined);
  } finally { await harness.close(); }
});

test('Restore beside a separate editor part keeps the selected explanation after borrowing primary focus', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const chat = harness.addSeparateEditorPart();
  harness.constrainStudyGrid(); harness.hideGridWhileMaximized();
  try {
    await harness.reader.open();
    await harness.reader.action('read-context');

    // Act
    await harness.reader.action('arrange');

    // Assert
    assert.equal(harness.focusedPanel(), 'codebook.studyContext');
    assert.equal(harness.reader.presentationState().state, 'open');
    assert.doesNotMatch(harness.reader.presentationState().reason ?? '', /learner changed native tab focus/i);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
  } finally { await harness.close(); }
});

test('Restore beside a separate editor part preserves a learner tab chosen during its focus borrow', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const chat = harness.addSeparateEditorPart();
  harness.constrainStudyGrid(); harness.hideGridWhileMaximized();
  let release = () => {};
  try {
    await harness.reader.open();
    await harness.reader.action('read-context');
    const held = harness.holdNextCommand('workbench.action.focusFirstEditorGroup'); release = held.release;

    // Act
    const restoring = harness.reader.action('arrange');
    await held.started;
    const draft = harness.focusMutableDraft('newer-scope-notes.txt', 3);
    release(); await restoring;

    // Assert
    assert.equal(harness.groups.find(group => group.viewColumn === 3)?.activeTab, draft.tab);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.match(harness.reader.presentationState().reason ?? '', /learner changed native tab focus/i);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
  } finally { release(); await harness.close(); }
});

test('Restore stops after the learner leaves the work window during its primary focus borrow', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const chat = harness.addSeparateEditorPart();
  harness.constrainStudyGrid(); harness.hideGridWhileMaximized();
  let release = () => {};
  try {
    await harness.reader.open();
    await harness.reader.action('read-context');
    const held = harness.holdNextPrimaryFocusResponse(); release = held.release;
    const restoring = harness.reader.action('arrange');
    await held.started;
    const layoutChanges = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;

    // Act
    harness.changeWindowFocus(false);
    harness.changeWindowFocus(true);
    release(); await restoring;

    // Assert
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, layoutChanges);
    assert.match(harness.reader.presentationState().reason ?? '', /learner changed native tab focus/i);
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
  } finally { release(); await harness.close(); }
});

test('successful Study reading clears an earlier background-window reading error', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open();
    harness.changeWindowFocus(false);
    harness.receive({ type: 'action', revision: harness.reader.inspect().view!.revision, action: 'read-app' });
    await waitUntil(() => harness.reader.inspect().view!.errors.some(error => error.includes('Focus the Codebook work window')), 'background reading error', 1_000);

    // Act
    harness.changeWindowFocus(true);
    await harness.reader.action('read-app');

    // Assert
    assert.equal(harness.reader.inspect().view!.errors.some(error => error.includes('Focus the Codebook work window')), false);
    assert.match(harness.reader.presentationState().reason ?? '', /Focused application/);
  } finally { await harness.close(); }
});

test('reading a Study pane does not claim focus after the learner selects a draft during native maximization', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {};
  try {
    await harness.reader.open();
    const held = harness.holdNextCommand('workbench.action.maximizeEditorHideSidebar'); release = held.release;

    // Act
    const reading = harness.reader.action('read-app');
    await held.started;
    const draft = harness.focusMutableDraft('later-learner-notes.txt', 1);
    release();

    // Assert
    await assert.rejects(reading, /focus changed|learner.*focus/i);
    assert.equal(harness.groups.find(group => group.viewColumn === 1)?.activeTab, draft.tab);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.doesNotMatch(harness.reader.presentationState().reason ?? '', /Focused application/);
  } finally { release(); await harness.close(); }
});

test('Read captured source keeps the learner cursor when the selected source is already displayed', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); await harness.reader.action('source');
    harness.changeFocusedSourceSelection(46); harness.retainReadingRange(40, 50);
    await harness.reader.action('read-app');

    // Act
    await harness.reader.action('read-source');

    // Assert
    assert.equal(harness.focusedSource()?.selections[0]?.active.line, 46);
    assert.equal(harness.isReadingLineVisible(46), true);
  } finally { await harness.close(); }
});

test('Read captured source accepts an unchanged settings tab before focusing its owned source', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); await harness.reader.action('focus-context');
    const settings = harness.addOpaqueTab('Settings', 3);
    const explanationGroup = harness.groups.find(group => group.viewColumn === 3)!;
    explanationGroup.activeTab = settings;

    // Act
    await harness.reader.action('read-source');

    // Assert
    assert.equal(harness.sourceColumn(), 2);
    assert.equal(harness.focusedSource()?.document.uri.toString(), harness.reader.inspect().sourceUri);
    assert.equal(explanationGroup.tabs.includes(settings), true);
  } finally { await harness.close(); }
});

test('Read captured source preserves a newer draft choice while its existing document opens', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {};
  try {
    await harness.reader.open(); await harness.reader.action('read-app');
    const held = harness.holdNextSource(); release = held.release;

    // Act
    const reading = harness.reader.action('read-source');
    await held.started;
    const draft = harness.focusMutableDraft('newer-source-notes.txt', 1);
    release();

    // Assert
    await assert.rejects(reading, /focus changed|learner.*focus/i);
    assert.equal(harness.groups.find(group => group.viewColumn === 1)?.activeTab, draft.tab);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.doesNotMatch(harness.reader.presentationState().reason ?? '', /Focused source/);
  } finally { release(); await harness.close(); }
});

test('Restore does not rearrange Study after the learner selects a draft during native unmaximize', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {};
  try {
    await harness.reader.open(); await harness.reader.action('read-app');
    const previousArrangements = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    const held = harness.holdNextCommand('workbench.action.minimizeOtherEditors'); release = held.release;

    // Act
    const restoring = harness.reader.action('arrange');
    await held.started;
    const draft = harness.focusMutableDraft('later-restore-notes.txt', 3);
    release(); await restoring;

    // Assert
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, previousArrangements);
    assert.equal(harness.groups.find(group => group.viewColumn === 3)?.activeTab, draft.tab);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
  } finally { release(); await harness.close(); }
});

test('constrained Restore keeps a later learner draft active while the native layout receipt settles', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] }); harness.constrainStudyGrid(); harness.hideGridWhileMaximized();
  let releaseLayout = () => {}, releaseReceipt = () => {};
  try {
    await harness.reader.open(); await harness.reader.action('read-app');
    const layout = harness.holdNextCommand('runCommands'); releaseLayout = layout.release;

    // Act
    const restoring = harness.reader.action('arrange');
    await layout.started;
    const receipt = harness.holdNextCommand('vscode.getEditorLayout'); releaseReceipt = receipt.release;
    releaseLayout(); await receipt.started;
    const draft = harness.focusMutableDraft('later-settlement-notes.txt', 3);
    releaseReceipt(); await restoring;

    // Assert
    assert.equal(harness.groups.find(group => group.viewColumn === 3)?.activeTab, draft.tab);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.match(harness.reader.presentationState().reason ?? '', /learner changed native tab focus/i);
  } finally { releaseLayout(); releaseReceipt(); await harness.close(); }
});

test('constrained Restore leaves the learner draft active when a later topology check completes', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] }); harness.constrainStudyGrid(); harness.hideGridWhileMaximized();
  try {
    await harness.reader.open(); await harness.reader.action('read-app');
    const checkTopology = harness.reader['hasRetainedStudyTopology'].bind(harness.reader);
    let newerDraft: ReturnType<typeof harness.focusMutableDraft> | undefined;
    harness.reader['hasRetainedStudyTopology'] = async (signal, beforeScopeFocus) => {
      const retained = await checkTopology(signal, beforeScopeFocus);
      if (retained) newerDraft = harness.focusMutableDraft('later-topology-notes.txt', 3);
      return retained;
    };

    // Act
    await harness.reader.action('arrange');

    // Assert
    assert.ok(newerDraft);
    assert.equal(harness.groups.find(group => group.viewColumn === 3)?.activeTab, newerDraft.tab);
    assert.equal(newerDraft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.match(harness.reader.presentationState().reason ?? '', /learner changed native tab focus/i);
  } finally { await harness.close(); }
});

for (const initial of [
  { mainGroups: 1, separatePart: false, globalGroups: 1 },
  { mainGroups: 1, separatePart: true, globalGroups: 2 },
  { mainGroups: 2, separatePart: true, globalGroups: 3 },
]) test(`failed initial pane reservation with ${initial.mainGroups} main panes and ${initial.separatePart ? 'a separate part' : 'one part'} cannot create Context before an explicit retry`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: Array.from({ length: initial.mainGroups }, () => ({})) });
  const chat = initial.separatePart ? harness.addSeparateEditorPart() : undefined, draft = harness.focusMutableDraft();
  const original = harness.editorLayout();
  harness.failNextCommand('vscode.setEditorLayout');
  try {
    // Act
    await assert.rejects(harness.reader.open(), /could not reserve separate Codebook panes/);
    await harness.reader['refresh']();

    // Assert
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, 1);
    assert.deepEqual(harness.editorLayout(), original); assert.equal(harness.groups.length, initial.globalGroups);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined); assert.equal(harness.reader.inspect().sourceUri, undefined);
    assert.equal(harness.reader.inspect().opened, false); assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    if (chat) { assert.equal(harness.groups.at(-1)!.tabs.includes(chat.tab), true); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] }); }
    assert.equal(harness.reader.inspect().view!.errors.some(error => error.includes('The editor did not retain the requested Codebook layout')), true);
    assert.equal(harness.runtimes.length, 0);

    await harness.reader.open();
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1); assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    if (chat) { assert.equal(harness.groups[3]!.tabs.includes(chat.tab), true); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] }); }
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

test('saved replay survives one recorded viewport paint loss without rerunning the target', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true);
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    const viewport = harness.viewportInstances.find(candidate => candidate.mode === 'recording');
    assert.ok(viewport);
    const originalPresent = viewport.present.bind(viewport);
    const revealsBefore = harness.viewportEvents.filter(event => event === 'reveal:recording').length;
    const targetActionsBefore = harness.runtimes[0]!.dispatches;
    let presentations = 0;
    viewport.present = async image => {
      presentations++;
      if (presentations === 1) throw new Error('Viewport frame acknowledgement timed out');
      await originalPresent(image);
    };

    // Act
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 });
    await harness.controller.settle();

    // Assert
    assert.equal(harness.controller.state().readiness, 'ready');
    assert.equal(harness.controller.state().presentedMs, 100);
    assert.equal(presentations, 2);
    assert.equal(harness.viewportEvents.filter(event => event === 'reveal:recording').length, revealsBefore + 1);
    assert.equal(harness.runtimes[0]!.dispatches, targetActionsBefore);
    assert.equal(harness.displayedImage(), harness.png.toString('base64'));
  } finally { await harness.close(); }
});

test('saved replay reports a second viewport paint loss without advancing the saved position', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true);
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    const viewport = harness.viewportInstances.find(candidate => candidate.mode === 'recording');
    assert.ok(viewport);
    let presentations = 0;
    viewport.present = async () => { presentations++; throw new Error('Viewport frame acknowledgement timed out'); };

    // Act
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 });
    await harness.controller.settle();

    // Assert
    assert.equal(harness.controller.state().readiness, 'failed');
    assert.equal(presentations, 2);
    assert.equal((await harness.store.readPreference())?.positionMs, 0);
  } finally { await harness.close(); }
});

test('saved replay does not retry a non-paint viewport failure', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true);
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    const viewport = harness.viewportInstances.find(candidate => candidate.mode === 'recording');
    assert.ok(viewport);
    const revealsBefore = harness.viewportEvents.filter(event => event === 'reveal:recording').length;
    let presentations = 0;
    viewport.present = async () => { presentations++; throw new Error('Recorded viewport is closed'); };

    // Act
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 });
    await harness.controller.settle();

    // Assert
    assert.equal(harness.controller.state().readiness, 'failed');
    assert.equal(presentations, 1);
    assert.equal(harness.viewportEvents.filter(event => event === 'reveal:recording').length, revealsBefore);
  } finally { await harness.close(); }
});

test('a repeated recorded paint loss names each attempt’s renderer progress in Recording error details', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true);
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    const viewport = harness.viewportInstances.find(candidate => candidate.mode === 'recording');
    assert.ok(viewport);
    const originalReveal = viewport.reveal.bind(viewport);
    viewport.reveal = async () => { await originalReveal(); viewport.record('viewport.ready', { epoch: '22222222-2222-2222-2222-222222222222' }); };
    let presentations = 0;
    viewport.present = async () => {
      presentations++;
      viewport.record('viewport.sent', { epoch: '11111111-1111-1111-1111-111111111111', id: presentations, hash: 'recorded-image-hash', phase: 'Recorded · 0.10 s' });
      if (presentations === 1) {
        viewport.record('viewport.frame-stage', { id: 1, stage: 'received', visibility: 'visible', hasArea: true });
        viewport.record('viewport.frame-stage', { id: 1, stage: 'decoded', visibility: 'visible', hasArea: true });
        viewport.record('viewport.frame-stage', { id: 1, stage: 'paint-queued', visibility: 'visible', hasArea: true });
      } else viewport.record('viewport.frame-stage', { id: 2, stage: 'received', visibility: 'hidden', hasArea: false });
      viewport.record('viewport.delivery-rejected', { id: presentations, phase: 'Recorded · 0.10 s', reason: 'Viewport frame acknowledgement timed out' });
      throw new Error('Viewport frame acknowledgement timed out');
    };

    // Act
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 });
    await harness.controller.settle();

    // Assert
    assert.equal(harness.controller.state().readiness, 'failed');
    assert.equal(harness.controller.state().reason, 'Error: Viewport frame acknowledgement timed out again after one same-frame retry. '
      + 'First attempt: sent #1; received (visible, area); decoded; paint-queued; rejected #1: Viewport frame acknowledgement timed out; panel visible. '
      + 'Retry: ready 22222222; sent #2; received (hidden, no area); rejected #2: Viewport frame acknowledgement timed out; panel visible.');
    assert.equal(presentations, 2);
    assert.equal((await harness.store.readPreference())?.positionMs, 0);
  } finally { await harness.close(); }
});

test('a failed renderer re-handshake after a recorded paint loss keeps the first attempt in Recording error details', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true);
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    const viewport = harness.viewportInstances.find(candidate => candidate.mode === 'recording');
    assert.ok(viewport);
    viewport.reveal = async () => { throw new Error('Timed out waiting for owned viewport ready'); };
    let presentations = 0;
    viewport.present = async () => {
      presentations++;
      viewport.record('viewport.sent', { epoch: '11111111-1111-1111-1111-111111111111', id: 1, hash: 'recorded-image-hash', phase: 'Recorded · 0.10 s' });
      viewport.record('viewport.frame-stage', { id: 1, stage: 'received', visibility: 'visible', hasArea: false });
      viewport.record('viewport.delivery-rejected', { id: 1, phase: 'Recorded · 0.10 s', reason: 'Viewport frame acknowledgement timed out' });
      throw new Error('Viewport frame acknowledgement timed out');
    };

    // Act
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 });
    await harness.controller.settle();

    // Assert
    assert.equal(harness.controller.state().readiness, 'failed');
    assert.equal(harness.controller.state().reason, 'Error: Viewport frame acknowledgement timed out; the same-frame retry could not re-handshake the renderer: Error: Timed out waiting for owned viewport ready. '
      + 'First attempt: sent #1; received (visible, no area); rejected #1: Viewport frame acknowledgement timed out; panel visible. '
      + 'Re-handshake: no renderer receipts; panel visible.');
    assert.equal(presentations, 1);
    assert.equal((await harness.store.readPreference())?.positionMs, 0);
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
  let reloaded: ReturnType<typeof harness.createReader> | undefined;
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    await harness.reader.dispose();
    // Act
    reloaded = harness.createReader();
    await reloaded.attach(harness.service); await reloaded.openRecording(harness.studyId); await harness.service.playbackController!.settle();
    const restored = reloaded.inspect().view!;
    await reloaded.retire(harness.service);
    // Assert
    assert.equal(restored.recording?.readiness, 'ready', restored.recording?.reason); assert.equal(restored.recording?.presentedMs, 100); assert.equal(restored.recording?.mode, 'paused');
    assert.equal(reloaded.inspect().view?.contentTab, 'recording'); assert.equal(reloaded.inspect().view?.model.observation?.values['value:nextTheme'], 'dark');
    assert.equal(harness.runtimes.length, 1); assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { await reloaded?.dispose(); await harness.close(); }
});

test('updating repository source and extension location preserves recorded bytes and learner history while requesting source review', async () => {
  // Arrange: persist actual archive/recording files; only editor and runtime effects are simulated.
  const harness = await recordedReaderHarness(); let reloaded: ReturnType<typeof harness.createReader> | undefined;
  try {
    await harness.reader.understand(true);
    const library = await harness.reader.learningStorage(), decisions = (await library.readProgress()).decisions;
    // Retire the original writer before freezing immutable bytes for the installation update.
    await harness.service.shutdown(); await harness.reader.retire(harness.service); await harness.reader.dispose();
    const archivePath = join(library.directory, `${harness.studyId}.study.v3.json`), archiveBefore = await readFile(archivePath);
    const recordingDirectory = harness.store.path(harness.studyId), recordingFiles = (await readdir(recordingDirectory)).sort();
    const recordingBefore = await Promise.all(recordingFiles.map(file => readFile(join(recordingDirectory, file))));
    const nextExtension = join(harness.directory, 'codebook-next-install'), nextSource = join(harness.directory, 'src', 'theme.ts');
    await mkdir(nextExtension, { recursive: true });
    await writeFile(nextSource, 'const nextTheme = \"light\";\n');

    // Act: a new reader uses the changed installation but the same real persisted workspace store.
    reloaded = harness.createReader(nextExtension); await reloaded.open();
    const restored = reloaded.inspect().view!;
    const currentSource = await readFile(nextSource, 'utf8');

    // Assert: old evidence and decisions remain exact, while current-source progress needs review.
    assert.equal(restored.model.source.text, 'const nextTheme = "dark";\n'); assert.equal(restored.model.observation?.values['value:nextTheme'], 'dark');
    assert.equal(currentSource, 'const nextTheme = \"light\";\n'); assert.equal(restored.model.sourceChanged, true);
    assert.equal(harness.watchedPatterns.some(pattern => pattern.base.endsWith(harness.directory.replace(/^\/var\//, '/private/var/') + '/src') && pattern.pattern === '*'), true);
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
    const receipt = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, configuration: harness.configuration, key: 'last-tick' });
    const record = service.record(receipt); await record.preparation;
    service.action({ instanceId: service.instanceId, runId: receipt.runId, action: 'repository-click', key: 'one' });
    const snapshotUri = service.state(record).participants.browser.snapshotUri!;
    await service.explain({ instanceId: service.instanceId, runId: receipt.runId, key: 'last-explanation', snapshotUri, sourceHash: sha256('const nextTheme = "dark";\n'), valuePaths: ['value:nextTheme'], interpretation: 'The captured price is 24 before this final shutdown.' });
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

test('a successful runtime with a rejected final history write stays partial in both service and reader until Retry', async context => {
  // Arrange
  const harness = await workspaceHarness(), service = harness.service, saveStudy = LearningLibrary.prototype.saveStudy;
  let rejectFinal = true;
  context.mock.method(LearningLibrary.prototype, 'saveStudy', async function (this: LearningLibrary, study: Parameters<LearningLibrary['saveStudy']>[0]) {
    if (study.terminal && rejectFinal) throw new Error('Injected archive size limit');
    return saveStudy.call(this, study);
  });
  try {
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() }); const record = [...service.records.values()][0]!; await record.preparation;
    const runtime = harness.runtimes[0]!, view = runtime.view.bind(runtime);
    if (!runtime.snapshot) await harness.reader.action('click');
    runtime.view = () => ({ ...view(), finalOutcome: 'demonstrated', resourcesReleased: true, cleaned: true, operation: { ...view().operation!, afterVerified: true, continuedPause: runtime.snapshot!.pause } });
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
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() }); const record = [...service.records.values()][0]!; await record.preparation;
    const runtime = harness.runtimes[0]!, originalView = runtime.view.bind(runtime);
    if (!runtime.snapshot) await harness.reader.action('click');
    runtime.view = () => ({ ...originalView(), finalOutcome: 'demonstrated', resourcesReleased: true, cleaned: true, operation: { ...originalView().operation!, afterVerified: true, continuedPause: runtime.snapshot!.pause } });
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

test('an interpretation added to an earlier stopped run persists while the later run keeps execution ownership', async () => {
  // Arrange
  const harness = await workspaceHarness(), service = harness.service;
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() }); const first = [...service.records.values()][0]!; await first.preparation;
    await harness.reader.action('click'); await harness.reader.open();
    const snapshotUri = service.state(first).participants.browser.snapshotUri!;
    await harness.reader.action('stop');
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() }); const second = [...service.records.values()][1]!; await second.preparation;
    // Act
    await service.explain({ instanceId: service.instanceId, runId: first.id, key: 'earlier-run-note', snapshotUri, sourceHash: sha256('const nextTheme = "dark";\n'), valuePaths: ['value:nextTheme'], interpretation: 'The earlier run captured price 24.' });
    await harness.reader.open(); await harness.reader.action('retry');
    const studyId = `${service.instanceId}_${first.id}`;
    await harness.reader['receive']({ type: 'history', revision: harness.reader.inspect().view!.revision, studyId }, 'moments');
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
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() }); const first = [...service.records.values()][0]!; await first.preparation;
    await harness.reader.action('click');
    const runtime = harness.runtimes[0]!, originalView = runtime.view.bind(runtime);
    if (!runtime.snapshot) await harness.reader.action('click');
    runtime.view = () => ({ ...originalView(), finalOutcome: 'demonstrated', resourcesReleased: true, cleaned: true, operation: { ...originalView().operation!, afterVerified: true, continuedPause: runtime.snapshot!.pause } });
    await harness.reader.open(); await harness.reader.action('stop');
    const snapshotUri = service.state(first).participants.browser.snapshotUri!, studyId = `${service.instanceId}_${first.id}`;
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() }); const second = [...service.records.values()][1]!; await second.preparation;
    await harness.reader.action('retry');
    context.mock.method(LearningLibrary.prototype, 'saveStudy', async function (this: LearningLibrary, study: Parameters<LearningLibrary['saveStudy']>[0]) {
      if (study.id === studyId && study.observations[0]?.interpretations.length === 1) { entered(); await held; }
      return saveStudy.call(this, study);
    });
    // Act
    await service.explain({ instanceId: service.instanceId, runId: first.id, key: 'selected-during-save', snapshotUri, sourceHash: sha256('const nextTheme = "dark";\n'), valuePaths: ['value:nextTheme'], interpretation: 'The retained pause captured the dark theme before mutation.' });
    await harness.reader.open(); await started;
    await harness.reader['receive']({ type: 'history', revision: harness.reader.inspect().view!.revision, studyId }, 'moments');
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
    assert.equal(selected.model.observation?.interpretations[0]?.text, 'The retained pause captured the dark theme before mutation.');
    assert.equal(archive.observations[0]?.interpretations[0]?.text, 'The retained pause captured the dark theme before mutation.');
    assert.equal(selected.study?.historyOutcome, 'saved'); assert.equal(selected.study?.studyOutcome, 'demonstrated');
    assert.equal(selected.liveState, 'ready'); assert.equal(second.stopped, false); assert.equal(selected.model.continueArguments, undefined);
  } finally { release(); context.mock.restoreAll(); await harness.close(); context.mock.timers.reset(); }
});

test('a failed latest image checkpoint stays failed and partial while the older captured facts remain readable until Retry', async context => {
  // Arrange: the runtime is synthetic; canonical image reads and durable archive writes remain real.
  context.mock.timers.enable({ apis: ['setInterval'] });
  const harness = await workspaceHarness(), service = harness.service;
  const png = Buffer.from('synthetic-unit-test-pixels');
  let imagePath: string | undefined;
  try {
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() }); const record = [...service.records.values()][0]!; await record.preparation;
    await harness.reader.action('click');
    const runtime = harness.runtimes[0]!, originalView = runtime.view.bind(runtime);
    imagePath = join(runtime.evidence.directory, 'paused-browser.png'); await writeFile(imagePath, png);
    runtime.view = () => ({ ...originalView(), finalOutcome: 'demonstrated', resourcesReleased: true, cleaned: true, operation: { ...originalView().operation!, afterVerified: true, continuedPause: runtime.snapshot!.pause }, captures: { ...originalView().captures, 'paused-browser': { status: 'captured', file: 'paused-browser.png', renderer: { epoch: 'test', id: 1, hash: sha256(png) } } } });
    const snapshotUri = service.state(record).participants.browser.snapshotUri!;
    await service.explain({ instanceId: service.instanceId, runId: record.id, key: 'saved-before-image-failure', snapshotUri, sourceHash: sha256('const nextTheme = "dark";\n'), valuePaths: ['value:nextTheme'], interpretation: 'The original saved observation has price 24.' });
    await harness.reader.open(); await harness.reader.action('stop');
    const studyId = `${service.instanceId}_${record.id}`, directory = harness.reader.inspect().libraryDirectory!;
    const library = new LearningLibrary(directory, directory.split('/').at(-1)!), original = await library.readStudy(studyId);
    const originalImage = original.captures.find(capture => capture.phase === 'paused-browser');
    assert.equal(original.terminal, true); assert.ok(originalImage?.status === 'captured'); assert.equal(originalImage.base64, png.toString('base64'));
    assert.equal(harness.reader.inspect().view!.study?.studyOutcome, 'demonstrated');
    // Act: a permitted post-stop explanation needs a new projection, but its canonical PNG is now corrupt.
    await service.explain({ instanceId: service.instanceId, runId: record.id, key: 'late-after-image-failure', snapshotUri, sourceHash: sha256('const nextTheme = "dark";\n'), valuePaths: ['value:nextTheme'], interpretation: 'The later explanation also refers to the captured price 24.' });
    await writeFile(imagePath, 'corrupted canonical PNG');
    await assert.rejects(harness.reader.open(), /Captured image no longer matches its sealed hash/);
    await harness.reader.open();
    // Assert: the failure is settled; older readable facts cannot turn it into an indefinite pending state.
    const failed = harness.reader.inspect().view!, retained = await library.readStudy(studyId);
    assert.equal(service.state(record).historyOutcome.status, 'failed'); assert.equal(service.state(record).studyOutcome, 'partial');
    assert.equal(failed.study?.historyOutcome, 'failed'); assert.equal(failed.study?.studyOutcome, 'partial');
    assert.equal(failed.model.observation?.snapshotUri, snapshotUri); assert.equal(failed.model.observation?.values['value:nextTheme'], 'dark');
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
    assert.equal(recovered.model.observation?.values['value:nextTheme'], 'dark'); assert.equal(harness.runtimes.length, 1); assert.equal(runtime.dispatches, 1);
  } finally { if (imagePath) await writeFile(imagePath, png); await harness.close(); context.mock.timers.reset(); }
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
    const input = harness.groups[0]!.activeTab!.input; assert.ok('uri' in input); assert.match(input.uri.toString(), /Captured-overview\.mts$/);
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

test('Study Run requires an editor-agent repository declaration and cannot launch an embedded target', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    // Act / Assert
    await assert.rejects(harness.reader.action('run'), /Ask your editor agent to prepare a study in the open repository/);
    assert.equal(harness.service.records.size, 0);
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('a slow archive writer does not delay inspection of the committed live pause', async context => {
  // Arrange
  const harness = await workspaceHarness(), saveStudy = LearningLibrary.prototype.saveStudy;
  let entered = () => {}, release = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  context.mock.method(LearningLibrary.prototype, 'saveStudy', async function (this: LearningLibrary, study: Parameters<LearningLibrary['saveStudy']>[0]) { entered(); await held; return saveStudy.call(this, study); });
  try {
    const receipt = harness.service.start({ instanceId: harness.service.instanceId, profile: PROFILE_ID, configuration: harness.configuration, key: 'slow-library' });
    await harness.service.record(receipt).preparation;
    harness.service.action({ instanceId: harness.service.instanceId, runId: receipt.runId, action: 'repository-click', key: 'one' });
    // Act
    const opening = harness.reader.open(); await started;
    const inspectedWhileSaving = await waitUntil(() => {
      const view = harness.reader.inspect().view!;
      return !view.loading && view.model.observation?.values['value:nextTheme'] === 'dark' && view.model.matching;
    }, 'inspection independent of archive write', 1_000).catch(() => false);
    release(); await opening;
    // Assert
    assert.equal(inspectedWhileSaving, true);
  } finally { release(); context.mock.restoreAll(); await harness.close(); }
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
      harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() }); const record = [...service.records.values()].at(-1)!; await record.preparation;
      await harness.reader.action('click');
      await service.explain({ instanceId: service.instanceId, runId: record.id, key: label, snapshotUri: service.state(record).participants.browser.snapshotUri!, sourceHash: sha256('const nextTheme = "dark";\n'), valuePaths: ['value:nextTheme'], interpretation: `Study ${label} captured price 24.` });
      await harness.reader.action('stop'); studyIds.push(`${service.instanceId}_${record.id}`);
    }
    const firstStudyId = studyIds[0]!, secondStudyId = studyIds[1]!;
    const secondSnapshotUri = service.state([...service.records.values()][1]!).participants.browser.snapshotUri!;
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
    assert.equal(selected.view!.model.observation?.values['value:nextTheme'], 'dark'); assert.equal(selected.sourceUri, selectedSourceUri);
    assert.equal(selected.view!.loading, false); assert.equal(selected.view!.errors.length, 0); assert.equal(harness.runtimes.length, 2);
  } finally { release(); await retry?.catch(() => undefined); context.mock.restoreAll(); await cold?.dispose(); await harness.close(); context.mock.timers.reset(); }
});

test('a queued checkbox from a previous configured profile cannot change another article understanding or raise an error', async () => {
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

test('an obsolete failed history read cannot downgrade a newer verified reader or API checkpoint', async context => {
  // Arrange: the first read observes a real missing sidecar before a later read repairs and verifies it.
  context.mock.timers.enable({ apis: ['setInterval'] });
  const harness = await workspaceHarness(), service = harness.service, readCheckpoint = LearningLibrary.prototype.readCheckpoint;
  let release = () => {}, entered = () => {}, firstRead = true;
  let olderSelection: Promise<void> | undefined;
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() }); const record = [...service.records.values()][0]!; await record.preparation;
    const runtime = harness.runtimes[0]!, originalView = runtime.view.bind(runtime);
    if (!runtime.snapshot) await harness.reader.action('click');
    runtime.view = () => ({ ...originalView(), finalOutcome: 'demonstrated', resourcesReleased: true, cleaned: true, operation: { ...originalView().operation!, afterVerified: true, continuedPause: runtime.snapshot!.pause } });
    await harness.reader.open(); await harness.reader.action('stop');
    const studyId = `${service.instanceId}_${record.id}`, directory = harness.reader.inspect().libraryDirectory!;
    const library = new LearningLibrary(directory, directory.split('/').at(-1)!);
    await unlink(join(directory, `${studyId}.study.meta.v3.json`));
    context.mock.method(LearningLibrary.prototype, 'readCheckpoint', async function (this: LearningLibrary, id: string) {
      const checkpoint = await readCheckpoint.call(this, id);
      if (firstRead) { firstRead = false; assert.equal(checkpoint.status, 'failed'); entered(); await held; }
      return checkpoint;
    });
    const revision = harness.reader.inspect().view!.revision;
    // Act: await the message boundary directly so the obsolete read finishes before the assertions.
    olderSelection = harness.reader['receive']({ type: 'history', revision, studyId }, 'moments');
    await started; await library.reconcile();
    await harness.reader['receive']({ type: 'history', revision, studyId }, 'moments');
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
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() }); const record = [...service.records.values()][0]!; await record.preparation;
    const runtime = harness.runtimes[0]!, originalView = runtime.view.bind(runtime);
    if (!runtime.snapshot) await harness.reader.action('click');
    runtime.view = () => ({ ...originalView(), finalOutcome: 'demonstrated', resourcesReleased: true, cleaned: true, operation: { ...originalView().operation!, afterVerified: true, continuedPause: runtime.snapshot!.pause } });
    await harness.reader.open(); await harness.reader.action('stop');
    if (retired) { await service.shutdown(); await harness.reader.retire(service); }
    const studyId = `${service.instanceId}_${record.id}`;
    assert.equal(harness.reader.inspect().view!.study?.studyOutcome, 'demonstrated');
    // Act
    await unlink(join(harness.reader.inspect().libraryDirectory!, `${studyId}.study.meta.v3.json`));
    await harness.reader['receive']({ type: 'history', revision: harness.reader.inspect().view!.revision, studyId }, 'moments');
    await waitUntil(() => harness.reader.inspect().view!.study?.historyOutcome === 'failed' && !harness.reader.inspect().view!.loading, 'failed current checkpoint verification', 1_000);
    // Assert
    assert.equal(harness.reader.inspect().view!.study?.studyOutcome, 'partial');
    if (!retired) assert.equal(service.state(record).studyOutcome, 'partial');
    await harness.reader.action('retry');
    assert.equal(harness.reader.inspect().view!.study?.historyOutcome, 'saved'); assert.equal(harness.reader.inspect().view!.study?.studyOutcome, 'demonstrated');
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
    const receipt = harness.service.start({ instanceId: harness.service.instanceId, profile: PROFILE_ID, configuration: harness.configuration, key: 'retry-final' });
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

test('an MCP source reveal rejects a host rendering failure instead of recording a successful reveal', async () => {
  // Arrange
  const harness = await workspaceHarness();
  let release = () => {};
  try {
    const receipt = harness.service.start({ instanceId: harness.service.instanceId, profile: PROFILE_ID, configuration: harness.configuration, key: 'reveal-failure' });
    const record = harness.service.record(receipt); await record.preparation;
    harness.service.action({ instanceId: harness.service.instanceId, runId: receipt.runId, action: 'repository-click', key: 'one' });
    await harness.reader.open();
    const snapshot = harness.service.snapshot(record, harness.service.state(record).participants.browser.snapshotUri!);
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
  await git('git', ['init', '--quiet', directory]); await mkdir(join(directory, 'src'), { recursive: true });
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

test('saved Study sends captured facts without copying retained source bodies into its webviews', async () => {
  // Arrange
  const harness = await configuredWorkspaceHarness();
  try {
    await harness.start();
    // Act
    await harness.reader.action('click'); await harness.reader.action('stop');
    await harness.reader.select('repository/interface/theme');
    const posted = harness.postedMessages().findLast(message => message.model.observation?.actionId === 'repository-click');
    // Assert: native/archive source stays intact while webview metadata remains sufficient.
    assert.ok(posted?.model.observation?.actionId === 'repository-click');
    assert.equal(posted.model.source.text, ''); assert.equal(posted.model.observation.source.text, '');
    assert.equal(posted.model.observation.values['value:enabled'], false);
    assert.equal(harness.reader.inspect().view!.model.source.text, 'const nextTheme = "dark";\n');
    assert.equal(harness.reader.inspect().view!.model.observation!.source.text, 'const nextTheme = "dark";\n');
  } finally { await harness.close(); }
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
    await assert.rejects(harness.reader.action('run'), /agent.*prepare a study in the open repository/i);
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
    const binding: BookObservationBinding = { nodeId: 'module', linkIndex: 0, studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash, itemId: observation.itemId, observationHash: bookObservationHash(observation), elapsedMs: observation.elapsedMs, outcome: study.finalOutcome };
    const origin: RepositorySelection = { bookId: 'architecture', revision: 1, nodeId: 'module', anchorIndex: 0, location: { sectionIndex: 1, fraction: 0.65, focusId: 'evidence-0-recording' } };
    await library.selectRepository(origin);
    harness.controls.returnToRepository = async selection => { await harness.reader.arrangeRepository(new AbortController().signal, selection); };
    return { ...harness, library, binding, origin };
  } catch (error) { await harness.close(); throw error; }
}

for (const recording of [false, true]) test(`Wiki ${recording ? 'recording' : 'observation'} reentry restores Study after an empty chat wrapper refresh following actual Return`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.groups.at(-1)!.tabs = []; harness.groups.at(-1)!.activeTab = undefined;
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    await harness.reader.action('return-wiki');
    // Act
    harness.resyncEditorGroups('empty');
    await harness.reader.openRepositoryEvidence(harness.binding, recording, undefined, harness.origin); await harness.controller.settle();
    // Assert
    assert.deepEqual(harness.editorLayout(), recording ? { orientation: 0, groups: [{ size: 1 }, { size: 1 }, { size: 1 }] } : { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
    // The existing third main group belongs to the learner; the sidebar does not authorize removing it.
    assert.equal(harness.reader.presentationState().layoutConfirmed, !recording);
    if (recording) { assert.equal(harness.controller.state().readiness, 'ready'); assert.equal(harness.controller.state().mode, 'paused'); }
    assert.deepEqual(harness.groups.at(-1)!.tabs, []); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.groups[0]!.tabs.some(tab => 'uri' in tab.input && tab.input.uri.toString() === draft.document.uri.toString()), true);
  } finally { await harness.close(); }
});

for (const change of ['replace', 'unannounced', 'move', 'ambiguous'] as const) test(`Wiki recording reentry preserves the reading grid after an empty other-part ${change} following actual Return`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.groups.at(-1)!.tabs = []; harness.groups.at(-1)!.activeTab = undefined;
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    await harness.reader.action('return-wiki');
    const mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    if (change === 'move') harness.groups.at(-1)!.viewColumn = 5;
    if (change === 'ambiguous') harness.groups.push({ viewColumn: 5, tabs: [] });
    // Act
    harness.resyncEditorGroups(change === 'replace' || change === 'unannounced' ? change : 'empty', true);
    const opening = harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin);
    // A missing global column makes the part ambiguous; recording load refuses that scope instead of repairing it.
    if (change === 'move') await assert.rejects(opening, /outside the verified recording range/);
    else await opening;
    await harness.controller.settle();
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 1 }, { size: 1 }, { size: 1 }] });
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] }); assert.equal(draft.document.getText(), 'Original learner draft.\n');
  } finally { await harness.close(); }
});

for (const recording of [false, true]) for (const mainGroups of [2, 3]) test(`explicit Study after actual Wiki Return restores its verified ${mainGroups}-group origin following ${recording ? 'recording' : 'observation'} entry`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  if (mainGroups === 3) harness.useNativeLayout({ orientation: 0, groups: [{}, {}, {}] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, recording, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    // Act
    await harness.reader.open();
    // Assert
    assert.deepEqual(harness.editorLayout(), recording
      ? mainGroups === 2 ? { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] } : { orientation: 0, groups: [{}, {}, {}] }
      : { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
    assert.equal(harness.reader.presentationState().layoutConfirmed, !recording || mainGroups === 2);
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1); assert.equal(harness.sourceColumn(), 2); assert.equal(harness.panelColumn('codebook.studyContext'), recording ? undefined : 3);
    if (recording) assert.equal(harness.summary.visible, true);
    assert.equal(harness.groups.find(group => group.viewColumn === (recording ? mainGroups + 1 : 4))!.tabs.includes(chat.tab), true);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] }); assert.equal(draft.document.getText(), 'Original learner draft.\n');
  } finally { await harness.close(); }
});

for (const change of ['shape', 'size'] as const) test(`explicit Study after actual Wiki Return preserves a learner's ${change} edit to the reading grid`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  const manual = change === 'shape' ? { orientation: 0, groups: [{ size: 161 }, { size: 162 }] } : { orientation: 1, groups: [{ size: 100 }, { size: 223 }] };
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki'); harness.changeEditorLayout(manual);
    const mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    // Act
    await harness.reader.open();
    // Assert
    assert.deepEqual(harness.editorLayout(), manual); assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] }); assert.equal(draft.document.getText(), 'Original learner draft.\n');
  } finally { await harness.close(); }
});

for (const cursor of [false, true]) for (const shuffled of [false, true]) test(`${cursor ? 'Cursor' : 'VS Code'} Wiki and recording round trips preserve the separate chat part and original two-row article with ${shuffled ? 'reordered' : 'ordered'} API groups`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), chat = harness.addSeparateEditorPart();
  if (cursor) harness.useCursorGroupWrappers(true);
  const draft = harness.focusMutableDraft();
  if (shuffled) harness.groups.reverse();
  try {
    // Act
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
    assert.equal(harness.groups.length, 3); assert.equal(harness.groups.find(group => group.viewColumn === 3)!.tabs.includes(chat.tab), true);
    assert.equal(harness.groups.find(group => group.viewColumn === 1)!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    assert.equal(harness.controller.state().readiness, 'ready'); assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.sourceColumn(), 2); assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.summary.visible, true);
    assert.equal(harness.groups.length, 3); assert.equal(harness.groups.find(group => group.viewColumn === 3)!.tabs.includes(chat.tab), true);
    assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
  } finally { await harness.close(); }
});

for (const next of ['Return', 'retry', 'Close'] as const) test(`${next} after interrupted main-part reservation preserves the original article, chat and draft`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.useCursorGroupWrappers(true);
  let releaseLayout = () => {}, releaseReceipt = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    const cancellation = new AbortController(), layout = harness.holdNextCommand('vscode.setEditorLayout'); releaseLayout = layout.release;
    const opening = harness.reader.openRepositoryEvidence(harness.binding, true, cancellation.signal, harness.origin), rejected = assert.rejects(opening, /abort|closed/i);
    await layout.started;
    const receipt = harness.holdNextCommand('vscode.getEditorLayout'); releaseReceipt = receipt.release;
    layout.release(); await receipt.started;
    // Act: the main grid is accepted, but its restoration receipt is still pending.
    if (next !== 'Close') cancellation.abort();
    const closing = next === 'Close' ? harness.reader.close() : undefined;
    receipt.release(); await rejected; await closing;
    // Assert
    if (next === 'Close') { assert.equal(harness.counts().panels, 0); assert.equal(harness.reader.inspect().opened, false); }
    else {
      assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
      if (next === 'Return') {
        await harness.reader.action('return-wiki');
        assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
        assert.equal(harness.groups.length, 3);
      }
      await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
      assert.equal(harness.panelColumn('codebook.studyContext'), undefined); assert.equal(harness.summary.visible, true); assert.equal(harness.sourceColumn(), 2);
      assert.equal(harness.controller.state().readiness, 'ready'); assert.equal(harness.reader.inspect().view!.errors.length, 0);
    }
    assert.equal(harness.groups.at(-1)!.tabs.includes(chat.tab), true); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(harness.groups[0]!.tabs.includes(draft.tab), true); assert.equal(draft.document.getText(), 'Original learner draft.\n');
  } finally { releaseLayout(); releaseReceipt(); await harness.close(); }
});

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
    assert.equal(harness.groups.length, 2); assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.groups[0]!.tabs.includes(draft), true); assert.equal(draft.isDirty, true);
    assert.deepEqual((await library.readProgress()).decisions, decisions);
    assert.equal(harness.commands.filter(command => command === 'workbench.action.evenEditorWidths').length, equalizations);
    await writeFile(headerPath, header);
    await harness.reader.openRepositoryEvidence(binding, true, undefined, origin); await harness.controller.settle();
    assert.equal(harness.controller.state().readiness, 'ready'); assert.equal(harness.panelColumn('codebook.studyContext'), undefined); assert.equal(harness.summary.visible, true);
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

for (const change of ['resize', 'source move', 'application move', 'foreign tab', 'foreign group', 'replaced group']) test(`actual article Return preserves a learner's ${change} after opening recording evidence`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    if (change === 'resize') harness.changeEditorLayout({ orientation: 1, groups: [{ size: 0.7 }, { size: 0.3 }] });
    if (change === 'source move') harness.moveSource(1);
    if (change === 'application move') harness.movePanel('codebook.scopedBrowser', 2);
    // A new learner group is never a Codebook-owned destination.
    if (change === 'foreign tab') { harness.groups.push({ viewColumn: 3, tabs: [] }); harness.changeEditorLayout({ orientation: 1, groups: [{ size: 0.4 }, { size: 0.4 }, { size: 0.2 }] }); }
    const draft = harness.addForeignDraft(change === 'foreign tab' ? 3 : 1);
    if (change === 'foreign group') harness.groups.push({ viewColumn: 3, tabs: [] });
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

for (const move of ['source', 'application']) test(`the next evidence visit preserves a manual ${move} move made after actual article Return`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    await harness.reader.action('return-wiki');
    if (move === 'source') harness.moveSource(1); else harness.movePanel('codebook.scopedBrowser', 2);
    const mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    // Act
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    // Assert
    assert.equal(harness.controller.state().readiness, 'ready');
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
    assert.equal(move === 'source' ? harness.sourceColumn() : harness.panelColumn('codebook.scopedBrowser'), move === 'source' ? 1 : 2);
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
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] });
    await harness.reader.action('return-wiki');
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
  } finally { await harness.close(); }
});

test('a queued actual article Return preserves a later learner draft focus without changing the Study layout', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), cancellation = new AbortController();
  let release = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    const original = harness.editorLayout(), mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    const held = harness.holdNextCommand('vscode.getEditorLayout'); release = held.release;
    const earlier = harness.reader.arrangeRepository(cancellation.signal, harness.origin), earlierRejected = assert.rejects(earlier, /abort/i);
    await held.started;
    const originalFocus = harness.focusedPanel();
    const returning = harness.reader.arrangeRepository(new AbortController().signal, harness.origin, { begin() {
      if (harness.focusedPanel() !== originalFocus) throw new Error('Original learner focus changed.');
    } });
    const rejected = assert.rejects(returning, /Original learner focus changed/);

    // Act
    const draft = harness.focusMutableDraft(); cancellation.abort(); held.release(); await earlierRejected; await rejected;

    // Assert
    assert.deepEqual(harness.editorLayout(), original);
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
    assert.equal(harness.groups[0]!.activeTab, draft.tab); assert.equal(draft.document.getText(), 'Original learner draft.\n');
  } finally { release(); await harness.close(); }
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
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] });
    await harness.reader.action('return-wiki');
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
  } finally { release(); await harness.close(); }
});

test('a new evidence visit drains a cancelled Return layout before restoring its two main replay panes', async () => {
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
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] });
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1); assert.equal(harness.sourceColumn(), 2); assert.equal(harness.panelColumn('codebook.studyContext'), undefined); assert.equal(harness.summary.visible, true);
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

test('a manual application move during the restored-layout receipt remains authoritative on the next evidence visit', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  let releaseLayout = () => {}, releaseReceipt = () => {};
  try {
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    const layout = harness.holdNextCommand('vscode.setEditorLayout'); releaseLayout = layout.release;
    // Act
    const returning = harness.reader.action('return-wiki'); await layout.started;
    const receipt = harness.holdNextCommand('vscode.getEditorLayout'); releaseReceipt = receipt.release;
    layout.release(); await receipt.started; harness.movePanel('codebook.scopedBrowser', 2); receipt.release(); await returning;
    await harness.reader.openRepositoryEvidence(harness.binding, true, undefined, harness.origin); await harness.controller.settle();
    // Assert
    assert.equal(harness.controller.state().readiness, 'ready'); assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2);
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
    assert.deepEqual((await harness.library.readProgress()).repositoryReturn?.selection, { bookId: 'architecture', revision: 1, nodeId: 'module', anchorIndex: 0, location: { sectionIndex: 1, fraction: 0.65, focusId: 'evidence-0-recording' } });
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

for (const cursor of [false, true]) test(`${cursor ? 'Cursor: ' : ''}observation reentry can restore the source column accepted by Study before the article Return contracted its group`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  if (cursor) harness.useCursorGroupWrappers();
  let release = () => {};
  try {
    const layout = harness.holdNextCommand('runCommands'); release = layout.release;
    const opening = harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
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
    await prepared.started; assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    cancellation.abort(); prepared.release(); await rejected; await harness.reader.action('return-wiki');
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
    assert.equal(harness.groups.length, 2); assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
  } finally { releaseBefore(); releasePrepared(); await harness.close(); }
});

test('observation a source move during reentry loading overrides the previously planned source restoration', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness();
  let releaseLayout = () => {}, releaseSource = () => {};
  try {
    const layout = harness.holdNextCommand('runCommands'); releaseLayout = layout.release;
    const initial = harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
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
    await prepared.started; harness.movePanel('codebook.scopedBrowser', 2); cancellation.abort(); prepared.release(); await rejected;
    const mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    await harness.reader.action('return-wiki');
    // Assert
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 2); assert.equal(harness.groups.length, 2);
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
    const rejected = assert.rejects(opening, /learner layout changed/);
    await before.started; const prepared = harness.holdNextCommand('vscode.getEditorLayout'); releasePrepared = prepared.release; before.release();
    await prepared.started; harness.changeEditorLayout({ orientation: 1, groups: [{ size: 111 }, { size: 222 }] });
    const mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    prepared.release(); await rejected;
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 111 }, { size: 222 }] });
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations);
  } finally { releaseBefore(); releasePrepared(); await harness.close(); }
});

test('observation source placement accepted before cancellation survives Return and the next evidence visit', async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(), cancellation = new AbortController();
  let release = () => {};
  try {
    const layout = harness.holdNextCommand('runCommands'); release = layout.release;
    const initial = harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
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
    await layout.started; assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
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
    // Observation entry creates the third main pane whose contraction this test exercises.
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
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
    // Observation entry creates the third main pane whose contraction this test exercises.
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
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

for (const recording of [false, true]) test(`Cursor two-event contraction preserves error-free Return and correct main panes and summary on ${recording ? 'recording' : 'observation'} reentry`, async () => {
  // Arrange
  const harness = await articleRecordingLayoutHarness(); harness.useCursorGroupWrappers(true);
  try {
    // Observation entry creates the third main pane whose contraction this test exercises.
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
    const previousGroups = [...harness.groups], previousTabs = previousGroups.map(group => [...group.tabs]);
    // Act
    await harness.reader.action('return-wiki');
    const returnErrorCount = harness.reader.inspect().view!.errors.length;
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 161 }, { size: 162 }] });
    assert.deepEqual(previousGroups.map(group => group.tabs), previousTabs);
    await harness.reader.openRepositoryEvidence(harness.binding, recording, undefined, harness.origin); await harness.controller.settle();
    // Assert
    assert.deepEqual({ returnErrorCount, appColumn: harness.panelColumn('codebook.scopedBrowser'), sourceColumn: harness.sourceColumn(), contextColumn: harness.panelColumn('codebook.studyContext') },
      { returnErrorCount: 0, appColumn: 1, sourceColumn: 2, contextColumn: recording ? undefined : 3 });
    assert.deepEqual(harness.editorLayout(), recording ? { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] } : { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] });
    assert.equal(harness.reader.inspect().view!.errors.length, 0);
    const application = harness.groups.find(group => group.viewColumn === 1)!.activeTab?.input, source = harness.groups.find(group => group.viewColumn === 2)!.activeTab?.input, context = harness.groups.find(group => group.viewColumn === 3)?.activeTab?.input;
    assert.ok(application && 'viewType' in application); assert.equal(application.viewType, 'codebook.scopedBrowser');
    assert.ok(source && 'uri' in source); assert.equal(source.uri.toString(), harness.reader.inspect().sourceUri);
    if (recording) { assert.equal(context, undefined); assert.equal(harness.summary.visible, true); }
    else { assert.ok(context && 'viewType' in context); assert.equal(context.viewType, 'codebook.studyContext'); }
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
    // Observation entry creates the third main pane whose contraction this test exercises.
    await harness.reader.openRepositoryEvidence(harness.binding, false, undefined, harness.origin);
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

for (const separatePart of [false, true]) for (const primaryContent of ['application only', 'unrelated draft'] as const) test(`mode transfers retain native destination groups with ${primaryContent} and ${separatePart ? 'a separate chat part' : 'one editor part'}`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const chat = separatePart ? harness.addSeparateEditorPart() : undefined;
  try {
    await openRetainedStudy(harness); await harness.reader.understand(true);
    const primary = harness.groups.find(group => group.viewColumn === 1)!;
    primary.tabs = primary.tabs.filter(tab => 'viewType' in tab.input);
    const draft = primaryContent === 'unrelated draft' ? harness.addForeignDraft(1) : undefined;
    const source = harness.reader.inspect().sourceUri, decisions = await (await harness.reader.learningStorage()).readProgress(), chatLayout = chat?.layout();
    harness.closeEmptyGroupsAfterPanelMove();
    // Act
    for (const mode of ['living-book', 'guided-walkthrough', 'study-workspace', 'living-book'] as const) {
      const state = harness.reader.presentationState();
      await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode, action: 'select' });
      // Assert: each destination remains in the original main part throughout the transfer.
      assert.equal(harness.reader.presentationState().layoutConfirmed, true);
      assert.deepEqual({ ...harness.reader.presentationState().panes }, mode === 'living-book' ? { appColumn: 2, sourceColumn: 3, contextColumn: 1 } : { appColumn: 1, sourceColumn: 2, contextColumn: 3 });
      assert.deepEqual(harness.automaticallyClosedColumns(), []);
      assert.equal(harness.groups.length, separatePart ? 4 : 3);
      assert.equal(harness.reader.inspect().sourceUri, source);
      if (draft) { assert.equal(primary.tabs.includes(draft), true); assert.equal(draft.isDirty, true); }
      if (chat) { assert.deepEqual(harness.groups.find(group => group.viewColumn === 4)!.tabs, [chat.tab]); assert.deepEqual(chat.layout(), chatLayout); assert.equal(chat.focused(), false); }
    }
    assert.deepEqual(await (await harness.reader.learningStorage()).readProgress(), decisions);
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

for (const mode of ['study-workspace', 'living-book', 'guided-walkthrough'] as const) test(`replay reentry after ${mode} request confirms only the current layout when its source becomes ready`, async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let releaseSource = () => {};
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    const state = harness.reader.presentationState();
    if (mode === 'study-workspace') await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode, action: 'select' });
    else assert.throws(() => harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode, action: 'select' }), { code: 'PRESENTATION_UNAVAILABLE' });
    const source = harness.reader.inspect().sourceUri, bundle = harness.controller.bundle(), progress = await (await harness.reader.learningStorage()).readProgress();
    const pendingSource = harness.holdNextSource(); releaseSource = pendingSource.release;
    // Act: native app visibility rehydrates the same replay while its source remains pending.
    harness.controller.hide(); harness.controller.reveal(); await pendingSource.started;
    await harness.reader.open();
    // Assert: a verified grid never certifies a source that is still loading.
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    pendingSource.release(); await harness.controller.settle();
    assert.equal((await harness.reader.readPresentationState()).layoutConfirmed, true);
    assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    assert.deepEqual({ ...harness.reader.presentationState().panes }, { appColumn: 1, sourceColumn: 2, contextColumn: undefined });
    assert.equal(harness.reader.inspect().sourceUri, source); assert.equal(harness.controller.bundle(), bundle);
    assert.equal(harness.controller.state().readiness, 'ready'); assert.equal(harness.controller.state().mode, 'paused');
    assert.deepEqual(await (await harness.reader.learningStorage()).readProgress(), progress);
    assert.equal(harness.runtimes.length, 1); assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { releaseSource(); await harness.close(); }
});

for (const change of ['layout', 'groups'] as const) test(`replay readiness after explicit reentry cannot confirm later learner ${change}`, async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let releaseSource = () => {};
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    const state = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'restore' });
    const draft = harness.addForeignDraft(1);
    const pendingSource = harness.holdNextSource(); releaseSource = pendingSource.release;
    harness.controller.hide(); harness.controller.reveal(); await pendingSource.started;
    await harness.reader.open();
    // Act: later learner ownership must outrank the retained placement when replay finishes.
    if (change === 'layout') harness.changeEditorLayout({ orientation: 1, groups: [{ size: 8 }, { size: 2 }] });
    else harness.resyncEditorGroups('replace');
    const manualLayout = harness.editorLayout();
    pendingSource.release(); await harness.controller.settle();
    // Assert
    assert.equal((await harness.reader.readPresentationState()).layoutConfirmed, false);
    assert.deepEqual(harness.editorLayout(), manualLayout);
    assert.equal(harness.groups.some(group => group.tabs.some(tab => tab.isDirty && 'uri' in tab.input && tab.input.uri.toString() === draft.input.uri.toString())), true);
    assert.equal(harness.controller.state().readiness, 'ready'); assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { releaseSource(); await harness.close(); }
});

test('all three presentation modes preserve source, learning item and learner decisions across pane handoffs', async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await openRetainedStudy(harness); await harness.reader.understand(true);
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
    assert.notEqual(harness.reader['app'], app); assert.notEqual(harness.reader['contextPanel'], context);
    assert.equal(harness.counts().panels, 2); assert.equal(harness.peakPanels(), 4);
    assert.equal(harness.reader.inspect().sourceUri, initial.sourceUri); assert.deepEqual(harness.reader.inspect().view!.model.selection, initial.view!.model.selection);
    assert.deepEqual(await library.readProgress(), progress); assert.equal(harness.runtimes.length, 0);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft)), true); assert.equal(draft.isDirty, true);
    assert.equal(harness.reader.presentationState().presentationControlRevision, 3); assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), { version: 1, mode: 'study-workspace' });
  } finally { await harness.close(); }
});

test('enlarging a recorded application targets its owned pane and retains the paused evidence', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {};
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    await harness.reader.action('focus-context');
    const source = harness.reader.inspect().sourceUri, bundle = harness.controller.bundle();
    const decisions = await (await harness.reader.learningStorage()).readProgress();
    const maximize = harness.holdNextCommand('workbench.action.toggleMaximizeEditorGroup'); release = maximize.release;
    // Act
    const enlarging = harness.reader.action('enlarge-app'); await maximize.started;
    // Assert
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser'); assert.equal(harness.innerFocusedPanel(), 'codebook.scopedBrowser');
    maximize.release(); await enlarging;
    assert.equal(harness.commands.filter(command => command === 'workbench.action.toggleMaximizeEditorGroup').length, 1);
    assert.equal(harness.controller.state().mode, 'paused'); assert.equal(harness.controller.state().presentedMs, 100);
    assert.equal(harness.controller.bundle(), bundle); assert.equal(harness.reader.inspect().sourceUri, source);
    assert.deepEqual(await (await harness.reader.learningStorage()).readProgress(), decisions);
    assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { release(); await harness.close(); }
});

test('replay refuses retired explanation enlargement without changing native layout or evidence', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    const commands = harness.commands.length, playback = harness.controller.state(), panels = harness.nativePanels();
    // Act / Assert
    await assert.rejects(harness.reader.action('enlarge-context'), /Open a study explanation/);
    assert.equal(harness.commands.length, commands);
    assert.deepEqual(harness.controller.state(), playback);
    assert.deepEqual(harness.nativePanels(), panels);
    assert.equal(harness.summary.visible, true);
    assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { await harness.close(); }
});

test('Restore layout after enlarging the app waits for Study focus without losing recorded evidence', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    const source = harness.reader.inspect().sourceUri, bundle = harness.controller.bundle();
    await harness.reader.action('enlarge-app');
    harness.deferPanelFocus('codebook.studyContext', 1);
    await harness.reader.action('focus-context');

    // Act: Cursor delivers the Study click before its native focus notification.
    await harness.reader.action('arrange');

    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, true, harness.reader.inspect().view!.errors.join('\n'));
    assert.deepEqual([...harness.reader.inspect().view!.errors], []);
    assert.equal(harness.controller.state().presentedMs, 100);
    assert.equal(harness.controller.bundle(), bundle); assert.equal(harness.reader.inspect().sourceUri, source);
    assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { await harness.close(); }
});

test('Restore layout keeps the original Study panes when Cursor focuses Application during its layout read', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {};
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    const panels = harness.nativePanels(), bundle = harness.controller.bundle();
    const layoutMutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    await harness.reader.action('enlarge-app');
    const reading = harness.holdNextCommand('vscode.getEditorLayout'); release = reading.release;
    // Act: a late native focus notification selects the owned Application while the main grid is read.
    const restoring = harness.reader.action('arrange'); await reading.started;
    const application = harness.nativePanels().find(panel => panel.kind === 'codebook.scopedBrowser'); assert.ok(application);
    harness.focusExistingWebviewTab(application.nativeTab); reading.release(); await restoring;
    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, true, harness.reader.inspect().view!.errors.join('\n'));
    assert.deepEqual([...harness.reader.inspect().view!.errors], []);
    assert.deepEqual(harness.nativePanels(), panels);
    assert.equal(harness.maximizedEditorGroup(), false);
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, layoutMutations + 1);
    assert.equal(harness.controller.bundle(), bundle); assert.equal(harness.controller.state().presentedMs, 100);
    assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { release(); await harness.close(); }
});

test('reopening an enlarged Study does not claim its three-pane layout was confirmed', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open();
    await harness.reader.action('enlarge-app');
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    // Act
    await harness.reader.open();
    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
  } finally { await harness.close(); }
});

test('Restore waits for an active layout transaction before confirming an enlarged Study', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {}, entered = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    await harness.reader.action('enlarge-app');
    const activeLayout = harness.reader['withLayout'](undefined, async () => { entered(); await held; });
    await started;
    const mutationsBeforeRestore = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    const state = harness.reader.presentationState();
    // Act
    const restoring = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: state.mode, action: 'restore' });
    await new Promise<void>(resolve => setImmediate(resolve));
    const mutationsWhileHeld = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    release(); await activeLayout; await restoring;
    // Assert
    assert.equal(mutationsWhileHeld, mutationsBeforeRestore);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.maximizedEditorGroup(), false);
  } finally { release(); await harness.close(); }
});

test('the Study header Restore exits a maximized pane while keeping the settled recording in its original panes', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    const panels = harness.nativePanels(), bundle = harness.controller.bundle();
    const mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    await harness.reader.action('enlarge-app');
    assert.equal(harness.maximizedEditorGroup(), true);
    const state = harness.reader.presentationState();
    // Act: this is the header's direct presentation intent, not the lower Arrange action.
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: state.mode, action: 'restore' });
    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.maximizedEditorGroup(), false);
    assert.equal(harness.reader.presentationState().presentationControlRevision, state.presentationControlRevision + 1);
    assert.deepEqual(harness.nativePanels(), panels);
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, mutations + 1);
    assert.equal(harness.controller.bundle(), bundle); assert.equal(harness.controller.state().presentedMs, 100);
  } finally { await harness.close(); }
});

test('reading the sidebar beside an enlarged application preserves replay and restores the same source', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    const panels = harness.nativePanels(), bundle = harness.controller.bundle();
    await harness.reader.action('enlarge-app');
    assert.equal(harness.maximizedEditorGroup(), true);
    await harness.reader.action('read-context');
    assert.equal(harness.summary.visible, true); assert.equal(harness.maximizedEditorGroup(), true);
    await harness.reader.action('enlarge-app');
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser'); assert.equal(harness.maximizedEditorGroup(), true);
    // Restore must not need to reopen source after Enlarge changes only geometry.
    harness.failCurrentSourceOpen();
    const state = harness.reader.presentationState();
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: state.mode, action: 'restore' });
    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.maximizedEditorGroup(), false);
    assert.deepEqual(harness.nativePanels(), panels);
    assert.equal(harness.controller.bundle(), bundle); assert.equal(harness.controller.state().presentedMs, 100);
  } finally { await harness.close(); }
});

test('Restore layout repairs changed native proportions instead of certifying the enlarged receipt', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    await harness.reader.action('enlarge-app');
    const mutations = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    harness.changeEditorLayout({ orientation: 0, groups: [{ size: 0.7 }, { size: 0.3 }] });
    // Act
    await harness.reader.action('arrange');
    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, true, harness.reader.inspect().view!.errors.join('\n'));
    assert.ok(harness.commands.filter(command => command === 'vscode.setEditorLayout').length > mutations);
    assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { await harness.close(); }
});

test('restoring a settled recording retains its application pane and confirmed playhead', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    const before = harness.controller.bundle(), playback = harness.controller.state(), panels = harness.nativePanels();
    let replacementCreated = false;
    harness.onNextPanel('codebook.scopedBrowser', () => { replacementCreated = true; });
    const state = harness.reader.presentationState();

    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: state.mode, action: 'restore' });

    // Assert
    assert.equal(replacementCreated, false);
    assert.deepEqual(harness.nativePanels(), panels);
    assert.equal(harness.controller.state().revision, playback.revision);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.controller.bundle(), before);
    assert.equal(harness.controller.state().presentedMs, playback.presentedMs);
    assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { await harness.close(); }
});

for (const focus of ['application', 'source'] as const) for (const reading of ['selected statement', 'scrolled context'] as const) test(`${focus}-focused mode transfers keep the ${reading} visible without repeated upward drift`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); await harness.reader.action(focus === 'application' ? 'focus-app' : 'source');
    harness.retainReadingRange(reading === 'selected statement' ? 16 : 40, reading === 'selected statement' ? 27 : 52);
    // Act
    for (const mode of ['living-book', 'guided-walkthrough', 'study-workspace'] as const) {
      const state = harness.reader.presentationState();
      await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode, action: 'select' });
    }
    // Assert
    assert.equal(harness.isReadingLineVisible(reading === 'selected statement' ? 22 : 46), true);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

for (const focus of ['application', 'source', 'summary'] as const) test(`paused replay preserves manually scrolled source context through repeated ${focus}-focused layout restoration`, async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    await harness.reader.action(focus === 'application' ? 'focus-app' : focus === 'source' ? 'source' : 'focus-context');
    harness.retainReadingRange(40, 52);
    const bundle = harness.controller.bundle(), source = harness.reader.inspect().sourceUri;
    // Act
    for (const attempt of [1, 2, 3]) {
      const state = harness.reader.presentationState();
      await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'restore' });
      // Assert: every restoration keeps the learner-selected reading context.
      assert.equal(harness.isReadingLineVisible(46), true, `Restoration ${attempt} preserves the reading position.`);
      assert.equal(harness.reader.presentationState().layoutConfirmed, true);
      assert.equal(harness.controller.state().mode, 'paused'); assert.equal(harness.controller.state().presentedMs, 100);
      assert.equal(harness.controller.bundle(), bundle); assert.equal(harness.reader.inspect().sourceUri, source);
      assert.equal(harness.runtimes.length, 1); assert.equal(harness.runtimes[0]!.dispatches, 1);
    }
  } finally { await harness.close(); }
});

test('Living book to Guided walkthrough retains evidence and focus when native moves emit a late focus echo', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await openRetainedStudy(harness); await harness.reader.understand(true);
    const initial = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: initial.presentationId, expectedRevision: initial.presentationControlRevision, mode: 'living-book', action: 'select' });
    await harness.reader.action('focus-context');
    const before = harness.reader.inspect(), decisions = await (await harness.reader.learningStorage()).readProgress(), draft = harness.addForeignDraft();
    harness.deferMovedFocusEcho();
    const state = harness.reader.presentationState();
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' });
    // Assert
    assert.equal(harness.reader.presentationState().mode, 'guided-walkthrough'); assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.focusedPanel(), 'codebook.studyContext'); assert.equal(harness.reader.inspect().sourceUri, before.sourceUri);
    assert.deepEqual(await (await harness.reader.learningStorage()).readProgress(), decisions);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft)), true); assert.equal(draft.isDirty, true); assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

for (const [pane, kind] of [['app', 'codebook.scopedBrowser'], ['contextPanel', 'codebook.studyContext']] as const) test(`mode transfer waits for delayed ${pane} activity after its own native tab and document receive focus`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {}, transfer: Promise<unknown> | undefined;
  try {
    await openRetainedStudy(harness); await harness.reader.understand(true);
    const initial = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: initial.presentationId, expectedRevision: initial.presentationControlRevision, mode: 'living-book', action: 'select' });
    await harness.reader.action(kind === 'codebook.scopedBrowser' ? 'focus-app' : 'focus-context');
    const before = harness.reader.inspect(), decisions = await (await harness.reader.learningStorage()).readProgress(), draft = harness.addForeignDraft();
    const held = harness.holdPanelActivity(kind); release = held.release;
    const state = harness.reader.presentationState(); let completed = false;
    // Act
    transfer = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' });
    void transfer.then(() => { completed = true; }, () => { completed = true; });
    await held.started; await new Promise<void>(resolve => setImmediate(resolve));
    // Assert: partial native/document acknowledgement neither fails nor confirms the transfer.
    assert.equal(harness.focusedPanel(), kind); assert.equal(harness.innerFocusedPanel(), kind);
    assert.equal(harness.reader[pane]?.active, false); assert.equal(completed, false);
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), { version: 1, mode: 'living-book' });
    held.release(); await transfer;
    assert.equal(harness.reader.presentationState().mode, 'guided-walkthrough'); assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.focusedPanel(), kind); assert.equal(harness.reader.inspect().sourceUri, before.sourceUri);
    assert.deepEqual(await (await harness.reader.learningStorage()).readProgress(), decisions);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft)), true); assert.equal(draft.isDirty, true); assert.equal(harness.runtimes.length, 0);
  } finally { release(); await transfer?.catch(() => undefined); await harness.close(); }
});

for (const kind of ['codebook.scopedBrowser', 'codebook.studyContext']) test(`a learner draft focus while ${kind} activity is delayed stops the transfer and preserves the prior preference`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {}, transfer: Promise<unknown> | undefined;
  try {
    await harness.reader.open();
    const initial = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: initial.presentationId, expectedRevision: initial.presentationControlRevision, mode: 'living-book', action: 'select' });
    const draft = harness.focusMutableDraft(); await harness.reader.action(kind === 'codebook.scopedBrowser' ? 'focus-app' : 'focus-context');
    const held = harness.holdPanelActivity(kind); release = held.release;
    const state = harness.reader.presentationState();
    transfer = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' });
    const rejected = assert.rejects(transfer, { code: 'PRESENTATION_UNAVAILABLE', causeDetail: 'Error: Native focus left the owned presentation target; the newer learner choice was preserved.' });
    await held.started;
    const commands = [...harness.commands], reveals = harness.panelReveals();
    // Act
    draft.focus(); held.release(); await rejected;
    // Assert
    assert.equal(harness.groups[0]!.activeTab, draft.tab); assert.equal(harness.focusedPanel(), undefined);
    assert.equal(draft.document.getText(), 'Original learner draft.\n'); assert.equal(draft.tab.isDirty, true);
    assert.deepEqual(harness.commands, commands); assert.deepEqual(harness.panelReveals(), reveals);
    assert.equal(harness.reader.presentationState().mode, 'living-book'); assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), { version: 1, mode: 'living-book' });
    assert.equal(harness.runtimes.length, 0);
  } finally { release(); await transfer?.catch(() => undefined); await harness.close(); }
});

for (const kind of ['codebook.scopedBrowser', 'codebook.studyContext']) test(`mode transfer confirms ${kind} focus while VS Code retains its most recent text editor`, async () => {
  // Arrange: VS Code can keep activeTextEditor populated after native and inner webview focus succeed.
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {};
  try {
    await openRetainedStudy(harness); await harness.reader.understand(true);
    await harness.reader.action(kind === 'codebook.scopedBrowser' ? 'focus-app' : 'focus-context');
    const before = harness.reader.inspect(), decisions = await (await harness.reader.learningStorage()).readProgress();
    const held = harness.holdTextFocusClear(kind); release = held.release;
    const state = harness.reader.presentationState();
    // Act: the last text editor remains reported for the entire handoff, as observed in ordinary VS Code.
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    // Assert
    assert.equal(harness.reader.presentationState().mode, 'living-book'); assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), { version: 1, mode: 'living-book' });
    assert.equal(harness.focusedPanel(), kind); assert.equal(harness.innerFocusedPanel(), kind);
    assert.equal(harness.focusedSource()?.document.uri.toString(), before.sourceUri);
    assert.equal(harness.reader.inspect().sourceUri, before.sourceUri);
    assert.deepEqual(await (await harness.reader.learningStorage()).readProgress(), decisions);
    assert.equal(harness.runtimes.length, 0);
  } finally { release(); await harness.close(); }
});

for (const kind of ['codebook.scopedBrowser', 'codebook.studyContext']) test(`clearing the last text editor during ${kind} reading restoration preserves confirmed native focus`, async context => {
  // Arrange: a late text-editor notification does not represent a new native tab or learner choice.
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {};
  try {
    await harness.reader.open();
    const initial = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: initial.presentationId, expectedRevision: initial.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' });
    await harness.reader.action(kind === 'codebook.scopedBrowser' ? 'focus-app' : 'focus-context');
    const held = harness.holdTextFocusClear(kind); release = held.release;
    let cleared = false;
    harness.onNextPanel('codebook.studyContext', panel => {
      const post = panel.webview.postMessage.bind(panel.webview);
      context.mock.method(panel.webview, 'postMessage', async (message: Parameters<typeof post>[0]) => {
        if (message.type === 'restore-presentation-pose') {
          assert.ok(harness.focusedSource()); held.release(); await Promise.resolve(); cleared = true;
        }
        return post(message);
      });
    });
    const state = harness.reader.presentationState();
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'select' });
    // Assert
    assert.equal(cleared, true); assert.equal(harness.focusedSource(), undefined);
    assert.equal(harness.focusedPanel(), kind); assert.equal(harness.innerFocusedPanel(), kind);
    assert.equal(harness.reader.presentationState().mode, 'study-workspace'); assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), { version: 1, mode: 'study-workspace' });
    assert.equal(harness.runtimes.length, 0);
  } finally { release(); await harness.close(); context.mock.restoreAll(); }
});

for (const kind of ['codebook.scopedBrowser', 'codebook.studyContext']) test(`Study restoration preserves the prior source until delayed text focus clear follows ${kind} activation`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {}, transfer: Promise<unknown> | undefined;
  try {
    await openRetainedStudy(harness); await harness.reader.understand(true);
    const initial = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: initial.presentationId, expectedRevision: initial.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' });
    await harness.reader.action(kind === 'codebook.scopedBrowser' ? 'focus-app' : 'focus-context');
    const before = harness.reader.inspect(), decisions = await (await harness.reader.learningStorage()).readProgress(), draft = harness.addForeignDraft();
    const held = harness.holdTextFocusClear(kind); release = held.release;
    const state = harness.reader.presentationState();
    // Act: the owned tab/panel is already active when the previous text editor finally clears.
    transfer = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'select' });
    await held.observed; held.release(); await transfer;
    // Assert
    assert.equal(harness.reader.presentationState().mode, 'study-workspace'); assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), { version: 1, mode: 'study-workspace' });
    assert.equal(harness.focusedPanel(), kind); assert.equal(harness.reader.inspect().sourceUri, before.sourceUri);
    assert.deepEqual(await (await harness.reader.learningStorage()).readProgress(), decisions);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft)), true); assert.equal(draft.isDirty, true); assert.equal(harness.runtimes.length, 0);
  } finally { release(); await transfer?.catch(() => undefined); await harness.close(); }
});

for (const kind of ['codebook.scopedBrowser', 'codebook.studyContext']) test(`a learner draft chosen before text focus clear for ${kind} survives the refused Study restoration`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {}, transfer: Promise<unknown> | undefined;
  try {
    await harness.reader.open();
    const initial = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: initial.presentationId, expectedRevision: initial.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' });
    const draft = harness.focusMutableDraft(); await harness.reader.action(kind === 'codebook.scopedBrowser' ? 'focus-app' : 'focus-context');
    const held = harness.holdTextFocusClear(kind); release = held.release;
    const state = harness.reader.presentationState();
    transfer = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'select' });
    const rejected = assert.rejects(transfer, { code: 'PRESENTATION_UNAVAILABLE', causeDetail: 'Error: Native focus left the owned presentation target; the newer learner choice was preserved.' });
    await held.observed;
    const commands = [...harness.commands], reveals = harness.panelReveals();
    // Act
    draft.focus(); held.release(); await rejected;
    // Assert
    assert.equal(harness.groups[0]!.activeTab, draft.tab); assert.equal(harness.focusedPanel(), undefined);
    assert.equal(draft.document.getText(), 'Original learner draft.\n'); assert.equal(draft.tab.isDirty, true);
    assert.deepEqual(harness.commands, commands); assert.deepEqual(harness.panelReveals(), reveals);
    assert.equal(harness.reader.presentationState().mode, 'guided-walkthrough'); assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), { version: 1, mode: 'guided-walkthrough' });
    assert.equal(harness.runtimes.length, 0);
  } finally { release(); await transfer?.catch(() => undefined); await harness.close(); }
});

for (const pane of ['app', 'contextPanel'] as const) test(`a learner draft focus during ${pane} placement stops later layout work and preserves that focus`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open();
    const initial = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: initial.presentationId, expectedRevision: initial.presentationControlRevision, mode: 'living-book', action: 'select' });
    const draft = harness.focusMutableDraft(); await harness.reader.action('focus-context');
    const layoutChanges = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    let changedFocus = false;
    harness.onNextPanel(pane === 'app' ? 'codebook.scopedBrowser' : 'codebook.studyContext', () => { changedFocus = true; draft.focus(); });
    const state = harness.reader.presentationState();
    // Act
    await assert.rejects(harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' }), {
      code: 'PRESENTATION_UNAVAILABLE', causeDetail: 'Error: Native focus changed while presentation panes moved; the learner focus was preserved.',
    });
    // Assert
    assert.equal(changedFocus, true); assert.equal(harness.groups[0]!.activeTab, draft.tab);
    assert.equal(harness.focusedPanel(), undefined); assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, layoutChanges);
    assert.equal(harness.reader.presentationState().mode, 'living-book'); assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), { version: 1, mode: 'living-book' });
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('a learner source selection during delayed placement is preserved without later movement or preference changes', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open();
    const initial = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: initial.presentationId, expectedRevision: initial.presentationControlRevision, mode: 'living-book', action: 'select' });
    await harness.reader.action('focus-context');
    const layoutChanges = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    let selected: ReturnType<typeof harness.changeFocusedSourceSelection> | undefined, revealCount = 0;
    harness.delayPanelRegistration('codebook.scopedBrowser', true);
    harness.onNextPanel('codebook.scopedBrowser', () => { selected = harness.changeFocusedSourceSelection(46); revealCount = harness.panelReveals().length; });
    const state = harness.reader.presentationState();
    // Act
    await assert.rejects(harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' }), {
      code: 'PRESENTATION_UNAVAILABLE', causeDetail: 'Error: Native source selection changed while presentation panes moved; the learner selection was preserved.',
    });
    // Assert
    assert.ok(selected); assert.deepEqual(selected.selections.map(selection => selection.active.line), [46]);
    assert.equal(harness.panelReveals().length, revealCount); assert.equal(harness.focusedPanel(), undefined);
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, layoutChanges);
    assert.equal(harness.reader.presentationState().mode, 'living-book'); assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), { version: 1, mode: 'living-book' });
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

for (const replacement of ['wrapper', 'opened', 'unannounced'] as const) test(`source-group ${replacement} replacement during pane movement ${replacement === 'wrapper' ? 'retains' : 'invalidates'} presentation ownership`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await openRetainedStudy(harness); await harness.reader.understand(true);
    const initial = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: initial.presentationId, expectedRevision: initial.presentationControlRevision, mode: 'living-book', action: 'select' });
    await harness.reader.action('focus-context');
    const source = harness.reader.inspect().sourceUri, decisions = await (await harness.reader.learningStorage()).readProgress();
    let replaced = false;
    harness.onNextPanel('codebook.scopedBrowser', () => { replaced = true; harness.replaceEditorGroup(replacement); });
    const state = harness.reader.presentationState();
    // Act
    const changing = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' });
    if (replacement === 'wrapper') await changing;
    else await assert.rejects(changing, { code: 'PRESENTATION_UNAVAILABLE', causeDetail: 'Error: Native focus changed while presentation panes moved; the learner focus was preserved.' });
    // Assert
    assert.equal(replaced, true); assert.equal(harness.reader.inspect().sourceUri, source);
    assert.deepEqual(await (await harness.reader.learningStorage()).readProgress(), decisions);
    assert.equal(harness.reader.presentationState().layoutConfirmed, replacement === 'wrapper');
    assert.equal(harness.reader.presentationState().mode, replacement === 'wrapper' ? 'guided-walkthrough' : 'living-book');
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('mode transfer waits for replacement-pane registration before treating the new grid as a stable learner arrangement', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await openRetainedStudy(harness); await harness.reader.action('focus-app'); await harness.reader.understand(true);
    const before = harness.reader.inspect(), decisions = await (await harness.reader.learningStorage()).readProgress(), draft = harness.addForeignDraft();
    harness.delayPanelRegistration('codebook.studyContext', true);
    const state = harness.reader.presentationState();
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    // Assert
    assert.equal(harness.reader.presentationState().mode, 'living-book'); assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser'); assert.equal(harness.reader.inspect().sourceUri, before.sourceUri);
    assert.deepEqual(await (await harness.reader.learningStorage()).readProgress(), decisions);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft)), true); assert.equal(draft.isDirty, true); assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('Guided walkthrough returns to Study without an unnecessary kept-tab focus handoff', async () => {
  // Arrange: native Keep Editor focus can echo even though both owned tabs are already retained.
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); let state = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' });
    state = harness.reader.presentationState(); const source = harness.reader.inspect().sourceUri;
    const focusedPanel = harness.focusedPanel(), draft = harness.addForeignDraft();
    harness.deferKeptFocusEcho();
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'select' });
    // Assert: the unchanged source, learner draft and initiating focus survive the confirmed mode change.
    assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.reader.inspect().sourceUri, source); assert.equal(harness.focusedPanel(), focusedPanel);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft)), true); assert.equal(draft.isDirty, true);
    assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), { version: 1, mode: 'study-workspace' });
    assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('a learner source selection during final reading restoration survives without a later focus restore', async () => {
  // Arrange: already kept tabs leave the verified source focused while its reading position settles.
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); const state = harness.reader.presentationState();
    let changedSource: ReturnType<typeof harness.changeFocusedSourceSelection> | undefined;
    harness.changeAfterNextReadingReveal(() => { changedSource = harness.changeFocusedSourceSelection(46); });
    // Act
    await assert.rejects(harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' }), {
      code: 'PRESENTATION_UNAVAILABLE', causeDetail: 'Error: Native source selection changed while presentation panes moved; the learner selection was preserved.',
    });
    // Assert: neither the previous selection nor the prior explanation focus may replace the learner choice.
    assert.ok(changedSource); assert.equal(changedSource.selections[0]?.active.line, 46);
    assert.equal(harness.focusedPanel(), undefined); assert.equal(harness.presentationPreferences.size, 0);
    assert.equal(harness.reader.presentationState().layoutConfirmed, false); assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

test('switching presentation waits for restored application focus before confirming the new mode', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); await harness.reader.action('focus-app');
    const state = harness.reader.presentationState();
    // A single final focus request must await its delayed native notification.
    harness.deferPanelFocus('codebook.scopedBrowser', 1);
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    // Assert
    assert.equal(harness.focusedPanel(), 'codebook.scopedBrowser');
    assert.equal(harness.reader.presentationState().mode, 'living-book');
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), { version: 1, mode: 'living-book' });
  } finally { await harness.close(); }
});

test('a missing explicit replay-focus receipt rejects once without retrying focus or losing retained evidence', async context => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    await harness.reader.understand(true); await harness.reader.action('focus-app');
    const source = harness.reader.inspect().sourceUri, bundle = harness.controller.bundle(), library = await harness.reader.learningStorage();
    const decisions = (await library.readProgress()).decisions, draft = harness.addForeignDraft();
    let focusRequests = 0, placedLayout: unknown;
    const app = harness.reader['app']; assert.ok(app);
    {
      const post = app.webview.postMessage.bind(app.webview);
      context.mock.method(app.webview, 'postMessage', (message: Parameters<typeof post>[0]) => {
        if (message.type === 'codebook-focus' && message.phase === 'commit') { focusRequests++; placedLayout ??= harness.editorLayout(); return Promise.resolve(true); }
        return post(message);
      });
    }
    const state = harness.reader.presentationState();
    // Act
    await assert.rejects(harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'focus' }), {
      code: 'PRESENTATION_UNAVAILABLE', causeDetail: 'Error: Timed out waiting for owned presentation inner focus',
    });
    // Assert: failed focus cannot change layout, select another mode or rewrite learner evidence.
    assert.equal(focusRequests, 1, 'One failed final restore must not trigger a second full focus wait');
    assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    assert.equal(harness.reader.presentationState().layoutConfirmed, state.layoutConfirmed); assert.equal(harness.reader.presentationState().state, 'open');
    assert.equal(harness.presentationPreferences.size, 0); assert.deepEqual(harness.editorLayout(), placedLayout);
    assert.equal(harness.controller.state().mode, 'paused'); assert.equal(harness.controller.state().presentedMs, 100);
    assert.equal(harness.controller.bundle(), bundle); assert.equal(harness.reader.inspect().sourceUri, source);
    assert.equal(harness.displayedImage(), harness.png.toString('base64')); assert.deepEqual((await library.readProgress()).decisions, decisions);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft)), true); assert.equal(draft.isDirty, true);
    assert.equal(harness.runtimes.length, 1); assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { context.mock.restoreAll(); await harness.close(); }
});

for (const editStage of ['before focus restoration', 'during native source display', 'during reading reveal'] as const) test(`a draft edited ${editStage} rejects its obsolete reading pose without overwriting the new text`, async () => {
  // Arrange: the same native tab survives a document edit, so group ownership alone cannot validate its old pose.
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open();
    const draft = harness.focusMutableDraft(); harness.retainReadingRange(84, 96);
    const restoreFocus = harness.reader['capturePresentationFocus']();
    await harness.reader.action('focus-app');
    const edit = () => draft.replaceContent('New first line.\nNew last line.\n');
    if (editStage === 'before focus restoration') edit();
    else if (editStage === 'during native source display') harness.changeAfterNextSourceDisplay(edit);
    else harness.changeAfterNextReadingReveal(edit);
    // Act
    await assert.rejects(restoreFocus(), /document changed during presentation/);
    // Assert: changed text and its learner-owned dirty tab remain untouched; no new mode can be saved.
    assert.equal(draft.document.getText(), 'New first line.\nNew last line.\n');
    assert.equal(draft.document.version, 2); assert.equal(draft.tab.isDirty, true);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft.tab)), true);
    assert.equal(harness.presentationPreferences.size, 0);
  } finally { await harness.close(); }
});

test('an unchanged learner draft restores its reading pose and remains dirty', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); const draft = harness.focusMutableDraft(); harness.retainReadingRange(84, 96);
    const restoreFocus = harness.reader['capturePresentationFocus'](); await harness.reader.action('focus-app');
    // Act
    await restoreFocus();
    // Assert
    assert.equal(draft.document.getText(), 'Original learner draft.\n'); assert.equal(draft.document.version, 1);
    assert.equal(draft.tab.isDirty, true); assert.equal(harness.isReadingLineVisible(90), true);
    assert.equal(harness.focusedPanel(), undefined);
  } finally { await harness.close(); }
});

test('restoring replay preserves a learner draft opened over historical source during layout measurement', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {};
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    await harness.reader.understand(true); await harness.reader.action('read-source');
    const source = harness.reader.inspect().sourceUri, bundle = harness.controller.bundle(), library = await harness.reader.learningStorage();
    const progress = await library.readProgress(), layout = harness.holdNextCommand('vscode.getEditorLayout'); release = layout.release;
    const state = harness.reader.presentationState();
    const restoring = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'restore' });
    const rejected = assert.rejects(restoring, /focus|pane|tab/i); await layout.started;
    // Act: the newer draft owns the historical source's group before measurement returns.
    const draft = harness.focusMutableDraft('replay-reading-notes.txt', 2), placedLayout = harness.editorLayout();
    const commands = [...harness.commands], reveals = harness.panelReveals();
    layout.release(); await rejected;
    // Assert
    assert.equal(draft.editor.group.activeTab, draft.tab); assert.equal(draft.tab.isDirty, true);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    assert.deepEqual(harness.editorLayout(), placedLayout); assert.deepEqual(harness.commands, commands); assert.deepEqual(harness.panelReveals(), reveals);
    assert.equal(harness.reader.presentationState().layoutConfirmed, false); assert.equal(harness.presentationPreferences.size, 0);
    assert.equal(harness.controller.state().mode, 'paused'); assert.equal(harness.controller.state().presentedMs, 100);
    assert.equal(harness.controller.bundle(), bundle); assert.equal(harness.reader.inspect().sourceUri, source);
    assert.equal(harness.displayedImage(), harness.png.toString('base64')); assert.deepEqual(await library.readProgress(), progress);
    assert.equal(harness.runtimes.length, 1); assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { release(); await harness.close(); }
});

test('moving a presentation retains both measured axes when native pane creation flattens the grid', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open();
    harness.changeEditorLayout({ orientation: 0, groups: [{ size: 352, groups: [{ size: 154 }, { size: 154 }] }, { size: 288 }] });
    harness.onNextPanel('codebook.scopedBrowser', () => harness.changeEditorLayout({ orientation: 0, groups: [{ size: 220 }, { size: 220 }, { size: 220 }] }));
    const state = harness.reader.presentationState();
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'restore' });
    // Assert
    assert.deepEqual(harness.editorLayout(), { orientation: 0, groups: [{ size: 384 }, { size: 256, groups: [{ size: 154 }, { size: 154 }] }] });
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
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

test('Close cancels pending focus recovery after a native layout failure without losing the draft or original failure', async context => {
  // Arrange: earlier owned-panel focus receipts succeed; failure recovery receives no final focus receipt.
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let recoveryEntered = () => {};
  const recoveryStarted = new Promise<void>(resolve => { recoveryEntered = resolve; });
  try {
    await harness.reader.open(); await harness.reader.action('focus-app');
    const draft = harness.addForeignDraft(), state = harness.reader.presentationState();
    let focusRequests = 0;
    harness.onNextPanel('codebook.scopedBrowser', app => {
      const post = app.webview.postMessage.bind(app.webview);
      context.mock.method(app.webview, 'postMessage', (message: Parameters<typeof post>[0]) => {
        if (message.type === 'codebook-focus' && message.phase === 'commit') { focusRequests++; recoveryEntered(); return Promise.resolve(true); }
        return post(message);
      });
      // Fail the measured layout read after adoption and source anchoring; only error-path focus recovery follows.
      harness.failNextCommand('vscode.getEditorLayout');
    });
    const transfer = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    const rejected = assert.rejects(transfer, {
      code: 'PRESENTATION_UNAVAILABLE', causeDetail: 'Error: Native layout command failed',
    });
    await recoveryStarted;
    const cancellation = harness.reader['presentationTransition']?.cancellation.signal; assert.ok(cancellation);
    // Act: Close arrives after recovery begins, so its initial ownership check cannot skip the recovery.
    let closed = false; const closing = harness.reader.close().then(() => { closed = true; });
    assert.equal(cancellation.aborted, true);
    await waitUntil(() => closed, 'Close cancels the recovery receipt', 1_000).catch(() => undefined);
    const closedWithinBudget = closed;
    // Drain even a failing regression so no native operation outlives this test.
    await closing; await rejected;
    // Assert
    assert.equal(focusRequests, 1);
    assert.equal(harness.reader.presentationState().state, 'closed'); assert.equal(harness.reader.inspect().opened, false);
    assert.equal(harness.reader.presentationState().layoutConfirmed, false); assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    assert.notEqual(harness.reader.presentationState().presentationId, state.presentationId);
    assert.equal(harness.counts().panels, 0); assert.equal(harness.presentationPreferences.size, 0);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft)), true); assert.equal(draft.isDirty, true);
    assert.equal(harness.runtimes.length, 0);
    assert.equal(closedWithinBudget, true, 'Close should cancel an in-flight recovery focus receipt instead of waiting its full timeout');
  } finally { context.mock.restoreAll(); await harness.close(); }
});

for (const mode of ['study-workspace', 'living-book', 'guided-walkthrough']) test(`ordinary chat opens a closed ${mode} through MCP without starting execution or changing learner work`, async () => {
  // Arrange
  const harness = await workspaceHarness(false);
  harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const draft = harness.focusMutableDraft();
  if (mode !== 'study-workspace') harness.presentationPreferences.set('codebook.presentation.v1', { version: 1, mode });
  const reader = harness.createReader();
  await reader.attach(harness.service);
  const progress = await (await reader.learningStorage()).readProgress();
  const endpoint = await startServer(harness.service);
  const transport = new StreamableHTTPClientTransport(new URL(endpoint.descriptor.url), { requestInit: { headers: { Authorization: `Bearer ${endpoint.descriptor.token}` } } });
  const client = new Client({ name: 'cold-presentation-test', version: '1.0' }); await client.connect(transport);
  try {
    // Act: ordinary discovery must not open panes; the explicit presentation request owns that effect.
    const discovery = await client.callTool({ name: 'codebook_status', arguments: {} });
    const selected = z.object({ data: z.object({ instanceId: z.string(), presentation: z.object({ presentationId: z.string(), presentationControlRevision: z.number(), mode: z.string(), state: z.string() }) }) }).parse(discovery.structuredContent).data;
    assert.equal(selected.presentation.mode, mode); assert.equal(selected.presentation.state, 'closed');
    assert.equal(harness.counts().panels, 0);
    const opened = await client.callTool({ name: 'codebook_presentation', arguments: { instanceId: selected.instanceId, presentationId: selected.presentation.presentationId, expectedRevision: selected.presentation.presentationControlRevision, mode: selected.presentation.mode, action: 'select' } });
    // Assert
    assert.equal(opened.isError, undefined, JSON.stringify(opened.structuredContent));
    const state = reader.presentationState();
    assert.equal(state.state, 'open'); assert.equal(state.mode, mode); assert.equal(state.layoutConfirmed, true);
    assert.equal(state.reader.contentTab, 'overview'); assert.equal(state.reader.followingCurrentRun, true);
    // A newly opened reader follows the run but still needs the public Live selection before runtime input.
    const openedState = z.object({ data: z.object({ reader: z.object({ contentRevision: z.number() }) }) }).parse(opened.structuredContent).data;
    const returned = await client.callTool({ name: 'codebook_return_current', arguments: { instanceId: selected.instanceId, presentationId: selected.presentation.presentationId, expectedRevision: openedState.reader.contentRevision } });
    assert.equal(returned.isError, undefined, JSON.stringify(returned.structuredContent));
    assert.equal(reader.presentationState().reader.contentTab, 'live'); assert.equal(reader.presentationState().reader.followingCurrentRun, true);
    assert.equal(reader.presentationState().mode, mode);
    assert.equal(harness.counts().panels, 2); assert.equal(harness.runtimes.length, 0); assert.equal(harness.service.records.size, 0);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft.tab)), true);
    assert.equal(draft.document.getText(), 'Original learner draft.\n'); assert.equal(draft.tab.isDirty, true);
    assert.deepEqual(await (await reader.learningStorage()).readProgress(), progress);
  } finally { await client.close(); await endpoint.close(); await reader.dispose(); await harness.close(); }
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

test('editor AI can return a saved recording to its current run without repeating application input or losing history', async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  const service = harness.service;
  let next: ReturnType<typeof service.start> | undefined;
  let endpoint: Awaited<ReturnType<typeof startServer>> | undefined;
  let client: Client | undefined;
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    next = service.start({ instanceId: service.instanceId, profile: PROFILE_ID, configuration: harness.configuration, key: 'after-saved-recording' });
    await service.record(next).preparation;
    endpoint = await startServer(service);
    const transport = new StreamableHTTPClientTransport(new URL(endpoint.descriptor.url), { requestInit: { headers: { Authorization: `Bearer ${endpoint.descriptor.token}` } } });
    client = new Client({ name: 'reader-return-contract-test', version: '1.0' }); await client.connect(transport);
    const status = await client.callTool({ name: 'codebook_status', arguments: {} });
    const discovered = z.object({ data: z.object({ instanceId: z.string(), presentation: z.object({ presentationId: z.string(), reader: z.object({ contentRevision: z.number(), contentTab: z.literal('recording'), followingCurrentRun: z.literal(false) }) }) }) }).parse(status.structuredContent).data;
    const input = { instanceId: discovered.instanceId, presentationId: discovered.presentation.presentationId, expectedRevision: discovered.presentation.reader.contentRevision };
    const stale = await client.callTool({ name: 'codebook_return_current', arguments: { ...input, expectedRevision: input.expectedRevision + 1 } });
    const wrong = await client.callTool({ name: 'codebook_return_current', arguments: { ...input, instanceId: randomUUID() } });
    assert.match(JSON.stringify(stale.structuredContent), /STALE_PRESENTATION/);
    assert.match(JSON.stringify(wrong.structuredContent), /STALE_INSTANCE/);
    assert.equal(harness.controller.state().mode, 'paused');
    // Act
    const returned = await client.callTool({ name: 'codebook_return_current', arguments: input });
    const result = z.object({ data: z.object({ presentationId: z.string(), reader: z.object({ contentRevision: z.number(), contentTab: z.literal('live'), followingCurrentRun: z.literal(true) }) }) }).parse(returned.structuredContent).data;
    // Assert
    assert.equal(returned.isError, undefined);
    assert.equal(result.presentationId, input.presentationId);
    assert.ok(result.reader.contentRevision > input.expectedRevision);
    assert.equal(harness.reader.inspect().view!.model.selection.follow, true);
    assert.equal(harness.runtimes.at(-1)!.dispatches, 0);
    const library = await harness.reader.learningStorage();
    assert.equal((await library.readStudy(harness.studyId)).id, harness.studyId);
    assert.equal((await library.readProgress()).decisions.length, 0);
  } finally {
    try { await client?.close(); }
    finally {
      try { await endpoint?.close(); }
      finally {
        try { if (next) await service.stop(next); }
        finally { await harness.close(); }
      }
    }
  }
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

for (const boundary of ['layout read', 'layout application'] as const) test(`manual resume during presentation ${boundary} cannot certify or save a different live state`, async () => {
  // Arrange
  const harness = await workspaceHarness(); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {};
  try {
    await harness.reader.open(); harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() });
    await [...harness.service.records.values()][0]!.preparation;
    const runtime = harness.runtimes[0]!, view = runtime.view.bind(runtime);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=', 'base64');
    await writeFile(join(runtime.evidence.directory, 'paused-browser.png'), png);
    runtime.view = () => ({ ...view(), captures: { 'paused-browser': { status: 'captured', file: 'paused-browser.png', renderer: { epoch: 'test', id: 1, hash: sha256(png) } } } });
    await harness.reader.action('click');
    await harness.reader.action('focus-app');
    harness.changeEditorLayout({ orientation: 1, groups: [{ size: 0.7 }, { size: 0.3 }] });
    const state = harness.reader.presentationState();
    const held = harness.holdNextCommand(boundary === 'layout read' ? 'vscode.getEditorLayout' : 'vscode.setEditorLayout'); release = held.release;
    const transfer = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'restore' });
    const rejected = assert.rejects(transfer, /live pause changed/);
    await held.started;
    // Act: a native debugger action changes the pause while native layout acknowledgement is pending.
    runtime.gate.invalidate(); runtime.status = 'ready'; held.release();
    await rejected;
    // Assert
    assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    assert.equal(harness.presentationPreferences.size, 0);
    assert.equal(runtime.dispatches, 1);
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
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

test('restoring layout during a late replay image retains the current frame and lets the requested seek finish', async () => {
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
    await harness.reader.action('focus-app');
    const state = harness.reader.presentationState();
    // Act
    const transfer = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'restore' });
    await transfer;
    assert.equal(harness.controller.bundle(), retained); assert.equal(harness.controller.state().presentedMs, 100);
    assert.equal(harness.controller.state().readiness, 'loading');
    release(); await harness.controller.settle();
    // Assert
    assert.equal(harness.controller.state().mode, 'paused'); assert.equal(harness.controller.state().presentedMs, 150); assert.equal(harness.controller.state().requestedMs, 150);
    assert.equal(harness.controller.bundle()?.projection.positionMs, 150); assert.equal(harness.controller.state().readiness, 'ready'); assert.equal(harness.reader.inspect().sourceUri, source);
    assert.equal(harness.reader.inspect().view?.contentTab, 'recording'); assert.equal(harness.displayedImage(), harness.png.toString('base64'));
    assert.deepEqual((await library.readProgress()).decisions, decisions); assert.equal(harness.runtimes.length, 1); assert.equal(harness.runtimes[0]!.dispatches, 1);
    assert.equal((await harness.store.readPreference())?.positionMs, 150); assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    const next = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: next.presentationId, expectedRevision: next.presentationControlRevision, mode: 'study-workspace', action: 'restore' });
    assert.equal(harness.controller.state().presentedMs, 150); assert.equal(harness.controller.state().mode, 'paused'); assert.equal(harness.reader.inspect().sourceUri, source);
  } finally { release(); await harness.close(); }
});

test('presentation source acquisition restores every original selection after the owned native response', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); await harness.reader.action('source');
    const source = harness.focusedSource(); assert.ok(source);
    const position = source.selections[0]!.active;
    source.selections = [{ anchor: position.with(5, 1), active: position.with(9, 3) }, { anchor: position.with(18, 6), active: position.with(17, 2) }];
    let displayed: typeof source | undefined;
    harness.changeAfterNextSourceDisplay(editor => { displayed = editor; });
    const state = harness.reader.presentationState();
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    // Assert
    assert.deepEqual(displayed?.selections.map(selection => [selection.anchor.line, selection.anchor.character, selection.active.line, selection.active.character]), [[5, 1, 9, 3], [18, 6, 17, 2]]);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
  } finally { await harness.close(); }
});

for (const sourceClosed of [false, true]) for (const interaction of ['selection', 'none'] as const) test(`presentation source acquisition ${sourceClosed ? 'with a closed source tab ' : ''}${interaction === 'none' ? 'continues after unchanged native display' : 'preserves a newer selection before the display response'}`, async () => {
  // Arrange: native Source is already visible when its display response is still pending.
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); await harness.reader.action('source');
    if (sourceClosed) {
      const group = harness.groups.find(group => group.viewColumn === harness.sourceColumn()); assert.ok(group?.activeTab);
      group.tabs = group.tabs.filter(tab => tab !== group.activeTab); group.activeTab = undefined;
      await harness.reader.action('focus-context');
    }
    const state = harness.reader.presentationState();
    let revealed: ReturnType<typeof harness.focusedSource>, reveals: ReturnType<typeof harness.panelReveals> | undefined, commands: string[] | undefined;
    harness.changeAfterNextSourceDisplay(editor => {
      revealed = editor;
      if (interaction === 'selection') {
        const active = harness.focusedSource(); assert.ok(active);
        editor.selections = [{ anchor: editor.selections[0]!.active.with(39, 6), active: editor.selections[0]!.active.with(39, 6) }]; active.selections = editor.selections;
        harness.retainReadingRange(34, 46);
      }
      reveals = harness.panelReveals(); commands = [...harness.commands];
    });
    // Act
    const transfer = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    if (interaction === 'none') await transfer;
    else await assert.rejects(transfer, /not confirmed/);
    // Assert
    assert.ok(revealed);
    assert.equal(revealed.selections[0]!.active.line, interaction === 'selection' ? 39 : 0);
    assert.equal(harness.reader.presentationState().layoutConfirmed, interaction === 'none');
    assert.equal(harness.reader.presentationState().mode, interaction === 'none' ? 'living-book' : 'study-workspace');
    if (interaction === 'selection') {
      assert.equal(harness.focusedSource()?.selections[0]!.active.character, 6); assert.equal(harness.isReadingLineVisible(40), true);
      assert.deepEqual(harness.panelReveals(), reveals); assert.deepEqual(harness.commands, commands);
      assert.equal(harness.presentationPreferences.size, 0);
    }
  } finally { await harness.close(); }
});

for (const interaction of ['selection', 'none'] as const) test(`presentation post-move layout response ${interaction === 'none' ? 'completes the unchanged reading pose' : 'preserves a newer source selection and viewport before further effects'}`, async () => {
  // Arrange: arm the next layout read only after the native source display, so the first scope read is not held.
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let held: ReturnType<typeof harness.holdNextCommand> | undefined, displayed!: () => void;
  const sourceDisplayed = new Promise<void>(resolve => { displayed = resolve; });
  let transfer: Promise<unknown> | undefined;
  try {
    await harness.reader.open(); harness.retainReadingRange(0, 12);
    harness.changeAfterNextSourceDisplay(() => { held = harness.holdNextCommand('vscode.getEditorLayout'); displayed(); });
    const state = harness.reader.presentationState();
    transfer = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' });
    const outcome = interaction === 'none' ? transfer : assert.rejects(transfer, /not confirmed/);
    await sourceDisplayed; assert.ok(held); await held.started;
    assert.ok(harness.focusedSource());
    // Act
    if (interaction === 'selection') { harness.changeFocusedSourceSelection(46); harness.retainReadingRange(40, 52); }
    const commands = [...harness.commands], reveals = harness.panelReveals();
    held.release(); await outcome;
    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, interaction === 'none');
    if (interaction === 'selection') {
      assert.deepEqual(harness.commands, commands); assert.deepEqual(harness.panelReveals(), reveals);
      assert.equal(harness.focusedSource()?.selections[0]?.active.line, 46); assert.equal(harness.isReadingLineVisible(46), true);
      assert.equal(harness.presentationPreferences.size, 0); assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    } else assert.equal(harness.reader.presentationState().mode, 'guided-walkthrough');
  } finally { held?.release(); await transfer?.catch(() => undefined); await harness.close(); }
});

for (const interruption of ['original source', 'departure and reentry', 'same-group tab roundtrip', 'none'] as const) test(`native activation preparation ${interruption === 'none' ? 'completes while ownership remains held' : `preserves learner ${interruption} without a late focus commit`}`, async context => {
  // Arrange: hold the actual final Context preparation after it has selected the native editor.
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {}, transfer: Promise<unknown> | undefined;
  try {
    await harness.reader.open(); await harness.reader.action('focus-context');
    const initial = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: initial.presentationId, expectedRevision: initial.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' });
    let panel = harness.nativePanels().find(current => current.kind === 'codebook.studyContext'); assert.ok(panel);
    const sameGroupDraft = interruption === 'same-group tab roundtrip' ? harness.addForeignDraft(panel.viewColumn) : undefined;
    const listenerCount = harness.focusListenerCount();
    let originalSource: ReturnType<typeof harness.focusedSource>, interrupted = false, lateCommits = 0;
    let entered = (_source: NonNullable<typeof originalSource>) => {};
    const prepared = new Promise<NonNullable<typeof originalSource>>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    // Final native activation belongs to the adopted document, including same-column changes.
    harness.onNextPanel('codebook.studyContext', replacement => {
      panel = replacement;
      const reveal = replacement.reveal.bind(replacement), post = replacement.webview.postMessage.bind(replacement.webview);
      context.mock.method(replacement, 'reveal', (...arguments_: Parameters<typeof replacement.reveal>) => {
        if (!interrupted) originalSource = harness.focusedSource();
        return reveal(...arguments_);
      });
      context.mock.method(replacement.webview, 'postMessage', async (message: Parameters<typeof post>[0]) => {
        if (message.type === 'codebook-focus' && message.phase === 'prepare' && originalSource && !interrupted) {
          interrupted = true; entered(originalSource); await held;
        } else if (message.type === 'codebook-focus' && message.phase === 'commit' && interrupted) lateCommits++;
        return post(message);
      });
    });
    const state = harness.reader.presentationState();
    transfer = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'select' });
    const outcome = interruption === 'none' ? transfer : assert.rejects(transfer, /not confirmed/);
    const source = await prepared;
    assert.equal(harness.focusedPanel(), 'codebook.studyContext');
    // Act: source return may exactly match the start snapshot, but it is a newer learner choice.
    if (interruption !== 'none') {
      if (sameGroupDraft) harness.roundtripExistingPanelTab('codebook.studyContext', sameGroupDraft);
      else harness.focusExistingSource(source);
      source.selections = [{ anchor: source.selections[0]!.active.with(31, 4), active: source.selections[0]!.active.with(31, 4) }];
      if (interruption === 'departure and reentry') panel?.reveal(undefined, false);
    }
    const reveals = harness.panelReveals(), commands = [...harness.commands];
    release(); await outcome;
    // Assert
    assert.equal(harness.focusListenerCount(), listenerCount);
    if (interruption === 'none') {
      assert.equal(harness.reader.presentationState().mode, 'study-workspace');
      assert.equal(harness.reader.presentationState().layoutConfirmed, true); assert.equal(lateCommits, 1);
    } else {
      assert.equal(lateCommits, 0); assert.deepEqual(harness.panelReveals(), reveals); assert.deepEqual(harness.commands, commands);
      assert.equal(source.selections[0]!.active.line, 31); assert.equal(source.selections[0]!.active.character, 4);
      assert.equal(harness.reader.presentationState().mode, 'guided-walkthrough'); assert.equal(harness.reader.presentationState().layoutConfirmed, false);
      assert.deepEqual(harness.presentationPreferences.get('codebook.presentation.v1'), { version: 1, mode: 'guided-walkthrough' });
      if (interruption === 'original source') assert.equal(harness.focusedSource(), source);
      else assert.equal(harness.focusedPanel(), 'codebook.studyContext');
    }
  } finally { release(); await transfer?.catch(() => undefined); context.mock.restoreAll(); await harness.close(); }
});

test('mode selection rejects missing inner focus instead of treating native tab activation as success', async () => {
  // Arrange: H's native tab acknowledgment can succeed while the inner document never receives focus.
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open();
    harness.movePanel('codebook.studyContext', 3);
    harness.suppressNativeInnerFocus();
    const state = harness.reader.presentationState();
    // Act
    await assert.rejects(harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' }), {
      code: 'PRESENTATION_UNAVAILABLE', causeDetail: 'Error: Timed out waiting for owned presentation inner focus',
    });
    // Assert: native selection alone cannot certify document focus or commit a preference.
    assert.equal(harness.innerFocusedPanel(), undefined);
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    assert.equal(harness.presentationPreferences.size, 0);
  } finally { await harness.close(); }
});

test('leaving the native work window during presentation preserves the prior preference without recovering focus', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {};
  try {
    await harness.reader.open();
    const held = harness.holdPresentationMessage(); release = held.release;
    const state = harness.reader.presentationState();
    const transfer = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    const rejected = assert.rejects(transfer, /lost focus/); await held.started;
    const reveals = harness.panelReveals();
    // Act
    harness.changeWindowFocus(false); held.release(); await rejected;
    // Assert
    assert.deepEqual(harness.panelReveals(), reveals); assert.equal(harness.presentationPreferences.size, 0);
    assert.equal(harness.reader.presentationState().mode, 'study-workspace'); assert.equal(harness.windowFocusListeners(), 0);
  } finally { release(); await harness.close(); }
});

test('a background work window refuses a mode change before native effects', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); harness.changeWindowFocus(false);
    const state = harness.reader.presentationState(), reveals = harness.panelReveals();
    // Act / Assert
    assert.throws(() => harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' }), /Focus this Codebook work window/);
    assert.deepEqual(harness.panelReveals(), reveals); assert.equal(harness.presentationPreferences.size, 0);
  } finally { await harness.close(); }
});

test('presentation cannot save its mode from a stale reading restoration receipt', async () => {
  // Arrange
  const harness = await workspaceHarness(); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let releaseRestore: (() => void) | undefined;
  try {
    await harness.reader.open();
    const state = harness.reader.presentationState();
    let observed!: () => void; const requested = new Promise<void>(resolve => { observed = resolve; });
    harness.onNextPanel('codebook.studyContext', panel => {
      const originalPost = panel.webview.postMessage.bind(panel.webview);
      panel.webview.postMessage = message => {
        if (message.type !== 'restore-presentation-pose') return originalPost(message);
        releaseRestore = () => { void originalPost(message); }; observed(); return Promise.resolve(true);
      };
    });
    const changing = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' });
    await requested;
    // Act
    harness.receive({ type: 'presentation-pose-restored', captureId: '33333333-3333-4333-8333-333333333333' });
    await new Promise<void>(resolve => setImmediate(resolve));
    // Assert
    assert.equal(harness.presentationPreferences.size, 0); assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    releaseRestore?.(); await changing;
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
  } finally { releaseRestore?.(); await harness.close(); }
});

for (const stage of ['capture-presentation-pose', 'restore-presentation-pose'] as const) test(`Close cancels stalled ${stage} delivery without waiting for the renderer transport`, async () => {
  // Arrange: delivery itself is pending, so the later receipt deadline cannot observe cancellation.
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let releaseDelivery = (_accepted: boolean) => {}, changing: Promise<unknown> | undefined, closing: Promise<void> | undefined;
  try {
    await harness.reader.open();
    const panel = harness.nativePanels().find(current => current.kind === 'codebook.studyContext'); assert.ok(panel);
    let observed!: () => void; const requested = new Promise<void>(resolve => { observed = resolve; });
    const delivery = new Promise<boolean>(resolve => { releaseDelivery = resolve; });
    const holdDelivery = (target: NonNullable<typeof panel>) => {
      const originalPost = target.webview.postMessage.bind(target.webview);
      target.webview.postMessage = message => { if (message.type !== stage) return originalPost(message); observed(); return delivery; };
    };
    // Capture uses the predecessor; restoration uses the newly adopted document.
    if (stage === 'capture-presentation-pose') holdDelivery(panel);
    else harness.onNextPanel('codebook.studyContext', holdDelivery);
    const state = harness.reader.presentationState();
    changing = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' });
    void changing.catch(() => undefined); await requested;
    // Act
    closing = harness.reader.close();
    const result = await Promise.race([closing.then(() => 'closed'), new Promise<string>(resolve => setTimeout(() => resolve('blocked by transport'), 500))]);
    // Assert
    assert.equal(result, 'closed'); assert.equal(harness.counts().panels, 0);
    await assert.rejects(changing, { code: 'PRESENTATION_UNAVAILABLE' });
    assert.equal(harness.presentationPreferences.size, 0); assert.equal(harness.reader.presentationState().state, 'closed');
  } finally { releaseDelivery(false); await changing?.catch(() => undefined); await closing; await harness.close(); }
});

for (const stage of ['capture-presentation-pose', 'restore-presentation-pose'] as const) for (const failure of ['rejected', 'not delivered', 'stalled'] as const) test(`${failure} ${stage} delivery refuses the presentation within its existing deadline`, { timeout: 15_000 }, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let releaseDelivery = (_accepted: boolean) => {};
  try {
    await harness.reader.open();
    const panel = harness.nativePanels().find(current => current.kind === 'codebook.studyContext'); assert.ok(panel);
    const pending = new Promise<boolean>(resolve => { releaseDelivery = resolve; });
    const failDelivery = (target: NonNullable<typeof panel>) => {
      const originalPost = target.webview.postMessage.bind(target.webview);
      target.webview.postMessage = message => message.type !== stage ? originalPost(message)
        : failure === 'stalled' ? pending : failure === 'not delivered' ? Promise.resolve(false) : Promise.reject(new Error('Reading transport rejected.'));
    };
    // The failure must reach the document handling this stage after a same-column handoff.
    if (stage === 'capture-presentation-pose') failDelivery(panel);
    else harness.onNextPanel('codebook.studyContext', failDelivery);
    const state = harness.reader.presentationState();
    // Act / Assert: even transport failure must not save a mode or manufacture a reading receipt.
    await assert.rejects(harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' }), {
      code: 'PRESENTATION_UNAVAILABLE', causeDetail: failure === 'rejected' ? 'Error: Reading transport rejected.'
        : failure === 'not delivered' ? 'Error: Reading position message could not reach the current explanation.'
          : `Error: Timed out waiting for ${stage === 'capture-presentation-pose' ? 'retained' : 'restored'} reading position`,
    });
    assert.equal(harness.presentationPreferences.size, 0);
    assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    assert.equal(harness.reader.presentationState().state, 'open');
  } finally { releaseDelivery(false); await harness.close(); }
});

test('learner input after reading capture cancels placement without saving or restoring the obsolete pose', async () => {
  // Arrange
  const harness = await workspaceHarness(); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {};
  try {
    await harness.reader.open();
    const panel = harness.reader['contextPanel']; assert.ok(panel);
    const originalPost = panel.webview.postMessage.bind(panel.webview), state = harness.reader.presentationState();
    let capture: PresentationPoseCapture | undefined, restorations = 0;
    panel.webview.postMessage = message => {
      if (message.type === 'capture-presentation-pose') capture = message;
      if (message.type === 'restore-presentation-pose') restorations++;
      return originalPost(message);
    };
    const held = harness.holdNextCommand('vscode.getEditorLayout'); release = held.release;
    const changing = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    const rejected = assert.rejects(changing, /newer learner input was preserved/);
    await held.started; assert.ok(capture);
    // Act
    harness.receive({ type: 'presentation-pose-invalidated', captureId: capture.captureId });
    await new Promise<void>(resolve => setImmediate(resolve)); held.release(); await rejected;
    // Assert
    assert.equal(restorations, 0); assert.equal(harness.presentationPreferences.size, 0);
    assert.equal(harness.reader.presentationState().mode, 'study-workspace');
  } finally { release(); await harness.close(); }
});

for (const pane of ['application', 'context'] as const) test(`an unchanged empty chat wrapper during ${pane} replacement preserves all three presentation destinations`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.groups.at(-1)!.tabs = []; harness.groups.at(-1)!.activeTab = undefined;
  try {
    await harness.reader.open();
    const source = harness.reader.inspect().sourceUri, progress = await (await harness.reader.learningStorage()).readProgress();
    let refreshed = false;
    harness.onNextPanel(pane === 'application' ? 'codebook.scopedBrowser' : 'codebook.studyContext', () => {
      assert.equal(harness.reader['layoutReceipt'], undefined); chat.resync('wrapper'); refreshed = true;
    });
    const state = harness.reader.presentationState();
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    // Assert
    assert.equal(refreshed, true); assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.reader.presentationState().mode, 'living-book');
    assert.equal(harness.reader.presentationState().panes.appColumn, 2);
    assert.equal(harness.reader.presentationState().panes.sourceColumn, 3);
    assert.equal(harness.reader.presentationState().panes.contextColumn, 1);
    assert.deepEqual(harness.groups.at(-1)!.tabs, []); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(draft.document.getText(), 'Original learner draft.\n'); assert.equal(harness.reader.inspect().sourceUri, source);
    assert.deepEqual(await (await harness.reader.learningStorage()).readProgress(), progress);
    assert.equal(harness.runtimes.length, 0); assert.equal(harness.counts().panels, 2);
  } finally { await harness.close(); }
});

for (const pane of ['application', 'context'] as const) test(`a ${pane} pane replacement retains a native group containing an unchanged settings tab`, async () => {
  // Arrange: ordinary setup can leave settings tabs beside the Codebook panes in the same three editor groups.
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open();
    const column = pane === 'application' ? 1 : 3;
    const settings = harness.addOpaqueTab('Settings', column);
    harness.onNextPanel(pane === 'application' ? 'codebook.scopedBrowser' : 'codebook.studyContext', () => harness.replaceEditorGroup('wrapper', column));
    const state = harness.reader.presentationState();
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    // Assert: the unchanged foreign tab survives and does not prevent confirmation of the requested mode.
    assert.equal(harness.reader.presentationState().mode, 'living-book');
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.ok(harness.groups.some(group => group.tabs.includes(settings)));
  } finally { await harness.close(); }
});

test('a changed settings tab during pane replacement cannot inherit native group ownership', async () => {
  // Arrange: a foreign tab with an altered title is a learner change, even when Codebook's panel is unchanged.
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open();
    const settings = harness.addOpaqueTab('Settings', 1);
    harness.onNextPanel('codebook.scopedBrowser', () => harness.replaceEditorGroup('wrapper', 1, tabs => {
      tabs[tabs.indexOf(settings)] = { ...settings, label: 'Changed settings' };
    }));
    const state = harness.reader.presentationState();
    // Act / Assert: keep the prior mode and the learner's new tab instead of confirming an adopted group.
    await assert.rejects(harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' }),
      { code: 'PRESENTATION_UNAVAILABLE', causeDetail: 'Error: Native editor groups changed during pane creation; the learner arrangement was preserved.' });
    assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    assert.ok(harness.groups.some(group => group.tabs.some(tab => tab.label === 'Changed settings')));
  } finally { await harness.close(); }
});

test('a replacement settings tab with the same title cannot inherit native group ownership', async () => {
  // Arrange: a learner can reopen Settings under the same visible label while Codebook moves its panes.
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open();
    const originalSettings = harness.addOpaqueTab('Settings', 1);
    const replacementSettings = harness.addOpaqueTab('Settings', 1);
    const settingsGroup = harness.groups.find(group => group.viewColumn === 1);
    assert.ok(settingsGroup);
    settingsGroup.tabs.splice(settingsGroup.tabs.indexOf(replacementSettings), 1);
    harness.onNextPanel('codebook.scopedBrowser', () => harness.replaceEditorGroup('wrapper', 1, tabs => {
      tabs[tabs.indexOf(originalSettings)] = replacementSettings;
    }));
    const state = harness.reader.presentationState();
    // Act: attempt the same presentation transfer after the native wrapper reports its new tab.
    const changing = harness.reader.changePresentation({ presentationId: state.presentationId,
      expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    // Assert: a matching title cannot grant ownership of the learner's replacement tab.
    await assert.rejects(changing, { code: 'PRESENTATION_UNAVAILABLE',
      causeDetail: 'Error: Native editor groups changed during pane creation; the learner arrangement was preserved.' });
    assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    assert.ok(harness.groups.some(group => group.tabs.includes(replacementSettings)));
  } finally { await harness.close(); }
});

for (const change of ['opened', 'unannounced', 'move'] as const) test(`an empty chat ${change} during pane replacement cannot inherit presentation ownership`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const chat = harness.addSeparateEditorPart(), draft = harness.focusMutableDraft();
  harness.groups.at(-1)!.tabs = []; harness.groups.at(-1)!.activeTab = undefined;
  try {
    await harness.reader.open();
    const app = harness.reader['app'], explanation = harness.reader['contextPanel'];
    harness.onNextPanel('codebook.scopedBrowser', () => chat.resync(change));
    const state = harness.reader.presentationState();
    // Act
    await assert.rejects(harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' }),
      { code: 'PRESENTATION_UNAVAILABLE', causeDetail: 'Error: Native editor groups changed during pane creation; the learner arrangement was preserved.' });
    // Assert
    assert.equal(harness.reader['app'], app); assert.equal(harness.reader['contextPanel'], explanation);
    assert.equal(harness.reader.presentationState().mode, 'study-workspace'); assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.equal(harness.presentationPreferences.size, 0); assert.equal(harness.counts().panels, 2);
    assert.deepEqual(harness.groups.at(-1)!.tabs, []); assert.deepEqual(chat.layout(), { orientation: 1, groups: [{ size: 743 }] });
    assert.equal(draft.document.getText(), 'Original learner draft.\n'); assert.equal(harness.runtimes.length, 0);
  } finally { await harness.close(); }
});

for (const positionMs of [0, 100]) test(`restoring replay preserves both live history and replay leases at the confirmed ${positionMs === 0 ? 'missing-frame' : 'captured-frame'} position`, async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const failures: string[] = [];
  let live: ReturnType<NonNullable<typeof harness.reader.presentation.createViewport>> | undefined;
  try {
    live = harness.reader.presentation.createViewport!('handoff-live', () => {}, reason => failures.push(reason), 'normal');
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs }); await harness.controller.settle();
    const app = harness.reader['app'], context = harness.reader['contextPanel'], replay = harness.reader['replayViewport'];
    const bundle = harness.controller.bundle(), image = harness.displayedImage(), source = harness.reader.inspect().sourceUri;
    const progress = await (await harness.reader.learningStorage()).readProgress();
    harness.viewportEvents.length = 0;
    await harness.reader.action('focus-app');
    const state = harness.reader.presentationState();
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'restore' });
    // Assert
    assert.equal(harness.reader['app'], app); assert.equal(harness.reader['contextPanel'], context);
    assert.equal(context, undefined); assert.equal(harness.summary.visible, true);
    assert.equal(harness.reader['viewport'], live); assert.equal(harness.reader['replayViewport'], replay);
    assert.equal(harness.viewportInstances.length, 2);
    assert.equal(harness.viewportInstances[0]!.historical, true);
    for (const viewport of harness.viewportInstances) assert.equal(viewport.panel, harness.reader['app']);
    assert.deepEqual(harness.viewportEvents.filter(event => /^(hold|rebind|release|restore|unexpected-close):/.test(event)), []);
    assert.deepEqual(failures, []); assert.equal(harness.counts().panels, 1); assert.equal(harness.peakPanels(), 1);
    assert.equal(harness.controller.bundle(), bundle); assert.equal(harness.controller.state().presentedMs, positionMs);
    assert.equal(harness.controller.state().mode, 'paused'); assert.equal(harness.displayedImage(), image);
    assert.equal(harness.reader.inspect().sourceUri, source); assert.deepEqual(await (await harness.reader.learningStorage()).readProgress(), progress);
    assert.equal(harness.runtimes.length, 1); assert.equal(harness.runtimes[0]!.dispatches, 1);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.commands.includes('workbench.action.keepEditor'), false);
  } finally { live?.close(); await harness.close(); }
});

for (const failure of ['native layout failure', 'newer learner tab'] as const) test(`replay retains its renderer after ${failure} and restores layout only on explicit retry`, async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let live: ReturnType<NonNullable<typeof harness.reader.presentation.createViewport>> | undefined;
  let draft: ReturnType<typeof harness.focusMutableDraft> | undefined;
  let release = () => {};
  try {
    live = harness.reader.presentation.createViewport!('retained-replay-failure', () => {}, () => {}, 'normal');
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    await harness.reader.action('focus-app');
    const app = harness.reader['app'], bundle = harness.controller.bundle(), image = harness.displayedImage();
    const progress = await (await harness.reader.learningStorage()).readProgress();
    const held = harness.holdNextCommand('workbench.action.minimizeOtherEditors'); release = held.release;
    const state = harness.reader.presentationState();
    const restoring = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'restore' });
    const rejected = assert.rejects(restoring, /Native|focus|pane/i); await held.started;
    // Act: failure arrives while the existing renderer remains attached.
    if (failure === 'native layout failure') harness.failNextCommand('vscode.getEditorLayout');
    else draft = harness.focusMutableDraft('newer-reading-notes.txt', 2);
    held.release(); await rejected;
    // Assert
    assert.equal(harness.reader['app'], app); assert.equal(harness.controller.bundle(), bundle);
    assert.equal(harness.controller.state().presentedMs, 100); assert.equal(harness.controller.state().cleared, false);
    assert.equal(harness.displayedImage(), image); assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.equal(harness.presentationPreferences.size, 0);
    const reveals = harness.panelReveals(); await harness.reader['refresh']();
    assert.deepEqual(harness.panelReveals(), reveals);
    if (draft) { assert.equal(draft.editor.group.activeTab, draft.tab); assert.equal(draft.document.getText(), 'Original learner draft.\n'); }
    // Act: only a new learner request may expose the source and recover its layout.
    await harness.reader.action('read-source'); await harness.reader.action('focus-app');
    const retry = harness.reader.presentationState();
    await harness.reader.changePresentation({ presentationId: retry.presentationId, expectedRevision: retry.presentationControlRevision, mode: 'study-workspace', action: 'restore' });
    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.controller.state().readiness, 'ready'); assert.equal(harness.controller.bundle(), bundle);
    assert.equal(harness.controller.state().presentedMs, 100); assert.equal(harness.displayedImage(), image);
    assert.deepEqual(await (await harness.reader.learningStorage()).readProgress(), progress);
    assert.equal(harness.viewportInstances.length, 2); assert.equal(harness.runtimes.length, 1); assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { release(); live?.close(); await harness.close(); }
});

test('same-column mode changes recover native inner-focus delivery while preserving the current viewport lease', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let live: ReturnType<NonNullable<typeof harness.reader.presentation.createViewport>> | undefined;
  try {
    await harness.reader.open();
    live = harness.reader.presentation.createViewport!('same-column', () => {}, () => {}, 'normal');
    await harness.reader.action('focus-context');
    const source = harness.reader.inspect().sourceUri;
    harness.viewportEvents.length = 0;
    // Act
    for (const mode of ['guided-walkthrough', 'study-workspace'] as const) {
      // The installed host can suppress inner delivery to retained documents despite selecting their native tabs.
      const previous = harness.nativePanels();
      for (const panel of previous) panel.blockInnerFocus = true;
      const state = harness.reader.presentationState();
      await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode, action: 'select' });
      assert.equal(harness.innerFocusedPanel(), 'codebook.studyContext');
      assert.equal(harness.reader.presentationState().mode, mode);
      assert.equal(harness.nativePanels().some(panel => previous.includes(panel)), false);
    }
    // Assert
    assert.equal(harness.reader.inspect().sourceUri, source);
    assert.equal(harness.reader['viewport'], live); assert.equal(harness.peakPanels(), 4); assert.equal(harness.counts().panels, 2);
    assert.deepEqual(harness.viewportEvents, ['hold:live', 'rebind:live', 'release:live', 'restore:live', 'hold:live', 'rebind:live', 'release:live', 'restore:live']);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
  } finally { live?.close(); await harness.close(); }
});

for (const kind of ['codebook.scopedBrowser', 'codebook.studyContext']) test(`same-column handoff preserves its current lease when the host refreshes the previous ${kind} tab wrapper`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let live: ReturnType<NonNullable<typeof harness.reader.presentation.createViewport>> | undefined;
  try {
    await harness.reader.open();
    live = harness.reader.presentation.createViewport!('tab-resync', () => {}, () => {}, 'normal');
    await harness.reader.action('focus-context');
    const previous = harness.nativePanels().find(panel => panel.kind === kind); assert.ok(previous);
    const originalTab = previous.nativeTab, state = harness.reader.presentationState();
    harness.onNextPanel(kind, () => previous.refreshTabWrapper());
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' });
    // Assert
    assert.notEqual(previous.nativeTab, originalTab);
    assert.equal(harness.reader.presentationState().mode, 'guided-walkthrough'); assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.reader['viewport'], live); assert.equal(harness.counts().panels, 2);
    assert.equal(harness.innerFocusedPanel(), 'codebook.studyContext');
  } finally { live?.close(); await harness.close(); }
});

for (const kind of ['codebook.scopedBrowser', 'codebook.studyContext']) test(`same-column ${kind} handoff survives a group-wrapper refresh while both owned tabs coexist`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let live: ReturnType<NonNullable<typeof harness.reader.presentation.createViewport>> | undefined;
  try {
    await harness.reader.open();
    live = harness.reader.presentation.createViewport!('group-resync', () => {}, () => {}, 'normal');
    await harness.reader.action('focus-context');
    const state = harness.reader.presentationState();
    let refreshed = false;
    harness.onNextPanel(kind, replacement => {
      assert.equal(harness.nativePanels().filter(panel => panel.kind === kind).length, 2);
      harness.replaceEditorGroup('wrapper', replacement.viewColumn); refreshed = true;
    });
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' });
    // Assert
    assert.equal(refreshed, true); assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.reader.presentationState().mode, 'guided-walkthrough');
    assert.equal(harness.reader['viewport'], live); assert.equal(harness.counts().panels, 2);
    assert.equal(harness.innerFocusedPanel(), 'codebook.studyContext');
  } finally { live?.close(); await harness.close(); }
});

for (const change of ['opened', 'unannounced', 'third-tab', 'moved-group'] as const) test(`same-column handoff refuses a ${change} during owned tab overlap`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open(); await harness.reader.action('focus-context');
    const state = harness.reader.presentationState();
    let interrupted = false;
    harness.onNextPanel('codebook.scopedBrowser', replacement => {
      const group = harness.groups.find(candidate => candidate.viewColumn === replacement.viewColumn); assert.ok(group);
      // A third lookalike tab and learner group movement cannot become an owned two-pane overlap.
      if (change === 'third-tab') group.tabs.push({ ...replacement.nativeTab });
      if (change === 'moved-group') harness.swapEditorGroups(group, harness.groups.find(candidate => candidate.viewColumn === 3)!);
      harness.replaceEditorGroup(change === 'opened' || change === 'unannounced' ? change : 'wrapper', replacement.viewColumn);
      interrupted = true;
    });
    // Act
    await assert.rejects(harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'guided-walkthrough', action: 'select' }), { code: 'PRESENTATION_UNAVAILABLE' });
    // Assert
    assert.equal(interrupted, true); assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.equal(harness.reader.presentationState().mode, 'study-workspace'); assert.equal(harness.presentationPreferences.size, 0);
  } finally { await harness.close(); }
});

test('explicit same-mode restoration recovers inner-focus delivery without replacing the current viewport lease', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let live: ReturnType<NonNullable<typeof harness.reader.presentation.createViewport>> | undefined;
  try {
    await harness.reader.open();
    live = harness.reader.presentation.createViewport!('unchanged-mode', () => {}, () => {}, 'normal');
    await harness.reader.action('focus-context');
    const state = harness.reader.presentationState();
    for (const panel of harness.nativePanels()) panel.blockInnerFocus = true;
    harness.viewportEvents.length = 0;
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'restore' });
    // Assert
    assert.equal(harness.innerFocusedPanel(), 'codebook.studyContext');
    assert.equal(harness.reader['viewport'], live); assert.equal(harness.peakPanels(), 4); assert.equal(harness.counts().panels, 2);
    assert.deepEqual(harness.viewportEvents, ['hold:live', 'rebind:live', 'release:live', 'restore:live']);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
  } finally { live?.close(); await harness.close(); }
});

for (const failure of ['creation throws', 'unretained tab'] as const) test(`a second replacement that ${failure} preserves the prior panes and live lease without saving the mode`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const failures: string[] = [];
  let live: ReturnType<NonNullable<typeof harness.reader.presentation.createViewport>> | undefined;
  try {
    await harness.reader.open();
    live = harness.reader.presentation.createViewport!('failed-handoff', () => {}, reason => failures.push(reason), 'normal');
    const app = harness.reader['app'], context = harness.reader['contextPanel'], source = harness.reader.inspect().sourceUri;
    const progress = await (await harness.reader.learningStorage()).readProgress();
    if (failure === 'creation throws') harness.failNextPanelCreation('codebook.studyContext');
    else harness.onNextPanel('codebook.studyContext', panel => { panel.nativeTab.isPreview = true; });
    const state = harness.reader.presentationState();
    // Act
    await assert.rejects(harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' }), { code: 'PRESENTATION_UNAVAILABLE' });
    // Assert
    assert.equal(harness.reader['app'], app); assert.equal(harness.reader['contextPanel'], context);
    assert.equal(harness.reader['viewport'], live); assert.equal(harness.viewportInstances[0]!.panel, app);
    assert.deepEqual(failures, []); assert.equal(harness.counts().panels, 2);
    assert.equal(harness.reader.inspect().sourceUri, source); assert.deepEqual(await (await harness.reader.learningStorage()).readProgress(), progress);
    assert.equal(harness.presentationPreferences.size, 0); assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.equal(harness.reader.presentationState().mode, 'study-workspace');
    assert.equal(harness.viewportEvents.some(event => event.startsWith('rebind:')), false);
  } finally { live?.close(); await harness.close(); }
});

test('retired application notifications after reopening cannot change the current replay or learner understanding', async () => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.controller.command({ action: 'seek', studyId: harness.studyId, expectedRevision: harness.controller.state().revision, positionMs: 100 }); await harness.controller.settle();
    const previousApp = harness.nativePanels().find(panel => panel.kind === 'codebook.scopedBrowser')!;
    await harness.reader.close();
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    assert.notEqual(harness.reader['app'], previousApp);
    const presentation = harness.reader.presentationState();
    const bundle = harness.controller.bundle(), progress = await (await harness.reader.learningStorage()).readProgress(), messages = harness.postedMessages().length;
    // Act: already queued callbacks retain their old object even after disposal.
    previousApp.notifyViewState();
    previousApp.emit({ type: 'ready' });
    previousApp.emit({ type: 'understanding', revision: harness.reader.inspect().view!.revision, understood: true });
    previousApp.emit({ type: 'presentation-pose-invalidated', captureId: '33333333-3333-4333-8333-333333333333' });
    await new Promise<void>(resolve => setImmediate(resolve));
    // Assert
    assert.equal(harness.controller.bundle(), bundle); assert.equal(harness.controller.state().readiness, 'ready');
    assert.equal(harness.controller.state().presentedMs, 100); assert.equal(harness.postedMessages().length, messages);
    assert.deepEqual(await (await harness.reader.learningStorage()).readProgress(), progress);
    assert.deepEqual(harness.reader.presentationState(), presentation); assert.equal(harness.counts().panels, 1);
  } finally { await harness.close(); }
});

test('closing the adopted application during native layout rejects the transition and fails its live lease exactly once', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const failures: string[] = [];
  let release = () => {}, live: ReturnType<NonNullable<typeof harness.reader.presentation.createViewport>> | undefined;
  try {
    await harness.reader.open(); live = harness.reader.presentation.createViewport!('close-current', () => {}, reason => failures.push(reason), 'normal');
    const held = harness.holdNextCommand('vscode.setEditorLayout'); release = held.release;
    const state = harness.reader.presentationState();
    const changing = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' });
    const rejected = assert.rejects(changing, { code: 'PRESENTATION_UNAVAILABLE' }); await held.started;
    const app = harness.reader['app']; assert.ok(app);
    // Act
    app.dispose(); app.dispose(); held.release(); await rejected;
    // Assert
    assert.deepEqual(failures, ['Owned viewport closed before cleanup']); assert.equal(harness.reader['app'], undefined);
    assert.equal(harness.counts().panels, 1); assert.equal(harness.presentationPreferences.size, 0);
    assert.equal(harness.reader.presentationState().mode, 'study-workspace'); assert.equal(harness.reader.presentationState().layoutConfirmed, false);
  } finally { release(); live?.close(); await harness.close(); }
});

test('restoring replay keeps the live renderer attached without requesting a pane handoff', async context => {
  // Arrange
  const harness = await recordedReaderHarness(true); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let live: ReturnType<NonNullable<typeof harness.reader.presentation.createViewport>> | undefined;
  try {
    live = harness.reader.presentation.createViewport!('retained-live', () => {}, () => {}, 'normal');
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    await harness.reader.action('focus-app');
    const app = harness.reader['app'], bundle = harness.controller.bundle();
    let handoffs = 0;
    context.mock.method(live, 'holdPlacement', async () => { handoffs++; throw new Error('Replay restoration must retain its renderer.'); });
    const state = harness.reader.presentationState();
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'restore' });
    // Assert
    assert.equal(handoffs, 0); assert.equal(harness.reader['app'], app);
    assert.equal(harness.peakPanels(), 1); assert.equal(harness.presentationPreferences.size, 0);
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.equal(harness.controller.bundle(), bundle); assert.equal(harness.reader['viewport'], live);
  } finally { context.mock.restoreAll(); live?.close(); await harness.close(); }
});

for (const change of ['move', 'close'] as const) test(`a learner ${change} of the first replacement before the second registers prevents lease adoption`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  const failures: string[] = [];
  let live: ReturnType<NonNullable<typeof harness.reader.presentation.createViewport>> | undefined;
  try {
    await harness.reader.open(); live = harness.reader.presentation.createViewport!('interrupted-creation', () => {}, reason => failures.push(reason), 'normal');
    const app = harness.reader['app'], explanation = harness.reader['contextPanel'];
    const previousApp = harness.nativePanels().find(panel => panel.kind === 'codebook.scopedBrowser');
    harness.onNextPanel('codebook.studyContext', () => {
      const replacement = harness.nativePanels().find(panel => panel.kind === 'codebook.scopedBrowser' && panel !== previousApp); assert.ok(replacement);
      if (change === 'move') replacement.reveal(1, true);
      else replacement.dispose();
    });
    const state = harness.reader.presentationState();
    // Act
    await assert.rejects(harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'living-book', action: 'select' }), { code: 'PRESENTATION_UNAVAILABLE' });
    // Assert
    assert.equal(harness.reader['app'], app); assert.equal(harness.reader['contextPanel'], explanation);
    assert.equal(harness.viewportInstances[0]!.panel, app); assert.deepEqual(failures, []);
    assert.equal(harness.viewportEvents.some(event => event.startsWith('rebind:')), false);
    assert.equal(harness.counts().panels, 2); assert.equal(harness.presentationPreferences.size, 0);
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
  } finally { live?.close(); await harness.close(); }
});

test('explicit presentation focus returns from Wiki without changing layout, learning or execution', async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await openRetainedStudy(harness);
    const wiki = harness.openWiki(2), draft = harness.addForeignDraft(1);
    const state = harness.reader.presentationState(), layout = harness.editorLayout();
    const before = harness.reader.inspect(), commands = harness.commands.length;
    // Opening retained evidence can finish its durable selection after the view becomes ready.
    await waitUntil(async () => (await (await harness.reader.learningStorage()).readProgress()).selection?.studyId === before.view?.model.selection.studyId, 'retained selection persistence', 1_000);
    const progress = await (await harness.reader.learningStorage()).readProgress();
    // Act
    const result = await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: state.mode, action: 'focus' });
    // Assert
    assert.equal(harness.focusedPanel(), 'codebook.studyContext');
    assert.equal(harness.innerFocusedPanel(), 'codebook.studyContext');
    assert.equal(result.state, 'open');
    assert.equal(result.presentationControlRevision, state.presentationControlRevision + 1);
    assert.equal(result.mode, state.mode);
    assert.deepEqual(harness.editorLayout(), layout);
    assert.equal(harness.reader.inspect().sourceUri, before.sourceUri);
    assert.deepEqual(await (await harness.reader.learningStorage()).readProgress(), progress);
    assert.equal(harness.groups.some(group => group.tabs.includes(wiki.nativeTab)), true);
    assert.equal(harness.groups.some(group => group.tabs.includes(draft)), true);
    assert.equal(draft.isDirty, true);
    assert.equal(harness.commands.slice(commands).includes('workbench.action.maximizeEditorHideSidebar'), false);
    assert.equal(harness.runtimes.length, 0);
    assert.throws(() => harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: state.mode, action: 'focus' }), { code: 'STALE_PRESENTATION' });
  } finally { await harness.close(); }
});

for (const invalid of ['closed', 'different mode', 'unfocused window'] as const) test(`presentation focus rejects ${invalid} without revealing a pane`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    if (invalid !== 'closed') await openRetainedStudy(harness);
    if (invalid === 'unfocused window') harness.changeWindowFocus(false);
    const state = harness.reader.presentationState(), reveals = harness.panelReveals().length;
    // Act / Assert
    assert.throws(() => harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: invalid === 'different mode' ? 'living-book' : state.mode, action: 'focus' }), { code: 'PRESENTATION_UNAVAILABLE' });
    assert.equal(harness.panelReveals().length, reveals);
    assert.equal(harness.reader.presentationState().presentationControlRevision, state.presentationControlRevision);
    assert.equal(harness.runtimes.length, 0);
  } finally { harness.changeWindowFocus(true); await harness.close(); }
});

for (const departure of ['window roundtrip', 'learner draft'] as const) test(`presentation focus preserves newer intent after ${departure} during native handoff`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  let release = () => {};
  try {
    await openRetainedStudy(harness);
    const draft = harness.focusMutableDraft(); harness.openWiki(2);
    const state = harness.reader.presentationState(), listeners = harness.windowFocusListeners();
    const held = harness.holdPanelActivity('codebook.studyContext'); release = held.release;
    const focusing = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: state.mode, action: 'focus' });
    const rejected = assert.rejects(focusing, { code: 'PRESENTATION_UNAVAILABLE' });
    await held.started;
    const reveals = harness.panelReveals().length;
    // Act
    if (departure === 'window roundtrip') { harness.changeWindowFocus(false); harness.changeWindowFocus(true); }
    else draft.focus();
    held.release(); await rejected;
    // Assert
    assert.equal(harness.panelReveals().length, reveals);
    assert.equal(harness.reader.presentationState().state, 'open');
    assert.equal(harness.windowFocusListeners(), listeners);
    assert.equal(draft.document.getText(), 'Original learner draft.\n');
    if (departure === 'learner draft') assert.equal(harness.focusedSource()?.document.uri.toString(), draft.document.uri.toString());
    assert.equal(harness.runtimes.length, 0);
  } finally { release(); harness.changeWindowFocus(true); await harness.close(); }
});

test('ordinary chat can recover Study focus from Wiki through the public MCP presentation tool', async () => {
  // Arrange
  const harness = await workspaceHarness(); harness.useNativeLayout({ orientation: 0, groups: [{}] }); await harness.reader.open();
  const wiki = harness.openWiki(2);
  const endpoint = await startServer(harness.service);
  const transport = new StreamableHTTPClientTransport(new URL(endpoint.descriptor.url), { requestInit: { headers: { Authorization: `Bearer ${endpoint.descriptor.token}` } } });
  const client = new Client({ name: 'study-focus-recovery-test', version: '1.0' }); await client.connect(transport);
  try {
    const discovery = await client.callTool({ name: 'codebook_status', arguments: {} });
    const selected = z.object({ data: z.object({ instanceId: z.string(), presentation: z.object({ presentationId: z.string(), presentationControlRevision: z.number(), mode: z.string() }) }) }).parse(discovery.structuredContent).data;
    const input = { instanceId: selected.instanceId, presentationId: selected.presentation.presentationId, expectedRevision: selected.presentation.presentationControlRevision, mode: selected.presentation.mode, action: 'focus' };
    // Act
    const focused = await client.callTool({ name: 'codebook_presentation', arguments: input });
    const stale = await client.callTool({ name: 'codebook_presentation', arguments: input });
    // Assert
    assert.equal(focused.isError, undefined, JSON.stringify(focused.structuredContent));
    assert.equal(harness.focusedPanel(), 'codebook.studyContext');
    assert.equal(harness.innerFocusedPanel(), 'codebook.studyContext');
    assert.match(JSON.stringify(stale.structuredContent), /STALE_PRESENTATION/);
    assert.equal(harness.groups.some(group => group.tabs.includes(wiki.nativeTab)), true);
    assert.equal(harness.runtimes.length, 0);
    assert.equal(harness.service.records.size, 0);
  } finally { await client.close(); await endpoint.close(); await harness.close(); }
});

for (const dirty of [false, true]) test(`same-layout selection repairs proportions while preserving an ${dirty ? 'unsaved' : 'unchanged'} source preview`, async () => {
  // Arrange
  const harness = await workspaceHarness(false); harness.useNativeLayout({ orientation: 0, groups: [{}] });
  try {
    await harness.reader.open();
    await harness.reader.action('focus-context');
    const panels = [...harness.nativePanels()];
    const preview = harness.addTextPreview(join(harness.directory, 'learner-source.ts'), 2, dirty);
    harness.changeEditorLayout({ orientation: 0, groups: [{ size: 0.5, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.5 }] });
    const state = harness.reader.presentationState();
    // Act
    await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'select' });
    // Assert
    assert.equal(harness.reader.presentationState().layoutConfirmed, true);
    assert.deepEqual(harness.nativePanels(), panels);
    assert.ok(harness.groups.find(group => group.viewColumn === 2)?.tabs.includes(preview));
    assert.equal(preview.isPreview, true);
    assert.equal(preview.isDirty, dirty);
    assert.equal(harness.commands.includes('workbench.action.keepEditor'), false);
  } finally { await harness.close(); }
});


test('saving without a captured session leaves the learning status hidden', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    // Act / Assert
    await assert.rejects(harness.reader.saveLearningReplay(), /No recorded Codebook session/);
    assert.equal(harness.saveStatus.visible, false);
  } finally { await harness.close(); }
});

test('explicit learning save verifies durable context and labels missing summary and debugger history as partial', async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  try {
    const library = await harness.reader.learningStorage(), progress = await library.readProgress();
    // Act
    await harness.reader.saveLearningReplay(harness.studyId);
    // Assert
    await harness.store.readContext(harness.studyId);
    assert.equal(harness.saveStatus.text, '$(warning) Learning partially saved · Open replay');
    assert.match(harness.saveStatus.tooltip, /learning summary and sequence/);
    assert.match(harness.saveStatus.tooltip, /recorded debugger history/);
    assert.deepEqual(structuredClone(harness.saveStatus.command), { title: 'Open learning replay', command: 'codebook.openLearningReplay', arguments: [harness.studyId] });
    assert.deepEqual(await library.readProgress(), progress);
  } finally { await harness.close(); }
});

test('a stale save button cannot finalize a different recorded session', async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  try {
    const receipt = harness.record.historyReceipt;
    // Act / Assert
    await assert.rejects(harness.reader.saveLearningReplay('another-session'), /recorded session changed/);
    assert.equal(harness.record.historyReceipt, receipt);
  } finally { await harness.close(); }
});

test('failed explicit learning context save stays retryable without replacing durable history with success', async context => {
  // Arrange
  const harness = await recordedReaderHarness();
  try {
    const failure = context.mock.method(RecordingStore.prototype, 'saveContext', async () => { throw new Error('Disk unavailable'); });
    // Act
    await assert.rejects(harness.reader.saveLearningReplay(harness.studyId), /Disk unavailable/);
    // Assert
    assert.equal(harness.saveStatus.text, '$(error) Learning save failed · Retry');
    assert.deepEqual(structuredClone(harness.saveStatus.command), { title: 'Save learning replay', command: 'codebook.saveLearningReplay', arguments: [harness.studyId] });
    failure.mock.restore();
    await harness.reader.saveLearningReplay(harness.studyId);
    await harness.store.readContext(harness.studyId);
    assert.equal(harness.saveStatus.text, '$(warning) Learning partially saved · Open replay');
  } finally { await harness.close(); }
});


test('repeated save clicks share finalization and keep the pending status non-actionable', async context => {
  // Arrange
  const harness = await recordedReaderHarness();
  let release!: () => void, entered!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const original = harness.service.stop.bind(harness.service);
  let stops = 0;
  context.mock.method(harness.service, 'stop', async (input: Parameters<typeof harness.service.stop>[0]) => { stops++; entered(); await hold; return original(input); });
  try {
    // Act
    const first = harness.reader.saveLearningReplay(harness.studyId);
    await started;
    const second = harness.reader.saveLearningReplay(harness.studyId);
    // Assert
    assert.equal(harness.saveStatus.text, '$(sync~spin) Saving learning…');
    assert.equal(harness.saveStatus.command, undefined);
    assert.equal(stops, 1);
    release(); await Promise.all([first, second]);
    assert.equal(stops, 1);
    assert.equal(harness.saveStatus.text, '$(warning) Learning partially saved · Open replay');
  } finally { release(); await harness.close(); }
});


test('saving an active explanation stops only its owned capture and retains the recorded learning', async () => {
  // Arrange
  const harness = await workspaceHarness(true, true);
  try {
    harness.acknowledgeContext();
    harness.service.environment.build.sourceHash = sha256('active-save-build');
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: 'save-active' });
    const record = [...harness.service.records.values()][0]!; await record.preparation;
    harness.clock(100); await harness.reader.action('click');
    assert.equal(record.stopped, false);
    assert.match(harness.saveStatus.text, /Recording explanation/);
    // Act
    await harness.reader.saveLearningReplay(`${harness.service.instanceId}_${record.id}`);
    // Assert
    assert.equal(record.stopped, true);
    assert.equal(record.historyReceipt?.status, 'saved');
    assert.equal(record.recordingReceipt?.status, 'saved');
    assert.equal(harness.saveStatus.text, '$(warning) Learning partially saved · Open replay');
  } finally { await harness.close(); }
});

test('a later explanation invalidates the earlier save label until its new content is explicitly saved', async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  try {
    await harness.reader.saveLearningReplay(harness.studyId);
    const snapshotUri = harness.service.state(harness.record).participants.browser.snapshotUri!;
    const archive = await (await harness.reader.learningStorage()).readCheckpoint(harness.studyId);
    // Act
    await harness.service.explain({ instanceId: harness.service.instanceId, runId: harness.record.id, key: 'later-explanation', snapshotUri,
      sourceHash: archive.study.observations[0]!.source.hash, valuePaths: ['value:nextTheme'], interpretation: 'The recorded selected theme is dark; no additional execution is claimed.' });
    harness.reader['publish']();
    // Assert
    assert.equal(harness.saveStatus.text, '$(save) Recording finished · Save learning replay');
  } finally { await harness.close(); }
});


test('editor Settings changes recover full study and recording storage without recreating the workspace', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    harness.setSavedStudyCapacity(1);
    const library = await harness.reader.learningStorage(), recordings = harness.service.recordings!;
    const study = createConfiguredStudy(); study.workspaceKey = library.workspaceKey;
    const binding = { workspaceKey: library.workspaceKey, studyId: study.id, instanceId: study.instanceId, runId: study.runId, runtimeId: randomUUID(), profile: study.profile, sourceBuild: { revision: 'settings-test', dirty: false, sourceHash: '1'.repeat(64) } };
    await library.saveStudy(study); await (await recordings.start(binding, 0)).finish(1);
    const next = structuredClone(study), runId = randomUUID();
    for (const observation of next.observations) observation.snapshotUri = observation.snapshotUri.replace(next.runId, runId);
    next.runId = runId; next.id = `${next.instanceId}_${runId}`;
    const nextBinding = { ...binding, runId, studyId: next.id, runtimeId: randomUUID() };
    await assert.rejects(library.saveStudy(next), /full/);
    await assert.rejects(recordings.start(nextBinding, 0), /full/);
    // Act
    harness.setSavedStudyCapacity(2);
    await library.saveStudy(next); await (await recordings.start(nextBinding, 0)).finish(1);
    // Assert
    assert.equal((await library.list()).length, 2);
    assert.equal((await recordings.list()).length, 2);
    assert.equal((await harness.service.status()).recording?.capacity.limit, 2);
    harness.setSavedStudyCapacity('invalid');
    assert.match((await harness.service.status()).recording?.capacity.error ?? '', /codebook.savedStudyLimit/);
    assert.equal((await recordings.list()).length, 2);
  } finally { await harness.close(); }
});

for (const separateChat of [false, true]) test(`live explanation reserves app and source without a custom explanation pane${separateChat ? ' while preserving a separate chat' : ''}`, async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
    const chat = separateChat ? harness.addSeparateEditorPart() : undefined;
    const chatLayout = chat?.layout();
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() });
    const record = [...harness.service.records.values()][0]!;
    await record.preparation;
    // Act
    await harness.reader.open();
    // Assert
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.panelColumn('codebook.scopedBrowser'), 1);
    assert.equal(harness.reader.inspect().presentation.panes.sourceColumn, 2);
    assert.equal(harness.reader.inspect().presentation.layoutConfirmed, true);
    assert.equal(harness.nativePanels().length, 1);
    assert.equal(harness.groups.length, separateChat ? 3 : 2);
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] });
    assert.deepEqual(chat?.layout(), chatLayout);
    assert.equal(harness.runtimes[0]!.dispatches, 0);
  } finally { await harness.close(); }
});

test('live Restore refuses a late native receipt loss instead of claiming recovery', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
    const chat = harness.addSeparateEditorPart();
    const chatLayout = chat.layout();
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() });
    await [...harness.service.records.values()][0]!.preparation;
    await harness.reader.open();
    harness.reader['layoutReceipt'] = undefined;
    harness.reader['presentationConfirmed'] = false;
    const arrange = harness.reader['arrange'].bind(harness.reader);
    harness.reader['arrange'] = async (...args) => {
      await arrange(...args);
      harness.reader['layoutReceipt'] = undefined;
    };
    chat.focus();
    const current = harness.reader.presentationState();
    // Act
    await assert.rejects(harness.reader.changePresentation({ presentationId: current.presentationId, expectedRevision: current.presentationControlRevision, mode: 'study-workspace', action: 'restore' }),
      { code: 'PRESENTATION_UNAVAILABLE', causeDetail: /native editor layout receipt/ });
    // Assert
    assert.deepEqual(chat.layout(), chatLayout);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.runtimes[0]!.dispatches, 0);
  } finally { await harness.close(); }
});

test('starting live explanation retires only its previous empty explanation group', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
    const chat = harness.addSeparateEditorPart();
    await harness.reader.open();
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() });
    await [...harness.service.records.values()][0]!.preparation;
    // Act
    await harness.reader.open();
    // Assert
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.groups.length, 3);
    assert.equal(harness.groups.at(-1)!.tabs[0], chat.tab);
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] });
    assert.equal(harness.reader.inspect().presentation.layoutConfirmed, true);
  } finally { await harness.close(); }
});

test('a normal chat run retires the explanation pane without reopening the reader', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
    const chat = harness.addSeparateEditorPart();
    await harness.reader.open();
    assert.equal(harness.panelColumn('codebook.studyContext'), 3);
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() });
    await [...harness.service.records.values()][0]!.preparation;
    // Act: the ordinary chat starts execution without requesting another Open.
    await harness.reader.action('click');
    // Assert
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.groups.length, 3);
    assert.equal(harness.groups.at(-1)!.tabs[0], chat.tab);
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] });
    assert.equal(harness.reader.inspect().presentation.layoutConfirmed, true);
  } finally { await harness.close(); }
});

test('saved replay restores its summary after a native-chat-only live explanation', async () => {
  // Arrange
  const harness = await workspaceHarness(true, true);
  try {
    harness.service.environment.build.sourceHash = sha256('live-composition-build');
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
    harness.acknowledgeContext();
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() });
    const record = [...harness.service.records.values()][0]!;
    await record.preparation;
    await harness.reader.open();
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=', 'base64');
    record.recording!.frame({ bytes: png, elapsedMs: 20, kind: 'stream' });
    harness.clock(100); await harness.reader.action('click');
    harness.clock(200); await harness.reader.action('stop');
    // Act
    await harness.reader.openRecording(record.recording!.header.studyId);
    await harness.service.playbackController!.settle();
    // Assert
    assert.equal(harness.service.playbackController!.state().readiness, 'ready');
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.reader.inspect().view!.contentTab, 'recording');
    assert.equal(harness.nativePanels().length, 1);
    assert.equal(harness.summary.visible, true);
    assert.deepEqual(harness.editorLayout(), { orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] });
    const playback = harness.service.playbackController!;
    harness.hideSummary();
    playback.command({ action: 'seek', studyId: record.recording!.header.studyId, expectedRevision: playback.state().revision, positionMs: 100 });
    await playback.settle();
    assert.equal(playback.state().readiness, 'ready');
    const revision = playback.state().revision, position = playback.state().presentedMs;
    await harness.reader.showLearningSummary();
    assert.equal(harness.summary.visible, true);
    assert.equal(playback.state().revision, revision);
    assert.equal(playback.state().presentedMs, position);
    assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { await harness.close(); }
});

test('live entry preserves a learner document sharing the former explanation group', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
    await harness.reader.open();
    const draft = harness.focusMutableDraft('my-notes.txt', 3);
    draft.replaceContent('Keep my unsaved notes.');
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() });
    await [...harness.service.records.values()][0]!.preparation;
    // Act
    await harness.reader.open();
    // Assert
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.equal(harness.groups.length, 3);
    assert.equal(harness.groups[2]!.tabs.includes(draft.tab), true);
    assert.equal(draft.document.getText(), 'Keep my unsaved notes.');
    assert.equal(draft.tab.isDirty, true);
    assert.equal(harness.reader.inspect().presentation.layoutConfirmed, false);
    assert.ok(harness.reader.inspect().view!.errors.some(error => error.includes('Existing editor groups were preserved')));
  } finally { await harness.close(); }
});

for (const departure of ['draft', 'window round trip'] as const) test(`replay Restore preserves newer ${departure} intent during native unmaximize`, async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  let release = () => {};
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    await harness.reader.action('read-source');
    const state = harness.reader.presentationState(), playback = harness.controller.state();
    const layouts = harness.commands.filter(command => command === 'vscode.setEditorLayout').length;
    const held = harness.holdNextCommand('workbench.action.minimizeOtherEditors'); release = held.release;
    const restoring = harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'restore' });
    const rejected = assert.rejects(restoring, /learner changed native tab focus/);
    await held.started;
    // Act
    const draft = departure === 'draft' ? harness.focusMutableDraft() : undefined;
    if (departure === 'window round trip') { harness.changeWindowFocus(false); harness.changeWindowFocus(true); }
    held.release(); await rejected;
    // Assert
    assert.equal(harness.commands.filter(command => command === 'vscode.setEditorLayout').length, layouts);
    assert.equal(harness.reader.presentationState().layoutConfirmed, false);
    assert.deepEqual(harness.controller.state(), playback);
    if (draft) { assert.equal(harness.focusedSource()?.document.uri.toString(), draft.document.uri.toString()); assert.equal(draft.document.getText(), 'Original learner draft.\n'); }
  } finally { release(); harness.changeWindowFocus(true); await harness.close(); }
});

test('reading the replay summary leaves an unfocused work window and historical position untouched', async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    harness.hideSummary(); harness.changeWindowFocus(false);
    const commands = harness.commands.length, playback = harness.controller.state();
    // Act / Assert
    await assert.rejects(harness.reader.action('read-context'), /Focus the Codebook work window/);
    assert.equal(harness.commands.length, commands);
    assert.equal(harness.summary.visible, false);
    assert.deepEqual(harness.controller.state(), playback);
  } finally { harness.changeWindowFocus(true); await harness.close(); }
});

test('a window round trip during summary opening cannot confirm an obsolete focus request', async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  let release = () => {};
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    const playback = harness.controller.state(), subscriptions = harness.windowFocusListeners();
    const held = harness.holdNextCommand('codebook.learningSummary.focus'); release = held.release;
    const opening = harness.reader.showLearningSummary(), rejected = assert.rejects(opening, /work window lost focus/);
    await held.started;
    // Act
    harness.changeWindowFocus(false); harness.changeWindowFocus(true); held.release();
    await rejected;
    // Assert
    assert.deepEqual(harness.controller.state(), playback);
    assert.equal(harness.windowFocusListeners(), subscriptions);
  } finally { release(); harness.changeWindowFocus(true); await harness.close(); }
});

test('closing replay rejects late summary controls and leaves saved learning unchanged', async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    assert.equal(harness.controller.state().readiness, 'ready');
    await harness.reader.close();
    const before = harness.reader.inspect(), playback = harness.controller.state(), preference = await harness.store.readPreference();
    const library = await harness.reader.learningStorage(), progress = await library.readProgress();

    // Act: a queued renderer message cannot renew a closed reader, even with its latest revision.
    harness.receive({ type: 'tab', tab: 'overview', revision: before.view!.revision });
    await new Promise<void>(resolve => setImmediate(resolve));

    // Assert
    assert.equal(harness.reader.inspect().opened, false);
    assert.equal(harness.controller.state().mode, 'paused');
    assert.equal(harness.controller.state().cleared, true);
    assert.deepEqual(harness.controller.state(), playback);
    assert.deepEqual(harness.reader.inspect().view, before.view);
    assert.deepEqual(await harness.store.readPreference(), preference);
    assert.deepEqual(await library.readProgress(), progress);
    assert.match(harness.summary.webview.html, /Open saved learning/);
    assert.equal(harness.runtimes[0]!.dispatches, 1);
  } finally { await harness.close(); }
});

test('restoring the live layout cannot recreate a custom explanation pane or select a retired variant', async () => {
  // Arrange
  const harness = await workspaceHarness();
  try {
    harness.useNativeLayout({ orientation: 0, groups: [{ size: 980 }] });
    harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() });
    await [...harness.service.records.values()][0]!.preparation;
    await harness.reader.open();
    const state = harness.reader.presentationState();
    // Act
    const restored = await harness.reader.changePresentation({ presentationId: state.presentationId, expectedRevision: state.presentationControlRevision, mode: 'study-workspace', action: 'restore' });
    // Assert
    assert.equal(restored.state, 'open');
    assert.equal(restored.layoutConfirmed, true);
    assert.equal(harness.panelColumn('codebook.studyContext'), undefined);
    assert.throws(() => harness.reader.changePresentation({ presentationId: restored.presentationId, expectedRevision: restored.presentationControlRevision, mode: 'living-book', action: 'select' }), /one app\/source layout/);
    assert.equal(harness.groups.length, 2);
  } finally { await harness.close(); }
});


test('bottom playback remains available with the summary collapsed and restores fallback when hidden', async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    const original = harness.controller.state();
    // Act
    harness.hideSummary();
    // Assert
    assert.equal(harness.playbackPanel.visible, true);
    assert.equal(harness.playbackPanelMessages.at(-1)?.playbackPanelVisible, true);
    assert.deepEqual(harness.controller.state(), original);
    // Act: the still-visible panel remains the only playback controller while summary is hidden.
    const view = harness.playbackPanelMessages.at(-1)!;
    harness.receivePlaybackPanel({ type: 'playback', action: 'seek', positionMs: 150, revision: view.revision, expectedRevision: original.revision });
    await new Promise(resolve => setImmediate(resolve)); await harness.controller.settle();
    assert.equal(harness.controller.state().presentedMs, 150);
    const moved = harness.controller.state();
    // Act
    harness.hidePlaybackPanel();
    // Assert
    assert.equal(harness.playbackPanelMessages.at(-1)?.playbackPanelVisible, false);
    assert.deepEqual(harness.controller.state(), moved);
  } finally { await harness.close(); }
});

test('disposed bottom playback documents cannot move the selected recorded moment', async () => {
  // Arrange
  const harness = await recordedReaderHarness();
  try {
    await harness.reader.openRecording(harness.studyId); await harness.controller.settle();
    const playback = harness.controller.state(), view = harness.playbackPanelMessages.at(-1)!;
    harness.disposePlaybackPanel();
    // Act
    harness.receivePlaybackPanel({ type: 'playback', action: 'seek', positionMs: 150, revision: view.revision, expectedRevision: playback.revision });
    await harness.controller.settle();
    // Assert
    assert.deepEqual(harness.controller.state(), playback);
  } finally { await harness.close(); }
});

test('inspecting a Node stop whose captured source differs from its recorded position refuses native debugging', async () => {
  // Arrange: a sealed one-stop history whose debugger snapshot carries another source text.
  const harness = await workspaceHarness();
  try {
    const store = harness.service.nodeHistoryStore!;
    const history = nodeTestHistoryHeader(store.workspaceKey), unrelatedText = 'const nextTheme = "light";\n';
    const writer = await store.start(history);
    await writer.appendOutput({ sequence: 1, elapsedMs: 100, channel: 'stdout', text: 'RUN src/theme.test.ts\n' });
    await writer.appendStop({ index: 0, runId: 'test-run', sessionId: 'test-session', threadId: 1, elapsedMs: 200,
      worker: { pid: 1, processGroup: 1, workspace: '/private/test' }, source: history.configuration.source,
      frame: { id: 1, name: 'notifyManager', line: 1, column: 1 }, variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
      facts: [{ path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' }],
      debuggerSnapshot: { version: 1, frames: [{ name: 'notifyManager', line: 1, column: 1,
        source: { name: history.configuration.source.path, text: unrelatedText, hash: sha256(unrelatedText), line: 1 }, scopes: [{ name: 'Local', variables: [0] }] }],
      variables: [{ name: 'nextTheme', value: 'dark', type: 'string', children: [] }], limitations: [] } } satisfies NodeTestSourceStop);
    await writer.appendResult({ exitCode: 0, signal: null, output: 'Tests 1 passed' }, 300);
    await writer.finish('complete');
    await harness.reader.open();
    harness.receiveContext({ type: 'node-history', revision: harness.postedMessages().slice(-1)[0]!.revision, studyId: history.studyId });
    await waitUntil(() => harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence === 1 && !harness.postedMessages().slice(-1)[0]?.loading,
      'the sealed Node history is loaded', 1_000);

    // Act
    harness.receiveContext({ type: 'node-history-stop', revision: harness.postedMessages().slice(-1)[0]!.revision, studyId: history.studyId, sequence: 2 });
    await waitUntil(() => harness.reader.inspect().view?.errors.some(error => /no matching verified captured source/.test(error)),
      'the refused native stop is reported to the reader', 1_000);

    // Assert
    assert.equal(harness.historicalDebugPresentations.length, 0);
    assert.equal(harness.postedMessages().slice(-1)[0]?.nodeHistoryPosition?.sequence, 1);
  } finally { await harness.close(); }
});

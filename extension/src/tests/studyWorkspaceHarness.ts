// Shared editor fakes stay process-local; workspace test files run in isolated Node workers.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { waitUntil } from '../runtimeSupport/utils/waitUntil';
import { sha256 } from '../runtimeSupport/utils/sha256';
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
import type { ReplayInspection } from '../replayDebugger';
import { createConfiguredStudy } from './utils/createConfiguredStudy';
import { ControlledConfiguredRuntime } from './utils/configuredServiceHarness';
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture';
import type { NodeTestSourceStop } from '../ownedNodeTestRun';

/** Keeps native presentation inert while exercising actual checkpoints, source watching and durable decisions. @example const reader = await workspaceHarness() */
export async function workspaceHarness(attach = true, deterministicClock = false) {
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
  let historicalDebugInspection: ReplayInspection = 'inspected';
  let nextHistoricalDebugPresentation: { wait: Promise<void>; entered(): void } | undefined;
  class TestReplayDebugger {
    available = true;
    /** Registers the fake owner so {@link loadHistoricalDebugValues} can notify the workspace, as the real adapter's inspection callback does. @example new TestReplayDebugger(vscode, () => workspace.replayDebuggerChanged()) */
    constructor(_editor: unknown, readonly changed: () => void = () => {}) { historicalDebuggers.push(this); }
    async present(snapshot: ReplayDebugSnapshot | undefined, label: string, signal: AbortSignal, sourceDocument?: { uri: string; hash: string }): Promise<ReplayInspection> {
      signal.throwIfAborted();
      // Mirrors the real owner: a learner-stopped session never silently relaunches.
      if (!this.available) throw new Error('Historical debugger closed. Reopen the learning replay to restore it.');
      historicalDebugPresentations.push({ snapshot, label, sourceDocument });
      // A held presentation models native Run and Debug still loading the recorded values.
      const held = nextHistoricalDebugPresentation; nextHistoricalDebugPresentation = undefined;
      if (held) { held.entered(); await held.wait; }
      return historicalDebugInspection;
    }
    /** Mirrors the real owner's cancellable retirement of a different recorded stop; no native session exists here. @example await debuggerView.retire(snapshot, signal) */
    async retire(_snapshot: ReplayDebugSnapshot | undefined, signal: AbortSignal) { signal.throwIfAborted(); }
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
    /** Sets whether later historical presentations report native Run and Debug values as loaded. @example harness.setHistoricalDebugInspection('uninspected') */
    setHistoricalDebugInspection(value: ReplayInspection) { historicalDebugInspection = value; },
    /** Models the learner expanding Variables: later presentations load values and each owner notifies the workspace once, without a new seek. @example harness.loadHistoricalDebugValues() */
    loadHistoricalDebugValues() { historicalDebugInspection = 'inspected'; for (const debuggerView of historicalDebuggers) debuggerView.changed(); },
    /** Keeps the next historical presentation loading until released or rejected, as native Run and Debug does before values load. @example const held = harness.holdHistoricalDebugPresentation(); await held.started; held.reject(new Error('superseded')) */
    holdHistoricalDebugPresentation() {
      let release = () => {}, reject = (_error: Error) => {}, entered = () => {};
      const started = new Promise<void>(resolve => { entered = resolve; });
      const wait = new Promise<void>((resolve, rejectPromise) => { release = resolve; reject = rejectPromise; });
      nextHistoricalDebugPresentation = { wait, entered }; return { started, release, reject };
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
export async function openRetainedStudy(harness: Awaited<ReturnType<typeof workspaceHarness>>) {
  const library = await harness.reader.learningStorage();
  const study = { ...createConfiguredStudy(), workspaceKey: library.workspaceKey };
  await library.saveStudy(study); await harness.reader.open();
  harness.receive({ type: 'history', revision: harness.reader.inspect().view!.revision, studyId: study.id });
  await waitUntil(() => harness.reader.inspect().view!.model.selection.studyId === study.id && !harness.reader.inspect().view!.loading, 'retained repository source', 1_000);
}

/** Saves one sealed Node history with output, one verified stop and a passing result for historical debugger recovery tests. @example const history = await saveOneStopNodeHistory(store) */
export async function saveOneStopNodeHistory(store: NodeTestHistoryStore) {
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

/**
 * Creates sealed recording/context before workspace replay/navigation tests open history; runtime values and native paint are synthetic.
 * @param capturedApplication - Also retain a real paused-browser PNG checkpoint.
 * @param recordedDebugger - Attach captured native debugger state to the recorded stop, paused from 100 ms until its 900 ms continuation (recording ends at 1,000 ms), so replay presents it through the historical debugger.
 * @example const harness = await recordedReaderHarness(true, true)
 */
export async function recordedReaderHarness(capturedApplication = false, recordedDebugger = false) {
  const harness = await workspaceHarness(true, true), service = harness.service;
  service.environment.build.sourceHash = sha256('recorded-build'); harness.acknowledgeContext();
  harness.service.start({ instanceId: harness.service.instanceId, profile: 'repository-browser', configuration: harness.configuration, key: randomUUID() }); const record = [...service.records.values()][0]!; await record.preparation;
  if (recordedDebugger) {
    const runtime = harness.runtimes[0]!, action = runtime.action.bind(runtime);
    runtime.action = (key, value) => {
      const operation = action(key, value), stop = runtime.snapshots[0]!;
      // Captured values reference the stop's own recorded source, as the configured browser run records them.
      stop.debugger = { version: 1, frames: [{ name: 'applyTheme', line: 1, column: 1, source: { name: runtime.definition.configuration.source.path, text: stop.source.text, hash: stop.source.hash, line: 1 }, scopes: [{ name: 'Local', variables: [0] }] }],
        variables: [{ name: 'nextTheme', value: 'dark', children: [] }], limitations: [] };
      return operation;
    };
  }
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=', 'base64');
  assert.ok(record.recording); record.recording.frame({ bytes: png, elapsedMs: 20, kind: 'stream' });
  // Observation visibility tests retain a real PNG checkpoint while the native renderer remains mocked.
  if (capturedApplication) {
    const runtime = harness.runtimes[0]!, view = runtime.view.bind(runtime);
    await writeFile(join(runtime.evidence.directory, 'paused-browser.png'), png);
    runtime.view = () => ({ ...view(), captures: { 'paused-browser': { status: 'captured', file: 'paused-browser.png', renderer: { epoch: 'test', id: 1, hash: sha256(png) } } } });
  }
  harness.clock(100); await harness.reader.action('click');
  // The continuation receipt seals the recorded stop's paused interval, long enough for several Play ticks to advance through it.
  if (recordedDebugger) { harness.clock(900); harness.runtimes[0]!.evidence.record('continue.accepted'); }
  harness.clock(recordedDebugger ? 1_000 : 200); await harness.reader.action('stop');
  const studyId = record.recording.header.studyId, directory = harness.reader.inspect().libraryDirectory!;
  const store = new RecordingStore(directory, directory.split('/').at(-1)!);
  return { ...harness, studyId, store, record, png, controller: service.playbackController! };
}

/** Connects real Git/book/history/reader code before configured-runtime workspace tests exercise live/replay entry; native paint remains mocked. @example const harness = await configuredWorkspaceHarness() */
export async function configuredWorkspaceHarness(sourceText?: string) {
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

/** Starts each actual-Return regression from a saved recording and the learner's native two-row article layout. @example await articleRecordingLayoutHarness() */
export async function articleRecordingLayoutHarness(capturedApplication = false) {
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

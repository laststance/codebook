// Shared editor fakes stay process-local; workspace test files run in isolated Node workers.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import type { ReaderErrorKind } from '../constants'
import type { RepositorySelection } from '../learnerSchemas'
import type { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import type { NodeTestSourceStop } from '../ownedNodeTestRun'
import type { PlaybackController } from '../playbackController'
import type {
  PresentationPoseCapture,
  PresentationPoseRestore,
} from '../presentationSchemas'
import { RecordingStore } from '../recordingStore'
import type { ReplayInspection, ReplayRetrievalStage } from '../replayDebugger'
import type { ReplayDebugSnapshot } from '../replayDebugSchemas'
import { RepositoryBookStore } from '../repositoryBook'
import type * as RepositoryReaderModule from '../repositoryReader'
import type { BookObservationBinding } from '../repositorySchemas'
import { RepositorySourceService } from '../repositorySource'
import type { ConfiguredRuntimeView } from '../runtime'
import { VIEWPORT_ACK_TIMEOUT_REASON } from '../runtimeSupport/constants'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type * as StudyWorkspaceModule from '../studyWorkspace'
import type { StudyViewMessage } from '../ui/studyHtml'
import { bookObservationHash } from '../utils/bookObservationHash'
import type { OpenRequestSettled } from '../utils/readOpenRequest'

import { ControlledRuntime, createHarness } from './helpers'
import { ControlledConfiguredRuntime } from './utils/configuredServiceHarness'
import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { loadModule } from './utils/loadModule'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

/** How long the fake host's Variables view defers the refresh that loads a stop it missed while hidden, counted from the moment it is shown again; VS Code 1.140 waits 400 ms. */
const NATIVE_VARIABLES_REFRESH_MS = 400
/** How long the fake host's Variables view, opened for the first time in the editor session, needs before its tree holds the rows that list commands act on; VS Code 1.140 took about 60 ms. */
const NATIVE_VARIABLES_FIRST_RENDER_MS = 60
/**
 * How the fake host's Variables view missed the presented stop, as observed in VS Code 1.140:
 * - `'never-opened'`: Run and Debug was not opened in this editor session; the view asks for the stop's scopes as soon as it is shown, fills its tree a moment later and expands nothing by itself
 * - `'missed-the-stop'`: the view showed an earlier stop and was hidden while the recording moved on; its tree is empty until a deferred refresh loads the stop and expands the first scope by itself
 * - `'shows-another-session'`: the view keeps another debug session's frame and never asks for the recorded stop
 */
type NativeVariablesHiding =
  'never-opened' | 'missed-the-stop' | 'shows-another-session'

/** Keeps native presentation inert while exercising actual checkpoints, source watching and durable decisions. @example const reader = await workspaceHarness() */
export async function workspaceHarness(
  attach = true,
  deterministicClock = false,
) {
  let clock = 0
  let savedStudyCapacity: unknown
  const warningDialogs: {
    title: string
    options: unknown
    items: string[]
  }[] = []
  let answerWarningDialog: (
    items: string[],
  ) => Promise<string | undefined> = async () => undefined
  const informationMessages: { message: string; items: string[] }[] = []
  let answerInformationMessage: (
    items: string[],
  ) => Promise<string | undefined> = async () => undefined
  let hostAppName = 'Visual Studio Code'
  /** Native commands the fake editor answers `getCommands` with: the ones the reader asks the host about before it runs them. */
  const nativeHostCommands = [
    'workbench.debug.action.focusVariablesView',
    'list.focusFirst',
    'list.expand',
    'workbench.view.debug',
  ]
  /** Commands this host does not register; see `removeHostCommands`. */
  const absentHostCommands = new Set<string>()
  /** The commands the reader runs to give an editor group the keyboard focus; each activates its group, which brings a hidden editor area back. */
  const focusGroupCommands = [
    'workbench.action.focusFirstEditorGroup',
    'workbench.action.focusActiveEditorGroup',
  ]
  /** The editor's commands that give its second to eighth group the keyboard focus, in that order. */
  const focusGroupAtColumnCommands = [
    'workbench.action.focusSecondEditorGroup',
    'workbench.action.focusThirdEditorGroup',
    'workbench.action.focusFourthEditorGroup',
    'workbench.action.focusFifthEditorGroup',
    'workbench.action.focusSixthEditorGroup',
    'workbench.action.focusSeventhEditorGroup',
    'workbench.action.focusEighthEditorGroup',
  ]
  /** The fake host's own Variables view for the presented stop, which the native commands of Show Variables act on; a view no test hides already lists the values. See `hideNativeVariables`. */
  const nativeVariables: {
    hiding?: NativeVariablesHiding
    scopesRetrieved: boolean
    treeHoldsStop: boolean
    firstScopeFocused: boolean
    valuesListed: boolean
  } = {
    scopesRetrieved: true,
    treeHoldsStop: true,
    firstScopeFocused: false,
    valuesListed: true,
  }
  /** Pending `awaitRetrieval` checks of the fake historical debugger, re-run whenever the fake Variables view asks for scopes or lists values. */
  const nativeVariablesWaiters = new Set<() => void>()
  const trashMoves: { path: string; options: unknown }[] = []
  let rejectsTrashMove: (path: string) => boolean = () => false
  let beforeTrashMove: (path: string) => Promise<void> = async () => {}
  let heldTrashMove: { wait: Promise<void>; entered(): void } | undefined
  const harness = await createHarness({
    create: async (directory, profile) => {
      const runtime = new ControlledRuntime(directory, profile)
      if (deterministicClock) runtime.evidence.elapsedMs = () => clock
      return runtime
    },
  })
  const saveStatus = {
    name: '',
    text: '',
    tooltip: '',
    command: undefined as unknown,
    visible: false,
    show(): void {
      this.visible = true
    },
    hide(): void {
      this.visible = false
    },
    dispose(): void {
      this.visible = false
    },
  }
  let changed = (): void => {}
  const disposable = () => ({ dispose(): void {} })
  let outlineUpdates = 0
  class EventEmitter {
    event = () => disposable()
    fire(): void {
      outlineUpdates++
    }
    dispose(): void {}
  }
  class Uri {
    readonly fsPath: string
    constructor(
      readonly scheme: string,
      readonly authority: string,
      readonly path: string,
      readonly query = '',
      readonly fragment = '',
    ) {
      this.fsPath = path
    }
    static from(value: { scheme: string; authority: string; path: string }) {
      return new Uri(value.scheme, value.authority, value.path)
    }
    static file(path: string) {
      return new Uri('file', '', path)
    }
    toString() {
      return `${this.scheme}://${this.authority}${this.path}`
    }
  }
  class TabInputText {
    constructor(readonly uri: Uri) {}
  }
  class RelativePattern {
    constructor(
      readonly base: string,
      readonly pattern: string,
    ) {}
  }
  const watchedPatterns: RelativePattern[] = []
  const textDocuments: { uri: Uri; getText(): string }[] = []
  class TabInputWebview {
    constructor(readonly viewType: string) {}
  }
  class TabInputUnknown {}
  /** Supplies native position operations to the editor boundary fake used by workspace tests. @example new Position(22, 0).with(40, 0) */
  class Position {
    constructor(
      readonly line: number,
      readonly character: number,
    ) {}
    with(line = this.line, character = this.character) {
      return new Position(line, character)
    }
    isEqual(other: Position) {
      return this.line === other.line && this.character === other.character
    }
  }
  /** Supplies native range membership/retention to workspace presentation tests. @example range.contains(new Position(22, 0)) */
  class Range {
    constructor(
      readonly start: Position,
      readonly end: Position,
    ) {}
    contains(value: Position | Range): boolean {
      return value instanceof Range
        ? this.contains(value.start) && this.contains(value.end)
        : value.line >= this.start.line && value.line <= this.end.line
    }
    with(start = this.start, end = this.end) {
      return new Range(start, end)
    }
  }
  type Tab = {
    input: TabInputText | TabInputWebview | TabInputUnknown
    label?: string
    isPreview?: boolean
    isDirty?: boolean
    isPinned?: boolean
  }
  const groups: { viewColumn: number; tabs: Tab[]; activeTab?: Tab }[] = [
    { viewColumn: 2, tabs: [] },
  ]
  let activeTabGroup = groups[0]!
  let separateEditorPart:
    | { group: (typeof groups)[number]; layout: unknown; focused: boolean }
    | undefined
  let separatePartLayoutReport: unknown
  type SourceEditor = {
    document: { uri: Uri; getText(): string }
    readonly viewColumn: number
    setDecorations(): void
    selections: { active: Position; anchor: Position }[]
    visibleRanges: Range[]
    revealRange(range: Range, revealType?: number): void
  }
  const activeEditorListeners = new Set<
      (editor: SourceEditor | undefined) => void
    >(),
    selectionListeners = new Set<() => void>()
  const activeTextEditorChanged = (editor: SourceEditor | undefined): void => {
    for (const listener of activeEditorListeners) listener(editor)
  }
  let primaryNotificationOrder: 'together' | 'editor first' | 'group first' =
    'together'
  let partialFocusEditor: { value: SourceEditor | undefined } | undefined
  // Captured-source tabs a previous host session left behind; only their close changes the active tab, so other close paths keep their recorded behavior.
  const leftoverCapturedTabs = new Set<Tab>()
  let lateEditorAfterLeftoverClose = false
  // The captured document the active text editor still reports for a moment after its leftover tab closed.
  let staleEditorAfterLeftoverClose: SourceEditor | undefined
  const deadPaneTabs = new Set<Tab>()
  // Tabs the editor will not release. A close request is answered group by group, as the editor closes: such a tab keeps the requested tabs of its own group only.
  const closeRefusingTabs = new Set<Tab>()
  let rejectNextTabClose = false
  const tabCloseRequests: Tab[][] = []
  let lastSourceEditor: SourceEditor | undefined
  let sourceFocusOnArrange: SourceEditor | undefined
  let reportedSourceColumn: number | undefined
  let nextSourceDisplay: ((editor: SourceEditor) => void) | undefined
  let nextReadingReveal: (() => void) | undefined
  const visibleSourceEditors: (SourceEditor & {
      group: (typeof groups)[number]
    })[] = [],
    decoratedColumns: number[] = []
  let retainedReadingRange: Range | undefined
  /** Models native scrolling for display and explicit reveal without conflating their callbacks. @example scrollReadingRange(new Range(position, position)) */
  const scrollReadingRange = (range: Range, revealType?: number): void => {
    if (!retainedReadingRange) return
    // Native AtTop includes five surrounding lines; revealing the whole old viewport repeatedly drifts upward.
    if (revealType === 3) {
      const first = Math.max(0, range.start.line - 5)
      retainedReadingRange = new Range(
        new Position(first, 0),
        new Position(first + 11, 0),
      )
    } else if (!retainedReadingRange.contains(range)) {
      const first = Math.max(0, range.start.line - 6)
      retainedReadingRange = new Range(
        new Position(first, 0),
        new Position(first + 11, 0),
      )
    }
  }
  /** Models native surrounding-line padding so workspace transfers expose lost reading positions. @example const editor = sourceEditor(document, group) */
  const sourceEditor = (
    document: SourceEditor['document'],
    group: (typeof groups)[number],
    reportedColumn?: number,
  ): SourceEditor => ({
    document,
    get viewColumn() {
      return reportedColumn ?? group.viewColumn
    },
    setDecorations(): void {
      decoratedColumns.push(reportedColumn ?? group.viewColumn)
    },
    selections: [{ anchor: new Position(22, 0), active: new Position(22, 0) }],
    get visibleRanges() {
      return [
        retainedReadingRange ??
          new Range(new Position(0, 0), new Position(100, 0)),
      ]
    },
    revealRange(range, revealType): void {
      const revealed = nextReadingReveal
      nextReadingReveal = undefined
      revealed?.()
      scrollReadingRange(range, revealType)
    },
  })
  type TabChanges = { opened: Tab[]; closed: Tab[]; changed: Tab[] }
  const tabChangeListeners = new Set<(event?: TabChanges) => void>()
  const groupChangeListeners = new Set<
    (event: {
      opened: typeof groups
      closed: typeof groups
      changed: typeof groups
    }) => void
  >()
  const changedGroups = (event: {
    opened: typeof groups
    closed: typeof groups
    changed: typeof groups
  }): void => {
    for (const listener of groupChangeListeners) listener(event)
  }
  let sourceProvider = async (_uri: Uri) => ''
  const historicalDebugPresentations: Array<{
    snapshot: ReplayDebugSnapshot | undefined
    label: string
    sourceDocument?: { uri: string; hash: string }
  }> = []
  let historicalDebugInvalidations = 0
  const historicalDebuggers: TestReplayDebugger[] = []
  let historicalDebugInspection: ReplayInspection = 'inspected'
  let nextHistoricalDebugPresentation:
    | { wait: Promise<void>; entered(): void; recordedStopOnly: boolean }
    | undefined
  let nextHistoricalDebugDisposal:
    { wait: Promise<void>; entered(): void } | undefined
  let nextRecordingReveal: { wait: Promise<void>; entered(): void } | undefined
  let registeredHistoricalDebuggers = 0
  class TestReplayDebugger {
    available = true
    private closed = false
    /**
     * Registers the fake owner so {@link loadHistoricalDebugValues} and {@link endHistoricalDebugSession} can notify the workspace, as the real owner does.
     * @throws When an earlier owner is still registered: the editor accepts one descriptor factory per debug type.
     * @example new TestReplayDebugger(vscode, (reason) => workspace.replayDebuggerChanged(reason))
     */
    constructor(
      _editor: unknown,
      readonly changed: (
        reason: 'values-loaded' | 'session-ended',
      ) => void = () => {},
      readonly failed: (error: unknown) => void = () => {},
    ) {
      if (registeredHistoricalDebuggers > 0)
        throw new Error(
          'a DebugAdapterDescriptorFactory can only be registered once per a type.',
        )
      registeredHistoricalDebuggers++
      historicalDebuggers.push(this)
    }
    async present(
      snapshot: ReplayDebugSnapshot | undefined,
      label: string,
      signal: AbortSignal,
      sourceDocument?: { uri: string; hash: string },
    ): Promise<ReplayInspection> {
      signal.throwIfAborted()
      // Mirrors the real owner: a learner-stopped session never silently relaunches.
      if (!this.available)
        throw new Error(
          'Historical debugger closed. Reopen the learning replay to restore it.',
        )
      historicalDebugPresentations.push({ snapshot, label, sourceDocument })
      // A held presentation models native Run and Debug still loading the recorded values.
      const held = nextHistoricalDebugPresentation
      // A hold reserved for a recorded stop lets earlier gap presentations pass and stays armed.
      if (held && (!held.recordedStopOnly || snapshot)) {
        nextHistoricalDebugPresentation = undefined
        held.entered()
        await held.wait
      }
      return historicalDebugInspection
    }
    /**
     * Mirrors the real owner's bounded wait for native Variables, reading the fake host's view instead of a debug adapter.
     * @returns
     * - `true` once the fake view retrieved that stage of the presented stop
     * - `false` when `timeoutMs` elapsed first, or at once when the owned session ended or this owner was disposed, also for a view that refreshes later
     * @example await debuggerView.awaitRetrieval('scopes', 2_000) // => false when the view never asks
     */
    awaitRetrieval(
      stage: ReplayRetrievalStage,
      timeoutMs: number,
    ): Promise<boolean> {
      return new Promise((resolve) => {
        const finish = (retrieved: boolean): void => {
          clearTimeout(timer)
          nativeVariablesWaiters.delete(check)
          resolve(retrieved)
        }
        const check = (): void => {
          // Like the real owner, an ended session answers no request, so nothing is left to wait for.
          if (!this.available) return finish(false)
          if (
            stage === 'scopes'
              ? nativeVariables.scopesRetrieved
              : nativeVariables.valuesListed
          )
            finish(true)
        }
        const timer = setTimeout(() => finish(false), timeoutMs)
        nativeVariablesWaiters.add(check)
        check()
      })
    }
    /** Mirrors the real owner's cancellable retirement of a different recorded stop; no native session exists here. @example await debuggerView.retire(snapshot, signal) */
    async retire(
      _snapshot: ReplayDebugSnapshot | undefined,
      signal: AbortSignal,
    ): Promise<void> {
      signal.throwIfAborted()
    }
    invalidate(): void {
      historicalDebugInvalidations++
    }
    /** Mirrors the real owner: a second call returns at once, and the registration ends only when the first call finishes stopping the session. @example await debuggerView.dispose() */
    async dispose(): Promise<void> {
      this.available = false
      if (this.closed) return
      this.closed = true
      // Like the real owner, disposal ends every wait for native Variables at once.
      for (const check of [...nativeVariablesWaiters]) check()
      // A held disposal models an editor that has not yet acknowledged the stop of the owned session.
      const held = nextHistoricalDebugDisposal
      if (held) {
        nextHistoricalDebugDisposal = undefined
        held.entered()
        await held.wait
      }
      registeredHistoricalDebuggers--
    }
  }
  /** Lists the first scope's recorded values in the fake host's Variables view and tells every owner, as the debug adapter does once the native client asked for them. @example listNativeValues() */
  const listNativeValues = (): void => {
    if (nativeVariables.valuesListed) return
    nativeVariables.valuesListed = true
    historicalDebugInspection = 'inspected'
    for (const check of [...nativeVariablesWaiters]) check()
    for (const debuggerView of historicalDebuggers)
      debuggerView.changed('values-loaded')
  }
  /** Shows the fake host's Variables view as its focus command does; what the view then loads, and when, depends on how it missed the stop. @example showNativeVariablesView() */
  const showNativeVariablesView = (): void => {
    const hiding = nativeVariables.hiding
    nativeVariables.hiding = undefined
    if (hiding === 'never-opened') {
      // The view asks for the scopes while it renders, but its tree takes list commands only a moment later.
      nativeVariables.scopesRetrieved = true
      for (const check of [...nativeVariablesWaiters]) check()
      setTimeout(() => {
        nativeVariables.treeHoldsStop = true
      }, NATIVE_VARIABLES_FIRST_RENDER_MS).unref()
    }
    if (hiding === 'missed-the-stop')
      // The deferred refresh loads the stop and expands the first scope by itself.
      setTimeout(() => {
        nativeVariables.scopesRetrieved = true
        nativeVariables.treeHoldsStop = true
        for (const check of [...nativeVariablesWaiters]) check()
        listNativeValues()
      }, NATIVE_VARIABLES_REFRESH_MS).unref()
  }
  let sourceOpenFailure = false
  let delayedPanelKind: string | undefined
  let deferredPanelRegistration = false
  let registerDelayedPanel = (): void => {}
  let nextOpen: { wait: Promise<void>; entered(): void } | undefined
  let nextCommand:
    { name: string; wait: Promise<void>; entered(): void } | undefined
  let nextPrimaryFocusResponse:
    { wait: Promise<void>; entered(): void } | undefined
  let nextLayoutResponse: { wait: Promise<void>; entered(): void } | undefined
  const commands: string[] = []
  let constrainStudyGrid = false
  let hideGridWhileMaximized = false
  let editorLayout: unknown = { orientation: 0, groups: [{}] }
  let nextMovedPanelLayout: unknown
  let nativeLayout = false,
    cursorGroupWrappers = false,
    cursorTwoEventContraction = false,
    explicitEditorLayout = false,
    maximizedEditorGroup = false
  let closeEmptyGroupsOnMove = false
  let closeDisposedPanelTabsLater = false
  /** The fake editor answers every tab change with new TabGroup objects, as Cursor does; see `replaceGroupObjectsOnTabChanges`. */
  let replacesGroupObjectsOnTabChanges = false
  /** The bottom panel is maximized: the editor area is hidden and reports its stacked groups at their minimum height. */
  let panelMaximized = false
  /** Tab closes of disposed panels the fake editor has not run yet; see `closeDisposedPanelTabsLater`. */
  const pendingDisposedTabCloses: (() => void)[] = []
  const automaticallyClosedColumns: number[] = []
  let transientLayout = false,
    settledLayout: unknown,
    failingCommand: string | undefined,
    settlementPending = false
  const panels = new Set<ReturnType<typeof panel>>()
  let peakPanels = 0
  let nextPanelCreated:
    { kind: string; run(value: ReturnType<typeof panel>): void } | undefined
  let failedPanelKind: string | undefined
  let suppressNativeInnerFocus = false,
    innerFocusedPanel: string | undefined
  let nextPanelActivity:
      { kind: string; wait: Promise<void>; entered(): void } | undefined,
    pendingPanelActivity: string | undefined
  let nextTextFocusClear:
    { kind: string; wait: Promise<void>; observed(): void } | undefined
  let retainedTextFocus:
    { kind: string; editor: SourceEditor; observed(): void } | undefined
  const windowState = { focused: true, active: true },
    windowListeners = new Set<(state: typeof windowState) => void>()
  const panelReveals: {
    kind: string
    column?: number
    preserveFocus?: boolean
  }[] = []
  let deferredPanelFocus: { kind: string; remaining: number } | undefined
  let deferPrimaryFocusEcho = false,
    pendingPrimaryFocusEcho: typeof activeTabGroup | undefined
  let deferMovedFocusEcho = false,
    pendingMovedFocusEcho: typeof activeTabGroup | undefined
  let deferKeptFocusEcho = false,
    pendingKeptFocusEcho: typeof activeTabGroup | undefined
  let deferredMovedPanelPlacement: string | undefined,
    asynchronousLayoutReads = false
  const postedMessages: StudyViewMessage[] = []
  // What a webview receives besides Study messages: the reader's replies to a pane's open requests, with the webview that got each.
  const openRequestReplies: {
    /** The pane that was answered: `context` for the Study pane's panel, `summary` and `moments` for the two views, and the panel's own view type for any other panel, so a reply to a wrong panel is told apart. */
    webview: string
    openRequest: number
  }[] = []
  let heldPresentationMessage:
    { mode?: 'living-book'; wait: Promise<void>; entered(): void } | undefined
  const receivers = new Map<string, (message: unknown) => void>()
  let automaticContextReceipt = false,
    contextCoversSource = false,
    displayedImage: string | undefined,
    sourceColumn = 2
  let nextImage: { wait: Promise<void>; entered(): void } | undefined
  /**
   * Gives every editor group a new TabGroup object, as Cursor 3.23.12 does whenever a tab opened, another tab of a group became active, a tab closed, or a group opened or closed (obs13 items 7 and 8: 19 of 19 events that name every group); a no-op unless `replaceGroupObjectsOnTabChanges` is on.
   * The view columns, the tabs and the keyboard focus stay, and every holder of a group object is pointed at the new one. The Tab objects are kept: Cursor replaces them too and reports a tab of unknown input with `input` undefined.
   * @param closed - Groups the same change closed; they are reported as closed and get no new object.
   * @example replaceGroupObjects() // harness.groups[0] is another object in the same view column, reported as changed
   */
  function replaceGroupObjects(closed: typeof groups = []): void {
    if (!replacesGroupObjectsOnTabChanges) return
    const replacements = new Map(
      groups.map((group) => [group, { ...group, tabs: [...group.tabs] }]),
    )
    /** Names the new object of a group that survived, and leaves a group that is gone as it is. */
    const replaced = (group: (typeof groups)[number]) =>
      replacements.get(group) ?? group
    groups.splice(0, groups.length, ...groups.map(replaced))
    activeTabGroup = replaced(activeTabGroup)
    if (separateEditorPart)
      separateEditorPart.group = replaced(separateEditorPart.group)
    for (const editor of visibleSourceEditors)
      editor.group = replaced(editor.group)
    changedGroups({ opened: [], closed, changed: [...groups] })
  }
  /** Mirrors native group creation for the layout-return regressions without changing older fixtures. @example nativeGroup(3).viewColumn // 3 */
  function nativeGroup(column: number, preserveLayout = false) {
    const existing = groups.find(
      (group) =>
        group !== separateEditorPart?.group && group.viewColumn === column,
    )
    if (existing) return existing
    const group: (typeof groups)[number] = {
      viewColumn: column,
      tabs: [],
      activeTab: undefined,
    }
    // Cursor replaces surviving wrappers in the same event that announces an opened group.
    const retained = cursorGroupWrappers
      ? groups.map((previous) => ({ ...previous, tabs: [...previous.tabs] }))
      : []
    if (cursorGroupWrappers) {
      if (separateEditorPart)
        separateEditorPart.group =
          retained[groups.indexOf(separateEditorPart.group)]!
      groups.splice(0, groups.length, ...retained)
    }
    groups.push(group)
    // A separate part follows the main grid in global columns without becoming one of its leaves.
    if (separateEditorPart)
      separateEditorPart.group.viewColumn =
        Math.max(
          ...groups
            .filter((candidate) => candidate !== separateEditorPart?.group)
            .map((candidate) => candidate.viewColumn),
        ) + 1
    if (nativeLayout)
      groups.sort((left, right) => left.viewColumn - right.viewColumn)
    // Creating a native pane also grows the measured grid; a supplied layout batch retains its own geometry.
    if (!preserveLayout && (nativeLayout || !explicitEditorLayout))
      editorLayout = {
        orientation: 0,
        groups: groups
          .filter((candidate) => candidate !== separateEditorPart?.group)
          .map(() => ({})),
      }
    if (replacesGroupObjectsOnTabChanges) {
      // Cursor names the opened group and gives every surviving group a new object in the same event.
      const survivors = new Map(
        groups
          .filter((candidate) => candidate !== group)
          .map((candidate) => [
            candidate,
            { ...candidate, tabs: [...candidate.tabs] },
          ]),
      )
      groups.splice(
        0,
        groups.length,
        ...groups.map((candidate) => survivors.get(candidate) ?? candidate),
      )
      activeTabGroup = survivors.get(activeTabGroup) ?? activeTabGroup
      if (separateEditorPart)
        separateEditorPart.group =
          survivors.get(separateEditorPart.group) ?? separateEditorPart.group
      for (const editor of visibleSourceEditors)
        editor.group = survivors.get(editor.group) ?? editor.group
      changedGroups({
        opened: [group],
        closed: [],
        changed: [...survivors.values()],
      })
      return group
    }
    changedGroups({ opened: [group], closed: [], changed: retained })
    return group
  }
  /** Counts native layout leaves so shrinking a grid merges only its removed groups in these tests. @example nativeGroupCount({ groups: [{}, {}] }) // 2 */
  function nativeGroupCount(value: unknown): number {
    const children =
      value && typeof value === 'object'
        ? Reflect.get(value, 'groups')
        : undefined
    return Array.isArray(children)
      ? children.reduce(
          (total: number, child: unknown) => total + nativeGroupCount(child),
          0,
        )
      : 1
  }
  /**
   * Removes one leaf of a measured editor layout, as the editor does when it closes an emptied group: a branch left with one child is replaced by that child.
   * @param layout - The layout the editor reports, with nested `groups`.
   * @param leafIndex - The zero-based position of the removed group among the layout's leaves.
   * @returns The layout without that leaf; a root left with a single branch takes that branch's children and the other orientation.
   * @example layoutWithoutLeaf({ orientation: 0, groups: [{ groups: [{}, {}] }, {}] }, 2) // => { orientation: 1, groups: [{}, {}] }
   */
  function layoutWithoutLeaf(layout: unknown, leafIndex: number): unknown {
    let seen = 0
    const prune = (node: unknown): unknown[] => {
      const children =
        node && typeof node === 'object'
          ? Reflect.get(node, 'groups')
          : undefined
      if (!Array.isArray(children)) return seen++ === leafIndex ? [] : [node]
      const kept = children.flatMap((child: unknown) => prune(child))
      // A branch with one child left is that child; an emptied branch disappears.
      return kept.length > 1 ? [{ ...Object(node), groups: kept }] : kept
    }
    const root = structuredClone(layout),
      orientation = Number(Reflect.get(Object(root), 'orientation') ?? 0),
      children = Reflect.get(Object(root), 'groups')
    const kept = Array.isArray(children)
      ? children.flatMap((child: unknown) => prune(child))
      : []
    const only = kept.length === 1 ? kept[0] : undefined
    const nested =
      only && typeof only === 'object' ? Reflect.get(only, 'groups') : undefined
    return Array.isArray(nested)
      ? { orientation: orientation === 0 ? 1 : 0, groups: nested }
      : { orientation, groups: kept }
  }
  // The editor area the fake window gives its groups, and the least an editor group takes (VS Code's DEFAULT_EDITOR_MIN_DIMENSIONS).
  const EDITOR_AREA_PX = { width: 1100, height: 840 },
    GROUP_MINIMUM_PX = { width: 220, height: 70 }
  /** Reads the child groups of a layout node and whether they are stacked; sizes alternate between widths and heights by nesting level. */
  const layoutChildren = (node: unknown): unknown[] | undefined => {
    const children =
      node && typeof node === 'object' ? Reflect.get(node, 'groups') : undefined
    return Array.isArray(children) ? children : undefined
  }
  const layoutSize = (node: unknown): number =>
    Number(Reflect.get(Object(node), 'size') ?? 1)
  /**
   * Projects the measured layout as a hidden editor area reports it: an area without height clamps every stacked group to its minimum height.
   * @example collapsedLayout({ orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] })
   * // => { orientation: 0, groups: [{ size: 0.55, groups: [{ size: 70 }, { size: 70 }] }, { size: 0.45 }] }
   */
  function collapsedLayout(layout: unknown): unknown {
    const collapse = (node: unknown, isStack: boolean): unknown => {
      const children = layoutChildren(node)
      return {
        ...Object(node),
        ...(children
          ? {
              groups: children.map((child) => ({
                ...Object(collapse(child, !isStack)),
                ...(isStack ? { size: GROUP_MINIMUM_PX.height } : {}),
              })),
            }
          : {}),
      }
    }
    return collapse(layout, Reflect.get(Object(layout), 'orientation') === 1)
  }
  /**
   * Applies the editor's "expand group" to the measured layout: on every level above the group, its branch takes all but the minimum of each sibling.
   * VS Code does this whenever an editor is opened or revealed in a group that sits at its minimum size, which every stacked group of a hidden editor area does.
   * @param column - The view column of the revealed group.
   * @example expandGroup(2) // the source group takes the stack; the Application group keeps 70 of 840 px, the Study pane 220 of 1100 px
   */
  function expandGroup(column: number): void {
    let seen = 0
    const expand = (
      node: unknown,
      isStack: boolean,
    ): { node: unknown; holdsTarget: boolean } => {
      const children = layoutChildren(node)
      if (!children) return { node, holdsTarget: ++seen === column }
      const expanded = children.map((child) => expand(child, !isStack))
      const target = expanded.findIndex((child) => child.holdsTarget)
      if (target < 0)
        return {
          node: {
            ...Object(node),
            groups: expanded.map((child) => child.node),
          },
          holdsTarget: false,
        }
      const total = children.reduce(
          (sum: number, child) => sum + layoutSize(child),
          0,
        ),
        // Sizes are in the layout's own unit (pixels or proportions), so the minimum is taken as its share of the area.
        minimum =
          total *
          (isStack
            ? GROUP_MINIMUM_PX.height / EDITOR_AREA_PX.height
            : GROUP_MINIMUM_PX.width / EDITOR_AREA_PX.width)
      return {
        node: {
          ...Object(node),
          groups: expanded.map((child, index) => ({
            ...Object(child.node),
            size:
              index === target
                ? total - minimum * (children.length - 1)
                : minimum,
          })),
        },
        holdsTarget: true,
      }
    }
    editorLayout = expand(
      editorLayout,
      Reflect.get(Object(editorLayout), 'orientation') === 1,
    ).node
  }
  /**
   * Models what VS Code 1.140 does when an editor is opened or revealed while the bottom panel is maximized.
   * The revealed group sits at its minimum height, so the editor expands it; a changed active editor or an activated group then brings the editor area back, which takes the panel out of its maximized state.
   * @param column - The view column of the group that was revealed into.
   * @param changesVisibleEditors - Whether the group shows another editor now or was activated; a reveal of the editor already in front only expands its group.
   * @example revealIntoHiddenEditorArea(2, true)
   */
  function revealIntoHiddenEditorArea(
    column: number,
    changesVisibleEditors: boolean,
  ): void {
    if (!panelMaximized) return
    expandGroup(column)
    if (changesVisibleEditors) returnHiddenEditorArea()
  }
  /**
   * Brings the hidden editor area back, as VS Code 1.140 does while the bottom panel is maximized whenever a group shows another editor or is activated: the panel leaves its maximized state.
   * The area was laid out without height, so every stacked group comes back at its minimum height and the last group of each stack takes the height that is left, whichever group the trigger acted on: of two stacked groups the first is a 70 px strip.
   * Called by {@link revealIntoHiddenEditorArea} (a reveal, a shown text document), a panel's registration, the focus-group commands, the tab closes and `vscode.setEditorLayout`, whose own layout then replaces these sizes.
   * @example returnHiddenEditorArea() // groupHeightPx(1) => 70 and groupHeightPx(2) => 770 for two stacked groups
   */
  function returnHiddenEditorArea(): void {
    if (!panelMaximized) return
    panelMaximized = false
    const returned = (
      node: unknown,
      isStack: boolean,
      heightPx: number,
    ): unknown => {
      const children = layoutChildren(node)
      if (!children) return node
      // Groups side by side, and a group alone in its stack, keep their sizes and the whole height.
      if (!isStack || children.length === 1)
        return {
          ...Object(node),
          groups: children.map((child) => returned(child, !isStack, heightPx)),
        }
      const lastHeightPx =
        heightPx - GROUP_MINIMUM_PX.height * (children.length - 1)
      return {
        ...Object(node),
        groups: children.map((child, index) => {
          const childHeightPx =
            index === children.length - 1
              ? lastHeightPx
              : GROUP_MINIMUM_PX.height
          return {
            ...Object(returned(child, false, childHeightPx)),
            size: childHeightPx,
          }
        }),
      }
    }
    editorLayout = returned(
      editorLayout,
      Reflect.get(Object(editorLayout), 'orientation') === 1,
      EDITOR_AREA_PX.height,
    )
  }
  /** Measures one group of the fake editor area in pixels, from the proportions or pixels of the measured layout. @example groupHeightPx(1) // 420 for the Application group of the Study layout */
  function groupHeightPx(column: number): number | undefined {
    let seen = 0,
      found: number | undefined
    const measure = (node: unknown, isStack: boolean, height: number): void => {
      const children = layoutChildren(node)
      if (!children) {
        if (++seen === column) found = Math.round(height)
        return
      }
      const total = children.reduce(
        (sum: number, child) => sum + layoutSize(child),
        0,
      )
      for (const child of children)
        measure(
          child,
          !isStack,
          isStack ? (height * layoutSize(child)) / total : height,
        )
    }
    measure(
      editorLayout,
      Reflect.get(Object(editorLayout), 'orientation') === 1,
      EDITOR_AREA_PX.height,
    )
    return found
  }
  /** Closes a main group whose last tab the editor just closed, renumbering the later columns and the measured layout. @example removeEmptiedGroup(group) */
  function removeEmptiedGroup(emptied: (typeof groups)[number]): void {
    const main = groups
      .filter((candidate) => candidate !== separateEditorPart?.group)
      .toSorted((left, right) => left.viewColumn - right.viewColumn)
    // The editor keeps its last group even when it is empty.
    if (main.length < 2 || !groups.includes(emptied)) return
    editorLayout = layoutWithoutLeaf(editorLayout, main.indexOf(emptied))
    groups.splice(groups.indexOf(emptied), 1)
    for (const remaining of groups)
      if (remaining.viewColumn > emptied.viewColumn) remaining.viewColumn--
    for (const retained of panels)
      retained.viewColumn = groups.find((candidate) =>
        candidate.tabs.includes(retained.nativeTab),
      )?.viewColumn
    if (activeTabGroup === emptied) activeTabGroup = groups[0]!
    if (replacesGroupObjectsOnTabChanges) replaceGroupObjects([emptied])
    else changedGroups({ opened: [], closed: [emptied], changed: [...groups] })
  }
  /**
   * Closes tabs as the editor does, group by group, for the reader's `tabGroups.close` requests and for the Close Editor command.
   * A group that loses the tab it shows brings a hidden editor area back, and a native group a dead pane leaves empty is removed by {@link removeEmptiedGroup}.
   * @param tabs - The tabs to close; a tab the editor will not release keeps every requested tab of its own group.
   * @returns
   * - `true` when every requested tab closed
   * - `false` when a group kept its tabs because one of them refuses to close
   * @example closeTabs([leftover]) // => true, and the tab beside the leftover is the one its group shows
   */
  function closeTabs(tabs: Tab[]): boolean {
    let accepted = true,
      closedActiveLeftover = false
    const emptiedByDeadPane: typeof groups = [],
      groupCountBefore = groups.length
    for (const group of groups) {
      const requested = group.tabs.filter((tab) => tabs.includes(tab))
      if (!requested.length) continue
      // One tab the editor will not release keeps every requested tab of its group and fails the answer; the other groups still close.
      if (requested.some((tab) => closeRefusingTabs.has(tab))) {
        accepted = false
        continue
      }
      const active = group.activeTab,
        heldDeadPane = requested.some((tab) => deadPaneTabs.has(tab))
      group.tabs = group.tabs.filter((tab) => !tabs.includes(tab))
      // The group shows another editor, or none, once the tab it showed is closed.
      if (active && tabs.includes(active)) returnHiddenEditorArea()
      // The editor activates the neighbouring tab when the active one closes.
      if (
        active &&
        tabs.includes(active) &&
        (leftoverCapturedTabs.has(active) || deadPaneTabs.has(active))
      ) {
        group.activeTab = group.tabs.at(-1)
        closedActiveLeftover = true
      }
      if (heldDeadPane && !group.tabs.length) emptiedByDeadPane.push(group)
    }
    // The editor removes a group whose last tab closed and renumbers the later columns; its last main group stays, empty.
    for (const emptied of emptiedByDeadPane) {
      const mainGroups = groups.filter(
        (candidate) => candidate !== separateEditorPart?.group,
      )
      if (!nativeLayout || mainGroups.length === 1) break
      // The keyboard focus of the removed group goes to the group before it, or to the next one when it was the first.
      if (activeTabGroup === emptied) {
        const index = groups.indexOf(emptied)
        activeTabGroup = groups[index > 0 ? index - 1 : 1]!
        closedActiveLeftover = true
      }
      removeEmptiedGroup(emptied)
    }
    // Cursor answers closed tabs with new group objects; a removed group above already came with them.
    if (
      groups.length === groupCountBefore &&
      tabs.some((tab) => !groups.some((group) => group.tabs.includes(tab)))
    )
      replaceGroupObjects()
    if (closedActiveLeftover) {
      if (lateEditorAfterLeftoverClose || staleEditorAfterLeftoverClose) {
        // The tab model already names the next tab while the active text editor is still unset, or still shows the document of the tab that closed.
        partialFocusEditor = { value: staleEditorAfterLeftoverClose }
        staleEditorAfterLeftoverClose = undefined
        setTimeout(() => {
          partialFocusEditor = undefined
          activeTextEditorChanged(focusedSourceEditor())
        }, 60)
      } else activeTextEditorChanged(focusedSourceEditor())
    }
    return accepted
  }
  /** Models Cursor's refusal to place a normal reader in its separate chat part; panel and text opens share this boundary. @example nativeReaderColumn(2) // 1 when only main column one and chat column two exist */
  function nativeReaderColumn(requested: number): number {
    if (!nativeLayout) return requested
    if (separateEditorPart?.group.viewColumn === requested)
      return activeTabGroup.viewColumn
    return Math.min(
      requested,
      groups.filter((group) => group !== separateEditorPart?.group).length + 1,
    )
  }
  /** Models the active-text receipt independently of native tab focus for workspace handoff regressions. @example focusedSourceEditor() // prior source until its native clear arrives */
  function focusedSourceEditor(): SourceEditor | undefined {
    if (partialFocusEditor) return partialFocusEditor.value
    if (separateEditorPart?.focused) return undefined
    const input = activeTabGroup.activeTab?.input
    // A newer learner target wins immediately; the delayed clear never steals its focus.
    if (
      retainedTextFocus &&
      input instanceof TabInputWebview &&
      input.viewType === retainedTextFocus.kind
    ) {
      retainedTextFocus.observed()
      return retainedTextFocus.editor
    }
    return visibleSourceEditors.find(
      (editor) =>
        activeTabGroup === editor.group &&
        input instanceof TabInputText &&
        input.uri.toString() === editor.document.uri.toString(),
    )
  }
  /** Retains the old text receipt before either native or inner activation for delayed-notification tests. @example retainDelayedTextFocus('codebook.studyContext'); */
  function retainDelayedTextFocus(kind: string): void {
    const pending =
        nextTextFocusClear?.kind === kind ? nextTextFocusClear : undefined,
      editor = focusedSourceEditor()
    if (!pending || !editor) return
    nextTextFocusClear = undefined
    retainedTextFocus = { kind, editor, observed: pending.observed }
    void pending.wait.then(() => {
      retainedTextFocus = undefined
      activeTextEditorChanged(focusedSourceEditor())
    })
  }
  function panel(
    kind: string,
    _title?: string,
    options?: { viewColumn: number; preserveFocus?: boolean },
  ) {
    if (failedPanelKind === kind) {
      failedPanelKind = undefined
      throw new Error('Injected native panel creation failure')
    }
    let nativeTab = { input: new TabInputWebview(kind), isPreview: false }
    const epoch = randomUUID(),
      messageListeners = new Set<(message: unknown) => void>()
    const emit = (message: unknown): void => {
      for (const listener of messageListeners) listener(message)
    }
    let registered = delayedPanelKind !== kind
    const disposed: (() => void)[] = [],
      viewChanged: (() => void)[] = []
    // Native webviews create only one missing group, even when a later column was requested.
    const viewColumn = options?.viewColumn
      ? nativeReaderColumn(options.viewColumn)
      : options?.viewColumn
    const value = {
      // As the editor's WebviewPanel names it, so a test can find one panel among the native ones.
      viewType: kind,
      blockInnerFocus: false,
      webview: {
        html: '',
        postMessage: async (
          message:
            | StudyViewMessage
            | PresentationPoseCapture
            | PresentationPoseRestore
            | OpenRequestSettled
            | {
                type: 'codebook-focus'
                phase: string
                requestId: string
                epoch?: string
              },
        ) => {
          if (message.type === 'open-request-settled') {
            openRequestReplies.push({
              webview: kind === 'codebook.studyContext' ? 'context' : kind,
              openRequest: message.openRequest,
            })
            return true
          }
          if (message.type === 'capture-presentation-pose') {
            emit({
              ...message,
              type: 'presentation-pose',
              pose: {
                anchorId: 'title',
                fraction: 0,
                leadingOffsetPx: 16,
                scrollY: 0,
                valuesScrollLeft: 0,
                expanded: [],
                visited: [],
              },
            })
            return true
          }
          if (message.type === 'restore-presentation-pose') {
            emit({
              type: 'presentation-pose-restored',
              captureId: message.captureId,
            })
            return true
          }
          if (message.type === 'codebook-focus') {
            if (message.phase === 'prepare')
              emit({
                type: 'codebook-focus-receipt',
                phase: 'prepared',
                requestId: message.requestId,
                epoch,
                focused: innerFocusedPanel === kind,
              })
            if (message.phase === 'commit' && message.epoch === epoch) {
              const group = groups.find(
                (group) => group.activeTab === nativeTab,
              )
              assert.ok(group)
              const held =
                nextPanelActivity?.kind === kind ? nextPanelActivity : undefined
              retainDelayedTextFocus(kind)
              // Native tab selection and document focus can precede the panel's active notification.
              if (held) {
                nextPanelActivity = undefined
                pendingPanelActivity = kind
              }
              activeTabGroup = group
              for (const listener of viewChanged) listener()
              // The current renderer reports native delivery; its commit cannot supply missing document focus.
              emit({
                type: 'codebook-focus-receipt',
                phase: 'focused',
                requestId: message.requestId,
                epoch,
                focused: innerFocusedPanel === kind,
              })
              if (held) {
                held.entered()
                void held.wait.then(() => {
                  pendingPanelActivity = undefined
                  for (const listener of viewChanged) listener()
                })
              }
            }
            return true
          }
          postedMessages.push(message)
          const held = heldPresentationMessage
          if (
            held &&
            kind === 'codebook.studyContext' &&
            message.presentation?.state === 'applying' &&
            (!held.mode || message.presentation.mode === held.mode)
          ) {
            held.entered()
            await held.wait
            if (heldPresentationMessage === held)
              heldPresentationMessage = undefined
          }
          if (
            (automaticContextReceipt ||
              message.presentation?.state === 'applying') &&
            kind === 'codebook.studyContext' &&
            message.type === 'study' &&
            !message.loading
          ) {
            emit({
              type: 'rendered',
              revision: message.revision,
              itemId: message.model.selection.itemId,
              snapshotUri: message.model.observation?.snapshotUri,
              presentationControlRevision:
                message.presentation?.presentationControlRevision,
              presentationMode: message.presentation?.mode,
              ...(message.recording
                ? {
                    presentationRevision:
                      message.recording.presentationRevision,
                  }
                : {}),
            })
          }
          return true
        },
        onDidReceiveMessage: (callback: (message: unknown) => void) => {
          messageListeners.add(callback)
          receivers.set(kind, (message) => {
            for (const listener of messageListeners) listener(message)
          })
          return {
            dispose(): void {
              messageListeners.delete(callback)
            },
          }
        },
      },
      kind,
      get nativeTab() {
        return nativeTab
      },
      emit,
      viewColumn,
      title: _title ?? '',
      /** Models a host model resync for registration tests while preserving the actual panel/tab relation. @example panel.refreshTabWrapper() */
      refreshTabWrapper(): void {
        const previous = nativeTab
        nativeTab = { ...nativeTab }
        // Only the API wrapper changes; the native tab, selected group and panel lifetime remain the same.
        for (const group of groups) {
          group.tabs = group.tabs.map((tab) =>
            tab === previous ? nativeTab : tab,
          )
          if (group.activeTab === previous) group.activeTab = nativeTab
        }
      },
      get active() {
        return (
          !registered ||
          (pendingPanelActivity !== kind &&
            !separateEditorPart?.focused &&
            activeTabGroup.activeTab === nativeTab)
        )
      },
      get visible() {
        return (
          !registered || groups.some((group) => group.activeTab === nativeTab)
        )
      },
      reveal(column?: number, preserveFocus?: boolean): void {
        panelReveals.push({ kind, column, preserveFocus })
        const previousColumn = value.viewColumn,
          previousFocusedGroup = activeTabGroup
        if (column !== undefined) value.viewColumn = nativeReaderColumn(column)
        if (
          column !== undefined &&
          previousColumn !== column &&
          nextMovedPanelLayout
        ) {
          editorLayout = nextMovedPanelLayout
          nextMovedPanelLayout = undefined
        }
        {
          const wasInFront = groups.some(
            (group) =>
              group.activeTab === nativeTab &&
              group.viewColumn === value.viewColumn,
          )
          for (const group of groups) {
            group.tabs = group.tabs.filter((tab) => tab !== nativeTab)
            if (group.activeTab === nativeTab) group.activeTab = undefined
          }
          const group = nativeGroup(value.viewColumn ?? 1)
          revealIntoHiddenEditorArea(
            group.viewColumn,
            !wasInFront || !preserveFocus,
          )
          if (
            nativeLayout &&
            previousColumn !== value.viewColumn &&
            group.activeTab?.isPreview
          ) {
            const replaced = [...panels].find(
              (panel) => panel.nativeTab === group.activeTab,
            )
            replaced?.dispose()
          }
          group.tabs.push(nativeTab)
          group.activeTab = nativeTab
          if (column !== undefined && previousColumn !== column)
            nativeTab.isPreview = true
          // Normal editors remove a vacated last-tab group and renumber later main and foreign columns.
          const emptied = groups.find(
            (candidate) =>
              candidate !== separateEditorPart?.group &&
              candidate.viewColumn === previousColumn &&
              !candidate.tabs.length,
          )
          if (
            closeEmptyGroupsOnMove &&
            previousColumn !== value.viewColumn &&
            emptied
          ) {
            automaticallyClosedColumns.push(emptied.viewColumn)
            removeEmptiedGroup(emptied)
          }
          if (!preserveFocus) {
            retainDelayedTextFocus(kind)
            if (!suppressNativeInnerFocus && !value.blockInnerFocus)
              innerFocusedPanel = kind
            if (separateEditorPart) separateEditorPart.focused = false
            // Refocusing an already kept Application can echo after the following Context acknowledgement.
            if (pendingKeptFocusEcho && kind === 'codebook.studyContext') {
              const previous = pendingKeptFocusEcho
              pendingKeptFocusEcho = undefined
              setImmediate(() => {
                activeTabGroup = group
                for (const listener of viewChanged) listener()
                setImmediate(() => {
                  activeTabGroup = previous
                  for (const listener of viewChanged) listener()
                })
              })
              return
            }
            if (
              deferKeptFocusEcho &&
              kind === 'codebook.scopedBrowser' &&
              previousColumn === value.viewColumn &&
              !nativeTab.isPreview
            ) {
              deferKeptFocusEcho = false
              pendingKeptFocusEcho = group
            }
            // Native relocation can refocus the first moved webview after the second move has acknowledged focus.
            if (
              pendingMovedFocusEcho &&
              kind === 'codebook.studyContext' &&
              previousColumn !== value.viewColumn
            ) {
              const previous = pendingMovedFocusEcho
              pendingMovedFocusEcho = undefined
              setImmediate(() => {
                activeTabGroup = group
                for (const listener of viewChanged) listener()
                setImmediate(() => {
                  activeTabGroup = previous
                  for (const listener of viewChanged) listener()
                })
              })
              return
            }
            if (
              deferMovedFocusEcho &&
              kind === 'codebook.scopedBrowser' &&
              previousColumn !== value.viewColumn
            ) {
              deferMovedFocusEcho = false
              pendingMovedFocusEcho = group
            }
            // The native primary webview can report focus again after a subsequent Context reveal has already acknowledged focus.
            if (pendingPrimaryFocusEcho && kind === 'codebook.studyContext') {
              const primary = pendingPrimaryFocusEcho
              pendingPrimaryFocusEcho = undefined
              setImmediate(() => {
                activeTabGroup = group
                for (const listener of viewChanged) listener()
                setImmediate(() => {
                  activeTabGroup = primary
                  for (const listener of viewChanged) listener()
                })
              })
              return
            }
            // Native webview reveal returns before its focus notification reaches the extension host.
            if (
              deferredPanelFocus?.kind === kind &&
              --deferredPanelFocus.remaining === 0
            ) {
              deferredPanelFocus = undefined
              setImmediate(() => {
                activeTabGroup = group
                for (const listener of viewChanged) listener()
              })
            } else activeTabGroup = group
          }
          // Native tab movement can precede the panel's column receipt; focus changes only when requested.
          if (
            previousColumn !== value.viewColumn &&
            deferredMovedPanelPlacement === kind
          ) {
            deferredMovedPanelPlacement = undefined
            const destination = value.viewColumn
            value.viewColumn = previousColumn
            if (!preserveFocus) activeTabGroup = previousFocusedGroup
            setImmediate(() => {
              value.viewColumn = destination
              if (!preserveFocus) activeTabGroup = group
              for (const listener of viewChanged) listener()
            })
          }
          // A pane that moved or came to the front changed a group's tabs; a reveal of the pane already in front did not.
          if (!wasInFront) replaceGroupObjects()
          for (const listener of viewChanged) listener()
        }
        if (contextCoversSource && kind === 'codebook.studyContext')
          groups[0]!.activeTab = undefined
      },
      onDidDispose(callback: () => void) {
        disposed.push(callback)
        return {
          dispose(): void {
            const index = disposed.indexOf(callback)
            if (index >= 0) disposed.splice(index, 1)
          },
        }
      },
      notifyViewState(): void {
        for (const listener of viewChanged) listener()
      },
      viewListenerCount: () => viewChanged.length,
      onDidChangeViewState(callback: () => void) {
        viewChanged.push(callback)
        return {
          dispose(): void {
            const index = viewChanged.indexOf(callback)
            if (index >= 0) viewChanged.splice(index, 1)
          },
        }
      },
      dispose(): void {
        if (!panels.delete(value)) return
        const closeTab = (): void => {
          const emptied = groups.filter(
            (group) => group.tabs.length === 1 && group.tabs[0] === nativeTab,
          )
          for (const group of groups) {
            group.tabs = group.tabs.filter((tab) => tab !== nativeTab)
            if (group.activeTab === nativeTab) group.activeTab = undefined
          }
          // The editor then removes the group the tab left empty (workbench.editor.closeEmptyGroups, on by default).
          if (closeDisposedPanelTabsLater && emptied.length)
            for (const group of emptied) removeEmptiedGroup(group)
          else replaceGroupObjects()
        }
        // VS Code closes a disposed editor from a worker with a 0 ms delay; a layout read that reached the busy window with the disposal is answered before that worker runs.
        if (closeDisposedPanelTabsLater) pendingDisposedTabCloses.push(closeTab)
        else closeTab()
        for (const listener of disposed) listener()
      },
    }
    // Both hosts initialize optimistic panel flags before the native tab/view-state acknowledgement arrives.
    const register = (): void => {
      registered = true
      const group = nativeGroup(value.viewColumn ?? 1)
      if (!group.tabs.includes(nativeTab)) group.tabs.push(nativeTab)
      group.activeTab = nativeTab
      // The new pane is the editor its group shows now, with or without the keyboard focus.
      returnHiddenEditorArea()
      replaceGroupObjects()
    }
    if (registered) register()
    else {
      delayedPanelKind = undefined
      registerDelayedPanel = register
      if (deferredPanelRegistration) {
        deferredPanelRegistration = false
        setImmediate(register)
      }
    }
    panels.add(value)
    peakPanels = Math.max(peakPanels, panels.size)
    const created = nextPanelCreated
    if (created?.kind === kind) {
      nextPanelCreated = undefined
      created.run(value)
    }
    return value
  }
  const initialSelection: string[] = []
  let outlineCheckbox = (_event: { items: [string, number][] }): void => {}
  let outlineItem = (
    _itemId: string,
  ): { checkboxState?: number; description?: string; command?: unknown } => ({})
  const outline = {
    ...disposable(),
    visible: true,
    selection: initialSelection,
    onDidChangeCheckboxState: (callback: typeof outlineCheckbox) => {
      outlineCheckbox = callback
      return disposable()
    },
    onDidChangeVisibility: disposable,
    reveal: async (
      participant: string,
      options: { select: boolean; focus: boolean },
    ): Promise<void> => {
      assert.equal(options.focus, false)
      if (options.select) outline.selection = [participant]
    },
  }
  const watcher = {
    onDidChange(callback: () => void) {
      changed = callback
      return disposable()
    },
    onDidCreate: disposable,
    onDidDelete: disposable,
    dispose(): void {},
  }
  const viewportEvents: string[] = [],
    viewportInstances: WorkspaceViewport[] = []
  /** Models the leased renderer contract so workspace tests fail when retirement precedes transfer. @example reader.presentation.createViewport('run', record, fail, 'normal') */
  class WorkspaceViewport {
    panel: ReturnType<typeof panel>
    historical = false
    private held = false
    private closed = false
    private rendererAttached = true
    private listener?: { dispose(): void }
    /** Stands for the renderer document the real viewport writes into its panel; any other writer of the shared panel replaces it. */
    private readonly rendererDocument: string
    private historicalHtml = ''
    constructor(
      _runId: string,
      readonly record: (type: string, detail?: unknown) => unknown,
      private readonly fail: (reason: string) => void,
      _scenario: unknown,
      private readonly lease: {
        panel: ReturnType<typeof panel>
        released(): void
      },
      _observer?: unknown,
      readonly mode = 'live',
    ) {
      this.panel = lease.panel
      this.rendererDocument = `<codebook-viewport ${mode} ${randomUUID()}>`
      // Like the real constructor, a new viewport replaces whatever document the leased panel held.
      this.panel.webview.html = this.rendererDocument
      viewportInstances.push(this)
      this.bind()
    }
    /** Tells whether this viewport's own renderer document is still the one in its panel, so only then can a paint or a handshake be answered. @example this.rendererInPlace() */
    private rendererInPlace(): boolean {
      return this.panel.webview.html === this.rendererDocument
    }
    /** Tracks only the current simulated renderer so old disposal exposes a missing rebind. @example this.bind() */
    private bind(): void {
      const current = this.panel
      this.listener = current.onDidDispose(() => {
        if (this.panel !== current || this.closed) return
        this.closed = true
        viewportEvents.push(`unexpected-close:${this.mode}`)
        this.fail('Owned viewport closed before cleanup')
      })
    }
    /**
     * Refuses renderer use after genuine native closure during replay integration.
     *
     * A held recording reveal models the real viewport queueing behind a native placement hold: that wait does not observe
     * the caller's cancellation, and the reveal checks it only once the hold is released.
     *
     * @example await viewport.reveal(signal)
     */
    async reveal(signal?: AbortSignal): Promise<void> {
      assert.equal(this.closed, false)
      const held = this.mode === 'recording' ? nextRecordingReveal : undefined
      if (held) {
        nextRecordingReveal = undefined
        held.entered()
        await held.wait
        signal?.throwIfAborted()
      }
      // Like the real viewport, a pinned live lease returns without touching the panel, and only a renderer detached by a handoff writes its document again.
      if (!this.historical) {
        if (!this.rendererAttached)
          this.panel.webview.html = this.rendererDocument
        // A document another writer put into the panel never answers the readiness request.
        if (this.mode === 'recording' && !this.rendererInPlace())
          throw new Error('Timed out waiting for owned viewport ready')
      }
      this.rendererAttached = true
      viewportEvents.push(`reveal:${this.mode}`)
    }
    /**
     * Marks selected live presentation without starting another runtime.
     * @throws "Viewport lease is released" once the lease was closed or its panel is gone, before the panel is touched, like the real viewport.
     * @example await viewport.showLive()
     */
    async showLive(signal?: AbortSignal): Promise<void> {
      if (this.closed) throw new Error('Viewport lease is released')
      // Like the real viewport, a lease that is not pinned to history only restores a detached renderer, leaving an attached one's panel untouched.
      if (!this.historical) {
        if (!this.rendererAttached)
          this.panel.webview.html = this.rendererDocument
        this.rendererAttached = true
        return
      }
      this.historical = false
      this.panel.webview.html = this.rendererDocument
      this.rendererAttached = true
      // Leaving history re-handshakes the renderer, as the real showLive awaits its reveal.
      await this.reveal(signal)
    }
    /** Retains the hidden live lease while the workspace reads recorded evidence. @example viewport.showHistory() */
    showHistory(html: string): void {
      // Like the real viewport, a lease whose panel closed cannot write its history page.
      if (this.closed) throw new Error('Viewport lease is released')
      this.historical = true
      this.historicalHtml = html
      this.panel.webview.html = html
    }
    /** Ends this simulated lease during workspace cleanup, using its original release callback. @example viewport.close() */
    close(): void {
      this.listener?.dispose()
      this.closed = true
      // Like the real frame delivery, closing rejects a paint that is still in flight.
      this.abandonPaint?.(new Error('Viewport disposed'))
      this.lease.released()
    }
    /** Reserves the simulated renderer so workspace tests enforce drain before adoption. @example const release = await viewport.holdPlacement() */
    async holdPlacement() {
      assert.equal(this.closed, false)
      assert.equal(this.held, false)
      this.held = true
      viewportEvents.push(`hold:${this.mode}`)
      return (): void => {
        this.held = false
        viewportEvents.push(`release:${this.mode}`)
      }
    }
    /** Exposes retirement ordering bugs by requiring the current placement hold. @example viewport.rebindPanel(replacement) */
    rebindPanel(replacement: ReturnType<typeof panel>): void {
      assert.equal(this.held, true)
      assert.equal(this.closed, false)
      this.listener?.dispose()
      this.panel = replacement
      this.rendererAttached = false
      this.bind()
      viewportEvents.push(`rebind:${this.mode}`)
    }
    /** Confirms that selected pixels restore outside the native placement hold. @example await viewport.restorePlacement() */
    async restorePlacement(): Promise<void> {
      assert.equal(this.held, false)
      assert.equal(this.closed, false)
      // Like the real viewport, a renderer detached by the handoff writes its document into the replacement panel: the pinned history page for a historical lease, its own renderer otherwise.
      if (!this.rendererAttached)
        this.panel.webview.html = this.historical
          ? this.historicalHtml
          : this.rendererDocument
      this.rendererAttached = true
      viewportEvents.push(`restore:${this.mode}`)
    }
    /** Clears unavailable recorded pixels for playback readiness tests; like the real frame delivery, it also rejects a paint still in flight. @example viewport.clearRecorded() */
    clearRecorded(): void {
      displayedImage = undefined
      this.abandonPaint?.(new Error('Pause display invalidated'))
    }
    private abandonPaint?: (error: Error) => void
    /** Delays only the requested replay image so workspace tests can interrupt pending paints. @example await viewport.present(png) */
    async present(image: string): Promise<void> {
      // The real viewport refuses renderer work once its lease is released.
      if (this.closed) throw new Error('Owned viewport is closed')
      assert.equal(this.rendererAttached, true, 'Webview is not ready')
      // No renderer acknowledges a frame once another writer replaced this viewport's document; the real delivery then runs out of its paint budget.
      if (this.mode === 'recording' && !this.rendererInPlace())
        throw new Error(VIEWPORT_ACK_TIMEOUT_REASON)
      const held = nextImage
      nextImage = undefined
      if (held) {
        held.entered()
        await new Promise<void>((resolve, reject) => {
          this.abandonPaint = reject
          held.wait.then(resolve, reject)
        }).finally(() => {
          this.abandonPaint = undefined
        })
      }
      displayedImage = image
    }
    /** Models a confirmed missing-frame interval without retaining previous pixels. @example await viewport.presentMissing() */
    async presentMissing(): Promise<void> {
      assert.equal(
        this.rendererAttached,
        true,
        'Recorded viewport is not ready',
      )
      // A replaced document never reports the gap as painted either.
      if (!this.rendererInPlace())
        throw new Error('Timed out waiting for recorded gap presentation')
      displayedImage = undefined
    }
  }
  /** Resolves displayed URIs through the fake workspace loader so native source tabs keep real document text. @example (await openSourceDocument(Uri.file(path))).getText() */
  const openSourceDocument = async (uri: Uri) => {
    const held = nextOpen
    nextOpen = undefined
    if (held) {
      held.entered()
      await held.wait
    }
    if (sourceOpenFailure && uri.scheme !== 'file')
      throw new Error('Injected current source open failure')
    const text =
        uri.scheme === 'file'
          ? await readFile(uri.fsPath, 'utf8')
          : await sourceProvider(uri),
      normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    return {
      uri,
      getText: () => normalized,
      validatePosition: (position: Position) => {
        const lines = normalized.split('\n'),
          line = Math.min(position.line, lines.length - 1)
        return new Position(
          line,
          Math.min(position.character, lines[line]!.length),
        )
      },
    }
  }
  const summaryListeners = new Set<(message: unknown) => void>()
  const summaryVisibilityListeners = new Set<() => void>()
  const summary = {
    visible: false,
    webview: {
      options: {},
      html: '',
      onDidReceiveMessage(callback: (message: unknown) => void) {
        summaryListeners.add(callback)
        return {
          dispose(): void {
            summaryListeners.delete(callback)
          },
        }
      },
      async postMessage(message: StudyViewMessage | OpenRequestSettled) {
        if (message.type === 'open-request-settled') {
          openRequestReplies.push({
            webview: 'summary',
            openRequest: message.openRequest,
          })
          return true
        }
        postedMessages.push(message)
        if (
          summary.visible &&
          automaticContextReceipt &&
          message.type === 'study' &&
          !message.loading
        ) {
          for (const listener of summaryListeners)
            listener({
              type: 'rendered',
              revision: message.revision,
              itemId: message.model.selection.itemId,
              snapshotUri: message.model.observation?.snapshotUri,
              presentationRevision: message.recording?.presentationRevision,
            })
        }
        return true
      },
    },
    onDidDispose: disposable,
    onDidChangeVisibility(callback: () => void) {
      summaryVisibilityListeners.add(callback)
      return {
        dispose(): void {
          summaryVisibilityListeners.delete(callback)
        },
      }
    },
  }
  const playbackPanelMessages: StudyViewMessage[] = []
  const playbackPanelListeners = new Set<(message: unknown) => void>()
  const playbackPanelVisibilityListeners = new Set<() => void>()
  const playbackPanelDisposeListeners = new Set<() => void>()
  const playbackPanel = {
    visible: false,
    webview: {
      options: {},
      html: '',
      onDidReceiveMessage(callback: (message: unknown) => void) {
        playbackPanelListeners.add(callback)
        return disposable()
      },
      async postMessage(message: StudyViewMessage | OpenRequestSettled) {
        if (message.type === 'open-request-settled') {
          openRequestReplies.push({
            webview: 'moments',
            openRequest: message.openRequest,
          })
          return true
        }
        playbackPanelMessages.push(message)
        return true
      },
    },
    onDidDispose(callback: () => void) {
      playbackPanelDisposeListeners.add(callback)
      return disposable()
    },
    onDidChangeVisibility(callback: () => void) {
      playbackPanelVisibilityListeners.add(callback)
      return disposable()
    },
  }
  let playbackPanelProvider:
    | { resolveWebviewView(view: typeof playbackPanel): void | Promise<void> }
    | undefined
  let playbackPanelResolved = false
  let summaryProvider:
    | { resolveWebviewView(view: typeof summary): void | Promise<void> }
    | undefined
  let summaryResolved = false
  const editorDependencies = {
    vscode: {
      EventEmitter,
      Uri,
      TabInputText,
      TabInputWebview,
      TreeItem: class {},
      TreeItemCollapsibleState: { None: 0 },
      TreeItemCheckboxState: { Unchecked: 0, Checked: 1 },
      Position,
      Range,
      ViewColumn: { One: 1, Two: 2, Three: 3 },
      TextEditorRevealType: { Default: 0, AtTop: 3 },
      ThemeColor: class {},
      RelativePattern,
      env: {
        get appName(): string {
          return hostAppName
        },
      },
      commands: {
        async getCommands(): Promise<string[]> {
          return nativeHostCommands.filter(
            (name) => !absentHostCommands.has(name),
          )
        },
        async executeCommand(name: string, layout?: unknown): Promise<unknown> {
          // Both native hosts reject a command they do not register, in these words.
          if (absentHostCommands.has(name))
            throw new Error(`command '${name}' not found`)
          if (name === 'codebook.observedMoments.focus') {
            assert.ok(playbackPanelProvider)
            playbackPanel.visible = true
            if (!playbackPanelResolved) {
              playbackPanelResolved = true
              await playbackPanelProvider.resolveWebviewView(playbackPanel)
            }
            for (const listener of playbackPanelVisibilityListeners) listener()
          }
          if (name === 'codebook.learningSummary.focus') {
            assert.ok(summaryProvider)
            summary.visible = true
            if (!summaryResolved) {
              summaryResolved = true
              await summaryProvider.resolveWebviewView(summary)
            }
            for (const listener of summaryVisibilityListeners) listener()
          }
          commands.push(name)
          if (name === 'workbench.debug.action.focusVariablesView')
            showNativeVariablesView()
          // A list command acts on the rows the focused tree holds at that moment; an empty tree gives it nothing to focus or expand.
          if (name === 'list.focusFirst' && nativeVariables.treeHoldsStop)
            nativeVariables.firstScopeFocused = true
          if (name === 'list.expand' && nativeVariables.firstScopeFocused)
            listNativeValues()
          const held = nextCommand
          if (held?.name === name) {
            nextCommand = undefined
            held.entered()
            await held.wait
          }
          if (name === failingCommand) {
            failingCommand = undefined
            throw new Error('Native layout command failed')
          }
          if (name === 'runCommands') {
            assert.ok(
              layout &&
                typeof layout === 'object' &&
                'commands' in layout &&
                Array.isArray(layout.commands),
            )
            // Both native hosts notify child failures without rejecting the accepted batch promise.
            try {
              for (const command of layout.commands)
                await this.executeCommand(
                  typeof command === 'string' ? command : command.command,
                  typeof command === 'string' ? undefined : command.args,
                )
            } catch {}
            if (sourceFocusOnArrange)
              activeTextEditorChanged(sourceFocusOnArrange)
            return
          }
          if (
            name === 'workbench.action.keepEditor' &&
            activeTabGroup.activeTab
          )
            activeTabGroup.activeTab.isPreview = false
          // The learner's Close Editor closes the tab the focused group shows, as a close request for that tab does.
          if (
            name === 'workbench.action.closeActiveEditor' &&
            activeTabGroup.activeTab
          )
            closeTabs([activeTabGroup.activeTab])
          if (name === 'workbench.action.minimizeOtherEditors') {
            maximizedEditorGroup = false
            // Native Expand also changes group proportions while exiting maximization.
            const layout = structuredClone(editorLayout)
            if (
              layout &&
              typeof layout === 'object' &&
              'groups' in layout &&
              Array.isArray(layout.groups) &&
              layout.groups.length > 1
            ) {
              for (const [index, group] of layout.groups.entries())
                if (group && typeof group === 'object')
                  group.size =
                    index === 0 ? 0.8 : 0.2 / (layout.groups.length - 1)
              editorLayout = layout
            }
          }
          if (name === 'workbench.action.toggleMaximizeEditorGroup')
            maximizedEditorGroup = !maximizedEditorGroup
          if (name === 'workbench.action.maximizeEditorHideSidebar')
            maximizedEditorGroup = true
          // The activated group is in view before the command answers.
          if (focusGroupCommands.includes(name)) returnHiddenEditorArea()
          const focusedColumn = focusGroupAtColumnCommands.indexOf(name) + 2
          // The editor's commands for its second to eighth group give that group the keyboard focus and keep the tab it shows.
          if (focusedColumn > 1) {
            const focusedGroup = groups.find(
              (group) => group.viewColumn === focusedColumn,
            )
            if (focusedGroup && focusedGroup !== activeTabGroup) {
              const previousGroup = activeTabGroup
              returnHiddenEditorArea()
              activeTabGroup = focusedGroup
              innerFocusedPanel = undefined
              if (separateEditorPart)
                separateEditorPart.focused =
                  focusedGroup === separateEditorPart.group
              changedGroups({
                opened: [],
                closed: [],
                changed: [previousGroup, focusedGroup],
              })
              activeTextEditorChanged(focusedSourceEditor())
            }
          }
          if (name === 'workbench.action.focusFirstEditorGroup') {
            const previousEditor = focusedSourceEditor(),
              previousGroup = activeTabGroup,
              primaryGroup = groups.find((group) => group.viewColumn === 1)!
            const primaryEditor = visibleSourceEditors.find(
              (editor) => editor.group === primaryGroup,
            )
            // Native text and tab-group notifications have no cross-event ordering guarantee.
            if (primaryNotificationOrder === 'editor first') {
              partialFocusEditor = { value: primaryEditor }
              activeTextEditorChanged(primaryEditor)
            }
            if (primaryNotificationOrder === 'group first')
              partialFocusEditor = { value: previousEditor }
            activeTabGroup = primaryGroup
            if (deferPrimaryFocusEcho) pendingPrimaryFocusEcho = activeTabGroup
            if (separateEditorPart) separateEditorPart.focused = false
            if (primaryNotificationOrder !== 'together')
              changedGroups({
                opened: [],
                closed: [],
                changed: [previousGroup, primaryGroup],
              })
            partialFocusEditor = undefined
            activeTextEditorChanged(primaryEditor)
            // The command effect may precede its RPC response; newer learner input must not become the operation's baseline.
            const response = nextPrimaryFocusResponse
            nextPrimaryFocusResponse = undefined
            if (response) {
              response.entered()
              await response.wait
            }
          }
          if (name === 'vscode.getEditorLayout') {
            if (asynchronousLayoutReads)
              await new Promise<void>((resolve) => setImmediate(resolve))
            if (hideGridWhileMaximized && maximizedEditorGroup) return undefined
            // The disposed panels' tabs close one task after this read is answered.
            const dueTabCloses = pendingDisposedTabCloses.splice(0)
            if (dueTabCloses.length)
              setImmediate(() => {
                for (const close of dueTabCloses) close()
              })
            // The focused separate part answers for itself, and a hidden editor area reports its stacked groups collapsed.
            let reportedLayout = editorLayout
            if (separateEditorPart?.focused)
              reportedLayout =
                separatePartLayoutReport ?? separateEditorPart.layout
            else if (panelMaximized)
              reportedLayout = collapsedLayout(editorLayout)
            const layout = JSON.parse(
              JSON.stringify(reportedLayout, (key, value) =>
                key === 'groups' && Array.isArray(value)
                  ? value.map((group) => ({ size: 1, ...group }))
                  : value,
              ),
            )
            // The accepted grid settles without a second mutation; its first read can still contain native transient pixels.
            if (settlementPending) {
              editorLayout = structuredClone(settledLayout)
              settlementPending = false
            }
            return layout
          }
          if (name === 'vscode.setEditorLayout') {
            explicitEditorLayout = true
            maximizedEditorGroup = false
            // The public layout command changes the active part even while TabGroups still reports the old main active group.
            if (separateEditorPart?.focused) {
              separateEditorPart.layout = structuredClone(layout)
              return
            }
            // A layout given to the main grid brings a hidden editor area back; the given layout replaces the sizes of that return.
            returnHiddenEditorArea()
            settledLayout =
              constrainStudyGrid && nativeGroupCount(layout) === 3
                ? {
                    orientation: 0,
                    groups: [
                      { size: 220, groups: [{ size: 70 }, { size: 70 }] },
                      { size: 220 },
                    ],
                  }
                : structuredClone(layout)
            editorLayout = transientLayout
              ? {
                  orientation: 0,
                  groups: [
                    {
                      size: 0.5,
                      groups: [{ size: 0.5 }, { size: 475.83333333333326 }],
                    },
                    { size: 659.5 },
                  ],
                }
              : structuredClone(settledLayout)
            settlementPending = transientLayout
            if (nativeLayout) {
              const count = nativeGroupCount(layout)
              for (let column = 1; column <= count; column++)
                nativeGroup(column, true)
              let removed = groups.filter(
                (group) =>
                  group !== separateEditorPart?.group &&
                  group.viewColumn > count,
              )
              // Preserve the old wrappers' pre-merge tabs so exact-equality matching cannot pass accidentally.
              if (cursorGroupWrappers && removed.length) {
                groups.splice(
                  0,
                  groups.length,
                  ...groups
                    .filter(
                      (group) =>
                        group === separateEditorPart?.group ||
                        cursorTwoEventContraction ||
                        group.viewColumn <= count,
                    )
                    .map((group) =>
                      group === separateEditorPart?.group
                        ? group
                        : { ...group, tabs: [...group.tabs] },
                    ),
                )
                if (cursorTwoEventContraction)
                  removed = groups.filter(
                    (group) =>
                      group !== separateEditorPart?.group &&
                      group.viewColumn > count,
                  )
              }
              const destination = nativeGroup(count)
              for (const group of removed) {
                destination.tabs.push(...group.tabs)
                if (group.activeTab) destination.activeTab = group.activeTab
                for (const view of panels)
                  if (group.tabs.includes(view.nativeTab))
                    view.viewColumn = count
              }
              // Cursor first reports copied tabs in both groups, then closes the emptied source group in a second wrapper resync.
              if (cursorTwoEventContraction && removed.length) {
                changedGroups({ opened: [], closed: [], changed: [...groups] })
                for (const group of removed) {
                  group.tabs = []
                  group.activeTab = undefined
                }
                groups.splice(
                  0,
                  groups.length,
                  ...groups
                    .filter(
                      (group) =>
                        group === separateEditorPart?.group ||
                        group.viewColumn <= count,
                    )
                    .map((group) =>
                      group === separateEditorPart?.group
                        ? group
                        : { ...group, tabs: [...group.tabs] },
                    ),
                )
              }
              if (sourceColumn > count) sourceColumn = count
              groups.splice(
                0,
                groups.length,
                ...groups.filter(
                  (group) =>
                    group === separateEditorPart?.group ||
                    group.viewColumn <= count,
                ),
              )
              if (separateEditorPart)
                separateEditorPart.group.viewColumn = count + 1
              if (removed.length)
                changedGroups({
                  opened: [],
                  closed: removed,
                  changed: cursorGroupWrappers ? [...groups] : [destination],
                })
            } else {
              const opened: typeof groups = []
              for (const column of [1, 3])
                if (!groups.some((group) => group.viewColumn === column)) {
                  const group = { viewColumn: column, tabs: [] }
                  groups.push(group)
                  opened.push(group)
                }
              if (opened.length)
                changedGroups({ opened, closed: [], changed: [] })
            }
          }
          // Native layout is already accepted before its delayed RPC response reaches the extension.
          if (name === 'vscode.setEditorLayout') {
            const response = nextLayoutResponse
            nextLayoutResponse = undefined
            if (response) {
              response.entered()
              await response.wait
            }
          }
          if (name === 'workbench.action.evenEditorWidths')
            editorLayout = structuredClone(settledLayout)
        },
      },
      StatusBarAlignment: { Right: 2 },
      window: {
        createStatusBarItem: () => saveStatus,
        state: windowState,
        onDidChangeWindowState: (
          callback: (state: typeof windowState) => void,
        ) => {
          windowListeners.add(callback)
          return {
            dispose(): void {
              windowListeners.delete(callback)
            },
          }
        },
        get activeTextEditor() {
          return focusedSourceEditor()
        },
        showQuickPick: async () => undefined,
        showWarningMessage: (
          title: string,
          options: unknown,
          ...items: string[]
        ) => {
          warningDialogs.push({ title, options, items })
          return answerWarningDialog(items)
        },
        showInformationMessage: (message: string, ...items: string[]) => {
          informationMessages.push({ message, items })
          return answerInformationMessage(items)
        },
        createTextEditorDecorationType: disposable,
        createTreeView: (
          _id: string,
          options: { treeDataProvider: { getTreeItem: typeof outlineItem } },
        ) => {
          outlineItem = options.treeDataProvider.getTreeItem
          return outline
        },
        registerWebviewViewProvider: (
          id: string,
          provider: typeof summaryProvider,
        ) => {
          if (id === 'codebook.observedMoments')
            playbackPanelProvider = provider
          if (id === 'codebook.learningSummary') {
            summaryProvider = provider
            summaryResolved = false
            summaryListeners.clear()
            summaryVisibilityListeners.clear()
          }
          return disposable()
        },
        onDidChangeActiveTextEditor: (
          callback: typeof activeTextEditorChanged,
        ) => {
          activeEditorListeners.add(callback)
          return {
            dispose(): void {
              activeEditorListeners.delete(callback)
            },
          }
        },
        onDidChangeTextEditorSelection: (callback: () => void) => {
          selectionListeners.add(callback)
          return {
            dispose(): void {
              selectionListeners.delete(callback)
            },
          }
        },
        createWebviewPanel: panel,
        get visibleTextEditors() {
          return visibleSourceEditors.filter(
            (editor) =>
              editor.group.activeTab?.input instanceof TabInputText &&
              editor.group.activeTab.input.uri.toString() ===
                editor.document.uri.toString(),
          )
        },
        showTextDocument: async (
          document: Uri | { uri: Uri; getText(): string },
          options?: {
            viewColumn: number
            preserveFocus?: boolean
            preview?: boolean
            selection?: Range
          },
        ) => {
          const sourceDocument =
            document instanceof Uri
              ? await openSourceDocument(document)
              : document
          sourceColumn =
            options?.viewColumn === undefined
              ? sourceColumn
              : nativeReaderColumn(options.viewColumn)
          const group =
              groups.find(
                (candidate) => candidate.viewColumn === sourceColumn,
              ) ?? groups[0]!,
            tab = group.tabs.find(
              (tab) =>
                tab.input instanceof TabInputText &&
                tab.input.uri.toString() === sourceDocument.uri.toString(),
            ) ?? { input: new TabInputText(sourceDocument.uri) }
          if (!group.tabs.includes(tab)) group.tabs.push(tab)
          revealIntoHiddenEditorArea(
            group.viewColumn,
            group.activeTab !== tab || !options?.preserveFocus,
          )
          const showsAnotherTab = group.activeTab !== tab
          group.activeTab = tab
          if (!options?.preserveFocus) {
            activeTabGroup = group
            innerFocusedPanel = undefined
            if (separateEditorPart) separateEditorPart.focused = false
          }
          if (options?.preview !== undefined) tab.isPreview = options.preview
          const editor = sourceEditor(
            sourceDocument,
            group,
            reportedSourceColumn,
          )
          const previous = visibleSourceEditors.find(
            (value) =>
              value.group === group &&
              value.document.uri.toString() === sourceDocument.uri.toString(),
          )
          // Revealing an existing native document without a selection keeps its learner cursor.
          if (!options?.selection && previous)
            editor.selections = previous.selections
          // An explicit native selection reveals its statement even when playback reopens the same document.
          if (options?.selection) {
            editor.selections = [
              {
                active: options.selection.start,
                anchor: options.selection.start,
              },
            ]
            scrollReadingRange(options.selection)
          }
          // Native wrappers share selection state, while the deliberate stale-column control keeps its returned wrapper separate.
          const previousIndex = visibleSourceEditors.findIndex(
            (value) =>
              value.group === group &&
              value.document.uri.toString() === sourceDocument.uri.toString(),
          )
          if (previousIndex >= 0) visibleSourceEditors.splice(previousIndex, 1)
          const visible = Object.assign(sourceEditor(sourceDocument, group), {
            group,
          })
          Object.defineProperty(visible, 'selections', {
            get: () => editor.selections,
            set: (selections: SourceEditor['selections']) => {
              editor.selections = selections
              for (const listener of selectionListeners) listener()
            },
          })
          visibleSourceEditors.push(visible)
          // A tab that opened or became the one its group shows changed the tabs; the same tab shown again did not.
          if (showsAnotherTab) replaceGroupObjects()
          if (!options?.preserveFocus)
            activeTextEditorChanged(focusedSourceEditor())
          const displayed = nextSourceDisplay
          nextSourceDisplay = undefined
          displayed?.(editor)
          return (lastSourceEditor = editor)
        },
        tabGroups: {
          all: groups,
          get activeTabGroup() {
            return activeTabGroup
          },
          onDidChangeTabs: (callback: (event: TabChanges) => void) => {
            const notify = (
              event: TabChanges = { opened: [], closed: [], changed: [] },
            ): void => callback(event)
            tabChangeListeners.add(notify)
            return {
              dispose(): void {
                tabChangeListeners.delete(notify)
              },
            }
          },
          onDidChangeTabGroups: (callback: typeof changedGroups) => {
            groupChangeListeners.add(callback)
            return {
              dispose(): void {
                groupChangeListeners.delete(callback)
              },
            }
          },
          close: async (tabs: Tab[]) => {
            tabCloseRequests.push([...tabs])
            if (rejectNextTabClose) {
              rejectNextTabClose = false
              throw new Error('Canceled')
            }
            return closeTabs(tabs)
          },
        },
      },
      debug: {
        // No test of this harness pauses a native debug session; the Application pane then always preserves the keyboard focus when it is revealed.
        activeStackItem: undefined,
      },
      workspace: {
        getConfiguration: (section: string) => ({
          get: (key: string) =>
            section === 'codebook' && key === 'savedStudyLimit'
              ? savedStudyCapacity
              : undefined,
        }),
        fs: {
          // Models the editor's Trash: the path leaves the library and stays recoverable outside it.
          delete: async (uri: Uri, options: unknown): Promise<void> => {
            const held = heldTrashMove
            heldTrashMove = undefined
            held?.entered()
            await held?.wait
            await beforeTrashMove(uri.fsPath)
            if (rejectsTrashMove(uri.fsPath))
              throw new Error(`Trash refused ${basename(uri.fsPath)}`)
            trashMoves.push({ path: uri.fsPath, options })
            const trash = join(harness.directory, 'trash')
            await mkdir(trash, { recursive: true })
            await rename(
              uri.fsPath,
              join(trash, `${trashMoves.length}-${basename(uri.fsPath)}`),
            )
          },
        },
        textDocuments,
        registerTextDocumentContentProvider: (
          _scheme: string,
          provider: { provideTextDocumentContent(uri: Uri): Promise<string> },
        ) => {
          sourceProvider = provider.provideTextDocumentContent
          return disposable()
        },
        openTextDocument: openSourceDocument,
        onDidChangeTextDocument: disposable,
        createFileSystemWatcher: (pattern: RelativePattern) => {
          watchedPatterns.push(pattern)
          return watcher
        },
      },
    },
    './environment': { requireWorkspace: () => harness.directory },
    './runtimeSupport/browserViewport': { BrowserViewport: WorkspaceViewport },
    './replayDebugger': { ReplayDebugger: TestReplayDebugger },
  }
  const boundary = await loadModule<typeof StudyWorkspaceModule>(
    resolve(__dirname, '../studyWorkspace.js'),
    editorDependencies,
  )
  const repositoryBoundary = await loadModule<typeof RepositoryReaderModule>(
    resolve(__dirname, '../repositoryReader.js'),
    editorDependencies,
  )
  const articleOpens: RepositorySelection[] = [],
    articleReturns: RepositorySelection[] = []
  const controls = {
    start: async () => harness.service,
    connect: async (): Promise<void> => {},
    returnToRepository: async (
      selection: RepositorySelection,
    ): Promise<void> => {
      articleReturns.push(selection)
    },
    openArticle: async (selection: RepositorySelection): Promise<void> => {
      articleOpens.push(selection)
    },
    // The Wiki reader owns a panel exactly while a Repository Wiki tab that no earlier host left behind is in the window.
    repositoryWikiOpen: (): boolean =>
      groups.some((group) =>
        group.tabs.some(
          (tab) =>
            tab.input instanceof TabInputWebview &&
            tab.input.viewType.endsWith('codebook.repositoryWiki') &&
            !deadPaneTabs.has(tab),
        ),
      ),
  }
  const presentationPreferences = new Map<string, unknown>()
  let preferenceFailure = false
  let nextPreference: { wait: Promise<void>; entered(): void } | undefined
  const workspaceState = {
    get: <Value>(key: string) =>
      presentationPreferences.get(key) as Value | undefined,
    update: async (key: string, value: unknown): Promise<void> => {
      const held = nextPreference
      nextPreference = undefined
      held?.entered()
      await held?.wait
      if (preferenceFailure) throw new Error('Injected preference failure')
      presentationPreferences.set(key, structuredClone(value))
    },
  }
  const createReader = (extensionPath = join(harness.directory, 'extension')) =>
    new boundary.StudyWorkspace(
      {
        extensionPath,
        globalStorageUri: { fsPath: join(harness.directory, 'storage') },
        subscriptions: [],
        workspaceState,
      },
      controls,
    )
  const reader = createReader()
  if (attach) {
    await reader.attach(harness.service)
    await reader.action('return-current')
  }
  return {
    ...harness,
    playbackPanel,
    playbackPanelMessages,
    hidePlaybackPanel(): void {
      playbackPanel.visible = false
      for (const listener of playbackPanelVisibilityListeners) listener()
    },
    disposePlaybackPanel(): void {
      for (const listener of playbackPanelDisposeListeners) listener()
    },
    receivePlaybackPanel(message: unknown): void {
      for (const listener of playbackPanelListeners) listener(message)
    },
    async resolveRestoredObservedMoments(): Promise<void> {
      assert.ok(playbackPanelProvider)
      await playbackPanelProvider.resolveWebviewView(playbackPanel)
    },
    summary,
    hideSummary(): void {
      summary.visible = false
      for (const listener of summaryVisibilityListeners) listener()
    },
    setSavedStudyCapacity(value: unknown): void {
      savedStudyCapacity = value
    },
    /** Every native warning dialog the reader opened, with its title, options and buttons. @example harness.warningDialogs[0].title */
    warningDialogs,
    /** Every native information message the reader showed, with its buttons. @example harness.informationMessages[0].message */
    informationMessages,
    /** Decides how the learner answers the reader's next information messages; unanswered ones are dismissed. @example harness.answerInformationMessages(async ([move]) => move) */
    answerInformationMessages(
      answer: (items: string[]) => Promise<string | undefined>,
    ): void {
      answerInformationMessage = answer
    },
    /** Names the editor the reader runs in, as `vscode.env.appName` reports it. @example harness.useHostAppName('Cursor') */
    useHostAppName(name: string): void {
      hostAppName = name
    },
    /** Models a host that does not register the named native commands: `getCommands` omits them and running one fails as the editor does. @example harness.removeHostCommands('workbench.debug.action.focusVariablesView') */
    removeHostCommands(...names: string[]): void {
      for (const name of names) absentHostCommands.add(name)
    },
    /**
     * Models the host's own Variables view missing the presented stop, so Show Variables meets it as the editor leaves it.
     * @param hiding - How the view missed the stop; each kind loads the stop differently once the focus command shows the view.
     * @example harness.hideNativeVariables('never-opened')
     */
    hideNativeVariables(hiding: NativeVariablesHiding): void {
      nativeVariables.hiding = hiding
      nativeVariables.scopesRetrieved = false
      nativeVariables.treeHoldsStop = false
      nativeVariables.firstScopeFocused = false
      nativeVariables.valuesListed = false
    },
    /** What the fake host's Variables view shows of the presented stop. @example harness.nativeVariablesView() // => { firstScopeFocused: true, valuesListed: true } */
    nativeVariablesView(): {
      firstScopeFocused: boolean
      valuesListed: boolean
    } {
      return {
        firstScopeFocused: nativeVariables.firstScopeFocused,
        valuesListed: nativeVariables.valuesListed,
      }
    },
    /** Decides how the learner answers the reader's next native warning dialogs; unanswered dialogs are dismissed. @example harness.answerWarningDialogs(async ([confirm]) => confirm) */
    answerWarningDialogs(
      answer: (items: string[]) => Promise<string | undefined>,
    ): void {
      answerWarningDialog = answer
    },
    /** Every path the reader moved to the editor's Trash, with the options it passed. @example harness.trashMoves.map((move) => move.path) */
    trashMoves,
    /** Makes the editor's Trash refuse the moves a test names. @example harness.rejectTrashMoves((path) => path.endsWith('.study.v3.json')) */
    rejectTrashMoves(rejects: (path: string) => boolean): void {
      rejectsTrashMove = rejects
    },
    /** Runs a test's step right before each Trash move is carried out or refused, so a test can change the storage while a removal is moving files. @example harness.beforeTrashMoves(async (path) => { if (path.endsWith('.study.v3.json')) await rm(lockPath) }) */
    beforeTrashMoves(step: (path: string) => Promise<void>): void {
      beforeTrashMove = step
    },
    /** Holds the editor's next Trash move until the test releases it, so a test can act while a removal is moving files. @example const held = harness.holdTrashMove(); await held.started; held.release() */
    holdTrashMove() {
      let entered!: () => void, release!: () => void
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      heldTrashMove = { wait, entered }
      return { started, release }
    },
    saveStatus,
    reader,
    createReader,
    groups,
    controls,
    outline,
    commands,
    articleOpens,
    articleReturns,
    receiveContext: (message: unknown): void =>
      receivers.get('codebook.studyContext')!(message),
    receive: (message: unknown): void => {
      if (reader.inspect().view?.contentTab === 'recording') {
        for (const listener of summaryListeners) listener(message)
      } else receivers.get('codebook.studyContext')!(message)
    },
    counts: () => ({ panels: panels.size, outlineUpdates }),
    peakPanels: () => peakPanels,
    /** Lists the tabs of every close request the reader sent to the editor, accepted or refused, so a test can assert which tabs it asked to close. @example harness.tabCloseRequests().flat().includes(deadApplication) */
    tabCloseRequests: () => tabCloseRequests.map((tabs) => [...tabs]),
    onNextPanel(
      kind: string,
      run: (value: ReturnType<typeof panel>) => void,
    ): void {
      nextPanelCreated = { kind, run }
    },
    failNextPanelCreation(kind: string): void {
      failedPanelKind = kind
    },
    changed: (): void => changed(),
    retainReadingRange(first: number, last: number): void {
      retainedReadingRange = new Range(
        new Position(first, 0),
        new Position(last, 0),
      )
    },
    /** Models a learner selecting source during native placement, letting preservation tests inspect the retained cursor. @example harness.changeFocusedSourceSelection(46).selections[0].active.line // 46 */
    changeFocusedSourceSelection(line: number) {
      const editor = lastSourceEditor
      assert.ok(editor)
      const selection = [
        { anchor: new Position(line, 0), active: new Position(line, 0) },
      ]
      editor.selections = selection
      // Native wrappers for the same visible document share the changed selection.
      for (const visible of visibleSourceEditors)
        if (
          visible.group === activeTabGroup &&
          visible.document.uri.toString() === editor.document.uri.toString()
        )
          visible.selections = selection
      return editor
    },
    isReadingLineVisible(line: number) {
      return retainedReadingRange?.contains(new Position(line, 0))
    },
    outlineItem: (itemId: string) => outlineItem(itemId),
    changeOutlineCheckbox: (itemId: string, checked: boolean): void =>
      outlineCheckbox({ items: [[itemId, checked ? 1 : 0]] }),
    postedMessages: () => postedMessages,
    /** Lists the reader's replies to open requests in the order the webviews received them, so a test can assert which pane was answered and when. @example harness.openRequestReplies() // => [{ webview: 'context', openRequest: 3 }] */
    openRequestReplies: () => openRequestReplies.map((reply) => ({ ...reply })),
    presentationPreferences,
    watchedPatterns,
    viewportEvents,
    viewportInstances,
    nativePanels: () => [...panels],
    maximizedEditorGroup: () => maximizedEditorGroup,
    historicalDebugPresentations,
    historicalDebuggers,
    historicalDebugInvalidations: () => historicalDebugInvalidations,
    readCapturedSource: (uri: string) => {
      const parsed = new URL(uri)
      return sourceProvider(
        new Uri(
          parsed.protocol.slice(0, -1),
          parsed.host,
          parsed.pathname,
          parsed.search,
          parsed.hash,
        ),
      )
    },
    holdPresentationMessage(mode?: 'living-book') {
      let entered!: () => void, release!: () => void
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const wait = new Promise<void>((resolve) => {
        release = resolve
      })
      heldPresentationMessage = { mode, wait, entered }
      return { started, release }
    },
    failPresentationPreference(value: boolean): void {
      preferenceFailure = value
    },
    holdPresentationPreference() {
      let entered!: () => void, release!: () => void
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const wait = new Promise<void>((resolve) => {
        release = resolve
      })
      nextPreference = { wait, entered }
      return { started, release }
    },
    clock(value: number): void {
      clock = value
    },
    acknowledgeContext(): void {
      automaticContextReceipt = true
    },
    displayedImage: () => displayedImage,
    coverSourceWhenContextFocused(): void {
      contextCoversSource = true
    },
    panelColumn: (kind: string) =>
      [...panels].find((panel) => panel.kind === kind)?.viewColumn,
    displayedSourceText: (path: string) =>
      visibleSourceEditors
        .find((editor) => editor.document.uri.fsPath === path)
        ?.document.getText(),
    panelReveals: () => [...panelReveals],
    suppressNativeInnerFocus(): void {
      suppressNativeInnerFocus = true
      innerFocusedPanel = undefined
    },
    /** Separates native tab focus from its panel notification for presentation ownership tests. @example const held = harness.holdPanelActivity('codebook.scopedBrowser'); await held.started; held.release(); */
    holdPanelActivity(kind: string) {
      let entered!: () => void, release!: () => void
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      nextPanelActivity = { kind, wait, entered }
      return { started, release }
    },
    /** Delivers Cursor's delayed source deactivation after a handoff reads the stale receipt. @example const held = harness.holdTextFocusClear('codebook.studyContext'); await held.observed; held.release(); */
    holdTextFocusClear(kind: string) {
      let inspected!: () => void, release!: () => void
      const observed = new Promise<void>((resolve) => {
          inspected = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      nextTextFocusClear = { kind, wait, observed: inspected }
      return { observed, release }
    },
    innerFocusedPanel: () => innerFocusedPanel,
    changeWindowFocus(focused: boolean): void {
      windowState.focused = focused
      for (const listener of windowListeners) listener(windowState)
    },
    windowFocusListeners: () => windowListeners.size,
    delayPanelRegistration(kind: string, deferred = false) {
      delayedPanelKind = kind
      deferredPanelRegistration = deferred
      asynchronousLayoutReads ||= deferred
      return (): void => registerDelayedPanel()
    },
    deferPanelFocus(kind: string, reveal: number): void {
      deferredPanelFocus = { kind, remaining: reveal }
      asynchronousLayoutReads = true
    },
    deferPrimaryFocusEcho(): void {
      deferPrimaryFocusEcho = true
      asynchronousLayoutReads = true
    },
    deferMovedFocusEcho(): void {
      deferMovedFocusEcho = true
      asynchronousLayoutReads = true
    },
    deferKeptFocusEcho(): void {
      deferKeptFocusEcho = true
      asynchronousLayoutReads = true
    },
    deferMovedPanelPlacement(kind: string): void {
      deferredMovedPanelPlacement = kind
      asynchronousLayoutReads = true
    },
    focusedPanel: () =>
      activeTabGroup.activeTab?.input instanceof TabInputWebview
        ? activeTabGroup.activeTab.input.viewType
        : undefined,
    /** Opens a modeled webview tab in the requested group so cold entry can preserve chat-like focus. @example const wiki = harness.openWiki(1); */
    openWiki(column = 2) {
      const wiki = panel('codebook.repositoryWiki', 'Repository Wiki', {
        viewColumn: column,
        preserveFocus: true,
      })
      wiki.reveal(undefined, false)
      return wiki
    },
    /** Emits a tab-only learner change so registration tests cannot rely on a text-editor notification. @example harness.focusExistingWebviewTab(wiki.nativeTab); */
    focusExistingWebviewTab(tab: Tab): void {
      const group = groups.find((group) => group.tabs.includes(tab))
      assert.ok(group)
      assert.ok(tab.input instanceof TabInputWebview)
      group.activeTab = tab
      activeTabGroup = group
      for (const listener of tabChangeListeners) listener()
    },
    /** Emits real close/open membership changes so cold-focus tests distinguish replacement from wrapper refresh. @example harness.replaceActiveWebviewTab(); */
    replaceActiveWebviewTab() {
      const previous = activeTabGroup.activeTab
      assert.ok(previous?.input instanceof TabInputWebview)
      const replacement = {
        ...previous,
        input: new TabInputWebview(previous.input.viewType),
      }
      activeTabGroup.tabs = activeTabGroup.tabs.map((tab) =>
        tab === previous ? replacement : tab,
      )
      activeTabGroup.activeTab = replacement
      for (const listener of tabChangeListeners)
        listener({ opened: [replacement], closed: [previous], changed: [] })
      return replacement
    },
    focusedSource: focusedSourceEditor,
    focusListenerCount: () =>
      activeEditorListeners.size +
      selectionListeners.size +
      tabChangeListeners.size +
      groupChangeListeners.size +
      [...panels].reduce(
        (count, panel) => count + panel.viewListenerCount(),
        0,
      ),
    retainRepositoryFocus:
      repositoryBoundary.RepositoryReader.prototype['retainNativeFocus'],
    /** Splits a native primary-focus handoff across actual event surfaces for cold Wiki integration tests. @example harness.usePrimaryFocusNotificationOrder('group first') */
    usePrimaryFocusNotificationOrder(
      order: typeof primaryNotificationOrder,
    ): void {
      primaryNotificationOrder = order
    },
    /** Models early panel notifications followed by same-group tab departure/reentry during a held response. @example harness.roundtripExistingPanelTab('codebook.studyContext', draft); */
    roundtripExistingPanelTab(kind: string, tab: Tab): void {
      const panel = [...panels].find((candidate) => candidate.kind === kind)
      assert.ok(panel)
      const group = groups.find((candidate) =>
        candidate.tabs.includes(panel.nativeTab),
      )
      assert.ok(group)
      assert.ok(group.tabs.includes(tab))
      panel.notifyViewState()
      group.activeTab = tab
      for (const listener of tabChangeListeners) listener()
      group.activeTab = panel.nativeTab
      for (const listener of tabChangeListeners) listener()
      panel.notifyViewState()
    },
    /** Models a learner returning to an existing source during a held presentation response. @example harness.focusExistingSource(source); */
    focusExistingSource(editor: SourceEditor): void {
      const group = groups.find((candidate) =>
        candidate.tabs.some(
          (tab) =>
            tab.input instanceof TabInputText &&
            tab.input.uri.toString() === editor.document.uri.toString(),
        ),
      )
      assert.ok(group)
      group.activeTab = group.tabs.find(
        (tab) =>
          tab.input instanceof TabInputText &&
          tab.input.uri.toString() === editor.document.uri.toString(),
      )
      activeTabGroup = group
      innerFocusedPanel = undefined
      activeTextEditorChanged(editor)
      changedGroups({ opened: [], closed: [], changed: [group] })
    },
    movePanel(kind: string, column: number): void {
      const panel = [...panels].find((panel) => panel.kind === kind)
      assert.ok(panel)
      panel.reveal(column)
    },
    /** Mirrors a native group reorder including each contained panel's new column, before an explicit Arrange request. @example harness.swapEditorGroups(sourceGroup, contextGroup) */
    swapEditorGroups(
      first: typeof activeTabGroup,
      second: typeof activeTabGroup,
    ): void {
      ;[first.viewColumn, second.viewColumn] = [
        second.viewColumn,
        first.viewColumn,
      ]
      for (const panel of panels)
        panel.viewColumn = groups.find((group) =>
          group.tabs.includes(panel.nativeTab),
        )?.viewColumn
      changedGroups({ opened: [], closed: [], changed: [first, second] })
    },
    sourceColumn: () => sourceColumn,
    restoreSourceFocusOnArrange(): void {
      sourceFocusOnArrange = lastSourceEditor
    },
    reportSourceEditorInColumn(column: number): void {
      reportedSourceColumn = column
    },
    invalidateNextSourceRender(): void {
      nextSourceDisplay = (): void => {
        reader['revision']++
      }
    },
    failCurrentSourceOpen(): void {
      sourceOpenFailure = true
    },
    restoreCurrentSourceOpen(): void {
      sourceOpenFailure = false
    },
    abortAfterNextSourceDisplay(cancellation: AbortController): void {
      nextSourceDisplay = (): void => cancellation.abort()
    },
    clearDecorations(): void {
      decoratedColumns.length = 0
    },
    decoratedColumns: () => [...decoratedColumns],
    moveSource(column: number): void {
      const editor = lastSourceEditor
      assert.ok(editor)
      const matchesSource = (tab: Tab) =>
        tab.input instanceof TabInputText &&
        tab.input.uri.toString() === editor.document.uri.toString()
      const previous =
          groups.find(
            (group) =>
              group.viewColumn === sourceColumn &&
              group.tabs.some(matchesSource),
          ) ?? groups.find((group) => group.tabs.some(matchesSource))!,
        destination = groups.find((group) => group.viewColumn === column)!
      const tab = previous.tabs.find(matchesSource)!
      previous.tabs = previous.tabs.filter((candidate) => candidate !== tab)
      if (previous.activeTab === tab) previous.activeTab = undefined
      destination.tabs.push(tab)
      destination.activeTab = tab
      activeTabGroup = destination
      sourceColumn = column
      lastSourceEditor = {
        ...editor,
        get viewColumn() {
          return destination.viewColumn
        },
      }
      activeTextEditorChanged(lastSourceEditor)
    },
    editorLayout: () => structuredClone(editorLayout),
    changeEditorLayout(layout: unknown): void {
      explicitEditorLayout = true
      editorLayout = structuredClone(layout)
    },
    flattenOnNextPanelMove(layout: unknown): void {
      nextMovedPanelLayout = structuredClone(layout)
    },
    closeEmptyGroupsAfterPanelMove(): void {
      closeEmptyGroupsOnMove = true
    },
    /** The fake editor the reader runs in, so a test can act on it as the learner or another extension does: run a native command, create a panel, show a document or close a tab. @example await harness.editor.commands.executeCommand('workbench.action.focusFirstEditorGroup') */
    editor: editorDependencies.vscode,
    /**
     * Maximizes the bottom panel as its title bar's "Maximize Panel Size" does: the editor area is hidden until the learner restores the panel or the editor brings the area back itself.
     * While hidden, the fake editor reports every stacked group at its minimum height (70 px) and expands a group an editor is revealed in. It brings the area back, as VS Code 1.140 does, for a reveal or a shown document that changes a group's visible editor, a created webview panel, a focus-group command, `vscode.setEditorLayout`, a close of the tab a group shows and the Close Editor command; without a layout of its own the area returns with the first of two stacked groups 70 px high.
     * @example harness.maximizePanel()
     */
    maximizePanel(): void {
      panelMaximized = true
    },
    /** Restores the bottom panel to its normal height, as the learner does with "Restore Panel Size"; the editor area returns with the group sizes it had. @example harness.restorePanel() */
    restorePanel(): void {
      panelMaximized = false
    },
    isPanelMaximized: (): boolean => panelMaximized,
    /** The height of one editor group in a fake editor area of 840 px, by view column. @example harness.groupHeightPx(1) // 420 */
    groupHeightPx,
    /**
     * Makes the fake editor close a disposed panel's tab one task after it answered the next layout read, and then remove the group that tab left empty, as a busy VS Code 1.140 window does: its group view closes disposed editors from a worker with a 0 ms delay, so a layout read that arrived with the disposal is answered first, and `workbench.editor.closeEmptyGroups` is on by default.
     * Without it the tab leaves at once and the emptied group stays, which is the editor with `closeEmptyGroups` off.
     * @example harness.closeDisposedPanelTabsLater()
     */
    closeDisposedPanelTabsLater(): void {
      closeDisposedPanelTabsLater = true
    },
    automaticallyClosedColumns: () => [...automaticallyClosedColumns],
    useCursorGroupWrappers(twoEventContraction = false): void {
      cursorGroupWrappers = true
      cursorTwoEventContraction = twoEventContraction
    },
    /**
     * Makes the fake editor answer every tab change the way Cursor 3.23.12 does: whenever a tab opened, another tab of a group became active, a tab closed, or a group opened or closed, every TabGroup object is replaced by a new one in the same view column and all groups are reported as changed (obs13 items 7 and 8). A focus move between groups keeps the objects, as it does there.
     * Off by default, which is VS Code: its group objects live as long as their groups. The Tab objects are kept in both modes.
     * @example harness.replaceGroupObjectsOnTabChanges()
     */
    replaceGroupObjectsOnTabChanges(): void {
      replacesGroupObjectsOnTabChanges = true
    },
    useNativeLayout(layout: unknown): void {
      nativeLayout = true
      separateEditorPart = undefined
      const previous = [...groups]
      groups.splice(0)
      editorLayout = structuredClone(layout)
      for (let column = 1; column <= nativeGroupCount(layout); column++)
        nativeGroup(column, true)
      groups[0]!.tabs.push({
        input: new TabInputText(
          Uri.file(join(harness.directory, 'article-source.ts')),
        ),
      })
      groups[1]?.tabs.push({
        input: new TabInputWebview('codebook.repositoryWiki'),
      })
      activeTabGroup = groups[0]!
      activeTabGroup.activeTab = activeTabGroup.tabs[0]
      changedGroups({ opened: [...groups], closed: previous, changed: [] })
    },
    constrainStudyGrid(): void {
      constrainStudyGrid = true
    },
    hideGridWhileMaximized(): void {
      hideGridWhileMaximized = true
    },
    /** Adds a real separate-part boundary without changing the main leaf count, matching the recorded Cursor probe. @example const chat = harness.addSeparateEditorPart(); chat.focus(); */
    addSeparateEditorPart() {
      assert.equal(nativeLayout, true)
      assert.equal(separateEditorPart, undefined)
      const chatTab = {
        input: new TabInputUnknown(),
        label: 'New Agent',
        isPreview: false,
        isDirty: false,
      }
      const group = {
        viewColumn: groups.length + 1,
        tabs: [chatTab],
        activeTab: chatTab,
      }
      separateEditorPart = {
        group,
        layout: { orientation: 1, groups: [{ size: 743 }] },
        focused: false,
      }
      groups.push(group)
      changedGroups({ opened: [group], closed: [], changed: [] })
      return {
        tab: chatTab,
        layout: () => structuredClone(separateEditorPart?.layout),
        focused: () => separateEditorPart?.focused,
        focus(): void {
          separateEditorPart!.focused = true
          activeTextEditorChanged(undefined)
        },
        /** Gives the chat tab the keyboard focus the way Cursor reports it: its group is the active tab group, no text editor is active, and a layout read is answered for the chat's own part. @example chat.focusTab() */
        focusTab(): void {
          const previous = activeTabGroup
          activeTabGroup = separateEditorPart!.group
          separateEditorPart!.focused = true
          innerFocusedPanel = undefined
          changedGroups({
            opened: [],
            closed: [],
            changed: [previous, activeTabGroup],
          })
          activeTextEditorChanged(undefined)
        },
        /** Refreshes only the foreign wrapper when presentation tests create a pane; lifecycle and movement remain distinct. @example chat.resync('wrapper') */
        resync(change: 'wrapper' | 'opened' | 'unannounced' | 'move'): void {
          const previous = separateEditorPart!.group,
            replacement = { ...previous, tabs: [...previous.tabs] }
          // The unchanged empty chat part is not a new native group; explicit lifecycle events cannot inherit it.
          if (change === 'move') replacement.viewColumn++
          groups[groups.indexOf(previous)] = replacement
          separateEditorPart!.group = replacement
          changedGroups({
            opened: change === 'opened' ? [replacement] : [],
            closed: change === 'opened' ? [previous] : [],
            changed: change === 'unannounced' ? [] : [replacement],
          })
        },
      }
    },
    reportSeparatePartLayout(layout: unknown): void {
      separatePartLayoutReport = structuredClone(layout)
    },
    showTransientNativeSizes(): void {
      transientLayout = true
    },
    failNextCommand(name: string): void {
      failingCommand = name
    },
    /** Gives presentation/scope regressions a learner-owned document whose edits do not move its tab. @example const draft = harness.focusMutableDraft('notes.txt', 2); draft.replaceContent('new text'); */
    focusMutableDraft(
      filename = 'mutable-notes.txt',
      column = groups[0]!.viewColumn,
    ) {
      let text = 'Original learner draft.\n'
      const document = {
        uri: Uri.file(join(harness.directory, filename)),
        version: 1,
        getText: () => text,
      }
      const group = groups.find((group) => group.viewColumn === column)!
      const tab = {
        input: new TabInputText(document.uri),
        isPreview: false,
        isDirty: true,
      }
      const editor = Object.assign(sourceEditor(document, group), { group })
      let selections = editor.selections
      Object.defineProperty(editor, 'selections', {
        get: () => selections,
        set: (value: typeof selections) => {
          selections = value
          for (const listener of selectionListeners) listener()
        },
      })
      group.tabs.push(tab)
      group.activeTab = tab
      activeTabGroup = group
      visibleSourceEditors.push(editor)
      if (separateEditorPart) separateEditorPart.focused = false
      activeTextEditorChanged(editor)
      return {
        document,
        tab,
        editor,
        replaceContent(value: string): void {
          text = value
          document.version++
        },
        focus(): void {
          group.activeTab = tab
          activeTabGroup = group
          if (separateEditorPart) separateEditorPart.focused = false
          activeTextEditorChanged(editor)
        },
      }
    },
    /** Leaves a captured-source tab in a group as the host restores one after a restart: a text tab without a text editor. `textEditor` gives it a live editor instead, as a first open that failed leaves this host's own tab; `staleTextEditor` lets the editor report its document for a moment after the tab closed. @example const leftover = harness.restoreLeftoverCapturedSource(); harness.restoreLeftoverCapturedSource({ active: false, authority: 'f'.repeat(64) }) */
    restoreLeftoverCapturedSource(
      options: {
        active?: boolean
        authority?: string
        column?: number
        refuseClose?: boolean
        lateTextEditor?: boolean
        staleTextEditor?: boolean
        textEditor?: boolean
      } = {},
    ) {
      const group = groups.find(
        (group) =>
          group.viewColumn === (options.column ?? groups[0]!.viewColumn),
      )!
      const document = {
        uri: Uri.from({
          scheme: 'codebook-source',
          authority:
            options.authority ?? sha256(realpathSync(harness.directory)),
          path: '/earlier-study/repository%2Finterface%2Ftheme/hash/Captured-login-form.tsx',
        }),
        version: 1,
        getText: () => 'Captured source of an earlier study.\n',
      }
      const tab: Tab = {
        input: new TabInputText(document.uri),
        isPreview: false,
        isDirty: false,
      }
      if (options.authority === undefined) leftoverCapturedTabs.add(tab)
      if (options.refuseClose) closeRefusingTabs.add(tab)
      lateEditorAfterLeftoverClose = Boolean(options.lateTextEditor)
      const editor = Object.assign(sourceEditor(document, group), { group })
      staleEditorAfterLeftoverClose = options.staleTextEditor
        ? editor
        : undefined
      if (options.textEditor) visibleSourceEditors.push(editor)
      group.tabs.push(tab)
      if (options.active ?? true) {
        group.activeTab = tab
        activeTabGroup = group
        activeTextEditorChanged(focusedSourceEditor())
      }
      return tab
    },
    /** Leaves a Codebook pane tab without a panel in a group, as an extension-host restart leaves the old host's panes: the tab model lists it under the main-thread view type and this host owns no panel for it. @example const deadApplication = harness.leaveDeadCodebookPane('codebook.scopedBrowser', 1); harness.leaveDeadCodebookPane('codebook.studyContext', 3, { focused: true, refuseClose: true }) */
    leaveDeadCodebookPane(
      kind:
        | 'codebook.scopedBrowser'
        | 'codebook.studyContext'
        | 'codebook.repositoryWiki',
      column: number,
      options: { focused?: boolean; refuseClose?: boolean } = {},
    ) {
      const group = groups.find((group) => group.viewColumn === column)
      assert.ok(group)
      const tab: Tab = {
        input: new TabInputWebview(`mainThreadWebview-${kind}`),
        label: {
          'codebook.scopedBrowser': 'codebook · Application',
          'codebook.studyContext': 'codebook · Study',
          'codebook.repositoryWiki': 'codebook · Repository Wiki',
        }[kind],
        isPreview: false,
        isDirty: false,
      }
      deadPaneTabs.add(tab)
      if (options.refuseClose) closeRefusingTabs.add(tab)
      group.tabs.push(tab)
      // The pane was the visible tab of its group when its host ended.
      group.activeTab = tab
      if (options.focused) {
        activeTabGroup = group
        if (separateEditorPart) separateEditorPart.focused = false
        activeTextEditorChanged(focusedSourceEditor())
      }
      return tab
    },
    /** Lets the editor close leftover captured-source tabs again after a refusal test, so the harness can shut its reader down. @example harness.acceptLeftoverClose() */
    acceptLeftoverClose(): void {
      for (const tab of leftoverCapturedTabs) closeRefusingTabs.delete(tab)
    },
    /** Lets the editor close dead Codebook panes again after a refusal, so a test can repeat the request the editor first refused. @example harness.acceptDeadPaneClose() */
    acceptDeadPaneClose(): void {
      for (const tab of deadPaneTabs) closeRefusingTabs.delete(tab)
    },
    /** Makes the editor reject the next close request instead of answering it, as it does when the request is cancelled; no tab closes. @example harness.rejectNextTabClose() */
    rejectNextTabClose(): void {
      rejectNextTabClose = true
    },
    /** Gives focus to a non-text page of the editor that is already open, as a learner's click on its tab does. @example harness.focusOpaqueTab(harness.addOpaqueTab('Extension page', 2)) */
    focusOpaqueTab(tab: Tab): void {
      const group = groups.find((group) => group.tabs.includes(tab))
      assert.ok(group)
      group.activeTab = tab
      activeTabGroup = group
      if (separateEditorPart) separateEditorPart.focused = false
      for (const listener of tabChangeListeners) listener()
      activeTextEditorChanged(focusedSourceEditor())
    },
    useOpaquePrimary(kind: 'blank' | 'settings') {
      const group = groups.find((group) => group.viewColumn === 1)!
      const tab =
        kind === 'settings'
          ? {
              input: new TabInputUnknown(),
              label: 'Settings',
              isPreview: false,
              isDirty: false,
            }
          : undefined
      group.tabs = tab ? [tab] : []
      group.activeTab = tab
      return tab
    },
    changeAfterNextSourceDisplay(change: (editor: SourceEditor) => void): void {
      nextSourceDisplay = change
    },
    changeAfterNextReadingReveal(change: () => void): void {
      nextReadingReveal = change
    },
    addForeignDraft(column = groups[0]!.viewColumn) {
      const tab = {
        input: new TabInputText(Uri.file(join(harness.directory, 'notes.txt'))),
        label: 'notes.txt',
        isDirty: true,
      }
      groups.find((group) => group.viewColumn === column)!.tabs.push(tab)
      return tab
    },
    addOpaqueTab(label: string, column: number) {
      const tab = {
        input: new TabInputUnknown(),
        label,
        isPreview: false,
        isDirty: false,
      }
      groups.find((group) => group.viewColumn === column)!.tabs.unshift(tab)
      return tab
    },
    addTextPreview(path: string, column: number, dirty = false) {
      const tab = {
        input: new TabInputText(Uri.file(path)),
        isPreview: true,
        isDirty: dirty,
      }
      groups.find((group) => group.viewColumn === column)!.tabs.push(tab)
      return tab
    },
    addNodeHistoryPreview(
      studyId: string,
      column: number,
      options: { dirty?: boolean; pinned?: boolean } = {},
    ) {
      const uri = Uri.from({
        scheme: 'codebook-source',
        authority: harness.service.nodeHistoryStore!.workspaceKey,
        path: `/node-history/${studyId}/1/hash/Captured-data.ts`,
      })
      const tab = {
        input: new TabInputText(uri),
        isPreview: true,
        isDirty: Boolean(options.dirty),
        isPinned: Boolean(options.pinned),
      }
      groups.find((group) => group.viewColumn === column)!.tabs.push(tab)
      return tab
    },
    resyncEditorGroups(
      change?:
        | 'move'
        | 'replace'
        | 'append'
        | 'unannounced'
        | 'remove'
        | 'reorder'
        | 'empty',
      preserveEmpty = false,
    ): void {
      // Give each fake group a distinct stable input, like the actual singleton panels/native source tabs.
      for (const group of groups)
        if (!group.tabs.length && change !== 'empty' && !preserveEmpty)
          group.tabs.push({
            input: new TabInputText(Uri.file(`/group-${group.viewColumn}`)),
          })
      const previous = [...groups]
      /** Gives a tab the new input wrapper of its own kind that a full tab-model resync reports. @example resyncedInput(new TabInputText(uri)) // => another TabInputText of the same uri */
      const resyncedInput = (input: Tab['input']): Tab['input'] => {
        if (input instanceof TabInputText) return new TabInputText(input.uri)
        if (input instanceof TabInputWebview)
          return new TabInputWebview(input.viewType)
        return new TabInputUnknown()
      }
      groups.splice(
        0,
        groups.length,
        ...groups.map((group) => ({
          ...group,
          tabs: group.tabs.map((tab) => ({
            ...tab,
            label: 'Recorded application',
            input: resyncedInput(tab.input),
          })),
        })),
      )
      // Full-model replacement keeps the same separate part behind its newly reported native wrapper.
      if (separateEditorPart)
        separateEditorPart.group =
          groups[previous.indexOf(separateEditorPart.group)]!
      if (change === 'move') {
        const first = groups[0]!.tabs
        groups[0]!.tabs = groups[1]!.tabs
        groups[1]!.tabs = first
      }
      if (change === 'append')
        groups[0]!.tabs.splice(1, 0, {
          input: new TabInputText(Uri.file('/learner-added-notes.txt')),
        })
      if (change === 'remove') groups[0]!.tabs.pop()
      if (change === 'reorder') groups[0]!.tabs.reverse()
      changedGroups({
        opened: change === 'replace' ? [...groups] : [],
        closed: change === 'replace' ? previous : [],
        changed: change === 'unannounced' ? [] : [...groups],
      })
    },
    /** Models group-wrapper refresh during placement tests while retaining native panel/text ownership. @example harness.replaceEditorGroup('wrapper', 1) */
    replaceEditorGroup(
      change: 'wrapper' | 'opened' | 'unannounced',
      column = activeTabGroup.viewColumn,
      changeTabs?: (tabs: Tab[]) => void,
    ): void {
      const previous = groups.find((group) => group.viewColumn === column)
      assert.ok(previous)
      const replacement = { ...previous, tabs: [...previous.tabs] }
      changeTabs?.(replacement.tabs)
      groups[groups.indexOf(previous)] = replacement
      if (activeTabGroup === previous) activeTabGroup = replacement
      // Text-editor focus survives a wrapper refresh; opened and unannounced groups still require new ownership.
      for (const editor of visibleSourceEditors)
        if (editor.group === previous) editor.group = replacement
      changedGroups({
        opened: change === 'opened' ? [replacement] : [],
        closed: change === 'opened' ? [previous] : [],
        changed: change === 'unannounced' ? [] : [replacement],
      })
    },
    seedPanelTabs(
      kind: 'known' | 'unknown' | 'duplicate' | 'ambiguous' | 'empty',
    ): void {
      for (const group of groups) {
        // Column 1 holds the Application pane and column 2 the Wiki; an ambiguous seed puts the Application pane everywhere.
        let type = 'codebook.studyContext'
        if (kind === 'ambiguous' || group.viewColumn === 1)
          type = 'codebook.scopedBrowser'
        else if (group.viewColumn === 2) type = 'codebook.repositoryWiki'
        const tab = {
          label: 'Application',
          input: new TabInputWebview(
            `${kind === 'unknown' ? 'foreign-' : 'mainThreadWebview-'}${type}`,
          ),
        }
        // An empty seed leaves the group without a tab; a duplicate seed gives it the same pane twice.
        let seededTabs = [tab]
        if (kind === 'empty') seededTabs = []
        else if (kind === 'duplicate') seededTabs = [tab, { ...tab }]
        group.tabs = seededTabs
      }
    },
    holdNextImage() {
      let release = (): void => {},
        entered = (): void => {}
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      nextImage = { wait, entered }
      return { started, release }
    },
    holdNextCommand(name: string) {
      let release = (): void => {},
        entered = (): void => {}
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      nextCommand = { name, wait, entered }
      return { started, release }
    },
    /** Holds only the response after a native split so scope tests can change learner intent. @example const split = harness.holdNextLayoutResponse(); */
    holdNextLayoutResponse() {
      let release = (): void => {},
        entered = (): void => {}
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      nextLayoutResponse = { wait, entered }
      return { started, release }
    },
    /** Lets scope regressions insert learner input after primary focus is applied but before its command response. @example const focus = harness.holdNextPrimaryFocusResponse(); */
    holdNextPrimaryFocusResponse() {
      let release = (): void => {},
        entered = (): void => {}
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      nextPrimaryFocusResponse = { wait, entered }
      return { started, release }
    },
    /** Sets whether later historical presentations report native Run and Debug values as loaded. @example harness.setHistoricalDebugInspection('uninspected') */
    setHistoricalDebugInspection(value: ReplayInspection): void {
      historicalDebugInspection = value
    },
    /** Models the learner expanding Variables: later presentations load values and each owner notifies the workspace once, without a new seek. @example harness.loadHistoricalDebugValues() */
    loadHistoricalDebugValues(): void {
      historicalDebugInspection = 'inspected'
      for (const debuggerView of historicalDebuggers)
        debuggerView.changed('values-loaded')
    },
    /** Models a values-loaded notification whose handling threw, which the real owner reports through its failure callback. @example harness.failHistoricalDebugNotification(new Error('reader closed')) */
    failHistoricalDebugNotification(error: Error): void {
      for (const debuggerView of historicalDebuggers) debuggerView.failed(error)
    },
    /** Models the learner pressing Stop on the owned historical session: it becomes unavailable and tells the workspace the session ended. @example harness.endHistoricalDebugSession() */
    endHistoricalDebugSession(): void {
      for (const debuggerView of historicalDebuggers) {
        if (!debuggerView.available) continue
        debuggerView.available = false
        // Like the real owner, a wait on the ended session fails now instead of at its deadline.
        for (const check of [...nativeVariablesWaiters]) check()
        debuggerView.changed('session-ended')
      }
    },
    /** Keeps the next historical presentation loading until released or rejected, as native Run and Debug does before values load; `recordedStopOnly` skips "Not recorded" gap presentations so the hold lands on the next recorded stop. @example const held = harness.holdHistoricalDebugPresentation(); await held.started; held.reject(new Error('superseded')) */
    holdHistoricalDebugPresentation(recordedStopOnly = false) {
      let release = (): void => {},
        reject = (_error: Error): void => {},
        entered = (): void => {}
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const wait = new Promise<void>((resolve, rejectPromise) => {
        release = resolve
        reject = rejectPromise
      })
      nextHistoricalDebugPresentation = { wait, entered, recordedStopOnly }
      return { started, release, reject }
    },
    /** Keeps the next recorded-application reveal queued until released, as the real viewport does behind a native placement hold; the queued reveal ignores its caller's cancellation until then. `fail` ends it as a renderer that never became ready. @example const held = harness.holdNextRecordingReveal(); await held.started; held.release() */
    holdNextRecordingReveal() {
      let release = (): void => {},
        fail = (_error: Error): void => {},
        entered = (): void => {}
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const wait = new Promise<void>((resolve, reject) => {
        release = resolve
        fail = reject
      })
      nextRecordingReveal = { wait, entered }
      return { started, release, fail }
    },
    /** Keeps the next historical debugger disposal pending until released, as an editor that is slow to stop the owned session does; its registration stays live meanwhile. @example const held = harness.holdHistoricalDebugDisposal(); await held.started; held.release() */
    holdHistoricalDebugDisposal() {
      let release = (): void => {},
        entered = (): void => {}
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const wait = new Promise<void>((resolve) => {
        release = resolve
      })
      nextHistoricalDebugDisposal = { wait, entered }
      return { started, release }
    },
    holdNextSource() {
      let release = (): void => {},
        reject = (_error: Error): void => {},
        entered = (): void => {}
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const wait = new Promise<void>((resolve, rejectPromise) => {
        release = resolve
        reject = rejectPromise
      })
      nextOpen = { wait, entered }
      return { started, release, reject }
    },
    async close(): Promise<void> {
      await reader.retire(harness.service)
      await reader.dispose()
      await harness.close()
    },
  }
}

/** Opens synthetic retained repository evidence for layout tests that need readable source without launching a runtime. @example await openRetainedStudy(harness) */
export async function openRetainedStudy(
  harness: Awaited<ReturnType<typeof workspaceHarness>>,
): Promise<void> {
  const library = await harness.reader.learningStorage()
  const study = {
    ...createConfiguredStudy(),
    workspaceKey: library.workspaceKey,
  }
  await library.saveStudy(study)
  await harness.reader.open()
  harness.receive({
    type: 'history',
    revision: harness.reader.inspect().view!.revision,
    studyId: study.id,
  })
  await waitUntil(
    () =>
      harness.reader.inspect().view!.model.selection.studyId === study.id &&
      !harness.reader.inspect().view!.loading,
    'retained repository source',
    1_000,
  )
}

/** Saves one sealed Node history with output, one verified stop and a passing result for historical debugger recovery tests. @example const history = await saveOneStopNodeHistory(store) */
export async function saveOneStopNodeHistory(store: NodeTestHistoryStore) {
  const history = nodeTestHistoryHeader(store.workspaceKey),
    sourceText = 'const nextTheme = "dark";\n'
  const writer = await store.start(history)
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 100,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts\n',
  })
  await writer.appendStop({
    index: 0,
    runId: 'test-run',
    sessionId: 'test-session',
    threadId: 1,
    elapsedMs: 200,
    worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
    source: history.configuration.source,
    frame: { id: 1, name: 'notifyManager', line: 1, column: 1 },
    variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
    facts: [
      { path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' },
    ],
    debuggerSnapshot: {
      version: 1,
      frames: [
        {
          name: 'notifyManager',
          line: 1,
          column: 1,
          source: {
            name: history.configuration.source.path,
            text: sourceText,
            hash: sha256(sourceText),
            line: 1,
          },
          scopes: [{ name: 'Local', variables: [0] }],
        },
      ],
      variables: [
        { name: 'nextTheme', value: 'dark', type: 'string', children: [] },
      ],
      limitations: [],
    },
  } satisfies NodeTestSourceStop)
  await writer.appendResult(
    { exitCode: 0, signal: null, output: 'Tests 1 passed' },
    300,
  )
  await writer.finish('complete')
  return history
}

/**
 * Creates sealed recording/context before workspace replay/navigation tests open history; runtime values and native paint are synthetic.
 * @param capturedApplication - Also retain a real paused-browser PNG checkpoint.
 * @param recordedDebugger - Attach captured native debugger state to the recorded stop, paused from 100 ms until its 900 ms continuation (recording ends at 1,000 ms), so replay presents it through the historical debugger.
 * @example const harness = await recordedReaderHarness(true, true)
 */
export async function recordedReaderHarness(
  capturedApplication = false,
  recordedDebugger = false,
  /** Column of the declared line at which the debugger bound and captured the stop; another column than the declared 1 gives a moved-column study. Used with `recordedDebugger`. */
  boundColumn = 1,
) {
  const harness = await workspaceHarness(true, true),
    service = harness.service
  service.environment.build.sourceHash = sha256('recorded-build')
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRFEAAAAASUVORK5CYII=',
    'base64',
  )
  // Observation visibility tests retain a real PNG checkpoint while the native renderer remains mocked.
  if (capturedApplication) {
    const createRuntime = service.environment.createRuntime
    service.environment.createRuntime = async (root, definition) => {
      const runtime = await createRuntime(root, definition),
        view = runtime.view.bind(runtime),
        prepare = runtime.prepare.bind(runtime)
      let captures: ConfiguredRuntimeView['captures'] = {}
      // The reader's periodic checkpoints must only ever see the real capture: a confirmed image withdrawn later is history tampering.
      runtime.view = () => ({ ...view(), captures })
      runtime.prepare = async (): Promise<void> => {
        await prepare()
        await writeFile(
          join(runtime.evidence.directory, 'paused-browser.png'),
          png,
        )
        captures = {
          'paused-browser': {
            status: 'captured',
            file: 'paused-browser.png',
            renderer: { epoch: 'test', id: 1, hash: sha256(png) },
          },
        }
      }
      return runtime
    }
  }
  harness.acknowledgeContext()
  harness.service.start({
    instanceId: harness.service.instanceId,
    profile: 'repository-browser',
    configuration: harness.configuration,
    key: randomUUID(),
  })
  const record = [...service.records.values()][0]!
  await record.preparation
  if (recordedDebugger) {
    const runtime = harness.runtimes[0]!,
      action = runtime.action.bind(runtime)
    runtime.action = (key, value) => {
      const operation = action(key, value),
        stop = runtime.snapshots[0]!
      // The run commits a stop where the debugger bound it, and its saved top frame names the same position.
      stop.source = { ...stop.source, column: boundColumn }
      // Captured values reference the stop's own recorded source, as the configured browser run records them.
      stop.debugger = {
        version: 1,
        frames: [
          {
            name: 'applyTheme',
            line: 1,
            column: boundColumn,
            source: {
              name: runtime.definition.configuration.source.path,
              text: stop.source.text,
              hash: stop.source.hash,
              line: 1,
            },
            scopes: [{ name: 'Local', variables: [0] }],
          },
        ],
        variables: [{ name: 'nextTheme', value: 'dark', children: [] }],
        limitations: [],
      }
      return operation
    }
  }
  assert.ok(record.recording)
  record.recording.frame({ bytes: png, elapsedMs: 20, kind: 'stream' })
  harness.clock(100)
  await harness.reader.action('click')
  // The continuation receipt seals the recorded stop's paused interval, long enough for several Play ticks to advance through it.
  if (recordedDebugger) {
    harness.clock(900)
    harness.runtimes[0]!.evidence.record('continue.accepted')
  }
  harness.clock(recordedDebugger ? 1_000 : 200)
  await harness.reader.action('stop')
  const studyId = record.recording.header.studyId,
    directory = harness.reader.inspect().libraryDirectory!
  const store = new RecordingStore(directory, directory.split('/').at(-1)!)
  /** Whether a hold of {@link holdPositionSaves} is active on the reader's store. */
  let positionSavesHeld = false
  return {
    ...harness,
    studyId,
    store,
    record,
    png,
    controller: service.playbackController!,
    /**
     * Holds every playback position save this harness's reader starts from now on behind a storage lock, as a slow disk does, until `release()`.
     * The hold is put on the recording store the reader owns, so the reader of another harness goes on saving.
     * @returns `release` lets the held saves write and restores normal saving; calling it again does nothing.
     * @throws When an earlier hold of this harness is not released yet: two holds on one store could not be released in either order.
     * @example const held = harness.holdPositionSaves(); held.release()
     */
    holdPositionSaves() {
      if (positionSavesHeld)
        throw new Error(
          'Position saves of this workspace harness are already held. Release that hold before holding them again.',
        )
      const readerStore = harness.reader['recordings']
      assert.ok(readerStore, 'The reader has no recording store yet.')
      const savePreference = readerStore.savePreference
      let releaseStorage = (): void => {},
        released = false
      const storageHeld = new Promise<void>((resolve) => {
        releaseStorage = resolve
      })
      positionSavesHeld = true
      readerStore.savePreference = async (preference): Promise<void> => {
        await storageHeld
        return savePreference.call(readerStore, preference)
      }
      return {
        release(): void {
          if (released) return
          released = true
          positionSavesHeld = false
          // The store's own method comes back when the override on this one store is removed.
          Reflect.deleteProperty(readerStore, 'savePreference')
          releaseStorage()
        },
      }
    },
  }
}

/** Connects real Git/book/history/reader code before configured-runtime workspace tests exercise live/replay entry; native paint remains mocked. @example const harness = await configuredWorkspaceHarness() */
export async function configuredWorkspaceHarness(sourceText?: string) {
  const harness = await workspaceHarness(false),
    directory = await realpath(harness.directory),
    library = await harness.reader.learningStorage(),
    study = createConfiguredStudy(sourceText)
  const git = promisify(execFile)
  await git('git', ['init', '--quiet', directory])
  await mkdir(join(directory, 'src'), { recursive: true })
  for (const source of study.descriptor!.sources)
    await writeFile(join(directory, source.path), source.text)
  await git('git', ['add', '--', 'src'], { cwd: directory })
  const books = new RepositoryBookStore(
    new RepositorySourceService(directory),
    library,
  )
  await books.publish({
    bookId: 'interface',
    expectedRevision: 0,
    key: 'configured-reader',
    document: {
      title: 'Interface',
      summary: 'Theme behavior',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [
            { title: 'Theme', text: 'Source-derived theme explanation.' },
          ],
          anchors: study.descriptor!.anchors,
          observations: [],
        },
      ],
      edges: [],
    },
  })
  let clock = 0
  const configuredRuntimes: ControlledConfiguredRuntime[] = []
  harness.service.repository = books
  harness.service.environment.build.sourceHash = sha256(
    'configured-reader-build',
  )
  harness.service.environment.createRuntime = async (root, definition) => {
    if (!definition || typeof definition === 'string')
      throw new Error('Configured reader harness expects a declared article.')
    const runtime = new ControlledConfiguredRuntime(root, definition)
    runtime.evidence.elapsedMs = () => clock
    configuredRuntimes.push(runtime)
    return runtime
  }
  await harness.reader.attach(harness.service)
  harness.acknowledgeContext()
  const start = async () => {
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: 'repository-browser',
      configuration: study.configuration,
      key: randomUUID(),
    })
    const record = harness.service.records.get(receipt.runId)!
    await record.preparation
    assert.equal(record.error, undefined)
    await harness.reader.open()
    await harness.reader.action('return-current')
    return record
  }
  return {
    ...harness,
    directory,
    library,
    books,
    study,
    configuredRuntimes,
    start,
    configuredClock(value: number): void {
      clock = value
    },
    async close(): Promise<void> {
      await books.dispose()
      await harness.close()
    },
  }
}

/** Starts each actual-Return regression from a saved recording and the learner's native two-row article layout; `recordedDebugger` also attaches captured native debugger state to its stop. @example await articleRecordingLayoutHarness() */
export async function articleRecordingLayoutHarness(
  capturedApplication = false,
  recordedDebugger = false,
) {
  const harness = await recordedReaderHarness(
      capturedApplication,
      recordedDebugger,
    ),
    library = await harness.reader.learningStorage()
  try {
    await harness.reader.close()
    harness.useNativeLayout({
      orientation: 1,
      groups: [{ size: 161 }, { size: 162 }],
    })
    const study = await library.readStudy(harness.studyId),
      observation = study.observations[0]!
    const binding: BookObservationBinding = {
      nodeId: 'module',
      linkIndex: 0,
      studyId: study.id,
      observationId: observation.id,
      sourceHash: observation.source.hash,
      itemId: observation.itemId,
      observationHash: bookObservationHash(observation),
      elapsedMs: observation.elapsedMs,
      outcome: study.finalOutcome,
    }
    const origin: RepositorySelection = {
      bookId: 'architecture',
      revision: 1,
      nodeId: 'module',
      anchorIndex: 0,
      location: {
        sectionIndex: 1,
        fraction: 0.65,
        focusId: 'evidence-0-recording',
      },
    }
    await library.selectRepository(origin)
    harness.controls.returnToRepository = async (selection): Promise<void> => {
      await harness.reader.arrangeRepository(
        new AbortController().signal,
        selection,
      )
    }
    return { ...harness, library, binding, origin }
  } catch (error) {
    await harness.close()
    throw error
  }
}

type WorkspaceReader = InstanceType<
  (typeof StudyWorkspaceModule)['StudyWorkspace']
>

/**
 * Gathers in one place what a reader test needs from inside the reader and its playback controller to arrange a race or to wait for an awaited outcome, so the tests themselves name no private member.
 * The webview route ({@link workspaceHarness}'s `receive`) answers nothing to its sender; `receive` here is the same handling, awaited.
 * @param harness - The reader, and its playback controller when the harness has one.
 * @example
 * await readerSeams(harness).receive({ type: 'delete-study', revision, studyId }, 'context')
 * readerSeams(harness).debuggerReplacement = async () => { throw new Error('The historical debugger did not start.') }
 */
export function readerSeams(harness: {
  reader: WorkspaceReader
  controller?: PlaybackController
}) {
  const reader = harness.reader
  return {
    /** Handles one pane message as the webview route does and settles when the reader has handled it. */
    receive: (message: unknown, origin: 'context' | 'moments'): Promise<void> =>
      reader['receive'](message, origin),
    /** Handles one pane message of a given panel through the reply-owing route. */
    receiveFromPanel: (
      message: unknown,
      origin: 'context' | 'moments',
      panel: unknown,
    ): Promise<void> =>
      Reflect.apply(reader['receivePaneMessage'], reader, [
        message,
        origin,
        panel,
      ]),
    /** Runs one reader refresh, as the reader's timer does. */
    refresh: (): Promise<void> => reader['refresh'](),
    /** Leaves the reader without a selected study, as the removal of the last study that could be opened does. */
    selectNoStudy: (): void => reader['selectNoStudy'](),
    /** The reader's error lines, as its panes show them. */
    errorLines: (): string[] => [...reader['errors'].values()],
    /** Counts the study checkpoints that wait to be written. */
    queuedStudyWrites: (): number => reader['pendingArchives'].size,
    /** Says whether the reader holds an error line of one kind. */
    hasErrorOfKind: (kind: ReaderErrorKind): boolean =>
      reader['errors'].has(kind),
    /** Drops the reader's error line of one kind, as the action that retires it does. */
    dropErrorOfKind: (kind: ReaderErrorKind): boolean =>
      reader['errors'].delete(kind),
    isLoading: (): boolean => reader['loading'],
    isRecordingActive: (): boolean => reader['recordingActive'],
    isLiveArrangement: (): boolean => reader['liveComposition'],
    /** Makes one checkpoint of a run, forced as Retry storage and retirement force it. */
    checkpoint: (
      ...input: Parameters<WorkspaceReader['checkpoint']>
    ): Promise<void> => reader['checkpoint'](...input),
    readSavedArchive: (studyId: string) => reader['readSavedArchive'](studyId),
    saveSelection: (): Promise<void> => reader['saveSelection'](),
    /** The reader's step that starts or replaces the historical debugger before a recording load; a test replaces it to hold or fail that load. */
    get debuggerReplacement(): WorkspaceReader['replaceUnavailableReplayDebugger'] {
      return reader['replaceUnavailableReplayDebugger'].bind(reader)
    },
    set debuggerReplacement(
      step: WorkspaceReader['replaceUnavailableReplayDebugger'],
    ) {
      reader['replaceUnavailableReplayDebugger'] = step
    },
    /** The reader's retirement of a shown Node test history; a test replaces it to hold a saved-study choice between its read and its showing. */
    get nodeHistoryRetirement(): () => Promise<void> {
      return reader['retireNodeHistorySelection'].bind(reader)
    },
    set nodeHistoryRetirement(step: () => Promise<void>) {
      reader['retireNodeHistorySelection'] = step
    },
    /** The reader's storage initialisation, the first step of an open; a test replaces it to hold an open in progress. */
    get initialization(): () => Promise<void> {
      return reader['initialize'].bind(reader)
    },
    set initialization(step: () => Promise<void>) {
      reader['initialize'] = step
    },
    /** The mark a close in progress sets. */
    get isClosing(): boolean {
      return reader['closing']
    },
    set isClosing(closing: boolean) {
      reader['closing'] = closing
    },
    /** Saves a playback position the way the controller does when playback is left. */
    savePlaybackPosition: (
      ...input: Parameters<PlaybackController['dependencies']['save']>
    ): Promise<void> => harness.controller!['dependencies'].save(...input),
    /** Reports a playback change to the reader, as the controller does on every state change. */
    reportPlaybackChange: (): void =>
      harness.controller!['dependencies'].changed(),
  }
}

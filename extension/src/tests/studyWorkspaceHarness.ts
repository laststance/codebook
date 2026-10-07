// Shared editor fakes stay process-local; workspace test files run in isolated Node workers.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { CURSOR_FOCUS_AGENT_COMMAND, type ReaderErrorKind } from '../constants'
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
import { sha256 } from '../runtimeSupport/utils/sha256'
import { ViewportAckTimeoutError } from '../runtimeSupport/utils/viewportAckTimeoutError'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type * as StudyWorkspaceModule from '../studyWorkspace'
import type { StudyFilesCopied, StudyViewMessage } from '../ui/studyHtml'
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
/** How long the fake editor's worker takes to close a disposed panel's tab when no layout read is answered before it runs; shorter than one poll of the reader's wait for that close. */
const DISPOSED_TAB_CLOSE_DELAY_MS = 20
/** How long after a disposed pane's tab closed the fake editor removes the group that tab left empty, in the model of `removeEmptiedGroupsLater`: Cursor 3.23.12 removed the captured source's group 57 ms after its tab at "Codebook: Close Study Workspace", and the Study pane's 12 ms after its tab (Cycle 0046 row 66). The longer of the two is modelled: it is longer than one poll of the reader's wait for the panes' tabs, so the group is still there when that wait ends. */
const EMPTIED_GROUP_CLOSE_DELAY_MS = 57
/** How long after `reveal()` returned a pane revealed with the keyboard takes it, in the model of `focusRevealedPanesLater`: a webview's focus is a message to its frame, sent while the editor opens the pane, so it lands after the calls an extension made right behind the reveal. The length is the model's choice; no trace gives it. */
const LATE_WEBVIEW_FOCUS_DELAY_MS = 30
/** The fake window of {@link workspaceHarness}'s side bar model, in pixels as Cursor 3.23.12 showed it (Cycle 0045 NF-22, obs15 P4): primary side bar 214, editor area 660, secondary side bar 461. */
const SIDE_BAR_WINDOW_PX = { window: 1335, primary: 214, auxiliary: 461 }
/**
 * How the fake host's Variables view missed the presented stop, as observed in VS Code 1.140:
 * - `'never-opened'`: Run and Debug was not opened in this editor session; the view asks for the stop's scopes as soon as it is shown, fills its tree a moment later and expands nothing by itself
 * - `'missed-the-stop'`: the view showed an earlier stop and was hidden while the recording moved on; its tree is empty until a deferred refresh loads the stop and expands the first scope by itself
 * - `'shows-another-session'`: the view keeps another debug session's frame and never asks for the recorded stop
 */
/** The thread the fake editor reports as Run and Debug's active stack item once a paused session runs again. */
interface FakeStackThread {
  session: { id: string }
  threadId: number
}
/** The stack frame the fake editor reports as Run and Debug's active stack item while a session is paused. */
interface FakeStackFrame extends FakeStackThread {
  frameId: number
}
/** What the fake editor calls of a debug adapter tracker: the adapter's messages to the editor, the editor's messages to the adapter, and the two ends of a session (the editor stops the adapter; the adapter exits), as the editor's extension host does. */
interface FakeDebugAdapterTracker {
  onDidSendMessage?(message: unknown): void
  onWillReceiveMessage?(message: unknown): void
  onWillStopSession?(): void
  onExit?(code: number | undefined, signal: string | undefined): void
}

/** Tells a frame from a thread among the fake editor's stack items, as the frame id does in the editor's API. @example isFakeStackFrame({ session: { id: 'live-next-server' }, threadId: 1 }) // => false */
function isFakeStackFrame(
  item: FakeStackFrame | FakeStackThread | undefined,
): item is FakeStackFrame {
  return item !== undefined && 'frameId' in item
}
type NativeVariablesHiding =
  'never-opened' | 'missed-the-stop' | 'shows-another-session'

/**
 * Keeps native presentation inert while exercising actual checkpoints, source watching and durable decisions.
 * @param remoteName - `vscode.env.remoteName` of the fake window, for the editor and the service alike; `wsl` models a WSL remote window, which has no Trash.
 * @example const reader = await workspaceHarness()
 * @example const readerInWsl = await workspaceHarness(true, false, 'wsl')
 */
export async function workspaceHarness(
  attach = true,
  deterministicClock = false,
  remoteName?: string,
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
  /** The text of every native error notification the reader showed. */
  const errorMessages: string[] = []
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
  /** Which list of the fake host holds the keyboard focus, and so takes the list commands: its Variables view, or another list the learner clicked (the Explorer). See `clickAnotherList`. */
  let focusedList: 'variables' | 'another-list' = 'variables'
  /** What the list commands did to the other list while it held the focus. */
  const anotherList = { firstRowFocused: false, firstRowExpanded: false }
  /** Whether the Learning summary shares its side bar with Run and Debug, as in Cursor: the focus command of Variables then puts Run and Debug in the summary's place. See `shareSummarySideBarWithRunAndDebug`. */
  let summarySharesSideBarWithRunAndDebug = false
  /** The context keys the reader set with the editor's `setContext` command. */
  const contextKeys = new Map<string, unknown>()
  /** Pending `awaitRetrieval` checks of the fake historical debugger, re-run whenever the fake Variables view asks for scopes or lists values. */
  const nativeVariablesWaiters = new Set<() => void>()
  const trashMoves: { path: string; options: unknown }[] = []
  /** The reader's listeners for a changed editor setting; see `setSavedStudyCapacity`. */
  const configurationListeners = new Set<
    (event: { affectsConfiguration(section: string): boolean }) => void
  >()
  let rejectsTrashMove: (path: string) => boolean = () => false
  let beforeTrashMove: (path: string) => Promise<void> = async () => {}
  let heldTrashMove: { wait: Promise<void>; entered(): void } | undefined
  /** Every text the reader wrote to the editor's clipboard. */
  const clipboardTexts: string[] = []
  /** Whether the editor's clipboard refuses every write; see `rejectClipboardWrites`. */
  let rejectsClipboardWrites = false
  const harness = await createHarness({
    create: async (directory, profile) => {
      const runtime = new ControlledRuntime(directory, profile)
      if (deterministicClock) runtime.evidence.elapsedMs = () => clock
      return runtime
    },
    remoteName,
  })
  /** Builds one fake status bar item. It counts the assignments of its command, because the editor turns every assigned command object into a new internal command and disposes the one before. @example createStatusItem().commandAssignments // => 0 */
  const createStatusItem = () => {
    let assignedCommand: unknown
    return {
      name: '',
      text: '',
      tooltip: '',
      commandAssignments: 0,
      get command(): unknown {
        return assignedCommand
      },
      set command(value: unknown) {
        this.commandAssignments++
        assignedCommand = value
      },
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
  }
  const saveStatus = createStatusItem()
  /** The identifier of every status bar item the reader created, in order; the first one is `saveStatus`, a later one would be a second control in the status bar. */
  const createdStatusItemIds: string[] = []
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
    setDecorations(decoration?: unknown, ranges?: readonly unknown[]): void
    selections: { active: Position; anchor: Position }[]
    visibleRanges: Range[]
    revealRange(range: Range, revealType?: number): void
  }
  /** What the fake editor reports with a change of a text editor's selection: the editor, its selections, and how they changed by the number of the editor's `TextEditorSelectionChangeKind` (1 the keyboard, 2 the mouse, 3 a command, which is also what a selection set by an extension is reported as). A test that sets an editor's `selections` itself names no cause, and the change is reported without a kind, as the editor's API allows. */
  type SelectionChange = {
    textEditor: SourceEditor
    selections: SourceEditor['selections']
    kind: 1 | 2 | 3 | undefined
  }
  const activeEditorListeners = new Set<
      (editor: SourceEditor | undefined) => void
    >(),
    selectionListeners = new Set<(change: SelectionChange) => void>()
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
    decoratedColumns: number[] = [],
    /** How many lines each source highlight call marked, in order; 0 is a cleared highlight. */
    decoratedRangeCounts: number[] = []
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
    setDecorations(
      _decoration?: unknown,
      ranges: readonly unknown[] = [],
    ): void {
      decoratedColumns.push(reportedColumn ?? group.viewColumn)
      decoratedRangeCounts.push(ranges.length)
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
    staleNamedGroup = undefined
    for (const listener of groupChangeListeners) listener(event)
  }
  let sourceProvider = async (_uri: Uri) => ''
  const historicalDebugPresentations: Array<{
    snapshot: ReplayDebugSnapshot | undefined
    label: string
    sourceDocument?: { uri: string; hash: string }
  }> = []
  let historicalDebugInvalidations = 0
  /** What each invalidation told the fake historical debugger its emptied session reads in Run and Debug, in order. */
  const historicalDebugInvalidationLabels: string[] = []
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
    invalidate(label = 'Not recorded at this moment'): void {
      historicalDebugInvalidations++
      historicalDebugInvalidationLabels.push(label)
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
      runEditorChangeLater(() => {
        nativeVariables.treeHoldsStop = true
      }, NATIVE_VARIABLES_FIRST_RENDER_MS).unref()
    }
    if (hiding === 'missed-the-stop')
      // The deferred refresh loads the stop and expands the first scope by itself.
      runEditorChangeLater(() => {
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
  /** The editor area in which the fake editor answers a layout given in proportions as pixels; see `answerProportionsAsPixels`. `undefined`: such a layout is kept as it was given. */
  let proportionsAnsweredInPx: { width: number; height: number } | undefined
  let hideGridWhileMaximized = false
  let editorLayout: unknown = { orientation: 0, groups: [{}] }
  let nextMovedPanelLayout: unknown
  let nativeLayout = false,
    cursorGroupWrappers = false,
    cursorTwoEventContraction = false,
    explicitEditorLayout = false,
    maximizedEditorGroup = false
  /** The view column of the group the editor's maximize command maximized, read while `maximizedEditorGroup` is set: the group that was the active one when the command ran. */
  let maximizedColumn: number | undefined
  let closeEmptyGroupsOnMove = false
  let closeDisposedPanelTabsLater = false
  // Cursor 3.23.12 keeps naming the chat's group as the active tab group after `workbench.action.focusFirstEditorGroup` gave the main editor the keyboard; the next tab or group change rebuilds the tab model and corrects the name.
  let staleNamedGroup: (typeof groups)[number] | undefined
  // The tab that had the keyboard was closed while the focus was to be preserved, or its pane was disposed: no editor has the keyboard, the page body does (Cursor 3.23.12 after Close Study Workspace, Cycle 0045 obs15 P4), until something is focused again.
  let keyboardOnBody = false
  /** Which side bars the fake window shows, once a test models them with `modelSideBars`; the editor area then has the width they leave. */
  let sideBars: { primary: boolean; auxiliary: boolean } | undefined
  /** The widths of the fake window's side bars in pixels; `modelSideBars` can replace Cursor's. */
  let sideBarWidthsPx = {
    primary: SIDE_BAR_WINDOW_PX.primary,
    auxiliary: SIDE_BAR_WINDOW_PX.auxiliary,
  }
  /** The editor group the fake editor names as the active one for a moment when a group's maximization ends, as `nameAnotherGroupWhenMaximizationEnds` sets it up; `undefined` names none. */
  let transientGroupAtUnmaximize:
    { column: number; durationMs: number } | undefined
  /** The width of the fake window in pixels, which `resizeWindow` changes as a learner who drags the window's edge does. */
  let windowWidthPx = SIDE_BAR_WINDOW_PX.window
  /** Says that a side bar has the keyboard: the editor's commands that show a side bar also focus it. */
  let keyboardInSideBar = false
  /** Says that a view that is no editor has the keyboard (the Call Stack view of Run and Debug): the learner clicked into it, see `focusView`. Whatever gives an editor group, a text editor, a pane or the chat the keyboard ends that. */
  let keyboardInView = false
  /** The reader's debug adapter tracker factories; `pauseDebugger` sends each of them the adapter's `stopped` event, as the editor does before it opens the paused file. */
  const debugAdapterTrackerFactories = new Set<{
    createDebugAdapterTracker(session: {
      id: string
    }): FakeDebugAdapterTracker | undefined
  }>()
  /** The trackers the reader's factories made, by session: a session gets its tracker once, when it starts, and loses it when it ends (`endDebugSession`). */
  const debugAdapterTrackers = new Map<
    string,
    (FakeDebugAdapterTracker | undefined)[]
  >()
  // What the editor reports for Run and Debug: its active stack item, and the learner's `debug.focusEditorOnBreak` setting (unset: the editor's default, on).
  /** Run and Debug's active stack item as the fake editor reports it: a frame while a session is paused, its thread once it runs again, none before a first stop; see `pauseDebugger`. */
  let activeStackItem: FakeStackFrame | FakeStackThread | undefined,
    focusEditorOnBreak: boolean | undefined
  let nextStackFrameId = 1
  /**
   * The settings the fake editor answers, by their full key; every other setting is unset. Read at each `get`, so a test that changes one of the values is answered with the new one.
   * @returns The values of `codebook.savedStudyLimit`, `debug.focusEditorOnBreak` (unset: the editor's default, on) and `workbench.editor.closeEmptyGroups` (the fake editor removes an emptied group only in the model of `closeDisposedPanelTabsLater`).
   * @example configuredValues()['debug.focusEditorOnBreak'] // => false after harness.pauseDebugger({ focusesEditorOnBreak: false })
   */
  const configuredValues = (): Record<string, unknown> => ({
    'codebook.savedStudyLimit': savedStudyCapacity,
    'debug.focusEditorOnBreak': focusEditorOnBreak,
    'workbench.editor.closeEmptyGroups': closeDisposedPanelTabsLater,
  })
  /** The reader's listeners for a change of the selected stack item of Run and Debug; `pauseDebugger` and `resumeDebugger` call them. */
  const activeStackItemListeners = new Set<() => void>()
  /** Whether the fake editor lets the keyboard fall to the page body when it removes an emptied editor group while a text editor has the keyboard; see `loseKeyboardWhenGroupCloses`. */
  let losesKeyboardWhenGroupCloses = false
  /** Whether the fake editor removes the group a disposed pane's tab left empty a moment after that tab closed instead of with it; see `removeEmptiedGroupsLater`. */
  let removesEmptiedGroupsLater = false
  /** The pane whose `active` flag the fake editor has not cleared yet although another group took the focus; see `holdPaneDeactivation`. */
  let heldActivePane: string | undefined
  /** Whether a pane revealed with the keyboard takes it a moment after `reveal()` returned, and whether that late take is being applied now; see `focusRevealedPanesLater`. */
  let focusesRevealedPanesLater = false,
    applyingLateFocus = false
  // Every text document the reader showed, with the group and whether it left the keyboard focus where it was.
  const textDocumentShows: {
    name: string
    viewColumn: number | undefined
    preserveFocus: boolean
  }[] = []
  // Cursor reports a pane that was revealed in front of another tab of its group one turn after the call returned.
  let revealsPanelsLater = false,
    applyingLaterReveal = false
  // Cursor 3.23.12 closes a disposed panel's tab, and a moment later the group it left empty, while a layout read is pending.
  let closeDisposedPanelTabsDuringLayoutRead = false
  /** The fake editor answers every tab change with new TabGroup objects, as Cursor does; see `replaceGroupObjectsOnTabChanges`. */
  let replacesGroupObjectsOnTabChanges = false
  /** The bottom panel is maximized: the editor area is hidden and reports its stacked groups at their minimum height. */
  let panelMaximized = false
  /** Tab closes of disposed panels the fake editor has not run yet; see `closeDisposedPanelTabsLater`. */
  const pendingDisposedTabCloses: (() => void)[] = []
  /** The fake editor's own timers that have not run yet (a disposed pane's tab close, a late reveal, an emptied group's removal, the name of the focused group after a maximization ended, a late report of the active text editor, a late load of the Variables view); {@link runEditorChangeLater} puts each of them here. The harness's `close` clears them, so no fake editor changes its groups or calls a listener after its test ended. */
  const pendingEditorTimers = new Set<ReturnType<typeof setTimeout>>()
  /**
   * Runs one pending tab change of the fake editor by itself after {@link DISPOSED_TAB_CLOSE_DELAY_MS}, unless a layout read took it from `pendingDisposedTabCloses` first or the harness was closed; called for a disposed pane's tab close and for a late reveal.
   * @param change - The change that was pushed to `pendingDisposedTabCloses`.
   * @example
   * pendingDisposedTabCloses.push(closeTab)
   * applyByItselfLater(closeTab)
   */
  function applyByItselfLater(change: () => void): void {
    runEditorChangeLater(() => {
      const index = pendingDisposedTabCloses.indexOf(change)
      if (index < 0) return
      pendingDisposedTabCloses.splice(index, 1)
      change()
    }, DISPOSED_TAB_CLOSE_DELAY_MS)
  }
  /**
   * Runs one change of the fake editor by itself after a delay, unless the harness was closed first: the timer is kept in `pendingEditorTimers`, which the harness's `close` clears, and leaves that set when it fires. Every change the fake editor makes later goes through here, so none of them reaches a test that has ended.
   * @param change - What the fake editor does then.
   * @param delayMs - How long after this call.
   * @returns The timer, for a caller that lets the process end without waiting for it.
   * @example runEditorChangeLater(() => changedGroups({ opened: [], closed: [], changed: [group] }), 40)
   */
  function runEditorChangeLater(
    change: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      pendingEditorTimers.delete(timer)
      change()
    }, delayMs)
    pendingEditorTimers.add(timer)
    return timer
  }
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
  /** Whether a reveal with the focus takes the keyboard from the document of a pane that already has it; see `dropInnerFocusAtRevealOfFocusedPane`. */
  let dropsInnerFocusAtRevealOfFocusedPane = false
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
  // Cursor 3.23.12: a pane of the main editor that is no text editor takes the keyboard without a report while the editor names the chat's group.
  let leavesPaneFocusUnreportedBesideChat = false
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
  // The reader's answers to a pane's Copy paths, with the webview that got each (named as in `openRequestReplies`).
  const studyFilesCopyAnswers: { webview: string; answer: StudyFilesCopied }[] =
    []
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
   * @param opened - The group the same change opened; it is reported as opened and keeps its object.
   * @example replaceGroupObjects() // harness.groups[0] is another object in the same view column, reported as changed
   */
  function replaceGroupObjects(
    closed: typeof groups = [],
    opened?: (typeof groups)[number],
  ): void {
    if (!replacesGroupObjectsOnTabChanges) return
    const replacements = new Map(
      groups
        .filter((group) => group !== opened)
        .map((group) => [group, { ...group, tabs: [...group.tabs] }]),
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
    changedGroups({
      opened: opened ? [opened] : [],
      closed,
      changed: [...replacements.values()],
    })
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
      replaceGroupObjects([], group)
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
   * Answers a layout as both editors were seen to answer one that is given in proportions over a grid of three columns (Cycle 0046 row 340): every size below one pixel stays what it is, so each group but the last of its siblings is one pixel and the last one has the rest of the area. A layout with a size above one pixel is given back as it is.
   * @example proportionsAsPixels({ orientation: 0, groups: [{ size: 0.55, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 0.45 }] }, { width: 1270, height: 688 })
   * // => { orientation: 0, groups: [{ size: 1, groups: [{ size: 1 }, { size: 687 }] }, { size: 1269 }] }
   */
  function proportionsAsPixels(
    layout: unknown,
    areaPx: { width: number; height: number },
  ): unknown {
    const isProportion = (node: unknown): boolean =>
      layoutSize(node) <= 1 &&
      (layoutChildren(node) ?? []).every((child) => isProportion(child))
    const top = layoutChildren(layout)
    if (!top?.every((child) => isProportion(child))) return layout
    const horizontal = Number(Reflect.get(Object(layout), 'orientation')) === 0
    const sized = (
      siblings: unknown[],
      totalPx: number,
      otherTotalPx: number,
    ): unknown[] =>
      siblings.map((sibling, index) => {
        const children = layoutChildren(sibling)
        return {
          size:
            index < siblings.length - 1 ? 1 : totalPx - (siblings.length - 1),
          ...(children
            ? { groups: sized(children, otherTotalPx, totalPx) }
            : {}),
        }
      })
    return {
      orientation: horizontal ? 0 : 1,
      groups: horizontal
        ? sized(top, areaPx.width, areaPx.height)
        : sized(top, areaPx.height, areaPx.width),
    }
  }

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
   * Called by {@link revealIntoHiddenEditorArea} (a reveal, a shown text document), a panel's registration, the commands that focus another group, the tab closes and `vscode.setEditorLayout`, whose own layout then replaces these sizes. The command that focuses the group that is already active is not among them: it brings the area back with the sizes the groups had.
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
  /**
   * Rewrites the pixel widths of a layout's top-level columns as both editors answer them while one group is maximized; called by the fake `vscode.getEditorLayout` for the model of `modelSideBars`.
   * The editor hides every other group, and its grid serializes a hidden group with the size it had while it was visible (VS Code 1.140 and Cursor 3.23, `serializeNode`: `size = cachedVisibleSize`). So the column that holds the maximized group answers the whole editor area, a hidden column that is one group keeps the width it had in that area, and the sum is wider than the area. A hidden column that is itself split answers its own width, which is nothing while all its groups are hidden: that zero is inferred from the grid's code and was not seen in an editor.
   * @param columns - The top-level columns, already in pixels of the area; they are changed in place.
   * @param areaPx - The editor area's width.
   * @example answerColumnsAsWhileMaximized([{ size: 734, groups: [{}, {}] }, { size: 601 }], 1335) // Application maximized: 1335 and 601
   */
  function answerColumnsAsWhileMaximized(
    columns: { size: number; groups?: unknown[] }[],
    areaPx: number,
  ): void {
    let firstLeafColumn = 1
    for (const column of columns) {
      const leafCount = column.groups?.length ?? 1
      const holdsMaximizedGroup =
        maximizedColumn !== undefined &&
        maximizedColumn >= firstLeafColumn &&
        maximizedColumn < firstLeafColumn + leafCount
      if (holdsMaximizedGroup) column.size = areaPx
      else if (column.groups) column.size = 0
      firstLeafColumn += leafCount
    }
  }
  /**
   * Lists the trackers the reader's factories made for a debug session, making them at the session's first use, as the editor does when the session starts; called by `pauseDebugger`.
   * @param session - The session.
   * @returns One entry for each factory that was registered when the session started; `undefined` for a factory that tracks no such session.
   * @example for (const tracker of trackersOf({ id: 'live-next-server' })) tracker?.onDidSendMessage?.(stopped)
   */
  function trackersOf(session: { id: string }) {
    const known = debugAdapterTrackers.get(session.id)
    if (known) return known
    const made = [...debugAdapterTrackerFactories].map((factory) =>
      factory.createDebugAdapterTracker(session),
    )
    debugAdapterTrackers.set(session.id, made)
    return made
  }
  /**
   * Opens a learner-owned text document as the tab in front of a group, with its text editor visible there, and gives nothing the keyboard; the shared first step of `focusMutableDraft`, which then gives that editor the keyboard, and of `selectStackFrame`, which does not.
   * @param filename - The document's file name in the harness's folder.
   * @param column - The view column of the group.
   * @param isPreview - Whether the tab is a preview tab without unsaved text, as the one the editor opens for a file at one click; left out, a kept tab with unsaved text.
   * @returns The document, its tab, its editor, the group, and `replaceText`, which changes the document's text and version.
   * @example const { editor, group } = openDraftTab('notes.txt', 2)
   */
  function openDraftTab(filename: string, column: number, isPreview = false) {
    let text = 'Original learner draft.\n'
    const document = {
      uri: Uri.file(join(harness.directory, filename)),
      version: 1,
      getText: () => text,
    }
    const group = groups.find((group) => group.viewColumn === column)!
    const tab = {
      input: new TabInputText(document.uri),
      isPreview,
      // A draft has unsaved text; a file the editor opens as a preview tab has none.
      isDirty: !isPreview,
    }
    const editor = Object.assign(sourceEditor(document, group), { group })
    let selections = editor.selections
    Object.defineProperty(editor, 'selections', {
      get: () => selections,
      set: (value: typeof selections) => {
        selections = value
        for (const listener of selectionListeners)
          listener({ textEditor: editor, selections: value, kind: undefined })
      },
    })
    group.tabs.push(tab)
    group.activeTab = tab
    visibleSourceEditors.push(editor)
    return {
      document,
      tab,
      editor,
      group,
      replaceText(value: string): void {
        text = value
        document.version++
      },
    }
  }
  /**
   * Gives the text editor of a draft's tab the keyboard, whoever had it before: the tab is in front of its group, the group is the active one, and the editor is reported as the active text editor; called by `focusMutableDraft` for a learner's click and by `pauseDebugger` for the debugger's own opening of the paused file.
   * @param opened - What `openDraftTab` returned for that draft.
   * @example giveDraftKeyboard(openDraftTab('actions.ts', 1))
   */
  function giveDraftKeyboard(opened: ReturnType<typeof openDraftTab>): void {
    opened.group.activeTab = opened.tab
    activeTabGroup = opened.group
    if (separateEditorPart) separateEditorPart.focused = false
    keyboardOnBody = false
    keyboardInView = false
    activeTextEditorChanged(opened.editor)
  }
  /** Closes a main group whose last tab the editor just closed, renumbering the later columns and the measured layout. @example removeEmptiedGroup(group) */
  function removeEmptiedGroup(emptied: (typeof groups)[number]): void {
    const main = groups
      .filter((candidate) => candidate !== separateEditorPart?.group)
      .toSorted((left, right) => left.viewColumn - right.viewColumn)
    // The editor keeps its last group even when it is empty.
    if (main.length < 2 || !groups.includes(emptied)) return
    // Cursor rebuilds its editor grid when a group closes, and the text editor that had the keyboard loses it to the page body. A page of the editor that is no text editor (its Settings) lies in the same grid and is modelled the same way; no trace shows that case yet.
    if (
      losesKeyboardWhenGroupCloses &&
      !separateEditorPart?.focused &&
      (focusedSourceEditor() ||
        activeTabGroup.activeTab?.input instanceof TabInputUnknown)
    )
      keyboardOnBody = true
    // Both editors leave a maximization when a group is removed from their grid, and the groups that remain have the sizes they had before it (the grid's `removeView` exits the maximized view first).
    maximizedEditorGroup = false
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
      // With `closeEmptyGroups` on (the model of `closeDisposedPanelTabsLater`), the editor also removes a group whose last tab the reader closed.
      if ((heldDeadPane || closeDisposedPanelTabsLater) && !group.tabs.length)
        emptiedByDeadPane.push(group)
    }
    // The editor removes a group whose last tab closed and renumbers the later columns; its last main group stays, empty.
    // From the last column to the first, each group looked up again by its column: a removal renumbers the later columns, and Cursor answers it with new group objects.
    const emptiedColumns = emptiedByDeadPane
      .map((group) => group.viewColumn)
      .toSorted((left, right) => right - left)
    for (const emptiedColumn of emptiedColumns) {
      const mainGroups = groups.filter(
        (candidate) => candidate !== separateEditorPart?.group,
      )
      if (!nativeLayout || mainGroups.length === 1) break
      const emptied = mainGroups.find(
        (candidate) =>
          candidate.viewColumn === emptiedColumn && !candidate.tabs.length,
      )
      if (!emptied) continue
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
        runEditorChangeLater(() => {
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
            | StudyFilesCopied
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
          if (message.type === 'study-files-copied') {
            studyFilesCopyAnswers.push({
              webview: kind === 'codebook.studyContext' ? 'context' : kind,
              answer: message,
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
          heldActivePane === kind ||
          (pendingPanelActivity !== kind &&
            !separateEditorPart?.focused &&
            !staleNamedGroup &&
            activeTabGroup.activeTab === nativeTab)
        )
      },
      get visible() {
        return (
          !registered || groups.some((group) => group.activeTab === nativeTab)
        )
      },
      reveal(column?: number, preserveFocus?: boolean): void {
        // The pane comes to the front of its group, with the tab events of that, one turn after this call returned.
        if (
          revealsPanelsLater &&
          !applyingLaterReveal &&
          column === undefined &&
          !groups.some((group) => group.activeTab === nativeTab)
        ) {
          const applyReveal = (): void => {
            if (!panels.has(value)) return
            applyingLaterReveal = true
            try {
              value.reveal(column, preserveFocus)
            } finally {
              applyingLaterReveal = false
            }
          }
          pendingDisposedTabCloses.push(applyReveal)
          // Without a layout read the reveal is reported by itself a moment later.
          applyByItselfLater(applyReveal)
          return
        }
        // The pane comes to the front at once; the keyboard it was revealed with reaches it a moment later.
        if (focusesRevealedPanesLater && !preserveFocus && !applyingLateFocus) {
          value.reveal(column, true)
          runEditorChangeLater(() => {
            if (!panels.has(value)) return
            applyingLateFocus = true
            try {
              value.reveal(undefined, false)
            } finally {
              applyingLateFocus = false
            }
          }, LATE_WEBVIEW_FOCUS_DELAY_MS)
          return
        }
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
            // A pane revealed with the focus takes the keyboard from the page body.
            keyboardOnBody = false
            keyboardInView = false
            retainDelayedTextFocus(kind)
            // A pane whose document has the focus already loses it to the frame around it, and nothing gives it back.
            if (
              dropsInnerFocusAtRevealOfFocusedPane &&
              innerFocusedPanel === kind
            )
              innerFocusedPanel = undefined
            else if (!suppressNativeInnerFocus && !value.blockInnerFocus)
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
        // A disposed pane that had the keyboard leaves it to no editor.
        if (
          !separateEditorPart?.focused &&
          activeTabGroup.activeTab === nativeTab
        )
          keyboardOnBody = true
        const closeTab = (): void => {
          // The pane was focused again after its disposal (a group focus command reached its group before the editor closed its tab): the keyboard goes with the closing tab, and the editor focuses nothing in its place.
          if (
            !separateEditorPart?.focused &&
            activeTabGroup.activeTab === nativeTab
          )
            keyboardOnBody = true
          const emptied = groups.filter(
            (group) => group.tabs.length === 1 && group.tabs[0] === nativeTab,
          )
          for (const group of groups) {
            group.tabs = group.tabs.filter((tab) => tab !== nativeTab)
            if (group.activeTab === nativeTab) group.activeTab = undefined
          }
          // The editor then removes the group the tab left empty (workbench.editor.closeEmptyGroups, on by default).
          if (closeDisposedPanelTabsDuringLayoutRead) {
            const emptiedColumns = emptied.map((group) => group.viewColumn)
            // The tab's close gives every group a new object; the emptied group's close, which follows it while a layout read is pending, does so again.
            replaceGroupObjects()
            pendingDisposedTabCloses.push(() => {
              for (const group of groups.filter(
                (candidate) =>
                  candidate !== separateEditorPart?.group &&
                  emptiedColumns.includes(candidate.viewColumn) &&
                  !candidate.tabs.length,
              ))
                removeEmptiedGroup(group)
            })
          } else if (
            closeDisposedPanelTabsLater &&
            removesEmptiedGroupsLater &&
            emptied.length
          ) {
            // The tab's close is reported first; the group it left empty goes a moment later, and every main group that is empty then goes with it, from the last column to the first.
            replaceGroupObjects()
            runEditorChangeLater(() => {
              const emptyGroups = groups
                .filter(
                  (candidate) =>
                    candidate !== separateEditorPart?.group &&
                    !candidate.tabs.length,
                )
                .toSorted((left, right) => right.viewColumn - left.viewColumn)
              for (const group of emptyGroups) removeEmptiedGroup(group)
            }, EMPTIED_GROUP_CLOSE_DELAY_MS)
          } else if (closeDisposedPanelTabsLater && emptied.length) {
            // From the last column to the first, each group looked up again by its column, as in the close of dead panes above.
            const laterEmptiedColumns = emptied
              .map((group) => group.viewColumn)
              .toSorted((left, right) => right - left)
            for (const emptiedColumn of laterEmptiedColumns) {
              const group = groups.find(
                (candidate) =>
                  candidate !== separateEditorPart?.group &&
                  candidate.viewColumn === emptiedColumn &&
                  !candidate.tabs.length,
              )
              if (group) removeEmptiedGroup(group)
            }
          } else replaceGroupObjects()
        }
        // VS Code closes a disposed editor from a worker with a 0 ms delay; a layout read that reached the busy window with the disposal is answered before that worker runs.
        if (
          closeDisposedPanelTabsLater ||
          closeDisposedPanelTabsDuringLayoutRead
        ) {
          pendingDisposedTabCloses.push(closeTab)
          // Without a layout read the worker closes the tab by itself a moment later.
          applyByItselfLater(closeTab)
        } else closeTab()
        for (const listener of disposed) listener()
      },
    }
    // Both hosts initialize optimistic panel flags before the native tab/view-state acknowledgement arrives.
    const register = (): void => {
      registered = true
      const group = nativeGroup(value.viewColumn ?? 1)
      if (!group.tabs.includes(nativeTab)) {
        group.tabs.push(nativeTab)
        // Cursor reports the opened tab before it reports it as the tab its group shows (obs15 P1: "opened", then "changed").
        if (replacesGroupObjectsOnTabChanges)
          for (const listener of tabChangeListeners)
            listener({ opened: [nativeTab], closed: [], changed: [] })
      }
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
        comesWithoutKeyboard?(): Promise<boolean>
        tookKeyboardFromEditor?(): void
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
    /**
     * Brings the leased pane to the front over the file the debugger focused at a pause, as the real viewport does: the lease's owner is asked first whether the pane is to come without the keyboard (it gave the keyboard back to whoever had it before the pause, or the covered file does not have it by a stop); the pane is then revealed without the keyboard, or takes it and tells the owner.
     * @returns Once the pane is revealed.
     * @example await viewport.revealOverPausedFile()
     */
    async revealOverPausedFile(): Promise<void> {
      assert.equal(this.closed, false)
      const keeps = (await this.lease.comesWithoutKeyboard?.()) ?? false
      this.panel.reveal(undefined, keeps)
      if (!keeps) this.lease.tookKeyboardFromEditor?.()
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
        throw new ViewportAckTimeoutError()
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
      async postMessage(
        message: StudyViewMessage | OpenRequestSettled | StudyFilesCopied,
      ) {
        if (message.type === 'open-request-settled') {
          openRequestReplies.push({
            webview: 'summary',
            openRequest: message.openRequest,
          })
          return true
        }
        if (message.type === 'study-files-copied') {
          studyFilesCopyAnswers.push({ webview: 'summary', answer: message })
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
  /** The last Study message the bottom panel had received at the moment each of its open requests was answered, by request number; see `playbackPanelMessageAtReply`. */
  const playbackPanelMessagesAtReply = new Map<
    number,
    StudyViewMessage | undefined
  >()
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
      async postMessage(
        message: StudyViewMessage | OpenRequestSettled | StudyFilesCopied,
      ) {
        if (message.type === 'open-request-settled') {
          openRequestReplies.push({
            webview: 'moments',
            openRequest: message.openRequest,
          })
          playbackPanelMessagesAtReply.set(
            message.openRequest,
            structuredClone(playbackPanelMessages.at(-1)),
          )
          return true
        }
        if (message.type === 'study-files-copied') {
          studyFilesCopyAnswers.push({ webview: 'moments', answer: message })
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
      TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2, Command: 3 },
      ThemeColor: class {},
      RelativePattern,
      env: {
        get appName(): string {
          return hostAppName
        },
        remoteName,
        clipboard: {
          writeText: async (text: string): Promise<void> => {
            if (rejectsClipboardWrites)
              throw new Error('The clipboard is unavailable.')
            clipboardTexts.push(text)
          },
        },
      },
      commands: {
        async getCommands(): Promise<string[]> {
          return [
            ...nativeHostCommands,
            // Cursor, whose Agent chat is the separate editor part, registers "Focus Agent".
            ...(separateEditorPart ? [CURSOR_FOCUS_AGENT_COMMAND] : []),
          ].filter((name) => !absentHostCommands.has(name))
        },
        async executeCommand(
          name: string,
          layout?: unknown,
          contextValue?: unknown,
        ): Promise<unknown> {
          // Both native hosts reject a command they do not register, in these words.
          if (absentHostCommands.has(name))
            throw new Error(`command '${name}' not found`)
          // A context key changes no pane, focus or layout; it is kept apart from the recorded native commands.
          if (name === 'setContext') {
            contextKeys.set(String(layout), contextValue)
            return
          }
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
          if (name === 'workbench.debug.action.focusVariablesView') {
            focusedList = 'variables'
            showNativeVariablesView()
            // Run and Debug opens in the side bar the summary shares with it and takes its place.
            if (summarySharesSideBarWithRunAndDebug && summary.visible) {
              summary.visible = false
              for (const listener of summaryVisibilityListeners) listener()
            }
          }
          // A list command acts on the rows the focused list holds at that moment; an empty tree gives it nothing to focus or expand.
          if (name === 'list.focusFirst') {
            if (focusedList === 'another-list')
              anotherList.firstRowFocused = true
            else if (nativeVariables.treeHoldsStop)
              nativeVariables.firstScopeFocused = true
          }
          if (name === 'list.expand') {
            if (focusedList === 'another-list')
              anotherList.firstRowExpanded = anotherList.firstRowFocused
            else if (nativeVariables.firstScopeFocused) listNativeValues()
          }
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
            const transientGroup = maximizedEditorGroup
              ? groups.find(
                  (group) =>
                    group.viewColumn === transientGroupAtUnmaximize?.column,
                )
              : undefined
            // The editor names another group for one event while the maximization ends, and the group that has the keyboard again shortly after the command answered.
            if (transientGroup && transientGroup !== activeTabGroup) {
              const focusedGroup = activeTabGroup
              activeTabGroup = transientGroup
              changedGroups({
                opened: [],
                closed: [],
                changed: [transientGroup, focusedGroup],
              })
              runEditorChangeLater(() => {
                activeTabGroup = focusedGroup
                changedGroups({
                  opened: [],
                  closed: [],
                  changed: [focusedGroup, transientGroup],
                })
              }, transientGroupAtUnmaximize!.durationMs)
            }
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
          if (name === 'workbench.action.toggleMaximizeEditorGroup') {
            maximizedEditorGroup = !maximizedEditorGroup
            maximizedColumn = activeTabGroup.viewColumn
          }
          if (name === 'workbench.action.maximizeEditorHideSidebar') {
            maximizedEditorGroup = true
            // The command hides both side bars, and no later command of the editor brings them back by itself (both editors, obs15 P4).
            if (sideBars) sideBars = { primary: false, auxiliary: false }
            // The bars are hidden first and the active group is maximized after it, so the other groups are hidden at the sizes they have in the whole window.
            maximizedColumn = activeTabGroup.viewColumn
          }
          if (sideBars && name === 'workbench.action.closeSidebar')
            sideBars.primary = false
          // The two focus commands show a hidden side bar, leave an open one as it is, and give it the keyboard.
          if (sideBars && name === 'workbench.action.focusSideBar') {
            sideBars.primary = true
            keyboardInSideBar = true
            // The primary bar's view has the keyboard now, so the chat's input has it no longer; only Cursor's Focus Agent or the learner gives it back. (Cursor keeps its chat tab's editor part inside the secondary bar, and what that bar's focus command focuses there is not known: the model leaves the chat as it is for that command.)
            if (separateEditorPart) separateEditorPart.focused = false
          }
          if (sideBars && name === 'workbench.action.focusAuxiliaryBar') {
            sideBars.auxiliary = true
            keyboardInSideBar = true
          }
          if (name === 'workbench.action.focusActiveEditorGroup')
            keyboardInSideBar = false
          // The activated group is in view before the command answers: another group that takes the focus comes back at the minimum heights.
          if (name === 'workbench.action.focusFirstEditorGroup')
            returnHiddenEditorArea()
          // The group that already was the active one comes back with the sizes the rows had before the panel was maximized (VS Code 1.140.0: 344 / 343 before and after).
          if (name === 'workbench.action.focusActiveEditorGroup')
            panelMaximized = false
          // Every command that gives an editor group or the chat the keyboard takes it from the page body.
          if (
            name === 'workbench.action.focusActiveEditorGroup' ||
            name === 'workbench.action.focusFirstEditorGroup' ||
            focusGroupAtColumnCommands.includes(name) ||
            name === CURSOR_FOCUS_AGENT_COMMAND
          ) {
            keyboardOnBody = false
            keyboardInView = false
          }
          const focusedColumn = focusGroupAtColumnCommands.indexOf(name) + 2
          // The editor's commands for its second to eighth group give that group the keyboard focus and keep the tab it shows.
          if (focusedColumn > 1) {
            const mainGroups = groups.filter(
              (group) => group !== separateEditorPart?.group,
            )
            // The command counts the main editor's groups only. For the column after the last of them it opens a new empty group there and focuses it (VS Code keeps this from before the grid); the chat's group, which sat at that column, moves one column on (Cursor 3.23.12, Cycle 0045 obs15 P1 and P2).
            if (nativeLayout && focusedColumn === mainGroups.length + 1) {
              const opened = nativeGroup(focusedColumn)
              activeTabGroup =
                groups.find((group) => group.viewColumn === focusedColumn) ??
                opened
              innerFocusedPanel = undefined
              if (separateEditorPart) separateEditorPart.focused = false
              changedGroups({
                opened: [],
                closed: [],
                changed: [activeTabGroup],
              })
              activeTextEditorChanged(undefined)
            }
            const focusedGroup = mainGroups.find(
              (group) => group.viewColumn === focusedColumn,
            )
            if (focusedGroup && focusedGroup !== activeTabGroup) {
              const previousGroup = activeTabGroup
              returnHiddenEditorArea()
              activeTabGroup = focusedGroup
              innerFocusedPanel = undefined
              if (separateEditorPart) separateEditorPart.focused = false
              changedGroups({
                opened: [],
                closed: [],
                changed: [previousGroup, focusedGroup],
              })
              activeTextEditorChanged(focusedSourceEditor())
            }
          }
          // Cursor's "Focus Agent": the selected chat's input gets the keyboard; no tab or group changes, and the editor keeps naming the tab group it named.
          if (name === CURSOR_FOCUS_AGENT_COMMAND && separateEditorPart) {
            separateEditorPart.focused = true
            innerFocusedPanel = undefined
            activeTextEditorChanged(undefined)
          }
          if (name === 'workbench.action.focusFirstEditorGroup') {
            const previousEditor = focusedSourceEditor(),
              previousGroup = activeTabGroup,
              primaryGroup = groups.find((group) => group.viewColumn === 1)!
            const primaryEditor = visibleSourceEditors.find(
              (editor) => editor.group === primaryGroup,
            )
            // The first group has the keyboard and layout reads are answered for the main editor, yet no group event arrives and the group the editor named stays the named one: the chat's, or the main editor's group it named while the chat input had the keyboard. A text editor the first group shows is reported as the active text editor, a pane is not reported at all.
            if (
              leavesPaneFocusUnreportedBesideChat &&
              separateEditorPart &&
              ((staleNamedGroup ?? activeTabGroup) ===
                separateEditorPart.group ||
                separateEditorPart.focused)
            ) {
              staleNamedGroup = staleNamedGroup ?? activeTabGroup
              activeTabGroup = primaryGroup
              separateEditorPart.focused = false
              if (primaryGroup.activeTab?.input instanceof TabInputText)
                activeTextEditorChanged(focusedSourceEditor())
              return undefined
            }
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
            if (
              dueTabCloses.length &&
              (closeDisposedPanelTabsDuringLayoutRead || revealsPanelsLater)
            ) {
              // Cursor's closes arrive while the read is pending: the reader's listeners see them before the answer.
              await new Promise<void>((resolve) => setImmediate(resolve))
              for (const close of dueTabCloses) close()
              // A tab that closed in this read is followed by its emptied group in the same read.
              for (const close of pendingDisposedTabCloses.splice(0)) close()
              await new Promise<void>((resolve) => setImmediate(resolve))
            } else if (dueTabCloses.length)
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
            // With modelled side bars the main editor's columns are read in pixels of the area the bars leave, as the editor reports them.
            if (
              sideBars &&
              reportedLayout === editorLayout &&
              layout.orientation === 0
            ) {
              const areaPx =
                  windowWidthPx -
                  (sideBars.primary ? sideBarWidthsPx.primary : 0) -
                  (sideBars.auxiliary ? sideBarWidthsPx.auxiliary : 0),
                columns: { size: number; groups?: unknown[] }[] = layout.groups,
                total = columns.reduce((sum, column) => sum + column.size, 0)
              for (const column of columns)
                column.size = Math.round((column.size / total) * areaPx)
              if (maximizedEditorGroup)
                answerColumnsAsWhileMaximized(columns, areaPx)
            }
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
            // Both editors take the sizes as they are given: proportions over a grid of columns end as single pixels.
            if (proportionsAnsweredInPx)
              layout = proportionsAsPixels(layout, proportionsAnsweredInPx)
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
        createStatusBarItem: (id: string) => {
          createdStatusItemIds.push(id)
          return createdStatusItemIds.length === 1
            ? saveStatus
            : createStatusItem()
        },
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
        // An error notification of the reader has no button; it stays until the learner dismisses it.
        showErrorMessage: async (message: string): Promise<undefined> => {
          errorMessages.push(message)
          return undefined
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
        onDidChangeTextEditorSelection: (
          callback: (change: SelectionChange) => void,
        ) => {
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
          textDocumentShows.push({
            name: basename(sourceDocument.uri.path),
            viewColumn: options?.viewColumn,
            preserveFocus: Boolean(options?.preserveFocus),
          })
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
            // Cursor beside the chat: a text editor that takes the keyboard is reported as the active text editor, while the chat's group stays the named one until a tab or group changes (as after the command that focuses the first editor group).
            if (
              leavesPaneFocusUnreportedBesideChat &&
              separateEditorPart &&
              !showsAnotherTab &&
              ((staleNamedGroup ?? activeTabGroup) ===
                separateEditorPart.group ||
                separateEditorPart.focused)
            )
              staleNamedGroup = staleNamedGroup ?? activeTabGroup
            activeTabGroup = group
            innerFocusedPanel = undefined
            if (separateEditorPart) separateEditorPart.focused = false
            // A text document shown with the focus takes the keyboard from the page body.
            keyboardOnBody = false
            keyboardInView = false
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
              for (const listener of selectionListeners)
                listener({ textEditor: visible, selections, kind: undefined })
            },
          })
          visibleSourceEditors.push(visible)
          // A document that comes to the front of the active group is the active text editor from then on, also when it was shown preserving the focus: the editor names the text editor in front of the active group while no text editor has the keyboard.
          const comesToFrontOfActiveGroup =
            showsAnotherTab && group.viewColumn === activeTabGroup.viewColumn
          // A tab that opened or became the one its group shows changed the tabs; the same tab shown again did not.
          if (showsAnotherTab) replaceGroupObjects()
          if (!options?.preserveFocus || comesToFrontOfActiveGroup)
            activeTextEditorChanged(focusedSourceEditor())
          const displayed = nextSourceDisplay
          nextSourceDisplay = undefined
          displayed?.(editor)
          return (lastSourceEditor = editor)
        },
        tabGroups: {
          all: groups,
          get activeTabGroup() {
            return staleNamedGroup ?? activeTabGroup
          },
          onDidChangeTabs: (callback: (event: TabChanges) => void) => {
            const notify = (
              event: TabChanges = { opened: [], closed: [], changed: [] },
            ): void => {
              staleNamedGroup = undefined
              callback(event)
            }
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
          close: async (tabs: Tab[], preserveFocus?: boolean) => {
            tabCloseRequests.push([...tabs])
            if (rejectNextTabClose) {
              rejectNextTabClose = false
              throw new Error('Canceled')
            }
            // Closing the tab that has the keyboard while preserving the focus focuses nothing in its place.
            const closesFocusedTab =
              Boolean(preserveFocus) &&
              !separateEditorPart?.focused &&
              activeTabGroup.activeTab !== undefined &&
              tabs.includes(activeTabGroup.activeTab)
            const closed = closeTabs(tabs)
            if (closesFocusedTab && closed) keyboardOnBody = true
            return closed
          },
        },
      },
      debug: {
        // Unset unless a test pauses a debug session with `pauseDebugger`; the Application pane then always preserves the keyboard focus when it is revealed.
        get activeStackItem() {
          return activeStackItem
        },
        onDidChangeActiveStackItem: (listener: () => void) => {
          activeStackItemListeners.add(listener)
          return {
            dispose(): void {
              activeStackItemListeners.delete(listener)
            },
          }
        },
        registerDebugAdapterTrackerFactory: (
          _debugType: string,
          factory: typeof debugAdapterTrackerFactories extends Set<
            infer Factory
          >
            ? Factory
            : never,
        ) => {
          debugAdapterTrackerFactories.add(factory)
          return {
            dispose(): void {
              debugAdapterTrackerFactories.delete(factory)
            },
          }
        },
      },
      workspace: {
        getConfiguration: (section: string) => ({
          get: (key: string) => configuredValues()[`${section}.${key}`],
        }),
        onDidChangeConfiguration: (
          listener: (event: {
            affectsConfiguration(section: string): boolean
          }) => void,
        ) => {
          configurationListeners.add(listener)
          return {
            dispose(): void {
              configurationListeners.delete(listener)
            },
          }
        },
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
  /** Makes one more reader over the same fake editor and storage, as the extension does after a change of the workspace's folders; `handedOverArchives` are the study archives the reader before it could not save and released. @example const replacement = harness.createReader(undefined, harness.reader.releaseUnsavedStudies()) */
  const createReader = (
    extensionPath = join(harness.directory, 'extension'),
    handedOverArchives: ReturnType<
      WorkspaceReader['releaseUnsavedStudies']
    > = [],
  ) =>
    new boundary.StudyWorkspace(
      {
        extensionPath,
        globalStorageUri: { fsPath: join(harness.directory, 'storage') },
        subscriptions: [],
        workspaceState,
      },
      controls,
      handedOverArchives,
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
    /** Changes the Saved Study Limit setting and tells the reader, as the editor does when the learner edits Settings. @example harness.setSavedStudyCapacity(2) */
    setSavedStudyCapacity(value: unknown): void {
      savedStudyCapacity = value
      for (const listener of configurationListeners)
        listener({
          affectsConfiguration: (section) =>
            section === 'codebook' || section === 'codebook.savedStudyLimit',
        })
    },
    /** Every native warning dialog the reader opened, with its title, options and buttons. @example harness.warningDialogs[0].title */
    warningDialogs,
    /** Every native information message the reader showed, with its buttons. @example harness.informationMessages[0].message */
    informationMessages,
    /** The text of every native error notification the reader showed. @example harness.errorMessages[0] */
    errorMessages,
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
    /** Models the learner clicking into another list of the host (the Explorer) while Show Variables waits: that list holds the keyboard focus until a command focuses Variables again. @example harness.clickAnotherList() */
    clickAnotherList(): void {
      focusedList = 'another-list'
    },
    /** What the list commands did to the list the learner clicked. @example harness.anotherListView() // => { firstRowFocused: false, firstRowExpanded: false } */
    anotherListView(): { firstRowFocused: boolean; firstRowExpanded: boolean } {
      return { ...anotherList }
    },
    /** Models Cursor's side bar, which the Learning summary shares with Run and Debug: the Variables focus command then hides the summary. @example harness.shareSummarySideBarWithRunAndDebug() */
    shareSummarySideBarWithRunAndDebug(): void {
      summarySharesSideBarWithRunAndDebug = true
    },
    /** Reads a context key the reader set with the editor's `setContext` command. @example harness.contextKey('codebook.learningSummaryMovable') // => true */
    contextKey(key: string): unknown {
      return contextKeys.get(key)
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
    /** Every text the reader wrote to the editor's clipboard, in order. @example harness.clipboardTexts.at(-1) */
    clipboardTexts,
    /** Makes the editor's clipboard refuse every write from now on, as a clipboard another program holds does. @example harness.rejectClipboardWrites() */
    rejectClipboardWrites(): void {
      rejectsClipboardWrites = true
    },
    /** Lists the reader's answers to Copy paths in the order the webviews received them, so a test can assert which pane was answered and with what. @example harness.studyFilesCopyAnswers() // => [{ webview: 'context', answer: { type: 'study-files-copied', studyId, status: 'copied', count: 2 } }] */
    studyFilesCopyAnswers: () =>
      // Copied field by field: the reader's module builds the answer in its own realm, which a strict comparison tells apart.
      studyFilesCopyAnswers.map((entry) => ({
        webview: entry.webview,
        answer: { ...entry.answer },
      })),
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
    createdStatusItemIds,
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
    /** Gives the last Study message the bottom panel had received when its open request with this number was answered, so a test can assert that the message naming the entry arrived before the reply. @example harness.playbackPanelMessageAtReply(1)?.model.selection.studyId */
    playbackPanelMessageAtReply: (
      openRequest: number,
    ): StudyViewMessage | undefined =>
      playbackPanelMessagesAtReply.get(openRequest),
    presentationPreferences,
    watchedPatterns,
    viewportEvents,
    viewportInstances,
    nativePanels: () => [...panels],
    maximizedEditorGroup: () => maximizedEditorGroup,
    historicalDebugPresentations,
    historicalDebuggers,
    historicalDebugInvalidations: () => historicalDebugInvalidations,
    /** What each invalidation told the historical debugger its emptied session reads in Run and Debug, in order. @example harness.historicalDebugInvalidationLabels().at(-1) // => 'Not recorded at this moment' */
    historicalDebugInvalidationLabels: () => [
      ...historicalDebugInvalidationLabels,
    ],
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
    /** Gives the one-based line each visible source editor's cursor stands on, which is the line the reader highlighted there. @example harness.displayedSourceLines() // => [2] */
    displayedSourceLines: (): number[] =>
      visibleSourceEditors.map(
        (editor) => (editor.selections[0]?.active.line ?? 0) + 1,
      ),
    panelReveals: () => [...panelReveals],
    suppressNativeInnerFocus(): void {
      suppressNativeInnerFocus = true
      innerFocusedPanel = undefined
    },
    /**
     * Makes the fake editor take the keyboard from a pane's own document when that pane is revealed with the focus while its document already has it, and send no focus report afterwards; the editor goes on naming the pane as its active one. Both editors answer such a reveal by focusing the webview's outer frame (`this.element.contentWindow?.focus()` in the workbench), and that frame's page gives its inner document the focus back only when its own active element is not that document's frame (`if (document.activeElement === activeFrame) return` in the webview's `index.html`). Read in the bundles, not seen in a running editor: there 2 of 8 Arranges of a pane that had the keyboard got no focus report (Cycle 0046 row 338).
     * @example
     * await harness.reader.action('read-context')
     * harness.dropInnerFocusAtRevealOfFocusedPane()
     */
    dropInnerFocusAtRevealOfFocusedPane(): void {
      dropsInnerFocusAtRevealOfFocusedPane = true
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
    /** How many lines each source highlight call marked, in order; 0 is a cleared highlight. @example harness.decoratedRangeCounts().at(-1) // => 0 once the stop's highlight was cleared */
    decoratedRangeCounts: () => [...decoratedRangeCounts],
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
     * Makes the fake editor close a disposed panel's tab one task after it answered the next layout read, or by itself after {@link DISPOSED_TAB_CLOSE_DELAY_MS} when no layout read arrives, and then remove the group that tab left empty, as a busy VS Code 1.140 window does: its group view closes disposed editors from a worker with a 0 ms delay, so a layout read that arrived with the disposal is answered first, and `workbench.editor.closeEmptyGroups` is on by default.
     * Without it the tab leaves at once and the emptied group stays, which is the editor with `closeEmptyGroups` off.
     * @example harness.closeDisposedPanelTabsLater()
     */
    closeDisposedPanelTabsLater(): void {
      closeDisposedPanelTabsLater = true
    },
    /**
     * Makes the fake editor close a disposed panel's tab a moment after the disposal ({@link DISPOSED_TAB_CLOSE_DELAY_MS}), and the group that tab left empty while the next layout read is pending, as Cursor 3.23.12 was seen to at a live entry from the three-pane Study layout (Cycle 0045, owed check 2, take o2b: the context pane's tab closed about 100 ms after the entry began, at +440 ms, and its group at +451 ms, each with new objects for every group). A layout read that arrives before the tab closed is interrupted by both closes. The reader's listeners see a close before the read it interrupts is answered. That the group's close falls into a layout read is the model's choice of moment: the trace gives the order of the two closes and their distance of 11 ms, not what the reader awaited.
     * @example
     * harness.replaceGroupObjectsOnTabChanges()
     * harness.closeDisposedPanelTabsDuringLayoutRead()
     */
    closeDisposedPanelTabsDuringLayoutRead(): void {
      closeDisposedPanelTabsDuringLayoutRead = true
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
    /** Says whether no editor has the keyboard because the tab or pane that had it was closed and nothing was focused in its place; the page body then has it, as in the editor. Whatever gives an editor group, a text editor or the chat the keyboard ends that: a group focus command, Cursor's Focus Agent, a pane revealed or a document shown with the focus, the chat's `focus` and `focusTab`, and the learner's `focusMutableDraft`. @example harness.keyboardOnBody() // => true after tabGroups.close([focusedTab], true) */
    keyboardOnBody: () => keyboardOnBody,
    /**
     * Gives the fake window a primary and a secondary side bar that are open or closed, as the learner has them, and makes the fake editor behave as both editors were seen to (Cycle 0045 NF-22, obs15 P4): `workbench.action.maximizeEditorHideSidebar` hides both bars, and leaving that maximization (`workbench.action.minimizeOtherEditors`, a new layout, closing the panes) shows neither again. `workbench.action.closeSidebar` hides the primary one; `workbench.action.focusSideBar` and `workbench.action.focusAuxiliaryBar` show their bar when it is hidden and give it the keyboard. No API of the editor says which bars are open: a layout read of columns answers in pixels of the editor area the bars leave (214 + 660 + 461 = 1335 with both open).
     * @param open - Which of the two bars the learner has open.
     * @param widthsPx - The bars' widths in the window of 1335 px; left out, Cursor's 214 and 461.
     * @example
     * harness.modelSideBars({ primary: true, auxiliary: false })
     * harness.modelSideBars({ primary: false, auxiliary: true }, { primary: 300, auxiliary: 300 })
     */
    modelSideBars(
      open: { primary: boolean; auxiliary: boolean },
      widthsPx: { primary: number; auxiliary: number } = sideBarWidthsPx,
    ): void {
      sideBars = { ...open }
      sideBarWidthsPx = { ...widthsPx }
    },
    /** The side bars the fake window shows now, and whether one of them has the keyboard; `undefined` bars without `modelSideBars`. @example harness.sideBars() // => { primary: true, auxiliary: true, hasKeyboard: false } */
    sideBars: () => ({ ...sideBars, hasKeyboard: keyboardInSideBar }),
    /**
     * Makes the fake editor name another editor group as the active one for a moment when `workbench.action.minimizeOtherEditors` ends a group's maximization: one group event names that group while the command runs, and a second one, after the given time, names the group that had the keyboard again. This is how this cycle's row 4 explains a Restore refused as a learner's change in Cursor 3.23.12 although nobody touched the window (Cycle 0045 NF-7b, checks F8 and F6), after the same kind of moment Cycle 0045 NF-7 measured for the Application group (25 to 46 ms).
     * @param column - The view column of the group named for that moment.
     * @param durationMs - How long after the command the group that had the keyboard is named again.
     * @example harness.nameAnotherGroupWhenMaximizationEnds(2, 40)
     */
    nameAnotherGroupWhenMaximizationEnds(
      column: number,
      durationMs: number,
    ): void {
      transientGroupAtUnmaximize = { column, durationMs }
    },
    /**
     * Makes the fake window wider or narrower, as a learner who drags its edge: the side bars keep their widths and the editor area between them takes the difference, which the next layout read of columns reports.
     * @param widthPx - The window's new width; 1335 px until a test changes it.
     * @example harness.resizeWindow(1935) // the editor area is 600 px wider
     */
    resizeWindow(widthPx: number): void {
      windowWidthPx = widthPx
    },
    /**
     * Pauses the fake debugger: Run and Debug's active stack item is a stack frame, and the reader's listeners are told. Both editors report three states of that item, and this method with `resumeDebugger` is the only way to set them: none before a session's first stop (the state every harness starts in), a frame while the focused thread is stopped (this method), and that thread without a frame once the session runs again (`resumeDebugger`). Called again while a frame is active, it reports the next frame with no thread between the two, as an editor does for a thread that stops again within the 200 ms it waits before it reports a running session, and for a frame the learner selects in the Call Stack view. The editor has opened the paused file with the keyboard before it reports the frame (see `focusMutableDraft`; Cursor's and VS Code's debugger await that opening and select the frame after it), so a test focuses that file first.
     * @param options - `focusesEditorOnBreak` is the learner's `debug.focusEditorOnBreak` setting (left out, the editor's default, on, holds); `session` names another debug session than the live run's server; `reason` is what the adapter's `stopped` event gives (left out, `breakpoint`; `step` for a stop after the learner's step); `startedBeforeTheReader` leaves that event out, for a session whose adapter the reader does not hear; `opensWithKeyboard` lets the debugger open the paused file with the keyboard between that event and the frame, which is the editor's order (a test that focuses the file itself before this call has it active already when the event is sent); `staysInBackground` sends that event and nothing more, for a stop the editor does not bring to the front itself (both editors skip a stop while a frame of another session has the focus, which a session that went on keeps for about 200 ms; see `passFocusToStoppedSession` for what follows); `keepsFocus` is the adapter's `preserveFocusHint` in that event, its wish that the editor leave the focus where it is, which a test gives together with `staysInBackground`.
     * @example
     * harness.focusMutableDraft('actions.ts', 2)
     * harness.pauseDebugger()
     */
    pauseDebugger(
      options: {
        focusesEditorOnBreak?: boolean
        session?: string
        startedBeforeTheReader?: boolean
        reason?: string
        opensWithKeyboard?: { filename: string; column: number }
        staysInBackground?: boolean
        keepsFocus?: boolean
      } = {},
    ): void {
      const session = { id: options.session ?? 'live-next-server' }
      // The adapter's `stopped` event passes the trackers before the editor selects the frame; a session that started before the reader has none.
      if (!options.startedBeforeTheReader)
        for (const tracker of trackersOf(session))
          tracker?.onDidSendMessage?.({
            type: 'event',
            event: 'stopped',
            body: {
              reason: options.reason ?? 'breakpoint',
              threadId: 1,
              ...(options.keepsFocus ? { preserveFocusHint: true } : {}),
            },
          })
      // A stop the editor leaves in the background ends here: it opens no file and reports no frame.
      if (options.staysInBackground) return
      // The debugger opens the paused file with the keyboard after the adapter reported the stop and before the editor reports the frame.
      if (options.opensWithKeyboard)
        giveDraftKeyboard(
          openDraftTab(
            options.opensWithKeyboard.filename,
            options.opensWithKeyboard.column,
          ),
        )
      activeStackItem = {
        session,
        threadId: 1,
        frameId: nextStackFrameId++,
      }
      focusEditorOnBreak = options.focusesEditorOnBreak
      for (const listener of [...activeStackItemListeners]) listener()
    },
    /**
     * Selects another frame of the paused thread, by one of the three gestures the editor offers. The debug adapter reports nothing: no `stopped` event comes with a selection.
     * - `click` (left out): the Call Stack view's row chosen with one click. The editor opens that frame's file in front of a group without giving it the keyboard, and reports the frame. The keyboard stays where it is (see `focusView`, or the chat).
     * - `click-on-unopened-file-then-tab-update`: one click on a frame whose file was not open: the editor opens it as a preview tab without the keyboard and reports the frame; then it reports that tab once more with its state unchanged, as for a new label decoration.
     * - `double-click-after-tab-model-update`: a double click between whose two clicks the editor sent its whole tab model to the extension host, which in Cursor 3.23 builds every group and tab object anew (`$acceptEditorTabModel`: `this._extHostTabGroups=e.map(c=>new …(c,…))`), while VS Code 1.140 keeps the object of a tab it knows (`_reconcileTabs`): the kept tab is another object than the preview tab the frame opened.
     * - `double-click`: the same, and then the second click, for which the editor opens the same file again, with the keyboard and as a kept tab (both editors: the tree's double click opens with `preserveFocus` off and `pinned` on). The frame is the selected one already, so the editor reports no frame, no active text editor and no selection for it: only the tab changes, from a preview tab to a kept one. The file must be opened in the active group, as the editor does. Enter on the selected row does the same as the second click.
     * - `navigation-command`: the editor's "Navigate Up/Down Call Stack" commands, which open the frame's file with the keyboard and then report the frame (both editors: `focusStackFrame` with `preserveFocus` off). What the editor reports is the same as for a click: the file's opening, then the frame.
     * @param filename - The frame's file.
     * @param column - The view column of the group the editor opens it in.
     * @param gesture - How the learner selects the frame.
     * @returns The document the editor opened.
     * @example
     * harness.focusView()
     * harness.selectStackFrame('login-form.tsx', 2)
     */
    selectStackFrame(
      filename: string,
      column: number,
      gesture:
        | 'click'
        | 'double-click'
        | 'double-click-after-tab-model-update'
        | 'click-on-unopened-file-then-tab-update'
        | 'navigation-command' = 'click',
    ) {
      assert.ok(isFakeStackFrame(activeStackItem), 'No debug session is paused')
      const isDoubleClick = gesture.startsWith('double-click')
      const opensPreview =
        isDoubleClick || gesture.startsWith('click-on-unopened-file')
      const opened = openDraftTab(filename, column, opensPreview)
      if (gesture === 'navigation-command') giveDraftKeyboard(opened)
      // Only the active group's editor is reported as the active text editor, and none while the chat's own part is the named one.
      else activeTextEditorChanged(focusedSourceEditor())
      activeStackItem = { ...activeStackItem, frameId: nextStackFrameId++ }
      for (const listener of [...activeStackItemListeners]) listener()
      // The editor reports the preview tab once more without a change of its state (its label got a decoration): it is a preview tab still.
      if (gesture === 'click-on-unopened-file-then-tab-update')
        for (const listener of tabChangeListeners)
          listener({ opened: [], closed: [], changed: [opened.tab] })
      if (!isDoubleClick) return opened.document
      // The second click: the same file, with the keyboard and kept open.
      assert.equal(opened.group, activeTabGroup)
      // Between the clicks the editor sent its whole tab model, and Cursor's extension host built every tab object anew: the group shows another object for the same tab, and the object of before answers what it answered last.
      const keptTab =
        gesture === 'double-click-after-tab-model-update'
          ? { ...opened.tab }
          : opened.tab
      opened.group.tabs.splice(
        opened.group.tabs.indexOf(opened.tab),
        1,
        keptTab,
      )
      opened.group.activeTab = keptTab
      keptTab.isPreview = false
      keyboardInView = false
      keyboardOnBody = false
      for (const listener of tabChangeListeners)
        listener({ opened: [], closed: [], changed: [keptTab] })
      return opened.document
    },
    /**
     * Reports a fresh object for the active text tab before any frame, editor or selection event, for the third-sign regressions of {@link StudyWorkspace}.
     * @param state - The current tab's preview and dirty values, and an optional replacement file or view column.
     * @returns The previous tab object, whose values stay as last reported.
     * @example harness.reportActiveTextTab({ isPreview: false, isDirty: false })
     */
    reportActiveTextTab(state: {
      isPreview: boolean
      isDirty: boolean
      filename?: string
      column?: number
    }): Tab {
      const previous = activeTabGroup.activeTab
      assert.ok(previous?.input instanceof TabInputText)
      const replacement = {
        ...previous,
        input: state.filename
          ? new TabInputText(Uri.file(join(harness.directory, state.filename)))
          : previous.input,
        isPreview: state.isPreview,
        isDirty: state.isDirty,
      }
      activeTabGroup.tabs = activeTabGroup.tabs.map((tab) =>
        tab === previous ? replacement : tab,
      )
      activeTabGroup.activeTab = replacement
      // A group move can change its column without any text-editor or selection event.
      if (state.column !== undefined) activeTabGroup.viewColumn = state.column
      for (const listener of tabChangeListeners)
        listener({ opened: [], closed: [], changed: [replacement] })
      return previous
    },
    /**
     * Gives the text editor in front of the active group the keyboard as a learner's click into its text does, or shows the learner at work in it with the keyboard (a cursor key, a typed letter): the editor reports the new selection as one made with the mouse or with the keyboard, and nothing else when that editor was the active text editor already (the active tab group, its tab and the active text editor stay as they are).
     * @param by - What the learner used.
     * @example
     * harness.selectStackFrame('login-form.tsx', 2)
     * harness.workInActiveTextEditor('mouse')
     */
    workInActiveTextEditor(by: 'mouse' | 'keyboard'): void {
      assert.ok(!separateEditorPart?.focused, 'The chat has the keyboard')
      const editor = focusedSourceEditor()
      assert.ok(editor, 'No text editor is in front of the active group')
      keyboardInView = false
      keyboardOnBody = false
      for (const listener of selectionListeners)
        listener({
          textEditor: editor,
          selections: editor.selections,
          kind: by === 'keyboard' ? 1 : 2,
        })
    },
    /**
     * Opens a file in front of a group without giving it the keyboard, as the Explorer does at one click, as an agent does for a file it edits, and as the editor's debugger does for the paused file while the learner's `debug.focusEditorOnBreak` is off: the tab is a preview tab, the editor reports it as the active text editor when the group is the active one, and the keyboard stays where it is.
     * @param filename - The file.
     * @param column - The view column of the group.
     * @example
     * harness.focusView()
     * harness.openFileWithoutKeyboard('page.tsx', 1)
     */
    openFileWithoutKeyboard(filename: string, column: number): void {
      openDraftTab(filename, column, true)
      activeTextEditorChanged(focusedSourceEditor())
    },
    /**
     * Moves the selection of the text editor in front of the active group as a command does: the editor's own jump to a line (Go to Line, a frame of the same file selected again) or a selection an extension sets. The editor reports the change with the kind of a command, and the keyboard stays where it is.
     * @example
     * harness.selectStackFrame('login-form.tsx', 2)
     * harness.jumpInActiveTextEditor()
     */
    jumpInActiveTextEditor(): void {
      const editor = focusedSourceEditor()
      assert.ok(editor, 'No text editor is in front of the active group')
      for (const listener of selectionListeners)
        listener({ textEditor: editor, selections: editor.selections, kind: 3 })
    },
    /**
     * Lets a debug adapter tell the editor that its stacks are no longer valid, as an adapter does when what a paused thread shows changed: the session's trackers see the `invalidated` event, and the editor then handles the session's stop again (both editors: `onDidInvalidated` runs the stop handling for every stored stop), which opens the paused file with the keyboard and reports a frame. No `stopped` event comes with it.
     * @param paused - The paused file the editor opens with the keyboard.
     * @example harness.invalidateStacks({ filename: 'actions.ts', column: 1 })
     */
    invalidateStacks(paused: { filename: string; column: number }): void {
      assert.ok(isFakeStackFrame(activeStackItem), 'No debug session is paused')
      for (const tracker of trackersOf(activeStackItem.session))
        tracker?.onDidSendMessage?.({
          type: 'event',
          event: 'invalidated',
          body: { areas: ['stacks'] },
        })
      giveDraftKeyboard(openDraftTab(paused.filename, paused.column))
      activeStackItem = { ...activeStackItem, frameId: nextStackFrameId++ }
      for (const listener of [...activeStackItemListeners]) listener()
    },
    /**
     * Ends a debug session as the editor does when the learner stops it or the debugged program exits: the session's trackers are told that the adapter is stopped and that it exited, the editor forgets them, and Run and Debug has no active stack item any more when it showed that session.
     * @param sessionId - The session; left out, the live run's server session.
     * @example
     * harness.pauseDebugger()
     * harness.endDebugSession()
     */
    endDebugSession(sessionId = 'live-next-server'): void {
      const trackers = debugAdapterTrackers.get(sessionId) ?? []
      debugAdapterTrackers.delete(sessionId)
      for (const tracker of trackers) {
        tracker?.onWillStopSession?.()
        tracker?.onExit?.(0, undefined)
      }
      if (activeStackItem?.session.id !== sessionId) return
      activeStackItem = undefined
      for (const listener of [...activeStackItemListeners]) listener()
    },
    /**
     * Lets a paused session go on as the editor tells its adapter: the session's trackers see the `continue` request. Run and Debug's active stack item stays as it is: the editor keeps the frame for about 200 ms (`resumeDebugger` is what it reports then).
     * @param sessionId - The session; left out, the live run's server session.
     * @example
     * harness.pauseDebugger({ session: 'live-next-browser' })
     * harness.continueDebugSession('live-next-browser')
     */
    continueDebugSession(sessionId = 'live-next-server'): void {
      for (const tracker of trackersOf({ id: sessionId }))
        tracker?.onWillReceiveMessage?.({
          type: 'request',
          command: 'continue',
          arguments: { threadId: 1 },
        })
    },
    /**
     * Brings a stopped session to the front as the editor does 800 ms after the session it showed went on (`passFocusScheduler` of VS Code 1.140 and Cursor 3.23, which focuses the frame preserving the focus): it opens the frame's file in front of a group without giving it the keyboard, and reports the frame of that session. No `stopped` event comes with it: the adapter sent that one when the session stopped (`pauseDebugger` with `staysInBackground`).
     * @param sessionId - The stopped session.
     * @param filename - The frame's file.
     * @param column - The view column of the group the editor opens it in.
     * @example
     * harness.pauseDebugger({ staysInBackground: true })
     * harness.passFocusToStoppedSession('live-next-server', 'actions.ts', 1)
     */
    passFocusToStoppedSession(
      sessionId: string,
      filename: string,
      column: number,
    ): void {
      openDraftTab(filename, column)
      // Only the active group's editor is reported as the active text editor, and none while the chat's own part is the named one.
      activeTextEditorChanged(focusedSourceEditor())
      activeStackItem = {
        session: { id: sessionId },
        threadId: 1,
        frameId: nextStackFrameId++,
      }
      for (const listener of [...activeStackItemListeners]) listener()
    },
    /**
     * Gives a view that is no editor the keyboard, as a learner's click into the Call Stack view of Run and Debug does. The editor reports nothing of it to an extension: the active tab group, its tab and the active text editor stay as they are; only the chat's own part loses the keyboard.
     * @example harness.focusView()
     */
    focusView(): void {
      keyboardInView = true
      keyboardOnBody = false
      if (separateEditorPart) separateEditorPart.focused = false
    },
    /** Says whether a view that is no editor still has the keyboard; see `focusView`. @example harness.keyboardInView() // => false after the reader showed a document with the focus */
    keyboardInView: () => keyboardInView,
    /**
     * Lets the paused session run again as the editor reports it: the active stack item becomes the thread without a frame, which both editors report from about 200 ms after the focused session went on running until it stops again (VS Code 1.140 and Cursor 3.23: `registerSessionListeners` sets the view model's focus to the thread alone after that delay). Until a test calls this, the frame of the pause is still the active item, as it is in the editor during those 200 ms. No editor reports "no item" for a session that continued.
     * @example
     * harness.pauseDebugger()
     * harness.resumeDebugger()
     */
    resumeDebugger(): void {
      assert.ok(isFakeStackFrame(activeStackItem), 'No debug session is paused')
      activeStackItem = {
        session: activeStackItem.session,
        threadId: activeStackItem.threadId,
      }
      for (const listener of [...activeStackItemListeners]) listener()
    },
    /**
     * Brings the live run's Application pane to the front over the file the debugger focused at a pause, as its viewport does at the end of a capture when the debugger opened that file in the pane's group: the reader is asked through the lease to give the keyboard back first, and the pane takes it, and tells the reader, only when the reader gave it to nobody.
     * @returns Once the pane is revealed and, where it took the keyboard, the reader was told.
     * @example
     * harness.pauseDebugger()
     * await harness.revealApplicationPaneOverPausedFile()
     */
    async revealApplicationPaneOverPausedFile(): Promise<void> {
      const viewport = viewportInstances.findLast(
        (candidate) => candidate.mode === 'live',
      )
      assert.ok(viewport)
      await viewport.revealOverPausedFile()
    },
    /**
     * Makes the fake editor let the keyboard fall to the page body when it removes an editor group whose last tab closed while a text editor of another group has the keyboard, as Cursor 3.23.12 was seen to after "Codebook: Close Study Workspace" with the learner's own file active (Cycle 0046 row 66: the captured source's group closed, the grid was rebuilt and `document.activeElement` was the page body 20 ms later). The same happens while a page of the editor that is no text editor (its Settings, a tab without a known input) is the tab in front of the active group: such a page lies in the same grid as a text editor, so the model treats it alike, although no trace shows that case yet (Cycle 0046 row 140). Groups are removed only with `closeDisposedPanelTabsLater`.
     * @example
     * harness.closeDisposedPanelTabsLater()
     * harness.loseKeyboardWhenGroupCloses()
     */
    loseKeyboardWhenGroupCloses(): void {
      losesKeyboardWhenGroupCloses = true
    },
    /**
     * Keeps a pane's `active` flag set although another group takes the focus, until the test releases it: the editor reports a pane's view state on its own channel, so the flag can still read `true` when the tab and group events of a click elsewhere have arrived. The release clears the flag and tells the pane's view-state listeners, with no tab, group or active-editor event. Which of the two channels Cursor delivers last for a click from a pane into its chat is not recorded; the reader must not depend on it.
     * @param kind - The view type of the pane whose flag stays set.
     * @returns `release`, which clears the flag and reports the pane's view state.
     * @example
     * const held = harness.holdPaneDeactivation('codebook.studyContext')
     * chat.focusTab()
     * held.release()
     */
    holdPaneDeactivation(kind: string) {
      heldActivePane = kind
      return {
        release(): void {
          heldActivePane = undefined
          for (const held of panels)
            if (held.kind === kind) held.notifyViewState()
        },
      }
    },
    /**
     * Makes a pane revealed with the keyboard take it {@link LATE_WEBVIEW_FOCUS_DELAY_MS} after `reveal()` returned: the pane is in front at once, and the focus reaches its frame a moment later, after whatever the extension ran right behind the reveal. A reveal that preserves the focus is applied as before.
     * @example harness.focusRevealedPanesLater()
     */
    focusRevealedPanesLater(): void {
      focusesRevealedPanesLater = true
    },
    /**
     * Makes the fake editor remove the group a disposed pane's tab left empty {@link EMPTIED_GROUP_CLOSE_DELAY_MS} after that tab closed, instead of in the same turn, as Cursor 3.23.12 was seen to at "Codebook: Close Study Workspace" (Cycle 0046 row 66, `r1c3.tabs.json`: the captured source's group closed 57 ms after its tab, the Study pane's 12 ms after its tab). The tab's close is reported at once. Only the groups of disposed panes are delayed, and only in the model of `closeDisposedPanelTabsLater`.
     * @example
     * harness.closeDisposedPanelTabsLater()
     * harness.removeEmptiedGroupsLater()
     */
    removeEmptiedGroupsLater(): void {
      removesEmptiedGroupsLater = true
    },
    /** Lists every text document the reader showed, in order, with its group and whether the keyboard focus was left where it was. @example harness.textDocumentShows().at(-1) // => { name: 'Captured-theme.ts', viewColumn: 2, preserveFocus: false } */
    textDocumentShows: () => [...textDocumentShows],
    /**
     * Makes the fake editor bring a revealed pane to the front of its group after `reveal()` returned: while the next layout read is pending, or by itself after {@link DISPOSED_TAB_CLOSE_DELAY_MS} when no layout read arrives, with the tab and group events of that change arriving then, as an editor does whose reveal is a request to another process (the hypothesis of Cycle 0045 row NF-20 for Cursor: "Open replay" read its own reveal of the Application pane as a change the learner made). A reveal that moves the pane to another column, and one of a pane that is in front already, are applied at once as before.
     * @example harness.revealPanelsLater()
     */
    revealPanelsLater(): void {
      revealsPanelsLater = true
    },
    /**
     * Makes the fake editor answer `workbench.action.focusFirstEditorGroup` the way Cursor 3.23.12 was seen to while the chat has the keyboard, whether it names the chat's group as the active tab group (Cycle 0045: owed check 1, take A1, and obs15 P2) or a group of the main editor (obs15 R: a recording opened from the chat input while the editor named the captured source's group): the first group takes the keyboard and layout reads are answered for the main editor from then on, but no group event arrives and the named group stays the active tab group until the next tab or group change rebuilds the tab model. A text editor the first group shows is reported as the active text editor (`onDidChangeActiveTextEditor`); a pane (the Application pane) is not reported at all, and its `active` flag stays false.
     * @example
     * const chat = harness.addSeparateEditorPart()
     * harness.leavePaneFocusUnreportedBesideChat()
     * chat.focusTab()
     */
    leavePaneFocusUnreportedBesideChat(): void {
      leavesPaneFocusUnreportedBesideChat = true
      // This is Cursor, which also replaces every tab group object with each tab change; that rebuild is what corrects the stale name.
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
    /**
     * Makes the fake editor answer a layout that is given in proportions as both editors answered it natively when the reader applied the three-pane layout over the learner's two columns and the Study pane's new column: each group but the last of its siblings at one pixel, the last with the rest (VS Code 1.140.0: a first column of 1 px with rows of 1 and 687 px beside 1269 px; Cursor 3.23.12: 1 px with rows of 1 and 657 px beside 659 px; Cycle 0046 row 340). A layout given in pixels is kept as given. The workbench bundles take every given size as it is and scale none, and show nothing that treats a grid of columns differently; that the same proportions give the split over a single group is what the running editors do.
     * @param areaPx - The editor area the last siblings fill.
     * @example harness.answerProportionsAsPixels({ width: 1270, height: 688 })
     */
    answerProportionsAsPixels(areaPx: { width: number; height: number }): void {
      proportionsAnsweredInPx = { ...areaPx }
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
          keyboardOnBody = false
          keyboardInView = false
          activeTextEditorChanged(undefined)
        },
        /** Gives the chat tab the keyboard focus the way Cursor reports it: its group is the active tab group, no text editor is active, and a layout read is answered for the chat's own part. @example chat.focusTab() */
        focusTab(): void {
          const previous = activeTabGroup
          activeTabGroup = separateEditorPart!.group
          separateEditorPart!.focused = true
          keyboardOnBody = false
          keyboardInView = false
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
      const opened = openDraftTab(filename, column)
      const { document, tab, editor, replaceText } = opened
      giveDraftKeyboard(opened)
      return {
        document,
        tab,
        editor,
        replaceContent(value: string): void {
          replaceText(value)
        },
        focus(): void {
          giveDraftKeyboard(opened)
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
      // The fake editor of a closed harness changes nothing any more: its pending tab closes and reveals are dropped with their timers.
      for (const timer of pendingEditorTimers) clearTimeout(timer)
      pendingEditorTimers.clear()
      pendingDisposedTabCloses.length = 0
      await harness.close()
    },
    /** Counts the fake editor's own timers that have not run yet: every later change it still owes ({@link runEditorChangeLater}), for example a disposed pane's tab close or a late reveal that waits for {@link DISPOSED_TAB_CLOSE_DELAY_MS}. @example harness.pendingEditorTimerCount() // => 2 right after a reader with two panes was closed in an editor that closes tabs later */
    pendingEditorTimerCount: (): number => pendingEditorTimers.size,
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
 * @param duringStop - Runs once the stop committed at 100 ms and before the run continues (900 ms) or stops (200 ms without `recordedDebugger`), so a test can save an explanation at a recorded time inside the stop by setting the clock first.
 * @example const harness = await recordedReaderHarness(true, true)
 */
export async function recordedReaderHarness(
  capturedApplication = false,
  recordedDebugger = false,
  /** Column of the declared line at which the debugger bound and captured the stop; another column than the declared 1 gives a moved-column study. Used with `recordedDebugger`. */
  boundColumn = 1,
  duringStop?: (
    stopped: Awaited<ReturnType<typeof workspaceHarness>>,
  ) => Promise<void>,
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
  await duringStop?.(harness)
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
    /** Names the debug sessions whose adapters the reader follows now: those that started while it existed and have not ended. @example readerSeams(harness).followedDebugSessions() // => ['live-next-server'] while that session lives */
    followedDebugSessions: (): string[] => [...reader['followedSessions']],
    /** Runs one reader refresh, as the reader's timer does. */
    refresh: (): Promise<void> => reader['refresh'](),
    /** Stops the reader's own refresh timer, which runs in real time once a service is attached, so that the refreshes a test asks for are the only ones. A refresh a test asks for while one of the timer's is under way is answered when that one's reading ends, before the entry or the look that follows it. @example readerSeams(harness).stopOwnTimer() */
    stopOwnTimer: (): void => {
      clearInterval(reader['timer'])
      reader['timer'] = undefined
    },
    /** Asks the reader which command gives a remembered tab's group the keyboard back, as the function its focus return runs does once it may give the focus back: after an arrangement, or at a pause. @example await readerSeams(harness).focusReturnCommand(harness.groups[0], false) // => undefined while the group's editor part is not known */
    focusReturnCommand: (
      group: { viewColumn: number },
      atPause: boolean,
    ): Promise<string | undefined> =>
      Reflect.apply(reader['focusReturnCommand'], reader, [group, atPause]),
    /** Publishes the reader's state to its panes and its status bar item, as every change of the reader does. */
    publish: (): void => reader['publish'](),
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
    /** Says whether the selected captured source reached an active native tab, as the reader requires before a control or a reveal succeeds. */
    isSourceShown: (): boolean => reader['sourceReady'](),
    isRecordingActive: (): boolean => reader['recordingActive'],
    isLiveArrangement: (): boolean => reader['liveComposition'],
    /** Makes one checkpoint of a run, forced as Retry storage and retirement force it. */
    checkpoint: (
      ...input: Parameters<WorkspaceReader['checkpoint']>
    ): Promise<void> => reader['checkpoint'](...input),
    /** The reader's checkpoint of one run; a test replaces it to fail a forced checkpoint before anything is written, as a capture that changed under it does. */
    get checkpointStep(): WorkspaceReader['checkpoint'] {
      return reader['checkpoint'].bind(reader)
    },
    set checkpointStep(step: WorkspaceReader['checkpoint']) {
      reader['checkpoint'] = step
    },
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

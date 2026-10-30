// Shared editor fakes stay process-local; workspace test files run in isolated Node workers.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { afterEach } from 'node:test'
import { promisify } from 'node:util'

import {
  APPLICATION_GROUP_MARKER_KEY,
  CURSOR_FOCUS_AGENT_COMMAND,
  NATIVE_DEBUG_FOCUS_SESSION_COMMAND,
  type ReaderErrorKind,
} from '../constants'
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
import type { RepositoryViewMessage } from '../repositoryView'
import type { ConfiguredRuntimeView } from '../runtime'
import { codebookStopLedger } from '../runtimeSupport/codebookStopLedger'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { ViewportAckTimeoutError } from '../runtimeSupport/utils/viewportAckTimeoutError'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type * as StudyWorkspaceModule from '../studyWorkspace'
import type { StudyFilesCopied, StudyViewMessage } from '../ui/studyHtml'
import { bookObservationHash } from '../utils/bookObservationHash'
import type { NodeTestOutputUpdate } from '../utils/installNodeTestOutput'
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
/** How long after a pane's disposal the fake Cursor group model reports the next tab active, before it closes the disposed tab (`activateNextTabBeforeDisposedPaneTabCloses`); shorter than {@link DISPOSED_TAB_CLOSE_DELAY_MS}. */
const NEXT_TAB_ACTIVATION_DELAY_MS = 8
/** How long after a disposed pane's tab closed the fake editor removes the group that tab left empty, in the model of `removeEmptiedGroupsLater`: Cursor 3.23.12 removed the captured source's group 57 ms after its tab at "Codebook: Close Study Workspace", and the Study pane's 12 ms after its tab (Cycle 0046 row 66). The longer of the two is modelled: it is longer than one poll of the reader's wait for the panes' tabs, so the group is still there when that wait ends. */
const EMPTIED_GROUP_CLOSE_DELAY_MS = 57
/** How long after a pane's move into another group the fake editor removes the group the move left empty, in the model of `removeGroupLeftByPanelMoveLater`: VS Code 1.140.0 closes a moved webview's editor in its old group only once the open in the new group has begun (`workbench.desktop.main.js` 4037:7120 calls the old group's `closeEditor` from `onWillOpenEditor`), and that close awaits its confirmation before it removes the emptied group (1106:79300, 1106:79400, 1106:80531); in C58 round 1d the leftover was gone about 130 ms after the Application's move (frames at +0.45 s and +0.58 s, group events +513 to +571 ms of the Return; Cycle 0046 row 658). */
const MOVED_PANE_GROUP_REMOVAL_DELAY_MS = 130
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

/** The errors that listeners of `onDidChangeVisibleTextEditors` threw in tests whose harness closed since the last hook run; reported once by the `afterEach` hook below, so the failure stands beside the test's own assertion error and never replaces it (F405). */
const unreportedListenerErrors: unknown[] = []

/**
 * Hands out and forgets the listener errors that harness `close` recorded, as the hook below reports them; also read by the fidelity test of that hand-over.
 * @returns The errors recorded since the last call; an empty list when none, and after a call there is none left to report.
 * @example expect(takeUnreportedListenerErrors()).toHaveLength(0)
 */
export function takeUnreportedListenerErrors(): unknown[] {
  return unreportedListenerErrors.splice(0)
}

// A hook failure is reported by the runner apart from the test body's own failure, and only once, whatever number of times a test closes its harness.
afterEach(() => {
  const errors = takeUnreportedListenerErrors()
  if (errors.length > 0)
    throw new AggregateError(
      errors,
      `A listener of onDidChangeVisibleTextEditors threw ${errors.length} time(s) during the test: ${errors.map(String).join('; ')}`,
    )
})

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
  // The ledger is shared by the module's every reader: a verdict of an earlier test's stop must not decide this one's.
  codebookStopLedger.reset()
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
  let answerErrorDialog: (
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
    NATIVE_DEBUG_FOCUS_SESSION_COMMAND,
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
    let shownText = ''
    let shownTooltip = ''
    return {
      name: '',
      /** Every text or tooltip assignment, and every show or hide call: each one is a message to the status bar. */
      redraws: 0,
      get text(): string {
        return shownText
      },
      set text(value: string) {
        this.redraws++
        shownText = value
      },
      get tooltip(): string {
        return shownTooltip
      },
      set tooltip(value: string) {
        this.redraws++
        shownTooltip = value
      },
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
        this.redraws++
        this.visible = true
      },
      hide(): void {
        this.redraws++
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
    private readonly listeners = new Set<(value: unknown) => void>()
    event = (listener: (value: unknown) => void) => {
      this.listeners.add(listener)
      return {
        dispose: (): void => {
          this.listeners.delete(listener)
        },
      }
    }
    fire(value?: unknown): void {
      // Tree notifications use undefined; document changes retain their URI and never count as outline rebuilds.
      if (value === undefined) outlineUpdates++
      for (const listener of this.listeners) listener(value)
    }
    dispose(): void {
      this.listeners.clear()
    }
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
    // The editor's Uri keeps the query and the fragment it is given (a Repository Wiki citation names its source's hash in the query) and writes them after the path.
    static from(value: {
      scheme: string
      authority: string
      path: string
      query?: string
      fragment?: string
    }) {
      return new Uri(
        value.scheme,
        value.authority,
        value.path,
        value.query,
        value.fragment,
      )
    }
    static file(path: string) {
      return new Uri('file', '', path)
    }
    toString() {
      const query = this.query ? `?${this.query}` : '',
        fragment = this.fragment ? `#${this.fragment}` : ''
      return `${this.scheme}://${this.authority}${this.path}${query}${fragment}`
    }
  }
  class TabInputText {
    constructor(readonly uri: Uri) {}
  }
  /** A diff editor's tab input, as both editors' extension hosts export it: the original and the modified document (Cycle 0046 row 688). */
  class TabInputTextDiff {
    constructor(
      readonly original: Uri,
      readonly modified: Uri,
    ) {}
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
  /** VS Code's input of a chat editor tab (Chat: Open Chat in Editor): a class without properties, which the extension host exports as `vscode.TabInputChat` while the API's typings do not name it (1.140.0 `extensionHostProcess.js` 173:38462, 163:116170, 295:178349). */
  class TabInputChat {}
  /** The input of a terminal in the editor area (Terminal: Create Terminal in Editor Area), which both editors type as `TabInputTerminal`. */
  class TabInputTerminal {}
  /** The input of a merge editor's tab, which both editors' extension hosts export as `vscode.TabInputTextMerge` while the API's typings do not name it (VS Code 1.142.0 and Cursor 3.23.23 `extensionHostProcess.js`; Cycle 0046 Q7). */
  class TabInputTextMerge {
    constructor(
      readonly base: Uri,
      readonly input1: Uri,
      readonly input2: Uri,
      readonly result: Uri,
    ) {}
  }
  /**
   * The editor's `MarkdownString` as far as the reader uses it: text appended with `appendText` is escaped the way VS Code escapes it (backslash-escaped Markdown syntax tokens, a no-break space per blank, an escaped quote marker and line break), so a test reads what the hover would render.
   * @example new MarkdownString().appendText('a[b](c)').value // => 'a\\[b\\]\\(c\\)'
   */
  class MarkdownString {
    value: string
    isTrusted: boolean | undefined = undefined
    constructor(value = '') {
      this.value = value
    }
    appendText(text: string): this {
      this.value += text
        .replace(/[\\`*_{}[\]()#+\-!~]/g, '\\$&')
        .replace(/([ \t]+)/g, (_match, blanks: string) =>
          '&nbsp;'.repeat(blanks.length),
        )
        .replace(/>/gm, '\\>')
        .replace(/\n/g, '\n\n')
      return this
    }
  }
  /** The editor's `CodeLens`: a line of text above a range, with an optional command. */
  class CodeLens {
    constructor(
      readonly range: unknown,
      readonly command?: { title: string; command: string },
    ) {}
  }
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
    readonly start: Position
    readonly end: Position
    // As the editor's Range: two positions, or the start's line and character and the end's (a Repository Wiki citation's lines, createRepositoryWikiReader).
    constructor(start: Position, end: Position)
    constructor(
      startLine: number,
      startCharacter: number,
      endLine: number,
      endCharacter: number,
    )
    constructor(
      start: Position | number,
      end: Position | number,
      endLine = 0,
      endCharacter = 0,
    ) {
      // Numbers name the start's line and character, then the end's.
      this.start =
        typeof start === 'number'
          ? new Position(start, typeof end === 'number' ? end : 0)
          : start
      this.end =
        typeof end === 'number' ? new Position(endLine, endCharacter) : end
    }
    contains(value: Position | Range): boolean {
      return value instanceof Range
        ? this.contains(value.start) && this.contains(value.end)
        : value.line >= this.start.line && value.line <= this.end.line
    }
    with(start = this.start, end = this.end) {
      return new Range(start, end)
    }
  }
  /** A tab of the fake tab model. Its `label` is a string for every tab, as both editors' tab models give it: the name of the tab's editor input (VS Code 1.140.0 `workbench.desktop.main.js` 725:2597, Cursor 3.23.12 17269:26483 `label:t.getName()`); a tab without one made a comparison of labels true for any two unlabelled tabs (Cycle 0046 row 664). */
  type Tab = {
    input: TabInputText | TabInputTextDiff | TabInputWebview | TabInputUnknown
    label: string
    isPreview?: boolean
    isDirty?: boolean
    isPinned?: boolean
  }
  /**
   * Names a text tab as both editors do, by the base name of its document's path ({@link Tab}'s `label`); called wherever the fake editor opens a text tab.
   * @param uri - The tab's document.
   * @returns The last segment of the document's path.
   * @example textTabLabel(Uri.file('/repository/src/login-form.tsx')) // => 'login-form.tsx'
   */
  const textTabLabel = (uri: Uri): string => basename(uri.path)
  const groups: {
    viewColumn: number
    tabs: Tab[]
    activeTab?: Tab
    locked?: boolean
  }[] = [
    { viewColumn: 2, tabs: [] },
    { viewColumn: 1, tabs: [] },
  ]
  let activeTabGroup = groups[0]!
  /**
   * Places a tab the fake editor opens in a group, or moves into it, right after the tab that group shows, as both editors place an editor under their default `workbench.editor.openPositioning` (`right`: `targetIndex = indexOfActive + 1` in VS Code's `EditorGroupModel.openEditor`); called by `showTextDocument` for a document the group has no tab of, and by a pane's creation and move into another group. C60's `c60-cu-567` read it in Cursor 3.23.12: `Captured-source.mts` opened right after the Wiki's cited copy in front of the learner's first group (`3-recording-open.json`), and the parked `codebook · Recorded application` right after the Repository Wiki in front of its group (`5-after-return.json`; Cycle 0046 row 703). The test fixtures' own tabs keep their places.
   * @param group - The group the tab opens in.
   * @param tab - The new tab, in no group yet.
   * @param shownTab - The tab the group showed before the tab came; left out, the one it shows now.
   * @param shownIndex - Where `shownTab` stood then; a shown tab gone since (a preview pane the moved one replaced) leaves its place to the new tab.
   * @example
   * ```ts
   * insertAfterShownTab(firstGroup, sourceTab) // [login-form.tsx, cited copy, package.json] => [login-form.tsx, cited copy, Captured-source.mts, package.json] while the cited copy is in front
   * insertAfterShownTab(emptyGroup, applicationTab) // => [applicationTab]
   * ```
   */
  function insertAfterShownTab(
    group: (typeof groups)[number],
    tab: Tab,
    shownTab = group.activeTab,
    shownIndex = shownTab ? group.tabs.indexOf(shownTab) : -1,
  ): void {
    const stillShownIndex = shownTab ? group.tabs.indexOf(shownTab) : -1
    // The shown tab is still there: the new one follows it.
    if (stillShownIndex >= 0) group.tabs.splice(stillShownIndex + 1, 0, tab)
    // The shown tab went while the new one came: the new one takes its place.
    else if (shownIndex >= 0 && shownIndex <= group.tabs.length)
      group.tabs.splice(shownIndex, 0, tab)
    // A group that showed no tab gets the new one at its end.
    else group.tabs.push(tab)
  }
  let separateEditorPart:
    | {
        group: (typeof groups)[number]
        tab: Tab
        layout: unknown
        /** Says that the chat input of this part has the keyboard. */
        focused: boolean
        /** Says that this part is the editor part the editor counts as active: a layout read answers for it, its active editor is the editor's active editor (so no text editor is active and no pane of the main editor is), and the group focus commands of the active group act on its group. Cursor makes the part that took the focus last its active part among the parts of one window (Cursor 3.23.12 `workbench.desktop.main.js` 17501:84373 `onDidFocus` → `doUpdateMostRecentActive`, 17501:88693 `get activePart`, 17501:90249 `getLayout`), so its chat part stays active after a click into the terminal or a side-bar view; VS Code counts the part of the focused window (1.140.0 993:31655), the main window's once a view of it has the keyboard. Set with `focused`, ended by `leaveChatForMainEditor`, and by `leaveChatForView` only for VS Code's floating chat (row 647). */
        lastActive: boolean
        /** `true` for VS Code's chat editor tab moved into a floating window (see `addSeparateEditorPart`), `false` for Cursor's Agent chat part. */
        floatingVsCodeChat: boolean
      }
    | undefined
  let separatePartLayoutReport: unknown
  /** VS Code's floating window of text editors (an editor moved into a new window, then split there), whose groups the extension API counts after the main editor's; see `addFloatingEditorWindow` (Cycle 0046 rows 688 and 689). `active` while the window is the focused one: a layout read is answered for its own grid (1.140.0 993:31655). */
  let floatingEditorWindow:
    | { groups: (typeof groups)[number][]; layout: unknown; active: boolean }
    | undefined
  type SourceEditor = {
    group?: (typeof groups)[number]
    document: { uri: Uri; getText(): string }
    /** The group's column; none for a side of a diff editor, as both editors report it (row 709). */
    readonly viewColumn: number | undefined
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
  // The text editors of restored captured-source tabs that no text editor shows yet, by tab, for `resolveRestoredCapturedSource`.
  const unresolvedRestoredSources = new Map<
    Tab,
    SourceEditor & { group: (typeof groups)[number] }
  >()
  let lateEditorAfterLeftoverClose = false
  // The captured document the active text editor still reports for a moment after its leftover tab closed.
  let staleEditorAfterLeftoverClose: SourceEditor | undefined
  const deadPaneTabs = new Set<Tab>()
  // Tabs the editor will not release. A close request is answered group by group, as the editor closes: such a tab keeps the requested tabs of its own group only.
  const closeRefusingTabs = new Set<Tab>()
  let rejectNextTabClose = false
  /** See `refuseNextGroupClose`. */
  let refusesNextGroupClose = false
  /** See `holdNextGroupClose`. */
  let heldGroupClose: { entered: () => void; wait: Promise<void> } | undefined
  const tabCloseRequests: Tab[][] = []
  const tabCloseFocusRequests: boolean[] = []
  /** The main editor's layout as the fake editor held it when each request to close a whole group arrived; see `layoutsAtGroupCloses`. */
  const layoutsAtGroupCloses: unknown[] = []
  let heldTabCloseResponse:
    { entered: () => void; wait: Promise<void> } | undefined
  /** See `holdNextTextDocumentShow`. */
  let heldTextDocumentShow:
    { entered: () => void; wait: Promise<void>; uri?: string } | undefined
  /** See `redirectNextTextDocumentShow`. */
  let redirectedTextDocumentShow:
    { uri: string; viewColumn: number } | undefined
  /** See `holdNextTabCloseEffect`. */
  let heldTabCloseEffect:
    { entered: () => void; wait: Promise<void> } | undefined
  /** Whether {@link slotTimers} follow `elapseSlotClock` instead of the real clock; see `useManualSlotClock`. */
  let manualSlotClock = false
  let slotClockMs = 0
  const manualSlotTimers: {
    dueMs: number
    callback: () => void
    active: boolean
  }[] = []
  /**
   * The timers the reader's recorded-source slot deadlines read: the real clock, or the test's hand-driven one after `useManualSlotClock`.
   * A timer set while the clock is real stays real; one set while it is manual fires only in `elapseSlotClock`.
   */
  const slotTimers = {
    set: (callback: () => void, delayMs: number): (() => void) => {
      if (!manualSlotClock) {
        const handle = setTimeout(callback, delayMs)
        return (): void => clearTimeout(handle)
      }
      const timer = {
        dueMs: slotClockMs + delayMs,
        callback,
        active: true,
      }
      manualSlotTimers.push(timer)
      return (): void => {
        timer.active = false
      }
    },
  }
  /** The listeners of the editor's `onDidChangeVisibleTextEditors`, told whenever a tab comes to the front of its group, opens, or closes. */
  const visibleEditorListeners = new Set<() => void>()
  /** What the listeners of `onDidChangeVisibleTextEditors` threw: the extension host logs a listener's error and goes on with the other listeners, so the fake keeps it here instead of letting it end the editor operation that announced the change; see `visibleEditorListenerErrors`. */
  const visibleEditorListenerErrors: unknown[] = []
  /** Whether the test announced that a listener of `onDidChangeVisibleTextEditors` throws on purpose; see `expectVisibleEditorListenerErrors`. Without it `close` fails the test whose operation made a listener throw. */
  let visibleEditorListenerErrorsExpected = false
  /**
   * Tells the listeners of `onDidChangeVisibleTextEditors` that a tab opened, closed or came to the front of its group.
   * The fake delivers inside the operation that caused the change, where the extension host delivers after a hop; a listener that throws is isolated like the host's and its error is kept.
   * @example changedVisibleEditors()
   */
  const changedVisibleEditors = (): void => {
    for (const listener of [...visibleEditorListeners])
      try {
        listener()
      } catch (error) {
        visibleEditorListenerErrors.push(error)
      }
  }
  type CodeLensProvider = {
    provideCodeLenses(document: {
      uri: Uri
      getText(): string
    }): readonly CodeLens[]
    onDidChangeCodeLenses?: (listener: () => void) => { dispose(): void }
  }
  /** The CodeLens providers the reader registered with the selector each was registered for; see `codeLensTitles`. */
  const codeLensProviders: { selector: unknown; provider: CodeLensProvider }[] =
    []
  /** How many times a registered provider announced `onDidChangeCodeLenses`, as the editor counts the refreshes it would run; see `codeLensRefreshCount`. */
  let codeLensRefreshes = 0
  /**
   * Tells whether a document selector, as `registerCodeLensProvider` takes it, matches a document, as the editor decides which providers it asks (a language id, a filter of scheme and language, or a list of them); a filter's pattern is not modelled and matches nothing.
   * @param selector - The selector the provider was registered with.
   * @param document - The document's address and language.
   * @returns `true` when the editor would ask the provider about the document.
   * @example documentSelectorMatches({ scheme: 'codebook-source' }, { uri, languageId: 'typescript' }) // => true for a codebook-source uri
   */
  function documentSelectorMatches(
    selector: unknown,
    document: { uri: Uri; languageId: string },
  ): boolean {
    if (Array.isArray(selector))
      return selector.some((member) =>
        documentSelectorMatches(member, document),
      )
    if (typeof selector === 'string')
      return selector === '*' || selector === document.languageId
    if (typeof selector !== 'object' || selector === null) return false
    const filter = selector as {
      scheme?: string
      language?: string
      pattern?: unknown
    }
    if (filter.pattern !== undefined) return false
    return (
      (filter.scheme === undefined || filter.scheme === document.uri.scheme) &&
      (filter.language === undefined || filter.language === document.languageId)
    )
  }
  /** Every `revealRange` call of a recorded-source slot's editor, in order, with the first line of the revealed range; see `slotReveals`. */
  const slotRevealCalls: { uri: string; line: number }[] = []
  let lastSourceEditor: SourceEditor | undefined
  let sourceFocusOnArrange: SourceEditor | undefined
  let reportedSourceColumn: number | undefined
  let nextSourceDisplay: ((editor: SourceEditor) => void) | undefined
  let nextReadingReveal: (() => void) | undefined
  const visibleSourceEditors: (SourceEditor & {
      group: (typeof groups)[number]
    })[] = [],
    decoratedColumns: (number | undefined)[] = [],
    /** How many lines each source highlight call marked, in order; 0 is a cleared highlight. */
    decoratedRangeCounts: number[] = []
  const sourceIdentityCalls: { uri: string; ranges: readonly unknown[] }[] = []
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
  /**
   * Says whether a group shows a document as a side of the diff editor in front of it; asked by the fake text editors, which then report no view column, and by `visibleTextEditors` and `textEditorHasKeyboardIn` (Cycle 0046 row 709).
   * @param group - The group.
   * @param uri - The document's URI.
   * @returns `true` while the group's front tab is a `TabInputTextDiff` whose original or modified document is that document.
   * @example showsAsDiffSide(groups[1], authUri) // => true after focusDiffEditor('auth.ts', 2)
   */
  const showsAsDiffSide = (
    group: (typeof groups)[number] | undefined,
    uri: Uri,
  ): boolean => {
    const input = group?.activeTab?.input
    return (
      input instanceof TabInputTextDiff &&
      [input.original, input.modified].some(
        (side) => side.toString() === uri.toString(),
      )
    )
  }
  /** Models native surrounding-line padding so workspace transfers expose lost reading positions. @example const editor = sourceEditor(document, group) */
  const sourceEditor = (
    document: SourceEditor['document'],
    group: (typeof groups)[number],
    reportedColumn?: number,
  ): SourceEditor => ({
    document,
    get viewColumn() {
      const shownIn = this.group ?? group
      // Both editors report a diff editor's text editors with no view column (C61 c61-688-diffprobe, row 709).
      if (showsAsDiffSide(shownIn, document.uri)) return undefined
      return reportedColumn ?? shownIn.viewColumn
    },
    setDecorations(
      decoration?: unknown,
      ranges: readonly unknown[] = [],
    ): void {
      // Inline source identity is metadata; execution-highlight checks observe only the native line decoration.
      if (
        decoration &&
        typeof decoration === 'object' &&
        'sourceIdentity' in decoration
      ) {
        sourceIdentityCalls.push({
          uri: document.uri.toString(),
          ranges: [...ranges],
        })
        return
      }
      decoratedColumns.push(this.viewColumn)
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
      if (document.uri.path.includes('/node-history-slot/'))
        slotRevealCalls.push({
          uri: document.uri.toString(),
          line: range.start.line,
        })
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
  /**
   * Tells the group listeners of a group event; the event names the active group again, so a stale name ends, unless the event is the rebuild Cursor answers a document shown in the main editor with (see `replaceGroupObjects`).
   * @param event - The groups the event opened, closed and changed.
   * @param keptStaleName - The group the stale name names after the event, for that rebuild only.
   * @example changedGroups({ opened: [], closed: [], changed: [...groups] })
   */
  const changedGroups = (
    event: {
      opened: typeof groups
      closed: typeof groups
      changed: typeof groups
    },
    keptStaleName?: (typeof groups)[number],
  ): void => {
    staleNamedGroup = keptStaleName
    for (const listener of groupChangeListeners) listener(event)
  }
  const textDocumentChangeListeners = new Set<
    (event: {
      document: Pick<SourceEditor['document'], 'uri' | 'getText'>
    }) => void
  >()
  /** The content provider each registration of `registerTextDocumentContentProvider` gave for its scheme, as the editor keeps one per scheme: the Study's captured sources (`codebook-source`) and a Repository Wiki reader's cited sources (`codebook-repository-source`, `createRepositoryWikiReader`) stand side by side. */
  const contentProviders = new Map<string, (uri: Uri) => Promise<string>>()
  /** The provider registered last, which answers a scheme no registration named, as the one provider of this fake did before it kept them by scheme. */
  let lastContentProvider = async (_uri: Uri): Promise<string> => ''
  /** Gives the text of a virtual document from the provider of its scheme ({@link contentProviders}). @example await sourceProvider(capturedSourceUri) // => 'export const theme = …' */
  const sourceProvider = (uri: Uri): Promise<string> =>
    (contentProviders.get(uri.scheme) ?? lastContentProvider)(uri)
  let nextSourceUpdate: { wait: Promise<void>; entered(): void } | undefined
  const virtualSourceDocuments = new Map<
    string,
    { text: string; languageId: string }
  >()
  const sourceDocumentChanges: string[] = []
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
  /** The source document of the stop the fake historical debugger presented last with values, which the fake editor's {@link NATIVE_DEBUG_FOCUS_SESSION_COMMAND} reveals (`revealHistoricalStopSource`, row 721). */
  let historicalStopSource: string | undefined
  class TestReplayDebugger {
    available = true
    private closed = false
    /** The stop this fake presents now, by what the real owner compares (`ReplayDebugger.selected`): a new object for each new snapshot, label or source, dropped by {@link invalidate}. */
    private selection?: {
      snapshot: ReplayDebugSnapshot | undefined
      label: string
      sourceUri?: string
    }
    /** The selection whose native model this fake selected, or for which the host registers no command, as the real owner keeps `modelSelectionSettledFor` (F6): a later presentation of the same selection selects nothing again. */
    private modelSelectionSettledFor?: TestReplayDebugger['selection']
    /** Positive discovery of {@link NATIVE_DEBUG_FOCUS_SESSION_COMMAND}, kept as the real owner keeps `registeredNativeFocusCommand` (F6). */
    private registeredNativeFocusCommand = false
    /** The model selection the fake host still answers, as the real owner keeps `modelSelectionInFlight` (AD25, Q10): a later frame of the same selection waits for this answer instead of asking the host again. */
    private modelSelectionInFlight?: {
      selection: TestReplayDebugger['selection']
      answer: Promise<boolean>
    }
    /**
     * Registers the fake owner so {@link loadHistoricalDebugValues} and {@link endHistoricalDebugSession} can notify the workspace, as the real owner does.
     * @throws When an earlier owner is still registered: the editor accepts one descriptor factory per debug type.
     * @example new TestReplayDebugger(vscode, (reason) => workspace.replayDebuggerChanged(reason))
     */
    constructor(
      private readonly editor: {
        commands: {
          getCommands(filterInternal?: boolean): Thenable<string[]>
          executeCommand(name: string, ...rest: unknown[]): Thenable<unknown>
        }
      },
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
      // As for the real owner, a new snapshot, label or source is a new selection; the same one keeps its object.
      if (
        !this.selection ||
        this.selection.snapshot !== snapshot ||
        this.selection.label !== label ||
        this.selection.sourceUri !== sourceDocument?.uri
      )
        this.selection = { snapshot, label, sourceUri: sourceDocument?.uri }
      // A stop with values selects the native model once per selection, as the real owner does before it waits for Variables (row 721, F6).
      if (
        snapshot?.frames.some((frame) => frame.scopes.length) &&
        sourceDocument &&
        !activeStackItem &&
        this.modelSelectionSettledFor !== this.selection
      )
        await this.selectNativeInspectionModel(
          sourceDocument.uri,
          this.selection,
        )
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
     * Selects the native debugger model of a presented stop as the real owner does (`ReplayDebugger.selectNativeInspectionModel`): where the host registers {@link NATIVE_DEBUG_FOCUS_SESSION_COMMAND}, it runs that command with `null`, which the fake editor answers by revealing the stop's source (`revealHistoricalStopSource`). The real owner runs it only once native Call Stack fetched the stop and while no other debug session is active, which the fake reads as no live stop the editor reports (Cycle 0046 row 721), and once per selection, asking the host for its commands until it found the command (F6).
     * As for the real owner, the question whether the selection is settled is asked again after the command discovery's await (Q1), and a later frame of a selection the host still answers waits for that answer instead of asking again (AD25, Q10).
     * @param sourceUri - The stop's captured source, whose document the recorded frame names.
     * @param selection - The presented selection, noted as settled once its model was selected or the host has no command for it.
     * @example await this.selectNativeInspectionModel(capturedSourceUri, this.selection) // the captured source's group is the active one, its text editor the active text editor
     */
    private async selectNativeInspectionModel(
      sourceUri: string,
      selection: TestReplayDebugger['selection'],
    ): Promise<void> {
      // As for the real owner, only a positive discovery is kept; a host without the command is asked again at its next selection.
      if (!this.registeredNativeFocusCommand)
        this.registeredNativeFocusCommand = (
          await this.editor.commands.getCommands(true)
        ).includes(NATIVE_DEBUG_FOCUS_SESSION_COMMAND)
      if (!this.registeredNativeFocusCommand) {
        this.modelSelectionSettledFor = selection
        return
      }
      // Another frame's answer may have settled the selection during the discovery.
      if (this.modelSelectionSettledFor === selection) return
      const inFlight = this.modelSelectionInFlight
      // A selection the host still answers is this frame's too.
      if (inFlight && inFlight.selection === selection) {
        await inFlight.answer
        return
      }
      historicalStopSource = sourceUri
      await this.runNativeInspectionModelSelection(selection)
    }
    /**
     * Runs {@link NATIVE_DEBUG_FOCUS_SESSION_COMMAND} for a selection as the real owner does (`ReplayDebugger.runNativeInspectionModelSelection`), for {@link selectNativeInspectionModel}: the answer is kept in flight for later frames of the selection, and it settles the selection only while that selection is still the shown one.
     * @param selection - The selection whose model is selected.
     * @returns `true` once the host selected the model; `false` when it refused, which fails no frame (AD25) and goes to the error channel.
     * @example await this.runNativeInspectionModelSelection(this.selection) // => true
     */
    private runNativeInspectionModelSelection(
      selection: TestReplayDebugger['selection'],
    ): Promise<boolean> {
      const answer = Promise.resolve(
        this.editor.commands.executeCommand(
          NATIVE_DEBUG_FOCUS_SESSION_COMMAND,
          null,
        ),
      )
        .then(
          () => true,
          (error: unknown) => {
            this.failed(error)
            return false
          },
        )
        .then((selected) => {
          // A later stop may have been shown meanwhile; only the still shown selection is settled.
          if (selected && this.selection === selection)
            this.modelSelectionSettledFor = selection
          return selected
        })
        .finally(() => {
          if (this.modelSelectionInFlight?.answer === answer)
            this.modelSelectionInFlight = undefined
        })
      this.modelSelectionInFlight = { selection, answer }
      return answer
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
      // As for the real owner, the emptied session shows no stop, so the next presentation is a new selection.
      this.selection = undefined
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
  let nextOpen:
    { wait: Promise<void>; entered(): void; uri?: string } | undefined
  let nextCommand:
    { name: string; wait: Promise<void>; entered(): void } | undefined
  let nextPrimaryFocusResponse:
    { wait: Promise<void>; entered(): void } | undefined
  let nextLayoutResponse: { wait: Promise<void>; entered(): void } | undefined
  const commands: string[] = []
  // The group count of the Study grid the fake editor settles at other sizes than given (see `constrainStudyGrid`); `undefined`: every layout is kept as given.
  let constrainedStudyGridGroups: 2 | 3 | undefined
  /** The editor area in which the fake editor answers a layout given in proportions as pixels; see `answerProportionsAsPixels`. `undefined`: such a layout is kept as it was given. */
  let proportionsAnsweredInPx: { width: number; height: number } | undefined
  let hideGridWhileMaximized = false
  /** Set by `modelVsCodeStackedRowSizing`: a row at the minimum height that a numbered focus command activates is expanded, as VS Code 1.140.0 does (Cycle 0046 row 691). A group inserted into stacked rows given in pixels is sized as the split view sizes it in every model (row 703). */
  let modelsVsCodeStackedRowSizing = false
  // The legacy fixture keeps an empty App destination beside source; both groups must exist before MCP-first preparation measures them.
  let editorLayout: unknown = { orientation: 0, groups: [{}, {}] }
  let nextMovedPanelLayout: unknown
  let nativeLayout = false,
    cursorGroupWrappers = false,
    cursorTwoEventContraction = false,
    explicitEditorLayout = false,
    maximizedEditorGroup = false
  /** The view column of the group the editor's maximize command maximized, read while `maximizedEditorGroup` is set: the group that was the active one when the command ran. */
  let maximizedColumn: number | undefined
  let closeEmptyGroupsOnMove = false
  /** Whether the group a pane's move left empty goes {@link MOVED_PANE_GROUP_REMOVAL_DELAY_MS} after the move instead of with it; see `removeGroupLeftByPanelMoveLater`. */
  let removesGroupLeftByMoveLater = false
  /** Whether a pane's move is reported as its tab opening in the new group first and closing in the old group after that; see `reportsPaneMoveAsOpenThenClose`. */
  let reportsPaneMoveAsOpenThenCloseFlag = false
  /** The removals of groups a pane's move left empty that the fake editor has not run yet; see `removeGroupLeftByPanelMoveLater`. */
  const pendingMoveRemovals: (() => void)[] = []
  let closeDisposedPanelTabsLater = false
  /** Whether a disposed pane that is the front tab of a group shared with other tabs first makes the next tab the active one through a tab notification, and closes its own tab later; see `activateNextTabBeforeDisposedPaneTabCloses`. */
  let activatesNextTabBeforeDisposedPaneTabCloses = false
  /** Whether a disposed panel's `viewType` and `viewColumn` throw `Webview is disposed`, as the editor's WebviewPanel does; see `throwFromDisposedPanelGetters`. */
  let throwsFromDisposedPanelGetters = false
  /** The next-tab notification of a disposed pane that the fake editor has not delivered yet; the first layout read after the disposal delivers it while the read is in flight. */
  let pendingNextTabActivation: (() => void) | undefined
  /** Whether the fake Cursor reports the Application's group active a moment after a reveal of the Application that keeps the keyboard answered; see `activateApplicationGroupLateAfterReveal`. */
  let activatesApplicationGroupLateAfterReveal = false
  /** Whether the fake Cursor reports the group `workbench.action.newGroupAbove` made active only after the command answered; see `activateNewGroupLateAfterInsertion`. */
  let activatesNewGroupLateAfterInsertion = false,
    newGroupActivationDelayMs: number | undefined
  /** The late group activations the fake editor has not reported yet; the first layout read after them reports them while it is in flight, else a timer does. */
  const pendingLateGroupActivations: {
    report: () => void
    atRead: () => boolean
  }[] = []
  /** How many late group activations reached the fake editor's live group model; see `lateGroupActivationsReported`. */
  let reportedLateGroupActivations = 0
  /** The copy that replaced each group object at a rebuild of the fake group model, so a reference taken before the rebuild finds its group again ({@link currentGroupOf}). */
  const groupSuccessors = new WeakMap<
    (typeof groups)[number],
    (typeof groups)[number]
  >()
  /**
   * Records that a copy replaces a group object in the fake group model, as Cursor's extension host gives its groups new objects; every copy that keeps a group's identity goes through here (a replacement reported as an opened group is another group and records none).
   * @returns The copy, for the rebuilt list.
   * @example groups.map((group) => replacedBy(group, { ...group, tabs: [...group.tabs] }))
   */
  function replacedBy(
    previous: (typeof groups)[number],
    next: (typeof groups)[number],
  ): (typeof groups)[number] {
    groupSuccessors.set(previous, next)
    return next
  }
  /**
   * Follows a group object through the rebuilds since it was taken to the object the fake model holds now; called by late reports that name a group taken before they run.
   * @returns The live object, or `undefined` when the group left the model.
   * @example currentGroupOf(inserted) // => the inserted group's object after two rebuilds
   */
  function currentGroupOf(
    group: (typeof groups)[number],
  ): (typeof groups)[number] | undefined {
    let current = group
    // A chain of rebuilds: each copy may itself have been replaced since.
    for (
      let next = groupSuccessors.get(current);
      next;
      next = groupSuccessors.get(current)
    )
      current = next
    return groups.includes(current) ? current : undefined
  }
  // Cursor 3.23.12 keeps naming the chat's group as the active tab group after `workbench.action.focusFirstEditorGroup` gave the main editor the keyboard. Only a group event corrects the name: a whole tab-model rebuild names the active group (`workbench.desktop.main.js` 17269:31013, `extensionHostProcess.js` 131:33177), as does a group's activation (17269:28123, 131:33740); a tab notification is a tab operation, which leaves the named group as it is (131:34068), so it does not (Cycle 0046 row 673).
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
  /** Says that the view with the keyboard is VS Code's chat in front of the secondary side bar, where the Learning summary's container also stands; see `focusChatInSecondarySideBar`. */
  let viewInSecondarySideBar = false
  /** Says that the learner's terminal stands in front of the bottom panel, where the Observed moments' container also stands; see `focusTerminalInBottomPanel`. */
  let terminalInFrontOfPanel = false
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
  /** Codebook's `configurationDefaults` value of `debug.focusEditorOnBreak`, which `inspect` reports as the default and no explicit layer; unset until a test calls `contributeFocusEditorOnBreakDefault`. */
  let contributedFocusEditorOnBreak: boolean | undefined
  let nextStackFrameId = 1
  /** The sequence number of the next Debug Adapter Protocol message the fake editor or a fake adapter sends; see `answerStackTraceOf`. */
  let nextDebugMessageSeq = 1
  /** The id of the top frame of each session's current stop, as the adapter answered the editor's `stackTrace` request for it (`answerStackTraceOf`). */
  /** The top frame each stopped thread's adapter answered last, by session and thread (`answerStackTraceOf`), which `reportFrameOf` reports for that thread. */
  const stopTopFrameIds = new Map<string, number>()
  /**
   * The settings the fake editor answers, by their full key; every other setting is unset. Read at each `get`, so a test that changes one of the values is answered with the new one.
   * @returns The values of `codebook.savedStudyLimit`, `debug.focusEditorOnBreak` (the learner's own value, else Codebook's contributed default, else unset: the editor's default, on) and `workbench.editor.closeEmptyGroups` (the fake editor removes an emptied group only in the models of `closeDisposedPanelTabsLater` and `closeEmptyGroupsAfterPanelMove`, row 658).
   * @example configuredValues()['debug.focusEditorOnBreak'] // => false after harness.pauseDebugger({ focusesEditorOnBreak: false })
   */
  const configuredValues = (): Record<string, unknown> => ({
    'codebook.savedStudyLimit': savedStudyCapacity,
    'debug.focusEditorOnBreak':
      focusEditorOnBreak ?? contributedFocusEditorOnBreak,
    'workbench.editor.closeEmptyGroups':
      closeDisposedPanelTabsLater || closeEmptyGroupsOnMove,
  })
  /**
   * What the fake editor's `inspect` answers for a setting: the learner's value of `debug.focusEditorOnBreak` (set by `pauseDebugger`) in the user layer and Codebook's contributed value as the default; every other setting is reported in the user layer.
   * @param fullKey - The setting's full key.
   * @returns The inspection, with `globalValue` for an explicit value and `defaultValue` for the contributed default.
   * @example inspectedValues('debug.focusEditorOnBreak') // => { key: 'debug.focusEditorOnBreak', defaultValue: false, globalValue: undefined } after contributeFocusEditorOnBreakDefault(false)
   */
  const inspectedValues = (fullKey: string) =>
    fullKey === 'debug.focusEditorOnBreak'
      ? {
          key: fullKey,
          defaultValue: contributedFocusEditorOnBreak,
          globalValue: focusEditorOnBreak,
        }
      : { key: fullKey, globalValue: configuredValues()[fullKey] }
  /** The reader's listeners for a change of the selected stack item of Run and Debug; `pauseDebugger` and `resumeDebugger` call them. */
  const activeStackItemListeners = new Set<() => void>()
  /** Whether the fake editor lets the keyboard fall to the page body when it removes an emptied editor group while a text editor has the keyboard; see `loseKeyboardWhenGroupCloses`. */
  let losesKeyboardWhenGroupCloses = false
  /** Models the host's actual editor-part focus guard and native webview disposal callbacks; enabled by `modelNativeTabCloseFocus`. */
  let modelsNativeTabCloseFocus = false
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
  // Both editors report a pane revealed into another column during the next layout read; see `movePanelsLater`.
  let movesPanelsLater = false
  // Cursor names the group that held the keyboard before a new group was inserted again one editor change later; see `reactivatePreviousGroupAfterInsertion`.
  let reactivatesPreviousGroupLater = false
  // Cursor gives the chat input the keyboard only after Focus Agent answered, here just before the editor runs a later command of the reader; see `focusAgentLater`.
  let commandsBeforeAgentFocus = 0,
    commandsUntilAgentFocus = 0
  // Cursor activated that group again before the next lock reached the editor, so the lock locked it; see `reactivatePreviousGroupBeforeLock`.
  let reactivatesPreviousGroupBeforeLock = false
  /** The tab whose group the editor names as the active one right after the next lock answered, once; see `activateGroupOfTabAfterNextLock`. */
  let groupActivatedAfterLock: Tab | undefined
  let reactivatesPreviousGroupAtLayoutRead = false
  let layoutReadsUntilReactivation = 0
  let groupFocusedBeforeInsertion: (typeof groups)[number] | undefined
  // Cursor 3.23.12 closes a disposed panel's tab, and a moment later the group it left empty, while a layout read is pending.
  let closeDisposedPanelTabsDuringLayoutRead = false
  /** The fake editor answers every tab change with new TabGroup objects, as Cursor does; see `replaceGroupObjectsOnTabChanges`. */
  let replacesGroupObjectsOnTabChanges = false
  /** The fake editor answers a removed group with new Tab objects, as Cursor does; see `rebuildTabObjectsAtGroupRemoval`. */
  let rebuildsTabObjectsAtGroupRemoval = false
  /** The view column a panel of a kind reports while it differs from the column of its tab's group; see `reportPanelColumn`. */
  const reportedPanelColumns = new Map<string, number | undefined>()
  /** The bottom panel is maximized: the editor area is hidden and reports its stacked groups at their minimum height. */
  let panelMaximized = false
  /** Tab closes of disposed panels the fake editor has not run yet; see `closeDisposedPanelTabsLater`. */
  const pendingDisposedTabCloses: (() => void)[] = []
  /** Says that the fake editor runs no pending close of a disposed panel's tab, neither by itself nor at a layout read, until `closePendingDisposedPanelTabs`; see `holdDisposedPanelTabCloses`. */
  let disposedTabClosesHeld = false
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
      // A held close waits for `closePendingDisposedPanelTabs`.
      if (disposedTabClosesHeld) return
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
  /**
   * Queues one late report of a group's activation, as Cursor sends `$acceptTabGroupUpdate` for a group after the command that caused it has answered: the group becomes the active one and the editor tells its group listeners that it changed. The first layout read after the call reports it while the read is in flight, else a timer does {@link NEXT_TAB_ACTIVATION_DELAY_MS} later.
   * @param group - The group, or a function that names it when the report is made.
   * @param atRead - Whether a layout read that arrives now reports it; the timer reports it whatever this says. Defaults to every read.
   * @example queueLateGroupActivation(() => groups.find((candidate) => candidate.tabs.includes(nativeTab)))
   */
  function queueLateGroupActivation(
    group: () => (typeof groups)[number] | undefined,
    atRead: () => boolean = () => true,
    delayMs: number = NEXT_TAB_ACTIVATION_DELAY_MS,
  ): void {
    const pending = { report: (): void => {}, atRead }
    const report = (): void => {
      const index = pendingLateGroupActivations.indexOf(pending)
      if (index < 0) return
      pendingLateGroupActivations.splice(index, 1)
      const activated = group()
      if (!activated || !groups.includes(activated)) return
      reportedLateGroupActivations++
      activeTabGroup = activated
      changedGroups({ opened: [], closed: [], changed: [activated] })
    }
    pending.report = report
    pendingLateGroupActivations.push(pending)
    runEditorChangeLater(report, delayMs)
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
  /** The text editor VS Code goes on reporting as the active one after the Repository Wiki's tab took the keyboard in another group, until the active group changes again; see `focusWebviewTabKeepingTextEditorReport`. */
  let textEditorReportedBehindWebview:
    | { group: (typeof groups)[number]; tab: Tab; editor: SourceEditor }
    | undefined
  const windowState = { focused: true, active: true },
    windowListeners = new Set<(state: typeof windowState) => void>()
  /** How many times the extension read `vscode.window.state.focused` while the window had no focus; a test waits on it to act while the reader waits for the focus. It is a heuristic signal: any reader path that reads the focus counts, so a test that waits on it asserts an outcome that holds wherever the entry stood when it acted. */
  let unfocusedWindowReads = 0
  /** The window state the extension reads: the harness's own state, with each unfocused read counted. */
  const windowStateForExtension = {
    get focused(): boolean {
      if (!windowState.focused) unfocusedWindowReads++
      return windowState.focused
    },
    get active(): boolean {
      return windowState.active
    },
  }
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
  /** Set by `takesKeyboardBackFromFirstGroupBesideChat`: the pane the first group's focus command made active briefly, until the next layout read has been answered. */
  let chatRetakesKeyboardAfterLayoutRead: (() => void) | undefined
  let chatRetakesKeyboardFromFirstGroup = false
  // Cursor 3.27.22: while the Agent chat part has the keyboard `workbench.action.focusFirstEditorGroup` does nothing, and a pane revealed with the focus takes the keyboard (it reports itself active) while the editor goes on naming the chat's group; see `ignoresFirstGroupFocusCommandBesideChat`.
  let ignoresFirstGroupFocusCommandBesideChatFlag = false
  // Cursor 3.23.12: "Navigate Down Call Stack" gives the frame's file the keyboard while the editor keeps naming the group it named before; see `keepNamingGroupAfterFrameNavigation`.
  let keepsNamingGroupAfterFrameNavigation = false
  // Cursor 3.23.12: the learner's click into a file of the main editor keeps the chat part's group named; see `keepChatPartNameAtLearnersFileClick`.
  let keepsChatPartNameAtLearnersFileClick = false
  /** Set by `keepTextEditorReportAfterNewGroup`: `workbench.action.newGroupAbove` leaves the text editor reported before it as the active text editor until a pane's tab stands in front of the new group (Cycle 0046 row 710). */
  let keepsTextEditorReportAfterNewGroup = false
  /** The text editor reported as the active one while the new empty group at this column is the active group, in the model of `keepTextEditorReportAfterNewGroup`; ended by {@link endTextEditorReportKeptAtNewGroup}. */
  let textEditorKeptAtNewGroup:
    { column: number; editor: SourceEditor } | undefined
  let deferMovedFocusEcho = false,
    pendingMovedFocusEcho: typeof activeTabGroup | undefined
  let deferKeptFocusEcho = false,
    pendingKeptFocusEcho: typeof activeTabGroup | undefined
  let deferredMovedPanelPlacement: string | undefined,
    asynchronousLayoutReads = false
  const postedMessages: StudyViewMessage[] = []
  // What the Application pane's test replay document received in place, in order (EN3): one view per later moment.
  /** Each view the Application pane's test replay document received in place, with the kind of the panel that received it. */
  const applicationOutputs: (NodeTestOutputUpdate & { panel: string })[] = []
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
    displayedImage: string | undefined,
    sourceColumn = 2
  let nextImage: { wait: Promise<void>; entered(): void } | undefined
  /**
   * Gives every editor group a new TabGroup object, as Cursor 3.23.12 does whenever a tab opened, another tab of a group became active, a tab closed, or a group opened or closed (obs13 items 7 and 8: 19 of 19 events that name every group); a no-op unless `replaceGroupObjectsOnTabChanges` is on.
   * The view columns, the tabs and the keyboard focus stay, and every holder of a group object is pointed at the new one. The Tab objects are kept: Cursor replaces them too and reports a tab of unknown input with `input` undefined.
   * @param closed - Groups the same change closed; they are reported as closed and get no new object.
   * @param opened - The group the same change opened; it is reported as opened and keeps its object.
   * @param notify - False snapshots the next model before an empty group's first source tab changes, then the completed change emits normally.
   * @param keepsStaleName - True for the rebuild a document shown in the main editor brings while Cursor names its chat part's group: the rebuild names the group Cursor's editor groups service holds active (`workbench.desktop.main.js` 17269:31013 `isActive:t.id===this._editorGroupsService.activeGroup.id`), which that display does not change, so the chat's group stays the named one (C58 c58-cu-567: the cited source took the keyboard in the first group under the chat's name; C59 c59-cu-2c: the citation's group event named column 3 still; Cycle 0046 row 674).
   * @param closesTabs - True for the rebuild a closed tab or group brings: while Cursor's chat part is the active part with its input focused, it names the chat part's group, the group Cursor's editor groups service holds active (C61 c61-702-probe step 6: next.config.js of group 2 closed by `tabGroups.close` while the chat input had the keyboard, and the name went from the stale group 1 to the chat part's group 3; Cycle 0046 row 702). Otherwise it names the active group, which ends a stale name (row 673).
   * @example replaceGroupObjects() // harness.groups[0] is another object in the same view column, reported as changed
   */
  function replaceGroupObjects(
    closed: typeof groups = [],
    opened?: (typeof groups)[number],
    notify = true,
    keepsStaleName = false,
    closesTabs = false,
  ): void {
    if (!replacesGroupObjectsOnTabChanges) return
    const replacements = new Map(
      groups
        .filter((group) => group !== opened)
        .map((group) => [
          group,
          replacedBy(group, { ...group, tabs: [...group.tabs] }),
        ]),
    )
    /** Names the new object of a group that survived, and leaves a group that is gone as it is. */
    const replaced = (group: (typeof groups)[number]) =>
      replacements.get(group) ?? group
    groups.splice(0, groups.length, ...groups.map(replaced))
    activeTabGroup = replaced(activeTabGroup)
    // A text editor reported behind a webview stays reported through the rebuild (row 729).
    if (textEditorReportedBehindWebview)
      textEditorReportedBehindWebview.group = replaced(
        textEditorReportedBehindWebview.group,
      )
    if (separateEditorPart)
      separateEditorPart.group = replaced(separateEditorPart.group)
    for (const editor of visibleSourceEditors)
      editor.group = replaced(editor.group)
    if (notify)
      changedGroups(
        {
          opened: opened ? [opened] : [],
          closed,
          changed: [...replacements.values()],
        },
        keepsStaleName
          ? nameAfterNewTabRebuild(replaced)
          : closesTabs
            ? chatPartGroupWhileActive()
            : undefined,
      )
  }
  /**
   * Names Cursor's chat part's group while that part is the active editor part with its chat input focused, the group Cursor's editor groups service holds active then, which a whole tab-model rebuild names (`workbench.desktop.main.js` 17269:31013); asked by `replaceGroupObjects` for the rebuild of a closed tab (row 702) and by `nameAfterNewTabRebuild` for that of a tab opened without the keyboard (row 696).
   * @returns The chat part's group then; `undefined` without Cursor's chat part, while the main editor is the active part, while a view has the keyboard, and for VS Code's floating chat window.
   * @example chatPartGroupWhileActive() // => the chat part's group after Focus Agent
   */
  function chatPartGroupWhileActive(): (typeof groups)[number] | undefined {
    return separateEditorPart?.lastActive &&
      separateEditorPart.focused &&
      !separateEditorPart.floatingVsCodeChat
      ? separateEditorPart.group
      : undefined
  }
  /**
   * Names the group the rebuild a tab opened in the main editor brings names in Cursor's model, for `replaceGroupObjects`: the group Cursor's editor groups service holds active (`workbench.desktop.main.js` 17269:31013), which a display does not change. While Cursor's chat part is the active part with its input focused, that is the chat part's group, also when the extension host still named a main group: the reader's own copy shown without the keyboard in the first group moved the name from that stale group 1 to the chat part's group 3 (C60 c60-cu-7d2, the show at 149 ms and the groups event at 153 ms; Cycle 0046 row 696). Otherwise the stale name stays, the chat's group among them (row 674).
   * @param replaced - The new object of a group the rebuild kept.
   * @returns The named group's new object; `undefined` when no group is named stale and the chat part is not the active one.
   * @example nameAfterNewTabRebuild(replaced) // => the chat part's group after Focus Agent
   */
  function nameAfterNewTabRebuild(
    replaced: (group: (typeof groups)[number]) => (typeof groups)[number],
  ): (typeof groups)[number] | undefined {
    return (
      chatPartGroupWhileActive() ??
      (staleNamedGroup && replaced(staleNamedGroup))
    )
  }
  /**
   * Opens a tab in the editor area of a group and gives it the keyboard, the body of `focusEditorTerminal` and `focusEditorWithoutTabInput`: the tab is the one its group shows, the group is the active one and named by the group event both editors send (Cursor's rebuild names it, as the main editor is the active part again), and no text editor is active, unless the one that had the keyboard stays reported.
   * @param input - The tab's input: a terminal's, or one of no editor's kind.
   * @param label - The tab's label.
   * @param column - The view column of the group.
   * @param keepsTextEditorReport - Whether the text editor that had the keyboard stays reported.
   * @returns The tab.
   * @example focusEditorAreaTab(new TabInputTerminal(), 'bash', 2, false)
   */
  function focusEditorAreaTab(
    input: object,
    label: string,
    column: number,
    keepsTextEditorReport: boolean,
  ): Tab {
    const reported = keepsTextEditorReport ? focusedSourceEditor() : undefined
    assert.ok(
      !keepsTextEditorReport || reported,
      `No text editor has the keyboard before ${label}`,
    )
    const group = groups.find((candidate) => candidate.viewColumn === column)!
    const tab = { input, label, isPreview: false, isDirty: false }
    group.tabs.push(tab)
    group.activeTab = tab
    const previous = activeTabGroup
    activeTabGroup = group
    leaveChatForMainEditor()
    keyboardOnBody = false
    keyboardInView = false
    innerFocusedPanel = undefined
    // The kept report holds before any listener hears of the tab, and sends no active-editor event; Cursor's rebuild carries it to the group's new object (row 733).
    if (reported)
      textEditorReportedBehindWebview = { group, tab, editor: reported }
    for (const listener of tabChangeListeners)
      listener({ opened: [tab], closed: [], changed: [] })
    if (replacesGroupObjectsOnTabChanges) replaceGroupObjects()
    else changedGroups({ opened: [], closed: [], changed: [previous, group] })
    if (!reported) activeTextEditorChanged(undefined)
    return tab
  }

  /**
   * Mirrors native group creation for the layout-return regressions without changing older fixtures.
   * @param column - The new group's view column; an existing main group of that column is answered as it is.
   * @param preserveLayout - Keeps the measured grid as it is.
   * @param activate - Names the new group as the active one before the group event announces it, as the learner's own new group is (`focusEmptyGroup`, Cycle 0046 rows 714 and 727).
   * @returns The group of that column.
   * @example nativeGroup(3).viewColumn // 3
   */
  function nativeGroup(
    column: number,
    preserveLayout = false,
    activate = false,
  ) {
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
      ? groups.map((previous) =>
          replacedBy(previous, { ...previous, tabs: [...previous.tabs] }),
        )
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
    // The editor's group event already names a group the learner opened as the active one.
    if (activate) activeTabGroup = group
    if (replacesGroupObjectsOnTabChanges) {
      // Cursor names the opened group and gives every surviving group a new object in the same event.
      replaceGroupObjects([], group)
      return group
    }
    changedGroups({ opened: [group], closed: [], changed: retained })
    return group
  }

  /**
   * Inserts the native empty group used by App preparation, preserving old tabs and their group objects; the newGroupAbove command calls it with the first main group active. The new group becomes the active one and takes the keyboard only from the editor area or the page body: a view, the chat view among them, and a side bar keep it (VS Code 1.140.0 `workbench.desktop.main.js` 990:31741, Cursor 17388:33629).
   * @example insertNativeAppGroup() // former main column one becomes column two, with its tabs intact
   */
  function insertNativeAppGroup(): void {
    assert.equal(activeTabGroup.viewColumn, 1)
    // The command acts on the active part's active group: a chat part that is still the active one would get the new group, as Cursor 3.23.12's split did (C61 c61-702-probe step 3: `workbench.action.splitEditor` with the chat input focused added a group to the chat part, holding one of its tabs; Cycle 0046 row 702).
    assert.equal(Boolean(separateEditorPart?.lastActive), false)
    const aboveFirstLeaf = (node: unknown, orientation: number): unknown => {
      if (
        node &&
        typeof node === 'object' &&
        'groups' in node &&
        Array.isArray(node.groups)
      ) {
        const [first, ...rest] = node.groups
        // Split only the first leaf; every other original sibling retains its size and position.
        if (
          orientation === 1 &&
          first &&
          typeof first === 'object' &&
          !('groups' in first)
        )
          return {
            ...node,
            groups: [
              { size: typeof first.size === 'number' ? first.size / 2 : 0.5 },
              {
                ...first,
                size: typeof first.size === 'number' ? first.size / 2 : 0.5,
              },
              ...rest,
            ],
          }
        return {
          ...node,
          groups: [aboveFirstLeaf(first, 1 - orientation), ...rest],
        }
      }
      return {
        ...(node && typeof node === 'object' ? node : {}),
        groups: [{ size: 0.5 }, { size: 0.5 }],
      }
    }
    const orientation =
      editorLayout &&
      typeof editorLayout === 'object' &&
      'orientation' in editorLayout
        ? Number(editorLayout.orientation)
        : 0
    const sizedLayout = structuredClone(editorLayout),
      pixelRows = stackOfRowsAtFirstLeaf(sizedLayout)
    // Both editors' split view sizes the stack of rows the first group stands in, at the root or in a column (rows 691, 703 and 704); a grid in proportions keeps the fake's halving of the first leaf.
    if (pixelRows) {
      const [added, ...kept] = rowsAfterNewGroupAbove(pixelRows.map(layoutSize))
      pixelRows.splice(
        0,
        pixelRows.length,
        { size: added },
        ...pixelRows.map((row, index) => ({
          ...Object(row),
          size: kept[index],
        })),
      )
      editorLayout = sizedLayout
    } else editorLayout = aboveFirstLeaf(editorLayout, orientation)
    const rootChildren = layoutChildren(editorLayout),
      soleChildren =
        rootChildren?.length === 1 ? layoutChildren(rootChildren[0]) : undefined
    // Native editor grids do not retain a redundant root around a single split branch.
    if (soleChildren)
      editorLayout = { orientation: 1 - orientation, groups: soleChildren }
    // Native group insertion renumbers every later main and auxiliary column without replacing their documents.
    for (const group of groups) group.viewColumn++
    // The current native source shifts with its surviving group, including the public test receipt.
    sourceColumn++
    const created: (typeof groups)[number] = { viewColumn: 1, tabs: [] }
    groups.unshift(created)
    for (const current of panels)
      current.viewColumn = groups.find((group) =>
        group.tabs.includes(current.nativeTab),
      )?.viewColumn
    const previouslyFocusedGroup = activeTabGroup,
      reportedBefore = focusedSourceEditor()
    activeTabGroup = created
    innerFocusedPanel = undefined
    // The new empty group's own element takes the keyboard from the editor area, which this model counts as the page body.
    if (!keyboardInView && !keyboardInSideBar) keyboardOnBody = true
    // Cursor 3.23.12 went on reporting the text editor of before until the Application's tab stood in front of the new group (row 710).
    if (keepsTextEditorReportAfterNewGroup && reportedBefore)
      textEditorKeptAtNewGroup = { column: 1, editor: reportedBefore }
    if (replacesGroupObjectsOnTabChanges) replaceGroupObjects([], created)
    else
      changedGroups({
        opened: [created],
        closed: [],
        changed: groups.filter((group) => group !== created),
      })
    if (!textEditorKeptAtNewGroup) activeTextEditorChanged(undefined)
    groupFocusedBeforeInsertion = previouslyFocusedGroup
  }
  /**
   * Ends the report of the text editor that `keepTextEditorReportAfterNewGroup` keeps while the new empty group is the active one, once a pane's tab stands in front of that group: the active text editor is then reported as none, as Cursor 3.23.12 reported it while the Application pane moved into its new group (C61 c61-cu-695c, Cycle 0046 row 710); called by a pane's reveal and registration.
   * @param group - The group a pane's tab now stands in front of.
   * @example endTextEditorReportKeptAtNewGroup(group) // the cited copy kept as the active text editor since newGroupAbove is reported as gone
   */
  function endTextEditorReportKeptAtNewGroup(
    group: (typeof groups)[number],
  ): void {
    if (textEditorKeptAtNewGroup?.column !== group.viewColumn) return
    textEditorKeptAtNewGroup = undefined
    activeTextEditorChanged(focusedSourceEditor())
  }
  /**
   * Names the group of the tab `activateGroupOfTabAfterNextLock` chose as the active one, once, right after a lock answered: a group's activation, which both editors send alone (Cursor 3.23.12 `workbench.desktop.main.js` 17269:28244, `extensionHostProcess.js` 131:33740); called by the fake `workbench.action.lockEditorGroup`.
   * @example activateGroupOfTabOnce() // the group that shows auth.ts is the active one, and one group change lists it alone
   */
  function activateGroupOfTabOnce(): void {
    const tab = groupActivatedAfterLock
    groupActivatedAfterLock = undefined
    if (!tab) return
    const group = groups.find((candidate) => candidate.tabs.includes(tab))
    if (!group) return
    activeTabGroup = group
    changedGroups({ opened: [], closed: [], changed: [group] })
  }
  /** Names the group that held the keyboard before the last native group insertion as active again while the inserted group still holds no tab; see `reactivatePreviousGroupAfterInsertion`. The change lists that group alone, as both editors send an activated group (Cursor 3.23.12 `workbench.desktop.main.js` 17269:28251, `extensionHostProcess.js` 131:33740). @example reactivatePreviousGroup() */
  function reactivatePreviousGroup(): void {
    if (
      !groupFocusedBeforeInsertion ||
      !groups.includes(groupFocusedBeforeInsertion)
    )
      return
    activeTabGroup = groupFocusedBeforeInsertion
    changedGroups({
      opened: [],
      closed: [],
      changed: [groupFocusedBeforeInsertion],
    })
  }
  /**
   * Changes a group's lock as both editors do: a lock that changes fires the group model's `GROUP_LOCKED` change, for which the tab model service sends the extension host a whole new tab model naming the active group (Cursor 3.23.12 `workbench.desktop.main.js` 17264:18055, 17269:31902, 17269:31013; VS Code 1.140.0 705:29187, 725:7861, 725:7244), and the extension host fires one change that lists every group (`extensionHostProcess.js` 131:33177); a lock that changes nothing sends nothing. Cursor's model gives every group a new object; the VS Code model keeps them, as the rest of this harness does. Called by the fake `workbench.action.lockEditorGroup` and `workbench.action.unlockEditorGroup`, and by `lockGroupAsLearner`.
   * @param group - The group whose lock is set.
   * @param locked - The lock it gets.
   * @example setGroupLock(activeTabGroup, true) // the whole tab model is reported once
   */
  function setGroupLock(group: (typeof groups)[number], locked: boolean): void {
    if (Boolean(group.locked) === locked) return
    group.locked = locked
    if (replacesGroupObjectsOnTabChanges) replaceGroupObjects()
    else changedGroups({ opened: [], closed: [], changed: [...groups] })
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
   * Finds the stack of rows that the first group of a layout given in pixels stands in, the stack `modelVsCodeStackedRowSizing` sizes as VS Code's split view does when `workbench.action.newGroupAbove` adds a row above that group: the root's rows, or the rows of the first column when the root stands in columns and its first column is split into rows (a nested split lies across its parent's, `getEditorLayout` alternating the orientation by depth); called by the fake `workbench.action.newGroupAbove` (Cycle 0046 rows 691 and 704).
   * @param layout - The fake editor's layout, or a copy of it that the caller sizes in place.
   * @returns The stack's rows, the very objects of the given layout, when the first group's own split stacks two or more rows that are all given in pixels; `undefined` for a first group whose split is a row of columns, and for proportions.
   * @example
   * stackOfRowsAtFirstLeaf({ orientation: 1, groups: [{ size: 524 }, { size: 163 }] }) // => [{ size: 524 }, { size: 163 }]
   * stackOfRowsAtFirstLeaf({ orientation: 0, groups: [{ size: 550, groups: [{ size: 524 }, { size: 163 }] }, { size: 550 }] }) // => [{ size: 524 }, { size: 163 }]
   */
  function stackOfRowsAtFirstLeaf(layout: unknown): unknown[] | undefined {
    let split = layout,
      stacksRows = Reflect.get(Object(layout), 'orientation') === 1
    // Down the first child of every split to the first group; each level lies across the one above it.
    for (;;) {
      const children = layoutChildren(split)
      if (!children?.length) return undefined
      const first = children[0]
      if (!layoutChildren(first))
        return stacksRows &&
          children.length > 1 &&
          children.every((child) => layoutSize(child) > 1)
          ? children
          : undefined
      split = first
      stacksRows = !stacksRows
    }
  }
  /**
   * Reads the heights of a layout's rows when the layout is a stack of two or more groups at its root, each given in pixels; asked by `removeEmptiedGroup` before it removes an emptied row (Cycle 0046 row 703).
   * @param layout - The fake editor's layout.
   * @returns The rows' heights, top to bottom; `undefined` for columns, a nested split, proportions and a single group.
   * @example rootPixelRows({ orientation: 1, groups: [{ size: 109 }, { size: 107 }, { size: 107 }] }) // => [109, 107, 107]
   */
  function rootPixelRows(layout: unknown): number[] | undefined {
    const rows = layoutChildren(layout)
    return Reflect.get(Object(layout), 'orientation') === 1 &&
      rows &&
      rows.length > 1 &&
      rows.every((row) => !layoutChildren(row) && layoutSize(row) > 1)
      ? rows.map(layoutSize)
      : undefined
  }
  /**
   * Sizes the rows that stay after an editor group's row is removed from a stack, as both editors' split view does with the default `workbench.editor.splitSizing` ("auto"): the editor part removes an emptied group with `removeView(group, Sizing.Auto)` (`doRemoveEmptyGroup`, `getSplitSizingStyle`), the grid names the sibling (`Sizing.Auto(index === 0 ? 1 : index - 1)`), and the split view distributes rows within 2 px of each other evenly again (`areViewsDistributed`; `distributeViewSizes` gives each the floor of the share and `relayout` the rest to the last row) or else adds the removed row's height to that sibling (`removeView`: `i.size += n.size`). The editor area keeps its height either way. Read in the `workbench.desktop.main.js` of VS Code 1.142.0 installed on the development host (offsets 2686250 and 6281045); VS Code 1.140.0's `distributeViewSizes` and `areViewsDistributed` are at 540:71277 and 540:77201. Called by `removeEmptiedGroup` for a root stack of rows given in pixels (Cycle 0046 row 703).
   * @param rows - The heights of the stacked rows before the removal, top to bottom.
   * @param removedIndex - The zero-based position of the removed row.
   * @returns The heights of the rows that stay, top to bottom.
   * @example
   * rowsAfterRemoval([109, 107, 107], 0) // => [161, 162]
   * rowsAfterRemoval([80.5, 80.5, 162, 163, 164], 0) // => [161, 162, 163, 164]
   */
  function rowsAfterRemoval(
    rows: readonly number[],
    removedIndex: number,
  ): number[] {
    const total = rows.reduce((sum, row) => sum + row, 0),
      staying = rows.filter((_row, index) => index !== removedIndex)
    // Rows that were distributed are distributed again over the whole height.
    if (Math.max(...rows) - Math.min(...rows) <= 2) {
      const even = Math.floor(total / staying.length)
      return staying.map((_row, index) =>
        index === staying.length - 1
          ? total - even * (staying.length - 1)
          : even,
      )
    }
    // Otherwise the row before the removed one takes its height, or the row after it when the first row went.
    const sibling = removedIndex === 0 ? 0 : removedIndex - 1
    return staying.map((row, index) =>
      index === sibling ? row + rows[removedIndex]! : row,
    )
  }
  /**
   * Sizes the rows after `workbench.action.newGroupAbove` adds a row above the first one, as VS Code 1.140.0's split view does with its default `workbench.editor.splitSizing` ("auto"): rows within 2 px of each other are distributed evenly (`areViewsDistributed`, `workbench.desktop.main.js` 540:77201; `distributeViewSizes`, 540:71277); otherwise the new row takes half of the row it splits (`addView`, 540:72177) and the height that is now missing is taken from the last row upward, each down to the minimum, the new row last (`relayout` with the new row at low priority, 540:73529 and 540:73732). Cursor 3.23.12 gives the same (c60-cu-567: 328/329 gave 219/219/219). Called by `insertNativeAppGroup` for every stack of rows given in pixels (Cycle 0046 row 703).
   * @param rows - The heights of the stacked rows before the insertion, top to bottom.
   * @returns The heights of the rows after it, the new row first.
   * @example
   * rowsAfterNewGroupAbove([343, 344]) // => [229, 229, 229]
   * rowsAfterNewGroupAbove([524, 163]) // => [262, 355, 70] (VS Code 1.140.0, Cycle 0046 c59-vs-691probe4)
   */
  function rowsAfterNewGroupAbove(rows: readonly number[]): number[] {
    const total = rows.reduce((sum, row) => sum + row, 0)
    // Rows that are distributed already stay distributed, the new one among them.
    if (Math.max(...rows) - Math.min(...rows) <= 2) {
      const even = Math.floor(total / (rows.length + 1))
      return [
        total - even * rows.length,
        ...Array.from({ length: rows.length }, () => even),
      ]
    }
    const sized = [rows[0]! / 2, ...rows]
    let missing = rows[0]! / 2
    // From the last row up to the new one, each row gives what it has above the minimum.
    for (let index = sized.length - 1; index >= 0 && missing > 0; index--) {
      const given = Math.min(missing, sized[index]! - GROUP_MINIMUM_PX.height)
      sized[index]! -= given
      missing -= given
    }
    return sized
  }
  /**
   * Expands a group at its minimum height or width once a numbered focus command made it the active one, as VS Code 1.140.0 does for every group it activates: `doSetGroupActive` restores the group (`workbench.desktop.main.js` 1106:114938 `doRestoreGroup`), which expands a group whose width or height is its minimum (`arrangeGroups` with `EXPAND`, 1106:111202, the grid's `expandView`, 981:48778): the grid view resizes the group's place in every split on its path to as much as it can take (981:39660 `resizeChild(…, Number.POSITIVE_INFINITY)`), so each sibling on that path goes to its own minimum along that split and the group's place takes the rest. Called by the fake numbered focus commands while `modelVsCodeStackedRowSizing` is on (Cycle 0046 row 691; c59-vs-691probe4: 262/355/70, then 70/70/547 after `workbench.action.focusThirdEditorGroup`; row 704 for a group in a nested split). A sibling split to its minimum keeps its own children's sizes, which no test of the model reads; a layout given in proportions is left as it is.
   * @param column - The view column of the group the command activated, its place among the main editor's groups.
   * @example
   * expandMinimizedRow(3) // [262, 355, 70] => [70, 70, 547]
   * expandMinimizedRow(4) // rows [262, 355, 70 split into 550 | 550] => rows [70, 70, 547 split into 220 | 880]
   */
  function expandMinimizedRow(column: number): void {
    const sized = structuredClone(editorLayout),
      path = pathToGroup(sized, column - 1)
    if (
      !path?.every(({ siblings }) =>
        siblings.every((node) => layoutSize(node) > 1),
      )
    )
      return
    /** Gives the size of the group's place along the nearest split on its path that lies along the given axis; the editor area's for none. */
    const extent = (alongRows: boolean): number => {
      const nearest = path.findLast((step) => step.stacksRows === alongRows)
      if (!nearest)
        return alongRows ? EDITOR_AREA_PX.height : EDITOR_AREA_PX.width
      return layoutSize(nearest.siblings[nearest.index])
    }
    if (
      extent(true) !== GROUP_MINIMUM_PX.height &&
      extent(false) !== GROUP_MINIMUM_PX.width
    )
      return
    // In every split on the path the siblings go to their minimum and the group's place takes the rest.
    for (const { siblings, index, stacksRows } of path) {
      const total = siblings.reduce<number>(
        (sum, node) => sum + layoutSize(node),
        0,
      )
      let others = 0
      siblings.forEach((node, position) => {
        if (position === index) return
        const minimum = minimumAlong(node, stacksRows, !stacksRows)
        Reflect.set(Object(node), 'size', minimum)
        others += minimum
      })
      Reflect.set(Object(siblings[index]), 'size', total - others)
    }
    editorLayout = sized
  }
  /**
   * Lists the splits from the root of a layout down to one of its groups, for `expandMinimizedRow`: in each, its children, the place of the group's branch among them and whether they stand in rows.
   * @param layout - A layout, or a copy that the caller resizes in place.
   * @param leafIndex - The zero-based place of the group among the layout's groups, in the order of their view columns.
   * @returns The splits, from the root down; `undefined` when the layout has fewer groups.
   * @example pathToGroup({ orientation: 1, groups: [{ size: 262 }, { size: 425, groups: [{ size: 550 }, { size: 550 }] }] }, 2) // => [{ index: 1, stacksRows: true, … }, { index: 1, stacksRows: false, … }]
   */
  function pathToGroup(
    layout: unknown,
    leafIndex: number,
  ): { siblings: unknown[]; index: number; stacksRows: boolean }[] | undefined {
    let seen = 0
    /** Walks a split's children in order and answers the path below this split to the group, if it lies there. */
    const walk = (
      split: unknown,
      stacksRows: boolean,
    ):
      | { siblings: unknown[]; index: number; stacksRows: boolean }[]
      | undefined => {
      const siblings = layoutChildren(split) ?? []
      for (const [index, node] of siblings.entries()) {
        const below = layoutChildren(node)
          ? walk(node, !stacksRows)
          : seen++ === leafIndex
            ? []
            : undefined
        if (below) return [{ siblings, index, stacksRows }, ...below]
      }
      return undefined
    }
    return walk(layout, Reflect.get(Object(layout), 'orientation') === 1)
  }
  /**
   * Gives the least size a group or a split of groups takes along one axis, as VS Code's grid computes it: a group's minimum height or width ({@link GROUP_MINIMUM_PX}); a split's is the sum of its children's along the axis they stand along, and the largest of theirs across it. Asked by `expandMinimizedRow` for each sibling it shrinks.
   * @param node - A group or a split of groups.
   * @param heights - `true` for the least height, `false` for the least width.
   * @param childrenStackRows - Whether the node's children, if it has any, stand in rows.
   * @returns The least size in pixels.
   * @example minimumAlong({ size: 425, groups: [{ size: 550 }, { size: 550 }] }, true, false) // => 70
   */
  function minimumAlong(
    node: unknown,
    heights: boolean,
    childrenStackRows: boolean,
  ): number {
    const children = layoutChildren(node)
    if (!children)
      return heights ? GROUP_MINIMUM_PX.height : GROUP_MINIMUM_PX.width
    const minimums = children.map((child) =>
      minimumAlong(child, heights, !childrenStackRows),
    )
    return childrenStackRows === heights
      ? minimums.reduce((sum, minimum) => sum + minimum, 0)
      : Math.max(...minimums)
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
   * Lets the editor ask a stopped session's adapter for the top frame of its thread and the adapter answer, as both editors do right after every `stopped` event, also for a stop they keep in the background (`refreshTopOfCallstack`, `fetchCallStack(1)`: a `stackTrace` request with `startFrame` 0 and `levels` 1); the trackers see the request and the response. The answered frame is the one the editor focuses for that stop, by its own handling or later by its pass of the focus or a click on the session's row, so its id is kept for `reportFrameOf`.
   * @param session - The stopped session.
   * @param top - The top frame's file in the harness's folder, and whether skipFiles or smartStep deemphasize it (js-debug's `presentationHint: 'deemphasize'`).
   * @param threadId - The stopped thread whose stack the editor asks for (left out, thread 1).
   * @example answerStackTraceOf({ id: 'learner-node' }, { filename: 'actions.ts', deemphasized: false })
   */
  function answerStackTraceOf(
    session: { id: string },
    top: { filename: string; deemphasized: boolean },
    threadId = 1,
  ): void {
    const frameId = nextStackFrameId++
    const requestSeq = nextDebugMessageSeq++
    for (const tracker of trackersOf(session)) {
      tracker?.onWillReceiveMessage?.({
        type: 'request',
        seq: requestSeq,
        command: 'stackTrace',
        arguments: { threadId, startFrame: 0, levels: 1 },
      })
      tracker?.onDidSendMessage?.({
        type: 'response',
        seq: nextDebugMessageSeq++,
        request_seq: requestSeq,
        success: true,
        command: 'stackTrace',
        body: {
          stackFrames: [
            {
              id: frameId,
              name: 'pausedFunction',
              line: 1,
              column: 1,
              source: {
                name: top.filename,
                path: join(harness.directory, top.filename),
              },
              presentationHint: top.deemphasized ? 'deemphasize' : 'normal',
            },
          ],
          totalFrames: 1,
        },
      })
    }
    stopTopFrameIds.set(`${session.id}#${threadId}`, frameId)
  }
  /**
   * Reports a frame of a session as Run and Debug's active stack item and tells the reader's listeners: the top frame of that session's current stop (`answerStackTraceOf`), which the editor focuses for the stop, or a new frame when the reader heard no stop of it; the frame step of `pauseDebugger`, `showStopKeepingFocus`, which sends it after the file's opening, and of `passFocusToStoppedSession`, which sends it before or after.
   * @param sessionId - The session whose frame the editor focuses.
   * @param threadId - The thread of that frame (left out, thread 1).
   * @example reportFrameOf('live-next-browser')
   */
  function reportFrameOf(sessionId: string, threadId = 1): void {
    activeStackItem = {
      session: { id: sessionId },
      threadId,
      frameId:
        stopTopFrameIds.get(`${sessionId}#${threadId}`) ?? nextStackFrameId++,
    }
    for (const listener of [...activeStackItemListeners]) listener()
  }
  /**
   * Answers {@link NATIVE_DEBUG_FOCUS_SESSION_COMMAND} for the stop the fake historical debugger presented with values, as both editors do: the command focuses the session's frame and opens its source preserving the focus (`stackFrame.openInEditor(editorService, true)`: `revealIfOpened`, the active group preferred), and an editor opened preserving the focus in a group that is not the active one makes that group the active one without giving it the keyboard (VS Code 1.140.0's `handleGroupActivation`, `EditorActivation.ACTIVATE`). So the captured source comes to the front of the group that holds it, that group is the active one, and the editor reports its text editor as the active text editor, while the keyboard stays where it was. C60's c60-vs-567 read it natively at a Repository Wiki recording visit: after the visit's focus return to the Wiki's group (`workbench.action.focusThirdEditorGroup`), `workbench.action.debug.focusProcess` named the learner's first group, with Captured-source.mts in front, and reported that file as the active text editor (ext-observer.json, 3-recording-open.json); c60-cu-567 read the same in Cursor (Cycle 0046 row 721).
   * Not modelled: a source no group holds, which the editor would open in the active group, the active stack item the command focuses, and the command beside Cursor's chat part while that part is the active one, for which no native receipt exists.
   * @example revealHistoricalStopSource() // the learner's first group, with Captured-source.mts in front, is the active group
   */
  function revealHistoricalStopSource(): void {
    const uri = historicalStopSource
    if (!uri || separateEditorPart?.lastActive) return
    /** Finds the source's tab in a group. */
    const sourceTab = (group: (typeof groups)[number]): Tab | undefined =>
      group.tabs.find(
        (tab) =>
          tab.input instanceof TabInputText && tab.input.uri.toString() === uri,
      )
    // `revealIfOpened` takes the group that shows the source in front, the active group first, else a group that holds it.
    const shows = (group: (typeof groups)[number]): boolean =>
      group.activeTab !== undefined && group.activeTab === sourceTab(group)
    const group =
      (shows(activeTabGroup) ? activeTabGroup : undefined) ??
      groups.find(shows) ??
      groups.find((candidate) => sourceTab(candidate) !== undefined)
    if (!group) return
    const previousGroup = activeTabGroup
    group.activeTab = sourceTab(group)
    activeTabGroup = group
    activeTextEditorChanged(focusedSourceEditor())
    changedGroups({
      opened: [],
      closed: [],
      changed: previousGroup === group ? [group] : [previousGroup, group],
    })
  }
  /**
   * Opens a stop's paused file in front of its group preserving the focus, as both editors' stop handling does under `debug.focusEditorOnBreak: false` (`focusStackFrame(…, { preserveFocus: true })` in VS Code 1.140 and Cursor 3.23), and reports the active text editor: when the text editor in front of the active group had the keyboard, it is hidden and the keyboard falls to the page body (Cycle 0046 finding 589, C54 rounds 9f and step1). The file step of `showStopKeepingFocus` and `openPausedFileKeepingFocus`.
   * @param filename - The paused file.
   * @param column - The group the editor opens it in.
   * @example openPausedFileKeepingFocus('login-form.tsx', 2)
   */
  function openPausedFileKeepingFocus(filename: string, column: number): void {
    const pausedColumn = nativeDebugColumn(column)
    // The editor in front of the active group keeps no keyboard once another file covers it there: the keyboard is on no element.
    const hidesFocusedEditor =
      activeTabGroup.viewColumn === pausedColumn &&
      windowState.focused &&
      !keyboardOnBody &&
      !keyboardInView &&
      !keyboardInSideBar &&
      !separateEditorPart?.focused &&
      focusedSourceEditor() !== undefined
    openDraftTab(filename, pausedColumn, true)
    if (hidesFocusedEditor) keyboardOnBody = true
    activeTextEditorChanged(focusedSourceEditor())
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
      label: textTabLabel(document.uri),
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
   * Opens a text tab in front of a group without giving it the keyboard and announces the new tab to the reader's tab listeners; the step of `openPausedFileInLockedGroup` and `openAnnouncedTextTab`.
   * @param filename - The file.
   * @param column - The group, locked or not.
   * @param state - The tab's preview and unsaved-change flags, and optionally the line its text editor's caret stands on, as where the debugger revealed a stop.
   * @returns The tab.
   * @example openAnnouncedTextTab('settings.js', 1, { isPreview: true, isDirty: false, selectedLine: 41 })
   */
  function openAnnouncedTextTab(
    filename: string,
    column: number,
    state: { isPreview: boolean; isDirty: boolean; selectedLine?: number },
  ): Tab {
    const { tab, editor } = openDraftTab(filename, column, true)
    tab.isPreview = state.isPreview
    tab.isDirty = state.isDirty
    if (state.selectedLine !== undefined) {
      const caret = new Position(state.selectedLine, 0)
      editor.selections = [{ anchor: caret, active: caret }]
    }
    for (const listener of tabChangeListeners)
      listener({ opened: [tab], closed: [], changed: [] })
    activeTextEditorChanged(focusedSourceEditor())
    return tab
  }
  /**
   * Gives the text editor of a draft's tab the keyboard, whoever had it before: the tab is in front of its group, the group is the active one, and the editor is reported as the active text editor; called by `focusMutableDraft` for a learner's click and by `pauseDebugger` for the debugger's own opening of the paused file.
   * The group is the one that holds the tab now: Cursor's model replaces every group object at a tab change (`replaceGroupObjects`), so the object the draft was opened in may be retired (Cycle 0046 row 703).
   * @param opened - What `openDraftTab` returned for that draft.
   * @example giveDraftKeyboard(openDraftTab('actions.ts', 1))
   */
  function giveDraftKeyboard(opened: ReturnType<typeof openDraftTab>): void {
    const group =
      groups.find((candidate) => candidate.tabs.includes(opened.tab)) ??
      opened.editor.group
    group.activeTab = opened.tab
    activeTabGroup = group
    leaveChatForMainEditor()
    keyboardOnBody = false
    keyboardInView = false
    activeTextEditorChanged(opened.editor)
  }
  /**
   * Gives a draft's text editor the keyboard as the learner's click into its text does; called by `focusMutableDraft` and its `focus`. In the model of `keepChatPartNameAtLearnersFileClick` the click renames no group while Cursor names its chat part's group: that name stays, with the file reported as the active text editor ({@link giveDraftKeyboard} otherwise).
   * @param opened - What `openDraftTab` returned for that draft.
   * @example clickIntoDraft(openDraftTab('auth.ts', 2)) // auth.ts has the keyboard; Cursor may still name its chat part's group
   */
  function clickIntoDraft(opened: ReturnType<typeof openDraftTab>): void {
    const named = staleNamedGroup ?? activeTabGroup
    giveDraftKeyboard(opened)
    // Cursor 3.23.12 kept its chat part's group named through the learner's click into auth.ts (C61 c61-cu-692; Cycle 0046 rows 702 and 712).
    if (
      keepsChatPartNameAtLearnersFileClick &&
      separateEditorPart &&
      !separateEditorPart.floatingVsCodeChat &&
      named === separateEditorPart.group
    )
      staleNamedGroup = named
  }
  /**
   * Ends the separate part's keyboard and its place as the active editor part, as an editor group, a pane or a text editor of the main editor that takes the keyboard does; called wherever the fake editor gives the main editor the keyboard (a group focus command, a document shown with the focus, a pane revealed with the focus, the learner's click on a tab).
   * @example leaveChatForMainEditor() // layout reads answer for the main editor again
   */
  function leaveChatForMainEditor(): void {
    if (!separateEditorPart) return
    separateEditorPart.focused = false
    separateEditorPart.lastActive = false
  }
  /**
   * Ends the chat input's keyboard when a view that is no editor takes it (the terminal, the Call Stack, a side-bar view, a side bar); Cursor's chat part stays the active editor part, so layout reads still answer for it and no text editor or main pane becomes active (Cursor 3.23.12 17501:84373, 17501:88693), while VS Code's floating chat window gives the active part back to the main window whose view took the keyboard (1.140.0 993:31655); row 647.
   * @example leaveChatForView() // after the learner's click into the terminal beside Cursor's chat
   */
  function leaveChatForView(): void {
    if (!separateEditorPart) return
    separateEditorPart.focused = false
    // Only VS Code's floating window loses its place: Cursor's parts share one window.
    if (separateEditorPart.floatingVsCodeChat)
      separateEditorPart.lastActive = false
  }
  /**
   * Runs the side bar part of `workbench.action.focusSideBar` and `workbench.action.focusAuxiliaryBar` as both editors do: the bar is shown when hidden and its active view container gets the keyboard (VS Code 1.140.0 `workbench.desktop.main.js` 1113:33119 and 859:17926; Cursor 3.23.12 18340:23013 and 17376:10969). A view that had the keyboard elsewhere (the terminal, the Call Stack, VS Code's chat in another bar), the page body and a pane's inner element have it no longer; the editor reports none of it to an extension (row 633).
   * @param auxiliary - `true` for the secondary side bar's command, `false` for the primary one's.
   * @example giveSideBarKeyboard(false) // after workbench.action.focusSideBar: keyboardInSideBar, and no view has the keyboard
   */
  function giveSideBarKeyboard(auxiliary: boolean): void {
    if (sideBars && auxiliary) sideBars.auxiliary = true
    if (sideBars && !auxiliary) sideBars.primary = true
    // VS Code's chat view in front of the secondary bar is that bar's active container: its focus command focuses the chat again.
    if (auxiliary && keyboardInView && viewInSecondarySideBar) return
    keyboardInSideBar = true
    keyboardInView = false
    keyboardOnBody = false
    innerFocusedPanel = undefined
    // The primary bar's view has the keyboard now, so the chat's input has it no longer; only Cursor's Focus Agent or the learner gives it back. (Cursor keeps its chat tab's editor part inside the secondary bar, and what that bar's focus command focuses there is not known: the model leaves the chat as it is for that command.)
    if (!auxiliary) leaveChatForView()
  }
  /** Models native debug opens skipping a locked App group; pause and Call Stack fixtures use an existing unlocked main group, without affecting explicit learner moves. @param requested - Native debug's preferred group. @returns An unlocked main column. @example nativeDebugColumn(1) // => 2 when App group one is locked */
  function nativeDebugColumn(requested: number): number {
    if (!groups.find((group) => group.viewColumn === requested)?.locked)
      return requested
    const unlocked = groups
      .filter((group) => group !== separateEditorPart?.group && !group.locked)
      .toSorted((left, right) => left.viewColumn - right.viewColumn)[0]
    assert.ok(
      unlocked,
      'This native routing fixture requires an unlocked main group',
    )
    return unlocked.viewColumn
  }
  /**
   * Removes an emptied native group for {@link closeTabs} and pane disposal, modelling the host's editor-part focus restoration.
   * @param emptied - The current group whose last tab closed.
   * @param preserveFocus - Whether the close suppresses native restoration after the grid contracts.
   * @example removeEmptiedGroup(group, false) // an actual editor input keeps its keyboard; a terminal keeps its own
   */
  function removeEmptiedGroup(
    emptied: (typeof groups)[number],
    preserveFocus = true,
  ): void {
    const main = groups
      .filter((candidate) => candidate !== separateEditorPart?.group)
      .toSorted((left, right) => left.viewColumn - right.viewColumn)
    // The editor keeps its last group even when it is empty.
    if (main.length < 2 || !groups.includes(emptied)) return
    // Cursor rebuilds its editor grid when a group closes, and the text editor that had the keyboard loses it to the page body. A page of the editor that is no text editor (its Settings) lies in the same grid and is modelled the same way; no trace shows that case yet.
    if (
      losesKeyboardWhenGroupCloses &&
      !separateEditorPart?.focused &&
      (!modelsNativeTabCloseFocus ||
        (windowState.focused && !keyboardInView && !keyboardInSideBar)) &&
      (focusedSourceEditor() ||
        activeTabGroup.activeTab?.input instanceof TabInputUnknown)
    )
      keyboardOnBody = true
    // Both editors leave a maximization when a group is removed from their grid, and the groups that remain have the sizes they had before it (the grid's `removeView` exits the maximized view first).
    maximizedEditorGroup = false
    // A root stack of rows in pixels keeps the editor area's height, as the split view's removal does (row 703); other grids lose the leaf alone.
    const rowsBefore = rootPixelRows(editorLayout)
    editorLayout = rowsBefore
      ? {
          orientation: 1,
          groups: rowsAfterRemoval(rowsBefore, main.indexOf(emptied)).map(
            (size) => ({ size }),
          ),
        }
      : layoutWithoutLeaf(editorLayout, main.indexOf(emptied))
    groups.splice(groups.indexOf(emptied), 1)
    for (const remaining of groups)
      if (remaining.viewColumn > emptied.viewColumn) remaining.viewColumn--
    // Removing an earlier native group renumbers the source receipt too; it is not another source reveal.
    if (sourceColumn > emptied.viewColumn) sourceColumn--
    // Cursor's extension host builds every tab object anew from the whole tab model a removed group brings.
    if (rebuildsTabObjectsAtGroupRemoval) rebuildTabObjects()
    for (const retained of panels)
      retained.viewColumn = groups.find((candidate) =>
        candidate.tabs.includes(retained.nativeTab),
      )?.viewColumn
    if (activeTabGroup === emptied) activeTabGroup = groups[0]!
    // A group's close is a closing rebuild too: beside Cursor's active chat part it names the chat part's group (row 702).
    if (replacesGroupObjectsOnTabChanges)
      replaceGroupObjects([emptied], undefined, true, false, true)
    else changedGroups({ opened: [], closed: [emptied], changed: [...groups] })
    // Both installed hosts restore only an actual editor-part input or BODY; terminal/sidebar chat lie outside that container.
    if (
      modelsNativeTabCloseFocus &&
      !preserveFocus &&
      windowState.focused &&
      !keyboardInView &&
      !keyboardInSideBar &&
      !separateEditorPart?.focused
    )
      keyboardOnBody = false
  }
  /**
   * Disposes the panel of every webview tab a close took out of the editor, as both editors do before the extension's close continuation runs; called by the fake `tabGroups.close` after {@link closeTabs}, for its tab overload and its group overload alike.
   * @param closedTabs - The tabs the close was asked for; a panel whose tab a group kept (a tab that refused to close) stays.
   * @example disposePanelsOfClosedTabs([...group.tabs]) // the group's Application pane fires its onDidDispose and leaves the harness's panels
   */
  function disposePanelsOfClosedTabs(closedTabs: readonly Tab[]): void {
    for (const current of [...panels])
      if (
        closedTabs.some((tab) => tab.input === current.nativeTab.input) &&
        !groups.some((group) =>
          group.tabs.some((tab) => tab.input === current.nativeTab.input),
        )
      )
        current.dispose()
  }
  /**
   * Gives every tab of the fake tab model a new Tab object with the same input, label and state, as Cursor 3.23.12 does when the editor answers a removed group with a whole new tab model (`workbench.desktop.main.js` 17269:26248 `onDidRemoveGroup` → `_createTabsModel`), from which its extension host builds every group and tab object anew (`$acceptEditorTabModel`); called by {@link removeEmptiedGroup} in the model of `rebuildTabObjectsAtGroupRemoval`.
   * The harness's own notes of a tab (a dead pane, a restored captured source, a tab that refuses its close), the panels' tabs and the chat part's tab follow their new objects; an object a test kept is in no group any more.
   * @example rebuildTabObjects() // harness.groups[0].tabs[0] is another object for the same tab
   */
  function rebuildTabObjects(): void {
    const rebuilt = new Map<Tab, Tab>()
    for (const group of groups) {
      group.tabs = group.tabs.map((tab) => {
        const next = { ...tab }
        rebuilt.set(tab, next)
        return next
      })
      if (group.activeTab)
        group.activeTab = rebuilt.get(group.activeTab) ?? group.activeTab
    }
    // A note the harness keeps of a tab follows the tab, not its object.
    for (const notes of [leftoverCapturedTabs, deadPaneTabs, closeRefusingTabs])
      for (const [previous, next] of rebuilt)
        if (notes.delete(previous)) notes.add(next)
    for (const current of panels) {
      const next = rebuilt.get(current.nativeTab)
      if (next) current.refreshTabWrapper(next)
    }
    if (separateEditorPart)
      separateEditorPart.tab =
        rebuilt.get(separateEditorPart.tab) ?? separateEditorPart.tab
  }
  /**
   * Closes tabs as the editor does, group by group, for the reader's `tabGroups.close` requests and for the Close Editor command.
   * A group that loses the tab it shows brings a hidden editor area back, and a native group a dead pane leaves empty is removed by {@link removeEmptiedGroup}.
   * @param tabs - The tabs to close; a tab the editor will not release keeps every requested tab of its own group.
   * @param preserveFocus - The host's focus flag; false activates a remaining neighbour or restores editor-part focus when the group ends.
   * @returns
   * - `true` when every requested tab closed
   * - `false` when a group kept its tabs because one of them refuses to close
   * @example closeTabs([leftover]) // => true, and the tab beside the leftover is the one its group shows
   */
  function closeTabs(tabs: Tab[], preserveFocus = true): boolean {
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
      if (active && tabs.includes(active)) {
        group.activeTab = group.tabs.at(-1)
        closedActiveLeftover = true
        // False on a nonempty group activates its replacement editor even when another file or a view held the keyboard.
        if (modelsNativeTabCloseFocus && !preserveFocus && group.tabs.length) {
          activeTabGroup = group
          keyboardOnBody = false
          keyboardInView = false
          keyboardInSideBar = false
        }
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
      removeEmptiedGroup(emptied, preserveFocus)
    }
    // Cursor answers closed tabs with new group objects, which name the chat part's group beside its active chat part (row 702); a removed group above already came with them.
    if (
      groups.length === groupCountBefore &&
      tabs.some((tab) => !groups.some((group) => group.tabs.includes(tab)))
    )
      replaceGroupObjects([], undefined, true, false, true)
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
    // Every close of a tab (a close request, the learner's Close Editor, a dead pane's removal) changes the visible text editors, not only the reader's own close request.
    if (tabs.some((tab) => !groups.some((group) => group.tabs.includes(tab))))
      changedVisibleEditors()
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
  /**
   * Gives Cursor's chat input the keyboard as its Focus Agent does: the chat's part is the active part and has the keyboard, no tab or group changes and the named group stays the named one, no text editor is active any more, and layout reads answer the chat part's grid; run by the fake editor for `composer.focusComposer`, at once or, with `focusAgentLater`, after the command answered. Cursor 3.23.12 answered so from a file of the main editor and from the chat (C61 c61-702-probe steps 2 and 5: no active text editor, the file's group 1 still named, the chat part's grid; Cycle 0046 row 702).
   * @example focusChatInput()
   */
  function focusChatInput(): void {
    if (!separateEditorPart) return
    separateEditorPart.focused = true
    separateEditorPart.lastActive = true
    keyboardOnBody = false
    keyboardInView = false
    innerFocusedPanel = undefined
    // The chat has the keyboard again: a pane revealed beside it no longer reports itself active (Cursor 3.27.22 model).
    if (ignoresFirstGroupFocusCommandBesideChatFlag) {
      heldActivePane = undefined
      staleNamedGroup = undefined
      for (const panel of panels) panel.notifyViewState()
    }
    activeTextEditorChanged(undefined)
  }
  /**
   * Gives Cursor's chat input the keyboard of an earlier Focus Agent that has not reached it yet; see `focusAgentLater`.
   * @example runEditorChangeLater(focusChatInputOwed, 0)
   */
  function focusChatInputOwed(): void {
    if (commandsUntilAgentFocus === 0) return
    commandsUntilAgentFocus = 0
    focusChatInput()
  }
  /**
   * Gives the separate part's chat the keyboard the way both editors report it: its group is the active tab group, no text editor is active, and a layout read is answered for the chat's own part. The learner's click into Cursor's Agent chat tab (`chat.focusTab()`), and VS Code's numbered focus command for a floating window's group, both end so.
   * @example focusSeparatePartGroup()
   */
  function focusSeparatePartGroup(): void {
    const previous = activeTabGroup
    activeTabGroup = separateEditorPart!.group
    separateEditorPart!.focused = true
    separateEditorPart!.lastActive = true
    keyboardOnBody = false
    keyboardInView = false
    innerFocusedPanel = undefined
    changedGroups({
      opened: [],
      closed: [],
      changed: [previous, activeTabGroup],
    })
    activeTextEditorChanged(undefined)
  }
  /**
   * Gives the active group of the main editor the keyboard after a layout command, as both editors do when the page body had it: `applyLayout` notes whether the body or the editor area had the focus and focuses the active group after the new grid (VS Code 1.140.0 `workbench.desktop.main.js` 1106:112155 with 1106:112962; Cursor 3.23.12 17501:57509), and a group's focus focuses its active editor (1106:74902): a pane's webview takes the keyboard (705:66733), and so does a text editor. An empty group keeps it on its own element, which this model counts as the page body.
   * @example focusActiveGroupAfterLayout() // the Application pane in front of the active group has the keyboard
   */
  function focusActiveGroupAfterLayout(): void {
    if (!keyboardOnBody || !windowState.focused) return
    const front = activeTabGroup.activeTab
    if (!front) return
    keyboardOnBody = false
    const pane = [...panels].find((candidate) => candidate.nativeTab === front)
    // A pane in front takes the keyboard into its document; a text editor in front has it as the active text editor already.
    if (pane && !suppressNativeInnerFocus) innerFocusedPanel = pane.kind
  }
  /**
   * Says whether the text editor in front of a group has the keyboard: the group is the active one, its front tab is the active text editor's, and neither a view, a side bar, the page body nor another part's chat has the keyboard; asked by `panel` when a pane is created without the keyboard in that group.
   * Both editors give a webview created in front of that editor no keyboard, and the hidden editor loses it to the page body (C60, Cycle 0046 row 694: Cursor 3.23.12 `auth.ts` in column 2 with its TEXTAREA, then BODY once the Repository Wiki was created there with `preserveFocus`; VS Code 1.140.0 the same).
   * @param group - The group the pane is created in.
   * @returns `true` for such a group; `false` otherwise.
   * @example textEditorHasKeyboardIn(groups[1]) // => true while auth.ts in front of the second group has the keyboard
   */
  function textEditorHasKeyboardIn(group: (typeof groups)[number]): boolean {
    const editor = focusedSourceEditor(),
      front = group.activeTab?.input
    return Boolean(
      editor &&
      group === activeTabGroup &&
      // A side of the diff in front hides with the diff as a plain text editor does (row 709, the mechanism of row 694).
      ((front instanceof TabInputText &&
        front.uri.toString() === editor.document.uri.toString()) ||
        showsAsDiffSide(group, editor.document.uri)) &&
      windowState.focused &&
      !keyboardInView &&
      !keyboardInSideBar &&
      !keyboardOnBody &&
      !separateEditorPart?.focused,
    )
  }
  /**
   * Says whether the document of the pane in front of a group has the keyboard: the group is the active one, its front tab is that pane's and the pane's document took the keyboard (`innerFocusedPanel`), and neither a view, a side bar, the page body nor another part's chat has it; asked by `panel` when a pane is created without the keyboard in that group.
   * A webview created in front of that pane hides it, as it hides a text editor (row 694): a document that is no longer rendered cannot keep the focus, and the page's focus falls back to its body (the HTML standard's focus fixup rule), where nothing types (Cycle 0046 row 705).
   * @param group - The group the pane is created in.
   * @returns `true` for such a group; `false` otherwise.
   * @example paneDocumentHasKeyboardIn(groups[1]) // => true while the Study pane in front of the second group has the keyboard in its document
   */
  function paneDocumentHasKeyboardIn(group: (typeof groups)[number]): boolean {
    const front = group.activeTab?.input
    return Boolean(
      group === activeTabGroup &&
      front instanceof TabInputWebview &&
      front.viewType === innerFocusedPanel &&
      windowState.focused &&
      !keyboardInView &&
      !keyboardInSideBar &&
      !keyboardOnBody &&
      !separateEditorPart?.focused,
    )
  }
  /** Models the active-text receipt independently of native tab focus for workspace handoff regressions. @example focusedSourceEditor() // prior source until its native clear arrives */
  function focusedSourceEditor(): SourceEditor | undefined {
    if (partialFocusEditor) return partialFocusEditor.value
    // The new empty group the editor activated still reports the text editor of before (`keepTextEditorReportAfterNewGroup`, row 710).
    if (
      textEditorKeptAtNewGroup &&
      activeTabGroup.viewColumn === textEditorKeptAtNewGroup.column &&
      !activeTabGroup.tabs.length
    )
      return textEditorKeptAtNewGroup.editor
    // The active part's active editor is the chat while that part is the active one, whether its input or a view has the keyboard.
    if (separateEditorPart?.lastActive) return undefined
    const input = activeTabGroup.activeTab?.input
    // VS Code's stale report of the text editor behind the Wiki lasts until another group or tab is the active one.
    if (textEditorReportedBehindWebview) {
      if (
        activeTabGroup === textEditorReportedBehindWebview.group &&
        activeTabGroup.activeTab === textEditorReportedBehindWebview.tab
      )
        return textEditorReportedBehindWebview.editor
      textEditorReportedBehindWebview = undefined
    }
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
        // A diff editor in front reports its modified side's text editor as the active one (row 688).
        ((input instanceof TabInputText &&
          input.uri.toString() === editor.document.uri.toString()) ||
          (input instanceof TabInputTextDiff &&
            input.modified.toString() === editor.document.uri.toString())),
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
  /**
   * Makes a Repository Wiki panel's document answer as the Wiki's script does (`ui/repositoryHtml.ts`): once the reader wrote its HTML it posts `ready`, and for every article model the reader posts while the panel is visible it posts `rendered` with that model's revision and selection; called by `panel` for the Wiki's view type, so a real Repository Wiki reader made with `createRepositoryWikiReader` can wait for its article to render (Cycle 0046 row 674).
   * A model posted while the panel is hidden is not rendered, as a hidden document is gone. The panel's own `reveal` that brings it to the front of its group again loads its HTML anew, whose script posts `ready` again: "The contents of webviews however are created when the webview becomes visible and destroyed when the webview is moved into the background", and VS Code "will automatically restore the webview's content from `webview.html` when the panel is brought to the foreground again" (the Webview API guide; the Wiki's panel keeps no context while hidden). The Study's article Return reveals the Wiki so after the parked Application covered it (Cycle 0046 row 703); a learner's click on its tab is not modelled.
   * @param wiki - The Wiki's panel, right after `panel` made it.
   * @example answerAsWikiDocument(value) // value.webview.html = repositoryHtml() then posts { type: 'ready' }
   */
  function answerAsWikiDocument(wiki: ReturnType<typeof panel>): void {
    const postToDocument = wiki.webview.postMessage,
      reveal = wiki.reveal.bind(wiki)
    let html = ''
    Object.defineProperty(wiki.webview, 'html', {
      get: () => html,
      set: (value: string) => {
        html = value
        // The script runs once the document has loaded, after the extension wrote it.
        queueMicrotask(() => wiki.emit({ type: 'ready' }))
      },
    })
    wiki.reveal = (column?: number, preserveFocus?: boolean): void => {
      const wasHidden = !wiki.visible
      reveal(column, preserveFocus)
      // A document whose panel came back to the front loads again from the panel's HTML.
      if (wasHidden && wiki.visible && html)
        queueMicrotask(() => wiki.emit({ type: 'ready' }))
    }
    wiki.webview.postMessage = async (
      message: Parameters<typeof postToDocument>[0] | RepositoryViewMessage,
    ): Promise<boolean> => {
      if (message.type !== 'repository') return postToDocument(message)
      if (!wiki.visible) return false
      queueMicrotask(() =>
        wiki.emit({
          type: 'rendered',
          revision: message.revision,
          selection: message.selection,
          width: 1024,
        }),
      )
      return true
    }
  }
  function panel(
    kind: string,
    title = '',
    options?: { viewColumn: number; preserveFocus?: boolean },
  ) {
    if (failedPanelKind === kind) {
      failedPanelKind = undefined
      throw new Error('Injected native panel creation failure')
    }
    // The tab of a webview panel is labelled with the panel's title, as both editors' tab models name it.
    let nativeTab: Tab = {
      input: new TabInputWebview(kind),
      label: title,
      isPreview: false,
    }
    const epoch = randomUUID(),
      messageListeners = new Set<(message: unknown) => void>()
    const emit = (message: unknown): void => {
      for (const listener of messageListeners) listener(message)
    }
    let registered = delayedPanelKind !== kind
    const disposed: (() => void)[] = [],
      viewChanged: (() => void)[] = []
    // Native webviews create only one missing group, even when a later column was requested.
    let actualViewColumn = options?.viewColumn
      ? nativeReaderColumn(options.viewColumn)
      : options?.viewColumn
    let isDisposed = false
    const value = {
      // As the editor's WebviewPanel names it, so a test can find one panel among the native ones; after its disposal it throws, as the editor's does, once a test asks for that (`throwFromDisposedPanelGetters`).
      get viewType(): string {
        if (throwsFromDisposedPanelGetters && isDisposed)
          throw new Error('Webview is disposed')
        return kind
      },
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
            | NodeTestOutputUpdate
            | {
                type: 'codebook-focus'
                phase: string
                requestId: string
                epoch?: string
              },
        ) => {
          if (message.type === 'node-history-output') {
            applicationOutputs.push({ ...message, panel: kind })
            return true
          }
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
            if (message.phase === 'prepare' || message.phase === 'inspect')
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
      /** The panel's column as the editor's WebviewPanel reports it: its tab's group's column, unless `reportPanelColumn` makes it report another. */
      get viewColumn(): number | undefined {
        if (throwsFromDisposedPanelGetters && isDisposed)
          throw new Error('Webview is disposed')
        return reportedPanelColumns.has(kind)
          ? reportedPanelColumns.get(kind)
          : actualViewColumn
      },
      set viewColumn(column: number | undefined) {
        actualViewColumn = column
      },
      get title() {
        return title
      },
      /**
       * Retitles the pane as `WebviewPanel.title` does: both editors' tab models name a webview's tab by its panel's title, so the tab's label follows, and the editor tells its tab listeners that the tab changed (VS Code 1.140.0's main thread answers the editor input's label change with a tab update, which the extension host reports as a changed tab). C60's c60-vs-567 and c60-cu-567 read the parked recording's tab as "codebook · Recorded application" (3-recording-open.json, 5-after-return.json; Cycle 0046 row 722).
       * @param value - The new title.
       */
      set title(value: string) {
        title = value
        nativeTab.label = value
        // Only a tab that stands in a group is reported.
        if (groups.some((group) => group.tabs.includes(nativeTab)))
          for (const listener of tabChangeListeners)
            listener({ opened: [], closed: [], changed: [nativeTab] })
      },
      /**
       * Keeps the actual panel handle associated with its current tab wrapper for registration and full-model resync tests.
       * @param replacement - A full-model replacement already present in the current native groups; omitted, only the tab object is rebuilt.
       * @example panel.refreshTabWrapper(refreshedTab)
       */
      refreshTabWrapper(replacement?: Tab): void {
        const previous = nativeTab
        nativeTab =
          replacement?.input instanceof TabInputWebview
            ? Object.assign(replacement, {
                input: replacement.input,
                isPreview: Boolean(replacement.isPreview),
              })
            : { ...nativeTab }
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
            !separateEditorPart?.lastActive &&
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
        // The editor reports the reveal's own group active a moment after the reveal answered, although the reveal keeps the keyboard.
        if (
          activatesApplicationGroupLateAfterReveal &&
          kind === 'codebook.scopedBrowser' &&
          preserveFocus &&
          column === undefined &&
          !applyingLaterReveal
        )
          queueLateGroupActivation(() =>
            groups.find((candidate) => candidate.tabs.includes(nativeTab)),
          )
        // The pane comes to the front of its group, or moves to another column, with the tab events of that, one turn after this call returned.
        const revealsInPlaceLater =
            revealsPanelsLater &&
            column === undefined &&
            !groups.some((group) => group.activeTab === nativeTab),
          movesLater =
            movesPanelsLater &&
            column !== undefined &&
            nativeReaderColumn(column) !== value.viewColumn
        if (!applyingLaterReveal && (revealsInPlaceLater || movesLater)) {
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
          const homeGroup = groups.find((candidate) =>
              candidate.tabs.includes(nativeTab),
            ),
            homeIndex = homeGroup?.tabs.indexOf(nativeTab) ?? -1
          const destinationGroup = nativeGroup(value.viewColumn ?? 1)
          // Cursor 3.27.22 reports the open in the new group first; the old group still holds the tab until the close that follows (N64p2-F1).
          const closesAfterOpen =
            reportsPaneMoveAsOpenThenCloseFlag &&
            homeGroup !== undefined &&
            homeGroup !== destinationGroup
          for (const group of groups) {
            if (closesAfterOpen && group === homeGroup) continue
            group.tabs = group.tabs.filter((tab) => tab !== nativeTab)
            if (group.activeTab === nativeTab)
              group.activeTab = group.tabs.at(-1)
          }
          const group = destinationGroup
          revealIntoHiddenEditorArea(
            group.viewColumn,
            !wasInFront || !preserveFocus,
          )
          const shownBeforeMove = group.activeTab,
            shownIndexBeforeMove = shownBeforeMove
              ? group.tabs.indexOf(shownBeforeMove)
              : -1
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
          // A pane revealed in its own group keeps its place there; one that moves comes right after the tab its new group showed (row 703).
          if (group === homeGroup) group.tabs.splice(homeIndex, 0, nativeTab)
          else
            insertAfterShownTab(
              group,
              nativeTab,
              shownBeforeMove,
              shownIndexBeforeMove,
            )
          group.activeTab = nativeTab
          if (closesAfterOpen && homeGroup) {
            // The open is reported with every group an object anew, then the old group's tab closes.
            replaceGroupObjects()
            const standingHome = currentGroupOf(homeGroup) ?? homeGroup
            standingHome.tabs = standingHome.tabs.filter(
              (tab) => tab !== nativeTab,
            )
            if (standingHome.activeTab === nativeTab)
              standingHome.activeTab = standingHome.tabs.at(-1)
          }
          endTextEditorReportKeptAtNewGroup(group)
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
            // VS Code removes the emptied group a moment after the move is reported (row 658): while the next layout read is pending, or by itself later; the group still empty then goes, at the column it stands at by then.
            if (removesGroupLeftByMoveLater) {
              const removeLater = (): void => {
                const index = pendingMoveRemovals.indexOf(removeLater)
                if (index < 0) return
                pendingMoveRemovals.splice(index, 1)
                // Cursor replaced every group object at the pane's move (N64p2-F1): the group is followed to the object the model holds by then.
                const standing = currentGroupOf(emptied)
                if (!standing || standing.tabs.length) return
                automaticallyClosedColumns.push(standing.viewColumn)
                removeEmptiedGroup(standing)
              }
              pendingMoveRemovals.push(removeLater)
              runEditorChangeLater(
                removeLater,
                MOVED_PANE_GROUP_REMOVAL_DELAY_MS,
              )
            } else {
              automaticallyClosedColumns.push(emptied.viewColumn)
              removeEmptiedGroup(emptied)
            }
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
            // Cursor 3.27.22 beside the chat: the revealed pane has the keyboard and reports itself active, the editor goes on naming the chat's group, and no group event arrives.
            if (
              ignoresFirstGroupFocusCommandBesideChatFlag &&
              separateEditorPart &&
              ((staleNamedGroup ?? activeTabGroup) ===
                separateEditorPart.group ||
                separateEditorPart.lastActive)
            ) {
              staleNamedGroup = staleNamedGroup ?? activeTabGroup
              heldActivePane = kind
              leaveChatForMainEditor()
              for (const panel of panels) panel.notifyViewState()
            }
            leaveChatForMainEditor()
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
      disposeListenerCount: () => disposed.length,
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
        isDisposed = true
        if (!panels.delete(value)) return
        // A disposed pane that had the keyboard leaves it to no editor.
        if (
          !keyboardInView &&
          !separateEditorPart?.focused &&
          activeTabGroup.activeTab === nativeTab
        )
          keyboardOnBody = true
        const closeTab = (): void => {
          // The pane was focused again after its disposal (a group focus command reached its group before the editor closed its tab): the keyboard goes with the closing tab, and the editor focuses nothing in its place.
          if (
            !keyboardInView &&
            !separateEditorPart?.focused &&
            activeTabGroup.activeTab === nativeTab
          )
            keyboardOnBody = true
          const emptied = groups.filter(
            (group) => group.tabs.length === 1 && group.tabs[0] === nativeTab,
          )
          for (const group of groups) {
            group.tabs = group.tabs.filter((tab) => tab !== nativeTab)
            if (group.activeTab === nativeTab)
              group.activeTab = group.tabs.at(-1)
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
        // Cursor's group model selects the next tab before it closes the disposed one: `$acceptTabOperation` kind 2 reaches the extension host first, with no group event and the disposed tab still listed (Cycle 0056, N55-F4 refusal 2).
        const sharedGroup = groups.find(
          (group) => group.activeTab === nativeTab && group.tabs.length > 1,
        )
        if (activatesNextTabBeforeDisposedPaneTabCloses && sharedGroup) {
          const nextTab = sharedGroup.tabs.find((tab) => tab !== nativeTab)!
          // The notification arrives while the first layout read after the disposal is in flight (`pendingNextTabActivation`), or {@link NEXT_TAB_ACTIVATION_DELAY_MS} after the disposal when no read comes.
          const activateNextTab = (): void => {
            if (pendingNextTabActivation !== activateNextTab) return
            pendingNextTabActivation = undefined
            // Looked up again: a rebuild of the group objects since the disposal would leave `sharedGroup` stale.
            const holder = groups.find((group) => group.tabs.includes(nextTab))
            if (holder) holder.activeTab = nextTab
            for (const listener of tabChangeListeners)
              listener({ opened: [], closed: [], changed: [nextTab] })
          }
          pendingNextTabActivation = activateNextTab
          runEditorChangeLater(activateNextTab, NEXT_TAB_ACTIVATION_DELAY_MS)
          pendingDisposedTabCloses.push(closeTab)
          applyByItselfLater(closeTab)
        } else if (
          closeDisposedPanelTabsLater ||
          closeDisposedPanelTabsDuringLayoutRead
        ) {
          // VS Code closes a disposed editor from a worker with a 0 ms delay; a layout read that reached the busy window with the disposal is answered before that worker runs.
          pendingDisposedTabCloses.push(closeTab)
          // Without a layout read the worker closes the tab by itself a moment later.
          applyByItselfLater(closeTab)
        } else closeTab()
        for (const listener of disposed) listener()
      },
    }
    if (kind === 'codebook.repositoryWiki') answerAsWikiDocument(value)
    // Both hosts initialize optimistic panel flags before the native tab/view-state acknowledgement arrives.
    const register = (): void => {
      registered = true
      const group = nativeGroup(value.viewColumn ?? 1)
      // A pane created without the keyboard in front of the text editor that has it hides that editor: the keyboard falls to the page body (row 694).
      if (options?.preserveFocus && textEditorHasKeyboardIn(group))
        keyboardOnBody = true
      // So does one created in front of a pane whose document has the keyboard: the hidden pane's document leaves it (row 705).
      if (options?.preserveFocus && paneDocumentHasKeyboardIn(group)) {
        innerFocusedPanel = undefined
        keyboardOnBody = true
      }
      if (!group.tabs.includes(nativeTab)) {
        insertAfterShownTab(group, nativeTab)
        // Cursor reports the opened tab before it reports it as the tab its group shows (obs15 P1: "opened", then "changed").
        if (replacesGroupObjectsOnTabChanges)
          for (const listener of tabChangeListeners)
            listener({ opened: [nativeTab], closed: [], changed: [] })
      }
      group.activeTab = nativeTab
      endTextEditorReportKeptAtNewGroup(group)
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
  /** Whether the fake recorded viewport has a required frame queued behind one in flight, which makes it drop preview frames; see `holdRequiredFramePending`. */
  let requiredFramePending = false
  /** Whether the fake recorded viewport has a pause image pinned, which makes its delivery refuse preview frames; see `holdPausePinned`. */
  let pausePinned = false
  /** Whether the fake recorded viewport has no renderer epoch (the renderer was suspended and has not shaken hands again), which makes its delivery refuse every frame; see `holdRendererEpochMissing`. */
  let rendererEpochMissing = false
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
        assertCanReveal?(current: ReturnType<typeof panel>): void
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
        // Native visibility changes use the same final lease admission as the production viewport.
        if (!this.panel.visible) {
          this.lease.assertCanReveal?.(this.panel)
          this.panel.reveal(this.panel.viewColumn, true)
        }
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
      if (this.panel.visible) return
      // The real viewport rejects an already unsafe target before its owner can move keyboard focus.
      this.lease.assertCanReveal?.(this.panel)
      const keeps = (await this.lease.comesWithoutKeyboard?.()) ?? false
      this.lease.assertCanReveal?.(this.panel)
      this.panel.reveal(this.panel.viewColumn, keeps)
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
    /** Every pane state the chrome-extension view sent, in order. */
    readonly extensionPanes: { phase: string; message: string }[] = []
    /** Records the chrome-extension pane state the real viewport would send to its renderer. @example viewport.setExtensionPane(pane) */
    setExtensionPane(pane: { phase: string; message: string }): void {
      this.extensionPanes.push(pane)
    }
    /** The fake screencast has shown no frame. */
    lastFrameAt(): number | undefined {
      return undefined
    }
    /** The fake renderer needs no screencast. */
    async attach(): Promise<void> {}
    /** The fake renderer has no pinned pause to leave. */
    resume(): void {}
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
    /**
     * Shows the next recorded frame at once and clears nothing, as the real viewport's non-required preview frame does; the later required frame follows with the receipt.
     * The frame is dropped under the conditions of the real viewport and {@link FrameDelivery.accepts}: the viewport is not a recording, is closed or historical, the delivery has no renderer epoch (see `holdRendererEpochMissing`), a pause image is pinned (see `holdPausePinned`), or a required frame is pending (see `holdRequiredFramePending`); the pane then keeps what it showed.
     * @returns `true` when the frame was shown; `false` when it was dropped.
     * @example viewport.previewRecorded(png.toString('base64'), 'Recorded · 1.50 s')
     */
    previewRecorded(image: string): boolean {
      if (
        this.mode !== 'recording' ||
        this.closed ||
        this.historical ||
        rendererEpochMissing ||
        pausePinned ||
        requiredFramePending
      )
        return false
      displayedImage = image
      return true
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
    const held =
      nextOpen && (!nextOpen.uri || nextOpen.uri === uri.toString())
        ? nextOpen
        : undefined
    if (held) nextOpen = undefined
    if (held) {
      held.entered()
      await held.wait
    }
    if (sourceOpenFailure && uri.scheme !== 'file')
      throw new Error('Injected current source open failure')
    // VS Code keeps one document model for an open URI; provider events update it independently of editor reveals.
    const existing =
      uri.scheme !== 'file' && virtualSourceDocuments.get(uri.toString())
    let text = existing ? existing.text : ''
    // A cached model keeps its bytes; uncached inputs use their own file or provider boundary.
    if (!existing)
      text =
        uri.scheme === 'file'
          ? await readFile(uri.fsPath, 'utf8')
          : await sourceProvider(uri)
    const model = existing || {
      text: text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'),
      languageId: uri.path.endsWith('.tsx') ? 'typescriptreact' : 'typescript',
    }
    if (uri.scheme !== 'file') virtualSourceDocuments.set(uri.toString(), model)
    /** Moves a position into the document's text, as the editor's TextDocument does. */
    const validatePosition = (position: Position): Position => {
      const lines = model.text.split('\n'),
        line = Math.min(position.line, lines.length - 1)
      return new Position(
        line,
        Math.min(position.character, lines[line]!.length),
      )
    }
    return {
      uri,
      getText: () => model.text,
      get languageId() {
        return model.languageId
      },
      validatePosition,
      // A Repository Wiki citation moves its cited lines into the document before it selects them (createRepositoryWikiReader).
      validateRange: (range: Range): Range =>
        new Range(validatePosition(range.start), validatePosition(range.end)),
    }
  }
  const summaryListeners = new Set<(message: unknown) => void>()
  const summaryVisibilityListeners = new Set<() => void>()
  const viewFocusCommands: { command: string; preserveFocus: boolean }[] = []
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
  const playbackPanelListeners = new Set<(message: unknown) => unknown>()
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
      languages: {
        registerCodeLensProvider(
          selector: unknown,
          provider: CodeLensProvider,
        ) {
          const registration = { selector, provider }
          codeLensProviders.push(registration)
          // The editor subscribes once, at registration, and refreshes the lenses of its open documents when the provider announces a change.
          const refreshSubscription = provider.onDidChangeCodeLenses?.(() => {
            codeLensRefreshes++
          })
          return {
            dispose(): void {
              refreshSubscription?.dispose()
              // A second dispose of the same registration removes nothing (`indexOf` is -1 for a registration that is gone).
              const index = codeLensProviders.indexOf(registration)
              if (index >= 0) codeLensProviders.splice(index, 1)
            },
          }
        },
        async setTextDocumentLanguage(
          document: { uri: Uri },
          languageId: string,
        ) {
          const model = virtualSourceDocuments.get(document.uri.toString())
          if (model) model.languageId = languageId
          return document
        },
      },
      EventEmitter,
      MarkdownString,
      CodeLens,
      Uri,
      TabInputText,
      TabInputTextDiff,
      TabInputWebview,
      TabInputChat,
      TabInputTerminal,
      TabInputTextMerge,
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
            // Cursor, whose Agent chat is the separate editor part, registers "Focus Agent"; VS Code, whose chat editor tab stands in a floating window, does not.
            ...(separateEditorPart && !separateEditorPart.floatingVsCodeChat
              ? [CURSOR_FOCUS_AGENT_COMMAND]
              : []),
          ].filter((name) => !absentHostCommands.has(name))
        },
        async executeCommand(
          name: string,
          layout?: unknown,
          contextValue?: unknown,
        ): Promise<unknown> {
          // Cursor's chat input takes the keyboard of an earlier Focus Agent now, before this command reaches the editor.
          if (commandsUntilAgentFocus > 0 && --commandsUntilAgentFocus === 0)
            focusChatInput()
          // Both native hosts reject a command they do not register, in these words.
          if (absentHostCommands.has(name))
            throw new Error(`command '${name}' not found`)
          if (name === 'vscode.moveViews') {
            moveViewsCalls.push(structuredClone(layout))
            return
          }
          // A context key changes no pane, focus or layout; it is kept apart from the recorded native commands.
          if (name === 'setContext') {
            contextKeys.set(String(layout), contextValue)
            return
          }
          // Visibility alone did not expose the native focus handoff that leaves a replay control behind.
          if (
            name === 'codebook.observedMoments.focus' ||
            name === 'codebook.learningSummary.focus'
          )
            viewFocusCommands.push({
              command: name,
              preserveFocus:
                typeof layout === 'object' &&
                layout !== null &&
                'preserveFocus' in layout &&
                layout.preserveFocus === true,
            })
          if (name === 'codebook.observedMoments.focus') {
            assert.ok(playbackPanelProvider)
            // Both editors open the moments' container in place of the terminal in front of the bottom panel and remove the terminal's element, even when the focus is kept (VS Code 1.140.0 workbench.desktop.main.js 1639:157156, 1106:186495, 1106:190002; Cursor 18332:33062, 17501:98812): its keyboard falls to the page body.
            if (!playbackPanel.visible && terminalInFrontOfPanel) {
              terminalInFrontOfPanel = false
              if (keyboardInView && !viewInSecondarySideBar) {
                keyboardInView = false
                keyboardOnBody = true
              }
            }
            playbackPanel.visible = true
            if (!playbackPanelResolved) {
              playbackPanelResolved = true
              await playbackPanelProvider.resolveWebviewView(playbackPanel)
            }
            for (const listener of playbackPanelVisibilityListeners) listener()
          }
          if (name === 'codebook.learningSummary.focus') {
            assert.ok(summaryProvider)
            // VS Code opens the summary's container in place of the chat in front of the secondary side bar and removes the chat's element, even when the focus is kept (1.140.0 workbench.desktop.main.js 1106:186495, 1106:190002): its keyboard falls to the page body. Cursor puts the summary in the primary side bar.
            if (
              !summary.visible &&
              keyboardInView &&
              viewInSecondarySideBar &&
              !hostAppName.toLowerCase().includes('cursor')
            ) {
              keyboardInView = false
              keyboardOnBody = true
            }
            summary.visible = true
            if (!summaryResolved) {
              summaryResolved = true
              await summaryProvider.resolveWebviewView(summary)
            }
            for (const listener of summaryVisibilityListeners) listener()
          }
          commands.push(name)
          // The historical session's frame comes to the front of its group, which becomes the active one, without the keyboard (row 721).
          if (name === NATIVE_DEBUG_FOCUS_SESSION_COMMAND)
            revealHistoricalStopSource()
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
          if (name === 'workbench.action.newGroupAbove') {
            insertNativeAppGroup()
            // The editor reports the new group active only after the command answered.
            if (activatesNewGroupLateAfterInsertion) {
              const inserted = activeTabGroup
              // The report comes after the preparation's focus return has left the new group, so a guard armed by then sees the keyboard move there.
              queueLateGroupActivation(
                () => currentGroupOf(inserted),
                () => activeTabGroup !== currentGroupOf(inserted),
                newGroupActivationDelayMs,
              )
            }
            return
          }
          if (name === 'workbench.action.lockEditorGroup') {
            // Once: the group that held the keyboard before the insertion is the active one again when the lock arrives, and the tab model names it as the lock answers.
            if (reactivatesPreviousGroupBeforeLock) {
              reactivatesPreviousGroupBeforeLock = false
              reactivatePreviousGroup()
            }
            setGroupLock(activeTabGroup, true)
            // The editor names the group that held the keyboard before the insertion again as the lock settles, while the new group is still empty.
            if (reactivatesPreviousGroupLater) reactivatePreviousGroup()
            activateGroupOfTabOnce()
            return
          }
          // The editor unlocks only the group it names as active.
          if (name === 'workbench.action.unlockEditorGroup') {
            setGroupLock(activeTabGroup, false)
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
          if (
            name === 'workbench.action.focusSideBar' ||
            name === 'workbench.action.focusAuxiliaryBar'
          )
            giveSideBarKeyboard(name === 'workbench.action.focusAuxiliaryBar')
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
          // Cursor's command focuses the active part's active group (3.23.12 17388:4895 `activeGroup.focus()`, the part named at 17501:88693): while its chat part is the active one, also after a click into the terminal or a view, that group's chat input takes the keyboard.
          if (
            name === 'workbench.action.focusActiveEditorGroup' &&
            separateEditorPart?.lastActive &&
            !separateEditorPart.floatingVsCodeChat
          )
            focusChatInput()
          const focusedColumn = focusGroupAtColumnCommands.indexOf(name) + 2
          // VS Code's commands count the groups of every editor part, so the column of a floating window's group focuses that group, raises its window and gives its chat input the keyboard (1.140.0 workbench.desktop.main.js 987:4284, 1106:181056, 1106:133818, 3129:7546).
          if (
            focusedColumn > 1 &&
            separateEditorPart?.floatingVsCodeChat &&
            separateEditorPart.group.viewColumn === focusedColumn
          )
            focusSeparatePartGroup()
          // The editor's commands for its second to eighth group give that group the keyboard focus and keep the tab it shows.
          else if (focusedColumn > 1) {
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
              leaveChatForMainEditor()
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
              // VS Code's numbered command counts every window's groups: a floating window's group raises that window (987:4284).
              if (floatingEditorWindow)
                floatingEditorWindow.active =
                  floatingEditorWindow.groups.includes(focusedGroup)
              // VS Code expands a minimized row it activates (row 691).
              if (modelsVsCodeStackedRowSizing)
                expandMinimizedRow(focusedColumn)
              innerFocusedPanel = undefined
              leaveChatForMainEditor()
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
            // Cursor answers Focus Agent before its chat input has the keyboard; see `focusAgentLater`.
            if (commandsBeforeAgentFocus > 0) {
              commandsUntilAgentFocus = commandsBeforeAgentFocus
              // Without further commands the chat input takes the keyboard a moment later all the same; the harness's close drops that change (OCR4-1).
              runEditorChangeLater(focusChatInputOwed, 0)
            } else focusChatInput()
          }
          if (
            name === 'workbench.action.focusFirstEditorGroup' &&
            ignoresFirstGroupFocusCommandBesideChatFlag &&
            separateEditorPart &&
            ((staleNamedGroup ?? activeTabGroup) === separateEditorPart.group ||
              separateEditorPart.lastActive)
          ) {
            // Cursor 3.27.22 measured in the Agent chat: the command resolved without any editor event.
          } else if (name === 'workbench.action.focusFirstEditorGroup') {
            // The first group is the main window's: focusing it makes that window the focused one.
            if (floatingEditorWindow) floatingEditorWindow.active = false
            const previousEditor = focusedSourceEditor(),
              previousGroup = activeTabGroup,
              primaryGroup = groups.find((group) => group.viewColumn === 1)!
            const primaryEditor = visibleSourceEditors.find(
              (editor) =>
                editor.group === primaryGroup &&
                primaryGroup.activeTab?.input instanceof TabInputText &&
                editor.document.uri.toString() ===
                  primaryGroup.activeTab.input.uri.toString(),
            )
            // Cursor's Agent chat group takes the keyboard back right after the focus command (Cycle 0060, N60): the first group's pane reports itself active for a moment while the editor goes on naming the chat's group, the next layout read is answered for the main editor, and the chat part is the active part again afterwards.
            if (
              chatRetakesKeyboardFromFirstGroup &&
              separateEditorPart &&
              (activeTabGroup === separateEditorPart.group ||
                separateEditorPart.lastActive)
            ) {
              const part = separateEditorPart
              const firstPane = [...panels].find(
                (candidate) => primaryGroup.activeTab === candidate.nativeTab,
              )
              part.lastActive = false
              part.focused = false
              heldActivePane = firstPane?.kind
              for (const panel of panels) panel.notifyViewState()
              chatRetakesKeyboardAfterLayoutRead = (): void => {
                heldActivePane = undefined
                // The chat input has the keyboard again; layout reads still answer for the main editor, as in the unreported-focus model.
                part.focused = true
                for (const panel of panels) panel.notifyViewState()
              }
            } else if (
              leavesPaneFocusUnreportedBesideChat &&
              separateEditorPart &&
              ((staleNamedGroup ?? activeTabGroup) ===
                separateEditorPart.group ||
                separateEditorPart.lastActive)
            ) {
              staleNamedGroup = staleNamedGroup ?? activeTabGroup
              activeTabGroup = primaryGroup
              leaveChatForMainEditor()
              if (primaryGroup.activeTab?.input instanceof TabInputText)
                activeTextEditorChanged(focusedSourceEditor())
            } else {
              // Native text and tab-group notifications have no cross-event ordering guarantee.
              if (primaryNotificationOrder === 'editor first') {
                partialFocusEditor = { value: primaryEditor }
                activeTextEditorChanged(primaryEditor)
              }
              if (primaryNotificationOrder === 'group first')
                partialFocusEditor = { value: previousEditor }
              activeTabGroup = primaryGroup
              if (deferPrimaryFocusEcho)
                pendingPrimaryFocusEcho = activeTabGroup
              leaveChatForMainEditor()
              if (primaryNotificationOrder !== 'together')
                changedGroups({
                  opened: [],
                  closed: [],
                  changed: [previousGroup, primaryGroup],
                })
              partialFocusEditor = undefined
              activeTextEditorChanged(primaryEditor)
            }
            // The command effect may precede its RPC response; newer learner input must not become the operation's baseline.
            const response = nextPrimaryFocusResponse
            nextPrimaryFocusResponse = undefined
            if (response) {
              response.entered()
              await response.wait
            }
          }
          if (name === 'workbench.action.toggleMaximizedPanel')
            returnHiddenEditorArea()
          if (name === 'vscode.getEditorLayout') {
            // Cursor reports a group's late activation while a layout read armed after the command is in flight.
            const dueGroupActivations = pendingLateGroupActivations.filter(
              (pending) => pending.atRead(),
            )
            if (dueGroupActivations.length) {
              await new Promise<void>((resolve) => setImmediate(resolve))
              for (const pending of dueGroupActivations) pending.report()
            }
            // Cursor reports the next tab active while a layout read that was armed after the disposal is in flight.
            const deliverNextTabActivation = pendingNextTabActivation
            if (deliverNextTabActivation) {
              await new Promise<void>((resolve) => setImmediate(resolve))
              deliverNextTabActivation()
            }
            if (reactivatesPreviousGroupAtLayoutRead) {
              layoutReadsUntilReactivation -= 1
              if (layoutReadsUntilReactivation <= 0) {
                reactivatesPreviousGroupAtLayoutRead = false
                reactivatePreviousGroup()
              }
            }
            if (asynchronousLayoutReads)
              await new Promise<void>((resolve) => setImmediate(resolve))
            if (hideGridWhileMaximized && maximizedEditorGroup) return undefined
            // The disposed panels' tabs close one task after this read is answered.
            const dueTabCloses = disposedTabClosesHeld
              ? []
              : pendingDisposedTabCloses.splice(0)
            if (
              dueTabCloses.length &&
              (closeDisposedPanelTabsDuringLayoutRead ||
                revealsPanelsLater ||
                movesPanelsLater)
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
            // VS Code reports the removal of the group a pane's move emptied while this read is pending (C58 round 1d: group events 7 ms after the read began, its answer 47 ms later; row 658).
            if (pendingMoveRemovals.length) {
              await new Promise<void>((resolve) => setImmediate(resolve))
              for (const remove of [...pendingMoveRemovals]) remove()
              await new Promise<void>((resolve) => setImmediate(resolve))
            }
            // The active separate part answers for itself, also while a view has the keyboard beside Cursor's chat part, and a hidden editor area reports its stacked groups collapsed.
            let reportedLayout = editorLayout
            if (floatingEditorWindow?.active)
              reportedLayout = floatingEditorWindow.layout
            else if (separateEditorPart?.lastActive)
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
            // The chat part takes the keyboard back once this read has been answered for the main editor.
            if (chatRetakesKeyboardAfterLayoutRead) {
              const retake = chatRetakesKeyboardAfterLayoutRead
              chatRetakesKeyboardAfterLayoutRead = undefined
              setImmediate(retake)
            }
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
            const previousMainGroupCount = nativeGroupCount(editorLayout)
            explicitEditorLayout = true
            maximizedEditorGroup = false
            // The public layout command changes the active part even while TabGroups still reports the old main active group.
            if (separateEditorPart?.lastActive) {
              separateEditorPart.layout = structuredClone(layout)
              return
            }
            // Both editors take the sizes as they are given: proportions over a grid of columns end as single pixels.
            if (proportionsAnsweredInPx)
              layout = proportionsAsPixels(layout, proportionsAnsweredInPx)
            // A layout given to the main grid brings a hidden editor area back; the given layout replaces the sizes of that return.
            returnHiddenEditorArea()
            const constrained =
              nativeGroupCount(layout) === constrainedStudyGridGroups
            settledLayout = !constrained
              ? structuredClone(layout)
              : constrainedStudyGridGroups === 3
                ? {
                    orientation: 0,
                    groups: [
                      { size: 220, groups: [{ size: 70 }, { size: 70 }] },
                      { size: 220 },
                    ],
                  }
                : // The summary composition's two groups, the Application above the recorded source, settle at sizes the editor chose.
                  { orientation: 1, groups: [{ size: 100 }, { size: 40 }] }
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
            // Native applyLayout preserves group identities when only their geometry changes, including every other editor part.
            if (
              nativeLayout &&
              nativeGroupCount(layout) !== previousMainGroupCount
            ) {
              const count = nativeGroupCount(layout),
                activeColumnBeforeMerge = activeTabGroup.viewColumn
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
                        : replacedBy(group, {
                            ...group,
                            tabs: [...group.tabs],
                          }),
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
                // A native contraction carries each editor with its actual tab, preserving other copies and selections.
                for (const editor of new Set([
                  ...visibleSourceEditors,
                  lastSourceEditor,
                ]))
                  if (
                    editor &&
                    (editor.group?.viewColumn ?? editor.viewColumn) ===
                      group.viewColumn &&
                    group.tabs.some(
                      (tab) =>
                        tab.input instanceof TabInputText &&
                        tab.input.uri.toString() ===
                          editor.document.uri.toString(),
                    )
                  )
                    editor.group = destination
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
                        : replacedBy(group, {
                            ...group,
                            tabs: [...group.tabs],
                          }),
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
              // Cursor can replace wrappers again after the merge; native input and visible editors follow those surviving groups.
              activeTabGroup =
                groups.find(
                  (group) =>
                    group.viewColumn ===
                    (removed.some(
                      (previous) =>
                        previous.viewColumn === activeColumnBeforeMerge,
                    )
                      ? count
                      : activeColumnBeforeMerge),
                ) ?? activeTabGroup
              for (const editor of new Set([
                ...visibleSourceEditors,
                lastSourceEditor,
              ])) {
                if (!editor) continue
                const surviving = groups.find(
                  (group) =>
                    group.viewColumn ===
                      (editor.group?.viewColumn ?? editor.viewColumn) &&
                    group.tabs.some(
                      (tab) =>
                        tab.input instanceof TabInputText &&
                        tab.input.uri.toString() ===
                          editor.document.uri.toString(),
                    ),
                )
                if (surviving) editor.group = surviving
              }
              if (removed.length)
                changedGroups({
                  opened: [],
                  closed: removed,
                  changed: cursorGroupWrappers ? [...groups] : [destination],
                })
            } else if (!nativeLayout) {
              const opened: typeof groups = []
              // Legacy fixtures still honor the requested leaf count; restoring two groups must not invent a phantom Context group three.
              for (let column = 1; column <= nativeGroupCount(layout); column++)
                if (!groups.some((group) => group.viewColumn === column)) {
                  const group = { viewColumn: column, tabs: [] }
                  groups.push(group)
                  opened.push(group)
                }
              if (opened.length)
                changedGroups({ opened, closed: [], changed: [] })
            }
            focusActiveGroupAfterLayout()
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
        state: windowStateForExtension,
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
        // An error notification stays until the learner dismisses it or answers one of its buttons ({@link answerErrorDialogs}).
        showErrorMessage: async (
          message: string,
          ...items: string[]
        ): Promise<string | undefined> => {
          errorMessages.push(message)
          return answerErrorDialog(items)
        },
        createTextEditorDecorationType: (options: { after?: unknown }) => ({
          ...disposable(),
          ...(options.after ? { sourceIdentity: true } : {}),
        }),
        createTreeView: (
          _id: string,
          options: { treeDataProvider: { getTreeItem: typeof outlineItem } },
        ) => {
          outlineItem = options.treeDataProvider.getTreeItem
          return outline
        },
        // The Repository Wiki's catalog view (`createRepositoryWikiReader`); no test reads it.
        registerTreeDataProvider: () => disposable(),
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
        onDidChangeVisibleTextEditors: (callback: () => void) => {
          visibleEditorListeners.add(callback)
          return {
            dispose(): void {
              visibleEditorListeners.delete(callback)
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
              (editor.group.activeTab?.input instanceof TabInputText &&
                editor.group.activeTab.input.uri.toString() ===
                  editor.document.uri.toString()) ||
              // Both sides of a diff in front of its group are visible text editors (row 709).
              showsAsDiffSide(editor.group, editor.document.uri),
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
          // In the model of `holdNextTextDocumentShow`, the editor shows the document only once the test releases it.
          const heldShow =
            heldTextDocumentShow &&
            (!heldTextDocumentShow.uri ||
              heldTextDocumentShow.uri === sourceDocument.uri.toString())
              ? heldTextDocumentShow
              : undefined
          if (heldShow) {
            heldTextDocumentShow = undefined
            heldShow.entered()
            await heldShow.wait
          }
          // In the model of `redirectNextTextDocumentShow`, the editor shows the document in another column than asked.
          if (
            redirectedTextDocumentShow?.uri === sourceDocument.uri.toString()
          ) {
            options = {
              ...options,
              viewColumn: redirectedTextDocumentShow.viewColumn,
            }
            redirectedTextDocumentShow = undefined
          }
          textDocumentShows.push({
            name: basename(sourceDocument.uri.path),
            viewColumn: options?.viewColumn,
            preserveFocus: Boolean(options?.preserveFocus),
          })
          sourceColumn =
            options?.viewColumn === undefined
              ? sourceColumn
              : nativeReaderColumn(options.viewColumn)
          // A native full-model replacement leaves the old empty wrapper empty until the new source-tab event arrives.
          if (
            replacesGroupObjectsOnTabChanges &&
            groups.some(
              (group) =>
                group.viewColumn === sourceColumn && !group.tabs.length,
            )
          )
            replaceGroupObjects([], undefined, false)
          // A column beyond the last main group gets a new group of its own, as both editors give one: `showTextDocument` resolves such a `viewColumn` through VS Code's `columnToEditorGroup`, which adds the missing group, as for a webview panel.
          const group =
              groups.find(
                (candidate) => candidate.viewColumn === sourceColumn,
              ) ?? nativeGroup(sourceColumn),
            tab = group.tabs.find(
              (tab) =>
                tab.input instanceof TabInputText &&
                tab.input.uri.toString() === sourceDocument.uri.toString(),
            ) ?? {
              input: new TabInputText(sourceDocument.uri),
              label: textTabLabel(sourceDocument.uri),
            }
          const opensTab = !group.tabs.includes(tab)
          if (opensTab) insertAfterShownTab(group, tab)
          revealIntoHiddenEditorArea(
            group.viewColumn,
            group.activeTab !== tab || !options?.preserveFocus,
          )
          const showsAnotherTab = group.activeTab !== tab
          // A quiet replacement hides the focused native text input without focusing its replacement (C48 original273).
          if (
            options?.preserveFocus &&
            windowState.focused &&
            group === activeTabGroup &&
            group.activeTab?.input instanceof TabInputText &&
            group.activeTab.input.uri.toString() !==
              sourceDocument.uri.toString() &&
            !keyboardInView &&
            !keyboardInSideBar &&
            !separateEditorPart?.focused &&
            focusedSourceEditor()
          )
            keyboardOnBody = true
          group.activeTab = tab
          if (!options?.preserveFocus) {
            // Cursor beside the chat: a text editor that takes the keyboard is reported as the active text editor, while the chat's group stays the named one until a group event (as after the command that focuses the first editor group).
            if (
              leavesPaneFocusUnreportedBesideChat &&
              separateEditorPart &&
              !showsAnotherTab &&
              ((staleNamedGroup ?? activeTabGroup) ===
                separateEditorPart.group ||
                separateEditorPart.lastActive)
            )
              staleNamedGroup = staleNamedGroup ?? activeTabGroup
            activeTabGroup = group
            innerFocusedPanel = undefined
            leaveChatForMainEditor()
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
          // An explicit native selection reveals its statement even when playback reopens the same document. The editor selects the given range from its start to its end, so the caret stands at its end (VS Code 1.140.0 `workbench.desktop.main.js` 981:134134, Cursor 3.23.12 11678:42235 `setSelection({startLineNumber,…,endColumn})`); the Study's own ranges are carets, a Repository Wiki citation's are its cited lines.
          if (options?.selection) {
            editor.selections = [
              {
                active: options.selection.end,
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
          // A tab that opened or became the one its group shows changed the tabs; the same tab shown again did not. Beside Cursor's chat part a tab that opened leaves the chat's group named (row 674); an open tab brought to the front with the keyboard names its group, as the Application's preparation borrows it to (focusApplicationSourceGroup).
          if (showsAnotherTab)
            replaceGroupObjects(
              [],
              undefined,
              true,
              leavesPaneFocusUnreportedBesideChat && opensTab,
            )
          if (!options?.preserveFocus || comesToFrontOfActiveGroup)
            activeTextEditorChanged(focusedSourceEditor())
          // A tab that opened or came to the front of its group changes the visible text editors, with or without the keyboard.
          if (opensTab || showsAnotherTab) changedVisibleEditors()
          const displayed = nextSourceDisplay
          nextSourceDisplay = undefined
          displayed?.(editor)
          lastSourceEditor = editor
          // The editor answers with the text editor it then reports as the active one, one object for one editor (a Repository Wiki citation compares the two, row 674); the stale-column control keeps its separate wrapper.
          return reportedSourceColumn === undefined ? visible : editor
        },
        tabGroups: {
          all: groups,
          get activeTabGroup() {
            return staleNamedGroup ?? activeTabGroup
          },
          onDidChangeTabs: (callback: (event: TabChanges) => void) => {
            // A tab notification leaves a stale group name in place: only a group event corrects it (`changedGroups`, row 673).
            const notify = (
              event: TabChanges = { opened: [], closed: [], changed: [] },
            ): void => {
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
          close: async (
            tabs: Tab[] | (typeof groups)[number],
            preserveFocus?: boolean,
          ) => {
            // The public group overload closes its tabs too; production must establish ownership before calling it.
            if (!Array.isArray(tabs)) {
              layoutsAtGroupCloses.push(structuredClone(editorLayout))
              // In the model of `holdNextGroupClose`, the editor answers this request only once the test releases it; the learner can act meanwhile.
              const heldAnswer = heldGroupClose
              heldGroupClose = undefined
              if (heldAnswer) {
                heldAnswer.entered()
                await heldAnswer.wait
              }
              // In the model of `refuseNextGroupClose`, the editor answers `false` once and the group stays as it was.
              if (refusesNextGroupClose) {
                refusesNextGroupClose = false
                return false
              }
              const column = tabs.viewColumn,
                count = groups.length,
                closingTabs = [...tabs.tabs]
              if (closingTabs.length && !closeTabs(closingTabs, preserveFocus))
                return false
              // The group's webview tabs dispose their panels as a tab close does (CR5-5).
              disposePanelsOfClosedTabs(closingTabs)
              const remaining = groups.find(
                (group) => group.viewColumn === column,
              )
              if (groups.length === count && remaining)
                removeEmptiedGroup(remaining, preserveFocus)
              // An accepted group close has the same delayed response boundary as an accepted tab close.
              const held = heldTabCloseResponse
              heldTabCloseResponse = undefined
              if (held) {
                held.entered()
                await held.wait
              }
              return true
            }
            tabCloseRequests.push([...tabs])
            tabCloseFocusRequests.push(Boolean(preserveFocus))
            if (rejectNextTabClose) {
              rejectNextTabClose = false
              throw new Error('Canceled')
            }
            // In the model of `holdNextTabCloseEffect`, the editor acts on the request only once the test releases it.
            const heldEffect = heldTabCloseEffect
            heldTabCloseEffect = undefined
            if (heldEffect) {
              heldEffect.entered()
              await heldEffect.wait
            }
            // Closing the tab that has the keyboard while preserving the focus focuses nothing in its place.
            const closesFocusedTab =
              Boolean(preserveFocus) &&
              !separateEditorPart?.focused &&
              activeTabGroup.activeTab !== undefined &&
              tabs.includes(activeTabGroup.activeTab)
            const closed = closeTabs(tabs, preserveFocus)
            if (closesFocusedTab && closed) keyboardOnBody = true
            // A native webview-tab close disposes its panel before the extension's close continuation runs.
            disposePanelsOfClosedTabs(tabs)
            // Hold the response after real native effects so a later dispatch must use the learner's newer group/tab model.
            const held = heldTabCloseResponse
            heldTabCloseResponse = undefined
            if (held) {
              held.entered()
              await held.wait
            }
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
          inspect: (key: string) => inspectedValues(`${section}.${key}`),
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
          scheme: string,
          provider: {
            provideTextDocumentContent(uri: Uri): Promise<string>
            onDidChange?: (listener: (value: unknown) => void) => {
              dispose(): void
            }
          },
        ) => {
          contentProviders.set(scheme, provider.provideTextDocumentContent)
          lastContentProvider = provider.provideTextDocumentContent
          const subscription = provider.onDidChange?.((value) => {
            if (!(value instanceof Uri)) return
            const model = virtualSourceDocuments.get(value.toString())
            if (!model) return
            const held = nextSourceUpdate
            nextSourceUpdate = undefined
            void provider
              .provideTextDocumentContent(value)
              .then(async (text) => {
                // Renderer delivery follows the provider result; tests can hold that real boundary without a reader seam.
                held?.entered()
                await held?.wait
                model.text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
                sourceDocumentChanges.push(value.toString())
                for (const listener of textDocumentChangeListeners)
                  listener({
                    document: { uri: value, getText: () => model.text },
                  })
              })
          })
          return subscription ?? disposable()
        },
        openTextDocument: openSourceDocument,
        onDidChangeTextDocument: (
          listener: (event: {
            document: Pick<SourceEditor['document'], 'uri' | 'getText'>
          }) => void,
        ) => {
          textDocumentChangeListeners.add(listener)
          return {
            dispose(): void {
              textDocumentChangeListeners.delete(listener)
            },
          }
        },
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
    // The Wiki's panel is active as a pane's is: its tab in front of the group the editor has active, while the chat part does not hold the keyboard and the editor names no stale group (the `active` of `panel`).
    repositoryWikiActive: (): boolean => {
      const front = activeTabGroup.activeTab?.input
      return (
        !separateEditorPart?.lastActive &&
        !staleNamedGroup &&
        front instanceof TabInputWebview &&
        front.viewType.endsWith('codebook.repositoryWiki')
      )
    },
  }
  /**
   * Gives a value the way the editor's `Memento` keeps it: as JSON, so a Date becomes its text, a Map becomes an empty object and a function disappears, where `structuredClone` would keep them.
   * @param value - A value an extension stored with `update`.
   * @returns The value after a round trip through JSON; `undefined` for a value JSON cannot hold.
   * @example toMementoValue(new Date(0)) // => '1970-01-01T00:00:00.000Z'
   */
  const toMementoValue = (value: unknown): unknown => {
    const text = JSON.stringify(value)
    return text === undefined ? undefined : JSON.parse(text)
  }
  const presentationPreferences = new Map<string, unknown>()
  /** The workspace state's Application group record (finding 590), kept apart from the presentation preferences: a test that asserts no preference was saved counts only those, and the injected preference holds and failures do not reach this record. */
  const applicationGroupMarkers = new Map<string, unknown>()
  let preferenceFailure = false
  let nextPreference: { wait: Promise<void>; entered(): void } | undefined
  const workspaceState = {
    get: <Value>(key: string, defaultValue?: Value) => {
      const stored =
        key === APPLICATION_GROUP_MARKER_KEY
          ? applicationGroupMarkers.get(key)
          : presentationPreferences.get(key)
      // The Memento answers the default only for a key whose value is `undefined`; a stored `null` is a value.
      return (stored === undefined ? defaultValue : stored) as Value | undefined
    },
    update: async (key: string, value: unknown): Promise<void> => {
      if (key === APPLICATION_GROUP_MARKER_KEY) {
        applicationGroupMarkers.set(key, toMementoValue(value))
        return
      }
      const held = nextPreference
      nextPreference = undefined
      held?.entered()
      await held?.wait
      if (preferenceFailure) throw new Error('Injected preference failure')
      presentationPreferences.set(key, toMementoValue(value))
    },
  }
  /** The profile-wide state of the fake extension context (`globalState`), and the `vscode.moveViews` arguments the reader sent; see `profileState` and `moveViewsCalls`. */
  const profileState = new Map<string, unknown>()
  const moveViewsCalls: unknown[] = []
  const globalState = {
    get: <Value>(key: string, defaultValue?: Value) =>
      (profileState.has(key) ? profileState.get(key) : defaultValue) as
        Value | undefined,
    update: async (key: string, value: unknown): Promise<void> => {
      if (value === undefined) profileState.delete(key)
      else profileState.set(key, toMementoValue(value))
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
        globalState,
      },
      controls,
      handedOverArchives,
      slotTimers,
    )
  const reader = createReader()
  if (attach) {
    await reader.attach(harness.service)
    await reader.action('return-current')
  }
  /** The Repository Wiki readers {@link createRepositoryWikiReader} made; the harness's `close` disposes them before its panes. */
  const repositoryWikiReaders: InstanceType<
    typeof repositoryBoundary.RepositoryReader
  >[] = []
  /**
   * Makes a real Repository Wiki reader over this fake editor, wired to the harness's Study workspace as the extension wires it (`extension.ts`: the workspace's learning storage, its `arrangeRepository`, its `openRepositoryEvidence`, its `knowsLearnerTypesInActiveEditor` and its `studyPaneKeyboardColumn`), so the reader's own focus receipts and the workspace's layout meet the fake editor's models, Cursor's chat part among them (Cycle 0046 rows 674, 694 and 705).
   * @returns The reader; a book published into the workspace's learning storage is what its `open` shows.
   * @example const wiki = harness.createRepositoryWikiReader(); await wiki.open(selection)
   */
  const createRepositoryWikiReader = () => {
    const wiki = new repositoryBoundary.RepositoryReader({
      storage: () => reader.learningStorage(),
      connect: async (): Promise<void> => {},
      arrange: (signal, returnSelection, focus) =>
        reader.arrangeRepository(signal, returnSelection, focus),
      evidence: (binding, recording, signal, origin) =>
        reader.openRepositoryEvidence(binding, recording, signal, origin),
      knowsLearnerTypesInActiveEditor: () =>
        reader.knowsLearnerTypesInActiveEditor(),
      studyPaneKeyboardColumn: () => reader.studyPaneKeyboardColumn(),
    })
    repositoryWikiReaders.push(wiki)
    return wiki
  }
  /** Says whether the reader last published a replay's summary composition, in which the Study pane is closed and the Learning summary view shows the study's content (Cycle 0051, DS-A). @example isSummaryCompositionShown() // => true while a test replay is selected */
  const isSummaryCompositionShown = (): boolean =>
    Boolean(postedMessages.at(-1)?.replayFamily)
  return {
    ...harness,
    createRepositoryWikiReader,
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
    /** Sends a bottom panel message as {@link receivePlaybackPanel} does and resolves once the reader's handling of it ended, settled either way, so a test awaits that end instead of a fixed time. @example await harness.receivePlaybackPanelHandled(message) */
    async receivePlaybackPanelHandled(message: unknown): Promise<void> {
      await Promise.allSettled(
        [...playbackPanelListeners].map((listener) => listener(message)),
      )
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
    /** Decides how the learner answers the buttons of the reader's next native error notifications; unanswered ones are dismissed. @example harness.answerErrorDialogs(async ([button]) => button) */
    answerErrorDialogs(
      answer: (items: string[]) => Promise<string | undefined>,
    ): void {
      answerErrorDialog = answer
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
    viewFocusCommands,
    articleOpens,
    articleReturns,
    /** Delivers a message as the pane that shows the study's content posts it: the Study pane, or the Learning summary view while a replay holds the summary composition and the Study pane is closed (Cycle 0051, DS-A). @example harness.receiveContext({ type: 'node-history-step', studyId, direction: 'next', unit: 'stop' }) */
    receiveContext: (message: unknown): void => {
      if (isSummaryCompositionShown()) {
        for (const listener of summaryListeners) listener(message)
      } else receivers.get('codebook.studyContext')!(message)
    },
    /** Delivers a message to the host as the Application pane's webview posts it (its test replay document's reports). @example harness.receiveApplication({ type: 'node-history-output-ready', history, generation: 1, follow: true }) */
    receiveApplication: (message: unknown): void =>
      receivers.get('codebook.scopedBrowser')!(message),
    receive: (message: unknown): void => {
      if (
        reader.inspect().view?.contentTab === 'recording' ||
        isSummaryCompositionShown()
      ) {
        for (const listener of summaryListeners) listener(message)
      } else receivers.get('codebook.studyContext')!(message)
    },
    counts: () => ({ panels: panels.size, outlineUpdates }),
    peakPanels: () => peakPanels,
    /** Lists the tabs of every close request the reader sent to the editor, accepted or refused, so a test can assert which tabs it asked to close. @example harness.tabCloseRequests().flat().includes(deadApplication) */
    tabCloseRequests: () => tabCloseRequests.map((tabs) => [...tabs]),
    /**
     * Lists the main editor's layout as the fake editor held it, in the proportions or pixels it was last given, when each `tabGroups.close` request for a whole group arrived, so a test can read the grid a Close gave back before it retired the groups Codebook created (finding 597).
     * @example harness.layoutsAtGroupCloses()[0] // => { orientation: 0, groups: [{ size: 617, groups: [{ size: 0.5 }, { size: 0.5 }] }, { size: 504 }] }
     */
    layoutsAtGroupCloses: () => structuredClone(layoutsAtGroupCloses),
    /** Records each native close's focus flag so inactive-window and nonempty-group guards are observable. @example harness.tabCloseFocusRequests() // => [true, false] */
    tabCloseFocusRequests: () => [...tabCloseFocusRequests],
    /**
     * Holds a native tab-close answer after its effects, for lifecycle tests that change ownership or window focus before the next group closes.
     * @returns The entered receipt and the release callback for that one response.
     * @example const held = harness.holdNextTabCloseResponse(); await held.started; held.release()
     */
    holdNextTabCloseResponse() {
      let entered!: () => void, release!: () => void
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      heldTabCloseResponse = { entered, wait }
      return { started, release }
    },
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
    /** Lists the views a test replay document received in place, oldest first, each with the kind of the panel that received it (`panel`), so a test reads the recorded output the learner sees at the selected moment and which pane it reached. @example harness.applicationOutputs().at(-1)?.view.lines */
    applicationOutputs: () => [...applicationOutputs],
    /** Lists the reader's replies to open requests in the order the webviews received them, so a test can assert which pane was answered and when. @example harness.openRequestReplies() // => [{ webview: 'context', openRequest: 3 }] */
    openRequestReplies: () => openRequestReplies.map((reply) => ({ ...reply })),
    /** Gives the last Study message the bottom panel had received when its open request with this number was answered, so a test can assert that the message naming the entry arrived before the reply. @example harness.playbackPanelMessageAtReply(1)?.model.selection.studyId */
    playbackPanelMessageAtReply: (
      openRequest: number,
    ): StudyViewMessage | undefined =>
      playbackPanelMessagesAtReply.get(openRequest),
    presentationPreferences,
    applicationGroupMarkers,
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
    /**
     * Gives a webview tab the keyboard the way VS Code 1.140.0 reported it for the Repository Wiki in C58 (`c58-vs-567d`, the extension-host observer's baseline before the Wiki's "View recording"): the webview's group is the active tab group and its tab the active tab, while the active text editor stays the text editor that had the keyboard before, in another group. The cause below is no property of the Wiki: any editor that is no code editor (another extension's webview too) leaves that report (Cycle 0046 row 671). VS Code updates its active text editor when the active group changes and counts a code editor that still has the text focus then as the active one (`workbench.desktop.main.js` 705:2664 `a.hasTextFocus()`, in `_updateState`, which `onDidActiveEditorChange` runs), before the webview's own focus reaches its frame, and afterwards only a text or widget focus of a code editor updates it again (705:1683 `onDidFocusEditorText`, `onDidFocusEditorWidget`; no blur is listened to), so the report stays until the active group changes again (Cycle 0046 row 659).
     * Beside Cursor's chat part the click makes the main editor the active part again, and Cursor's rebuild of its tab model names the clicked tab's group; the report follows the group's new object (row 729).
     * @param tab - The webview's tab (the Repository Wiki's, a Codebook pane's, or another extension's from `addForeignWebviewTab`), in a group of the main editor.
     * @param paneDocumentTakesKeyboard - Whether the pane's own document takes the keyboard with its frame's focus, as at a pane's reveal with the focus (`focusActiveGroupAfterLayout`), for a Codebook pane whose page then reports it (row 729); left out, no document has it, as row 659's tests of the Wiki read it.
     * @example harness.focusWebviewTabKeepingTextEditorReport(wikiTab) // activeTabGroup is the Wiki's, activeTextEditor still the cited source copy of the first group
     */
    focusWebviewTabKeepingTextEditorReport(
      tab: Tab,
      paneDocumentTakesKeyboard = false,
    ): void {
      const group = groups.find((candidate) => candidate.tabs.includes(tab))
      assert.ok(group)
      const editor = focusedSourceEditor()
      assert.ok(editor, 'No text editor has the keyboard before the Wiki')
      const pane = [...panels].find((candidate) => candidate.nativeTab === tab)
      assert.ok(
        !paneDocumentTakesKeyboard || pane,
        'Only a pane of this editor has a document that takes the keyboard',
      )
      const previousGroup = activeTabGroup
      group.activeTab = tab
      activeTabGroup = group
      // A click on a tab of the main window makes that window the focused one again after VS Code's floating window had it (Cycle 0046 row 726).
      if (floatingEditorWindow)
        floatingEditorWindow.active =
          floatingEditorWindow.groups.includes(group)
      leaveChatForMainEditor()
      keyboardOnBody = false
      keyboardInView = false
      innerFocusedPanel = paneDocumentTakesKeyboard ? pane?.kind : undefined
      textEditorReportedBehindWebview = { group, tab, editor }
      if (replacesGroupObjectsOnTabChanges) replaceGroupObjects()
      else
        changedGroups({
          opened: [],
          closed: [],
          changed: [previousGroup, group],
        })
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
    /** How many times the extension read the window's focus while it had none ({@link changeWindowFocus}); see `windowStateForExtension`. @example harness.unfocusedWindowReads() // => 3 while the reader waits for the focus */
    unfocusedWindowReads: (): number => unfocusedWindowReads,
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
    /**
     * Makes the editor's "Navigate Up/Down Call Stack" (`selectStackFrame(…, 'navigation-command')`) keep naming the group it named before as the active tab group, while the frame's file in its own group has the keyboard and is the active text editor; a group event clears the stale name. Cursor 3.23.12 for Linux was seen to do this on C51 with the owned Application group in front: the frame's file opened in column 2 with the keyboard in its TEXTAREA, and `tabGroups.activeTabGroup` stayed the Application group in column 1 (Cycle 0046, original 273 H3).
     * @example harness.keepNamingGroupAfterFrameNavigation()
     */
    keepNamingGroupAfterFrameNavigation(): void {
      keepsNamingGroupAfterFrameNavigation = true
    },
    focusExistingWebviewTab(tab: Tab): void {
      const group = groups.find((group) => group.tabs.includes(tab))
      assert.ok(group)
      assert.ok(tab.input instanceof TabInputWebview)
      group.activeTab = tab
      activeTabGroup = group
      for (const listener of tabChangeListeners) listener()
    },
    /** Gives every tab of the fake tab model a new Tab object now, as Cursor's extension host does when the editor sends a whole new tab model (the model of `rebuildTabObjectsAtGroupRemoval`, without a group removal); the tab listeners hear nothing, as at a removed group's rebuild. @example harness.rebuildTabObjectsNow() */
    rebuildTabObjectsNow(): void {
      rebuildTabObjects()
    },
    /** Closes one tab the way the learner does with the tab's close button: the tab leaves its group, the group shows its neighbour, a pane whose tab it is ends, and the editor tells its tab listeners which tab closed. The reader's own closes go through `tabGroups.close`, and a pane the reader disposes closes its tab without an event in this fake. @example harness.closeTabByHand(sourceTab) */
    closeTabByHand(tab: Tab): void {
      const group = groups.find((candidate) => candidate.tabs.includes(tab))
      assert.ok(group)
      const wasShown = group.activeTab === tab,
        pane = [...panels].find((candidate) => candidate.nativeTab === tab)
      if (pane) pane.dispose()
      else closeTabs([tab])
      // The group shows the tab beside the closed one, or none.
      if (wasShown && group.activeTab === tab)
        group.activeTab = group.tabs.at(-1)
      for (const listener of tabChangeListeners)
        listener({ opened: [], closed: [tab], changed: [] })
    },
    /** Tells the reader's tab listeners that tabs changed although none did, as the editor does when it refreshes its tab model. @example harness.announceTabChange() */
    announceTabChange(): void {
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
    /** Counts the disposal listeners every open pane holds, so a test sees a listener a reused pane gains per run. @example harness.disposeListenerCount() // => 3 */
    disposeListenerCount: () =>
      [...panels].reduce(
        (count, panel) => count + panel.disposeListenerCount(),
        0,
      ),
    focusListenerCount: () =>
      activeEditorListeners.size +
      selectionListeners.size +
      tabChangeListeners.size +
      groupChangeListeners.size +
      [...panels].reduce(
        (count, panel) => count + panel.viewListenerCount(),
        0,
      ),
    // The reader's own receipt, run on a reader without a Wiki pane: these Study cases drive Wiki layout work without a Repository Wiki reader.
    retainRepositoryFocus: repositoryBoundary.RepositoryReader.prototype[
      'retainNativeFocus'
    ].bind(Object.create(repositoryBoundary.RepositoryReader.prototype)),
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
      const group = groups.find(
        (candidate) =>
          candidate.viewColumn === editor.viewColumn &&
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
      // Native source input selects this particular copy and leaves any previously focused view/chat.
      lastSourceEditor = editor
      keyboardInView = false
      keyboardOnBody = false
      leaveChatForMainEditor()
      innerFocusedPanel = undefined
      activeTextEditorChanged(editor)
      changedGroups({ opened: [], closed: [], changed: [group] })
    },
    /** The arguments of every `vscode.moveViews` the reader ran. @example harness.moveViewsCalls() // => [{ viewIds: ['codebook.learningSummary'], destinationId: 'workbench.panel.chat' }] */
    moveViewsCalls: () => [...moveViewsCalls],
    /** What the listeners of `onDidChangeVisibleTextEditors` threw; the fake isolates a throwing listener as the extension host does and keeps its error here. @example assert.deepEqual(harness.visibleEditorListenerErrors, []) */
    visibleEditorListenerErrors,
    /** The fake `workspaceState` of the extension context, as the reader gets it: values are kept as JSON and only a missing or `undefined` value answers the default. @example harness.workspaceState.get('key', false) */
    workspaceState,
    /** The fake `globalState` of the extension context, as the reader gets it: values are kept as JSON and a missing key answers the default. @example harness.globalState.get('key', false) */
    globalState,
    /** The fake profile-wide state (`globalState`) of the extension context. @example harness.profileState.get('codebook.summaryBesideChatMoved.v1') */
    profileState,
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
    /** Reports native source-identity annotations separately from execution highlights for source/time/gap regressions. @example harness.sourceIdentityDecorations().at(-1)?.ranges */
    sourceIdentityDecorations: () => [...sourceIdentityCalls],
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
      const movedEditor = visibleSourceEditors.find(
        (candidate) =>
          candidate.group === previous &&
          candidate.document.uri.toString() === editor.document.uri.toString(),
      )
      assert.ok(
        movedEditor,
        'A moved source must retain its registered native editor',
      )
      // Native getters and the emitted event must describe the same moved document and selections.
      movedEditor.group = destination
      editor.group = destination
      lastSourceEditor = movedEditor
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
    /**
     * Makes the fake editor remove the group a pane's move left empty after the move, which is reported at once, instead of with the move: while the next layout read is pending, or by itself {@link MOVED_PANE_GROUP_REMOVAL_DELAY_MS} after the move when no read comes, as VS Code 1.140.0 did with the earlier window's leftover after the Application's move into its own group in C58 round 1d (the group events at +571 ms of the Return, during the layout read issued at +564 and answered at +611; Cycle 0046 row 658). Only in the model of `closeEmptyGroupsAfterPanelMove`.
     * @example
     * harness.closeEmptyGroupsAfterPanelMove()
     * harness.removeGroupLeftByPanelMoveLater()
     */
    removeGroupLeftByPanelMoveLater(): void {
      removesGroupLeftByMoveLater = true
    },
    /**
     * Makes the fake editor report a pane's move to another group as Cursor 3.27.22 did for the Application in N64p2-F1: the tab opens in the new group (every group an object anew) and closes in the old group in a later report (every group an object anew again, the old group now empty); with {@link removeGroupLeftByPanelMoveLater} the old group is removed after both.
     * @example
     * harness.closeEmptyGroupsAfterPanelMove()
     * harness.removeGroupLeftByPanelMoveLater()
     * harness.reportsPaneMoveAsOpenThenClose()
     */
    reportsPaneMoveAsOpenThenClose(): void {
      reportsPaneMoveAsOpenThenCloseFlag = true
      replacesGroupObjectsOnTabChanges = true
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
     * Makes the fake editor, when a pane that is the front tab of a group shared with other tabs is disposed, first make the group's next tab the active one through a tab notification only (no group event, the disposed tab still listed), and close the disposed tab {@link DISPOSED_TAB_CLOSE_DELAY_MS} later, as Cursor's group model does (`doCloseEditor` selects the next tab, then removes the closed one; Cycle 0056, N55-F4 refusal 2).
     * @example harness.activateNextTabBeforeDisposedPaneTabCloses()
     */
    activateNextTabBeforeDisposedPaneTabCloses(): void {
      activatesNextTabBeforeDisposedPaneTabCloses = true
    },
    /**
     * Makes the fake editor report the Application's group active a moment after every reveal of the Application that keeps the keyboard, as Cursor reports `app?.reveal(undefined, true)` late (N55-F4 hypothesis H2-a).
     * @example harness.activateApplicationGroupLateAfterReveal()
     */
    activateApplicationGroupLateAfterReveal(): void {
      activatesApplicationGroupLateAfterReveal = true
    },
    /**
     * Counts the late group activations the fake editor reported to a group of its live model; a report whose group is no longer in the model is dropped and not counted.
     * @returns How many late activations reached a live group so far.
     * @example harness.lateGroupActivationsReported() // => 1 after activateNewGroupLateAfterInsertion and one Application group insertion
     */
    lateGroupActivationsReported: () => reportedLateGroupActivations,
    /**
     * Counts the late group reports the fake editor has queued and not yet made, reported or dropped.
     * @returns How many late reports still wait.
     * @example harness.lateGroupReportsWaiting() // => 0 once the editor's late report has run
     */
    lateGroupReportsWaiting: () => pendingLateGroupActivations.length,
    /**
     * Makes the fake editor report the group `workbench.action.newGroupAbove` made active only after the command answered, as Cursor activates a new group late (N55-F4 hypothesis H2-b, row 650).
     * @param delayMs - How long after the command the report comes; omitted for the editor's usual short delay.
     * @example harness.activateNewGroupLateAfterInsertion()
     * @example harness.activateNewGroupLateAfterInsertion(600) // later than the preparation's wait
     */
    activateNewGroupLateAfterInsertion(delayMs?: number): void {
      activatesNewGroupLateAfterInsertion = true
      newGroupActivationDelayMs = delayMs
    },
    /**
     * Makes a disposed panel's `viewType` and `viewColumn` throw `Webview is disposed`, as the editor's WebviewPanel does (`dispose()` itself stays idempotent).
     * @example harness.throwFromDisposedPanelGetters()
     */
    throwFromDisposedPanelGetters(): void {
      throwsFromDisposedPanelGetters = true
    },
    /**
     * Delivers queued native tab changes after a regression changes window focus, for delayed pane-disposal checks.
     * @returns Once the pending changes ran; their automatic timers then have nothing left to deliver.
     * @example harness.closePendingDisposedPanelTabs() // the disposed Application tab leaves its group
     */
    closePendingDisposedPanelTabs(): void {
      disposedTabClosesHeld = false
      // Take each pending change before delivery so its later automatic timer cannot repeat it.
      for (const close of pendingDisposedTabCloses.splice(0)) close()
    },
    /**
     * Makes the fake editor keep every pending close of a disposed panel's tab, neither closing it by itself nor at a layout read, until {@link closePendingDisposedPanelTabs}: an editor that closes the tab only after the reader began its next arrangement, which a test needs to reach the arrangement's wait for that close (Cycle 0050 F240).
     * @example harness.holdDisposedPanelTabCloses() // the disposed Study context tab stays until closePendingDisposedPanelTabs()
     */
    holdDisposedPanelTabCloses(): void {
      disposedTabClosesHeld = true
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
    /**
     * Makes the fake editor answer every removal of a group with new Tab objects for every tab that remains, as Cursor 3.23.12 does: its editor sends a whole new tab model when a group is removed (`workbench.desktop.main.js` 17269:26248 `onDidRemoveGroup` → `_createTabsModel`), and its extension host builds every tab object anew from it (`$acceptEditorTabModel`), so no tab object survives the removal (Cycle 0046 OCR1-1).
     * Off by default, which is VS Code: its extension host keeps the object of a tab it knows (`_reconcileTabs`).
     * @example harness.rebuildTabObjectsAtGroupRemoval()
     */
    rebuildTabObjectsAtGroupRemoval(): void {
      rebuildsTabObjectsAtGroupRemoval = true
    },
    /**
     * Makes the panels of one kind report a view column other than the column of the group their tab stands in, until it is called again without a column; a test-only model of a panel whose `viewColumn` and tab's group disagree, which no editor was seen to report. The harness's own reveal and move logic reads the same property, so a test keeps the window short.
     * @param kind - The panel's view type, `codebook.studyContext` for the Study pane.
     * @param column - The column to report; left out, the panels report their tab's group's column again.
     * @example harness.reportPanelColumn('codebook.studyContext', 5)
     */
    reportPanelColumn(
      kind: string,
      ...column: [number | undefined] | []
    ): void {
      if (column.length) reportedPanelColumns.set(kind, column[0])
      else reportedPanelColumns.delete(kind)
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
     * Gives `debug.focusEditorOnBreak` the value Codebook contributes through `configurationDefaults`, as the installed extension does: `get` answers it while the learner sets no value of their own (`pauseDebugger`'s `focusesEditorOnBreak`), and `inspect` reports it as the default, in no explicit layer.
     * @param value - The contributed value; Codebook contributes `false`.
     * @example harness.contributeFocusEditorOnBreakDefault(false)
     */
    contributeFocusEditorOnBreakDefault(value: boolean): void {
      contributedFocusEditorOnBreak = value
    },
    /**
     * Pauses the fake debugger: Run and Debug's active stack item is a stack frame, and the reader's listeners are told. Both editors report three states of that item, and this method with `resumeDebugger` is the only way to set them: none before a session's first stop (the state every harness starts in), a frame while the focused thread is stopped (this method), and that thread without a frame once the session runs again (`resumeDebugger`). Called again while a frame is active, it reports the next frame with no thread between the two, as an editor does for a thread that stops again within the 200 ms it waits before it reports a running session, and for a frame the learner selects in the Call Stack view. The editor has opened the paused file with the keyboard before it reports the frame (see `focusMutableDraft`; Cursor's and VS Code's debugger await that opening and select the frame after it), so a test focuses that file first.
     * @param options - `focusesEditorOnBreak` is the learner's `debug.focusEditorOnBreak` setting (left out, the editor's default, on, holds); `session` names another debug session than the live run's server; `reason` is what the adapter's `stopped` event gives (left out, `breakpoint`; `step` for a stop after the learner's step); `startedBeforeTheReader` leaves that event out, for a session whose adapter the reader does not hear; `opensWithKeyboard` lets the debugger open the paused file with the keyboard between that event and the frame, which is the editor's order (a test that focuses the file itself before this call has it active already when the event is sent); `staysInBackground` sends that event and nothing more, for a stop the editor does not bring to the front itself (both editors skip a stop while a frame of another session has the focus, which a session that went on keeps for about 200 ms; see `passFocusToStoppedSession` for what follows); `keepsFocus` is the adapter's `preserveFocusHint` in that event, its wish that the editor leave the focus where it is, which a test gives together with `staysInBackground`; `threadId` is the stopped thread that event names (left out, thread 1). After that event the editor asks for the thread's top frame and the adapter answers (`answerStackTraceOf`): `pausedFile` names that frame's file (left out, the file of `opensWithKeyboard`, else a file no test opens), and `framesDeemphasized` marks it deemphasized, as js-debug does for a frame in a file of `skipFiles` (`<node_internals>/**` for Node by default).
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
        pausedFile?: string
        framesDeemphasized?: boolean
        threadId?: number
      } = {},
    ): void {
      const session = { id: options.session ?? 'live-next-server' }
      // The adapter's `stopped` event passes the trackers before the editor selects the frame; a session that started before the reader has none.
      if (!options.startedBeforeTheReader) {
        for (const tracker of trackersOf(session))
          tracker?.onDidSendMessage?.({
            type: 'event',
            event: 'stopped',
            body: {
              reason: options.reason ?? 'breakpoint',
              threadId: options.threadId ?? 1,
              ...(options.keepsFocus ? { preserveFocusHint: true } : {}),
            },
          })
        answerStackTraceOf(
          session,
          {
            filename:
              options.pausedFile ??
              options.opensWithKeyboard?.filename ??
              'paused-frame.ts',
            deemphasized: options.framesDeemphasized === true,
          },
          options.threadId,
        )
      }
      // A stop the editor leaves in the background ends here: it opens no file and reports no frame.
      if (options.staysInBackground) return
      // The debugger opens the paused file with the keyboard after the adapter reported the stop and before the editor reports the frame.
      if (options.opensWithKeyboard)
        giveDraftKeyboard(
          openDraftTab(
            options.opensWithKeyboard.filename,
            nativeDebugColumn(options.opensWithKeyboard.column),
          ),
        )
      focusEditorOnBreak = options.focusesEditorOnBreak
      reportFrameOf(session.id, options.threadId)
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
      const opened = openDraftTab(
        filename,
        nativeDebugColumn(column),
        opensPreview,
      )
      if (gesture === 'navigation-command') {
        // The group named before keeps its name; the frame's file has the keyboard and is the active text editor.
        if (keepsNamingGroupAfterFrameNavigation)
          staleNamedGroup = staleNamedGroup ?? activeTabGroup
        giveDraftKeyboard(opened)
      }
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
     * @param state - The current tab's preview and dirty values, and an optional replacement file or view column. A replacement file has a matching native document/editor before this tab-only report; no active-editor callback is emitted.
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
      // A changed file needs its actual editor too; a tab-only URI with no matching editor cannot exercise source-input protection.
      const opened = state.filename
        ? openDraftTab(
            state.filename,
            activeTabGroup.viewColumn,
            state.isPreview,
          )
        : undefined
      if (opened)
        activeTabGroup.tabs = activeTabGroup.tabs.filter(
          (tab) => tab !== opened.tab,
        )
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
     * Models native552's debugger-group report while the active text receipt still names the prior captured editor; source-replacement tests call it before rendering the next stop.
     * @param column - The group the debugger named, independently of the editor that retained keyboard focus.
     * @returns A callback that clears only this retained receipt; it restores no group and emits no active-editor event. The caller ends or explicitly changes that native report.
     * @example const release = harness.reportGroupWithRetainedEditor(1); try { await readerSeams(harness).refresh() } finally { release() }
     */
    reportGroupWithRetainedEditor(column: number): () => void {
      const previous = activeTabGroup,
        retained = { value: focusedSourceEditor() },
        group = groups.find((candidate) => candidate.viewColumn === column)
      assert.ok(group, 'The reported debugger group must already exist')
      partialFocusEditor = retained
      activeTabGroup = group
      changedGroups({ opened: [], closed: [], changed: [previous, group] })
      return (): void => {
        // A newer retained receipt must survive cleanup of the earlier modelled report.
        if (partialFocusEditor === retained) partialFocusEditor = undefined
      }
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
     * Opens a stop's paused file as a preview in the group it is given, even a locked one, preserving the focus, and announces the new tab, as Cursor 3.27.22 did with the Application group at an extension run's page stop (Cycle 0062 task 2, dry run of 2026-10-30).
     * @param filename - The paused file.
     * @param column - The group Cursor opened it in.
     * @returns The paused file's tab.
     * @example harness.openPausedFileInLockedGroup('settings.js', 1)
     */
    openPausedFileInLockedGroup(filename: string, column: number): Tab {
      return openAnnouncedTextTab(filename, column, {
        isPreview: true,
        isDirty: false,
      })
    },
    /**
     * Opens a text tab in front of a group, even a locked one, without giving it the keyboard, and announces it: a file the learner dragged there (kept) or an edited preview, beside the paused file of `openPausedFileInLockedGroup`.
     * @param filename - The file.
     * @param column - The group.
     * @param state - Whether the tab is a preview and whether it has unsaved changes.
     * @returns The tab.
     * @example harness.openAnnouncedTextTab('notes.js', 1, { isPreview: false, isDirty: false })
     */
    openAnnouncedTextTab(
      filename: string,
      column: number,
      state: { isPreview: boolean; isDirty: boolean; selectedLine?: number },
    ): Tab {
      return openAnnouncedTextTab(filename, column, state)
    },
    /**
     * Shows a stop the way both editors' own stop handling does under `debug.focusEditorOnBreak: false` (`focusStackFrame(…, { preserveFocus: true })` in VS Code 1.140 and Cursor 3.23): the paused file comes to the front of its group preserving the focus, and then the stop's frame is reported. When the text editor in front of the active group had the keyboard, it is hidden and the keyboard falls to the page body (Cycle 0046 finding 589, C54 rounds 9f and step1). A test sends the adapter's `stopped` event first (`pauseDebugger` with `staysInBackground`).
     * @param sessionId - The session that stopped.
     * @param filename - The paused file.
     * @param column - The group the editor opens it in.
     * @param threadId - The stopped thread whose stop the editor shows (left out, thread 1).
     * @example
     * harness.pauseDebugger({ session: 'live-next-browser', reason: 'step', staysInBackground: true })
     * harness.showStopKeepingFocus('live-next-browser', 'login-form.tsx', 2)
     */
    showStopKeepingFocus(
      sessionId: string,
      filename: string,
      column: number,
      threadId = 1,
    ): void {
      openPausedFileKeepingFocus(filename, column)
      reportFrameOf(sessionId, threadId)
    },
    /**
     * Opens a stop's paused file the way both editors' own stop handling does under `debug.focusEditorOnBreak: false`, and reports no frame yet: the first half of `showStopKeepingFocus`, for a test that reads the reader between the paused file's opening and the stop's frame, which both editors report 4 to 105 ms later (Cycle 0046, the native observers of C50 to C55). `reportStopFrame` is the second half.
     * @param filename - The paused file.
     * @param column - The group the editor opens it in.
     * @example
     * harness.pauseDebugger({ session: 'learner-node', staysInBackground: true, pausedFile: 'actions.ts' })
     * harness.openPausedFileKeepingFocus('actions.ts', 2)
     * harness.reportStopFrame('learner-node')
     */
    openPausedFileKeepingFocus(filename: string, column: number): void {
      openPausedFileKeepingFocus(filename, column)
    },
    /**
     * Reports the frame of a session's current stop, the one the adapter answered as its top frame: the second half of `showStopKeepingFocus`.
     * @param sessionId - The stopped session.
     * @example harness.reportStopFrame('learner-node')
     */
    reportStopFrame(sessionId: string): void {
      reportFrameOf(sessionId)
    },
    /**
     * Reports another frame of the stop the editor shows, with no new stop and no new file: the editor's stop handling focuses the frame again once the rest of the stack is loaded, which reveals the paused file it already shows (Cycle 0046 finding 589, frames 1313, 1314 and 1372 of one stop in the C54 9f round).
     * @example
     * harness.showStopKeepingFocus('live-next-browser', 'login-form.tsx', 2)
     * harness.reportFrameOfSameStop()
     */
    reportFrameOfSameStop(): void {
      assert.ok(isFakeStackFrame(activeStackItem), 'No debug session is paused')
      activeTextEditorChanged(focusedSourceEditor())
      activeStackItem = {
        session: activeStackItem.session,
        threadId: activeStackItem.threadId,
        frameId: nextStackFrameId++,
      }
      for (const listener of [...activeStackItemListeners]) listener()
    },
    /**
     * Makes the adapter refresh the stack of a paused session as js-debug does after "Debug: Toggle Skipping this File": its `continued` event and then a `stopped` event with the reason `breakpoint`, with no request of the editor's or the run's (Cycle 0046 finding 589, C54 round 9f: 27 ms after the Enter). The editor then shows the stop again (`showStopKeepingFocus`).
     * @param sessionId - The paused session.
     * @example
     * harness.refreshPausedStack('live-next-browser')
     * harness.showStopKeepingFocus('live-next-browser', 'login-form.tsx', 2)
     */
    refreshPausedStack(sessionId: string): void {
      for (const tracker of trackersOf({ id: sessionId })) {
        tracker?.onDidSendMessage?.({
          type: 'event',
          event: 'continued',
          body: { threadId: 1 },
        })
        tracker?.onDidSendMessage?.({
          type: 'event',
          event: 'stopped',
          body: { reason: 'breakpoint', threadId: 1 },
        })
      }
      answerStackTraceOf(
        { id: sessionId },
        { filename: 'paused-frame.ts', deemphasized: false },
      )
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
      const session = activeStackItem.session
      for (const tracker of trackersOf(session))
        tracker?.onDidSendMessage?.({
          type: 'event',
          event: 'invalidated',
          body: { areas: ['stacks'] },
        })
      // The editor drops the stale stack and asks for it again before it handles the stop anew.
      answerStackTraceOf(session, {
        filename: paused.filename,
        deemphasized: false,
      })
      giveDraftKeyboard(
        openDraftTab(paused.filename, nativeDebugColumn(paused.column)),
      )
      reportFrameOf(session.id)
    },
    /**
     * Lets a debug adapter tell the editor that the stacks of a session whose stop the editor keeps in the background are no longer valid. It does two things only: the session's trackers see the `invalidated` event, and the stack the editor asks for again is answered with the given top frame (`answerStackTraceOf`). It opens no file and reports no frame. What the editor then does with the stop (both editors handle it again from what they stored of the adapter's `stopped` event, its `preserveFocusHint` among it) is not modelled here: a test models it with its next step, for example `showStopKeepingFocus` for a stop the editor shows (Cycle 0046 R5).
     * @param sessionId - The session whose stacks are declared invalid.
     * @param top - The top frame the adapter answers again: its file, whether it is deemphasized, and its thread (left out, thread 1).
     * @example
     * harness.pauseDebugger({ session: 'learner-node', staysInBackground: true, keepsFocus: true, pausedFile: 'actions.ts' })
     * harness.invalidateStacksOfStopInBackground('learner-node', { filename: 'actions.ts', deemphasized: false })
     */
    invalidateStacksOfStopInBackground(
      sessionId: string,
      top: { filename: string; deemphasized: boolean; threadId?: number },
    ): void {
      const session = { id: sessionId }
      for (const tracker of trackersOf(session))
        tracker?.onDidSendMessage?.({
          type: 'event',
          event: 'invalidated',
          body: { areas: ['stacks'] },
        })
      answerStackTraceOf(session, top, top.threadId)
    },
    /**
     * Lets the editor ask for a stopped thread's stack again and the adapter answer it, as the Call Stack view does when it shows a thread whose stack an invalidation cleared (both editors' `clearThreads` at `invalidated`); the trackers see the request and the response, and the frame is the one `reportFrameOf` reports for that thread (Cycle 0046 Q8).
     * @param sessionId - The stopped session.
     * @param top - The top frame's file and whether it is deemphasized.
     * @param threadId - The thread whose stack the editor asks for.
     * @example harness.fetchThreadStackAgain('learner-node', { filename: 'order.ts', deemphasized: false }, 2)
     */
    fetchThreadStackAgain(
      sessionId: string,
      top: { filename: string; deemphasized: boolean },
      threadId: number,
    ): void {
      answerStackTraceOf({ id: sessionId }, top, threadId)
    },
    /**
     * Shows a stop for which the editor's stop handling finds no frame to focus, so it focuses the stopped thread alone and opens no file: `getTopStackFrame` of both editors skips every frame whose source is deemphasized when the stop's reason is none of `breakpoint`, `step` and `function breakpoint`, as at js-debug's pause of a Node process in Node's own code (`skipFiles` `<node_internals>/**`) or an uncaught exception thrown there. A test sends the adapter's `stopped` event and the frames first (`pauseDebugger` with `staysInBackground` and `framesDeemphasized`).
     * @param sessionId - The stopped session.
     * @example
     * harness.pauseDebugger({ session: 'learner-node', reason: 'pause', staysInBackground: true, framesDeemphasized: true })
     * harness.showStopWithoutFrame('learner-node')
     */
    showStopWithoutFrame(sessionId: string): void {
      activeStackItem = { session: { id: sessionId }, threadId: 1 }
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
     * Lets a paused session go on as the editor tells its adapter: the session's trackers see the `continue` request, or the `next` request of the learner's Step Over (F10), and then the adapter's answer to it. Run and Debug's active stack item stays as it is: the editor keeps the frame for about 200 ms (`resumeDebugger` is what it reports then).
     * @param sessionId - The session; left out, the live run's server session.
     * @param command - `continue` (left out) or `next`, the request the editor sends.
     * @param answer - `success` (left out): the adapter grants the request, after which both editors drop the stopped thread's details (a `continue` all threads', as the adapter's answer names no other); `refusal`: the adapter answers it with an error, and the editors keep every stop's details (VS Code 1.142.0 and Cursor 3.23.23: the simulated `continued` follows only a granted request; Cycle 0046 AD12).
     * @example
     * harness.pauseDebugger({ session: 'live-next-browser' })
     * harness.continueDebugSession('live-next-browser')
     */
    continueDebugSession(
      sessionId = 'live-next-server',
      command: 'continue' | 'next' = 'continue',
      answer: 'success' | 'refusal' = 'success',
    ): void {
      const requestSeq = nextDebugMessageSeq++
      for (const tracker of trackersOf({ id: sessionId }))
        tracker?.onWillReceiveMessage?.({
          type: 'request',
          seq: requestSeq,
          command,
          arguments: { threadId: 1 },
        })
      const responseSeq = nextDebugMessageSeq++
      for (const tracker of trackersOf({ id: sessionId }))
        tracker?.onDidSendMessage?.(
          answer === 'success'
            ? {
                type: 'response',
                seq: responseSeq,
                request_seq: requestSeq,
                success: true,
                command,
                body: {},
              }
            : {
                type: 'response',
                seq: responseSeq,
                request_seq: requestSeq,
                success: false,
                command,
                message: 'The thread cannot step from here.',
              },
        )
    },
    /**
     * Lets the adapter of a paused session say that one of its threads goes on by itself: the session's trackers see its `continued` event for that thread. Both editors then drop that thread's stop details only, or every thread's unless the event says `allThreadsContinued: false` (VS Code 1.142.0 and Cursor 3.23.23 `onDidContinued`; Cycle 0046 AD12).
     * @param sessionId - The session.
     * @param threadId - The thread that goes on.
     * @param allThreadsContinued - What the event says of the other threads.
     * @example harness.reportThreadContinued('learner-node', 2, false) // thread 1's stop stays stored
     */
    reportThreadContinued(
      sessionId: string,
      threadId: number,
      allThreadsContinued: boolean,
    ): void {
      for (const tracker of trackersOf({ id: sessionId }))
        tracker?.onDidSendMessage?.({
          type: 'event',
          event: 'continued',
          body: { threadId, allThreadsContinued },
        })
    },
    /**
     * Brings a stopped session to the front as the editor does 800 ms after the session it showed went on (`passFocusScheduler` of VS Code 1.140 and Cursor 3.23, which focuses the frame preserving the focus): it opens the frame's file in front of a group without giving it the keyboard, and reports the frame of that session. A single click on that session's frame in the Call Stack view is reported the same way, and the keyboard stays in the view. No `stopped` event comes with it: the adapter sent that one when the session stopped (`pauseDebugger` with `staysInBackground`).
     * @param sessionId - The stopped session.
     * @param filename - The frame's file.
     * @param column - The view column of the group the editor opens it in.
     * @param order - `file-then-frame` (left out) is the order both editors send the two reports in; `frame-then-file` reports the frame first, the order Cursor 3.23 was seen to use only for a double click on the row of a frame whose file was not open (Cycle 0046, round 9b of C54 and C55: the file 659 to 660 ms after the frame), for a test that no keyboard is handed over then (finding 602).
     * @param threadId - The thread of the frame the editor focuses (left out, thread 1).
     * @example
     * harness.pauseDebugger({ staysInBackground: true })
     * harness.passFocusToStoppedSession('live-next-server', 'actions.ts', 1)
     */
    passFocusToStoppedSession(
      sessionId: string,
      filename: string,
      column: number,
      order: 'file-then-frame' | 'frame-then-file' = 'file-then-frame',
      threadId = 1,
    ): void {
      if (order === 'frame-then-file') reportFrameOf(sessionId, threadId)
      openDraftTab(filename, nativeDebugColumn(column))
      // Only the active group's editor is reported as the active text editor, and none while the chat's own part is the named one.
      activeTextEditorChanged(focusedSourceEditor())
      if (order === 'file-then-frame') reportFrameOf(sessionId, threadId)
    },
    /**
     * Gives a view that is no editor the keyboard, as a learner's click into the Call Stack view of Run and Debug does. The editor reports nothing of it to an extension: the active tab group, its tab and the active text editor stay as they are; only the chat's own part loses the keyboard.
     * @example harness.focusView()
     */
    focusView(): void {
      keyboardInView = true
      viewInSecondarySideBar = false
      keyboardOnBody = false
      // The native active tab stays, but its inner document loses the actual keyboard.
      innerFocusedPanel = undefined
      leaveChatForView()
    },
    /**
     * Gives VS Code's chat view the keyboard where that editor puts it by default: in front of the secondary side bar, the bar the Learning summary's container stands in too. The editor reports it as `focusView` does; showing the summary's container in that bar then removes the chat's element with the keyboard inside.
     * @example harness.focusChatInSecondarySideBar()
     */
    focusChatInSecondarySideBar(): void {
      keyboardInView = true
      viewInSecondarySideBar = true
      keyboardOnBody = false
      // The native active tab stays, but its inner document loses the actual keyboard.
      innerFocusedPanel = undefined
      leaveChatForView()
    },
    /**
     * Gives the learner's terminal the keyboard in front of the bottom panel, the panel the Observed moments' container stands in too. The editor reports it as `focusView` does; showing the moments' container in that panel then hides the terminal and removes its element with the keyboard inside.
     * @example harness.focusTerminalInBottomPanel()
     */
    focusTerminalInBottomPanel(): void {
      keyboardInView = true
      viewInSecondarySideBar = false
      terminalInFrontOfPanel = true
      keyboardOnBody = false
      innerFocusedPanel = undefined
      leaveChatForView()
    },
    /** Says whether the learner's terminal still stands in front of the bottom panel; see `focusTerminalInBottomPanel`. @example harness.terminalInFrontOfPanel() // => false after the moments' container replaced it */
    terminalInFrontOfPanel: () => terminalInFrontOfPanel,
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
     * Calibrates lifecycle regressions to native controls 436–449 and 451–457: true ending-group closes lose editor keyboard, false restores it through the host's actual-DOM guard, and native tab closes dispose their panels.
     * Terminal/sidebar input is represented by {@link focusView}; it stays outside the editor part even while an active text editor is reported.
     * Window-focused-false is a deterministic guard; controls 459–461 lack a separate predispatch inactive sample and supply only partial native evidence.
     * @example harness.modelNativeTabCloseFocus(); harness.focusView() // closing an ending owned group leaves the view's keyboard alone
     */
    modelNativeTabCloseFocus(): void {
      modelsNativeTabCloseFocus = true
      closeDisposedPanelTabsLater = true
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
    sourceDocumentChanges: () => [...sourceDocumentChanges],
    /** Reads the actual registered content provider for source-cache regressions, independently of the native document model. @param uri - The fixture's real native source identity. @returns Provider bytes before native line-ending normalization. @example await harness.providedSource(sourceEditor.document.uri) */
    providedSource: (uri: Uri): Promise<string> => sourceProvider(uri),
    /**
     * Makes the fake editor bring a revealed pane to the front of its group after `reveal()` returned: while the next layout read is pending, or by itself after {@link DISPOSED_TAB_CLOSE_DELAY_MS} when no layout read arrives, with the tab and group events of that change arriving then, as an editor does whose reveal is a request to another process (the hypothesis of Cycle 0045 row NF-20 for Cursor: "Open replay" read its own reveal of the Application pane as a change the learner made). A reveal that moves the pane to another column, and one of a pane that is in front already, are applied at once as before.
     * @example harness.revealPanelsLater()
     */
    revealPanelsLater(): void {
      revealsPanelsLater = true
    },
    /**
     * Makes the fake editor move a pane that `reveal(column)` sends to another column after the call returned: while the next layout read is pending, or by itself after {@link DISPOSED_TAB_CLOSE_DELAY_MS} when no layout read arrives, with the pane's column, its `active` flag and the tab events changing then. VS Code 1.140.0 and Cursor 3.23.12 for Linux both reported the Application pane's move into its newly allocated group this way, during the `vscode.getEditorLayout` read that followed the reveal (Cycle 0046 finding 583, the extension-host observer's `appViewState` event 16 ms after that read began).
     * @example harness.movePanelsLater()
     */
    movePanelsLater(): void {
      movesPanelsLater = true
    },
    /**
     * Makes the fake editor name the group that held the keyboard before a native group insertion as active again one editor change after the insertion, while the new group is still empty, as Cursor 3.23.12 did for the Application's group after a reload (trace `c54/cursor/reload-2/sdk-events.json`, events 3997 to 4009).
     * @example harness.reactivatePreviousGroupAfterInsertion()
     */
    reactivatePreviousGroupAfterInsertion(): void {
      reactivatesPreviousGroupLater = true
    },
    /**
     * Makes the fake editor activate the group that held the keyboard before a native group insertion again before the next `workbench.action.lockEditorGroup` reaches it, once: the lock, which takes no argument and acts on the active group, locks that group, and the tab model names it as the lock answers. Cursor 3.23.12 did so in C57 round 1b, where the Return's new Application group stood unlocked above the learner's first group, which was locked and stayed locked after Close (Cycle 0046 row 644).
     * @example harness.reactivatePreviousGroupBeforeLock()
     */
    reactivatePreviousGroupBeforeLock(): void {
      reactivatesPreviousGroupBeforeLock = true
    },
    /**
     * Makes the fake editor name the group that shows a tab as the active one right after the next `workbench.action.lockEditorGroup` answered, once, and before the reader's next command: another group than the one the lock reached is the active one when the reader acts on the lock's answer (Cycle 0046 row 668), as a group's activation that comes alone (a learner's click, or the editor's own activation of another group).
     * @param tab - A tab of the group that becomes the active one.
     * @example harness.activateGroupOfTabAfterNextLock(learnerAuth.tab)
     */
    activateGroupOfTabAfterNextLock(tab: Tab): void {
      groupActivatedAfterLock = tab
    },
    /**
     * Locks a group as the learner's View: Lock Editor Group does, without moving the keyboard: the editor reports the whole tab model once (see `setGroupLock`), and the extension API cannot read the lock.
     * @param column - The view column of the group the learner locked.
     * @example harness.lockGroupAsLearner(1)
     */
    lockGroupAsLearner(column: number): void {
      const group = groups.find((candidate) => candidate.viewColumn === column)
      assert.ok(group, 'No group at that column')
      setGroupLock(group, true)
    },
    /**
     * Makes the fake editor answer Cursor's Focus Agent (`composer.focusComposer`) before its chat input has the keyboard, which the chat takes a moment later, just before the editor runs the given one of the reader's following commands: Cursor 3.23.12 runs the command without awaiting the chat's opening (`workbench.desktop.main.js` 17914:19364 `n.handleOpenComposer(…)` in an `async run` that returns nothing; 18566:8949 dispatches to `handleOpenComposerEditor` without awaiting it, which awaits `openComposer` before the input is focused, 18566:8204). In C57 rounds c57-cursor-1f and 1f2 an agent's first run after a reload failed right after its Application stood in its new group (Cycle 0046 row 646).
     * @param commandsBeforeFocus - How many of the reader's commands the editor answers after Focus Agent before the chat input has the keyboard; the chat takes it just before the last of them, or at the next turn of the event loop when fewer commands come.
     * @example harness.focusAgentLater(6) // the chat takes the keyboard just before the sixth command after Focus Agent
     */
    focusAgentLater(commandsBeforeFocus: number): void {
      commandsBeforeAgentFocus = commandsBeforeFocus
    },
    /**
     * Makes the fake editor name the group that held the keyboard before a native group insertion as active again at the next layout read after it, as {@link reactivatePreviousGroupAfterInsertion} does at the lock; the read that follows Codebook's own App move sees the editor's late focus.
     * @example harness.reactivatePreviousGroupAtNextLayoutRead()
     */
    reactivatePreviousGroupAtNextLayoutRead(readNumber = 1): void {
      reactivatesPreviousGroupAtLayoutRead = true
      layoutReadsUntilReactivation = readNumber
    },
    /**
     * Makes the fake editor answer `workbench.action.focusFirstEditorGroup` the way Cursor 3.23.12 was seen to while the chat has the keyboard, whether it names the chat's group as the active tab group (Cycle 0045: owed check 1, take A1, and obs15 P2) or a group of the main editor (obs15 R: a recording opened from the chat input while the editor named the captured source's group): the first group takes the keyboard and layout reads are answered for the main editor from then on, but no group event arrives and the named group stays the active tab group until the next group event (a whole tab-model rebuild or a group's activation; a tab notification leaves it, row 673). A text editor the first group shows is reported as the active text editor (`onDidChangeActiveTextEditor`); a pane (the Application pane) is not reported at all, and its `active` flag stays false.
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
    /**
     * Makes the fake editor behave as Cursor 3.27.22 was measured to while its Agent chat has the keyboard (Cycle 0064 task 4): `workbench.action.focusFirstEditorGroup` resolves with no event at all, and a pane revealed with the focus in the first group takes the keyboard and reports itself active while the editor goes on naming the chat's group, with no group event.
     * @example
     * const chat = harness.addSeparateEditorPart()
     * harness.ignoresFirstGroupFocusCommandBesideChat()
     * chat.focusTab()
     */
    ignoresFirstGroupFocusCommandBesideChat(): void {
      ignoresFirstGroupFocusCommandBesideChatFlag = true
      replacesGroupObjectsOnTabChanges = true
    },
    /**
     * Makes the fake editor answer `workbench.action.focusFirstEditorGroup` the way Cursor 3.27.12 was seen to while its Agent chat group is the active one (Cycle 0060, N60): the first group's pane reports itself active for a moment while the editor goes on naming the chat's group, the next layout read is answered for the main editor, and the chat input has the keyboard again right after that read, while later layout reads still answer for the main editor. No text editor is reported.
     * @example
     * const chat = harness.addSeparateEditorPart()
     * harness.takesKeyboardBackFromFirstGroupBesideChat()
     * chat.focusTab()
     */
    takesKeyboardBackFromFirstGroupBesideChat(): void {
      chatRetakesKeyboardFromFirstGroup = true
      replacesGroupObjectsOnTabChanges = true
    },
    /**
     * Makes the learner's click into a file of the main editor (`focusMutableDraft` and its `focus`) keep Cursor's name of its chat part's group, as Cursor 3.23.12 did on C61: after a genuine click into the text of auth.ts in front of group 2, auth.ts was the active text editor with the keyboard in its TEXTAREA while `activeTabGroup` still named the chat part's group 3 (private c61-cu-692; a click renames no group, as row 702's probe read for the chat input; Cycle 0046 row 712). The name stays until the next group event, as every stale name of this model does. Without it the click names the file's group.
     * @example
     * chat.focusTab()
     * harness.keepChatPartNameAtLearnersFileClick()
     * auth.focus() // auth.ts has the keyboard; the chat part's group is still named
     */
    keepChatPartNameAtLearnersFileClick(): void {
      keepsChatPartNameAtLearnersFileClick = true
    },
    /**
     * Opens VS Code 1.140.0's floating window of text editors beside the main editor: one learner's file per group, the groups counted after the main editor's (`workbench.desktop.main.js` 699:19807, 1106:181094), a layout read answered for the floating window's own grid while it is the focused window (993:31655), `workbench.action.focusFirstEditorGroup` focusing the main window's first group, and a numbered focus command of a floating group's column raising that window (987:4284). Not modelled: panes in the floating window and its close (Cycle 0046 rows 688 and 689).
     * @param filenames - The learner's file of each group of the floating window, from its first group on.
     * @returns `focus(index)`: the learner's click into the text editor of that group, after which the floating window is the focused one.
     * @example
     * const floating = harness.addFloatingEditorWindow(['notes.ts', 'readme.md'])
     * floating.focus(0) // notes.ts in column 2 has the keyboard; a layout read answers the floating window's two groups
     */
    addFloatingEditorWindow(filenames: string[]) {
      const opened = filenames.map((filename) => {
        const column = groups.length + 1
        nativeGroup(column, true)
        return openDraftTab(filename, column)
      })
      floatingEditorWindow = {
        groups: opened.map((draft) => draft.group),
        layout: { orientation: 0, groups: filenames.map(() => ({})) },
        active: false,
      }
      return {
        focus(index: number): void {
          giveDraftKeyboard(opened[index]!)
          floatingEditorWindow!.active = true
        },
      }
    },
    /**
     * Opens a learner's file as a diff editor in front of a group and gives it the keyboard, as the Source Control view's Open Changes does: the tab's input is a `TabInputTextDiff` of the file's original and its working copy, and the active text editor is the modified side's; both sides are visible text editors, and both editors report them with no view column (C61 c61-688-diffprobe, Cycle 0046 row 709). `showTextDocument` of that document opens a plain text tab of it in front of the diff, as both editors do for a resource shown in a diff (row 688). A group of VS Code's floating window (`addFloatingEditorWindow`) takes the diff too, and the floating window is the focused one then (row 720).
     * @param filename - The learner's file.
     * @param column - The group's view column.
     * @returns The modified document, the diff tab and the modified side's text editor.
     * @example const diff = harness.focusDiffEditor('auth.ts', 2) // auth.ts (Working Tree) in front of column 2 with the keyboard
     */
    focusDiffEditor(filename: string, column: number) {
      const opened = openDraftTab(filename, column)
      const originalDocument = {
        uri: Uri.from({
          scheme: 'git',
          authority: '',
          path: opened.document.uri.path,
        }),
        version: 1,
        getText: () => 'Committed learner file.\n',
      }
      const diffTab: Tab = {
        input: new TabInputTextDiff(originalDocument.uri, opened.document.uri),
        label: `${filename} (Working Tree)`,
        isPreview: false,
      }
      opened.group.tabs.splice(
        opened.group.tabs.indexOf(opened.tab),
        1,
        diffTab,
      )
      opened.group.activeTab = diffTab
      // The diff's original side is a visible text editor too (row 709).
      visibleSourceEditors.push(
        Object.assign(sourceEditor(originalDocument, opened.group), {
          group: opened.group,
        }),
      )
      activeTabGroup = opened.group
      // The click into a diff of VS Code's floating window makes that window the focused one, and one of the main window the main window (row 720).
      if (floatingEditorWindow)
        floatingEditorWindow.active = floatingEditorWindow.groups.includes(
          opened.group,
        )
      leaveChatForMainEditor()
      keyboardOnBody = false
      keyboardInView = false
      activeTextEditorChanged(opened.editor)
      return { document: opened.document, tab: diffTab, editor: opened.editor }
    },
    useNativeLayout(layout: unknown): void {
      // Replacing the fixture's native desktop closes its real pane handles and removes their old editors, rather than leaving invisible owners alive.
      for (const current of [...panels]) current.dispose()
      visibleSourceEditors.splice(0)
      lastSourceEditor = undefined
      keyboardOnBody = false
      keyboardInView = false
      nativeLayout = true
      separateEditorPart = undefined
      const previous = [...groups]
      groups.splice(0)
      editorLayout = structuredClone(layout)
      for (let column = 1; column <= nativeGroupCount(layout); column++)
        nativeGroup(column, true)
      // A native visible source tab always has its corresponding TextEditor, including when App later uncovers it.
      const initialSource = openDraftTab('article-source.ts', 1)
      initialSource.tab.isDirty = false
      groups[1]?.tabs.push({
        input: new TabInputWebview('codebook.repositoryWiki'),
        label: 'codebook · Repository Wiki',
      })
      activeTabGroup = groups[0]!
      activeTabGroup.activeTab = activeTabGroup.tabs[0]
      changedGroups({ opened: [...groups], closed: previous, changed: [] })
    },
    /** Makes the fake editor settle a Study grid of that many groups at sizes of its own, as an editor with a minimum group size does: three for the Study composition (two columns), two for the summary composition (Cycle 0051). @example harness.constrainStudyGrid(2) */
    constrainStudyGrid(groupCount: 2 | 3 = 3): void {
      constrainedStudyGridGroups = groupCount
    },
    /**
     * Makes `workbench.action.newGroupAbove` leave the text editor reported before it as the active text editor until a pane's tab stands in front of the new empty group, as Cursor 3.23.12 reported it in a Repository Wiki recording visit (C61 c61-cu-695c: the first-group focus made the Wiki's cited copy the active text editor, the insertion and the lock of the Application's group left it so, and the active text editor was reported as none only 43 ms after the lock, while the parked Application pane moved into the new group; Cycle 0046 row 710). Off by default: the other tests keep the fake editor's report of no active text editor at the insertion.
     * @example harness.keepTextEditorReportAfterNewGroup()
     */
    keepTextEditorReportAfterNewGroup(): void {
      keepsTextEditorReportAfterNewGroup = true
    },
    /**
     * Makes the fake editor expand a stacked row at the minimum height that a numbered focus command activates, as VS Code 1.140.0 does, for a learner's stack of uneven rows (Cycle 0046 row 691): `expandMinimizedRow`, `doRestoreGroup` at 1106:114938: 262/355/70 gives 70/70/547 when the third row is activated, as c59-vs-691probe4 recorded. `workbench.action.newGroupAbove` sizes stacked rows given in pixels as the split view does in every model since row 703 (`rowsAfterNewGroupAbove`: 524/163 gives 262/355/70, 343/344 gives 229/229/229), and an emptied row's removal keeps the editor area's height (`rowsAfterRemoval`). Off by default: the other tests keep rows that no activation expands, on which their verdicts were taken.
     * @example
     * harness.useNativeLayout({ orientation: 1, groups: [{ size: 524 }, { size: 163 }] })
     * harness.modelVsCodeStackedRowSizing()
     */
    modelVsCodeStackedRowSizing(): void {
      modelsVsCodeStackedRowSizing = true
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
    /**
     * Adds a real separate-part boundary without changing the main leaf count, matching the recorded Cursor probe.
     * @param kind - `'cursor-agent'` (the default) for Cursor's Agent chat part, whose tab input the extension API gives no kind and whose host registers Focus Agent; `'vscode-floating-chat'` for VS Code's chat editor tab moved into a floating window (Chat: Move Chat into New Window): a `TabInputChat` tab whose group the extension API counts after the main editor's (1.140.0 `workbench.desktop.main.js` 699:19807, 1106:181094), no Focus Agent, and the numbered focus command of its column gives it the keyboard.
     * @example const chat = harness.addSeparateEditorPart(); chat.focus();
     */
    addSeparateEditorPart(
      kind: 'cursor-agent' | 'vscode-floating-chat' = 'cursor-agent',
    ) {
      assert.equal(nativeLayout, true)
      assert.equal(separateEditorPart, undefined)
      const floatingVsCodeChat = kind === 'vscode-floating-chat'
      const chatTab = {
        input: floatingVsCodeChat ? new TabInputChat() : new TabInputUnknown(),
        label: floatingVsCodeChat ? 'Chat' : 'New Agent',
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
        tab: chatTab,
        layout: { orientation: 1, groups: [{ size: 743 }] },
        focused: false,
        lastActive: false,
        floatingVsCodeChat,
      }
      groups.push(group)
      changedGroups({ opened: [group], closed: [], changed: [] })
      return {
        get tab() {
          return separateEditorPart?.tab ?? chatTab
        },
        layout: () => structuredClone(separateEditorPart?.layout),
        focused: () => separateEditorPart?.focused,
        focus(): void {
          separateEditorPart!.focused = true
          separateEditorPart!.lastActive = true
          keyboardOnBody = false
          keyboardInView = false
          activeTextEditorChanged(undefined)
        },
        /** Gives the chat tab the keyboard focus the way Cursor reports it: its group is the active tab group, no text editor is active, and a layout read is answered for the chat's own part. @example chat.focusTab() */
        focusTab: focusSeparatePartGroup,
        /** Refreshes only the foreign wrapper when presentation tests create a pane; lifecycle and movement remain distinct. @example chat.resync('wrapper') */
        resync(change: 'wrapper' | 'opened' | 'unannounced' | 'move'): void {
          const previous = separateEditorPart!.group,
            replacement = { ...previous, tabs: [...previous.tabs] }
          // The unchanged empty chat part is not a new native group; explicit lifecycle events cannot inherit it.
          if (change === 'move') replacement.viewColumn++
          // An opened replacement is another group; the others keep the group's identity.
          if (change !== 'opened') replacedBy(previous, replacement)
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
      clickIntoDraft(opened)
      return {
        document,
        tab,
        editor,
        replaceContent(value: string): void {
          replaceText(value)
        },
        focus(): void {
          clickIntoDraft(opened)
        },
      }
    },
    /** Leaves a captured-source tab in a group as the host restores one after a restart: a text tab without a text editor. `textEditor` gives it a live editor instead, as a first open that failed leaves this host's own tab; `staleTextEditor` lets the editor report its document for a moment after the tab closed; `file` names another captured file of the earlier study than Captured-login-form.tsx, for a second such tab. @example const leftover = harness.restoreLeftoverCapturedSource(); harness.restoreLeftoverCapturedSource({ active: false, authority: 'f'.repeat(64) }) */
    restoreLeftoverCapturedSource(
      options: {
        active?: boolean
        authority?: string
        column?: number
        file?: string
        /** The whole address path, for a tab of another address than an earlier study's captured file. */
        path?: string
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
          path:
            options.path ??
            `/earlier-study/repository%2Finterface%2Ftheme/hash/${options.file ?? 'Captured-login-form.tsx'}`,
        }),
        version: 1,
        getText: () => 'Captured source of an earlier study.\n',
      }
      const tab: Tab = {
        input: new TabInputText(document.uri),
        label: textTabLabel(document.uri),
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
      else unresolvedRestoredSources.set(tab, editor)
      group.tabs.push(tab)
      if (options.active ?? true) {
        group.activeTab = tab
        activeTabGroup = group
        activeTextEditorChanged(focusedSourceEditor())
      }
      return tab
    },
    /**
     * Opens another extension's webview tab in front of a group without giving it the keyboard, as a learner's Markdown preview: the tab model lists it under the main-thread view type with its title as its label, and the reader owns no panel for it.
     * @param viewType - The other extension's view type.
     * @param label - The tab's title.
     * @param column - The view column of the group it stands in front of.
     * @returns The new tab.
     * @example const preview = harness.addForeignWebviewTab('markdown.preview', 'Preview README.md', 2)
     */
    addForeignWebviewTab(viewType: string, label: string, column: number): Tab {
      const group = groups.find((candidate) => candidate.viewColumn === column)
      assert.ok(group)
      const tab: Tab = {
        input: new TabInputWebview(`mainThreadWebview-${viewType}`),
        label,
        isPreview: false,
        isDirty: false,
      }
      group.tabs.push(tab)
      group.activeTab = tab
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
        leaveChatForMainEditor()
        activeTextEditorChanged(focusedSourceEditor())
      }
      return tab
    },
    /**
     * Leaves a main column's editor group empty and locked with no pane, as Cursor keeps the old owned Application group after an extension-host reload whose panel is not restored; the new reader has no identity or proof for it.
     * @param column - The main column whose tabs close while its group keeps its lock.
     * @example harness.leaveEmptyLockedGroup(1)
     */
    leaveEmptyLockedGroup(column: number): void {
      const group = groups.find((candidate) => candidate.viewColumn === column)
      assert.ok(group)
      group.tabs.splice(0)
      group.activeTab = undefined
      group.locked = true
      changedGroups({ opened: [], closed: [], changed: [group] })
    },
    /**
     * Leaves a main column's editor group empty with no pane and unlocked, as both editors restore the group the Study Context's pane had after a window reload: the pane has no serializer and is not restored, and its group stays at its column (finding 599). The new reader has no identity or proof for it.
     * @param column - The main column whose tabs close.
     * @example harness.leaveEmptyGroup(3)
     */
    leaveEmptyGroup(column: number): void {
      const group = groups.find((candidate) => candidate.viewColumn === column)
      assert.ok(group)
      group.tabs.splice(0)
      group.activeTab = undefined
      changedGroups({ opened: [], closed: [], changed: [group] })
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
    /**
     * Holds the editor's act on the next request to close tabs until the test releases it: no tab closes before `release`, so a test can show or select something else while a close is pending. Unlike `holdNextTabCloseResponse`, the effect comes after the release.
     * @returns The entered receipt and the release callback for that one request.
     * @example const close = harness.holdNextTabCloseEffect(); await close.started; await selectMoment(…); close.release()
     */
    holdNextTabCloseEffect() {
      let entered!: () => void, release!: () => void
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      heldTabCloseEffect = { entered, wait }
      return { started, release }
    },
    /**
     * Holds the editor's show of the next text document (`showTextDocument`), after it opened the document and before it puts a tab in front of its group, until the test releases it, as an editor whose show stalls.
     * @param options - An exact URI limits the hold to that document.
     * @returns The entered receipt and the release callback for that one show.
     * @example const show = harness.holdNextTextDocumentShow({ uri: slotUri }); await show.started; show.release()
     */
    holdNextTextDocumentShow(options?: { uri: string }) {
      let entered!: () => void, release!: () => void
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      heldTextDocumentShow = { entered, wait, uri: options?.uri }
      return { started, release }
    },
    /**
     * Makes the editor show the next `showTextDocument` of a document in another column than the one asked, as an editor does when the asked group closed meanwhile or it reveals the file where it already was.
     * @param uri - The exact document URI.
     * @param viewColumn - The column the editor shows it in.
     * @example harness.redirectNextTextDocumentShow(uri, applicationColumn)
     */
    redirectNextTextDocumentShow(uri: string, viewColumn: number): void {
      redirectedTextDocumentShow = { uri, viewColumn }
    },
    /**
     * Makes the editor refuse to close every open tab whose document URI contains a text, as it does for a tab it keeps (an answer of `false` for its group's requested tabs).
     * @param uriPart - A part of the document URI, such as `Captured-theme.ts`.
     * @returns The function that lets the editor close those tabs again.
     * @example const accept = harness.refuseCloseOfTabsShowing('Captured-theme.ts'); …; accept()
     */
    refuseCloseOfTabsShowing(uriPart: string): () => void {
      const refused = groups
        .flatMap((group) => group.tabs)
        .filter((tab) => {
          const input = tab.input as
            { uri?: { toString(): string } } | undefined
          return input?.uri?.toString().includes(uriPart)
        })
      for (const tab of refused) closeRefusingTabs.add(tab)
      return (): void => {
        for (const tab of refused) closeRefusingTabs.delete(tab)
      }
    },
    /** Turns the recorded-source slot's deadline clock over to the test: timers set from now on fire only in `elapseSlotClock`. @example harness.useManualSlotClock() */
    useManualSlotClock(): void {
      manualSlotClock = true
    },
    /**
     * Moves the hand-driven slot clock forward and fires every timer that falls due, in order, also a timer that a firing timer sets and that falls due within the same span.
     * Only the reader's slot deadline timers are hand-driven. The wait of `awaitDocumentSettled` (its poll and the 5,000 ms bound it is given) keeps the real clock; a test ends that wait through the deadline's signal, which this clock fires.
     * @param milliseconds - How far to move the clock.
     * @example harness.elapseSlotClock(1_000)
     */
    elapseSlotClock(milliseconds: number): void {
      const targetMs = slotClockMs + milliseconds
      // Each pass takes the earliest due timer and moves the clock to its due time, so a timer set by a callback is due from that moment and joins the order.
      for (;;) {
        const due = manualSlotTimers
          .filter((timer) => timer.active && timer.dueMs <= targetMs)
          .toSorted((left, right) => left.dueMs - right.dueMs)[0]
        if (!due) break
        slotClockMs = Math.max(slotClockMs, due.dueMs)
        due.active = false
        due.callback()
      }
      slotClockMs = targetMs
    },
    /** How many hand-driven slot timers are set and not yet fired or cancelled. @example assert.equal(harness.pendingSlotTimers(), 0) */
    pendingSlotTimers: (): number =>
      manualSlotTimers.filter((timer) => timer.active).length,
    /** The first line of every reveal of a recorded-source slot's editor, in order, with the slot's URI. @example harness.slotReveals().at(-1) // => { uri: 'codebook-source://…', line: 0 } */
    slotReveals: () => [...slotRevealCalls],
    /**
     * Asks the registered CodeLens providers for the lenses of a document, as the editor does for a visible document.
     * @param uri - The URI, as text, of a document some editor has open.
     * @returns The lens titles in order.
     * @example harness.codeLensTitles(slotUri) // => ['Recorded: src/theme.ts:1 · 0.20 s']
     */
    codeLensTitles(uri: string): string[] {
      const document = visibleSourceEditors.find(
        (editor) => editor.document.uri.toString() === uri,
      )?.document
      assert.ok(document, `No editor shows ${uri}`)
      // Only the providers registered for this document's scheme and language are asked, as the editor does.
      return codeLensProviders
        .filter(({ selector }) =>
          documentSelectorMatches(selector, {
            uri: document.uri,
            languageId:
              virtualSourceDocuments.get(uri)?.languageId ?? 'plaintext',
          }),
        )
        .flatMap(({ provider }) => provider.provideCodeLenses(document))
        .map((lens) => lens.command?.title ?? '')
    },
    /** How many times a CodeLens provider announced a change since the harness started, as a refresh of the open lenses; the reader announces one whenever the slot's label is drawn or cleared. @example const before = harness.codeLensRefreshCount(); …; assert.ok(harness.codeLensRefreshCount() > before) */
    codeLensRefreshCount: (): number => codeLensRefreshes,
    /** How many CodeLens providers are registered now. @example assert.equal(harness.codeLensProviderCount(), 1) */
    codeLensProviderCount: (): number => codeLensProviders.length,
    /** Registers a CodeLens provider as another extension would, for the test of the registration's own dispose; returns its registration handle. @example const other = harness.registerOtherCodeLensProvider() */
    registerOtherCodeLensProvider(): { dispose(): void } {
      return editorDependencies.vscode.languages.registerCodeLensProvider(
        { scheme: 'file' },
        { provideCodeLenses: () => [] },
      )
    },
    /**
     * Gives the keyboard to the editor group at a column, as a click in that group does, so a document another action shows in a different group comes to the front without becoming the active editor.
     * @param column - The group's view column.
     * @example harness.activateEditorGroup(1)
     */
    activateEditorGroup(column: number): void {
      const group = groups.find((candidate) => candidate.viewColumn === column)
      assert.ok(group, `No editor group at column ${column}`)
      const previousGroup = activeTabGroup
      activeTabGroup = group
      staleNamedGroup = undefined
      keyboardOnBody = false
      // A group the learner clicks into becomes the active one, which the editor announces as a change of the tab groups, as its numbered focus commands do.
      if (previousGroup !== group)
        changedGroups({
          opened: [],
          closed: [],
          changed: [previousGroup, group],
        })
      activeTextEditorChanged(focusedSourceEditor())
    },
    /** The text an open virtual document holds right now, as the editor's document model keeps it (not what the provider would serve); `undefined` when no such document is open. @example harness.documentTextOf(slotUri) // => 'const nextTheme = "dark";\n' */
    documentTextOf: (uri: string): string | undefined =>
      virtualSourceDocuments.get(uri)?.text,
    /** Tells the listeners of the editor's `onDidChangeVisibleTextEditors`, as the editor does when a group shows another tab; the fake editor tells them itself for the reader's own shows and closes. @example harness.fireVisibleEditorsChanged() */
    fireVisibleEditorsChanged: changedVisibleEditors,
    /** Makes the editor answer the next request to close a whole group with `false` and keep that group, empty or not, as it does when it refuses the close (finding 598). @example harness.refuseNextGroupClose() */
    refuseNextGroupClose(): void {
      refusesNextGroupClose = true
    },
    /**
     * Holds the editor's answer to the next request to close a whole group until the test releases it, before the editor acts on the request (and before `refuseNextGroupClose` refuses it), so a test can move the learner's keyboard while a close is pending.
     * @returns The entered receipt and the release callback for that one request.
     * @example const close = harness.holdNextGroupClose(); await close.started; harness.focusMutableDraft('auth.ts', 3); close.release()
     */
    holdNextGroupClose() {
      let entered!: () => void, release!: () => void
      const started = new Promise<void>((resolve) => {
          entered = resolve
        }),
        wait = new Promise<void>((resolve) => {
          release = resolve
        })
      heldGroupClose = { entered, wait }
      return { started, release }
    },
    /**
     * Shows the document of a captured-source tab that `restoreLeftoverCapturedSource` restored without a text editor in a text editor, as the editor would once it resolves that document with this host's provider: the text editor is visible while the tab is in front of its group, and it is the active text editor while that group is the active one. No native trace shows when an editor does this for a restored tab; a test uses it for the captured source a group shows by itself, with no click of the learner's.
     * @param tab - The restored tab, which has no text editor yet.
     * @example harness.resolveRestoredCapturedSource(harness.restoreLeftoverCapturedSource({ column: 1 }))
     */
    resolveRestoredCapturedSource(tab: Tab): void {
      const editor = unresolvedRestoredSources.get(tab)
      assert.ok(editor)
      unresolvedRestoredSources.delete(tab)
      visibleSourceEditors.push(editor)
      activeTextEditorChanged(focusedSourceEditor())
    },
    /**
     * Keeps the active text editor the editor reports now through the learner's later clicks on tabs, as an editor whose report lags behind a tab the learner selects: the tab model names the selected tab in front of the group that has the keyboard while the active text editor is still the one of before (CR2-1 of Cycle 0047 row 128).
     * @returns A callback that ends only this retained report; it emits no active-editor event.
     * @example const release = harness.retainActiveTextEditorReport(); harness.focusOpaqueTab(otherSource); release()
     */
    retainActiveTextEditorReport(): () => void {
      const retained = { value: focusedSourceEditor() }
      partialFocusEditor = retained
      return (): void => {
        // A newer retained report must survive the end of this one.
        if (partialFocusEditor === retained) partialFocusEditor = undefined
      }
    },
    /** Gives focus to a tab of the editor that is already open, as a learner's click on its tab does: a non-text page, or a captured source's tab, whose text editor, when it has one, is then the active text editor. @example harness.focusOpaqueTab(harness.addOpaqueTab('Extension page', 2)) */
    focusOpaqueTab(tab: Tab): void {
      const group = groups.find((group) => group.tabs.includes(tab))
      assert.ok(group)
      group.activeTab = tab
      activeTabGroup = group
      leaveChatForMainEditor()
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
    /**
     * Opens VS Code's chat as an editor tab of a main editor group (Chat: Open Chat in Editor) and gives its input the keyboard the way that editor reports it: the chat's group is the active tab group, the chat tab is its active tab, and no text editor is active, since the chat input is a simple widget the extension host does not list (1.140.0 `workbench.desktop.main.js` 705:2504, 705:3225, 699:43439).
     * @param column - The view column of the group the chat tab opens in.
     * @param label - The tab's label: the chat session's title, `Chat` for a new one (705:42742).
     * @returns The chat tab.
     * @example const chat = harness.focusChatEditorTab(2)
     */
    focusChatEditorTab(column: number, label = 'Chat') {
      const group = groups.find((candidate) => candidate.viewColumn === column)!
      const tab = {
        input: new TabInputChat(),
        label,
        isPreview: false,
        isDirty: false,
      }
      group.tabs.push(tab)
      group.activeTab = tab
      activeTabGroup = group
      leaveChatForMainEditor()
      keyboardOnBody = false
      keyboardInView = false
      innerFocusedPanel = undefined
      for (const listener of tabChangeListeners) listener()
      activeTextEditorChanged(undefined)
      return tab
    },
    /**
     * Opens a terminal in the editor area of a group and gives it the keyboard, as the learner's Terminal: Create Terminal in Editor Area or a click on such a tab does: its tab (`TabInputTerminal`) is the one its group shows, the group is the active one and named by the group event both editors send (Cursor's rebuild names it, as the main editor is the active part again), and no text editor is active (Cycle 0046 row 714).
     * With `keepsTextEditorReport` the text editor that had the keyboard stays reported as the active text editor until another group or tab is the active one, as `focusWebviewTabKeepingTextEditorReport` models it for an editor that is no code editor (rows 659 and 671), here also beside Cursor's chat part (row 727).
     * @param column - The view column of the group.
     * @param keepsTextEditorReport - Whether the text editor that had the keyboard stays reported.
     * @returns The terminal's tab.
     * @example harness.focusEditorTerminal(2) // the terminal in front of group 2 has the keyboard, and group 2 is named
     */
    focusEditorTerminal(column: number, keepsTextEditorReport = false): Tab {
      return focusEditorAreaTab(
        new TabInputTerminal(),
        'bash',
        column,
        keepsTextEditorReport,
      )
    },
    /**
     * Opens an editor whose tab the host gives no input (VS Code 1.142's Settings editor, its Keyboard Shortcuts editor: the workbench sends them as kind 0, unknown) in a group and gives it the keyboard, as the learner's Preferences: Open Settings (UI) or Open Keyboard Shortcuts does: as `focusEditorTerminal` does for a terminal, with a tab whose input is of no editor's kind, like Cursor's chat tab (Cycle 0046 AD29). A merge editor has an input at runtime: `focusMergeEditor`.
     * @param label - The tab's label: `Settings` or `Keyboard Shortcuts`.
     * @param column - The view column of the group.
     * @param keepsTextEditorReport - Whether the text editor that had the keyboard stays reported, as VS Code reports it behind an editor that is no code editor (rows 659 and 671).
     * @returns The editor's tab.
     * @example harness.focusEditorWithoutTabInput('Settings', 3, true) // Settings in front of group 3 has the keyboard, and login-form.tsx stays reported
     */
    focusEditorWithoutTabInput(
      label: string,
      column: number,
      keepsTextEditorReport = false,
    ): Tab {
      return focusEditorAreaTab(
        new TabInputUnknown(),
        label,
        column,
        keepsTextEditorReport,
      )
    },
    /**
     * Opens a merge editor of a file in a group, a new group of its own when that column has none yet (the merge editor opened to the side), and gives it the keyboard, as the learner's Merge Editor open does: its tab's input is `TabInputTextMerge`, which both editors' extension hosts build at runtime although the API's typings do not name it, and no text editor is active (Cycle 0046 Q7).
     * @param filename - The merged file, in the harness's folder; the tab's label is `Merging: <file>`.
     * @param column - The view column of the group.
     * @returns The merge editor's tab.
     * @example harness.focusMergeEditor('auth.ts', 3) // Merging: auth.ts stands alone in a new group 3, with the keyboard
     */
    focusMergeEditor(filename: string, column: number): Tab {
      const uri = Uri.file(join(harness.directory, filename))
      // A merge editor opened to the side opens its own group first.
      nativeGroup(column)
      return focusEditorAreaTab(
        new TabInputTextMerge(uri, uri, uri, uri),
        `Merging: ${filename}`,
        column,
        false,
      )
    },
    /**
     * Opens a new empty group right of the main editor's last group and gives it the keyboard, as the learner's `workbench.action.newGroupRight` from that group does in Cursor 3.23.12 (root's probe of 2026-10-18): the editor names the new group in its own column, which shows no tab (`activeTab` undefined, no tabs), reports no active text editor, and the page focus is in the empty group's container, which this model counts as the page body; the tab and group listeners are told (Cycle 0046 rows 714 and 727).
     * @param column - The new group's view column, the one after the main editor's last group.
     * @param keepsTextEditorReport - Keeps the text editor that had the keyboard reported as the active one while the new empty group is the active group, as Cursor 3.23.12 kept it after a new group until a tab stood in front of it (row 710's `keepTextEditorReportAfterNewGroup`; Cycle 0046 AD29).
     * @returns The new empty group.
     * @example harness.focusEmptyGroup(4) // a new empty group in column 4 is named, and no text editor is active
     */
    focusEmptyGroup(column: number, keepsTextEditorReport = false) {
      const lastMainColumn = Math.max(
        ...groups
          .filter((group) => group !== separateEditorPart?.group)
          .map((group) => group.viewColumn),
      )
      assert.equal(
        column,
        lastMainColumn + 1,
        'The new group stands right of the main editor’s last group',
      )
      const reported = keepsTextEditorReport ? focusedSourceEditor() : undefined
      assert.ok(
        !keepsTextEditorReport || reported,
        'No text editor has the keyboard before the new group',
      )
      leaveChatForMainEditor()
      keyboardOnBody = true
      keyboardInView = false
      innerFocusedPanel = undefined
      // The kept report holds before any listener hears of the new group.
      if (reported) textEditorKeptAtNewGroup = { column, editor: reported }
      const group = nativeGroup(column, false, true)
      for (const listener of tabChangeListeners)
        listener({ opened: [], closed: [], changed: [] })
      if (!reported) activeTextEditorChanged(undefined)
      return group
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
    /**
     * Opens a page that is no text editor in a new group right of the main editor's last one without giving it the keyboard, as an extension's editor that opens beside with `preserveFocus` does: the editor names one group more, the group and the text editor that had the keyboard keep it, and the editor announces the new group and its tab (Cycle 0047 row 151).
     * @param label - The page's title.
     * @returns The page's tab, in front of the new group.
     * @example const page = harness.openPageInNewGroup('Extension page') // in column 3 beside two groups
     */
    openPageInNewGroup(label: string): Tab {
      const lastMainColumn = Math.max(
        ...groups
          .filter((group) => group !== separateEditorPart?.group)
          .map((group) => group.viewColumn),
      )
      const group = nativeGroup(lastMainColumn + 1)
      const tab: Tab = {
        input: new TabInputUnknown(),
        label,
        isPreview: false,
        isDirty: false,
      }
      group.tabs.push(tab)
      group.activeTab = tab
      for (const listener of tabChangeListeners)
        listener({ opened: [tab], closed: [], changed: [] })
      return tab
    },
    addTextPreview(path: string, column: number, dirty = false) {
      const tab = {
        input: new TabInputText(Uri.file(path)),
        label: textTabLabel(Uri.file(path)),
        isPreview: true,
        isDirty: dirty,
      }
      groups.find((group) => group.viewColumn === column)!.tabs.push(tab)
      return tab
    },
    /**
     * Opens a learner's non-text preview tab (an image or a custom editor) in a group, as the tab the group shows; the editor keeps it with its own `workbench.action.keepEditor` while that group has the focus.
     * @param label - The tab's title.
     * @param column - The view column of the group.
     * @param isFront - Whether the tab is the one the group shows; a preview behind another tab cannot be kept by the command.
     * @returns The tab.
     * @example const image = harness.addNonTextPreview('diagram.png', 1)
     */
    addNonTextPreview(label: string, column: number, isFront = true) {
      const tab: Tab = {
        input: new TabInputUnknown(),
        label,
        isPreview: true,
        isDirty: false,
      }
      const group = groups.find((group) => group.viewColumn === column)!
      group.tabs.push(tab)
      if (isFront) group.activeTab = tab
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
        label: textTabLabel(uri),
        isPreview: true,
        isDirty: Boolean(options.dirty),
        isPinned: Boolean(options.pinned),
      }
      groups.find((group) => group.viewColumn === column)!.tabs.push(tab)
      return tab
    },
    /**
     * Rebuilds native group and tab wrappers for the workspace identity regressions.
     * @param change - An optional real layout/lifecycle change accompanying the wrapper refresh.
     * @param preserveEmpty - Keep originally empty groups empty during the refresh.
     * @param preserveLabels - Keep native labels for a refresh that changes no logical tab.
     * @param appendColumn - Native destination for the appended tab; omitted retains the first listed group's behavior.
     * @example harness.resyncEditorGroups(undefined, false, true)
     */
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
      preserveLabels = false,
      appendColumn?: number,
    ): void {
      // Give each fake group a distinct stable input, like the actual singleton panels/native source tabs.
      for (const group of groups)
        if (!group.tabs.length && change !== 'empty' && !preserveEmpty)
          group.tabs.push({
            input: new TabInputText(Uri.file(`/group-${group.viewColumn}`)),
            label: `group-${group.viewColumn}`,
          })
      const previous = [...groups]
      const refreshedTabs = new Map<Tab, Tab>()
      /** Gives a tab the new input wrapper of its own kind that a full tab-model resync reports. @example resyncedInput(new TabInputText(uri)) // => another TabInputText of the same uri */
      const resyncedInput = (input: Tab['input']): Tab['input'] => {
        if (input instanceof TabInputText) return new TabInputText(input.uri)
        if (input instanceof TabInputWebview)
          return new TabInputWebview(input.viewType)
        if (input instanceof TabInputChat) return new TabInputChat()
        return new TabInputUnknown()
      }
      groups.splice(
        0,
        groups.length,
        ...groups.map((group) => {
          const replacement = {
            ...group,
            tabs: group.tabs.map((tab) => {
              const refreshed = {
                ...tab,
                label: preserveLabels ? tab.label : 'Recorded application',
                input: resyncedInput(tab.input),
              }
              refreshedTabs.set(tab, refreshed)
              return refreshed
            }),
          }
          // A replace reports each group closed and its copy opened: another group, which a late report must not reach.
          return change === 'replace'
            ? replacement
            : replacedBy(group, replacement)
        }),
      )
      // A full tab-model resync changes API objects, never the native webview handle that later reveal and dispose operate on.
      for (const current of panels) {
        const refreshed = refreshedTabs.get(current.nativeTab)
        if (refreshed) current.refreshTabWrapper(refreshed)
      }
      // The native active tab/group stay the same while their API wrappers change.
      for (const group of groups)
        if (group.activeTab)
          group.activeTab =
            refreshedTabs.get(group.activeTab) ?? group.activeTab
      activeTabGroup =
        groups[previous.indexOf(activeTabGroup)] ?? activeTabGroup
      for (const editor of visibleSourceEditors)
        editor.group = groups[previous.indexOf(editor.group)] ?? editor.group
      // Full-model replacement keeps the same separate part behind its newly reported native wrapper.
      if (separateEditorPart) {
        separateEditorPart.group =
          groups[previous.indexOf(separateEditorPart.group)]!
        separateEditorPart.tab =
          refreshedTabs.get(separateEditorPart.tab) ?? separateEditorPart.tab
      }
      if (change === 'move') {
        const first = groups[0]!.tabs
        groups[0]!.tabs = groups[1]!.tabs
        groups[1]!.tabs = first
      }
      if (change === 'append') {
        const destination = groups.find(
          (group) =>
            group.viewColumn === (appendColumn ?? groups[0]?.viewColumn),
        )
        assert.ok(
          destination,
          'The appended native tab needs an existing group',
        )
        destination.tabs.splice(1, 0, {
          input: new TabInputText(Uri.file('/learner-added-notes.txt')),
          label: 'learner-added-notes.txt',
        })
      }
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
      // An opened replacement is another group; the others keep the group's identity.
      if (change !== 'opened') replacedBy(previous, replacement)
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
    /**
     * Makes the fake recorded viewport drop its preview frames, as the real one does while a required frame is queued behind one in flight (`FrameDelivery.offer` refuses a frame then), until the test lifts it.
     * @param isPending - `true` while a required frame is pending; `false` lifts it.
     * @example harness.holdRequiredFramePending(true)
     */
    holdRequiredFramePending(isPending: boolean): void {
      requiredFramePending = isPending
    },
    /**
     * Makes the fake recorded viewport drop its preview frames, as the real one does while a pause image is pinned (`FrameDelivery.accepts` takes only required frames when frozen), until the test lifts it.
     * @param isPinned - `true` while a pause image is pinned; `false` lifts it.
     * @example harness.holdPausePinned(true)
     */
    holdPausePinned(isPinned: boolean): void {
      pausePinned = isPinned
    },
    /**
     * Makes the fake recorded viewport drop its preview frames, as the real one does while its delivery has no renderer epoch (`FrameDelivery.accepts` is false after a suspended renderer and before the next handshake), until the test lifts it.
     * @param isMissing - `true` while the renderer has no epoch; `false` lifts it.
     * @example harness.holdRendererEpochMissing(true)
     */
    holdRendererEpochMissing(isMissing: boolean): void {
      rendererEpochMissing = isMissing
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
    /** Holds a native document open for reader race tests, optionally after unrelated citation opens have passed. @param options - An exact URI limits the hold to that input. @example const held = harness.holdNextSource({ uri: sourceUri }); await held.started; held.release() */
    holdNextSource(options?: { uri: string }) {
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
      nextOpen = { wait, entered, uri: options?.uri }
      return { started, release, reject }
    },
    /** Holds delivery of the next provider result to its existing native document model for source-readiness races. @returns The actual delivery-start receipt and its release. @example const held = harness.holdNextSourceUpdate(); await held.started; held.release() */
    holdNextSourceUpdate() {
      let release = (): void => {},
        entered = (): void => {}
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      const wait = new Promise<void>((resolve) => {
        release = resolve
      })
      nextSourceUpdate = { wait, entered }
      return { started, release }
    },
    async close(): Promise<void> {
      await reader.retire(harness.service)
      for (const wiki of repositoryWikiReaders.splice(0)) await wiki.dispose()
      // Teardown releases exact fixture panel handles after assertions; intentionally ambiguous/duplicate inputs must not be mistaken for a successful product Close.
      for (const current of [...panels]) current.dispose()
      await reader.dispose()
      // The fake editor of a closed harness changes nothing any more: its pending tab closes and reveals are dropped with their timers.
      for (const timer of pendingEditorTimers) clearTimeout(timer)
      pendingEditorTimers.clear()
      pendingDisposedTabCloses.length = 0
      await harness.close()
      // The host only logs a throwing listener; the fake keeps the error and hands it to the afterEach hook, which fails the test that caused it without replacing that test's own failure. Handed over once: a second close adds nothing.
      if (!visibleEditorListenerErrorsExpected)
        unreportedListenerErrors.push(...visibleEditorListenerErrors)
      visibleEditorListenerErrors.length = 0
    },
    /** Declares that the test makes a listener of `onDidChangeVisibleTextEditors` throw on purpose (the fidelity test of the isolation), so `close` does not fail it. @example harness.expectVisibleEditorListenerErrors() */
    expectVisibleEditorListenerErrors(): void {
      visibleEditorListenerErrorsExpected = true
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
  const harness = await workspaceHarness(false)
  // A one-group native workspace starts in column One; the geometry-free default's column Two would invent an empty third group during live entry.
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  const directory = await realpath(harness.directory),
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

/**
 * Starts each actual-Return regression from a saved recording and the learner's native two-row article layout; `recordedDebugger` also attaches captured native debugger state to its stop.
 * Its Return to Wiki restores the learner's layout only ({@link StudyWorkspace.arrangeRepository}) beside a Wiki tab no reader owns, so the tabs it leaves are not the editors': a test of those tabs opens the article in a real Repository Wiki reader first with `openRepositoryWiki`, whose open the Return then runs as the extension's does (Cycle 0046 row 703).
 * @param capturedApplication - Also retain a real paused-browser PNG checkpoint ({@link recordedReaderHarness}).
 * @param recordedDebugger - Present the recorded stop through the historical debugger ({@link recordedReaderHarness}).
 * @returns The recorded reader's harness with the article's `binding` and `origin`, and `openRepositoryWiki`.
 * @example
 * ```ts
 * const harness = await articleRecordingLayoutHarness()
 * await harness.openRepositoryWiki() // the Return now shows the cited copy and gives the Wiki the keyboard
 * ```
 */
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
    /** The book store {@link openRepositoryWiki} published the article with; the harness's `close` disposes it. */
    let books: RepositoryBookStore | undefined
    /**
     * Opens the learner's article in a real Repository Wiki reader in place of the fixture's Wiki tab, and makes the Study's Return to Wiki open it again as the extension does (`extension.ts`: `returnToRepository` runs the reader's `open(selection, undefined, true, preserveNativeInput)`), for a test of the tabs the article Return leaves (Cycle 0046 row 703).
     * Without it the Return only restores the learner's layout ({@link StudyWorkspace.arrangeRepository}): the real one then shows the article's cited copy again in front of the first group without the keyboard (`load` → `revealSource`) and reveals the Wiki with the keyboard (`revealReadyPanel` → `activateReadyPanel`), which C60's `c60-cu-567` read in Cursor 3.23.12 as the cited copy in front of the learner's first group and the Repository Wiki in front of the active group. The harness's folder becomes a Git repository whose `app/login-form.tsx` the article cites, as that round's article did; the cited copy opens right after the tab in front of the first group with the keyboard, and the Wiki in the second group with the keyboard, right after the tab that group shows.
     * @returns The reader, whose `open` the Return runs from now on.
     * @throws What the reader's first open is refused with.
     * @example const wiki = await harness.openRepositoryWiki() // login-form.tsx's cited copy in front of the first group, the Wiki in front of the second with the keyboard
     */
    const openRepositoryWiki = async () => {
      // The fixture's Wiki tab has no reader: the real reader's own tab takes its place.
      for (const group of harness.groups) {
        group.tabs = group.tabs.filter(
          (tab) =>
            Reflect.get(tab.input, 'viewType') !== 'codebook.repositoryWiki',
        )
        if (group.activeTab && !group.tabs.includes(group.activeTab))
          group.activeTab = group.tabs.at(-1)
      }
      harness.announceTabChange()
      const directory = await realpath(harness.directory),
        git = promisify(execFile)
      await git('git', ['init', '--quiet', directory])
      await mkdir(join(directory, 'app'), { recursive: true })
      await writeFile(
        join(directory, 'app/login-form.tsx'),
        'export function LoginForm() {\n  return null\n}\n',
      )
      await git('git', ['add', '--', 'app'], { cwd: directory })
      const sources = new RepositorySourceService(directory)
      books = new RepositoryBookStore(sources, library)
      const citedSource = await sources.read('app/login-form.tsx')
      await books.publish({
        bookId: origin.bookId,
        key: 'article-return-wiki',
        expectedRevision: 0,
        document: {
          title: 'Architecture',
          summary: 'Source-derived architecture.',
          nodes: [
            {
              id: origin.nodeId,
              title: 'Failed login, form body',
              sections: [
                { title: 'Form', text: 'The form posts the credentials.' },
                { title: 'Failure', text: 'A wrong password shows an error.' },
              ],
              anchors: [
                {
                  path: citedSource.path,
                  hash: citedSource.hash,
                  startLine: 1,
                  endLine: 1,
                },
              ],
              observations: [],
            },
          ],
          edges: [],
        },
      })
      const wiki = harness.createRepositoryWikiReader()
      await wiki.open(origin)
      // The reader passes whether the Return keeps the native input: `false` for the Learning summary's button, `true` for a command (`StudyWorkspace.action`'s `fromPane`).
      harness.controls.returnToRepository = (
        selection: RepositorySelection,
        preserveNativeInput?: boolean,
      ): Promise<void> =>
        wiki.open(selection, undefined, {
          restoreReadingLayout: true,
          preserveNativeInput,
        })
      return wiki
    }
    return {
      ...harness,
      library,
      binding,
      origin,
      openRepositoryWiki,
      async close(): Promise<void> {
        await books?.dispose()
        await harness.close()
      },
    }
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
    /** Says whether the reader stands in the summary composition (the Learning summary in the chat's place, the Study pane closed), as an entry of a test replay leaves it. @example readerSeams(harness).isSummaryArrangement() // => false after a refused entry left it */
    isSummaryArrangement: (): boolean => reader['summaryComposition'],
    /** Says whether an agent's next request would read the keyboard's place as the learner's own (no Codebook pane active): the reading of rows 613 and 654 that decides whether the request gives the keyboard back or keeps it and tells where it is. @example readerSeams(harness).knowsLearnersPlace() // => false right after the reader's render of a pause gave the captured source the keyboard */
    knowsLearnersPlace: (): boolean => reader['knowsLearnersPlace'](undefined),
    /** Reads the main editor's layout without borrowing focus, as the presentation state's confirmation does ({@link StudyWorkspace.readPassivePresentationLayout}): the layout, or `undefined` when the read cannot tell that the main editor answered. @example await readerSeams(harness).readPassiveLayout() // => undefined while VS Code's floating window of text editors is the focused one */
    readPassiveLayout: (): Promise<unknown> =>
      reader['readPassivePresentationLayout'](),
    /** Measures the main editor as an arrangement does before its effects ({@link StudyWorkspace.readMainEditorGrid}), and names the view columns of the groups it measured as the main editor's. @example await readerSeams(harness).measureMainEditorGrid() // => [1] beside VS Code's floating window */
    measureMainEditorGrid: async (): Promise<number[]> =>
      // The reader's arrays come from its own module context; the test compares an array of its own.
      Array.from(
        (await reader['readMainEditorGrid'](undefined, () => {})).groups,
        (group) => group.viewColumn,
      ),
    /** Measures the main editor as {@link measureMainEditorGrid} does, with a caller that refuses the announced focus before the first group is focused, as the reader's own focus watch does when the learner left or a borrow is pending. @example await readerSeams(harness).measureMainEditorGridRefusedBeforeFocus() // rejects with the caller's refusal */
    measureMainEditorGridRefusedBeforeFocus: (): Promise<unknown> =>
      reader['readMainEditorGrid'](
        undefined,
        () => {},
        undefined,
        () => {
          throw new Error('refused before the focus command')
        },
      ),
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

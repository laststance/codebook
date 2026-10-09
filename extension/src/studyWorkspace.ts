import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import * as vscode from 'vscode'
import { z } from 'zod'

import {
  AGENT_STORAGE_DIRECTORY,
  APPLICATION_PANE_CLOSED_MESSAGE,
  CHOICE_RETIRED_ERROR_KINDS,
  CLOSE_GROUP_SETTLE_MS,
  HIDDEN_SIDE_BAR_MIN_GAIN_PX,
  HORIZONTAL_EDITOR_ORIENTATION,
  LEARNER_SELECTION_KINDS,
  LEARNER_SIGN_FRESH_MS,
  LEARNER_STARTED_STOP_REASONS,
  LIVE_EDITOR_GROUP_COUNT,
  LIVE_EDITOR_LAYOUT,
  CONTROL_RETIRING_MESSAGE_TYPES,
  CURSOR_FOCUS_AGENT_COMMAND,
  MAIN_THREAD_WEBVIEW_PREFIX,
  MAX_DEFERRED_OPEN_REPLIES,
  MAX_SOURCE_DOCUMENTS,
  NODE_TEST_PROFILE,
  MILLISECONDS_PER_SECOND,
  NATIVE_RUN_AND_DEBUG_VIEW_COMMAND,
  OPEN_REPLAY_RESULT_WAIT_MS,
  PANE_TOOK_CHOSEN_EDITOR_FOCUS_MESSAGE,
  PAUSE_FOCUS_LOOKBACK_MS,
  EDITOR_FOCUS_PASS_DELAY_MS,
  STOP_OWN_FOCUS_BOUND_MS,
  PRESENTATION_PREFERENCE_KEY,
  PRESENTATION_PREFERENCE_VERSION,
  PRESENTATION_READY_TIMEOUT_MS,
  PRESENTATION_SETTLE_CEILING_MS,
  READER_CLOSE_STORAGE_TIMEOUT_MS,
  type ReaderErrorKind,
  RECORDING_WINDOW_FOCUS_WAIT_MS,
  REPLAY_COVERED_LABEL,
  REPLAY_VIEWPORT_RECEIPT_LIMIT,
  REPOSITORY_BROWSER_PROFILE,
  REPOSITORY_MIN_EDITOR_GROUP_COUNT,
  REPOSITORY_READER_DEBOUNCE_MS,
  REPOSITORY_SOURCE_LIMIT_BYTES,
  SAVED_STUDY_LIMIT_SETTING,
  SHOW_NATIVE_VARIABLES_COMMANDS,
  SHOW_NATIVE_VARIABLES_EXPAND_ATTEMPTS,
  SHOW_NATIVE_VARIABLES_MANUAL_STEP,
  SHOW_NATIVE_VARIABLES_SCOPES_TIMEOUT_MS,
  SHOW_NATIVE_VARIABLES_VALUES_WAIT_MS,
  RUN_CLOSED_PANE_KEYBOARD_MESSAGE,
  SOURCE_TOOK_PAUSED_FOCUS_MESSAGE,
  STUDY_CLOSE_KEYBOARD_MESSAGE,
  STUDY_EDITOR_AREA_LOOK_INTERVAL_MS,
  STUDY_EDITOR_GROUP_COUNT,
  STUDY_LAYOUT_STABLE_MISMATCH_MS,
  STUDY_PRESENTATIONS,
  STUDY_REFRESH_INTERVAL_MS,
  STUDY_REMOVAL_REFUSALS,
  STUDY_REMOVAL_REFUSALS_WITHOUT_TRASH,
  STUDY_REMOVAL_WITHOUT_TRASH_MESSAGE,
  STUDY_SOURCE_SCHEME,
  SUMMARY_DISPLACED_OFFER,
  SUMMARY_FOCUS_RELEASE_WAIT_MS,
  SUMMARY_PLACEMENT_ACTION,
  SUMMARY_PLACEMENT_ANSWERED_KEY,
  SUMMARY_PLACEMENT_CONTEXT_KEY,
  SUMMARY_PLACEMENT_OFFER,
  UNMAXIMIZE_FOCUS_SETTLE_MS,
  UNRETRYABLE_READER_ERROR_KINDS,
  UNSAVED_STUDY_HANDED_OVER_REASON,
  UNSAVED_UNDERSTANDING_WAITS_MESSAGE,
} from './constants'
import { requireWorkspace, type StudyPresentation } from './environment'
import { StudyError } from './errors'
import { learningItemSchema } from './identitySchemas'
import {
  repositorySelectionSchema,
  type RepositorySelection,
} from './learnerSchemas'
import { LearningLibrary, type StudyRemoval } from './learningLibrary'
import type {
  NodeTestHistoryIndex,
  NodeTestHistoryLearningDecision,
  NodeTestLearningMaterial,
} from './nodeTestHistorySchemas'
import { NodeTestHistoryStore } from './nodeTestHistoryStore'
import {
  PlaybackController,
  type PlaybackBundle,
  type PlaybackData,
} from './playbackController'
import {
  presentationModeSchema,
  presentationPreferenceSchema,
  presentationPoseSchema,
  presentationPoseRestoredSchema,
  presentationPoseInvalidatedSchema,
  type PresentationIntent,
  type PresentationMode,
  type PresentationState,
  type PresentationPose,
  type PresentationPoseCapture,
  type PresentationPoseRestore,
  type ReturnCurrentIntent,
} from './presentationSchemas'
import { RecordingStore } from './recordingStore'
import {
  ReplayDebugger,
  type ReplayDebuggerChange,
  type ReplayInspection,
} from './replayDebugger'
import type { ReplayDebugSnapshot } from './replayDebugSchemas'
import type {
  RepositoryFocusTarget,
  RepositoryLayoutFocus,
} from './repositoryReader'
import type { BookObservationBinding } from './repositorySchemas'
import { RepositorySourceService } from './repositorySource'
import {
  retainedStudySelectionSchema,
  type RetainedStudy,
  type RetainedStudySelection,
} from './retainedStudySchemas'
import type { RuntimeParticipant, RuntimeView, StudyRuntime } from './runtime'
import { BrowserViewport } from './runtimeSupport/browserViewport'
import {
  CAPTURE_TIMEOUT_MS,
  KEYBOARD_OWNER_ANSWER_TIMEOUT_MS,
  VIEWPORT_ACK_TIMEOUT_REASON,
} from './runtimeSupport/constants'
import { awaitResponse } from './runtimeSupport/utils/awaitResponse'
import { debugStopOf } from './runtimeSupport/utils/debugStopOf'
import { isDebugResumeMessage } from './runtimeSupport/utils/isDebugResumeMessage'
import { isDebugStopsInvalidation } from './runtimeSupport/utils/isDebugStopsInvalidation'
import { isStackFrameItem } from './runtimeSupport/utils/isStackFrameItem'
import { sha256 } from './runtimeSupport/utils/sha256'
import { ViewportAckTimeoutError } from './runtimeSupport/utils/viewportAckTimeoutError'
import { WaitTimeoutError } from './runtimeSupport/utils/waitTimeoutError'
import { waitUntil } from './runtimeSupport/utils/waitUntil'
import { explainNodeHistorySchema } from './schemas'
import type {
  StudyRecord,
  StudyRemovalExclusion,
  StudyService,
} from './service'
import {
  projectStudy,
  studyIdSchema,
  type LearnerDecision,
  type LearnerProgress,
  type SourceBaselines,
  type CitationSourceStates,
} from './studyModel'
import { itemSchema, type StudyCatalogEntry } from './studySchemas'
import {
  studyHtml,
  type StudyFilesCopied,
  type StudyRemovalView,
  type StudyViewMessage,
} from './ui/studyHtml'
import { bookObservationHash } from './utils/bookObservationHash'
import { capturedAppHtml } from './utils/capturedAppHtml'
import { capturedSourceDeclaredPath } from './utils/capturedSourceDeclaredPath'
import { capturedSourceUriPath } from './utils/capturedSourceUriPath'
import { captureStudy } from './utils/captureStudy'
import { configuredObservationPosition } from './utils/configuredObservationPosition'
import { coveredSourceObstacle } from './utils/coveredSourceObstacle'
import { createRecordingObserver } from './utils/createRecordingObserver'
import { describeStudy } from './utils/describeStudy'
import {
  describeViewportDelivery,
  type ViewportDeliveryLog,
} from './utils/describeViewportDelivery'
import { editorAreaWidthPx } from './utils/editorAreaWidthPx'
import { editorLayoutGroupCount } from './utils/editorLayoutGroupCount'
import { evidenceInUseElsewhere } from './utils/evidenceInUseElsewhere'
import { focusEditorGroupCommand } from './utils/focusEditorGroupCommand'
import { focusWebview } from './utils/focusWebview'
import { foreignPreviewObstacle } from './utils/foreignPreviewObstacle'
import type { StudyRemovalAvailability } from './utils/fullLibraryMessage'
import { initialStudyRemovalAvailability } from './utils/initialStudyRemovalAvailability'
import { isBalancedEditorLayout } from './utils/isBalancedEditorLayout'
import { isCodebookPaneViewType } from './utils/isCodebookPaneViewType'
import { isCollapsedEditorGroup } from './utils/isCollapsedEditorGroup'
import { isCollapsedEditorLayout } from './utils/isCollapsedEditorLayout'
import {
  editorLayoutSchema,
  isProportionalEditorLayout,
} from './utils/isProportionalEditorLayout'
import { isSameEditorLayoutShape } from './utils/isSameEditorLayoutShape'
import { libraryHasRoom } from './utils/libraryHasRoom'
import { maximizedEditorAreaWidthPx } from './utils/maximizedEditorAreaWidthPx'
import { NodeHistoryPlaybackController } from './utils/nodeHistoryPlaybackController'
import { nodeStopSourceMatches } from './utils/nodeStopSourceMatches'
import { normalizeNativeSourceText } from './utils/normalizeNativeSourceText'
import { paneKeyboardTimeoutMessage } from './utils/paneKeyboardTimeoutMessage'
import { plannedStopLine } from './utils/plannedStopLine'
import { projectLearningSummary } from './utils/projectLearningSummary'
import { projectPlaybackStudy } from './utils/projectPlaybackStudy'
import {
  type OpenRequestSettled,
  openRequestNumberSchema,
  type PaneOpenRequest,
  readOpenRequest,
} from './utils/readOpenRequest'
import { readWebviewFocus } from './utils/readWebviewFocus'
import { recordingNotShownReason } from './utils/recordingNotShownReason'
import { retainEditorReadingPosition } from './utils/retainEditorReadingPosition'
import { savedStudyIdentityLine } from './utils/savedStudyIdentityLine'
import { selectStudy } from './utils/selectStudy'
import { settledWithin } from './utils/settledWithin'
import { showPlainNotice } from './utils/showPlainNotice'
import { studyEvidenceDirectory } from './utils/studyEvidenceDirectory'
import { studyRemovalMessages } from './utils/studyRemovalMessages'
import { tabWithoutEditorObstacle } from './utils/tabWithoutEditorObstacle'
import { thrownMessage } from './utils/thrownMessage'
import { toPixelEditorLayout } from './utils/toPixelEditorLayout'
import { unconfirmedCompositionRefusal } from './utils/unconfirmedCompositionRefusal'
import {
  type ChangedLayoutPart,
  unconfirmedLayoutReason,
} from './utils/unconfirmedLayoutReason'
import { unreportedEditorFocusObstacle } from './utils/unreportedEditorFocusObstacle'
import { untilAborted } from './utils/untilAborted'
import { withoutErrorName } from './utils/withoutErrorName'
import { withoutStudy } from './utils/withoutStudy'
import { webviewFocusReceiptSchema } from './webviewFocusSchemas'

const actionSchema = z.enum([
  'run',
  'click',
  'continue',
  'stop',
  'connect',
  'return-current',
  'return-wiki',
  'open-article',
  'source',
  'current-file',
  'focus-app',
  'focus-context',
  'read-app',
  'read-source',
  'read-context',
  'enlarge-app',
  'enlarge-context',
  'outline',
  'arrange',
  'retry',
  'reload-recording',
  'show-variables',
])
/** When {@link StudyWorkspace} offers Cursor's learner the Move View step for the Learning summary: after the summary was shown, or after Show Variables put Run and Debug in its place. */
type SummaryPlacementOccasion = 'summary-shown' | 'summary-displaced'
/** What the Move View offer says on each occasion. */
const SUMMARY_PLACEMENT_OFFER_TEXTS: Record<SummaryPlacementOccasion, string> =
  {
    'summary-shown': SUMMARY_PLACEMENT_OFFER,
    'summary-displaced': SUMMARY_DISPLACED_OFFER,
  }
const FIRST_REPLAY_POSITION_WARNING =
  'Wait for the first confirmed replay position before selecting a presentation.'
const revisionShape = { revision: z.number().int().nonnegative() }
// The number a Study pane gives its request to open a Saved studies entry; {@link StudyWorkspace.receivePaneMessage} answers it.
const openRequestShape = { openRequest: openRequestNumberSchema.optional() }
const NODE_HISTORY_READER_PAGE_SIZE = 20
const messageSchema = z.discriminatedUnion('type', [
  webviewFocusReceiptSchema,
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({
    type: z.literal('rendered'),
    ...revisionShape,
    itemId: learningItemSchema,
    snapshotUri: z.string().optional(),
    presentationRevision: z.number().int().nonnegative().optional(),
    presentationControlRevision: z.number().int().nonnegative().optional(),
    presentationMode: presentationModeSchema.optional(),
  }),
  presentationPoseSchema,
  presentationPoseRestoredSchema,
  presentationPoseInvalidatedSchema,
  z.strictObject({
    type: z.literal('action'),
    ...revisionShape,
    action: actionSchema,
  }),
  z.strictObject({
    type: z.literal('select'),
    ...revisionShape,
    itemId: learningItemSchema,
  }),
  z.strictObject({
    type: z.literal('tab'),
    ...revisionShape,
    tab: z.enum(['overview', 'live', 'recording']),
  }),
  z.strictObject({
    type: z.literal('playback'),
    ...revisionShape,
    action: z.enum(['play', 'pause', 'seek']),
    expectedRevision: z.number().int().nonnegative(),
    positionMs: z.number().finite().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('history'),
    ...revisionShape,
    studyId: studyIdSchema,
    ...openRequestShape,
  }),
  z.strictObject({
    type: z.literal('delete-study'),
    ...revisionShape,
    studyId: studyIdSchema,
    // The number the asking pane gave this delete request; every state of the removal it starts or is refused with echoes it.
    removalRequest: openRequestNumberSchema.optional(),
    // Set by a pane of a window without a Trash on a request for a study's files that it sends by itself, because its open "Remove by hand" follows the host; a request the learner made by opening the disclosure or pressing the delete button carries none.
    unprompted: z.literal(true).optional(),
  }),
  z.strictObject({
    type: z.literal('copy-study-files'),
    ...revisionShape,
    studyId: studyIdSchema,
  }),
  // A pane's document says when it gains and when it loses the keyboard focus; the reader keeps the Learning summary's last report.
  z.strictObject({ type: z.literal('pane-focus'), focused: z.boolean() }),
  z.strictObject({
    type: z.literal('node-history'),
    ...revisionShape,
    studyId: studyIdSchema,
    ...openRequestShape,
  }),
  z.strictObject({
    type: z.literal('node-history-understanding'),
    ...revisionShape,
    studyId: studyIdSchema,
    understood: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('node-history-material'),
    ...revisionShape,
    ...explainNodeHistorySchema.shape,
  }),
  z.strictObject({
    type: z.literal('node-history-page'),
    ...revisionShape,
    studyId: studyIdSchema,
    page: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('node-history-step'),
    ...revisionShape,
    studyId: studyIdSchema,
    direction: z.enum(['previous', 'next']),
  }),
  z.strictObject({
    type: z.literal('node-history-event'),
    ...revisionShape,
    studyId: studyIdSchema,
    sequence: z.number().int().positive(),
  }),
  z.strictObject({
    type: z.literal('node-history-stop'),
    ...revisionShape,
    studyId: studyIdSchema,
    sequence: z.number().int().positive(),
  }),
  z.strictObject({
    type: z.literal('node-history-playback'),
    ...revisionShape,
    studyId: studyIdSchema,
    action: z.enum(['play', 'pause', 'seek']),
    positionMs: z.number().finite().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('understanding'),
    ...revisionShape,
    understood: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('presentation'),
    ...revisionShape,
    presentationId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    mode: presentationModeSchema,
    action: z.enum(['select', 'restore', 'save-preference']),
  }),
])

/** The Saved studies list's choice of a saved study, as the Study pane sends it. @example const message: HistoryPaneMessage = { type: 'history', revision: 4, studyId } */
type HistoryPaneMessage = Extract<
  z.infer<typeof messageSchema>,
  { type: 'history' }
>
type WorkspaceContext = Pick<
  vscode.ExtensionContext,
  'extensionPath' | 'subscriptions'
> & {
  globalStorageUri: Pick<vscode.Uri, 'fsPath'>
  workspaceState: Pick<vscode.Memento, 'get' | 'update'>
}
// What the reader selects while no saved study is shown: at first start, and after the last study that could be opened was removed.
const NO_STUDY_SELECTION: RetainedStudySelection = {
  profile: 'repository-browser',
  itemId: 'repository/workspace/overview',
  follow: true,
  tab: 'overview',
}
/** What one close of the tabs an earlier host session left behind did, read from the editor's tab model after the editor answered. */
interface LeftoverTabClose {
  /** `true` when at least one of the requested tabs is gone. */
  closedAny: boolean
  /** Set when the tab that had focus was closed: the tab the editor activated in its place, `undefined` when its group is empty. */
  closedFocus?: { activatedTab: vscode.Tab | undefined }
  /** Documents of the captured-source tabs that closed; the active text editor may report one of them for a moment longer. */
  closedSourceUris: string[]
  /** `true` when a leftover captured-source tab is still in the window. */
  capturedSourceKept: boolean
  /** `true` when a dead Codebook pane is still in the window. */
  deadPaneKept: boolean
}

/**
 * A pause of the editor's debugger as the chat's record of {@link StudyWorkspace} notes it, from the stack frame that reported it until the next frame or the pause's end.
 * `openedByDebugger`: the document the debugger had opened with the keyboard when the frame was reported, `undefined` when no text editor was active then.
 * `state`: `'unsettled'` until the reader's first reveal at that pause, `'settling'` while its one return of the keyboard to the chat runs, `'settled'` after it: from then an editor that becomes active is the learner's choice or the next stop's paused file.
 * `returned`: that one return, from the moment it began: it resolves to whether the chat got the keyboard. Kept with the pause, because a second reveal of the same stop (the Application pane's, while the captured source's return runs) asks the same question and must get the same answer.
 */
/**
 * What {@link StudyWorkspace} notes of a stop a debug adapter reported, until the editor reports a stack frame of that session ({@link StudyWorkspace.cameWithStop}).
 * `readAtMs` is the moment the adapter's `stopped` event was read. `isDoubtful` says that the editor's own handling of that stop may not bring it to the front: the adapter asked to keep the focus where it is, or the session went on before a frame of it was reported. Such a stop counts only for a frame that arrives within {@link STOP_OWN_FOCUS_BOUND_MS}. `behindSessionId` names the other debug session whose frame had the focus when the stop was read, if any: the editor's handling skips a stop while such a frame is focused, and the stop counts only for a frame that arrives before the editor can pass the focus to it ({@link StudyWorkspace.cameBeforeFocusPass}).
 */
interface StopNote {
  readAtMs: number
  isDoubtful: boolean
  behindSessionId?: string
}

interface KeyboardPauseOfRecord {
  openedByDebugger: string | undefined
  state: 'unsettled' | 'settling' | 'settled'
  returned?: Promise<boolean>
}

/**
 * The keyboard notices the reader told in this editor session, each of them told once: `'close'` is {@link STUDY_CLOSE_KEYBOARD_MESSAGE}, `'pause'` is {@link SOURCE_TOOK_PAUSED_FOCUS_MESSAGE}, `'chosen'` is {@link PANE_TOOK_CHOSEN_EDITOR_FOCUS_MESSAGE}, `'runEnd'` is {@link RUN_CLOSED_PANE_KEYBOARD_MESSAGE}.
 * Kept with the module and not with a {@link StudyWorkspace}: the extension disposes its reader and makes a new one when the workspace folders change, and the extension host loads this module once, so the marks live as long as the host does.
 * @example
 * if (keyboardNoticesTold.has('close')) return
 * keyboardNoticesTold.add('close')
 */
const keyboardNoticesTold = new Set<'close' | 'pause' | 'chosen' | 'runEnd'>()

/**
 * Drops the empty groups at the end of a list of groups' tabs, for {@link StudyWorkspace}'s comparison of the learner's groups before an Open and after a Close: an editor that removes emptied groups takes those away with the panes, and the layout makes them again.
 * @param groups - The tabs of each group, in the layout's order.
 * @returns The list up to its last group that has a tab.
 * @example withoutTrailingEmpty([['a.ts'], [], ['b.ts'], []]) // => [['a.ts'], [], ['b.ts']]
 */
function withoutTrailingEmpty(groups: string[][]): string[][] {
  let end = groups.length
  while (end > 0 && groups[end - 1]!.length === 0) end--
  return groups.slice(0, end)
}

/**
 * Says whether a group still is the learner's group of before, by its tabs; the step of {@link StudyWorkspace}'s comparison for one group.
 * @param before - The learner's tabs the group held before the Open.
 * @param now - The learner's tabs it holds now.
 * @returns `true` when every tab of before is still there, and when the group was empty before and is empty now; `false` when a tab of before is gone, and for a group that was empty and has tabs now.
 * @example holdsTabsOfBefore(['a.ts'], ['a.ts', 'b.ts']) // => true
 */
function holdsTabsOfBefore(before: string[], now: string[]): boolean {
  return before.length === 0
    ? now.length === 0
    : before.every((key) => now.includes(key))
}

/**
 * A study archive a Study reader captured and could not save, with the run it was captured from and the checkpoint it answers.
 * A reader keeps these until Retry storage / refresh writes them; a reader that is disposed hands them on ({@link StudyWorkspace.releaseUnsavedStudies}) to the reader made after it, which takes them at its construction.
 */
export interface UnsavedStudyArchive {
  archive: RetainedStudy
  service: StudyService
  record: StudyRecord
  signature: string
  checkpointRevision: number
}

/** Owns the retained learner reader while {@link StudyService} owns execution; activation constructs it before MCP-first runs. @example await workspace.open() */
export class StudyWorkspace {
  private service?: StudyService
  private learningSaveItem?: vscode.StatusBarItem
  /** The command and study of the object last assigned to {@link learningSaveItem}'s `command`; {@link publishLearningSave} assigns a new object only when they change, because the host disposes the previous object's internal command at every assignment. */
  private learningSaveCommandKey?: string
  private learningSave?: {
    studyId: string
    status: 'saving' | 'saved' | 'partial' | 'failed'
    detail: string
    signature?: string
  }
  private learningSaveOperation?: Promise<void>

  private library?: LearningLibrary
  private recordings?: RecordingStore
  private nodeHistoryStore?: NodeTestHistoryStore
  private nodeHistoryCatalog: Awaited<
    ReturnType<NodeTestHistoryStore['list']>
  > = []
  private selectedNodeHistory?: NodeTestHistoryIndex
  private selectedNodeHistoryLearningDecision?: NodeTestHistoryLearningDecision
  private selectedNodeHistoryLearningMaterial?: NodeTestLearningMaterial
  private selectedNodeHistoryPage = 0
  private selectedNodeHistorySequence?: number
  private selectedNodeHistoryDebugAvailable = false
  /** The selected Node stop reached native Run and Debug without its values loading; the reader shows how to load them. */
  private selectedNodeHistoryValuesUninspected = false
  private selectedNodeHistoryRequest = 0
  private nodeHistoryPlaybackController?: NodeHistoryPlaybackController
  private playback?: PlaybackController
  private replayDebugger?: ReplayDebugger
  /** The disposal of replaced historical debuggers that is still running; the editor accepts the next owner only once it has settled. */
  private replayDebuggerRetirement?: Promise<void>
  private recordingActive = false
  private replayViewport?: BrowserViewport
  private replayNeedsReveal = false
  /** Why the latest {@link rememberLayout} read failed, so the layout line the learner reads names the cause; `undefined` when it settled. */
  private layoutReceiptFailure?: string
  private replayDelivery: ViewportDeliveryLog = { receipts: [], omitted: 0 }
  /** The replay paint phase in progress, from {@link beginReplayPaint} until its {@link endReplayPaint}. */
  private replayPaint?: { token: object; startedAt: number }
  /** {@link settleOwnedPlayback} waits that re-arm their paint bound whenever a paint phase begins or ends. */
  private readonly replayPaintWatchers = new Set<() => void>()
  private playbackPending?: PlaybackBundle
  private playbackPresentingReady = false
  /** Whether another tab of the Application pane's group is in front of the recorded application; the moment is then recorded and only hidden, so Run and Debug and the summary say that it is covered instead of "Not recorded" and "Loading". */
  private replayApplicationCovered = false
  /** The recorded stop committed before native Run and Debug loaded its values; every frame of that stop shows how to load them. */
  private replayUninspectedSnapshot?: ReplayDebugSnapshot
  private initializing?: Promise<void>
  private baselines?: SourceBaselines
  private currentSourceAvailable = true
  private repositorySources?: RepositorySourceService
  private citationSources?: CitationSourceStates
  private citationKey?: string
  private citationRevision = 0
  private citationRefreshTimer?: ReturnType<typeof setTimeout>
  private readonly citationWatchers: vscode.Disposable[] = []
  private repositoryOrigin?: { studyId: string; selection: RepositorySelection }
  private progress?: LearnerProgress
  private pendingDecision?: LearnerDecision
  private selection: RetainedStudySelection = { ...NO_STUDY_SELECTION }
  private activeArchive?: RetainedStudy
  private selectedArchive?: RetainedStudy
  private catalog: StudyCatalogEntry[] = []
  private readonly archiveSignatures = new Map<string, string>()
  private readonly historyReceipts = new Map<
    string,
    NonNullable<StudyRecord['historyReceipt']>
  >()
  private readonly loadedHistory = new Map<
    string,
    { signature: string; status: 'saved' | 'failed' }
  >()
  private readonly historyReads = new Map<string, number>()
  private readonly pendingArchives = new Map<string, UnsavedStudyArchive>()
  /** The archives a disposed reader of this window could not save, as the constructor took them, until {@link initialize} knows this reader's library ({@link queueHandedOverArchives}). What is left afterwards belongs to another workspace's library: it is never written here and is handed on again by {@link releaseUnsavedStudies}. */
  private handedOverArchives: UnsavedStudyArchive[]
  private readonly archiveWrites = new Map<string, Promise<void>>()
  /** The learner's last removal of a saved study, from its confirmation dialog to its outcome; while it is `moving`, its study is neither written nor opened. */
  private studyRemoval?: StudyRemovalView
  /** The files this reader listed for the removal by hand of saved studies in a window without a Trash, by study. {@link studyRemoval} holds one answer at a time, and each pane asks for the entry it has chosen: the lists are kept apart from it, so one pane's request does not take another pane's list away. */
  private readonly listedStudyFiles = new Map<string, string[]>()
  /** Settles, without a rejection, once the files of the study a confirmed removal is taking to the Trash have moved or stayed (the removal left `moving`); a {@link checkpoint} of that study waits for it, not for the study shown afterwards. */
  private studyMove?: Promise<void>
  /** Settles {@link studyMove}; called when the removal's outcome is settled and again when the removal ends. */
  private releaseStudyMove?: () => void
  /** Counts the completed removals that still show the study that follows; an entry chosen meanwhile does not retire the outcome line the learner has not read yet. */
  private removalFollowersShowing = 0
  /** The current run when the last removal ended; a later run retires that removal's outcome line. */
  private studyRemovalRunId?: string
  /** The number the asking pane gave the delete request whose removal is in progress or was answered last; absent for a request without a number. */
  private studyRemovalRequest?: number
  /** Whether {@link removeSavedStudy} has taken a delete request and not ended it yet; set before its first `await`, so a second request delivered in the same turn is refused before {@link askStudyRemoval} marks the removal `confirming`. */
  private studyRemovalTaken = false
  /** Settles, without a rejection, when the first check of the delete request that is taken has ended (see {@link studyRemovalTaken}); a request for a study's files in a window without a Trash waits for it instead of being dropped. `undefined` while no request is being checked. */
  private studyRemovalCheck?: Promise<void>
  /** Studies this window moved to the system Trash; a position save still queued for one of them writes nothing. */
  private readonly removedStudyIds = new Set<string>()
  /** The refused run for which a removal made room; its "did not start" line is no longer shown. */
  private answeredRunRefusalId?: string
  private readonly errors = new Map<ReaderErrorKind, string>()
  /** Codebook pane tabs an earlier extension host left in this window, as {@link rememberInheritedPanes} saw them; a tab drops out when the editor closes it. */
  private readonly inheritedPaneTabs = new WeakSet<vscode.Tab>()
  private readonly documents = new Map<string, string>()
  private readonly runtimeSourcePaths = new Set<string>()
  private app?: vscode.WebviewPanel
  private initialAppPlacement?: {
    panel: vscode.WebviewPanel
    column: vscode.ViewColumn | undefined
    registration?: { ready(): boolean; dispose(): void; error?: unknown }
  }
  private contextPanel?: vscode.WebviewPanel
  private liveComposition = false
  private summaryComposition = false
  private summaryView?: vscode.WebviewView
  private summaryDocumentActive = false
  // What the Learning summary's document last reported about the keyboard focus; the editor gives a webview view no focus state to read.
  private summaryHeldFocus = false
  /** Whether the Study pane's own document last reported that it has the keyboard (`pane-focus`, sent at its window's focus and blur events and once at load); `false` until a report, after a blur, and for a newly bound pane. {@link focusPaneForGridCommand} reads it to leave a pane alone that has the keyboard already. */
  private studyPaneReportsKeyboard = false
  // The wait for a hidden summary's report that it lost the focus; see {@link releaseHiddenSummaryFocus}.
  private summaryFocusRelease?: ReturnType<typeof setTimeout>
  // Set while Show Variables runs its commands: Run and Debug takes the focus on purpose then, also where its view hides the summary.
  private isShowingNativeVariables = false
  /** The Move View offers {@link offerSummaryPlacement} made in this editor session; each occasion is offered at most once per session. */
  private readonly summaryPlacementOffersMade =
    new Set<SummaryPlacementOccasion>()
  private liveEntryRunId?: string
  /**
   * The tab outside the text editors and the Study panes that had the keyboard when the editor last showed one (Cursor's Agent chat as a tab of another editor part), kept by {@link sampleKeyboardOutsideEditors} for {@link returnsKeyboardToChatAtPause}: `giveBack` is what {@link retainForeignTabFocus} answered then, and `leftAtMs` the moment a text editor or a Study pane became active afterwards. `pause` is set from a stack frame of the editor's debugger until the next frame or the end of the pause ({@link judgeKeyboardAtPauseBegin}, {@link judgeKeyboardAtPauseEnd}): `openedByDebugger` names the document the debugger had opened with the keyboard when the frame was reported, `undefined` when no text editor was active then, and `state` says whether the reader's one return of that pause is still owed (`'unsettled'`), running (`'settling'`, {@link owedPauseOf}) or done (`'settled'`). The whole record is `undefined` while a text editor or a Study pane is known to have the keyboard, which is also what a side-view chat reads as.
   */
  private keyboardOutsideEditors?: {
    giveBack: NonNullable<ReturnType<StudyWorkspace['retainForeignTabFocus']>>
    leftAtMs?: number
    pause?: KeyboardPauseOfRecord
  }
  /** The debug sessions whose adapter reported a stop ({@link debugStopOf}) that the editor has not reported as a stack frame yet, each with what {@link noteStopOf} noted of that stop; {@link cameWithStop} takes a session out again, and so does {@link forgetSession}. */
  private readonly announcedStops = new Map<string, StopNote>()
  /** The moment each followed debug session was last seen to go on (the editor's resume or step request, or the adapter's `continued` event), kept while it runs: {@link noteSessionWentOn} sets it, the session's next stop and its end take it out. {@link cameBeforeFocusPass} reads from it how soon the editor can pass the focus on from that session. */
  private readonly sessionsWentOnAtMs = new Map<string, number>()
  /** The debug sessions that started while this reader existed and have not ended, whose adapter's messages it therefore sees ({@link followStopsOf}); {@link forgetSession} takes a session out when it ends. A session that started before the reader has none to tell a stop from a selected frame. */
  private readonly followedSessions = new Set<string>()
  /** Whether the stack frame the editor reports now came with a stop of the debugger, which opens the paused file with the keyboard; `false` for a frame the learner selected in the Call Stack view and for one the editor brought to the front later by itself, whose file the editor opens without the keyboard, and while no frame is reported. Set by {@link judgeKeyboardAtStackItemChange}. */
  private frameCameWithStop = false
  /** Whether the learner gave a sign of working in the active text editor since the editor reported a frame whose file it opened without the keyboard ({@link noteLearnersSignAtFrame}): a pane or the captured source that covers that editor then takes the keyboard as at a stop. `false` at every new stack item ({@link judgeKeyboardAtStackItemChange}). */
  private learnerChoseEditorAtFrame = false
  /** The moment the learner last clicked or pressed a key in the active text editor ({@link noteLearnersSelection}); read while no frame is shown, where it counts for {@link LEARNER_SIGN_FRESH_MS} ({@link workedInEditorJustNow}). */
  private learnerWorkedInEditorAtMs?: number
  /** The file and the editor group of the preview tab that was in front of the active group when the editor reported the stack item it shows now, if any; {@link keptPreviewTabOfFrame} reads from it whether the learner has kept that tab open since. The tab is known by its document and view column, never by its object: Cursor's extension host builds every tab object anew whenever the editor sends its whole tab model, and an object taken before then keeps answering what it answered last. */
  private previewTabOfFrame?: { uri: string; column: vscode.ViewColumn }
  private moments?: vscode.WebviewView
  private viewport?: BrowserViewport
  private leaseId?: string
  private outline?: vscode.TreeView<RetainedStudySelection['itemId']>
  private readonly treeChanges = new vscode.EventEmitter<
    RetainedStudySelection['itemId'] | undefined
  >()
  private readonly disposables: vscode.Disposable[] = []
  private highlight?: vscode.TextEditorDecorationType
  private sourceUri?: vscode.Uri
  private sourceGroup?: vscode.TabGroup
  private opened = false
  private sourceEntryPending = false
  /** The pending cold entry's cancellation and the moment its reservation ends, so a successor of an abandoned entry can wait for it. */
  private sourceEntry?: {
    signal?: AbortSignal
    release(): void
    released: Promise<void>
  }
  private closing = false
  private closingPromise?: Promise<void>
  private arranging?: Promise<void>
  /** Whether a Read ({@link readStudyPane}) maximized an editor group and no command of the reader has left that maximization since; {@link close} then ends it, so a closed workspace leaves no maximized group behind. */
  private maximizedByRead = false
  /** The main editor's layout as it stood before the first arrangement of the Open that opened this reader, with the learner's tabs of each of its groups ({@link noteLayoutBeforeOpen}); {@link giveLayoutOfBeforeOpenBack} applies it at the end of {@link close} when the groups are still those. `undefined` while the reader is closed, and when a close gave it back or found other groups. */
  private layoutBeforeOpen?: { layout: unknown; groups: string[][] }
  /** Stable identity of the Context group an accepted native reservation actually created; only this group can retire at recording/live entry. */
  private readerCreatedContextGroup?: symbol
  /** A Context destination absent immediately before panel creation; {@link sealCreatedContextPanelGroup} seals its identity only after confirmed native placement. */
  private pendingCreatedContextColumn?: vscode.ViewColumn
  /** Identity and panel lifetime of the pending created group; native replacement invalidates these before a retry can seal another group at the same column. */
  private pendingCreatedContextGroup?: symbol
  private pendingCreatedContextPanel?: vscode.WebviewPanel
  /** The main editor's layout as {@link rememberSideBarsBeforeRead} read it when the reading began that is on now ({@link maximizedByRead}), before anything was hidden or maximized; `undefined` when that read failed or another editor part may have answered. Read only while a reading is on: a Read without a measurement and an Enlarge that begins during the reading keep it as the sizes of before their Expand ({@link expandKeepingGroupSizes}). */
  private layoutBeforeReading?: unknown
  /** The main editor's layout of before the first Expand the reader ran for a Read or an Enlarge since the groups last had their own sizes ({@link expandKeepingGroupSizes}): the editor's Expand leaves every other group at its minimum size, and {@link giveGroupSizesBackAfterExpand} applies this layout when a Close ends the enlargement, when a Restore ends it and arranges nothing, and when the Read or the Enlarge is refused after its Expand. A later Expand keeps it, so the sizes of before the first of several Reads and Enlarges come back. `undefined` while no Expand of the reader's is owed for: after the sizes were given back, after an arrangement or the Restore of an Enlarge applied its own layout, and when the layout of before could not be read or was not known to be the main editor's. */
  private groupSizesBeforeExpand?: unknown
  /** What {@link rememberSideBarsBeforeRead} and {@link rememberAuxiliaryBarAtRead} measured when a Read began, for {@link showSideBarsHiddenByRead}. `undefined` while no reading is pending, and during a reading whose editor area gave no width at all: {@link maximizeForRead} then hides no side bar. */
  private sideBarsBeforeRead?: {
    /** Whether the primary side bar is shown again when the reading ends: it was open before the Read, or the measurement hid it and the read after that gave no width. */
    primaryVisible: boolean
    /** The editor area's width without the primary side bar; `undefined` when that read gave none: the reading then hides no other bar and shows only the primary one again. */
    widthWithoutPrimaryPx?: number
    /** Whether the secondary side bar was open before the Read, from the editor area the Read's maximization left; `undefined` when that read gave no width, and {@link sideBarShowCommands} measures it when the reading ends. */
    auxiliaryVisible?: boolean
  }
  /** How often {@link readMainEditorGrid} gave the main editor the keyboard to measure it; {@link retainForeignTabFocus} compares it, because Cursor does not report every focus a pane takes beside the chat. */
  private mainEditorFocusBorrows = 0
  private layoutReceipt?: {
    mode: 'study' | 'repository' | 'study-reentry'
    signature: string
    groups: { group: vscode.TabGroup; column: vscode.ViewColumn }[]
    panes: ReturnType<StudyWorkspace['studyPanePositions']>
    sourceTargetColumn?: vscode.ViewColumn
    pendingPanes?: ReturnType<StudyWorkspace['studyPanePositions']>
  }
  /** Which comparison of the layout receipt a status read found changed; it speaks for that receipt only, so a later arrangement retires it. */
  private changedLayoutPart?: {
    receipt: NonNullable<StudyWorkspace['layoutReceipt']>
    part: ChangedLayoutPart
  }
  private enlargedLayoutReceipt?: {
    receipt: NonNullable<StudyWorkspace['layoutReceipt']>
    mode: PresentationMode
    expandedSignature: string
  }
  private repositoryLayoutOrigin?: {
    origin: NonNullable<StudyWorkspace['repositoryOrigin']>
    navigation?: number
    layout: unknown
    groups: NonNullable<StudyWorkspace['layoutReceipt']>['groups']
    preservesOtherParts: (mainCount: number) => boolean
  }
  private repositoryLayoutRestored?: {
    signature: string
    studyLayout: unknown
    groups: NonNullable<StudyWorkspace['layoutReceipt']>['groups']
    before: ReturnType<StudyWorkspace['studyPanePositions']>
    after: ReturnType<StudyWorkspace['studyPanePositions']>
  }
  private readonly editorGroupIdentities = new WeakMap<
    vscode.TabGroup,
    symbol
  >()
  private readonly webviewCloseRevisions = new Map<string, number>()
  private observedEditorGroups: {
    group: vscode.TabGroup
    column: vscode.ViewColumn
  }[] = []
  private disposed = false
  private lifetime = 0
  /** The number of the reader's latest {@link open}; an earlier open that resumes later compares against it. Not the number a pane gives its open request. */
  private readerOpenNumber = 0
  private busy = false
  private saving = false
  private loading = false
  private revision = 0
  private sourceRevision?: number
  private historyRequest = 0
  /** Counts the refused controls reported so far; a pane message that was already being handled when a control was refused does not retire that newer refusal. */
  private controlRefusals = 0
  /** Counts the saved studies and Node test histories the learner chose; a removal reads it to tell a choice made meanwhile from other actions that only take a {@link historyRequest} number. */
  private studyChoices = 0
  private repositoryNavigation?: number
  private repositoryRecordingOpen?: { studyId: string; revision: number }
  private pendingHistory?: number
  /** The request number of a Node test history that is still opening; a removal's neighbour and a delete request give way to it like to {@link pendingHistory}. */
  private pendingNodeHistory?: number
  /** Replies owed to the webviews whose open request started a Recording load that is still in flight; {@link flushDeferredOpenReplies} posts them when the load has ended. */
  private deferredOpenReplies: {
    webview: Pick<vscode.Webview, 'postMessage'>
    openRequest: PaneOpenRequest['openRequest']
  }[] = []
  private rendering: Promise<void> = Promise.resolve()
  /** The saved study the learner chose while the editor area was hidden (a maximized bottom panel): its panes are shown once the area is back, so the choice itself leaves the panel as it is. `arrange` is set when a live or summary composition was up, which the study replaces through {@link open}. */
  private studyAwaitingEditorArea?: {
    selectionRevision: number
    arrange: boolean
  }
  /** The layout request {@link showStudyAwaitingEditorArea} sent and the editor has not answered yet, with the time it was sent: a later tick sends no second one, and none within {@link STUDY_EDITOR_AREA_LOOK_INTERVAL_MS}. */
  private editorAreaLook?: { sentAtMs: number; answer?: Promise<boolean> }
  private refreshing?: Promise<void>
  private timer?: ReturnType<typeof setInterval>
  private lastActiveRegion: 'app' | 'context' | 'source' = 'context'
  private restoringSource = false
  private lastRendered?: {
    revision: number
    itemId: RetainedStudySelection['itemId']
    snapshotUri?: string
    presentationRevision?: number
    presentationControlRevision?: number
    presentationMode?: PresentationMode
  }
  private lastSelectionKey?: string
  /** The selection whose last source render failed; {@link renderSelection} lets the next refresh render it once more and, after a second failure in a row, leaves it to Retry or another selection. */
  private failedSelectionKey?: string
  private lastApplicationKey?: string
  private lastPublished?: string
  private outlineRendering: Promise<void> = Promise.resolve()
  private lastOutlineSelection?: RetainedStudySelection['itemId']
  private lastOutlineModelKey?: string
  private presentationId = randomUUID()
  private presentationControlRevision = 0
  private readerSelectionRevision = 0
  private returningCurrent = false
  private presentationMode: PresentationMode = 'study-workspace'
  private requestedPresentation?: PresentationMode
  private presentationConfirmed = false
  private presentationReason?: string
  private presentationPreference: PresentationState['preference'] = {
    status: 'default',
  }
  private presentationTransition?: {
    id: string
    cancellation: AbortController
    runtimeIdentity?: string
  }
  private presentationOperation?: Promise<PresentationState>
  /** Set from the start of a recording load until its first ready position, which retires a replay control's reported failure. */
  private replayLoadAwaitingReady = false
  /** The ledger write {@link saveShownRecordingSelection} started for the recording shown last; the playback controller's position save waits for it, so an unbounded {@link PlaybackController.settle} (tests, {@link PlaybackController.dispose}) ends after it, and {@link openLearningReplay} awaits it after its bounded one. It never rejects. */
  private shownRecordingSelectionSaved: Promise<void> = Promise.resolve()
  /** The playback presentation revision of the read that {@link open}'s reveal restarted, for {@link loadPlayback}: that read leaves the arrangement to the entry. */
  private recordingRevealedByEntry?: number
  private presentationWrite?: Promise<void>
  private placingPresentation = false
  private presentationEditorScope?: {
    signal: AbortSignal
    lifetime: number
    mainCount: number
    overlappingPanes: Map<
      string,
      { column: vscode.ViewColumn; tabCount: number }
    >
  }
  private presentationMovedFocus = false
  private presentationPoseRequest?: PresentationPoseCapture
  private presentationPose?: PresentationPose
  private presentationPoseRestored?: string

  constructor(
    private readonly context: WorkspaceContext,
    private readonly controls: {
      connect(): Promise<void>
      returnToRepository?(selection: RepositorySelection): Promise<void>
      openArticle?(selection: RepositorySelection): Promise<void>
      /** Tells whether the Wiki reader of this host owns its Repository Wiki panel; a Wiki tab seen while it does not is an earlier host's. */
      repositoryWikiOpen?(): boolean
    },
    /** The archives the reader this one replaces could not save ({@link releaseUnsavedStudies}); this reader shows "History not saved: …" for those of its library and writes them at Retry storage / refresh. */
    handedOverArchives: readonly UnsavedStudyArchive[] = [],
  ) {
    this.handedOverArchives = [...handedOverArchives]
    this.readPresentationPreference()
    this.installReaders()
    // Activation constructs the reader before this host creates any pane, so every Codebook pane in the window now is an earlier host's.
    this.rememberInheritedPanes()
  }

  /** Keeps live explanation in native chat when {@link open} arranges app/source; replay retains its summary. @example this.studyLayout() */
  private studyLayout() {
    return this.liveComposition || this.summaryComposition
      ? LIVE_EDITOR_LAYOUT
      : STUDY_PRESENTATIONS[this.presentationMode].layout
  }

  /** Bounds layout effects to the current feature's main panes, never a separate chat part. @example this.studyGroupCount() // 2 during live explanation */
  private studyGroupCount(): number {
    return this.liveComposition || this.summaryComposition
      ? LIVE_EDITOR_GROUP_COUNT
      : STUDY_EDITOR_GROUP_COUNT
  }

  /** Projects mode control independently of content/playback revisions; MCP reads never open the reader. @example workspace.presentationState().presentationId */
  presentationState(): PresentationState {
    const panes = this.studyPanePositions(),
      descriptor = STUDY_PRESENTATIONS[this.presentationMode]
    // A stable receipt may describe a learner collision; only the mode's distinct destinations qualify as confirmed.
    const matchingColumns =
      panes.appColumn === descriptor.appColumn &&
      panes.sourceColumn === descriptor.sourceColumn &&
      (this.liveComposition || this.summaryComposition
        ? !panes.context
        : panes.contextColumn === descriptor.contextColumn)
    const currentSourceReady = this.sourceReady()
    const matchingLayoutReceipt = Boolean(
      this.layoutReceipt?.mode === 'study' &&
      this.sameStudyPanePositions(this.layoutReceipt.panes),
    )
    const layoutConfirmed =
      this.presentationConfirmed &&
      currentSourceReady &&
      matchingColumns &&
      matchingLayoutReceipt
    // A successful Restore can still lack one native receipt; expose that missing condition to the next public recovery step.
    let reason = this.presentationReason
    if (!reason && this.opened && !this.closing && !layoutConfirmed) {
      if (!currentSourceReady) {
        const playback = this.playback?.state()
        // The reader's own pending recorded presentation is still placing the source: nothing for the learner to recover. A recording whose load failed shows no source until it is opened again.
        reason =
          playback?.readiness === 'loading'
            ? 'The recorded source is opening in its native pane.'
            : this.recordingActive && playback?.readiness === 'failed'
              ? recordingNotShownReason(playback.reason)
              : 'The current captured source is not ready in its native pane. Wait for it, or use Return to current with the latest reader revision before restoring the layout.'
      } else if (!matchingColumns)
        reason =
          'The application or source pane is no longer in its Study destination. Focus the existing Study or Application pane, then restore its layout. Opening Repository Wiki does not repair Study.'
      else if (!matchingLayoutReceipt)
        reason =
          'The native editor layout receipt no longer matches the Study panes. Focus the existing Study or Application pane, then restore its layout. Opening Repository Wiki does not repair Study.'
      else
        reason = unconfirmedLayoutReason(
          this.changedLayoutPart?.receipt === this.layoutReceipt
            ? this.changedLayoutPart?.part
            : undefined,
        )
    }
    // A selected Node journal masks the live application, so agents must not read the reader as following the run.
    return {
      presentationId: this.presentationId,
      presentationControlRevision: this.presentationControlRevision,
      reader: {
        contentRevision: this.revision + this.readerSelectionRevision,
        contentTab: this.recordingActive ? 'recording' : this.selection.tab,
        followingCurrentRun:
          this.selection.follow &&
          !this.recordingActive &&
          !this.selectedNodeHistory,
      },
      mode: this.presentationMode,
      requestedMode: this.requestedPresentation,
      state: this.presentationTransition
        ? 'applying'
        : this.opened && !this.closing
          ? 'open'
          : 'closed',
      layoutConfirmed,
      preference: { ...this.presentationPreference },
      // The reason of an earlier refused change says nothing about a layout that is confirmed now.
      reason: layoutConfirmed ? undefined : reason,
      playbackRevision: this.recordingActive
        ? this.playback?.state().revision
        : undefined,
      panes: {
        appColumn: panes.appColumn,
        sourceColumn: panes.sourceColumn,
        contextColumn: panes.contextColumn,
      },
    }
  }

  /** Refreshes native confirmation for MCP reads without adopting a manual layout or changing reader identity. @example await workspace.readPresentationState() */
  async readPresentationState(): Promise<PresentationState> {
    const state = this.presentationState(),
      receipt = this.layoutReceipt
    if (!state.layoutConfirmed || this.presentationTransition || !receipt)
      return state
    const layout = await this.readPassivePresentationLayout()
    // A hidden editor area (the bottom panel is maximized) reports its groups at their minimum heights: nothing was rearranged, and the editor gives the groups their sizes back with the area.
    if (isCollapsedEditorLayout(layout)) return this.presentationState()
    // The first comparison that fails is the one the reason names; a moved pane has its own reason in the state.
    let changedPart: ChangedLayoutPart | undefined
    if (layout !== undefined && JSON.stringify(layout) !== receipt.signature)
      changedPart = 'grid'
    else if (
      !this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all)
    )
      changedPart = 'groups'
    if (
      !this.presentationTransition &&
      state.presentationId === this.presentationId &&
      state.presentationControlRevision === this.presentationControlRevision &&
      receipt === this.layoutReceipt &&
      (changedPart || !this.sameStudyPanePositions(receipt.panes))
    ) {
      this.presentationConfirmed = false
      this.changedLayoutPart = changedPart && { receipt, part: changedPart }
      this.publish()
    }
    const current = this.presentationState()
    if (layout !== undefined) return current
    // Another editor part (an agent chat) has the keyboard focus and the read must not take it: while no tab or group changed since the last arrangement, its confirmation is answered again, marked as not measured.
    if (current.layoutConfirmed) return { ...current, layoutMeasured: false }
    // An unmeasurable active part qualifies this response only; it cannot invalidate or certify the retained main grid.
    return {
      ...current,
      layoutConfirmed: false,
      reason:
        'Main editor layout could not be checked without changing focus. Focus a Codebook pane or main text editor and read again.',
    }
  }

  /** Returns an explicitly named historical reader to the current run after checking its visible content revision; MCP calls it before new input. @example await workspace.returnToCurrent({presentationId,expectedRevision:4}) */
  async returnToCurrent(
    input: ReturnCurrentIntent,
  ): Promise<PresentationState> {
    this.assertPresentationIdle()
    const lifetime = this.lifetime
    await this.initialize()
    this.assertLifetime(lifetime)
    this.assertPresentationIdle()
    if (input.presentationId !== this.presentationId)
      throw new StudyError(
        'PRESENTATION_INSTANCE_GONE',
        'The named reader lifetime has ended.',
      )
    if (input.expectedRevision !== this.revision + this.readerSelectionRevision)
      throw new StudyError(
        'STALE_PRESENTATION',
        'The reader content changed. Read current presentation state before returning to live execution.',
      )
    // A return can change the selection while native source rendering fails; report that partial state honestly.
    // A failed native source open leaves the selection current, so explicit retry must render it again.
    // A selected Node journal masks the live application even while the selection still follows the run.
    if (
      this.selectedNodeHistory ||
      !this.selection.follow ||
      this.recordingActive ||
      this.selection.tab !== 'live' ||
      !this.sourceReady()
    )
      await this.returnCurrentSelection()
    const state = this.presentationState()
    if (
      !this.sourceReady() ||
      !state.reader.followingCurrentRun ||
      state.reader.contentTab !== 'live'
    ) {
      throw new StudyError(
        'EVIDENCE_UNAVAILABLE',
        'Current source is not displayed in the native reader. Inspect its error and retry explicitly.',
      )
    }
    return state
  }

  /**
   * Retires a refused replay control shown in the Learning replay panel once a later seek, play or pause was accepted.
   *
   * Called by the panel's own playback message and by {@link StudyService.playback} for an agent's control, so the line
   * does not outlive the refusal whichever route moved the replay.
   *
   * @example workspace.replayControlAccepted()
   */
  replayControlAccepted(): void {
    if (this.errors.delete('replay-control')) this.publish()
  }

  /** Rejects competing input/navigation before effects while preserving Stop/Close/read access. @example workspace.assertPresentationIdle() */
  assertPresentationIdle(): void {
    if (this.presentationTransition || this.returningCurrent || this.closing)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'A presentation change or reader close is pending. Read its state before another control.',
      )
  }

  /** Reserves one current reader intent before asynchronous work; all three entry points share its native/storage receipts. @example await workspace.changePresentation({presentationId,expectedRevision:0,mode:'living-book',action:'select'}) */
  changePresentation(input: PresentationIntent): Promise<PresentationState> {
    return this.admitPresentation(input, 'pending')
  }

  /** Tells whether a tab shows a captured source document of this workspace's reader; the one definition of ownership for every caller that closes such tabs or counts them as Codebook's own. It is false until {@link initialize} has created the library. @example vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => this.ownsCapturedSourceTab(tab)) */
  private ownsCapturedSourceTab(tab: vscode.Tab): boolean {
    return (
      this.library !== undefined &&
      this.isCapturedSourceInput(tab.input) &&
      tab.input.uri.authority === this.library.workspaceKey
    )
  }

  /** Tells whether a tab input is a captured source document of any workspace's reader: the part of {@link ownsCapturedSourceTab} that needs no library key, which {@link admitPresentation} asks before the library exists. @example this.isCapturedSourceInput(vscode.window.tabGroups.activeTabGroup.activeTab?.input) */
  private isCapturedSourceInput(input: unknown): input is vscode.TabInputText {
    return (
      input instanceof vscode.TabInputText &&
      input.uri.scheme === STUDY_SOURCE_SCHEME
    )
  }

  /**
   * Tells whether a tab input is the webview of a Codebook editor pane; asked of a tab by {@link unkeptPreview}, by {@link readStudyPane} while it waits for its pane's tab, by {@link isCodebookTabWithoutFocus}, by {@link isPaneTabWithoutOwner}, by the foreign-preview search of {@link readMainEditorGrid}, by {@link ensureApp}, {@link isApplicationCoveredByTab} and {@link hasUnownedPaneTab}, and by {@link open} while it waits for the Application pane's reveal.
   * The view type alone cannot tell a live pane from one an earlier extension host left behind; the caller decides that from the panels it owns.
   * @param input - The `input` of an editor tab.
   * @param kinds - The registered view types to match; every Codebook pane when none is given.
   * @returns `true` for a webview input whose view type {@link isCodebookPaneViewType} matches, `false` for any other input.
   * @example this.isCodebookPaneInput(tab.input, 'codebook.scopedBrowser', 'codebook.studyContext')
   */
  private isCodebookPaneInput(input: unknown, ...kinds: string[]): boolean {
    return (
      input instanceof vscode.TabInputWebview &&
      isCodebookPaneViewType(input.viewType, ...kinds)
    )
  }

  /**
   * Remembers every Codebook pane tab that is in the window while this host owns no pane of its kind: such a tab belongs to an earlier extension host. Called by the constructor, by {@link deadPaneTabs} and before this host creates a pane.
   * A view type cannot tell a live pane from a dead one, so a tab is known as dead only from the moment it was seen without an owner, and stays known after this host creates its own pane.
   * @example
   * ```ts
   * this.rememberInheritedPanes() // before vscode.window.createWebviewPanel('codebook.scopedBrowser', ...)
   * ```
   */
  private rememberInheritedPanes(): void {
    const ownsWorkspacePane = Boolean(this.app || this.contextPanel),
      ownsWikiPane = this.ownsRepositoryWikiPane()
    for (const tab of vscode.window.tabGroups.all.flatMap(
      (group) => group.tabs,
    ))
      if (this.isPaneTabWithoutOwner(tab, ownsWorkspacePane, ownsWikiPane))
        this.inheritedPaneTabs.add(tab)
  }

  /**
   * Tells whether this host owns its Repository Wiki pane; asked once by every {@link rememberInheritedPanes}, before it reads the window's tabs.
   * @returns What the embedder's `repositoryWikiOpen` answers, and `true` for an embedder that has no such control.
   * @example
   * ```ts
   * const ownsWikiPane = this.ownsRepositoryWikiPane() // => true in an embedder without `repositoryWikiOpen`
   * ```
   */
  private ownsRepositoryWikiPane(): boolean {
    // An embedder that does not tell is taken to own its Repository Wiki pane, so a live one is never closed.
    return this.controls.repositoryWikiOpen?.() ?? true
  }

  /**
   * Tells whether a tab is a Codebook pane of a kind this host owns no pane of; asked of every tab in the window by {@link rememberInheritedPanes}.
   * @param tab - A tab of the window.
   * @param ownsWorkspacePane - Whether this host holds an Application or a Study pane.
   * @param ownsWikiPane - Whether this host owns its Repository Wiki pane, from {@link ownsRepositoryWikiPane}.
   * @returns `true` for a Repository Wiki tab while `ownsWikiPane` is `false` and for an Application or Study tab while `ownsWorkspacePane` is `false`; `false` for a pane of an owned kind and for a tab that is no Codebook pane.
   * @example
   * ```ts
   * this.isPaneTabWithoutOwner(applicationTab, false, true) // => true: the Application tab is an earlier host's
   * ```
   */
  private isPaneTabWithoutOwner(
    tab: vscode.Tab,
    ownsWorkspacePane: boolean,
    ownsWikiPane: boolean,
  ): boolean {
    if (!this.isCodebookPaneInput(tab.input)) return false
    const ownsKind = this.isCodebookPaneInput(
      tab.input,
      'codebook.repositoryWiki',
    )
      ? ownsWikiPane
      : ownsWorkspacePane
    return !ownsKind
  }

  /**
   * Lists the Codebook panes an earlier extension host left in this window; called by {@link leftoverTabs} and {@link admitPresentation}.
   * @returns The dead pane tabs still in the window: Application, Study and Repository Wiki tabs that {@link rememberInheritedPanes} saw without a panel of this host. A pane this host created is never among them.
   * @example
   * ```ts
   * const deadPanes = this.deadPaneTabs() // [] in a window no earlier host left a pane in
   * ```
   */
  private deadPaneTabs(): vscode.Tab[] {
    this.rememberInheritedPanes()
    return vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => this.inheritedPaneTabs.has(tab))
  }

  /**
   * Lists the tabs an earlier host session left behind; called by {@link closeLeftoverTabs} and {@link selectAfterClosingLeftoverTabs}.
   * @returns Every dead Codebook pane and, while the reader is closed, every captured-source tab of this workspace that no text editor shows. An open reader's captured source and a captured source in a live text editor belong to this host and are not listed.
   * @example
   * ```ts
   * const leftover = this.leftoverTabs() // [capturedSourceTab, deadApplicationTab]
   * ```
   */
  private leftoverTabs(): vscode.Tab[] {
    const deadPanes = this.deadPaneTabs()
    if (this.opened) return deadPanes
    const shownUris = new Set(
      vscode.window.visibleTextEditors.map((editor) =>
        editor.document.uri.toString(),
      ),
    )
    return [
      ...vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter(
          (tab) =>
            tab.input instanceof vscode.TabInputText &&
            this.ownsCapturedSourceTab(tab) &&
            !shownUris.has(tab.input.uri.toString()),
        ),
      ...deadPanes,
    ]
  }

  /**
   * Closes, in one request, the tabs {@link leftoverTabs} lists; called by {@link selectAfterClosingLeftoverTabs} once the library key is known, and by {@link open} at the start of every cold entry.
   * The editor closes group by group and answers once for the whole request, so what closed is read from the tab model: a tab the editor keeps holds back the requested tabs of its own group only. A request the editor refuses or rejects changes nothing here; the caller decides what a kept tab means.
   * @returns What closed and what stayed, see {@link LeftoverTabClose}.
   * @example
   * ```ts
   * const closed = await this.closeLeftoverTabs() // { closedAny: true, closedFocus: { activatedTab: undefined }, closedSourceUris: [], capturedSourceKept: false, deadPaneKept: false }
   * ```
   */
  private async closeLeftoverTabs(): Promise<LeftoverTabClose> {
    const focusedTab = vscode.window.tabGroups.activeTabGroup.activeTab,
      leftover = this.leftoverTabs()
    if (leftover.length)
      await vscode.window.tabGroups.close(leftover, true).then(
        () => undefined,
        () => undefined,
      )
    const remaining = new Set(
        vscode.window.tabGroups.all.flatMap((group) => group.tabs),
      ),
      closed = leftover.filter((tab) => !remaining.has(tab)),
      kept = leftover.filter((tab) => remaining.has(tab))
    return {
      closedAny: closed.length > 0,
      closedFocus:
        focusedTab && closed.includes(focusedTab)
          ? { activatedTab: vscode.window.tabGroups.activeTabGroup.activeTab }
          : undefined,
      closedSourceUris: closed.flatMap((tab) =>
        tab.input instanceof vscode.TabInputText
          ? [tab.input.uri.toString()]
          : [],
      ),
      capturedSourceKept: kept.some(
        (tab) => tab.input instanceof vscode.TabInputText,
      ),
      deadPaneKept: kept.some(
        (tab) => tab.input instanceof vscode.TabInputWebview,
      ),
    }
  }

  /**
   * Waits until the editor's tab model and its active text editor agree after leftover tabs closed, because the editor reports the two separately; called by {@link selectAfterClosingLeftoverTabs} before the selection is admitted on what remains.
   * A wait that expires or is cancelled ends quietly and leaves the decision to the admission.
   * @param closedSourceUris - Documents of the captured-source tabs that closed; the active text editor may still report one.
   * @param signal - The pending selection's cancellation; a reader close ends the wait.
   * @example
   * ```ts
   * await this.waitForEditorAfterClose(closed.closedSourceUris, transition.cancellation.signal)
   * ```
   */
  private async waitForEditorAfterClose(
    closedSourceUris: string[],
    signal: AbortSignal,
  ): Promise<void> {
    await waitUntil(
      () => {
        const activeInput =
            vscode.window.tabGroups.activeTabGroup.activeTab?.input,
          shownUri = vscode.window.activeTextEditor?.document.uri.toString()
        // A text tab needs its own text editor; any other tab needs the text editor of a tab that just closed to be gone.
        return activeInput instanceof vscode.TabInputText
          ? shownUri === activeInput.uri.toString()
          : shownUri === undefined || !closedSourceUris.includes(shownUri)
      },
      'the active text editor after closing leftover tabs',
      PRESENTATION_READY_TIMEOUT_MS,
      signal,
    ).catch(() => undefined)
  }

  /**
   * Refuses a mode other than the Study workspace while a live explanation or a replay owns the layout; called by {@link admitPresentation} and, before any leftover tab closes, by {@link assertSelectionOutlastsClose}.
   * @param input - The requested change.
   * @throws `PRESENTATION_UNAVAILABLE` for another mode or a preference save during live or replay; nothing otherwise.
   * @example
   * ```ts
   * this.assertCompositionAllows(input) // throws for mode 'living-book' during a live explanation
   * ```
   */
  private assertCompositionAllows(input: PresentationIntent): void {
    if (
      this.hasComposition() &&
      (input.mode !== 'study-workspace' || input.action === 'save-preference')
    )
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Live and replay use one app/source layout with the chat or learning summary in the sidebar.',
      )
  }

  /**
   * Says whether a live explanation or a replay owns the layout; asked by {@link assertCompositionAllows} before it weighs the requested mode, and by {@link assertSelectionOutlastsClose} before it asks for a focus to keep.
   * @returns `true` during a live or a summary composition, `false` while the reader shows its own Study panes or none.
   * @example
   * ```ts
   * this.hasComposition() // => true while a live explanation is arranged as app/source
   * ```
   */
  private hasComposition(): boolean {
    return this.liveComposition || this.summaryComposition
  }

  /**
   * Says whether a tab is one of the tabs {@link leftoverTabs} lists, which are about to close; asked by {@link assertSelectionOutlastsClose} of the focused tab, and only for a selection no composition owns.
   * @param tab - The active tab of the active group, `undefined` when that group shows none.
   * @returns `true` for a leftover tab; `false` for any other tab, and for no tab, for which the leftover tabs are not listed at all.
   * @example
   * ```ts
   * this.isLeftoverTab(vscode.window.tabGroups.activeTabGroup.activeTab) // => true while a dead Application pane has the focus
   * ```
   */
  private isLeftoverTab(tab: vscode.Tab | undefined): boolean {
    return Boolean(tab && this.leftoverTabs().includes(tab))
  }

  /**
   * Gives, before any leftover tab closes, the refusals {@link admitPresentation} would give a closed reader's selection after the close; called by {@link selectAfterClosingLeftoverTabs}, so a selection refused for its mode, its runtime state or its focus changes nothing in the window.
   * An open reader is not rehearsed: only dead panes close for it, and its admission has paths that keep no focus.
   * @param input - The `select` request.
   * @throws `PRESENTATION_UNAVAILABLE` as the admission would.
   * @example
   * ```ts
   * this.assertSelectionOutlastsClose(input) // throws while the editor's Settings page has focus
   * ```
   */
  private assertSelectionOutlastsClose(input: PresentationIntent): void {
    if (this.opened) return
    this.assertCompositionAllows(input)
    this.assertPresentationAdmission()
    const focusedTab = vscode.window.tabGroups.activeTabGroup.activeTab
    // Live and replay keep the focused pane by their own rule, and a focused tab that is about to close has no focus to keep; every other closed-reader selection must be able to give the focus back.
    if (!this.hasComposition() && !this.isLeftoverTab(focusedTab))
      this.capturePresentationFocus(undefined)
  }

  /**
   * Closes the captured-source tabs and dead Codebook panes an earlier host session left behind, then admits the selection once on what remains; called by {@link admitPresentation}.
   * The pending transition refuses other presentation controls while the tabs close, and a reader close ends the wait. When a captured-source tab stays, the ordinary admission reports that the active editor cannot be restored, with this reason as its cause.
   * @param input - The `select` request that met a leftover tab.
   * @returns The state of the admitted selection.
   * @throws The admission's own errors, given before any tab closes where {@link assertSelectionOutlastsClose} can decide them; `PRESENTATION_UNAVAILABLE` when the leftover tab is still active, or when a dead pane could not be closed (no panel is created then; the dead and leftover tabs of other groups may already have closed).
   * @example
   * ```ts
   * const state = await this.selectAfterClosingLeftoverTabs(input) // state.layoutConfirmed === true
   * ```
   */
  private async selectAfterClosingLeftoverTabs(
    input: PresentationIntent,
  ): Promise<PresentationState> {
    const lifetime = this.lifetime,
      transition = {
        id: this.presentationId,
        cancellation: new AbortController(),
      }
    let closed: LeftoverTabClose
    this.presentationTransition = transition
    try {
      // The library key exists only after initialization, so ownership is decided here and not by the caller's synchronous check.
      await this.initialize()
      this.assertLifetime(lifetime)
      this.assertSelectionOutlastsClose(input)
      closed = await this.closeLeftoverTabs()
      if (this.isEditorSettlingAfter(closed))
        await this.waitForEditorAfterClose(
          closed.closedSourceUris,
          transition.cancellation.signal,
        )
    } finally {
      this.endPresentationTransition(transition)
    }
    this.assertLifetime(lifetime)
    // A dead pane that stays would pass for this reader's own Application or Study tab, so the selection ends here, before any panel exists.
    if (closed.deadPaneKept)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'A Codebook pane left by an earlier extension session is still open. Close the leftover Application, Study and Repository Wiki tabs, then select the presentation again.',
        'A leftover Codebook pane could not be closed.',
      )
    // The transition is released in this same turn, so no other control is admitted between it and this second, final admission.
    try {
      return this.admitPresentation(input, closed)
    } catch (error) {
      // Only the synchronous refusal gains the reason; later failures of the admitted change keep their own cause.
      throw this.refusalNamingKeptSource(error, closed)
    }
  }

  /**
   * Says whether the editor still has to bring its tab model and its active text editor into agreement after leftover tabs closed; asked by {@link selectAfterClosingLeftoverTabs} right after the close, before it waits through {@link waitForEditorAfterClose}.
   * @param closed - What {@link closeLeftoverTabs} reported.
   * @returns `true` when a tab closed and no dead pane stayed; `false` when nothing closed, and when a dead pane stayed, because the selection then ends without an admission.
   * @example
   * ```ts
   * this.isEditorSettlingAfter({ closedAny: true, closedSourceUris: [], capturedSourceKept: false, deadPaneKept: false }) // => true
   * ```
   */
  private isEditorSettlingAfter(closed: LeftoverTabClose): boolean {
    return closed.closedAny && !closed.deadPaneKept
  }

  /**
   * Gives the error a selection ends with when its admission after the close refused; called by the failure handler of {@link selectAfterClosingLeftoverTabs} with what {@link admitPresentation} threw.
   * @param error - What the admission threw synchronously.
   * @param closed - What {@link closeLeftoverTabs} reported.
   * @returns A new `PRESENTATION_UNAVAILABLE` refusal with the same message and the kept tab as its cause, when a captured-source tab stayed and the admission refused with that code; otherwise `error` itself.
   * @example
   * ```ts
   * throw this.refusalNamingKeptSource(error, closed) // causeDetail: 'A leftover captured source tab could not be closed.'
   * ```
   */
  private refusalNamingKeptSource(
    error: unknown,
    closed: LeftoverTabClose,
  ): unknown {
    // A refusal met while a captured-source tab stayed open names that tab as its cause.
    if (
      closed.capturedSourceKept &&
      error instanceof StudyError &&
      error.code === 'PRESENTATION_UNAVAILABLE'
    )
      return new StudyError(
        error.code,
        error.message,
        'A leftover captured source tab could not be closed.',
      )
    return error
  }

  /**
   * Admits one presentation change for {@link changePresentation}. Every refusal it decides by itself is thrown before any native effect; only a selection that meets tabs of an earlier host session first closes those tabs through {@link selectAfterClosingLeftoverTabs}, which gives the refusals it can foresee before the close.
   * @param input - The requested change with the reader lifetime and control revision it was made for.
   * @param leftoverTabs - `'pending'` on the first entry; on the single re-entry after {@link selectAfterClosingLeftoverTabs} what {@link closeLeftoverTabs} reported. Only its `closedFocus` changes the admission: the tab the editor activated in place of the closed focused tab is accepted as the place to return to.
   * @returns The state after the admitted change.
   * @throws When the request is stale, competes with a pending change, comes from a background window, or cannot keep the learner's focus.
   * @example
   * ```ts
   * return this.admitPresentation(input, 'pending')
   * ```
   */
  private admitPresentation(
    input: PresentationIntent,
    leftoverTabs: 'pending' | LeftoverTabClose,
  ): Promise<PresentationState> {
    if (input.presentationId !== this.presentationId)
      throw new StudyError(
        'PRESENTATION_INSTANCE_GONE',
        'The named reader lifetime has ended.',
      )
    if (input.expectedRevision !== this.presentationControlRevision)
      throw new StudyError(
        'STALE_PRESENTATION',
        'The presentation control revision changed.',
      )
    this.assertPresentationIdle()
    this.assertLifetime(this.lifetime)
    if (input.action !== 'save-preference' && !vscode.window.state.focused)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Focus this Codebook work window before changing its presentation.',
      )
    const activeInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    // A pane an earlier extension host left behind would pass for this reader's own, and a focused captured-source tab that no text editor shows has no focus that could be kept; a selection closes such tabs before it is admitted. Which captured-source tabs are leftovers is decided by {@link leftoverTabs} once the library key is known.
    if (
      leftoverTabs === 'pending' &&
      input.action === 'select' &&
      (this.deadPaneTabs().length > 0 ||
        (this.isCapturedSourceInput(activeInput) &&
          vscode.window.activeTextEditor?.document.uri.toString() !==
            activeInput.uri.toString()))
    )
      return this.selectAfterClosingLeftoverTabs(input)
    if (input.action === 'focus') return this.focusCurrentPresentation(input)
    if (this.liveComposition || this.summaryComposition) {
      this.assertCompositionAllows(input)
      // Selecting the arrangement that is confirmed already changes nothing: it is read once more without taking the focus, and only a layout that no longer holds is arranged again.
      if (input.action === 'select' && this.presentationState().layoutConfirmed)
        return this.confirmCompositionNoop(input)
      const transition = {
        id: this.presentationId,
        cancellation: new AbortController(),
        runtimeIdentity: this.assertPresentationAdmission(),
      }
      const focusedPane = this.trackFocusedStudyPane(),
        lifetime = this.lifetime
      const returnForeignFocus = this.retainForeignTabFocus(undefined)
      const recordedBundle = this.recordingActive
        ? this.playback?.bundle()
        : undefined
      this.presentationTransition = transition
      this.presentationControlRevision++
      const pending = (async () => {
        try {
          // Read/Enlarge may hide the other main leaf; restore visibility before measuring the two-pane layout.
          await focusedPane.endReadMaximization(async () => {
            await this.expandToEndMaximization()
            this.maximizedByRead = false
            await this.showSideBarsHiddenByRead()
          })
          this.assertLifetime(lifetime)
          transition.cancellation.signal.throwIfAborted()
          focusedPane.assertCurrent()
          await this.arrange(
            transition.cancellation.signal,
            'study',
            false,
            undefined,
            focusedPane.beforeScopeFocus,
          )
          // An arrangement that applied its layout owes no sizes any more; one that arranged nothing (beside a group of the learner's) leaves the groups as an Expand of the reader's left them, and they get their sizes back.
          await this.giveGroupSizesBackAfterExpand(() =>
            focusedPane.assertUndeparted(),
          )
          // The measurement may have left the focus in the main editor; the editor part that held the keyboard (an agent chat) gets it back. The editor does not report that return as a change of its tab groups, so the watched focus is checked for a learner's change before it and not for its return after it.
          if (returnForeignFocus) {
            focusedPane.assertUndeparted()
            focusedPane.dispose()
            await returnForeignFocus()
          }
          this.assertLifetime(lifetime)
          transition.cancellation.signal.throwIfAborted()
          if (!returnForeignFocus) focusedPane.assertCurrent()
          this.assertPlacedEvidenceUnchanged(
            transition.runtimeIdentity,
            recordedBundle,
          )
          this.confirmCompositionByReceipt()
        } catch (error) {
          this.presentationConfirmed = false
          this.presentationReason = String(error)
          await this.returnForeignFocusAfterFailure(
            focusedPane,
            returnForeignFocus,
            lifetime,
          )
          throw error
        } finally {
          focusedPane.dispose()
          this.endPresentationTransition(transition)
          this.publish()
        }
        return this.confirmedCompositionState()
      })().finally(() => {
        if (this.presentationOperation === pending)
          this.presentationOperation = undefined
      })
      this.presentationOperation = pending
      return pending
    }
    const state = this.presentationState()
    if (
      input.action === 'restore' &&
      input.mode === state.mode &&
      this.enlargedLayoutReceipt
    ) {
      return this.confirmEnlargedLayout(input)
    }
    // Selecting the current arrangement repairs geometry without replacing panes or touching foreign previews.
    if (
      (input.action === 'restore' || input.action === 'select') &&
      input.mode === 'study-workspace' &&
      input.mode === state.mode &&
      !state.layoutConfirmed &&
      this.hasStudyPaneColumns() &&
      (this.app?.active ||
        this.contextPanel?.active ||
        vscode.window.activeTextEditor?.document.uri.toString() ===
          this.sourceUri?.toString())
    )
      return this.restoreStudyArrangement(input)
    // A restore of the confirmed layout made while no Study pane and no text editor has the keyboard (an agent's call from the chat, right after its own selection) is answered like that selection: nothing is arranged again and the keyboard stays where it is.
    if (
      (input.action === 'select' ||
        (input.action === 'restore' &&
          !this.app?.active &&
          !this.contextPanel?.active &&
          !vscode.window.activeTextEditor)) &&
      input.mode === state.mode &&
      state.layoutConfirmed &&
      state.preference.status !== 'unknown'
    )
      return this.confirmPresentationNoop(input)
    if (
      input.action === 'save-preference' &&
      (input.mode !== state.mode || !state.layoutConfirmed)
    )
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Only the current confirmed layout can save its preference. Restore the layout first.',
      )
    const runtimeIdentity =
      input.action === 'save-preference'
        ? undefined
        : this.assertPresentationAdmission()
    const activatedByClose =
      leftoverTabs === 'pending'
        ? undefined
        : leftoverTabs.closedFocus?.activatedTab
    const restoreFocus =
      input.action === 'save-preference'
        ? undefined
        : this.capturePresentationFocus(activatedByClose)
    const returnForeignFocus =
      input.action === 'save-preference'
        ? undefined
        : this.retainForeignTabFocus(activatedByClose)
    const transition = {
      id: this.presentationId,
      cancellation: new AbortController(),
      runtimeIdentity,
    }
    this.presentationTransition = transition
    this.presentationControlRevision++
    this.requestedPresentation = input.mode
    this.presentationReason = undefined
    const pending = this.performPresentation(
      input,
      transition,
      restoreFocus,
      returnForeignFocus,
    ).finally(() => {
      if (this.presentationTransition === transition)
        this.presentationTransition = undefined
      if (this.presentationOperation === pending)
        this.presentationOperation = undefined
      this.publish()
    })
    this.presentationOperation = pending
    this.publish()
    return pending
  }

  /** Lets explicit MCP recovery return from another editor to the existing explanation without changing layout or execution. @example await this.focusCurrentPresentation(input) */
  private focusCurrentPresentation(
    input: PresentationIntent,
  ): Promise<PresentationState> {
    const panel =
      this.liveComposition || this.summaryComposition
        ? this.app
        : this.contextPanel
    if (!this.opened || !panel || input.mode !== this.presentationState().mode)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Focus requires an open Study and its current mode. Read presentation state first.',
      )
    const transition = {
      id: this.presentationId,
      cancellation: new AbortController(),
    }
    this.presentationTransition = transition
    this.presentationControlRevision++
    // Latch even a temporary window departure; returning does not renew this request.
    const windowFocus = vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused)
        transition.cancellation.abort(
          new Error('The Codebook work window lost focus.'),
        )
    })
    const pending = this.focusPresentationPanel(
      panel,
      transition.cancellation.signal,
    )
      .then(() => {
        this.lastActiveRegion = 'context'
        return this.presentationState()
      })
      .catch((error: unknown) => {
        throw new StudyError(
          'PRESENTATION_UNAVAILABLE',
          'Study focus could not be confirmed. Read current presentation state before retrying.',
          String(error),
        )
      })
      .finally(() => {
        windowFocus.dispose()
        if (this.presentationTransition === transition)
          this.presentationTransition = undefined
        if (this.presentationOperation === pending)
          this.presentationOperation = undefined
        this.publish()
      })
    this.presentationOperation = pending
    this.publish()
    return pending.then(() => this.presentationState())
  }

  /**
   * Refuses an arrangement of the live or recording panes when what it shows changed while the panes were placed; called by the composition branch of {@link admitPresentation} once the arrangement and the focus return have ended.
   * @param runtimeIdentity - The identity {@link assertPresentationAdmission} gave when the arrangement was admitted.
   * @param recordedBundle - The recording's moment at admission; `undefined` outside a recording.
   * @throws `PRESENTATION_UNAVAILABLE` when a run's pause is another one now, or the recording shows another moment; and what {@link assertPresentationAdmission} throws for a run that is no longer stable.
   * @example this.assertPlacedEvidenceUnchanged(transition.runtimeIdentity, recordedBundle)
   */
  private assertPlacedEvidenceUnchanged(
    runtimeIdentity: string,
    recordedBundle: PlaybackBundle | undefined,
  ): void {
    if (runtimeIdentity !== this.assertPresentationAdmission())
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'The live pause changed during presentation placement.',
      )
    if (recordedBundle && recordedBundle !== this.playback?.bundle())
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'The recorded moment changed during presentation placement.',
      )
  }

  /**
   * Confirms the live or recording arrangement when it holds a layout receipt, and then retires the lines of an earlier refusal; called by the composition branch of {@link admitPresentation} after {@link assertPlacedEvidenceUnchanged}.
   * @example this.confirmCompositionByReceipt() // presentationConfirmed === true after a completed arrangement
   */
  private confirmCompositionByReceipt(): void {
    this.presentationConfirmed = Boolean(this.layoutReceipt)
    if (this.presentationConfirmed) {
      this.presentationReason = undefined
      this.errors.delete('layout')
      this.errors.delete('presentation')
    }
  }

  /**
   * Ends a presentation transition unless a newer one has replaced it; called by the composition branch of {@link admitPresentation} when its arrangement ended, and by {@link selectAfterClosingLeftoverTabs} when its close of the leftover tabs ended, successfully or not.
   * @param transition - The transition that arrangement or close ran in.
   * @example this.endPresentationTransition(transition)
   */
  private endPresentationTransition(
    transition: NonNullable<StudyWorkspace['presentationTransition']>,
  ): void {
    if (this.presentationTransition === transition)
      this.presentationTransition = undefined
  }

  /**
   * Gives the keyboard back to the editor part that held it (an agent chat) when an arrangement of the live or recording panes failed; called by the failure path of the composition branch of {@link admitPresentation}, as a failed selection and a failed open do.
   * @param focusedPane - The focus watch of that arrangement: a focus the learner changed since the request stays where it is.
   * @param returnForeignFocus - What {@link retainForeignTabFocus} answered before the arrangement, `undefined` when no foreign tab had the focus.
   * @param lifetime - The reader lifetime the arrangement began in; a reader closed or closing since gives nothing back ({@link assertLifetime}).
   * @returns Once the focus is given back or left: nothing is thrown, so that the arrangement's own error is the one reported.
   * @example
   * ```ts
   * await this.returnForeignFocusAfterFailure(focusedPane, returnForeignFocus, lifetime)
   * throw error
   * ```
   */
  private async returnForeignFocusAfterFailure(
    focusedPane: ReturnType<StudyWorkspace['trackFocusedStudyPane']>,
    returnForeignFocus: ReturnType<StudyWorkspace['retainForeignTabFocus']>,
    lifetime: number,
  ): Promise<void> {
    try {
      this.assertLifetime(lifetime)
      focusedPane.assertUndeparted()
      await returnForeignFocus?.()
    } catch {
      // A reader that is closed or closing, a newer focus of the learner, or a return the editor refused leaves the keyboard where it is.
    }
  }

  /**
   * Reads the presentation state after the live or recording panes were arranged again and answers with it only when its layout is confirmed; the last step of the composition branch of {@link admitPresentation}.
   * @returns The confirmed state.
   * @throws `PRESENTATION_UNAVAILABLE` with the reason why the layout is not confirmed.
   * @example return this.confirmedCompositionState()
   */
  private confirmedCompositionState(): PresentationState {
    const restored = this.presentationState()
    // The host can replace a pane wrapper after Arrange; a layout lacking its current receipt is not a successful Restore.
    if (!restored.layoutConfirmed)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        unconfirmedCompositionRefusal(this.summaryComposition),
        this.coveredSourceCause() ?? restored.reason,
      )
    return restored
  }

  /**
   * Answers a selection of the live or recording arrangement that is confirmed already; called by {@link admitPresentation}. The state is read once more as a status read does, without taking the focus.
   * @param input - The admitted selection.
   * @returns The confirmed state; or, when the read finds the layout changed, what arranging it again answers.
   * @example
   * ```ts
   * if (input.action === 'select' && this.presentationState().layoutConfirmed) return this.confirmCompositionNoop(input)
   * ```
   */
  private confirmCompositionNoop(
    input: PresentationIntent,
  ): Promise<PresentationState> {
    const lifetime = this.lifetime
    const checking: Promise<PresentationState> = this.readPresentationState()
      .then((state) => {
        this.assertLifetime(lifetime)
        if (this.presentationOperation === checking)
          this.presentationOperation = undefined
        // The read unconfirms a layout that changed, so the repeated request takes the arranging branch.
        if (!state.layoutConfirmed) return this.changePresentation(input)
        this.presentationReason = undefined
        this.errors.delete('presentation')
        return { ...state, state: 'open' as const }
      })
      .finally(() => {
        if (this.presentationOperation === checking)
          this.presentationOperation = undefined
      })
    this.presentationOperation = checking
    return checking
  }

  /** Rechecks actual native geometry before a same-mode no-op, retaining the revision only when no repair is needed. @example await this.confirmPresentationNoop(input) */
  private confirmPresentationNoop(
    input: PresentationIntent,
  ): Promise<PresentationState> {
    const transition = {
        id: this.presentationId,
        cancellation: new AbortController(),
      },
      lifetime = this.lifetime
    this.presentationTransition = transition
    let checking!: Promise<PresentationState>
    // eslint-disable-next-line prefer-const -- the async body compares the shared transition against its own promise.
    checking = (async () => {
      try {
        const layout = await this.readPassivePresentationLayout()
        this.assertLifetime(lifetime)
        transition.cancellation.signal.throwIfAborted()
        const receipt = this.layoutReceipt
        // Another editor part (an agent chat) has the keyboard, so the main grid cannot be measured without taking it: while no tab or group changed since the last arrangement, its confirmation is answered again, marked as not measured, as a status read answers it.
        if (
          layout === undefined &&
          receipt &&
          this.presentationState().layoutConfirmed &&
          this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) &&
          this.sameStudyPanePositions(receipt.panes)
        ) {
          this.errors.delete('presentation')
          this.presentationReason = undefined
          this.requestedPresentation = undefined
          return {
            ...this.presentationState(),
            state: 'open' as const,
            layoutMeasured: false as const,
          }
        }
        // Once a tab or group changed beside a focused tab of another editor part, nobody can focus the main editor first: the panes are arranged again below, which measures it.
        if (layout === undefined && !this.retainForeignTabFocus(undefined))
          throw new StudyError(
            'PRESENTATION_UNAVAILABLE',
            'Focus a Codebook pane or main text editor before confirming this presentation; its layout cannot be checked from the current editor part.',
          )
        if (
          this.presentationState().layoutConfirmed &&
          isProportionalEditorLayout(
            STUDY_PRESENTATIONS[input.mode].layout,
            layout,
          )
        ) {
          // A verified selection recovers only presentation diagnostics, preserving unrelated failed controls.
          this.errors.delete('presentation')
          this.presentationReason = undefined
          this.requestedPresentation = undefined
          return { ...this.presentationState(), state: 'open' as const }
        }
        this.presentationTransition = undefined
        this.presentationConfirmed = false
        return await this.changePresentation(input)
      } finally {
        if (this.presentationTransition === transition) {
          this.presentationTransition = undefined
          this.publish()
        }
        if (this.presentationOperation === checking)
          this.presentationOperation = undefined
      }
    })()
    this.presentationOperation = checking
    return checking
  }

  /** Reconfirms an enlarged Study grid without replacing panes, falling back to normal Restore when geometry changed. @example await this.confirmEnlargedLayout(input) */
  private confirmEnlargedLayout(
    input: PresentationIntent,
  ): Promise<PresentationState> {
    const transition = {
        id: this.presentationId,
        cancellation: new AbortController(),
      },
      lifetime = this.lifetime
    this.presentationTransition = transition
    this.requestedPresentation = input.mode
    this.presentationReason = undefined
    let checking!: Promise<PresentationState>
    // eslint-disable-next-line prefer-const -- the async body compares the shared transition against its own promise.
    checking = (async () => {
      try {
        if (await this.tryConfirmEnlargedLayout(transition))
          return { ...this.presentationState(), state: 'open' as const }
        transition.cancellation.signal.throwIfAborted()
        this.assertLifetime(lifetime)
        if (this.presentationTransition === transition)
          this.presentationTransition = undefined
        return await this.changePresentation(input)
      } finally {
        if (this.presentationTransition === transition)
          this.presentationTransition = undefined
        if (this.presentationOperation === checking)
          this.presentationOperation = undefined
        this.publish()
      }
    })()
    this.presentationOperation = checking
    this.publish()
    return checking
  }

  /**
   * Repairs an existing Study grid without replacing its evidence panes; called by {@link admitPresentation} for a Restore or a selection of the three-pane Study workspace whose layout is not confirmed while one of the reader's panes or the captured source is the active editor, which is the state a Read leaves.
   * The keyboard: this path takes no note of where the keyboard is and gives nothing back ({@link capturePresentationFocus} is asked only on the path behind it). It ends the Read's maximization with the editor's Expand, shows the side bars the Read hid, after which the active editor group has the keyboard again ({@link showSideBarsHiddenByRead}), and applies the Study layout; it reveals no pane and runs no focus command that names one. Where the keyboard is afterwards is therefore what the editor makes of those commands. In VS Code 1.140.0 for Linux the captured source and the Application pane kept it, and after a Read of the Explanation pane the Application pane had it (measured natively on 2026-10-07; which of the editor's steps moves it there is not established).
   * @param input - The admitted Restore or selection.
   * @returns The state after the arrangement, `'open'`.
   * @throws When the window lost the focus, the learner changed the focus or the panes, or the evidence changed during the Restore; the reason is published as the presentation's reason.
   * @example await this.restoreStudyArrangement(intent)
   */
  private restoreStudyArrangement(
    input: PresentationIntent,
  ): Promise<PresentationState> {
    const runtimeIdentity = this.assertPresentationAdmission()
    const focusedPane = this.trackFocusedStudyPane(true)
    const transition = {
      id: this.presentationId,
      cancellation: new AbortController(),
      runtimeIdentity,
    }
    const lifetime = this.lifetime
    this.presentationTransition = transition
    this.presentationControlRevision++
    this.requestedPresentation = input.mode
    this.presentationReason = undefined
    let pending!: Promise<PresentationState>
    // eslint-disable-next-line prefer-const -- the async body compares the shared transition against its own promise.
    pending = (async () => {
      try {
        // The maximized group can hide the other leaves from getEditorLayout; restore its grid before measuring ratios.
        await focusedPane.endReadMaximization(async () => {
          await this.expandToEndMaximization()
          this.maximizedByRead = false
          await this.showSideBarsHiddenByRead()
        })
        transition.cancellation.signal.throwIfAborted()
        this.assertLifetime(lifetime)
        focusedPane.assertCurrent()
        await this.arrange(
          transition.cancellation.signal,
          'study',
          false,
          undefined,
          focusedPane.beforeScopeFocus,
        )
        transition.cancellation.signal.throwIfAborted()
        this.assertLifetime(lifetime)
        focusedPane.assertCurrent()
        // An arrangement that applied its layout owes no sizes any more; one that arranged nothing leaves the groups as an Expand of the reader's left them, and they get their sizes back.
        await this.giveGroupSizesBackAfterExpand(() =>
          focusedPane.assertCurrent(),
        )
        if (
          !vscode.window.state.focused ||
          transition.runtimeIdentity !== this.assertPresentationAdmission() ||
          !this.hasStudyPaneColumns()
        )
          throw new StudyError(
            'PRESENTATION_UNAVAILABLE',
            'Study focus or evidence changed during Restore. Inspect the current panes before retrying.',
          )
        if (this.layoutReceipt && this.sourceReady()) {
          this.presentationConfirmed = true
          this.requestedPresentation = undefined
          this.presentationReason = undefined
          this.errors.delete('presentation')
          this.publish()
          await this.savePresentationPreference(input.mode, transition.id)
        } else {
          // A tab the learner keeps in front of the captured source (an image, a settings page) keeps the panes from being confirmed: the Restore names that tab and the step that clears it, and leaves the grid as it arranged it instead of enlarging the Study pane again.
          const coveringTab = this.coveredSourceCause()
          if (coveringTab)
            throw new StudyError('PRESENTATION_UNAVAILABLE', coveringTab)
          if (
            !(await this.hasRetainedStudyTopology(
              transition.cancellation.signal,
              focusedPane.beforeScopeFocus,
            ))
          )
            throw new StudyError(
              'PRESENTATION_UNAVAILABLE',
              'The Study panes changed during Restore. Existing editor work was preserved.',
            )
          focusedPane.assertCurrent()
          await this.readStudyPane('context', transition.cancellation.signal)
          this.errors.delete('layout')
        }
        return { ...this.presentationState(), state: 'open' as const }
      } catch (error) {
        if (transition.id === this.presentationId) {
          this.presentationConfirmed = false
          this.presentationReason = String(error)
          this.publish()
        }
        throw error
      } finally {
        focusedPane.dispose()
        if (this.presentationTransition === transition)
          this.presentationTransition = undefined
        if (this.presentationOperation === pending)
          this.presentationOperation = undefined
        this.publish()
      }
    })()
    this.presentationOperation = pending
    this.publish()
    return pending
  }

  /** Restores the measured grid after Enlarge through an owned main pane, tolerating a late switch between its panels. @example await this.tryConfirmEnlargedLayout(transition) */
  private async tryConfirmEnlargedLayout(
    transition: NonNullable<StudyWorkspace['presentationTransition']>,
  ): Promise<boolean> {
    const enlarged = this.enlargedLayoutReceipt,
      receipt = enlarged?.receipt
    if (
      !receipt ||
      receipt !== this.layoutReceipt ||
      receipt.mode !== 'study'
    ) {
      if (this.enlargedLayoutReceipt === enlarged)
        this.enlargedLayoutReceipt = undefined
      return false
    }
    const lifetime = this.lifetime,
      id = this.presentationId,
      controlRevision = this.presentationControlRevision
    const selection = JSON.stringify(this.selection),
      bundle = this.recordingActive ? this.playback?.bundle() : undefined
    const runtimeIdentity = this.assertPresentationAdmission()
    const retained = () =>
      this.lifetime === lifetime &&
      this.presentationId === id &&
      this.presentationControlRevision === controlRevision &&
      this.presentationTransition === transition &&
      !transition.cancellation.signal.aborted &&
      !this.closing &&
      vscode.window.state.focused &&
      this.layoutReceipt === receipt &&
      this.presentationMode === enlarged?.mode &&
      JSON.stringify(this.selection) === selection &&
      (!this.recordingActive || this.playback?.bundle() === bundle) &&
      this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) &&
      this.sameStudyPanePositions(receipt.panes) &&
      this.sourceReady() &&
      Boolean(this.app?.visible && this.contextPanel?.visible) &&
      this.hasMainEditorFocus(STUDY_EDITOR_GROUP_COUNT)
    let confirmed = false
    await this.withLayout(
      transition.cancellation.signal,
      async (_layoutLifetime, assertCurrent) => {
        assertCurrent()
        if (this.enlargedLayoutReceipt !== enlarged || !retained()) return
        this.enlargedLayoutReceipt = undefined
        // A late switch between owned Study and Application changes focus, but leaves the measured main grid intact.
        const layout = await vscode.commands.executeCommand<unknown>(
          'vscode.getEditorLayout',
        )
        assertCurrent()
        if (
          !retained() ||
          JSON.stringify(layout) !== enlarged.expandedSignature ||
          runtimeIdentity !== this.assertPresentationAdmission()
        )
          return
        // Editor-layout reads omit maximization, so reapplying the measured grid must clear it before confirmation.
        await vscode.commands.executeCommand(
          'vscode.setEditorLayout',
          JSON.parse(receipt.signature),
        )
        // The measured layout is the one the Enlarge began from: the sizes kept for a Close are given back with it.
        this.groupSizesBeforeExpand = undefined
        assertCurrent()
        const restoredLayout = await vscode.commands.executeCommand<unknown>(
          'vscode.getEditorLayout',
        )
        assertCurrent()
        if (
          !retained() ||
          !isProportionalEditorLayout(
            STUDY_PRESENTATIONS[this.presentationMode].layout,
            restoredLayout,
          ) ||
          runtimeIdentity !== this.assertPresentationAdmission()
        )
          return
        this.presentationControlRevision++
        this.presentationConfirmed = true
        this.requestedPresentation = undefined
        this.presentationReason = undefined
        this.errors.delete('layout')
        this.errors.delete('presentation')
        this.publish()
        await this.savePresentationPreference(this.presentationMode, id)
        assertCurrent()
        confirmed = true
      },
    )
    if (!confirmed && this.enlargedLayoutReceipt === enlarged)
      this.enlargedLayoutReceipt = undefined
    return confirmed
  }

  /** Reads only the mode preference and preserves unknown versions until an explicit learner/agent selection. @example this.readPresentationPreference() */
  private readPresentationPreference(): void {
    try {
      const stored = this.context.workspaceState.get<unknown>(
        PRESENTATION_PREFERENCE_KEY,
      )
      const parsed = presentationPreferenceSchema.safeParse(stored)
      this.presentationMode = parsed.success
        ? parsed.data.mode
        : 'study-workspace'
      this.presentationPreference =
        stored === undefined
          ? { status: 'default' }
          : parsed.success
            ? { status: 'saved', mode: parsed.data.mode }
            : {
                status: 'unknown',
                reason:
                  'Saved presentation is not recognized. Study workspace is temporary; select a mode explicitly to replace this preference.',
              }
    } catch (error) {
      this.presentationPreference = {
        status: 'failed',
        reason: `Presentation preference unavailable: ${String(error)}`,
      }
    }
  }

  /** Separates successful native placement from its optional durable preference receipt; Close drains accepted writes. @example await this.savePresentationPreference(mode, id) */
  private async savePresentationPreference(
    mode: PresentationMode,
    presentationId: string,
  ): Promise<void> {
    this.presentationPreference = { status: 'saving', mode }
    this.publish()
    const write = Promise.resolve().then(() =>
      this.context.workspaceState.update(PRESENTATION_PREFERENCE_KEY, {
        version: PRESENTATION_PREFERENCE_VERSION,
        mode,
      }),
    )
    this.presentationWrite = write
    try {
      await write
      if (presentationId === this.presentationId)
        this.presentationPreference = { status: 'saved', mode }
    } catch (error) {
      if (presentationId === this.presentationId)
        this.presentationPreference = {
          status: 'failed',
          mode,
          reason: `Layout applied; preference not saved: ${String(error)}. Retry Save preference.`,
        }
    } finally {
      if (this.presentationWrite === write) this.presentationWrite = undefined
    }
  }

  /** Admits stable live evidence only; capture, resume reservation and source/navigation work cannot be moved underneath. @example const identity = this.assertPresentationAdmission() */
  private assertPresentationAdmission(): string {
    if (
      this.busy ||
      this.saving ||
      this.pendingHistory !== undefined ||
      this.repositoryNavigation !== undefined ||
      (this.loading && !this.recordingActive)
    )
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Wait for the current control, source or navigation to settle.',
      )
    const active = [...(this.service?.records.values() ?? [])].filter(
      (record) => !record.stopped,
    )
    return JSON.stringify(
      active.map((record) => {
        const view = this.settledRuntimeOf(record).view(),
          participants = Object.values(view.participants)
        this.assertNoCaptureOrResumePending(view, participants)
        this.assertStableOrInspectedPause(view, participants)
        return {
          runId: record.id,
          status: view.status,
          participants: participants.map((participant) => ({
            phase: participant.phase,
            pause: participant.pause,
            snapshotId: participant.snapshot?.id,
          })),
        }
      }),
    )
  }

  /**
   * Says whether a run is still being prepared, is stopping, or has a source reveal under way; the first three conditions {@link settledRuntimeOf} refuses a run for.
   * @param record - A run that has not stopped.
   * @returns `true` while any of the three holds.
   * @example this.isRunInFlux(record) // => true until the run's preparation ended
   */
  private isRunInFlux(record: StudyRecord): boolean {
    return Boolean(
      !record.prepared || record.stopping || record.sourceReveals.size,
    )
  }

  /**
   * Gives the runtime of a run whose preparation, cleanup and source reveals are settled; asked by {@link assertPresentationAdmission} for every run that has not stopped.
   * @param record - A run that has not stopped.
   * @returns The run's runtime.
   * @throws `PRESENTATION_UNAVAILABLE` while {@link isRunInFlux} holds or the run has no runtime yet.
   * @example const view = this.settledRuntimeOf(record).view()
   */
  private settledRuntimeOf(record: StudyRecord): StudyRuntime {
    if (this.isRunInFlux(record) || !record.runtime)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Runtime preparation, cleanup or source reveal is still pending.',
      )
    return record.runtime
  }

  /**
   * Refuses a presentation change while a run captures a phase or was asked to continue; called by {@link assertPresentationAdmission} with each settled run's view.
   * @param view - The run's view.
   * @param participants - The participants of that view.
   * @throws `PRESENTATION_UNAVAILABLE` when a capture is pending or a participant's resume was requested.
   * @example this.assertNoCaptureOrResumePending(view, Object.values(view.participants))
   */
  private assertNoCaptureOrResumePending(
    view: RuntimeView,
    participants: RuntimeParticipant[],
  ): void {
    if (
      Object.values(view.captures).some(
        (capture) => capture.status === 'pending',
      ) ||
      participants.some(
        (participant) => participant.phase === 'resume-requested',
      )
    )
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Wait for the current capture or continue request to settle.',
      )
  }

  /**
   * Says whether a snapshot was taken at another pause than the one its participant is in; asked by {@link isPauseUninspected}.
   * @param snapshotPause - The pause the participant's snapshot names.
   * @param pause - The participant's current pause, if any.
   * @returns `true` when there is no current pause or its generation, session or thread differs.
   * @example this.isSnapshotOfOtherPause(snapshot.pause, participant.pause)
   */
  private isSnapshotOfOtherPause(
    snapshotPause: NonNullable<RuntimeParticipant['pause']>,
    pause: RuntimeParticipant['pause'],
  ): boolean {
    return (
      snapshotPause.generation !== pause?.generation ||
      snapshotPause.sessionId !== pause.sessionId ||
      snapshotPause.threadId !== pause.threadId
    )
  }

  /**
   * Says whether a paused participant's pause is not yet inspected and committed; asked by {@link lacksInspectedPause} for every paused participant.
   * @param participant - A participant whose phase is `paused`.
   * @param view - The run's view.
   * @returns `true` when the participant has no snapshot, its snapshot is of another pause, or the snapshot's phase is not captured.
   * @example paused.some((participant) => this.isPauseUninspected(participant, view))
   */
  private isPauseUninspected(
    participant: RuntimeParticipant,
    view: RuntimeView,
  ): boolean {
    const snapshot = participant.snapshot
    return (
      !snapshot ||
      this.isSnapshotOfOtherPause(snapshot.pause, participant.pause) ||
      view.captures[snapshot.capturePhase]?.status !== 'captured'
    )
  }

  /**
   * Says whether a run that is neither ready nor completed is anything but a committed, inspected pause; asked by {@link assertStableOrInspectedPause}.
   * @param view - The run's view.
   * @param paused - The participants of that view whose phase is `paused`.
   * @returns `true` when the status names no pause, no participant is paused, or {@link isPauseUninspected} holds for one of them.
   * @example this.lacksInspectedPause(view, paused)
   */
  private lacksInspectedPause(
    view: RuntimeView,
    paused: RuntimeParticipant[],
  ): boolean {
    return (
      !view.status.startsWith('paused-') ||
      !paused.length ||
      paused.some((participant) => this.isPauseUninspected(participant, view))
    )
  }

  /**
   * Refuses a presentation change unless a run is ready, completed, or paused with every pause inspected and committed; called by {@link assertPresentationAdmission} after {@link assertNoCaptureOrResumePending}.
   * @param view - The run's view.
   * @param participants - The participants of that view.
   * @throws `PRESENTATION_UNAVAILABLE` for a run in any other state.
   * @example this.assertStableOrInspectedPause(view, Object.values(view.participants))
   */
  private assertStableOrInspectedPause(
    view: RuntimeView,
    participants: RuntimeParticipant[],
  ): void {
    const paused = participants.filter(
      (participant) => participant.phase === 'paused',
    )
    if (
      !['ready', 'completed'].includes(view.status) &&
      this.lacksInspectedPause(view, paused)
    )
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Presentation requires a stable ready/completed run or a committed inspected pause.',
      )
  }

  /**
   * Retains the logical reading region for one admitted handoff; foreign editors still require an exact source receipt. Called by {@link admitPresentation} before a selection or restore changes any pane.
   * @param activatedByClose - The tab the editor activated in place of a focused leftover tab this selection just closed; `undefined` when no focused tab closed or its group is now empty. That tab was never the learner's reading position, so only the group focus is kept.
   * @returns The function that gives focus back once the presentation is placed. Its third argument is `true` only after a confirmed placement: a learner's document that shares the captured source's group then stays open behind that source instead of covering it. For a focused tab that is neither a text editor nor a Study pane (an agent chat, a settings page) the function does nothing: that tab stays where it is, and {@link retainForeignTabFocus} gives its group the focus back.
   * @throws `PRESENTATION_UNAVAILABLE`, naming the tab and how to clear it, when the focused tab is a preview (a pane placed in its group would replace it) or a captured source the editor reports no text editor for.
   * @example
   * ```ts
   * const restore = this.capturePresentationFocus(undefined)
   * ```
   */
  private capturePresentationFocus(
    activatedByClose: vscode.Tab | undefined,
  ): (
    signal?: AbortSignal,
    assertSourceFocus?: () => void,
    placedSourceStays?: boolean,
  ) => Promise<void> {
    const assertOwnedFocus = (assertSourceFocus?: () => void): void => {
      if (this.app?.active || this.contextPanel?.active) return
      // Placement may finish on its stationary source; only its exact focus/selection receipt permits restoration.
      if (!assertSourceFocus)
        throw new Error(
          'Focus changed outside Codebook during placement; it was preserved.',
        )
      assertSourceFocus()
    }
    if (this.app?.active || this.contextPanel?.active) {
      const region = this.app?.active ? 'app' : 'contextPanel',
        lifetime = this.lifetime
      const presentationId = this.presentationId,
        revision = this.presentationControlRevision
      return async (signal, assertSourceFocus): Promise<void> => {
        signal?.throwIfAborted()
        this.assertLifetime(lifetime)
        assertOwnedFocus(assertSourceFocus)
        const panel = this[region]
        // A replacement inherits focus only inside the original admitted transition, never after close/reopen.
        if (!panel || this.hasLeftAdmittedTransition(presentationId, revision))
          throw new Error(
            'The focused Codebook presentation was closed or superseded.',
          )
        await this.focusPresentationPanel(panel, signal)
      }
    }
    const editor = vscode.window.activeTextEditor
    if (editor) {
      const document = editor.document,
        documentVersion = document.version,
        group = vscode.window.tabGroups.activeTabGroup,
        selections = editor.selections,
        restoreReadingPosition = retainEditorReadingPosition(editor),
        preview = group.activeTab?.isPreview ?? false
      return async (
        signal,
        assertSourceFocus,
        placedSourceStays,
      ): Promise<void> => {
        assertOwnedFocus(assertSourceFocus)
        // Edits can retain the same tab/group while invalidating its captured selections and reading position.
        this.assertDocumentVersion(
          document,
          documentVersion,
          'The previously focused document changed during presentation; its current reading position was preserved.',
        )
        const currentGroup = this.focusReturnGroup(document, group)
        // The learner's document stays open behind a captured source that was placed in its own group.
        if (
          this.staysBehindPlacedSource(
            document,
            currentGroup,
            placedSourceStays,
          )
        )
          return
        // It also stays open behind the Application pane that was placed in its group: the pane is never left behind a learner's tab, and it takes the keyboard focus that document had.
        const placedApplication =
          placedSourceStays &&
          this.applicationSharingGroup(document, currentGroup)
        if (placedApplication) {
          await this.focusPresentationPanel(placedApplication, signal)
          return
        }
        const restored = await vscode.window.showTextDocument(document, {
          viewColumn: currentGroup.viewColumn,
          preserveFocus: false,
          preview,
        })
        this.assertDocumentVersion(
          document,
          documentVersion,
          'The previously focused document changed during presentation; its current selections were preserved.',
        )
        restored.selections = selections
        await restoreReadingPosition(restored, signal)
      }
    }
    // An empty group has no document to restore, and neither has the page the editor activated when the focused leftover tab was just closed; retain its group focus after an explicit first entry.
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab
    if (!activeTab || activeTab === activatedByClose)
      return async (): Promise<void> => {
        await vscode.commands.executeCommand(
          'workbench.action.focusActiveEditorGroup',
        )
      }
    const activeColumn = vscode.window.tabGroups.activeTabGroup.viewColumn
    // A preview tab would be replaced by a pane placed in its group, so it refuses the arrangement whichever tab has the focus; the refusal names it and how to clear it.
    if (activeTab.isPreview)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        foreignPreviewObstacle(this.editorTabName(activeTab), activeColumn),
      )
    // A captured source the editor shows without a text editor (a leftover of an earlier session it would not close, or another workspace's) is told by what the tab is: its document is a captured source. It has no reading position to return to. One whose text editor is visible is the reader's own source named beside another editor part that holds the keyboard (Cursor's chat input after a selection made from it): it stays as it is, like a learner's file in that state.
    if (
      this.isCapturedSourceInput(activeTab.input) &&
      !this.hasVisibleTextEditor(activeTab.input.uri, activeColumn)
    )
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        tabWithoutEditorObstacle(this.editorTabName(activeTab), activeColumn),
      )
    // Any other tab stays as it is: an agent chat, a settings page, an image the learner keeps, and a learner's own file that the editor names as the active tab while another part (the chat input) holds the keyboard, so that no text editor is active. {@link retainForeignTabFocus} gives its group the focus back after the last layout read.
    return async (): Promise<void> => {}
  }

  /**
   * Says whether a focused Study pane's handoff is no longer the transition it was admitted in; asked by the focus return {@link capturePresentationFocus} gives for a focused pane, before it focuses the pane's replacement.
   * @param presentationId - The reader's presentation id when the focus was captured.
   * @param revision - The presentation control revision when the focus was captured.
   * @returns `true` when another transition runs, none does, or the control revision is not the one that admission made.
   * @example if (!panel || this.hasLeftAdmittedTransition(presentationId, revision)) throw new Error('The focused Codebook presentation was closed or superseded.')
   */
  private hasLeftAdmittedTransition(
    presentationId: string,
    revision: number,
  ): boolean {
    return (
      this.presentationTransition?.id !== presentationId ||
      this.presentationControlRevision !== revision + 1
    )
  }

  /**
   * Refuses to return the focus to a document that was edited since its focus was captured; called twice by the focus return {@link capturePresentationFocus} gives for a text editor: before it looks for the document's group, and after the editor showed the document again.
   * @param document - The document that had the focus.
   * @param version - Its version when the focus was captured.
   * @param message - What the refusal says was preserved.
   * @throws An `Error` with `message` when the document's version is another one.
   * @example this.assertDocumentVersion(document, documentVersion, 'The previously focused document changed during presentation; its current selections were preserved.')
   */
  private assertDocumentVersion(
    document: vscode.TextDocument,
    version: number,
    message: string,
  ): void {
    if (document.version !== version) throw new Error(message)
  }

  /**
   * Finds the group that shows a document now, for the focus return {@link capturePresentationFocus} gives for a text editor; asked right after the document was found unedited.
   * @param document - The document that had the focus.
   * @param group - The group it was focused in.
   * @returns The source group for the captured source, otherwise the group that is, or has the identity of, `group`.
   * @throws An `Error` when that group is gone or no longer holds a text tab of the document.
   * @example const currentGroup = this.focusReturnGroup(document, group)
   */
  private focusReturnGroup(
    document: vscode.TextDocument,
    group: vscode.TabGroup,
  ): vscode.TabGroup {
    const currentGroup =
      document.uri.toString() === this.sourceUri?.toString()
        ? this.studyPanePositions().sourceGroup
        : vscode.window.tabGroups.all.find(
            (candidate) =>
              candidate === group ||
              this.editorGroupIdentities.get(candidate) ===
                this.editorGroupIdentities.get(group),
          )
    if (
      !currentGroup?.tabs.some(
        (tab) =>
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.toString() === document.uri.toString(),
      )
    )
      throw new Error(
        'The previously focused source group changed; focus was not guessed.',
      )
    return currentGroup
  }

  /**
   * Gives the Application pane when it stands in the group of a learner's document; asked by the focus return {@link capturePresentationFocus} gives for a text editor, after a confirmed placement.
   * @param document - The document that had the focus.
   * @param currentGroup - The group that shows it now.
   * @returns The Application pane when it is in that group's column and the document is not the captured source; otherwise `undefined`.
   * @example const placedApplication = placedSourceStays && this.applicationSharingGroup(document, currentGroup)
   */
  private applicationSharingGroup(
    document: vscode.TextDocument,
    currentGroup: vscode.TabGroup,
  ): vscode.WebviewPanel | undefined {
    return this.app &&
      currentGroup.viewColumn === this.app.viewColumn &&
      document.uri.toString() !== String(this.sourceUri)
      ? this.app
      : undefined
  }

  /**
   * Remembers the tab the editor names as active when no text editor and no Study pane has the focus, so a selection or a restore is admitted without closing or moving that tab; called by {@link admitPresentation} for every arrangement and by {@link confirmPresentationNoop}, by {@link sampleKeyboardOutsideEditors} for the record of a pause, and by {@link close} before it ends a Read. Cursor's Agent chat is such a tab of an editor group while it is shown as a tab of another editor part; and while its chat input holds the keyboard there, Cursor can name a learner's own file of the main editor as the active tab without an active text editor. Nobody can focus anything else while the agent works. While Cursor shows that chat as a pane of the secondary side bar, the editor names an active text editor beside it, as VS Code does beside its chat view, and nothing is remembered.
   * @param activatedByClose - The tab the editor activated in place of a focused leftover tab this selection just closed; {@link capturePresentationFocus} keeps that group's focus itself.
   * @returns
   * - `undefined` when a Study pane or a text editor has the focus, no tab is active, the active tab is a Study pane's, or the focused tab is one {@link capturePresentationFocus} refuses or handles (a preview, a captured source without a text editor, `activatedByClose`).
   * - Otherwise the function that gives the keyboard back once the panes are arranged, and answers whether it ran a focus command. Called with `true` by {@link returnsKeyboardToChatAtPause} and {@link judgeKeyboardAtPauseEnd}, it gives the keyboard back at a pause without asking the editor where the focus is (the caller knows that a text editor has it: the paused file the editor's debugger opened, or the captured source shown in its place), and then only to the chat through {@link CURSOR_FOCUS_AGENT_COMMAND}: a tab of one of the main editor's groups gets nothing back at a pause, like a learner's file. {@link returnsKeyboardToChatAfterSideBars} calls it with `true` in the same way after a close showed a side bar a Read hid: the caller knows that the bar's command took the keyboard. A tab of one of the main editor's groups gets it through the editor's focus command for that group, while the tab is still the one its group shows. A tab of another editor part (Cursor's Agent chat), and the chat input that held the keyboard while the editor named a learner's file without an active text editor, get it through {@link CURSOR_FOCUS_AGENT_COMMAND} where the host registers it: the numbered focus command of such a group's column would open a new empty group in the main editor, so it is never run for it, and without the host's command the focus stays where the arrangement ended. The keyboard is given back only for a group no Study pane uses and while the focus is where the arrangement left it (a Codebook pane, the captured source, or the file's editor the measurement focused); in every other case the focus stays and nothing is guessed.
   * @example
   * ```ts
   * const returnForeignFocus = this.retainForeignTabFocus(undefined)
   * await this.arrange(signal)
   * await returnForeignFocus?.()
   * ```
   */
  private retainForeignTabFocus(
    activatedByClose: vscode.Tab | undefined,
  ): ((takenByEditor?: boolean) => Promise<boolean>) | undefined {
    if (this.hasActiveStudyPane() || vscode.window.activeTextEditor)
      return undefined
    const group = vscode.window.tabGroups.activeTabGroup,
      activeTab = group.activeTab
    const heldUri = this.textTabUriHeldByAnotherPart(activeTab, group)
    const heldByAnotherPart = heldUri !== undefined
    const tab = this.foreignTabToReturnTo(
      activeTab,
      activatedByClose,
      heldByAnotherPart,
    )
    if (!tab) return undefined
    const column = group.viewColumn,
      groupCount = vscode.window.tabGroups.all.length
    /** Names the kind of a tab's input; a tab the editor API has no input kind for (the chat) has none. */
    const inputKind = (input: unknown): unknown =>
      typeof input === 'object' && input !== null
        ? Object.getPrototypeOf(input)
        : undefined
    // The editor may replace its tab objects with every tab change, so the tab is known by its label and its kind of input.
    const showsThatTab = (candidate: vscode.TabGroup): boolean =>
      candidate.activeTab?.label === tab.label &&
      inputKind(candidate.activeTab.input) === inputKind(tab.input)
    const borrowsBefore = this.mainEditorFocusBorrows
    return async (takenByEditor = false): Promise<boolean> => {
      // Groups the arrangement opened or closed in the main editor shift the column of a group behind them.
      const shownColumn =
        column + vscode.window.tabGroups.all.length - groupCount
      const target = heldByAnotherPart
        ? undefined
        : vscode.window.tabGroups.all.find(
            (candidate) =>
              candidate.viewColumn === shownColumn && showsThatTab(candidate),
          )
      const active = vscode.window.tabGroups.activeTabGroup,
        activeUri =
          active.activeTab?.input instanceof vscode.TabInputText
            ? active.activeTab.input.uri.toString()
            : undefined,
        panes = this.studyPanePositions()
      // The focus is given back only from where the arrangement or its measurement left it, and never to a group a Study pane uses or one that is gone. The arrangement leaves it on a Codebook pane, the captured source or the learner's file it focused. The measurement leaves it in the first group, which the editor names then, or still names the group it named before: Cursor reports no focus of a pane beside the chat.
      const leftByMeasurement =
        this.mainEditorFocusBorrows !== borrowsBefore &&
        (active.viewColumn === vscode.ViewColumn.One ||
          active.viewColumn === target?.viewColumn)
      if (
        !vscode.window.state.focused ||
        (!heldByAnotherPart &&
          (!target ||
            [panes.appColumn, panes.sourceColumn, panes.contextColumn].includes(
              target.viewColumn,
            ))) ||
        !(
          leftByMeasurement ||
          takenByEditor ||
          this.app?.active ||
          this.contextPanel?.active ||
          (activeUri !== undefined &&
            (activeUri === this.sourceUri?.toString() ||
              (activeUri === heldUri && active.viewColumn === column)))
        )
      )
        return false
      const command = await this.focusReturnCommand(target, takenByEditor)
      if (command) await vscode.commands.executeCommand(command)
      return command !== undefined
    }
  }

  /**
   * Chooses the command that gives a remembered tab's group the keyboard back; asked by the function {@link retainForeignTabFocus} answers, once it knows that the focus may be given back.
   * The editor's numbered focus commands count the groups of the main editor only: for the column of another editor part's group (Cursor's chat) the command opens a new empty group in the main editor. Only a group that is known to be one of the main editor's is focused by its number, and only a tab that is known to lie outside the main editor gets the host's own command for its chat; while the main editor's group count is not known nothing is run for a group, and the focus stays where it is. Without the host's command it stays too. At a pause, and after a close that showed a side bar a Read hid, only the chat gets the keyboard back: another tab of the main editor (a settings page, an image) is treated like a learner's file, which gets nothing back there, because the editor reads the same for such a tab whether the keyboard was in it or in the terminal, a view or a side-view chat.
   * @param target - The group that still shows the remembered tab, `undefined` for a tab another editor part held the keyboard over.
   * @param takenByEditor - Whether the editor itself took the keyboard from the remembered tab, as the caller knows, and it is not given back after an arrangement: at a pause of a live run ({@link settleKeyboardAtPause}), where the editor's debugger opened the paused file with the keyboard, and at a close that ends a Read ({@link returnsKeyboardToChatAfterSideBars}), where the editor's command showed a side bar with the keyboard.
   * @returns
   * - The numbered focus command of a group of the main editor, after an arrangement only.
   * - {@link CURSOR_FOCUS_AGENT_COMMAND} for a tab of another editor part or one held by another part, where the host registers it.
   * - `undefined` for a group of the main editor at a pause and after a close that ends a Read, for a group that is not known to be the main editor's or another part's ({@link placeOfRememberedGroup}), and in a host without the chat's command.
   * @example
   * ```ts
   * await this.focusReturnCommand(chatGroup, true) // => 'composer.focusComposer' in Cursor
   * await this.focusReturnCommand(settingsGroup, true) // => undefined
   * ```
   */
  private async focusReturnCommand(
    target: vscode.TabGroup | undefined,
    takenByEditor: boolean,
  ): Promise<string | undefined> {
    const place = await this.placeOfRememberedGroup(target)
    if (place === 'other') return this.chatFocusCommand()
    if (place === 'unknown' || takenByEditor) return undefined
    return focusEditorGroupCommand(place)
  }

  /**
   * Names the host's command that focuses its chat, where the host registers one; asked by {@link focusReturnCommand} for a remembered tab that is known to lie outside the main editor.
   * @returns {@link CURSOR_FOCUS_AGENT_COMMAND} in Cursor, `undefined` in a host without it.
   * @example await this.chatFocusCommand() // => 'composer.focusComposer' in Cursor, undefined in VS Code
   */
  private async chatFocusCommand(): Promise<string | undefined> {
    return (await vscode.commands.getCommands(true)).includes(
      CURSOR_FOCUS_AGENT_COMMAND,
    )
      ? CURSOR_FOCUS_AGENT_COMMAND
      : undefined
  }

  /**
   * Says where the group of a remembered tab lies: in the main editor, in another editor part, or in a place the editor does not tell; asked by {@link focusReturnCommand} before it chooses a command.
   * The editor answers a layout read for the editor part that has the focus, so the count it gives is the main editor's only when the main editor is known to have the focus ({@link hasMainEditorFocus}). Without that proof the count still says two things ({@link placeByUnprovenCount}); for every other group nothing is guessed.
   * @param group - The group that still shows the remembered tab, `undefined` for a text tab another editor part held the keyboard over.
   * @returns
   * - The group's view column for a group of the main editor.
   * - `'other'` for no group (the keyboard was in another editor part by what the editor reported) and for a group that lies behind the main editor's groups.
   * - `'unknown'` for a group that may be either, and when the layout could not be read.
   * @example await this.placeOfRememberedGroup(group) // => 3 for the third group of the main editor, 'other' for the chat's group at column 4
   */
  private async placeOfRememberedGroup(
    group: vscode.TabGroup | undefined,
  ): Promise<vscode.ViewColumn | 'other' | 'unknown'> {
    const count = editorLayoutGroupCount(
      await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'),
    )
    if (!group) return 'other'
    if (count === undefined) return 'unknown'
    return this.hasMainEditorFocus(count)
      ? this.placeByMainCount(group, count)
      : this.placeByUnprovenCount(group, count)
  }

  /**
   * Says where a group lies by the main editor's group count; the step of {@link placeOfRememberedGroup} for a layout read the main editor is known to have answered.
   * @param group - The group that still shows the remembered tab.
   * @param mainCount - How many groups the main editor has.
   * @returns The group's view column when the main editor holds it, `'other'` for a group behind its groups.
   * @example this.placeByMainCount(chatGroup, 3) // => 'other' for the chat's group at column 4
   */
  private placeByMainCount(
    group: vscode.TabGroup,
    mainCount: number,
  ): vscode.ViewColumn | 'other' {
    return group.viewColumn <= mainCount ? group.viewColumn : 'other'
  }

  /**
   * Says what a group count tells about a group when the count may be another editor part's; the step of {@link placeOfRememberedGroup} for a layout read that came without proof of the main editor's focus.
   * - The count equals the number of tab groups the editor names: there is one editor part, and every group is the main editor's.
   * - The count is smaller and the group is the last one the editor names: groups of another editor part come behind the main editor's, so the last group is another part's whichever part answered (Cursor's chat beside the main editor).
   * - Any other group may be the main editor's (when the other part answered) or another part's, and stays unknown.
   * @param group - The group that still shows the remembered tab.
   * @param count - The group count of the layout read.
   * @returns The group's view column, `'other'` or `'unknown'` as above.
   * @example this.placeByUnprovenCount(chatGroup, 1) // => 'other' beside two groups of the main editor
   */
  private placeByUnprovenCount(
    group: vscode.TabGroup,
    count: number,
  ): vscode.ViewColumn | 'other' | 'unknown' {
    const named = vscode.window.tabGroups.all.length
    if (count === named) return group.viewColumn
    return group.viewColumn === named ? 'other' : 'unknown'
  }

  /**
   * Starts the record of the keyboard outside the text editors and the Study panes for the whole editor session; called once by {@link installReaders}.
   * The record must exist before a run pauses: the editor's debugger opens the paused file with the keyboard before any code of the reader runs for that pause. With it the reader follows every debug session's stops ({@link followStopsOf}).
   * @example this.watchKeyboardOutsideEditors()
   */
  private watchKeyboardOutsideEditors(): void {
    const sample = (): void => this.sampleKeyboardOutsideEditors()
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs(() => {
        sample()
        this.noteLearnersSignAtFrame(this.keptPreviewTabOfFrame())
      }),
      vscode.window.tabGroups.onDidChangeTabGroups(sample),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        sample()
        this.noteLearnersSignAtFrame(this.isLearnersEditor(editor))
      }),
      vscode.window.onDidChangeTextEditorSelection((change) =>
        this.noteLearnersSelection(change),
      ),
      vscode.debug.onDidChangeActiveStackItem(() =>
        this.judgeKeyboardAtStackItemChange(),
      ),
      // The editor reports a stop and a frame the learner selects the same way; only the adapter's own messages tell them apart.
      vscode.debug.registerDebugAdapterTrackerFactory('*', {
        createDebugAdapterTracker: (session) => this.followStopsOf(session),
      }),
    )
    sample()
  }

  /**
   * Follows the stops of one debug session for the reader; called by the editor through the tracker factory of {@link watchKeyboardOutsideEditors} when a session of any debug type starts.
   * The adapter's `stopped` event reaches this tracker in the extension host before the editor opens the paused file and reports the stack frame, so {@link cameWithStop} finds it when that frame arrives. The editor makes a tracker for every adapter it starts, also for the new adapter of a session it restarts under the same id, and tells it when that adapter is stopped or exits.
   * @param session - The session that starts.
   * @returns The tracker, which reads each message of that session's adapter ({@link readAdaptersMessage}), notes when the editor lets the session go on, which puts a noted stop of it in doubt ({@link noteSessionWentOn}), and forgets the session when it ends ({@link forgetSession}).
   * @example vscode.debug.registerDebugAdapterTrackerFactory('*', { createDebugAdapterTracker: (session) => this.followStopsOf(session) })
   */
  private followStopsOf(
    session: vscode.DebugSession,
  ): vscode.DebugAdapterTracker {
    this.followedSessions.add(session.id)
    return {
      onDidSendMessage: (message: unknown): void =>
        this.readAdaptersMessage(session.id, message),
      // An adapter need not send `continued` after the editor's own resume or step: the request says it too.
      onWillReceiveMessage: (message: unknown): void => {
        if (isDebugResumeMessage(message)) this.noteSessionWentOn(session.id)
      },
      // The editor stops the adapter, or the adapter exits by itself: either is the session's end, and both may come.
      onWillStopSession: (): void => this.forgetSession(session.id),
      onExit: (): void => this.forgetSession(session.id),
    }
  }

  /**
   * Reads one message of a debug adapter for what it says about the session's stops; called by the tracker of {@link followStopsOf} for every message the adapter sends.
   * - A `stopped` event is noted ({@link noteStopOf}).
   * - An `invalidated` event for the session's threads or stacks is noted like a stop ({@link isDebugStopsInvalidation}): both editors then handle the stops of that session again, which opens the paused file with the keyboard and reports a frame, and no `stopped` event comes with it.
   * - A `continued` event is noted as the moment the session went on, which puts its noted stop in doubt ({@link noteSessionWentOn}).
   * @param sessionId - The session of the adapter.
   * @param message - The message as the tracker receives it.
   * @example onDidSendMessage: (message) => this.readAdaptersMessage(session.id, message)
   */
  private readAdaptersMessage(sessionId: string, message: unknown): void {
    const stop = debugStopOf(message)
    if (stop) {
      // A session that stops runs no longer: its frame is focused until it goes on again.
      this.sessionsWentOnAtMs.delete(sessionId)
      this.noteStopOf(sessionId, stop)
    } else if (isDebugStopsInvalidation(message))
      this.noteStopOf(sessionId, { reason: undefined, keepsFocus: false })
    else if (isDebugResumeMessage(message)) this.noteSessionWentOn(sessionId)
  }

  /**
   * Notes that a debug session goes on: the moment is kept for {@link cameBeforeFocusPass}, and a stop of that session the editor has not shown yet is put in doubt ({@link doubtStopOf}); called by {@link readAdaptersMessage} for the adapter's `continued` event and by the tracker of {@link followStopsOf} for the editor's resume and step requests ({@link isDebugResumeMessage}).
   * The last such message counts: the editor starts its pass of the focus anew with each of them, and this tracker reads each before the editor's window does.
   * @param sessionId - The session that goes on.
   * @example if (isDebugResumeMessage(message)) this.noteSessionWentOn(session.id)
   */
  private noteSessionWentOn(sessionId: string): void {
    this.sessionsWentOnAtMs.set(sessionId, performance.now())
    this.doubtStopOf(sessionId)
  }

  /**
   * Drops what the reader keeps of a debug session that ended; called by the tracker of {@link followStopsOf} when the editor stops that session's adapter and when the adapter exits.
   * Without it the reader would keep the id of every debug session of the whole editor session, child sessions and every replay's sessions too, and a stop the editor never showed would stay noted for a session that is gone.
   * @param sessionId - The session that ended.
   * @example onWillStopSession: () => this.forgetSession(session.id)
   */
  private forgetSession(sessionId: string): void {
    this.followedSessions.delete(sessionId)
    this.announcedStops.delete(sessionId)
    this.sessionsWentOnAtMs.delete(sessionId)
  }

  /**
   * Notes a stop a debug adapter reported, for the frame the editor reports next, and ends the chat's record when the learner started that stop from an editor; called by {@link readAdaptersMessage} for every `stopped` event, and for an `invalidated` event that makes the editor handle the session's stops again.
   * A stop after a step ({@link LEARNER_STARTED_STOP_REASONS}) that is reported while a text editor has the keyboard was made by a learner who works in that editor: the keyboard is not to go to the chat at this stop, at a later render of it or when the run goes on, however short a time ago the learner came from the chat. While no text editor is active (the chat has the keyboard, and the step came from the debug toolbar) the record stays.
   * The note says when the stop was read, whether the editor's own handling of it may leave it in the background, and behind which other session's frame it was read ({@link StopNote}): both editors bring a stop to the front, with the keyboard into the paused file, only when the adapter did not ask to keep the focus and no frame of another session has it (VS Code 1.140 and Cursor 3.23, the stop handling of their debug sessions: `if(!p||p.thread.session===this)` for the view model's focused frame `p`).
   * @param sessionId - The session that stopped.
   * @param stop - What {@link debugStopOf} read: the reason the adapter gave, if any, and whether it asked to keep the focus.
   * @example this.noteStopOf(session.id, { reason: 'step', keepsFocus: false })
   */
  private noteStopOf(
    sessionId: string,
    stop: NonNullable<ReturnType<typeof debugStopOf>>,
  ): void {
    this.announcedStops.set(sessionId, {
      readAtMs: performance.now(),
      isDoubtful: stop.keepsFocus,
      behindSessionId: this.sessionOfFrameShownBeside(sessionId),
    })
    if (this.isLearnersStopFromEditor(stop.reason))
      this.keyboardOutsideEditors = undefined
  }

  /**
   * Names the other debug session whose frame Run and Debug shows while a given session stops; asked by {@link noteStopOf} when a stop is read.
   * The editor keeps the frame of a session that went on as its focused one for about 200 ms, and that of a session that is still paused for as long as it is: a stop of another session that is read meanwhile is not brought to the front at once by its own handling.
   * @param sessionId - The session that stopped.
   * @returns The id of the session of the active stack item while that item is a frame of another session; `undefined` for a frame of the same session, for a thread and without an item.
   * @example this.sessionOfFrameShownBeside('live-next-server') // => 'live-next-browser' while the browser session's frame is shown
   */
  private sessionOfFrameShownBeside(sessionId: string): string | undefined {
    const item = vscode.debug.activeStackItem
    return isStackFrameItem(item) && item.session.id !== sessionId
      ? item.session.id
      : undefined
  }

  /**
   * Marks the noted stop of a session that goes on as doubtful; called by {@link noteSessionWentOn} for every message that says so.
   * The note is not dropped there: a run that resumes its own stop at once does so before the editor reported that stop's frame, and the frame still arrives, with the keyboard in the paused file. A frame that arrives later than {@link STOP_OWN_FOCUS_BOUND_MS} after the stop was read is none of that stop: the learner selected it (another thread of the session is still paused), and it is not taken for a stop the editor never showed.
   * @param sessionId - The session that goes on.
   * @example this.doubtStopOf(sessionId)
   */
  private doubtStopOf(sessionId: string): void {
    const note = this.announcedStops.get(sessionId)
    if (note) note.isDoubtful = true
  }

  /**
   * Says whether a stop was started by the learner with the keyboard in a text editor; asked by {@link noteStopOf} when the adapter reports the stop, before the editor's debugger opens the paused file.
   * @param reason - The reason the adapter gave for the stop, if any.
   * @returns `true` for one of {@link LEARNER_STARTED_STOP_REASONS} while a text editor is the active one; `false` for every other reason, for none, and while no text editor is active.
   * @example this.isLearnersStopFromEditor('step') // => true while the learner steps in "actions.ts"
   */
  private isLearnersStopFromEditor(reason: string | undefined): boolean {
    return (
      reason !== undefined &&
      LEARNER_STARTED_STOP_REASONS.has(reason) &&
      vscode.window.activeTextEditor !== undefined
    )
  }

  /**
   * Says whether a stack frame the editor reports came with a stop of the debugger and not with the learner's choice of a frame in the Call Stack view, and takes the stop's note; asked by {@link judgeKeyboardAtStackItemChange} for every frame.
   * @param sessionId - The session of the frame.
   * @returns `true` when that session's adapter reported a stop since its last frame and the editor's own handling of that stop brought the frame ({@link wasShownByItsStop}), and for a session that started before this reader, whose adapter it does not hear: every frame of such a session counts as a stop, as nothing tells them apart. `false` for a frame without a stop (the learner selected it) and for a frame of a stop the editor brought to the front later and without the keyboard.
   * @example this.frameCameWithStop = this.cameWithStop(item.session.id)
   */
  private cameWithStop(sessionId: string): boolean {
    if (!this.followedSessions.has(sessionId)) return true
    const note = this.announcedStops.get(sessionId)
    this.announcedStops.delete(sessionId)
    return note !== undefined && this.wasShownByItsStop(note)
  }

  /**
   * Says whether the frame that arrives now was brought to the front by the editor's own handling of the stop a note stands for, which opens the paused file with the keyboard; asked by {@link cameWithStop}.
   * A stop the editor's handling may leave in the background ({@link StopNote}) reaches the front in two other ways, both without the keyboard: the editor passes the focus to a session that is still stopped (`passFocusScheduler` of both editors, which focuses the frame preserving the focus), and the learner selects its frame in the Call Stack view.
   * - A stop read behind another session's frame is judged by the editor's own rule ({@link cameBeforeFocusPass}), not by a time since the stop: its handling tries twice, right after the top frame is loaded and again once the rest of the stack is, at least 420 ms later, and takes the keyboard when by then no frame is focused.
   * - A stop whose adapter asked to keep the focus, or whose session went on before a frame of it was reported, counts for a frame within {@link STOP_OWN_FOCUS_BOUND_MS} of the stop: there only the first try can bring it, right after the adapter's answers.
   * - A stop nothing put in doubt has no bound: an adapter that is slow to answer delays the frame, and the keyboard is in the paused file all the same.
   * @param note - What {@link noteStopOf} noted of the stop.
   * @returns `true` for a stop nothing put in doubt, for a doubtful one whose frame arrives within the bound, and for one read behind another session's frame whose frame arrives before the editor can pass the focus; `false` otherwise.
   * @example return note !== undefined && this.wasShownByItsStop(note)
   */
  private wasShownByItsStop(note: StopNote): boolean {
    if (
      note.behindSessionId !== undefined &&
      !this.cameBeforeFocusPass(note.behindSessionId)
    )
      return false
    return (
      !note.isDoubtful ||
      performance.now() - note.readAtMs <= STOP_OWN_FOCUS_BOUND_MS
    )
  }

  /**
   * Says whether a frame that arrives now comes before the editor can pass the focus on from the session whose frame hid the stop; asked by {@link wasShownByItsStop} for a stop read behind another session's frame.
   * The editor passes the focus {@link EDITOR_FOCUS_PASS_DELAY_MS} after that session went on, from a timer it starts anew with each such message, and without the keyboard. Before that, only the stop's own handling brings its frame, with the keyboard; if that handling has not come by then, the pass comes first in the editor too, and the handling then leaves the focused frame alone. So the same clock decides in the editor and here, and a slow or busy machine moves both together. While the other session is still paused, its frame keeps the focus and the stop's handling brings nothing: a frame that arrives then is one the learner selected.
   * What stays unknown: a frame whose event reaches the extension host a few milliseconds after the bound although the editor focused it just before, which is then taken for a pass (the pane comes without the keyboard); and a frame the learner selects in the Call Stack view within the bound, which is taken for a stop (the pane takes the keyboard and says so). For a session this reader does not follow (it started before the reader, or it has ended) nothing is known, and the stop counts: a pane that takes the keyboard and tells the learner is the safer error, because the other one leaves the keyboard on no element without a word.
   * @param otherSessionId - The session whose frame had the focus when the stop was read.
   * @returns `true` less than {@link EDITOR_FOCUS_PASS_DELAY_MS} after that session was last seen to go on, and for a session this reader does not follow; `false` from that delay on, and while that session has not gone on since its own stop.
   * @example this.cameBeforeFocusPass('live-next-server') // => true 467 ms after the server session went on, false 800 ms after it
   */
  private cameBeforeFocusPass(otherSessionId: string): boolean {
    if (!this.followedSessions.has(otherSessionId)) return true
    const wentOnAtMs = this.sessionsWentOnAtMs.get(otherSessionId)
    return (
      wentOnAtMs !== undefined &&
      performance.now() - wentOnAtMs < EDITOR_FOCUS_PASS_DELAY_MS
    )
  }

  /**
   * Reads from the editor whether a tab outside the text editors and the Study panes has the keyboard, on every tab, group and active-editor change and on every change of a pane's view state; called by the listeners of {@link watchKeyboardOutsideEditors}, by the view-state listeners of {@link bindApplicationPanel} and {@link bindContextPanel} (a pane's `active` flag is one of the readings, and the editor reports it on its own channel, possibly after the tab events of the same click), and by {@link judgeKeyboardAtPauseEnd} when a pause is over.
   * A foreign tab that has it ({@link retainForeignTabFocus}) is remembered: the record is new, also during a pause, when the learner went to the chat, and keeps only the pause the old one noted. A text editor or a Study pane that becomes active afterwards only marks the moment ({@link markKeyboardLeftForEditors}); a pane's tab the editor merely names says nothing. The record is read all the time, between pauses and during them: the editor reports a pause as a stack frame and the running session as its thread, and no state of that item stops the reading.
   * @example this.sampleKeyboardOutsideEditors()
   */
  private sampleKeyboardOutsideEditors(): void {
    const giveBack = this.retainForeignTabFocus(undefined)
    // A new reading of the chat keeps the pause the record noted: the chat that got the keyboard back at a pause is read again right after, and the pause is still that one.
    if (giveBack)
      this.keyboardOutsideEditors = {
        giveBack,
        pause: this.keyboardOutsideEditors?.pause,
      }
    else if (this.hasKeyboardInEditors()) this.markKeyboardLeftForEditors()
  }

  /**
   * Marks the moment a text editor or a Study pane became active after a foreign tab had the keyboard; called by {@link sampleKeyboardOutsideEditors} when the editor names no such tab any more and a text editor or Study pane is the active one.
   * The record is not ended there: the editor's debugger opens the paused file that way a moment before it reports the stack frame, also for a stop that follows the reader's return of the stop before, and {@link judgeKeyboardAtPauseBegin} tells that from a learner who went to a file. The first such moment is kept. An editor that has the keyboard because of the pause itself is no such moment ({@link holdsKeyboardByPause}).
   * @example this.markKeyboardLeftForEditors()
   */
  private markKeyboardLeftForEditors(): void {
    const remembered = this.keyboardOutsideEditors
    if (!remembered || this.holdsKeyboardByPause(remembered.pause)) return
    remembered.leftAtMs ??= performance.now()
  }

  /**
   * Says whether the active editor has the keyboard because of the pause the chat's record notes, and not by the learner's choice; asked by {@link markKeyboardLeftForEditors}.
   * @param pause - The pause the record notes, if any.
   * @returns `true` while the reader's return of that pause runs (the editor is the captured source it just showed), and while that return is still owed and the active text editor is the file the debugger opened for the pause ({@link holdsDebuggersFileOfPause}); `false` without a pause, for any other editor, and for every editor once the return is done.
   * @example if (!remembered || this.holdsKeyboardByPause(remembered.pause)) return
   */
  private holdsKeyboardByPause(
    pause: KeyboardPauseOfRecord | undefined,
  ): boolean {
    return (
      pause !== undefined &&
      (pause.state === 'settling' ||
        (pause.state === 'unsettled' &&
          this.holdsDebuggersFileOfPause(pause.openedByDebugger)))
    )
  }

  /**
   * Says whether the file the editor's debugger opened at a pause is the active text editor still; asked by {@link holdsKeyboardByPause} and {@link holdsKeyboardSinceBreak}.
   * @param openedByDebugger - The document that was the active text editor when the pause's frame was reported, `undefined` when no text editor was active then.
   * @returns `true` when that document is the active text editor now; `false` for another document and for none.
   * @example this.holdsDebuggersFileOfPause(pause.openedByDebugger)
   */
  private holdsDebuggersFileOfPause(
    openedByDebugger: string | undefined,
  ): boolean {
    return (
      openedByDebugger !== undefined &&
      openedByDebugger === this.activeTextDocumentUri()
    )
  }

  /**
   * Says whether the editor names a text editor or a Study pane as the active one; asked by {@link sampleKeyboardOutsideEditors}, {@link leavesRecordAfterPause} and {@link close}.
   * In Cursor's tab layout of the Agent chat that means the keyboard is there and not in the chat. In VS Code, and in Cursor while the chat is a pane of the secondary side bar, it is also what the editor reads while the chat, the terminal or a view has the keyboard.
   * @returns `true` when a text editor or one of the reader's two panes is active.
   * @example this.hasKeyboardInEditors() // => false while Cursor's chat tab has the keyboard
   */
  private hasKeyboardInEditors(): boolean {
    return Boolean(vscode.window.activeTextEditor) || this.hasActiveStudyPane()
  }

  /**
   * Follows the pauses of the editor's debugger, on every change of Run and Debug's active stack item; called by the listener of {@link watchKeyboardOutsideEditors}.
   * - A stack frame that came with a stop of the debugger ({@link cameWithStop}) is a pause: the debugger opened the paused file with the keyboard ({@link judgeKeyboardAtPauseBegin}).
   * - A stack frame without a stop is one the learner selected in the Call Stack view, or one the editor brought to the front without the keyboard: the editor opened its file without the keyboard, which stays where the learner has it. The reader then takes nothing and returns nothing for that pause any more ({@link leavePauseToLearner}), until the learner gives a sign of working in the editor it would cover ({@link noteLearnersSignAtFrame}).
   * - A thread without a frame, which the editor reports once the session runs again, and no item are the time between pauses ({@link judgeKeyboardAtPauseEnd}).
   * @example this.judgeKeyboardAtStackItemChange()
   */
  private judgeKeyboardAtStackItemChange(): void {
    const item = vscode.debug.activeStackItem
    this.frameCameWithStop =
      isStackFrameItem(item) && this.cameWithStop(item.session.id)
    // What the learner did before this item says nothing about it: the editor opened the frame's file before it reported the frame.
    this.learnerChoseEditorAtFrame = false
    this.previewTabOfFrame = this.previewTabInFront()
    if (this.frameCameWithStop) this.judgeKeyboardAtPauseBegin()
    else if (isStackFrameItem(item)) this.leavePauseToLearner()
    else this.judgeKeyboardAtPauseEnd()
  }

  /**
   * Takes a sign that the learner works in the active text editor, while the editor shows a frame whose file it opened without the keyboard ({@link showsFrameOpenedWithoutKeyboard}); called by the listeners of {@link watchKeyboardOutsideEditors} with what the second or the third sign answered, and by {@link noteLearnersSelection} for the first.
   * For such a frame nothing the editor reports says where the keyboard went afterwards: a click of the mouse into the Call Stack view, a double click or Enter there (which give the file the keyboard) and the editor's "Navigate Up/Down Call Stack" commands (which do too) all report the file's opening and then the frame, in that order. So the reader does not decide by the gesture. It takes what the editor reports after the frame: the learner clicked or typed in the active text editor ({@link isLearnersSelection}), a text editor became the active one ({@link isLearnersEditor}), or the frame's preview tab was kept open ({@link keptPreviewTabOfFrame}). From then on {@link replacesEditorFocusedByPause} and {@link keepsKeyboardFromPane} treat the covered editor as one that has the keyboard. Without a sign the keyboard is taken to be where the learner had it.
   * @param given - Whether the sign was given.
   * @example this.noteLearnersSignAtFrame(this.isLearnersEditor(editor))
   */
  private noteLearnersSignAtFrame(given: boolean): void {
    if (given && this.showsFrameOpenedWithoutKeyboard())
      this.learnerChoseEditorAtFrame = true
  }

  /**
   * Takes the first sign, a selection the learner made in the active text editor, wherever the debugger stands; called by the selection listener of {@link watchKeyboardOutsideEditors}.
   * At a frame it counts like the other signs, until the next stack item ({@link noteLearnersSignAtFrame}). While no frame is shown (a session runs, or none exists) it is the only sign, and it counts for a short time only ({@link workedInEditorJustNow}).
   * @param change - The change the editor reports.
   * @example vscode.window.onDidChangeTextEditorSelection((change) => this.noteLearnersSelection(change))
   */
  private noteLearnersSelection(
    change: vscode.TextEditorSelectionChangeEvent,
  ): void {
    if (!this.isLearnersSelection(change)) return
    this.learnerWorkedInEditorAtMs = performance.now()
    this.noteLearnersSignAtFrame(true)
  }

  /**
   * Says whether Run and Debug shows a frame whose file the editor opened without giving it the keyboard; asked by {@link noteLearnersSignAtFrame}.
   * @returns `true` for a frame that came without a stop (the learner selected it, or the editor brought it to the front later), and for a frame of a stop while the learner's `debug.focusEditorOnBreak` is off; `false` for a stop's frame whose file the debugger gave the keyboard, for a thread and without an item.
   * @example this.showsFrameOpenedWithoutKeyboard() // => true after a click on a frame in the Call Stack view
   */
  private showsFrameOpenedWithoutKeyboard(): boolean {
    return (
      isStackFrameItem(vscode.debug.activeStackItem) &&
      !this.debuggerGaveEditorKeyboard()
    )
  }

  /**
   * Says whether the editor's debugger gave the file of the frame it shows the keyboard; asked by {@link showsFrameOpenedWithoutKeyboard}, {@link keepsKeyboardFromPane}, {@link holdsKeyboardInActiveEditor} and {@link tellPaneTookKeyboard}.
   * @returns `true` while the frame of a stop is shown ({@link frameCameWithStop}) and `debug.focusEditorOnBreak` is not turned off; `false` for a frame without a stop, with that setting off, for a thread and without an item.
   * @example this.debuggerGaveEditorKeyboard() // => false at a stop of a learner who turned "debug.focusEditorOnBreak" off
   */
  private debuggerGaveEditorKeyboard(): boolean {
    return (
      this.frameCameWithStop &&
      vscode.workspace
        .getConfiguration('debug')
        .get<boolean>('focusEditorOnBreak') !== false
    )
  }

  /**
   * Says whether the learner gave a sign of working in the active text editor that still holds; asked by {@link keepsKeyboardFromPane} and {@link holdsKeyboardInActiveEditor}.
   * @returns At a frame, what {@link noteLearnersSignAtFrame} noted since that frame; while no frame is shown, whether the learner clicked or pressed a key in the active text editor a moment ago ({@link workedInEditorJustNow}).
   * @example if (this.learnerWorksInActiveEditor()) return false
   */
  private learnerWorksInActiveEditor(): boolean {
    return isStackFrameItem(vscode.debug.activeStackItem)
      ? this.learnerChoseEditorAtFrame
      : this.workedInEditorJustNow()
  }

  /**
   * Says whether the learner clicked or pressed a key in the active text editor within {@link LEARNER_SIGN_FRESH_MS}; the half of {@link learnerWorksInActiveEditor} for the time without a frame.
   * While a session runs nothing the editor reports ends a sign: a learner who goes from the file to a side-view chat, the terminal or a view is not reported. So only a fresh sign counts there, and a text editor that merely becomes active counts for nothing, since the Explorer, Quick Open and an agent that opens the files it edits make one active all through a run without giving it the keyboard.
   * @returns `true` within that time after the last such selection; `false` later and without one.
   * @example this.workedInEditorJustNow() // => false five seconds after the learner's last key press in the file
   */
  private workedInEditorJustNow(): boolean {
    return (
      this.learnerWorkedInEditorAtMs !== undefined &&
      performance.now() - this.learnerWorkedInEditorAtMs <=
        LEARNER_SIGN_FRESH_MS
    )
  }

  /**
   * Says whether a change of a text editor's selection is the learner's own in the active text editor: the first sign of {@link noteLearnersSignAtFrame}.
   * The editor names how a selection changed: by the keyboard or the mouse for the learner's own typing, cursor keys and clicks, and by a command for everything else, which includes the editor's own jump to a frame's line and a selection an extension sets ({@link LEARNER_SELECTION_KINDS}).
   * @param change - The change the editor reports.
   * @returns `true` for a change by the keyboard or the mouse in the active text editor; `false` for any other kind, for none, and for another editor.
   * @example this.isLearnersSelection(change) // => true after a click into the frame's file
   */
  private isLearnersSelection(
    change: vscode.TextEditorSelectionChangeEvent,
  ): boolean {
    return (
      LEARNER_SELECTION_KINDS.has(change.kind) &&
      change.textEditor === vscode.window.activeTextEditor
    )
  }

  /**
   * Says whether a text editor that became the active one is a file of the learner's choice: the second sign of {@link noteLearnersSignAtFrame}.
   * The editor opens a frame's file before it reports the frame, so a text editor that becomes active after the frame was opened by something else: the learner's click on a tab or into another group, or a file the learner opened. The reader's own captured source is none of that: the reader shows it at every render, with or without the keyboard. The price: a file the learner opens from the Explorer with one click becomes active without the keyboard and counts too.
   * @param editor - The text editor the editor reports as the active one now, if any.
   * @returns `true` for a text editor that shows no captured source; `false` for the captured source and for none.
   * @example this.isLearnersEditor(vscode.window.activeTextEditor)
   */
  private isLearnersEditor(editor: vscode.TextEditor | undefined): boolean {
    return (
      editor !== undefined && editor.document.uri.scheme !== STUDY_SOURCE_SCHEME
    )
  }

  /**
   * Names the file and the group of the tab in front of the active group when it is a preview tab of a text document; read by {@link judgeKeyboardAtStackItemChange} at every stack item, for {@link keptPreviewTabOfFrame}.
   * A frame's file that was not open before is opened as a preview tab by one click in the Call Stack view, and stays one until the learner keeps it.
   * @returns The document's URI and the group's view column, or `undefined` for a tab that is kept open, a tab that shows no text document, and an empty group.
   * @example this.previewTabOfFrame = this.previewTabInFront()
   */
  private previewTabInFront():
    NonNullable<StudyWorkspace['previewTabOfFrame']> | undefined {
    const group = vscode.window.tabGroups.activeTabGroup
    const uri = this.textTabUri(group.activeTab)
    return group.activeTab?.isPreview && uri !== undefined
      ? { uri, column: group.viewColumn }
      : undefined
  }

  /**
   * Says whether the preview tab the editor showed for the frame was kept open since and is still in front: the third sign of {@link noteLearnersSignAtFrame}.
   * A double click on a frame in the Call Stack view, and Enter there, open the frame's file a second time, with the keyboard and as a tab that is kept: for a frame that is already the selected one, the editor reports nothing else of it (no new frame, no new active editor, and the selection stays on the frame's line). A tab that is kept because its file was changed says nothing about the keyboard, since an agent's edit keeps a preview tab too.
   * The current tab is read by document and view column: Cursor 3.23 rebuilds its tab objects on a whole-model update, leaving a remembered object's preview and dirty values stale. VS Code 1.140 reconciles existing tab IDs, but the third sign must work in both editors.
   * @returns `true` when the tab in front of the active group shows the document noted at the frame in the same view column, is no preview tab and has no unsaved change; `false` otherwise, and when the frame's tab was no preview tab.
   * @example this.noteLearnersSignAtFrame(this.keptPreviewTabOfFrame())
   */
  private keptPreviewTabOfFrame(): boolean {
    const noted = this.previewTabOfFrame
    const group = vscode.window.tabGroups.activeTabGroup
    return (
      noted !== undefined &&
      group.viewColumn === noted.column &&
      this.isKeptTabOf(group.activeTab, noted.uri)
    )
  }

  /**
   * Says whether a tab shows a given document as a kept tab without unsaved changes; asked by {@link keptPreviewTabOfFrame} about the tab in front of the active group.
   * @param tab - The tab, read from the editor now.
   * @param uri - The document's URI as a string.
   * @returns `true` for a text tab of that document that is no preview tab and not dirty; `false` otherwise, and without a tab.
   * @example this.isKeptTabOf(group.activeTab, noted.uri)
   */
  private isKeptTabOf(tab: vscode.Tab | undefined, uri: string): boolean {
    return (
      tab !== undefined &&
      this.textTabUri(tab) === uri &&
      !tab.isPreview &&
      !tab.isDirty
    )
  }

  /**
   * Marks the pause the chat's record notes as settled without a return, when the learner selects another frame of it in the Call Stack view; the step of {@link judgeKeyboardAtStackItemChange} for a frame without a stop.
   * The learner works in the editor's own views then: a return to the chat, at the reader's next reveal or when the pause ends, would take the keyboard from there.
   * @example this.leavePauseToLearner()
   */
  private leavePauseToLearner(): void {
    const pause = this.keyboardOutsideEditors?.pause
    if (pause?.state === 'unsettled') pause.state = 'settled'
  }

  /**
   * Judges the chat's record when the editor reports a stack frame; the first half of {@link judgeKeyboardAtStackItemChange}.
   * Every frame is taken as a stop of its own: a thread that goes on and stops again within the 200 ms the editor waits before it reports a running session is reported as a frame after a frame, with no item between them (two breakpoints of one request). {@link leftChatBeforePause} tells the paused file the debugger opened from a file the learner chose earlier: the learner's choice ends the record. The debugger's own opening leaves it, and the pause is noted on the record with the document the debugger opened, for the reader's one return of that pause. The same holds for a stop that follows a settled one: an editor that became active after the reader's return is the next paused file when its frame follows within that time, and the learner's choice otherwise. A frame the learner selects in the Call Stack view is no stop and does not come here ({@link cameWithStop}).
   * @example this.judgeKeyboardAtPauseBegin()
   */
  private judgeKeyboardAtPauseBegin(): void {
    const remembered = this.keyboardOutsideEditors
    if (!remembered) return
    if (this.leftChatBeforePause(remembered.leftAtMs)) {
      this.keyboardOutsideEditors = undefined
      return
    }
    remembered.leftAtMs = undefined
    remembered.pause = {
      openedByDebugger: this.activeTextDocumentUri(),
      state: 'unsettled',
    }
  }

  /**
   * Ends the pause the chat's record noted, when the editor reports a thread or no item, and reads the record again; the second half of {@link judgeKeyboardAtStackItemChange}.
   * A return that {@link endsPauseOfRecord} started is not followed by a reading: the debugger's file is still the active editor until the chat's command is answered.
   * @example this.judgeKeyboardAtPauseEnd()
   */
  private judgeKeyboardAtPauseEnd(): void {
    if (!this.endsPauseOfRecord()) this.sampleKeyboardOutsideEditors()
  }

  /**
   * Removes a pause that is over from the chat's record and settles what it leaves ({@link leavesRecordAfterPause}); the first step of {@link judgeKeyboardAtPauseEnd}.
   * @returns `true` when the chat's focus command was started for a pause the reader had not settled; `false` otherwise, and without a record or a noted pause.
   * @example if (!this.endsPauseOfRecord()) this.sampleKeyboardOutsideEditors()
   */
  private endsPauseOfRecord(): boolean {
    const remembered = this.keyboardOutsideEditors
    if (!remembered?.pause) return false
    const pause = remembered.pause
    remembered.pause = undefined
    if (this.leavesRecordAfterPause(pause)) return false
    // A return the editor refuses leaves the keyboard where it is.
    void remembered.giveBack(true).catch(() => false)
    return true
  }

  /**
   * Decides what a pause that is over leaves of the chat's record, and ends the record where the learner chose an editor; asked by {@link endsPauseOfRecord}.
   * - Neither a text editor nor a Study pane is active: the chat has the keyboard, and the record stays. So it does while the reader's return of that pause still runs.
   * - The reader settled the pause and a text editor or Study pane is active: the learner chose it after the return, and the record ends.
   * - The pause ended before the reader settled it and another text editor than the debugger's, or a Study pane, is active: it was chosen during the pause, and the record ends.
   * - The pause ended before the reader settled it, and the file the debugger opened for it is still the active text editor beside a live run ({@link holdsKeyboardSinceBreak}): nobody chose that file and nothing of the reader took its place, as when the run resumes a stop by itself. The record stays, and the chat is owed the keyboard now.
   * @param pause - The pause the record noted.
   * @returns `false` only in the last case; `true` when nothing more is to be done.
   * @example if (this.leavesRecordAfterPause(pause)) return false
   */
  private leavesRecordAfterPause(pause: KeyboardPauseOfRecord): boolean {
    if (pause.state === 'settling' || !this.hasKeyboardInEditors()) return true
    if (this.choseEditorAtPause(pause)) {
      this.keyboardOutsideEditors = undefined
      return true
    }
    return false
  }

  /**
   * Says whether the editor that is active when a pause is over was the learner's choice; asked by {@link leavesRecordAfterPause} once a text editor or Study pane is known to be active.
   * @param pause - The pause the record noted.
   * @returns `true` for a pause the reader settled (the chat had the keyboard after it), and for an unsettled one unless the debugger's own file is still the active text editor beside a live run ({@link holdsKeyboardSinceBreak}).
   * @example if (this.choseEditorAtPause(pause)) this.keyboardOutsideEditors = undefined
   */
  private choseEditorAtPause(pause: KeyboardPauseOfRecord): boolean {
    return (
      pause.state === 'settled' ||
      !this.holdsKeyboardSinceBreak(pause.openedByDebugger)
    )
  }

  /**
   * Says whether the file the editor's debugger opened at a break still has the keyboard beside a live run; asked by {@link choseEditorAtPause}.
   * Only beside a live run of Codebook ({@link hasLiveRun}): in a debug session of the learner's own the reader moves no keyboard.
   * @param openedByDebugger - The document that was the active text editor when the pause's frame was reported, if any.
   * @returns `true` when a live run's viewport exists and that document is the active text editor now; `false` for another document, for none, and without a live run.
   * @example this.holdsKeyboardSinceBreak(pause.openedByDebugger)
   */
  private holdsKeyboardSinceBreak(
    openedByDebugger: string | undefined,
  ): boolean {
    return this.hasLiveRun() && this.holdsDebuggersFileOfPause(openedByDebugger)
  }

  /**
   * Says whether a live run of Codebook exists, which is the only time the reader gives the keyboard back to a chat; asked by {@link holdsKeyboardSinceBreak} for the return at a pause's end and by {@link isStoppedBesideLiveRun} for the return at a reveal.
   * A live run holds the lease of its Application pane from its start to its end, also while the Study workspace is closed. Without one, a paused debug session is the learner's own, or the reader shows a saved study: the reader moves no keyboard then.
   * @returns `true` while a run's viewport exists.
   * @example this.hasLiveRun() // => false while the Study workspace shows a saved study and no run was started
   */
  private hasLiveRun(): boolean {
    return this.viewport !== undefined
  }

  /**
   * Names the document of the active text editor; read by {@link judgeKeyboardAtPauseBegin} and {@link holdsDebuggersFileOfPause}, which compare it across a pause.
   * @returns The document's URI as a string, `undefined` while no text editor is active.
   * @example this.activeTextDocumentUri() // => 'file:///work/app/lib/actions.ts'
   */
  private activeTextDocumentUri(): string | undefined {
    return vscode.window.activeTextEditor?.document.uri.toString()
  }

  /**
   * Says whether a text editor or Study pane that became active before a pause was the learner's own choice; asked by {@link judgeKeyboardAtPauseBegin} when Run and Debug selects a stack item.
   * The editor's debugger awaits the opening of the paused file, with the keyboard, and selects the stack item after it (Cursor 3.23.12, `focusStackFrame` of its workbench), so the extension host sees that file become the active text editor a moment before it sees the pause. An editor that became active within {@link PAUSE_FOCUS_LOOKBACK_MS} before the stack item is taken as that opening. The price: a learner who goes from the chat to a file within that time before a pause is treated as still being in the chat.
   * @param leftAtMs - The moment {@link markKeyboardLeftForEditors} marked, `undefined` when no editor became active since the foreign tab had the keyboard.
   * @returns `true` when an editor became active more than {@link PAUSE_FOCUS_LOOKBACK_MS} ago; `false` within that time and without a marked moment.
   * @example this.leftChatBeforePause(performance.now() - 1_001) // => true
   */
  private leftChatBeforePause(leftAtMs: number | undefined): boolean {
    return (
      leftAtMs !== undefined &&
      performance.now() - leftAtMs > PAUSE_FOCUS_LOOKBACK_MS
    )
  }

  /**
   * Says whether the debugger stopped and the frame of that stop is still the one the editor reports, while no recording is open; asked by {@link isStoppedBesideLiveRun}, which also asks for a live run ({@link hasLiveRun}).
   * A pause is told by a stack frame ({@link isStackFrameItem}): once the session runs again the editor reports its thread, which is no pause. The frame must have come with a stop ({@link cameWithStop}): for a frame the learner selected in the Call Stack view the editor opened the file without the keyboard. While a recording is open the frame is the historical debugger's, which opens no file with the keyboard for a new pause.
   * @returns `true` while Run and Debug's active stack item is a frame that came with a stop and no recording is open.
   * @example this.isStoppedOutsideRecording() // => false while the debugged program runs, after the learner selected another frame, and while a recording is replayed
   */
  private isStoppedOutsideRecording(): boolean {
    return (
      !this.recordingActive &&
      this.frameCameWithStop &&
      isStackFrameItem(vscode.debug.activeStackItem)
    )
  }

  /**
   * Settles the keyboard at a pause of a live run, right after the reader showed the captured source there without being asked for the keyboard; called by {@link renderSelection}.
   * At a pause the editor's debugger opens the paused file with the keyboard, and the captured source that takes that file's place takes the keyboard with it. Where the chat had the keyboard just before the pause (Cursor's Agent chat as a tab of another editor part), it gets the keyboard back and nothing is told ({@link returnsKeyboardToChatAtPause}). Where the reader knows of no such chat (a learner in a file or on another tab of the main editor, and every side-view chat: VS Code's, and Cursor's Agent pane in the secondary side bar), the keyboard stays and the learner is told once ({@link tellPaneTookPausedFocus}) when the source took it. The Application pane settles the same question through its viewport's lease, before its reveal ({@link presentation}).
   * A return the editor refuses (its layout read, its command list or the chat's focus command rejects) leaves the keyboard where it is and is treated as no return: a keyboard courtesy never fails the render that called it.
   * @param tookKeyboard - Whether the captured source took the keyboard from the paused file.
   * @returns Once the keyboard is given back, found where it was, or left with the sentence told.
   * @example await this.settleKeyboardAtPause(takesPausedFocus)
   */
  private async settleKeyboardAtPause(tookKeyboard: boolean): Promise<void> {
    const gaveBack = await this.returnsKeyboardToChatAtPause().catch(
      () => false,
    )
    if (tookKeyboard && !gaveBack) this.tellPaneTookKeyboard()
  }

  /**
   * Gives the keyboard back to the chat that had it just before a pause, once for each pause; the first step of {@link settleKeyboardAtPause}, and the second half of {@link keepsKeyboardFromPane}, which answers the Application pane's viewport before it reveals the pane over the paused file.
   * A pause is settled at the reader's first reveal after its frame was reported ({@link owedPauseOf}): a later render of the same pause runs nothing, so a file, the captured source or a pane the learner chose meanwhile keeps the keyboard, and such a choice ends the record when the pause ends ({@link endsPauseOfRecord}) or, for a stop that follows without an end, by the time it was made ({@link judgeKeyboardAtPauseBegin}). The keyboard is taken from a text editor only: the paused file the editor's debugger opened, or the captured source shown in its place. While no text editor is active it is not known to have left the chat, and nothing is run.
   * @returns
   * - `true` when the function {@link retainForeignTabFocus} answered ran the chat's focus command, now or for an earlier asker of the same pause ({@link returnMadeAtPause}).
   * - `false` without a record that notes an unsettled pause beside a live run, while no text editor is active, and when that function gave nothing back (the remembered tab is one of the main editor's or not known to be the chat's, its group is gone or a Study pane's, the window lost the focus, or the host has no command for its chat).
   * @throws What the editor's layout read, its command list or the chat's focus command rejected with.
   * @example const gaveBack = await this.returnsKeyboardToChatAtPause()
   */
  private async returnsKeyboardToChatAtPause(): Promise<boolean> {
    const remembered = this.keyboardOutsideEditors
    if (!remembered) return false
    const pause = this.owedPauseOf(remembered)
    if (!pause) return this.returnMadeAtPause(remembered)
    pause.state = 'settling'
    pause.returned = this.returnKeyboardOfPause(remembered, pause)
    return pause.returned
  }

  /**
   * Runs the one return of a pause and marks the pause as settled when it is over; the step of {@link returnsKeyboardToChatAtPause} for a pause whose return was still owed.
   * @param remembered - The chat's record.
   * @param pause - Its pause, already marked as settling.
   * @returns `true` when the chat's focus command ran; `false` while no text editor is active and when nothing could be given back.
   * @throws What the editor's layout read, its command list or the chat's focus command rejected with.
   * @example pause.returned = this.returnKeyboardOfPause(remembered, pause)
   */
  private async returnKeyboardOfPause(
    remembered: NonNullable<StudyWorkspace['keyboardOutsideEditors']>,
    pause: KeyboardPauseOfRecord,
  ): Promise<boolean> {
    try {
      return (
        vscode.window.activeTextEditor !== undefined &&
        (await remembered.giveBack(true))
      )
    } finally {
      // From here an editor that becomes active is the learner's choice or the next stop's paused file; one that became active while the return ran was the captured source.
      pause.state = 'settled'
      remembered.leftAtMs = undefined
    }
  }

  /**
   * Answers a second asker of a pause with the return the first one began; the step of {@link returnsKeyboardToChatAtPause} for a pause that is not owed a return any more.
   * While that return runs, and after it for as long as no editor became active (the editor may not have reported the chat's focus yet), the answer is the return's own: a pane that comes to the front for the same stop must not take the keyboard the chat is getting or has got. Once an editor became active after the return, the learner chose it, and the old answer no longer holds.
   * @param remembered - The chat's record.
   * @returns The return of the record's pause, or `false` without a pause, for a pause that never began a return (the learner selected a frame first), and after the learner chose an editor.
   * @example if (!pause) return this.returnMadeAtPause(remembered)
   */
  private returnMadeAtPause(
    remembered: NonNullable<StudyWorkspace['keyboardOutsideEditors']>,
  ): Promise<boolean> | false {
    const returned = remembered.pause?.returned
    return returned !== undefined && this.holdsAnswerOfReturn(remembered)
      ? returned
      : false
  }

  /**
   * Says whether the answer of a pause's return still holds for another asker; the second half of {@link returnMadeAtPause}.
   * @param remembered - The chat's record, whose pause began a return.
   * @returns `true` while that return runs, and after it for as long as no editor became active; `false` once one did.
   * @example returned !== undefined && this.holdsAnswerOfReturn(remembered)
   */
  private holdsAnswerOfReturn(
    remembered: NonNullable<StudyWorkspace['keyboardOutsideEditors']>,
  ): boolean {
    return (
      remembered.pause?.state === 'settling' ||
      remembered.leftAtMs === undefined
    )
  }

  /**
   * Answers the Application pane's viewport, right before it reveals the pane over the active text editor, whether the pane is to come to the front without the keyboard ({@link presentation}).
   * @returns
   * - `false` once the learner gave a sign of working in that editor that still holds ({@link learnerWorksInActiveEditor}): the pane takes the keyboard, since a hidden editor cannot keep it.
   * - `true` without such a sign whenever the debugger did not give that editor the keyboard ({@link debuggerGaveEditorKeyboard}): at a frame without a stop, at a stop with `debug.focusEditorOnBreak` off, and while no frame is shown. The keyboard stays where the learner has it.
   * - `true` when the chat that had the keyboard before the stop got it back now ({@link returnsKeyboardToChatAtPause}).
   * - `false` when the debugger gave the covered file the keyboard and the reader knows of nobody to give it back to: the pane takes it.
   * @example comesWithoutKeyboard: () => this.keepsKeyboardFromPane()
   */
  private async keepsKeyboardFromPane(): Promise<boolean> {
    if (this.learnerWorksInActiveEditor()) return false
    if (!this.debuggerGaveEditorKeyboard()) return true
    return this.returnsKeyboardToChatAtPause()
  }

  /**
   * Says whether the active text editor has the keyboard as far as the reader can know, outside a recording: by the debugger's stop, or by the learner's own sign; asked by {@link replacesEditorFocusedByPause}.
   * @returns `true` when the debugger gave the frame's file the keyboard ({@link debuggerGaveEditorKeyboard}) or the learner gave a sign that still holds ({@link learnerWorksInActiveEditor}), while no recording is open.
   * @example this.holdsKeyboardInActiveEditor() // => true after the learner clicked into the file of a frame selected in the Call Stack view
   */
  private holdsKeyboardInActiveEditor(): boolean {
    return (
      !this.recordingActive &&
      (this.debuggerGaveEditorKeyboard() || this.learnerWorksInActiveEditor())
    )
  }

  /**
   * Finds the pause of the chat's record whose one return is still owed; asked by {@link returnsKeyboardToChatAtPause}, which marks that return as running and then as done.
   * @param remembered - The record.
   * @returns The pause, when the record notes one beside a live run that no reveal of the reader settled yet; `undefined` without a live run (a debug session of the learner's own, a saved study), between pauses, while a recording is open, and for a pause whose return runs or is done.
   * @example const pause = this.owedPauseOf(remembered)
   */
  private owedPauseOf(
    remembered: NonNullable<StudyWorkspace['keyboardOutsideEditors']>,
  ): KeyboardPauseOfRecord | undefined {
    const pause = remembered.pause
    if (pause?.state !== 'unsettled') return undefined
    return this.isStoppedBesideLiveRun() ? pause : undefined
  }

  /**
   * Says whether the frame of a stop is shown beside a live run of Codebook, outside a recording; the second half of {@link owedPauseOf}.
   * @returns `true` when {@link hasLiveRun} and {@link isStoppedOutsideRecording} both hold.
   * @example return this.isStoppedBesideLiveRun() ? pause : undefined
   */
  private isStoppedBesideLiveRun(): boolean {
    return this.hasLiveRun() && this.isStoppedOutsideRecording()
  }

  /**
   * Names the document of a text tab; read by {@link textTabUriHeldByAnotherPart} for the tab the editor names as active.
   * @param tab - The active tab, if any.
   * @returns The document's URI as a string for a text tab, `undefined` for any other tab and for none.
   * @example this.textTabUri(vscode.window.tabGroups.activeTabGroup.activeTab)
   */
  private textTabUri(tab: vscode.Tab | undefined): string | undefined {
    return tab?.input instanceof vscode.TabInputText
      ? tab.input.uri.toString()
      : undefined
  }

  /**
   * Says whether another editor part holds the keyboard over a text tab; asked by {@link textTabUriHeldByAnotherPart} once no Study pane and no text editor is active.
   * A text tab named as the active tab while its text editor is visible and no text editor is active: another editor part (the chat input) holds the keyboard, and the editor does not name that part's group. That holds for a learner's file and for the reader's own captured source. A text tab that has no text editor at all says nothing about another part.
   * @param tab - The active tab, if any.
   * @param group - The group the editor names as active.
   * @returns `true` for a text tab whose text editor is visible in that group; `false` for any other tab, a text tab without a text editor, and no tab.
   * @example this.isTextTabHeldByAnotherPart(group.activeTab, group)
   */
  private isTextTabHeldByAnotherPart(
    tab: vscode.Tab | undefined,
    group: vscode.TabGroup,
  ): boolean {
    return (
      tab?.input instanceof vscode.TabInputText &&
      this.hasVisibleTextEditor(tab.input.uri, group.viewColumn)
    )
  }

  /**
   * Names the document of the active tab when another editor part holds the keyboard over it; read by {@link retainForeignTabFocus} once no Study pane and no text editor is active.
   * @param tab - The active tab, if any.
   * @param group - The group the editor names as active.
   * @returns The document's URI as a string when {@link isTextTabHeldByAnotherPart} holds; otherwise `undefined`.
   * @example const heldUri = this.textTabUriHeldByAnotherPart(group.activeTab, group)
   */
  private textTabUriHeldByAnotherPart(
    tab: vscode.Tab | undefined,
    group: vscode.TabGroup,
  ): string | undefined {
    const namedUri = this.textTabUri(tab)
    return this.isTextTabHeldByAnotherPart(tab, group) ? namedUri : undefined
  }

  /**
   * Says whether a tab is Codebook's own and has no focus to give back: a captured source without a text editor, or a Study pane's tab; the last condition of {@link isTabWithoutFocusReturn}.
   * The editor can still name a Study pane's tab as the active one while another editor part has the keyboard: that is no foreign tab to return to. A captured source without a text editor has no focus that could be kept.
   * @param tab - The tab the editor names as active.
   * @param heldByAnotherPart - Whether another editor part holds the keyboard over that tab's visible text editor.
   * @returns `true` for a captured source that is not held by another part, and for an Application or Study pane's tab.
   * @example this.isCodebookTabWithoutFocus(tab, false)
   */
  private isCodebookTabWithoutFocus(
    tab: vscode.Tab,
    heldByAnotherPart: boolean,
  ): boolean {
    return (
      (this.isCapturedSourceInput(tab.input) && !heldByAnotherPart) ||
      this.isCodebookPaneInput(
        tab.input,
        'codebook.scopedBrowser',
        'codebook.studyContext',
      )
    )
  }

  /**
   * Says whether the active tab is one {@link retainForeignTabFocus} gives no focus back to; asked by {@link foreignTabToReturnTo}.
   * @param tab - The tab the editor names as active.
   * @param activatedByClose - The tab the editor activated in place of a focused leftover tab this selection just closed.
   * @param heldByAnotherPart - Whether another editor part holds the keyboard over that tab's visible text editor.
   * @returns `true` for the tab activated by that close, a preview, and a tab {@link isCodebookTabWithoutFocus} names.
   * @example this.isTabWithoutFocusReturn(tab, undefined, false)
   */
  private isTabWithoutFocusReturn(
    tab: vscode.Tab,
    activatedByClose: vscode.Tab | undefined,
    heldByAnotherPart: boolean,
  ): boolean {
    return (
      tab === activatedByClose ||
      tab.isPreview ||
      this.isCodebookTabWithoutFocus(tab, heldByAnotherPart)
    )
  }

  /**
   * Finds the foreign tab whose group gets the keyboard back after an arrangement; asked by {@link retainForeignTabFocus} about the active tab.
   * @param tab - The tab the editor names as active, if any.
   * @param activatedByClose - The tab the editor activated in place of a focused leftover tab this selection just closed.
   * @param heldByAnotherPart - Whether another editor part holds the keyboard over that tab's visible text editor.
   * @returns The tab, or `undefined` when no tab is active or {@link isTabWithoutFocusReturn} holds for it.
   * @example const tab = this.foreignTabToReturnTo(group.activeTab, activatedByClose, heldByAnotherPart)
   */
  private foreignTabToReturnTo(
    tab: vscode.Tab | undefined,
    activatedByClose: vscode.Tab | undefined,
    heldByAnotherPart: boolean,
  ): vscode.Tab | undefined {
    if (
      !tab ||
      this.isTabWithoutFocusReturn(tab, activatedByClose, heldByAnotherPart)
    )
      return undefined
    return tab
  }

  /**
   * Measures which side bars are open before {@link maximizeForRead} maximizes a pane, and hides the primary one for that measurement.
   * The editor's maximize command hides both side bars and no command of the editor brings them back when the maximization ends; the extension API does not say which bars are open. The editor area between the bars tells it: the area grows when a bar is hidden. The primary side bar is hidden here, which the maximize command would do next anyway, and the area is read before and after; {@link rememberAuxiliaryBarAtRead} reads it once more when the maximization has hidden the secondary bar too.
   * @returns The main editor's layout as it was read before anything was hidden, kept as {@link layoutBeforeReading} ({@link isMainEditorLayout}; `undefined` when the read failed or another editor part may have answered). By then {@link sideBarsBeforeRead} holds the measurement; or it is `undefined` because the editor area gave no width (a grid whose top level is rows, as in the live and the replay arrangement), and no bar is hidden for a measurement that cannot be made; or, when the read after hiding the primary side bar gave no width, a record without that width that shows the primary side bar again when the reading ends, because the measurement hid it and cannot tell whether it was open.
   * @example
   * ```ts
   * await this.rememberSideBarsBeforeRead() // sideBarsBeforeRead => { primaryVisible: true, widthWithoutPrimaryPx: 874 } for columns of 363 + 297 beside a side bar of 214
   * ```
   */
  private async rememberSideBarsBeforeRead(): Promise<unknown> {
    this.sideBarsBeforeRead = undefined
    const layout = await this.readEditorLayout()
    const widthPx = editorAreaWidthPx(layout)
    // The same read tells the sizes of the groups before the reading, for a Read that has to begin with the editor's Expand.
    const layoutBeforeRead = this.isMainEditorLayout(layout)
      ? layout
      : undefined
    // Without a width nothing can be compared: the primary side bar stays as the learner has it.
    if (widthPx === undefined) return layoutBeforeRead
    await vscode.commands
      .executeCommand('workbench.action.closeSidebar')
      .then(undefined, () => undefined)
    const widthWithoutPrimaryPx = await this.readEditorAreaWidthPx()
    // The measurement hid the primary side bar and cannot tell whether it was open: the end of the reading shows it again rather than leave the learner's bar away.
    if (widthWithoutPrimaryPx === undefined) {
      this.sideBarsBeforeRead = { primaryVisible: true }
      return layoutBeforeRead
    }
    this.sideBarsBeforeRead = {
      primaryVisible: this.hasSideBarGain(widthWithoutPrimaryPx, widthPx),
      widthWithoutPrimaryPx,
    }
    return layoutBeforeRead
  }

  /**
   * Says whether an answer of the editor's layout read is the main editor's and not another editor part's; asked by {@link rememberSideBarsBeforeRead} before a layout is kept for the end of a reading and by {@link giveGroupSizesBackAfterExpand} before one is applied.
   * The editor answers a layout read, and applies a layout, for the editor part that has the focus (Cursor's Agent chat as a tab has a part of its own): a layout noted or applied there would give that part the main editor's groups.
   * @param layout - What `vscode.getEditorLayout` answered.
   * @returns `true` when the layout counts exactly the groups the editor's tab model names (one editor part), and when the main editor is known to have the focus ({@link hasMainEditorFocus}); `false` otherwise, and for an answer that is no layout.
   * @example this.isMainEditorLayout({ orientation: 1, groups: [{ size: 344 }, { size: 343 }] }) // => true in VS Code with two editor groups
   */
  private isMainEditorLayout(layout: unknown): boolean {
    const count = editorLayoutGroupCount(layout)
    return (
      count !== undefined &&
      (count === vscode.window.tabGroups.all.length ||
        this.hasMainEditorFocus(count))
    )
  }

  /**
   * Gives the editor groups the sizes they had before the reader's Expand for a Read or an Enlarge, and forgets them; called once the maximization is ended, by {@link endEnlargementAtClose}, by the live branch of {@link admitPresentation} and by {@link restoreStudyArrangement} behind their arrangement (which forgets the sizes itself where it applied its layout), and by {@link maximizeAfterExpand} for a Read or an Enlarge that was refused after its Expand.
   * Expand leaves every group but the active one at its minimum size, and no command of the editor undoes that: after a Read in an arrangement whose top level is rows (the live and the replay arrangement, where the panes share the learner's own groups) and after an Enlarge the learner's groups stayed that way when the workspace was closed, and after a Restore that arranges nothing because it preserves a group of the learner's. The layout the editor answered before the Expand is applied again, which is what a Restore does with its arrangement.
   * Nothing is applied, and the sizes stay as the Expand left them, when the editor's groups are no longer those of before (the learner opened, closed or moved a group meanwhile), and when the main editor is not known to answer (the keyboard is in Cursor's chat tab, whose editor part would be given the layout). A layout that was read while the learner had maximized a group by hand gives that group the larger share. Sizes the learner set by hand between an Enlarge or a Read they ended themselves and the Close are replaced by those of before.
   * @param assertUnchanged - Throws when the learner changed the focus since the caller began; asked once the editor answered the layout read and before anything is applied. Left out by a Close, which nobody's focus stops.
   * @returns Once the editor answered the layout command, or at once when no sizes are kept or they may not be applied.
   * @throws What `assertUnchanged` throws; the sizes then stay kept, for the next Restore or the Close.
   * @example
   * ```ts
   * await vscode.commands.executeCommand('workbench.action.minimizeOtherEditors')
   * await this.giveGroupSizesBackAfterExpand() // two rows of 617 and 70 px are 344 and 343 px again
   * ```
   */
  private async giveGroupSizesBackAfterExpand(
    assertUnchanged?: () => void,
  ): Promise<void> {
    const before = this.groupSizesBeforeExpand
    if (before === undefined) return
    const now = await this.readEditorLayout()
    // A learner who changed the focus while the editor answered keeps the groups as they are.
    assertUnchanged?.()
    this.groupSizesBeforeExpand = undefined
    // Only the main editor's groups of before get their sizes back.
    if (!this.hasMainEditorGroupsOf(before, now)) return
    await vscode.commands
      .executeCommand('vscode.setEditorLayout', before)
      .then(undefined, () => undefined)
  }

  /**
   * Says whether the editor's groups are still those a layout was noted for, in the main editor; asked by {@link giveGroupSizesBackAfterExpand} before it applies that layout.
   * @param before - The main editor's layout as it was noted before a reading.
   * @param now - What the editor's layout read answers now.
   * @returns `true` when the answer of now is the main editor's ({@link isMainEditorLayout}) and names the same groups in the same splits ({@link isSameEditorLayoutShape}); `false` when another editor part may have answered and when a group was opened, closed or moved since.
   * @example this.hasMainEditorGroupsOf({ orientation: 1, groups: [{ size: 344 }, { size: 343 }] }, { orientation: 1, groups: [{ size: 617 }, { size: 70 }] }) // => true
   */
  private hasMainEditorGroupsOf(before: unknown, now: unknown): boolean {
    return this.isMainEditorLayout(now) && isSameEditorLayoutShape(before, now)
  }

  /**
   * Measures whether the secondary side bar was open before a Read, right after the Read's maximize command hid it; called by {@link beginReadingMaximized} once for each reading that hid both bars.
   * The editor area is read at the Read itself and compared with its width without the primary side bar a moment before, so a window the learner resizes during the reading does not count as a side bar. That read goes through the maximized layout, in which the editor answers every hidden group with the width it had while visible: only the widest column, which is the maximized group's and has the whole area, is read ({@link readMaximizedEditorAreaWidthPx}).
   * @returns Once {@link sideBarsBeforeRead} says whether the secondary bar was open; left without that answer when the area gave no width, and {@link sideBarShowCommands} measures it when the reading ends.
   * @example
   * ```ts
   * await this.rememberAuxiliaryBarAtRead() // sideBarsBeforeRead.auxiliaryVisible => true for an area of 1335 that was 874 without the primary side bar
   * ```
   */
  private async rememberAuxiliaryBarAtRead(): Promise<void> {
    const before = this.sideBarsBeforeRead
    // Only a reading whose maximization hid both bars has a secondary bar to measure.
    if (before?.widthWithoutPrimaryPx === undefined) return
    const maximizedWidthPx = await this.readMaximizedEditorAreaWidthPx()
    if (maximizedWidthPx === undefined) return
    before.auxiliaryVisible = this.hasSideBarGain(
      maximizedWidthPx,
      before.widthWithoutPrimaryPx,
    )
  }

  /**
   * Reads the width of the editor area while the Read's maximization is on, for {@link rememberAuxiliaryBarAtRead}.
   * @returns The width {@link maximizedEditorAreaWidthPx} finds in the widest column of the layout, or `undefined` when the layout has no columns at its top level or the read failed.
   * @example
   * ```ts
   * const maximizedWidthPx = await this.readMaximizedEditorAreaWidthPx() // => 1335 for a maximized Application group in a window of that width with both side bars hidden
   * ```
   */
  private async readMaximizedEditorAreaWidthPx(): Promise<number | undefined> {
    return maximizedEditorAreaWidthPx(
      await vscode.commands
        .executeCommand<unknown>('vscode.getEditorLayout')
        .then(undefined, () => undefined),
    )
  }

  /**
   * Maximizes the active editor group for a Read; called by {@link readStudyPane} once the pane to read has the focus.
   * A reading whose side bars were measured uses the editor's command that also hides both bars, and its end shows the hidden ones again. A reading without a measurement leaves the side bars as they are, because a bar hidden then could not be told from one the learner keeps closed: Expand ends an earlier maximization, and the toggle then maximizes the active group between the bars.
   * @param assertReadFocus - Throws when the learner or the window took the focus from the pane being read; asked after each step that can let it happen.
   * @returns Once the editor answered the maximize command.
   * @throws What `assertReadFocus` throws, and a rejection of the editor's maximize command; when this Read would have begun the reading, the side bar its measurement hid is shown again first.
   * @example
   * ```ts
   * await this.maximizeForRead(assertReadFocus) // three-pane columns: both side bars hidden; live or replay rows: the side bars stay
   * ```
   */
  private async maximizeForRead(assertReadFocus: () => void): Promise<void> {
    // Which side bars are open is measured once per reading; from then on the reading is ended by Restore or Close, which show the hidden ones again.
    if (this.maximizedByRead) {
      await this.maximizeActiveGroupForRead(assertReadFocus)
      return
    }
    await this.beginReadingMaximized(assertReadFocus)
  }

  /**
   * Begins a reading: measures the side bars, maximizes the active group and measures the secondary bar; called by {@link maximizeForRead} for a Read made while no reading is pending.
   * @param assertReadFocus - Throws when the learner or the window took the focus from the pane being read; asked after each step that can let it happen.
   * @returns Once the editor answered the maximize command and the secondary bar was measured.
   * @throws What `assertReadFocus` throws, and a rejection of the editor's maximize command; the reading is then not begun, and the side bar its measurement hid is shown again first (the groups a Read's Expand resized have their sizes back by then, {@link maximizeAfterExpand}).
   * @example
   * ```ts
   * await this.beginReadingMaximized(assertReadFocus) // maximizedByRead => true, sideBarsBeforeRead => { primaryVisible: true, widthWithoutPrimaryPx: 874, auxiliaryVisible: false }
   * ```
   */
  private async beginReadingMaximized(
    assertReadFocus: () => void,
  ): Promise<void> {
    try {
      this.maximizedByRead = true
      this.layoutBeforeReading = await this.rememberSideBarsBeforeRead()
      assertReadFocus()
      await this.maximizeActiveGroupForRead(assertReadFocus)
      // The secondary bar is measured at the Read itself, before the learner can resize the window.
      await this.rememberAuxiliaryBarAtRead()
    } catch (error) {
      // A Read refused before its maximization begins no reading: the side bar hidden for the measurement is shown again, and the next Read measures anew.
      this.maximizedByRead = false
      await this.showSideBarsHiddenByRead()
      throw error
    }
  }

  /**
   * Runs the editor commands that maximize the active group for a Read; called by {@link beginReadingMaximized} once the side bars were measured or found unmeasurable, and by {@link maximizeForRead} for a Read during a reading.
   * @param assertReadFocus - Throws when the learner or the window took the focus from the pane being read.
   * @returns Once the editor answered: both side bars hidden for a reading whose primary side bar was measured ({@link sideBarsBeforeRead} with its width), or the side bars left as they are after Expand and the maximize toggle.
   * @throws What `assertReadFocus` throws, and a rejection of an editor command.
   * @example
   * ```ts
   * await this.maximizeActiveGroupForRead(assertReadFocus)
   * ```
   */
  private async maximizeActiveGroupForRead(
    assertReadFocus: () => void,
  ): Promise<void> {
    // A measured reading hides both side bars with the group's maximization; one whose measurement failed after hiding the primary bar leaves the secondary bar alone.
    if (this.sideBarsBeforeRead?.widthWithoutPrimaryPx !== undefined) {
      await vscode.commands.executeCommand(
        'workbench.action.maximizeEditorHideSidebar',
      )
      return
    }
    // Expand ends an earlier maximization, which the editor does not report, and leaves every other group at its minimum size: the sizes the reading began with are kept, to be given back when it ends.
    await this.expandKeepingGroupSizes(this.layoutBeforeReading)
    await this.maximizeAfterExpand(assertReadFocus, async () => {
      assertReadFocus()
      await vscode.commands.executeCommand(
        'workbench.action.toggleMaximizeEditorGroup',
      )
    })
  }

  /**
   * Runs the editor's Expand for a Read or an Enlarge and keeps the sizes the editor groups had before it; called by {@link maximizeActiveGroupForRead} for a Read that could not measure the side bars, by {@link enlargePresentationPanel}, and by {@link expandToEndMaximization} where a Restore or a Close ends a maximization with the Expand.
   * Both need the Expand before their maximize toggle: the toggle ends a maximization that is on, and the editor does not report one (its layout read answers sizes only, and a group the learner maximized by hand or a pane read twice is such a state). The Expand ends whatever maximization there is and then gives the active group all the room, which no command of the editor undoes: the layout of before is kept in {@link groupSizesBeforeExpand} for {@link giveGroupSizesBackAfterExpand}. The first Expand since the groups last had their own sizes decides; a later one finds the groups resized already and keeps what is kept.
   * @param layoutBefore - The main editor's layout as it was before this Expand and before any maximization of the reader's; `undefined` when it could not be read, and nothing is kept then.
   * @returns Once the editor answered the Expand; the sizes are kept only then.
   * @throws A rejection of the editor's Expand; nothing is kept for it.
   * @example await this.expandKeepingGroupSizes(this.layoutBeforeReading)
   */
  private async expandKeepingGroupSizes(layoutBefore: unknown): Promise<void> {
    await vscode.commands.executeCommand(
      'workbench.action.minimizeOtherEditors',
    )
    this.groupSizesBeforeExpand ??= layoutBefore
  }

  /**
   * Ends a maximization of the reader's with the editor's Expand and keeps the sizes of before; called by the live branch of {@link admitPresentation} and by {@link restoreStudyArrangement} before they arrange, and by {@link endEnlargementAtClose} where the editor will not end the maximization by itself.
   * A reading that hid the side bars maximized without resizing a group, so this Expand is the first that takes sizes: the layout the reading began with is kept for {@link giveGroupSizesBackAfterExpand}, which a Restore runs where its arrangement applied nothing and a Close before it closes the panes. After a Read or an Enlarge that began with Expand the sizes are kept already. Without a reading and without kept sizes (a group the learner maximized by hand) nothing can be kept: the editor does not answer the sizes of before a maximization.
   * @returns Once the editor answered the Expand.
   * @throws A rejection of the editor's Expand.
   * @example await this.expandToEndMaximization()
   */
  private async expandToEndMaximization(): Promise<void> {
    await this.expandKeepingGroupSizes(
      this.maximizedByRead ? this.layoutBeforeReading : undefined,
    )
  }

  /**
   * Runs the steps of a Read or an Enlarge that follow its Expand and end in the maximize toggle, and gives the groups their sizes back when one of them fails; called by {@link maximizeActiveGroupForRead} and {@link enlargePresentationPanel} right after {@link expandKeepingGroupSizes}.
   * A Read or an Enlarge that is refused there leaves the groups at the sizes the Expand gave them, with nothing maximized and nothing that would end later.
   * @param assertUnchanged - Throws when the learner or the window took the focus or changed the panes since the caller began; a learner who did keeps the groups as they are, and the sizes stay kept for the next Restore or the Close.
   * @param maximize - The caller's steps after its Expand.
   * @returns Once the steps are done.
   * @throws What a step throws, after the sizes were given back or left kept.
   * @example await this.maximizeAfterExpand(assertReadFocus, async () => { await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup') })
   */
  private async maximizeAfterExpand(
    assertUnchanged: () => void,
    maximize: () => Promise<void>,
  ): Promise<void> {
    try {
      await maximize()
    } catch (error) {
      await this.giveGroupSizesBackAfterExpand(assertUnchanged).catch(
        () => undefined,
      )
      throw error
    }
  }

  /**
   * Finds the layout an Enlarge keeps as the sizes of before its Expand; asked by {@link enlargePresentationPanel} once the pane to enlarge has the focus.
   * @param confirmedLayout - What the Enlarge read of a confirmed arrangement ({@link readPassivePresentationLayout}), `undefined` without one.
   * @returns What is kept already, when an earlier Read or Enlarge is still owed for. During a reading, the layout the reading began with ({@link layoutBeforeReading}): the grid is maximized then and answers other sizes. Otherwise the layout the Enlarge read, or the editor's layout read now when it is the main editor's ({@link readMainEditorLayout}); `undefined` when it is not or the read failed.
   * @example const layoutBefore = await this.groupSizesBeforeEnlarge(before)
   */
  private async groupSizesBeforeEnlarge(
    confirmedLayout: unknown,
  ): Promise<unknown> {
    if (this.groupSizesBeforeExpand !== undefined)
      return this.groupSizesBeforeExpand
    if (this.maximizedByRead) return this.layoutBeforeReading
    return confirmedLayout ?? (await this.readMainEditorLayout())
  }

  /**
   * Reads the editor's layout and keeps it only when it is the main editor's; asked by {@link groupSizesBeforeEnlarge} for an Enlarge that read no confirmed arrangement.
   * @returns What `vscode.getEditorLayout` answered when {@link isMainEditorLayout} holds for it; `undefined` when another editor part may have answered or the read failed.
   * @example const layout = await this.readMainEditorLayout() // => { orientation: 1, groups: [{ size: 344 }, { size: 343 }] }
   */
  private async readMainEditorLayout(): Promise<unknown> {
    const layout = await this.readEditorLayout()
    return this.isMainEditorLayout(layout) ? layout : undefined
  }

  /**
   * Shows the side bars again that a Read's maximize command hid, when Codebook ends that maximization; called after `workbench.action.minimizeOtherEditors` by the live branch of {@link admitPresentation}, {@link restoreStudyArrangement}, {@link enlargePresentationPanel} and {@link close}, and by {@link beginReadingMaximized} for a Read that was refused after its measurement.
   * Only the bars {@link sideBarShowCommands} names are shown: those that were open before the Read, and the primary one when the learner opened it during the reading. A reading without a measurement hid no bar and shows none. The editor's commands that show a bar leave an open bar as it is and give the bar the keyboard, which the active editor group gets back. They do so in a window without the focus too, and beside a chat that had the keyboard as a tab of another editor part: {@link close} settles both ({@link endEnlargementAtClose}).
   * @returns `true` when a bar was shown and the active editor group focused again, `false` when no Read's measurement was pending or no bar is to be shown.
   * @example
   * ```ts
   * await vscode.commands.executeCommand('workbench.action.minimizeOtherEditors')
   * this.maximizedByRead = false
   * await this.showSideBarsHiddenByRead()
   * ```
   */
  private async showSideBarsHiddenByRead(): Promise<boolean> {
    const before = this.sideBarsBeforeRead
    if (!before) return false
    this.sideBarsBeforeRead = undefined
    const showCommands = await this.sideBarShowCommands(before)
    const run = (command: string): Thenable<unknown> =>
      vscode.commands.executeCommand(command).then(undefined, () => undefined)
    for (const command of showCommands) await run(command)
    if (!showCommands.length) return false
    await run('workbench.action.focusActiveEditorGroup')
    return true
  }

  /**
   * Says whether the editor area grew by a hidden side bar between two reads; asked by {@link rememberSideBarsBeforeRead}, {@link rememberAuxiliaryBarAtRead} and {@link sideBarShowCommands}.
   * @param widerPx - The editor area's width that is expected to be the wider one, `undefined` when it could not be read.
   * @param narrowerPx - The width it is compared with, `undefined` when it could not be read.
   * @returns `true` when the first width exceeds the second by more than {@link HIDDEN_SIDE_BAR_MIN_GAIN_PX}; `false` when it does not, and when either width is unknown.
   * @example this.hasSideBarGain(874, 660) // => true
   */
  private hasSideBarGain(
    widerPx: number | undefined,
    narrowerPx: number | undefined,
  ): boolean {
    return (
      widerPx !== undefined &&
      narrowerPx !== undefined &&
      widerPx - narrowerPx > HIDDEN_SIDE_BAR_MIN_GAIN_PX
    )
  }

  /**
   * Lists the editor commands that show the side bars a Read hid, in the order {@link showSideBarsHiddenByRead} runs them: the secondary bar first, then the primary one.
   * What the Read measured decides without another read: the secondary bar measured at the Read ({@link rememberAuxiliaryBarAtRead}), and the primary bar alone for a reading whose measurement failed after hiding it. Only when the secondary bar could not be measured at the Read is the editor area read now: the secondary bar was open when the area is wider than it was without the primary bar alone. An area that did not grow says nothing while the learner may have opened a bar during the reading, which takes that width away again: {@link sideBarsHiddenAtSecondLook} then hides the primary bar once more and reads the area again, which tells both whether the secondary bar is still hidden and whether the primary one was open.
   * @param before - What {@link rememberSideBarsBeforeRead} and {@link rememberAuxiliaryBarAtRead} measured.
   * @returns One command for each bar that was open before the Read and for a primary bar the learner opened during it; an empty list when both were closed. A bar whose state could not be measured is left out, except the primary bar the measurement itself hid.
   * @example
   * ```ts
   * await this.sideBarShowCommands({ primaryVisible: true, widthWithoutPrimaryPx: 874, auxiliaryVisible: false }) // => ['workbench.action.focusSideBar']
   * await this.sideBarShowCommands({ primaryVisible: true }) // => ['workbench.action.focusSideBar'] after a measurement that failed once it had hidden the primary bar
   * ```
   */
  private async sideBarShowCommands(
    before: NonNullable<StudyWorkspace['sideBarsBeforeRead']>,
  ): Promise<string[]> {
    // A reading whose measurement failed after hiding the primary bar left the secondary bar as it was.
    if (before.widthWithoutPrimaryPx === undefined)
      return this.commandsShowingSideBars({
        auxiliary: false,
        primary: before.primaryVisible,
      })
    // Measured at the Read, the secondary bar's state does not depend on the window's width now.
    if (before.auxiliaryVisible !== undefined)
      return this.commandsShowingSideBars({
        auxiliary: before.auxiliaryVisible,
        primary: before.primaryVisible,
      })
    const widthPx = await this.readEditorAreaWidthPx()
    // A wider area says that the secondary bar was open and is still hidden; anything else needs a second look.
    const hidden = this.hasSideBarGain(widthPx, before.widthWithoutPrimaryPx)
      ? { auxiliary: true, primary: before.primaryVisible }
      : await this.sideBarsHiddenAtSecondLook(before, widthPx)
    return this.commandsShowingSideBars(hidden)
  }

  /**
   * Names the editor commands that show the given side bars, in the order {@link showSideBarsHiddenByRead} runs them: the secondary bar first, then the primary one; called by {@link sideBarShowCommands} once it knows which bars a Read hid.
   * @param hidden - Which bars are to be shown again.
   * @returns One command for each bar to show; an empty list when neither is.
   * @example
   * ```ts
   * this.commandsShowingSideBars({ auxiliary: true, primary: false }) // => ['workbench.action.focusAuxiliaryBar']
   * ```
   */
  private commandsShowingSideBars(hidden: {
    auxiliary: boolean
    primary: boolean
  }): string[] {
    return [
      ...(hidden.auxiliary ? ['workbench.action.focusAuxiliaryBar'] : []),
      ...(hidden.primary ? ['workbench.action.focusSideBar'] : []),
    ]
  }

  /**
   * Hides the primary side bar once more and measures again which bars are to be shown, for {@link sideBarShowCommands} when the editor area did not grow since the Read: the secondary bar was closed then, or a bar the learner opened during the reading takes the gained width away.
   * @param before - What {@link rememberSideBarsBeforeRead} measured.
   * @param widthPx - The editor area's width at the end of the reading, `undefined` when it could not be read.
   * @returns `auxiliary`: whether the secondary bar was open before the Read and is hidden still; `primary`: whether the primary bar was open before the Read or was opened by the learner during it (and hidden by this look). Without a width only the primary bar's measured state is known, and the secondary bar is left alone.
   * @example
   * ```ts
   * await this.sideBarsHiddenAtSecondLook({ primaryVisible: false, widthWithoutPrimaryPx: 1035 }, 1035) // => { auxiliary: true, primary: true } after the learner opened a primary bar as wide as the secondary one
   * ```
   */
  private async sideBarsHiddenAtSecondLook(
    before: NonNullable<StudyWorkspace['sideBarsBeforeRead']>,
    widthPx: number | undefined,
  ): Promise<{ auxiliary: boolean; primary: boolean }> {
    if (widthPx === undefined)
      return { auxiliary: false, primary: before.primaryVisible }
    await vscode.commands
      .executeCommand('workbench.action.closeSidebar')
      .then(undefined, () => undefined)
    const widthWithoutPrimaryPx = await this.readEditorAreaWidthPx()
    return {
      auxiliary: this.hasSideBarGain(
        widthWithoutPrimaryPx,
        before.widthWithoutPrimaryPx,
      ),
      primary:
        before.primaryVisible ||
        this.hasSideBarGain(widthWithoutPrimaryPx, widthPx),
    }
  }

  /**
   * Reads the width of the editor area for {@link rememberSideBarsBeforeRead} and {@link sideBarShowCommands}.
   * @returns The width {@link editorAreaWidthPx} finds in the editor's layout, or `undefined` when the layout has no columns at its top level or the read failed.
   * @example
   * ```ts
   * const widthPx = await this.readEditorAreaWidthPx() // => 660 for the three-pane Study layout between Cursor's two side bars
   * ```
   */
  private async readEditorAreaWidthPx(): Promise<number | undefined> {
    return editorAreaWidthPx(await this.readEditorLayout())
  }

  /**
   * Reads the editor's layout, for {@link readEditorAreaWidthPx}, {@link rememberSideBarsBeforeRead} and {@link giveGroupSizesBackAfterExpand}.
   * @returns What `vscode.getEditorLayout` answered (for the editor part that has the focus), or `undefined` when the editor refused the read.
   * @example const layout = await this.readEditorLayout() // => { orientation: 1, groups: [{ size: 344 }, { size: 343 }] }
   */
  private async readEditorLayout(): Promise<unknown> {
    return vscode.commands
      .executeCommand<unknown>('vscode.getEditorLayout')
      .then(undefined, () => undefined)
  }

  /**
   * Tells whether a text editor shows a document in an editor group now, for {@link capturePresentationFocus} and {@link retainForeignTabFocus}: a text tab the editor names as active without an active text editor has its editor visible while another editor part holds the keyboard, and has none when the editor could not load it.
   * @param uri - The document of the named tab.
   * @param column - The view column of the group that shows the tab.
   * @returns `true` when one of the visible text editors shows that document in that column.
   * @example
   * ```ts
   * this.hasVisibleTextEditor(tab.input.uri, group.viewColumn) // => true for "Captured-login-form.tsx" in group 2 while Cursor's chat input has the keyboard
   * ```
   */
  private hasVisibleTextEditor(
    uri: vscode.Uri,
    column: vscode.ViewColumn,
  ): boolean {
    return vscode.window.visibleTextEditors.some(
      (editor) =>
        editor.viewColumn === column &&
        editor.document.uri.toString() === uri.toString(),
    )
  }

  /**
   * Names the tab that covers the captured source in its own editor group, as the cause of a live or replay arrangement that could not be confirmed; called by the live branch of {@link admitPresentation} and by {@link confirmEnteredComposition}.
   * @returns The obstacle text of {@link coveredSourceObstacle}, or `undefined` when the source's group shows the source or no group holds it.
   * @example
   * ```ts
   * throw new StudyError('PRESENTATION_UNAVAILABLE', 'The live Study layout could not be confirmed after Restore.', this.coveredSourceCause() ?? restored.reason)
   * ```
   */
  private coveredSourceCause(): string | undefined {
    const sourceUri = this.sourceUri?.toString()
    const isSource = (tab: vscode.Tab | undefined): boolean =>
      tab?.input instanceof vscode.TabInputText &&
      tab.input.uri.toString() === sourceUri
    const covered = vscode.window.tabGroups.all.find(
      (group) =>
        group.activeTab !== undefined &&
        !isSource(group.activeTab) &&
        group.tabs.some(isSource),
    )
    return covered?.activeTab
      ? coveredSourceObstacle(
          this.editorTabName(covered.activeTab),
          covered.viewColumn,
        )
      : undefined
  }

  /**
   * Tells the focus restoration of {@link capturePresentationFocus} that a confirmed placement put the captured source into the group of the learner's focused document; fronting that document again would cover the source and leave the layout unconfirmed.
   * @param document - The learner's document that had focus when the presentation change was admitted.
   * @param group - The group that holds that document now.
   * @param placedSourceStays - `true` only when the placement was confirmed; a failed change gives the document its focus back.
   * @returns
   * - `true` when the document shares the placed source's group: it stays open behind the source, in the group that has the focus.
   * - `false` when the change failed, the document is the captured source itself, or it sits in another group.
   * @example
   * ```ts
   * if (this.staysBehindPlacedSource(document, currentGroup, true)) return
   * ```
   */
  private staysBehindPlacedSource(
    document: vscode.TextDocument,
    group: vscode.TabGroup,
    placedSourceStays = false,
  ): boolean {
    return (
      placedSourceStays &&
      group === this.studyPanePositions().sourceGroup &&
      document.uri.toString() !== String(this.sourceUri)
    )
  }

  /** Transfers only stable shared state, with renderer waits outside {@link withLayout} and preference persistence after confirmation. @example await this.performPresentation(input, transition, restoreFocus) */
  private async performPresentation(
    input: PresentationIntent,
    transition: NonNullable<StudyWorkspace['presentationTransition']>,
    restoreFocus?: ReturnType<StudyWorkspace['capturePresentationFocus']>,
    returnForeignFocus?: ReturnType<StudyWorkspace['retainForeignTabFocus']>,
  ): Promise<PresentationState> {
    const signal = transition.cancellation.signal,
      lifetime = this.lifetime
    const previousMode = this.presentationMode
    let evidenceConfirmed = false,
      restoreFocusAttempted = false
    let assertViewportOwnership: (() => void) | undefined
    let assertRetainedPlacement = this.opened
      ? this.retainPresentationPlacement()
      : undefined
    this.presentationMovedFocus = false
    const windowFocus =
      input.action === 'save-preference'
        ? undefined
        : vscode.window.onDidChangeWindowState((state) => {
            if (
              state.focused ||
              this.presentationTransition !== transition ||
              this.lifetime !== lifetime
            )
              return
            // Leaving the work window revokes this operation, including catch-path focus recovery.
            this.presentationMovedFocus = false
            transition.cancellation.abort(
              new StudyError(
                'PRESENTATION_UNAVAILABLE',
                'The Codebook work window lost focus; its presentation was not confirmed.',
              ),
            )
          })
    const assertCurrent = (): void => {
      signal.throwIfAborted()
      this.assertLifetime(lifetime)
      assertViewportOwnership?.()
      if (input.action !== 'save-preference' && !vscode.window.state.focused) {
        this.presentationMovedFocus = false
        throw new StudyError(
          'PRESENTATION_UNAVAILABLE',
          'The Codebook work window lost focus; its presentation was not confirmed.',
        )
      }
      if (transition.id !== this.presentationId)
        throw new StudyError(
          'PRESENTATION_INSTANCE_GONE',
          'The reader was closed during placement.',
        )
      // Admission belongs to the original request; a later ready state or pause cannot become its new baseline.
      if (
        !evidenceConfirmed &&
        transition.runtimeIdentity !== undefined &&
        transition.runtimeIdentity !== this.assertPresentationAdmission()
      )
        throw new StudyError(
          'PRESENTATION_UNAVAILABLE',
          'The live pause changed during presentation placement.',
        )
    }
    const releaseViewports: (() => void)[] = []
    let assertSourceFocus: (() => void) | undefined
    try {
      if (input.action !== 'save-preference') {
        await this.initialize()
        assertCurrent()
        assertRetainedPlacement?.()
        if (!this.opened) {
          // Found before the open creates any pane, so the refusal leaves the window as it was.
          const unkept = this.unkeptPreview()
          if (unkept)
            throw new StudyError(
              'PRESENTATION_UNAVAILABLE',
              foreignPreviewObstacle(
                this.editorTabName(unkept.tab),
                unkept.group.viewColumn,
              ),
            )
          await this.open(signal, 'presentation')
        }
        assertCurrent()
        // The open entered a live run or a recording and arranged its two panes: no Study pane exists whose render the transfer below waits for.
        if (this.liveComposition || this.summaryComposition) {
          // A recording's source is shown by the recording's own load, which the open only began: the selection waits for it instead of refusing while it is opening.
          if (this.summaryComposition) {
            await this.settleOwnedPlayback(signal)
            assertCurrent()
          }
          const entered = this.confirmEnteredComposition(input)
          await returnForeignFocus?.().catch(() => undefined)
          return entered
        }
        assertRetainedPlacement ??= this.retainPresentationPlacement()
        this.presentationPoseRequest = undefined
        this.presentationPose = undefined
        this.presentationPoseRestored = undefined
        this.lastRendered = undefined
        this.lastPublished = undefined
        this.publish()
        const retainedSource = this.sourceReady()
          ? vscode.window.visibleTextEditors.find(
              (editor) =>
                editor.document.uri.toString() === this.sourceUri?.toString() &&
                editor.viewColumn === this.studyPanePositions().sourceColumn,
            )
          : undefined
        const retainedObservation = this.message(true).model.observation?.id,
          retainedSelections = retainedSource?.selections
        const restoreSourceReading = retainEditorReadingPosition(retainedSource)
        // Retire pending B and fully restore confirmed A before moving panes or adopting its evidence.
        if (this.recordingActive) {
          if (!this.playback!.bundle())
            throw new StudyError(
              'PRESENTATION_UNAVAILABLE',
              FIRST_REPLAY_POSITION_WARNING,
            )
          const replay = this.playback!.state()
          // Keep a settled paused frame in place; re-presenting it can select Application over Study in Cursor.
          if (
            replay.readiness !== 'ready' ||
            replay.mode !== 'paused' ||
            replay.cleared
          ) {
            this.playback!.hide()
            await this.settleOwnedPlayback(signal)
            assertCurrent()
            this.playback!.reveal()
            await this.settleOwnedPlayback(signal)
            assertCurrent()
          }
          if (
            this.playback!.state().readiness !== 'ready' ||
            !this.playback!.bundle()
          )
            throw new StudyError(
              'PRESENTATION_UNAVAILABLE',
              'No confirmed replay position is available for transfer.',
            )
        }
        await this.refreshing
        await this.rendering
        assertCurrent()
        // Pending replay work can revise the reader while restoring confirmed A; capture only that settled context.
        this.lastRendered = undefined
        this.lastPublished = undefined
        this.publish()
        await waitUntil(
          () =>
            this.lastRendered?.revision === this.revision &&
            this.lastRendered.presentationControlRevision ===
              this.presentationControlRevision,
          'reading context before capture',
          PRESENTATION_READY_TIMEOUT_MS,
          signal,
        )
        assertCurrent()
        assertRetainedPlacement()
        await this.captureReadingPose(signal)
        assertCurrent()
        assertRetainedPlacement()
        const selection = JSON.stringify(this.selection),
          bundle = this.recordingActive ? this.playback?.bundle() : undefined
        const viewport = this.recordingActive
          ? this.replayViewport
          : this.viewport
        const liveViewport = this.viewport,
          replayViewport = this.replayViewport,
          leaseId = this.leaseId
        const viewports = [
          ...new Set(
            [liveViewport, replayViewport].filter(
              (value): value is BrowserViewport => value !== undefined,
            ),
          ),
        ]
        assertViewportOwnership = (): void => {
          if (
            this.viewport !== liveViewport ||
            this.replayViewport !== replayViewport ||
            this.leaseId !== leaseId
          )
            throw new Error(
              'The viewport lease changed during presentation; its replacement was preserved.',
            )
        }
        // Live history and replay can share Application; both leases must drain before the old pane is retired.
        for (const attached of viewports) {
          releaseViewports.push(await attached.holdPlacement(signal))
          assertCurrent()
        }
        assertRetainedPlacement()
        this.placingPresentation = true
        this.presentationConfirmed = false
        assertSourceFocus = await this.placePresentation(
          input.mode,
          signal,
          assertCurrent,
          viewports,
          (captured) => {
            assertSourceFocus = captured
          },
        )
        assertCurrent()
        if (!this.app?.active && !this.contextPanel?.active) assertSourceFocus()
        assertRetainedPlacement = this.retainPresentationPlacement()
        for (const release of releaseViewports.splice(0)) release()
        // Native movement may recreate the renderer; it must acknowledge the same evidence after the lock is released.
        if (this.recordingActive) {
          this.replayNeedsReveal = true
          this.playback!.reveal()
          await this.settleOwnedPlayback(signal)
        } else if (viewport) await viewport.restorePlacement(signal)
        else this.presentApplication(this.message())
        assertCurrent()
        assertRetainedPlacement()
        // Reject a learner selection before restoring the reading pose captured before native placement.
        if (!this.app?.active && !this.contextPanel?.active) assertSourceFocus()
        if (
          selection !== JSON.stringify(this.selection) ||
          (bundle && this.playback?.bundle() !== bundle)
        )
          throw new StudyError(
            'PRESENTATION_UNAVAILABLE',
            'The run, selected item or confirmed replay changed during placement. Inspect the current state before restoring.',
          )
        // Replay rehydration reveals the stop twice; restore the original reading context only for that same source/observation.
        if (
          retainedSource &&
          retainedSource.document.uri.toString() ===
            this.sourceUri?.toString() &&
          retainedObservation === this.message(true).model.observation?.id
        ) {
          const restoredSource = vscode.window.visibleTextEditors.find(
            (editor) =>
              editor.document.uri.toString() === this.sourceUri?.toString() &&
              editor.viewColumn === this.studyPanePositions().sourceColumn,
          )
          if (!restoredSource)
            throw new Error(
              'The retained source is no longer visible after replay restoration.',
            )
          if (retainedSelections) restoredSource.selections = retainedSelections
          await restoreSourceReading(restoredSource, signal)
          assertCurrent()
          assertRetainedPlacement()
        }
        restoreFocusAttempted = true
        await restoreFocus?.(signal, assertSourceFocus, true)
        assertCurrent()
        assertRetainedPlacement = this.retainPresentationPlacement()
        const receipt = this.layoutReceipt,
          actual = await vscode.commands.executeCommand<unknown>(
            'vscode.getEditorLayout',
          )
        assertCurrent()
        assertRetainedPlacement()
        if (
          !receipt ||
          receipt !== this.layoutReceipt ||
          JSON.stringify(actual) !== receipt.signature ||
          !this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) ||
          !this.sameStudyPanePositions(receipt.panes)
        )
          throw new Error(
            'Native layout changed during presentation confirmation; the manual arrangement was preserved.',
          )
        this.presentationMode = input.mode
        this.lastRendered = undefined
        this.lastPublished = undefined
        this.publish()
        await waitUntil(
          () =>
            this.lastRendered?.revision === this.revision &&
            this.lastRendered.presentationControlRevision ===
              this.presentationControlRevision &&
            this.lastRendered.presentationMode === input.mode,
          'matching presentation context',
          PRESENTATION_READY_TIMEOUT_MS,
          signal,
        )
        assertCurrent()
        assertRetainedPlacement()
        await this.restoreReadingPose(signal)
        assertCurrent()
        assertRetainedPlacement()
        evidenceConfirmed = true
        this.presentationConfirmed = true
        this.requestedPresentation = undefined
        this.presentationReason = undefined
      }
      await this.savePresentationPreference(input.mode, transition.id)
      assertCurrent()
      this.errors.delete('presentation')
      // Last, because the editor answers a layout read for the focused editor part: a tab that is no text editor (an agent chat) gets the focus back.
      await returnForeignFocus?.().catch(() => undefined)
      return {
        ...this.presentationState(),
        state: this.opened ? 'open' : 'closed',
      }
    } catch (error) {
      // Recover only before normal restoration was attempted; a failed receipt must not incur a second full wait.
      if (
        !restoreFocusAttempted &&
        this.presentationMovedFocus &&
        !this.closing &&
        lifetime === this.lifetime &&
        (this.app?.active || this.contextPanel?.active || assertSourceFocus)
      )
        await restoreFocus?.(signal, assertSourceFocus).catch(() => undefined)
      // A failed change must not leave an agent chat without the focus it had; a newer focus of the learner stays.
      if (!this.closing && lifetime === this.lifetime)
        await returnForeignFocus?.().catch(() => undefined)
      if (transition.id === this.presentationId) {
        if (!this.presentationConfirmed) this.presentationMode = previousMode
        this.presentationReason = String(error)
        this.publish()
      }
      if (error instanceof StudyError) throw error
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'The presentation was not confirmed. Prior mode is retained; inspect the actual panes and restore explicitly.',
        String(error),
      )
    } finally {
      windowFocus?.dispose()
      for (const release of releaseViewports.splice(0)) release()
      this.placingPresentation = false
      this.presentationEditorScope = undefined
      this.presentationMovedFocus = false
      this.presentationPoseRequest = undefined
      this.presentationPose = undefined
      this.presentationPoseRestored = undefined
    }
  }

  /**
   * Ends a selection whose {@link open} entered a live run or a recording, the way the live branch of {@link admitPresentation} ends one on an open reader; called by {@link performPresentation}, which would otherwise wait for a Study pane that this arrangement does not have.
   * @param input - The admitted request; beside a live explanation or a replay only the Study workspace can be selected.
   * @returns The state of the arranged live or replay panes, confirmed.
   * @throws `PRESENTATION_UNAVAILABLE` for another mode, and when the arrangement the open made holds no layout receipt or its source is not shown.
   * @example
   * ```ts
   * if (this.liveComposition || this.summaryComposition) return this.confirmEnteredComposition(input)
   * ```
   */
  private confirmEnteredComposition(
    input: PresentationIntent,
  ): PresentationState {
    this.assertCompositionAllows(input)
    this.presentationConfirmed = Boolean(this.layoutReceipt)
    this.requestedPresentation = undefined
    const entered = this.presentationState()
    // The open keeps what it could arrange; without its receipt the answer names the missing condition instead of a confirmed layout.
    if (!entered.layoutConfirmed)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        unconfirmedCompositionRefusal(this.summaryComposition),
        this.coveredSourceCause() ?? entered.reason,
      )
    this.errors.delete('layout')
    this.errors.delete('presentation')
    return { ...entered, state: 'open' }
  }

  /** Captures only the displayed item's bounded reading state for {@link performPresentation}; it owns no runtime controls. @example await this.captureReadingPose(signal) */
  private async captureReadingPose(signal: AbortSignal): Promise<void> {
    const view = this.message(),
      model = view.model,
      panel = this.contextPanel
    const request: PresentationPoseCapture = {
      type: 'capture-presentation-pose',
      captureId: randomUUID(),
      presentationId: this.presentationId,
      expectedRevision: this.presentationControlRevision,
      revision: this.revision,
      itemId: model.selection.itemId,
      sourceHash: model.source.hash,
      studyId: model.selection.studyId,
      observationId: model.observation?.id,
      contentTab: view.contentTab ?? model.selection.tab,
    }
    this.presentationPoseRequest = request
    if (!panel)
      throw new Error(
        'Reading position capture could not reach the current explanation.',
      )
    await this.waitForReadingPose(
      panel,
      request,
      () => this.presentationPose?.captureId === request.captureId,
      'retained reading position',
      signal,
    )
    if (panel !== this.contextPanel)
      throw new Error(
        'Explanation ownership changed during reading position capture.',
      )
  }

  /** Requires an explicit restoration receipt from the current explanation before {@link performPresentation} commits its mode. @example await this.restoreReadingPose(signal) */
  private async restoreReadingPose(signal: AbortSignal): Promise<void> {
    const pose = this.presentationPose,
      panel = this.contextPanel,
      view = this.message(),
      model = view.model
    if (
      !pose ||
      pose.itemId !== model.selection.itemId ||
      pose.sourceHash !== model.source.hash ||
      pose.studyId !== model.selection.studyId ||
      pose.observationId !== model.observation?.id ||
      pose.contentTab !== (view.contentTab ?? model.selection.tab)
    )
      throw new Error(
        'The selected reading context changed before restoration.',
      )
    this.presentationPoseRestored = undefined
    // Rehydrating the same confirmed replay advances UI revisions; authorize only the unchanged evidence at its new revision.
    if (!panel)
      throw new Error(
        'Reading position restoration could not reach the current explanation.',
      )
    await this.waitForReadingPose(
      panel,
      { ...pose, type: 'restore-presentation-pose', revision: this.revision },
      () => this.presentationPoseRestored === pose.captureId,
      'restored reading position',
      signal,
    )
    if (panel !== this.contextPanel)
      throw new Error(
        'Explanation ownership changed during reading position restoration.',
      )
  }

  /** Bounds delivery and its receipt together for reading-pose callers so a stalled transport cannot prevent {@link close}. @example await this.waitForReadingPose(panel, request, received, 'retained reading position', signal) */
  private async waitForReadingPose(
    panel: vscode.WebviewPanel,
    message: PresentationPoseCapture | PresentationPoseRestore,
    received: () => boolean,
    description: string,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted()
    let delivery: { accepted: boolean } | { error: unknown } | undefined
    // Observe transport completion without awaiting it outside the same cancellable receipt deadline.
    Promise.resolve(panel.webview.postMessage(message)).then(
      (accepted) => {
        delivery = { accepted }
      },
      (error) => {
        delivery = { error }
      },
    )
    await waitUntil(
      () => {
        if (!delivery) return false
        if ('error' in delivery) throw delivery.error
        if (!delivery.accepted)
          throw new Error(
            'Reading position message could not reach the current explanation.',
          )
        return received()
      },
      description,
      PRESENTATION_READY_TIMEOUT_MS,
      signal,
    )
  }

  /**
   * Gives one of the reader's panes the keyboard and waits until both the editor and the pane's own document confirm it; called for the final reading restoration of a presentation change ({@link capturePresentationFocus}), for the presentation action `focus` ({@link focusCurrentPresentation}), and by {@link focusPaneForGridCommand} for a pane that is not the editor's active one.
   * @param panel - The Application pane or the Study pane.
   * @param signal - Ends the handshake with its reason.
   * @returns Once the pane's document reported the focus and the editor names the pane's tab as the active one.
   * @throws When the learner chose another pane or tab meanwhile, the window lost the focus, the pane was closed or replaced, and, with the sentence of {@link paneFocusFailure}, when the pane did not confirm the keyboard within {@link PRESENTATION_READY_TIMEOUT_MS}.
   * @example await this.focusPresentationPanel(panel, signal)
   */
  private async focusPresentationPanel(
    panel: vscode.WebviewPanel,
    signal?: AbortSignal,
  ): Promise<void> {
    const lifetime = this.lifetime,
      transition = this.presentationTransition
    const assertPlacement = this.retainPresentationPlacement(false),
      assertInitialFocus = this.retainPresentationPlacement()
    const kind =
      panel === this.app
        ? 'codebook.scopedBrowser'
        : panel === this.contextPanel
          ? 'codebook.studyContext'
          : undefined
    if (!kind) throw new Error('Presentation panel ownership was lost.')
    const matches = (tab: vscode.Tab) =>
      tab.input instanceof vscode.TabInputWebview &&
      isCodebookPaneViewType(tab.input.viewType, kind)
    const hasTargetTabFocus = () => {
      const group = vscode.window.tabGroups.activeTabGroup
      return (
        group.viewColumn === panel.viewColumn &&
        Boolean(group.activeTab && matches(group.activeTab)) &&
        vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .filter(matches).length === 1
      )
    }
    // VS Code may retain its last text editor after webview focus; the owned native tab and document receipt decide focus.
    const isActive = () => panel.active && hasTargetTabFocus()
    let targetAcquired = false,
      focusDeparted = false
    const observeFocus = (): void => {
      const targetFocused = hasTargetTabFocus()
      // A return to the original editor is new learner intent, even if it ends before the next awaited response.
      if (targetAcquired && !targetFocused) focusDeparted = true
      targetAcquired ||= targetFocused
    }
    const focusChanges = [
      panel.onDidChangeViewState(observeFocus),
      vscode.window.tabGroups.onDidChangeTabGroups(observeFocus),
      vscode.window.tabGroups.onDidChangeTabs(observeFocus),
    ]
    const assertOwnedFocus = (): void => {
      observeFocus()
      if (focusDeparted) {
        if (
          transition === this.presentationTransition &&
          lifetime === this.lifetime
        )
          this.presentationMovedFocus = false
        throw new Error(
          'Native focus left the owned presentation target; the newer learner choice was preserved.',
        )
      }
      if (!targetAcquired) assertInitialFocus()
    }
    try {
      await focusWebview(panel, {
        signal,
        timeoutMs: PRESENTATION_READY_TIMEOUT_MS,
        isActive,
        assertBeforeCommit: assertOwnedFocus,
        assertCurrent: () => {
          this.assertLifetime(lifetime)
          assertPlacement()
          if (
            transition !== this.presentationTransition ||
            (panel !== this.app && panel !== this.contextPanel)
          )
            throw new Error('Presentation focus ownership changed.')
          if (!vscode.window.state.focused)
            throw new Error('The Codebook work window lost focus.')
          // Original focus is admissible only before acquisition; later departure permanently ends this handoff.
          assertOwnedFocus()
        },
      }).catch((error: unknown) => {
        throw this.paneFocusFailure(error, panel)
      })
    } finally {
      for (const subscription of focusChanges) subscription.dispose()
    }
  }

  /**
   * Words the end of a pane's focus handshake for the learner or agent who reads it; called by {@link focusPresentationPanel} with whatever {@link focusWebview} rejected with.
   * A wait of the handshake that ran out names an internal step ("owned presentation inner focus", "current presentation focus document"), and the caller's line or reason would show that text. It is replaced by {@link paneKeyboardTimeoutMessage}, which says which pane did not confirm the keyboard, for how long Codebook waited and what to do. Every other failure of the handshake is a sentence already (the window lost the focus, the learner chose another pane, the pane was closed) and is passed on as it is.
   * @param error - What the handshake rejected with.
   * @param panel - The pane that was asked.
   * @returns An error with the sentence for a {@link WaitTimeoutError}; the given error otherwise.
   * @example throw this.paneFocusFailure(error, panel) // => Error: Codebook asked the Explanation pane to take the keyboard, and the pane did not confirm it within 5 seconds. …
   */
  private paneFocusFailure(
    error: unknown,
    panel: vscode.WebviewPanel,
  ): unknown {
    if (!(error instanceof WaitTimeoutError)) return error
    return new Error(
      paneKeyboardTimeoutMessage(
        panel === this.app ? 'Application' : 'Explanation',
        PRESENTATION_READY_TIMEOUT_MS,
      ),
    )
  }

  /**
   * Gives one of the reader's panes the editor's focus before a command that acts on the active editor group; called by the action Arrange Study Workspace and by {@link enlargePresentationPanel}.
   * Those commands need the pane to be the editor's active one, not a report of the pane's own document, so for a pane the editor already names as active no report is waited for. Revealing such a pane once more makes the editor focus the frame around the pane's document, which can take the keyboard from that document without any focus event: {@link focusPresentationPanel} then waited its whole bound for a report that could not come, and the command did not run (2 of 8 Arranges after a Read of the explanation ended that way after five seconds; measured natively on 2026-10-07 in VS Code 1.140.0 for Linux). A pane whose document says that it has the keyboard is therefore left as it is; an active pane that does not say so (the keyboard is in a view, the terminal or a side bar, or the pane's page reports nothing) is revealed with the focus, and the command goes on at once. Any other pane gets the full handshake, whose reveal brings the focus event the report answers.
   * @param panel - The pane the command acts on, one of the reader's two.
   * @returns At once for the editor's active pane; otherwise once {@link focusPresentationPanel} confirmed the focus.
   * @throws What {@link focusPresentationPanel} throws for a pane that is not the active one.
   * @example await this.focusPaneForGridCommand(this.contextPanel)
   */
  private async focusPaneForGridCommand(
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    if (!this.isEditorsActivePane(panel)) {
      await this.focusPresentationPanel(panel)
      return
    }
    // The keyboard may be outside the editor area while the pane is the active editor: the pane takes it, and nothing waits for its document.
    if (!this.reportsKeyboard(panel)) panel.reveal(undefined, false)
  }

  /**
   * Says whether a pane's own document last reported that it has the keyboard; asked by {@link focusPaneForGridCommand} for the editor's active pane.
   * @param panel - The Application pane or the Study pane.
   * @returns What the Study pane last reported ({@link studyPaneReportsKeyboard}); `false` for the Application pane, whose page sends no such report.
   * @example this.reportsKeyboard(this.contextPanel) // => true after the learner clicked into the Study pane
   */
  private reportsKeyboard(panel: vscode.WebviewPanel): boolean {
    return panel === this.contextPanel && this.studyPaneReportsKeyboard
  }

  /**
   * Says whether the editor names one of the reader's panes as its active editor; asked by {@link focusPaneForGridCommand}.
   * @param panel - The Application pane or the Study pane.
   * @returns `true` when the pane reports itself active and its tab is the one the active tab group shows in the pane's column; `false` otherwise, also while another editor part or a text editor is the active one.
   * @example this.isEditorsActivePane(this.contextPanel) // => true during a Read of the explanation
   */
  private isEditorsActivePane(panel: vscode.WebviewPanel): boolean {
    const group = vscode.window.tabGroups.activeTabGroup
    return (
      panel.active &&
      group.viewColumn === panel.viewColumn &&
      this.isCodebookPaneInput(
        group.activeTab?.input,
        this.paneViewTypeOf(panel),
      )
    )
  }

  /**
   * Names the view type of one of the reader's two panes; asked by {@link isEditorsActivePane} to find the pane's tab.
   * @param panel - The Application pane or the Study pane.
   * @returns `'codebook.scopedBrowser'` for the Application pane, `'codebook.studyContext'` for the Study pane.
   * @example this.paneViewTypeOf(this.app) // => 'codebook.scopedBrowser'
   */
  private paneViewTypeOf(
    panel: vscode.WebviewPanel,
  ): 'codebook.scopedBrowser' | 'codebook.studyContext' {
    return panel === this.app
      ? 'codebook.scopedBrowser'
      : 'codebook.studyContext'
  }

  /** Opens a closed reader for a focused Read command, then makes its owned pane readable without changing the selected item or run. @example await this.readStudyPane('source') */
  private async readStudyPane(
    region: 'app' | 'source' | 'context',
    signal?: AbortSignal,
  ): Promise<void> {
    if (region === 'context' && this.summaryComposition) {
      await this.showLearningSummary(signal)
      return
    }
    if (!vscode.window.state.focused)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Focus the Codebook work window before reading a pane.',
      )
    const focusLoss = new AbortController()
    const focusLost = new StudyError(
      'PRESENTATION_UNAVAILABLE',
      'The Codebook work window lost focus during Read. Retry Read from that window.',
    )
    const windowFocus = vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) focusLoss.abort(focusLost)
    })
    const readSignal = signal
      ? AbortSignal.any([signal, focusLoss.signal])
      : focusLoss.signal
    const assertReadFocus = (): void => {
      readSignal.throwIfAborted()
      if (!vscode.window.state.focused) throw focusLost
    }
    try {
      // Keep the departure latch through Open, source acquisition, pane reveal and native maximization.
      if (!this.opened) await this.open(readSignal)
      assertReadFocus()
      const selection = JSON.stringify(this.selection),
        bundle = this.recordingActive ? this.playback?.bundle() : undefined
      const focusBeforeRead = this.readingFocusOrigin()
      const assertPlacement = this.retainPresentationPlacement(false)
      if (region === 'source') {
        const sourceColumn = this.studyPanePositions().sourceColumn
        if (this.sourceReady() && this.sourceUri && sourceColumn) {
          // Reopen the existing native tab without a selection so a learner's cursor and scroll stay in place.
          const originalTab = this.trackFocusedStudyPane(false)
          let document: vscode.TextDocument
          try {
            document = await vscode.workspace.openTextDocument(this.sourceUri)
            assertReadFocus()
            originalTab.assertCurrent()
            assertPlacement()
          } finally {
            originalTab.dispose()
          }
          await vscode.window.showTextDocument(document, {
            viewColumn: sourceColumn,
            preserveFocus: false,
            preview: false,
          })
          assertReadFocus()
        } else {
          assertReadFocus()
          await this.renderSelection(false, false, readSignal)
          assertReadFocus()
        }
        if (
          !this.sourceReady() ||
          vscode.window.activeTextEditor?.document.uri.toString() !==
            this.sourceUri?.toString()
        )
          throw new StudyError(
            'EVIDENCE_UNAVAILABLE',
            'The selected captured source is not visible in its native pane.',
          )
      } else {
        const panel = region === 'app' ? this.app : this.contextPanel
        if (!panel)
          throw new StudyError(
            'PRESENTATION_UNAVAILABLE',
            'The requested Study pane is unavailable. Open Study and try again.',
          )
        const kind =
          region === 'app' ? 'codebook.scopedBrowser' : 'codebook.studyContext'
        assertReadFocus()
        panel.reveal(undefined, false)
        // At minimum widths the offscreen webview cannot acknowledge inner focus until its owned tab is maximized.
        await waitUntil(
          () => {
            const group = vscode.window.tabGroups.activeTabGroup,
              input = group.activeTab?.input
            return (
              group.viewColumn === panel.viewColumn &&
              this.isCodebookPaneInput(input, kind) &&
              panel.visible
            )
          },
          'owned Study pane tab',
          PRESENTATION_READY_TIMEOUT_MS,
          readSignal,
        )
        assertReadFocus()
      }
      assertReadFocus()
      assertPlacement()
      if (
        selection !== JSON.stringify(this.selection) ||
        (bundle && bundle !== this.playback?.bundle())
      )
        throw new StudyError(
          'PRESENTATION_UNAVAILABLE',
          'The selected study changed while reading a pane. Inspect its current state.',
        )
      const focusedPane = this.trackFocusedStudyPane(true, focusBeforeRead)
      try {
        // Maximize may settle after a newer learner tab choice; only its original owned target may publish Read success.
        assertReadFocus()
        await this.maximizeForRead(assertReadFocus)
        assertReadFocus()
        focusedPane.assertCurrent()
        assertPlacement()
        if (
          selection !== JSON.stringify(this.selection) ||
          (bundle && bundle !== this.playback?.bundle())
        )
          throw new StudyError(
            'PRESENTATION_UNAVAILABLE',
            'The selected study changed while reading a pane. Inspect its current state.',
          )
        if (region === 'source' && !this.sourceReady())
          throw new StudyError(
            'EVIDENCE_UNAVAILABLE',
            'The selected captured source is no longer visible in its native pane.',
          )
        this.layoutReceipt = undefined
        this.enlargedLayoutReceipt = undefined
        this.presentationConfirmed = false
        this.presentationReason = `Focused ${region === 'app' ? 'application' : region === 'source' ? 'source' : 'explanation'}. The ${this.liveComposition || this.summaryComposition ? 'app/source' : 'three-pane Study'} split is not confirmed. Use the pane controls or Restore layout.`
        this.lastActiveRegion = region
        this.errors.delete('reading')
        this.publish()
      } finally {
        focusedPane.dispose()
      }
    } finally {
      windowFocus.dispose()
    }
  }

  /**
   * Names an opaque reading tab across wrapper refreshes for {@link readingFocusOrigin}.
   * @param group - The native group containing the tab.
   * @param tab - Its selected tab, when one exists.
   * @returns Its position, label and state, or undefined without a selected tab.
   * @example const key = this.readingTabKey(group, group.activeTab)
   */
  private readingTabKey(
    group: vscode.TabGroup,
    tab: vscode.Tab | undefined,
  ): string | undefined {
    if (!tab) return undefined
    return JSON.stringify([
      group.viewColumn,
      group.tabs.indexOf(tab),
      tab.label,
      tab.isDirty,
      tab.isPreview,
      tab.isPinned,
    ])
  }

  /**
   * Captures the logical opaque tab before Read borrows focus; used by {@link readStudyPane} and {@link trackFocusedStudyPane}.
   * @returns The existing group identity and opaque-tab key; known native inputs have no fallback key.
   * @example const origin = this.readingFocusOrigin()
   */
  private readingFocusOrigin() {
    const group = vscode.window.tabGroups.activeTabGroup
    const tab = group.activeTab
    const opaque =
      tab !== undefined &&
      ![vscode.TabInputText, vscode.TabInputWebview].some(
        (inputType) => tab.input instanceof inputType,
      )
    return {
      opaque,
      groupIdentity: this.editorGroupIdentities.get(group),
      tabKey: opaque ? this.readingTabKey(group, tab) : undefined,
    }
  }

  /**
   * Resolves Read/Restore's native group when Cursor reports a focused text editor before its chat tab model; called by {@link trackFocusedStudyPane}.
   * @param allowTextEditorFallback - The same opaque tab observed at the start is still named; a new native tab choice always takes precedence.
   * @returns The matching text-editor group behind an opaque chat tab, otherwise the group the editor names.
   * @example const group = this.readingFocusGroup(sameOpaqueTab)
   */
  private readingFocusGroup(allowTextEditorFallback: boolean): vscode.TabGroup {
    const namedGroup = vscode.window.tabGroups.activeTabGroup
    // Never reinterpret a new native tab choice as the old source editor.
    if (!allowTextEditorFallback) return namedGroup
    const editor = vscode.window.activeTextEditor
    // A chat without an active text editor still uses its native tab identity.
    if (!editor) return namedGroup
    return (
      vscode.window.tabGroups.all.find(
        (candidate) =>
          candidate.viewColumn === editor.viewColumn &&
          candidate.activeTab?.input instanceof vscode.TabInputText &&
          candidate.activeTab.input.uri.toString() ===
            editor.document.uri.toString(),
      ) ?? namedGroup
    )
  }

  /**
   * Watches Read and Restore so later learner navigation wins over host commands.
   * @param requireOwned - Require a Codebook pane after Read has focused its requested surface.
   * @param fallbackOrigin - Logical opaque-tab identity captured before Read's focus handoff; a later choice cannot supply this origin.
   * @returns A disposable focus watch that rejects later learner departures and tracks explicitly borrowed native focus.
   * @example const focus = this.trackFocusedStudyPane(); focus.assertCurrent(); focus.dispose()
   */
  private trackFocusedStudyPane(
    requireOwned = false,
    fallbackOrigin = this.readingFocusOrigin(),
  ): {
    /** Throws when the learner changed the focus since the watch began; a focus the measurement borrowed and has not given back yet is no such change. */
    assertUndeparted(): void
    assertCurrent(): void
    beforeScopeFocus(acquire?: RepositoryFocusTarget): void
    endReadMaximization(end: () => Promise<void>): Promise<void>
    dispose(): void
  } {
    // Wrapper-only updates preserve identity; a different logical group or selected tab revokes it.
    const currentReadingGroup = (): vscode.TabGroup => {
      const current = this.readingFocusOrigin()
      return this.readingFocusGroup(
        fallbackOrigin.opaque &&
          fallbackOrigin.groupIdentity !== undefined &&
          fallbackOrigin.groupIdentity === current.groupIdentity &&
          fallbackOrigin.tabKey === current.tabKey,
      )
    }
    const group = currentReadingGroup(),
      input = group.activeTab?.input
    const expectedColumn = group.viewColumn
    const panes = this.studyPanePositions(),
      sourceUri = this.sourceUri?.toString()
    const webviewKind =
      input instanceof vscode.TabInputWebview ? input.viewType : undefined
    const appKind =
      webviewKind !== undefined &&
      isCodebookPaneViewType(webviewKind, 'codebook.scopedBrowser') &&
      expectedColumn === panes.appColumn
    const contextKind =
      webviewKind !== undefined &&
      isCodebookPaneViewType(webviewKind, 'codebook.studyContext') &&
      expectedColumn === panes.contextColumn
    const sourceKind =
      input instanceof vscode.TabInputText &&
      input.uri.toString() === sourceUri &&
      expectedColumn === panes.sourceColumn
    if (requireOwned && !appKind && !contextKind && !sourceKind)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Focus an owned Study pane before changing its reading layout.',
      )
    const textUri =
      input instanceof vscode.TabInputText ? input.uri.toString() : undefined
    const retainsFocus = () => {
      const active = currentReadingGroup(),
        current = active.activeTab?.input
      return (
        vscode.window.state.focused &&
        active.viewColumn === expectedColumn &&
        (textUri !== undefined
          ? current instanceof vscode.TabInputText &&
            current.uri.toString() === textUri
          : webviewKind !== undefined
            ? current instanceof vscode.TabInputWebview &&
              current.viewType === webviewKind
            : current === input)
      )
    }
    let departed = false,
      borrowed: RepositoryFocusTarget | undefined,
      pendingBorrow: RepositoryFocusTarget | undefined,
      endingMaximization = false
    const observe = (): void => {
      if (departed) return
      // Leaving the work window revokes Restore even if focus returns before native measurement completes.
      if (!vscode.window.state.focused) {
        departed = true
        return
      }
      // While Codebook's own commands end a Read's maximization, the editor's group events are judged by the focus they leave once they settled.
      if (endingMaximization) return
      if (pendingBorrow?.matchesGroup()) {
        // Only the announced native target can replace the old focus; returning to the original pane ends the borrow.
        borrowed = retainsFocus() ? undefined : pendingBorrow
        pendingBorrow = undefined
      } else if (!(borrowed?.matchesGroup() ?? retainsFocus())) departed = true
    }
    const assertRetained = (): void => {
      observe()
      if (departed)
        throw new StudyError(
          'PRESENTATION_UNAVAILABLE',
          'The learner changed native tab focus while the Study layout command was pending. The newer choice was preserved.',
        )
    }
    const subscriptions = [
      vscode.window.tabGroups.onDidChangeTabs(observe),
      vscode.window.tabGroups.onDidChangeTabGroups(observe),
      vscode.window.onDidChangeActiveTextEditor(observe),
      vscode.window.onDidChangeWindowState(observe),
    ]
    return {
      assertUndeparted: assertRetained,
      assertCurrent(): void {
        assertRetained()
        if (borrowed || pendingBorrow || !retainsFocus())
          throw new StudyError(
            'PRESENTATION_UNAVAILABLE',
            'The Study pane did not regain native focus after layout measurement.',
          )
      },
      beforeScopeFocus(acquire): void {
        assertRetained()
        if (!acquire || pendingBorrow)
          throw new StudyError(
            'PRESENTATION_UNAVAILABLE',
            'The Study scope focus target could not be retained safely.',
          )
        pendingBorrow = acquire
        observe()
      },
      /**
       * Runs Codebook's own commands that end a Read's maximization (the un-maximize and the side bars shown again); called by the live branch of {@link admitPresentation} and by {@link restoreStudyArrangement} before they measure.
       * Cursor names another editor group as the active one for a moment while a maximization ends (Cycle 0045 NF-7b): an active group the editor names while these commands run, and one it names again within {@link UNMAXIMIZE_FOCUS_SETTLE_MS} after them, is their event, not the learner's change. A change that lasts past that moment, and leaving the work window, still count.
       * @param end - The commands that end the maximization.
       * @returns Once the commands answered and the editor names the watched focus again, or the settle time passed.
       * @throws What `end` throws.
       * @example
       * ```ts
       * await focusedPane.endReadMaximization(async () => {
       *   await vscode.commands.executeCommand('workbench.action.minimizeOtherEditors')
       *   await this.showSideBarsHiddenByRead()
       * })
       * ```
       */
      async endReadMaximization(end): Promise<void> {
        endingMaximization = true
        try {
          await end()
          // A group named for the un-maximize alone gives way to the watched focus within the settle time; a change that lasts is the learner's.
          await waitUntil(
            () => !vscode.window.state.focused || retainsFocus(),
            'the focus after the maximization ended',
            UNMAXIMIZE_FOCUS_SETTLE_MS,
          ).catch(() => undefined)
        } finally {
          endingMaximization = false
        }
        observe()
      },
      dispose(): void {
        for (const subscription of subscriptions) subscription.dispose()
      },
    }
  }

  /**
   * Enlarges an owned pane while retaining the measured grid that {@link tryConfirmEnlargedLayout} restores; called by both Study Enlarge actions ("Enlarge application", "Enlarge explanation").
   * It ends a reading that is on (the side bars the Read hid are shown again), runs the editor's Expand and then its maximize toggle. The Expand resizes every group, so the layout of before is kept ({@link expandKeepingGroupSizes}, {@link groupSizesBeforeEnlarge}). An Enlarge ends in one of these ways: its own way back, a Restore of a confirmed three-pane arrangement, applies the measured layout again ({@link tryConfirmEnlargedLayout}); any other Restore ends the maximization with Expand and arranges, or gives the kept sizes back where it arranges nothing; a Close ends the maximization and gives the kept sizes back ({@link endEnlargementAtClose}); a Read or another Enlarge goes on from it and keeps the sizes of before the first; the learner's own maximize toggle leaves the expanded sizes until one of the others.
   * @param panel - The pane to enlarge, one of the reader's two.
   * @param region - Which pane that is, for the region the reader takes as the active one afterwards.
   * @returns Once the editor answered the maximize toggle and the state is published.
   * @throws When the pane cannot take the focus, when the learner changed the focus or the panes meanwhile, and a rejection of an editor command; after the Expand the groups then get their sizes back, unless the learner's change stops that ({@link maximizeAfterExpand}).
   * @example await this.enlargePresentationPanel(this.app!, 'app')
   */
  private async enlargePresentationPanel(
    panel: vscode.WebviewPanel,
    region: 'app' | 'context',
  ): Promise<void> {
    const previous = this.enlargedLayoutReceipt,
      confirmed = this.presentationState().layoutConfirmed
    const receipt = confirmed
      ? this.layoutReceipt
      : previous?.mode === this.presentationMode &&
          previous.receipt === this.layoutReceipt
        ? previous.receipt
        : undefined
    const expectedSignature = confirmed
      ? receipt?.signature
      : previous?.expandedSignature
    // Native focus must belong to the requested pane before Expand or Maximize changes the editor grid.
    await this.focusPaneForGridCommand(panel)
    const before = receipt
      ? await this.readPassivePresentationLayout()
      : undefined
    const retained = Boolean(
      receipt &&
      before !== undefined &&
      JSON.stringify(before) === expectedSignature &&
      this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) &&
      this.sameStudyPanePositions(receipt.panes),
    )
    const layoutBefore = await this.groupSizesBeforeEnlarge(before)
    const assertRetained = this.retainPresentationPlacement()
    this.enlargedLayoutReceipt = undefined
    this.presentationConfirmed = false
    try {
      // Expand exits any previous maximization and changes the group sizes; the sizes of before are kept for the way out, and the expanded ones are captured before Maximize.
      await this.expandKeepingGroupSizes(layoutBefore)
      let expanded: unknown
      await this.maximizeAfterExpand(assertRetained, async () => {
        this.maximizedByRead = false
        await this.showSideBarsHiddenByRead()
        assertRetained()
        expanded = retained
          ? await this.readPassivePresentationLayout()
          : undefined
        assertRetained()
        await vscode.commands.executeCommand(
          'workbench.action.toggleMaximizeEditorGroup',
        )
        assertRetained()
      })
      if (retained && expanded !== undefined && receipt) {
        this.enlargedLayoutReceipt = {
          receipt,
          mode: this.presentationMode,
          expandedSignature: JSON.stringify(expanded),
        }
      }
      this.lastActiveRegion = region
    } finally {
      this.publish()
    }
  }

  /** Protects passive awaits in {@link performPresentation} from adopting learner pane/group/focus changes. @example const assertRetained = this.retainPresentationPlacement(); */
  private retainPresentationPlacement(retainFocus = true): () => void {
    const transition = this.presentationTransition,
      lifetime = this.lifetime
    const panes = this.studyPanePositions(),
      groups = vscode.window.tabGroups.all.map((group) => ({
        group,
        column: group.viewColumn,
      }))
    const nativeGroup = vscode.window.tabGroups.activeTabGroup,
      focusedTab = nativeGroup.activeTab
    const focusedGroup = this.editorGroupIdentities.get(nativeGroup)
    const focusedWebview =
      focusedTab?.input instanceof vscode.TabInputWebview
        ? focusedTab.input.viewType
        : undefined
    const focusedWebviewCloseRevision =
      focusedWebview === undefined
        ? undefined
        : this.webviewCloseRevisions.get(focusedWebview)
    const backgroundSourceColumn = vscode.window.activeTextEditor?.viewColumn,
      registeringApp = this.initialAppPlacement?.panel
    const coveredBackgroundSource = Boolean(
      registeringApp &&
      registeringApp === this.app &&
      focusedWebview !== undefined &&
      backgroundSourceColumn !== undefined &&
      backgroundSourceColumn === registeringApp.viewColumn &&
      backgroundSourceColumn !== nativeGroup.viewColumn,
    )
    // Only owned active webviews make the last-text receipt irrelevant; elsewhere its changes still protect learner focus.
    const focusedSource = () =>
      this.app?.active || this.contextPanel?.active
        ? undefined
        : vscode.window.activeTextEditor?.document.uri.toString()
    const source = focusedSource(),
      appActive = this.app?.active,
      contextActive = this.contextPanel?.active
    return (): void => {
      const active = vscode.window.tabGroups.activeTabGroup
      const sameWebviewTab =
        active.activeTab === focusedTab ||
        Boolean(
          active !== nativeGroup &&
          focusedGroup &&
          focusedGroup === this.editorGroupIdentities.get(active) &&
          active.activeTab?.input instanceof vscode.TabInputWebview &&
          active.activeTab.input.viewType === focusedWebview &&
          nativeGroup.tabs.filter(
            (tab) =>
              tab.input instanceof vscode.TabInputWebview &&
              tab.input.viewType === focusedWebview,
          ).length === 1 &&
          active.tabs.filter(
            (tab) =>
              tab.input instanceof vscode.TabInputWebview &&
              tab.input.viewType === focusedWebview,
          ).length === 1,
        )
      // The cold app may clear its covered text receipt after registration, while the same native Wiki survives this passive read.
      const sameSource =
        source === focusedSource() ||
        (coveredBackgroundSource &&
          registeringApp === this.app &&
          focusedSource() === undefined)
      const sameFocus =
        !retainFocus ||
        (focusedGroup ===
          this.editorGroupIdentities.get(
            vscode.window.tabGroups.activeTabGroup,
          ) &&
          (focusedWebview === undefined ||
            (sameWebviewTab &&
              focusedWebviewCloseRevision ===
                this.webviewCloseRevisions.get(focusedWebview))) &&
          sameSource &&
          appActive === this.app?.active &&
          contextActive === this.contextPanel?.active)
      if (
        this.sameEditorGroups(groups, vscode.window.tabGroups.all) &&
        this.sameStudyPanePositions(panes) &&
        sameFocus
      )
        return
      // Retire only this operation's focus ownership; an older passive read cannot suppress a newer transition's recovery.
      if (
        transition === this.presentationTransition &&
        lifetime === this.lifetime
      )
        this.presentationMovedFocus = false
      throw new Error(
        'Native pane, group or focus changed while presentation waited; the learner arrangement was preserved.',
      )
    }
  }

  /** Creates pinned final-column panes for {@link placePresentation}, adopts drained leases, then retires only their predecessors. @example await this.replacePresentationPanels(mode, signal, assertCurrent, viewports) */
  private async replacePresentationPanels(
    mode: PresentationMode,
    signal: AbortSignal,
    assertCurrent: () => void,
    viewports: readonly BrowserViewport[],
  ): Promise<void> {
    const previousApp = this.app,
      previousContext = this.contextPanel,
      descriptor = STUDY_PRESENTATIONS[mode]
    if (!previousApp || !previousContext)
      throw new Error('The current presentation panes are unavailable.')
    const roles = [
      {
        region: 'app',
        panel: previousApp,
        kind: 'codebook.scopedBrowser',
        column: descriptor.appColumn,
        previousColumn: previousApp.viewColumn,
      },
      {
        region: 'contextPanel',
        panel: previousContext,
        kind: 'codebook.studyContext',
        column: descriptor.contextColumn,
        previousColumn: previousContext.viewColumn,
      },
    ] as const
    const matches = (tab: vscode.Tab, kind: string) =>
      tab.input instanceof vscode.TabInputWebview &&
      isCodebookPaneViewType(tab.input.viewType, kind)
    const groups = vscode.window.tabGroups.all.map((group) => ({
      group,
      column: group.viewColumn,
    }))
    const replacements = new Map<
      (typeof roles)[number]['region'],
      vscode.WebviewPanel
    >()
    const registered = new Set<(typeof roles)[number]['region']>()
    const closed = new Set<vscode.WebviewPanel>(),
      subscriptions: vscode.Disposable[] = []
    const expectedPinnedTabCounts = new Map(
      roles.map((role) => [
        role.region,
        (vscode.window.tabGroups.all
          .find((group) => group.viewColumn === role.column)
          ?.tabs.filter((tab) => matches(tab, role.kind) && !tab.isPreview)
          .length ?? 0) + 1,
      ]),
    )
    const editorScope = this.presentationEditorScope
    const isRegistered = (
      role: (typeof roles)[number],
      panel: vscode.WebviewPanel,
    ) => {
      const destination = vscode.window.tabGroups.all.find(
        (group) => group.viewColumn === role.column,
      )
      // Same-column overlap adds one pinned tab; native panel visibility identifies it across host wrapper resyncs.
      const pinned =
        destination?.tabs.filter(
          (tab) => matches(tab, role.kind) && !tab.isPreview,
        ) ?? []
      return (
        panel.viewColumn === role.column &&
        panel.visible &&
        !panel.active &&
        pinned.length === expectedPinnedTabCounts.get(role.region) &&
        Boolean(
          destination?.activeTab && pinned.includes(destination.activeTab),
        )
      )
    }
    const assertRetained = (): void => {
      signal.throwIfAborted()
      assertCurrent()
      if (!this.sameEditorGroups(groups, vscode.window.tabGroups.all))
        throw new Error(
          'Native editor groups changed during pane creation; the learner arrangement was preserved.',
        )
      if (this.app !== previousApp || this.contextPanel !== previousContext)
        throw new Error(
          'A current presentation pane was closed during handoff.',
        )
      if (closed.size)
        throw new Error(
          'A replacement presentation pane was closed before adoption.',
        )
      // A verified first replacement cannot become a new baseline while the second registers.
      if (
        roles.some(
          (role) =>
            role.panel.viewColumn !== role.previousColumn ||
            (registered.has(role.region) &&
              !isRegistered(role, replacements.get(role.region)!)),
        )
      ) {
        this.presentationMovedFocus = false
        throw new Error(
          'A presentation pane moved during creation; the later learner arrangement was preserved.',
        )
      }
    }
    try {
      for (const role of roles) {
        assertRetained()
        const tabs = vscode.window.tabGroups.all
          .flatMap((group) => group.tabs)
          .filter((tab) => matches(tab, role.kind))
        if (tabs.length !== 1)
          throw new Error('The current presentation tab is not unique.')
        // Only this owned same-column creation may temporarily duplicate an otherwise unique pinned role.
        if (role.previousColumn === role.column)
          for (const kind of [
            role.kind,
            `${MAIN_THREAD_WEBVIEW_PREFIX}${role.kind}`,
          ]) {
            editorScope?.overlappingPanes.set(`webview:${kind}`, {
              column: role.column,
              tabCount: expectedPinnedTabCounts.get(role.region)!,
            })
          }
        // Actual layout transactions need fresh documents; same-column reuse can omit native inner-focus delivery.
        const replacement = vscode.window.createWebviewPanel(
          role.kind,
          role.panel.title,
          { viewColumn: role.column, preserveFocus: true },
          {
            enableScripts: true,
            localResourceRoots: [],
            retainContextWhenHidden: true,
          },
        )
        replacements.set(role.region, replacement)
        subscriptions.push(
          replacement.onDidDispose(() => closed.add(replacement)),
        )
        await waitUntil(
          () => {
            assertRetained()
            return isRegistered(role, replacement)
          },
          'pinned replacement presentation pane',
          PRESENTATION_READY_TIMEOUT_MS,
          signal,
        )
        registered.add(role.region)
      }
      assertRetained()
      const replacementApp = replacements.get('app'),
        replacementContext = replacements.get('contextPanel')
      // No await separates lease adoption from listener ownership; disposal cannot land between these stages.
      if (replacementApp) {
        for (const viewport of viewports)
          viewport.rebindPanel(replacementApp, signal)
        this.bindApplicationPanel(replacementApp)
        // Retired replay pixels no longer confirm this document; preserve the bundle for the next explicit presentation.
        if (this.recordingActive && this.replayViewport) {
          this.replayNeedsReveal = true
          this.playback?.hide()
        }
        this.initialAppPlacement?.registration?.dispose()
        this.initialAppPlacement = undefined
      }
      if (replacementContext) this.bindContextPanel(replacementContext)
      if (replacementApp) previousApp.dispose()
      if (replacementContext) previousContext.dispose()
      await waitUntil(
        () => {
          signal.throwIfAborted()
          assertCurrent()
          if (!this.sameEditorGroups(groups, vscode.window.tabGroups.all))
            throw new Error(
              'Native editor groups changed while retiring previous panes.',
            )
          return roles.every((role) => {
            const current = this[role.region],
              expected = replacements.get(role.region) ?? role.panel
            if (current !== expected)
              throw new Error(
                'A current presentation pane was closed after adoption.',
              )
            const tabs = vscode.window.tabGroups.all
              .flatMap((group) => group.tabs)
              .filter((tab) => matches(tab, role.kind))
            const destination = vscode.window.tabGroups.all.find(
              (group) => group.viewColumn === role.column,
            )
            return (
              current.viewColumn === role.column &&
              current.visible &&
              tabs.length === 1 &&
              !tabs[0]!.isPreview &&
              destination?.activeTab === tabs[0]
            )
          })
        },
        'unique pinned presentation panes',
        PRESENTATION_READY_TIMEOUT_MS,
        signal,
      )
    } finally {
      editorScope?.overlappingPanes.clear()
      for (const subscription of subscriptions) subscription.dispose()
      // Failed creation removes only unadopted owned panes; adopted state never rolls back over newer learner input.
      for (const [region, replacement] of replacements)
        if (this[region] !== replacement) replacement.dispose()
    }
  }

  /**
   * Finds the preview tab a presentation change is refused for: a moved pane takes the preview place of its destination group, and Codebook cannot keep this tab open for the learner. Called by {@link performPresentation} before a closed reader is opened, so that the refusal is answered before any pane exists, and by {@link placePresentation} before it moves a pane.
   * @returns The first preview tab that is neither a Codebook pane nor an unedited text tab (which {@link placePresentation} keeps by pinning it), with its group; `undefined` when there is none.
   * @example
   * ```ts
   * const unkept = this.unkeptPreview()
   * if (unkept) throw new StudyError('PRESENTATION_UNAVAILABLE', foreignPreviewObstacle(this.editorTabName(unkept.tab), unkept.group.viewColumn))
   * ```
   */
  private unkeptPreview():
    { tab: vscode.Tab; group: vscode.TabGroup } | undefined {
    return vscode.window.tabGroups.all
      .flatMap((group) => group.tabs.map((tab) => ({ group, tab })))
      .find(
        ({ tab }) =>
          tab.isPreview &&
          !this.isCodebookPaneInput(
            tab.input,
            'codebook.scopedBrowser',
            'codebook.studyContext',
          ) &&
          !(tab.input instanceof vscode.TabInputText && !tab.isDirty),
      )
  }

  /**
   * Names an editor tab the way its tab strip shows it, for the shared foreign-preview obstacle text of {@link placePresentation} and {@link readMainEditorGrid}.
   * @param tab - A tab of any editor group.
   * @returns A text tab's file name, otherwise the tab's label.
   * @example this.editorTabName(loginFormPreview) // => 'login-form.tsx'
   */
  private editorTabName(tab: vscode.Tab): string {
    return tab.input instanceof vscode.TabInputText
      ? basename(tab.input.uri.fsPath)
      : tab.label
  }

  /** Relocates retained native panels/source and certifies the final descriptor after movement; no renderer ACK runs under this lock. @example await this.placePresentation('living-book', signal) */
  private async placePresentation(
    mode: PresentationMode,
    signal: AbortSignal,
    assertEvidence: () => void,
    viewports: readonly BrowserViewport[],
    retainSourceFocus: (assertSourceFocus: () => void) => void,
  ): Promise<() => void> {
    const sourceUri = this.sourceUri,
      revision = this.revision
    let assertPlacedSourceFocus: (() => void) | undefined
    if (!sourceUri)
      throw new Error('No selected immutable source is available.')
    const assertSourcePlacement = this.retainPresentationPlacement()
    const document = await vscode.workspace.openTextDocument(sourceUri)
    signal.throwIfAborted()
    assertEvidence()
    assertSourcePlacement()
    if (sourceUri !== this.sourceUri || revision !== this.revision)
      throw new Error(
        'The selected source changed before it could be arranged.',
      )
    await this.withLayout(signal, async (_lifetime, assertCurrent) => {
      assertSourcePlacement()
      let app = this.app,
        context = this.contextPanel
      const descriptor = STUDY_PRESENTATIONS[mode]
      if (!app || !context || !sourceUri)
        throw new Error('The three retained Study panes are unavailable.')
      const source = vscode.window.visibleTextEditors.find(
        (editor) =>
          editor.document.uri.toString() === sourceUri.toString() &&
          editor.viewColumn === this.studyPanePositions().sourceColumn,
      )
      const selections = source?.selections,
        restoreReadingPosition = retainEditorReadingPosition(source)
      // Unedited text previews are kept by pinning them in place; an edited or non-text preview stays learner-owned and refuses the move.
      const ownedKinds = ['codebook.scopedBrowser', 'codebook.studyContext']
      const isOwnedPreview = (tab: vscode.Tab) =>
        tab.input instanceof vscode.TabInputWebview &&
        isCodebookPaneViewType(tab.input.viewType, ...ownedKinds)
      const isKeptPreview = (tab: vscode.Tab) =>
        tab.input instanceof vscode.TabInputText && !tab.isDirty
      const unkept = this.unkeptPreview()
      if (unkept)
        throw new StudyError(
          'PRESENTATION_UNAVAILABLE',
          foreignPreviewObstacle(
            this.editorTabName(unkept.tab),
            unkept.group.viewColumn,
          ),
        )
      // A moved pane replaces the preview tab of its destination group, so the refusal names that tab, its group and how to clear it: the shared obstacle text, or, for a preview the next attempt pins by itself, only that it was left alone.
      const refusePreview = (
        tab: vscode.Tab,
        group: vscode.TabGroup,
        openedWhileArranging = false,
      ): StudyError =>
        new StudyError(
          'PRESENTATION_UNAVAILABLE',
          openedWhileArranging && isKeptPreview(tab)
            ? `The preview tab "${this.editorTabName(tab)}" was opened while the Codebook panes were being arranged and was left as it is. Change the presentation again.`
            : foreignPreviewObstacle(this.editorTabName(tab), group.viewColumn),
        )
      const assertPreviewOwnership = (): void => {
        const foreignPreview = vscode.window.tabGroups.all
          .flatMap((group) => group.tabs.map((tab) => ({ group, tab })))
          .find(({ tab }) => tab.isPreview && !isOwnedPreview(tab))
        if (!foreignPreview) return
        // A preview opened during a passive await belongs to the learner, including its current focus.
        this.presentationMovedFocus = false
        throw refusePreview(foreignPreview.tab, foreignPreview.group, true)
      }
      // A debugger stop opens a cited workspace file as a clean preview and a learner's single click opens any file as one; both are kept by pinning instead of refusing the selection.
      const preparedPreviews: {
        uri: vscode.Uri
        group: vscode.TabGroup
        tab: vscode.Tab
      }[] = []
      for (const group of vscode.window.tabGroups.all)
        for (const tab of group.tabs)
          if (
            tab.isPreview &&
            !isOwnedPreview(tab) &&
            tab.input instanceof vscode.TabInputText
          )
            preparedPreviews.push({ uri: tab.input.uri, group, tab })
      // Reject previews that cannot be kept before even borrowing focus to identify the native editor part.
      const grid = await this.readMainEditorGrid(signal, () => {
        assertCurrent()
        assertEvidence()
      })
      if (grid.groups.length > STUDY_EDITOR_GROUP_COUNT)
        throw new StudyError(
          'PRESENTATION_UNAVAILABLE',
          'More than three editor groups are open. Keep your tabs and consolidate groups, or use Focus application/source/explanation.',
        )
      const otherGroupCount =
        vscode.window.tabGroups.all.length - grid.groups.length
      if (grid.groups.length < STUDY_EDITOR_GROUP_COUNT && otherGroupCount)
        throw new StudyError(
          'PRESENTATION_UNAVAILABLE',
          'The main editor has fewer than three groups beside another editor part. Focus the main editor and restore its panes before changing presentation.',
        )
      const assertPlacement = (): void => {
        assertCurrent()
        assertEvidence()
        if (
          vscode.window.tabGroups.all.length >
          STUDY_EDITOR_GROUP_COUNT + otherGroupCount
        )
          throw new Error(
            'An editor group was added during placement; it was preserved.',
          )
      }
      // Native debugger stops open prepared repository files as previews even while the captured reader is active, and a learner's single click opens a workspace file as one; both stay, pinned.
      for (const prepared of preparedPreviews) {
        const assertPreparedPlacement = this.retainPresentationPlacement()
        const sourceDocument = await Promise.resolve(
          vscode.workspace.openTextDocument(prepared.uri),
        ).catch(() => {
          // A text tab whose document the editor cannot open again cannot be pinned through the API.
          throw refusePreview(prepared.tab, prepared.group)
        })
        assertPlacement()
        assertPreparedPlacement()
        if (
          sourceDocument.isDirty ||
          !vscode.window.tabGroups.all.includes(prepared.group) ||
          !prepared.group.tabs.includes(prepared.tab) ||
          prepared.tab.isDirty
        )
          throw new Error(
            'The prepared preview changed before it could be retained.',
          )
        await vscode.window.showTextDocument(sourceDocument, {
          viewColumn: prepared.group.viewColumn,
          preserveFocus: true,
          preview: false,
        })
        assertPlacement()
        await waitUntil(
          () =>
            prepared.group.tabs.some(
              (tab) =>
                tab.input instanceof vscode.TabInputText &&
                tab.input.uri.toString() === prepared.uri.toString() &&
                !tab.isPreview,
            ),
          'prepared source preview retained',
          PRESENTATION_READY_TIMEOUT_MS,
          signal,
        )
        assertPlacement()
      }
      assertPreviewOwnership()
      // Native relocation can flatten the nested grid and omit its height; retain both axes before moving panes.
      const assertBeforeMove = this.retainPresentationPlacement()
      const retainedLayout = await vscode.commands.executeCommand<unknown>(
        'vscode.getEditorLayout',
      )
      assertPlacement()
      assertBeforeMove()
      assertPreviewOwnership()
      // Scope remains verified while geometry is provisional; empty foreign wrappers must not acquire a new identity.
      this.presentationEditorScope = {
        signal,
        lifetime: this.lifetime,
        mainCount: otherGroupCount
          ? grid.groups.length
          : STUDY_EDITOR_GROUP_COUNT,
        overlappingPanes: new Map(),
      }
      this.layoutReceipt = undefined
      // Occupy the source destination to prevent empty-group renumbering and keep focus off moving webviews.
      this.presentationMovedFocus = true
      const requestedSourcePosition =
        selections?.[0]?.active ??
        document.validatePosition(
          new vscode.Position(this.message().model.source.line - 1, 0),
        )
      const requestedSourceSelection = new vscode.Range(
        requestedSourcePosition,
        requestedSourcePosition,
      )
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: descriptor.sourceColumn,
        preserveFocus: false,
        preview: false,
        selection: requestedSourceSelection,
      })
      assertPlacement()
      const matchesRequestedSelection = (
        current: readonly vscode.Selection[],
      ) =>
        current.length === 1 &&
        Boolean(
          current[0]?.anchor.isEqual(requestedSourcePosition) &&
          current[0].active.isEqual(requestedSourcePosition),
        )
      // Bind the display to a known cursor before awaiting it; later learner input cannot become our restoration baseline.
      if (
        !matchesRequestedSelection(editor.selections) ||
        !matchesRequestedSelection(
          vscode.window.activeTextEditor?.selections ?? [],
        )
      ) {
        this.presentationMovedFocus = false
        throw new Error(
          'Native source selection changed before its display response; the newer learner selection was preserved.',
        )
      }
      this.sourceGroup = vscode.window.tabGroups.all.find(
        (group) => group.viewColumn === descriptor.sourceColumn,
      )
      const sourceGroupIdentity =
        this.sourceGroup && this.editorGroupIdentities.get(this.sourceGroup)
      let sourceSelectionSnapshot = JSON.stringify(
        vscode.window.activeTextEditor?.selections,
      )
      const assertSourceFocus = (): void => {
        const activeEditor = vscode.window.activeTextEditor
        // Only a verified logical survivor may replace the focused group's native wrapper.
        const sameFocus =
          activeEditor?.document.uri.toString() === sourceUri.toString() &&
          activeEditor.viewColumn === descriptor.sourceColumn &&
          sourceGroupIdentity !== undefined &&
          this.editorGroupIdentities.get(
            vscode.window.tabGroups.activeTabGroup,
          ) === sourceGroupIdentity
        if (
          sameFocus &&
          JSON.stringify(activeEditor?.selections) === sourceSelectionSnapshot
        )
          return
        // Later learner focus or selection ends ownership; do not move again or restore stale reading state.
        this.presentationMovedFocus = false
        throw new Error(
          sameFocus
            ? 'Native source selection changed while presentation panes moved; the learner selection was preserved.'
            : 'Native focus changed while presentation panes moved; the learner focus was preserved.',
        )
      }
      assertSourceFocus()
      // A later native failure may restore initiating focus only while this exact source anchor still owns it.
      retainSourceFocus(assertSourceFocus)
      const ownedContext = context
      if (
        grid.groups.length < STUDY_EDITOR_GROUP_COUNT &&
        ownedContext.viewColumn !== descriptor.contextColumn
      ) {
        // Move only the owned explanation after source occupies column two, so its new group cannot close on creation.
        ownedContext.reveal(descriptor.contextColumn, true)
        await waitUntil(
          () => {
            assertPlacement()
            assertSourceFocus()
            const destination = vscode.window.tabGroups.all.find(
              (group) => group.viewColumn === descriptor.contextColumn,
            )
            const input = destination?.activeTab?.input
            return (
              this.contextPanel === ownedContext &&
              ownedContext.viewColumn === descriptor.contextColumn &&
              vscode.window.tabGroups.all.length === STUDY_EDITOR_GROUP_COUNT &&
              input instanceof vscode.TabInputWebview &&
              isCodebookPaneViewType(input.viewType, 'codebook.studyContext')
            )
          },
          'owned explanation destination',
          PRESENTATION_READY_TIMEOUT_MS,
          signal,
        )
      }
      await this.replacePresentationPanels(
        mode,
        signal,
        () => {
          assertPlacement()
          assertPreviewOwnership()
          assertSourceFocus()
        },
        viewports,
      )
      app = this.app
      context = this.contextPanel
      if (!app || !context)
        throw new Error('The current presentation panes were closed.')
      assertPreviewOwnership()
      if (selections) editor.selections = selections
      // Retain the selection after our deliberate restoration, so final focus can leave only this owned source.
      sourceSelectionSnapshot = JSON.stringify(
        vscode.window.activeTextEditor?.selections,
      )
      assertPlacedSourceFocus = assertSourceFocus
      if (this.highlight)
        for (const visible of vscode.window.visibleTextEditors)
          if (visible.document.uri.toString() === sourceUri.toString())
            visible.setDecorations(this.highlight, [
              new vscode.Range(
                new vscode.Position(this.message().model.source.line - 1, 0),
                new vscode.Position(this.message().model.source.line - 1, 0),
              ),
            ])
      this.sourceGroup = vscode.window.tabGroups.all.find(
        (group) => group.viewColumn === descriptor.sourceColumn,
      )
      const assertAfterMove = this.retainPresentationPlacement()
      const measuredLayout = await vscode.commands.executeCommand<unknown>(
        'vscode.getEditorLayout',
      )
      assertPlacement()
      assertAfterMove()
      assertSourceFocus()
      // Minimum-size native groups may opt out of proportional expansion; supply actual pixels when both axes are measured.
      await vscode.commands.executeCommand(
        'vscode.setEditorLayout',
        toPixelEditorLayout(descriptor.layout, measuredLayout) ??
          toPixelEditorLayout(descriptor.layout, retainedLayout) ??
          descriptor.layout,
      )
      assertPlacement()
      assertSourceFocus()
      const assertSettling = this.retainPresentationPlacement()
      await waitUntil(
        async () => {
          const actual = await vscode.commands.executeCommand<unknown>(
            'vscode.getEditorLayout',
          )
          assertPlacement()
          assertSettling()
          assertSourceFocus()
          return isProportionalEditorLayout(descriptor.layout, actual)
        },
        'presentation grid proportions',
        PRESENTATION_READY_TIMEOUT_MS,
        signal,
      )
      assertPlacement()
      assertSourceFocus()
      const assertConfirmed = this.retainPresentationPlacement()
      // Relocation and resizing can replace the native view state; restore a visible anchor only after both settle.
      if (!app.active && !context.active) assertSourceFocus()
      await restoreReadingPosition(editor, signal)
      assertPlacement()
      assertConfirmed()
      if (!app.active && !context.active) assertSourceFocus()
      const layout = await vscode.commands.executeCommand<unknown>(
        'vscode.getEditorLayout',
      )
      assertPlacement()
      assertConfirmed()
      if (!app.active && !context.active) assertSourceFocus()
      if (
        !isProportionalEditorLayout(descriptor.layout, layout) ||
        !grid.preservesOtherParts(STUDY_EDITOR_GROUP_COUNT)
      )
        throw new Error(
          'Native layout or another editor part changed while retaining presentation panels.',
        )
      const panes = this.studyPanePositions()
      if (
        panes.app !== app ||
        panes.context !== context ||
        panes.appColumn !== descriptor.appColumn ||
        panes.contextColumn !== descriptor.contextColumn ||
        panes.sourceColumn !== descriptor.sourceColumn ||
        this.sourceUri !== sourceUri
      )
        throw new Error('Native panes changed before layout confirmation.')
      this.layoutReceipt = {
        mode: 'study',
        signature: JSON.stringify(layout),
        groups: vscode.window.tabGroups.all.map((group) => ({
          group,
          column: group.viewColumn,
        })),
        panes,
      }
      this.repositoryLayoutRestored = undefined
      this.errors.delete('layout')
    })
    if (!assertPlacedSourceFocus)
      throw new Error('The placed source focus receipt is unavailable.')
    return assertPlacedSourceFocus
  }

  /** Shares the existing workspace ledger with the repository reader without creating runtime prerequisites. @example await workspace.learningStorage() */
  async learningStorage(): Promise<LearningLibrary> {
    await this.initialize()
    return this.library!
  }

  /** Restores the actual article's native layout on Return; ordinary {@link RepositoryReader.open} keeps the existing owned-entry policy. @example await workspace.arrangeRepository(signal, selection) */
  async arrangeRepository(
    signal: AbortSignal,
    returnSelection?: RepositorySelection,
    focus?: RepositoryLayoutFocus,
  ): Promise<void> {
    this.assertPresentationIdle()
    if (returnSelection && this.repositoryLayoutOrigin) {
      await this.restoreRepositoryLayout(returnSelection, signal, focus)
      return
    }
    // A cold Wiki has no owned Study receipt yet, but its column Two must be a real main-grid leaf.
    if (!this.opened && !this.layoutReceipt) {
      await this.initialize()
      signal.throwIfAborted()
      this.installReaders()
      await this.withLayout(signal, async (_lifetime, assertCurrent) => {
        focus?.begin()
        let retainedFocus = focus?.retainCurrentFocus?.()
        const assertColdCurrent = (): void => {
          assertCurrent()
          retainedFocus?.assertRetained()
        }
        const grid = await this.readMainEditorGrid(
          signal,
          assertColdCurrent,
          focus?.acquireSourceFocus,
          (acquire) => {
            // Scope may deliberately borrow primary focus; only its existing verified handoff can replace this receipt.
            assertColdCurrent()
            retainedFocus?.dispose()
            retainedFocus = acquire
              ? focus?.retainCurrentFocus?.(acquire)
              : undefined
          },
        )
        grid.assertUnchanged()
        retainedFocus ??= focus?.retainCurrentFocus?.()
        assertColdCurrent()
        if (grid.groups.length >= REPOSITORY_MIN_EDITOR_GROUP_COUNT) return
        const layout = {
          orientation: HORIZONTAL_EDITOR_ORIENTATION,
          groups: Array.from(
            { length: REPOSITORY_MIN_EDITOR_GROUP_COUNT },
            () => ({ size: 1 }),
          ),
        }
        grid.assertUnchanged()
        await vscode.commands.executeCommand('vscode.setEditorLayout', layout)
        assertColdCurrent()
        grid.assertFocused()
        const actual = await vscode.commands.executeCommand<unknown>(
          'vscode.getEditorLayout',
        )
        assertColdCurrent()
        grid.assertFocused()
        if (
          !isProportionalEditorLayout(layout, actual) ||
          !grid.preservesOtherParts(REPOSITORY_MIN_EDITOR_GROUP_COUNT)
        )
          throw new Error(
            'The editor could not reserve separate Wiki/source panes; existing tabs were preserved.',
          )
      })
      return
    }
    await this.arrange(signal, 'repository', true, focus)
  }

  /** Opens exact validated book evidence and its recorded time without dispatching input or borrowing a live pause. @example await workspace.openRepositoryEvidence(binding, true) */
  async openRepositoryEvidence(
    binding: BookObservationBinding,
    recording: boolean,
    signal?: AbortSignal,
    origin?: RepositorySelection,
  ): Promise<void> {
    this.assertPresentationIdle()
    const lifetime = this.lifetime,
      request = ++this.historyRequest
    const assertCurrent = (): void => {
      signal?.throwIfAborted()
      this.assertLifetime(lifetime)
      if (request !== this.historyRequest)
        throw new Error('Evidence navigation was superseded.')
    }
    assertCurrent()
    await this.initialize()
    assertCurrent()
    const checkpoint = await this.library!.readCheckpoint(binding.studyId)
    assertCurrent()
    const observation = checkpoint.study.observations.find(
      (value) => value.id === binding.observationId,
    )
    if (
      request !== this.historyRequest ||
      checkpoint.status !== 'saved' ||
      !observation ||
      observation.itemId !== binding.itemId ||
      observation.source.hash !== binding.sourceHash ||
      bookObservationHash(observation) !== binding.observationHash
    )
      throw new Error(
        'The linked observation no longer matches its exact saved checkpoint.',
      )
    this.progress = await this.library!.readProgress()
    assertCurrent()
    if (request !== this.historyRequest)
      throw new Error('Evidence navigation was superseded.')
    const previousSelection = this.selection,
      previousArchive = this.selectedArchive,
      previousSelectionKey = this.lastSelectionKey,
      previousSourceUri = this.sourceUri,
      previousSourceReady = this.sourceReady()
    const previousOrigin = this.repositoryOrigin,
      previousReturn = this.progress.repositoryReturn,
      previousLayoutOrigin = this.repositoryLayoutOrigin,
      previousLayoutRestored = this.repositoryLayoutRestored
    // Shared refresh may finish checkpoint I/O, but only this signal-bound navigation may render its new selection.
    this.repositoryNavigation = request
    this.revision++
    this.lastSelectionKey = undefined
    const returnSelection = origin ?? this.progress?.repositorySelection
    const proposedOrigin = returnSelection
      ? {
          studyId: binding.studyId,
          selection: repositorySelectionSchema.parse(returnSelection),
        }
      : undefined
    this.repositoryOrigin = proposedOrigin
    try {
      if (this.repositoryOrigin) {
        await this.library!.rememberRepositoryReturn(this.repositoryOrigin)
        assertCurrent()
      }
      this.leavePlayback()
      this.pendingHistory = undefined
      this.selectedArchive = checkpoint.study
      this.selection = { ...selectStudy(checkpoint.study), tab: 'live' }
      if (recording) {
        const saved = await this.recordings!.readContext(binding.studyId)
        assertCurrent()
        const recorded = saved.context.study.observations.find(
          (value) => value.id === binding.observationId,
        )
        if (
          request !== this.historyRequest ||
          !recorded ||
          bookObservationHash(recorded) !== binding.observationHash
        )
          throw new Error(
            'The recording does not contain this exact observation.',
          )
        let ownedRevision: number | undefined
        const cancel = (): void => {
          if (
            ownedRevision !== undefined &&
            this.playback!.state().revision === ownedRevision
          )
            this.leavePlayback()
        }
        signal?.addEventListener('abort', cancel, { once: true })
        try {
          assertCurrent()
          await this.openRecording(binding.studyId, signal, 'repository')
          ownedRevision = this.playback!.state().revision
          if (signal?.aborted) cancel()
          assertCurrent()
          await this.settleOwnedPlayback(signal)
          assertCurrent()
          const state = this.playback!.state()
          if (
            !state.range ||
            binding.elapsedMs < state.range.startMs ||
            binding.elapsedMs > state.range.endMs
          )
            throw new Error(
              'The observation is outside the verified recording range.',
            )
          ownedRevision = this.playback!.command({
            studyId: binding.studyId,
            action: 'seek',
            expectedRevision: state.revision,
            positionMs: binding.elapsedMs,
          }).revision
          await this.settleOwnedPlayback(signal)
          assertCurrent()
          const bundle = this.playback!.bundle()
          if (
            bundle?.studyId !== binding.studyId ||
            bundle.projection.positionMs !== binding.elapsedMs ||
            bundle.projection.observation?.id !== binding.observationId
          )
            throw new Error(
              'Exact recorded observation could not be presented.',
            )
        } finally {
          signal?.removeEventListener('abort', cancel)
        }
        return
      }
      this.selectedArchive = checkpoint.study
      this.loadedHistory.set(binding.studyId, {
        signature: checkpoint.study.materialSignature,
        status: 'saved',
      })
      this.selection = retainedStudySelectionSchema.parse({
        studyId: binding.studyId,
        profile: checkpoint.study.profile,
        itemId: observation.itemId,
        follow: false,
        tab: 'live',
      })
      if (this.message().model.observation?.id !== binding.observationId)
        throw new Error(
          'Selected item does not identify the linked observation.',
        )
      await this.open(signal, 'repository')
      assertCurrent()
      if (
        request !== this.historyRequest ||
        this.message().model.observation?.id !== binding.observationId
      )
        throw new Error('Evidence navigation was superseded.')
      await this.saveSelection()
    } catch (error) {
      // Roll back only the cancelled intent; newer learner navigation owns its own selection and presentation.
      if (
        this.repositoryNavigation === request &&
        this.historyRequest === request
      ) {
        this.selection = previousSelection
        this.selectedArchive = previousArchive
        this.lastSelectionKey = previousSelectionKey
        this.repositoryOrigin = previousOrigin
        this.progress = { ...this.progress, repositoryReturn: previousReturn }
        // Only this failed visit may roll back its native origin; Close and newer visits retain their own lifetimes.
        if (
          lifetime === this.lifetime &&
          !this.closing &&
          this.repositoryLayoutOrigin?.navigation === request
        ) {
          this.repositoryLayoutOrigin = previousLayoutOrigin
          this.repositoryLayoutRestored = previousLayoutRestored
        }
        this.revision++
        this.loading = false
        this.lastRendered = undefined
        // Retain verified native readiness only when the cancelled navigation never replaced the prior source.
        this.sourceRevision =
          previousSourceReady && this.sourceUri === previousSourceUri
            ? this.revision
            : undefined
        if (this.sourceRevision === undefined) this.lastSelectionKey = undefined
        this.publish()
        // Rollback uses the shared lock and compare-and-set so later navigation cannot lose its durable origin.
        if (proposedOrigin)
          await this.library!.rememberRepositoryReturn(
            previousReturn,
            proposedOrigin,
          ).catch((storageError) => this.report('progress', storageError))
      }
      throw error
    } finally {
      if (this.repositoryNavigation === request)
        this.repositoryNavigation = undefined
    }
  }

  readonly presentation: StudyPresentation = {
    createViewport: (runId, record, fail, scenario) => {
      // A new run may replace a closed reader, but an open recording keeps its independently selected film.
      if (!this.opened) this.leavePlayback()
      const panel = this.ensureApp(),
        leaseId = randomUUID()
      this.leaseId = leaseId
      panel.title = `codebook · Application ${runId.slice(0, 8)}`
      const studyRecord = [...(this.service?.records.values() ?? [])].find(
        (candidate) => candidate.runtime?.id === runId,
      )
      const viewport = new BrowserViewport(
        runId,
        record,
        fail,
        scenario,
        {
          panel,
          // Before the pane covers the paused file, the chat that had the keyboard before the pause gets it back, and a file the learner's selected frame opened keeps the pane from the keyboard; a pane that had to take it tells the learner once where it is.
          comesWithoutKeyboard: () => this.keepsKeyboardFromPane(),
          tookKeyboardFromEditor: () => this.tellPaneTookKeyboard(),
          released: () => {
            // A retired runtime cannot close or replace the panel attached to a newer lease.
            if (this.leaseId !== leaseId) return
            this.viewport = undefined
            this.leaseId = undefined
            if (this.opened && this.baselines)
              void this.renderSelection().catch((error) =>
                this.report('reader', error),
              )
            else void this.closeApplicationPaneOfEndedRun()
          },
        },
        studyRecord && createRecordingObserver(studyRecord),
      )
      this.viewport = viewport
      if (this.opened && !this.selection.follow && this.baselines)
        viewport.showHistory(capturedAppHtml(this.message()))
      // A new live lease cannot replace the independently selected recording renderer.
      if (this.recordingActive) {
        this.dropReplayViewport()
        this.playback?.hide()
        this.playback?.reveal()
      }
      return viewport
    },
    revealSource: async (snapshot) => {
      if (
        snapshot.actionId === 'repository-click' &&
        (!this.opened || (!this.liveComposition && this.selection.follow))
      ) {
        this.selection = { ...this.selection, follow: true, tab: 'live' }
        await this.open()
      }
      if (!this.opened) return false
      const displaysObservation = (): boolean =>
        this.message().model.observation?.id === snapshot.id &&
        this.message().model.matching
      const joinedRefresh = this.refreshing
      await this.refresh()
      // A refresh that was already reading the run may have started before this observation was committed; read once more before calling the reader busy.
      if (joinedRefresh && !displaysObservation()) await this.refresh()
      if (!displaysObservation())
        throw new StudyError(
          'BUSY',
          'Learner is reading another observation. Read the captured source resource or return the reader to the current pause.',
        )
      await this.renderSelection(true, true)
      // A newer render of the same observation supersedes this one before it displays anything; wait, within the placement bound, for the render that replaced it.
      await awaitResponse(
        (async (): Promise<void> => {
          let settled: Promise<void> | undefined
          while (this.loading && settled !== this.rendering)
            await (settled = this.rendering)
        })(),
        'the captured source display',
        undefined,
        PRESENTATION_READY_TIMEOUT_MS,
      ).catch(() => undefined)
      if (!this.sourceReady() || !displaysObservation())
        throw new StudyError(
          'EVIDENCE_UNAVAILABLE',
          'Matching captured source is not displayed. Inspect the reader error and retry explicitly.',
        )
      return true
    },
  }

  /** Attaches the same service before it is advertised to MCP, without starting any runtime. @example await workspace.attach(service) */
  async attach(service: StudyService): Promise<void> {
    await this.initialize()
    this.service = service
    service.recordings = this.recordings
    service.nodeHistoryStore = this.nodeHistoryStore!
    service.playbackController = this.playback
    service.presentationController = this
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.refresh().catch((error) => this.report('archive', error))
      }, STUDY_REFRESH_INTERVAL_MS)
      this.timer.unref()
    }
  }

  /** Refreshes the matching open Node reader after MCP commits learning, preserving its history cursor and learner decision.
   * @param studyId - The exact saved journal whose learning material changed.
   * @param material - The newly committed, journal-validated agent explanation.
   * @returns No value; an unrelated or closed reader is left untouched.
   * @example workspace.nodeHistoryLearningMaterialSaved(studyId, material)
   */
  nodeHistoryLearningMaterialSaved(
    studyId: string,
    material: NodeTestLearningMaterial,
  ): void {
    if (this.selectedNodeHistory?.header.studyId !== studyId || this.closing)
      return
    this.selectedNodeHistoryLearningMaterial = material
    this.publish()
  }

  /** Opens the shared reader without runtime input while preserving the learner's navigation chrome. @example await workspace.open() */
  async open(
    signal?: AbortSignal,
    origin: 'study' | 'repository' | 'presentation' = 'study',
  ): Promise<void> {
    if (origin !== 'presentation') this.assertPresentationIdle()
    signal?.throwIfAborted()
    const lifetime = this.lifetime
    this.assertLifetime(lifetime)
    signal?.throwIfAborted()
    // Claim cold preparation before any await so a duplicate Open cannot bypass its unfinished native reservation.
    while (this.sourceEntryPending) {
      const pending = this.sourceEntry
      const busy = (): StudyError =>
        new StudyError(
          'BUSY',
          'Study workspace is opening. Wait for its panes before opening it again.',
        )
      // Only an entry its own request already abandoned is waited for: it is just finishing a native call that ignores cancellation.
      if (!pending?.signal?.aborted) throw busy()
      try {
        await awaitResponse(
          pending.released,
          'the abandoned Study workspace entry',
          signal,
          PRESENTATION_READY_TIMEOUT_MS,
        )
      } catch {
        signal?.throwIfAborted()
        throw busy()
      }
      this.assertLifetime(lifetime)
      signal?.throwIfAborted()
      // A presentation change may have started during the wait.
      if (origin !== 'presentation') this.assertPresentationIdle()
    }
    const request = ++this.readerOpenNumber,
      historyRequest = this.historyRequest
    const firstOpen = !this.opened
    let unarrangedApp: vscode.WebviewPanel | undefined
    // An entry takes the keyboard from no editor part that holds it (an agent chat): what a measurement borrows goes back at the end. A selection or restore returns it itself, after its own last layout read.
    const returnForeignFocus =
      origin === 'presentation'
        ? undefined
        : this.retainForeignTabFocus(undefined)
    // Polling and source watchers cannot reveal a reader until cold entry has reserved its native destinations.
    if (firstOpen) this.reserveSourceEntry(signal)
    const cancel = (): void => {
      // A cancelled first entry cannot let background refresh finish its UI, or retire a newer explicit Open.
      if (firstOpen && request === this.readerOpenNumber) this.opened = false
    }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      await this.initialize()
      this.assertLifetime(lifetime)
      signal?.throwIfAborted()
      // Panes an earlier extension host left behind would pass for this reader's own in the view-type checks below, so a cold entry closes them, with the captured-source tabs of that session, before it creates any. A tab the editor keeps does not stop the entry; the next selection names a kept pane.
      if (firstOpen) {
        await this.closeLeftoverTabs()
        this.assertLifetime(lifetime)
        signal?.throwIfAborted()
        const firstInput = vscode.window.tabGroups.all.find(
          (group) => group.viewColumn === vscode.ViewColumn.One,
        )?.activeTab?.input
        // While a tab of another editor part holds the keyboard (the Agent chat), the main editor is measured once before any pane exists, when its first group shows a text editor: Cursor reports the focus the measurement gives a text editor, and not the focus it gives the Application pane once that is in front of it while the editor names the chat's group. That holds for a selection, a restore, Open replay and Open Study Workspace alike.
        if (
          this.retainForeignTabFocus(undefined) &&
          firstInput instanceof vscode.TabInputText &&
          vscode.window.visibleTextEditors.some(
            (editor) =>
              editor.viewColumn === vscode.ViewColumn.One &&
              editor.document.uri.toString() === firstInput.uri.toString(),
          )
        ) {
          await this.withLayout(signal, async (_lifetime, assertCurrent) => {
            await this.readMainEditorGrid(signal, assertCurrent)
          })
          this.assertLifetime(lifetime)
          signal?.throwIfAborted()
        }
      }
      await this.refreshProgress()
      this.assertLifetime(lifetime)
      signal?.throwIfAborted()
      const currentRecord = this.currentRecord()
      const liveComposition =
        !this.recordingActive &&
        this.selection.follow &&
        this.selection.tab === 'live' &&
        Boolean(
          this.liveComposition || (currentRecord && !currentRecord.stopped),
        )
      const summaryComposition = this.recordingActive
      const compositionChanged =
        liveComposition !== this.liveComposition ||
        summaryComposition !== this.summaryComposition
      const retiredContextGroup =
        (liveComposition || summaryComposition) && this.contextPanel
          ? vscode.window.tabGroups.all.find(
              (group) =>
                group.viewColumn === this.contextPanel?.viewColumn &&
                this.isCreatedContextGroup(group) &&
                group.tabs.every(
                  (tab) =>
                    tab.input instanceof vscode.TabInputWebview &&
                    isCodebookPaneViewType(
                      tab.input.viewType,
                      'codebook.studyContext',
                    ),
                ),
            )
          : undefined
      if (compositionChanged) {
        this.layoutReceipt = undefined
        this.presentationConfirmed = false
        this.liveComposition = liveComposition
        this.summaryComposition = summaryComposition
      }
      if (this.liveComposition || this.summaryComposition) {
        // Live uses the host chat; disposing only our panel never closes another editor's tabs.
        this.contextPanel?.dispose()
        this.contextPanel = undefined
        this.presentationMode = 'study-workspace'
      }
      this.opened = true
      this.closing = false
      // Explicit Study after actual Return uses the same retained layout proof as a Wiki evidence link.
      const reentry =
        origin === 'repository' ||
        (origin === 'study' && this.repositoryLayoutRestored)
          ? await this.captureRepositoryLayout(signal)
          : undefined
      this.assertLifetime(lifetime)
      signal?.throwIfAborted()
      this.installReaders()
      // A first entry that is refused before anything was arranged closes the Application pane it created.
      const createsApp = firstOpen && !this.app
      this.ensureApp()
      if (createsApp) unarrangedApp = this.app
      await this.settleInitialApp(signal, lifetime)
      // A learner move after failed entry releases our unfinished placement, even when the same app panel survives.
      if (
        this.initialAppPlacement?.panel !== this.app ||
        this.initialAppPlacement?.column !== this.app?.viewColumn
      )
        this.initialAppPlacement = undefined
      let needsInitialReservation = false
      if (
        firstOpen ||
        (!this.liveComposition &&
          !this.summaryComposition &&
          !this.contextPanel)
      )
        await this.withLayout(signal, async (_lifetime, assertCurrent) => {
          const grid = await this.readMainEditorGrid(signal, assertCurrent)
          // A feature switch cannot treat a resize since the article measurement as permission to overwrite it.
          if (
            this.isFeatureSwitchInPlace(
              compositionChanged,
              firstOpen,
              Boolean(reentry),
            ) &&
            this.hasLayoutChangedSinceArticle(grid.layout)
          ) {
            throw new Error(
              'The learner layout changed during feature entry; its current arrangement was preserved. Retry explicitly.',
            )
          }
          // The learner's own layout, measured before this Open arranges anything, is what a Close gives back.
          if (firstOpen) this.noteLayoutBeforeOpen(grid.layout, grid.groups)
          needsInitialReservation = this.needsInitialPaneReservation(
            grid.groups.length,
            compositionChanged,
            firstOpen,
          )
        })
      unarrangedApp = undefined
      // Either requested destination may already name chat; reserve main panes before creating Context.
      if (needsInitialReservation) {
        await this.arrange(
          signal,
          'study',
          false,
          undefined,
          undefined,
          retiredContextGroup,
        )
        this.assertLifetime(lifetime)
        signal?.throwIfAborted()
        // A failed reservation leaves Context/source destinations ambiguous; keep accepted effects only for an explicit retry.
        if (
          !this.layoutReceipt &&
          (this.presentationMode !== 'study-workspace' ||
            !(await this.hasRetainedStudyTopology(signal)))
        )
          throw new Error(
            'The editor could not reserve separate Codebook panes. Existing editor parts were preserved; retry Open Study Workspace explicitly.',
          )
      }
      const compositionReservation =
        !this.liveComposition &&
        (compositionChanged || !firstOpen) &&
        needsInitialReservation &&
        this.repositoryLayoutOrigin
          ? this.layoutReceipt
          : undefined
      // A cancelled reservation can already have created every main pane; finish its retained app move on explicit retry too.
      if (
        this.initialAppPlacement &&
        this.app?.viewColumn !==
          STUDY_PRESENTATIONS[this.presentationMode].appColumn
      ) {
        this.app?.reveal(
          STUDY_PRESENTATIONS[this.presentationMode].appColumn,
          true,
        )
        await waitUntil(
          () =>
            this.app?.viewColumn ===
            STUDY_PRESENTATIONS[this.presentationMode].appColumn,
          'new application main pane',
          PRESENTATION_READY_TIMEOUT_MS,
          signal,
        )
        this.assertLifetime(lifetime)
        signal?.throwIfAborted()
      }
      if (!this.liveComposition && !this.summaryComposition)
        this.ensureContext()
      // Seal only our newly inserted reader before source I/O; cancellation can then restore the article without adopting learner moves.
      if (
        compositionReservation &&
        compositionReservation === this.layoutReceipt &&
        this.sameEditorGroups(
          compositionReservation.groups,
          vscode.window.tabGroups.all,
        ) &&
        this.sameStudyPanePositions({
          ...compositionReservation.panes,
          context: this.contextPanel,
          contextColumn: this.contextPanel?.viewColumn,
        })
      ) {
        this.layoutReceipt = {
          ...compositionReservation,
          mode: 'study-reentry',
          panes: this.studyPanePositions(),
        }
      }
      if (request === this.readerOpenNumber) this.releaseSourceEntry()
      if (firstOpen && this.currentRecord() && this.selection.follow)
        this.selection = { ...this.selection, follow: true, tab: 'live' }
      await this.refresh(signal)
      signal?.throwIfAborted()
      // Explicit entry fronts a covered source without queueing behind a still-loading Wiki selection.
      await this.renderSelection(
        true,
        (origin === 'study' && !this.loading && !this.sourceReady()) ||
          reentry?.sourceTargetColumn !== undefined,
        signal,
        reentry ? { kind: 'reentry', receipt: reentry } : undefined,
      )
      // Study embeds outline and moment controls; keep the learner's side and bottom panels as arranged.
      this.assertLifetime(lifetime)
      signal?.throwIfAborted()
      // Settled Study or observation entry fronts its app; a newer Open cannot front a still-loading old selection.
      if (
        ((origin === 'study' && !this.loading) ||
          (origin === 'repository' && !this.recordingActive)) &&
        request === this.readerOpenNumber &&
        historyRequest === this.historyRequest
      ) {
        const app = this.app
        app?.reveal(undefined, true)
        // The editor reports the reveal a moment later; the arrangement below would read that report as a change the learner made, so it waits, bounded, until the pane is the tab its group shows.
        if (app)
          await waitUntil(
            () =>
              this.app !== app ||
              vscode.window.tabGroups.all.some(
                (group) =>
                  group.viewColumn === app.viewColumn &&
                  this.isCodebookPaneInput(
                    group.activeTab?.input,
                    'codebook.scopedBrowser',
                  ),
              ),
            'the revealed Application pane',
            PRESENTATION_READY_TIMEOUT_MS,
            signal,
          ).catch(() => {
            // A pane the editor keeps behind another tab is no reason to end the entry; only the caller's own cancellation is.
            signal?.throwIfAborted()
          })
        this.assertLifetime(lifetime)
        signal?.throwIfAborted()
      }
      if (origin !== 'presentation' && this.contextPanel) {
        const panel = this.contextPanel
        // Reentry without a retained layout cannot arrange anything; already manual groups must remain usable.
        const assertPlacement =
          firstOpen || this.layoutReceipt
            ? this.retainPresentationPlacement(false)
            : (): void => {}
        panel.reveal(undefined, false)
        // Drain the requested native focus change before the final layout read starts a passive ownership guard.
        await waitUntil(
          async () => {
            this.assertLifetime(lifetime)
            assertPlacement()
            const group = vscode.window.tabGroups.all.find(
                (candidate) => candidate.viewColumn === panel.viewColumn,
              ),
              input = group?.activeTab?.input
            if (
              this.contextPanel !== panel ||
              !panel.visible ||
              !(input instanceof vscode.TabInputWebview) ||
              !isCodebookPaneViewType(input.viewType, 'codebook.studyContext')
            )
              return false
            if (
              panel.active &&
              vscode.window.tabGroups.activeTabGroup === group
            )
              return true
            // A side chat can retain focus while the Context tab is visibly placed in the only editor part.
            const layout = await vscode.commands.executeCommand<unknown>(
              'vscode.getEditorLayout',
            )
            this.assertLifetime(lifetime)
            assertPlacement()
            return (
              editorLayoutGroupCount(layout) ===
              vscode.window.tabGroups.all.length
            )
          },
          'Study explanation native focus',
          PRESENTATION_READY_TIMEOUT_MS,
          signal,
        )
      }
      if (this.recordingActive && (firstOpen || !this.replayViewport)) {
        const pendingBefore = this.playback?.state().presentationRevision
        this.playback?.reveal()
        const pending = this.playback?.state().presentationRevision
        // The reveal of a recording that was never read to its end reads it again; this entry arranges that recording's panes, so the read does not open the reader a second time.
        if (pending !== pendingBefore) this.recordingRevealedByEntry = pending
      }
      // Capture ownership after explicit view reveals finish resizing the native workbench.
      await this.arrange(
        signal,
        'study',
        Boolean(compositionReservation) || (!firstOpen && !compositionChanged),
        undefined,
        undefined,
        retiredContextGroup,
      )
      this.assertLifetime(lifetime)
      signal?.throwIfAborted()
      // A two-group entry can create Context directly without an earlier reservation; seal that separate creation receipt after placement.
      if (this.layoutReceipt) this.sealCreatedContextPanelGroup()
      // The arrangement above leaves a layout it owns as it is; "Open Study Workspace" on an open reader still gives an Application group that sits at the height of its tab row its height back.
      if (!firstOpen && origin === 'study' && this.layoutReceipt) {
        await this.reapplyConfirmedLayout(this.layoutReceipt, true)
        this.assertLifetime(lifetime)
        signal?.throwIfAborted()
      }
      // Replay visibility can invalidate source readiness until its next ACK; retain layout ownership and project current readiness separately.
      // An enlarged pane needs explicit Restore; a later Open must not certify its retained grid receipt.
      if (!this.presentationTransition && !this.enlargedLayoutReceipt)
        this.presentationConfirmed = Boolean(this.layoutReceipt)
      if (
        !this.liveComposition &&
        firstOpen &&
        this.presentationMode === 'study-workspace' &&
        !this.layoutReceipt &&
        this.hasStudyPaneColumns() &&
        (await this.hasRetainedStudyTopology(signal))
      ) {
        // A blocked auxiliary Read must leave the retained, unconfirmed Study available for an explicit retry.
        try {
          await this.readStudyPane('context', signal)
          this.errors.delete('layout')
        } catch (error) {
          signal?.throwIfAborted()
          this.assertLifetime(lifetime)
          this.report('reading', error)
        }
        this.publish()
      }
      if (this.summaryComposition) {
        // Open replay clicked while another window has the desktop focus opens the summary once this window gains focus.
        if (!vscode.window.state.focused)
          await waitUntil(
            () => {
              this.assertLifetime(lifetime)
              return vscode.window.state.focused
            },
            'Codebook work window focus',
            RECORDING_WINDOW_FOCUS_WAIT_MS,
            signal,
          ).catch(() => {
            signal?.throwIfAborted()
            this.assertLifetime(lifetime)
            throw new StudyError(
              'PRESENTATION_UNAVAILABLE',
              `Focus the Codebook work window before reading the learning summary: another window kept the desktop focus for ${RECORDING_WINDOW_FOCUS_WAIT_MS / MILLISECONDS_PER_SECOND} s. Click in this editor window, then choose Open replay again.`,
            )
          })
        this.assertLifetime(lifetime)
        signal?.throwIfAborted()
        await this.showLearningSummary(
          signal,
          origin !== 'repository' && (firstOpen || compositionChanged),
        )
      }
      if (request === this.readerOpenNumber)
        this.initialAppPlacement = undefined
      // Last, because the editor answers a layout read for the focused editor part.
      await returnForeignFocus?.().catch(() => undefined)
    } catch (error) {
      // A failed first entry remains retryable without retiring a newer Open or discarding accepted native effects.
      if (
        firstOpen &&
        request === this.readerOpenNumber &&
        lifetime === this.lifetime &&
        !this.closing
      )
        this.opened = false
      // The refusal leaves the window as the entry found it. The pane is released first: its close handler would read the disposal as the learner closing the pane and cancel the recording load whose refusal is being answered.
      if (unarrangedApp && unarrangedApp === this.app) {
        this.app = undefined
        unarrangedApp.dispose()
      }
      // A newer focus of the learner stays; the keyboard a measurement borrowed goes back to the editor part that held it.
      if (!this.closing && lifetime === this.lifetime)
        await returnForeignFocus?.().catch(() => undefined)
      throw error
    } finally {
      // A first entry that ended without an open reader leaves no live or recording arrangement behind.
      if (firstOpen && request === this.readerOpenNumber && !this.opened)
        this.forgetUnopenedComposition()
      if (request === this.readerOpenNumber) this.releaseSourceEntry()
      signal?.removeEventListener('abort', cancel)
    }
  }

  /**
   * Drops the live or recording arrangement a first entry chose when that entry ended without an open reader (refused, failed or cancelled); called by {@link open} as its last step.
   * {@link admitPresentation} arranges the two rows for a selection while one of the two flags is set, without asking whether the reader is open: kept by a failed entry, they would send the next selection to arrange panes that do not exist, and refuse it until Open Study Workspace, Open replay or Close. With them goes the layout receipt of that arrangement, as when the arrangement changes.
   * @returns Nothing; a reader in neither arrangement is left as it is.
   * @example
   * ```ts
   * if (firstOpen && request === this.readerOpenNumber && !this.opened) this.forgetUnopenedComposition()
   * ```
   */
  private forgetUnopenedComposition(): void {
    if (!this.hasComposition()) return
    this.liveComposition = false
    this.summaryComposition = false
    this.layoutReceipt = undefined
    this.presentationConfirmed = false
  }

  /**
   * Says whether an entry switches the feature of a reader that is open already, without a reentry from an article; asked by {@link open} once the main editor is measured.
   * @param compositionChanged - Whether the entry changes between the Study, the live and the summary composition.
   * @param firstOpen - Whether the reader was closed when the entry began.
   * @param isReentry - Whether the entry returned from an article with a retained layout.
   * @returns `true` only for a changed composition on an open reader that is no reentry.
   * @example this.isFeatureSwitchInPlace(true, false, false) // => true
   */
  private isFeatureSwitchInPlace(
    compositionChanged: boolean,
    firstOpen: boolean,
    isReentry: boolean,
  ): boolean {
    return compositionChanged && !firstOpen && !isReentry
  }

  /**
   * Says whether the main editor's layout differs from the one measured when the article was left; asked by {@link open} in the turn the grid was measured.
   * @param layout - The layout of the grid that was just measured.
   * @returns `true` when an article origin is saved and its layout is another one; `false` without an origin or for the same layout.
   * @example this.hasLayoutChangedSinceArticle(grid.layout)
   */
  private hasLayoutChangedSinceArticle(layout: unknown): boolean {
    const origin = this.repositoryLayoutOrigin
    return (
      origin !== undefined &&
      JSON.stringify(layout) !== JSON.stringify(origin.layout)
    )
  }

  /**
   * Says whether an entry that finds fewer main groups than its composition uses has a reason to reserve them; the second half of {@link needsInitialPaneReservation}.
   * @param count - The main editor's measured group count.
   * @param compositionChanged - Whether the entry changes the composition.
   * @param firstOpen - Whether the reader was closed when the entry began.
   * @returns `true` when the composition changed, the window holds groups outside the main editor, or an open reader has an article origin.
   * @example this.hasReasonToReserveGroups(2, false, true) // => false in a window whose two groups are the main editor's
   */
  private hasReasonToReserveGroups(
    count: number,
    compositionChanged: boolean,
    firstOpen: boolean,
  ): boolean {
    return (
      compositionChanged ||
      count < vscode.window.tabGroups.all.length ||
      (!firstOpen && Boolean(this.repositoryLayoutOrigin))
    )
  }

  /**
   * Decides whether {@link open} reserves the main panes before it creates the Study pane, in the turn the main editor was measured.
   * @param count - The main editor's measured group count.
   * @param compositionChanged - Whether the entry changes the composition.
   * @param firstOpen - Whether the reader was closed when the entry began.
   * @returns `true` when the main editor has fewer groups than an article needs, or fewer than the composition uses and {@link hasReasonToReserveGroups} holds.
   * @example needsInitialReservation = this.needsInitialPaneReservation(grid.groups.length, compositionChanged, firstOpen)
   */
  private needsInitialPaneReservation(
    count: number,
    compositionChanged: boolean,
    firstOpen: boolean,
  ): boolean {
    return (
      count < REPOSITORY_MIN_EDITOR_GROUP_COUNT ||
      (count < this.studyGroupCount() &&
        this.hasReasonToReserveGroups(count, compositionChanged, firstOpen))
    )
  }

  /**
   * Reserves the reader's native destinations for a cold {@link open} and remembers how to tell its successor when that ends.
   * @param signal - The entering request's cancellation; once it aborts, a later open waits for the release instead of reporting busy.
   * @example if (firstOpen) this.reserveSourceEntry(signal)
   */
  private reserveSourceEntry(signal?: AbortSignal): void {
    let release = (): void => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    this.sourceEntryPending = true
    this.sourceEntry = { signal, release, released }
  }

  /**
   * Ends the cold-entry reservation for {@link open}, both when its panes are reserved and when the entry fails or is abandoned.
   * @example if (request === this.readerOpenNumber) this.releaseSourceEntry()
   */
  private releaseSourceEntry(): void {
    this.sourceEntryPending = false
    this.sourceEntry?.release()
    this.sourceEntry = undefined
  }

  /** Explicitly checkpoints final service state after accepted runtime/explanation cleanup has completed. @example await workspace.retire(service) */
  async retire(service: StudyService): Promise<void> {
    if (this.service === service) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    await this.refreshing
    let failure: unknown
    for (const record of service.records.values()) {
      // A study this window saved with the material the run has now is left as it is: writing it again would change only its saved time.
      if (
        this.isSavedUnchanged(
          `${service.instanceId}_${record.id}`,
          service.state(record).materialSignature,
        )
      )
        continue
      try {
        await this.checkpoint(service, record, true)
      } catch (error) {
        failure = error
        this.report('archive', error)
      }
    }
    await this.library?.flush()
    await this.recordings?.flush()
    if (this.service === service) {
      this.service = undefined
      clearInterval(this.timer)
      this.timer = undefined
    }
    if (this.opened && !this.recordingActive) await this.renderSelection()
    this.publishLearningSave()
    if (failure)
      throw new Error(
        `Runtime released; final reader history was not saved: ${String(failure)}`,
      )
  }

  /** Handles one explicit learner command, preserving revision identity through awaits. @example await workspace.action('continue') */
  async action(action: z.infer<typeof actionSchema>): Promise<void> {
    if (action !== 'stop') this.assertPresentationIdle()
    const lifetime = this.lifetime
    this.assertLifetime(lifetime)
    await this.initialize()
    this.assertLifetime(lifetime)
    if (['run', 'click', 'continue', 'stop'].includes(action)) {
      if (this.busy)
        throw new Error('A study control request is already pending.')
      const displayed = this.message().model
      this.busy = true
      this.publish()
      try {
        if (action === 'run') {
          throw new Error(
            'Ask your editor agent to prepare a study in the open repository.',
          )
        } else {
          const service = this.service,
            record = this.currentRecord()
          if (!service || !record)
            throw new Error(
              'No current runtime. Reading saved history never starts one.',
            )
          const identity = { instanceId: service.instanceId, runId: record.id }
          if (action === 'click') {
            if (record.profile !== REPOSITORY_BROWSER_PROFILE)
              throw new Error(
                'Node tests advance through their current source pause; they do not accept browser click actions.',
              )
            const descriptor = describeStudy({
              ...record,
              descriptor: record.definition?.descriptor,
            })
            const nextAction = descriptor.actions.find((action) =>
              service.state(record).nextActions.includes(action.id),
            )
            if (!nextAction)
              throw new Error('No application action is currently available.')
            service.action({
              ...identity,
              key: randomUUID(),
              action: nextAction.id,
            })
          }
          if (action === 'continue') {
            if (
              !this.sourceReady() ||
              !displayed.continueArguments ||
              (!this.liveComposition &&
                (this.lastRendered?.revision !== this.revision ||
                  this.lastRendered.snapshotUri !==
                    displayed.observation?.snapshotUri))
            )
              throw new Error('Inspect the current pause before continuing.')
            await service.continue(displayed.continueArguments)
          }
          if (action === 'stop') {
            await service.stop(identity)
            await this.checkpointStoppedRun(service, record)
          }
        }
        this.errors.delete('control')
        // A live-run action that succeeded also answers an earlier refused replay control, as it did while both shared one key.
        this.errors.delete('replay-control')
      } catch (error) {
        this.report('control', error)
        throw error
      } finally {
        this.busy = false
        await this.refresh()
        this.publish()
      }
      return
    }
    if (action === 'connect') {
      await this.controls.connect()
      return
    }
    if (action === 'return-wiki') {
      if (
        !this.controls.returnToRepository ||
        !this.repositoryOrigin ||
        this.repositoryOrigin.studyId !== this.selection.studyId
      )
        throw new Error('No article return location exists for this study.')
      await this.controls.returnToRepository(this.repositoryOrigin.selection)
      return
    }
    if (action === 'open-article') {
      const study = this.selectedStudy()
      if (!this.controls.openArticle || !study)
        throw new Error('Configured article unavailable.')
      const { bookId, revision, nodeId } = study.configuration.book
      await this.controls.openArticle({
        bookId,
        revision,
        nodeId,
        anchorIndex: 0,
      })
      return
    }
    if (action === 'reload-recording') {
      const studyId = this.selection.studyId
      if (!this.recordingActive || !studyId)
        throw new Error('Select a recording first.')
      this.leavePlayback()
      await this.openRecording(studyId)
      return
    }
    if (action === 'return-current') await this.returnCurrentSelection()
    if (action === 'source') {
      await this.renderSelection(false)
      this.lastActiveRegion = 'source'
    }
    if (action === 'focus-app') {
      this.app?.reveal(undefined, false)
      this.lastActiveRegion = 'app'
    }
    if (action === 'focus-context') {
      if (this.summaryComposition) await this.showLearningSummary()
      else this.contextPanel?.reveal(undefined, false)
      this.lastActiveRegion = 'context'
    }
    if (action === 'read-app') await this.readStudyPane('app')
    if (action === 'read-source') await this.readStudyPane('source')
    if (action === 'read-context') await this.readStudyPane('context')
    if (action === 'enlarge-app') {
      if (!this.app)
        throw new Error('Open an application observation before enlarging it.')
      await this.enlargePresentationPanel(this.app, 'app')
    }
    if (action === 'enlarge-context') {
      if (!this.contextPanel)
        throw new Error('Open a study explanation before enlarging it.')
      await this.enlargePresentationPanel(this.contextPanel, 'context')
    }
    if (action === 'outline')
      await vscode.commands.executeCommand('codebook.learningOutline.focus')
    // One click replaces opening Run and Debug, expanding Variables and expanding its first scope by hand.
    if (action === 'show-variables') {
      this.isShowingNativeVariables = true
      try {
        await this.showNativeVariables()
      } finally {
        this.isShowingNativeVariables = false
      }
    }
    if (action === 'arrange') {
      try {
        // A Study click can precede Cursor's native focus notification after unmaximizing Application.
        if (this.contextPanel)
          await this.focusPaneForGridCommand(this.contextPanel)
        const state = this.presentationState()
        await this.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: state.mode,
          action: 'restore',
        })
      } catch (error) {
        if (this.closing || this.disposed) throw error
        // The line begins with one error name, which the report adds: the cause's own is taken off.
        this.report(
          'layout',
          new Error(
            withoutErrorName(
              error instanceof StudyError ? error.causeDetail : String(error),
            ),
          ),
        )
      }
    }
    if (action === 'current-file') {
      const study = this.selectedStudy()
      const path =
        study !== undefined
          ? join(
              this.repositorySources!.workspace,
              configuredObservationPosition(
                study,
                this.message().model.observation?.id,
              ).path,
            )
          : this.baselines![this.message().model.selectedItem.participant].path
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(path),
      )
      this.assertLifetime(lifetime)
      if (
        normalizeNativeSourceText(document.getText()) !==
        normalizeNativeSourceText(this.message().model.source.text)
      )
        this.report(
          'source',
          new Error(
            'Current file differs from the selected captured source. The captured document remains unchanged.',
          ),
        )
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: false,
      })
    }
    if (action === 'retry') {
      if (this.saving)
        throw new Error('Wait for the pending understanding write.')
      this.saving = true
      this.publish()
      try {
        // Source, personal progress and captured history recover independently; one unavailable input cannot block the others.
        await this.readBaselines().catch(() => undefined)
        await this.refreshCitations(true)
        // A study whose files the learner removed by hand is forgotten before the ledger is read and the selection written.
        const ledgerCleaned = await this.forgetStudiesRemovedByHandOrReport()
        // The archives are written before the selection: the library refuses a selection that names a study without its archive, and the study of a run whose archive could not be saved has none until this step writes it.
        try {
          for (const id of this.pendingArchives.keys())
            await this.persistArchive(id)
          // Historical interpretations remain writable after a later run becomes current.
          if (this.service)
            for (const record of this.service.records.values())
              await this.checkpoint(this.service, record, true)
          await this.library!.reconcile()
          this.catalog = await this.library!.list()
          // Room made without a removal of this reader (files removed by hand) answers a run the full library refused.
          this.answerRefusedRunIfRoom(await this.library!.usage())
          // The line of a ledger that could not be cleaned above stays, although these later steps succeeded.
          if (ledgerCleaned) this.errors.delete('archive')
          if (this.selection.studyId) {
            const studyId = this.selection.studyId,
              revision = this.revision
            const archive = await this.readSavedArchive(studyId)
            // Retry may finish after navigation; only the unchanged selection can accept its archive.
            if (
              this.selection.studyId === studyId &&
              this.revision === revision &&
              archive.id !== this.activeArchive?.id
            )
              this.selectedArchive = archive
          }
        } catch (error) {
          this.report('archive', error)
        }
        try {
          this.progress = await this.library!.readProgress()
          // Preserve the original item/version even when the learner has since selected another item.
          if (this.pendingDecision) {
            this.progress = await this.library!.decide(this.pendingDecision)
            this.pendingDecision = undefined
          }
          await this.library!.select(this.selection)
          this.errors.delete('progress')
        } catch (error) {
          this.report('progress', error)
        }
      } finally {
        this.saving = false
        this.publish()
      }
      this.lastApplicationKey = undefined
      this.lastOutlineSelection = undefined
      await this.refresh()
      await this.renderSelection(true, true)
    }
  }

  /** Releases only historical rendering and follows current execution when a learner or MCP control explicitly returns. @example await this.returnCurrentSelection() */
  private async returnCurrentSelection(): Promise<void> {
    this.assertPresentationIdle()
    this.returningCurrent = true
    try {
      this.historyRequest++
      this.leavePlayback()
      this.pendingHistory = undefined
      // A selected Node journal would otherwise keep masking the live application and debugger after the return.
      await this.retireNodeHistorySelection()
      this.readerSelectionRevision++
      this.selection = { ...this.selection, follow: true, tab: 'live' }
      await this.refresh()
      await this.renderSelection(true, true)
    } finally {
      this.returningCurrent = false
    }
  }

  /** Selects a learner-owned item while turning off automatic following of later pauses. @example await workspace.select('repository/interface/theme') */
  async select(itemId: RetainedStudySelection['itemId']): Promise<void> {
    this.assertPresentationIdle()
    const lifetime = this.lifetime
    this.assertLifetime(lifetime)
    await this.initialize()
    this.assertLifetime(lifetime)
    if (!this.opened) await this.open()
    this.assertLifetime(lifetime)
    this.pendingHistory = undefined
    if (this.selection.studyId === this.activeArchive?.id)
      this.selectedArchive = this.activeArchive
    const selected = learningItemSchema.parse(itemId)
    if (
      !this.message().model.progressByItem.some((item) => item.id === selected)
    )
      throw new Error('Select the matching study profile first.')
    this.readerSelectionRevision++
    this.historyRequest++
    if (this.recordingActive) {
      const observed = this.playback
        ?.bundle()
        ?.context?.study.observations.find((value) => value.itemId === selected)
      if (!observed)
        throw new Error('This item has no recorded observation to seek to.')
      this.playback!.command({
        studyId: this.selection.studyId!,
        action: 'seek',
        expectedRevision: this.playback!.state().revision,
        positionMs: observed.elapsedMs,
      })
      return
    }
    this.selection = retainedStudySelectionSchema.parse({
      ...this.selection,
      itemId: selected,
      follow: false,
    })
    if (this.liveComposition || this.summaryComposition) await this.open()
    await this.renderSelection()
    await this.saveSelection()
  }

  /** Restores a history profile without changing any live runtime or borrowing a same-participant item. @example this.selectArchive(archive) */
  private selectArchive(archive: RetainedStudy): void {
    this.readerSelectionRevision++
    this.selection = selectStudy(archive, this.selection)
  }

  /**
   * Saves an explicit understanding choice of the learner to its displayed source context; called for the Study pane's checkbox, the Learning outline's checkbox and the Mark Understanding command.
   * A choice the ledger refuses is kept as it was made and waits for Retry storage / refresh, which the progress line "Not saved: …" offers; the saved value stays as it is until then. While one waits, another choice is not taken and the progress line says so: taken, it would replace the one that waits.
   * @param understood - The learner's choice; omitted, the opposite of the saved value.
   * @param itemId - The learning item; omitted, the selected one.
   * @param sourceHash - The source the choice was made on; omitted, the displayed source.
   * @param scope - `current` for the outline, whose choices apply to the current citations only.
   * @returns Nothing, also when the ledger refused the write or an earlier choice still waits: both are told by the progress line and not by a rejection, which a pane would show as a control line that no Retry answers.
   * @throws When the choice cannot be made at all: a write or a load is in progress, the source or the storage is unreadable, or the choice does not belong to the displayed article.
   * @example await workspace.understand(true)
   */
  async understand(
    understood?: boolean,
    itemId?: RetainedStudySelection['itemId'],
    sourceHash?: string,
    scope: 'selected' | 'current' = 'selected',
  ): Promise<void> {
    this.assertPresentationIdle()
    const lifetime = this.lifetime
    this.assertLifetime(lifetime)
    await this.initialize()
    this.assertLifetime(lifetime)
    const selected = this.message().model
    const item = itemId ?? selected.selection.itemId
    if (this.saving || this.message().loading)
      throw new Error(
        'Wait for the current source or pending understanding write.',
      )
    if (!selected.selectedUnderstanding.known)
      throw new Error(
        'Understanding requires readable source and learning storage.',
      )
    // A choice that still waits is never replaced by a later one: the learner's earlier decision would be lost.
    if (this.pendingDecision) {
      this.report('progress', new Error(UNSAVED_UNDERSTANDING_WAITS_MESSAGE))
      return
    }
    const decision = {
      id: randomUUID(),
      sourceHash: sourceHash ?? selected.source.hash,
      understood: understood ?? !selected.selectedUnderstanding.understood,
      at: new Date().toISOString(),
    }
    if (selected.selection.profile === REPOSITORY_BROWSER_PROFILE) {
      if (
        item !== selected.selection.itemId ||
        !selected.selectedUnderstanding.context
      )
        throw new Error(
          'Select the configured article before changing its complete citation understanding.',
        )
      // The outline summarizes current citations; its stale events cannot edit the historical reader context.
      if (
        scope === 'current' &&
        (!selected.currentSourceAvailable || selected.sourceChanged)
      )
        throw new Error(
          'Current citations differ from the captured study. Read the article before changing current understanding.',
        )
      this.pendingDecision = {
        ...decision,
        item,
        context: selected.selectedUnderstanding.context,
      }
    } else this.pendingDecision = { ...decision, item: itemSchema.parse(item) }
    this.saving = true
    this.publish()
    try {
      this.progress = await this.library!.decide(this.pendingDecision)
      this.pendingDecision = undefined
      this.errors.delete('progress')
    } catch (error) {
      // The choice waits for Retry storage / refresh, which this line offers. Thrown on, the failure became a control line beside which no Retry is offered and which outlived the Retry that wrote the choice.
      this.report('progress', new Error(`Not saved: ${String(error)}`))
    } finally {
      this.saving = false
      this.publish()
    }
  }

  /**
   * Drains owned runtime and source acquisitions before closing only reader-owned tabs/panels; called by the command "Codebook: Close Study Workspace".
   * When it closed a pane or the captured source in a focused window while a pane, the captured source or the learner's own file was the active editor, the active editor group gets the keyboard ({@link giveActiveGroupKeyboardAfterClose}): the editor rebuilds its grid when the panes' groups close, and the keyboard would be left on the page body. The editor does not say whether the keyboard was in that editor or in the terminal, a view or a side-view chat before the Command Palette opened; for a learner who was typing there this Close moves the keyboard into the editor, which is the price for not leaving a learner in a file with a dead keyboard, and the learner is told once in an editor session with {@link STUDY_CLOSE_KEYBOARD_MESSAGE}. While no text editor and no pane is active, the same is done where the editor has one editor part ({@link namesOnlyMainEditorGroups}: the keyboard is then in a page that is no text editor, in the terminal or in a view); beside another editor part (Cursor's chat as a tab, which may have the keyboard) nothing is focused. A window without the focus is left alone. {@link dispose} closes the reader too, when the extension host ends or the workspace folders changed: beside a learner's own file that close moves no keyboard and tells nothing; when it takes away the active editor (one of the reader's panes or its captured source) the active editor group gets the keyboard and the learner is told, as at a Close ({@link settlesKeyboardAtThisClose}). One exception holds for every close, a disposal's and one in a window without the focus too: a close that ends a Read shows the side bars the Read hid again ({@link endEnlargementAtClose}), and the editor shows a bar only with a command that gives that bar the keyboard. The chat that had the keyboard as a tab of another editor part then gets it back and nothing is told; in every other case the active editor group takes the keyboard once the panes are closed and the learner is told ({@link movesKeyboardAfterClose}).
   * Native owned-tab closes use {@link closeOwnedEditorTabs} before final panel disposal: the host restores an actual editor input only when an owned close ends its group, while terminal/sidebar-chat input stays outside that native focus guard.
   * @returns Once the panes and the captured source's tabs are closed and the reader's state is cleared.
   * @throws When the editor refused an owned tab close or a rebuilt pane cannot be distinguished from another pane of the same kind.
   * @example await workspace.close()
   */
  async close(): Promise<void> {
    if (this.closingPromise) return this.closingPromise
    // A pane, the captured source or the learner's own file is the active editor: closing the panes below can leave the keyboard nowhere, and the editor group that remains then gets it.
    const hadKeyboardInEditors = this.hasKeyboardInEditors()
    // One of the reader's own panes or its captured source is the active editor: this close takes away the editor that has the keyboard, also when nobody asked for the close.
    const closesActiveEditor = this.hasOwnActiveEditor()
    // Read before anything is closed or shown: the tab outside the text editors and the Study panes that has the keyboard now (Cursor's chat), which gets it back when this close shows a side bar.
    const giveKeyboardBackToChat = this.retainForeignTabFocus(undefined)
    this.closing = true
    this.revision++
    this.lifetime++
    this.pendingHistory = undefined
    this.studyAwaitingEditorArea = undefined
    this.lastRendered = undefined
    this.presentationTransition?.cancellation.abort(
      new Error('Presentation reader closed.'),
    )
    this.presentationId = randomUUID()
    this.presentationControlRevision = 0
    this.presentationConfirmed = false
    this.requestedPresentation = undefined
    // A closed reader carries no reason of a reading or a refused change that ended with it.
    this.presentationReason = undefined
    this.repositoryRecordingOpen = undefined
    // Closing disposes the native session: a Node stop still loading its values is abandoned, and no Run and Debug hint may survive a reopen.
    this.selectedNodeHistoryRequest++
    this.nodeHistoryPlaybackController?.abandon()
    this.replayUninspectedSnapshot = undefined
    this.selectedNodeHistoryValuesUninspected = false
    this.selectedNodeHistoryDebugAvailable = false
    this.playback?.hide()
    this.clearLearningSummary()
    const pending = (this.closingPromise = (async () => {
      // Read before anything is closed: with one editor part, a tab that is neither a text editor nor a pane is settled like a learner's file.
      const settlesKeyboard =
        hadKeyboardInEditors || (await this.namesOnlyMainEditorGroups())
      // One bound for every storage wait of this close, counted from the first of them: a writer that never returns is waited for once, not once per wait.
      let storageDeadlineMs: number | undefined
      const storageTimeLeftMs = (): number =>
        Math.max(
          0,
          (storageDeadlineMs ??=
            performance.now() + READER_CLOSE_STORAGE_TIMEOUT_MS) -
            performance.now(),
        )
      await this.refreshing
      const record = this.currentRecord()
      if (record && this.service && !record.stopped) {
        await this.service.stop({
          instanceId: this.service.instanceId,
          runId: record.id,
        })
        // The run's final checkpoint is a storage write too: one that never returns must not leave the reader closing, and it keeps running.
        await settledWithin(
          this.checkpoint(this.service, record, true),
          storageTimeLeftMs(),
        )
      }
      await Promise.allSettled([
        this.arranging,
        this.presentationOperation,
        this.presentationWrite,
      ])
      // The pending frame was hidden above; one that never answers must not hold closing, but the learner's saved position still finishes.
      await this.playback
        ?.settle(undefined, PRESENTATION_READY_TIMEOUT_MS)
        .catch(() => {})
      // A storage write that never returns must not keep the reader closing: the waits below share the bound above, and the write itself keeps running.
      await settledWithin(this.playback?.saved(), storageTimeLeftMs())
      this.dropReplayViewport()
      this.nodeHistoryPlaybackController?.dispose()
      this.nodeHistoryPlaybackController = undefined
      // A replacement may still be stopping an earlier owner: the reader is closed only once no historical debugger is left.
      if (this.replayDebugger)
        void this.retireReplayDebugger(this.replayDebugger)
      await this.replayDebuggerRetirement
      await this.rendering
      await this.outlineRendering
      await settledWithin(
        Promise.allSettled(this.archiveWrites.values()),
        storageTimeLeftMs(),
      )
      await settledWithin(this.library?.flush(), storageTimeLeftMs())
      // A Read maximized an editor group for the pane it showed; a closed workspace does not leave that maximization behind.
      const movedKeyboardToSideBar = await this.endEnlargementAtClose(
        giveKeyboardBackToChat,
      )
      const tabs = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter((tab) => this.ownsCapturedSourceTab(tab))
      // Native tab closes dispose panels before their answer; retain cleanup references and keyboard-notice eligibility first.
      const contextPanel = this.contextPanel,
        applicationPanel = this.app
      const leavesKeyboardNowhere =
        settlesKeyboard &&
        this.closesPaneOrSource(tabs.length) &&
        this.settlesKeyboardAtThisClose(closesActiveEditor)
      await this.closeOwnedEditorTabs()
      this.opened = false
      // A closed reader has no live or replay arrangement: the next selection opens it instead of arranging panes that no longer exist.
      this.liveComposition = false
      this.summaryComposition = false
      contextPanel?.dispose()
      this.contextPanel = undefined
      applicationPanel?.dispose()
      this.app = undefined
      this.initialAppPlacement = undefined
      // The Study arrangement took the learner's own groups for its panes: with the panes gone, those groups get the layout they had before the Open.
      await this.giveLayoutOfBeforeOpenBack()
      // Explicit Close and owned-editor disposal retain their existing keyboard return and notice, also after native panel fields cleared.
      if (
        this.movesKeyboardAfterClose(
          leavesKeyboardNowhere,
          movedKeyboardToSideBar,
        )
      )
        await this.giveActiveGroupKeyboardAfterClose()
      clearTimeout(this.citationRefreshTimer)
      this.citationRevision++
      this.citationKey = undefined
      for (const watcher of this.citationWatchers.splice(0)) watcher.dispose()
      this.layoutReceipt = undefined
      this.enlargedLayoutReceipt = undefined
      this.repositoryLayoutOrigin = undefined
      this.repositoryLayoutRestored = undefined
      this.sourceUri = undefined
      this.sourceGroup = undefined
      this.sourceRevision = undefined
      this.readerCreatedContextGroup = undefined
      this.pendingCreatedContextColumn = undefined
      this.pendingCreatedContextGroup = undefined
      this.pendingCreatedContextPanel = undefined
      this.lastSelectionKey = undefined
      this.documents.clear()
      this.listedStudyFiles.clear()
      this.readPresentationPreference()
    })())
    try {
      await pending
    } finally {
      if (this.closingPromise === pending) {
        this.closingPromise = undefined
        this.closing = false
        // A surviving Saved studies view needs this close's authority, including after native cancellation.
        if (!this.disposed) this.publish()
      }
    }
  }

  /**
   * Closes current reader-owned tabs by native group before panel disposal; called by {@link close} to preserve actual learner input when the editor grid contracts.
   * A nonempty learner group preserves focus; an ending owned group in a focused window uses the host's actual editor-part DOM guard to restore editor keyboard without taking terminal/sidebar-chat input.
   * @returns Once no current owned tab remains, rereading groups and ownership after each native answer.
   * @throws When the editor refuses a captured source or pane close, or rebuilt same-kind panes are indistinguishable; remaining panels stay intact.
   * @example await this.closeOwnedEditorTabs()
   */
  private async closeOwnedEditorTabs(): Promise<void> {
    // A prior close can remove/reorder groups or rebuild every tab object; dispatch only from the current native model.
    while (true) {
      const group = vscode.window.tabGroups.all.find((candidate) =>
        candidate.tabs.some((tab) => this.ownsClosingTab(candidate, tab)),
      )
      if (!group) return
      const tabs = group.tabs.filter((tab) => this.ownsClosingTab(group, tab))
      this.assertUnambiguousClosingTabs(tabs)
      // Resample window focus beside every dispatch: a learner tab or an inactive window suppresses native group-restoration focus.
      const preserveFocus = this.preservesFocusAtGroupClose(group, tabs)
      if (!(await vscode.window.tabGroups.close(tabs, preserveFocus)))
        throw new Error('Some Study workspace readers could not close.')
    }
  }

  /**
   * Chooses the native focus flag synchronously beside {@link closeOwnedEditorTabs}'s dispatch, keeping its current group/window checks without an await boundary.
   * @param group - The freshly selected native group.
   * @param tabs - Its current owned set; any tab outside this set belongs to the learner.
   * @returns Whether remaining learner tabs or an unfocused window suppress native restoration.
   * @example this.preservesFocusAtGroupClose(group, tabs)
   */
  private preservesFocusAtGroupClose(
    group: vscode.TabGroup,
    tabs: readonly vscode.Tab[],
  ): boolean {
    return group.tabs.length !== tabs.length || !vscode.window.state.focused
  }

  /**
   * Limits {@link closeOwnedEditorTabs} to captured source and a current panel's native group, so rebuilt inherited tabs cannot become owned by their view type alone.
   * @param group - The current native group of the tab, reread after every awaited close.
   * @param tab - A current native tab, never a saved wrapper.
   * @returns Whether this reader owns the source or holds the pane in the tab's current column.
   * @example this.ownsClosingTab(group, tab) // => false for an inherited Study tab beside this reader's Study in another group
   */
  private ownsClosingTab(group: vscode.TabGroup, tab: vscode.Tab): boolean {
    return (
      this.isOwnPaneOrSourceTab(tab) &&
      (this.ownsCapturedSourceTab(tab) ||
        this.closingPanelOf(tab)?.viewColumn === group.viewColumn)
    )
  }

  /**
   * Finds the panel receipt for an already ownership-filtered pane tab; {@link ownsClosingTab} compares its column with the current native group.
   * @param tab - A pane input admitted by {@link isOwnPaneOrSourceTab}.
   * @returns The current Application or Study panel, or undefined after native disposal.
   * @example this.closingPanelOf(applicationTab) // => this.app
   */
  private closingPanelOf(tab: vscode.Tab): vscode.WebviewPanel | undefined {
    return this.isCodebookPaneInput(tab.input, 'codebook.scopedBrowser')
      ? this.app
      : this.contextPanel
  }

  /**
   * Refuses indistinguishable same-kind pane wrappers before {@link closeOwnedEditorTabs} can delete another host's pane.
   * @param tabs - Only the current candidate owned set for one group; captured source tabs can occur more than once.
   * @throws When multiple pane tabs fit the same live panel receipt; every candidate of that group stays open.
   * @example this.assertUnambiguousClosingTabs(tabs)
   */
  private assertUnambiguousClosingTabs(tabs: readonly vscode.Tab[]): void {
    // Native restored inputs can prefix the view type; compare the same normalized kinds ownership already accepts.
    const kinds = tabs.flatMap((tab) =>
      this.isCodebookPaneInput(tab.input, 'codebook.scopedBrowser')
        ? ['application']
        : this.isCodebookPaneInput(tab.input, 'codebook.studyContext')
          ? ['context']
          : [],
    )
    if (new Set(kinds).size !== kinds.length)
      throw new Error(
        'Codebook cannot distinguish its current pane tab from another pane of the same kind. The remaining panes were left open. Keep the pane you need, close the duplicate Codebook pane tab, then try Close Study Workspace again.',
      )
  }

  /**
   * Says whether every tab group the editor names is a group of the main editor, in a window that has the focus; asked by {@link close}, before it closes anything, when the editor names neither a text editor nor a Study pane as active.
   * With one editor part the keyboard is then in the tab in front of the active group (the editor's Settings, an image, another extension's page), in the terminal or in a view, as it is beside a learner's own file, and Close settles it the same way. With another editor part (Cursor's Agent chat as a tab) that state reads the same as the chat holding the keyboard while the editor goes on naming a main group, and Close leaves it alone.
   * @returns `true` when the window is focused and the editor's layout counts exactly the groups its tab model names; `false` when the tab model names more (a group of another editor part), when the layout cannot be read, in a window without the focus, where nothing is settled anyway, and for a reader that closes with its extension host ({@link dispose}), which asks the editor nothing more.
   * @example
   * ```ts
   * await this.namesOnlyMainEditorGroups() // => true in VS Code with a Settings page in front, false beside Cursor's chat tab
   * ```
   */
  private async namesOnlyMainEditorGroups(): Promise<boolean> {
    if (this.disposed || !vscode.window.state.focused) return false
    const layout = await vscode.commands
      .executeCommand<unknown>('vscode.getEditorLayout')
      .then(undefined, () => undefined)
    return editorLayoutGroupCount(layout) === vscode.window.tabGroups.all.length
  }

  /**
   * Says whether {@link close} closes anything of the reader's in the editor area; asked by {@link close} before it disposes the panes, to know whether the editor will rebuild its grid.
   * @param closedSourceTabs - How many captured source tabs this close is about to close; pane fields may clear during their native close.
   * @returns `true` when a captured source tab was closed or a pane is still open to be closed; `false` for a reader that had nothing open.
   * @example this.closesPaneOrSource(tabs.length) // => false for a Close made while the Study workspace is not open
   */
  private closesPaneOrSource(closedSourceTabs: number): boolean {
    return closedSourceTabs > 0 || Boolean(this.contextPanel ?? this.app)
  }

  /**
   * Says whether {@link close} gives the active editor group the keyboard at its end and tells the learner where it is; asked by {@link close} once the panes are disposed.
   * A close that showed a side bar a Read hid always does, also while the reader is being disposed and in a window without the focus: the editor's command that shows a bar gave that bar the keyboard, so the keyboard has moved already, and the panes that close afterwards would leave it on no element. Any other close does in a focused window when closing the panes can leave the keyboard nowhere and the close is one that settles it ({@link settlesKeyboardAtThisClose}). A window without the focus is otherwise left alone.
   * @param leavesKeyboardNowhere - Whether closing the panes can leave the keyboard on no element, at a close that settles it.
   * @param movedKeyboardToSideBar - Whether this close showed a side bar a Read hid and did not give the keyboard back to the chat ({@link endEnlargementAtClose}).
   * @returns `true` when a side bar took the keyboard, and in a focused window when the keyboard could be left nowhere; `false` otherwise.
   * @example this.movesKeyboardAfterClose(true, false) // => false in a window without the focus
   */
  private movesKeyboardAfterClose(
    leavesKeyboardNowhere: boolean,
    movedKeyboardToSideBar: boolean,
  ): boolean {
    if (movedKeyboardToSideBar) return true
    return vscode.window.state.focused && leavesKeyboardNowhere
  }

  /**
   * Says whether this close is one that gives the keyboard an element again after it closed the panes; asked by {@link close}.
   * A Close the learner asked for is. A reader that closes with its disposal (the extension host ends, or the workspace folders changed) moves no keyboard beside a learner's own file, because no learner asked for that close and the keyboard may be in the terminal or a chat; it does when one of its own panes or its captured source was the active editor, which the disposal takes away: the keyboard would be left on no element.
   * @param closesActiveEditor - Whether one of the reader's panes or its captured source was the active editor when the close began ({@link hasOwnActiveEditor}).
   * @returns `true` for a Close that is no disposal, and for a disposal that closes the active editor; `false` for a disposal beside a learner's own file or a page of the editor.
   * @example this.settlesKeyboardAtThisClose(false) // => false while the reader is being disposed beside the learner's file
   */
  private settlesKeyboardAtThisClose(closesActiveEditor: boolean): boolean {
    return !this.disposed || closesActiveEditor
  }

  /**
   * Says whether the editor's active editor is one of the reader's own: a Study pane, the Application pane, or the captured source; asked by {@link close} before it closes anything.
   * @returns `true` when one of the two panes is active or the active text editor shows the captured source; `false` for a learner's own file, another tab and none.
   * @example const closesActiveEditor = this.hasOwnActiveEditor()
   */
  private hasOwnActiveEditor(): boolean {
    return (
      this.hasActiveStudyPane() ||
      this.activeTextDocumentUri() === this.sourceUri?.toString()
    )
  }

  /**
   * Closes the Application pane a live run leaves behind when no Study workspace shows its history, and gives the keyboard an element again when that pane had it; called by the lease's `released` of {@link presentation} at the run's end, while the reader is closed or has no study to show.
   * A pane that is closed while it has the keyboard leaves the keyboard on the page body: a key the learner presses then goes nowhere until they click (Cursor 3.23.12 at the end of a run of five stops, measured natively on 2026-10-07: the extension host named a text editor as active, the workbench page had no focus). So when the pane was the editor's active editor in the focused window, the active editor group gets the keyboard once the pane's tab and the group it may have left empty are gone, by the rule of a Close ({@link giveActiveGroupKeyboardAfterClose}), and the learner is told once in an editor session with {@link RUN_CLOSED_PANE_KEYBOARD_MESSAGE}.
   * Native active-tab flags do not prove keyboard ownership beside a terminal, view or side-view chat. The current owned document is inspected without focus effects through {@link readWebviewFocus}: an explicit false leaves outside typing alone, while an unavailable receipt keeps the guarded native fallback. A newer lease, reader opening or document is never retired after the inspection wait. A window without the focus is left alone.
   * @returns Once the pane is disposed and, where it had the keyboard, the focus command was answered.
   * @example else void this.closeApplicationPaneOfEndedRun()
   */
  private async closeApplicationPaneOfEndedRun(): Promise<void> {
    const panel = this.app
    if (!panel) return
    // Read before the pane goes: afterwards the editor names whatever tab took its place.
    const wasOpened = this.opened,
      readerOpenNumber = this.readerOpenNumber,
      documentHtml = panel.webview.html,
      heldKeyboard = await this.keyboardAtEndedApplication(panel)
    // Inspection can outlive a new live lease, reader opening or renderer replacement.
    if (
      !this.mayCloseEndedApplication(
        panel,
        wasOpened,
        readerOpenNumber,
        documentHtml,
      )
    )
      return
    panel.dispose()
    if (heldKeyboard) await this.settleKeyboardAfterRunClosedPane()
  }

  /**
   * Resolves ambiguous native-active keyboard ownership without revealing a pane; {@link closeApplicationPaneOfEndedRun} asks before retirement.
   * @returns `false` for a noncandidate or an explicit unfocused document; native fallback when the observation is unavailable.
   * @example await this.keyboardAtEndedApplication(panel) // => false while its side-view chat has the keyboard
   */
  private async keyboardAtEndedApplication(
    panel: vscode.WebviewPanel,
  ): Promise<boolean> {
    if (!this.holdsKeyboardInFocusedWindow(panel)) return false
    const documentFocused = await readWebviewFocus(
      panel,
      KEYBOARD_OWNER_ANSWER_TIMEOUT_MS,
    )
    // A pane disposed during the observation has no keyboard left to settle here.
    return (
      this.app === panel &&
      this.holdsKeyboardInFocusedWindow(panel) &&
      documentFocused !== false
    )
  }

  /**
   * Keeps an old run's asynchronous keyboard inspection from retiring a newer Application owner; {@link closeApplicationPaneOfEndedRun} checks it before disposal.
   * @param panel - The original run's Application handle.
   * @param wasOpened - Whether the reader was open before this inspection began.
   * @param readerOpenNumber - The last Open request before inspection; cold entry claims it before awaiting progress.
   * @param documentHtml - The exact document being inspected, before another renderer could replace it.
   * @returns `true` while the same unleased pane and reader state still belong to this ending.
   * @example this.mayCloseEndedApplication(panel, false, request, html) // => false after a new run leases that pane
   */
  private mayCloseEndedApplication(
    panel: vscode.WebviewPanel,
    wasOpened: boolean,
    readerOpenNumber: number,
    documentHtml: string,
  ): boolean {
    return (
      this.isUnleasedReaderAtEnd(wasOpened) &&
      this.isCurrentReaderEntryAtEnd(readerOpenNumber) &&
      this.app === panel &&
      panel.webview.html === documentHtml
    )
  }

  /**
   * Protects a presentation or cold Open before its opened flag changes; {@link mayCloseEndedApplication} checks this immediately before retirement.
   * @param readerOpenNumber - The Open request counter captured before the old inspection yielded.
   * @returns `true` when no presentation or cold-entry reservation owns the pane and no newer Open was claimed.
   * @example this.isCurrentReaderEntryAtEnd(request) // => false while a newer select waits for initialization
   */
  private isCurrentReaderEntryAtEnd(readerOpenNumber: number): boolean {
    return (
      this.presentationTransition === undefined &&
      !this.sourceEntryPending &&
      this.readerOpenNumber === readerOpenNumber
    )
  }

  /**
   * Rejects a newer runtime or reader opening after an old ending yielded; {@link mayCloseEndedApplication} checks this ownership half.
   * @returns `true` while no newer lease or reader opening took ownership.
   * @example this.isUnleasedReaderAtEnd(false) // => false after a new live viewport is created
   */
  private isUnleasedReaderAtEnd(wasOpened: boolean): boolean {
    return (
      this.viewport === undefined &&
      this.leaseId === undefined &&
      this.opened === wasOpened
    )
  }

  /**
   * Says whether one of the reader's panes is the editor's active editor in a window that has the focus, which is all the reader can know of a pane that has the keyboard; asked by {@link closeApplicationPaneOfEndedRun} before it disposes the pane.
   * @param panel - The Application pane or the Study pane.
   * @returns `true` when the window is focused and {@link isEditorsActivePane} holds; `false` otherwise.
   * @example const heldKeyboard = this.holdsKeyboardInFocusedWindow(panel)
   */
  private holdsKeyboardInFocusedWindow(panel: vscode.WebviewPanel): boolean {
    return vscode.window.state.focused && this.isEditorsActivePane(panel)
  }

  /**
   * Gives the active editor group the keyboard once the Application pane a run's end closed is gone, and tells the learner; the second half of {@link closeApplicationPaneOfEndedRun}, for a pane that had the keyboard.
   * @returns Once the focus command was answered; with nothing run when the window lost focus during the close, a newer run made its pane (it has its own reveal), or the reader is closing (a close settles the keyboard by its own rule).
   * @example if (heldKeyboard) await this.settleKeyboardAfterRunClosedPane()
   */
  private async settleKeyboardAfterRunClosedPane(): Promise<void> {
    await this.closedPanesGone('codebook.scopedBrowser')
    // Native tab removal can outlast the learner leaving this window; the earlier focus sample no longer owns its keyboard.
    if (this.app || this.closing || !vscode.window.state.focused) return
    await vscode.commands
      .executeCommand('workbench.action.focusActiveEditorGroup')
      .then(undefined, () => undefined)
    this.tellKeyboardAfterRunClosedPane()
  }

  /**
   * Tells the learner, once in an editor session, that the active editor group has the keyboard after a run's end closed the Application pane; called by {@link settleKeyboardAfterRunClosedPane}.
   * @example this.tellKeyboardAfterRunClosedPane()
   */
  private tellKeyboardAfterRunClosedPane(): void {
    if (keyboardNoticesTold.has('runEnd')) return
    keyboardNoticesTold.add('runEnd')
    void showPlainNotice(
      vscode.window,
      'information',
      RUN_CLOSED_PANE_KEYBOARD_MESSAGE,
    )
  }

  /**
   * Ends the Read or the Enlarge {@link close} finds on, so that a closed workspace leaves no maximized group, no resized group and no hidden side bar behind; called by {@link close} once its writes are drained, before it closes the captured source and the panes.
   * The maximization is left to the editor where it ends it by itself as the panes' groups go, because that keeps every group at the size it had before the Read ({@link editorEndsReadMaximizationAtClose}); elsewhere the editor's Expand ends it, and the layout the reading began with is applied again ({@link expandToEndMaximization}). A Read that itself began with Expand (an arrangement whose top level is rows) and an Enlarge, which always does, resized the groups: there the Expand ends the maximization and the groups get the sizes of before back ({@link giveGroupSizesBackAfterExpand}). An Enlarge is ended that way also when no reading is on, and so are sizes a refused Restore left kept.
   * The bars the Read hid are shown again while the panes still give the editor area its columns. The editor shows a bar only with a command that gives that bar the keyboard ({@link showSideBarsHiddenByRead}), in a window without the focus too, so this step moves the keyboard: the chat that had it gets it back ({@link returnsKeyboardToChatAfterSideBars}), and otherwise {@link movesKeyboardAfterClose} lets the active editor group take it at the end of the close, and the learner is told.
   * @param giveKeyboardBackToChat - What {@link retainForeignTabFocus} answered when the close began: the return to the tab outside the text editors and the Study panes that the editor named as active then, `undefined` when a text editor or a Study pane was active.
   * @returns `true` when a side bar was shown again and the keyboard was not given back to the chat; `false` when neither a Read nor an Enlarge is to be ended, when no bar is to be shown (an Enlarge hides none), and when the chat has the keyboard again.
   * @example const movedKeyboardToSideBar = await this.endEnlargementAtClose(giveKeyboardBackToChat)
   */
  private async endEnlargementAtClose(
    giveKeyboardBackToChat: ReturnType<StudyWorkspace['retainForeignTabFocus']>,
  ): Promise<boolean> {
    if (!this.hasEnlargementToEndAtClose()) return false
    // The editor's Expand ends a maximization whatever its state, and leaves every other group at its minimum size: it is run only where the editor will not end the maximization by itself.
    if (!this.editorEndsReadMaximizationAtClose())
      await this.expandToEndMaximization().catch(() => undefined)
    this.maximizedByRead = false
    // Where an Expand of the reader's resized the groups, at the Read, at the Enlarge or just now, they get their sizes back before the panes are closed.
    await this.giveGroupSizesBackAfterExpand()
    // The Read also hid the side bars; the bars it hid are shown again while the panes still give the editor area its columns.
    if (!(await this.showSideBarsHiddenByRead())) return false
    // A bar that was shown took the keyboard: the chat that had it gets it back, and then nothing more is moved or told.
    return !(await this.returnsKeyboardToChatAfterSideBars(
      giveKeyboardBackToChat,
    ))
  }

  /**
   * Says whether {@link close} finds something of a Read or an Enlarge to end; asked by {@link endEnlargementAtClose} before it runs anything.
   * @returns `true` while a reading is on ({@link maximizedByRead}) and while sizes an Expand of the reader's took are still kept ({@link groupSizesBeforeExpand}): an Enlarge whose maximization is on, or a Read or an Enlarge that a refused Restore left expanded. `false` otherwise.
   * @example if (!this.hasEnlargementToEndAtClose()) return false
   */
  private hasEnlargementToEndAtClose(): boolean {
    return this.maximizedByRead || this.groupSizesBeforeExpand !== undefined
  }

  /**
   * Says whether the editor ends a Read's maximization by itself while {@link close} closes the panes, so that no command has to end it; asked by {@link endEnlargementAtClose}.
   * Both editors leave a maximization when a group is removed from their grid and show the hidden groups again at the sizes they had before it (VS Code 1.140 and Cursor 3.23, the grid's `removeView`: `this.hasMaximizedView()&&this.exitMaximizedView()`), without moving the keyboard. The one command that ends a maximization whatever its state is the editor's Expand, which then gives the active group all the room and leaves every other group at its minimum size: after it the learner's own groups stay that way when the panes are gone (344 and 343 px before the Study workspace, 617 and 70 px after a Read and Close; measured natively on 2026-10-07 in VS Code 1.140.0 for Linux). A Restore runs Expand too, and gets its sizes from the arrangement it applies afterwards, which a Close has not. The editor's toggle would leave the sizes alone, but it maximizes a group when the learner or the editor has ended the Read's maximization already, which the editor does not report.
   * @returns `true` when this close empties an editor group that the editor then removes ({@link emptiesEditorGroupAtClose}) and the side bars are not measured at the end of the Read; `false` when no group will go, so that the maximization would stay, when {@link sideBarShowCommands} has to read the editor area, which it reads from a grid that is not maximized, and while sizes are kept for a Read or an Enlarge that began with Expand ({@link giveGroupSizesBackAfterExpand}): what the editor would bring back there are the sizes the Expand left.
   * @example if (!this.editorEndsReadMaximizationAtClose()) await this.expandToEndMaximization()
   */
  private editorEndsReadMaximizationAtClose(): boolean {
    // A Read or an Enlarge that began with Expand has sizes to give back, which are applied to a grid that is not maximized.
    if (this.groupSizesBeforeExpand !== undefined) return false
    return (
      !this.measuresSideBarsAtEndOfRead() && this.emptiesEditorGroupAtClose()
    )
  }

  /**
   * Says whether the end of the reading has to measure the secondary side bar; asked by {@link editorEndsReadMaximizationAtClose}.
   * @returns `true` for a reading whose maximization hid both bars and whose secondary bar could not be measured at the Read: {@link sideBarShowCommands} then reads the editor area, from the columns of a grid that is not maximized; `false` otherwise.
   * @example this.measuresSideBarsAtEndOfRead() // => false after a Read that measured both bars
   */
  private measuresSideBarsAtEndOfRead(): boolean {
    const before = this.sideBarsBeforeRead
    return (
      before?.widthWithoutPrimaryPx !== undefined &&
      before.auxiliaryVisible === undefined
    )
  }

  /**
   * Says whether {@link close} leaves an editor group empty that the editor then removes; asked by {@link editorEndsReadMaximizationAtClose} before anything is closed.
   * @returns `true` when the learner has not turned `workbench.editor.closeEmptyGroups` off and a group holds nothing but this reader's panes and captured sources; `false` when every such tab shares its group with a tab that stays, when the setting is off (an emptied group then stays), and for a group whose only tabs are panes of an earlier extension host, which this close does not close.
   * @example this.emptiesEditorGroupAtClose() // => true for the three-pane Study workspace, whose Study pane has a group of its own
   */
  private emptiesEditorGroupAtClose(): boolean {
    return (
      this.closesEmptyEditorGroups() &&
      vscode.window.tabGroups.all.some(
        (group) =>
          group.tabs.length > 0 &&
          group.tabs.every((tab) => this.isOwnPaneOrSourceTab(tab)),
      )
    )
  }

  /**
   * Reads whether the editor removes a group its last tab left; asked by {@link emptiesEditorGroupAtClose} and {@link emptiedGroupsClosed}.
   * @returns `true` unless the learner turned `workbench.editor.closeEmptyGroups` off.
   * @example if (!this.closesEmptyEditorGroups()) return
   */
  private closesEmptyEditorGroups(): boolean {
    return (
      vscode.workspace
        .getConfiguration('workbench.editor')
        .get<boolean>('closeEmptyGroups') !== false
    )
  }

  /**
   * Gives the keyboard back to the chat that had it when {@link close} began, after that close showed a side bar a Read hid; the last step of {@link endEnlargementAtClose}.
   * The return is made as at a pause ({@link retainForeignTabFocus}, called with `true`): the reader knows that the bar's command took the keyboard and does not ask the editor where it is, and only a tab that is known to lie outside the main editor gets it, through {@link CURSOR_FOCUS_AGENT_COMMAND}. A tab of the main editor that is no text editor (the editor's Settings) gets nothing back: the editor reads the same for it whether the keyboard was in that page or in a chat beside it.
   * @param giveKeyboardBackToChat - What {@link retainForeignTabFocus} answered when the close began.
   * @returns `true` when the chat's focus command ran; `false` without a remembered tab, for a tab that is not known to be the chat's, in a window without the focus, in a host without a command for its chat, and when the editor refused the layout read or the command.
   * @example return !(await this.returnsKeyboardToChatAfterSideBars(giveKeyboardBackToChat))
   */
  private async returnsKeyboardToChatAfterSideBars(
    giveKeyboardBackToChat: ReturnType<StudyWorkspace['retainForeignTabFocus']>,
  ): Promise<boolean> {
    if (!giveKeyboardBackToChat) return false
    // A return the editor refuses leaves the keyboard to the active editor group, and the learner is told.
    return giveKeyboardBackToChat(true).catch(() => false)
  }

  /**
   * Gives the active editor group the keyboard once {@link close} has closed the panes and the captured source, and tells the learner where it is; called by {@link close} when {@link movesKeyboardAfterClose} says so.
   * The focus command waits until the editor has closed the disposed panes' tabs and removed the groups they left empty: a group focused before that is the one that still shows a closing pane, and the keyboard goes with that tab a moment later; and the removal of a group rebuilds the editor grid, which takes the keyboard from the editor that had it.
   * The learner is told every time ({@link tellKeyboardAfterClose}): a pane, the captured source or the learner's own file was the active editor, so that the keyboard may have come from the terminal, a view or a chat, or a side bar took it when the close showed the bars a Read hid. A notification shown in a window without the focus is kept by both editors until that window has the focus again, where its time to stay begins, so a learner who was in another application reads it on returning.
   * @returns Once the focus command was answered.
   * @example await this.giveActiveGroupKeyboardAfterClose()
   */
  private async giveActiveGroupKeyboardAfterClose(): Promise<void> {
    await this.closedPanesGone()
    await vscode.commands
      .executeCommand('workbench.action.focusActiveEditorGroup')
      .then(undefined, () => undefined)
    this.tellKeyboardAfterClose()
  }

  /**
   * Waits until the editor has closed the tabs of the panes the reader disposed and removed the groups they left empty; called by {@link giveLayoutOfBeforeOpenBack} before it reads the groups that remain, by {@link giveActiveGroupKeyboardAfterClose} before its focus command, and by {@link closeApplicationPaneOfEndedRun} for the Application pane alone.
   * @param kinds - The view types of the panes that were disposed; left out, both of the reader's panes. A kind the reader still holds a pane of must not be named: its live tab would be waited for.
   * @returns Once no tab of a disposed pane is left, or after {@link PRESENTATION_READY_TIMEOUT_MS}, and once {@link emptiedGroupsClosed} returned.
   * @example await this.closedPanesGone()
   */
  private async closedPanesGone(
    ...kinds: ('codebook.scopedBrowser' | 'codebook.studyContext')[]
  ): Promise<void> {
    const closedKinds = kinds.length
      ? kinds
      : (['codebook.scopedBrowser', 'codebook.studyContext'] as const)
    await waitUntil(
      () => !this.hasUnownedPaneTab(...closedKinds),
      "the closed panes' tabs to leave their groups",
      PRESENTATION_READY_TIMEOUT_MS,
    ).catch(() => undefined)
    await this.emptiedGroupsClosed()
  }

  /**
   * Notes the main editor's layout and the learner's tabs of each group before an Open arranges anything; called by {@link open} with its first measurement of the main editor, for a reader that was closed.
   * The Study arrangement applies its layout to the learner's own groups when there are no more than it needs, so two groups side by side become the two rows of the left column, and unequal groups become equal; after a Close they stayed so (two groups of 659 and 440 px side by side were two rows of 70 and 617 px after Open and Close; measured natively on 2026-10-07 in VS Code 1.140.0 for Linux). The first note of an open reader is kept: an Open that failed half way and is repeated measures groups that hold the reader's panes already. A main editor with one group is not noted: it has no split and no size that could differ afterwards.
   * @param layout - The main editor's layout as {@link readMainEditorGrid} measured it.
   * @param groups - The main editor's groups in the order of that layout.
   * @example if (firstOpen) this.noteLayoutBeforeOpen(grid.layout, grid.groups)
   */
  private noteLayoutBeforeOpen(
    layout: unknown,
    groups: readonly vscode.TabGroup[],
  ): void {
    // A single group has neither a split nor a size to give back.
    if (groups.length < 2) return
    this.layoutBeforeOpen ??= {
      layout,
      groups: groups.map((group) => this.learnersTabKeysOf(group)),
    }
  }

  /**
   * Records the Context group a native reservation or panel creation created; {@link sealCreatedContextPanelGroup} calls this only after its native placement receipt.
   * @param column - A Context destination beyond that reservation's actual measured main groups, never a count retained from an earlier failed Open.
   * @example this.rememberCreatedContextGroup(3)
   */
  private rememberCreatedContextGroup(column: vscode.ViewColumn): void {
    const group = vscode.window.tabGroups.all.find(
      (candidate) => candidate.viewColumn === column,
    )
    if (group)
      this.readerCreatedContextGroup = this.editorGroupIdentities.get(group)
  }

  /**
   * Seals direct Context-panel group creation after native placement; {@link open} calls this when no initial reservation was needed.
   * A destination already in the current tab model before creation is borrowed and never enters this receipt.
   * @example this.sealCreatedContextPanelGroup()
   */
  private sealCreatedContextPanelGroup(): void {
    const column = this.pendingCreatedContextColumn
    const group = vscode.window.tabGroups.all.find(
      (candidate) => candidate.viewColumn === column,
    )
    if (group && this.hasCurrentContextCreation(group))
      this.rememberCreatedContextGroup(group.viewColumn)
    this.clearPendingContextCreation()
  }

  /**
   * Binds pending creation once the exact Context panel has a unique native tab; {@link bindContextPanel} and native group notifications call this.
   * The first pane insertion can rebuild the reserved empty group's wrapper; later wrappers must retain that bound identity.
   * @example this.bindPendingContextCreation()
   */
  private bindPendingContextCreation(): void {
    if (this.pendingCreatedContextPanel) return
    const group = vscode.window.tabGroups.all.find(
      (candidate) =>
        candidate.viewColumn === this.pendingCreatedContextColumn &&
        candidate.viewColumn === this.contextPanel?.viewColumn,
    )
    if (group && this.hasSingleContextPane(group)) {
      this.pendingCreatedContextGroup = this.editorGroupIdentities.get(group)
      this.pendingCreatedContextPanel = this.contextPanel
    }
  }

  /**
   * Requires one native Context input before binding a creation receipt; {@link bindPendingContextCreation} refuses ambiguous or learner-occupied destinations.
   * @param group - The pending destination's current native group.
   * @returns Whether its sole tab is Context.
   * @example this.hasSingleContextPane(group)
   */
  private hasSingleContextPane(group: vscode.TabGroup): boolean {
    return (
      group.tabs.length === 1 &&
      this.isCodebookPaneInput(group.tabs[0]?.input, 'codebook.studyContext')
    )
  }

  /**
   * Checks the pending group's identity and exact panel lifetime before {@link sealCreatedContextPanelGroup} grants retirement.
   * @param group - The native group at the pending column after placement.
   * @returns Whether the panel and group are still the ones bound to this creation.
   * @example this.hasCurrentContextCreation(group)
   */
  private hasCurrentContextCreation(group: vscode.TabGroup): boolean {
    if (!this.pendingCreatedContextPanel) return false
    if (this.pendingCreatedContextPanel !== this.contextPanel) return false
    if (this.pendingCreatedContextPanel.viewColumn !== group.viewColumn)
      return false
    return this.isPendingContextGroup(group)
  }

  /**
   * Compares a native group with pending creation identity; {@link ensureContext}, {@link hasCurrentContextCreation} and native close invalidation ask this.
   * @param group - A current or just-closed native group.
   * @returns Whether it carries the pending group's stable identity.
   * @example this.isPendingContextGroup(group)
   */
  private isPendingContextGroup(group: vscode.TabGroup): boolean {
    return (
      this.pendingCreatedContextGroup !== undefined &&
      this.editorGroupIdentities.get(group) === this.pendingCreatedContextGroup
    )
  }

  /**
   * Drops permission when native group closure/replacement ends the created group; the tab-group listener calls this before observing new wrappers.
   * @param event - The native change, whose closed groups still retain their old identities.
   * @example this.invalidateClosedContextCreation(event)
   */
  private invalidateClosedContextCreation(
    event: vscode.TabGroupChangeEvent,
  ): void {
    if (event.closed.some((group) => this.isPendingContextGroup(group)))
      this.clearPendingContextCreation()
  }

  /** Clears only pending creation permission, preserving accepted panels and the original layout; disposal and failed identity sealing call this. @example this.clearPendingContextCreation() */
  private clearPendingContextCreation(): void {
    this.pendingCreatedContextColumn = undefined
    this.pendingCreatedContextGroup = undefined
    this.pendingCreatedContextPanel = undefined
  }

  /**
   * Grants retirement to an unchanged actual-created group, including bound pending placement, never a borrowed learner group; {@link open} asks before disposing Context for recording/live composition.
   * @param group - The current Context-only native group.
   * @returns Whether the accepted reader-created group identity still holds after wrapper refresh.
   * @example this.isCreatedContextGroup(group) // => false for the learner's original empty third group
   */
  private isCreatedContextGroup(group: vscode.TabGroup): boolean {
    // Group/panel creation is already proved while layout placement waits; early live entry may retire it without claiming layout confirmation.
    if (this.hasCurrentContextCreation(group)) return true
    return (
      this.readerCreatedContextGroup !== undefined &&
      this.editorGroupIdentities.get(group) === this.readerCreatedContextGroup
    )
  }

  /**
   * Gives the main editor the layout it had before the Open, at the end of {@link close}, once the panes and the groups they left empty are gone; the note is forgotten either way.
   * The layout is applied only when the main editor answers ({@link isMainEditorLayout}) and the learner's groups are still the same ones ({@link hasLearnersGroupsOf}). A learner who opened, closed or moved a group during the session, or closed one of their tabs of before, keeps what they made, and so does a layout that is as before already. A reader that closes with its disposal applies nothing: no learner asked for that close.
   * Group identity and columns must also stay unchanged across the layout read ({@link sameEditorGroups}): an old reply's group count cannot hide a group the learner opened while it waited.
   * What cannot be given back: the width of a side bar the editor narrowed to make room for the panes' groups (no command reads or sets it), and a learner's group that stood empty in front of one with tabs and that the editor removed when the pane left it (an empty group can be made again only behind the groups that stay).
   * @returns Once the editor answered the layout command, or at once when nothing is noted or nothing may be applied.
   * @example await this.giveLayoutOfBeforeOpenBack()
   */
  private async giveLayoutOfBeforeOpenBack(): Promise<void> {
    const before = this.layoutBeforeOpen
    this.layoutBeforeOpen = undefined
    if (!before || this.disposed) return
    await this.closedPanesGone()
    const groups = vscode.window.tabGroups.all.map((group) => ({
      group,
      column: group.viewColumn,
    }))
    const now = await this.readEditorLayout()
    // Keep the final group/layout decision and its command in the same continuation.
    if (!this.mayRestoreLayoutOfBeforeOpen(before, now, groups)) return
    await vscode.commands
      .executeCommand('vscode.setEditorLayout', before.layout)
      .then(undefined, () => undefined)
  }

  /**
   * Validates original-layout restoration synchronously; called by {@link giveLayoutOfBeforeOpenBack} immediately before its native command.
   * Keeping the complete-group check beside the effect prevents another promise continuation from hiding a newer group behind an old layout count.
   * @param before - The original learner layout and tabs retained before Open.
   * @param layout - The completed native layout reply.
   * @param groups - Every group and column captured before that read.
   * @returns `true` only when the complete group model is unchanged and the existing original-layout guards allow restoration.
   * @example if (!this.mayRestoreLayoutOfBeforeOpen(before, layout, groups)) return
   */
  private mayRestoreLayoutOfBeforeOpen(
    before: NonNullable<StudyWorkspace['layoutBeforeOpen']>,
    layout: unknown,
    groups: Parameters<StudyWorkspace['sameEditorGroups']>[0],
  ): boolean {
    return (
      this.sameEditorGroups(groups, vscode.window.tabGroups.all) &&
      this.owesLayoutOfBeforeOpen(before, layout)
    )
  }

  /**
   * Says whether the layout of before the Open is to be applied now; asked by {@link giveLayoutOfBeforeOpenBack} with the layout the editor answers once the panes are gone.
   * @param before - What {@link noteLayoutBeforeOpen} noted.
   * @param now - The editor's layout now.
   * @returns `true` when the answer is the main editor's, differs from the layout of before in its splits or proportions, and the main editor's groups are the learner's groups of before; `false` otherwise.
   * @example if (!this.owesLayoutOfBeforeOpen(before, now)) return
   */
  private owesLayoutOfBeforeOpen(
    before: NonNullable<StudyWorkspace['layoutBeforeOpen']>,
    now: unknown,
  ): boolean {
    const count = editorLayoutGroupCount(now)
    return (
      count !== undefined &&
      this.isMainEditorLayout(now) &&
      !isProportionalEditorLayout(before.layout, now) &&
      this.hasLearnersGroupsOf(before.groups, count)
    )
  }

  /**
   * Says whether the main editor's groups are still the learner's groups a layout was noted for; asked by {@link owesLayoutOfBeforeOpen}.
   * "The same groups" is tested by number and by tabs, as the editor gives a group no name that lasts: there are no more groups than before, and, leaving empty groups at the end aside, the same number, each holding every tab it held before (a group may have gained tabs, as when the debugger opened a file in it) and each group that was empty before empty still. An empty group of before that the editor removed at the end is made again by the layout.
   * @param before - The learner's tabs of each group as noted, in the layout's order.
   * @param mainCount - How many groups the main editor has now.
   * @returns `true` when the groups match as described; `false` when a group was opened, closed or moved, or a tab of before is gone from its group.
   * @example this.hasLearnersGroupsOf([['file:///a.ts'], []], 1) // => true once the editor removed the empty second group with the pane that sat in it
   */
  private hasLearnersGroupsOf(before: string[][], mainCount: number): boolean {
    const now = vscode.window.tabGroups.all
      .toSorted((left, right) => left.viewColumn - right.viewColumn)
      .slice(0, mainCount)
      .map((group) => this.learnersTabKeysOf(group))
    const keptBefore = withoutTrailingEmpty(before),
      keptNow = withoutTrailingEmpty(now)
    return (
      now.length <= before.length &&
      keptBefore.length === keptNow.length &&
      keptBefore.every((keys, index) =>
        holdsTabsOfBefore(keys, keptNow[index]!),
      )
    )
  }

  /**
   * Lists the learner's tabs of an editor group by a key that outlives the editor's tab objects; asked by {@link noteLayoutBeforeOpen} and {@link hasLearnersGroupsOf}.
   * @param group - An editor group.
   * @returns One key for each tab that is not this reader's pane or captured source ({@link isOwnPaneOrSourceTab}): a text tab's document, any other tab's kind and label.
   * @example this.learnersTabKeysOf(group) // => ['file:///work/login-form.tsx']
   */
  private learnersTabKeysOf(group: vscode.TabGroup): string[] {
    return group.tabs
      .filter((tab) => !this.isOwnPaneOrSourceTab(tab))
      .map((tab) =>
        tab.input instanceof vscode.TabInputText
          ? tab.input.uri.toString()
          : `${tab.input instanceof vscode.TabInputWebview ? tab.input.viewType : 'tab'}:${String(tab.label)}`,
      )
  }

  /**
   * Says whether a tab is one {@link close} closes: a pane this reader owns or one of its captured sources; asked by {@link emptiesEditorGroupAtClose} and {@link learnersTabKeysOf}.
   * @param tab - A tab of an editor group.
   * @returns `true` for a captured source of this workspace's reader and for an Application or Study pane that is not left over from an earlier extension host; `false` for every other tab.
   * @example group.tabs.every((tab) => this.isOwnPaneOrSourceTab(tab))
   */
  private isOwnPaneOrSourceTab(tab: vscode.Tab): boolean {
    return (
      this.ownsCapturedSourceTab(tab) ||
      (this.isCodebookPaneInput(
        tab.input,
        'codebook.scopedBrowser',
        'codebook.studyContext',
      ) &&
        !this.inheritedPaneTabs.has(tab))
    )
  }

  /**
   * Waits, bounded by {@link CLOSE_GROUP_SETTLE_MS}, until the editor has removed the groups the closed tabs left empty; called by {@link closedPanesGone}.
   * @returns At once when the learner turned `workbench.editor.closeEmptyGroups` off (an emptied group then stays), when no group is empty or only one group is left; otherwise when the empty groups are gone or the bound passed.
   * @example await this.emptiedGroupsClosed()
   */
  private async emptiedGroupsClosed(): Promise<void> {
    if (!this.closesEmptyEditorGroups()) return
    await waitUntil(
      () =>
        vscode.window.tabGroups.all.length <= 1 ||
        vscode.window.tabGroups.all.every((group) => group.tabs.length > 0),
      'the emptied editor groups to close',
      CLOSE_GROUP_SETTLE_MS,
    ).catch(() => undefined)
  }

  /**
   * Tells the learner, once in an editor session, that {@link close} gave the active editor group the keyboard; called by {@link giveActiveGroupKeyboardAfterClose}.
   * The keyboard may have been in the terminal, a view or a side-view chat before the Command Palette, or a side bar took it when the close showed the bars a Read hid; the editor does not say, so the learner is told where it is now. The mark is the editor session's ({@link keyboardNoticesTold}), not this reader's.
   * @example this.tellKeyboardAfterClose()
   */
  private tellKeyboardAfterClose(): void {
    if (keyboardNoticesTold.has('close')) return
    keyboardNoticesTold.add('close')
    void showPlainNotice(
      vscode.window,
      'information',
      STUDY_CLOSE_KEYBOARD_MESSAGE,
    )
  }

  /**
   * Says whether the Application pane or the Study pane is the active editor; asked by {@link hasKeyboardInEditors}, and by {@link retainForeignTabFocus} before it looks for a foreign tab.
   * @returns `true` when one of the reader's two panes is active, `false` when neither is or neither exists.
   * @example this.hasActiveStudyPane()
   */
  private hasActiveStudyPane(): boolean {
    return Boolean(this.app?.active || this.contextPanel?.active)
  }

  /**
   * Takes out every study archive this reader could not save, for the reader that replaces it; called by the extension's handling of a changed workspace folder right before it disposes this reader, so that a dispose that fails loses none.
   * Without it the archive of a run whose service has ended is lost with the reader: no later reader can capture that run again.
   * @returns The archives that wait for Retry storage / refresh here and those handed over to this reader that are not of its library; this reader holds none afterwards.
   * @example
   * const unsaved = reader.releaseUnsavedStudies()
   * await reader.dispose()
   * const next = new StudyWorkspace(context, controls, unsaved) // shows "History not saved: …" and writes them at Retry
   */
  releaseUnsavedStudies(): UnsavedStudyArchive[] {
    const unsaved = [
      ...this.pendingArchives.values(),
      ...this.handedOverArchives,
    ]
    this.pendingArchives.clear()
    this.handedOverArchives = []
    return unsaved
  }

  /**
   * Queues the archives a disposed reader handed over that belong to this reader's library and says so in the archive line, which offers Retry storage / refresh; called by {@link initialize} once the library is known.
   * An archive of another workspace's library stays in {@link handedOverArchives}: written here it would be a study without its recording, which lies in that other library, and would take a place of this one. It is handed on with the next {@link releaseUnsavedStudies}.
   * @example this.queueHandedOverArchives() // => the line "History not saved: Error: disk is read-only" for a handed-over archive
   */
  private queueHandedOverArchives(): void {
    const workspaceKey = this.library!.workspaceKey
    const ofThisLibrary = this.handedOverArchives.filter(
      (unsaved) => unsaved.archive.workspaceKey === workspaceKey,
    )
    this.handedOverArchives = this.handedOverArchives.filter(
      (unsaved) => unsaved.archive.workspaceKey !== workspaceKey,
    )
    for (const unsaved of ofThisLibrary) {
      this.pendingArchives.set(unsaved.archive.id, unsaved)
      // The run's own receipt keeps why the save failed; an archive released while its write was still running has none.
      this.report(
        'archive',
        new Error(
          `History not saved: ${unsaved.record.historyReceipt?.reason ?? UNSAVED_STUDY_HANDED_OVER_REASON}`,
        ),
      )
    }
  }

  /**
   * Ends this reader after the extension has retired its service: closes its panes and its playback and releases what it registered with the editor; called when the window closes and when a change of the workspace's folders replaces the reader. Read-only harnesses inspect state via {@link inspect}.
   * The registrations are released whatever the closing did: a reader that kept its views, its source provider and its listeners after a close that threw would share them with the reader made in its place.
   * @throws What closing the panes or the playback threw, after the registrations were released.
   * @example await workspace.dispose()
   */
  async dispose(): Promise<void> {
    this.disposed = true
    clearInterval(this.timer)
    try {
      await this.close()
    } finally {
      try {
        await this.playback?.dispose()
      } finally {
        this.releaseRegistrations()
      }
    }
  }

  /** Releases what this reader registered with the editor (its citation watchers, its views, providers and listeners, its highlight and its outline's change event); called by {@link dispose} whatever closing the panes did. @example this.releaseRegistrations() */
  private releaseRegistrations(): void {
    this.citationRevision++
    for (const watcher of this.citationWatchers.splice(0)) watcher.dispose()
    for (const disposable of this.disposables) disposable.dispose()
    this.highlight?.dispose()
    this.treeChanges.dispose()
  }

  /** Cancels reader intents accepted before Close, while permitting a later explicit Open. @example this.assertLifetime(lifetime) */
  private assertLifetime(lifetime: number): void {
    if (this.disposed || this.closing || lifetime !== this.lifetime)
      throw new Error(
        'The study workspace was closed; repeat the action explicitly if needed.',
      )
  }

  /** Exposes credential-free presentation evidence to native tests without claiming visual acceptance. @example workspace.inspect().rendered */
  inspect() {
    return {
      view: this.baselines ? this.message() : undefined,
      presentation: this.presentationState(),
      sourceUri: this.sourceUri?.toString(),
      rendered: this.lastRendered,
      outlineSelection: this.outline?.selection,
      opened: this.opened,
      leaseId: this.leaseId,
      libraryDirectory: this.library?.directory,
    }
  }

  /** Loads workspace-isolated progress/baselines once; failed stores remain explicit and untouched. @example await this.initialize() */
  private async initialize(): Promise<void> {
    this.initializing ??= (async () => {
      const workspace = await realpath(requireWorkspace()),
        key = sha256(workspace)
      this.repositorySources = new RepositorySourceService(workspace)
      // Read capacity at admission so Settings changes recover full stores without restarting or hiding history.
      const capacity = () =>
        vscode.workspace
          .getConfiguration('codebook')
          .get<unknown>('savedStudyLimit')
      // A raised limit answers a run the full library refused, as a removal does.
      this.disposables.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration(SAVED_STUDY_LIMIT_SETTING))
            void this.answerRefusedRunAfterLimitChange()
        }),
      )
      // Read at each refusal: the library and the store are built before a service is attached, and a removal changes the answer.
      const removalAvailability = (): StudyRemovalAvailability =>
        this.studyRemovalAvailability()
      this.library = new LearningLibrary(
        join(this.context.globalStorageUri.fsPath, 'learning', key),
        key,
        capacity,
        removalAvailability,
      )
      this.recordings = new RecordingStore(
        this.library.directory,
        key,
        {},
        undefined,
        capacity,
        removalAvailability,
      )
      this.nodeHistoryStore = new NodeTestHistoryStore(
        this.library.directory,
        key,
        () => this.library!.storageLimit(),
        // The saved studies as the library's own admission counts them: what is left of a study without its archive is listed and takes no place.
        () => this.library!.savedStudyCount(),
      )
      // What the reader before this one could not save waits for Retry storage / refresh here.
      this.queueHandedOverArchives()
      // An unreadable Node history store stays visible without blocking browser studies, progress or playback.
      this.nodeHistoryCatalog = await this.nodeHistoryStore
        .list()
        .catch((error) => {
          this.report('archive', error)
          return []
        })
      this.playback = new PlaybackController({
        load: (studyId, signal) => this.loadPlayback(studyId, signal),
        frame: async (studyId, hash, signal) => {
          signal.throwIfAborted()
          const bytes = await this.recordings!.readFrame(studyId, hash)
          signal.throwIfAborted()
          return bytes
        },
        present: (bundle, signal) => this.presentPlayback(bundle, signal),
        readerOpen: () => this.replayReaderOpen,
        // A debugger that was never created is started by the next presentation; only one that ended needs the reload.
        presentable: () =>
          this.replayReaderOpen && this.replayDebugger?.available !== false,
        invalidate: (keepPixels) => {
          this.replayDebugger?.invalidate(
            this.replayApplicationCovered ? REPLAY_COVERED_LABEL : undefined,
          )
          if (this.highlight)
            for (const editor of vscode.window.visibleTextEditors) {
              if (
                editor.document.uri.scheme === STUDY_SOURCE_SCHEME &&
                editor.document.uri.authority === this.library?.workspaceKey
              )
                editor.setDecorations(this.highlight, [])
            }
          this.playbackPending = undefined
          this.playbackPresentingReady = false
          this.revision++
          this.lastRendered = undefined
          this.sourceRevision = undefined
          this.lastSelectionKey = undefined
          // A reload of the displayed recording, the end of a stop's pause, or a Pause with no frame in flight keeps the frame on screen until the next moment paints.
          if (!keepPixels) this.replayViewport?.clearRecorded()
        },
        changed: () => {
          const state = this.playback?.state()
          if (state?.readiness === 'ready' && !state.cleared) {
            this.playbackPending = undefined
            this.playbackPresentingReady = false
            this.clearReadyReplayWarning()
            // A recording that loaded and shows its position again answers an earlier refused replay control.
            if (this.replayLoadAwaitingReady) {
              this.replayLoadAwaitingReady = false
              this.errors.delete('replay-control')
              // The first shown position of an opened recording is the one moment its study is known to be on screen.
              this.saveShownRecordingSelection(state.studyId)
            }
          }
          // A failed load has no live renderer to finish its loading state; retire any pending image before showing the reason.
          if (
            state?.readiness === 'failed' &&
            this.recordingActive &&
            this.app
          ) {
            this.dropReplayViewport()
            this.app.webview.html = capturedAppHtml(this.message())
          }
          this.flushDeferredOpenReplies()
          this.publish()
        },
        save: async (bundle) => {
          // The first position save of a shown recording also carries the selection write that showing it started, so a settled playback has both on disk.
          await Promise.all([
            this.shownRecordingSelectionSaved,
            // A position save that was still queued must not write the playback file of a study that went to the Trash.
            this.isStudyLeavingLibrary(bundle.studyId)
              ? Promise.resolve()
              : this.recordings!.savePreference({
                  version: 1,
                  workspaceKey: key,
                  studyId: bundle.studyId,
                  contextHash: bundle.contextHash,
                  positionMs: bundle.projection.positionMs,
                }),
          ])
        },
      })
      // Current files may disappear while immutable saved observations remain independently readable.
      await this.readBaselines().catch(() => undefined)
      try {
        this.progress = await this.library.readProgress()
        this.adoptSavedReadingPlace(this.progress)
      } catch (error) {
        this.report('progress', error)
      }
      try {
        this.catalog = await this.library.list()
        this.giveUpSelectionOfRest()
        const id = this.firstShownStudyId()
        if (id) {
          this.selectedArchive = await this.firstShownArchive(id)
          this.selectArchive(this.selectedArchive)
        }
      } catch (error) {
        this.report('archive', error)
      }
    })()
    try {
      await this.initializing
    } catch (error) {
      this.initializing = undefined
      throw error
    }
  }

  /**
   * Takes over where the learner last read from the progress that was just loaded: the article a Return goes back to and the selection, which no longer follows a run; called by {@link initialize} in the turn the progress arrived.
   * @param progress - The learner progress the library returned.
   * @example this.adoptSavedReadingPlace(this.progress)
   */
  private adoptSavedReadingPlace(progress: LearnerProgress): void {
    this.repositoryOrigin = progress.repositoryReturn
    if (progress.selection)
      this.selection = { ...progress.selection, follow: false }
  }

  /**
   * Says whether the library lists only what is left of a study without its archive (a catalog file, a recording), as after its files were removed by hand in part; asked by {@link giveUpSelectionOfRest} and {@link forgetStudiesRemovedByHand}.
   * Such an entry is listed so that the rest can be removed. It cannot be read, so the reader neither selects it nor writes its study again.
   * @param studyId - The study an entry may list.
   * @example this.isRestWithoutArchive(study.id) // => true once the study's archive was removed by hand and the list was read again
   */
  private isRestWithoutArchive(studyId: string): boolean {
    return this.catalog.some(
      (entry) => entry.id === studyId && entry.format === 'archive-missing',
    )
  }

  /**
   * Gives up a saved selection that names what is left of a study without its archive, so a fresh reader does not try to read it and report "Study archive is unavailable."; called by {@link initialize} in the turn the catalog was listed, before {@link firstShownStudyId}.
   * The selection of a study whose archive waits in this reader ({@link awaitsArchiveOfThisWindow}) is kept: {@link firstShownArchive} shows that archive, and Retry storage / refresh writes it.
   * @example this.giveUpSelectionOfRest()
   */
  private giveUpSelectionOfRest(): void {
    const selected = this.selection.studyId
    // A handed-over archive keeps its learning selection while its disk save waits.
    if (
      selected &&
      this.isRestWithoutArchive(selected) &&
      !this.awaitsArchiveOfThisWindow(selected)
    )
      this.selectNoStudy()
  }

  /**
   * Gives the archive of the study a fresh reader shows first; called by {@link initialize} with what {@link firstShownStudyId} named.
   * @param studyId - The study to show.
   * @returns The archive that waits in this reader for Retry storage / refresh when one does (the library then holds an older one, or none), else the one the library holds.
   * @throws What {@link readSavedArchive} throws when the library's archive cannot be read.
   * @example this.selectedArchive = await this.firstShownArchive(id)
   */
  private async firstShownArchive(studyId: string): Promise<RetainedStudy> {
    return (
      this.pendingArchives.get(studyId)?.archive ??
      (await this.readSavedArchive(studyId))
    )
  }

  /**
   * Names the saved study a fresh reader shows first; read by {@link initialize} in the turn the catalog was listed.
   * @returns The study the saved selection names, otherwise the newest listed study this Codebook can read, or `undefined` for a library without one.
   * @example const id = this.firstShownStudyId()
   */
  private firstShownStudyId(): string | undefined {
    // A study a newer Codebook saved cannot be read here, and of a study without its archive nothing can be read; the newest entry that is neither is shown first.
    return (
      this.selection.studyId ??
      this.catalog.find(
        (entry) =>
          entry.format !== 'newer' && entry.format !== 'archive-missing',
      )?.id
    )
  }

  /** Reads current source independently of whichever older observation the learner selected. @example await this.readBaselines() */
  private async readBaselines(): Promise<void> {
    const text =
      '// Open a repository article or ask your editor agent to prepare a source-grounded study.\n'
    const unavailable = { text, hash: sha256(text), line: 1, path: '' }
    this.baselines = { server: unavailable, browser: unavailable }
    this.currentSourceAvailable = false
  }

  /** Coalesces observation updates while keeping control operations independent of disk/render work. @example await this.refresh() */
  private async refresh(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (this.refreshing) return this.refreshing
    const attempt = (async () => {
      const record = this.currentRecord()
      // A run that started after a removal ended retires that removal's outcome line.
      this.retireRemovalOutcomeOfEarlierRun(record?.id)
      if (this.nodeHistoryStore)
        this.nodeHistoryCatalog = await this.nodeHistoryStore
          .list()
          .catch((error) => {
            this.report('archive', error)
            return this.nodeHistoryCatalog
          })
      // Refresh every retained projection without letting an older run replace current runtime ownership.
      if (this.service)
        for (const retained of this.service.records.values()) {
          await this.checkpoint(this.service, retained)
          signal?.throwIfAborted()
        }
      if (this.selection.follow && this.activeArchive) {
        const state = record && this.service?.state(record)
        const current = Object.values(state?.participants ?? {}).find(
          (participant) => participant?.resumable,
        )?.itemId
        const selected = selectStudy(this.activeArchive, this.selection)
        this.selection = retainedStudySelectionSchema.parse({
          ...selected,
          follow: true,
          itemId:
            describeStudy(this.activeArchive).items.find(
              (item) => item.id === current,
            )?.id ?? selected.itemId,
        })
      }
      // Playback owns recorded source presentation; background checkpoints cannot reveal it over the returned Wiki.
      if (
        this.opened &&
        !this.closing &&
        !this.recordingActive &&
        this.repositoryNavigation === undefined &&
        !this.presentationTransition &&
        // A saved study chosen with the editor area hidden is shown by showStudyAwaitingEditorArea once the area is back.
        !this.studyAwaitsEditorArea()
      )
        await this.renderSelection(true, false, signal)
    })()
    this.refreshing = attempt
    try {
      await attempt
    } finally {
      if (this.refreshing === attempt) this.refreshing = undefined
    }
    await this.showStudyAwaitingEditorArea(signal)
    const current = this.currentRecord()
    // Ordinary chat may never request source reveal; enter live once per run after releasing the refresh lock.
    if (
      this.opened &&
      !this.closing &&
      !this.liveComposition &&
      !this.recordingActive &&
      !this.sourceEntryPending &&
      !this.presentationTransition &&
      this.repositoryNavigation === undefined &&
      this.selection.follow &&
      this.selection.tab === 'live' &&
      current &&
      !current.stopped &&
      this.liveEntryRunId !== current.id
    ) {
      // Failed placement needs explicit recovery, not a background loop that repeatedly changes the learner's layout.
      this.liveEntryRunId = current.id
      // Return-current already owns its navigation gate; finish that same intent without admitting another control.
      await this.open(signal, this.returningCurrent ? 'presentation' : 'study')
    }
  }

  /**
   * Makes the last checkpoint of a run that Stop has just ended and tells a failure of it once, as the archive line that Retry storage / refresh answers; called by {@link action} for Stop.
   * The run did stop, so the failure is no refused control. Thrown on, it became a control line beside the archive line, and only the learner's next choice retires a control line: it stayed after the Retry that saved the study, with no Retry beside it.
   * @param service - The service of the stopped run.
   * @param record - The stopped run.
   * @returns Nothing: a checkpoint that failed leaves the line "History not saved: …" and the run's failed history receipt, and does not reject.
   * @example
   * await service.stop(identity)
   * await this.checkpointStoppedRun(service, record) // => the line "History not saved: Error: disk is read-only" while the library cannot be written
   */
  private async checkpointStoppedRun(
    service: StudyService,
    record: StudyRecord,
  ): Promise<void> {
    try {
      await this.checkpoint(service, record, true)
    } catch (error) {
      // A write that failed has reported this very line ({@link persistArchive}); a capture that failed before any write has no line yet.
      this.report('archive', new Error(`History not saved: ${String(error)}`))
    }
  }

  /**
   * Saves material state only; forced retirement explicitly captures the state after the final observer tick.
   * @param isAwaitedByRemoval - Set by {@link saveLearningReplay}, the one caller a confirmed removal waits for ({@link settleStudyWrites}): its checkpoint never waits for that removal in turn.
   * @example await this.checkpoint(service, record, true)
   */
  private async checkpoint(
    service: StudyService,
    record: StudyRecord,
    force = false,
    isAwaitedByRemoval = false,
  ): Promise<void> {
    const id = `${service.instanceId}_${record.id}`
    // Retirement must not lose the final state of a study whose removal then moves nothing, so a forced checkpoint waits for the move.
    if (force && !isAwaitedByRemoval && this.movingStudyId() === id)
      await this.studyMove
    const signature = service.state(record).materialSignature
    // A study on its way to the Trash is not captured again; saved material is not captured twice.
    if (this.skipsCheckpoint(id, signature, force)) return
    const checkpointRevision = service.beginHistory(record, signature)
    if (checkpointRevision === undefined) return
    this.historyReceipts.set(id, {
      revision: checkpointRevision,
      signature,
      status: 'pending',
    })
    try {
      const archive = await captureStudy(
        service,
        record,
        this.library!.workspaceKey,
      )
      if (!archive) {
        if (force)
          throw new Error(
            'Final study changed during checkpoint; history was not certified.',
          )
        return
      }
      // A capture that was in flight when the removal was confirmed waits for the files to settle: it queues nothing for a study that left, and is written when nothing moved.
      if (await this.dropsCaptureAfterMove(id, record, isAwaitedByRemoval))
        return
      if (record === this.currentRecord()) this.activeArchive = archive
      if (this.selectedArchive?.id === id) this.selectedArchive = archive
      this.archiveSignatures.set(id, signature)
      this.pendingArchives.set(id, {
        archive,
        service,
        record,
        signature,
        checkpointRevision,
      })
      const write = this.persistArchive(id)
      // Current evidence is inspectable before disk completes; terminal retirement still waits for durability.
      if (force) await write
      else void write.catch(() => undefined)
    } catch (error) {
      // A capture that failed because its study's files were on their way to the Trash reports no failed receipt once the study left; the removal's own outcome says what happened.
      if (await this.dropsCaptureAfterMove(id, record, isAwaitedByRemoval))
        return
      if (service.state(record).materialSignature === signature)
        this.archiveSignatures.set(id, signature)
      this.reportCheckpoint(
        service,
        record,
        signature,
        checkpointRevision,
        'failed',
        String(error),
      )
      throw error
    }
  }

  /** Coalesces writes while only a matching latest receipt can change the combined study outcome. @example await this.persistArchive(study.id) */
  private persistArchive(id: string): Promise<void> {
    const existing = this.archiveWrites.get(id)
    if (existing)
      return existing.then(() => {
        if (this.pendingArchives.has(id)) return this.persistArchive(id)
      })
    const pending = Promise.resolve()
      .then(async () => {
        let checkpoint = this.pendingArchives.get(id)
        // Retry storage reaches this writer without a checkpoint; a study on its way to the Trash keeps its pending entry unwritten.
        while (checkpoint && this.movingStudyId() !== id) {
          const { archive, service, record, signature, checkpointRevision } =
            checkpoint
          this.reportCheckpoint(
            service,
            record,
            signature,
            checkpointRevision,
            'pending',
          )
          try {
            await this.library!.saveStudy(archive)
            this.historyReads.set(id, (this.historyReads.get(id) ?? 0) + 1)
            this.loadedHistory.set(id, { signature, status: 'saved' })
            this.catalog = await this.library!.list()
            const current = this.reportCheckpoint(
              service,
              record,
              signature,
              checkpointRevision,
              'saved',
            )
            if (current)
              await service.saveRecordingContext(
                record,
                archive,
                checkpointRevision,
              )
            // A history read may have selected older bytes after capture but before this durable write.
            if (
              current &&
              this.selection.studyId === id &&
              this.selectedArchive?.id === id
            )
              this.selectedArchive = archive
            if (this.pendingArchives.get(id) === checkpoint)
              this.pendingArchives.delete(id)
            // The line stays while another archive still waits: retired by this save, it would take Retry storage / refresh from the pane although a study is unsaved.
            if (current && this.pendingArchives.size === 0)
              this.errors.delete('archive')
            this.publish()
          } catch (error) {
            this.reportCheckpoint(
              service,
              record,
              signature,
              checkpointRevision,
              'failed',
              String(error),
            )
            // A coalesced newer checkpoint also failed to save when its predecessor aborts the writer.
            const latest = this.pendingArchives.get(id)
            if (latest && latest !== checkpoint)
              this.reportCheckpoint(
                latest.service,
                latest.record,
                latest.signature,
                latest.checkpointRevision,
                'failed',
                `Previous history write failed; latest checkpoint was not saved. ${String(error)}`,
              )
            this.report(
              'archive',
              new Error(`History not saved: ${String(error)}`),
            )
            throw error
          }
          checkpoint = this.pendingArchives.get(id)
        }
      })
      .finally(() => {
        if (this.archiveWrites.get(id) === pending)
          this.archiveWrites.delete(id)
      })
    this.archiveWrites.set(id, pending)
    return pending
  }

  /** Retains only accepted checkpoint receipts after {@link retire} detaches execution ownership. @example this.reportCheckpoint(service, record, signature, 2, 'failed') */
  private reportCheckpoint(
    service: StudyService,
    record: StudyRecord,
    signature: string,
    revision: number,
    status: NonNullable<StudyRecord['historyReceipt']>['status'],
    reason?: string,
  ): boolean {
    const accepted = service.reportHistory(
      record,
      signature,
      revision,
      status,
      reason,
    )
    if (accepted)
      this.historyReceipts.set(`${service.instanceId}_${record.id}`, {
        ...record.historyReceipt!,
      })
    return accepted
  }

  /** Certifies exact validated disk bytes for history selection; catalog presence alone cannot qualify a study. @example await this.readSavedArchive(id) */
  private async readSavedArchive(id: string): Promise<RetainedStudy> {
    this.assertStudyNotMoving(id)
    const generation = (this.historyReads.get(id) ?? 0) + 1
    this.historyReads.set(id, generation)
    const checkpoint = await this.library!.readCheckpoint(id)
    const catalog = await this.library!.list()
    // A newer read or durable save owns verification; an old failure must not downgrade its receipt.
    if (this.historyReads.get(id) !== generation)
      throw new Error('History changed while loading. Select the study again.')
    this.loadedHistory.set(id, {
      signature: checkpoint.study.materialSignature,
      status: checkpoint.status,
    })
    this.catalog = catalog
    if (checkpoint.reason) {
      const record =
        this.service?.instanceId === checkpoint.study.instanceId
          ? this.service.records.get(checkpoint.study.runId)
          : undefined
      if (record?.historyReceipt && this.service)
        this.reportCheckpoint(
          this.service,
          record,
          checkpoint.study.materialSignature,
          record.historyReceipt.revision,
          'failed',
          checkpoint.reason,
        )
      this.report('archive', new Error(checkpoint.reason))
    }
    return checkpoint.study
  }

  /** Resolves service ownership from explicit records, never the focused debug session. @example this.currentRecord()?.id */
  private currentRecord(): StudyRecord | undefined {
    return this.service && [...this.service.records.values()].at(-1)
  }

  /** Finishes the explicitly selected capture and verifies matching durable learning; called by the status-bar command. @example await workspace.saveLearningReplay(studyId) */
  async saveLearningReplay(expectedStudyId?: string): Promise<void> {
    const service = this.service,
      record = this.currentRecord()
    // A refused run recorded nothing, and the recording of a removed study went to the Trash with it.
    if (!service || !record || !record.recording || record.historyExcluded)
      throw new Error(
        'No recorded Codebook session is available. Explain a real code path first.',
      )
    const studyId = `${service.instanceId}_${record.id}`
    // The removal waits for a save in flight and a forced checkpoint waits for the removal, so no save starts during the move.
    this.assertStudyNotMoving(studyId)
    // A delayed click must never stop the newer run now owned by the workspace.
    if (expectedStudyId !== undefined && expectedStudyId !== studyId)
      throw new Error(
        'The recorded session changed. Use the current Save learning replay control.',
      )
    if (this.learningSaveOperation) {
      if (this.learningSave?.studyId !== studyId)
        throw new Error(
          'Another learning session is being saved. Wait for its result.',
        )
      return this.learningSaveOperation
    }
    this.learningSave = {
      studyId,
      status: 'saving',
      detail:
        'Finishing recording and saving matching source, debugger history and explanation…',
    }
    this.publish()
    const operation = (async () => {
      await service.stop({ instanceId: service.instanceId, runId: record.id })
      // A removal confirmed while the run was stopping waits for this save; the forced checkpoint would wait for that removal in turn, so the save ends here instead.
      this.assertStudyNotMoving(studyId)
      await this.checkpoint(service, record, true, true)
      // A removal confirmed during the checkpoint waits for this save too: the checkpoint did not wait for it and wrote nothing, so the save ends here and the removal settles what was captured.
      this.assertStudyNotMoving(studyId)
      const state = service.state(record)
      if (
        state.historyOutcome.status !== 'saved' ||
        state.recording.contextStatus !== 'saved'
      )
        throw new Error(
          state.recording.contextReason ??
            'Matching learning history and recording context were not saved.',
        )
      const archive = await this.readSavedArchive(studyId)
      await this.recordings!.readContext(studyId, state.recording.contextHash)
      const recording = await this.recordings!.read(studyId)
      const missing: string[] = []
      if (!projectLearningSummary(archive))
        missing.push('learning summary and sequence')
      if (
        !archive.observations.length ||
        archive.observations.some((observation) => !observation.debugger)
      )
        missing.push('recorded debugger history')
      if (
        state.recordedStudyOutcome !== 'demonstrated' ||
        recording.status !== 'finalized' ||
        !recording.entries.some((entry) => entry.type === 'frame')
      )
        missing.push('complete execution/capture evidence')
      this.learningSave = {
        studyId,
        signature: archive.materialSignature,
        status: missing.length ? 'partial' : 'saved',
        detail: missing.length
          ? `Saved available learning. Missing: ${missing.join(', ')}. Open replay to inspect retained evidence.`
          : 'Learning replay saved with its summary, source and debugger history. Open the saved replay.',
      }
    })()
    this.learningSaveOperation = operation
    try {
      await operation
    } catch (error) {
      this.learningSave = {
        studyId,
        status: 'failed',
        detail: `Learning save failed: ${String(error)}. Existing evidence is retained; click to retry.`,
      }
      throw error
    } finally {
      if (this.learningSaveOperation === operation)
        this.learningSaveOperation = undefined
      this.publish()
    }
  }

  /** Keeps capture/save reachable beside native chat: every {@link publish} calls it, and it updates the status bar item without changing editor focus and assigns the item's command only when the command or its study changed. @example this.publishLearningSave() */
  private publishLearningSave(): void {
    if (this.disposed) return
    const record = this.currentRecord(),
      studyId =
        record && this.service
          ? `${this.service.instanceId}_${record.id}`
          : undefined
    // Later agent annotations require another save; an old receipt cannot certify changed content.
    const saved =
      this.learningSave &&
      this.learningSave.studyId === studyId &&
      (!this.learningSave.signature ||
        (record &&
          this.service?.state(record).materialSignature ===
            this.learningSave.signature))
        ? this.learningSave
        : undefined
    if (!record?.recording || !studyId || record.historyExcluded) {
      this.learningSaveItem?.hide()
      return
    }
    if (!this.learningSaveItem) {
      this.learningSaveItem = vscode.window.createStatusBarItem(
        'codebook.learningSave',
        vscode.StatusBarAlignment.Right,
      )
      this.learningSaveItem.name = 'Codebook learning replay'
      this.disposables.push(this.learningSaveItem)
    }
    const item = this.learningSaveItem
    item.text =
      saved?.status === 'saving'
        ? '$(sync~spin) Saving learning…'
        : saved?.status === 'saved'
          ? '$(check) Learning saved · Open replay'
          : saved?.status === 'partial'
            ? '$(warning) Learning partially saved · Open replay'
            : saved?.status === 'failed'
              ? '$(error) Learning save failed · Retry'
              : `${record.stopped ? '$(save) Recording finished' : '$(record) Recording explanation'} · Save learning replay`
    item.tooltip =
      saved?.detail ??
      'Finish this Codebook recording and save learning replay. This stops only its owned runtime; missing history or summary is reported as partial.'
    const opensReplay = saved?.status === 'saved' || saved?.status === 'partial'
    const command =
      saved?.status === 'saving'
        ? undefined
        : {
            title: opensReplay
              ? 'Open learning replay'
              : 'Save learning replay',
            command: opensReplay
              ? 'codebook.openLearningReplay'
              : 'codebook.saveLearningReplay',
            arguments: [studyId],
          }
    const commandKey = JSON.stringify([command?.command, studyId])
    // The host makes a new internal command of every assigned object and disposes the one before, so an entry still drawn with the earlier one fails on a click ("Actual command not found"): assign only a changed command or study.
    if (commandKey !== this.learningSaveCommandKey) {
      this.learningSaveCommandKey = commandKey
      item.command = command
    }
    item.show()
  }

  /** Opens a validated local recording through the same revisioned controller used by MCP; no application operation is dispatched. @example await workspace.openRecording(studyId) */
  async openRecording(
    studyId: string,
    signal?: AbortSignal,
    origin: 'study' | 'repository' = 'study',
  ): Promise<void> {
    this.assertPresentationIdle()
    signal?.throwIfAborted()
    const lifetime = this.lifetime
    await this.initialize()
    this.assertLifetime(lifetime)
    signal?.throwIfAborted()
    const id = studyIdSchema.parse(studyId)
    // The recording of a study on its way to the Trash moves first; it cannot be opened any more.
    this.assertStudyNotMoving(id)
    // Once admitted, browser replay takes over the shared historical debugger; a Node stop still loading its values no longer owns it.
    this.selectedNodeHistoryRequest++
    this.nodeHistoryPlaybackController?.abandon()
    // The Node stop no longer owns Run and Debug: its hint goes, and Inspect restarts the debugger for it.
    this.selectedNodeHistoryValuesUninspected = false
    this.selectedNodeHistoryDebugAvailable = false
    // A closed reader has no native panes; reload its saved position instead of accepting a loaded-controller no-op.
    if (!this.opened) this.playback!.leave()
    const revision = this.playback!.state().revision
    // Bind chrome preservation to this exact open, including a load queued behind cancelled playback work.
    this.repositoryRecordingOpen =
      origin === 'repository'
        ? { studyId: id, revision: revision + 1 }
        : undefined
    this.playback!.command({
      studyId: id,
      action: 'open',
      expectedRevision: revision,
    })
    // The open was accepted, so an earlier refused replay control no longer describes the replay.
    if (this.errors.delete('replay-control')) this.publish()
  }

  /**
   * Opens a saved recording for the status bar's Open replay entry and tells the learner when its load failed; the command `codebook.openLearningReplay` calls it.
   *
   * {@link openRecording} returns once the load is admitted, and a load that fails later leaves its reason only in the playback state,
   * which no pane shows while the reader could not open (another window keeps the desktop focus). So this waits, bounded by
   * {@link OPEN_REPLAY_RESULT_WAIT_MS}, for the load to end and shows a failed load's reason as an editor notification, which the
   * editor keeps on screen until its window has the focus again.
   *
   * @param studyId - The saved study whose recording the entry names.
   * @returns Once the recording is presented and its study's selection written to the ledger, its load failed and the notification was shown, another recording took its place, or the bound passed (a ledger write still pending then goes on in the background).
   * @throws Whatever {@link openRecording} throws before the load is admitted.
   * @example await workspace.openLearningReplay(studyId)
   */
  async openLearningReplay(studyId: string): Promise<void> {
    await this.openRecording(studyId)
    const playback = this.playback!
    const resultWaitEndsAtMs = performance.now() + OPEN_REPLAY_RESULT_WAIT_MS
    // A load that outlasts the bound is still running and has nothing to report yet.
    await playback
      .settle(undefined, OPEN_REPLAY_RESULT_WAIT_MS)
      .catch(() => undefined)
    // A bounded settle leaves the saves out; the selection write that the shown recording started is awaited here, so the command ends with the ledger naming it. It can wait behind this window's queued library writes and another window's storage lock, so it gets only what is left of the same bound, and a failed load's notice never waits longer.
    await awaitResponse(
      this.shownRecordingSelectionSaved,
      'the ledger write of the shown recording',
      undefined,
      resultWaitEndsAtMs - performance.now(),
    ).catch(() => undefined)
    const state = playback.state()
    if (
      state.studyId !== studyId ||
      state.readiness !== 'failed' ||
      !state.reason
    )
      return
    // The controller keeps a failure as its string form, which starts with the error's name.
    void showPlainNotice(
      vscode.window,
      'error',
      `Codebook could not open the learning replay: ${withoutErrorName(state.reason)}`,
    )
  }

  /** Loads immutable film/context before arranging its reader, restoring only the separately saved paused position. @example await this.loadPlayback(id, signal) */
  private async loadPlayback(
    studyId: string,
    signal: AbortSignal,
  ): Promise<PlaybackData> {
    const intent = this.repositoryRecordingOpen
    const origin =
      intent?.studyId === studyId &&
      intent.revision === this.playback!.state().revision
        ? 'repository'
        : 'study'
    if (origin === 'repository') this.repositoryRecordingOpen = undefined
    // An agent's open reaches this loader without openRecording; the same study on its way to the Trash is refused here too.
    this.assertStudyNotMoving(studyId)
    this.replayLoadAwaitingReady = true
    await this.replaceUnavailableReplayDebugger(signal)
    signal.throwIfAborted()
    this.recordingActive = true
    this.pendingHistory = undefined
    // A study this window still holds (a run of this session) is selected with its own item: paired with the item shown before, every reader update until the recording is read failed with "Selected item belongs to another configured article.", and that line stayed.
    const heldStudy =
      studyId === this.activeArchive?.id
        ? this.activeArchive
        : this.selectedArchive?.id === studyId
          ? this.selectedArchive
          : undefined
    this.selection = heldStudy
      ? selectStudy(heldStudy, this.selection)
      : { ...this.selection, studyId, follow: false }
    this.showRecordingLoadingOnLiveViewport()
    const index = await this.recordings!.read(studyId)
    signal.throwIfAborted()
    let context: PlaybackData['context'],
      contextHash: string | undefined,
      contextReason: string | undefined,
      preferredPositionMs: number | undefined
    try {
      const saved = await this.recordings!.readContext(studyId)
      context = saved.context
      contextHash = saved.hash
    } catch (error) {
      contextReason = `Recorded source/value context unavailable: ${String(error)}`
    }
    signal.throwIfAborted()
    try {
      const saved = await this.readSavedArchive(studyId)
      signal.throwIfAborted()
      this.selectedArchive = saved
      if (context && sha256(JSON.stringify(saved)) !== context.studyHash)
        this.report(
          'playback-context',
          new Error(
            'Saved study changed after this recording context. Reload after its matching context is saved.',
          ),
        )
      else this.errors.delete('playback-context')
    } catch (error) {
      this.report('playback-context', error)
    }
    signal.throwIfAborted()
    const definition = context
      ? { ...context.study, captures: [] }
      : this.selectedArchive?.id === studyId
        ? this.selectedArchive
        : undefined
    if (definition) this.selection = selectStudy(definition, this.selection)
    else
      throw new Error(
        'Configured recording article context is unavailable. Reload its saved context.',
      )
    try {
      const saved = await this.recordings!.readPreference()
      if (saved?.studyId === studyId) preferredPositionMs = saved.positionMs
      this.errors.delete('playback-preference')
    } catch (error) {
      this.report('playback-preference', error)
    }
    signal.throwIfAborted()
    // A read that an entry's own reveal restarted (the reader was closed before the recording was read to its end) belongs to that entry, which arranges the recording's panes: opening the reader again from here would be refused by the presentation change that made the entry.
    if (
      this.recordingRevealedByEntry !==
      this.playback!.state().presentationRevision
    )
      await this.open(signal, origin)
    signal.throwIfAborted()
    await this.ensureReplayViewport(signal)
    signal.throwIfAborted()
    return { index, context, contextHash, contextReason, preferredPositionMs }
  }

  /**
   * Replaces a historical debugger the learner stopped or that gave up after a bound.
   *
   * Only explicit replay/history opens and explicit Node stop selections call this, so playback never relaunches it silently.
   * It also waits for a replacement that an earlier request started: {@link PlaybackController} lets an aborted load leave
   * while the editor is still stopping the old owner.
   *
   * @param signal - The waiting request's cancellation; it never cancels the shared disposal.
   * @throws The signal's reason once it aborts.
   * @example await this.replaceUnavailableReplayDebugger(signal)
   */
  private async replaceUnavailableReplayDebugger(
    signal?: AbortSignal,
  ): Promise<void> {
    const current = this.replayDebugger
    if (current && !current.available) void this.retireReplayDebugger(current)
    await this.replayDebuggerRetired(signal)
  }

  /**
   * Disposes one historical debugger as part of the shared retirement that {@link replayDebuggerRetired} waits for.
   *
   * {@link replaceUnavailableReplayDebugger} and {@link close} call it. The owner leaves its field at once, so no caller
   * presents through it again; its descriptor factory stays registered until the editor has stopped its session.
   *
   * @param owner - The historical debugger to stop; a disposal failure is reported to the reader, never thrown.
   * @returns The shared retirement, settled once this owner and every earlier one is disposed.
   * @example void this.retireReplayDebugger(current)
   */
  private retireReplayDebugger(owner: ReplayDebugger): Promise<void> {
    if (this.replayDebugger === owner) this.replayDebugger = undefined
    const earlier = this.replayDebuggerRetirement
    const retirement: Promise<void> = (async () => {
      await earlier
      try {
        await owner.dispose()
        // A later owner stopped cleanly, so an earlier failed disposal no longer describes the debugger.
        if (this.errors.delete('replay-debugger-disposal')) this.publish()
      } catch (error) {
        // Its own key: a later values-loaded or session-ended notification clears only notification failures.
        this.report('replay-debugger-disposal', error)
      }
    })().finally(() => {
      if (this.replayDebuggerRetirement === retirement)
        this.replayDebuggerRetirement = undefined
    })
    this.replayDebuggerRetirement = retirement
    return retirement
  }

  /**
   * Waits until no replaced historical debugger is still being disposed, before a caller creates the next one.
   *
   * The editor accepts one descriptor factory per debug type, so {@link presentPlayback} and {@link selectNodeHistoryEvent}
   * wait here, then check that they are still current, and only then create the owner synchronously.
   *
   * @param signal - The waiting request's cancellation; it never cancels the shared disposal.
   * @throws The signal's reason once it aborts.
   * @example
   * ```ts
   * await this.replayDebuggerRetired(signal)
   * signal.throwIfAborted()
   * this.replayDebugger ??= this.createReplayDebugger()
   * ```
   */
  private async replayDebuggerRetired(signal?: AbortSignal): Promise<void> {
    const retirement = this.replayDebuggerRetirement
    if (!retirement) return
    await (signal ? untilAborted(retirement, signal) : retirement)
  }

  /** Whether the replay reader's panes exist, for {@link PlaybackController}'s reload and control guards and for {@link showSavedStudy} before it asks whether the editor area is hidden: open and not closing. @example this.replayReaderOpen */
  private get replayReaderOpen(): boolean {
    return this.opened && !this.closing
  }

  /**
   * Shows the loading page on a live run's viewport while a recording loads, releasing the recording renderer that page replaces.
   *
   * {@link loadPlayback} calls it before it reads the recording. Without a live viewport nothing is written and the renderer stays;
   * a renderer that still holds the panel is kept, so a reload needs no new renderer handshake.
   *
   * @example this.showRecordingLoadingOnLiveViewport()
   */
  private showRecordingLoadingOnLiveViewport(): void {
    if (!this.viewport) return
    // A recording renderer still holding the shared panel is kept: a new renderer's handshake would sit on the 2.0 s recovery path. The playback controller clears its frame, except for a reload of the recording on screen.
    if (this.isRecordingRendererHoldingPanel()) return
    // The live lease's loading page replaces the shared panel's document, so a recording renderer reused across this reload could never acknowledge a frame.
    this.dropReplayViewport()
    try {
      this.viewport.showHistory(
        capturedAppHtml({ ...this.message(), loading: true }),
      )
    } catch {
      // A lease whose panel the editor already closed has no document to write; the recording loads into a new panel.
    }
  }

  /**
   * Says whether a recording renderer still holds the shared Application panel; asked by {@link showRecordingLoadingOnLiveViewport} before it would release that renderer for the loading page.
   * @returns `true` when a recording renderer exists and needs no new reveal; `false` when there is none, or when the one there has to reveal the panel again.
   * @example this.isRecordingRendererHoldingPanel() // => true at a reload of the recording on screen
   */
  private isRecordingRendererHoldingPanel(): boolean {
    return Boolean(this.replayViewport) && !this.replayNeedsReveal
  }

  /**
   * Releases the recording renderer whenever another writer takes over the shared Application panel's document or the recording is left.
   *
   * {@link loadPlayback}, {@link presentation}'s new live lease, a failed load, {@link leavePlayback}, {@link close}, the Application panel's
   * dispose handler and a renderer that never became ready in {@link ensureReplayViewport} call it;
   * {@link ensureReplayViewport} then constructs a new renderer for the next presentation, which performs its own first reveal.
   *
   * @example this.dropReplayViewport()
   */
  private dropReplayViewport(): void {
    this.replayViewport?.close()
    this.replayViewport = undefined
    this.replayNeedsReveal = false
  }

  /** Reuses the bounded PNG renderer without CDP, acquiring a fresh lease after replay-panel recreation. @example await this.ensureReplayViewport(signal) */
  private async ensureReplayViewport(
    signal: AbortSignal,
  ): Promise<BrowserViewport> {
    if (this.replayViewport) {
      if (this.replayNeedsReveal) {
        const reused = this.replayViewport
        await reused.reveal(signal)
        signal.throwIfAborted()
        // Only a completed handshake retires the owed reveal; an abandoned one leaves it to the next request.
        if (this.replayViewport === reused) this.replayNeedsReveal = false
      }
      return this.replayViewport
    }
    const panel = this.ensureApp()
    panel.title = 'codebook · Recorded application'
    const viewport = new BrowserViewport(
      this.selection.studyId!,
      (type, detail) => this.recordReplayDelivery(type, detail),
      () => this.playback?.hide(),
      'normal',
      { panel, released() {} },
      undefined,
      'recording',
    )
    this.replayViewport = viewport
    try {
      await viewport.reveal(signal)
      signal.throwIfAborted()
      return viewport
    } catch (error) {
      if (this.replayViewport === viewport) {
        // An abandoned request leaves the viewport to the newer one that may already be painting through it; the next presentation finishes its handshake.
        if (signal.aborted) this.replayNeedsReveal = true
        else this.dropReplayViewport()
      }
      throw error
    }
  }

  /** Confirms the recorded PNG, captured native source and matching context together before the controller commits a playhead. @example await this.presentPlayback(bundle, signal) */
  private async presentPlayback(
    bundle: PlaybackBundle,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted()
    // Reading a replay keeps an attached live run's held pause, which would otherwise expire while the learner studies.
    for (const record of this.service?.records.values() ?? [])
      record.runtime?.renewPauseHold?.()
    // Retire the previous native Variables tree before publishing another recorded source or frame.
    await this.replayDebugger?.retire(bundle.projection.debugger, signal)
    signal.throwIfAborted()
    this.playbackPending = bundle
    this.playbackPresentingReady = false
    this.selection = retainedStudySelectionSchema.parse({
      ...this.selection,
      studyId: bundle.studyId,
      itemId: bundle.projection.observation?.itemId ?? this.selection.itemId,
      follow: false,
    })
    const viewport = await this.ensureReplayViewport(signal)
    signal.throwIfAborted()
    // Opening the workspace may focus context over a manually moved source group; restore only when its native tab is inactive.
    await this.renderSelection(true, !this.sourceReady(), signal)
    signal.throwIfAborted()
    if (!this.sourceReady())
      throw new Error(
        'Recorded source has not reached the matching native reader.',
      )
    // Keep Application loading until native Run and Debug loads the historical values or its short grace elapses.
    let inspection: ReplayInspection | undefined
    if (
      bundle.context?.study.observations.some(
        (observation) => observation.debugger,
      ) ||
      this.replayDebugger
    ) {
      // An owner replaced by an earlier request may still be stopping; this presentation creates the next one only while it is current.
      await this.replayDebuggerRetired(signal)
      signal.throwIfAborted()
      this.replayDebugger ??= this.createReplayDebugger()
      inspection = await this.replayDebugger.present(
        bundle.projection.debugger,
        bundle.projection.debugger
          ? `Recorded pause · ${((bundle.projection.observation?.elapsedMs ?? bundle.projection.positionMs) / MILLISECONDS_PER_SECOND).toFixed(2)} s`
          : 'Not recorded at this moment',
        signal,
        this.sourceUri && bundle.projection.observation
          ? {
              uri: this.sourceUri.toString(),
              hash: this.message().model.source.hash,
            }
          : undefined,
      )
    }
    // Committing without native values stays truthful only with a visible way to load them in Run and Debug; later ticks of this stop keep it.
    this.replayUninspectedSnapshot =
      inspection === 'uninspected' ? bundle.projection.debugger : undefined
    // From here the moment is painting; settleOwnedPlayback bounds only this phase by PRESENTATION_READY_TIMEOUT_MS.
    const paint = this.beginReplayPaint()
    // A superseded frame may still wait behind a native placement hold that ignores cancellation; its paint phase must not count against the newer frame's settle.
    const endSupersededPaint = (): void => this.endReplayPaint(paint)
    signal.addEventListener('abort', endSupersededPaint, { once: true })
    try {
      if (bundle.image) {
        const image = bundle.image.toString('base64'),
          label = `Recorded · ${(bundle.projection.positionMs / MILLISECONDS_PER_SECOND).toFixed(2)} s`
        // Earlier reveal/seek receipts must not be attributed to this frame's first attempt.
        this.replayDelivery = { receipts: [], omitted: 0 }
        try {
          await viewport.present(image, label)
        } catch (error) {
          if (!(error instanceof ViewportAckTimeoutError)) throw error
          signal.throwIfAborted()
          const firstAttempt = this.drainReplayDelivery()
          // A native pane handoff can lose one paint receipt; re-handshake this read-only renderer before retrying the same frame.
          try {
            await viewport.reveal(signal)
          } catch (revealError) {
            if (signal.aborted) throw revealError
            throw new Error(
              `${VIEWPORT_ACK_TIMEOUT_REASON}; the same-frame retry could not re-handshake the renderer: ${String(revealError)}. First attempt: ${firstAttempt}. Re-handshake: ${this.drainReplayDelivery()}.`,
            )
          }
          signal.throwIfAborted()
          try {
            await viewport.present(image, label)
          } catch (retryError) {
            if (signal.aborted) throw retryError
            const retry = this.drainReplayDelivery()
            // Name both attempts so Recording error details separate a second lost receipt from another retry failure.
            throw new Error(
              retryError instanceof ViewportAckTimeoutError
                ? `${VIEWPORT_ACK_TIMEOUT_REASON} again after one same-frame retry. First attempt: ${firstAttempt}. Retry: ${retry}.`
                : `${VIEWPORT_ACK_TIMEOUT_REASON}; the same-frame retry then failed: ${String(retryError)}. First attempt: ${firstAttempt}. Retry: ${retry}.`,
            )
          }
        }
      } else
        await viewport.presentMissing(
          bundle.projection.missing ?? 'No recorded application image.',
          signal,
        )
      signal.throwIfAborted()
      this.playbackPresentingReady = true
      this.replayApplicationCovered = false
      this.lastRendered = undefined
      this.lastPublished = undefined
      this.publish()
      const revision = this.revision,
        presentationRevision = this.playback!.state().presentationRevision
      await waitUntil(
        () =>
          (this.summaryComposition && !this.summaryView?.visible) ||
          (this.lastRendered?.revision === revision &&
            this.lastRendered.presentationRevision === presentationRevision &&
            this.lastRendered.snapshotUri ===
              bundle.projection.observation?.snapshotUri),
        'matching recorded context presentation',
        CAPTURE_TIMEOUT_MS,
        signal,
      )
      signal.throwIfAborted()
    } finally {
      signal.removeEventListener('abort', endSupersededPaint)
      this.endReplayPaint(paint)
    }
  }

  /**
   * Marks the start of a replay frame's paint phase for {@link settleOwnedPlayback}'s paint bound.
   *
   * {@link presentPlayback} calls it after native debugger presentation resolved, just before the viewport delivery.
   *
   * @returns This phase's token; only {@link endReplayPaint} with the same token ends it, so a superseded presentation that finishes late cannot end a newer phase.
   * @example const paint = this.beginReplayPaint()
   */
  private beginReplayPaint(): object {
    const paint = {}
    this.replayPaint = { token: paint, startedAt: performance.now() }
    for (const watch of [...this.replayPaintWatchers]) watch()
    return paint
  }

  /**
   * Ends the paint phase that {@link beginReplayPaint} started, on every exit of {@link presentPlayback}.
   * @param paint - Token returned when this phase began.
   * @example this.endReplayPaint(paint)
   */
  private endReplayPaint(paint: object): void {
    if (this.replayPaint?.token !== paint) return
    this.replayPaint = undefined
    for (const watch of [...this.replayPaintWatchers]) watch()
  }

  /**
   * Retains the newest replay viewport delivery receipts for {@link presentPlayback}'s failure details.
   *
   * Passed as the recording {@link BrowserViewport}'s record callback; it never affects delivery or paint.
   *
   * @param type - Receipt name emitted by {@link BrowserViewport} or {@link FrameDelivery}.
   * @param detail - Receipt detail; only non-image fields are later summarized.
   *
   * @example
   * ```ts
   * this.recordReplayDelivery('viewport.sent', { id: 3 }) // replayDelivery.receipts ends with that receipt
   * ```
   */
  private recordReplayDelivery(type: string, detail?: unknown): void {
    this.replayDelivery.receipts.push({ type, detail })
    // Keep memory bounded; dropped receipts are counted so the summary never implies completeness.
    if (this.replayDelivery.receipts.length > REPLAY_VIEWPORT_RECEIPT_LIMIT) {
      this.replayDelivery.receipts.shift()
      this.replayDelivery.omitted++
    }
  }

  /**
   * Describes the current replay attempt's receipts plus native panel visibility, then starts a fresh attempt log.
   *
   * Called by {@link presentPlayback} after a recorded frame's paint receipt, re-handshake or retry fails.
   *
   * @returns Summary such as `sent #1; received (hidden, no area); rejected #1: …; panel visible`.
   *
   * @example
   * ```ts
   * const firstAttempt = this.drainReplayDelivery() // => 'no renderer receipts; panel hidden'
   * ```
   */
  private drainReplayDelivery(): string {
    const summary = `${describeViewportDelivery(this.replayDelivery)}; panel ${this.app?.visible ? 'visible' : 'hidden'}`
    this.replayDelivery = { receipts: [], omitted: 0 }
    return summary
  }

  /**
   * Waits for the replay frame a presentation change or repository navigation just requested, without holding its lock forever.
   *
   * A frame revealed while the replay panel is hidden may never paint, so each paint phase gets
   * {@link PRESENTATION_READY_TIMEOUT_MS}: the bound arms when a phase begins (counting one already in progress from its start),
   * clears when it ends and re-arms for the next one. Loading, native debugger retirement/startup and preference saves do not
   * count against it; {@link PRESENTATION_SETTLE_CEILING_MS} still ends a wait that never reaches painting. On expiry or abort
   * the pending frame is hidden only while this caller's playback revision is still current, so an expired older wait never
   * cancels a newer navigation's frame.
   *
   * @param signal - The presentation transition's or navigation's cancellation.
   * @throws The signal's reason when it aborted, otherwise a `PRESENTATION_UNAVAILABLE` {@link StudyError} after a bound.
   * @example
   * ```ts
   * this.playback!.reveal()
   * await this.settleOwnedPlayback(signal)
   * ```
   */
  private async settleOwnedPlayback(signal?: AbortSignal): Promise<void> {
    const playback = this.playback!,
      ownedRevision = playback.state().revision,
      paintExpired = new AbortController()
    let paintTimer: ReturnType<typeof setTimeout> | undefined
    const watchPaint = (): void => {
      clearTimeout(paintTimer)
      paintTimer = undefined
      const startedAt = this.replayPaint?.startedAt
      if (startedAt === undefined) return
      paintTimer = setTimeout(
        () => paintExpired.abort(),
        Math.max(
          0,
          startedAt + PRESENTATION_READY_TIMEOUT_MS - performance.now(),
        ),
      )
    }
    this.replayPaintWatchers.add(watchPaint)
    watchPaint()
    try {
      await playback.settle(
        signal
          ? AbortSignal.any([signal, paintExpired.signal])
          : paintExpired.signal,
        PRESENTATION_SETTLE_CEILING_MS,
      )
    } catch {
      // Only the owner of the pending frame retires it; its confirmed moment stays for the next reveal.
      if (playback.state().revision === ownedRevision) playback.hide()
      signal?.throwIfAborted()
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'The recorded replay frame did not finish presenting. Show the replay, then try again.',
      )
    } finally {
      clearTimeout(paintTimer)
      this.replayPaintWatchers.delete(watchPaint)
    }
  }

  /** Leaves historical presentation on explicit navigation, never stopping or continuing the independently owned runtime. @example this.leavePlayback() */
  private leavePlayback(): void {
    this.nodeHistoryPlaybackController?.pause()
    this.repositoryRecordingOpen = undefined
    if (!this.recordingActive) return
    this.playback?.leave()
    this.clearLearningSummary()
    this.dropReplayViewport()
    this.recordingActive = false
    this.playbackPending = undefined
    this.playbackPresentingReady = false
    this.replayApplicationCovered = false
    this.replayUninspectedSnapshot = undefined
    this.lastApplicationKey = undefined
    this.lastSelectionKey = undefined
  }

  /**
   * Retires the selected Node journal with its playback and historical debugger context when the learner leaves it for a browser history or the current run.
   * Closes only unmodified, unpinned source previews that this history's debugger opened; pinned, edited and unrelated tabs belong to the learner.
   * A caller rechecks its own request afterwards, because the native preview close can let the reader change.
   * @example
   * ```ts
   * await this.retireNodeHistorySelection()
   * ```
   */
  private async retireNodeHistorySelection(): Promise<void> {
    const previousNodeHistoryId = this.selectedNodeHistory?.header.studyId
    this.selectedNodeHistoryRequest++
    this.nodeHistoryPlaybackController?.dispose()
    this.nodeHistoryPlaybackController = undefined
    this.selectedNodeHistory = undefined
    this.selectedNodeHistoryLearningDecision = undefined
    this.selectedNodeHistoryLearningMaterial = undefined
    this.selectedNodeHistorySequence = undefined
    this.selectedNodeHistoryDebugAvailable = false
    this.selectedNodeHistoryValuesUninspected = false
    this.replayDebugger?.invalidate()
    if (!previousNodeHistoryId) return
    const previousHistoryPath = `/node-history/${previousNodeHistoryId}/`
    const previews = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter(
        (tab) =>
          tab.isPreview &&
          !tab.isDirty &&
          !tab.isPinned &&
          this.ownsCapturedSourceTab(tab) &&
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.path.startsWith(previousHistoryPath),
      )
    if (previews.length) {
      try {
        if (!(await vscode.window.tabGroups.close(previews, true)))
          throw new Error('The editor kept the previous Node history preview.')
      } catch (error) {
        this.report(
          'layout',
          new Error(
            `Previous Node history previews could not close. Arrange the Codebook panes manually. ${String(error)}`,
          ),
        )
      }
    }
  }

  /** Selects retained definition bytes for every reader surface without borrowing a different history during replay loading. @example this.selectedStudy()?.profile */
  private selectedStudy(forSource = false): RetainedStudy | undefined {
    const archive =
      this.selection.studyId === this.activeArchive?.id
        ? this.activeArchive
        : this.selectedArchive?.id === this.selection.studyId
          ? this.selectedArchive
          : undefined
    if (!this.recordingActive) return archive
    const state = this.playback?.state()
    const bundle =
      forSource || this.playbackPresentingReady || state?.cleared
        ? (this.playbackPending ?? this.playback?.bundle())
        : this.playback?.bundle()
    return bundle?.context ? { ...bundle.context.study, captures: [] } : archive
  }

  /** Reloads the shared learner ledger on explicit entry/focus so Wiki decisions immediately carry into Study without runtime polling. @example await this.refreshProgress() */
  private async refreshProgress(): Promise<void> {
    const lifetime = this.lifetime
    try {
      const progress = await this.library!.readProgress()
      this.assertLifetime(lifetime)
      this.progress = progress
      this.repositoryOrigin = progress.repositoryReturn
      // A ledger that can be read again has not written the understanding choice that waits: its line, and Retry with it, stay until it is written.
      if (!this.pendingDecision) this.errors.delete('progress')
    } catch (error) {
      if (!this.closing && !this.disposed && lifetime === this.lifetime)
        this.report('progress', error)
    }
  }

  /** Verifies all selected citations on navigation/change, sharing bounded source acquisition instead of scanning on every render tick. @example await this.refreshCitations(true) */
  private async refreshCitations(force = false): Promise<void> {
    const study = this.selectedStudy(true),
      descriptor = study !== undefined ? study.descriptor : undefined
    const key = descriptor?.citationContext.hash
    if (!force && this.citationKey === key) return
    this.citationKey = key
    this.citationSources = undefined
    const revision = ++this.citationRevision
    for (const watcher of this.citationWatchers.splice(0)) watcher.dispose()
    if (!descriptor || !this.repositorySources) return
    for (const path of new Set(
      descriptor.anchors.map((anchor) => anchor.path),
    )) {
      const target = join(this.repositorySources.workspace, path)
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(dirname(target), '*'),
      )
      const changed = (uri: vscode.Uri): void => {
        if (uri.fsPath === target) this.scheduleCitationRefresh()
      }
      this.citationWatchers.push(
        watcher,
        watcher.onDidChange(changed),
        watcher.onDidCreate(changed),
        watcher.onDidDelete(changed),
      )
    }
    const states = await this.repositorySources.inspect(descriptor.sources)
    // An old disk read cannot certify another article or erase a newer unsaved edit notification.
    if (
      revision !== this.citationRevision ||
      this.disposed ||
      key !== this.citationKey
    )
      return
    this.citationSources = states.map((state) => {
      const document = vscode.workspace.textDocuments.find(
        (document) =>
          document.isDirty &&
          document.uri.fsPath ===
            join(this.repositorySources!.workspace, state.path),
      )
      if (!document || state.status !== 'current') return state
      const text = document.getText()
      return {
        ...state,
        status: 'changed',
        currentHash:
          Buffer.byteLength(text) <= REPOSITORY_SOURCE_LIMIT_BYTES
            ? sha256(text)
            : undefined,
        reason: 'The current editor has unsaved changes.',
      }
    })
  }

  /** Invalidates current-source claims immediately while coalescing filesystem/editor changes for the selected citation set. @example this.scheduleCitationRefresh() */
  private scheduleCitationRefresh(): void {
    this.citationRevision++
    this.citationSources = undefined
    this.publish()
    clearTimeout(this.citationRefreshTimer)
    this.citationRefreshTimer = setTimeout(() => {
      void this.refreshCitations(true)
        .then(() => this.publish())
        .catch((error) => this.report('citations', error))
    }, REPOSITORY_READER_DEBOUNCE_MS)
  }

  /** Joins compact live state with the selected archive; event logs never enter webview messages. @example this.message().model */
  private message(forSource = false): StudyViewMessage {
    if (!this.baselines) throw new Error('Study reader is not initialized.')
    const record = this.currentRecord(),
      live = record && this.service?.state(record)
    const playbackState = this.recordingActive
      ? this.playback?.state()
      : undefined
    const bundle = this.recordingActive
      ? forSource || this.playbackPresentingReady || playbackState?.cleared
        ? (this.playbackPending ?? this.playback?.bundle())
        : this.playback?.bundle()
      : undefined
    const study = this.selectedStudy(forSource)
    const selectedRecord =
      study?.instanceId === this.service?.instanceId && study
        ? this.service?.records.get(study.runId)
        : undefined
    const selectedState = selectedRecord && this.service?.state(selectedRecord),
      receipt = study && this.historyReceipts.get(study.id),
      loaded = study && this.loadedHistory.get(study.id)
    const staleArchive = Boolean(
      selectedState &&
      selectedState.materialSignature !== study?.materialSignature,
    )
    // A newly failed disk verification outranks a formerly successful in-memory receipt for those bytes.
    const rejectedDisk =
      loaded?.signature === study?.materialSignature &&
      loaded?.status === 'failed'
    // A newer failure stays explicit; stale displayed bytes must never inherit a newer successful receipt.
    const historyOutcome = rejectedDisk
      ? 'failed'
      : staleArchive
        ? selectedState?.historyOutcome.status === 'failed'
          ? 'failed'
          : 'pending'
        : (selectedState?.historyOutcome.status ??
          (receipt
            ? receipt.signature === study?.materialSignature
              ? receipt.status
              : receipt.status === 'failed'
                ? 'failed'
                : 'pending'
            : loaded?.signature === study?.materialSignature
              ? (loaded?.status ?? 'unavailable')
              : 'unavailable'))
    const studyOutcome = rejectedDisk
      ? study?.finalOutcome === 'not-demonstrated'
        ? 'not-demonstrated'
        : 'partial'
      : ((!staleArchive ? selectedState?.studyOutcome : undefined) ??
        (study?.finalOutcome === 'not-demonstrated'
          ? 'not-demonstrated'
          : study?.finalOutcome === 'partial'
            ? 'partial'
            : !study?.terminal || study.finalOutcome !== 'demonstrated'
              ? 'pending'
              : historyOutcome === 'saved'
                ? 'demonstrated'
                : historyOutcome === 'pending'
                  ? 'pending'
                  : 'partial'))
    const descriptor = describeStudy(study ?? this.selection)
    const liveDescriptor =
      record && record.profile !== NODE_TEST_PROFILE
        ? describeStudy(
            record.profile === REPOSITORY_BROWSER_PROFILE
              ? { ...record, descriptor: record.definition?.descriptor }
              : record,
          )
        : undefined
    const nextAction = liveDescriptor?.actions.find((action) =>
      live?.nextActions.includes(action.id),
    )
    const playbackRecording: NonNullable<
      StudyViewMessage['study']
    >['recordingSave'] =
      bundle && playbackState?.recordingStatus
        ? {
            status:
              playbackState.recordingStatus === 'interrupted' ||
              playbackState.recordingStatus === 'unfinalized'
                ? 'partial'
                : playbackState.recordingStatus,
            contextStatus: bundle.context ? 'saved' : 'unavailable',
            reason: playbackState.recordingReason,
            contextReason: playbackState.contextReason,
          }
        : undefined
    const projectionInput = {
      selection: this.selection,
      study,
      live,
      liveDescriptor,
      plannedStopLine:
        record?.runtime && plannedStopLine(record.runtime.view().events),
      progress: this.progress,
      baselines: this.baselines,
      currentSourceAvailable: this.currentSourceAvailable,
      citationSources: this.citationSources,
    }
    const selectedNodeHistory = this.selectedNodeHistory
    const selectedNodeHistoryEvent = selectedNodeHistory?.entries.find(
      (entry) => entry.sequence === this.selectedNodeHistorySequence,
    )
    const selectedNodeHistoryStop =
      selectedNodeHistoryEvent?.type === 'stop'
        ? selectedNodeHistoryEvent
        : undefined
    const selectedNodeHistoryOutput =
      selectedNodeHistory && selectedNodeHistoryEvent
        ? selectedNodeHistory.entries
            .filter(
              (
                entry,
              ): entry is Extract<
                NodeTestHistoryIndex['entries'][number],
                { type: 'output' }
              > =>
                entry.type === 'output' &&
                entry.sequence <= selectedNodeHistoryEvent.sequence,
            )
            .map((entry) => entry.text)
            .join('')
        : undefined
    const studyCatalog: StudyCatalogEntry[] = [
      ...this.catalog,
      ...this.nodeHistoryCatalog.map((history) => ({
        id: history.studyId,
        savedAt: history.createdAt,
        profile: 'node-test' as const,
        format: 'node-test-history' as const,
        outcome: `Node test ${history.status}; application video and synchronized replay unavailable`,
        metadata:
          history.verification === 'verified'
            ? ('validated' as const)
            : ('unavailable' as const),
        ...(history.reason ? { reason: history.reason } : {}),
      })),
    ].sort((left, right) => right.savedAt.localeCompare(left.savedAt))
    return {
      type: 'study',
      revision: this.revision,
      model: this.recordingActive
        ? projectPlaybackStudy(projectionInput, bundle)
        : projectStudy(projectionInput),
      presentation: this.presentationState(),
      contentTab: this.recordingActive ? 'recording' : this.selection.tab,
      repositoryReturnAvailable: Boolean(
        this.controls.returnToRepository &&
        this.repositoryOrigin?.studyId === this.selection.studyId &&
        this.repositoryOrigin,
      ),
      repositoryArticleAvailable: Boolean(
        study !== undefined && this.controls.openArticle,
      ),
      recording: playbackState && {
        ...playbackState,
        pauseConfirmed: bundle?.projection.pauseConfirmed ?? false,
        rendererConfirmed: bundle?.projection.rendererConfirmed ?? false,
        laterInterpretations: bundle?.projection.laterInterpretations ?? [],
        learningSummary: projectLearningSummary(
          bundle?.context?.study,
          bundle?.context?.phases,
        ),
        nativeValuesUninspected:
          bundle?.projection.debugger !== undefined &&
          bundle.projection.debugger === this.replayUninspectedSnapshot,
        applicationCovered: this.replayApplicationCovered,
      },
      nodeHistoryCatalog: this.nodeHistoryCatalog,
      nodeHistory: this.selectedNodeHistory && {
        ...this.selectedNodeHistory,
        entries: this.selectedNodeHistory.entries.slice(
          this.selectedNodeHistoryPage * NODE_HISTORY_READER_PAGE_SIZE,
          (this.selectedNodeHistoryPage + 1) * NODE_HISTORY_READER_PAGE_SIZE,
        ),
      },
      nodeHistoryLearningDecision: this.selectedNodeHistoryLearningDecision,
      nodeHistoryLearningMaterial: this.selectedNodeHistoryLearningMaterial,
      // The reader cannot hash captured text, so every shown stop whose source fails verification is named here and gets no Inspect.
      nodeHistoryUnverifiedStops: this.selectedNodeHistory?.entries
        .slice(
          this.selectedNodeHistoryPage * NODE_HISTORY_READER_PAGE_SIZE,
          (this.selectedNodeHistoryPage + 1) * NODE_HISTORY_READER_PAGE_SIZE,
        )
        .filter(
          (entry) => entry.type === 'stop' && !nodeStopSourceMatches(entry),
        )
        .map((entry) => entry.sequence),
      nodeHistoryPlayback: this.nodeHistoryPlaybackController?.state(),
      nodeHistoryPosition: selectedNodeHistoryEvent && {
        sequence: selectedNodeHistoryEvent.sequence,
        type: selectedNodeHistoryEvent.type,
        eventIndex:
          selectedNodeHistory?.entries.findIndex(
            (entry) => entry.sequence === selectedNodeHistoryEvent.sequence,
          ) ?? -1,
        ...(selectedNodeHistoryStop
          ? {
              index: selectedNodeHistoryStop.index,
              // A verified source match stays true after the session ends; only debuggerAvailable tracks the native session.
              sourceAvailable: nodeStopSourceMatches(selectedNodeHistoryStop),
              debuggerAvailable: this.selectedNodeHistoryDebugAvailable,
              nativeValuesUninspected:
                this.selectedNodeHistoryValuesUninspected,
            }
          : {}),
        elapsedMs: selectedNodeHistoryEvent.elapsedMs,
      },
      nodeHistoryOutput: selectedNodeHistoryOutput,
      nodeHistoryPage: this.selectedNodeHistoryPage,
      nodeHistoryPageCount: this.selectedNodeHistory
        ? Math.max(
            1,
            Math.ceil(
              this.selectedNodeHistory.entries.length /
                NODE_HISTORY_READER_PAGE_SIZE,
            ),
          )
        : 0,
      nodeHistoryEventCount: this.selectedNodeHistory?.entries.length ?? 0,
      study: study && {
        id: study.id,
        state: study.state,
        terminal: study.terminal,
        profile: study.profile,
        createdAt: study.createdAt,
        reason: study.reason,
        finalOutcome: study.finalOutcome,
        links: this.recordingActive ? [] : study.links,
        historyOutcome,
        studyOutcome,
        recordingSave: selectedState
          ? {
              status: selectedState.recording.status,
              contextStatus: staleArchive
                ? 'pending'
                : selectedState.recording.contextStatus,
              reason: selectedState.recording.reason,
              contextReason: selectedState.recording.contextReason,
            }
          : playbackRecording,
      },
      liveState: live?.state,
      deadlineAt: live?.deadlineAt,
      busy: this.busy,
      saving: this.saving,
      // A covered recording is not loading: its moment is retired until the pane is in front again, and the pane says so.
      loading:
        this.loading ||
        Boolean(
          playbackState?.cleared &&
          !this.playbackPresentingReady &&
          !this.replayApplicationCovered,
        ),
      errors: [
        ...this.errors.values(),
        // The note of a study a newer Codebook saved is no failure Retry storage can answer; the entry itself carries it.
        ...this.catalog.flatMap((entry) =>
          entry.reason && entry.format !== 'newer' ? [entry.reason] : [],
        ),
      ],
      unretryableErrorCount: [...this.errors.keys()].filter((kind) =>
        UNRETRYABLE_READER_ERROR_KINDS.has(kind),
      ).length,
      nextAction,
      liveProfile:
        live?.profile === NODE_TEST_PROFILE ? undefined : live?.profile,
      liveTitle: liveDescriptor?.title,
      profiles: [descriptor].map((profile) => ({
        id: profile.id,
        title: profile.title,
        description: profile.description,
      })),
      canClick: !this.recordingActive && Boolean(nextAction),
      canRun:
        (!record || record.stopped) &&
        this.selection.profile !== REPOSITORY_BROWSER_PROFILE,
      moments: (study?.observations ?? []).map((observation) => ({
        id: observation.id,
        itemId: observation.itemId,
        title:
          descriptor.items.find((item) => item.id === observation.itemId)
            ?.title ?? 'Captured observation',
        at: observation.capturedAt,
        elapsedMs: observation.elapsedMs,
      })),
      studies: studyCatalog,
      studyRemoval: this.studyRemoval,
      ...(this.studyRemovalAvailability() === 'no-trash'
        ? {
            removalWithoutTrash: true as const,
            studyFiles: Object.fromEntries(this.listedStudyFiles),
          }
        : {}),
      // While a recording is open the pane reads that recording; the line of a run that did not start comes back with Overview or Live.
      runRefusal:
        record?.historyExcluded === 'refused-at-admission' &&
        record.error &&
        record.id !== this.answeredRunRefusalId &&
        !this.recordingActive
          ? `The last run did not start: ${record.error.message}`
          : undefined,
      unstoppedStudyId: this.unstoppedStudyId(),
    }
  }

  /**
   * Says whether the reader itself is changing the editor's tabs now: it is closing, loading a selection, reserving or arranging its panes, or changing the presentation. Asked by {@link publishAfterTabChange}: a tab event during such an operation is the reader's own, and the operation tells the panes when it ends.
   * @example if (this.changesTabsItself()) return
   */
  private changesTabsItself(): boolean {
    return (
      this.closing ||
      this.loading ||
      this.sourceEntryPending ||
      this.isArrangingPresentation()
    )
  }

  /** Says whether an arrangement or a change of the presentation is under way; asked by {@link changesTabsItself}. @example this.isArrangingPresentation() // => true while Restore applies its layout */
  private isArrangingPresentation(): boolean {
    return (
      this.placingPresentation ||
      this.arranging !== undefined ||
      this.presentationTransition !== undefined
    )
  }

  /**
   * Tells the panes what a change of the editor's tabs did to the layout's confirmation; called at every tab and tab-group event of the editor.
   * The presentation of a Study message is read from the tabs as they are, but no message was published when the learner closed the captured source's tab or a pane's tab by hand: an agent's status read answered "not confirmed" at once, and the pane's status line stayed empty until some other action published.
   * The rule: while the reader is open and is not changing tabs itself ({@link changesTabsItself}), a tab event publishes. {@link publish} sends nothing when the Study message is the same and changes no tab, so events that change nothing cost one comparison, and the reader cannot publish in a loop on tab events.
   * What the line can still miss: a change that no tab event tells, a sash the learner drags for example, is seen only when the layout is read, at an agent's status read or at Restore ({@link readPresentationState}); and a tab the learner closes while the reader changes tabs itself is told when that operation ends.
   * @example this.publishAfterTabChange()
   */
  private publishAfterTabChange(): void {
    if (!this.opened || this.changesTabsItself()) return
    this.publish()
  }

  /** Publishes a matching projection with stable DOM controls, excluding images from the context channel. @example this.publish() */
  private publish(): void {
    this.publishLearningSave()
    if (!this.baselines) return
    const message = this.message()
    // Native readers retain full source; neither duplicate body belongs in the webview signature or message.
    const observation = message.model.observation
    const compact = {
      ...message,
      playbackPanelVisible: Boolean(
        this.recordingActive && this.moments?.visible,
      ),
      model: {
        ...message.model,
        image: undefined,
        source: { ...message.model.source, text: '' },
        observation: observation && {
          ...observation,
          source: { ...observation.source, text: '' },
        },
      },
    }
    const signature = JSON.stringify(compact)
    if (signature === this.lastPublished) return
    this.lastPublished = signature
    void this.contextPanel?.webview.postMessage(compact)
    if (this.summaryComposition)
      void this.summaryView?.webview.postMessage(compact)
    if (this.moments)
      this.moments.title = this.recordingActive
        ? 'Learning replay'
        : 'Observed moments'
    void this.moments?.webview.postMessage(compact)
    if (this.outline)
      this.outline.message = message.model.currentSourceAvailable
        ? `${message.model.understoodCount} of ${message.model.progressByItem.length} understood for current source · ${message.model.reviewCount} needs review`
        : 'Current source unavailable · historical understanding retained'
    const outlineKey = JSON.stringify([
      message.model.progressByItem,
      message.model.currentSourceAvailable,
    ])
    // Playhead ticks do not rebuild native checkboxes when the learner/source state is unchanged.
    if (outlineKey !== this.lastOutlineModelKey) {
      this.lastOutlineModelKey = outlineKey
      this.treeChanges.fire(undefined)
    }
    this.syncOutline()
  }

  /** Aligns visible native selection without opening a hidden outline or stealing keyboard focus. @example this.syncOutline() */
  private syncOutline(): void {
    if (
      !this.outline?.visible ||
      !this.baselines ||
      this.closing ||
      this.disposed
    )
      return
    const itemId = this.selection.itemId,
      lifetime = this.lifetime
    if (this.lastOutlineSelection === itemId) return
    this.lastOutlineSelection = itemId
    const isCurrent = () =>
      !this.closing &&
      !this.disposed &&
      lifetime === this.lifetime &&
      itemId === this.selection.itemId
    this.outlineRendering = this.outlineRendering
      .then(async () => {
        if (!this.outline?.visible || !isCurrent()) return
        await this.outline.reveal(itemId, { select: true, focus: false })
        if (isCurrent() && this.errors.delete('outline')) this.publish()
      })
      .catch((error) => {
        // Native TreeView resolution can reject an old item after another profile or reader has replaced it.
        if (isCurrent()) this.report('outline', error)
      })
  }

  /**
   * Shows the selected captured source in its native tab and commits source, application and context together; entry, selection, the reader's refresh, playback and the pane's Source and Retry controls call it.
   *
   * Source opens are serialized, and obsolete selection work is invalidated before it can qualify context/app correspondence. An unchanged
   * selection is not rendered again unless `forceSource` is set or its last render failed once (see {@link failedSelectionKey}). Showing a
   * source closes the unpinned captured tabs that earlier runs or studies left for the same declared file.
   *
   * @param preserveFocus - Whether the keyboard focus stays where it is; `false` moves it into the source.
   * @param forceSource - Renders also when the selection did not change.
   * @param signal - The caller's cancellation; an aborted render ends its loading state without an error line.
   * @param placement - The column an arrangement gives the source, or the layout receipt a reentry may restore it into.
   * @returns Once the source is shown, the render was superseded, or its failure was reported as the reader's `reader` line with the loading state ended.
   * @throws The signal's reason when it aborted before the render was queued, or the lifetime error when the reader closed meanwhile.
   * @example await this.renderSelection(true, !this.sourceReady(), signal)
   */
  private async renderSelection(
    preserveFocus = true,
    forceSource = false,
    signal?: AbortSignal,
    placement?:
      | { kind: 'arrange'; column: vscode.ViewColumn }
      | {
          kind: 'reentry'
          receipt: NonNullable<StudyWorkspace['layoutReceipt']>
        },
  ): Promise<void> {
    signal?.throwIfAborted()
    if (
      !this.opened ||
      this.closing ||
      this.sourceEntryPending ||
      !this.baselines ||
      this.pendingHistory !== undefined
    )
      return Promise.resolve()
    // An explicit entry, selection or placement shows the panes now; a study that waited for the editor area waits no longer.
    this.studyAwaitingEditorArea = undefined
    const lifetime = this.lifetime
    await this.refreshCitations()
    // Citation I/O can outlive Close or a later Open; it cannot create a new rendering revision afterward.
    this.assertLifetime(lifetime)
    signal?.throwIfAborted()
    if (!this.opened || this.pendingHistory !== undefined) return
    const initial = this.message(true)
    const selectionKey = JSON.stringify([
      initial.model.selection.studyId,
      initial.model.selection.itemId,
      initial.model.source.hash,
      initial.model.observation?.id,
      initial.model.selection.follow,
      // Before the first pause the shown line follows the run: the declared line, then the line the stop was requested at or bound on. An observation's line never changes.
      initial.model.observation ? undefined : initial.model.source.line,
    ])
    if (
      !forceSource &&
      preserveFocus &&
      this.lastSelectionKey === selectionKey
    ) {
      this.presentApplication(initial)
      this.publish()
      return Promise.resolve()
    }
    const revision = ++this.revision
    this.lastSelectionKey = selectionKey
    this.loading = true
    this.sourceRevision = undefined
    this.lastRendered = undefined
    // The line of an earlier failed render describes an attempt this one replaces; the pane never reads "Loading…" beside it.
    this.errors.delete('reader')
    this.publish()
    if (!initial.model.selection.follow)
      this.presentApplication({ ...initial, loading: true })
    const pending = this.rendering
      .catch(() => undefined)
      .then(async () => {
        signal?.throwIfAborted()
        if (
          revision !== this.revision ||
          this.closing ||
          this.pendingHistory !== undefined
        )
          return
        const message = this.message(true)
        const itemId = message.model.selection.itemId,
          source = message.model.source,
          study = this.selectedStudy(true)
        const declaredSourcePosition =
          study &&
          configuredObservationPosition(study, message.model.observation?.id)
        // Pre-observation placeholders are transient; retaining them would pull replay back to an obsolete source pane.
        const retainedSource = study?.descriptor?.sources.some(
          (captured) =>
            captured.path === declaredSourcePosition?.path &&
            captured.hash === source.hash,
        )
        const uri = vscode.Uri.from({
          scheme: STUDY_SOURCE_SCHEME,
          authority: this.library!.workspaceKey,
          path: capturedSourceUriPath({
            owner:
              message.model.observation || retainedSource
                ? study!.id
                : 'source-derived',
            itemId,
            hash: source.hash,
            declaredPath: declaredSourcePosition?.path,
            fallbackName: `${itemId.split('/').at(-1)}.mts`,
          }),
        })
        this.documents.set(uri.toString(), source.text)
        // Native documents retain their own visible bytes; the provider cache must remain bounded across edits.
        for (const cached of this.documents.keys()) {
          if (this.documents.size <= MAX_SOURCE_DOCUMENTS) break
          this.documents.delete(cached)
        }
        const document = await vscode.workspace.openTextDocument(uri)
        signal?.throwIfAborted()
        if (
          revision !== this.revision ||
          this.closing ||
          this.pendingHistory !== undefined
        )
          return
        let sourceColumn =
          placement?.kind === 'arrange' ? placement.column : undefined
        // Reentry cannot overwrite a learner move during source I/O; only explicit Arrange retains an unconditional target.
        if (placement?.kind === 'reentry') {
          const receipt = placement.receipt,
            layout = await vscode.commands.executeCommand<unknown>(
              'vscode.getEditorLayout',
            )
          signal?.throwIfAborted()
          if (
            revision !== this.revision ||
            this.closing ||
            lifetime !== this.lifetime ||
            this.pendingHistory !== undefined
          )
            return
          if (
            receipt === this.layoutReceipt &&
            JSON.stringify(layout) === receipt.signature &&
            this.sameEditorGroups(
              receipt.groups,
              vscode.window.tabGroups.all,
            ) &&
            this.sameStudyPanePositions(
              receipt.panes,
              receipt.sourceTargetColumn,
            )
          )
            sourceColumn = receipt.sourceTargetColumn
          else if (receipt === this.layoutReceipt)
            this.layoutReceipt = undefined
        }
        const sourceGroups = vscode.window.tabGroups.all.filter((group) =>
          group.tabs.some(
            (tab) =>
              tab.input instanceof vscode.TabInputText &&
              [uri.toString(), this.sourceUri?.toString()].includes(
                tab.input.uri.toString(),
              ),
          ),
        )
        // Retain the last rendered source group through wrapper resync without adopting an older duplicate.
        const sourceGroupIdentity =
          this.sourceGroup && this.editorGroupIdentities.get(this.sourceGroup)
        const group =
          sourceGroups.find(
            (group) =>
              group === this.sourceGroup ||
              (sourceGroupIdentity &&
                this.editorGroupIdentities.get(group) === sourceGroupIdentity),
          ) ??
          sourceGroups.find(
            (group) => group === vscode.window.tabGroups.activeTabGroup,
          ) ??
          sourceGroups[0]
        const targetColumn =
          sourceColumn ??
          group?.viewColumn ??
          STUDY_PRESENTATIONS[this.presentationMode].sourceColumn
        const position = new vscode.Position(source.line - 1, 0)
        const confirmedLayout = await this.confirmedLayoutBehindHiddenArea(
          Boolean(placement),
        )
        if (this.closing || lifetime !== this.lifetime) return
        // Over the file the debugger focused at a live pause the source takes the keyboard focus that file had: hiding that editor while preserving the focus would leave it nowhere.
        const takesPausedFocus =
          preserveFocus &&
          this.replacesEditorFocusedByPause(targetColumn, document.uri)
        const editor = await vscode.window.showTextDocument(document, {
          viewColumn: targetColumn,
          preserveFocus: preserveFocus && !takesPausedFocus,
          preview: false,
          selection: new vscode.Range(position, position),
        })
        if (this.closing || lifetime !== this.lifetime) return
        // The chat that had the keyboard before this pause gets it back; without one the learner is told once where the keyboard is. A render that was asked for with the keyboard is the learner's choice of the source: no return follows it, and the chat's record ends.
        if (preserveFocus) await this.settleKeyboardAtPause(takesPausedFocus)
        else this.keyboardOutsideEditors = undefined
        if (confirmedLayout) await this.reapplyConfirmedLayout(confirmedLayout)
        if (this.closing || lifetime !== this.lifetime) return
        // Retain accepted placement before cancellation, while observation/source/value commits still require the current intent.
        this.sourceGroup =
          vscode.window.tabGroups.all.find(
            (group) =>
              group.viewColumn === targetColumn &&
              group.tabs.some(
                (tab) =>
                  tab.input instanceof vscode.TabInputText &&
                  tab.input.uri.toString() === uri.toString(),
              ),
          ) ?? this.sourceGroup
        signal?.throwIfAborted()
        if (
          revision !== this.revision ||
          this.closing ||
          this.pendingHistory !== undefined
        )
          return
        if (
          normalizeNativeSourceText(editor.document.getText()) !==
          normalizeNativeSourceText(source.text)
        )
          throw new Error(
            'Displayed captured source does not match the selected observation.',
          )
        const previousUri = this.sourceUri
        this.sourceUri = uri
        // Every visible copy of the same immutable source describes the same selected stop.
        if (this.highlight)
          for (const visibleEditor of vscode.window.visibleTextEditors) {
            if (visibleEditor.document.uri.toString() === uri.toString())
              visibleEditor.setDecorations(
                this.highlight,
                this.recordingActive && !initial.model.observation
                  ? []
                  : [new vscode.Range(position, position)],
              )
          }
        // Replace the transient source-derived revision shown before and every earlier capture of the same file (another run or study, also one shown several studies ago), so each source keeps one captured tab. The file is the declared path: two routes' `page.tsx` share a tab name and keep a tab each. A tab the learner pinned stays.
        const declaredPath = declaredSourcePosition?.path
        const replacesPreviousPlaceholder =
          previousUri !== undefined &&
          previousUri.toString() !== uri.toString() &&
          previousUri.path.startsWith('/source-derived/')
        const obsoleteUris = new Set(
          vscode.window.tabGroups.all
            .flatMap((group) => group.tabs)
            .flatMap((tab) =>
              tab.input instanceof vscode.TabInputText &&
              this.ownsCapturedSourceTab(tab) &&
              tab.input.uri.toString() !== uri.toString() &&
              ((replacesPreviousPlaceholder &&
                tab.input.uri.toString() === previousUri.toString()) ||
                (declaredPath !== undefined &&
                  capturedSourceDeclaredPath(tab.input.uri.path) ===
                    declaredPath))
                ? [tab.input.uri.toString()]
                : [],
            ),
        )
        if (replacesPreviousPlaceholder)
          obsoleteUris.add(previousUri.toString())
        if (obsoleteUris.size) {
          const obsolete = vscode.window.tabGroups.all
            .flatMap((group) => group.tabs)
            .filter(
              (tab) =>
                !tab.isPinned &&
                tab.input instanceof vscode.TabInputText &&
                obsoleteUris.has(tab.input.uri.toString()),
            )
          if (
            obsolete.length &&
            !(await vscode.window.tabGroups.close(obsolete, true))
          )
            throw new Error('Obsolete source-derived reader could not close.')
          signal?.throwIfAborted()
          // A pinned tab keeps showing its capture, so its bytes stay with the provider.
          const stillShown = new Set(
            vscode.window.tabGroups.all
              .flatMap((group) => group.tabs)
              .flatMap((tab) =>
                tab.input instanceof vscode.TabInputText
                  ? [tab.input.uri.toString()]
                  : [],
              ),
          )
          for (const obsoleteUri of obsoleteUris)
            if (!stillShown.has(obsoleteUri)) this.documents.delete(obsoleteUri)
        }
        if (
          revision !== this.revision ||
          this.closing ||
          this.pendingHistory !== undefined
        )
          return
        this.presentApplication({ ...message, loading: false })
        if (revision !== this.revision || this.closing) return
        this.sourceRevision = revision
        this.loading = false
        this.failedSelectionKey = undefined
        this.errors.delete('reader')
        this.publish()
      })
    this.rendering = pending.catch((error) => {
      if (this.isRenderSuperseded(revision)) return
      // A render that ended without its source also ends its loading state: the pane shows the reason with Retry, not "Loading the selected observation…".
      this.loading = false
      if (signal?.aborted) {
        this.lastSelectionKey = undefined
        return
      }
      this.reportFailedSelection(selectionKey, error)
    })
    return this.rendering
  }

  /**
   * Says whether a render no longer speaks for the reader; asked by the failure handler of {@link renderSelection} before it ends the loading state.
   * @param revision - The rendering revision the render took.
   * @returns `true` when a newer render took a revision, the reader is closing, or a saved study is being opened.
   * @example if (this.isRenderSuperseded(revision)) return
   */
  private isRenderSuperseded(revision: number): boolean {
    return (
      revision !== this.revision ||
      this.closing ||
      this.pendingHistory !== undefined
    )
  }

  /**
   * Reports a render that failed as the reader's `reader` line and remembers its selection; the last step of the failure handler of {@link renderSelection}, for a render that was neither superseded nor cancelled.
   * @param selectionKey - The key of the selection the render was for.
   * @param error - What the render threw.
   * @example this.reportFailedSelection(selectionKey, error)
   */
  private reportFailedSelection(selectionKey: string, error: unknown): void {
    // The next refresh renders a selection that failed once again. One that failed twice in a row waits for Retry or another selection, so the reader's timer cannot keep revealing its tab.
    if (this.failedSelectionKey !== selectionKey)
      this.lastSelectionKey = undefined
    this.failedSelectionKey = selectionKey
    this.report('reader', error)
  }

  /**
   * Finds the confirmed Study layout that a source reveal is about to distort because the editor area is hidden; called by {@link renderSelection} just before it shows the source.
   *
   * A recorded seek, a Recording press or an agent's selection made while the bottom panel is maximized still has to show its
   * source. The editor then brings the area back and, because the revealed group sat at its minimum height, expands that group:
   * the Application group stays a strip of its tab row and the Study pane shrinks to its minimum width, with the layout left unconfirmed.
   *
   * @param isPlacement - Whether a presentation placement or an arrangement owns the layout; it measures and confirms the grid itself.
   * @returns The Study layout receipt to apply again after the reveal, or `undefined` when the area is visible or no Study layout was arranged. The receipt of a layout that is no longer confirmed is returned too: {@link reapplyConfirmedLayout} then only undoes a collapsed Application group.
   * @example const confirmedLayout = await this.confirmedLayoutBehindHiddenArea(Boolean(placement))
   */
  private async confirmedLayoutBehindHiddenArea(
    isPlacement: boolean,
  ): Promise<StudyWorkspace['layoutReceipt']> {
    const receipt = this.layoutReceipt
    if (!this.isStudyLayoutExposedToReveal(isPlacement, receipt))
      return undefined
    return (await this.editorAreaHidden()) ? receipt : undefined
  }

  /**
   * Says whether a source reveal could distort an arranged Study layout that nothing else is about to measure; asked by {@link confirmedLayoutBehindHiddenArea} before it reads the editor's layout.
   * @param isPlacement - Whether a presentation placement owns the layout.
   * @param receipt - The layout receipt as it was read before the question.
   * @returns `true` when no placement and no arrangement in flight owns the layout and the receipt is that of a Study layout; `false` otherwise, also when no layout was arranged.
   * @example this.isStudyLayoutExposedToReveal(false, this.layoutReceipt) // => true on an arranged Study workspace at rest
   */
  private isStudyLayoutExposedToReveal(
    isPlacement: boolean,
    receipt: StudyWorkspace['layoutReceipt'],
  ): boolean {
    return !isPlacement && !this.arranging && receipt?.mode === 'study'
  }

  /**
   * Gives the Study panes the sizes of the confirmed layout back after a source reveal into a hidden editor area; called by {@link renderSelection}.
   * The measured grid is applied as it was confirmed, as Restore does after Enlarge; panes or groups that changed meanwhile are left alone.
   * A layout that was no longer confirmed before the reveal keeps the sizes it has, unless the returned editor area left the Application group at its minimum height beside a taller source group: that strip is the editor's doing, and the last confirmed grid undoes it.
   * {@link open} calls it too, for "Open Study Workspace" on an open reader: there only the collapsed Application group is repaired, whatever the confirmation says.
   * @param receipt - The layout that was arranged before the reveal.
   * @param onlyCollapsed - `true` to apply the grid only when the Application group sits at its minimum height beside a taller group.
   * @example if (confirmedLayout) await this.reapplyConfirmedLayout(confirmedLayout)
   */
  private async reapplyConfirmedLayout(
    receipt: NonNullable<StudyWorkspace['layoutReceipt']>,
    onlyCollapsed = false,
  ): Promise<void> {
    const reapplication = this.reapplicationOf(receipt, onlyCollapsed)
    if (reapplication === 'leave') return
    // The collapse of the owned Application group is read on its own: the other groups of an unconfirmed layout may have any size.
    if (
      reapplication === 'when-collapsed' &&
      !this.isApplicationGroupCollapsed(
        await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'),
        receipt,
      )
    )
      return
    await vscode.commands.executeCommand(
      'vscode.setEditorLayout',
      JSON.parse(receipt.signature),
    )
  }

  /**
   * Says whether a layout receipt still describes the editor: it is the reader's receipt, no arrangement is running, and the groups and the Study panes are where it recorded them; the first question of {@link reapplicationOf}.
   * @param receipt - The layout that was arranged before a source reveal.
   * @returns `true` when the receipt may be applied again; `false` when panes or groups changed meanwhile.
   * @example this.isLayoutStillArranged(receipt)
   */
  private isLayoutStillArranged(
    receipt: NonNullable<StudyWorkspace['layoutReceipt']>,
  ): boolean {
    return (
      receipt === this.layoutReceipt &&
      !this.arranging &&
      this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) &&
      this.sameStudyPanePositions(receipt.panes)
    )
  }

  /**
   * Says whether a reapplication only undoes a collapsed Application group instead of applying the grid unconditionally; the second question of {@link reapplicationOf}.
   * @param onlyCollapsed - What the caller of {@link reapplyConfirmedLayout} asked for.
   * @returns `true` when the caller asked for it or the layout is no longer confirmed.
   * @example this.repairsOnlyCollapsedGroup(false) // => true while the presentation is unconfirmed
   */
  private repairsOnlyCollapsedGroup(onlyCollapsed: boolean): boolean {
    return onlyCollapsed || !this.presentationConfirmed
  }

  /**
   * Decides, before any layout is read, what {@link reapplyConfirmedLayout} does with a receipt.
   * @param receipt - The layout that was arranged before a source reveal.
   * @param onlyCollapsed - `true` to apply the grid only when the Application group sits at its minimum height beside a taller group.
   * @returns
   * - `'leave'` when the receipt no longer describes the editor, or only a collapsed Application group is repaired and the receipt has no Application column
   * - `'apply'` when the confirmed grid is applied as it is
   * - `'when-collapsed'` when the editor's layout is read first and the grid is applied only for a collapsed Application group
   * @example const reapplication = this.reapplicationOf(receipt, false) // => 'apply' for a confirmed, unchanged layout
   */
  private reapplicationOf(
    receipt: NonNullable<StudyWorkspace['layoutReceipt']>,
    onlyCollapsed: boolean,
  ): 'leave' | 'apply' | 'when-collapsed' {
    if (!this.isLayoutStillArranged(receipt)) return 'leave'
    if (!this.repairsOnlyCollapsedGroup(onlyCollapsed)) return 'apply'
    return receipt.panes.appColumn === undefined ? 'leave' : 'when-collapsed'
  }

  /**
   * Says whether the Application group of a receipt is a strip of its tab row in the layout the editor just reported; asked by {@link reapplyConfirmedLayout} in the turn that layout arrived.
   * @param layout - The answer of `vscode.getEditorLayout`.
   * @param receipt - The layout receipt whose Application column is looked at.
   * @returns `true` when the receipt has an Application column and {@link isCollapsedEditorGroup} finds its group collapsed.
   * @example this.isApplicationGroupCollapsed(layout, receipt)
   */
  private isApplicationGroupCollapsed(
    layout: unknown,
    receipt: NonNullable<StudyWorkspace['layoutReceipt']>,
  ): boolean {
    return (
      receipt.panes.appColumn !== undefined &&
      isCollapsedEditorGroup(layout, receipt.panes.appColumn)
    )
  }

  /**
   * Says whether showing the captured source in a group would hide a text editor that has the keyboard, as far as the reader can know: the one the editor's debugger focused at a pause, or one the learner gave a sign of working in ({@link holdsKeyboardInActiveEditor}); called by {@link renderSelection} before it shows the source.
   *
   * At a breakpoint the editor opens the paused file in the active group and gives it the keyboard focus (`debug.focusEditorOnBreak`,
   * on by default). When that group is the source group, the captured source takes that file's place, and showing it while preserving
   * the focus hides the focused editor without focusing anything: the keyboard focus falls to the document body. The Application
   * pane's reveal follows the same rule for its own group ({@link BrowserViewport}).
   *
   * Where the learner went back to Cursor's chat after the pause and that chat is a tab of another editor part, the focus is not
   * taken: the editor then names the chat's group, or reports no active text editor. Where the chat is a side view (VS Code, and
   * Cursor while its Agent chat is a pane of the secondary side bar), the editor reports the paused file as the active text editor
   * in both cases, and the source takes the focus; {@link settleKeyboardAtPause} then says so once.
   *
   * @param column - The group the captured source is shown in.
   * @param source - The captured source; a group that shows it already loses no editor.
   * @returns `true` only while {@link holdsKeyboardInActiveEditor} holds (the frame of a stop is shown with `debug.focusEditorOnBreak` not turned off, or the learner gave a sign), the window is focused, and the group is the active group showing another text tab whose editor is the active text editor.
   * @example
   * ```ts
   * preserveFocus: preserveFocus && !this.replacesEditorFocusedByPause(targetColumn, document.uri)
   * ```
   */
  private replacesEditorFocusedByPause(
    column: vscode.ViewColumn,
    source: vscode.Uri,
  ): boolean {
    return (
      this.holdsKeyboardInActiveEditor() &&
      this.isFocusedGroupShowingOtherText(column, source) &&
      vscode.window.activeTextEditor?.viewColumn === column
    )
  }

  /**
   * Tells the learner that one of the reader's panes took the keyboard from a text editor, with the sentence that fits why that editor had it; called by {@link settleKeyboardAtPause} when the captured source took it, and through the viewport's lease ({@link presentation}) when the Application pane did.
   * @example tookKeyboardFromEditor: () => this.tellPaneTookKeyboard()
   */
  private tellPaneTookKeyboard(): void {
    // The debugger gave the paused file the keyboard: the learner may have been typing somewhere else. Otherwise the learner worked in that file.
    if (this.debuggerGaveEditorKeyboard()) this.tellPaneTookPausedFocus()
    else this.tellPaneTookChosenEditor()
  }

  /**
   * Tells the learner, once in an editor session, that one of the reader's panes came to the front over the file the learner was working in and has the keyboard now; the half of {@link tellPaneTookKeyboard} for an editor the debugger did not give the keyboard.
   * The pane took the keyboard because a hidden editor cannot keep it: it would be on no element. The learner did nothing to move it, so the sentence says where it is.
   * @returns Once the notification is shown, or at once after the first time.
   * @example this.tellPaneTookChosenEditor()
   */
  private tellPaneTookChosenEditor(): void {
    if (keyboardNoticesTold.has('chosen')) return
    keyboardNoticesTold.add('chosen')
    void showPlainNotice(
      vscode.window,
      'information',
      PANE_TOOK_CHOSEN_EDITOR_FOCUS_MESSAGE,
    )
  }

  /**
   * Tells the learner, once in an editor session, that one of the reader's panes took the keyboard from the file the debugger opened at a pause; the half of {@link tellPaneTookKeyboard} for a file the debugger gave the keyboard, when the reader knew of no chat to give it back to.
   * Where the chat is a side view (VS Code, and Cursor while its Agent chat is a pane of the secondary side bar) the extension API reads the same whether the keyboard was in the paused file or in the chat input, so the keyboard cannot be given back to the chat without taking it from a learner who works in a file; the sentence says where it is and what to do.
   * @returns Once the notification is shown, or at once after the first time.
   * @example if (this.debuggerGaveEditorKeyboard()) this.tellPaneTookPausedFocus()
   */
  private tellPaneTookPausedFocus(): void {
    if (keyboardNoticesTold.has('pause')) return
    keyboardNoticesTold.add('pause')
    void showPlainNotice(
      vscode.window,
      'information',
      SOURCE_TOOK_PAUSED_FOCUS_MESSAGE,
    )
  }

  /**
   * Says whether a tab input is a text tab of another document than the captured source; asked by {@link isFocusedGroupShowingOtherText} about the active group's tab.
   * @param shown - The input of the group's active tab, `undefined` for an empty group.
   * @param source - The captured source.
   * @returns `true` for a text tab of another document; `false` for the source itself, another kind of tab, or no tab.
   * @example this.isTextInputOtherThan(vscode.window.tabGroups.activeTabGroup.activeTab?.input, document.uri)
   */
  private isTextInputOtherThan(shown: unknown, source: vscode.Uri): boolean {
    return (
      shown instanceof vscode.TabInputText &&
      shown.uri.toString() !== source.toString()
    )
  }

  /**
   * Says whether the focused window's active group is the one the captured source is shown in and shows another text tab there; the first half of {@link replacesEditorFocusedByPause}.
   * @param column - The group the captured source is shown in.
   * @param source - The captured source.
   * @returns `true` when the window is focused, the active group is at `column` and {@link isTextInputOtherThan} holds for its active tab.
   * @example this.isFocusedGroupShowingOtherText(targetColumn, document.uri)
   */
  private isFocusedGroupShowingOtherText(
    column: vscode.ViewColumn,
    source: vscode.Uri,
  ): boolean {
    const group = vscode.window.tabGroups.activeTabGroup,
      shown = group.activeTab?.input
    return (
      vscode.window.state.focused &&
      group.viewColumn === column &&
      this.isTextInputOtherThan(shown, source)
    )
  }

  /** Confirms the selected immutable source reached an active native tab before control or MCP reveal succeeds. @example this.sourceReady() */
  private sourceReady(): boolean {
    return (
      this.opened &&
      !this.closing &&
      !this.loading &&
      this.sourceRevision === this.revision &&
      vscode.window.tabGroups.all.some(
        (group) =>
          group.activeTab?.input instanceof vscode.TabInputText &&
          group.activeTab.input.uri.toString() === this.sourceUri?.toString(),
      )
    )
  }

  /**
   * Updates the Application pane only when the selected phase's bytes or mode change, preserving a historical panel across live ticks; {@link renderSelection} calls it for every render and refresh outside a recording.
   *
   * A followed live run is shown through its viewport lease, a selected capture as its page in the pane. When the learner closed the
   * pane of the followed run, its lease is released for good and the run ended with it: nothing is asked of that lease, and the reader
   * keeps one line that says so and what to do next until a pane exists again.
   *
   * @param message - The Study message of the selection to show.
   * @example this.presentApplication(message)
   */
  private presentApplication(message: StudyViewMessage): void {
    if (this.recordingActive) return
    const image = message.model.image
    const key = JSON.stringify([
      this.leaseId,
      message.nodeHistory?.header.studyId,
      message.model.selection,
      message.study?.terminal,
      message.loading,
      image?.status,
      image?.status === 'captured' ? image.hash : image?.reason,
    ])
    if (key === this.lastApplicationKey) return
    this.lastApplicationKey = key
    if (
      !message.nodeHistory &&
      message.model.selection.follow &&
      !message.study?.terminal &&
      this.viewport
    ) {
      // The run's Application pane was closed: its released lease can show nothing, and a refusal reported from it would vanish at the render's end.
      if (!this.app) {
        this.report('application', new Error(APPLICATION_PANE_CLOSED_MESSAGE))
        return
      }
      const leaseId = this.leaseId,
        revision = this.revision
      void this.viewport
        .showLive(new AbortController().signal)
        .catch((error) => {
          if (
            leaseId === this.leaseId &&
            revision === this.revision &&
            !this.closing
          )
            this.report('reader', error)
        })
    } else if (this.app) {
      const html = capturedAppHtml(message)
      if (this.viewport) this.viewport.showHistory(html)
      else this.app.webview.html = html
    }
  }

  /** Retains new app placement for {@link open}, including panels created earlier by an MCP-first runtime. @example this.ensureApp() */
  private ensureApp(): vscode.WebviewPanel {
    if (this.app) return this.app
    const owned = (tab: vscode.Tab) =>
      this.isCodebookPaneInput(tab.input, 'codebook.scopedBrowser')
    const contents = (group: vscode.TabGroup) =>
      JSON.stringify(
        group.tabs
          .filter((tab) => !owned(tab))
          .map((tab) => [
            tab.label,
            tab.input,
            tab.isDirty,
            tab.isPreview,
            tab.isPinned,
          ]),
      )
    const previous = vscode.window.tabGroups.all.map((group) => ({
      column: group.viewColumn,
      contents: contents(group),
    }))
    const focusedGroup = vscode.window.tabGroups.activeTabGroup,
      focusedColumn = focusedGroup.viewColumn,
      focusedTab = focusedGroup.activeTab
    const focusedEditor = vscode.window.activeTextEditor,
      focusedSource = focusedEditor?.document.uri.toString(),
      focusedSourceColumn = focusedEditor?.viewColumn
    const focusedGroupIdentity = this.editorGroupIdentities.get(focusedGroup)
    const focusedWebview =
      focusedTab?.input instanceof vscode.TabInputWebview
        ? focusedTab.input.viewType
        : undefined
    let focusedWebviewClosed = false,
      learnerTabVisited = false
    const openedGroups: vscode.TabGroup[] = [],
      closedGroups: vscode.TabGroup[] = []
    /**
     * Says whether the tab the editor named before the registration is neither a webview nor a text tab: the tab of another editor part (Cursor's chat), or none; the first condition of {@link namesFocusedEditorGroup}.
     * @returns `true` when the named tab is neither, `false` for a webview or a text tab.
     * @example namedTabOfAnotherPart() // => true while Cursor names the chat's group
     */
    const namedTabOfAnotherPart = (): boolean =>
      focusedWebview === undefined &&
      !(focusedTab?.input instanceof vscode.TabInputText)
    /**
     * Says whether the editor has corrected a stale name: Cursor names another editor part's group (the chat's) while a text editor of the main editor has the keyboard, and the next tab change names that editor's group instead. That is no choice of the learner. Asked by {@link isCorrectedName}.
     * @param active - The group the editor names as active now.
     * @returns `true` when the editor named another part's group before and now names the group of the text editor that had the keyboard.
     * @example namesFocusedEditorGroup(vscode.window.tabGroups.activeTabGroup)
     */
    const namesFocusedEditorGroup = (active: vscode.TabGroup): boolean =>
      namedTabOfAnotherPart() &&
      focusedSourceColumn !== undefined &&
      focusedSourceColumn !== focusedColumn &&
      active.viewColumn === focusedSourceColumn
    /**
     * Says whether a newly named tab is only the editor's corrected name for the text editor that had the keyboard; asked by {@link isLearnerChoice}.
     * @param active - The group the editor names as active now.
     * @param selected - The tab that group shows.
     * @returns `true` when {@link namesFocusedEditorGroup} holds and `selected` is the text tab of the document that had the keyboard.
     * @example isCorrectedName(active, selected)
     */
    const isCorrectedName = (
      active: vscode.TabGroup,
      selected: vscode.Tab,
    ): boolean =>
      namesFocusedEditorGroup(active) &&
      selected.input instanceof vscode.TabInputText &&
      selected.input.uri.toString() === focusedSource
    /**
     * Says whether the tab that was named before the registration is still open, or none was named; asked by {@link isLearnerChoice}.
     * @returns `true` when no tab was named or a group still holds that tab.
     * @example isFocusedTabStillOpen()
     */
    const isFocusedTabStillOpen = (): boolean =>
      !focusedTab ||
      vscode.window.tabGroups.all.some((group) =>
        group.tabs.includes(focusedTab),
      )
    /**
     * Says whether the tab the editor names now is a choice of the learner; asked by {@link noticeLearnerTab} for every tab or group change during the registration.
     * @param active - The group the editor names as active now.
     * @param selected - The tab that group shows.
     * @returns `true` for a tab other than the one named before that is not Codebook's Application, is not a corrected name, and was chosen while the tab named before is still open.
     * @example if (selected && isLearnerChoice(active, selected)) learnerTabVisited = true
     */
    const isLearnerChoice = (
      active: vscode.TabGroup,
      selected: vscode.Tab,
    ): boolean =>
      selected !== focusedTab &&
      !owned(selected) &&
      !isCorrectedName(active, selected) &&
      isFocusedTabStillOpen()
    /** Records a newer tab choice during app registration so {@link open} cannot claim a focus roundtrip. @example noticeLearnerTab() */
    const noticeLearnerTab = (): void => {
      const active = vscode.window.tabGroups.activeTabGroup,
        selected = active.activeTab
      // Codebook may select its new Application; another retained tab is a learner decision even after a roundtrip.
      if (selected && isLearnerChoice(active, selected))
        learnerTabVisited = true
    }
    const changes = [
      vscode.window.tabGroups.onDidChangeTabGroups((event) => {
        openedGroups.push(...event.opened)
        closedGroups.push(...event.closed)
        noticeLearnerTab()
        this.confirmInitialAppRegistration()
      }),
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        // A close/open replacement cannot inherit the original webview's authority through its view type.
        focusedWebviewClosed ||=
          focusedWebview !== undefined &&
          event.closed.some(
            (tab) =>
              tab.input instanceof vscode.TabInputWebview &&
              tab.input.viewType === focusedWebview,
          )
        noticeLearnerTab()
        this.confirmInitialAppRegistration()
      }),
    ]
    let panel: vscode.WebviewPanel
    // An earlier host's panes are remembered before this host's own pane makes their view type ambiguous.
    this.rememberInheritedPanes()
    try {
      panel = vscode.window.createWebviewPanel(
        'codebook.scopedBrowser',
        'codebook · Application',
        {
          viewColumn: STUDY_PRESENTATIONS[this.presentationMode].appColumn,
          preserveFocus: true,
        },
        {
          enableScripts: true,
          localResourceRoots: [],
          retainContextWhenHidden: true,
        },
      )
    } catch (error) {
      // No panel disposal event can release registration observers when native creation itself fails.
      for (const change of changes) change.dispose()
      throw error
    }
    this.bindApplicationPanel(panel)
    // MCP can create the app before Open reserves its destination; retain that unfinished placement across callers.
    this.initialAppPlacement = {
      panel,
      column: panel.viewColumn,
      registration: {
        dispose: (): void => {
          for (const change of changes) change.dispose()
        },
        ready: () => {
          const current = vscode.window.tabGroups.all,
            appGroups = current.filter((group) => group.tabs.some(owned))
          const appGroup = appGroups.length === 1 ? appGroups[0] : undefined
          const extra = current.filter(
            (group) =>
              !previous.some((entry) => entry.column === group.viewColumn),
          )
          // Only the newly requested app may add a group; closed/replaced groups and foreign tab changes retire creation ownership.
          const retained =
            !focusedWebviewClosed &&
            !learnerTabVisited &&
            previous.every((entry) =>
              current.some(
                (group) =>
                  group.viewColumn === entry.column &&
                  contents(group) === entry.contents,
              ),
            ) &&
            extra.every(
              (group) => group === appGroup && contents(group) === '[]',
            ) &&
            !closedGroups.length &&
            openedGroups.every(
              (group) =>
                !previous.some((entry) => entry.column === group.viewColumn) &&
                group.viewColumn === appGroup?.viewColumn,
            )
          const active = vscode.window.tabGroups.activeTabGroup,
            currentSource =
              vscode.window.activeTextEditor?.document.uri.toString()
          // Native Wiki focus can survive when covering its background source clears VS Code's last text editor.
          const sameWebviewTab =
            active.activeTab === focusedTab ||
            Boolean(
              active !== focusedGroup &&
              focusedGroupIdentity &&
              focusedGroupIdentity === this.editorGroupIdentities.get(active) &&
              active.activeTab?.input instanceof vscode.TabInputWebview &&
              active.activeTab.input.viewType === focusedWebview &&
              focusedGroup.tabs.filter(
                (tab) =>
                  tab.input instanceof vscode.TabInputWebview &&
                  tab.input.viewType === focusedWebview,
              ).length === 1 &&
              active.tabs.filter(
                (tab) =>
                  tab.input instanceof vscode.TabInputWebview &&
                  tab.input.viewType === focusedWebview,
              ).length === 1,
            )
          // A webview chat in the same group may be covered by the requested Application without learner navigation.
          const coveredFocusedWebview =
            active === focusedGroup &&
            active === appGroup &&
            active.activeTab &&
            owned(active.activeTab) &&
            panel.active &&
            currentSource === focusedSource
          const coveredBackgroundSource =
            currentSource === undefined &&
            focusedSourceColumn !== undefined &&
            focusedSourceColumn ===
              (appGroup?.viewColumn ?? panel.viewColumn) &&
            focusedSourceColumn !== focusedColumn
          // The corrected name shows the group of the editor that had the keyboard, with that editor or the new pane that covers it.
          const sameFocusUnderCorrectedName =
            namesFocusedEditorGroup(active) &&
            (currentSource === focusedSource ||
              (currentSource === undefined &&
                active === appGroup &&
                Boolean(active.activeTab && owned(active.activeTab))))
          const sameFocus =
            sameFocusUnderCorrectedName ||
            (active.viewColumn === focusedColumn &&
              (focusedWebview !== undefined
                ? (sameWebviewTab &&
                    (currentSource === focusedSource ||
                      coveredBackgroundSource)) ||
                  coveredFocusedWebview
                : currentSource === focusedSource ||
                  (active === appGroup &&
                    active.activeTab &&
                    owned(active.activeTab) &&
                    panel.active &&
                    currentSource === undefined)))
          if (!retained || !sameFocus)
            throw new Error(
              'Native panes or learner focus changed while the new application registered; the arrangement was preserved.',
            )
          // Wrapper flags are optimistic: await the actual tab, column and text-focus acknowledgement before passive layout guards.
          return Boolean(
            appGroup &&
            appGroup.activeTab &&
            owned(appGroup.activeTab) &&
            panel.viewColumn === appGroup.viewColumn &&
            panel.visible &&
            // Native Application focus may retain the host's unchanged last text editor in this or another group.
            (active !== appGroup ||
              !vscode.window.activeTextEditor ||
              this.retainsApplicationSourceReceipt(
                focusedSource,
                focusedSourceColumn,
              )),
          )
        },
      },
    }
    panel.onDidDispose(() => {
      for (const change of changes) change.dispose()
    })
    this.confirmInitialAppRegistration()
    return panel
  }

  /** Binds the current application owner for cold entry or handoff; retired pane events cannot control replay. @example this.bindApplicationPanel(replacement) */
  private bindApplicationPanel(panel: vscode.WebviewPanel): void {
    this.app = panel
    this.lastApplicationKey = undefined
    // A pane exists again, so the line about the closed one no longer describes the reader.
    if (this.errors.delete('application')) this.publish()
    panel.onDidDispose(() => {
      if (this.app !== panel) return
      this.presentationTransition?.cancellation.abort(
        new Error('The current application pane was closed.'),
      )
      this.app = undefined
      this.replayApplicationCovered = false
      // A renderer created for the next pane performs its own first reveal, so a reveal owed to this pane is dropped with it.
      this.dropReplayViewport()
      if (this.recordingActive) this.playback?.hide()
    })
    let visible = panel.visible
    panel.onDidChangeViewState(() => {
      if (this.app !== panel) return
      // The pane's active flag is one of the readings of the chat's record, and the editor reports it on this channel.
      this.sampleKeyboardOutsideEditors()
      this.confirmInitialAppRegistration()
      if (panel.active) this.lastActiveRegion = 'app'
      if (visible === panel.visible) return
      visible = panel.visible
      this.followReplaySurfaceVisibility(panel, visible)
    })
  }

  /**
   * Pauses or resumes a recording's replay when its Application pane became hidden or visible; called by the view-state listener of {@link bindApplicationPanel} for each change of the pane's visibility.
   * Nothing happens outside a recording or while Codebook itself places the presentation.
   * @param panel - The Application pane that reported the change.
   * @param isVisible - Whether the pane is visible now.
   * @example this.followReplaySurfaceVisibility(panel, panel.visible)
   */
  private followReplaySurfaceVisibility(
    panel: vscode.WebviewPanel,
    isVisible: boolean,
  ): void {
    // Only visibility of the replay surface pauses playback; runtime/debugger exit is unrelated.
    if (!this.recordingActive || this.placingPresentation) return
    this.replayNeedsReveal = true
    // A tab the learner opened over the pane hides a moment that is recorded; the retired moment is labelled as covered, not as missing.
    this.replayApplicationCovered =
      !isVisible && this.isApplicationCoveredByTab(panel)
    this.revealOrHidePlayback(isVisible)
  }

  /**
   * Tells the playback that its surface is visible again or hidden; the last step of {@link followReplaySurfaceVisibility}.
   * @param isVisible - Whether the Application pane is visible now.
   * @example this.revealOrHidePlayback(false) // the playback pauses at its position
   */
  private revealOrHidePlayback(isVisible: boolean): void {
    if (isVisible) this.playback?.reveal()
    else this.playback?.hide()
  }

  /**
   * Tells whether another tab of the Application pane's group is in front of the pane; {@link bindApplicationPanel}'s view-state handler asks when a recording's pane stops being visible.
   * A pane hidden together with its whole editor area (a maximized bottom panel) is still its group's active tab and is not covered.
   * @param panel - The Application pane that reported the change.
   * @returns `true` when the pane's group shows another tab, `false` when the pane is that group's active tab or the group is gone.
   * @example this.isApplicationCoveredByTab(panel) // => true after the learner opened a workspace file in the Application group
   */
  private isApplicationCoveredByTab(panel: vscode.WebviewPanel): boolean {
    const activeTab = vscode.window.tabGroups.all.find(
      (group) => group.viewColumn === panel.viewColumn,
    )?.activeTab
    return Boolean(
      activeTab &&
      !this.isCodebookPaneInput(activeTab.input, 'codebook.scopedBrowser'),
    )
  }

  /**
   * Recognizes the host's unchanged text-editor receipt beside a registered Application; {@link ensureApp} asks before waiting for a source-clear event that VS Code may never send.
   * @param sourceUri - The text-editor URI captured before creating the Application, independently of the active tab.
   * @param sourceColumn - That receipt's original group, including a background editor group.
   * @returns Whether the current reported text editor still has both original identities.
   * @example this.retainsApplicationSourceReceipt('file:///repo/auth.ts', 2) // => true while that receipt is retained
   */
  private retainsApplicationSourceReceipt(
    sourceUri: string | undefined,
    sourceColumn: number | undefined,
  ): boolean {
    const editor = vscode.window.activeTextEditor
    return (
      sourceColumn !== undefined &&
      editor?.viewColumn === sourceColumn &&
      editor.document.uri.toString() === sourceUri
    )
  }

  /** Finishes the owned creation receipt on native events so later MCP-first learner moves remain manual. @example this.confirmInitialAppRegistration() */
  private confirmInitialAppRegistration(): void {
    const placement = this.initialAppPlacement,
      registration = placement?.registration
    if (!placement || !registration || registration.error) return
    try {
      if (!registration.ready()) return
      registration.dispose()
      placement.registration = undefined
      placement.column = placement.panel.viewColumn
    } catch (error) {
      registration.error = error
      registration.dispose()
    }
  }

  /** Drains owned app creation for {@link open} before passive layout reads, retaining cancellation and learner-change checks. @example await this.settleInitialApp(signal, lifetime) */
  private async settleInitialApp(
    signal: AbortSignal | undefined,
    lifetime: number,
  ): Promise<void> {
    const placement = this.initialAppPlacement,
      registration = placement?.registration
    if (!placement || !registration) return
    await waitUntil(
      () => {
        this.assertLifetime(lifetime)
        this.confirmInitialAppRegistration()
        if (registration.error) {
          this.initialAppPlacement = undefined
          throw registration.error
        }
        return !placement.registration
      },
      'new application native registration',
      PRESENTATION_READY_TIMEOUT_MS,
      signal,
    )
    this.assertLifetime(lifetime)
    signal?.throwIfAborted()
  }

  /** Creates context controls without embedding executable runtime data into HTML. @example this.ensureContext() */
  private ensureContext(): void {
    const title = this.recordingActive ? 'Learning summary' : 'codebook · Study'
    if (this.contextPanel) {
      this.contextPanel.title = title
      return
    }
    this.rememberInheritedPanes()
    const contextColumn =
      STUDY_PRESENTATIONS[this.presentationMode].contextColumn
    this.noteCurrentContextCreation(contextColumn)
    const panel = vscode.window.createWebviewPanel(
      'codebook.studyContext',
      title,
      {
        viewColumn: contextColumn,
        preserveFocus: true,
      },
      {
        enableScripts: true,
        localResourceRoots: [],
        retainContextWhenHidden: true,
      },
    )
    this.bindContextPanel(panel)
  }

  /**
   * Probes the current destination synchronously beside {@link ensureContext}'s native creation, preserving actual reservation identity and rejecting newer learner groups.
   * @param contextColumn - The Context destination this immediate creation will request.
   * @example this.noteCurrentContextCreation(contextColumn)
   */
  private noteCurrentContextCreation(contextColumn: vscode.ViewColumn): void {
    // Inspect the actual current model beside panel creation; a stale first-Open group count cannot authorize retiring a learner's newer group.
    const destination = vscode.window.tabGroups.all.find(
      (group) => group.viewColumn === contextColumn,
    )
    if (!destination) this.pendingCreatedContextColumn = contextColumn
    // An actual reservation can have created this still-empty main group before Context exists; keep only that same group identity's pending receipt.
    else if (!this.isPendingContextGroup(destination))
      this.clearPendingContextCreation()
  }

  /** Binds a fresh explanation document for cold entry or handoff without accepting retired controls or receipts. @example this.bindContextPanel(replacement) */
  private bindContextPanel(panel: vscode.WebviewPanel): void {
    this.contextPanel = panel
    this.bindPendingContextCreation()
    this.studyPaneReportsKeyboard = false
    this.lastPublished = undefined
    this.lastRendered = undefined
    panel.onDidDispose(() => {
      if (this.contextPanel !== panel) return
      this.presentationTransition?.cancellation.abort(
        new Error('The current explanation pane was closed.'),
      )
      this.contextPanel = undefined
      this.clearPendingContextCreation()
    })
    panel.onDidChangeViewState(() => {
      if (this.contextPanel !== panel) return
      this.bindPendingContextCreation()
      // The pane's active flag is one of the readings of the chat's record, and the editor reports it on this channel.
      this.sampleKeyboardOutsideEditors()
      if (!panel.active) return
      this.lastActiveRegion = 'context'
      void this.refreshProgress().then(() => {
        if (this.contextPanel === panel) this.publish()
      })
    })
    panel.webview.onDidReceiveMessage((message) => {
      void this.receivePaneMessage(message, 'context', panel).catch((error) => {
        if (this.contextPanel === panel)
          this.report(this.panelFailureKind(message), error)
      })
    })
    panel.webview.html = studyHtml('context')
  }

  /** Opens the replay summary beside native chat without modifying either editor content; commands and recording entry call it. @example await workspace.showLearningSummary() */
  async showLearningSummary(
    signal?: AbortSignal,
    revealPlayback = false,
  ): Promise<void> {
    if (!this.recordingActive || !this.summaryComposition || this.closing)
      throw new StudyError(
        'EVIDENCE_UNAVAILABLE',
        'Open saved learning before showing its summary.',
      )
    if (!vscode.window.state.focused)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Focus the Codebook work window before reading the learning summary.',
      )
    const lifetime = this.lifetime,
      studyId = this.selection.studyId
    let lostFocus = false
    // A window round trip cannot renew the earlier focus request.
    const focusSubscription = vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) lostFocus = true
    })
    const assertCurrent = (): void => {
      this.assertLifetime(lifetime)
      signal?.throwIfAborted()
      if (lostFocus || !vscode.window.state.focused)
        throw new StudyError(
          'PRESENTATION_UNAVAILABLE',
          'The Codebook work window lost focus while opening its learning summary.',
        )
      if (
        !this.recordingActive ||
        studyId !== this.selection.studyId ||
        !this.summaryComposition
      )
        throw new StudyError(
          'STALE_PRESENTATION',
          'The selected learning changed while opening its summary.',
        )
    }
    try {
      assertCurrent()
      // Only explicit replay entry reveals the bottom controls; passive ticks never reopen a closed panel.
      if (revealPlayback) {
        await vscode.commands.executeCommand('codebook.observedMoments.focus')
        assertCurrent()
      }
      await vscode.commands.executeCommand('codebook.learningSummary.focus')
      assertCurrent()
      await waitUntil(
        () => {
          assertCurrent()
          return Boolean(this.summaryView?.visible)
        },
        'learning summary sidebar',
        PRESENTATION_READY_TIMEOUT_MS,
        signal,
      )
      assertCurrent()
      if (this.summaryView && !this.summaryDocumentActive) {
        this.summaryDocumentActive = true
        this.summaryView.webview.html = studyHtml('context')
      }
      this.lastActiveRegion = 'context'
      this.lastPublished = undefined
      this.publish()
      this.offerSummaryPlacement('summary-shown')
    } finally {
      focusSubscription.dispose()
    }
  }

  /**
   * Tells whether the editor is Cursor, where the Learning summary shares the primary side bar with Run and Debug; {@link installReaders} turns the Move Learning Summary… control on and {@link offerSummaryPlacement} acts only there.
   * @returns `true` in Cursor, `false` in VS Code and in a host that does not name itself.
   * @example this.isCursorHost() // => true in Cursor 3.23
   */
  private isCursorHost(): boolean {
    return vscode.env?.appName?.toLowerCase().includes('cursor') ?? false
  }

  /**
   * Offers Cursor's learner the editor's own Move View step in a notification; {@link showLearningSummary} and {@link showNativeVariables} call it.
   *
   * Cursor rejects the `secondarySidebar` container this extension contributes, so the summary lands in the primary side bar
   * there, and its own chat containers refuse added views: no command of this extension can place the summary on the right.
   * VS Code registers the container, so nothing is offered there.
   *
   * Each occasion is offered at most once per editor session. Only the pressed button is an answer: Cursor removes an unanswered
   * notification by itself, so nothing is stored for it and the offer returns in the next editor session.
   *
   * @param occasion - `'summary-shown'` after the summary opened, offered until the learner took the step in this workspace; `'summary-displaced'` after Show Variables put Run and Debug in the summary's place, offered also when the step was taken before, because the summary then shares the side bar again.
   * @example this.offerSummaryPlacement('summary-shown')
   */
  private offerSummaryPlacement(occasion: SummaryPlacementOccasion): void {
    if (!this.isSummaryPlacementOfferDue(occasion)) return
    this.summaryPlacementOffersMade.add(occasion)
    void (async (): Promise<void> => {
      const choice = await showPlainNotice(
        vscode.window,
        'information',
        SUMMARY_PLACEMENT_OFFER_TEXTS[occasion],
        SUMMARY_PLACEMENT_ACTION,
      )
      if (choice === SUMMARY_PLACEMENT_ACTION) await this.moveLearningSummary()
    })().catch((error: unknown) => this.report('layout', error))
  }

  /**
   * Decides for {@link offerSummaryPlacement} whether an occasion's offer is still to be made in this editor session.
   * @param occasion - The occasion the offer would be made for.
   * @returns `false` outside Cursor, after the same occasion's offer in this session, and for a shown summary once the learner took the step in this workspace; otherwise `true`.
   * @example this.isSummaryPlacementOfferDue('summary-displaced') // => true at the first Show Variables of a Cursor session that hid the summary
   */
  private isSummaryPlacementOfferDue(
    occasion: SummaryPlacementOccasion,
  ): boolean {
    if (!this.isCursorHost() || this.summaryPlacementOffersMade.has(occasion))
      return false
    // A displaced summary shares the side bar again, whatever was answered before.
    return (
      occasion === 'summary-displaced' ||
      !this.context.workspaceState.get<boolean>(SUMMARY_PLACEMENT_ANSWERED_KEY)
    )
  }

  /**
   * Opens the editor's own Move View list for the Learning summary and remembers that the learner took the step; the command "Codebook: Move Learning Summary…" (the summary's title action in Cursor) and the button of {@link offerSummaryPlacement} call it.
   * @throws Whatever the workspace state or the editor's Move View command rejects with.
   * @example await workspace.moveLearningSummary()
   */
  async moveLearningSummary(): Promise<void> {
    await this.context.workspaceState.update(
      SUMMARY_PLACEMENT_ANSWERED_KEY,
      true,
    )
    // The editor's Move View list opens for the summary itself; the learner picks its destination there.
    await vscode.commands.executeCommand(
      'workbench.action.moveFocusedView',
      'codebook.learningSummary',
    )
  }

  /**
   * Shows the recorded values in the host's own Variables view; called by {@link action} for the reader's Show Variables control.
   *
   * A host may not register a command (neither VS Code 1.140 nor Cursor 3.23 has a `workbench.debug.variablesView.focus`), and running a missing one
   * leaves "command … not found" in the reader, so the host is asked which commands exist before any of them runs.
   *
   * The list commands act on the rows of the focused list, and Variables has none of the presented stop right after it took the focus:
   * a view that was hidden while the stop changed asks for the stop's scopes only in its deferred refresh (which then expands the first
   * scope itself), and a view opened for the first time needs a moment to fill its tree. So they run only after
   * {@link ReplayDebugger.awaitRetrieval} saw those scopes asked for and the values not arrive by themselves; every wait is bounded.
   * Each attempt focuses Variables again directly before its list commands, so a list the learner clicked during a wait is left alone.
   *
   * In Cursor, where the summary shares its side bar with Run and Debug, a press that put Run and Debug in the summary's place makes
   * the Move View offer of {@link offerSummaryPlacement}.
   *
   * @returns Resolves once Variables listed the recorded values or the list commands the host registers ran their bounded attempts, or its Run and Debug view opened, or the learner was told the manual step.
   * @throws Whatever a command the host does register throws.
   * @example await this.showNativeVariables()
   */
  private async showNativeVariables(): Promise<void> {
    const hostCommands = new Set(await vscode.commands.getCommands(true))
    const [focusVariablesCommand, ...listCommands] =
      SHOW_NATIVE_VARIABLES_COMMANDS
    if (hostCommands.has(focusVariablesCommand)) {
      const wasSummaryVisible = Boolean(this.summaryView?.visible)
      await vscode.commands.executeCommand(focusVariablesCommand)
      // In Cursor the summary shares its side bar with Run and Debug, which the focus command just put in its place; the learner is told how to keep both.
      if (wasSummaryVisible && !this.summaryView?.visible)
        this.offerSummaryPlacement('summary-displaced')
      const debuggerView = this.replayDebugger
      // Until Variables asked for this stop's scopes its tree holds no row of it; the bound covers a view that never asks.
      await debuggerView?.awaitRetrieval(
        'scopes',
        SHOW_NATIVE_VARIABLES_SCOPES_TIMEOUT_MS,
      )
      for (
        let attempt = 1;
        attempt <= SHOW_NATIVE_VARIABLES_EXPAND_ATTEMPTS;
        attempt++
      ) {
        // A refreshed view expands the first scope itself; the same wait lets a view that just opened fill its tree.
        const valuesListed = await debuggerView?.awaitRetrieval(
          'values',
          SHOW_NATIVE_VARIABLES_VALUES_WAIT_MS,
        )
        // A reader closed during the wait must not move the focus of whatever list the learner went on to.
        if (valuesListed || this.closing || this.disposed) return
        // The list commands act on whichever list holds the focus, and the learner may have clicked into another one during the waits: Variables gets the focus back first.
        await vscode.commands.executeCommand(focusVariablesCommand)
        for (const command of listCommands)
          if (hostCommands.has(command))
            await vscode.commands.executeCommand(command)
        // Without a historical session that can report the values, a second attempt has nothing to wait for.
        if (!debuggerView?.available) return
      }
      return
    }
    // Run and Debug is the nearest place this host can open; the reader's hint names the step that remains.
    if (hostCommands.has(NATIVE_RUN_AND_DEBUG_VIEW_COMMAND)) {
      await vscode.commands.executeCommand(NATIVE_RUN_AND_DEBUG_VIEW_COMMAND)
      return
    }
    // Nothing to run: one sentence instead of a failed command.
    void showPlainNotice(
      vscode.window,
      'information',
      SHOW_NATIVE_VARIABLES_MANUAL_STEP,
    )
  }

  /**
   * Gives the keyboard focus to the active editor group when the Learning summary's view was hidden while its document held the focus; called by that view's visibility listener.
   * Cursor leaves the focus in the hidden webview when its side bar is closed, so no visible element has it; VS Code moves it to the editor itself, where the command changes nothing.
   * A summary whose document last reported that it lost the focus (the learner went on to a chat, a terminal or Run and Debug) is left alone, and so is one that Show Variables hid: there Run and Debug holds the focus on purpose.
   * The document's report that it lost the focus can arrive after the view was hidden (the learner opened another view in the summary's place), so the move waits {@link SUMMARY_FOCUS_RELEASE_WAIT_MS} for it and is dropped when it comes.
   * @example this.releaseHiddenSummaryFocus()
   */
  private releaseHiddenSummaryFocus(): void {
    if (!this.summaryHeldFocus || this.isShowingNativeVariables) return
    clearTimeout(this.summaryFocusRelease)
    this.summaryFocusRelease = setTimeout(() => {
      // The document reported inside the bound that it lost the focus, the summary is shown again, or the reader is closing: the focus is where the learner put it.
      if (
        !this.summaryHeldFocus ||
        this.summaryView?.visible ||
        this.closing ||
        this.disposed
      )
        return
      this.summaryHeldFocus = false
      void vscode.commands
        .executeCommand('workbench.action.focusActiveEditorGroup')
        .then(undefined, (error) => this.report('reader', error))
    }, SUMMARY_FOCUS_RELEASE_WAIT_MS)
  }

  /** Withdraws replay controls on explicit departure or close while leaving the native sidebar and other chat containers intact. @example this.clearLearningSummary() */
  private clearLearningSummary(): void {
    this.summaryDocumentActive = false
    // The document that reported the focus is replaced; its successor reports for itself.
    this.summaryHeldFocus = false
    clearTimeout(this.summaryFocusRelease)
    this.lastRendered = undefined
    if (this.summaryView)
      this.summaryView.webview.html =
        '<!DOCTYPE html><html><body><p>Open saved learning from Codebook to view its summary.</p></body></html>'
  }

  /**
   * Says whether a Learning summary view is still the reader's and is shown, or hidden, as asked; the visibility listener {@link installReaders} gives each summary view asks it twice, before and after it publishes.
   * @param view - The summary view whose visibility changed.
   * @param isVisible - The visibility to ask for.
   * @returns `true` when `view` is the reader's summary view and its visibility is `isVisible`; `false` for a replaced view.
   * @example if (this.isSummaryViewInState(view, false)) this.releaseHiddenSummaryFocus()
   */
  private isSummaryViewInState(
    view: vscode.WebviewView,
    isVisible: boolean,
  ): boolean {
    return this.summaryView === view && Boolean(view.visible) === isVisible
  }

  /**
   * Says whether the text editor that became active shows a file of the running application while the reader is open: the editor's debugger opened it over the captured source. Asked by the active-editor listener of {@link installReaders}.
   * @param editor - The editor that became active, if any.
   * @returns `true` only for an open reader and an editor whose file is one of the runtime's source paths.
   * @example this.showsRuntimeSourceInOpenReader(vscode.window.activeTextEditor)
   */
  private showsRuntimeSourceInOpenReader(
    editor: vscode.TextEditor | undefined,
  ): boolean {
    return Boolean(
      this.opened &&
      editor &&
      this.runtimeSourcePaths.has(editor.document.uri.fsPath),
    )
  }

  /**
   * Says whether the captured source is not shown again over a runtime file right now; asked by the active-editor listener of {@link installReaders} after {@link showsRuntimeSourceInOpenReader}.
   * @returns `true` while such a restore is already running, a presentation is being placed, or no captured source is selected.
   * @example if (this.isSourceRestoreHeldBack()) return
   */
  private isSourceRestoreHeldBack(): boolean {
    return Boolean(
      this.restoringSource || this.presentationTransition || !this.sourceUri,
    )
  }

  /**
   * Registers native readers once, keeping checkbox persistence under explicit learner control; the constructor calls it at activation.
   * In Cursor it also turns on the context key that shows "Codebook: Move Learning Summary…" in the Learning summary's title and in the Command Palette for the whole editor session, so the step stays reachable when the offer's notification is gone.
   * @example this.installReaders()
   */
  private installReaders(): void {
    if (this.outline) return
    // Cursor removes an information notification with a button after about 15 s; the title action and the palette entry stay.
    if (this.isCursorHost())
      void vscode.commands
        .executeCommand('setContext', SUMMARY_PLACEMENT_CONTEXT_KEY, true)
        .then(undefined, (error: unknown) => this.report('layout', error))
    this.observeEditorGroups()
    this.watchKeyboardOutsideEditors()
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabGroups((event) => {
        this.invalidateClosedContextCreation(event)
        this.observeEditorGroups(event)
        this.bindPendingContextCreation()
        this.publishAfterTabChange()
      }),
    )
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        // Real closure ends every existing focus receipt for that type; wrapper refresh alone does not close a tab.
        for (const tab of event.closed)
          if (tab.input instanceof vscode.TabInputWebview) {
            const kind = tab.input.viewType
            this.webviewCloseRevisions.set(
              kind,
              (this.webviewCloseRevisions.get(kind) ?? 0) + 1,
            )
          }
        // VS Code can deliver the new tab without replacing its group wrapper; no focus event is required to bind its creation.
        this.bindPendingContextCreation()
        this.publishAfterTabChange()
      }),
    )
    this.highlight = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor(
        'editor.stackFrameHighlightBackground',
      ),
    })
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        STUDY_SOURCE_SCHEME,
        { provideTextDocumentContent: (uri) => this.provideSource(uri) },
      ),
    )
    this.outline = vscode.window.createTreeView('codebook.learningOutline', {
      manageCheckboxStateManually: true,
      treeDataProvider: {
        onDidChangeTreeData: this.treeChanges.event,
        getChildren: async () => {
          await this.initialize()
          return this.message().model.progressByItem.map((item) => item.id)
        },
        getParent: () => undefined,
        getTreeItem: (itemId) => {
          const model = this.message().model,
            value = model.progressByItem.find((item) => item.id === itemId)
          const item = new vscode.TreeItem(
            value?.title ?? 'Learning item unavailable',
            vscode.TreeItemCollapsibleState.None,
          )
          item.id = itemId
          // Native TreeView can finish an older children request after the selected profile changes.
          if (!value) {
            item.description = 'No longer in the selected study'
            return item
          }
          item.description = !value.known
            ? 'Current source unavailable'
            : value.reviewNeeded
              ? 'Review needed'
              : value.understood
                ? 'Learner understood'
                : 'Not marked'
          item.command = {
            command: 'codebook.selectLearningItem',
            title: 'Read learning item',
            arguments: [itemId],
          }
          // Current progress stays visible after drift, but only the displayed captured context is editable in Study.
          if (
            value.known &&
            (model.selection.profile !== REPOSITORY_BROWSER_PROFILE ||
              !model.sourceChanged)
          )
            item.checkboxState = value.understood
              ? vscode.TreeItemCheckboxState.Checked
              : vscode.TreeItemCheckboxState.Unchecked
          else if (model.selection.profile === REPOSITORY_BROWSER_PROFILE)
            item.tooltip =
              'Read the article to review current citations; the Study checkbox applies to its captured source.'
          return item
        },
      },
    })
    this.disposables.push(
      this.outline,
      this.outline.onDidChangeVisibility(() => {
        this.lastOutlineSelection = undefined
        this.syncOutline()
      }),
      this.outline.onDidChangeCheckboxState((event) => {
        for (const [itemId, state] of event.items) {
          // A queued checkbox from the previous profile has no authority over the current learning items.
          if (
            !this.message().model.progressByItem.some(
              (item) => item.id === itemId,
            )
          )
            continue
          void this.understand(
            state === vscode.TreeItemCheckboxState.Checked,
            itemId,
            undefined,
            'current',
          ).catch((error) => this.report('progress', error))
        }
      }),
    )
    this.disposables.push(
      vscode.window.registerWebviewViewProvider(
        'codebook.learningSummary',
        {
          resolveWebviewView: (view) => {
            this.summaryView = view
            this.lastPublished = undefined
            this.lastRendered = undefined
            view.webview.options = {
              enableScripts: true,
              localResourceRoots: [],
            }
            view.webview.onDidReceiveMessage((message) => {
              void this.receivePaneMessage(message, 'context', view).catch(
                (error) => {
                  if (this.summaryView === view)
                    this.report(this.panelFailureKind(message), error)
                },
              )
            })
            view.onDidDispose(() => {
              if (this.summaryView === view) {
                this.summaryView = undefined
                this.summaryDocumentActive = false
                this.summaryHeldFocus = false
                clearTimeout(this.summaryFocusRelease)
                this.lastRendered = undefined
              }
            })
            view.onDidChangeVisibility(() => {
              // Collapsing the summary never moves the playhead or borrows a live debugger.
              if (this.isSummaryViewInState(view, true)) {
                this.lastPublished = undefined
                this.publish()
              }
              if (this.isSummaryViewInState(view, false))
                this.releaseHiddenSummaryFocus()
            })
            if (this.recordingActive && this.summaryComposition) {
              this.summaryDocumentActive = true
              view.webview.html = studyHtml('context')
              this.publish()
            } else this.clearLearningSummary()
          },
        },
        { webviewOptions: { retainContextWhenHidden: true } },
      ),
    )
    this.disposables.push(
      vscode.window.registerWebviewViewProvider(
        'codebook.observedMoments',
        {
          resolveWebviewView: async (view) => {
            this.moments = view
            view.webview.options = {
              enableScripts: true,
              localResourceRoots: [],
            }
            view.webview.html = studyHtml('moments')
            // Disposed or replaced panel documents cannot send actions into a later replay.
            view.webview.onDidReceiveMessage((message) => {
              if (this.moments === view)
                void this.receivePaneMessage(message, 'moments', view).catch(
                  (error) => {
                    if (this.moments === view)
                      this.report(this.panelFailureKind(message), error)
                  },
                )
            })
            view.onDidDispose(() => {
              if (this.moments === view) {
                this.moments = undefined
                this.lastPublished = undefined
                this.publish()
              }
            })
            view.onDidChangeVisibility(() => {
              if (this.moments === view) {
                this.lastPublished = undefined
                this.publish()
              }
            })
            // A restored Activity Bar view can resolve before any command initializes its workspace snapshot.
            await this.initialize()
            if (this.moments === view) {
              this.lastPublished = undefined
              this.publish()
            }
          },
        },
        { webviewOptions: { retainContextWhenHidden: true } },
      ),
    )
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.confirmInitialAppRegistration()
        if (editor?.document.uri.scheme === STUDY_SOURCE_SCHEME)
          this.lastActiveRegion = 'source'
        if (
          !this.showsRuntimeSourceInOpenReader(editor) ||
          this.isSourceRestoreHeldBack()
        )
          return
        const region = this.lastActiveRegion
        this.restoringSource = true
        void this.renderSelection(true, true)
          .then(() => {
            if (region === 'context')
              this.contextPanel?.reveal(undefined, false)
            if (region === 'app') this.app?.reveal(undefined, false)
          })
          .finally(() => {
            this.restoringSource = false
          })
      }),
    )
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        const study = this.selectedStudy(true)
        if (
          study !== undefined &&
          study.descriptor?.sources.some(
            (source) =>
              join(this.repositorySources!.workspace, source.path) ===
              event.document.uri.fsPath,
          )
        )
          this.scheduleCitationRefresh()
      }),
    )
  }

  /** Resolves only this workspace's versioned read-only source URIs after reload. @example await this.provideSource(uri) */
  private async provideSource(uri: vscode.Uri): Promise<string> {
    await this.initialize()
    if (
      uri.authority !== this.library!.workspaceKey ||
      uri.query ||
      uri.fragment
    )
      throw new Error('Captured source belongs to another workspace.')
    const cached = this.documents.get(uri.toString())
    if (cached !== undefined) return cached
    const pathSegments = uri.path.split('/').filter(Boolean)
    if (pathSegments[0] === 'node-history') {
      const [, studyIdText, sequenceText, expectedHash] = pathSegments,
        studyId = studyIdSchema.parse(studyIdText)
      const sequence = z.number().int().positive().parse(Number(sequenceText))
      const history = await this.nodeHistoryStore?.read(studyId)
      const stop = history?.entries.find(
        (entry) => entry.type === 'stop' && entry.sequence === sequence,
      )
      if (!stop || stop.type !== 'stop')
        throw new Error(
          'This captured Node source revision is unavailable or no longer matches its sealed history.',
        )
      const source = stop.debuggerSnapshot.frames[0]?.source
      if (
        !source ||
        source.name !== stop.source.path ||
        source.hash !== expectedHash ||
        source.hash !== stop.source.hash ||
        sha256(source.text) !== source.hash
      )
        throw new Error(
          'This captured Node source revision is unavailable or no longer matches its sealed history.',
        )
      return source.text
    }
    const [studyId, itemText, hash] = pathSegments
    const itemId = learningItemSchema.parse(decodeURIComponent(itemText ?? ''))
    const study =
      studyId !== 'source-derived'
        ? await this.library!.readStudy(studyIdSchema.parse(studyId))
        : undefined
    const source =
      study?.observations.find(
        (value) => value.itemId === itemId && value.source.hash === hash,
      )?.source ??
      (study !== undefined && describeStudy(study).items[0]!.id === itemId
        ? study.descriptor?.sources.find((source) => source.hash === hash)
        : undefined)
    if (!source || source.hash !== hash)
      throw new Error('This captured source revision is unavailable.')
    return source.text
  }

  /** Serializes native layout ownership across entry, Return and Close; accepted host effects drain before newer intents. @example await this.withLayout(signal, async () => {}) */
  private async withLayout(
    signal: AbortSignal | undefined,
    operation: (lifetime: number, assertCurrent: () => void) => Promise<void>,
  ): Promise<void> {
    const lifetime = this.lifetime,
      navigation = this.repositoryNavigation
    const assertCurrent = (): void => {
      this.assertLifetime(lifetime)
      signal?.throwIfAborted()
      // A newer article owns subsequent native work once already issued effects have drained.
      if (navigation !== undefined && navigation !== this.repositoryNavigation)
        throw new Error('Evidence navigation was superseded.')
    }
    assertCurrent()
    // A later explicit navigation must drain an accepted host command before applying its own target.
    while (this.arranging) {
      await this.arranging.catch(() => undefined)
      assertCurrent()
    }
    const pending = (this.arranging = operation(lifetime, assertCurrent))
    try {
      await pending
    } finally {
      if (this.arranging === pending) this.arranging = undefined
    }
  }

  /** Identifies main native focus for passive reads and {@link readMainEditorGrid}; stale TabGroup focus alone cannot prove a part. @example this.hasMainEditorFocus(1) */
  private hasMainEditorFocus(groupCount: number): boolean {
    const { viewColumn: column, activeTab } =
      vscode.window.tabGroups.activeTabGroup
    const input = activeTab?.input
    // Fresh webview wrappers optimistically report active before a native tab exists; require the owned active input too.
    const ownedPanelFocused =
      input instanceof vscode.TabInputWebview &&
      [
        { panel: this.app, kind: 'codebook.scopedBrowser' },
        { panel: this.contextPanel, kind: 'codebook.studyContext' },
      ].some(
        ({ panel, kind }) =>
          panel?.active &&
          panel.viewColumn === column &&
          isCodebookPaneViewType(input.viewType, kind),
      )
    return (
      column >= vscode.ViewColumn.One &&
      column <= groupCount &&
      Boolean(
        vscode.window.activeTextEditor?.viewColumn === column ||
        ownedPanelFocused,
      )
    )
  }

  /** Reads confirmation without borrowing focus for {@link readPresentationState} and same-mode selection; unknown scope is not a main-grid mismatch. @example await this.readPassivePresentationLayout() */
  private async readPassivePresentationLayout(): Promise<unknown> {
    const mainFocused = this.hasMainEditorFocus(STUDY_EDITOR_GROUP_COUNT),
      assertRetained = this.retainPresentationPlacement()
    const layout = await vscode.commands.executeCommand<unknown>(
        'vscode.getEditorLayout',
      ),
      count = editorLayoutGroupCount(layout)
    // A focus change while the command waits makes its returned part ambiguous even if the leaf count happens to match.
    try {
      assertRetained()
    } catch {
      return undefined
    }
    return count === vscode.window.tabGroups.all.length ||
      (count !== undefined && mainFocused && this.hasMainEditorFocus(count))
      ? layout
      : undefined
  }

  /** Measures the main editor part before {@link arrange} or presentation placement; global chat/floating groups remain protected outside its leaves. @example const grid = await this.readMainEditorGrid(signal, assertCurrent) */
  private async readMainEditorGrid(
    signal: AbortSignal | undefined,
    assertCurrent: () => void,
    acquireSourceFocus?: () => Promise<() => void>,
    beforeScopeFocus?: (acquire?: RepositoryFocusTarget) => void,
  ) {
    let assertAcquiredFocus = (): void => {}
    const assertInitial = this.retainPresentationPlacement()
    const initialTab = vscode.window.tabGroups.activeTabGroup.activeTab
    const initialWebview =
      initialTab?.input instanceof vscode.TabInputWebview
        ? initialTab.input.viewType
        : undefined
    let initialFocusError: unknown, layout: unknown
    // Passive measurement must remember learner departures even if the original tab is active again when its response arrives.
    const retainInitial = (): void => {
      if (initialFocusError !== undefined) return
      try {
        assertInitial()
      } catch (error) {
        initialFocusError = error
      }
    }
    const initialChanges = [
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        // Verified wrapper refresh has no close event; a new lookalike is a different learner-owned tab.
        if (
          initialWebview !== undefined &&
          event.closed.some(
            (tab) =>
              tab.input instanceof vscode.TabInputWebview &&
              tab.input.viewType === initialWebview,
          )
        )
          initialFocusError ??= new Error(
            'Native pane, group or focus changed while presentation waited; the original webview tab was closed.',
          )
        retainInitial()
      }),
      vscode.window.tabGroups.onDidChangeTabGroups(retainInitial),
      vscode.window.onDidChangeActiveTextEditor(retainInitial),
    ]
    try {
      layout = await vscode.commands.executeCommand<unknown>(
        'vscode.getEditorLayout',
      )
      assertCurrent()
      if (initialFocusError !== undefined) throw initialFocusError
      assertInitial()
    } finally {
      for (const subscription of initialChanges) subscription.dispose()
    }
    let count = editorLayoutGroupCount(layout)
    if (count === undefined || count > vscode.window.tabGroups.all.length)
      throw new Error(
        'The editor did not expose a valid measured grid; existing panes were preserved.',
      )
    const firstFocused = () => this.hasMainEditorFocus(vscode.ViewColumn.One)
    const receipt = this.layoutReceipt
    // A retained measured grid plus native focus proves its part without a primary-webview focus echo overtaking restoration.
    const retainedMainFocus = Boolean(
      receipt &&
      receipt.signature === JSON.stringify(layout) &&
      this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) &&
      this.hasMainEditorFocus(count),
    )
    // A single part accounts for every group. With multiple parts, TabGroups.activeTabGroup alone can be stale.
    if (
      count < vscode.window.tabGroups.all.length &&
      !firstFocused() &&
      !retainedMainFocus
    ) {
      const panel = this.app?.active
        ? this.app
        : this.contextPanel?.active
          ? this.contextPanel
          : undefined
      const editor = vscode.window.activeTextEditor,
        documentVersion = editor?.document.version,
        selections = editor?.selections
      const retainedSelections = JSON.stringify(selections)
      const preview =
        vscode.window.tabGroups.activeTabGroup.activeTab?.isPreview ?? false
      const restoreReading = retainEditorReadingPosition(editor),
        assertGroups = this.retainPresentationPlacement(false)
      const firstInput = vscode.window.tabGroups.all.find(
        (group) => group.viewColumn === vscode.ViewColumn.One,
      )?.activeTab?.input
      const identifiableFirst =
        firstInput instanceof vscode.TabInputText ||
        (firstInput instanceof vscode.TabInputWebview &&
          isCodebookPaneViewType(
            firstInput.viewType,
            'codebook.scopedBrowser',
            'codebook.studyContext',
          ))
      const primaryEditor =
        firstInput instanceof vscode.TabInputText
          ? vscode.window.visibleTextEditors.find(
              (value) =>
                value.viewColumn === vscode.ViewColumn.One &&
                value.document.uri.toString() === firstInput.uri.toString(),
            )
          : undefined
      // Retain existing primary text before issuing focus; command response latency cannot adopt newer learner input.
      if (firstInput instanceof vscode.TabInputText && !primaryEditor)
        throw new Error(
          'The primary text editor could not be retained safely before scope measurement. Focus it explicitly and try again.',
        )
      const primaryVersion = primaryEditor?.document.version,
        primarySelections = JSON.stringify(primaryEditor?.selections)
      const useCitation = Boolean(acquireSourceFocus && !identifiableFirst),
        mainGroupCount = count
      const sourceUri = this.sourceUri?.toString(),
        sourceColumn = this.studyPanePositions().sourceColumn
      const namedInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input
      // Beside another editor part that holds the keyboard (Cursor's chat), the editor reports the focus a text editor takes and not the focus a Codebook pane takes. With a pane in the first group, neither a Study pane nor a text editor focused and no pane's tab named as the active one, the main editor is entered through the reader's captured source instead, whose text editor is visible in its own group.
      const sourceBorrow =
        !useCitation &&
        !panel &&
        !editor &&
        firstInput instanceof vscode.TabInputWebview &&
        identifiableFirst &&
        !(
          namedInput instanceof vscode.TabInputWebview &&
          isCodebookPaneViewType(
            namedInput.viewType,
            'codebook.scopedBrowser',
            'codebook.studyContext',
          )
        )
          ? vscode.window.visibleTextEditors.find(
              (value) =>
                value.viewColumn === sourceColumn &&
                value.document.uri.toString() === sourceUri,
            )
          : undefined
      /** Tells that the captured source's text editor, which the measurement focused, is the active text editor. */
      const sourceEditorReported = (): boolean => {
        const focused = vscode.window.activeTextEditor
        return (
          sourceBorrow !== undefined &&
          focused?.viewColumn === sourceBorrow.viewColumn &&
          focused?.document.uri.toString() ===
            sourceBorrow.document.uri.toString()
        )
      }
      let didLearnerChangePrimaryTab = false
      const namedColumn = vscode.window.tabGroups.activeTabGroup.viewColumn
      /**
       * Tells that a text editor is the first group's editor of the primary editor's document; asked by {@link primaryEditorReported} about the active text editor.
       * @param focused - The active text editor, if the editor reports one.
       * @param primary - The text editor the first group showed before the focus command.
       * @returns `true` when `focused` is in the first group and shows the document of `primary`.
       * @example isFirstGroupEditorOf(vscode.window.activeTextEditor, primaryEditor)
       */
      const isFirstGroupEditorOf = (
        focused: vscode.TextEditor | undefined,
        primary: vscode.TextEditor,
      ): boolean =>
        focused?.viewColumn === vscode.ViewColumn.One &&
        focused.document.uri.toString() === primary.document.uri.toString()
      /**
       * Cursor reports the first group's text editor as the active text editor after the focus command and keeps naming the group it named before (the chat's) as the active tab group until a tab or group changes: that report is the main editor's focus too. Asked by the wait for the primary focus below.
       * @returns `true` when the active text editor is the first group's and the editor still names the other group it named before the command.
       * @example firstFocused() || primaryEditorReported() || sourceEditorReported()
       */
      const primaryEditorReported = (): boolean => {
        const focused = vscode.window.activeTextEditor
        return Boolean(
          primaryEditor &&
          isFirstGroupEditorOf(focused, primaryEditor) &&
          namedColumn !== vscode.ViewColumn.One &&
          vscode.window.tabGroups.activeTabGroup.viewColumn === namedColumn,
        )
      }
      // Empty/opaque primary panes need the actual requested citation, never a disposable placeholder or unobserved command result.
      beforeScopeFocus?.(
        useCitation
          ? undefined
          : sourceBorrow
            ? {
                matchesEditor: sourceEditorReported,
                matchesGroup: () => {
                  const group = vscode.window.tabGroups.activeTabGroup,
                    input = group.activeTab?.input
                  return (
                    group.viewColumn === sourceBorrow.viewColumn &&
                    input instanceof vscode.TabInputText &&
                    input.uri.toString() ===
                      sourceBorrow.document.uri.toString()
                  )
                },
              }
            : {
                matchesEditor: () => {
                  const focused = vscode.window.activeTextEditor
                  // Latch the captured primary target before its command; an away-and-back event must survive the delayed response.
                  return primaryEditor
                    ? focused?.document.uri.toString() ===
                        primaryEditor.document.uri.toString() &&
                        focused.viewColumn === vscode.ViewColumn.One &&
                        focused.document.version === primaryVersion &&
                        JSON.stringify(focused.selections) === primarySelections
                    : firstFocused()
                },
                matchesGroup: () => {
                  const group = vscode.window.tabGroups.activeTabGroup,
                    input = group.activeTab?.input
                  return (
                    group.viewColumn === vscode.ViewColumn.One &&
                    (firstInput instanceof vscode.TabInputText
                      ? input instanceof vscode.TabInputText &&
                        input.uri.toString() === firstInput.uri.toString()
                      : firstInput instanceof vscode.TabInputWebview &&
                        input instanceof vscode.TabInputWebview &&
                        input.viewType === firstInput.viewType)
                  )
                },
              },
      )
      this.mainEditorFocusBorrows++
      if (useCitation) {
        assertAcquiredFocus = await acquireSourceFocus!()
        assertCurrent()
        assertGroups()
        assertAcquiredFocus()
      } else if (sourceBorrow) {
        await vscode.window.showTextDocument(sourceBorrow.document, {
          viewColumn: sourceBorrow.viewColumn,
          preserveFocus: false,
          preview: false,
        })
        assertCurrent()
        assertGroups()
      } else {
        await vscode.commands.executeCommand(
          'workbench.action.focusFirstEditorGroup',
        )
        assertCurrent()
        assertGroups()
      }
      await waitUntil(
        () => {
          const currentInput = vscode.window.tabGroups.all.find(
            (group) => group.viewColumn === vscode.ViewColumn.One,
          )?.activeTab?.input
          const samePrimaryInput =
            (firstInput instanceof vscode.TabInputText &&
              currentInput instanceof vscode.TabInputText &&
              firstInput.uri.toString() === currentInput.uri.toString()) ||
            (firstInput instanceof vscode.TabInputWebview &&
              currentInput instanceof vscode.TabInputWebview &&
              firstInput.viewType === currentInput.viewType)
          // Group focus preserves its active tab; a different tab belongs to the learner, not this temporary focus request.
          if (!useCitation && identifiableFirst && !samePrimaryInput) {
            this.presentationMovedFocus = false
            didLearnerChangePrimaryTab = true
            throw new Error(
              'The primary editor selection changed during scope measurement; the newer learner focus was preserved.',
            )
          }
          return (
            firstFocused() || primaryEditorReported() || sourceEditorReported()
          )
        },
        'identifiable primary editor focus',
        PRESENTATION_READY_TIMEOUT_MS,
        signal,
      ).catch((error: unknown) => {
        signal?.throwIfAborted()
        // Cursor never reports primary focus beside a learner's preview tab; name that tab and its remedy instead of a bare timeout.
        const foreignPreview = vscode.window.tabGroups.all
          .filter((group) => group.viewColumn <= mainGroupCount)
          .flatMap((group) => group.tabs.map((tab) => ({ group, tab })))
          .find(
            ({ tab }) =>
              tab.isPreview &&
              !this.isCodebookPaneInput(tab.input) &&
              !this.isCapturedSourceInput(tab.input),
          )
        // Only the expired wait is renamed; a learner focus change keeps its own refusal.
        if (didLearnerChangePrimaryTab) throw error
        throw new StudyError(
          'PRESENTATION_UNAVAILABLE',
          foreignPreview
            ? foreignPreviewObstacle(
                this.editorTabName(foreignPreview.tab),
                foreignPreview.group.viewColumn,
              )
            : unreportedEditorFocusObstacle(
                PRESENTATION_READY_TIMEOUT_MS / MILLISECONDS_PER_SECOND,
              ),
        )
      })
      assertCurrent()
      assertGroups()
      const assertFocused = this.retainPresentationPlacement()
      layout = await vscode.commands.executeCommand<unknown>(
        'vscode.getEditorLayout',
      )
      assertCurrent()
      assertFocused()
      assertAcquiredFocus()
      // Same-file interaction is newer learner intent too; borrowed focus cannot outlive an edit or cursor selection.
      if (
        primaryEditor &&
        (primaryEditor.document.version !== primaryVersion ||
          JSON.stringify(vscode.window.activeTextEditor?.selections) !==
            primarySelections)
      ) {
        this.presentationMovedFocus = false
        throw new Error(
          'The primary editor content or selection changed during scope measurement; the newer learner focus was preserved.',
        )
      }
      count = editorLayoutGroupCount(layout)
      if (count === undefined || count > vscode.window.tabGroups.all.length)
        throw new Error('The primary editor grid could not be measured safely.')
      // Return only to a captured editor now proven to belong to this part; never guess a foreign chat/floating focus.
      if (
        !useCitation &&
        panel?.viewColumn !== undefined &&
        panel.viewColumn <= count
      ) {
        beforeScopeFocus?.({
          matchesEditor: () => panel.active,
          matchesGroup: () => {
            const group = vscode.window.tabGroups.activeTabGroup,
              input = group.activeTab?.input,
              kind =
                panel === this.app
                  ? 'codebook.scopedBrowser'
                  : 'codebook.studyContext'
            return (
              group.viewColumn === panel.viewColumn &&
              input instanceof vscode.TabInputWebview &&
              isCodebookPaneViewType(input.viewType, kind)
            )
          },
        })
        panel.reveal(undefined, false)
        await waitUntil(
          () =>
            panel.active &&
            vscode.window.tabGroups.activeTabGroup.viewColumn ===
              panel.viewColumn,
          'retained main editor focus',
          PRESENTATION_READY_TIMEOUT_MS,
          signal,
        )
        assertCurrent()
        assertGroups()
      } else if (
        !useCitation &&
        editor?.viewColumn !== undefined &&
        editor.viewColumn <= count
      ) {
        if (editor.document.version !== documentVersion)
          throw new Error(
            'The focused document changed during native scope measurement.',
          )
        beforeScopeFocus?.({
          matchesEditor: () => {
            const focused = vscode.window.activeTextEditor
            // Restore only the pre-command document/selection, then retain its later events through the next cold-layout receipt.
            return (
              focused?.document.uri.toString() ===
                editor.document.uri.toString() &&
              focused.document.version === documentVersion &&
              focused.viewColumn === editor.viewColumn &&
              JSON.stringify(focused.selections) === retainedSelections
            )
          },
          matchesGroup: () => {
            const group = vscode.window.tabGroups.activeTabGroup,
              input = group.activeTab?.input
            return (
              group.viewColumn === editor.viewColumn &&
              input instanceof vscode.TabInputText &&
              input.uri.toString() === editor.document.uri.toString()
            )
          },
        })
        const restored = await vscode.window.showTextDocument(editor.document, {
          viewColumn: editor.viewColumn,
          preserveFocus: false,
          preview,
        })
        assertCurrent()
        assertGroups()
        if (editor.document.version !== documentVersion)
          throw new Error(
            'The focused document changed while its native focus was restored.',
          )
        const activeEditor = vscode.window.activeTextEditor
        // Native display and its response are separate; newer input retires the still-unissued selection/reading restoration.
        if (
          activeEditor?.document.uri.toString() !==
            restored.document.uri.toString() ||
          activeEditor.viewColumn !== restored.viewColumn ||
          JSON.stringify(activeEditor.selections) !== retainedSelections ||
          JSON.stringify(restored.selections) !== retainedSelections
        ) {
          this.presentationMovedFocus = false
          throw new Error(
            'Native focus or selection changed while the previous editor was restored; the newer learner state was preserved.',
          )
        }
        if (selections) restored.selections = selections
        await restoreReading(restored, signal)
        assertCurrent()
        assertGroups()
      }
    }
    const groups = [...vscode.window.tabGroups.all],
      separateParts = count < groups.length
    // View columns address the measured main part; API collection order is not a membership or ownership receipt.
    const ordered = groups.toSorted(
      (left, right) => left.viewColumn - right.viewColumn,
    )
    if (
      separateParts &&
      ordered.some(
        (group, index) => group.viewColumn !== index + vscode.ViewColumn.One,
      )
    )
      throw new Error(
        'The editor did not expose unambiguous primary group columns; existing panes were preserved.',
      )
    const mainGroups = separateParts
      ? ordered.filter((group) => group.viewColumn <= count)
      : groups
    const outside = separateParts
      ? ordered.filter((group) => group.viewColumn > count)
      : []
    const outsideOffsets = outside.map((group) => group.viewColumn - count)
    const contents = (values: readonly vscode.TabGroup[]) =>
      JSON.stringify(
        values.map((group) =>
          group.tabs.map((tab) => [
            tab.label,
            tab.input,
            tab.isDirty,
            tab.isPreview,
            tab.isPinned,
          ]),
        ),
      )
    const outsideContents = contents(outside),
      assertPlacement = this.retainPresentationPlacement()
    const assertUnchanged = (): void => {
      assertPlacement()
      assertAcquiredFocus()
    }
    // main leaves -> owned grid effects; remaining parts -> unchanged count/content, never adopted as owned panes.
    return {
      layout,
      groups: mainGroups,
      assertUnchanged,
      assertFocused: assertAcquiredFocus,
      preservesOtherParts: (mainCount: number) => {
        const currentOutside = vscode.window.tabGroups.all
          .filter((group) => group.viewColumn > mainCount)
          .toSorted((left, right) => left.viewColumn - right.viewColumn)
        return (
          vscode.window.tabGroups.all.length === mainCount + outside.length &&
          contents(currentOutside) === outsideContents &&
          currentOutside.every(
            (group, index) =>
              group.viewColumn === mainCount + outsideOffsets[index]!,
          )
        )
      },
    }
  }

  /** Records real pane positions so {@link restoreRepositoryLayout} distinguishes learner moves from its own group contraction. @example this.studyPanePositions().contextColumn */
  private studyPanePositions() {
    const sourceGroups = vscode.window.tabGroups.all.filter((group) =>
      group.tabs.some(
        (tab) =>
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.toString() === this.sourceUri?.toString(),
      ),
    )
    const identity =
      this.sourceGroup && this.editorGroupIdentities.get(this.sourceGroup)
    const sourceGroup =
      sourceGroups.find(
        (group) =>
          group === this.sourceGroup ||
          (identity && this.editorGroupIdentities.get(group) === identity),
      ) ??
      sourceGroups.find(
        (group) => group === vscode.window.tabGroups.activeTabGroup,
      ) ??
      sourceGroups[0]
    return {
      app: this.app,
      appColumn: this.app?.viewColumn,
      context: this.contextPanel,
      contextColumn: this.contextPanel?.viewColumn,
      sourceGroup,
      sourceColumn: sourceGroup?.viewColumn,
    }
  }

  /** Checks owned Study destinations before Restore reuses panes instead of replacing the learner's current reader. @example this.hasStudyPaneColumns() */
  private hasStudyPaneColumns(): boolean {
    const panes = this.studyPanePositions(),
      descriptor = STUDY_PRESENTATIONS['study-workspace']
    return Boolean(
      panes.app &&
      panes.context &&
      this.sourceUri &&
      panes.appColumn === descriptor.appColumn &&
      panes.sourceColumn === descriptor.sourceColumn &&
      panes.contextColumn === descriptor.contextColumn,
    )
  }

  /** Accepts a host-clamped Study topology while withholding the proportional layout receipt; cold Open and Restore use this boundary. @example await this.hasRetainedStudyTopology() */
  private async hasRetainedStudyTopology(
    signal?: AbortSignal,
    beforeScopeFocus?: (acquire?: RepositoryFocusTarget) => void,
  ): Promise<boolean> {
    const grid = await this.readMainEditorGrid(
      signal,
      () => signal?.throwIfAborted(),
      undefined,
      beforeScopeFocus,
    )
    const parsed = editorLayoutSchema.safeParse(grid.layout)
    if (this.liveComposition || this.summaryComposition)
      return (
        grid.groups.length === LIVE_EDITOR_GROUP_COUNT &&
        grid.preservesOtherParts(LIVE_EDITOR_GROUP_COUNT) &&
        parsed.success &&
        parsed.data.orientation === LIVE_EDITOR_LAYOUT.orientation &&
        parsed.data.groups.length === LIVE_EDITOR_GROUP_COUNT &&
        parsed.data.groups.every((group) => !group.groups)
      )
    return (
      grid.groups.length === STUDY_EDITOR_GROUP_COUNT &&
      grid.preservesOtherParts(STUDY_EDITOR_GROUP_COUNT) &&
      parsed.success &&
      parsed.data.orientation === HORIZONTAL_EDITOR_ORIENTATION &&
      parsed.data.groups.length === 2 &&
      parsed.data.groups[0]?.groups?.length === 2 &&
      !parsed.data.groups[1]?.groups
    )
  }

  /** Rejects learner pane moves while allowing wrapper resync and the explicit source relocation owned by a reentry receipt. @example this.sameStudyPanePositions(receipt.panes, receipt.sourceTargetColumn) */
  private sameStudyPanePositions(
    previous: ReturnType<StudyWorkspace['studyPanePositions']>,
    sourceTargetColumn?: vscode.ViewColumn,
  ): boolean {
    const current = this.studyPanePositions(),
      sourceIdentity =
        previous.sourceGroup &&
        this.editorGroupIdentities.get(previous.sourceGroup)
    const sourceRetained =
      previous.sourceColumn === current.sourceColumn &&
      (previous.sourceGroup === current.sourceGroup ||
        Boolean(
          sourceIdentity &&
          current.sourceGroup &&
          sourceIdentity ===
            this.editorGroupIdentities.get(current.sourceGroup),
        ))
    const sourceRestored =
      sourceTargetColumn !== undefined &&
      current.sourceColumn === sourceTargetColumn
    return (
      previous.app === current.app &&
      previous.appColumn === current.appColumn &&
      previous.context === current.context &&
      previous.contextColumn === current.contextColumn &&
      (sourceRetained || sourceRestored)
    )
  }

  /** Captures the article before {@link open} acquires panes, reversing only unchanged placements caused by its prior Return. @example await this.captureRepositoryLayout(signal) */
  private async captureRepositoryLayout(
    signal?: AbortSignal,
  ): Promise<StudyWorkspace['layoutReceipt']> {
    let reentry: StudyWorkspace['layoutReceipt']
    await this.withLayout(signal, async (lifetime, assertCurrent) => {
      const origin = this.repositoryOrigin,
        navigation = this.repositoryNavigation
      if (!origin) return
      const grid = await this.readMainEditorGrid(signal, assertCurrent),
        layout = grid.layout
      if (
        navigation !== this.repositoryNavigation ||
        JSON.stringify(origin) !== JSON.stringify(this.repositoryOrigin) ||
        !layout
      )
        return
      const pending = this.layoutReceipt,
        saved = this.repositoryLayoutOrigin
      // Retrying cancelled reentry retains its article origin, rather than adopting our partially expanded grid as learner layout.
      if (
        pending?.mode === 'study-reentry' &&
        saved &&
        JSON.stringify(layout) === pending.signature &&
        this.sameEditorGroups(pending.groups, vscode.window.tabGroups.all) &&
        this.sameStudyPanePositions(pending.panes, pending.sourceTargetColumn)
      ) {
        this.repositoryLayoutOrigin = { ...saved, origin, navigation }
        this.repositoryLayoutRestored = undefined
        reentry = pending.pendingPanes
          ? await this.finishRepositoryPaneRestoration(
              pending,
              lifetime,
              assertCurrent,
            )
          : pending
        return
      }
      const groups = grid.groups.map((group) => ({
          group,
          column: group.viewColumn,
        })),
        restored = this.repositoryLayoutRestored
      this.repositoryLayoutOrigin = {
        origin,
        navigation,
        layout,
        groups,
        preservesOtherParts: grid.preservesOtherParts,
      }
      this.repositoryLayoutRestored = undefined
      // A manual resize, group change or pane move releases the placement effects of the last Return.
      if (
        !restored ||
        JSON.stringify(layout) !== restored.signature ||
        !this.sameEditorGroups(restored.groups, vscode.window.tabGroups.all) ||
        !this.sameStudyPanePositions(restored.after)
      )
        return
      const restoredGroupCount = editorLayoutGroupCount(restored.studyLayout)
      if (restoredGroupCount === undefined)
        throw new Error('The saved main editor layout is invalid.')
      // A different feature composition must reserve its own destinations, never inherit the previous reader's pane ownership.
      if (restoredGroupCount !== this.studyGroupCount()) return
      // Reserve destinations before moving retained panels when their old main columns now name another part.
      if (
        grid.groups.length < restoredGroupCount &&
        grid.groups.length < vscode.window.tabGroups.all.length
      ) {
        await vscode.commands.executeCommand(
          'vscode.setEditorLayout',
          restored.studyLayout,
        )
        this.assertLifetime(lifetime)
        const groups = vscode.window.tabGroups.all.map((group) => ({
            group,
            column: group.viewColumn,
          })),
          panes = this.studyPanePositions()
        const preparedLayout = await vscode.commands.executeCommand<unknown>(
          'vscode.getEditorLayout',
        )
        this.assertLifetime(lifetime)
        if (
          !isProportionalEditorLayout(restored.studyLayout, preparedLayout) ||
          !this.sameEditorGroups(groups, vscode.window.tabGroups.all) ||
          !this.sameStudyPanePositions(panes) ||
          !grid.preservesOtherParts(restoredGroupCount)
        )
          throw new Error(
            'The main editor destinations could not be restored safely.',
          )
        // Cancellation may retain accepted grid effects, but must defer unissued pane moves until an explicit retry.
        this.layoutReceipt = {
          mode: 'study-reentry',
          signature: JSON.stringify(preparedLayout),
          groups,
          panes,
          pendingPanes: restored.before,
          sourceTargetColumn:
            restored.before.sourceColumn !== restored.after.sourceColumn
              ? restored.before.sourceColumn
              : undefined,
        }
        assertCurrent()
        reentry = await this.finishRepositoryPaneRestoration(
          this.layoutReceipt,
          lifetime,
          assertCurrent,
        )
        return
      }
      if (restored.before.appColumn !== restored.after.appColumn)
        this.app?.reveal(restored.before.appColumn, true)
      if (restored.before.contextColumn !== restored.after.contextColumn)
        this.contextPanel?.reveal(restored.before.contextColumn, true)
      // Restore a previously verified grid; arbitrary post-reveal geometry cannot establish Codebook ownership.
      await vscode.commands.executeCommand(
        'vscode.setEditorLayout',
        restored.studyLayout,
      )
      this.assertLifetime(lifetime)
      const preparedGroups = vscode.window.tabGroups.all.map((group) => ({
        group,
        column: group.viewColumn,
      }))
      const panes = {
        ...restored.before,
        sourceGroup: restored.after.sourceGroup,
        sourceColumn: restored.after.sourceColumn,
      }
      const preparedLayout = await vscode.commands.executeCommand<unknown>(
        'vscode.getEditorLayout',
      )
      this.assertLifetime(lifetime)
      // Cancellation ends the intent after its accepted pane effects are recorded; Close or manual changes cannot acquire them.
      if (
        isProportionalEditorLayout(restored.studyLayout, preparedLayout) &&
        this.sameEditorGroups(preparedGroups, vscode.window.tabGroups.all) &&
        this.sameStudyPanePositions(panes)
      ) {
        this.layoutReceipt = reentry = {
          mode: 'study-reentry',
          signature: JSON.stringify(preparedLayout),
          groups: preparedGroups,
          panes,
          sourceTargetColumn:
            restored.before.sourceColumn !== restored.after.sourceColumn
              ? restored.before.sourceColumn
              : undefined,
        }
      }
      assertCurrent()
      if (navigation !== this.repositoryNavigation)
        throw new Error('Evidence navigation was superseded.')
    })
    return reentry
  }

  /** Finishes retained pane moves only after {@link captureRepositoryLayout} has reserved their main-grid destinations. @example await this.finishRepositoryPaneRestoration(receipt, lifetime, assertCurrent) */
  private async finishRepositoryPaneRestoration(
    receipt: NonNullable<StudyWorkspace['layoutReceipt']>,
    lifetime: number,
    assertCurrent: () => void,
  ): Promise<NonNullable<StudyWorkspace['layoutReceipt']>> {
    assertCurrent()
    const targets = receipt.pendingPanes
    if (
      !targets ||
      receipt !== this.layoutReceipt ||
      !this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) ||
      !this.sameStudyPanePositions(receipt.panes)
    )
      throw new Error('The retained pane restoration changed before placement.')
    if (targets.appColumn !== receipt.panes.appColumn)
      this.app?.reveal(targets.appColumn, true)
    if (targets.contextColumn !== receipt.panes.contextColumn)
      this.contextPanel?.reveal(targets.contextColumn, true)
    const expected = {
      ...receipt.panes,
      appColumn: targets.appColumn,
      contextColumn: targets.contextColumn,
    }
    const layout = await vscode.commands.executeCommand<unknown>(
      'vscode.getEditorLayout',
    )
    this.assertLifetime(lifetime)
    // Already issued moves drain after cancellation; Close and manual changes never acquire a new receipt.
    if (
      !isProportionalEditorLayout(JSON.parse(receipt.signature), layout) ||
      !this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) ||
      !this.sameStudyPanePositions(expected)
    )
      throw new Error('The editor did not retain the restored Study panes.')
    this.layoutReceipt = {
      ...receipt,
      signature: JSON.stringify(layout),
      panes: this.studyPanePositions(),
      pendingPanes: undefined,
    }
    assertCurrent()
    return this.layoutReceipt
  }

  /** Restores an exact article-origin grid on actual Return while preserving foreign tabs and later manual arrangements. @example await this.restoreRepositoryLayout(selection, signal) */
  private async restoreRepositoryLayout(
    selection: RepositorySelection,
    signal: AbortSignal,
    focus?: RepositoryLayoutFocus,
  ): Promise<void> {
    await this.withLayout(signal, async (lifetime, assertCurrent) => {
      // Actual Return must validate its original focus after queueing, before any early exit or native operation.
      focus?.begin()
      const start = this.articleReturnStart(selection)
      if (!start) return
      const { saved, receipt } = start
      const grid = await this.readMainEditorGrid(
          signal,
          assertCurrent,
          focus?.acquireSourceFocus,
        ),
        layout = grid.layout
      const groups = vscode.window.tabGroups.all,
        retained = grid.groups.filter((group) =>
          saved.groups.some((entry) => entry.column === group.viewColumn),
        )
      // Only Codebook-created groups may contract; an added learner tab must keep its current group.
      const extraGroups = grid.groups.filter(
        (group) => !retained.includes(group),
      )
      const ownsExtraTabs = extraGroups.every((group) =>
        group.tabs.every(
          (tab) =>
            this.ownsCapturedSourceTab(tab) ||
            (tab.input instanceof vscode.TabInputWebview &&
              isCodebookPaneViewType(
                tab.input.viewType,
                'codebook.scopedBrowser',
                'codebook.studyContext',
              )),
        ),
      )
      if (
        !this.holdsArticleReturn(saved, receipt, {
          layout,
          groups,
          retained,
          ownsExtraTabs,
          mainGroups: grid.groups,
        })
      ) {
        this.layoutReceipt = undefined
        return
      }
      const before = this.studyPanesBeforeReturn(receipt)
      this.layoutReceipt = undefined
      await vscode.commands.executeCommand(
        'vscode.setEditorLayout',
        saved.layout,
      )
      // Retain accepted placement effects even after cancellation, so a newer evidence visit can reverse them safely.
      const after = this.studyPanePositions()
      const restoredLayout = await vscode.commands.executeCommand<unknown>(
        'vscode.getEditorLayout',
      )
      this.assertLifetime(lifetime)
      this.settleArticleReturn(saved, restoredLayout, layout, before, after)
      assertCurrent()
    })
  }

  /**
   * Tells whether the saved article-origin grid is the one of a selection; asked by {@link articleReturnStart} when an actual Return begins.
   * @param saved - The reader's saved article origin, if any.
   * @param selection - The article selection the Return goes back to.
   * @returns The saved origin when it is the reader's current repository origin and names that selection, otherwise `undefined`.
   * @example const saved = this.articleOriginOf(this.repositoryLayoutOrigin, selection)
   */
  private articleOriginOf(
    saved: StudyWorkspace['repositoryLayoutOrigin'],
    selection: RepositorySelection,
  ): StudyWorkspace['repositoryLayoutOrigin'] {
    return saved &&
      JSON.stringify(saved.origin) === JSON.stringify(this.repositoryOrigin) &&
      JSON.stringify(saved.origin.selection) === JSON.stringify(selection)
      ? saved
      : undefined
  }

  /**
   * Tells whether a layout receipt is the Study layout an actual Return leaves, and releases it when the learner changed its groups; asked by {@link articleReturnStart} once the saved origin is known.
   * @param receipt - The reader's layout receipt, if any.
   * @returns The receipt of an arranged Study layout whose groups are unchanged; `undefined` when none is arranged, the article layout is arranged already, or the groups changed (the receipt is then released).
   * @example const receipt = this.studyReceiptToLeave(this.layoutReceipt)
   */
  private studyReceiptToLeave(
    receipt: StudyWorkspace['layoutReceipt'],
  ): StudyWorkspace['layoutReceipt'] {
    if (!receipt || receipt.mode === 'repository') return undefined
    // Already-observed learner group changes release ownership before any scope command can borrow focus.
    if (!this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all)) {
      this.layoutReceipt = undefined
      return undefined
    }
    return receipt
  }

  /**
   * Finds what an actual Return starts from; asked by {@link restoreRepositoryLayout} after its focus handoff and before any native operation.
   * @param selection - The article selection the Return goes back to.
   * @returns The saved article origin and the Study receipt to leave, or `undefined` when either is missing; nothing is released unless an origin was saved for the selection.
   * @example
   * ```ts
   * const start = this.articleReturnStart(selection)
   * if (!start) return
   * ```
   */
  private articleReturnStart(selection: RepositorySelection):
    | {
        saved: NonNullable<StudyWorkspace['repositoryLayoutOrigin']>
        receipt: NonNullable<StudyWorkspace['layoutReceipt']>
      }
    | undefined {
    const origin = this.repositoryLayoutOrigin,
      arranged = this.layoutReceipt
    const saved = this.articleOriginOf(origin, selection)
    if (!saved) return undefined
    const receipt = this.studyReceiptToLeave(arranged)
    return receipt && { saved, receipt }
  }

  /**
   * Says whether the measured Study layout is still the one its receipt and the saved origin describe; the first half of {@link holdsArticleReturn}.
   * @param saved - The article origin the Return started from.
   * @param receipt - The Study receipt the Return started from.
   * @param measured - The grid layout and the tab groups read after the measurement.
   * @returns `true` when origin and receipt are still the reader's, and the layout and the groups are the receipt's.
   * @example this.isStudyLayoutUnchanged(saved, receipt, { layout, groups })
   */
  private isStudyLayoutUnchanged(
    saved: NonNullable<StudyWorkspace['repositoryLayoutOrigin']>,
    receipt: NonNullable<StudyWorkspace['layoutReceipt']>,
    measured: { layout: unknown; groups: readonly vscode.TabGroup[] },
  ): boolean {
    return (
      saved === this.repositoryLayoutOrigin &&
      receipt === this.layoutReceipt &&
      JSON.stringify(measured.layout) === receipt.signature &&
      this.sameEditorGroups(receipt.groups, measured.groups)
    )
  }

  /**
   * Says whether the main editor can contract to the saved article grid without taking anything of the learner's; the second half of {@link holdsArticleReturn}.
   * @param saved - The article origin the Return started from.
   * @param receipt - The Study receipt the Return started from.
   * @param measured - The groups of the saved columns, whether every tab of the other groups is Codebook's, and the main editor's groups.
   * @returns `true` when the saved groups and the Study panes are where they were, the extra groups hold only Codebook's tabs, and the other editor parts are preserved.
   * @example this.canContractToArticle(saved, receipt, { retained, ownsExtraTabs: true, mainGroups: grid.groups })
   */
  private canContractToArticle(
    saved: NonNullable<StudyWorkspace['repositoryLayoutOrigin']>,
    receipt: NonNullable<StudyWorkspace['layoutReceipt']>,
    measured: {
      retained: readonly vscode.TabGroup[]
      ownsExtraTabs: boolean
      mainGroups: readonly vscode.TabGroup[]
    },
  ): boolean {
    return (
      this.sameEditorGroups(saved.groups, measured.retained) &&
      this.sameStudyPanePositions(receipt.panes, receipt.sourceTargetColumn) &&
      measured.ownsExtraTabs &&
      saved.preservesOtherParts(measured.mainGroups.length)
    )
  }

  /**
   * Says whether an actual Return may still set the saved article grid, judged in the turn the main editor was measured; asked by {@link restoreRepositoryLayout}, which releases the receipt when it may not.
   * @param saved - The article origin the Return started from.
   * @param receipt - The Study receipt the Return started from.
   * @param measured - What was read after the measurement: the grid layout, the tab groups, the groups of the saved columns, whether the other groups hold only Codebook's tabs, and the main editor's groups.
   * @returns `true` when {@link isStudyLayoutUnchanged} and {@link canContractToArticle} both hold.
   * @example
   * ```ts
   * if (!this.holdsArticleReturn(saved, receipt, { layout, groups, retained, ownsExtraTabs, mainGroups: grid.groups })) return
   * ```
   */
  private holdsArticleReturn(
    saved: NonNullable<StudyWorkspace['repositoryLayoutOrigin']>,
    receipt: NonNullable<StudyWorkspace['layoutReceipt']>,
    measured: {
      layout: unknown
      groups: readonly vscode.TabGroup[]
      retained: readonly vscode.TabGroup[]
      ownsExtraTabs: boolean
      mainGroups: readonly vscode.TabGroup[]
    },
  ): boolean {
    return (
      this.isStudyLayoutUnchanged(saved, receipt, measured) &&
      this.canContractToArticle(saved, receipt, measured)
    )
  }

  /**
   * Gives the Study pane positions an actual Return remembers as the ones before it; read by {@link restoreRepositoryLayout} just before it releases the receipt and sets the article grid.
   * @param receipt - The Study receipt the Return leaves.
   * @returns The destination a cancelled reservation had verified, otherwise the positions the panes have now.
   * @example const before = this.studyPanesBeforeReturn(receipt)
   */
  private studyPanesBeforeReturn(
    receipt: NonNullable<StudyWorkspace['layoutReceipt']>,
  ): ReturnType<StudyWorkspace['studyPanePositions']> {
    // A cancelled reservation has not moved Context yet; retain its previously verified Study destination for the next visit.
    return receipt.pendingPanes ?? this.studyPanePositions()
  }

  /**
   * Says whether the editor restored the saved article grid; asked by {@link settleArticleReturn} with the layout the editor returned.
   * @param saved - The article origin that was set.
   * @param restoredLayout - The layout the editor reports after the set.
   * @param after - The Study pane positions read right after the set.
   * @returns `true` when the split proportions are the saved ones, the saved groups are in their columns, the other editor parts are preserved and the panes did not move since.
   * @example this.isArticleLayoutRestored(saved, restoredLayout, after)
   */
  private isArticleLayoutRestored(
    saved: NonNullable<StudyWorkspace['repositoryLayoutOrigin']>,
    restoredLayout: unknown,
    after: ReturnType<StudyWorkspace['studyPanePositions']>,
  ): boolean {
    return (
      isProportionalEditorLayout(saved.layout, restoredLayout) &&
      this.sameEditorGroups(
        saved.groups,
        vscode.window.tabGroups.all.filter((group) =>
          saved.groups.some((entry) => entry.column === group.viewColumn),
        ),
      ) &&
      saved.preservesOtherParts(saved.groups.length) &&
      this.sameStudyPanePositions(after)
    )
  }

  /**
   * Records the outcome of an actual Return once the editor answered with its layout: the restored article grid, or the layout error that asks the learner to arrange the panes; called by {@link restoreRepositoryLayout}, which checks its cancellation right after.
   * @param saved - The article origin that was set.
   * @param restoredLayout - The layout the editor reports after the set.
   * @param studyLayout - The Study grid measured before the set, kept for the next visit.
   * @param before - The Study pane positions before the set.
   * @param after - The Study pane positions read right after the set.
   * @example this.settleArticleReturn(saved, restoredLayout, layout, before, after)
   */
  private settleArticleReturn(
    saved: NonNullable<StudyWorkspace['repositoryLayoutOrigin']>,
    restoredLayout: unknown,
    studyLayout: unknown,
    before: ReturnType<StudyWorkspace['studyPanePositions']>,
    after: ReturnType<StudyWorkspace['studyPanePositions']>,
  ): void {
    // Native minimum sizes can expand the editor area; certify the saved split proportions, then retain exact returned pixels.
    if (!this.isArticleLayoutRestored(saved, restoredLayout, after)) {
      this.report(
        'layout',
        new Error(
          'The editor could not restore the saved reading layout. Arrange the reading panes manually.',
        ),
      )
      return
    }
    this.repositoryLayoutRestored = {
      signature: JSON.stringify(restoredLayout),
      studyLayout,
      groups: vscode.window.tabGroups.all.map((group) => ({
        group,
        column: group.viewColumn,
      })),
      before,
      after,
    }
    this.sourceGroup = this.repositoryLayoutRestored.after.sourceGroup
    this.errors.delete('layout')
    this.publish()
  }

  /** Switches explicit reader entry between owned layouts without merging groups or replacing manual arrangements. @example await this.arrange(signal, 'repository', true) */
  private async arrange(
    signal?: AbortSignal,
    mode: 'study' | 'repository' = 'study',
    ownedOnly = false,
    focus?: RepositoryLayoutFocus,
    beforeScopeFocus?: (acquire?: RepositoryFocusTarget) => void,
    retiredContextGroup?: vscode.TabGroup,
  ): Promise<void> {
    await this.withLayout(signal, async (lifetime, assertCurrent) => {
      // A retained Study layout still queues Wiki entry; hand off its original focus before reading or returning early.
      focus?.begin()
      if (ownedOnly) {
        const receipt = this.layoutReceipt
        if (!receipt || receipt.mode === mode) return
        if (
          !this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all)
        ) {
          this.layoutReceipt = undefined
          return
        }
        const { layout } = await this.readMainEditorGrid(
          signal,
          assertCurrent,
          focus?.acquireSourceFocus,
          beforeScopeFocus,
        )
        // Structure, sizes and native group identities must all still match our last completed arrangement.
        const groups = vscode.window.tabGroups.all
        if (
          receipt !== this.layoutReceipt ||
          JSON.stringify(layout) !== receipt.signature ||
          !this.sameEditorGroups(receipt.groups, groups) ||
          (receipt.mode === 'study-reentry' &&
            !this.sameStudyPanePositions(
              receipt.panes,
              receipt.sourceTargetColumn,
            ))
        ) {
          this.layoutReceipt = undefined
          return
        }
        // Reentry already restored its known Study grid; promote its validated receipt without overwriting geometry again.
        if (mode === 'study' && receipt.mode === 'study-reentry') {
          this.layoutReceipt = {
            ...receipt,
            mode,
            panes: this.studyPanePositions(),
            sourceTargetColumn: undefined,
          }
          this.errors.delete('layout')
          this.publish()
          return
        }
      }
      const retiredIdentity =
        retiredContextGroup &&
        this.editorGroupIdentities.get(retiredContextGroup)
      /** Says how far the editor has closed the retired context pane: its tab first, then the group that tab left empty. */
      const retirementStage = (): 'tab' | 'group' | 'gone' =>
        this.hasRetiredStudyPaneTab()
          ? 'tab'
          : retiredIdentity !== undefined &&
              vscode.window.tabGroups.all.some(
                (group) =>
                  this.editorGroupIdentities.get(group) === retiredIdentity,
              )
            ? 'group'
            : 'gone'
      /**
       * Reads how far the retirement is when a measurement begins; asked by {@link measure} before it reads the grid.
       * @returns The stage {@link retirementStage} names while a context pane is being retired, `undefined` when none is.
       * @example const stage = retirementStageAtStart() // => 'tab' right after the pane was disposed
       */
      const retirementStageAtStart = ():
        ReturnType<typeof retirementStage> | undefined =>
        retiredContextGroup && retirementStage()
      /**
       * Says whether a failed measurement keeps its refusal; asked by {@link measure} in the turn the measurement threw.
       * @param stage - The stage {@link retirementStageAtStart} read before the measurement.
       * @returns `true` when no pane is being retired or the retirement did not advance meanwhile, `false` when the editor closed the retired tab or group during the measurement.
       * @example if (hasRetirementStayedAt(stage)) throw error
       */
      const hasRetirementStayedAt = (
        stage: ReturnType<typeof retirementStageAtStart>,
      ): boolean => stage === undefined || stage === retirementStage()
      /**
       * Measures the main editor, and measures it again when the editor closed the retired pane's tab or its emptied group while the measurement waited: Cursor does both a moment after the pane was disposed.
       * @returns The grid {@link readMainEditorGrid} measured.
       * @throws What the measurement threw, when the retirement did not advance while it waited.
       * @example const grid = await measure()
       */
      const measure = async (): ReturnType<
        StudyWorkspace['readMainEditorGrid']
      > => {
        const stage = retirementStageAtStart()
        try {
          return await this.readMainEditorGrid(
            signal,
            assertCurrent,
            focus?.acquireSourceFocus,
            beforeScopeFocus,
          )
        } catch (error) {
          assertCurrent()
          // Any other change during the measurement is the learner's and keeps its refusal.
          if (hasRetirementStayedAt(stage)) throw error
          return measure()
        }
      }
      // The editor closes a disposed pane's tab a moment after dispose(); a grid measured before that would still count the retired Study group as occupied, so the one measurement waits for it.
      if (retiredContextGroup && this.hasRetiredStudyPaneTab()) {
        await this.retiredStudyPaneClosed(signal)
        assertCurrent()
      }
      const grid = await measure()
      const groupCount = this.studyGroupCount()
      // Cursor gives every group a new object with each tab change, so the retired group is known by its identity as well as by its object.
      const lastGroup = grid.groups.at(-1)
      const retiredGroup =
        lastGroup !== undefined &&
        (lastGroup === retiredContextGroup ||
          (retiredIdentity !== undefined &&
            this.editorGroupIdentities.get(lastGroup) === retiredIdentity))
          ? lastGroup
          : undefined
      // Only the just-retired, now-empty owned summary group can disappear during live entry.
      const canRetireContext =
        (this.liveComposition || this.summaryComposition) &&
        retiredGroup !== undefined &&
        grid.groups.length === groupCount + 1 &&
        retiredGroup.tabs.length === 0
      if (grid.groups.length > groupCount && !canRetireContext) {
        this.layoutReceipt = undefined
        this.report(
          'layout',
          new Error(
            'Existing editor groups were preserved. Use the focus commands or arrange the Codebook panes manually.',
          ),
        )
        return
      }
      this.layoutReceipt = undefined
      const retainedGroups = canRetireContext
        ? grid.groups.filter((group) => group !== retiredGroup)
        : grid.groups
      const measuredLayout =
        mode === 'study' && retainedGroups.length === groupCount
          ? grid.layout
          : undefined
      assertCurrent()
      grid.assertUnchanged()
      const requestedLayout = this.studyLayout()
      const contextColumn =
        STUDY_PRESENTATIONS[this.presentationMode].contextColumn
      // Creation ownership comes from this reservation's current grid, never the original-layout note of a partial Open.
      const createsContextGroup =
        mode === 'study' &&
        !this.liveComposition &&
        !this.summaryComposition &&
        contextColumn > grid.groups.length
      // Keep an already balanced flat split stable; a collapsed app/source split needs native pixels to escape its minimum.
      const studyLayout =
        (this.liveComposition || this.summaryComposition) &&
        isProportionalEditorLayout(requestedLayout, measuredLayout)
          ? requestedLayout
          : (toPixelEditorLayout(requestedLayout, measuredLayout) ??
            requestedLayout)
      // The workbench accepts both native effects together; its interim split sizes are not a receipt.
      await vscode.commands.executeCommand('runCommands', {
        commands: [
          {
            command: 'vscode.setEditorLayout',
            args:
              mode === 'study'
                ? studyLayout
                : {
                    orientation: HORIZONTAL_EDITOR_ORIENTATION,
                    groups: Array.from(
                      { length: grid.groups.length },
                      () => ({}),
                    ),
                  },
          },
          ...(mode === 'repository'
            ? ['workbench.action.evenEditorWidths']
            : []),
        ],
      })
      // Capture actual created identity before the ownership read can wait; a later replacement clears this receipt instead of being claimed by its column.
      if (createsContextGroup && grid.preservesOtherParts(groupCount)) {
        this.pendingCreatedContextColumn = contextColumn
        const created = vscode.window.tabGroups.all.find(
          (group) => group.viewColumn === contextColumn,
        )
        this.pendingCreatedContextGroup =
          created && this.editorGroupIdentities.get(created)
      }
      // The arrangement's sizes are the groups' own from here on: nothing an Expand of the reader's took is owed any more.
      this.groupSizesBeforeExpand = undefined
      // Drain the accepted batch after navigation abort, then let only a newer intent change the layout again.
      const receipt = await this.rememberLayout(mode, lifetime, retainedGroups)
      assertCurrent()
      const preservesOtherParts = grid.preservesOtherParts(
        mode === 'study' ? groupCount : grid.groups.length,
      )
      // runCommands reports child failures through host notifications, so only the actual layout can certify success.
      if (!receipt || !preservesOtherParts) {
        this.layoutReceipt = undefined
        // The receipt read's own failure (a changed group, a grid that never settled) is the cause; keep it readable instead of replacing it.
        const cause = this.layoutReceiptFailure
          ? ` Cause: ${this.layoutReceiptFailure}`
          : ''
        // The Study panes have a command that applies their layout again; the line names it.
        this.report(
          'layout',
          new Error(
            mode === 'study'
              ? `The Codebook panes were not arranged: the editor did not keep the layout Codebook applied. Run "Codebook: Arrange Study Workspace" to apply it again.${cause}`
              : `The editor did not retain the requested Codebook layout. Use the focus commands or arrange the Codebook panes manually.${cause}`,
          ),
        )
        return
      }
      this.errors.delete('layout')
      this.publish()
    })
  }

  /**
   * Says whether the tab of a Study pane this reader disposed is still in the editor's tab model; called by {@link arrange} on a live or recording entry.
   * This host has one Study pane at most, so while it holds none, a Study pane tab that is not an earlier host's leftover is the disposed one.
   * @returns `true` until the editor has closed the disposed pane's tab.
   * @example if (retiredContextGroup && this.hasRetiredStudyPaneTab()) await this.retiredStudyPaneClosed(signal)
   */
  private hasRetiredStudyPaneTab(): boolean {
    return !this.contextPanel && this.hasUnownedPaneTab('codebook.studyContext')
  }

  /**
   * Says whether the editor's tab model still holds a tab of a pane this reader disposed, for {@link hasRetiredStudyPaneTab} and {@link close}: the editor closes a disposed pane's tab a moment after the disposal.
   * Asked while the reader holds no pane of the named kinds; an earlier host's leftover pane is not counted.
   * @param kinds - The pane view types to look for.
   * @returns `true` until the editor has closed every such tab.
   * @example
   * ```ts
   * this.hasUnownedPaneTab('codebook.scopedBrowser', 'codebook.studyContext') // => true for about 100 ms after Close disposed both panes in Cursor
   * ```
   */
  private hasUnownedPaneTab(...kinds: string[]): boolean {
    return vscode.window.tabGroups.all.some((group) =>
      group.tabs.some(
        (tab) =>
          this.isCodebookPaneInput(tab.input, ...kinds) &&
          !this.inheritedPaneTabs.has(tab),
      ),
    )
  }

  /**
   * Waits until the editor has closed the tab of the Study pane a live or recording entry disposed, so {@link arrange} measures the groups that remain.
   * VS Code closes a disposed editor from a worker that runs after the calls already queued for its window, and then removes the group the tab left empty; a grid read answered before that named three groups in a window that holds only Codebook's panes ("Existing editor groups were preserved").
   * @param signal - The entry's cancellation.
   * @returns Once the tab is gone, or after {@link PRESENTATION_READY_TIMEOUT_MS}: the arrangement then judges the groups as they are.
   * @throws The signal's reason once it aborts.
   * @example await this.retiredStudyPaneClosed(signal)
   */
  private async retiredStudyPaneClosed(signal?: AbortSignal): Promise<void> {
    await waitUntil(
      () => !this.hasRetiredStudyPaneTab(),
      'the retired Study pane to close',
      PRESENTATION_READY_TIMEOUT_MS,
      signal,
    ).catch(() => {
      // A pane the editor keeps is no reason to end the entry; only the caller's own cancellation is.
      signal?.throwIfAborted()
    })
  }

  /**
   * Retains actual accepted layout effects for newer navigation while {@link close} invalidates the owner; called by {@link arrange} right after its layout command.
   * It reads the editor's layout until it has the arrangement's proportions, and takes that read as the receipt. A Study layout the editor answered with the Study's groups at other sizes gets one more step here ({@link studyLayoutPixelPass}): {@link arrange} has to send proportions when the grid it measured gave one axis only, both editors can answer proportions with every group but the last of its siblings at one pixel, and the grid that answer made has the nested split whose two axes give the pixels.
   * @param mode - The arrangement that was applied.
   * @param lifetime - The reader lifetime the arrangement belongs to.
   * @param retainedGroups - The main editor's groups the arrangement kept.
   * @returns The receipt of a layout the editor kept, also stored as {@link layoutReceipt}; `undefined` when the groups or panes changed while the grid settled, when the grid never had the proportions (the reason is reported and kept in {@link layoutReceiptFailure}), and when it stayed at other sizes with the Study's groups for {@link STUDY_LAYOUT_STABLE_MISMATCH_MS}.
   * @example await this.rememberLayout('study', lifetime, groups)
   */
  private async rememberLayout(
    mode: 'study' | 'repository',
    lifetime: number,
    retainedGroups: readonly vscode.TabGroup[],
  ): Promise<StudyWorkspace['layoutReceipt']> {
    this.assertLifetime(lifetime)
    this.layoutReceiptFailure = undefined
    const appliesPixelsOnce = this.studyLayoutPixelPass()
    const groups = vscode.window.tabGroups.all.map((group) => ({
      group,
      column: group.viewColumn,
    }))
    const panes = this.studyPanePositions()
    let stableMismatch: { signature: string; sinceMs: number } | undefined
    const settled = await waitUntil(
      async () => {
        const actual = await vscode.commands.executeCommand<unknown>(
          'vscode.getEditorLayout',
        )
        this.assertLifetime(lifetime)
        if (
          !this.sameEditorGroups(groups, vscode.window.tabGroups.all) ||
          !this.sameStudyPanePositions(panes)
        )
          throw new Error(
            'Native layout ownership changed while the workbench settled.',
          )
        if (
          mode === 'study'
            ? isProportionalEditorLayout(this.studyLayout(), actual)
            : isBalancedEditorLayout(actual, mode)
        )
          return { layout: actual }
        // A stable same-topology rejection is a usable focused-reader case, not a confirmed three-pane receipt.
        const signature = JSON.stringify(actual),
          nowMs = performance.now()
        if (
          mode === 'study' &&
          editorLayoutGroupCount(actual) === this.studyGroupCount()
        ) {
          // The grid has the Study's groups at other sizes: the layout is applied once more, in the pixels this grid measures.
          if (await appliesPixelsOnce(actual)) return false
          if (
            stableMismatch?.signature === signature &&
            nowMs - stableMismatch.sinceMs >= STUDY_LAYOUT_STABLE_MISMATCH_MS
          )
            return { layout: undefined }
          if (stableMismatch?.signature !== signature)
            stableMismatch = { signature, sinceMs: nowMs }
        } else stableMismatch = undefined
        return false
      },
      'settled reader grid',
      PRESENTATION_READY_TIMEOUT_MS,
    ).catch((error) => {
      this.assertLifetime(lifetime)
      this.layoutReceiptFailure = String(error)
      this.report('layout', error)
      return undefined
    })
    this.assertLifetime(lifetime)
    const layout = settled && settled.layout
    // Changed split ratios, topology or native groups never become newly owned during a receipt read.
    const current = vscode.window.tabGroups.all
    return (this.layoutReceipt =
      layout &&
      editorLayoutGroupCount(layout) === this.studyGroupCount() &&
      retainedGroups.every((group) =>
        current.some(
          (candidate) =>
            this.editorGroupIdentities.get(group) &&
            this.editorGroupIdentities.get(candidate) ===
              this.editorGroupIdentities.get(group),
        ),
      ) &&
      this.sameEditorGroups(groups, current) &&
      (mode === 'study'
        ? isProportionalEditorLayout(this.studyLayout(), layout)
        : isBalancedEditorLayout(layout, mode))
        ? {
            mode,
            signature: JSON.stringify(layout),
            groups,
            panes: this.studyPanePositions(),
          }
        : undefined)
  }

  /**
   * Makes the step that applies the Study layout a second time in pixels, at most once for one arrangement; called by {@link rememberLayout}, which asks it for every read that has the Study's groups without its proportions.
   * {@link arrange} sends pixels when the grid it measured has a nested split, whose two axes give the editor area ({@link toPixelEditorLayout}). A flat grid gives one axis only: the learner's two groups side by side with the Study pane's new group beside them are three columns, and the layout goes out in proportions. Both editors then left the Application group at one pixel and the split was never confirmed, so the Open went on to a Read of the explanation (measured natively on 2026-10-07 in VS Code 1.140.0 for Linux, three takes: a first column of 1 px with rows of 1 and 687 px beside 1269 px; Cursor 3.23.12: 1 px with rows of 1 and 657 px beside 659 px). The grid that answer made is nested, so its read gives both axes.
   * A grid the editor really cannot give the proportions (a window too narrow for three groups) gets the same one step, to no effect, and is then taken as it is. The current main-editor proof ({@link isMainEditorLayout}) is required immediately before that extra command: a focus change during the read must not apply these pixels to Cursor's separate chat part.
   * @returns A function that takes a layout read and answers `true` when it applied the Study layout in that read's pixels; `false` on every later call, when the read measures no pixels, or when the main editor is no longer known to own the command.
   * @example
   * ```ts
   * const appliesPixelsOnce = this.studyLayoutPixelPass()
   * if (await appliesPixelsOnce(actual)) return false // read the grid again
   * ```
   */
  private studyLayoutPixelPass(): (actual: unknown) => Promise<boolean> {
    let isStillOwed = true
    return async (actual: unknown): Promise<boolean> => {
      if (!isStillOwed) return false
      isStillOwed = false
      const pixels = toPixelEditorLayout(this.studyLayout(), actual)
      // A reply captured in the main editor does not authorize a mutation in a chat part that gained focus while it waited.
      if (!pixels || !this.isMainEditorLayout(actual)) return false
      await vscode.commands.executeCommand('vscode.setEditorLayout', pixels)
      return true
    }
  }

  /** Retains logical ownership across Cursor's wrapper-only tab-model resync, never across moved or replaced groups. @example this.observeEditorGroups(event) */
  private observeEditorGroups(event?: vscode.TabGroupChangeEvent): void {
    const current = vscode.window.tabGroups.all,
      previous = this.observedEditorGroups
    // Actual Return retains verified main scope while its Study receipt is released; later wrapper refreshes must preserve that boundary too.
    const signature =
      this.layoutReceipt?.signature ?? this.repositoryLayoutRestored?.signature
    const placementScope = this.presentationEditorScope
    // Only this live placement may retain its measured part boundary after releasing the old layout confirmation.
    const placementMainCount =
      placementScope &&
      this.placingPresentation &&
      placementScope.lifetime === this.lifetime &&
      placementScope.signal ===
        this.presentationTransition?.cancellation.signal &&
      !placementScope.signal.aborted
        ? placementScope.mainCount
        : undefined
    const mainCount =
      placementMainCount ??
      (signature === undefined
        ? undefined
        : editorLayoutGroupCount(JSON.parse(signature)))
    // A unique unchanged empty foreign part may refresh its wrapper; main empty groups and lifecycle changes stay unowned.
    const emptyOutsideBefore =
      mainCount === undefined
        ? []
        : previous.filter(
            (entry) => entry.column > mainCount && !entry.group.tabs.length,
          )
    const emptyOutsideAfter =
      mainCount === undefined
        ? []
        : current.filter(
            (group) => group.viewColumn > mainCount && !group.tabs.length,
          )
    const emptyOutsideMatch =
      event &&
      !event.opened.length &&
      !event.closed.length &&
      current.length === previous.length &&
      emptyOutsideBefore.length === 1 &&
      emptyOutsideAfter.length === 1 &&
      emptyOutsideBefore[0]!.column === emptyOutsideAfter[0]!.viewColumn &&
      event.changed.includes(emptyOutsideAfter[0]!)
        ? { before: emptyOutsideBefore[0]!, after: emptyOutsideAfter[0]! }
        : undefined
    // Cursor answers every tab that opened, closed or became active with a model in which each group is a new object: no tab object survives either, so a tab without a known input is known by its label there.
    const everyGroupReplaced = Boolean(
      event &&
      previous.length &&
      previous.every((entry) => !current.includes(entry.group)) &&
      current.every(
        (group) =>
          event.opened.includes(group) || event.changed.includes(group),
      ),
    )
    // Opened/closed groups never inherit identity; only changed replacement wrappers may represent survivors.
    const survivors = event
      ? previous.filter(
          (entry) =>
            !event.closed.includes(entry.group) &&
            !current.includes(entry.group),
        )
      : []
    const replacements = event
      ? current
          .filter(
            (group) =>
              !this.editorGroupIdentities.has(group) &&
              !event.opened.includes(group) &&
              event.changed.includes(group),
          )
          .map((group) => ({
            group,
            matches: survivors.filter(
              (entry) =>
                this.retainsEditorTabs(
                  entry.group,
                  group,
                  everyGroupReplaced,
                ) ||
                (emptyOutsideMatch?.before === entry &&
                  emptyOutsideMatch.after === group),
            ),
          }))
      : []
    // Exact survivors precede copied contraction tabs; ambiguous exact candidates cannot fall back to a weaker match.
    const exactReplacements = replacements.map(({ group, matches }) => ({
      group,
      matches: matches.filter(
        (entry) => entry.group.tabs.length === group.tabs.length,
      ),
    }))
    const expandedReplacements = replacements.map(({ group, matches }) => ({
      group,
      matches: exactReplacements.some(
        (replacement) =>
          replacement.group === group && replacement.matches.length,
      )
        ? []
        : matches.filter(
            (entry) =>
              !exactReplacements.some((replacement) =>
                replacement.matches.includes(entry),
              ),
          ),
    }))
    /**
     * Says whether the event opened or closed a group or changed how many there are; asked by {@link replacedEveryGroupInPlace}.
     * @returns `true` when the set of groups changed, `false` when the event only changed groups that stay.
     * @example hasGroupSetChanged() // => false for a tab change that replaced three groups by three
     */
    const hasGroupSetChanged = (): boolean =>
      Boolean(event?.opened.length) ||
      Boolean(event?.closed.length) ||
      current.length !== previous.length
    /**
     * Says whether the event replaced every group object while the set of groups stayed; the first condition of {@link emptySurvivor}.
     * @returns `true` when every group was replaced and none was opened or closed.
     * @example replacedEveryGroupInPlace() // => true after Cursor replaced every group object for one opened tab
     */
    const replacedEveryGroupInPlace = (): boolean =>
      everyGroupReplaced && !hasGroupSetChanged()
    /**
     * Says whether another group of the event was recognized by its tabs; the last condition of {@link emptySurvivor}, asked only for a group without tabs.
     * @returns `true` when a replaced group has exactly one match.
     * @example hasRecognizedReplacement()
     */
    const hasRecognizedReplacement = (): boolean =>
      replacements.some(({ matches }) => matches.length === 1)
    /**
     * Finds the group that alone stood in a group's column before the event and had no tabs; the survivor {@link emptySurvivor} names.
     * @param group - The group that is not yet known.
     * @returns The only earlier group of that column when it was empty, otherwise `undefined`.
     * @example soleEmptyGroupBefore(group)
     */
    const soleEmptyGroupBefore = (
      group: vscode.TabGroup,
    ): (typeof previous)[number] | undefined => {
      const sameColumn = previous.filter(
        (entry) => entry.column === group.viewColumn,
      )
      return sameColumn.length === 1 && !sameColumn[0]!.group.tabs.length
        ? sameColumn[0]
        : undefined
    }
    /**
     * Finds the earlier group that a group without tabs still is; asked by the loop below for every group that is neither opened nor known.
     * A group without tabs has nothing to be recognized by; it stays the same group when every group was replaced in its own column and another group of that event was recognized by its tabs.
     * @param group - A group of the editor's current model.
     * @returns The earlier group of the same column, or `undefined` when the group has tabs, the event did not replace every group in place, or no other group was recognized by its tabs.
     * @example const emptyMatch = emptySurvivor(group)
     */
    const emptySurvivor = (
      group: vscode.TabGroup,
    ): (typeof previous)[number] | undefined => {
      if (
        !replacedEveryGroupInPlace() ||
        group.tabs.length ||
        !hasRecognizedReplacement()
      )
        return undefined
      return soleEmptyGroupBefore(group)
    }
    for (const group of current) {
      if (event?.opened.includes(group)) {
        this.editorGroupIdentities.set(group, Symbol())
        continue
      }
      if (this.editorGroupIdentities.has(group)) continue
      const emptyMatch = emptySurvivor(group)
      if (emptyMatch) {
        this.editorGroupIdentities.set(
          group,
          this.editorGroupIdentities.get(emptyMatch.group) ?? Symbol(),
        )
        continue
      }
      const candidates = exactReplacements.some(
        (replacement) =>
          replacement.group === group && replacement.matches.length,
      )
        ? exactReplacements
        : expandedReplacements
      const matches =
          candidates.find((replacement) => replacement.group === group)
            ?.matches ?? [],
        match = matches.length === 1 ? matches[0] : undefined
      // Content must identify one survivor in both directions before column equality can reject a manual move.
      const retained =
        match &&
        candidates.filter((replacement) => replacement.matches.includes(match))
          .length === 1 &&
        match.column === group.viewColumn
      this.editorGroupIdentities.set(
        group,
        retained
          ? (this.editorGroupIdentities.get(match.group) ?? Symbol())
          : Symbol(),
      )
    }
    this.observedEditorGroups = current.map((group) => ({
      group,
      column: group.viewColumn,
    }))
  }

  /**
   * Says whether two tabs carry the same label and the same dirty, preview and pinned flags: what a tab without a known input is described by; asked by {@link retainsEditorTabs} when it counts the equal tabs that precede one.
   * @param candidate - A tab of the same group.
   * @param tab - The tab that is being named.
   * @returns `true` when the label and the three flags are equal.
   * @example this.hasSameTabState(secondChatTab, firstChatTab) // => true for two chat tabs labelled alike
   */
  private hasSameTabState(candidate: vscode.Tab, tab: vscode.Tab): boolean {
    return (
      candidate.label === tab.label &&
      candidate.isDirty === tab.isDirty &&
      candidate.isPreview === tab.isPreview &&
      candidate.isPinned === tab.isPinned
    )
  }

  /**
   * Recognizes surviving tab order during wrapper replacement, allowing additions from group contraction but rejecting ambiguous inputs; called by {@link observeEditorGroups} for every replaced group object.
   * @param before - The group object the editor replaced, with the tabs it held last.
   * @param after - A new group object of the same event.
   * @param everyGroupReplaced - Whether the event replaced every group object, as Cursor does with each tab change. No tab or input object survives such an event, so a tab without a known input (an agent chat, a settings page) is then recognized by its label, its flags and its place among equal tabs, also in a group that holds no known tab.
   * @returns
   * - `true` when every tab of `before` is in `after`, in the same order
   * - `false` when a tab is gone, reordered or cannot be told apart
   * @example
   * ```ts
   * this.retainsEditorTabs(before, after, false)
   * ```
   */
  private retainsEditorTabs(
    before: vscode.TabGroup,
    after: vscode.TabGroup,
    everyGroupReplaced: boolean,
  ): boolean {
    const knownKey = (tab: vscode.Tab) =>
      tab.input instanceof vscode.TabInputText
        ? `text:${tab.input.uri.toString()}`
        : tab.input instanceof vscode.TabInputWebview &&
            isCodebookPaneViewType(tab.input.viewType)
          ? `webview:${tab.input.viewType}`
          : undefined
    // A known source/pane anchors an unchanged foreign tab only when its native input survives.
    const hasKnownAnchor =
      before.tabs.some((tab) => knownKey(tab) !== undefined) &&
      after.tabs.some((tab) => knownKey(tab) !== undefined)
    /** Names a tab without a known input in an event that replaced every object: equal tabs of one group are told apart by their order. */
    const replacedForeignKey = (
      tab: vscode.Tab,
      tabs: readonly vscode.Tab[],
    ): string | undefined => {
      if (!tab.label) return undefined
      const description = JSON.stringify([
        tab.label,
        tab.isDirty,
        tab.isPreview,
        tab.isPinned,
      ])
      /**
       * Says whether the description of the named tab fits another tab of its group too; the filter of the tabs that precede it.
       * @param candidate - A tab of the same group.
       * @returns `true` for a tab without a known input that has the same label and state.
       * @example tabs.slice(0, tabs.indexOf(tab)).filter(describes).length // => 1 for the second of two equal tabs
       */
      const describes = (candidate: vscode.Tab): boolean =>
        knownKey(candidate) === undefined &&
        this.hasSameTabState(candidate, tab)
      return `foreign:${description}:${tabs.slice(0, tabs.indexOf(tab)).filter(describes).length}`
    }
    const foreignKey = (tab: vscode.Tab, tabs: readonly vscode.Tab[]) => {
      if (everyGroupReplaced) return replacedForeignKey(tab, tabs)
      if (!hasKnownAnchor || !tab.label) return undefined
      const matches = before.tabs.filter(
        (original) =>
          knownKey(original) === undefined &&
          (original === tab ||
            (typeof tab.input === 'object' &&
              tab.input !== null &&
              original.input === tab.input)),
      )
      if (matches.length !== 1) return undefined
      const original = matches[0]!
      if (
        original.label !== tab.label ||
        original.isDirty !== tab.isDirty ||
        original.isPreview !== tab.isPreview ||
        original.isPinned !== tab.isPinned
      )
        return undefined
      return `foreign:${before.tabs.indexOf(original)}`
    }
    const key = (tab: vscode.Tab, tabs: readonly vscode.Tab[] = after.tabs) =>
      knownKey(tab) ?? foreignKey(tab, tabs)
    const previous = before.tabs.map((tab) => key(tab, before.tabs)),
      current = after.tabs.map((tab) => key(tab))
    if (
      !previous.length ||
      previous.includes(undefined) ||
      current.includes(undefined)
    )
      return false
    if (
      new Set(previous).size !== previous.length ||
      new Set(current).size !== current.length
    ) {
      const scope = this.presentationEditorScope
      // Cursor rebuilds wrappers while predecessor and successor coexist; only an exact owned overlap may survive.
      if (
        !scope ||
        !this.placingPresentation ||
        scope.lifetime !== this.lifetime ||
        scope.signal !== this.presentationTransition?.cancellation.signal ||
        scope.signal.aborted ||
        previous.length !== current.length ||
        previous.some((value, index) => value !== current[index])
      )
        return false
      return [...new Set(previous)].every((value) => {
        const count = previous.filter((candidate) => candidate === value).length
        if (count === 1) return true
        const overlap = value && scope.overlappingPanes.get(value)
        return Boolean(
          overlap &&
          before.viewColumn === overlap.column &&
          after.viewColumn === overlap.column &&
          count === overlap.tabCount &&
          before.tabs.every(
            (tab) => key(tab, before.tabs) !== value || !tab.isPreview,
          ) &&
          after.tabs.every((tab) => key(tab) !== value || !tab.isPreview) &&
          vscode.window.tabGroups.all
            .flatMap((group) => group.tabs)
            .filter((tab) => key(tab) === value).length === overlap.tabCount,
        )
      })
    }
    let retained = 0
    // Added tabs may interleave, but deleting or reordering any prior tab releases the old group identity.
    for (const value of current) if (value === previous[retained]) retained++
    return retained === previous.length
  }

  /** Checks stable group identity and grid position before {@link arrange} changes an owned layout. @example this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) */
  private sameEditorGroups(
    previous: NonNullable<StudyWorkspace['layoutReceipt']>['groups'],
    current: readonly vscode.TabGroup[],
  ): boolean {
    return (
      previous.length === current.length &&
      previous.every(({ group, column }) => {
        const identity = this.editorGroupIdentities.get(group)
        return (
          identity !== undefined &&
          current.some(
            (candidate) =>
              this.editorGroupIdentities.get(candidate) === identity &&
              candidate.viewColumn === column,
          )
        )
      })
    )
  }

  /**
   * Names the status line for a failed panel message, for the three panel listeners that call {@link receive}.
   * A replay control's failure gets its own line, which the next accepted replay control or loaded recording retires; `control` is retired only by a live-run action and would keep a replay refusal forever.
   * A Node test history message likewise gets its own line, which the next Node history message accepted outside browser replay retires.
   * @param value - The raw message the panel sent.
   * @returns `'replay-control'` for a valid playback message, `'node-history-control'` for a valid Node test history message, `'control'` for everything else.
   * @example
   * this.panelFailureKind({ type: 'playback', action: 'seek', revision: 4, expectedRevision: 2, positionMs: 0 }) // => 'replay-control'
   * this.panelFailureKind({ type: 'tab', revision: 4, tab: 'live' })                                              // => 'control'
   * this.panelFailureKind({ type: 'node-history', revision: 4, studyId: 'node-study' })                            // => 'node-history-control'
   */
  private panelFailureKind(
    value: unknown,
  ): Extract<
    ReaderErrorKind,
    'replay-control' | 'node-history-control' | 'control'
  > {
    const parsed = messageSchema.safeParse(value)
    if (!parsed.success) return 'control'
    if (parsed.data.type === 'playback') return 'replay-control'
    return parsed.data.type.startsWith('node-history')
      ? 'node-history-control'
      : 'control'
  }

  /**
   * Receives a webview's message and, when it asked to open a Saved studies entry by number, answers that webview once the request has ended.
   * Called by the three webview message listeners instead of {@link receive}, so a request the reader refuses, discards or fails releases the pane that waits for it. The reply goes to the sending webview only: the same Study message reaches several panes, and each counts its own requests.
   * @param value - The raw webview message.
   * @param origin - The pane family the webview belongs to.
   * @param owner - The panel or view whose webview sent the message.
   * @throws Whatever {@link receive} throws; the reply is posted first.
   * @example void this.receivePaneMessage(message, 'context', panel).catch((error) => this.report('control', error))
   */
  private async receivePaneMessage(
    value: unknown,
    origin: 'context' | 'moments',
    owner: vscode.WebviewPanel | vscode.WebviewView,
  ): Promise<void> {
    const reply = this.openReplyOwedTo(value, owner)
    const refusalsBefore = this.controlRefusals
    let isRejected = false
    try {
      await this.receive(value, origin, owner)
      this.retireControlRefusalUnlessNewer(value, refusalsBefore)
    } catch (error) {
      isRejected = true
      throw error
    } finally {
      // A rejected message started no Recording load, so its reply is never kept for one.
      if (reply)
        this.settleOpenRequest(
          reply.webview,
          reply.openRequest,
          reply.opensRecording && !isRejected,
        )
    }
  }

  /**
   * Reads, before a pane message is handled, the reply its sender is owed when it asked to open a Saved studies entry by number; called by {@link receivePaneMessage}.
   * The webview is taken now: a panel disposed while its message is handled throws when asked for it, which would replace the message's own error.
   * @returns The sender's webview, the request's number and whether the request arrived as a saved-study choice during Recording, whose load outlives the handling; `undefined` for a message that asks for no reply.
   * @example const reply = this.openReplyOwedTo(message, panel)
   */
  private openReplyOwedTo(
    value: unknown,
    owner: vscode.WebviewPanel | vscode.WebviewView,
  ):
    | {
        webview: Pick<vscode.Webview, 'postMessage'>
        openRequest: PaneOpenRequest['openRequest']
        opensRecording: boolean
      }
    | undefined {
    const request = readOpenRequest(value)
    if (!request) return undefined
    return {
      webview: owner.webview,
      openRequest: request.openRequest,
      opensRecording: request.type === 'history' && this.recordingActive,
    }
  }

  /**
   * Retires an earlier control refusal after a pane message was handled without an error, unless a control was refused meanwhile; called by {@link receivePaneMessage} right after {@link receive} returned.
   * @param value - The raw message that was handled.
   * @param refusalsBefore - The count of control refusals read before the message was handled.
   * @example this.retireControlRefusalUnlessNewer(message, refusalsBefore)
   */
  private retireControlRefusalUnlessNewer(
    value: unknown,
    refusalsBefore: number,
  ): void {
    // A control refused while this message was being handled is newer than this message and stays.
    if (this.controlRefusals === refusalsBefore)
      this.retireControlRefusal(value)
  }

  /**
   * Retires the line of an earlier refused pane control once a later choice of an entry, a tab or an item was handled without an error, so a refusal does not stay through later runs; called by {@link retireControlRefusalUnlessNewer} for {@link receivePaneMessage}.
   * @param value - The raw message that was handled; any message that is no such choice retires nothing.
   * @example this.retireControlRefusal({ type: 'history', revision: 4, studyId })
   */
  private retireControlRefusal(value: unknown): void {
    const parsed = messageSchema.safeParse(value)
    if (
      !parsed.success ||
      !CONTROL_RETIRING_MESSAGE_TYPES.has(parsed.data.type)
    )
      return
    if (this.dropChoiceRetiredErrors()) this.publish()
  }

  /**
   * Removes every reader line a handled choice retires; called by {@link retireControlRefusal} for a message that is such a choice.
   * @returns `true` when at least one line was there and is gone, so the reader has to be published; `false` when none was.
   * @example if (this.dropChoiceRetiredErrors()) this.publish()
   */
  private dropChoiceRetiredErrors(): boolean {
    // A Node test history's refusal has its own line (it is not a live-run control) and is as stale after the next handled choice.
    let isRetired = false
    for (const kind of CHOICE_RETIRED_ERROR_KINDS)
      isRetired = this.errors.delete(kind) || isRetired
    return isRetired
  }

  /**
   * Answers a pane's open request, or keeps the answer while the Recording load that request started is still in flight; called by {@link receivePaneMessage}.
   * @param webview - The webview that sent the request.
   * @param openRequest - The number the pane gave its request.
   * @param opensRecording - Whether the request arrived as a saved-study choice during Recording.
   * @example this.settleOpenRequest(panel.webview, 3, false)
   */
  private settleOpenRequest(
    webview: Pick<vscode.Webview, 'postMessage'>,
    openRequest: PaneOpenRequest['openRequest'],
    opensRecording: boolean,
  ): void {
    if (opensRecording && this.playback?.state().readiness === 'loading') {
      this.deferredOpenReplies.push({ webview, openRequest })
      // The oldest kept reply is posted once the queue is full; its pane only returns its list to the shown study.
      if (this.deferredOpenReplies.length > MAX_DEFERRED_OPEN_REPLIES) {
        const oldest = this.deferredOpenReplies.shift()!
        this.postOpenRequestSettled(oldest.webview, oldest.openRequest)
      }
      return
    }
    this.postOpenRequestSettled(webview, openRequest)
  }

  /** Posts the replies kept by {@link settleOpenRequest} once no Recording load is in flight; called by the playback controller's change callback. @example this.flushDeferredOpenReplies() */
  private flushDeferredOpenReplies(): void {
    if (this.playback?.state().readiness === 'loading') return
    for (const reply of this.deferredOpenReplies.splice(0))
      this.postOpenRequestSettled(reply.webview, reply.openRequest)
  }

  /** Tells one webview that the open request it numbered has ended; called by {@link settleOpenRequest} and {@link flushDeferredOpenReplies}. @example this.postOpenRequestSettled(panel.webview, 3) */
  private postOpenRequestSettled(
    webview: Pick<vscode.Webview, 'postMessage'>,
    openRequest: PaneOpenRequest['openRequest'],
  ): void {
    const reply: OpenRequestSettled = {
      type: 'open-request-settled',
      openRequest,
    }
    // The pane puts its list back on the shown study when it reads the reply, so the Study message that names that study goes first.
    this.publish()
    void webview.postMessage(reply)
  }

  /** Accepts only bounded named UI messages, rejecting stale controls before dispatch. @example await this.receive(message) */
  private async receive(
    value: unknown,
    origin: 'context' | 'moments',
    owner?: vscode.WebviewPanel | vscode.WebviewView,
  ): Promise<void> {
    if (
      owner &&
      (owner !==
        (origin === 'moments'
          ? this.moments
          : this.summaryComposition
            ? this.summaryView
            : this.contextPanel) ||
        (owner === this.summaryView &&
          (!this.opened || !this.recordingActive || this.closing)))
    )
      return
    const parsed = messageSchema.safeParse(value)
    if (!parsed.success) throw new Error('Unsupported reader message.')
    const message = parsed.data
    // Only an operation-local listener can accept these validated receipts; they never acknowledge rendering or a learner action.
    if (message.type === 'codebook-focus-receipt') return
    // Kept for the moment the summary's view is hidden; a report of another pane changes nothing.
    if (message.type === 'pane-focus') {
      if (owner !== undefined && owner === this.summaryView)
        this.summaryHeldFocus = message.focused
      // The Study pane's report is kept for an Arrange or an Enlarge, which leave a pane alone that has the keyboard.
      if (owner !== undefined && owner === this.contextPanel)
        this.studyPaneReportsKeyboard = message.focused
      return
    }
    await this.initialize()
    // Initialization can outlive a panel handoff; retired renderers never acknowledge or control its successor.
    if (
      owner &&
      (owner !==
        (origin === 'moments'
          ? this.moments
          : this.summaryComposition
            ? this.summaryView
            : this.contextPanel) ||
        (owner === this.summaryView &&
          (!this.opened || !this.recordingActive || this.closing)))
    )
      return
    if (message.type === 'ready') {
      this.lastPublished = undefined
      this.publish()
      return
    }
    if (message.type === 'presentation-pose') {
      const request = this.presentationPoseRequest,
        view = this.message(),
        model = view.model
      if (
        origin === 'context' &&
        this.presentationTransition &&
        request &&
        message.captureId === request.captureId &&
        message.presentationId === request.presentationId &&
        message.expectedRevision === request.expectedRevision &&
        message.revision === request.revision &&
        message.revision === this.revision &&
        message.itemId === request.itemId &&
        message.itemId === model.selection.itemId &&
        message.sourceHash === request.sourceHash &&
        message.sourceHash === model.source.hash &&
        message.studyId === request.studyId &&
        message.studyId === model.selection.studyId &&
        message.observationId === request.observationId &&
        message.observationId === model.observation?.id &&
        message.contentTab === request.contentTab &&
        message.contentTab === (view.contentTab ?? model.selection.tab)
      )
        this.presentationPose = message
      return
    }
    if (message.type === 'presentation-pose-restored') {
      if (
        origin === 'context' &&
        this.presentationTransition &&
        message.captureId === this.presentationPose?.captureId
      )
        this.presentationPoseRestored = message.captureId
      return
    }
    if (message.type === 'presentation-pose-invalidated') {
      if (
        origin === 'context' &&
        this.presentationTransition &&
        message.captureId === this.presentationPoseRequest?.captureId
      ) {
        this.presentationMovedFocus = false
        this.presentationTransition.cancellation.abort(
          new StudyError(
            'PRESENTATION_UNAVAILABLE',
            'The explanation reading position changed during placement; the newer learner input was preserved.',
          ),
        )
      }
      return
    }
    if (message.type === 'rendered') {
      const selected = this.message().model
      if (
        origin === 'context' &&
        !this.message().loading &&
        message.revision === this.revision &&
        message.itemId === selected.selection.itemId &&
        message.snapshotUri === selected.observation?.snapshotUri &&
        (!this.recordingActive ||
          message.presentationRevision ===
            this.playback?.state().presentationRevision)
      )
        this.lastRendered = message
      return
    }
    if (message.type === 'presentation') {
      // Layout recovery owns its diagnostic; generic controls keep their separate failure receipt.
      try {
        await this.changePresentation(message)
      } catch (error) {
        this.report('presentation', error)
      }
      return
    }
    // A request for a study's files that the pane sent by itself names its study and changes nothing, so it is answered whatever the reader shows by now. Refused like a control the learner pressed on a view that has changed, it would put a line into the pane for nothing the learner did. Only a window without a Trash answers it so: with a Trash the message is a deletion and keeps every check.
    if (
      message.type === 'delete-study' &&
      message.unprompted &&
      this.studyRemovalAvailability() === 'no-trash'
    ) {
      await this.removeSavedStudy(message.studyId, message.removalRequest)
      return
    }
    if (!(message.type === 'action' && message.action === 'stop'))
      this.assertPresentationIdle()
    if (message.revision !== this.revision)
      throw new Error(
        'The displayed study changed. Inspect the current view before acting.',
      )
    if (message.type === 'action') {
      if (message.action.startsWith('read-')) {
        try {
          await this.action(message.action)
        } catch (error) {
          this.report('reading', error)
        }
        return
      }
      await this.action(message.action)
    }
    if (message.type === 'select') await this.select(message.itemId)
    if (message.type === 'tab') {
      if (message.tab === 'recording') {
        const studyId =
          this.selection.studyId ??
          (await this.recordings!.readPreference())?.studyId
        if (!studyId)
          throw new Error('Select a saved study before opening its recording.')
        await this.openRecording(studyId)
      } else {
        const wasRecording = this.recordingActive
        this.leavePlayback()
        // Leaving Recording retires the line of a finished removal, as choosing another entry does: a refusal that told the learner to leave Recording first is no longer true under a delete button that can be used again.
        if (wasRecording) this.dismissStudyRemoval()
        if (this.selection.tab !== message.tab || wasRecording)
          this.readerSelectionRevision++
        this.selection = { ...this.selection, tab: message.tab }
        if (wasRecording) await this.open()
        await this.renderSelection()
        this.publish()
        await this.saveSelection()
      }
    }
    if (message.type === 'playback') {
      if (!this.recordingActive || !this.selection.studyId)
        throw new Error('Open a recording before controlling playback.')
      const identity = {
        studyId: this.selection.studyId,
        expectedRevision: message.expectedRevision,
      }
      if (message.action === 'seek') {
        if (message.positionMs === undefined)
          throw new Error('Seek requires a recorded position.')
        this.playback!.command({
          ...identity,
          action: 'seek',
          positionMs: message.positionMs,
        })
      } else {
        if (message.positionMs !== undefined)
          throw new Error('Only Seek accepts a position.')
        this.playback!.command({ ...identity, action: message.action })
      }
      // The control was accepted, so an earlier refusal no longer describes the replay.
      this.replayControlAccepted()
    }
    if (message.type === 'understanding')
      await this.understand(message.understood)
    if (message.type === 'delete-study') {
      await this.removeSavedStudy(message.studyId, message.removalRequest)
      return
    }
    if (message.type === 'copy-study-files') {
      await this.copyStudyFiles(message.studyId, owner?.webview)
      return
    }
    // Choosing another entry retires the last removal's outcome line.
    if (message.type === 'node-history' || message.type === 'history')
      this.dismissStudyRemoval()
    // A Node history message accepted outside browser replay answers an earlier refusal of one, which no live-run action retires.
    if (
      message.type.startsWith('node-history') &&
      !this.recordingActive &&
      this.errors.delete('node-history-control')
    )
      this.publish()
    if (message.type === 'node-history') {
      if (this.recordingActive)
        throw new Error(
          'Close browser replay before opening a separate Node test history.',
        )
      const request = ++this.historyRequest
      this.studyChoices++
      this.pendingNodeHistory = request
      this.loading = true
      this.publish()
      try {
        await this.replaceUnavailableReplayDebugger()
        const history = await this.nodeHistoryStore!.read(message.studyId)
        if (
          request !== this.historyRequest ||
          message.revision !== this.revision ||
          this.closing
        )
          return
        let learningDecision: NodeTestHistoryLearningDecision | undefined
        try {
          learningDecision = await this.nodeHistoryStore!.readLearningDecision(
            message.studyId,
          )
        } catch (error) {
          this.report('progress', error)
        }
        if (
          request !== this.historyRequest ||
          message.revision !== this.revision ||
          this.closing
        )
          return
        let learningMaterial: NodeTestLearningMaterial | undefined
        try {
          learningMaterial = await this.nodeHistoryStore!.readLearningMaterial(
            message.studyId,
          )
        } catch (error) {
          this.report('history-learning', error)
        }
        if (
          request !== this.historyRequest ||
          message.revision !== this.revision ||
          this.closing
        )
          return
        let savedSequence: number | undefined, positionError: unknown
        try {
          savedSequence = await this.nodeHistoryStore!.readReaderPosition(
            message.studyId,
          )
        } catch (error) {
          positionError = error
        }
        if (
          request !== this.historyRequest ||
          message.revision !== this.revision ||
          this.closing
        )
          return
        this.nodeHistoryPlaybackController?.dispose()
        this.replayDebugger?.invalidate()
        this.selectedNodeHistoryRequest++
        this.selectedNodeHistory = history
        this.selectedNodeHistoryLearningDecision = learningDecision
        this.selectedNodeHistoryLearningMaterial = learningMaterial
        this.selectedNodeHistoryPage = 0
        this.selectedNodeHistorySequence = undefined
        this.selectedNodeHistoryDebugAvailable = false
        this.selectedNodeHistoryValuesUninspected = false
        // A Node history has no application frames; replace pixels from the prior browser study immediately.
        this.presentApplication(this.message())
        // Each opened history gets its own controller; the present callback is bound to this study.
        this.nodeHistoryPlaybackController = new NodeHistoryPlaybackController({
          present: async (sequence) => {
            const selectedHistory = this.selectedNodeHistory
            if (
              !selectedHistory ||
              selectedHistory.header.studyId !== message.studyId
            )
              throw new Error(
                'The selected Node history changed during playback.',
              )
            await this.selectNodeHistoryEvent(
              selectedHistory,
              sequence,
              false,
              false,
              false,
            )
          },
          changed: () => this.publish(),
          failed: (error) => this.report('control', error),
        })
        this.nodeHistoryPlaybackController.open(
          history.entries.map((entry) => ({
            sequence: entry.sequence,
            elapsedMs: entry.elapsedMs,
          })),
          savedSequence ?? history.entries[0]?.sequence,
        )
        if (positionError) this.report('history-position', positionError)
        const initialSequence = savedSequence ?? history.entries[0]?.sequence
        if (initialSequence !== undefined)
          await this.selectNodeHistoryEvent(
            history,
            initialSequence,
            false,
            false,
            false,
          )
        if (
          request !== this.historyRequest ||
          message.revision !== this.revision ||
          this.closing
        )
          return
        this.loading = false
        this.publish()
      } catch (error) {
        if (
          request !== this.historyRequest ||
          message.revision !== this.revision ||
          this.closing
        )
          return
        this.loading = false
        this.report('archive', error)
        this.publish()
      } finally {
        // A newer Node history request owns the marker by then.
        if (this.pendingNodeHistory === request)
          this.pendingNodeHistory = undefined
        // A request discarded only because the reader's revision changed is still the latest; nothing else ends the loading state it set.
        if (this.loading && this.isLatestHistoryRequest(request)) {
          this.loading = false
          this.publish()
        }
      }
    }
    if (message.type === 'node-history-understanding') {
      if (this.recordingActive)
        throw new Error(
          'Close browser replay before saving a separate Node test learning choice.',
        )
      if (
        !this.selectedNodeHistory ||
        this.selectedNodeHistory.header.studyId !== message.studyId
      )
        throw new Error(
          'Select the matching Node test history before saving an understanding choice.',
        )
      const decision = await this.nodeHistoryStore!.saveLearningDecision(
        message.studyId,
        message.understood,
      )
      if (
        this.selectedNodeHistory?.header.studyId === message.studyId &&
        !this.closing
      ) {
        this.selectedNodeHistoryLearningDecision = decision
        this.publish()
      }
    }
    if (message.type === 'node-history-material') {
      if (this.recordingActive)
        throw new Error(
          'Close browser replay before saving separate Node learning material.',
        )
      if (
        !this.selectedNodeHistory ||
        this.selectedNodeHistory.header.studyId !== message.studyId
      )
        throw new Error(
          'Select the matching Node test history before saving its learning material.',
        )
      const material = await this.service?.explainNodeHistory({
        studyId: message.studyId,
        expectedRevision: message.expectedRevision,
        content: message.content,
      })
      if (!material)
        throw new Error(
          'Node learning material could not be saved because the Codebook service is unavailable.',
        )
      if (
        this.selectedNodeHistory?.header.studyId === message.studyId &&
        !this.closing
      ) {
        this.selectedNodeHistoryLearningMaterial = material
        this.publish()
      }
    }
    if (message.type === 'node-history-page') {
      if (this.selectedNodeHistory?.header.studyId !== message.studyId)
        throw new Error('Select the matching Node history before paging.')
      const pageCount = Math.max(
        1,
        Math.ceil(
          this.selectedNodeHistory.entries.length /
            NODE_HISTORY_READER_PAGE_SIZE,
        ),
      )
      if (message.page >= pageCount)
        throw new Error('The requested Node history page is unavailable.')
      this.selectedNodeHistoryPage = message.page
      this.publish()
    }
    if (message.type === 'node-history-step') {
      if (this.recordingActive)
        throw new Error(
          'Close browser replay before navigating a separate Node test history.',
        )
      const history = this.selectedNodeHistory
      if (!history || history.header.studyId !== message.studyId)
        throw new Error(
          'Select the matching saved Node history before navigating its timeline.',
        )
      const currentIndex = history.entries.findIndex(
        (entry) => entry.sequence === this.selectedNodeHistorySequence,
      )
      const targetIndex =
        currentIndex < 0
          ? message.direction === 'next'
            ? 0
            : history.entries.length - 1
          : currentIndex + (message.direction === 'next' ? 1 : -1)
      const target = history.entries[targetIndex]
      if (!target)
        throw new Error(
          `There is no ${message.direction} event in this Node history.`,
        )
      await this.selectNodeHistoryEvent(history, target.sequence)
    }
    if (message.type === 'node-history-event') {
      if (this.recordingActive)
        throw new Error(
          'Close browser replay before navigating a separate Node test history.',
        )
      const history = this.selectedNodeHistory
      if (!history || history.header.studyId !== message.studyId)
        throw new Error(
          'Select the matching saved Node history before navigating its timeline.',
        )
      await this.selectNodeHistoryEvent(history, message.sequence)
    }
    if (message.type === 'node-history-stop') {
      if (this.recordingActive)
        throw new Error(
          'Close browser replay before inspecting a separate Node history stop.',
        )
      const history = this.selectedNodeHistory
      if (!history || history.header.studyId !== message.studyId)
        throw new Error(
          'Select the matching saved Node history before inspecting its debugger state.',
        )
      if (
        history.entries.find((entry) => entry.sequence === message.sequence)
          ?.type !== 'stop'
      )
        throw new Error(
          'The requested Node history event is not a debugger stop.',
        )
      await this.selectNodeHistoryEvent(history, message.sequence, true)
    }
    if (message.type === 'node-history-playback') {
      if (this.recordingActive)
        throw new Error(
          'Close browser replay before controlling a separate Node test history.',
        )
      if (
        this.selectedNodeHistory?.header.studyId !== message.studyId ||
        !this.nodeHistoryPlaybackController
      )
        throw new Error(
          'Select the matching saved Node history before controlling its timeline.',
        )
      if (message.action !== 'seek' && message.positionMs !== undefined)
        throw new Error('Only a Node history time seek accepts a position.')
      if (message.action === 'play') this.nodeHistoryPlaybackController.play()
      else if (message.action === 'pause')
        this.nodeHistoryPlaybackController.pause()
      else if (message.action === 'seek') {
        if (message.positionMs === undefined)
          throw new Error('Node history seek requires a recorded time.')
        await this.nodeHistoryPlaybackController.seek(message.positionMs)
      }
    }
    if (message.type === 'history') await this.openChosenStudy(message)
  }

  /**
   * Opens the saved study the learner chose in Saved studies; called by {@link receive} for a `history` message.
   * During Recording the choice opens that study's recording. Otherwise the request takes a history request number and owns the reader until it has shown the study, failed, or been overtaken by a newer choice; {@link pendingHistory} only marks the time its archive is being read.
   * @param message - The pane's choice with the revision the pane had seen.
   * @example await this.openChosenStudy({ type: 'history', revision: this.revision, studyId })
   */
  private async openChosenStudy(message: HistoryPaneMessage): Promise<void> {
    if (this.recordingActive) {
      await this.openRecording(message.studyId)
      return
    }
    const request = ++this.historyRequest
    this.studyChoices++
    this.pendingHistory = request
    this.loading = true
    this.lastRendered = undefined
    this.publish()
    const choice = { request, hasReadArchive: false }
    try {
      await this.showChosenStudy(message, choice)
    } catch (error) {
      await this.reportFailedChoice(choice, message.revision, error)
    } finally {
      await this.releaseStaleHistoryRequest(request)
    }
  }

  /**
   * Reads the chosen archive and shows it, unless the request went stale while the archive was read; called by {@link openChosenStudy}.
   * A stale read touches nothing: neither the selection nor a Node test history the learner chose in the meantime.
   * @param message - The pane's choice.
   * @param choice - The history request number this choice took; `hasReadArchive` is set once the archive was read, so a later failure is known to be one of the arrangement.
   * @example await this.showChosenStudy(message, choice)
   */
  private async showChosenStudy(
    message: HistoryPaneMessage,
    choice: { request: number; hasReadArchive: boolean },
  ): Promise<void> {
    const request = choice.request
    const archive = await this.readSavedArchive(message.studyId)
    choice.hasReadArchive = true
    if (this.isStaleHistoryRead(request, message.revision)) return
    this.pendingHistory = undefined
    // Browser selection retires the separate Node journal and its historical debugger context.
    await this.retireNodeHistorySelection()
    // Closing a native preview can publish a new reader revision; the owned history request still controls this switch.
    if (!this.isLatestHistoryRequest(request)) return
    await this.showSavedStudy(archive)
    this.publishChoiceOfClosedReader(request)
  }

  /**
   * Ends the loading state of a choice made while the Study workspace is closed and publishes the chosen study to the panes that are still up; called by {@link showChosenStudy} once the study is selected.
   * An open reader has rendered and published the study already, and one that is still opening does so when its entry ends. A closed one renders nothing, so without this the bottom panel would keep the earlier study and stay loading until the reader is opened.
   * @param request - The history request number of the choice; a newer choice or a closing reader publishes its own state.
   * @example this.publishChoiceOfClosedReader(request)
   */
  private publishChoiceOfClosedReader(request: number): void {
    // A reader that is opening renders and publishes the study itself; ending the loading state here would show it before that render.
    if (
      this.opened ||
      this.sourceEntry ||
      !this.isLatestHistoryRequest(request)
    )
      return
    this.loading = false
    this.publish()
  }

  /** Says whether a saved-study read no longer owns the reader when it ends: a newer saved study or Node test history was chosen, the reader changed its revision, or it is closing. @example if (this.isStaleHistoryRead(request, message.revision)) return */
  private isStaleHistoryRead(request: number, revision: number): boolean {
    return (
      this.pendingHistory !== request ||
      !this.isLatestHistoryRequest(request) ||
      revision !== this.revision
    )
  }

  /**
   * Reports a chosen saved study that failed while its request still owns the reader, and renders what is selected so the loading state ends; called by {@link openChosenStudy}.
   * A failure of the archive read is a storage failure and leaves the earlier study selected. A failure after the read (the reader could not be arranged for the study) is a reading failure with the chosen study selected.
   * @param choice - The history request number of the failed choice, and whether its archive had been read.
   * @param revision - The revision the pane had seen when it sent the choice.
   * @param error - What the read or the arrangement threw.
   * @example await this.reportFailedChoice(choice, message.revision, error)
   */
  private async reportFailedChoice(
    choice: { request: number; hasReadArchive: boolean },
    revision: number,
    error: unknown,
  ): Promise<void> {
    const request = choice.request
    if (!this.isLatestHistoryRequest(request)) return
    if (choice.hasReadArchive) {
      this.report('reading', error)
      await this.renderShownSelection()
      this.publishChoiceOfClosedReader(request)
      return
    }
    if (this.hasMovedOnFromRead(request, revision)) return
    this.pendingHistory = undefined
    this.report('archive', error)
    await this.renderSelection(true, true)
    this.publishChoiceOfClosedReader(request)
  }

  /** Says whether the reader moved on while a chosen archive was read, so the read's failure adds no line: its marker was cleared by a reader close or a recording load, or the reader's revision changed ({@link releaseStaleHistoryRequest} ends that request). @example if (this.hasMovedOnFromRead(request, revision)) return */
  private hasMovedOnFromRead(request: number, revision: number): boolean {
    return this.pendingHistory !== request || revision !== this.revision
  }

  /**
   * Ends a saved-study request that was discarded while its archive was still marked as opening; called last by {@link openChosenStudy}.
   * Without this the marker would keep refusing delete requests and holding back every render until another entry is chosen. A request that showed its study or reported its failure has cleared the marker itself, and a newer saved-study choice owns it by then.
   * @param request - The history request number of the choice that just ended.
   * @example await this.releaseStaleHistoryRequest(request)
   */
  private async releaseStaleHistoryRequest(request: number): Promise<void> {
    if (this.pendingHistory !== request) return
    this.pendingHistory = undefined
    // Renders asked for while the marker was set returned early, so nothing else shows the selection; a newer choice or a closing reader needs no render from here.
    if (this.isLatestHistoryRequest(request)) await this.renderShownSelection()
    this.publishChoiceOfClosedReader(request)
  }

  /** Names the study whose files a confirmed removal is moving right now, for the writers and readers that must leave it alone. @example if (this.movingStudyId() === id) return */
  private movingStudyId(): string | undefined {
    return this.studyRemoval?.status === 'moving'
      ? this.studyRemoval.studyId
      : undefined
  }

  /** Refuses to open, play or save a study whose files are on their way to the Trash and may be half moved; called by {@link readSavedArchive}, {@link openRecording}, {@link loadPlayback} and {@link saveLearningReplay}. @throws `Study archive is unavailable.` for the moving study. @example this.assertStudyNotMoving(id) */
  private assertStudyNotMoving(studyId: string): void {
    if (this.movingStudyId() === studyId)
      throw new Error(STUDY_REMOVAL_REFUSALS.unavailable)
  }

  /** Says whether a removal is waiting for its confirmation or moving files; only one removal runs at a time. @example if (this.studyRemovalInProgress()) return */
  private studyRemovalInProgress(): boolean {
    const status = this.studyRemoval?.status
    return status === 'confirming' || status === 'moving'
  }

  /** Says whether a delete request must return without effect: another one is being checked ({@link studyRemovalTaken}), waits for its confirmation or moves files; asked by {@link removeSavedStudy} before its first `await`. @example if (this.studyRemovalTakenOrInProgress()) return */
  private studyRemovalTakenOrInProgress(): boolean {
    return this.studyRemovalTaken || this.studyRemovalInProgress()
  }

  /** Lets {@link checkpoint} skip a study before any capture: one on its way to the Trash, or one whose material is already saved unless the checkpoint is forced. @example if (this.skipsCheckpoint(id, signature, force)) return */
  private skipsCheckpoint(
    studyId: string,
    signature: string,
    force: boolean,
  ): boolean {
    return (
      this.movingStudyId() === studyId ||
      (!force && this.archiveSignatures.get(studyId) === signature)
    )
  }

  /**
   * Says whether this window's last write of a study succeeded with this material and no write of it is waiting or running; called by {@link retire} before its forced checkpoint.
   * A forced checkpoint of such a study would capture the same content again and change only its `savedAt`, which the Saved studies list prints and sorts by.
   * @param studyId - The study a checkpoint is asked for.
   * @param signature - The material signature of its run now.
   * @returns `true` only for a receipt of this window that says `saved` for the same signature, with nothing pending.
   * @example if (this.isSavedUnchanged(id, signature)) continue
   */
  private isSavedUnchanged(studyId: string, signature: string): boolean {
    const receipt = this.historyReceipts.get(studyId)
    return (
      receipt?.status === 'saved' &&
      receipt.signature === signature &&
      this.hasNoArchiveWriteOutstanding(studyId)
    )
  }

  /**
   * Says whether this window has no write of a study waiting or running; asked by {@link isSavedUnchanged} once the receipt says `saved` for the same material.
   * @param studyId - The study a checkpoint is asked for.
   * @returns `true` when neither a pending archive nor a running write of that study exists.
   * @example this.hasNoArchiveWriteOutstanding(studyId) // => false while its archive is being written
   */
  private hasNoArchiveWriteOutstanding(studyId: string): boolean {
    return (
      !this.pendingArchives.has(studyId) && !this.archiveWrites.has(studyId)
    )
  }

  /**
   * Settles for {@link checkpoint} what becomes of a capture, or of its failure, that ended while a confirmed removal of its study is in progress: waits until the files are settled, then lets {@link discardsCapture} judge it.
   * A checkpoint the removal itself waits for cannot wait in turn (each would wait for the other for ever). Its capture is kept: {@link persistArchive} leaves it unwritten while the study is moving, and the removal drops it when something moved ({@link forgetRemovedStudy}) or writes it when nothing did ({@link resumeHeldBackWrite}).
   * @param studyId - The study the checkpoint captured.
   * @param record - The run of that study.
   * @param isAwaitedByRemoval - Whether the removal waits for the checkpoint's caller, see {@link checkpoint}.
   * @returns Whether the capture was dropped.
   * @example if (await this.dropsCaptureAfterMove(id, record, false)) return
   */
  private async dropsCaptureAfterMove(
    studyId: string,
    record: StudyRecord,
    isAwaitedByRemoval: boolean,
  ): Promise<boolean> {
    if (this.movingStudyId() === studyId) {
      if (isAwaitedByRemoval) return false
      await this.studyMove
    }
    return this.discardsCapture(studyId, record)
  }

  /**
   * Lets {@link checkpoint} drop a capture that finished after its study's removal was confirmed or after its run was excluded from history; neither write queue held that capture.
   * @returns Whether the capture was dropped; its history receipt is forgotten with it.
   * @example if (this.discardsCapture(id, record)) return
   */
  private discardsCapture(studyId: string, record: StudyRecord): boolean {
    if (this.movingStudyId() !== studyId && !record.historyExcluded)
      return false
    this.historyReceipts.delete(studyId)
    return true
  }

  /** Names the saved study of this window's run that has not stopped; that study cannot be removed. @example this.unstoppedStudyId() // => 'instance_run' while a run is live */
  private unstoppedStudyId(): string | undefined {
    if (!this.service) return undefined
    const unstopped = [...this.service.records.values()].find(
      (record) => !record.stopped,
    )
    return unstopped && `${this.service.instanceId}_${unstopped.id}`
  }

  /**
   * Retires the outcome line of a finished removal when the learner chooses another entry or a run starts; a removal that is still confirming or moving is kept.
   * @returns Whether a line was retired, so the caller knows to publish.
   * @example if (this.dismissStudyRemoval()) this.publish()
   */
  private dismissStudyRemoval(): boolean {
    if (
      !this.studyRemoval ||
      this.studyRemovalInProgress() ||
      this.removalFollowersShowing > 0
    )
      return false
    this.studyRemoval = undefined
    return true
  }

  /** Retires a finished removal's outcome line once another run than the one it ended under is current; called on every reader refresh. @example this.retireRemovalOutcomeOfEarlierRun(this.currentRecord()?.id) */
  private retireRemovalOutcomeOfEarlierRun(currentRunId?: string): void {
    if (currentRunId === this.studyRemovalRunId) return
    if (this.dismissStudyRemoval()) this.publish()
  }

  /**
   * Says why a saved study cannot be removed right now; checked when the request arrives and again after the confirmation dialog, which can stay open while the reader changes.
   * @param studyId - The entry the learner chose in Saved studies.
   * @returns The refusal sentence, first match wins: another entry that is still opening, a Node test history, an entry no catalog lists, a study a newer Codebook saved, the study of a run that has not stopped, a Recording that is open or opening. In a window without a Trash the sentence names the removal of the study's files by hand, because a request there asks for those files and nothing is deleted. `undefined` when the study can be removed.
   * @example this.studyRemovalRefusal(nodeHistoryId) // => 'Node test histories cannot be deleted here yet.'
   */
  private studyRemovalRefusal(studyId: string): string | undefined {
    const sentences =
      this.studyRemovalAvailability() === 'no-trash'
        ? STUDY_REMOVAL_REFUSALS_WITHOUT_TRASH
        : STUDY_REMOVAL_REFUSALS
    const refusals: [applies: boolean, sentence: string][] = [
      // The pane may still show the entry before the one the learner chose; a delete names what is shown once it has opened.
      [this.studyOpening(), sentences.studyOpening],
      [
        this.nodeHistoryCatalog.some((history) => history.studyId === studyId),
        sentences.nodeHistory,
      ],
      [
        !this.catalog.some((entry) => entry.id === studyId),
        sentences.unavailable,
      ],
      // Which files a newer format keeps is not known here, so nothing of such a study is moved.
      [
        this.catalog.some(
          (entry) => entry.id === studyId && entry.format === 'newer',
        ),
        sentences.newerFormat,
      ],
      [this.unstoppedStudyId() === studyId, sentences.runNotStopped],
      [this.recordingOpenOrOpening(), sentences.recordingOpen],
    ]
    return refusals.find(([applies]) => applies)?.[1]
  }

  /** Says whether a saved study or a Node test history the learner chose is still opening; until it is shown, a removal's neighbour and a delete request give way to it. @example if (this.studyOpening()) return */
  private studyOpening(): boolean {
    return (
      this.pendingHistory !== undefined || this.pendingNodeHistory !== undefined
    )
  }

  /** Says whether Recording is open, or an accepted open is still loading: the controller reports the load from the moment it accepts the open, before the reader marks Recording as active. @example if (this.recordingOpenOrOpening()) return STUDY_REMOVAL_REFUSALS.recordingOpen */
  private recordingOpenOrOpening(): boolean {
    return (
      this.recordingActive || this.playback?.state().readiness === 'loading'
    )
  }

  /**
   * Adds the number of the delete request a removal state answers, so the asking pane tells its own answer from an earlier one with the same words; called for every state the reader publishes.
   * @param view - The removal state without a request number.
   * @returns The state with `request` when the pane numbered its request, otherwise the state as it is.
   * @example this.withRemovalRequest({ status: 'refused', studyId, text }) // => { status: 'refused', studyId, text, request: 2 }
   */
  private withRemovalRequest(view: StudyRemovalView): StudyRemovalView {
    return this.studyRemovalRequest === undefined
      ? view
      : { ...view, request: this.studyRemovalRequest }
  }

  /** Publishes a removal's outcome with its request number and remembers the run it ended under, so a later run retires the line. @example this.settleStudyRemoval({ status: 'refused', studyId, text }) */
  private settleStudyRemoval(outcome: StudyRemovalView): void {
    this.studyRemoval = this.withRemovalRequest(outcome)
    this.studyRemovalRunId = this.currentRecord()?.id
    // The files are settled; a checkpoint that waited for them goes on.
    this.releaseStudyMove?.()
    this.publish()
  }

  /**
   * Refuses a removal that cannot run right now and shows the sentence under the delete button.
   * @returns Whether the removal was refused.
   * @example if (this.refuseStudyRemoval(studyId)) return
   */
  private refuseStudyRemoval(studyId: string): boolean {
    const refusal = this.studyRemovalRefusal(studyId)
    if (!refusal) return false
    this.settleStudyRemoval({ status: 'refused', studyId, text: refusal })
    return true
  }

  /**
   * Tells whether this window can remove a saved study: what the attached service recorded, or what the window itself says while no service is attached; read for every full-library refusal, every delete request and every Study message.
   * @returns `no-trash` in a WSL remote window, `trash-refused` after a removal of this session left its study in the library, otherwise `available`.
   * @example if (this.studyRemovalAvailability() === 'no-trash') return
   */
  private studyRemovalAvailability(): StudyRemovalAvailability {
    return (
      this.service?.studyRemovalAvailability ??
      initialStudyRemovalAvailability(vscode.env.remoteName)
    )
  }

  /**
   * Answers a delete request in a window without a Trash: no dialog opens and nothing is moved or deleted; the status line says so and carries the study's files, from the removal's own path list, for removal by hand, and {@link listedStudyFiles} keeps that list for the panes that chose the study. Called by {@link studyRemovalConfirmed} after the refusals that hold in every window.
   * @param studyId - The entry the learner chose, already known to be a listed study of a stopped run.
   * @returns Whether the request was answered this way.
   * @example if (await this.refuseRemovalWithoutTrash(studyId)) return false
   */
  private async refuseRemovalWithoutTrash(studyId: string): Promise<boolean> {
    if (this.studyRemovalAvailability() !== 'no-trash') return false
    const files = await this.listStudyFilesOrRefuse(studyId)
    if (!files) return true
    // Kept by study: the answer below is replaced by the next pane's request for another study.
    this.listedStudyFiles.set(studyId, files)
    this.settleStudyRemoval({
      status: 'refused',
      studyId,
      text: STUDY_REMOVAL_WITHOUT_TRASH_MESSAGE,
      files,
    })
    return true
  }

  /**
   * Lists the files of one study for its removal by hand, and answers the request itself when the listing fails; called by {@link refuseRemovalWithoutTrash}.
   * A listing can fail (a path that cannot be inspected, a study a newer Codebook saved since the list was read). The asking pane waits for an answer with its request's number, so the failure is settled as a refusal with its reason, which "Remove by hand" shows with Retry storage / refresh; thrown, it would be a control line, and the pane would stay at "Listing this study's files…".
   * @param studyId - The entry the learner chose.
   * @returns The study's files, or `undefined` when the listing failed and the refusal is published.
   * @example const files = await this.listStudyFilesOrRefuse(studyId)
   */
  private async listStudyFilesOrRefuse(
    studyId: string,
  ): Promise<string[] | undefined> {
    try {
      const evidence = await this.studyEvidenceToMove(studyId)
      return await this.library!.studyFiles(studyId, evidence.directory)
    } catch (error) {
      this.settleStudyRemoval({
        status: 'refused',
        studyId,
        text: studyRemovalMessages().filesNotListed(thrownMessage(error)),
      })
      return undefined
    }
  }

  /**
   * Copies the files the reader listed for the removal by hand of one study to the clipboard and tells the asking pane what became of it; called by {@link receive} for the pane's `copy-study-files` message.
   * The answer goes to the asking webview only, after the clipboard write settled: the pane writes "Copied N paths." from it, so it never confirms a copy the clipboard refused.
   * @param studyId - The study the pane shows the list of.
   * @param asking - The webview that sent the request; a caller that is no pane gets no answer.
   * @example await this.copyStudyFiles(message.studyId, owner?.webview)
   */
  private async copyStudyFiles(
    studyId: string,
    asking?: Pick<vscode.Webview, 'postMessage'>,
  ): Promise<void> {
    const answer = await this.writeStudyFilesToClipboard(studyId)
    void asking?.postMessage(answer)
  }

  /**
   * Writes the files the reader listed for the removal by hand of one study to the clipboard, one path a line; called by {@link copyStudyFiles}.
   * Only the reader's own list for that study is copied, never text a pane sends.
   * @param studyId - The study the pane shows the list of.
   * @returns
   * - The clipboard took the list: `copied` with the number of paths
   * - The reader keeps no list for that study, or the clipboard refused the write: `failed`; nothing was copied
   * @example await this.writeStudyFilesToClipboard(studyId) // => { type: 'study-files-copied', studyId, status: 'copied', count: 4 }
   */
  private async writeStudyFilesToClipboard(
    studyId: string,
  ): Promise<StudyFilesCopied> {
    const files = this.removalFilesOf(studyId)
    if (!files?.length)
      return { type: 'study-files-copied', studyId, status: 'failed' }
    try {
      await vscode.env.clipboard.writeText(files.join('\n'))
    } catch {
      // The pane names the failure and what the learner does instead; the cause is the editor's and adds nothing the learner can act on.
      return { type: 'study-files-copied', studyId, status: 'failed' }
    }
    return {
      type: 'study-files-copied',
      studyId,
      status: 'copied',
      count: files.length,
    }
  }

  /**
   * Gives the files the reader listed for the removal by hand of one study; read by {@link writeStudyFilesToClipboard} before it writes the clipboard.
   * @param studyId - The study the pane shows the list of.
   * @returns The list the reader made for that study, also when a later request listed another study; `undefined` when it listed none.
   * @example const files = this.removalFilesOf(studyId)
   */
  private removalFilesOf(studyId: string): StudyRemovalView['files'] {
    return this.listedStudyFiles.get(studyId)
  }

  /**
   * Forgets every file list the reader kept for "Remove by hand" and the answer that carries one, because the learner may have removed some of those files since; called by {@link forgetStudiesRemovedByHand} when Retry storage / refresh starts.
   * A Study message then names no files for any study, so a pane whose disclosure is open asks again and shows the files that are left, also for a study the library still holds.
   * @example this.forgetListedStudyFiles()
   */
  private forgetListedStudyFiles(): void {
    this.listedStudyFiles.clear()
    // The answer to the last request for files holds its list too; a refusal without files, and a removal of a window with a Trash, stay.
    if (this.studyRemoval?.files) this.studyRemoval = undefined
  }

  /**
   * Follows studies that left the library without a removal of this reader, as after the learner removed the listed files by hand; called by Retry storage / refresh before it reads the ledger and writes the selection.
   * The file lists kept for "Remove by hand" are forgotten first, also when a later step fails: a list made before the learner removed files names paths that may be gone ({@link forgetListedStudyFiles}).
   * Such a study is one the reader listed before and the library no longer holds, or one the ledger still named. The ledger's references are dropped under the storage lock, a run of this window is forgotten like a removed one (so it is not written back), and a reader that selects the study selects none. A study that was never saved is in neither group and is left alone.
   * A study of which only a rest without its archive is listed ({@link isRestWithoutArchive}) has left the library in the same way: its entry stays, so the rest can be removed, and Retry does not write its archive again. The library lists the same kind of entry for the finished recording of a run whose archive was never written; such a study has not left, and Retry writes it ({@link awaitsArchiveOfThisWindow}).
   * @example await this.forgetStudiesRemovedByHand()
   */
  private async forgetStudiesRemovedByHand(): Promise<void> {
    this.forgetListedStudyFiles()
    const listedBefore = this.catalog.map((entry) => entry.id)
    const namedByLedger = await this.library!.forgetAbsentStudies()
    this.catalog = await this.library!.list()
    const gone = new Set(
      [...listedBefore, ...namedByLedger].filter((studyId) =>
        this.hasLeftLibrary(studyId),
      ),
    )
    for (const studyId of gone) {
      // A run of this window whose saved study is gone would otherwise be checkpointed into the library again.
      if (this.recordOfStudy(studyId))
        await this.forgetRemovedStudy(studyId, 'archive-removed')
      this.activeArchive = withoutStudy(this.activeArchive, studyId)
      this.selectedArchive = withoutStudy(this.selectedArchive, studyId)
      if (this.selection.studyId === studyId) this.selectNoStudy()
    }
  }

  /**
   * Says whether a study the reader knew has left the library, by the list that was just read; asked by {@link forgetStudiesRemovedByHand} for every study it listed before and every study the ledger still named.
   * @param studyId - The study.
   * @returns
   * - No entry lists it: `true`
   * - Only what is left of it without its archive is listed: `true`, unless that is the study of a run of this window whose archive this window has not saved ({@link awaitsArchiveOfThisWindow})
   * - Its archive is listed: `false`
   * @example this.hasLeftLibrary(study.id) // => true once the study's files were removed by hand
   */
  private hasLeftLibrary(studyId: string): boolean {
    if (!this.catalog.some((entry) => entry.id === studyId)) return true
    return (
      this.isRestWithoutArchive(studyId) &&
      !this.awaitsArchiveOfThisWindow(studyId)
    )
  }

  /**
   * Says whether a study is one whose archive this window still has to write; asked by {@link hasLeftLibrary} and {@link giveUpSelectionOfRest} for a study of which the library lists no archive.
   * The library lists the finished recording of such a study like what is left of a study whose archive was removed. The two are told apart by what this window holds: an archive that was removed had been saved (the run's receipt says `saved` and no write is waiting), while one that could not be written has a write that waits for Retry storage / refresh, or a run with a failed or pending receipt.
   * A write waits also for a study of no run of this reader: the archive a disposed reader could not save and handed over ({@link queueHandedOverArchives}). Its run ended with the service of that reader, so only the waiting archive says that the study is awaited.
   * @param studyId - The study of which no archive is listed.
   * @returns `true` for a study whose archive waits to be written or is being written, and for a run of this window whose last archive write did not end as `saved`; `false` for a study of no run of this window without a waiting archive, and for a run whose archive this window had saved.
   * @example this.awaitsArchiveOfThisWindow(studyId) // => true after "History not saved: …" for a stopped run, and for an archive a disposed reader handed over
   */
  private awaitsArchiveOfThisWindow(studyId: string): boolean {
    // A waiting archive needs no run in this reader to be awaited.
    if (!this.hasNoArchiveWriteOutstanding(studyId)) return true
    const record = this.recordOfStudy(studyId)
    return record !== undefined && record.historyReceipt?.status !== 'saved'
  }

  /**
   * Runs {@link forgetStudiesRemovedByHand} for Retry storage / refresh and shows its failure as the `archive` line; called by {@link action} before it reads the ledger.
   * @returns `true` when the ledger was cleaned; `false` when the step failed and its line is shown, which the caller then keeps although its later storage steps succeed.
   * @example
   * ```ts
   * const ledgerCleaned = await this.forgetStudiesRemovedByHandOrReport()
   * if (ledgerCleaned) this.errors.delete('archive')
   * ```
   */
  private async forgetStudiesRemovedByHandOrReport(): Promise<boolean> {
    try {
      await this.forgetStudiesRemovedByHand()
      return true
    } catch (error) {
      this.report('archive', error)
      return false
    }
  }

  /**
   * Asks the learner in a native dialog whether the named study moves to the system Trash; while the dialog is open the removal is `confirming`.
   * Cancel, Escape and a dialog the host could not show all leave the study and the status line untouched.
   * @param entry - The catalog entry the dialog names.
   * @returns Whether the learner pressed the confirming button.
   * @example if (!(await this.askStudyRemoval(entry))) return
   */
  private async askStudyRemoval(entry: StudyCatalogEntry): Promise<boolean> {
    const messages = studyRemovalMessages()
    this.studyRemoval = this.withRemovalRequest({
      status: 'confirming',
      studyId: entry.id,
    })
    this.publish()
    let confirmed = false
    try {
      confirmed =
        (await vscode.window.showWarningMessage(
          messages.confirmTitle,
          {
            modal: true,
            detail: messages.confirmDetail(savedStudyIdentityLine(entry)),
          },
          messages.confirmButton,
        )) === messages.confirmButton
    } finally {
      if (!confirmed) {
        this.studyRemoval = undefined
        this.publish()
      }
    }
    return confirmed
  }

  /**
   * Checks a delete request, confirms it with the learner and checks it again, because the dialog can stay open while Recording opens or the catalog changes; the answer counts against the state after it.
   * @returns Whether the study may be moved now; every refusal is already shown.
   * @example if (!(await this.studyRemovalConfirmed(studyId))) return
   */
  private async studyRemovalConfirmed(studyId: string): Promise<boolean> {
    if (this.refuseStudyRemoval(studyId)) return false
    if (await this.refuseRemovalWithoutTrash(studyId)) return false
    const entry = this.catalog.find((candidate) => candidate.id === studyId)
    if (!entry || !(await this.askStudyRemoval(entry))) return false
    return !this.refuseStudyRemoval(studyId)
  }

  /**
   * Says whether a request for a study's files must wait: the window has no Trash and another request is being checked. Asked by {@link removeSavedStudy} until it is the request's turn.
   * @example while (this.isFilesRequestInFront()) await this.studyRemovalCheck
   */
  private isFilesRequestInFront(): boolean {
    return (
      this.studyRemovalCheck !== undefined &&
      this.studyRemovalAvailability() === 'no-trash'
    )
  }

  /**
   * Handles the pane's `delete-study` message; called by {@link receive}. With a Trash it starts the removal ({@link takeStudyRemoval}), which takes one request at a time and leaves a second one without effect.
   * A window without a Trash moves nothing: a request there asks for a study's files, which every asking pane waits for. Several panes can ask at once (each open "Remove by hand" asks again after Retry storage / refresh), so such a request waits until the one in front is answered and is then answered itself, with the number it gave.
   * @param studyId - The entry the learner chose.
   * @param removalRequest - The number the asking pane gave this request; the answer echoes it.
   * @returns Once the request is answered or the removal ended.
   * @example await this.removeSavedStudy(message.studyId, message.removalRequest)
   */
  private async removeSavedStudy(
    studyId: string,
    removalRequest?: number,
  ): Promise<void> {
    // No await while nothing is in front: two requests of one moment must not both pass this line before the first is taken. A waiting request that another one overtook waits for that one.
    while (this.isFilesRequestInFront()) await this.studyRemovalCheck
    await this.takeStudyRemoval(studyId, removalRequest)
  }

  /**
   * Removes one saved study on the learner's request from the Saved studies section: confirms in a native dialog, holds off this window's writers of that study, moves its files to the system Trash through {@link LearningLibrary.removeStudy} and reports the outcome in the message's `studyRemoval` field.
   * Every expected outcome (a refusal, Cancel, a Trash that refuses) ends in that field; nothing is written to the reader's error lines. Called by {@link removeSavedStudy}; one removal runs at a time, from its first check ({@link studyRemovalTaken}) to its move, and a request that arrives meanwhile returns without effect.
   * @param studyId - The entry the learner chose.
   * @param removalRequest - The number the asking pane gave this request; every state of this removal echoes it.
   * @returns Once the removal ended: refused, cancelled, moved or left in place, as its `studyRemoval` field says; at once for a request made while another removal runs.
   * @example await this.takeStudyRemoval(message.studyId, message.removalRequest)
   */
  private async takeStudyRemoval(
    studyId: string,
    removalRequest?: number,
  ): Promise<void> {
    // One removal at a time: a second request while this one is checked, while the dialog is open or while files are moving opens no second dialog.
    if (this.studyRemovalTakenOrInProgress()) return
    // Taken before the first await: the checks below yield before the dialog marks the removal `confirming`.
    this.studyRemovalTaken = true
    this.studyRemovalRequest = removalRequest
    const check = this.studyRemovalConfirmed(studyId)
    // What a files request of another pane waits for; a check that throws ends the wait as well.
    this.studyRemovalCheck = check.then(
      () => undefined,
      () => undefined,
    )
    let confirmed: boolean
    try {
      confirmed = await check
    } finally {
      // A confirmed removal is `confirming` now and stays in progress through its move; any other one has ended.
      this.studyRemovalTaken = false
      this.studyRemovalCheck = undefined
    }
    if (!confirmed) return
    // A checkpoint of this study waits until its files are settled instead of skipping the study.
    let release!: () => void
    const filesSettled = new Promise<void>((resolve) => {
      release = resolve
    })
    this.studyMove = filesSettled
    this.releaseStudyMove = release
    try {
      await this.holdStudyAsMoving(studyId)
    } finally {
      release()
      // A later removal may have started while this one showed the study that follows; its marks are its own.
      if (this.studyMove === filesSettled) {
        this.studyMove = undefined
        this.releaseStudyMove = undefined
      }
      this.resumeHeldBackWrite(studyId)
    }
  }

  /**
   * Keeps a confirmed study in the `moving` state for as long as {@link moveSavedStudy} runs; called by {@link removeSavedStudy}.
   * From here to the outcome {@link checkpoint}, {@link persistArchive}, the position save and the readers leave this study alone.
   * @param studyId - The confirmed entry.
   * @throws What the move throws unexpectedly; the study is then no longer held as moving, and the failure reaches the reader's error lines.
   * @example await this.holdStudyAsMoving(studyId)
   */
  private async holdStudyAsMoving(studyId: string): Promise<void> {
    this.studyRemoval = this.withRemovalRequest({
      status: 'moving',
      studyId,
      text: studyRemovalMessages().moving,
    })
    this.publish()
    try {
      await this.moveSavedStudy(studyId)
    } finally {
      if (this.movingStudyId() === studyId) {
        this.studyRemoval = undefined
        this.publish()
      }
    }
  }

  /**
   * Writes the checkpoint a removal held back, once that removal ended without moving anything; called by {@link removeSavedStudy} when the move has settled.
   * {@link forgetRemovedStudy} drops the entry as soon as something moved, so an entry that is still pending belongs to a study that is whole. Without this the entry would wait for a material change, Retry storage or retirement.
   * @param studyId - The study whose removal just ended.
   * @example this.resumeHeldBackWrite(studyId)
   */
  private resumeHeldBackWrite(studyId: string): void {
    if (!this.pendingArchives.has(studyId)) return
    // The writer reports its own failure; a caller of the removal has nothing to add to it.
    void this.persistArchive(studyId).catch(() => undefined)
  }

  /**
   * Moves a confirmed study to the system Trash and settles the removal's outcome; called by {@link holdStudyAsMoving} while the removal state is `moving`.
   * Waits for this window's accepted writes of the study first, forgets the study only when something moved, and shows a neighbour when the shown study left. Once every file moved, the outcome line is settled whatever happens to the step that shows what follows.
   * @param studyId - The confirmed entry.
   * @example await this.moveSavedStudy(studyId)
   */
  private async moveSavedStudy(studyId: string): Promise<void> {
    const messages = studyRemovalMessages()
    // A saved study or Node test history chosen from here on owns the reader; the neighbour gives way to it. Other actions that take a history request number (an item, a return, repository evidence) choose no entry.
    const choiceGeneration = this.studyChoices
    await this.settleStudyWrites(studyId)
    const neighbours = this.removalNeighbours(studyId)
    const evidence = await this.studyEvidenceToMove(studyId)
    const removal = await this.moveStudyFiles(studyId, evidence.directory)
    if (removal.outcome === 'nothing-moved') {
      // No file of the study moved, so the run stays a checkpoint candidate and its pending entry is kept. The list may have changed meanwhile, and a failed write-back leaves the ledger without its two references to the study, so both are read again.
      await this.rereadLibraryAfterUnmovedRemoval()
      this.settleStudyRemoval({
        status: 'failed',
        studyId,
        text: messages.nothingMoved(removal.cause),
      })
      return
    }
    await this.forgetRemovedStudy(studyId, 'removed-by-learner')
    if (removal.outcome !== 'moved') {
      // Partly moved: the study is still listed and stays chosen, so deleting it again finishes the removal.
      this.settleStudyRemoval({
        status: 'failed',
        studyId,
        text: messages.partlyMoved(removal.cause),
      })
      return
    }
    this.reportUnreleasedLock(removal.unreleasedLock)
    // The outcome is settled before the neighbour is read: the delete button and forced checkpoints do not wait for neighbours that cannot be read.
    await this.settleMovedStudy(
      studyId,
      evidence.isLeftInPlace,
      removal.unreleasedLock !== undefined,
    )
    this.removalFollowersShowing++
    try {
      await this.showAfterCompletedRemoval(
        studyId,
        neighbours,
        choiceGeneration,
      )
    } finally {
      this.removalFollowersShowing--
    }
  }

  /** Reads the catalog and the ledger again after a removal that moved no file, so the reader shows what the library holds now; a failed read is reported in its own line. @example await this.rereadLibraryAfterUnmovedRemoval() */
  private async rereadLibraryAfterUnmovedRemoval(): Promise<void> {
    try {
      this.catalog = await this.library!.list()
    } catch (error) {
      this.report('archive', error)
    }
    await this.refreshProgress()
  }

  /** Tells the learner in the reader's storage line that a completed removal could not release the storage lock; the next successful checkpoint write or Retry storage retires the line, and a write the lock still blocks reports it again. @example this.reportUnreleasedLock(removal.unreleasedLock) */
  private reportUnreleasedLock(cause: string | undefined): void {
    if (cause === undefined) return
    this.report(
      'archive',
      new Error(studyRemovalMessages().lockNotReleased(cause)),
    )
  }

  /**
   * Shows what follows a study that has left the library, without letting a failure of that step take the removal's outcome with it; called by {@link moveSavedStudy} after every file moved.
   * A study that cannot be arranged (a presentation change or a reader close is pending) is reported in the reader's own line, and the reader shows no study.
   * @param studyId - The study that was moved.
   * @param neighbours - The candidates from {@link removalNeighbours}, nearest first.
   * @param choiceGeneration - The count of chosen entries from before the removal's first step.
   * @example await this.showAfterCompletedRemoval(studyId, neighbours, choiceGeneration)
   */
  private async showAfterCompletedRemoval(
    studyId: string,
    neighbours: string[],
    choiceGeneration: number,
  ): Promise<void> {
    try {
      await this.showAfterRemoval(studyId, neighbours, choiceGeneration)
    } catch (error) {
      // An entry the learner chose meanwhile owns the reader: its selection stays, and the failure of a study that was not asked for is not shown.
      if (this.studyChoices !== choiceGeneration) return
      this.report('reading', error)
      await this.showNoStudyAfterRemoval()
    }
  }

  /**
   * Decides whether the raw evidence of a study's run goes to the Trash with the study; called by {@link moveSavedStudy} before the first move.
   * The evidence of a run of this window always goes (the run has stopped). The evidence of another instance stays while that instance's connection descriptor exists, because its window may still be running or serving the run.
   * @param studyId - The confirmed entry.
   * @returns The directory to move, or `isLeftInPlace` when existing evidence stays for another window.
   * @example await this.studyEvidenceToMove(studyId) // => { directory: '/…/agent/<instance>/<run>', isLeftInPlace: false }
   */
  private async studyEvidenceToMove(
    studyId: string,
  ): Promise<{ directory?: string; isLeftInPlace: boolean }> {
    const directory = studyEvidenceDirectory(
      join(this.context.globalStorageUri.fsPath, AGENT_STORAGE_DIRECTORY),
      studyId,
    )
    const isLeftInPlace =
      directory !== undefined &&
      (await evidenceInUseElsewhere(directory, this.service?.instanceId))
    return isLeftInPlace ? { isLeftInPlace } : { directory, isLeftInPlace }
  }

  /**
   * Hands a confirmed study to {@link LearningLibrary.removeStudy} with the editor's Trash as the mover, and tells the service once whether the study left the library; called by {@link moveSavedStudy}.
   * For a run of this window the removal runs inside {@link StudyService.withEvidenceHeld}, so no explanation is written into the evidence directory while it moves.
   * @param studyId - The confirmed entry.
   * @param evidenceDirectory - The run's raw evidence when it moves with the study.
   * @returns What the removal changed on disk.
   * @example await this.moveStudyFiles(studyId, evidenceDirectory) // => { outcome: 'moved' }
   */
  private async moveStudyFiles(
    studyId: string,
    evidenceDirectory?: string,
  ): Promise<StudyRemoval> {
    const remove = (): Promise<StudyRemoval> =>
      this.library!.removeStudy(
        studyId,
        (path) =>
          Promise.resolve(
            vscode.workspace.fs.delete(vscode.Uri.file(path), {
              recursive: true,
              useTrash: true,
            }),
          ),
        evidenceDirectory,
      )
    const service = this.service,
      record = this.recordOfStudy(studyId)
    const removal = await (service && record
      ? service.withEvidenceHeld(record, remove)
      : remove())
    // The removal's outcome decides, not each path: a path the Trash rejected after it was already gone still left the library.
    service?.recordStudyRemoval(removal.outcome === 'moved')
    return removal
  }

  /** Waits for this window's writes of a study that were accepted before its removal was confirmed, so they settle before the first move: a checkpoint write, a Save learning replay and a playback position save. @example await this.settleStudyWrites(studyId) */
  private async settleStudyWrites(studyId: string): Promise<void> {
    await this.archiveWrites.get(studyId)?.catch(() => undefined)
    if (this.learningSave?.studyId === studyId)
      await this.learningSaveOperation?.catch(() => undefined)
    await this.playback?.saved()
  }

  /** Finds the run of this window's service that a saved study belongs to; a study of an earlier session or another window has no run here. @example this.recordOfStudy(studyId)?.stopped */
  private recordOfStudy(studyId: string): StudyRecord | undefined {
    const service = this.service
    return (
      service &&
      [...service.records.values()].find(
        (candidate) => `${service.instanceId}_${candidate.id}` === studyId,
      )
    )
  }

  /** Says whether this window moved a study to the Trash and no later catalog read lists it again; a study the learner restored from the Trash is saved again without a reload. @example this.isRemovedStudy(studyId) // => false once Retry storage lists the restored study */
  private isRemovedStudy(studyId: string): boolean {
    return (
      this.removedStudyIds.has(studyId) &&
      !this.catalog.some((entry) => entry.id === studyId)
    )
  }

  /**
   * Excludes this window's run of a removed study from history, so the service stops reporting saved material for it and stops serving its evidence; called by {@link forgetRemovedStudy}.
   * @param studyId - The removed study.
   * @param exclusion - How it was removed, which decides the sentence an agent reads for the run.
   * @example this.excludeRemovedRun(studyId, 'removed-by-learner')
   */
  private excludeRemovedRun(
    studyId: string,
    exclusion: StudyRemovalExclusion,
  ): void {
    const record = this.recordOfStudy(studyId)
    if (record) this.service?.excludeHistory(record, exclusion)
  }

  /**
   * Makes this window forget a study that was removed: it is never written again, its run is excluded from history, and the list is read again. Called by {@link moveSavedStudy} once something of the study went to the Trash, and by {@link forgetStudiesRemovedByHand} for a study whose archive left the library without a removal of this window.
   * @param studyId - The removed study.
   * @param exclusion - How it was removed: `removed-by-learner` for this window's delete, `archive-removed` for a study that left the library otherwise, so an agent is not told of a Trash the study never went to.
   * @example await this.forgetRemovedStudy(studyId, 'archive-removed')
   */
  private async forgetRemovedStudy(
    studyId: string,
    exclusion: StudyRemovalExclusion,
  ): Promise<void> {
    this.removedStudyIds.add(studyId)
    this.excludeRemovedRun(studyId, exclusion)
    // The recording went to the Trash with the study; this window's writer of it is not kept.
    this.recordings?.release(studyId)
    this.archiveSignatures.delete(studyId)
    this.historyReceipts.delete(studyId)
    this.loadedHistory.delete(studyId)
    this.historyReads.delete(studyId)
    this.pendingArchives.delete(studyId)
    this.learningSave = withoutStudy(this.learningSave, studyId)
    try {
      this.catalog = await this.library!.list()
    } catch (error) {
      this.report('archive', error)
    }
  }

  /**
   * After a study left the library: drops the archives the reader still held of it, follows the ledger that no longer names it, and shows a neighbour when it is still the selection and nothing was chosen meanwhile; called by {@link showAfterCompletedRemoval}.
   * Both are read after the ledger read, so a choice that completes during it wins. A Node test history never changes the saved-study selection, so a choice is recognised by {@link studyChoices}, not by the selected study.
   * @param studyId - The study that was moved.
   * @param neighbours - The candidates from {@link removalNeighbours}, nearest first.
   * @param choiceGeneration - The count of chosen entries from before the removal's first step.
   * @example await this.showAfterRemoval(studyId, neighbours, choiceGeneration)
   */
  private async showAfterRemoval(
    studyId: string,
    neighbours: string[],
    choiceGeneration: number,
  ): Promise<void> {
    this.activeArchive = withoutStudy(this.activeArchive, studyId)
    this.selectedArchive = withoutStudy(this.selectedArchive, studyId)
    await this.refreshProgress()
    // A saved study chosen meanwhile is the selection already.
    if (this.selection.studyId !== studyId) return
    if (this.studyChoices !== choiceGeneration) {
      await this.leaveRemovedSelection()
      return
    }
    await this.showRemovalNeighbour(studyId, neighbours)
  }

  /** Takes the removed study out of the selection when the learner's own choice owns the reader: a choice that is still opening shows itself, or no study when it fails; one that has ended (a shown Node test history, a failed open) leaves the reader with no saved study. @example await this.leaveRemovedSelection() */
  private async leaveRemovedSelection(): Promise<void> {
    if (this.studyOpening()) {
      this.selectNoStudy()
      return
    }
    if (this.selectedNodeHistory) {
      // The Node test history the learner chose is shown with its own captured source; only the saved-study selection behind it changes.
      this.selectedArchive = undefined
      this.selectNoStudy()
      await this.saveSelection()
      return
    }
    await this.showNoStudyAfterRemoval()
  }

  /** Leaves the reader with no saved study after the shown one was removed and none follows it: selects none, renders and saves that selection. @example await this.showNoStudyAfterRemoval() */
  private async showNoStudyAfterRemoval(): Promise<void> {
    this.selectedArchive = undefined
    this.selectNoStudy()
    await this.renderShownSelection()
    await this.saveSelection()
  }

  /** Names the current run when the library refused it at its admission and no removal has made room for it yet. @example this.refusedRunAwaitingRoom()?.id */
  private refusedRunAwaitingRoom(): { id: string } | undefined {
    const current = this.currentRecord()
    return current?.historyExcluded === 'refused-at-admission' &&
      current.id !== this.answeredRunRefusalId
      ? current
      : undefined
  }

  /**
   * Retires the "did not start" line of the run the library refused when the library admits another study now; called after a removal by {@link settleMovedStudy} and after a change of the limit by {@link answerRefusedRunAfterLimitChange}.
   * @param usage - The library's count and its limit, read by the caller.
   * @returns The refused run that is answered, or `undefined` when no refused run waits or the library is still full or its limit invalid.
   * @example if (this.answerRefusedRunIfRoom({ count: 63, limit: 64 })) this.publish()
   */
  private answerRefusedRunIfRoom(usage: {
    count: number
    limit?: number
  }): { id: string } | undefined {
    const answeredRun = libraryHasRoom(usage)
      ? this.refusedRunAwaitingRoom()
      : undefined
    if (answeredRun) this.answeredRunRefusalId = answeredRun.id
    return answeredRun
  }

  /**
   * Follows a change of the Saved Study Limit setting: when the new limit leaves room, the run the full library refused is answered and its line goes; called by the configuration listener {@link initialize} installs.
   * A limit that leaves the library full, an invalid limit and a library that cannot be read keep the line.
   * @example void this.answerRefusedRunAfterLimitChange()
   */
  private async answerRefusedRunAfterLimitChange(): Promise<void> {
    const library = this.libraryOfRefusedRun()
    if (!library) return
    const usage = await library.usage().catch(() => undefined)
    if (usage && this.answerRefusedRunIfRoom(usage)) this.publish()
  }

  /**
   * Gives the library whose room decides about the run it refused; read by {@link answerRefusedRunAfterLimitChange} before it asks for the library's usage.
   * @returns The library while a refused run waits for room; `undefined` when no library is open or no refused run waits.
   * @example const library = this.libraryOfRefusedRun()
   */
  private libraryOfRefusedRun(): LearningLibrary | undefined {
    return this.library && this.refusedRunAwaitingRoom()
      ? this.library
      : undefined
  }

  /**
   * Reports a completed removal with the room the library now has, read once; when that room answers a run the library refused, its "did not start" line is retired and the learner is told to ask for the run again.
   * Both admission refusals are answered by room under a valid limit, so no refusal reason is stored.
   * @param studyId - The study that was moved.
   * @param isEvidenceLeftInPlace - Whether the run's raw evidence stayed because another Codebook window may still use it; the line then says so.
   * @param isLockLeft - Whether the storage lock could not be released; the run cannot be saved while it stays, so the line names no next step for a refused run.
   * @example await this.settleMovedStudy(studyId, false, false)
   */
  private async settleMovedStudy(
    studyId: string,
    isEvidenceLeftInPlace: boolean,
    isLockLeft: boolean,
  ): Promise<void> {
    const usage = await this.library!.usage().catch(() => ({
      count: this.catalog.length,
      limit: undefined,
    }))
    const answeredRun = isLockLeft
      ? undefined
      : this.answerRefusedRunIfRoom(usage)
    this.settleStudyRemoval({
      status: 'moved',
      studyId,
      text: studyRemovalMessages().moved(
        usage,
        Boolean(answeredRun),
        isEvidenceLeftInPlace,
      ),
    })
  }

  /**
   * Lists the saved studies the reader may show after a removal, nearest first: the entries that followed the removed one in the list (older ones), then those before it (newer ones), without entries that cannot be opened.
   * Read before the removal, while the removed entry still has its place in the catalog.
   * @param studyId - The study about to be removed.
   * @returns Ids to try in order; empty when no other study can be opened.
   * @example this.removalNeighbours(second.id) // => [third.id, first.id] for a list of first, second, third
   */
  private removalNeighbours(studyId: string): string[] {
    const position = this.catalog.findIndex((entry) => entry.id === studyId)
    if (position < 0) return []
    return [
      ...this.catalog.slice(position + 1),
      ...this.catalog.slice(0, position).toReversed(),
    ]
      .filter((entry) => entry.metadata === 'validated')
      .map((entry) => entry.id)
  }

  /** Reads the first of the given saved studies that can still be opened; an entry whose archive cannot be read is skipped like one the list marks as unavailable. @example await this.firstReadableStudy([olderStudyId, newerStudyId]) */
  private async firstReadableStudy(
    studyIds: string[],
  ): Promise<RetainedStudy | undefined> {
    for (const studyId of studyIds) {
      try {
        return await this.readSavedArchive(studyId)
      } catch {
        continue
      }
    }
    return undefined
  }

  /** Renders the reader's current selection after a removal or a discarded request changed what is shown; a closed reader renders nothing, and a rendering failure is reported like any other. @example await this.renderShownSelection() */
  private async renderShownSelection(): Promise<void> {
    if (!this.opened || this.closing) return
    await this.renderSelection(true, true).catch((error: unknown) =>
      this.report('reading', error),
    )
  }

  /**
   * Says whether the learner or an agent acted on the reader while the neighbour of a removed study was read, so that the neighbour is not shown; asked by {@link showRemovalNeighbour} in the turn that read has settled.
   * @param studyId - The study that was moved.
   * @param request - The history request number the neighbour's read took.
   * @param choiceGeneration - The count of study choices before the read.
   * @returns `true` when a study was chosen meanwhile, or a later request moved the reader off the removed study or back to the current run; `false` when the neighbour is still due.
   * @example if (this.hasReaderMovedOnFrom(removedStudyId, request, choiceGeneration)) return
   */
  private hasReaderMovedOnFrom(
    studyId: string,
    request: number,
    choiceGeneration: number,
  ): boolean {
    // An item chosen on the removed study takes a number too and leaves the reader on that study; the neighbour is then still due.
    const hasReaderMovedOn =
      request !== this.historyRequest &&
      (this.selection.studyId !== studyId || this.selection.follow)
    return this.studyChoices !== choiceGeneration || hasReaderMovedOn
  }

  /**
   * Shows the nearest remaining saved study after the shown one was removed, or no study when none can be opened; called by {@link showAfterRemoval} when nothing was chosen during the removal.
   * A study the learner chooses while the neighbour is read wins and never finds the removed study still selected; so does a return to the current run or repository evidence opened meanwhile, which take a history request number of their own and move the reader off the removed study. A reader that is closing, or has closed, renders nothing and remembers the neighbour.
   * @param studyId - The study that was moved.
   * @param neighbours - The candidates from {@link removalNeighbours}, nearest first.
   * @example await this.showRemovalNeighbour(removedStudyId, [olderStudyId])
   */
  private async showRemovalNeighbour(
    studyId: string,
    neighbours: string[],
  ): Promise<void> {
    // The number retires older reads, and a later number says that the learner or an agent acted on the reader while the neighbour was read.
    const request = ++this.historyRequest
    const choiceGeneration = this.studyChoices
    const shown = await this.firstReadableStudy(neighbours)
    if (this.hasReaderMovedOnFrom(studyId, request, choiceGeneration)) {
      if (this.selection.studyId === studyId) await this.leaveRemovedSelection()
      return
    }
    if (!shown) {
      await this.showNoStudyAfterRemoval()
      return
    }
    this.selectedArchive = shown
    await this.showSavedStudy(shown, () => this.renderShownSelection())
  }

  /** Says whether no saved study or Node test history was chosen since this request took its number, on a reader that is not closing. @example if (!this.isLatestHistoryRequest(request)) return */
  private isLatestHistoryRequest(request: number): boolean {
    return request === this.historyRequest && !this.closing
  }

  /** Leaves the reader without a selected study after the shown one was removed and nothing replaces it yet; called by {@link leaveRemovedSelection} and {@link showNoStudyAfterRemoval}. @example this.selectNoStudy() */
  private selectNoStudy(): void {
    this.readerSelectionRevision++
    this.selection = { ...NO_STUDY_SELECTION }
  }

  /**
   * Shows one saved study in the reader: selects it, arranges the reader when a live or summary composition is up, renders and saves the selection; called for an entry the learner chose and for the neighbour of a removed study, so both arrive the same way.
   * @param archive - The saved study to show.
   * @param render - The render step; the neighbour passes one that skips a closed reader and reports its own failure.
   * @example await this.showSavedStudy(archive)
   */
  private async showSavedStudy(
    archive: RetainedStudy,
    render: () => Promise<void> = () => this.renderSelection(true, true),
  ): Promise<void> {
    // The archive is held here, not only by the caller: a removal that settled since the caller read it may have dropped what was held.
    this.selectedArchive = archive
    this.selectArchive(archive)
    this.studyAwaitingEditorArea = undefined
    // With the bottom panel maximized the editor area is hidden; showing the study's panes now would bring the area back and take the panel, where the learner is choosing, out of its maximized state.
    if (this.replayReaderOpen && (await this.editorAreaHidden())) {
      this.studyAwaitingEditorArea = {
        selectionRevision: this.readerSelectionRevision,
        arrange: this.needsReaderArrangement(),
      }
      this.errors.delete('reading')
      this.loading = false
      this.publish()
      await this.saveSelection()
      return
    }
    // A live or summary composition is arranged for what it showed; a saved study needs the reader's own arrangement.
    if (this.needsReaderArrangement()) await this.open()
    // The reason an earlier study could not be arranged or read does not outlive the study that is shown now.
    this.errors.delete('reading')
    await render()
    await this.saveSelection()
  }

  /**
   * Says whether the editor area is hidden, as it is while the bottom panel is maximized; called before the reader shows or reveals a pane.
   * @returns `true` when the editor reports its stacked groups without height (see {@link isCollapsedEditorLayout}); `false` for a visible area, a layout without stacked groups, or a host that reports no pixels.
   * @example if (await this.editorAreaHidden()) return
   */
  private async editorAreaHidden(): Promise<boolean> {
    return isCollapsedEditorLayout(
      await vscode.commands.executeCommand<unknown>('vscode.getEditorLayout'),
    )
  }

  /** Says whether the selected saved study still waits for the editor area the learner hid before choosing it; the reader's timer then leaves the panes as they are, while an explicit entry, selection or placement shows them. @example if (!this.studyAwaitsEditorArea()) await this.renderSelection(true, false, signal) */
  private studyAwaitsEditorArea(): boolean {
    return (
      !this.recordingActive &&
      this.studyAwaitingEditorArea?.selectionRevision ===
        this.readerSelectionRevision
    )
  }

  /**
   * Shows the saved study that was chosen while the editor area was hidden, once the area is back; called by every {@link refresh} after it released its lock.
   * A study that is no longer the selection, or a recording opened meanwhile, ends the wait without showing anything.
   * @param signal - The refresh's cancellation.
   * @example await this.showStudyAwaitingEditorArea(signal)
   */
  private async showStudyAwaitingEditorArea(
    signal?: AbortSignal,
  ): Promise<void> {
    const awaited = this.studyAwaitingEditorArea
    if (!awaited) return
    if (!this.studyAwaitsEditorArea() || !this.opened || this.closing) {
      this.studyAwaitingEditorArea = undefined
      return
    }
    if (this.presentationTransition || this.repositoryNavigation !== undefined)
      return
    // The wait has no end, so only its polling is bounded: one layout request in flight, and at most one in {@link STUDY_EDITOR_AREA_LOOK_INTERVAL_MS}.
    const nowMs = performance.now(),
      lastLook = this.editorAreaLook
    if (
      lastLook &&
      (lastLook.answer !== undefined ||
        nowMs - lastLook.sentAtMs < STUDY_EDITOR_AREA_LOOK_INTERVAL_MS)
    )
      return
    const answer = this.editorAreaHidden(),
      look: NonNullable<StudyWorkspace['editorAreaLook']> = {
        sentAtMs: nowMs,
        answer,
      }
    this.editorAreaLook = look
    const hidden = await answer.finally(() => {
      look.answer = undefined
    })
    if (hidden) return
    this.editorAreaLook = undefined
    // A newer choice or a close during the read owns the reader now.
    if (this.studyAwaitingEditorArea !== awaited || this.closing) return
    this.studyAwaitingEditorArea = undefined
    try {
      if (awaited.arrange && this.needsReaderArrangement())
        await this.open(signal)
      await this.renderSelection(true, true, signal)
    } catch (error) {
      signal?.throwIfAborted()
      this.report('reading', error)
    }
  }

  /** Says whether an open reader still shows a live or summary composition, which a saved study replaces through {@link open}. @example if (this.needsReaderArrangement()) await this.open() */
  private needsReaderArrangement(): boolean {
    return (
      (this.liveComposition || this.summaryComposition) &&
      this.opened &&
      !this.closing
    )
  }

  /**
   * Creates the shared historical debugger that browser replay and saved Node stops present through.
   * @returns A {@link ReplayDebugger} whose notifications reach {@link replayDebuggerChanged} and whose listener failures reach the reader's errors.
   * @example this.replayDebugger ??= this.createReplayDebugger()
   */
  private createReplayDebugger(): ReplayDebugger {
    return new ReplayDebugger(
      vscode,
      (reason) => this.replayDebuggerChanged(reason),
      (error) => this.report('replay-debugger', error),
    )
  }

  /**
   * Drops a stale Run and Debug hint when {@link ReplayDebugger} reports loaded values or an ended session; the next presentation re-evaluates it.
   * An ended session also re-enables Node Inspect, which restarts the debugger through {@link replaceUnavailableReplayDebugger}.
   * @param reason - Whether native Run and Debug loaded values or the learner ended the owned session.
   * @example this.replayDebuggerChanged('session-ended')
   */
  private replayDebuggerChanged(reason: ReplayDebuggerChange): void {
    if (this.closing) return
    // Handling this notification succeeded, so an earlier failure to handle one no longer describes the debugger.
    const failureCleared = this.errors.delete('replay-debugger')
    // The ended session no longer shows the Node stop, whether or not a hint was showing.
    const availabilityChanged =
      reason === 'session-ended' && this.selectedNodeHistoryDebugAvailable
    if (availabilityChanged) this.selectedNodeHistoryDebugAvailable = false
    const hintShown =
      Boolean(this.replayUninspectedSnapshot) ||
      this.selectedNodeHistoryValuesUninspected
    this.replayUninspectedSnapshot = undefined
    this.selectedNodeHistoryValuesUninspected = false
    if (availabilityChanged || hintShown || failureCleared) this.publish()
  }

  /** Selects one verified Node journal moment and clears stale debugger state across unrecorded intervals. @example await this.selectNodeHistoryEvent(history, 24) */
  private async selectNodeHistoryEvent(
    history: NodeTestHistoryIndex,
    sequence: number,
    requireDebugger = false,
    publish = true,
    alignPlayback = true,
  ): Promise<void> {
    const request = ++this.selectedNodeHistoryRequest
    if (publish) this.nodeHistoryPlaybackController?.pause()
    const entry = history.entries.find((value) => value.sequence === sequence)
    if (!entry)
      throw new Error('The requested Node history event is unavailable.')
    if (entry.type === 'stop') {
      const source = entry.debuggerSnapshot.frames[0]?.source
      const sourceMatchesStop = nodeStopSourceMatches(entry)
      if (!sourceMatchesStop && requireDebugger) {
        throw new Error(
          'The selected Node stop has no matching verified captured source for native debugging.',
        )
      }
      if (sourceMatchesStop && source) {
        const verifiedSource = source
        const sourceUri = vscode.Uri.from({
          scheme: STUDY_SOURCE_SCHEME,
          authority: this.library!.workspaceKey,
          path: `/node-history/${history.header.studyId}/${entry.sequence}/${verifiedSource.hash}/Captured-${basename(entry.source.path)}`,
        })
        // Only an explicit learner selection restarts a debugger the learner stopped; seek and Play report why they stopped.
        if (this.replayDebugger && !this.replayDebugger.available && !publish)
          throw new Error(
            'The historical Node debugger was stopped. Select this stop or use Inspect in native debugger to restart it.',
          )
        if (
          (this.replayDebugger && !this.replayDebugger.available) ||
          this.replayDebuggerRetirement
        ) {
          await this.replaceUnavailableReplayDebugger()
          // The reader may have closed or selected another stop meanwhile; only the current selection creates the next owner.
          if (request !== this.selectedNodeHistoryRequest) return
        }
        this.replayDebugger ??= this.createReplayDebugger()
        let inspection: ReplayInspection
        try {
          inspection = await this.replayDebugger.present(
            entry.debuggerSnapshot,
            `Recorded Node test stop ${entry.index + 1} · ${entry.source.path}:${entry.frame.line}`,
            new AbortController().signal,
            { uri: sourceUri.toString(), hash: verifiedSource.hash },
          )
        } catch (error) {
          // A newer learner selection supersedes this stop's native presentation; only the current request reports failures.
          if (request !== this.selectedNodeHistoryRequest) return
          throw error
        }
        if (request !== this.selectedNodeHistoryRequest) return
        this.selectedNodeHistoryDebugAvailable = true
        this.selectedNodeHistoryValuesUninspected = inspection === 'uninspected'
      } else {
        this.replayDebugger?.invalidate()
        this.selectedNodeHistoryDebugAvailable = false
        this.selectedNodeHistoryValuesUninspected = false
      }
    } else {
      // Output and result events have no source/debugger snapshot; never carry an earlier stop forward.
      this.replayDebugger?.invalidate()
      this.selectedNodeHistoryDebugAvailable = false
      this.selectedNodeHistoryValuesUninspected = false
    }
    try {
      await this.nodeHistoryStore!.saveReaderPosition(
        history.header.studyId,
        entry.sequence,
        history,
      )
    } catch (error) {
      this.report('history-position', error)
    }
    if (request !== this.selectedNodeHistoryRequest) return
    this.selectedNodeHistorySequence = entry.sequence
    this.selectedNodeHistoryPage = Math.floor(
      history.entries.findIndex((value) => value.sequence === entry.sequence) /
        NODE_HISTORY_READER_PAGE_SIZE,
    )
    if (alignPlayback)
      this.nodeHistoryPlaybackController?.select(entry.sequence)
    if (publish) this.publish()
  }

  /** Persists navigation independently; failures do not erase prior learner decisions. @example await this.saveSelection() */
  private async saveSelection(): Promise<void> {
    try {
      await this.library!.select(this.selection)
    } catch (error) {
      this.report('progress', error)
    }
  }

  /**
   * Writes the selection of the study whose recording was just shown to the ledger, so the Study workspace opens on that study after a restart; the playback controller's `changed` callback calls it once per opened recording, at the first shown position of its load.
   *
   * A load that failed or was superseded never reaches a shown position, so it writes nothing and the ledger keeps the earlier selection.
   * Seeks, Play and Pause of the open recording are not loads and write nothing. The selection's tab is written as the reader holds it.
   *
   * @param studyId - The study of the shown recording, as the playback state names it.
   * @returns Nothing; the write is kept in {@link shownRecordingSelectionSaved}, which the position save of the same shown position waits for, and a storage failure becomes the pane's `progress` line through {@link saveSelection}.
   * @example this.saveShownRecordingSelection(this.playback?.state().studyId)
   */
  private saveShownRecordingSelection(studyId: string | undefined): void {
    // A selection that already names another study, or a study on its way to the Trash, is not written.
    if (
      !studyId ||
      this.selection.studyId !== studyId ||
      this.isStudyLeavingLibrary(studyId)
    )
      return
    this.shownRecordingSelectionSaved = this.saveSelection()
  }

  /**
   * Says whether a study is moving to the Trash or was moved there by this window, so a queued write about it is dropped; the playback controller's position save and {@link saveShownRecordingSelection} ask it.
   * @param studyId - The study the queued write names.
   * @returns `true` while a confirmed removal moves its files or after {@link isRemovedStudy} reports it removed, otherwise `false`.
   * @example if (this.isStudyLeavingLibrary(bundle.studyId)) return
   */
  private isStudyLeavingLibrary(studyId: string): boolean {
    return this.isRemovedStudy(studyId) || this.movingStudyId() === studyId
  }

  /** Retires only a replay-loading mode warning once the controller confirms its first position; playback changes call it. @example this.clearReadyReplayWarning() */
  private clearReadyReplayWarning(): void {
    const state = this.playback?.state(),
      warning = this.errors.get('presentation')
    if (
      state?.readiness !== 'ready' ||
      state.cleared ||
      !this.playback?.bundle()
    )
      return
    if (warning?.includes(FIRST_REPLAY_POSITION_WARNING))
      this.errors.delete('presentation')
    if (this.presentationReason?.includes(FIRST_REPLAY_POSITION_WARNING)) {
      this.presentationReason = undefined
      this.requestedPresentation = undefined
    }
  }

  /**
   * Keeps storage, control and renderer failures distinct in the learner-facing status: one line per kind, published at once; every failure path of the reader calls it.
   * @param kind - The line the failure replaces; {@link READER_ERROR_KINDS} says whether Retry storage / refresh or the learner's next choice answers it.
   * @param error - The failure, shown as its string form.
   * @example this.report('archive', error)
   */
  private report(kind: ReaderErrorKind, error: unknown): void {
    if (CHOICE_RETIRED_ERROR_KINDS.has(kind)) this.controlRefusals++
    this.errors.set(kind, String(error))
    if (kind === 'presentation') this.clearReadyReplayWarning()
    this.publish()
  }
}

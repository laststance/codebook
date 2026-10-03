import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import * as vscode from 'vscode'
import { z } from 'zod'

import {
  AGENT_STORAGE_DIRECTORY,
  CHOICE_RETIRED_ERROR_KINDS,
  HORIZONTAL_EDITOR_ORIENTATION,
  LIVE_EDITOR_GROUP_COUNT,
  LIVE_EDITOR_LAYOUT,
  CONTROL_RETIRING_MESSAGE_TYPES,
  MAIN_THREAD_WEBVIEW_PREFIX,
  MAX_DEFERRED_OPEN_REPLIES,
  MAX_SOURCE_DOCUMENTS,
  NODE_TEST_PROFILE,
  MILLISECONDS_PER_SECOND,
  PRESENTATION_PREFERENCE_KEY,
  PRESENTATION_PREFERENCE_VERSION,
  PRESENTATION_READY_TIMEOUT_MS,
  PRESENTATION_SETTLE_CEILING_MS,
  READER_CLOSE_STORAGE_TIMEOUT_MS,
  RECORDING_WINDOW_FOCUS_WAIT_MS,
  REPLAY_VIEWPORT_RECEIPT_LIMIT,
  REPOSITORY_BROWSER_PROFILE,
  REPOSITORY_MIN_EDITOR_GROUP_COUNT,
  REPOSITORY_READER_DEBOUNCE_MS,
  REPOSITORY_SOURCE_LIMIT_BYTES,
  SHOW_NATIVE_VARIABLES_COMMANDS,
  STUDY_EDITOR_GROUP_COUNT,
  STUDY_LAYOUT_STABLE_MISMATCH_MS,
  STUDY_PRESENTATIONS,
  STUDY_REFRESH_INTERVAL_MS,
  STUDY_REMOVAL_REFUSALS,
  STUDY_SOURCE_SCHEME,
  SUMMARY_PLACEMENT_ACTION,
  SUMMARY_PLACEMENT_OFFER,
  SUMMARY_PLACEMENT_OFFER_KEY,
  UNRETRYABLE_READER_ERROR_KINDS,
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
import { BrowserViewport } from './runtimeSupport/browserViewport'
import {
  CAPTURE_TIMEOUT_MS,
  VIEWPORT_ACK_TIMEOUT_REASON,
} from './runtimeSupport/constants'
import { awaitResponse } from './runtimeSupport/utils/awaitResponse'
import { sha256 } from './runtimeSupport/utils/sha256'
import { waitUntil } from './runtimeSupport/utils/waitUntil'
import { explainNodeHistorySchema } from './schemas'
import type { StudyRecord, StudyService } from './service'
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
  type StudyRemovalView,
  type StudyViewMessage,
} from './ui/studyHtml'
import { bookObservationHash } from './utils/bookObservationHash'
import { capturedAppHtml } from './utils/capturedAppHtml'
import { captureStudy } from './utils/captureStudy'
import { configuredObservationPosition } from './utils/configuredObservationPosition'
import { createRecordingObserver } from './utils/createRecordingObserver'
import { describeStudy } from './utils/describeStudy'
import {
  describeViewportDelivery,
  type ViewportDeliveryLog,
} from './utils/describeViewportDelivery'
import { editorLayoutGroupCount } from './utils/editorLayoutGroupCount'
import { evidenceInUseElsewhere } from './utils/evidenceInUseElsewhere'
import { focusWebview } from './utils/focusWebview'
import { foreignPreviewObstacle } from './utils/foreignPreviewObstacle'
import { isBalancedEditorLayout } from './utils/isBalancedEditorLayout'
import { isCodebookPaneViewType } from './utils/isCodebookPaneViewType'
import {
  editorLayoutSchema,
  isProportionalEditorLayout,
} from './utils/isProportionalEditorLayout'
import { libraryHasRoom } from './utils/libraryHasRoom'
import { NodeHistoryPlaybackController } from './utils/nodeHistoryPlaybackController'
import { nodeStopSourceMatches } from './utils/nodeStopSourceMatches'
import { normalizeNativeSourceText } from './utils/normalizeNativeSourceText'
import { projectLearningSummary } from './utils/projectLearningSummary'
import { projectPlaybackStudy } from './utils/projectPlaybackStudy'
import {
  type OpenRequestSettled,
  openRequestNumberSchema,
  type PaneOpenRequest,
  readOpenRequest,
} from './utils/readOpenRequest'
import { retainEditorReadingPosition } from './utils/retainEditorReadingPosition'
import { savedStudyIdentityLine } from './utils/savedStudyIdentityLine'
import { selectStudy } from './utils/selectStudy'
import { settledWithin } from './utils/settledWithin'
import { studyEvidenceDirectory } from './utils/studyEvidenceDirectory'
import { studyRemovalMessages } from './utils/studyRemovalMessages'
import { toPixelEditorLayout } from './utils/toPixelEditorLayout'
import { untilAborted } from './utils/untilAborted'
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
  }),
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

/** Owns the retained learner reader while {@link StudyService} owns execution; activation constructs it before MCP-first runs. @example await workspace.open() */
export class StudyWorkspace {
  private service?: StudyService
  private learningSaveItem?: vscode.StatusBarItem
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
  private readonly pendingArchives = new Map<
    string,
    {
      archive: RetainedStudy
      service: StudyService
      record: StudyRecord
      signature: string
      checkpointRevision: number
    }
  >()
  private readonly archiveWrites = new Map<string, Promise<void>>()
  /** The learner's last removal of a saved study, from its confirmation dialog to its outcome; while it is `moving`, its study is neither written nor opened. */
  private studyRemoval?: StudyRemovalView
  /** Settles, without a rejection, once the files of the study a confirmed removal is taking to the Trash have moved or stayed (the removal left `moving`); a {@link checkpoint} of that study waits for it, not for the study shown afterwards. */
  private studyMove?: Promise<void>
  /** Settles {@link studyMove}; called when the removal's outcome is settled and again when the removal ends. */
  private releaseStudyMove?: () => void
  /** Counts the completed removals that still show the study that follows; an entry chosen meanwhile does not retire the outcome line the learner has not read yet. */
  private removalFollowersShowing = 0
  /** The current run when the last removal ended; a later run retires that removal's outcome line. */
  private studyRemovalRunId?: string
  /** Studies this window moved to the system Trash; a position save still queued for one of them writes nothing. */
  private readonly removedStudyIds = new Set<string>()
  /** The refused run for which a removal made room; its "did not start" line is no longer shown. */
  private answeredRunRefusalId?: string
  private readonly errors = new Map<string, string>()
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
  private liveEntryRunId?: string
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
  private layoutReceipt?: {
    mode: 'study' | 'repository' | 'study-reentry'
    signature: string
    groups: { group: vscode.TabGroup; column: vscode.ViewColumn }[]
    panes: ReturnType<StudyWorkspace['studyPanePositions']>
    sourceTargetColumn?: vscode.ViewColumn
    pendingPanes?: ReturnType<StudyWorkspace['studyPanePositions']>
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
      start(): Promise<StudyService>
      connect(): Promise<void>
      returnToRepository?(selection: RepositorySelection): Promise<void>
      openArticle?(selection: RepositorySelection): Promise<void>
      /** Tells whether the Wiki reader of this host owns its Repository Wiki panel; a Wiki tab seen while it does not is an earlier host's. */
      repositoryWikiOpen?(): boolean
    },
  ) {
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
      if (!currentSourceReady)
        // The reader's own pending recorded presentation is still placing the source: nothing for the learner to recover.
        reason =
          this.playback?.state().readiness === 'loading'
            ? 'The recorded source is opening in its native pane.'
            : 'The current captured source is not ready in its native pane. Wait for it, or use Return to current with the latest reader revision before restoring the layout.'
      else if (!matchingColumns)
        reason =
          'The application or source pane is no longer in its Study destination. Focus the existing Study or Application pane, then restore its layout. Opening Repository Wiki does not repair Study.'
      else if (!matchingLayoutReceipt)
        reason =
          'The native editor layout receipt no longer matches the Study panes. Focus the existing Study or Application pane, then restore its layout. Opening Repository Wiki does not repair Study.'
      else
        reason =
          'The Study arrangement is not confirmed. Focus the existing Study or Application pane, then restore its layout. Opening Repository Wiki does not repair Study.'
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
      reason,
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
    if (
      !this.presentationTransition &&
      state.presentationId === this.presentationId &&
      state.presentationControlRevision === this.presentationControlRevision &&
      receipt === this.layoutReceipt &&
      ((layout !== undefined && JSON.stringify(layout) !== receipt.signature) ||
        !this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) ||
        !this.sameStudyPanePositions(receipt.panes))
    ) {
      this.presentationConfirmed = false
      this.publish()
    }
    // An unmeasurable active part qualifies this response only; it cannot invalidate or certify the retained main grid.
    return layout === undefined
      ? {
          ...this.presentationState(),
          layoutConfirmed: false,
          reason:
            'Main editor layout could not be checked without changing focus. Focus a Codebook pane or main text editor and read again.',
        }
      : this.presentationState()
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
   * Remembers every Codebook pane tab that is in the window while this host owns no pane of its kind: such a tab belongs to an earlier extension host. Called by the constructor, by {@link deadPaneTabs} and before this host creates a pane.
   * A view type cannot tell a live pane from a dead one, so a tab is known as dead only from the moment it was seen without an owner, and stays known after this host creates its own pane.
   * @example
   * ```ts
   * this.rememberInheritedPanes() // before vscode.window.createWebviewPanel('codebook.scopedBrowser', ...)
   * ```
   */
  private rememberInheritedPanes(): void {
    const ownsWorkspacePane = Boolean(this.app || this.contextPanel),
      // An embedder that does not tell is taken to own its Repository Wiki pane, so a live one is never closed.
      ownsWikiPane = this.controls.repositoryWikiOpen?.() ?? true
    for (const tab of vscode.window.tabGroups.all.flatMap(
      (group) => group.tabs,
    )) {
      if (
        !(tab.input instanceof vscode.TabInputWebview) ||
        !isCodebookPaneViewType(tab.input.viewType)
      )
        continue
      const ownsKind = isCodebookPaneViewType(
        tab.input.viewType,
        'codebook.repositoryWiki',
      )
        ? ownsWikiPane
        : ownsWorkspacePane
      if (!ownsKind) this.inheritedPaneTabs.add(tab)
    }
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
      (this.liveComposition || this.summaryComposition) &&
      (input.mode !== 'study-workspace' || input.action === 'save-preference')
    )
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Live and replay use one app/source layout with the chat or learning summary in the sidebar.',
      )
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
    if (
      !this.liveComposition &&
      !this.summaryComposition &&
      !(focusedTab && this.leftoverTabs().includes(focusedTab))
    )
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
      if (closed.closedAny && !closed.deadPaneKept)
        await this.waitForEditorAfterClose(
          closed.closedSourceUris,
          transition.cancellation.signal,
        )
    } finally {
      if (this.presentationTransition === transition)
        this.presentationTransition = undefined
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
      if (
        closed.capturedSourceKept &&
        error instanceof StudyError &&
        error.code === 'PRESENTATION_UNAVAILABLE'
      )
        throw new StudyError(
          error.code,
          error.message,
          'A leftover captured source tab could not be closed.',
        )
      throw error
    }
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
      const transition = {
        id: this.presentationId,
        cancellation: new AbortController(),
        runtimeIdentity: this.assertPresentationAdmission(),
      }
      const focusedPane = this.trackFocusedStudyPane(),
        lifetime = this.lifetime
      const recordedBundle = this.recordingActive
        ? this.playback?.bundle()
        : undefined
      this.presentationTransition = transition
      this.presentationControlRevision++
      const pending = (async () => {
        try {
          // Read/Enlarge may hide the other main leaf; restore visibility before measuring the two-pane layout.
          await vscode.commands.executeCommand(
            'workbench.action.minimizeOtherEditors',
          )
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
          this.assertLifetime(lifetime)
          transition.cancellation.signal.throwIfAborted()
          focusedPane.assertCurrent()
          if (transition.runtimeIdentity !== this.assertPresentationAdmission())
            throw new StudyError(
              'PRESENTATION_UNAVAILABLE',
              'The live pause changed during presentation placement.',
            )
          if (recordedBundle && recordedBundle !== this.playback?.bundle())
            throw new StudyError(
              'PRESENTATION_UNAVAILABLE',
              'The recorded moment changed during presentation placement.',
            )
          this.presentationConfirmed = Boolean(this.layoutReceipt)
          if (this.presentationConfirmed) {
            this.presentationReason = undefined
            this.errors.delete('layout')
            this.errors.delete('presentation')
          }
        } catch (error) {
          this.presentationConfirmed = false
          this.presentationReason = String(error)
          throw error
        } finally {
          focusedPane.dispose()
          if (this.presentationTransition === transition)
            this.presentationTransition = undefined
          this.publish()
        }
        const restored = this.presentationState()
        // The host can replace a pane wrapper after Arrange; a layout lacking its current receipt is not a successful Restore.
        if (!restored.layoutConfirmed)
          throw new StudyError(
            'PRESENTATION_UNAVAILABLE',
            'The live Study layout could not be confirmed after Restore.',
            restored.reason,
          )
        return restored
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
    if (
      input.action === 'select' &&
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
    const restoreFocus =
      input.action === 'save-preference'
        ? undefined
        : this.capturePresentationFocus(
            leftoverTabs === 'pending'
              ? undefined
              : leftoverTabs.closedFocus?.activatedTab,
          )
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
        if (layout === undefined)
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

  /** Repairs an existing Study grid without replacing its evidence panes; Restore uses it after focused reading. @example await this.restoreStudyArrangement(intent) */
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
        await vscode.commands.executeCommand(
          'workbench.action.minimizeOtherEditors',
        )
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
        } else if (
          await this.hasRetainedStudyTopology(
            transition.cancellation.signal,
            focusedPane.beforeScopeFocus,
          )
        ) {
          focusedPane.assertCurrent()
          await this.readStudyPane('context', transition.cancellation.signal)
          this.errors.delete('layout')
        } else
          throw new StudyError(
            'PRESENTATION_UNAVAILABLE',
            'The Study panes changed during Restore. Existing editor work was preserved.',
          )
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
        if (
          !record.prepared ||
          record.stopping ||
          record.sourceReveals.size ||
          !record.runtime
        )
          throw new StudyError(
            'PRESENTATION_UNAVAILABLE',
            'Runtime preparation, cleanup or source reveal is still pending.',
          )
        const view = record.runtime.view(),
          participants = Object.values(view.participants)
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
        const paused = participants.filter(
          (participant) => participant.phase === 'paused',
        )
        if (!['ready', 'completed'].includes(view.status)) {
          if (
            !view.status.startsWith('paused-') ||
            !paused.length ||
            paused.some((participant) => {
              const snapshot = participant.snapshot
              return (
                !snapshot ||
                snapshot.pause.generation !== participant.pause?.generation ||
                snapshot.pause.sessionId !== participant.pause.sessionId ||
                snapshot.pause.threadId !== participant.pause.threadId ||
                view.captures[snapshot.capturePhase]?.status !== 'captured'
              )
            })
          )
            throw new StudyError(
              'PRESENTATION_UNAVAILABLE',
              'Presentation requires a stable ready/completed run or a committed inspected pause.',
            )
        }
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
   * Retains the logical reading region for one admitted handoff; foreign editors still require an exact source receipt. Called by {@link admitPresentation} before a selection or restore changes any pane.
   * @param activatedByClose - The tab the editor activated in place of a focused leftover tab this selection just closed; `undefined` when no focused tab closed or its group is now empty. That tab was never the learner's reading position, so only the group focus is kept. A non-text page that is not that tab is refused like any foreign editor.
   * @returns The function that gives focus back once the presentation is placed. Its third argument is `true` only after a confirmed placement: a learner's document that shares the captured source's group then stays open behind that source instead of covering it.
   * @throws `PRESENTATION_UNAVAILABLE` when the focused editor is a foreign non-text editor whose focus cannot be given back.
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
        if (
          !panel ||
          this.presentationTransition?.id !== presentationId ||
          this.presentationControlRevision !== revision + 1
        )
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
        if (document.version !== documentVersion)
          throw new Error(
            'The previously focused document changed during presentation; its current reading position was preserved.',
          )
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
        // The learner's document stays open behind a captured source that was placed in its own group.
        if (
          this.staysBehindPlacedSource(
            document,
            currentGroup,
            placedSourceStays,
          )
        )
          return
        const restored = await vscode.window.showTextDocument(document, {
          viewColumn: currentGroup.viewColumn,
          preserveFocus: false,
          preview,
        })
        if (document.version !== documentVersion)
          throw new Error(
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
    throw new StudyError(
      'PRESENTATION_UNAVAILABLE',
      'Focus a Codebook pane or text editor before selecting a presentation; the current foreign editor cannot be restored safely.',
    )
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
        if (!this.opened) await this.open(signal, 'presentation')
        assertCurrent()
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

  /** Requires both document and native owned-tab focus for the final reading restoration. @example await this.focusPresentationPanel(panel, signal) */
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
      })
    } finally {
      for (const subscription of focusChanges) subscription.dispose()
    }
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
              input instanceof vscode.TabInputWebview &&
              isCodebookPaneViewType(input.viewType, kind) &&
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
      const focusedPane = this.trackFocusedStudyPane(true)
      try {
        // Maximize may settle after a newer learner tab choice; only its original owned target may publish Read success.
        assertReadFocus()
        await vscode.commands.executeCommand(
          'workbench.action.maximizeEditorHideSidebar',
        )
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

  /** Watches Read and Restore from the focused tab so later learner navigation wins over host commands; Restore announces its temporary main-part focus before measuring layout. @param requireOwned - Require the starting tab to be a Codebook pane; Read and the three-pane Restore do. The live and replay Restore starts from whichever tab has focus (an agent restores while the learner's file or the debugger's stop is focused), so no pane has to be clicked first. @example const focus = this.trackFocusedStudyPane(); focus.assertCurrent(); focus.dispose() */
  private trackFocusedStudyPane(requireOwned = false): {
    assertCurrent(): void
    beforeScopeFocus(acquire?: RepositoryFocusTarget): void
    dispose(): void
  } {
    const group = vscode.window.tabGroups.activeTabGroup,
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
      const active = vscode.window.tabGroups.activeTabGroup,
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
      pendingBorrow: RepositoryFocusTarget | undefined
    const observe = (): void => {
      if (departed) return
      // Leaving the work window revokes Restore even if focus returns before native measurement completes.
      if (!vscode.window.state.focused) {
        departed = true
        return
      }
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
      dispose(): void {
        for (const subscription of subscriptions) subscription.dispose()
      },
    }
  }

  /** Enlarges an owned pane while retaining the measured grid that {@link tryConfirmEnlargedLayout} restores. Called by both Study Enlarge actions. @example await this.enlargePresentationPanel(this.app!, 'app') */
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
    await this.focusPresentationPanel(panel)
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
    const assertRetained = this.retainPresentationPlacement()
    this.enlargedLayoutReceipt = undefined
    this.presentationConfirmed = false
    try {
      // Expand exits any previous maximization and can change group sizes; capture those sizes before Maximize.
      await vscode.commands.executeCommand(
        'workbench.action.minimizeOtherEditors',
      )
      assertRetained()
      const expanded = retained
        ? await this.readPassivePresentationLayout()
        : undefined
      assertRetained()
      await vscode.commands.executeCommand(
        'workbench.action.toggleMaximizeEditorGroup',
      )
      assertRetained()
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
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs.filter((tab) => tab.isPreview)) {
          if (isOwnedPreview(tab)) continue
          if (tab.input instanceof vscode.TabInputText && isKeptPreview(tab))
            preparedPreviews.push({ uri: tab.input.uri, group, tab })
          else throw refusePreview(tab, group)
        }
      }
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
          released: () => {
            // A retired runtime cannot close or replace the panel attached to a newer lease.
            if (this.leaseId !== leaseId) return
            this.viewport = undefined
            this.leaseId = undefined
            if (this.opened && this.baselines)
              void this.renderSelection().catch((error) =>
                this.report('reader', error),
              )
            else this.app?.dispose()
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
      this.ensureApp()
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
            compositionChanged &&
            !firstOpen &&
            !reentry &&
            this.repositoryLayoutOrigin &&
            JSON.stringify(grid.layout) !==
              JSON.stringify(this.repositoryLayoutOrigin.layout)
          ) {
            throw new Error(
              'The learner layout changed during feature entry; its current arrangement was preserved. Retry explicitly.',
            )
          }
          const count = grid.groups.length
          needsInitialReservation =
            count < REPOSITORY_MIN_EDITOR_GROUP_COUNT ||
            (count < this.studyGroupCount() &&
              (compositionChanged ||
                count < vscode.window.tabGroups.all.length ||
                (!firstOpen && Boolean(this.repositoryLayoutOrigin))))
        })
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
      )
        this.app?.reveal(undefined, true)
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
      if (this.recordingActive && (firstOpen || !this.replayViewport))
        this.playback?.reveal()
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
    } catch (error) {
      // A failed first entry remains retryable without retiring a newer Open or discarding accepted native effects.
      if (
        firstOpen &&
        request === this.readerOpenNumber &&
        lifetime === this.lifetime &&
        !this.closing
      )
        this.opened = false
      throw error
    } finally {
      if (request === this.readerOpenNumber) this.releaseSourceEntry()
      signal?.removeEventListener('abort', cancel)
    }
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
            await this.checkpoint(service, record, true)
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
    if (action === 'show-variables')
      for (const command of SHOW_NATIVE_VARIABLES_COMMANDS)
        await vscode.commands.executeCommand(command)
    if (action === 'arrange') {
      try {
        // A Study click can precede Cursor's native focus notification after unmaximizing Application.
        if (this.contextPanel)
          await this.focusPresentationPanel(this.contextPanel)
        const state = this.presentationState()
        await this.changePresentation({
          presentationId: state.presentationId,
          expectedRevision: state.presentationControlRevision,
          mode: state.mode,
          action: 'restore',
        })
      } catch (error) {
        if (this.closing || this.disposed) throw error
        this.report(
          'layout',
          new Error(
            error instanceof StudyError ? error.causeDetail : String(error),
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
        try {
          for (const id of this.pendingArchives.keys())
            await this.persistArchive(id)
          // Historical interpretations remain writable after a later run becomes current.
          if (this.service)
            for (const record of this.service.records.values())
              await this.checkpoint(this.service, record, true)
          await this.library!.reconcile()
          this.catalog = await this.library!.list()
          this.errors.delete('archive')
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

  /** Saves explicit reader/outline choices to their displayed source context, retaining the saved value on failure. @example await workspace.understand(true) */
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
      this.report('progress', new Error(`Not saved: ${String(error)}`))
      throw error
    } finally {
      this.saving = false
      this.publish()
    }
  }

  /** Drains owned runtime and source acquisitions before closing only reader-owned tabs/panels. @example await workspace.close() */
  async close(): Promise<void> {
    if (this.closingPromise) return this.closingPromise
    this.closing = true
    this.revision++
    this.lifetime++
    this.pendingHistory = undefined
    this.lastRendered = undefined
    this.presentationTransition?.cancellation.abort(
      new Error('Presentation reader closed.'),
    )
    this.presentationId = randomUUID()
    this.presentationControlRevision = 0
    this.presentationConfirmed = false
    this.requestedPresentation = undefined
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
      await this.refreshing
      const record = this.currentRecord()
      if (record && this.service && !record.stopped) {
        await this.service.stop({
          instanceId: this.service.instanceId,
          runId: record.id,
        })
        await this.checkpoint(this.service, record, true)
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
      // A storage write that never returns must not keep the reader closing: each wait below is bounded, and the write itself keeps running.
      await settledWithin(
        this.playback?.saved(),
        READER_CLOSE_STORAGE_TIMEOUT_MS,
      )
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
        READER_CLOSE_STORAGE_TIMEOUT_MS,
      )
      await settledWithin(
        this.library?.flush(),
        READER_CLOSE_STORAGE_TIMEOUT_MS,
      )
      const tabs = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter((tab) => this.ownsCapturedSourceTab(tab))
      if (tabs.length && !(await vscode.window.tabGroups.close(tabs, true)))
        throw new Error('Some captured source readers could not close.')
      this.opened = false
      this.contextPanel?.dispose()
      this.contextPanel = undefined
      this.app?.dispose()
      this.app = undefined
      this.initialAppPlacement = undefined
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
      this.lastSelectionKey = undefined
      this.documents.clear()
      this.readPresentationPreference()
    })())
    try {
      await pending
    } finally {
      if (this.closingPromise === pending) {
        this.closingPromise = undefined
        this.closing = false
      }
    }
  }

  /** Releases observers after extension shutdown has retired its service; read-only harnesses inspect state via {@link inspect}. @example await workspace.dispose() */
  async dispose(): Promise<void> {
    this.disposed = true
    clearInterval(this.timer)
    await this.close()
    await this.playback?.dispose()
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
      this.library = new LearningLibrary(
        join(this.context.globalStorageUri.fsPath, 'learning', key),
        key,
        capacity,
      )
      this.recordings = new RecordingStore(
        this.library.directory,
        key,
        {},
        undefined,
        capacity,
      )
      this.nodeHistoryStore = new NodeTestHistoryStore(
        this.library.directory,
        key,
        () => this.library!.storageLimit(),
        async () => (await this.library!.list()).length,
      )
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
          this.replayDebugger?.invalidate()
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
          // A reload of the displayed recording keeps its frame until the reloaded moment paints.
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
        save: (bundle) =>
          // A position save that was still queued must not write the playback file of a study that went to the Trash.
          this.isRemovedStudy(bundle.studyId) ||
          this.movingStudyId() === bundle.studyId
            ? Promise.resolve()
            : this.recordings!.savePreference({
                version: 1,
                workspaceKey: key,
                studyId: bundle.studyId,
                contextHash: bundle.contextHash,
                positionMs: bundle.projection.positionMs,
              }),
      })
      // Current files may disappear while immutable saved observations remain independently readable.
      await this.readBaselines().catch(() => undefined)
      try {
        this.progress = await this.library.readProgress()
        this.repositoryOrigin = this.progress.repositoryReturn
        if (this.progress.selection)
          this.selection = { ...this.progress.selection, follow: false }
      } catch (error) {
        this.report('progress', error)
      }
      try {
        this.catalog = await this.library.list()
        const id = this.selection.studyId ?? this.catalog[0]?.id
        if (id) {
          this.selectedArchive = await this.readSavedArchive(id)
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
        !this.presentationTransition
      )
        await this.renderSelection(true, false, signal)
    })()
    this.refreshing = attempt
    try {
      await attempt
    } finally {
      if (this.refreshing === attempt) this.refreshing = undefined
    }
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

  /** Saves material state only; forced retirement explicitly captures the state after the final observer tick. @example await this.checkpoint(service, record, true) */
  private async checkpoint(
    service: StudyService,
    record: StudyRecord,
    force = false,
  ): Promise<void> {
    const id = `${service.instanceId}_${record.id}`
    // Retirement must not lose the final state of a study whose removal then moves nothing, so a forced checkpoint waits for the move.
    if (force && this.movingStudyId() === id) await this.studyMove
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
      if (this.movingStudyId() === id) await this.studyMove
      if (this.discardsCapture(id, record)) return
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
      if (this.movingStudyId() === id) await this.studyMove
      if (this.discardsCapture(id, record)) return
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
            if (current) this.errors.delete('archive')
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
      await this.checkpoint(service, record, true)
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

  /** Keeps capture/save reachable beside native chat; publish updates it without changing editor focus. @example this.publishLearningSave() */
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
    item.command =
      saved?.status === 'saving'
        ? undefined
        : {
            title:
              saved?.status === 'saved' || saved?.status === 'partial'
                ? 'Open learning replay'
                : 'Save learning replay',
            command:
              saved?.status === 'saved' || saved?.status === 'partial'
                ? 'codebook.openLearningReplay'
                : 'codebook.saveLearningReplay',
            arguments: [studyId],
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

  /** Whether the replay reader's panes exist, for {@link PlaybackController}'s reload and control guards: open and not closing. @example this.replayReaderOpen */
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
    if (this.replayViewport && !this.replayNeedsReveal) return
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
          if (String(error) !== `Error: ${VIEWPORT_ACK_TIMEOUT_REASON}`)
            throw error
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
              String(retryError) === `Error: ${VIEWPORT_ACK_TIMEOUT_REASON}`
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
      this.errors.delete('progress')
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
      loading:
        this.loading ||
        Boolean(playbackState?.cleared && !this.playbackPresentingReady),
      errors: [
        ...this.errors.values(),
        ...this.catalog.flatMap((entry) =>
          entry.reason ? [entry.reason] : [],
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
      runRefusal:
        record?.historyExcluded === 'refused-at-admission' &&
        record.error &&
        record.id !== this.answeredRunRefusalId
          ? `The last run did not start: ${record.error.message}`
          : undefined,
      unstoppedStudyId: this.unstoppedStudyId(),
    }
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

  /** Serializes source opens and invalidates obsolete selection work before it can qualify context/app correspondence. @example await this.renderSelection() */
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
        const filename = declaredSourcePosition
          ? basename(declaredSourcePosition.path)
          : `${itemId.split('/').at(-1)}.mts`
        // Pre-observation placeholders are transient; retaining them would pull replay back to an obsolete source pane.
        const retainedSource = study?.descriptor?.sources.some(
          (captured) =>
            captured.path === declaredSourcePosition?.path &&
            captured.hash === source.hash,
        )
        const uri = vscode.Uri.from({
          scheme: STUDY_SOURCE_SCHEME,
          authority: this.library!.workspaceKey,
          path: `/${message.model.observation || retainedSource ? study!.id : 'source-derived'}/${encodeURIComponent(itemId)}/${source.hash}/Captured-${filename}`,
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
        const editor = await vscode.window.showTextDocument(document, {
          viewColumn: targetColumn,
          preserveFocus,
          preview: false,
          selection: new vscode.Range(position, position),
        })
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
        // Replace transient source-derived revisions and an earlier capture of the same file (another run or study), so each source keeps one captured tab.
        if (
          previousUri &&
          previousUri.toString() !== uri.toString() &&
          (previousUri.path.startsWith('/source-derived/') ||
            basename(previousUri.path) === basename(uri.path))
        ) {
          const obsolete = vscode.window.tabGroups.all
            .flatMap((group) => group.tabs)
            .filter(
              (tab) =>
                tab.input instanceof vscode.TabInputText &&
                tab.input.uri.toString() === previousUri.toString(),
            )
          if (
            obsolete.length &&
            !(await vscode.window.tabGroups.close(obsolete, true))
          )
            throw new Error('Obsolete source-derived reader could not close.')
          signal?.throwIfAborted()
          this.documents.delete(previousUri.toString())
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
        this.errors.delete('reader')
        this.publish()
      })
    this.rendering = pending.catch((error) => {
      if (
        revision !== this.revision ||
        this.closing ||
        this.pendingHistory !== undefined
      )
        return
      if (signal?.aborted) {
        this.lastSelectionKey = undefined
        this.loading = false
        return
      }
      this.report('reader', error)
    })
    return this.rendering
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

  /** Updates the app only when selected phase bytes/mode change, preserving a historical panel across live ticks. @example this.presentApplication(message) */
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
      tab.input instanceof vscode.TabInputWebview &&
      isCodebookPaneViewType(tab.input.viewType, 'codebook.scopedBrowser')
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
    /** Records a newer tab choice during app registration so {@link open} cannot claim a focus roundtrip. @example noticeLearnerTab() */
    const noticeLearnerTab = (): void => {
      const selected = vscode.window.tabGroups.activeTabGroup.activeTab
      // Codebook may select its new Application; another retained tab is a learner decision even after a roundtrip.
      if (
        selected &&
        selected !== focusedTab &&
        !owned(selected) &&
        (!focusedTab ||
          vscode.window.tabGroups.all.some((group) =>
            group.tabs.includes(focusedTab),
          ))
      )
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
          const sameFocus =
            active.viewColumn === focusedColumn &&
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
                  currentSource === undefined))
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
            (active !== appGroup || !vscode.window.activeTextEditor),
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
    panel.onDidDispose(() => {
      if (this.app !== panel) return
      this.presentationTransition?.cancellation.abort(
        new Error('The current application pane was closed.'),
      )
      this.app = undefined
      // A renderer created for the next pane performs its own first reveal, so a reveal owed to this pane is dropped with it.
      this.dropReplayViewport()
      if (this.recordingActive) this.playback?.hide()
    })
    let visible = panel.visible
    panel.onDidChangeViewState(() => {
      if (this.app !== panel) return
      this.confirmInitialAppRegistration()
      if (panel.active) this.lastActiveRegion = 'app'
      if (visible === panel.visible) return
      visible = panel.visible
      // Only visibility of the replay surface pauses playback; runtime/debugger exit is unrelated.
      if (this.recordingActive && !this.placingPresentation) {
        this.replayNeedsReveal = true
        if (visible) this.playback?.reveal()
        else this.playback?.hide()
      }
    })
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
    const panel = vscode.window.createWebviewPanel(
      'codebook.studyContext',
      title,
      {
        viewColumn: STUDY_PRESENTATIONS[this.presentationMode].contextColumn,
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

  /** Binds a fresh explanation document for cold entry or handoff without accepting retired controls or receipts. @example this.bindContextPanel(replacement) */
  private bindContextPanel(panel: vscode.WebviewPanel): void {
    this.contextPanel = panel
    this.lastPublished = undefined
    this.lastRendered = undefined
    panel.onDidDispose(() => {
      if (this.contextPanel !== panel) return
      this.presentationTransition?.cancellation.abort(
        new Error('The current explanation pane was closed.'),
      )
      this.contextPanel = undefined
    })
    panel.onDidChangeViewState(() => {
      if (this.contextPanel === panel && panel.active) {
        this.lastActiveRegion = 'context'
        void this.refreshProgress().then(() => {
          if (this.contextPanel === panel) this.publish()
        })
      }
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
      this.offerSummaryPlacement()
    } finally {
      focusSubscription.dispose()
    }
  }

  /**
   * Offers Cursor's learner the editor's own Move View step once per workspace, after {@link showLearningSummary} showed the summary.
   *
   * Cursor rejects the `secondarySidebar` container this extension contributes, so the summary lands in the primary side bar
   * there, and its own chat containers refuse added views: no command of this extension can place the summary on the right.
   * VS Code registers the container, so nothing is offered there.
   *
   * @example this.offerSummaryPlacement()
   */
  private offerSummaryPlacement(): void {
    if (!vscode.env?.appName?.toLowerCase().includes('cursor')) return
    if (this.context.workspaceState.get<boolean>(SUMMARY_PLACEMENT_OFFER_KEY))
      return
    void (async (): Promise<void> => {
      await this.context.workspaceState.update(
        SUMMARY_PLACEMENT_OFFER_KEY,
        true,
      )
      const choice = await vscode.window.showInformationMessage(
        SUMMARY_PLACEMENT_OFFER,
        SUMMARY_PLACEMENT_ACTION,
      )
      // The editor's Move View list opens for the summary itself; the learner picks its destination there.
      if (choice === SUMMARY_PLACEMENT_ACTION)
        await vscode.commands.executeCommand(
          'workbench.action.moveFocusedView',
          'codebook.learningSummary',
        )
    })().catch((error: unknown) => this.report('layout', error))
  }

  /** Withdraws replay controls on explicit departure or close while leaving the native sidebar and other chat containers intact. @example this.clearLearningSummary() */
  private clearLearningSummary(): void {
    this.summaryDocumentActive = false
    this.lastRendered = undefined
    if (this.summaryView)
      this.summaryView.webview.html =
        '<!DOCTYPE html><html><body><p>Open saved learning from Codebook to view its summary.</p></body></html>'
  }

  /** Registers native readers once, keeping checkbox persistence under explicit learner control. @example this.installReaders() */
  private installReaders(): void {
    if (this.outline) return
    this.observeEditorGroups()
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabGroups((event) =>
        this.observeEditorGroups(event),
      ),
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
                this.lastRendered = undefined
              }
            })
            view.onDidChangeVisibility(() => {
              // Collapsing the summary never moves the playhead or borrows a live debugger.
              if (this.summaryView === view && view.visible) {
                this.lastPublished = undefined
                this.publish()
              }
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
          !this.opened ||
          !editor ||
          !this.runtimeSourcePaths.has(editor.document.uri.fsPath) ||
          this.restoringSource ||
          this.presentationTransition ||
          !this.sourceUri
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
      let didLearnerChangePrimaryTab = false
      // Empty/opaque primary panes need the actual requested citation, never a disposable placeholder or unobserved command result.
      beforeScopeFocus?.(
        useCitation
          ? undefined
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
      if (useCitation) {
        assertAcquiredFocus = await acquireSourceFocus!()
        assertCurrent()
        assertGroups()
        assertAcquiredFocus()
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
          return firstFocused()
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
              !(
                tab.input instanceof vscode.TabInputWebview &&
                isCodebookPaneViewType(tab.input.viewType)
              ) &&
              !(
                tab.input instanceof vscode.TabInputText &&
                tab.input.uri.scheme === STUDY_SOURCE_SCHEME
              ),
          )
        // Only the expired wait is renamed; a learner focus change keeps its own refusal.
        if (didLearnerChangePrimaryTab || !foreignPreview) throw error
        throw new StudyError(
          'PRESENTATION_UNAVAILABLE',
          foreignPreviewObstacle(
            this.editorTabName(foreignPreview.tab),
            foreignPreview.group.viewColumn,
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
      const saved = this.repositoryLayoutOrigin,
        receipt = this.layoutReceipt
      if (
        !saved ||
        JSON.stringify(saved.origin) !==
          JSON.stringify(this.repositoryOrigin) ||
        JSON.stringify(saved.origin.selection) !== JSON.stringify(selection) ||
        !receipt ||
        receipt.mode === 'repository'
      )
        return
      // Already-observed learner group changes release ownership before any scope command can borrow focus.
      if (!this.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all)) {
        this.layoutReceipt = undefined
        return
      }
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
        saved !== this.repositoryLayoutOrigin ||
        receipt !== this.layoutReceipt ||
        JSON.stringify(layout) !== receipt.signature ||
        !this.sameEditorGroups(receipt.groups, groups) ||
        !this.sameEditorGroups(saved.groups, retained) ||
        !this.sameStudyPanePositions(
          receipt.panes,
          receipt.sourceTargetColumn,
        ) ||
        !ownsExtraTabs ||
        !saved.preservesOtherParts(grid.groups.length)
      ) {
        this.layoutReceipt = undefined
        return
      }
      // A cancelled reservation has not moved Context yet; retain its previously verified Study destination for the next visit.
      const before = receipt.pendingPanes ?? this.studyPanePositions()
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
      // Native minimum sizes can expand the editor area; certify the saved split proportions, then retain exact returned pixels.
      if (
        !isProportionalEditorLayout(saved.layout, restoredLayout) ||
        !this.sameEditorGroups(
          saved.groups,
          vscode.window.tabGroups.all.filter((group) =>
            saved.groups.some((entry) => entry.column === group.viewColumn),
          ),
        ) ||
        !saved.preservesOtherParts(saved.groups.length) ||
        !this.sameStudyPanePositions(after)
      ) {
        this.report(
          'layout',
          new Error(
            'The editor could not restore the saved reading layout. Arrange the reading panes manually.',
          ),
        )
        assertCurrent()
        return
      }
      this.repositoryLayoutRestored = {
        signature: JSON.stringify(restoredLayout),
        studyLayout: layout,
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
      assertCurrent()
    })
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
      let grid = await this.readMainEditorGrid(
        signal,
        assertCurrent,
        focus?.acquireSourceFocus,
        beforeScopeFocus,
      )
      // The editor closes a disposed pane's tab a moment after dispose(); a grid it measured before that still counts the retired Study group as occupied.
      if (retiredContextGroup && this.hasRetiredStudyPaneTab()) {
        await this.retiredStudyPaneClosed(signal)
        assertCurrent()
        grid = await this.readMainEditorGrid(
          signal,
          assertCurrent,
          focus?.acquireSourceFocus,
          beforeScopeFocus,
        )
      }
      const groupCount = this.studyGroupCount()
      // Only the just-retired, now-empty owned summary group can disappear during live entry.
      const canRetireContext =
        (this.liveComposition || this.summaryComposition) &&
        retiredContextGroup !== undefined &&
        grid.groups.length === groupCount + 1 &&
        grid.groups.at(-1) === retiredContextGroup &&
        retiredContextGroup.tabs.length === 0
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
        ? grid.groups.filter((group) => group !== retiredContextGroup)
        : grid.groups
      const measuredLayout =
        mode === 'study' && retainedGroups.length === groupCount
          ? grid.layout
          : undefined
      assertCurrent()
      grid.assertUnchanged()
      const requestedLayout = this.studyLayout()
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
      // Drain the accepted batch after navigation abort, then let only a newer intent change the layout again.
      const receipt = await this.rememberLayout(mode, lifetime, retainedGroups)
      assertCurrent()
      // runCommands reports child failures through host notifications, so only the actual layout can certify success.
      if (
        !receipt ||
        !grid.preservesOtherParts(
          mode === 'study' ? groupCount : grid.groups.length,
        )
      ) {
        this.layoutReceipt = undefined
        // The receipt read's own failure (a changed group, a grid that never settled) is the cause; keep it readable instead of replacing it.
        this.report(
          'layout',
          new Error(
            `The editor did not retain the requested Codebook layout. Use the focus commands or arrange the Codebook panes manually.${this.layoutReceiptFailure ? ` Cause: ${this.layoutReceiptFailure}` : ''}`,
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
    return (
      !this.contextPanel &&
      vscode.window.tabGroups.all.some((group) =>
        group.tabs.some(
          (tab) =>
            tab.input instanceof vscode.TabInputWebview &&
            isCodebookPaneViewType(
              tab.input.viewType,
              'codebook.studyContext',
            ) &&
            !this.inheritedPaneTabs.has(tab),
        ),
      )
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

  /** Retains actual accepted layout effects for newer navigation while {@link close} invalidates the owner. @example await this.rememberLayout('study', lifetime, groups) */
  private async rememberLayout(
    mode: 'study' | 'repository',
    lifetime: number,
    retainedGroups: readonly vscode.TabGroup[],
  ): Promise<StudyWorkspace['layoutReceipt']> {
    this.assertLifetime(lifetime)
    this.layoutReceiptFailure = undefined
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
                this.retainsEditorTabs(entry.group, group) ||
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
    for (const group of current) {
      if (event?.opened.includes(group)) {
        this.editorGroupIdentities.set(group, Symbol())
        continue
      }
      if (this.editorGroupIdentities.has(group)) continue
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

  /** Recognizes surviving tab order during wrapper replacement, allowing additions from group contraction but rejecting ambiguous inputs. @example this.retainsEditorTabs(before, after) */
  private retainsEditorTabs(
    before: vscode.TabGroup,
    after: vscode.TabGroup,
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
    const foreignKey = (tab: vscode.Tab) => {
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
    const key = (tab: vscode.Tab) => knownKey(tab) ?? foreignKey(tab)
    const previous = before.tabs.map(key),
      current = after.tabs.map(key)
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
          before.tabs.every((tab) => key(tab) !== value || !tab.isPreview) &&
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
  ): 'replay-control' | 'node-history-control' | 'control' {
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
      // A control refused while this message was being handled is newer than this message and stays.
      if (this.controlRefusals === refusalsBefore)
        this.retireControlRefusal(value)
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

  /** Retires the line of an earlier refused pane control once a later choice of an entry, a tab or an item was handled without an error, so a refusal does not stay through later runs; called by {@link receivePaneMessage}. @example this.retireControlRefusal({ type: 'history', revision: 4, studyId }) */
  private retireControlRefusal(value: unknown): void {
    const parsed = messageSchema.safeParse(value)
    if (
      !parsed.success ||
      !CONTROL_RETIRING_MESSAGE_TYPES.has(parsed.data.type)
    )
      return
    // A Node test history's refusal has its own line (it is not a live-run control) and is as stale after the next handled choice.
    let isRetired = false
    for (const kind of CHOICE_RETIRED_ERROR_KINDS)
      isRetired = this.errors.delete(kind) || isRetired
    if (isRetired) this.publish()
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
      await this.removeSavedStudy(message.studyId)
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
   * @returns The refusal sentence, first match wins: another entry that is still opening, a Node test history, an entry no catalog lists, the study of a run that has not stopped, a Recording that is open or opening. `undefined` when the study can be removed.
   * @example this.studyRemovalRefusal(nodeHistoryId) // => 'Node test histories cannot be deleted here yet.'
   */
  private studyRemovalRefusal(studyId: string): string | undefined {
    const refusals: [applies: boolean, sentence: string][] = [
      // The pane may still show the entry before the one the learner chose; a delete names what is shown once it has opened.
      [this.studyOpening(), STUDY_REMOVAL_REFUSALS.studyOpening],
      [
        this.nodeHistoryCatalog.some((history) => history.studyId === studyId),
        STUDY_REMOVAL_REFUSALS.nodeHistory,
      ],
      [
        !this.catalog.some((entry) => entry.id === studyId),
        STUDY_REMOVAL_REFUSALS.unavailable,
      ],
      [
        this.unstoppedStudyId() === studyId,
        STUDY_REMOVAL_REFUSALS.runNotStopped,
      ],
      [this.recordingOpenOrOpening(), STUDY_REMOVAL_REFUSALS.recordingOpen],
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

  /** Publishes a removal's outcome and remembers the run it ended under, so a later run retires the line. @example this.settleStudyRemoval({ status: 'refused', studyId, text }) */
  private settleStudyRemoval(outcome: StudyRemovalView): void {
    this.studyRemoval = outcome
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
   * Asks the learner in a native dialog whether the named study moves to the system Trash; while the dialog is open the removal is `confirming`.
   * Cancel, Escape and a dialog the host could not show all leave the study and the status line untouched.
   * @param entry - The catalog entry the dialog names.
   * @returns Whether the learner pressed the confirming button.
   * @example if (!(await this.askStudyRemoval(entry))) return
   */
  private async askStudyRemoval(entry: StudyCatalogEntry): Promise<boolean> {
    const messages = studyRemovalMessages()
    this.studyRemoval = { status: 'confirming', studyId: entry.id }
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
    const entry = this.catalog.find((candidate) => candidate.id === studyId)
    if (!entry || !(await this.askStudyRemoval(entry))) return false
    return !this.refuseStudyRemoval(studyId)
  }

  /**
   * Removes one saved study on the learner's request from the Saved studies section: confirms in a native dialog, holds off this window's writers of that study, moves its files to the system Trash through {@link LearningLibrary.removeStudy} and reports the outcome in the message's `studyRemoval` field.
   * Every expected outcome (a refusal, Cancel, a Trash that refuses) ends in that field; nothing is written to the reader's error lines.
   * @param studyId - The entry the learner chose.
   * @example await this.removeSavedStudy(message.studyId)
   */
  private async removeSavedStudy(studyId: string): Promise<void> {
    // One removal at a time: a second request while the dialog is open or files are moving opens no second dialog.
    if (this.studyRemovalInProgress()) return
    if (!(await this.studyRemovalConfirmed(studyId))) return
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
    this.studyRemoval = {
      status: 'moving',
      studyId,
      text: studyRemovalMessages().moving,
    }
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
    await this.forgetRemovedStudy(studyId)
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
   * Hands a confirmed study to {@link LearningLibrary.removeStudy} with the editor's Trash as the mover; called by {@link moveSavedStudy}.
   * For a run of this window the removal runs inside {@link StudyService.withEvidenceHeld}, so no explanation is written into the evidence directory while it moves.
   * @param studyId - The confirmed entry.
   * @param evidenceDirectory - The run's raw evidence when it moves with the study.
   * @returns What the removal changed on disk.
   * @example await this.moveStudyFiles(studyId, evidenceDirectory) // => { outcome: 'moved' }
   */
  private moveStudyFiles(
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
          ).then(
            () => this.rememberTrashWorks(true),
            (error: unknown) => {
              this.rememberTrashWorks(false)
              throw error
            },
          ),
        evidenceDirectory,
      )
    const service = this.service,
      record = this.recordOfStudy(studyId)
    return service && record
      ? service.withEvidenceHeld(record, remove)
      : remove()
  }

  /** Tells the service whether this editor's Trash took the last path a removal gave it, so a full-library refusal names a removal only while one can work here. @example this.rememberTrashWorks(false) */
  private rememberTrashWorks(works: boolean): void {
    if (this.service) this.service.isStudyRemovalAvailable = works
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

  /** Excludes this window's run of a removed study from history, so the service stops reporting saved material for it and stops serving its evidence. @example this.excludeRemovedRun(studyId) */
  private excludeRemovedRun(studyId: string): void {
    const record = this.recordOfStudy(studyId)
    if (record) this.service?.excludeHistory(record)
  }

  /** Makes this window forget a study of which something went to the Trash: it is never written again, its run is excluded from history, and the list is read again. @example await this.forgetRemovedStudy(studyId) */
  private async forgetRemovedStudy(studyId: string): Promise<void> {
    this.removedStudyIds.add(studyId)
    this.excludeRemovedRun(studyId)
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
    const answeredRun =
      libraryHasRoom(usage) && !isLockLeft
        ? this.refusedRunAwaitingRoom()
        : undefined
    if (answeredRun) this.answeredRunRefusalId = answeredRun.id
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
   * Shows the nearest remaining saved study after the shown one was removed, or no study when none can be opened; called by {@link showAfterRemoval} when nothing was chosen during the removal.
   * A study the learner chooses while the neighbour is read wins and never finds the removed study still selected. A reader that is closing, or has closed, renders nothing and remembers the neighbour.
   * @param studyId - The study that was moved.
   * @param neighbours - The candidates from {@link removalNeighbours}, nearest first.
   * @example await this.showRemovalNeighbour(removedStudyId, [olderStudyId])
   */
  private async showRemovalNeighbour(
    studyId: string,
    neighbours: string[],
  ): Promise<void> {
    // The number retires older reads; only an entry the learner chooses while the neighbour is read overtakes it.
    this.historyRequest++
    const choiceGeneration = this.studyChoices
    const shown = await this.firstReadableStudy(neighbours)
    if (this.studyChoices !== choiceGeneration) {
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
    // A live or summary composition is arranged for what it showed; a saved study needs the reader's own arrangement.
    if (this.needsReaderArrangement()) await this.open()
    // The reason an earlier study could not be arranged or read does not outlive the study that is shown now.
    this.errors.delete('reading')
    await render()
    await this.saveSelection()
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

  /** Keeps storage, control and renderer failures distinct in the learner-facing status. @example this.report('archive', error) */
  private report(kind: string, error: unknown): void {
    if (CHOICE_RETIRED_ERROR_KINDS.has(kind)) this.controlRefusals++
    this.errors.set(kind, String(error))
    if (kind === 'presentation') this.clearReadyReplayWarning()
    this.publish()
  }
}

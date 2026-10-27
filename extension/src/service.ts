import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { CONFIGURED_PROFILE } from './configuredProfile'
import type {
  ConfiguredDefinition,
  ConfiguredFactValue,
  ConfiguredDescriptor,
} from './configuredStudySchemas'
import {
  BOOK_INPUT_LIMIT_BYTES,
  BOOK_MAX_FILES,
  BOOK_MAX_SOURCES,
  EVENT_DETAIL_LIMIT_BYTES,
  EVENT_TYPE_LIMIT_CHARS,
  HTTP_BODY_LIMIT_BYTES,
  INVALID_SAVED_STUDY_LIMIT_MESSAGE,
  MAX_EVENTS,
  MAX_RETAINED_EVENT_BYTES,
  REPOSITORY_SOURCE_LIMIT_BYTES,
  ACTIVE_TIMEOUT_MS,
  API_VERSION,
  CONTINUE_ANSWER_CALL_BUDGET_MS,
  CONTINUE_ANSWER_GRACE_MS,
  MAINTENANCE_INTERVAL_MS,
  MAX_EXPLANATIONS,
  MAX_RUNS,
  MAX_UI_TEXT_CHARS,
  NODE_SERVER_ACTION,
  NODE_SERVER_PROFILE,
  NODE_SERVER_STATE_CHANGING_METHODS,
  NODE_TEST_MINIMUM_EXTENSION_VERSION,
  NODE_TEST_PROFILE,
  RECORDING_REASON_LIMIT_CHARS,
  REPOSITORY_BROWSER_ACTION,
  REPOSITORY_BROWSER_PROFILE,
  REPOSITORY_CONFIG_LIMIT_BYTES,
  REPOSITORY_INSPECTION_LIMIT,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
  REPOSITORY_RUN_TIMEOUT_MS,
  REPOSITORY_SETUP_TIMEOUT_MS,
  RETIRED_PRESENTATION_REFUSAL,
  SEAL_RETRY_DELAY_MS,
  SELECTABLE_PRESENTATION_MODE,
  PRESENTATION_MODE_IDS,
  STUDY_PRESENTATIONS,
  TRANSIENT_SEAL_ERROR_CODES,
} from './constants'
import {
  NodeLearningRevisionChangedError,
  SavedStudyStorageFullError,
  StudyError,
  domainError,
} from './errors'
import {
  learningSummarySchema,
  type LearningSummary,
} from './learningSummarySchemas'
import {
  nodeServerConfigSchema,
  type NodeServerConfiguration,
} from './nodeServerConfigSchemas'
import { describeNodeServerProfile } from './nodeServerProfile'
import type { NodeTestConfiguration } from './nodeTestConfigSchemas'
import type { NodeTestLearningMaterialContent } from './nodeTestHistorySchemas'
import type {
  NodeTestHistoryStore,
  NodeTestHistoryWriter,
} from './nodeTestHistoryStore'
import type { NodeTestSourceStop } from './ownedNodeTestRun'
import type { PlaybackController } from './playbackController'
import type { PlaybackCommand } from './playbackSchemas'
import type {
  PresentationCommand,
  ReturnCurrentCommand,
} from './presentationSchemas'
import type { RecordingSeal } from './recordingSchemas'
import type { RecordingStore, RecordingWriter } from './recordingStore'
import type { RepositoryBookStore } from './repositoryBook'
import type {
  SourceListInput,
  SourceReadInput,
  PublishBookInput,
  OpenBookInput,
} from './repositorySchemas'
import type { RetainedStudy } from './retainedStudySchemas'
import type {
  NodeServerRuntime,
  NodeTestRuntime,
  RuntimeSnapshot,
  RuntimeView,
  StudyEnvironment,
  StudyRuntime,
} from './runtime'
import type { RecordedEvent } from './runtimeSupport/evidence'
import { sha256 } from './runtimeSupport/utils/sha256'
import {
  explainNodeHistorySchema,
  explainSchema,
  startIntentSchema,
  type StartIntent,
  type ActionInput,
  type ContinueInput,
  type ExplainInput,
  type ExplainNodeHistoryInput,
  type RevealInput,
  type RunInput,
  type StartInput,
} from './schemas'
import type { StudyWorkspace } from './studyWorkspace'
import { buildRecordingContext } from './utils/buildRecordingContext'
import { causeRootsFor } from './utils/causeRootsFor'
import { configuredStops } from './utils/configuredStops'
import { createNodeServerJournal } from './utils/createNodeServerJournal'
import { cutCauseForDisplay } from './utils/cutCauseForDisplay'
import { cutTextToFit } from './utils/cutTextToFit'
import { declaredStopOfSnapshot } from './utils/declaredStopOfSnapshot'
import { describeBoundPlace, type BoundPlace } from './utils/describeBoundPlace'
import { describeMissingBookNode } from './utils/describeMissingBookNode'
import { describeNodeServerConfigurationIssues } from './utils/describeNodeServerConfigurationIssues'
import {
  describeNodeServerFailureLine,
  describeNodeServerOutputLine,
  type NodeServerOutputLine,
} from './utils/describeNodeServerOutputLine'
import { describeNodeTestResult } from './utils/describeNodeTestResult'
import {
  explanationPlace,
  type ExplanationPlace,
} from './utils/explanationPlace'
import type { CodebookDiagnostic } from './utils/formatCodebookDiagnostic'
import {
  fullLibraryMessage,
  type StudyRemovalAvailability,
} from './utils/fullLibraryMessage'
import { historyExclusionReason } from './utils/historyExclusionReason'
import { historyExclusionState } from './utils/historyExclusionState'
import { initialStudyRemovalAvailability } from './utils/initialStudyRemovalAvailability'
import { isPausedAtSnapshot } from './utils/isPausedAtSnapshot'
import { isStudyRemovalExclusion } from './utils/isStudyRemovalExclusion'
import { journaledBindingOfSnapshot } from './utils/journaledBindingOfSnapshot'
import type { NodeTestOutputEvent } from './utils/launchNodeTest'
import {
  listMissingNodeExplanations,
  type NodeLearningCoverage,
  type NodeLearningExplanationPart,
  type NodeLearningNeeds,
} from './utils/listMissingNodeExplanations'
import type { NodeLearningCapturePart } from './utils/listMissingNodeLearning'
import type { RetryVitestListingRelease } from './utils/listVitestTestFiles'
import { namesLineNumber } from './utils/namesLineNumber'
import { nextNodeServerState } from './utils/nextNodeServerState'
import { nodeTestResultKind } from './utils/nodeTestResultKind'
import { numberSourceLines } from './utils/numberSourceLines'
import type { NodeTestExecutionPlan } from './utils/planNodeTestExecution'
import { prepareNodeServerStudy } from './utils/prepareNodeServerStudy'
import { prepareNodeTestStudy } from './utils/prepareNodeTestStudy'
import { prepareRepositoryStudy } from './utils/prepareRepositoryStudy'
import { projectNodeServerState } from './utils/projectNodeServerState'
import {
  projectNodeTestOutcome,
  type NodeTestHistoryState,
} from './utils/projectNodeTestOutcome'
import { readerNotFollowingRunRefusal } from './utils/readerNotFollowingRunRefusal'
import { releaseVitestListings } from './utils/releaseVitestListings'
import { resolveCapturedFactPaths } from './utils/resolveCapturedFactPaths'
import { sanitizeCause, type CauseRoots } from './utils/sanitizeCause'
import { sanitizedStack } from './utils/sanitizedStack'
import { snapshotSourceHashes } from './utils/snapshotSourceHashes'
import { studyErrorNamingCause } from './utils/studyErrorNamingCause'
import { systemErrorCode } from './utils/systemErrorCode'
import { thrownMessage } from './utils/thrownMessage'
import { vitestSearchField } from './utils/vitestSearchField'
import { waitForNextRunState } from './utils/waitForNextRunState'
import { withKnownNodeHistory } from './utils/withKnownNodeHistory'

/** What the run resource tells an agent after the result while no explanation of the run carries a learning summary; `codebook://help/studies` describes the step in the last entry of its sequence. */
const SAVE_LEARNING_SUMMARY_ADVICE =
  "No learning summary is saved for this run yet, so its saved study would have no summary and no sequence. Save one now: call codebook_explain on a committed snapshot of this run with a new key and a complete learningSummary whose final step is observed and cites this resource's terminalReference. The last step of the sequence in codebook://help/studies describes it."

/** What the run resource tells an agent in place of {@link SAVE_LEARNING_SUMMARY_ADVICE} once the run's explanation keys are spent, because {@link StudyService.explain} refuses every new key then; the refusal of a new key begins with the same budget statement. */
const EXPLANATION_BUDGET_SPENT_ADVICE = `The run's explanation budget (${MAX_EXPLANATIONS} keys) is spent; the saved study will have no learning summary.`

/**
 * Words why a stopped run whose evidence failed takes no further explanation, for the run resource in place of {@link SAVE_LEARNING_SUMMARY_ADVICE} and for {@link StudyService.explain}'s refusal of a new key: the evidence keeps its first failure, so every later write of it fails, also once the disk has room again.
 * @param failure - The evidence's failure ({@link Evidence.failure}), which names the failed write.
 * @returns The sentence that names the failed write, that no key is spent, and what holds of the run.
 * @example
 * failedEvidenceAdvice('Error: ENOSPC: no space left on device, write')
 * // => "No explanation or learning summary can be saved for this run: a write of its evidence failed (Error: ENOSPC: no space left on device, write), …"
 */
function failedEvidenceAdvice(failure: string): string {
  return `No explanation or learning summary can be saved for this run: a write of its evidence failed (${failure}), and every later write of that evidence fails too, also once the cause is fixed. Codebook refuses a new explanation key for this run without spending it. What the run recorded until then holds: its result, its snapshots and the explanations saved before the failure; its saved study will have no learning summary. A new run can save one.`
}

/**
 * Chooses what the run resource says under `saveLearningSummary`, for {@link StudyService.state} each time the resource is read.
 * @param lacksLearningSummary - Whether the released run reached its demonstrated result and no saved explanation carries a learning summary.
 * @param explanationBudgetSpent - Whether {@link StudyService.explain} accepts no new key for the run.
 * @param isSavingLearningSummary - Whether an accepted key's explanation that carries a learning summary is still being saved. The budget counts a key when it is reserved, so the last key can be spent while its summary is on its way.
 * @param evidenceFailure - The failure of the stopped run's evidence, which refuses every further explanation ({@link StudyService.stoppedRunEvidenceFailure}); `undefined` while its evidence writes.
 * @returns
 * - `undefined` for a run that lacks no learning summary
 * - {@link failedEvidenceAdvice} for a stopped run whose evidence failed: explain refuses a new key, so the step is not offered
 * - {@link SAVE_LEARNING_SUMMARY_ADVICE} while explain still accepts a new key
 * - `undefined` once it does not, while a learning summary is still being saved: whether the study gets one is not known yet
 * - {@link EXPLANATION_BUDGET_SPENT_ADVICE} once the budget is spent and no summary is on its way
 * @example
 * learningSummaryAdvice(true, false, false, undefined) // => SAVE_LEARNING_SUMMARY_ADVICE
 * learningSummaryAdvice(true, false, false, 'Error: ENOSPC: no space left on device, write') // => failedEvidenceAdvice of that failure
 * learningSummaryAdvice(true, true, true, undefined)   // => undefined
 * learningSummaryAdvice(false, true, false, undefined) // => undefined
 */
function learningSummaryAdvice(
  lacksLearningSummary: boolean,
  explanationBudgetSpent: boolean,
  isSavingLearningSummary: boolean,
  evidenceFailure: string | undefined,
): string | undefined {
  if (!lacksLearningSummary) return undefined
  // A new key would fail at the same failed evidence: the run's own advice replaces the step.
  if (evidenceFailure !== undefined)
    return failedEvidenceAdvice(evidenceFailure)
  if (!explanationBudgetSpent) return SAVE_LEARNING_SUMMARY_ADVICE
  return isSavingLearningSummary ? undefined : EXPLANATION_BUDGET_SPENT_ADVICE
}

/** What the run resource tells an agent beside a browser profile folder that the run's cleanup could not remove: the run is released, and nobody is asked to delete anything. */
const BROWSER_PROFILE_LEFT_ADVICE =
  'The run is released and its outcome is unchanged; only the folder of its own browser profile could not be removed. Do nothing: Codebook removes the folder at the start of a later run, after this editor window was closed or reloaded.'

export interface Explanation {
  id: string
  instanceId: string
  runId: string
  snapshotUri: string
  sourceHash: string
  capturedFacts: { path: string; value: ConfiguredFactValue }[]
  /** Codebook's own place of the stop, present when the debugger bound it on another line than declared; taken from the snapshot and the declared stop, never from {@link Explanation.agentInterpretation}. */
  boundPlace?: ExplanationPlace
  learningSummary?: LearningSummary
  agentInterpretation: string
  createdAt: string
  learnerUnderstandingChanged: false
}
/** What `codebook_explain` answers: where the committed explanation is read, and the captured keys it was saved under (a path sent without its prefix appears here with it). */
interface ExplanationReceipt {
  explanationUri: string
  valuePaths: string[]
}
/** What the service keeps of a node-server run beside the fields every run has. */
export interface NodeServerRecordState {
  run?: NodeServerRuntime
  /** The declaration with its hash and the pinned article node, once the preparation pinned the cited sources. */
  prepared?: {
    configuration: NodeServerConfiguration
    configurationHash: string
    descriptor: ConfiguredDescriptor
  }
  /** The key of the request that went to the server; another key is refused as `REQUEST_ALREADY_SENT`. */
  sentKey?: string
  /** The request being confirmed by the learner or handed to the run, so a repeat of its key joins it and another key waits for it. */
  pendingRequest?: {
    key: string
    signature: string
    result: Promise<NonNullable<StudyRecord['action']>['receipt']>
  }
  /** Stops listening to the run's changes once the run is released. */
  subscription?: { dispose(): void }
  /** The failures already written to the Output channel (by code), so one failure is written once. */
  loggedFailures: Set<string>
}
/** A node-server run's record with its server state, as the narrowing {@link isNodeServerRecord} gives. */
type NodeServerStudyRecord = StudyRecord & {
  profile: typeof NODE_SERVER_PROFILE
  nodeServer: NodeServerRecordState
}
export type StudyRecord = StudyRecordState &
  StartIntent & {
    definition?: ConfiguredDefinition
    nodePrepared?: {
      configuration: NodeTestConfiguration
      configurationHash: string
      descriptor: ConfiguredDescriptor
      /** The plan of the pre-history check ({@link StudyEnvironment.checkNodeTestFiles}), kept outside `configuration` so `configurationHash` stays the agent's; the manifest names its facts. */
      execution?: NodeTestExecutionPlan
    }
    nodeServer?: NodeServerRecordState
  }
/**
 * Why the reader must not checkpoint a retained run and why its state reports no saved history.
 * - `awaiting-admission`: the study library has not answered yet whether it can keep this run's study.
 * - `refused-at-admission`: the library was full or its limit setting invalid, so the run never started.
 * - `refused-at-preparation`: a node-test run whose preparation refused it before its history began (a changed source or test file, a path that is not a file, a missing prerequisite), so nothing was recorded and its slot and start key are free.
 * - `stopped-before-history`: a learner's stop (or a stop of the window) ended a node-test run before its history began, so nothing was recorded; its slot is free, but its start key stays with it, so a repeat under the same key replays the receipt.
 * - `server-run-not-saved`: a node-server run holds no history from its start (Issue #139 D3): it is evictable, offers no `read-history` and never reads as saved.
 * - `removed-by-learner`: the learner moved the run's saved study to the system Trash with this window's delete.
 * - `archive-removed`: the run's saved study left the library without a removal of this window, so its archive is gone: its files were removed by hand (a window without a Trash offers nothing else), or another window removed it.
 */
export type HistoryExclusion =
  | 'awaiting-admission'
  | 'refused-at-admission'
  | 'refused-at-preparation'
  | 'stopped-before-history'
  | 'server-run-not-saved'
  | StudyRemovalExclusion
/** The two exclusions that say a run's saved study was removed; each has its own sentence for the agent that reads the run, see {@link historyExclusionReason}. */
export type StudyRemovalExclusion = 'removed-by-learner' | 'archive-removed'
interface StudyRecordState {
  id: string
  signature: string
  createdAt: number
  deadlineAt: number
  cancellation: AbortController
  runtime?: StudyRuntime
  prepared: boolean
  preparation: Promise<void>
  stopping: boolean
  stopped: boolean
  /** The evidence's failure when the run's release ended ({@link StudyService.stopRecord}), the one {@link StudyService.state} reads for a stopped run: a write that fails later, such as an explanation saved after the end, is no failure of the run (Cycle 0046 row 699). */
  evidenceFailureAtStop?: string
  stopPromise?: Promise<void>
  cleanupError?: StudyError
  error?: StudyError
  /** What the run's error was made of, when a write's raw failure or the release's became its cause ({@link StudyService.writeFailureError}, {@link StudyService.stopRecord}), the runtime's own failed write in a preparation among them ({@link StudyService.preparationError}, row 724): {@link StudyService.excludeHistory} words it again once the study turns out removed, so the raw failure's storage path goes from every reader (Cycle 0046 row 700). */
  errorSource?:
    { kind: 'write'; message: string; failure: string } | { kind: 'release' }
  /** What the run's last release threw as it threw it, before {@link StudyService.releaseFailure} worded it, for {@link StudyService.excludeHistory} (row 700). */
  releaseError?: unknown
  action?: {
    signature: string
    receipt: { operationId: string; runUri: string; key: string }
  }
  actions: Map<string, NonNullable<StudyRecord['action']>>
  explanations: Map<string, Explanation>
  explanationKeys: Map<
    string,
    {
      signature: string
      result: Promise<ExplanationReceipt>
      /** Set while the key's explanation carries a learning summary and is still being saved: until its save ends, nobody can say whether the study gets a summary. */
      isSavingLearningSummary?: boolean
    }
  >
  sourceReveals: Set<Promise<void>>
  /** Per committed snapshot of a moved stop, how far {@link StudyService.explain}'s one check of the paused line has gone: `refused` after the one refusal, `explained` once an explanation was accepted, after which none is checked. */
  placeGuards: Map<string, 'refused' | 'explained'>
  historyReceipt?: {
    revision: number
    signature: string
    status: 'pending' | 'saved' | 'failed'
    reason?: string
  }
  historyExcluded?: HistoryExclusion
  /** Counts the {@link StudyService.withEvidenceHeld} calls in progress while the reader moves this run's saved study, so no explanation is written into the evidence directory on its way to the Trash until the last one ends. */
  evidenceHolds?: number
  recording?: RecordingWriter
  recordingEndMs?: number
  recordingSeal?: RecordingSeal
  recordingFailure?: string
  recordingReceipt?: {
    signature: string
    historyRevision: number
    status: 'pending' | 'saved' | 'failed'
    contextHash?: string
    studyHash?: string
    reason?: string
  }
  nodeRun?: NodeTestRuntime
  nodeStops?: NodeTestSourceStop[]
  nodeEvents?: { sequence: number; type: string; detail?: unknown }[]
  /** Root listings of the pre-history check whose process group could not be confirmed as ended, each with the retry that releases it: {@link StudyService.stopRecord} runs them, and the run reads stopped only once every one succeeded, so no next start runs beside a listing that may still run. */
  unreleasedListings?: RetryVitestListingRelease[]
  nodeResult?: Awaited<ReturnType<NodeTestRuntime['complete']>>
  nodePhase?: 'preparing' | 'paused' | 'advancing' | 'completed' | 'failed'
  nodeHistoryWriter?: NodeTestHistoryWriter
  nodeHistoryStatus?: 'recording' | 'complete' | 'partial' | 'failed'
  /** Why the test history could not be sealed, sanitized when it was assigned ({@link sanitizeCause}). */
  nodeHistoryFailure?: string
  /** Why a sealed partial test history ended, sanitized when it was assigned; the run resource's `recording.reason`. */
  nodeHistoryReason?: string
  /** The SHA-256 of the sealed test journal ({@link NodeTestHistoryWriter.finish}); the run resource's `recording.contextHash`. */
  nodeHistoryHash?: string
  /** How many entries the sealed test journal holds ({@link NodeTestHistoryWriter.entryCount}); a sealed history without one has nothing to replay. */
  nodeHistoryEntryCount?: number
  /** The test run's continuation in flight ({@link StudyService.continue}); a stop settles it, with its journal writes, before it seals the history. */
  nodeContinuation?: Promise<void>
  /** The learning material this window last saved for the run's history, so the seal counts it when it came first. */
  nodeLearningMaterial?: {
    revision: number
    content: NodeTestLearningMaterialContent
  }
  /** The run's learning coverage, cached at the seal and after each saved material, so {@link StudyService.state} reads it without a store read (EN2). */
  nodeLearning?: {
    needs: NodeLearningNeeds
    materialRevision: number
    missing: NodeLearningExplanationPart[]
    coverage: NodeLearningCoverage
    /** The recorded evidence the sealed journal lacks, which no explanation can add and which makes Save read partially saved; `undefined` while the journal could not be read, which supports no claim of saved learning. */
    captureMissing?: NodeLearningCapturePart[]
  }
  /** Why a browser recording's finish or read-back failed at the run's stop, sanitized when it was assigned; a `codebook_stop` of the run answers `HISTORY_SEAL_FAILED` with it. */
  recordingSealFailure?: string
}

/** The profiles a start can name, in the order the refusal lists them. */
const SUPPORTED_PROFILES: readonly string[] = [
  REPOSITORY_BROWSER_PROFILE,
  NODE_TEST_PROFILE,
  NODE_SERVER_PROFILE,
]

/**
 * Gives the fields a new run's record starts with because it is a node-server run: its events, its server state and its exclusion from history (D3: evictable, no read-history, never saved).
 * @param profile - The profile of the start.
 * @returns The fields for a node-server run; none for another profile.
 * @example nodeServerRecordFields('node-server').historyExcluded // => 'server-run-not-saved'
 */
function nodeServerRecordFields(profile: string) {
  return profile === NODE_SERVER_PROFILE
    ? {
        nodeEvents: [],
        nodeServer: { loggedFailures: new Set<string>() },
        historyExcluded: 'server-run-not-saved' as const,
      }
    : {}
}

/**
 * Narrows a run's record to a node-server run, for the code paths that exist only for that profile.
 * @param record - Any run's record.
 * @returns `true` for a record of the node-server profile, which always holds its server state.
 * @example if (isNodeServerRecord(record)) record.nodeServer.run?.view()
 */
function isNodeServerRecord(
  record: StudyRecord,
): record is NodeServerStudyRecord {
  return (
    record.profile === NODE_SERVER_PROFILE && record.nodeServer !== undefined
  )
}

/**
 * Tells {@link StudyService.selectPresentation} whether a command selects a layout that is retired, so that only a reader already in that layout may keep it.
 * @param input - The presentation command.
 * @returns `true` for a `select` of any mode but {@link SELECTABLE_PRESENTATION_MODE}; `false` for that mode and for every other action.
 * @example
 * selectsRetiredMode({ ...identity, action: 'select', mode: 'living-book' }) // => true
 * selectsRetiredMode({ ...identity, action: 'restore', mode: 'living-book' }) // => false
 */
function selectsRetiredMode(input: PresentationCommand): boolean {
  return (
    input.action === 'select' && input.mode !== SELECTABLE_PRESENTATION_MODE
  )
}

/** Owns MCP intent/history independently of transport sessions; commands construct it once per editor instance. @example service.start({instanceId, profile: REPOSITORY_BROWSER_PROFILE, key: "study-1", configuration}) */
export class StudyService {
  readonly instanceId = randomUUID()
  readonly records = new Map<string, StudyRecord>()
  recordings?: RecordingStore
  /** Whether this window can remove a saved study: what the window itself says at first (a remote window has no Trash), then what the last removal that moved its study or met the Trash's refusal told; written only by {@link recordStudyRemoval}. */
  private removalAvailability: StudyRemovalAvailability
  playbackController?: PlaybackController
  presentationController?: Pick<
    StudyWorkspace,
    | 'presentationState'
    | 'readPresentationState'
    | 'changePresentation'
    | 'returnToCurrent'
    | 'assertPresentationIdle'
    | 'nodeHistoryLearningMaterialSaved'
    | 'replayControlAccepted'
    | 'markAgentRecordingOpen'
  >
  repository?: RepositoryBookStore
  nodeHistoryStore?: NodeTestHistoryStore
  repositoryPublished?: () => Promise<void>
  repositoryReader?: (
    input: OpenBookInput,
    signal: AbortSignal,
  ) => Promise<{
    bookId: string
    revision: number
    nodeId: string
    anchorIndex: number
    sourceUri: string
  }>
  /** Receives one entry per unexpected failure on a test replay's path for the Output › Codebook channel; the extension sets it at activation. */
  diagnostics?: (entry: CodebookDiagnostic) => void
  /** Receives the plain Output › Codebook lines of a node-server run (its request, its response or failure, each naming the run); the extension sets it at activation. */
  outputLog?: (line: NodeServerOutputLine) => void
  /** How long the learner has to answer the confirmation of a state-changing node-server request before it reads as not confirmed (D6); a test sets a short one. */
  confirmationTimeoutMs = REPOSITORY_PAUSE_HOLD_TIMEOUT_MS
  /** The extension's own storage folders beside {@link storageRoot}, which the extension sets when it creates the service; no shown cause names them. */
  extraStorageRoots: readonly string[] = []
  private readonly repositoryRetirement = new AbortController()
  private readonly repositoryOpens = new Set<Promise<unknown>>()
  private readonly startKeys = new Map<string, StudyRecord>()
  private readonly maintenance: ReturnType<typeof setInterval>
  private stopping = false
  private shutdownPromise?: Promise<void>

  /**
   * Gives the private roots no cause shown to the learner or the agent may name: the service's storage root, the learning directory, the extension's other storage folders, the opened repository and the home directory; read wherever a cause is assigned ({@link sanitizeCause}), by the service and by {@link NodeLearningSave}.
   * @returns The roots for {@link sanitizeCause}.
   * @example sanitizeCause(error, service.causeRoots)
   */
  get causeRoots(): CauseRoots {
    // Real paths too, so a symlinked repository or home stays hidden; an unreadable home is skipped (F58); each real path is read once (F262).
    return causeRootsFor(
      [
        this.storageRoot,
        ...(this.nodeHistoryStore
          ? [this.nodeHistoryStore.learningDirectory]
          : []),
        ...this.extraStorageRoots,
      ],
      this.environment.workspace,
    )
  }

  /**
   * Words a failure for the places a run keeps it, once, at the moment it is assigned: private roots replaced ({@link sanitizeCause}) and the whole bounded to {@link MAX_UI_TEXT_CHARS}; every surface then shows the same value, cut for display where it is shown ({@link cutCauseForDisplay}).
   * A cause past the bound is cut between characters, never inside a surrogate pair, and says it was cut ({@link cutTextToFit}, F258).
   * @param error - What was thrown, or a cause already in words.
   * @returns The sanitized, bounded cause.
   * @example this.sanitizedCause(new Error("ENOSPC, write '/Users/ada/.learning/x'")) // => "ENOSPC, write '<storage>/x'"
   */
  private sanitizedCause(error: unknown): string {
    return cutTextToFit(
      sanitizeCause(error, this.causeRoots),
      (candidate) => candidate.length <= MAX_UI_TEXT_CHARS,
    )
  }

  /**
   * Sanitizes a release failure before the run keeps or throws it, so `codebook_stop`, the run resource and a maintenance turn's error never name a private path (F218): a {@link StudyError} keeps its code, any other failure stays a plain error with sanitized words.
   * @param failure - What the release threw, or its removal wording ({@link StudyService.releaseFailure}).
   * @returns A sanitized {@link StudyError}, or a plain {@link Error} for a failure that was none.
   * @example this.sanitizedFailure(new Error("close failed at '/Users/ada/.service/run'")).message // => "close failed at '<storage>/run'"
   */
  private sanitizedFailure(failure: unknown): unknown {
    return failure instanceof StudyError
      ? this.sanitizedError(failure)
      : new Error(this.sanitizedCause(failure))
  }

  /**
   * Sanitizes the words of a domain error, so the run resource and every MCP answer never name a private path in the message or the cause (F49, F261); called where {@link StudyService.prepare} and {@link StudyService.continueNodeTest} set `record.error`, by {@link StudyService.sanitizedFailure} and by {@link StudyService.unexpectedFailure}.
   * @param error - The domain error of the failure.
   * @returns An error with the same code, whose message and cause are sanitized and bounded.
   * @example this.sanitizedError(new StudyError('RUNTIME_FAILED', "failed at /Users/ada/repo/a.ts")).message // => 'failed at <workspace>/a.ts'
   */
  private sanitizedError(error: StudyError): StudyError {
    return new StudyError(
      error.code,
      this.sanitizedCause(error.message),
      this.sanitizedCause(error.causeDetail),
    )
  }

  /**
   * Tells whether a test run's history sealed with no entry, so the store removed its folder at the seal (D6) and nothing is left to read; asked by the run resource, which then offers no `read-history` and names no `historyUri` (F253).
   * A seal that failed leaves its folder, which may still be read, so only a sealed `complete` or `partial` history counts; so does a history with a learning material this window saved before its first entry, whose folder the seal keeps (F274).
   * @param record - The run.
   * @returns `true` for a sealed test history of no entry; `false` for any other run.
   * @example this.isRemovedEmptyNodeHistory(record) // => true after a stop before the first output
   */
  private isRemovedEmptyNodeHistory(record: StudyRecord): boolean {
    return (
      (record.nodeHistoryStatus === 'complete' ||
        record.nodeHistoryStatus === 'partial') &&
      record.nodeHistoryEntryCount === 0 &&
      // A learning material saved before the first entry keeps the folder (F274).
      record.nodeLearningMaterial === undefined
    )
  }

  /**
   * Words each missing prerequisite of the environment's report without private paths, for `codebook_status`; called by {@link StudyService.status}, whose answer the agent reads. A sentence of Codebook's own reads as it was; a file error quoted in one (an `lstat` of the repository's build folder that was refused) loses the repository, storage and home paths (F257).
   * @param reported - The environment's prerequisites, as it reported them or as their failure became one.
   * @returns The same report whose `missing` sentences, and those of each profile, are sanitized.
   * @example this.sanitizedPrerequisites({ ready: false, missing: ["EACCES: permission denied, lstat '/Users/ada/repo/.next'"] }).missing // => ["EACCES: permission denied, lstat '<workspace>/.next'"]
   */
  private sanitizedPrerequisites(
    reported: Awaited<ReturnType<StudyEnvironment['prerequisites']>>,
  ): Awaited<ReturnType<StudyEnvironment['prerequisites']>> {
    const sanitized = (prerequisite: {
      ready: boolean
      missing: string[]
    }) => ({
      ...prerequisite,
      missing: prerequisite.missing.map((sentence) =>
        this.sanitizedCause(sentence),
      ),
    })
    return {
      ...sanitized(reported),
      ...(reported.profiles
        ? {
            profiles: Object.fromEntries(
              Object.entries(reported.profiles).map(([profile, value]) => [
                profile,
                value && sanitized(value),
              ]),
            ),
          }
        : {}),
    }
  }

  /**
   * Gives a failed tool call or resource read its domain error for the agent, with no private path in its words: a {@link StudyError} keeps its code with its message and cause sanitized ({@link StudyService.sanitizedError}), since many are made from a raw file or Git error (a captured file that cannot be opened, a stored book, the repository's index, a reveal that moved the pause); any other failure (a file call, a parse) becomes `RUNTIME_FAILED` with a sanitized cause (F243, F261). Called by the MCP protocol's tool and resource answers in place of {@link domainError}.
   * @param error - What the call threw.
   * @returns The domain error the answer describes.
   * @example service.unexpectedFailure(new Error("ENOENT: lstat '/Users/ada/…/node-tests.v1/x'")).causeDetail // => "ENOENT: lstat '<storage>/node-tests.v1/x'"
   */
  unexpectedFailure(error: unknown): StudyError {
    return error instanceof StudyError
      ? this.sanitizedError(error)
      : new StudyError(
          'RUNTIME_FAILED',
          'The study operation failed.',
          this.sanitizedCause(error),
        )
  }

  /**
   * Reports one unexpected failure of a run to the Output › Codebook channel with its sanitized cause and stack; called where a test history's seal or a browser recording's finish fails at a stop.
   * @param surface - The error code or the surface that failed.
   * @param record - The run.
   * @param error - What was thrown.
   * @param cause - The sanitized cause, as the run keeps it.
   * @example this.diagnose('HISTORY_SEAL_FAILED', record, error, record.nodeHistoryFailure)
   */
  private diagnose(
    surface: string,
    record: StudyRecord,
    error: unknown,
    cause: string,
  ): void {
    const stack = sanitizedStack(error, this.causeRoots)
    // A sink that throws (the log channel after deactivation) must not escape the stop that reports the failure and leave the run unreleased (F99).
    try {
      this.diagnostics?.({
        surface,
        studyId: `${this.instanceId}_${record.id}`,
        profile: record.profile,
        cause,
        ...(stack ? { stack } : {}),
      })
    } catch {
      // The failure is in the run's own answer; the channel has nowhere to write.
    }
  }

  /** Lets editor shutdown retire only physically released owners when final evidence persistence fails. @example service.resourcesReleased // true after all release checks */
  get resourcesReleased(): boolean {
    return [...this.records.values()].every(
      (record) =>
        record.stopped || record.runtime?.view().resourcesReleased === true,
    )
  }

  constructor(
    readonly environment: StudyEnvironment,
    readonly storageRoot: string,
    private readonly now = Date.now,
    /** Waits before the seal's one retry ({@link StudyService.finishNodeHistory}); a test passes one that records the delay, so no clock runs. */
    private readonly sealRetryDelay: (milliseconds: number) => Promise<void> = (
      milliseconds,
    ) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {
    this.removalAvailability = initialStudyRemovalAvailability(
      environment.remoteName,
    )
    // MCP transports -> one service -> owned runtime. Transport close never replays input.
    this.maintenance = setInterval(
      () => this.maintain(),
      MAINTENANCE_INTERVAL_MS,
    )
    this.maintenance.unref()
  }

  /**
   * Tells whether this window can remove a saved study, so every full-library refusal names a removal only while one can work here; read by the run admission and, through {@link StudyWorkspace}, by the study library and the recording store.
   * @returns `no-trash` in a window without a Trash, where no removal is started; otherwise `available` until the Trash refused a move in this session, then `trash-refused` until a later removal moves its study.
   * @example
   * service.studyRemovalAvailability // => 'available'
   */
  get studyRemovalAvailability(): StudyRemovalAvailability {
    return this.removalAvailability
  }

  /**
   * Records what a removal told about the Trash; called by {@link StudyWorkspace} when {@link LearningLibrary.removeStudy} has settled, only for a removal that moved its study and for one the Trash itself refused (`trashRefused`). A refusal before any move (another window's recording, a held lock, the learner's choice still to come) tells nothing about the Trash and is not recorded.
   * A path the Trash rejected inside a removal that still moved the study does not count against the Trash.
   * @param movedToTrash - `true` when the study moved to the Trash; `false` when the Trash refused a move.
   * @example
   * if (removal.outcome === 'moved') service.recordStudyRemoval(true)
   * else if (removal.trashRefused) service.recordStudyRemoval(false)
   */
  recordStudyRemoval(movedToTrash: boolean): void {
    this.removalAvailability = movedToTrash ? 'available' : 'trash-refused'
  }

  /** Describes actual capabilities before an agent chooses an operation; called by discovery. @example await service.status() */
  async status() {
    const [reportedPrerequisites, repository] = await Promise.all([
      this.environment.prerequisites().catch((error) => ({
        ready: false,
        missing: [this.sanitizedCause(error)],
      })),
      this.repository
        ? this.sources({ instanceId: this.instanceId }).then(
            () => ({ ready: true, reason: undefined }),
            (error) => ({ ready: false, reason: this.sanitizedCause(error) }),
          )
        : Promise.resolve({
            ready: false,
            reason: 'Repository storage is unavailable.',
          }),
    ])
    // A missing prerequisite can quote a file error that names the repository or the home directory: every sentence reaches the agent sanitized (F257).
    const prerequisites = this.sanitizedPrerequisites(reportedPrerequisites)
    const profilePrerequisites = prerequisites.profiles
    const commonPrerequisites = {
      ready: prerequisites.ready,
      missing: prerequisites.missing,
    }
    const nodeTestPrerequisites =
      profilePrerequisites?.[NODE_TEST_PROFILE] ?? commonPrerequisites
    // A full saved-study capacity refuses the start at its preparation, so the profile is not ready then (D7, F92).
    const nodeTestCapacity = await this.nodeHistoryStore
      ?.admission()
      .catch(() => undefined)
    const nodeTestCapacityMissing =
      nodeTestCapacity && !nodeTestCapacity.admits
        ? [
            `node-test cannot start: the saved studies and test histories take ${nodeTestCapacity.taken} places of the ${nodeTestCapacity.limit} that the Saved Study Limit allows. ${fullLibraryMessage('run', nodeTestCapacity.limit, this.removalAvailability)}`,
          ]
        : []
    // What the readiness search for a usable Vitest found; absent for an environment that does not search.
    const vitestSearch = vitestSearchField(nodeTestPrerequisites)
    const nodeTestAdapter =
      this.environment.createNodeTestRun && this.nodeHistoryStore
        ? {
            ready:
              nodeTestPrerequisites.ready &&
              nodeTestCapacityMissing.length === 0,
            missing: [
              ...nodeTestPrerequisites.missing,
              ...nodeTestCapacityMissing,
            ],
            ...vitestSearch,
          }
        : {
            ready: false,
            missing: [
              ...nodeTestPrerequisites.missing,
              ...(!this.environment.createNodeTestRun
                ? ['The owned Node test adapter is unavailable.']
                : []),
              ...(!this.nodeHistoryStore
                ? ['The workspace-bound Node history store is unavailable.']
                : []),
            ],
            ...vitestSearch,
          }
    return {
      instanceId: this.instanceId,
      apiVersion: API_VERSION,
      workspace: this.environment.workspace,
      host: this.environment.host,
      build: { ...this.environment.build, scope: 'codebook-extension-source' },
      workspaceGitStatus: 'not-inspected',
      prerequisites,
      stopping: this.stopping,
      profiles: [
        {
          ...CONFIGURED_PROFILE,
          prerequisites:
            profilePrerequisites?.[REPOSITORY_BROWSER_PROFILE] ??
            commonPrerequisites,
        },
        {
          id: NODE_TEST_PROFILE,
          title: 'Repository Node test',
          description:
            'Run one cited repository Vitest test with ordered native Node source stops.',
          requiresConfiguration: true,
          configurationVersions: [1],
          minimumExtensionVersion: NODE_TEST_MINIMUM_EXTENSION_VERSION,
          helpUri: 'codebook://help/node-test',
          adapter: 'vitest-node',
          actions: [],
          items: [],
          expectations: [],
          requiredLinks: [],
          capturePhases: [],
          limits: {
            runTimeoutMs: REPOSITORY_RUN_TIMEOUT_MS,
            setupTimeoutMs: REPOSITORY_SETUP_TIMEOUT_MS,
            activeTimeoutMs: ACTIVE_TIMEOUT_MS,
            pauseHoldTimeoutMs: REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
            activeBudget: 'per-action',
            configurationBytes: REPOSITORY_CONFIG_LIMIT_BYTES,
            stops: 8,
            inspections: REPOSITORY_INSPECTION_LIMIT,
            sourceBytes: { typescript: REPOSITORY_SOURCE_LIMIT_BYTES },
          },
          prerequisites: nodeTestAdapter,
          recording: {
            available: true,
            reason:
              'Test output, executed source and recorded debugger stops; no application video',
          },
        },
        this.nodeServerProfileEntry(
          profilePrerequisites?.[NODE_SERVER_PROFILE] ?? commonPrerequisites,
        ),
      ],
      capabilities: [
        'start',
        REPOSITORY_BROWSER_ACTION,
        NODE_SERVER_ACTION,
        'pause-evidence',
        'continue',
        'explain',
        'reveal-source',
        'stop',
        'historical-resources',
        'return-current-reader',
      ],
      limits: {
        activeRuns: 1,
        retainedRuns: MAX_RUNS,
        explanationsPerRun: MAX_EXPLANATIONS,
        activeTimeoutMs: ACTIVE_TIMEOUT_MS,
        runTimeoutMs: REPOSITORY_RUN_TIMEOUT_MS,
      },
      runs: [...this.records.values()].map((record) => {
        const run = this.state(record)
        // Surface the current failure beside its run URI so status polling cannot misdiagnose post-cleanup locks.
        return {
          runId: record.id,
          uri: this.uri(record.id),
          state: run.state,
          terminalReason: run.terminalReason,
          error: run.error,
          cleanupError: run.cleanupError,
        }
      }),
      recording: this.recordings
        ? {
            libraryUri: `codebook://${this.instanceId}/library`,
            playbackUri: `codebook://${this.instanceId}/playback`,
            playbackAvailable: Boolean(this.playbackController),
            limits: this.recordings.limits,
            capacity: {
              ...this.recordings.capacityStatus(),
              // Absent when the library cannot be read; a start then names that error.
              savedStudies: await this.recordings
                .savedStudyCount()
                .catch(() => undefined),
              fields:
                'limit is the current Saved Study Limit setting: a new study is admitted while savedStudies (the studies saved now) is below it. maximum, like limits.slots, is the highest value that setting accepts, not the current limit.',
            },
            instructions:
              'Saved recordings survive server/runtime exit. Discover their study IDs using libraryUri; current-instance URIs and playback revisions must be copied, not guessed. Playback never starts, clicks or continues a run.',
          }
        : undefined,
      presentation: this.presentationController
        ? {
            ...(await this.presentationState(this.instanceId)),
            instructions:
              'Before runtime application input, open a closed learner workspace by selecting its reported current mode; preserve its saved preference. Confirm state open and layoutConfirmed true, or follow the reported recovery before proceeding. A read made while the chat has the keyboard focus cannot measure the main editor grid without taking that focus: it answers the confirmation of the last arrangement with layoutMeasured false while no tab or group changed since, and layoutConfirmed false once one did. Study workspace is the only layout that can be selected; the retired Living book and Guided walkthrough layouts stay only where a saved preference still names one. Copy presentationId and presentationControlRevision as expectedRevision for mode changes. Before a new run, if reader.contentTab is not live or reader.followingCurrentRun is false, use codebook_return_current with reader.contentRevision as expectedRevision; verify both live and followingCurrentRun true so captured values and explanations are visible. A run started while an open reader has followingCurrentRun false is not started: it ends before any application input and names this step; start again with a new key after it. It preserves saved history and never sends application input. Selection pauses replay at its confirmed position. Read state after response loss; restore repairs layout, save-preference retries only the current confirmed preference. No runtime or understanding mutation.',
          }
        : undefined,
      repository: {
        ...repository,
        catalogUri: `codebook://${this.instanceId}/repository`,
        helpUri: 'codebook://help/repository',
        readerAvailable: Boolean(this.repositoryReader),
        scope:
          'Trusted local selected workspace at its Git working-tree root; tracked eligible UTF-8 text only. No runtime adapter or Chrome/debugger is required for source authoring.',
        limits: {
          documentBytes: BOOK_INPUT_LIMIT_BYTES,
          httpEnvelopeBytes: HTTP_BODY_LIMIT_BYTES,
          sourceBytes: REPOSITORY_SOURCE_LIMIT_BYTES,
          sourcesPerRevision: BOOK_MAX_SOURCES,
          booksPerWorkspace: BOOK_MAX_FILES,
        },
        authoring: [
          'codebook_sources',
          'codebook_source',
          'codebook_publish_book',
          'codebook_open_book',
        ],
      },
      recovery:
        'Same instance: initialize a new transport and read the existing run. Server restart: copy new credentials first. Never automatically repeat a click.',
    }
  }

  /**
   * Describes the node-server profile for `codebook_status` with everything that keeps it from starting here: the environment's missing items (Node, a listener tool, `ps`, a supported system), a missing run factory and missing repository storage.
   * @param reported - The environment's prerequisites for the profile, or the shared ones when it reports none.
   * @returns The profile entry ({@link describeNodeServerProfile}).
   * @example this.nodeServerProfileEntry({ ready: true, missing: [] }).prerequisites.ready // => true when the adapter and storage exist
   */
  private nodeServerProfileEntry(reported: {
    ready: boolean
    missing: string[]
  }) {
    const missing = [
      ...reported.missing,
      ...(this.environment.createNodeServerRun
        ? []
        : ['The owned Node server adapter is unavailable.']),
      ...(this.repository
        ? []
        : ['Repository source/book storage is unavailable.']),
    ]
    return describeNodeServerProfile({
      ready: reported.ready && missing.length === 0,
      missing,
    })
  }

  /** Returns only currently owned repository storage without imposing runtime prerequisites. @example service.repositoryStore(instanceId) */
  repositoryStore(instanceId: string): RepositoryBookStore {
    this.assertMutable(instanceId)
    this.environment.assertWorkspace?.()
    if (!this.repository)
      throw new StudyError(
        'PREREQUISITE_MISSING',
        'Repository source/book storage is unavailable in this editor.',
      )
    return this.repository
  }

  /** Lists bounded tracked names through the current instance, independently of runtime support. @example await service.sources({instanceId}) */
  async sources(input: SourceListInput) {
    const result = await this.repositoryStore(input.instanceId).sources.list(
      input.cursor,
    )
    this.repositoryStore(input.instanceId)
    return { instanceId: this.instanceId, ...result }
  }

  /**
   * Reads one exact tracked source without navigating or running the application; the answer of `codebook_source`, which an agent reads before it cites lines or declares a stop.
   * @param input - The instance and the tracked path, with the hash the agent expects when it rereads a cited file.
   * @returns The source's path, full-byte hash and line count, and `numberedText`: its lines, each after its one-based number and a tab ({@link numberSourceLines}), so the agent takes a line from the answer instead of counting. The numbered copy is the answer's only copy of the lines: the tool answers this object in `content` and in `structuredContent`, because some editor chats give their model only one of the two, and an unnumbered copy beside it would double the answer.
   * @throws When the instance is stale, the path is not an eligible tracked file or its hash differs from `expectedHash`.
   * @example
   * ```ts
   * (await service.source({ instanceId, path: 'src/main.ts' })).numberedText // => '1\tconst a = 1\n2\t'
   * ```
   */
  async source(input: SourceReadInput) {
    const result = await this.repositoryStore(input.instanceId).sources.read(
      input.path,
      input.expectedHash,
    )
    this.repositoryStore(input.instanceId)
    // The lines are answered once, numbered: the plain text beside them would repeat every line.
    const { text, ...identity } = result
    return {
      instanceId: this.instanceId,
      ...identity,
      numberedText: numberSourceLines(text),
    }
  }

  /** Publishes/retrieves an immutable intent receipt; connection lifetime never becomes persisted book identity. @example await service.publishBook(input) */
  async publishBook(input: PublishBookInput, signal?: AbortSignal) {
    const store = this.repositoryStore(input.instanceId),
      { instanceId: _instanceId, ...intent } = input
    const receipt = await store.publish(
      intent,
      AbortSignal.any([
        this.repositoryRetirement.signal,
        ...(signal ? [signal] : []),
      ]),
    )
    // Reader refresh failure cannot turn a committed publication into a failed write receipt.
    void this.repositoryPublished?.().catch(() => undefined)
    return {
      instanceId: this.instanceId,
      ...receipt,
      uri: `codebook://${this.instanceId}/books/${receipt.bookId}/${receipt.revision}`,
    }
  }

  /** Opens only the explicitly named article/citation through the native reader without understanding or runtime input. @example await service.openBook(input) */
  async openBook(input: OpenBookInput, signal?: AbortSignal) {
    this.repositoryStore(input.instanceId)
    this.presentationController?.assertPresentationIdle()
    if (!this.repositoryReader)
      throw new StudyError(
        'BOOK_UNAVAILABLE',
        'The repository reader is not available in this host.',
      )
    const cancellation = AbortSignal.any([
      this.repositoryRetirement.signal,
      ...(signal ? [signal] : []),
    ])
    cancellation.throwIfAborted()
    const opening = this.repositoryReader(input, cancellation)
    this.repositoryOpens.add(opening)
    try {
      const receipt = await opening
      cancellation.throwIfAborted()
      this.repositoryStore(input.instanceId)
      return { instanceId: this.instanceId, ...receipt }
    } finally {
      this.repositoryOpens.delete(opening)
    }
  }

  /**
   * Routes a typed historical control to the workspace's shared controller, never to a live runtime operation; the handler of `codebook_playback`.
   * A test replay's study id is refused before anything else is checked or loaded: the browser replay's controller cannot present a test history, and the learner opens one from Saved studies or Open replay.
   * @param input - The control with its study id and expected revision.
   * @returns The playback state after the control.
   * @throws `PLAYBACK_PROFILE_UNSUPPORTED` for a test replay; what {@link playbackRefusal} words for a refused control.
   * @example service.playback({...identity,action:'pause',expectedRevision:2})
   */
  playback(input: PlaybackCommand) {
    this.assertMutable(input.instanceId)
    if (this.isTestReplay(input.studyId))
      throw new StudyError(
        'PLAYBACK_PROFILE_UNSUPPORTED',
        `codebook_playback cannot control study ${input.studyId}: it is a node-test replay, which the learner opens from Saved studies or Open replay.`,
      )
    this.presentationController?.assertPresentationIdle()
    if (!this.playbackController)
      throw new StudyError(
        'PREREQUISITE_MISSING',
        'The playback workspace is unavailable.',
      )
    // An agent's open enters the reader as the agent's: the learner's keyboard stays where Codebook need not move it (row 613).
    const forgetAgentOpen =
      input.action === 'open'
        ? this.presentationController?.markAgentRecordingOpen(input.studyId)
        : undefined
    try {
      const state = this.playbackController.command(input)
      // An open the controller answers without a load (the same recording, loading or shown) leaves no mark for a later open.
      if (state.revision === input.expectedRevision) forgetAgentOpen?.()
      // An accepted seek, play or pause answers a refusal the Learning replay panel still shows; an open is answered when its load is ready.
      if (input.action !== 'open')
        this.presentationController?.replayControlAccepted()
      return {
        ...state,
        uri: `codebook://${this.instanceId}/playback`,
      }
    } catch (error) {
      forgetAgentOpen?.()
      // A closed reader is recovered only by open; reading the playback resource again would not change the answer.
      const readerClosed = !this.playbackController.state().readerOpen
      throw this.playbackRefusal(error, readerClosed, input)
    }
  }

  /**
   * Says whether a study id names a test replay: a node-test run of this service, or a test history the store listed; read by {@link playback} before any other check.
   * @param studyId - The study id an agent sent.
   * @returns `true` for a test replay's study id.
   * @example this.isTestReplay(`${service.instanceId}_${record.id}`) // => true for a node-test run
   */
  private isTestReplay(studyId: string): boolean {
    return (
      [...this.records.values()].some(
        (record) =>
          record.profile === NODE_TEST_PROFILE &&
          `${this.instanceId}_${record.id}` === studyId,
      ) ||
      Boolean(
        this.nodeHistoryStore?.isListedHistory(studyId) ||
        this.nodeHistoryStore?.holdsHistoryFolder(studyId),
      )
    )
  }

  /**
   * Words the refusal of a historical control the shared controller rejected; called by {@link playback} with what the controller threw.
   * @param error - What the controller threw; its text is the refusal's message.
   * @param readerClosed - Whether the replay reader is closed, which only `open` recovers.
   * @param input - The refused command; its study is named in the recovery for a closed reader.
   * @returns A `STALE_PLAYBACK` error for a stale revision, otherwise `PLAYBACK_UNAVAILABLE`, with the recovery for a closed reader or the playback resource to read first.
   * @example throw this.playbackRefusal(new Error('Stale playback revision'), false, input) // code 'STALE_PLAYBACK'
   */
  private playbackRefusal(
    error: unknown,
    readerClosed: boolean,
    input: PlaybackCommand,
  ): StudyError {
    return new StudyError(
      String(error).includes('Stale playback revision')
        ? 'STALE_PLAYBACK'
        : 'PLAYBACK_UNAVAILABLE',
      String(error),
      readerClosed
        ? `The replay reader is closed (readerOpen is false). Send codebook_playback with action open and studyId ${input.studyId} to reopen it before another control. No application input was sent.`
        : `Read codebook://${this.instanceId}/playback before retrying. No application input was sent.`,
    )
  }

  /** Discovers the reader lifetime separately from the server without opening a view; called by MCP resources. @example (await service.presentationState(instanceId)).presentationId */
  async presentationState(instanceId: string) {
    this.assertInstance(instanceId)
    if (!this.presentationController)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'The Study reader is unavailable in this host.',
      )
    const state = await this.presentationController.readPresentationState()
    return {
      instanceId: this.instanceId,
      ...state,
      uri: `codebook://${this.instanceId}/presentation`,
      // Only layouts {@link selectPresentation} accepts are offered: Study workspace, and a retired layout while the reader is still in it.
      modes: PRESENTATION_MODE_IDS.filter(
        (mode) => mode === SELECTABLE_PRESENTATION_MODE || mode === state.mode,
      ).map((mode) => ({
        mode,
        title: STUDY_PRESENTATIONS[mode].title,
        description: STUDY_PRESENTATIONS[mode].description,
      })),
    }
  }

  /** Routes explicit mode intent to the shared reader after checking server identity, without runtime input. @example await service.selectPresentation(input) */
  async selectPresentation(input: PresentationCommand) {
    this.assertMutable(input.instanceId)
    this.assertWorkspace()
    if (!this.presentationController)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'The Study reader is unavailable in this host.',
      )
    // Living book and Guided walkthrough are retired: a reader whose saved preference still names one keeps it, but nothing selects one anew.
    if (
      selectsRetiredMode(input) &&
      (await this.presentationController.readPresentationState()).mode !==
        input.mode
    )
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        RETIRED_PRESENTATION_REFUSAL,
      )
    // The codebook_presentation tool's request is an agent's: beside a chat view no file it cannot prove gets the keyboard (row 613).
    await this.presentationController.changePresentation(input, 'agent')
    return this.presentationState(input.instanceId)
  }

  /**
   * Runs the host's workspace check when it has one; called by {@link selectPresentation} before the reader is asked for anything.
   * @throws What the environment's check throws for a workspace that may not be changed.
   * @example this.assertWorkspace()
   */
  private assertWorkspace(): void {
    this.environment.assertWorkspace?.()
  }

  /** Returns only the current reader from selected history to live execution through a versioned native control. @example await service.returnToCurrent({instanceId,presentationId,expectedRevision:4}) */
  async returnToCurrent(input: ReturnCurrentCommand) {
    this.assertMutable(input.instanceId)
    this.environment.assertWorkspace?.()
    if (!this.presentationController)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'The Study reader is unavailable in this host.',
      )
    // The codebook_return_current tool's request is an agent's: its Live arrangement gives no file it cannot prove the keyboard beside a chat view, and says once where it is.
    await this.presentationController.returnToCurrent(input, 'agent')
    return this.presentationState(input.instanceId)
  }

  /**
   * Starts a run only on a node its selected book revision has, so a start on a node id or a revision that does not exist is refused in the answer of `codebook_start` itself instead of being accepted and ending without a runtime; the `codebook_start` tool calls it, and it then reserves the run with {@link StudyService.start}.
   * @param input - The start as the tool received it.
   * @returns The receipt of {@link StudyService.start}.
   * @throws A `BOOK_UNAVAILABLE` {@link StudyError} for a selected revision that does not exist or a node id it does not have ({@link describeMissingBookNode}); what {@link StudyService.start} throws otherwise.
   * @example
   * await service.startOnStoredBook(input) // throws 'configuration.book.nodeId mode does not exist in revision 1 of book interface, which has the node: theme. …'
   */
  async startOnStoredBook(input: StartInput) {
    await this.refuseMissingBookNode(input)
    return this.start(input)
  }

  /**
   * Reads the book revision a start selects and refuses a node id it does not have, before {@link StudyService.startOnStoredBook} reserves the run.
   * @param input - The start as the tool received it.
   * @throws A `STALE_INSTANCE` error for another instance; a `BOOK_UNAVAILABLE` {@link StudyError} for a revision that does not exist, a stored book the store cannot read, or a node id the revision does not have. Arguments that do not parse, a repeat of an accepted start's key, an editor without book storage and a read that fails with any other error are left to {@link StudyService.start} and the run's preparation, which answer them as before.
   * @example
   * await this.refuseMissingBookNode(input) // resolves for a node the revision has
   */
  private async refuseMissingBookNode(input: StartInput): Promise<void> {
    this.assertMutable(input.instanceId)
    const book = this.bookOfNewStart(input)
    // A repeated key answers its original run, and the other cases are answered by start itself.
    if (!book) return
    const nodeIds = await this.storedNodeIds(book)
    if (nodeIds && !nodeIds.includes(book.nodeId))
      throw new StudyError(
        'BOOK_UNAVAILABLE',
        describeMissingBookNode(book, nodeIds),
      )
  }

  /**
   * Reads the node ids of the book revision a start selects, for {@link StudyService.refuseMissingBookNode}.
   * @param book - The start's book selection.
   * @returns The revision's node ids in document order; `undefined` without book storage and for a read that failed with an error that is not a {@link StudyError}, which the run's preparation then meets and names in the run.
   * @throws The store's {@link StudyError} (`BOOK_UNAVAILABLE` for a revision that does not exist or a stored book it cannot read), so the start is refused in its own answer.
   * @example
   * await this.storedNodeIds({ bookId: 'interface', revision: 1, nodeId: 'theme' }) // => ['theme']
   */
  private async storedNodeIds(book: {
    bookId: string
    revision: number
  }): Promise<string[] | undefined> {
    if (!this.repository) return undefined
    try {
      const selected = await this.repository.readDefinition(
        book.bookId,
        book.revision,
      )
      return selected.revision.document.nodes.map((node) => node.id)
    } catch (error) {
      // Only the store's own refusal is an answer to the start; any other failure is left to preparation, which names it in the run.
      if (error instanceof StudyError) throw error
      return undefined
    }
  }

  /**
   * Gives the book selection of a start that would begin a new run, for {@link StudyService.refuseMissingBookNode}.
   * @param input - The start as the tool received it.
   * @returns The configuration's `book` for arguments that parse under a key no accepted run holds; `undefined` for arguments that do not parse and for a repeat of an accepted start, which {@link StudyService.start} answers.
   * @example
   * this.bookOfNewStart(input) // => { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 0 }
   */
  private bookOfNewStart(input: StartInput) {
    const parsed = startIntentSchema.safeParse(input)
    return parsed.success && !this.retainedStart(input.key).previous
      ? parsed.data.configuration.book
      : undefined
  }

  /** Reserves intent before prerequisite I/O so duplicate starts cannot create two runtimes. @example service.start(input).runUri */
  start(input: StartInput) {
    this.assertMutable(input.instanceId)
    // A refused run had no effect, so its key is free: the repeat is checked as a new start, and the refused run is forgotten only once that start is accepted.
    const { previous, refusal } = this.retainedStart(input.key)
    if (previous && previous.profile !== input.profile)
      throw new StudyError(
        'IDEMPOTENCY_CONFLICT',
        'Start key already names different arguments.',
      )
    if (!SUPPORTED_PROFILES.includes(input.profile))
      throw new StudyError(
        'UNSUPPORTED_PROFILE',
        `Available profiles: ${SUPPORTED_PROFILES.join(', ')}`,
      )
    // The tool boundary accepts any node-server object, so this is where every violation is listed (D4).
    if (!previous) this.assertNodeServerDeclaration(input)
    const parsed = startIntentSchema.safeParse(input)
    if (!parsed.success)
      throw new StudyError(
        previous ? 'IDEMPOTENCY_CONFLICT' : 'INVALID_CONFIGURATION',
        'Start arguments do not match the selected profile or accepted intent.',
        parsed.error.message,
      )
    const intent = parsed.data,
      signature = sha256(JSON.stringify(intent))
    if (previous) {
      if (previous.signature !== signature)
        throw new StudyError(
          'IDEMPOTENCY_CONFLICT',
          'Start key already names different arguments.',
        )
      return this.receipt(previous)
    }
    this.presentationController?.assertPresentationIdle()
    if ([...this.records.values()].some((record) => !record.stopped))
      throw new StudyError('BUSY', 'Another run still owns resources.')
    this.reserveRunSlot(refusal)
    const createdAt = this.now()
    const timeout = REPOSITORY_RUN_TIMEOUT_MS
    const record: StudyRecord = {
      ...intent,
      id: randomUUID(),
      signature,
      createdAt,
      deadlineAt: createdAt + timeout,
      cancellation: new AbortController(),
      prepared: false,
      preparation: Promise.resolve(),
      stopping: false,
      stopped: false,
      actions: new Map(),
      explanations: new Map(),
      explanationKeys: new Map(),
      sourceReveals: new Set(),
      placeGuards: new Map(),
      ...(intent.profile === NODE_TEST_PROFILE
        ? { nodeStops: [], nodeEvents: [], nodePhase: 'preparing' as const }
        : {}),
      // A server run holds no history from its start (D3): evictable, no read-history, never saved.
      ...nodeServerRecordFields(intent.profile),
      // A reader refresh can arrive before the admission answers; until then the run is not a checkpoint candidate.
      ...(intent.profile === REPOSITORY_BROWSER_PROFILE && this.recordings
        ? { historyExcluded: 'awaiting-admission' as const }
        : {}),
    }
    this.records.set(record.id, record)
    this.startKeys.set(input.key, record)
    record.preparation = this.prepare(record)
    return this.receipt(record)
  }

  /**
   * Refuses a node-server start whose declaration does not parse, listing every violation with its field path and naming `codebook://help/node-server`; called by {@link StudyService.start} for a start that begins a new run.
   * @param input - The start as the tool received it.
   * @throws `INVALID_CONFIGURATION` with {@link describeNodeServerConfigurationIssues} for a node-server start; nothing for another profile.
   * @example this.assertNodeServerDeclaration({ ...input, configuration: { ...declaration, port: 80 } }) // throws 'configuration.port: expected an integer from 1024 to 65535, …'
   */
  private assertNodeServerDeclaration(input: StartInput): void {
    if (input.profile !== NODE_SERVER_PROFILE) return
    const declaration = nodeServerConfigSchema.safeParse(input.configuration)
    if (!declaration.success)
      throw new StudyError(
        'INVALID_CONFIGURATION',
        describeNodeServerConfigurationIssues(declaration.error.issues),
      )
  }

  /**
   * Keeps the {@link MAX_RUNS} bound of retained runs before {@link StudyService.start} reserves another one; it is the last step that can reject a start.
   * A refused or removed run holds no history, so it gives up its slot before a start is refused for the bound.
   * @param refusal - The stopped refused run whose start this one repeats; it is forgotten first, so the new run takes its slot and its key.
   * @throws A `LIMIT_EXCEEDED` {@link StudyError} when every retained run holds history.
   * @example
   * this.reserveRunSlot() // with 16 retained runs, one of them refused: forgets that run and returns
   * this.reserveRunSlot(refusal) // forgets the refused run the start repeats, then returns
   */
  private reserveRunSlot(refusal?: StudyRecord): void {
    if (refusal) this.forgetRecord(refusal)
    if (this.records.size < MAX_RUNS) return
    if (this.evictOldestExcludedRecord()) return
    throw new StudyError(
      'LIMIT_EXCEEDED',
      `This instance retains at most ${MAX_RUNS} runs; no history was evicted.`,
    )
  }

  /**
   * Frees one retained-run slot by forgetting the oldest run whose history is excluded, with its start keys; called by {@link StudyService.reserveRunSlot} when every slot is taken.
   * Runs that hold history, and a run still waiting for its admission, are never evicted.
   * @returns
   * - `true`: one refused or removed run was forgotten
   * - `false`: every retained run holds history, so nothing changed
   * @example
   * this.evictOldestExcludedRecord() // => true after a run was refused at its admission
   */
  private evictOldestExcludedRecord(): boolean {
    // Map iteration follows insertion order, so the first excluded record is the oldest.
    const evicted = [...this.records.values()].find(
      (record) => historyExclusionState(record.historyExcluded) === 'ended',
    )
    if (!evicted) return false
    this.forgetRecord(evicted)
    return true
  }

  /**
   * Reads what a start key already names; called first by {@link StudyService.start}.
   * A run the study library refused, or a node-test run its preparation refused before its history began, had no effect once it ended, so its key is free: it is returned apart from `previous`, no conflict check applies to it, and {@link StudyService.reserveRunSlot} forgets it once every guard of the repeat has passed. A repeat that a guard rejects therefore leaves the refused run and its receipt as they were.
   * @param key - The start key of the incoming start.
   * @returns
   * - No retained run for the key: both undefined
   * - A refused run that has ended: `refusal`
   * - Any other retained run, including a refused run that is still stopping: `previous`, whose receipt a matching start replays
   * @example
   * this.retainedStart('explain-login') // => { previous: undefined, refusal } once the library refused that run and it ended
   */
  private retainedStart(key: string): {
    previous: StudyRecord | undefined
    refusal: StudyRecord | undefined
  } {
    const named = this.startKeys.get(key)
    // A run the library or its preparation refused had no effect once it ended.
    const isStoppedRefusal =
      (named?.historyExcluded === 'refused-at-admission' ||
        named?.historyExcluded === 'refused-at-preparation') &&
      named.stopped
    return isStoppedRefusal
      ? { previous: undefined, refusal: named }
      : { previous: named, refusal: undefined }
  }

  /**
   * Drops one retained run with every start key that names it; called by {@link StudyService.evictOldestExcludedRecord} and {@link StudyService.reserveRunSlot}.
   * A later start with one of its keys begins a new run instead of replaying the forgotten receipt.
   * @param record - A run that holds no history.
   * @example
   * this.forgetRecord(refused) // this.records.has(refused.id) === false
   */
  private forgetRecord(record: StudyRecord): void {
    this.records.delete(record.id)
    for (const [key, keyedRecord] of this.startKeys)
      if (keyedRecord === record) this.startKeys.delete(key)
  }

  /**
   * Finds the receipt an action key already holds, so a repeat after a lost response gets the original answer; called first by {@link StudyService.action} and {@link StudyService.requestNodeServer}.
   * @param record - The run.
   * @param key - The action's key.
   * @param signature - The key and action as this call names them.
   * @returns The stored receipt for the same key and action; `undefined` for a key no action used.
   * @throws `IDEMPOTENCY_CONFLICT` when the key names another action.
   * @example this.replayedAction(record, 'send-1', JSON.stringify(['send-1', 'http-request'])) // => the receipt of the first call
   */
  private replayedAction(record: StudyRecord, key: string, signature: string) {
    const previous = record.actions.get(key)
    if (!previous) return undefined
    if (previous.signature === signature) return previous.receipt
    throw new StudyError(
      'IDEMPOTENCY_CONFLICT',
      'Action key already names different arguments.',
      `Read ${this.uri(record.id)} for retained receipts.`,
    )
  }

  /** Admits the next fixed action while replaying every original receipt across later steps and cleanup. @example service.action({...run, key:'operation', action:'repository-click'}) */
  action(input: ActionInput) {
    this.assertMutable(input.instanceId)
    const record = this.record(input)
    const signature = JSON.stringify([input.key, input.action])
    const replayed = this.replayedAction(record, input.key, signature)
    if (replayed) return replayed
    this.presentationController?.assertPresentationIdle()
    if (
      !record.prepared ||
      record.stopping ||
      record.stopped ||
      record.error ||
      record.runtime?.evidence.failure ||
      this.now() >= record.deadlineAt ||
      record.runtime?.view().status !== 'ready'
    )
      throw new StudyError(
        'BUSY',
        'The run is not ready for input. Read its nextActions.',
      )
    const nextAction = record.runtime.view().nextAction
    if (nextAction !== input.action)
      throw new StudyError(
        'BUSY',
        `Expected ${nextAction ?? 'no further action'}, received ${input.action}.`,
        `Read ${this.uri(record.id)} for current nextActions; nothing was dispatched.`,
      )
    let operation: ReturnType<StudyRuntime['action']>
    try {
      operation = record.runtime.action(input.key, input.action)
    } catch (error) {
      throw new StudyError(
        String(error).includes('conflict:') ? 'BUSY' : 'RUNTIME_FAILED',
        'The action was not accepted.',
        this.sanitizedCause(error),
      )
    }
    const receipt = {
      operationId: operation.id,
      key: input.key,
      runUri: this.uri(record.id),
    }
    record.action = { signature, receipt }
    record.actions.set(input.key, record.action)
    return receipt
  }

  /**
   * Continues the current pause for the `codebook_continue` tool and, when the arguments carry `answer: "next"` as the run resource's continueArguments do, answers with the run's next state, so an agent needs no poll after a continuation.
   * The wait is one promise ({@link waitForNextRunState}) that settles on the run's next state change after the continuation was acknowledged. Its one bound is the earlier of the acknowledgement plus {@link ACTIVE_TIMEOUT_MS} and {@link CONTINUE_ANSWER_GRACE_MS}, and the call's start plus {@link CONTINUE_ANSWER_CALL_BUDGET_MS}. It never passes the run's own deadline: that deadline is one of the state changes that end it ({@link StudyService.nextRunState}).
   * @param input - The current pause's continuation arguments, as the run resource gave them.
   * @param signal - The request's cancellation; an abandoned request releases its wait.
   * @returns
   * - Without `answer` and for a Node test run: what {@link StudyService.continue} answers
   * - With `answer: "next"`: `accepted`, `runUri`, the run's `state` (the run resource) and `next`, which names what ended the wait: `observation` (the next pause is committed and can be continued), `result` (the result was observed and the run's final save succeeded), `failure` (the run failed, also at its deadlines) or `stopped` (the run was stopped or the service is shutting down)
   * - At the bound, and for an abandoned request: the same without `next`, with the latest state; the agent then polls
   * @throws What {@link StudyService.continue} throws; nothing is awaited after a refused continuation.
   * @example
   * const answer = await service.continueToNextState(runState.participants.browser.continueArguments)
   * // => { accepted: true, runUri, next: 'observation', state: { observations: [..., { inspectionUri }], ... } }
   */
  async continueToNextState(input: ContinueInput, signal?: AbortSignal) {
    const startedAtMs = this.now()
    const server = this.records.get(input.runId)
    // A node-server run waits for its request's next state, not for a runtime snapshot.
    if (server && isNodeServerRecord(server))
      return this.continueNodeServerToNextState(
        server,
        input,
        startedAtMs,
        signal,
      )
    // The snapshots committed before the continuation tell the next observation from the one being continued.
    const committedBefore = new Set(
      this.records
        .get(input.runId)
        ?.runtime?.view()
        .snapshots.map((snapshot) => snapshot.id),
    )
    const receipt = await this.continue(input)
    const record = this.record(input)
    // A Node test continuation already answers at its next stop or its result.
    if (input.answer !== 'next' || record.profile === NODE_TEST_PROFILE)
      return receipt
    const waitEndsAtMs = Math.min(
      this.now() + ACTIVE_TIMEOUT_MS + CONTINUE_ANSWER_GRACE_MS,
      startedAtMs + CONTINUE_ANSWER_CALL_BUDGET_MS,
    )
    const next = await waitForNextRunState(
      () => this.nextRunState(record, committedBefore),
      () => this.now() >= waitEndsAtMs,
      signal,
    )
    return { ...receipt, ...(next && { next }), state: this.state(record) }
  }

  /**
   * Names what ended the step a continuation began, read by {@link StudyService.continueToNextState} at every turn of its wait.
   * @param record - The run that was continued.
   * @param committedBefore - The ids of the snapshots committed before the continuation.
   * @returns
   * - `'failure'` once the run has an error, a runtime or evidence failure, or passed its whole-run deadline ({@link StudyService.expireAtDeadline} applies it at once instead of at the next maintenance turn)
   * - `'result'` once the runtime completed and its final save succeeded, also while the service already cleans the completed run up
   * - `'stopped'` once a run that did not complete is being stopped or was cancelled, or the service is shutting down
   * - `'observation'` once a participant is paused at a snapshot committed after the continuation
   * - `undefined` while the run is still on its way; a snapshot that was committed and then failed its inspection is no observation to continue, and the failure that follows it is what ends the wait
   * @example this.nextRunState(record, new Set(['browser-session:1'])) // => 'observation' once browser-session:2 is committed and paused
   */
  private nextRunState(
    record: StudyRecord,
    committedBefore: ReadonlySet<string>,
  ): 'failure' | 'stopped' | 'result' | 'observation' | undefined {
    // The whole-run deadline is the run's own end: apply it now, so the answer carries it.
    this.expireAtDeadline(record)
    const runtime = record.runtime?.view()
    return (
      this.endedRunState(record, runtime, runtime?.status) ??
      this.nextObservationState(runtime, committedBefore)
    )
  }

  /**
   * Names how a continued run ended, in the order that decides between two ends that both hold; the first half of {@link StudyService.nextRunState}, asked before the next observation is looked for.
   * @param record - The run that was continued.
   * @param runtime - The runtime's view read at this turn; `undefined` for a run without a runtime.
   * @param status - The status of that view; `undefined` without a runtime.
   * @returns
   * - `'failure'` for a failed run ({@link StudyService.hasRunFailed})
   * - `'result'` for a completed runtime whose final save settled, also while the service already cleans the completed run up
   * - `'stopped'` for a run that is being stopped or was cancelled ({@link StudyService.isRunBeingStopped})
   * - `undefined` while the run is still on its way, and while a completed runtime's final save is under way ({@link StudyRuntime.isSavingCompletion})
   * @example this.endedRunState(record, runtime, 'completed') // => 'result'
   */
  private endedRunState(
    record: StudyRecord,
    runtime: RuntimeView | undefined,
    status: RuntimeView['status'] | undefined,
  ): 'failure' | 'stopped' | 'result' | undefined {
    if (this.hasRunFailed(record, runtime, status)) return 'failure'
    // Before the stop check: the service cleans a completed run up by itself, and that cleanup is no stop of the run. A completion whose final save is under way is no result yet: a failed save fails the run (Cycle 0047 row 241).
    if (status === 'completed')
      return record.runtime?.isSavingCompletion?.() ? undefined : 'result'
    return this.isRunBeingStopped(record, status) ? 'stopped' : undefined
  }

  /**
   * Says whether a continued run failed, for the first check of {@link StudyService.endedRunState}.
   * @param record - The run that was continued.
   * @param runtime - The runtime's view read at this turn; `undefined` for a run without a runtime.
   * @param status - The status of that view; `undefined` without a runtime.
   * @returns `true` once the run has an error (the passed whole-run deadline among them), the runtime lists a failure, its evidence failed, or its status is `failed`; `false` otherwise.
   * @example this.hasRunFailed(record, runtime, 'failed') // => true
   */
  private hasRunFailed(
    record: StudyRecord,
    runtime: RuntimeView | undefined,
    status: RuntimeView['status'] | undefined,
  ): boolean {
    return (
      Boolean(
        record.error ||
        runtime?.failures.length ||
        record.runtime?.evidence.failure,
      ) || status === 'failed'
    )
  }

  /**
   * Says whether a run that did not complete is being stopped, for the last check of {@link StudyService.endedRunState}.
   * @param record - The run that was continued.
   * @param status - The status of the runtime's view; `undefined` without a runtime.
   * @returns `true` while the service is shutting down, while the run is being stopped or once it is stopped, and for a cancelled runtime; `false` otherwise.
   * @example this.isRunBeingStopped(record, 'cancelled') // => true
   */
  private isRunBeingStopped(
    record: StudyRecord,
    status: RuntimeView['status'] | undefined,
  ): boolean {
    return (
      this.stopping ||
      record.stopping ||
      record.stopped ||
      status === 'cancelled'
    )
  }

  /**
   * Names the next observation of a continued run that has not ended; the second half of {@link StudyService.nextRunState}.
   * @param runtime - The runtime's view read at this turn; `undefined` for a run without a runtime.
   * @param committedBefore - The ids of the snapshots committed before the continuation.
   * @returns `'observation'` once a participant is paused at a snapshot committed after the continuation, otherwise `undefined`.
   * @example this.nextObservationState(runtime, new Set(['browser-session:1'])) // => 'observation' once browser-session:2 is committed and paused
   */
  private nextObservationState(
    runtime: RuntimeView | undefined,
    committedBefore: ReadonlySet<string>,
  ): 'observation' | undefined {
    const isAtNextObservation = Object.values(runtime?.participants ?? {}).some(
      (participant) =>
        participant.snapshot !== undefined &&
        !committedBefore.has(participant.snapshot.id) &&
        isPausedAtSnapshot(participant, participant.snapshot),
    )
    return isAtNextObservation ? 'observation' : undefined
  }

  /**
   * Continues the current pause through the runtime's atomic pause reservation, never a focused debug session, and answers once the continuation is acknowledged; called by {@link StudyService.continueToNextState} for the tool and by the Study pane's Continue.
   * `answer` in the arguments is not read here: the pane sends the run resource's arguments as they are and needs the acknowledgement only.
   * @example await service.continue(runState.participants.server.continueArguments)
   */
  async continue(input: ContinueInput) {
    this.assertMutable(input.instanceId)
    const record = this.record(input)
    this.presentationController?.assertPresentationIdle()
    if (isNodeServerRecord(record))
      return this.continueNodeServer(record, input)
    if (record.profile === NODE_TEST_PROFILE) {
      const current = record.nodeStops?.at(-1)
      if (
        !record.nodeRun ||
        !current ||
        record.nodePhase !== 'paused' ||
        record.stopping ||
        record.stopped ||
        record.error ||
        record.cleanupError ||
        this.now() >= record.deadlineAt ||
        input.participant !== 'server' ||
        input.sessionId !== current.sessionId ||
        input.threadId !== current.threadId ||
        input.generation !== current.index + 1
      )
        throw new StudyError(
          'STALE_PAUSE',
          'The Node test cannot resume this historical or changed source pause.',
        )
      record.nodePhase = 'advancing'
      const continuation = this.continueNodeTest(record, record.nodeRun)
      // The run owns its continuation: a stop settles it, with its journal writes, before the seal (EN5).
      record.nodeContinuation = continuation.then(
        () => undefined,
        () => undefined,
      )
      await continuation
      return { accepted: true, runUri: this.uri(record.id) }
    }
    // A reveal accepted for this pause finishes first: resuming under it would retire the pause its reader is still presenting.
    if (record.sourceReveals.size)
      await Promise.allSettled([...record.sourceReveals])
    if (
      !record.runtime ||
      record.stopping ||
      record.stopped ||
      record.error ||
      record.cleanupError ||
      record.runtime.evidence.failure ||
      this.now() >= record.deadlineAt
    )
      throw new StudyError(
        'STALE_PAUSE',
        'The run cannot resume this historical pause.',
      )
    try {
      await record.runtime.continue(input.participant, {
        sessionId: input.sessionId,
        threadId: input.threadId,
        generation: input.generation,
      })
    } catch (error) {
      if (error instanceof StudyError) throw error
      throw new StudyError(
        String(error).includes('conflict:') ? 'STALE_PAUSE' : 'RUNTIME_FAILED',
        'Continue was not confirmed.',
        this.sanitizedCause(error),
      )
    }
    return { accepted: true, runUri: this.uri(record.id) }
  }

  /**
   * Runs a test run's continuation to its next declared stop or to its result, with the journal entry each writes; called by {@link StudyService.continue}, which keeps the promise on the run so a stop settles it before the seal (EN5).
   * A result whose exit says the test did not pass is recorded even when Vitest's report could not confirm the cited test, and the run's error names the report ({@link OwnedNodeTestRun.complete}); an exit 0 without a confirming report rejects, so no result entry claims a pass nothing confirmed.
   * @param record - The test run.
   * @param run - Its owned Node test runtime.
   * @throws A `STALE_PAUSE` {@link StudyError} when a stop cancelled the continuation, which leaves the run without an error of its own; the run's error, naming its cause, for any other failure, after which the run is stopped.
   * @example await this.continueNodeTest(record, record.nodeRun)
   */
  private async continueNodeTest(
    record: StudyRecord,
    run: NodeTestRuntime,
  ): Promise<void> {
    let refusal: StudyError | undefined
    try {
      if (run.hasNextStop()) {
        const next = await run.advance()
        await record.nodeHistoryWriter?.appendStop(next)
        record.nodeStops?.push(next)
        // A deadline that passed during the advance already marked the test failed: the late stop is journaled, the phase stays (F77).
        if (record.nodePhase === 'advancing') record.nodePhase = 'paused'
        // Only a run that stays paused at the stop can tell the agent to continue without the fact; a deadline that failed it, or a stop under way, speaks through the run resource.
        if (
          record.nodePhase === 'paused' &&
          !record.stopping &&
          !record.stopped
        )
          refusal = this.unreadRequiredFactsRefusal(record, next)
      } else await this.completeNodeTest(record, run)
    } catch (error) {
      // A stop cancelled this continuation: the run ends as stopped, without an error of its own.
      if (record.stopping || record.stopped)
        throw new StudyError(
          'STALE_PAUSE',
          'The run was stopped during this continuation; read the run resource.',
          this.sanitizedCause(error),
        )
      record.error = this.sanitizedError(
        studyErrorNamingCause(domainError(error)),
      )
      record.nodePhase = 'failed'
      queueMicrotask(() => {
        void this.stopRecord(record).catch(() => undefined)
      })
      throw record.error
    }
    // The stop is kept and the run stays paused there with its other facts; only this continuation is refused, so the agent can go on without the fact (Cycle 0052 task 5, O4).
    if (refusal) throw refusal
  }

  /**
   * Lists the required facts a journaled test stop lacks, as `<mode>:<path>`: the required inspections declared for that stop with no fact of theirs, which the debugger could not read; called by {@link StudyService.unreadRequiredFactsRefusal} and {@link StudyService.sealNodeHistory}.
   * @param record - The Node test run.
   * @param stop - One of its stops.
   * @returns The unread facts in declaration order; none for a run without a prepared configuration.
   * @example this.unreadRequiredFacts(record, stop) // => ['value:revalidatePath.mock.calls.length']
   */
  private unreadRequiredFacts(
    record: StudyRecord,
    stop: NodeTestSourceStop,
  ): string[] {
    const configuration = record.nodePrepared?.configuration
    if (!configuration) return []
    const declared = [
      configuration.inspections,
      ...(configuration.additionalStops ?? []).map(
        (additional) => additional.inspections,
      ),
    ][stop.index]
    return (declared ?? [])
      .filter(
        (inspection) =>
          inspection.required &&
          !stop.facts.some(
            (fact) =>
              fact.path === inspection.path && fact.mode === inspection.mode,
          ),
      )
      .map((inspection) => `${inspection.mode}:${inspection.path}`)
  }

  /**
   * Words the refusal of a Node test continuation that reached a stop whose required facts the debugger could not read, so the agent, or the learner who pressed Continue in the Study pane, learns which fact is missing while the run stays paused at that stop (Cycle 0052 task 5, O4: MCP 1.8's error codes, no schema change; task 73: no agent-only words, since the Study pane shows the same line); called by {@link StudyService.continueNodeTest} after the stop is journaled.
   * @param record - The Node test run.
   * @param stop - The stop the continuation reached.
   * @returns An `EVIDENCE_UNAVAILABLE` {@link StudyError} naming each required `<mode>:<path>` the stop lacks, or `undefined` when it has them all.
   * @example this.unreadRequiredFactsRefusal(record, stop)?.message // => 'The continuation reached the stop at app/lib/actions.ts:131, but the debugger could not read its required fact value:revalidatePath.mock.calls.length. …'
   */
  private unreadRequiredFactsRefusal(
    record: StudyRecord,
    stop: NodeTestSourceStop,
  ): StudyError | undefined {
    const missing = this.unreadRequiredFacts(record, stop)
    if (missing.length === 0) return undefined
    const named = missing.join(', ')
    return new StudyError(
      'EVIDENCE_UNAVAILABLE',
      `The continuation reached the stop at ${stop.source.path}:${stop.frame.line}, but the debugger could not read its required ${missing.length === 1 ? 'fact' : 'facts'} ${named}. The run stays paused at this stop with its other facts: continue without ${missing.length === 1 ? 'it' : 'them'}, or stop the run.`,
    )
  }

  /**
   * Runs a Node test to its end after its last declared stop and journals the result; called by {@link StudyService.continueNodeTest} for the final continuation.
   * @param record - The Node test run.
   * @param run - Its owned runtime.
   * @example await this.completeNodeTest(record, run)
   */
  private async completeNodeTest(
    record: StudyRecord,
    run: NodeTestRuntime,
  ): Promise<void> {
    const result = await run.complete()
    record.nodeResult = result
    await record.nodeHistoryWriter?.appendResult(result, result.elapsedMs)
    // The same for a result that arrives after the deadline's failure (F77).
    if (record.nodePhase === 'advancing') record.nodePhase = 'completed'
    // The exit already says the test did not pass; the run's error names why Vitest's report could not confirm the cited test.
    if (result.reportFailure !== undefined) {
      record.error = this.sanitizedError(
        new StudyError(
          'RUNTIME_FAILED',
          `${describeNodeTestResult(result)}, and Vitest's test report could not confirm the cited test: ${result.reportFailure}`,
        ),
      )
      queueMicrotask(() => {
        void this.stopRecord(record).catch(() => undefined)
      })
    }
  }

  /** Stops a run through its shared cleanup barrier; historical resources remain available. @example await service.stop({instanceId,runId}) */
  async stop(input: RunInput) {
    const record = this.record(input)
    await this.stopRecord(record)
    return this.state(record)
  }

  /**
   * Stops a run for the `codebook_stop` tool and tells the tool whether the run's history could not be sealed, so the agent never reads a failed seal as a successful stop (X1); the status item's Save calls {@link StudyService.stop} instead and keeps its own paths.
   * A repeated stop of the same run answers the same without a second seal: the run keeps its seal's failure.
   * @param input - The run's identity.
   * @returns The run's state, and the `HISTORY_SEAL_FAILED` error when a history existed and its seal (a test journal's, a browser recording's finish or read-back) failed.
   * @throws What {@link StudyService.stop} throws for a release that failed.
   * @example
   * const { state, sealFailure } = await service.stopForTool({ instanceId, runId })
   * sealFailure?.code // => 'HISTORY_SEAL_FAILED' after a full disk at the seal
   */
  async stopForTool(input: RunInput): Promise<{
    state: ReturnType<StudyService['state']>
    sealFailure?: StudyError
  }> {
    const record = this.record(input)
    await this.stopRecord(record)
    const state = this.state(record)
    const sealFailure = this.sealFailure(record, state.finalOutcome)
    return sealFailure ? { state, sealFailure } : { state }
  }

  /**
   * Makes the `HISTORY_SEAL_FAILED` error of a stopped run whose existing history could not be sealed; read by {@link StudyService.stopForTool}.
   * Never for a run without a history, a browser recording that failed before input, or a study the learner removed.
   * @param record - The stopped run.
   * @param finalOutcome - The run's runtime outcome, named for a run without a test result.
   * @returns The error with the run, its result or outcome and the stops reached, and the sanitized cause cut for display; `undefined` for a run whose history sealed.
   * @example this.sealFailure(record, 'demonstrated')?.message // => 'codebook_stop released run 5d… (Test passed · exit code 0, 2 of 2 stops reached) but could not seal its history.'
   */
  private sealFailure(
    record: StudyRecord,
    finalOutcome: string,
  ): StudyError | undefined {
    const failure =
      record.profile === NODE_TEST_PROFILE
        ? record.nodeHistoryStatus === 'failed'
          ? record.nodeHistoryFailure
          : undefined
        : isStudyRemovalExclusion(record.historyExcluded)
          ? undefined
          : record.recordingSealFailure
    if (failure === undefined) return undefined
    const reached =
      record.profile === NODE_TEST_PROFILE
        ? (record.nodeStops?.length ?? 0)
        : (record.runtime?.view().snapshots.length ?? 0)
    const declared =
      record.profile === NODE_TEST_PROFILE
        ? 1 + (record.nodePrepared?.configuration.additionalStops?.length ?? 0)
        : record.definition
          ? configuredStops(record.definition.configuration).length
          : reached
    const outcome = record.nodeResult
      ? describeNodeTestResult(record.nodeResult)
      : finalOutcome
    return new StudyError(
      'HISTORY_SEAL_FAILED',
      `codebook_stop released run ${record.id} (${outcome}, ${reached} of ${declared} stops reached) but could not seal its history.`,
      cutCauseForDisplay(failure),
    )
  }

  /**
   * Commits a labeled interpretation of one committed snapshot only after the referenced evidence and the atomic write succeed; called by the `codebook_explain` tool.
   * A value path sent without its `value:` or `type:` prefix is saved under the one captured key that has it ({@link resolveCapturedFactPaths}). The first explanation of a stop the debugger bound on another line than declared is refused once when its interpretation lacks the paused line's number ({@link namesLineNumber}); that check is a bounded guard on prose and no proof of the place, which is why every explanation of such a stop is saved with Codebook's own {@link Explanation.boundPlace}.
   * @param input - The run, an explanation key, the snapshot URI with its TypeScript hash, the captured fact paths and the interpretation, optionally with a complete learning summary.
   * @returns The explanation's resource URI and the captured keys it was saved under; a repeated key with the same content returns the first receipt.
   * @throws An `INVALID_REFERENCE` {@link StudyError} for an unknown snapshot, a wrong hash, an uncaptured or ambiguous path, an unverified summary reference, and once for a moved stop whose first interpretation does not name the paused line; `IDEMPOTENCY_CONFLICT` for a key that names other content; `BUSY` during cleanup or a removal; `EVIDENCE_UNAVAILABLE` for a new key of a stopped run whose evidence failed ({@link failedEvidenceAdvice}), before the key is reserved; `LIMIT_EXCEEDED` past the explanation limit.
   * @example await service.explain({...run, snapshotUri, sourceHash, valuePaths:['value:price'], interpretation:'Price is 24.', key:'explain-1'})
   */
  explain(input: ExplainInput): Promise<ExplanationReceipt> {
    this.assertMutable(input.instanceId)
    const record = this.record(input)
    // An explanation after the removal would be written into a directory that is in the Trash.
    this.assertEvidenceAvailable(record)
    // Internal callers must satisfy the same fact bounds as MCP before reserving or persisting an explanation.
    if (!explainSchema.shape.valuePaths.safeParse(input.valuePaths).success)
      throw new StudyError(
        'INVALID_REFERENCE',
        'Select at least one captured value path within the explanation limits.',
      )
    const learningSummary =
      input.learningSummary &&
      learningSummarySchema.parse(input.learningSummary)
    const snapshot = this.snapshot(record, input.snapshotUri)
    // A path sent without its value: or type: prefix is saved under the one captured key that has it; the signature holds the keys as saved, so a retry in either spelling names the same content.
    const { paths: valuePaths, rewritten: rewrittenPaths } =
      resolveCapturedFactPaths(input.valuePaths, snapshot.values)
    const signature = JSON.stringify([
      input.snapshotUri,
      input.sourceHash,
      valuePaths,
      input.interpretation,
      learningSummary,
    ])
    const previous = record.explanationKeys.get(input.key)
    if (previous) {
      if (previous.signature !== signature)
        throw new StudyError(
          'IDEMPOTENCY_CONFLICT',
          'Explanation key already names different content.',
        )
      return previous.result
    }
    if (record.stopping)
      throw new StudyError(
        'BUSY',
        'Wait for owned cleanup before adding historical explanations.',
      )
    if (record.evidenceHolds)
      throw new StudyError(
        'BUSY',
        "The learner is deleting this run's saved study; wait for it to finish.",
      )
    if (
      snapshotSourceHashes(snapshot).typescript !== input.sourceHash ||
      new Set(valuePaths).size !== valuePaths.length
    )
      throw new StudyError(
        'INVALID_REFERENCE',
        'Source hash or distinct value paths do not match the snapshot.',
      )
    const evidenceFailure = this.stoppedRunEvidenceFailure(record)
    // A stopped run's failed evidence fails every later write: the refusal comes before a key is reserved, so the budget is not spent on it.
    if (evidenceFailure !== undefined)
      throw new StudyError(
        'EVIDENCE_UNAVAILABLE',
        failedEvidenceAdvice(evidenceFailure),
      )
    if (record.explanationKeys.size >= MAX_EXPLANATIONS)
      throw new StudyError(
        'LIMIT_EXCEEDED',
        `The run's explanation budget (${MAX_EXPLANATIONS} keys) is spent; Codebook accepts no new explanation key for this run, and a key it already accepted answers its receipt again.`,
      )
    // Every diagram link is bound to this run's committed source; prose classifications remain agent-authored claims.
    for (const step of learningSummary?.steps ?? []) {
      if (!step.reference) continue
      if ('snapshotUri' in step.reference) {
        const referenced = this.snapshot(record, step.reference.snapshotUri)
        if (
          snapshotSourceHashes(referenced).typescript !==
          step.reference.sourceHash
        )
          throw new StudyError(
            'INVALID_REFERENCE',
            'Learning step source hash does not match its recorded snapshot.',
          )
        continue
      }
      const runtime = record.runtime?.view()
      if (
        step.evidence !== 'observed' ||
        !record.stopped ||
        runtime?.finalOutcome !== 'demonstrated' ||
        !runtime.operation?.afterVerified ||
        !runtime.operation.inputAcknowledged ||
        step.reference.configurationHash !==
          record.definition?.configurationHash ||
        runtime.captures.after?.status !== 'captured' ||
        step.reference.captureHash !== runtime.captures.after.renderer?.hash
      )
        throw new StudyError(
          'INVALID_REFERENCE',
          'Learning result requires this run’s verified after frame.',
        )
    }
    const captured = new Map<string, ConfiguredFactValue>(
      Object.entries(snapshot.values),
    )
    const capturedFacts = valuePaths.map((path) => {
      const value = captured.get(path)
      if (value === undefined)
        throw new StudyError(
          'INVALID_REFERENCE',
          `The selected snapshot did not capture ${path}.`,
        )
      return { path, value }
    })
    // Codebook's own place of a moved stop is saved with every explanation of it, whatever the interpretation says.
    const movedPlace = explanationPlace(
        this.boundPlace(record, snapshot, false),
      ),
      placeGuard = record.placeGuards.get(snapshot.id)
    // Only the first explanation of a moved stop is checked: a later one (the one after the result) is about something else.
    const placeNamed =
      movedPlace && placeGuard !== 'explained'
        ? namesLineNumber(input.interpretation, movedPlace.boundLine)
        : undefined
    // The last check before the key is reserved, so the one refusal is never spent on a call that is invalid for another reason.
    if (movedPlace && placeNamed === false && placeGuard !== 'refused') {
      record.placeGuards.set(snapshot.id, 'refused')
      throw new StudyError(
        'INVALID_REFERENCE',
        `This stop paused on line ${movedPlace.boundLine} of ${movedPlace.path}; you declared line ${movedPlace.declaredLine}. Name line ${movedPlace.boundLine} as the place of the pause in the interpretation and send codebook_explain again; the same key is free.`,
      )
    }
    if (movedPlace) record.placeGuards.set(snapshot.id, 'explained')
    const explanation: Explanation = {
      id: randomUUID(),
      instanceId: this.instanceId,
      runId: record.id,
      snapshotUri: input.snapshotUri,
      sourceHash: input.sourceHash,
      capturedFacts,
      ...(movedPlace && { boundPlace: movedPlace }),
      learningSummary,
      agentInterpretation: input.interpretation,
      createdAt: new Date(this.now()).toISOString(),
      learnerUnderstandingChanged: false,
    }
    // Reserve before the first await; write latency must not permit duplicate explanations.
    const result = Promise.resolve().then(async () => {
      try {
        await record.runtime!.evidence.flush()
        await record.runtime!.evidence.save(
          `agent-explanation-${explanation.id}.json`,
          explanation,
        )
        record.runtime!.evidence.record('agent.explanation-saved', {
          id: explanation.id,
          snapshotId: snapshot.id,
          // Recorded for the first saved explanation of a moved stop only: whether its interpretation holds the paused line's number.
          ...(placeNamed !== undefined && { placeNamed }),
          // Every path the agent sent without its prefix, with the captured key it was saved under.
          ...(rewrittenPaths.length > 0 && { rewrittenPaths }),
        })
        await record.runtime!.evidence.flush()
        record.explanations.set(explanation.id, explanation)
        return {
          explanationUri: this.uri(record.id, `explanations/${explanation.id}`),
          valuePaths,
        }
      } catch (error) {
        throw this.explanationFailure(record, error)
      }
    })
    const accepted: NonNullable<
      ReturnType<StudyRecord['explanationKeys']['get']>
    > = { signature, result, isSavingLearningSummary: Boolean(learningSummary) }
    record.explanationKeys.set(input.key, accepted)
    // Saved or failed, the key's explanation is no longer being written.
    const saveEnded = (): void => {
      accepted.isSavingLearningSummary = false
    }
    void result.then(saveEnded, saveEnded)
    return result
  }

  /**
   * Gives the failure of a stopped run's evidence, which refuses every further explanation of the run: the evidence keeps its first failure, so a later write fails at the same failure ({@link Evidence.flush}); read by {@link StudyService.explain} before it reserves a key and by {@link StudyService.state} for the run resource's advice.
   * @param record - The run.
   * @returns
   * - The evidence's failure for a stopped run whose evidence failed, at its stop or after it (an explanation's save after the result)
   * - `undefined` for a run that has not stopped, has no runtime, or whose evidence writes
   * @example this.stoppedRunEvidenceFailure(stoppedRecord) // => 'Error: ENOSPC: no space left on device, write' after a learning summary's save failed on a full disk
   */
  private stoppedRunEvidenceFailure(record: StudyRecord): string | undefined {
    return record.stopped ? record.runtime?.evidence.failure : undefined
  }

  /**
   * Names and journals an explanation whose save failed, for the agent's `codebook_explain` answer; called by {@link StudyService.explain} when the explanation's evidence write or flush rejected.
   * A running run fails with the write: its error is the explanation's, and its runtime journals that as `run.failed`, as every other failure path of a run does (Cycle 0046 row 665). A run that already stopped keeps its outcome and terminal reason: an explanation accepted after the end (a learning summary saved after the result) is no part of the run, and a stopped runtime's `fail` journals nothing (`ConfiguredBrowserRun.fail` returns at once while it cleans up), so the failure is journaled as `explanation.failed` instead, past a refusal of the evidence too ({@link Evidence.recordFailure}); a `run.failed` after the end would read as the end of a failed run (row 699). A removed study's write names its removal, not the storage path ({@link StudyService.evidenceFailureCause}).
   * @param record - The run the explanation belongs to.
   * @param error - What the save rejected with.
   * @returns The `EVIDENCE_UNAVAILABLE` error the explanation is refused with, whose message names the cause.
   * @example
   * throw this.explanationFailure(stoppedRecord, new Error('ENOSPC: no space left on device, write'))
   * // the run's journal ends with explanation.failed "Explanation was not committed. Cause: ENOSPC: no space left on device, write"; its outcome is as it was
   */
  private explanationFailure(record: StudyRecord, error: unknown): StudyError {
    const message = 'Explanation was not committed.',
      failure = this.writeFailureError(record, message, String(error))
    // A run that ended keeps its outcome; its journal keeps the failure as an event of its own (row 699).
    if (record.stopped) {
      record.runtime!.evidence.recordFailure(
        failure.message,
        'explanation.failed',
      )
      return failure
    }
    record.error = failure
    // A study found removed later words this error by its removal (row 700).
    record.errorSource = {
      kind: 'write',
      message,
      failure: this.sanitizedCause(error),
    }
    // The run fails with the write: its runtime journals the cause as run.failed, as every other failure path of a run does (Cycle 0046 row 665).
    record.runtime!.fail(record.error.message)
    return failure
  }

  /**
   * Makes the error of a failed evidence write, the run's evidence failure at the maintenance turn or an explanation's save, whose message names its cause; called by {@link StudyService.maintain}, by {@link StudyService.explanationFailure} and, once the study turns out removed, by {@link StudyService.wordFailuresByRemoval}, so each words the same failure the same way.
   * The cause is the write's own failure without its private paths ({@link sanitizeCause}: a write error names the evidence file under the storage folder, F256), or the removal's sentence for a run whose saved study was removed ({@link StudyService.evidenceFailureCause}, rows 667 and 700).
   * @param record - The run whose write failed.
   * @param message - What failed: `'Evidence buffering or persistence failed.'` or `'Explanation was not committed.'`.
   * @param failure - The write's failure, raw or already sanitized.
   * @returns An `EVIDENCE_UNAVAILABLE` {@link StudyError} whose message names its cause ({@link studyErrorNamingCause}).
   * @example
   * this.writeFailureError(record, 'Evidence buffering or persistence failed.', 'Error: ENOSPC: no space left on device, write').message
   * // => 'Evidence buffering or persistence failed. Cause: ENOSPC: no space left on device, write'
   */
  private writeFailureError(
    record: StudyRecord,
    message: string,
    failure: string,
  ): StudyError {
    return studyErrorNamingCause(
      new StudyError(
        'EVIDENCE_UNAVAILABLE',
        message,
        this.evidenceFailureCause(record, this.sanitizedCause(failure)),
      ),
    )
  }

  /** Commits editor-agent learning after MCP submits it, binding every sequence link to the selected sealed Node journal.
   * @param input - Workspace-owned history identity, optimistic revision and authored learning content.
   * @returns The newly saved revision and content.
   * @throws When storage is missing, the expected revision is stale or a sequence reference does not match the journal.
   * @example await service.explainNodeHistory({ studyId, expectedRevision: 0, content })
   */
  async explainNodeHistory(input: ExplainNodeHistoryInput) {
    this.assertMutable(this.instanceId)
    const parsed = explainNodeHistorySchema.parse(input)
    if (!this.nodeHistoryStore)
      throw new StudyError(
        'PREREQUISITE_MISSING',
        'Workspace-bound Node history storage is unavailable.',
      )
    const store = this.nodeHistoryStore
    try {
      // An unknown id, or a history removed while it is saved, is a reference to correct, as at the history's resources (Cycle 0052 tasks 60, 75).
      const material = await withKnownNodeHistory(store, parsed.studyId, () =>
        store.saveLearningMaterial(
          parsed.studyId,
          parsed.expectedRevision,
          parsed.content,
        ),
      )
      await this.cacheNodeLearning(parsed.studyId, material)
      this.presentationController?.nodeHistoryLearningMaterialSaved(
        parsed.studyId,
        material,
      )
      return material
    } catch (error) {
      if (error instanceof NodeLearningRevisionChangedError)
        throw new StudyError(
          'IDEMPOTENCY_CONFLICT',
          'Node learning material changed; read the latest material and retry with its revision.',
          String(error),
        )
      // A step that cites another event is the store's own INVALID_REFERENCE, which names the step and the event (X19).
      throw error
    }
  }

  /**
   * Keeps the material this window saved for a test run's history on the run, and counts the run's learning coverage again once its history is sealed, so the run resource reads the coverage of its own window's latest material without a store read (EN2); called by {@link StudyService.explainNodeHistory} after the store saved it.
   * A seal whose summary read failed for a transient reason (too many open files, a busy file) left the run's capture gaps unknown; this save reads them again, so the agent's claim rule can be checked once the storage recovers (F252).
   * @param studyId - The history the material explains.
   * @param material - The saved material, with its revision.
   * @example await this.cacheNodeLearning(studyId, material)
   */
  private async cacheNodeLearning(
    studyId: string,
    material: { revision: number; content: NodeTestLearningMaterialContent },
  ): Promise<void> {
    const record = [...this.records.values()].find(
      (candidate) => `${this.instanceId}_${candidate.id}` === studyId,
    )
    if (!record) return
    record.nodeLearningMaterial = {
      revision: material.revision,
      content: material.content,
    }
    // Before the seal the needs are not final; the seal counts this material then.
    if (!record.nodeLearning) return
    const captureMissing =
      record.nodeLearning.captureMissing ??
      (await this.captureMissingOf(studyId))
    // The material this window saved last, which a later save may have replaced during the read.
    record.nodeLearning = this.nodeLearningOf(
      record.nodeLearning.needs,
      record.nodeLearningMaterial,
      captureMissing,
    )
  }

  /** Reveals only the source bound to a committed snapshot; the editor adapter checks file/document hashes. @example await service.reveal({...run, snapshotUri}) */
  async reveal(input: RevealInput) {
    this.assertMutable(input.instanceId)
    const record = this.record(input)
    const snapshot = this.snapshot(record, input.snapshotUri)
    this.presentationController?.assertPresentationIdle()
    if (
      record.stopping ||
      record.stopped ||
      record.error ||
      record.runtime!.evidence.failure ||
      ['failed', 'cancelled', 'completed'].includes(
        record.runtime!.view().status,
      )
    )
      throw new StudyError(
        'BUSY',
        'Source reveal requires an active run. Read the captured source resource after cleanup.',
      )
    const isCurrentPause = (): boolean =>
      Object.values(record.runtime!.view().participants).some((participant) =>
        isPausedAtSnapshot(participant, snapshot),
      )
    const noLongerCurrentPause = (cause?: unknown): StudyError =>
      new StudyError(
        'STALE_PAUSE',
        'Reveal shows only the current pause, and this snapshot is no longer it: its continuation was accepted or the debugger moved on. Reveal a stop before continuing it; its captured source stays readable at sourceUri.',
        cause === undefined ? undefined : String(cause),
      )
    // The reader presents only the live pause; a snapshot already continued would otherwise answer an evidence failure.
    if (!isCurrentPause()) throw noLongerCurrentPause()
    // Reserve before editor I/O; stop must not finish while a source tab can still be acquired.
    const pending = Promise.resolve().then(() =>
      record.runtime!.reveal(snapshot),
    )
    record.sourceReveals.add(pending)
    try {
      await pending
    } catch (error) {
      // A pause that ended while the reader was presenting it (a manual resume) is the cause, whatever the reader reported.
      if (!isCurrentPause()) throw noLongerCurrentPause(error)
      throw error
    } finally {
      record.sourceReveals.delete(pending)
    }
    return {
      revealed: true,
      snapshotUri: input.snapshotUri,
      sourceUri: `${input.snapshotUri}/source/typescript`,
      line: snapshot.source.line,
    }
  }

  /** Validates explicit instance/run identity for both control and history reads. @example service.record({instanceId,runId}) */
  record(input: RunInput): StudyRecord {
    this.assertInstance(input.instanceId)
    const record = this.records.get(input.runId)
    if (!record)
      throw new StudyError(
        'NOT_FOUND',
        'No run with that identity exists in this instance.',
      )
    return record
  }

  /** Builds canonical opaque references; caller-provided file paths never enter this API. @example service.uri(runId, 'events/0') */
  uri(runId: string, suffix?: string): string {
    return `codebook://${this.instanceId}/runs/${runId}${suffix ? `/${suffix}` : ''}`
  }

  /** Resolves committed snapshot identity without treating an old capture as a current pause. @example service.snapshot(record, snapshotUri).values */
  snapshot(record: StudyRecord, uri: string): RuntimeSnapshot {
    if (record.profile === NODE_TEST_PROFILE)
      throw new StudyError(
        'EVIDENCE_UNAVAILABLE',
        'Node test stops are saved in their durable history instead: read nodeTest.historyUri and its events, then save learning through codebook_explain_node_history.',
      )
    if (record.profile === NODE_SERVER_PROFILE)
      throw new StudyError(
        'EVIDENCE_UNAVAILABLE',
        'Server stops are explained in the chat: read nodeServer.pause in the run resource (path, line, source hash and the captured facts) and the native debugger, then continue with participants.server.continueArguments. codebook_explain and codebook_reveal take only a repository-browser snapshot, and server runs are not saved yet.',
      )
    const runtime = record.runtime?.view()
    for (const snapshot of runtime?.snapshots ?? []) {
      if (
        snapshot &&
        uri ===
          this.uri(record.id, `snapshots/${encodeURIComponent(snapshot.id)}`)
      )
        return snapshot
    }
    throw new StudyError(
      'INVALID_REFERENCE',
      'Snapshot is absent, uncommitted, or belongs to another run.',
    )
  }

  /**
   * Gives the declared, requested and bound places of a committed snapshot's stop from the run itself, so every text and field about a moved stop has one source; called by {@link readResource} for the inspection resource, by {@link StudyService.state} for the run resource's observation entries and by {@link StudyService.explain} for its check and the place it saves.
   * @param record - The run the snapshot belongs to.
   * @param snapshot - A committed snapshot of that run.
   * @param readsJournal - Whether the requested place and the time the binding became known are read from the run's journal ({@link journaledBindingOfSnapshot}); a caller that needs only the lines or the sentence passes `false`.
   * @returns
   * - The places, with `place` (the sentence) only for a stop the debugger bound on another line than declared
   * - `undefined` when the run has no frozen definition or no stop is declared for the snapshot
   * @example
   * service.boundPlace(record, snapshot)?.place // => 'src/theme.ts: this stop paused on line 2, column 1. You declared line 1 (configuration.source); ...'
   * service.boundPlace(record, snapshot)?.armed // => { line: 2, column: 1 } for a stop declared on an unmapped line 1
   */
  boundPlace(
    record: StudyRecord,
    snapshot: RuntimeSnapshot,
    readsJournal = true,
  ): BoundPlace | undefined {
    const runtime = record.runtime?.view()
    if (!record.definition || !runtime) return undefined
    const declared = declaredStopOfSnapshot(
      record.definition.configuration,
      runtime.snapshots,
      snapshot.id,
    )
    if (!declared) return undefined
    return describeBoundPlace({
      declared,
      bound: { line: snapshot.source.line, column: snapshot.source.column },
      ...this.journaledBinding(runtime, snapshot.id, readsJournal),
    })
  }

  /**
   * Reads what the run's journal says about a stop's binding, for {@link StudyService.boundPlace} to add to the places it describes; a caller that needs only the lines or the sentence has the journal left unread.
   * @param runtime - The view of the run the snapshot belongs to.
   * @param snapshotId - The committed snapshot of the stop.
   * @param readsJournal - Whether the journal is read at all.
   * @returns What {@link journaledBindingOfSnapshot} gives (the requested place and the time the binding became known, as far as journaled); `false` when the journal is not read.
   * @example this.journaledBinding(runtime, 'browser-session:1', false) // => false
   */
  private journaledBinding(
    runtime: RuntimeView,
    snapshotId: string,
    readsJournal: boolean,
  ) {
    return (
      readsJournal &&
      journaledBindingOfSnapshot(runtime.events, runtime.snapshots, snapshotId)
    )
  }

  /** Reserves a monotonic reader checkpoint before I/O so even same-material retries cannot accept an older completion. @example const revision = service.beginHistory(record, signature) */
  beginHistory(record: StudyRecord, signature: string): number | undefined {
    if (this.holdsNoStudyHistory(record)) return undefined
    if (
      this.records.get(record.id) !== record ||
      this.state(record).materialSignature !== signature
    )
      return undefined
    const revision = (record.historyReceipt?.revision ?? 0) + 1
    record.historyReceipt = { revision, signature, status: 'pending' }
    return revision
  }

  /** Says whether a run is no checkpoint candidate: a Node test run keeps its own journal, and an excluded run was refused, removed or is still awaiting admission. @example this.holdsNoStudyHistory(record) // => true for a refused run */
  private holdsNoStudyHistory(record: StudyRecord): boolean {
    return (
      record.profile === NODE_TEST_PROFILE ||
      record.profile === NODE_SERVER_PROFILE ||
      historyExclusionState(record.historyExcluded) !== 'kept'
    )
  }

  /**
   * Ends a retained run's history after its saved study was removed, so the reader stops checkpointing it and {@link StudyService.state} stops reporting saved history; called by {@link StudyWorkspace} once a removal has moved something to the system Trash, and when Retry storage / refresh finds that the study's archive left the library without such a removal.
   * A record this service no longer retains is left alone.
   * @param record - The run whose study was removed; the removal exclusions are the only ones set outside preparation.
   * @param exclusion - How the study was removed, which decides the sentence an agent reads for the run: by this window's delete unless the caller says that the archive was removed outside it.
   * @example
   * service.excludeHistory(record)
   * service.beginHistory(record, service.state(record).materialSignature) // => undefined
   * service.excludeHistory(record, 'archive-removed') // the run's reason names the archive, not the Trash
   */
  excludeHistory(
    record: StudyRecord,
    exclusion: StudyRemovalExclusion = 'removed-by-learner',
  ): void {
    if (this.records.get(record.id) !== record) return
    record.historyExcluded = exclusion
    this.wordFailuresByRemoval(record)
  }

  /**
   * Words the run's error and the failure of its release again once its saved study turns out removed, for {@link StudyService.excludeHistory}: a removal by hand or by another window is found only at the learner's next Retry storage or refresh, usually after the run's next evidence write already failed with ENOENT on its gone directory, the maintenance turn made that raw error the run's error, which the run resource, the status resource and every caller read, and the release failed on its final write too. Built again with the exclusion set, the errors name the failed write and the removal ({@link StudyService.writeFailureError}, {@link StudyService.releaseFailure}) as when the exclusion came first (rows 667 and 686), not the internal storage path (Cycle 0046 row 700). The `run.failed` the runtime journaled stays; a removed study's events are no longer served ({@link StudyService.assertEvidenceAvailable}).
   * @param record - The run whose study was removed.
   * @example this.wordFailuresByRemoval(record) // record.error.message => "Evidence buffering or persistence failed. Cause: The archive of this run's saved study is no longer in the study library: …"
   */
  private wordFailuresByRemoval(record: StudyRecord): void {
    const source = record.errorSource
    // An error a write's raw failure caused is made again, now naming the removal.
    if (source?.kind === 'write')
      record.error = this.writeFailureError(
        record,
        source.message,
        source.failure,
      )
    // A failed release is worded again, and so is the error it gave a run that ended without one.
    if (record.releaseError === undefined) return
    const failure = this.sanitizedFailure(
      this.releaseFailure(record, record.releaseError),
    )
    if (record.cleanupError) record.cleanupError = domainError(failure)
    if (source?.kind === 'release')
      record.error = studyErrorNamingCause(domainError(failure))
  }

  /**
   * Refuses to read or extend the raw evidence of a run whose saved study was removed: the evidence directory went to the system Trash with it, or is among the files a removal by hand takes; called by {@link assertEvidenceReadable} and by {@link StudyService.explain}.
   * The bare run resource stays readable and names the same reason.
   * @param record - The retained run that is being read or explained.
   * @throws An `EVIDENCE_UNAVAILABLE` {@link StudyError} with the sentence of the removal ({@link historyExclusionReason}) for a run whose study was removed either way.
   * @example
   * service.assertEvidenceAvailable(record) // throws after service.excludeHistory(record)
   */
  assertEvidenceAvailable(record: StudyRecord): void {
    if (isStudyRemovalExclusion(record.historyExcluded))
      throw new StudyError(
        'EVIDENCE_UNAVAILABLE',
        historyExclusionReason(record.historyExcluded),
      )
  }

  /**
   * Refuses to read the raw evidence of a run whose saved study was removed or is being removed; called by {@link readResource} before every `/runs/<id>/<suffix>` resource, so a read during the move never ends in a raw file error that names the storage path.
   * @param record - The retained run whose evidence is read.
   * @throws An `EVIDENCE_UNAVAILABLE` {@link StudyError}: the removal sentence after the removal, the in-progress sentence while {@link StudyService.withEvidenceHeld} runs.
   * @example
   * service.assertEvidenceReadable(record) // throws while the reader moves the run's study to the Trash
   */
  assertEvidenceReadable(record: StudyRecord): void {
    this.assertEvidenceAvailable(record)
    // While the evidence directory may be on its way to the Trash, a read would end in a raw file error with the storage path.
    if (record.evidenceHolds)
      throw new StudyError(
        'EVIDENCE_UNAVAILABLE',
        "The learner is deleting this run's saved study; its evidence is unavailable until that ends.",
      )
  }

  /**
   * Runs the removal of a run's saved study while no explanation can be written into its evidence directory; called by {@link StudyWorkspace} around the library removal for a run of this window.
   * It first waits for the explanation writes already accepted and for the evidence queue, so nothing is still on its way when the directory moves; while it runs, {@link StudyService.explain} answers `BUSY`.
   * @param record - The stopped run whose saved study is being removed.
   * @param operation - The removal.
   * @returns The removal's own result.
   * @example
   * await service.withEvidenceHeld(record, () => library.removeStudy(studyId, moveToTrash, evidenceDirectory))
   */
  async withEvidenceHeld<Value>(
    record: StudyRecord,
    operation: () => Promise<Value>,
  ): Promise<Value> {
    // A count, so an overlapping hold does not release the first one's mark.
    record.evidenceHolds = (record.evidenceHolds ?? 0) + 1
    try {
      // A failed explanation or evidence write is that write's own error; it does not stop the removal.
      await Promise.allSettled(
        [...record.explanationKeys.values()].map((accepted) => accepted.result),
      )
      await record.runtime?.evidence.flush().catch(() => undefined)
      return await operation()
    } finally {
      record.evidenceHolds = (record.evidenceHolds ?? 1) - 1
    }
  }

  /** Accepts only the latest reader persistence receipt; stale saves cannot certify newer evidence or retries. @example service.reportHistory(record, signature, revision, 'saved') */
  reportHistory(
    record: StudyRecord,
    signature: string,
    revision: number,
    status: 'pending' | 'saved' | 'failed',
    reason?: string,
  ): boolean {
    if (
      this.records.get(record.id) !== record ||
      record.historyReceipt?.revision !== revision ||
      this.state(record).materialSignature !== signature
    )
      return false
    record.historyReceipt = {
      revision,
      signature,
      status,
      reason: reason?.slice(0, MAX_UI_TEXT_CHARS),
    }
    return true
  }

  /** Saves context only after the matching learner archive; recording failure cannot rewrite its execution/history outcome. @example await service.saveRecordingContext(record, archive, revision) */
  async saveRecordingContext(
    record: StudyRecord,
    archive: RetainedStudy,
    historyRevision: number,
  ): Promise<void> {
    if (
      !this.recordings ||
      !record.recording ||
      this.state(record).materialSignature !== archive.materialSignature ||
      record.historyReceipt?.revision !== historyRevision ||
      record.historyReceipt.status !== 'saved'
    )
      return
    const receipt: NonNullable<StudyRecord['recordingReceipt']> = {
      signature: archive.materialSignature,
      historyRevision,
      status: 'pending',
    }
    record.recordingReceipt = receipt
    try {
      const context = buildRecordingContext(
        archive,
        record.runtime?.view().events ?? [],
        historyRevision,
      )
      const saved = await this.recordings.saveContext(context)
      // A newer history/annotation owns success even when this older filesystem write finishes last.
      if (
        record.recordingReceipt !== receipt ||
        this.state(record).materialSignature !== receipt.signature ||
        record.historyReceipt?.revision !== historyRevision
      )
        return
      record.recordingReceipt = {
        ...receipt,
        status: 'saved',
        contextHash: saved.hash,
        studyHash: context.studyHash,
      }
    } catch (error) {
      if (record.recordingReceipt === receipt)
        record.recordingReceipt = {
          ...receipt,
          status: 'failed',
          reason: this.sanitizedCause(error),
        }
    }
  }

  /**
   * Names the evidence failure that is a failure of the run, for {@link StudyService.state}'s terminal reason and outcome.
   * A write that failed because a removed run's evidence directory went to the Trash is no failure of the run, and its message names the storage path. A write that failed after the run's release ended is none either: the only evidence written then is an explanation accepted after the end (a learning summary saved after the result), whose failure its own answer and its `explanation.failed` event tell ({@link StudyService.explanationFailure}, Cycle 0046 row 699), so a stopped run reads the failure its evidence had when it stopped.
   * @param record - The run.
   * @returns
   * - `undefined` for a removed run's study
   * - For a stopped run: its evidence's failure at the stop, if any
   * - Otherwise: its evidence's failure now, if any
   * @example this.runEvidenceFailure(stoppedRecord) // => undefined after a learning summary's save failed with ENOSPC once the run had stopped
   */
  private runEvidenceFailure(record: StudyRecord): string | undefined {
    if (isStudyRemovalExclusion(record.historyExcluded)) return undefined
    const failure = record.stopped
      ? record.evidenceFailureAtStop
      : record.runtime?.evidence.failure
    return failure === undefined ? undefined : this.sanitizedCause(failure)
  }

  /**
   * Gives the runtime's own first failure for {@link StudyService.state}'s terminal reason, read when the run has no error of its own and no evidence failure of the run: a runtime that failed itself on a failed evidence write (a snapshot's save into the gone directory of a removed study) gives its raw error, and when the run was stopped before a maintenance turn made that the run's error, nothing words it again once the removal is known ({@link StudyService.wordFailuresByRemoval}). For a removed study such a failure names the internal storage path, so it is worded as a failed evidence write with the removal's sentence ({@link StudyService.writeFailureError}), as the run's error is (Cycle 0046 rows 667, 700 and 707); every other failure stays as the runtime gave it.
   * @param record - The run.
   * @param runtime - Its runtime's view read for this state; `undefined` without a runtime.
   * @returns
   * - `undefined` when the runtime reported no failure
   * - For a removed study's failure that names the run's evidence directory: 'Evidence buffering or persistence failed. Cause: ' and the removal's sentence
   * - Otherwise the runtime's first failure
   * @example this.runtimeFailureOf(removedRecord, runtime) // => "Evidence buffering or persistence failed. Cause: The archive of this run's saved study is no longer in the study library: …"
   */
  private runtimeFailureOf(
    record: StudyRecord,
    runtime: RuntimeView | undefined,
  ): string | undefined {
    const failure = runtime?.failures[0]
    // Only a removed study's failure that names its evidence directory is worded again; any other is shown with its private roots replaced (F233).
    if (
      !runtime ||
      failure === undefined ||
      !isStudyRemovalExclusion(record.historyExcluded) ||
      !failure.includes(runtime.artifactDirectory)
    )
      return failure === undefined ? undefined : this.sanitizedCause(failure)
    return this.writeFailureError(
      record,
      'Evidence buffering or persistence failed.',
      failure,
    ).message
  }

  /**
   * Gives the runtime's view as the run resource shows it, with the runtime's outcome beside it; read by {@link StudyService.state} once per state.
   * While a completed run's final save of its events and run record is under way ({@link StudyRuntime.isSavingCompletion}), the completion is no result yet: a failed save fails the run (Cycle 0047 row 197). So the run shows the state it had before its completion (`resuming`, the state of a run after its last continuation), without its runtime outcome and its observed result, until that save settled, as the continuation's answer waits for it ({@link StudyService.endedRunState}, rows 241 and 252). An agent that polls then reads no result that the save can still fail.
   * @param record - The run.
   * @returns The runtime's view (`undefined` without a runtime) and its outcome; during the final save the view says `resuming` and has no `observed`, and the outcome is `undefined`.
   * @example this.shownRuntimeOf(record) // => { runtime: { status: 'resuming', observed: undefined, … }, runtimeOutcome: undefined } while runtime.json of the completed run is written
   */
  private shownRuntimeOf(record: StudyRecord): {
    runtime: RuntimeView | undefined
    runtimeOutcome: RuntimeView['runtimeOutcome'] | undefined
  } {
    const runtime = record.runtime?.view()
    // Only a completion whose final save is under way is held back; any other view is shown as the runtime gives it.
    if (!runtime || !record.runtime?.isSavingCompletion?.())
      return { runtime, runtimeOutcome: runtime?.runtimeOutcome }
    return {
      runtime: { ...runtime, status: 'resuming', observed: undefined },
      runtimeOutcome: undefined,
    }
  }

  /** Projects bounded current state and actionable next steps without copying the full event log; a completed run whose final save is under way shows no result yet ({@link StudyService.shownRuntimeOf}). @example service.state(record).nextActions */
  state(record: StudyRecord) {
    const { runtime, runtimeOutcome } = this.shownRuntimeOf(record)
    const evidenceFailure = this.runEvidenceFailure(record)
    // A runtime failure can quote adapter text of any length; the saved study's reason holds at most MAX_UI_TEXT_CHARS.
    const runtimeFailure = this.runtimeFailureOf(record, runtime)?.slice(
      0,
      MAX_UI_TEXT_CHARS,
    )
    const terminalReason =
      record.error?.message.slice(0, MAX_UI_TEXT_CHARS) ??
      evidenceFailure?.slice(0, MAX_UI_TEXT_CHARS) ??
      runtimeFailure
    // A run whose release failed can no longer continue: only its stop is offered again (F91, D18).
    const canControl =
      !this.stopping &&
      !record.stopping &&
      !record.stopped &&
      !record.cleanupError &&
      !terminalReason &&
      this.now() < record.deadlineAt
    // A server run's state, actions, participant and request facts come from its run (D1); a request failure shows in `error` but is never the terminal reason.
    const server = isNodeServerRecord(record)
      ? projectNodeServerState({
          instanceId: this.instanceId,
          runId: record.id,
          view: record.nodeServer.run?.view(),
          itemId: record.nodeServer.prepared?.descriptor.itemId,
          controllable: canControl,
          stopped: record.stopped,
          ending:
            record.stopping ||
            Boolean(record.cleanupError) ||
            Boolean(record.error),
          sanitize: (text) => this.sanitizedCause(text),
        })
      : undefined
    const nodeStop = record.nodeStops?.at(-1)
    const nodeStopUri = nodeStop
      ? this.uri(record.id, `node-stops/${nodeStop.index}`)
      : undefined
    const nodeContinuation =
      nodeStop && record.nodePhase === 'paused'
        ? {
            instanceId: this.instanceId,
            runId: record.id,
            participant: 'server' as const,
            sessionId: nodeStop.sessionId,
            threadId: nodeStop.threadId,
            generation: nodeStop.index + 1,
          }
        : undefined
    const nodeResumable = Boolean(
      canControl &&
      record.nodeRun &&
      nodeContinuation &&
      record.nodePhase === 'paused',
    )
    const nodeParticipants = nodeStop
      ? {
          server: {
            snapshotUri: nodeStopUri,
            sourceUri: `${nodeStopUri}/source/typescript`,
            itemId: record.nodePrepared?.descriptor.itemId,
            actionId: undefined,
            phase: record.nodePhase,
            resumable: nodeResumable,
            continueArguments: nodeResumable ? nodeContinuation : undefined,
          },
        }
      : undefined
    // A test run's outcomes come from its run and history facts (plan version 7, Design 1); a browser run's from its runtime and saved study.
    const nodeOutcome =
      record.profile === NODE_TEST_PROFILE
        ? projectNodeTestOutcome({
            history: this.nodeHistoryState(record),
            entryCount: record.nodeHistoryEntryCount ?? 0,
            completed: record.nodePhase === 'completed',
            result: record.nodeResult,
            hasError: Boolean(record.error),
            stopped: record.stopped,
          })
        : undefined
    const participantView = (name: 'server' | 'browser') => {
      const participant = runtime?.participants[name],
        snapshot = participant?.snapshot
      const snapshotUri = snapshot
        ? this.uri(record.id, `snapshots/${encodeURIComponent(snapshot.id)}`)
        : undefined
      const resumable = Boolean(
        canControl && snapshot && isPausedAtSnapshot(participant, snapshot),
      )
      const continueArguments: ContinueInput | undefined =
        resumable && snapshot
          ? {
              instanceId: this.instanceId,
              runId: record.id,
              participant: name,
              ...snapshot.pause,
              // Sent back to codebook_continue, it makes the call answer with the run's next state.
              answer: 'next',
            }
          : undefined
      return {
        snapshotUri,
        sourceUri: snapshotUri && `${snapshotUri}/source/typescript`,
        itemId: snapshot?.itemId,
        actionId: snapshot?.actionId,
        // A debugger that has stopped is reported as paused only with its committed observation: while the stop is still inspected, the participant reads as running, like the run's state.
        phase:
          participant?.phase === 'paused' && !snapshot
            ? 'running'
            : participant?.phase,
        resumable,
        continueArguments,
      }
    }
    const participants = {
      ...(runtime?.participants.server
        ? { server: participantView('server') }
        : {}),
      ...(nodeParticipants ?? {}),
      ...(server ? { server: server.participant } : {}),
      browser: participantView('browser'),
    }
    const finalOutcome =
      nodeOutcome?.finalOutcome ??
      (terminalReason
        ? 'not-demonstrated'
        : (runtime?.finalOutcome ?? 'pending-teardown'))
    // A refused or removed run has no history to read or to add to; nor has a test run whose history sealed with no entry, which the store removed at its seal (D6, F253).
    const holdsHistory =
      historyExclusionState(record.historyExcluded) !== 'ended' &&
      !this.isRemovedEmptyNodeHistory(record)
    // A run that reached its result and saved no learning summary would be saved without a summary and a sequence: say so where the agent reads after the result.
    // Only once the run is released: until then this resource has no terminalReference to cite, and an explanation is refused as busy.
    const lacksLearningSummary =
      holdsHistory &&
      record.stopped &&
      runtime?.status === 'completed' &&
      finalOutcome === 'demonstrated' &&
      ![...record.explanations.values()].some(
        (explanation) => explanation.learningSummary,
      )
    // explain refuses every new key once the budget is spent, so the step is no longer offered then.
    const explanationBudgetSpent =
      record.explanationKeys.size >= MAX_EXPLANATIONS
    // explain refuses every new key of a stopped run whose evidence failed, so the step is not offered then either.
    const stoppedEvidenceFailure = this.stoppedRunEvidenceFailure(record)
    const availableActions = [
      canControl && record.prepared && runtime?.status === 'ready'
        ? runtime.nextAction
        : undefined,
      participants.server?.resumable ? 'continue-server' : undefined,
      participants.browser.resumable ? 'continue-browser' : undefined,
      !record.stopped ? 'stop' : undefined,
      lacksLearningSummary &&
      !explanationBudgetSpent &&
      stoppedEvidenceFailure === undefined
        ? 'save-learning-summary'
        : undefined,
      // A sealed test history whose learning material does not yet explain every stop and the result asks for codebook_explain_node_history.
      // Only a history with an entry holds anything to explain or save; a history sealed with none has no Save item either.
      record.nodeLearning &&
      record.nodeLearning.coverage !== 'complete' &&
      (record.nodeHistoryEntryCount ?? 0) > 0
        ? 'save-node-learning'
        : undefined,
      holdsHistory ? 'read-history' : undefined,
    ].filter((value) => value !== undefined)
    // After a stop whose release failed, only the stop is offered again (F91, D18).
    const nextActions =
      server?.nextActions ??
      (record.cleanupError && !record.stopped ? ['stop'] : availableActions)
    const material = {
      instanceId: this.instanceId,
      runId: record.id,
      studyId: `${this.instanceId}_${record.id}`,
      runtimeRunId: runtime?.runId ?? record.nodeRun?.id,
      profile: record.profile,
      state: record.stopped
        ? 'stopped'
        : record.stopping
          ? 'stopping'
          : terminalReason
            ? 'failed'
            : !record.prepared
              ? 'preparing'
              : (runtime?.status ?? record.nodePhase ?? 'preparing'),
      runtimeState: runtime?.status ?? record.nodePhase,
      createdAt: new Date(record.createdAt).toISOString(),
      deadlineAt: new Date(record.deadlineAt).toISOString(),
      preparationDeadlineAt:
        record.profile === REPOSITORY_BROWSER_PROFILE
          ? new Date(
              record.createdAt + REPOSITORY_SETUP_TIMEOUT_MS,
            ).toISOString()
          : undefined,
      activeTimeoutMs: ACTIVE_TIMEOUT_MS,
      nextActions,
      participants,
      operation: record.action?.receipt,
      operations: [...record.actions.values()].map((action) => action.receipt),
      observed: runtime?.observed,
      links: runtime?.links,
      nodeTest:
        record.profile === NODE_TEST_PROFILE
          ? {
              configurationHash: record.nodePrepared?.configurationHash,
              stops: (record.nodeStops ?? []).map((stop) => {
                const uri = this.uri(record.id, `node-stops/${stop.index}`)
                return {
                  index: stop.index,
                  participant: 'server',
                  snapshotUri: uri,
                  sourceUri: `${uri}/source/typescript`,
                  path: stop.source.path,
                  hash: stop.source.hash,
                  line: stop.frame.line,
                  column: stop.frame.column,
                }
              }),
              result: record.nodeResult && {
                exitCode: record.nodeResult.exitCode,
                signal: record.nodeResult.signal,
                output: record.nodeResult.output,
              },
              historyUri:
                record.nodeHistoryWriter &&
                !this.isRemovedEmptyNodeHistory(record)
                  ? `codebook://node-history/${encodeURIComponent(record.nodeHistoryWriter.header.studyId)}`
                  : undefined,
              historyStatus:
                record.nodeHistoryStatus ??
                (record.nodeHistoryWriter ? 'recording' : 'unavailable'),
              historyReason: cutCauseForDisplay(record.nodeHistoryFailure),
              testResult: nodeTestResultKind(record.nodeResult),
              // Present once the history is sealed: how much the saved learning material explains, read from the run's cache (EN2).
              learningCoverage: record.nodeLearning?.coverage,
              learningMissing: record.nodeLearning?.missing,
              // Recorded evidence the replay lacks: Save reads partially saved while any is missing, so a claim of saved learning needs this empty.
              captureMissing: record.nodeLearning?.captureMissing,
              recordingAvailable: nodeOutcome?.replayAvailable ?? false,
              replayAvailable: nodeOutcome?.replayAvailable ?? false,
            }
          : undefined,
      // Dispatch and ACK change recoverable evidence even while the runtime remains in the same acting state.
      operationProgress:
        runtime?.profile === REPOSITORY_BROWSER_PROFILE && runtime.operation
          ? {
              ...runtime.operation,
              continuedPause: runtime.operation.continuedPause && {
                ...runtime.operation.continuedPause,
              },
            }
          : undefined,
      applicationOrigin: runtime?.applicationOrigin,
      applicationPortSource: runtime?.applicationPortSource,
      manifestUri:
        runtime?.manifest || record.nodePrepared
          ? this.uri(record.id, 'manifest')
          : undefined,
      manifestHash:
        runtime?.manifest?.hash ?? record.nodePrepared?.configurationHash,
      configurationHash:
        record.profile === REPOSITORY_BROWSER_PROFILE
          ? record.definition?.configurationHash
          : undefined,
      itemId:
        record.profile === REPOSITORY_BROWSER_PROFILE
          ? record.definition?.descriptor.itemId
          : undefined,
      observations:
        runtime?.snapshots.map((snapshot) => ({
          id: snapshot.id,
          itemId: snapshot.itemId,
          actionId: snapshot.actionId,
          participant: snapshot.participant,
          capturePhase: snapshot.capturePhase,
          // Present only for a stop the debugger bound on another line than declared: the sentence that names the paused line.
          place: this.boundPlace(record, snapshot, false)?.place,
          snapshotUri: this.uri(
            record.id,
            `snapshots/${encodeURIComponent(snapshot.id)}`,
          ),
          inspectionUri: this.uri(
            record.id,
            `snapshots/${encodeURIComponent(snapshot.id)}/inspection`,
          ),
          imageUri:
            runtime.snapshotCaptures?.[snapshot.id]?.status === 'captured'
              ? this.uri(
                  record.id,
                  `snapshots/${encodeURIComponent(snapshot.id)}/image`,
                )
              : undefined,
          sourceUri: this.uri(
            record.id,
            `snapshots/${encodeURIComponent(snapshot.id)}/source/typescript`,
          ),
        })) ?? [],
      runtimeOutcome,
      captureOutcome: runtime?.captureOutcome,
      finalOutcome,
      terminalReason,
      // A failure inside the runtime has no tool error of its own; its text becomes the cause an agent can quote.
      error:
        record.error?.describe() ??
        (runtimeFailure
          ? new StudyError(
              'RUNTIME_FAILED',
              'The run failed in its runtime.',
              runtimeFailure,
            ).describe()
          : undefined),
      cleanupError: record.cleanupError?.describe(),
      cleaned: record.stopped,
      resourcesReleased: runtime?.resourcesReleased ?? record.stopped,
      // Present only when the run's own browser profile folder could not be removed; the run is released all the same.
      browserProfileLeft: runtime?.browserProfileLeft && {
        ...runtime.browserProfileLeft,
        advice: BROWSER_PROFILE_LEFT_ADVICE,
      },
      activeSessionIds: runtime?.activeSessionIds ?? [],
      captures: Object.entries(runtime?.captures ?? {}).map(
        ([phase, capture]) => ({
          phase,
          status: capture.status,
          error: capture.error,
          uri:
            capture.status === 'captured'
              ? this.uri(record.id, `images/${phase}`)
              : undefined,
        }),
      ),
      terminalReference:
        record.stopped &&
        runtime?.finalOutcome === 'demonstrated' &&
        runtime.operation?.afterVerified &&
        runtime.operation.inputAcknowledged &&
        runtime.captures.after?.status === 'captured' &&
        runtime.captures.after.renderer?.hash &&
        record.definition
          ? {
              kind: 'terminal' as const,
              configurationHash: record.definition.configurationHash,
              captureHash: runtime.captures.after.renderer.hash,
            }
          : undefined,
      explanations: [...record.explanations.values()].map((value) =>
        this.uri(record.id, `explanations/${value.id}`),
      ),
      eventsUri: this.uri(record.id, 'events/0'),
      runUri: this.uri(record.id),
      ...(server && isNodeServerRecord(record)
        ? this.nodeServerMaterial(record, server)
        : {}),
    }
    // Receipt fields are excluded from the signature to avoid a save/report/save feedback loop.
    const materialSignature = sha256(JSON.stringify(material))
    const receipt = record.historyReceipt,
      latest = receipt?.signature === materialSignature
    // A refused or removed run keeps its receipts in memory; none of them may read as saved history.
    const historyExcluded =
        historyExclusionState(record.historyExcluded) !== 'kept',
      exclusionReason = historyExclusionReason(record.historyExcluded)
    // A receipt for older material is still pending; only the latest one says saved or failed.
    const receiptStatus =
        receipt && latest ? receipt.status : ('pending' as const),
      receiptReason = latest ? receipt?.reason : undefined
    const historyOutcome = {
      status:
        historyExcluded || !receipt ? ('unavailable' as const) : receiptStatus,
      materialSignature,
      checkpointRevision: receipt?.revision,
      savedSignature:
        !historyExcluded && latest && receipt?.status === 'saved'
          ? receipt.signature
          : undefined,
      reason: historyExcluded ? exclusionReason : receiptReason,
    }
    const terminal = record.stopped || material.resourcesReleased
    const studyOutcome =
      nodeOutcome?.studyOutcome ??
      (material.finalOutcome === 'not-demonstrated'
        ? 'not-demonstrated'
        : material.finalOutcome === 'partial'
          ? 'partial'
          : material.finalOutcome !== 'demonstrated' || !terminal
            ? 'pending'
            : historyOutcome.status === 'saved'
              ? 'demonstrated'
              : historyOutcome.status === 'pending'
                ? 'pending'
                : 'partial')
    const recordingReceipt = historyExcluded
      ? undefined
      : record.recordingReceipt
    const recordingCurrent =
      recordingReceipt?.signature === materialSignature &&
      recordingReceipt?.historyRevision === receipt?.revision
    const capture = record.recording?.state()
    // The recording a removed study had went to the system Trash with it.
    const recordingRemoved =
      isStudyRemovalExclusion(record.historyExcluded) &&
      record.recording !== undefined
    const recording = nodeOutcome
      ? this.nodeRecording(record, nodeOutcome.recordingStatus)
      : {
          capture,
          status:
            record.recordingFailure || recordingRemoved
              ? ('failed' as const)
              : record.recordingSeal
                ? record.recordingSeal.status === 'complete'
                  ? ('finalized' as const)
                  : ('partial' as const)
                : capture?.status === 'partial'
                  ? ('partial' as const)
                  : record.recording
                    ? ('recording' as const)
                    : ('unavailable' as const),
          reason: recordingRemoved
            ? exclusionReason
            : (record.recordingFailure ??
              record.recordingSeal?.reason ??
              capture?.reason),
          endMs: record.recordingSeal?.endMs,
          contextStatus: recordingCurrent
            ? recordingReceipt.status
            : recordingReceipt
              ? ('pending' as const)
              : ('unavailable' as const),
          contextHash:
            recordingCurrent && recordingReceipt?.status === 'saved'
              ? recordingReceipt.contextHash
              : undefined,
          studyHash:
            recordingCurrent && recordingReceipt?.status === 'saved'
              ? recordingReceipt.studyHash
              : undefined,
          contextReason: historyExcluded
            ? exclusionReason
            : recordingCurrent
              ? recordingReceipt?.reason
              : undefined,
        }
    const recordedStudyOutcome =
      nodeOutcome?.recordedStudyOutcome ??
      (studyOutcome === 'not-demonstrated'
        ? 'not-demonstrated'
        : studyOutcome === 'partial'
          ? 'partial'
          : studyOutcome !== 'demonstrated'
            ? 'pending'
            : recording.status === 'finalized' &&
                recording.contextStatus === 'saved'
              ? 'demonstrated'
              : recording.status === 'recording' ||
                  recording.contextStatus === 'pending'
                ? 'pending'
                : 'partial')
    // A fresh clock reading guides preparation polling without changing durable evidence identity.
    const observedAtMs =
      record.profile === REPOSITORY_BROWSER_PROFILE &&
      material.state === 'preparing'
        ? this.now()
        : undefined
    const preparationRemainingMs =
      observedAtMs === undefined
        ? undefined
        : Math.max(
            0,
            record.createdAt + REPOSITORY_SETUP_TIMEOUT_MS - observedAtMs,
          )
    return {
      ...material,
      // Present while the run lacks a learning summary: the step to save one while explain still accepts a new key, the spent budget once it does not; gone once an explanation with a learning summary is saved.
      saveLearningSummary: learningSummaryAdvice(
        lacksLearningSummary,
        explanationBudgetSpent,
        [...record.explanationKeys.values()].some(
          (accepted) => accepted.isSavingLearningSummary,
        ),
        stoppedEvidenceFailure,
      ),
      observedAt:
        observedAtMs === undefined
          ? undefined
          : new Date(observedAtMs).toISOString(),
      preparationRemainingMs,
      materialSignature,
      historyOutcome,
      studyOutcome,
      recording,
      recordedStudyOutcome,
    }
  }

  /**
   * Gives the fields of the run resource that a node-server run replaces: its state, its `nodeServer` block, the manifest it freezes and the error that shows a request failure beside the run's own; read by {@link StudyService.state}.
   * @param record - The node-server run.
   * @param server - Its projection ({@link projectNodeServerState}).
   * @returns The fields, which the resource spreads over the generic ones so they enter the material signature.
   * @example this.nodeServerMaterial(record, server).state // => 'responded'
   */
  private nodeServerMaterial(
    record: NodeServerStudyRecord,
    server: ReturnType<typeof projectNodeServerState>,
  ) {
    const failure = server.nodeServer?.requestFailure
    const prepared = record.nodeServer.prepared
    return {
      state: server.state,
      // A server run is never saved: it reads pending-teardown while it lives and not-demonstrated once it ended.
      finalOutcome:
        record.stopped || record.error
          ? ('not-demonstrated' as const)
          : ('pending-teardown' as const),
      runtimeState: server.state,
      runtimeRunId: record.nodeServer.run?.id,
      nodeServer: server.nodeServer && {
        ...server.nodeServer,
        configurationHash: prepared?.configurationHash,
      },
      manifestUri: prepared ? this.uri(record.id, 'manifest') : undefined,
      manifestHash: prepared?.configurationHash,
      // The run's own error wins; a failed request shows beside a run that goes on.
      error:
        record.error?.describe() ??
        (failure
          ? this.sanitizedError(
              new StudyError(failure.code, failure.message),
            ).describe()
          : undefined),
    }
  }

  /**
   * Says where a test run's history stands for {@link projectNodeTestOutcome}; read by {@link StudyService.state}.
   * @param record - The test run.
   * @returns `none` before the history began, else the history's own status.
   * @example this.nodeHistoryState(record) // => 'recording'
   */
  private nodeHistoryState(record: StudyRecord): NodeTestHistoryState {
    if (!record.nodeHistoryWriter) return 'none'
    return record.nodeHistoryStatus ?? 'recording'
  }

  /**
   * Projects a test run's `recording` for the run resource: its status from the run's outcome, why a history is partial, failed or not begun, and the sealed journal's hash as its context; read by {@link StudyService.state}.
   * @param record - The test run.
   * @param status - The recording status of the run's outcome ({@link projectNodeTestOutcome}).
   * @returns The run resource's `recording` of a test run.
   * @example this.nodeRecording(record, 'finalized').contextHash // => the sealed journal's SHA-256
   */
  private nodeRecording(
    record: StudyRecord,
    status: ReturnType<typeof projectNodeTestOutcome>['recordingStatus'],
  ) {
    const sealed = status === 'finalized' || status === 'partial'
    return {
      capture: undefined,
      status,
      reason: this.nodeRecordingReason(record, status),
      endMs: undefined,
      contextStatus: sealed
        ? ('saved' as const)
        : status === 'recording'
          ? ('pending' as const)
          : ('unavailable' as const),
      contextHash: sealed ? record.nodeHistoryHash : undefined,
      studyHash: undefined,
      contextReason:
        status === 'failed'
          ? cutCauseForDisplay(record.nodeHistoryFailure)
          : undefined,
    }
  }

  /**
   * Says why a test run's `recording` reads its status, for {@link nodeRecording}: the seal's failure, why a sealed history is partial, or why nothing was recorded yet.
   * @param record - The test run.
   * @param status - The recording status of the run's outcome ({@link projectNodeTestOutcome}).
   * @returns The reason, or `undefined` for a history that records or sealed complete.
   * @example this.nodeRecordingReason(record, 'unavailable') // => 'Preparing: the test history starts when preparation passes.'
   */
  private nodeRecordingReason(
    record: StudyRecord,
    status: ReturnType<typeof projectNodeTestOutcome>['recordingStatus'],
  ): string | undefined {
    if (status === 'failed')
      return cutCauseForDisplay(record.nodeHistoryFailure)
    if (status === 'partial')
      return cutCauseForDisplay(record.nodeHistoryReason)
    if (status !== 'unavailable') return undefined
    // A run refused, failed or stopped before its history began recorded nothing; a run still preparing says so.
    return (
      historyExclusionReason(record.historyExcluded) ??
      (record.stopped || record.error
        ? 'The test run ended before its history began; nothing was recorded.'
        : 'Preparing: the test history starts when preparation passes.')
    )
  }

  /** Prevents late acquisitions escaping shutdown while preserving retryable cleanup failures. @example await service.shutdown() */
  async shutdown(): Promise<void> {
    this.stopping = true
    clearInterval(this.maintenance)
    this.repositoryRetirement.abort()
    const attempt = (this.shutdownPromise ??= (async () => {
      // Cancelled navigation failures are expected; drain accepted host effects before reporting retirement.
      const results = await Promise.allSettled([
        this.repository?.flush(),
        Promise.allSettled([...this.repositoryOpens]),
        ...[...this.records.values()].map((record) => this.stopRecord(record)),
      ])
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [String(result.reason)] : [],
      )
      if (failures.length)
        throw new StudyError(
          'RUNTIME_FAILED',
          'Owned shutdown remains incomplete.',
          failures.join('; '),
        )
    })())
    try {
      await attempt
    } catch (error) {
      this.shutdownPromise = undefined
      throw error
    }
  }

  /** Fails overload/expiry and cleans completed runtimes even when all MCP clients vanished. @example service.maintain() */
  maintain(): void {
    for (const record of this.records.values()) {
      // A failed release needs an explicit retry; unchanged storage/process failures must not loop.
      if (record.stopped || record.stopping || record.cleanupError) continue
      // A server's own failure ends its run; a failed request never does (D1).
      this.adoptNodeServerFailure(record)
      const evidenceFailure = record.runtime?.evidence.failure
      if (evidenceFailure) {
        const message = 'Evidence buffering or persistence failed.'
        record.error = this.writeFailureError(record, message, evidenceFailure)
        // A study found removed later words this error by its removal (row 700).
        record.errorSource = {
          kind: 'write',
          message,
          failure: evidenceFailure,
        }
        record.runtime?.fail(record.error.message)
      }
      this.expireAtDeadline(record)
      const runtimeState = record.runtime?.view().status
      if (
        record.error ||
        runtimeState === 'completed' ||
        runtimeState === 'failed' ||
        record.nodePhase === 'completed' ||
        record.nodePhase === 'failed'
      )
        void this.stopRecord(record).catch((error) => {
          this.failByRelease(record, error)
        })
    }
  }

  /**
   * Gives a run that ended without an error of its own its release's failure as its error, for {@link StudyService.maintain} when the release it started threw: a run that failed keeps its own error, with its cause, and the release's failure is its cleanupError (Cycle 0046 row 653). The error notes that the release made it, so {@link StudyService.wordFailuresByRemoval} words it again once the study turns out removed (row 700).
   * @param record - The run whose release threw.
   * @param error - What {@link StudyService.stopRecord} threw.
   * @example this.failByRelease(completedRecord, new Error('owned browser close: timed out')) // record.error.message => 'The study operation failed. Cause: owned browser close: timed out'
   */
  private failByRelease(record: StudyRecord, error: unknown): void {
    if (record.error) return
    record.error = studyErrorNamingCause(
      domainError(this.sanitizedFailure(error)),
    )
    record.errorSource = { kind: 'release' }
  }

  /**
   * Names the cause of a run's evidence failure for the run's error, which becomes its terminal reason and the reason its runtime journals as `run.failed`; called by {@link StudyService.maintain} when the run's evidence has failed.
   * A run whose saved study was removed while it ran (its archive left the library by hand or through another window; this window's delete refuses a run that has not stopped) lost its evidence directory with it: the write's raw error names that internal storage path, which {@link StudyService.state} keeps out of the run resource too, so the removal's own sentence is the cause (Cycle 0046 row 667).
   * @param record - The run whose evidence failed.
   * @param failure - The evidence's failure, as {@link Evidence} keeps it.
   * @returns
   * - For a run whose saved study was removed: {@link historyExclusionReason} of its removal
   * - Otherwise: `failure` itself
   * @example
   * this.evidenceFailureCause(record, 'Error: ENOSPC: no space left on device, write') // => 'Error: ENOSPC: no space left on device, write'
   * this.evidenceFailureCause(removedRecord, "Error: ENOENT: no such file or directory, open '…/events.jsonl'")
   * // => "The archive of this run's saved study is no longer in the study library: its files were removed by hand or by another Codebook window."
   */
  private evidenceFailureCause(record: StudyRecord, failure: string): string {
    return isStudyRemovalExclusion(record.historyExcluded)
      ? historyExclusionReason(record.historyExcluded)
      : failure
  }

  /**
   * Ends a run whose whole-run deadline has passed with the deadline's error, so every reader names the same end; called by {@link StudyService.maintain} at each maintenance turn and by {@link StudyService.nextRunState} while a continuation waits, which must not answer past the run's own deadline.
   * It releases nothing itself: the next maintenance turn stops the run it marked. A run that already ended on its own ({@link StudyService.hasRunEnded}) is left as it is, whichever caller asks.
   * The reason it journals as `run.failed` is the run's error message, which names its cause whichever path set an earlier error ({@link studyErrorNamingCause}, Cycle 0046 row 653); the deadline's own message is its cause.
   * @param record - The run whose deadline is compared with the clock.
   * @example this.expireAtDeadline(record) // record.error?.message === 'Study wall deadline expired; history only.' once now() >= record.deadlineAt
   */
  private expireAtDeadline(record: StudyRecord): void {
    if (this.now() < record.deadlineAt) return
    // The deadline bounds a run that is still on its way; a result that was observed is not turned into a failure while the run waits for its release.
    if (this.hasRunEnded(record)) return
    // A server whose request was answered or failed reaches the deadline as a normal stop: its request was observed, so no error is added.
    if (this.endNodeServerAtDeadline(record)) return
    record.error ??= new StudyError(
      'RUNTIME_FAILED',
      'Study wall deadline expired; history only.',
    )
    record.runtime?.fail(record.error.message)
    this.failUnfinishedNodePhase(record)
  }

  /**
   * Releases a node-server run whose request ended (`responded` or `request-failed`) when the whole-run deadline passes, without an error; called by {@link StudyService.expireAtDeadline}.
   * @param record - The run whose deadline passed.
   * @returns `true` when the run is such a server run (its release was started); `false` otherwise, so the deadline error applies.
   * @example this.endNodeServerAtDeadline(record) // => true for a responded server run
   */
  private endNodeServerAtDeadline(record: StudyRecord): boolean {
    const state = record.nodeServer?.run?.view().state
    if (state !== 'responded' && state !== 'request-failed') return false
    void this.stopRecord(record).catch((error) => {
      this.failByRelease(record, error)
    })
    return true
  }

  /**
   * Says whether a run ended before its whole-run deadline could apply, so the deadline's error is never added to it; the guard of {@link StudyService.expireAtDeadline} for both of its callers.
   * @param record - The run whose deadline passed.
   * @returns `true` for a run that is stopped or being stopped, and for one whose runtime or test completed (its result was observed and only the release is left); `false` for a run that is still on its way.
   * @example this.hasRunEnded(record) // => true once record.runtime.view().status === 'completed'
   */
  private hasRunEnded(record: StudyRecord): boolean {
    return (
      record.stopped ||
      record.stopping ||
      record.runtime?.view().status === 'completed' ||
      // A test run's result was observed: only its release is left.
      record.nodePhase === 'completed'
    )
  }

  /**
   * Marks the Node test of a run that passed its whole-run deadline as failed, unless the test already completed; the last step of {@link StudyService.expireAtDeadline}.
   * @param record - The run whose deadline passed; a run of another profile has no Node phase and is left as it is.
   * @example this.failUnfinishedNodePhase(record) // record.nodePhase: 'paused' becomes 'failed', 'completed' stays
   */
  private failUnfinishedNodePhase(record: StudyRecord): void {
    if (record.nodePhase && record.nodePhase !== 'completed')
      record.nodePhase = 'failed'
  }

  /** Acquires the adapter once; cancellation after an await drains rather than abandons it. @example await this.prepare(record) */
  private async prepare(record: StudyRecord): Promise<void> {
    if (record.profile === NODE_SERVER_PROFILE)
      return this.prepareNodeServer(record)
    try {
      // Reserve intent -> immutable article/all citations -> owned adapter -> input; retries never repeat these reads.
      if (record.profile === REPOSITORY_BROWSER_PROFILE) {
        this.environment.assertWorkspace?.()
        if (!this.repository)
          throw new StudyError(
            'PREREQUISITE_MISSING',
            'Repository source/book storage is unavailable in this editor.',
          )
        // An open reader that shows saved history displays none of this run's captures, so the run would fail at its first one, after the application was started: it ends here, before any input.
        const presentation = this.presentationController?.presentationState()
        if (
          presentation?.state === 'open' &&
          !presentation.reader.followingCurrentRun
        ) {
          // The run had no effect: no study is saved for it, as for a run the library refused.
          record.historyExcluded = 'refused-at-admission'
          throw new StudyError(
            'PRESENTATION_UNAVAILABLE',
            readerNotFollowingRunRefusal(presentation.reader.contentRevision),
          )
        }
        // The admission precedes every awaited read, so no reader checkpoint captures a run the library will refuse.
        await this.admitStudy(record)
        if (this.stopping || record.stopping) return
        record.definition = await prepareRepositoryStudy(
          record.configuration,
          this.repository,
          {
            signal: record.cancellation.signal,
            deadlineAt: Math.min(
              record.deadlineAt,
              record.createdAt + REPOSITORY_SETUP_TIMEOUT_MS,
            ),
          },
          this.now,
        )
        this.environment.assertWorkspace?.()
      } else {
        this.environment.assertWorkspace?.()
        if (!this.repository)
          throw new StudyError(
            'PREREQUISITE_MISSING',
            'Repository source/book storage is unavailable in this editor.',
          )
        record.nodePrepared = await prepareNodeTestStudy(
          record.configuration,
          this.repository,
          {
            signal: record.cancellation.signal,
            deadlineAt: Math.min(
              record.deadlineAt,
              record.createdAt + REPOSITORY_SETUP_TIMEOUT_MS,
            ),
          },
          this.now,
        )
        this.environment.assertWorkspace?.()
      }
      // A node-test start waits on its own prerequisites, never on the repository-wide Vitest search: the pre-history check resolves the cited test's own Vitest.
      const selectedPrerequisites =
        record.profile === NODE_TEST_PROFILE &&
        this.environment.nodeTestStartPrerequisites
          ? await this.environment.nodeTestStartPrerequisites()
          : await this.environment.prerequisites().then(
              // Shared Node/Chrome availability alone cannot authorize an unsupported selected profile.
              (prerequisites) =>
                prerequisites.profiles?.[record.profile] ?? prerequisites,
            )
      if (!selectedPrerequisites.ready)
        throw new StudyError(
          'PREREQUISITE_MISSING',
          selectedPrerequisites.missing.join('; '),
        )
      if (this.stopping || record.stopping) return
      if (record.profile === NODE_TEST_PROFILE) {
        if (
          !record.nodePrepared ||
          !this.environment.createNodeTestRun ||
          !this.nodeHistoryStore
        )
          throw new StudyError(
            'PREREQUISITE_MISSING',
            'The owned Node test adapter or durable history store is unavailable.',
          )
        // Every deterministic check refuses before the history exists, so a refused run records nothing and holds no slot (EN1).
        record.nodePrepared.execution =
          await this.environment.checkNodeTestFiles?.(
            record.nodePrepared.configuration,
            record.nodePrepared.descriptor.sources,
            {
              signal: record.cancellation.signal,
              deadlineAt: Math.min(
                record.deadlineAt,
                record.createdAt + REPOSITORY_SETUP_TIMEOUT_MS,
              ),
              now: this.now,
              // Before the history exists the run's events are its only journal: a root listing that may still run is named there, also when a stop ends the start. The run keeps its release, which its stop runs again.
              onListingNotReleased: (_failure, retryRelease) => {
                record.nodeEvents?.push({
                  sequence: record.nodeEvents.length + 1,
                  type: 'node-test.vitest-listing-not-released',
                  detail: { omitted: true },
                })
                ;(record.unreleasedListings ??= []).push(retryRelease)
              },
            },
          )
        if (this.stopping || record.stopping) return
        const studyId = `${this.instanceId}_${record.id}`
        record.nodeHistoryWriter = await this.nodeHistoryStore
          .start({
            profile: NODE_TEST_PROFILE,
            workspaceKey: this.nodeHistoryStore.workspaceKey,
            studyId,
            instanceId: this.instanceId,
            runId: record.id,
            createdAt: new Date(record.createdAt).toISOString(),
            configurationHash: record.nodePrepared.configurationHash,
            configuration: record.nodePrepared.configuration,
            descriptor: record.nodePrepared.descriptor,
            sourceBuild: this.environment.build,
          })
          .catch((error: unknown) => {
            // A full storage is a typed refusal the learner can remedy, worded as the study library's is (D7, F93).
            if (error instanceof SavedStudyStorageFullError)
              throw new StudyError(
                'PREREQUISITE_MISSING',
                fullLibraryMessage(
                  'run',
                  error.limit,
                  this.removalAvailability,
                ),
              )
            throw error
          })
        record.nodeHistoryStatus = 'recording'
        // Events journaled before the history began (a root listing that was not released) keep their numbers.
        let sequence = record.nodeEvents?.length ?? 0,
          retainedEventBytes = 0,
          eventsTruncated = false
        record.nodeRun = await this.environment.createNodeTestRun(
          record.nodePrepared.configuration,
          (type, detail) => {
            const events = record.nodeEvents!
            const input =
              detail && typeof detail === 'object'
                ? (detail as Record<string, unknown>)
                : {}
            let historyWrite: Promise<void> | undefined
            if (type === 'node-test.output' && record.nodeHistoryWriter) {
              const output: NodeTestOutputEvent = {
                sequence: Number(input.sequence),
                elapsedMs: Number(input.elapsedMs),
                channel: input.channel === 'stderr' ? 'stderr' : 'stdout',
                text:
                  typeof input.text === 'string'
                    ? input.text.slice(0, 4_096)
                    : '',
              }
              historyWrite = record.nodeHistoryWriter.appendOutput(output)
            }
            if (eventsTruncated) return historyWrite
            // Native adapter events can contain host paths and process identities; publish only learning evidence.
            const safe =
              type === 'node-test.output'
                ? {
                    sequence: input.sequence,
                    elapsedMs: input.elapsedMs,
                    channel: input.channel,
                    text:
                      typeof input.text === 'string'
                        ? input.text.slice(0, 4_096)
                        : '',
                  }
                : type === 'node-test.source-stopped'
                  ? {
                      index: input.index,
                      path: input.path,
                      line: input.line,
                      column: input.column,
                      variableNames: Array.isArray(input.variableNames)
                        ? input.variableNames.slice(0, 64)
                        : [],
                    }
                  : type === 'node-test.result'
                    ? { exitCode: input.exitCode, signal: input.signal }
                    : type === 'node-test.debugger-error'
                      ? {
                          message:
                            typeof input.message === 'string'
                              ? input.message.slice(0, 1_024)
                              : 'Debugger error.',
                        }
                      : type === 'node-test.dap-stopped'
                        ? {
                            reason:
                              typeof input.reason === 'string'
                                ? input.reason.slice(0, 128)
                                : 'stopped',
                          }
                        : type === 'node-test.output-surface-ready'
                          ? { ready: true }
                          : type === 'node-test.output-surface-closed'
                            ? { closed: true }
                            : type === 'node-test.started'
                              ? {
                                  started: true,
                                  // Root-relative, as the manifest names them: no host path leaves the journal.
                                  vitestRoot:
                                    typeof input.vitestRoot === 'string'
                                      ? input.vitestRoot
                                      : undefined,
                                  rootClaim:
                                    typeof input.rootClaim === 'string'
                                      ? input.rootClaim
                                      : undefined,
                                }
                              : type === 'node-test.closed'
                                ? { closed: true }
                                : type === 'node-test.session-started'
                                  ? { attached: true }
                                  : type === 'node-test.session-terminated'
                                    ? { terminated: true }
                                    : type === 'node-test.worker-verified'
                                      ? { verified: true }
                                      : type === 'node-test.breakpoint-ack'
                                        ? {
                                            status:
                                              input.status === 'bound'
                                                ? 'bound'
                                                : 'pending',
                                            elapsedMs: input.elapsedMs,
                                          }
                                        : type === 'node-test.entry-continued'
                                          ? { elapsedMs: input.elapsedMs }
                                          : type === 'node-test.frame-checked'
                                            ? {
                                                index: input.index,
                                                requestedLine:
                                                  input.requestedLine,
                                                requestedColumn:
                                                  input.requestedColumn,
                                                observedLine: Number.isInteger(
                                                  input.observedLine,
                                                )
                                                  ? input.observedLine
                                                  : null,
                                                observedColumn:
                                                  Number.isInteger(
                                                    input.observedColumn,
                                                  )
                                                    ? input.observedColumn
                                                    : null,
                                                sameSource:
                                                  input.sameSource === true,
                                                exact: input.exact === true,
                                                elapsedMs: input.elapsedMs,
                                              }
                                            : type ===
                                                'node-test.snapshot-started'
                                              ? {
                                                  index: input.index,
                                                  elapsedMs: input.elapsedMs,
                                                }
                                              : type ===
                                                  'node-test.pause-refreshed'
                                                ? {
                                                    line: input.line,
                                                    column: input.column,
                                                  }
                                                : // A pause Codebook did not make holds the test until the learner continues it; the agent reads where.
                                                  type ===
                                                    'node-test.learner-paused'
                                                  ? {
                                                      index: input.index,
                                                      path:
                                                        typeof input.path ===
                                                        'string'
                                                          ? input.path.slice(
                                                              0,
                                                              512,
                                                            )
                                                          : null,
                                                      line: Number.isInteger(
                                                        input.line,
                                                      )
                                                        ? input.line
                                                        : null,
                                                      column: Number.isInteger(
                                                        input.column,
                                                      )
                                                        ? input.column
                                                        : null,
                                                      reason:
                                                        typeof input.reason ===
                                                        'string'
                                                          ? input.reason.slice(
                                                              0,
                                                              128,
                                                            )
                                                          : 'paused',
                                                    }
                                                  : { omitted: true }
            const serialized = JSON.stringify(safe)
            const byteLength = Buffer.byteLength(serialized)
            if (
              events.length >= MAX_EVENTS ||
              byteLength > EVENT_DETAIL_LIMIT_BYTES ||
              byteLength > MAX_RETAINED_EVENT_BYTES - retainedEventBytes
            ) {
              eventsTruncated = true
              if (events.length < MAX_EVENTS)
                events.push({
                  sequence: ++sequence,
                  type: 'node-test.events-truncated',
                  detail: { truncated: true },
                })
              return historyWrite
            }
            retainedEventBytes += byteLength
            const bounded = safe
            events.push({
              sequence: ++sequence,
              type: type.slice(0, EVENT_TYPE_LIMIT_CHARS),
              detail: bounded,
            })
            return historyWrite
          },
          record.nodePrepared.descriptor.sources,
          record.nodePrepared.execution,
        )
        if (this.stopping || record.stopping) return
        const firstStop = await record.nodeRun.prepare()
        await record.nodeHistoryWriter.appendStop(firstStop)
        record.nodeStops!.push(firstStop)
        record.nodePhase = 'paused'
        record.prepared = true
      } else {
        const definition = record.definition
        if (!definition)
          throw new StudyError(
            'RUNTIME_FAILED',
            'Configured source binding is absent.',
          )
        if (this.stopping || record.stopping) return
        record.runtime = await this.environment.createRuntime(
          join(this.storageRoot, this.instanceId, record.id),
          definition,
          {
            signal: record.cancellation.signal,
            deadlineAt: record.deadlineAt,
            preparationDeadlineAt:
              record.createdAt + REPOSITORY_SETUP_TIMEOUT_MS,
          },
        )
        const acquired = record.runtime.view()
        if (
          acquired.profile !== record.profile ||
          JSON.stringify(acquired.definition) !== JSON.stringify(definition)
        )
          throw new StudyError(
            'RUNTIME_FAILED',
            'Acquired runtime changed the accepted repository definition.',
          )
        if (this.stopping || record.stopping) return
        if (this.recordings) {
          // Reserve capture before preparation can receive frames or expose action readiness.
          try {
            record.recording = await this.recordings.start(
              {
                workspaceKey: this.recordings.workspaceKey,
                studyId: `${this.instanceId}_${record.id}`,
                instanceId: this.instanceId,
                runId: record.id,
                runtimeId: record.runtime.id,
                profile: record.profile,
                sourceBuild: this.environment.build,
              },
              record.runtime.evidence.elapsedMs(),
              record.definition?.configuration.version === 2 ? 3 : 2,
            )
          } catch (error) {
            record.recordingFailure = `Recording unavailable before input: ${this.sanitizedCause(error)}`
          }
        }
        if (this.stopping || record.stopping) return
        await record.runtime.prepare()
        record.prepared = true
      }
    } catch (error) {
      // A failure before the admission answered is saved as an ordinary preparation failure only where the library has room for it.
      if (record.historyExcluded === 'awaiting-admission')
        record.historyExcluded = await this.exclusionAfterEarlyFailure(record)
      // A stop cancelled this preparation: the run ends as stopped, with no error of its own and no refusal; a stop before the history began gives up its slot and keeps its start key (F97).
      if (record.profile === NODE_TEST_PROFILE && record.stopping) {
        // An exclusion that already explains the run (a refusal at the admission) stays (F222).
        if (
          !record.nodeHistoryWriter &&
          (record.historyExcluded === undefined ||
            record.historyExcluded === 'awaiting-admission')
        )
          record.historyExcluded = 'stopped-before-history'
        record.nodePhase = 'failed'
        return
      }
      // A test run refused before its history began recorded nothing: it gives up its slot and its start key (EN1).
      if (record.profile === NODE_TEST_PROFILE && !record.nodeHistoryWriter)
        record.historyExcluded = 'refused-at-preparation'
      record.error = this.sanitizedError(this.preparationError(record, error))
      record.runtime?.fail(record.error.message)
      if (record.nodePhase) record.nodePhase = 'failed'
    }
    // Schedule cleanup after preparation settles to avoid awaiting this promise from itself.
    // A release that fails keeps its own error as cleanupError; the run's error stays the preparation's, with its cause (Cycle 0046 row 653).
    if (record.error)
      queueMicrotask(() => {
        void this.stopRecord(record).catch(() => undefined)
      })
  }

  /**
   * Names why a run's preparation failed, for {@link StudyService.prepare}'s catch.
   * A runtime that ends itself during preparation (a pause it did not declare, such as a learner's breakpoint on a line the page load runs) closes its own transport, and the preparation then rejects with that closure ("CDP disconnected"). The reason the runtime recorded first is the one an agent can act on, so it becomes the message and the cause.
   * @param record - The run whose preparation rejected.
   * @param error - What the preparation rejected with.
   * Whatever the failure, its message names its cause ({@link studyErrorNamingCause}): the message becomes the run's terminal reason and the reason its runtime journals as `run.failed`, and an error that is no {@link StudyError} would otherwise say only "The study operation failed." there, its own words staying in the cause alone (Cycle 0046 row 645).
   * A runtime that failed itself on an evidence write into the gone directory of a study removed during the preparation (a snapshot's save; `ConfiguredBrowserRun.track` fails the run with the write's raw error) gives a first failure that names the run's evidence directory. The run's error then notes that a write's raw failure made it (`errorSource`), so {@link StudyService.wordFailuresByRemoval} words it again once the removal is known, and a removal already known words it at once: the failed write and the removal's sentence ({@link StudyService.writeFailureError}), not the storage path, as rows 667, 700 and 707 word such an error (Cycle 0046 row 724).
   * @returns
   * - The runtime's own first failure as a `RUNTIME_FAILED` {@link StudyError}, when `error` is no {@link StudyError}.
   * - For that failure naming the run's evidence directory of a study already found removed: the `EVIDENCE_UNAVAILABLE` error of a failed evidence write, with the removal's sentence as its cause.
   * - Otherwise {@link domainError} of `error`, whose message names its cause where it did not.
   * @example
   * this.preparationError(record, new Error('CDP disconnected')).message
   * // => 'Unexpected or additional server stop invalidated the declared operation'
   * this.preparationError(record, new Error('The dedicated Application layout could not be confirmed.')).message
   * // => 'The study operation failed. Cause: The dedicated Application layout could not be confirmed.' (a runtime that recorded no failure)
   * this.preparationError(removedRecord, new Error('Repository run is unavailable')).message
   * // => "Evidence buffering or persistence failed. Cause: The archive of this run's saved study is no longer in the study library: …" (the runtime's first failure "Error: ENOENT: …/snapshot.json.tmp")
   */
  private preparationError(record: StudyRecord, error: unknown): StudyError {
    const runtime = record.runtime?.view(),
      runtimeFailure = runtime?.failures[0]
    if (!runtime || !runtimeFailure || error instanceof StudyError)
      return studyErrorNamingCause(domainError(error))
    // A failure naming the run's evidence directory is a failed evidence write's raw failure, which a removal of the study words by its own sentence (row 724).
    if (runtimeFailure.includes(runtime.artifactDirectory)) {
      const message = 'Evidence buffering or persistence failed.'
      record.errorSource = { kind: 'write', message, failure: runtimeFailure }
      if (isStudyRemovalExclusion(record.historyExcluded))
        return this.writeFailureError(record, message, runtimeFailure)
    }
    const reason = runtimeFailure.slice(0, MAX_UI_TEXT_CHARS)
    return new StudyError('RUNTIME_FAILED', reason, reason)
  }

  /**
   * Asks the study library whether it can keep this run's study, before a runtime exists or any input can be sent; called first by {@link StudyService.prepare} for a configured run.
   * Passing clears the record's `awaiting-admission` exclusion; a refusal replaces it with `refused-at-admission`, so the run is never written later.
   * @param record - The configured run that was just reserved.
   * @throws A `PREREQUISITE_MISSING` {@link StudyError} when the limit setting is invalid, the library is full, or the library cannot be read (its message names the read's error, which is also the cause).
   * @example
   * await this.admitStudy(record) // on a full library: record.historyExcluded === 'refused-at-admission'
   */
  private async admitStudy(record: StudyRecord): Promise<void> {
    const recordings = this.recordings
    if (!recordings) return
    // A failure of the read itself reaches prepare()'s catch, which decides the exclusion.
    const refusal = await this.studyRefusal(recordings, record).catch(
      (error: unknown) => {
        // The agent reads the code and message, not the cause, so the unreadable library is named there.
        throw new StudyError(
          'PREREQUISITE_MISSING',
          `The study library could not be read, so no run was started: ${this.sanitizedCause(thrownMessage(error))}. Repair or remove the entry it names in the learning library, then start again. Existing learning was kept.`,
          this.sanitizedCause(error),
        )
      },
    )
    record.historyExcluded = refusal ? 'refused-at-admission' : undefined
    if (refusal) throw new StudyError('PREREQUISITE_MISSING', refusal)
  }

  /**
   * Decides the history exclusion of a configured run whose preparation failed before its admission answered (no workspace, no repository storage, an admission read that failed); called by {@link StudyService.prepare}'s catch.
   * The library is asked the admission question once more without letting it throw, so a run on a full library is never written later by a reader checkpoint or Retry storage.
   * @param record - The run that failed while `awaiting-admission`.
   * @returns `refused-at-admission` when the library refuses the study, otherwise `undefined` (the run is saved as a failed preparation).
   * @example await this.exclusionAfterEarlyFailure(record) // => 'refused-at-admission' on a full library
   */
  private async exclusionAfterEarlyFailure(
    record: StudyRecord,
  ): Promise<HistoryExclusion | undefined> {
    const recordings = this.recordings
    if (!recordings) return undefined
    const refusal = await this.studyRefusal(recordings, record).catch(
      () => undefined,
    )
    return refusal ? 'refused-at-admission' : undefined
  }

  /**
   * Names why the study library cannot keep a run's study; called by {@link StudyService.admitStudy}.
   * @param recordings - The store whose capacity setting and library are asked.
   * @param record - The configured run that was just reserved.
   * @returns
   * - the setting sentence when the saved-study limit is invalid (the library is not read)
   * - the "library is full" sentence for this limit when the library refuses the study
   * - `undefined` when the library can keep the study
   * @throws The library read's own error.
   * @example
   * await this.studyRefusal(recordings, record) // => 'Study library is full. …' on a full library
   */
  private async studyRefusal(
    recordings: NonNullable<StudyService['recordings']>,
    record: StudyRecord,
  ): Promise<string | undefined> {
    const limit = recordings.capacityStatus().limit
    // An invalid limit is a setting the learner can fix, so it is refused here instead of failing the library read.
    if (limit === undefined) return INVALID_SAVED_STUDY_LIMIT_MESSAGE
    return (await recordings.admitsStudy(`${this.instanceId}_${record.id}`))
      ? undefined
      : fullLibraryMessage('run', limit, this.removalAvailability)
  }

  /**
   * Says whether the run's stop has ended after it sealed the run's recording, whether that stop stopped the run or failed after the seal ({@link stopRecord}); asked by {@link StudyWorkspace.checkpoint} as it takes a checkpoint of the run, which then holds the run's state after the seal.
   * Why: the save of such a checkpoint releases the record of the recording's writer ({@link removeWriterRecordsOfSealedRecordings}). A run whose release failed after the seal is never marked stopped, and nothing retries its stop by itself, so a release that waited for an archive that says `stopped` kept the recording held while the window lived, and Delete in another window was refused (Cycle 0047 row 140). A checkpoint taken before the seal, or while a stop runs, holds no state after the seal.
   * @param record - The run a checkpoint is taken of.
   * @returns `true` once the run's recording is sealed and no stop of the run is running; `false` while a stop runs, and for a run whose recording is not sealed or that has none.
   * @example
   * service.hasStopEndedAfterSeal(record) // => true after `await service.stop(identity)` rejected with 'owned browser close: timed out' once the recording was sealed
   */
  hasStopEndedAfterSeal(record: StudyRecord): boolean {
    return !record.stopping && record.recording?.isSealed === true
  }

  /**
   * Words why a browser run's recording ends before its run completed, for the recording's gap and its seal: the run's own failure as its `run.failed` event names it, or a release that did not complete; called by {@link StudyService.stopRecord}.
   * A run refused during its preparation used to read "Runtime interrupted or cleanup incomplete" in its recording although nothing was interrupted (Cycle 0052 task 7a).
   * @param failure - The run's `run.failed` event, if it has one.
   * @param error - The run's error, whose bare cause reads better than its wrapped message ("The study operation failed. Cause: …").
   * @returns The sentence, its cause cut so that the whole sentence fits {@link RECORDING_REASON_LIMIT_CHARS}.
   * @example
   * this.recordingStopReason(failedEvent, record.error) // => 'The run failed: Selected source app/ui/login-form.tsx is not in the client code … Recorded prefix retained.'
   * this.recordingStopReason(undefined, undefined) // => 'Runtime cleanup incomplete; recorded prefix retained.'
   */
  private recordingStopReason(
    failure: RecordedEvent | undefined,
    error: StudyError | undefined,
  ): string {
    if (!failure) return 'Runtime cleanup incomplete; recorded prefix retained.'
    const detail = failure.detail
    const reason =
      error?.causeDetail ??
      (typeof detail === 'object' &&
      detail !== null &&
      'reason' in detail &&
      typeof detail.reason === 'string'
        ? detail.reason
        : undefined)
    // A failure journaled without words still says the run failed rather than that it was interrupted.
    if (reason === undefined) return 'The run failed. Recorded prefix retained.'
    const sentence = (cause: string): string =>
      `The run failed: ${cause}. Recorded prefix retained.`
    // The recording keeps RECORDING_REASON_LIMIT_CHARS of a reason: a long cause is cut, never the sentence's end (Cycle 0052 task 74).
    return sentence(
      cutTextToFit(
        this.sanitizedCause(reason).replace(/\.$/, ''),
        (cause) => sentence(cause).length <= RECORDING_REASON_LIMIT_CHARS,
      ),
    )
  }

  /** Serializes release after acquisitions and accepted explanation writes settle. @example await this.stopRecord(record) */
  private async stopRecord(record: StudyRecord): Promise<void> {
    if (record.stopped) return
    record.stopping = true
    record.cancellation.abort()
    const attempt = (record.stopPromise ??= (async () => {
      // A held acquisition may need transport shutdown to settle; drain it only after cancellation is delivered.
      const cancelledRuntime = record.prepared ? undefined : record.runtime
      const cancellingNodeRun = record.prepared ? undefined : record.nodeRun
      const cancelling = cancelledRuntime?.stop()
      if (cancelling) void cancelling.catch(() => undefined)
      const cancellingNode = cancellingNodeRun?.stop()
      if (cancellingNode) void cancellingNode.catch(() => undefined)
      const cancellingServerRun = record.prepared
        ? undefined
        : record.nodeServer?.run
      const cancellingServer = cancellingServerRun?.stop()
      if (cancellingServer) void cancellingServer.catch(() => undefined)
      await record.preparation
      await cancelling
      await cancellingNode
      await cancellingServer
      await Promise.allSettled(
        [...record.explanationKeys.values()].map((value) => value.result),
      )
      await Promise.allSettled([...record.sourceReveals])
      if (record.runtime) {
        try {
          if (record.runtime !== cancelledRuntime) await record.runtime.stop()
        } finally {
          if (record.recording) {
            const runtime = record.runtime.view()
            const failure = runtime.events.find(
              (event) => event.type === 'run.failed',
            )
            if (failure || !runtime.resourcesReleased)
              record.recording.stopFrames(
                failure?.elapsedMs ?? record.runtime.evidence.elapsedMs(),
                this.recordingStopReason(failure, record.error),
              )
            try {
              const seal = await record.recording.finish(
                record.recordingEndMs ?? record.runtime.evidence.elapsedMs(),
              )
              await this.recordings?.read(record.recording.header.studyId)
              record.recordingSeal = seal
            } catch (error) {
              // One sanitized value for both: the recording's reason and the seal failure `codebook_stop` answers (F48).
              record.recordingSealFailure = this.sanitizedCause(error)
              record.recordingFailure = record.recordingSealFailure
              this.diagnose(
                'HISTORY_SEAL_FAILED',
                record,
                error,
                record.recordingSealFailure,
              )
            }
          }
        }
      }
      if (record.nodeRun && record.nodeRun !== cancellingNodeRun)
        await record.nodeRun.stop()
      // The server's process group, debugger and listeners are released in one bounded stop; a failed stop leaves the run stopping and retryable (D9).
      const serverRun = record.nodeServer?.run
      if (serverRun && serverRun !== cancellingServerRun) await serverRun.stop()
      record.nodeServer?.subscription?.dispose()
      // A root listing that was not released is the run's to release: one still running fails this stop, so the run stays unstopped, the next start answers BUSY, and the next stop tries again.
      if (record.unreleasedListings)
        await releaseVitestListings(record.unreleasedListings)
      // The continuation in flight settles first: its stop or result entry is written, or it failed (EN5).
      await record.nodeContinuation
      // A release that failed at an earlier stop is no error of the run once this stop released it (EN4).
      if (record.nodeRun && record.errorSource?.kind === 'release') {
        record.error = undefined
        record.errorSource = undefined
        record.releaseError = undefined
      }
      if (record.nodeHistoryWriter && record.nodeHistoryStatus === 'recording')
        await this.sealNodeHistory(record, record.nodeHistoryWriter)
      // A test run stopped before its history began recorded nothing: it reads ended, so it offers no history and frees its slot (F56).
      if (
        record.profile === NODE_TEST_PROFILE &&
        !record.nodeHistoryWriter &&
        record.historyExcluded === undefined
      )
        record.historyExcluded = 'stopped-before-history'
      // What the evidence failed with by the end is the run's; a later write's failure is not (row 699).
      record.evidenceFailureAtStop = record.runtime?.evidence.failure
      record.stopped = true
      record.cleanupError = undefined
      record.releaseError = undefined
    })())
    try {
      await attempt
    } catch (error) {
      // The raw failure stays for the wording of a removal found later (row 700).
      record.releaseError = error
      const failure = this.sanitizedFailure(this.releaseFailure(record, error))
      record.cleanupError = domainError(failure)
      record.stopPromise = undefined
      throw failure
    } finally {
      record.stopping = false
    }
  }

  /**
   * Seals a test run's history once its release and its continuation have ended; called by {@link StudyService.stopRecord}.
   * The seal is `complete` from the test's own facts (EN4): its last continuation completed, every declared stop was captured with every required fact read, and the result verifiably passed. A run that went on without a required fact (Cycle 0052 task 5) seals partial, naming the facts (task 72). Then the run's learning coverage is counted from the stops and the result the writer wrote and the material this window saved (EN2). A seal that throws leaves the journal as an interrupted prefix and the run's `HISTORY_SEAL_FAILED`, with its sanitized cause and one Output › Codebook entry.
   * @param record - The test run.
   * @param writer - Its history writer, still recording.
   * @example await this.sealNodeHistory(record, record.nodeHistoryWriter)
   */
  private async sealNodeHistory(
    record: StudyRecord,
    writer: NodeTestHistoryWriter,
  ): Promise<void> {
    const expectedStops = record.nodePrepared
      ? 1 + (record.nodePrepared.configuration.additionalStops?.length ?? 0)
      : Number.POSITIVE_INFINITY
    const passed =
      nodeTestResultKind(record.nodeResult) === 'passed' &&
      record.nodeResult?.reportFailure === undefined
    const capturedAll =
      record.nodePhase === 'completed' &&
      passed &&
      record.nodeStops?.length === expectedStops
    const unread = (record.nodeStops ?? []).flatMap((stop) =>
      this.unreadRequiredFacts(record, stop).map(
        (fact) => `${fact} at ${stop.source.path}:${stop.frame.line}`,
      ),
    )
    // A history whose stops lack a required fact lacks evidence the question asked for, however the test ended.
    const complete = capturedAll && unread.length === 0
    const reason = complete
      ? undefined
      : capturedAll
        ? this.sanitizedCause(
            `The test passed, but the debugger could not read the required ${unread.length === 1 ? 'fact' : 'facts'} ${unread.join(', ')}.`,
          )
        : this.partialHistoryReason(record)
    try {
      record.nodeHistoryHash = await this.finishNodeHistory(
        writer,
        complete ? 'complete' : 'partial',
        reason,
      )
      record.nodeHistoryStatus = complete ? 'complete' : 'partial'
      record.nodeHistoryEntryCount = writer.entryCount
      record.nodeHistoryReason = reason
      record.nodeLearning = this.nodeLearningOf(
        writer.learningNeeds(),
        record.nodeLearningMaterial,
        await this.captureMissingOf(writer.header.studyId),
      )
    } catch (error) {
      writer.abandon()
      record.nodeHistoryFailure = this.sanitizedCause(error)
      record.nodeHistoryStatus = 'failed'
      this.diagnose(
        'HISTORY_SEAL_FAILED',
        record,
        error,
        record.nodeHistoryFailure,
      )
    }
  }

  /**
   * Seals a test history, and once more after {@link SEAL_RETRY_DELAY_MS} when the first attempt failed with a transient file-system code ({@link TRANSIENT_SEAL_ERROR_CODES}); called by {@link StudyService.sealNodeHistory}.
   * The writer's seal is safe to repeat after a failure, so a passing run does not stay `partial` for an `EMFILE` that passed a moment later (F100, D14). A repeated `codebook_stop` still makes no second attempt.
   * @param writer - The history's writer.
   * @param status - `complete` or `partial`, as {@link NodeTestHistoryWriter.finish} takes it.
   * @param reason - Why a partial history ended.
   * @returns The sealed journal's SHA-256.
   * @throws The second attempt's failure, or the first attempt's when its code is not transient.
   * @example await this.finishNodeHistory(writer, 'complete', undefined)
   */
  private async finishNodeHistory(
    writer: NodeTestHistoryWriter,
    status: 'complete' | 'partial',
    reason: string | undefined,
  ): Promise<string | undefined> {
    try {
      return await writer.finish(status, reason)
    } catch (error) {
      // Any other code is a failure that waiting does not change.
      if (!TRANSIENT_SEAL_ERROR_CODES.includes(systemErrorCode(error)))
        throw error
      await this.sealRetryDelay(SEAL_RETRY_DELAY_MS)
      return writer.finish(status, reason)
    }
  }

  /**
   * Says why a test run's history ends partial, for its seal and the run resource's `recording.reason`; called by {@link StudyService.sealNodeHistory}.
   * @param record - The test run.
   * @returns The run's error, the result that did not pass, or that the run ended before its result, sanitized ({@link sanitizeCause}).
   * @example this.partialHistoryReason(record) // => 'The test did not pass: Test failed · exit code 1.'
   */
  private partialHistoryReason(record: StudyRecord): string {
    const kind = nodeTestResultKind(record.nodeResult)
    const reason = record.error
      ? record.error
      : kind === 'failed' || kind === 'signal'
        ? `The test did not pass: ${describeNodeTestResult(record.nodeResult)}.`
        : 'Node test was interrupted or did not produce every declared stop and a passing result.'
    return this.sanitizedCause(reason)
  }

  /**
   * Counts a test run's learning coverage from what its sealed journal asks to explain and the material this window saved; called at the seal and by {@link StudyService.explainNodeHistory} after each saved material, so {@link StudyService.state} only reads the result (EN2).
   * @param needs - The stops and the result the journal holds.
   * @param material - The material this window last saved, if any.
   * @returns The cache the run keeps.
   * @example this.nodeLearningOf({ stopSequences: [2] }, undefined).coverage // => 'none'
   */
  private nodeLearningOf(
    needs: NodeLearningNeeds,
    material: StudyRecord['nodeLearningMaterial'],
    captureMissing: NodeLearningCapturePart[] | undefined,
  ): NonNullable<StudyRecord['nodeLearning']> {
    return {
      needs,
      materialRevision: material?.revision ?? 0,
      ...listMissingNodeExplanations(needs, material?.content),
      captureMissing,
    }
  }

  /**
   * Reads the capture gaps of a sealed test history from the store's one summary, the rule Saved studies and Save read too; called by {@link StudyService.sealNodeHistory}, so the run resource exposes them without a store read (F72).
   * @param studyId - The sealed history's study id.
   * @returns The capture parts the journal lacks, or `undefined` when the summary could not be read or did not verify the journal.
   * @example await this.captureMissingOf(studyId) // => [{ kind: 'execution' }] for a history cut before its result
   */
  private async captureMissingOf(
    studyId: string,
  ): Promise<NodeLearningCapturePart[] | undefined> {
    const summary = await this.nodeHistoryStore
      ?.summarize(studyId)
      .catch(() => undefined)
    return summary?.verification === 'verified'
      ? summary.captureMissing
      : undefined
  }

  /**
   * Names why a run's release failed, for its `cleanupError` and for every caller of {@link StudyService.stopRecord} that reports that failure (the stop tool, the error of a run that ended without one at the maintenance turn, an incomplete shutdown); called by {@link StudyService.stopRecord} when the release threw.
   * A run whose saved study was removed while it ran lost its evidence directory with the archive, so the release's final evidence write fails too, and that write's raw error names the internal storage path, which {@link StudyService.evidenceFailureCause} keeps out of the run's error (row 667): the failed write and the removal's own sentence name it instead (Cycle 0046 row 686). A release that threw while the evidence still wrote failed for its own reason, which stays its cause.
   * @param record - The run whose release threw.
   * @param error - What the release threw.
   * @returns
   * - For a run whose saved study was removed and whose evidence failed: an error that names the failed evidence write and the removal ({@link historyExclusionReason})
   * - Otherwise: `error` itself
   * @example
   * this.releaseFailure(removedRecord, new Error("Evidence write failed: Error: ENOENT: no such file or directory, open '…/events.jsonl'")).message
   * // => "Evidence write failed: The archive of this run's saved study is no longer in the study library: its files were removed by hand or by another Codebook window."
   * this.releaseFailure(record, new Error('owned browser close: timed out')).message // => 'owned browser close: timed out'
   */
  private releaseFailure(record: StudyRecord, error: unknown): unknown {
    return isStudyRemovalExclusion(record.historyExcluded) &&
      record.runtime?.evidence.failure
      ? new Error(
          `Evidence write failed: ${historyExclusionReason(record.historyExcluded)}`,
        )
      : error
  }

  /**
   * Admits the next declared action of any profile; the `codebook_action` tool calls it. A browser run answers {@link StudyService.action} at once; a node-server run answers its `http-request` receipt after the learner confirmed a state-changing request (D6).
   * @param input - The action as the tool received it.
   * @returns The action's receipt: `operationId`, `key` and `runUri`; the original receipt for a repeat of the same key and action.
   * @throws What {@link StudyService.action} or {@link StudyService.requestNodeServer} throws.
   * @example await service.performAction({ ...run, key: 'send', action: 'http-request' })
   */
  async performAction(input: ActionInput) {
    this.assertMutable(input.instanceId)
    const record = this.record(input)
    return isNodeServerRecord(record)
      ? this.requestNodeServer(record, input)
      : this.action(input)
  }

  /**
   * Sends the declared request of a node-server run once: replays the receipt of a repeated key, refuses what the run's state refuses, asks the learner to confirm a POST, PUT, PATCH or DELETE (D6), then hands the key to the run.
   * The refusals come in this order: the stored receipt of the same key and action (also after a lost response); `LEARNER_PAUSED`; `REQUEST_ALREADY_SENT` (another key once sent); `RUN_NOT_READY`.
   * @param record - The node-server run.
   * @param input - The action as the tool received it.
   * @returns The receipt, once the run accepted the request; the original receipt for a repeat.
   * @throws `IDEMPOTENCY_CONFLICT` for a key that names another action; the refusals above; `BUSY` while another key waits for the learner's confirmation; `REQUEST_NOT_CONFIRMED` when the learner cancelled or did not answer (the state stays `ready` and the key is not consumed); `PREREQUISITE_MISSING` for a state-changing request in an editor that cannot ask; what the run throws.
   * @example await this.requestNodeServer(record, { ...run, key: 'send', action: 'http-request' })
   */
  private async requestNodeServer(
    record: NodeServerStudyRecord,
    input: ActionInput,
  ) {
    const signature = JSON.stringify([input.key, input.action])
    const replayed = this.replayedAction(record, input.key, signature)
    if (replayed) return replayed
    const pending = record.nodeServer.pendingRequest
    // A repeat of the key being confirmed joins the one confirmation instead of asking the learner twice.
    if (pending?.key === input.key && pending.signature === signature)
      return pending.result
    this.presentationController?.assertPresentationIdle()
    this.assertNodeServerRequestable(record, input.action)
    if (pending)
      throw new StudyError(
        'BUSY',
        'Another request is waiting for the learner to confirm it. Read the run resource; send nothing with a new key.',
      )
    const result = this.sendNodeServerRequest(record, input, signature)
    record.nodeServer.pendingRequest = { key: input.key, signature, result }
    try {
      return await result
    } finally {
      if (record.nodeServer.pendingRequest?.result === result)
        record.nodeServer.pendingRequest = undefined
    }
  }

  /**
   * Refuses a node-server request the run's state does not admit, in the order the contract names them; called before the confirmation and again after the learner answered it, since the run can have changed meanwhile.
   * @param record - The node-server run.
   * @param action - The action the call named.
   * @throws `LEARNER_PAUSED` while a pause Codebook does not own holds the server; `REQUEST_ALREADY_SENT` once a request went out; `RUN_NOT_READY` while the run is not `ready`, is ending or is past its deadline; `BUSY` for an action this profile does not offer.
   * @example this.assertNodeServerRequestable(record, 'http-request')
   */
  private assertNodeServerRequestable(
    record: NodeServerStudyRecord,
    action: string,
  ): void {
    const view = record.nodeServer.run?.view()
    if (
      view?.heldPause ||
      view?.state === 'learner-paused' ||
      view?.state === 'unattributed'
    )
      throw new StudyError(
        'LEARNER_PAUSED',
        'The server is paused by the learner in the native debugger, so no request is sent. Ask the learner to continue it there, then read the run.',
      )
    if (record.nodeServer.sentKey !== undefined || view?.request)
      throw new StudyError(
        'REQUEST_ALREADY_SENT',
        'The declared request was already sent in this run. Read the run resource for its pause, response or failure; a new request needs a new run.',
      )
    if (
      !record.prepared ||
      record.stopping ||
      record.stopped ||
      record.error ||
      record.cleanupError ||
      this.now() >= record.deadlineAt ||
      view?.state !== 'ready'
    )
      throw new StudyError(
        'RUN_NOT_READY',
        'The server run is not ready for its request. Read the run resource until its state is ready.',
      )
    if (action !== NODE_SERVER_ACTION)
      throw new StudyError(
        'BUSY',
        `Expected ${NODE_SERVER_ACTION}, received ${action}.`,
        `Read ${this.uri(record.id)} for current nextActions; nothing was dispatched.`,
      )
  }

  /**
   * Confirms a state-changing request with the learner when it needs one, then hands the key to the run and keeps its receipt; the work of {@link StudyService.requestNodeServer} behind its pending entry.
   * @param record - The node-server run.
   * @param input - The action as the tool received it.
   * @param signature - The action's signature, the key of its stored receipt.
   * @returns The receipt.
   * @throws See {@link StudyService.requestNodeServer}.
   * @example await this.sendNodeServerRequest(record, input, signature)
   */
  private async sendNodeServerRequest(
    record: NodeServerStudyRecord,
    input: ActionInput,
    signature: string,
  ) {
    const run = record.nodeServer.run
    const declaration = record.nodeServer.prepared?.configuration.request
    if (!run || !declaration)
      throw new StudyError(
        'RUN_NOT_READY',
        'The server run does not exist yet.',
      )
    if (NODE_SERVER_STATE_CHANGING_METHODS.includes(declaration.method)) {
      await this.confirmNodeServerRequest(record, declaration)
      // The run can have stopped, failed or been paused while the learner read the modal.
      this.assertNodeServerRequestable(record, input.action)
    }
    await run.sendRequest(input.key)
    record.nodeServer.sentKey = input.key
    const receipt = {
      operationId: randomUUID(),
      key: input.key,
      runUri: this.uri(record.id),
    }
    record.action = { signature, receipt }
    record.actions.set(input.key, record.action)
    return receipt
  }

  /**
   * Asks the learner, in the editor's native modal, whether to send a state-changing request; the chat AI cannot answer it (TD-6, D6).
   * @param record - The node-server run, whose cancellation closes the question and whose id keeps a modal another run left open from answering it.
   * @param declaration - The declared request, of which the modal names the method and path; the whole declaration identifies the question.
   * @throws `PREREQUISITE_MISSING` when the editor has no such modal; `REQUEST_NOT_CONFIRMED` when the learner cancelled, dismissed it, or did not answer within {@link StudyService.confirmationTimeoutMs} (the run stays `ready`; asking again needs the same or a new key).
   * @example await this.confirmNodeServerRequest(record, { method: 'POST', path: '/api/items' })
   */
  private async confirmNodeServerRequest(
    record: StudyRecord,
    declaration: NodeServerConfiguration['request'],
  ): Promise<void> {
    const confirm = this.environment.confirmStateChangingRequest
    if (!confirm)
      throw new StudyError(
        'PREREQUISITE_MISSING',
        'This editor cannot ask the learner to confirm a state-changing request, so Codebook sends no POST, PUT, PATCH or DELETE here.',
      )
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.confirmationTimeoutMs),
      record.cancellation.signal,
    ])
    const sent = await confirm
      .call(this.environment, { runId: record.id, ...declaration }, signal)
      .catch(() => false)
    if (!sent)
      throw new StudyError(
        'REQUEST_NOT_CONFIRMED',
        `The learner did not confirm the ${declaration.method} ${declaration.path} request, so nothing was sent. The run stays ready.`,
      )
  }

  /**
   * Continues a node-server run's current pause with the arguments the run resource gave, after the refusals of the contract: `LEARNER_PAUSED` first, then a run that is ending or past its deadline, `NO_PAUSE`, and `STALE_PAUSE` for another pause; called by {@link StudyService.continue}.
   * @param record - The node-server run.
   * @param input - The continuation arguments.
   * @returns The acknowledgement: `accepted` and the run's URI.
   * @throws The codes above; what the run throws when it reserves the pause.
   * @example await this.continueNodeServer(record, runState.participants.server.continueArguments)
   */
  private async continueNodeServer(
    record: NodeServerStudyRecord,
    input: ContinueInput,
  ) {
    const run = record.nodeServer.run
    const view = run?.view()
    if (
      view?.heldPause ||
      view?.state === 'learner-paused' ||
      view?.state === 'unattributed'
    )
      throw new StudyError(
        'LEARNER_PAUSED',
        'The server is paused by the learner in the native debugger, which Codebook never resumes. Ask the learner to continue it there, then read the run.',
      )
    // A run the environment has not created yet has no pause at all.
    if (!run)
      throw new StudyError(
        'NO_PAUSE',
        'The server run is not started yet, so nothing is paused. Read the run resource until it is ready.',
      )
    // A run that is ending, failed or past its deadline has only historical pauses.
    if (
      record.stopping ||
      record.stopped ||
      record.error ||
      record.cleanupError ||
      this.now() >= record.deadlineAt
    )
      throw new StudyError(
        'STALE_PAUSE',
        'The server run is ending or has ended, so this pause is historical and cannot be resumed.',
      )
    const pause = view?.pause
    if (!pause)
      throw new StudyError(
        'NO_PAUSE',
        'The server is not paused at a declared stop. Read the run resource; continue only a pause it shows.',
      )
    if (
      input.participant !== 'server' ||
      input.sessionId !== pause.sessionId ||
      input.threadId !== pause.threadId ||
      input.generation !== pause.generation
    )
      throw new StudyError(
        'STALE_PAUSE',
        'This is not the current pause of the server. Copy participants.server.continueArguments from the run resource.',
      )
    await run.continue({
      sessionId: input.sessionId,
      threadId: input.threadId,
      generation: input.generation,
    })
    return { accepted: true, runUri: this.uri(record.id) }
  }

  /**
   * Continues a node-server run and, with `answer: "next"`, waits for what the request does next: the next stop, the response, a request failure, a pause of the learner, an unattributed hit, the end of the run or its failure (bounded as the other profiles' wait).
   * @param record - The node-server run.
   * @param input - The continuation arguments.
   * @param startedAtMs - When the call began, for the call's budget.
   * @param signal - The request's cancellation.
   * @returns The acknowledgement; with `answer: "next"` also `next` (the word of {@link nextNodeServerState}, absent at the bound) and the run's `state`.
   * @throws What {@link StudyService.continueNodeServer} throws; nothing is awaited after a refusal.
   * @example await this.continueNodeServerToNextState(record, args, this.now())
   */
  private async continueNodeServerToNextState(
    record: NodeServerStudyRecord,
    input: ContinueInput,
    startedAtMs: number,
    signal?: AbortSignal,
  ) {
    const generationBefore = record.nodeServer.run?.view().pauseGeneration ?? 0
    const receipt = await this.continue(input)
    if (input.answer !== 'next') return receipt
    const waitEndsAtMs = Math.min(
      this.now() + ACTIVE_TIMEOUT_MS + CONTINUE_ANSWER_GRACE_MS,
      startedAtMs + CONTINUE_ANSWER_CALL_BUDGET_MS,
    )
    const next = await waitForNextRunState(
      () => this.nextNodeServerStep(record, generationBefore),
      () => this.now() >= waitEndsAtMs,
      signal,
    )
    return { ...receipt, ...(next && { next }), state: this.state(record) }
  }

  /**
   * Reads what a continued node-server run did, at every turn of the wait of {@link StudyService.continueNodeServerToNextState}.
   * @param record - The node-server run.
   * @param generationBefore - The pause generation when the call began.
   * @returns See {@link nextNodeServerState}.
   * @example this.nextNodeServerStep(record, 1) // => 'responded' once the response arrived
   */
  private nextNodeServerStep(
    record: NodeServerStudyRecord,
    generationBefore: number,
  ) {
    // The whole-run deadline is the run's own end: apply it now, so the answer carries it.
    this.expireAtDeadline(record)
    this.adoptNodeServerFailure(record)
    const view = record.nodeServer.run?.view()
    return nextNodeServerState(view, generationBefore, {
      failed: Boolean(record.error || view?.runFailure),
      ended: Boolean(
        record.stopping ||
        record.stopped ||
        record.cleanupError ||
        this.stopping,
      ),
    })
  }

  /**
   * Gives a node-server run's own failure (the server exited, the pause hold expired, the runtime failed) the run's error and releases the run, so every reader names the same end (D1); a request failure is not one, it ends the request and not the server.
   * Called when the run reports a change and at each maintenance turn.
   * @param record - The node-server run.
   * @example this.adoptNodeServerFailure(record) // record.error?.code === 'SERVER_EXITED' once the run reported it
   */
  private adoptNodeServerFailure(record: StudyRecord): void {
    const failure = record.nodeServer?.run?.view().runFailure
    if (!failure || record.error || record.stopped) return
    record.error = this.sanitizedError(failure)
    this.logNodeServerFailure(record, record.error)
    void this.stopRecord(record).catch((error) => {
      this.failByRelease(record, error)
    })
  }

  /**
   * Reacts to a change of a node-server run: a failure of the run ends it; called by the subscription made when the run was created.
   * @param record - The node-server run.
   * @example run.onDidChange(() => this.onNodeServerChange(record))
   */
  private onNodeServerChange(record: StudyRecord): void {
    this.adoptNodeServerFailure(record)
  }

  /**
   * Writes a failure of a node-server run to the Output › Codebook channel once per code and message, for failures the run reported no `node-server.failure` event for (a refused start, a failure of the request or of the run).
   * @param record - The node-server run.
   * @param failure - The failure, already sanitized.
   * @example this.logNodeServerFailure(record, record.error)
   */
  private logNodeServerFailure(
    record: StudyRecord,
    failure: { code: string; message: string },
  ): void {
    const logged = record.nodeServer?.loggedFailures
    const identity = `${failure.code}\u0000${failure.message}`
    if (!logged || logged.has(identity)) return
    logged.add(identity)
    this.writeOutputLine(
      describeNodeServerFailureLine(record.id, failure.code, failure.message),
    )
  }

  /**
   * Writes one line to the Output › Codebook channel; a sink that throws (the channel after deactivation) never escapes the run that reports.
   * @param line - The plain line.
   * @example this.writeOutputLine({ level: 'info', text: 'Run r1: sent GET /api/healthz to 127.0.0.1:4100 (0 body bytes).' })
   */
  private writeOutputLine(line: NodeServerOutputLine): void {
    try {
      this.outputLog?.(line)
    } catch {
      // The line is also in the run's events; the channel has nowhere to write.
    }
  }

  /**
   * Prepares a node-server run asynchronously: workspace trust first, the cited sources pinned from the published book node, the profile's prerequisites, then the environment's run and its own preparation; a rejection is the run's error and the run is released (D5, D12).
   * @param record - The node-server run.
   * @example record.preparation = this.prepareNodeServer(record)
   */
  private async prepareNodeServer(record: StudyRecord): Promise<void> {
    // Every node-server record is created with its server state.
    if (!isNodeServerRecord(record)) return
    try {
      await this.startNodeServerRun(record)
    } catch (error) {
      // A stop cancelled this preparation: the run ends as stopped, with no error of its own.
      if (record.stopping) return
      record.error = this.sanitizedError(this.preparationError(record, error))
      this.logNodeServerFailure(record, record.error)
    }
    // Release after preparation settles, so this promise is never awaited from itself.
    if (record.error)
      queueMicrotask(() => {
        void this.stopRecord(record).catch(() => undefined)
      })
  }

  /**
   * The steps of a node-server preparation, each of which can refuse the run before the next one starts.
   * @param record - The node-server run.
   * @throws `PREREQUISITE_MISSING` for an untrusted workspace, missing storage, an unready profile or an environment without the run factory; the pinning's refusals; the run's rejection.
   * @example await this.startNodeServerRun(record)
   */
  private async startNodeServerRun(
    record: NodeServerStudyRecord,
  ): Promise<void> {
    this.environment.assertWorkspace?.()
    if (!this.repository)
      throw new StudyError(
        'PREREQUISITE_MISSING',
        'Repository source/book storage is unavailable in this editor.',
      )
    const state = record.nodeServer
    state.prepared = await prepareNodeServerStudy(
      record.configuration,
      this.repository,
      {
        signal: record.cancellation.signal,
        deadlineAt: Math.min(
          record.deadlineAt,
          record.createdAt + REPOSITORY_SETUP_TIMEOUT_MS,
        ),
      },
      this.now,
    )
    this.environment.assertWorkspace?.()
    // A start waits only on what it needs (the editor's own, Node and the machine), not on the other profiles' searches.
    const prerequisites = this.environment.nodeServerStartPrerequisites
      ? await this.environment.nodeServerStartPrerequisites()
      : await this.environment
          .prerequisites()
          .then(
            (reported) => reported.profiles?.[NODE_SERVER_PROFILE] ?? reported,
          )
    if (!prerequisites.ready)
      throw new StudyError(
        'PREREQUISITE_MISSING',
        prerequisites.missing.join('; '),
      )
    if (!this.environment.createNodeServerRun)
      throw new StudyError(
        'PREREQUISITE_MISSING',
        'The owned Node server adapter is unavailable.',
      )
    if (this.stopping || record.stopping) return
    const run = await this.environment.createNodeServerRun(
      state.prepared.configuration,
      createNodeServerJournal(record.nodeEvents ?? [], {
        sanitize: (text) => this.sanitizedCause(text),
        onEvent: (type, detail) =>
          this.writeNodeServerEventLine(record, type, detail),
      }),
      state.prepared.descriptor.sources,
      record.id,
    )
    state.run = run
    state.subscription = run.onDidChange(() => this.onNodeServerChange(record))
    if (this.stopping || record.stopping) return
    await run.prepare()
    record.prepared = true
  }

  /**
   * Writes the Output › Codebook line of a whitelisted node-server event, when it has one: the request, and the response or the failure.
   * @param record - The node-server run.
   * @param type - The event type.
   * @param detail - The whitelisted detail.
   * @example this.writeNodeServerEventLine(record, 'node-server.request', detail)
   */
  private writeNodeServerEventLine(
    record: StudyRecord,
    type: string,
    detail: Record<string, unknown>,
  ): void {
    const line = describeNodeServerOutputLine(record.id, type, detail)
    if (!line) return
    if (type === 'node-server.failure' && typeof detail.code === 'string')
      record.nodeServer?.loggedFailures.add(
        `${detail.code}\u0000${String(detail.cause)}`,
      )
    this.writeOutputLine(line)
  }

  /** Returns the original preparing receipt even after later transitions, allowing safe same-key retries. @example this.receipt(record).runId */
  private receipt(record: StudyRecord) {
    return {
      instanceId: this.instanceId,
      runId: record.id,
      runUri: this.uri(record.id),
      accepted: true,
      deadlineAt: new Date(record.deadlineAt).toISOString(),
    }
  }
  /** Rejects mutations during shutdown before their first async operation. @example this.assertMutable(instanceId) */
  private assertMutable(instanceId: string): void {
    this.assertInstance(instanceId)
    if (this.stopping)
      throw new StudyError('SERVER_STOPPING', 'Server is stopping.')
  }
  /** Separates credential validation from explicit application identity. @example this.assertInstance(instanceId) */
  private assertInstance(instanceId: string): void {
    if (instanceId !== this.instanceId)
      throw new StudyError(
        'STALE_INSTANCE',
        'This connection serves a different instance.',
      )
  }
}

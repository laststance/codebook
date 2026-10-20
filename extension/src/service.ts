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
  NODE_TEST_MINIMUM_EXTENSION_VERSION,
  NODE_TEST_PROFILE,
  REPOSITORY_BROWSER_ACTION,
  REPOSITORY_BROWSER_PROFILE,
  REPOSITORY_CONFIG_LIMIT_BYTES,
  REPOSITORY_INSPECTION_LIMIT,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
  REPOSITORY_RUN_TIMEOUT_MS,
  REPOSITORY_SETUP_TIMEOUT_MS,
  RETIRED_PRESENTATION_REFUSAL,
  SELECTABLE_PRESENTATION_MODE,
  PRESENTATION_MODE_IDS,
  STUDY_PRESENTATIONS,
} from './constants'
import { StudyError, domainError } from './errors'
import {
  learningSummarySchema,
  type LearningSummary,
} from './learningSummarySchemas'
import type { NodeTestConfiguration } from './nodeTestConfigSchemas'
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
  NodeTestRuntime,
  RuntimeSnapshot,
  RuntimeView,
  StudyEnvironment,
  StudyRuntime,
} from './runtime'
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
import { declaredStopOfSnapshot } from './utils/declaredStopOfSnapshot'
import { describeBoundPlace, type BoundPlace } from './utils/describeBoundPlace'
import { describeMissingBookNode } from './utils/describeMissingBookNode'
import {
  explanationPlace,
  type ExplanationPlace,
} from './utils/explanationPlace'
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
import { namesLineNumber } from './utils/namesLineNumber'
import { numberSourceLines } from './utils/numberSourceLines'
import { prepareNodeTestStudy } from './utils/prepareNodeTestStudy'
import { prepareRepositoryStudy } from './utils/prepareRepositoryStudy'
import { readerNotFollowingRunRefusal } from './utils/readerNotFollowingRunRefusal'
import { resolveCapturedFactPaths } from './utils/resolveCapturedFactPaths'
import { snapshotSourceHashes } from './utils/snapshotSourceHashes'
import { studyErrorNamingCause } from './utils/studyErrorNamingCause'
import { thrownMessage } from './utils/thrownMessage'
import { waitForNextRunState } from './utils/waitForNextRunState'

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
export type StudyRecord = StudyRecordState &
  StartIntent & {
    definition?: ConfiguredDefinition
    nodePrepared?: {
      configuration: NodeTestConfiguration
      configurationHash: string
      descriptor: ConfiguredDescriptor
    }
  }
/**
 * Why the reader must not checkpoint a retained run and why its state reports no saved history.
 * - `awaiting-admission`: the study library has not answered yet whether it can keep this run's study.
 * - `refused-at-admission`: the library was full or its limit setting invalid, so the run never started.
 * - `removed-by-learner`: the learner moved the run's saved study to the system Trash with this window's delete.
 * - `archive-removed`: the run's saved study left the library without a removal of this window, so its archive is gone: its files were removed by hand (a window without a Trash offers nothing else), or another window removed it.
 */
export type HistoryExclusion =
  'awaiting-admission' | 'refused-at-admission' | StudyRemovalExclusion
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
  nodeResult?: Awaited<ReturnType<NodeTestRuntime['complete']>>
  nodePhase?: 'preparing' | 'paused' | 'advancing' | 'completed' | 'failed'
  nodeHistoryWriter?: NodeTestHistoryWriter
  nodeHistoryStatus?: 'recording' | 'complete' | 'partial' | 'failed'
  nodeHistoryFailure?: string
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
  private readonly repositoryRetirement = new AbortController()
  private readonly repositoryOpens = new Set<Promise<unknown>>()
  private readonly startKeys = new Map<string, StudyRecord>()
  private readonly maintenance: ReturnType<typeof setInterval>
  private stopping = false
  private shutdownPromise?: Promise<void>

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
    const [prerequisites, repository] = await Promise.all([
      this.environment
        .prerequisites()
        .catch((error) => ({ ready: false, missing: [String(error)] })),
      this.repository
        ? this.sources({ instanceId: this.instanceId }).then(
            () => ({ ready: true, reason: undefined }),
            (error) => ({ ready: false, reason: String(error) }),
          )
        : Promise.resolve({
            ready: false,
            reason: 'Repository storage is unavailable.',
          }),
    ])
    const profilePrerequisites =
      'profiles' in prerequisites ? prerequisites.profiles : undefined
    const commonPrerequisites = {
      ready: prerequisites.ready,
      missing: prerequisites.missing,
    }
    const nodeTestPrerequisites =
      profilePrerequisites?.[NODE_TEST_PROFILE] ?? commonPrerequisites
    const nodeTestAdapter =
      this.environment.createNodeTestRun && this.nodeHistoryStore
        ? nodeTestPrerequisites
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
            available: false,
            reason:
              'Node test application video and synchronized application replay are unavailable. Agent-authored learning material is stored separately with the durable evidence journal.',
          },
        },
      ],
      capabilities: [
        'start',
        REPOSITORY_BROWSER_ACTION,
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

  /** Routes a typed historical control to the workspace's shared controller, never to a live runtime operation. @example service.playback({...identity,action:'pause',expectedRevision:2}) */
  playback(input: PlaybackCommand) {
    this.assertMutable(input.instanceId)
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
    if (
      input.profile !== REPOSITORY_BROWSER_PROFILE &&
      input.profile !== NODE_TEST_PROFILE
    )
      throw new StudyError(
        'UNSUPPORTED_PROFILE',
        `Available profiles: ${REPOSITORY_BROWSER_PROFILE}, ${NODE_TEST_PROFILE}`,
      )
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
   * A run the study library refused and that has ended had no effect, so its key is free: it is returned apart from `previous`, no conflict check applies to it, and {@link StudyService.reserveRunSlot} forgets it once every guard of the repeat has passed. A repeat that a guard rejects therefore leaves the refused run and its receipt as they were.
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
    const isStoppedRefusal =
      named?.historyExcluded === 'refused-at-admission' && named.stopped
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

  /** Admits the next fixed action while replaying every original receipt across later steps and cleanup. @example service.action({...run, key:'operation', action:'repository-click'}) */
  action(input: ActionInput) {
    this.assertMutable(input.instanceId)
    const record = this.record(input)
    const signature = JSON.stringify([input.key, input.action])
    const previous = record.actions.get(input.key)
    if (previous) {
      if (previous.signature === signature) return previous.receipt
      throw new StudyError(
        'IDEMPOTENCY_CONFLICT',
        'Action key already names different arguments.',
        `Read ${this.uri(record.id)} for retained receipts.`,
      )
    }
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
        String(error),
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
    if (record.profile === NODE_TEST_PROFILE) {
      const current = record.nodeStops?.at(-1)
      if (
        !record.nodeRun ||
        !current ||
        record.nodePhase !== 'paused' ||
        record.stopping ||
        record.stopped ||
        record.error ||
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
      try {
        if (record.nodeRun.hasNextStop()) {
          const next = await record.nodeRun.advance()
          await record.nodeHistoryWriter?.appendStop(next)
          record.nodeStops!.push(next)
          record.nodePhase = 'paused'
        } else {
          record.nodeResult = await record.nodeRun.complete()
          await record.nodeHistoryWriter?.appendResult(
            record.nodeResult,
            record.nodeResult.elapsedMs,
          )
          record.nodePhase = 'completed'
        }
      } catch (error) {
        record.error = studyErrorNamingCause(domainError(error))
        record.nodePhase = 'failed'
        queueMicrotask(() => {
          void this.stopRecord(record).catch(() => undefined)
        })
        throw record.error
      }
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
        String(error),
      )
    }
    return { accepted: true, runUri: this.uri(record.id) }
  }

  /** Stops a run through its shared cleanup barrier; historical resources remain available. @example await service.stop({instanceId,runId}) */
  async stop(input: RunInput) {
    const record = this.record(input)
    await this.stopRecord(record)
    return this.state(record)
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
    record.errorSource = { kind: 'write', message, failure: String(error) }
    // The run fails with the write: its runtime journals the cause as run.failed, as every other failure path of a run does (Cycle 0046 row 665).
    record.runtime!.fail(record.error.message)
    return failure
  }

  /**
   * Makes the error of a failed evidence write, the run's evidence failure at the maintenance turn or an explanation's save, whose message names its cause; called by {@link StudyService.maintain}, by {@link StudyService.explanationFailure} and, once the study turns out removed, by {@link StudyService.wordFailuresByRemoval}, so each words the same failure the same way.
   * The cause is the write's own failure, or the removal's sentence for a run whose saved study was removed ({@link StudyService.evidenceFailureCause}, rows 667 and 700).
   * @param record - The run whose write failed.
   * @param message - What failed: `'Evidence buffering or persistence failed.'` or `'Explanation was not committed.'`.
   * @param failure - The write's raw failure.
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
        this.evidenceFailureCause(record, failure),
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
    try {
      const material = await this.nodeHistoryStore.saveLearningMaterial(
        parsed.studyId,
        parsed.expectedRevision,
        parsed.content,
      )
      this.presentationController?.nodeHistoryLearningMaterialSaved(
        parsed.studyId,
        material,
      )
      return material
    } catch (error) {
      if (String(error).includes('revision changed'))
        throw new StudyError(
          'IDEMPOTENCY_CONFLICT',
          'Node learning material changed; read the latest material and retry with its revision.',
          String(error),
        )
      if (String(error).includes('does not match its sealed history'))
        throw new StudyError(
          'INVALID_REFERENCE',
          'A learning sequence step does not match the selected sealed Node history.',
          String(error),
        )
      throw error
    }
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
    const failure = this.releaseFailure(record, record.releaseError)
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
          reason: String(error).slice(0, MAX_UI_TEXT_CHARS),
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
    return record.stopped
      ? record.evidenceFailureAtStop
      : record.runtime?.evidence.failure
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
    // Only a removed study's failure that names its evidence directory is worded again.
    if (
      !runtime ||
      failure === undefined ||
      !isStudyRemovalExclusion(record.historyExcluded) ||
      !failure.includes(runtime.artifactDirectory)
    )
      return failure
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
    const canControl =
      !this.stopping &&
      !record.stopping &&
      !record.stopped &&
      !terminalReason &&
      this.now() < record.deadlineAt
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
    const nodeOutcome =
      record.profile === NODE_TEST_PROFILE
        ? record.error ||
          (record.nodeResult &&
            (record.nodeResult.exitCode !== 0 ||
              record.nodeResult.signal !== null))
          ? 'not-demonstrated'
          : record.nodePhase === 'completed'
            ? 'partial'
            : 'pending'
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
      browser: participantView('browser'),
    }
    const finalOutcome =
      nodeOutcome ??
      (terminalReason
        ? 'not-demonstrated'
        : (runtime?.finalOutcome ?? 'pending-teardown'))
    // A refused or removed run has no history to read or to add to.
    const holdsHistory =
      historyExclusionState(record.historyExcluded) !== 'ended'
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
    const nextActions = [
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
      holdsHistory ? 'read-history' : undefined,
    ].filter((value) => value !== undefined)
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
              historyUri: record.nodeHistoryWriter
                ? `codebook://node-history/${encodeURIComponent(record.nodeHistoryWriter.header.studyId)}`
                : undefined,
              historyStatus:
                record.nodeHistoryStatus ??
                (record.nodeHistoryWriter ? 'recording' : 'unavailable'),
              historyReason: record.nodeHistoryFailure,
              recordingAvailable: false,
              replayAvailable: false,
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
      material.finalOutcome === 'not-demonstrated'
        ? 'not-demonstrated'
        : material.finalOutcome === 'partial'
          ? 'partial'
          : material.finalOutcome !== 'demonstrated' || !terminal
            ? 'pending'
            : historyOutcome.status === 'saved'
              ? 'demonstrated'
              : historyOutcome.status === 'pending'
                ? 'pending'
                : 'partial'
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
    const recording = {
      capture,
      status:
        record.profile === NODE_TEST_PROFILE
          ? ('unavailable' as const)
          : record.recordingFailure || recordingRemoved
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
      reason:
        record.profile === NODE_TEST_PROFILE
          ? 'Node test application video and synchronized replay are unavailable; inspect nodeTest.historyUri for its separate durable evidence journal.'
          : recordingRemoved
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
      studyOutcome === 'not-demonstrated'
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
                : 'partial'
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
    record.error = studyErrorNamingCause(domainError(error))
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
    record.error ??= new StudyError(
      'RUNTIME_FAILED',
      'Study wall deadline expired; history only.',
    )
    record.runtime?.fail(record.error.message)
    this.failUnfinishedNodePhase(record)
  }

  /**
   * Says whether a run ended before its whole-run deadline could apply, so the deadline's error is never added to it; the guard of {@link StudyService.expireAtDeadline} for both of its callers.
   * @param record - The run whose deadline passed.
   * @returns `true` for a run that is stopped or being stopped, and for one whose runtime completed (its result was observed and only the release is left); `false` for a run that is still on its way.
   * @example this.hasRunEnded(record) // => true once record.runtime.view().status === 'completed'
   */
  private hasRunEnded(record: StudyRecord): boolean {
    return (
      record.stopped ||
      record.stopping ||
      record.runtime?.view().status === 'completed'
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
      const prerequisites = await this.environment.prerequisites()
      // Shared Node/Chrome availability alone cannot authorize an unsupported selected profile.
      const selectedPrerequisites =
        prerequisites.profiles?.[record.profile] ?? prerequisites
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
        const studyId = `${this.instanceId}_${record.id}`
        record.nodeHistoryWriter = await this.nodeHistoryStore.start({
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
        record.nodeHistoryStatus = 'recording'
        let sequence = 0,
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
                              ? { started: true }
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
              type: type.slice(0, 128),
              detail: bounded,
            })
            return historyWrite
          },
          record.nodePrepared.descriptor.sources,
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
            record.recordingFailure = `Recording unavailable before input: ${String(error)}`
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
      record.error = this.preparationError(record, error)
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
          `The study library could not be read, so no run was started: ${thrownMessage(error)}. Repair or remove the entry it names in the learning library, then start again. Existing learning was kept.`,
          String(error),
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
      await record.preparation
      await cancelling
      await cancellingNode
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
                'Runtime interrupted or cleanup incomplete; recorded prefix retained.',
              )
            try {
              const seal = await record.recording.finish(
                record.recordingEndMs ?? record.runtime.evidence.elapsedMs(),
              )
              await this.recordings?.read(record.recording.header.studyId)
              record.recordingSeal = seal
            } catch (error) {
              record.recordingFailure = String(error).slice(
                0,
                MAX_UI_TEXT_CHARS,
              )
            }
          }
        }
      }
      if (record.nodeRun && record.nodeRun !== cancellingNodeRun)
        await record.nodeRun.stop()
      if (
        record.nodeHistoryWriter &&
        record.nodeHistoryStatus === 'recording'
      ) {
        const expectedStops = record.nodePrepared
          ? 1 + (record.nodePrepared.configuration.additionalStops?.length ?? 0)
          : Number.POSITIVE_INFINITY
        const complete =
          record.nodePhase === 'completed' &&
          record.nodeResult?.exitCode === 0 &&
          record.nodeResult.signal === null &&
          record.nodeStops?.length === expectedStops &&
          !record.error
        const reason =
          record.nodeHistoryFailure ??
          (complete
            ? undefined
            : (record.error?.message ??
              'Node test was interrupted or did not produce every declared stop and a passing result.'))
        try {
          await record.nodeHistoryWriter.finish(
            complete ? 'complete' : 'partial',
            reason,
          )
          record.nodeHistoryStatus = complete ? 'complete' : 'partial'
        } catch (error) {
          record.nodeHistoryWriter.abandon()
          record.nodeHistoryFailure = String(error).slice(0, MAX_UI_TEXT_CHARS)
          record.nodeHistoryStatus = 'failed'
        }
      }
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
      const failure = this.releaseFailure(record, error)
      record.cleanupError = domainError(failure)
      record.stopPromise = undefined
      throw failure
    } finally {
      record.stopping = false
    }
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

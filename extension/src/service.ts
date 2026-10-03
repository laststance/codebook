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
import { fullLibraryMessage } from './utils/fullLibraryMessage'
import { historyExclusionReason } from './utils/historyExclusionReason'
import { isPausedAtSnapshot } from './utils/isPausedAtSnapshot'
import type { NodeTestOutputEvent } from './utils/launchNodeTest'
import { prepareNodeTestStudy } from './utils/prepareNodeTestStudy'
import { prepareRepositoryStudy } from './utils/prepareRepositoryStudy'
import { snapshotSourceHashes } from './utils/snapshotSourceHashes'

export interface Explanation {
  id: string
  instanceId: string
  runId: string
  snapshotUri: string
  sourceHash: string
  capturedFacts: { path: string; value: ConfiguredFactValue }[]
  learningSummary?: LearningSummary
  agentInterpretation: string
  createdAt: string
  learnerUnderstandingChanged: false
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
 * - `removed-by-learner`: the learner moved the run's saved study to the system Trash.
 */
export type HistoryExclusion =
  'awaiting-admission' | 'refused-at-admission' | 'removed-by-learner'
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
  stopPromise?: Promise<void>
  cleanupError?: StudyError
  error?: StudyError
  action?: {
    signature: string
    receipt: { operationId: string; runUri: string; key: string }
  }
  actions: Map<string, NonNullable<StudyRecord['action']>>
  explanations: Map<string, Explanation>
  explanationKeys: Map<
    string,
    { signature: string; result: Promise<{ explanationUri: string }> }
  >
  sourceReveals: Set<Promise<void>>
  historyReceipt?: {
    revision: number
    signature: string
    status: 'pending' | 'saved' | 'failed'
    reason?: string
  }
  historyExcluded?: HistoryExclusion
  /** Set by {@link StudyService.withEvidenceHeld} while the reader moves this run's saved study, so no explanation is written into the evidence directory on its way to the Trash. */
  evidenceHeld?: boolean
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

/** Owns MCP intent/history independently of transport sessions; commands construct it once per editor instance. @example service.start({instanceId, profile: REPOSITORY_BROWSER_PROFILE, key: "study-1", configuration}) */
export class StudyService {
  readonly instanceId = randomUUID()
  readonly records = new Map<string, StudyRecord>()
  recordings?: RecordingStore
  playbackController?: PlaybackController
  presentationController?: Pick<
    StudyWorkspace,
    | 'readPresentationState'
    | 'changePresentation'
    | 'returnToCurrent'
    | 'assertPresentationIdle'
    | 'nodeHistoryLearningMaterialSaved'
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
    // MCP transports -> one service -> owned runtime. Transport close never replays input.
    this.maintenance = setInterval(
      () => this.maintain(),
      MAINTENANCE_INTERVAL_MS,
    )
    this.maintenance.unref()
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
            capacity: this.recordings.capacityStatus(),
            instructions:
              'Saved recordings survive server/runtime exit. Discover their study IDs using libraryUri; current-instance URIs and playback revisions must be copied, not guessed. Playback never starts, clicks or continues a run.',
          }
        : undefined,
      presentation: this.presentationController
        ? {
            ...(await this.presentationState(this.instanceId)),
            instructions:
              'Before runtime application input, open a closed learner workspace by selecting its reported current mode; preserve its saved preference. Confirm state open and layoutConfirmed true, or follow the reported recovery before proceeding. Select the same learner workspace in three modes. Copy presentationId and presentationControlRevision as expectedRevision for mode changes. Before a new run, if reader.contentTab is not live or reader.followingCurrentRun is false, use codebook_return_current with reader.contentRevision as expectedRevision; verify both live and followingCurrentRun true so captured values and explanations are visible. It preserves saved history and never sends application input. Selection pauses replay at its confirmed position. Read state after response loss; restore repairs layout, save-preference retries only the current confirmed preference. No runtime or understanding mutation.',
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

  /** Reads one exact tracked source without navigating or running the application. @example await service.source({instanceId,path:'src/main.ts'}) */
  async source(input: SourceReadInput) {
    const result = await this.repositoryStore(input.instanceId).sources.read(
      input.path,
      input.expectedHash,
    )
    this.repositoryStore(input.instanceId)
    return { instanceId: this.instanceId, ...result }
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
    try {
      return {
        ...this.playbackController.command(input),
        uri: `codebook://${this.instanceId}/playback`,
      }
    } catch (error) {
      throw new StudyError(
        String(error).includes('Stale playback revision')
          ? 'STALE_PLAYBACK'
          : 'PLAYBACK_UNAVAILABLE',
        String(error),
        `Read codebook://${this.instanceId}/playback before retrying. No application input was sent.`,
      )
    }
  }

  /** Discovers the reader lifetime separately from the server without opening a view; called by MCP resources. @example (await service.presentationState(instanceId)).presentationId */
  async presentationState(instanceId: string) {
    this.assertInstance(instanceId)
    if (!this.presentationController)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'The Study reader is unavailable in this host.',
      )
    return {
      instanceId: this.instanceId,
      ...(await this.presentationController.readPresentationState()),
      uri: `codebook://${this.instanceId}/presentation`,
      modes: PRESENTATION_MODE_IDS.map((mode) => ({
        mode,
        title: STUDY_PRESENTATIONS[mode].title,
        description: STUDY_PRESENTATIONS[mode].description,
      })),
    }
  }

  /** Routes explicit mode intent to the shared reader after checking server identity, without runtime input. @example await service.selectPresentation(input) */
  async selectPresentation(input: PresentationCommand) {
    this.assertMutable(input.instanceId)
    this.environment.assertWorkspace?.()
    if (!this.presentationController)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'The Study reader is unavailable in this host.',
      )
    await this.presentationController.changePresentation(input)
    return this.presentationState(input.instanceId)
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
    await this.presentationController.returnToCurrent(input)
    return this.presentationState(input.instanceId)
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
      (record) =>
        record.historyExcluded === 'refused-at-admission' ||
        record.historyExcluded === 'removed-by-learner',
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

  /** Uses the existing atomic pause reservation, never a focused debug session. @example await service.continue(runState.participants.server.continueArguments) */
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
        record.error = domainError(error)
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

  /** Commits labeled interpretation only after the referenced evidence and atomic write succeed. @example await service.explain({...run, snapshotUri, sourceHash, valuePaths:['price'], interpretation:'Price is 24.', key:'explain-1'}) */
  explain(input: ExplainInput): Promise<{ explanationUri: string }> {
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
    const signature = JSON.stringify([
      input.snapshotUri,
      input.sourceHash,
      input.valuePaths,
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
    if (record.evidenceHeld)
      throw new StudyError(
        'BUSY',
        "The learner is deleting this run's saved study; wait for it to finish.",
      )
    const snapshot = this.snapshot(record, input.snapshotUri)
    if (
      snapshotSourceHashes(snapshot).typescript !== input.sourceHash ||
      new Set(input.valuePaths).size !== input.valuePaths.length
    )
      throw new StudyError(
        'INVALID_REFERENCE',
        'Source hash or distinct value paths do not match the snapshot.',
      )
    if (record.explanationKeys.size >= MAX_EXPLANATIONS)
      throw new StudyError(
        'LIMIT_EXCEEDED',
        `This run allows ${MAX_EXPLANATIONS} explanation intents.`,
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
    const capturedFacts = input.valuePaths.map((path) => {
      const value = captured.get(path)
      if (value === undefined)
        throw new StudyError(
          'INVALID_REFERENCE',
          `The selected snapshot did not capture ${path}.`,
        )
      return { path, value }
    })
    const explanation: Explanation = {
      id: randomUUID(),
      instanceId: this.instanceId,
      runId: record.id,
      snapshotUri: input.snapshotUri,
      sourceHash: input.sourceHash,
      capturedFacts,
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
        })
        await record.runtime!.evidence.flush()
        record.explanations.set(explanation.id, explanation)
        return {
          explanationUri: this.uri(record.id, `explanations/${explanation.id}`),
        }
      } catch (error) {
        record.error = new StudyError(
          'EVIDENCE_UNAVAILABLE',
          'Explanation was not committed.',
          String(error),
        )
        throw record.error
      }
    })
    record.explanationKeys.set(input.key, { signature, result })
    return result
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
      record.profile === NODE_TEST_PROFILE || Boolean(record.historyExcluded)
    )
  }

  /**
   * Ends a retained run's history after the learner removed its saved study, so the reader stops checkpointing it and {@link StudyService.state} stops reporting saved history; called by {@link StudyWorkspace} once a removal has moved something to the system Trash.
   * A record this service no longer retains is left alone.
   * @param record - The run whose study was removed.
   * @param exclusion - The only exclusion a caller outside preparation may set.
   * @example
   * service.excludeHistory(record, 'removed-by-learner')
   * service.beginHistory(record, service.state(record).materialSignature) // => undefined
   */
  excludeHistory(
    record: StudyRecord,
    exclusion: Extract<HistoryExclusion, 'removed-by-learner'>,
  ): void {
    if (this.records.get(record.id) !== record) return
    record.historyExcluded = exclusion
  }

  /**
   * Refuses to read or extend the raw evidence of a run whose saved study the learner removed, because the evidence directory went to the system Trash with it; called by {@link readResource} before every `/runs/<id>/<suffix>` resource and by {@link StudyService.explain}.
   * The bare run resource stays readable and names the same reason.
   * @param record - The retained run that is being read or explained.
   * @throws An `EVIDENCE_UNAVAILABLE` {@link StudyError} with the removal sentence for a `removed-by-learner` run.
   * @example
   * service.assertEvidenceAvailable(record) // throws after service.excludeHistory(record, 'removed-by-learner')
   */
  assertEvidenceAvailable(record: StudyRecord): void {
    if (record.historyExcluded === 'removed-by-learner')
      throw new StudyError(
        'EVIDENCE_UNAVAILABLE',
        historyExclusionReason(record.historyExcluded),
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
    record.evidenceHeld = true
    try {
      // A failed explanation or evidence write is that write's own error; it does not stop the removal.
      await Promise.allSettled(
        [...record.explanationKeys.values()].map((accepted) => accepted.result),
      )
      await record.runtime?.evidence.flush().catch(() => undefined)
      return await operation()
    } finally {
      record.evidenceHeld = false
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

  /** Projects bounded current state and actionable next steps without copying the full event log. @example service.state(record).nextActions */
  state(record: StudyRecord) {
    const runtime = record.runtime?.view()
    const evidenceFailure = record.runtime?.evidence.failure
    const terminalReason =
      record.error?.message ?? evidenceFailure ?? runtime?.failures[0]
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
      return {
        snapshotUri,
        sourceUri: snapshotUri && `${snapshotUri}/source/typescript`,
        itemId: snapshot?.itemId,
        actionId: snapshot?.actionId,
        phase: participant?.phase,
        resumable,
        continueArguments:
          resumable && snapshot
            ? {
                instanceId: this.instanceId,
                runId: record.id,
                participant: name,
                ...snapshot.pause,
              }
            : undefined,
      }
    }
    const participants = {
      ...(runtime?.participants.server
        ? { server: participantView('server') }
        : {}),
      ...(nodeParticipants ?? {}),
      browser: participantView('browser'),
    }
    const nextActions = [
      canControl && record.prepared && runtime?.status === 'ready'
        ? runtime.nextAction
        : undefined,
      participants.server?.resumable ? 'continue-server' : undefined,
      participants.browser.resumable ? 'continue-browser' : undefined,
      !record.stopped ? 'stop' : undefined,
      'read-history',
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
      runtimeOutcome: runtime?.runtimeOutcome,
      captureOutcome: runtime?.captureOutcome,
      finalOutcome:
        nodeOutcome ??
        (terminalReason
          ? 'not-demonstrated'
          : (runtime?.finalOutcome ?? 'pending-teardown')),
      terminalReason,
      error: record.error?.describe(),
      cleanupError: record.cleanupError?.describe(),
      cleaned: record.stopped,
      resourcesReleased: runtime?.resourcesReleased ?? record.stopped,
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
    const historyExcluded = record.historyExcluded !== undefined,
      exclusionReason = historyExclusionReason(record.historyExcluded)
    const historyOutcome = {
      status:
        historyExcluded || !receipt
          ? ('unavailable' as const)
          : latest
            ? receipt.status
            : ('pending' as const),
      materialSignature,
      checkpointRevision: receipt?.revision,
      savedSignature:
        !historyExcluded && latest && receipt?.status === 'saved'
          ? receipt.signature
          : undefined,
      reason: historyExcluded
        ? exclusionReason
        : latest
          ? receipt?.reason
          : undefined,
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
      record.historyExcluded === 'removed-by-learner' &&
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
        record.error = new StudyError(
          'EVIDENCE_UNAVAILABLE',
          'Evidence buffering or persistence failed.',
          evidenceFailure,
        )
        record.runtime?.fail(record.error.message)
      }
      if (this.now() >= record.deadlineAt) {
        record.error ??= new StudyError(
          'RUNTIME_FAILED',
          'Study wall deadline expired; history only.',
        )
        record.runtime?.fail(record.error.message)
        if (record.nodePhase && record.nodePhase !== 'completed')
          record.nodePhase = 'failed'
      }
      const runtimeState = record.runtime?.view().status
      if (
        record.error ||
        runtimeState === 'completed' ||
        runtimeState === 'failed' ||
        record.nodePhase === 'completed' ||
        record.nodePhase === 'failed'
      )
        void this.stopRecord(record).catch((error) => {
          record.error = domainError(error)
        })
    }
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
      // A failure before the admission answered is an ordinary preparation failure and is saved as one.
      if (record.historyExcluded === 'awaiting-admission')
        record.historyExcluded = undefined
      record.error = domainError(error)
      record.runtime?.fail(record.error.message)
      if (record.nodePhase) record.nodePhase = 'failed'
    }
    // Schedule cleanup after preparation settles to avoid awaiting this promise from itself.
    if (record.error)
      queueMicrotask(() => {
        void this.stopRecord(record).catch((error) => {
          record.error = domainError(error)
        })
      })
  }

  /**
   * Asks the study library whether it can keep this run's study, before a runtime exists or any input can be sent; called first by {@link StudyService.prepare} for a configured run.
   * Passing clears the record's `awaiting-admission` exclusion; a refusal replaces it with `refused-at-admission`, so the run is never written later.
   * @param record - The configured run that was just reserved.
   * @throws A `PREREQUISITE_MISSING` {@link StudyError} when the limit setting is invalid or the library is full; the read's own error when the library cannot be read.
   * @example
   * await this.admitStudy(record) // on a full library: record.historyExcluded === 'refused-at-admission'
   */
  private async admitStudy(record: StudyRecord): Promise<void> {
    const recordings = this.recordings
    if (!recordings) return
    const refusal = await this.studyRefusal(recordings, record).catch(
      (error: unknown) => {
        // Another failure of the read is no refusal: the run ends as a failed preparation and stays a checkpoint candidate.
        record.historyExcluded = undefined
        throw error
      },
    )
    record.historyExcluded = refusal ? 'refused-at-admission' : undefined
    if (refusal) throw new StudyError('PREREQUISITE_MISSING', refusal)
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
      : fullLibraryMessage('run', limit)
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
      record.stopped = true
      record.cleanupError = undefined
    })())
    try {
      await attempt
    } catch (error) {
      record.cleanupError = domainError(error)
      record.stopPromise = undefined
      throw error
    } finally {
      record.stopping = false
    }
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

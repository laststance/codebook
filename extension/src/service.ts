import { randomUUID } from 'node:crypto';
import type { RepositoryBookStore } from './repositoryBook';
import type { SourceListInput, SourceReadInput, PublishBookInput, OpenBookInput } from './repositorySchemas';
import { BOOK_INPUT_LIMIT_BYTES, BOOK_MAX_SOURCES, HTTP_BODY_LIMIT_BYTES, REPOSITORY_SOURCE_LIMIT_BYTES } from './constants';
import { join } from 'node:path';
import { ACTIVE_TIMEOUT_MS, API_VERSION, MAINTENANCE_INTERVAL_MS, MAX_EXPLANATIONS, MAX_RUNS, MAX_UI_TEXT_CHARS, RUN_TIMEOUT_MS } from './constants';
import { PROFILE_IDS } from 'codebook-cycle-0004/dist/constants';
import { STUDY_PROFILES } from 'codebook-cycle-0004/dist/profiles';
import { actionExpectations } from 'codebook-cycle-0004/dist/utils/actionExpectations';
import { stopExpectations } from 'codebook-cycle-0004/dist/utils/stopExpectations';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { StudyError, domainError } from './errors';
import type { RuntimeSnapshot, StudyEnvironment, StudyRuntime } from './runtime';
import { startIntentSchema, type StartIntent, type ActionInput, type ContinueInput, type ExplainInput, type RevealInput, type RunInput, type StartInput } from './schemas';
import type { RecordingStore, RecordingWriter } from './recordingStore';
import type { RecordingSeal } from './recordingSchemas';
import type { RetainedStudy } from './retainedStudySchemas';
import { buildRecordingContext } from './utils/buildRecordingContext';
import type { PlaybackController } from './playbackController';
import type { PlaybackCommand } from './playbackSchemas';
import { REPOSITORY_BROWSER_ACTION, REPOSITORY_BROWSER_PROFILE, REPOSITORY_RUN_TIMEOUT_MS, REPOSITORY_SETUP_TIMEOUT_MS } from './constants';
import type { ConfiguredDefinition, ConfiguredFactValue } from './configuredStudySchemas';
import { CONFIGURED_PROFILE } from './configuredProfile';
import { prepareRepositoryStudy } from './utils/prepareRepositoryStudy';
import { snapshotSourceHashes } from './utils/snapshotSourceHashes';

export interface Explanation {
  id: string; instanceId: string; runId: string; snapshotUri: string; sourceHash: string;
  capturedFacts: { path: string; value: ConfiguredFactValue }[];
  agentInterpretation: string; createdAt: string; learnerUnderstandingChanged: false;
}
export type StudyRecord = StudyRecordState & (
  | Exclude<StartIntent, { profile: typeof REPOSITORY_BROWSER_PROFILE }>
  | (Extract<StartIntent, { profile: typeof REPOSITORY_BROWSER_PROFILE }> & { definition?: ConfiguredDefinition })
);
interface StudyRecordState {
  id: string; signature: string; createdAt: number; deadlineAt: number; cancellation: AbortController;
  runtime?: StudyRuntime; prepared: boolean; preparation: Promise<void>;
  stopping: boolean; stopped: boolean; stopPromise?: Promise<void>; cleanupError?: StudyError; error?: StudyError;
  action?: { signature: string; receipt: { operationId: string; runUri: string; key: string } };
  actions: Map<string, NonNullable<StudyRecord['action']>>;
  explanations: Map<string, Explanation>;
  explanationKeys: Map<string, { signature: string; result: Promise<{ explanationUri: string }> }>;
  sourceReveals: Set<Promise<void>>;
  historyReceipt?: { revision: number; signature: string; status: 'pending' | 'saved' | 'failed'; reason?: string };
  recording?: RecordingWriter; recordingEndMs?: number; recordingSeal?: RecordingSeal; recordingFailure?: string;
  recordingReceipt?: { signature: string; historyRevision: number; status: 'pending' | 'saved' | 'failed'; contextHash?: string; studyHash?: string; reason?: string };
}

/** Owns MCP intent/history independently of transport sessions; commands construct it once per editor instance. @example service.start({instanceId, profile:'paired-cart-demo', key:'study-1'}) */
export class StudyService {
  readonly instanceId = randomUUID();
  readonly records = new Map<string, StudyRecord>();
  recordings?: RecordingStore;
  playbackController?: PlaybackController;
  repository?: RepositoryBookStore;
  repositoryPublished?: () => Promise<void>;
  repositoryReader?: (input: OpenBookInput, signal: AbortSignal) => Promise<{ bookId: string; revision: number; nodeId: string; anchorIndex: number; sourceUri: string }>;
  private readonly repositoryRetirement = new AbortController();
  private readonly repositoryOpens = new Set<Promise<unknown>>();
  private readonly startKeys = new Map<string, StudyRecord>();
  private readonly maintenance: ReturnType<typeof setInterval>;
  private stopping = false;
  private shutdownPromise?: Promise<void>;

  /** Lets editor shutdown retire only physically released owners when final evidence persistence fails. @example service.resourcesReleased // true after all release checks */
  get resourcesReleased(): boolean { return [...this.records.values()].every(record => record.stopped || record.runtime?.view().resourcesReleased === true); }

  constructor(readonly environment: StudyEnvironment, readonly storageRoot: string, private readonly now = Date.now) {
    // MCP transports -> one service -> owned runtime. Transport close never replays input.
    this.maintenance = setInterval(() => this.maintain(), MAINTENANCE_INTERVAL_MS);
    this.maintenance.unref();
  }

  /** Describes actual capabilities before an agent chooses an operation; called by discovery. @example await service.status() */
  async status() {
    const [prerequisites, repository] = await Promise.all([
      this.environment.prerequisites().catch(error => ({ ready: false, missing: [String(error)] })),
      this.repository ? this.sources({ instanceId: this.instanceId }).then(() => ({ ready: true, reason: undefined }), error => ({ ready: false, reason: String(error) })) : Promise.resolve({ ready: false, reason: 'Repository storage is unavailable.' }),
    ]);
    const profilePrerequisites = 'profiles' in prerequisites ? prerequisites.profiles : undefined;
    const commonPrerequisites = { ready: prerequisites.ready, missing: prerequisites.missing };
    return { instanceId: this.instanceId, apiVersion: API_VERSION, workspace: this.environment.workspace,
      host: this.environment.host, build: this.environment.build, prerequisites, stopping: this.stopping,
      profiles: [...PROFILE_IDS.map(id => {
        const definition = STUDY_PROFILES[id];
        const catalog = { ...definition, items: definition.items.map(item => ({ ...item, expectedValues: stopExpectations('<runtimeRunId>', item) })), expectations: definition.actions.map(action => ({ actionId: action.id, ...actionExpectations('<runtimeRunId>', action.id) })) };
        return { ...catalog, catalogHash: sha256(JSON.stringify(catalog)), prerequisites: profilePrerequisites?.[id] ?? commonPrerequisites };
      }), { ...CONFIGURED_PROFILE, prerequisites: profilePrerequisites?.[REPOSITORY_BROWSER_PROFILE] ?? commonPrerequisites }],
      capabilities: ['start', 'add-to-cart', 'checkout', REPOSITORY_BROWSER_ACTION, 'pause-evidence', 'continue', 'explain', 'reveal-source', 'stop', 'historical-resources'],
      limits: { activeRuns: 1, retainedRuns: MAX_RUNS, explanationsPerRun: MAX_EXPLANATIONS, activeTimeoutMs: ACTIVE_TIMEOUT_MS, runTimeoutMs: RUN_TIMEOUT_MS, timeoutFieldsApplyTo: 'paired-cart-demo; use each selected profile.limits for other profiles' },
      runs: [...this.records.values()].map(record => ({ runId: record.id, uri: this.uri(record.id), state: this.state(record).state })),
      recording: this.recordings ? { libraryUri: `codebook://${this.instanceId}/library`, playbackUri: `codebook://${this.instanceId}/playback`, playbackAvailable: Boolean(this.playbackController), limits: this.recordings.limits,
        instructions: 'Saved recordings survive server/runtime exit. Discover their study IDs using libraryUri; current-instance URIs and playback revisions must be copied, not guessed. Playback never starts, clicks or continues a run.' } : undefined,
      repository: { ...repository, catalogUri: `codebook://${this.instanceId}/repository`, helpUri: 'codebook://help/repository', readerAvailable: Boolean(this.repositoryReader),
        scope: 'Trusted local selected workspace at its Git working-tree root; tracked eligible UTF-8 text only. No runtime adapter or Chrome/debugger is required for source authoring.',
        limits: { documentBytes: BOOK_INPUT_LIMIT_BYTES, httpEnvelopeBytes: HTTP_BODY_LIMIT_BYTES, sourceBytes: REPOSITORY_SOURCE_LIMIT_BYTES, sourcesPerRevision: BOOK_MAX_SOURCES },
        authoring: ['codebook_sources', 'codebook_source', 'codebook_publish_book', 'codebook_open_book'] },
      recovery: 'Same instance: initialize a new transport and read the existing run. Server restart: copy new credentials first. Never automatically repeat a click.' };
  }

  /** Returns only currently owned repository storage without imposing runtime prerequisites. @example service.repositoryStore(instanceId) */
  repositoryStore(instanceId: string): RepositoryBookStore {
    this.assertMutable(instanceId); this.environment.assertWorkspace?.();
    if (!this.repository) throw new StudyError('PREREQUISITE_MISSING', 'Repository source/book storage is unavailable in this editor.');
    return this.repository;
  }

  /** Lists bounded tracked names through the current instance, independently of runtime support. @example await service.sources({instanceId}) */
  async sources(input: SourceListInput) {
    const result = await this.repositoryStore(input.instanceId).sources.list(input.cursor); this.repositoryStore(input.instanceId);
    return { instanceId: this.instanceId, ...result };
  }

  /** Reads one exact tracked source without navigating or running the application. @example await service.source({instanceId,path:'src/main.ts'}) */
  async source(input: SourceReadInput) {
    const result = await this.repositoryStore(input.instanceId).sources.read(input.path, input.expectedHash); this.repositoryStore(input.instanceId);
    return { instanceId: this.instanceId, ...result };
  }

  /** Publishes/retrieves an immutable intent receipt; connection lifetime never becomes persisted book identity. @example await service.publishBook(input) */
  async publishBook(input: PublishBookInput, signal?: AbortSignal) {
    const store = this.repositoryStore(input.instanceId), { instanceId: _instanceId, ...intent } = input;
    const receipt = await store.publish(intent, AbortSignal.any([this.repositoryRetirement.signal, ...(signal ? [signal] : [])]));
    // Reader refresh failure cannot turn a committed publication into a failed write receipt.
    void this.repositoryPublished?.().catch(() => undefined);
    return { instanceId: this.instanceId, ...receipt, uri: `codebook://${this.instanceId}/books/${receipt.bookId}/${receipt.revision}` };
  }

  /** Opens only the explicitly named article/citation through the native reader without understanding or runtime input. @example await service.openBook(input) */
  async openBook(input: OpenBookInput, signal?: AbortSignal) {
    this.repositoryStore(input.instanceId);
    if (!this.repositoryReader) throw new StudyError('BOOK_UNAVAILABLE', 'The repository reader is not available in this host.');
    const cancellation = AbortSignal.any([this.repositoryRetirement.signal, ...(signal ? [signal] : [])]); cancellation.throwIfAborted();
    const opening = this.repositoryReader(input, cancellation); this.repositoryOpens.add(opening);
    try {
      const receipt = await opening; cancellation.throwIfAborted(); this.repositoryStore(input.instanceId);
      return { instanceId: this.instanceId, ...receipt };
    } finally { this.repositoryOpens.delete(opening); }
  }

  /** Routes a typed historical control to the workspace's shared controller, never to a live runtime operation. @example service.playback({...identity,action:'pause',expectedRevision:2}) */
  playback(input: PlaybackCommand) {
    this.assertMutable(input.instanceId);
    if (!this.playbackController) throw new StudyError('PREREQUISITE_MISSING', 'The playback workspace is unavailable.');
    try { return { ...this.playbackController.command(input), uri: `codebook://${this.instanceId}/playback` }; }
    catch (error) { throw new StudyError(String(error).includes('Stale playback revision') ? 'STALE_PLAYBACK' : 'PLAYBACK_UNAVAILABLE', String(error), `Read codebook://${this.instanceId}/playback before retrying. No application input was sent.`); }
  }

  /** Reserves intent before prerequisite I/O so duplicate starts cannot create two runtimes. @example service.start(input).runUri */
  start(input: StartInput) {
    this.assertMutable(input.instanceId);
    const previous = this.startKeys.get(input.key);
    if (previous && previous.profile !== input.profile) throw new StudyError('IDEMPOTENCY_CONFLICT', 'Start key already names different arguments.');
    if (input.profile !== REPOSITORY_BROWSER_PROFILE && !PROFILE_IDS.some(profile => profile === input.profile)) throw new StudyError('UNSUPPORTED_PROFILE', `Available profiles: ${[...PROFILE_IDS, REPOSITORY_BROWSER_PROFILE].join(', ')}`);
    const parsed = startIntentSchema.safeParse(input);
    if (!parsed.success) throw new StudyError(previous ? 'IDEMPOTENCY_CONFLICT' : 'INVALID_CONFIGURATION', 'Start arguments do not match the selected profile or accepted intent.', parsed.error.message);
    const intent = parsed.data, signature = sha256(JSON.stringify(intent));
    if (previous) {
      if (previous.signature !== signature) throw new StudyError('IDEMPOTENCY_CONFLICT', 'Start key already names different arguments.');
      return this.receipt(previous);
    }
    if ([...this.records.values()].some(record => !record.stopped)) throw new StudyError('BUSY', 'Another run still owns resources.');
    if (this.records.size >= MAX_RUNS) throw new StudyError('LIMIT_EXCEEDED', `This instance retains at most ${MAX_RUNS} runs; no history was evicted.`);
    const createdAt = this.now();
    const timeout = intent.profile === REPOSITORY_BROWSER_PROFILE ? REPOSITORY_RUN_TIMEOUT_MS : STUDY_PROFILES[intent.profile].limits.runTimeoutMs;
    const record: StudyRecord = { ...intent, id: randomUUID(), signature, createdAt, deadlineAt: createdAt + timeout, cancellation: new AbortController(),
      prepared: false, preparation: Promise.resolve(), stopping: false, stopped: false, actions: new Map(), explanations: new Map(), explanationKeys: new Map(), sourceReveals: new Set() };
    this.records.set(record.id, record); this.startKeys.set(input.key, record);
    record.preparation = this.prepare(record);
    return this.receipt(record);
  }

  /** Admits the next fixed action while replaying every original receipt across later steps and cleanup. @example service.action({...run, key:'order', action:'checkout'}) */
  action(input: ActionInput) {
    this.assertMutable(input.instanceId); const record = this.record(input);
    const signature = JSON.stringify([input.key, input.action]);
    const previous = record.actions.get(input.key);
    if (previous) {
      if (previous.signature === signature) return previous.receipt;
      throw new StudyError('IDEMPOTENCY_CONFLICT', 'Action key already names different arguments.', `Read ${this.uri(record.id)} for retained receipts.`);
    }
    if (!record.prepared || record.stopping || record.stopped || record.error || record.runtime?.evidence.failure || this.now() >= record.deadlineAt || record.runtime?.view().status !== 'ready') throw new StudyError('BUSY', 'The run is not ready for input. Read its nextActions.');
    const nextAction = record.runtime.view().nextAction;
    if (nextAction !== input.action) throw new StudyError('BUSY', `Expected ${nextAction ?? 'no further action'}, received ${input.action}.`, `Read ${this.uri(record.id)} for current nextActions; nothing was dispatched.`);
    let operation: ReturnType<StudyRuntime['action']>;
    try { operation = record.runtime.action(input.key, input.action); }
    catch (error) { throw new StudyError(String(error).includes('conflict:') ? 'BUSY' : 'RUNTIME_FAILED', 'The action was not accepted.', String(error)); }
    const receipt = { operationId: operation.id, key: input.key, runUri: this.uri(record.id) };
    record.action = { signature, receipt }; record.actions.set(input.key, record.action); return receipt;
  }

  /** Uses the existing atomic pause reservation, never a focused debug session. @example await service.continue(runState.participants.server.continueArguments) */
  async continue(input: ContinueInput) {
    this.assertMutable(input.instanceId); const record = this.record(input);
    if (!record.runtime || record.stopping || record.stopped || record.error || record.runtime.evidence.failure || this.now() >= record.deadlineAt) throw new StudyError('STALE_PAUSE', 'The run cannot resume this historical pause.');
    try { await record.runtime.continue(input.participant, { sessionId: input.sessionId, threadId: input.threadId, generation: input.generation }); }
    catch (error) { if (error instanceof StudyError) throw error; throw new StudyError(String(error).includes('conflict:') ? 'STALE_PAUSE' : 'RUNTIME_FAILED', 'Continue was not confirmed.', String(error)); }
    return { accepted: true, runUri: this.uri(record.id) };
  }

  /** Stops a run through its shared cleanup barrier; historical resources remain available. @example await service.stop({instanceId,runId}) */
  async stop(input: RunInput) { const record = this.record(input); await this.stopRecord(record); return this.state(record); }

  /** Commits labeled interpretation only after the referenced evidence and atomic write succeed. @example await service.explain({...run, snapshotUri, sourceHash, valuePaths:['price'], interpretation:'Price is 24.', key:'explain-1'}) */
  explain(input: ExplainInput): Promise<{ explanationUri: string }> {
    this.assertMutable(input.instanceId); const record = this.record(input);
    const signature = JSON.stringify([input.snapshotUri, input.sourceHash, input.valuePaths, input.interpretation]);
    const previous = record.explanationKeys.get(input.key);
    if (previous) {
      if (previous.signature !== signature) throw new StudyError('IDEMPOTENCY_CONFLICT', 'Explanation key already names different content.');
      return previous.result;
    }
    if (record.stopping) throw new StudyError('BUSY', 'Wait for owned cleanup before adding historical explanations.');
    const snapshot = this.snapshot(record, input.snapshotUri);
    if (snapshotSourceHashes(snapshot).typescript !== input.sourceHash || new Set(input.valuePaths).size !== input.valuePaths.length) throw new StudyError('INVALID_REFERENCE', 'Source hash or distinct value paths do not match the snapshot.');
    if (record.explanationKeys.size >= MAX_EXPLANATIONS) throw new StudyError('LIMIT_EXCEEDED', `This run allows ${MAX_EXPLANATIONS} explanation intents.`);
    const captured = new Map<string, ConfiguredFactValue>(Object.entries(snapshot.values));
    const capturedFacts = input.valuePaths.map(path => {
      const value = captured.get(path);
      if (value === undefined) throw new StudyError('INVALID_REFERENCE', `The selected snapshot did not capture ${path}.`);
      return { path, value };
    });
    const explanation: Explanation = { id: randomUUID(), instanceId: this.instanceId, runId: record.id, snapshotUri: input.snapshotUri,
      sourceHash: input.sourceHash, capturedFacts,
      agentInterpretation: input.interpretation, createdAt: new Date(this.now()).toISOString(), learnerUnderstandingChanged: false };
    // Reserve before the first await; write latency must not permit duplicate explanations.
    const result = Promise.resolve().then(async () => {
      try {
        await record.runtime!.evidence.flush();
        await record.runtime!.evidence.save(`agent-explanation-${explanation.id}.json`, explanation);
        record.runtime!.evidence.record('agent.explanation-saved', { id: explanation.id, snapshotId: snapshot.id });
        await record.runtime!.evidence.flush();
        record.explanations.set(explanation.id, explanation);
        return { explanationUri: this.uri(record.id, `explanations/${explanation.id}`) };
      } catch (error) { record.error = new StudyError('EVIDENCE_UNAVAILABLE', 'Explanation was not committed.', String(error)); throw record.error; }
    });
    record.explanationKeys.set(input.key, { signature, result });
    return result;
  }

  /** Reveals only the source bound to a committed snapshot; the editor adapter checks file/document hashes. @example await service.reveal({...run, snapshotUri}) */
  async reveal(input: RevealInput) {
    this.assertMutable(input.instanceId); const record = this.record(input); const snapshot = this.snapshot(record, input.snapshotUri);
    if (record.stopping || record.stopped || record.error || record.runtime!.evidence.failure || ['failed', 'cancelled', 'completed'].includes(record.runtime!.view().status)) throw new StudyError('BUSY', 'Source reveal requires an active run. Read the captured source resource after cleanup.');
    // Reserve before editor I/O; stop must not finish while a source tab can still be acquired.
    const pending = Promise.resolve().then(() => record.runtime!.reveal(snapshot));
    record.sourceReveals.add(pending);
    try { await pending; } finally { record.sourceReveals.delete(pending); }
    return { revealed: true, snapshotUri: input.snapshotUri, sourceUri: `${input.snapshotUri}/source/typescript`, line: snapshot.actionId === REPOSITORY_BROWSER_ACTION ? snapshot.source.line : snapshot.frame.line };
  }

  /** Validates explicit instance/run identity for both control and history reads. @example service.record({instanceId,runId}) */
  record(input: RunInput): StudyRecord {
    this.assertInstance(input.instanceId); const record = this.records.get(input.runId);
    if (!record) throw new StudyError('NOT_FOUND', 'No run with that identity exists in this instance.');
    return record;
  }

  /** Builds canonical opaque references; caller-provided file paths never enter this API. @example service.uri(runId, 'events/0') */
  uri(runId: string, suffix?: string): string { return `codebook://${this.instanceId}/runs/${runId}${suffix ? `/${suffix}` : ''}`; }

  /** Resolves committed snapshot identity without treating an old capture as a current pause. @example service.snapshot(record, snapshotUri).values */
  snapshot(record: StudyRecord, uri: string): RuntimeSnapshot {
    const runtime = record.runtime?.view();
    for (const snapshot of runtime?.snapshots ?? []) {
      if (snapshot && uri === this.uri(record.id, `snapshots/${encodeURIComponent(snapshot.id)}`)) return snapshot;
    }
    throw new StudyError('INVALID_REFERENCE', 'Snapshot is absent, uncommitted, or belongs to another run.');
  }

  /** Reserves a monotonic reader checkpoint before I/O so even same-material retries cannot accept an older completion. @example const revision = service.beginHistory(record, signature) */
  beginHistory(record: StudyRecord, signature: string): number | undefined {
    if (this.records.get(record.id) !== record || this.state(record).materialSignature !== signature) return undefined;
    const revision = (record.historyReceipt?.revision ?? 0) + 1;
    record.historyReceipt = { revision, signature, status: 'pending' }; return revision;
  }

  /** Accepts only the latest reader persistence receipt; stale saves cannot certify newer evidence or retries. @example service.reportHistory(record, signature, revision, 'saved') */
  reportHistory(record: StudyRecord, signature: string, revision: number, status: 'pending' | 'saved' | 'failed', reason?: string): boolean {
    if (this.records.get(record.id) !== record || record.historyReceipt?.revision !== revision || this.state(record).materialSignature !== signature) return false;
    record.historyReceipt = { revision, signature, status, reason: reason?.slice(0, MAX_UI_TEXT_CHARS) }; return true;
  }

  /** Saves context only after the matching learner archive; recording failure cannot rewrite its execution/history outcome. @example await service.saveRecordingContext(record, archive, revision) */
  async saveRecordingContext(record: StudyRecord, archive: RetainedStudy, historyRevision: number): Promise<void> {
    if (!this.recordings || !record.recording || this.state(record).materialSignature !== archive.materialSignature || record.historyReceipt?.revision !== historyRevision || record.historyReceipt.status !== 'saved') return;
    const receipt: NonNullable<StudyRecord['recordingReceipt']> = { signature: archive.materialSignature, historyRevision, status: 'pending' };
    record.recordingReceipt = receipt;
    try {
      const context = buildRecordingContext(archive, record.runtime?.view().events ?? [], historyRevision);
      const saved = await this.recordings.saveContext(context);
      // A newer history/annotation owns success even when this older filesystem write finishes last.
      if (record.recordingReceipt !== receipt || this.state(record).materialSignature !== receipt.signature || record.historyReceipt?.revision !== historyRevision) return;
      record.recordingReceipt = { ...receipt, status: 'saved', contextHash: saved.hash, studyHash: context.studyHash };
    } catch (error) {
      if (record.recordingReceipt === receipt) record.recordingReceipt = { ...receipt, status: 'failed', reason: String(error).slice(0, MAX_UI_TEXT_CHARS) };
    }
  }

  /** Projects bounded current state and actionable next steps without copying the full event log. @example service.state(record).nextActions */
  state(record: StudyRecord) {
    const runtime = record.runtime?.view();
    const evidenceFailure = record.runtime?.evidence.failure;
    const terminalReason = record.error?.message ?? evidenceFailure ?? runtime?.failures[0];
    const canControl = !this.stopping && !record.stopping && !record.stopped && !terminalReason && this.now() < record.deadlineAt;
    const participantView = (name: 'server' | 'browser') => {
      const participant = name === 'browser' ? runtime?.participants.browser : runtime && runtime.profile !== REPOSITORY_BROWSER_PROFILE ? runtime.participants.server : undefined, snapshot = participant?.snapshot;
      const snapshotUri = snapshot ? this.uri(record.id, `snapshots/${encodeURIComponent(snapshot.id)}`) : undefined;
      const resumable = Boolean(canControl && snapshot && participant?.phase === 'paused' && participant.pause?.generation === snapshot.pause.generation && participant.pause.sessionId === snapshot.pause.sessionId && participant.pause.threadId === snapshot.pause.threadId);
      return { snapshotUri, sourceUri: snapshotUri && `${snapshotUri}/source/typescript`, itemId: snapshot?.itemId, actionId: snapshot?.actionId, phase: participant?.phase,
        resumable, continueArguments: resumable && snapshot ? { instanceId: this.instanceId, runId: record.id, participant: name, ...snapshot.pause } : undefined };
    };
    const participants = { ...(record.profile === REPOSITORY_BROWSER_PROFILE ? {} : { server: participantView('server') }), browser: participantView('browser') };
    const nextActions = [canControl && record.prepared && runtime?.status === 'ready' ? runtime.nextAction : undefined,
      participants.server?.resumable ? 'continue-server' : undefined, participants.browser.resumable ? 'continue-browser' : undefined,
      !record.stopped ? 'stop' : undefined, 'read-history'].filter(value => value !== undefined);
    const material = { instanceId: this.instanceId, runId: record.id, runtimeRunId: runtime?.runId, profile: record.profile,
      state: record.stopped ? 'stopped' : record.stopping ? 'stopping' : terminalReason ? 'failed' : !record.prepared ? 'preparing' : runtime?.status ?? 'preparing',
      runtimeState: runtime?.status, createdAt: new Date(record.createdAt).toISOString(), deadlineAt: new Date(record.deadlineAt).toISOString(), activeTimeoutMs: ACTIVE_TIMEOUT_MS,
      nextActions, participants, operation: record.action?.receipt, operations: [...record.actions.values()].map(action => action.receipt), observed: runtime?.observed, links: runtime?.links,
      manifestUri: runtime?.manifest ? this.uri(record.id, 'manifest') : undefined, manifestHash: runtime?.manifest?.hash,
      configurationHash: record.profile === REPOSITORY_BROWSER_PROFILE ? record.definition?.configurationHash : undefined,
      itemId: record.profile === REPOSITORY_BROWSER_PROFILE ? record.definition?.descriptor.itemId : undefined,
      observations: runtime?.snapshots.map(snapshot => ({ id: snapshot.id, itemId: snapshot.itemId, actionId: snapshot.actionId, participant: snapshot.participant, capturePhase: snapshot.capturePhase, snapshotUri: this.uri(record.id, `snapshots/${encodeURIComponent(snapshot.id)}`), sourceUri: this.uri(record.id, `snapshots/${encodeURIComponent(snapshot.id)}/source/typescript`) })) ?? [],
      runtimeOutcome: runtime?.runtimeOutcome, captureOutcome: runtime?.captureOutcome,
      finalOutcome: terminalReason ? 'not-demonstrated' : runtime?.finalOutcome ?? 'pending-teardown',
      terminalReason, error: record.error?.describe(), cleanupError: record.cleanupError?.describe(), cleaned: record.stopped, resourcesReleased: runtime?.resourcesReleased ?? record.stopped, activeSessionIds: runtime?.activeSessionIds ?? [],
      captures: Object.entries(runtime?.captures ?? {}).map(([phase, capture]) => ({ phase, status: capture.status, error: capture.error, uri: capture.status === 'captured' ? this.uri(record.id, `images/${phase}`) : undefined })),
      explanations: [...record.explanations.values()].map(value => this.uri(record.id, `explanations/${value.id}`)),
      eventsUri: this.uri(record.id, 'events/0'), runUri: this.uri(record.id) };
    // Receipt fields are excluded from the signature to avoid a save/report/save feedback loop.
    const materialSignature = sha256(JSON.stringify(material));
    const receipt = record.historyReceipt, latest = receipt?.signature === materialSignature;
    const historyOutcome = { status: !receipt ? 'unavailable' as const : latest ? receipt.status : 'pending' as const,
      materialSignature, checkpointRevision: receipt?.revision, savedSignature: latest && receipt?.status === 'saved' ? receipt.signature : undefined,
      reason: latest ? receipt?.reason : undefined };
    const terminal = record.stopped || material.resourcesReleased;
    const studyOutcome = material.finalOutcome === 'not-demonstrated' ? 'not-demonstrated' : material.finalOutcome === 'partial' ? 'partial'
      : material.finalOutcome !== 'demonstrated' || !terminal ? 'pending'
      : historyOutcome.status === 'saved' ? 'demonstrated' : historyOutcome.status === 'pending' ? 'pending' : 'partial';
    const recordingReceipt = record.recordingReceipt;
    const recordingCurrent = recordingReceipt?.signature === materialSignature && recordingReceipt?.historyRevision === receipt?.revision;
    const capture = record.recording?.state();
    const recording = { capture, status: record.recordingFailure ? 'failed' as const : record.recordingSeal ? record.recordingSeal.status === 'complete' ? 'finalized' as const : 'partial' as const : capture?.status === 'partial' ? 'partial' as const : record.recording ? 'recording' as const : 'unavailable' as const,
      reason: record.recordingFailure ?? record.recordingSeal?.reason ?? capture?.reason, endMs: record.recordingSeal?.endMs,
      contextStatus: recordingCurrent ? recordingReceipt!.status : recordingReceipt ? 'pending' as const : 'unavailable' as const,
      contextHash: recordingCurrent && recordingReceipt?.status === 'saved' ? recordingReceipt.contextHash : undefined,
      studyHash: recordingCurrent && recordingReceipt?.status === 'saved' ? recordingReceipt.studyHash : undefined,
      contextReason: recordingCurrent ? recordingReceipt?.reason : undefined };
    const recordedStudyOutcome = studyOutcome === 'not-demonstrated' ? 'not-demonstrated' : studyOutcome === 'partial' ? 'partial' : studyOutcome !== 'demonstrated' ? 'pending'
      : recording.status === 'finalized' && recording.contextStatus === 'saved' ? 'demonstrated'
      : recording.status === 'recording' || recording.contextStatus === 'pending' ? 'pending' : 'partial';
    return { ...material, materialSignature, historyOutcome, studyOutcome, recording, recordedStudyOutcome };
  }

  /** Prevents late acquisitions escaping shutdown while preserving retryable cleanup failures. @example await service.shutdown() */
  async shutdown(): Promise<void> {
    this.stopping = true; clearInterval(this.maintenance);
    this.repositoryRetirement.abort();
    const attempt = this.shutdownPromise ??= (async () => {
      // Cancelled navigation failures are expected; drain accepted host effects before reporting retirement.
      const results = await Promise.allSettled([this.repository?.flush(), Promise.allSettled([...this.repositoryOpens]), ...[...this.records.values()].map(record => this.stopRecord(record))]);
      const failures = results.flatMap(result => result.status === 'rejected' ? [String(result.reason)] : []);
      if (failures.length) throw new StudyError('RUNTIME_FAILED', 'Owned shutdown remains incomplete.', failures.join('; '));
    })();
    try { await attempt; } catch (error) { this.shutdownPromise = undefined; throw error; }
  }

  /** Fails overload/expiry and cleans completed runtimes even when all MCP clients vanished. @example service.maintain() */
  maintain(): void {
    for (const record of this.records.values()) {
      // A failed release needs an explicit retry; unchanged storage/process failures must not loop.
      if (record.stopped || record.stopping || record.cleanupError) continue;
      const evidenceFailure = record.runtime?.evidence.failure;
      if (evidenceFailure) { record.error = new StudyError('EVIDENCE_UNAVAILABLE', 'Evidence buffering or persistence failed.', evidenceFailure); record.runtime?.fail(record.error.message); }
      if (this.now() >= record.deadlineAt) { record.error ??= new StudyError('RUNTIME_FAILED', 'Study wall deadline expired; history only.'); record.runtime?.fail(record.error.message); }
      const runtimeState = record.runtime?.view().status;
      if (record.error || runtimeState === 'completed' || runtimeState === 'failed') void this.stopRecord(record).catch(error => { record.error = domainError(error); });
    }
  }

  /** Acquires the adapter once; cancellation after an await drains rather than abandons it. @example await this.prepare(record) */
  private async prepare(record: StudyRecord): Promise<void> {
    try {
      // Reserve intent -> immutable article/all citations -> owned adapter -> input; retries never repeat these reads.
      if (record.profile === REPOSITORY_BROWSER_PROFILE) {
        this.environment.assertWorkspace?.();
        if (!this.repository) throw new StudyError('PREREQUISITE_MISSING', 'Repository source/book storage is unavailable in this editor.');
        record.definition = await prepareRepositoryStudy(record.configuration, this.repository, { signal: record.cancellation.signal, deadlineAt: Math.min(record.deadlineAt, record.createdAt + REPOSITORY_SETUP_TIMEOUT_MS) }, this.now);
        this.environment.assertWorkspace?.();
      }
      const prerequisites = await this.environment.prerequisites();
      // Shared Node/Chrome availability alone cannot authorize an unsupported selected profile.
      const selectedPrerequisites = prerequisites.profiles?.[record.profile] ?? prerequisites;
      if (!selectedPrerequisites.ready) throw new StudyError('PREREQUISITE_MISSING', selectedPrerequisites.missing.join('; '));
      if (this.stopping || record.stopping) return;
      const definition = record.profile === REPOSITORY_BROWSER_PROFILE ? record.definition : record.profile;
      if (!definition) throw new StudyError('RUNTIME_FAILED', 'Configured source binding is absent.');
      record.runtime = await this.environment.createRuntime(join(this.storageRoot, this.instanceId, record.id), definition, { signal: record.cancellation.signal, deadlineAt: record.deadlineAt, preparationDeadlineAt: record.createdAt + REPOSITORY_SETUP_TIMEOUT_MS });
      const acquired = record.runtime.view();
      if (acquired.profile !== record.profile) throw new StudyError('RUNTIME_FAILED', 'Acquired runtime belongs to another profile.');
      if (acquired.profile === REPOSITORY_BROWSER_PROFILE && JSON.stringify(acquired.definition) !== JSON.stringify(definition)) throw new StudyError('RUNTIME_FAILED', 'Acquired runtime changed the accepted repository definition.');
      if (this.stopping || record.stopping) return;
      if (this.recordings) {
        // Reserve capture before preparation can receive frames or expose action readiness.
        try { record.recording = await this.recordings.start({ workspaceKey: this.recordings.workspaceKey, studyId: `${this.instanceId}_${record.id}`, instanceId: this.instanceId, runId: record.id, runtimeId: record.runtime.id, profile: record.profile, sourceBuild: this.environment.build }, record.runtime.evidence.elapsedMs()); }
        catch (error) { record.recordingFailure = `Recording unavailable before input: ${String(error)}`; }
      }
      if (this.stopping || record.stopping) return;
      await record.runtime.prepare(); record.prepared = true;
    } catch (error) { record.error = domainError(error); record.runtime?.fail(record.error.message); }
    // Schedule cleanup after preparation settles to avoid awaiting this promise from itself.
    if (record.error) queueMicrotask(() => { void this.stopRecord(record).catch(error => { record.error = domainError(error); }); });
  }

  /** Serializes release after acquisitions and accepted explanation writes settle. @example await this.stopRecord(record) */
  private async stopRecord(record: StudyRecord): Promise<void> {
    if (record.stopped) return;
    record.stopping = true;
    record.cancellation.abort();
    const attempt = record.stopPromise ??= (async () => {
      // A held acquisition may need transport shutdown to settle; drain it only after cancellation is delivered.
      const cancelledRuntime = record.prepared ? undefined : record.runtime;
      const cancelling = cancelledRuntime?.stop();
      if (cancelling) void cancelling.catch(() => undefined);
      await record.preparation;
      await cancelling;
      await Promise.allSettled([...record.explanationKeys.values()].map(value => value.result));
      await Promise.allSettled([...record.sourceReveals]);
      if (record.runtime) {
        try { if (record.runtime !== cancelledRuntime) await record.runtime.stop(); }
        finally {
          if (record.recording) {
            const runtime = record.runtime.view();
            const failure = runtime.events.find(event => event.type === 'run.failed');
            if (failure || !runtime.resourcesReleased) record.recording.stopFrames(failure?.elapsedMs ?? record.runtime.evidence.elapsedMs(), 'Runtime interrupted or cleanup incomplete; recorded prefix retained.');
            try {
              const seal = await record.recording.finish(record.recordingEndMs ?? record.runtime.evidence.elapsedMs());
              await this.recordings?.read(record.recording.header.studyId);
              record.recordingSeal = seal;
            }
            catch (error) { record.recordingFailure = String(error).slice(0, MAX_UI_TEXT_CHARS); }
          }
        }
      }
      record.stopped = true; record.cleanupError = undefined;
    })();
    try { await attempt; } catch (error) { record.cleanupError = domainError(error); record.stopPromise = undefined; throw error; }
    finally { record.stopping = false; }
  }

  /** Returns the original preparing receipt even after later transitions, allowing safe same-key retries. @example this.receipt(record).runId */
  private receipt(record: StudyRecord) { return { instanceId: this.instanceId, runId: record.id, runUri: this.uri(record.id), accepted: true, deadlineAt: new Date(record.deadlineAt).toISOString() }; }
  /** Rejects mutations during shutdown before their first async operation. @example this.assertMutable(instanceId) */
  private assertMutable(instanceId: string): void { this.assertInstance(instanceId); if (this.stopping) throw new StudyError('SERVER_STOPPING', 'Server is stopping.'); }
  /** Separates credential validation from explicit application identity. @example this.assertInstance(instanceId) */
  private assertInstance(instanceId: string): void { if (instanceId !== this.instanceId) throw new StudyError('STALE_INSTANCE', 'This connection serves a different instance.'); }
}

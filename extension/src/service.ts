import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ParticipantSnapshot } from 'codebook-cycle-0004/dist/inspectParticipant';
import { ACTIVE_TIMEOUT_MS, API_VERSION, MAINTENANCE_INTERVAL_MS, MAX_EXPLANATIONS, MAX_RUNS, PROFILE_ID, RUN_TIMEOUT_MS } from './constants';
import { StudyError, domainError } from './errors';
import type { StudyEnvironment, StudyRuntime } from './runtime';
import type { ActionInput, ContinueInput, ExplainInput, RevealInput, RunInput, StartInput } from './schemas';

export interface Explanation {
  id: string; instanceId: string; runId: string; snapshotUri: string; sourceHash: string;
  capturedFacts: { path: string; value: string | number }[];
  agentInterpretation: string; createdAt: string; learnerUnderstandingChanged: false;
}
export interface StudyRecord {
  id: string; key: string; profile: string; createdAt: number; deadlineAt: number;
  runtime?: StudyRuntime; prepared: boolean; preparation: Promise<void>;
  stopping: boolean; stopped: boolean; stopPromise?: Promise<void>; cleanupError?: StudyError; error?: StudyError;
  action?: { signature: string; receipt: { operationId: string; runUri: string; key: string } };
  explanations: Map<string, Explanation>;
  explanationKeys: Map<string, { signature: string; result: Promise<{ explanationUri: string }> }>;
}

/** Owns MCP intent/history independently of transport sessions; commands construct it once per editor instance. @example service.start({instanceId, profile:'paired-cart-demo', key:'study-1'}) */
export class StudyService {
  readonly instanceId = randomUUID();
  readonly records = new Map<string, StudyRecord>();
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
    const prerequisites = await this.environment.prerequisites();
    return { instanceId: this.instanceId, apiVersion: API_VERSION, workspace: this.environment.workspace,
      host: this.environment.host, build: this.environment.build, prerequisites, stopping: this.stopping,
      profiles: [{ id: PROFILE_ID, description: 'Instrumented TypeScript cart demo; one click, server and browser pauses. Not arbitrary repositories or checkout.' }],
      capabilities: ['start', 'add-to-cart', 'pause-evidence', 'continue', 'explain', 'reveal-source', 'stop', 'historical-resources'],
      limits: { activeRuns: 1, retainedRuns: MAX_RUNS, explanationsPerRun: MAX_EXPLANATIONS, activeTimeoutMs: ACTIVE_TIMEOUT_MS, runTimeoutMs: RUN_TIMEOUT_MS },
      runs: [...this.records.values()].map(record => ({ runId: record.id, uri: this.uri(record.id), state: this.state(record).state })),
      recovery: 'Same instance: initialize a new transport and read the existing run. Server restart: copy new credentials first. Never automatically repeat a click.' };
  }

  /** Reserves intent before prerequisite I/O so duplicate starts cannot create two runtimes. @example service.start(input).runUri */
  start(input: StartInput) {
    this.assertMutable(input.instanceId);
    const previous = this.startKeys.get(input.key);
    if (previous) {
      if (previous.profile !== input.profile) throw new StudyError('IDEMPOTENCY_CONFLICT', 'Start key already names different arguments.');
      return this.receipt(previous);
    }
    if (input.profile !== PROFILE_ID) throw new StudyError('UNSUPPORTED_PROFILE', `Available profile: ${PROFILE_ID}`);
    if ([...this.records.values()].some(record => !record.stopped)) throw new StudyError('BUSY', 'Another run still owns resources.');
    if (this.records.size >= MAX_RUNS) throw new StudyError('LIMIT_EXCEEDED', `This instance retains at most ${MAX_RUNS} runs; no history was evicted.`);
    const createdAt = this.now();
    const record: StudyRecord = { id: randomUUID(), key: input.key, profile: input.profile, createdAt, deadlineAt: createdAt + RUN_TIMEOUT_MS,
      prepared: false, preparation: Promise.resolve(), stopping: false, stopped: false, explanations: new Map(), explanationKeys: new Map() };
    this.records.set(record.id, record); this.startKeys.set(input.key, record);
    record.preparation = this.prepare(record);
    return this.receipt(record);
  }

  /** Accepts exactly one fixed click while returning a stable receipt across reconnects and cleanup. @example service.action({...run, key:'cart', action:'add-to-cart'}) */
  action(input: ActionInput) {
    this.assertMutable(input.instanceId); const record = this.record(input);
    const signature = JSON.stringify([input.key, input.action]);
    if (record.action) {
      if (record.action.signature === signature) return record.action.receipt;
      throw new StudyError('BUSY', 'This demo already accepted one cart action.');
    }
    if (!record.prepared || record.stopping || record.stopped || record.error || record.runtime?.evidence.failure || this.now() >= record.deadlineAt || record.runtime?.view().status !== 'ready') throw new StudyError('BUSY', 'The run is not ready for input. Read its nextActions.');
    const operation = record.runtime.action(input.key);
    const receipt = { operationId: operation.id, key: input.key, runUri: this.uri(record.id) };
    record.action = { signature, receipt }; return receipt;
  }

  /** Uses the existing atomic pause reservation, never a focused debug session. @example await service.continue(runState.participants.server.continueArguments) */
  async continue(input: ContinueInput) {
    this.assertMutable(input.instanceId); const record = this.record(input);
    if (!record.runtime || record.stopping || record.stopped || record.error || record.runtime.evidence.failure || this.now() >= record.deadlineAt) throw new StudyError('STALE_PAUSE', 'The run cannot resume this historical pause.');
    try { await record.runtime.continue(input.participant, { sessionId: input.sessionId, threadId: input.threadId, generation: input.generation }); }
    catch (error) { throw new StudyError(String(error).includes('conflict:') ? 'STALE_PAUSE' : 'RUNTIME_FAILED', 'Continue was not confirmed.', String(error)); }
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
    if (snapshot.source.typescriptHash !== input.sourceHash || new Set(input.valuePaths).size !== input.valuePaths.length) throw new StudyError('INVALID_REFERENCE', 'Source hash or distinct value paths do not match the snapshot.');
    if (record.explanationKeys.size >= MAX_EXPLANATIONS) throw new StudyError('LIMIT_EXCEEDED', `This run allows ${MAX_EXPLANATIONS} explanation intents.`);
    const explanation: Explanation = { id: randomUUID(), instanceId: this.instanceId, runId: record.id, snapshotUri: input.snapshotUri,
      sourceHash: input.sourceHash, capturedFacts: input.valuePaths.map(path => ({ path, value: snapshot.values[path] })),
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
    if (record.stopping) throw new StudyError('BUSY', 'Source reveal waits until owned source cleanup finishes.');
    await record.runtime!.reveal(snapshot);
    return { revealed: true, snapshotUri: input.snapshotUri, sourceUri: `${input.snapshotUri}/source/typescript`, line: snapshot.frame.line };
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
  snapshot(record: StudyRecord, uri: string): ParticipantSnapshot {
    const runtime = record.runtime?.view();
    for (const name of ['server', 'browser'] as const) {
      const snapshot = runtime?.participants[name].snapshot;
      if (snapshot && uri === this.uri(record.id, `snapshots/${encodeURIComponent(snapshot.id)}`)) return snapshot;
    }
    throw new StudyError('INVALID_REFERENCE', 'Snapshot is absent, uncommitted, or belongs to another run.');
  }

  /** Projects bounded current state and actionable next steps without copying the full event log. @example service.state(record).nextActions */
  state(record: StudyRecord) {
    const runtime = record.runtime?.view();
    const evidenceFailure = record.runtime?.evidence.failure;
    const terminalReason = record.error?.message ?? evidenceFailure ?? runtime?.failures[0];
    const canControl = !this.stopping && !record.stopping && !record.stopped && !terminalReason && this.now() < record.deadlineAt;
    const participantView = (name: 'server' | 'browser') => {
      const participant = runtime?.participants[name], snapshot = participant?.snapshot;
      const snapshotUri = snapshot ? this.uri(record.id, `snapshots/${encodeURIComponent(snapshot.id)}`) : undefined;
      const resumable = Boolean(canControl && snapshot && participant?.phase === 'paused' && participant.pause?.generation === snapshot.pause.generation && participant.pause.sessionId === snapshot.pause.sessionId && participant.pause.threadId === snapshot.pause.threadId);
      return { snapshotUri, sourceUri: snapshotUri && `${snapshotUri}/source/typescript`, phase: participant?.phase,
        resumable, continueArguments: resumable && snapshot ? { instanceId: this.instanceId, runId: record.id, participant: name, ...snapshot.pause } : undefined };
    };
    const participants = { server: participantView('server'), browser: participantView('browser') };
    const nextActions = [canControl && record.prepared && runtime?.status === 'ready' ? 'add-to-cart' : undefined,
      participants.server.resumable ? 'continue-server' : undefined, participants.browser.resumable ? 'continue-browser' : undefined,
      !record.stopped ? 'stop' : undefined, 'read-history'].filter(value => value !== undefined);
    return { instanceId: this.instanceId, runId: record.id, runtimeRunId: runtime?.runId, profile: record.profile,
      state: record.stopped ? 'stopped' : record.stopping ? 'stopping' : terminalReason ? 'failed' : !record.prepared ? 'preparing' : runtime?.status ?? 'preparing',
      runtimeState: runtime?.status, createdAt: new Date(record.createdAt).toISOString(), deadlineAt: new Date(record.deadlineAt).toISOString(), activeTimeoutMs: ACTIVE_TIMEOUT_MS,
      nextActions, participants, operation: record.action?.receipt, observed: runtime?.observed, links: runtime?.links,
      runtimeOutcome: runtime?.runtimeOutcome, captureOutcome: runtime?.captureOutcome,
      finalOutcome: terminalReason ? 'not-demonstrated' : runtime?.finalOutcome ?? 'pending-teardown',
      terminalReason, error: record.error?.describe(), cleanupError: record.cleanupError?.describe(), cleaned: record.stopped, resourcesReleased: runtime?.resourcesReleased ?? record.stopped, activeSessionIds: runtime?.activeSessionIds ?? [],
      captures: Object.entries(runtime?.captures ?? {}).map(([phase, capture]) => ({ phase, status: capture.status, error: capture.error, uri: capture.status === 'captured' ? this.uri(record.id, `images/${phase}`) : undefined })),
      explanations: [...record.explanations.values()].map(value => this.uri(record.id, `explanations/${value.id}`)),
      eventsUri: this.uri(record.id, 'events/0'), runUri: this.uri(record.id) };
  }

  /** Prevents late acquisitions escaping shutdown while preserving retryable cleanup failures. @example await service.shutdown() */
  async shutdown(): Promise<void> {
    this.stopping = true; clearInterval(this.maintenance);
    const attempt = this.shutdownPromise ??= (async () => {
      const results = await Promise.allSettled([...this.records.values()].map(record => this.stopRecord(record)));
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
      const prerequisites = await this.environment.prerequisites();
      if (!prerequisites.ready) throw new StudyError('PREREQUISITE_MISSING', prerequisites.missing.join('; '));
      if (this.stopping || record.stopping) return;
      record.runtime = await this.environment.createRuntime(join(this.storageRoot, this.instanceId, record.id));
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
    const attempt = record.stopPromise ??= (async () => {
      await record.preparation;
      await Promise.allSettled([...record.explanationKeys.values()].map(value => value.result));
      if (record.runtime) await record.runtime.stop();
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

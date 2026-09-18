import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Evidence } from 'codebook-cycle-0001/dist/evidence';
import { PauseGate } from 'codebook-cycle-0001/dist/pauseGate';
import { verifySource } from 'codebook-cycle-0001/dist/verifySource';
import type { SealedSource } from 'codebook-cycle-0001/dist/inspect';
import type { ParticipantSnapshot } from 'codebook-cycle-0004/dist/inspectParticipant';
import { StudyService } from '../service';
import type { StudyEnvironment, StudyRuntime, RuntimeView } from '../runtime';

/** Models only editor effects while protocol tests use real SDK/Evidence boundaries. @example const runtime = new ControlledRuntime(directory) */
export class ControlledRuntime implements StudyRuntime {
  readonly id = randomUUID();
  readonly evidence: Evidence;
  readonly gate = new PauseGate();
  readonly seal: SealedSource;
  status = 'preparing'; stopped = false; dispatches = 0; releases = 0;
  snapshot?: ParticipantSnapshot;
  operation?: RuntimeView['operation'];
  preparationWait?: Promise<void>;
  constructor(directory: string) {
    this.evidence = new Evidence(directory);
    const source = 'const price = 24;';
    this.seal = { sourcePath: join(directory, 'cart.ts'), source, javascript: source, breakpointLine: 1,
      sourceMap: JSON.stringify({ version: 3, names: [], sources: ['cart.ts'], sourcesContent: [source], mappings: 'AAAA' }) };
  }
  /** Makes a deterministic ready boundary for service tests. @example await runtime.prepare() */
  async prepare(): Promise<void> { await this.evidence.initialize(); await this.preparationWait; this.status = 'ready'; }
  /** Counts admitted input and captures a synthetic pause, never native runtime proof. @example runtime.action('cart').key */
  action(key: string) {
    this.dispatches += 1; this.operation = { id: randomUUID(), key, inputAcknowledged: true }; this.status = 'paused-server';
    const pause = this.gate.stop('server-session', 1);
    this.snapshot = { id: 'server-session:1', participant: 'server', pause, frame: { id: 1, name: 'update', source: { path: this.seal.sourcePath }, line: 1, column: 1 },
      values: { operationId: this.id, cartId: 'selected', productId: 'tote-01', price: 24, cartCount: 0, admittedCount: 2 }, evaluations: [],
      source: verifySource(this.seal, this.seal.javascript, this.seal.source, { scriptId: '1', lineNumber: 0, columnNumber: 0 }, 1, 'cart.ts') };
    this.evidence.record('snapshot.committed', { snapshotId: this.snapshot.id }); return this.operation;
  }
  /** Rejects repeated claims through the real pause gate. @example await runtime.continue('server', pause) */
  async continue(_name: 'server' | 'browser', pause: Parameters<StudyRuntime['continue']>[1]): Promise<void> {
    if (!this.gate.reserve(pause)) throw new Error('conflict: stale pause'); this.gate.invalidate(); this.status = 'running';
  }
  /** Exposes the existing runtime projection shape for typed adapter tests. @example runtime.view().cleaned */
  view(): RuntimeView {
    return { runId: this.id, scenario: 'normal', status: this.status, cleaned: this.stopped, runtimeOutcome: 'not-demonstrated', captureOutcome: 'incomplete', finalOutcome: this.stopped ? 'not-demonstrated' : 'pending-teardown',
      participants: { server: { sessionId: 'server-session', pause: this.gate.current, phase: this.gate.phase, snapshot: this.snapshot, continued: undefined, conflict: this.gate.conflict },
        browser: { sessionId: undefined, pause: undefined, phase: 'running', snapshot: undefined, continued: undefined, conflict: false } },
      operation: this.operation, observed: undefined, network: undefined, links: [], captures: {}, failures: [], events: this.evidence.events,
      artifactDirectory: this.evidence.directory, activeSessionIds: this.stopped ? [] : ['server-session'], backend: undefined };
  }
  /** Persists cleanup using the real writer so storage failures are observable. @example await runtime.stop() */
  async stop(): Promise<void> { this.releases += 1; this.gate.invalidate(); await this.evidence.flush(); this.stopped = true; }
  /** Makes service-driven failure visible without implying a real debugger fault. @example runtime.fail('expired') */
  fail(_reason: string): void { this.status = 'failed'; this.gate.invalidate(); }
  /** Supplies sealed history independent of local file contents. @example runtime.source('server').source */
  source(): SealedSource { return this.seal; }
  /** Leaves native reveal testing to the actual host matrix. @example await runtime.reveal(snapshot) */
  async reveal(): Promise<void> {}
}

/** Supplies isolated storage and controllable runtime acquisition to behavior tests. @example const harness = await createHarness() */
export async function createHarness(options: { now?: () => number; prerequisites?: StudyEnvironment['prerequisites']; create?: (directory: string) => Promise<ControlledRuntime> } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-mcp-test-')); const runtimes: ControlledRuntime[] = [];
  const environment: StudyEnvironment = { workspace: directory, host: { id: 'vscode', productVersion: 'test', apiVersion: 'test', commit: 'test' }, build: { revision: 'test', dirty: true, sourceHash: 'test' },
    prerequisites: options.prerequisites ?? (async () => ({ ready: true, missing: [] })),
    createRuntime: async root => { const runtime = options.create ? await options.create(root) : new ControlledRuntime(root); runtimes.push(runtime); return runtime; } };
  const service = new StudyService(environment, directory, options.now);
  return { directory, service, runtimes, async close() { try { await service.shutdown(); } finally { await rm(directory, { recursive: true, force: true }); } } };
}

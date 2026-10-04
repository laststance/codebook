import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

import type { ConfiguredDefinition } from '../../configuredStudySchemas'
import { LearningLibrary } from '../../learningLibrary'
import { RepositoryBookStore } from '../../repositoryBook'
import type {
  ConfiguredRuntimeSnapshot,
  ConfiguredRuntimeView,
  RuntimeAction,
  StudyEnvironment,
  StudyRuntime,
} from '../../runtime'
import { Evidence } from '../../runtimeSupport/evidence'
import { PauseGate } from '../../runtimeSupport/pauseGate'
import { StudyService } from '../../service'

import { createConfiguredStudy } from './createConfiguredStudy'
import { repositoryHarness } from './repositoryHarness'

/** Models declared browser receipts for service tests; it never launches an application or produces native evidence. @example const runtime = new ControlledConfiguredRuntime(directory, definition) */
export class ControlledConfiguredRuntime implements StudyRuntime {
  readonly id = randomUUID()
  readonly evidence: Evidence
  readonly gate = new PauseGate()
  readonly snapshots: ConfiguredRuntimeSnapshot[] = []
  operation?: ConfiguredRuntimeView['operation']
  status = 'preparing'
  stopped = false
  dispatches = 0
  releases = 0
  /** Failures the runtime itself reported, as a native coordinator does when an adapter event ends the run; a test pushes one and sets `status` to model that end. */
  readonly failures: string[] = []
  constructor(
    directory: string,
    readonly definition: ConfiguredDefinition,
  ) {
    this.evidence = new Evidence(directory)
  }
  /** Opens real evidence storage before service tests admit synthetic input. @example await runtime.prepare() */
  async prepare(): Promise<void> {
    await this.evidence.initialize()
    this.status = 'ready'
  }
  /** Creates one synthetic declared stop so shared lifecycle tests can distinguish browser-only evidence. @example runtime.action('click', 'repository-click') */
  action(key: string, action: RuntimeAction) {
    if (action !== 'repository-click' || this.operation)
      throw new Error('conflict: wrong or repeated configured input')
    const declaredSource = this.definition.descriptor.sources.find(
      (source) => source.path === this.definition.configuration.source.path,
    )
    if (!declaredSource)
      throw new Error(
        'The configured test definition is missing its selected source.',
      )
    this.dispatches++
    this.operation = {
      id: randomUUID(),
      key,
      inputDispatched: true,
      inputAcknowledged: true,
      afterVerified: false,
    }
    this.status = 'paused-browser'
    // Synthetic observations must use the same custom bytes exposed by the runtime source resource.
    const pause = this.gate.stop('browser-session', 1),
      reference = createConfiguredStudy(declaredSource.text).observations[0]!
    const {
      snapshotUri: _uri,
      interpretations: _interpretations,
      ...snapshot
    } = reference
    const receipt = this.evidence.record('snapshot.committed', {
      snapshotId: `${pause.sessionId}:${pause.generation}`,
    })
    this.snapshots.push({
      ...snapshot,
      id: `${pause.sessionId}:${pause.generation}`,
      pause,
      capturedAt: receipt.wallTime,
      elapsedMs: receipt.elapsedMs,
    })
    return this.operation
  }
  /** Consumes only the synthetic browser tuple; native continuation belongs to the separate runtime matrix. @example await runtime.continue('browser', pause) */
  async continue(
    participant: Parameters<StudyRuntime['continue']>[0],
    pause: Parameters<StudyRuntime['continue']>[1],
  ): Promise<void> {
    if (
      participant !== 'browser' ||
      !this.gate.reserve(pause) ||
      !this.operation
    )
      throw new Error('conflict: stale or foreign pause')
    this.operation.continuedPause = pause
    this.gate.invalidate()
    this.status = 'running'
  }
  /**
   * Commits the next stop as the coordinator does after a continuation: a new pause, its snapshot and the paused status.
   * @returns The committed snapshot, a copy of the stop before it under the new pause identity.
   * @throws When no stop was committed before; the first stop comes from {@link ControlledConfiguredRuntime.action}.
   * @example const next = runtime.commitNextStop() // next.id === 'browser-session:2'
   */
  commitNextStop(): ConfiguredRuntimeSnapshot {
    const previous = this.snapshots.at(-1)
    if (!previous) throw new Error('No stop was committed before this one.')
    const pause = this.gate.stop('browser-session', 1),
      id = `${pause.sessionId}:${pause.generation}`
    const receipt = this.evidence.record('snapshot.committed', {
      snapshotId: id,
    })
    const snapshot = {
      ...previous,
      id,
      pause,
      capturedAt: receipt.wallTime,
      elapsedMs: receipt.elapsedMs,
    }
    this.snapshots.push(snapshot)
    this.status = 'paused-browser'
    return snapshot
  }
  /**
   * Ends the operation as the coordinator does once the after conditions held after the last continuation.
   * @throws When no input was dispatched.
   * @example runtime.observeResult() // runtime.view().status === 'completed'
   */
  observeResult(): void {
    if (!this.operation) throw new Error('No input was dispatched.')
    this.operation.afterVerified = true
    this.status = 'completed'
  }
  /** Projects the configured variant without manufacturing a server participant or demo values. @example Object.keys(runtime.view().participants) // ['browser'] */
  view(): ConfiguredRuntimeView {
    return {
      runId: this.id,
      profile: 'repository-browser',
      definition: this.definition,
      status: this.status,
      cleaned: this.stopped,
      resourcesReleased: this.stopped,
      runtimeOutcome: 'not-demonstrated',
      captureOutcome: 'incomplete',
      finalOutcome: this.stopped ? 'not-demonstrated' : 'pending-teardown',
      participants: {
        browser: {
          sessionId: 'browser-session',
          pause: this.gate.current,
          phase: this.gate.phase,
          // The stop a participant is at is the last one committed.
          snapshot: this.snapshots.at(-1),
          continued: undefined,
          conflict: this.gate.conflict,
        },
      },
      snapshots: this.snapshots,
      operation: this.operation,
      nextAction:
        this.status === 'ready' && !this.operation
          ? 'repository-click'
          : undefined,
      observed: this.operation?.afterVerified
        ? { afterVerified: true }
        : undefined,
      links: [],
      captures: {},
      failures: [...this.failures],
      events: this.evidence.events,
      artifactDirectory: this.evidence.directory,
      activeSessionIds: this.stopped ? [] : ['browser-session'],
    }
  }
  /** Counts owned release and retains the real evidence log for historical reads. @example await runtime.stop() */
  async stop(): Promise<void> {
    this.releases++
    this.gate.invalidate()
    await this.evidence.flush()
    this.stopped = true
  }
  /** Revokes test control on service deadline/error without claiming a native debugger fault. @example runtime.fail('expired') */
  fail(_reason: string): void {
    this.status = 'failed'
    this.gate.invalidate()
  }
  /** Supplies synthetic source bytes matching the separately labeled configured fixture. @example runtime.source(itemId)?.source */
  source(item: string) {
    return item === this.definition.descriptor.itemId
      ? {
          source: this.definition.descriptor.sources.find(
            (source) =>
              source.path === this.definition.configuration.source.path,
          )!.text,
          javascript: 'emitted javascript',
          sourceMap: 'emitted source map',
        }
      : undefined
  }
  /** Leaves native tab/reveal ownership to actual-host tests. @example await runtime.reveal(snapshot) */
  async reveal(): Promise<void> {}
}

/** Combines real Git/book/storage/service boundaries with synthetic editor effects and an optional test clock. @example const { service } = await configuredServiceHarness(context, () => 1000) */
export async function configuredServiceHarness(
  context: TestContext,
  clock = Date.now,
) {
  let ownedService: StudyService | undefined,
    ownedBooks: RepositoryBookStore | undefined
  context.after(async () => {
    await ownedService?.shutdown()
    await ownedBooks?.dispose()
  })
  const repository = await repositoryHarness(context),
    reference = createConfiguredStudy()
  for (const source of reference.descriptor!.sources)
    await repository.track(source.path, source.text)
  const library = new LearningLibrary(
      join(repository.directory, '.learning'),
      reference.workspaceKey,
    ),
    books = new RepositoryBookStore(repository.sources, library)
  await books.publish({
    bookId: 'interface',
    expectedRevision: 0,
    key: 'article',
    document: {
      title: 'Interface',
      summary: 'Two cited sources.',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
          anchors: reference.descriptor!.anchors,
          observations: [],
        },
      ],
      edges: [],
    },
  })
  const runtimes: ControlledConfiguredRuntime[] = []
  const environment: StudyEnvironment = {
    workspace: repository.directory,
    host: {
      id: 'vscode',
      productVersion: 'test',
      apiVersion: 'test',
      commit: 'test',
    },
    build: { revision: 'test', dirty: true, sourceHash: 'test' },
    prerequisites: async () => ({ ready: true, missing: [] }),
    async createRuntime(directory, definition) {
      if (!definition || typeof definition === 'string')
        throw new Error('This harness models configured studies only.')
      const runtime = new ControlledConfiguredRuntime(directory, definition)
      runtimes.push(runtime)
      return runtime
    },
  }
  const service = new StudyService(
    environment,
    join(repository.directory, '.runtime'),
    clock,
  )
  service.repository = books
  ownedService = service
  ownedBooks = books
  return {
    ...repository,
    library,
    books,
    environment,
    runtimes,
    service,
    configuration: reference.configuration,
  }
}

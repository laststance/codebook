import {
  NODE_SERVER_HISTORY_START_BOUND_MS,
  NODE_SERVER_PROFILE,
} from '../../constants'
import type { NodeHistoryRepository } from '../../nodeHistoryRepository'
import type { NodeServerHistorySink } from '../../nodeServerHistorySink'
import type { NodeServerResponse } from '../../runtime'

import { FakeNodeServerRuntime } from './fakeNodeServerRuntime'
import { openServerRepository } from './nodeServerHistoryFixture'
import { debuggerCapture } from './serverRunCapture'
import {
  nodeServerConfigurationOf,
  type startFakeNodeServerRun,
} from './startFakeNodeServerRun'

/** The history start bound of a service test that needs its history: far above any load stall, so only a start that never answers (a test's own hold) runs unrecorded. */
const HISTORY_TEST_START_BOUND_MS = 60_000

/** The fake run of a service test whose request, stops and response also reach the history sink the service handed it, as the real run's do. */
export class HistoryFakeNodeServerRuntime extends FakeNodeServerRuntime {
  /** The sink the service gave `createNodeServerRun`; absent when no history started. */
  history?: NodeServerHistorySink
  private clockMs = 10

  override async sendRequest(key: string): Promise<void> {
    await super.sendRequest(key)
    this.history?.openRequest((this.clockMs += 5), {
      method: 'GET',
      path: '/api/healthz',
      bodyBytes: 0,
    })
    this.history?.markRequestSent((this.clockMs += 1))
  }

  override pauseAt(index: number, facts: Record<string, unknown> = {}): void {
    super.pauseAt(index, facts)
    this.history?.stop(
      (this.clockMs += 5),
      { declaredStopIndex: index },
      this.view().pauseGeneration,
      debuggerCapture({ line: 2 + index }),
    )
  }

  override respond(response: Partial<NodeServerResponse> = {}): void {
    super.respond(response)
    const shown = this.view().response
    if (shown) this.history?.response((this.clockMs += 5), shown)
  }

  /** The server printed a line. */
  print(text: string): void {
    this.history?.output((this.clockMs += 1), 'stdout', text)
  }
}

/**
 * Starts a node-server run on a service whose learning storage is a real repository, with a fake run that feeds the history sink the service gave it.
 * @param harness - The service harness (`createHarness`).
 * @param context - The test whose end removes the learning directory.
 * @param options - A repository to use instead of a fresh one, and a hook that runs before the start.
 * @returns What {@link startFakeNodeServerRun} returns, the history-feeding run and the repository.
 * @example const { run, repository } = await startHistoryServerRun(harness, context)
 */
export async function startHistoryServerRun(
  harness: Parameters<typeof startFakeNodeServerRun>[0] & {
    service: {
      nodeHistoryRepository?: NodeHistoryRepository
      nodeHistoryStore?: NodeHistoryRepository['testHistories']
    }
  },
  context: Parameters<typeof openServerRepository>[0],
  options: {
    repository?: NodeHistoryRepository
    repositoryOptions?: Parameters<typeof openServerRepository>[1]
  } = {},
) {
  const repository =
    options.repository ??
    (await openServerRepository(context, options.repositoryOptions)).repository
  // The production start bound (2 s) is wall-clock: a history start that storage under CPU load stretches past it launches the run unrecorded, so a test that needs its history would read none. A test that names its own bound keeps it.
  if (
    harness.service.nodeServerHistoryStartBoundMs ===
    NODE_SERVER_HISTORY_START_BOUND_MS
  )
    harness.service.nodeServerHistoryStartBoundMs = HISTORY_TEST_START_BOUND_MS
  harness.service.nodeHistoryRepository = repository
  harness.service.nodeHistoryStore = repository.testHistories
  const run = new HistoryFakeNodeServerRuntime()
  const started = await startFakeNodeServerRunWith(harness, run)
  return { ...started, run, repository }
}

/** Starts the harness's node-server run with a given fake run, taking the sink from the service's creation call. */
async function startFakeNodeServerRunWith(
  harness: Parameters<typeof startFakeNodeServerRun>[0],
  run: HistoryFakeNodeServerRuntime,
) {
  const { service } = harness
  service.environment.createNodeServerRun = async (...creation) => {
    run.record = creation[1]
    run.history = creation[4]
    return run
  }
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: NODE_SERVER_PROFILE,
    key: 'k1',
    configuration: nodeServerConfigurationOf(harness),
  })
  const record = service.record(receipt)
  await record.preparation
  return { service, record, receipt }
}

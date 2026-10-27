import { NODE_SERVER_PROFILE } from '../../constants'
import type { NodeServerConfiguration } from '../../nodeServerConfigSchemas'
import type { StudyEnvironment } from '../../runtime'
import type { StudyRecord, StudyService } from '../../service'
import type { createHarness } from '../helpers'

import { FakeNodeServerRuntime } from './fakeNodeServerRuntime'

/** The two-stop declaration of a node-server test run over the harness's published article, a GET of `/api/healthz` unless the test names another request. */
export function nodeServerConfigurationOf(
  harness: Pick<Awaited<ReturnType<typeof createHarness>>, 'configuration'>,
  request: NodeServerConfiguration['request'] = {
    method: 'GET',
    path: '/api/healthz',
  },
) {
  const base = harness.configuration
  return {
    version: 1,
    adapter: 'node-server',
    book: base.book,
    entry: 'src/server.ts',
    port: 4100,
    request,
    source: base.source,
    inspections: base.inspections.slice(0, 1),
    additionalStops: [
      {
        ...base.source,
        anchorIndex: 0,
        inspections: base.inspections.slice(0, 1),
      },
    ],
  }
}

/** What {@link startFakeNodeServerRun} can set beside the key. */
type FakeNodeServerRunOptions = {
  key?: string
  request?: NodeServerConfiguration['request']
  /** Answers the confirmation of a state-changing request; the environment has no such hook when left out. */
  confirm?: StudyEnvironment['confirmStateChangingRequest']
  /** Holds the run's `prepare()` until the test releases `run.prepareGate`. */
  holdPrepare?: boolean
}

/**
 * Starts a node-server run on a service whose environment creates a {@link FakeNodeServerRuntime}, and waits for its preparation.
 * @param harness - The service harness (`createHarness`) the run starts on.
 * @param options - The start key, the declared request, a confirmation hook and whether the preparation is held.
 * @returns The service, the run's record, the fake run and the start's receipt.
 * @example const { service, record, run } = await startFakeNodeServerRun(harness) // run.view().state === 'ready'
 */
export async function startFakeNodeServerRun(
  harness: Pick<
    Awaited<ReturnType<typeof createHarness>>,
    'service' | 'configuration'
  >,
  options: FakeNodeServerRunOptions = {},
) {
  const { service } = harness
  const run = new FakeNodeServerRuntime()
  run.holdsPrepare = options.holdPrepare === true
  const created: unknown[][] = []
  service.environment.createNodeServerRun = async (...creation) => {
    created.push(creation)
    run.record = creation[1]
    return run
  }
  if (options.confirm)
    service.environment.confirmStateChangingRequest = options.confirm
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: NODE_SERVER_PROFILE,
    key: options.key ?? 'server-run',
    configuration: nodeServerConfigurationOf(harness, options.request),
  })
  const record: StudyRecord = service.record(receipt)
  if (!options.holdPrepare) await record.preparation
  return {
    service: service satisfies StudyService,
    record,
    run,
    receipt,
    created,
  }
}

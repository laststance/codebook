import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { NODE_TEST_PROFILE } from '../../constants'
import type { workspaceHarness } from '../studyWorkspaceHarness'

import { twoStopOwnedRun } from './twoStopOwnedRun'

/**
 * Starts a live test run of two declared stops on a workspace harness and waits for its preparation, so the status bar item and Save act on a run paused at its first stop.
 * @param harness - The workspace harness whose service runs it.
 * @param runName - The start's idempotency key, named by what the run is for.
 * @returns The run's record and its study id.
 * @example const { record, studyId } = await startLiveTestRun(harness, 'closed-pane-save-item')
 */
export async function startLiveTestRun(
  harness: Pick<
    Awaited<ReturnType<typeof workspaceHarness>>,
    'service' | 'configuration' | 'directory'
  >,
  runName: string,
) {
  const { service, configuration } = harness
  const sourceText = await readFile(
    join(harness.directory, configuration.source.path),
    'utf8',
  )
  service.environment.build.sourceHash = 'f'.repeat(64)
  service.environment.createNodeTestRun = async () =>
    twoStopOwnedRun(configuration.source, sourceText)
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: NODE_TEST_PROFILE,
    key: runName,
    configuration: {
      version: 1,
      adapter: 'vitest-node',
      book: configuration.book,
      testFile: 'src/scheduler.test.ts',
      testHash: 'a'.repeat(64),
      testTitles: ['job scheduler', 'runs a delayed job after its timer'],
      source: configuration.source,
      inspections: configuration.inspections.slice(0, 1),
      additionalStops: [
        {
          ...configuration.source,
          anchorIndex: 0,
          inspections: configuration.inspections.slice(0, 1),
        },
      ],
    },
  })
  const record = service.record(receipt)
  await record.preparation
  return { record, studyId: `${service.instanceId}_${record.id}` }
}

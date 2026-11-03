import type { TestContext } from 'node:test'

import type { RetainedStudy } from '../../retainedStudySchemas'
import { waitUntil } from '../../runtimeSupport/utils/waitUntil'
import { captureStudy } from '../../utils/captureStudy'

import { armedEntry } from './entryRenderHarness'
import {
  hitOnLine,
  PAGES_SERVER_RETURN_LINE,
  pagesServerService,
} from './pagesServerRunHarness'

/** The workspace key of a study captured here. */
export const PAGES_SERVER_STUDY_WORKSPACE_KEY = '0'.repeat(64)

/**
 * Runs the study writer ({@link captureStudy}) on a Pages run that paused its `getServerSideProps` stop at the entry load (the debugger shows `count` 3 in a frame named `getServerSideProps`), was continued and completed, as the service saves it.
 * Used by the replay test of a saved Pages server run, and once at this change to produce `fixtures/pages-server-study-v0.2.74.0/pages-server-entry-load.study.v8.json`, the study file the rollback test reopens.
 * @param context - The running test, which owns the harness cleanup.
 * @returns The study the writer produced, before it is saved: format 8, one server-render pause with attribution entry-load.
 * @example const study = await capturePagesServerStudy(context) // study.version === 8
 */
export async function capturePagesServerStudy(
  context: TestContext,
): Promise<RetainedStudy> {
  const run = await pagesServerService(context)
  const { harness, state, service, receipt } = run
  harness.server!.setFrameName('getServerSideProps')
  harness.server!.setScope({ count: 3 })
  run.holdMaintenance()
  await armedEntry(harness)
  harness.server!.hit(
    hitOnLine(PAGES_SERVER_RETURN_LINE, {
      fixture: 'get-server-side-props-before-await',
    }),
  )
  await waitUntil(() => state().state === 'paused-server', 'the entry pause')
  harness.setDocumentReadyState('complete')
  await service.continue(state().participants.server!.continueArguments!)
  await waitUntil(() => state().state === 'completed', 'the completed run')
  const study = await captureStudy(
    service,
    service.record(receipt),
    PAGES_SERVER_STUDY_WORKSPACE_KEY,
  )
  if (!study) throw new Error('The completed run produced no study.')
  return study
}

import type { TestContext } from 'node:test'

import type { StudyRuntime } from '../../runtime'
import type { StudyRecord, StudyService } from '../../service'

import { retainStoppedRun } from './retainStoppedRun'

/**
 * Hands a run that a runtime harness prepared and is still driving to a real {@link StudyService} as a live run, so a test of the product coordinator can read the run resource ({@link readResource} on `service.uri(record.id)`) while the coordinator is between two debugger events.
 * The record is the one {@link retainStoppedRun} registers, marked as not stopped: the service projects the runtime's live state, and its shutdown at the test's end stops the run. No start, input or continuation goes through this service; the test drives the harness.
 * @param context - The test, whose end shuts the service down.
 * @param runtime - The prepared run; its view supplies the frozen definition.
 * @param workspace - The run's repository directory, used as the service's workspace and storage root.
 * @returns The service and the registered record.
 * @example
 * const { service, record } = retainLiveRun(context, harness.run, harness.directory)
 * await readResource(service, service.uri(record.id)) // the run resource as an agent reads it now
 */
export function retainLiveRun(
  context: TestContext,
  runtime: StudyRuntime,
  workspace: string,
): { service: StudyService; record: StudyRecord } {
  const retained = retainStoppedRun(context, runtime, workspace)
  retained.record.stopped = false
  return retained
}

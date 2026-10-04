import { randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'

import { REPOSITORY_RUN_TIMEOUT_MS } from '../../constants'
import type { StudyEnvironment, StudyRuntime } from '../../runtime'
import { StudyService, type StudyRecord } from '../../service'

/**
 * Hands a run that a runtime harness prepared, drove and stopped to a real {@link StudyService} as a retained, stopped run, so a test of the product coordinator can read that run's resources ({@link readResource}) over the journal the coordinator itself wrote.
 * The record is registered as stopped: the service's maintenance and shutdown leave the runtime alone, and no start, input or continuation goes through this service.
 * @param context - The test, whose end shuts the service down.
 * @param runtime - The stopped run; its view supplies the frozen definition.
 * @param workspace - The run's repository directory, used as the service's workspace and storage root.
 * @returns The service and the registered record; `service.state(record).observations` lists the run's inspection URIs.
 * @example
 * const { service, record } = retainStoppedRun(context, run, directory)
 * await readResource(service, service.state(record).observations[0].inspectionUri)
 */
export function retainStoppedRun(
  context: TestContext,
  runtime: StudyRuntime,
  workspace: string,
): { service: StudyService; record: StudyRecord } {
  const environment: StudyEnvironment = {
    workspace,
    host: {
      id: 'vscode',
      productVersion: 'test',
      apiVersion: 'test',
      commit: 'test',
    },
    build: { revision: 'test', dirty: true, sourceHash: 'test' },
    prerequisites: async () => ({ ready: true, missing: [] }),
    createRuntime: async () => runtime,
  }
  const service = new StudyService(environment, workspace)
  context.after(() => service.shutdown())
  const definition = runtime.view().definition,
    createdAt = Date.now()
  const record: StudyRecord = {
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'retained-stopped-run',
    configuration: definition.configuration,
    definition,
    id: randomUUID(),
    signature: 'retained-stopped-run',
    createdAt,
    deadlineAt: createdAt + REPOSITORY_RUN_TIMEOUT_MS,
    cancellation: new AbortController(),
    runtime,
    prepared: true,
    preparation: Promise.resolve(),
    stopping: false,
    stopped: true,
    actions: new Map(),
    explanations: new Map(),
    explanationKeys: new Map(),
    sourceReveals: new Set(),
    placeGuards: new Map(),
  }
  service.records.set(record.id, record)
  return { service, record }
}

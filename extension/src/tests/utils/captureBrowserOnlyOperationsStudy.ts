import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'

import type { RetainedStudy } from '../../retainedStudySchemas'
import { captureStudy } from '../../utils/captureStudy'

import { configuredServiceHarness } from './configuredServiceHarness'
import { ControlledOperationsRuntime } from './controlledOperationsRuntime'

/**
 * Runs the study writer ({@link captureStudy}) on a browser-only version 3 run that paused at its one click operation, as the service saves it at a first checkpoint.
 * Used by the format 7 golden test, and once at 0.2.72.0 (commit 2f5de949) to produce `fixtures/operations-study-v0.2.72.0/browser-only-v3.study.v7.json`.
 * @param context - The running test, which owns the harness cleanup.
 * @param options - `snapshotsCarryFormat8Fields` gives the run's snapshots `execution`, `declaredIndex` and `executionIndex`, as the pause lane does.
 * @returns The study the writer produced, before it is saved.
 * @example const study = await captureBrowserOnlyOperationsStudy(context) // study.version === 7
 */
export async function captureBrowserOnlyOperationsStudy(
  context: TestContext,
  options: { snapshotsCarryFormat8Fields?: boolean } = {},
): Promise<RetainedStudy> {
  const harness = await configuredServiceHarness(
    context,
    undefined,
    (directory, definition) =>
      new ControlledOperationsRuntime(directory, definition),
  )
  const { service, configuration } = harness
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'golden',
    configuration: {
      version: 3,
      adapter: configuration.adapter,
      book: configuration.book,
      source: configuration.source,
      participant: 'browser',
      afterOperation: 1,
      before: configuration.action.before,
      after: configuration.action.after,
      operations: [
        { kind: 'click', title: 'Create Invoice', selector: '#submit' },
      ],
      inspections: configuration.inspections,
    },
  })
  const record = service.record(receipt)
  await record.preparation
  const runtime = harness.runtimes[0]
  assert.ok(runtime instanceof ControlledOperationsRuntime)
  runtime.pausesOnAction = true
  // The real run journals the dispatch receipt of an operation before its stop commits; the saved time comes from it.
  runtime.evidence.record('input.dispatched', { operationIndex: 1 })
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: 'repository-operation',
  })
  // The pause lane puts the format 8 fields on every snapshot of every run, browser-only runs included.
  if (options.snapshotsCarryFormat8Fields)
    runtime.snapshots.forEach((snapshot, position) => {
      snapshot.execution = 'browser'
      snapshot.declaredIndex = position
      snapshot.executionIndex = position
    })
  const study = await captureStudy(
    service,
    record,
    harness.library.workspaceKey,
  )
  assert.ok(study)
  return study
}

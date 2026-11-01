import type { ConfiguredStudy } from '../../configuredStudySchemas'
import { operationsRepositoryConfigSchema } from '../../repositoryConfigSchemas'
import { sha256 } from '../../runtimeSupport/utils/sha256'

import { createCrossRuntimeStudy } from './createCrossRuntimeStudy'

/** The recording-clock moments at which the four operations of {@link createOperationsStudy} were sent. */
export const OPERATION_TIMES_MS = [1000, 1500, 3500, 3800] as const

/**
 * Supplies inert saved history of a version 3 run of four ordered operations (choose, text, click, click) with a browser stop after operation 2 and a server and a browser stop after operation 4, never an application or native verification.
 * @param how - `complete` for a demonstrated run (four operations done); `failed-at-3` for a run that stopped: operation 1 and 2 done, 3 failed, 4 not run, with only the stop after operation 2 reached.
 * @returns A decodable format 7 study.
 * @example
 * createOperationsStudy().operations?.map((record) => record.state) // => ['done', 'done', 'done', 'done']
 * createOperationsStudy('failed-at-3').operations?.map((record) => record.state) // => ['done', 'done', 'failed', 'not-run']
 */
export function createOperationsStudy(
  how: 'complete' | 'failed-at-3' = 'complete',
): ConfiguredStudy {
  const crossRuntime = createCrossRuntimeStudy()
  const [browser, server, finalBrowser] = crossRuntime.observations
  const [serverStop, browserStop] =
    crossRuntime.configuration.version === 2
      ? (crossRuntime.configuration.additionalStops ?? [])
      : []
  const configuration = operationsRepositoryConfigSchema.parse({
    version: 3,
    adapter: 'next-dev-webpack',
    book: crossRuntime.configuration.book,
    source: crossRuntime.configuration.source,
    participant: 'browser',
    afterOperation: 2,
    entryPath: '/dashboard/invoices/create',
    before: [{ kind: 'visible', selector: 'form' }],
    after: [{ kind: 'visible', selector: 'table' }],
    operations: [
      { kind: 'choose', title: 'Customer', selector: '#customer', value: 'c1' },
      { kind: 'text', title: 'Amount', selector: '#amount', text: '120' },
      { kind: 'click', title: 'Pending', selector: '#pending' },
      { kind: 'click', title: 'Create Invoice', selector: '#create' },
    ],
    inspections: crossRuntime.configuration.inspections,
    additionalStops: [
      { ...serverStop, afterOperation: 4 },
      { ...browserStop, afterOperation: 4 },
    ],
  })
  const isComplete = how === 'complete'
  const sentAt = (position: number): number => OPERATION_TIMES_MS[position]!
  const operations: NonNullable<ConfiguredStudy['operations']> = [
    {
      index: 1,
      kind: 'choose',
      title: 'Customer',
      atMs: sentAt(0),
      state: 'done',
      ack: 'yes',
      valueCheck: 'passed',
      effect: 'dispatched',
    },
    {
      index: 2,
      kind: 'text',
      title: 'Amount',
      atMs: sentAt(1),
      state: 'done',
      ack: 'yes',
      valueCheck: 'passed',
      effect: 'dispatched',
    },
    isComplete
      ? {
          index: 3,
          kind: 'click',
          title: 'Pending',
          atMs: sentAt(2),
          state: 'done',
          ack: 'yes',
          valueCheck: 'n/a',
          effect: 'dispatched',
        }
      : {
          index: 3,
          kind: 'click',
          title: 'Pending',
          atMs: sentAt(2),
          state: 'failed',
          ack: 'pending',
          valueCheck: 'n/a',
          effect: 'pending',
        },
    isComplete
      ? {
          index: 4,
          kind: 'click',
          title: 'Create Invoice',
          atMs: sentAt(3),
          state: 'done',
          ack: 'yes',
          valueCheck: 'n/a',
          effect: 'after-verified',
        }
      : {
          index: 4,
          kind: 'click',
          title: 'Create Invoice',
          state: 'not-run',
          ack: 'pending',
          valueCheck: 'n/a',
          effect: 'pending',
        },
  ]
  const reached = isComplete ? [browser!, server!, finalBrowser!] : [browser!]
  const lastPause = reached.at(-1)!.pause
  return {
    ...crossRuntime,
    version: 7,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    finalOutcome: isComplete ? 'demonstrated' : 'not-demonstrated',
    operation: {
      ...crossRuntime.operation!,
      continuedPause: lastPause,
      afterVerified: isComplete,
    },
    operations,
    observations: reached,
    captures: crossRuntime.captures.filter(
      (capture) =>
        isComplete ||
        (capture.phase !== 'after' &&
          (!capture.snapshotId || capture.snapshotId === browser!.id)),
    ),
  }
}

import type { ConfiguredStudy } from '../../configuredStudySchemas'
import { operationsRepositoryConfigSchema } from '../../repositoryConfigSchemas'
import { sha256 } from '../../runtimeSupport/utils/sha256'

import { createCrossRuntimeStudy } from './createCrossRuntimeStudy'

/** The recording-clock moments at which the four operations of {@link createOperationsStudy} were sent. */
export const OPERATION_TIMES_MS = [1000, 1500, 3500, 3800] as const

/**
 * Supplies inert saved history of a version 3 run of four ordered operations (choose, text, click, click) with a browser stop after operation 2 and a server and a browser stop after operation 4, never an application or native verification.
 * @param how - `complete` for a demonstrated run (four operations done); `failed-at-3` for a run that stopped: operation 1 and 2 done, 3 failed, 4 not run, with only the stop after operation 2 reached.
 * @param options - `press: true` replaces operation 3 (the Pending click) by a `press` of `Control+k` that waits for `#palette` and saves the study as format 21; the rest of the study keeps the format 8 rules.
 * `reverseProxy: true` declares `reverseProxy: { origin: 'https://app.example.test', upstreamPort: 4310 }` on the configuration and saves the study as format 22 (format 22 wins over 21 when `press` is also set).
 * @returns A decodable format 8 study (format 21 with `press`, format 22 with `reverseProxy`): its configuration has a server stop, so its observations carry `execution`, `declaredIndex` and `executionIndex`.
 * @example
 * createOperationsStudy().operations?.map((record) => record.state) // => ['done', 'done', 'done', 'done']
 * createOperationsStudy('failed-at-3').operations?.map((record) => record.state) // => ['done', 'done', 'failed', 'not-run']
 */
export function createOperationsStudy(
  how: 'complete' | 'failed-at-3' = 'complete',
  options: { press?: boolean; reverseProxy?: boolean } = {},
): ConfiguredStudy {
  const hasPress = options.press === true
  const hasReverseProxy = options.reverseProxy === true
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
      hasPress
        ? {
            kind: 'press',
            title: 'Open palette',
            key: 'Control+k',
            after: [{ kind: 'visible', selector: '#palette' }],
          }
        : { kind: 'click', title: 'Pending', selector: '#pending' },
      { kind: 'click', title: 'Create Invoice', selector: '#create' },
    ],
    inspections: crossRuntime.configuration.inspections,
    ...(hasReverseProxy
      ? {
          reverseProxy: {
            origin: 'https://app.example.test',
            upstreamPort: 4310,
          },
        }
      : {}),
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
          kind: hasPress ? 'press' : 'click',
          title: hasPress ? 'Open palette' : 'Pending',
          atMs: sentAt(2),
          state: 'done',
          ack: 'yes',
          valueCheck: 'n/a',
          effect: 'dispatched',
        }
      : {
          index: 3,
          kind: hasPress ? 'press' : 'click',
          title: hasPress ? 'Open palette' : 'Pending',
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
  const executions = ['browser', 'server-action', 'browser'] as const
  const reached = (
    isComplete ? [browser!, server!, finalBrowser!] : [browser!]
  ).map((observation, position) => ({
    ...observation,
    execution: executions[position]!,
    declaredIndex: position,
    executionIndex: position,
  }))
  const lastPause = reached.at(-1)!.pause
  return {
    ...crossRuntime,
    // Format 22 (a reverse proxy) wins over 21 (a press), as studyFormatOfConfiguration decides.
    version: hasReverseProxy ? 22 : hasPress ? 21 : 8,
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    finalOutcome: isComplete ? 'demonstrated' : 'not-demonstrated',
    operation: {
      ...crossRuntime.operation!,
      continuedPause: lastPause,
      afterVerified: isComplete,
    },
    firstExecutionObserved: false,
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

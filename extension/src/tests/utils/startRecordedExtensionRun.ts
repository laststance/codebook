import type { TestContext } from 'node:test'

import type { ChromeExtensionHistorySink } from '../../chromeExtensionHistorySink'
import type { ChromeExtensionLearningMaterialContent } from '../../chromeExtensionLearningSchemas'
import { CHROME_EXTENSION_PROFILE } from '../../constants'
import { readResource } from '../../resources'
import { createHarness } from '../helpers'

import {
  capturedStop,
  extensionIdentity,
} from './chromeExtensionHistoryFixture'
import { FakeChromeExtensionRuntime } from './fakeChromeExtensionRuntime'
import { openServerRepository } from './nodeServerHistoryFixture'
import { chromeExtensionConfigurationOf } from './startFakeChromeExtensionRun'

const POPUP_URL =
  'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html'
const WORKER_URL =
  'chrome-extension://abcdefghijklmnopabcdefghijklmnop/worker.js'

/** A fake run whose preparation starts the history the service handed it, as the real run does once its declaration resolved. */
export class HistoryFakeExtensionRuntime extends FakeChromeExtensionRuntime {
  beginHistory?: (
    identity: ReturnType<typeof extensionIdentity>,
  ) => Promise<ChromeExtensionHistorySink | undefined>
  history?: ChromeExtensionHistorySink

  override async prepare(): Promise<void> {
    this.history = await this.beginHistory?.(extensionIdentity())
    await super.prepare()
  }
}

/**
 * Starts a chrome-extension run on a service whose learning storage is a real repository, with a fake run that feeds the history the service started.
 * @param context - The test whose end closes the service and removes the learning directory.
 * @param repositoryOptions - The repository's limit, for a full library.
 * @returns The harness, the service, the run, its record and the repository.
 * @example const { run, record, service } = await startRecordedExtensionRun(context)
 */
export async function startRecordedExtensionRun(
  context: TestContext,
  repositoryOptions: Parameters<typeof openServerRepository>[1] = {},
) {
  const harness = await createHarness()
  context.after(() => harness.close())
  const { repository } = await openServerRepository(context, repositoryOptions)
  harness.service.nodeHistoryRepository = repository
  harness.service.nodeHistoryStore = repository.testHistories
  const run = new HistoryFakeExtensionRuntime()
  harness.service.environment.createChromeExtensionRun = async (input) => {
    run.beginHistory = input.beginHistory
    return run
  }
  const receipt = harness.service.start({
    instanceId: harness.service.instanceId,
    profile: CHROME_EXTENSION_PROFILE,
    key: 'extension-save',
    configuration: chromeExtensionConfigurationOf(harness),
  })
  const record = harness.service.record(receipt)
  await record.preparation
  return {
    harness,
    service: harness.service,
    run,
    record,
    repository,
    studyId: `${harness.service.instanceId}_${record.id}`,
  }
}

/**
 * Journals the two declared stops of the identity: a page stop and a service-worker stop, each paused and captured.
 * @param run - The run whose history receives them.
 * @param record - The run's record.
 * @example recordTwoStops(run, record)
 */
export function recordTwoStops(
  run: HistoryFakeExtensionRuntime,
  record: { id: string },
): void {
  run.history?.pauseOpened({
    pauseId: `${record.id}:1:page:1`,
    generation: 1,
    context: 'page',
    stopIndex: 1,
    targetUrl: POPUP_URL,
    workerGeneration: 0,
  })
  run.history?.captured(
    `${record.id}:1:page:1`,
    capturedStop({ stopIndex: 1, context: 'page' }),
  )
  run.history?.pauseOpened({
    pauseId: `${record.id}:2:service-worker:1`,
    generation: 1,
    context: 'service-worker',
    stopIndex: 2,
    targetUrl: WORKER_URL,
    workerGeneration: 1,
  })
  run.history?.captured(
    `${record.id}:2:service-worker:1`,
    capturedStop({ stopIndex: 2, context: 'service-worker' }),
  )
}

/** One entry of a history's events list, as the chat reads it. */
export type ListedExtensionEvent = {
  sequence: number
  type: string
  sourceHash?: string
}

/**
 * Reads the lean events list of a history as the chat does.
 * @param service - The service.
 * @param studyId - The history's study id.
 * @returns The listed events.
 * @example const events = await readExtensionEvents(service, studyId)
 */
export async function readExtensionEvents(
  service: Parameters<typeof readResource>[0],
  studyId: string,
): Promise<ListedExtensionEvent[]> {
  const page = await readResource(
    service,
    `codebook://node-history/${studyId}/events`,
  )
  if (!('text' in page)) throw new Error('The events are text.')
  return JSON.parse(JSON.parse(page.text).content)
}

/**
 * Builds the learning material of a recorded run from its events: a step citing each capture with the given context and the result when the journal holds one.
 * @param events - The events list.
 * @param options - The context to cite each capture with (`page` and `service-worker` by capture order), and the captures to leave out.
 * @returns The material content.
 * @example const content = extensionMaterial(events, {})
 */
export function extensionMaterial(
  events: readonly ListedExtensionEvent[],
  options: {
    contexts?: readonly string[]
    skipCaptures?: readonly number[]
    skipResult?: boolean
  } = {},
): ChromeExtensionLearningMaterialContent {
  const contexts = options.contexts ?? ['page', 'service-worker']
  const captures = events.filter((event) => event.type === 'capture')
  const result = events.find((event) => event.type === 'result')
  const stopSteps = captures.flatMap((capture, index) =>
    options.skipCaptures?.includes(index)
      ? []
      : [
          {
            id: `stop-${index + 1}`,
            from: 'extension',
            to: 'extension',
            label: `Stop ${index + 1}`,
            explanation: `The extension paused at stop ${index + 1}.`,
            evidence: 'observed' as const,
            reference: {
              type: 'stop' as const,
              sequence: capture.sequence,
              sourceHash: capture.sourceHash ?? '',
              context: contexts[index] ?? 'page',
            },
          },
        ],
  )
  const resultSteps =
    result && !options.skipResult
      ? [
          {
            id: 'result',
            from: 'extension',
            to: 'extension',
            label: 'Result',
            explanation: 'The click ended.',
            evidence: 'observed' as const,
            reference: { type: 'result' as const, sequence: result.sequence },
          },
        ]
      : []
  return {
    question: 'What does the ping do?',
    title: 'Ping',
    summary: 'The popup sends a ping and the worker answers.',
    participants: [{ id: 'extension', label: 'Extension' }],
    steps: [...stopSteps, ...resultSteps],
  }
}

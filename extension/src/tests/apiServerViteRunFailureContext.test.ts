import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { ACTIVE_TIMEOUT_MS } from '../constants'
import { readResource } from '../resources'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  apiServerRunHarness,
  type ApiServerRunHarness,
} from './utils/apiServerRunHarness'
import { realRunInService } from './utils/realRunInService'
import { sendOperation } from './utils/routeHandlerRunHarness'

/** A placeholder value that only the API package's own env file holds. */
const API_ENV_ONLY_VALUE = 'api-env-only-value-7'

/**
 * Hosts a `vite-dev` apiServer run in the service, with what the stand-in API printed and an optional env file in the API package, both laid down before the run prepares.
 * Called by the tests of this file.
 * @param context - The test.
 * @param options - `printed` is the stand-in API's output tail; `apiEnv` is the text of `apps/api/.env`; `extra` replaces harness options (for example a failing app start).
 * @returns The service, the run's receipt and the run harness.
 * @example const { service, receipt, harness } = await hostedRun(context, { printed: 'boom\n' })
 */
async function hostedRun(
  context: TestContext,
  options: {
    printed?: string
    apiEnv?: string
    extra?: Parameters<typeof apiServerRunHarness>[1] extends infer Options
      ? Options extends { extra?: infer Extra }
        ? Extra
        : never
      : never
  },
) {
  return realRunInService<ApiServerRunHarness>(context, {
    openHarness: async (inner) => {
      const harness = await apiServerRunHarness(inner, {
        adapter: 'vite-dev',
        ...(options.extra ? { extra: options.extra } : {}),
      })
      harness.fake.outputTail = options.printed ?? ''
      if (options.apiEnv !== undefined) {
        await mkdir(join(harness.directory, 'apps/api'), { recursive: true })
        await writeFile(
          join(harness.directory, 'apps/api/.env'),
          options.apiEnv,
        )
      }
      return harness
    },
  })
}

/**
 * Moves the clock past the 20 s bound after the operation was sent, so the operation fails while the API is alive.
 * @param harness - The run's harness with operation 1 sent.
 * @example await failOperation(harness)
 */
async function failOperation(harness: ApiServerRunHarness): Promise<void> {
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the not-reached failure',
  )
}

/**
 * Reads the run resource an agent reads.
 * @param service - The hosting service.
 * @param runUri - The run's URI.
 * @returns The parsed run resource.
 * @example const run = await readRun(service, receipt.runUri)
 */
async function readRun(
  service: Awaited<ReturnType<typeof hostedRun>>['service'],
  runUri: string,
) {
  const resource = await readResource(service, runUri)
  return JSON.parse('text' in resource ? resource.text : '{}') as {
    apiServer?: { port?: number; outputTail?: string }
  }
}

// Value: protects=B2 a value that only the API package's .env holds and the API prints is masked in the API output journal, apiServer.outputTail and details.apiOutputTail; fails_when=the API launcher's mask lacks the API package's env-file values, so the tails or the journal quote the value; no_claim=values of files the API never reads
test("a value only in the API package's .env is masked in the journal, outputTail and details.apiOutputTail", async (context) => {
  // Arrange
  const printed = `connect failed for ${API_ENV_ONLY_VALUE}\n`
  const { service, receipt, harness } = await hostedRun(context, {
    printed,
    apiEnv: `DB_PASSWORD=${API_ENV_ONLY_VALUE}\n`,
  })
  await sendOperation(harness, 1)
  await harness.fake.emitOutput(printed, 'stdout')
  // Act
  await failOperation(harness)
  // Assert
  const state = service.state(service.record(receipt))
  const journaled = harness.run
    .view()
    .events.filter((event) => event.type === 'api-server.output')
    .map((event) => (event.detail as { text: string }).text)
    .join('')
  assert.deepEqual(
    {
      detailsTail: (state.error?.details as { apiOutputTail?: string })
        .apiOutputTail,
      viewTail: harness.run.view().apiServer?.outputTail,
      journaled,
      launcherMasksIt:
        harness.fake.checkInputs[0]!.secrets!().has(API_ENV_ONLY_VALUE),
    },
    {
      detailsTail: 'connect failed for [masked]',
      viewTail: 'connect failed for [masked]',
      journaled: 'connect failed for [masked]\n',
      launcherMasksIt: true,
    },
  )
})

// Value: protects=B3 a preparation that fails after the API launched still carries the API's masked tail in details.apiOutputTail, although the run recorded no failure yet; fails_when=the preparation error reads the failure-gated view tail and drops the field; no_claim=the wording of the failure
test('a preparation failure after the API launched carries details.apiOutputTail', async (context) => {
  // Arrange
  const printed = 'connect ECONNREFUSED 127.0.0.1:5432\n'
  // Act
  const { service, receipt } = await hostedRun(context, {
    printed,
    extra: { applicationStartFails: 'The app did not start.' },
  })
  // Assert
  const state = service.state(service.record(receipt))
  assert.equal(
    (state.error?.details as { apiOutputTail?: string } | undefined)
      ?.apiOutputTail,
    'connect ECONNREFUSED 127.0.0.1:5432',
  )
})

// Value: protects=B4 the run resource an agent reads carries the sanitized apiServer block, with outputTail after a failed operation and none on a healthy run; fails_when=StudyService.state leaves apiServer out of the public material, or serves the tail of a healthy run; no_claim=the contents of the tail (masking tests)
test('the run resource carries apiServer.outputTail after a failed operation and none on a healthy run', async (context) => {
  // Arrange
  const healthy = await hostedRun(context, { printed: 'listening on 4100\n' })
  const failed = await hostedRun(context, {
    printed: 'connect ECONNREFUSED 127.0.0.1:5432\n',
  })
  await sendOperation(failed.harness, 1)
  // Act
  await failOperation(failed.harness)
  // Assert
  const healthyRun = await readRun(healthy.service, healthy.receipt.runUri)
  const failedRun = await readRun(failed.service, failed.receipt.runUri)
  assert.deepEqual(
    {
      healthy: {
        hasPort: healthyRun.apiServer?.port === 4100,
        tail: healthyRun.apiServer?.outputTail,
      },
      failedTail: failedRun.apiServer?.outputTail,
    },
    {
      healthy: { hasPort: true, tail: undefined },
      failedTail: 'connect ECONNREFUSED 127.0.0.1:5432',
    },
  )
})

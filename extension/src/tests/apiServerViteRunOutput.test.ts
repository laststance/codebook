import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { ACTIVE_TIMEOUT_MS } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { maskRunSecrets } from '../utils/maskRunSecrets'

import {
  apiServerRunHarness,
  type ApiServerRunHarness,
} from './utils/apiServerRunHarness'
import { realRunInService } from './utils/realRunInService'
import { sendOperation } from './utils/routeHandlerRunHarness'

/** Node's inspector banner as an API started under `--inspect-brk` prints it first. */
const INSPECTOR_BANNER =
  'Debugger listening on ws://127.0.0.1:9229/00000000-0000-4000-8000-000000000000\nFor help, see: https://nodejs.org/en/docs/inspector\nDebugger attached.\n'
/** What a stopped database makes an API print. */
const DATABASE_DOWN = 'connect ECONNREFUSED 127.0.0.1:5432'
/** A placeholder password the learner types after the launch. */
const LEARNER_PASSWORD = 'pw-typed-by-learner-9'

/**
 * Hosts a `vite-dev` apiServer run in the service, so the run resource and the failure are the ones an agent reads.
 * Called by the tests of this file.
 * @param context - The test.
 * @param extra - Harness options that replace the defaults (the operations of a password run).
 * @returns The service, the run's receipt and the run harness.
 * @example const { service, receipt, harness } = await hostedViteRun(context)
 */
async function hostedViteRun(
  context: TestContext,
  extra?: Parameters<typeof apiServerRunHarness>[1],
) {
  return realRunInService<ApiServerRunHarness>(context, {
    openHarness: (inner) =>
      apiServerRunHarness(inner, { adapter: 'vite-dev', ...extra }),
  })
}

/**
 * Moves the clock past the 20 s bound after the operation was sent, so the API stop is not reached and the operation fails while the API is alive.
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

// Value: protects=D33 on Vite: a failed operation of a vite-dev apiServer run quotes the API's masked output, banner-free, in details.apiOutputTail of the error the chat reads and in the run resource's apiServer.outputTail, and the service's sanitizing keeps it; fails_when=either field is absent, holds Node's banner, or sanitizing drops the details field; no_claim=what the API prints (the stand-in answers the tail)
test('a failed operation in a vite-dev apiServer run carries details.apiOutputTail and the run resource carries apiServer.outputTail while the API is alive', async (context) => {
  // Arrange
  const { service, receipt, harness } = await hostedViteRun(context)
  harness.fake.outputTail = `${INSPECTOR_BANNER}${DATABASE_DOWN}\n`
  await sendOperation(harness, 1)
  // Act
  await failOperation(harness)
  // Assert
  const state = service.state(service.record(receipt))
  assert.deepEqual(
    {
      code: state.error?.code,
      apiOutputTail: (state.error?.details as { apiOutputTail?: string })
        .apiOutputTail,
      viewTail: harness.run.view().apiServer?.outputTail,
    },
    {
      code: 'SERVER_STOP_NOT_REACHED',
      apiOutputTail: DATABASE_DOWN,
      viewTail: DATABASE_DOWN,
    },
  )
})

// Value: protects=D33 healthy side: a healthy apiServer run's resource carries no outputTail even when the API printed; fails_when=the tail is served for a run that did not fail; no_claim=the tail of a failed run
test("a healthy apiServer run's resource carries no outputTail", async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, { adapter: 'vite-dev' })
  harness.fake.outputTail = 'listening on 4100\n'
  // Act
  await harness.run.prepare()
  // Assert
  assert.deepEqual(
    {
      hasTail: 'outputTail' in (harness.run.view().apiServer ?? {}),
      failures: [...harness.run.view().failures],
    },
    { hasTail: false, failures: [] },
  )
})

// Value: protects=D33 banner: Node's inspector banner lines (Debugger listening on ws://...) never reach details.apiOutputTail or apiServer.outputTail, and the API's own lines keep their order; fails_when=a banner line fills the bounded tail an agent reads; no_claim=the banner filter on other text (withoutInspectorBanner tests)
test('Node inspector banner lines never reach details.apiOutputTail or apiServer.outputTail', async (context) => {
  // Arrange
  const { service, receipt, harness } = await hostedViteRun(context)
  harness.fake.outputTail = `${INSPECTOR_BANNER}first line\nsecond line\n`
  await sendOperation(harness, 1)
  // Act
  await failOperation(harness)
  // Assert
  const state = service.state(service.record(receipt))
  const detailsTail = (state.error?.details as { apiOutputTail?: string })
    .apiOutputTail
  assert.deepEqual(
    { detailsTail, viewTail: harness.run.view().apiServer?.outputTail },
    {
      detailsTail: 'first line\nsecond line',
      viewTail: 'first line\nsecond line',
    },
  )
})

// Value: protects=E-8 / D33 through the run and service: a learner secret typed after launch and split across two output chunks never appears in outputTail or details.apiOutputTail, because the run hands the launcher its live secret set; fails_when=the run gives the launcher a copy taken before the password was typed, or the service serves the raw tail; no_claim=the launcher's own stateful mask across chunks (ownedApiServer.test.ts)
test('a learner secret typed after launch and split across two output chunks never appears in outputTail or details.apiOutputTail', async (context) => {
  // Arrange
  const passwordOperations = [
    {
      kind: 'text' as const,
      title: 'Password',
      selector: '#password',
      secret: 'ask-learner' as const,
    },
  ]
  const { service, receipt, harness } = await hostedViteRun(context, {
    operations: passwordOperations,
    extra: {
      operations: {
        operations: passwordOperations,
        stopOperations: [1],
        stopParticipants: ['server'],
        controls: { '#password': { tagName: 'input', type: 'password' } },
      },
    },
  })
  // The stand-in masks the joined output with the live set the run handed the launcher, as the launcher's live mask does.
  const printed: string[] = []
  Object.defineProperty(harness.fake, 'outputTail', {
    get: () =>
      maskRunSecrets(printed.join(''), harness.fake.checkInputs[0]!.secrets!()),
  })
  // Act
  harness.run.action('op-1', 'repository-operation', {
    learnerSecret: LEARNER_PASSWORD,
  })
  await waitUntil(() => harness.inputsSeen() === 1, 'the password input')
  for (const chunk of ['login failed for pw-typed-by', '-learner-9 done\n']) {
    printed.push(chunk)
    await harness.fake.emitOutput(chunk)
  }
  await failOperation(harness)
  // Assert
  const state = service.state(service.record(receipt))
  assert.deepEqual(
    {
      stateKeepsPassword: JSON.stringify(state).includes(LEARNER_PASSWORD),
      detailsTail: (state.error?.details as { apiOutputTail?: string })
        .apiOutputTail,
      viewTail: harness.run.view().apiServer?.outputTail,
    },
    {
      stateKeepsPassword: false,
      detailsTail: 'login failed for [masked] done',
      viewTail: 'login failed for [masked] done',
    },
  )
})

// Value: protects=OCR1-3 an env-file value of the app that the API prints never appears in outputTail or details.apiOutputTail, because the run applies its own mask to the tail; fails_when=the view serves the launcher's tail unmasked by the run's env-file values; no_claim=the launcher's live learner-secret mask (ownedApiServer.test.ts)
test('an env-file value of the app that the API prints is masked in outputTail and details.apiOutputTail', async (context) => {
  // Arrange
  const { service, receipt, harness } = await hostedViteRun(context, {
    extra: {
      // The Vite stand-in reports this env-file value as one the launcher masks.
      maskedValues: ['env-file-value-31'],
    },
  })
  harness.fake.outputTail = 'connect failed for env-file-value-31\n'
  await sendOperation(harness, 1)
  // Act
  await failOperation(harness)
  // Assert
  const state = service.state(service.record(receipt))
  assert.deepEqual(
    {
      detailsTail: (state.error?.details as { apiOutputTail?: string })
        .apiOutputTail,
      viewTail: harness.run.view().apiServer?.outputTail,
    },
    {
      detailsTail: 'connect failed for [masked]',
      viewTail: 'connect failed for [masked]',
    },
  )
})

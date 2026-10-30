import assert from 'node:assert/strict'
import { test } from 'node:test'

import { z } from 'zod'

import { ERROR_RECOVERY } from '../errors'
import { readResource } from '../resources'
import { formatRefusalFailure } from '../utils/formatRefusalFailure'

import { configuredServiceHarness } from './utils/configuredServiceHarness'

/** The error object of a run resource, as an agent reads it. */
const runErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    cause: z.string(),
    recovery: z.string(),
  }),
})

/** The static recovery of a Next setup deadline at the router step when the page exposes no Next router. */
const ROUTER_ABSENT_RECOVERY =
  'Tell the learner the page at entryPath is not a Next Pages page: it exposes no Next router. Set entryPath to the Pages page the question is about, then one new start; never retry with the same entryPath. Recovery: fix the configuration, then one new start. The browser Codebook opened was closed and no input or click was sent; Codebook stops the server it started (read resourcesReleased in the run resource). See codebook://help/repository-browser#NEXT_SETUP_DEADLINE.'

/** The static recovery of a Next setup deadline before the browser opened. */
const BEFORE_BROWSER_RECOVERY =
  'Start once more with a new key (the first compile is warm after it); a second deadline means the project does not start in time for Codebook, so tell the learner the step the message names. Recovery: one retry, then the learner. The owned server was stopped; no browser was opened; no input was sent (read resourcesReleased in the run resource). See codebook://help/repository-browser#NEXT_SETUP_DEADLINE.'

/**
 * Starts a configured run on the service harness, lets it prepare, and ends its runtime with one recorded failure text, as a run's timer or event does.
 * @returns The run resource's error object.
 */
async function runResourceErrorAfterRuntimeFailure(
  context: Parameters<typeof configuredServiceHarness>[0],
  failureText: string,
) {
  const { service, configuration, runtimes } =
    await configuredServiceHarness(context)
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'next-runtime-failure',
    configuration,
  })
  await service.record(receipt).preparation
  runtimes[0]!.failures.push(failureText)
  runtimes[0]!.status = 'failed'
  const resource = await readResource(service, receipt.runUri)
  assert.ok('text' in resource)
  return runErrorSchema.parse(JSON.parse(resource.text)).error
}

/**
 * Starts a configured run whose runtime records one failure text during its preparation and then rejects with an error that is no domain error, as a runtime whose cleanup closed its transport does.
 * @returns The run resource's error object.
 */
async function runResourceErrorAfterPreparationFailure(
  context: Parameters<typeof configuredServiceHarness>[0],
  failureText: string,
) {
  const { service, configuration, environment, runtimes } =
      await configuredServiceHarness(context),
    create = environment.createRuntime
  environment.createRuntime = async (...arguments_) => {
    const runtime = await create(...arguments_)
    runtime.prepare = async () => {
      runtimes[0]!.failures.push(failureText)
      runtimes[0]!.status = 'failed'
      throw new Error('CDP disconnected')
    }
    return runtime
  }
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'next-preparation-failure',
    configuration,
  })
  await service.record(receipt).preparation
  const resource = await readResource(service, receipt.runUri)
  assert.ok('text' in resource)
  return runErrorSchema.parse(JSON.parse(resource.text)).error
}

// Value: protects=a Pages run whose page exposes no Next router reaches the agent as NEXT_SETUP_DEADLINE with the router-absent recovery (fix entryPath, never retry unchanged), not RUNTIME_FAILED or the general one-retry recovery; fails_when=the run resource's error is RUNTIME_FAILED with the prefixed text as its cause, or carries the general recovery; why_new=Cycle 0065 codes survive the async path (service.ts runtimeFailureError); seam=ControlledConfiguredRuntime failures
test('a Pages setup deadline with no Next router shows NEXT_SETUP_DEADLINE with the router-absent recovery in the run resource', async (context) => {
  // Arrange
  const message =
    'Repository setup deadline (90 s) exceeded while waiting for the page router to become ready before sending the declared input or click: the page exposes no Next router (window.next.router is absent). Codebook stopped the server it started; the browser Codebook opened was closed and no input or click was sent.'
  // Act
  const error = await runResourceErrorAfterRuntimeFailure(
    context,
    formatRefusalFailure('NEXT_SETUP_DEADLINE', message, 'router-absent'),
  )
  // Assert
  assert.deepEqual(error, {
    code: 'NEXT_SETUP_DEADLINE',
    message,
    cause: message,
    recovery: ROUTER_ABSENT_RECOVERY,
  })
})

// Value: protects=a stop the Pages run could not seal reaches the agent as NEXT_STOP_NOT_SEALED with its static recovery; fails_when=the run resource shows RUNTIME_FAILED; why_new=Cycle 0065 codes survive the async path; seam=ControlledConfiguredRuntime failures
test('a Pages stop that could not be sealed shows NEXT_STOP_NOT_SEALED with its recovery in the run resource', async (context) => {
  // Arrange
  const message =
    'Codebook could not verify a browser source mapping for src/pages/index.tsx:11. This does not establish that the code is server-only.'
  // Act
  const error = await runResourceErrorAfterRuntimeFailure(
    context,
    formatRefusalFailure('NEXT_STOP_NOT_SEALED', message),
  )
  // Assert
  assert.deepEqual(error, {
    code: 'NEXT_STOP_NOT_SEALED',
    message,
    cause: message,
    recovery: ERROR_RECOVERY.NEXT_STOP_NOT_SEALED,
  })
})

// Value: protects=a Fast Refresh of a sealed module during a Pages run reaches the agent as SOURCE_CHANGED with its recovery (earlier observations stay readable, never retry input automatically); fails_when=the run resource shows RUNTIME_FAILED; why_new=Cycle 0065 mid-run module replacement; seam=ControlledConfiguredRuntime failures
test('a sealed module replaced during a Pages run shows SOURCE_CHANGED with its recovery in the run resource', async (context) => {
  // Arrange
  const message =
    "src/components/PostList.tsx changed during the run, so Codebook stopped it. Earlier captured observations remain readable. The click's result was not verified."
  // Act
  const error = await runResourceErrorAfterRuntimeFailure(
    context,
    formatRefusalFailure('SOURCE_CHANGED', message),
  )
  // Assert
  assert.deepEqual(error, {
    code: 'SOURCE_CHANGED',
    message,
    cause: message,
    recovery: ERROR_RECOVERY.SOURCE_CHANGED,
  })
})

// Value: protects=a Pages setup deadline that ends the preparation keeps its code and its step's static recovery when the preparation rejects with a closed transport; fails_when=the preparation error keeps the Vite-only restore (RUNTIME_FAILED with the prefixed text) or drops the variant's recovery; why_new=Cycle 0065 codes survive the async path (service.ts preparationError); seam=environment.createRuntime and runtime.prepare
test('a Pages setup deadline during preparation shows NEXT_SETUP_DEADLINE with the before-browser recovery in the run resource', async (context) => {
  // Arrange
  const message =
    'Repository setup deadline (90 s) exceeded while reading the route manifests. Codebook stopped the server it started; the browser was not opened.'
  // Act
  const error = await runResourceErrorAfterPreparationFailure(
    context,
    formatRefusalFailure('NEXT_SETUP_DEADLINE', message, 'before-browser'),
  )
  // Assert
  assert.deepEqual(error, {
    code: 'NEXT_SETUP_DEADLINE',
    message,
    cause: message,
    recovery: BEFORE_BROWSER_RECOVERY,
  })
})

// Value: protects=a source change that ends a Pages run's preparation keeps SOURCE_CHANGED; fails_when=the preparation error restores only Vite codes; why_new=Cycle 0065 registry at service.ts preparationError; seam=environment.createRuntime and runtime.prepare
test('a sealed module replaced during a Pages preparation shows SOURCE_CHANGED in the run resource', async (context) => {
  // Arrange
  const message =
    'src/pages/index.tsx changed during the run, so Codebook stopped it. Earlier captured observations remain readable.'
  // Act
  const error = await runResourceErrorAfterPreparationFailure(
    context,
    formatRefusalFailure('SOURCE_CHANGED', message),
  )
  // Assert
  assert.deepEqual(error, {
    code: 'SOURCE_CHANGED',
    message,
    cause: message,
    recovery: ERROR_RECOVERY.SOURCE_CHANGED,
  })
})

// Value: protects=a secret in a Next refusal's message never reaches its recovery, which is static and passes no sanitizer; records that the service's sanitizedError masks no key=value or query token, so the message's producer must redact them; fails_when=the recovery carries a value from the message, or the sanitizer's handling of these tokens changes unnoticed; why_new=Cycle 0065 secrets requirement (Issue 166); seam=environment.createRuntime and runtime.prepare
test('a Next refusal whose message carries a token keeps it out of the static recovery, and the cause sanitizer leaves key=value tokens to the message producer', async (context) => {
  // Arrange
  const message =
    // eslint-disable-next-line browser-security/no-credentials-in-query-params -- the seeded secret this test keeps out of the recovery.
    'Codebook loaded / and was redirected to /login?token=SECRET. The server printed API_KEY=SECRET.'
  // Act
  const error = await runResourceErrorAfterPreparationFailure(
    context,
    formatRefusalFailure('NEXT_ENTRY_REDIRECTED', message),
  )
  // Assert
  assert.equal(error.code, 'NEXT_ENTRY_REDIRECTED')
  assert.equal(error.recovery, ERROR_RECOVERY.NEXT_ENTRY_REDIRECTED)
  assert.equal(error.recovery.includes('SECRET'), false)
  // The sanitizer hides private roots and secret shapes (Bearer, JWT, provider keys, URL passwords) only; these tokens pass unchanged.
  assert.equal(error.message, message)
  assert.equal(error.cause, message)
})

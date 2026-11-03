import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REPOSITORY_SETUP_TIMEOUT_MS } from '../constants'
import { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'

const NO_STOPS: never[] = []

// Value: protects=a Next run in a workspace without a Pages folder keeps today's readiness check (the launcher's ready() with the configured entry path), so App runs are unchanged by the Pages run sequence; fails_when=an App-only run takes the structured entry check or reads the route manifests; why_new=Cycle 0065 pt1 App characterization (Issue 166); seam=configuredRuntimeHarness stand-in server; no_claim=the HTTP behavior of ready() itself (configuredApplication tests)
test('an App-only Next run proves readiness through the launcher readiness check with the configured entry path', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context)
  // Act
  await harness.run.prepare()
  // Assert
  assert.deepEqual(harness.readyEntryPaths, [undefined])
  assert.equal(harness.run.view().status, 'ready')
})

// Value: protects=an App-only Next run whose setup budget expires keeps the uncoded deadline text agents and tests know; fails_when=the App deadline gains a NEXT_SETUP_DEADLINE code or another sentence; why_new=Cycle 0065 pt1 App characterization (the Next deadline text becomes a callback); seam=sealHangs keeps the .next/dev read open until the run is cancelled; no_claim=the Pages deadline (nextPagesRun tests)
test('an App-only Next run whose setup budget expires fails with the uncoded Repository setup deadline exceeded', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    sealHangs: true,
  })
  const preparing = harness.run.prepare().catch(() => undefined)
  await waitUntil(
    () => harness.readyEntryPaths.length === 1,
    'the readiness check',
  )
  // Act
  harness.advance(REPOSITORY_SETUP_TIMEOUT_MS)
  await preparing
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Repository setup deadline exceeded',
  )
})

// Value: protects=a workspace with both routers whose entry resolved as an App route keeps the uncoded deadline text when the budget expires; fails_when=a Pages-capable workspace gains NEXT_SETUP_DEADLINE for an App entry; why_new=Cycle 0065 CodeRabbit round 1 (the early-step code must not reach App runs); seam=sealHangs after the manifests resolved the entry as App; no_claim=the Pages deadline (nextPagesRun tests)
test('a both-routers run whose entry resolved as App keeps the uncoded Repository setup deadline exceeded', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    sealHangs: true,
    nextPages: {
      withAppFolder: true,
      manifests: {
        settings: {},
        kind: 'app',
        route: {
          key: '/page',
          path: '.next/dev/server/app/page_client-reference-manifest.js',
        },
      },
    },
  })
  const preparing = harness.run.prepare().catch(() => undefined)
  await waitUntil(
    () => harness.appEntryConfirmations.length === 1,
    'the App verdict',
  )
  // Act
  harness.advance(REPOSITORY_SETUP_TIMEOUT_MS)
  await preparing
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Repository setup deadline exceeded',
  )
})

// Value: protects=a both-routers run whose entry the manifests resolved as App keeps the uncoded deadline text when the budget expires during the App verdict itself, and its resource names the App route; fails_when=the App resolution is recorded only after confirmAppEntry, so the deadline carries NEXT_SETUP_DEADLINE; why_new=Cycle 0066 task 47 (deadline during confirmAppEntry coded as a Pages-path step); seam=appEntryConfirmationHangs keeps the App verdict open until the run is cancelled; no_claim=a real redirected root
test('a both-routers run whose budget expires during the App verdict of an entry resolved as App keeps the uncoded Repository setup deadline exceeded', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    appEntryConfirmationHangs: true,
    nextPages: {
      withAppFolder: true,
      manifests: {
        settings: {},
        kind: 'app',
        route: {
          key: '/page',
          path: '.next/dev/server/app/page_client-reference-manifest.js',
        },
      },
    },
  })
  const preparing = harness.run.prepare().catch(() => undefined)
  await waitUntil(
    () => harness.appEntryConfirmations.length === 1,
    'the App verdict',
  )
  // Act
  harness.advance(REPOSITORY_SETUP_TIMEOUT_MS)
  await preparing
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Repository setup deadline exceeded',
  )
  // The run lives in its own module realm, so its object is compared by value.
  assert.deepEqual(JSON.parse(JSON.stringify(harness.run.view().nextRoute)), {
    router: 'app',
    route: '/page',
  })
})

// Value: protects=an App Router readiness answer that is not OK, after Codebook's request ran the page's server components, fails the run with RUNTIME_FAILED, details.sideEffects unknown, the readiness record closed with that status, and a recovery that names an answer that is not OK as well as no answer; fails_when=the answered failure is not converted, the record lacks the status, or the recovery says the request never answered; no_claim=a real Next answer (the stand-in launcher rejects with its own sentence)
test('an App Router readiness answer that is not OK fails RUNTIME_FAILED with sideEffects unknown and a recovery that reads the status', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    entryPath: '/dashboard',
    readyAnswer: 500,
  })
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof StudyError)
  const described = failure.describe()
  const sentAtMs = harness.run.view().readinessRequest?.sentAtMs
  assert.equal(described.code, 'RUNTIME_FAILED')
  assert.equal(
    described.message,
    'Selected application page failed or redirected: 500. Select the actual entry path and prerequisites.',
  )
  assert.deepEqual(JSON.parse(JSON.stringify(described.details)), {
    sideEffects: 'unknown',
    readinessRequest: { state: 'closed', sentAtMs, status: 500 },
  })
  assert.equal(
    described.recovery,
    "Codebook's own readiness request for the entry path ran the page's server code (a data function, server components) before any stop was armed, and it did not end with an OK answer: read readinessRequest in the run resource, which holds the HTTP status of an answer that is not OK, or the outcome when no answer came. When that code writes or sends (a database write, a counter, an email, a payment call), it may have run: details.sideEffects is unknown, not none. Tell the learner, ask before another start, and never start again unasked. No declared input and no click was sent; Codebook stops the server it started (read resourcesReleased in the run resource). See codebook://help/repository-browser#readiness.entry-request.",
  )
})

// Value: protects=an App-only Next run whose server exits before it listens keeps the launcher's failure text word for word, with no preparation or webpack note; fails_when=the Pages-path launch notes reach a workspace without a Pages folder; why_new=Cycle 0065 (App launch-failure text unchanged without a Pages folder); seam=launchFailure makes the stand-in readiness reject; no_claim=the launcher's own text (configuredApplication tests)
test('an App-only Next run whose server exits before listening fails with the launcher text alone', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, NO_STOPS, {
    launchFailure: 'Application exited: 1: boom',
  })
  // Act
  const failure = await harness.run.prepare().then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal(
    Reflect.get(Object(failure), 'message'),
    'Application exited: 1: boom',
  )
})

// Value: protects=an App module parsed again under another script id after sealing keeps today's uncoded failure; fails_when=an App run reports SOURCE_CHANGED or another text; why_new=Cycle 0065 pt1 App characterization (Pages runs fail with SOURCE_CHANGED instead); seam=announceSealedModule re-announces the sealed module; no_claim=the Pages Fast Refresh case (nextPagesRun tests)
test('an App module parsed again after sealing fails the run with Selected module changed after sealing', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context)
  await harness.run.prepare()
  // Act
  harness.announceSealedModule('another')
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Selected module changed after sealing',
  )
})

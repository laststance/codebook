import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REPOSITORY_SETUP_TIMEOUT_MS } from '../constants'
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

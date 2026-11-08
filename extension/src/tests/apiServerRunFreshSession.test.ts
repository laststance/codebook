import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { apiServerRunHarness } from './utils/apiServerRunHarness'
import { ADD } from './utils/routeHandlerRunHarness'

/**
 * Opens a root vite-dev apiServer run (no `packageRoot`, the API in a folder below the root) whose repository has a saved session.
 * Why it exists: the two root runs of test 39 differ only in `session: "fresh"`.
 * @param context - The test.
 * @param session - `fresh` declares the fresh profile; absent keeps the saved session.
 * @returns The run harness; the store stand-in records every `acquire`.
 * @example const harness = await rootViteRun(context, 'fresh')
 */
async function rootViteRun(context: TestContext, session: 'fresh' | undefined) {
  return apiServerRunHarness(context, {
    adapter: 'vite-dev',
    extra: {
      packageRoot: undefined,
      packageApp: undefined,
      savedSession: { admission: 'saved' },
      operations: {
        operations: [ADD],
        stopOperations: [1],
        stopParticipants: ['server'],
        ...(session ? { session } : {}),
      },
    },
  })
}

/** What the run asked the saved-session store: the session word of each `acquire` call. */
function acquireRequests(calls: readonly string[]): string[] {
  return calls
    .filter((call) => call.startsWith('acquire:'))
    .map((call) => call.split(':')[2]!)
}

// Value: protects=D34 (test 39): the recipe's session "fresh" reaches the store as a fresh request for a root vite-dev apiServer run, and without it the run asks for the saved session; fails_when=the declaration is dropped for a run that declares apiServer, or a fresh request is sent without it; no_claim=the store honoring the request (savedSession tests) and admitSession, which D34 leaves unchanged
test('a root vite-dev apiServer run with session fresh opens a fresh profile although a saved session exists, and without it keeps the saved session', async (context) => {
  // Arrange
  const fresh = await rootViteRun(context, 'fresh')
  const kept = await rootViteRun(context, undefined)
  // Act
  await fresh.run.prepare()
  await kept.run.prepare()
  // Assert
  assert.deepEqual(
    {
      freshAsks: acquireRequests(fresh.savedSessionCalls),
      freshSkipped: 'savedSessionSkipped' in fresh.run.view(),
      keptAsks: acquireRequests(kept.savedSessionCalls),
      keptSession: kept.run.view().session,
    },
    {
      freshAsks: ['fresh'],
      freshSkipped: false,
      keptAsks: ['saved-if-available'],
      keptSession: 'saved',
    },
  )
})

// Value: protects=D34 (test 40): an Expo apiServer run cannot be a root run (the schema refuses an API folder inside the app's folder, D44), so it is always nested and starts fresh without touching the saved session whatever the recipe declares; fails_when=an Expo apiServer run asks the store or loads the saved session; no_claim=a root Expo run, which the schema refuses
test('an expo-web-dev apiServer run starts fresh and never asks the saved-session store although a saved session exists', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, {
    extra: { savedSession: { admission: 'saved' } },
  })
  // Act
  await harness.run.prepare()
  // Assert
  const view = harness.run.view()
  assert.deepEqual(
    {
      session: view.session,
      skipped: view.savedSessionSkipped,
      asks: acquireRequests(harness.savedSessionCalls),
    },
    { session: 'fresh', skipped: 'package-root', asks: [] },
  )
})

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  apiServerRunHarness,
  type ApiServerRunHarness,
} from './utils/apiServerRunHarness'
import { ADD } from './utils/routeHandlerRunHarness'

/** The browser stop's file, inside the app's folder and outside the API's. */
const APP_STOP_FILE = 'apps/app/src/mode.ts'

/**
 * Opens a vite-dev run whose API stop (declared first) precedes a browser stop (declared second), so the run's sealed stops (browser only) and the declared stops differ in position.
 * Called by the test of this file.
 * @param context - The test.
 * @example const harness = await apiBeforeBrowserHarness(context)
 */
function apiBeforeBrowserHarness(
  context: Parameters<typeof apiServerRunHarness>[0],
): Promise<ApiServerRunHarness> {
  return apiServerRunHarness(context, {
    adapter: 'vite-dev',
    additionalStops: [
      {
        line: 1,
        column: 7,
        inspections: [{ path: 'nextTheme', mode: 'value', required: true }],
      },
    ],
    extra: {
      operations: {
        operations: [ADD],
        stopOperations: [1, 1],
        stopParticipants: ['server', 'browser'],
      },
      additionalStopFile: APP_STOP_FILE,
    },
  })
}

// Value: protects=a dependency-optimizer page generation of a vite-dev apiServer run renews the browser stop's seal when an API stop is declared before it; fails_when=the renewal writes into the sealed-stop list by declared index, which throws or overwrites another stop; no_claim=a real Vite optimizer
test('a page generation of a vite-dev run renews the browser stop seal when an API stop is declared first', async (context) => {
  // Arrange
  const harness = await apiBeforeBrowserHarness(context)
  const preparing = harness.run.prepare()
  await waitUntil(() => harness.navigations.length === 1, 'first navigation')
  // Act
  harness.serveChangedModule('const nextTheme = "dark";\n// ?v=57ee5d84')
  harness.reloadPage()
  harness.announceSealedModule('second')
  await preparing
  // Assert
  const view = harness.run.view()
  assert.deepEqual(
    {
      status: view.status,
      failures: [...view.failures],
      resealed: view.events.filter((event) => event.type === 'source.resealed')
        .length,
    },
    { status: 'ready', failures: [], resealed: 1 },
  )
})

import type { TestContext } from 'node:test'

import { waitUntil } from '../../runtimeSupport/utils/waitUntil'

import {
  configuredRuntimeHarness,
  type ConfiguredRuntimeHarness,
} from './configuredRuntimeHarness'
import { entryControl } from './entryRenderHarness'

/**
 * Opens a `next-dev-webpack` run whose only stop is a browser stop at the entry load (`afterOperation: 0`), the page that has not finished loading.
 * @param context - The test.
 * @param extra - Harness options that replace the defaults.
 * @returns The configured runtime harness.
 * @example const harness = await entryBrowserHarness(context)
 */
export async function entryBrowserHarness(
  context: TestContext,
  extra: Partial<Parameters<typeof configuredRuntimeHarness>[3]> = {},
): Promise<ConfiguredRuntimeHarness> {
  return configuredRuntimeHarness(context, entryControl(context), [], {
    participant: 'browser',
    entryPath: '/dashboard',
    documentReadyState: 'loading',
    operations: {
      operations: [],
      stopOperations: [0],
      stopParticipants: ['browser'],
    },
    ...extra,
  })
}

/**
 * Waits until the browser-only run requested its stop, acknowledges it in the page's session and waits for the entry navigation.
 * @param harness - The entry-browser harness whose run is preparing.
 * @param acknowledgement - How the page's adapter acknowledges the registration, as {@link ConfiguredRuntimeHarness.acknowledgeOwnedBreakpointsInPage} takes it.
 * @example await armedBrowserEntry(harness)
 */
export async function armedBrowserEntry(
  harness: ConfiguredRuntimeHarness,
  acknowledgement: Parameters<
    ConfiguredRuntimeHarness['acknowledgeOwnedBreakpointsInPage']
  >[0] = {},
): Promise<void> {
  await waitUntil(
    () => harness.ownedBreakpointsRequested() >= 1,
    'the entry-load browser stop was requested',
  )
  // The adapter acknowledges the registration while the page's module is not parsed yet (pending is accepted).
  harness.acknowledgeOwnedBreakpointsInPage(acknowledgement)
  await waitUntil(
    () => harness.navigations.length >= 1,
    'the entry navigation started',
  )
}

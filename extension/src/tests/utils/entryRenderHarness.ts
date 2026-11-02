import type { TestContext } from 'node:test'

import type { RuntimeControl } from '../../runtime'
import { waitUntil } from '../../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './configuredRuntimeHarness'

/** The harness of an entry-render run ({@link entryRenderHarness}). */
export type EntryRenderHarness = Awaited<ReturnType<typeof entryRenderHarness>>

/**
 * Builds the control the service gives a run; the whole-run deadline is far away by default so a test moves only the clock it means to.
 * Called by {@link entryRenderHarness} and by tests that need their own whole-run deadline.
 * @param context - The test, whose end aborts the run.
 * @param wholeRunMs - Milliseconds from now to the whole-run deadline.
 * @example entryControl(context, 200_000).runId // => 'service-run-71'
 */
export function entryControl(
  context: TestContext,
  wholeRunMs = 900_000,
): RuntimeControl {
  const abort = new AbortController()
  context.after(() => abort.abort())
  return {
    signal: abort.signal,
    deadlineAt: Date.now() + wholeRunMs,
    preparationDeadlineAt: Date.now() + wholeRunMs,
    runId: 'service-run-71',
  }
}

/**
 * Opens the entry-render run of Cycle 0071's AC 2: entry `/dashboard`, one server stop sealed in `(rsc)` and declared `afterOperation: 0`; `operations` is omitted unless the options bring their own.
 * Why it exists: every entry-render integration test starts the same way; the options add what differs (a held navigation, a saved session, operations).
 * @param context - The test.
 * @param extra - Harness options that replace the defaults (`operations` replaces the zero-operation list).
 * @param control - The run's control.
 * @param additionalStops - Further stops of the configuration (the first stop of the harness is the entry-render stop).
 * @example const harness = await entryRenderHarness(context, { holdNavigation: true })
 */
export async function entryRenderHarness(
  context: TestContext,
  extra: Partial<Parameters<typeof configuredRuntimeHarness>[3]> = {},
  control: RuntimeControl = entryControl(context),
  additionalStops: Parameters<typeof configuredRuntimeHarness>[2] = [],
) {
  return configuredRuntimeHarness(context, control, additionalStops, {
    participant: 'server',
    serverSeal: 'rsc',
    serverRuntime: { route: '/dashboard' },
    entryPath: '/dashboard',
    documentReadyState: 'loading',
    operations: {
      operations: [],
      stopOperations: [0],
      stopParticipants: ['server'],
    },
    ...extra,
  })
}

/**
 * Waits until the server stop was registered and the entry navigation was sent, the state a hit may arrive in.
 * @param harness - The entry-render harness whose run is preparing.
 * @example await armedEntry(harness)
 */
export async function armedEntry(harness: EntryRenderHarness): Promise<void> {
  await waitUntil(
    () => harness.server!.breakpointsAcknowledged() > 0,
    'the server stop was registered',
  )
  await waitUntil(
    () => harness.navigations.length >= 1,
    'the entry navigation started',
  )
}

/**
 * Sends the hit of the entry-render stop on the entry route and returns its published pause.
 * @param harness - The entry-render harness whose run is preparing.
 * @param route - What the work store answers on the frame (default the entry route).
 * @returns The server participant's published snapshot, whose `pause` the continue takes.
 * @example const pause = await heldEntryPause(harness)
 */
export async function heldEntryPause(
  harness: EntryRenderHarness,
  route = '/dashboard',
) {
  await armedEntry(harness)
  harness.server!.hit({ route })
  return waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the published entry-render pause',
  )
}

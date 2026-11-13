import type { TestContext } from 'node:test'

import type { RuntimeControl } from '../../runtime'
import { waitUntil } from '../../runtimeSupport/utils/waitUntil'

import {
  configuredRuntimeHarness,
  type ConfiguredRuntimeHarness,
} from './configuredRuntimeHarness'
import { entryControl } from './entryRenderHarness'

/** A source of three statements, so a server stop and a browser stop can sit on different lines of one file. */
export const THREE_LINE_SOURCE =
  'var nextTheme = "dark";\nvar between = 1;\nvar enabled = false;\n'
/** The map of {@link THREE_LINE_SOURCE}: generated line n is source line n + 1. */
export const THREE_LINE_MAP = 'AAAA;AACA;AACA'
/** A required value of the harness page at the browser stop on line 3. */
export const ENABLED_STOP = [
  { path: 'enabled', mode: 'value', required: true },
] as const
/** Reads the details of every journal entry of one type as plain data. @example journaled(harness, 'breakpoint.server-copy-resumed') */
export function journaled(
  harness: ConfiguredRuntimeHarness,
  type: string,
): unknown[] {
  return harness.run
    .view()
    .events.filter((event) => event.type === type)
    .map((event) => JSON.parse(JSON.stringify(event.detail)))
}

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

/**
 * Opens a `next-dev-webpack` run with a server stop on line 1 and a browser stop on line 3, both at the entry load, the server stop first.
 * @param context - The test.
 * @returns The configured runtime harness with a scripted server participant.
 * @example const harness = await serverThenBrowserHarness(context)
 */
export async function serverThenBrowserHarness(
  context: TestContext,
  control: RuntimeControl = entryControl(context),
): Promise<ConfiguredRuntimeHarness> {
  return configuredRuntimeHarness(
    context,
    control,
    [{ line: 3, column: 1, inspections: [...ENABLED_STOP] }],
    {
      participant: 'server',
      serverSeal: 'rsc',
      serverRuntime: { route: '/dashboard' },
      entryPath: '/dashboard',
      documentReadyState: 'loading',
      mappings: THREE_LINE_MAP,
      fixture: { source: THREE_LINE_SOURCE, citationEndLine: 3 },
      operations: {
        operations: [],
        stopOperations: [0, 0],
        stopParticipants: ['server', 'browser'],
      },
    },
  )
}

/**
 * Waits until both entry-load stops were requested, acknowledges them in the page's session and waits for the entry navigation.
 * @param harness - The server-then-browser harness whose run is preparing.
 * @example await armedServerThenBrowser(harness)
 */
export async function armedServerThenBrowser(
  harness: ConfiguredRuntimeHarness,
): Promise<void> {
  await waitUntil(
    () =>
      harness.breakpoints.filter((breakpoint) =>
        breakpoint.id.startsWith('owned-breakpoint'),
      ).length >= 2,
    'both entry-load stops were requested',
  )
  harness.acknowledgeOwnedBreakpointsInPage()
  await waitUntil(
    () => harness.navigations.length >= 1,
    'the entry navigation started',
  )
}

/**
 * Drives a server-then-browser entry load to the point where the server stop was continued and the browser stop is still awaited.
 * @param context - The test.
 * @returns The harness, its prepare promise and the id of the editor's breakpoint of the browser stop.
 * @example const { harness, prepared, browserStopBreakpointId } = await serverStopContinued(context)
 */
export async function serverStopContinued(context: TestContext) {
  const harness = await serverThenBrowserHarness(context)
  // The test sends the browser stop's pause itself: the continuation of the browser stop must not send another.
  harness.suppressNextPause()
  const prepared = harness.run.prepare()
  await armedServerThenBrowser(harness)
  harness.commitMainFrame('/dashboard')
  harness.server!.hit({ route: '/dashboard' })
  const serverPause = await waitUntil(
    () => harness.run.view().participants.server?.snapshot,
    'the published server pause',
  )
  await harness.run.continue('server', serverPause.pause)
  const browserStopBreakpointId = harness.breakpoints.find((breakpoint) =>
    breakpoint.id.startsWith('owned-breakpoint-'),
  )!.id
  return { harness, prepared, browserStopBreakpointId }
}

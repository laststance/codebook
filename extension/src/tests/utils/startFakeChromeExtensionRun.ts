import { CHROME_EXTENSION_PROFILE } from '../../constants'
import type { StudyRecord } from '../../service'
import type { createHarness } from '../helpers'

import { FakeChromeExtensionRuntime } from './fakeChromeExtensionRuntime'

/** The declaration of a chrome-extension test run: a popup, two titled clicks, a page stop and a service-worker stop, the popup status text observed, over the harness's published article. */
export function chromeExtensionConfigurationOf(
  harness: Pick<Awaited<ReturnType<typeof createHarness>>, 'configuration'>,
) {
  return {
    version: 1,
    adapter: 'chrome-mv3-unpacked',
    book: harness.configuration.book,
    extensionRoot: 'ping-extension',
    surface: { kind: 'popup' },
    clicks: [
      { title: 'Press Ping', selector: '#ping' },
      { title: 'Press Reset', selector: '#reset' },
    ],
    stops: [
      { path: 'popup.js', line: 2, context: 'page' },
      { path: 'background.js', line: 3, context: 'service-worker' },
    ],
    observe: { kind: 'text', selector: '#status' },
  }
}

/** What {@link startFakeChromeExtensionRun} can set beside the key. */
type FakeChromeExtensionRunOptions = {
  key?: string
  /** The error the run's preparation rejects with. */
  prepareFailure?: FakeChromeExtensionRuntime['prepareFailure']
  /** Fields that replace or extend the declaration, such as `acknowledgedPermissions`. */
  configuration?: Record<string, unknown>
}

/**
 * Starts a chrome-extension run on a service whose environment creates a {@link FakeChromeExtensionRuntime}, and waits for its preparation.
 * @param harness - The service harness (`createHarness`) the run starts on.
 * @param options - The start key, a preparation failure and declaration overrides.
 * @returns The service, the run's record, the fake run, the start's receipt and the creation inputs the environment was given.
 * @example const { service, record, run } = await startFakeChromeExtensionRun(harness) // run.view().phase === 'ready'
 */
export async function startFakeChromeExtensionRun(
  harness: Pick<
    Awaited<ReturnType<typeof createHarness>>,
    'service' | 'configuration'
  >,
  options: FakeChromeExtensionRunOptions = {},
) {
  const { service } = harness
  const run = new FakeChromeExtensionRuntime()
  run.prepareFailure = options.prepareFailure
  const created: Parameters<
    NonNullable<typeof service.environment.createChromeExtensionRun>
  >[0][] = []
  service.environment.createChromeExtensionRun = async (input) => {
    created.push(input)
    return run
  }
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: CHROME_EXTENSION_PROFILE,
    key: options.key ?? 'extension-run',
    configuration: {
      ...chromeExtensionConfigurationOf(harness),
      ...options.configuration,
    },
  })
  const record: StudyRecord = service.record(receipt)
  await record.preparation
  return { service, record, run, receipt, created }
}

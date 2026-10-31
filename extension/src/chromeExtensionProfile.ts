import {
  ACTIVE_TIMEOUT_MS,
  CHROME_EXTENSION_MIN_VERSION,
  CHROME_EXTENSION_MINIMUM_EXTENSION_VERSION,
  CHROME_EXTENSION_PROFILE,
  EXTENSION_CLICK_ACTION,
  EXTENSION_CLICK_LIMIT,
  EXTENSION_STOP_LIMIT,
  EXTENSION_WORKER_PAUSE_HOLD_MS,
  REPOSITORY_CONFIG_LIMIT_BYTES,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
  REPOSITORY_RUN_TIMEOUT_MS,
  REPOSITORY_SETUP_TIMEOUT_MS,
} from './constants'

/**
 * Describes the chrome-extension profile for `codebook_status`: identity, its one action, limits and machine prerequisites, so an agent knows before a start whether an unpacked extension can run here and what is missing.
 * Called by {@link StudyService.status} with the environment's report.
 * @param prerequisites - Whether the profile can start here and each missing item (Chrome 149 or later, a supported system, the owned adapter), named.
 * @returns The profile entry; the fix line for an old Chrome is the environment's `missing` sentence.
 * @example
 * describeChromeExtensionProfile({ ready: false, missing: ['Chrome 149 or later is needed to load an unpacked extension; found 148.'] }).prerequisites.ready // => false
 */
export function describeChromeExtensionProfile(prerequisites: {
  ready: boolean
  missing: string[]
}) {
  return {
    id: CHROME_EXTENSION_PROFILE,
    title: 'Repository Chrome extension (Manifest V3)',
    description:
      "Load the repository's own unpacked Manifest V3 extension into a fresh test Chrome with seeded data, perform up to three declared clicks in its popup or page, and stop in the extension's page or service-worker source with native debugger stops.",
    requiresConfiguration: true,
    configurationVersions: [1],
    minimumExtensionVersion: CHROME_EXTENSION_MINIMUM_EXTENSION_VERSION,
    helpUri: 'codebook://help/chrome-extension',
    adapter: 'chrome-mv3-unpacked',
    actions: [
      { id: EXTENSION_CLICK_ACTION, title: 'Perform the next declared click' },
    ],
    items: [],
    expectations: [],
    requiredLinks: [],
    capturePhases: [],
    limits: {
      runTimeoutMs: REPOSITORY_RUN_TIMEOUT_MS,
      setupTimeoutMs: REPOSITORY_SETUP_TIMEOUT_MS,
      activeTimeoutMs: ACTIVE_TIMEOUT_MS,
      pauseHoldTimeoutMs: REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
      workerPauseHoldTimeoutMs: EXTENSION_WORKER_PAUSE_HOLD_MS,
      activeBudget: 'per-action',
      configurationBytes: REPOSITORY_CONFIG_LIMIT_BYTES,
      clicks: EXTENSION_CLICK_LIMIT,
      stops: EXTENSION_STOP_LIMIT,
      minimumChromeVersion: CHROME_EXTENSION_MIN_VERSION,
    },
    prerequisites,
    recording: {
      available: false,
      reason:
        'A chrome-extension run has no application video; its pauses, values and frames are recorded in a history that codebook_explain_node_history saves after codebook_stop.',
    },
  }
}

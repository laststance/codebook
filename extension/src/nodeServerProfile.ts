import {
  ACTIVE_TIMEOUT_MS,
  NODE_SERVER_ACTION,
  NODE_SERVER_MINIMUM_EXTENSION_VERSION,
  NODE_SERVER_PROFILE,
  REPOSITORY_CONFIG_LIMIT_BYTES,
  REPOSITORY_INSPECTION_LIMIT,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
  REPOSITORY_RUN_TIMEOUT_MS,
  REPOSITORY_SETUP_TIMEOUT_MS,
  REPOSITORY_SOURCE_LIMIT_BYTES,
} from './constants'

/** What `codebook_status` says about the repository's own tsx: it depends on the declared entry, so it is checked at start, not here. */
export const NODE_SERVER_LOADER_NOTE =
  "The repository's own tsx is checked at start, for a TypeScript entry only; a missing or outside-the-repository tsx is refused with NODE_SERVER_SOURCE_REFUSED."

/**
 * Describes the node-server profile for `codebook_status`: its identity, its one action, its limits and its machine prerequisites, so an agent knows before a start whether the server form can run here and what is missing.
 * Called by {@link StudyService.status} with the environment's report.
 * @param prerequisites - Whether the profile can start here and each missing item, named (Node, a listener tool, `ps`, a supported platform, the owned adapter).
 * @returns The profile entry; its `prerequisites` carry the loader note beside `ready` and `missing`.
 * @example
 * describeNodeServerProfile({ ready: false, missing: ['node-server needs lsof or ss.'] }).prerequisites.ready // => false
 */
export function describeNodeServerProfile(prerequisites: {
  ready: boolean
  missing: string[]
}) {
  return {
    id: NODE_SERVER_PROFILE,
    title: 'Repository Node HTTP server request',
    description:
      "Run the repository's own Node HTTP server, send one declared request, and stop in the route-handler source with ordered native Node source stops.",
    requiresConfiguration: true,
    configurationVersions: [1],
    minimumExtensionVersion: NODE_SERVER_MINIMUM_EXTENSION_VERSION,
    helpUri: 'codebook://help/node-server',
    adapter: 'node-server',
    actions: [{ id: NODE_SERVER_ACTION, title: 'Send the declared request' }],
    items: [],
    expectations: [],
    requiredLinks: [],
    capturePhases: [],
    limits: {
      runTimeoutMs: REPOSITORY_RUN_TIMEOUT_MS,
      setupTimeoutMs: REPOSITORY_SETUP_TIMEOUT_MS,
      activeTimeoutMs: ACTIVE_TIMEOUT_MS,
      pauseHoldTimeoutMs: REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
      activeBudget: 'per-action',
      configurationBytes: REPOSITORY_CONFIG_LIMIT_BYTES,
      stops: 8,
      inspections: REPOSITORY_INSPECTION_LIMIT,
      sourceBytes: { typescript: REPOSITORY_SOURCE_LIMIT_BYTES },
    },
    prerequisites: {
      ...prerequisites,
      repositoryChecks: NODE_SERVER_LOADER_NOTE,
    },
    recording: {
      available: false,
      reason:
        'Server runs are not saved yet: no replay, no saved study, no application video.',
    },
  }
}

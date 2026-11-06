import {
  ACTIVE_TIMEOUT_MS,
  CONFIGURED_OBSERVATION_LIMIT,
  NODE_SCRIPT_MINIMUM_EXTENSION_VERSION,
  NODE_SCRIPT_PROFILE,
  NODE_SCRIPT_RUN_TIMEOUT_MS,
  REPOSITORY_CONFIG_LIMIT_BYTES,
  REPOSITORY_INSPECTION_LIMIT,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
  REPOSITORY_RUN_TIMEOUT_MS,
  REPOSITORY_SETUP_TIMEOUT_MS,
  REPOSITORY_SOURCE_LIMIT_BYTES,
} from './constants'
import type { RepositoryPackageManagerStatus } from './utils/describeRepositoryPackageManager'

/** What `codebook_status` says about the repository's own tsx: it depends on the declared entry, so it is checked at start, not here. */
const NODE_SCRIPT_LOADER_NOTE =
  "The repository's own tsx is checked at start, for a TypeScript entry only; a missing tsx, or one without a loader file inside the repository, is refused with NODE_SCRIPT_SOURCE_REFUSED (reason tsx-missing), and a tsx that resolves outside the repository with reason outside-package."

/**
 * Describes the node-script profile for `codebook_status`: its identity, its limits and its machine prerequisites, so an agent knows before a start whether a script run can happen here and what is missing.
 * Called by {@link StudyService.status} with the environment's report.
 * @param prerequisites - Whether the profile can start here and each missing item, named (Node, `ps`, a supported system, the owned adapter), and the repository's package manager (`repositoryPackageManager`: name, found and version, or `unknown`/`unsupported`/`missing` with its reason), which only a run with `library` needs.
 * @returns The profile entry; it has no action, because the script starts itself once the learner confirms.
 * @example
 * describeNodeScriptProfile({ ready: false, missing: ['node-script needs ps.'] }).prerequisites.ready // => false
 */
export function describeNodeScriptProfile(prerequisites: {
  ready: boolean
  missing: string[]
  repositoryPackageManager?: RepositoryPackageManagerStatus
}) {
  return {
    id: NODE_SCRIPT_PROFILE,
    title: 'Repository Node script run',
    description:
      "Run one of the repository's own Node scripts once after the learner confirms it, and stop in the script's own source with ordered native Node source stops.",
    requiresConfiguration: true,
    configurationVersions: [1],
    minimumExtensionVersion: NODE_SCRIPT_MINIMUM_EXTENSION_VERSION,
    helpUri: 'codebook://help/node-script',
    adapter: 'node-script',
    actions: [],
    items: [],
    expectations: [],
    requiredLinks: [],
    capturePhases: [],
    limits: {
      runTimeoutMs: REPOSITORY_RUN_TIMEOUT_MS,
      scriptRunningTimeoutMs: NODE_SCRIPT_RUN_TIMEOUT_MS,
      setupTimeoutMs: REPOSITORY_SETUP_TIMEOUT_MS,
      activeTimeoutMs: ACTIVE_TIMEOUT_MS,
      pauseHoldTimeoutMs: REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
      activeBudget: 'per-action',
      configurationBytes: REPOSITORY_CONFIG_LIMIT_BYTES,
      stops: CONFIGURED_OBSERVATION_LIMIT,
      inspections: REPOSITORY_INSPECTION_LIMIT,
      sourceBytes: { typescript: REPOSITORY_SOURCE_LIMIT_BYTES },
    },
    prerequisites: {
      ...prerequisites,
      repositoryChecks: NODE_SCRIPT_LOADER_NOTE,
    },
    recording: {
      available: false,
      reason:
        'A script run is saved as a Script replay by Save learning replay or codebook_explain_node_history (see codebook://help/node-script, section save); it has no application video.',
    },
  }
}

import {
  ACTIVE_TIMEOUT_MS,
  CONFIGURED_OBSERVATION_LIMIT,
  CROSS_RUNTIME_CAPTURE_PHASES,
  CONFIGURED_MINIMUM_EXTENSION_VERSION,
  REPOSITORY_BROWSER_ACTION,
  REPOSITORY_BROWSER_PROFILE,
  REPOSITORY_CHUNK_LIMIT_BYTES,
  REPOSITORY_CONFIG_LIMIT_BYTES,
  REPOSITORY_INSPECTION_LIMIT,
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
  REPOSITORY_MAP_LIMIT_BYTES,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
  REPOSITORY_RUN_TIMEOUT_MS,
  REPOSITORY_SETUP_TIMEOUT_MS,
  REPOSITORY_SOURCE_LIMIT_BYTES,
} from './constants'
import { sha256 } from './runtimeSupport/utils/sha256'

// Configured items/facts are supplied by the accepted article intent, never by fixture expectations.
const contract = {
  id: REPOSITORY_BROWSER_PROFILE,
  title: 'Repository application action',
  description:
    'One source-bound application action with ordered browser or server stops from an immutable article in the selected Git workspace.',
  requiresConfiguration: true,
  configurationVersions: [1, 2],
  minimumExtensionVersion: CONFIGURED_MINIMUM_EXTENSION_VERSION,
  helpUri: 'codebook://help/repository-browser',
  adapter: 'next-dev-webpack',
  actions: [
    { id: REPOSITORY_BROWSER_ACTION, title: 'Perform configured action' },
  ],
  items: [],
  expectations: [],
  requiredLinks: [],
  capturePhases: CROSS_RUNTIME_CAPTURE_PHASES,
  limits: {
    runTimeoutMs: REPOSITORY_RUN_TIMEOUT_MS,
    setupTimeoutMs: REPOSITORY_SETUP_TIMEOUT_MS,
    activeTimeoutMs: ACTIVE_TIMEOUT_MS,
    pauseHoldTimeoutMs: REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
    activeBudget: 'per-action',
    configurationBytes: REPOSITORY_CONFIG_LIMIT_BYTES,
    stops: CONFIGURED_OBSERVATION_LIMIT,
    inspections: REPOSITORY_INSPECTION_LIMIT,
    sourceBytes: {
      typescript: REPOSITORY_SOURCE_LIMIT_BYTES,
      javascript: REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
      map: REPOSITORY_MAP_LIMIT_BYTES,
    },
    buildChunkBytes: REPOSITORY_CHUNK_LIMIT_BYTES,
  },
  scope:
    'Installed Next webpack development runtime, an explicit same-origin entry path (default /), optional prepared text controls, default .next/dev output, retained original source maps. One unique visible enabled target, one click, up to eight ordered verified browser/server pauses, each bound to its retained source citation, actual declared values and verified after conditions. No arbitrary launch commands, ports, roots, debugger expressions, expected runtime values or inferred server links. Version 1 retains same-citation browser stops; version 2 uses the owned Next worker for server-action stops. Native host compatibility requires installed validation.',
}
export const CONFIGURED_PROFILE = {
  ...contract,
  catalogHash: sha256(JSON.stringify(contract)),
}

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
  // Every adapter a configuration may name; `adapter` stays the Next default for older readers.
  adapters: ['next-dev-webpack', 'vite-dev'],
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
    "Two development runtimes, chosen by the configuration adapter. next-dev-webpack: installed Next webpack development runtime, default .next/dev output, retained original source maps; version 1 retains same-citation browser stops, version 2 takes browser stops and uses the owned Next worker for server-action stops. vite-dev (Vite 8, since API 1.11): the repository's own Vite development server started by Codebook on a loopback port, served modules sealed against their inline source maps, browser stops only (no SSR, no server participant). Both: an explicit same-origin entry path (default /), optional prepared text controls, one unique visible enabled target, one click, up to eight ordered verified pauses, each bound to its retained source citation, actual declared values and verified after conditions. No arbitrary launch commands, ports, roots, debugger expressions, expected runtime values or inferred server links. Native host compatibility requires installed validation.",
}
export const CONFIGURED_PROFILE = {
  ...contract,
  catalogHash: sha256(JSON.stringify(contract)),
}

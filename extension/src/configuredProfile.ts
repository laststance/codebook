import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { ACTIVE_TIMEOUT_MS, CONFIGURED_CAPTURE_PHASES, CONFIGURED_MINIMUM_EXTENSION_VERSION, REPOSITORY_BROWSER_ACTION, REPOSITORY_BROWSER_PROFILE, REPOSITORY_CONFIG_LIMIT_BYTES, REPOSITORY_INSPECTION_LIMIT, REPOSITORY_JAVASCRIPT_LIMIT_BYTES, REPOSITORY_MAP_LIMIT_BYTES, REPOSITORY_PAUSE_HOLD_TIMEOUT_MS, REPOSITORY_RUN_TIMEOUT_MS, REPOSITORY_SETUP_TIMEOUT_MS, REPOSITORY_SOURCE_LIMIT_BYTES } from './constants';

// Configured items/facts are supplied by the accepted article intent, never by fixture expectations.
const contract = { id: REPOSITORY_BROWSER_PROFILE, title: 'Repository browser action', description: 'One source-bound browser action from an immutable article in the selected Git workspace.',
  requiresConfiguration: true, minimumExtensionVersion: CONFIGURED_MINIMUM_EXTENSION_VERSION, helpUri: 'codebook://help/repository-browser', adapter: 'next-dev-webpack',
  actions: [{ id: REPOSITORY_BROWSER_ACTION, title: 'Perform configured action' }], items: [], expectations: [], requiredLinks: [], capturePhases: CONFIGURED_CAPTURE_PHASES,
  limits: { runTimeoutMs: REPOSITORY_RUN_TIMEOUT_MS, setupTimeoutMs: REPOSITORY_SETUP_TIMEOUT_MS, activeTimeoutMs: ACTIVE_TIMEOUT_MS, pauseHoldTimeoutMs: REPOSITORY_PAUSE_HOLD_TIMEOUT_MS, activeBudget: 'per-action', configurationBytes: REPOSITORY_CONFIG_LIMIT_BYTES, inspections: REPOSITORY_INSPECTION_LIMIT,
    sourceBytes: { typescript: REPOSITORY_SOURCE_LIMIT_BYTES, javascript: REPOSITORY_JAVASCRIPT_LIMIT_BYTES, map: REPOSITORY_MAP_LIMIT_BYTES } },
  scope: 'Installed Next webpack development runtime, root route /, default .next/dev output, retained original source maps. One unique visible enabled target, one click, one verified browser pause, actual declared values and verified after conditions. No arbitrary launch commands, ports, roots, debugger expressions, expected runtime values or server links.' };
export const CONFIGURED_PROFILE = { ...contract, catalogHash: sha256(JSON.stringify(contract)) };

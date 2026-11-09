import {
  ACTIVE_TIMEOUT_MS,
  CONFIGURED_OBSERVATION_LIMIT,
  CROSS_RUNTIME_CAPTURE_PHASES,
  CONFIGURED_MINIMUM_EXTENSION_VERSION,
  OPERATIONS_REPOSITORY_BROWSER_ADAPTERS,
  REPOSITORY_BROWSER_ACTION,
  REPOSITORY_BROWSER_PROFILE,
  REPOSITORY_OPERATION_ACTION,
  REPOSITORY_OPERATION_LIMIT,
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
  configurationVersions: [1, 2, 3],
  minimumExtensionVersion: CONFIGURED_MINIMUM_EXTENSION_VERSION,
  helpUri: 'codebook://help/repository-browser',
  adapter: 'next-dev-webpack',
  // Every adapter a configuration may name; `adapter` stays the Next default for older readers.
  adapters: [...OPERATIONS_REPOSITORY_BROWSER_ADAPTERS],
  // The Next routers next-dev-webpack serves; an agent that remembers another list re-reads the help.
  nextRouters: ['app', 'pages'],
  actions: [
    { id: REPOSITORY_BROWSER_ACTION, title: 'Perform configured action' },
    {
      id: REPOSITORY_OPERATION_ACTION,
      title: 'Send the next declared operation',
    },
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
    operations: REPOSITORY_OPERATION_LIMIT,
    inspections: REPOSITORY_INSPECTION_LIMIT,
    sourceBytes: {
      typescript: REPOSITORY_SOURCE_LIMIT_BYTES,
      javascript: REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
      map: REPOSITORY_MAP_LIMIT_BYTES,
    },
    buildChunkBytes: REPOSITORY_CHUNK_LIMIT_BYTES,
  },
  scope:
    "Five development runtimes, chosen by the configuration adapter. next-dev-webpack: installed Next webpack development runtime, default .next/dev output, retained original source maps, serving App Router and Pages Router pages; version 1 retains same-citation browser stops, version 2 takes browser stops and uses the owned Next worker for server-action stops; a Pages Router page takes browser stops, and, in version 3 since API 1.17, server stops in its getServerSideProps or getStaticProps and the code they call. vite-dev (Vite 8, since API 1.11): the repository's own Vite development server started by Codebook on a loopback port, served modules sealed against their inline source maps, browser stops only (no SSR, no server participant). react-scripts-dev (react-scripts 4 or 5, since API 1.25; react-scripts 4 since API 1.41): the app's own react-scripts start run by Codebook on a loopback port in a version 3 configuration, the app ready after its first compile, served bundle and source map sealed against the checked-out file, browser stops only (no server participant). expo-web-dev (Expo SDK 57, since API 1.30): the app's own expo start --web run by Codebook on the port its web script declares in a version 3 configuration, the app ready when Metro has served its entry bundle and source map, served bundle and source map sealed against the checked-out file, browser stops only (no server participant, no Expo Router API route); an expo-web-dev run reads a served entry bundle of up to 32 MiB and its source map of up to 64 MiB, instead of the 8 MiB and 16 MiB of sourceBytes.javascript and sourceBytes.map that bound the other adapters. static-page (since API 1.42): a plain HTML page served as written by Codebook's own loopback static server on a port the operating system picks, in a version 3 configuration (packageRoot absent, '.' or a nested folder); the page is ready when its entry page answers HTML and every same-origin script answers JavaScript, a page whose scripts or stylesheets need a bundler is refused as needs-bundler, and a browser stop in the page's inline script or a same-origin .js file is sealed against the served bytes (browser stops only, no server participant); a version 3 static-page configuration may declare library to serve the packed checked-out build in place of the page's unpkg or jsDelivr import of that package. All: an explicit same-origin entry path (default /), then either (versions 1 and 2) optional prepared text controls, one unique visible enabled target and one click, or (version 3, since API 1.14) up to eight ordered operations (text, choose an option of a native select, click), each sent by its own repository-operation action, and, in all, up to eight ordered verified pauses (in version 3 each declared after an operation), each bound to its retained source citation, actual declared values and verified after conditions. No arbitrary launch commands, ports, debugger expressions, expected runtime values or inferred server links. A Next app below the repository root (since API 1.18) runs from the repository root in a version 3 configuration that declares packageRoot, the app's repository-relative folder; codebook_status lists such apps under the next-dev-webpack readiness packages. A Vite app below the repository root (since API 1.20) runs the same way with vite-dev in a version 3 configuration that declares its packageRoot; codebook_status lists such apps under the vite-dev readiness packages; a react-scripts app at or below the root is chosen from the react-scripts-dev readiness the same way. Since API 1.21 a browser stop in such a Vite run may lie in a workspace library the app imports; Codebook never builds the library. Native host compatibility requires installed validation.",
}
export const CONFIGURED_PROFILE = {
  ...contract,
  catalogHash: sha256(JSON.stringify(contract)),
}

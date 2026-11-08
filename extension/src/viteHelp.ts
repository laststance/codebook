import { apiServerHelp } from './apiServerHelp'
import {
  LIBRARY_BUILD_FAILED_REASONS,
  LIBRARY_BUILD_TIMEOUT_MS,
  LIBRARY_PACK_ERROR_STEPS,
  MILLISECONDS_PER_SECOND,
  NEXT_PACKAGE_DISCOVERY_APP_LIMIT,
  NEXT_PACKAGE_DISCOVERY_MANIFEST_LIMIT,
  NEXT_PACKAGE_DISCOVERY_MAX_DEPTH,
  NODE_SCRIPT_LIBRARY_UNSUPPORTED_REASONS,
  REPOSITORY_GIT_TIMEOUT_MS,
  REPOSITORY_SETUP_TIMEOUT_MS,
  VITE_API_SERVER_MINIMUM_API,
  VITE_API_SERVER_STUDY_VERSION,
  VITE_APP_SELECTION_RULE,
  VITE_LIBRARY_MINIMUM_API,
  VITE_LIBRARY_STOP_MINIMUM_API,
  VITE_LIBRARY_STUDY_VERSION,
  VITE_LIBRARY_UNSUPPORTED_REASONS,
  VITE_PACKAGE_ROOT_MINIMUM_API,
  VITE_PACKAGE_ROOT_MINIMUM_EXTENSION,
  VITE_STOP_EXTENSIONS,
  VITE_SUPPORTED_MAJOR,
} from './constants'
import {
  LIBRARY_STOP_REASONS,
  PACKAGE_ROOT_REFUSALS,
  packageRootAnchor,
} from './nextHelp'
import {
  VITE_REFUSAL_CODES,
  viteHelpAnchor,
  viteRecoveryOf,
} from './viteRefusals'

/**
 * A minimal valid `vite-dev` configuration, generic on purpose: every identity and hash is a placeholder the agent replaces with the value the step named in {@link VITE_QUICK_START_COPY_FROM} returned.
 * The help serves it as `quickStart.configuration`, and a test parses it with the public schema so it cannot drift from the schema.
 */
export const VITE_QUICK_START_CONFIGURATION = {
  version: 1,
  adapter: 'vite-dev',
  book: {
    bookId: 'my-article',
    revision: 1,
    nodeId: 'my-node',
    anchorIndex: 0,
  },
  source: {
    path: 'src/example/handler.ts',
    hash: '0000000000000000000000000000000000000000000000000000000000000000',
    line: 12,
    column: 3,
  },
  action: {
    title: 'Click the button',
    selector: '[data-testid="example-button"]',
    before: [{ kind: 'visible', selector: '[data-testid="example-button"]' }],
    after: [
      {
        kind: 'text',
        selector: '[data-testid="example-result"]',
        equals: 'Done',
      },
    ],
  },
  inspections: [{ path: 'value', mode: 'value', required: true }],
} as const

/**
 * A complete version 3 configuration for a browser stop in a Vite app below the repository root, reached by one declared click: the app's folder is `packageRoot`, and `source.path` is repository-relative (it starts with that folder).
 * Served as `vitePackageRoot.configurationNested` and parsed by a test with {@link liveRepositoryConfigSchema}. Every value is a neutral placeholder, not any project's folder or file: the agent replaces the folder with the `packageRoot` value of the `packages` entry the question is about, the book identity and the hash with the values the earlier steps returned.
 */
export const VITE_NESTED_CONFIGURATION = {
  version: 3,
  adapter: 'vite-dev',
  packageRoot: 'apps/my-app',
  book: {
    bookId: 'my-article',
    revision: 1,
    nodeId: 'my-node',
    anchorIndex: 0,
  },
  source: {
    path: 'apps/my-app/src/components/Counter.tsx',
    hash: '0000000000000000000000000000000000000000000000000000000000000000',
    line: 14,
    column: 5,
  },
  participant: 'browser',
  afterOperation: 1,
  entryPath: '/',
  before: [{ kind: 'visible', selector: '[data-testid="count-button"]' }],
  after: [
    {
      kind: 'text',
      selector: '[data-testid="count-value"]',
      equals: '1',
    },
  ],
  operations: [
    {
      kind: 'click',
      title: 'Click the counter button',
      selector: '[data-testid="count-button"]',
    },
  ],
  inspections: [{ path: 'count', mode: 'value', required: true }],
} as const

/** The server stop shared by both `apiServer` examples: a statement in the handler the page's request reaches, inside the API folder, armed after operation 1. */
const VITE_API_SERVER_STOP = {
  participant: 'server',
  source: {
    path: 'server/routes/items.ts',
    hash: '0000000000000000000000000000000000000000000000000000000000000000',
    line: 18,
    column: 5,
  },
  anchorIndex: 0,
  inspections: [{ path: 'itemId', mode: 'value', required: true }],
  afterOperation: 1,
} as const

/**
 * A complete version 3 `vite-dev` configuration that also runs the app's own Node API, for an app at the repository root with the API in a subfolder: one browser stop in the app, one server stop inside `apiServer.packageRoot`, `proxyPaths` for a page that calls the API through the dev server's own origin, and `session: "fresh"` because a root run opens the saved session when one exists.
 * Served as `viteApiServer.configuration` and parsed by a test with {@link liveRepositoryConfigSchema}. Every value is a neutral placeholder, not any project's folder, file or port: replace the API folder, entry, port and prefix with what the repository's own files say, the stops with statements the page's request reaches, and the book identity and the hash with the values the earlier steps returned.
 */
const VITE_API_SERVER_CONFIGURATION = {
  ...VITE_NESTED_CONFIGURATION,
  // A root app declares no packageRoot.
  packageRoot: undefined,
  session: 'fresh',
  apiServer: {
    packageRoot: 'server',
    entry: 'index.ts',
    loader: 'tsx',
    port: 8787,
    proxyPaths: ['/api'],
  },
  source: {
    ...VITE_NESTED_CONFIGURATION.source,
    path: 'src/components/Counter.tsx',
  },
  additionalStops: [VITE_API_SERVER_STOP],
} as const

/**
 * The nested form of {@link VITE_API_SERVER_CONFIGURATION}: the app lives in `packageRoot` and its API folder lies beside it. A nested run opens a fresh profile already, so it needs no `session` field.
 * Served as `viteApiServer.configurationNested` and parsed by a test with {@link liveRepositoryConfigSchema}; every value is a placeholder.
 */
const VITE_API_SERVER_NESTED_CONFIGURATION = {
  ...VITE_NESTED_CONFIGURATION,
  apiServer: {
    packageRoot: 'apps/my-api',
    entry: 'index.ts',
    loader: 'tsx',
    port: 8787,
    proxyPaths: ['/api'],
  },
  additionalStops: [
    {
      ...VITE_API_SERVER_STOP,
      source: {
        ...VITE_API_SERVER_STOP.source,
        path: 'apps/my-api/routes/items.ts',
      },
    },
  ],
} as const

/**
 * A complete version 3 configuration for a browser stop in a Vite Example below the repository root that runs on the repository's own library: the Example's folder is `packageRoot`, the library package's folder is `library.packageRoot`, and `source.path` is repository-relative and lies in the Example.
 * Served as `viteLibrary.sample` and parsed by a test with {@link liveRepositoryConfigSchema}. Every value is a neutral placeholder, not any project's folder or file: replace the folders with the Example and the library package the question is about, the book identity and the hash with the values the earlier steps returned.
 */
export const VITE_LIBRARY_CONFIGURATION = {
  version: 3,
  adapter: 'vite-dev',
  packageRoot: 'examples/widgets-vite',
  library: { packageRoot: 'packages/widgets' },
  book: {
    bookId: 'my-article',
    revision: 1,
    nodeId: 'my-node',
    anchorIndex: 0,
  },
  source: {
    path: 'examples/widgets-vite/src/features/counter/counter.ts',
    hash: '0000000000000000000000000000000000000000000000000000000000000000',
    line: 20,
    column: 5,
  },
  participant: 'browser',
  afterOperation: 1,
  entryPath: '/',
  before: [{ kind: 'visible', selector: '[data-testid="add-button"]' }],
  after: [
    {
      kind: 'text',
      selector: '[data-testid="total-value"]',
      equals: '1',
    },
  ],
  operations: [
    {
      kind: 'click',
      title: 'Click the add button',
      selector: '[data-testid="add-button"]',
    },
  ],
  inspections: [{ path: 'total', mode: 'value', required: true }],
} as const

/**
 * The refusals of a `vite-dev` library run, keyed by `details.reason`: the three reasons that are new with API 1.34. The reasons the route shares with the `node-script` library route keep their rows in `codebook://help/node-script`.
 * Why it exists: one anchor per reason lets a chat that meets a refusal read its fix without the long sections; {@link viteLibraryHelp} serves the rows in this record's order.
 */
const VITE_LIBRARY_REFUSALS = {
  'library-needs-package-root': {
    code: 'INVALID_CONFIGURATION',
    meaning:
      'library was declared without a nested packageRoot (absent or "."): the library route redirects an Example below the repository root. details.field is configuration.library. Nothing started (details.sideEffects none).',
    fix: "Declare the Example's folder as packageRoot (the folder that holds its package.json) next to library, or drop library to run the Example on its installed copy.",
  },
  'library-optimize-include': {
    code: 'LIBRARY_BUILD_UNSUPPORTED',
    meaning:
      'The Vite config named in details.configFile lists the library package, or a subpath of it, in optimizeDeps.include: Vite would pre-bundle the installed copy and the packed build would never be served. Found in the resolved config before the build: nothing was built or started (details.sideEffects none).',
    fix: "Ask the learner to remove that entry from optimizeDeps.include in the config file details.configFile names, or start again without library. Never edit the learner's config yourself.",
  },
  'library-aliased': {
    code: 'LIBRARY_BUILD_UNSUPPORTED',
    meaning:
      "The Vite config named in details.configFile has a resolve.alias (a string or a regular expression) that matches the library package or a subpath of it: the Example's imports would bypass the packed build. Found in the resolved config before the build: nothing was built or started (details.sideEffects none).",
    fix: 'Ask the learner to remove that alias from the config file details.configFile names, or start again without library.',
  },
  'library-dedupe': {
    code: 'LIBRARY_BUILD_UNSUPPORTED',
    meaning:
      'The Vite config named in details.configFile lists the library package, or a subpath of it, in resolve.dedupe (or in environments.client.resolve.dedupe): Vite resolves a deduped package from the project root whatever the importer, so the page would get the installed copy and not the packed build. Found in the resolved config before the build: nothing was built or started (details.sideEffects none). Other packages in resolve.dedupe are fine.',
    fix: "Ask the learner to remove the library package from resolve.dedupe in the config file details.configFile names, or start again without library. Never edit the learner's config yourself.",
  },
} as const

/**
 * The refusals of a `packageRoot` run of a Vite app, keyed by `details.reason`: the five reasons the Next app shares (same code, same fix), then the Vite-only `not-a-vite-app` and `outside-package` (under `VITE_SEAL_FAILED`).
 * Reuses {@link PACKAGE_ROOT_REFUSALS} for the shared rows so the two adapters cannot drift; the anchor of a reason is `codebook://help/repository-browser#<reason>` for both adapters.
 */
const VITE_PACKAGE_ROOT_REFUSALS = {
  'outside-repository': PACKAGE_ROOT_REFUSALS['outside-repository'],
  'link-leaves-repository': PACKAGE_ROOT_REFUSALS['link-leaves-repository'],
  'not-a-folder': PACKAGE_ROOT_REFUSALS['not-a-folder'],
  missing: PACKAGE_ROOT_REFUSALS.missing,
  unreadable: PACKAGE_ROOT_REFUSALS.unreadable,
  'not-a-vite-app': {
    code: 'INVALID_CONFIGURATION',
    meaning:
      'The folder has no package.json that declares vite in dependencies or devDependencies, or it declares vite but holds no index.html and has no dev script Codebook accepts (a library package that only uses a vite.config for its tests is not an app).',
    fix: 'Declare the folder whose package.json declares vite and runs the app (a packages entry of the vite-dev readiness), or tell the learner this folder is not a Vite app. Nothing started.',
  },
  'outside-package': {
    code: 'VITE_SEAL_FAILED',
    meaning:
      'A stop file lies outside packageRoot (a shared package the app imports, for example); details.files lists every such stop and details.packageRoot the app folder. Refused before the server starts: nothing ran (details.sideEffects none). The anchor is shared with the Next app, whose code for this reason is NEXT_STOP_NOT_SEALED.',
    fix: 'Declare stops only in files inside details.packageRoot or in a workspace library the app imports through links inside the repository (API 1.21 or later; see libraryStops), or tell the learner that code outside the app folder cannot be observed in this version: this refusal means no workspace library the app reaches holds the stop file. Do not start another run with the same stops.',
  },
  'source-drift': {
    code: 'VITE_SEAL_FAILED',
    meaning:
      'The API ran a different version of the stop file than the stop declares (details.participant: apiServer, details.file): the source its inline map carries is not the declared file, usually because the file changed after the book cited it or a stale build ran. The anchor is shared with the Expo app, whose code for this reason is EXPO_WEB_SEAL_FAILED. The API and the app were stopped (details.sideEffects: partial).',
    fix: 'Read the current file with codebook_source, publish the book again from it and declare the stop again; never edit the project. Then one new start.',
  },
  'source-unverifiable': {
    code: 'VITE_SEAL_FAILED',
    meaning:
      "No inline source map with the contents of the stop file ties the API's executed script to the declared source (details.participant: apiServer, details.file): a prebuilt entry (dist), an external map, relative sources, a sourceRoot map or no map. The anchor is shared with the Expo app, whose code for this reason is EXPO_WEB_SEAL_FAILED. The API and the app were stopped (details.sideEffects: partial).",
    fix: "Declare apiServer.entry as the TypeScript source the package's own dev script runs through tsx; if the package has no such script, tell the learner this API cannot be observed in this version, and never edit the project or build it yourself. Then one new start.",
  },
  'api-port-conflict': {
    code: 'VITE_UNSUPPORTED',
    meaning:
      'apiServer.port equals the port Vite serves the app on (details.apiPort, details.vitePort, details.portSource: dev-script, config or vite-default). A dev script port is found before anything starts (details.sideEffects: none); a config or default port is found after the API started, which was then stopped, and no input was sent (details.sideEffects: partial). The anchor is shared with the Expo app, whose code for this reason is EXPO_WEB_UNSUPPORTED.',
    fix: "Declare the port the API's own code listens on (read it from the API's source, never guess), or tell the learner the API and the app cannot share a port; never edit the project or its scripts.",
  },
} as const

/** What a refused library stop under `vite-dev` says about side effects: the owned Vite server started, but no browser opened and no page or app code ran. */
const VITE_LIBRARY_SIDE_EFFECTS_SENTENCE =
  'details.sideEffects is none: refused before the browser opened (no browser opened, no page or app code ran, no learner file or build output was written by Codebook; the owned Vite server started and may have written its own dependency cache).'

/**
 * The library-stop rows that differ from the Next app's, keyed by reason: the code, the cause list and the side effects are Vite's own, while the anchor and the fix of a reason the two adapters share come from {@link PACKAGE_ROOT_REFUSALS}.
 * `library-place-ambiguous` is absent on purpose: the placement rule of an app stop always returns a position under `vite-dev`, so the reason does not occur.
 */
const VITE_LIBRARY_ROWS: Record<
  Exclude<(typeof LIBRARY_STOP_REASONS)[number], 'library-place-ambiguous'>,
  { code: string; meaning: string; fix: string }
> = {
  'library-build-stale': {
    code: 'VITE_SEAL_FAILED',
    meaning: `A browser stop lies in the checked-out source of a workspace library the app imports, and the source map of the library module Vite serves carries source text that differs from the checked-out file: the library was edited after it was built. ${VITE_LIBRARY_SIDE_EFFECTS_SENTENCE}`,
    fix: PACKAGE_ROOT_REFUSALS['library-build-stale'].fix,
  },
  'library-build-unmapped': {
    code: 'VITE_SEAL_FAILED',
    meaning: `A browser stop lies in the checked-out source of a workspace library the app imports, but no module Vite serves can be tied to that file; details.cause says why: no-map (no served library module has a source map that names the file), malformed (a served map cannot be parsed), no-content (a map names the file without its source text), no-line (no mapping lies on the stop's line or within its citation after it), prebundled (Vite serves the library as an optimized dependency, so the served chunk is not the library's built file), bound (the search for the library modules the page reaches hit its module or byte limit) or deadline (the search ran out of time). ${VITE_LIBRARY_SIDE_EFFECTS_SENTENCE} A further cause, lazy-import, is raised during the run, before the operation is sent: the operation itself loads the library module lazily, so the module is not yet parsed in the page when the stop is armed, and the operation was not sent; details.sideEffects is then unknown, because the browser had opened and the entry page's code had run.`,
    fix: "Tell the learner the cause. For no-map, no-content and malformed the learner can rebuild the library with source maps that include the source text (sourcesContent); for no-line declare the stop on a line that runs; for prebundled explain that the app serves the library pre-bundled, so a library stop cannot run, and offer a stop in the app's own files (an Example-side stop) instead; for lazy-import choose a stop in a module the page has already loaded before the operation, or a stop in the app; for bound and deadline this version cannot search the page, so a rebuild does not help. Codebook never builds and you never run the build. Do not retry with the same stop.",
  },
  'library-not-in-build': {
    code: 'VITE_SEAL_FAILED',
    meaning: `Not exactly one module Vite serves for the page maps the stop file and its line: none of the modules the entry page reaches under the library's folder does, or more than one does (another build, such as a legacy build, may be the one the page loads); details.candidates lists the module URLs, and is empty when the page reaches no module under the library's folder. ${VITE_LIBRARY_SIDE_EFFECTS_SENTENCE}`,
    fix: "Tell the learner the page does not load that library file (or loads it from more than one build), or choose a stop on a line the page's code runs. Do not start another run with the same stop.",
  },
  'library-build-changed': {
    code: 'RUNTIME_FAILED',
    meaning:
      'During the run, the library module the browser executed differs from the bytes Codebook sealed, when the stop was armed or when the run paused (a hot update that replaced the module counts, and so does a library rebuilt while the run was open). details.sideEffects is unknown: the browser had been opened and the app code had run.',
    fix: PACKAGE_ROOT_REFUSALS['library-build-changed'].fix,
  },
}

/**
 * Builds the refusal rows of a browser stop in a workspace library under `vite-dev`, one per reason of the shared {@link LIBRARY_STOP_REASONS} that occurs for Vite.
 *
 * Why it exists: the Next and Vite help list the same library reasons with the same anchors, so the reason list is shared and a reason cannot be added to one adapter without choosing its Vite row. Called by {@link vitePackageRoot}.
 *
 * @returns The rows keyed by reason, each with its anchor (`codebook://help/repository-browser#<reason>`), code, meaning and fix.
 * @example
 * viteLibraryRefusals()['library-build-stale'].anchor // => 'codebook://help/repository-browser#library-build-stale'
 */
function viteLibraryRefusals() {
  return Object.fromEntries(
    LIBRARY_STOP_REASONS.flatMap((reason) =>
      // library-place-ambiguous never occurs under vite-dev (a vite-dev run declares at most one library, so its place is never ambiguous); every other reason must have a row, which the table's key type enforces
      reason === 'library-place-ambiguous'
        ? []
        : [
            [
              reason,
              {
                anchor: packageRootAnchor(reason),
                ...VITE_LIBRARY_ROWS[reason],
              },
            ] as const,
          ],
    ),
  )
}

/**
 * Builds the `vitePackageRoot` key of `codebook://help/repository-browser`: how to run a Vite app that lives below the repository root (API 1.20).
 *
 * Why it exists: before API 1.20 a Vite app below the repository root could not run, and a chat that meets one (a library's `examples/` folder, a monorepo) needs the selection rule, the exact configuration shape, the refusal fixes and the limits before it reads the long sections. Called by {@link viteHelp}, which serves its result as one key.
 *
 * @returns The section: selection rule, status fields, one complete version 3 example, the refusal-to-fix table (one anchor per `details.reason`), the saved-session rule, the study-format note and the limits.
 * @example
 * vitePackageRoot().refusals['not-a-vite-app'].anchor // => 'codebook://help/repository-browser#not-a-vite-app'
 */
function vitePackageRoot() {
  return {
    anchor: packageRootAnchor('vite-package-root'),
    minimumApi: VITE_PACKAGE_ROOT_MINIMUM_API,
    minimumExtension: VITE_PACKAGE_ROOT_MINIMUM_EXTENSION,
    summary: `A Vite app below the repository root runs with a declared packageRoot; a server stop in the app's own Node API needs apiServer (API ${VITE_API_SERVER_MINIMUM_API}), which viteApiServer explains.`,
    selectionRule: VITE_APP_SELECTION_RULE,
    versionCheck: `packageRoot under vite-dev exists only in configuration version 3 and only when codebook_status reports API ${VITE_PACKAGE_ROOT_MINIMUM_API} or later (Codebook ${VITE_PACKAGE_ROOT_MINIMUM_EXTENSION}; compare the number after the dot as a whole number). A version 1 or 2 configuration with packageRoot is refused. On an older API, or when a start refuses packageRoot as an unknown key, tell the learner to update Codebook and do not run the app by another route.`,
    openFrom:
      "Open the repository root, never the app's folder: with a folder below the repository root open, source authoring is refused with PREREQUISITE_MISSING and the message names the packageRoot to declare once the learner has opened the root.",
    status: {
      rootIsApp:
        'vite-dev readiness: true when the root package.json declares vite and the root holds an index.html or a dev script Codebook accepts. Only then is the root a candidate; the root ready keeps its meaning.',
      packages: `Array of the Vite apps below the root that tracked package.json files declare (depth ${NEXT_PACKAGE_DISCOVERY_MAX_DEPTH} or less, at most ${NEXT_PACKAGE_DISCOVERY_APP_LIMIT}): { packageRoot, installed, ready, version?, missing[] }. packageRoot is the exact value to declare; ready and missing are what a start with that packageRoot checks (the dev script form, the Vite installation, Vite's engines.node). Untracked apps are not listed.`,
      packagesTruncated: `true when the list is incomplete; packagesTruncatedReason says why: limit (more than ${NEXT_PACKAGE_DISCOVERY_APP_LIMIT} apps), manifest-cap (more than ${NEXT_PACKAGE_DISCOVERY_MANIFEST_LIMIT} manifests), deadline (the ${REPOSITORY_GIT_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s discovery bound), skipped-path (a path was skipped) or git-failed.`,
      whenTruncated: `When packagesTruncated is true and the app the question names is not in packages, declare its repository-relative packageRoot from the repository's files (the folder that holds its package.json); the start checks it and, if it is not an app, refuses with the reason and suggestions.`,
    },
    configurationNested: VITE_NESTED_CONFIGURATION,
    example:
      'configurationNested: a browser stop in a component of a Vite app whose folder is packageRoot, reached by one declared click (a browser stop declares afterOperation from 1). source.path stays repository-relative and starts with packageRoot; entryPath is the page the app serves. The folder, file, line, selectors and inspection are placeholders: replace them, the book and the hash with the app the question is about.',
    libraryStops: {
      anchor: packageRootAnchor('vite-library-stops'),
      minimumApi: VITE_LIBRARY_STOP_MINIMUM_API,
      rule: 'In a version 3 vite-dev run with a packageRoot other than ".", a browser stop (participant browser) may lie in the checked-out source of a workspace library the app reaches through links inside the repository (directly or through other workspace libraries), for example packages/<library>/src/…; a stop outside the root of a root run (packageRoot absent or ".") stays refused as outside-package. Codebook never builds the library and you never run its build: the learner builds it, with source maps that include sourcesContent. Codebook asks its own Vite server which library modules the entry page reaches, keeps the one served module (/@fs/…) whose source map names the stop file and maps the line, seals it and pauses there; the native debugger shows the library line and values. The run is saved as study format 10 with no new field, and the replay shows the library line. When the library is refused, follow the fix of the refusal\'s details.reason in refusals (one anchor per reason); do not retry with the same stop.',
      reasons: Object.keys(viteLibraryRefusals()),
    },
    refusals: {
      ...Object.fromEntries(
        Object.entries(VITE_PACKAGE_ROOT_REFUSALS).map(([reason, entry]) => [
          reason,
          { anchor: packageRootAnchor(reason), ...entry },
        ]),
      ),
      ...viteLibraryRefusals(),
    },
    savedSession:
      'A Vite run with packageRoot other than "." starts with a fresh browser profile and never loads the repository\'s saved sign-in session; the run resource reports savedSessionSkipped "package-root".',
    studies:
      "A nested Vite run is saved as study format 10 (.study.v10.json) with packageRoot in its configuration; recorded sources and book citations stay repository-relative. A root Vite run keeps the format it takes today. Codebook 0.2.77.0 lists a format 10 study as saved by a newer Codebook; update Codebook to open it. Format 10 replays from recorded evidence, also after the app's folder is removed.",
    limits: [
      "Codebook starts the app's own Vite from its folder and reads its dev script without running it (the same dev script forms as a root app). Vite resolves as Node would from the app's folder: the first node_modules/vite from packageRoot up to the repository root, never above it, whose real path is inside the repository (a pnpm link and a hoisted install inside the repository qualify; Yarn PnP and NODE_PATH count as not installed).",
      `Stops must lie in the app's own files or, since API 1.21, in the checked-out source of a workspace library the app reaches through links inside the repository (see libraryStops); a stop in any other file outside the app is refused with VITE_SEAL_FAILED (outside-package). Browser stops only, and server stops inside the API folder of a declared apiServer (API ${VITE_API_SERVER_MINIMUM_API}, see viteApiServer).`,
      "The app's own environment files are read and their values are masked, as for a root app. A Vite config temp file left in the app's own node_modules/.vite-temp or beside its config is removed; one in a shared ancestor node_modules/.vite-temp is never touched.",
      'One run at a time per window: a root run beside a nested run is refused with BUSY.',
    ],
  }
}

/**
 * Builds the `viteLibrary` key of `codebook://help/repository-browser`: when to declare `library.packageRoot` under `vite-dev`, what the build and pack run and write, the observation states, the refusals with their recovery, the limits, the study format and one complete sample with generic names.
 *
 * Why it exists: a Vite Example inside a library repository usually installs the library by a published version, so the Example runs a different release than the source the learner reads; a chat needs the route, its disclosure and its limits before it declares a run. Mirrors the `library` section of `codebook://help/node-script` so a chat reads one vocabulary for both runtimes. Called by {@link viteHelp}; it names no repository and copies no project's answer or stop lines.
 *
 * @returns The JSON-serializable section.
 * @example
 * viteLibraryHelp().sample.library.packageRoot // => 'packages/widgets'
 */
function viteLibraryHelp() {
  return {
    anchor: packageRootAnchor('viteLibrary'),
    requires: `codebook_status reports API ${VITE_LIBRARY_MINIMUM_API} or later (compare the number after the dot as a whole number). An older Codebook refuses library under vite-dev as an unknown key: tell the learner to update Codebook and do not run the Example by another route.`,
    whenToUse:
      "The Vite Example lives below the root of a library repository and its package.json depends on that library by a published version, so its own node_modules holds an installed copy, not the checked-out source. Declare library.packageRoot (the library package's folder, relative to the repository root; never the Example's own folder or a folder inside it) together with the Example's nested packageRoot, and the Example runs on the checked-out library. Without library the Example runs the installed copy: say so to the learner and never call that copy the checked-out library.",
    whatRuns: [
      "The learner's editor confirmation comes first and names the build and pack, because the build runs the project's own build scripts. A declined confirmation starts nothing.",
      "The repository's package manager (the root package.json packageManager field, else pnpm or npm by the lockfile at the root) runs the library's own build script in library.packageRoot with the external Node 24 or later first on PATH, then packs the library into the run's private folder with lifecycle scripts off.",
      "Codebook then starts the Example's own Vite with one inline plugin and a private optimizer cache inside the run's private folder, so every import of the library package (and its subpaths) is served from the packed copy. Peer dependencies of the library (such as react) come from the Example, so the page keeps one copy; the library's other dependencies come from the library's own install.",
      "It writes the library's ignored build output (its own build folder, as the project's CI does) and the run's private folder, which the run removes when it ends. No tracked file, nothing in the Example's folder and nothing in the Example's own node_modules changes.",
      `The build and pack together are bounded at ${LIBRARY_BUILD_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s. Codebook never installs packages.`,
    ],
    phase:
      'The run reads confirming, then building (the status bar says Building <name> for the Example…), then running. codebook_start answers its receipt at once; follow the run resource.',
    facts:
      'The run resource carries library: { package, version, packageRoot, revision, dirty, packageManager, buildMs, packMs, tarballSha256, installedVersion, prepared, observation, loaded, loadCount, publishedCopyLoaded, publishedCopyPath, cleanup }, the same shape as a node-script run. For a Vite run loaded means a module of the packed copy was served to the page (the page parsed it), loadCount counts the distinct packed files, and publishedCopyLoaded means the page was also served another copy (a file in any node_modules/<package> folder, or a pre-bundled chunk naming the package). The saved replay shows the same correspondence line under its title.',
    observationStates: [
      'prepared: the library was built and packed. It alone proves nothing about what the page was served.',
      'loaded true, publishedCopyLoaded false, observation complete: a module of the packed copy was served and no other copy was. Say "ran on the checked-out library" only then.',
      'loaded false with a complete observation: built but not served to this page; the page never imported the package.',
      'publishedCopyLoaded true: the page was also served another copy (publishedCopyPath names the first); say which copy ran and make no correspondence claim.',
      'pending, incomplete or unreadable observation: say what the page loaded was not fully observed, never "not loaded". The observation is complete only after the page closed and every module it parsed was collected.',
    ],
    refusals: {
      ...Object.fromEntries(
        Object.entries(VITE_LIBRARY_REFUSALS).map(([reason, entry]) => [
          reason,
          { anchor: packageRootAnchor(reason), ...entry },
        ]),
      ),
      unsupportedNothingStarted: `LIBRARY_BUILD_UNSUPPORTED, details.reason one of ${[...NODE_SCRIPT_LIBRARY_UNSUPPORTED_REASONS, ...VITE_LIBRARY_UNSUPPORTED_REASONS].join(', ')}: nothing was built or started; the reasons shared with node-script are explained at codebook://help/node-script#LIBRARY_BUILD_UNSUPPORTED.`,
      failedAfterStart: `LIBRARY_BUILD_FAILED, details.reason one of ${LIBRARY_BUILD_FAILED_REASONS.join(', ')}: follow codebook://help/node-script#LIBRARY_BUILD_FAILED. Retry a build-error or timeout once at most; never retry tracked-file-changed or tracked-files-unverified. pack-error details.step is one of ${LIBRARY_PACK_ERROR_STEPS.join(', ')}.`,
      librarySourceStops:
        "A browser stop in the library's checked-out source (a file below library.packageRoot, never in node_modules) is sealed against the served packed module's source map, which names the checked-out file where its sourcesContent equals that file, and pauses there. It is refused before the browser opens with the API 1.21 VITE_SEAL_FAILED reasons (library-build-stale when the file was edited after this run's build, library-build-unmapped with details.cause, library-not-in-build), in sentences that name the packed build and its revision. For these details.sideEffects is partial: Codebook built and packed the library and wrote its ignored build output, the private folder was removed, no browser opened and no input was sent. library-build-changed is different: it is raised during the run, after the page loaded, as RUNTIME_FAILED with details.sideEffects unknown. A stop outside both the Example and the declared library stays outside-package.",
    },
    limits: [
      "Versions can differ from a fresh install: the library's dependencies come from its own install (the repository lockfile), not from the Example's. A dependency can resolve to another version than a fresh install of the packed tarball would.",
      "A peer imported by one of the library's own dependencies resolves from the library's install, not the Example's, so two copies of a peer can load when the installs differ.",
      'An app plugin with enforce: "pre" that resolves the package itself can take the import before the redirect; this is not refused before the build, and the run then reports another copy as loaded (publishedCopyLoaded).',
      "The library's own dependencies are pre-bundled by Vite, so a stop in them is refused; stops stay in the Example's own source and in the library's checked-out source.",
      "The run uses its own optimizer cache inside the private folder, so the first start re-optimizes the Example's dependencies (a few seconds); the Example's node_modules/.vite is not rewritten.",
      'One library per run; browser stops only (no server or SSR participants, no worker code).',
      'Ignored inputs: the build reads and writes what the project ignores; Codebook compares tracked and untracked-not-ignored files only.',
      'Yarn and Bun repositories are refused (package-manager-unsupported); the Example runs its installed copy.',
    ],
    studies: `A vite-dev run that declares library is saved as study format ${VITE_LIBRARY_STUDY_VERSION} (.study.v${VITE_LIBRARY_STUDY_VERSION}.json) with its retained configuration and the library facts; a run without library keeps the format it takes today. An older Codebook lists a format ${VITE_LIBRARY_STUDY_VERSION} study as saved by a newer Codebook; update Codebook to open it. The replay reads only the saved facts and recorded evidence, never the packed files.`,
    sample: VITE_LIBRARY_CONFIGURATION,
  }
}

/** How to declare `apiServer.proxyPaths`, what a copyable entry is, which entries to omit and the limits of the relation; served as `viteApiServer.proxyPaths`. */
const VITE_PROXY_PATHS_HELP = {
  whenToDeclare:
    "Declare apiServer.proxyPaths when the page requests the API through a path on the dev server's own origin (a relative URL such as /api/items that the Vite config forwards). Omit it when the page requests an absolute URL on the API's origin: Codebook then attributes the request on the API's own port.",
  whereToRead:
    "Read the string keys of server.proxy in the app's Vite config (vite.config.*), and read the page's request code to see which of them the page uses.",
  copyableEntry:
    'Copy a key only when it is a string whose target is http: on a loopback host (localhost, 127.0.0.1 or ::1) and the port apiServer.port declares: protocol, host and port, never the port alone. A regular-expression key that is a literal prefix counts as that prefix (^/api is /api).',
  omit: 'Omit an entry whose destination cannot be established: another host, https, a function or environment-variable target, a context array, or a regular-expression key that is not a literal prefix. Tell the learner those requests cannot be tied to the API.',
  shape:
    'Write /api, not /api/ (a trailing slash is refused and the message names the corrected value). 1 to 8 entries, at most 256 characters each, no *, ? or #, not /, no duplicates. Every entry starts with / and holds only URL path characters, written as the page sends them (a space is %20).',
  limits: [
    'Vite forwards a key as a plain string prefix, so /api also forwards /apiculture, while Codebook attributes a request only at a / boundary (/api and /api/items, not /apiculture).',
    'Websocket and other non-http traffic is never attributed.',
    'A partial list only narrows what can be tied: a request under an omitted prefix stays unattributed.',
    "A rewrite in the proxy entry is matched on the page's path, the path the page sent to the dev server, never on the rewritten path.",
    "The declared relation is the chat's reading of the app's files, never an observation: Codebook did not see the dev server forward the request.",
    "A proxy target written as localhost can resolve to ::1 while the API listens on IPv4 only; the request then fails in the app itself, not in Codebook. Tell the learner when the API's code binds IPv4 only.",
  ],
} as const

/** What the chat does with the three `apiRequest` outcomes of a `vite-dev` run; served in `viteApiServer.attribution` after the shared sentences of {@link apiServerHelp}. */
const VITE_API_SERVER_ATTRIBUTION = [
  'A vite-dev server pause reports one of three outcomes in apiRequest. Attributed through the dev-server proxy: apiRequest.route is dev-server-proxy and apiRequest.proxyPath is the declared prefix the request was sent under. Attributed on the API origin: apiRequest.route is api-origin. Unattributed with reason none: apiRequest.watched names what Codebook watched (apiPort, devServerPort when proxyPaths were declared, proxyPaths).',
  'When the page uses the dev-server proxy and no proxyPaths was declared, the pause is unattributed with reason none and watched.proxyPaths is empty: declare proxyPaths from the Vite config, as in proxyPaths, and start again once. If the second run is still none, relay the sentence and say the request cannot be tied.',
] as const

/** Limits that only a `vite-dev` run has; served in `viteApiServer.limits`. */
const VITE_API_SERVER_LIMITS = [
  "The app's folder and the API's folder: the API folder may lie inside the app's folder or beside it, never around it or equal to it, and a browser stop must lie outside apiServer.packageRoot while a server stop lies inside it.",
  "Codebook binds Vite to 127.0.0.1; the dev script's --port and the Vite config's server.port must differ from apiServer.port (a clash is refused as api-port-conflict).",
  'The API starts before Vite: a refusal found after the API started ends it and sends no input.',
  'apiServer and library cannot be declared on one vite-dev run: the configuration is refused.Run the library flow and the API flow as separate runs.',
] as const

/**
 * Builds the `viteApiServer` key of `codebook://help/repository-browser`: how to run a Vite app together with its own Node API so a server stop in the API pauses during the page's request (API 1.38).
 *
 * Why it exists: a chat that meets a Vite app whose pages call a Node API in the same repository must derive every `apiServer` field, and the optional `proxyPaths`, from the app's own files and know every limit without any project-specific value. Shares its text with the Expo section through {@link apiServerHelp}. Called by {@link viteHelp}.
 *
 * @returns The shared section plus the proxy rules, the Vite sentences, the nested example and the Vite-only refusal note.
 * @example
 * viteApiServerHelp().minimumApi // => '1.38'
 */
function viteApiServerHelp() {
  return {
    ...apiServerHelp({
      devServer: 'Vite',
      runLabel: 'A vite-dev run',
      minimumApi: VITE_API_SERVER_MINIMUM_API,
      studyVersion: VITE_API_SERVER_STUDY_VERSION,
      configuration: VITE_API_SERVER_CONFIGURATION,
      packageRootFolderRule:
        ", inside the app's folder or beside it, never around it",
      example:
        "configuration: an app at the repository root (no packageRoot) with its API in a subfolder: one browser stop in the app and one server stop inside apiServer.packageRoot (additionalStops, afterOperation from 1; the operation is what sends the request), proxyPaths for the page's calls through the dev server and session \"fresh\" for a root run. configurationNested is the same flow for an app below the root. Every folder, file, line, selector, port and prefix is a placeholder: replace them with the repository's own values, the stops with statements inside the handlers the page's request reaches, and the book and the hash with the earlier steps' values.",
      extraDerivation: {
        proxyPaths:
          "Only when the page calls the API through the dev server's own origin: the string keys of server.proxy in the app's Vite config, as proxyPaths describes. The API's package and entry come from its dev script run through tsx; the port from the API's own listen code.",
      },
      extraAttribution: VITE_API_SERVER_ATTRIBUTION,
      extraLimits: VITE_API_SERVER_LIMITS,
    }),
    configurationNested: VITE_API_SERVER_NESTED_CONFIGURATION,
    proxyPaths: VITE_PROXY_PATHS_HELP,
    viteRefusals:
      'The Vite reasons that belong to apiServer: VITE_UNSUPPORTED api-port-conflict (the API port equals the app port; nothing started for a dev script port, the API stopped for a config or default port), VITE_SEAL_FAILED source-drift and source-unverifiable (the API ran source the stop does not match; the API and the app were stopped), VITE_PORT_UNAVAILABLE (the app port is taken after the API started; the API was stopped). VITE_PORT_UNAVAILABLE anchors are in viteRefusals; the api-port-conflict, source-drift and source-unverifiable anchors are in vitePackageRoot.refusals.',
  }
}

/** Where each placeholder of {@link VITE_QUICK_START_CONFIGURATION} is copied from. */
const VITE_QUICK_START_COPY_FROM = {
  'book.bookId, book.revision, book.nodeId':
    'the answer of codebook_publish_book (the published article); book.anchorIndex is the index of the cited anchor in that node',
  'source.path, source.hash':
    'the answer of codebook_source for the file the stop is in (the same path and full SHA-256 as the article cites)',
  'source.line, source.column':
    'one-based position in the numberedText of that codebook_source answer',
  'action.selector, action.before, action.after':
    'read from the source or the rendered page; never guess a library default',
  'inspections[].path':
    'a primitive the stop can read at that line, found in the same source',
  instanceId:
    'codebook_status (copy it into every later tool call; recopy it after a restart)',
} as const

/**
 * Builds the Vite part of `codebook://help/repository-browser`: a quick start with the call order, the supported/unsupported table, the first-run and written-files notes, and one anchor per refusal code.
 *
 * Why it exists: an agent that meets a Vite app needs the minimal route and the limits before it reads the long Next-oriented sections. Called by the resource reader for the repository-browser help, whose first keys are these.
 *
 * @returns Keys to spread at the start of the help object: `viteQuickStart`, `viteSupport`, `viteFirstRun` and `viteRefusals`.
 * @example
 * const help = { ...viteHelp(), profile: 'repository-browser' }
 * help.viteRefusals.VITE_SEAL_FAILED.anchor // => 'codebook://help/repository-browser#VITE_SEAL_FAILED'
 */
export function viteHelp() {
  const setupSeconds = REPOSITORY_SETUP_TIMEOUT_MS / MILLISECONDS_PER_SECOND
  return {
    viteQuickStart: {
      summary: `For a Vite ${VITE_SUPPORTED_MAJOR} web app: configure adapter "vite-dev" (instead of "next-dev-webpack") and use the same tools in this order. Use the adapter that codebook_status reports ready under profiles[].prerequisites.adapters. A server stop needs apiServer (API ${VITE_API_SERVER_MINIMUM_API}): when the app's pages call a Node API in the same repository, read viteApiServer.`,
      configuration: VITE_QUICK_START_CONFIGURATION,
      copyFrom: VITE_QUICK_START_COPY_FROM,
      callOrder: [
        'codebook_status: confirm profiles[].prerequisites.adapters["vite-dev"].ready is true; copy instanceId.',
        'codebook_sources, then codebook_source: read the file the stop is in; copy its path, full SHA-256 and the line and column from numberedText.',
        'codebook_publish_book: publish a source-only article whose node cites that file; copy bookId, revision and nodeId.',
        'codebook_start: profile repository-browser, the configuration above with the copied values and a stable key; the answer is a receipt with a run id.',
        'Poll the run resource it names until the run reads ready, paused (read inspectionUri and sourceUri, then codebook_continue) or an error: preparation starts Vite, seals the stops and opens the app.',
        'codebook_action repository-click: copy the run id and revision from the run resource (its nextActions), send it once with a stable action key.',
        'At each pause read inspectionUri and sourceUri, explain the values in the chat, then codebook_continue with the continueArguments of the current run resource.',
      ],
    },
    viteSupport: {
      supported: [
        `Vite major ${VITE_SUPPORTED_MAJOR}; its own engines.node range must include the Node that Codebook runs (Codebook: Node Executable). A .nvmrc or .node-version of the project is not honored.`,
        'A root app (the workspace root is the package root), or, in a version 3 configuration (API 1.20 or later), a Vite app in a folder below the repository root declared as packageRoot (see vitePackageRoot).',
        'A dev script of the form [NAME=value ...] vite [dev|serve] [--host] [--open] [--port N] [--mode M] [--config F] with --config naming a file inside the package root; --port, --mode and --config (also written --port=N) are forwarded to Vite as the script would, --host and --open are ignored (Codebook binds 127.0.0.1 and opens no browser of its own). Codebook never runs the dev script itself.',
        `Stops in JavaScript or TypeScript files under the package root (${VITE_STOP_EXTENSIONS.join(', ')}) that the entry page loads.`,
        'In a version 3 configuration with a packageRoot other than "." (API 1.21 or later), a browser stop in the checked-out source of a workspace library the app imports (see libraryStops in vitePackageRoot).',
        `Browser stops, and server stops inside the API folder of a declared apiServer (API ${VITE_API_SERVER_MINIMUM_API}, see viteApiServer).`,
      ],
      unsupported: [
        'Another Vite major, or a vite package that does not resolve from the package root (Yarn Plug-n-Play without node_modules).',
        'A dev script with any other command, flag, shell operator (&&, ;, |), variable expansion, quote or redirect; a cross-env, npx or pnpm exec prefix; a predev script.',
        'Config settings Codebook does not own: a server.host other than 127.0.0.1 (also one a plugin sets), a server.port of 0, https, origin, an own-listener hmr or server.ws (port, host or server), middlewareMode or appType "custom", a base other than "/", a root other than the package root, a cacheDir outside the package root (symlinks resolved). These are found at the start, not by codebook_status, and are refused all at once.',
        'Stops in .vue, .svelte or other non-JS/TS files, in node_modules, or outside the package root.',
        "A stop in a file that a Vite plugin rewrites without a source map (for example code-inspector-plugin adding attributes to components): the served map holds the rewritten text, so the executed code is not the file and the stop is refused at sealing with VITE_SEAL_FAILED. Stop in a module the plugin leaves alone, or use the plugin's own development switch to turn it off.",
        `SSR, and a server participant without apiServer (participant "server" is refused with vite-dev unless apiServer is declared, API ${VITE_API_SERVER_MINIMUM_API}; see viteApiServer).`,
        'A page that reloads after the declared inputs were written: the run ends and the click is not resent.',
      ],
    },
    viteFirstRun: `The first run of a project can be slower than later ones while Vite pre-bundles dependencies; preparation has ${setupSeconds} s in all. A run writes Vite's dependency cache (the resolved cacheDir, node_modules/.vite by default) and a transient vite.config.*.timestamp-*.mjs file that Vite removes (Codebook removes one left by a forced stop, also in the nearest node_modules/.vite-temp folder where Vite 8 writes it). Codebook writes nothing else into the repository.`,
    viteRefusals: Object.fromEntries(
      VITE_REFUSAL_CODES.map((code) => [
        code,
        { anchor: viteHelpAnchor(code), recovery: viteRecoveryOf(code) },
      ]),
    ),
    vitePackageRoot: vitePackageRoot(),
    viteApiServer: viteApiServerHelp(),
    viteLibrary: viteLibraryHelp(),
  }
}

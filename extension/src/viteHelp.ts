import {
  MILLISECONDS_PER_SECOND,
  NEXT_PACKAGE_DISCOVERY_APP_LIMIT,
  NEXT_PACKAGE_DISCOVERY_MANIFEST_LIMIT,
  NEXT_PACKAGE_DISCOVERY_MAX_DEPTH,
  REPOSITORY_GIT_TIMEOUT_MS,
  REPOSITORY_SETUP_TIMEOUT_MS,
  VITE_APP_SELECTION_RULE,
  VITE_LIBRARY_STOP_MINIMUM_API,
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
} as const

/** What a refused library stop under `vite-dev` says about side effects: the owned Vite server started, but no browser opened and no page or app code ran. */
const VITE_LIBRARY_SIDE_EFFECTS_SENTENCE =
  "details.sideEffects is none: refused before the browser opened (no page or app code ran, and no learner file or build output was written; Codebook's own Vite server had started and may have transformed modules into its own cache)."

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
      // library-place-ambiguous never occurs under vite-dev (D14); every other reason must have a row, which the table's key type enforces
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
      "Stops must lie in the app's own files or, since API 1.21, in the checked-out source of a workspace library the app reaches through links inside the repository (see libraryStops); a stop in any other file outside the app is refused with VITE_SEAL_FAILED (outside-package). Browser stops only.",
      "The app's own environment files are read and their values are masked, as for a root app. A Vite config temp file left in the app's own node_modules/.vite-temp or beside its config is removed; one in a shared ancestor node_modules/.vite-temp is never touched.",
      'One run at a time per window: a root run beside a nested run is refused with BUSY.',
    ],
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
      summary: `For a Vite ${VITE_SUPPORTED_MAJOR} web app: configure adapter "vite-dev" (instead of "next-dev-webpack") and use the same tools in this order. Use the adapter that codebook_status reports ready under profiles[].prerequisites.adapters.`,
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
        'Browser stops only.',
      ],
      unsupported: [
        'Another Vite major, or a vite package that does not resolve from the package root (Yarn Plug-n-Play without node_modules).',
        'A dev script with any other command, flag, shell operator (&&, ;, |), variable expansion, quote or redirect; a cross-env, npx or pnpm exec prefix; a predev script.',
        'Config settings Codebook does not own: a server.host other than 127.0.0.1 (also one a plugin sets), a server.port of 0, https, origin, an own-listener hmr or server.ws (port, host or server), middlewareMode or appType "custom", a base other than "/", a root other than the package root, a cacheDir outside the package root (symlinks resolved). These are found at the start, not by codebook_status, and are refused all at once.',
        'Stops in .vue, .svelte or other non-JS/TS files, in node_modules, or outside the package root.',
        "A stop in a file that a Vite plugin rewrites without a source map (for example code-inspector-plugin adding attributes to components): the served map holds the rewritten text, so the executed code is not the file and the stop is refused at sealing with VITE_SEAL_FAILED. Stop in a module the plugin leaves alone, or use the plugin's own development switch to turn it off.",
        'SSR and a server participant (participant "server" is refused with vite-dev).',
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
  }
}

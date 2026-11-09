import {
  BYTES_PER_MIB,
  LIBRARY_BUILD_DISCOVERY_TIMEOUT_MS,
  LIBRARY_BUILD_ENTRY_LIMIT_COUNT,
  LIBRARY_BUILD_MAP_LIMIT_COUNT,
  LIBRARY_BUILD_FAILED_REASONS,
  LIBRARY_BUILD_TIMEOUT_MS,
  LIBRARY_BUILD_TOTAL_LIMIT_BYTES,
  LIBRARY_PACK_ERROR_STEPS,
  MILLISECONDS_PER_SECOND,
  NEXT_APP_SELECTION_RULE,
  NEXT_LIBRARY_MINIMUM_API,
  NEXT_MANIFEST_POLL_MS,
  NEXT_PACKAGE_DISCOVERY_APP_LIMIT,
  NEXT_PACKAGE_DISCOVERY_MANIFEST_LIMIT,
  NEXT_PACKAGE_DISCOVERY_MAX_DEPTH,
  NEXT_PACKAGE_ROOT_ENVELOPE_SENTENCE,
  NEXT_PACKAGE_ROOT_MINIMUM_API,
  NEXT_PACKAGE_ROOT_MINIMUM_EXTENSION,
  NEXT_PAGES_SOURCE_EXTENSIONS,
  NEXT_SETUP_STEPS,
  NEXT_WEBPACK_COMPATIBILITY_SENTENCE,
  NODE_SCRIPT_LIBRARY_UNSUPPORTED_REASONS,
  API_SERVER_PAGE_ROUTE_RULE,
  EXPO_WEB_APP_SELECTION_RULE,
  REACT_SCRIPTS_APP_SELECTION_RULE,
  REACT_SCRIPTS_FOUR_MINIMUM_API,
  REPOSITORY_DISCOVERY_TIMEOUT_MS,
  REPOSITORY_GIT_TIMEOUT_MS,
  REPOSITORY_MAP_LIMIT_BYTES,
  REPOSITORY_SETUP_TIMEOUT_MS,
  REVERSE_PROXY_MINIMUM_API,
  STATIC_PAGE_MINIMUM_API,
  REVERSE_PROXY_REFUSAL_REASONS,
  type ReverseProxyRefusalReason,
} from './constants'
import { ERROR_RECOVERY, REVERSE_PROXY_REFUSAL_RECOVERY } from './errors'
import {
  NEXT_REFUSAL_CODES,
  nextHelpAnchor,
  type NextRefusalCode,
} from './nextRefusals'

/** The discovery's one deadline in seconds, as the help names it: the discovery works within the Git read bound ({@link REPOSITORY_GIT_TIMEOUT_MS}). */
const NEXT_PACKAGE_DISCOVERY_DEADLINE_SECONDS =
  REPOSITORY_GIT_TIMEOUT_MS / MILLISECONDS_PER_SECOND

/** The Pages source extensions Codebook tries, as the help names them: `.tsx, .ts, .jsx, .js`. */
const PAGES_SOURCE_EXTENSIONS_TEXT = NEXT_PAGES_SOURCE_EXTENSIONS.map(
  (extension) => `.${extension}`,
).join(', ')

/**
 * When a setup deadline answers `NEXT_SETUP_DEADLINE`, as {@link ConfiguredBrowserRun} decides it when its setup budget expires: a Next run in a workspace with a Pages folder, at the steps before its route is known (named as the deadline message names them) and at every step of a Pages route.
 * The help's `NEXT_SETUP_DEADLINE` meaning and `nextSupport.setupBudget` both carry it, so neither can say only a Pages Router run answers that code.
 */
const NEXT_SETUP_DEADLINE_SCOPE = `at its early steps (${NEXT_SETUP_STEPS.startingNext}, ${NEXT_SETUP_STEPS.waitingForServer}, ${NEXT_SETUP_STEPS.readingManifests}), before its route is known, and at every step once its entry path resolved as a Pages route`

/**
 * The first key of `codebook://help/repository-browser`: one sentence that sends an agent from `codebook_status` to the quick start of its app's adapter.
 * Served before both quick starts, so an agent reads it before either.
 */
export const REPOSITORY_BROWSER_START_HERE = `Read codebook_status first: profiles[].prerequisites.adapters names the adapter that is ready for this workspace, and the next-dev-webpack readiness names routerKind (app, pages, both or none), rootIsApp and packages (the Next apps below the repository root). ${NEXT_APP_SELECTION_RULE} For a Create React App app (react-scripts 4 or 5), the react-scripts-dev readiness (API 1.25 or later; react-scripts 4 needs API ${REACT_SCRIPTS_FOUR_MINIMUM_API} or later) names rootIsApp and packages the same way. ${REACT_SCRIPTS_APP_SELECTION_RULE} For an Expo app (SDK 57, served by Metro), the expo-web-dev readiness (API 1.30 or later) names rootIsApp and packages the same way. ${EXPO_WEB_APP_SELECTION_RULE} Then read the matching section of this help, nextQuickStart for a Next app (App Router or Pages Router), viteQuickStart for a Vite app, reactScriptsQuickStart for a Create React App app, expoWebQuickStart for an Expo app or staticPageQuickStart for a plain HTML page whose static-page readiness (API ${STATIC_PAGE_MINIMUM_API} or later) is ready. For a flow of several steps (type, choose an option, click) or a secret typed by the learner, read operationsQuickStart (configuration version 3) after it. For code that runs on the server of a Next app (an App Router page's server render, or a Pages Router page's getServerSideProps or getStaticProps and the code they call), read serverRenderQuickStart, which opens with the router choice and each router's own minimums. For a Next app below the repository root, read nextPackageRoot (its examples, refusals and limits); for a Vite app below the repository root (API 1.20 or later), read vitePackageRoot. For a Next app the learner opens through their own local reverse proxy instead of directly at the dev server's localhost address (API 1.40 or later), read nextReverseProxy. For a Vite app whose pages call a Node API in the same repository and a question about what that API does (API 1.38 or later), read viteApiServer. ${API_SERVER_PAGE_ROUTE_RULE}`

/**
 * A minimal valid `next-dev-webpack` configuration, generic on purpose: every identity and hash is a placeholder the agent replaces with the value the step named in {@link NEXT_QUICK_START_COPY_FROM} returned.
 * The help serves it as `nextQuickStart.configuration`, and a test parses it with the public schema so it cannot drift from the schema.
 */
export const NEXT_QUICK_START_CONFIGURATION = {
  version: 1,
  adapter: 'next-dev-webpack',
  book: {
    bookId: 'my-article',
    revision: 1,
    nodeId: 'my-node',
    anchorIndex: 0,
  },
  source: {
    path: 'src/pages/index.tsx',
    hash: '0000000000000000000000000000000000000000000000000000000000000000',
    line: 12,
    column: 3,
  },
  entryPath: '/',
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

/** Where each placeholder of {@link NEXT_QUICK_START_CONFIGURATION} is copied from. */
const NEXT_QUICK_START_COPY_FROM = {
  'book.bookId, book.revision, book.nodeId':
    'the answer of codebook_publish_book (the published article); book.anchorIndex is the index of the cited anchor in that node',
  'source.path, source.hash':
    'the answer of codebook_source for the file the stop is in (the same path and full SHA-256 as the article cites): for a Pages Router page, the page module under pages/ or src/pages/, a client component it imports, or _app',
  'source.line, source.column':
    'one-based position in the numberedText of that codebook_source answer, on a line the click runs in the browser',
  entryPath:
    'the path of the page the question is about, as the browser address bar shows it (default "/"): the route of a Pages file (src/pages/index.tsx is "/", src/pages/posts/[id].tsx a concrete path such as "/posts/1") or of an App page',
  'action.selector, action.before, action.after':
    'read from the source or the rendered page; never guess a library default',
  'inspections[].path':
    'a primitive the stop can read at that line, found in the same source',
  instanceId:
    'codebook_status (copy it into every later tool call; recopy it after a restart)',
} as const

/**
 * A complete version 3 configuration for a server stop in a Next app below the repository root: the app's folder is `packageRoot`, and `source.path` is repository-relative (it starts with that folder).
 * Served as `nextPackageRoot.configurationNestedServerStop` and parsed by a test with {@link liveRepositoryConfigSchema}. Every value is a neutral placeholder, not any project's folder or file: the agent replaces the folder with the `packageRoot` value of the `packages` entry the question is about, the book identity and the hash with the values the earlier steps returned.
 */
export const NEXT_NESTED_SERVER_STOP_CONFIGURATION = {
  version: 3,
  adapter: 'next-dev-webpack',
  packageRoot: 'apps/my-app',
  book: {
    bookId: 'my-article',
    revision: 1,
    nodeId: 'my-node',
    anchorIndex: 0,
  },
  source: {
    path: 'apps/my-app/pages/items/[id].tsx',
    hash: '0000000000000000000000000000000000000000000000000000000000000000',
    line: 18,
    column: 5,
  },
  participant: 'server',
  afterOperation: 0,
  entryPath: '/items/1',
  before: [{ kind: 'visible', selector: 'h1' }],
  after: [{ kind: 'text', selector: 'h1', equals: 'Item' }],
  inspections: [{ path: 'itemId', mode: 'value', required: true }],
} as const

/**
 * A complete version 3 configuration for a browser stop in a Next app below the repository root, reached by one declared click: a browser stop declares `afterOperation` from 1 (a browser stop with `afterOperation: 0` is refused), so the example carries one `click` operation.
 * Served as `nextPackageRoot.configurationNestedBrowserStop` and parsed by a test with {@link liveRepositoryConfigSchema}. Folder, file, selectors and texts are neutral placeholders, as in {@link NEXT_NESTED_SERVER_STOP_CONFIGURATION}.
 */
export const NEXT_NESTED_BROWSER_STOP_CONFIGURATION = {
  version: 3,
  adapter: 'next-dev-webpack',
  packageRoot: 'apps/my-app',
  book: {
    bookId: 'my-article',
    revision: 1,
    nodeId: 'my-node',
    anchorIndex: 0,
  },
  source: {
    path: 'apps/my-app/src/components/Toggle.tsx',
    hash: '0000000000000000000000000000000000000000000000000000000000000000',
    line: 12,
    column: 5,
  },
  participant: 'browser',
  afterOperation: 1,
  entryPath: '/',
  before: [{ kind: 'visible', selector: '[data-testid="toggle-button"]' }],
  after: [
    {
      kind: 'text',
      selector: '[data-testid="toggle-state"]',
      equals: 'On',
    },
  ],
  operations: [
    {
      kind: 'click',
      title: 'Click the toggle',
      selector: '[data-testid="toggle-button"]',
    },
  ],
  inspections: [{ path: 'enabled', mode: 'value', required: true }],
} as const

/**
 * A complete version 3 `next-dev-webpack` configuration for a browser stop in a Next Example below the repository root that runs on the repository's own library: the Example's folder is `packageRoot`, the library package's folder is `library.packageRoot`, and `source.path` is repository-relative and lies in the Example.
 * Served as `nextQuickStart.library.sample` and parsed by a test with the live configuration schema. Built from {@link NEXT_NESTED_BROWSER_STOP_CONFIGURATION}, so the two samples cannot drift. Every value is a neutral placeholder, not any project's folder or file: replace the folders with the Example and the library package the question is about, the book identity and the hash with the values the earlier steps returned.
 */
const NEXT_LIBRARY_CONFIGURATION = {
  ...NEXT_NESTED_BROWSER_STOP_CONFIGURATION,
  packageRoot: 'examples/widgets-next',
  library: { packageRoot: 'packages/widgets' },
  source: {
    ...NEXT_NESTED_BROWSER_STOP_CONFIGURATION.source,
    path: 'examples/widgets-next/src/components/Toggle.tsx',
  },
} as const

/**
 * The refusals of a `next-dev-webpack` library run, keyed by `details.reason`: the ones that are new with API 1.36 and the ones the route shares with the other library routes.
 * Why it exists: one anchor per reason lets a chat that meets a refusal read its fix without the long sections; {@link nextLibraryHelp} serves the rows in this record's order.
 */
const NEXT_LIBRARY_REFUSALS = {
  'library-needs-package-root': {
    code: 'LIBRARY_BUILD_UNSUPPORTED',
    meaning:
      'library was declared on a Next app at the repository root (packageRoot absent or "."): the library route redirects an Example below the repository root. Nothing started (details.sideEffects none).',
    fix: "Declare the Example's folder as packageRoot next to library, or drop library to run the root app on its installed copy.",
  },
  'not-a-dependency': {
    code: 'LIBRARY_BUILD_UNSUPPORTED',
    meaning:
      "The Example's package.json does not list the library in dependencies, devDependencies, peerDependencies or optionalDependencies, so the Example does not use it directly. Nothing started (details.sideEffects none).",
    fix: 'Tell the learner the Example does not list that library; drop library, saying the Example then runs its installed copy.',
  },
  'library-redirect-not-applied': {
    code: 'NEXT_UNSUPPORTED_SETTING',
    meaning:
      'After the owned server started, the preload did not write its applied marker for every compiler (details.compilers names those missing), or wrote its error line (details.cause): this Next installation did not take the redirect to the packed library. Refused before any request. details.sideEffects is partial: the library was built and packed, the owned server was started and stopped, no request was sent and no browser opened.',
    fix: 'Tell the learner this Next installation cannot take the library route in this version, then run without library, saying the Example then runs its installed copy. Do not retry with library.',
  },
  'library-stop-unsupported': {
    code: 'NEXT_STOP_NOT_SEALED',
    meaning:
      "A stop file lies in the source of the declared library (details.file, details.library): stops in the library's own source are not supported on the Next library route in this version. Refused before anything was built (details.sideEffects none).",
    fix: "Declare the stop in a file of the Example's own source, or run without library when the question is about the library's own source.",
  },
} as const

/**
 * Builds the `library` key of `nextQuickStart`: when to declare `library.packageRoot` under `next-dev-webpack` (API 1.36), what the build and pack run and write, the confirmation wait, the observation states, the refusals, the limits, the study format and one complete sample.
 *
 * Why it exists: a Next Example inside a library repository usually installs the library by a published version, so the Example runs a different release than the source the learner reads; a chat needs the route, its disclosure and its limits before it declares a run. Mirrors the Vite and react-scripts library sections so a chat reads one vocabulary for every bundler. Called by {@link nextHelp}.
 *
 * @returns The JSON-serializable section.
 * @example
 * nextLibraryHelp().sample.library.packageRoot // => 'packages/widgets'
 */
function nextLibraryHelp() {
  return {
    anchor: packageRootAnchor('nextLibrary'),
    minimumApi: NEXT_LIBRARY_MINIMUM_API,
    requires: `codebook_status reports API ${NEXT_LIBRARY_MINIMUM_API} or later (compare the number after the dot as a whole number). An older Codebook refuses library under next-dev-webpack as an unknown key: tell the learner to update Codebook and do not run the Example by another route.`,
    whenToUse:
      "The Next Example lives below the root of a library repository and uses that library: its own package.json lists the library, so its node_modules holds an installed copy, not the checked-out source. Declare library.packageRoot (the library package's folder, relative to the repository root; \".\" when the library is the repository root itself, even though the Example lies below it; never the Example's own folder or a folder inside it) together with the Example's nested packageRoot, and the Example runs on the checked-out library. A Next app at the repository root with library is refused (library-needs-package-root). Without library the Example runs the installed copy: say so to the learner and never call that copy the checked-out library.",
    whatRuns: [
      "The learner's editor confirmation comes first and names the build and pack, because the build runs the project's own build scripts. Tell the learner a build will run and to answer the editor's confirmation; a declined confirmation starts nothing.",
      "The repository's package manager runs the library's own build script in library.packageRoot, then packs the library into the run's private folder with lifecycle scripts off.",
      "Codebook then starts the Example's own next dev --webpack with a preload that redirects every compiler's imports of the library (client, server and edge) to the packed copy; the Example's files and its node_modules stay as they are, Next writes its own .next dev output as in any run, and the webpack cache goes to the run's private folder.",
      `The build and pack together are bounded at ${LIBRARY_BUILD_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s. Codebook never installs packages.`,
    ],
    phase:
      'The run reads confirming, then building, then running. codebook_start answers its receipt at once; keep polling the run resource while it reads confirming (the learner is answering the editor dialog) and do not end your turn there.',
    facts:
      "The run resource carries library: { package, version, packageRoot, revision, dirty, packageManager, buildMs, packMs, tarballSha256, installedVersion, prepared, observation, loaded, loadCount, publishedCopyLoaded, publishedCopyPath, cleanup }, the same shape as a node-script, vite-dev and react-scripts-dev run. For Next loaded means a module of the packed copy was in a bundle that the page or the server parsed (matched by the parsed script's SHA-256 against the compilation report of its compiler), and publishedCopyLoaded means another copy was in such a bundle, or the server loaded a file of another copy outside webpack (through a dependency webpack left external). The saved replay shows the same correspondence sentence under its title.",
    observationStates: [
      'prepared: the library was built and packed. It alone proves nothing about what the page or the server parsed.',
      'loaded true, publishedCopyLoaded false, observation complete: a module of the packed copy was in a parsed bundle and no other copy was. Say "ran on the checked-out library" only then.',
      'loaded false with a complete observation: built but not in any bundle the page or the server parsed; the Example never imported the package.',
      'publishedCopyLoaded true: a parsed bundle also held another copy (publishedCopyPath names the first); say which copy ran and make no correspondence claim.',
      'pending, incomplete or unreadable observation (a missing report, a parsed script of the Example that matches no emitted asset, or a compilation the server parsed without a report line): say what the run loaded was not fully observed, never "not loaded". Scripts parsed after finalization started are not counted.',
    ],
    refusals: {
      ...Object.fromEntries(
        Object.entries(NEXT_LIBRARY_REFUSALS).map(([reason, entry]) => [
          reason,
          { anchor: packageRootAnchor(reason), ...entry },
        ]),
      ),
      packageManagerUnsupported:
        'LIBRARY_BUILD_UNSUPPORTED, details.reason package-manager-unsupported: Yarn and Bun repositories are refused before the build; the Example runs its installed copy.',
      unsupportedNothingStarted: `LIBRARY_BUILD_UNSUPPORTED, details.reason one of ${NODE_SCRIPT_LIBRARY_UNSUPPORTED_REASONS.join(', ')}: nothing was built or started; the reasons shared with node-script are explained at codebook://help/node-script#LIBRARY_BUILD_UNSUPPORTED.`,
      failedAfterStart: `LIBRARY_BUILD_FAILED, details.reason one of ${LIBRARY_BUILD_FAILED_REASONS.join(', ')}: follow codebook://help/node-script#LIBRARY_BUILD_FAILED. Retry a build-error or timeout once at most; never retry tracked-file-changed or tracked-files-unverified. pack-error details.step is one of ${LIBRARY_PACK_ERROR_STEPS.join(', ')}.`,
    },
    limits: [
      "Stops stay in the Example's own source: a stop in the library's own source is refused before anything is built (library-stop-unsupported).",
      "Versions can differ from a fresh install: the library's dependencies come from its own install, not from the Example's.",
      "One library per run; the direct dependency rule only (the Example's own package.json lists the library).",
      'The preload patches every compiler Next creates, but the edge compiler is not proven in this version; a patch failure in any compiler refuses the whole run (library-redirect-not-applied).',
      'Next 16 with next dev --webpack only; Turbopack, next build and next start are not supported.',
    ],
    studies:
      'A next-dev-webpack run that declares library is saved as study format 18 (.study.v18.json) with its retained configuration and the library facts; a run without library keeps the format it takes today. An older Codebook lists a format 18 study as saved by a newer Codebook; update Codebook to open it. The replay reads only the saved facts and recorded evidence.',
    sample: NEXT_LIBRARY_CONFIGURATION,
  }
}

/**
 * The help anchor of one section of {@link nextPackageRootHelp}: `codebook://help/repository-browser#<id>`.
 * @param id - The section or reason id.
 * @returns The resource address with the id as its anchor.
 * @example packageRootAnchor('outside-package') // => 'codebook://help/repository-browser#outside-package'
 */
export function packageRootAnchor(id: string): string {
  return `codebook://help/repository-browser#${id}`
}

/**
 * One refusal of a `packageRoot` run, keyed by the `details.reason` the error carries: the code it answers with, what it means and the fix the chat follows.
 * Keyed by reason so the compiler holds the table's entries uniform; {@link nextPackageRootHelp} serves them in this record's order.
 */
export const PACKAGE_ROOT_REFUSALS = {
  'outside-repository': {
    code: 'INVALID_CONFIGURATION',
    meaning:
      'Two forms. A packageRoot with a ".." segment, a leading "/" or a backslash never reaches the resolver: the schema refuses it at parse as INVALID_CONFIGURATION "Start arguments do not match the selected profile or accepted intent." with no details.reason and no details.suggestions. With details.reason outside-repository the path was well-formed but resolves to a folder outside the opened repository (only the resolver answers so, with details.suggestions).',
    fix: 'In both forms declare the folder as a repository-relative path inside the repository (forward slashes, no ".." and no leading "/"), copied from the packages entry the question is about or, when the refusal carries them, from details.suggestions. Nothing started (details.sideEffects none).',
  },
  'link-leaves-repository': {
    code: 'INVALID_CONFIGURATION',
    meaning:
      'A link on the way to packageRoot leads out of the repository, so its real path is outside it.',
    fix: 'Declare the real folder inside the repository (a packages entry or details.suggestions), never the link. Codebook does not follow a link out of the repository. Nothing started.',
  },
  'not-a-folder': {
    code: 'INVALID_CONFIGURATION',
    meaning: 'packageRoot names a file, not a folder.',
    fix: "Declare the folder that holds the app's package.json, not a file in it. Nothing started.",
  },
  missing: {
    code: 'INVALID_CONFIGURATION',
    meaning: 'No folder exists at packageRoot in this repository.',
    fix: 'Correct the path from the repository\'s files (forward slashes, no leading "./") or take a value from the packages entries or details.suggestions. Nothing started.',
  },
  unreadable: {
    code: 'INVALID_CONFIGURATION',
    meaning:
      'The folder cannot be read; the refusal carries the operating system error code.',
    fix: 'Tell the learner the folder is not readable and which error code the refusal names; only the learner can change its permissions. Do not retry with the same value. Nothing started.',
  },
  'not-a-next-app': {
    code: 'INVALID_CONFIGURATION',
    meaning:
      'The folder has no package.json that names next in dependencies, devDependencies or peerDependencies.',
    fix: 'Declare the folder whose package.json names next (a packages entry), or tell the learner this folder is not a Next app. Nothing started.',
  },
  'outside-package': {
    code: 'NEXT_STOP_NOT_SEALED',
    meaning:
      'A stop file lies outside packageRoot (a shared package the app imports, for example); details.files lists every such stop and details.packageRoot the app folder. Refused before the server starts: nothing ran.',
    fix: 'Declare stops only in files inside details.packageRoot, or in a workspace library an app below the repository root reaches through links inside the repository (a server stop of a Pages app since API 1.19, a browser stop since API 1.22 for a Pages app or API 1.23 for an App Router app, and a server stop of an App Router app since API 1.24; see libraryStops), or tell the learner that code outside the app folder cannot be observed in this version. Do not start another run with the same stops.',
  },
  'library-build-stale': {
    code: 'NEXT_STOP_NOT_SEALED',
    meaning:
      "A stop (a server stop, or since API 1.22 a browser stop) lies in the checked-out source of a workspace library, and a build map that names the file carries source text that differs from the checked-out file: the library was edited after it was built. details.sideEffects is none: refused before anything started. The message names the library's package name and the build to run.",
    fix: "Tell the learner which build to run for that library (for example the build script of the library's package) and that only the learner runs it; Codebook never builds and you never run it. After the learner has rebuilt, start the run again with the same stop. Do not move the stop to another file to make the run start.",
  },
  'library-build-unmapped': {
    code: 'NEXT_STOP_NOT_SEALED',
    meaning: `A stop (a server stop, or since API 1.22 a browser stop) lies in the checked-out source of a workspace library, but its build cannot be tied to that file; details.cause says why: no-map (no build map names the file), no-content (a map names it without the source text), no-line (no build mapping lies on the stop's line or within its citation after it), malformed (a map cannot be parsed), bound (a limit was hit: more than ${LIBRARY_BUILD_MAP_LIMIT_COUNT} build maps, more than ${LIBRARY_BUILD_ENTRY_LIMIT_COUNT} entries in the build folders, a map larger than ${REPOSITORY_MAP_LIMIT_BYTES / BYTES_PER_MIB} MiB, more than ${LIBRARY_BUILD_TOTAL_LIMIT_BYTES / BYTES_PER_MIB} MiB read in total, or a search that did not finish) or deadline (the search ran out of time: the smaller of ${LIBRARY_BUILD_DISCOVERY_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s and what is left of the run's ${REPOSITORY_DISCOVERY_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s discovery time). details.sideEffects is none: refused before anything started.`,
    fix: 'Tell the learner the cause. For no-map, no-content and malformed the learner can rebuild the library with source maps that include the source text; for no-line declare the stop on a line that runs; for bound and deadline this version cannot search that library, so a rebuild does not help. Codebook never builds. Do not retry with the same stop.',
  },
  'library-not-in-build': {
    code: 'NEXT_STOP_NOT_SEALED',
    meaning:
      "The library's build matches its checked-out source, but none of the built files that map to the stop, or more than one, is a module of the page's server compile (a server stop) or of the entry chunks of the route and _app (a browser stop, API 1.22 or later), or, for a nested App Router app, of the .js chunks of the entry route's client-reference manifest (a browser stop, API 1.23 or later) or the one (rsc) module of the entry route's server chunk, server/<route>.js (a server stop, API 1.24 or later; an (ssr) copy of a module never counts); the message names the candidates. For a browser stop this also covers a library module the page loads later (next/dynamic, a lazy import) or never loads, and copies of the module whose code differs. For an App Router app it also fires when the module's own map does not name the checked-out file, and then details.mapSource carries the path the map named. App Router refusals carry details.router \"app\". details.sideEffects is unknown: Codebook's readiness request for the entry had already been sent.",
    fix: "Tell the learner the page does not load that library file when it starts (for a server stop, the page's server code; for a browser stop, the entry chunks of the route and _app, or the .js chunks of the route's client-reference manifest in an App Router app, so a module loaded later does not count; for an App Router server stop, the (rsc) module of the entry route's server chunk, never an (ssr) copy), or loads it from more than one build (another build, such as a legacy build, may be the one it loads), or choose a stop on a line that code runs. Do not start another run with the same stop.",
  },
  'library-place-ambiguous': {
    code: 'NEXT_STOP_NOT_SEALED',
    meaning:
      'The debugger placed the library stop at a position that maps back to more than one source position or to a source Codebook does not allow, so the pause could not be tied to the declared line. A library stop on a line that itself declares a binding a required inspection reads is refused the same way: unlike a stop in the app, it is not moved to the next line. An App Router refusal carries details.router "app". details.sideEffects is unknown: the entry had been requested.',
    fix: 'Tell the learner the stop could not be placed on one source position; declare the stop on a line that holds a single statement, after the line that declares the value it reads. Do not start another run with the same stop.',
  },
  'library-build-changed': {
    code: 'RUNTIME_FAILED',
    meaning:
      'The library\'s build or the module the run executes changed between the check before the start and the seal (a rebuild, a recompile that shifted lines). For a browser stop (API 1.22 or later) it also covers a module announced again under a new script id (a rebuild or a hot update) and executed bytes that differ from the sealed module when the stop is armed or when the pause is inspected; an App Router refusal (API 1.23 or later) carries details.router "app". For an App Router server stop (API 1.24 or later) only differing bytes of a re-announced (rsc) module give it; a re-announcement with the sealed bytes is a coexisting instance, and the (ssr) and React copies of the module are journaled, never bound. details.sideEffects is unknown: the entry had been requested.',
    fix: 'Tell the learner the library was rebuilt during the run; ask the learner to finish the rebuild and start the run again. Do not run the build yourself.',
  },
  'package-root-fresh-session': {
    code: 'SIGN_IN_REQUIRED',
    meaning:
      "A run below the repository root starts with a fresh browser and never loads the repository's saved sign-in session, which was set up for the root app, and the app asked for a sign-in.",
    fix: 'Do not set up a saved session: without apiServer this app cannot sign in below the root in this version. A Vite or Expo app can instead declare apiServer and sign in inside the run (viteApiServer.signInInRun, expoWebQuickStart.apiServer.signInInRun), which Next and react-scripts apps cannot; otherwise tell the learner so and offer a question about code that needs no sign-in.',
  },
  'nested-workspace': {
    code: 'PREREQUISITE_MISSING',
    meaning:
      'The opened folder lies below the Git repository root, so source authoring refuses every run in this window; details.gitRoot names the repository folder and details.packageRoot the opened folder relative to it. codebook_status reports every repository-browser adapter not ready there.',
    fix: 'Ask the learner to open the details.gitRoot folder (the repository root) in the editor and do not retry in this window. A Next app (or, since API 1.20, a Vite app) then runs from the root with packageRoot set to details.packageRoot.',
  },
} as const

/** The refusal reasons of a library stop, in the order the help lists them (API 1.19); each has a row in {@link PACKAGE_ROOT_REFUSALS}. */
export const LIBRARY_STOP_REASONS = [
  'library-build-stale',
  'library-build-unmapped',
  'library-not-in-build',
  'library-place-ambiguous',
  'library-build-changed',
] as const

/**
 * Builds the `nextPackageRoot` key of `codebook://help/repository-browser`: how to run a Next app that lives below the repository root (API 1.18, library stops API 1.19).
 *
 * Why it exists: before API 1.18 a Next app below the repository root could not run, and a chat that meets one (a monorepo, an `examples/` folder) needs the selection rule, the exact configuration shape, the refusal fixes, the cross-adapter difference and the limits before it reads the long sections. Called by {@link nextHelp}, which serves its result as one key.
 *
 * @returns The section: envelope sentence, selection rule, status fields, two complete version 3 examples, the refusal-to-fix table (one anchor per `details.reason`), the cross-adapter `packageRoot` table, the saved-session rule, the opened-folder rule and the study-format note.
 * @example
 * nextPackageRootHelp().refusals['outside-package'].anchor // => 'codebook://help/repository-browser#outside-package'
 */
function nextPackageRootHelp() {
  return {
    anchor: packageRootAnchor('next-package-root'),
    minimumApi: NEXT_PACKAGE_ROOT_MINIMUM_API,
    minimumExtension: NEXT_PACKAGE_ROOT_MINIMUM_EXTENSION,
    envelope: NEXT_PACKAGE_ROOT_ENVELOPE_SENTENCE,
    selectionRule: NEXT_APP_SELECTION_RULE,
    versionCheck: `packageRoot exists only in configuration version 3 and only when codebook_status reports API ${NEXT_PACKAGE_ROOT_MINIMUM_API} or later (Codebook ${NEXT_PACKAGE_ROOT_MINIMUM_EXTENSION}; compare the number after the dot as a whole number). On an older API, or when a start refuses packageRoot as an unknown key, tell the learner to update Codebook and do not run the app by another route.`,
    openFrom:
      "Open the repository root, never the app's folder: with a folder below the repository root open, source authoring is refused with PREREQUISITE_MISSING and the message names the packageRoot to declare once the learner has opened the root. Do not retry in that window; ask the learner to open the repository root.",
    status: {
      rootIsApp:
        "next-dev-webpack readiness: true when the root package.json names next and the root has a route folder (app, src/app, pages or src/pages). Only then is the root a candidate; the root's ready keeps its meaning.",
      packages: `Array of the Next apps below the root that tracked package.json files name (depth ${NEXT_PACKAGE_DISCOVERY_MAX_DEPTH} or less, at most ${NEXT_PACKAGE_DISCOVERY_APP_LIMIT}): { packageRoot, routerKind, installed, ready, version?, missing[] }. packageRoot is the exact value to declare; ready and missing are what a start with that packageRoot checks. Entries carry no preparation or notes: a start reports them. Untracked apps are not listed.`,
      packagesTruncated: `true when the list is incomplete; packagesTruncatedReason says why: limit (more than ${NEXT_PACKAGE_DISCOVERY_APP_LIMIT} apps), manifest-cap (more than ${NEXT_PACKAGE_DISCOVERY_MANIFEST_LIMIT} manifests), deadline (the ${NEXT_PACKAGE_DISCOVERY_DEADLINE_SECONDS} s discovery bound), skipped-path (a path was skipped) or git-failed.`,
      whenTruncated: `When packagesTruncated is true and the app the question names is not listed, declare its packageRoot from the repository's files (the folder that holds its package.json); the start checks it, and an unlisted depth ${NEXT_PACKAGE_DISCOVERY_MAX_DEPTH + 1} or untracked folder runs when it passes.`,
    },
    libraryStops: {
      anchor: packageRootAnchor('library-stops'),
      rule: "A server stop, and since API 1.22 a browser stop (a version 3 next-dev-webpack run of a Pages app with a packageRoot other than \".\"), in the checked-out source of a workspace library the app reaches through links inside the repository (directly or through other workspace libraries) pauses when the library's build carries source maps with sourcesContent equal to the checked-out source. Codebook never builds: when the build is stale or unmapped the run is refused before anything starts and the learner runs the build. A browser library stop pauses in the one library module that the entry chunks of the route and _app hold; a library module the page loads later (next/dynamic, a lazy import) or never loads is refused as library-not-in-build. The native debugger may show the library's built file at the pause in a Pages app, while the chat, the recorded source and the replay use the library's source. A browser stop, like every browser stop, declares afterOperation from 1 (afterOperation 0 is refused): library code that runs only while the entry page loads is observed through a server library stop, or after a client navigation (for example a Next Link click that fetches the next page's props), never through a browser stop at the entry load. The run is saved as study format 9 with no new field. Since API 1.23 a browser stop of a nested App Router app may lie in a workspace library too, under the same rules: the build is current with maps that carry sourcesContent, and the module is among the code the entry route loads first, the .js chunks of its client-reference manifest, so a module loaded later is refused as library-not-in-build; there the native debugger shows the checked-out library file with the library's values, not the built file. Since API 1.24 a server stop of a nested App Router app may lie in a workspace library too, under the same rules (a current build with maps that carry sourcesContent, and a module in the entry route's server code, the (rsc) layer, with the library details.reason values of API 1.19 and details.router \"app\" under NEXT_STOP_NOT_SEALED), and it pauses in the server render of the entry route; the native debugger shows the checked-out library file with the library's values, not the built file. The server and the client-component render on the server may run the same library file: a pause in another copy of the module, or at a line only a browser stop declares (for example hydrate, which runs during the server render of a client component), is resumed and not recorded. A library stop of an app with both routers keeps the outside-package refusal; a root app (packageRoot absent or \".\") has no files outside the app and a version 2 configuration cannot carry packageRoot, so the app readers refuse such a stop as not in the code the page loads at start. When the library is refused, follow the fix of the refusal's details.reason in refusals (one anchor per reason); do not retry with the same stop.",
      reasons: LIBRARY_STOP_REASONS,
    },
    configurationNestedServerStop: NEXT_NESTED_SERVER_STOP_CONFIGURATION,
    configurationNestedBrowserStop: NEXT_NESTED_BROWSER_STOP_CONFIGURATION,
    examples: {
      nestedServerStop:
        "configurationNestedServerStop: a Pages Router data-function stop (participant server, afterOperation 0, operations omitted) in a Next app whose folder is packageRoot. source.path stays repository-relative and starts with packageRoot; entryPath is the page's own route. The folder, file, line and inspection are placeholders: replace them, the book and the hash with the app the question is about (copyFrom of serverRenderQuickStart).",
      nestedBrowserStop:
        'configurationNestedBrowserStop: a browser stop in a component of the app, reached by one declared click (a browser stop declares afterOperation from 1; afterOperation 0 is refused). Same placeholders and the same path rule.',
    },
    refusals: Object.fromEntries(
      Object.entries(PACKAGE_ROOT_REFUSALS).map(([reason, entry]) => [
        reason,
        { anchor: packageRootAnchor(reason), ...entry },
      ]),
    ),
    adapters: {
      anchor: packageRootAnchor('package-root-adapters'),
      table: [
        {
          adapter: 'node-server',
          packageRoot:
            'Its own field, default "."; an invalid value is refused with NODE_SERVER_SOURCE_REFUSED.',
        },
        {
          adapter: 'next-dev-webpack',
          packageRoot:
            'Version 3 only, absent means "." (the repository root); a bad value is refused with INVALID_CONFIGURATION, a missing Next with PREREQUISITE_MISSING.',
        },
        {
          adapter: 'vite-dev',
          packageRoot:
            'Version 3 only (API 1.20 or later), absent means "." (the repository root); a bad value is refused with INVALID_CONFIGURATION, a missing Vite with PREREQUISITE_MISSING. A version 1 or 2 configuration with packageRoot is refused with INVALID_CONFIGURATION. Read vitePackageRoot in this help.',
        },
      ],
    },
    savedSession:
      'A run with packageRoot other than "." never loads the repository\'s saved sign-in session and records no sign-in paths into it; the run resource reports savedSessionSkipped "package-root". An app that needs a sign-in cannot run below the root in this version (package-root-fresh-session).',
    studies:
      'A nested run is saved as study format 9 (.study.v9.json) with packageRoot in its configuration, so the saved study names the app that ran; recorded sources and book citations stay repository-relative. A run without packageRoot (or with ".") keeps the format it takes today. Codebook 0.2.74.0 lists a format 9 study as saved by a newer Codebook; update Codebook to open it. Format 9 replays from recorded evidence, also after the app\'s folder is removed.',
    limits: [
      NEXT_PACKAGE_ROOT_ENVELOPE_SENTENCE,
      "A server stop, or since API 1.22 a browser stop, in the checked-out source of a workspace library the app reaches through links inside the repository (directly or through other workspace libraries) can pause (see libraryStops); since API 1.23 a browser stop of a nested App Router app may lie in a workspace library, and since API 1.24 a server stop of one may too (it pauses in the server render, and a pause in another copy of the module, or at a line only a browser stop declares, is resumed and not recorded); the native debugger shows the checked-out library file there. A library that Next compiles from source through transpilePackages has no build of its own to match: when no build map names the stop file, the stop is refused as library-build-unmapped (cause no-map); a library stop of an app with both routers or of a root app, and a library outside the repository, stay outside the stop range, and a stop in a file the app does not link to is refused with NEXT_STOP_NOT_SEALED (outside-package). A run that declares library (API 1.36) is different: a stop in the declared library's own source is refused before anything is built (library-stop-unsupported). A question whose answer needs such code is outside this version's claim.",
      "Next resolves as Node would from the app's folder: the first node_modules/next found from packageRoot up to the repository root, never above it, whose real path is inside the repository (a pnpm link into the root's node_modules/.pnpm and a hoisted workspace install qualify; Yarn PnP and NODE_PATH count as not installed). A missing Next names the install command of the repository's lockfile as the learner's decision; Codebook never runs it.",
      'One run at a time per window: a root run beside a nested run is refused with BUSY.',
    ],
  }
}

/**
 * A complete version 3 configuration for a Next app the learner opens through their own local reverse proxy: a root app (no `packageRoot`), the sign-in page as the entry and `reverseProxy` declaring the origin the learner opens and the port their proxy forwards to.
 * Served as `nextReverseProxy.configuration.example` and parsed by a test with {@link liveRepositoryConfigSchema}. Every value is a neutral placeholder (the host is a reserved `.test` name): the agent replaces the origin and the port with the learner's own answers, the book identity and the hash with the values the earlier steps returned.
 */
export const NEXT_REVERSE_PROXY_CONFIGURATION = {
  version: 3,
  adapter: 'next-dev-webpack',
  book: NEXT_NESTED_SERVER_STOP_CONFIGURATION.book,
  source: {
    path: 'pages/login.tsx',
    hash: '0000000000000000000000000000000000000000000000000000000000000000',
    line: 18,
    column: 5,
  },
  participant: 'server',
  afterOperation: 0,
  entryPath: '/login',
  before: NEXT_NESTED_SERVER_STOP_CONFIGURATION.before,
  after: NEXT_NESTED_SERVER_STOP_CONFIGURATION.after,
  inspections: NEXT_NESTED_SERVER_STOP_CONFIGURATION.inspections,
  reverseProxy: { origin: 'https://app.example.test', upstreamPort: 4310 },
} as const

/** What the help says about one `REVERSE_PROXY_REFUSED` reason: what Codebook observed, the learner's fix and what reached a server. */
type ReverseProxyRefusalHelpRow = {
  observed: string
  fix: string
  sideEffects: string
}

/** Shared by the three reasons whose proof request may have reached a responder Codebook does not control. */
const PROOF_REACHED_RESPONDER =
  "unknown: the proof's single GET of an unguessable path (no cookies, no-store) and, when the browser check ran, the throwaway browser's one request (no cookie) reached a responder Codebook does not control, and no operation was sent."

/** Shared by the reasons that fail before any HTTP request is written. */
const NOTHING_REACHED_A_SERVER =
  'none: the handshake failed before any HTTP request; nothing was sent to the origin and no browser opened.'

/** Shared by the two reasons the throwaway or run browser reports at its first handshake. */
const BROWSER_HANDSHAKE_FAILED =
  'none: the browser failed at the handshake, before any operation and any request to the app.'

/**
 * One row per reason of {@link REVERSE_PROXY_REFUSAL_REASONS}: the observation, the learner's fix and what reached a server.
 * Keyed by reason so the compiler holds the table complete; {@link nextReverseProxyHelp} serves it in the order of the reason list, with each reason's recovery from {@link REVERSE_PROXY_REFUSAL_RECOVERY}.
 */
const REVERSE_PROXY_REFUSAL_ROWS: Record<
  ReverseProxyRefusalReason,
  ReverseProxyRefusalHelpRow
> = {
  'not-resolved': {
    observed: 'The host has no address on this machine.',
    fix: 'Map the host to a loopback address with a hosts entry or local DNS, then ask for a new run.',
    sideEffects: 'none: nothing was started.',
  },
  'not-loopback': {
    observed:
      'The host resolves to an address that is not a loopback address (the first such address is named); Codebook trusts only a proxy on this machine.',
    fix: 'Codebook supports a proxy on this machine only; map the host to a loopback address.',
    sideEffects: 'none: nothing was started.',
  },
  'same-socket': {
    observed:
      "The origin's address and port are the address the development server needs, so the proxy and the server cannot share it.",
    fix: 'Declare the port your proxy forwards to, which differs from the port the proxy itself listens on.',
    sideEffects: 'none: nothing was started.',
  },
  'proof-unreachable': {
    observed:
      'No request completed at the origin (connection refused, no route or connection reset).',
    fix: 'Start your proxy and check that the host maps to the address it listens on.',
    sideEffects:
      'none when no request was written; unknown when the connection was reset after the proof request was written (details.sideEffects says which).',
  },
  'proof-wrong-server': {
    observed:
      'The origin answered (details.status) but not with the identity of the development server Codebook started.',
    fix: "Check the port in your proxy's configuration (proxy_pass, reverse_proxy) and that it forwards this path to the app's dev server without requiring sign-in.",
    sideEffects: PROOF_REACHED_RESPONDER,
  },
  'proof-redirected': {
    observed:
      'The origin answered with a redirect (details.status); Codebook follows none, and the throwaway browser check follows none either.',
    fix: 'Declare the scheme and port your proxy serves directly.',
    sideEffects: PROOF_REACHED_RESPONDER,
  },
  'proof-timeout': {
    observed: 'The origin did not answer within details.timeoutMs.',
    fix: 'Check that your proxy and the server behind it respond.',
    sideEffects: PROOF_REACHED_RESPONDER,
  },
  'proof-unclassified': {
    observed:
      'The proof request failed in a way Codebook does not classify (details.logId names one line in Output > Codebook).',
    fix: 'Look up the log id in Output > Codebook; a saved-session setup names none, so look for the reverse proxy line there.',
    sideEffects:
      "none when the proof request was not started (the system trust store could not be read); otherwise unknown: the proof's single GET of an unguessable path (no cookies, no-store) reached a responder Codebook does not control, and no operation was sent (details.sideEffects says which).",
  },
  'certificate-untrusted': {
    observed:
      'This system does not trust the certificate chain of the origin (details.tlsCode).',
    fix: 'Add the issuer of your local certificate to the system trust store (the tool that created the certificate has an install command).',
    sideEffects: NOTHING_REACHED_A_SERVER,
  },
  'certificate-expired': {
    observed:
      'The certificate of the origin has expired or is not yet valid (details.tlsCode).',
    fix: "Renew the proxy's certificate.",
    sideEffects: NOTHING_REACHED_A_SERVER,
  },
  'certificate-host-mismatch': {
    observed:
      'The certificate of the origin does not name its host (details.tlsCode).',
    fix: 'Use a certificate that names this host.',
    sideEffects: NOTHING_REACHED_A_SERVER,
  },
  'certificate-invalid': {
    observed:
      'This system rejected the certificate of the origin (details.tlsCode).',
    fix: "Check the proxy's certificate; Codebook never bypasses certificate checks.",
    sideEffects: NOTHING_REACHED_A_SERVER,
  },
  'browser-certificate-untrusted': {
    observed:
      'The browser rejected the certificate of the origin (details.browserError) although the proof accepted it.',
    fix: 'Make the browser trust the same certificate issuer; some systems keep a separate browser trust store.',
    sideEffects: BROWSER_HANDSHAKE_FAILED,
  },
  'browser-certificate-rejected': {
    observed:
      'The browser rejected the certificate of the origin (details.browserError) although the proof accepted it.',
    fix: "Check the proxy's certificate in the browser; Codebook never bypasses certificate checks.",
    sideEffects: BROWSER_HANDSHAKE_FAILED,
  },
  'browser-address-mismatch': {
    observed:
      'A throwaway browser reached an address other than the one Codebook checked (details.address is the checked address, details.browserAddress the one the browser used).',
    fix: 'Let the browser reach your host name directly: add it to your system proxy bypass list.',
    sideEffects:
      "unknown: the throwaway browser's one request (no cookie) may have reached a responder Codebook does not control, and no operation was sent.",
  },
}

/**
 * Builds the `nextReverseProxy` key of `codebook://help/repository-browser`: how to run a Next app the learner opens through their own local reverse proxy (API 1.40).
 *
 * Why it exists: before API 1.40 such an app could run only at its dev server's localhost address, and a chat that meets a reverse proxy (an nginx or Caddy file, a host name in `allowedDevOrigins`) needs to know when to declare `reverseProxy`, how to find the origin and the port without guessing, what Codebook checks, what each refusal means and what stays outside the guarantee. Called by {@link nextHelp}, which serves its result as one key.
 *
 * @returns The section: `summary`, `whenToDeclare`, `findingTheOriginAndPort`, `configuration` (the example of {@link NEXT_REVERSE_PROXY_CONFIGURATION} and its note), `whatCodebookDoes`, `refusals` (one row per reason of {@link REVERSE_PROXY_REFUSAL_REASONS}), `signIn` and `limits`.
 * @example
 * nextReverseProxyHelp().refusals.reasons['not-loopback'].anchor // => 'codebook://help/repository-browser#not-loopback'
 */
function nextReverseProxyHelp() {
  return {
    anchor: packageRootAnchor('next-reverse-proxy'),
    minimumApi: REVERSE_PROXY_MINIMUM_API,
    summary:
      'A Next app the learner opens through their own local reverse proxy (nginx, Caddy or Traefik), at a host name such as https://app.example.test, runs with a version 3 next-dev-webpack configuration that declares reverseProxy: { origin, upstreamPort } (API 1.40 or later). Codebook starts next dev on upstreamPort, proves that the origin reaches that server and only this machine, and opens the entry at the origin.',
    whenToDeclare:
      "Declare reverseProxy only when the learner opens the app through a reverse proxy: they say so, or the repository shows it (a proxy configuration such as nginx.conf, a Caddyfile or Traefik files, a docker-compose file that runs a proxy, a host name in next.config allowedDevOrigins, setup notes that name a local host name). An app the learner opens directly at its dev server's http://localhost:<port> address never declares it. Do not declare it to reach a deployed site, a tunnel or another machine: Codebook refuses any host that does not resolve only to loopback addresses.",
    findingTheOriginAndPort:
      'What you find is a candidate, not a fact. 1. Origin: read the README and setup notes, the proxy and compose files, and next.config (allowedDevOrigins names a host but not its scheme or port). Read .env file key names only (AUTH_URL, NEXTAUTH_URL or NEXT_PUBLIC_*_URL show that the app expects another origin); never open or quote a value. 2. Port: the port the proxy forwards to on this machine (nginx proxy_pass, Caddy reverse_proxy, a Traefik service URL). The proxy\'s own files may lie outside the opened repository, and a proxy in a container may name a container service or host.docker.internal instead of a port on this machine. Do not assume it equals the dev script\'s port, Next\'s default port or the origin\'s port. 3. Ask the learner one question whenever the learner did not state both values in their own words, naming what you found: "I found <origin> and port <port> in <where>; is that the address you open the app at, and the port your local proxy forwards it to (the proxy_pass or reverse_proxy line)?" When you found nothing, ask: "Which address do you open the app at in the browser, and which port does your local proxy forward it to?" Ask for no certificate, password or file contents. 4. Before the start, tell the learner the origin and the port you will declare and that Codebook starts the development server on that port itself, so their own dev server must not be running on it. A port that is wrong costs a refused start with details.sideEffects none or unknown as the refusal says, not a broken run; the budget is two starts per learner request.',
    configuration: {
      example: NEXT_REVERSE_PROXY_CONFIGURATION,
      note: 'configuration.example is a complete version 3 next-dev-webpack configuration with a server stop in a Pages Router page and reverseProxy declared; the file, line and inspection are placeholders: replace them, the book and the hash with the app the question is about (copyFrom of serverRenderQuickStart), and the origin and upstreamPort with the learner\'s own answers. The origin is a scheme and a host (and a port when it is not 443 for https or 80 for http), never a path, query, fragment or credentials; upstreamPort is an integer from 1024 to 65535. reverseProxy is accepted on a version 3 next-dev-webpack configuration only, and reverseProxy beside library is refused. A host is letters, digits, hyphens and dots; a host named localhost or ending in .localhost, and an IP literal, are refused as origin. An http:// origin runs only with session: "fresh": a saved browser may switch the address to https (HSTS), which the run does not check. Declare the https:// origin your proxy serves, or session: "fresh" for a flow that needs no sign-in.',
    },
    whatCodebookDoes:
      "In order: (1) it resolves the origin's host through this machine's resolver; every address must be a loopback address (127.0.0.0/8 or ::1) and Codebook uses the first; (2) it refuses when that address and port are the ones the development server needs; (3) it starts next dev on upstreamPort, bound to 127.0.0.1; (4) it sends one proof request, a GET of an unguessable path, to the origin, only to the validated address, with no cookies, following no redirect, trusting only certificates the operating system trusts; the proof passes only when the answer carries a one-time value that only the server Codebook started knows; (5) it starts a throwaway browser with the same pin and checks, without any cookie, that it reaches that address and port and trusts the certificate; only then it opens the app's browser pinned the same way and loads the entry there. The proof request and the throwaway browser's one request (no cookie) are the only requests Codebook sends to the origin before the run's browser opens. The run resource's reverseProxy block reports state (resolving, proving, proved or refused), the address used and the proof time; applicationPortSource says the port was declared. While the state is resolving or proving, the run resource's message says so: read the run resource again and start no other run. A refusal is the run's error, with the reason and a Fix line.",
    refusals: {
      anchor: packageRootAnchor('REVERSE_PROXY_REFUSED'),
      code: 'REVERSE_PROXY_REFUSED',
      reasons: Object.fromEntries(
        REVERSE_PROXY_REFUSAL_REASONS.map((reason) => [
          reason,
          {
            anchor: packageRootAnchor(reason),
            ...REVERSE_PROXY_REFUSAL_ROWS[reason],
            recovery: REVERSE_PROXY_REFUSAL_RECOVERY[reason],
          },
        ]),
      ),
      portTaken:
        "A taken upstream port keeps Next's own port refusal; the learner stops the process the message names. The budget is two starts per learner request in total.",
    },
    signIn:
      "A root app's saved session of such a run is used and set up at the declared origin only. When the run answers SIGN_IN_REQUIRED, the editor's notice offers Set Up Saved Session… for that origin: relay the step to the learner as SIGN_IN_REQUIRED says, and never send them to the command palette for it. A Next app below the repository root keeps the existing limit: it uses no saved session, so only flows that need no sign-in run. The app's own sign-in settings (AUTH_URL or similar) must name the origin the learner opens; Codebook never changes the app's environment. When sign-in fails or loops at the origin, tell the learner the app's settings may still name another address. A saved session holds cookies by host name: one set up at localhost does not apply at the declared host, and one set up for the declared host also applies to that host on another port and to a Domain cookie's subdomains.",
    limits: [
      "The proof shows the proxy reaches the development server Codebook started at that moment. Codebook then trusts the whole origin, including paths the learner's proxy forwards to their own backend, which Codebook neither starts nor observes: a stop in that backend is not available, and the learner's backend must be running for operations that call it. Later changes to the proxy's routing are outside the guarantee.",
      'Loopback only: a proxy on another machine, a tunnel or a host that resolves elsewhere is refused. A host named localhost or ending in .localhost is refused: the browser resolves those names itself.',
      "Certificates are never bypassed: the operating system and the browser must both trust the proxy's certificate. Codebook does not start, configure or install the proxy, the certificate or the hosts entry.",
      "A system proxy, a PAC file or a VPN that routes the host elsewhere is refused before any browser of the run opens (browser-address-mismatch); the check covers the host and port a browser uses for Codebook's proof path at launch. Codebook asks the development server it started at its loopback address for its own readiness check, so an app that must see its public host name or https to answer at all can be refused there.",
      'Next 16.1 only warns about a host missing from allowedDevOrigins in next.config, and a later Next major blocks such dev requests; Codebook never edits next.config, so tell the learner to add the host when the page does not load. The hot-reload connection is not checked.',
      'An http:// origin runs only with session: "fresh": a saved browser may switch the address to https (HSTS), which the run does not check, so declare the https:// origin your proxy serves, or session: "fresh" for a flow that needs no sign-in.',
      'next-dev-webpack and configuration version 3 only; basePath and i18n stay refused.',
    ],
  }
}

/**
 * What each Next refusal code means, keyed by code so the compiler holds it complete; the help lists the codes in the order of {@link NEXT_REFUSAL_CODES}, never in this record's.
 * Each text names fields and limits, never a value from a run.
 */
const NEXT_REFUSAL_MEANINGS: Record<NextRefusalCode, string> = {
  NEXT_UNSUPPORTED_SETTING:
    "Next's routes manifest names basePath or i18n routing (the message lists every one found, with the Next version); Codebook's browser run supports neither. A run that declares library can also be refused with this code when the preload did not take the redirect to the packed library (details.reason library-redirect-not-applied): the library section's own entry in nextQuickStart.library.refusals explains it.",
  NEXT_ENTRY_REDIRECTED:
    'The entry page did not stay at entryPath: the server answered a redirect, the loaded page ended at another path, the page router reports another route (a rewrite or middleware), or the path changed before the first input or before the click (also while the before conditions of the page were still awaited). The message names the final path without its origin and with query and fragment values redacted, or says the target is on another origin, which Codebook never fetches.',
  NEXT_ROUTE_NOT_COMPILED: `The development server answered, but the entry route did not appear in Next's route manifests within ${NEXT_MANIFEST_POLL_MS / MILLISECONDS_PER_SECOND} s, or no .next/dev manifests exist at all: Codebook reads the default .next/dev output, so a custom distDir is not supported. It also covers a listed Pages route whose page answered the entry request with a server error (HTTP 5xx): the page failed on the server, to build or to render. The message quotes the development server's output, masked.`,
  NEXT_ROUTE_CONFLICT:
    'Both the App and the Pages route manifests list the entry path with equally specific routes (a more specific route serves the path, as Next decides), or the more specific one has lost its source file; the message says stale when the source file of one of them is gone (a leftover .next/dev).',
  NEXT_ROUTE_NOT_FOUND: `No route matches the entry path, or the Pages route the manifest lists for it answered the entry request with a client error (HTTP 4xx: notFound, a path getStaticPaths does not return, or a page that needs a sign-in). The message names what was searched (Pages, App or both), the folders and the extensions tried (${PAGES_SOURCE_EXTENSIONS_TEXT}); a route the manifest lists with no source file means a custom pageExtensions, which Codebook does not read.`,
  NEXT_SERVER_ONLY_STOP:
    "The stop cannot be observed where it is declared; every refusal of a stop in a Pages run carries details.router pages. A browser stop (the default participant) in code established to run only on the server: _document, a file under pages/api (a server stop with afterOperation of 1 or more takes its place from API 1.29, apiRouteStops), or a line that maps in the page's server compile and in none of its client chunks (getServerSideProps or getStaticProps, for example); the message tells you to declare a data-function line with participant server in configuration version 3. A server stop (participant server) in _document: _document is not supported in this version, and the refusal comes before the development server starts (details.sideEffects none); a question about the page's data uses a server stop in the page's getServerSideProps or getStaticProps. In a workspace that holds both an app and a pages folder, this refusal comes before the entry route is resolved, so it claims no Pages run: it carries details.sideEffects none without details.router and points at no data function. A server stop in a configuration version 2 Pages run: the page's data functions and the code they call take a server stop only in version 3 (details.requiredVersion 3; serverRenderQuickStart.configurationPagesEntryRender, Codebook 0.2.74.0 and API 1.17 or later).",
  NEXT_STOP_NOT_SEALED:
    "Codebook could not verify the code of the stop before the browser opened. A browser stop: there is no verified browser mapping for its line (which does not establish that the code is server-only), or its module is loaded later (next/dynamic, for example). A server stop in a Pages run (details.router pages): the line is in the entry page's own module and its client compile maps it (details.reason client-component; declare it with participant browser, see serverRenderErrors), or neither the page's server compile nor the server chunks it loads hold the module, or it is no tracked workspace file (a module under node_modules or Next's own code), or the entry page's browser module could not be sealed to tell a data-function line from a page-component line. None of these establishes that the code never runs in the server. A run that declares library is refused with this code when a stop file lies in the declared library's own source (details.reason library-stop-unsupported), before anything starts and with no details.router: the library section's own entry in nextQuickStart.library.refusals explains it.",
  NEXT_SETUP_DEADLINE: `A Next run in a workspace with a Pages folder (pages/ or src/pages/) did not get ready within the ${REPOSITORY_SETUP_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s setup budget, ${NEXT_SETUP_DEADLINE_SCOPE}; once its entry path resolved as an App route, as in a workspace without a Pages folder, the deadline carries no Next code (the failure reads Repository setup deadline exceeded). The message names the step it reached and whether a browser was opened. The recovery the run gives fits that step: one retry before the browser or for a router that was late, a corrected entryPath for a page without a Next router, the input selector at the input step, one retry when the deadline came after every input was written and the first stop was being armed, and reading the captured history first when an input may have been written. Once Codebook's readiness request for the entry was sent, which runs the page's server code, the deadline also carries details.sideEffects unknown and details.readinessRequest (closed with outcome timeout when the deadline came before an answer), details.router pages once the entry resolved as a Pages route, and that recovery starts with asking the learner before another start when the page's server code writes or sends.`,
}

/**
 * Builds the Next part of `codebook://help/repository-browser`: a quick start with the prerequisites and call order, the Pages Router support table and one anchor per Next refusal code.
 *
 * Why it exists: an agent that meets a Next app, App Router or Pages Router, needs the minimal route, the stoppable code and the limits before it reads the long contract sections. Called by the resource reader for the repository-browser help, which spreads these keys after the Vite ones, as it does with {@link viteHelp}.
 *
 * @returns Keys to spread into the help object: `nextQuickStart`, `nextSupport`, `nextRefusals`, `nextPackageRoot` (the Next app below the repository root, API 1.18) and `nextReverseProxy` (the Next app behind the learner's own local proxy, API 1.40), `nextRefusals` being derived from {@link NEXT_REFUSAL_CODES} with each code's recovery from {@link ERROR_RECOVERY}.
 * @example
 * const help = { startHere: REPOSITORY_BROWSER_START_HERE, ...viteHelp(), ...nextHelp() }
 * help.nextRefusals.NEXT_ROUTE_NOT_FOUND.anchor // => 'codebook://help/repository-browser#NEXT_ROUTE_NOT_FOUND'
 */
export function nextHelp() {
  const setupSeconds = REPOSITORY_SETUP_TIMEOUT_MS / MILLISECONDS_PER_SECOND
  return {
    nextQuickStart: {
      summary:
        'For a Next 16 app, App Router or Pages Router: configure adapter "next-dev-webpack" and use the tools in this order. Use it when codebook_status reports profiles[].prerequisites.adapters["next-dev-webpack"].ready true; its routerKind names the routers the workspace holds. For a question about code that runs while the server renders an App Router page (API 1.16 or later), or about a Pages Router page\'s getServerSideProps or getStaticProps and the code they call (API 1.17 or later), read serverRenderQuickStart in this help instead of this configuration: it opens with the router choice. For a Next app below the repository root (API 1.18 or later) this version 1 configuration does not apply: read nextPackageRoot, whose examples are version 3 configurations that declare packageRoot.',
      prerequisites: [
        "Stop your own next dev for this workspace first: Codebook starts its own, and a .next/dev/lock another process holds refuses the start with PREREQUISITE_MISSING (Codebook never removes another process's lock).",
        'The dependencies are installed (node_modules/next; for an app below the repository root, the first node_modules/next from its folder up to the repository root, inside the repository); Codebook installs nothing.',
        'When the next-dev-webpack readiness reports preparation skipped (statements before next dev in package.json scripts.dev, a predev script, or the pre<name> script of a script that dev runs), the learner runs that preparation from the workspace root before the start: Codebook never runs it. The environment settings its notes name are not applied either.',
      ],
      configuration: NEXT_QUICK_START_CONFIGURATION,
      copyFrom: NEXT_QUICK_START_COPY_FROM,
      library: nextLibraryHelp(),
      callOrder: [
        `codebook_status: read profiles[].prerequisites.adapters["next-dev-webpack"] (ready, rootIsApp, routerKind, preparation, packages) and apply the selection rule; copy instanceId. ${NEXT_APP_SELECTION_RULE}`,
        'codebook://help/repository-browser (this help): read nextSupport for the code a stop can be in and nextRefusals for the codes a start can answer.',
        'codebook_sources, then codebook_source: read the file the stop is in; copy its path, full SHA-256 and the line and column from numberedText.',
        'codebook_publish_book: publish a source-only article whose node cites that file; copy bookId, revision and nodeId.',
        'codebook_start: profile repository-browser, the configuration above with the copied values and a stable key; the answer is a receipt with a run id, not success.',
        "Poll the run resource it names until the run reads ready, or a failed state with an error code; for a code in nextRefusals, follow that code's recovery.",
        'codebook_action repository-click: copy the run id and revision from the run resource (its nextActions), send it once with a stable action key.',
        'At each pause read inspectionUri and sourceUri, explain the values in the chat, then codebook_continue with the continueArguments of the current run resource.',
      ],
    },
    nextSupport: {
      supportedNext:
        'Next 16, whose development server writes the default .next/dev output.',
      pagesStops: [
        `The page module of the entry route, under pages/ or src/pages/ (pages/ wins when both exist), a ${PAGES_SOURCE_EXTENSIONS_TEXT} file.`,
        'A client component the page imports.',
        '_app (pages/_app or src/pages/_app).',
      ],
      pagesServerStops: [
        "A line inside the entry page's getServerSideProps or getStaticProps, or in a module they call (a helper, an API client, the handler a wrapper such as withSession returns): a stop with participant server in configuration version 3 (Codebook 0.2.74.0, API 1.17 or later; serverRenderQuickStart, whose router choice names this router's minimums). Under next dev, getStaticProps runs on each request of the page; a production build runs it at build or revalidation time.",
        "A line of the page component or of getInitialProps in the entry page is a browser stop (pagesStops), not a server stop: it also runs in the page's server render and in the browser, and a server stop there is refused with NEXT_STOP_NOT_SEALED (details.reason client-component). The rule is any line of the entry page's own module that the page's client compile maps, which includes a helper or a constant in the page file that the component uses; such a helper takes a server stop once it lives in its own module.",
      ],
      notStoppable: [
        "Pages server-side code no stop can pause in this version: _document, and, for a server stop, getStaticPaths, a page that sets runtime: 'experimental-edge' and _app (serverRenderQuickStart). A browser stop there is refused with NEXT_SERVER_ONLY_STOP when Codebook establishes that it runs only on the server (the file is _document or under pages/api, or the line maps in the page's server compile and in none of its client chunks, getServerSideProps or getStaticProps for example, also when client code follows the line, which the stop is never moved to), otherwise with NEXT_STOP_NOT_SEALED. A server stop (participant server) in _document is refused with NEXT_SERVER_ONLY_STOP before the development server starts (in a workspace with both an app and a pages folder it names no router, since the entry route is not known yet); a server stop in a version 2 Pages run is refused with NEXT_SERVER_ONLY_STOP naming configuration version 3.",
        'A module loaded later, for example through next/dynamic: it is not in the chunks Codebook seals before the browser opens (NEXT_STOP_NOT_SEALED).',
        "Server components and server-side code outside the supported ones (serverRenderQuickStart): server code of other routes than the entry route, middleware or proxy. A route handler (route.ts) in an App Router run takes a server stop from API 1.28 when afterOperation is 1 or more (routeHandlerStops), and a Pages API route (pages/api) from API 1.29 under the same rule (apiRouteStops). A server component of the entry route is supported when the stop is in code that runs on every render (API 1.16); a stop in a client component is refused with NEXT_STOP_NOT_SEALED (details.reason client-component). A Pages page's data functions are supported from API 1.17 (pagesServerStops).",
      ],
      compatibility: NEXT_WEBPACK_COMPATIBILITY_SENTENCE,
      preparation:
        'Codebook starts next dev --webpack itself and never runs scripts.dev: statements before next dev (and a predev script, or the pre<name> script of a script that dev runs through npm run, pnpm, yarn or bun run, when the package manager that runs it runs pre scripts: npm, Yarn 1 and Bun do, pnpm 9 or later by default, pnpm 7 and 8 only with enable-pre-post-scripts=true in an .npmrc, and Yarn 2 and later never) are skipped, and environment settings the script gives next dev are not applied (a PORT assignment only sets the port). codebook_status reports both on the next-dev-webpack readiness, only when there is something to report: preparation.status skipped with the statements count, or unknown for a script it could not read, preparation.envSettings with the names of the settings it does not apply, and notes that say the same in sentences (one more when a counted pre script may or may not run because the package manager or its version is unknown); values are never reported.',
      unsupported: [
        'basePath or i18n routing in next.config: refused with NEXT_UNSUPPORTED_SETTING; Codebook never edits next.config.',
        'A custom distDir: Codebook reads the default .next/dev output, so the route reads as not compiled (NEXT_ROUTE_NOT_COMPILED).',
        `A custom pageExtensions: page sources are found only as ${PAGES_SOURCE_EXTENSIONS_TEXT} files, so a route without such a file is refused with NEXT_ROUTE_NOT_FOUND.`,
      ],
      afterReadiness:
        "A refusal of the Pages entry that comes after Codebook's readiness request (NEXT_UNSUPPORTED_SETTING, NEXT_ENTRY_REDIRECTED, NEXT_ROUTE_NOT_COMPILED, which an HTTP 5xx answer of the page also raises, NEXT_ROUTE_CONFLICT or NEXT_ROUTE_NOT_FOUND) carries details.router pages and details.sideEffects unknown: that request ran the entry page's data function once, and the run resource's readinessRequest reads its status. When the data function writes or sends, ask the learner before another start. The one exception is a run that declares library: its NEXT_UNSUPPORTED_SETTING (library-redirect-not-applied) comes after the owned server starts and before any request, carries details.sideEffects partial and no details.router, and ran no data function.",
      fastRefresh:
        'Saving a change to a loaded module during a run (Fast Refresh) ends the run with SOURCE_CHANGED; the observations before it stay readable.',
      setupBudget: `Preparation has ${setupSeconds} s in all, with no override: starting Next, the entry page, the route manifests, sealing the stops, the browser and the page router. A Next run in a workspace with a Pages folder (pages/ or src/pages/) past it is refused with NEXT_SETUP_DEADLINE ${NEXT_SETUP_DEADLINE_SCOPE}; any other Next run past it fails with Repository setup deadline exceeded, with no Next code.`,
    },
    nextRefusals: Object.fromEntries(
      NEXT_REFUSAL_CODES.map((code) => [
        code,
        {
          anchor: nextHelpAnchor(code),
          meaning: NEXT_REFUSAL_MEANINGS[code],
          recovery: ERROR_RECOVERY[code],
        },
      ]),
    ),
    nextPackageRoot: nextPackageRootHelp(),
    nextReverseProxy: nextReverseProxyHelp(),
  }
}

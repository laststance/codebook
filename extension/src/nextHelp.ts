import {
  MILLISECONDS_PER_SECOND,
  NEXT_APP_SELECTION_RULE,
  NEXT_MANIFEST_POLL_MS,
  NEXT_PACKAGE_ROOT_ENVELOPE_SENTENCE,
  NEXT_PACKAGE_ROOT_MINIMUM_API,
  NEXT_PACKAGE_ROOT_MINIMUM_EXTENSION,
  NEXT_PAGES_SOURCE_EXTENSIONS,
  NEXT_SETUP_STEPS,
  NEXT_WEBPACK_COMPATIBILITY_SENTENCE,
  REPOSITORY_SETUP_TIMEOUT_MS,
} from './constants'
import { ERROR_RECOVERY } from './errors'
import {
  NEXT_REFUSAL_CODES,
  nextHelpAnchor,
  type NextRefusalCode,
} from './nextRefusals'

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
export const REPOSITORY_BROWSER_START_HERE = `Read codebook_status first: profiles[].prerequisites.adapters names the adapter that is ready for this workspace, and the next-dev-webpack readiness names routerKind (app, pages, both or none), rootIsApp and packages (the Next apps below the repository root). ${NEXT_APP_SELECTION_RULE} Then read the matching section of this help, nextQuickStart for a Next app (App Router or Pages Router) or viteQuickStart for a Vite app. For a flow of several steps (type, choose an option, click) or a secret typed by the learner, read operationsQuickStart (configuration version 3) after it. For code that runs on the server of a Next app (an App Router page's server render, or a Pages Router page's getServerSideProps or getStaticProps and the code they call), read serverRenderQuickStart, which opens with the router choice and each router's own minimums. For a Next app below the repository root, read nextPackageRoot (its examples, refusals and limits).`

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
 * The help anchor of one section of {@link nextPackageRootHelp}: `codebook://help/repository-browser#<id>`.
 * @param id - The section or reason id.
 * @returns The resource address with the id as its anchor.
 * @example packageRootAnchor('outside-package') // => 'codebook://help/repository-browser#outside-package'
 */
function packageRootAnchor(id: string): string {
  return `codebook://help/repository-browser#${id}`
}

/**
 * One refusal of a `packageRoot` run, keyed by the `details.reason` the error carries: the code it answers with, what it means and the fix the chat follows.
 * Keyed by reason so the compiler holds the table's entries uniform; {@link nextPackageRootHelp} serves them in this record's order.
 */
const PACKAGE_ROOT_REFUSALS = {
  'outside-repository': {
    code: 'INVALID_CONFIGURATION',
    meaning:
      'packageRoot resolves to a folder outside the opened repository (a ".." segment or an absolute path).',
    fix: 'Declare the folder as a repository-relative path inside the repository, copied from the packages entry the question is about or from details.suggestions. Nothing started (details.sideEffects none).',
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
    fix: 'Declare stops only in files inside details.packageRoot, or tell the learner that code outside the app folder cannot be observed in this version. Do not start another run with the same stops.',
  },
  'package-root-fresh-session': {
    code: 'SIGN_IN_REQUIRED',
    meaning:
      "A run below the repository root starts with a fresh browser and never loads the repository's saved sign-in session, which was set up for the root app, and the app asked for a sign-in.",
    fix: 'Do not set up a saved session: this app cannot sign in below the root in this version. Tell the learner so and offer a question about code that needs no sign-in.',
  },
} as const

/**
 * Builds the `nextPackageRoot` key of `codebook://help/repository-browser`: how to run a Next app that lives below the repository root (API 1.18).
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
      packages:
        'Array of the Next apps below the root that tracked package.json files name (depth 4 or less, at most 50): { packageRoot, routerKind, installed, ready, version?, missing[] }. packageRoot is the exact value to declare; ready and missing are what a start with that packageRoot checks. Entries carry no preparation or notes: a start reports them. Untracked apps are not listed.',
      packagesTruncated:
        'true when the list is incomplete; packagesTruncatedReason says why: limit (more than 50 apps), manifest-cap (more than 500 manifests), deadline (the 5 s discovery bound), skipped-path (a path was skipped) or git-failed.',
      whenTruncated:
        "When packagesTruncated is true and the app the question names is not listed, declare its packageRoot from the repository's files (the folder that holds its package.json); the start checks it, and an unlisted depth 5 or untracked folder runs when it passes.",
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
            'Not supported: a value other than "." is refused with INVALID_CONFIGURATION. Remove packageRoot; a Vite app runs at the repository root only.',
        },
      ],
    },
    savedSession:
      'A run with packageRoot other than "." never loads the repository\'s saved sign-in session and records no sign-in paths into it; the run resource reports savedSessionSkipped "package-root". An app that needs a sign-in cannot run below the root in this version (package-root-fresh-session).',
    studies:
      'A nested run is saved as study format 9 (.study.v9.json) with packageRoot in its configuration, so the saved study names the app that ran; recorded sources and book citations stay repository-relative. A run without packageRoot (or with ".") keeps the format it takes today. Codebook 0.2.74.0 lists a format 9 study as saved by a newer Codebook; update Codebook to open it. Format 9 replays from recorded evidence, also after the app\'s folder is removed.',
    limits: [
      NEXT_PACKAGE_ROOT_ENVELOPE_SENTENCE,
      "Library or shared packages the app imports (a workspace package Next compiles through transpilePackages) stay outside the stop range: a stop there is refused with NEXT_STOP_NOT_SEALED (outside-package), so a question whose answer needs that code is outside this version's claim.",
      "Next resolves as Node would from the app's folder: the first node_modules/next found from packageRoot up to the repository root, never above it, whose real path is inside the repository (a pnpm link into the root's node_modules/.pnpm and a hoisted workspace install qualify; Yarn PnP and NODE_PATH count as not installed). A missing Next names the install command of the repository's lockfile as the learner's decision; Codebook never runs it.",
      'One run at a time per window: a root run beside a nested run is refused with BUSY.',
    ],
  }
}

/**
 * What each Next refusal code means, keyed by code so the compiler holds it complete; the help lists the codes in the order of {@link NEXT_REFUSAL_CODES}, never in this record's.
 * Each text names fields and limits, never a value from a run.
 */
const NEXT_REFUSAL_MEANINGS: Record<NextRefusalCode, string> = {
  NEXT_UNSUPPORTED_SETTING:
    "Next's routes manifest names basePath or i18n routing (the message lists every one found, with the Next version); Codebook's browser run supports neither.",
  NEXT_ENTRY_REDIRECTED:
    'The entry page did not stay at entryPath: the server answered a redirect, the loaded page ended at another path, the page router reports another route (a rewrite or middleware), or the path changed before the first input or before the click (also while the before conditions of the page were still awaited). The message names the final path without its origin and with query and fragment values redacted, or says the target is on another origin, which Codebook never fetches.',
  NEXT_ROUTE_NOT_COMPILED: `The development server answered, but the entry route did not appear in Next's route manifests within ${NEXT_MANIFEST_POLL_MS / MILLISECONDS_PER_SECOND} s, or no .next/dev manifests exist at all: Codebook reads the default .next/dev output, so a custom distDir is not supported. It also covers a listed Pages route whose page answered the entry request with a server error (HTTP 5xx): the page failed on the server, to build or to render. The message quotes the development server's output, masked.`,
  NEXT_ROUTE_CONFLICT:
    'Both the App and the Pages route manifests list the entry path with equally specific routes (a more specific route serves the path, as Next decides), or the more specific one has lost its source file; the message says stale when the source file of one of them is gone (a leftover .next/dev).',
  NEXT_ROUTE_NOT_FOUND: `No route matches the entry path, or the Pages route the manifest lists for it answered the entry request with a client error (HTTP 4xx: notFound, a path getStaticPaths does not return, or a page that needs a sign-in). The message names what was searched (Pages, App or both), the folders and the extensions tried (${PAGES_SOURCE_EXTENSIONS_TEXT}); a route the manifest lists with no source file means a custom pageExtensions, which Codebook does not read.`,
  NEXT_SERVER_ONLY_STOP:
    "The stop cannot be observed where it is declared; every refusal of a stop in a Pages run carries details.router pages. A browser stop (the default participant) in code established to run only on the server: _document, a file under pages/api, or a line that maps in the page's server compile and in none of its client chunks (getServerSideProps or getStaticProps, for example); the message tells you to declare a data-function line with participant server in configuration version 3. A server stop (participant server) in a file under pages/api or in _document: API routes and _document are not supported in this version, and the refusal comes before the development server starts (details.sideEffects none); a question about the page's data uses a server stop in the page's getServerSideProps or getStaticProps. In a workspace that holds both an app and a pages folder, this refusal comes before the entry route is resolved, so it claims no Pages run: it carries details.sideEffects none without details.router and points at no data function. A server stop in a configuration version 2 Pages run: the page's data functions and the code they call take a server stop only in version 3 (details.requiredVersion 3; serverRenderQuickStart.configurationPagesEntryRender, Codebook 0.2.74.0 and API 1.17 or later).",
  NEXT_STOP_NOT_SEALED:
    "Codebook could not verify the code of the stop before the browser opened. A browser stop: there is no verified browser mapping for its line (which does not establish that the code is server-only), or its module is loaded later (next/dynamic, for example). A server stop in a Pages run (details.router pages): the line is in the entry page's own module and its client compile maps it (details.reason client-component; declare it with participant browser, see serverRenderErrors), or neither the page's server compile nor the server chunks it loads hold the module, or it is no tracked workspace file (a module under node_modules or Next's own code), or the entry page's browser module could not be sealed to tell a data-function line from a page-component line. None of these establishes that the code never runs in the server.",
  NEXT_SETUP_DEADLINE: `A Next run in a workspace with a Pages folder (pages/ or src/pages/) did not get ready within the ${REPOSITORY_SETUP_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s setup budget, ${NEXT_SETUP_DEADLINE_SCOPE}; once its entry path resolved as an App route, as in a workspace without a Pages folder, the deadline carries no Next code (the failure reads Repository setup deadline exceeded). The message names the step it reached and whether a browser was opened. The recovery the run gives fits that step: one retry before the browser or for a router that was late, a corrected entryPath for a page without a Next router, the input selector at the input step, one retry when the deadline came after every input was written and the first stop was being armed, and reading the captured history first when an input may have been written. Once Codebook's readiness request for the entry was sent, which runs the page's server code, the deadline also carries details.sideEffects unknown and details.readinessRequest (closed with outcome timeout when the deadline came before an answer), details.router pages once the entry resolved as a Pages route, and that recovery starts with asking the learner before another start when the page's server code writes or sends.`,
}

/**
 * Builds the Next part of `codebook://help/repository-browser`: a quick start with the prerequisites and call order, the Pages Router support table and one anchor per Next refusal code.
 *
 * Why it exists: an agent that meets a Next app, App Router or Pages Router, needs the minimal route, the stoppable code and the limits before it reads the long contract sections. Called by the resource reader for the repository-browser help, which spreads these keys after the Vite ones, as it does with {@link viteHelp}.
 *
 * @returns Keys to spread into the help object: `nextQuickStart`, `nextSupport`, `nextRefusals` and `nextPackageRoot` (the Next app below the repository root, API 1.18), `nextRefusals` being derived from {@link NEXT_REFUSAL_CODES} with each code's recovery from {@link ERROR_RECOVERY}.
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
        "Pages server-side code no stop can pause in this version: API routes (pages/api) and _document, and, for a server stop, getStaticPaths, a page that sets runtime: 'experimental-edge' and _app (serverRenderQuickStart). A browser stop there is refused with NEXT_SERVER_ONLY_STOP when Codebook establishes that it runs only on the server (the file is _document or under pages/api, or the line maps in the page's server compile and in none of its client chunks, getServerSideProps or getStaticProps for example, also when client code follows the line, which the stop is never moved to), otherwise with NEXT_STOP_NOT_SEALED. A server stop (participant server) in an API route or _document is refused with NEXT_SERVER_ONLY_STOP before the development server starts (in a workspace with both an app and a pages folder it names no router, since the entry route is not known yet); a server stop in a version 2 Pages run is refused with NEXT_SERVER_ONLY_STOP naming configuration version 3.",
        'A module loaded later, for example through next/dynamic: it is not in the chunks Codebook seals before the browser opens (NEXT_STOP_NOT_SEALED).',
        "Server components and server-side code outside the supported ones (serverRenderQuickStart): server code of other routes than the entry route, route handlers (route.ts), middleware or proxy. A server component of the entry route is supported when the stop is in code that runs on every render (API 1.16); a stop in a client component is refused with NEXT_STOP_NOT_SEALED (details.reason client-component). A Pages page's data functions are supported from API 1.17 (pagesServerStops).",
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
        "A refusal of the Pages entry that comes after Codebook's readiness request (NEXT_UNSUPPORTED_SETTING, NEXT_ENTRY_REDIRECTED, NEXT_ROUTE_NOT_COMPILED, which an HTTP 5xx answer of the page also raises, NEXT_ROUTE_CONFLICT or NEXT_ROUTE_NOT_FOUND) carries details.router pages and details.sideEffects unknown: that request ran the entry page's data function once, and the run resource's readinessRequest reads its status. When the data function writes or sends, ask the learner before another start.",
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
  }
}

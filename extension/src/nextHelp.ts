import {
  MILLISECONDS_PER_SECOND,
  NEXT_MANIFEST_POLL_MS,
  NEXT_PAGES_SOURCE_EXTENSIONS,
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
 * The first key of `codebook://help/repository-browser`: one sentence that sends an agent from `codebook_status` to the quick start of its app's adapter.
 * Served before both quick starts, so an agent reads it before either.
 */
export const REPOSITORY_BROWSER_START_HERE =
  'Read codebook_status first: profiles[].prerequisites.adapters names the adapter that is ready for this workspace, and the next-dev-webpack readiness names routerKind (app, pages, both or none); then read the matching section of this help, nextQuickStart for a Next app (App Router or Pages Router) or viteQuickStart for a Vite app.'

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
 * What each Next refusal code means, keyed by code so the compiler holds it complete; the help lists the codes in the order of {@link NEXT_REFUSAL_CODES}, never in this record's.
 * Each text names fields and limits, never a value from a run.
 */
const NEXT_REFUSAL_MEANINGS: Record<NextRefusalCode, string> = {
  NEXT_UNSUPPORTED_SETTING:
    "Next's routes manifest names basePath or i18n routing (the message lists every one found, with the Next version); Codebook's browser run supports neither.",
  NEXT_ENTRY_REDIRECTED:
    'The entry page did not stay at entryPath: the server answered a redirect, the loaded page ended at another path, the page router reports another route (a rewrite or middleware), or the path changed before the first input. The message names the final path without its origin and with query and fragment values redacted, or says the target is on another origin, which Codebook never fetches.',
  NEXT_ROUTE_NOT_COMPILED: `The development server answered, but the entry route did not appear in Next's route manifests within ${NEXT_MANIFEST_POLL_MS / MILLISECONDS_PER_SECOND} s, or no .next/dev manifests exist at all: Codebook reads the default .next/dev output, so a custom distDir is not supported. The message quotes the development server's output, masked.`,
  NEXT_ROUTE_CONFLICT:
    'Both the App and the Pages route manifests list the entry path; the message says stale when the source file of one of them is gone (a leftover .next/dev).',
  NEXT_ROUTE_NOT_FOUND: `No route matches the entry path. The message names what was searched (Pages, App or both), the folders and the extensions tried (${PAGES_SOURCE_EXTENSIONS_TEXT}); a route the manifest lists with no source file means a custom pageExtensions, which Codebook does not read.`,
  NEXT_SERVER_ONLY_STOP:
    "The stop is in code established to run only on the server: _document, a file under pages/api, or a line that maps in the page's server compile and in none of its client chunks (getServerSideProps or getStaticProps, for example).",
  NEXT_STOP_NOT_SEALED:
    'Codebook could not verify the browser code of the stop before the browser opened: there is no verified browser mapping for its line (which does not establish that the code is server-only), or its module is loaded later (next/dynamic, for example).',
  NEXT_SETUP_DEADLINE: `A Pages Router run did not get ready within the ${REPOSITORY_SETUP_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s setup budget; the message names the step it reached and whether a browser was opened. The recovery the run gives fits that step: one retry before the browser or for a router that was late, a corrected entryPath for a page without a Next router, the input selector at the input step, one retry when the deadline came after every input was written and the first stop was being armed, and reading the captured history first when an input may have been written.`,
}

/**
 * Builds the Next part of `codebook://help/repository-browser`: a quick start with the prerequisites and call order, the Pages Router support table and one anchor per Next refusal code.
 *
 * Why it exists: an agent that meets a Next app, App Router or Pages Router, needs the minimal route, the stoppable code and the limits before it reads the long contract sections. Called by the resource reader for the repository-browser help, which spreads these keys after the Vite ones, as it does with {@link viteHelp}.
 *
 * @returns Keys to spread into the help object: `nextQuickStart`, `nextSupport` and `nextRefusals`, the last derived from {@link NEXT_REFUSAL_CODES} with each code's recovery from {@link ERROR_RECOVERY}.
 * @example
 * const help = { startHere: REPOSITORY_BROWSER_START_HERE, ...viteHelp(), ...nextHelp() }
 * help.nextRefusals.NEXT_ROUTE_NOT_FOUND.anchor // => 'codebook://help/repository-browser#NEXT_ROUTE_NOT_FOUND'
 */
export function nextHelp() {
  const setupSeconds = REPOSITORY_SETUP_TIMEOUT_MS / MILLISECONDS_PER_SECOND
  return {
    nextQuickStart: {
      summary:
        'For a Next 16 app, App Router or Pages Router: configure adapter "next-dev-webpack" and use the tools in this order. Use it when codebook_status reports profiles[].prerequisites.adapters["next-dev-webpack"].ready true; its routerKind names the routers the workspace holds.',
      prerequisites: [
        "Stop your own next dev for this workspace first: Codebook starts its own, and a .next/dev/lock another process holds refuses the start with PREREQUISITE_MISSING (Codebook never removes another process's lock).",
        'The dependencies are installed (node_modules/next); Codebook installs nothing.',
        'When the next-dev-webpack readiness reports preparation skipped (statements before next dev in package.json scripts.dev, or a predev script), the learner runs that preparation from the workspace root before the start: Codebook never runs it. The environment settings its notes name are not applied either.',
      ],
      configuration: NEXT_QUICK_START_CONFIGURATION,
      copyFrom: NEXT_QUICK_START_COPY_FROM,
      callOrder: [
        'codebook_status: confirm profiles[].prerequisites.adapters["next-dev-webpack"].ready is true, read its routerKind and preparation; copy instanceId.',
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
      notStoppable: [
        "Server-side code of a Pages page: getServerSideProps, getStaticProps, API routes (pages/api) and _document. A stop there is refused with NEXT_SERVER_ONLY_STOP when Codebook establishes that it runs only on the server (the file is _document or under pages/api, or the line maps in the page's server compile and in none of its client chunks), otherwise with NEXT_STOP_NOT_SEALED.",
        'A module loaded later, for example through next/dynamic: it is not in the chunks Codebook seals before the browser opens (NEXT_STOP_NOT_SEALED).',
        'Server components of the App Router: they run only on the server.',
      ],
      compatibility: NEXT_WEBPACK_COMPATIBILITY_SENTENCE,
      preparation:
        'Codebook starts next dev --webpack itself and never runs scripts.dev: statements before next dev (and a predev script) are skipped, and environment settings the script gives next dev are not applied (a PORT assignment only sets the port). codebook_status reports both on the next-dev-webpack readiness, only when there is something to report: preparation.status skipped with the statements count, or unknown for a script it could not read, preparation.envSettings with the names of the settings it does not apply, and notes that say the same in sentences; values are never reported.',
      unsupported: [
        'basePath or i18n routing in next.config: refused with NEXT_UNSUPPORTED_SETTING; Codebook never edits next.config.',
        'A custom distDir: Codebook reads the default .next/dev output, so the route reads as not compiled (NEXT_ROUTE_NOT_COMPILED).',
        `A custom pageExtensions: page sources are found only as ${PAGES_SOURCE_EXTENSIONS_TEXT} files, so a route without such a file is refused with NEXT_ROUTE_NOT_FOUND.`,
      ],
      fastRefresh:
        'Saving a change to a loaded module during a run (Fast Refresh) ends the run with SOURCE_CHANGED; the observations before it stay readable.',
      setupBudget: `Preparation has ${setupSeconds} s in all, with no override: starting Next, the entry page, the route manifests, sealing the stops, the browser and the page router. A Pages Router run past it is refused with NEXT_SETUP_DEADLINE.`,
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
  }
}

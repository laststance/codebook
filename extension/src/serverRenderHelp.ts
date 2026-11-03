import { REPOSITORY_OPERATION_ACTION } from './constants'

/** The Codebook version and API that first serve server-render stops, as the migration table and the version check word them. */
const SERVER_RENDER_MINIMUM_EXTENSION = '0.2.73.0'
const SERVER_RENDER_MINIMUM_API = '1.16'

/**
 * A complete version 3 configuration for an App Router entry render: the stop sits in a server function that runs on every render of the entry route, `afterOperation` is 0 and `operations` is omitted (never `[]`).
 * The help serves it as `serverRenderQuickStart.entryRender`; a test parses it with the public version 3 schema so it cannot drift. Paths and lines come from the development target `nextjs-dashboard`; the book identity and the source hash are placeholders the agent replaces, as in the other quick starts.
 */
export const SERVER_RENDER_ENTRY_CONFIGURATION = {
  version: 3,
  adapter: 'next-dev-webpack',
  book: {
    bookId: 'my-article',
    revision: 1,
    nodeId: 'my-node',
    anchorIndex: 0,
  },
  source: {
    path: 'app/lib/data.ts',
    hash: '0000000000000000000000000000000000000000000000000000000000000000',
    line: 91,
    column: 5,
  },
  participant: 'server',
  afterOperation: 0,
  entryPath: '/dashboard',
  before: [{ kind: 'visible', selector: 'h1' }],
  after: [{ kind: 'text', selector: 'h1', equals: 'Dashboard' }],
  inspections: [{ path: 'numberOfInvoices', mode: 'value', required: true }],
} as const

/**
 * A complete version 3 configuration for a re-render observed after one operation: one `text` operation into the search box, a server stop in the page and a server stop in the data function, both `afterOperation: 1`.
 * Served as `serverRenderQuickStart.searchRerender` and parsed by the same test as {@link SERVER_RENDER_ENTRY_CONFIGURATION}.
 * Its run-level `after` is a shape example: it must hold only after the last operation, so it reads something only the searched state shows (here the search box's value attribute once the URL carries the query); a heading that is visible before the search would be refused with `INPUT_NOT_ACCEPTED`.
 */
export const SERVER_RENDER_SEARCH_CONFIGURATION = {
  version: 3,
  adapter: 'next-dev-webpack',
  book: {
    bookId: 'my-article',
    revision: 1,
    nodeId: 'my-node',
    anchorIndex: 0,
  },
  source: {
    path: 'app/dashboard/invoices/page.tsx',
    hash: '0000000000000000000000000000000000000000000000000000000000000000',
    line: 25,
    column: 3,
  },
  participant: 'server',
  afterOperation: 1,
  entryPath: '/dashboard/invoices',
  before: [
    { kind: 'visible', selector: 'input[placeholder="Search invoices..."]' },
  ],
  // Only the searched state writes the term into the search box's value attribute (the URL carries the query), so the condition cannot hold before the search.
  after: [
    {
      kind: 'attribute',
      selector: 'input[placeholder="Search invoices..."]',
      attribute: 'value',
      equals: 'paid',
    },
  ],
  operations: [
    {
      kind: 'text',
      title: 'Type the search term',
      selector: 'input[placeholder="Search invoices..."]',
      text: 'paid',
    },
  ],
  inspections: [{ path: 'query', mode: 'value', required: true }],
  additionalStops: [
    {
      participant: 'server',
      source: {
        path: 'app/lib/data.ts',
        hash: '0000000000000000000000000000000000000000000000000000000000000000',
        line: 154,
        column: 5,
      },
      anchorIndex: 1,
      inspections: [
        { path: 'query', mode: 'value', required: true },
        { path: 'data', mode: 'type', required: false },
      ],
      afterOperation: 1,
    },
  ],
} as const

/** Where each placeholder of the two server-render configurations is copied from. */
const SERVER_RENDER_COPY_FROM = {
  'book.bookId, book.revision, book.nodeId':
    'the answer of codebook_publish_book (the published article); book.anchorIndex is the index of the cited anchor in that node, and each additionalStops entry has its own anchorIndex',
  'source.path, source.hash (and each additionalStops[].source)':
    'the answer of codebook_sources lists the file and codebook_source answers its path and full SHA-256 (the same path and hash as the article cites)',
  'source.line, source.column':
    'one-based position in the numberedText of that codebook_source answer, inside the component or function that runs on every render',
  entryPath:
    'the path of the App Router page the question is about, as the browser address bar shows it',
  'operations[].selector':
    'a selector read from the source or the rendered page that matches exactly one visible enabled control',
  instanceId:
    'codebook_status (copy it into every later tool call; recopy it after a restart)',
} as const

/**
 * Builds the server-render part of `codebook://help/repository-browser` (API 1.16): the quick start with two complete version 3 configurations, the omitted-vs-`[]` rule, the call order by run state, the API check, the migration table, the limits and the anchors of the three codes a server-render run adds.
 *
 * Why it exists: an agent that meets an App Router question about code that runs while the server renders a page needs the supported code, the exact configuration shape (`afterOperation: 0`, omitted `operations`) and the failure meanings before it reads the long contract sections. Called by the resource reader for the repository-browser help, which spreads these keys after {@link nextHelp}.
 *
 * @returns Keys to spread into the help object: `serverRenderQuickStart`, `serverRenderMigration` and `serverRenderErrors`.
 * @example
 * const help = { ...nextHelp(), ...serverRenderHelp() }
 * help.serverRenderQuickStart.anchor // => 'codebook://help/repository-browser#server-render-quick-start'
 */
export function serverRenderHelp() {
  return {
    serverRenderQuickStart: {
      anchor: 'codebook://help/repository-browser#server-render-quick-start',
      summary: `For a Next 16 App Router question about code that runs while the server renders a page (a server component of the entry route, or a function it calls), configure adapter "next-dev-webpack" with configuration version 3 and a stop with participant "server". Use it only when codebook_status reports API ${SERVER_RENDER_MINIMUM_API} or later: compare the number after the dot as a whole number (1.16 is later than 1.9, and 1.10 is later than 1.9), and use none of these fields on an older API; tell the learner to update Codebook to ${SERVER_RENDER_MINIMUM_EXTENSION} or later, and never fall back to configuration version 2 for a server render.`,
      supportedCode:
        'The App Router server components of the entry route (the page, its layouts and the server components and functions they call), when the stop is in code that runs on every render. A page run observes only what the entry route renders.',
      whereToDeclareTheStop:
        "Declare the stop inside the component or function that runs on every render, never at module scope and never in a function whose result Next serves from a cache (use cache, unstable_cache): Next evaluates module-scope code once, during Codebook's own entry request, before the stop is armed.",
      afterOperationRule:
        'afterOperation: 0 means the entry load (the page load itself) and is allowed only for a stop with participant "server"; a browser stop still declares afterOperation from 1. A stop with afterOperation k from 1 is armed for the render observed after operation k.',
      omittedOperations:
        'When every stop has afterOperation 0, omit operations entirely. An empty operations array [] is refused with INVALID_CONFIGURATION naming the field operations. A run without operations needs no confirmation: the run resource reads confirmation: "not-needed" for a saved session too, because Codebook sends nothing that changes the app.',
      configurationEntryRender: SERVER_RENDER_ENTRY_CONFIGURATION,
      configurationSearchRerender: SERVER_RENDER_SEARCH_CONFIGURATION,
      entryRender:
        'configurationEntryRender: the stop pauses the render that serves the entry route on the page load (entry /dashboard, operations omitted, one server stop with afterOperation 0 in fetchCardData of app/lib/data.ts).',
      searchRerender: `configurationSearchRerender: entry /dashboard/invoices, one text operation into the search box, and server stops with afterOperation 1 in app/dashboard/invoices/page.tsx and in app/lib/data.ts. The render is sent with ${REPOSITORY_OPERATION_ACTION}; a stop pauses the render of the entry route that Codebook observed after operation 1.`,
      afterConditionRule:
        'The run-level after must hold only after the last operation: Codebook reads it just before that operation and refuses the run with INPUT_NOT_ACCEPTED (nothing is sent) when it already holds. For a search, check what only the searched state shows (the example reads the value attribute of the search box once the URL carries the query), never a heading or control the page shows before the search.',
      copyFrom: SERVER_RENDER_COPY_FROM,
      callOrder: [
        'codebook_status: confirm API 1.16 or later and that profiles[].configurationVersions lists 3 and the next-dev-webpack adapter is ready; copy instanceId. On an older API tell the learner to update Codebook; never use version 2 instead.',
        'codebook_sources, then codebook_source: read the file each stop is in; copy its path, full SHA-256 and the line and column from numberedText.',
        'codebook_publish_book: publish a source-only article whose node cites those files; copy bookId, revision and nodeId.',
        'codebook_start: profile repository-browser, one of the configurations above with the copied values and a stable key; the answer is a receipt with a run id, not success.',
        'Read the run resource it names and branch on its state. preparing: wait and poll. paused: read inspectionUri and sourceUri, explain the values in the chat, then codebook_continue with the current continueArguments. ready: follow nextActions (an operation left means repository-operation). failed: read the code and follow its recovery. complete: read the result.',
        'Each pause reads execution server-render, with attribution entry-load (the page load) or after-operation with operationIndex k, meaning the render was observed after operation k. attribution unconfirmed means Codebook could not read which route rendered: say so and claim neither an operation nor the entry load.',
        'Say only what the pauses show. When the run did not pause in a render, never describe that render; the run resource reads firstExecutionObserved false for a server stop, because the first execution (module evaluation, the first cache fill during the warm-up) was not observed.',
      ],
      wording:
        'after-operation is "observed after operation k". An operation is never said to cause a render; the unreached causes below are possibilities ("may"), never the established cause.',
      limits: [
        'Not supported: server-side code of a Pages Router page, other routes than the entry route, route handlers (route.ts), middleware or proxy, and Turbopack (Codebook always starts next dev --webpack, whatever the dev script says).',
        'A stop in a client component is refused with NEXT_STOP_NOT_SEALED (details.reason client-component); a render hit of another route is resumed and not counted.',
        'There is no timeout override: each wait is bounded at 20 s, restarting at each continue, and the pause hold and run deadline stay as they are. There is no attribution override: Codebook reads the rendering route itself.',
        'The first execution of a run-once module, and a cache fill during the warm-up, are not observed.',
      ],
    },
    serverRenderMigration: {
      anchor: 'codebook://help/repository-browser#server-render-migration',
      table: [
        {
          item: 'existing configurations (versions 1, 2 and 3 with browser stops)',
          change:
            'unchanged: they run and are saved as before; a version 3 study with browser stops only is still saved as format 7; every study saved before 0.2.73.0 still opens, including a format 7 study with a server-action stop',
        },
        {
          item: 'minimum for a server-render stop',
          change: `Codebook ${SERVER_RENDER_MINIMUM_EXTENSION} or later, MCP API ${SERVER_RENDER_MINIMUM_API} or later`,
        },
        {
          item: 'saved study of a server-render run',
          change:
            'format 8 (.study.v8.json): Codebook 0.2.72.0 does not open a format 8 study; update Codebook to open it',
        },
      ],
    },
    serverRenderErrors: {
      anchor: 'codebook://help/repository-browser#server-render-errors',
      codes: {
        SERVER_STOP_NOT_REACHED: {
          anchor: 'codebook://help/repository-browser#SERVER_STOP_NOT_REACHED',
          meaning:
            "A declared server stop did not pause: the entry render before the page load finished, or the render observed after its operation within 20 s. details.phase is entry-render or after-operation; pausedStops and notReachedStops list the stops. The stop may be in code that runs once (module scope, which Next evaluated during Codebook's own entry request before the stop was armed) or in a function whose result Next serves from a cache (use cache, unstable_cache); these are possibilities, not the established cause. Declare the stop inside the component or function that runs on every render.",
          recovery:
            'Move the stop into code that runs on every render and start a new run. A failure after an operation may have changed data: read sent and sideEffects, and never repeat the operation unless the learner asks.',
        },
        ENTRY_LOAD_TIMEOUT: {
          anchor: 'codebook://help/repository-browser#ENTRY_LOAD_TIMEOUT',
          meaning:
            'The entry page did not finish loading within the bound after the last stop paused (details.entryRoute, lastPausedStop, elapsedMs).',
          recovery:
            "Read the last paused stop, check that the route renders in the learner's own browser, and start a new run.",
        },
        NEXT_STOP_NOT_SEALED: {
          anchor: 'codebook://help/repository-browser#NEXT_STOP_NOT_SEALED',
          meaning:
            "For a server stop: the stop is in a client component (details.reason client-component, details.stop path:line), whose code Codebook cannot pause in the server render. In a Pages run (details.router pages) the same reason means the line is in the entry page's own module and its client compile maps it: the page component and getInitialProps lines also run in the page's server render and in the browser, where Codebook observes them. Nothing was sent and no browser stays open; in a Pages run the page's data function already ran once during Codebook's readiness request (details.sideEffects unknown).",
          recovery:
            'Move the stop to a server component or to a server function the page calls, or ask a client question with a browser stop. In a Pages run, declare the line with participant "browser" (a getInitialProps line pauses in the browser only after a client navigation), or for the page\'s data use a line of its getServerSideProps or getStaticProps.',
        },
      },
    },
  }
}

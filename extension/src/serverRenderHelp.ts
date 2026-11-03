import { REPOSITORY_OPERATION_ACTION } from './constants'

/** The Codebook version and API that first serve App Router server-render stops, as the migration table and the version check word them. */
const SERVER_RENDER_MINIMUM_EXTENSION = '0.2.73.0'
const SERVER_RENDER_MINIMUM_API = '1.16'
/** The Codebook version and API that first serve Pages Router data-function server stops (Cycle 0073): a Pages run is never checked against the App Router minimums above. */
const SERVER_RENDER_PAGES_MINIMUM_EXTENSION = '0.2.74.0'
const SERVER_RENDER_PAGES_MINIMUM_API = '1.17'

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

/**
 * A complete version 3 configuration for a Pages Router entry load: the stop sits on a line inside the entry page's `getServerSideProps`, `afterOperation` is 0 and `operations` is omitted (never `[]`).
 * Served as `serverRenderQuickStart.configurationPagesEntryRender` and parsed by the same test as {@link SERVER_RENDER_ENTRY_CONFIGURATION}. The path, the line and the inspection are neutral placeholders, not any project's file: a dynamic-route source needs a concrete `entryPath`, and the book identity and the source hash are placeholders the agent replaces, as in the other quick starts.
 */
export const SERVER_RENDER_PAGES_ENTRY_CONFIGURATION = {
  version: 3,
  adapter: 'next-dev-webpack',
  book: {
    bookId: 'my-article',
    revision: 1,
    nodeId: 'my-node',
    anchorIndex: 0,
  },
  source: {
    path: 'pages/products/[id].tsx',
    hash: '0000000000000000000000000000000000000000000000000000000000000000',
    line: 14,
    column: 5,
  },
  participant: 'server',
  afterOperation: 0,
  entryPath: '/products/1',
  before: [{ kind: 'visible', selector: 'h1' }],
  after: [{ kind: 'text', selector: 'h1', equals: 'Product' }],
  inspections: [{ path: 'productId', mode: 'value', required: true }],
} as const

/** Where each placeholder of the three server-render configurations is copied from. */
const SERVER_RENDER_COPY_FROM = {
  'book.bookId, book.revision, book.nodeId':
    'the answer of codebook_publish_book (the published article); book.anchorIndex is the index of the cited anchor in that node, and each additionalStops entry has its own anchorIndex',
  'source.path, source.hash (and each additionalStops[].source)':
    'the answer of codebook_sources lists the file and codebook_source answers its path and full SHA-256 (the same path and hash as the article cites); a Pages Router page is under pages/ or src/pages/',
  'source.line, source.column':
    "one-based position in the numberedText of that codebook_source answer: for an App Router page, inside the component or function that runs on every render; for a Pages Router page, inside the entry page's getServerSideProps or getStaticProps or in a module they call",
  entryPath:
    'the path of the page the question is about, as the browser address bar shows it: an App Router page, or a Pages Router route (pages/index.tsx is "/"); a dynamic-route source such as pages/products/[id].tsx needs a concrete path such as "/products/1"',
  'operations[].selector':
    'a selector read from the source or the rendered page that matches exactly one visible enabled control',
  instanceId:
    'codebook_status (copy it into every later tool call; recopy it after a restart)',
} as const

/** How a Pages Router run reads the router choice, per `routerKind`; the Pages entries follow the quick start's own keys. */
const SERVER_RENDER_ROUTER_CHOICE = {
  read: 'codebook_status: profiles[].prerequisites.adapters["next-dev-webpack"].routerKind reads app, pages, both or none. Choose the router of the page the question is about and use only that router\'s entries in this quick start: the minimums, the stop rule and the configuration differ.',
  app: {
    when: 'routerKind app, or the question is about a file under app/ or src/app/',
    minimumExtension: SERVER_RENDER_MINIMUM_EXTENSION,
    minimumApi: SERVER_RENDER_MINIMUM_API,
    stopRule:
      'A stop with participant "server" inside a server component of the entry route or a function it calls, in code that runs on every render (whereToDeclareTheStop).',
    configurations: ['configurationEntryRender', 'configurationSearchRerender'],
  },
  pages: {
    when: 'routerKind pages, or the question is about a file under pages/ or src/pages/',
    minimumExtension: SERVER_RENDER_PAGES_MINIMUM_EXTENSION,
    minimumApi: SERVER_RENDER_PAGES_MINIMUM_API,
    stopRule:
      'A stop with participant "server" inside the entry page\'s getServerSideProps or getStaticProps, or in a module they call (pagesLineChoice). A line of the page component or of getInitialProps is a browser stop.',
    configurations: ['configurationPagesEntryRender'],
  },
  both: 'routerKind both: the page the question is about decides. A file under app/ or src/app/ is an App Router page, a file under pages/ or src/pages/ a Pages Router page; Codebook resolves entryPath to one of them as Next does (the more specific route serves the path).',
  none: 'routerKind none: the workspace holds no app/, src/app/, pages/ or src/pages/ folder, so no server stop applies.',
} as const

/** What the Pages quick start says about the code a Pages server stop does not pause in this version. */
const PAGES_NOT_PAUSED =
  "A Pages server stop does not pause, in this version: getStaticPaths (Next runs it apart from the page render), a page that sets runtime: 'experimental-edge', and _app. Such a stop ends not reached (SERVER_STOP_NOT_REACHED) or not sealed (NEXT_STOP_NOT_SEALED); a hit Codebook cannot attribute to the entry page's data function pauses at most as unconfirmed (pagesUnconfirmed), never as a confirmed data-function pause. A server stop in an API route (pages/api) or in _document is refused with NEXT_SERVER_ONLY_STOP before the development server starts."

/**
 * What a hit Codebook could not attribute means and what the chat does with it; shared by the quick start and the reason anchors.
 */
const PAGES_UNCONFIRMED =
  "A pause labelled attribution unconfirmed may come from the page's render rather than its data function. Explain its values as unconfirmed: say that the attribution is unconfirmed, never present the pause as the data function's, and never count it as proof that the data function ran there. The run resource's message says so with the reason, and the journal entry breakpoint.unconfirmed names it (reason no-async-chain, no-renderer-frame, route-unreadable, chain-incomplete with a cause, or verdict-error with a logId; see serverRenderErrors.pagesReasons). The replay of a saved study labels such a pause \"route not confirmed\" whatever its reason, because the saved study keeps the attribution and not the reason; the live run resource's message names the reason while the pause is held, and the journal entry breakpoint.unconfirmed keeps it. A pause is also unconfirmed when no frame of the stack names the page and only the browser's one outstanding page request (the application's own main-frame document or Next data request) is for the entry route (reason route-unreadable): the request is what the browser asked for, not proof that the paused work serves the entry page, because the entry page's data function can fetch another page of the same server. When every pause of a run is unconfirmed (attributionSummary.taken.frame and attributionSummary.taken.request are both 0 and unconfirmed is above 0), stop and tell the learner."

/**
 * Builds the server-render part of `codebook://help/repository-browser` (API 1.16 for App Router, 1.17 for Pages Router data functions): the quick start with its router choice and three complete version 3 configurations, the omitted-vs-`[]` rule, the call order by run state, the API check, the migration table, the limits and the anchors of the codes and reasons a server-render run adds.
 *
 * Why it exists: an agent that meets a Next question about code that runs while the server renders an App Router page, or about a Pages Router page's `getServerSideProps` or `getStaticProps`, needs the router's own minimums, the supported code, the exact configuration shape (`afterOperation: 0`, omitted `operations`) and the failure meanings before it reads the long contract sections. Called by the resource reader for the repository-browser help, which spreads these keys after {@link nextHelp}.
 *
 * @returns Keys to spread into the help object: `serverRenderQuickStart`, `serverRenderMigration` and `serverRenderErrors`.
 * @example
 * const help = { ...nextHelp(), ...serverRenderHelp() }
 * help.serverRenderQuickStart.anchor // => 'codebook://help/repository-browser#server-render-quick-start'
 * help.serverRenderQuickStart.routerChoice.pages.minimumApi // => '1.17'
 */
export function serverRenderHelp() {
  return {
    serverRenderQuickStart: {
      anchor: 'codebook://help/repository-browser#server-render-quick-start',
      routerChoice: SERVER_RENDER_ROUTER_CHOICE,
      summary: `For a Next 16 question about code that runs on the server, configure adapter "next-dev-webpack" with configuration version 3 and a stop with participant "server": for an App Router page, a server component of the entry route or a function it calls (Codebook ${SERVER_RENDER_MINIMUM_EXTENSION} or later, API ${SERVER_RENDER_MINIMUM_API} or later); for a Pages Router page, the entry page's getServerSideProps or getStaticProps or a module they call (Codebook ${SERVER_RENDER_PAGES_MINIMUM_EXTENSION} or later, API ${SERVER_RENDER_PAGES_MINIMUM_API} or later). Choose the router first (routerChoice), then check codebook_status against that router's minimum: compare the number after the dot as a whole number (1.17 is later than 1.9, and 1.10 is later than 1.9), use none of these fields on an older API, tell the learner to update Codebook to that router's extension minimum or later, and never fall back to configuration version 2 for a server stop.`,
      supportedCode: {
        app: 'The App Router server components of the entry route (the page, its layouts and the server components and functions they call), when the stop is in code that runs on every render. A page run observes only what the entry route renders.',
        pages:
          "The entry page's getServerSideProps and getStaticProps (under next dev, getStaticProps runs on each request) and the code they call: a function in the page, the function a wrapper such as withSession returns, a re-export, and a helper, an API client or a formatter in any tracked workspace module the page's server build holds. A page run observes only the entry page's data function.",
      },
      whereToDeclareTheStop:
        "App Router: declare the stop inside the component or function that runs on every render, never at module scope and never in a function whose result Next serves from a cache (use cache, unstable_cache): Next evaluates module-scope code once, during Codebook's own entry request, before the stop is armed. Pages Router: see pagesLineChoice.",
      afterOperationRule:
        'afterOperation: 0 means the entry load (the page load itself) and is allowed only for a stop with participant "server"; a browser stop still declares afterOperation from 1. A stop with afterOperation k from 1 is armed for the render observed after operation k (Pages Router: for the data function run after operation k, see pagesAfterOperation).',
      omittedOperations:
        'When every stop has afterOperation 0, omit operations entirely. An empty operations array [] is refused with INVALID_CONFIGURATION naming the field operations. A run without operations needs no confirmation: the run resource reads confirmation: "not-needed" for a saved session too, because Codebook sends nothing that changes the app.',
      configurationEntryRender: SERVER_RENDER_ENTRY_CONFIGURATION,
      configurationSearchRerender: SERVER_RENDER_SEARCH_CONFIGURATION,
      configurationPagesEntryRender: SERVER_RENDER_PAGES_ENTRY_CONFIGURATION,
      entryRender:
        'configurationEntryRender (App Router): the stop pauses the render that serves the entry route on the page load (entry /dashboard, operations omitted, one server stop with afterOperation 0 in fetchCardData of app/lib/data.ts).',
      searchRerender: `configurationSearchRerender (App Router): entry /dashboard/invoices, one text operation into the search box, and server stops with afterOperation 1 in app/dashboard/invoices/page.tsx and in app/lib/data.ts. The render is sent with ${REPOSITORY_OPERATION_ACTION}; a stop pauses the render of the entry route that Codebook observed after operation 1.`,
      pagesEntryRender:
        "configurationPagesEntryRender (Pages Router): entry /products/1, the concrete path of the dynamic route pages/products/[id].tsx, operations omitted, one server stop with afterOperation 0 on a line inside that page's getServerSideProps. The stop pauses when Next runs the data function for the browser's entry request. The path, the line and the inspection are placeholders, not a project's file: replace them, the book and the hash with the learner's page (copyFrom).",
      pagesLineChoice:
        "Pages Router: choose a line inside the entry page's getServerSideProps or getStaticProps, or in a module they call (a helper, an API client, the handler a wrapper such as withSession returns). A line of the page component or of getInitialProps is a browser stop: declare it with participant \"browser\" (a getInitialProps line pauses in the browser only after a client navigation, never at the entry load). The same holds for any other line of the entry page's own module that the page's client compile maps, such as a helper or a constant in the page file that the component uses; such a helper takes a server stop once it lives in its own module. A server stop on such a line is refused with NEXT_STOP_NOT_SEALED (details.reason client-component, details.router pages).",
      pagesAfterOperation:
        'Pages Router: operations, afterOperation k from 1 and the run-level after follow configurationSearchRerender and afterConditionRule. A Pages stop with afterOperation k pauses when operation k makes Next run the data function again, for example a click on a next/link to the same route with a new query, for which Next fetches /_next/data/<build>/<route>.json; under next dev that request runs getServerSideProps and also getStaticProps again. An operation that makes no such request of the entry route ends the run with SERVER_STOP_NOT_REACHED (details.phase after-operation).',
      pagesStaticProps:
        'Under next dev, which Codebook starts, getStaticProps runs on each request of the page, including the /_next/data request of a client navigation to the same route; a production build runs it at build or revalidation time. Describe a getStaticProps pause as what the development server does, never as what a production build does.',
      pagesReadinessRequest:
        "Pages Router: before it arms any stop, Codebook sends its own request to the entry path, which makes Next run the entry page's data function once. That run is not observed and not counted (executionIndex counts observed runs only). The run resource holds the request as readinessRequest: open (state open, sentAtMs) from the send, then closed (state closed) with the HTTP status (status; a 5xx, a redirect or a not-found answer included) or, when no status came, with outcome timeout, aborted or connection-lost (timeout when the 90 s setup deadline came before an answer, aborted when the run stopped first, connection-lost when the connection broke). The run's journal (eventsUri) holds one readiness.entry-request entry (sentAtMs and the status or outcome) when the request closes, before any stop is armed; the saved study holds neither. When a value can depend on an earlier request (a cache, a counter, a one-time initialisation), tell the learner that the data function ran once before the paused request. A data function with side effects runs once more than the learner's own request.",
      pagesSideEffects:
        "Pages Router: before codebook_start, when the entry page's data function or a function it visibly calls writes or sends (a database write, a counter, an email, a payment call), tell the learner that the run executes it at least twice (Codebook's readiness request and the entry request) and ask first. Not running is the only escape; the learner decides, and Codebook stores no consent. After the readiness request, a failure of a Pages run that reports details.sideEffects reports unknown, never none: the stop refusals, a refusal of the Pages entry (NEXT_UNSUPPORTED_SETTING, NEXT_ENTRY_REDIRECTED, NEXT_ROUTE_NOT_COMPILED, which an HTTP 5xx answer of the page also raises, NEXT_ROUTE_CONFLICT or NEXT_ROUTE_NOT_FOUND, each with details.router pages), SERVER_STOP_NOT_REACHED in both phases, ENTRY_LOAD_TIMEOUT and a failed operation. A refusal of a server stop in an API route or _document comes before the server starts and reports none. A readiness check that fails with an error of its own after the request was sent fails the run with RUNTIME_FAILED, details.sideEffects unknown and details.readinessRequest: no answer (connection-lost), or, in an App Router run, an answer that is not OK (Application root failed: <status>, or Selected application page failed or redirected: <status>). The 90 s setup deadline comes before the request's own time limit: a setup deadline after the request was sent, while it waits for the answer or after it, fails with NEXT_SETUP_DEADLINE (or with RUNTIME_FAILED and Repository setup deadline exceeded where the deadline carries no Next code) and also carries details.sideEffects unknown and details.readinessRequest (closed with outcome timeout when the deadline came before an answer), details.router pages once the entry resolved as a Pages route, and a recovery that asks the learner before another start. When the data function writes, offer one new start to the learner and never start again unasked.",
      pagesAttribution:
        "Pages Router: a confirmed pause names its data function in the run resource (observations[].dataFunction: getServerSideProps or getStaticProps, a live field the saved study does not hold), so say that the data function paused, not the page render. A Pages run that declares a server stop also names the Next version (nextVersion) and an attribution summary (attributionSummary: { taken: { frame, request }, unconfirmed, resumed: { <reason>: count } }): the pauses taken by the evidence that proved them (frame: the stack named the entry page; request stays 0, because the browser's outstanding page request alone never takes a pause), the pauses labelled unconfirmed, and the hits resumed by reason (other-route, outside-data-function or unattributed-resumed). Codebook takes a hit only inside the call Next's renderer makes to the entry page's data-function export, whatever module defines it (a function in the page, the function a wrapper returns, a re-export), and inside the code that call runs.",
      pagesResumedHits:
        "Pages Router: a hit inside another page's data function is resumed (journal breakpoint.other-route, with its route), a hit outside every data function, on positive evidence, is resumed (breakpoint.outside-data-function), and a hit whose page cannot be read while the browser shows another route is resumed (breakpoint.unattributed-resumed), unless the browser's one outstanding page request is for the entry route, which pauses it unconfirmed. None of the resumed hits counts for the stop. Each is counted per stop in details.resumedHits of SERVER_STOP_NOT_REACHED as [{ reason, route?, count }] (route only for other-route), and a stop that no counted hit reaches ends with SERVER_STOP_NOT_REACHED. A later hit of a stop that already paused (a second request that reaches the same line) is resumed as breakpoint.repeat-hit: it is neither the stop's pause nor a failure, and resumedHits does not count it. A stop whose resumed hits reach 500 is disarmed and the run ends with SERVER_STOP_NOT_REACHED, whose resumedHits count them all; the journal keeps only the first 100 entries of each event type. The not-reached message says the line may have run outside the entry page's data function only when the run resumed other-route or outside-data-function hits of that line (not for unattributed-resumed), because the verdict is a heuristic: say it that way, never that the line did.",
      pagesUnconfirmed: PAGES_UNCONFIRMED,
      afterConditionRule:
        'The run-level after must hold only after the last operation: Codebook reads it just before that operation and refuses the run with INPUT_NOT_ACCEPTED (nothing is sent) when it already holds. For a search, check what only the searched state shows (the example reads the value attribute of the search box once the URL carries the query), never a heading or control the page shows before the search.',
      copyFrom: SERVER_RENDER_COPY_FROM,
      callOrder: [
        `codebook_status: read profiles[].prerequisites.adapters["next-dev-webpack"].routerKind, choose the router (routerChoice), and confirm the API is at least that router's minimum (${SERVER_RENDER_MINIMUM_API} for an App Router page, ${SERVER_RENDER_PAGES_MINIMUM_API} for a Pages Router page), that profiles[].configurationVersions lists 3 and that the next-dev-webpack adapter is ready; copy instanceId. On an older API tell the learner to update Codebook; never use version 2 instead.`,
        'codebook_sources, then codebook_source: read the file each stop is in; copy its path, full SHA-256 and the line and column from numberedText.',
        'codebook_publish_book: publish a source-only article whose node cites those files; copy bookId, revision and nodeId.',
        'codebook_start (Pages Router: first apply pagesSideEffects, and ask the learner when the data function writes or sends): profile repository-browser, one of the configurations above with the copied values and a stable key; the answer is a receipt with a run id, not success.',
        'Read the run resource it names and branch on its state. preparing: wait and poll. paused: read inspectionUri and sourceUri, explain the values in the chat, then codebook_continue with the current continueArguments. ready: follow nextActions (an operation left means repository-operation). failed: read the code and follow its recovery. complete: read the result.',
        "Each pause reads execution server-render, with attribution entry-load (the page load) or after-operation with operationIndex k, meaning the render was observed after operation k. attribution unconfirmed means Codebook could not confirm the pause: for an App Router page it could not read which route rendered; for a Pages Router page the pause may come from the page's render rather than its data function (pagesUnconfirmed). Say so and claim neither an operation, nor the entry load, nor that the data function paused.",
        "Say only what the pauses show. When the run did not pause in a render, never describe that render; the run resource reads firstExecutionObserved false for a server stop, because the first execution (module evaluation, the first cache fill during the warm-up, a Pages run's readiness request) was not observed.",
      ],
      wording:
        'after-operation is "observed after operation k". An operation is never said to cause a render; the unreached causes below are possibilities ("may"), never the established cause.',
      limits: [
        'Not supported in either router: server-side code of other routes than the entry route, route handlers (route.ts), middleware or proxy, and Turbopack (Codebook always starts next dev --webpack, whatever the dev script says).',
        'App Router: a stop in a client component is refused with NEXT_STOP_NOT_SEALED (details.reason client-component); a render hit of another route is resumed and not counted.',
        PAGES_NOT_PAUSED,
        'There is no timeout override: each wait is bounded at 20 s, restarting at each continue, and the pause hold and run deadline stay as they are. There is no attribution override: Codebook reads the rendering route itself (a Pages run reads the data function from the paused stack).',
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
          item: 'minimum for an App Router server-render stop',
          change: `Codebook ${SERVER_RENDER_MINIMUM_EXTENSION} or later, MCP API ${SERVER_RENDER_MINIMUM_API} or later`,
        },
        {
          item: 'minimum for a Pages Router data-function server stop (live feature)',
          change: `Codebook ${SERVER_RENDER_PAGES_MINIMUM_EXTENSION} or later, MCP API ${SERVER_RENDER_PAGES_MINIMUM_API} or later; an older Codebook refuses a server stop in a Pages run with NEXT_SERVER_ONLY_STOP`,
        },
        {
          item: 'saved study of a server-render run',
          change:
            'format 8 (.study.v8.json): Codebook 0.2.72.0 does not open a format 8 study; update Codebook to open it',
        },
        {
          item: 'saved study of a Pages Router server run (saved-study compatibility)',
          change:
            'format 8, unchanged and with no new field: Codebook 0.2.73.2 or later opens and replays it with the recorded server values, and 0.2.73.2 is the supported rollback target (earlier versions do not mask saved debugger history when they serve it). Only starting such a run needs 0.2.74.0 and API 1.17',
        },
      ],
    },
    serverRenderErrors: {
      anchor: 'codebook://help/repository-browser#server-render-errors',
      codes: {
        SERVER_STOP_NOT_REACHED: {
          anchor: 'codebook://help/repository-browser#SERVER_STOP_NOT_REACHED',
          meaning:
            "A declared server stop did not pause: the entry render before the page load finished, or the render observed after its operation within 20 s. details.phase is entry-render or after-operation; pausedStops and notReachedStops list the stops. The stop may be in code that runs once (module scope, which Next evaluated during Codebook's own entry request before the stop was armed) or in a function whose result Next serves from a cache (use cache, unstable_cache); these are possibilities, not the established cause. Declare the stop inside the component or function that runs on every render. In a Pages run (details.router pages) these causes do not apply: the line did not run inside the entry page's data function for the observed request. details.resumedHits lists the hits Codebook resumed and did not count, as [{ reason, route?, count }] with reason other-route (and its route), outside-data-function or unattributed-resumed (an empty list when none was resumed); details.attributionMode reads async-chain; details.nextVersion names the Next version when it was readable. The message adds that the line may have run outside the entry page's data function only when the run resumed other-route or outside-data-function hits of that line. details.sideEffects is unknown in both phases: the data function ran during Codebook's readiness request and possibly during the entry request.",
          recovery:
            'Move the stop into code that runs on every render and start a new run. A failure after an operation may have changed data: read sent and sideEffects, and never repeat the operation unless the learner asks. In a Pages run: declare the stop on another line the data function runs for that request or in code it calls, or declare a browser stop for code the page component runs; details.sideEffects is unknown, so when the data function writes or sends, ask the learner before one new start and never start again unasked.',
        },
        ENTRY_LOAD_TIMEOUT: {
          anchor: 'codebook://help/repository-browser#ENTRY_LOAD_TIMEOUT',
          meaning:
            'The entry page did not finish loading within the bound after the last stop paused (details.entryRoute, lastPausedStop, elapsedMs). In a Pages run it also carries details.router pages and details.sideEffects unknown.',
          recovery:
            "Read the last paused stop, check that the route renders in the learner's own browser, and start a new run. In a Pages run details.sideEffects is unknown, because the page's data function ran during Codebook's readiness request (readinessRequest in the run resource) and possibly during the entry request: when it writes or sends, ask the learner before a new start and never start again unasked.",
        },
        NEXT_STOP_NOT_SEALED: {
          anchor: 'codebook://help/repository-browser#NEXT_STOP_NOT_SEALED',
          meaning:
            "For a server stop: the stop is in a client component (details.reason client-component, details.stop path:line), whose code Codebook cannot pause in the server render. In a Pages run (details.router pages) the same reason means the line is in the entry page's own module and its client compile maps it: the page component and getInitialProps lines also run in the page's server render and in the browser, where Codebook observes them. Nothing was sent and no browser stays open; in a Pages run the page's data function already ran once during Codebook's readiness request (details.sideEffects unknown).",
          recovery:
            'Move the stop to a server component or to a server function the page calls, or ask a client question with a browser stop. In a Pages run, declare the line with participant "browser" (a getInitialProps line pauses in the browser only after a client navigation), or for the page\'s data use a line of its getServerSideProps or getStaticProps.',
        },
      },
      pagesReasons: {
        anchor: 'codebook://help/repository-browser#pages-reasons',
        'other-route': {
          anchor: 'codebook://help/repository-browser#other-route',
          meaning:
            "Journal event breakpoint.other-route (with the route, read from pages-manifest.json) and a details.resumedHits reason: the hit's stack holds another page's data function, so Codebook resumed it and did not count it for the stop. A helper that two pages call can run for either; the stop pauses only inside the entry page's data function.",
        },
        'outside-data-function': {
          anchor: 'codebook://help/repository-browser#outside-data-function',
          meaning:
            "Journal event breakpoint.outside-data-function and a details.resumedHits reason: positive evidence that the hit ran outside every data function (the async chain was read to its end, holds a frame of Next's page renderer and no call of the entry page's getServerSideProps or getStaticProps; the page component's server render, _app, code no data function called). Codebook resumed it and did not count it. The verdict is a heuristic: the not-reached message says the line may have run outside the entry page's data function, never that it did.",
        },
        'readiness.entry-request': {
          anchor: 'codebook://help/repository-browser#readiness.entry-request',
          meaning:
            "The request Codebook sends to the entry path before it arms any stop, which makes Next run the entry page's data function (in an App Router run, its server components) once, unobserved and not counted. The run resource holds it as readinessRequest: state open with sentAtMs from the send, then state closed with status (the HTTP status, a 5xx, a redirect or a not-found answer included) or outcome timeout, aborted or connection-lost when no status came (timeout when the 90 s setup deadline came before an answer); the run's journal holds one readiness.entry-request entry (sentAtMs and the status or outcome) when it closes. A readiness check that fails with an error of its own after the request was sent fails the run with RUNTIME_FAILED, details.sideEffects unknown and details.readinessRequest: no answer (connection-lost), or, in an App Router run, an answer that is not OK (Application root failed: <status>, or Selected application page failed or redirected: <status>); a run the learner stopped (aborted) keeps its own error. A setup deadline after the request was sent, while it waits for the answer or after it, keeps its own code (NEXT_SETUP_DEADLINE, or RUNTIME_FAILED with Repository setup deadline exceeded where it carries no Next code) and carries details.sideEffects unknown and details.readinessRequest too, details.router pages once the entry resolved as a Pages route, and a recovery that starts with the question to the learner. Tell the learner, ask before another start, and never start again unasked. A Pages page that answers with a 5xx ends the run with NEXT_ROUTE_NOT_COMPILED (details.router pages, details.sideEffects unknown), quoting the development server's output. Mention the request when a value can depend on an earlier request (a cache, a counter, a one-time initialisation); a data function with side effects ran once more than the learner's own request.",
        },
        'no-async-chain': {
          anchor: 'codebook://help/repository-browser#no-async-chain',
          meaning:
            "Reason of the journal entry breakpoint.unconfirmed: the hit's event carried no async chain and its synchronous frames hold no call of the data function. Explain the values as unconfirmed (serverRenderQuickStart.pagesUnconfirmed).",
        },
        'no-renderer-frame': {
          anchor: 'codebook://help/repository-browser#no-renderer-frame',
          meaning:
            "Reason of the journal entry breakpoint.unconfirmed: no frame of Next's page renderer is in reach, or the renderer's code holds none of the call shapes Codebook knows, so recognition itself failed (for example after a Next change); in the second case the journal also holds one pages.renderer-unrecognised entry per run with the Next version. Codebook knows the renderer of Next 16.1.4 and 16.4.4. A hit like this is never reported as outside-data-function. Explain the values as unconfirmed (serverRenderQuickStart.pagesUnconfirmed).",
        },
        'route-unreadable': {
          anchor: 'codebook://help/repository-browser#route-unreadable',
          meaning:
            "The call of the data function was found but the page it renders could not be confirmed: no frame of the stack named it (no pathname, no page-module frame of the entry page), or the frame that names another page has no matching browser request. While the browser shows the entry route the hit pauses unconfirmed (reason route-unreadable in breakpoint.unconfirmed); it also pauses unconfirmed when the browser's one outstanding page request (the application's own main-frame document or Next data request) is for the entry route, because that request is what the browser asked for and not proof that the paused work serves the entry page (the entry page's data function can fetch another page of the same server). Otherwise Codebook resumes it (breakpoint.unattributed-resumed) so another page's request does not pause the learner. An unconfirmed pause is never proof.",
        },
        'unattributed-resumed': {
          anchor: 'codebook://help/repository-browser#unattributed-resumed',
          meaning:
            'Journal event breakpoint.unattributed-resumed and a details.resumedHits reason: the page a hit renders could not be read while the browser showed another route than the entry route, so Codebook resumed the hit and did not count it. The not-reached message does not say the line may have run outside the data function for this reason alone (see route-unreadable).',
        },
        'chain-incomplete': {
          anchor: 'codebook://help/repository-browser#chain-incomplete',
          meaning:
            'Reason of the journal entry breakpoint.unconfirmed: the async chain could not be read to its end, with a cause (also in that entry) of continuation-limit, fetch-failed or timeout; a stack trace id the debugger cannot resolve ends the chain as fetch-failed. An incomplete chain is never reported as outside-data-function. Explain the values as unconfirmed (serverRenderQuickStart.pagesUnconfirmed).',
        },
        'verdict-error': {
          anchor: 'codebook://help/repository-browser#verdict-error',
          meaning:
            "Reason of the journal entry breakpoint.unconfirmed: the hit's event had an unexpected shape. Codebook writes one line to Output > Codebook with a log id, a shape summary without values and the Next version (Run <id>: a server hit could not be judged (event shape …; Next <version>) [log <logId>]), and the breakpoint.unconfirmed entry carries the same logId. Explain the values as unconfirmed, never as proof, do not repeat the same start, and give the learner the log id.",
        },
        'client-mapping-unverified': {
          anchor:
            'codebook://help/repository-browser#client-mapping-unverified',
          meaning:
            "Journal entry seal.evidence ({ stop, evidence }) for a stop on a line of the entry page's own module: the scan of the page's client compile stopped at its size limit, so whether the browser maps the line is unknown. Codebook accepted the stop; the run-time check still takes only data-function hits, so a page-component line armed this way ends not reached (its hit is resumed as outside-data-function), never paused as data.",
        },
        'breakpoint.repeat-hit': {
          anchor: 'codebook://help/repository-browser#breakpoint.repeat-hit',
          meaning:
            "Journal event breakpoint.repeat-hit: a later hit of a stop that already paused (a second request that reaches the same line) was resumed; it is neither the stop's pause nor a failure, and details.resumedHits does not count it; the journal keeps only the first 100 entries of each event type.",
        },
        'pages.renderer-unrecognised': {
          anchor:
            'codebook://help/repository-browser#pages.renderer-unrecognised',
          meaning:
            "Journal event pages.renderer-unrecognised ({ nextVersion }), written once per run: the script Codebook takes for Next's page renderer holds none of the data-function call shapes it knows (the renderer of Next 16.1.4 and 16.4.4), so recognition itself failed, for example after a Next change. A hit with an async chain whose stack holds no data-function call then pauses unconfirmed with reason no-renderer-frame and is never resumed as outside-data-function. Explain such a pause as unconfirmed (serverRenderQuickStart.pagesUnconfirmed).",
        },
      },
    },
  }
}

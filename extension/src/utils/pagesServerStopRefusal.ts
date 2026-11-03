import { OPERATIONS_CONFIG_VERSION } from '../constants'
import type { StudyError } from '../errors'
import { nextRefusal, PAGES_STOP_REFUSAL_DETAILS } from '../nextRefusals'

import {
  PAGES_API_ROUTE_POINTER,
  PAGES_API_ROUTES_UNSUPPORTED,
  PAGES_DOCUMENT_UNSUPPORTED,
} from './nextServerOnlyStopMessage'
import { redactNextEntryPath } from './redactNextEntryPath'

/**
 * The recovery of a server stop refused before the development server started (an API route or `_document`): nothing ran, so the static recovery of the code, which says the server was started, would mislead.
 * It names fields, never values: a recovery override reaches MCP without the sanitizer.
 */
const LEXICAL_SERVER_STOP_RECOVERY =
  'Tell the learner that API routes and _document are not supported in this version. For a question about the page\'s data, declare the stop in the page\'s getServerSideProps or getStaticProps (configuration version 3, participant "server"). Never pick an unrelated stop to make a run succeed. Recovery: fix the configuration, then one new start. Nothing was started: no development server, no browser, no declared input and no click, so details.sideEffects is none. See codebook://help/repository-browser#NEXT_SERVER_ONLY_STOP.'

/** Why Codebook refused a declared `participant: "server"` stop of a Pages run; each variant names the stop as `<path>:<line>`. */
export type PagesServerStopRefusal =
  | {
      /** Refused before the development server started: the file is an API route or `_document`, where no server stop is valid in either router. */
      kind: 'lexical'
      place: string
      reason: 'api-route' | 'document'
    }
  | {
      /** The run is a configuration version 2 run, which has no `afterOperation` or entry-render stop. */
      kind: 'version-2'
      place: string
    }
  | {
      /** A line of the entry page's own module that the page's client compile maps (the page component, `getInitialProps`, a helper or constant of the page file the component uses), or whose breakpoint would be requested on such a line. */
      kind: 'client-component'
      place: string
    }
  | {
      /** Neither the page's server compile nor the server chunks it loads hold the stop's module. */
      kind: 'server-module-absent'
      place: string
      route: string
    }
  | {
      /** The entry page's browser module could not be sealed, so the client mapping of the line is not established. */
      kind: 'browser-module-absent'
      place: string
    }
  | {
      /** The stop's file is one Codebook never reads for a stop (`node_modules`, Next's own code, an untracked, hidden, sensitive-named, build-output or lockfile path). */
      kind: 'not-workspace-source'
      place: string
    }

/**
 * Builds the refusal of a server stop in a Pages run: its code, its message, the structured `details` and, for a refusal before the server started, its recovery.
 *
 * Why it exists: a server stop of a Pages run is accepted only on the entry page's data path, so each way a stop falls outside it needs its own words and fields (contract 2 of Cycle 0073): an agent reads `details.router: "pages"` to tell a Pages `client-component` refusal from the App Router one without parsing prose, `details.sideEffects` to know whether anything ran (the page's data function runs once during Codebook's readiness request, so every refusal after the server started reports `unknown`), and `details.requiredVersion` for a version 2 run. Called by the configured browser run before the server starts (the lexical refusal), by {@link sealDeclaredStop}'s Pages checks and by {@link sealPagesServerStop}.
 * @param refusal - Which refusal, with the stop's place (and the route for an absent server module).
 * @returns The error to throw: `NEXT_SERVER_ONLY_STOP` for the lexical and version 2 refusals, `NEXT_STOP_NOT_SEALED` for the rest.
 * @example
 * throw pagesServerStopRefusal({ kind: 'lexical', place: 'src/pages/api/hello.ts:3', reason: 'api-route' })
 * // code NEXT_SERVER_ONLY_STOP, details { router: 'pages', sideEffects: 'none' }
 * throw pagesServerStopRefusal({ kind: 'client-component', place: 'src/pages/index.tsx:2' })
 * // code NEXT_STOP_NOT_SEALED, details { reason: 'client-component', stop: 'src/pages/index.tsx:2', router: 'pages', sideEffects: 'unknown' }
 */
export function pagesServerStopRefusal(
  refusal: PagesServerStopRefusal,
): StudyError {
  switch (refusal.kind) {
    case 'lexical':
      return nextRefusal(
        'NEXT_SERVER_ONLY_STOP',
        refusal.reason === 'api-route'
          ? `Declared stop ${refusal.place} is a server stop in an API route. ${PAGES_API_ROUTES_UNSUPPORTED} ${PAGES_API_ROUTE_POINTER}`
          : `Declared stop ${refusal.place} is a server stop in the Pages _document file. ${PAGES_DOCUMENT_UNSUPPORTED}`,
        {
          details: { router: 'pages', sideEffects: 'none' },
          recovery: LEXICAL_SERVER_STOP_RECOVERY,
        },
      )
    case 'version-2':
      return nextRefusal(
        'NEXT_SERVER_ONLY_STOP',
        `Declared stop ${refusal.place} is a server stop (participant "server") in a Pages Router run declared with configuration version 2. The page's data functions (getServerSideProps, getStaticProps) and the code they call take a server stop only in configuration version ${OPERATIONS_CONFIG_VERSION}: declare the run as version ${OPERATIONS_CONFIG_VERSION}, as serverRenderQuickStart.configurationPagesEntryRender in codebook://help/repository-browser shows, which also names the extension and API versions it needs.`,
        {
          details: {
            ...PAGES_STOP_REFUSAL_DETAILS,
            requiredVersion: OPERATIONS_CONFIG_VERSION,
          },
        },
      )
    case 'client-component':
      return nextRefusal(
        'NEXT_STOP_NOT_SEALED',
        `Declared stop ${refusal.place} is in the entry page's own module, and the page's client compile maps the line: the page component and getInitialProps lines also run in the page's server render and in the browser, and Codebook observes them in the browser. Declare it with participant "browser". A getInitialProps line pauses in the browser only after a client navigation (an operation), never at the entry load. For the page's data, declare a server stop in its getServerSideProps or getStaticProps. A helper that the data function calls can take a server stop once it lives in its own module.`,
        {
          details: {
            reason: 'client-component',
            stop: refusal.place,
            ...PAGES_STOP_REFUSAL_DETAILS,
          },
        },
      )
    case 'server-module-absent':
      return nextRefusal(
        'NEXT_STOP_NOT_SEALED',
        `Codebook could not find the module of ${refusal.place} in the server compile of the page ${redactNextEntryPath(refusal.route)} or in the server chunks it loads, so it cannot seal a server stop there before the browser opens. This does not establish that the code never runs in the server (a module loaded later, for example through a dynamic import, is not sealed). Declare the stop in a module that the data function imports statically, or in the data function itself.`,
        { details: PAGES_STOP_REFUSAL_DETAILS },
      )
    case 'browser-module-absent':
      return nextRefusal(
        'NEXT_STOP_NOT_SEALED',
        `Codebook could not verify the browser code of the page that holds ${refusal.place}, which it needs to tell a data-function line from a page-component line. This does not establish that the line is in the page's data function. A stop in a module that the data function imports, instead of the page's own file, needs no browser check: declare it there.`,
        { details: PAGES_STOP_REFUSAL_DETAILS },
      )
    case 'not-workspace-source':
      return nextRefusal(
        'NEXT_STOP_NOT_SEALED',
        `Declared stop ${refusal.place} is in a file Codebook does not read for a stop (a module under node_modules, Next's own code, or an untracked, hidden, sensitive-named, build-output or lockfile path), so it cannot seal a server stop there. Declare the stop in a tracked source file of the project that the data function calls, or in the data function itself. This does not establish that the code never runs in the server.`,
        { details: PAGES_STOP_REFUSAL_DETAILS },
      )
  }
}

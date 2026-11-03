import type { NextServerOnlyReason } from './readNextServerOnlyReason'

/** The sentence every Pages refusal for an API route starts its limit with. */
export const PAGES_API_ROUTES_UNSUPPORTED =
  'API routes are not supported in this version.'

/** The sentence every Pages refusal for `_document` states as its limit. */
export const PAGES_DOCUMENT_UNSUPPORTED =
  '_document is not supported in this version.'

/** What a refusal for an API route offers instead (E1 of Cycle 0073): the page's data function is the supported server stop for a question about the page's data. */
export const PAGES_API_ROUTE_POINTER =
  'A question about the page\'s data can use a server stop (participant "server", configuration version 3) in the page\'s getServerSideProps or getStaticProps.'

/** Why a Pages line runs only on the server, as the refusal names it. */
const SERVER_ONLY_REASONS: Record<
  Extract<NextServerOnlyReason, { kind: 'server-only' }>['reason'],
  string
> = {
  document:
    'it is in the Pages _document file, which Next renders only on the server',
  'api-route': 'it is in an API route, which runs only on the server',
  'server-compile':
    "the line is compiled for the server only: the page's server compile maps it and the code the browser loads does not (for example getStaticProps or getServerSideProps)",
}

/** What to do about each reason: a data-function line has a supported stop, `_document` and an API route have none in this version. */
const SERVER_ONLY_NEXT_STEPS: Record<keyof typeof SERVER_ONLY_REASONS, string> =
  {
    document: PAGES_DOCUMENT_UNSUPPORTED,
    'api-route': `${PAGES_API_ROUTES_UNSUPPORTED} ${PAGES_API_ROUTE_POINTER}`,
    'server-compile':
      'Declare it with participant "server" in a configuration version 3 (a stop in the page\'s getServerSideProps or getStaticProps, or in the code they call); a version 2 configuration cannot declare it.',
  }

/**
 * Words a `NEXT_SERVER_ONLY_STOP` refusal for a declared Pages browser stop, naming the established reason and the way forward that fits it.
 *
 * Why it exists: the refusal is raised for a `_document` file or an API route before any chunk is read, and for a line only the server compile maps after the seal; each has a different next step. A data-function line is declared with `participant: "server"` in configuration version 3; `_document` is not supported in this version; an API route is not supported either, and its message points a question about the page's data at the page's data function. Called by the configured browser run for a Pages run.
 * @param place - The declared stop, `<path>:<line>`.
 * @param reason - The established reason ({@link readNextServerOnlyReason}, {@link nextServerOnlyFileReason}).
 * @returns The message, ending with what to do.
 * @example
 * nextServerOnlyStopMessage('src/pages/api/hello.ts:3', 'api-route')
 * // => 'Declared stop src/pages/api/hello.ts:3 cannot pause in the browser: it is in an API route, which runs only on the server. API routes are not supported in this version. A question about the page\'s data can use a server stop (participant "server", configuration version 3) in the page\'s getServerSideProps or getStaticProps.'
 */
export function nextServerOnlyStopMessage(
  place: string,
  reason: keyof typeof SERVER_ONLY_REASONS,
): string {
  return `Declared stop ${place} cannot pause in the browser: ${SERVER_ONLY_REASONS[reason]}. ${SERVER_ONLY_NEXT_STEPS[reason]}`
}

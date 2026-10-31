import type { NextServerOnlyReason } from './readNextServerOnlyReason'

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

/**
 * Words a `NEXT_SERVER_ONLY_STOP` refusal for a declared Pages stop, naming the established reason.
 *
 * Why it exists: the refusal is raised for a `_document` file or an API route before any chunk is read, and for a line only the server compile maps after the seal; both say the same thing about the stop. Called by the configured browser run for a Pages run.
 * @param place - The declared stop, `<path>:<line>`.
 * @param reason - The established reason ({@link readNextServerOnlyReason}, {@link nextServerOnlyFileReason}).
 * @returns The message, ending with what to do.
 * @example
 * nextServerOnlyStopMessage('src/pages/api/hello.ts:3', 'api-route')
 * // => 'Declared stop src/pages/api/hello.ts:3 cannot pause in the browser: it is in an API route, which runs only on the server. Move the stop to the client code of the page that serves the same question.'
 */
export function nextServerOnlyStopMessage(
  place: string,
  reason: keyof typeof SERVER_ONLY_REASONS,
): string {
  return `Declared stop ${place} cannot pause in the browser: ${SERVER_ONLY_REASONS[reason]}. Move the stop to the client code of the page that serves the same question.`
}

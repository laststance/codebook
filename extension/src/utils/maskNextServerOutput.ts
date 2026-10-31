import { NEXT_REDACTED_VALUE } from '../constants'

import { isSecretName } from './isSecretName'

/** A credential header and the rest of its line: `Set-Cookie:`, `Cookie:`, `Authorization:`, `Proxy-Authorization:`, also as a logged key (`'set-cookie': …`). */
const CREDENTIAL_HEADER =
  /\b((?:set-cookie|cookie|proxy-authorization|authorization)["']?[ \t]*[:=][ \t]*)[^\r\n]*/gi

/** A query parameter's value in a logged URL: after `?` or `&`, up to the next separator, blank or fragment. */
const QUERY_VALUE = /([?&][^\s=&#?]+=)[^\s&#]*/g

/** An assignment `NAME=value` whose value is quoted or runs to a blank, `&`, `;` or `,`. */
const ASSIGNMENT =
  /\b([A-Za-z_][A-Za-z0-9_.-]*)=("[^"\r\n]*"|'[^'\r\n]*'|[^\s&;,]*)/g

/**
 * Masks the values the shared redactor leaves in Next development-server output before a Pages refusal quotes it: credential header lines, query values in logged URLs, and assignments whose name is a secret's ({@link isSecretName}, e.g. `API_KEY=`).
 *
 * Why it exists: {@link redactSecretText} masks Bearer tokens, JWTs, provider keys, URL passwords and PEM blocks, but no cookie value, no query value and no `NAME=value` pair, and a dev server prints all three. Called by the Pages run on the masked `outputTail()` it quotes in `NEXT_ROUTE_NOT_COMPILED`, and by the Next launcher on the output it journals for a workspace with a Pages folder. Only values are replaced; names stay so the learner can read what was printed.
 * @param text - Development-server output, already redacted by the shared redactor.
 * @returns The text with those values replaced by {@link NEXT_REDACTED_VALUE}.
 * @example
 * maskNextServerOutput('Set-Cookie: s=SECRET; Path=/\nGET /login?token=SECRET 200\nAPI_KEY=SECRET')
 * // => 'Set-Cookie: <redacted>\nGET /login?token=<redacted> 200\nAPI_KEY=<redacted>'
 */
export function maskNextServerOutput(text: string): string {
  return text
    .replace(CREDENTIAL_HEADER, `$1${NEXT_REDACTED_VALUE}`)
    .replace(QUERY_VALUE, `$1${NEXT_REDACTED_VALUE}`)
    .replace(ASSIGNMENT, (assignment, name: string) =>
      isSecretName(name) ? `${name}=${NEXT_REDACTED_VALUE}` : assignment,
    )
}

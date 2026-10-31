import { NEXT_REDACTED_VALUE } from '../constants'

import { isSecretName } from './isSecretName'

/** A credential header and the rest of its line: `Set-Cookie:`, `Cookie:`, `Authorization:`, `Proxy-Authorization:`, also as a logged key (`'set-cookie': …`). */
const CREDENTIAL_HEADER =
  /\b((?:set-cookie|cookie|proxy-authorization|authorization)["']?[ \t]*[:=][ \t]*)[^\r\n]*/gi

/** A query parameter's value in a logged URL: after `?` or `&`, up to the next separator, blank or fragment. */
const QUERY_VALUE = /([?&][^\s=&#?]+=)[^\s&#]*/g

/** A whole run of name characters (`A-Z`, `a-z`, `0-9`, `_`, `.`, `-`) followed by `=`: it starts only where no name character comes before it, so a long dotted run without `=` is scanned once, not once per word in it. */
const NAME_RUN_BEFORE_EQUALS = /(?<![\w.-])([\w.-]+)=/g

/** Where an assignment's name starts inside such a run: at its first letter or `_` that opens the run or follows a `.` or `-` (a word boundary there). */
const ASSIGNMENT_NAME = /(?:^|[.-])([A-Za-z_][\w.-]*)/

/** An assignment's value from its first character: quoted, or running to a blank, `&`, `;` or `,`. */
const ASSIGNMENT_VALUE = /"[^"\r\n]*"|'[^'\r\n]*'|[^\s&;,]*/y

/**
 * Replaces the value of each `NAME=value` assignment whose name is a secret's ({@link isSecretName}) in one pass over the text, keeping the name; called by {@link maskNextServerOutput}.
 *
 * The scan takes each run of name characters once, so a long dotted run without `=` (`a.a.a…`) costs linear time; the name is the run from its first word-boundary letter, as `\bNAME=` would find it, and each value is consumed, so `a=b=c` holds one assignment.
 * @param text - Development-server output.
 * @returns The text with secret-named values replaced by {@link NEXT_REDACTED_VALUE}.
 * @example
 * maskSecretAssignments('API_KEY=SECRET NODE_ENV=development') // => 'API_KEY=<redacted> NODE_ENV=development'
 * maskSecretAssignments('--token=SECRET')                      // => '--token=<redacted>'
 */
function maskSecretAssignments(text: string): string {
  const pieces: string[] = []
  let copiedUpTo = 0
  NAME_RUN_BEFORE_EQUALS.lastIndex = 0
  for (
    let run = NAME_RUN_BEFORE_EQUALS.exec(text);
    run !== null;
    run = NAME_RUN_BEFORE_EQUALS.exec(text)
  ) {
    const name = ASSIGNMENT_NAME.exec(run[1]!)?.[1]
    // A run with no name start (`9a=`) assigns nothing, so the text after its `=` is still searched for assignments.
    if (name === undefined) continue
    const valueStart = NAME_RUN_BEFORE_EQUALS.lastIndex
    ASSIGNMENT_VALUE.lastIndex = valueStart
    ASSIGNMENT_VALUE.exec(text)
    const valueEnd = ASSIGNMENT_VALUE.lastIndex
    // The value is consumed whatever the name, so an `=` inside it starts no second assignment.
    NAME_RUN_BEFORE_EQUALS.lastIndex = valueEnd
    if (!isSecretName(name)) continue
    pieces.push(text.slice(copiedUpTo, valueStart), NEXT_REDACTED_VALUE)
    copiedUpTo = valueEnd
  }
  pieces.push(text.slice(copiedUpTo))
  return pieces.join('')
}

/**
 * Masks the values the shared redactor leaves in Next development-server output before a Pages refusal quotes it: credential header lines, query values in logged URLs, and assignments whose name is a secret's ({@link isSecretName}, e.g. `API_KEY=`).
 *
 * Why it exists: {@link redactSecretText} masks Bearer tokens, JWTs, provider keys, URL passwords and PEM blocks, but no cookie value, no query value and no `NAME=value` pair, and a dev server prints all three. Called by the Pages run on the masked `outputTail()` it quotes in `NEXT_ROUTE_NOT_COMPILED`, and by the Next launcher on the output it journals for a workspace with a Pages folder. Only values are replaced; names stay so the learner can read what was printed. Every pattern runs in linear time, since the output is the server's and can hold any text.
 * @param text - Development-server output, already redacted by the shared redactor.
 * @returns The text with those values replaced by {@link NEXT_REDACTED_VALUE}.
 * @example
 * maskNextServerOutput('Set-Cookie: s=SECRET; Path=/\nGET /login?token=SECRET 200\nAPI_KEY=SECRET')
 * // => 'Set-Cookie: <redacted>\nGET /login?token=<redacted> 200\nAPI_KEY=<redacted>'
 */
export function maskNextServerOutput(text: string): string {
  return maskSecretAssignments(
    text
      .replace(CREDENTIAL_HEADER, `$1${NEXT_REDACTED_VALUE}`)
      .replace(QUERY_VALUE, `$1${NEXT_REDACTED_VALUE}`),
  )
}

import { NEXT_REDACTED_VALUE } from '../constants'

import { isSecretName } from './isSecretName'
import { redactedPairsOf } from './redactedPairsOf'

/** A credential header and the rest of its line: `Set-Cookie:`, `Cookie:`, `Authorization:`, `Proxy-Authorization:`, also as a logged key (`'set-cookie': …`). */
const CREDENTIAL_HEADER =
  /\b((?:set-cookie|cookie|proxy-authorization|authorization)["']?[ \t]*[:=][ \t]*)[^\r\n]*/gi

/** The query of a logged URL: in a word with a `/` before its first `?` (a path such as `/reset?…` or an absolute URL), the text after that `?` up to a blank or a fragment. Only a word's start begins a match, so a long word is scanned once; `user?.name` (no `/`) is no URL. */
const URL_QUERY = /(?<!\S)([^\s?#/]*\/[^\s?#]*\?)([^\s#]*)/g

/** Quotes, closing brackets and punctuation that log or JSON syntax puts right after a URL or a query value (`"…/reset?x"`, `{"url":"/a?x"}`, `(see /a?x)`): put back after the masked query or value, so a quoted secret around a URL keeps its closing quote and a padded token before them is still read as bare. Only the run at the very end is split off; a quote inside a value is masked with it. */
const TRAILING_CLOSERS = `"'\`)]},;.`

/** A query parameter's value anywhere else: after `?` or `&`, up to the next separator, blank or fragment. */
const QUERY_VALUE = /([?&][^\s=&#?]+=)([^\s&#]*)/g

/** A whole run of name characters (`A-Z`, `a-z`, `0-9`, `_`, `.`, `-`) followed by `=`: it starts only where no name character comes before it, so a long dotted run without `=` is scanned once, not once per word in it. */
const NAME_RUN_BEFORE_EQUALS = /(?<![\w.-])([\w.-]+)=/g

/** Where an assignment's name starts inside such a run: at its first letter or `_` that opens the run or follows a `.` or `-` (a word boundary there). */
const ASSIGNMENT_NAME = /(?:^|[.-])([A-Za-z_][\w.-]*)/

/** An assignment's value from its first character: quoted, or running to a blank, `&`, `;` or `,`. */
const ASSIGNMENT_VALUE = /"[^"\r\n]*"|'[^'\r\n]*'|[^\s&;,]*/y

/**
 * Replaces the value of each `NAME=value` assignment whose name is a secret's ({@link isSecretName}) in one pass over the text, keeping the name; called by {@link maskNextServerOutput}.
 *
 * The scan takes each run of name characters once, so a long dotted run without `=` (`a.a.a…`) costs linear time; the name is the run from its first word-boundary letter, as `\bNAME=` would find it. A secret's value is consumed whole, `=` included; a plain name's value is searched on, so a secret assignment a flag forwards (`--env=API_TOKEN=…`) is hidden too, and no value is read twice.
 * @param text - Development-server output.
 * @returns The text with secret-named values replaced by {@link NEXT_REDACTED_VALUE}.
 * @example
 * maskSecretAssignments('API_KEY=SECRET NODE_ENV=development') // => 'API_KEY=<redacted> NODE_ENV=development'
 * maskSecretAssignments('--token=SECRET')                      // => '--token=<redacted>'
 * maskSecretAssignments('--env=API_TOKEN=SECRET')              // => '--env=API_TOKEN=<redacted>'
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
    // A run with no name start (`9a=`) or a plain name hides nothing, so the text after its `=` is still searched for assignments.
    if (name === undefined || !isSecretName(name)) continue
    const valueStart = NAME_RUN_BEFORE_EQUALS.lastIndex
    ASSIGNMENT_VALUE.lastIndex = valueStart
    ASSIGNMENT_VALUE.exec(text)
    const valueEnd = ASSIGNMENT_VALUE.lastIndex
    // A secret's value is hidden whole, so an `=` inside it starts no second assignment.
    NAME_RUN_BEFORE_EQUALS.lastIndex = valueEnd
    pieces.push(text.slice(copiedUpTo, valueStart), NEXT_REDACTED_VALUE)
    copiedUpTo = valueEnd
  }
  pieces.push(text.slice(copiedUpTo))
  return pieces.join('')
}

/**
 * Splits the quotes, closing brackets and punctuation that end a logged URL's query or a query value ({@link TRAILING_CLOSERS}) off it, so `?dG9rZW4=")` reads as the padded token `dG9rZW4=` before `")`; called by {@link maskNextServerOutput} for each logged URL's query and each other query value.
 * A loop from the end, not a pattern, so a long run of such characters costs linear time.
 * @param pairs - The query text after a logged URL's `?`, or a query value.
 * @returns The text without its trailing closers, then those closers.
 * @example
 * splitTrailingClosers('dG9rZW4=")') // => ['dG9rZW4=', '")']
 * splitTrailingClosers('a=1')       // => ['a=1', '']
 */
function splitTrailingClosers(pairs: string): [string, string] {
  let pairsEnd = pairs.length
  // Each trailing closer is peeled once, from the end.
  while (pairsEnd > 0 && TRAILING_CLOSERS.includes(pairs[pairsEnd - 1]!))
    pairsEnd -= 1
  return [pairs.slice(0, pairsEnd), pairs.slice(pairsEnd)]
}

/**
 * Masks the values the shared redactor leaves in Next development-server output before a Pages refusal quotes it: credential header lines, query values in logged URLs (a bare query part such as `/reset?3f9ac0…` whole, {@link redactedPairsOf}), and assignments whose name is a secret's ({@link isSecretName}, e.g. `API_KEY=`).
 *
 * Why it exists: {@link redactSecretText} masks Bearer tokens, JWTs, provider keys, URL passwords and PEM blocks, but no cookie value, no query value and no `NAME=value` pair, and a dev server prints all three. Called by the Pages run on the masked `outputTail()` it quotes in `NEXT_ROUTE_NOT_COMPILED`, and by the Next launcher on the output it journals for a workspace with a Pages folder. Only values are replaced; names stay so the learner can read what was printed. Every pattern runs in linear time, since the output is the server's and can hold any text.
 * @param text - Development-server output, already redacted by the shared redactor.
 * @returns The text with those values replaced by {@link NEXT_REDACTED_VALUE}.
 * @example
 * maskNextServerOutput('Set-Cookie: s=SECRET; Path=/\nGET /login?token=SECRET 200\nAPI_KEY=SECRET')
 * // => 'Set-Cookie: <redacted>\nGET /login?token=<redacted> 200\nAPI_KEY=<redacted>'
 * maskNextServerOutput('GET /reset?3f9ac0d1e2b4 200') // => 'GET /reset?<redacted> 200'
 * maskNextServerOutput('{"url":"/verify?dG9rZW4="}')  // => '{"url":"/verify?<redacted>"}'
 */
export function maskNextServerOutput(text: string): string {
  return maskSecretAssignments(
    text
      .replace(CREDENTIAL_HEADER, `$1${NEXT_REDACTED_VALUE}`)
      .replace(URL_QUERY, (_query, beforeQuery: string, query: string) => {
        const [pairs, trailingClosers] = splitTrailingClosers(query)
        return `${beforeQuery}${redactedPairsOf(pairs)}${trailingClosers}`
      })
      .replace(
        QUERY_VALUE,
        (_part, name: string, value: string) =>
          `${name}${NEXT_REDACTED_VALUE}${splitTrailingClosers(value)[1]}`,
      ),
  )
}

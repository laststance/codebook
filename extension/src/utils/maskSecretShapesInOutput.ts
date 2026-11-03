import {
  AUTHORIZATION_CREDENTIAL_MIN_CHARS,
  REDACTION_MASK,
} from '../constants'

import { maskSecretRecordValues } from './maskSecretRecordValues'
import {
  isAuthorizationShape,
  isCookieHeaderShape,
  maskSecretUrlParts,
  maskShapedLiterals,
  type ShapedLiteralsResult,
} from './secretShapes'

/**
 * A credential header's label and what follows it up to its value: `Cookie:`, `Set-Cookie=`, `"authorization":`, `Proxy-Authorization:`, or only blanks (`cookie sid=…`), with an opening quote of the value in group 2 (empty when the value is bare).
 * The label alone proves a header, so the value is judged by its start ({@link startsWithCredential}), not as a whole.
 */
const CREDENTIAL_LABEL =
  /\b((?:proxy-)?authorization|(?:set-)?cookie)(?:["']?[ \t]*[:=][ \t]*|[ \t]+)(["']?)/gi

/** A cookie pair at the start of a value: an RFC 6265 name and its `=`; what follows it (more pairs, attributes, a trailing comment) is part of the header. */
const COOKIE_PAIR_START = /^[^\s=;,"'()<>@:\\/[\]?{}]+=/

/** An Authorization scheme and the start of its credential: Basic, Negotiate, NTLM or Token with a credential token of at least {@link AUTHORIZATION_CREDENTIAL_MIN_CHARS} characters, or Digest with its first `name=`. A `Bearer` value is left to {@link redactSecretText}, which masks its token and keeps the word. */
const AUTHORIZATION_START = new RegExp(
  `^(?:(?:basic|negotiate|ntlm|token)[ \\t]+[A-Za-z0-9._~+/=-]{${AUTHORIZATION_CREDENTIAL_MIN_CHARS},}|digest[ \\t]+[A-Za-z][\\w-]*=)`,
  'i',
)

/** A line that is exactly one `name=value` pair: group 1 is the name and its `=`. */
const SINGLE_PAIR = /^([^\s=;]+=)[^;]*$/

/** A `Bearer` value, which {@link redactSecretText} masks while it keeps the word. */
const BEARER_VALUE = /^bearer[ \t]/i

/** A line break, kept by `split` so the text can be joined again unchanged; a lone carriage return (a progress line, a terminal rewrite) starts a new line like `\n`. */
const LINE_BREAK = /(\r\n|\r|\n)/

/**
 * Tells whether the text after a Cookie or Authorization label starts like a credential.
 * Why: the label already proves a credential header, so one non-secret pair (`JSESSIONID=…`) or a trailing comment must not make the value readable; called by {@link maskLabelledCredentials} and by the output redactor to tell an over-long line that starts like a credential from a benign one.
 * @param value - The text after the label's separator, or a line without its indentation.
 * @returns `true` when it starts with a cookie pair, or with an Authorization scheme and its credential (not `Bearer`).
 * @example
 * startsWithCredential('JSESSIONID=ABCDEF0123456789') // => true
 * startsWithCredential('banner accepted') // => false
 */
export function startsWithCredential(value: string): boolean {
  return COOKIE_PAIR_START.test(value) || AUTHORIZATION_START.test(value)
}

/**
 * Finds where a quoted header value ends on its line.
 * @param line - The line.
 * @param valueStart - The index right after the value's opening quote.
 * @param quote - The opening quote character.
 * @returns The index of the closing quote, or the line's length when it has none; a backslash escapes the character after it.
 * @example endOfQuotedValue('cookie: "a=b" x', 9, '"') // => 12
 */
function endOfQuotedValue(
  line: string,
  valueStart: number,
  quote: string,
): number {
  for (let index = valueStart; index < line.length; index++) {
    if (line[index] === '\\') index++
    else if (line[index] === quote) return index
  }
  return line.length
}

/**
 * Masks the value of each labelled credential header on one line: from after the label to the closing quote of a quoted value, else to the line's end.
 * Why: a label such as `Cookie:` or `authorization` proves what follows is a credential, whatever its shape (a quoted Digest, a trailing comment, one `JSESSIONID=…` pair, a blank instead of `:`); called by {@link maskBareLine}.
 * @param line - One line without its break.
 * @param mask - What replaces a masked value.
 * @returns The line with each such value replaced by the mask; unchanged when it holds none.
 * @example
 * maskLabelledCredentials('Cookie: JSESSIONID=ABCDEF0123456789', '[masked]') // => 'Cookie: [masked]'
 * maskLabelledCredentials("cookie: 'sid=abc' ok", '[masked]') // => "cookie: '[masked]' ok"
 * maskLabelledCredentials('Cookie banner accepted', '[masked]') // => 'Cookie banner accepted'
 */
function maskLabelledCredentials(line: string, mask: string): string {
  let masked = '',
    copiedUntil = 0
  for (const label of line.matchAll(CREDENTIAL_LABEL)) {
    // A label inside a value that is already masked belongs to that value.
    if (label.index < copiedUntil) continue
    const valueStart = label.index + label[0].length
    if (!startsWithCredential(line.slice(valueStart))) continue
    const quote = label[2] ?? ''
    masked += line.slice(copiedUntil, valueStart) + mask
    copiedUntil = quote
      ? endOfQuotedValue(line, valueStart, quote)
      : line.length
  }
  return masked + line.slice(copiedUntil)
}

/**
 * Masks the credential on one line of output: the value of a labelled credential header, or a line that is a Cookie header or an Authorization value by itself.
 * Called by {@link maskSecretShapesInOutput} for each line.
 * @param line - One line without its break.
 * @param mask - What replaces a masked value.
 * @returns The line with the credential replaced by the mask; unchanged when it holds none. A line that is one secret-named assignment (`API_KEY=…`) keeps its name; the secret query and fragment values of a URL or path in any other line, also in a line that holds a labelled credential, are masked with the same mask.
 * @example
 * maskBareLine('Cookie: sid=abc; theme=dark', '[masked]') // => 'Cookie: [masked]'
 * maskBareLine('  Basic dXNlcjpwYXNz,', '[masked]') // => '  [masked],'
 * maskBareLine('API_KEY=abc', '[masked]') // => 'API_KEY=[masked]'
 */
function maskBareLine(line: string, mask: string): string {
  const labelled = maskLabelledCredentials(line, mask)
  // The text around a labelled value may hold a secret URL value too (`GET /cb?code=… cookie: sid=…`).
  if (labelled !== line) return maskSecretUrlParts(labelled, mask)
  // `console.log(req.headers.cookie)` prints the value alone, and a logged list ends its items with a comma.
  const trimmedEnd = line.trimEnd()
  const textStart = line.length - line.trimStart().length
  const textEnd = /[,;]$/.test(trimmedEnd)
    ? trimmedEnd.length - 1
    : trimmedEnd.length
  const text = line.slice(textStart, Math.max(textStart, textEnd))
  const kept = line.slice(0, textStart)
  const ending = line.slice(textEnd)
  if (isCookieHeaderShape(text)) {
    // One pair is an assignment such as `API_KEY=…`: its name stays readable, its value does not.
    const onlyPair = SINGLE_PAIR.exec(text)
    return `${kept}${onlyPair ? onlyPair[1] : ''}${mask}${ending}`
  }
  if (isAuthorizationShape(text) && !BEARER_VALUE.test(text))
    return `${kept}${mask}${ending}`
  // A request log prints the callback code or reset token of a path or a fragment in plain text.
  return maskSecretUrlParts(line, mask)
}

/**
 * Masks the Cookie, Authorization and flat-header-array shapes in development-server or test output, the shapes the replay capture masks in a saved value: a quoted element that is a Cookie header or an Authorization value, the element that directly follows a quoted secret header name (a logged `rawHeaders`, on the same line or the next, also when the list ends in `... more items`), a labelled credential header (also with a quoted Digest, a trailing comment, one non-secret cookie pair or a blank for its separator), a line that is such a value by itself, the `value` of a printed record named by a secret cookie name ({@link maskSecretRecordValues}), and the secret query and fragment values of a URL or path in a line; a carriage return breaks a line like a newline.
 * Why: a data function often logs the request; the shared redactor knows credential prefixes but not these shapes. Called by {@link createOutputRedactor} for each released run of lines and by {@link maskNextServerOutput}.
 * @param text - Output of one or more whole lines (the last may lack its break).
 * @param afterHeaderName - Whether the output before this text ended right after a quoted secret header name, so a list printed across writes keeps its pairing.
 * @param mask - What replaces a masked value; {@link REDACTION_MASK} unless the caller keeps another marker ({@link maskNextServerOutput}).
 * @param headerArrayDepth - How many `[` of a secret header name's value array the output before this text left open (the result's `headerArrayDepth`), so every element of an array printed across writes is masked up to its closing bracket.
 * @param listIndex - The position the first quoted element of this text takes in its list (the result's `listIndex`), so a list printed across writes keeps telling a header name at an even position from a value.
 * @returns The masked text, whether it ends right after a quoted secret header name, how many `[` of that name's array are still open, and the position the next quoted element takes.
 * @example
 * maskSecretShapesInOutput("[\n  'Host',\n  'x',\n  'Cookie',\n  'sid=abc',\n  ... 2 more items\n]").text // => "[\n  'Host',\n  'x',\n  'Cookie',\n  [masked],\n  ... 2 more items\n]"
 * maskSecretShapesInOutput('sid=abc; theme=dark\n').text // => '[masked]\n'
 */
export function maskSecretShapesInOutput(
  text: string,
  afterHeaderName = false,
  mask: string = REDACTION_MASK,
  headerArrayDepth = 0,
  listIndex: number | undefined = undefined,
): ShapedLiteralsResult {
  const shaped = maskShapedLiterals(
    maskSecretRecordValues(text, mask),
    afterHeaderName,
    mask,
    headerArrayDepth,
    listIndex,
  )
  return {
    // The split keeps each break at an odd index, so only the lines between them are judged.
    text: shaped.text
      .split(LINE_BREAK)
      .map((piece, index) =>
        index % 2 === 1 ? piece : maskBareLine(piece, mask),
      )
      .join(''),
    afterHeaderName: shaped.afterHeaderName,
    headerArrayDepth: shaped.headerArrayDepth,
    listIndex: shaped.listIndex,
  }
}

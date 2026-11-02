import { REDACTION_MASK } from '../constants'

import {
  isAuthorizationShape,
  isCookieHeaderShape,
  maskShapedLiterals,
  type ShapedLiteralsResult,
} from './secretShapes'

/** A credential header and its value on one line: `Cookie: …`, `Set-Cookie: …`, `Authorization: …`, `Proxy-Authorization: …`, also as a logged key (`cookie = …`). Group 2 is the value up to a quote or the line's end. */
const LABELLED_CREDENTIAL_HEADER =
  /\b((?:proxy-)?authorization|(?:set-)?cookie)(["']?[ \t]*[:=][ \t]*["']?)([^\r\n"']*)/gi

/** A line that is exactly one `name=value` pair: group 1 is the name and its `=`. */
const SINGLE_PAIR = /^([^\s=;]+=)[^;]*$/

/** A `Bearer` value, which {@link redactSecretText} masks while it keeps the word. */
const BEARER_VALUE = /^bearer[ \t]/i

/**
 * Masks the credential on one line of output: the value of a labelled credential header, or a line that is a Cookie header or an Authorization value by itself.
 * Called by {@link maskSecretShapesInOutput} for each line.
 * @param line - One line without its break.
 * @param mask - What replaces a masked value.
 * @returns The line with the credential replaced by the mask; unchanged when it holds none. A line that is one secret-named assignment (`API_KEY=…`) keeps its name.
 * @example
 * maskBareLine('Cookie: sid=abc; theme=dark', '[masked]') // => 'Cookie: [masked]'
 * maskBareLine('  Basic dXNlcjpwYXNz,', '[masked]') // => '  [masked],'
 * maskBareLine('API_KEY=abc', '[masked]') // => 'API_KEY=[masked]'
 */
function maskBareLine(line: string, mask: string): string {
  const labelled = line.replace(
    LABELLED_CREDENTIAL_HEADER,
    (whole, name: string, separator: string, value: string) => {
      const credential = value.trim()
      const isCredential = /cookie/i.test(name)
        ? isCookieHeaderShape(credential)
        : isAuthorizationShape(credential) && !BEARER_VALUE.test(credential)
      return isCredential ? `${name}${separator}${mask}` : whole
    },
  )
  if (labelled !== line) return labelled
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
  return isAuthorizationShape(text) && !BEARER_VALUE.test(text)
    ? `${kept}${mask}${ending}`
    : line
}

/**
 * Masks the Cookie, Authorization and flat-header-array shapes in development-server or test output, the shapes the replay capture masks in a saved value: a quoted element that is a Cookie header or an Authorization value, the element that directly follows a quoted secret header name (a logged `rawHeaders`, on the same line or the next, also when the list ends in `... more items`), a labelled credential header line, and a line that is such a value by itself.
 * Why: a data function often logs the request; the shared redactor knows credential prefixes but not these shapes. Called by {@link createOutputRedactor} for each released run of lines and by {@link maskNextServerOutput}.
 * @param text - Output of one or more whole lines (the last may lack its break).
 * @param afterHeaderName - Whether the output before this text ended right after a quoted secret header name, so a list printed across writes keeps its pairing.
 * @param mask - What replaces a masked value; {@link REDACTION_MASK} unless the caller keeps another marker ({@link maskNextServerOutput}).
 * @returns The masked text and whether it ends right after a quoted secret header name.
 * @example
 * maskSecretShapesInOutput("[\n  'Host',\n  'x',\n  'Cookie',\n  'sid=abc',\n  ... 2 more items\n]").text // => "[\n  'Host',\n  'x',\n  'Cookie',\n  [masked],\n  ... 2 more items\n]"
 * maskSecretShapesInOutput('sid=abc; theme=dark\n').text // => '[masked]\n'
 */
export function maskSecretShapesInOutput(
  text: string,
  afterHeaderName = false,
  mask: string = REDACTION_MASK,
): ShapedLiteralsResult {
  const shaped = maskShapedLiterals(text, afterHeaderName, mask)
  return {
    text: shaped.text
      .split('\n')
      .map((line) => maskBareLine(line, mask))
      .join('\n'),
    afterHeaderName: shaped.afterHeaderName,
  }
}

import {
  AUTHORIZATION_CREDENTIAL_MIN_CHARS,
  COLLAPSED_CLASS_NAMES,
  REDACTION_MASK,
} from '../constants'

import { isSecretName } from './isSecretName'
import { maskSecretFormPairs } from './maskSecretFormPairs'

/** Header names that hide their value although {@link isSecretName} reads them as plain words in some spellings; every one is also a secret name today, kept explicit so the rule survives a change of the word list. */
const SECRET_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'set-cookie',
  'cookie',
])

/** One cookie pair: a name of RFC 6265 token characters, `=`, and a value without blanks or semicolons. */
const COOKIE_PAIR = /^([^\s=;,"'()<>@:\\/[\]?{}]+)=([^\s;]*)$/

/** The attribute words of a `Set-Cookie` value that carry no `=`. */
const COOKIE_FLAG = /^(?:httponly|secure|partitioned)$/i

/** `<scheme> <credentials>`: Basic, Bearer, Negotiate, NTLM or Token in any letter case, then one token of credential characters. */
const AUTHORIZATION_CREDENTIAL = new RegExp(
  `^(?:basic|bearer|negotiate|ntlm|token)[ \\t]+[A-Za-z0-9._~+/=-]{${AUTHORIZATION_CREDENTIAL_MIN_CHARS},}$`,
  'i',
)

/** A `Bearer` credential: {@link redactSecretText} masks its token and keeps the word, so the literal masker leaves it to that shape. */
const BEARER_CREDENTIAL = /^bearer[ \t]/i

/** One `name=value` parameter of a Digest credential, the value bare or quoted. */
const DIGEST_PARAMETER = String.raw`[A-Za-z][\w-]*=(?:"[^"]*"|[^\s,"]+)`

/** `Digest` followed by comma-separated `name=value` parameters. */
const AUTHORIZATION_DIGEST = new RegExp(
  `^digest[ \\t]+${DIGEST_PARAMETER}(?:[ \\t]*,[ \\t]*${DIGEST_PARAMETER})*$`,
  'i',
)

/** A URL's or path's query: the text after a `?`, up to a blank, a fragment or a closing quote. */
const URL_QUERY = /\?([^\s#'"`]*)/g

/** The first identifier of a debugger's value preview, its class name (`Socket {…}`, `Array(4) […]`). */
const LEADING_IDENTIFIER = /^[A-Za-z_$][\w$]*/

/** Only blanks and commas between two quoted elements, or a `:` between a quoted key and its value: the second directly follows the first. */
const DIRECTLY_FOLLOWS = /^(?:[\s,]*|\s*:\s*)$/

/** The result of {@link maskShapedLiterals}. */
export type ShapedLiteralsResult = {
  /** The text with each credential-shaped quoted element masked. */
  text: string
  /** `true` when the text ends right after a quoted secret header name, so the next quoted element of the next chunk is its value. */
  afterHeaderName: boolean
}

/** A named sibling as the capture and the saved snapshot both know it: a variable's name and its value preview. */
export type SiblingEntry = { name: string; value: string }

/**
 * Tells whether a header name hides its value in a flat `[name, value, …]` array (`Cookie`, `Authorization`, `Proxy-Authorization`, `Set-Cookie`, `X-Api-Key`).
 * Why: Node's `rawHeaders` lists names and values as one flat array, so only the name before an element says what the element is; called by {@link findSecretSiblingIndexes} and {@link maskShapedLiterals}.
 * @param name - A header name in any letter case.
 * @returns `true` for a secret name or one of the credential headers.
 * @example
 * isSecretHeaderName('Set-Cookie') // => true
 * isSecretHeaderName('Host') // => false
 */
export function isSecretHeaderName(name: string): boolean {
  // A name has no blank: prose such as `invalid token` is no header.
  if (/\s/.test(name)) return false
  return isSecretName(name) || SECRET_HEADER_NAMES.has(name.toLowerCase())
}

/**
 * Tells whether a query parameter hides its value: a secret name, or `code`, the one-time value of an OAuth callback.
 * Called by {@link maskSecretUrlQueries}.
 * @param name - A decoded parameter name.
 * @returns `true` when the value must be masked.
 * @example
 * isSecretQueryParameter('code') // => true
 * isSecretQueryParameter('page') // => false
 */
function isSecretQueryParameter(name: string): boolean {
  return isSecretName(name) || name.toLowerCase() === 'code'
}

/**
 * Tells whether a string is a Cookie header: two or more `name=value` pairs joined by `;`, or one pair whose name is secret-named.
 * Why: an opaque session value is not recognisable by itself, but the header that carries it is; called by {@link maskShapedLiterals} and the output masking.
 * @param text - A whole string, without its quotes.
 * @returns `true` for `sid=abc; theme=dark`, `session=abc` and `sid=abc; Path=/; HttpOnly`; `false` for `theme=dark`, `page=2` and prose.
 * @example
 * isCookieHeaderShape('sid=abc; theme=dark') // => true
 * isCookieHeaderShape('theme=dark') // => false
 */
export function isCookieHeaderShape(text: string): boolean {
  const segments = text.split(';').map((segment) => segment.trim())
  // A trailing `;` leaves one empty segment.
  if (segments.at(-1) === '') segments.pop()
  let pairCount = 0,
    hasSecretNamedPair = false
  for (const segment of segments) {
    const pair = COOKIE_PAIR.exec(segment)
    if (pair) {
      pairCount++
      hasSecretNamedPair ||= isSecretName(pair[1] ?? '')
    }
    // A segment that is neither a pair nor a cookie attribute word is no cookie header.
    else if (!COOKIE_FLAG.test(segment)) return false
  }
  return pairCount >= 2 || (pairCount === 1 && hasSecretNamedPair)
}

/**
 * Tells whether a string is an Authorization header value: `<scheme> <credentials>` with the scheme Basic, Bearer, Negotiate, NTLM or Token in any letter case and one credential token of at least {@link AUTHORIZATION_CREDENTIAL_MIN_CHARS} characters, or `Digest` followed by `name=value` parameters.
 * Why: `Basic dXNlcjpwYXNz` carries a password but no word of a name or a provider prefix; prose such as `Token expired`, `Basic usage` and `Digest mismatch` must stay readable. Called by {@link maskShapedLiterals} and the output masking.
 * @param text - A whole string, without its quotes.
 * @returns `true` when the whole string has that shape.
 * @example
 * isAuthorizationShape('Basic dXNlcjpwYXNz') // => true
 * isAuthorizationShape('Token expired') // => false
 */
export function isAuthorizationShape(text: string): boolean {
  const trimmed = text.trim()
  return (
    AUTHORIZATION_CREDENTIAL.test(trimmed) || AUTHORIZATION_DIGEST.test(trimmed)
  )
}

/**
 * Masks the value of each secret query parameter (a secret name, or `code`) in a URL-shaped text, keeping the rest readable.
 * Why: `req.url`, `resolvedUrl` and a `referer` carry the callback code or the reset token of the request; called by {@link maskShapedLiterals}.
 * @param text - A URL, a path with a query, or text holding one.
 * @returns The text with each such value replaced by {@link REDACTION_MASK}; unchanged when it names none.
 * @example
 * maskSecretUrlQueries('/cb?code=abc&page=2') // => '/cb?code=[masked]&page=2'
 */
function maskSecretUrlQueries(text: string): string {
  return text.replace(
    URL_QUERY,
    (_query, pairs: string) =>
      `?${maskSecretFormPairs(pairs, isSecretQueryParameter)}`,
  )
}

/**
 * Takes the text out of a debugger's quoted string preview.
 * Called by {@link findSecretSiblingIndexes} to read a `name` or `key` member.
 * @param preview - A variable's value preview, such as `'sid'`.
 * @returns The text between the quotes, or `undefined` when the preview is no single quoted string.
 * @example
 * unquotePreviewString("'sid'") // => 'sid'
 * unquotePreviewString('{a: 1}') // => undefined
 */
export function unquotePreviewString(preview: string): string | undefined {
  const quote = preview[0]
  if (
    preview.length < 2 ||
    (quote !== "'" && quote !== '"' && quote !== '`') ||
    preview.at(-1) !== quote
  )
    return undefined
  const end = endOfLiteral(preview, 0)
  return end === preview.length ? preview.slice(1, -1) : undefined
}

/**
 * Finds where a quoted element that starts at `start` ends, on its own line.
 * @param text - The text.
 * @param start - The index of the opening quote.
 * @returns The index after the closing quote, or -1 when the line ends first (an apostrophe in prose opens no element). A single quote followed by a word character is an apostrophe and does not close.
 * @example endOfLiteral("'a\\'b', x", 0) // => 6
 */
function endOfLiteral(text: string, start: number): number {
  const quote = text[start]
  for (let index = start + 1; index < text.length; index++) {
    const character = text[index]
    if (character === '\\') index++
    // An apostrophe inside a word (`don't`) does not close an element.
    else if (
      character === quote &&
      !(quote === "'" && /\w/.test(text[index + 1] ?? ''))
    )
      return index + 1
    else if (character === '\n') return -1
  }
  return -1
}

/**
 * Masks a text that is, as a whole, a Cookie header or an Authorization value, or that holds a URL with secret query values.
 * Why: one decision for a quoted element of a preview ({@link maskedLiteral}) and for a string a fact or a saved study keeps without quotes ({@link maskFactString}); the predicates stay in this module. A `Bearer` credential is left to {@link redactSecretText}, which masks its token and keeps the word.
 * @param text - A whole string, without quotes.
 * @param mask - What replaces a whole credential; the capture's {@link REDACTION_MASK} unless a caller keeps another marker.
 * @returns `mask` for a Cookie-shaped or Authorization-shaped string; the text with each secret query value masked for a URL; the same text when it holds none.
 * @example
 * maskBareShape('sid=abc; theme=dark') // => '[masked]'
 * maskBareShape('/cb?code=abc&page=2') // => '/cb?code=[masked]&page=2'
 * maskBareShape('theme=dark') // => 'theme=dark'
 */
export function maskBareShape(
  text: string,
  mask: string = REDACTION_MASK,
): string {
  if (
    isCookieHeaderShape(text) ||
    (isAuthorizationShape(text) && !BEARER_CREDENTIAL.test(text.trim()))
  )
    return mask
  return maskSecretUrlQueries(text)
}

/**
 * Decides what a quoted element becomes: the mask for a value that follows a secret header name or shows a Cookie or Authorization shape, itself with its secret query values masked for a URL, or nothing for an element that holds no credential.
 * Called by {@link maskShapedLiterals}.
 * @param literal - The element with its quotes.
 * @param isValueOfHeaderName - Whether the element directly follows a quoted secret header name.
 * @param mask - What replaces a masked element.
 * @returns The replacement for the whole element, or `undefined` to keep it.
 * @example maskedLiteral("'sid=abc; theme=dark'", false) // => '[masked]'
 */
function maskedLiteral(
  literal: string,
  isValueOfHeaderName: boolean,
  mask: string,
): string | undefined {
  if (isValueOfHeaderName) return mask
  const inner = literal.slice(1, -1)
  const maskedInner = maskBareShape(inner, mask)
  if (maskedInner === inner) return undefined
  // A whole credential loses its quotes with its value; a URL keeps them around its readable rest.
  const quote = literal.charAt(0)
  return maskedInner === mask ? mask : `${quote}${maskedInner}${quote}`
}

/**
 * Masks every quoted element of a text that holds a credential: a Cookie header, an Authorization value, the element that follows a quoted secret header name (`['Cookie', 'sid=abc']`, a logged `rawHeaders`), and the secret query values of a quoted URL.
 * Why: one rule for a debugger's value preview and for a development server's output, so a credential reads the same masked wherever the capture, the history or the log shows it. Called by {@link redactValuePreview} and the output masking.
 * @param text - A preview or a text of one or more lines.
 * @param afterHeaderName - Whether the text before this one ended right after a quoted secret header name, so a stream split into chunks keeps the pairing.
 * @param mask - What replaces a masked element; the capture's {@link REDACTION_MASK} unless a caller keeps another marker.
 * @returns The masked text and whether it ends right after a quoted secret header name. A whole credential element becomes {@link REDACTION_MASK} with its quotes; a URL keeps everything but its secret values.
 * @example
 * maskShapedLiterals("['Host', 'x', 'Cookie', 'sid=abc']").text // => "['Host', 'x', 'Cookie', [masked]]"
 * maskShapedLiterals("{referer: '/cb?code=abc'}").text // => "{referer: '/cb?code=[masked]'}"
 */
export function maskShapedLiterals(
  text: string,
  afterHeaderName = false,
  mask: string = REDACTION_MASK,
): ShapedLiteralsResult {
  let masked = '',
    copiedUntil = 0,
    previousEnd = 0,
    awaitingValue = afterHeaderName
  for (let index = 0; index < text.length; index++) {
    const quote = text[index]
    if (quote !== "'" && quote !== '"' && quote !== '`') continue
    // A quote right after a word character is an apostrophe or a unit mark (`it's`, `5"`), not the start of an element.
    if (index > 0 && /\w/.test(text[index - 1] ?? '')) continue
    const end = endOfLiteral(text, index)
    if (end === -1) continue
    const literal = text.slice(index, end)
    const replacement = maskedLiteral(
      literal,
      awaitingValue && DIRECTLY_FOLLOWS.test(text.slice(previousEnd, index)),
      mask,
    )
    if (replacement !== undefined) {
      masked += text.slice(copiedUntil, index) + replacement
      copiedUntil = end
    }
    // A masked element is a value, never a header name.
    awaitingValue =
      replacement === undefined && isSecretHeaderName(literal.slice(1, -1))
    previousEnd = end
    // The loop's own increment steps past the element's last character.
    index = end - 1
  }
  return {
    text: masked + text.slice(copiedUntil),
    // The next chunk's first element is this one's value only when nothing but blanks and commas follows the name.
    afterHeaderName:
      awaitingValue && DIRECTLY_FOLLOWS.test(text.slice(previousEnd)),
  }
}

/**
 * Finds the siblings of one object, array or scope whose value a neighbour names as a secret.
 * Why: a cookie record `{name: 'sid', value: '…'}`, a Map entry `{key: 'session', value: '…'}` and a flat header array `['Cookie', 'sid=…']` carry the credential in a plainly named member, and only the neighbour says so. Called by the replay capture for each list of variables it reads, and by {@link maskSavedDebugSnapshot} for each list a saved snapshot holds.
 * @param entries - The siblings in order: a variable's name and its value preview.
 * @returns The positions of the siblings to mask: each `value` member beside a `name` or `key` member that holds a secret name, and each array element right after an element that holds a secret header name.
 * @example
 * findSecretSiblingIndexes([{ name: 'name', value: "'sid'" }, { name: 'value', value: "'abc'" }]) // => Set { 1 }
 * findSecretSiblingIndexes([{ name: '0', value: "'Cookie'" }, { name: '1', value: "'sid=abc'" }]) // => Set { 1 }
 */
export function findSecretSiblingIndexes(
  entries: readonly SiblingEntry[],
): Set<number> {
  const masked = new Set<number>()
  const namesASecret = entries.some((entry) => {
    const text = unquotePreviewString(entry.value)
    return (
      (entry.name === 'name' || entry.name === 'key') &&
      text !== undefined &&
      isSecretHeaderName(text)
    )
  })
  entries.forEach((entry, position) => {
    if (namesASecret && entry.name === 'value') masked.add(position)
    // A flat header array lists the name at one index and its value at the next.
    const next = entries[position + 1]
    const headerName = unquotePreviewString(entry.value)
    if (
      next !== undefined &&
      headerName !== undefined &&
      entry.name === String(position) &&
      next.name === String(position + 1) &&
      isSecretHeaderName(headerName)
    )
      masked.add(position + 1)
  })
  return masked
}

/**
 * Tells whether a debugger's variable is an instance of a class the capture never expands (the cookie and header stores, sockets and responses).
 * Called by {@link withheldVariableValue}.
 * @param variable - A variable's debugger type and value preview.
 * @returns `true` when its type or the class name its preview starts with is one of {@link COLLAPSED_CLASS_NAMES}.
 * @example isCollapsedClassName({ type: 'Socket', value: 'Socket {connecting: false}' }) // => true
 */
export function isCollapsedClassName(variable: {
  type?: string
  value: string
}): boolean {
  return (
    COLLAPSED_CLASS_NAMES.has(variable.type ?? '') ||
    COLLAPSED_CLASS_NAMES.has(
      LEADING_IDENTIFIER.exec(variable.value)?.[0] ?? '',
    )
  )
}

/**
 * Names the class of a debugger's variable: its type, else the identifier its preview starts with, else `Object`.
 * Why: a variable the capture withholds keeps only this name. Called by {@link withheldVariableValue} and {@link maskSavedDebugSnapshot}.
 * @param variable - A variable's debugger type and value preview.
 * @returns The class name.
 * @example classNameOf({ type: undefined, value: 'Socket {connecting: false}' }) // => 'Socket'
 */
export function classNameOf(variable: {
  type?: string | undefined
  value: string
}): string {
  const typed = variable.type?.trim()
  if (typed) return typed
  return LEADING_IDENTIFIER.exec(variable.value)?.[0] ?? 'Object'
}

import {
  AUTHORIZATION_CREDENTIAL_MIN_CHARS,
  COLLAPSED_CLASS_NAMES,
  REDACTION_MASK,
  REPLAY_DEBUG_TRUNCATION_MARKER,
  SECRET_SHAPE_SCAN_LIMIT_CHARS,
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

/** A header name written with hyphens (`X-Api-Key`, `x-auth-token`), the spelling of a custom credential header in a flat header list. */
const HYPHENATED_HEADER_NAME = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/

/** One cookie pair: a name of RFC 6265 token characters, `=`, and a value without blanks or semicolons. */
const COOKIE_PAIR = /^([^\s=;,"'()<>@:\\/[\]?{}]+)=([^\s;]*)$/

/** The attribute words of a `Set-Cookie` value that carry no `=`. */
const COOKIE_FLAG = /^(?:httponly|secure|partitioned)$/i

/** A `Set-Cookie` attribute with a value, read by its name: `Expires=Wed, 21 Oct 2025 07:28:00 GMT` holds blanks and a comma, so it is no pair. */
const COOKIE_ATTRIBUTE =
  /^(?:expires|max-age|domain|path|samesite|priority)[ \t]*=/i

/** The mark an adapter leaves where it trimmed a long text. */
const TRIM_MARK = '…'

/** `<scheme> <credentials>`: Basic, Bearer, Negotiate, NTLM or Token in any letter case, then one token of credential characters. Group 1 is the scheme, group 2 the token. */
const AUTHORIZATION_CREDENTIAL = new RegExp(
  `^(basic|bearer|negotiate|ntlm|token)[ \\t]+([A-Za-z0-9._~+/=-]{${AUTHORIZATION_CREDENTIAL_MIN_CHARS},})$`,
  'i',
)

/** The schemes whose credential is a base64 blob of any letters, so its length alone says it is no prose. */
const BASE64_CREDENTIAL_SCHEMES: ReadonlySet<string> = new Set([
  'negotiate',
  'ntlm',
])

/** What a credential token has that a plain word lacks: a digit, one of `_~+/=-`, or a `.` that does not just end a sentence (`Token generated.`). */
const CREDENTIAL_TOKEN_MARK = /[\d_~+/=-]|\.(?!\.*$)/

/** A `Bearer` credential: {@link redactSecretText} masks its token and keeps the word, so the literal masker leaves it to that shape. */
const BEARER_CREDENTIAL = /^bearer[ \t]/i

/** One `name=value` parameter of a Digest credential, the value bare or quoted. */
const DIGEST_PARAMETER = String.raw`[A-Za-z][\w-]*=(?:"[^"]*"|[^\s,"]+)`

/** `Digest` followed by comma-separated `name=value` parameters. */
const AUTHORIZATION_DIGEST = new RegExp(
  `^digest[ \\t]+${DIGEST_PARAMETER}(?:[ \\t]*,[ \\t]*${DIGEST_PARAMETER})*$`,
  'i',
)

/** A URL's or path's query: the text after a `?`, up to a blank, a fragment, a closing quote or the next `?` (`/login?next=/cb?code=abc` holds two queries). */
const URL_QUERY = /\?([^\s#'"`?]*)/g

/** A URL's fragment: the text after a `#`, up to a blank, a closing quote or the next `#`. */
const URL_FRAGMENT = /#([^\s#'"`]+)/g

/** The first identifier of a debugger's value preview, its class name (`Socket {…}`, `Array(4) […]`). */
const LEADING_IDENTIFIER = /^[A-Za-z_$][\w$]*/

/** What may stand between a quoted secret header name and its value: only blanks and commas (the next element of a flat list), or a `:` (a logged header object), then any number of `[` when the value is an array. */
const VALUE_GAP = /^(?:[\s,]*|\s*:\s*)(?:\[\s*)*$/

/** Only blanks and commas between two quoted elements: the second is the next element of the same list. */
const LIST_GAP = /^[\s,]*$/

/** The characters a list element or an object key can directly follow; after a `:` or `=>` a quoted element is a value. */
const ELEMENT_START_PREFIXES: ReadonlySet<string> = new Set(['[', '{', ','])

/** The result of {@link maskShapedLiterals}. */
export type ShapedLiteralsResult = {
  /** The text with each credential-shaped quoted element masked. */
  text: string
  /** `true` when the text ends right after a quoted secret header name (or inside the array that is its value), so the next quoted element of the next chunk is its value. */
  afterHeaderName: boolean
}

/** A stretch of a text and the text that replaces it. */
export type TextReplacement = { start: number; end: number; text: string }

/** A named sibling as the capture and the saved snapshot both know it: a variable's name and its value preview. */
export type SiblingEntry = { name: string; value: string }

/** What the scan of {@link findShapedLiterals} knows between two quoted elements. */
type PairingState = {
  /** The element just read was a secret header name, so its value may come next. */
  awaitingValue: boolean
  /** How many `[` opened after a secret header name are still open: its value is an array, and every quoted element inside it is a value. */
  arrayDepth: number
  /** The position of the element just read in the list whose `[` the text shows, or `undefined` when the text does not show where its list starts. A flat header list holds its names at even positions. */
  listIndex: number | undefined
}

/**
 * Tells whether a header name hides its value in a flat `[name, value, …]` array or a Map entry or a cookie record's `name` member (`Cookie`, `Authorization`, `Proxy-Authorization`, `Set-Cookie`, `X-Api-Key`, `JSESSIONID`).
 * Why: a `{name, value}` record names its cookie in a plain member, so any secret name counts there; called by {@link findSecretSiblingIndexes} and the preview rule for such records. A flat list uses the narrower {@link isCredentialHeaderName}.
 * @param name - A cookie or header name in any letter case.
 * @returns `true` for a secret name or one of the credential headers.
 * @example
 * isSecretHeaderName('Set-Cookie') // => true
 * isSecretHeaderName('JSESSIONID') // => true
 * isSecretHeaderName('Host') // => false
 */
export function isSecretHeaderName(name: string): boolean {
  // A name has no blank: prose such as `invalid token` is no header.
  if (/\s/.test(name)) return false
  return isSecretName(name) || SECRET_HEADER_NAMES.has(name.toLowerCase())
}

/**
 * Tells whether a quoted name in a flat list is a credential header, so the element after it is the credential: `Cookie`, `Set-Cookie`, `Authorization`, `Proxy-Authorization`, and hyphenated header-like secret names such as `X-Api-Key` and `X-Auth-Token`.
 * Why: a list such as `['pass', 'fail', 'skip']` or `['token', 'expiresIn']` holds words, not headers, so the broad {@link isSecretHeaderName} would blank an innocent next element; called by {@link findSecretSiblingIndexes} and {@link findShapedLiterals}.
 * @param name - A name in any letter case.
 * @returns `true` when the next element of a flat list is a credential.
 * @example
 * isCredentialHeaderName('Proxy-Authorization') // => true
 * isCredentialHeaderName('x-api-key') // => true
 * isCredentialHeaderName('pass') // => false
 * isCredentialHeaderName('Content-Type') // => false
 */
function isCredentialHeaderName(name: string): boolean {
  if (SECRET_HEADER_NAMES.has(name.toLowerCase())) return true
  return HYPHENATED_HEADER_NAME.test(name) && isSecretName(name)
}

/**
 * Tells whether a query parameter hides its value: a secret name, or `code`, the one-time value of an OAuth callback.
 * Called by {@link maskQueryPairs}.
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
 * Cuts the mark of a trimmed text off its end.
 * Called by {@link isCookieHeaderShape}: an adapter that trims a long preview ends it with `…`, and the capture's own cut ends it with {@link REPLAY_DEBUG_TRUNCATION_MARKER}, so the last segment may be cut anywhere.
 * @param text - A string, without its quotes.
 * @returns The text without a trailing mark, and whether it had one.
 * @example
 * withoutTrimMark('sid=abc; HttpOn…') // => { text: 'sid=abc; HttpOn', wasTrimmed: true }
 * withoutTrimMark('sid=abc') // => { text: 'sid=abc', wasTrimmed: false }
 */
function withoutTrimMark(text: string): { text: string; wasTrimmed: boolean } {
  if (text.endsWith(REPLAY_DEBUG_TRUNCATION_MARKER))
    return {
      text: text.slice(0, -REPLAY_DEBUG_TRUNCATION_MARKER.length),
      wasTrimmed: true,
    }
  if (text.endsWith(TRIM_MARK))
    return { text: text.slice(0, -TRIM_MARK.length), wasTrimmed: true }
  return { text, wasTrimmed: false }
}

/**
 * Tells whether a string is a Cookie or `Set-Cookie` header value: its first segment is a `name=value` pair, then more pairs, attributes (`Expires`, `Max-Age`, `Domain`, `Path`, `SameSite`, `Priority`, `HttpOnly`, `Secure`, `Partitioned`) and nothing else, and it holds two or more pairs, one pair with a secret name, or one pair with an attribute.
 * Why: an opaque session value is not recognisable by itself, but the header that carries it is; `Expires=Wed, 21 Oct 2025 07:28:00 GMT` holds blanks and a comma and must not hide the header. Called by {@link maskBareShape} and the output masking.
 * @param text - A whole string, without its quotes. A last segment cut by a trim mark (`…`) is tolerated.
 * @returns `true` for `sid=abc; theme=dark`, `session=abc`, `JSESSIONID=1` and `sid=abc; Path=/; Expires=Wed, 21 Oct 2025 07:28:00 GMT; HttpOnly`; `false` for `theme=dark`, `page=2` and prose.
 * @example
 * isCookieHeaderShape('sid=abc; theme=dark') // => true
 * isCookieHeaderShape('x=1; Expires=Wed, 21 Oct 2025 07:28:00 GMT') // => true
 * isCookieHeaderShape('theme=dark') // => false
 */
export function isCookieHeaderShape(text: string): boolean {
  const { text: complete, wasTrimmed } = withoutTrimMark(text)
  const segments = complete.split(';').map((segment) => segment.trim())
  // A trailing `;` leaves one empty segment.
  if (segments.at(-1) === '') segments.pop()
  const firstPair = COOKIE_PAIR.exec(segments[0] ?? '')
  // A header value starts with a pair; Expires and the others only follow it.
  if (!firstPair) return false
  let pairCount = 1,
    attributeCount = 0,
    hasSecretNamedPair = isSecretName(firstPair[1] ?? '')
  for (const [position, segment] of segments.slice(1).entries()) {
    if (COOKIE_FLAG.test(segment) || COOKIE_ATTRIBUTE.test(segment))
      attributeCount++
    else if (COOKIE_PAIR.test(segment)) {
      pairCount++
      hasSecretNamedPair ||= isSecretName(segment.split('=', 1)[0] ?? '')
    }
    // A segment that is neither a pair nor a cookie attribute is no cookie header, unless a trim cut the last one.
    else if (!wasTrimmed || position !== segments.length - 2) return false
  }
  return pairCount >= 2 || hasSecretNamedPair || attributeCount > 0
}

/**
 * Tells whether the credential of an Authorization value reads as a credential and not as a word of prose.
 * Called by {@link isAuthorizationShape}.
 * @param scheme - The scheme in lowercase.
 * @param token - The token after it, at least {@link AUTHORIZATION_CREDENTIAL_MIN_CHARS} characters of `A-Za-z0-9._~+/=-`.
 * @returns `true` for a Negotiate or NTLM blob, and for a token with a digit, one of `_~+/=-`, an inner `.`, or both a lowercase letter and a capital after its first character; `false` for `information`, `Validation` and `generated.`.
 * @example
 * looksLikeCredentialToken('basic', 'dXNlcjpwYXNz') // => true
 * looksLikeCredentialToken('basic', 'information') // => false
 */
function looksLikeCredentialToken(scheme: string, token: string): boolean {
  if (BASE64_CREDENTIAL_SCHEMES.has(scheme)) return true
  return (
    CREDENTIAL_TOKEN_MARK.test(token) ||
    (/[a-z]/.test(token) && /[A-Z]/.test(token.slice(1)))
  )
}

/**
 * Tells whether a string is an Authorization header value: `<scheme> <credentials>` with the scheme Basic, Bearer, Negotiate, NTLM or Token in any letter case and one credential token of at least {@link AUTHORIZATION_CREDENTIAL_MIN_CHARS} characters that looks like a credential, or `Digest` followed by `name=value` parameters.
 * Why: `Basic dXNlcjpwYXNz` carries a password but no word of a name or a provider prefix; prose such as `Token expired`, `Basic usage`, `Basic information` and `Token generated` must stay readable. Called by {@link maskBareShape} and the output masking.
 * @param text - A whole string, without its quotes.
 * @returns `true` when the whole string has that shape.
 * @example
 * isAuthorizationShape('Basic dXNlcjpwYXNz') // => true
 * isAuthorizationShape('Token expired') // => false
 * isAuthorizationShape('Basic information') // => false
 */
export function isAuthorizationShape(text: string): boolean {
  const trimmed = text.trim()
  const credential = AUTHORIZATION_CREDENTIAL.exec(trimmed)
  if (credential)
    return looksLikeCredentialToken(
      (credential[1] ?? '').toLowerCase(),
      credential[2] ?? '',
    )
  return AUTHORIZATION_DIGEST.test(trimmed)
}

/**
 * Masks the values of the secret parameters in the pairs of a query or a fragment, split at `&` and at `;`.
 * Called by {@link maskSecretUrlQueries} and {@link maskSecretUrlFragments}.
 * @param pairs - The text after a `?` or a `#`.
 * @returns The pairs with each secret value (a secret name, or `code`) replaced by {@link REDACTION_MASK}; separators and other pairs unchanged.
 * @example maskQueryPairs('a=1;token=abc&page=2') // => 'a=1;token=[masked]&page=2'
 */
function maskQueryPairs(pairs: string): string {
  // The capture group keeps each separator at an odd position.
  return pairs
    .split(/([&;])/)
    .map((part, position) =>
      position % 2 === 1
        ? part
        : maskSecretFormPairs(part, isSecretQueryParameter),
    )
    .join('')
}

/**
 * Masks the value of each secret query parameter (a secret name, or `code`) in a URL-shaped text, keeping the rest readable; every `?` opens a query, so `/login?next=/cb?code=abc` is masked in the nested one too.
 * Why: `req.url`, `resolvedUrl` and a `referer` carry the callback code or the reset token of the request; called by {@link maskBareShape}.
 * @param text - A URL, a path with a query, or text holding one.
 * @returns The text with each such value replaced by {@link REDACTION_MASK}; unchanged when it names none.
 * @example
 * maskSecretUrlQueries('/cb?code=abc&page=2') // => '/cb?code=[masked]&page=2'
 * maskSecretUrlQueries('/login?next=/cb?code=abc') // => '/login?next=/cb?code=[masked]'
 */
function maskSecretUrlQueries(text: string): string {
  return text.replace(
    URL_QUERY,
    (_query, pairs: string) => `?${maskQueryPairs(pairs)}`,
  )
}

/**
 * Masks the secret parameters of a URL fragment that holds `name=value` pairs, the way the OAuth implicit flow returns `#access_token=…`.
 * Called by {@link maskBareShape}.
 * @param text - A URL, or text holding one.
 * @returns The text with each such value replaced by {@link REDACTION_MASK}; a fragment without `=` (`#section`, `#42`) and the rest unchanged.
 * @example
 * maskSecretUrlFragments('/cb#access_token=abc&state=1') // => '/cb#access_token=[masked]&state=1'
 * maskSecretUrlFragments('/docs#install') // => '/docs#install'
 */
function maskSecretUrlFragments(text: string): string {
  return text.replace(URL_FRAGMENT, (fragment, pairs: string) =>
    pairs.includes('=') ? `#${maskQueryPairs(pairs)}` : fragment,
  )
}

/**
 * Takes the text out of a debugger's quoted string preview.
 * Called by {@link findSecretSiblingIndexes} to read a `name` or `key` member.
 * @param preview - A variable's value preview, such as `'sid'`.
 * @returns The text between the quotes, or `undefined` when the preview is no single quoted string or is longer than {@link SECRET_SHAPE_SCAN_LIMIT_CHARS} (no header name is).
 * @example
 * unquotePreviewString("'sid'") // => 'sid'
 * unquotePreviewString('{a: 1}') // => undefined
 */
export function unquotePreviewString(preview: string): string | undefined {
  const quote = preview[0]
  if (
    preview.length < 2 ||
    preview.length > SECRET_SHAPE_SCAN_LIMIT_CHARS ||
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
 * Finds where the line that holds `index` ends.
 * Called by {@link findShapedLiterals} when an opening quote has no closing one.
 * @param text - The text.
 * @param index - A position in the line.
 * @returns The index of the line break, or the text's length for the last line.
 * @example lineEndFrom("ab\ncd", 0) // => 2
 */
function lineEndFrom(text: string, index: number): number {
  const lineBreak = text.indexOf('\n', index)
  return lineBreak === -1 ? text.length : lineBreak
}

/**
 * Masks a text that is, as a whole, a Cookie header or an Authorization value, or that holds a URL with secret query or fragment values.
 * Why: one decision for a quoted element of a preview ({@link shapedReplacement}) and for a string a fact or a saved study keeps without quotes ({@link maskFactString}); the predicates stay in this module. A `Bearer` credential is left to {@link redactSecretText}, which masks its token and keeps the word.
 * @param text - A whole string, without quotes.
 * @param mask - What replaces a whole credential; the capture's {@link REDACTION_MASK} unless a caller keeps another marker.
 * @returns `mask` for a Cookie-shaped or Authorization-shaped string; the text with each secret query and fragment value masked for a URL; the same text when it holds none.
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
  return maskSecretUrlFragments(maskSecretUrlQueries(text))
}

/**
 * Decides what a quoted element that is no header value becomes: the mask for a Cookie or Authorization shape, itself with its secret query values masked for a URL, or nothing for an element that holds no credential.
 * Called by {@link findShapedLiterals}.
 * @param literal - The element with its quotes.
 * @param mask - What replaces a masked element.
 * @returns The replacement for the whole element, or `undefined` to keep it.
 * @example shapedReplacement("'sid=abc; theme=dark'", '[masked]') // => '[masked]'
 */
function shapedReplacement(literal: string, mask: string): string | undefined {
  const inner = literal.slice(1, -1)
  const maskedInner = maskBareShape(inner, mask)
  if (maskedInner === inner) return undefined
  // A whole credential loses its quotes with its value; a URL keeps them around its readable rest.
  const quote = literal.charAt(0)
  return maskedInner === mask ? mask : `${quote}${maskedInner}${quote}`
}

/**
 * Sums the `[` and `]` of a stretch between two quoted elements.
 * Called by {@link readValuePosition}.
 * @param gap - The text between two quoted elements.
 * @returns The `[` count minus the `]` count.
 * @example netBracketDepth('], [[') // => 1
 */
function netBracketDepth(gap: string): number {
  let depth = 0
  for (const character of gap) {
    if (character === '[') depth++
    else if (character === ']') depth--
  }
  return depth
}

/**
 * Counts a quoted element's position in the list it belongs to, as far as the text shows that list.
 * Why: a flat `[name, value, …]` header list holds its names at even positions, so in `['Content-Type', 'Authorization', 'X-Trace-Id']` the word `Authorization` is a value and `X-Trace-Id` is not its value; called by {@link findShapedLiterals}.
 * @param previous - The position of the previous element, `undefined` when unknown.
 * @param gap - The text between the previous element and this one.
 * @returns 0 after a `[`; the previous position plus one when only blanks and commas lie between; `undefined` otherwise (a chunk that starts inside a list, an object, an unquoted element), which allows a header name at any position.
 * @example
 * nextListIndex(undefined, '[') // => 0
 * nextListIndex(0, ', ') // => 1
 * nextListIndex(1, ': ') // => undefined
 */
function nextListIndex(
  previous: number | undefined,
  gap: string,
): number | undefined {
  if (gap.includes('[')) return 0
  return previous !== undefined && LIST_GAP.test(gap) ? previous + 1 : undefined
}

/**
 * Tells whether a quoted element is the value of the secret header name read before it, or sits inside the array that is that value.
 * Called by {@link findShapedLiterals} for each element.
 * @param state - What the scan knew after the previous element.
 * @param gap - The text between the previous element and this one.
 * @returns Whether this element is a header value, and how many `[` of the value's array are open at it.
 * @example
 * readValuePosition({ awaitingValue: true, arrayDepth: 0, listIndex: 0 }, ', [') // => { isValue: true, arrayDepth: 1 }
 * readValuePosition({ awaitingValue: false, arrayDepth: 0, listIndex: 0 }, ', ') // => { isValue: false, arrayDepth: 0 }
 */
function readValuePosition(
  state: PairingState,
  gap: string,
): { isValue: boolean; arrayDepth: number } {
  if (state.arrayDepth > 0) {
    const depth = state.arrayDepth + netBracketDepth(gap)
    // The array closed before this element, which is an ordinary element again.
    return depth > 0
      ? { isValue: true, arrayDepth: depth }
      : { isValue: false, arrayDepth: 0 }
  }
  if (!state.awaitingValue || !VALUE_GAP.test(gap))
    return { isValue: false, arrayDepth: 0 }
  // The gap holds only `[` here, one for each level of the value's array.
  return { isValue: true, arrayDepth: netBracketDepth(gap) }
}

/**
 * Tells whether a quoted element starts a list element or an object key: only blanks, or one of `[`, `{` and `,`, come before it.
 * Why: `'sid'` in `{name: 'sid', value: 'x'}` is a value after `:`, not a header name, so the quoted `"value"` key after it must stay readable; called by {@link findShapedLiterals}.
 * @param text - The text.
 * @param index - The index of the element's opening quote.
 * @returns `true` at the start of the text and after `[`, `{` or `,`.
 * @example
 * startsAnElement("['Cookie'", 1) // => true
 * startsAnElement("{name: 'sid'", 7) // => false
 */
function startsAnElement(text: string, index: number): boolean {
  let before = index - 1
  while (before >= 0 && /\s/.test(text.charAt(before))) before--
  return before < 0 || ELEMENT_START_PREFIXES.has(text.charAt(before))
}

/**
 * Finds where the quoted element that opens at `index` ends, or -1 when no element opens there.
 * Called by {@link findShapedLiterals} for each position of the text.
 * @param text - The text.
 * @param index - A position in it.
 * @param noCloserBefore - For each quote character, the line break before which no closing quote exists; filled in here when an opening quote finds none.
 * @returns The index after the closing quote, or -1 for a character that is no quote, a quote after a word character (`it's`, `5"`), or a quote without a closing quote on its line.
 * @example elementEnd("['a']", 1, new Map()) // => 4
 */
function elementEnd(
  text: string,
  index: number,
  noCloserBefore: Map<string, number>,
): number {
  const quote = text.charAt(index)
  if (quote !== "'" && quote !== '"' && quote !== '`') return -1
  // A quote right after a word character is an apostrophe or a unit mark, not the start of an element.
  if (index > 0 && /\w/.test(text.charAt(index - 1))) return -1
  // This line has no closing quote for it: scanning it would read the line to its end again.
  if (index < (noCloserBefore.get(quote) ?? 0)) return -1
  const end = endOfLiteral(text, index)
  if (end === -1) noCloserBefore.set(quote, lineEndFrom(text, index))
  return end
}

/**
 * Decides what one quoted element becomes and what the scan knows after it.
 * Called by {@link findShapedLiterals} for each element.
 * @param text - The text.
 * @param element - The element's opening index and its end past the closing quote.
 * @param previousEnd - Where the previous element ended.
 * @param state - What the scan knew after the previous element.
 * @param mask - What replaces a masked element.
 * @returns The replacement for the element (`undefined` keeps it) and the state after it.
 * @example readElement("['Cookie', 'sid']", { start: 11, end: 16 }, 9, { awaitingValue: true, arrayDepth: 0, listIndex: 0 }, '[masked]').replacement // => '[masked]'
 */
function readElement(
  text: string,
  element: { start: number; end: number },
  previousEnd: number,
  state: PairingState,
  mask: string,
): { replacement: string | undefined; state: PairingState } {
  const gap = text.slice(previousEnd, element.start)
  const position = readValuePosition(state, gap)
  const listIndex = nextListIndex(state.listIndex, gap)
  const literal = text.slice(element.start, element.end)
  const isTooLong = element.end - element.start > SECRET_SHAPE_SCAN_LIMIT_CHARS
  // A value is masked whole, whatever its length; any other element only when it has a credential shape and is short enough to read.
  const replacement = position.isValue
    ? mask
    : isTooLong
      ? undefined
      : shapedReplacement(literal, mask)
  const isHeaderName =
    replacement === undefined &&
    !isTooLong &&
    (listIndex === undefined || listIndex % 2 === 0) &&
    isCredentialHeaderName(literal.slice(1, -1)) &&
    startsAnElement(text, element.start)
  return {
    replacement,
    // A masked element is a value, never a header name; a name starts a pairing only where a list element or a key can start, at an even position of a list whose start the text shows.
    state: {
      arrayDepth: position.arrayDepth,
      listIndex,
      awaitingValue: isHeaderName,
    },
  }
}

/**
 * Finds every quoted element of a text that holds a credential: a Cookie header, an Authorization value, the element that follows a quoted secret header name (`['Cookie', 'sid=abc']`, a logged `rawHeaders`, also an array of values), and a quoted URL with secret query or fragment values.
 * Why: one rule, run once over the original text, for a debugger's value preview and for a development server's output, so a credential reads the same masked wherever the capture, the history or the log shows it. Called by {@link maskShapedLiterals} and {@link redactValuePreview}. The scan is linear: a quote with no closing quote on its line is remembered, so the quotes after it on that line are not tried, and an element longer than {@link SECRET_SHAPE_SCAN_LIMIT_CHARS} is not read as a credential.
 * @param text - A preview or a text of one or more lines.
 * @param afterHeaderName - Whether the text before this one ended right after a quoted secret header name, so a stream split into chunks keeps the pairing.
 * @param mask - What replaces a masked element.
 * @returns The replacements in order of position (a whole credential element becomes `mask` with its quotes; a URL keeps everything but its secret values) and whether the text ends right after a quoted secret header name or inside its array.
 * @example
 * findShapedLiterals("['Host', 'x', 'Cookie', 'sid=abc']", false, '[masked]').replacements // => [{ start: 24, end: 33, text: '[masked]' }]
 */
export function findShapedLiterals(
  text: string,
  afterHeaderName: boolean,
  mask: string,
): { replacements: TextReplacement[]; afterHeaderName: boolean } {
  const replacements: TextReplacement[] = []
  const noCloserBefore = new Map<string, number>()
  let state: PairingState = {
      awaitingValue: afterHeaderName,
      arrayDepth: 0,
      listIndex: undefined,
    },
    previousEnd = 0
  for (let index = 0; index < text.length; index++) {
    const end = elementEnd(text, index, noCloserBefore)
    if (end === -1) continue
    const read = readElement(
      text,
      { start: index, end },
      previousEnd,
      state,
      mask,
    )
    if (read.replacement !== undefined)
      replacements.push({ start: index, end, text: read.replacement })
    state = read.state
    previousEnd = end
    // The loop's own increment steps past the element's last character.
    index = end - 1
  }
  const tail = text.slice(previousEnd)
  return {
    replacements,
    // The next chunk's first element is this one's value only when nothing but blanks, commas and `[` follows the name, or the value's array is still open.
    afterHeaderName:
      (state.awaitingValue && VALUE_GAP.test(tail)) ||
      (state.arrayDepth > 0 && state.arrayDepth + netBracketDepth(tail) > 0),
  }
}

/**
 * Puts replacements into a text in one pass; stretches that overlap fail closed.
 * Why: the preview rule finds its stretches (secret-named members, record values, credential elements) on the original text, so the replacements may nest or overlap. Called by {@link maskShapedLiterals} and {@link redactValuePreview}.
 * @param text - The text the stretches refer to.
 * @param replacements - The stretches in any order; one inside another is dropped with it, and two that cut across each other become one `mask` over both.
 * @param mask - What replaces two stretches that cut across each other.
 * @returns The text with the stretches replaced.
 * @example applyTextReplacements('{a: 1}', [{ start: 4, end: 5, text: '[masked]' }]) // => '{a: [masked]}'
 */
export function applyTextReplacements(
  text: string,
  replacements: readonly TextReplacement[],
  mask: string = REDACTION_MASK,
): string {
  const merged: TextReplacement[] = []
  const ordered = [...replacements].sort(
    (a, b) => a.start - b.start || b.end - a.end,
  )
  for (const replacement of ordered) {
    const last = merged.at(-1)
    if (last === undefined || replacement.start >= last.end)
      merged.push(replacement)
    // A stretch that cuts across the previous one is masked together with it.
    else if (replacement.end > last.end)
      merged[merged.length - 1] = {
        start: last.start,
        end: replacement.end,
        text: mask,
      }
  }
  let result = '',
    copiedUntil = 0
  for (const replacement of merged) {
    result += text.slice(copiedUntil, replacement.start) + replacement.text
    copiedUntil = replacement.end
  }
  return result + text.slice(copiedUntil)
}

/**
 * Masks every quoted element of a text that holds a credential: a Cookie header, an Authorization value, the element that follows a quoted secret header name (`['Cookie', 'sid=abc']`, a logged `rawHeaders`), and the secret query values of a quoted URL.
 * Why: the development server's output masking applies this rule to its lines; called by the output masking. {@link redactValuePreview} merges {@link findShapedLiterals} with its member ranges instead.
 * @param text - A preview or a text of one or more lines.
 * @param afterHeaderName - Whether the text before this one ended right after a quoted secret header name, so a stream split into chunks keeps the pairing.
 * @param mask - What replaces a masked element; the capture's {@link REDACTION_MASK} unless a caller keeps another marker.
 * @returns The masked text and whether it ends right after a quoted secret header name. A whole credential element becomes `mask` with its quotes; a URL keeps everything but its secret values.
 * @example
 * maskShapedLiterals("['Host', 'x', 'Cookie', 'sid=abc']").text // => "['Host', 'x', 'Cookie', [masked]]"
 * maskShapedLiterals("{referer: '/cb?code=abc'}").text // => "{referer: '/cb?code=[masked]'}"
 */
export function maskShapedLiterals(
  text: string,
  afterHeaderName = false,
  mask: string = REDACTION_MASK,
): ShapedLiteralsResult {
  const scan = findShapedLiterals(text, afterHeaderName, mask)
  return {
    text: applyTextReplacements(text, scan.replacements, mask),
    afterHeaderName: scan.afterHeaderName,
  }
}

/**
 * Finds the siblings of one object, array or scope whose value a neighbour names as a secret.
 * Why: a cookie record `{name: 'sid', value: '…'}`, a Map entry `{key: 'session', value: '…'}` and a flat header array `['Cookie', 'sid=…']` carry the credential in a plainly named member, and only the neighbour says so. Called by the replay capture for each list of variables it reads, and by {@link maskSavedDebugSnapshot} for each list a saved snapshot holds.
 * @param entries - The siblings in order: a variable's name and its value preview.
 * @returns The positions of the siblings to mask: each `value` member beside a `name` or `key` member that holds a secret name ({@link isSecretHeaderName}), and each array element right after an even-positioned element that holds a credential header name ({@link isCredentialHeaderName}).
 * @example
 * findSecretSiblingIndexes([{ name: 'name', value: "'sid'" }, { name: 'value', value: "'abc'" }]) // => Set { 1 }
 * findSecretSiblingIndexes([{ name: '0', value: "'Cookie'" }, { name: '1', value: "'sid=abc'" }]) // => Set { 1 }
 * findSecretSiblingIndexes([{ name: '0', value: "'pass'" }, { name: '1', value: "'fail'" }]) // => Set {}
 * findSecretSiblingIndexes([{ name: '0', value: "'Host'" }, { name: '1', value: "'Authorization'" }, { name: '2', value: "'X-Trace-Id'" }]) // => Set {}
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
    // A flat header array lists the name at one even index and its value at the next.
    const next = entries[position + 1]
    const headerName = unquotePreviewString(entry.value)
    if (
      next !== undefined &&
      headerName !== undefined &&
      // A header name sits at an even position of the flat list.
      position % 2 === 0 &&
      entry.name === String(position) &&
      next.name === String(position + 1) &&
      isCredentialHeaderName(headerName)
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

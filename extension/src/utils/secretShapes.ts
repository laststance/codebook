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

/** What a credential token has that a plain word lacks: a digit, one of `_~+/=-`, or a `.` inside it. A `.` that only ends a sentence (`Token generated.`) is cut off first ({@link withoutTrailingDots}), so the test needs no look-ahead, which would read the rest of a long dot run again for every dot. */
const CREDENTIAL_TOKEN_MARK = /[\d_~+/=-]|\./

/** A `Bearer` credential: {@link redactSecretText} masks its token and keeps the word, so the literal masker leaves it to that shape. */
const BEARER_CREDENTIAL = /^bearer[ \t]/i

/** The word `Bearer` and the blanks after it at the start of a value, matched at `lastIndex` only (sticky): a labelled Bearer value keeps this part and has the rest masked ({@link findLabelledAuthorizations}). */
const BEARER_WORD = /bearer[ \t]+/iy

/** An `Authorization` label, also as the end of `Proxy-Authorization` or `X-Authorization`, with `:` or `=` as its separator (the key may be quoted: `"authorization":`). Group 1 holds the opening quote of the value, empty when the value is bare. A label with no separator (`Authorization header missing`) is prose, and a longer word (`authorization_endpoint`, `userAuthorization`) is another name. */
const AUTHORIZATION_LABEL = /\bauthorization["']?[ \t]*[:=][ \t]*(["']?)/gi

/** The brackets a bare value may open (`Foo (bar)`, a mask such as `[masked]`); each one is closed again inside the value. */
const OPENING_BRACKETS: ReadonlySet<string> = new Set(['{', '[', '('])

/** The brackets that close what the label sits in (the object, array or call that holds it) when nothing in the value opened them. */
const CLOSING_BRACKETS: ReadonlySet<string> = new Set(['}', ']', ')'])

/** The characters that end a line. */
const LINE_BREAK_CHARACTERS: ReadonlySet<string> = new Set(['\n', '\r'])

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

/** What a scan of one chunk hands to the next chunk of the same stream, so a header list printed over several writes keeps its pairing. */
export type ShapedLiteralsCarry = {
  /** `true` when the text ends right after a quoted secret header name (or inside the array that is its value), so the next quoted element of the next chunk is its value. */
  afterHeaderName: boolean
  /** How many `[` of the array that is a secret header name's value are still open at the end of the text (0 when no array is open); the next chunk starts inside that array, so every quoted element up to its closing bracket is a value. */
  headerArrayDepth: number
  /** The position in its list that the next quoted element takes when only blanks and commas come before it (0 after a `[`), or `undefined` when the text does not show it; a flat header list holds its names at even positions, so the next chunk keeps telling a name from a value. */
  listIndex: number | undefined
}

/** The result of {@link maskShapedLiterals}. */
export type ShapedLiteralsResult = ShapedLiteralsCarry & {
  /** The text with each credential-shaped quoted element masked. */
  text: string
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
 * Cuts the dots off the end of a token: the full stop of a sentence, or a run of them.
 * Why: a token of letters and a long run of dots must be judged in one pass; a look-ahead past each dot reads the rest of the run again (8.1 s for 262,144 dots), which would block the extension host. Called by {@link looksLikeCredentialToken}.
 * @param token - A run of characters of `A-Za-z0-9._~+/=-`.
 * @returns The token without its trailing dots.
 * @example
 * withoutTrailingDots('generated.') // => 'generated'
 * withoutTrailingDots('a.b...') // => 'a.b'
 */
function withoutTrailingDots(token: string): string {
  let end = token.length
  while (end > 0 && token.charAt(end - 1) === '.') end--
  return token.slice(0, end)
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
    CREDENTIAL_TOKEN_MARK.test(withoutTrailingDots(token)) ||
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
 * Finds where a bare value after an Authorization label ends: at the line's end, or at a closing bracket that nothing in the value opened.
 * Why: the object or call that holds the label (`{ authorization: ApiKey x }`, `log(Authorization: ApiKey x)`) keeps its closing bracket, while a value that brings its own brackets (`Foo (bar)`, the mask `[masked]` of an earlier pass) is masked whole and a second pass changes nothing. Called by {@link findLabelledAuthorizations}.
 * @param text - The text.
 * @param valueStart - The index right after the label's separator.
 * @param limit - The index the value never passes.
 * @returns The index where the value ends, at most `limit`.
 * @example
 * endOfBareAuthorizationValue('(Authorization: ApiKey abc) retried', 16, 35) // => 26
 * endOfBareAuthorizationValue('Authorization: [masked]', 15, 23) // => 23
 */
function endOfBareAuthorizationValue(
  text: string,
  valueStart: number,
  limit: number,
): number {
  let openBrackets = 0
  for (let index = valueStart; index < limit; index++) {
    const character = text.charAt(index)
    // A value is one line's; a lone carriage return breaks a line like a newline.
    if (LINE_BREAK_CHARACTERS.has(character)) return index
    if (OPENING_BRACKETS.has(character)) openBrackets++
    else if (CLOSING_BRACKETS.has(character)) {
      if (openBrackets === 0) return index
      openBrackets--
    }
  }
  return limit
}

/**
 * Finds where a quoted value after an Authorization label ends.
 * Called by {@link findLabelledAuthorizations}.
 * @param text - The text.
 * @param valueStart - The index right after the value's opening quote.
 * @param quote - The opening quote character.
 * @param limit - The index the value never passes.
 * @returns The index of the closing quote; a value with no closing quote on its line ends with the line. A backslash escapes the character after it, a line break excepted. At most `limit`.
 * @example endOfQuotedAuthorizationValue('{"authorization": "ApiKey abc", "n": 1}', 19, '"', 38) // => 29
 */
function endOfQuotedAuthorizationValue(
  text: string,
  valueStart: number,
  quote: string,
  limit: number,
): number {
  for (let index = valueStart; index < limit; index++) {
    const character = text.charAt(index)
    if (LINE_BREAK_CHARACTERS.has(character) || character === quote)
      return index
    if (
      character === '\\' &&
      !LINE_BREAK_CHARACTERS.has(text.charAt(index + 1))
    )
      index++
  }
  return limit
}

/**
 * Finds the value after each Authorization or Proxy-Authorization label that has a `:` or an `=` after it, whatever the scheme of the credential.
 * Why: the label alone proves the value is a credential, so `ApiKey 8f3a…`, `AWS4-HMAC-SHA256 Credential=…,Signature=…` and `Basic YTpi` are masked although no scheme list names them; the unlabelled shape rule ({@link isAuthorizationShape}) keeps its prose guard for a bare `Token expired`. A `Bearer` value keeps its word and has everything after it masked, a short token (`Bearer short`) or one with a bar or a colon (`Bearer 12|abc…`) included, which the token rule of {@link redactSecretText} (eight token characters) would leave; a value that already reads `Bearer <mask>` is no replacement, so a second pass changes nothing. A quoted value is masked up to its closing quote; a bare value up to the line's end, or a closing bracket that nothing in the value opened, so the object or call that holds the label keeps its shape. Called by {@link maskShapedLiterals} for output and by {@link redactValuePreview} for a debugger preview and a fact string.
 * @param text - A preview or a text of one or more lines.
 * @param mask - What replaces a value.
 * @param limitOf - Tells the index a value never passes for the label at a given index, so a header line held in a quoted string ends before the string's closing quote. Called with indexes that do not decrease. Defaults to the text's end.
 * @returns One replacement per value, in order of position; it starts where the value starts and, for a Bearer value, carries the word again before the mask. A label inside a value already replaced belongs to that value, and an empty value is no replacement.
 * @example
 * findLabelledAuthorizations('Authorization: ApiKey abc', '[masked]') // => [{ start: 15, end: 25, text: '[masked]' }]
 * findLabelledAuthorizations('Authorization: Bearer abc', '[masked]') // => [{ start: 15, end: 25, text: 'Bearer [masked]' }]
 * findLabelledAuthorizations('Authorization header missing', '[masked]') // => []
 */
export function findLabelledAuthorizations(
  text: string,
  mask: string,
  limitOf?: (labelIndex: number) => number,
): TextReplacement[] {
  const replacements: TextReplacement[] = []
  let maskedUntil = 0
  for (const label of text.matchAll(AUTHORIZATION_LABEL)) {
    // A label inside a value that is already masked belongs to that value.
    if (label.index < maskedUntil) continue
    const valueStart = label.index + label[0].length
    // A Bearer value keeps its word: only what follows it is the credential.
    BEARER_WORD.lastIndex = valueStart
    const credentialStart = BEARER_WORD.test(text)
      ? BEARER_WORD.lastIndex
      : valueStart
    const limit = Math.min(limitOf?.(label.index) ?? text.length, text.length)
    const quote = label[1] ?? ''
    const end =
      quote === ''
        ? endOfBareAuthorizationValue(text, credentialStart, limit)
        : endOfQuotedAuthorizationValue(text, credentialStart, quote, limit)
    const credential = text.slice(credentialStart, end)
    // A label with nothing after it, or with the mask of an earlier pass, has nothing to mask.
    if (credential.trim() === '' || credential === mask) continue
    replacements.push({
      start: valueStart,
      end,
      text: text.slice(valueStart, credentialStart) + mask,
    })
    maskedUntil = end
  }
  return replacements
}

/**
 * Masks the values of the secret parameters in the pairs of a query or a fragment, split at `&` and at `;`.
 * Called by {@link maskSecretUrlQueries} and {@link maskSecretUrlFragments}.
 * @param pairs - The text after a `?` or a `#`.
 * @param mask - What replaces a secret value.
 * @returns The pairs with each secret value (a secret name, or `code`) replaced by the mask; separators and other pairs unchanged.
 * @example maskQueryPairs('a=1;token=abc&page=2', '[masked]') // => 'a=1;token=[masked]&page=2'
 */
function maskQueryPairs(pairs: string, mask: string): string {
  // The capture group keeps each separator at an odd position.
  return pairs
    .split(/([&;])/)
    .map((part, position) =>
      position % 2 === 1
        ? part
        : maskSecretFormPairs(part, isSecretQueryParameter, mask),
    )
    .join('')
}

/**
 * Masks the value of each secret query parameter (a secret name, or `code`) in a URL-shaped text, keeping the rest readable; every `?` opens a query, so `/login?next=/cb?code=abc` is masked in the nested one too.
 * Why: `req.url`, `resolvedUrl` and a `referer` carry the callback code or the reset token of the request; called by {@link maskBareShape}.
 * @param text - A URL, a path with a query, or text holding one.
 * @param mask - What replaces a secret value.
 * @returns The text with each such value replaced by the mask; unchanged when it names none.
 * @example
 * maskSecretUrlQueries('/cb?code=abc&page=2', '[masked]') // => '/cb?code=[masked]&page=2'
 * maskSecretUrlQueries('/login?next=/cb?code=abc', '[masked]') // => '/login?next=/cb?code=[masked]'
 */
function maskSecretUrlQueries(text: string, mask: string): string {
  return text.replace(
    URL_QUERY,
    (_query, pairs: string) => `?${maskQueryPairs(pairs, mask)}`,
  )
}

/**
 * Masks the secret parameters of a URL fragment that holds `name=value` pairs, the way the OAuth implicit flow returns `#access_token=…`.
 * Called by {@link maskBareShape}.
 * @param text - A URL, or text holding one.
 * @param mask - What replaces a secret value.
 * @returns The text with each such value replaced by the mask; a fragment without `=` (`#section`, `#42`) and the rest unchanged.
 * @example
 * maskSecretUrlFragments('/cb#access_token=abc&state=1', '[masked]') // => '/cb#access_token=[masked]&state=1'
 * maskSecretUrlFragments('/docs#install', '[masked]') // => '/docs#install'
 */
function maskSecretUrlFragments(text: string, mask: string): string {
  return text.replace(URL_FRAGMENT, (fragment, pairs: string) =>
    pairs.includes('=') ? `#${maskQueryPairs(pairs, mask)}` : fragment,
  )
}

/**
 * Masks the secret query and fragment values of every URL or path inside a text: `GET /cb?code=abc 200` and `redirect https://idp/cb#access_token=abc`.
 * Why: a development server's request log prints the callback code or reset token of the request in plain text; called by {@link maskBareShape} and the output line masking ({@link maskSecretShapesInOutput}). Each query and fragment run is scanned once, so the time is linear.
 * @param text - A URL, a path with a query, or a line of text holding one.
 * @param mask - What replaces a secret value; {@link REDACTION_MASK} unless the caller keeps another marker ({@link maskNextServerOutput} reads its own marker after this pass and must not meet the default one).
 * @returns The text with each secret-named or `code` value replaced by the mask; unchanged when it holds none.
 * @example
 * maskSecretUrlParts('GET /cb?code=abc&page=2 200') // => 'GET /cb?code=[masked]&page=2 200'
 * maskSecretUrlParts('GET /cb?code=abc 200', '<redacted>') // => 'GET /cb?code=<redacted> 200'
 * maskSecretUrlParts('GET /items?page=2 200') // => 'GET /items?page=2 200'
 */
export function maskSecretUrlParts(
  text: string,
  mask: string = REDACTION_MASK,
): string {
  return maskSecretUrlFragments(maskSecretUrlQueries(text, mask), mask)
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
  return maskSecretUrlParts(text, mask)
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

/** A quoted element of a text: where it opens, where it ends, and whether its closing quote is missing (it then runs to the end of its line). */
export type QuotedElement = {
  /** The index of the opening quote. */
  start: number
  /** The index after the closing quote; for an element without one, the end of its line (before a carriage return that ends it). */
  end: number
  /** `true` when the line ends before a closing quote: the element is cut off, or the quote is only an apostrophe or a stray mark. */
  isUnterminated: boolean
}

/**
 * Finds the quoted element that opens at `index`, if one opens there.
 * Called by {@link findShapedLiterals} for each position of the text and by the printed-record rule.
 * @param text - The text.
 * @param index - A position in it.
 * @param noCloserBefore - For each quote character, the line break before which no closing quote exists; filled in here when an opening quote finds none.
 * @returns The element, or `undefined` for a character that is no quote, a quote after a word character (`it's`, `5"`), or a quote after one that already found no closing quote on its line. A quote without a closing quote on its line is an unterminated element that runs to the line's end.
 * @example
 * findQuotedElement("['a']", 1, new Map()) // => { start: 1, end: 4, isUnterminated: false }
 * findQuotedElement("['a", 1, new Map()) // => { start: 1, end: 3, isUnterminated: true }
 */
export function findQuotedElement(
  text: string,
  index: number,
  noCloserBefore: Map<string, number>,
): QuotedElement | undefined {
  const quote = text.charAt(index)
  if (quote !== "'" && quote !== '"' && quote !== '`') return undefined
  // A quote right after a word character is an apostrophe or a unit mark, not the start of an element.
  if (index > 0 && /\w/.test(text.charAt(index - 1))) return undefined
  // This line has no closing quote for it: scanning it would read the line to its end again.
  if (index < (noCloserBefore.get(quote) ?? 0)) return undefined
  const end = endOfLiteral(text, index)
  if (end !== -1) return { start: index, end, isUnterminated: false }
  const lineEnd = lineEndFrom(text, index)
  noCloserBefore.set(quote, lineEnd)
  // A carriage return that ends a Windows line is not part of the element.
  const hasReturn = lineEnd > index + 1 && text.charAt(lineEnd - 1) === '\r'
  return {
    start: index,
    end: hasReturn ? lineEnd - 1 : lineEnd,
    isUnterminated: true,
  }
}

/** A scheme and the first characters of its credential, fewer than {@link AUTHORIZATION_CREDENTIAL_MIN_CHARS}: what a cap leaves of `Basic dXNlcjpwYXNz` when it cuts early in the credential, which no closed Authorization value is short enough to be. */
const CUT_AUTHORIZATION_CREDENTIAL = new RegExp(
  `^(?:basic|negotiate|ntlm|token)[ \\t]+[A-Za-z0-9._~+/=-]{1,${AUTHORIZATION_CREDENTIAL_MIN_CHARS - 1}}$`,
  'i',
)

/**
 * Masks the secret query and fragment values in the visible part of a text that a cap cut, leaving a secret value the cut elided entirely as it is.
 * Called by {@link cutElementReplacement}.
 * @param visible - The text before the trim mark.
 * @param mask - What replaces a secret value.
 * @returns The text with each secret value in it masked; a last `name=` with nothing after it keeps reading `name=`, since the cut left no value to hide.
 * @example
 * maskVisibleUrlParts('/cb?page=2&code=abc', '[masked]') // => '/cb?page=2&code=[masked]'
 * maskVisibleUrlParts('/cb?page=2&code=', '[masked]') // => '/cb?page=2&code='
 */
function maskVisibleUrlParts(visible: string, mask: string): string {
  const masked = maskSecretUrlParts(visible, mask)
  return visible.endsWith('=') && masked.endsWith(`=${mask}`)
    ? masked.slice(0, -mask.length)
    : masked
}

/**
 * Decides what an element becomes whose closing quote is missing because a cap cut the text there and left a trim mark (`…` or {@link REPLAY_DEBUG_TRUNCATION_MARKER}).
 * Why: the capture cuts every saved text above 4,096 characters, so every long string, a large JSON, an HTML or a SQL text among them, ends this way; its visible part is judged like a closed element, so a benign string keeps its readable start and its mark and a credential does not survive the cut. Called by {@link elementReplacement}.
 * @param text - The text.
 * @param element - An unterminated element.
 * @param mask - What replaces a masked element.
 * @returns `mask` when the visible part is a Cookie header (a last pair or attribute cut anywhere is tolerated) or an Authorization value, also one cut after fewer credential characters than a closed value needs; the element with the secret query and fragment values of its visible part masked, its opening quote and its trim mark kept, when it holds a URL with such values; `undefined` for an element with no trim mark, for one that holds no credential shape, and for one whose only secret value was elided (`code=… [truncated]`).
 * @example
 * cutElementReplacement("'sid=abc; theme=dark… [truncated]", { start: 0, end: 32, isUnterminated: true }, '[masked]') // => '[masked]'
 * cutElementReplacement("'/cb?page=2&code=abc… [truncated]", { start: 0, end: 32, isUnterminated: true }, '[masked]') // => "'/cb?page=2&code=[masked]… [truncated]"
 * cutElementReplacement("'{\"items\":[1,2… [truncated]", { start: 0, end: 25, isUnterminated: true }, '[masked]') // => undefined
 */
function cutElementReplacement(
  text: string,
  element: QuotedElement,
  mask: string,
): string | undefined {
  const inner = text.slice(element.start + 1, element.end)
  const cut = withoutTrimMark(inner.trimEnd())
  if (!cut.wasTrimmed) return undefined
  if (
    isCookieHeaderShape(inner.trimEnd()) ||
    CUT_AUTHORIZATION_CREDENTIAL.test(cut.text) ||
    (isAuthorizationShape(cut.text) && !BEARER_CREDENTIAL.test(cut.text.trim()))
  )
    return mask
  const maskedVisible = maskVisibleUrlParts(cut.text, mask)
  if (maskedVisible === cut.text) return undefined
  return `${text.charAt(element.start)}${maskedVisible}${inner.slice(cut.text.length)}`
}

/**
 * Decides what one quoted element becomes.
 * Called by {@link readElement}.
 * @param text - The text.
 * @param element - The element.
 * @param isValue - Whether the element is the value of a secret header name or sits inside its array.
 * @param mask - What replaces a masked element.
 * @returns `mask` for a value (whatever its length, and also when its closing quote is missing) and for an element the scan does not read because it is longer than {@link SECRET_SHAPE_SCAN_LIMIT_CHARS} (a literal that is not read cannot be shown to hold no credential); the replacement of {@link cutElementReplacement} for an element cut off before its closing quote; the replacement of {@link shapedReplacement} for any other closed element; `undefined` to keep it.
 * @example elementReplacement("['Cookie', 'sid=abc']", { start: 11, end: 20, isUnterminated: false }, true, '[masked]') // => '[masked]'
 */
function elementReplacement(
  text: string,
  element: QuotedElement,
  isValue: boolean,
  mask: string,
): string | undefined {
  if (isValue) return mask
  if (element.isUnterminated) return cutElementReplacement(text, element, mask)
  if (element.end - element.start > SECRET_SHAPE_SCAN_LIMIT_CHARS) return mask
  return shapedReplacement(text.slice(element.start, element.end), mask)
}

/**
 * Decides what one quoted element becomes and what the scan knows after it.
 * Called by {@link findShapedLiterals} for each element.
 * @param text - The text.
 * @param element - The element.
 * @param previousEnd - Where the previous element ended.
 * @param state - What the scan knew after the previous element.
 * @param mask - What replaces a masked element.
 * @returns The replacement for the element (`undefined` keeps it) and the state after it.
 * @example readElement("['Cookie', 'sid']", { start: 11, end: 16, isUnterminated: false }, 9, { awaitingValue: true, arrayDepth: 0, listIndex: 0 }, '[masked]').replacement // => '[masked]'
 */
function readElement(
  text: string,
  element: QuotedElement,
  previousEnd: number,
  state: PairingState,
  mask: string,
): { replacement: string | undefined; state: PairingState } {
  const gap = text.slice(previousEnd, element.start)
  const position = readValuePosition(state, gap)
  const listIndex = nextListIndex(state.listIndex, gap)
  const replacement = elementReplacement(text, element, position.isValue, mask)
  const isHeaderName =
    replacement === undefined &&
    (listIndex === undefined || listIndex % 2 === 0) &&
    isCredentialHeaderName(text.slice(element.start + 1, element.end - 1)) &&
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
 * Why: one rule, run once over the original text, for a debugger's value preview and for a development server's output, so a credential reads the same masked wherever the capture, the history or the log shows it. Called by {@link maskShapedLiterals} and {@link redactValuePreview}. The scan is linear: a quote with no closing quote on its line is remembered, so the quotes after it on that line are not tried. An element longer than {@link SECRET_SHAPE_SCAN_LIMIT_CHARS} is not read, so it is masked whole; an element cut off before its closing quote is masked to the end of its line when it follows a secret header name, and otherwise judged by its visible part when a size cap left a trim mark on it ({@link cutElementReplacement}).
 * @param text - A preview or a text of one or more lines.
 * @param afterHeaderName - Whether the text before this one ended right after a quoted secret header name, so a stream split into chunks keeps the pairing.
 * @param mask - What replaces a masked element.
 * @param headerArrayDepth - How many `[` of a secret header name's value array the text before this one left open, so a chunk that starts inside the array keeps masking its elements.
 * @param listIndex - The position in its list that the first quoted element of this text takes when only blanks and commas come before it (the result's `listIndex`), so a chunk that starts between two elements of a flat header list keeps telling a name from a value.
 * @returns The replacements in order of position (a whole credential element becomes `mask` with its quotes; a URL keeps everything but its secret values), whether the text ends right after a quoted secret header name or inside its array, how many `[` of that array are still open, and the position the next quoted element takes.
 * @example
 * findShapedLiterals("['Host', 'x', 'Cookie', 'sid=abc']", false, '[masked]').replacements // => [{ start: 24, end: 33, text: '[masked]' }]
 */
export function findShapedLiterals(
  text: string,
  afterHeaderName: boolean,
  mask: string,
  headerArrayDepth = 0,
  listIndex: number | undefined = undefined,
): { replacements: TextReplacement[] } & ShapedLiteralsCarry {
  const replacements: TextReplacement[] = []
  const noCloserBefore = new Map<string, number>()
  let state: PairingState = {
      awaitingValue: afterHeaderName,
      arrayDepth: headerArrayDepth,
      // The carried position is the next element's; the state holds the position of the element just read.
      listIndex: listIndex === undefined ? undefined : listIndex - 1,
    },
    previousEnd = 0
  for (let index = 0; index < text.length; index++) {
    const element = findQuotedElement(text, index, noCloserBefore)
    if (element === undefined) continue
    const read = readElement(text, element, previousEnd, state, mask)
    // A quote that opens no closed element and hides nothing may be an apostrophe or a stray mark: the rest of its line is scanned as before.
    if (element.isUnterminated && read.replacement === undefined) continue
    if (read.replacement !== undefined)
      replacements.push({
        start: index,
        end: element.end,
        text: read.replacement,
      })
    state = read.state
    previousEnd = element.end
    // The loop's own increment steps past the element's last character.
    index = element.end - 1
  }
  const tail = text.slice(previousEnd)
  // The next chunk's first element is this one's value only when nothing but blanks, commas and `[` follows the name, or the value's array is still open.
  const isAwaitingValue = state.awaitingValue && VALUE_GAP.test(tail)
  let openDepth = 0
  if (state.arrayDepth > 0)
    openDepth = Math.max(0, state.arrayDepth + netBracketDepth(tail))
  else if (isAwaitingValue) openDepth = netBracketDepth(tail)
  return {
    replacements,
    afterHeaderName: isAwaitingValue || openDepth > 0,
    headerArrayDepth: openDepth,
    listIndex: nextListIndex(state.listIndex, tail),
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
 * Masks every quoted element of a text that holds a credential: a Cookie header, an Authorization value, the element that follows a quoted secret header name (`['Cookie', 'sid=abc']`, a logged `rawHeaders`), and the secret query values of a quoted URL; and the value after an `Authorization:` or `Authorization=` label, whatever its scheme ({@link findLabelledAuthorizations}).
 * Why: the development server's output masking applies this rule to its lines; called by the output masking. {@link redactValuePreview} merges {@link findShapedLiterals} with its member ranges instead.
 * @param text - A preview or a text of one or more lines.
 * @param afterHeaderName - Whether the text before this one ended right after a quoted secret header name, so a stream split into chunks keeps the pairing.
 * @param mask - What replaces a masked element; the capture's {@link REDACTION_MASK} unless a caller keeps another marker.
 * @param headerArrayDepth - How many `[` of a secret header name's value array the text before this one left open (the result's `headerArrayDepth`).
 * @param listIndex - The position the first quoted element of this text takes in its list (the result's `listIndex`).
 * @returns The masked text, whether it ends right after a quoted secret header name, how many `[` of that name's array are still open, and the position the next quoted element takes. A whole credential element becomes `mask` with its quotes; a URL keeps everything but its secret values.
 * @example
 * maskShapedLiterals("['Host', 'x', 'Cookie', 'sid=abc']").text // => "['Host', 'x', 'Cookie', [masked]]"
 * maskShapedLiterals("{referer: '/cb?code=abc'}").text // => "{referer: '/cb?code=[masked]'}"
 * maskShapedLiterals('Authorization: ApiKey abc').text // => 'Authorization: [masked]'
 */
export function maskShapedLiterals(
  text: string,
  afterHeaderName = false,
  mask: string = REDACTION_MASK,
  headerArrayDepth = 0,
  listIndex: number | undefined = undefined,
): ShapedLiteralsResult {
  const scan = findShapedLiterals(
    text,
    afterHeaderName,
    mask,
    headerArrayDepth,
    listIndex,
  )
  return {
    text: applyTextReplacements(
      text,
      [...scan.replacements, ...findLabelledAuthorizations(text, mask)],
      mask,
    ),
    afterHeaderName: scan.afterHeaderName,
    headerArrayDepth: scan.headerArrayDepth,
    listIndex: scan.listIndex,
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

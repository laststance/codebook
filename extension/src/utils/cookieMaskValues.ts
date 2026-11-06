import {
  NODE_SERVER_COOKIE_MASK_DIGIT_MIN_CHARS,
  NODE_SERVER_COOKIE_MASK_MIN_CHARS,
} from '../constants'

import { unquoteCookieValue } from './unquoteCookieValue'

/**
 * Tells whether a cookie value candidate is long enough, or digit-bearing enough, to be masked.
 *
 * Called by {@link cookieMaskValues} for each candidate form.
 *
 * @param form - A candidate form of a cookie value.
 * @returns True at {@link NODE_SERVER_COOKIE_MASK_MIN_CHARS} characters, or at {@link NODE_SERVER_COOKIE_MASK_DIGIT_MIN_CHARS} characters with an ASCII digit.
 * @example
 * isMaskable('k3J9xQ2mV8aZ') // => true
 * isMaskable('abcdefghij') // => false
 */
function isMaskable(form: string): boolean {
  if (form.length >= NODE_SERVER_COOKIE_MASK_MIN_CHARS) return true
  return (
    form.length >= NODE_SERVER_COOKIE_MASK_DIGIT_MIN_CHARS && /\d/.test(form)
  )
}

/**
 * Lists the texts that stand for each session cookie value, for masking in published output.
 *
 * Why it exists: a signed cookie (express-session `s%3Asid.sig`, Better Auth `token.signature`) is echoed by servers in decoded or split forms, and each form must be hidden.
 * Called by the node-server run when it builds the masking set from the session cookies' seen values.
 * Candidates: the value, its URL-decoded form, and the parts split at the last `.` (after decoding, with a leading `s:` removed), each kept when it has at least {@link NODE_SERVER_COOKIE_MASK_MIN_CHARS} characters, or at least {@link NODE_SERVER_COOKIE_MASK_DIGIT_MIN_CHARS} characters and an ASCII digit (no protocol word contains a digit; shorter or all-letter values such as `system` and `failed` are no session secret). A value in double quotes is also masked without its quotes.
 *
 * @param values - The cookie values.
 * @returns The distinct candidates, longest first.
 * @example
 * cookieMaskValues(['s%3Asid1234567890abcdef.sigABCDEFGHIJKLMNOP'])
 * // => ['s%3Asid1234567890abcdef.sigABCDEFGHIJKLMNOP', 's:sid1234567890abcdef.sigABCDEFGHIJKLMNOP', 'sid1234567890abcdef.sigABCDEFGHIJKLMNOP', 'sid1234567890abcdef', 'sigABCDEFGHIJKLMNOP']
 */
export function cookieMaskValues(values: readonly string[]): string[] {
  const candidates = new Set<string>()
  for (const quotedValue of values) {
    const forms = [quotedValue]
    // A quoted cookie value (`sid="abc"`) is echoed with or without its quotes; the unquoted form is the one decoded and split.
    const value = unquoteCookieValue(quotedValue)
    if (value !== quotedValue) forms.push(value)
    // The decoded form (the value itself when the escape is malformed) is the one that gets split.
    let decoded = value
    try {
      decoded = decodeURIComponent(value)
      forms.push(decoded)
    } catch {
      // A malformed escape has no decoded form.
    }
    const unprefixed = decoded.startsWith('s:') ? decoded.slice(2) : decoded
    forms.push(unprefixed)
    // A signed value: payload and signature are each worth masking.
    const dot = unprefixed.lastIndexOf('.')
    if (dot !== -1)
      forms.push(unprefixed.slice(0, dot), unprefixed.slice(dot + 1))
    for (const form of forms) if (isMaskable(form)) candidates.add(form)
  }
  // Stable sort keeps first-seen order among equal lengths.
  return [...candidates].sort((a, b) => b.length - a.length)
}

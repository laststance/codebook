import { VITE_MASKED_VALUE_MIN_CHARS } from '../constants'

/**
 * Lists the texts that stand for each session cookie value, for masking in published output.
 *
 * Why it exists: a signed cookie (express-session `s%3Asid.sig`, Better Auth `token.signature`) is echoed by servers in decoded or split forms, and each form must be hidden.
 * Called by the node-server run when it builds the masking set from the session cookies' seen values.
 * Candidates: the value, its URL-decoded form, and the parts split at the last `.` (after decoding, with a leading `s:` removed), each at least {@link VITE_MASKED_VALUE_MIN_CHARS} characters.
 *
 * @param values - The cookie values.
 * @returns The distinct candidates, longest first.
 * @example
 * cookieMaskValues(['s%3Asid123456.sigABCDEF'])
 * // => ['s%3Asid123456.sigABCDEF', 's:sid123456.sigABCDEF', 'sid123456.sigABCDEF', 'sid123456', 'sigABCDEF']
 */
export function cookieMaskValues(values: readonly string[]): string[] {
  const candidates = new Set<string>()
  for (const value of values) {
    const forms = [value]
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
    for (const form of forms)
      if (form.length >= VITE_MASKED_VALUE_MIN_CHARS) candidates.add(form)
  }
  // Stable sort keeps first-seen order among equal lengths.
  return [...candidates].sort((a, b) => b.length - a.length)
}

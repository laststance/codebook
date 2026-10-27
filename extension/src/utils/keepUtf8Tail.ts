/**
 * Keeps the last bytes of a text as UTF-8, cut at a character boundary, so a bounded output tail never starts with a broken character (U+FFFD) where the cut fell inside one.
 * Called by {@link captureProcessOutput} and {@link launchDevelopmentServer} for the output tails they keep.
 * @param text - The text whose end is kept.
 * @param limitBytes - The most UTF-8 bytes to keep.
 * @returns `text` itself when it fits; otherwise its end of at most `limitBytes` bytes, starting at the first whole character.
 * @example
 * keepUtf8Tail('abcdef', 3)   // => 'def'
 * keepUtf8Tail('aé', 1)       // => '' (the cut falls inside é, whose two bytes do not fit)
 */
export function keepUtf8Tail(text: string, limitBytes: number): string {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= limitBytes) return text
  let start = bytes.length - limitBytes
  // A UTF-8 continuation byte (10xxxxxx) is the inside of a character; the tail starts after it.
  while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start++
  return bytes.subarray(start).toString('utf8')
}

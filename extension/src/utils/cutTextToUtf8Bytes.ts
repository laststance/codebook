/**
 * Cuts a text to at most a number of UTF-8 bytes without saying so, never inside a character, so a stored field that a schema bounds in bytes stays inside its bound and stays valid text.
 * Called by {@link maskNodeServerConfiguration} for the request body a Node server history stores after masking; it is the byte counterpart of {@link cutTextToLength}, which counts UTF-16 units.
 * @param text - The text to bound.
 * @param limitBytes - The most UTF-8 bytes the result may hold.
 * @returns `text` itself when it fits; otherwise its longest beginning of at most `limitBytes` bytes that ends between characters.
 * @example
 * cutTextToUtf8Bytes('abcdef', 3) // => 'abc'
 * cutTextToUtf8Bytes('aé', 2) // => 'a' (the two bytes of é do not fit after the a)
 */
export function cutTextToUtf8Bytes(text: string, limitBytes: number): string {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= limitBytes) return text
  let end = limitBytes
  // A continuation byte (10xxxxxx) at the cut is the inside of a character; the cut moves back to the character's first byte.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--
  return bytes.subarray(0, end).toString('utf8')
}

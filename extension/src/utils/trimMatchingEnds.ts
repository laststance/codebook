/**
 * Trims each edge once for the Wiki address readers and {@link profileProcesses}, preserving each caller's exact character set without rescanning internal whitespace.
 * @param text - The address or argument to read.
 * @param character - A non-global, non-sticky pattern matching one removable character.
 * @returns The text between the first and last characters outside the set, or an empty string.
 * @example
 * trimMatchingEnds(' x  y ', /[\t\n\v\f\r ]/) // => 'x  y'
 */
export function trimMatchingEnds(text: string, character: RegExp): string {
  let start = 0
  let end = text.length
  // Only edge characters can be removed; internal runs are never searched.
  while (start < end && character.test(text.charAt(start))) start += 1
  while (end > start && character.test(text.charAt(end - 1))) end -= 1
  return text.slice(start, end)
}

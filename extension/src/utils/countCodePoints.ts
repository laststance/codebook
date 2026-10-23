/**
 * Counts the code points of a part of a text without copying it, so the output index can size a line of a long recording without making an array of its characters; called by {@link indexNodeTestOutput} for each part of a line.
 * A lone surrogate counts as one code point, as `Array.from` counts it.
 * @param text - The text.
 * @param from - The UTF-16 offset the part starts at.
 * @param to - The UTF-16 offset the part ends at (exclusive).
 * @returns The code points of `text.slice(from, to)`.
 * @example countCodePoints('a😀b', 0, 4) // => 3
 */
export function countCodePoints(
  text: string,
  from: number,
  to: number,
): number {
  let count = 0
  for (let position = from; position < to; position++) {
    const unit = text.charCodeAt(position)
    // A high surrogate followed by a low one is one code point, so the low one is skipped.
    if (unit >= 0xd800 && unit <= 0xdbff && position + 1 < to) {
      const next = text.charCodeAt(position + 1)
      if (next >= 0xdc00 && next <= 0xdfff) position++
    }
    count++
  }
  return count
}

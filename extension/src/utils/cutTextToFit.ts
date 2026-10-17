import { CUT_TEXT_MARKER } from '../constants'

/**
 * Cuts a text to its longest beginning that still fits a bound once {@link CUT_TEXT_MARKER} says it was cut, for a text whose size is bounded by how it is stored rather than by a count of characters; called by {@link Evidence.recordFailure} for the reason of each failure it keeps past a refusal (one of each type, row 706), whose journal line must fit {@link EVENT_DETAIL_LIMIT_BYTES} (Cycle 0046 row 698).
 * The text is cut between characters (code points), never inside a surrogate pair. `fits` must grow no more permissive as the text grows, as a byte count of the text does.
 * @param text - The text to bound.
 * @param fits - Says whether a candidate text fits the bound.
 * @returns
 * - `text` itself when it fits
 * - Otherwise its longest beginning that fits with {@link CUT_TEXT_MARKER} appended, or the marker alone when no beginning does
 * @example
 * cutTextToFit('Selected debugger terminated', (candidate) => candidate.length <= 64) // => 'Selected debugger terminated'
 * cutTextToFit('x'.repeat(100), (candidate) => candidate.length <= 20) // => 'xxxxxxxxxxxxx… [cut]'
 */
export function cutTextToFit(
  text: string,
  fits: (candidate: string) => boolean,
): string {
  if (fits(text)) return text
  const characters = Array.from(text)
  const cutTo = (count: number): string =>
    characters.slice(0, count).join('') + CUT_TEXT_MARKER
  // The longest count whose beginning fits with the marker; a count of zero is the marker alone.
  let fitting = 0,
    tooLong = characters.length
  while (tooLong - fitting > 1) {
    const middle = Math.floor((fitting + tooLong) / 2)
    if (fits(cutTo(middle))) fitting = middle
    else tooLong = middle
  }
  return cutTo(fitting)
}

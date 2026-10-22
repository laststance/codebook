/**
 * Keeps the end of a text, so a reader of recorded output sees what came last before the selected moment; the counterpart of {@link cutTextToFit}, which keeps a text's beginning. Called by {@link accumulateNodeTestOutput} for the first line it keeps when that line does not fit whole.
 * The text is cut between characters (code points), never inside a surrogate pair, and only its end is read.
 * @param text - The text to cut.
 * @param keep - How many code points of its end to keep; zero keeps nothing.
 * @returns
 * - `text` itself when it has at most `keep` code points
 * - Otherwise its last `keep` code points
 * @example
 * cutTextToTail('stdout line', 4) // => 'line'
 * cutTextToTail('ok', 10)         // => 'ok'
 */
export function cutTextToTail(text: string, keep: number): string {
  if (keep <= 0) return ''
  // Only the end is read: a code point is at most two UTF-16 units, so the last 2 × keep units hold the code points kept, and a long text costs its tail, not its length.
  const end = text.length > keep * 2 ? text.slice(-keep * 2) : text
  const characters = Array.from(end)
  if (end === text && characters.length <= keep) return text
  return characters.slice(-keep).join('')
}

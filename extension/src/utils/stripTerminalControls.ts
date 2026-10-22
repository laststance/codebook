import { TERMINAL_CONTROL_STRING_LOOKAHEAD_CODE_POINTS } from '../constants'

const LOOKAHEAD = TERMINAL_CONTROL_STRING_LOOKAHEAD_CODE_POINTS

/**
 * ANSI escape sequences, each bounded by the next {@link TERMINAL_CONTROL_STRING_LOOKAHEAD_CODE_POINTS} code points (an introducer with no terminator in that distance is a stray and falls through to the single-escape branch, which removes only its own code points):
 * - OSC (`ESC ]`, or U+009D) up to BEL, `ESC \` or the 8-bit string terminator U+009C;
 * - DCS, SOS, PM and APC (`ESC P`, `ESC X`, `ESC ^`, `ESC _`, or U+0090, U+0098, U+009E, U+009F) up to `ESC \` or U+009C;
 * - CSI (`ESC [`, or U+009B, then parameters, intermediates and a final byte);
 * - the other escapes (intermediates such as the `(` of a character-set choice, then one final character, as in `ESC 7` or `ESC M`).
 */
const ANSI_ESCAPES = new RegExp(
  [
    `(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C]{0,${LOOKAHEAD}}?(?:\\u0007|\\u001B\\\\|\\u009C)`,
    `(?:\\u001B[PX^_]|[\\u0090\\u0098\\u009E\\u009F])[^\\u001B\\u009C]{0,${LOOKAHEAD}}?(?:\\u001B\\\\|\\u009C)`,
    `(?:\\u001B\\[|\\u009B)[0-?]{0,${LOOKAHEAD}}[ -/]{0,${LOOKAHEAD}}[@-~]`,
    '\\u001B[ -/]*[0-~]',
  ].join('|'),
  'gu',
)

/** C0 controls other than tab and line feed, DEL and the C1 controls, and the bidirectional controls that can reorder what a reader sees (the set {@link sanitizeCause} removes, with tab and line feed kept). */
const UNREADABLE_CONTROLS =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/g

/**
 * Removes what a terminal would interpret instead of show from the pieces of one recorded stream, so a control string split across pieces (the launcher ends an output entry at 4,096 characters) is removed whole and its tail never shows as text (F109, F148); called by {@link indexNodeTestOutput} for each channel's output entries and by {@link stripTerminalControls} for one text.
 * Escapes are found in the pieces joined; a string whose terminator arrives in a later piece is removed across both, and an introducer with no terminator within the next 4,096 code points of the joined stream is a stray: only its own code points go.
 * @param pieces - The stream's pieces in order.
 * @returns The pieces in order, each without ANSI escape sequences, C0 controls other than tab and line feed, DEL, C1 controls and bidirectional controls; the same count as `pieces`.
 * @example
 * stripTerminalControlsAcross(['a\u001b[3', '2mb\u001b]0;ti', 'tle\u0007c']) // => ['a', 'b', 'c']
 */
export function stripTerminalControlsAcross(
  pieces: readonly string[],
): string[] {
  const joined = pieces.join('')
  // Escapes go first: their ESC is itself a C0 control, and removing it alone would leave `[32m` behind.
  const ranges = Array.from(joined.matchAll(ANSI_ESCAPES), (match) => ({
    from: match.index,
    to: match.index + match[0].length,
  }))
  let rangeIndex = 0,
    offset = 0
  return pieces.map((piece) => {
    const start = offset,
      end = offset + piece.length
    offset = end
    // A range that ends before this piece cannot touch a later one either.
    while (rangeIndex < ranges.length && ranges[rangeIndex]!.to <= start)
      rangeIndex++
    let kept = '',
      cursor = start
    for (
      let index = rangeIndex;
      index < ranges.length && ranges[index]!.from < end;
      index++
    ) {
      const { from, to } = ranges[index]!
      // Text before the range stays; the part of a range inside this piece goes, wherever the range began or ends.
      if (from > cursor) kept += joined.slice(cursor, from)
      cursor = Math.max(cursor, Math.min(to, end))
    }
    kept += joined.slice(cursor, end)
    return kept.replace(UNREADABLE_CONTROLS, '')
  })
}

/**
 * Removes what a terminal would interpret instead of show from a recorded text, so the replay's surfaces show the text and nothing in it can recolor, move or reorder what the learner reads; called by {@link sanitizeNodeTestHistory} for each recorded text a replay surface prints.
 * Tabs and line feeds stay; a carriage return goes, so a `\r\n` line end reads as one line feed.
 * @param text - One recorded text.
 * @returns The text without ANSI escape sequences, C0 controls other than tab and line feed, DEL, C1 controls and bidirectional controls.
 * @example
 * stripTerminalControls('\u001b[32m✓\u001b[39m passes\r\n') // => '✓ passes\n'
 * stripTerminalControls('total\t3\n')                       // => 'total\t3\n'
 */
export function stripTerminalControls(text: string): string {
  return stripTerminalControlsAcross([text])[0]!
}

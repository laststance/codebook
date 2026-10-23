import { TERMINAL_CONTROL_STRING_LOOKAHEAD_CODE_POINTS } from '../constants'

import { isSurrogatePairAt } from './isSurrogatePairAt'

const LOOKAHEAD = TERMINAL_CONTROL_STRING_LOOKAHEAD_CODE_POINTS

/**
 * The ANSI escape sequences that need no scan of a string payload, found by one pass:
 * - the introducers of the control strings (OSC `ESC ]` or U+009D; DCS, SOS, PM and APC `ESC P`, `ESC X`, `ESC ^`, `ESC _` or U+0090, U+0098, U+009E, U+009F), whose payload {@link findStringEnd} measures;
 * - CSI (`ESC [`, or U+009B, then parameters, intermediates and a final byte), each part bounded by {@link TERMINAL_CONTROL_STRING_LOOKAHEAD_CODE_POINTS} code points;
 * - the other escapes (intermediates such as the `(` of a character-set choice, then one final character, as in `ESC 7` or `ESC M`).
 * The order is the priority: a string introducer that no terminator closes falls through to the single-escape branch, which removes only its own code points.
 */
const ANSI_TOKENS = new RegExp(
  [
    '(?<osc>\\u001B\\]|\\u009D)',
    '(?<other>\\u001B[PX^_]|[\\u0090\\u0098\\u009E\\u009F])',
    `(?:\\u001B\\[|\\u009B)[0-?]{0,${LOOKAHEAD}}[ -/]{0,${LOOKAHEAD}}[@-~]`,
    '\\u001B[ -/]*[0-~]',
  ].join('|'),
  'gu',
)

/** The first code unit that ends or breaks an OSC payload (BEL, ESC or the 8-bit string terminator) and the first that does so for the other strings (ESC or the 8-bit string terminator). */
const OSC_STOP = /[\u0007\u001B\u009C]/g
const OTHER_STOP = /[\u001B\u009C]/g

/** A remembered search for a payload stop: the search began at `from` and found the first stop at `at` (`-1` for none), so every start in `from..at` has the same answer. */
type RememberedStop = { from: number; at: number }

/**
 * Finds where the control string that starts at `from` ends, in time linear in the text however many unterminated introducers it holds: the first code unit that can end or break the payload is searched once and remembered, so a later introducer before it reuses the answer (F289).
 * @param joined - The stream.
 * @param from - The UTF-16 offset of the first payload code unit (after the introducer).
 * @param isOsc - Whether the string is an OSC (BEL ends it too).
 * @param remembered - The remembered search of this string kind, updated here.
 * @param astralBefore - The count of surrogate pairs before each offset, or `undefined` when the stream holds none (a code unit is then a code point).
 * @returns The offset just after the terminator, or `undefined` when the string has none within {@link TERMINAL_CONTROL_STRING_LOOKAHEAD_CODE_POINTS} code points (a stray introducer).
 * @example findStringEnd('\u009Dtitle\u0007x', 1, true, { from: 0, at: -2 }, undefined) // => 8
 */
function findStringEnd(
  joined: string,
  from: number,
  isOsc: boolean,
  remembered: RememberedStop,
  astralBefore: Int32Array | undefined,
): number | undefined {
  // A search that began at or before `from` and found its stop at or after it answers this start too.
  if (!(
    remembered.from <= from &&
    (remembered.at === -1 || from <= remembered.at)
  )) {
    const stop = isOsc ? OSC_STOP : OTHER_STOP
    stop.lastIndex = from
    const found = stop.exec(joined)
    remembered.from = from
    remembered.at = found ? found.index : -1
  }
  const at = remembered.at
  if (at === -1) return undefined
  const unit = joined.charCodeAt(at)
  // ESC ends the string only as the first half of `ESC \`; any other ESC breaks it.
  const length =
    unit === 0x1b ? (joined.charCodeAt(at + 1) === 0x5c ? 2 : 0) : 1
  if (length === 0) return undefined
  const codePoints =
    at - from - (astralBefore ? astralBefore[at]! - astralBefore[from]! : 0)
  return codePoints <= LOOKAHEAD ? at + length : undefined
}

/**
 * Counts the surrogate pairs before each offset of a text, so the code points between two offsets are their distance less the pairs between them; called by {@link findAnsiRanges} (F289).
 * @param text - The stream.
 * @returns `table[i]` is the number of pairs inside `text.slice(0, i)`; `undefined` for a text without a pair, where a code unit is a code point.
 * @example countSurrogatePairsBefore('a😀')?.at(-1) // => 1
 */
function countSurrogatePairsBefore(text: string): Int32Array | undefined {
  if (!/[\ud800-\udbff][\udc00-\udfff]/.test(text)) return undefined
  const table = new Int32Array(text.length + 1)
  for (let index = 0; index < text.length; index++) {
    table[index + 1] = table[index]! + (isSurrogatePairAt(text, index) ? 1 : 0)
  }
  return table
}

/**
 * Finds every ANSI escape sequence of the stream as the offsets it spans, in one pass over the text.
 * @param joined - The stream.
 * @returns The ranges in order, each `from` inclusive and `to` exclusive.
 * @example findAnsiRanges('a\u001b[31mb') // => [{ from: 1, to: 6 }]
 */
function findAnsiRanges(joined: string): { from: number; to: number }[] {
  const astralBefore = countSurrogatePairsBefore(joined)
  const oscStop: RememberedStop = { from: 0, at: -2 }
  const otherStop: RememberedStop = { from: 0, at: -2 }
  const ranges: { from: number; to: number }[] = []
  ANSI_TOKENS.lastIndex = 0
  for (;;) {
    const match = ANSI_TOKENS.exec(joined)
    if (!match) break
    const from = match.index
    let to = from + match[0].length
    const groups = match.groups!
    if (groups.osc !== undefined || groups.other !== undefined) {
      const end = findStringEnd(
        joined,
        to,
        groups.osc !== undefined,
        groups.osc !== undefined ? oscStop : otherStop,
        astralBefore,
      )
      if (end !== undefined) to = end
      // A stray 8-bit introducer is left to the control removal below; a stray 7-bit one goes with its own second code point.
      else if (match[0].length === 1) continue
    }
    ranges.push({ from, to })
    ANSI_TOKENS.lastIndex = to
  }
  return ranges
}

/** C0 controls other than tab and line feed, DEL and the C1 controls, and the bidirectional controls that can reorder what a reader sees (the set {@link sanitizeCause} removes, with tab and line feed kept). */
const UNREADABLE_CONTROLS =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

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
  const ranges = findAnsiRanges(joined)
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

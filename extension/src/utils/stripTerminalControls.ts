/** ANSI escape sequences: CSI (`ESC [`, or its 8-bit form U+009B, then parameters, intermediates and a final byte), OSC (`ESC ]`, or its 8-bit form U+009D, up to BEL, `ESC \` or the 8-bit string terminator U+009C, or the text's end) and the other escapes (intermediates such as the `(` of a character-set choice, then one final character, as in `ESC 7` or `ESC M`). */
const ANSI_ESCAPES =
  /\u009B[0-?]*[ -/]*[@-~]|(?:\u001B\]|\u009D)[^\u0007\u001B\u009C]*(?:\u0007|\u001B\\|\u009C)?|\u001B(?:\[[0-?]*[ -/]*[@-~]|[ -/]*[0-~])/g

/** C0 controls other than tab and line feed, DEL and the C1 controls, and the bidirectional controls that can reorder what a reader sees (the set {@link sanitizeCause} removes, with tab and line feed kept). */
const UNREADABLE_CONTROLS =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

/**
 * Removes what a terminal would interpret instead of show from a test's recorded output, so the Application pane shows the output's text and nothing in it can recolor, move or reorder what the learner reads; called by {@link indexNodeTestOutput} for each output entry.
 * Tabs and line feeds stay; a carriage return goes, so a `\r\n` line end reads as one line feed.
 * @param text - One recorded output chunk.
 * @returns The chunk without ANSI escape sequences, C0 controls other than tab and line feed, DEL, C1 controls and bidirectional controls.
 * @example
 * stripTerminalControls('\u001b[32m✓\u001b[39m passes\r\n') // => '✓ passes\n'
 * stripTerminalControls('total\t3\n')                       // => 'total\t3\n'
 */
export function stripTerminalControls(text: string): string {
  // Escapes go first: their ESC is itself a C0 control, and removing it alone would leave `[32m` behind.
  return text.replace(ANSI_ESCAPES, '').replace(UNREADABLE_CONTROLS, '')
}

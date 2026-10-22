/** ANSI escape sequences: CSI (`ESC [`, parameters, intermediates and a final byte), OSC (`ESC ]` up to BEL or `ESC \`, or the text's end) and the other escapes (intermediates such as the `(` of a character-set choice, then one final character, as in `ESC 7` or `ESC M`). */
const ANSI_ESCAPES =
  /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\)?|[ -/]*[0-~])/g

/** C0 controls other than tab and line feed, and the bidirectional controls that can reorder what a reader sees. */
const UNREADABLE_CONTROLS =
  /[\u0000-\u0008\u000B-\u001F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

/**
 * Removes what a terminal would interpret instead of show from a test's recorded output, so the Application pane shows the output's text and nothing in it can recolor, move or reorder what the learner reads; called by {@link indexNodeTestOutput} for each output entry.
 * Tabs and line feeds stay; a carriage return goes, so a `\r\n` line end reads as one line feed.
 * @param text - One recorded output chunk.
 * @returns The chunk without ANSI escape sequences, C0 controls other than tab and line feed, and bidirectional controls.
 * @example
 * stripTerminalControls('\u001b[32m✓\u001b[39m passes\r\n') // => '✓ passes\n'
 * stripTerminalControls('total\t3\n')                       // => 'total\t3\n'
 */
export function stripTerminalControls(text: string): string {
  // Escapes go first: their ESC is itself a C0 control, and removing it alone would leave `[32m` behind.
  return text.replace(ANSI_ESCAPES, '').replace(UNREADABLE_CONTROLS, '')
}

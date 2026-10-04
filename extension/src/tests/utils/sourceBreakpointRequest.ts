/**
 * Builds the position an editor sends for one source breakpoint in a `setBreakpoints` request, so every harness that models the editor sends what VS Code and Cursor send: a breakpoint at character 0 carries no column.
 * Called by {@link nativeParticipantsHarness}, {@link configuredRuntimeHarness} and the Node test run harness for each breakpoint of the replaced source.
 * @param start - The breakpoint's zero-based start in the editor.
 * @returns The one-based line, and the one-based column only for a character after 0.
 * @example
 * sourceBreakpointRequest({ line: 19, character: 4 }) // => { line: 20, column: 5 }
 * sourceBreakpointRequest({ line: 19, character: 0 }) // => { line: 20 }
 */
export function sourceBreakpointRequest(start: {
  line: number
  character: number
}): { line: number; column?: number } {
  return start.character > 0
    ? { line: start.line + 1, column: start.character + 1 }
    : { line: start.line + 1 }
}

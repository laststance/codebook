/** Node's own inspector lines: the listening address (with the session's socket path), its help pointer and the attach notice. */
const INSPECTOR_BANNER_LINE =
  /^(Debugger listening on |Debugger attached\.|For help, see: https:\/\/nodejs\.org\/)/

/**
 * Drops Node's inspector banner lines from an API output tail.
 *
 * Why it exists: an API started under `--inspect-brk` prints `Debugger listening…` and `Debugger attached.` first; they are not the API's own output and would fill the bounded tail an agent reads after a failure. Called by {@link ConfiguredBrowserRun} when it builds the run view's `apiServer.outputTail`.
 * @param tail - The API's masked output tail.
 * @returns The tail without banner lines; other lines keep their order and text.
 * @example
 * withoutInspectorBanner('Debugger listening on ws://127.0.0.1:9229/x\nDebugger attached.\nboom') // => 'boom'
 */
export function withoutInspectorBanner(tail: string): string {
  return tail
    .split('\n')
    .filter((line) => !INSPECTOR_BANNER_LINE.test(line.trimStart()))
    .join('\n')
    .trim()
}

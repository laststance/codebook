/**
 * Reads the two lines Chrome writes to `<profile>/DevToolsActivePort`: the random debugging port and the browser endpoint path.
 * Called by the owned launch while it waits for the spawned browser.
 * @param text - The file's text; may be partial while Chrome is still writing it.
 * @returns The port and the endpoint path, or `undefined` while the text is incomplete.
 * @example
 * readDevToolsActivePort('51234\n/devtools/browser/abc\n') // => { port: 51234, path: '/devtools/browser/abc' }
 * readDevToolsActivePort('51234')                          // => undefined
 */
export function readDevToolsActivePort(
  text: string,
): { port: number; path: string } | undefined {
  const [portLine, pathLine] = text.split('\n')
  const port = Number(portLine)
  if (!Number.isInteger(port) || port <= 0) return undefined
  if (pathLine === undefined || !pathLine.startsWith('/devtools/browser/'))
    return undefined
  return { port, path: pathLine.trim() }
}

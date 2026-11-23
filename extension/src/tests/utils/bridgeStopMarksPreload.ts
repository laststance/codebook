/**
 * Gives the source of a preload that makes a bridge child process mark on stderr the moments a stop-path test orders its steps by; written to a file and passed with `--require` by the Cursor and Devin bridge tests.
 * The marks, each a line of its own:
 * - `STDIN_END_SEEN` when stdin ends. The listener is registered before the bridge's own, so the bridge's handler runs in the same emit, before the test can read the mark.
 * - `UNKNOWN_SESSION_REJECTED <n>` one macrotask after the SDK's n-th request failed with HTTP 404: every microtask of that rejection has run by then, so the bridge's forwarding has reached the wait for its reconnect.
 * - `SESSION_ASSIGNED <id>` when the headers of an answer named a session (the SDK has stored that id).
 * - `REFUSAL_HEADERS_SEEN` when the headers of an HTTP 401 or 403 answer arrived, before its body was read.
 * - `STDIN_DATA_READ <n>` when stdin emits its n-th chunk to whoever reads it. Made by wrapping `process.stdin.emit`, so it adds no listener: the stdio transport's close still finds itself the only reader and pauses stdin.
 * - `STDIN_PAUSED` each time `process.stdin.pause()` is called.
 * @returns The preload's source; the SDK's transport is required by the absolute path this process resolves, the module the bridge loads.
 * @example
 * await writeFile(preloadPath, bridgeStopMarksPreload())
 */
export function bridgeStopMarksPreload(): string {
  const transportPath =
    require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')
  return `const { writeSync } = require('node:fs')
const http = require(${JSON.stringify(transportPath)})
process.stdin.once('end', () => writeSync(2, 'STDIN_END_SEEN\\n'))
let stdinDataReads = 0
const originalStdinEmit = process.stdin.emit
process.stdin.emit = function (event, ...rest) {
  if (event === 'data') {
    stdinDataReads += 1
    writeSync(2, 'STDIN_DATA_READ ' + stdinDataReads + '\\n')
  }
  return originalStdinEmit.call(this, event, ...rest)
}
const originalStdinPause = process.stdin.pause
process.stdin.pause = function (...rest) {
  writeSync(2, 'STDIN_PAUSED\\n')
  return originalStdinPause.apply(this, rest)
}
const originalSend = http.StreamableHTTPClientTransport.prototype.send
let unknownSessionRejections = 0
http.StreamableHTTPClientTransport.prototype.send = function (...rest) {
  return originalSend.apply(this, rest).catch((error) => {
    if (error instanceof http.StreamableHTTPError && error.code === 404) {
      unknownSessionRejections += 1
      const count = unknownSessionRejections
      setImmediate(() => writeSync(2, 'UNKNOWN_SESSION_REJECTED ' + count + '\\n'))
    }
    throw error
  })
}
const originalFetch = globalThis.fetch
globalThis.fetch = async (...rest) => {
  const response = await originalFetch(...rest)
  const sessionId = response.headers.get('mcp-session-id')
  if (sessionId) writeSync(2, 'SESSION_ASSIGNED ' + sessionId + '\\n')
  if (response.status === 401 || response.status === 403) writeSync(2, 'REFUSAL_HEADERS_SEEN\\n')
  return response
}
`
}

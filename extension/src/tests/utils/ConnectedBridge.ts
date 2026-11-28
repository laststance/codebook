import { type ServerResponse } from 'node:http'

/** A Devin bridge process behind a proxy the test controls, as {@link startConnectedBridge} (connected) or {@link launchDevinBridge} (still starting) starts it. */
export interface ConnectedBridge {
  /** The global storage folder, the parent of the agent folder. */
  root: string
  agentDir: string
  /** The folder of the window's workspace, the bridge's working folder. */
  directory: string
  /** The initialize requests and the other requests that reached the proxy since the bridge connected ({@link startConnectedBridge}) or since its spawn ({@link launchDevinBridge}), and the `tools/list` requests per session id. */
  counts: {
    initializes: number
    others: number
    toolsListBySession: Record<string, number>
  }
  /** The status the proxy answers to every request instead of forwarding it; `undefined` forwards. */
  proxy: {
    refuseWith: number | undefined
    /** Called with the JSON-RPC method of every request (empty for a request without one), the count of initializes seen since the bridge connected (since its spawn, the one being decided included, for {@link launchDevinBridge}), the HTTP method (`DELETE` for the session release), the request's `mcp-session-id`, whether the bridge already closed the request's connection, and the response; resolves the status to answer instead of forwarding it, `undefined` forwards, `answered` when it wrote (or holds) the response itself. It may change the disk first. */
    decide?: (
      method: string,
      initializesSoFar: number,
      httpMethod: string,
      sessionId: string | undefined,
      isClientGone: () => boolean,
      outgoing: ServerResponse,
    ) => Promise<number | 'answered' | undefined>
  }
  readStderr: () => string
  /** Resolves with the exit code once the process ended. */
  exited: Promise<number | null>
  /** The JSON-RPC messages the bridge wrote to stdout so far; an answer carries `result` or `error`. */
  readMessages: () => Array<{ id?: number; result?: unknown; error?: unknown }>
  /** Makes the server forget the bridge's session, so that its next request answers 404 `Unknown MCP session`. */
  expireSession: () => Promise<void>
  /** Does the MCP handshake a client makes (request 0 `initialize`, then `initialized`). */
  handshake: () => void
  /** Writes `text` to the bridge's stdin as it is, so a test can split a message across writes. */
  write: (text: string) => void
  /** Asks `tools/list` as request `id`. */
  askToolsList: (id: number) => void
  /** Signals the bridge process (SIGUSR2) so a preload given to {@link startConnectedBridge} starts its work. */
  arm: () => void
  /** Closes the bridge's stdin, the way Devin Desktop ends a bridge. */
  closeStdin: () => void
  /** Sends a signal to the bridge process. */
  signal: (name: NodeJS.Signals) => void
}

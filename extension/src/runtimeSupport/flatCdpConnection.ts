import type { FlatCdpConnection } from '../chromeExtensionContracts'
import { EXTENSION_CDP_COMMAND_TIMEOUT_MS } from '../constants'

import { openWebSocket } from './utils/openWebSocket'

/** The transport a {@link WebSocketFlatCdp} writes to and listens on: a WebSocket, or a stand-in in a test. */
export type FlatCdpTransport = Pick<
  WebSocket,
  'addEventListener' | 'send' | 'close'
>

/**
 * The failure of one CDP command: the answer's code and message, so a caller can tell a missing method from any other refusal.
 * Thrown by {@link WebSocketFlatCdp.request}; read by {@link isMethodNotFound}.
 * @example
 * throw new FlatCdpCommandError('Extensions.loadUnpacked', -32601, "'Extensions.loadUnpacked' wasn't found")
 */
export class FlatCdpCommandError extends Error {
  constructor(
    readonly method: string,
    /** The CDP error code; `undefined` for a timeout or a closed connection. */
    readonly code: number | undefined,
    readonly detail: string,
  ) {
    super(`${method}: ${detail}`)
  }
}

/**
 * Says whether a failure means the browser does not offer the command at all (CR2).
 * Called by the owned launch for each `Extensions.*` and `ServiceWorker.*` command, to answer `CHROME_COMMAND_UNAVAILABLE` instead of a generic failure.
 * @param error - Anything thrown by a command.
 * @returns `true` for CDP code -32601, for a message that says the method "wasn't found", and for js-debug-style "Method not available."
 * @example
 * isMethodNotFound(new FlatCdpCommandError('Foo.bar', -32601, "'Foo.bar' wasn't found")) // => true
 * isMethodNotFound(new FlatCdpCommandError('Foo.bar', -32600, 'File path cannot be resolved.')) // => false
 */
export function isMethodNotFound(error: unknown): boolean {
  if (!(error instanceof FlatCdpCommandError)) return false
  return (
    error.code === -32601 ||
    /wasn't found|Method not available/i.test(error.detail)
  )
}

type PendingCommand = {
  method: string
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type Listener = (params: Record<string, unknown>, sessionId?: string) => void

/** What the wire carries in either direction that this client reads. */
type WireMessage = {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: { code?: number; message?: string }
  sessionId?: string
}

/**
 * Reads one frame as a message; called by {@link WebSocketFlatCdp} for every frame.
 * @param text - The frame's text.
 * @returns The message; `undefined` for text that is no JSON and for JSON that is no object (`null`, a number, a string, an array).
 * @example
 * parseWireMessage('{"id":1,"result":{}}') // => { id: 1, result: {} }
 * parseWireMessage('null')                 // => undefined
 */
function parseWireMessage(text: string): WireMessage | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return undefined
  return parsed
}

/**
 * A browser-level CDP client that routes flattened target sessions, for the browser Codebook spawns itself.
 * Why not {@link Cdp}: that client wraps one js-debug page proxy, types its commands by the page protocol and has no `sessionId`; a browser endpoint needs both the browser's own commands and one session per attached target.
 * Created by {@link connectFlatCdp} in the owned launch; the debugger and the click executor depend only on {@link FlatCdpConnection}.
 * @example
 * const cdp = new WebSocketFlatCdp(socket)
 * const { id } = await cdp.request('Extensions.loadUnpacked', { path: root })
 */
export class WebSocketFlatCdp implements FlatCdpConnection {
  private nextId = 0
  private closed = false
  private readonly pending = new Map<number, PendingCommand>()
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(private readonly socket: FlatCdpTransport) {
    socket.addEventListener('message', (event) => {
      this.receive(String(event.data))
    })
    socket.addEventListener('close', () => {
      this.fail('CDP disconnected')
    })
    socket.addEventListener('error', () => {
      this.fail('CDP disconnected')
    })
  }

  request(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
    timeoutMs: number = EXTENSION_CDP_COMMAND_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    if (this.closed)
      return Promise.reject(
        new FlatCdpCommandError(method, undefined, 'CDP disconnected'),
      )
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      // Each command owns its deadline, so a slow command never holds the others.
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new FlatCdpCommandError(method, undefined, 'timed out'))
      }, timeoutMs)
      this.pending.set(id, { method, resolve, reject, timer })
      try {
        this.socket.send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId !== undefined && { sessionId }),
          }),
        )
      } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new FlatCdpCommandError(method, undefined, 'send failed'))
      }
    })
  }

  on(method: string, listener: Listener): () => void {
    const registered = this.listeners.get(method) ?? new Set<Listener>()
    registered.add(listener)
    this.listeners.set(method, registered)
    return (): void => {
      registered.delete(listener)
    }
  }

  close(): void {
    this.fail('CDP disconnected')
    this.socket.close()
  }

  /** Routes one wire message: an answer settles its command, an event reaches the listeners of its method. */
  private receive(text: string): void {
    const message = parseWireMessage(text)
    // A frame that is no JSON object cannot be attributed to a command: the connection is no longer trustworthy.
    if (!message) {
      this.close()
      return
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id)
      // An answer after its deadline is ignored.
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error)
        pending.reject(
          new FlatCdpCommandError(
            pending.method,
            message.error.code,
            message.error.message ?? 'unknown error',
          ),
        )
      else pending.resolve(message.result ?? {})
      return
    }
    if (message.method === undefined) return
    this.notify(message.method, message.params ?? {}, message.sessionId)
  }

  /** Gives an event to every listener of its method, each on its own: one that throws must not starve the ones after it or escape into the socket handler. */
  private notify(
    method: string,
    params: Record<string, unknown>,
    sessionId: string | undefined,
  ): void {
    for (const listener of [...(this.listeners.get(method) ?? [])]) {
      try {
        listener(params, sessionId)
      } catch {
        // A faulty observer is the observer's defect, not the connection's.
      }
    }
  }

  /** Rejects every outstanding command once; later commands are refused at once. */
  private fail(detail: string): void {
    if (this.closed) return
    this.closed = true
    for (const command of this.pending.values()) {
      clearTimeout(command.timer)
      command.reject(new FlatCdpCommandError(command.method, undefined, detail))
    }
    this.pending.clear()
  }
}

/**
 * Opens a browser-level WebSocket and wraps it as a {@link FlatCdpConnection}.
 * Called by the owned launch with the endpoint read from `DevToolsActivePort`.
 * @param url - `ws://127.0.0.1:<port><path>`.
 * @param timeoutMs - How long the connection may take to open.
 * @returns The open connection.
 * @throws When the socket errors or does not open in time.
 * @example
 * const cdp = await connectFlatCdp('ws://127.0.0.1:51234/devtools/browser/abc', 5_000)
 */
export async function connectFlatCdp(
  url: string,
  timeoutMs: number,
): Promise<FlatCdpConnection> {
  const socket = await openWebSocket(url, timeoutMs)
  return new WebSocketFlatCdp(socket)
}

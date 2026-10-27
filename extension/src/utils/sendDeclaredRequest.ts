import { request as httpRequest, type IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'

import {
  NODE_SERVER_EVENT_SHORT_TEXT_LIMIT_CHARS,
  NODE_SERVER_RESPONSE_READ_LIMIT_BYTES,
} from '../constants'
import { StudyError } from '../errors'
import type { NodeServerConfiguration } from '../nodeServerConfigSchemas'
import type { NodeServerResponse } from '../runtime'

import type { LoopbackHost } from './acceptsLoopbackConnection'
import { describeRedirectLocation } from './describeRedirectLocation'
import { redactSecretText } from './redactSecretText'
import { shapeResponseBody } from './shapeResponseBody'

/** What {@link sendDeclaredRequest} sends and checks. */
export type DeclaredRequestInput = {
  /** The loopback address that accepted at readiness. */
  host: LoopbackHost
  port: number
  request: NodeServerConfiguration['request']
  /** Sent as `x-codebook-run`, so the server's code can tell the request is the run's. */
  runId: string
  /** Called once the socket is connected and before any byte is written; it throws to refuse (the socket is then destroyed with zero bytes sent). */
  verifyPeer: (connection: {
    localPort: number
    remotePort: number
  }) => Promise<void>
  /** Aborts the request: the socket is destroyed and `response` rejects with the signal's reason. */
  signal: AbortSignal
  /** A clock in milliseconds for `elapsedMs`; `performance.now` unless a test names its own. */
  now?: () => number
}

/**
 * Reads a response body up to the read limit, destroying the socket there.
 * @param response - The incoming response.
 * @param onDone - Called with the bytes and whether the read was cut.
 * @param onClosedEarly - Called when the connection closes before the response is complete.
 * @example readBody(response, finish, fail)
 */
function readBody(
  response: IncomingMessage,
  onDone: (bytes: Buffer, readCut: boolean) => void,
  onClosedEarly: () => void,
): void {
  const chunks: Buffer[] = []
  let total = 0
  let finished = false
  response.on('data', (chunk: Buffer) => {
    if (finished) return
    chunks.push(chunk)
    total += chunk.length
    // Past the limit the read stops and the connection ends; a body of exactly the limit is complete, not cut.
    if (total > NODE_SERVER_RESPONSE_READ_LIMIT_BYTES) {
      finished = true
      onDone(
        Buffer.concat(chunks).subarray(
          0,
          NODE_SERVER_RESPONSE_READ_LIMIT_BYTES,
        ),
        true,
      )
      response.destroy()
    }
  })
  response.on('end', () => {
    if (finished) return
    finished = true
    onDone(Buffer.concat(chunks), false)
  })
  response.on('close', () => {
    if (!finished) onClosedEarly()
  })
}

/**
 * Sends the run's one declared request to the server over a single new loopback connection and observes its response.
 * Why: the answer is only evidence if the bytes went to the launched server: after the socket connects and before any byte is written, `verifyPeer` must accept the peer, else the socket is destroyed with nothing sent. No retry, no reconnect, no proxy, no redirect; the 1 MiB read limit and the shaped, redacted body keep the response bounded and safe to relay.
 * Called by the node-server run for `codebook_action` `http-request`.
 * @param input - The address, port, declared request, run id, peer check, abort signal and clock ({@link DeclaredRequestInput}).
 * @returns
 * - `written`: resolves when the request is written; rejects with the `verifyPeer` error (zero bytes sent), a `REQUEST_FAILED` error when the connection fails first, or the abort reason
 * - `response`: resolves with the observed response (4xx, 5xx and 3xx included); rejects with `StudyError('REQUEST_FAILED')` on a reset or close before a complete response, with the `verifyPeer` error when refused, or with the signal's reason on abort
 * @example
 * const { written, response } = sendDeclaredRequest({ host: '127.0.0.1', port: 4100, request: { method: 'GET', path: '/health' }, runId: 'r1', verifyPeer, signal })
 * await written
 * (await response).status // => 200
 */
export function sendDeclaredRequest(input: DeclaredRequestInput): {
  written: Promise<void>
  response: Promise<NodeServerResponse>
} {
  const now = input.now ?? (() => performance.now())
  const startedMs = now()
  const { request: declared } = input
  const body =
    declared.body === undefined ? undefined : Buffer.from(declared.body, 'utf8')
  let settled = false
  let outgoing: ReturnType<typeof httpRequest> | undefined
  let resolveWritten!: () => void
  let rejectWritten!: (error: unknown) => void
  let resolveResponse!: (response: NodeServerResponse) => void
  let rejectResponse!: (error: unknown) => void
  const written = new Promise<void>((resolve, reject) => {
    resolveWritten = resolve
    rejectWritten = reject
  })
  const response = new Promise<NodeServerResponse>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })
  // A caller that awaits only one of the promises must not see an unhandled rejection of the other.
  written.catch(() => undefined)
  response.catch(() => undefined)

  /** Ends the request with one failure for both promises; later events are ignored. */
  const fail = (error: unknown): void => {
    if (settled) return
    settled = true
    input.signal.removeEventListener('abort', abort)
    rejectWritten(error)
    rejectResponse(error)
    outgoing?.destroy()
  }

  const headers: Record<string, string> = {
    Host: `localhost:${input.port}`,
    'Accept-Encoding': 'identity',
    Connection: 'close',
    'User-Agent': 'codebook',
    'x-codebook-run': input.runId,
  }
  if (body && declared.contentType) {
    headers['Content-Type'] = declared.contentType
    headers['Content-Length'] = String(body.length)
  }

  try {
    outgoing = httpRequest({
      host: input.host,
      port: input.port,
      method: declared.method,
      path: declared.path,
      agent: false,
      setHost: false,
      headers,
    })
  } catch {
    fail(
      new StudyError(
        'REQUEST_FAILED',
        'The declared request could not be built; no byte was sent.',
      ),
    )
    return { written, response }
  }

  function abort(): void {
    fail(input.signal.reason)
  }
  if (input.signal.aborted) abort()
  else input.signal.addEventListener('abort', abort, { once: true })

  outgoing.once('error', (error: NodeJS.ErrnoException) =>
    fail(
      new StudyError(
        'REQUEST_FAILED',
        `The connection to the server failed before a response arrived (${error.code ?? 'error'}).`,
      ),
    ),
  )
  outgoing.once('socket', (socket: Socket) => {
    const verifyAndWrite = (): void => {
      void checkPeerThenWrite(socket)
    }
    if (socket.connecting) socket.once('connect', verifyAndWrite)
    else verifyAndWrite()
  })
  outgoing.once('response', (incoming: IncomingMessage) => {
    const contentType = incoming.headers['content-type']
    readBody(
      incoming,
      (bytes, readCut) => {
        if (settled) return
        settled = true
        input.signal.removeEventListener('abort', abort)
        const location = incoming.headers.location
        resolveResponse({
          status: incoming.statusCode ?? 0,
          ...(contentType === undefined
            ? {}
            : {
                contentType: redactSecretText(contentType).slice(
                  0,
                  NODE_SERVER_EVENT_SHORT_TEXT_LIMIT_CHARS,
                ),
              }),
          body: shapeResponseBody(bytes, contentType, readCut),
          bodyBytes: bytes.length,
          readCut,
          ...(location === undefined
            ? {}
            : { location: describeRedirectLocation(location, input.port) }),
          elapsedMs: Math.round(now() - startedMs),
        })
      },
      () =>
        fail(
          new StudyError(
            'REQUEST_FAILED',
            'The server closed the connection before a complete response arrived.',
          ),
        ),
    )
  })

  /**
   * Verifies the connected peer, then writes the request; a refused peer means zero bytes sent.
   * @param socket - The connected socket.
   */
  async function checkPeerThenWrite(socket: Socket): Promise<void> {
    const { localPort, remotePort } = socket
    try {
      if (localPort === undefined || remotePort === undefined)
        throw new StudyError(
          'REQUEST_FAILED',
          'The connection closed before the request was written.',
        )
      await input.verifyPeer({ localPort, remotePort })
    } catch (error) {
      // Nothing was written: end the socket and report the refusal.
      fail(error)
      return
    }
    if (settled || !outgoing) return
    outgoing.end(body, resolveWritten)
  }

  return { written, response }
}

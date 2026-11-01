import type { Readable, Writable } from 'node:stream'

import { SIGN_IN_BROWSER_FRAME_LIMIT_BYTES } from '../constants'

import type { FlatCdpTransport } from './flatCdpConnection'

/** The listener a {@link FlatCdpTransport} keeps per event name. */
type TransportListener = (event: { data: string }) => void

/** What the transport's `error` event carries when a frame grew past {@link SIGN_IN_BROWSER_FRAME_LIMIT_BYTES}; it names no content of the frame. */
const FRAME_TOO_LONG_MESSAGE = `The browser sent a CDP frame longer than ${SIGN_IN_BROWSER_FRAME_LIMIT_BYTES} bytes; Codebook closed its debugging pipe.`

/**
 * Wraps the two pipes of `--remote-debugging-pipe` (file descriptors 3 and 4) as the transport {@link WebSocketFlatCdp} writes to.
 * Chrome frames every CDP message with a trailing NUL byte, in both directions; chunks may split or join frames, so incoming bytes are kept as they came and cut at each NUL, and a frame is copied once, when its NUL arrives. A frame that grows past {@link SIGN_IN_BROWSER_FRAME_LIMIT_BYTES}, complete or not, closes the pipe, so a browser that never sends a NUL cannot grow the editor's memory without end.
 * Called by {@link launchSignInBrowser} with `child.stdio[3]` (to the browser) and `child.stdio[4]` (from the browser).
 * @param toBrowser - Where commands are written; ended by `close`.
 * @param fromBrowser - Where answers and events arrive; destroyed by `close`.
 * @returns A transport whose `message` events carry one complete frame as `{ data }`, whose `close` event fires once when the browser's pipe ends, and whose `error` event reports a pipe error, or a frame past the limit (its `data` says so, and `close` follows).
 * @example
 * const cdp = new WebSocketFlatCdp(createPipeCdpTransport(child.stdio[3], child.stdio[4]))
 */
export function createPipeCdpTransport(
  toBrowser: Writable,
  fromBrowser: Readable,
): FlatCdpTransport {
  const listeners = new Map<string, Set<TransportListener>>()
  // The bytes of the frame that waits for its NUL, in the chunks they came in.
  let pendingChunks: Buffer[] = []
  let pendingBytes = 0
  let didClose = false
  const emit = (name: string, data: string): void => {
    for (const listener of [...(listeners.get(name) ?? [])]) {
      Reflect.apply(listener, undefined, [{ data }])
    }
  }
  const emitClose = (): void => {
    // The pipe can report both 'end' and 'close'; the connection is told once.
    if (didClose) return
    didClose = true
    emit('close', '')
  }
  const closePipe = (): void => {
    toBrowser.end()
    fromBrowser.destroy()
    emitClose()
  }
  const closeOnLongFrame = (): void => {
    pendingChunks = []
    pendingBytes = 0
    emit('error', FRAME_TOO_LONG_MESSAGE)
    closePipe()
  }
  fromBrowser.on('data', (chunk: Buffer | string) => {
    let rest = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    // Cut every complete frame off the front; only the new bytes are searched for a NUL.
    for (
      let separator = rest.indexOf(0);
      separator !== -1;
      separator = rest.indexOf(0)
    ) {
      if (pendingBytes + separator > SIGN_IN_BROWSER_FRAME_LIMIT_BYTES) {
        closeOnLongFrame()
        return
      }
      const frame = Buffer.concat([
        ...pendingChunks,
        rest.subarray(0, separator),
      ]).toString('utf8')
      pendingChunks = []
      pendingBytes = 0
      rest = rest.subarray(separator + 1)
      emit('message', frame)
    }
    pendingBytes += rest.length
    // The rest waits for its NUL, while the frame stays within the limit.
    if (pendingBytes > SIGN_IN_BROWSER_FRAME_LIMIT_BYTES) closeOnLongFrame()
    else if (rest.length > 0) pendingChunks.push(rest)
  })
  fromBrowser.on('end', emitClose)
  fromBrowser.on('close', emitClose)
  fromBrowser.on('error', () => emit('error', ''))
  toBrowser.on('error', () => emit('error', ''))
  return {
    addEventListener(name: string, listener: unknown): void {
      if (typeof listener !== 'function') return
      const registered = listeners.get(name) ?? new Set<TransportListener>()
      registered.add((event) => Reflect.apply(listener, undefined, [event]))
      listeners.set(name, registered)
    },
    send(data: unknown): void {
      if (typeof data !== 'string')
        throw new TypeError('The CDP pipe carries text frames only.')
      toBrowser.write(`${data}\0`)
    },
    close: closePipe,
  }
}

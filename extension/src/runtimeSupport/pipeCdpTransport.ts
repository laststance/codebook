import type { Readable, Writable } from 'node:stream'

import type { FlatCdpTransport } from './flatCdpConnection'

/** The listener a {@link FlatCdpTransport} keeps per event name. */
type TransportListener = (event: { data: string }) => void

/**
 * Wraps the two pipes of `--remote-debugging-pipe` (file descriptors 3 and 4) as the transport {@link WebSocketFlatCdp} writes to.
 * Chrome frames every CDP message with a trailing NUL byte, in both directions; chunks may split or join frames, so incoming bytes are buffered and cut at each NUL.
 * Called by {@link launchSignInBrowser} with `child.stdio[3]` (to the browser) and `child.stdio[4]` (from the browser).
 * @param toBrowser - Where commands are written; ended by `close`.
 * @param fromBrowser - Where answers and events arrive; destroyed by `close`.
 * @returns A transport whose `message` events carry one complete frame as `{ data }`, whose `close` event fires once when the browser's pipe ends, and whose `error` event reports a pipe error.
 * @example
 * const cdp = new WebSocketFlatCdp(createPipeCdpTransport(child.stdio[3], child.stdio[4]))
 */
export function createPipeCdpTransport(
  toBrowser: Writable,
  fromBrowser: Readable,
): FlatCdpTransport {
  const listeners = new Map<string, Set<TransportListener>>()
  let pending = Buffer.alloc(0)
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
  fromBrowser.on('data', (chunk: Buffer | string) => {
    pending = Buffer.concat([
      pending,
      typeof chunk === 'string' ? Buffer.from(chunk) : chunk,
    ])
    // Cut every complete frame off the front; the rest waits for its NUL.
    for (
      let separator = pending.indexOf(0);
      separator !== -1;
      separator = pending.indexOf(0)
    ) {
      const frame = pending.subarray(0, separator).toString('utf8')
      pending = pending.subarray(separator + 1)
      emit('message', frame)
    }
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
    close(): void {
      toBrowser.end()
      fromBrowser.destroy()
      emitClose()
    },
  }
}

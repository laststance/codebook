import type { Readable } from 'node:stream'

import { BRIDGE_STARTUP_INPUT_LIMIT_BYTES } from '../constants'

/** The ways a hold of a bridge's input ends; returned by {@link holdBridgeInput}. */
export interface BridgeInputHold {
  /** Stops reading and puts every chunk read back at the stream's front, each whole and in the order it came, leaving the stream paused: its next reader (the stdio transport, or the Devin bridge's next attempt) resumes it and gets those chunks first. Idempotent. */
  putBack: () => void
  /** Stops reading and drops what was read, leaving the stream paused so the process can end; for a stop. Idempotent. */
  release: () => void
}

/**
 * Says whether a stream already ended, errored or was destroyed, so no end event of its own is still to come; called by {@link holdBridgeInput} before it holds and before it puts chunks back.
 * @param stream - The bridge's input.
 * @returns `true` for an ended, errored or destroyed stream.
 * @example
 * isInputOver(process.stdin) // => false while the client is connected
 */
function isInputOver(stream: Readable): boolean {
  return stream.readableEnded || stream.destroyed || stream.errored !== null
}

/**
 * Reads a bridge's input (its stdin) from now on, so the end of that input, or a read error, is seen while the bridge's first connection to Codebook's server is still being made; keeps every chunk read for the reader that comes next.
 * Why: a stream nobody reads never emits its end, and the stdio transport can read only once the first connection is up, so before this a client that ended the bridge during that connection was not seen (Cycle 0146 /ship pass 1). Called by {@link runCursorMcpBridge} before its first handshake, after the descriptor read; one hold at a time per process.
 * It stops reading once it keeps {@link BRIDGE_STARTUP_INPUT_LIMIT_BYTES} (the chunk that reached the limit stays whole), so a client that writes without waiting cannot grow it without bound; until the next reader resumes the stream, its end is then not seen.
 * @param stream - The bridge's input; `process.stdin` in the bridge, a stand-in in tests.
 * @param onOver - Called once when the input ends or fails while held, and at once when it already ended, failed or was destroyed (an end that happened before the hold); the bridge marks its stop there.
 * @param limitBytes - The most it keeps before it stops reading.
 * @returns The two ways the hold ends ({@link BridgeInputHold}).
 * @example
 * const hold = holdBridgeInput(process.stdin, markStopped)
 * // the first handshake failed: the next attempt reads what was kept first
 * hold.putBack()
 */
export function holdBridgeInput(
  stream: Readable,
  onOver: () => void,
  limitBytes = BRIDGE_STARTUP_INPUT_LIMIT_BYTES,
): BridgeInputHold {
  const kept: Buffer[] = []
  let keptBytes = 0
  const keep = (chunk: Buffer): void => {
    kept.push(chunk)
    keptBytes += chunk.length
    // Bounded: the rest waits in the stream for the next reader.
    if (keptBytes >= limitBytes) stream.pause()
  }
  const stopListening = (): void => {
    stream.off('data', keep)
    stream.off('end', onOver)
    stream.off('error', onOver)
  }
  // An end or error emitted before anyone listened is still known from the stream's state.
  if (isInputOver(stream)) onOver()
  else {
    stream.on('data', keep)
    stream.once('end', onOver)
    stream.once('error', onOver)
    // A stream an earlier hold left paused does not start again for a data listener alone.
    stream.resume()
  }
  return {
    putBack: (): void => {
      stopListening()
      stream.pause()
      // Each unshift goes in front of the last, so the chunks go back last first and are read in the order they came, each as its own chunk.
      while (kept.length > 0 && !isInputOver(stream)) stream.unshift(kept.pop())
      kept.length = 0
    },
    release: (): void => {
      stopListening()
      stream.pause()
      kept.length = 0
    },
  }
}

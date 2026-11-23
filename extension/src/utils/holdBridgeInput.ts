import type { Readable } from 'node:stream'

import {
  BRIDGE_STARTUP_INPUT_FULL_WAIT_MS,
  BRIDGE_STARTUP_INPUT_LIMIT_BYTES,
} from '../constants'

import { BRIDGE_INPUT_CLOCK } from './bridgeInputClock'
import type { RunClock } from './runningTimeLimit'

/** The ways a hold of a bridge's input ends; returned by {@link holdBridgeInput}. The hold ends once: the first call of `putBack`, `handOver` or `release` ends it, and a later call of any of the three does nothing, so it never pauses the stream again or forgets the limit's moment of a later hold of the same stream (Cycle 0147 review round). */
export interface BridgeInputHold {
  /** For a first handshake that failed: stops reading and puts every chunk read back at the stream's front, each whole and in the order it came, leaving the stream paused and not reading: its next reader (the Devin bridge's next attempt) resumes it and gets those chunks first. The moment a hold of this stream first reached its limit stays, so that next hold waits only until {@link BRIDGE_STARTUP_INPUT_FULL_WAIT_MS} after it. Ends the wait at the limit and the hold. */
  putBack: () => void
  /** For a first connection that is up: puts the chunks back as {@link BridgeInputHold.putBack} does, for the stdio transport, and forgets the moment the stream first reached its limit. Ends the hold. */
  handOver: () => void
  /** For a stop: stops reading and drops what was read, leaving the stream paused and not reading so the process can end, and forgets the moment the stream first reached its limit. Ends the wait at the limit and the hold. */
  release: () => void
  /**
   * Decides, the moment the first handshake settled (it succeeded, failed or was cut), whether the wait at the limit came first; called by {@link runCursorMcpBridge} before it accepts the connection or cleans up the failed handshake.
   * Exists so that a handshake that settled after that wait ended does not win (a late success is cut and released, a late failure ends as a stop), and so that one that settled within the wait is not turned into a stop while its cleanup runs. Only the wait ends here: the end and error listeners stay until the hold ends. The first call decides; later calls return the same answer.
   * @param boundMs - The handshake's own time limit, counted from this hold's start, when it has one (the Devin Desktop bridge's attempt budget): a handshake that ran to it ended there, however late its continuation runs, so that limit wins over a wait that ended after it.
   * @returns `true` when the input counts as over (the wait ended first, or an end or error was reported): `onOver` has run and the caller treats the handshake as stopped; `false` otherwise, and no wait reports from now on.
   */
  settleHandshake: (boundMs?: number) => boolean
}

/** When the wait at the limit of each stream ends (on the hold's clock): set the first time a hold of that stream reached its limit, kept per stream, not per hold, because the Devin bridge holds its stdin again for each attempt and puts back what it read, so the stream stays at its limit (Cycle 0147 task 8, Codex review F8.2). Forgotten when a hold hands the input over or releases it. */
const limitWaitEnds = new WeakMap<Readable, number>()

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
 * Records when the wait at the limit of a stream ends, the first time a hold of it reaches its limit, and returns that end; called by {@link holdBridgeInput} each time it stops reading at the limit.
 * @param stream - The bridge's input.
 * @param clock - The hold's clock.
 * @returns The recorded end: {@link BRIDGE_STARTUP_INPUT_FULL_WAIT_MS} after the first time a hold of this stream reached its limit.
 * @example
 * limitWaitEndOf(process.stdin, BRIDGE_INPUT_CLOCK) // => performance.now() + 5_000 the first time, the same value after
 */
function limitWaitEndOf(stream: Readable, clock: RunClock): number {
  const waitEndsAtMs =
    limitWaitEnds.get(stream) ?? clock.now() + BRIDGE_STARTUP_INPUT_FULL_WAIT_MS
  limitWaitEnds.set(stream, waitEndsAtMs)
  return waitEndsAtMs
}

/**
 * Says whether the wait at the limit of a stream had ended by a moment; called by {@link holdBridgeInput} when a hold starts and when its first handshake settles.
 * @param stream - The bridge's input.
 * @param momentMs - The moment, on the hold's clock.
 * @returns `true` once a hold of this stream reached its limit and the wait's end is not after `momentMs`.
 * @example
 * hasLimitWaitEndedBy(process.stdin, performance.now()) // => false while no hold reached the limit
 */
function hasLimitWaitEndedBy(stream: Readable, momentMs: number): boolean {
  const waitEndsAtMs = limitWaitEnds.get(stream)
  return waitEndsAtMs !== undefined && waitEndsAtMs <= momentMs
}

/**
 * Says when a first handshake ended, for {@link BridgeInputHold.settleHandshake}: the moment its continuation runs, or the end of its own time limit when that came first.
 * @param nowMs - The clock's reading when the continuation runs.
 * @param heldAtMs - When the hold began, which is when the handshake and its time limit began.
 * @param boundMs - The handshake's own time limit; none for Cursor's first handshake.
 * @returns The earlier of `nowMs` and the end of the time limit.
 * @example
 * handshakeEndMs(7_000, 0, 4_000) // => 4_000
 * handshakeEndMs(7_000, 0, undefined) // => 7_000
 */
function handshakeEndMs(
  nowMs: number,
  heldAtMs: number,
  boundMs: number | undefined,
): number {
  // A handshake its own time limit cut ended at that limit, however late its continuation ran.
  return boundMs === undefined ? nowMs : Math.min(nowMs, heldAtMs + boundMs)
}

/**
 * Reads a bridge's input (its stdin) from now on, so the end of that input, or a read error, is seen while the bridge's first connection to Codebook's server is still being made; keeps every chunk read for the reader that comes next.
 * Why: a stream nobody reads never emits its end, and the stdio transport can read only once the first connection is up, so before this a client that ended the bridge during that connection was not seen (Cycle 0146 /ship pass 1). Called by {@link runCursorMcpBridge} before its first handshake, after the descriptor read; one hold at a time per process.
 * It stops reading once it keeps {@link BRIDGE_STARTUP_INPUT_LIMIT_BYTES} (the chunk that reached the limit stays whole), so a client that writes without waiting cannot grow it without bound. From then on Node emits no end of the paused input, so once {@link BRIDGE_STARTUP_INPUT_FULL_WAIT_MS} passed since a hold of this stream first reached the limit (this one, or an earlier one: the Devin bridge holds its stdin again for each attempt), the input counts as over, unless the hold ended or its first handshake settled first (Cycle 0147 task 8).
 * @param stream - The bridge's input; `process.stdin` in the bridge, a stand-in in tests.
 * @param onOver - Called at most once per hold: when the input ends or fails while held, when the wait at the limit ends, or when the first handshake settles after that wait ended; at once when the input already ended, failed or was destroyed, or that wait already ended, before this hold. The bridge marks its stop there.
 * @param limitBytes - The most it keeps before it stops reading.
 * @param clock - The clock of the wait at the limit; {@link BRIDGE_INPUT_CLOCK} (monotonic time, an unreferenced timer) in the bridge.
 * @returns The ways the hold ends and the first handshake's settlement ({@link BridgeInputHold}).
 * @example
 * const hold = holdBridgeInput(process.stdin, markStopped)
 * // the first handshake failed within the wait: the next attempt reads what was kept first
 * if (!hold.settleHandshake()) hold.putBack()
 */
export function holdBridgeInput(
  stream: Readable,
  onOver: () => void,
  limitBytes = BRIDGE_STARTUP_INPUT_LIMIT_BYTES,
  clock: RunClock = BRIDGE_INPUT_CLOCK,
): BridgeInputHold {
  const kept: Buffer[] = []
  const heldAtMs = clock.now()
  let keptBytes = 0,
    isOverReported = false,
    isWaitDecided = false,
    isStoppedAtLimit = false,
    isHoldEnded = false,
    cancelWait: (() => void) | undefined
  // Once decided (reported, settled or ended with the hold), the wait at the limit never reports.
  const decideWait = (): void => {
    isWaitDecided = true
    cancelWait?.()
  }
  // Reports the input over once, whichever comes first: its end, a read error, or the end of the wait at its limit.
  const reportOver = (): void => {
    if (isOverReported) return
    isOverReported = true
    decideWait()
    onOver()
  }
  // One wait per hold, none once it was decided; the clock's timer is unreferenced, so it never keeps the process alive by itself.
  const startWait = (waitEndsAtMs: number): void => {
    if (isWaitDecided || cancelWait) return
    cancelWait = clock.set(reportOver, Math.max(0, waitEndsAtMs - clock.now()))
  }
  const keep = (chunk: Buffer): void => {
    kept.push(chunk)
    keptBytes += chunk.length
    if (keptBytes < limitBytes) return
    // Bounded: the rest waits in the stream for the next reader; its end is not seen from here on, so the wait at the limit stands in for it.
    isStoppedAtLimit = true
    stream.pause()
    startWait(limitWaitEndOf(stream, clock))
  }
  const watchEnd = (): void => {
    stream.once('end', reportOver)
    stream.once('error', reportOver)
  }
  const stopListening = (): void => {
    stream.off('data', keep)
    stream.off('end', reportOver)
    stream.off('error', reportOver)
    decideWait()
    stream.pause()
  }
  // A pause inside a data event leaves Node reading on into the stream's buffer, so process.stdin's handle would keep the process alive; a pause that follows a resume emits 'pause', on which process.stdin stops its read. No data is emitted: the resume flows only on the next tick, when the stream is paused again.
  const stopReading = (): void => {
    stream.resume()
    stream.pause()
  }
  const putChunksBack = (): void => {
    stopListening()
    // Each unshift goes in front of the last, so the chunks go back last first and are read in the order they came, each as its own chunk.
    while (kept.length > 0 && !isInputOver(stream)) stream.unshift(kept.pop())
    kept.length = 0
    stopReading()
  }
  // The hold ends once: a later call on an ended hold would pause the stream that a later hold of it reads, or forget that hold's limit moment.
  const endingOnce = (end: () => void) => (): void => {
    if (isHoldEnded) return
    isHoldEnded = true
    end()
  }
  const settleHandshake = (boundMs?: number): boolean => {
    if (isWaitDecided) return isOverReported
    // The wait wins when it ended before the handshake did: a late success or failure counts as a stop.
    if (
      hasLimitWaitEndedBy(
        stream,
        handshakeEndMs(clock.now(), heldAtMs, boundMs),
      )
    )
      reportOver()
    decideWait()
    return isOverReported
  }
  // An end or error emitted before anyone listened is still known from the stream's state.
  if (isInputOver(stream)) reportOver()
  // The wait at the limit ended while nothing held the stream (between two Devin attempts): over at once, left paused, and still listening for a read error until the release.
  else if (hasLimitWaitEndedBy(stream, heldAtMs)) {
    watchEnd()
    reportOver()
  } else {
    stream.on('data', keep)
    watchEnd()
    // A put-back input is still at its limit: the wait goes on from the moment an earlier hold of this stream first reached it.
    const inheritedWaitEndMs = limitWaitEnds.get(stream)
    if (inheritedWaitEndMs !== undefined) startWait(inheritedWaitEndMs)
    // A stream an earlier hold left paused does not start again for a data listener alone.
    stream.resume()
  }
  return {
    putBack: endingOnce(putChunksBack),
    handOver: endingOnce(() => {
      putChunksBack()
      limitWaitEnds.delete(stream)
    }),
    release: endingOnce(() => {
      stopListening()
      kept.length = 0
      limitWaitEnds.delete(stream)
      // Only a pause inside a data event, at the limit, leaves Node reading on; below it the pause above already stopped the read, and a resume now would start one with no error listener.
      if (isStoppedAtLimit) stopReading()
    }),
    settleHandshake,
  }
}

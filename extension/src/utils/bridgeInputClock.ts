import type { RunClock } from './runningTimeLimit'

/**
 * The clock the wait at a bridge's startup input limit reads and arms its one timer with: monotonic time (`performance.now()`, never moved by a change of the system time) and an unreferenced timer, so that wait never keeps a bridge process alive by itself. A handshake's own time limit is judged on the same clock once the handshake completed ({@link connectWithin}), so both ends compare on one time.
 * Why a shared object: {@link holdBridgeInput} and {@link connectWithin} read its members at each use, so the bridge child-process tests replace them from a preload and move that time by hand, which orders a handshake's settlement, its own time limit and that wait's end deterministically (Cycle 0147 task 8, Codex review D14; Cycle 0147 review round). Called by {@link holdBridgeInput} when no clock is passed, which is how {@link runCursorMcpBridge} holds its stdin, and by {@link connectWithin} for a handshake with a time limit.
 * @example
 * const cancel = BRIDGE_INPUT_CLOCK.set(() => reportOver(), 5_000)
 * cancel() // the wait ends without reporting
 */
export const BRIDGE_INPUT_CLOCK: RunClock = {
  now: () => performance.now(),
  set: (callback, delayMs) => {
    // Unreferenced: the wait only matters while a handshake keeps the process alive.
    const timer = setTimeout(callback, delayMs).unref()
    return (): void => clearTimeout(timer)
  },
}

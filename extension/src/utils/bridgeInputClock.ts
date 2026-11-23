import type { RunClock } from './runningTimeLimit'

/**
 * The clock the wait at a bridge's startup input limit reads and arms its one timer with: monotonic time (`performance.now()`, never moved by a change of the system time) and an unreferenced timer, so that wait never keeps a bridge process alive by itself.
 * Why a shared object: {@link holdBridgeInput} reads its members at each use, so the bridge child-process tests replace them from a preload and move that wait's time by hand, which orders a handshake's settlement and that wait's end deterministically (Cycle 0147 task 8, Codex review D14). Called by {@link holdBridgeInput} when no clock is passed, which is how {@link runCursorMcpBridge} holds its stdin.
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

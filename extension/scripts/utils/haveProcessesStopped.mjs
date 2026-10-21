import { readProcessStates } from './readProcessStates.mjs'

/** The states that end a wait for a stop: stopped by a signal (`T`), stopped by a tracer (`t`), a zombie (`Z`) or a dead entry (`X`, `x`) starts and finishes nothing more. */
const SETTLED_STATES = new Set(['T', 't', 'Z', 'X', 'x'])

/**
 * Tells whether every one of the processes has stopped, or is gone, after SIGSTOP was sent to it.
 *
 * Why: SIGSTOP is delivered asynchronously, and a process that is making a fork when it comes finishes the fork and stops only then; a look at its tree before that misses the child. A process counts as stopped when the table says so, as a zombie, as dead, or when it is no longer listed. Where the states cannot be read ({@link readProcessStates} answers `undefined`: Windows, no `/proc`, a `ps` without the state column) the answer is `true`, so a look counts there as it did before the states were read.
 * Called by {@link killProcessIds} before each look at the stopped processes' trees and by {@link trackProcessTree} before each look of its `stopAndLook`.
 * @param pids - The ids of the processes that got SIGSTOP.
 * @param options.platform - A value of `process.platform`, for {@link readProcessStates}.
 * @returns `true` when no process of the list still runs, or when the states cannot be read.
 * @example
 * haveProcessesStopped([4301, 4302]) // => false (4302 is still on its way to the stop)
 */
export function haveProcessesStopped(
  pids,
  { platform = process.platform } = {},
) {
  if (pids.length === 0) return true
  const states = readProcessStates(pids, { platform })
  if (states === undefined) return true
  return pids.every((pid) => {
    const state = states.get(pid)
    return state === undefined || SETTLED_STATES.has(state)
  })
}

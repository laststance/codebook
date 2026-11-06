import { EXTENSION_BUILD_TIMEOUT_MS } from '../constants'

import { createBuildOutputTail } from './createBuildOutputTail'
import { endWxtBuildTree } from './endWxtBuildTree'
import type {
  WxtBuildClock,
  WxtBuildExit,
  WxtBuildSpawner,
  WxtBuildSpawnRequest,
} from './wxtBuildTypes'

/** How a started WXT build ended, with the tree's confirmed end and the masked last output lines. */
export type WxtBuildProcessEnd = {
  ending: 'exited' | 'timeout' | 'cancelled'
  /** The leader's exit; `undefined` when the build was ended before it exited by itself. */
  exit: WxtBuildExit | undefined
  /** Whether no member of the build's process tree was left when the end was judged. */
  treeEnded: boolean
  outputLines: string[]
}

/**
 * Runs the WXT build process to its end under the build budget: waits for its exit, the timeout or the caller's cancellation, then makes sure the whole tree is gone.
 * Called by {@link buildWxtExtension}; the tracked-file comparison runs only after it returns.
 * @param request - What to start (the output receiver is supplied here).
 * @param spawner - Starts the process.
 * @param clock - Time for the budget and the kill grace.
 * @param signal - The caller's cancellation.
 * @returns How the build ended; never rejects for a failed start (that is an exit without a code).
 * @example
 * const end = await runWxtBuildProcess(request, createWxtBuildSpawner, clock, signal) // => { ending: 'exited', … }
 */
export async function runWxtBuildProcess(
  request: Omit<WxtBuildSpawnRequest, 'onOutput'>,
  spawner: WxtBuildSpawner,
  clock: WxtBuildClock,
  signal: AbortSignal,
): Promise<WxtBuildProcessEnd> {
  const output = createBuildOutputTail()
  const build = spawner({ ...request, onOutput: output.push })
  const budget = new AbortController()
  let onCancel = (): void => undefined
  const cancelled = new Promise<'cancelled'>((resolve) => {
    onCancel = (): void => resolve('cancelled')
    signal.addEventListener('abort', onCancel, { once: true })
  })
  let exit: WxtBuildExit | undefined
  try {
    const ending = await Promise.race([
      build.exited.then((status) => {
        exit = status
        return 'exited' as const
      }),
      clock
        .delay(EXTENSION_BUILD_TIMEOUT_MS, budget.signal)
        .then(() => 'timeout' as const),
      cancelled,
    ])
    // A build that exited may still have left members behind; every other ending ends the tree.
    const treeEnded =
      ending === 'exited' && build.isTreeGone()
        ? true
        : await endWxtBuildTree(build, clock)
    return { ending, exit, treeEnded, outputLines: output.finish() }
  } finally {
    budget.abort()
    signal.removeEventListener('abort', onCancel)
  }
}

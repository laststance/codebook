import type {
  BuildClock,
  BuildProcessExit,
  BuildSpawner,
  BuildSpawnRequest,
} from './buildProcessTypes'
import { createBuildOutputTail } from './createBuildOutputTail'
import { endBuildTree } from './endBuildTree'

/** How a started build process ended, with the tree's confirmed end and the masked last output lines. */
export type BuildProcessEnd = {
  ending: 'exited' | 'timeout' | 'cancelled'
  /** The leader's exit; `undefined` when the build was ended before it exited by itself. */
  exit: BuildProcessExit | undefined
  /** Whether no member of the build's process tree was left when the end was judged. */
  treeEnded: boolean
  outputLines: string[]
}

/**
 * Runs a build process (the WXT build, the library build) to its end under the caller's time budget: waits for its exit, the timeout or the caller's cancellation, then makes sure the whole tree is gone.
 * Called by {@link buildWxtExtension} and the library build; the source comparison runs only after it returns.
 * @param request - What to start (the output receiver is supplied here).
 * @param spawner - Starts the process.
 * @param clock - Time for the budget and the kill grace.
 * @param signal - The caller's cancellation.
 * @param timeoutMs - The time budget of the process; past it the tree is ended and the ending reads `timeout`.
 * @returns How the build ended; never rejects for a failed start (that is an exit without a code).
 * @example
 * const end = await runBuildProcess(request, createBuildSpawner, clock, signal, 120_000) // => { ending: 'exited', … }
 */
export async function runBuildProcess(
  request: Omit<BuildSpawnRequest, 'onOutput'>,
  spawner: BuildSpawner,
  clock: BuildClock,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<BuildProcessEnd> {
  const output = createBuildOutputTail()
  const build = spawner({ ...request, onOutput: output.push })
  const budget = new AbortController()
  let onCancel = (): void => undefined
  const cancelled = new Promise<'cancelled'>((resolve) => {
    onCancel = (): void => resolve('cancelled')
    // An already aborted signal never fires `abort` again: a stop between the caller's last check and the spawn is answered at once.
    if (signal.aborted) onCancel()
    else signal.addEventListener('abort', onCancel, { once: true })
  })
  let exit: BuildProcessExit | undefined
  try {
    const ending = await Promise.race([
      build.exited.then((status) => {
        exit = status
        return 'exited' as const
      }),
      clock.delay(timeoutMs, budget.signal).then(() => 'timeout' as const),
      cancelled,
    ])
    // A build that exited may still have left members behind; every other ending ends the tree.
    const treeEnded =
      ending === 'exited' && build.isTreeGone()
        ? true
        : await endBuildTree(build, clock)
    return { ending, exit, treeEnded, outputLines: output.finish() }
  } finally {
    budget.abort()
    signal.removeEventListener('abort', onCancel)
  }
}

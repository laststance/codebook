/**
 * Watches a build's process tree until it is gone, treating a failed probe as "not confirmed gone".
 *
 * Why it exists: the group probe rethrows errors such as `EPERM`; inside a timer that would be an uncaught exception of the extension host,
 * and inside the build step it would reject the build before the tracked-file comparison. Called by {@link createBuildSpawner}.
 * After a failed probe polling stops for good (no endless timer) and the tree stays unconfirmed.
 *
 * @param options - `hasLeaderExited` and `probe` (true when no group member is left; may throw), `pollMs` between probes.
 * @returns
 * - `treeGone`: settles when the tree is confirmed gone; stays pending after a failed probe; never rejects
 * - `isTreeGone`: whether the tree is confirmed gone right now; `false` when the probe throws
 * @example
 * const { treeGone } = watchBuildTree({ hasLeaderExited: () => true, probe: () => true, pollMs: 50 })
 */
export function watchBuildTree(options: {
  hasLeaderExited(): boolean
  probe(): boolean
  pollMs: number
}): { treeGone: Promise<void>; isTreeGone(): boolean } {
  const isTreeGone = (): boolean => {
    if (!options.hasLeaderExited()) return false
    try {
      return options.probe()
    } catch {
      // A failed probe says nothing about the group.
      return false
    }
  }
  const treeGone = new Promise<void>((resolve) => {
    const poll = (): void => {
      if (!options.hasLeaderExited()) {
        setTimeout(poll, options.pollMs).unref()
        return
      }
      try {
        if (options.probe()) resolve()
        else setTimeout(poll, options.pollMs).unref()
      } catch {
        // Polling stops: the end stays unconfirmed and the caller's grace bound decides.
      }
    }
    poll()
  })
  return { treeGone, isTreeGone }
}

import { EXTENSION_BUILD_KILL_GRACE_MS } from '../constants'

import type { WxtBuildClock, WxtBuildProcess } from './wxtBuildTypes'

/** Waits for the tree to be gone, at most the grace; true when it is gone. */
async function waitForTreeGone(
  build: WxtBuildProcess,
  clock: WxtBuildClock,
): Promise<boolean> {
  const waited = new AbortController()
  try {
    const gone = await Promise.race([
      build.treeGone.then(() => true),
      clock
        .delay(EXTENSION_BUILD_KILL_GRACE_MS, waited.signal)
        .then(() => false),
    ])
    return gone || build.isTreeGone()
  } finally {
    // The grace timer of a wait that ended otherwise is released.
    waited.abort()
  }
}

/**
 * Ends a WXT build's whole process tree: SIGTERM, then SIGKILL after the grace, and reports whether the end was confirmed.
 * Called by {@link buildWxtExtension} on timeout, cancellation, or when a finished build left members behind.
 * @param build - The started build process.
 * @param clock - Provides the grace delays.
 * @returns `true` when no member of the tree is left; `false` when the end could not be confirmed (a signal failed or members remain after SIGKILL).
 * @example
 * const confirmed = await endWxtBuildTree(build, clock) // => true
 */
export async function endWxtBuildTree(
  build: WxtBuildProcess,
  clock: WxtBuildClock,
): Promise<boolean> {
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    try {
      build.signalTree(signal)
    } catch {
      // A failed signal leaves the end unconfirmed unless the tree is gone anyway.
      return build.isTreeGone()
    }
    if (await waitForTreeGone(build, clock)) return true
  }
  return false
}

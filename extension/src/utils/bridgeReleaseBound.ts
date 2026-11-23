import { setTimeout as sleep } from 'node:timers/promises'

import { CURSOR_MCP_BRIDGE_CLEANUP_TIMEOUT_MS } from '../constants'

/** The bound on a bridge's wait for the server's answer to a session release, as {@link BRIDGE_RELEASE_BOUND} holds it. */
interface BridgeReleaseBound {
  /** Resolves once a release has waited as long as it may, or at once when `releaseEnded` fires (the release ended first, and the bound's timer goes with it); never rejects. */
  wait: (releaseEnded: AbortSignal) => Promise<void>
}

/**
 * The bound on a bridge's wait for the server's answer to a session release (its DELETE): {@link CURSOR_MCP_BRIDGE_CLEANUP_TIMEOUT_MS} on an unreferenced timer, so a server that accepted the DELETE and never answers cannot keep the bridge alive, and a release that ended first ends the wait and its timer through `releaseEnded`, so a promptly answered DELETE leaves no timer behind (Cycle 0147 ship pass 1).
 * Why a shared object: {@link releaseHalfOpenSession} reads `wait` at each release, so a bridge child-process test can replace it from a preload and end a release only by answering its DELETE, which puts that release's end after a step the test took, whatever the runner's timing (Cycle 0147 review round). The real bound keeps its own child-process test, a connected Devin bridge whose DELETE is never answered. Called by {@link releaseHalfOpenSession} for every release a bridge makes.
 * @example
 * const releaseEnded = new AbortController()
 * await Promise.race([release.terminateSession(), BRIDGE_RELEASE_BOUND.wait(releaseEnded.signal)])
 * releaseEnded.abort() // the bound's timer ends with the release
 */
export const BRIDGE_RELEASE_BOUND: BridgeReleaseBound = {
  wait: (releaseEnded) =>
    sleep(CURSOR_MCP_BRIDGE_CLEANUP_TIMEOUT_MS, undefined, {
      ref: false,
      signal: releaseEnded,
    })
      // An abort is the release's end, not a failure: the wait just ends.
      .catch(() => undefined),
}

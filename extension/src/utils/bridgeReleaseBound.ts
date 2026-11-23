import { setTimeout as sleep } from 'node:timers/promises'

import { CURSOR_MCP_BRIDGE_CLEANUP_TIMEOUT_MS } from '../constants'

/** The bound on a bridge's wait for the server's answer to a session release, as {@link BRIDGE_RELEASE_BOUND} holds it. */
interface BridgeReleaseBound {
  /** Resolves once a release has waited as long as it may; never rejects. */
  wait: () => Promise<void>
}

/**
 * The bound on a bridge's wait for the server's answer to a session release (its DELETE): {@link CURSOR_MCP_BRIDGE_CLEANUP_TIMEOUT_MS} on an unreferenced timer, so a server that accepted the DELETE and never answers cannot keep the bridge alive, and a release that ended first leaves nothing that does.
 * Why a shared object: {@link releaseHalfOpenSession} reads `wait` at each release, so a bridge child-process test can replace it from a preload and end a release only by answering its DELETE, which puts that release's end after a step the test took, whatever the runner's timing (Cycle 0147 review round). The real bound keeps its own child-process test, a connected Devin bridge whose DELETE is never answered. Called by {@link releaseHalfOpenSession} for every release a bridge makes.
 * @example
 * await Promise.race([release.terminateSession(), BRIDGE_RELEASE_BOUND.wait()])
 */
export const BRIDGE_RELEASE_BOUND: BridgeReleaseBound = {
  wait: () =>
    sleep(CURSOR_MCP_BRIDGE_CLEANUP_TIMEOUT_MS, undefined, { ref: false }),
}

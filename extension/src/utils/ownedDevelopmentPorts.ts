/** Whether the Codebook run that holds a port is still running or already stopping. */
export type OwnedDevelopmentPortState = 'running' | 'stopping'

const ownedPorts = new Map<number, OwnedDevelopmentPortState>()

/**
 * Records that a Codebook-owned `next dev` was started on a port.
 * Called by {@link launchDevelopmentServer}; read by {@link assertDevelopmentPortFree} to tell Codebook's own run from the learner's dev server.
 * @example claimOwnedDevelopmentPort(3165)
 */
export function claimOwnedDevelopmentPort(port: number): void {
  ownedPorts.set(port, 'running')
}

/**
 * Marks the owned run on a port as stopping; its process group may still hold the port.
 * Called when the run's `close` starts.
 * @example beginReleaseOfOwnedDevelopmentPort(3165)
 */
export function beginReleaseOfOwnedDevelopmentPort(port: number): void {
  if (ownedPorts.has(port)) ownedPorts.set(port, 'stopping')
}

/**
 * Forgets a port once the owned run's process group and listener are gone.
 * Called when the run's `close` succeeded.
 * @example releaseOwnedDevelopmentPort(3165)
 */
export function releaseOwnedDevelopmentPort(port: number): void {
  ownedPorts.delete(port)
}

/**
 * Tells whether a Codebook run is recorded on a port.
 * @returns The run's state, or `undefined` when no Codebook run holds the port.
 * @example ownedDevelopmentPortState(3165) // 'stopping' while the group exits
 */
export function ownedDevelopmentPortState(
  port: number,
): OwnedDevelopmentPortState | undefined {
  return ownedPorts.get(port)
}

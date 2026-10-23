/** Whether the Codebook run that holds a port is still running or already stopping. */
export type OwnedDevelopmentPortState = 'running' | 'stopping'

/** One run's claim on a port; the token is the run's own handle, so one run never changes another's claim. */
export type OwnedDevelopmentPortClaim = { port: number }

const claimsByPort = new Map<
  number,
  Map<OwnedDevelopmentPortClaim, OwnedDevelopmentPortState>
>()

/**
 * Records that a Codebook-owned `next dev` was started on a port.
 * Called by {@link launchDevelopmentServer}; read by {@link assertDevelopmentPortFree} to tell Codebook's own runs from the learner's dev server.
 * @returns The run's claim, to pass to {@link beginReleaseOfOwnedDevelopmentPort} and {@link releaseOwnedDevelopmentPort}.
 * @example const claim = claimOwnedDevelopmentPort(3165)
 */
export function claimOwnedDevelopmentPort(
  port: number,
): OwnedDevelopmentPortClaim {
  const claim = { port }
  const claims = claimsByPort.get(port) ?? new Map()
  claims.set(claim, 'running')
  claimsByPort.set(port, claims)
  return claim
}

/**
 * Marks one run's claim as stopping; its process group may still hold the port.
 * Called when the run's `close` starts.
 * @example beginReleaseOfOwnedDevelopmentPort(claim)
 */
export function beginReleaseOfOwnedDevelopmentPort(
  claim: OwnedDevelopmentPortClaim,
): void {
  const claims = claimsByPort.get(claim.port)
  if (claims?.has(claim)) claims.set(claim, 'stopping')
}

/**
 * Forgets one run's claim once its process group and listener are gone; other runs' claims on the port stay.
 * Called when the run's `close` succeeded.
 * @example releaseOwnedDevelopmentPort(claim)
 */
export function releaseOwnedDevelopmentPort(
  claim: OwnedDevelopmentPortClaim,
): void {
  const claims = claimsByPort.get(claim.port)
  claims?.delete(claim)
  if (claims?.size === 0) claimsByPort.delete(claim.port)
}

/**
 * Tells whether a Codebook run is recorded on a port.
 * @returns `running` while any run is live on it, else `stopping` while a run still releases it, else `undefined`.
 * @example ownedDevelopmentPortState(3165) // 'stopping' while the group exits
 */
export function ownedDevelopmentPortState(
  port: number,
): OwnedDevelopmentPortState | undefined {
  const states = [...(claimsByPort.get(port)?.values() ?? [])]
  if (states.includes('running')) return 'running'
  return states.includes('stopping') ? 'stopping' : undefined
}

/**
 * Tells whether a run is still releasing a port.
 * @returns `true` while any claim on the port is stopping, even when a newer run has claimed it.
 * @example isOwnedDevelopmentPortReleasing(3165)
 */
export function isOwnedDevelopmentPortReleasing(port: number): boolean {
  return [...(claimsByPort.get(port)?.values() ?? [])].includes('stopping')
}

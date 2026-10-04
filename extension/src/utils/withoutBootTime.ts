import type { StorageOwnerIdentity } from './readRecordedOwner'

/**
 * Leaves a boot time out of the identity by which a record that outlives a single write is judged: a connection descriptor ({@link evidenceInUseElsewhere}) and the owner marker of a browser profile folder ({@link removeAbandonedProfiles}).
 * Such a record lives as long as its window or its run, and a clock corrected in that time moves the boot time this process computes, so only a kernel boot id, which no clock moves, may call its owner one of an earlier boot.
 * @param identity - The machine and the boot of this process.
 * @returns
 * - The identity unchanged when its boot is a kernel boot id, or unknown
 * - The identity without a boot when its boot is a computed boot time
 * @example
 * withoutBootTime({ hostname: 'workstation', boot: { startedAtMs: 1_790_000_000_000 } }) // => { hostname: 'workstation', boot: undefined }
 * withoutBootTime({ hostname: 'workstation', boot: { id: '0c1d…' } })                    // => { hostname: 'workstation', boot: { id: '0c1d…' } }
 */
export function withoutBootTime(
  identity: StorageOwnerIdentity,
): StorageOwnerIdentity {
  return identity.boot && 'id' in identity.boot
    ? identity
    : { ...identity, boot: undefined }
}

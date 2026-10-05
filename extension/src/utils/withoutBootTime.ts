import type { StorageOwnerIdentity } from './readRecordedOwner'

/**
 * Leaves a boot time out of the identity by which a record is judged that a boot time must not decide: a connection descriptor ({@link evidenceInUseElsewhere}) and the owner marker of a browser profile folder ({@link removeAbandonedProfiles}), which outlive a single write, and every record that carries its owner's process start ({@link isRecordedOwnerGone}).
 * A descriptor or a marker lives as long as its window or its run, and a clock corrected in that time moves the boot time this process computes, so only a kernel boot id, which no clock moves, may call its owner one of an earlier boot. A record with a process start is judged by that start. What is left for the boot time is a lock or a claim without a start: one that a window of 0.2.29.0 wrote, or a window whose start could not be read.
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

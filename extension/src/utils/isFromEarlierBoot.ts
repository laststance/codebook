import { STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS } from '../constants'

import type { BootIdentity } from './readRecordedOwner'

/**
 * Says whether a storage owner was recorded before this machine's last restart, so that {@link isRecordedOwnerGone} does not take a process id that is in use again for the owner.
 * Only what is certain counts: two different kernel boot ids, or a recorded boot time that lies before this boot's by more than {@link STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS}. Two clocks that disagree never make an owner one of an earlier boot.
 * @param recorded - The boot the owner wrote; `undefined` for a file of an earlier build.
 * @param current - The boot this process runs under.
 * @returns
 * - `true` when both are kernel boot ids and differ, or both are boot times and the recorded one is earlier by more than the tolerance
 * - `false` when either is unknown, when one is an id and the other a time, and when the recorded boot time is inside the tolerance or later than this boot's
 * @example
 * isFromEarlierBoot({ id: 'boot-1' }, { id: 'boot-2' })                 // => true
 * isFromEarlierBoot({ startedAtMs: 1_000 }, { startedAtMs: 31_000 })    // => false (30 s apart)
 * isFromEarlierBoot(undefined, { id: 'boot-2' })                        // => false
 */
export function isFromEarlierBoot(
  recorded: BootIdentity | undefined,
  current: BootIdentity | undefined,
): boolean {
  if (!recorded || !current) return false
  // A kernel names every boot once, so two ids that differ are two boots.
  if ('id' in recorded && 'id' in current) return recorded.id !== current.id
  // A restart puts this boot's time after the recorded one; a recorded time that is later can only be a clock that moved.
  if ('startedAtMs' in recorded && 'startedAtMs' in current)
    return (
      current.startedAtMs - recorded.startedAtMs >
      STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS
    )
  return false
}

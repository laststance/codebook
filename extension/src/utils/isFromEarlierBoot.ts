import { STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS } from '../constants'

import type { BootIdentity } from './readRecordedOwner'

/** Says whether a recorded boot time lies before this boot's by more than {@link STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS}: a restart puts this boot's time after the recorded one, and a recorded time that is later can only be a clock that moved. A boot id on either side decides nothing here. @example startedClearlyBefore({ startedAtMs: 1_000 }, { startedAtMs: 62_000 }) // => true */
function startedClearlyBefore(
  recorded: BootIdentity,
  current: BootIdentity,
): boolean {
  const recordedMs = recorded.startedAtMs,
    currentMs = current.startedAtMs
  return (
    recordedMs !== undefined &&
    currentMs !== undefined &&
    currentMs - recordedMs > STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS
  )
}

/**
 * Says whether a storage owner was recorded before this machine's last restart, so that {@link isRecordedOwnerGone} does not take a process id that is in use again for the owner.
 * Only what is certain counts: two different boot ids (the kernel's on Linux, the boot session on macOS), or, where either side names no id, a recorded boot time that lies before this boot's by more than {@link STORAGE_OWNER_BOOT_TIME_TOLERANCE_MS}. Where both name an id, the ids decide alone: a system names every boot once, and a boot time beside an id moves with the clock. Two clocks that disagree never make an owner one of an earlier boot.
 * The boot time serves a record without a process start (written by 0.2.29.0, or by a window whose start could not be read). A record with a start is judged by that start, and the caller hands this function no boot time for it ({@link withoutBootTime}): a clock set forward by more than the tolerance while a lock is held would otherwise make its live owner one of an earlier boot.
 * @param recorded - The boot the owner wrote; `undefined` for a file of an earlier build.
 * @param current - The boot this process runs under.
 * @returns
 * - `true` when both name a boot id and the ids differ, or, when either names none, both name boot times and the recorded one is earlier by more than the tolerance
 * - `false` when either is unknown, for two equal boot ids whatever their times, when one is an id alone and the other a time, and when the recorded boot time is inside the tolerance or later than this boot's
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
  // Two boot ids decide alone: no clock moves them, and the boot time beside one on macOS may have moved.
  if ('id' in recorded && 'id' in current) return recorded.id !== current.id
  return startedClearlyBefore(recorded, current)
}

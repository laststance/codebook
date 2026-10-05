import { isFromEarlierBoot } from './isFromEarlierBoot'
import { isSameStorageMachine } from './isSameStorageMachine'
import { processStartFormHere } from './processStartFormHere'
import type { RecordedOwner, StorageOwnerIdentity } from './readRecordedOwner'
import { withoutBootTime } from './withoutBootTime'

/** Gives the form of a process start, the text before its first colon; a text without a colon has the empty form. @example formOf('linux@4026531836:16362446') // => 'linux@4026531836' */
function formOf(processStart: string): string {
  return processStart.slice(0, Math.max(processStart.indexOf(':'), 0))
}

/**
 * Gives the form of the starts that name a process of this process's own space of process ids, which is the space it can probe; called by {@link canJudgeOwnerHere}.
 * It is the form of this process's own start, which the identity carries; while that start is unknown, it is the form {@link processStartFormHere} names, the same one {@link readProcessStart} gives every start it reads here.
 * @param identity - The identity of this process.
 * @returns `linux@<namespace>`, `linux`, `ps` or `win`; `undefined` on a platform whose process starts cannot be read, while the own start is unknown.
 * @example
 * formOfThisSystem({ hostname: 'workstation', processStart: 'linux@4026531836:16362446' }) // => 'linux@4026531836'
 * formOfThisSystem({ hostname: 'workstation' })                                          // => 'win' on Windows
 */
function formOfThisSystem(
  identity: Pick<StorageOwnerIdentity, 'processStart'>,
): string | undefined {
  return identity.processStart === undefined
    ? processStartFormHere()
    : formOf(identity.processStart)
}

/**
 * Says whether a record and this process name two different kernel boots; called by {@link canJudgeOwnerHere} for a record whose start has another form.
 * @param owner - The owner a record names.
 * @param identity - The identity of this process.
 * @returns `true` only when both name a kernel boot id and the two differ; `false` when either names none (a boot time decides nothing here) and when they are equal.
 * @example
 * isOfAnotherKernelBoot({ pid: 4242, boot: { id: 'boot-1' } }, { hostname: 'workstation', boot: { id: 'boot-2' } }) // => true
 * isOfAnotherKernelBoot({ pid: 4242 }, { hostname: 'workstation', boot: { id: 'boot-2' } })                         // => false
 */
function isOfAnotherKernelBoot(
  owner: RecordedOwner,
  identity: StorageOwnerIdentity,
): boolean {
  return isFromEarlierBoot(owner.boot, withoutBootTime(identity).boot)
}

/**
 * Says whether the process an owner record names can be judged by this process: whether it is a process of this machine, in the space of process ids this process probes, and told from a later process with its id; called by {@link isRecordedOwnerGone} before it probes anything, and by the Wiki update marker's rules, which keep their age rules for every record that cannot be judged here.
 * A host name does not name one space of process ids. A Windows window and a WSL window have one host name and can open one project folder, and so can two WSL distributions of one computer, which also run on one kernel under one boot id; a process id of one names another process, or none, in the other. The form of the recorded start tells them apart, because each system's query answers its own form and a Linux start names its pid namespace ({@link processStartFormHere}). A probe of such a record's process id here would call a live owner gone.
 * A record of another kernel boot is judged all the same, and is gone: every process of an earlier boot has ended, whatever space it ran in, and a pid namespace gets another number after a restart, so a record a killed window left before it would otherwise stay for good.
 * Limit: a record a killed window left in a pid namespace that has ended is not judged by a window of another namespace of the same kernel boot. It stays until the kernel restarts, the namespace's number is given again, or the file is removed, like a record of another machine.
 * @param owner - The owner a lock, a claim, a descriptor or a marker names.
 * @param identity - The identity of this process.
 * @returns
 * - `true` when the record is from this machine ({@link isSameStorageMachine}), names its owner's process start, and that start has this process's form
 * - `true` also when such a record's start has another form and the record and this process name two different kernel boot ids: {@link isRecordedOwnerGone} then answers that the owner is gone
 * - `false` for a record of another machine, for one without a process start (written by 0.2.29.0, or by a window whose start could not be read), and for one whose start has another form under the same kernel boot id, or where either side names no kernel boot id: another system, another pid namespace, or a namespace one side could not read
 * @example
 * canJudgeOwnerHere({ pid: 4242, hostKey: 'd195d36bd79da7df', processStart: 'linux@4026531836:100' }, { hostname: 'workstation', hostKey: 'd195d36bd79da7df', processStart: 'linux@4026531836:200' })                                        // => true
 * canJudgeOwnerHere({ pid: 4242, hostKey: 'd195d36bd79da7df', boot: { id: 'boot-1' }, processStart: 'linux@4026532214:100' }, { hostname: 'workstation', hostKey: 'd195d36bd79da7df', boot: { id: 'boot-1' }, processStart: 'linux@4026531836:200' }) // => false
 * canJudgeOwnerHere({ pid: 4242, hostKey: 'd195d36bd79da7df', boot: { id: 'boot-1' }, processStart: 'linux@4026532214:100' }, { hostname: 'workstation', hostKey: 'd195d36bd79da7df', boot: { id: 'boot-2' }, processStart: 'linux@4026531836:200' }) // => true
 * canJudgeOwnerHere({ pid: 4242, hostname: 'workstation' }, { hostname: 'workstation', processStart: 'linux@4026531836:200' })                                                                                                                // => false
 */
export function canJudgeOwnerHere(
  owner: RecordedOwner,
  identity: StorageOwnerIdentity,
): boolean {
  const { processStart } = owner
  if (processStart === undefined || !isSameStorageMachine(owner, identity))
    return false
  return (
    formOf(processStart) === formOfThisSystem(identity) ||
    isOfAnotherKernelBoot(owner, identity)
  )
}

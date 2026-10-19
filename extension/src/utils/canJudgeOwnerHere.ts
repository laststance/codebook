import { PROCESS_START_FORMS, PROCESS_START_NAMESPACE_MARK } from '../constants'

import { isFromEarlierBoot } from './isFromEarlierBoot'
import { isSameStorageMachine } from './isSameStorageMachine'
import { namesMachineInClear } from './namesMachineInClear'
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
 * Says whether a record and this process name two different kernel boots; called by {@link canJudgeOwnerHere} for a record whose start is of another space of process ids.
 * @param owner - The owner a record names.
 * @param identity - The identity of this process.
 * @returns `true` only when both name a boot id and the two differ; `false` when either names none (a boot time decides nothing here) and when they are equal.
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

/** Gives the system a form names, which is the form without a pid namespace. @example systemOf('linux@4026531836') // => 'linux' */
function systemOf(form: string): string {
  const markAt = form.indexOf(PROCESS_START_NAMESPACE_MARK)
  return markAt === -1 ? form : form.slice(0, markAt)
}

/**
 * Says whether a form names one space of process ids by itself; called by {@link isOfThisProcessSpace} before two equal forms of a record in a project folder count as one space.
 * macOS and Windows have one space of process ids each, so `ps` and `win` name it. Linux has one per pid namespace, so only a form with its namespace names one: `linux` alone is the form of a start whose reader could not read its pid namespace ({@link processStartFormHere}), and two such starts may be of two namespaces.
 * @param form - The form of a process start, the text before its first colon.
 * @returns `true` for `ps`, `win` and `linux@<namespace>`, and for a form no system of this build answers; `false` for `linux` without a namespace.
 * @example
 * namesItsProcessSpace('linux@4026531836') // => true
 * namesItsProcessSpace('win')              // => true
 * namesItsProcessSpace('linux')            // => false
 */
function namesItsProcessSpace(form: string): boolean {
  return form !== PROCESS_START_FORMS.linux
}

/**
 * Says whether a recorded start names a process of the space of process ids this process probes; called by {@link canJudgeOwnerHere} for a record of this machine.
 * A record that names its machine in clear lies in private storage, which two spaces of process ids do not share: for it only the system counts, and the pid namespace in its form decides nothing, so that a lock a killed window left before its WSL distribution alone was restarted (the same kernel boot, another namespace number) is still taken over. A record that names its machine by pseudonyms alone lies in a project folder that two spaces can open: for it the whole form counts, the pid namespace included, and a Linux form without a namespace counts as no known space, also when this process's own form has none either ({@link namesItsProcessSpace}).
 * Limit: Linux windows that cannot read their own pid namespace never judge each other's records in a project folder, also when they run in one namespace, so a Wiki update marker a killed one left is not taken over before its run's bound, and its claim not before its age rule.
 * @param owner - The owner a record names.
 * @param processStart - That record's process start.
 * @param identity - The identity of this process.
 * @returns
 * - A record that names its machine in clear ({@link namesMachineInClear}): `true` when its start and this process's are of one system (`linux`, `ps`, `win`)
 * - Any other record: `true` when the two forms are equal and name their space of process ids, which on Linux is with the pid namespace; `false` for two Linux forms without one
 * @example
 * isOfThisProcessSpace({ pid: 4242, hostname: 'workstation' }, 'linux@4026532214:100', { hostname: 'workstation', processStart: 'linux@4026531836:200' })      // => true
 * isOfThisProcessSpace({ pid: 4242, hostKey: 'd195d36bd79da7df' }, 'linux@4026532214:100', { hostname: 'workstation', processStart: 'linux@4026531836:200' }) // => false
 * isOfThisProcessSpace({ pid: 4242, hostKey: 'd195d36bd79da7df' }, 'linux:100', { hostname: 'workstation', processStart: 'linux:200' })                       // => false
 * isOfThisProcessSpace({ pid: 4242, hostname: 'workstation' }, 'linux:100', { hostname: 'workstation', processStart: 'linux:200' })                           // => true
 */
function isOfThisProcessSpace(
  owner: RecordedOwner,
  processStart: string,
  identity: StorageOwnerIdentity,
): boolean {
  const recordedForm = formOf(processStart),
    formHere = formOfThisSystem(identity)
  if (formHere === undefined) return false
  if (namesMachineInClear(owner))
    return systemOf(recordedForm) === systemOf(formHere)
  // Two equal forms are one space only when the form names it: `linux` without a pid namespace may be two.
  return recordedForm === formHere && namesItsProcessSpace(formHere)
}

/**
 * Says whether the process an owner record names can be judged by this process: whether it is a process of this machine, in the space of process ids this process probes, and told from a later process with its id; called by {@link isRecordedOwnerGone} for a record with a process start, before it probes anything, and by the Wiki update marker's rules ({@link readLiveWikiUpdateMarker}, {@link claimWikiUpdateMarker}), which keep their age rules for every record that cannot be judged here.
 * A host name does not name one space of process ids. A Windows window and a WSL window have one host name and can open one project folder, and so can two WSL distributions of one computer, which also run on one kernel under one boot id; a process id of one names another process, or none, in the other. The form of the recorded start tells them apart, because each system's query answers its own form and a Linux start names its pid namespace ({@link processStartFormHere}). A probe of such a record's process id here would call a live owner gone. A Linux start whose reader could not read its pid namespace has the form `linux` alone, which tells nothing apart: in a project folder such a record is not judged, by a window that names its namespace and by one that names none.
 * The pid namespace decides only for a record that names its machine by pseudonyms alone, which is one in a project folder (the Wiki update marker and its claim). A record that names its machine in clear lies in private storage, which two spaces of process ids do not share, and is judged whatever namespace its Linux start names ({@link isOfThisProcessSpace}). Another system's form is never judged, for either kind.
 * A record of another kernel boot is judged all the same, and is gone: every process of an earlier boot has ended, whatever space it ran in, and a pid namespace gets another number after a restart, so a record a killed window left before it would otherwise stay for good. A boot id that differs means an earlier boot only for a record that {@link isSameStorageMachine} counts as this machine's: in a project folder, a record with this host name's digest beside another editor's machine-id digest under another boot id is as much one of another computer with the same host name (two Macs with the default name on one shared folder) as one of an earlier boot, so it is not judged here and its marker counts until its run expires, also when it was the other editor of this computer before a restart.
 * Limit: two computers with one host name look like one machine where either side names no boot id (Windows, a macOS boot session that could not be read) or both share an editor's machine id; a record of the other is then judged here like one of this machine, and its process id is probed when its start has this process's form.
 * A record without a process start is never judged here. {@link isRecordedOwnerGone} decides it by rules of its own: one that names its machine in clear by its boot and its process id, as before the start was recorded, and one that names its machine by pseudonyms alone by a boot id only, without a probe of its process id, which may be an id of another space.
 * Limit: a Wiki update marker or a claim on it that a killed window left in a pid namespace that has ended, or that a window left whose own start could not be read, or whose pid namespace could not be read (also when the judging window is of that same namespace and cannot read it either), is not judged by its process id here, like a record of another machine. The run's expiry bounds the marker and the claim's age rule bounds the claim.
 * @param owner - The owner a lock, a claim, a descriptor or a marker names.
 * @param identity - The identity of this process.
 * @returns
 * - `true` when the record is from this machine ({@link isSameStorageMachine}), names its owner's process start, and that start is of this process's space of process ids: of its system for a record that names its machine in clear, of its whole form for any other, where that form names its space (`ps`, `win`, `linux@<namespace>`)
 * - `true` also when such a record's start is of another space and the record and this process name two different boot ids: {@link isRecordedOwnerGone} then answers that the owner is gone
 * - `false` for a record of another machine (also one with this host name's digest, another machine-id digest and another boot id), for one without a process start (written by 0.2.29.0, or by a window whose start could not be read), and for one of another space under the same boot id, or where either side names no boot id: another system, or for a record without a machine in clear another pid namespace, or a namespace that the record's writer, this process or both could not read
 * @example
 * canJudgeOwnerHere({ pid: 4242, hostKey: 'd195d36bd79da7df', processStart: 'linux@4026531836:100' }, { hostname: 'workstation', hostKey: 'd195d36bd79da7df', processStart: 'linux@4026531836:200' })                                        // => true
 * canJudgeOwnerHere({ pid: 4242, hostKey: 'd195d36bd79da7df', boot: { id: 'boot-1' }, processStart: 'linux@4026532214:100' }, { hostname: 'workstation', hostKey: 'd195d36bd79da7df', boot: { id: 'boot-1' }, processStart: 'linux@4026531836:200' }) // => false
 * canJudgeOwnerHere({ pid: 4242, hostname: 'workstation', boot: { id: 'boot-1' }, processStart: 'linux@4026532214:100' }, { hostname: 'workstation', boot: { id: 'boot-1' }, processStart: 'linux@4026531836:200' })                             // => true
 * canJudgeOwnerHere({ pid: 4242, hostKey: 'd195d36bd79da7df', boot: { id: 'boot-1' }, processStart: 'linux@4026532214:100' }, { hostname: 'workstation', hostKey: 'd195d36bd79da7df', boot: { id: 'boot-2' }, processStart: 'linux@4026531836:200' }) // => true
 * canJudgeOwnerHere({ pid: 4242, hostKey: 'd195d36bd79da7df', boot: { id: 'boot-1' }, processStart: 'linux:100' }, { hostname: 'workstation', hostKey: 'd195d36bd79da7df', boot: { id: 'boot-1' }, processStart: 'linux:200' })                                  // => false
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
    isOfThisProcessSpace(owner, processStart, identity) ||
    isOfAnotherKernelBoot(owner, identity)
  )
}

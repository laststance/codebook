import { PROCESS_START_FORMS } from '../constants'

import { isSameStorageMachine } from './isSameStorageMachine'
import type { RecordedOwner, StorageOwnerIdentity } from './readRecordedOwner'

/** The form of the starts each platform's query answers, for a platform that is looked up by name; a platform without a query has none. */
const FORMS_BY_PLATFORM: Partial<Record<NodeJS.Platform, string>> =
  PROCESS_START_FORMS

/** Gives the form of a process start, the text before its first colon; a text without a colon has the empty form. @example formOf('linux:16362446') // => 'linux' */
function formOf(processStart: string): string {
  return processStart.slice(0, Math.max(processStart.indexOf(':'), 0))
}

/**
 * Gives the form of the starts that name a process of this system, which is the space of process ids this process can probe; called by {@link canJudgeOwnerHere}.
 * It is the form of this process's own start, which the identity carries; while that start is unknown, it is the form this platform's query answers.
 * @param identity - The identity of this process.
 * @returns `linux`, `ps` or `win`; `undefined` on a platform whose process starts cannot be read, while the own start is unknown.
 * @example
 * formOfThisSystem({ hostname: 'workstation', processStart: 'linux:16362446' }) // => 'linux'
 * formOfThisSystem({ hostname: 'workstation' })                               // => 'win' on Windows
 */
function formOfThisSystem(
  identity: Pick<StorageOwnerIdentity, 'processStart'>,
): string | undefined {
  return identity.processStart === undefined
    ? FORMS_BY_PLATFORM[process.platform]
    : formOf(identity.processStart)
}

/**
 * Says whether the process an owner record names can be judged by this process: whether it is a process of this machine, in the space of process ids this process probes, and told from a later process with its id; called by {@link isRecordedOwnerGone} before it probes anything, and by the Wiki update marker's rules, which keep their age rules for every record that cannot be judged here.
 * A host name does not name one space of process ids: a Windows window and a WSL window have one host name and can open one project folder, and a process id of one names another process, or none, in the other. The form of the recorded start tells them apart, because each system's query answers its own form ({@link PROCESS_START_FORMS}). A probe of such a record's process id here would call a live owner gone.
 * Limit: two spaces of process ids on systems of one form and one host name (two WSL distributions) cannot be told apart.
 * @param owner - The owner a lock, a claim, a descriptor or a marker names.
 * @param identity - The identity of this process.
 * @returns
 * - `true` when the record is from this machine ({@link isSameStorageMachine}), names its owner's process start, and that start has this system's form
 * - `false` for a record of another machine, for one without a process start (written by 0.2.29.0, or by a window whose start could not be read), and for one whose start has another system's form
 * @example
 * canJudgeOwnerHere({ pid: 4242, hostKey: 'd195d36bd79da7df', processStart: 'linux:100' }, { hostname: 'workstation', hostKey: 'd195d36bd79da7df', processStart: 'linux:200' })                        // => true
 * canJudgeOwnerHere({ pid: 4242, hostKey: 'd195d36bd79da7df', processStart: 'win:2026-10-05T09:12:33.1234567Z' }, { hostname: 'workstation', hostKey: 'd195d36bd79da7df', processStart: 'linux:200' }) // => false
 * canJudgeOwnerHere({ pid: 4242, hostname: 'workstation' }, { hostname: 'workstation', processStart: 'linux:200' })                                                                                   // => false
 */
export function canJudgeOwnerHere(
  owner: RecordedOwner,
  identity: StorageOwnerIdentity,
): boolean {
  return (
    isSameStorageMachine(owner, identity) &&
    owner.processStart !== undefined &&
    formOf(owner.processStart) === formOfThisSystem(identity)
  )
}

import type { RecordedOwner } from './readRecordedOwner'

/**
 * Says whether an owner record names its machine in clear, by a host name or the editor's machine id, which tells where the record lies; called by {@link isSameStorageMachine} and {@link canJudgeOwnerHere}.
 * A record in the extension's private storage (a storage lock, a takeover claim, a prepared lock, a connection descriptor, a profile marker) names its machine in clear, and two spaces of process ids do not share that storage. A record in a learner's project folder (the Wiki update marker and its claim) must not name the computer and names it by the pseudonyms of {@link deriveMachineKeys} alone; such a folder can be opened from two spaces of process ids of one computer.
 * @param owner - The owner a lock, a claim, a descriptor or a marker names.
 * @returns `true` when the record has a host name or a machine id; `false` when it has neither, also when it has pseudonyms.
 * @example
 * namesMachineInClear({ hostname: 'workstation' })                                      // => true
 * namesMachineInClear({ machineKey: 'f9c8c7ddcf3d5f56', hostKey: 'd195d36bd79da7df' }) // => false
 */
export function namesMachineInClear(
  owner: Pick<RecordedOwner, 'hostname' | 'machineId'>,
): boolean {
  return owner.hostname !== undefined || owner.machineId !== undefined
}

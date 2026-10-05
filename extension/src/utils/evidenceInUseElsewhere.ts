import { lstat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { CONNECTION_DESCRIPTOR_SUFFIX } from '../constants'

import { currentStorageOwner } from './currentStorageOwner'
import { isProcessGone } from './isProcessGone'
import { isRecordedOwnerGone } from './isRecordedOwnerGone'
import {
  readRecordedOwner,
  type RecordedOwner,
  type StorageOwnerIdentity,
} from './readRecordedOwner'
import { systemErrorCode } from './systemErrorCode'
import { withoutBootTime } from './withoutBootTime'

/** Says whether a path exists, without following a final link; only a path that is absent counts as absent, one that cannot be inspected may exist. @example await isPresent('/storage/agent/instance.connection.json') // => true */
function isPresent(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    (error: unknown) => systemErrorCode(error) !== 'ENOENT',
  )
}

/** Says whether an owner record names no machine at all: no host name, no machine id and no pseudonym, as a connection descriptor of a build up to 0.2.28 does. @example namesNoMachine({ pid: 4242 }) // => true */
function namesNoMachine(owner: RecordedOwner): boolean {
  return [
    owner.hostname,
    owner.machineId,
    owner.machineKey,
    owner.hostKey,
  ].every((name) => name === undefined)
}

/**
 * Says whether a connection descriptor names an editor process that no longer exists, so a descriptor left by a crashed window keeps nothing in place; called by {@link evidenceInUseElsewhere}.
 * A descriptor that names a process and no machine was written by a build up to 0.2.28. It lies in this machine's own storage, so it is this machine's and is judged by its process id alone; taking it for another machine's would keep the evidence of every crashed window of such a build on disk for good.
 * @param descriptor - The `<instanceId>.connection.json` file of another instance.
 * @param identity - The machine and the boot of this process; {@link currentStorageOwner} when left out.
 * @returns
 * - `true` when the descriptor names no machine and its process id names no process ({@link isProcessGone})
 * - `true` when the descriptor names this machine and an earlier kernel boot id, a process id that no longer exists, or a process id that another process has now ({@link isRecordedOwnerGone}, judged without a boot time, see {@link withoutBootTime})
 * - `false` for a descriptor of another machine, one without a process id, one that cannot be read, and one whose process may still run: each may belong to a running window
 * @example
 * await isDescriptorOwnerGone('/storage/agent/instance.connection.json') // => true after its window was killed
 */
async function isDescriptorOwnerGone(
  descriptor: string,
  identity?: StorageOwnerIdentity,
): Promise<boolean> {
  const owner = await readRecordedOwner(descriptor)
  if (!owner) return false
  if (namesNoMachine(owner)) return isProcessGone(owner.pid)
  return isRecordedOwnerGone(
    owner,
    withoutBootTime(identity ?? (await currentStorageOwner())),
  )
}

/**
 * Says whether the raw evidence of a run may still be in use by another Codebook window, so {@link StudyWorkspace} leaves it in place when it removes the run's saved study.
 * A window's agent server keeps `<instanceId>.connection.json`, with its process id, machine, boot and process start, beside its instance directory while it runs and removes it when it stops; a descriptor whose process is gone from this machine was left by a crashed window and keeps nothing in place.
 * @param evidenceDirectory - `<agentRoot>/<instanceId>/<runId>` from {@link studyEvidenceDirectory}.
 * @param ownInstanceId - The instance of this window's agent server, whose runs the caller knows to be stopped.
 * @param identity - The machine and the boot of this process, by which the descriptor's owner is judged; {@link currentStorageOwner} unless a test names its own.
 * @returns
 * - `false` for a run of this window, for evidence that does not exist, when the run's instance has no connection descriptor, and when that descriptor's process is gone from this machine, also one of a build up to 0.2.28, which names a process and no machine
 * - `true` when the evidence exists or cannot be inspected and another instance's descriptor is present or cannot be inspected, also one that names another machine, where its window may still run
 * @example
 * await evidenceInUseElsewhere('/storage/agent/other-instance/run', 'own-instance') // => true while '/storage/agent/other-instance.connection.json' names a running window
 */
export async function evidenceInUseElsewhere(
  evidenceDirectory: string,
  ownInstanceId: string | undefined,
  identity?: StorageOwnerIdentity,
): Promise<boolean> {
  const instanceDirectory = dirname(evidenceDirectory),
    instanceId = basename(instanceDirectory)
  if (instanceId === ownInstanceId) return false
  const descriptor = join(
    dirname(instanceDirectory),
    `${instanceId}${CONNECTION_DESCRIPTOR_SUFFIX}`,
  )
  return (
    (await isPresent(evidenceDirectory)) &&
    (await isPresent(descriptor)) &&
    !(await isDescriptorOwnerGone(descriptor, identity))
  )
}

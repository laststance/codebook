import { lstat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { CONNECTION_DESCRIPTOR_SUFFIX } from '../constants'

/** Says whether a path exists, without following a final link; a path that cannot be inspected counts as absent. @example await isPresent('/storage/agent/instance.connection.json') // => true */
function isPresent(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  )
}

/**
 * Says whether the raw evidence of a run may still be in use by another Codebook window, so {@link StudyWorkspace} leaves it in place when it removes the run's saved study.
 * A window's agent server keeps `<instanceId>.connection.json` beside its instance directory while it runs and removes it when it stops; a descriptor left by a crashed window therefore keeps the evidence in place.
 * @param evidenceDirectory - `<agentRoot>/<instanceId>/<runId>` from {@link studyEvidenceDirectory}.
 * @param ownInstanceId - The instance of this window's agent server, whose runs the caller knows to be stopped.
 * @returns
 * - `false` for a run of this window, for evidence that does not exist, and when the run's instance has no connection descriptor
 * - `true` when the evidence exists and another instance's descriptor is present
 * @example
 * await evidenceInUseElsewhere('/storage/agent/other-instance/run', 'own-instance') // => true while '/storage/agent/other-instance.connection.json' exists
 */
export async function evidenceInUseElsewhere(
  evidenceDirectory: string,
  ownInstanceId: string | undefined,
): Promise<boolean> {
  const instanceDirectory = dirname(evidenceDirectory),
    instanceId = basename(instanceDirectory)
  if (instanceId === ownInstanceId) return false
  const descriptor = join(
    dirname(instanceDirectory),
    `${instanceId}${CONNECTION_DESCRIPTOR_SUFFIX}`,
  )
  return (await isPresent(evidenceDirectory)) && (await isPresent(descriptor))
}

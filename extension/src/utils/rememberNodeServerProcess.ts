import { NODE_SERVER_ORPHANS_STORAGE_KEY } from '../constants'

import {
  readNodeServerOrphanRecords,
  type NodeServerOrphanRecord,
  type NodeServerOrphanStore,
} from './nodeServerOrphanRecords'

/**
 * Records a launched server group in workspace storage, so that an activation after a crash or window kill can close it.
 * Called by the node-server run right after launch; {@link forgetNodeServerProcess} removes the record when the group is closed.
 * @param store - The workspace storage.
 * @param record - The launched group's identity.
 * @example await rememberNodeServerProcess(context.workspaceState, { runId: 'r1', pid: 77, processGroup: 77, leaderStartedAt: 'ps:Tue Oct 28', cwd: '/work', inspectorPort: 9229, declaredPort: 4100 })
 */
export async function rememberNodeServerProcess(
  store: NodeServerOrphanStore,
  record: NodeServerOrphanRecord,
): Promise<void> {
  // A record for the same run replaces the earlier one.
  const others = readNodeServerOrphanRecords(store).filter(
    (existing) => existing.runId !== record.runId,
  )
  await store.update(NODE_SERVER_ORPHANS_STORAGE_KEY, [...others, record])
}

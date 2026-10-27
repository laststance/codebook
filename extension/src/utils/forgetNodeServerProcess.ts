import { NODE_SERVER_ORPHANS_STORAGE_KEY } from '../constants'

import {
  readNodeServerOrphanRecords,
  type NodeServerOrphanStore,
} from './nodeServerOrphanRecords'

/**
 * Removes a run's record once its group is closed and verified gone, so that no later activation signals a recycled process.
 * Called by the node-server run at the end of its cleanup.
 * @param store - The workspace storage.
 * @param runId - The run whose record is removed; other runs' records stay.
 * @example await forgetNodeServerProcess(context.workspaceState, 'r1')
 */
export async function forgetNodeServerProcess(
  store: NodeServerOrphanStore,
  runId: string,
): Promise<void> {
  const remaining = readNodeServerOrphanRecords(store).filter(
    (record) => record.runId !== runId,
  )
  await store.update(
    NODE_SERVER_ORPHANS_STORAGE_KEY,
    remaining.length > 0 ? remaining : undefined,
  )
}

import { NODE_SOURCE_SLOT_PATH_ROOT } from '../constants'

/**
 * Tells whether a captured-source document path names a test replay's recorded-source slot ({@link nodeSourceSlotPath}), whatever replay or file it was named after.
 * Called by {@link StudyWorkspace} when it serves a slot's document and when it closes every slot tab but the one a moment shows, so a slot tab left by an overtaken or failed rename, a retired replay or an earlier session never stays.
 * @param path - The path of a `codebook-source` URI.
 * @returns `true` for a path under the slot root, `false` for any other captured source.
 * @example
 * isNodeSourceSlotPath('/node-history-slot/3f1c…/Captured-scheduler.ts') // => true
 * isNodeSourceSlotPath('/node-history/3f1c…/2/<hash>') // => false
 */
export function isNodeSourceSlotPath(path: string): boolean {
  return path.split('/').filter(Boolean)[0] === NODE_SOURCE_SLOT_PATH_ROOT
}

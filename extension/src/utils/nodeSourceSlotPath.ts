import { posix } from 'node:path'

import {
  NODE_SOURCE_SLOT_DIRECTORY_HASH_CHARS,
  NODE_SOURCE_SLOT_PATH_ROOT,
} from '../constants'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { describeNodeRecordedSource } from './describeNodeRecordedSource'

/**
 * Names the path of a test replay's recorded-source slot: one Codebook-owned source document per opened test replay, named after the source file of the stop it shows (DS5), so a stop in another file gives the slot another name and never a tab per stop.
 * A short hash of the file's folder stands between the study id and the tab title, so two files with the same base name in different folders are different slots and the tab is renamed between them (F200). The raw folder is not used: it would put recorded path segments into the address.
 * Called by {@link StudyWorkspace} when it shows a test replay's moment and when it serves or closes the slot's document.
 * @param studyId - The test replay's study id.
 * @param sourcePath - The repository-relative, slash-separated path of the source file the slot is named after.
 * @returns The slot's URI path; its last segment is the tab title (`Captured-<basename>`).
 * @example nodeSourceSlotPath('3f1c…', 'src/jobs/scheduler.ts') // => '/node-history-slot/3f1c…/<12 hex>/Captured-scheduler.ts'
 */
export function nodeSourceSlotPath(
  studyId: string,
  sourcePath: string,
): string {
  const folderHash = sha256(posix.dirname(sourcePath)).slice(
    0,
    NODE_SOURCE_SLOT_DIRECTORY_HASH_CHARS,
  )
  return `/${NODE_SOURCE_SLOT_PATH_ROOT}/${studyId}/${folderHash}/${describeNodeRecordedSource({ kind: 'tab-title', path: sourcePath })}`
}

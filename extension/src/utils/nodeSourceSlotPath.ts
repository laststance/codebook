import { NODE_SOURCE_SLOT_PATH_ROOT } from '../constants'

import { describeNodeRecordedSource } from './describeNodeRecordedSource'

/**
 * Names the path of a test replay's recorded-source slot: one Codebook-owned source document per opened test replay, named after the source file of the stop it shows (DS5), so a stop in another file gives the slot another name and never a tab per stop.
 * Called by {@link StudyWorkspace} when it shows a test replay's moment and when it serves or closes the slot's document.
 * @param studyId - The test replay's study id.
 * @param sourcePath - The repository-relative path of the source file the slot is named after.
 * @returns The slot's URI path; its last segment is the tab title (`Captured-<basename>`).
 * @example nodeSourceSlotPath('3f1c…', 'src/jobs/scheduler.ts') // => '/node-history-slot/3f1c…/Captured-scheduler.ts'
 */
export function nodeSourceSlotPath(
  studyId: string,
  sourcePath: string,
): string {
  return `/${NODE_SOURCE_SLOT_PATH_ROOT}/${studyId}/${describeNodeRecordedSource({ kind: 'tab-title', path: sourcePath })}`
}

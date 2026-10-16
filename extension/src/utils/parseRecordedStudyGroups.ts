import {
  studyGroupsMarkerSchema,
  type RecordedStudyGroups,
} from '../applicationGroupMarkerSchemas'

import { parseApplicationGroupMarker } from './parseApplicationGroupMarker'

/**
 * Reads the record of the groups Codebook created that an earlier window kept in its workspace state, in either version, so {@link StudyWorkspace} can judge the empty groups a cold Study open finds after a reload or an editor restart; anything it does not recognize proves nothing.
 * A version-1 record (0.2.30 candidates, finding 590) names the Application group alone, exactly as {@link parseApplicationGroupMarker} reads it; a version-2 record names two or more groups (finding 599).
 * @param stored - The raw value of {@link APPLICATION_GROUP_MARKER_KEY}, as the workspace state returns it.
 * @returns
 * - The writer, the recorded columns, the group count and the layout, for a record of either version
 * - `undefined` for no record, another version or a malformed value
 * @example
 * parseRecordedStudyGroups({ version: 1, writer: 'b2c7…', column: 1, groupCount: 3, layout }) // => { writer: 'b2c7…', columns: [1], groupCount: 3, layout }
 * parseRecordedStudyGroups({ version: 2, writer: 'b2c7…', columns: [1, 3], groupCount: 3, layout }) // => { writer: 'b2c7…', columns: [1, 3], groupCount: 3, layout }
 * parseRecordedStudyGroups(undefined) // => undefined
 */
export function parseRecordedStudyGroups(
  stored: unknown,
): RecordedStudyGroups | undefined {
  const applicationGroup = parseApplicationGroupMarker(stored)
  // A version-1 record names the Application group by its column alone.
  if (applicationGroup)
    return {
      writer: applicationGroup.writer,
      columns: [applicationGroup.column],
      groupCount: applicationGroup.groupCount,
      layout: applicationGroup.layout,
    }
  const studyGroups = studyGroupsMarkerSchema.safeParse(stored)
  return studyGroups.success
    ? {
        writer: studyGroups.data.writer,
        columns: studyGroups.data.columns,
        groupCount: studyGroups.data.groupCount,
        layout: studyGroups.data.layout,
      }
    : undefined
}

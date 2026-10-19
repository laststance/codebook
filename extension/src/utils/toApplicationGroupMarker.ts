import type {
  ApplicationGroupMarker,
  StudyGroupsMarker,
} from '../applicationGroupMarkerSchemas'
import {
  APPLICATION_GROUP_MARKER_VERSION,
  STUDY_GROUPS_MARKER_VERSION,
} from '../constants'

/** The record {@link toApplicationGroupMarker} shapes, its layout the native reply Codebook confirmed. */
export type ApplicationGroupMarkerToWrite = (
  Omit<ApplicationGroupMarker, 'layout'> | Omit<StudyGroupsMarker, 'layout'>
) & { layout: unknown }

/**
 * Shapes the record {@link StudyWorkspace} keeps of the groups it created that a reload would leave empty, at a main layout it confirmed; called by {@link StudyWorkspace} each time it writes that record.
 * A record that names one group keeps the version-1 shape (`column`) that 0.2.30 candidates read; one that names more groups is version 2 (`columns`, in column order), which those readers ignore.
 * @param writer - The reader that writes the record.
 * @param columns - The columns of the named groups in that layout; at least one, each once.
 * @param groupCount - The main groups of that layout.
 * @param layout - That layout, as `vscode.getEditorLayout` answered it.
 * @returns
 * - `{ version: 1, writer, column, groupCount, layout }` for one column
 * - `{ version: 2, writer, columns, groupCount, layout }` for two or more, the columns sorted
 * @example
 * toApplicationGroupMarker('b2c7…', [1], 2, layout) // => { version: 1, writer: 'b2c7…', column: 1, groupCount: 2, layout }
 * toApplicationGroupMarker('b2c7…', [3, 1], 3, layout) // => { version: 2, writer: 'b2c7…', columns: [1, 3], groupCount: 3, layout }
 */
export function toApplicationGroupMarker(
  writer: string,
  columns: readonly number[],
  groupCount: number,
  layout: unknown,
): ApplicationGroupMarkerToWrite {
  const [column, ...others] = columns
  // One group keeps the shape every earlier reader proves alike.
  if (column !== undefined && !others.length)
    return {
      version: APPLICATION_GROUP_MARKER_VERSION,
      writer,
      column,
      groupCount,
      layout,
    }
  return {
    version: STUDY_GROUPS_MARKER_VERSION,
    writer,
    columns: columns.toSorted((left, right) => left - right),
    groupCount,
    layout,
  }
}

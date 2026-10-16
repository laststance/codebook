import type { ApplicationGroupMarker } from '../applicationGroupMarkerSchemas'

import { editorLayoutGroupCount } from './editorLayoutGroupCount'
import { isProportionalEditorLayout } from './isProportionalEditorLayout'

/**
 * Says whether the group a cold Study open finds at the marker's column is the empty Application group Codebook claimed before a window reload; {@link StudyWorkspace} retires such a group only on this proof, and leaves every other group (a learner's own empty group) as it is.
 * @param marker - The record Codebook kept when it confirmed its Application group's layout.
 * @param group - The main group at the marker's column now.
 * @param layout - The main editor grid's layout now, as `vscode.getEditorLayout` reports it.
 * @returns
 * - `true` when the group stands at the marker's column, holds no tab, and the grid has the marker's group count and layout
 * - `false` otherwise
 * @example
 * const marker = { version: 1, writer: 'b2c7…', column: 1, groupCount: 2, layout: { orientation: 0, groups: [{ size: 1 }, { size: 1 }] } }
 * isApplicationGroupMarkerProven(marker, { viewColumn: 1, tabs: [] }, { orientation: 0, groups: [{ size: 300 }, { size: 300 }] }) // => true
 * isApplicationGroupMarkerProven(marker, { viewColumn: 1, tabs: [readmeTab] }, { orientation: 0, groups: [{ size: 300 }, { size: 300 }] }) // => false
 */
export function isApplicationGroupMarkerProven(
  marker: ApplicationGroupMarker,
  group: { viewColumn: number; tabs: readonly unknown[] },
  layout: unknown,
): boolean {
  return (
    group.viewColumn === marker.column &&
    group.tabs.length === 0 &&
    editorLayoutGroupCount(layout) === marker.groupCount &&
    isProportionalEditorLayout(marker.layout, layout)
  )
}

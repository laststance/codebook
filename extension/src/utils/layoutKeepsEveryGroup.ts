import { editorLayoutGroupCount } from './editorLayoutGroupCount'

/**
 * Says whether applying a layout keeps every group of the measured main grid; `vscode.setEditorLayout` with fewer groups merges the extra groups' tabs into their neighbours, so {@link StudyWorkspace}'s arrangement refuses such a layout before any native change.
 * @param layout - The layout the arrangement would apply.
 * @param groupCount - The main groups the arrangement must keep.
 * @returns
 * - `true` when the layout is valid and has at least `groupCount` groups
 * - `false` for fewer groups, or for a missing or invalid layout
 * @example
 * layoutKeepsEveryGroup({ orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] }, 2) // => true
 * layoutKeepsEveryGroup({ orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] }, 3) // => false
 * layoutKeepsEveryGroup(undefined, 1) // => false
 */
export function layoutKeepsEveryGroup(
  layout: unknown,
  groupCount: number,
): boolean {
  const layoutGroupCount = editorLayoutGroupCount(layout)
  return layoutGroupCount !== undefined && layoutGroupCount >= groupCount
}

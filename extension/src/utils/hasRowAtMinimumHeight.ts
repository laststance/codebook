import {
  EDITOR_GROUP_MINIMUM_HEIGHT_PX,
  VERTICAL_EDITOR_ORIENTATION,
} from '../constants'

import { editorLayoutSchema } from './isProportionalEditorLayout'

/**
 * Says whether an editor layout stacks its groups in rows of which one stands at the editor's minimum height while another does not, the rows {@link StudyWorkspace} stacks at one height before an activation could expand that row (Cycle 0046 row 691).
 *
 * VS Code 1.140.0 expands a group that sits at its minimum width or height whenever it activates that group (`workbench.desktop.main.js` 1106:114938 `doRestoreGroup`, `arrangeGroups` with `EXPAND` at 1106:111202): every other row goes to the minimum. The Application's `workbench.action.newGroupAbove` over a learner's uneven stack leaves such a row (524/163 gives 262/355/70: the split view takes the missing height from the last row down to the minimum, 540:73732), and the focus return to the Wiki's row then gives 70/70/547, so the measured layout of the arrangement is gone. Rows that all stand at the minimum are a hidden editor area's, see {@link isCollapsedEditorLayout}, which this leaves to that check.
 *
 * @param layout - What `vscode.getEditorLayout` returned.
 * @returns
 * - `true` for stacked rows that are each a single group, at least one of them exactly {@link EDITOR_GROUP_MINIMUM_HEIGHT_PX} high and another one higher
 * - `false` for columns, nested groups, rows that are all at the minimum or all above it, and anything that is no layout
 * @example
 * hasRowAtMinimumHeight({ orientation: 1, groups: [{ size: 262 }, { size: 355 }, { size: 70 }] }) // => true
 * hasRowAtMinimumHeight({ orientation: 1, groups: [{ size: 229 }, { size: 229 }, { size: 229 }] }) // => false
 * hasRowAtMinimumHeight({ orientation: 1, groups: [{ size: 70 }, { size: 70 }] }) // => false (a hidden editor area)
 */
export function hasRowAtMinimumHeight(layout: unknown): boolean {
  const parsed = editorLayoutSchema.safeParse(layout)
  if (
    !parsed.success ||
    parsed.data.orientation !== VERTICAL_EDITOR_ORIENTATION ||
    parsed.data.groups.some((row) => row.groups)
  )
    return false
  const heights = parsed.data.groups.map((row) => row.size)
  return (
    heights.includes(EDITOR_GROUP_MINIMUM_HEIGHT_PX) &&
    heights.some((height) => height > EDITOR_GROUP_MINIMUM_HEIGHT_PX)
  )
}

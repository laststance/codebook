import { EDITOR_GROUP_MINIMUM_HEIGHT_PX } from '../constants'

import { editorLayoutSchema } from './isProportionalEditorLayout'
import { stacksOfRows } from './stacksOfRows'

/**
 * Says whether an editor layout has a stack of rows of which one stands at the editor's minimum height while another does not, at the root or nested in a column or a row ({@link stacksOfRows}): the rows {@link StudyWorkspace} stacks at one height ({@link stackRowsAtOneHeight}) before an activation could expand that row (Cycle 0046 rows 691 and 704).
 *
 * VS Code 1.140.0 expands a group that sits at its minimum width or height whenever it activates that group (`workbench.desktop.main.js` 1106:114938 `doRestoreGroup`, `arrangeGroups` with `EXPAND` at 1106:111202, the grid's `expandView` resizing the group's place in every split on its path, 981:39660): every other row of its stack goes to the minimum, and so does every other column of a row it stands in. The Application's `workbench.action.newGroupAbove` over a learner's uneven stack leaves such a row (524/163 gives 262/355/70: the split view takes the missing height from the last row down to the minimum, 540:73732), in the root's rows or in the rows of a column the first group stands in, and the focus return to the Wiki's row then gives 70/70/547, so the measured layout of the arrangement is gone. A stack whose rows all stand at the minimum is a hidden editor area's, see {@link isCollapsedEditorLayout}, which this leaves to that check.
 *
 * @param layout - What `vscode.getEditorLayout` returned.
 * @returns
 * - `true` for a layout with a stack of rows, a row of it exactly {@link EDITOR_GROUP_MINIMUM_HEIGHT_PX} high and another one higher; a row may be a single group or split into columns
 * - `false` for a layout of columns only, stacks whose rows are all at the minimum or all above it, and anything that is no layout
 * @example
 * hasRowAtMinimumHeight({ orientation: 1, groups: [{ size: 262 }, { size: 355 }, { size: 70 }] }) // => true
 * hasRowAtMinimumHeight({ orientation: 0, groups: [{ size: 550, groups: [{ size: 262 }, { size: 355 }, { size: 70 }] }, { size: 550 }] }) // => true
 * hasRowAtMinimumHeight({ orientation: 1, groups: [{ size: 229 }, { size: 229 }, { size: 229 }] }) // => false
 * hasRowAtMinimumHeight({ orientation: 1, groups: [{ size: 70 }, { size: 70 }] }) // => false (a hidden editor area)
 */
export function hasRowAtMinimumHeight(layout: unknown): boolean {
  const parsed = editorLayoutSchema.safeParse(layout)
  if (!parsed.success) return false
  return stacksOfRows(parsed.data).some((rows) => {
    const heights = rows.map((row) => row.size)
    return (
      heights.includes(EDITOR_GROUP_MINIMUM_HEIGHT_PX) &&
      heights.some((height) => height > EDITOR_GROUP_MINIMUM_HEIGHT_PX)
    )
  })
}

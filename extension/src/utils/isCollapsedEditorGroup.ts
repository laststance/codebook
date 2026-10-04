import type { z } from 'zod'

import {
  EDITOR_GROUP_MINIMUM_HEIGHT_PX,
  HORIZONTAL_EDITOR_ORIENTATION,
} from '../constants'

import { editorLayoutSchema } from './isProportionalEditorLayout'

/** The groups of one level of a measured editor layout, in view-column order. */
type EditorLayoutGroups = z.infer<typeof editorLayoutSchema>['groups']

/**
 * Says whether one group is a strip of its tab row among taller groups of its stack; called by {@link isCollapsedEditorGroup} for the group at the asked view column.
 * @param group - The group at the view column.
 * @param groups - The groups of its level, itself included.
 * @param isStack - Whether the sizes of that level are heights (the groups lie above one another).
 * @returns
 * - `true` when the level is a stack, the group measures exactly {@link EDITOR_GROUP_MINIMUM_HEIGHT_PX} pixels and a group of the level is taller
 * - `false` for groups side by side, a taller group, and a stack that is at the minimum as a whole
 * @example
 * isStripAmongTallerGroups({ size: 70 }, [{ size: 70 }, { size: 587 }], true) // => true
 * isStripAmongTallerGroups({ size: 70 }, [{ size: 70 }, { size: 70 }], true)  // => false
 */
function isStripAmongTallerGroups(
  group: EditorLayoutGroups[number],
  groups: EditorLayoutGroups,
  isStack: boolean,
): boolean {
  return (
    isStack &&
    group.size === EDITOR_GROUP_MINIMUM_HEIGHT_PX &&
    groups.some((sibling) => sibling.size > EDITOR_GROUP_MINIMUM_HEIGHT_PX)
  )
}

/**
 * Tells {@link StudyWorkspace} that one stacked editor group is a strip of its tab row: it sits at the editor's minimum height while a group of the same stack is taller.
 *
 * That is the state a hidden editor area returns in when nothing gives the groups their sizes back: the Application group at
 * the minimum height above a source group that took the rest. It is detected for the one group on its own; an area whose
 * stacked groups all sit at the minimum is the hidden area itself, which {@link isCollapsedEditorLayout} reports.
 *
 * @param layout - What `vscode.getEditorLayout` returned.
 * @param viewColumn - The group's view column, which is its place among the layout's groups counted from 1.
 * @returns
 * - `true` when that group is one of several stacked groups, measures exactly {@link EDITOR_GROUP_MINIMUM_HEIGHT_PX} pixels and another group of its stack is taller
 * - `false` for a taller group, a group that is not stacked, a stack that is at the minimum as a whole, a column the layout does not have, and a layout that cannot be read
 * @example
 * isCollapsedEditorGroup({ orientation: 1, groups: [{ size: 70 }, { size: 587 }] }, 1) // => true
 * isCollapsedEditorGroup({ orientation: 1, groups: [{ size: 70 }, { size: 70 }] }, 1)  // => false
 * isCollapsedEditorGroup({ orientation: 1, groups: [{ size: 329 }, { size: 328 }] }, 1) // => false
 */
export function isCollapsedEditorGroup(
  layout: unknown,
  viewColumn: number,
): boolean {
  const parsed = editorLayoutSchema.safeParse(layout)
  if (!parsed.success) return false
  let visitedGroups = 0
  /** Walks one level of the grid in view-column order; sizes alternate between widths and heights from one level to the next. */
  const isCollapsedIn = (
    groups: EditorLayoutGroups,
    isStack: boolean,
  ): boolean =>
    groups.some((group) => {
      if (group.groups) return isCollapsedIn(group.groups, !isStack)
      visitedGroups++
      return (
        visitedGroups === viewColumn &&
        isStripAmongTallerGroups(group, groups, isStack)
      )
    })
  return isCollapsedIn(
    parsed.data.groups,
    parsed.data.orientation !== HORIZONTAL_EDITOR_ORIENTATION,
  )
}

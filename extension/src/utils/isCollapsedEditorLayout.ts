import type { z } from 'zod'

import {
  EDITOR_GROUP_MINIMUM_HEIGHT_PX,
  HORIZONTAL_EDITOR_ORIENTATION,
} from '../constants'

import { editorLayoutSchema } from './isProportionalEditorLayout'

/** One nesting level of an editor layout that {@link stackedGroupHeights} still has to visit: its groups, and whether their sizes are heights. */
type EditorLayoutLevel = {
  groups: z.infer<typeof editorLayoutSchema>['groups']
  isStack: boolean
}

/**
 * Lists the nesting levels below one level of an editor layout; called by {@link stackedGroupHeights} for each level it visits.
 * @param level - The level whose groups are looked at.
 * @returns One level per group that is split further, in the groups' order; its sizes run along the other axis than the given level's.
 * @example
 * nestedLevels({ groups: [{ size: 605, groups: [{ size: 70 }, { size: 70 }] }, { size: 495 }], isStack: false })
 * // => [{ groups: [{ size: 70 }, { size: 70 }], isStack: true }]
 */
function nestedLevels(level: EditorLayoutLevel): EditorLayoutLevel[] {
  return level.groups.flatMap((group) =>
    group.groups ? [{ groups: group.groups, isStack: !level.isStack }] : [],
  )
}

/**
 * Collects the heights of every group that is stacked above or below another one; called by {@link isCollapsedEditorLayout} with a layout that parsed.
 * @param layout - The parsed editor layout.
 * @returns The sizes of the groups of each level that stacks more than one group; empty for a layout without stacked groups.
 * @example
 * stackedGroupHeights({ orientation: 0, groups: [{ size: 605, groups: [{ size: 70 }, { size: 70 }] }, { size: 495 }] }) // => [70, 70]
 */
function stackedGroupHeights(
  layout: z.infer<typeof editorLayoutSchema>,
): number[] {
  const stackedHeights: number[] = []
  const pending: EditorLayoutLevel[] = [
    {
      groups: layout.groups,
      isStack: layout.orientation !== HORIZONTAL_EDITOR_ORIENTATION,
    },
  ]
  // Sizes alternate between widths and heights from one nesting level to the next.
  while (pending.length) {
    const level = pending.pop()!
    if (level.isStack && level.groups.length > 1)
      stackedHeights.push(...level.groups.map((group) => group.size))
    pending.push(...nestedLevels(level))
  }
  return stackedHeights
}

/**
 * Tells {@link StudyWorkspace} that the editor area has no height: the bottom panel (or the secondary side bar) is maximized and the editor groups are hidden.
 *
 * A hidden editor area is laid out with a height of zero, so the editor clamps every stacked group to its minimum height and
 * reports those pixels. Opening or revealing an editor then brings the area back (the panel leaves its maximized state) and, as
 * the revealed group sits at its minimum size, expands that group over its neighbours. A layout without stacked groups carries
 * no height and is never reported as collapsed; neither is a visible area, whose stacked groups are not all at the minimum.
 *
 * @param layout - What `vscode.getEditorLayout` returned.
 * @returns `true` when the layout has stacked groups and every one of them measures exactly {@link EDITOR_GROUP_MINIMUM_HEIGHT_PX} pixels.
 * @example
 * isCollapsedEditorLayout({ orientation: 0, groups: [{ size: 605, groups: [{ size: 70 }, { size: 70 }] }, { size: 495 }] }) // => true
 * isCollapsedEditorLayout({ orientation: 0, groups: [{ size: 605, groups: [{ size: 385 }, { size: 455 }] }, { size: 495 }] }) // => false
 */
export function isCollapsedEditorLayout(layout: unknown): boolean {
  const parsed = editorLayoutSchema.safeParse(layout)
  if (!parsed.success) return false
  const stackedHeights = stackedGroupHeights(parsed.data)
  return (
    stackedHeights.length > 0 &&
    stackedHeights.every((height) => height === EDITOR_GROUP_MINIMUM_HEIGHT_PX)
  )
}

import {
  EDITOR_GROUP_MINIMUM_HEIGHT_PX,
  HORIZONTAL_EDITOR_ORIENTATION,
} from '../constants'

import { editorLayoutSchema } from './isProportionalEditorLayout'

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
  const stackedHeights: number[] = []
  const pending = [
    {
      groups: parsed.data.groups,
      isStack: parsed.data.orientation !== HORIZONTAL_EDITOR_ORIENTATION,
    },
  ]
  // Sizes alternate between widths and heights from one nesting level to the next.
  while (pending.length) {
    const level = pending.pop()!
    if (level.isStack && level.groups.length > 1)
      stackedHeights.push(...level.groups.map((group) => group.size))
    for (const group of level.groups)
      if (group.groups)
        pending.push({ groups: group.groups, isStack: !level.isStack })
  }
  return (
    stackedHeights.length > 0 &&
    stackedHeights.every((height) => height === EDITOR_GROUP_MINIMUM_HEIGHT_PX)
  )
}

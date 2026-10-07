import { z } from 'zod'

import { HORIZONTAL_EDITOR_ORIENTATION } from '../constants'

/** A group of a layout that was read while a group is maximized: a hidden group may answer any size, also none, so only the shape is checked. */
const maximizedGroupSchema = z.object({ size: z.number().optional() })
const maximizedLayoutSchema = z.object({
  orientation: z.literal(HORIZONTAL_EDITOR_ORIENTATION),
  groups: z.array(maximizedGroupSchema).min(1),
})

/**
 * Reads the width of the editor area from a layout that was read while one editor group is maximized, for {@link StudyWorkspace}'s Read, which measures there whether its maximize command hid a secondary side bar.
 * While a group is maximized the editor hides every other group, and its grid answers a hidden group with the size it had while it was visible (VS Code 1.140 and Cursor 3.23, `serializeNode`: `size = cachedVisibleSize`). The sum of the columns is then wider than the area, and a hidden column that is itself split may answer a size no layout has. The column that holds the maximized group is the only visible one and has the whole area, which no hidden column's remembered width exceeds: the widest column is the area. Which group is maximized need not be known.
 * @param layout - The answer of `vscode.getEditorLayout`, read while a group is maximized.
 * @returns The width of the widest top-level column, in the layout's units (pixels in the editor); `undefined` for a grid of rows at its top level, an answer that is no layout, and columns of which none has a positive width.
 * @example
 * maximizedEditorAreaWidthPx({ orientation: 0, groups: [{ size: 1335, groups: [{ size: 420 }, { size: 420 }] }, { size: 601 }] }) // => 1335, the Application group maximized
 * maximizedEditorAreaWidthPx({ orientation: 0, groups: [{ size: 0, groups: [{ size: 420 }, { size: 420 }] }, { size: 1335 }] }) // => 1335, the Explanation group maximized
 */
export function maximizedEditorAreaWidthPx(
  layout: unknown,
): number | undefined {
  const parsed = maximizedLayoutSchema.safeParse(layout)
  if (!parsed.success) return undefined
  const widestPx = Math.max(
    ...parsed.data.groups.map((column) => column.size ?? 0),
  )
  return widestPx > 0 ? widestPx : undefined
}

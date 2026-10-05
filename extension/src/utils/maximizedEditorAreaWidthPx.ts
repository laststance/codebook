import { z } from 'zod'

import { HORIZONTAL_EDITOR_ORIENTATION } from '../constants'

/** A group of a layout that was read while a group is maximized: a hidden group may answer any size, also none, so only the shape is checked. */
const maximizedGroupSchema = z.object({
  size: z.number().optional(),
  groups: z.array(z.unknown()).optional(),
})
const maximizedLayoutSchema = z.object({
  orientation: z.literal(HORIZONTAL_EDITOR_ORIENTATION),
  groups: z.array(maximizedGroupSchema).min(1),
})

/**
 * Reads the width of the editor area from a layout that was read while one editor group is maximized, for {@link StudyWorkspace}'s Read, which measures there whether its maximize command hid a secondary side bar.
 * While a group is maximized the editor hides every other group, and its grid answers a hidden group with the size it had while it was visible (VS Code 1.140 and Cursor 3.23, `serializeNode`: `size = cachedVisibleSize`). The sum of the columns is then wider than the area, and a hidden column may answer a size no layout has. The column that holds the maximized group is the only visible one, so its width is the area's; the other columns are not read.
 * @param layout - The answer of `vscode.getEditorLayout`, read while a group is maximized.
 * @param maximizedColumn - The view column of the maximized group, counted through the layout's groups from 1.
 * @returns The width of the top-level column that holds that group, in the layout's units (pixels in the editor); `undefined` for a grid of rows at its top level, an answer that is no layout, a view column the layout does not have, and a column without a positive width.
 * @example
 * maximizedEditorAreaWidthPx({ orientation: 0, groups: [{ size: 1335, groups: [{ size: 420 }, { size: 420 }] }, { size: 601 }] }, 1) // => 1335, the Application group maximized
 * maximizedEditorAreaWidthPx({ orientation: 0, groups: [{ size: 0, groups: [{ size: 420 }, { size: 420 }] }, { size: 1335 }] }, 3) // => 1335, the Explanation group maximized
 */
export function maximizedEditorAreaWidthPx(
  layout: unknown,
  maximizedColumn: number,
): number | undefined {
  const parsed = maximizedLayoutSchema.safeParse(layout)
  if (!parsed.success) return undefined
  let firstGroupColumn = 1
  // The view columns count the groups in the layout's order; a column that is split holds one for each of its groups.
  for (const column of parsed.data.groups) {
    const groupCount = column.groups?.length ?? 1
    if (maximizedColumn < firstGroupColumn + groupCount)
      return column.size !== undefined && column.size > 0
        ? column.size
        : undefined
    firstGroupColumn += groupCount
  }
  return undefined
}

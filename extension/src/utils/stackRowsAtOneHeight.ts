import type { z } from 'zod'

import { VERTICAL_EDITOR_ORIENTATION } from '../constants'

import { hasRowAtMinimumHeight } from './hasRowAtMinimumHeight'
import { editorLayoutSchema } from './isProportionalEditorLayout'
import { stacksOfRows } from './stacksOfRows'

type EditorLayout = z.infer<typeof editorLayoutSchema>

/**
 * Gives an editor layout in which every stack of rows that has a row at the editor's minimum height beside a higher one ({@link hasRowAtMinimumHeight}) stands at one height, each row the stack's height divided by its count, rounded as {@link toPixelEditorLayout} rounds; every other size and every split stay as they are, so a row split into columns keeps its columns. Asked by {@link StudyWorkspace}'s `stackRowsLeftAtMinimum` for the layout it sets before an activation could expand that row (Cycle 0046 rows 691 and 704).
 * @param layout - What `vscode.getEditorLayout` returned, in pixels.
 * @returns The layout to set, in pixels; `undefined` for anything that is no layout.
 * @example
 * stackRowsAtOneHeight({ orientation: 1, groups: [{ size: 262 }, { size: 355 }, { size: 70, groups: [{ size: 550 }, { size: 550 }] }] })
 * // => { orientation: 1, groups: [{ size: 229 }, { size: 229 }, { size: 229, groups: [{ size: 550 }, { size: 550 }] }] }
 */
export function stackRowsAtOneHeight(
  layout: unknown,
): EditorLayout | undefined {
  const parsed = editorLayoutSchema.safeParse(layout)
  if (!parsed.success) return undefined
  const stacked = structuredClone(parsed.data)
  for (const rows of stacksOfRows(stacked)) {
    // Only a stack with a row at the minimum is changed; the stack is judged by its own rows.
    if (
      !hasRowAtMinimumHeight({
        orientation: VERTICAL_EDITOR_ORIENTATION,
        groups: rows.map((row) => ({ size: row.size })),
      })
    )
      continue
    const height = Math.round(
      rows.reduce((sum, row) => sum + row.size, 0) / rows.length,
    )
    for (const row of rows) row.size = height
  }
  return stacked
}

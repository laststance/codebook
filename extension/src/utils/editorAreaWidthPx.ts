import type { z } from 'zod'

import { HORIZONTAL_EDITOR_ORIENTATION } from '../constants'

import { editorLayoutSchema } from './isProportionalEditorLayout'

/**
 * Adds up the measured sizes of the columns of a grid's top level; called by {@link editorAreaWidthPx} for a layout that is split into columns.
 * @param columns - The top-level groups of the layout.
 * @returns
 * - The sum of the sizes when every column has one
 * - `undefined` when a column has no measured size: the width stays unknown
 * @example
 * summedColumnSizes([{ size: 363 }, { size: 297 }]) // => 660
 */
function summedColumnSizes(
  columns: z.infer<typeof editorLayoutSchema>['groups'],
): number | undefined {
  let width = 0
  // Every column needs its measured size; a column without one leaves the width unknown.
  for (const column of columns) {
    if (column.size === undefined) return undefined
    width += column.size
  }
  return width
}

/**
 * Reads the width of the editor area from a measured editor layout, for {@link StudyWorkspace}'s Read: the editor has no API that says whether a side bar is open, but the area between the side bars gets wider when one closes.
 * Only a grid that is split into columns at its top level gives that width (the sum of the columns); rows give their heights only.
 * @param layout - The answer of `vscode.getEditorLayout`.
 * @returns The editor area's width in the layout's units (pixels in the editor), or `undefined` for a grid of rows, a single group without a size, or an answer that is no layout.
 * @example
 * editorAreaWidthPx({ orientation: 0, groups: [{ size: 363 }, { size: 297 }] }) // => 660
 * editorAreaWidthPx({ orientation: 1, groups: [{ size: 329 }, { size: 328 }] }) // => undefined
 */
export function editorAreaWidthPx(layout: unknown): number | undefined {
  const parsed = editorLayoutSchema.safeParse(layout)
  if (
    !parsed.success ||
    parsed.data.orientation !== HORIZONTAL_EDITOR_ORIENTATION
  )
    return undefined
  return summedColumnSizes(parsed.data.groups)
}

import type { z } from 'zod'

import { VERTICAL_EDITOR_ORIENTATION } from '../constants'

import type { editorLayoutSchema } from './isProportionalEditorLayout'

type EditorLayout = z.infer<typeof editorLayoutSchema>
type EditorLayoutGroup = EditorLayout['groups'][number]

/**
 * Lists the stacks of rows of an editor layout as `vscode.getEditorLayout` gives it: the root's groups when the root stands in rows, and the groups of every nested split whose groups stand in rows, a nested split lying across the one it is in; read by {@link hasRowAtMinimumHeight} and {@link stackRowsAtOneHeight} (Cycle 0046 row 704: a learner's row split into columns, or a column split into rows).
 * @param layout - A parsed editor layout.
 * @returns Each stack's groups, the very objects of the given layout, from the root down; empty for a layout whose splits all stand in columns.
 * @example
 * stacksOfRows({ orientation: 1, groups: [{ size: 524 }, { size: 163, groups: [{ size: 550 }, { size: 550 }] }] }) // => [[{ size: 524 }, { size: 163, groups: […] }]]
 * stacksOfRows({ orientation: 0, groups: [{ size: 550, groups: [{ size: 524 }, { size: 163 }] }, { size: 550 }] }) // => [[{ size: 524 }, { size: 163 }]]
 */
export function stacksOfRows(layout: EditorLayout): EditorLayoutGroup[][] {
  const stacks: EditorLayoutGroup[][] = []
  const pending: { groups: EditorLayoutGroup[]; standInRows: boolean }[] = [
    {
      groups: layout.groups,
      standInRows: layout.orientation === VERTICAL_EDITOR_ORIENTATION,
    },
  ]
  // Every split is visited once; the groups of a split nested in another stand across that split's.
  while (pending.length) {
    const { groups, standInRows } = pending.shift()!
    if (standInRows) stacks.push(groups)
    for (const group of groups)
      if (group.groups)
        pending.push({ groups: group.groups, standInRows: !standInRows })
  }
  return stacks
}

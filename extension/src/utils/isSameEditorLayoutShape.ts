import type { z } from 'zod'

import { editorLayoutSchema } from './isProportionalEditorLayout'

type EditorLayoutGroups = z.infer<typeof editorLayoutSchema>['groups']

/**
 * Says whether two sibling lists of editor groups split the same way at every level, whatever their sizes; the step of {@link isSameEditorLayoutShape} for one level and those below it.
 * @param left - The groups of one layout at a level.
 * @param right - The groups of the other layout at the same level.
 * @returns `true` when both lists have the same number of groups and each pair is either two leaves or two splits of the same shape; `false` otherwise.
 * @example hasSameGroupShape([{ size: 1 }, { size: 2 }], [{ size: 5 }, { size: 5 }]) // => true
 */
function hasSameGroupShape(
  left: EditorLayoutGroups,
  right: EditorLayoutGroups,
): boolean {
  return (
    left.length === right.length &&
    left.every((group, index) => {
      const other = right[index]!
      // A leaf matches a leaf only; a split matches a split of the same shape.
      if (!group.groups || !other.groups) return !group.groups && !other.groups
      return hasSameGroupShape(group.groups, other.groups)
    })
  )
}

/**
 * Says whether two answers of the editor's layout read describe the same editor groups in the same splits, whatever their sizes; asked by {@link StudyWorkspace} before it gives the groups the sizes they had before a Read, so that a layout noted for other groups is never applied.
 * @param left - One layout as `vscode.getEditorLayout` answered it.
 * @param right - The other layout.
 * @returns `true` when both are layouts of the same orientation whose groups are split the same way at every level; `false` when a group was added, removed or split differently, and when either answer is no layout.
 * @example
 * isSameEditorLayoutShape({ orientation: 1, groups: [{ size: 344 }, { size: 343 }] }, { orientation: 1, groups: [{ size: 617 }, { size: 70 }] }) // => true
 * isSameEditorLayoutShape({ orientation: 1, groups: [{ size: 344 }, { size: 343 }] }, { orientation: 1, groups: [{ size: 300 }, { size: 200 }, { size: 187 }] }) // => false
 */
export function isSameEditorLayoutShape(
  left: unknown,
  right: unknown,
): boolean {
  const first = editorLayoutSchema.safeParse(left),
    second = editorLayoutSchema.safeParse(right)
  return (
    first.success &&
    second.success &&
    first.data.orientation === second.data.orientation &&
    hasSameGroupShape(first.data.groups, second.data.groups)
  )
}

import type { z } from 'zod'

import { editorLayoutSchema } from './isProportionalEditorLayout'

type EditorLayout = z.infer<typeof editorLayoutSchema>
type EditorLayoutGroup = EditorLayout['groups'][number]

/**
 * Removes the leaves a list of sibling groups holds at the given leaf indexes, and lifts what a split keeps of one child into the split's place; the step of {@link withoutEditorLayoutLeaves} for one level and those below it.
 * A split that keeps one leaf becomes that leaf with the split's size. A split that keeps one split hands that split's groups to its own parent: both run in the parent's direction, since splits alternate.
 * @param groups - The sibling groups of one level.
 * @param removed - The leaf indexes to remove, counted over the whole layout in its order.
 * @param nextLeaf - The index of the first leaf of `groups`.
 * @returns The groups that stand in the parent's place, and the index of the first leaf after them.
 * @example keptGroups([{ size: 229 }, { size: 349 }], new Set([0]), 0) // => { groups: [{ size: 349 }], nextLeaf: 2 }
 */
function keptGroups(
  groups: readonly EditorLayoutGroup[],
  removed: ReadonlySet<number>,
  nextLeaf: number,
): { groups: EditorLayoutGroup[]; nextLeaf: number } {
  const kept: EditorLayoutGroup[] = []
  let leaf = nextLeaf
  for (const group of groups) {
    // A leaf is kept or removed by its index.
    if (!group.groups) {
      if (!removed.has(leaf)) kept.push(group)
      leaf++
      continue
    }
    const inner = keptGroups(group.groups, removed, leaf)
    leaf = inner.nextLeaf
    const [only] = inner.groups
    // A split that keeps one child is replaced by it: a leaf takes the split's size, a split's groups join this level.
    if (inner.groups.length === 1 && only)
      kept.push(...(only.groups ?? [{ size: group.size }]))
    else if (inner.groups.length > 1)
      kept.push({ size: group.size, groups: inner.groups })
  }
  return { groups: kept, nextLeaf: leaf }
}

/**
 * Gives the layout an editor's groups had, without the leaves of groups that are gone; {@link StudyWorkspace} asks it at Close for the learner's layout of before the Open when the editor removed an empty group in front of the learner's groups that stay (an earlier window's leftover Application group the pane's move emptied, row 639), so the groups that stay get their arrangement back without an empty group made again behind them.
 * Leaves are counted depth-first in the layout's order, the order of the editor's view columns. A split left with one child is replaced by that child; when the root keeps one split, the root takes that split's direction and groups.
 * @param layout - A layout as `vscode.getEditorLayout` answered it.
 * @param removed - The indexes of the leaves to remove.
 * @returns
 * - The layout without those leaves, with the sizes of the groups that stay.
 * - The layout as it was when nothing is removed, or when it is no layout.
 * - `undefined` when every leaf would be removed.
 * @example
 * withoutEditorLayoutLeaves({ orientation: 1, groups: [{ size: 229 }, { size: 349 }, { size: 109 }] }, new Set([0])) // => { orientation: 1, groups: [{ size: 349 }, { size: 109 }] }
 * withoutEditorLayoutLeaves({ orientation: 1, groups: [{ size: 300 }, { size: 400, groups: [{ size: 500 }, { size: 600 }] }] }, new Set([0])) // => { orientation: 0, groups: [{ size: 500 }, { size: 600 }] }
 */
export function withoutEditorLayoutLeaves(
  layout: unknown,
  removed: ReadonlySet<number>,
): unknown {
  const parsed = editorLayoutSchema.safeParse(layout)
  if (removed.size === 0 || !parsed.success) return layout
  const { groups } = keptGroups(parsed.data.groups, removed, 0)
  const [only] = groups
  if (!only) return undefined
  // A root that keeps one split turns into that split, which runs the other way.
  if (groups.length === 1 && only.groups)
    return {
      orientation: parsed.data.orientation === 0 ? 1 : 0,
      groups: only.groups,
    }
  return { orientation: parsed.data.orientation, groups }
}

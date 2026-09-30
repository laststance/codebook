import { z } from 'zod'
import {
  EDITOR_LAYOUT_ROUNDING_FRACTION,
  HORIZONTAL_EDITOR_ORIENTATION,
} from '../constants'

const leaf = z.strictObject({ size: z.number().finite().positive() })
const study = z.strictObject({
  orientation: z.literal(HORIZONTAL_EDITOR_ORIENTATION),
  groups: z.tuple([
    z.strictObject({
      size: z.number().finite().positive(),
      groups: z.tuple([leaf, leaf]),
    }),
    leaf,
  ]),
})
const repository = z.strictObject({
  orientation: z.literal(HORIZONTAL_EDITOR_ORIENTATION),
  groups: z.tuple([leaf, leaf, leaf]),
})

/** Verifies requested equal splits before {@link StudyWorkspace} adopts a host receipt, excluding manual sizes and other topologies. @example isBalancedEditorLayout({ orientation: 0, groups: [{ size: 220 }, { size: 220 }, { size: 220 }] }, 'repository') // true */
export function isBalancedEditorLayout(
  layout: unknown,
  mode: 'study' | 'repository',
): boolean {
  const parsed =
    mode === 'study' ? study.safeParse(layout) : repository.safeParse(layout)
  if (!parsed.success) return false
  const first = parsed.data.groups[0],
    siblings = [
      parsed.data.groups,
      ...('groups' in first ? [first.groups] : []),
    ]
  return siblings.every((groups) => {
    const total = groups.reduce((sum, group) => sum + group.size, 0),
      expected = 1 / groups.length
    return groups.every(
      (group) =>
        Math.abs(group.size / total - expected) <=
        EDITOR_LAYOUT_ROUNDING_FRACTION,
    )
  })
}

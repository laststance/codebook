import type { z } from 'zod'
import { HORIZONTAL_EDITOR_ORIENTATION } from '../constants'
import { editorLayoutSchema } from './isProportionalEditorLayout'

type EditorLayout = z.infer<typeof editorLayoutSchema>

/** Sizes {@link StudyWorkspace} placement from measured native axes when a host retains a minimum-size group.
 * @param expected - The requested editor group proportions.
 * @param actual - The measured native editor group sizes.
 * @returns A pixel layout when its required axes are measured; otherwise undefined.
 * @example toPixelEditorLayout({ orientation: 1, groups: [{ size: 0.5 }, { size: 0.5 }] }, { orientation: 1, groups: [{ size: 70 }, { size: 1200 }] }) // two 635px rows
 */
export function toPixelEditorLayout(
  expected: unknown,
  actual: unknown,
): EditorLayout | undefined {
  const requested = editorLayoutSchema.safeParse(expected),
    received = editorLayoutSchema.safeParse(actual)
  if (!requested.success || !received.success) return undefined
  const primarySize = received.data.groups.reduce(
    (sum, group) => sum + group.size,
    0,
  )
  const crossSizes = received.data.groups.flatMap((group) =>
    group.groups
      ? [group.groups.reduce((sum, child) => sum + child.size, 0)]
      : [],
  )
  const crossSize = Math.max(0, ...crossSizes)
  // A flat requested grid needs only its primary axis; nested panes still require a measured cross axis.
  const needsCrossAxis = requested.data.groups.some((group) => group.groups)
  if (
    !Number.isFinite(primarySize) ||
    primarySize <= 1 ||
    (crossSize <= 1 &&
      (needsCrossAxis ||
        requested.data.orientation !== received.data.orientation))
  )
    return undefined
  const width =
    received.data.orientation === HORIZONTAL_EDITOR_ORIENTATION
      ? primarySize
      : crossSize
  const height =
    received.data.orientation === HORIZONTAL_EDITOR_ORIENTATION
      ? crossSize
      : primarySize
  const scale = (
    groups: EditorLayout['groups'],
    availableWidth: number,
    availableHeight: number,
    orientation: EditorLayout['orientation'],
  ): EditorLayout['groups'] => {
    const total = groups.reduce((sum, group) => sum + group.size, 0)
    return groups.map((group) => {
      const horizontal = orientation === HORIZONTAL_EDITOR_ORIENTATION
      const size = Math.round(
        (group.size / total) * (horizontal ? availableWidth : availableHeight),
      )
      // Nested splits use the other axis and the parent's allocated span, not the outer sibling total.
      return {
        size,
        ...(group.groups
          ? {
              groups: scale(
                group.groups,
                horizontal ? size : availableWidth,
                horizontal ? availableHeight : size,
                horizontal ? 1 : 0,
              ),
            }
          : {}),
      }
    })
  }
  const scaled = editorLayoutSchema.safeParse({
    orientation: requested.data.orientation,
    groups: scale(
      requested.data.groups,
      width,
      height,
      requested.data.orientation,
    ),
  })
  return scaled.success ? scaled.data : undefined
}

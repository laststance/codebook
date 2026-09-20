import { z } from 'zod';
import { EDITOR_LAYOUT_ROUNDING_FRACTION } from '../constants';

const groupSchema = z.strictObject({
  size: z.number().finite().positive(),
  get groups(): z.ZodOptional<z.ZodArray<typeof groupSchema>> { return z.array(groupSchema).min(1).optional(); },
});
const layoutSchema = z.strictObject({ orientation: z.union([z.literal(0), z.literal(1)]), groups: z.array(groupSchema).min(1) });

/** Certifies host-resized splits after {@link StudyWorkspace} applies a saved grid; ownership checks still require exact receipts. @example isProportionalEditorLayout({ orientation: 0, groups: [{ size: 326 }, { size: 326 }] }, { orientation: 0, groups: [{ size: 330 }, { size: 330 }] }) // true */
export function isProportionalEditorLayout(expected: unknown, actual: unknown): boolean {
  const requested = layoutSchema.safeParse(expected), received = layoutSchema.safeParse(actual);
  if (!requested.success || !received.success || requested.data.orientation !== received.data.orientation) return false;
  const pending = [{ expected: requested.data.groups, actual: received.data.groups }];
  // Each nested split has its own available axis; absolute host pixel sizes may change while its proportions remain intact.
  while (pending.length) {
    const siblings = pending.pop()!;
    if (siblings.expected.length !== siblings.actual.length) return false;
    const expectedTotal = siblings.expected.reduce((sum, group) => sum + group.size, 0), actualTotal = siblings.actual.reduce((sum, group) => sum + group.size, 0);
    if (!Number.isFinite(expectedTotal) || !Number.isFinite(actualTotal)) return false;
    // Preserve ordered topology and every sibling ratio, rather than accepting any grid with the same leaf count.
    for (const [index, expectedGroup] of siblings.expected.entries()) {
      const actualGroup = siblings.actual[index]!;
      if (Math.abs(expectedGroup.size / expectedTotal - actualGroup.size / actualTotal) > EDITOR_LAYOUT_ROUNDING_FRACTION || Boolean(expectedGroup.groups) !== Boolean(actualGroup.groups)) return false;
      if (expectedGroup.groups && actualGroup.groups) pending.push({ expected: expectedGroup.groups, actual: actualGroup.groups });
    }
  }
  return true;
}

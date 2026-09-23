import { editorLayoutSchema } from './isProportionalEditorLayout';

/** Counts measured native leaves for {@link StudyWorkspace} admission; invalid geometry cannot authorize a layout change. @example editorLayoutGroupCount({ orientation: 0, groups: [{ size: 300 }, { size: 300 }] }) // 2 */
export function editorLayoutGroupCount(layout: unknown): number | undefined {
  const parsed = editorLayoutSchema.safeParse(layout);
  if (!parsed.success) return undefined;
  const pending = [...parsed.data.groups];
  let count = 0;
  // A nested split is a container; only its actual editor leaves consume global columns.
  while (pending.length) {
    const group = pending.pop()!;
    if (group.groups) pending.push(...group.groups);
    else count++;
  }
  return count;
}

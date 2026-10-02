/**
 * Lets go of something the reader holds for a saved study once that study was removed; called by {@link StudyWorkspace} for its held archives and its Save learning replay state.
 * @param held - What the reader holds, named by its study through `id` or `studyId`.
 * @param studyId - The study that was removed.
 * @returns `undefined` when `held` belongs to that study, otherwise `held` unchanged.
 * @example
 * withoutStudy({ id: 'a_b' }, 'a_b')      // => undefined
 * withoutStudy({ studyId: 'a_c' }, 'a_b') // => { studyId: 'a_c' }
 * withoutStudy(undefined, 'a_b')          // => undefined
 */
export function withoutStudy<Held extends { id: string } | { studyId: string }>(
  held: Held | undefined,
  studyId: string,
): Held | undefined {
  if (!held) return undefined
  return ('id' in held ? held.id : held.studyId) === studyId ? undefined : held
}

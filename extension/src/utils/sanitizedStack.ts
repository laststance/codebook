import { sanitizeCause, type CauseRoots } from './sanitizeCause'

/**
 * Gives a thrown error's stack for the Output › Codebook channel without the private paths its frames name, one sanitized line per frame; called by {@link StudyService} and {@link NodeLearningSave} beside the sanitized cause of an unexpected failure ({@link formatCodebookDiagnostic}).
 * The stack's first line repeats the message, which the entry's cause already holds, so it is left out.
 * @param error - What was thrown.
 * @param roots - The private roots of this window.
 * @returns The frames, each sanitized ({@link sanitizeCause}); `undefined` for a value that is no error or has no stack.
 * @example
 * sanitizedStack(new Error('EIO'), { storage: [], home: '/Users/ada' })
 * // => 'at NodeTestHistoryWriter.finish (~/.vscode/extensions/laststance.codebook-0.2.33/dist/nodeTestHistoryStore.js:812:13)\n…'
 */
export function sanitizedStack(
  error: unknown,
  roots: CauseRoots,
): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined
  const frames = error.stack
    .split('\n')
    .slice(1)
    .map((line) => sanitizeCause(line, roots))
    .filter(Boolean)
  return frames.length ? frames.join('\n') : undefined
}

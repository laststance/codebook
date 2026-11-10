/**
 * Replaces excerpt ids such as `S3` in a Wiki answer with that excerpt's file path, because the reader lists citations as file links without ids and a learner cannot tell which file `S3` means.
 *
 * Called by {@link answerDeepWikiQuestionWithPrompt} on the model's answer text, since a model may write ids into its prose despite the prompt. Matches `S` (or full-width `Ｓ`) followed by ASCII or full-width digits as a whole word; an id naming no excerpt stays as written.
 *
 * @param answer - The model's answer text.
 * @param excerpts - The prompt's excerpts; each id is `S<n>` for the n-th (one-based) of them.
 * @returns The answer with every id of an excerpt of this prompt replaced by its path.
 * @example
 * replaceExcerptIdsWithPaths('See S2, not S9.', [
 *   { id: 'S1', path: 'a.ts' },
 *   { id: 'S2', path: 'app/lib/data.ts' },
 * ]) // => 'See app/lib/data.ts, not S9.'
 */
export function replaceExcerptIdsWithPaths(
  answer: string,
  excerpts: readonly { id: string; path: string }[],
): string {
  return answer.replace(
    /(?<![A-Za-z0-9Ａ-Ｚａ-ｚ０-９])[SＳ][0-9０-９]+(?![A-Za-z0-9Ａ-Ｚａ-ｚ０-９])/g,
    (token) => {
      // Normalize full-width letters and digits so `Ｓ３` finds excerpt `S3`.
      const id = token.normalize('NFKC')
      return excerpts.find((excerpt) => excerpt.id === id)?.path ?? token
    },
  )
}

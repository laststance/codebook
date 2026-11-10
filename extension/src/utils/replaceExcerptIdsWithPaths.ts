/** Whole-word excerpt id shape: `S` or full-width `Ｓ`, then ASCII or full-width digits. */
const EXCERPT_ID_PATTERN =
  /(?<![A-Za-z0-9Ａ-Ｚａ-ｚ０-９])[SＳ][0-9０-９]+(?![A-Za-z0-9Ａ-Ｚａ-ｚ０-９])/g

/**
 * Replaces excerpt ids such as `S3` in a Wiki answer with that excerpt's file path, because the reader lists citations as file links without ids and a learner cannot tell which file `S3` means.
 *
 * Called by {@link answerDeepWikiQuestionWithPrompt} on the model's answer text, since a model may write ids into its prose despite the prompt. An id-shaped word that also appears as a whole word in the question or in any excerpt's lines (for example the real service name `S3`) is ambiguous and stays as written, as does an id naming no excerpt.
 *
 * @param answer - The model's answer text.
 * @param question - The learner's question.
 * @param excerpts - The prompt's excerpts; each id is `S<n>` for the n-th (one-based) of them.
 * @returns The answer with every unambiguous id of an excerpt of this prompt replaced by its path.
 * @example
 * replaceExcerptIdsWithPaths('Files go to S3 (see S1).', 'Where do files go?', [
 *   { id: 'S1', path: 'app/up.ts', lines: '1: // upload to S3' },
 * ]) // => 'Files go to S3 (see app/up.ts).'
 */
export function replaceExcerptIdsWithPaths(
  answer: string,
  question: string,
  excerpts: readonly { id: string; path: string; lines: string }[],
): string {
  // Id-shaped words the source or question uses itself are its own vocabulary, not excerpt ids.
  const sourceText = [question, ...excerpts.map((excerpt) => excerpt.lines)]
    .join('\n')
    .normalize('NFKC')
  const ownWords = new Set(sourceText.match(EXCERPT_ID_PATTERN))
  return answer.replace(EXCERPT_ID_PATTERN, (token) => {
    // Normalize full-width letters and digits so `Ｓ３` finds excerpt `S3`.
    const id = token.normalize('NFKC')
    if (ownWords.has(id)) return token
    return excerpts.find((excerpt) => excerpt.id === id)?.path ?? token
  })
}

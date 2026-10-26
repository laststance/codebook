/**
 * Words that a folder already holds an LLM Wiki and offers its update, for the notice a generation shows instead of overwriting it (Cycle 0055, D2).
 * @param outputLabel - The Wiki folder as the learner reads it.
 * @returns The sentence that names the folder and asks for the update.
 * @example describeExistingWiki('.codebook/wiki') // => 'An LLM Wiki already exists in .codebook/wiki. Update it instead?'
 */
export function describeExistingWiki(outputLabel: string): string {
  return `An LLM Wiki already exists in ${outputLabel}. Update it instead?`
}

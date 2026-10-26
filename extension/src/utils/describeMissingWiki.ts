/**
 * Words that a folder holds no LLM Wiki, for the notices of Open LLM Wiki in Browser and Update LLM Wiki, which offer Generate LLM Wiki beside it (Cycle 0055, proposed change 3).
 * @param outputLabel - The Wiki folder as the learner reads it.
 * @returns The sentence that names the folder.
 * @example describeMissingWiki('.codebook/wiki') // => 'Codebook found no LLM Wiki in .codebook/wiki.'
 */
export function describeMissingWiki(outputLabel: string): string {
  return `Codebook found no LLM Wiki in ${outputLabel}.`
}

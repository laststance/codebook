/**
 * Words the refusal of a generation whose output folder already exists but holds no LLM Wiki, with its next step; called by {@link startWikiGenerate} before the confirmation and again before the claim.
 * Why: the publisher writes a first Wiki only into a folder it makes itself and refuses an existing one without its publication record (`publish-wiki.mjs`, `inspectOutput`); `--adopt-existing` needs a manifest too. An agent started for such a folder works up to 55 minutes for a publish that is refused, or clears the folder itself (/ship review, Cycle 0055 pt1; the root cause of E1-F3).
 * @param outputLabel - The Wiki folder as the learner reads it.
 * @returns The sentence that names the folder, keeps its files and gives the two ways on.
 * @example
 * describeOutputFolderWithoutWiki('.codebook/wiki')
 * // => 'The folder .codebook/wiki already exists but holds no LLM Wiki, and the publisher writes a first Wiki only into a folder it makes itself. Move what you keep in it elsewhere and remove the folder, or set codebook.wikiOutputDirectory to a folder that does not exist yet, then press Generate LLM Wiki again.'
 */
export function describeOutputFolderWithoutWiki(outputLabel: string): string {
  return `The folder ${outputLabel} already exists but holds no LLM Wiki, and the publisher writes a first Wiki only into a folder it makes itself. Move what you keep in it elsewhere and remove the folder, or set codebook.wikiOutputDirectory to a folder that does not exist yet, then press Generate LLM Wiki again.`
}

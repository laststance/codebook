import { WIKI_GENERATE_CHAT_REQUEST } from '../constants'

/**
 * Checks the new publication a generation left: that its manifest names this opened project and that its entry page can be opened, each read as a file of the Wiki folder.
 * Why: a generation's success is a Wiki the learner can open from this project (Cycle 0055, DX decision 54); a publication of another checkout, or one whose entry page cannot be read, is no such Wiki, whatever its freshness.
 * Trigger: the extension calls it at a generation's end, only when the publisher's receipt names a new manifest; {@link classifyWikiUpdateEnd} then records the sentence as the failure.
 * @param checks.isOwnedByProject - Answers whether the manifest names this opened project ({@link isWikiManifestOf}); rejects for a manifest that cannot be read as one (no regular file, no JSON), which is no other checkout's but a publish to recover.
 * @param checks.readEntryPage - Throws for an entry page that is missing, a link or no regular file ({@link readWikiFileToOpen}).
 * @param outputLabel - The Wiki folder as the learner reads it.
 * @returns The sentence of the first check that failed, with its next step; `undefined` when both passed, and for a manifest that cannot be read, which the end tells with the recovery request ({@link classifyWikiUpdateEnd}).
 * @example
 * await findGeneratedWikiProblem({ isOwnedByProject: async () => true, readEntryPage: async () => { throw new Error('missing') } }, '.codebook/wiki')
 * // => 'The LLM Wiki published in .codebook/wiki has no entry page Codebook can open (index.html). Ask the editor chat "/codebook Generate the LLM Wiki for this project" to publish it again.'
 */
export async function findGeneratedWikiProblem(
  checks: {
    isOwnedByProject: () => Promise<boolean>
    readEntryPage: () => Promise<unknown>
  },
  outputLabel: string,
): Promise<string | undefined> {
  const isOwned = await checks.isOwnedByProject().catch(() => undefined)
  // A manifest that cannot be read is a publish to recover, not another checkout's: the end tells it with the recovery request.
  if (isOwned === undefined) return undefined
  if (!isOwned)
    return `The LLM Wiki published in ${outputLabel} does not identify this opened project. Set codebook.wikiOutputDirectory to a folder of this project, then press Generate LLM Wiki again.`
  try {
    await checks.readEntryPage()
  } catch {
    return `The LLM Wiki published in ${outputLabel} has no entry page Codebook can open (index.html). Ask the editor chat "${WIKI_GENERATE_CHAT_REQUEST}" to publish it again.`
  }
  return undefined
}

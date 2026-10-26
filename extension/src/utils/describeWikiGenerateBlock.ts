import { WIKI_UPDATE_RECOVERY_REQUEST } from '../constants'

import type { WikiUpdateStartBlock } from './findWikiUpdateStartBlock'

/**
 * Words why a first LLM Wiki generation cannot start, for what {@link findWikiUpdateStartBlock} found in the way of the publisher, with the next step.
 *
 * Why: the publisher refuses each of these before it stages anything, so no agent could succeed, and the update's sentences name an update and its button (Cycle 0055, D5). A folder without a manifest can hold only these causes: a publish lock or journal, a link or file in place of the folder or on its path, and a link or special file in it. A cause that needs a manifest is told by the update, which Generate offers where a manifest stands.
 * Trigger: {@link startWikiGenerate} calls it when the start check finds a block.
 *
 * @param block - The cause and the paths the start check named.
 * @param outputLabel - The Wiki folder as the learner reads it.
 * @returns The sentence for the cause, naming the first path and the next step; for a cause no folder without a manifest can hold, the sentence that names the cause and sends the learner to the update.
 * @example
 * describeWikiGenerateBlock({ cause: 'held-publish-lock', paths: ['wiki.publish-lock.json'] }, '.codebook/wiki')
 * // => 'A publish of the LLM Wiki in .codebook/wiki may still be running or was stopped (wiki.publish-lock.json). Once it ends, press Generate LLM Wiki again; if it was stopped, ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project" once its process exits.'
 */
export function describeWikiGenerateBlock(
  block: WikiUpdateStartBlock,
  outputLabel: string,
): string {
  const firstPath = block.paths[0] ?? outputLabel
  switch (block.cause) {
    case 'held-publish-lock':
    case 'unfinished-publish':
      return `A publish of the LLM Wiki in ${outputLabel} may still be running or was stopped (${firstPath}). Once it ends, press Generate LLM Wiki again; if it was stopped, ask the editor chat "${WIKI_UPDATE_RECOVERY_REQUEST}" once its process exits.`
    case 'not-a-folder':
      return `${outputLabel} is a link or a file, not a folder of its own, so the publisher cannot write the Wiki there. Remove it, or set codebook.wikiOutputDirectory to another folder, then press Generate LLM Wiki again.`
    case 'linked-parent':
      return `A folder on the path to ${outputLabel} (${firstPath}) is a link or a file, or leads out of the project, so the publisher refuses to write there. Replace it with a real folder, or set codebook.wikiOutputDirectory to another folder, then press Generate LLM Wiki again.`
    case 'special-file':
      return `${outputLabel} holds a link or special file (${firstPath}), which the publisher refuses. Move it out of the folder, then press Generate LLM Wiki again.`
    default:
      return `The folder ${outputLabel} cannot take a new LLM Wiki (${block.cause}: ${firstPath}). Press Update LLM Wiki to see what is in the way.`
  }
}

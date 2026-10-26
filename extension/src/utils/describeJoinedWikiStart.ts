import { WIKI_RUN_KIND_WORDS } from './wikiRunKindWords'
import type { WikiRunKind } from './wikiUpdateRun'

/**
 * Words a press that joined an LLM Wiki start already under way in this window, so the press is not met with silence.
 * Why: a second press during a start's checks or its confirmation is coalesced into the first (`runWikiAttempt`); without a sentence the learner cannot tell it from a press that did nothing (Cycle 0056 task 2).
 * Trigger: the extension shows it when Generate or Update LLM Wiki, or the browser reader's Update, arrives while a start of this window has not begun its run yet.
 * A press that carries a choice ("Update anyway", "Generate anyway", the offer's "Update") joins the start without that choice: the sentence says so, because the start was checked without it and may refuse for the same reason (Cycle 0056 A2).
 * @param runKind - The kind of the start that is under way, which the press joins.
 * @param isChoiceCarried - Whether the press carried the learner's choice to go on anyway or to update instead, which the joined start does not apply.
 * @returns The information sentence, naming the start's kind.
 * @example
 * describeJoinedWikiStart('generate') // => 'Codebook is already starting an LLM Wiki generation in this window; this press joins it.'
 * describeJoinedWikiStart('update')   // => 'Codebook is already starting an LLM Wiki update in this window; this press joins it.'
 * describeJoinedWikiStart('update', true) // => 'Codebook is already starting an LLM Wiki update in this window, so this choice was not applied. If that start stops for the same reason, choose it again.'
 */
export function describeJoinedWikiStart(
  runKind: WikiRunKind,
  isChoiceCarried = false,
): string {
  if (isChoiceCarried)
    return `Codebook is already starting an LLM Wiki ${WIKI_RUN_KIND_WORDS[runKind].noun} in this window, so this choice was not applied. If that start stops for the same reason, choose it again.`
  return `Codebook is already starting an LLM Wiki ${WIKI_RUN_KIND_WORDS[runKind].noun} in this window; this press joins it.`
}

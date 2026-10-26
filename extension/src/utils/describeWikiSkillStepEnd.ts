import { secondsText } from './secondsText'
import { SET_UP_AI_CHAT_COMMAND } from './startOverBy'
import type { WikiRunKind } from './wikiUpdateRun'

/**
 * Words how a start ended while Codebook readied the managed Cursor skill: the learner stopped it, or the step passed its bound.
 * Why: the skill step runs with the run's marker claimed and no agent yet; the learner needs to know the start is over, that no agent was started and what to press next (Cycle 0056 task 13).
 * Trigger: {@link runUnderAbortSignal} rejects with the abort reason, and the extension turns it into this sentence for the start's refusal.
 * @param end - `stopped` after Stop LLM Wiki Run, `bound` after the step's bound passed.
 * @param runKind - The kind of the start.
 * @param boundMs - The step's bound in milliseconds, named by the `bound` sentence.
 * @returns The sentence of the end.
 * @example
 * describeWikiSkillStepEnd('stopped', 'generate', 30_000) // => 'The LLM Wiki generation was stopped while Codebook readied the Cursor skill; no agent was started.'
 * describeWikiSkillStepEnd('bound', 'update', 30_000)     // => 'Codebook stopped readying the Cursor skill after 30 seconds; no agent was started. Press Update LLM Wiki again, or run Codebook: Set Up AI Chat.'
 */
export function describeWikiSkillStepEnd(
  end: 'stopped' | 'bound',
  runKind: WikiRunKind,
  boundMs: number,
): string {
  if (end === 'stopped')
    return `The LLM Wiki ${runKind === 'generate' ? 'generation' : 'update'} was stopped while Codebook readied the Cursor skill; no agent was started.`
  return `Codebook stopped readying the Cursor skill after ${secondsText(boundMs)}; no agent was started. Press ${runKind === 'generate' ? 'Generate' : 'Update'} LLM Wiki again, or run ${SET_UP_AI_CHAT_COMMAND}.`
}

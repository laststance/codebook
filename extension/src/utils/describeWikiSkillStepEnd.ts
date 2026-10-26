import type { WIKI_SKILL_STEP_BOUND_REASON } from '../constants'
import {
  WIKI_SKILL_STEP_EARLIER_RUNNING_END,
  WIKI_SKILL_STEP_EARLIER_RUNNING_SENTENCE,
  WIKI_SKILL_STEP_REMOVAL_END,
  WIKI_SKILL_STEP_STOPPED_REASON,
} from '../constants'

import { secondsText } from './secondsText'
import { SET_UP_AI_CHAT_COMMAND } from './startOverBy'
import { WIKI_RUN_KIND_WORDS } from './wikiRunKindWords'
import type { WikiRunKind } from './wikiUpdateRun'

/** How a Cursor skill step ended: the abort reasons of {@link WIKI_SKILL_STEP_STOPPED_REASON} and {@link WIKI_SKILL_STEP_BOUND_REASON}, {@link WIKI_SKILL_STEP_EARLIER_RUNNING_END} where the bound passed while the step still waited for an earlier step, or {@link WIKI_SKILL_STEP_REMOVAL_END} where the step began during Remove Managed Cursor Skill. */
export type WikiSkillStepEnd =
  | typeof WIKI_SKILL_STEP_STOPPED_REASON
  | typeof WIKI_SKILL_STEP_BOUND_REASON
  | typeof WIKI_SKILL_STEP_EARLIER_RUNNING_END
  | typeof WIKI_SKILL_STEP_REMOVAL_END

/**
 * Words how a start ended while Codebook readied the managed Cursor skill: the learner stopped it, the step passed its bound, or a removal of the skill was under way.
 * Why: the skill step runs with the run's marker claimed and no agent yet; the learner needs to know the start is over, that no agent was started and what to press next (Cycle 0056 task 13).
 * Trigger: {@link runUnderAbortSignal} rejects with the abort reason, and the extension turns it into this sentence for the start's refusal.
 * @param end - `stopped` after Stop LLM Wiki Run, `bound` after the step's bound passed, `earlier-step-running` after the bound passed while the step still waited for an earlier step of this window that never settled, `skill-removal` when the step began while Remove Managed Cursor Skill was under way.
 * @param runKind - The kind of the start.
 * @param boundMs - The step's bound in milliseconds, named by the `bound` sentence.
 * @param stoppedAt - When the learner stopped it, as the learner's local time ({@link formatClockTime}); the `stopped` sentence names it as every Cursor cancellation does.
 * @returns The sentence of the end.
 * @example
 * describeWikiSkillStepEnd('stopped', 'generate', 30_000, '21:10') // => 'The LLM Wiki generation was cancelled at 21:10 while Codebook readied the Cursor skill; no agent was started. Press Generate LLM Wiki when you want to start again.'
 * describeWikiSkillStepEnd('earlier-step-running', 'update', 30_000, '21:10') // => 'Codebook could not ready the Cursor skill: an earlier Cursor skill step in this window is still running. Reload the window (Developer: Reload Window) to end it, then press Update LLM Wiki again.'
 * describeWikiSkillStepEnd('bound', 'update', 30_000, '21:10')     // => 'Codebook stopped readying the Cursor skill after 30 seconds; no agent was started. Press Update LLM Wiki again, or run Codebook: Set Up AI Chat.'
 * describeWikiSkillStepEnd('skill-removal', 'generate', 30_000, '21:10') // => 'Codebook is removing the managed Cursor skill in this window; no agent was started. Press Generate LLM Wiki again when the removal has finished, and Codebook installs its skill again.'
 */
export function describeWikiSkillStepEnd(
  end: WikiSkillStepEnd,
  runKind: WikiRunKind,
  boundMs: number,
  stoppedAt: string,
): string {
  const { noun, button } = WIKI_RUN_KIND_WORDS[runKind]
  if (end === WIKI_SKILL_STEP_STOPPED_REASON)
    return `The LLM Wiki ${noun} was cancelled at ${stoppedAt} while Codebook readied the Cursor skill; no agent was started. Press ${button} LLM Wiki when you want to start again.`
  if (end === WIKI_SKILL_STEP_EARLIER_RUNNING_END)
    return `${WIKI_SKILL_STEP_EARLIER_RUNNING_SENTENCE}, then press ${button} LLM Wiki again.`
  if (end === WIKI_SKILL_STEP_REMOVAL_END)
    return `Codebook is removing the managed Cursor skill in this window; no agent was started. Press ${button} LLM Wiki again when the removal has finished, and Codebook installs its skill again.`
  return `Codebook stopped readying the Cursor skill after ${secondsText(boundMs)}; no agent was started. Press ${button} LLM Wiki again, or run ${SET_UP_AI_CHAT_COMMAND}.`
}

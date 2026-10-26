import {
  WIKI_SKILL_STEP_BOUND_REASON,
  WIKI_SKILL_STEP_EARLIER_RUNNING_END,
  WIKI_SKILL_STEP_STOPPED_REASON,
} from '../constants'

import type { WikiSkillStepEnd } from './describeWikiSkillStepEnd'

/**
 * Names how an aborted Cursor skill step ended, from its abort reason and whether it still waited for an earlier step.
 * Why: the bound and the learner's Stop (or the closing window) abort the same step, and a bound that fires while the step only waits for an earlier hung step has a different cause and a different next step ({@link describeWikiSkillStepEnd}).
 * Trigger: the extension's skill step calls it when its wait was aborted, before it words the end.
 * @param abortReason - The reason the step's abort carried: {@link WIKI_SKILL_STEP_BOUND_REASON} from the bound, {@link WIKI_SKILL_STEP_STOPPED_REASON} from Stop LLM Wiki Run and from the closing window.
 * @param isWaitingForEarlierStep - Whether the step had not yet begun its own verify because an earlier step of this window had not settled.
 * @returns `earlier-step-running` for a bound that fired during the wait, `bound` for any other bound, `stopped` for every other reason.
 * @example
 * wikiSkillStepEndOf('bound', true)   // => 'earlier-step-running'
 * wikiSkillStepEndOf('bound', false)  // => 'bound'
 * wikiSkillStepEndOf('stopped', true) // => 'stopped'
 */
export function wikiSkillStepEndOf(
  abortReason: unknown,
  isWaitingForEarlierStep: boolean,
): WikiSkillStepEnd {
  if (abortReason !== WIKI_SKILL_STEP_BOUND_REASON)
    return WIKI_SKILL_STEP_STOPPED_REASON
  return isWaitingForEarlierStep
    ? WIKI_SKILL_STEP_EARLIER_RUNNING_END
    : WIKI_SKILL_STEP_BOUND_REASON
}

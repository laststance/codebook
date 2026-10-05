import {
  ATTRIBUTE_ENTIRE_VALUE_HINT,
  ATTRIBUTE_VALUE_BEFORE_INPUT_HINT,
  CLICK_TARGET_MISSING_HINT,
  CLICK_TARGET_MISSING_REMEDY_HINT,
  TEXT_BESIDE_OTHER_TEXT_AFTER_HINT,
  TEXT_BESIDE_OTHER_TEXT_BEFORE_HINT,
  TEXT_CONDITION_RULE_HINT,
} from '../constants'
import type {
  ConfiguredDomFailure,
  RepositoryCondition,
} from '../repositoryConfigSchemas'

type ConditionPhase = 'before' | 'after'
/** The relation a text mismatch may report to the declared literal, never page text. */
type TextDifference = Extract<
  ConfiguredDomFailure,
  { reason: 'text-mismatch' }
>['textDifference']

/**
 * Tells the editor agent how to correct a declared DOM condition that timed out, called by {@link ConfiguredBrowserRun} when it composes the timeout text of before and after conditions.
 * The agent cannot see the page, so the hint names the comparison rule and the fix instead of any page value.
 * @param phase - Whether the condition guards the input (`before`) or proves the result (`after`).
 * @param condition - The declared condition that failed; `undefined` when the click target itself failed.
 * @param failure - The failure the page reported for that condition.
 * @returns
 * - `text-mismatch` of a selector that matched several elements: the text rule, then how many matched, that none reads the expected text, the rule that one of them must, and what to correct
 * - `text-mismatch`: the text rule, followed for `surrounding-text` by the fix that fits the phase
 * - `attribute-mismatch` on a declared attribute condition: the before-input sentence for a before `value`, the entire-value sentence otherwise
 * - `click-target-missing`: that the action selector matched nothing, how many controls the page holds when the page reported it, and what to read
 * - Every other failure: `''`
 * @example
 * configuredConditionHint('before', { kind: 'text', selector: 'button', equals: 'Log in' }, { reason: 'text-mismatch' })
 * // => " A text condition compares the element's whole textContent, trimmed and with whitespace runs collapsed; …"
 * configuredConditionHint('before', { kind: 'visible', selector: 'h1' }, { reason: 'not-visible' }) // => ''
 */
export function configuredConditionHint(
  phase: ConditionPhase,
  condition: RepositoryCondition | undefined,
  failure: ConfiguredDomFailure,
): string {
  if (failure.reason === 'text-mismatch')
    return failure.matchedElements === undefined
      ? textConditionHint(phase, failure.textDifference)
      : TEXT_CONDITION_RULE_HINT +
          severalElementsTextHint(failure.matchedElements)
  if (failure.reason === 'attribute-mismatch')
    return attributeConditionHint(phase, condition)
  if (failure.reason === 'click-target-missing')
    return clickTargetMissingHint(failure.candidates)
  return ''
}

/** A before condition may fall back to visibility; an after condition is the result proof and keeps its text. */
const TEXT_BESIDE_OTHER_TEXT_HINT_BY_PHASE: Record<ConditionPhase, string> = {
  before: TEXT_BESIDE_OTHER_TEXT_BEFORE_HINT,
  after: TEXT_BESIDE_OTHER_TEXT_AFTER_HINT,
}
/** A `value` attribute cannot hold before `initialInputs` are inserted; after the input it is compared like every other attribute. */
const VALUE_ATTRIBUTE_HINT_BY_PHASE: Record<ConditionPhase, string> = {
  before: ATTRIBUTE_VALUE_BEFORE_INPUT_HINT,
  after: ATTRIBUTE_ENTIRE_VALUE_HINT,
}

/** Adds the phase's fix only when the element holds the expected text beside other text. */
function textConditionHint(
  phase: ConditionPhase,
  textDifference: TextDifference,
): string {
  if (textDifference !== 'surrounding-text') return TEXT_CONDITION_RULE_HINT
  return TEXT_CONDITION_RULE_HINT + TEXT_BESIDE_OTHER_TEXT_HINT_BY_PHASE[phase]
}

/**
 * Says that a text condition's selector matched several elements and none of them reads the expected text, with the count, for {@link configuredConditionHint}; the agent cannot see the page, so the sentence gives the rule and the fix instead of any page text.
 * @param matchedElements - How many elements the selector matched (two or more).
 * @returns One sentence that begins with a space, as every hint does.
 * @example
 * severalElementsTextHint(3)
 * // => ' Here the selector matched 3 elements and none of them reads the expected text; a text condition holds when one of them does, so correct the expected text or choose a selector that matches the element that shows it.'
 */
function severalElementsTextHint(matchedElements: number): string {
  return ` Here the selector matched ${matchedElements} elements and none of them reads the expected text; a text condition holds when one of them does, so correct the expected text or choose a selector that matches the element that shows it.`
}

/** Picks the attribute sentence; a mismatch reported for a condition that is not an attribute condition gets none. */
function attributeConditionHint(
  phase: ConditionPhase,
  condition: RepositoryCondition | undefined,
): string {
  if (condition?.kind !== 'attribute') return ''
  return condition.attribute === 'value'
    ? VALUE_ATTRIBUTE_HINT_BY_PHASE[phase]
    : ATTRIBUTE_ENTIRE_VALUE_HINT
}

/** Says that the action selector matched nothing and, when the page counted them, how many controls it holds, so the agent can tell a wrong selector from a wrong page. */
function clickTargetMissingHint(
  candidates: Extract<
    ConfiguredDomFailure,
    { reason: 'click-target-missing' }
  >['candidates'],
): string {
  const counts = candidates
    ? ` The page holds ${candidates.button} button, ${candidates.link} link and ${candidates.field} form field elements.`
    : ''
  return CLICK_TARGET_MISSING_HINT + counts + CLICK_TARGET_MISSING_REMEDY_HINT
}

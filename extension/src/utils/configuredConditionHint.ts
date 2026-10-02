import {
  ATTRIBUTE_ENTIRE_VALUE_HINT,
  ATTRIBUTE_VALUE_BEFORE_INPUT_HINT,
  TEXT_BESIDE_OTHER_TEXT_AFTER_HINT,
  TEXT_BESIDE_OTHER_TEXT_BEFORE_HINT,
  TEXT_CONDITION_RULE_HINT,
} from '../constants'
import type { RepositoryCondition } from '../repositoryConfigSchemas'

type ConditionPhase = 'before' | 'after'
/** What the owned page reported for the condition that never held; `textDifference` is a relation to the declared literal, never page text. */
interface TimedOutConditionFailure {
  reason: string
  textDifference?: 'surrounding-text'
}

/**
 * Tells the editor agent how to correct a declared DOM condition that timed out, called by {@link ConfiguredBrowserRun} when it composes the timeout text of before and after conditions.
 * The agent cannot see the page, so the hint names the comparison rule and the fix instead of any page value.
 * @param phase - Whether the condition guards the input (`before`) or proves the result (`after`).
 * @param condition - The declared condition that failed; `undefined` when the click target itself failed.
 * @param failure - The failure the page reported for that condition.
 * @returns
 * - `text-mismatch`: the text rule, followed for `surrounding-text` by the fix that fits the phase
 * - `attribute-mismatch` on a declared attribute condition: the before-input sentence for a before `value`, the entire-value sentence otherwise
 * - Every other failure: `''`
 * @example
 * configuredConditionHint('before', { kind: 'text', selector: 'button', equals: 'Log in' }, { reason: 'text-mismatch' })
 * // => " A text condition compares the element's whole text, child elements included, with whitespace collapsed."
 * configuredConditionHint('before', { kind: 'visible', selector: 'h1' }, { reason: 'not-visible' }) // => ''
 */
export function configuredConditionHint(
  phase: ConditionPhase,
  condition: RepositoryCondition | undefined,
  failure: TimedOutConditionFailure,
): string {
  if (failure.reason === 'text-mismatch')
    return textConditionHint(phase, failure.textDifference)
  if (failure.reason === 'attribute-mismatch')
    return attributeConditionHint(phase, condition)
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
  textDifference: TimedOutConditionFailure['textDifference'],
): string {
  if (textDifference !== 'surrounding-text') return TEXT_CONDITION_RULE_HINT
  return TEXT_CONDITION_RULE_HINT + TEXT_BESIDE_OTHER_TEXT_HINT_BY_PHASE[phase]
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

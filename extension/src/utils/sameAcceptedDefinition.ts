import type { ConfiguredDefinition } from '../configuredStudySchemas'

import { canonicalDefinition } from './canonicalDefinition'

/**
 * Tells whether a runtime acquired the definition the service accepted, ignoring how it shows prepared texts.
 *
 * Why it exists: a run serves its definition with prepared texts redacted ({@link ConfiguredBrowserRun}), so a strict comparison would reject every run that declares `initialInputs`. Called by the study service right after it acquires a runtime.
 * @param acquired - The definition the runtime reports.
 * @param accepted - The definition the service accepted.
 * @returns `true` when both are the same once every prepared text is masked in both.
 * @example
 * sameAcceptedDefinition(runtime.view().definition, record.definition) // => true
 */
export function sameAcceptedDefinition(
  acquired: ConfiguredDefinition,
  accepted: ConfiguredDefinition,
): boolean {
  const neutral = (definition: ConfiguredDefinition) => ({
    ...definition,
    ...canonicalDefinition(definition),
  })
  return JSON.stringify(neutral(acquired)) === JSON.stringify(neutral(accepted))
}

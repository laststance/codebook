import type { NextSetupDeadlineVariant } from '../nextRefusals'

import type { RefusalFailureCode } from './refusalFailureOf'

/**
 * Writes a run's coded failure text, the form {@link refusalFailureOf} restores: `<CODE>: <message>`, or `<CODE>(<variant>): <message>` for a `NEXT_SETUP_DEADLINE` whose variant chooses its static recovery.
 *
 * Why it exists: a failure raised by a timer or an event has no thrown error to carry its code, so the run records this text and the service restores the code, the message and the recovery from it. Called by the configured browser run for a Pages setup deadline and for a sealed module replaced during a run.
 * @param code - The refusal code the text leads with.
 * @param message - The failure's sentence, which carries the dynamic values (paths, the step, the budget); the service sanitizes it.
 * @param variant - The deadline's variant, from {@link nextSetupDeadlineVariantOf}.
 * @returns The failure text.
 * @example
 * formatRefusalFailure('NEXT_SETUP_DEADLINE', 'Repository setup deadline (90 s) exceeded while loading the entry page. …', 'browser-opened')
 * // => 'NEXT_SETUP_DEADLINE(browser-opened): Repository setup deadline (90 s) exceeded while loading the entry page. …'
 * formatRefusalFailure('SOURCE_CHANGED', 'src/pages/index.tsx changed during the run, so Codebook stopped it.')
 * // => 'SOURCE_CHANGED: src/pages/index.tsx changed during the run, so Codebook stopped it.'
 */
export function formatRefusalFailure(
  code: 'NEXT_SETUP_DEADLINE',
  message: string,
  variant: NextSetupDeadlineVariant,
): string
export function formatRefusalFailure(
  code: RefusalFailureCode,
  message: string,
): string
export function formatRefusalFailure(
  code: RefusalFailureCode,
  message: string,
  variant?: NextSetupDeadlineVariant,
): string {
  return variant === undefined
    ? `${code}: ${message}`
    : `${code}(${variant}): ${message}`
}

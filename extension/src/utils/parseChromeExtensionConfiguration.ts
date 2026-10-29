import {
  chromeExtensionConfigSchema,
  type ChromeExtensionConfiguration,
} from '../chromeExtensionConfigSchemas'
import { StudyError } from '../errors'

import { describeChromeExtensionConfigurationIssues } from './describeChromeExtensionConfigurationIssues'

/**
 * Parses a raw chrome-extension declaration and refuses it with the right code: `SEED_INVALID` when any issue lies in the seed, otherwise `INVALID_CONFIGURATION`.
 * Called by the chrome-extension start before {@link resolveChromeExtensionRun}.
 * @param raw - The declaration as the agent sent it.
 * @returns The parsed configuration with defaults applied.
 * @throws `StudyError` `SEED_INVALID` or `INVALID_CONFIGURATION` whose message words every violation.
 * @example
 * parseChromeExtensionConfiguration({ ...declaration, inspections: [] }) // throws INVALID_CONFIGURATION
 */
export function parseChromeExtensionConfiguration(
  raw: unknown,
): ChromeExtensionConfiguration {
  const result = chromeExtensionConfigSchema.safeParse(raw)
  if (result.success) return result.data
  // Every issue is worded so one answer lets the agent fix them all; a seed issue keeps the SEED_INVALID code.
  const hasSeedIssue = result.error.issues.some(
    (issue) => issue.path[0] === 'seed',
  )
  throw new StudyError(
    hasSeedIssue ? 'SEED_INVALID' : 'INVALID_CONFIGURATION',
    describeChromeExtensionConfigurationIssues(result.error.issues),
  )
}

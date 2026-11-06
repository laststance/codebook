import {
  chromeExtensionConfigSchema,
  type ChromeExtensionConfiguration,
} from '../chromeExtensionConfigSchemas'
import { StudyError } from '../errors'

import { WXT_STOP_OUTSIDE_PROJECT_REASON } from './addWxtStopPathIssues'
import { describeChromeExtensionConfigurationIssues } from './describeChromeExtensionConfigurationIssues'

/**
 * Parses a raw chrome-extension declaration and refuses it with the right code: `SEED_INVALID` when any issue lies in the seed, `EXTENSION_BUILD_UNSUPPORTED` (`stop-outside-project`) when a `wxt-build` stop lies in `node_modules`, otherwise `INVALID_CONFIGURATION`.
 * Called by the chrome-extension start before {@link resolveChromeExtensionRun}.
 * @param raw - The declaration as the agent sent it.
 * @returns The parsed configuration with defaults applied.
 * @throws `StudyError` `SEED_INVALID`, `EXTENSION_BUILD_UNSUPPORTED` or `INVALID_CONFIGURATION` whose message words every violation.
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
  const message = describeChromeExtensionConfigurationIssues(
    result.error.issues,
  )
  if (hasSeedIssue) throw new StudyError('SEED_INVALID', message)
  // A stop in node_modules is the build adapter's own refusal, with its reason for the agent.
  const hasStopOutsideProject = result.error.issues.some(
    (issue) =>
      issue.code === 'custom' &&
      issue.params?.reason === WXT_STOP_OUTSIDE_PROJECT_REASON,
  )
  if (hasStopOutsideProject)
    throw new StudyError(
      'EXTENSION_BUILD_UNSUPPORTED',
      message,
      message,
      undefined,
      undefined,
      { reason: WXT_STOP_OUTSIDE_PROJECT_REASON },
    )
  throw new StudyError('INVALID_CONFIGURATION', message)
}

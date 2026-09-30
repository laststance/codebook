import { StudyError } from '../errors'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'

/**
 * Returns the cited test's title path, refusing a new Node test run that names its test with the retired `testName` or not at all.
 *
 * A raw `testName` was passed to Vitest as an unanchored regular expression, so it could run a different or additional test.
 * Saved histories still carry it, which is why the schema keeps the field. Called by {@link prepareNodeTestStudy} before a history
 * exists and by {@link prepareNodeTestLaunch} before any Vitest process starts.
 *
 * @param configuration - The validated node-test configuration of a new run.
 * @returns The enclosing `describe` titles followed by the test title.
 * @throws {@link StudyError} `INVALID_CONFIGURATION` when `testName` is present or `testTitles` is missing.
 * @example
 * ```ts
 * requireNodeTestTitles({ ...configuration, testTitles: ['invoice data queries', 'returns undefined'] }) // => ['invoice data queries', 'returns undefined']
 * ```
 */
export function requireNodeTestTitles(
  configuration: NodeTestConfiguration,
): string[] {
  if (configuration.testName !== undefined)
    throw new StudyError(
      'INVALID_CONFIGURATION',
      'testName is retired for new Node test runs: cite the test with testTitles (every enclosing describe title, then the test title). See codebook://help/node-test.',
    )
  if (!configuration.testTitles)
    throw new StudyError(
      'INVALID_CONFIGURATION',
      'A Node test run needs testTitles naming exactly one test: every enclosing describe title, then the test title. See codebook://help/node-test.',
    )
  return configuration.testTitles
}

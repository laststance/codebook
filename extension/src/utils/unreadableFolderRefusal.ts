import { StudyError } from '../errors'

import { repositoryPosixPath } from './repositoryPosixPath'
import { systemErrorCode } from './systemErrorCode'

/**
 * Words the refusal of a node-test start whose Vitest config or Vitest could not be looked for, because a folder on the way refused to be read; called by {@link readVitestConfigEntries} and {@link requireOwnedVitest} when `lstat` fails with anything but a missing entry.
 * @param root - The repository's real root.
 * @param path - The entry whose `lstat` failed.
 * @param testFile - The cited test file's real path.
 * @param error - The file system's error, whose code the sentence names.
 * @returns A `PREREQUISITE_MISSING` {@link StudyError} naming the root-relative path, the test file and the error code.
 * @example
 * unreadableFolderRefusal('/repo', '/repo/packages/a/node_modules/vitest', '/repo/packages/a/src/a.test.ts', eaccesError).message
 * // => 'node-test cannot read packages/a/node_modules/vitest for packages/a/src/a.test.ts (EACCES). Ask the learner to make that folder readable, then start the test again.'
 */
export function unreadableFolderRefusal(
  root: string,
  path: string,
  testFile: string,
  error: unknown,
): StudyError {
  const code = systemErrorCode(error) || 'unreadable'
  return new StudyError(
    'PREREQUISITE_MISSING',
    `node-test cannot read ${repositoryPosixPath(root, path)} for ${repositoryPosixPath(root, testFile)} (${code}). Ask the learner to make that folder readable, then start the test again.`,
    String(error),
  )
}

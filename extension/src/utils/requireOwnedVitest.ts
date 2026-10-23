import { VITEST_PROGRAM_PATH } from '../constants'
import { StudyError } from '../errors'

import { readVitestPrerequisite } from './readVitestPrerequisite'
import { resolveOwnedRepositoryFile } from './resolveOwnedRepositoryFile'

/** The repository's root Vitest as a test run launches it. */
export type OwnedVitest = {
  /** The Vitest major version, which words the title separator of the name filter. */
  major: number
  /** The real path of `node_modules/vitest/vitest.mjs` inside the opened repository. */
  program: string
}

/**
 * Requires the root Vitest a node-test run launches: a supported version and its program file inside the opened repository.
 * Called by {@link prepareNodeTestLaunch} right before Vitest is asked anything, and by the study environment's file check during the run's preparation, so a repository without the program refuses the start before its history begins and leaves no zero-entry history behind.
 * @param root - The opened repository's real root.
 * @returns The Vitest major version and the real path of its program.
 * @throws A `PREREQUISITE_MISSING` {@link StudyError} with the sentence of {@link readVitestPrerequisite} for a missing or older Vitest, or naming the missing program file.
 * @example
 * await requireOwnedVitest('/repo') // => { major: 5, program: '/repo/node_modules/vitest/vitest.mjs' }
 */
export async function requireOwnedVitest(root: string): Promise<OwnedVitest> {
  // Older Vitest lacks the verified file listing, exclusion and report behavior this exact selection relies on.
  const vitest = await readVitestPrerequisite(root)
  if (!vitest.ready) throw new StudyError('PREREQUISITE_MISSING', vitest.reason)
  const program = await resolveOwnedRepositoryFile(root, VITEST_PROGRAM_PATH)
  if (!program)
    throw new StudyError(
      'PREREQUISITE_MISSING',
      `node-test needs the root Vitest program ${VITEST_PROGRAM_PATH} inside the opened repository; reinstall Vitest at the repository root, then call codebook_status again.`,
    )
  return { major: vitest.major, program }
}

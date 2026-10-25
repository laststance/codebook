import { lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  NODE_TEST_MINIMUM_VITEST_MAJOR,
  VITEST_PACKAGE_DIRECTORY,
} from '../constants'
import { StudyError } from '../errors'

import { isMissingEntryError } from './isMissingEntryError'
import { readVitestPrerequisite } from './readVitestPrerequisite'
import { repositoryPosixPath } from './repositoryPosixPath'
import { unreadableFolderRefusal } from './unreadableFolderRefusal'

/** The Vitest a node-test run launches for one cited test: the one Node resolves from its Vitest root. */
export type OwnedVitest = {
  /** The Vitest major version, which words the title separator of the name filter. */
  major: number
  /** The printable version, compared again right before the launch. */
  version: string
  /** The real path of its `vitest.mjs` inside the opened repository. */
  program: string
  /** The real path of its package folder, compared again right before the launch. */
  packageDirectory: string
  /** The real directory whose `node_modules/vitest` it is: the Vitest root or the nearest ancestor that has one. */
  directory: string
}

/**
 * Finds the directory whose `node_modules/vitest` Node resolves from a Vitest root: the root itself or the nearest ancestor inside the repository that has one, as any entry (a folder, a link, or one whose package file is broken); the walk never goes past the first one found.
 * @param root - The repository's real root.
 * @param vitestRoot - The real Vitest root, the root or a folder inside it.
 * @param testFile - The cited test's real path, which an unreadable folder's refusal names.
 * @returns The directory, or `undefined` when no directory up to the root has one.
 * @throws The {@link unreadableFolderRefusal} of a folder whose entry cannot be read; an error when the walk reaches the file system's root without meeting the repository's root.
 * @example await findVitestDirectory('/repo', '/repo/packages/toolkit', '/repo/packages/toolkit/src/a.test.ts') // => '/repo' (a hoisted Vitest)
 */
async function findVitestDirectory(
  root: string,
  vitestRoot: string,
  testFile: string,
): Promise<string | undefined> {
  let directory = vitestRoot
  for (;;) {
    const entry = join(directory, VITEST_PACKAGE_DIRECTORY)
    const found = await lstat(entry).then(
      () => true,
      (error: unknown) => {
        if (isMissingEntryError(error)) return false
        throw unreadableFolderRefusal(root, entry, testFile, error)
      },
    )
    if (found) return directory
    if (directory === root) return undefined
    const parent = dirname(directory)
    // Defensive: every caller passes a folder inside the canonical root, so the walk meets the root before the file system's.
    if (parent === directory)
      throw new Error(
        'node-test looked for Vitest above a folder outside the opened repository.',
      )
    directory = parent
  }
}

/**
 * Requires the Vitest a node-test run launches for the cited test: the one Node resolves from the test's Vitest root, inside the repository, version 4 or later, with its program. Called by the execution plan before the run's history begins ({@link planNodeTestExecution}) and again by {@link prepareNodeTestLaunch} right before Vitest is asked anything, so a missing, older, unreadable, outside or incomplete Vitest refuses the start before its history exists.
 * @param root - The opened repository's real root.
 * @param vitestRoot - The real Vitest root of the cited test.
 * @param testFile - The cited test's real path, named in each refusal.
 * @returns The Vitest's major and printable version, its program, its package folder and the directory that holds it.
 * @throws A `PREREQUISITE_MISSING` {@link StudyError} whose sentence names the test file, the folder and the fix, ending "then start the test again": no Vitest up to the root, a version below 4, an unreadable version, a link that leaves the repository, or a missing `vitest.mjs`; the {@link unreadableFolderRefusal} of a folder that cannot be read.
 * @example
 * await requireOwnedVitest('/repo', '/repo/packages/query-core', '/repo/packages/query-core/src/query.test.ts')
 * // => { major: 5, version: '5.0.5', program: '/repo/node_modules/vitest/vitest.mjs', packageDirectory: '/repo/node_modules/vitest', directory: '/repo' }
 */
export async function requireOwnedVitest(
  root: string,
  vitestRoot: string,
  testFile: string,
): Promise<OwnedVitest> {
  const testPath = repositoryPosixPath(root, testFile)
  const directory = await findVitestDirectory(root, vitestRoot, testFile)
  if (!directory)
    throw new StudyError(
      'PREREQUISITE_MISSING',
      `node-test needs Vitest ${NODE_TEST_MINIMUM_VITEST_MAJOR} or later for ${testPath}; none was found in ${repositoryPosixPath(root, vitestRoot)}/node_modules/vitest or above it inside the repository. Ask the learner to install Vitest in that package or at the repository root, then start the test again.`,
    )
  const installation = await readVitestPrerequisite(root, directory)
  const at = repositoryPosixPath(root, directory)
  // Older Vitest lacks the verified file listing, exclusion and report behavior this exact selection relies on.
  switch (installation.state) {
    case 'usable':
      return {
        major: installation.major,
        version: installation.version,
        program: installation.program,
        packageDirectory: installation.packageDirectory,
        directory,
      }
    case 'too-old':
      throw new StudyError(
        'PREREQUISITE_MISSING',
        `node-test needs Vitest ${NODE_TEST_MINIMUM_VITEST_MAJOR} or later for ${testPath}; ${at}/node_modules/vitest is ${installation.version}. Ask the learner to upgrade it, then start the test again.`,
      )
    case 'unreadable-version':
      throw new StudyError(
        'PREREQUISITE_MISSING',
        `node-test cannot read the version of ${at}/node_modules/vitest for ${testPath}: its package.json is missing, unreadable or not a Vitest package file. Ask the learner to reinstall the dependencies, then start the test again.`,
      )
    case 'program-missing':
      throw new StudyError(
        'PREREQUISITE_MISSING',
        `node-test needs the Vitest program ${at}/node_modules/vitest/vitest.mjs for ${testPath}; reinstall Vitest there, then start the test again.`,
      )
    case 'links-outside':
      throw new StudyError(
        'PREREQUISITE_MISSING',
        `node-test needs Vitest ${NODE_TEST_MINIMUM_VITEST_MAJOR} or later inside the repository for ${testPath}; ${at}/node_modules/vitest links outside it (for example to a package store outside the repository), which Codebook does not run. Ask the learner to install the dependencies so that Vitest lies inside the repository, then start the test again.`,
      )
  }
}

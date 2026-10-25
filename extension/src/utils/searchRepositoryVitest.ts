import { lstat, readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import {
  NODE_MODULES_DIRECTORY_NAME,
  NODE_TEST_MINIMUM_VITEST_MAJOR,
  NODE_TEST_READINESS_DEPTH,
  NODE_TEST_READINESS_DIRECTORY_LIMIT,
  VITEST_PACKAGE_DIRECTORY,
} from '../constants'

import {
  readVitestPrerequisite,
  type VitestInstallation,
} from './readVitestPrerequisite'
import { repositoryPosixPath } from './repositoryPosixPath'

/** What `codebook_status`'s readiness search found, as `profiles['node-test'].vitestSearch` names it. */
export type NodeTestVitestSearch = 'usable' | 'none' | 'unusable' | 'incomplete'
/** The readiness search's answer: `usable`, or the state and the sentence `missing` holds in its place. */
export type RepositoryVitestSearch =
  | { vitestSearch: 'usable' }
  | { vitestSearch: Exclude<NodeTestVitestSearch, 'usable'>; missing: string }

const DEEPER_PACKAGE_NOTE =
  "A test in a deeper package can still start: the start checks that test's own package."

/**
 * Lists the folders one level below a folder that the readiness search enters: no `node_modules`, no name that starts with `.`, no link and nothing that cannot be read, so the search never follows a link or loops.
 * @param root - The repository's real root.
 * @param directory - A root-relative POSIX path, `.` for the root.
 * @returns The child folders as root-relative POSIX paths, in no particular order.
 * @example await childFolders('/repo', '.') // => ['packages', 'src']
 */
async function childFolders(
  root: string,
  directory: string,
): Promise<string[]> {
  const entries = await readdir(join(root, directory), {
    withFileTypes: true,
  }).catch(() => [])
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== NODE_MODULES_DIRECTORY_NAME &&
        !entry.name.startsWith('.'),
    )
    .map((entry) =>
      directory === '.' ? entry.name : `${directory}/${entry.name}`,
    )
}

/**
 * Words the state of the first Vitest found when none is usable, in the `missing` sentence's place for it.
 * @param installation - The first found installation's state.
 * @returns The words after "<path>/node_modules/vitest,".
 * @example unusableWords({ state: 'too-old', version: '3.2.4' }) // => 'is 3.2.4'
 */
function unusableWords(
  installation: Exclude<VitestInstallation, { state: 'usable' }>,
): string {
  switch (installation.state) {
    case 'too-old':
      return `is ${installation.version}`
    case 'unreadable-version':
      return 'is an unreadable version'
    case 'links-outside':
      return 'links outside the repository'
    case 'program-missing':
      return 'is missing its program vitest.mjs'
  }
}

/**
 * Looks for a usable Vitest (4 or later, inside the repository, with its program) in `node_modules/vitest` at the repository root and in the folders one and two levels below it, for `codebook_status`'s node-test readiness; a start does not wait on it, since the start checks the cited test's own Vitest.
 * The search looks at most at {@link NODE_TEST_READINESS_DIRECTORY_LIMIT} folders, the root first, then breadth first, each level in the code-unit order of its root-relative POSIX paths, and is ready as soon as one candidate is usable. Called by the study environment's prerequisites.
 * @param workspace - The opened repository's root.
 * @returns
 * - `usable` once one candidate is usable.
 * - `incomplete` when the limit ended the search first, with a sentence that asks for no install.
 * - `unusable` naming the first Vitest found and its state, when one was found but none is usable.
 * - `none` when no folder it looked at has one.
 * @example
 * await searchRepositoryVitest('/repo') // => { vitestSearch: 'usable' } for /repo/packages/toolkit/node_modules/vitest 5.0.0
 * await searchRepositoryVitest('/old')  // => { vitestSearch: 'unusable', missing: 'node-test needs Vitest 4 or later at the repository root or in a package one or two levels below it; the first one found, ./node_modules/vitest, is 3.2.4. …' }
 */
export async function searchRepositoryVitest(
  workspace: string,
): Promise<RepositoryVitestSearch> {
  const root = await realpath(workspace)
  let firstFound:
    | {
        path: string
        installation: Exclude<VitestInstallation, { state: 'usable' }>
      }
    | undefined
  let looked = 0
  let level = ['.']
  for (let depth = 0; depth <= NODE_TEST_READINESS_DEPTH; depth++) {
    for (const directory of level) {
      // A folder past the limit stays unvisited; the sentence says the search did not look further.
      if (looked === NODE_TEST_READINESS_DIRECTORY_LIMIT)
        return {
          vitestSearch: 'incomplete',
          missing: `node-test found no usable Vitest in the first ${NODE_TEST_READINESS_DIRECTORY_LIMIT} folders it looked at (the repository root and up to two levels below it) and did not look further. A start still checks the cited test's own package.`,
        }
      looked++
      const absolute = join(root, directory)
      const found = await lstat(join(absolute, VITEST_PACKAGE_DIRECTORY)).then(
        () => true,
        () => false,
      )
      if (!found) continue
      const installation = await readVitestPrerequisite(root, absolute)
      if (installation.state === 'usable') return { vitestSearch: 'usable' }
      firstFound ??= {
        path: repositoryPosixPath(root, absolute),
        installation,
      }
    }
    if (depth === NODE_TEST_READINESS_DEPTH) break
    // JavaScript's default string sort is the code-unit order the search promises, not a locale order.
    level = (
      await Promise.all(level.map((directory) => childFolders(root, directory)))
    )
      .flat()
      .sort()
  }
  if (firstFound)
    return {
      vitestSearch: 'unusable',
      missing: `node-test needs Vitest ${NODE_TEST_MINIMUM_VITEST_MAJOR} or later at the repository root or in a package one or two levels below it; the first one found, ${firstFound.path}/node_modules/vitest, ${unusableWords(firstFound.installation)}. Ask the learner to install or upgrade it, then call codebook_status again. ${DEEPER_PACKAGE_NOTE}`,
    }
  return {
    vitestSearch: 'none',
    missing: `node-test needs Vitest ${NODE_TEST_MINIMUM_VITEST_MAJOR} or later at the repository root or in a package one or two levels below it; none was found. Ask the learner to install Vitest, then call codebook_status again. ${DEEPER_PACKAGE_NOTE}`,
  }
}

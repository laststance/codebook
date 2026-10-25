import type { Dirent } from 'node:fs'
import { lstat, opendir, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import {
  NODE_MODULES_DIRECTORY_NAME,
  NODE_TEST_MINIMUM_VITEST_MAJOR,
  NODE_TEST_READINESS_DEPTH,
  NODE_TEST_READINESS_DIRECTORY_LIMIT,
  NODE_TEST_READINESS_ENTRY_LIMIT,
  NODE_TEST_READINESS_TIMEOUT_MS,
  VITEST_PACKAGE_DIRECTORY,
} from '../constants'

import { isMissingEntryError } from './isMissingEntryError'
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

/** What one readiness search may still spend and what it met: the entries it may still read, the time it may look until on its clock, and whether a folder could not be read. */
type SearchBudget = {
  entriesLeft: number
  deadlineAt: number
  now: () => number
  unreadable: boolean
}

/** Whether the search has spent its time; checked between folders and entries. @example isPastDeadline({ deadlineAt: 2_000, now: () => 2_500, ... }) // => true */
const isPastDeadline = (budget: SearchBudget): boolean =>
  budget.now() >= budget.deadlineAt

/** Whether a folder entry is one the readiness search enters: a folder, not `node_modules`, not a name that starts with `.`, and not a link, so the search never follows a link or loops. */
const isSearchedFolder = (entry: Dirent): boolean =>
  entry.isDirectory() &&
  entry.name !== NODE_MODULES_DIRECTORY_NAME &&
  !entry.name.startsWith('.')

/**
 * Reads one folder's entries as a stream and hands each child folder the search enters to `found`, counting every entry read against the search's entry limit and stopping at its time limit; called by {@link nextLevelFolders} for each folder of a level.
 * @param root - The repository's real root.
 * @param directory - A root-relative POSIX path, `.` for the root.
 * @param reading - What the search may still spend, lowered as entries are read; a folder that cannot be read marks it `unreadable`.
 * @param found - Takes one child folder's root-relative POSIX path; `false` asks to stop reading.
 * @returns `stopped` when the entry limit, the time limit or `found` ended the reading; `read` once the folder was read to its end or could not be read.
 * @example await streamChildFolders('/repo', '.', budget, (path) => true) // => 'read', after found('apps') and found('packages')
 */
async function streamChildFolders(
  root: string,
  directory: string,
  reading: SearchBudget,
  found: (path: string) => boolean,
): Promise<'read' | 'stopped'> {
  try {
    for await (const entry of await opendir(join(root, directory))) {
      if (reading.entriesLeft === 0 || isPastDeadline(reading)) return 'stopped'
      reading.entriesLeft--
      if (!isSearchedFolder(entry)) continue
      if (!found(directory === '.' ? entry.name : `${directory}/${entry.name}`))
        return 'stopped'
    }
  } catch {
    // A folder that cannot be opened or read to its end is passed over, and the search then cannot say that none of its folders holds a Vitest.
    reading.unreadable = true
  }
  return 'read'
}

/**
 * Lists the next level's folders the readiness search enters, the first `keep` of them in code-unit order.
 * It reads one folder at a time as a stream ({@link streamChildFolders}), holds no more than about twice `keep` paths, and stops at {@link NODE_TEST_READINESS_ENTRY_LIMIT} entries read, so a folder holding many entries costs neither memory nor a long status call.
 * Called by {@link searchRepositoryVitest} between two levels, with the folders it may still look at as `keep`.
 * @param root - The repository's real root.
 * @param level - The current level's folders, root-relative POSIX paths (`.` for the root).
 * @param keep - How many folders the search may still look at.
 * @param reading - What the search may still spend, lowered as entries are read.
 * @returns The first `keep` child folders as root-relative POSIX paths, sorted; `truncated` when a folder beyond them exists or a limit ended the reading, so the search did not look at every folder.
 * @example await nextLevelFolders('/repo', ['.'], 255, budget) // => { folders: ['apps', 'packages'], truncated: false }
 */
async function nextLevelFolders(
  root: string,
  level: string[],
  keep: number,
  reading: SearchBudget,
): Promise<{ folders: string[]; truncated: boolean }> {
  let folders: string[] = []
  let truncated = false
  /** Sorts and keeps the first `keep` folders; a dropped one means the search does not look at every folder. */
  const trim = (): void => {
    // JavaScript's default string sort is the code-unit order the search promises, not a locale order.
    folders.sort()
    if (folders.length > keep) {
      truncated = true
      folders = folders.slice(0, keep)
    }
  }
  const found = (path: string): boolean => {
    // With nothing left to look at, one more folder is enough to know the search ends incomplete.
    if (keep === 0) return false
    folders.push(path)
    if (folders.length >= keep * 2) trim()
    return true
  }
  for (const directory of level)
    if (
      (await streamChildFolders(root, directory, reading, found)) === 'stopped'
    ) {
      truncated = true
      break
    }
  trim()
  return { folders, truncated }
}

/**
 * Looks at one folder's `node_modules/vitest` for the readiness search; called by {@link searchRepositoryVitest} for every folder it looks at.
 * @param root - The repository's real root.
 * @param absolute - The folder's absolute path.
 * @returns
 * - `undefined` when the folder has no `node_modules/vitest`.
 * - `unreadable-version` when the entry exists but cannot be looked at (its `node_modules` denies the search, for example).
 * - Otherwise what {@link readVitestPrerequisite} reads there.
 * @example await installationIn('/repo', '/repo/packages/a') // => { state: 'too-old', version: '3.2.4' }
 */
async function installationIn(
  root: string,
  absolute: string,
): Promise<VitestInstallation | undefined> {
  const entry = await lstat(join(absolute, VITEST_PACKAGE_DIRECTORY)).then(
    () => 'present' as const,
    (error: unknown) =>
      isMissingEntryError(error) ? undefined : ('unreadable' as const),
  )
  if (entry === 'unreadable') return { state: 'unreadable-version' }
  return entry && readVitestPrerequisite(root, absolute)
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
 * Words the readiness search's answer when no candidate was usable: `incomplete` when a limit ended it or a folder could not be read, so it asks for no install; else `unusable` naming the first Vitest found; else `none`.
 * Called by {@link searchRepositoryVitest} once its levels are looked at.
 * @param ending - How many folders it looked at, whether a limit ended it, whether a folder could not be read, and the first Vitest found.
 * @returns The state and the sentence `missing` holds.
 * @example unfinishedSearchAnswer({ looked: 256, truncated: true, unreadable: false }) // => { vitestSearch: 'incomplete', missing: 'node-test found no usable Vitest in the first 256 folders …' }
 */
function unfinishedSearchAnswer(ending: {
  looked: number
  truncated: boolean
  unreadable: boolean
  firstFound?: {
    path: string
    installation: Exclude<VitestInstallation, { state: 'usable' }>
  }
}): Exclude<RepositoryVitestSearch, { vitestSearch: 'usable' }> {
  if (ending.truncated)
    return {
      vitestSearch: 'incomplete',
      missing: `node-test found no usable Vitest in the first ${ending.looked} folders it looked at (the repository root and up to two levels below it) and did not look further. A start still checks the cited test's own package.`,
    }
  if (ending.unreadable)
    return {
      vitestSearch: 'incomplete',
      missing: `node-test found no usable Vitest in the ${ending.looked} folders it looked at (the repository root and up to two levels below it), but could not read every folder there. A start still checks the cited test's own package.`,
    }
  if (ending.firstFound)
    return {
      vitestSearch: 'unusable',
      missing: `node-test needs Vitest ${NODE_TEST_MINIMUM_VITEST_MAJOR} or later at the repository root or in a package one or two levels below it; the first one found, ${ending.firstFound.path}/node_modules/vitest, ${unusableWords(ending.firstFound.installation)}. Ask the learner to install or upgrade it, then call codebook_status again. ${DEEPER_PACKAGE_NOTE}`,
    }
  return {
    vitestSearch: 'none',
    missing: `node-test needs Vitest ${NODE_TEST_MINIMUM_VITEST_MAJOR} or later at the repository root or in a package one or two levels below it; none was found. Ask the learner to install Vitest, then call codebook_status again. ${DEEPER_PACKAGE_NOTE}`,
  }
}

/**
 * Looks for a usable Vitest (4 or later, inside the repository, with its program) in `node_modules/vitest` at the repository root and in the folders one and two levels below it, for `codebook_status`'s node-test readiness; a start does not wait on it, since the start checks the cited test's own Vitest.
 * The search looks at most at {@link NODE_TEST_READINESS_DIRECTORY_LIMIT} folders, the root first, then breadth first, each level in the code-unit order of its root-relative POSIX paths, reads at most {@link NODE_TEST_READINESS_ENTRY_LIMIT} folder entries to list them, one folder at a time, stops after {@link NODE_TEST_READINESS_TIMEOUT_MS}, and is ready as soon as one candidate is usable. Called by the study environment's prerequisites.
 * @param workspace - The opened repository's root.
 * @param now - The clock the time limit is read on; tests replace it.
 * @returns
 * - `usable` once one candidate is usable.
 * - `incomplete` when a limit ended the search first or a folder could not be read, with a sentence that names how many folders it looked at and asks for no install.
 * - `unusable` naming the first Vitest found and its state, when one was found but none is usable.
 * - `none` when no folder it looked at has one.
 * @example
 * await searchRepositoryVitest('/repo') // => { vitestSearch: 'usable' } for /repo/packages/toolkit/node_modules/vitest 5.0.0
 * await searchRepositoryVitest('/old')  // => { vitestSearch: 'unusable', missing: 'node-test needs Vitest 4 or later at the repository root or in a package one or two levels below it; the first one found, ./node_modules/vitest, is 3.2.4. …' }
 */
export async function searchRepositoryVitest(
  workspace: string,
  now: () => number = Date.now,
): Promise<RepositoryVitestSearch> {
  const root = await realpath(workspace)
  let firstFound: Parameters<typeof unfinishedSearchAnswer>[0]['firstFound']
  let looked = 0
  let level = ['.']
  let truncated = false
  const reading: SearchBudget = {
    entriesLeft: NODE_TEST_READINESS_ENTRY_LIMIT,
    deadlineAt: now() + NODE_TEST_READINESS_TIMEOUT_MS,
    now,
    unreadable: false,
  }
  for (let depth = 0; depth <= NODE_TEST_READINESS_DEPTH; depth++) {
    for (const directory of level) {
      // A search out of time looks at no more folders and says it did not look further.
      if (isPastDeadline(reading)) {
        truncated = true
        break
      }
      looked++
      const absolute = join(root, directory)
      const installation = await installationIn(root, absolute)
      if (installation?.state === 'usable') return { vitestSearch: 'usable' }
      if (installation)
        firstFound ??= {
          path: repositoryPosixPath(root, absolute),
          installation,
        }
    }
    // A level cut short is looked at to its end and no deeper; the sentence says the search did not look further.
    if (truncated || depth === NODE_TEST_READINESS_DEPTH) break
    // The next level holds no more folders than the search may still look at.
    const next = await nextLevelFolders(
      root,
      level,
      NODE_TEST_READINESS_DIRECTORY_LIMIT - looked,
      reading,
    )
    level = next.folders
    truncated = next.truncated
  }
  return unfinishedSearchAnswer({
    looked,
    truncated,
    unreadable: reading.unreadable,
    firstFound,
  })
}

import { lstat, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { VITEST_CONFIG_FILE_NAMES } from '../constants'

import { isInsideFolder } from './isInsideFolder'
import { isMissingEntryError } from './isMissingEntryError'
import { unreadableFolderRefusal } from './unreadableFolderRefusal'

/** The entries of one directory named like a Vitest or Vite config, sorted by what node-test does with them; each list keeps Vitest's own name order. */
export type VitestConfigEntries = {
  /** Regular files, or links to regular files inside the repository: Vitest may load one of them as its config. */
  configFiles: string[]
  /** Folders and links that leave the repository or lead to a folder: a Vitest started in this directory could take one for its config, so it does not start there. */
  refusedEntries: string[]
  /** Links that cannot be resolved (a dangling link, a loop) and other kinds of entry: neither Vitest nor node-test can load them. */
  skippedEntries: string[]
}

/**
 * Sorts one entry named like a config by what it is, following a link only to judge where it leads.
 * @param root - The repository's real root.
 * @param path - The entry's path, inside a real directory of the repository.
 * @param testFile - The cited test's real path, which an unreadable folder's refusal names.
 * @returns `absent`, `config`, `refused` or `skipped`.
 * @throws The {@link unreadableFolderRefusal} when `lstat` fails with anything but a missing entry.
 * @example await classifyEntry('/repo', '/repo/packages/a/vite.config.ts', testFile) // => 'config'
 */
async function classifyEntry(
  root: string,
  path: string,
  testFile: string,
): Promise<'absent' | 'config' | 'refused' | 'skipped'> {
  const entry = await lstat(path).catch((error: unknown) => {
    if (isMissingEntryError(error)) return undefined
    throw unreadableFolderRefusal(root, path, testFile, error)
  })
  if (!entry) return 'absent'
  if (entry.isFile()) return 'config'
  if (entry.isDirectory()) return 'refused'
  if (!entry.isSymbolicLink()) return 'skipped'
  const target = await realpath(path).catch(() => undefined)
  // A link nothing can load is passed over, as Vitest's own config search passes it over.
  if (target === undefined) return 'skipped'
  if (target !== root && !isInsideFolder(root, target)) return 'refused'
  const resolved = await stat(target).catch(() => undefined)
  if (resolved?.isFile()) return 'config'
  return resolved?.isDirectory() ? 'refused' : 'skipped'
}

/**
 * Reads which entries of one directory are named like a Vitest or Vite config ({@link VITEST_CONFIG_FILE_NAMES}) and what each is; called by {@link resolveNodeTestVitestRoot} for every directory of its walk, by {@link planNodeTestExecution} for the opened root of a root claim, and by {@link prepareNodeTestLaunch} to compare the chosen Vitest root again right before the launch.
 * @param root - The repository's real root.
 * @param directory - A real directory inside the root, or the root itself.
 * @param testFile - The cited test's real path, which an unreadable folder's refusal names.
 * @returns The config files, the entries that refuse a Vitest started there, and the entries nothing can load, by name.
 * @throws The {@link unreadableFolderRefusal} of an entry whose `lstat` fails with anything but a missing entry.
 * @example
 * await readVitestConfigEntries('/repo', '/repo/packages/toolkit', testFile)
 * // => { configFiles: ['vitest.config.mts'], refusedEntries: [], skippedEntries: [] }
 */
export async function readVitestConfigEntries(
  root: string,
  directory: string,
  testFile: string,
): Promise<VitestConfigEntries> {
  const results = await Promise.allSettled(
    VITEST_CONFIG_FILE_NAMES.map((name) =>
      classifyEntry(root, join(directory, name), testFile),
    ),
  )
  // The first refusal in Vitest's name order, whichever read failed first, so the sentence names the same entry every time.
  const kinds = results.map((result) => {
    if (result.status === 'rejected') throw result.reason
    return result.value
  })
  const named = (kind: (typeof kinds)[number]) =>
    VITEST_CONFIG_FILE_NAMES.filter((_name, index) => kinds[index] === kind)
  return {
    configFiles: named('config'),
    refusedEntries: named('refused'),
    skippedEntries: named('skipped'),
  }
}

import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { z } from 'zod'

import {
  NODE_TEST_MINIMUM_VITEST_MAJOR,
  PRINTABLE_VITEST_VERSION,
  VITEST_PACKAGE_DIRECTORY,
  VITEST_PACKAGE_JSON_LIMIT_BYTES,
  VITEST_PACKAGE_PATH,
  VITEST_PROGRAM_PATH,
} from '../constants'

import { isInsideFolder } from './isInsideFolder'
import { resolveOwnedRepositoryFile } from './resolveOwnedRepositoryFile'

const vitestPackageSchema = z.object({ version: z.string() })

/** What one Vitest installation, a directory's `node_modules/vitest`, offers node-test: a usable Vitest, or why it is not one. */
export type VitestInstallation =
  | {
      state: 'usable'
      version: string
      major: number
      /** The real path of its `vitest.mjs` inside the opened repository. */
      program: string
      /** The real path of its package folder. */
      packageDirectory: string
    }
  | { state: 'too-old'; version: string }
  | { state: 'unreadable-version' }
  | { state: 'links-outside' }
  | { state: 'program-missing' }

/**
 * Reads the version a Vitest package file names, printing it only as a short semantic version.
 * @param file - The package file's real path.
 * @returns The version, or `undefined` for a file above {@link VITEST_PACKAGE_JSON_LIMIT_BYTES}, one that cannot be read or does not parse, and a version that is no short semantic version.
 * @example await printableVersion('/repo/node_modules/vitest/package.json') // => '4.1.11'
 */
async function printableVersion(file: string): Promise<string | undefined> {
  const entry = await stat(file).catch(() => undefined)
  if (!entry || entry.size > VITEST_PACKAGE_JSON_LIMIT_BYTES) return undefined
  const parsed = vitestPackageSchema.safeParse(
    await readFile(file, 'utf8')
      .then((text): unknown => JSON.parse(text))
      .catch(() => undefined),
  )
  return parsed.success && PRINTABLE_VITEST_VERSION.test(parsed.data.version)
    ? parsed.data.version
    : undefined
}

/**
 * Says whether a path exists and its real path lies outside the repository, so a link into a package store outside it is named as such instead of as missing.
 * @param root - The repository's real root.
 * @param path - The path to resolve.
 * @returns `true` only for a path that resolves outside the root.
 * @example await leavesRepository('/repo', '/repo/node_modules/vitest') // => true for a link into ~/.pnpm-store
 */
async function leavesRepository(root: string, path: string): Promise<boolean> {
  const real = await realpath(path).catch(() => undefined)
  return real !== undefined && real !== root && !isInsideFolder(root, real)
}

/**
 * Tells what the Vitest installed in one directory's `node_modules/vitest` offers node-test; called for the cited test's Vitest by {@link requireOwnedVitest} and for each candidate of `codebook_status`'s readiness search by {@link searchRepositoryVitest}, which word its state into their own sentences.
 * Its files are read through realpath containment ({@link resolveOwnedRepositoryFile}), so a link that leaves the repository is not run and is named as such, and the version is kept only as a short semantic version ({@link PRINTABLE_VITEST_VERSION}), so a package's `version` field cannot carry other text into the agent's answer.
 * @param root - The opened repository's real root.
 * @param directory - The real directory whose `node_modules/vitest` exists, the root or a folder inside it.
 * @returns
 * - `usable`: version 4 or later with its program, both inside the repository.
 * - `links-outside`: the package folder, its package file or its program resolves outside the repository.
 * - `unreadable-version`: the package file is missing, unreadable, too large or names no short semantic version.
 * - `too-old`: a version below 4.
 * - `program-missing`: a supported version without `vitest.mjs`.
 * @example
 * await readVitestPrerequisite('/repo', '/repo/packages/query-core')
 * // => { state: 'usable', version: '5.0.5', major: 5, program: '/repo/node_modules/.pnpm/vitest@5.0.5/node_modules/vitest/vitest.mjs', packageDirectory: '/repo/node_modules/.pnpm/vitest@5.0.5/node_modules/vitest' }
 * await readVitestPrerequisite('/repo', '/repo') // => { state: 'too-old', version: '3.2.4' }
 */
export async function readVitestPrerequisite(
  root: string,
  directory: string,
): Promise<VitestInstallation> {
  // A pnpm global virtual store or a shared store outside the repository is not run; say so instead of "unreadable" (F101).
  if (await leavesRepository(root, join(directory, VITEST_PACKAGE_DIRECTORY)))
    return { state: 'links-outside' }
  const fromRoot = relative(root, directory)
  const packageFile = await resolveOwnedRepositoryFile(
    root,
    join(fromRoot, VITEST_PACKAGE_PATH),
  )
  if (!packageFile)
    return (await leavesRepository(root, join(directory, VITEST_PACKAGE_PATH)))
      ? { state: 'links-outside' }
      : { state: 'unreadable-version' }
  const version = await printableVersion(packageFile)
  if (version === undefined) return { state: 'unreadable-version' }
  const major = Number.parseInt(version, 10)
  if (major < NODE_TEST_MINIMUM_VITEST_MAJOR)
    return { state: 'too-old', version }
  const program = await resolveOwnedRepositoryFile(
    root,
    join(fromRoot, VITEST_PROGRAM_PATH),
  )
  if (!program)
    return (await leavesRepository(root, join(directory, VITEST_PROGRAM_PATH)))
      ? { state: 'links-outside' }
      : { state: 'program-missing' }
  return {
    state: 'usable',
    version,
    major,
    program,
    packageDirectory: dirname(packageFile),
  }
}

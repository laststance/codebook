import { readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import {
  NODE_TEST_MINIMUM_VITEST_MAJOR,
  PRINTABLE_VITEST_VERSION,
  VITEST_PACKAGE_JSON_LIMIT_BYTES,
  VITEST_PACKAGE_PATH,
} from '../constants'

import { isInsideFolder } from './isInsideFolder'
import { resolveOwnedRepositoryFile } from './resolveOwnedRepositoryFile'

const vitestPackageSchema = z.object({ version: z.string() })

/** What the repository's root Vitest allows: a supported version, or the sentence the agent reads in its place. */
export type VitestPrerequisite =
  | { ready: true; version: string; major: number }
  | { ready: false; reason: string }

/**
 * Reads the version a Vitest package file names, printing it only as a short semantic version.
 * @param file - The package file's real path.
 * @returns The version, or `undefined` for a file above {@link VITEST_PACKAGE_JSON_LIMIT_BYTES}, one that does not parse, and a version that is no short semantic version.
 * @example await printableVersion('/repo/node_modules/vitest/package.json') // => '4.1.11'
 */
async function printableVersion(file: string): Promise<string | undefined> {
  const entry = await stat(file)
  if (entry.size > VITEST_PACKAGE_JSON_LIMIT_BYTES) return undefined
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
 * Tells whether the opened repository has the root Vitest node-test runs, before any start: `codebook_status` names a missing or older one in `profiles['node-test'].missing`, and a start's preparation refuses with the same sentence before the run's history exists; called by the study environment's prerequisites and by {@link prepareNodeTestLaunch}.
 * The package file is read through realpath containment ({@link resolveOwnedRepositoryFile}), so a link that leaves the repository is not run and is named as such, and its version is printed only as a short semantic version ({@link PRINTABLE_VITEST_VERSION}), else as `an unreadable version`, so a package's `version` field cannot carry other text into the agent's first answer.
 * @param workspace - The opened repository's root.
 * @returns `ready` with the version and its major, or the sentence that names what is missing and what to ask the learner.
 * @example
 * await readVitestPrerequisite('/repo') // => { ready: true, version: '4.1.11', major: 4 }
 * await readVitestPrerequisite('/repo-with-vitest-3')
 * // => { ready: false, reason: 'node-test needs Vitest 4 or later at the repository root; this repository has 3.2.4 (node_modules/vitest/package.json). Ask the learner to upgrade it, then call codebook_status again.' }
 */
export async function readVitestPrerequisite(
  workspace: string,
): Promise<VitestPrerequisite> {
  const root = await realpath(workspace)
  const file = await resolveOwnedRepositoryFile(root, VITEST_PACKAGE_PATH)
  if (!file) {
    // A Vitest that exists but resolves outside the repository (pnpm's global virtual store) is not run; say so instead of "none" (F101).
    const linked = await realpath(join(root, VITEST_PACKAGE_PATH)).catch(
      () => undefined,
    )
    if (linked && !isInsideFolder(root, linked))
      return {
        ready: false,
        reason: `node-test needs Vitest ${NODE_TEST_MINIMUM_VITEST_MAJOR} or later inside the repository; node_modules/vitest at the repository root links outside it, which Codebook does not run. Ask the learner to install Vitest in the repository, then call codebook_status again.`,
      }
    return {
      ready: false,
      reason: `node-test needs Vitest ${NODE_TEST_MINIMUM_VITEST_MAJOR} or later at the repository root; this repository has none at node_modules/vitest, and a Vitest inside a package is not supported yet. Ask the learner to install it at the root, then call codebook_status again.`,
    }
  }
  const version = await printableVersion(file)
  const major =
    version === undefined ? Number.NaN : Number.parseInt(version, 10)
  if (version !== undefined && major >= NODE_TEST_MINIMUM_VITEST_MAJOR)
    return { ready: true, version, major }
  return {
    ready: false,
    reason: `node-test needs Vitest ${NODE_TEST_MINIMUM_VITEST_MAJOR} or later at the repository root; this repository has ${version ?? 'an unreadable version'} (node_modules/vitest/package.json). Ask the learner to upgrade it, then call codebook_status again.`,
  }
}

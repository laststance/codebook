import { realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { NODE_TEST_ROOT_CONFIG_HASH_LIMIT_BYTES } from '../constants'

import { hashFileSha256 } from './hashFileSha256'
import {
  readVitestConfigEntries,
  type VitestConfigEntries,
} from './readVitestConfigEntries'
import { requireOwnedVitest, type OwnedVitest } from './requireOwnedVitest'

/** What a root claim is decided from at the opened root, kept in the execution plan and compared again before the launch: a root config added, edited or removed, or a root Vitest installed or replaced, can change where the test runs. */
export type RootClaimBasis = {
  /** Each root config file by name; where a claim can be made, followed by the SHA-256 of its bytes, or by its size, modification time and file id when it is larger than {@link NODE_TEST_ROOT_CONFIG_HASH_LIMIT_BYTES}, or `unreadable`. In Vitest's name order. */
  configFiles: string[]
  /** Config-named folders and links that leave the repository at the root. */
  refusedEntries: string[]
  /** The root's own usable Vitest as `<package folder> <version>`; `undefined` when none is usable, and when the root has no config a claim could use, since then no claim is made whatever Vitest it holds. */
  vitest: string | undefined
}

/**
 * Identifies one root config file by its content for a root claim's basis: the SHA-256 of its bytes, or, past {@link NODE_TEST_ROOT_CONFIG_HASH_LIMIT_BYTES}, its size, modification time and file id, so no read is unbounded.
 * Called by {@link readRootClaimBasis} for each root config file when a claim can be made.
 * @param root - The repository's real root.
 * @param name - The config file's name at the root; it may be a link inside the repository, whose target is what Vitest loads.
 * @returns `<name> <identity>`, or `<name> unreadable`.
 * @example await configIdentity('/repo', 'vitest.config.ts') // => 'vitest.config.ts 9f2c…'
 */
async function configIdentity(root: string, name: string): Promise<string> {
  const identity = await realpath(join(root, name))
    .then(async (target) => {
      const info = await stat(target)
      if (info.size > NODE_TEST_ROOT_CONFIG_HASH_LIMIT_BYTES)
        return `${info.size} bytes, modified ${info.mtimeMs}, file ${info.ino}`
      return hashFileSha256(target)
    })
    .catch(() => 'unreadable')
  return `${name} ${identity}`
}

/**
 * Reads the opened root's facts a root claim depends on: its config entries, its own Vitest where a claim could use it, and, only where a claim can be made, each config file's content identity.
 * Called by {@link planNodeTestExecution} when the config walk stopped below the root, and by {@link prepareNodeTestLaunch} to compare the basis again before and after its listings.
 * A file a root config imports is not part of the basis: only the config files themselves are identified.
 * @param root - The repository's real root.
 * @param testFile - The cited test's real path, which an unreadable folder's refusal names.
 * @returns The basis, with the root's config entries and its usable Vitest for the claim itself.
 * @throws The refusal of {@link readVitestConfigEntries} for a root entry that cannot be read.
 * @example
 * await readRootClaimBasis('/repo', '/repo/browser-extension/tests/a.test.ts')
 * // => { basis: { configFiles: ['vitest.config.ts 9f2c…'], refusedEntries: [], vitest: '/repo/node_modules/vitest 5.0.5' }, entries, vitest }
 */
export async function readRootClaimBasis(
  root: string,
  testFile: string,
): Promise<{
  basis: RootClaimBasis
  entries: VitestConfigEntries
  vitest: OwnedVitest | undefined
}> {
  const entries = await readVitestConfigEntries(root, root, testFile)
  // Only a root config with no folder or outside link beside it lets a claim use the root's Vitest; a missing, older or broken one makes no claim.
  const claimable =
    entries.configFiles.length > 0 && entries.refusedEntries.length === 0
  const vitest = claimable
    ? await requireOwnedVitest(root, root, testFile).catch(() => undefined)
    : undefined
  // A config's content decides a claim only where one can be made; elsewhere its name is enough, and nothing is read.
  const configFiles = vitest
    ? await Promise.all(
        entries.configFiles.map((name) => configIdentity(root, name)),
      )
    : entries.configFiles
  return {
    basis: {
      configFiles,
      refusedEntries: entries.refusedEntries,
      vitest: vitest && `${vitest.packageDirectory} ${vitest.version}`,
    },
    entries,
    vitest,
  }
}

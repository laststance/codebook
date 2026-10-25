import { realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { hashFileSha256 } from './hashFileSha256'
import {
  readVitestConfigEntries,
  type VitestConfigEntries,
} from './readVitestConfigEntries'
import { requireOwnedVitest, type OwnedVitest } from './requireOwnedVitest'

/** What a root claim is decided from at the opened root, kept in the execution plan and compared again right before the launch: a root config added, edited or removed, or a root Vitest installed or replaced, can change where the test runs. */
export type RootClaimBasis = {
  /** Each root config file as `<name> <sha256 of its bytes>` (`unreadable` in place of the hash when it cannot be read), in Vitest's name order. */
  configFiles: string[]
  /** Config-named folders and links that leave the repository at the root. */
  refusedEntries: string[]
  /** The root's own usable Vitest as `<package folder> <version>`; `undefined` when none is usable, and when the root has no config a claim could use, since then no claim is made whatever Vitest it holds. */
  vitest: string | undefined
}

/**
 * Reads the opened root's facts a root claim depends on: its config entries with each config file's content hash, and its own Vitest where a claim could use it.
 * Called by {@link planNodeTestExecution} when the config walk stopped below the root, and by {@link prepareNodeTestLaunch} to compare the basis again before the launch.
 * A file a root config imports is not part of the basis: only the config files themselves are hashed.
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
  const configFiles = await Promise.all(
    entries.configFiles.map(async (name) => {
      // A config file may be a link inside the repository; its target's bytes are what Vitest loads.
      const hash = await realpath(join(root, name))
        .then(hashFileSha256)
        .catch(() => 'unreadable')
      return `${name} ${hash}`
    }),
  )
  // Only a root config with no folder or outside link beside it lets a claim use the root's Vitest; a missing, older or broken one makes no claim.
  const claimable =
    entries.configFiles.length > 0 && entries.refusedEntries.length === 0
  const vitest = claimable
    ? await requireOwnedVitest(root, root, testFile).catch(() => undefined)
    : undefined
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

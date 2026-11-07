import { delimiter, dirname } from 'node:path'

import {
  boundedPackageManagerText,
  resolveRepositoryPackageManager,
} from './resolveRepositoryPackageManager'

/** What `codebook_status` says about the repository's package manager under the `node-script` prerequisites. */
export type RepositoryPackageManagerStatus =
  | {
      name: 'pnpm' | 'npm'
      found: true
      /** The version the root `packageManager` field declares; `null` when a lockfile chose the manager. */
      version: string | null
    }
  | {
      found: false
      /** `missing`: pnpm or npm was decided but is not on `PATH`; `unsupported`: Yarn, Bun or a malformed field; `unknown`: both lockfiles or none and no field. */
      reason: 'missing' | 'unsupported' | 'unknown'
      /** The manager name that was not found, the declared `packageManager` text, or the lockfile names found. */
      packageManager: string
    }

/**
 * Reports which package manager the library route would build the repository with and whether it is installed, so an agent knows before a start that `library` cannot work here.
 * It never refuses a start: only a run that declares `library` needs the manager.
 * Called by the environment when it reports the `node-script` profile's prerequisites.
 * @param workspace - The opened repository's root.
 * @param nodeExecutable - The external Node whose folder leads the `PATH` the manager is looked up on, or `undefined` when none resolves.
 * @returns The status: name, found and version, or the reason the manager cannot be used.
 * @example
 * await describeRepositoryPackageManager('/repo', '/node/bin/node') // => { name: 'pnpm', found: true, version: '11.23.0' }
 */
export async function describeRepositoryPackageManager(
  workspace: string,
  nodeExecutable: string | undefined,
): Promise<RepositoryPackageManagerStatus> {
  const hostPath = process.env.PATH ?? ''
  const pathText =
    nodeExecutable === undefined
      ? hostPath
      : `${dirname(nodeExecutable)}${delimiter}${hostPath}`
  const result = await resolveRepositoryPackageManager(workspace, { pathText })
  if (result.ok)
    return { name: result.name, found: true, version: result.version }
  const reason =
    result.reason === 'package-manager-missing'
      ? 'missing'
      : result.reason === 'package-manager-unsupported'
        ? 'unsupported'
        : 'unknown'
  return {
    found: false,
    reason,
    packageManager: boundedPackageManagerText(result.packageManager),
  }
}

import { delimiter, dirname } from 'node:path'

import { readLibraryPackageName } from './readLibraryPackageName'
import { resolveRepositoryPackageManager } from './resolveRepositoryPackageManager'

/** What the dialog and the status line say about a declared library before anything builds. */
export type LibraryBuildDescription = {
  /** The library's package name. */
  package: string
  /** The repository's package manager name (`pnpm` or `npm`), or `its package manager` when it cannot be decided. */
  packageManager: string
}

/**
 * Reads the library's package name and the repository's package manager name, best effort, for the editor's confirmation and the `Building <name> for the Example…` status line.
 *
 * Why it exists: the learner is told which package builds with which manager before it builds, but the checks that refuse a bad declaration run only after the confirmation (inside {@link prepareLibraryPackage}); this read decides nothing and refuses nothing.
 * Called by the product dependencies of a `node-script` run before it asks the learner.
 * @param repositoryRoot - The opened repository's root.
 * @param declaredPackageRoot - The declared `library.packageRoot`, relative to the repository root.
 * @param nodeExecutable - The external Node whose folder leads the `PATH` the manager is looked up on.
 * @returns The description, or `undefined` when the library's `package.json` holds no name.
 * @example
 * await describeLibraryBuild('/repo', 'packages/toolkit', '/node/bin/node') // => { package: '@reduxjs/toolkit', packageManager: 'pnpm' }
 */
export async function describeLibraryBuild(
  repositoryRoot: string,
  declaredPackageRoot: string,
  nodeExecutable: string,
): Promise<LibraryBuildDescription | undefined> {
  const name = await readLibraryPackageName(repositoryRoot, declaredPackageRoot)
  if (name === undefined) return undefined
  const hostPath = process.env.PATH ?? ''
  const manager = await resolveRepositoryPackageManager(repositoryRoot, {
    pathText: `${dirname(nodeExecutable)}${delimiter}${hostPath}`,
  }).catch(() => undefined)
  return {
    package: name,
    packageManager: manager?.ok ? manager.name : 'its package manager',
  }
}

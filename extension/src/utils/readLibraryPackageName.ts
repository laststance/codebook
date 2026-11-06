import { readFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { z } from 'zod'

import { isAtOrInsideFolder } from './isAtOrInsideFolder'
import { isNpmPackageName } from './isNpmPackageName'

/** The one field of a `package.json` this read needs. */
const manifestNameSchema = z.looseObject({ name: z.string().min(1) })

/**
 * Reads the `name` of the declared library's `package.json`, best effort.
 *
 * Why it exists: the history header of a run with `library` names the package before the build runs, and the dialog and status line name it too; this read decides and refuses nothing (the checks inside {@link prepareLibraryPackage} do).
 * Called by {@link describeLibraryBuild} and by the service when it starts a run's history.
 * @param repositoryRoot - The opened repository's root.
 * @param declaredPackageRoot - The declared `library.packageRoot`, relative to the repository root.
 * @returns The package name, or `undefined` when the file is missing, unreadable, holds no valid npm package name, or its real path lies outside the repository; callers then show the declared folder instead.
 * @example
 * await readLibraryPackageName('/repo', 'packages/toolkit') // => '@reduxjs/toolkit'
 */
export async function readLibraryPackageName(
  repositoryRoot: string,
  declaredPackageRoot: string,
): Promise<string | undefined> {
  // The dialog and the header quote this name, so a file outside the repository is never read for them.
  const manifestPath = join(
    resolve(repositoryRoot, declaredPackageRoot),
    'package.json',
  )
  const real = await Promise.all([
    realpath(repositoryRoot),
    realpath(manifestPath),
  ]).catch(() => undefined)
  if (real === undefined || !isAtOrInsideFolder(real[0], real[1]))
    return undefined
  const text = await readFile(real[1], 'utf8').catch(() => undefined)
  if (text === undefined) return undefined
  try {
    const name = manifestNameSchema.safeParse(JSON.parse(text)).data?.name
    // An invalid name falls back to the declared folder at the callers.
    return name !== undefined && isNpmPackageName(name) ? name : undefined
  } catch {
    // Text that is not JSON names nothing.
    return undefined
  }
}

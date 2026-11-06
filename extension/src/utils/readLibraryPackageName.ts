import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { z } from 'zod'

/** The one field of a `package.json` this read needs. */
const manifestNameSchema = z.looseObject({ name: z.string().min(1) })

/**
 * Reads the `name` of the declared library's `package.json`, best effort.
 *
 * Why it exists: the history header of a run with `library` names the package before the build runs, and the dialog and status line name it too; this read decides and refuses nothing (the checks inside {@link prepareLibraryPackage} do).
 * Called by {@link describeLibraryBuild} and by the service when it starts a run's history.
 * @param repositoryRoot - The opened repository's root.
 * @param declaredPackageRoot - The declared `library.packageRoot`, relative to the repository root.
 * @returns The package name, or `undefined` when the file is missing, unreadable or holds no name.
 * @example
 * await readLibraryPackageName('/repo', 'packages/toolkit') // => '@reduxjs/toolkit'
 */
export async function readLibraryPackageName(
  repositoryRoot: string,
  declaredPackageRoot: string,
): Promise<string | undefined> {
  const text = await readFile(
    join(resolve(repositoryRoot, declaredPackageRoot), 'package.json'),
    'utf8',
  ).catch(() => undefined)
  if (text === undefined) return undefined
  try {
    return manifestNameSchema.safeParse(JSON.parse(text)).data?.name
  } catch {
    // Text that is not JSON names nothing.
    return undefined
  }
}

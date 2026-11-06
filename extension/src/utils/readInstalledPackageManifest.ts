import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

const installedManifestSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
})

/** What {@link readInstalledPackageManifest} found: the manifest's path and its version when it has one. */
export type InstalledPackageManifest = {
  /** The path of the `package.json` found. */
  manifestPath: string
  /** The `version` field, or `undefined` when the manifest has none. */
  version: string | undefined
}

/**
 * Finds the nearest installed copy of a package by walking `node_modules/<name>/package.json` from a folder up to the file-system root, reading the manifest file itself and not resolving through the package's `exports`.
 *
 * Why it exists: a package's `exports` can hide `./package.json`, so the install checks of the library route look at the file on disk, as {@link readInstalledWxtVersion} does for WXT.
 * Called by {@link prepareLibraryPackage} for the library's dependencies, the Example's peers and the Example's installed copy of the library.
 * @param fromFolder - The folder the walk starts in (a real path).
 * @param packageName - The package name, scoped names included.
 * @returns The nearest readable manifest, or `undefined` when no ancestor holds one.
 * @example
 * await readInstalledPackageManifest('/repo/packages/toolkit', 'redux') // => { manifestPath: '/repo/node_modules/redux/package.json', version: '5.0.1' }
 */
export async function readInstalledPackageManifest(
  fromFolder: string,
  packageName: string,
): Promise<InstalledPackageManifest | undefined> {
  let folder = fromFolder
  // Climb one level at a time, as module resolution does.
  for (;;) {
    const manifestPath = join(
      folder,
      'node_modules',
      packageName,
      'package.json',
    )
    try {
      const manifest = installedManifestSchema.parse(
        JSON.parse(await readFile(manifestPath, 'utf8')),
      )
      return { manifestPath, version: manifest.version }
    } catch {
      // Absent or unreadable here: the next ancestor may hold it.
    }
    const parent = dirname(folder)
    if (parent === folder) return undefined
    folder = parent
  }
}

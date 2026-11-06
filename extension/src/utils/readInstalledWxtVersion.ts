import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { z } from 'zod'

const wxtManifestSchema = z.object({ version: z.string() })

/**
 * Reads the version of the `wxt` package that Node resolution finds from a project folder, as `createRequire(<project>/package.json)` does.
 * Called by {@link assertWxtBuildSupported} before any build process starts.
 * @param projectRoot - The WXT project folder (`extensionRoot`'s real path).
 * @returns The installed version string, or `undefined` when `wxt/package.json` does not resolve or holds no version.
 * @example
 * await readInstalledWxtVersion('/repo/browser-extension') // => '0.21.4'
 */
export async function readInstalledWxtVersion(
  projectRoot: string,
): Promise<string | undefined> {
  try {
    const manifestPath = createRequire(
      join(projectRoot, 'package.json'),
    ).resolve('wxt/package.json')
    return wxtManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, 'utf8')),
    ).version
  } catch {
    return undefined
  }
}

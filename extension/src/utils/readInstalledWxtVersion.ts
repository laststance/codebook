import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { z } from 'zod'

const wxtManifestSchema = z.object({ version: z.string() })

/**
 * Reads the version of the `wxt` package that Node resolution finds from a project folder, walking the same `node_modules` folders `createRequire(<project>/package.json)` searches.
 * It reads `<folder>/wxt/package.json` directly, because the real `wxt` package's `exports` hide `./package.json`, so `require.resolve('wxt/package.json')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED` even when WXT is installed.
 * Called by {@link assertWxtBuildSupported} before any build process starts.
 * @param projectRoot - The WXT project folder (`extensionRoot`'s real path).
 * @returns
 * - The installed version string of the nearest `wxt` (the project's own `node_modules` first, then each parent's, as Node resolves it)
 * - `undefined` when no `wxt/package.json` is found or the nearest one holds no version
 * @example
 * await readInstalledWxtVersion('/repo/browser-extension') // => '0.21.4' (also when WXT is hoisted to /repo/node_modules)
 */
export async function readInstalledWxtVersion(
  projectRoot: string,
): Promise<string | undefined> {
  const searchPaths =
    createRequire(join(projectRoot, 'package.json')).resolve.paths('wxt') ?? []
  // The first node_modules folder that holds a wxt package is the one Node resolution would load.
  for (const folder of searchPaths) {
    const manifest = await readManifest(join(folder, 'wxt', 'package.json'))
    if (manifest !== undefined) return manifest.version
  }
  return undefined
}

/**
 * Reads one candidate `wxt/package.json`.
 * @param manifestPath - The candidate manifest path.
 * @returns The parsed manifest, or `undefined` when the file is absent, unreadable or holds no version.
 * @example
 * await readManifest('/repo/node_modules/wxt/package.json') // => { version: '0.21.4' }
 */
async function readManifest(
  manifestPath: string,
): Promise<{ version: string } | undefined> {
  try {
    return wxtManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, 'utf8')),
    )
  } catch {
    return undefined
  }
}

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

const wxtManifestSchema = z.object({ version: z.string() })

/**
 * Reads the version of the `wxt` package that the build's `import('wxt')` loads from a project folder: the nearest `<ancestor>/node_modules/wxt`, from the folder up to the file-system root.
 * It walks the ancestors itself, because an ES module import searches only those folders (never `NODE_PATH` or the global folders that `require.resolve.paths` adds), and it reads `<folder>/wxt/package.json` directly, because the real `wxt` package's `exports` hide `./package.json`.
 * Called by {@link assertWxtBuildSupported} before any build process starts, and by {@link discoverWxtProjects} for the status report.
 * @param projectRoot - The WXT project folder (`extensionRoot`'s real path).
 * @returns
 * - The installed version string of the nearest `wxt` with a readable version (the project's own `node_modules` first, then each parent's)
 * - `undefined` when no ancestor holds a `wxt/package.json` with a version
 * @example
 * await readInstalledWxtVersion('/repo/browser-extension') // => '0.21.4' (also when WXT is hoisted to /repo/node_modules)
 */
export async function readInstalledWxtVersion(
  projectRoot: string,
): Promise<string | undefined> {
  let folder = projectRoot
  // Climb one level at a time, as module resolution does; the file-system root is the last folder looked in.
  for (;;) {
    const manifest = await readManifest(
      join(folder, 'node_modules', 'wxt', 'package.json'),
    )
    if (manifest !== undefined) return manifest.version
    const parent = dirname(folder)
    if (parent === folder) return undefined
    folder = parent
  }
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

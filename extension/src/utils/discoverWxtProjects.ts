import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

import {
  WXT_CONFIG_FILE_NAMES,
  WXT_PROJECT_DEPTH_LIMIT,
  WXT_PROJECT_LIMIT,
  WXT_SUPPORTED_MAJOR_MINOR,
} from '../constants'

import { readInstalledWxtVersion } from './readInstalledWxtVersion'

/** One WXT project `codebook_status` lists: its folder (repository-relative, `.` for the root), the WXT version resolved from it or `missing`, and whether the `wxt-build` adapter builds that version. */
export interface WxtProjectReport {
  folder: string
  wxtVersion: string
  supported: boolean
}

/**
 * Tells whether a folder holds one of the WXT config files, without running any of them.
 * @param folder - The absolute folder.
 * @returns `true` when a regular `wxt.config.{ts,mts,js,mjs}` file is there.
 */
async function hasWxtConfig(folder: string): Promise<boolean> {
  for (const name of WXT_CONFIG_FILE_NAMES) {
    // A missing name is the normal case; only a regular file counts.
    const found = await stat(join(folder, name)).then(
      (entry) => entry.isFile(),
      () => false,
    )
    if (found) return true
  }
  return false
}

/**
 * Tells whether a WXT version is a release of the one line the adapter builds (`0.21.<number>`; a prerelease is refused).
 * @param version - The installed version text.
 * @returns `true` for `0.21.<digits>` only.
 * @example isSupportedWxtVersion('0.21.4') // => true; isSupportedWxtVersion('0.22.0') // => false
 */
function isSupportedWxtVersion(version: string): boolean {
  const prefix = `${WXT_SUPPORTED_MAJOR_MINOR}.`
  return (
    version.startsWith(prefix) && /^\d+$/.test(version.slice(prefix.length))
  )
}

/**
 * Lists the child folders to search, sorted so the report does not depend on directory order and skipping `node_modules`, `.git` and any dot-folder.
 * @param folder - The absolute folder.
 * @returns The absolute child folders.
 */
async function searchableChildren(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== 'node_modules' &&
        !entry.name.startsWith('.'),
    )
    .map((entry) => entry.name)
    .sort()
    .map((name) => join(folder, name))
}

/**
 * Lists the WXT projects of a repository for `codebook_status`: folders at the root or up to two levels below it that hold a WXT config, shallowest first, at most ten. No config is executed.
 * Called by the environment when it reports the `chrome-extension` profile's prerequisites.
 * @param root - The absolute repository root.
 * @returns Each project's folder, installed WXT version (or `missing`) and whether this version builds it.
 * @example await discoverWxtProjects('/repo') // => [{ folder: 'browser-extension', wxtVersion: '0.21.4', supported: true }]
 */
export async function discoverWxtProjects(
  root: string,
): Promise<WxtProjectReport[]> {
  const projects: WxtProjectReport[] = []
  let level = [root]
  // Breadth first, so the shallowest folders fill the limit before deeper ones.
  for (
    let depth = 0;
    depth <= WXT_PROJECT_DEPTH_LIMIT && level.length > 0;
    depth += 1
  ) {
    const next: string[] = []
    for (const folder of level) {
      if (projects.length >= WXT_PROJECT_LIMIT) return projects
      if (await hasWxtConfig(folder)) {
        // The same lookup the build uses, so status and start agree.
        const wxtVersion = (await readInstalledWxtVersion(folder)) ?? 'missing'
        projects.push({
          folder: relative(root, folder) || '.',
          wxtVersion,
          supported: isSupportedWxtVersion(wxtVersion),
        })
      }
      if (depth < WXT_PROJECT_DEPTH_LIMIT)
        next.push(...(await searchableChildren(folder)))
    }
    level = next
  }
  return projects
}

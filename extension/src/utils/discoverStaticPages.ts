import { readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import {
  STATIC_PAGE_DISCOVERY_FOLDERS,
  STATIC_PAGE_DISCOVERY_PACKAGES_MAX,
} from '../constants'

import {
  otherAdapterOfManifest,
  readStaticPageReadiness,
  type StaticPagePackageReadiness,
} from './readStaticPageReadiness'
import { readJsonInside } from './resolveNextPackage'
import type { NextPackageTruncationReason } from './scanNextPackages'

/** What {@link discoverStaticPages} lists. */
export type StaticPageDiscovery = {
  /** Whether the opened root is itself a candidate page (an `index.html`, no other adapter's dependency). */
  rootIsApp: boolean
  packages: StaticPagePackageReadiness[]
  packagesTruncated: boolean
  packagesTruncatedReason?: NextPackageTruncationReason
}

/**
 * Tells whether a folder is a candidate plain page: it has an `index.html` and no other adapter's dependency.
 * Called by {@link discoverStaticPages} for the root and each child folder.
 * @param folder - The folder's real path.
 * @returns `true` for a candidate page.
 * @example await isCandidateStaticPage('/repo/examples/counter-vanilla') // => true
 */
async function isCandidateStaticPage(folder: string): Promise<boolean> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
  if (!entries.some((entry) => entry.isFile() && entry.name === 'index.html'))
    return false
  const manifest = await readJsonInside(folder, 'package.json', z.unknown())
  return otherAdapterOfManifest(manifest) === undefined
}

/**
 * Lists the plain pages of a repository: its root and the children of `examples/` and `apps/`, each with the readiness a start with its `packageRoot` decides.
 *
 * Why it exists: `codebook_status` lists the pages the chat can choose from, as it lists the apps of the other adapters; a plain page has no `package.json` rule, so the discovery looks for the page itself. Called by the status readiness.
 * @param repositoryRoot - The opened repository's root.
 * @returns Whether the root is a page and the listed pages; the list is cut at {@link STATIC_PAGE_DISCOVERY_PACKAGES_MAX} and reported as truncated by `limit`.
 * @example
 * await discoverStaticPages('/repo') // => { rootIsApp: false, packages: [{ packageRoot: 'examples/page', ready: true, missing: [], entry: 'index.html' }], packagesTruncated: false }
 */
export async function discoverStaticPages(
  repositoryRoot: string,
): Promise<StaticPageDiscovery> {
  const root = await realpath(repositoryRoot).catch(() => repositoryRoot)
  const rootIsApp = await isCandidateStaticPage(root)
  const packages: StaticPagePackageReadiness[] = []
  let isTruncated = false
  for (const parent of STATIC_PAGE_DISCOVERY_FOLDERS) {
    const children = await readdir(join(root, parent), {
      withFileTypes: true,
    }).catch(() => [])
    // A link is not a folder here: a page behind a link could lie outside the repository.
    for (const child of children
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      if (child.name === 'node_modules') continue
      const folder = join(root, parent, child.name)
      if (!(await isCandidateStaticPage(folder))) continue
      if (packages.length >= STATIC_PAGE_DISCOVERY_PACKAGES_MAX) {
        isTruncated = true
        continue
      }
      packages.push({
        packageRoot: `${parent}/${child.name}`,
        ...(await readStaticPageReadiness(folder)),
      })
    }
  }
  return {
    rootIsApp,
    packages,
    packagesTruncated: isTruncated,
    ...(isTruncated ? { packagesTruncatedReason: 'limit' as const } : {}),
  }
}

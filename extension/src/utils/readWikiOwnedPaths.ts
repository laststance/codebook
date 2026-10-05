import { WIKI_ENTRY_FILE } from '../constants'

import { readWikiRegularFile } from './readWikiRegularFile'

/**
 * Takes a value of a manifest as a list; called by {@link manifestLists} for the value of `pages` and of `assets`.
 * @param value - The value of the key, or `undefined` when the manifest has no such key.
 * @returns The entries whatever their types, or an empty list when the value is no array.
 * @example
 * listOrEmpty(['assets/site.css']) // => ['assets/site.css']
 * listOrEmpty('assets/site.css')   // => []
 */
function listOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * Reads a manifest's two lists; called by {@link ownedPathsOfManifest} before any entry is looked at.
 * @param manifest - The parsed manifest.
 * @returns The entries of `pages` and of `assets`, each empty when the manifest has no such key or its value is no array.
 * @example
 * manifestLists({ assets: ['assets/site.css'] }) // => { pages: [], assets: ['assets/site.css'] }
 */
function manifestLists(manifest: object): {
  pages: unknown[]
  assets: unknown[]
} {
  return {
    pages: listOrEmpty('pages' in manifest ? manifest.pages : undefined),
    assets: listOrEmpty('assets' in manifest ? manifest.assets : undefined),
  }
}

/**
 * Reads the path one entry of a manifest's `pages` names; called by {@link ownedPathsOfManifest} for each page.
 * @param page - One entry of the list, whatever its type.
 * @returns The value of the entry's `path` whatever its type, or `undefined` when the entry is no object or has no such key.
 * @example
 * pagePath({ path: 'pages/overview.html', title: 'Overview' }) // => 'pages/overview.html'
 * pagePath('pages/overview.html')                             // => undefined
 */
function pagePath(page: unknown): unknown {
  return typeof page === 'object' && page !== null && 'path' in page
    ? page.path
    : undefined
}

/**
 * Collects the paths a parsed manifest owns; called by {@link readWikiOwnedPaths} with what the manifest file parsed to.
 * @param manifest - The parsed JSON of the manifest file.
 * @returns
 * - A JSON object: the index, then every page's path, then every asset, each only when it is a string
 * - Anything else: `undefined`
 * @example
 * ownedPathsOfManifest({ pages: [{ path: 'pages/overview.html' }], assets: ['assets/site.css'] })
 * // => Set { 'index.html', 'pages/overview.html', 'assets/site.css' }
 * ownedPathsOfManifest('not a manifest') // => undefined
 */
function ownedPathsOfManifest(manifest: unknown): Set<string> | undefined {
  if (typeof manifest !== 'object' || manifest === null) return undefined
  const { pages, assets } = manifestLists(manifest)
  const named = [...pages.map(pagePath), ...assets]
  return new Set<string>([
    WIKI_ENTRY_FILE,
    ...named.filter((path) => typeof path === 'string'),
  ])
}

/**
 * Reads the output-relative paths a Wiki manifest owns: the index, every page and every asset.
 *
 * Why: the publisher treats exactly these paths as generated and every other file of the folder as the learner's, so the conflict probe must draw the same line.
 * Called by {@link listWikiCandidates} for a candidate's manifest and by {@link detectWikiPublishConflicts} for the published one.
 *
 * @param manifestPath - Absolute path of a `codebook-wiki.json`.
 * @returns
 * - A readable manifest: its owned paths (always with `index.html`)
 * - A missing file, one that is not a regular file ({@link readWikiRegularFile}) or one that is not a JSON object: undefined
 *
 * @example
 * ```ts
 * await readWikiOwnedPaths('/repo/.codebook/wiki/codebook-wiki.json')
 * // => Set { 'index.html', 'pages/overview.html', 'assets/site.css' }
 * ```
 */
export async function readWikiOwnedPaths(
  manifestPath: string,
): Promise<Set<string> | undefined> {
  try {
    const manifestFile = await readWikiRegularFile(manifestPath)
    if (!manifestFile) return undefined
    const manifest: unknown = JSON.parse(manifestFile.bytes.toString('utf8'))
    return ownedPathsOfManifest(manifest)
  } catch {
    return undefined
  }
}

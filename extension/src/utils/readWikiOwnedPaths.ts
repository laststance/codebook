import { readFile } from 'node:fs/promises'

/**
 * Reads the output-relative paths a Wiki manifest owns: the index, every page and every asset.
 *
 * Why: the publisher treats exactly these paths as generated and every other file of the folder as the learner's, so the conflict probe must draw the same line.
 * Called by {@link listWikiCandidates} for a candidate's manifest and by {@link detectWikiPublishConflicts} for the published one.
 *
 * @param manifestPath - Absolute path of a `codebook-wiki.json`.
 * @returns
 * - A readable manifest: its owned paths (always with `index.html`)
 * - A missing file or one that is not a JSON object: undefined
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
    const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (typeof manifest !== 'object' || manifest === null) return undefined
    const pages =
      'pages' in manifest && Array.isArray(manifest.pages) ? manifest.pages : []
    const assets =
      'assets' in manifest && Array.isArray(manifest.assets)
        ? manifest.assets
        : []
    const paths = new Set<string>(['index.html'])
    for (const page of pages)
      if (
        typeof page === 'object' &&
        page !== null &&
        'path' in page &&
        typeof page.path === 'string'
      )
        paths.add(page.path)
    for (const asset of assets) if (typeof asset === 'string') paths.add(asset)
    return paths
  } catch {
    return undefined
  }
}

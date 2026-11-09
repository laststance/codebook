import {
  STATIC_PAGE_CDN_CHAIN_DEPTH_MAX,
  STATIC_PAGE_CDN_CHAIN_FILES_MAX,
} from '../constants'

import type { CdnPackageImport } from './findCdnPackageImports'
import { listRelativePackedImports } from './listRelativePackedImports'
import type { PackedLibraryFiles } from './servePackedLibraryFile'

/**
 * Adds to the CDN files a page names the packed files they import by relative specifier, so a code-split chunk is sealed with its entry.
 *
 * Why it exists: a built library often splits into an entry and chunks (`import './chunk.mjs'`), and a stop in a chunk's source is mapped only by the chunk's own map; the browser asks the CDN for the chunk by the entry's URL, so the chunk's address is the specifier resolved against the entry's address. Called by the library seal's reader of the packed files.
 * @param files - The packed copy's files, read through the instance the redirect serves.
 * @param packageName - The library's package name.
 * @param entries - The CDN files the page names.
 * @returns The entries followed by every chunk they import, at most {@link STATIC_PAGE_CDN_CHAIN_DEPTH_MAX} levels deep and {@link STATIC_PAGE_CDN_CHAIN_FILES_MAX} files in all, each address once.
 * @example
 * await followPackedRelativeImports(files, 'lib', [{ url: 'https://unpkg.com/lib@1/dist/lib.mjs', path: 'dist/lib.mjs' }])
 * // => [{ url: '…/dist/lib.mjs', path: 'dist/lib.mjs' }, { url: 'https://unpkg.com/lib@1/dist/chunk.mjs', path: 'dist/chunk.mjs' }]
 */
export async function followPackedRelativeImports(
  files: PackedLibraryFiles,
  packageName: string,
  entries: readonly CdnPackageImport[],
): Promise<CdnPackageImport[]> {
  const found = new Map<string, CdnPackageImport>()
  let level: CdnPackageImport[] = []
  // Adds a file unless the address is known or the file budget is spent; returns whether it was added.
  const add = (file: CdnPackageImport): boolean => {
    if (found.size >= STATIC_PAGE_CDN_CHAIN_FILES_MAX || found.has(file.url))
      return false
    found.set(file.url, file)
    level.push(file)
    return true
  }
  entries.forEach(add)
  for (
    let depth = 0;
    depth < STATIC_PAGE_CDN_CHAIN_DEPTH_MAX && level.length > 0;
    depth++
  ) {
    const current = level
    level = []
    for (const file of current) {
      const text = (await files.read(file.path))?.text
      if (text === undefined) continue
      listRelativePackedImports(text, file.url, packageName).forEach(add)
    }
  }
  return [...found.values()]
}

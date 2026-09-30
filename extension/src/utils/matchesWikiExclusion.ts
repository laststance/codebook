import { matchesGlob } from 'node:path'

/**
 * Decides whether a repository path falls under one Wiki manifest exclusion, read either as a glob or as a directory.
 * Agents naturally record a directory such as `examples`, `examples/` or `**\/fixtures`, which a glob alone never matches for the files inside it.
 * A literal prefix check still covers directory names that contain glob characters, such as Next.js `[id]` routes.
 * Called by {@link inspectDeepWikiFreshness} when it looks for sources added since generation.
 * @param path - Repository-relative path reported by Git.
 * @param exclusion - One `excludedPaths` entry from the Wiki manifest.
 * @returns Whether the path is excluded from the Wiki's source set.
 * @example
 * matchesWikiExclusion('examples/basic/demo.ts', 'examples') // true
 * matchesWikiExclusion('examples-extra/other.ts', 'examples/') // false
 * matchesWikiExclusion('src/a.test.ts', '**\/*.test.ts') // true
 * matchesWikiExclusion('packages/web/dist/bundle.js', 'packages/*\/dist') // true
 */
export function matchesWikiExclusion(path: string, exclusion: string): boolean {
  const directory = exclusion.replace(/\/+$/, '')
  if (matchesGlob(path, exclusion)) return true
  // An empty entry would otherwise exclude every path.
  if (directory.length === 0) return false
  return (
    path === directory ||
    path.startsWith(`${directory}/`) ||
    matchesGlob(path, `${directory}/**`)
  )
}

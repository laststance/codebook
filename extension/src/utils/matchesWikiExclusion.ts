import { matchesGlob } from 'node:path';

/**
 * Decides whether a repository path falls under one Wiki manifest exclusion, read either as a glob or as a directory.
 * Agents naturally record a directory such as `examples` or `examples/`, which a glob alone never matches for the files inside it.
 * Called by {@link inspectDeepWikiFreshness} when it looks for sources added since generation.
 * @param path - Repository-relative path reported by Git.
 * @param exclusion - One `excludedPaths` entry from the Wiki manifest.
 * @returns Whether the path is excluded from the Wiki's source set.
 * @example
 * matchesWikiExclusion('examples/basic/demo.ts', 'examples') // true
 * matchesWikiExclusion('examples-extra/other.ts', 'examples/') // false
 * matchesWikiExclusion('src/a.test.ts', '**\/*.test.ts') // true
 */
export function matchesWikiExclusion(path: string, exclusion: string): boolean {
  const directory = exclusion.replace(/\/+$/, '');
  return matchesGlob(path, exclusion) || (directory.length > 0 && (path === directory || path.startsWith(`${directory}/`)));
}

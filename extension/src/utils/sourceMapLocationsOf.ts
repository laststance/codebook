import { sep } from 'node:path'

/** The characters js-debug's glob matcher reads as syntax rather than as part of a folder name. */
const GLOB_METACHARACTER = /[\\*?[\]{}()!+@]/g

/**
 * Builds js-debug's `resolveSourceMapLocations` for a repository root: every file below it, minus `node_modules`.
 *
 * Why it exists: js-debug matches these globs against forward-slash paths, so a Windows root (`C:\work\repo`) must be written `C:/work/repo/**`. Called by {@link ConfiguredBrowserRun} when it attaches the app's own API server.
 * @param repositoryRoot - The real path of the opened repository.
 * @param separator - The path separator of the host (defaults to the running platform's).
 * @returns The glob list, root pattern first. On a POSIX host the glob metacharacters of the root are backslash-escaped, so a folder such as `/work/[app]/repo` still matches only itself.
 * @example
 * sourceMapLocationsOf('/work/repo') // => ['/work/repo/**', '!**\/node_modules/**']
 * sourceMapLocationsOf('/work/[app]/repo', '/') // => ['/work/\\[app\\]/repo/**', '!**\/node_modules/**']
 * sourceMapLocationsOf('C:\\work\\repo', '\\') // => ['C:/work/repo/**', '!**\/node_modules/**']
 */
export function sourceMapLocationsOf(
  repositoryRoot: string,
  separator: string = sep,
): string[] {
  // A backslash host only needs its separators rewritten. Backslash-escaping glob metacharacters there is unverified (a backslash is its separator) and native Windows is a later cycle, so the root is left otherwise as is.
  // A POSIX root may hold glob metacharacters (and a literal backslash), which would otherwise widen or break the pattern: escape each with a backslash.
  const forwardRoot =
    separator === '\\'
      ? repositoryRoot.replaceAll('\\', '/')
      : repositoryRoot.replace(GLOB_METACHARACTER, '\\$&')
  return [`${forwardRoot}/**`, '!**/node_modules/**']
}

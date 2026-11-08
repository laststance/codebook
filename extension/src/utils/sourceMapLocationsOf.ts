import { sep } from 'node:path'

/**
 * Builds js-debug's `resolveSourceMapLocations` for a repository root: every file below it, minus `node_modules`.
 *
 * Why it exists: js-debug matches these globs against forward-slash paths, so a Windows root (`C:\work\repo`) must be written `C:/work/repo/**`. Called by {@link ConfiguredBrowserRun} when it attaches the app's own API server.
 * @param repositoryRoot - The real path of the opened repository.
 * @param separator - The path separator of the host (defaults to the running platform's).
 * @returns The glob list, root pattern first.
 * @example
 * sourceMapLocationsOf('/work/repo') // => ['/work/repo/**', '!**\/node_modules/**']
 * sourceMapLocationsOf('C:\\work\\repo', '\\') // => ['C:/work/repo/**', '!**\/node_modules/**']
 */
export function sourceMapLocationsOf(
  repositoryRoot: string,
  separator: string = sep,
): string[] {
  // Only a backslash host needs rewriting; a POSIX name may legally contain a backslash.
  const forwardRoot =
    separator === '\\' ? repositoryRoot.replaceAll('\\', '/') : repositoryRoot
  return [`${forwardRoot}/**`, '!**/node_modules/**']
}

import { sep } from 'node:path'

/**
 * Builds js-debug's `resolveSourceMapLocations` for a repository root: every file below it, minus `node_modules`.
 *
 * Why it exists: js-debug matches these globs against forward-slash paths, so a Windows root (`C:\work\repo`) must be written `C:/work/repo/**`. Called by {@link ConfiguredBrowserRun} when it attaches the app's own API server.
 * @param repositoryRoot - The real path of the opened repository.
 * @param separator - The path separator of the host (defaults to the running platform's).
 * @returns The glob list, root pattern first. The root is passed unescaped on every host.
 * @example
 * sourceMapLocationsOf('/work/repo') // => ['/work/repo/**', '!**\/node_modules/**']
 * sourceMapLocationsOf('/work/[app]/repo', '/') // => ['/work/[app]/repo/**', '!**\/node_modules/**']
 * sourceMapLocationsOf('C:\\work\\repo', '\\') // => ['C:/work/repo/**', '!**\/node_modules/**']
 */
export function sourceMapLocationsOf(
  repositoryRoot: string,
  separator: string = sep,
): string[] {
  // js-debug turns every backslash of an absolute pattern into `/` and escapes glob characters itself in the prefix it shares with the workspace folder, so a backslash-escaped root would never match; a root with glob characters outside the window's folder is therefore not escaped by js-debug (a known limit).
  const forwardRoot =
    separator === '\\' ? repositoryRoot.replaceAll('\\', '/') : repositoryRoot
  return [`${forwardRoot}/**`, '!**/node_modules/**']
}

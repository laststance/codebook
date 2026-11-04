/**
 * Builds the exact `sourceMapPathOverrides` entries that map the paths a nested App Router app's browser maps name onto the checked-out library files.
 *
 * Why it exists: js-debug can bind a breakpoint on the checked-out library file only when the path the map names (a file that does not exist) is mapped onto it. A wildcard key is wrong, because it would map a sibling library file onto the wrong checked-out file (E1 of Cycle 0080 saw react-query's file land on query-core's), so every key is one exact path. Called by {@link ConfiguredBrowserRun} when it launches the owned browser, from the run's frozen stops.
 * @param entries - For each frozen stop, the app-resolved paths ({@link appResolvedPathsOf}) and the checked-out file they lead to.
 * @returns One `{ <app-resolved path>: <checked-out file> }` entry per distinct path. A path with a `*` is left out, since js-debug would read it as a wildcard.
 * @example
 * libraryMapOverrides([{ appResolvedPaths: ['/repo/examples/src/core.ts'], checkedOutFile: '/repo/packages/lib/src/core.ts' }])
 * // => { '/repo/examples/src/core.ts': '/repo/packages/lib/src/core.ts' }
 */
export function libraryMapOverrides(
  entries: readonly {
    appResolvedPaths: readonly string[]
    checkedOutFile: string
  }[],
): Record<string, string> {
  const overrides: Record<string, string> = {}
  for (const { appResolvedPaths, checkedOutFile } of entries)
    for (const path of appResolvedPaths)
      // A key with a wildcard character would no longer name one file.
      if (!path.includes('*')) overrides[path] = checkedOutFile
  return overrides
}

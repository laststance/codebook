/** One library stop's app-resolved paths and the checked-out file they lead to. */
type LibraryMapEntry = {
  appResolvedPaths: readonly string[]
  checkedOutFile: string
}

/** What stops an app-resolved path from becoming an exact override key. */
export type AppLibraryPathConflict =
  | { kind: 'wildcard'; path: string }
  | { kind: 'collision'; path: string; otherFile: string }

/**
 * Finds the first reason a new frozen browser stop cannot get exact override keys beside the stops already frozen.
 *
 * Why it exists: {@link libraryMapOverrides} would drop a key with `*` and let a later stop win a key an earlier one holds, so the breakpoint would never bind (a timeout) or would bind on the wrong file. The freeze asks here, before any process starts, and refuses instead. Called by {@link ConfiguredBrowserRun} when it freezes a browser stop of an App Router app.
 * @param frozen - The entries of the stops frozen so far.
 * @param entry - The entry of the stop being frozen.
 * @returns The conflict, a wildcard character first, then a path another file already holds; `undefined` when every key is free (equal files share a key harmlessly).
 * @example
 * appLibraryPathConflictOf([{ appResolvedPaths: ['/repo/src/core.ts'], checkedOutFile: '/repo/packages/a/src/core.ts' }], { appResolvedPaths: ['/repo/src/core.ts'], checkedOutFile: '/repo/packages/b/src/core.ts' })
 * // => { kind: 'collision', path: '/repo/src/core.ts', otherFile: '/repo/packages/a/src/core.ts' }
 */
export function appLibraryPathConflictOf(
  frozen: readonly LibraryMapEntry[],
  entry: LibraryMapEntry,
): AppLibraryPathConflict | undefined {
  for (const path of entry.appResolvedPaths) {
    if (path.includes('*')) return { kind: 'wildcard', path }
    // A path another file already holds would be silently overwritten.
    const holder = frozen.find(
      (other) =>
        other.checkedOutFile !== entry.checkedOutFile &&
        other.appResolvedPaths.includes(path),
    )
    if (holder)
      return { kind: 'collision', path, otherFile: holder.checkedOutFile }
  }
  return undefined
}

/**
 * Builds the exact `sourceMapPathOverrides` entries that map the paths a nested App Router app's browser maps name onto the checked-out library files.
 *
 * Why it exists: js-debug can bind a breakpoint on the checked-out library file only when the path the map names (a file that does not exist) is mapped onto it. A wildcard key is wrong, because it would map a sibling library file onto the wrong checked-out file (E1 of Cycle 0080 saw react-query's file land on query-core's), so every key is one exact path. Called by {@link ConfiguredBrowserRun} when it launches the owned browser, from the run's frozen stops.
 * @param entries - For each frozen stop, the app-resolved paths ({@link appResolvedPathsOf}) and the checked-out file they lead to.
 * @returns One `{ <app-resolved path>: <checked-out file> }` entry per distinct path. A path with a `*` is left out, since js-debug would read it as a wildcard.
 * @example
 * libraryMapOverrides([{ appResolvedPaths: ['/repo/src/core.ts'], checkedOutFile: '/repo/packages/lib/src/core.ts' }])
 * // => { '/repo/src/core.ts': '/repo/packages/lib/src/core.ts' }
 */
export function libraryMapOverrides(
  entries: readonly LibraryMapEntry[],
): Record<string, string> {
  const overrides: Record<string, string> = {}
  for (const { appResolvedPaths, checkedOutFile } of entries)
    for (const path of appResolvedPaths)
      // A key with a wildcard character would no longer name one file.
      if (!path.includes('*')) overrides[path] = checkedOutFile
  return overrides
}

/** One frozen App Router library stop with the participants that declare a stop at its place. */
type ParticipantLibraryEntry = LibraryMapEntry & {
  participants: ReadonlySet<'browser' | 'server'>
}

/**
 * Builds the exact `sourceMapPathOverrides` entries for one participant's debugger from the frozen stops of a nested App Router app.
 *
 * Why it exists: the owned browser launch and the server attach each map the app-resolved paths of their own library stops onto the checked-out files, and a file only the browser declares must give the server no entry (and the other way round). One function of the frozen entries serves both, so the two sides cannot drift apart. Called by {@link ConfiguredBrowserRun} for the browser launch and for the server attach.
 * @param entries - Every frozen library stop of the app, with the participants that declare a stop there.
 * @param participant - Whose debugger the entries are for.
 * @returns Exact keys only ({@link libraryMapOverrides}), for the stops that name the participant.
 * @example
 * libraryMapOverridesFor([{ appResolvedPaths: ['/repo/src/core.ts'], checkedOutFile: '/repo/packages/lib/src/core.ts', participants: new Set(['server']) }], 'browser')
 * // => {}
 */
export function libraryMapOverridesFor(
  entries: readonly ParticipantLibraryEntry[],
  participant: 'browser' | 'server',
): Record<string, string> {
  return libraryMapOverrides(
    entries.filter((entry) => entry.participants.has(participant)),
  )
}

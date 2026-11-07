import type {
  NodeScriptHistoryEntry,
  NodeScriptHistoryHeader,
} from '../nodeScriptHistorySchemas'

import { describeLibraryObservation } from './describeLibraryObservation'

/**
 * Words the line a Script replay shows under its title for a run that declared a library: whether the script ran on the checked-out library, read from the journal's `library.prepared` and `library.observed` entries.
 * The correspondence sentence appears only for a library the script loaded, observed completely, with no other copy of the package loaded. Every other case says so in its own words, and an observation that is incomplete or unreadable is never worded as "not loaded".
 * Called by {@link buildServerReplayModel} for each script history it opens; a history without `library` (format 1) has no line.
 * @param header - The history's header; only a format 2 header declares a library.
 * @param entries - The verified journal entries.
 * @returns The line, or `undefined` for a run without `library` or one that never recorded its preparation.
 * @example
 * describeLibraryCorrespondence(header, entries)
 * // => 'Ran on the checked-out @reduxjs/toolkit 2.14.0 built from 7114787 (packed by pnpm)'
 */
export function describeLibraryCorrespondence(
  header: NodeScriptHistoryHeader,
  entries: readonly NodeScriptHistoryEntry[],
): string | undefined {
  if (header.formatVersion !== 2) return undefined
  const prepared = entries.find((entry) => entry.type === 'library.prepared')
  // A run that stopped before its pack recorded nothing to state.
  if (!prepared) return undefined
  const observed = entries.find((entry) => entry.type === 'library.observed')
  return describeLibraryObservation({
    package: prepared.package,
    version: prepared.version,
    revision: prepared.revision,
    dirty: prepared.dirty,
    packageManager: prepared.packageManager,
    // A journal with no `library.observed` entry reads as not fully observed, like an incomplete one.
    observation: observed?.observation ?? 'incomplete',
    loaded: observed?.loaded,
    publishedCopyLoaded: observed?.otherCopyLoaded,
    publishedCopyPath: observed?.otherCopyPath,
  })
}

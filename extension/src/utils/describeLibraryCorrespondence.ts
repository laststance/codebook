import type {
  NodeScriptHistoryEntry,
  NodeScriptHistoryHeader,
} from '../nodeScriptHistorySchemas'

/** How many characters of the revision the line shows, as a short Git revision does by default. */
const SHORT_REVISION_CHARS = 7

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
  const built = `${prepared.package} ${prepared.version}`
  // No complete observation: the line must not read a missing or damaged file as "not loaded".
  if (observed?.observation !== 'complete')
    return 'What the script loaded was not fully observed.'
  if (!observed.loaded) return `Built ${built}, but not loaded by this script.`
  const revision = prepared.revision.slice(0, SHORT_REVISION_CHARS)
  const dirty = prepared.dirty ? ' (uncommitted changes)' : ''
  if (observed.otherCopyLoaded)
    return `Built ${built} from ${revision}${dirty}, but the script also loaded another copy at ${observed.otherCopyPath ?? 'an unknown path'}.`
  return `Ran on the checked-out ${built} built from ${revision}${dirty} (packed by ${prepared.packageManager})`
}

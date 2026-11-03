import type {
  NodeServerHistoryEntry,
  NodeServerSourceEntry,
  NodeServerStopEntry,
} from '../nodeServerHistorySchemas'
import {
  replayDebugSnapshotSchema,
  type ReplayDebugSnapshot,
} from '../replayDebugSchemas'

import { maskSavedDebugSnapshot } from './maskSavedDebugSnapshot'
import { maskSavedFacts } from './maskSavedFacts'
import { maskSavedServerEntries } from './maskSavedServerEntries'
import { nodeServerSourceKey } from './nodeServerJournalRules'

/**
 * Restores a stop's full snapshot from the `source` entry its top frame names by hash, so a replay presents the executed text exactly as the debugger captured it, and masks the saved values ({@link maskSavedDebugSnapshot}) so a history saved before the shape rules serves no cookie or credential value.
 * Called by {@link rehydrateNodeServerEntries} for each stop the store's read path returns to a replay, and by the capture evaluator before it judges presentability.
 * @param stop - The stored stop, whose top-frame source text is the empty marker of {@link dehydrateServerStopSnapshot}.
 * @param sources - The journal's `source` entries by {@link nodeServerSourceKey}.
 * @returns The masked snapshot with the top frame's text restored; with the text removed and `sourceUnavailable: 'too large'` set when the source entry holds only a hash; only masked when the top frame names no stored source.
 * @example rehydrateServerStopSnapshot(stop, sources).frames[0]?.source?.text // => 'export const handler = …'
 */
function rehydrateServerStopSnapshot(
  stop: NodeServerStopEntry,
  sources: ReadonlyMap<string, NodeServerSourceEntry>,
): ReplayDebugSnapshot {
  const snapshot = stop.debuggerSnapshot
  const [top, ...lower] = snapshot.frames
  const stored = sources.get(
    nodeServerSourceKey(stop.source.path, stop.source.hash),
  )
  // Only a top frame that names the stop's own hash is restored; a mismatching frame stays as stored and the capture evaluator reports it.
  // The mask runs on every return, the unrestored one included: it never touches the recorded source text.
  if (!top?.source || !stored || top.source.hash !== stop.source.hash)
    return maskSavedDebugSnapshot(snapshot)
  const restored =
    stored.text === undefined
      ? {
          ...top,
          source: undefined,
          sourceUnavailable: stored.sourceUnavailable ?? 'too large',
        }
      : { ...top, source: { ...top.source, text: stored.text } }
  return maskSavedDebugSnapshot(
    replayDebugSnapshotSchema.parse({
      ...snapshot,
      frames: [restored, ...lower],
    }),
  )
}

/**
 * Lists a journal's entries with every stop's snapshot restored and its facts masked again ({@link maskSavedFacts}), and the output, request paths and redirect locations masked again too ({@link maskSavedServerEntries}), which is the one place the read path rehydrates; `source` entries are kept as storage-only entries.
 * @param entries - The verified journal's entries in order.
 * @returns The same entries, each stop carrying its full, masked snapshot and its masked facts, each output, request and response without a credential a history saved before the shape rules kept in it.
 * @example rehydrateNodeServerEntries(history.entries).filter((entry) => entry.type === 'stop')
 */
export function rehydrateNodeServerEntries(
  entries: readonly NodeServerHistoryEntry[],
): NodeServerHistoryEntry[] {
  const sources = new Map<string, NodeServerSourceEntry>()
  return maskSavedServerEntries(entries).map((entry) => {
    if (entry.type === 'source')
      sources.set(nodeServerSourceKey(entry.path, entry.hash), entry)
    if (entry.type !== 'stop') return entry
    return {
      ...entry,
      facts: maskSavedFacts(entry.facts),
      debuggerSnapshot: rehydrateServerStopSnapshot(entry, sources),
    }
  })
}

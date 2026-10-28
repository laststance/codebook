import type { ReplayDebugSnapshot } from '../replayDebugSchemas'

/**
 * Keeps a stop's top-frame source by hash only: the text is stored once in a `source` entry, so sixteen hits of one handler store it once. The text becomes an empty marker that {@link rehydrateServerStopSnapshot} replaces when the history is read.
 * Called by the node-server writer for each stop it appends, after it wrote (or found) the stop's `source` entry.
 * @param snapshot - The run's captured snapshot with its full top-frame source.
 * @returns The snapshot with the top frame's source text emptied; unchanged when the top frame has no source.
 * @example dehydrateServerStopSnapshot(snapshot).frames[0]?.source?.text // => ''
 */
export function dehydrateServerStopSnapshot(
  snapshot: ReplayDebugSnapshot,
): ReplayDebugSnapshot {
  const [top, ...lower] = snapshot.frames
  if (!top?.source) return snapshot
  return {
    ...snapshot,
    frames: [{ ...top, source: { ...top.source, text: '' } }, ...lower],
  }
}

import type { NodeTestHistoryEntry } from '../nodeTestHistorySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

/** A saved Node test stop, the only journal entry that carries captured source and a debugger snapshot. */
type NodeTestHistoryStop = Extract<NodeTestHistoryEntry, { type: 'stop' }>

/** Verdicts per parsed (immutable) journal stop, so every reader publish of the same selected stop hashes its captured text only once. */
const verdicts = new WeakMap<NodeTestHistoryStop, boolean>()

/**
 * Tells whether a saved Node stop's captured source is verified and matches where it stopped, independently of whether the native session shows it.
 *
 * {@link StudyWorkspace.selectNodeHistoryEvent} requires it before presenting the stop natively, and the reader payload uses
 * it so `Recorded source unavailable for this stop.` appears only for a real mismatch, never because the session ended
 * or another recording took the debugger.
 *
 * @param entry - The saved stop from the Node test journal.
 * @returns
 * - `true` when the first frame's captured source has the stop's path, hash and line, its text hashes to that hash, and the frame position matches the stop
 * - `false` otherwise (missing source, edited text or a frame from another position)
 * @example
 * nodeStopSourceMatches(stopAtDataLine217) // => true
 * nodeStopSourceMatches({ ...stopAtDataLine217, source: { ...stopAtDataLine217.source, line: 218 } }) // => false
 */
export function nodeStopSourceMatches(entry: NodeTestHistoryStop): boolean {
  const known = verdicts.get(entry)
  if (known !== undefined) return known
  const verdict = verifyNodeStopSource(entry)
  verdicts.set(entry, verdict)
  return verdict
}

/** Computes the uncached verdict for {@link nodeStopSourceMatches}. @example verifyNodeStopSource(stopAtDataLine217) // => true */
function verifyNodeStopSource(entry: NodeTestHistoryStop): boolean {
  const frame = entry.debuggerSnapshot.frames[0]
  const source = frame?.source
  if (!source) return false
  // Every identity must agree: the captured source with the stop's sealed source, and the debugger frame with the stop's position.
  return [
    source.name === entry.source.path,
    source.hash === entry.source.hash,
    source.line === entry.source.line,
    sha256(source.text) === source.hash,
    entry.frame.line === entry.source.line,
    entry.frame.column === entry.source.column,
    frame.line === entry.frame.line,
    frame.column === entry.frame.column,
  ].every(Boolean)
}

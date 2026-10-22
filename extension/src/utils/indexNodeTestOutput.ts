import type { NodeTestHistoryIndex } from '../nodeTestHistorySchemas'

import { nodeTestOutputLineCost } from './nodeTestOutputLineCost'
import { stripTerminalControls } from './stripTerminalControls'

/** One line of a test's recorded output, as the Application pane shows it: the channel that wrote it and its text without a line end. */
export type NodeTestOutputLine = {
  channel: 'stdout' | 'stderr'
  text: string
}

/**
 * A line the output left unfinished at one entry, as its chunks so far: `chunks` is shared with the later entries that continue the line, and this entry's part of it is its first `chunkCount` chunks, so the index keeps one copy of the line however many entries continue it.
 * `codePoints` counts the code points of those chunks.
 */
export type NodeTestOutputPendingLine = {
  channel: NodeTestOutputLine['channel']
  chunks: readonly string[]
  chunkCount: number
  codePoints: number
}

/** What one output entry leaves behind once it is read: the complete lines so far, the line it left unfinished and the Node inspector lines so far. */
export type NodeTestOutputAfterEntry = {
  lineCount: number
  pending?: NodeTestOutputPendingLine
  inspectorLines: number
}

/**
 * A test replay's recorded output read once into lines, so that showing the output up to any event costs a lookup and its tail ({@link accumulateNodeTestOutput}).
 * `lineTotals[i]` is how many code points `lines[0..i)` take as shown (the `[stderr] ` mark and a line feed included); it has one more element than `lines`.
 */
export type NodeTestOutputIndex = {
  sequences: number[]
  lines: NodeTestOutputLine[]
  lineTotals: number[]
  after: NodeTestOutputAfterEntry[]
}

/** The Node inspector's own lines on standard error; the pane folds them into one muted line with their count instead of dropping them silently. */
const INSPECTOR_LINES = [
  /^Debugger listening on \S+$/,
  // Node's help address changed (Node 24: https://nodejs.org/learn/getting-started/debugging), so any nodejs.org address counts.
  /^For help, see: https:\/\/nodejs\.org\/\S+$/,
  /^Debugger ending on \S+$/,
  /^Debugger attached\.$/,
  /^Waiting for the debugger to disconnect\.\.\.$/,
]

/**
 * Reads a test replay's output entries once into lines, so the Application pane can show the output up to any selected event without reading every entry again (S1-2); called by the Study workspace once per opened test replay.
 * A line-state machine joins the entries: a chunk of the same channel continues an unfinished line, a chunk of the other channel ends it first, terminal controls are removed ({@link stripTerminalControls}) and the Node inspector's own standard-error lines are counted instead of shown.
 * @param entries - The history's events in sequence order; only output entries are read.
 * @returns The index: the output entries' sequences, the complete lines, their running totals and what each output entry leaves behind.
 * @example
 * indexNodeTestOutput([{ type: 'output', sequence: 1, elapsedMs: 5, channel: 'stdout', text: 'RUN\nok' }]).after[0]
 * // => { lineCount: 1, pending: { channel: 'stdout', chunks: ['ok'], chunkCount: 1, codePoints: 2 }, inspectorLines: 0 }
 */
export function indexNodeTestOutput(
  entries: readonly NodeTestHistoryIndex['entries'][number][],
): NodeTestOutputIndex {
  const index: NodeTestOutputIndex = {
    sequences: [],
    lines: [],
    lineTotals: [0],
    after: [],
  }
  /** The unfinished line: its chunks (shared with every entry's record of it) and their code points. */
  let pending:
      | {
          channel: NodeTestOutputLine['channel']
          chunks: string[]
          codePoints: number
        }
      | undefined,
    inspectorLines = 0
  const complete = (line: NodeTestOutputLine): void => {
    if (
      line.channel === 'stderr' &&
      INSPECTOR_LINES.some((pattern) => pattern.test(line.text))
    ) {
      inspectorLines++
      return
    }
    index.lines.push(line)
    index.lineTotals.push(
      index.lineTotals.at(-1)! + nodeTestOutputLineCost(line, true),
    )
  }
  /** Ends the unfinished line: its chunks are joined once, when the line is complete. */
  const completePending = (): void => {
    if (pending)
      complete({ channel: pending.channel, text: pending.chunks.join('') })
    pending = undefined
  }
  /** Adds a part to the unfinished line of a channel, starting the line when there is none. */
  const continuePending = (
    channel: NodeTestOutputLine['channel'],
    part: string,
  ): void => {
    pending ??= { channel, chunks: [], codePoints: 0 }
    // An empty part continues nothing: a chunk that ends with a line feed leaves no unfinished line.
    if (!part) return
    pending.chunks.push(part)
    pending.codePoints += Array.from(part).length
  }
  /** Joins one output chunk to the lines: a chunk of the other channel ends the unfinished line first, so no line mixes the two channels; the first part continues the unfinished line and each later part starts a new one after a line feed. */
  const read = (channel: NodeTestOutputLine['channel'], text: string): void => {
    if (pending && pending.channel !== channel) completePending()
    const parts = text.split('\n')
    continuePending(channel, parts[0]!)
    for (const part of parts.slice(1)) {
      completePending()
      continuePending(channel, part)
    }
    if (pending && !pending.chunks.length) pending = undefined
  }
  for (const entry of entries) {
    if (entry.type !== 'output') continue
    const text = stripTerminalControls(entry.text)
    // A chunk that held only controls changes no line, not even the channel of an unfinished one.
    if (text) read(entry.channel, text)
    index.sequences.push(entry.sequence)
    index.after.push({
      lineCount: index.lines.length,
      ...(pending
        ? {
            pending: {
              channel: pending.channel,
              chunks: pending.chunks,
              chunkCount: pending.chunks.length,
              codePoints: pending.codePoints,
            },
          }
        : {}),
      inspectorLines,
    })
  }
  return index
}

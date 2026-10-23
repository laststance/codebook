import type { NodeTestHistoryIndex } from '../nodeTestHistorySchemas'

import { countCodePoints } from './countCodePoints'
import { isSurrogatePairAt } from './isSurrogatePairAt'
import { nodeTestOutputLineCost } from './nodeTestOutputLineCost'
import { stripTerminalControlsAcross } from './stripTerminalControls'

/** One line of a test's recorded output, as the Application pane shows it: the channel that wrote it and its text without a line end. */
export type NodeTestOutputLine = {
  channel: 'stdout' | 'stderr'
  text: string
}

/**
 * A line the output left unfinished at one entry, as the span of the index's `body` it holds so far: `body.slice(start, end)`; `codePoints` counts the code points of that span.
 * The later entries that continue the line extend the same span, and the index keeps no copy of its text.
 */
export type NodeTestOutputPendingLine = {
  channel: NodeTestOutputLine['channel']
  start: number
  end: number
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
 * The lines are numbers, not objects (F149): `body` is the shown text of every output entry in order, and complete line `i` is `body.slice(lineStarts[i], lineEnds[i])`, written by `lineChannels[i]`; line objects are made only for the kept tail.
 * `lineTotals[i]` is how many code points lines `0..i-1` take as shown (the `[stderr] ` mark and a line feed included); it has one more element than there are lines.
 */
export type NodeTestOutputIndex = {
  sequences: number[]
  body: string
  lineStarts: number[]
  lineEnds: number[]
  lineChannels: NodeTestOutputLine['channel'][]
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
 * A line-state machine joins the entries: a chunk of the same channel continues an unfinished line, a chunk of the other channel ends it first, terminal controls are removed across the entries of each channel ({@link stripTerminalControlsAcross}) and the Node inspector's own standard-error lines are counted instead of shown. Each line is kept as the offsets of its text in one shared body (F149).
 * @param entries - The history's events in sequence order; only output entries are read.
 * @param options - `alreadyShown` for entries whose text is already the shown text, as a history {@link sanitizeNodeTestHistory} made holds: they are not stripped again.
 * @returns The index: the output entries' sequences, the shown text, the complete lines' offsets and channels, their running totals and what each output entry leaves behind.
 * @example
 * indexNodeTestOutput([{ type: 'output', sequence: 1, elapsedMs: 5, channel: 'stdout', text: 'RUN\nok' }]).after[0]
 * // => { lineCount: 1, pending: { channel: 'stdout', start: 4, end: 6, codePoints: 2 }, inspectorLines: 0 }
 */
export function indexNodeTestOutput(
  entries: readonly NodeTestHistoryIndex['entries'][number][],
  options: { alreadyShown?: boolean } = {},
): NodeTestOutputIndex {
  const outputEntries = entries.filter((entry) => entry.type === 'output')
  // A sanitized history's output is shown text already: a second strip would pass over the whole output again for nothing (F315).
  const shownText = options.alreadyShown
    ? new Map(outputEntries.map((entry) => [entry.sequence, entry.text]))
    : stripOutputEntries(entries)
  const body = outputEntries
    .map((entry) => shownText.get(entry.sequence)!)
    .join('')
  const index: NodeTestOutputIndex = {
    sequences: [],
    body,
    lineStarts: [],
    lineEnds: [],
    lineChannels: [],
    lineTotals: [0],
    after: [],
  }
  /** The unfinished line: the span of the body it holds so far. */
  let pending: NodeTestOutputPendingLine | undefined,
    inspectorLines = 0
  const complete = (line: NodeTestOutputPendingLine): void => {
    if (
      line.channel === 'stderr' &&
      INSPECTOR_LINES.some((pattern) =>
        pattern.test(body.slice(line.start, line.end)),
      )
    ) {
      inspectorLines++
      return
    }
    index.lineStarts.push(line.start)
    index.lineEnds.push(line.end)
    index.lineChannels.push(line.channel)
    index.lineTotals.push(
      index.lineTotals.at(-1)! +
        nodeTestOutputLineCost(line.channel, line.codePoints, true),
    )
  }
  /** Ends the unfinished line. */
  const completePending = (): void => {
    if (pending) complete(pending)
    pending = undefined
  }
  /** Adds the span `from..to` of the body to the unfinished line of a channel, starting the line when there is none. */
  const continuePending = (
    channel: NodeTestOutputLine['channel'],
    from: number,
    to: number,
  ): void => {
    const isContinuing = pending !== undefined
    pending ??= { channel, start: from, end: from, codePoints: 0 }
    // An empty part continues nothing: a chunk that ends with a line feed leaves no unfinished line.
    if (to <= from) return
    // A surrogate pair split across two entries is one code point, not two (F291).
    const joinsPair =
      isContinuing && pending.end === from && isSurrogatePairAt(body, from - 1)
    pending.end = to
    pending.codePoints += countCodePoints(body, from, to) - (joinsPair ? 1 : 0)
  }
  /** Joins one output chunk (the span `from..to` of the body) to the lines: a chunk of the other channel ends the unfinished line first, so no line mixes the two channels; the first part continues the unfinished line and each later part starts a new one after a line feed. */
  const read = (
    channel: NodeTestOutputLine['channel'],
    from: number,
    to: number,
  ): void => {
    if (pending && pending.channel !== channel) completePending()
    const text = body.slice(from, to)
    let cursor = 0
    for (;;) {
      const feed = text.indexOf('\n', cursor)
      continuePending(channel, from + cursor, feed === -1 ? to : from + feed)
      if (feed === -1) break
      completePending()
      cursor = feed + 1
    }
    if (pending && pending.end === pending.start) pending = undefined
  }
  let offset = 0
  for (const entry of outputEntries) {
    const from = offset
    offset += shownText.get(entry.sequence)!.length
    // A chunk that held only controls changes no line, not even the channel of an unfinished one.
    if (offset > from) read(entry.channel, from, offset)
    index.sequences.push(entry.sequence)
    index.after.push({
      lineCount: index.lineStarts.length,
      ...(pending ? { pending: { ...pending } } : {}),
      inspectorLines,
    })
  }
  return index
}

/**
 * Removes the terminal controls of every output entry, reading each channel's entries as one stream so a control string split across entries goes whole (F109, F148); called by {@link sanitizeNodeTestHistory} once per opened test replay, and by {@link indexNodeTestOutput} for entries not yet shown.
 * @param entries - The history's events in sequence order; only output entries are read.
 * @returns Each output entry's shown text, by the entry's sequence.
 * @example stripOutputEntries([{ type: 'output', sequence: 1, elapsedMs: 5, channel: 'stdout', text: '\u001b[3' }, { type: 'output', sequence: 2, elapsedMs: 6, channel: 'stdout', text: '2mok' }]) // => Map { 1 => '', 2 => 'ok' }
 */
export function stripOutputEntries(
  entries: readonly NodeTestHistoryIndex['entries'][number][],
): Map<number, string> {
  const shown = new Map<number, string>()
  for (const channel of ['stdout', 'stderr'] as const) {
    const stream = entries.filter(
      (entry) => entry.type === 'output' && entry.channel === channel,
    )
    const stripped = stripTerminalControlsAcross(
      stream.map((entry) => (entry.type === 'output' ? entry.text : '')),
    )
    stream.forEach((entry, position) =>
      shown.set(entry.sequence, stripped[position]!),
    )
  }
  return shown
}

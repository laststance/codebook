import { z } from 'zod'

import type { RecordedEvent } from '../runtimeSupport/evidence'

const journaledLineSchema = z.object({ line: z.number().int().positive() })
// A browser stop's verified binding, written while the stop is armed.
const boundEntrySchema = journaledLineSchema
// A server stop's registration; `movedTo` is present when the adapter acknowledged it on another line.
const registeredEntrySchema = z.object({
  movedTo: journaledLineSchema.optional(),
})
const armedAfterEntrySchema = z.object({ armed: journaledLineSchema })

/** The journal entries that name the line a stop's breakpoint is requested at: the first request when it differs from the declared line, and a second request on the requested line. */
const REQUEST_ENTRY_TYPES = [
  'breakpoint.armed-after-declared-line',
  'breakpoint.rearmed-on-requested-line',
]
/** The journal entries with which the adapter's answer to a request is recorded: a browser stop's verified binding and a server stop's registration. */
const ACKNOWLEDGEMENT_ENTRY_TYPES = [
  'breakpoint.bound',
  'breakpoint.registered',
]

/**
 * Reads the line a browser stop's verified binding names; called by {@link acknowledgedLineOf} for a `breakpoint.bound` entry.
 * @param event - A `breakpoint.bound` entry.
 * @returns The bound line, or `undefined` when the entry names no readable line.
 * @example
 * boundLineOf({ type: 'breakpoint.bound', detail: { verified: true, line: 3, column: 1 }, ... }) // => 3
 */
function boundLineOf(event: RecordedEvent): number | undefined {
  return boundEntrySchema.safeParse(event.detail).data?.line
}

/**
 * Reads the line a server stop's registration says the adapter moved it to; called by {@link acknowledgedLineOf} for a `breakpoint.registered` entry.
 * @param event - A `breakpoint.registered` entry.
 * @returns The line it moved to, or `undefined` when the adapter acknowledged it where it was requested or has not answered yet.
 * @example
 * movedToLineOf({ type: 'breakpoint.registered', detail: { status: 'bound', movedTo: { line: 4 } }, ... }) // => 4
 * movedToLineOf({ type: 'breakpoint.registered', detail: { status: 'bound' }, ... })                       // => undefined
 */
function movedToLineOf(event: RecordedEvent): number | undefined {
  return registeredEntrySchema.safeParse(event.detail).data?.movedTo?.line
}

/**
 * Reads the line an acknowledgement says the stop is bound on; called by {@link plannedStopLine} for the last acknowledgement of the last request.
 * @param event - A `breakpoint.bound` or `breakpoint.registered` entry, or `undefined` when the last request has none yet.
 * @returns
 * - A browser stop's verified binding: its line ({@link boundLineOf})
 * - A server stop's registration: the line the adapter moved it to ({@link movedToLineOf})
 * - `undefined` for a registration on the requested line or a pending one, an entry without a readable line, and no entry: the requested line then stands
 * @example
 * acknowledgedLineOf({ type: 'breakpoint.bound', detail: { verified: true, line: 3, column: 1 }, ... }) // => 3
 * acknowledgedLineOf(undefined)                                                                          // => undefined
 */
function acknowledgedLineOf(
  event: RecordedEvent | undefined,
): number | undefined {
  if (!event) return undefined
  return event.type === 'breakpoint.bound'
    ? boundLineOf(event)
    : movedToLineOf(event)
}

/**
 * Reads from a live run's journal the line its first stop is expected to pause on while that stop has not paused yet, so the Study pane's source highlight starts there instead of on a declared line the debugger cannot pause on; called by {@link StudyWorkspace} when it builds the pane's message for the current run.
 * What the adapter acknowledged for the last request counts first: `breakpoint.bound` of a browser stop, or a `breakpoint.registered` of a server stop that names the line it moved to. A registration on the requested line names no line, and an acknowledgement of an earlier request is not read: a stop requested a second time (`breakpoint.rearmed-on-requested-line`) replaced the breakpoint that acknowledgement answered. Without an acknowledged line, the line of the last request stands (`breakpoint.armed-after-declared-line`, written only when it differs from the declared line, or the second request).
 * @param events - The run's journal in sequence order.
 * @returns
 * - The acknowledged line, else the requested line
 * - `undefined` when the journal names neither (the declared line then stands), and once the first stop was committed, because the pane then shows that observation's own place
 * @example
 * plannedStopLine([{ type: 'breakpoint.armed-after-declared-line', detail: { declared: { line: 1, column: 1 }, armed: { line: 2, column: 1 } }, ... }]) // => 2
 * plannedStopLine([...thoseEvents, { type: 'breakpoint.bound', detail: { verified: true, line: 3, column: 1 }, ... }]) // => 3
 * plannedStopLine([]) // => undefined
 */
export function plannedStopLine(
  events: readonly RecordedEvent[],
): number | undefined {
  if (events.some((event) => event.type === 'snapshot.committed'))
    return undefined
  const lastRequestIndex = events.findLastIndex((event) =>
    REQUEST_ENTRY_TYPES.includes(event.type),
  )
  // Only the answer to the last request counts; without a journaled request every entry is of the one request on the declared line.
  const acknowledged = events
    .slice(lastRequestIndex + 1)
    .findLast((event) => ACKNOWLEDGEMENT_ENTRY_TYPES.includes(event.type))
  return (
    acknowledgedLineOf(acknowledged) ??
    armedAfterEntrySchema.safeParse(events[lastRequestIndex]?.detail).data
      ?.armed.line
  )
}

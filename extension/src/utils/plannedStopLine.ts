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

/**
 * Reads the line a browser stop's verified binding names; called by {@link plannedStopLine} for each `breakpoint.bound` entry.
 * @param event - A `breakpoint.bound` entry.
 * @returns The bound line, or an empty list (which a flat map leaves out) when the entry names no readable line.
 * @example
 * boundLineOf({ type: 'breakpoint.bound', detail: { verified: true, line: 3, column: 1 }, ... }) // => 3
 */
function boundLineOf(event: RecordedEvent): number | [] {
  return boundEntrySchema.safeParse(event.detail).data?.line ?? []
}

/**
 * Reads the line a server stop's registration says the adapter moved it to; called by {@link plannedStopLine} for each `breakpoint.registered` entry.
 * @param event - A `breakpoint.registered` entry.
 * @returns The line it moved to, or an empty list (which a flat map leaves out) when the adapter acknowledged it where it was requested.
 * @example
 * movedToLineOf({ type: 'breakpoint.registered', detail: { status: 'bound', movedTo: { line: 4 } }, ... }) // => 4
 */
function movedToLineOf(event: RecordedEvent): number | [] {
  return registeredEntrySchema.safeParse(event.detail).data?.movedTo?.line ?? []
}

/**
 * Reads from a live run's journal the line its first stop is expected to pause on while that stop has not paused yet, so the Study pane's source highlight starts there instead of on a declared line the debugger cannot pause on; called by {@link StudyWorkspace} when it builds the pane's message for the current run.
 * A binding the adapter acknowledged while the stop was armed counts first: `breakpoint.bound` of a browser stop, or a `breakpoint.registered` of a server stop that names the line it moved to. Without one, the line the breakpoint was requested at stands (`breakpoint.armed-after-declared-line`, written only when it differs from the declared line). The last entry of a kind counts, so a stop requested a second time is read at its final place.
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
  const acknowledgedLines = events.flatMap((event) => {
    if (event.type === 'breakpoint.bound') return boundLineOf(event)
    if (event.type === 'breakpoint.registered') return movedToLineOf(event)
    return []
  })
  const requested = events.findLast(
    (event) => event.type === 'breakpoint.armed-after-declared-line',
  )
  return (
    acknowledgedLines.at(-1) ??
    armedAfterEntrySchema.safeParse(requested?.detail).data?.armed.line
  )
}

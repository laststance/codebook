import { z } from 'zod'

import type { RecordedEvent } from '../runtimeSupport/evidence'

import type { BindingAcknowledgement } from './describeBoundPlace'

const committedSnapshotSchema = z.object({ snapshotId: z.string() })
const journaledPlaceSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive(),
})
const bindingEntrySchema = z.object({ armed: journaledPlaceSchema.optional() })
const registrationEntrySchema = z.object({
  status: z.enum(['pending', 'bound']),
})
const slideEntrySchema = z.object({
  declared: journaledPlaceSchema,
  armed: journaledPlaceSchema.optional(),
  pausableColumn: z.number().int().positive(),
})

/**
 * Finds where in the journal a snapshot was committed; called by {@link journalEntriesOfStop} for the stop's own commit and by {@link previousCommitSequence} for the one before it.
 * @param events - The run's journal in sequence order.
 * @param id - The snapshot's id; `undefined` finds nothing.
 * @returns The sequence number of the snapshot's `snapshot.committed` entry, or `undefined` when the journal holds none.
 * @example
 * commitSequenceOf(view.events, view.snapshots[0].id) // => 12
 */
function commitSequenceOf(
  events: readonly RecordedEvent[],
  id: string | undefined,
): number | undefined {
  return events.find(
    (event) =>
      event.type === 'snapshot.committed' &&
      committedSnapshotSchema.safeParse(event.detail).data?.snapshotId === id,
  )?.sequence
}

/**
 * Finds the commit after which a stop's own journal entries begin; called by {@link journalEntriesOfStop}.
 * @param events - The run's journal in sequence order.
 * @param committedSnapshots - The run's committed snapshots in commit order.
 * @param index - The place of the stop's snapshot among them.
 * @returns The sequence number of the commit of the snapshot before it, or 0 for the first stop and for a snapshot whose commit the journal does not hold.
 * @example
 * previousCommitSequence(view.events, view.snapshots, 0) // => 0
 */
function previousCommitSequence(
  events: readonly RecordedEvent[],
  committedSnapshots: readonly { id: string }[],
  index: number,
): number {
  // A later stop is armed inside the continuation of the stop before it, after that stop's commit.
  return commitSequenceOf(events, committedSnapshots[index - 1]?.id) ?? 0
}

/**
 * Picks the journal entries of one committed snapshot's stop: those between the commit of the snapshot before it and its own commit; called by {@link journaledBindingOfSnapshot}.
 * @param events - The run's journal in sequence order.
 * @param committedSnapshots - The run's committed snapshots in commit order.
 * @param snapshotId - The snapshot whose stop is asked for.
 * @returns The stop's entries in sequence order; none when the snapshot is not among the committed ones or the journal holds no commit for it.
 * @example
 * journalEntriesOfStop(view.events, view.snapshots, view.snapshots[0].id).map((event) => event.type) // => ['breakpoint.bound', 'pause.captured']
 */
function journalEntriesOfStop(
  events: readonly RecordedEvent[],
  committedSnapshots: readonly { id: string }[],
  snapshotId: string,
): RecordedEvent[] {
  const index = committedSnapshots.findIndex(
      (committed) => committed.id === snapshotId,
    ),
    ownCommit = commitSequenceOf(events, snapshotId)
  if (index < 0 || ownCommit === undefined) return []
  const previousCommit = previousCommitSequence(
    events,
    committedSnapshots,
    index,
  )
  return events.filter(
    (event) => event.sequence > previousCommit && event.sequence < ownCommit,
  )
}

/**
 * Reads the requested place a binding entry names; called by {@link journaledBindingOfSnapshot} with the stop's binding entry.
 * @param binding - The stop's last binding entry.
 * @returns The place the breakpoint was requested at, which the entry names only when it differs from the declared one; `undefined` otherwise.
 * @example
 * armedPlaceOf({ type: 'breakpoint.bound', detail: { armed: { line: 2, column: 1 } }, ... }) // => { line: 2, column: 1 }
 */
function armedPlaceOf(
  binding: RecordedEvent,
): z.infer<typeof journaledPlaceSchema> | undefined {
  return bindingEntrySchema.safeParse(binding.detail).data?.armed
}

/**
 * Says whether a server stop's registration was acknowledged as bound while the stop was armed; called by {@link acknowledgementOf} for a binding that was not journaled as `breakpoint.bound`.
 * @param ownEntries - The stop's journal entries.
 * @returns Whether the last `breakpoint.registered` entry has the status `bound`; `false` without such an entry.
 * @example
 * wasRegisteredAsBound([{ type: 'breakpoint.registered', detail: { status: 'pending' }, ... }]) // => false
 */
function wasRegisteredAsBound(ownEntries: readonly RecordedEvent[]): boolean {
  const registration = ownEntries.findLast(
    (event) => event.type === 'breakpoint.registered',
  )
  return (
    registrationEntrySchema.safeParse(registration?.detail).data?.status ===
    'bound'
  )
}

/**
 * Says when the run first knew where the debugger bound a stop; called by {@link journaledBindingOfSnapshot} with the stop's binding entry.
 * @param binding - The stop's last binding entry (`breakpoint.bound` or `breakpoint.pause-binding`).
 * @param ownEntries - The stop's journal entries.
 * @returns
 * - `'before-pause'` for a browser stop (`breakpoint.bound`) and for a server stop whose registration was acknowledged as bound while it was armed
 * - `'at-pause'` for a server stop whose registration was still pending then
 * @example
 * acknowledgementOf({ type: 'breakpoint.bound', ... }, ownEntries) // => 'before-pause'
 */
function acknowledgementOf(
  binding: RecordedEvent,
  ownEntries: readonly RecordedEvent[],
): BindingAcknowledgement {
  const wasAcknowledgedWhileArmed =
    binding.type === 'breakpoint.bound' || wasRegisteredAsBound(ownEntries)
  return wasAcknowledgedWhileArmed ? 'before-pause' : 'at-pause'
}

/**
 * Reads where a stop's requested line can pause, when the run journaled that the binding lies past it; called by {@link journaledBindingOfSnapshot}.
 * @param ownEntries - The stop's journal entries.
 * @returns
 * - The line the breakpoint was requested on (the declared line when no other was requested) and the column the debugger can pause at there
 * - `undefined` when the stop has no readable `breakpoint.slid-past-pausable-line` entry
 * @example
 * pausablePlaceOf(ownEntries) // => { line: 22, column: 3 }
 */
function pausablePlaceOf(
  ownEntries: readonly RecordedEvent[],
): z.infer<typeof journaledPlaceSchema> | undefined {
  // Journaled only when a binding first known at the pause lies past a requested line that can pause.
  const slide = slideEntrySchema.safeParse(
    ownEntries.findLast(
      (event) => event.type === 'breakpoint.slid-past-pausable-line',
    )?.detail,
  ).data
  if (!slide) return undefined
  return {
    line: (slide.armed ?? slide.declared).line,
    column: slide.pausableColumn,
  }
}

/**
 * Reads from a live run's journal where the breakpoint of a committed snapshot's stop was requested and when its binding became known, for {@link StudyService.boundPlace}; the runtime's view holds no stop state, so the journal is the one source of the requested column.
 * The entries of a stop lie between the commit of the snapshot before it and its own commit: a browser stop journals `breakpoint.bound` while it is armed, a server stop `breakpoint.registered` while it is armed and `breakpoint.pause-binding` at its pause. The last binding entry counts, so a stop requested a second time is read at its final place ({@link declaredAndArmedPlace} writes `armed`).
 * @param events - The run's journal in sequence order.
 * @param committedSnapshots - The run's committed snapshots in commit order.
 * @param snapshotId - The snapshot whose stop is asked for.
 * @returns
 * - `armed` when the binding entry names a requested place that differs from the declared one
 * - `acknowledged` `'before-pause'` for a browser stop and for a server stop whose registration was acknowledged as bound while it was armed, `'at-pause'` for a server stop whose registration was still pending then
 * - `pausable` when the run journaled `breakpoint.slid-past-pausable-line` for the stop: the line its breakpoint was requested on and the column the debugger can pause at there, although the binding first known at the pause lies on a later line
 * - an empty object when the journal holds no commit or no binding entry for the snapshot (a saved study, a synthetic runtime)
 * @example
 * journaledBindingOfSnapshot(view.events, view.snapshots, view.snapshots[0].id)
 * // => { armed: { line: 2, column: 1 }, acknowledged: 'before-pause' } for a browser stop declared on an unmapped line 1
 */
export function journaledBindingOfSnapshot(
  events: readonly RecordedEvent[],
  committedSnapshots: readonly { id: string }[],
  snapshotId: string,
): {
  armed?: z.infer<typeof journaledPlaceSchema>
  acknowledged?: BindingAcknowledgement
  pausable?: z.infer<typeof journaledPlaceSchema>
} {
  const ownEntries = journalEntriesOfStop(
      events,
      committedSnapshots,
      snapshotId,
    ),
    binding = ownEntries.findLast(
      (event) =>
        event.type === 'breakpoint.bound' ||
        event.type === 'breakpoint.pause-binding',
    )
  if (!binding) return {}
  const armed = armedPlaceOf(binding),
    pausable = pausablePlaceOf(ownEntries)
  return {
    ...(armed && { armed }),
    acknowledged: acknowledgementOf(binding, ownEntries),
    ...(pausable && { pausable }),
  }
}

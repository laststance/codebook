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
  const commitSequence = (id: string | undefined): number | undefined =>
    events.find(
      (event) =>
        event.type === 'snapshot.committed' &&
        committedSnapshotSchema.safeParse(event.detail).data?.snapshotId === id,
    )?.sequence
  const index = committedSnapshots.findIndex(
      (committed) => committed.id === snapshotId,
    ),
    ownCommit = commitSequence(snapshotId)
  if (index < 0 || ownCommit === undefined) return {}
  // A later stop is armed inside the continuation of the stop before it, after that stop's commit.
  const previousCommit = commitSequence(committedSnapshots[index - 1]?.id) ?? 0
  const ownEntries = events.filter(
      (event) => event.sequence > previousCommit && event.sequence < ownCommit,
    ),
    binding = ownEntries.findLast(
      (event) =>
        event.type === 'breakpoint.bound' ||
        event.type === 'breakpoint.pause-binding',
    )
  if (!binding) return {}
  const armed = bindingEntrySchema.safeParse(binding.detail).data?.armed,
    registration = ownEntries.findLast(
      (event) => event.type === 'breakpoint.registered',
    )
  const wasAcknowledgedWhileArmed =
    binding.type === 'breakpoint.bound' ||
    registrationEntrySchema.safeParse(registration?.detail).data?.status ===
      'bound'
  // Journaled only when a binding first known at the pause lies past a requested line that can pause.
  const slide = slideEntrySchema.safeParse(
    ownEntries.findLast(
      (event) => event.type === 'breakpoint.slid-past-pausable-line',
    )?.detail,
  ).data
  return {
    ...(armed && { armed }),
    acknowledged: wasAcknowledgedWhileArmed ? 'before-pause' : 'at-pause',
    ...(slide && {
      pausable: {
        line: (slide.armed ?? slide.declared).line,
        column: slide.pausableColumn,
      },
    }),
  }
}

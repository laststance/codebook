import type { RuntimeParticipant, RuntimeSnapshot } from '../runtime'

/**
 * Tells whether a participant's live pause is the one a snapshot was captured from; called by {@link showsSnapshotAtItsPause} once the participant shows that snapshot.
 * @param participant - The runtime's current view of one participant.
 * @param snapshot - A committed snapshot of the same run.
 * @returns `true` when the live pause has the snapshot's generation, session and thread; `false` without a live pause or when one of them differs.
 * @example
 * isAtPauseOf({ ...participant, pause: { generation: 2, sessionId: 's1', threadId: 1 } }, snapshot) // => true for a snapshot of generation 2 in session s1, thread 1
 */
function isAtPauseOf(
  participant: RuntimeParticipant,
  snapshot: RuntimeSnapshot,
): boolean {
  return (
    participant.pause?.generation === snapshot.pause.generation &&
    participant.pause.sessionId === snapshot.pause.sessionId &&
    participant.pause.threadId === snapshot.pause.threadId
  )
}

/**
 * Tells whether a paused participant's current snapshot is the given one, at its own pause; called by {@link isPausedAtSnapshot} for a participant that is paused.
 * @param participant - The runtime's current view of one paused participant.
 * @param snapshot - A committed snapshot of the same run.
 * @returns `true` when the participant's current snapshot has this id and its live pause is the snapshot's ({@link isAtPauseOf}); `false` once a later stop replaced the snapshot.
 * @example
 * showsSnapshotAtItsPause(view.participants.browser, snapshot) // => false after a later stop was committed
 */
function showsSnapshotAtItsPause(
  participant: RuntimeParticipant,
  snapshot: RuntimeSnapshot,
): boolean {
  return (
    participant.snapshot?.id === snapshot.id &&
    isAtPauseOf(participant, snapshot)
  )
}

/**
 * Tells whether a participant is still held at the pause a committed snapshot was captured from, so only that pause is continued or revealed.
 * Called by the service when it projects `resumable` and before and after a source reveal.
 * @param participant - The runtime's current view of one participant; undefined when the run has none.
 * @param snapshot - A committed snapshot of the same run.
 * @returns
 * - true while the participant is paused, its current snapshot is this one and its live pause identity equals the snapshot's
 * - false once a continuation was accepted, the debugger resumed, or a later stop replaced the snapshot
 * @example
 * isPausedAtSnapshot(view.participants.browser, snapshot) // => true at the stop
 * isPausedAtSnapshot(view.participants.browser, snapshot) // => false after codebook_continue was accepted
 */
export function isPausedAtSnapshot(
  participant: RuntimeParticipant | undefined,
  snapshot: RuntimeSnapshot,
): boolean {
  return (
    participant?.phase === 'paused' &&
    showsSnapshotAtItsPause(participant, snapshot)
  )
}

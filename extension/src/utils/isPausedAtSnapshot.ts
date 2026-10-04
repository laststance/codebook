import type { RuntimeParticipant, RuntimeSnapshot } from '../runtime'

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
    participant.snapshot?.id === snapshot.id &&
    participant.pause?.generation === snapshot.pause.generation &&
    participant.pause.sessionId === snapshot.pause.sessionId &&
    participant.pause.threadId === snapshot.pause.threadId
  )
}

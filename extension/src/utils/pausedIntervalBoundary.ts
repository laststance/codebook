import { z } from 'zod'

import type { RecordedEvent } from '../runtimeSupport/evidence'

/** The journal events that can end a committed stop's paused interval in the replay. */
const PAUSED_INTERVAL_END_EVENT_TYPES: ReadonlySet<string> = new Set([
  'continue.accepted',
  'cdp.resumed',
  'session.terminated',
  'run.failed',
  'cleanup.started',
])
/** What a `cdp.resumed` entry says about the pause that was resumed; a legacy single-participant entry names no participant. */
const resumedDetailSchema = z.object({
  participant: z.string().optional(),
  generation: z.number().int().optional(),
})

/** The committed stop whose paused interval is asked for: when it was committed and which pause it holds. */
interface PausedObservation {
  elapsedMs: number
  participant?: string
  pause: { generation: number }
}

/**
 * Finds the journal event that ends a committed stop's paused interval, for the replay context built by {@link buildRecordingContext}.
 * A `cdp.resumed` ends it only when it is the resume of that stop's own pause: a resume of the other participant, or of a pause the run never
 * captured (the runtime's instrumentation pause, which names no generation), happens while the learner's stop is still held.
 * @param observation - The committed stop.
 * @param events - The run journal.
 * @returns The earliest ending event at or after the commit, or `undefined` while the stop is still held.
 * @example
 * pausedIntervalBoundary({ elapsedMs: 100, participant: 'server', pause: { generation: 1 } }, events)?.type // => 'continue.accepted'
 */
export function pausedIntervalBoundary(
  observation: PausedObservation,
  events: readonly RecordedEvent[],
): RecordedEvent | undefined {
  return events
    .filter(
      (event) =>
        event.elapsedMs >= observation.elapsedMs &&
        PAUSED_INTERVAL_END_EVENT_TYPES.has(event.type) &&
        (event.type !== 'cdp.resumed' || isResumeOf(observation, event)),
    )
    .sort((left, right) => left.elapsedMs - right.elapsedMs)[0]
}

/** Tells whether a `cdp.resumed` entry resumes the given stop's own pause. @example isResumeOf(serverStop, { type: 'cdp.resumed', detail: { participant: 'browser' } }) // false */
function isResumeOf(
  observation: PausedObservation,
  event: RecordedEvent,
): boolean {
  const detail = resumedDetailSchema.safeParse(event.detail)
  return (
    detail.success &&
    detail.data.generation === observation.pause.generation &&
    (detail.data.participant === undefined ||
      observation.participant === undefined ||
      detail.data.participant === observation.participant)
  )
}

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

/** What a `session.terminated` entry says about the debug session that ended. */
const terminatedDetailSchema = z.object({ sessionId: z.string().optional() })

/** The committed stop whose paused interval is asked for: when it was committed and which pause it holds, in which debug session. */
interface PausedObservation {
  elapsedMs: number
  participant?: string
  pause: { generation: number; sessionId: string }
}

/**
 * Finds the journal event that ends a committed stop's paused interval, for the replay context built by {@link buildRecordingContext}.
 * A `cdp.resumed` ends it only when it is the resume of that stop's own pause: a resume of the other participant, or of a pause the run never
 * captured (the runtime's instrumentation pause, which names no generation), happens while the learner's stop is still held.
 * A `session.terminated` ends it only when it is the end of the session the stop is paused in: the run journals the end of every session it owns,
 * also of a child session that is not the selected one (a worker, the other participant's parent), and the stop stays held through that.
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
        isEndingOfOwnPause(observation, event),
    )
    .sort((left, right) => left.elapsedMs - right.elapsedMs)[0]
}

/**
 * Tells whether an ending event ends the given stop's own pause and not another participant's or another session's; called by {@link pausedIntervalBoundary} for each event that can end a paused interval.
 * @param observation - The committed stop.
 * @param event - A journal event of one of the ending kinds.
 * @returns
 * - `false` for a `cdp.resumed` that is no resume of the stop's pause ({@link isResumeOf}) and for a `session.terminated` of another session ({@link isEndOfSessionOf})
 * - `true` for every other event
 * @example
 * isEndingOfOwnPause(serverStop, { type: 'cdp.resumed', detail: { participant: 'browser' }, ... }) // => false
 * isEndingOfOwnPause(serverStop, { type: 'continue.accepted', detail: {}, ... })                   // => true
 */
function isEndingOfOwnPause(
  observation: PausedObservation,
  event: RecordedEvent,
): boolean {
  return (
    (event.type !== 'cdp.resumed' || isResumeOf(observation, event)) &&
    (event.type !== 'session.terminated' ||
      isEndOfSessionOf(observation, event))
  )
}

/**
 * Tells whether a resume may be of the given stop's participant; called by {@link isResumeOf} for a resume of the stop's pause generation.
 * @param resumed - What the `cdp.resumed` entry says about the resumed pause.
 * @param observation - The committed stop.
 * @returns `true` when the entry names no participant (a legacy single-participant entry), when the stop names none, and when both name the same; `false` for a resume of the other participant.
 * @example
 * isOfParticipant({ participant: 'browser', generation: 1 }, { elapsedMs: 100, participant: 'server', pause }) // => false
 * isOfParticipant({ generation: 1 }, { elapsedMs: 100, participant: 'server', pause })                         // => true
 */
function isOfParticipant(
  resumed: z.infer<typeof resumedDetailSchema>,
  observation: PausedObservation,
): boolean {
  return (
    resumed.participant === undefined ||
    observation.participant === undefined ||
    resumed.participant === observation.participant
  )
}

/**
 * Tells whether a `cdp.resumed` entry resumes the given stop's own pause; called by {@link isEndingOfOwnPause} for each `cdp.resumed` at or after the commit.
 * @param observation - The committed stop.
 * @param event - A `cdp.resumed` journal event.
 * @returns `true` when the entry names the stop's pause generation and no other participant ({@link isOfParticipant}); `false` for a detail that does not parse, a pause the run never captured (no generation) and another participant's resume.
 * @example
 * isResumeOf(serverStop, { type: 'cdp.resumed', detail: { participant: 'browser' } }) // => false
 */
function isResumeOf(
  observation: PausedObservation,
  event: RecordedEvent,
): boolean {
  const detail = resumedDetailSchema.safeParse(event.detail)
  return (
    detail.success &&
    detail.data.generation === observation.pause.generation &&
    isOfParticipant(detail.data, observation)
  )
}

/** Tells whether a `session.terminated` entry is the end of the session the given stop is paused in; an entry that names no session ends the interval, as every such entry did before sessions were compared. @example isEndOfSessionOf(serverStop, { type: 'session.terminated', detail: { sessionId: 'browser-worker' } }) // false */
function isEndOfSessionOf(
  observation: PausedObservation,
  event: RecordedEvent,
): boolean {
  const detail = terminatedDetailSchema.safeParse(event.detail)
  return (
    detail.success &&
    (detail.data.sessionId === undefined ||
      detail.data.sessionId === observation.pause.sessionId)
  )
}

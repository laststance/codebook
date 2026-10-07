import { z } from 'zod'

const stoppedEventSchema = z.object({
  type: z.literal('event'),
  event: z.literal('stopped'),
})

/**
 * Says whether a message a debug adapter sent is its `stopped` event, which the adapter sends when the debugged program stops (a breakpoint, a step, an exception) and never when the learner selects another frame in the Call Stack view; asked by {@link StudyWorkspace}'s debug adapter tracker for every message of every session.
 * The editor reports both to an extension the same way, as a new active stack frame; only this event tells them apart.
 * @param message - A message of the Debug Adapter Protocol as the tracker receives it.
 * @returns `true` for an event named `stopped`; `false` for every other event, for requests and responses, and for what is no message.
 * @example
 * isDebugStoppedEvent({ type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1 } }) // => true
 * isDebugStoppedEvent({ type: 'response', command: 'stackTrace' }) // => false
 */
export function isDebugStoppedEvent(message: unknown): boolean {
  return stoppedEventSchema.safeParse(message).success
}

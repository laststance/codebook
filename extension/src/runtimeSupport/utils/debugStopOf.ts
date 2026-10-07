import { z } from 'zod'

const stoppedEventSchema = z.object({
  type: z.literal('event'),
  event: z.literal('stopped'),
  body: z.object({ reason: z.string().optional() }).optional(),
})

/**
 * Reads a debug adapter's `stopped` event from one of its messages; asked by {@link StudyWorkspace}'s debug adapter tracker for every message of every session.
 * The adapter sends that event when the debugged program stops (a breakpoint, a step, an exception) and never when the learner selects another frame in the Call Stack view, which the editor reports to an extension the same way, as a new active stack frame. The event also says why the program stopped, which tells a stop the learner started (a step) from one that happened by itself.
 * @param message - A message of the Debug Adapter Protocol as the tracker receives it.
 * @returns The stop with the reason the adapter gave (`breakpoint`, `step`, ...; `undefined` when it gave none) for an event named `stopped`; `undefined` for every other event, for requests and responses, and for what is no message.
 * @example
 * debugStopOf({ type: 'event', event: 'stopped', body: { reason: 'step', threadId: 1 } }) // => { reason: 'step' }
 * debugStopOf({ type: 'response', command: 'stackTrace' }) // => undefined
 */
export function debugStopOf(
  message: unknown,
): { reason: string | undefined } | undefined {
  const parsed = stoppedEventSchema.safeParse(message)
  return parsed.success ? { reason: parsed.data.body?.reason } : undefined
}

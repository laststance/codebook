import { z } from 'zod'

import { STOP_HANDLING_INVALIDATION_AREAS } from '../constants'

const invalidatedEventSchema = z.object({
  type: z.literal('event'),
  event: z.literal('invalidated'),
  body: z.object({ areas: z.array(z.string()).optional() }).optional(),
})

/**
 * Says whether a message of a debug adapter makes the editor handle the stops of that session again; asked by {@link StudyWorkspace}'s debug adapter tracker for every message an adapter sends.
 * After an `invalidated` event for the session's threads or stacks, or for everything, both editors fetch the stopped threads again and run their stop handling for each, which opens the paused file with the keyboard and reports a stack frame (VS Code 1.140 and Cursor 3.23, `onDidInvalidated` of their debug sessions). No `stopped` event comes with that frame. An event without areas stands for everything, as both editors read it (`areas||["all"]`). The Debug Adapter Protocol reads an empty list and values it does not understand as everything too, but neither editor does: an empty list and unknown areas only refresh the views, so they do not count here, or the next frame the learner selects would be taken for a stop's.
 * @param message - A message of the Debug Adapter Protocol as the tracker receives it.
 * @returns `true` for an `invalidated` event that names one of {@link STOP_HANDLING_INVALIDATION_AREAS}, or has no list of areas; `false` for one that names other areas only (`variables`, an area the editors do not know) or an empty list, for every other event, for requests and responses, and for what is no message.
 * @example
 * isDebugStopsInvalidation({ type: 'event', event: 'invalidated', body: { areas: ['stacks'] } }) // => true
 * isDebugStopsInvalidation({ type: 'event', event: 'invalidated', body: { areas: ['variables'] } }) // => false
 */
export function isDebugStopsInvalidation(message: unknown): boolean {
  const parsed = invalidatedEventSchema.safeParse(message)
  if (!parsed.success) return false
  const areas = parsed.data.body?.areas ?? ['all']
  return areas.some((area) => STOP_HANDLING_INVALIDATION_AREAS.has(area))
}

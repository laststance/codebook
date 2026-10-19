import { z } from 'zod'

const stackTraceRequestSchema = z.object({
  type: z.literal('request'),
  command: z.literal('stackTrace'),
  seq: z.number(),
  arguments: z.object({
    threadId: z.number(),
    startFrame: z.number().optional(),
  }),
})

/**
 * Reads the editor's `stackTrace` request from a message it sends to a debug adapter; asked by {@link StopKeyboardHandOver} for every message a followed session's tracker sees going to the adapter.
 * The editor asks for the stopped thread's frames right after every stop, the top one first, and picks from the answer the frame it focuses for the stop ({@link editorsPausedFrame}); the answer names its request only by sequence number, so the request is kept until then.
 * @param message - A message of the Debug Adapter Protocol as the tracker receives it.
 * @returns
 * - `{ seq, threadId, startFrame }` for a `stackTrace` request; `startFrame` is 0 when the request names none
 * - `undefined` for every other request, for events and responses, and for what is no message
 * @example
 * stackTraceRequestOf({ type: 'request', seq: 7, command: 'stackTrace', arguments: { threadId: 1, startFrame: 0, levels: 1 } }) // => { seq: 7, threadId: 1, startFrame: 0 }
 * stackTraceRequestOf({ type: 'request', seq: 8, command: 'scopes', arguments: { frameId: 3 } }) // => undefined
 */
export function stackTraceRequestOf(
  message: unknown,
): { seq: number; threadId: number; startFrame: number } | undefined {
  const parsed = stackTraceRequestSchema.safeParse(message)
  if (!parsed.success) return undefined
  return {
    seq: parsed.data.seq,
    threadId: parsed.data.arguments.threadId,
    startFrame: parsed.data.arguments.startFrame ?? 0,
  }
}

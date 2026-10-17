import { z } from 'zod'

const stackFrameSourceSchema = z.object({
  name: z.string().optional(),
  path: z.string().optional(),
  sourceReference: z.number().optional(),
  presentationHint: z.string().optional(),
})

const stackFrameSchema = z.object({
  id: z.number(),
  presentationHint: z.string().optional(),
  source: stackFrameSourceSchema.optional(),
})

const stackTraceResponseSchema = z.object({
  type: z.literal('response'),
  command: z.literal('stackTrace'),
  request_seq: z.number(),
  success: z.literal(true),
  body: z.object({ stackFrames: z.array(stackFrameSchema) }),
})

/** What the reader keeps of one frame of a debug adapter's `stackTrace` answer: its id, its own presentation hint, and its source as the adapter names it. */
export type DebugStackFrameOfAnswer = z.infer<typeof stackFrameSchema>

/**
 * Reads a debug adapter's successful answer to a `stackTrace` request; asked by {@link StopKeyboardHandOver} for every message a followed session's tracker sees coming from the adapter.
 * @param message - A message of the Debug Adapter Protocol as the tracker receives it.
 * @returns
 * - `{ requestSeq, frames }` for a successful `stackTrace` response: the sequence number of the request it answers, and its frames in order
 * - `undefined` for a failed answer, for every other response, for events and requests, and for what is no message
 * @example
 * stackTraceResponseOf({ type: 'response', request_seq: 7, success: true, command: 'stackTrace', body: { stackFrames: [{ id: 1000, name: 'handler', line: 4, column: 3, source: { path: '/app/actions.ts' } }] } }) // => { requestSeq: 7, frames: [{ id: 1000, source: { path: '/app/actions.ts' } }] }
 * stackTraceResponseOf({ type: 'response', request_seq: 7, success: false, command: 'stackTrace' }) // => undefined
 */
export function stackTraceResponseOf(
  message: unknown,
): { requestSeq: number; frames: DebugStackFrameOfAnswer[] } | undefined {
  const parsed = stackTraceResponseSchema.safeParse(message)
  if (!parsed.success) return undefined
  return {
    requestSeq: parsed.data.request_seq,
    frames: parsed.data.body.stackFrames,
  }
}

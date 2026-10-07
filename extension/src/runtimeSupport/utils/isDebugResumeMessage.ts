import { z } from 'zod'

import { RESUME_COMMANDS } from '../constants'

const resumeMessageSchema = z.union([
  z.object({ type: z.literal('event'), event: z.literal('continued') }),
  z.object({ type: z.literal('request'), command: z.string() }),
])

/**
 * Says whether a message of the Debug Adapter Protocol means that the debugged program goes on; asked by {@link StudyWorkspace}'s debug adapter tracker for every message of every session, in both directions.
 * An adapter sends `continued` when the program goes on by itself, and need not send it after a resume or a step the editor asked for, so the editor's request counts as well ({@link RESUME_COMMANDS}).
 * @param message - A message as the tracker receives it, from the adapter or from the editor.
 * @returns `true` for the adapter's `continued` event and for a request whose command resumes or steps; `false` for every other event and request, for responses, and for what is no message.
 * @example
 * isDebugResumeMessage({ type: 'request', command: 'continue', arguments: { threadId: 1 } }) // => true
 * isDebugResumeMessage({ type: 'request', command: 'stackTrace' }) // => false
 */
export function isDebugResumeMessage(message: unknown): boolean {
  const parsed = resumeMessageSchema.safeParse(message)
  if (!parsed.success) return false
  return (
    parsed.data.type === 'event' || RESUME_COMMANDS.has(parsed.data.command)
  )
}

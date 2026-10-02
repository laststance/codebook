import { z } from 'zod'

const thrownWithMessageSchema = z.object({ message: z.string() })

/**
 * Reads the message of a thrown value for the failure texts {@link ConfiguredBrowserRun} composes around it and for the cause {@link LearningLibrary.removeStudy} reports.
 * It checks the shape instead of `instanceof Error`, because a value thrown by a module loaded in another context (the boundary tests do this) is not an `Error` of the caller's realm.
 * @param thrown - Whatever a `catch` clause received.
 * @returns
 * - An object with a string `message`: that message
 * - Anything else: its string form
 * @example
 * thrownMessage(new Error('Timed out waiting for a binding')) // => 'Timed out waiting for a binding'
 * thrownMessage('late')                                       // => 'late'
 */
export function thrownMessage(thrown: unknown): string {
  const parsed = thrownWithMessageSchema.safeParse(thrown)
  return parsed.success ? parsed.data.message : String(thrown)
}

import { z } from 'zod'

import { RESUME_COMMANDS } from './constants'
import type { debugStopOf } from './utils/debugStopOf'

/** A stop as the adapter's `stopped` event reported it ({@link debugStopOf}). */
type DebugStop = NonNullable<ReturnType<typeof debugStopOf>>

const resumeRequestSchema = z.object({
  type: z.literal('request'),
  seq: z.number(),
  command: z.string(),
  arguments: z.object({ threadId: z.number().optional() }).optional(),
})

const resumeResponseSchema = z.object({
  type: z.literal('response'),
  request_seq: z.number(),
  success: z.boolean(),
  body: z.object({ allThreadsContinued: z.boolean().optional() }).nullish(),
})

const continuedEventSchema = z.object({
  type: z.literal('event'),
  event: z.literal('continued'),
  body: z.object({
    threadId: z.number().optional(),
    allThreadsContinued: z.boolean().optional(),
  }),
})

/** The editor's resume or step request that waits for the adapter's answer. */
interface PendingResume {
  command: string
  threadId: number | undefined
}

/**
 * The stops each debug session's adapter reported, kept as both editors keep their details for their stop handling: per thread, until that thread goes on (VS Code 1.142.0 and Cursor 3.23.23 `stoppedDetails` of their debug sessions). An `invalidated` event makes the editor handle the stored stops again, so the reader notes the stop again from {@link lastStopOf} (Cycle 0046 R5).
 * A stored stop is dropped as the editors drop it (Cycle 0046 AD12):
 * - the adapter's `continued` event drops its thread's stop, or every stop of the session unless it says `allThreadsContinued: false`;
 * - the editor's resume or step request ({@link RESUME_COMMANDS}) drops its thread's stop once the adapter answered it with success, and a `continue` drops every stop of the session while the adapter has not said that not all threads go on (the editor's remembered `allThreadsContinued`, true at first);
 * - a request the adapter refused drops nothing, and neither does one answered after a new stop of the session (the editors send no simulated `continued` then: `stoppedSinceLastStep`).
 * Owned by {@link StudyWorkspace}, which feeds it the `stopped` events and every message of a followed session's tracker in both directions, and forgets a session that ended.
 * @example
 * const stops = new StoredDebugStops()
 * stops.noteStop('learner-node', { reason: 'breakpoint', keepsFocus: true, threadId: 1 })
 * stops.readAdaptersMessage('learner-node', { type: 'event', event: 'continued', body: { threadId: 2, allThreadsContinued: false } })
 * stops.lastStopOf('learner-node') // => { reason: 'breakpoint', keepsFocus: true, threadId: 1 }
 */
export class StoredDebugStops {
  /** Each session's stored stops by thread, the latest last. */
  private readonly stops = new Map<string, Map<number | undefined, DebugStop>>()
  /** Each session's pending resume and step requests by sequence number. */
  private readonly pending = new Map<string, Map<number, PendingResume>>()
  /** The sessions whose adapter said that not all threads go on, which the editor remembers for its later `continue` answers. */
  private readonly notAllThreadsContinue = new Set<string>()

  /**
   * Stores a stop the adapter reported, in place of an earlier stop of its thread.
   * @param sessionId - The session that stopped.
   * @param stop - What the adapter's `stopped` event said.
   * @example stops.noteStop('learner-node', { reason: 'step', keepsFocus: false, threadId: 1 })
   */
  noteStop(sessionId: string, stop: DebugStop): void {
    const threads = this.stops.get(sessionId) ?? new Map()
    threads.delete(stop.threadId)
    threads.set(stop.threadId, stop)
    this.stops.set(sessionId, threads)
    // A request answered after a new stop drops nothing: the editors simulate no `continued` for it.
    this.pending.delete(sessionId)
  }

  /**
   * Names the stop the session's adapter reported last among those still stored.
   * @param sessionId - The session.
   * @returns The stop; `undefined` when none is stored.
   * @example stops.lastStopOf('learner-node') // => { reason: 'breakpoint', keepsFocus: true, threadId: 1 }
   */
  lastStopOf(sessionId: string): DebugStop | undefined {
    return [...(this.stops.get(sessionId)?.values() ?? [])].at(-1)
  }

  /**
   * Notes the editor's resume or step request to the session's adapter, whose answer decides what it drops.
   * @param sessionId - The session the message goes to.
   * @param message - The message as the tracker receives it.
   * @example stops.readEditorsMessage('learner-node', { type: 'request', seq: 9, command: 'next', arguments: { threadId: 1 } })
   */
  readEditorsMessage(sessionId: string, message: unknown): void {
    const request = resumeRequestSchema.safeParse(message)
    if (!request.success || !RESUME_COMMANDS.has(request.data.command)) return
    const requests = this.pending.get(sessionId) ?? new Map()
    requests.set(request.data.seq, {
      command: request.data.command,
      threadId: request.data.arguments?.threadId,
    })
    this.pending.set(sessionId, requests)
  }

  /**
   * Drops the stops the adapter's `continued` event or its answer to a noted request ends.
   * @param sessionId - The session the message comes from.
   * @param message - The message as the tracker receives it.
   * @example stops.readAdaptersMessage('learner-node', { type: 'response', request_seq: 9, success: true, command: 'next' })
   */
  readAdaptersMessage(sessionId: string, message: unknown): void {
    const continued = continuedEventSchema.safeParse(message)
    if (continued.success) {
      const allThreads = continued.data.body.allThreadsContinued !== false
      // The editor remembers the adapter's last word on all threads for its later `continue` answers.
      if (allThreads) this.notAllThreadsContinue.delete(sessionId)
      else this.notAllThreadsContinue.add(sessionId)
      this.drop(sessionId, allThreads, continued.data.body.threadId)
      return
    }
    const response = resumeResponseSchema.safeParse(message)
    const request =
      response.success &&
      this.pending.get(sessionId)?.get(response.data.request_seq)
    if (!response.success || !request) return
    this.pending.get(sessionId)?.delete(response.data.request_seq)
    // A refused request leaves every stop stored.
    if (!response.data.success) return
    if (request.command !== 'continue') {
      this.drop(sessionId, false, request.threadId)
      return
    }
    const said = response.data.body?.allThreadsContinued
    if (said === true) this.notAllThreadsContinue.delete(sessionId)
    if (said === false) this.notAllThreadsContinue.add(sessionId)
    this.drop(
      sessionId,
      !this.notAllThreadsContinue.has(sessionId),
      request.threadId,
    )
  }

  /**
   * Forgets everything of a session that ended.
   * @param sessionId - The session.
   * @example stops.forget('learner-node')
   */
  forget(sessionId: string): void {
    this.stops.delete(sessionId)
    this.pending.delete(sessionId)
    this.notAllThreadsContinue.delete(sessionId)
  }

  /**
   * Drops every stop of a session, or one thread's.
   * @param sessionId - The session.
   * @param allThreads - Whether every thread of it goes on.
   * @param threadId - The thread that goes on otherwise.
   * @example this.drop('learner-node', false, 2)
   */
  private drop(
    sessionId: string,
    allThreads: boolean,
    threadId: number | undefined,
  ): void {
    if (allThreads) this.stops.delete(sessionId)
    else this.stops.get(sessionId)?.delete(threadId)
  }
}

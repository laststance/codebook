import type { DebugProtocol } from '@vscode/debugprotocol'

import { RESUME_COMMANDS } from '../runtimeSupport/constants'

/** A resume or step request of a run's debug session that waits for the adapter's answer. */
interface PendingResume {
  /** The request's own sequence number, so a caller can name the request an answer will settle. */
  requestSeq: number
  command: string
  threadId?: number
  singleThread: boolean
  /** The token of the newest stop that existed when the request was sent. */
  newestStopToken?: number
}

/**
 * Tracks a run's resume and step requests until the adapter answers them, so a thread counts as running on only once the adapter accepted the request.
 * Exists because a rejected resume leaves its thread paused; used by the node-server and chrome-extension debuggers, which feed it every request and response their `'*'` trackers see.
 * @example
 * const resumes = new PendingResumeRequests()
 * resumes.noteRequest('session-1', { type: 'request', seq: 7, command: 'continue', arguments: { threadId: 2 } })
 * resumes.takeAnswered('session-1', { type: 'response', seq: 9, request_seq: 7, command: 'continue', success: true, body: { allThreadsContinued: false } })
 * // => { threadId: 2 }
 */
export class PendingResumeRequests {
  /** The waiting requests by `<session id>:<request sequence>`. */
  private readonly pending = new Map<string, PendingResume>()

  /**
   * Remembers a resume or step request of a session; any other request is ignored.
   * @param sessionId - The debug session the request was sent to.
   * @param request - The request the editor sent to the adapter.
   * @param newestStopToken - The token of the newest stop that existed when the request was sent; a debugger that numbers its stops passes it so the answer resumes no later stop.
   */
  noteRequest(
    sessionId: string,
    request: DebugProtocol.Request,
    newestStopToken?: number,
  ): void {
    if (!RESUME_COMMANDS.has(request.command)) return
    const threadId: unknown = request.arguments?.threadId
    this.pending.set(`${sessionId}:${request.seq}`, {
      requestSeq: request.seq,
      command: request.command,
      threadId: typeof threadId === 'number' ? threadId : undefined,
      singleThread: request.arguments?.singleThread === true,
      newestStopToken,
    })
  }

  /**
   * Tells whether a response answers a resume or step request that still waits, so a caller can tell a refused resume from a response to some other request.
   * @param sessionId - The debug session the response came from.
   * @param requestSeq - The `request_seq` of the response.
   * @returns `true` while the request is remembered; call it before {@link takeAnswered}, which forgets the request.
   * @example resumes.isPending('session-1', 7) // => true until takeAnswered('session-1', …) took request 7
   */
  isPending(sessionId: string, requestSeq: number): boolean {
    return this.pending.has(`${sessionId}:${requestSeq}`)
  }

  /**
   * Names the waiting resume or step requests that would let a stop run on once the adapter accepts them: each was sent after the stop arrived, applies to the stop's thread, and the stop is not newer than the request.
   * Why it exists: the learner's Continue is a request in flight for a while, and a stop that arrives meanwhile is judged by the state that Continue is about to produce; the debugger keeps the requests' sequence numbers, so the verdict rests on those answers alone, whatever is sent later. Called by the node-server debugger when a stop arrives.
   * @param sessionId - The debug session of the stop.
   * @param stop - The stop's thread and token.
   * @returns The `seq` of every waiting request of the session that covers the stop (a request noted without a token covers every stop that existed); empty when none does.
   * @example resumes.coveringRequestSeqs('session-1', { threadId: 1, token: 4 }) // => [7] while a continue (seq 7) noted at token 4 waits
   */
  coveringRequestSeqs(
    sessionId: string,
    stop: { threadId: number; token: number },
  ): number[] {
    const prefix = `${sessionId}:`
    const covering: number[] = []
    for (const [key, request] of this.pending) {
      if (!key.startsWith(prefix)) continue
      // A request for one thread (`singleThread`) leaves the others stopped.
      const coversThread =
        !request.singleThread || request.threadId === stop.threadId
      const coversStop =
        request.newestStopToken === undefined ||
        request.newestStopToken >= stop.token
      if (coversThread && coversStop) covering.push(request.requestSeq)
    }
    return covering
  }

  /**
   * Drops every waiting request of a session that ended, since its adapter will never answer them.
   * @param sessionId - The debug session that terminated.
   * @example
   * resumes.forgetSession('session-1')
   */
  forgetSession(sessionId: string): void {
    const prefix = `${sessionId}:`
    for (const key of this.pending.keys())
      if (key.startsWith(prefix)) this.pending.delete(key)
  }

  /**
   * Takes the request a response answers and says which threads ran on.
   * @param sessionId - The debug session the response came from.
   * @param response - The adapter's response.
   * @returns
   * - `undefined` when the response answers no remembered request, or the adapter refused it (the thread stays paused)
   * - `{ threadId: undefined }` when every thread of the session ran on
   * - `{ threadId }` when only that thread ran on
   * - each of the two carries `newestStopToken` when the request was noted with one
   * @example
   * resumes.takeAnswered('session-1', { type: 'response', seq: 4, request_seq: 3, command: 'next', success: true }) // => { threadId: undefined }
   */
  takeAnswered(
    sessionId: string,
    response: DebugProtocol.Response,
  ): { threadId: number | undefined; newestStopToken?: number } | undefined {
    const key = `${sessionId}:${response.request_seq}`
    const pending = this.pending.get(key)
    if (!pending) return undefined
    this.pending.delete(key)
    if (!response.success) return undefined
    // A continue says whether every thread ran on; a step resumes every thread unless it asked for its own only.
    const everyThread =
      pending.command === 'continue'
        ? response.body?.allThreadsContinued !== false
        : !pending.singleThread
    return {
      threadId: everyThread ? undefined : pending.threadId,
      // Only a request noted with a token carries one, so debuggers that number no stops see the shape they always did.
      ...(pending.newestStopToken === undefined
        ? {}
        : { newestStopToken: pending.newestStopToken }),
    }
  }
}

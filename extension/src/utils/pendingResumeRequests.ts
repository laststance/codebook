import type { DebugProtocol } from '@vscode/debugprotocol'

import { RESUME_COMMANDS } from '../runtimeSupport/constants'

/** A resume or step request of a run's debug session that waits for the adapter's answer. */
interface PendingResume {
  command: string
  threadId?: number
  singleThread: boolean
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
   */
  noteRequest(sessionId: string, request: DebugProtocol.Request): void {
    if (!RESUME_COMMANDS.has(request.command)) return
    const threadId: unknown = request.arguments?.threadId
    this.pending.set(`${sessionId}:${request.seq}`, {
      command: request.command,
      threadId: typeof threadId === 'number' ? threadId : undefined,
      singleThread: request.arguments?.singleThread === true,
    })
  }

  /**
   * Takes the request a response answers and says which threads ran on.
   * @param sessionId - The debug session the response came from.
   * @param response - The adapter's response.
   * @returns
   * - `undefined` when the response answers no remembered request, or the adapter refused it (the thread stays paused)
   * - `{ threadId: undefined }` when every thread of the session ran on
   * - `{ threadId }` when only that thread ran on
   * @example
   * resumes.takeAnswered('session-1', { type: 'response', seq: 4, request_seq: 3, command: 'next', success: true }) // => { threadId: undefined }
   */
  takeAnswered(
    sessionId: string,
    response: DebugProtocol.Response,
  ): { threadId: number | undefined } | undefined {
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
    return { threadId: everyThread ? undefined : pending.threadId }
  }
}

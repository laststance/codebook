import {
  NODE_SERVER_HISTORY_CODE_LIMIT_CHARS,
  NODE_SERVER_HISTORY_CONTENT_TYPE_LIMIT_CHARS,
  NODE_SERVER_HISTORY_LOCATION_LIMIT_CHARS,
  NODE_SERVER_HISTORY_MESSAGE_LIMIT_CHARS,
} from './constants'
import {
  NodeRunHistorySinkBase,
  type NodeRunHistorySinkInput,
} from './nodeRunHistorySink'
import type {
  NodeServerDebuggerPause,
  NodeServerStopCapture as NodeServerDebuggerCapture,
} from './nodeServerDebugger'
import type { NodeServerHistoryWriter } from './nodeServerHistoryWriter'
import type { NodeServerResponse } from './runtime'
import { cutTextToLength } from './utils/cutTextToLength'

/**
 * What a live node-server run tells its history, in the run's own words and on the run's own clock (milliseconds since the launch). The run calls it synchronously at the moment each thing happens and never waits for it; a sink that fails marks its history failed and never reaches the run.
 * Implemented by {@link NodeServerHistorySinkImpl}; the run ({@link createOwnedNodeServerRun}) holds the interface only.
 */
export interface NodeServerHistorySink {
  /** The request window opened: Codebook is about to send the declared request (one attempt). */
  openRequest(
    elapsedMs: number,
    request: { method: string; path: string; bodyBytes: number },
  ): void
  /** The open attempt was refused before its bytes left, so the run may try again. */
  withdrawRequest(elapsedMs: number, code: string): void
  /** The open attempt's bytes were handed to the socket. */
  markRequestSent(elapsedMs: number): void
  /** The server printed a chunk, already through the run's output redactor. */
  output(elapsedMs: number, channel: 'stdout' | 'stderr', text: string): void
  /** The run captured one hit of a declared stop inside the request window. */
  stop(
    elapsedMs: number,
    pause: Pick<NodeServerDebuggerPause, 'declaredStopIndex'>,
    generation: number,
    read: NodeServerDebuggerCapture,
  ): void
  /** The response arrived. */
  response(elapsedMs: number, response: NodeServerResponse): void
  /** The request failed; the run, the server and the debugger go on. */
  failRequest(elapsedMs: number, code: string, message: string): void
  /** The run refused a hit beyond its capture budget. */
  markCaptureBudgetExhausted(): void
}

/** What {@link NodeServerHistorySinkImpl} needs from outside. */
export type NodeServerHistorySinkInput =
  NodeRunHistorySinkInput<NodeServerHistoryWriter>

/**
 * Turns what a node-server run reports into the entries of its history: request attempts and their marks, coalesced and redacted output, hash-checked captures, the response exactly as the live run shows it and the request's duration, all on one monotonic clock, in the order the journal's rules accept.
 * Every text is hidden of private roots and masked before it is queued, so nothing the live run would not show reaches a file. A fault of the sink, or an entry the rules would refuse, marks the writer failed and goes no further: the live run is never touched, and the seal reads partial with the cause.
 * Created by {@link StudyService} for each node-server run whose history started, and handed to the run through {@link StudyEnvironment.createNodeServerRun}; sealing goes through the seal coordinator, which calls {@link NodeServerHistorySinkImpl.flush} first.
 * @example
 * const sink = new NodeServerHistorySinkImpl({ writer, sanitize })
 * sink.openRequest(40, { method: 'GET', path: '/api/healthz', bodyBytes: 0 })
 */
export class NodeServerHistorySinkImpl
  extends NodeRunHistorySinkBase<NodeServerHistoryWriter>
  implements NodeServerHistorySink
{
  private attempts = 0
  private openAttempt?: number
  private sentMarked = false
  private terminal = false

  /** The server writer, typed concretely so its request methods are traced to this sink. */
  private get serverWriter(): NodeServerHistoryWriter {
    return this.input.writer
  }

  openRequest(
    elapsedMs: number,
    request: { method: string; path: string; bodyBytes: number },
  ): void {
    this.guard(() => {
      const at = this.structural(elapsedMs)
      // A second window while one is open, or after the terminal entry, would break the rules: the run opens one at a time, so this only guards a fault.
      this.attempts++
      this.openAttempt = this.attempts
      this.sentMarked = false
      return this.serverWriter.appendRequest({
        elapsedMs: at,
        attempt: this.attempts,
        method: request.method as 'GET',
        path: cutTextToLength(
          this.hide(request.path),
          NODE_SERVER_HISTORY_LOCATION_LIMIT_CHARS,
        ),
        bodyBytes: request.bodyBytes,
      })
    })
  }

  withdrawRequest(elapsedMs: number, code: string): void {
    this.guard(() => {
      // Mirrors the journal's rules: nothing is withdrawn once the request is terminal or its bytes were sent; such a late report is dropped, not a fault.
      if (this.terminal || this.sentMarked) return
      const at = this.structural(elapsedMs)
      const attempt = this.openAttempt
      if (attempt === undefined) return
      this.openAttempt = undefined
      return this.serverWriter.appendRequestWithdrawn({
        elapsedMs: at,
        attempt,
        code:
          cutTextToLength(
            this.hide(code),
            NODE_SERVER_HISTORY_CODE_LIMIT_CHARS,
          ) || 'REQUEST_WITHDRAWN',
      })
    })
  }

  markRequestSent(elapsedMs: number): void {
    this.guard(() => {
      // A mark after the terminal entry is a late report, not a fault.
      if (this.terminal) return
      const at = this.structural(elapsedMs)
      return this.sendMark(at)
    })
  }

  stop(
    elapsedMs: number,
    pause: Pick<NodeServerDebuggerPause, 'declaredStopIndex'>,
    generation: number,
    read: NodeServerDebuggerCapture,
  ): void {
    this.guard(() => {
      // A capture that finishes after the answer (or the failure) was recorded is a late hit, not a fault: it is not written and the history stays whole; a declared stop with no recorded hit keeps its own reason at the seal.
      if (this.terminal) return
      const at = this.structural(elapsedMs)
      // After a withdrawal the run may still report a capture of that window: a late hit, dropped like one after the answer.
      if (this.openAttempt === undefined && this.attempts > 0) return
      // A stop the journal's rules cannot place (no request at all) is no entry: the writer is marked failed, so the seal says where the history ended.
      if (this.openAttempt === undefined)
        throw new Error('A stop was captured outside an open request.')
      return this.captureStop(at, pause, generation, read)
    })
  }

  response(elapsedMs: number, response: NodeServerResponse): void {
    this.guard(() => {
      // A second answer, or one after a failure, is a late report: dropped, never a fault.
      if (this.terminal) return
      const at = this.structural(elapsedMs)
      // The mark comes first when the bytes were handed over a moment before the report of it reached the sink.
      const mark = this.sendMark(at)
      this.terminal = true
      const answer = this.serverWriter.appendResponse({
        elapsedMs: at,
        status: response.status,
        contentType:
          response.contentType === undefined
            ? null
            : cutTextToLength(
                this.hide(response.contentType),
                NODE_SERVER_HISTORY_CONTENT_TYPE_LIMIT_CHARS,
              ),
        body: this.hide(response.body),
        bodyBytes: response.bodyBytes,
        readCut: response.readCut,
        location:
          response.location === undefined
            ? null
            : cutTextToLength(
                this.hide(response.location),
                NODE_SERVER_HISTORY_LOCATION_LIMIT_CHARS,
              ),
        requestDurationMs: response.elapsedMs,
      })
      return mark ? Promise.all([mark, answer]).then(() => undefined) : answer
    })
  }

  failRequest(elapsedMs: number, code: string, message: string): void {
    this.guard(() => {
      // A second failure, or one after the answer, is a late report: dropped, never a fault.
      if (this.terminal) return
      const at = this.structural(elapsedMs)
      this.terminal = true
      // The failure closes the open attempt, as the journal's rules do.
      this.openAttempt = undefined
      this.sentMarked = false
      return this.serverWriter.appendRequestFailed({
        elapsedMs: at,
        code:
          cutTextToLength(
            this.hide(code),
            NODE_SERVER_HISTORY_CODE_LIMIT_CHARS,
          ) || 'REQUEST_FAILED',
        message: cutTextToLength(
          this.hide(message),
          NODE_SERVER_HISTORY_MESSAGE_LIMIT_CHARS,
        ),
      })
    })
  }

  /** Queues the mark that the open attempt's bytes left, once; `undefined` when there is none to write. */
  private sendMark(at: number): Promise<void> | undefined {
    const attempt = this.openAttempt
    if (attempt === undefined || this.sentMarked) return undefined
    this.sentMarked = true
    return this.serverWriter.appendRequestSent({ elapsedMs: at, attempt })
  }
}

import {
  NODE_SERVER_OUTPUT_COALESCE_MS,
  NODE_SERVER_OUTPUT_TEXT_LIMIT_CHARS,
} from './constants'
import type {
  NodeServerDebuggerPause,
  NodeServerStopCapture as NodeServerDebuggerCapture,
} from './nodeServerDebugger'
import type { NodeServerHistoryWriter } from './nodeServerHistoryWriter'
import type { ReplayDebugSnapshot } from './replayDebugSchemas'
import type { NodeServerResponse } from './runtime'
import { redactSecretText } from './utils/redactSecretText'
import { resolveServerStopFrame } from './utils/resolveServerStopFrame'

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
export type NodeServerHistorySinkInput = {
  writer: NodeServerHistoryWriter
  /** Hides the private roots of a text (the service's storage, the workspace, the home directory); applied to every recorded text before it is masked. */
  sanitize: (text: string) => string
  /** Runs `callback` once after `ms` and returns what cancels it; a test replaces the timer. */
  schedule?: (callback: () => void, ms: number) => () => void
  /** Told once, with the first fault of the sink itself (not a refused append, which the writer already holds). */
  onFault?: (error: unknown) => void
}

/** One output chunk run waiting to become an entry. */
type PendingOutput = {
  channel: 'stdout' | 'stderr'
  /** The chunks so far, private roots hidden, secrets not yet masked: masking waits for the whole run so a secret split between two chunks is still seen whole. */
  text: string
  /** The time of its first chunk, the entry's time. */
  at: number
  /** The time of its latest chunk, which the next chunk is measured from. */
  lastAt: number
}

/**
 * Masks the secret-shaped texts a captured snapshot carries (frame names, variable names and values, limitations) as a last line of defence before it is stored; the executed source text is the learner's own and stays as it ran.
 * @param snapshot - The run's captured snapshot.
 * @returns A copy with every such text masked.
 * @example maskSnapshot(snapshot).frames[0]?.name // => 'handler Bearer [masked]'
 */
function maskSnapshot(snapshot: ReplayDebugSnapshot): ReplayDebugSnapshot {
  return {
    ...snapshot,
    frames: snapshot.frames.map((frame) => ({
      ...frame,
      name: redactSecretText(frame.name),
    })),
    variables: snapshot.variables.map((variable) => ({
      ...variable,
      name: redactSecretText(variable.name),
      value: redactSecretText(variable.value),
    })),
    limitations: snapshot.limitations.map(redactSecretText),
  }
}

/** The default timer: a real one that never keeps the process alive. */
function realSchedule(callback: () => void, ms: number): () => void {
  const timer = setTimeout(callback, ms)
  timer.unref()
  return (): void => clearTimeout(timer)
}

/**
 * Turns what a node-server run reports into the entries of its history: request attempts and their marks, coalesced and redacted output, hash-checked captures, the response exactly as the live run shows it and the request's duration, all on one monotonic clock, in the order the journal's rules accept.
 * Every text is hidden of private roots and masked before it is queued, so nothing the live run would not show reaches a file. A fault of the sink, or an entry the rules would refuse, marks the writer failed and goes no further: the live run is never touched, and the seal reads partial with the cause.
 * Created by {@link StudyService} for each node-server run whose history started, and handed to the run through {@link StudyEnvironment.createNodeServerRun}; sealing goes through the seal coordinator, which calls {@link NodeServerHistorySinkImpl.flush} first.
 * @example
 * const sink = new NodeServerHistorySinkImpl({ writer, sanitize })
 * sink.openRequest(40, { method: 'GET', path: '/api/healthz', bodyBytes: 0 })
 */
export class NodeServerHistorySinkImpl implements NodeServerHistorySink {
  private readonly schedule: NonNullable<NodeServerHistorySinkInput['schedule']>
  /** The latest time any entry carried: the clock never moves back, whatever order the run's reports arrive in. */
  private lastMs = 0
  private pendingOutput?: PendingOutput
  private cancelFlush?: () => void
  private attempts = 0
  private openAttempt?: number
  private sentMarked = false
  private terminal = false
  private readonly hits = new Map<number, number>()
  private faulted = false

  constructor(private readonly input: NodeServerHistorySinkInput) {
    this.schedule = input.schedule ?? realSchedule
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
      return this.input.writer.appendRequest({
        elapsedMs: at,
        attempt: this.attempts,
        method: request.method as 'GET',
        path: this.hide(request.path),
        bodyBytes: request.bodyBytes,
      })
    })
  }

  withdrawRequest(elapsedMs: number, code: string): void {
    this.guard(() => {
      const at = this.structural(elapsedMs)
      const attempt = this.openAttempt
      if (attempt === undefined) return
      this.openAttempt = undefined
      return this.input.writer.appendRequestWithdrawn({
        elapsedMs: at,
        attempt,
        code: this.hide(code).slice(0, 128) || 'REQUEST_WITHDRAWN',
      })
    })
  }

  markRequestSent(elapsedMs: number): void {
    this.guard(() => {
      const at = this.structural(elapsedMs)
      return this.sendMark(at)
    })
  }

  output(elapsedMs: number, channel: 'stdout' | 'stderr', text: string): void {
    this.guard(() => {
      const at = this.tick(elapsedMs)
      const raw = this.input.sanitize(text)
      if (!raw) return
      const pending = this.pendingOutput
      // Chunks of one channel within the coalescing window join one entry, up to the entry's own bound.
      if (
        pending &&
        pending.channel === channel &&
        at - pending.lastAt <= NODE_SERVER_OUTPUT_COALESCE_MS &&
        pending.text.length + raw.length <= NODE_SERVER_OUTPUT_TEXT_LIMIT_CHARS
      ) {
        pending.text += raw
        pending.lastAt = at
        return
      }
      this.flushOutput()
      this.pendingOutput = { channel, text: raw, at, lastAt: at }
      this.cancelFlush = this.schedule(
        () => this.guard(() => this.flushOutput()),
        NODE_SERVER_OUTPUT_COALESCE_MS,
      )
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
      // A stop the journal's rules cannot place (no open request) is no entry: the writer is marked failed, so the seal says where the history ended.
      if (this.openAttempt === undefined)
        throw new Error('A stop was captured outside an open request.')
      const index = pause.declaredStopIndex ?? 0
      const hit = (this.hits.get(index) ?? 0) + 1
      this.hits.set(index, hit)
      const { column, frameName } = resolveServerStopFrame(read)
      const facts = Object.fromEntries(
        read.facts.map((fact) => [
          this.hide(`${fact.mode}:${fact.path}`),
          this.hide(fact.display),
        ]),
      )
      return this.input.writer.appendStop({
        elapsedMs: at,
        declaredStopIndex: index,
        hit,
        generation,
        source: {
          path: read.path,
          hash: read.sourceHash,
          line: read.line,
          column,
        },
        frameName: this.hide(frameName).slice(0, 2_048),
        facts,
        unavailable: read.unavailable.map((path) => ({
          path: this.hide(path).slice(0, 512),
          reason:
            'The debugger could not read this required value at the stop.',
        })),
        snapshot: maskSnapshot(read.snapshot),
      })
    })
  }

  response(elapsedMs: number, response: NodeServerResponse): void {
    this.guard(() => {
      const at = this.structural(elapsedMs)
      // The mark comes first when the bytes were handed over a moment before the report of it reached the sink.
      const mark = this.sendMark(at)
      this.terminal = true
      const answer = this.input.writer.appendResponse({
        elapsedMs: at,
        status: response.status,
        contentType:
          response.contentType === undefined
            ? null
            : this.hide(response.contentType).slice(0, 256),
        body: this.hide(response.body),
        bodyBytes: response.bodyBytes,
        readCut: response.readCut,
        location:
          response.location === undefined
            ? null
            : this.hide(response.location).slice(0, 2_048),
        requestDurationMs: response.elapsedMs,
      })
      return mark ? Promise.all([mark, answer]).then(() => undefined) : answer
    })
  }

  failRequest(elapsedMs: number, code: string, message: string): void {
    this.guard(() => {
      const at = this.structural(elapsedMs)
      this.terminal = true
      return this.input.writer.appendRequestFailed({
        elapsedMs: at,
        code: this.hide(code).slice(0, 128) || 'REQUEST_FAILED',
        message: this.hide(message).slice(0, 2_048),
      })
    })
  }

  markCaptureBudgetExhausted(): void {
    this.guard(() => this.input.writer.markCaptureBudgetExhausted())
  }

  /**
   * Queues the output still waiting to be coalesced, so the seal's `end` follows it; called by the seal coordinator before it seals and before every structural entry.
   * @example sink.flush()
   */
  flush(): void {
    this.guard(() => this.flushOutput())
  }

  /** Hides private roots, then masks secrets, in one text. */
  private hide(text: string): string {
    return redactSecretText(this.input.sanitize(text))
  }

  /** Advances the one clock and returns the time an entry carries. */
  private tick(elapsedMs: number): number {
    this.lastMs = Math.max(
      this.lastMs,
      Number.isFinite(elapsedMs) ? elapsedMs : 0,
    )
    return this.lastMs
  }

  /** The time of a structural entry, after the output that came before it was queued: structural entries are never coalesced and keep the journal's order. */
  private structural(elapsedMs: number): number {
    this.flushOutput()
    return this.tick(elapsedMs)
  }

  /** Queues the mark that the open attempt's bytes left, once; `undefined` when there is none to write. */
  private sendMark(at: number): Promise<void> | undefined {
    const attempt = this.openAttempt
    if (attempt === undefined || this.sentMarked) return undefined
    this.sentMarked = true
    return this.input.writer.appendRequestSent({ elapsedMs: at, attempt })
  }

  /** Masks the waiting output as one text and queues it in entries of at most the entry's bound. */
  private flushOutput(): void {
    const pending = this.pendingOutput
    this.pendingOutput = undefined
    this.cancelFlush?.()
    this.cancelFlush = undefined
    if (!pending) return
    const text = redactSecretText(pending.text)
    for (
      let start = 0;
      start < text.length;
      start += NODE_SERVER_OUTPUT_TEXT_LIMIT_CHARS
    )
      this.watch(
        this.input.writer.appendOutput({
          elapsedMs: pending.at,
          channel: pending.channel,
          text: text.slice(start, start + NODE_SERVER_OUTPUT_TEXT_LIMIT_CHARS),
        }),
      )
  }

  /** Runs one report: a throw or a rejection marks the writer failed and goes no further. */
  private guard(action: () => Promise<void> | void): void {
    try {
      this.watch(action())
    } catch (error) {
      this.fault(error)
    }
  }

  /** Keeps a queued entry's refusal from reaching anyone: the writer already holds its first failure. */
  private watch(queued: Promise<void> | void): void {
    if (queued) queued.catch(() => undefined)
  }

  /** Marks the writer failed with the sink's own fault, once. */
  private fault(error: unknown): void {
    this.input.writer.markFailed(
      error instanceof Error ? error : new Error(String(error)),
    )
    if (this.faulted) return
    this.faulted = true
    try {
      this.input.onFault?.(error)
    } catch {
      // The listener failing is its own matter.
    }
  }
}

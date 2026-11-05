import {
  NODE_SERVER_HISTORY_FRAME_NAME_LIMIT_CHARS,
  NODE_SERVER_HISTORY_UNAVAILABLE_PATH_LIMIT_CHARS,
  NODE_SERVER_OUTPUT_COALESCE_MS,
  NODE_SERVER_OUTPUT_TEXT_LIMIT_CHARS,
} from './constants'
import type { NodeRunWriterStop } from './nodeRunHistoryEvidence'
import type {
  NodeServerDebuggerPause,
  NodeServerStopCapture as NodeServerDebuggerCapture,
} from './nodeServerDebugger'
import type { ReplayDebugSnapshot } from './replayDebugSchemas'
import { cutTextToLength } from './utils/cutTextToLength'
import { hideTrailingRootPrefix } from './utils/hideTrailingRootPrefix'
import { maskSavedDebugSnapshot } from './utils/maskSavedDebugSnapshot'
import { maskSavedFacts } from './utils/maskSavedFacts'
import { redactSecretText } from './utils/redactSecretText'
import { resolveServerStopFrame } from './utils/resolveServerStopFrame'
import type { CauseRoots } from './utils/sanitizeCause'

/** What a history sink needs of a node run's writer, whatever its profile: output, stops, the capture budget and the failure mark. */
export interface NodeRunHistoryWriterPort {
  /** Whether output is dropped for good (cut, failed or closed). */
  readonly outputCut: boolean
  appendOutput(event: {
    elapsedMs: number
    channel: 'stdout' | 'stderr'
    text: string
  }): Promise<void>
  appendStop(capture: NodeRunWriterStop): Promise<void>
  markCaptureBudgetExhausted(): void
  markFailed(error: Error): void
}

/** What a node run's history sink needs from outside. */
export type NodeRunHistorySinkInput<Writer extends NodeRunHistoryWriterPort> = {
  writer: Writer
  /** Hides the private roots of a text (the service's storage, the workspace, the home directory); applied to every recorded text before it is masked. */
  sanitize: (text: string) => string
  /** The private roots behind `sanitize`, frozen for this run (the one snapshot the run's output stage and response sanitizer hide with too): a debugger text the capture cut inside a root is hidden by them, since `sanitize` cannot match a fragment. Every private root the service knows lies under the home root or is a workspace or storage root known at the start; a folder added mid-run is hidden from the next run on. */
  roots?: CauseRoots
  /** Runs `callback` once after `ms` and returns what cancels it; a test replaces the timer. */
  schedule?: (callback: () => void, ms: number) => () => void
  /** Told once, with the first fault of the sink itself (not a refused append, which the writer already holds). */
  onFault?: (error: unknown) => void
  /** Told once, when the first queued entry is refused or fails or the sink itself faults, so the status item says at once that recording stopped. */
  onAppendFailed?: () => void
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
 * Hides private roots and masks secrets in every free text a captured snapshot carries (frame, scope and variable names, values, types, unavailable reasons, source names, recorded caller locations, limitations) before it is stored; the executed source text is the learner's own and stays as it ran.
 * @param snapshot - The run's captured snapshot.
 * @param hide - Hides private roots, then masks secrets, in one text ({@link NodeRunHistorySinkBase}'s own).
 * @returns A copy with every such text hidden and masked.
 * @example maskSnapshot(snapshot, hide).frames[0]?.name // => 'handler Bearer [masked]'
 */
function maskSnapshot(
  snapshot: ReplayDebugSnapshot,
  hide: (text: string) => string,
): ReplayDebugSnapshot {
  return {
    ...snapshot,
    frames: snapshot.frames.map((frame) => ({
      ...frame,
      name: hide(frame.name),
      // An absent optional text stays absent.
      ...(frame.source
        ? { source: { ...frame.source, name: hide(frame.source.name) } }
        : {}),
      ...(frame.sourceUnavailable === undefined
        ? {}
        : { sourceUnavailable: hide(frame.sourceUnavailable) }),
      // A caller frame's recorded location is the debugger's own text: its name and path lose private roots like every other captured path.
      ...(frame.recordedLocation
        ? {
            recordedLocation: {
              name: hide(frame.recordedLocation.name),
              ...(frame.recordedLocation.path === undefined
                ? {}
                : { path: hide(frame.recordedLocation.path) }),
            },
          }
        : {}),
      ...(frame.unavailable === undefined
        ? {}
        : { unavailable: hide(frame.unavailable) }),
      scopes: frame.scopes.map((scope) => ({
        ...scope,
        name: hide(scope.name),
        ...(scope.unavailable === undefined
          ? {}
          : { unavailable: hide(scope.unavailable) }),
      })),
    })),
    variables: snapshot.variables.map((variable) => ({
      ...variable,
      name: hide(variable.name),
      value: hide(variable.value),
      ...(variable.type === undefined ? {} : { type: hide(variable.type) }),
      ...(variable.unavailable === undefined
        ? {}
        : { unavailable: hide(variable.unavailable) }),
    })),
    limitations: snapshot.limitations.map(hide),
  }
}

/** The default timer: a real one that never keeps the process alive. */
function realSchedule(callback: () => void, ms: number): () => void {
  const timer = setTimeout(callback, ms)
  timer.unref()
  return (): void => clearTimeout(timer)
}

/**
 * The part of a node run's history sink every profile shares: one monotonic clock, coalesced and redacted output, hash-checked and masked stop captures, the capture-budget mark, and the guard that keeps a fault of the sink away from the live run.
 * The node-server sink adds the request; the node-script sink adds the end. Every text is hidden of private roots and masked before it is queued, so nothing the live run would not show reaches a file.
 * @example class MySink extends NodeRunHistorySinkBase<MyWriter> { … }
 */
export abstract class NodeRunHistorySinkBase<
  Writer extends NodeRunHistoryWriterPort,
> {
  private readonly schedule: NonNullable<
    NodeRunHistorySinkInput<Writer>['schedule']
  >
  /** The latest time any entry carried: the clock never moves back, whatever order the run's reports arrive in. */
  private lastMs = 0
  private pendingOutput?: PendingOutput
  private cancelFlush?: () => void
  private readonly hits = new Map<number, number>()
  private faulted = false
  /** Whether {@link NodeRunHistorySinkInput.onAppendFailed} was told. */
  private appendFailureReported = false

  constructor(protected readonly input: NodeRunHistorySinkInput<Writer>) {
    this.schedule = input.schedule ?? realSchedule
  }

  /**
   * Takes the chunk a run printed, already through its output redactor; chunks of one channel within the coalescing window join one entry.
   * @param elapsedMs - Milliseconds since the launch.
   * @param channel - The stream the chunk came from.
   * @param text - The chunk.
   * @example sink.output(120, 'stdout', 'listening\n')
   */
  output(elapsedMs: number, channel: 'stdout' | 'stderr', text: string): void {
    this.guard(() => {
      // Once the writer drops output for good (cut, failed or closed), no later chunk is sanitized, queued or scheduled.
      if (this.input.writer.outputCut) {
        this.pendingOutput = undefined
        this.cancelFlush?.()
        this.cancelFlush = undefined
        return
      }
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

  /** The run refused a hit beyond its capture budget. */
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

  /**
   * Records one captured hit of a declared stop: counts the declared stop's hits, hides and masks every text, and queues the stop with its source.
   * @param at - The entry's time, from {@link structural}.
   * @param pause - The pause the capture belongs to.
   * @param generation - The debug generation of the hit.
   * @param read - The run's capture.
   * @returns Settles when the stop is durable.
   * @example this.guard(() => this.captureStop(this.structural(elapsedMs), pause, generation, read))
   */
  protected captureStop(
    at: number,
    pause: Pick<NodeServerDebuggerPause, 'declaredStopIndex'>,
    generation: number,
    read: NodeServerDebuggerCapture,
  ): Promise<void> {
    const index = pause.declaredStopIndex ?? 0
    const hit = (this.hits.get(index) ?? 0) + 1
    this.hits.set(index, hit)
    const { column, frameName } = resolveServerStopFrame(read)
    // The shape rules run here too, so a fact that did not come through the capture's masks is stored masked.
    const facts = maskSavedFacts(
      Object.fromEntries(
        read.facts.map((fact) => [
          this.hide(`${fact.mode}:${fact.path}`),
          this.hide(fact.display),
        ]),
      ),
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
      frameName: cutTextToLength(
        this.hide(frameName),
        NODE_SERVER_HISTORY_FRAME_NAME_LIMIT_CHARS,
      ),
      facts,
      unavailable: read.unavailable.map((path) => ({
        path: cutTextToLength(
          this.hide(path),
          NODE_SERVER_HISTORY_UNAVAILABLE_PATH_LIMIT_CHARS,
        ),
        reason: 'The debugger could not read this required value at the stop.',
      })),
      // The saved-history rule runs here too, so a snapshot that did not come through the capture is stored masked.
      snapshot: maskSavedDebugSnapshot(
        maskSnapshot(read.snapshot, (text) =>
          // A text the capture cut inside a private root loses that fragment first: the hider only matches whole roots.
          this.hide(
            this.input.roots
              ? hideTrailingRootPrefix(text, this.input.roots)
              : text,
          ),
        ),
      ),
    })
  }

  /** Hides private roots, then masks secrets, in one text. */
  protected hide(text: string): string {
    return redactSecretText(this.input.sanitize(text))
  }

  /** Advances the one clock and returns the time an entry carries. */
  protected tick(elapsedMs: number): number {
    this.lastMs = Math.max(
      this.lastMs,
      Number.isFinite(elapsedMs) ? elapsedMs : 0,
    )
    return this.lastMs
  }

  /** The time of a structural entry, after the output that came before it was queued: structural entries are never coalesced and keep the journal's order. */
  protected structural(elapsedMs: number): number {
    this.flushOutput()
    return this.tick(elapsedMs)
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
  protected guard(action: () => Promise<void> | void): void {
    try {
      this.watch(action())
    } catch (error) {
      this.fault(error)
    }
  }

  /** Keeps a queued entry's refusal from reaching anyone: the writer already holds its first failure. */
  protected watch(queued: Promise<void> | void): void {
    if (queued)
      queued.catch(() => {
        this.reportAppendFailed()
      })
  }

  /** Tells {@link NodeRunHistorySinkInput.onAppendFailed} once, whether the first failure was a refused queued append or a synchronous fault of the sink. */
  private reportAppendFailed(): void {
    if (this.appendFailureReported) return
    this.appendFailureReported = true
    try {
      this.input.onAppendFailed?.()
    } catch {
      // The listener failing is its own matter.
    }
  }

  /** Marks the writer failed with the sink's own fault, once. */
  private fault(error: unknown): void {
    this.input.writer.markFailed(
      error instanceof Error ? error : new Error(String(error)),
    )
    // A synchronous refusal never reaches a queued append, so the status item is told here too.
    this.reportAppendFailed()
    if (this.faulted) return
    this.faulted = true
    try {
      this.input.onFault?.(error)
    } catch {
      // The listener failing is its own matter.
    }
  }
}

import {
  NODE_SCRIPT_EXIT_UNKNOWN_LIMIT_CHARS,
  NODE_SCRIPT_LIBRARY_PATH_LIMIT_CHARS,
} from './constants'
import {
  NodeRunHistorySinkBase,
  type NodeRunHistorySinkInput,
} from './nodeRunHistorySink'
import type {
  NodeScriptEnd,
  NodeScriptLibraryObservedEntry,
  NodeScriptLibraryPreparedEntry,
} from './nodeScriptHistorySchemas'
import type { NodeScriptHistoryWriter } from './nodeScriptHistoryWriter'
import type {
  NodeServerDebuggerPause,
  NodeServerStopCapture as NodeServerDebuggerCapture,
} from './nodeServerDebugger'
import { cutTextToLength } from './utils/cutTextToLength'

/**
 * What a live node-script run tells its history, in the run's own words and on the run's own clock (milliseconds since the launch). The run calls it synchronously at the moment each thing happens and never waits for it; a sink that fails marks its history failed and never reaches the run.
 * Implemented by {@link NodeScriptHistorySinkImpl}; the run holds the interface only. It mirrors {@link NodeServerHistorySink} without the request methods and adds the run's `end`.
 */
export interface NodeScriptHistorySink {
  /** The script printed a chunk, already through the run's output redactor. */
  output(elapsedMs: number, channel: 'stdout' | 'stderr', text: string): void
  /** The run captured one hit of a declared stop. */
  stop(
    elapsedMs: number,
    pause: Pick<NodeServerDebuggerPause, 'declaredStopIndex'>,
    generation: number,
    read: NodeServerDebuggerCapture,
  ): void
  /** The run built and packed its declared library (format 2 histories only). Reported once, before the script starts. */
  libraryPrepared(
    elapsedMs: number,
    facts: NodeScriptLibraryPreparedFacts,
  ): void
  /** The run read what the script loaded. Reported after the process tree ended and before {@link end}; a report after the end is dropped. */
  libraryObserved(
    elapsedMs: number,
    facts: NodeScriptLibraryObservedFacts,
  ): void
  /** The run ended: how, and which declared stops it reached, never reached or did not observe. Reports after the end are dropped. */
  end(elapsedMs: number, end: NodeScriptEnd): void
  /** The run refused a hit beyond its capture budget. */
  markCaptureBudgetExhausted(): void
  /** Queues the output still waiting to be coalesced; the seal coordinator calls it before it seals. */
  flush(): void
}

/** The facts of a `library.prepared` entry as the run reports them: the entry without its type, sequence and time. */
export type NodeScriptLibraryPreparedFacts = Omit<
  NodeScriptLibraryPreparedEntry,
  'type' | 'sequence' | 'elapsedMs'
>

/** The facts of a `library.observed` entry as the run reports them: the entry without its type, sequence and time. */
export type NodeScriptLibraryObservedFacts = Omit<
  NodeScriptLibraryObservedEntry,
  'type' | 'sequence' | 'elapsedMs'
>

/** What {@link NodeScriptHistorySinkImpl} needs from outside. */
export type NodeScriptHistorySinkInput =
  NodeRunHistorySinkInput<NodeScriptHistoryWriter>

/**
 * Turns what a node-script run reports into the entries of its history: coalesced and redacted output, hash-checked captures and the one `end`, all on one monotonic clock, in the order the journal's rules accept.
 * Every text is hidden of private roots and masked before it is queued. A fault of the sink, or an entry the rules would refuse, marks the writer failed and goes no further: the live run is never touched, and the seal reads partial with the cause.
 * Created by {@link startNodeScriptHistory}'s recorder for each script run whose history started.
 * @example
 * const sink = new NodeScriptHistorySinkImpl({ writer, sanitize })
 * sink.output(40, 'stdout', 'hello\n')
 */
export class NodeScriptHistorySinkImpl
  extends NodeRunHistorySinkBase<NodeScriptHistoryWriter>
  implements NodeScriptHistorySink
{
  private ended = false

  stop(
    elapsedMs: number,
    pause: Pick<NodeServerDebuggerPause, 'declaredStopIndex'>,
    generation: number,
    read: NodeServerDebuggerCapture,
  ): void {
    this.guard(() => {
      // A capture that finishes after the end was recorded is a late hit, not a fault: it is not written and the history stays whole.
      if (this.ended) return
      return this.captureStop(
        this.structural(elapsedMs),
        pause,
        generation,
        read,
      )
    })
  }

  libraryPrepared(
    elapsedMs: number,
    facts: NodeScriptLibraryPreparedFacts,
  ): void {
    this.guard(() => {
      if (this.ended) return
      return this.input.writer.appendLibraryPrepared({
        ...facts,
        elapsedMs: this.structural(elapsedMs),
      })
    })
  }

  libraryObserved(
    elapsedMs: number,
    facts: NodeScriptLibraryObservedFacts,
  ): void {
    this.guard(() => {
      // An observation after the end is a late report: dropped, never a fault.
      if (this.ended) return
      const { otherCopyPath, ...rest } = facts
      return this.input.writer.appendLibraryObserved({
        ...rest,
        // The other copy's path is hidden of private roots like every recorded text.
        ...(otherCopyPath === undefined
          ? {}
          : {
              otherCopyPath: cutTextToLength(
                this.hide(otherCopyPath),
                NODE_SCRIPT_LIBRARY_PATH_LIMIT_CHARS,
              ),
            }),
        elapsedMs: this.structural(elapsedMs),
      })
    })
  }

  end(elapsedMs: number, end: NodeScriptEnd): void {
    this.guard(() => {
      // A second end is a late report: dropped, never a fault.
      if (this.ended) return
      this.ended = true
      const { exitUnknown, ...rest } = end
      return this.input.writer.appendEnd({
        ...rest,
        elapsedMs: this.structural(elapsedMs),
        ...(exitUnknown === undefined
          ? {}
          : {
              exitUnknown: cutTextToLength(
                this.hide(exitUnknown),
                NODE_SCRIPT_EXIT_UNKNOWN_LIMIT_CHARS,
              ),
            }),
      })
    })
  }
}

import type { ExtensionPauseView } from './chromeExtensionDebugger'
import type {
  ChromeExtensionHistorySink,
  ExtensionHistoryPause,
} from './chromeExtensionHistorySink'

/**
 * Turns the debugger's changing list of open pauses into the history's events: a declared pause opened, finished its capture, or ended (continued, or its worker went away).
 * Why: the debugger only says "the pause set changed"; this remembers what the history was already told, so each pause is opened, captured and closed once.
 * Created by {@link OwnedChromeExtensionRun} for a run that records; {@link ExtensionHistoryPauseTracker.sync} runs on every debugger change.
 * @example
 * const tracker = new ExtensionHistoryPauseTracker('run-1', surfaceUrl, workerUrl)
 * tracker.sync(debug.pauses(), debug.workerGeneration(), history)
 */
export class ExtensionHistoryPauseTracker {
  private readonly opened = new Map<number, ExtensionHistoryPause>()
  private readonly captured = new Set<string>()
  private readonly continued = new Set<number>()

  constructor(
    private readonly runId: string,
    private readonly surfaceUrl: string,
    private readonly workerUrl: string,
  ) {}

  /** The history's id of an open pause of this generation, `undefined` when the history was not told of it. @example tracker.pauseIdOf(2) */
  pauseIdOf(generation: number): string | undefined {
    return this.opened.get(generation)?.pauseId
  }

  /** Remembers that this run asked to continue the pause, so its end is told apart from a worker that went away. @example tracker.noteContinue(2) */
  noteContinue(generation: number): void {
    this.continued.add(generation)
  }

  /**
   * Tells the history what changed since the last call.
   * @param pauses - The debugger's open pauses now.
   * @param workerGeneration - The debugger's current worker generation.
   * @param history - Where the events go.
   * @example tracker.sync(debug.pauses(), debug.workerGeneration(), history)
   */
  sync(
    pauses: readonly ExtensionPauseView[],
    workerGeneration: number,
    history: ChromeExtensionHistorySink,
  ): void {
    const open = new Set<number>()
    for (const pause of pauses) {
      if (pause.kind !== 'declared' || pause.stopIndex === undefined) continue
      open.add(pause.generation)
      const recorded = this.open(pause, workerGeneration, history)
      if (pause.captured && !this.captured.has(recorded.pauseId)) {
        this.captured.add(recorded.pauseId)
        history.captured(recorded.pauseId, pause.captured)
      }
    }
    this.closeGone(open, workerGeneration, history)
  }

  /** The history's record of a pause, opened on first sight. */
  private open(
    pause: ExtensionPauseView,
    workerGeneration: number,
    history: ChromeExtensionHistorySink,
  ): ExtensionHistoryPause {
    const known = this.opened.get(pause.generation)
    if (known) return known
    const stopIndex = pause.stopIndex ?? 0
    const isWorker = pause.context === 'service-worker'
    const recorded: ExtensionHistoryPause = {
      pauseId: `${this.runId}:${pause.generation}:${pause.context}:${stopIndex}`,
      generation: pause.generation,
      context: pause.context,
      stopIndex,
      targetUrl: isWorker ? this.workerUrl : this.surfaceUrl,
      workerGeneration: isWorker ? workerGeneration : 0,
    }
    this.opened.set(pause.generation, recorded)
    history.pauseOpened(recorded)
    return recorded
  }

  /** Closes the pauses that are no longer open: continued here, or a service worker that was replaced. */
  private closeGone(
    open: ReadonlySet<number>,
    workerGeneration: number,
    history: ChromeExtensionHistorySink,
  ): void {
    for (const [generation, recorded] of [...this.opened]) {
      if (open.has(generation)) continue
      this.opened.delete(generation)
      const workerWentAway =
        !this.continued.has(generation) &&
        recorded.context === 'service-worker' &&
        workerGeneration !== recorded.workerGeneration
      history.pauseClosed(
        recorded.pauseId,
        workerWentAway ? 'worker-lost' : 'continue',
      )
    }
  }
}

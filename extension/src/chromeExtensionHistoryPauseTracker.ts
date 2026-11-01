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
  private readonly undecided: ExtensionHistoryPause[] = []

  constructor(
    private readonly runId: string,
    private readonly surfaceUrl: string,
    private readonly workerUrl: string,
  ) {}

  /** The history's id of an open pause of this generation, `undefined` when the history was not told of it. @example tracker.pauseIdOf(2) */
  pauseIdOf(generation: number): string | undefined {
    return this.opened.get(generation)?.pauseId
  }

  /** Remembers that this run asked to continue the pause, so its end is journaled as a continue and not as a lost surface or worker. @example tracker.noteContinue(2) */
  noteContinue(generation: number): void {
    this.continued.add(generation)
  }

  /**
   * Tells the history what changed since the last call.
   * @param pauses - The debugger's open pauses now.
   * @param workerGeneration - The debugger's current worker generation.
   * @param history - Where the events go.
   * @param isAlive - Whether the run's browser is still alive; decides, before anything new is told, the pauses that vanished earlier with no observed continue.
   * @example tracker.sync(debug.pauses(), debug.workerGeneration(), history, () => true)
   */
  sync(
    pauses: readonly ExtensionPauseView[],
    workerGeneration: number,
    history: ChromeExtensionHistorySink,
    isAlive: () => boolean,
  ): void {
    // An earlier vanished pause closes before a later pause or capture of the run is told.
    this.settleUndecided(isAlive, history)
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

  /**
   * Decides the pauses that vanished with no observed continue, now that the run has had time to learn whether its browser is gone.
   * Why: the debugger's pause set can change before the run hears of a killed browser, so the decision is taken on a later check, never at the vanishing itself.
   * Alive: a Continue pressed in the editor's debug toolbar, which the debugger does not report, so the pause closes as a continue and the replay's following interval is a no-stop moment. Not alive: left open, so the recorder's seal names surface-lost, worker-lost or run-ended.
   * Residual window: a manual resume is journaled at the next pause-set change or at the run's end, before the later pause opens or the seal, not at the instant it happened (the writer stamps its own clock and takes no time). No timer is armed: a recorded run adds no timer an unrecorded one lacks.
   * @param isAlive - Whether the run's browser and surface are still alive and the run has not ended.
   * @param history - Where the events go.
   * @example tracker.settleUndecided(() => !run.isBrowserGone, history)
   */
  settleUndecided(
    isAlive: () => boolean,
    history: ChromeExtensionHistorySink,
  ): void {
    const waiting = this.undecided.splice(0)
    if (!isAlive()) return
    for (const recorded of waiting)
      history.pauseClosed(recorded.pauseId, 'continue')
  }

  /**
   * Closes the pauses that are no longer open when the run knows why: it continued them, or their service worker was replaced.
   * A pause that vanished with no such reason waits in {@link ExtensionHistoryPauseTracker.settleUndecided} for a liveness decision.
   */
  private closeGone(
    open: ReadonlySet<number>,
    workerGeneration: number,
    history: ChromeExtensionHistorySink,
  ): void {
    for (const [generation, recorded] of [...this.opened]) {
      if (open.has(generation)) continue
      this.opened.delete(generation)
      if (this.continued.has(generation)) {
        history.pauseClosed(recorded.pauseId, 'continue')
        continue
      }
      // Without an observed continue only a replaced worker is a known end; anything else needs the liveness decision.
      if (
        recorded.context === 'service-worker' &&
        workerGeneration !== recorded.workerGeneration
      )
        history.pauseClosed(recorded.pauseId, 'worker-lost')
      else this.undecided.push(recorded)
    }
  }
}

import { PLAYBACK_TICK_INTERVAL_MS } from '../constants'

export interface NodeHistoryPlaybackEvent {
  sequence: number
  elapsedMs: number
}

export interface NodeHistoryPlaybackDependencies {
  present(sequence: number): Promise<void>
  changed(): void
  /** Receives an autoplay presentation failure; manual seeks reject to their own caller instead. */
  failed?(error: unknown): void
  now?: () => number
  manualTicks?: boolean
}

/** Orders verified Node journal moments for time-based replay; {@link StudyWorkspace} supplies the native presentation. @example controller.open(events, 2) */
export class NodeHistoryPlaybackController {
  private events: NodeHistoryPlaybackEvent[] = []
  private selectedIndex = -1
  private mode: 'paused' | 'playing' = 'paused'
  private anchorElapsedMs = 0
  private anchorWallMs = 0
  private timer?: ReturnType<typeof setInterval>
  private pending?: Promise<void>
  private generation = 0
  /** The generation {@link dispose} last ended, so a presentation started before it settles without publishing to a closed reader. */
  private disposedGeneration = -1
  private readonly clock: () => number

  constructor(private readonly dependencies: NodeHistoryPlaybackDependencies) {
    this.clock = dependencies.now ?? (() => performance.now())
  }

  /** Opens one verified event list at its restored sequence and stops any prior history. @param events - Ordered events from the sealed journal. @param sequence - Previously selected event, if still present. @example controller.open([{sequence:1,elapsedMs:10}], 1) */
  open(events: NodeHistoryPlaybackEvent[], sequence?: number): void {
    this.generation++
    this.stopTimer()
    this.mode = 'paused'
    this.events = [...events]
    this.selectedIndex =
      sequence === undefined
        ? -1
        : this.events.findIndex((event) => event.sequence === sequence)
    if (!this.events.length) this.selectedIndex = -1
    this.dependencies.changed()
  }

  /** Reports the confirmed event and playback range without advancing timers. @returns The selected journal time and control state. @example controller.state().positionMs */
  state(): {
    mode: 'paused' | 'playing'
    sequence?: number
    positionMs?: number
    startMs?: number
    endMs?: number
    loading: boolean
  } {
    const selected = this.events[this.selectedIndex]
    return {
      mode: this.mode,
      ...(selected && {
        sequence: selected.sequence,
        positionMs: selected.elapsedMs,
      }),
      ...(this.events.length && {
        startMs: this.events[0]!.elapsedMs,
        endMs: this.events.at(-1)!.elapsedMs,
      }),
      loading: Boolean(this.pending),
    }
  }

  /** Pauses event advancement while allowing an already requested native presentation to settle. @example controller.pause() */
  pause(): void {
    if (this.mode === 'paused') return
    this.mode = 'paused'
    this.stopTimer()
    this.dependencies.changed()
  }

  /**
   * Gives up the in-flight native presentation when another owner takes the shared historical debugger.
   *
   * {@link StudyWorkspace} calls it when a browser recording opens and when the reader closes. Unlike {@link pause}, a
   * presentation that resolves later can no longer commit its event; it only publishes that loading ended. The confirmed
   * event and the list stay.
   *
   * @example
   * ```ts
   * controller.abandon() // a pending Node stop no longer becomes the selected event
   * ```
   */
  abandon(): void {
    this.generation++
    this.mode = 'paused'
    this.stopTimer()
    // The abandoned presentation can no longer commit, so the reader learns here that playback paused; its settlement later publishes that loading ended.
    this.dependencies.changed()
  }

  /** Starts at the confirmed event and advances only after each native event has been presented. @example controller.play() */
  play(): void {
    if (
      this.mode === 'playing' ||
      this.pending ||
      this.selectedIndex < 0 ||
      this.selectedIndex >= this.events.length - 1
    )
      return
    this.mode = 'playing'
    this.anchorElapsedMs = this.events[this.selectedIndex]!.elapsedMs
    this.anchorWallMs = this.clock()
    if (!this.dependencies.manualTicks) {
      this.timer = setInterval(() => {
        const generation = this.generation
        // tick() has already paused on a failed presentation; the learner needs the reason unless a newer selection superseded this step.
        void this.tick().catch((error) => {
          if (generation === this.generation) this.dependencies.failed?.(error)
        })
      }, PLAYBACK_TICK_INTERVAL_MS)
      this.timer.unref()
    }
    this.dependencies.changed()
  }

  /** Seeks to the last verified event at or before the requested recorded time. @param positionMs - Time inside the recorded event range. @returns Resolves after its exact event presentation settles. @throws If the time is outside the selected history. @example await controller.seek(1_500) */
  async seek(positionMs: number): Promise<void> {
    const first = this.events[0],
      last = this.events.at(-1)
    if (
      !first ||
      !last ||
      !Number.isFinite(positionMs) ||
      positionMs < first.elapsedMs ||
      positionMs > last.elapsedMs
    ) {
      throw new Error('Seek lies outside the verified Node history range.')
    }
    this.mode = 'paused'
    this.generation++
    const generation = this.generation
    this.stopTimer()
    // An earlier presentation's failure belongs to its own caller; this seek only waits for the shared debugger to be free.
    await this.pending?.catch(() => {})
    if (generation !== this.generation) return
    let targetIndex = 0
    for (let index = 1; index < this.events.length; index++) {
      if (this.events[index]!.elapsedMs > positionMs) break
      targetIndex = index
    }
    await this.present(targetIndex, generation)
  }

  /** Presents one next event per tick, never skipping a source/debugger boundary during slow host updates. @returns Resolves when the next eligible event is committed. @example await controller.tick() */
  async tick(): Promise<void> {
    if (this.mode !== 'playing' || this.pending || this.selectedIndex < 0)
      return
    const targetTime =
      this.anchorElapsedMs + Math.max(0, this.clock() - this.anchorWallMs)
    const nextIndex = this.selectedIndex + 1
    if (nextIndex >= this.events.length) {
      this.pause()
      return
    }
    if (this.events[nextIndex]!.elapsedMs > targetTime) return
    const generation = this.generation,
      presentationStartedWallMs = this.clock()
    try {
      await this.present(nextIndex, generation)
    } catch (error) {
      this.pause()
      throw error
    }
    // Waiting for native Run and Debug is a visible pause, not recorded test time; later output keeps its recorded spacing.
    this.anchorWallMs += this.clock() - presentationStartedWallMs
    if (
      this.mode === 'playing' &&
      this.selectedIndex === this.events.length - 1
    )
      this.pause()
  }

  /** Aligns the controller with a learner-selected event and stops any active playback. @param sequence - Exact verified event sequence. @example controller.select(4) */
  select(sequence: number): void {
    const index = this.events.findIndex((event) => event.sequence === sequence)
    if (index < 0) return
    this.generation++
    this.mode = 'paused'
    this.stopTimer()
    this.selectedIndex = index
    this.dependencies.changed()
  }

  /** Clears playback ownership when the reader closes or selects another history. @example controller.dispose() */
  dispose(): void {
    this.generation++
    this.disposedGeneration = this.generation
    this.mode = 'paused'
    this.stopTimer()
    this.events = []
    this.selectedIndex = -1
  }

  private async present(index: number, generation: number): Promise<void> {
    const event = this.events[index]
    if (!event) return
    const operation = this.dependencies.present(event.sequence)
    this.pending = operation
    try {
      await operation
      if (generation === this.generation) {
        this.selectedIndex = index
      }
    } finally {
      if (this.pending === operation) {
        this.pending = undefined
        // Publish settled controls only after the native event is no longer loading, even for an abandoned or superseded event: nothing else reports that loading ended. A disposed controller publishes nothing.
        if (this.disposedGeneration <= generation) this.dependencies.changed()
      }
    }
  }

  private stopTimer(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }
}

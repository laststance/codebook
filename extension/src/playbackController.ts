import { PLAYBACK_TICK_INTERVAL_MS } from './constants'
import type { PlaybackCommand } from './playbackSchemas'
import type { RecordingContext, RecordingIndex } from './recordingSchemas'
import { awaitResponse } from './runtimeSupport/utils/awaitResponse'
import { projectHistoricalTimeline } from './utils/projectHistoricalTimeline'
import { projectRecording } from './utils/projectRecording'
import { untilAborted } from './utils/untilAborted'

export interface PlaybackData {
  index: RecordingIndex
  context?: RecordingContext
  contextHash?: string
  contextReason?: string
  preferredPositionMs?: number
}
export interface PlaybackBundle {
  studyId: string
  contextHash?: string
  context?: RecordingContext
  projection: ReturnType<typeof projectRecording>
  image?: Buffer
}
export interface PlaybackDependencies {
  load(studyId: string, signal: AbortSignal): Promise<PlaybackData>
  frame(studyId: string, hash: string, signal: AbortSignal): Promise<Buffer>
  present(bundle: PlaybackBundle, signal: AbortSignal): Promise<void>
  invalidate(): void
  changed(): void
  save(bundle: PlaybackBundle): Promise<void>
  /** Whether the committed moment can be shown again as it is: the reader is open and its historical debugger is usable. Defaults to true. */
  presentable?(): boolean
  /** Whether the replay reader's panes exist (open and not closing); without them only `open` and `pause` are accepted. Defaults to true. */
  readerOpen?(): boolean
  now?(): number
  manualTicks?: boolean
}
interface PresentationRequest {
  revision: number
  studyId: string
  positionMs?: number
  restore?: PlaybackBundle
  save: boolean
}

/** Serializes requested→loaded→painted bundles without runtime authority; newer controls synchronously retire older asynchronous work. @example controller.command({studyId,action:'seek',expectedRevision:2,positionMs:500}) */
export class PlaybackController {
  private controlRevision = 0
  private presentationRevision = 0
  private studyId?: string
  private data?: PlaybackData
  private presented?: PlaybackBundle
  private requestedMs?: number
  private cleared = false
  private boundaries: number[] = []
  private mode: 'paused' | 'playing' = 'paused'
  private readiness: 'idle' | 'loading' | 'ready' | 'failed' = 'idle'
  private reason?: string
  private request?: PresentationRequest
  private running?: Promise<void>
  private abort?: AbortController
  private anchorMs = 0
  private anchorWallMs = 0
  private timer?: ReturnType<typeof setInterval>
  private readonly clock: () => number
  private disposed = false
  private saves: Promise<void> = Promise.resolve()
  /** The position of the bundle {@link remember} last queued for saving, per study; an open of that study prefers it to a stored preference that the queued save may not have written yet, also after another recording was opened in between. It deliberately survives {@link leave}. */
  private readonly rememberedPositionMsByStudy = new Map<string, number>()

  constructor(private readonly dependencies: PlaybackDependencies) {
    this.clock = dependencies.now ?? (() => performance.now())
  }

  /** Validates revision before all effects; lost-response retries read state instead of restarting execution or playback. @example controller.command({ studyId, action:'pause', expectedRevision:3 }) */
  command(
    input:
      | Omit<Extract<PlaybackCommand, { action: 'seek' }>, 'instanceId'>
      | Omit<Exclude<PlaybackCommand, { action: 'seek' }>, 'instanceId'>,
  ) {
    if (this.disposed) throw new Error('Playback controller is closed.')
    if (input.expectedRevision !== this.controlRevision)
      throw new Error(
        `Stale playback revision; current revision is ${this.controlRevision}.`,
      )
    if (input.action === 'open') {
      // A committed moment whose reader closed or whose historical debugger ended needs the full reload below; a load that is still running already provides one.
      const needsReload =
        this.readiness === 'ready' &&
        !(this.dependencies.presentable?.() ?? true)
      if (
        this.studyId === input.studyId &&
        this.readiness !== 'idle' &&
        this.readiness !== 'failed' &&
        !needsReload
      ) {
        // A hidden or timed-out frame left the confirmed moment unpainted; opening the same recording shows it again.
        if (this.readiness === 'ready' && this.cleared) this.reveal()
        return this.state()
      }
      this.remember()
      this.controlRevision++
      this.mode = 'paused'
      this.stopTimer()
      this.studyId = input.studyId
      this.data = undefined
      this.presented = undefined
      this.requestedMs = undefined
      this.boundaries = []
      this.queue({ studyId: input.studyId, save: true })
      return this.state()
    }
    if (input.studyId !== this.studyId)
      throw new Error(
        'Playback command belongs to another study; open its returned identity first.',
      )
    if (input.action === 'pause') {
      if (this.mode === 'paused' && !this.running && !this.request)
        return this.state()
      this.controlRevision++
      this.mode = 'paused'
      this.stopTimer()
      // Pending B may already be decoded: retire its ACK and restore fully presented A under fresh ownership.
      const committed = this.presented
      this.invalidate()
      this.request = undefined
      this.requestedMs = committed?.projection.positionMs
      if (committed)
        this.queue({
          studyId: input.studyId,
          positionMs: committed.projection.positionMs,
          restore: committed,
          save: true,
        })
      else {
        this.readiness = 'idle'
        this.dependencies.changed()
      }
      return this.state()
    }
    const range = this.range()
    // Checked before the reader guard: the reader is marked open only late in a load, and a control sent meanwhile must hear that the recording is not ready, not that the reader is closed.
    if (!range || !this.data)
      throw new Error(
        'Recording is not ready; read playback state before another control.',
      )
    // A closed reader has no panes to present in, so a seek or play would recreate the Application panel alone; only an explicit open brings the reader back.
    if (!(this.dependencies.readerOpen?.() ?? true))
      throw new Error(
        'The replay reader is closed; open the recording before another control.',
      )
    if (input.action === 'seek') {
      if (input.positionMs < range.startMs || input.positionMs > range.endMs)
        throw new Error('Seek lies outside the returned recording range.')
      this.controlRevision++
      this.mode = 'paused'
      this.stopTimer()
      this.queue({
        studyId: input.studyId,
        positionMs: input.positionMs,
        save: true,
      })
      return this.state()
    }
    if (this.mode === 'playing') return this.state()
    if (this.readiness !== 'ready' || !this.presented)
      throw new Error('Wait for matching presentation before playing.')
    if (this.presented.projection.positionMs >= range.endMs) return this.state()
    this.controlRevision++
    this.mode = 'playing'
    this.anchorMs = this.presented.projection.positionMs
    this.anchorWallMs = this.clock()
    if (!this.dependencies.manualTicks) {
      this.timer = setInterval(() => this.tick(), PLAYBACK_TICK_INTERVAL_MS)
      this.timer.unref()
    }
    this.dependencies.changed()
    return this.state()
  }

  /** Exposes requested and confirmed position separately; read calls cannot advance timers or mutate learner history. @example controller.state().presentedMs */
  state() {
    return {
      revision: this.controlRevision,
      presentationRevision: this.presentationRevision,
      studyId: this.studyId,
      mode: this.mode,
      readiness: this.readiness,
      requestedMs: this.requestedMs,
      presentedMs: this.presented?.projection.positionMs,
      range: this.range(),
      historyTimeline: projectHistoricalTimeline(
        this.data?.context,
        this.range(),
      ),
      recordingStatus: this.data?.index.status,
      recordingReason: this.data?.index.reason,
      cleared: this.cleared,
      contextHash: this.data?.contextHash,
      contextReason: this.data?.contextReason,
      reason: this.reason,
      // Agents read this before a control: false means only open (or pause) is accepted until the reader is reopened.
      readerOpen: this.dependencies.readerOpen?.() ?? true,
      frame: this.presented?.projection.frame && {
        sequence: this.presented.projection.frame.sequence,
        hash: this.presented.projection.frame.hash,
        receivedMs: this.presented.projection.frame.elapsedMs,
      },
      observationId: this.presented?.projection.observation?.id,
      missing: this.presented?.projection.missing,
    }
  }

  /** Returns only the fully presented bundle for workspace source/value projection, never a pending seek's data. @example controller.bundle()?.projection.observation */
  bundle(): PlaybackBundle | undefined {
    return this.presented
  }

  /** Advances only explicit Play, with one pending load and no timer-based progress writes. @example controller.tick() */
  tick(): void {
    if (
      this.disposed ||
      this.mode !== 'playing' ||
      this.running ||
      this.request ||
      !this.studyId ||
      !this.presented
    )
      return
    const range = this.range()
    if (!range) return
    const nextBoundary =
      this.boundaries.find(
        (value) => value > this.presented!.projection.positionMs,
      ) ?? range.endMs
    const positionMs = Math.min(
      range.endMs,
      nextBoundary,
      this.anchorMs + Math.max(0, this.clock() - this.anchorWallMs),
    )
    this.queue({ studyId: this.studyId, positionMs, save: false }, false)
  }

  /** Pauses when the replay surface hides; the recorded application's lifecycle never calls this method. @example controller.hide() */
  hide(): void {
    if (!this.studyId || this.disposed) return
    this.controlRevision++
    this.mode = 'paused'
    this.stopTimer()
    this.invalidate()
    this.request = undefined
    this.requestedMs = this.presented?.projection.positionMs
    this.remember()
    this.readiness = this.presented ? 'ready' : 'idle'
    this.dependencies.changed()
  }

  /**
   * Re-presents committed history when {@link StudyWorkspace} reports Application visibility, opens a replay or restores a moved renderer.
   *
   * A request that is still loading keeps ownership of its requested moment instead; a hidden first load restarts its read.
   * @example controller.reveal()
   */
  reveal(): void {
    if (this.disposed || !this.studyId) return
    // A seek may itself reveal Application; its pending presentation keeps ownership of the requested moment.
    if (this.readiness === 'loading') return
    // A hidden first load has no committed bundle; revealing explicitly restarts that cancelled read.
    if (!this.presented) {
      if (this.readiness === 'idle')
        this.queue({ studyId: this.studyId, save: true })
      return
    }
    this.queue({
      studyId: this.studyId,
      positionMs: this.presented.projection.positionMs,
      restore: this.presented,
      save: false,
    })
  }

  /** Clears historical selection on explicit exit, enabling a subsequent same-study open to reload repaired files; that open still starts at the last confirmed position, clamped to the reloaded range. @example controller.leave() */
  leave(): void {
    this.hide()
    this.studyId = undefined
    this.data = undefined
    this.presented = undefined
    this.requestedMs = undefined
    this.readiness = 'idle'
    this.reason = undefined
    this.dependencies.changed()
  }

  /**
   * Awaits owned asynchronous presentation during tests, workspace retirement and presentation changes.
   *
   * Unbounded (no arguments, as tests and {@link dispose} call it), it also waits for queued preference saves. A replay
   * frame that {@link StudyWorkspace} reveals while its panel is hidden can wait indefinitely, so presentation changes,
   * repository navigation and reader close pass their cancellation and a bound; a bounded wait covers only the
   * presentation loop, never saves held behind the storage lock. Giving up never cancels the frame itself.
   *
   * @param signal - Optional caller cancellation.
   * @param timeoutMs - Optional bound on the wait; defaults to unbounded when neither argument is given.
   * @throws When `signal` aborts or `timeoutMs` elapses first.
   * @example
   * ```ts
   * await controller.settle(transition.signal, PRESENTATION_SETTLE_CEILING_MS)
   * ```
   */
  async settle(signal?: AbortSignal, timeoutMs?: number): Promise<void> {
    const presented = (async () => {
      while (this.running) await this.running
    })()
    if (!signal && timeoutMs === undefined) {
      await presented
      return this.saved()
    }
    await awaitResponse(presented, 'the replay frame', signal, timeoutMs)
  }

  /**
   * Waits for queued preference saves, which {@link StudyWorkspace.close} keeps awaiting after it bounds the presentation wait.
   * @returns Once every queued save finished; a failed save is reported through state, never thrown.
   * @example await controller.saved()
   */
  saved(): Promise<void> {
    return this.saves
  }

  /** Retires playback timers and pending receipts without closing any application/debug session. @example await controller.dispose() */
  async dispose(): Promise<void> {
    this.hide()
    this.disposed = true
    await this.settle()
  }

  /** Selects known endpoints without inventing a duration for an interrupted tail. @example this.range()?.endKnown */
  private range() {
    return (
      this.data && {
        startMs: this.data.index.header.startedMs,
        endMs: this.data.index.endMs ?? this.data.index.lastVerifiedMs,
        endKnown: this.data.index.endMs !== undefined,
      }
    )
  }

  /** Reserves new presentation ownership before reading; changed bundles remain hidden until matching ACK. @example this.queue({studyId,positionMs:500,save:true}) */
  private queue(
    input: Omit<PresentationRequest, 'revision'>,
    clear = true,
  ): void {
    if (clear) this.invalidate()
    else {
      this.presentationRevision++
      this.abort?.abort(new Error('New playback frame'))
    }
    this.request = { ...input, revision: this.presentationRevision }
    this.requestedMs = input.positionMs
    this.readiness = 'loading'
    this.reason = undefined
    this.dependencies.changed()
    this.pump()
  }

  /** Serializes loads/presentation while obsolete completions are ignored; only a committed bundle changes presented time. @example this.pump() */
  private pump(): void {
    if (this.running || !this.request || this.disposed) return
    const pending = (async () => {
      while (this.request && !this.disposed) {
        const request = this.request
        this.request = undefined
        const abort = new AbortController()
        this.abort = abort
        const current = () =>
          !abort.signal.aborted &&
          request.revision === this.presentationRevision &&
          request.studyId === this.studyId &&
          !this.disposed
        try {
          let data = this.data
          if (!data) {
            // Every dependency wait leaves with the request's abort, so a stalled read cannot hold later requests.
            data = await untilAborted(
              this.dependencies.load(request.studyId, abort.signal),
              abort.signal,
            )
            if (!current() || !data) continue
            this.data = data
            this.boundaries = [
              ...(data.context?.study.observations.map(
                (value) => value.elapsedMs,
              ) ?? []),
              ...(data.context?.pausedIntervals?.map((value) => value.endMs) ??
                []),
              ...(data.context?.interpretationAvailability.flatMap((value) =>
                value.elapsedMs === null ? [] : [value.elapsedMs],
              ) ?? []),
            ].sort((left, right) => left - right)
          }
          const range = this.range()!
          // The moment this controller last confirmed for the study outranks storage: its save may still be queued, and a failed save must not move the learner back.
          const preferredPositionMs =
            this.rememberedPositionMsByStudy.get(request.studyId) ??
            data.preferredPositionMs
          const positionMs =
            request.positionMs ??
            Math.min(
              range.endMs,
              Math.max(range.startMs, preferredPositionMs ?? range.startMs),
            )
          this.requestedMs = positionMs
          const projection =
            request.restore?.projection ??
            projectRecording(data.index, data.context, positionMs)
          const frameHash = projection.frame?.hash
          let image =
            request.restore?.image ??
            (frameHash && this.presented?.projection.frame?.hash === frameHash
              ? this.presented.image
              : undefined)
          if (frameHash && !image) {
            image = await untilAborted(
              this.dependencies.frame(request.studyId, frameHash, abort.signal),
              abort.signal,
            )
            if (!current()) continue
          }
          const bundle: PlaybackBundle = request.restore ?? {
            studyId: request.studyId,
            contextHash: data.contextHash,
            context: data.context,
            projection,
            image,
          }
          const contextChanged =
            this.contextKey(bundle) !==
            (this.presented && this.contextKey(this.presented))
          // Explicit seeks clear pixels even when their frame/context matches the last committed bundle.
          const changed =
            this.cleared ||
            Boolean(request.restore) ||
            this.presentationKey(bundle) !==
              (this.presented && this.presentationKey(this.presented))
          if (contextChanged && !this.cleared) {
            this.cleared = true
            this.dependencies.invalidate()
            this.dependencies.changed()
          }
          if (changed) {
            await untilAborted(
              this.dependencies.present(bundle, abort.signal),
              abort.signal,
            )
            if (!current()) continue
          }
          if (!current()) continue
          this.presented = bundle
          this.readiness = 'ready'
          this.reason = undefined
          this.cleared = false
          if (this.mode === 'playing') {
            // Source-boundary I/O is a visible wait, not elapsed film time that silently skips the explanation.
            if (contextChanged) {
              this.anchorMs = positionMs
              this.anchorWallMs = this.clock()
            }
            if (positionMs >= range.endMs) {
              this.mode = 'paused'
              this.stopTimer()
              this.remember()
            }
          }
          if (request.save) this.remember()
          this.dependencies.changed()
        } catch (error) {
          if (!current()) continue
          this.mode = 'paused'
          this.stopTimer()
          this.readiness = 'failed'
          this.reason = String(error)
          this.dependencies.invalidate()
          this.dependencies.changed()
        }
      }
    })().finally(() => {
      if (this.running === pending) this.running = undefined
      if (this.request) this.pump()
    })
    this.running = pending
  }

  /** Compares visible evidence, avoiding redundant image decode/source opens when only the playhead changes. @example this.presentationKey(bundle) */
  private presentationKey(bundle: PlaybackBundle): string {
    const { frame, observation, missing, pauseConfirmed, rendererConfirmed } =
      bundle.projection
    return JSON.stringify([
      bundle.studyId,
      bundle.contextHash,
      frame?.hash,
      observation?.id,
      Boolean(bundle.projection.debugger),
      observation?.interpretations.map((value) => value.id),
      missing,
      pauseConfirmed,
      rendererConfirmed,
    ])
  }

  /** Identifies learning boundaries independently from moving pixels so source/value loads pause the playback clock. @example this.contextKey(bundle) */
  private contextKey(bundle: PlaybackBundle): string {
    return JSON.stringify([
      bundle.projection.observation?.id,
      bundle.projection.observation?.interpretations.map((value) => value.id),
    ])
  }

  /** Invalidates renderer work synchronously so a slow read or late ACK cannot commit across controls. @example this.invalidate() */
  private invalidate(): void {
    this.presentationRevision++
    this.abort?.abort(new Error('Playback presentation superseded'))
    this.cleared = true
    this.dependencies.invalidate()
  }

  /** Serializes explicit navigation saves and records the confirmed position that the next open of the same study prefers over the stored preference, also when its save fails; callbacks receive the confirmed bundle, never requested position B. @example this.remember() */
  private remember(): void {
    const bundle = this.presented
    if (!bundle) return
    this.rememberedPositionMsByStudy.set(
      bundle.studyId,
      bundle.projection.positionMs,
    )
    this.saves = this.saves
      .then(() => this.dependencies.save(bundle))
      .catch((error) => {
        this.reason = `Playback position not saved: ${String(error)}`
        this.dependencies.changed()
      })
  }

  /** Stops only this controller's timer during pause, hide, failure and end. @example this.stopTimer() */
  private stopTimer(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }
}
export type PlaybackState = ReturnType<PlaybackController['state']>

import { CAPTURE_TIMEOUT_MS } from './constants'
import { ViewportAckTimeoutError } from './utils/viewportAckTimeoutError'

export interface ViewFrame {
  data: string
  hash: string
  phase: string
  required: boolean
  delayAck: boolean
  /** The captured page's CSS width and height in pixels, when the browser reported them; a popup document sizes the image by these. */
  cssWidth?: number
  cssHeight?: number
}
export interface FrameMessage extends ViewFrame {
  type: 'frame'
  epoch: string
  id: number
}
interface PendingFrame {
  message: FrameMessage
  resolve: (receipt: { epoch: string; id: number; hash: string }) => void
  reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
  deadlineMs: number
  sent: boolean
}

/** Bounds {@link BrowserViewport} delivery and rejects stale paint ACKs; live frames cannot replace a paused image. @example delivery.begin('view-1'); await delivery.offer(frame) */
export class FrameDelivery {
  // idle -> inFlight + latestPending -> acknowledged; epoch change/disposal rejects both.
  private epoch?: string
  private nextId = 0
  private inFlight?: PendingFrame
  private pending?: PendingFrame
  private frozen = false
  private closed = false

  /** Configures {@link BrowserViewport}'s existing delivery slots and paint budget.
   * @param clock - Monotonic milliseconds available for painting; defaults to wall time for live capture.
   * @example new FrameDelivery(postFrame, record, CAPTURE_TIMEOUT_MS)
   */
  constructor(
    private readonly send: (message: FrameMessage) => PromiseLike<boolean>,
    private readonly record: (type: string, detail?: unknown) => unknown,
    private readonly timeoutMs = CAPTURE_TIMEOUT_MS,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  /** Re-arms unchanged paint budgets when {@link BrowserViewport} observes renderer visibility; this never confirms a frame. @example delivery.refreshDeadlines() */
  refreshDeadlines(): void {
    for (const entry of [this.inFlight, this.pending]) {
      // Each slot keeps its original deadline across any number of visibility changes.
      if (entry) this.armDeadline(entry)
    }
  }

  /** Starts a fresh renderer epoch after webview readiness; old decode/ACK work loses ownership. @example delivery.begin('new-view') */
  begin(epoch: string): void {
    if (this.closed || epoch === this.epoch) return
    this.invalidate('Webview epoch changed')
    this.epoch = epoch
  }

  /** Retires a hidden renderer before {@link BrowserViewport} waits for a fresh ready handshake. @example delivery.suspend() */
  suspend(): void {
    this.epoch = undefined
    this.invalidate('Webview renderer suspended')
  }

  /** Pins phase evidence before transmission, dropping queued live work until {@link resume}. @example delivery.freeze() */
  freeze(): void {
    this.frozen = true
    this.invalidate('Live delivery superseded by pause image')
  }

  /** Invalidates a retired pause before {@link BrowserViewport} resumes live frames. @example delivery.resume() */
  resume(): void {
    this.frozen = false
    this.invalidate('Pause display invalidated')
  }

  /**
   * Tells whether {@link offer} would take a frame now, without offering one: the same refusals, read at once instead of through the rejected promise; asked by {@link BrowserViewport.previewRecorded} to report whether its preview was posted.
   * @param required - Whether the frame is a required one; a frozen delivery (a pause image) takes only those.
   * @returns `false` when the delivery is closed or has no renderer epoch, when it is frozen and the frame is not required, and when a required frame is already pending; otherwise `true`.
   * @example if (delivery.accepts(false)) void delivery.offer(frame)
   */
  accepts(required: boolean): boolean {
    return (
      !this.closed &&
      this.epoch !== undefined &&
      !(this.frozen && !required) &&
      !this.pending?.message.required
    )
  }

  /** Queues one image with its own deadline; only disposable live pending images can be replaced. @example await delivery.offer({ ...frame, required: true }) */
  offer(
    frame: ViewFrame,
  ): Promise<{ epoch: string; id: number; hash: string }> {
    if (this.closed || !this.epoch)
      return Promise.reject(new Error('Webview is not ready'))
    if (this.frozen && !frame.required)
      return Promise.reject(new Error('Live frame withheld during pause'))
    if (this.pending?.message.required)
      return Promise.reject(new Error('Required frame already pending'))
    if (this.pending) this.reject(this.pending, 'Live frame coalesced')
    const message: FrameMessage = {
      ...frame,
      type: 'frame',
      epoch: this.epoch,
      id: ++this.nextId,
    }
    return new Promise((resolve, reject) => {
      const entry: PendingFrame = {
        message,
        resolve,
        reject,
        sent: false,
        deadlineMs: this.clock() + this.timeoutMs,
      }
      this.pending = entry
      this.armDeadline(entry)
      this.flush()
    })
  }

  /** Confirms only the exact current renderer/frame pair after decode and paint callback. @example delivery.acknowledge('view-1', 1) */
  acknowledge(epoch: string, id: number): boolean {
    const entry = this.inFlight
    if (
      !entry?.sent ||
      entry.message.epoch !== epoch ||
      entry.message.id !== id
    ) {
      this.record('viewport.stale-ack-ignored', { epoch, id })
      return false
    }
    clearTimeout(entry.timer)
    this.inFlight = undefined
    const receipt = { epoch, id, hash: entry.message.hash }
    this.record('viewport.acknowledged', {
      ...receipt,
      phase: entry.message.phase,
    })
    entry.resolve(receipt)
    this.flush()
    return true
  }

  /** Rejects pending ownership when the panel closes; late postMessage results cannot reopen it. @example delivery.dispose() */
  dispose(): void {
    this.closed = true
    this.invalidate('Viewport disposed')
  }

  /** Releases both bounded slots during epoch, pause and lifecycle transitions. @example this.invalidate('epoch changed') */
  private invalidate(reason: string): void {
    if (this.inFlight) this.reject(this.inFlight, reason)
    if (this.pending) this.reject(this.pending, reason)
  }

  /**
   * Expires only consumed paint time for {@link offer} and visibility refreshes, retaining lifecycle cancellation of hidden work.
   * @param entry - Frame whose original deadline is checked and re-armed.
   * @param clockStopped - The previous timer woke without any clock progress (hidden recording), so the next check waits a full budget instead of the tiny remainder.
   * @example this.armDeadline(entry)
   */
  private armDeadline(entry: PendingFrame, clockStopped = false): void {
    clearTimeout(entry.timer)
    if (this.closed || (this.inFlight !== entry && this.pending !== entry))
      return
    const clockTimeMs = this.clock(),
      remainingMs = entry.deadlineMs - clockTimeMs
    // A recording clock stops while Chromium suspends painting; ordinary live clocks still expire in wall time.
    if (remainingMs <= 0) {
      this.reject(entry, new ViewportAckTimeoutError())
      this.flush()
      return
    }
    // Hidden near-expiry clocks poll quietly; visibility refresh still applies their exact remaining deadline.
    entry.timer = setTimeout(
      () => this.armDeadline(entry, this.clock() === clockTimeMs),
      clockStopped ? this.timeoutMs : remainingMs,
    )
  }

  /** Sends the next image immediately only when the previous frame has left its slot. @example this.flush() */
  private flush(): void {
    if (this.closed || this.inFlight || !this.pending) return
    const entry = this.pending
    this.pending = undefined
    this.inFlight = entry
    void Promise.resolve()
      .then(() => {
        if (this.inFlight !== entry || this.closed) return false
        entry.sent = true
        this.record('viewport.sent', {
          epoch: entry.message.epoch,
          id: entry.message.id,
          hash: entry.message.hash,
          phase: entry.message.phase,
        })
        return this.send(entry.message)
      })
      .then((accepted) => {
        // Posting is not painting; a rejected post may arrive after this frame was invalidated.
        if (!accepted && this.inFlight === entry) {
          this.reject(entry, 'Webview rejected frame')
          this.flush()
        }
      })
      .catch((error) => {
        if (this.inFlight === entry) {
          this.reject(entry, String(error))
          this.flush()
        }
      })
  }

  /** Clears just the entry's slot and timer on timeout, replacement or disposal, and rejects the frame's promise. @param failure - The reason in words, or the error to reject with: an expired deadline passes a {@link ViewportAckTimeoutError}. @example this.reject(entry, 'replaced') */
  private reject(entry: PendingFrame, failure: string | Error): void {
    clearTimeout(entry.timer)
    if (this.inFlight === entry) this.inFlight = undefined
    if (this.pending === entry) this.pending = undefined
    // A reason in words becomes a plain error; the acknowledgement timeout arrives as its own type, which the frame's owner reads.
    const error = typeof failure === 'string' ? new Error(failure) : failure
    this.record('viewport.delivery-rejected', {
      id: entry.message.id,
      phase: entry.message.phase,
      reason: error.message,
    })
    entry.reject(error)
  }
}

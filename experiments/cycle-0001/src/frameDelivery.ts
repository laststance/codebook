import { CAPTURE_TIMEOUT_MS } from './constants';

export interface ViewFrame { data: string; hash: string; phase: string; required: boolean; delayAck: boolean }
export interface FrameMessage extends ViewFrame { type: 'frame'; epoch: string; id: number }
interface PendingFrame {
  message: FrameMessage;
  resolve: (receipt: { epoch: string; id: number; hash: string }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  sent: boolean;
}

/** Bounds {@link BrowserViewport} delivery and rejects stale paint ACKs; live frames cannot replace a paused image. @example delivery.begin('view-1'); await delivery.offer(frame) */
export class FrameDelivery {
  // idle -> inFlight + latestPending -> acknowledged; epoch change/disposal rejects both.
  private epoch?: string;
  private nextId = 0;
  private inFlight?: PendingFrame;
  private pending?: PendingFrame;
  private frozen = false;
  private closed = false;

  constructor(private readonly send: (message: FrameMessage) => PromiseLike<boolean>, private readonly record: (type: string, detail?: unknown) => unknown, private readonly timeoutMs = CAPTURE_TIMEOUT_MS) {}

  /** Starts a fresh renderer epoch after webview readiness; old decode/ACK work loses ownership. @example delivery.begin('new-view') */
  begin(epoch: string): void {
    if (this.closed || epoch === this.epoch) return;
    this.invalidate('Webview epoch changed');
    this.epoch = epoch;
  }

  /** Retires a hidden renderer before {@link BrowserViewport} waits for a fresh ready handshake. @example delivery.suspend() */
  suspend(): void {
    this.epoch = undefined;
    this.invalidate('Webview renderer suspended');
  }

  /** Pins phase evidence before transmission, dropping queued live work until {@link resume}. @example delivery.freeze() */
  freeze(): void {
    this.frozen = true;
    this.invalidate('Live delivery superseded by pause image');
  }

  /** Invalidates a retired pause before {@link BrowserViewport} resumes live frames. @example delivery.resume() */
  resume(): void {
    this.frozen = false;
    this.invalidate('Pause display invalidated');
  }

  /** Queues one image with its own deadline; only disposable live pending images can be replaced. @example await delivery.offer({ ...frame, required: true }) */
  offer(frame: ViewFrame): Promise<{ epoch: string; id: number; hash: string }> {
    if (this.closed || !this.epoch) return Promise.reject(new Error('Webview is not ready'));
    if (this.frozen && !frame.required) return Promise.reject(new Error('Live frame withheld during pause'));
    if (this.pending?.message.required) return Promise.reject(new Error('Required frame already pending'));
    if (this.pending) this.reject(this.pending, 'Live frame coalesced');
    const message: FrameMessage = { ...frame, type: 'frame', epoch: this.epoch, id: ++this.nextId };
    return new Promise((resolve, reject) => {
      const entry: PendingFrame = { message, resolve, reject, sent: false, timer: setTimeout(() => {
        this.reject(entry, 'Viewport frame acknowledgement timed out');
        this.flush();
      }, this.timeoutMs) };
      this.pending = entry;
      this.flush();
    });
  }

  /** Confirms only the exact current renderer/frame pair after decode and paint callback. @example delivery.acknowledge('view-1', 1) */
  acknowledge(epoch: string, id: number): boolean {
    const entry = this.inFlight;
    if (!entry?.sent || entry.message.epoch !== epoch || entry.message.id !== id) {
      this.record('viewport.stale-ack-ignored', { epoch, id });
      return false;
    }
    clearTimeout(entry.timer);
    this.inFlight = undefined;
    const receipt = { epoch, id, hash: entry.message.hash };
    this.record('viewport.acknowledged', { ...receipt, phase: entry.message.phase });
    entry.resolve(receipt);
    this.flush();
    return true;
  }

  /** Rejects pending ownership when the panel closes; late postMessage results cannot reopen it. @example delivery.dispose() */
  dispose(): void {
    this.closed = true;
    this.invalidate('Viewport disposed');
  }

  /** Releases both bounded slots during epoch, pause and lifecycle transitions. @example this.invalidate('epoch changed') */
  private invalidate(reason: string): void {
    if (this.inFlight) this.reject(this.inFlight, reason);
    if (this.pending) this.reject(this.pending, reason);
  }

  /** Sends the next image immediately only when the previous frame has left its slot. @example this.flush() */
  private flush(): void {
    if (this.closed || this.inFlight || !this.pending) return;
    const entry = this.pending;
    this.pending = undefined;
    this.inFlight = entry;
    void Promise.resolve().then(() => {
      if (this.inFlight !== entry || this.closed) return false;
      entry.sent = true;
      this.record('viewport.sent', { epoch: entry.message.epoch, id: entry.message.id, hash: entry.message.hash, phase: entry.message.phase });
      return this.send(entry.message);
    }).then(accepted => {
      // Posting is not painting; a rejected post may arrive after this frame was invalidated.
      if (!accepted && this.inFlight === entry) { this.reject(entry, 'Webview rejected frame'); this.flush(); }
    }).catch(error => { if (this.inFlight === entry) { this.reject(entry, String(error)); this.flush(); } });
  }

  /** Clears just the entry's slot and timer on timeout, replacement or disposal. @example this.reject(entry, 'replaced') */
  private reject(entry: PendingFrame, reason: string): void {
    clearTimeout(entry.timer);
    if (this.inFlight === entry) this.inFlight = undefined;
    if (this.pending === entry) this.pending = undefined;
    this.record('viewport.delivery-rejected', { id: entry.message.id, phase: entry.message.phase, reason });
    entry.reject(new Error(reason));
  }
}

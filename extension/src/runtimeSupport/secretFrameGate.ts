import {
  SECRET_FRAME_MARGIN_MS,
  SECRET_FRAME_OBSERVER_GLOBAL,
  SECRET_FRAME_OBSERVER_TIMEOUT_MS,
  SECRET_FRAME_VALUE_COPY_MIN_CHARS,
} from '../constants'

/** Why the gate stopped letting images through for the rest of the run. */
export type SecretFrameFailureReason =
  | 'control-not-password'
  | 'control-replaced'
  | 'value-copied-to-text'
  | 'observer-unanswered'

/** What the in-page observer reports on one verification. */
type ObserverReport = {
  /** The page clock (ms since the epoch) when the report was made. */
  now: number
  /** When the control became unsafe and has not been safe since, or `null`. */
  open: number | null
  /** The closed unsafe intervals `[from, to]` (page clock, ms), most recent last. */
  unsafe: [number, number][]
  /** The first reason the control became unsafe, if it ever did. */
  reason?: SecretFrameFailureReason
}

/** What a consumer of the gate supplies: one way to evaluate an expression in the page. */
export type SecretFrameGateOptions = {
  /**
   * Evaluates a JavaScript expression in the page and returns its JSON value.
   * @throws When the page cannot answer.
   */
  evaluate(expression: string, timeoutMs: number): Promise<unknown>
  /** Called once, when the gate first concludes the control was or may have been visible; the run fails with `SECRET_BECAME_VISIBLE`. */
  onFailure?: (reason: SecretFrameFailureReason) => void
  /** Records a dropped image as an unrecorded gap (the recorder's 4A path). Optional. */
  onDrop?: (detail: { kind: 'frame' | 'capture'; atMs: number }) => void
}

/**
 * Runs inside the page: watches one password control and keeps a record of the times it was not safe to draw.
 * Injected as source text by {@link SecretFrameGate.arm}; it must stay self-contained.
 * A control is unsafe while its `type` is not `password`, while it is no longer the one element the selector finds, and while its value appears in the page's visible text.
 * @param selector - The control's selector.
 * @param globalName - The page global the record is kept under.
 * @param copyMinChars - The shortest value checked for a copy into visible text.
 * @returns `{ ok: true }` once watching, or the reason the control is not a password control now.
 */
function installSecretFrameObserver(
  selector: string,
  globalName: string,
  copyMinChars: number,
):
  | { ok: true; origin: number }
  | { ok: false; reason: SecretFrameFailureReason } {
  const first = document.querySelectorAll(selector)
  const node = first.length === 1 ? first[0] : undefined
  if (!(node instanceof HTMLInputElement) || node.type !== 'password')
    return { ok: false, reason: 'control-not-password' }
  const state: {
    open: number | null
    unsafe: [number, number][]
    reason?: SecretFrameFailureReason
  } = { open: null, unsafe: [] }
  const unsafeReason = (): SecretFrameFailureReason | undefined => {
    const matches = document.querySelectorAll(selector)
    if (!node.isConnected || matches.length !== 1 || matches[0] !== node)
      return 'control-replaced'
    if (node.type !== 'password') return 'control-not-password'
    const value = node.value
    if (
      value.length >= copyMinChars &&
      (document.body?.textContent ?? '').includes(value)
    )
      return 'value-copied-to-text'
    return undefined
  }
  const check = (): void => {
    const reason = unsafeReason()
    const now = Date.now()
    if (reason !== undefined && state.open === null) {
      state.open = now
      state.reason ??= reason
    } else if (reason === undefined && state.open !== null) {
      state.unsafe.push([state.open, now])
      state.open = null
    }
  }
  // A mutation callback runs before the next paint, so any painted unsafe state is recorded.
  new MutationObserver(check).observe(document, {
    attributes: true,
    childList: true,
    subtree: true,
    characterData: true,
  })
  Object.defineProperty(window, globalName, {
    configurable: true,
    value: {
      query: (): ObserverReport => {
        check()
        return {
          now: Date.now(),
          open: state.open,
          unsafe: state.unsafe.slice(-100),
          ...(state.reason !== undefined && { reason: state.reason }),
        }
      },
    },
  })
  return { ok: true, origin: performance.timeOrigin }
}

/**
 * Lets an image of the run's page through only when a password control was safe to draw when the image was captured (ENG-5).
 *
 * Why it exists: Codebook relies on the browser drawing password dots. When a script or a show-password toggle makes the browser draw the text, no frame of that time may be stored or shown as evidence. The claim is honest: the gate does not read pixels; it drops images from windows it cannot call safe and fails the run when the control stopped being a password control.
 * Until {@link SecretFrameGate.arm} is called the gate is inert and every image passes. Created per run; consulted by the screencast delivery of the viewport, by {@link ConfiguredBrowserRun} before a stop screenshot is kept, and by the extension run's pause screenshot. Lane D arms it right before a secret operation is sent.
 * @example
 * const gate = new SecretFrameGate({ evaluate })
 * await gate.arm('input[type=password]')
 * if ((await gate.admitFrame(frame.metadata.timestamp * 1000)) === 'pass') recorder.frame(frame)
 */
export class SecretFrameGate {
  private armedSelector?: string
  private failureReason?: SecretFrameFailureReason
  /** When the first unsafe time began (page clock); every image at or after it is dropped. */
  private firstUnsafeMs?: number
  private intervals: [number, number][] = []
  private lastAnswerMs = 0
  private openSinceMs: number | null = null
  private failureReported = false
  /** The `performance.timeOrigin` of the document the observer was installed in; another value means the page loaded a new document. */
  private documentOrigin?: number

  constructor(private readonly options: SecretFrameGateOptions) {}

  /** Whether a secret operation was announced, so images are checked. */
  get armed(): boolean {
    return this.armedSelector !== undefined
  }

  /** Why capture stopped for the rest of the run, once it did. */
  get failure(): SecretFrameFailureReason | undefined {
    return this.failureReason
  }

  /**
   * Starts watching a password control; from now on every image is checked.
   * Called right before a secret input is sent. A gate that is already armed on the same selector stays armed.
   * @param selector - The selector of the control that receives the secret.
   * @returns Resolves when the observer is installed; if the control is not a password control, or the page cannot answer, the gate fails (the run then fails with `SECRET_BECAME_VISIBLE`) and no image passes.
   * @example
   * await gate.arm('#password')
   */
  async arm(selector: string): Promise<void> {
    if (this.armedSelector === selector) return
    this.armedSelector = selector
    try {
      const result = await this.options.evaluate(
        `(${installSecretFrameObserver.toString()})(${JSON.stringify(selector)},${JSON.stringify(SECRET_FRAME_OBSERVER_GLOBAL)},${SECRET_FRAME_VALUE_COPY_MIN_CHARS})`,
        SECRET_FRAME_OBSERVER_TIMEOUT_MS,
      )
      const parsed = result as {
        ok?: boolean
        origin?: number
        reason?: SecretFrameFailureReason
      }
      if (parsed?.ok !== true)
        this.fail(parsed?.reason ?? 'observer-unanswered', -Infinity)
      else this.documentOrigin = parsed.origin
    } catch {
      this.fail('observer-unanswered', -Infinity)
    }
  }

  /**
   * Decides whether a screencast frame may be stored.
   * @param capturedAtMs - The frame's capture time on the page clock (ms since the epoch).
   * @returns `pass` when a verification answered after the capture shows the control was safe then; `drop` otherwise (the interval is an unrecorded gap).
   * @example
   * await gate.admitFrame(Date.now()) // => 'pass' for an unarmed gate
   */
  admitFrame(capturedAtMs: number): Promise<'pass' | 'drop'> {
    return this.admit(capturedAtMs, capturedAtMs, 'frame')
  }

  /**
   * Decides whether a screenshot taken between two times may be stored.
   * @param startedAtMs - When the screenshot request was sent (page clock, ms since the epoch).
   * @param finishedAtMs - When its answer arrived.
   * @returns `pass` when the control was safe throughout the window; `drop` otherwise.
   * @example
   * await gate.admitCapture(startedAt, Date.now())
   */
  admitCapture(
    startedAtMs: number,
    finishedAtMs: number,
  ): Promise<'pass' | 'drop'> {
    return this.admit(startedAtMs, finishedAtMs, 'capture')
  }

  private async admit(
    fromMs: number,
    toMs: number,
    kind: 'frame' | 'capture',
  ): Promise<'pass' | 'drop'> {
    // Unarmed: nothing secret was sent, every image passes as before.
    if (!this.armed) return 'pass'
    // A verification must answer after the capture; one answered earlier is not reused.
    if (this.lastAnswerMs < toMs + SECRET_FRAME_MARGIN_MS) await this.refresh()
    // The page loaded a new document while the answer was awaited: the secret control is gone and the image shows the new page.
    if (!this.armed) return 'pass'
    const safe =
      this.lastAnswerMs >= toMs &&
      !this.overlapsUnsafe(
        fromMs - SECRET_FRAME_MARGIN_MS,
        toMs + SECRET_FRAME_MARGIN_MS,
      )
    if (safe) return 'pass'
    this.options.onDrop?.({ kind, atMs: toMs })
    return 'drop'
  }

  /** Whether `[fromMs, toMs]` touches a known unsafe time, or follows the first one after a failure. */
  private overlapsUnsafe(fromMs: number, toMs: number): boolean {
    if (this.firstUnsafeMs !== undefined && toMs >= this.firstUnsafeMs)
      return true
    if (this.openSinceMs !== null && toMs >= this.openSinceMs) return true
    return this.intervals.some(([start, end]) => fromMs <= end && toMs >= start)
  }

  /** Asks the observer for its record; an unanswered or lost observer fails the gate. */
  private async refresh(): Promise<void> {
    try {
      const report = (await this.options.evaluate(
        `window[${JSON.stringify(SECRET_FRAME_OBSERVER_GLOBAL)}]?.query() ?? null`,
        SECRET_FRAME_OBSERVER_TIMEOUT_MS,
      )) as ObserverReport | null
      if (report === null || typeof report?.now !== 'number') {
        // A new document has no observer and no password control; only the same document losing its observer is a failure.
        if (await this.documentWasReplaced()) {
          this.release()
          return
        }
        this.fail('observer-unanswered', -Infinity)
        return
      }
      this.lastAnswerMs = report.now
      this.intervals = report.unsafe
      this.openSinceMs = report.open
      const earliest = Math.min(
        report.open ?? Infinity,
        ...report.unsafe.map(([start]) => start),
      )
      if (Number.isFinite(earliest))
        this.fail(report.reason ?? 'control-not-password', earliest)
    } catch {
      this.fail('observer-unanswered', -Infinity)
    }
  }

  /** Asks the page for its document's time origin and compares it with the one the observer was installed in; `false` when the page cannot answer. */
  private async documentWasReplaced(): Promise<boolean> {
    if (this.documentOrigin === undefined) return false
    try {
      const origin = await this.options.evaluate(
        'performance.timeOrigin',
        SECRET_FRAME_OBSERVER_TIMEOUT_MS,
      )
      return typeof origin === 'number' && origin !== this.documentOrigin
    } catch {
      return false
    }
  }

  /**
   * Stops checking images after the page loaded a new document (a sign-in that redirects): the control that received the secret is gone with the old document, so there is no password to draw.
   * A gate that already failed stays failed; a later secret operation arms it again.
   */
  private release(): void {
    if (this.failureReason !== undefined) return
    this.armedSelector = undefined
    this.documentOrigin = undefined
    this.intervals = []
    this.openSinceMs = null
    this.lastAnswerMs = 0
  }

  /** Stops capture for the rest of the run from `fromMs` on and reports the failure once. */
  private fail(reason: SecretFrameFailureReason, fromMs: number): void {
    this.failureReason ??= reason
    this.firstUnsafeMs = Math.min(this.firstUnsafeMs ?? Infinity, fromMs)
    if (this.failureReported) return
    this.failureReported = true
    this.options.onFailure?.(this.failureReason)
  }
}

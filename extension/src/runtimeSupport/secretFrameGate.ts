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
 * The page is unsafe while the armed control is attached but no longer a `password` control, while any other non-password control holds its last value (a replacement that shows it), and while that value appears in the page's rendered text more often than when the value arrived (text the page already showed, such as a "Forgot password?" label, is no copy). A control removed from the page, as a sign-in form that unmounts after its submit, or replaced by another password control shows nothing and stays safe.
 * @param selector - The control's selector.
 * @param globalName - The page global the record is kept under.
 * @param copyMinChars - The shortest value checked for a copy into visible text.
 * @param secretValue - The value the learner will type, when the caller has it: its occurrences in the rendered text are counted now, before the value is sent, so the baseline never depends on whether a page handler registered earlier copies the typed value first. Kept only inside this observer.
 * @returns `{ ok: true }` once watching, or the reason the control is not a password control now.
 */
function installSecretFrameObserver(
  selector: string,
  globalName: string,
  copyMinChars: number,
  secretValue?: string,
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
  // The control's last value while attached: after the control is gone, no other control or text may show it.
  let lastValue = ''
  // How often the value already appeared in the rendered text when it arrived: page text, not a copy.
  let baselineValue: string | undefined
  let baselineOccurrences = 0
  // The rendered text counted before anything is typed.
  if (
    secretValue !== undefined &&
    secretValue !== '' &&
    secretValue.length >= copyMinChars
  ) {
    baselineValue = secretValue
    baselineOccurrences =
      (document.body?.innerText ?? '').split(secretValue).length - 1
  }
  const copiedToText = (value: string): boolean => {
    // `innerText` is the rendered text: script, style and hidden elements are left out.
    const occurrences = (document.body?.innerText ?? '').split(value).length - 1
    if (baselineValue !== value) {
      baselineValue = value
      baselineOccurrences = occurrences
    }
    return occurrences > baselineOccurrences
  }
  const plainControlHolds = (value: string): boolean =>
    Array.from(document.querySelectorAll('input, textarea')).some(
      (element) =>
        element !== node &&
        (element instanceof HTMLTextAreaElement ||
          (element instanceof HTMLInputElement &&
            !['password', 'hidden'].includes(element.type))) &&
        element.value === value,
    )
  const unsafeReason = (): SecretFrameFailureReason | undefined => {
    const matches = document.querySelectorAll(selector)
    const attached =
      node.isConnected && matches.length === 1 && matches[0] === node
    // While attached, the control itself must stay a password control; its value is remembered for the checks below.
    if (attached) {
      if (node.type !== 'password') return 'control-not-password'
      lastValue = node.value
    }
    if (lastValue === '') return undefined
    if (plainControlHolds(lastValue)) return 'control-replaced'
    if (lastValue.length < copyMinChars) return undefined
    return copiedToText(lastValue) ? 'value-copied-to-text' : undefined
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
  // Without a value known beforehand, the baseline is taken when the value first arrives with an input event.
  node.addEventListener('input', check)
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
  /** Every control armed in the current document, each with the page global its observer keeps its record under; all are consulted for each image. */
  private observers: {
    selector: string
    global: string
    /** Held only here and inside the page observer; never logged, journaled or put in a failure. */
    secretValue: string | undefined
  }[] = []
  private observersInstalled = 0
  private failureReason?: SecretFrameFailureReason
  /** When the first unsafe time began (page clock); every image at or after it is dropped. */
  private firstUnsafeMs?: number
  private intervals: [number, number][] = []
  private lastAnswerMs = 0
  /** When the observer was last installed (host clock), where an observer that never answered started to vouch for the page. */
  private armedAtMs = 0
  /** Times between the last verified-safe answer of an observer and the release that followed its document's replacement; no image from them is verified. */
  private unverifiedGaps: [number, number][] = []
  private openSinceMs: number | null = null
  private failureReported = false
  /** The `performance.timeOrigin` of the document the observer was installed in; another value means the page loaded a new document. */
  private documentOrigin?: number

  constructor(private readonly options: SecretFrameGateOptions) {}

  /** Whether a secret operation was announced, so images are checked. */
  get armed(): boolean {
    return this.observers.length > 0
  }

  /** Why capture stopped for the rest of the run, once it did. */
  get failure(): SecretFrameFailureReason | undefined {
    return this.failureReason
  }

  /**
   * Starts watching a password control; from now on every image is checked.
   * Called right before a secret input is sent. A control already armed with the same selector and value stays armed; another control is watched as well, so a password and a confirmation field are both consulted for every image.
   * @param selector - The selector of the control that receives the secret.
   * @param secretValue - The value that will be typed, when known: the observer counts its occurrences in the page's text before it is sent, so a copy made by a page handler that runs before the observer is still a copy. Never logged.
   * @returns Resolves when the observer is installed; if the control is not a password control, or the page cannot answer, the gate fails (the run then fails with `SECRET_BECAME_VISIBLE`) and no image passes.
   * @example
   * await gate.arm('#password', 'correct horse')
   */
  async arm(selector: string, secretValue?: string): Promise<void> {
    if (
      this.observers.some(
        (observer) =>
          observer.selector === selector &&
          observer.secretValue === secretValue,
      )
    )
      return
    // Each observer keeps its own record: a later arm never overwrites an earlier control's.
    this.observersInstalled += 1
    const entry = {
      selector,
      global: `${SECRET_FRAME_OBSERVER_GLOBAL}${this.observersInstalled}`,
      secretValue,
    }
    if (this.observers.length === 0) this.armedAtMs = Date.now()
    this.observers.push(entry)
    try {
      const result = await this.options.evaluate(
        `(${installSecretFrameObserver.toString()})(${JSON.stringify(selector)},${JSON.stringify(entry.global)},${SECRET_FRAME_VALUE_COPY_MIN_CHARS},${JSON.stringify(secretValue)})`,
        SECRET_FRAME_OBSERVER_TIMEOUT_MS,
      )
      const parsed = result as {
        ok?: boolean
        origin?: number
        reason?: SecretFrameFailureReason
      }
      if (parsed?.ok !== true)
        this.fail(parsed?.reason ?? 'observer-unanswered', -Infinity)
      else {
        // Observers of an earlier document are gone with it; what they last vouched for ends there.
        if (
          this.documentOrigin !== undefined &&
          this.documentOrigin !== parsed.origin
        )
          this.retireObserversExcept(entry)
        this.documentOrigin = parsed.origin
      }
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
    // Unarmed: nothing secret was sent, every image passes as before, except those of a gap left by a document replacement.
    if (!this.armed) return this.admitUnarmed(fromMs, toMs, kind)
    // A verification must answer after the capture; one answered earlier is not reused.
    if (this.lastAnswerMs < toMs + SECRET_FRAME_MARGIN_MS) await this.refresh()
    // The page loaded a new document while the answer was awaited: the secret control is gone and the image shows the new page, unless it was captured in the gap before the replacement was noticed.
    if (!this.armed) return this.admitUnarmed(fromMs, toMs, kind)
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

  /** Passes an image of a gate that is not (or no longer) armed unless it overlaps a gap no observer verified. */
  private admitUnarmed(
    fromMs: number,
    toMs: number,
    kind: 'frame' | 'capture',
  ): 'pass' | 'drop' {
    const inGap = this.unverifiedGaps.some(
      ([start, end]) => fromMs <= end && toMs >= start,
    )
    if (!inGap) return 'pass'
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

  /** Asks every armed observer for its record; an unanswered or lost observer fails the gate. */
  private async refresh(): Promise<void> {
    try {
      const reports = (await Promise.all(
        this.observers.map((observer) =>
          this.options.evaluate(
            `window[${JSON.stringify(observer.global)}]?.query() ?? null`,
            SECRET_FRAME_OBSERVER_TIMEOUT_MS,
          ),
        ),
      )) as (ObserverReport | null)[]
      const answered = reports.filter(
        (report): report is ObserverReport => typeof report?.now === 'number',
      )
      if (answered.length < reports.length) {
        // A new document has no observer and no password control; only the same document losing its observer is a failure.
        if (await this.documentWasReplaced()) {
          this.release()
          return
        }
        this.fail('observer-unanswered', -Infinity)
        return
      }
      // The oldest answer is what every observer vouches for.
      this.lastAnswerMs = Math.min(...answered.map((report) => report.now))
      this.intervals = answered.flatMap((report) => report.unsafe)
      const opens = answered.flatMap((report) =>
        report.open === null ? [] : [report.open],
      )
      this.openSinceMs = opens.length > 0 ? Math.min(...opens) : null
      const earliest = Math.min(
        ...opens,
        ...this.intervals.map(([start]) => start),
      )
      if (Number.isFinite(earliest))
        this.fail(
          answered.find(
            (report) => report.open !== null || report.unsafe.length > 0,
          )?.reason ?? 'control-not-password',
          earliest,
        )
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
    this.retireObserversExcept(undefined)
    this.documentOrigin = undefined
  }

  /**
   * Forgets the observers of a document that was replaced and records the time they could no longer vouch for.
   * Images captured after the old observers last vouched for the page and before this point (a show-password toggle followed at once by a submit that navigates) were never verified.
   * @param keep - The observer just installed in the new document, which stays.
   */
  private retireObserversExcept(
    keep: (typeof this.observers)[number] | undefined,
  ): void {
    this.unverifiedGaps.push([
      this.lastAnswerMs > 0 ? this.lastAnswerMs : this.armedAtMs,
      Date.now(),
    ])
    this.observers = keep ? [keep] : []
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

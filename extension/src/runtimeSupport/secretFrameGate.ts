/**
 * Stated limits of the in-page observer (what it cannot verify, so a green gate does not claim it):
 * - Canvas text is checked only through `fillText` and `strokeText` (2D and offscreen contexts, in every same-origin realm reached by the observer); WebGL, `drawImage` of pre-rendered images and a draw made in a frame before the observer first reaches it are not checked.
 * - Attributes are checked (CSS `attr()` content, `title` tooltips), but CSS `content` with a literal string in a stylesheet the page builds is not.
 * - Closed shadow roots have no readable content. A frame from another origin has none either: while one is drawn after a secret was sent, images are withheld as `drop-cross-origin-frame` (a gap, never a failure); one that navigates to another origin is noticed at the next check, and its start is dated to the last full check that saw none.
 *
 * The secret frame gate's invariant (every branch of the in-page observer and of the image paths below is checked against it):
 * while armed, and after a document replacement, an image passes only if a verification that answered after its capture time shows no armed control, and no other control or rendered text, showed the secret then.
 * A time that no verification covers (an observer that never answered, the gap between the last answer and a document's replacement) is not safe; it is a gap, not a pass.
 * Every image of a run that has a gate, stream frame or stop capture, asks the gate, armed or not, and reaches the recorder in the order it arrived.
 */
import {
  SECRET_FRAME_EMBEDDED_DOCUMENT_SELECTOR,
  SECRET_FRAME_MARGIN_MS,
  SECRET_FRAME_RETIRED_INTERVALS_MAX,
  SECRET_FRAME_MIN_VERIFICATION_INTERVAL_MS,
  SECRET_FRAME_SUMMARY_INTERVAL_MS,
  SECRET_FRAME_MAX_REPLACEMENTS_IN_A_ROW,
  SECRET_FRAME_OBSERVER_GLOBAL,
  SECRET_FRAME_OBSERVER_INTERVALS_MAX,
  SECRET_FRAME_OBSERVER_TIMEOUT_MS,
  SECRET_FRAME_VALUE_COPY_MIN_CHARS,
} from '../constants'

import { coalesceOldestIntervals } from './utils/coalesceOldestIntervals'

/** Why the gate stopped letting images through for the rest of the run. */
export type SecretFrameFailureReason =
  | 'control-not-password'
  | 'control-replaced'
  | 'value-copied-to-text'
  | 'observer-unanswered'

/** Why an image was withheld: the gate could not call it safe, or a frame it cannot read was drawn. */
export type SecretFrameWithholdReason =
  'secret-not-verified' | 'cross-origin-frame'

/** The gate's answer for one image: `pass`, or a withheld verdict. Callers test `!== 'pass'`, never `=== 'drop'`. */
export type SecretFrameVerdict = 'pass' | 'drop' | 'drop-cross-origin-frame'

/** The reason a withheld verdict stands for. */
export const WITHHOLD_REASON_OF_VERDICT: Readonly<
  Record<Exclude<SecretFrameVerdict, 'pass'>, SecretFrameWithholdReason>
> = {
  drop: 'secret-not-verified',
  'drop-cross-origin-frame': 'cross-origin-frame',
}

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
  /** When a drawn frame from another origin appeared and has not left since (backdated to the last full check that saw none), or `null`. */
  crossOriginOpen?: number | null
  /** The closed intervals `[from, to]` (page clock, ms) a frame from another origin was drawn, most recent last; past {@link SECRET_FRAME_OBSERVER_INTERVALS_MAX} the oldest one spans several. */
  crossOrigin?: [number, number][]
}

/** The gate's counts since its last summary; a journal receives this instead of one event per verification or dropped image. */
export type SecretFrameGateSummary = {
  /** When the counted interval began (host clock, ms since the epoch). */
  sinceMs: number
  /** When it ended. */
  untilMs: number
  /** Verification requests sent to the page. */
  verifications: number
  /** Verifications the page did not answer. */
  failures: number
  /** Images of an armed gate let through. */
  passes: number
  /** Images of an armed or released gate withheld. */
  drops: number
  /** Of the drops, those for a drawn frame from another origin. */
  crossOriginDrops: number
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
  onDrop?: (detail: {
    kind: 'frame' | 'capture'
    atMs: number
    reason: SecretFrameWithholdReason
  }) => void
  /** Receives the counts of an interval of at least {@link SECRET_FRAME_SUMMARY_INTERVAL_MS}, and the rest on {@link SecretFrameGate.flushSummary}. Optional. */
  onSummary?: (summary: SecretFrameGateSummary) => void
}

/**
 * Runs inside the page: watches one password control and keeps a record of the times it was not safe to draw.
 * Injected as source text by {@link SecretFrameGate.arm}; it must stay self-contained.
 * The page is unsafe while the armed element is connected but no longer a `password` control (whatever its selector matches now: the selector only serves to notice a replacement), while any other non-password control holds its last value (a replacement that shows it), while that value appears in the page's rendered text or in element attributes more often than when the value arrived, and after any canvas text call that holds it (text the page already showed, such as a "Forgot password?" label, is no copy). A control removed from the page, as a sign-in form that unmounts after its submit, or replaced by another password control shows nothing and stays safe.
 * @param selector - The control's selector, or `null` in a document that replaced the one the learner typed in: there is no password control to watch, the value was never page text there (its baseline is zero), and only copies in rendered text and in plain controls are checked.
 * @param globalName - The page global the record is kept under.
 * @param copyMinChars - The shortest value checked for a copy into visible text.
 * @param embeddedDocumentSelector - The elements that hold another document; one whose document the page cannot read counts as an unreadable frame, and while one is drawn the observer keeps a cross-origin interval.
 * @param secretValue - The value the learner will type, when the caller has it: its occurrences in the rendered text are counted now, before the value is sent, so the baseline never depends on whether a page handler registered earlier copies the typed value first. Kept only inside this observer.
 * @param intervalsMax - How many intervals of each kind a report holds ({@link SECRET_FRAME_OBSERVER_INTERVALS_MAX}); the cross-origin record merges its oldest instead of dropping them.
 * @returns `{ ok: true }` once watching, or the reason the control is not a password control now.
 */
function installSecretFrameObserver(
  selector: string | null,
  globalName: string,
  copyMinChars: number,
  secretValue: string | undefined,
  embeddedDocumentSelector: string,
  intervalsMax: number,
):
  | { ok: true; origin: number }
  | { ok: false; reason: SecretFrameFailureReason } {
  // The one element a selector matches now, or `undefined` when it matches none or several.
  const onlyMatch = (query: string): Element | undefined => {
    const matches = document.querySelectorAll(query)
    return matches.length === 1 ? matches[0] : undefined
  }
  // The control to watch: `undefined` in a replacing document, which has none; `null` when the selector does not match exactly one password control now.
  const findArmedControl = (): HTMLInputElement | null | undefined => {
    if (selector === null) return undefined
    const found = onlyMatch(selector)
    return found instanceof HTMLInputElement && found.type === 'password'
      ? found
      : null
  }
  const node = findArmedControl()
  if (node === null) return { ok: false, reason: 'control-not-password' }
  const state: {
    open: number | null
    unsafe: [number, number][]
    reason?: SecretFrameFailureReason
  } = { open: null, unsafe: [] }
  // The last non-empty value the control held: a page that clears the control after copying it must not end the checks.
  let lastValue = ''
  // How often each value already appeared in the rendered text when it arrived: page text, not a copy.
  const baselines = new Map<string, number>()
  // Every root the learner could see: the page, the open shadow roots in it and the same-origin frames in it, recursively. A cross-origin frame has no readable document, so its text and controls cannot be checked: while one is drawn, the observer keeps a cross-origin interval and the gate withholds images instead.
  // Realm-independent: a frame's nodes fail the parent realm's `instanceof`, so roots and elements are told apart by `nodeType` and `tagName`.
  const observedRoots = new WeakSet<object>()
  // Set once any canvas of any reachable realm was asked to draw a watched value: pixels already drawn cannot be read back, so the page stays unsafe for the rest of the run.
  let drewValueOnCanvas = false
  // The realms this observer already registered with, so a realm is visited once per observer.
  const wrappedRealms = new WeakSet<object>()
  // Shared by every observer of a realm: a drawing method is wrapped once, and each observer joins the wrapper's listeners (a second arm or a re-arm wraps nothing again).
  const listenersKey = Symbol.for('codebook.secretFrameCanvasListeners')
  // A canvas drawing method once wrapped: it carries the listeners of every observer of its realm.
  type CanvasTextMethod = ((...args: unknown[]) => unknown) & {
    [key: symbol]: Set<(text: unknown) => void>
  }
  // A value checked for copies is non-empty and at least `copyMinChars` long; a shorter one cannot be told from page text.
  const watchable = (value: string | undefined): string | undefined =>
    value !== undefined && value !== '' && value.length >= copyMinChars
      ? value
      : undefined
  const typedValue = watchable(secretValue)
  // Both the typed value and the last one the control held are checked for the rest of the run, whatever the control holds now.
  const watchedValues = (): string[] =>
    [typedValue, lastValue].filter(
      (value): value is string => value !== undefined && value !== '',
    )
  // Each root has exactly one mutation observer, the page's document included (a second one would run every full check twice).
  const observeRoot = (root: ParentNode): void => {
    if (observedRoots.has(root)) return
    observedRoots.add(root)
    new MutationObserver(() => check()).observe(root, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    })
  }
  // The document an embedding element (iframe, frame, object, embed) shows; null when another origin refuses access, so its content cannot be checked.
  const embeddedDocument = (element: Element): Document | null => {
    try {
      return element.tagName === 'EMBED'
        ? ((element as HTMLEmbedElement).getSVGDocument?.() ?? null)
        : ((element as HTMLIFrameElement).contentDocument ?? null)
    } catch {
      return null
    }
  }
  // The roots one element opens: its open shadow root, and the document of a same-origin embedded frame.
  const rootsInside = (element: Element): ParentNode[] => {
    const inner: ParentNode[] = element.shadowRoot ? [element.shadowRoot] : []
    const embedded = element.matches(embeddedDocumentSelector)
      ? embeddedDocument(element)
      : null
    if (embedded) inner.push(embedded)
    return inner
  }
  const visibleRoots = (): ParentNode[] => {
    const roots: ParentNode[] = []
    const visit = (root: ParentNode): void => {
      roots.push(root)
      // A frame document has its own canvas prototypes: wrap them as soon as the frame is reachable.
      if ((root as Node).nodeType === 9)
        wrapCanvasRealm((root as Document).defaultView)
      // Mutations in a shadow root or a frame document are not seen by the observer on the page's document.
      observeRoot(root)
      for (const element of Array.from(root.querySelectorAll('*')))
        for (const inner of rootsInside(element)) visit(inner)
    }
    visit(document)
    return roots
  }
  const countIn = (text: string, value: string): number =>
    text.split(value).length - 1
  // `innerText` is the rendered text (script, style and hidden elements are left out); a shadow root has none of its own, so its children's are read.
  const occurrencesInRoot = (root: ParentNode, value: string): number => {
    if ((root as Node).nodeType === 9)
      return countIn((root as Document).body?.innerText ?? '', value)
    return Array.from(root.children).reduce(
      (total, child) =>
        total + countIn((child as HTMLElement).innerText ?? '', value),
      0,
    )
  }
  // Attributes are drawn by CSS `attr()` generated content and by `title` tooltips. Left out: hidden inputs (never drawn), the armed control's own `value` attribute and the `value` attribute of any password input (React syncs a controlled input's attribute, and a password input never draws it).
  const isHiddenInput = (element: Element): boolean =>
    element.tagName === 'INPUT' &&
    (element as HTMLInputElement).type === 'hidden'
  const isUndrawnValueAttribute = (
    element: Element,
    attributeName: string,
  ): boolean =>
    attributeName === 'value' &&
    element.tagName === 'INPUT' &&
    (element === node || (element as HTMLInputElement).type === 'password')
  const attributeOccurrencesInElement = (
    element: Element,
    value: string,
  ): number => {
    if (isHiddenInput(element)) return 0
    let total = 0
    for (const attribute of Array.from(element.attributes))
      if (!isUndrawnValueAttribute(element, attribute.name))
        total += countIn(attribute.value, value)
    return total
  }
  const attributeOccurrencesInRoot = (
    root: ParentNode,
    value: string,
  ): number =>
    Array.from(root.querySelectorAll('*')).reduce(
      (total, element) => total + attributeOccurrencesInElement(element, value),
      0,
    )
  const occurrencesOf = (value: string): number =>
    visibleRoots().reduce(
      (total, root) =>
        total +
        occurrencesInRoot(root, value) +
        attributeOccurrencesInRoot(root, value),
      0,
    )
  // The value the learner will type is counted before anything is typed; in a replacing document the value was never page text, so any occurrence is a copy.
  const recordTypedBaseline = (): void => {
    if (typedValue === undefined) return
    baselines.set(typedValue, selector === null ? 0 : occurrencesOf(typedValue))
  }
  const copiedToText = (value: string): boolean => {
    const occurrences = occurrencesOf(value)
    const baseline = baselines.get(value)
    if (baseline === undefined) {
      baselines.set(value, occurrences)
      return false
    }
    return occurrences > baseline
  }
  // A control other than the armed one shows the value when it holds it whole (a longer value that contains a long secret counts, a short one must match exactly).
  const holdsValue = (held: string, value: string): boolean =>
    value.length >= copyMinChars ? held.includes(value) : held === value
  // A canvas call is the only moment its text is known: a call whose text holds a watched value marks the page unsafe for good.
  const noteCanvasText = (text: unknown): void => {
    // The control may hold a value the observer has not read yet.
    armedControlReason()
    const drawn = String(text)
    if (watchedValues().some((value) => holdsValue(drawn, value))) {
      drewValueOnCanvas = true
      check(false)
    }
  }
  const wrapCanvasMethod = (
    prototype: Record<string, unknown>,
    method: string,
  ): void => {
    const original = prototype[method] as CanvasTextMethod | undefined
    if (typeof original !== 'function') return
    // Already wrapped by an earlier arm: only join its listeners.
    const existing = original[listenersKey]
    if (existing !== undefined) {
      existing.add(noteCanvasText)
      return
    }
    const listeners = new Set([noteCanvasText])
    const wrapper = function (this: unknown, ...args: unknown[]) {
      for (const listener of listeners) listener(args[0])
      return Reflect.apply(original, this, args)
    } as CanvasTextMethod
    wrapper[listenersKey] = listeners
    prototype[method] = wrapper
  }
  // A realm's prototype of one canvas context type, or `undefined` when the realm has no such type.
  const canvasPrototype = (
    realm: Window,
    constructorName: string,
  ): Record<string, unknown> | undefined =>
    (
      realm as unknown as Record<
        string,
        { prototype: Record<string, unknown> } | undefined
      >
    )[constructorName]?.prototype
  const wrapCanvasContext = (
    prototype: Record<string, unknown> | undefined,
  ): void => {
    if (prototype === undefined) return
    for (const method of ['fillText', 'strokeText'])
      wrapCanvasMethod(prototype, method)
  }
  const wrapCanvasPrototypes = (realm: Window): void => {
    try {
      for (const constructorName of [
        'CanvasRenderingContext2D',
        'OffscreenCanvasRenderingContext2D',
      ])
        wrapCanvasContext(canvasPrototype(realm, constructorName))
    } catch {
      // A realm that refuses the wrap (frozen prototype) is a stated limit of this gate.
    }
  }
  const wrapCanvasRealm = (realm: Window | null): void => {
    if (realm === null || wrappedRealms.has(realm)) return
    wrappedRealms.add(realm)
    wrapCanvasPrototypes(realm)
  }
  // A plain control draws its value as text: a textarea, or an input that is neither a password nor hidden.
  const drawsValue = (element: Element): boolean =>
    element.tagName === 'TEXTAREA' ||
    (element.tagName === 'INPUT' &&
      !['password', 'hidden'].includes((element as HTMLInputElement).type))
  const plainControlHolds = (value: string, roots: ParentNode[]): boolean =>
    roots.some((root) =>
      Array.from(root.querySelectorAll('input, textarea')).some(
        (element) =>
          element !== node &&
          drawsValue(element) &&
          holdsValue((element as HTMLInputElement).value, value),
      ),
    )
  const rememberValue = (control: HTMLInputElement): void => {
    if (control.value !== '') lastValue = control.value
  }
  // The armed element itself, whatever the selector matches now: the selector only serves to notice a replacement.
  const armedControlReason = (): SecretFrameFailureReason | undefined => {
    if (node === undefined || !node.isConnected) return undefined
    // A show-password toggle changes the type; the selector may stop matching by then.
    if (node.type !== 'password') return 'control-not-password'
    rememberValue(node)
    return undefined
  }
  const textCopyReason = (
    watched: string[],
  ): SecretFrameFailureReason | undefined =>
    watched.some((value) => value.length >= copyMinChars && copiedToText(value))
      ? 'value-copied-to-text'
      : undefined
  const watchedValueReason = (
    watched: string[],
    withText: boolean,
  ): SecretFrameFailureReason | undefined => {
    // The per-paint check reads the page's own controls only; a full check also reads shadow roots and frames.
    const roots = withText ? visibleRoots() : [document]
    if (watched.some((value) => plainControlHolds(value, roots)))
      return 'control-replaced'
    return withText ? textCopyReason(watched) : undefined
  }
  const unsafeReason = (
    withText: boolean,
  ): SecretFrameFailureReason | undefined => {
    const own = armedControlReason()
    if (own !== undefined) return own
    if (drewValueOnCanvas) return 'value-copied-to-text'
    return watchedValueReason(watchedValues(), withText)
  }
  // An unsafe time opens once; the first reason the page became unsafe is kept.
  const openUnsafe = (reason: SecretFrameFailureReason, now: number): void => {
    if (state.open !== null) return
    state.open = now
    state.reason ??= reason
  }
  const closeUnsafe = (now: number): void => {
    if (state.open === null) return
    state.unsafe.push([state.open, now])
    state.open = null
  }
  // Whether a box is non-empty and overlaps its own window's viewport.
  const boxInViewport = (box: DOMRect, view: Window): boolean =>
    box.width > 0 &&
    box.height > 0 &&
    box.right > 0 &&
    box.bottom > 0 &&
    box.left < view.innerWidth &&
    box.top < view.innerHeight
  // Whether an element is drawn on screen: a non-empty box, not hidden by display/visibility/opacity/content-visibility, inside its own window's viewport, and inside a drawn host frame.
  const isDrawn = (element: Element): boolean => {
    const view = element.ownerDocument.defaultView
    if (view === null) return false
    if (!boxInViewport(element.getBoundingClientRect(), view)) return false
    const visible = element.checkVisibility?.({
      checkOpacity: true,
      checkVisibilityCSS: true,
      opacityProperty: true,
      visibilityProperty: true,
      contentVisibilityAuto: true,
    })
    if (visible === false) return false
    return view.frameElement === null || isDrawn(view.frameElement)
  }
  // The embedding elements seen by the last full check; a per-paint check also reads the page's own document.
  let knownEmbeds: Element[] = []
  // Whether any embedding element whose document cannot be read is drawn now.
  const unreadableEmbedDrawn = (full: boolean): boolean => {
    if (full)
      knownEmbeds = visibleRoots().flatMap((root) =>
        Array.from(root.querySelectorAll(embeddedDocumentSelector)),
      )
    const candidates = full
      ? knownEmbeds
      : [
          ...knownEmbeds,
          ...Array.from(document.querySelectorAll(embeddedDocumentSelector)),
        ]
    return candidates.some(
      (element) =>
        element.isConnected &&
        embeddedDocument(element) === null &&
        isDrawn(element),
    )
  }
  // The times a frame from another origin was drawn. An interval opens at the last full check that saw none (a frame can navigate to another origin with no mutation in this page) and closes only on a full check.
  const crossOrigin: {
    open: number | null
    closed: [number, number][]
    clearSinceMs: number
  } = { open: null, closed: [], clearSinceMs: Date.now() }
  // Ends the open interval at `now`. Past the cap the two oldest closed intervals become one that spans both: the record stays bounded and loses no drawn time (the gap between them is withheld too).
  const closeCrossOrigin = (now: number): void => {
    if (crossOrigin.open === null) return
    crossOrigin.closed.push([crossOrigin.open, now])
    crossOrigin.open = null
    if (crossOrigin.closed.length <= intervalsMax) return
    const oldest = crossOrigin.closed.splice(0, 2)
    crossOrigin.closed.unshift([
      Math.min(...oldest.map(([from]) => from)),
      Math.max(...oldest.map(([, to]) => to)),
    ])
  }
  const checkCrossOrigin = (full: boolean): void => {
    const now = Date.now()
    if (unreadableEmbedDrawn(full))
      crossOrigin.open ??= crossOrigin.clearSinceMs
    // Only a full check reads every root, so only it ends an interval or moves the time a new one is dated to: a per-paint check that saw none may have skipped the root that holds the frame (a frame's own navigation, a shadow root attached since).
    else if (full) {
      closeCrossOrigin(now)
      crossOrigin.clearSinceMs = now
    }
  }
  // `full` reads the rendered text as well; a check that skips it can open an unsafe time but never ends one.
  const check = (full = true): void => {
    const reason = unsafeReason(full)
    const now = Date.now()
    if (reason !== undefined) openUnsafe(reason, now)
    else if (full) closeUnsafe(now)
    checkCrossOrigin(full)
  }
  // A value set by script raises no mutation: the controls are read before every paint as well.
  const watchPaints = (): void => {
    check(false)
    requestAnimationFrame(watchPaints)
  }
  recordTypedBaseline()
  wrapCanvasRealm(window)
  // Without a value known beforehand, the baseline is taken when the value first arrives with an input event.
  node?.addEventListener('input', () => check())
  // A mutation callback runs before the next paint, so any painted unsafe state is recorded.
  observeRoot(document)
  checkCrossOrigin(true)
  requestAnimationFrame(watchPaints)
  // A replacing document may already show the value: the unsafe time then starts now, not at the first query.
  if (selector === null) check()
  Object.defineProperty(window, globalName, {
    configurable: true,
    value: {
      query: (): ObserverReport => {
        check()
        return {
          now: Date.now(),
          open: state.open,
          unsafe: state.unsafe.slice(-intervalsMax),
          crossOriginOpen: crossOrigin.open,
          crossOrigin: crossOrigin.closed.slice(),
          ...(state.reason !== undefined && { reason: state.reason }),
        }
      },
    },
  })
  return { ok: true, origin: performance.timeOrigin }
}

/**
 * The page expression that installs one {@link installSecretFrameObserver} with the gate's constants.
 * Built by {@link SecretFrameGate.arm} for an armed control and by the gate when it follows a document replacement (`selector` `null`).
 * @param selector - The armed control's selector, or `null` in a replacing document.
 * @param globalName - The page global the observer keeps its record under.
 * @param secretValue - The typed value, when known; it stays inside the page observer.
 * @returns The expression to evaluate in the page; its value is the observer's install result.
 * @example
 * observerInstallExpression('#pw', '__codebookSecretFrameGate1', undefined) // => '(function installSecretFrameObserver(…) {…})("#pw","__codebookSecretFrameGate1",4,undefined,"iframe, …",100)'
 */
function observerInstallExpression(
  selector: string | null,
  globalName: string,
  secretValue: string | undefined,
): string {
  return `(${installSecretFrameObserver.toString()})(${JSON.stringify(selector)},${JSON.stringify(globalName)},${SECRET_FRAME_VALUE_COPY_MIN_CHARS},${JSON.stringify(secretValue)},${JSON.stringify(SECRET_FRAME_EMBEDDED_DOCUMENT_SELECTOR)},${SECRET_FRAME_OBSERVER_INTERVALS_MAX})`
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
    /** `null` for an observer installed in a document that replaced the one the learner typed in. */
    selector: string | null
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
  /** When a secret too short to tell from ordinary page text was sent (host clock); no image from then on can be verified, so every one is dropped. */
  private unverifiableSinceMs?: number
  /** When the observer was last installed (host clock), where an observer that never answered started to vouch for the page. */
  private armedAtMs = 0
  /** Times between the last verified-safe answer of an observer and the release that followed its document's replacement; no image from them is verified. */
  private unverifiedGaps: [number, number][] = []
  private openSinceMs: number | null = null
  private failureReported = false
  /** The `performance.timeOrigin` of the document the observer was installed in; another value means the page loaded a new document. */
  private documentOrigin?: number
  /** How many document replacements were followed without an answer from a new observer between them. */
  private replacementsInRow = 0
  /** The verification waiting for its send time; every image captured before it is sent joins it and is answered by its report. */
  private pendingVerification?: Promise<void>
  /** The verification whose request is on the wire, so no second one is sent meanwhile. */
  private verificationInFlight?: Promise<void>
  /** When the last verification request was sent (host clock). */
  private lastVerificationSentMs = 0
  private counts = {
    verifications: 0,
    failures: 0,
    passes: 0,
    drops: 0,
    crossOriginDrops: 0,
  }
  /** The times a drawn frame from another origin was on screen in the current document, reported by its observers (page clock). Never a failure. Each report covers every interval its observer closed (the oldest merged past the cap), so the latest replaces the one before. */
  private crossOriginIntervals: [number, number][] = []
  /** When a drawn frame from another origin appeared and has not left (page clock), or `null`. */
  private crossOriginOpenSinceMs: number | null = null
  /** Cross-origin intervals of replaced documents, so a late image of an old document is still withheld. */
  private retiredCrossOriginIntervals: [number, number][] = []
  private withheldTotals = { crossOriginFrame: 0, secretNotVerified: 0 }
  private summarySinceMs = Date.now()

  constructor(private readonly options: SecretFrameGateOptions) {}

  /** Whether a secret operation was announced, so images are checked. */
  get armed(): boolean {
    return this.observers.length > 0
  }

  /**
   * How many images the gate withheld in this run, by reason.
   * Read by {@link ConfiguredBrowserRun} for the run resource.
   * @example gate.withheld // => { crossOriginFrame: 1, secretNotVerified: 0 }
   */
  get withheld(): Readonly<{
    crossOriginFrame: number
    secretNotVerified: number
  }> {
    return this.withheldTotals
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
    // A value shorter than the copy minimum cannot be told from page text: its copies are never checked, so no later image is claimed safe.
    if (
      secretValue !== undefined &&
      secretValue !== '' &&
      secretValue.length < SECRET_FRAME_VALUE_COPY_MIN_CHARS
    )
      this.unverifiableSinceMs ??= Date.now()
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
        observerInstallExpression(selector, entry.global, secretValue),
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
   * @returns `pass` when a verification answered after the capture shows the control was safe then and no frame from another origin was drawn; `drop` or `drop-cross-origin-frame` otherwise (the interval is an unrecorded gap).
   * @example
   * await gate.admitFrame(Date.now()) // => 'pass' for an unarmed gate
   */
  admitFrame(capturedAtMs: number): Promise<SecretFrameVerdict> {
    return this.admit(capturedAtMs, capturedAtMs, 'frame')
  }

  /**
   * Decides whether a screenshot taken between two times may be stored.
   * @param startedAtMs - When the screenshot request was sent (page clock, ms since the epoch).
   * @param finishedAtMs - When its answer arrived.
   * @returns `pass` when the control was safe throughout the window and no frame from another origin was drawn; `drop` or `drop-cross-origin-frame` otherwise.
   * @example
   * await gate.admitCapture(startedAt, Date.now())
   */
  admitCapture(
    startedAtMs: number,
    finishedAtMs: number,
  ): Promise<SecretFrameVerdict> {
    return this.admit(startedAtMs, finishedAtMs, 'capture')
  }

  private async admit(
    fromMs: number,
    toMs: number,
    kind: 'frame' | 'capture',
  ): Promise<SecretFrameVerdict> {
    // Fail-closed default for any caller that arms with a value shorter than the copy minimum: Codebook cannot verify any later image, so it is an unrecorded gap; the run itself goes on. The run's own callers never reach this: the ask-learner box and a prepared password both refuse such a value before it is typed.
    if (
      this.unverifiableSinceMs !== undefined &&
      toMs >= this.unverifiableSinceMs
    ) {
      return this.withhold(kind, toMs, 'secret-not-verified')
    }
    // Unarmed: nothing secret was sent, every image passes as before, except those of a gap left by a document replacement.
    if (!this.armed) return this.admitUnarmed(fromMs, toMs, kind)
    // A verification must answer after the capture; one answered earlier is not reused. One that was already on the wire when the image arrived answers an earlier time, so the image asks for the next one.
    if (this.lastAnswerMs < toMs + SECRET_FRAME_MARGIN_MS) {
      await this.requestVerification()
      if (this.lastAnswerMs < toMs && this.failureReason === undefined)
        await this.requestVerification()
    }
    // The page loaded a new document while the answer was awaited: the secret control is gone and the image shows the new page, unless it was captured in the gap before the replacement was noticed.
    if (!this.armed) return this.admitUnarmed(fromMs, toMs, kind)
    const safe =
      this.lastAnswerMs >= toMs &&
      !this.inUnverifiedGap(fromMs, toMs) &&
      !this.overlapsUnsafe(
        fromMs - SECRET_FRAME_MARGIN_MS,
        toMs + SECRET_FRAME_MARGIN_MS,
      )
    if (!safe) return this.withhold(kind, toMs, 'secret-not-verified')
    // The observers cannot read a frame from another origin: an image in which one was drawn is withheld, and the run goes on.
    if (this.overlapsCrossOrigin(fromMs, toMs))
      return this.withhold(kind, toMs, 'cross-origin-frame')
    this.count('passes')
    return 'pass'
  }

  /** Records one withheld image (journal count, totals, recorder gap) and returns its verdict. */
  private withhold(
    kind: 'frame' | 'capture',
    atMs: number,
    reason: SecretFrameWithholdReason,
  ): Exclude<SecretFrameVerdict, 'pass'> {
    this.options.onDrop?.({ kind, atMs, reason })
    const verdict =
      reason === 'cross-origin-frame' ? 'drop-cross-origin-frame' : 'drop'
    if (verdict === 'drop-cross-origin-frame') {
      this.counts.crossOriginDrops += 1
      this.withheldTotals.crossOriginFrame += 1
    } else this.withheldTotals.secretNotVerified += 1
    // Counted last: counting may hand the interval's summary over, and every count of this drop belongs to that summary.
    this.count('drops')
    return verdict
  }

  /** Whether `[fromMs, toMs]` (widened by the margin) touches a time a frame from another origin was drawn, in this document or a replaced one. */
  private overlapsCrossOrigin(fromMs: number, toMs: number): boolean {
    const from = fromMs - SECRET_FRAME_MARGIN_MS
    const to = toMs + SECRET_FRAME_MARGIN_MS
    if (
      this.crossOriginOpenSinceMs !== null &&
      to >= this.crossOriginOpenSinceMs
    )
      return true
    return [
      ...this.crossOriginIntervals,
      ...this.retiredCrossOriginIntervals,
    ].some(([start, end]) => from <= end && to >= start)
  }

  /** Adds to a count and journals the interval's summary once it is long enough. */
  private count(name: keyof SecretFrameGate['counts']): void {
    this.counts[name] += 1
    if (Date.now() - this.summarySinceMs >= SECRET_FRAME_SUMMARY_INTERVAL_MS)
      this.flushSummary()
  }

  /**
   * Hands the counts of the interval so far to {@link SecretFrameGateOptions.onSummary}, when anything was counted.
   * Called by the gate itself on an interval and by the run when it ends, so a short run still journals its counts.
   * @example gate.flushSummary()
   */
  flushSummary(): void {
    const { verifications, failures, passes, drops, crossOriginDrops } =
      this.counts
    if (verifications + failures + passes + drops === 0) return
    const untilMs = Date.now()
    this.options.onSummary?.({
      sinceMs: this.summarySinceMs,
      untilMs,
      verifications,
      failures,
      passes,
      drops,
      crossOriginDrops,
    })
    this.summarySinceMs = untilMs
    this.counts = {
      verifications: 0,
      failures: 0,
      passes: 0,
      drops: 0,
      crossOriginDrops: 0,
    }
  }

  /**
   * Returns a verification that is sent after this call: at most one is on the wire, two requests are at least {@link SECRET_FRAME_MIN_VERIFICATION_INTERVAL_MS} apart, and every image asking before the send shares it.
   * Nothing is sent unless an image asked, so a page with no new image costs no request.
   */
  private requestVerification(): Promise<void> {
    this.pendingVerification ??= this.sendVerification()
    return this.pendingVerification
  }

  private async sendVerification(): Promise<void> {
    // The caller stores this promise before the send time is reached.
    await Promise.resolve()
    await this.verificationInFlight
    const waitMs =
      this.lastVerificationSentMs +
      SECRET_FRAME_MIN_VERIFICATION_INTERVAL_MS -
      Date.now()
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
    // From here on an image asking needs a verification sent after it.
    this.pendingVerification = undefined
    this.lastVerificationSentMs = Date.now()
    this.counts.verifications += 1
    const flight = this.refresh()
    this.verificationInFlight = flight
    try {
      await flight
    } finally {
      if (this.verificationInFlight === flight)
        this.verificationInFlight = undefined
    }
  }

  /** Passes an image of a gate that is not (or no longer) armed unless it overlaps a gap no observer verified. */
  private admitUnarmed(
    fromMs: number,
    toMs: number,
    kind: 'frame' | 'capture',
  ): SecretFrameVerdict {
    if (this.inUnverifiedGap(fromMs, toMs))
      return this.withhold(kind, toMs, 'secret-not-verified')
    // A late image of a replaced document stays withheld when a frame from another origin was drawn there.
    if (this.overlapsCrossOrigin(fromMs, toMs))
      return this.withhold(kind, toMs, 'cross-origin-frame')
    return 'pass'
  }

  /** Whether `[fromMs, toMs]` touches a time no observer verified (the gap a document replacement left). */
  private inUnverifiedGap(fromMs: number, toMs: number): boolean {
    return this.unverifiedGaps.some(
      ([start, end]) => fromMs <= end && toMs >= start,
    )
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
          await this.continueInNewDocument()
          return
        }
        this.fail('observer-unanswered', -Infinity)
        return
      }
      // The oldest answer is what every observer vouches for.
      this.replacementsInRow = 0
      this.lastAnswerMs = Math.min(...answered.map((report) => report.now))
      this.intervals = answered.flatMap((report) => report.unsafe)
      const opens = answered.flatMap((report) =>
        report.open === null ? [] : [report.open],
      )
      this.openSinceMs = opens.length > 0 ? Math.min(...opens) : null
      // A drawn frame from another origin withholds images; it never fails the gate.
      this.crossOriginIntervals = answered.flatMap(
        (report) => report.crossOrigin ?? [],
      )
      const crossOpens = answered.flatMap((report) =>
        typeof report.crossOriginOpen !== 'number'
          ? []
          : [report.crossOriginOpen],
      )
      this.crossOriginOpenSinceMs =
        crossOpens.length > 0 ? Math.min(...crossOpens) : null
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
   * Keeps checking images after the page loaded a new document (a sign-in that redirects, a form that posts).
   *
   * The control that received the secret is gone with the old document, but the new page may render the value (a server-rendered echo). Every value the learner typed is watched again in the new document: its rendered text of every reachable root and its plain controls, with a baseline of zero, because the value was never page text there. Images stay held until a verification answered after their capture, and the time between the old observers' last answer and the new ones' installation stays an unverified gap.
   * A value the host does not know (an arm without `secretValue`) cannot be watched again; the gate then has nothing to check there. A gate that already failed stays failed; a later secret operation arms it again.
   */
  private async continueInNewDocument(): Promise<void> {
    if (this.failureReason !== undefined) return
    // A page that keeps replacing its document cannot be verified: the gate fails instead of looping.
    if (++this.replacementsInRow > SECRET_FRAME_MAX_REPLACEMENTS_IN_A_ROW) {
      this.fail('observer-unanswered', -Infinity)
      return
    }
    // Each distinct typed value is watched once, whichever controls received it.
    const values = [
      ...new Set(
        this.observers.flatMap((observer) =>
          observer.secretValue === undefined ? [] : [observer.secretValue],
        ),
      ),
    ]
    this.retireObserversExcept(undefined)
    this.documentOrigin = undefined
    for (const secretValue of values) {
      const entry = {
        selector: null,
        global: `${SECRET_FRAME_OBSERVER_GLOBAL}${++this.observersInstalled}`,
        secretValue,
      }
      this.observers.push(entry)
      try {
        const result = (await this.options.evaluate(
          observerInstallExpression(null, entry.global, secretValue),
          SECRET_FRAME_OBSERVER_TIMEOUT_MS,
        )) as { ok?: boolean; origin?: number } | null
        if (result?.ok !== true) this.fail('observer-unanswered', -Infinity)
        else this.documentOrigin = result.origin
      } catch {
        this.fail('observer-unanswered', -Infinity)
      }
    }
    if (this.observers.length === 0) return
    // No image is verified until the new observers answered: the gap runs to the end of their installation.
    const gap = this.unverifiedGaps.at(-1)
    if (gap) gap[1] = Date.now()
    // Ask once now, so the answer is current and a copy the page already shows fails at once.
    await this.refresh()
  }

  /**
   * Forgets the observers of a document that was replaced and records the time they could no longer vouch for.
   * Images captured after the old observers last vouched for the page and before this point (a show-password toggle followed at once by a submit that navigates) were never verified.
   * @param keep - The observer just installed in the new document, which stays.
   */
  private retireObserversExcept(
    keep: (typeof this.observers)[number] | undefined,
  ): void {
    // What the old document's observers saw of frames from another origin outlives them; past the cap the oldest are merged, never dropped, so a late image of an early interval stays withheld.
    this.retiredCrossOriginIntervals = coalesceOldestIntervals(
      [
        ...this.retiredCrossOriginIntervals,
        ...this.crossOriginIntervals,
        ...(this.crossOriginOpenSinceMs === null
          ? []
          : [[this.crossOriginOpenSinceMs, Date.now()] as const]),
      ],
      SECRET_FRAME_RETIRED_INTERVALS_MAX,
    )
    this.crossOriginIntervals = []
    this.crossOriginOpenSinceMs = null
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
    if (reason === 'observer-unanswered') this.counts.failures += 1
    this.failureReason ??= reason
    this.firstUnsafeMs = Math.min(this.firstUnsafeMs ?? Infinity, fromMs)
    if (this.failureReported) return
    this.failureReported = true
    this.options.onFailure?.(this.failureReason)
  }
}

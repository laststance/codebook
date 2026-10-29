import { z } from 'zod'

import type {
  FlatCdpConnection,
  ResolvedExtensionClick,
} from './chromeExtensionContracts'
import type { ExtensionPauseState } from './chromeExtensionDebugger'
import {
  EXTENSION_CLICK_RETURN_BOUND_MS,
  EXTENSION_OBSERVE_SETTLE_MS,
  EXTENSION_STEP_REQUEST_TIMEOUT_MS,
  REPOSITORY_RUN_TIMEOUT_MS,
} from './constants'
import { StudyError } from './errors'
import { locateClickCentre } from './utils/locateClickCentre'
import { inspectInput, selectInput } from './utils/prepareRepositoryInputs'
import { redactSecretText } from './utils/redactSecretText'
import {
  hidePrivateRoots,
  sanitizeCause,
  type CauseRoots,
} from './utils/sanitizeCause'
import { withPausableDeadline } from './utils/withPausableDeadline'

/** What one input or the click may have changed in the extension: nothing, a confirmed effect, or a request was sent whose answer is unknown (ER15). */
export type ExtensionSideEffect = 'none' | 'confirmed' | 'unknown'

/** How a click call returned (SR2, DXR5). */
export type ExtensionClickOutcome = 'paused' | 'settled' | 'running'

/** What a click has done so far; read live from the receipt. */
export type ExtensionClickProgress = {
  inputsApplied: number
  clickDispatched: boolean
  inputEffects: ExtensionSideEffect[]
  clickEffect: ExtensionSideEffect
}

/** The answer of one click call. */
export type ExtensionClickReceipt = {
  clickIndex: number
  outcome: ExtensionClickOutcome
  /** The state of the steps right now; it keeps changing after a `paused` or `running` outcome. */
  progress(): ExtensionClickProgress
  /** Settles when every step ended; rejects with the {@link StudyError} of a failure after the call returned. */
  completed: Promise<void>
}

/** Performs one declared click of the run. */
export interface ChromeExtensionActionExecutor {
  /**
   * Runs the click's inputs and click as steps and returns once a declared stop pauses, the work settles or the return bound passes.
   * @throws A {@link StudyError}: `SELECTOR_NOT_FOUND` before any effect, `INPUT_PARTIAL`, `CLICK_OUTCOME_UNKNOWN` or `DIALOG_UNDECLARED` after.
   */
  run(click: ResolvedExtensionClick): Promise<ExtensionClickReceipt>
  /** The refusal of a dialog that opened without a declared answer after its click call had ended, if any; the run checks it and fails with it. */
  lateDialogRefusal(): StudyError | undefined
  /** Stops answering dialogs; the run calls it once at its end. */
  dispose(): void
}

/** The pieces an executor is given; no global is read. */
export type ExtensionExecutorInput = {
  cdp: FlatCdpConnection
  /** The flat session of the surface target; every step and dialog event is bound to it. */
  surfaceSessionId: string
  extensionId: string
  pauseState: ExtensionPauseState
  /** Called before and after each step; throws when the run's worker restarted (ER17) or ended. */
  assertActionCurrent(): void
  record: (type: string, detail?: unknown) => unknown
  /** The private roots a journaled dialog message and a failure cause must not show. */
  roots: CauseRoots
  /** Unpaused time one request may take; defaults to {@link EXTENSION_STEP_REQUEST_TIMEOUT_MS}. */
  stepTimeoutMs?: number
  /** How long a dispatched click waits before it answers `running`; defaults to {@link EXTENSION_CLICK_RETURN_BOUND_MS}. */
  returnBoundMs?: number
  /** How long no stop settles the work; defaults to {@link EXTENSION_OBSERVE_SETTLE_MS}. */
  settleMs?: number
}

const readySchema = z.object({
  ready: z.boolean(),
  reason: z.string().optional(),
})
const centreSchema = z.discriminatedUnion('ready', [
  z.object({ ready: z.literal(true), x: z.number(), y: z.number() }),
  z.object({ ready: z.literal(false), reason: z.string() }),
])
const objectIdSchema = z.object({
  result: z.object({
    subtype: z.string().optional(),
    objectId: z.string().optional(),
  }),
  exceptionDetails: z.unknown().optional(),
})
const dialogSchema = z.object({
  type: z.string(),
  message: z.string().optional(),
})

/**
 * Decides how a click call returns: `paused` as soon as a declared stop pauses, `running` when the dispatch is unanswered at the return bound, `settled` when no stop paused for the settle time after the answer.
 * Used by one {@link ClickExecution}; it resolves or rejects the call's promise exactly once.
 */
class ClickOutcomeWaiter {
  private decided = false
  private returnTimer?: ReturnType<typeof setTimeout>
  private settleTimer?: ReturnType<typeof setTimeout>
  private stopListening: () => void = () => {}

  constructor(
    private readonly pauseState: ExtensionPauseState,
    private readonly returnBoundMs: number,
    private readonly settleMs: number,
    private readonly settle: (outcome: ExtensionClickOutcome) => void,
    private readonly reject: (error: unknown) => void,
  ) {}

  start(): void {
    this.stopListening = this.pauseState.onChange(() => {
      if (this.pauseState.hasDeclaredPause()) this.decide('paused')
    })
  }

  /** The mouse press went out: the return bound starts. */
  clickSent(): void {
    // A stop that paused or a failure that ended the call already decided it: no timer is armed after that.
    if (this.decided) return
    this.returnTimer = setTimeout(
      () => this.decide('running'),
      this.returnBoundMs,
    )
  }

  /** The click's last request was answered: a stop must come within the settle time or the work is settled. */
  clickAnswered(): void {
    clearTimeout(this.returnTimer)
    if (this.decided) return
    if (this.pauseState.hasDeclaredPause()) return this.decide('paused')
    this.settleTimer = setTimeout(() => this.decide('settled'), this.settleMs)
  }

  /** A step failed before the call returned: the call rejects with it. */
  fail(error: unknown): void {
    if (this.decided) return
    this.finish()
    this.reject(error)
  }

  private decide(outcome: ExtensionClickOutcome): void {
    if (this.decided) return
    this.finish()
    this.settle(outcome)
  }

  private finish(): void {
    this.decided = true
    clearTimeout(this.returnTimer)
    clearTimeout(this.settleTimer)
    this.stopListening()
  }
}

/**
 * One click's inputs and press as steps (`focusing`, `inserting`, `verifying`, `clicking`, ER14) over the flat CDP connection, with side effects tracked per step (ER15).
 * Created by the executor for each declared click; reuses the in-page functions of {@link prepareRepositoryInputs} and sends selectors and texts only as JSON literals or call arguments (CR13).
 */
class ClickExecution {
  readonly progressState: ExtensionClickProgress
  private readonly origins: string[]
  private dialogFailure!: (error: unknown) => void
  private readonly dialogFailed: Promise<never>
  /** The refusal of an undeclared dialog, kept for the run when no step was waiting to fail with it. */
  refusedDialog?: StudyError

  constructor(
    private readonly input: ExtensionExecutorInput,
    private readonly click: ResolvedExtensionClick,
  ) {
    this.origins = [`chrome-extension://${input.extensionId}`]
    this.progressState = {
      inputsApplied: 0,
      clickDispatched: false,
      inputEffects: click.inputs.map(() => 'none'),
      clickEffect: 'none',
    }
    this.dialogFailed = new Promise<never>((_resolve, reject) => {
      this.dialogFailure = reject
    })
    // A rejection nobody raced against is consumed here, never unhandled.
    this.dialogFailed.catch(() => {})
  }

  /** Answers or refuses the dialogs the click opens (TZ11), also those a timer opens after its steps ended; returns the function that stops listening. */
  listenForDialogs(): () => void {
    return this.input.cdp.on(
      'Page.javascriptDialogOpening',
      (params, sessionId) => {
        if (sessionId !== this.input.surfaceSessionId) return
        void this.answerDialog(params)
      },
    )
  }

  private async answerDialog(params: Record<string, unknown>): Promise<void> {
    const type = dialogSchema.safeParse(params).data?.type ?? 'dialog'
    const answer = this.click.dialog
    // The dialog text may show private paths or secrets: mask, then hide the roots, as the output journal does.
    const message = hidePrivateRoots(
      redactSecretText(dialogSchema.safeParse(params).data?.message ?? ''),
      this.input.roots,
    )
    if (!answer) {
      const refusal = new StudyError(
        'DIALOG_UNDECLARED',
        `Click ${this.click.index} opened a ${type} dialog; declare dialog: accept or dismiss for it.`,
      )
      this.refusedDialog ??= refusal
      this.input.record('chrome-extension.dialog', {
        clickIndex: this.click.index,
        type,
        answer: 'none',
        message,
      })
      return this.dialogFailure(refusal)
    }
    this.input.record('chrome-extension.dialog', {
      clickIndex: this.click.index,
      type,
      answer,
      message,
    })
    await this.input.cdp
      .request(
        'Page.handleJavaScriptDialog',
        { accept: answer === 'accept' },
        this.input.surfaceSessionId,
      )
      .catch((error: unknown) => this.dialogFailure(error))
  }

  /**
   * Sends one request of a step: the deadline stops while a stop is paused, a dialog without an answer fails the step, and the run's worker is checked before and after.
   * @throws The request's failure, the timeout of unpaused time, or the dialog refusal.
   */
  private async send(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.input.assertActionCurrent()
    const answer = await Promise.race([
      withPausableDeadline(
        this.input.cdp.request(
          method,
          params,
          this.input.surfaceSessionId,
          REPOSITORY_RUN_TIMEOUT_MS,
        ),
        this.input.pauseState,
        this.input.stepTimeoutMs ?? EXTENSION_STEP_REQUEST_TIMEOUT_MS,
        method,
      ),
      this.dialogFailed,
    ])
    this.input.assertActionCurrent()
    return answer
  }

  /** The failure of a selector or centre lookup; `step` names the input (1-based) or the click step that looked. */
  private selectorFailure(
    selector: string,
    step: number | 'click',
    reason?: string,
  ): StudyError {
    // After an input was typed the extension may have reacted: the failure is partial, not a refusal that consumes nothing.
    if (this.progressState.inputsApplied > 0) return this.partialAt(step)
    const message = `No element matches ${selector} in the extension surface.`
    // The reason is detail for the cause; the sentence stays the fixed contract text.
    return new StudyError(
      'SELECTOR_NOT_FOUND',
      message,
      reason ? `${message} (${reason})` : message,
    )
  }

  private partialAt(step: number | 'click'): StudyError {
    return step === 'click' ? this.clickStepPartial() : this.inputPartial(step)
  }

  private clickStepPartial(): StudyError {
    return new StudyError(
      'INPUT_PARTIAL',
      `The press of click ${this.click.index} could not start after its inputs were typed; the extension may have reacted.`,
    )
  }

  /**
   * Turns an error no step classified into the contract's failure: partial once an input had an effect, a refusal with no effect before.
   * @param error - What a step threw.
   * @param step - The input (1-based) or the click step that was running.
   * @returns The {@link StudyError} itself when it already is one.
   */
  private classify(error: unknown, step: number | 'click'): StudyError {
    if (error instanceof StudyError) return error
    const hadEffect =
      this.progressState.inputsApplied > 0 ||
      this.progressState.inputEffects.some((effect) => effect !== 'none')
    if (hadEffect) return this.partialAt(step)
    return new StudyError(
      'RUNTIME_FAILED',
      `Click ${this.click.index} could not start; nothing was typed or pressed.`,
      sanitizeCause(error, this.input.roots),
      'Nothing was typed or pressed. Retry once with a new key; if it fails again, stop the run and tell the learner. Side effects: none.',
    )
  }

  private inputPartial(inputNumber: number): StudyError {
    return new StudyError(
      'INPUT_PARTIAL',
      `Input ${inputNumber} of click ${this.click.index} failed after earlier inputs were typed; the extension may have reacted.`,
    )
  }

  /** Selects the one element for a selector; `undefined` when it matches nothing or not exactly one. */
  private async select(selector: string): Promise<string | undefined> {
    const answer = objectIdSchema.parse(
      await this.send('Runtime.evaluate', {
        expression: `(${selectInput.toString()})(${JSON.stringify(selector)},${JSON.stringify(this.origins)})`,
        returnByValue: false,
      }),
    )
    return answer.exceptionDetails || answer.result.subtype !== 'node'
      ? undefined
      : answer.result.objectId
  }

  private async releaseObject(objectId: string): Promise<void> {
    await this.input.cdp
      .request(
        'Runtime.releaseObject',
        { objectId },
        this.input.surfaceSessionId,
      )
      .catch(() => {})
  }

  /** Focuses, inserts and verifies one input; a lost answer after a sent request is a partial input (ER15). */
  private async typeInput(
    index: number,
    input: ResolvedExtensionClick['inputs'][number],
  ): Promise<void> {
    const objectId = await this.select(input.selector)
    if (!objectId) throw this.selectorFailure(input.selector, index + 1)
    try {
      await this.focusInput(index, objectId, input)
      await this.insertInput(index, input.text)
      await this.verifyInput(index, objectId, input)
    } finally {
      await this.releaseObject(objectId)
    }
    this.progressState.inputsApplied += 1
  }

  private async callInspect(
    objectId: string,
    input: ResolvedExtensionClick['inputs'][number],
    phase: 'focus' | 'verify',
  ) {
    return readySchema.safeParse(
      (
        (await this.send('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: inspectInput.toString(),
          arguments: [{ value: { ...input, origins: this.origins, phase } }],
          returnByValue: true,
        })) as { result?: { value?: unknown } }
      ).result?.value,
    )
  }

  private async focusInput(
    index: number,
    objectId: string,
    input: ResolvedExtensionClick['inputs'][number],
  ): Promise<void> {
    // The focus request is the first effectful one: from its sending on the effect is unknown.
    this.progressState.inputEffects[index] = 'unknown'
    let focused
    try {
      focused = await this.callInspect(objectId, input, 'focus')
    } catch (error) {
      if (error instanceof StudyError) throw error
      throw this.inputPartial(index + 1)
    }
    if (!focused.success || !focused.data.ready) {
      // Only a focus that ran and did not land is an effect; every other reason was decided before focus() ran.
      this.progressState.inputEffects[index] =
        focused.data?.reason === 'input-focus-changed' ? 'confirmed' : 'none'
      throw this.selectorFailure(
        input.selector,
        index + 1,
        focused.data?.reason,
      )
    }
  }

  private async insertInput(index: number, text: string): Promise<void> {
    try {
      await this.send('Input.insertText', { text })
    } catch (error) {
      if (error instanceof StudyError) throw error
      throw this.inputPartial(index + 1)
    }
    this.progressState.inputEffects[index] = 'confirmed'
  }

  private async verifyInput(
    index: number,
    objectId: string,
    input: ResolvedExtensionClick['inputs'][number],
  ): Promise<void> {
    let verified
    try {
      verified = await this.callInspect(objectId, input, 'verify')
    } catch (error) {
      if (error instanceof StudyError) throw error
      throw this.inputPartial(index + 1)
    }
    // The text was typed: a failed verification can never be a refusal that consumed nothing.
    if (!verified.success || !verified.data.ready)
      throw this.inputPartial(index + 1)
  }

  /** Finds the click's centre and presses the mouse there; a double click sends two press-release pairs with click counts 1 and 2. */
  private async press(waiter: ClickOutcomeWaiter): Promise<void> {
    const objectId = await this.select(this.click.selector)
    if (!objectId) throw this.selectorFailure(this.click.selector, 'click')
    let centre
    try {
      centre = centreSchema.parse(
        (
          (await this.send('Runtime.callFunctionOn', {
            objectId,
            functionDeclaration: locateClickCentre.toString(),
            returnByValue: true,
          })) as { result?: { value?: unknown } }
        ).result?.value,
      )
    } finally {
      await this.releaseObject(objectId)
    }
    if (!centre.ready)
      throw this.selectorFailure(this.click.selector, 'click', centre.reason)
    const pairs = this.click.kind === 'dblclick' ? 2 : 1
    waiter.clickSent()
    for (let clickCount = 1; clickCount <= pairs; clickCount += 1)
      await this.pressOnce(centre.x, centre.y, clickCount)
    this.progressState.clickEffect = 'confirmed'
    this.progressState.clickDispatched = true
    waiter.clickAnswered()
  }

  private async pressOnce(
    x: number,
    y: number,
    clickCount: number,
  ): Promise<void> {
    for (const type of ['mousePressed', 'mouseReleased']) {
      // From the first press on, the click's outcome is unknown until its release is answered.
      this.progressState.clickEffect = 'unknown'
      try {
        await this.send('Input.dispatchMouseEvent', {
          type,
          x,
          y,
          button: 'left',
          clickCount,
        })
      } catch (error) {
        if (error instanceof StudyError) throw error
        throw new StudyError(
          'CLICK_OUTCOME_UNKNOWN',
          "The click's outcome is unknown; the extension may have reacted.",
        )
      }
    }
  }

  /** Runs every step in order: the inputs, then the click. */
  async perform(waiter: ClickOutcomeWaiter): Promise<void> {
    await this.guarded(1, () => this.send('Page.enable', {}))
    for (const [index, input] of this.click.inputs.entries())
      await this.guarded(index + 1, () => this.typeInput(index, input))
    await this.guarded('click', () => this.press(waiter))
  }

  /** Runs one step and classifies whatever raw error it lets escape (zod, a lost evaluate answer). */
  private async guarded(
    step: number | 'click',
    action: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await action()
    } catch (error) {
      throw this.classify(error, step)
    }
  }
}

/**
 * Creates the pause-aware executor of a chrome-extension run's declared clicks (ER14, ER15, TZ11).
 * Called by the run when it reaches `ready`; the debugger supplies the pause state and the worker watch.
 * @param input - The flat CDP connection and surface session, the extension id, the pause state and the journal.
 * @returns An executor whose `run` performs one declared click per call.
 * @example
 * const executor = createChromeExtensionActionExecutor({ cdp, surfaceSessionId, extensionId, pauseState: debug.pauseState, assertActionCurrent: guard.assertCurrent, record })
 * const receipt = await executor.run(run.clicks[0]!) // => { clickIndex: 1, outcome: 'settled', ... }
 */
export function createChromeExtensionActionExecutor(
  input: ExtensionExecutorInput,
): ChromeExtensionActionExecutor {
  const executions: ClickExecution[] = []
  const stopListeners: Array<() => void> = []
  return {
    lateDialogRefusal: () =>
      executions.find((execution) => execution.refusedDialog)?.refusedDialog,
    dispose(): void {
      for (const stop of stopListeners.splice(0)) stop()
    },
    run(click) {
      const execution = new ClickExecution(input, click)
      executions.push(execution)
      // The listener outlives the click call: a timer may open a dialog later; `dispose` ends it with the run.
      stopListeners.push(execution.listenForDialogs())
      return new Promise<ExtensionClickReceipt>((resolve, reject) => {
        let work: Promise<void> = Promise.resolve()
        const waiter = new ClickOutcomeWaiter(
          input.pauseState,
          input.returnBoundMs ?? EXTENSION_CLICK_RETURN_BOUND_MS,
          input.settleMs ?? EXTENSION_OBSERVE_SETTLE_MS,
          (outcome) =>
            resolve({
              clickIndex: click.index,
              outcome,
              progress: () => ({
                ...execution.progressState,
                inputEffects: [...execution.progressState.inputEffects],
              }),
              completed: work,
            }),
          reject,
        )
        waiter.start()
        work = execution.perform(waiter).catch((error: unknown) => {
          waiter.fail(error)
          throw error
        })
        // The call's own rejection or the receipt's `completed` carries the failure; this copy only marks it handled.
        work.catch(() => {})
      })
    },
  }
}

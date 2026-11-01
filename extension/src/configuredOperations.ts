import { z } from 'zod'

import {
  ASK_LEARNER_SECRET,
  OPERATION_SETTLE_BOUND_MS,
  OPERATION_SETTLE_POLL_MS,
  OPERATION_SETTLE_QUIET_MS,
  REPOSITORY_RUN_TIMEOUT_MS,
} from './constants'
import type { RepositoryOperation } from './repositoryConfigSchemas'
import type { Cdp } from './runtimeSupport/cdp'
import {
  classifySecretControl,
  type SecretControlAttributes,
} from './utils/classifySecretControl'
import { writeTextInput } from './utils/prepareRepositoryInputs'
import { thrownMessage } from './utils/thrownMessage'

/** The codes an operation can refuse or fail with; each has an `ERROR_RECOVERY` entry naming its audience. */
export type OperationRefusalCode =
  | 'OPTION_NOT_AVAILABLE'
  | 'INPUT_NOT_ACCEPTED'
  | 'CONTROL_KIND_NOT_SUPPORTED'
  | 'SECRET_INPUT_FROM_CHAT'
  | 'SECRET_INPUT_VISIBLE'
  | 'NAVIGATION_BEFORE_LAST_OPERATION'
  | 'NAVIGATION_NOT_SETTLED'
  | 'OPERATION_AFTER_NOT_MET'
  | 'RUN_FAILED_UNEXPECTEDLY'
  | 'SECRET_BECAME_VISIBLE'

/** Whether anything of the operation reached the page before the failure, and what a retry may rely on. */
export type OperationSideEffects = 'none' | 'unknown'

/**
 * The failure of one operation of a version 3 run: its code, its words and the fields the agent needs to decide a retry (DX-5).
 * Thrown by {@link prepareOperation} and {@link PreparedOperation.send}; {@link ConfiguredBrowserRun} turns it into the run's coded failure and keeps its fields for the run resource and the error object.
 * @example throw new OperationRefusal('OPTION_NOT_AVAILABLE', 'Operation 1 …', { operationIndex: 1, path: 'operations[0].value', sent: 'not-sent' })
 */
export class OperationRefusal extends Error {
  readonly operationIndex: number
  /** The configuration path the fix is made at, such as `operations[2].selector`; absent when no field is to blame. */
  readonly path: string | undefined
  readonly sent: 'not-sent' | 'sent'
  readonly sideEffects: OperationSideEffects
  constructor(
    readonly code: OperationRefusalCode,
    message: string,
    where: {
      operationIndex: number
      path?: string
      sent?: 'not-sent' | 'sent'
      sideEffects?: OperationSideEffects
    },
  ) {
    super(message)
    this.operationIndex = where.operationIndex
    this.path = where.path
    this.sent = where.sent ?? 'not-sent'
    this.sideEffects =
      where.sideEffects ?? (this.sent === 'sent' ? 'unknown' : 'none')
  }
}

/** What the run lets the engine do, so the engine holds no run state of its own. */
export interface OperationPort {
  /** The selected page's channel, after the page's origin was verified; throws when the page left the owned origin. */
  pageCdp(): Promise<Cdp>
  /** The loopback origins the page may be at. */
  origins(): readonly string[]
  /** Throws when the run is no longer alive. */
  assertCurrent(): void
  /** Milliseconds since the page's last main-frame navigation; `Infinity` when none was seen. */
  millisecondsSinceNavigation(): number
  /** Waits for the delay, ending early with a throw when the run is cancelled. */
  sleep(delayMs: number): Promise<void>
  /** Scrolls the click target into view and reads its centre, as every click of the run does; throws the run's own sentence when the target is missing, hidden, disabled or obscured. */
  readClickPoint(selector: string): Promise<{ x: number; y: number }>
}

/** The moments of one operation's input the run records and acts on. */
export interface OperationSendHooks {
  /** Called synchronously right before the first input event is sent; the run marks the operation dispatched here. */
  beforeInput(): void
  /** Called once the page acknowledged the input. */
  acknowledged(): void
  /** Called once the control's value was read after the input (never for a click): `true` when it holds the declared value. */
  valueChecked(passed: boolean): void
}

/** An operation resolved against the page and ready to send exactly once. */
export interface PreparedOperation {
  /** Whether the control holds a secret the learner typed (`secret: "ask-learner"`). */
  readonly isSecret: boolean
  /**
   * Sends the operation's input once.
   * @throws {@link OperationRefusal} when the page refuses the value or the input is uncertain; never retried.
   */
  send(hooks: OperationSendHooks): Promise<void>
  /** Releases what the preparation holds in the page without sending anything; the run calls it for a preparation it replaces. Harmless after `send`. */
  discard(): Promise<void>
}

const descriptionSchema = z.object({
  ready: z.boolean(),
  reason: z.string().optional(),
  tagName: z.string().optional(),
  type: z.string().optional(),
  name: z.string().optional(),
  id: z.string().optional(),
  autocomplete: z.string().optional(),
  multiple: z.boolean().optional(),
  isContentEditable: z.boolean().optional(),
})
const applySchema = z.object({
  applied: z.boolean(),
  reason: z.string().optional(),
  valueMatches: z.boolean().optional(),
  isValid: z.boolean().optional(),
  rule: z
    .object({
      min: z.string().optional(),
      max: z.string().optional(),
      step: z.string().optional(),
      pattern: z.string().optional(),
    })
    .optional(),
})
const optionSchema = z.object({
  state: z.enum(['available', 'missing', 'disabled']),
})

/** What the owned page reports of a control: attributes only, never its value. */
type ControlDescription = z.infer<typeof descriptionSchema>

/** The `<input type>` values a `text` operation types into through the browser's own text insertion. */
const TEXT_LIKE_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'search',
  'email',
  'password',
  'tel',
  'url',
])
/** The control kinds a send cannot drive, with what to do instead (ENG-13). */
const UNSUPPORTED_ADVICE: Readonly<Record<string, string>> = {
  checkbox: 'Use a click operation to toggle it.',
  radio: 'Use a click operation to pick it.',
  range: 'Use a click operation, or declare the value the app reads.',
  button: 'Use a click operation.',
  submit: 'Use a click operation.',
  reset: 'Use a click operation.',
  file: 'Codebook cannot attach files.',
}

/**
 * Describes the control an operation names, inside the owned page; serialized with `toString()`, so everything it calls is declared inside it.
 * It reads attributes only and never the control's value, so a secret never leaves the page through it.
 * @param input - The operation's selector and the loopback origins the page may be at.
 * @returns `ready: false` with a reason when the page is at another origin or the selector does not name this one connected control; otherwise the control's tag, type, name, id, autocomplete, whether it is a multiple select or editable content, and `ready` only when it is visible and enabled.
 * @example describeOperationControl.call(element, { selector: '#amount', origins: ['http://localhost:3000'] }) // => { ready: true, tagName: 'input', type: 'number', … }
 */
function describeOperationControl(
  this: Element,
  input: { selector: string; origins: readonly string[] },
) {
  if (!input.origins.includes(location.origin))
    return { ready: false, reason: 'wrong-origin' }
  const matches = document.querySelectorAll(input.selector)
  if (matches.length !== 1 || matches[0] !== this || !this.isConnected)
    return { ready: false, reason: 'unique-control-required' }
  const rect = this.getBoundingClientRect(),
    style = getComputedStyle(this),
    formControl =
      this instanceof HTMLInputElement ||
      this instanceof HTMLTextAreaElement ||
      this instanceof HTMLSelectElement
        ? this
        : undefined,
    isHidden = [
      rect.width <= 0,
      rect.height <= 0,
      style.display === 'none',
      style.visibility !== 'visible',
      style.opacity === '0',
    ].some(Boolean),
    // The first thing that stops the control from taking a value; a read-only input takes no typed or set value, as the text path's last look refuses it.
    blocker = [
      [isHidden, 'control-not-visible'],
      // `:disabled` covers a control inside `<fieldset disabled>`, whose own `disabled` stays false.
      [formControl?.matches(':disabled') === true, 'control-disabled'],
      [
        formControl !== undefined &&
          'readOnly' in formControl &&
          formControl.readOnly,
        'control-readonly',
      ],
    ].find(([isBlocking]) => isBlocking)?.[1]
  return {
    ready: blocker === undefined,
    reason: blocker,
    tagName: this.tagName.toLowerCase(),
    type: this instanceof HTMLInputElement ? this.type : '',
    name: this.getAttribute('name') ?? '',
    id: this.id,
    autocomplete: this.getAttribute('autocomplete') ?? '',
    multiple: this instanceof HTMLSelectElement && this.multiple,
    isContentEditable: this instanceof HTMLElement && this.isContentEditable,
  }
}

/**
 * Tells inside the owned page whether a `<select>` holds a usable option with a value; serialized with `toString()`.
 * @param input - The option's value.
 * @returns `available` for an enabled option, `disabled` for a disabled one, `missing` for none (also when the control is not a select).
 * @example checkSelectOption.call(select, { value: '3958dc9e' }) // => { state: 'available' }
 */
function checkSelectOption(this: Element, input: { value: string }) {
  if (!(this instanceof HTMLSelectElement)) return { state: 'missing' }
  const option = Array.from(this.options).find(
    (candidate) => candidate.value === input.value,
  )
  if (!option) return { state: 'missing' }
  // `:disabled` also covers an option inside a disabled `<optgroup>`, whose own `disabled` stays false.
  return { state: option.matches(':disabled') ? 'disabled' : 'available' }
}

/**
 * Sets a number input's or a single select's value the way a user's choice does, inside the owned page; serialized with `toString()`.
 * The element's native value setter bypasses a framework's value tracking, and the `input` and `change` events it dispatches make a React-controlled control see the value; a handler that pauses in the debugger keeps this call pending until the pause is continued.
 * @param input - The selector and origins that identify the control, the kind, the value, and the attributes the control had when it was classified.
 * @returns `applied: false` with a reason when nothing was changed (another origin, a control that is not the one classified, a missing or disabled option); otherwise whether the control then holds the value (`valueMatches`), whether the browser calls it valid (`isValid`) and, for a number input, its `min`, `max`, `step` and `pattern` rules.
 * @example applyNativeValue.call(input, { kind: 'number', value: '120', … }) // => { applied: true, valueMatches: true, isValid: true, rule: { min: '1' } }
 */
function applyNativeValue(
  this: Element,
  input: {
    selector: string
    origins: readonly string[]
    kind: 'number' | 'select'
    value: string
    expected: {
      tagName: string
      type: string
      name: string
      id: string
      autocomplete: string
    }
  },
) {
  // Everything the page reads is declared inside this function, which is serialized with `toString()`; the small arrows keep each step simple.
  const control =
    this instanceof HTMLSelectElement || this instanceof HTMLInputElement
      ? this
      : undefined
  const optionOf = (candidate: Element | undefined) =>
    candidate instanceof HTMLSelectElement
      ? Array.from(candidate.options).find(
          (entry) => entry.value === input.value,
        )
      : undefined
  // The control must be the one that was classified: a control that turned into another kind or into a secret one receives nothing.
  const sameKind = (candidate: Element | undefined) =>
    [
      candidate?.tagName.toLowerCase(),
      candidate instanceof HTMLInputElement ? candidate.type : '',
      candidate?.getAttribute('name') ?? '',
      candidate?.id,
      candidate?.getAttribute('autocomplete') ?? '',
    ].join('\u0000') ===
    [
      input.expected.tagName,
      input.expected.type,
      input.expected.name,
      input.expected.id,
      input.expected.autocomplete,
    ].join('\u0000')
  const isUnique = () => {
    const matches = document.querySelectorAll(input.selector)
    return matches.length === 1 && matches[0] === this && this.isConnected
  }
  const option = optionOf(control)
  const checks: [boolean, string][] = [
    [!input.origins.includes(location.origin), 'wrong-origin'],
    [!isUnique(), 'unique-control-required'],
    [!control || !sameKind(control), 'control-changed'],
    // The effective disabled state, also of a control inside `<fieldset disabled>`.
    [Boolean(control?.matches(':disabled')), 'control-disabled'],
    // The same editability check as the text path: a read-only number input receives no value.
    [
      control instanceof HTMLInputElement && control.readOnly,
      'control-readonly',
    ],
    [control instanceof HTMLSelectElement && !option, 'option-missing'],
    [Boolean(option?.matches(':disabled')), 'option-disabled'],
  ]
  const refusal = checks.find(([failed]) => failed)
  if (refusal || !control) return { applied: false, reason: refusal?.[1] }
  const prototype =
    control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!setter) return { applied: false, reason: 'setter-missing' }
  setter.call(control, input.value)
  control.dispatchEvent(new Event('input', { bubbles: true }))
  control.dispatchEvent(new Event('change', { bubbles: true }))
  const rules = (entry: HTMLInputElement) => ({
    min: entry.getAttribute('min') ?? undefined,
    max: entry.getAttribute('max') ?? undefined,
    step: entry.getAttribute('step') ?? undefined,
    pattern: entry.getAttribute('pattern') ?? undefined,
  })
  // The handlers may have re-rendered the control: the value is read from the control the selector resolves to now, which must be one connected select or input.
  const readBack = () => {
    const matches = document.querySelectorAll(input.selector)
    const current =
      matches.length === 1 && matches[0]?.isConnected ? matches[0] : undefined
    const resolved =
      current instanceof HTMLSelectElement ||
      current instanceof HTMLInputElement
        ? current
        : undefined
    return {
      valueMatches: resolved !== undefined && resolved.value === input.value,
      isValid:
        resolved instanceof HTMLInputElement
          ? resolved.validity.valid
          : resolved !== undefined,
      rule: resolved instanceof HTMLInputElement ? rules(resolved) : undefined,
    }
  }
  return { applied: true, ...readBack() }
}

/**
 * Words which of an input's rules a number input refused a value by, when the page can read them.
 * @param rule - The `min`, `max`, `step` and `pattern` attributes the page reported.
 * @returns A parenthesised list such as `(min 1, max 100, step 1)`, or an empty text when the control declares none.
 * @example describeNumberRule({ min: '1', max: '100' }) // => ' (min 1, max 100)'
 */
function describeNumberRule(rule: z.infer<typeof applySchema>['rule']): string {
  const parts = [
    rule?.min === undefined ? undefined : `min ${rule.min}`,
    rule?.max === undefined ? undefined : `max ${rule.max}`,
    rule?.step === undefined ? undefined : `step ${rule.step}`,
    rule?.pattern === undefined ? undefined : `pattern ${rule.pattern}`,
  ].filter((part) => part !== undefined)
  return parts.length ? ` (${parts.join(', ')})` : ''
}

/**
 * Names the kind of a described control for the `CONTROL_KIND_NOT_SUPPORTED` sentence.
 * @param description - What the page reported.
 * @returns For example `<select multiple>`, `<input type="date">`, `contenteditable` or `<div>`.
 * @example controlKindName({ tagName: 'input', type: 'date' }) // => '<input type="date">'
 */
function controlKindName(description: ControlDescription): string {
  if (description.tagName === 'select' && description.multiple)
    return '<select multiple>'
  if (description.tagName === 'input')
    return `<input type="${description.type ?? ''}">`
  if (description.isContentEditable) return 'contenteditable'
  return `<${description.tagName ?? 'element'}>`
}

/**
 * Waits until the page is `complete` and has had no main-frame navigation for a quiet window, before an operation is sent.
 * Why: a delayed redirect after the previous operation must be seen before the next operation is sent. It watches the run's record of main-frame navigations and `document.readyState` only, so network polling and long-lived connections never delay it.
 * Called by {@link ConfiguredBrowserRun} before every operation.
 * @param port - The run's page channel and navigation clock.
 * @param operationIndex - The operation about to be sent (1-based), named in the failure.
 * @throws {@link OperationRefusal} `NAVIGATION_NOT_SETTLED` when the page is not settled within {@link OPERATION_SETTLE_BOUND_MS}; nothing was sent.
 * @param boundMs - How long the wait may last; a test passes a short one.
 * @example await waitForSettledPage(port, 2)
 */
export async function waitForSettledPage(
  port: OperationPort,
  operationIndex: number,
  boundMs: number = OPERATION_SETTLE_BOUND_MS,
): Promise<void> {
  const startedAt = performance.now()
  for (;;) {
    port.assertCurrent()
    if (port.millisecondsSinceNavigation() >= OPERATION_SETTLE_QUIET_MS) {
      const cdp = await port.pageCdp()
      const state = await cdp.request('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      })
      port.assertCurrent()
      // The quiet window is judged again after the read, which can have taken a navigation's time.
      if (
        state.result.value === 'complete' &&
        port.millisecondsSinceNavigation() >= OPERATION_SETTLE_QUIET_MS
      )
        return
    }
    if (performance.now() - startedAt >= boundMs)
      throw new OperationRefusal(
        'NAVIGATION_NOT_SETTLED',
        `Operation ${operationIndex} was not sent: the page did not finish loading and stay still for ${OPERATION_SETTLE_QUIET_MS} ms within ${boundMs / 1000} s. Warm a slow route with the run's before conditions, or split the flow into two runs.`,
        { operationIndex },
      )
    await port.sleep(OPERATION_SETTLE_POLL_MS)
  }
}

/**
 * Resolves one declared operation against the page and returns it ready to send once.
 * Why: every refusal that needs no input (a secret control given chat text, a control kind a send cannot drive, a missing option, a missing click target) is made here, before anything reaches the page; called by {@link ConfiguredBrowserRun} for each operation after the page settled.
 * - `text` into a text-like control: the browser's own text insertion, then a value check ({@link writeTextInput}).
 * - `text` into a number input and `choose` into a native single select: the element's native value setter and the `input` and `change` events (React-controlled controls see them), then a value check; a number input also needs `validity.valid`.
 * - `click`: the unique, visible, enabled target's centre, pressed and released once.
 * @param port - What the run lets the engine use.
 * @param input - The operation, its 1-based index among `total`, and the secret the learner typed for a `secret: "ask-learner"` operation.
 * @returns The prepared operation.
 * @throws {@link OperationRefusal} `SECRET_INPUT_FROM_CHAT`, `SECRET_INPUT_VISIBLE`, `CONTROL_KIND_NOT_SUPPORTED`, `OPTION_NOT_AVAILABLE` or `INPUT_NOT_ACCEPTED`; nothing was sent.
 * @example const prepared = await prepareOperation(port, { index: 1, total: 4, operation: { kind: 'choose', title: 'Customer', selector: '#customer', value: 'c1' } })
 */
export async function prepareOperation(
  port: OperationPort,
  input: {
    index: number
    total: number
    operation: RepositoryOperation
    learnerSecret?: string
  },
): Promise<PreparedOperation> {
  const { index, operation } = input
  const configPath = (field: string): string =>
    `operations[${index - 1}].${field}`
  if (operation.kind === 'click') {
    // The same read prepares the click and, again, right before the press, so a target that moved, hid or was replaced in between is refused as the preparation would.
    const readPoint = async (): Promise<{ x: number; y: number }> => {
      try {
        return await port.readClickPoint(operation.selector)
      } catch (error) {
        port.assertCurrent()
        throw new OperationRefusal(
          'INPUT_NOT_ACCEPTED',
          `Operation ${index} (${operation.title}) was not sent: ${thrownMessage(error)}`,
          { operationIndex: index, path: configPath('selector') },
        )
      }
    }
    await readPoint()
    return {
      isSecret: false,
      send: (hooks): Promise<void> => sendClick(port, readPoint, hooks),
      discard: async (): Promise<void> => {},
    }
  }
  const cdp = await port.pageCdp()
  const selected = await cdp.request('Runtime.evaluate', {
    expression: `(${selectControl.toString()})(${JSON.stringify(operation.selector)},${JSON.stringify(port.origins())})`,
    returnByValue: false,
  })
  const objectId = selected.result.objectId
  port.assertCurrent()
  let isReleased = false
  const release = async (): Promise<void> => {
    if (isReleased || !objectId) return
    isReleased = true
    await cdp.request('Runtime.releaseObject', { objectId }).catch(() => {})
  }
  try {
    if (
      selected.exceptionDetails ||
      selected.result.subtype !== 'node' ||
      !objectId
    )
      throw new OperationRefusal(
        'INPUT_NOT_ACCEPTED',
        `Operation ${index} (${operation.title}) was not sent: ${operation.selector} matches no unique control on the page.`,
        { operationIndex: index, path: configPath('selector') },
      )
    const description = await describeControl(
      cdp,
      objectId,
      operation.selector,
      port,
    )
    port.assertCurrent()
    if (!description.ready)
      throw new OperationRefusal(
        'INPUT_NOT_ACCEPTED',
        `Operation ${index} (${operation.title}) was not sent: the control at ${operation.selector} is not available (${description.reason ?? 'unavailable'}).`,
        { operationIndex: index, path: configPath('selector') },
      )
    const prepared = await prepareControlOperation(port, {
      cdp,
      objectId,
      description,
      index,
      operation,
      learnerSecret: input.learnerSecret,
      configPath,
    })
    // The prepared operation owns the remote reference now; it releases it after its one send.
    return {
      isSecret: prepared.isSecret,
      send: async (hooks): Promise<void> => {
        try {
          await prepared.send(hooks)
        } finally {
          await release()
        }
      },
      discard: release,
    }
  } catch (error) {
    await release()
    throw error
  }
}

/** What {@link prepareControlOperation} and its steps know of one `text` or `choose` operation and the control it resolved. */
type ControlOperationContext = {
  cdp: Cdp
  objectId: string
  description: ControlDescription
  index: number
  operation: Exclude<RepositoryOperation, { kind: 'click' }>
  learnerSecret: string | undefined
  configPath: (field: string) => string
}

/**
 * Applies the secret and control-kind rules to a described control and builds the send of a `text` or `choose` operation.
 * Called by {@link prepareOperation} once the control is resolved and available.
 * @param port - What the run lets the engine use.
 * @param context - The page channel, the control's remote object and description, the operation and its configuration path builder.
 * @returns The prepared operation (whose `send` the caller wraps to release the remote object).
 * @throws {@link OperationRefusal} for every refusal of {@link prepareOperation} except a missing click target.
 * @example const prepared = await prepareControlOperation(port, context)
 */
async function prepareControlOperation(
  port: OperationPort,
  context: ControlOperationContext,
): Promise<Omit<PreparedOperation, 'discard'>> {
  const { operation } = context
  return operation.kind === 'choose'
    ? prepareChooseOperation(port, context, operation)
    : prepareTextOperation(port, context, operation)
}

/**
 * Prepares a `choose` operation: the control must be a native single `<select>` that reads as no secret and offers an enabled option with the declared value.
 * @param port - What the run lets the engine use.
 * @param context - The resolved control.
 * @param operation - The `choose` operation.
 * @returns The prepared operation, which sets the value through the native setter and checks it.
 * @throws {@link OperationRefusal} `CONTROL_KIND_NOT_SUPPORTED`, `SECRET_INPUT_VISIBLE` or `OPTION_NOT_AVAILABLE`; nothing was sent.
 * @example const prepared = await prepareChooseOperation(port, context, operation)
 */
async function prepareChooseOperation(
  port: OperationPort,
  context: ControlOperationContext,
  operation: Extract<RepositoryOperation, { kind: 'choose' }>,
): Promise<Omit<PreparedOperation, 'discard'>> {
  const { cdp, objectId, description, index, configPath } = context
  const label = `Operation ${index} (${operation.title})`
  if (description.tagName !== 'select' || description.multiple)
    throw new OperationRefusal(
      'CONTROL_KIND_NOT_SUPPORTED',
      `${label} was not sent: choose drives a native single <select>, and ${operation.selector} is ${controlKindName(description)}. A custom select is driven with click operations.`,
      { operationIndex: index, path: configPath('selector') },
    )
  // The selected option's label would be drawn in recorded frames.
  const secretReason = classifySecretControl(fingerprintOf(description))
  if (secretReason)
    throw new OperationRefusal(
      'SECRET_INPUT_VISIBLE',
      `${label} was not sent: ${operation.selector} reads as a secret control (${secretReason}), and a chosen option would show on the page and in recorded frames. Codebook never chooses a value for a secret select.`,
      { operationIndex: index, path: configPath('selector') },
    )
  const option = optionSchema.parse(
    (
      await cdp.request('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: checkSelectOption.toString(),
        arguments: [{ value: { value: operation.value } }],
        returnByValue: true,
      })
    ).result.value,
  )
  port.assertCurrent()
  if (option.state !== 'available')
    throw new OperationRefusal(
      'OPTION_NOT_AVAILABLE',
      `${label} was not sent: the select at ${operation.selector} has ${option.state === 'disabled' ? 'a disabled' : 'no'} option with the value "${operation.value}".`,
      { operationIndex: index, path: configPath('value') },
    )
  return {
    isSecret: false,
    send: (hooks): Promise<void> =>
      sendNativeValue(port, {
        ...context,
        kind: 'select',
        value: operation.value,
      })(hooks),
  }
}

/**
 * Prepares a `text` operation: the secret rules (chat text never goes into a secret control, an ask-learner secret only into a password input), then the control kind (text-like through the browser's insertion, number through the native setter, anything else refused).
 * @param port - What the run lets the engine use.
 * @param context - The resolved control.
 * @param operation - The `text` operation.
 * @returns The prepared operation.
 * @throws {@link OperationRefusal} `SECRET_INPUT_FROM_CHAT`, `SECRET_INPUT_VISIBLE`, `CONTROL_KIND_NOT_SUPPORTED` or, without the learner's secret, `RUN_FAILED_UNEXPECTEDLY`; nothing was sent.
 * @example const prepared = await prepareTextOperation(port, context, operation)
 */
function prepareTextOperation(
  port: OperationPort,
  context: ControlOperationContext,
  operation: Extract<RepositoryOperation, { kind: 'text' }>,
): Omit<PreparedOperation, 'discard'> {
  const { description, index, configPath } = context
  const isAskLearner = operation.secret === ASK_LEARNER_SECRET
  const text = isAskLearner ? context.learnerSecret : operation.text
  assertTextMaySendSecret(context, operation, isAskLearner)
  if (text === undefined)
    throw new OperationRefusal(
      'RUN_FAILED_UNEXPECTEDLY',
      `Operation ${index} (${operation.title}) was not sent: the learner's secret was not supplied.`,
      { operationIndex: index, path: configPath('secret') },
    )
  const isNumber =
    description.tagName === 'input' && description.type === 'number'
  const isTextLike =
    description.tagName === 'textarea' ||
    (description.tagName === 'input' &&
      TEXT_LIKE_INPUT_TYPES.has(description.type ?? ''))
  if (!isNumber && !isTextLike) {
    const advice =
      description.tagName === 'select'
        ? 'Use a choose operation.'
        : (UNSUPPORTED_ADVICE[description.type ?? ''] ?? '')
    throw new OperationRefusal(
      'CONTROL_KIND_NOT_SUPPORTED',
      `Operation ${index} (${operation.title}) was not sent: text cannot be typed into ${controlKindName(description)} at ${operation.selector}. ${advice}`.trim(),
      { operationIndex: index, path: configPath('selector') },
    )
  }
  return {
    isSecret: isAskLearner,
    send: (hooks): Promise<void> =>
      isNumber
        ? sendNativeValue(port, { ...context, kind: 'number', value: text })(
            hooks,
          )
        : sendTextLike(port, context, text, hooks),
  }
}

/**
 * Refuses a `text` operation whose text would travel the wrong way: chat text into a control that reads as secret, or an ask-learner secret into a control the browser would draw in plain text.
 * @param context - The resolved control.
 * @param operation - The `text` operation.
 * @param isAskLearner - Whether the operation declares `secret: "ask-learner"`.
 * @throws {@link OperationRefusal} `SECRET_INPUT_FROM_CHAT` or `SECRET_INPUT_VISIBLE`.
 * @example assertTextMaySendSecret(context, operation, false)
 */
function assertTextMaySendSecret(
  context: ControlOperationContext,
  operation: Extract<RepositoryOperation, { kind: 'text' }>,
  isAskLearner: boolean,
): void {
  const { description, index, configPath } = context
  const label = `Operation ${index} (${operation.title})`
  const secretReason = classifySecretControl(fingerprintOf(description))
  if (!isAskLearner && secretReason)
    throw new OperationRefusal(
      'SECRET_INPUT_FROM_CHAT',
      `${label} was not sent: ${operation.selector} reads as a secret control (${secretReason}). A secret never comes from the chat; declare secret: "ask-learner" instead of text, and the learner types it in the editor.`,
      { operationIndex: index, path: configPath('text') },
    )
  // The learner's secret must go into a control the browser draws as dots.
  if (isAskLearner && description.type !== 'password')
    throw new OperationRefusal(
      'SECRET_INPUT_VISIBLE',
      `${label} was not sent: secret: "ask-learner" needs an <input type="password">, and ${operation.selector} is ${controlKindName(description)}, which the browser would draw in plain text in recorded frames.`,
      { operationIndex: index, path: configPath('secret') },
    )
}

/**
 * Reads a control's description once, parsed, for the classification of an operation.
 * @param cdp - The page's channel.
 * @param objectId - The control's remote object.
 * @param selector - The operation's selector.
 * @param port - Gives the page's origins and the run's liveness.
 * @returns The parsed description.
 * @throws When the page answers something else than a description.
 * @example const description = await describeControl(cdp, objectId, '#amount', port)
 */
async function describeControl(
  cdp: Cdp,
  objectId: string,
  selector: string,
  port: OperationPort,
): Promise<ControlDescription> {
  const result = await cdp.request('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: describeOperationControl.toString(),
    arguments: [{ value: { selector, origins: port.origins() } }],
    returnByValue: true,
  })
  return descriptionSchema.parse(result.result.value)
}

/**
 * Resolves the unique control a selector names inside the owned page without modifying it; serialized with `toString()`.
 * @param selector - The operation's selector.
 * @param origins - The loopback origins the page may be at.
 * @returns The element when exactly one matches on an owned origin; otherwise nothing.
 * @example selectControl('#amount', ['http://localhost:3000'])
 */
function selectControl(selector: string, origins: readonly string[]) {
  if (!origins.includes(location.origin)) return undefined
  let matches: NodeListOf<Element>
  try {
    matches = document.querySelectorAll(selector)
  } catch {
    return undefined
  }
  return matches.length === 1 ? matches[0] : undefined
}

/** The attributes the classification reads, with the tag name that tells the control apart. */
function fingerprintOf(
  description: ControlDescription,
): SecretControlAttributes & { tagName: string } {
  return {
    tagName: description.tagName ?? '',
    type: description.type ?? '',
    name: description.name ?? '',
    id: description.id ?? '',
    autocomplete: description.autocomplete ?? '',
  }
}

/**
 * Builds the send of a number input or a single select: the native value setter and the events, then the value check.
 * Classification is checked inside the page call itself, so a control that changed since it was classified receives nothing.
 * @param port - What the run lets the engine use.
 * @param context - The page channel, the control's remote object and description, the operation, and the value to set.
 * @returns The send function.
 * @example const send = sendNativeValue(port, { …, kind: 'select', value: 'c1' })
 */
function sendNativeValue(
  port: OperationPort,
  context: {
    cdp: Cdp
    objectId: string
    description: ControlDescription
    index: number
    operation: Exclude<RepositoryOperation, { kind: 'click' }>
    configPath: (field: string) => string
    kind: 'number' | 'select'
    value: string
  },
): PreparedOperation['send'] {
  return async (hooks): Promise<void> => {
    const { cdp, objectId, description, index, operation } = context
    const label = `Operation ${index} (${operation.title})`
    const expected = fingerprintOf(description)
    hooks.beforeInput()
    let parsed: z.infer<typeof applySchema>
    try {
      const result = await cdp.request(
        'Runtime.callFunctionOn',
        {
          objectId,
          functionDeclaration: applyNativeValue.toString(),
          arguments: [
            {
              value: {
                selector: operation.selector,
                origins: port.origins(),
                kind: context.kind,
                value: context.value,
                expected,
              },
            },
          ],
          returnByValue: true,
        },
        REPOSITORY_RUN_TIMEOUT_MS,
      )
      port.assertCurrent()
      parsed = applySchema.parse(result.result.value)
    } catch (error) {
      port.assertCurrent()
      throw new OperationRefusal(
        'RUN_FAILED_UNEXPECTEDLY',
        `${label} failed unexpectedly: ${thrownMessage(error)}`,
        { operationIndex: index, sent: 'sent' },
      )
    }
    hooks.acknowledged()
    if (!parsed.applied) {
      hooks.valueChecked(false)
      throw refusalOfUnapplied(parsed.reason, label, context)
    }
    const passed = parsed.valueMatches === true && parsed.isValid === true
    hooks.valueChecked(passed)
    if (!passed)
      throw new OperationRefusal(
        'INPUT_NOT_ACCEPTED',
        `${label} was sent, but the control refused the value by the app's own rules${describeNumberRule(parsed.rule)}. Changes the app made are not undone.`,
        {
          operationIndex: index,
          path: context.configPath(
            operation.kind === 'choose' ? 'value' : 'text',
          ),
          sent: 'sent',
        },
      )
  }
}

/**
 * Words why the page applied nothing of a native value, for {@link sendNativeValue}.
 * @param reason - The page's reason.
 * @param label - `Operation <k> (<title>)`.
 * @param context - The operation and its path builder.
 * @returns The refusal; the input event was not sent, but the value call was, so side effects stay unknown only when the page could not say.
 * @example refusalOfUnapplied('option-missing', 'Operation 1 (Customer)', context)
 */
function refusalOfUnapplied(
  reason: string | undefined,
  label: string,
  context: {
    index: number
    operation: Exclude<RepositoryOperation, { kind: 'click' }>
    configPath: (field: string) => string
  },
): OperationRefusal {
  const where = {
    operationIndex: context.index,
    path: context.configPath('selector'),
  }
  if (reason === 'option-missing' || reason === 'option-disabled')
    return new OperationRefusal(
      'OPTION_NOT_AVAILABLE',
      `${label} changed nothing: the select has ${reason === 'option-disabled' ? 'a disabled' : 'no'} option with that value.`,
      { ...where, path: context.configPath('value') },
    )
  if (reason === 'control-changed')
    return new OperationRefusal(
      'INPUT_NOT_ACCEPTED',
      `${label} changed nothing: the control changed after it was resolved, so Codebook sent nothing to it.`,
      where,
    )
  return new OperationRefusal(
    'INPUT_NOT_ACCEPTED',
    `${label} changed nothing: the control is not available (${reason ?? 'unavailable'}).`,
    where,
  )
}

/**
 * Builds the send of a `text` operation into a text-like control: the last look at the control, the browser's text insertion and the value check.
 * @param port - What the run lets the engine use.
 * @param context - The page channel, the control's description, the operation and its path builder.
 * @param text - The text to type: the declared text, or the learner's secret.
 * @param hooks - The run's moments of the input.
 * @throws {@link OperationRefusal} when the control changed since it was classified, did not take the focus, or did not read the text afterwards.
 * @example await sendTextLike(port, context, 'a@b.c', hooks)
 */
async function sendTextLike(
  port: OperationPort,
  context: {
    cdp: Cdp
    objectId: string
    description: ControlDescription
    index: number
    operation: Exclude<RepositoryOperation, { kind: 'click' }>
    configPath: (field: string) => string
    learnerSecret: string | undefined
  },
  text: string,
  hooks: OperationSendHooks,
): Promise<void> {
  const { cdp, description, index, operation } = context
  const label = `Operation ${index} (${operation.title})`
  const classified = classifySecretControl(fingerprintOf(description))
  let insertStarted = false
  let acknowledged = false
  let hookError: unknown
  try {
    await writeTextInput(
      cdp,
      { selector: operation.selector, text },
      port.origins(),
      () => port.assertCurrent(),
      label,
      {
        started: () => {},
        // A learning stop in the control's handler holds the insert until it is continued, so it waits as long as the run allows a pause, as the number and select paths do.
        insertTimeoutMs: REPOSITORY_RUN_TIMEOUT_MS,
        // The classification is read again on the exact control, right before the first character is sent.
        beforeInsert: async (insertObjectId) => {
          const again = await describeControl(
            cdp,
            insertObjectId,
            operation.selector,
            port,
          )
          port.assertCurrent()
          const nowSecret = classifySecretControl(fingerprintOf(again))
          if (
            nowSecret !== classified ||
            fingerprintOf(again).type !== fingerprintOf(description).type
          )
            throw new OperationRefusal(
              nowSecret ? 'SECRET_INPUT_VISIBLE' : 'INPUT_NOT_ACCEPTED',
              `${label} was not sent: the control changed after it was resolved, so Codebook sent nothing to it.`,
              { operationIndex: index, path: context.configPath('selector') },
            )
        },
        inserting: (inFlight) => {
          if (inFlight) {
            // The run's own refusal at this moment (a registration that changed) is not the page's: it reaches the run as it is.
            try {
              hooks.beforeInput()
            } catch (hookFailure) {
              hookError = hookFailure
              throw hookFailure
            }
            insertStarted = true
          } else {
            acknowledged = true
            hooks.acknowledged()
          }
        },
      },
    )
  } catch (error) {
    port.assertCurrent()
    if (error instanceof OperationRefusal || error === hookError) throw error
    // After the insert returned, the failure is the value check; before it, nothing reached the control.
    if (acknowledged) {
      hooks.valueChecked(false)
      throw new OperationRefusal(
        'INPUT_NOT_ACCEPTED',
        `${label} was sent, but the control does not read the text afterwards (${thrownMessage(error)}). Changes the app made are not undone.`,
        {
          operationIndex: index,
          path: context.configPath('text'),
          sent: 'sent',
        },
      )
    }
    if (!insertStarted)
      throw new OperationRefusal(
        'INPUT_NOT_ACCEPTED',
        `${label} was not sent: ${thrownMessage(error)}`,
        { operationIndex: index, path: context.configPath('selector') },
      )
    throw new OperationRefusal(
      'RUN_FAILED_UNEXPECTEDLY',
      `${label} failed unexpectedly while its text was being typed.`,
      { operationIndex: index, sent: 'sent' },
    )
  }
  hooks.valueChecked(true)
}

/**
 * Presses and releases the left mouse button once at a click target's centre.
 * @param port - What the run lets the engine use.
 * @param readPoint - Reads the unique visible enabled target's centre in viewport coordinates; called again right before the press because the gates and the arming that precede it yield to the page.
 * @param hooks - The run's moments of the input.
 * @throws {@link OperationRefusal} `INPUT_NOT_ACCEPTED` when the target is no longer a unique visible enabled target (nothing was sent); `RUN_FAILED_UNEXPECTEDLY` when the transport fails after the press; the click is never retried.
 * @example await sendClick(port, () => port.readClickPoint('#pay'), hooks)
 */
async function sendClick(
  port: OperationPort,
  readPoint: () => Promise<{ x: number; y: number }>,
  hooks: OperationSendHooks,
): Promise<void> {
  const cdp = await port.pageCdp()
  const point = await readPoint()
  hooks.beforeInput()
  for (const type of ['mousePressed', 'mouseReleased'] as const) {
    await cdp.request(
      'Input.dispatchMouseEvent',
      { type, button: 'left', clickCount: 1, x: point.x, y: point.y },
      REPOSITORY_RUN_TIMEOUT_MS,
    )
    port.assertCurrent()
  }
  hooks.acknowledged()
}

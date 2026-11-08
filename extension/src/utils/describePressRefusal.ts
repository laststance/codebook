import {
  ELEMENT_VALUE_LIMIT_CHARS,
  type PressRefusalReason,
} from '../constants'

/** The attributes that name an element in a refusal: tag, type, id and name only, never a value or text. */
export type PressElementIdentity = {
  tagName: string
  type?: string
  id?: string
  name?: string
  /** The tag of the element the page resolved, when the recipient lives in an open shadow root below it (D27). */
  hostTagName?: string
}

/** What {@link describePressRefusal} words a refusal from. */
export type PressRefusalInput = {
  /** The 1-based number of the operation among the run's operations. */
  index: number
  title: string
  /** The declared `selector`, when the press names one. */
  selector?: string
  /** The element the refusal is about (the recipient, or the named target). */
  element: PressElementIdentity
  /** For `press-secret-control`: how the control reads as secret (`type=password`, `name`, `id`, `autocomplete`). */
  classification?: string
  /** For `press-focus-changed`: the element that held focus at the check and the one that holds it at the send. */
  focusBefore?: PressElementIdentity
  focusAfter?: PressElementIdentity
}

/**
 * Words an element as `<tag type="…" id="…" name="…">` with only its non-empty attributes, each JSON-quoted and cut, followed by ` inside <host>` when the recipient sits in a shadow root below another element.
 * Called by {@link describePressRefusal}.
 * @param element - The element's tag and identifying attributes.
 * @returns The description; never a value or text of the element.
 * @example describePressElement({ tagName: 'input', type: 'text', id: 'q' }) // => '<input type="text" id="q">'
 */
function describePressElement(element: PressElementIdentity): string {
  const attributes = (['type', 'id', 'name'] as const)
    .map((attribute) => [attribute, element[attribute]] as const)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(
      ([attribute, value]) =>
        ` ${attribute}=${JSON.stringify((value ?? '').slice(0, ELEMENT_VALUE_LIMIT_CHARS))}`,
    )
  const host =
    element.hostTagName === undefined || element.hostTagName === ''
      ? ''
      : ` inside <${element.hostTagName.slice(0, ELEMENT_VALUE_LIMIT_CHARS)}>`
  return `<${element.tagName}${attributes.join('')}>${host}`
}

/**
 * Builds the sentence and the configuration path of one press refusal.
 *
 * Why it exists: the six closed reasons of `OPERATION_PRESS_REASONS` each need a two-sentence message (what was refused, how to fix it) that names no element value; one builder keeps the wording and the paths together. Called by the press engine when it refuses a press, and by the run for `press-after-already-holds`.
 * @param reason - The closed reason.
 * @param input - The operation and the elements the sentence names.
 * @returns `message` (`Operation i (title) was not sent: what. fix`) and `path`: `operations[k].selector` when a selector is declared (`operations[k].after` for `press-after-already-holds`), else `operations[k]`.
 * @example
 * describePressRefusal('press-secret-control', { index: 2, title: 'Open', element: { tagName: 'input', type: 'password' }, classification: 'type=password' })
 * // => { message: 'Operation 2 (Open) was not sent: the key would go to <input type="password">, which reads as a secret control (type=password). A key never goes to a secret control: …', path: 'operations[1]' }
 */
export function describePressRefusal(
  reason: PressRefusalReason,
  input: PressRefusalInput,
): { message: string; path: string } {
  const fieldBase = `operations[${input.index - 1}]`
  const element = describePressElement(input.element)
  const sentences: Record<PressRefusalReason, [string, string]> = {
    'press-focus-in-text-entry': [
      `the key would go to the focused ${element}, a text-entry control`,
      `Declare ${fieldBase}.selector as that control if the key is meant for it; otherwise add an earlier click on a non-text element to move focus away.`,
    ],
    'press-secret-control': [
      `the key would go to ${element}, which reads as a secret control (${input.classification ?? 'secret'})`,
      'A key never goes to a secret control: click the submit control, or use secret: "ask-learner" on a text operation.',
    ],
    'press-target-not-focusable': [
      `${input.selector ?? 'the selector'} names ${element}, which cannot take focus`,
      'Omit selector to send the key to the page, or name a focusable element.',
    ],
    'press-focus-changed': [
      `focus moved from ${describePressElement(input.focusBefore ?? input.element)} to ${describePressElement(input.focusAfter ?? input.element)} between the check and the send`,
      'Nothing was sent; start one new run (ask the learner first when earlier operations ran).',
    ],
    'press-focus-in-frame': [
      `focus is inside ${element}, a frame whose content Codebook cannot read`,
      `Click an element of the top document to move focus out of the frame, or name a top-document element with ${fieldBase}.selector.`,
    ],
    'press-after-already-holds': [
      "the press's after conditions already hold before the key, so they could not prove it worked",
      'Declare an after condition that only the opened UI satisfies.',
    ],
  }
  const [what, fix] = sentences[reason]
  const path =
    reason === 'press-after-already-holds'
      ? `${fieldBase}.after`
      : input.selector === undefined
        ? fieldBase
        : `${fieldBase}.selector`
  return {
    message: `Operation ${input.index} (${input.title}) was not sent: ${what}. ${fix}`,
    path,
  }
}

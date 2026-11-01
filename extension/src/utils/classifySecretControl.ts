import { isSecretName } from './isSecretName'

/** The `autocomplete` tokens that mark a control as holding a secret, besides its type and its name or id (CEO-S21). */
const SECRET_AUTOCOMPLETE_TOKENS: ReadonlySet<string> = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
])

/** What {@link classifySecretControl} reads of a control: the attributes the owned page reports, never its value. */
export type SecretControlAttributes = {
  /** The `type` of an `<input>`; empty for any other element. */
  type: string
  name: string
  id: string
  /** The raw `autocomplete` attribute: space-separated tokens. */
  autocomplete: string
}

/**
 * Tells whether a control reads as holding a secret, so a chat-supplied text is refused and a typed secret is asked of the learner.
 * Why: the chat must never carry a password, a one-time code or a card number; called by {@link prepareOperation} when it resolves an operation's control and again right before the input is sent.
 * @param attributes - The control's type, name, id and autocomplete.
 * @returns The reason the control reads as secret (`type=password`, `name`, `id` or `autocomplete`), or `undefined` when it does not.
 * @example
 * classifySecretControl({ type: 'password', name: '', id: '', autocomplete: '' }) // => 'type=password'
 * classifySecretControl({ type: 'text', name: 'accessToken', id: '', autocomplete: '' }) // => 'name'
 * classifySecretControl({ type: 'text', name: 'email', id: 'email', autocomplete: 'email' }) // => undefined
 */
export function classifySecretControl(
  attributes: SecretControlAttributes,
): 'type=password' | 'name' | 'id' | 'autocomplete' | undefined {
  if (attributes.type === 'password') return 'type=password'
  if (attributes.name && isSecretName(attributes.name)) return 'name'
  if (attributes.id && isSecretName(attributes.id)) return 'id'
  // A token list: `section-a current-password` still names a password.
  const tokens = attributes.autocomplete.toLowerCase().split(/\s+/)
  if (tokens.some((token) => SECRET_AUTOCOMPLETE_TOKENS.has(token)))
    return 'autocomplete'
  return undefined
}

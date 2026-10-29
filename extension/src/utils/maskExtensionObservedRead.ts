import {
  EXTENSION_OBSERVED_VALUE_LIMIT_CHARS,
  REDACTION_MASK,
} from '../constants'
import type { ChromeExtensionObservedRead } from '../runtime'

import { isSecretName } from './isSecretName'
import { redactSecretText } from './redactSecretText'
import { hidePrivateRoots, type CauseRoots } from './sanitizeCause'

/**
 * Masks one JSON value for the report: a member under a secret-like key is replaced whole, and every string loses credential shapes and private roots.
 * @param value - Any JSON value read from the extension.
 * @param roots - The private roots a text must not show.
 * @returns The value with the same shape.
 * @example maskNode({ apiKey: 'k', note: 'x' }, {}) // => { apiKey: '[masked]', note: 'x' }
 */
function maskNode(value: unknown, roots: CauseRoots): unknown {
  if (typeof value === 'string')
    return hidePrivateRoots(redactSecretText(value), roots)
  if (Array.isArray(value)) return value.map((item) => maskNode(item, roots))
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [
        key,
        isSecretName(key) ? REDACTION_MASK : maskNode(member, roots),
      ]),
    )
  return value
}

/**
 * Turns a raw observation read into what the run resource reports (CR9, ER23): masked, root-hidden and cut at {@link EXTENSION_OBSERVED_VALUE_LIMIT_CHARS} characters with `truncated: true`.
 * Called by the run for the baseline and the after read, after `changed` was decided on the unmasked values.
 * @param read - The raw read.
 * @param roots - The private roots a text must not show.
 * @param isSecretValue - The read is the value of an observed storage key with a secret-like name (`password`, `token`, ...): the whole value is replaced, as a member under such a key is.
 * @returns A value (a cut one reads as its JSON or text prefix), `missing`, or `unavailable` with its masked cause.
 * @example
 * maskExtensionObservedRead({ value: { token: 'abc', n: 1 } }, {}) // => { value: { token: '[masked]', n: 1 } }
 * maskExtensionObservedRead({ value: 'hunter2' }, {}, true) // => { value: '[masked]' }
 */
export function maskExtensionObservedRead(
  read: ExtensionObservedRawRead,
  roots: CauseRoots,
  isSecretValue = false,
): ChromeExtensionObservedRead {
  if ('missing' in read) return { missing: true }
  if ('unavailable' in read)
    return {
      unavailable: true,
      cause: hidePrivateRoots(redactSecretText(read.cause), roots),
    }
  // The observed key itself names a secret: its value is never shown, whatever its shape.
  if (isSecretValue) return { value: REDACTION_MASK }
  const masked = maskNode(read.value, roots)
  const text = typeof masked === 'string' ? masked : JSON.stringify(masked)
  // A value that fits keeps its own shape; a longer one reads as its first characters.
  if (text === undefined || text.length <= EXTENSION_OBSERVED_VALUE_LIMIT_CHARS)
    return { value: masked }
  return {
    value: text.slice(0, EXTENSION_OBSERVED_VALUE_LIMIT_CHARS),
    truncated: true,
  }
}

/** One unmasked read of the declared observation, as the reader returns it. */
export type ExtensionObservedRawRead =
  { value: unknown } | { missing: true } | { unavailable: true; cause: string }

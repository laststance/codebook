import { MILLISECONDS_PER_SECOND } from '../constants'

import { thrownMessage } from './thrownMessage'

/**
 * Reads the failure text of a progress deadline at its expiry, so a reason that depends on what is known only then can never lose the deadline by throwing.
 * {@link ConfiguredBrowserRun} calls it inside the deadline's timer, before it fails the run.
 * @param reason - The deadline's text, or a function that composes it at expiry.
 * @param milliseconds - The deadline's length, named by the fallback text.
 * @returns
 * - The text, or what the function returns
 * - When the function throws: a fallback that names the deadline and the thrown message
 * @example
 * deadlineText('after timed out', 20_000) // => 'after timed out'
 * deadlineText(() => { throw new Error('session gone') }, 20_000) // => 'Repository run made no progress within 20 s; its failure text could not be composed: session gone'
 */
export function deadlineText(
  reason: string | (() => string),
  milliseconds: number,
): string {
  if (typeof reason === 'string') return reason
  try {
    return reason()
  } catch (error) {
    return `Repository run made no progress within ${milliseconds / MILLISECONDS_PER_SECOND} s; its failure text could not be composed: ${thrownMessage(error)}`
  }
}

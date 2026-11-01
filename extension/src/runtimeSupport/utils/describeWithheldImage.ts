import type { SecretFrameWithholdReason } from '../secretFrameGate'

/**
 * Names, in a sentence for the learner, why an image was withheld.
 *
 * Why it exists: the recording's gap and the run's withheld stop image must say the same true cause, and a cross-origin frame is not an unsafe password control.
 * Called by {@link BrowserViewport} for a recording gap and by {@link ConfiguredBrowserRun} for a withheld stop image.
 * @param reason - Why the secret frame gate withheld the image.
 * @returns A sentence that names the cause and contains no page address.
 * @example
 * describeWithheldImage('secret-not-verified') // => 'An image was withheld while a secret control was not safe to draw.'
 */
export function describeWithheldImage(
  reason: SecretFrameWithholdReason,
): string {
  return reason === 'cross-origin-frame'
    ? 'An image was withheld while a frame from another origin, whose content Codebook cannot read, was on screen after a secret was typed.'
    : 'An image was withheld while a secret control was not safe to draw.'
}

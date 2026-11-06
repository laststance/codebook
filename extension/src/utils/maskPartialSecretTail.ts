import { NODE_SERVER_SECRET_TAIL_MIN_CHARS, REDACTION_MASK } from '../constants'

/**
 * Replaces a text's ending that is the start of a known secret form with the redaction mask.
 *
 * Why it exists: when held output is published without waiting for more (a quiet channel, the channel's end), a secret written in two parts far apart would otherwise leak as two fragments.
 * Called by {@link createKnownValueMaskStage} on a timed release and at a channel's end, after the full forms were masked.
 *
 * @param text - The already masked text about to be published.
 * @param forms - The masking forms of the run's secrets.
 * @returns The text with its longest suffix that is a prefix of a form (at least {@link NODE_SERVER_SECRET_TAIL_MIN_CHARS} characters) replaced by {@link REDACTION_MASK}; the text itself when no such suffix exists.
 * @example
 * maskPartialSecretTail('pw hunt', ['hunter2']) // => 'pw [masked]'
 * maskPartialSecretTail('pw hi', ['hunter2']) // => 'pw hi'
 */
export function maskPartialSecretTail(
  text: string,
  forms: readonly string[],
): string {
  const longest = forms.reduce((max, form) => Math.max(max, form.length), 0)
  // Longest candidate suffix first, so the whole partial form goes, not just its end.
  for (
    let start = Math.max(0, text.length - longest);
    start <= text.length - NODE_SERVER_SECRET_TAIL_MIN_CHARS;
    start++
  ) {
    const suffix = text.slice(start)
    if (forms.some((form) => form.startsWith(suffix)))
      return text.slice(0, start) + REDACTION_MASK
  }
  return text
}

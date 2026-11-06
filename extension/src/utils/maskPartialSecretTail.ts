import { REDACTION_MASK } from '../constants'

/** A secret form whose start ended a released text, and how many of its characters that ending held. */
export type StartedSecretForm = {
  /** The masking form whose start was seen. */
  form: string
  /** How many leading characters of the form the released ending held; always below the form's length. */
  matched: number
}

/**
 * Replaces a text's ending that is the start of a known secret form with the redaction mask, and reports which forms it started.
 *
 * Why it exists: when held output is published without waiting for more (a quiet channel, the channel's end), a secret written in pieces far apart would otherwise leak as raw fragments. Even one character counts, so no piece of a secret is published bare.
 * Called by {@link createKnownValueMaskStage} on a timed release and at a channel's end, after the full forms were masked; the reported forms feed {@link continueSecretForms} for the channel's next text.
 *
 * @param text - The already masked text about to be published.
 * @param forms - The masking forms of the run's secrets.
 * @returns The text with its longest non-empty suffix that is a prefix of a form replaced by {@link REDACTION_MASK} (the text itself when no such suffix exists), and every form that suffix started with its matched length.
 * @example
 * maskPartialSecretTail('pw hunt', ['hunter2']) // => { text: 'pw [masked]', started: [{ form: 'hunter2', matched: 4 }] }
 * maskPartialSecretTail('pw hi', ['hunter2']) // => { text: 'pw hi', started: [] }
 */
export function maskPartialSecretTail(
  text: string,
  forms: readonly string[],
): { text: string; started: StartedSecretForm[] } {
  const longest = forms.reduce((max, form) => Math.max(max, form.length), 0)
  // Longest candidate suffix first, so the whole partial form goes, not just its end.
  for (
    let start = Math.max(0, text.length - longest);
    start < text.length;
    start++
  ) {
    const suffix = text.slice(start)
    const started = forms
      .filter((form) => form.length > suffix.length && form.startsWith(suffix))
      .map((form) => ({ form, matched: suffix.length }))
    if (started.length > 0)
      return { text: text.slice(0, start) + REDACTION_MASK, started }
  }
  return { text, started: [] }
}

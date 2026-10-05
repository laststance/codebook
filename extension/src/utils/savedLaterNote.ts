import type { ExplanationSavedLater } from './projectRecording'

/**
 * Says in one sentence when an explanation that the replay shows before its own saved time was saved; serialized into the Study pane, which puts the sentence under that explanation.
 * It reads nothing outside its argument, because the pane runs its source text.
 * @param savedLater - What {@link projectRecording} found for the explanation.
 * @returns
 * - `'while-pause-held'`: "This explanation was saved while this pause was held."
 * - `'after-pause-ended'`: "This explanation was saved after this pause ended."
 * - `'after-recording-ended'`: "This explanation was saved after the recording ended."
 * @example
 * savedLaterNote('after-pause-ended') // => 'This explanation was saved after this pause ended.'
 */
export function savedLaterNote(savedLater: ExplanationSavedLater): string {
  if (savedLater === 'while-pause-held')
    return 'This explanation was saved while this pause was held.'
  if (savedLater === 'after-pause-ended')
    return 'This explanation was saved after this pause ended.'
  return 'This explanation was saved after the recording ended.'
}

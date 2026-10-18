import type { UnconfirmedWriter } from '../learningLibrary'

/**
 * Words what Codebook knows of a recording whose writer this computer cannot confirm: where and when the recording was started, and that Codebook cannot tell whether it is still recording. These are the first sentences of the removal's dialog ({@link studyRemovalMessages}) and the whole cause that {@link LearningLibrary.removeStudy} answers with its refusal, so the two never drift apart.
 * @param writer - The host the recording names, its start as the learner reads it (in local time), and where its writer would run.
 * @returns
 * - `another-computer`: "Its recording was started on <host> at <start>. Codebook cannot tell from this computer whether it is still recording."
 * - `this-computer`: "Its recording was started on <host> at <start>. Codebook cannot tell whether an editor window of this computer is still recording it."
 * @example
 * unconfirmedWriterSentences({ host: 'old-laptop.local', startedAt: '10/1/2026, 10:00:00 AM', place: 'another-computer' })
 * // => 'Its recording was started on old-laptop.local at 10/1/2026, 10:00:00 AM. Codebook cannot tell from this computer whether it is still recording.'
 */
export function unconfirmedWriterSentences({
  host,
  startedAt,
  place,
}: UnconfirmedWriter): string {
  const started = `Its recording was started on ${host} at ${startedAt}.`
  return place === 'another-computer'
    ? `${started} Codebook cannot tell from this computer whether it is still recording.`
    : `${started} Codebook cannot tell whether an editor window of this computer is still recording it.`
}

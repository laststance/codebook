import type { NamedUnconfirmedWriters } from '../learningLibrary'

/** Joins the places and times at which a study's recordings were started, as English lists them: "A", "A and B", "A, B, and C". */
const RECORDING_STARTS = new Intl.ListFormat('en', {
  style: 'long',
  type: 'conjunction',
})

/**
 * Words what Codebook knows of the recordings of a study whose writers this computer cannot confirm: where and when each recording was started, and that Codebook cannot tell whether an editor window still records it. These are the first sentences of the removal's dialog ({@link studyRemovalMessages}) and the whole cause that {@link LearningLibrary.removeStudy} answers with its refusal, so the two never drift apart.
 * @param writers - The host each recording names, its start as the learner reads it (in local time), and where its writer would run.
 * @returns
 * - One recording, `another-computer`: "Its recording was started on <host> at <start>. Codebook cannot tell from this computer whether an editor window still records it."
 * - One recording, `this-computer`: "Its recording was started on <host> at <start>. Codebook cannot tell whether an editor window of this computer still records it."
 * - Several: "Its recordings were started on <host> at <start> and on <host> at <start>." and the same second sentence about them; it names this computer only when every one of them is of this computer
 * @example
 * unconfirmedWriterSentences([{ host: 'old-laptop.local', startedAt: '10/1/2026, 10:00:00 AM', place: 'another-computer' }])
 * // => 'Its recording was started on old-laptop.local at 10/1/2026, 10:00:00 AM. Codebook cannot tell from this computer whether an editor window still records it.'
 */
export function unconfirmedWriterSentences(
  writers: NamedUnconfirmedWriters,
): string {
  const starts = RECORDING_STARTS.format(
    writers.map(({ host, startedAt }) => `on ${host} at ${startedAt}`),
  )
  // One recording is "it"; several are "them".
  const [started, them] =
    writers.length === 1
      ? ['Its recording was started', 'it']
      : ['Its recordings were started', 'them']
  // A writer on another computer is one this computer cannot look at at all; only writers all of this computer are named so.
  return writers.some((writer) => writer.place === 'another-computer')
    ? `${started} ${starts}. Codebook cannot tell from this computer whether an editor window still records ${them}.`
    : `${started} ${starts}. Codebook cannot tell whether an editor window of this computer still records ${them}.`
}

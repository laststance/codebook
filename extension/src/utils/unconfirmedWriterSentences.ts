import type { UnconfirmedWriters } from '../learningLibrary'

/** Joins the places and times at which a study's recordings were started, as English lists them: "A", "A and B", "A, B, and C". */
const RECORDING_STARTS = new Intl.ListFormat('en', {
  style: 'long',
  type: 'conjunction',
})

/**
 * Words what Codebook knows of the recordings of a study whose writers this computer cannot confirm: where and when each recording was started, and that Codebook cannot tell whether it is still recording. These are the first sentences of the removal's dialog ({@link studyRemovalMessages}) and the whole cause that {@link LearningLibrary.removeStudy} answers with its refusal, so the two never drift apart.
 * @param writers - The host each recording names, its start as the learner reads it (in local time), and where its writer would run; the first one's place words the second sentence (a writer on another computer comes first).
 * @returns
 * - One recording, `another-computer`: "Its recording was started on <host> at <start>. Codebook cannot tell from this computer whether it is still recording."
 * - One recording, `this-computer`: "Its recording was started on <host> at <start>. Codebook cannot tell whether an editor window of this computer is still recording it."
 * - Several: "Its recordings were started on <host> at <start> and on <host> at <start>." and the second sentence about them
 * @example
 * unconfirmedWriterSentences([{ host: 'old-laptop.local', startedAt: '10/1/2026, 10:00:00 AM', place: 'another-computer' }])
 * // => 'Its recording was started on old-laptop.local at 10/1/2026, 10:00:00 AM. Codebook cannot tell from this computer whether it is still recording.'
 */
export function unconfirmedWriterSentences(
  writers: UnconfirmedWriters,
): string {
  const [lead] = writers
  const starts = RECORDING_STARTS.format(
    writers.map(({ host, startedAt }) => `on ${host} at ${startedAt}`),
  )
  // One recording is "it"; several are "they".
  if (writers.length === 1)
    return lead.place === 'another-computer'
      ? `Its recording was started ${starts}. Codebook cannot tell from this computer whether it is still recording.`
      : `Its recording was started ${starts}. Codebook cannot tell whether an editor window of this computer is still recording it.`
  return lead.place === 'another-computer'
    ? `Its recordings were started ${starts}. Codebook cannot tell from this computer whether they are still recording.`
    : `Its recordings were started ${starts}. Codebook cannot tell whether an editor window of this computer is still recording them.`
}

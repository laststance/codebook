import type {
  NamedUnconfirmedWriter,
  NamedUnconfirmedWriters,
} from '../learningLibrary'

/** Joins the places and times at which a study's recordings were started, as English lists them: "A", "A and B", "A, B, and C". */
const RECORDING_STARTS = new Intl.ListFormat('en', {
  style: 'long',
  type: 'conjunction',
})

/** A writer the learner reads by the host and the start its recording names: every {@link NamedUnconfirmedWriter} but an `unreadable` recording's. */
type HostedUnconfirmedWriter = Extract<NamedUnconfirmedWriter, { host: string }>

/**
 * Words where and when each recording of a study was started whose writer this computer cannot confirm, and that Codebook cannot tell whether an editor window still records it or still has to save it; called by {@link unconfirmedWriterSentences}.
 * @param writers - The writers named by host and start.
 * @returns The two sentences; `''` for none.
 * @example hostedWriterSentences([{ host: 'workstation', startedAt: '10/1/2026, 10:00:00 AM', place: 'this-computer' }]) // => 'Its recording was started on workstation at 10/1/2026, 10:00:00 AM. Codebook cannot tell whether an editor window of this computer still records it or still has to save it.'
 */
function hostedWriterSentences(
  writers: readonly HostedUnconfirmedWriter[],
): string {
  if (!writers.length) return ''
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
    ? `${started} ${starts}. Codebook cannot tell from this computer whether an editor window still records ${them} or still has to save ${them}.`
    : `${started} ${starts}. Codebook cannot tell whether an editor window of this computer still records ${them} or still has to save ${them}.`
}

/**
 * Words that Codebook could not read the files of a study's recordings now, and why that may be, for recordings whose header or writer record stands and gave nothing (`unreadable`, Cycle 0047 row 251); called by {@link unconfirmedWriterSentences}.
 * @param count - How many recordings could not be read.
 * @param isAfterHostedWriters - Whether sentences about recordings named by host and start come first, so that these speak of the study's other recordings.
 * @returns The two sentences; `''` for none.
 * @example unreadableRecordingSentences(1, true) // => 'Codebook could not read the files of its other recording now. A virus scanner may hold them, or another editor window may still record it or still have to save it.'
 */
function unreadableRecordingSentences(
  count: number,
  isAfterHostedWriters: boolean,
): string {
  if (count === 0) return ''
  // One recording is "it"; several are "them".
  const [recordings, them] =
    count === 1 ? ['recording', 'it'] : ['recordings', 'them']
  const whose = isAfterHostedWriters ? 'its other' : 'its'
  return `Codebook could not read the files of ${whose} ${recordings} now. A virus scanner may hold them, or another editor window may still record ${them} or still have to save ${them}.`
}

/**
 * Words what Codebook knows of the recordings of a study whose writers this computer cannot confirm: where and when each recording was started, and that Codebook cannot tell whether an editor window still records it or still has to save it; for a recording whose files it could not read now, that it could not, and that a virus scanner or another window may be the cause. These are the first sentences of the removal's dialog ({@link studyRemovalMessages}) and the whole cause that {@link LearningLibrary.removeStudy} answers with its refusal, so the two never drift apart.
 * @param writers - The host each recording names, its start as the learner reads it (in local time), and where its writer would run; or `unreadable` alone for a recording whose header or writer record could not be read.
 * @returns
 * - One recording, `another-computer`: "Its recording was started on <host> at <start>. Codebook cannot tell from this computer whether an editor window still records it or still has to save it."
 * - One recording, `this-computer`: "Its recording was started on <host> at <start>. Codebook cannot tell whether an editor window of this computer still records it or still has to save it."
 * - Several: "Its recordings were started on <host> at <start> and on <host> at <start>." and the same second sentence about them; it names this computer only when every one of them is of this computer
 * - One recording, `unreadable`: "Codebook could not read the files of its recording now. A virus scanner may hold them, or another editor window may still record it or still have to save it." (several: "its recordings", "them")
 * - `unreadable` recordings beside named ones: the sentences of the named ones, then those of the unreadable ones, which speak of "its other recording" (or "its other recordings")
 * The second sentence holds for a sealed recording too: its run holds it until it has saved the study it took after the seal ({@link isSealedRecordingReleased}), so a writer this computer cannot confirm may still have to save a recording that nobody records any more.
 * @example
 * unconfirmedWriterSentences([{ host: 'old-laptop.local', startedAt: '10/1/2026, 10:00:00 AM', place: 'another-computer' }])
 * // => 'Its recording was started on old-laptop.local at 10/1/2026, 10:00:00 AM. Codebook cannot tell from this computer whether an editor window still records it or still has to save it.'
 * unconfirmedWriterSentences([{ place: 'unreadable' }])
 * // => 'Codebook could not read the files of its recording now. A virus scanner may hold them, or another editor window may still record it or still have to save it.'
 */
export function unconfirmedWriterSentences(
  writers: NamedUnconfirmedWriters,
): string {
  const hosted = writers.flatMap((writer) =>
    writer.place === 'unreadable' ? [] : [writer],
  )
  return [
    hostedWriterSentences(hosted),
    unreadableRecordingSentences(
      writers.length - hosted.length,
      hosted.length > 0,
    ),
  ]
    .filter((sentences) => sentences !== '')
    .join(' ')
}

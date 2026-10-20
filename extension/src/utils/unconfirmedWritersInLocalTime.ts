import type { NamedUnconfirmedWriter } from '../learningLibrary'

/**
 * Gives the writers of a study's recordings that this computer cannot confirm with their starts in this editor's local time, as the learner reads them in the removal's cause and dialog; called by the cause of {@link LearningLibrary.removeStudy}'s refusal and by {@link StudyWorkspace} before its dialog.
 * @param writers - The writers, with their starts as ISO times; any other field of theirs stays.
 * @returns The same writers in the same order, each `startedAt` as `toLocaleString` gives it; an `unreadable` recording, which has no start, as it is.
 * @example unconfirmedWritersInLocalTime([{ host: 'old-laptop.local', startedAt: '2026-10-01T08:00:00.000Z', place: 'another-computer' }]) // => [{ host: 'old-laptop.local', startedAt: '10/1/2026, 10:00:00 AM', place: 'another-computer' }] in Central Europe
 */
export function unconfirmedWritersInLocalTime<
  Writer extends NamedUnconfirmedWriter,
>(writers: readonly [Writer, ...Writer[]]): readonly [Writer, ...Writer[]] {
  const [lead, ...others] = writers
  const local = (writer: Writer): Writer =>
    // A recording that could not be read names no start.
    writer.place === 'unreadable'
      ? writer
      : { ...writer, startedAt: new Date(writer.startedAt).toLocaleString() }
  return [local(lead), ...others.map(local)]
}

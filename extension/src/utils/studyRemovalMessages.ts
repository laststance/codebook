import type { NamedUnconfirmedWriters } from '../learningLibrary'

import { systemTrashName, type SystemTrashName } from './systemTrashName'
import { unconfirmedWriterSentences } from './unconfirmedWriterSentences'

/**
 * Words the room the library has after a removal; a library still at or above its limit (the limit was lowered below the stored count) says how many more studies must go before another can be saved.
 * @param usage - The library's count and its limit; the limit is absent while the setting is invalid.
 * @returns A sentence with a leading space, or `''` without a valid limit.
 * @example
 * libraryRoomSentence({ count: 63, limit: 64 }) // => ' The library now holds 63 of 64 saved studies.'
 * libraryRoomSentence({ count: 69, limit: 64 }) // => ' The library now holds 69 of 64 saved studies and is still full; delete 6 more before another study can be saved.'
 */
function libraryRoomSentence(usage: { count: number; limit?: number }): string {
  if (usage.limit === undefined) return ''
  const holds = ` The library now holds ${usage.count} of ${usage.limit} saved studies`
  if (usage.count < usage.limit) return `${holds}.`
  return `${holds} and is still full; delete ${usage.count - usage.limit + 1} more before another study can be saved.`
}

/**
 * Says whether one of the writers the dialog names may run on another computer; the title, the sentences and the warning name that place only then.
 * @param writers - The recordings' writers.
 * @returns `true` when one of them is on another computer; `false` when all are of this computer.
 * @example hasWriterOnAnotherComputer([{ host: 'workstation', startedAt, place: 'this-computer' }]) // => false
 */
function hasWriterOnAnotherComputer(writers: NamedUnconfirmedWriters): boolean {
  return writers.some((writer) => writer.place === 'another-computer')
}

/**
 * Words what the answers of the dialog about recordings whose writers this computer cannot confirm do, after {@link unconfirmedWriterSentences}; called by {@link studyRemovalMessages} for the dialog's detail.
 * @param writers - The recordings' writers.
 * A window that has sealed its recording and not saved its study yet still holds it ({@link isSealedRecordingReleased}), so the warning names that window as well as one that still records.
 * @returns What is lost if a window still records or still has to save a recording, that nothing is lost otherwise, and what Cancel keeps; for one recording or for several, naming another computer only when a writer may run there.
 * @example unconfirmedWriterWarning([{ host: 'workstation', startedAt, place: 'this-computer' }]) // => 'If a window still records it or still has to save it, the recording is lost. If none does, nothing is lost. Cancel keeps the study and its recording as they are.'
 */
function unconfirmedWriterWarning(writers: NamedUnconfirmedWriters): string {
  const isElsewhere = hasWriterOnAnotherComputer(writers)
  // One recording is "it"; several are "one of them".
  if (writers.length === 1)
    return `${isElsewhere ? 'If a window still records it or still has to save it, on that computer or on this one, the recording is lost.' : 'If a window still records it or still has to save it, the recording is lost.'} If none does, nothing is lost. Cancel keeps the study and its recording as they are.`
  return `${isElsewhere ? 'If a window still records one of them or still has to save it, on another computer or on this one, that recording is lost.' : 'If a window still records one of them or still has to save it, that recording is lost.'} If none does, nothing is lost. Cancel keeps the study and its recordings as they are.`
}

/**
 * Words the title of the dialog about recordings whose writers this computer cannot confirm: for one recording or for several, naming only the places that apply; called by {@link studyRemovalMessages}.
 * "In use" holds for a recording that a window still records and for a sealed one whose run has not saved its study yet, which that run still holds ({@link isSealedRecordingReleased}).
 * @param writers - The recordings' writers.
 * @param trashName - The host's word for the system Trash.
 * @returns The title, which ends with the question the button answers.
 * @example unconfirmedWriterTitleOf([{ host: 'laptop', startedAt, place: 'another-computer' }, { host: 'workstation', startedAt, place: 'this-computer' }], 'Trash') // => "Some of this study's recordings may still be in use on another computer or in another editor window. Move the study to the Trash anyway?"
 */
function unconfirmedWriterTitleOf(
  writers: NamedUnconfirmedWriters,
  trashName: SystemTrashName,
): string {
  const isElsewhere = hasWriterOnAnotherComputer(writers),
    isHere = writers.some((writer) => writer.place === 'this-computer')
  // Each title is written out whole, so the change history's quotations of it stand in this source word for word.
  if (writers.length === 1)
    return isElsewhere
      ? `This study's recording may still be in use on another computer. Move the study to the ${trashName} anyway?`
      : `This study's recording may still be in use in another editor window. Move the study to the ${trashName} anyway?`
  if (isElsewhere && isHere)
    return `Some of this study's recordings may still be in use on another computer or in another editor window. Move the study to the ${trashName} anyway?`
  return isElsewhere
    ? `Some of this study's recordings may still be in use on another computer. Move the study to the ${trashName} anyway?`
    : `Some of this study's recordings may still be in use in another editor window. Move the study to the ${trashName} anyway?`
}

/**
 * Words every learner-facing text of a saved study's removal with the host's word for the system Trash, so the dialog, the status line and the failures agree; called by {@link StudyWorkspace} when it confirms a removal and reports its outcome.
 * @param trashName - The host's word for the system Trash.
 * @returns The dialog's title, button and detail, the in-progress line, the dialog of a recording whose writer this computer cannot confirm, builders for the outcomes, the answer to a request for a study's files that could not be listed, and the storage line for a lock that could not be released.
 * @example
 * studyRemovalMessages('Trash').confirmTitle // => 'Move this saved study to the Trash?'
 * studyRemovalMessages('Recycle Bin').confirmButton // => 'Move to Recycle Bin'
 * studyRemovalMessages('Trash').moved({ count: 63, limit: 64 }, true) // => 'Saved study moved to the Trash. The library now holds 63 of 64 saved studies. Ask your editor agent to start the run again.'
 * studyRemovalMessages('Trash').moved({ count: 63, limit: 64 }, false, true) // => "Saved study moved to the Trash. The library now holds 63 of 64 saved studies. The run's raw evidence was left in place because its Codebook window may still be open."
 */
export function studyRemovalMessages(
  trashName: SystemTrashName = systemTrashName(),
) {
  return {
    confirmTitle: `Move this saved study to the ${trashName}?`,
    confirmButton: `Move to ${trashName}`,
    /** The dialog's detail: which study, and what the removal does and keeps. */
    confirmDetail: (identityLine: string): string =>
      `${identityLine}\n\nAny saved recording moves with it, and so does the raw evidence of its run unless another Codebook window may still be using it. What you marked as understood is kept. Repository Wiki links to this study will show as unavailable.`,
    moving: `Moving the saved study to the ${trashName}…`,
    /** The success line: the library's room after the removal, the next step when the removal made room for a refused run, and the evidence that stayed because another window may still use it. */
    moved: (
      usage: { count: number; limit?: number },
      refusedRunCanStart: boolean,
      isEvidenceLeftInPlace = false,
    ): string =>
      `Saved study moved to the ${trashName}.${libraryRoomSentence(usage)}${refusedRunCanStart ? ' Ask your editor agent to start the run again.' : ''}${
        isEvidenceLeftInPlace
          ? " The run's raw evidence was left in place because its Codebook window may still be open."
          : ''
      }`,
    /** The title of the dialog after a removal was refused only because recordings of the study have writers this computer cannot confirm ({@link UnconfirmedWriter}): on another computer, or an editor window of this computer it cannot tell from another process ({@link unconfirmedWriterTitleOf}). The learner decides, and Cancel keeps everything as it is. */
    unconfirmedWriterTitle: (writers: NamedUnconfirmedWriters): string =>
      unconfirmedWriterTitleOf(writers, trashName),
    unconfirmedWriterButton: `Move to ${trashName} Anyway`,
    /** The dialog's detail: the host each such recording names and when it started ({@link unconfirmedWriterSentences}, the sentences of the removal's cause), and what each answer does ({@link unconfirmedWriterWarning}). */
    unconfirmedWriterDetail: (writers: NamedUnconfirmedWriters): string =>
      `${unconfirmedWriterSentences(writers)} ${unconfirmedWriterWarning(writers)}`,
    nothingMoved: (cause: string): string =>
      `The saved study could not be moved to the ${trashName}. Nothing was deleted. ${cause}`,
    partlyMoved: (cause: string): string =>
      `The saved study was only partly moved to the ${trashName}; delete it again to finish. ${cause}`,
    /** The line after a removal that stopped at a path it could not look at once the Trash had rejected it: whether that path moved is unknown, so neither "nothing was deleted" nor "partly moved" is claimed. */
    moveUnknown: (cause: string): string =>
      `Codebook could not tell whether the saved study was moved to the ${trashName}; delete it again to finish. ${cause}`,
    /** What "Remove by hand" shows, in a window without a Trash, when the study's files could not be listed: what failed, the next step, and the cause as the system gave it. */
    filesNotListed: (cause: string): string =>
      `Codebook could not list this study's files. Press Retry storage / refresh to try again. ${cause}`,
    /** The storage line after a removal that moved everything and could not release the storage lock; the study is gone, later writes may be refused until the lock is resolved. */
    lockNotReleased: (cause: string): string =>
      `Learning storage lock could not be released after the removal: ${cause}`,
  }
}

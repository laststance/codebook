import { systemTrashName, type SystemTrashName } from './systemTrashName'

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
 * Words every learner-facing text of a saved study's removal with the host's word for the system Trash, so the dialog, the status line and the failures agree; called by {@link StudyWorkspace} when it confirms a removal and reports its outcome.
 * @param trashName - The host's word for the system Trash.
 * @returns The dialog's title, button and detail, the in-progress line, the dialog of a recording that may still run on another computer, builders for the three outcomes, the answer to a request for a study's files that could not be listed, and the storage line for a lock that could not be released.
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
    /** The dialog after a removal was refused only because a recording of the study names another host whose run may still write it: the learner decides, and Cancel keeps everything as it is. */
    recordedOnAnotherHostTitle: `This study's recording may still be running on another computer. Move the study to the ${trashName} anyway?`,
    recordedOnAnotherHostButton: 'Remove Anyway',
    /** The dialog's detail: the host the recording names, when it started, and what each answer does. */
    recordedOnAnotherHostDetail: (host: string, startedAt: string): string =>
      `Its recording was started on ${host} at ${startedAt}, and Codebook cannot tell from this computer whether that run still records. If it still runs there, it loses its recording. If ${host} is this computer under an earlier name, or that editor has closed, nothing is lost. Cancel keeps the study and its recording as they are.`,
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

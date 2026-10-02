import { systemTrashName, type SystemTrashName } from './systemTrashName'

/**
 * Words every learner-facing text of a saved study's removal with the host's word for the system Trash, so the dialog, the status line and the failures agree; called by {@link StudyWorkspace} when it confirms a removal and reports its outcome.
 * @param trashName - The host's word for the system Trash.
 * @returns The dialog's title, button and detail, the in-progress line, builders for the three outcomes, and the storage line for a lock that could not be released.
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
      `Saved study moved to the ${trashName}.${
        usage.limit === undefined
          ? ''
          : ` The library now holds ${usage.count} of ${usage.limit} saved studies.`
      }${refusedRunCanStart ? ' Ask your editor agent to start the run again.' : ''}${
        isEvidenceLeftInPlace
          ? " The run's raw evidence was left in place because its Codebook window may still be open."
          : ''
      }`,
    nothingMoved: (cause: string): string =>
      `The saved study could not be moved to the ${trashName}. Nothing was deleted. ${cause}`,
    partlyMoved: (cause: string): string =>
      `The saved study was only partly moved to the ${trashName}; delete it again to finish. ${cause}`,
    /** The storage line after a removal that moved everything and could not release the storage lock; the study is gone, later writes may be refused until the lock is resolved. */
    lockNotReleased: (cause: string): string =>
      `Learning storage lock could not be released after the removal: ${cause}`,
  }
}

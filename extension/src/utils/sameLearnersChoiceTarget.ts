import type { Tab, TextDocument } from 'vscode'

/** What the learner picked while the captured source's return hands the keyboard over: a text file (shown again by its document) or a tab that is no text file (found again by its group and label). */
export type LearnersChoice = {
  /** The view column of the group the choice stands in. */
  column: number
  /** The picked text file; absent for a tab that is no text file. */
  document?: TextDocument
  /** The picked tab that is no text file. */
  tab?: Tab
}

/**
 * Tells whether two picks name the same target, so {@link StudyWorkspace}'s watch can leave out the activation its own corrective re-show of a pick causes while a newer, different pick is still recorded.
 * A file open in two groups is two targets: the re-show of the pick in one group is not the learner's pick of the same file in the other, which must stay recorded.
 * @param left - One pick.
 * @param right - The other pick.
 * @returns `true` for the same document in the same column, or for two non-text tabs with the same label in the same column; `false` otherwise.
 * @example
 * sameLearnersChoiceTarget({ column: 4, document: dataTs }, { column: 4, document: dataTs }) // => true
 * sameLearnersChoiceTarget({ column: 4, document: dataTs }, { column: 5, document: dataTs }) // => false
 * sameLearnersChoiceTarget({ column: 4, document: dataTs }, { column: 4, document: searchTsx }) // => false
 */
export function sameLearnersChoiceTarget(
  left: LearnersChoice,
  right: LearnersChoice,
): boolean {
  if (left.document && right.document)
    return (
      left.column === right.column &&
      left.document.uri.toString() === right.document.uri.toString()
    )
  return (
    !left.document &&
    !right.document &&
    left.column === right.column &&
    left.tab?.label === right.tab?.label
  )
}

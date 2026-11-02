import type { Tab } from 'vscode'

import { TAB_INPUT_IDENTITY_FIELDS } from '../constants'

/**
 * Tells whether two tabs name the same editor, so {@link StudyWorkspace}'s return of a learner's pick of a tab that is no text file does not take another tab of the same label for it; called by {@link sameLearnersChoiceTarget} for two picks and by {@link StudyWorkspace.reactivateNonTextTab} to find the picked tab in its group again.
 * The same tab object is the same editor. The editors give a group's tabs new objects with every change, so another object is the same editor when its kind of input, its label and the members of its input that name a resource or a view ({@link TAB_INPUT_IDENTITY_FIELDS}) are equal: two diffs of `index.ts` from different folders, or two custom editors of `diagram.png`, are two editors although label and kind agree. A tab without input (Cursor's chat) has the kind and label only.
 * @param left - One tab.
 * @param right - The other tab.
 * @returns `true` for one tab object, or for two tabs of one kind of input with the same label and the same resource and view members; `false` otherwise, and when either tab is missing.
 * @example
 * sameTabTarget(diffOfAppIndex, diffOfAppIndex) // => true
 * sameTabTarget(diffOfAppIndex, newObjectOfTheSameDiff) // => true
 * sameTabTarget(diffOfAppIndex, diffOfLibIndex) // => false for "index.ts (Working Tree)" in two folders
 */
export function sameTabTarget(
  left: Tab | undefined,
  right: Tab | undefined,
): boolean {
  if (!left || !right) return false
  if (left === right) return true
  if (left.label !== right.label) return false
  const leftInput = inputObject(left),
    rightInput = inputObject(right)
  if (leftInput?.constructor !== rightInput?.constructor) return false
  // A member an input lacks reads as absent on both sides; a present one is compared by its text (a resource's text is its whole address).
  return TAB_INPUT_IDENTITY_FIELDS.every(
    (field) => memberText(leftInput, field) === memberText(rightInput, field),
  )
}

/** Reads a tab's input as an object; a tab the editor gives no input (Cursor's chat) has none. */
function inputObject(tab: Tab): object | undefined {
  return typeof tab.input === 'object' && tab.input !== null
    ? tab.input
    : undefined
}

/** Reads one member of an input as text, `undefined` when the input lacks it. */
function memberText(
  input: object | undefined,
  field: string,
): string | undefined {
  const value: unknown = input ? Reflect.get(input, field) : undefined
  return value === undefined ? undefined : String(value)
}

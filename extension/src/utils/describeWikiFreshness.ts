/**
 * Words how a Wiki stands against its source: the one label the served Wiki page shows above its outline and the editor's LLM Wiki view shows beside its Wiki row.
 *
 * Why: the page and the view must say the same thing about the same check, so the sentence is written once. The function is embedded into the served page script with `toString()` (through `WikiUpdatePageSettings.describeFreshness`, like `describeWikiUpdate`), so it must stay free of imports and outer variables.
 * Trigger: the page calls it with each `api/freshness` answer; the view calls it with each freshness check it reads.
 *
 * @param status - The answered freshness status (`current`, `changed`, `unknown`), or `undefined` when nothing answered.
 * @param reason - Why a check could not decide; empty when the answer gave none.
 * @param isAdditionUnchecked - Whether the project has no Git repository, so added files were not looked for.
 * @param reasonLimitChars - How many characters of a reason the label shows before it is cut at the last space.
 * @returns
 * - `changed`: "Source changed · Update available"
 * - `current`: "Wiki source current", with the note on unchecked additions where they were not looked for
 * - Any other status: "Wiki freshness unknown", followed by the reason when there is one, shortened to the limit
 *
 * @example
 * ```ts
 * describeWikiFreshness('current', '', false, 160) // => 'Wiki source current'
 * describeWikiFreshness('unknown', 'The manifest is unreadable.', false, 160) // => 'Wiki freshness unknown: The manifest is unreadable.'
 * ```
 */
export function describeWikiFreshness(
  status: string | undefined,
  reason: string,
  isAdditionUnchecked: boolean,
  reasonLimitChars: number,
): string {
  if (status === 'changed') return 'Source changed · Update available'
  if (status === 'current')
    return isAdditionUnchecked
      ? 'Wiki source current (no Git revision recorded, so added files are not checked)'
      : 'Wiki source current'
  if (!reason) return 'Wiki freshness unknown'
  // The label sits above the outline in a narrow rail: a long reason is cut at the last space before the limit and stays whole in the tooltip.
  const lastSpace = reason.lastIndexOf(' ', reasonLimitChars)
  const shownReason =
    reason.length > reasonLimitChars
      ? reason
          .slice(0, lastSpace > 0 ? lastSpace : reasonLimitChars)
          .trimEnd() + '…'
      : reason
  return 'Wiki freshness unknown: ' + shownReason
}

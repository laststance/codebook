/**
 * Drops the empty groups at the end of a list of groups' tabs: an editor that removes emptied groups takes those away with the panes, and the layout of before makes them again; the first step of {@link emptyGroupsGoneSince}.
 * @param groups - The tabs of each group, in the layout's order.
 * @returns The list up to its last group that has a tab.
 * @example withoutTrailingEmpty([['a.ts'], [], ['b.ts'], []]) // => [['a.ts'], [], ['b.ts']]
 */
function withoutTrailingEmpty(groups: readonly string[][]): string[][] {
  let end = groups.length
  while (end > 0 && groups[end - 1]!.length === 0) end--
  return groups.slice(0, end)
}

/**
 * Says whether a group still is the learner's group of before, by its tabs; the step of {@link emptyGroupsGoneSince} for one pair of groups.
 * @param before - The learner's tabs the group held before the Open.
 * @param now - The learner's tabs it holds now.
 * @returns `true` when every tab of before is still there, and when the group was empty before and is empty now; `false` when a tab of before is gone, and for a group that was empty and has tabs now.
 * @example holdsTabsOfBefore(['a.ts'], ['a.ts', 'b.ts']) // => true
 */
function holdsTabsOfBefore(before: string[], now: string[]): boolean {
  return before.length === 0
    ? now.length === 0
    : before.every((key) => now.includes(key))
}

/**
 * Says whether the main editor's groups are still the learner's groups a layout was noted for, and which empty groups of then the editor removed in front of groups that stay; {@link StudyWorkspace} asks it at Close before it gives the learner's layout of before the Open back.
 * "The same groups" is tested by number and by tabs, as the editor gives a group no name that lasts: there are no more groups than before, and each group of before either holds every tab it held (a group may have gained tabs, as when the debugger opened a file in it; a group that was empty is empty still) or was empty and is gone. An empty group the editor removed at the end is no gap: the layout of before makes it again behind the others. One the editor removed in front of a group that stays (an earlier window's leftover Application group the pane's move emptied, row 639) can be made again only behind them, so its index is returned for the layout to leave it out.
 * @param before - The learner's tabs of each group as noted, in the layout's order.
 * @param now - The learner's tabs of each group of the main editor now, in the layout's order.
 * @returns
 * - The indexes, in `before`, of the empty groups that are gone in front of groups that stay; empty when every group of before stands.
 * - `undefined` when a group was opened, a group with tabs was closed or moved, or a tab of before is gone from its group.
 * @example
 * emptyGroupsGoneSince([[], ['a.ts'], ['b.ts']], [['a.ts'], ['b.ts']]) // => [0]
 * emptyGroupsGoneSince([['a.ts'], []], [['a.ts']]) // => []
 * emptyGroupsGoneSince([['a.ts'], ['b.ts']], [['b.ts'], ['a.ts']]) // => undefined
 */
export function emptyGroupsGoneSince(
  before: readonly string[][],
  now: readonly string[][],
): number[] | undefined {
  if (now.length > before.length) return undefined
  const keptBefore = withoutTrailingEmpty(before),
    keptNow = withoutTrailingEmpty(now)
  const gone: number[] = []
  let current = 0
  for (const [index, keys] of keptBefore.entries()) {
    const group = keptNow[current]
    // A group that still holds its tabs is matched; an empty one that is not there any more is gone; anything else is another arrangement.
    if (group !== undefined && holdsTabsOfBefore(keys, group)) current++
    else if (keys.length === 0) gone.push(index)
    else return undefined
  }
  return current === keptNow.length ? gone : undefined
}

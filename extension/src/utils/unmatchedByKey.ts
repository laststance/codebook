/**
 * Lists the items of one list that have no counterpart of the same key in another list, where each counterpart answers for one item only; {@link StudyWorkspace.closeLeftoverTabs} asks it which leftover tabs closed and which stayed, because Cursor builds every tab object anew when a group is removed or a tab closes, so a tab is known across that by a key and not by its object (Cycle 0046 OCR1-1).
 * Two items of the same key (two dead panes of one kind) are counted: one counterpart of that key leaves one of them unmatched.
 * @param items - The items to look for, in their order.
 * @param counterparts - The items to find them among.
 * @param keyOf - Names an item by a key that outlives its object.
 * @returns The items, in their order, for which no counterpart of the same key was left.
 * @example
 * unmatchedByKey(['a', 'b', 'b'], ['b'], (item) => item) // => ['a', 'b']: one 'b' found its counterpart
 */
export function unmatchedByKey<Item>(
  items: readonly Item[],
  counterparts: readonly Item[],
  keyOf: (item: Item) => string,
): Item[] {
  const left = new Map<string, number>()
  for (const counterpart of counterparts) {
    const key = keyOf(counterpart)
    left.set(key, (left.get(key) ?? 0) + 1)
  }
  return items.filter((item) => {
    const key = keyOf(item),
      count = left.get(key) ?? 0
    // A counterpart answers for one item only; the items after it of the same key stay unmatched.
    if (!count) return true
    left.set(key, count - 1)
    return false
  })
}

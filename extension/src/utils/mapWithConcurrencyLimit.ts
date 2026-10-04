/**
 * Maps a list with at most `limit` calls in flight and returns the results in the list's order.
 *
 * Why: hashing every indexed source of a Wiki one after another takes twice as long as needed, and starting all at once opens hundreds of files; a bounded number keeps both in check.
 * Trigger: {@link inspectDeepWikiFreshness} checks its indexed sources through it.
 *
 * @param items - What to map.
 * @param limit - The most calls of `map` that run at the same time; at least 1.
 * @param map - The work for one item; a rejection rejects the whole call.
 * @returns One result per item, at the item's own position, whatever order the calls finished in.
 *
 * @example
 * ```ts
 * await mapWithConcurrencyLimit(['a.ts', 'b.ts', 'c.ts'], 2, hashFileSha256) // => [hashOfA, hashOfB, hashOfC]
 * ```
 */
export async function mapWithConcurrencyLimit<Item, Result>(
  items: readonly Item[],
  limit: number,
  map: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(items.length)
  let nextIndex = 0
  /** Takes the next unclaimed item until none is left. */
  const work = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await map(items[index]!)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, work),
  )
  return results
}

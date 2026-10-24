/**
 * Drops the entries of a record of tabs that the editor closed, so a later close by address never picks a tab opened afterwards at the same address; read by the reader's tab-close listener for each record it keeps (the retired browser replay's captured-source tabs, the slot tabs waiting for the hidden editor area).
 * A closed tab that is an entry's own object ends that entry. A closed tab object the editor rebuilt (Cursor) is in no entry: it ends the entry its address stands for, unless another live tab still shows that address (F494).
 * @param record - The record: each tab object with the address it had.
 * @param closed - The tabs the editor reports closed.
 * @param live - Every tab object the editor shows now.
 * @param addressOf - The address of a tab, `undefined` for a tab without one.
 * @returns The record without the closed tabs' entries; the same record object when nothing changed.
 * @example pruneClosedTabRecord(new Map([[tab, 'file:///a']]), [tab], new Set(), addressOf) // => Map(0) {}
 */
export function pruneClosedTabRecord<Tab>(
  record: ReadonlyMap<Tab, string>,
  closed: readonly Tab[],
  live: ReadonlySet<Tab>,
  addressOf: (tab: Tab) => string | undefined,
): ReadonlyMap<Tab, string> {
  const liveAddresses = new Set([...live].map(addressOf))
  const kept = new Map(record)
  for (const tab of closed) {
    if (kept.delete(tab)) continue
    const address = addressOf(tab)
    // A tab still shown at that address keeps the entry: only its last tab's close ends it.
    if (address === undefined || liveAddresses.has(address)) continue
    const stale = [...kept].find(
      ([entry, entryAddress]) => entryAddress === address && !live.has(entry),
    )
    if (stale) kept.delete(stale[0])
  }
  return kept.size === record.size ? record : kept
}

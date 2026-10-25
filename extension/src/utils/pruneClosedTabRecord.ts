/**
 * Drops the entries of a record of tabs that the editor closed, so a later close by address never picks a tab opened afterwards at the same address; read by the reader's tab-close listener for each record it keeps (the retired browser replay's captured-source tabs, the slot tabs waiting for the hidden editor area).
 * A closed tab that is an entry's own object ends that entry. A closed tab whose address no live tab shows also ends every entry of that address whose object the editor no longer shows: a tab object the editor rebuilt (Cursor) is in no entry, so its address stands for it (F494). A live tab at that address keeps those entries.
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
    kept.delete(tab)
    const address = addressOf(tab)
    // A tab still shown at that address keeps its entries: only the last tab's close ends them.
    if (address === undefined || liveAddresses.has(address)) continue
    // Every entry of that address whose object the editor no longer shows ends with it (Cursor may have rebuilt the object more than once).
    for (const [entry, entryAddress] of [...kept])
      if (entryAddress === address && !live.has(entry)) kept.delete(entry)
  }
  return kept.size === record.size ? record : kept
}

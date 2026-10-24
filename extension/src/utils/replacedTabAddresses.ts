/**
 * Names the addresses whose recorded tab objects the editor no longer shows: a tab object the editor rebuilt (Cursor) is in no entry of the record, so its address stands for it when the record's tabs are closed; read by the reader before it closes the retired browser replay's captured-source tabs and the slot tabs that waited for the hidden editor area.
 * @param record - The record: each tab object with the address it had.
 * @param live - Every tab object the editor shows now.
 * @returns The addresses of the entries whose tab object is not live.
 * @example replacedTabAddresses(new Map([[oldTab, 'file:///a']]), new Set([newTab])) // => Set { 'file:///a' }
 */
export function replacedTabAddresses<Tab>(
  record: ReadonlyMap<Tab, string>,
  live: ReadonlySet<Tab>,
): ReadonlySet<string> {
  return new Set(
    [...record].filter(([tab]) => !live.has(tab)).map(([, address]) => address),
  )
}

import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { DROPPING_NAME_SUFFIX } from './readReceiptState'

/**
 * Says whether a name holds a regular file, without following a link; called by {@link hasDevinEntryReceipt} for the record's name and its dropping name.
 * @param path - The name to look at.
 * @returns `true` for a regular file; `false` for a missing path, a link or any path that cannot be inspected.
 * @example
 * await isRegularFile('/storage/devin-mcp/receipt.json') // => true while the record stands there
 */
function isRegularFile(path: string): Promise<boolean> {
  return lstat(path).then(
    (entry) => entry.isFile(),
    () => false,
  )
}

/**
 * Says whether Codebook's record of its Devin Desktop MCP entry is left, so the activation refresh can tell a removed setup before it resolves Node or reads Devin's config; called by the activation refresh and by {@link hasDevinSetupReceipts}.
 * The record is `devin-mcp/receipt.json` of the global storage, the file the entry write keeps, or, while that name is empty, its dropping name (`receipt.json.codebook-dropping`), where a rewrite or delete holds it for a moment and a run that stopped inside one leaves it: the locked run that the activation refresh then starts puts it back before it reads it, or names what stands there. When both names look empty, a rewrite may have published its record at the receipt's name between the two looks, so that name is looked at once more and decides, the rule the receipt's reader (`readReceiptOrDropped`) and the publish record's verdict (`unverifiedVerdictOf`) follow; a record is missed only when it moves between its two names before each of these looks, that is, a rewrite ends after the first look and the next rewrite or delete of that record begins before the last.
 * @param storageRoot - Codebook's global storage folder.
 * @returns `true` for a regular file at either name, or at the receipt's name on the one more look after both looked empty; `false` when no look found one (a missing path, a link or a path that cannot be inspected).
 * @example
 * await hasDevinEntryReceipt('/storage') // => false after the setup was removed
 * await hasDevinEntryReceipt('/storage') // => true after a run stopped while it moved receipt.json to receipt.json.codebook-dropping
 */
export async function hasDevinEntryReceipt(
  storageRoot: string,
): Promise<boolean> {
  const receiptPath = join(storageRoot, 'devin-mcp', 'receipt.json')
  // The record at its name, or at the dropping name a rewrite or delete holds it at.
  if (await isRegularFile(receiptPath)) return true
  if (await isRegularFile(`${receiptPath}${DROPPING_NAME_SUFFIX}`)) return true
  // Both names looked empty: a rewrite may have published its record at the receipt's name between the two looks, so that name is looked at once more and decides.
  return isRegularFile(receiptPath)
}

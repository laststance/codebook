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
 * The record is `devin-mcp/receipt.json` of the global storage, the file the entry write keeps, or, while that name is empty, its dropping name (`receipt.json.codebook-dropping`), where a rewrite or delete holds it for a moment and a run that stopped inside one leaves it: the locked run that the activation refresh then starts puts it back before it reads it, or names what stands there.
 * @param storageRoot - Codebook's global storage folder.
 * @returns `true` for a regular file at either name; `false` when neither holds one (a missing path, a link or a path that cannot be inspected).
 * @example
 * await hasDevinEntryReceipt('/storage') // => false after the setup was removed
 * await hasDevinEntryReceipt('/storage') // => true after a run stopped while it moved receipt.json to receipt.json.codebook-dropping
 */
export async function hasDevinEntryReceipt(
  storageRoot: string,
): Promise<boolean> {
  const receiptPath = join(storageRoot, 'devin-mcp', 'receipt.json')
  // The record at its name, or at the dropping name a rewrite or delete holds it at.
  return (
    (await isRegularFile(receiptPath)) ||
    isRegularFile(`${receiptPath}${DROPPING_NAME_SUFFIX}`)
  )
}

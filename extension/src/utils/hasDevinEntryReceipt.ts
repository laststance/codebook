import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Says whether Codebook's record of its Devin Desktop MCP entry is left, so the activation refresh can tell a removed setup before it resolves Node or reads Devin's config.
 * The record is `devin-mcp/receipt.json` of the global storage, the file the entry write keeps.
 * @param storageRoot - Codebook's global storage folder.
 * @returns `true` for a regular file; `false` for a missing path, a link or any path that cannot be inspected.
 * @example
 * await hasDevinEntryReceipt('/storage') // => false after the setup was removed
 */
export async function hasDevinEntryReceipt(
  storageRoot: string,
): Promise<boolean> {
  return lstat(join(storageRoot, 'devin-mcp', 'receipt.json')).then(
    (entry) => entry.isFile(),
    () => false,
  )
}

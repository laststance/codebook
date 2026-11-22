import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { hasDevinEntryReceipt } from './hasDevinEntryReceipt'

/**
 * Says whether Codebook's records of both its Devin Desktop skill and its MCP entry are left, so a connection descriptor is marked for the Devin bridge only while the setup stands; called when a window writes or marks its descriptor.
 * The skill's record is `devin-skill/receipt.json` of the global storage, the entry's is `devin-mcp/receipt.json` ({@link hasDevinEntryReceipt}).
 * @param storageRoot - Codebook's global storage folder.
 * @returns `true` when both are regular files; `false` when either is missing, a link or cannot be inspected.
 * @example
 * await hasDevinSetupReceipts('/storage') // => false once another window removed the setup
 */
export async function hasDevinSetupReceipts(
  storageRoot: string,
): Promise<boolean> {
  const hasSkillReceipt = await lstat(
    join(storageRoot, 'devin-skill', 'receipt.json'),
  ).then(
    (entry) => entry.isFile(),
    () => false,
  )
  return hasSkillReceipt && (await hasDevinEntryReceipt(storageRoot))
}

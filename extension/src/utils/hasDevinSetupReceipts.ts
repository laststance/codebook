import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { hasDevinEntryReceipt } from './hasDevinEntryReceipt'

/**
 * Says whether the Devin skill's record is a regular file that parses and says `installed: true`; a removal of the skill leaves its record with `installed: false`. Called by {@link hasDevinSetupReceipts}.
 * @param receiptPath - The skill's `devin-skill/receipt.json`.
 * @returns `true` for an installed record; `false` for a missing, linked, unreadable, unparsable or uninstalled one.
 * @example
 * await hasInstalledSkillReceipt('/storage/devin-skill/receipt.json') // => false after the skill was removed
 */
async function hasInstalledSkillReceipt(receiptPath: string): Promise<boolean> {
  try {
    // A link or a folder is no record Codebook wrote.
    if (!(await lstat(receiptPath)).isFile()) return false
    const record: unknown = JSON.parse(await readFile(receiptPath, 'utf8'))
    return (
      typeof record === 'object' &&
      record !== null &&
      'installed' in record &&
      record.installed === true
    )
  } catch {
    return false
  }
}

/**
 * Says whether Codebook's records of both its Devin Desktop skill and its MCP entry are left, so a connection descriptor is marked for the Devin bridge only while the setup stands; called when a window writes or marks its descriptor, and by the activation reconnect right before it starts the server.
 * The skill's record is `devin-skill/receipt.json` of the global storage and counts only while it says `installed: true`, the entry's is `devin-mcp/receipt.json` ({@link hasDevinEntryReceipt}).
 * @param storageRoot - Codebook's global storage folder.
 * @returns `true` when both records stand; `false` when either is missing, a link, unparsable, uninstalled or cannot be inspected.
 * @example
 * await hasDevinSetupReceipts('/storage') // => false once another window removed the setup
 */
export async function hasDevinSetupReceipts(
  storageRoot: string,
): Promise<boolean> {
  return (
    (await hasInstalledSkillReceipt(
      join(storageRoot, 'devin-skill', 'receipt.json'),
    )) && (await hasDevinEntryReceipt(storageRoot))
  )
}

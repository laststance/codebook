import { join } from 'node:path'

import { readReceiptState } from './readReceiptState'

/**
 * Reads the installation id the window's descriptor mark would carry, but only while both receipts stand under the Devin bridge's own rules (each installed and private; the MCP one with its installation id), so a window is never marked for a setup the bridge would refuse; called by the extension's mark decision on every descriptor write and sync.
 * A receipt that was observed removed, unreadable by its mode or without an id counts as not standing; a receipt whose read could not look at all (descriptor exhaustion, `EIO`) is neither: it answers `null`, so a transient failure is never taken for a removal and the caller can ask again or keep the mark it had.
 * @param storageRoot - Codebook's global storage folder.
 * @returns The MCP receipt's installation id; `undefined` when a receipt was observed not standing or the id is missing; `null` when no answer could be had and nothing is known.
 * @example
 * await readStandingDevinInstallationId('/storage') // => 'f3b1c0de-…', or undefined once the skill receipt became readable by others
 */
export async function readStandingDevinInstallationId(
  storageRoot: string,
): Promise<string | undefined | null> {
  const [skill, entry] = await Promise.all([
    readReceiptState(join(storageRoot, 'devin-skill', 'receipt.json')),
    readReceiptState(join(storageRoot, 'devin-mcp', 'receipt.json')),
  ])
  // An observed removal is certain whatever the other read did.
  if (skill.state === 'removed' || entry.state === 'removed') return undefined
  // No observed removal, but a read that could not look: nothing is known.
  if (skill.state === 'no-answer' || entry.state === 'no-answer') return null
  const installationId = entry.receipt.installationId
  return typeof installationId === 'string' ? installationId : undefined
}

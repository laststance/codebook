import { join } from 'node:path'

import { readReceiptState } from './readReceiptState'

/**
 * Reads the installation id the window's descriptor mark would carry, but only while both receipts stand under the Devin bridge's own rules (each installed and private; the MCP one with its installation id), so a window is never marked for a setup the bridge would refuse; called by the extension's mark decision on every descriptor write and sync.
 * A receipt whose read failed to look counts as not standing: nothing is marked on a guess.
 * @param storageRoot - Codebook's global storage folder.
 * @returns The MCP receipt's installation id; `undefined` when either receipt does not stand or the id is missing.
 * @example
 * await readStandingDevinInstallationId('/storage') // => 'f3b1c0de-…', or undefined once the skill receipt became readable by others
 */
export async function readStandingDevinInstallationId(
  storageRoot: string,
): Promise<string | undefined> {
  const [skill, entry] = await Promise.all([
    readReceiptState(join(storageRoot, 'devin-skill', 'receipt.json')),
    readReceiptState(join(storageRoot, 'devin-mcp', 'receipt.json')),
  ])
  if (skill.state !== 'installed' || entry.state !== 'installed')
    return undefined
  const installationId = entry.receipt.installationId
  return typeof installationId === 'string' ? installationId : undefined
}

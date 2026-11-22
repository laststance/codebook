import { join } from 'node:path'

import { readInstalledReceipt } from './readInstalledReceipt'

/**
 * Reads the installation id of the Devin MCP receipt, so a window can write it into its descriptor mark; called by the extension when it marks a descriptor.
 * @param storageRoot - Codebook's global storage folder.
 * @returns The `installationId` of an installed receipt; `undefined` when the receipt is missing, uninstalled, unreadable or of an older build that has no id yet.
 * @example
 * await readDevinInstallationId('/storage') // => 'f3b1c0de-…'
 */
export async function readDevinInstallationId(
  storageRoot: string,
): Promise<string | undefined> {
  const receipt = await readInstalledReceipt(
    join(storageRoot, 'devin-mcp', 'receipt.json'),
  )
  const installationId = receipt?.installationId
  return typeof installationId === 'string' ? installationId : undefined
}

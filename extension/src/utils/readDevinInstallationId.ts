import { join } from 'node:path'

import { readReceiptState, type ReceiptState } from './readReceiptState'
import { defaultPathReadGate, type PathReadGate } from './shareReceiptRead'

/** What one read of the MCP receipt's installation id found: the id (`undefined` when none stands) and the receipt's own classified state, so a refusal can tell a verified permission problem from a read that only failed to look. */
export interface DevinInstallationRead {
  installationId: string | undefined
  state: ReceiptState
}

/**
 * Reads the installation id of the Devin MCP receipt, so a window can write it into its descriptor mark; called by the extension when a setup marks a descriptor.
 * The read goes through the read gate under the same key as {@link readStandingDevinInstallationId}'s MCP receipt read, so a read of that receipt in flight is never started twice, and this call gets a read that began after it.
 * @param storageRoot - Codebook's global storage folder.
 * @param reads - The read gate; {@link defaultPathReadGate} when left out.
 * @returns The `installationId` of an installed receipt, or `undefined` when the receipt is missing, uninstalled, unreadable or of an older build that has no id yet; always with the receipt's {@link ReceiptState} of that same read.
 * @example
 * await readDevinInstallationId('/storage') // => { installationId: 'f3b1c0de-…', state: { state: 'installed', … } }
 */
export async function readDevinInstallationId(
  storageRoot: string,
  reads: PathReadGate = defaultPathReadGate,
): Promise<DevinInstallationRead> {
  const receiptPath = join(storageRoot, 'devin-mcp', 'receipt.json')
  const state = await reads.read(`receipt:${receiptPath}`, () =>
    readReceiptState(receiptPath),
  )
  const installationId =
    state.state === 'installed' ? state.receipt.installationId : undefined
  return {
    installationId:
      typeof installationId === 'string' ? installationId : undefined,
    state,
  }
}

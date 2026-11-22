import { readReceiptState } from './readReceiptState'

/**
 * Reads one of the Devin setup's receipts with the bounded read and returns it only while it says `installed: true`; called by {@link readDevinInstallationId}.
 * Callers that must tell a removed receipt from a failed read use {@link readReceiptState}.
 * @param receiptPath - A `receipt.json` of the global storage (`devin-skill` or `devin-mcp`).
 * @returns The receipt's fields; `undefined` for a missing, linked, piped, oversized, non-private, unparsable or uninstalled receipt, and for a read that failed.
 * @example
 * await readInstalledReceipt('/storage/devin-mcp/receipt.json') // => { installed: true, installationId: '…', … }
 */
export async function readInstalledReceipt(
  receiptPath: string,
): Promise<Record<string, unknown> | undefined> {
  const state = await readReceiptState(receiptPath)
  return state.state === 'installed' ? state.receipt : undefined
}

import { readDescriptorText } from './readDescriptorText'

/**
 * Reads one of the Devin setup's receipts with the bounded read and returns it only while it says `installed: true`; called by {@link readDevinInstallationId} and {@link hasDevinBridgeReceipts}.
 * @param receiptPath - A `receipt.json` of the global storage (`devin-skill` or `devin-mcp`).
 * @returns The receipt's fields; `undefined` for a missing, linked, piped, oversized, non-private, unparsable or uninstalled receipt.
 * @example
 * await readInstalledReceipt('/storage/devin-mcp/receipt.json') // => { installed: true, installationId: '…', … }
 */
export async function readInstalledReceipt(
  receiptPath: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const record: unknown = JSON.parse(await readDescriptorText(receiptPath))
    // Only an object that says `installed: true` counts; a removal leaves the skill's receipt with `installed: false`.
    if (
      typeof record === 'object' &&
      record !== null &&
      !Array.isArray(record) &&
      'installed' in record &&
      record.installed === true
    )
      return Object.fromEntries(Object.entries(record))
    return undefined
  } catch {
    return undefined
  }
}

import { dirname, join } from 'node:path'

import { readDescriptorText } from './readDescriptorText'
import { readDevinInstallationId } from './readDevinInstallationId'
import { readInstalledReceipt } from './readInstalledReceipt'

/**
 * Reads the installation id a descriptor's mark names.
 * @param descriptorPath - The window's connection descriptor.
 * @returns The `devinSetupInstallation` text; `undefined` for a descriptor without it or that cannot be read.
 * @example
 * await markedInstallationOf('/storage/agent/x.connection.json') // => 'f3b1c0de-…'
 */
async function markedInstallationOf(
  descriptorPath: string,
): Promise<string | undefined> {
  try {
    const raw: unknown = JSON.parse(await readDescriptorText(descriptorPath))
    const marked =
      typeof raw === 'object' && raw !== null && 'devinSetupInstallation' in raw
        ? raw.devinSetupInstallation
        : undefined
    return typeof marked === 'string' ? marked : undefined
  } catch {
    return undefined
  }
}

/**
 * Says whether the setup a descriptor was marked for still stands, as the Devin bridge's last check before it opens its MCP session; called by `connectOnce` of the Devin bridge.
 * The skill receipt must say `installed: true` (a removal takes the skill out first and may fail on the entry), and the MCP receipt must be installed with the installation id the descriptor names. Both are read with the bounded read ({@link readDescriptorText}) from the parent of the agent folder, the folder the descriptor stands in.
 * @param descriptorPath - The selected descriptor, in the agent folder.
 * @returns `true` when both receipts stand for the descriptor's installation; `false` for a descriptor with no installation mark, a missing, uninstalled or unreadable receipt, or another installation.
 * @example
 * await hasDevinBridgeReceipts('/storage/agent/x.connection.json') // => false after a removal
 */
export async function hasDevinBridgeReceipts(
  descriptorPath: string,
): Promise<boolean> {
  const storageRoot = dirname(dirname(descriptorPath))
  const [marked, current, skill] = await Promise.all([
    markedInstallationOf(descriptorPath),
    readDevinInstallationId(storageRoot),
    readInstalledReceipt(join(storageRoot, 'devin-skill', 'receipt.json')),
  ])
  return marked !== undefined && skill !== undefined && marked === current
}

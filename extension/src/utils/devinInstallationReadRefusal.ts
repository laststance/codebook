import { devinReceiptUnreadableSentence } from '../devinWindowSentences'

import { devinSetupRefusalSentence } from './devinSetupRefusalSentence'
import { readReceiptState } from './readReceiptState'

/**
 * Says why the installation id of Codebook's MCP receipt could not be read, so the mode-600 repair is offered only for a verified permission problem; called by the Devin setup when its read of the id answered nothing.
 * @param receiptPath - The `devin-mcp/receipt.json` in Codebook's global storage.
 * @returns The id sentence for a receipt that others can read, that this user may not read, or that holds no id (an older build); the changed-meanwhile or unreadable-records sentence for any other state.
 * @example
 * await devinInstallationReadRefusal('/storage/devin-mcp/receipt.json') // => 'Codebook could not read the installation id in /storage/devin-mcp/receipt.json, …'
 */
export async function devinInstallationReadRefusal(
  receiptPath: string,
): Promise<string> {
  const state = await readReceiptState(receiptPath)
  const isPermissionProblem =
    state.state === 'removed' &&
    (state.reason === 'not-private' || state.reason === 'permission')
  // An installed receipt without an id is an older build's: the id sentence names the file too.
  if (state.state === 'installed' || isPermissionProblem)
    return devinReceiptUnreadableSentence(receiptPath)
  return (
    devinSetupRefusalSentence(state) ??
    devinReceiptUnreadableSentence(receiptPath)
  )
}

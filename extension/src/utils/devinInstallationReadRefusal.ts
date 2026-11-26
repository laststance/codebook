import { devinReceiptUnreadableSentence } from '../devinWindowSentences'

import { devinSetupRefusalSentence } from './devinSetupRefusalSentence'
import type { ReceiptState } from './readReceiptState'

/**
 * Says why the installation id of Codebook's MCP receipt could not be read, from the state the first read classified, so the mode-600 repair is offered only for a verified permission problem of that read; called by the Devin setup when its read of the id answered nothing.
 * The receipt is not read again: a transient failure of the first read (no answer, for example `EMFILE`) must not turn into a mode instruction because a second read happened to succeed.
 * @param state - The receipt state of the first read ({@link readDevinInstallationId}).
 * @param receiptPath - The `devin-mcp/receipt.json` in Codebook's global storage.
 * @returns The id sentence for a receipt that others can read, that this user may not read, or that holds no id (an older build); the mode-600 sentence naming the publish record beside the receipt when that record's mode keeps the receipt from standing ({@link devinSetupRefusalSentence}); the could-not-read sentence for a read that gave no answer; the changed-meanwhile sentence for any other state.
 * @example
 * devinInstallationReadRefusal({ state: 'no-answer', receiptPath: '/storage/devin-mcp/receipt.json' }, '/storage/devin-mcp/receipt.json') // => 'Codebook could not read its setup records just now; run Codebook: Set Up AI Chat again.'
 */
export function devinInstallationReadRefusal(
  state: ReceiptState,
  receiptPath: string,
): string {
  // A mode problem of the publish record beside the receipt is none of the id: the record's own sentence names that record.
  const isPermissionProblem =
    state.state === 'removed' &&
    state.recordPath === undefined &&
    (state.reason === 'not-private' || state.reason === 'permission')
  // An installed receipt without an id is an older build's: the id sentence names the file too.
  if (state.state === 'installed' || isPermissionProblem)
    return devinReceiptUnreadableSentence(receiptPath)
  return (
    devinSetupRefusalSentence(state) ??
    devinReceiptUnreadableSentence(receiptPath)
  )
}

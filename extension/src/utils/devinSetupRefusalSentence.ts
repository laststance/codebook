import {
  DEVIN_SETUP_CHANGED_MEANWHILE_SENTENCE,
  DEVIN_SETUP_RECORDS_UNREADABLE_SENTENCE,
  devinReceiptPermissionSentence,
} from '../devinWindowSentences'

import type { DevinBridgeReceiptsAnswer } from './checkDevinBridgeReceipts'
import type { ReceiptState } from './readReceiptState'

/**
 * Words why a Devin Desktop setup cannot report success, from what its records say: a permission problem names its file with the mode-600 repair, a record removed meanwhile says the setup changed, and a read that failed to look offers no repair; called by the setup after the bridge's receipts check and after its installation-id read.
 * @param answer - The bridge's receipts answer, or the state of one receipt.
 * @returns The sentence for the learner; `undefined` when the answer is `stands` or an installed receipt (nothing to refuse).
 * @example
 * devinSetupRefusalSentence({ answer: 'no-answer' }) // => 'Codebook could not read its setup records just now; run Codebook: Set Up AI Chat again.'
 */
export function devinSetupRefusalSentence(
  answer: DevinBridgeReceiptsAnswer | ReceiptState,
): string | undefined {
  if ('answer' in answer) {
    if (answer.answer === 'stands') return undefined
    if (answer.answer === 'no-answer')
      return DEVIN_SETUP_RECORDS_UNREADABLE_SENTENCE
    if (answer.answer === 'replaced')
      return DEVIN_SETUP_CHANGED_MEANWHILE_SENTENCE
    return isPermissionReason(answer.reason)
      ? devinReceiptPermissionSentence(answer.path)
      : DEVIN_SETUP_CHANGED_MEANWHILE_SENTENCE
  }
  if (answer.state === 'installed') return undefined
  if (answer.state === 'no-answer')
    return DEVIN_SETUP_RECORDS_UNREADABLE_SENTENCE
  return isPermissionReason(answer.reason)
    ? devinReceiptPermissionSentence(answer.receiptPath)
    : DEVIN_SETUP_CHANGED_MEANWHILE_SENTENCE
}

/** Whether a removal reason is a verified permission problem: a receipt others can read, or one this user may not read. */
function isPermissionReason(reason: string): boolean {
  return reason === 'not-private' || reason === 'permission'
}

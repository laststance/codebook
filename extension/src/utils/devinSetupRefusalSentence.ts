import { basename } from 'node:path'

import {
  DEVIN_SETUP_CHANGED_MEANWHILE_SENTENCE,
  DEVIN_SETUP_DESCRIPTOR_REPLACED_SENTENCE,
  DEVIN_SETUP_RECORDS_UNREADABLE_SENTENCE,
  devinReceiptPermissionSentence,
} from '../devinWindowSentences'

import type { DevinBridgeReceiptsAnswer } from './checkDevinBridgeReceipts'
import type { ReceiptState } from './readReceiptState'

/**
 * Words why a Devin Desktop setup cannot report success, from what its records say: a permission problem of a receipt, or of the publish record beside the MCP receipt that keeps that receipt from standing, names its file with the mode-600 repair (a link or other non-regular file, or any reason seen on the descriptor, does not), a record removed meanwhile says the setup changed, a descriptor that names another server also asks to stop the agent server first, and a read that failed to look offers no repair; called by the setup after the bridge's receipts check and after its installation-id read.
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
      return DEVIN_SETUP_DESCRIPTOR_REPLACED_SENTENCE
    // A reason seen on the descriptor itself is no record's mode problem: the repair is for Codebook's setup records only.
    return isPermissionReason(answer.reason) && isSetupRecordPath(answer.path)
      ? devinReceiptPermissionSentence(answer.path)
      : DEVIN_SETUP_CHANGED_MEANWHILE_SENTENCE
  }
  if (answer.state === 'installed') return undefined
  if (answer.state === 'no-answer')
    return DEVIN_SETUP_RECORDS_UNREADABLE_SENTENCE
  return isPermissionReason(answer.reason)
    ? devinReceiptPermissionSentence(answer.recordPath ?? answer.receiptPath)
    : DEVIN_SETUP_CHANGED_MEANWHILE_SENTENCE
}

/** The names of Codebook's setup records a bridge answer can name: a receipt, and the MCP receipt's publish record at its name or its dropping name ({@link ReceiptState}'s `recordPath`). */
const SETUP_RECORD_NAMES: ReadonlySet<string> = new Set([
  'receipt.json',
  'pending.json',
  'pending.json.codebook-dropping',
])

/** Whether a path is one of the setup's records ({@link SETUP_RECORD_NAMES}), not the connection descriptor. @example isSetupRecordPath('/storage/devin-mcp/pending.json') // => true */
function isSetupRecordPath(path: string): boolean {
  return SETUP_RECORD_NAMES.has(basename(path))
}

/** Whether a removal reason is a verified permission problem: a receipt others can read, or one this user may not read. */
function isPermissionReason(reason: string): boolean {
  return reason === 'not-private' || reason === 'permission'
}

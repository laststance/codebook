import { lstat } from 'node:fs/promises'

import { DEVIN_SETUP_CHANGED_MEANWHILE_SENTENCE } from '../devinWindowSentences'

/**
 * Picks the sentence a failed Devin setup gives after its rollback ran: a mode-600 instruction names a receipt that the rollback may have deleted, and a learner cannot repair a file that is gone, so then only a setup retry is asked; called by the Devin setup's catch step once the rollback ended.
 * The setup's repair sentences name a receipt path only to ask for that repair, so a sentence that contains the path is the one to replace.
 * @param sentence - What the failed step said.
 * @param receiptPath - The `devin-mcp/receipt.json` a first setup's rollback removes with its entry.
 * @returns `sentence`, or the changed-meanwhile retry sentence when the sentence names `receiptPath` and the file no longer exists.
 * @example
 * await devinRefusalAfterRollback('Make /s/devin-mcp/receipt.json readable only by you (mode 600)', '/s/devin-mcp/receipt.json') // => 'The Devin Desktop setup changed while this setup ran; run Codebook: Set Up AI Chat again.' when the rollback deleted the file
 */
export async function devinRefusalAfterRollback(
  sentence: string,
  receiptPath: string,
): Promise<string> {
  if (!sentence.includes(receiptPath)) return sentence
  // Only an observed absence counts; any other answer leaves the file for the learner to repair.
  const isGone = await lstat(receiptPath).then(
    () => false,
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT',
  )
  return isGone ? DEVIN_SETUP_CHANGED_MEANWHILE_SENTENCE : sentence
}

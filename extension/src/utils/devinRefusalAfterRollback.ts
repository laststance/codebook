import { lstat } from 'node:fs/promises'

import { DEVIN_SETUP_FINAL_CHECK_MS } from '../constants'
import { DEVIN_SETUP_CHANGED_MEANWHILE_SENTENCE } from '../devinWindowSentences'

import { settledWithin } from './settledWithin'
import { defaultPathReadGate, type PathReadGate } from './shareReceiptRead'

/**
 * Picks the sentence a failed Devin setup gives after its rollback ran: a mode-600 instruction names a receipt that the rollback may have deleted, and a learner cannot repair a file that is gone, so then only a setup retry is asked; called by the Devin setup's catch step once the rollback ended.
 * The setup's repair sentences name a receipt path only to ask for that repair, so a sentence that contains the path is the one to replace.
 * @param sentence - What the failed step said.
 * The look at the file is bounded: a storage that stops answering must not hold the refusal, the setup lock and a removal queued behind it, so a look that has not answered keeps the original sentence.
 * @param receiptPath - The `devin-mcp/receipt.json` a first setup's rollback removes with its entry.
 * @param boundMs - How long the look at the file may take; {@link DEVIN_SETUP_FINAL_CHECK_MS} when left out.
 * @param look - Looks at the file's entry; the real `lstat` when left out (a test seam for a storage that never answers).
 * @param reads - The read gate the look goes through, so a look of a storage that never answers is started once however many setups fail meanwhile; {@link defaultPathReadGate} when left out (a test passes its own).
 * @returns `sentence`, or the changed-meanwhile retry sentence when the sentence names `receiptPath` and the file was observed missing within the bound.
 * @example
 * await devinRefusalAfterRollback('Make /s/devin-mcp/receipt.json readable only by you (mode 600)', '/s/devin-mcp/receipt.json') // => 'The Devin Desktop setup changed while this setup ran; run Codebook: Set Up AI Chat again.' when the rollback deleted the file
 */
export async function devinRefusalAfterRollback(
  sentence: string,
  receiptPath: string,
  boundMs: number = DEVIN_SETUP_FINAL_CHECK_MS,
  look: (path: string) => Promise<unknown> = lstat,
  reads: PathReadGate = defaultPathReadGate,
): Promise<string> {
  if (!sentence.includes(receiptPath)) return sentence
  // Only an observed absence counts; any other answer leaves the file for the learner to repair.
  let isGone = false
  // A look that has not answered within the bound leaves `isGone` false: the original sentence stands.
  await settledWithin(
    reads
      .read(`look:${receiptPath}`, () => look(receiptPath))
      .then(
        () => undefined,
        (error: unknown) => {
          isGone =
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT'
        },
      ),
    boundMs,
  )
  return isGone ? DEVIN_SETUP_CHANGED_MEANWHILE_SENTENCE : sentence
}

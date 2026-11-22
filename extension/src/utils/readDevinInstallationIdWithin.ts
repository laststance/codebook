import { join } from 'node:path'

import { DEVIN_SETUP_FINAL_CHECK_MS } from '../constants'

import type { DevinInstallationRead } from './readDevinInstallationId'
import { settledWithin } from './settledWithin'

/**
 * Reads the MCP receipt's installation id for a setup's mark within a bound, so a storage that stops answering cannot hold the setup lock before the commit; called by the Devin Desktop setup with its own imported reader.
 * A read that has not answered within the bound answers `no-answer`, so the setup's refusal asks for a retry and the setup takes back what it saved; the read keeps running.
 * @param read - Reads the installation id ({@link readDevinInstallationId}); a parameter so the caller's own import (a test's module stand-in included) does the read.
 * @param storageRoot - Codebook's global storage folder.
 * @param boundMs - How long the read may take; {@link DEVIN_SETUP_FINAL_CHECK_MS} when left out.
 * @returns
 * - The read's own {@link DevinInstallationRead} when it answered within the bound
 * - `{ installationId: undefined, state: { state: 'no-answer', receiptPath } }` for the MCP receipt's path otherwise
 * @throws The read's own rejection within the bound.
 * @example
 * await readDevinInstallationIdWithin(readDevinInstallationId, '/storage') // => { installationId: undefined, state: { state: 'no-answer', receiptPath: '/storage/devin-mcp/receipt.json' } } after 3 s of a stalled disk
 */
export async function readDevinInstallationIdWithin(
  read: (storageRoot: string) => Promise<DevinInstallationRead>,
  storageRoot: string,
  boundMs: number = DEVIN_SETUP_FINAL_CHECK_MS,
): Promise<DevinInstallationRead> {
  let installationRead: DevinInstallationRead | undefined
  await settledWithin(
    read(storageRoot).then((answer) => {
      installationRead = answer
    }),
    boundMs,
  )
  return (
    installationRead ?? {
      installationId: undefined,
      state: {
        state: 'no-answer',
        receiptPath: join(storageRoot, 'devin-mcp', 'receipt.json'),
      },
    }
  )
}

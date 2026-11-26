import { join } from 'node:path'

import { readReceiptState, type ReceiptState } from './readReceiptState'
import { defaultPathReadGate, type PathReadGate } from './shareReceiptRead'

/**
 * Resolves with `true` once a receipt read is observed `removed`, and never otherwise, so {@link readStandingDevinInstallationId} can answer on one observed removal without waiting for the other read.
 * @param read - One receipt read.
 * @returns A promise that settles only for a removal.
 * @example await whenRemoved(readReceiptState(path)) // => true for a removed receipt; pending for an installed one
 */
async function whenRemoved(read: Promise<ReceiptState>): Promise<true> {
  const receipt = await read
  // Anything but a removal never settles; the other read or the full answer decides.
  if (receipt.state !== 'removed') return new Promise<never>(() => undefined)
  return true
}

/**
 * Reads the installation id the window's descriptor mark would carry, but only while both receipts stand under the Devin bridge's own rules (each installed and private; the MCP one with its installation id, and not a file its publish record notes as left there unverified, {@link readReceiptState}), so a window is never marked for a setup the bridge would refuse; called by the extension's mark decision on every descriptor write and sync.
 * An observed removal answers at once, without waiting for the other receipt's read (which may never return); both receipts installed is the only answer that needs both reads.
 * A receipt that was observed removed, unreadable by its mode or without an id counts as not standing; a receipt whose read could not look at all (descriptor exhaustion, `EIO`) is neither: it answers `null`, so a transient failure is never taken for a removal and the caller can ask again or keep the mark it had.
 * Both reads go through the read gate: a receipt read still in flight from an earlier call (one an early removal answer left behind) is never started again, and this call gets a read that began after it.
 * @param storageRoot - Codebook's global storage folder.
 * @param reads - The read gate; {@link defaultPathReadGate} when left out (a test passes its own).
 * @returns The MCP receipt's installation id; `undefined` when a receipt was observed not standing or the id is missing; `null` when no answer could be had and nothing is known.
 * @example
 * await readStandingDevinInstallationId('/storage') // => 'f3b1c0de-…', or undefined once the skill receipt became readable by others
 */
export async function readStandingDevinInstallationId(
  storageRoot: string,
  reads: PathReadGate = defaultPathReadGate,
): Promise<string | undefined | null> {
  const skillPath = join(storageRoot, 'devin-skill', 'receipt.json')
  const entryPath = join(storageRoot, 'devin-mcp', 'receipt.json')
  const skillRead = reads.read(`receipt:${skillPath}`, () =>
    readReceiptState(skillPath),
  )
  const entryRead = reads.read(`receipt:${entryPath}`, () =>
    readReceiptState(entryPath),
  )
  const both = Promise.all([skillRead, entryRead])
  // The first observed removal wins; otherwise both answers decide.
  const answer = await Promise.race([
    both,
    Promise.race([whenRemoved(skillRead), whenRemoved(entryRead)]),
  ])
  if (answer === true) return undefined
  const [skill, entry] = answer
  // An observed removal is certain whatever the other read did.
  if (skill.state === 'removed' || entry.state === 'removed') return undefined
  // No observed removal, but a read that could not look: nothing is known.
  if (skill.state === 'no-answer' || entry.state === 'no-answer') return null
  const installationId = entry.receipt.installationId
  return typeof installationId === 'string' ? installationId : undefined
}

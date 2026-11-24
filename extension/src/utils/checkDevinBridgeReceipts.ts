import { dirname, join } from 'node:path'

import { readMarkedInstallation } from './readMarkedInstallation'
import {
  readPrivateJsonState,
  type PrivateJsonState,
} from './readPrivateJsonState'
import {
  readReceiptState,
  type ReceiptRemovedReason,
  type ReceiptState,
} from './readReceiptState'
import { defaultPathReadGate, type PathReadGate } from './shareReceiptRead'

/** What the Devin bridge's selection validated, so the check can tell a setup that was removed from one that was replaced by another installation: the instance id and the endpoint url the bridge connected for and the installation id the descriptor's mark named. A field left out is not compared. */
export interface DevinBridgeBinding {
  instanceId?: string
  url?: string
  installationId?: string
  /** The workspace folder the checked server serves; only a setup's final check names it. */
  workspace?: string
  /** The host process id the descriptor was written with; only a setup's final check names it. */
  pid?: number
  /** Whether the descriptor must carry `devinChat: true`; only a setup's final check asks for it. */
  requiresDevinChat?: boolean
}

/** Why the setup counts as removed: any {@link ReceiptRemovedReason} of a receipt (or of the descriptor itself), `no-mark` for a descriptor that names no installation, or `another-installation` for an MCP receipt whose installation id differs from the descriptor's mark. */
export type DevinBridgeRemovedReason =
  ReceiptRemovedReason | 'no-mark' | 'another-installation'

/**
 * The answer of {@link checkDevinBridgeReceipts}:
 * - `stands`: the descriptor's mark, the skill receipt and the MCP receipt agree and are installed (and match the binding, when one was given).
 * - `removed`: an observed absence or invalid state, with the `reason` and the `path` of the file it was observed on.
 * - `replaced`: only with a binding; the descriptor now names another instance, endpoint or installation than the one the bridge connected for.
 * - `no-answer`: a read failed (descriptor exhaustion, `EIO` and the like), so nothing is known; the caller treats it like a timeout.
 */
export type DevinBridgeReceiptsAnswer =
  | { answer: 'stands' }
  | { answer: 'removed'; reason: DevinBridgeRemovedReason; path: string }
  | { answer: 'replaced' }
  | { answer: 'no-answer' }

/**
 * Reads a string field of a parsed descriptor; called by {@link isDescriptorReplaced}.
 * @param descriptor - The descriptor's parsed JSON.
 * @param field - The field name.
 * @returns The field's text; `undefined` for a descriptor that is no object or a field that is no string.
 * @example
 * descriptorText({ url: 'http://127.0.0.1:1/mcp' }, 'url') // => 'http://127.0.0.1:1/mcp'
 */
function descriptorText(
  descriptor: unknown,
  field: string,
): string | undefined {
  const value =
    typeof descriptor === 'object' && descriptor !== null && field in descriptor
      ? Reflect.get(descriptor, field)
      : undefined
  return typeof value === 'string' ? value : undefined
}

/**
 * Reads a number field of a parsed descriptor; called by {@link isDescriptorReplaced}.
 * @param descriptor - The descriptor's parsed JSON.
 * @param field - The field name.
 * @returns The field's number; `undefined` for a descriptor that is no object or a field that is no number.
 * @example
 * descriptorNumber({ pid: 42 }, 'pid') // => 42
 */
function descriptorNumber(
  descriptor: unknown,
  field: string,
): number | undefined {
  const value =
    typeof descriptor === 'object' && descriptor !== null && field in descriptor
      ? Reflect.get(descriptor, field)
      : undefined
  return typeof value === 'number' ? value : undefined
}

/**
 * Says whether the descriptor now names another instance, endpoint or installation than the binding; called by {@link checkDevinBridgeReceipts}.
 * @param descriptor - The descriptor's parsed JSON.
 * @param marked - The installation id the descriptor's mark names (already known to exist).
 * @param binding - What the bridge connected for.
 * @returns `true` when a field the binding names differs.
 * @example
 * isDescriptorReplaced(descriptor, 'installation-b', { installationId: 'installation-a' }) // => true
 */
function isDescriptorReplaced(
  descriptor: unknown,
  marked: string,
  binding: DevinBridgeBinding,
): boolean {
  const differs = <Value extends string | number>(
    expected: Value | undefined,
    actual: Value | undefined,
  ) => expected !== undefined && expected !== actual
  const lacksDevinChat =
    binding.requiresDevinChat === true &&
    !(
      typeof descriptor === 'object' &&
      descriptor !== null &&
      Reflect.get(descriptor, 'devinChat') === true
    )
  return (
    differs(binding.instanceId, descriptorText(descriptor, 'instanceId')) ||
    differs(binding.url, descriptorText(descriptor, 'url')) ||
    differs(binding.installationId, marked) ||
    differs(binding.workspace, descriptorText(descriptor, 'workspace')) ||
    differs(binding.pid, descriptorNumber(descriptor, 'pid')) ||
    lacksDevinChat
  )
}

/**
 * Decides what the descriptor alone says, so a removed descriptor, a missing mark or a replacement is answered before the receipts are weighed; called by {@link decideFromSettledReads}.
 * @param descriptor - The settled descriptor read.
 * @param descriptorPath - The descriptor's path, named by a removal.
 * @param binding - What the bridge connected for.
 * @returns A `removed` or `replaced` answer; `undefined` when the descriptor read has no answer or the descriptor names a mark that matches the binding.
 * @example
 * decideFromDescriptor({ state: 'removed', reason: 'missing' }, '/storage/agent/x.connection.json', {}) // => { answer: 'removed', reason: 'missing', path: '/storage/agent/x.connection.json' }
 */
function decideFromDescriptor(
  descriptor: PrivateJsonState,
  descriptorPath: string,
  binding: DevinBridgeBinding,
): DevinBridgeReceiptsAnswer | undefined {
  if (descriptor.state === 'removed')
    return {
      answer: 'removed',
      reason: descriptor.reason,
      path: descriptorPath,
    }
  if (descriptor.state === 'no-answer') return undefined
  const marked = readMarkedInstallation(descriptor.value)
  if (marked === undefined)
    return { answer: 'removed', reason: 'no-mark', path: descriptorPath }
  if (isDescriptorReplaced(descriptor.value, marked, binding))
    return { answer: 'replaced' }
  return undefined
}

/** The three reads of one check; a read that has not settled yet is `undefined`. */
interface SettledReads {
  descriptor: PrivateJsonState | undefined
  skill: ReceiptState | undefined
  mcp: ReceiptState | undefined
}

/**
 * Decides the check's answer from the reads that have settled so far; called by {@link checkDevinBridgeReceipts} after each read settles.
 * A definite observation (a removed or replaced descriptor, a removed receipt) answers at once, without waiting for a read that is still pending, so one stalled read can never hide a removal. `no-answer`, `another-installation` and `stands` need every read.
 * @param reads - The reads settled so far.
 * @param descriptorPath - The descriptor's path.
 * @param binding - What the bridge connected for.
 * @returns The answer; `undefined` while more reads must settle.
 * @example
 * decideFromSettledReads({ descriptor: undefined, skill: undefined, mcp: { state: 'removed', reason: 'missing', receiptPath: '/s/devin-mcp/receipt.json' } }, '/s/agent/x.connection.json', {}) // => { answer: 'removed', reason: 'missing', path: '/s/devin-mcp/receipt.json' }
 */
function decideFromSettledReads(
  reads: SettledReads,
  descriptorPath: string,
  binding: DevinBridgeBinding,
): DevinBridgeReceiptsAnswer | undefined {
  const { descriptor, skill, mcp } = reads
  const fromDescriptor =
    descriptor && decideFromDescriptor(descriptor, descriptorPath, binding)
  if (fromDescriptor) return fromDescriptor
  // An observed removal of a receipt outranks every unread or failed read.
  for (const receipt of [skill, mcp])
    if (receipt?.state === 'removed')
      return {
        answer: 'removed',
        reason: receipt.reason,
        path: receipt.receiptPath,
      }
  // Nothing definite is known: wait for the reads that are pending.
  if (!descriptor || !skill || !mcp) return undefined
  // Every read settled and none observed a removal; a failed read is no answer.
  if (
    descriptor.state !== 'read' ||
    skill.state !== 'installed' ||
    mcp.state !== 'installed'
  )
    return { answer: 'no-answer' }
  if (mcp.receipt.installationId !== readMarkedInstallation(descriptor.value))
    return {
      answer: 'removed',
      reason: 'another-installation',
      path: join(dirname(dirname(descriptorPath)), 'devin-mcp', 'receipt.json'),
    }
  return { answer: 'stands' }
}

/**
 * Says whether the setup a descriptor was marked for still stands, as the Devin bridge's check before it opens an MCP session (the first connection, a reconnect after an expired session, and a refusal with 401 or 403); called by the Devin bridge, and by setup for the bridge's own rules.
 * The descriptor must name an installation (its mark), the skill receipt must say `installed: true` and the MCP receipt must be installed with the descriptor's installation id, and not be a file the publish record beside it notes as left there unverified ({@link readReceiptState}). All three are read together with the bounded read ({@link readPrivateJsonState}) from the parent of the agent folder, the folder the descriptor stands in. A read that only failed to look (descriptor exhaustion, `EIO`) is never read as a removal: it answers `no-answer`, and only when no read observed a removal.
 * Order: the check answers as soon as the reads that settled give a definite answer, without waiting for a read still pending: a removed descriptor, a descriptor without a mark, a descriptor that differs from the binding (`replaced`), then a removed receipt. Once every read settled, a failed read answers `no-answer` and a receipt of another installation answers `removed` with `another-installation`.
 * The three reads go through the read gate: a read of the same file still in flight from an earlier check (one an early answer left behind) is never started again, and this check gets a read that began after it.
 * @param descriptorPath - The selected descriptor, in the agent folder.
 * @param binding - What the bridge connected for; without it only the descriptor's mark is compared with the receipts.
 * @param readGate - The read gate; {@link defaultPathReadGate} when left out (a test passes its own).
 * @returns A {@link DevinBridgeReceiptsAnswer}; never rejects, and stays pending only while no settled read gives a definite answer.
 * @example
 * await checkDevinBridgeReceipts('/storage/agent/x.connection.json') // => { answer: 'removed', reason: 'missing', path: '/storage/devin-skill/receipt.json' } after a removal
 * await checkDevinBridgeReceipts(path, { instanceId, url, installationId: 'a' }) // => { answer: 'replaced' } once the descriptor was re-marked 'b'
 */
export function checkDevinBridgeReceipts(
  descriptorPath: string,
  binding: DevinBridgeBinding = {},
  readGate: PathReadGate = defaultPathReadGate,
): Promise<DevinBridgeReceiptsAnswer> {
  const storageRoot = dirname(dirname(descriptorPath))
  const skillPath = join(storageRoot, 'devin-skill', 'receipt.json'),
    mcpPath = join(storageRoot, 'devin-mcp', 'receipt.json')
  return new Promise((resolve) => {
    const reads: SettledReads = {
      descriptor: undefined,
      skill: undefined,
      mcp: undefined,
    }
    // Weighs the reads settled so far; the first definite answer wins and a later call resolves nothing new.
    const weigh = (): void => {
      const answer = decideFromSettledReads(reads, descriptorPath, binding)
      if (answer) resolve(answer)
    }
    const settleDescriptor = (state: PrivateJsonState): void => {
      reads.descriptor = state
      weigh()
    }
    const settleSkill = (state: ReceiptState): void => {
      reads.skill = state
      weigh()
    }
    const settleMcp = (state: ReceiptState): void => {
      reads.mcp = state
      weigh()
    }
    // The reads never throw; a rejection still counts as a read that gave no answer.
    void readGate
      .read(`descriptor:${descriptorPath}`, () =>
        readPrivateJsonState(descriptorPath),
      )
      .then(settleDescriptor, () => settleDescriptor({ state: 'no-answer' }))
    void readGate
      .read(`receipt:${skillPath}`, () => readReceiptState(skillPath))
      .then(settleSkill, () =>
        settleSkill({ state: 'no-answer', receiptPath: skillPath }),
      )
    void readGate
      .read(`receipt:${mcpPath}`, () => readReceiptState(mcpPath))
      .then(settleMcp, () =>
        settleMcp({ state: 'no-answer', receiptPath: mcpPath }),
      )
  })
}

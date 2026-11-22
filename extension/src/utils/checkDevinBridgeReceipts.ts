import { dirname, join } from 'node:path'

import { readMarkedInstallation } from './readMarkedInstallation'
import { readPrivateJsonState } from './readPrivateJsonState'
import { readReceiptState, type ReceiptRemovedReason } from './readReceiptState'

/** What the Devin bridge's selection validated, so the check can tell a setup that was removed from one that was replaced by another installation: the instance id and the endpoint url the bridge connected for and the installation id the descriptor's mark named. A field left out is not compared. */
export interface DevinBridgeBinding {
  instanceId?: string
  url?: string
  installationId?: string
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
  const differs = (expected: string | undefined, actual: string | undefined) =>
    expected !== undefined && expected !== actual
  return (
    differs(binding.instanceId, descriptorText(descriptor, 'instanceId')) ||
    differs(binding.url, descriptorText(descriptor, 'url')) ||
    differs(binding.installationId, marked)
  )
}

/**
 * Says whether the setup a descriptor was marked for still stands, as the Devin bridge's check before it opens an MCP session (the first connection, a reconnect after an expired session, and a refusal with 401 or 403); called by the Devin bridge, and by setup for the bridge's own rules.
 * The descriptor must name an installation (its mark), the skill receipt must say `installed: true` and the MCP receipt must be installed with the descriptor's installation id. All three are read with the bounded read ({@link readPrivateJsonState}) from the parent of the agent folder, the folder the descriptor stands in. A read that only failed to look (descriptor exhaustion, `EIO`) is never read as a removal: it answers `no-answer`.
 * Order: a descriptor read that failed answers at once; a descriptor that differs from the binding is `replaced`; a descriptor without a mark, then a removed receipt, answer `removed`; a failed receipt read answers `no-answer`; a receipt of another installation answers `removed` with `another-installation`.
 * @param descriptorPath - The selected descriptor, in the agent folder.
 * @param binding - What the bridge connected for; without it only the descriptor's mark is compared with the receipts.
 * @returns A {@link DevinBridgeReceiptsAnswer}; never throws.
 * @example
 * await checkDevinBridgeReceipts('/storage/agent/x.connection.json') // => { answer: 'removed', reason: 'missing', path: '/storage/devin-skill/receipt.json' } after a removal
 * await checkDevinBridgeReceipts(path, { instanceId, url, installationId: 'a' }) // => { answer: 'replaced' } once the descriptor was re-marked 'b'
 */
export async function checkDevinBridgeReceipts(
  descriptorPath: string,
  binding: DevinBridgeBinding = {},
): Promise<DevinBridgeReceiptsAnswer> {
  const storageRoot = dirname(dirname(descriptorPath))
  const skillPath = join(storageRoot, 'devin-skill', 'receipt.json'),
    mcpPath = join(storageRoot, 'devin-mcp', 'receipt.json')
  const [descriptor, skill, mcp] = await Promise.all([
    readPrivateJsonState(descriptorPath),
    readReceiptState(skillPath),
    readReceiptState(mcpPath),
  ])
  if (descriptor.state === 'no-answer') return { answer: 'no-answer' }
  if (descriptor.state === 'removed')
    return {
      answer: 'removed',
      reason: descriptor.reason,
      path: descriptorPath,
    }
  const marked = readMarkedInstallation(descriptor.value)
  if (marked === undefined)
    return { answer: 'removed', reason: 'no-mark', path: descriptorPath }
  if (isDescriptorReplaced(descriptor.value, marked, binding))
    return { answer: 'replaced' }
  // An observed removal outranks a failed read of the other receipt.
  for (const receipt of [skill, mcp])
    if (receipt.state === 'removed')
      return {
        answer: 'removed',
        reason: receipt.reason,
        path: receipt.receiptPath,
      }
  // Both receipts are installed or unread here; an unread one is no answer.
  if (skill.state !== 'installed' || mcp.state !== 'installed')
    return { answer: 'no-answer' }
  if (mcp.receipt.installationId !== marked)
    return { answer: 'removed', reason: 'another-installation', path: mcpPath }
  return { answer: 'stands' }
}

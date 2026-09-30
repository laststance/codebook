import { z } from 'zod'

/** One receipt forwarded through {@link BrowserViewport}'s record callback, such as `viewport.sent` or `viewport.frame-stage`. */
export interface ViewportDeliveryReceipt {
  type: string
  detail?: unknown
}

/** Newest receipts from one recorded-frame attempt; `omitted` counts older receipts dropped by the caller's bound. */
export interface ViewportDeliveryLog {
  receipts: ViewportDeliveryReceipt[]
  omitted: number
}

const receiptDetailSchema = z.object({
  epoch: z.string().optional(),
  id: z.union([z.number(), z.string()]).optional(),
  stage: z.string().optional(),
  visibility: z.string().optional(),
  hasArea: z.boolean().optional(),
  reason: z.string().optional(),
  error: z.string().optional(),
})

/**
 * Summarizes one recorded-frame attempt's renderer progress for playback Recording error details.
 *
 * {@link StudyWorkspace} calls this when a replay frame loses its paint receipt, so a learner-visible
 * failure distinguishes a frame that never arrived, a hidden or zero-area renderer, a missing paint
 * callback and a failed re-handshake. Image data and hashes are never included.
 *
 * @param log - Bounded receipts for exactly one attempt, oldest first, plus the count dropped before them.
 * @returns
 * - Receipts joined by `; `, showing renderer visibility/area only when it changes
 * - `no renderer receipts` when the attempt recorded nothing
 *
 * @example
 * ```ts
 * describeViewportDelivery({ omitted: 0, receipts: [
 *   { type: 'viewport.sent', detail: { id: 3, hash: 'private' } },
 *   { type: 'viewport.frame-stage', detail: { id: 3, stage: 'received', visibility: 'hidden', hasArea: false } },
 * ] }) // => 'sent #3; received (hidden, no area)'
 * ```
 */
export function describeViewportDelivery(log: ViewportDeliveryLog): string {
  const parts: string[] = []
  if (log.omitted > 0) parts.push(`${log.omitted} earlier receipts omitted`)
  let previousSurface: string | undefined
  for (const receipt of log.receipts) {
    const parsed = receiptDetailSchema.safeParse(receipt.detail ?? {})
    // Malformed detail cannot come from the owned viewport; skip it rather than guess its meaning.
    if (!parsed.success) continue
    const detail = parsed.data
    if (receipt.type === 'viewport.frame-stage' && detail.stage) {
      const surface = `${detail.visibility ?? 'unknown visibility'}, ${detail.hasArea ? 'area' : 'no area'}`
      // Repeat renderer visibility/area only when it changed since the previous stage.
      parts.push(
        surface === previousSurface
          ? detail.stage
          : `${detail.stage} (${surface})`,
      )
      previousSurface = surface
    } else if (receipt.type === 'viewport.ready' && detail.epoch)
      parts.push(`ready ${detail.epoch.slice(0, 8)}`)
    else if (receipt.type === 'viewport.sent') parts.push(`sent #${detail.id}`)
    else if (receipt.type === 'viewport.acknowledged')
      parts.push(`painted #${detail.id}`)
    else if (receipt.type === 'viewport.delivery-rejected')
      parts.push(`rejected #${detail.id}: ${detail.reason}`)
    else if (receipt.type === 'viewport.stale-ack-ignored')
      parts.push(`stale receipt #${detail.id}`)
    else if (receipt.type === 'viewport.ready-request-failed')
      parts.push(`ready request failed: ${detail.error}`)
    else if (receipt.type === 'viewport.disposed') parts.push('disposed')
  }
  return parts.length ? parts.join('; ') : 'no renderer receipts'
}

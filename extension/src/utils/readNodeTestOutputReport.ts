import { z } from 'zod'

import type { NodeTestOutputReport } from './installNodeTestOutput'

const anchorSchema = z.strictObject({
  line: z.number().int().nonnegative(),
  offsetPx: z.number().finite(),
})

const reportSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('node-history-output-ready'),
    history: z.string(),
    generation: z.number().int().nonnegative(),
    follow: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('node-history-output-state'),
    history: z.string(),
    follow: z.boolean(),
    anchor: anchorSchema.optional(),
  }),
])

/**
 * Reads what a test replay's Application document tells the host (it is ready for views, or the learner's reading changed); a message from a webview is untrusted, so anything else is refused. Called by the Study workspace for each message the Application pane's webview posts.
 * @param message - The message as the webview posted it.
 * @returns The report, or `undefined` when the message is no report of the document.
 * @example readNodeTestOutputReport({ type: 'node-history-output-state', history: 'study_1', follow: false, anchor: { line: 3, offsetPx: 4 } })?.type // => 'node-history-output-state'
 */
export function readNodeTestOutputReport(
  message: unknown,
): NodeTestOutputReport | undefined {
  const parsed = reportSchema.safeParse(message)
  if (!parsed.success) return undefined
  const report = parsed.data
  // The document sends `anchor: undefined` for no anchor, which JSON leaves out.
  return report.type === 'node-history-output-state'
    ? {
        type: report.type,
        history: report.history,
        follow: report.follow,
        ...(report.anchor ? { anchor: report.anchor } : {}),
      }
    : report
}

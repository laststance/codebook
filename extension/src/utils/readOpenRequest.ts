import { z } from 'zod'

/** The one rule for the number a Study pane gives its open request: a positive integer; shared with the reader's message schema. @example openRequestNumberSchema.safeParse(3).success // => true */
export const openRequestNumberSchema = z.number().int().positive()

// Not strict on purpose: the reader's own message schema decides whether the whole message is valid; this only finds the number to answer.
const paneOpenRequestSchema = z.object({
  type: z.enum(['history', 'node-history']),
  openRequest: openRequestNumberSchema,
})

/** The kind of Saved studies entry a Study pane asked to open, and the number the pane gave that request. @example const request: PaneOpenRequest = { type: 'history', openRequest: 3 } */
export type PaneOpenRequest = z.infer<typeof paneOpenRequestSchema>

/** The host's reply to the one webview that sent an open request: the request ended, whether or not its entry is shown. @example const reply: OpenRequestSettled = { type: 'open-request-settled', openRequest: 3 } */
export type OpenRequestSettled = {
  type: 'open-request-settled'
  openRequest: PaneOpenRequest['openRequest']
}

/**
 * Reads the number a Study pane gave its request to open a Saved studies entry, so a request the reader refuses can still be answered.
 * Called for every webview message, before the reader validates it.
 * @param value - The raw webview message.
 * @returns
 * - A `history` or `node-history` message with a positive integer `openRequest`: its type and number
 * - Any other value: `undefined`
 * @example
 * readOpenRequest({ type: 'history', revision: 4, studyId, openRequest: 3 }) // => { type: 'history', openRequest: 3 }
 * readOpenRequest({ type: 'history', revision: 4, studyId })                 // => undefined
 * readOpenRequest({ type: 'history', revision: 4, studyId, openRequest: 0 }) // => undefined
 */
export function readOpenRequest(value: unknown): PaneOpenRequest | undefined {
  const parsed = paneOpenRequestSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

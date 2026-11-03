import type { Protocol } from 'devtools-protocol'
import { z } from 'zod'

/** A synchronous call frame of a paused event, with the fields a Pages verdict reads. */
export type PagesSyncCallFrame = {
  /** Valid only while the debugger is paused; the frame `pathname` is evaluated on needs it. */
  callFrameId?: string
  functionName: string
  location: { scriptId: string; lineNumber: number; columnNumber: number }
  /** Always `''` in events that js-debug's CDP proxy forwards; the script address comes from `Debugger.scriptParsed`. */
  url: string
}

/** A frame of an async stack trace, with the fields a Pages verdict reads. */
export type PagesAsyncCallFrame = {
  functionName: string
  scriptId: string
  /** The script address; async frames carry it directly. */
  url: string
  lineNumber: number
  columnNumber: number
}

/** One level of an async stack trace, as `Runtime.StackTrace` lays it out. */
export type PagesAsyncStackNode = {
  description?: string
  callFrames: PagesAsyncCallFrame[]
  parent?: PagesAsyncStackNode
  parentId?: Protocol.Runtime.StackTraceId
}

/** A `Debugger.paused` event as far as a Pages verdict reads it. */
export type PagesPausedEvent = {
  callFrames: PagesSyncCallFrame[]
  asyncStackTrace?: PagesAsyncStackNode
  asyncStackTraceId?: Protocol.Runtime.StackTraceId
}

const stackTraceIdSchema = z.object({
  id: z.string(),
  debuggerId: z.string().optional(),
})

/**
 * A 0-based line or column of a script position: a non-negative integer.
 *
 * The numbers come from the debuggee, and the verdict slices the renderer's text at them ({@link nextPagesDataFunctionCallAt}): a negative column would slice from the end of the line and could match a call that is not the frame's, and a fraction names no position. Such a frame makes the whole event malformed, which the verdict records as `verdict-error`.
 */
const scriptPositionSchema = z.number().int().nonnegative()

const asyncCallFrameSchema = z.object({
  functionName: z.string().default(''),
  scriptId: z.string(),
  url: z.string().default(''),
  lineNumber: scriptPositionSchema,
  columnNumber: scriptPositionSchema.default(0),
})

/**
 * Reads one level of an async stack trace, with the levels behind it.
 * Exported so the continuation read ({@link readPagesAsyncChain}) checks a `Debugger.getStackTrace` answer by the same rules as the event's own chain.
 */
export const pagesAsyncStackNodeSchema: z.ZodType<PagesAsyncStackNode> = z.lazy(
  () =>
    z.object({
      description: z.string().optional(),
      callFrames: z.array(asyncCallFrameSchema),
      parent: pagesAsyncStackNodeSchema.optional(),
      parentId: stackTraceIdSchema.optional(),
    }),
)

const syncCallFrameSchema = z.object({
  callFrameId: z.string().optional(),
  functionName: z.string().default(''),
  location: z.object({
    scriptId: z.string(),
    lineNumber: scriptPositionSchema,
    columnNumber: scriptPositionSchema.default(0),
  }),
  url: z.string().default(''),
})

const pausedEventSchema = z.object({
  callFrames: z.array(syncCallFrameSchema),
  asyncStackTrace: pagesAsyncStackNodeSchema.optional(),
  asyncStackTraceId: stackTraceIdSchema.optional(),
})

/**
 * Checks that a forwarded `Debugger.paused` event has the shape a Pages verdict reads, and keeps only those fields.
 *
 * Why it exists: the event comes through js-debug's proxy from a Next version Codebook did not write, so a changed shape must become a recorded `verdict-error` instead of a `TypeError` in the middle of the verdict. Called by {@link pagesDataFunctionHitVerdictOf} first.
 * @param event - The `params` of the `Debugger.paused` event as received.
 * @returns The event with `callFrames`, `asyncStackTrace` and `asyncStackTraceId` (other fields such as `scopeChain` are dropped), or `undefined` when a frame lacks its script id or location, a line or column is not a non-negative integer, or a list is not a list.
 * @example
 * parsePagesPausedEvent({ callFrames: [{ callFrameId: '1', functionName: 'getServerSideProps', location: { scriptId: '7', lineNumber: 21 }, url: '' }] })
 * // => { callFrames: [{ callFrameId: '1', functionName: 'getServerSideProps', location: { scriptId: '7', lineNumber: 21, columnNumber: 0 }, url: '' }] }
 * parsePagesPausedEvent({ callFrames: 'x' }) // => undefined
 * parsePagesPausedEvent({ callFrames: [{ functionName: 'f', location: { scriptId: '7', lineNumber: 21, columnNumber: -19 }, url: '' }] }) // => undefined
 */
export function parsePagesPausedEvent(
  event: unknown,
): PagesPausedEvent | undefined {
  const parsed = pausedEventSchema.safeParse(event)
  return parsed.success ? parsed.data : undefined
}

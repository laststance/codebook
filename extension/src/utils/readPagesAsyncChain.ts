import type { Protocol } from 'devtools-protocol'

import { PAGES_STACK_TRACE_READ_LIMIT } from '../constants'

import type { PagesHitReader } from './pagesHitReader'
import { pagesStackFramesOf, type PagesStackFrame } from './pagesStackFramesOf'
import {
  pagesAsyncStackNodeSchema,
  type PagesAsyncStackNode,
} from './parsePagesPausedEvent'
import {
  readWithinVerdictBudget,
  type VerdictBudget,
} from './readWithinVerdictBudget'

/** Why an async chain could not be read to its end. */
export type PagesChainIncompleteCause =
  'continuation-limit' | 'fetch-failed' | 'timeout'

/** One step of reading the chain: the frames of one more level, or the reason the chain stops short. */
export type PagesChainStep =
  | { kind: 'level'; frames: PagesStackFrame[] }
  | { kind: 'incomplete'; cause: PagesChainIncompleteCause }

/** What fetching a continuation came to. */
type ContinuationRead =
  | { kind: 'node'; node: PagesAsyncStackNode }
  | { kind: 'incomplete'; cause: PagesChainIncompleteCause }

/**
 * Walks the async chain of a paused event one level at a time, innermost first, following `parent` and fetching `parentId` continuations.
 *
 * Why it exists: the page of a hit and the positive "outside the data function" verdict both need the chain, but a caller that has found what it needs must not pay for the rest, so the chain is read lazily and its reads (`Debugger.getStackTrace`, at most {@link PAGES_STACK_TRACE_READ_LIMIT} per hit) share the hit's budget. Called by {@link pagesDataFunctionHitVerdictOf}.
 * @param start - The event's `asyncStackTrace`, or only its `asyncStackTraceId`; with neither the chain is empty.
 * @param reader - Resolves script addresses and reads continuations.
 * @param budget - The hit's single time budget.
 * @yields
 * - `{ kind: 'level', frames }` for each level, the event's own levels without a read and a fetched level after one
 * - `{ kind: 'incomplete', cause }` once, last, when the chain stops short: a failed or malformed answer (`fetch-failed`, which is also how a stack trace id the debugger cannot resolve ends the chain), the fifth read (`continuation-limit`) or a spent budget (`timeout`)
 * A generator that ends without an `incomplete` step has read the chain to its end.
 * @example
 * for await (const step of readPagesAsyncChain({ asyncStackTrace }, reader, budget)) if (step.kind === 'incomplete') break
 */
export async function* readPagesAsyncChain(
  start: {
    asyncStackTrace?: PagesAsyncStackNode
    asyncStackTraceId?: Protocol.Runtime.StackTraceId
  },
  reader: Pick<PagesHitReader, 'scriptUrlOf' | 'getStackTrace'>,
  budget: VerdictBudget,
): AsyncGenerator<PagesChainStep, void> {
  let readsSpent = 0
  let node = start.asyncStackTrace
  // With no inline trace the chain starts in the id, which is fetched like a continuation.
  let continuation = node ? undefined : start.asyncStackTraceId
  for (;;) {
    if (!node) {
      // No inline level and no id left: the chain ended.
      if (!continuation) return
      const fetched = await fetchContinuation(
        continuation,
        readsSpent,
        reader,
        budget,
      )
      if (fetched.kind === 'incomplete') {
        yield fetched
        return
      }
      readsSpent += 1
      node = fetched.node
    }
    yield {
      kind: 'level',
      frames: pagesStackFramesOf(
        { origin: 'async', callFrames: node.callFrames },
        reader.scriptUrlOf,
      ),
    }
    // An inline parent is followed first; the id continues the chain only where no inline parent is left.
    continuation = node.parent ? undefined : node.parentId
    node = node.parent
  }
}

/**
 * Fetches the level a stack trace id points to, within the read limit and the hit's budget.
 * @param stackTraceId - The `parentId` or `asyncStackTraceId` to resolve.
 * @param readsSpent - How many continuation reads this hit has already spent.
 * @param reader - Supplies `getStackTrace`.
 * @param budget - The hit's single time budget.
 * @returns The fetched level, or the cause the chain is incomplete.
 */
async function fetchContinuation(
  stackTraceId: Protocol.Runtime.StackTraceId,
  readsSpent: number,
  reader: Pick<PagesHitReader, 'getStackTrace'>,
  budget: VerdictBudget,
): Promise<ContinuationRead> {
  if (readsSpent >= PAGES_STACK_TRACE_READ_LIMIT)
    return { kind: 'incomplete', cause: 'continuation-limit' }
  const read = await readWithinVerdictBudget(
    () => reader.getStackTrace(stackTraceId),
    budget,
  )
  if (read.status === 'timeout') return { kind: 'incomplete', cause: 'timeout' }
  // A rejected read (a stack trace id the debugger cannot resolve, another debugger's for one) and an answer that is no stack trace count as a failed read.
  const parsed =
    read.status === 'read'
      ? pagesAsyncStackNodeSchema.safeParse(read.value)
      : undefined
  return parsed?.success
    ? { kind: 'node', node: parsed.data }
    : { kind: 'incomplete', cause: 'fetch-failed' }
}

import type {
  ApiRequestFact,
  ApiRequestWatched,
} from '../configuredStudySchemas'

import { describeApiRequestSentence } from './describeApiRequestSentence'

/** The tracker's verdict on one API pause, before any fact is built from it. */
export type ApiRequestDecision =
  | {
      state: 'attributed'
      /** Upper-case method that passed the keepable check. */
      method: string
      /** Masked and capped page path, without the query. */
      path: string
      route: 'api-origin' | 'dev-server-proxy'
      /** The declared prefix matched; set for the dev-server proxy route only. */
      proxyPath?: string
    }
  | { state: 'unattributed'; reason: 'none' | 'several'; count: number }

/** What {@link apiRequestFactOf} needs besides the decision. */
export interface ApiRequestFactContext {
  operation: number
  title: string
  /** Set exactly when the tracker is proxy-aware: the fact then carries `route`, `proxyPath` and `watched`. */
  watched?: ApiRequestWatched
}

/**
 * Builds the saved `apiRequest` fact and its sentence from the tracker's decision.
 *
 * Why it exists: the tracker only decides; the shape of the fact (and which fields only a proxy-aware run adds, D29) lives here so an Expo run's facts stay byte-identical to Cycle 0099. Called by `ApiRequestTracker.attribute` at each API pause.
 * @param decision - The tracker's verdict.
 * @param context - Operation, its title and, for a proxy-aware run, what it watched.
 * @returns The fact with its ready sentence.
 * @example
 * ```ts
 * apiRequestFactOf({ state: 'unattributed', reason: 'none', count: 0 }, { operation: 2, title: 'Press' }).sentence
 * ```
 */
export function apiRequestFactOf(
  decision: ApiRequestDecision,
  context: ApiRequestFactContext,
): ApiRequestFact {
  const proxyAware = context.watched !== undefined
  if (decision.state === 'attributed') {
    const { method, path, proxyPath } = decision
    return {
      state: 'attributed',
      method,
      path,
      operation: context.operation,
      basis: 'time-window',
      sentence: describeApiRequestSentence({
        state: 'attributed',
        method,
        path,
        operation: context.operation,
        title: context.title,
        proxyPath,
      }),
      // Only a proxy-aware run names the route; Expo facts keep their Cycle 0099 shape.
      ...(proxyAware ? { route: decision.route } : {}),
      ...(proxyAware && proxyPath !== undefined ? { proxyPath } : {}),
    }
  }
  const { reason, count } = decision
  return {
    state: 'unattributed',
    reason,
    count,
    sentence: describeApiRequestSentence({
      state: 'unattributed',
      reason,
      count,
      watched: context.watched,
    }),
    ...(proxyAware ? { watched: context.watched } : {}),
  }
}

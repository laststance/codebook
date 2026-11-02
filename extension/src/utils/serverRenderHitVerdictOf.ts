/** What the classification found out about the rendering route of a hit. */
export type RenderedRoute =
  { state: 'read'; route: string } | { state: 'unreadable' }

/** What a render hit means: published as the learner's pause (with its attribution) or resumed by the run (with the journal event that records why). */
export type ServerRenderHitVerdict =
  | { action: 'pause'; attribution: 'entry-load' | 'after-operation' }
  | { action: 'pause'; attribution: 'unconfirmed' }
  | { action: 'resume'; event: 'breakpoint.react-copy' }
  | { action: 'resume'; event: 'breakpoint.repeat-hit' }
  | { action: 'resume'; event: 'breakpoint.other-route'; route: string }
  | { action: 'resume'; event: 'breakpoint.unattributed-resumed' }

/** The facts a hit is judged by. */
export type ServerRenderHit = {
  /** The hit is in an `about://React/Server/` copy at one of the run's own armed stop positions (F1). */
  isReactCopyAtOwnedStop: boolean
  /** The armed stop this hit belongs to already paused once. */
  stopAlreadyPaused: boolean
  /** What the route read answered. */
  renderedRoute: RenderedRoute
  /** The entry route's URL pattern ({@link entryRoutePatternOf}); `undefined` when the run could not resolve one. */
  entryPattern: string | undefined
  /** Whether the browser's main frame shows the entry route ({@link isBrowserOnEntryRoute}). */
  browserOnEntryRoute: boolean
  /** The stop's operation group: 0 for the entry render, k for the render observed after operation k. */
  group: number
}

/**
 * Decides what a hit of an armed server stop in an `(rsc)` instance means, before anything is published.
 *
 * Why it exists: a render runs other routes' copies of a shared module and React's fabricated copies of server modules, and a cached function can run in another route's render; only the entry route's own first hit is the learner's pause. The decision is pure so the run's classification state only gathers the facts. Called by {@link ConfiguredBrowserRun} once the route read answered or timed out.
 * @param hit - The facts of the hit.
 * @returns
 * - resume `breakpoint.react-copy` for a copy hit at an owned stop position
 * - resume `breakpoint.repeat-hit` for a later hit of a stop that already paused
 * - resume `breakpoint.other-route` (with the route) when the store's route is not the entry route
 * - pause `entry-load` (group 0) or `after-operation` (group k >= 1) when it is the entry route
 * - for an unreadable route: pause `unconfirmed` while the browser shows the entry route, else resume `breakpoint.unattributed-resumed` (D18)
 * @example
 * serverRenderHitVerdictOf({ isReactCopyAtOwnedStop: false, stopAlreadyPaused: false, renderedRoute: { state: 'read', route: '/dashboard' }, entryPattern: '/dashboard', browserOnEntryRoute: true, group: 0 }) // => { action: 'pause', attribution: 'entry-load' }
 */
export function serverRenderHitVerdictOf(
  hit: ServerRenderHit,
): ServerRenderHitVerdict {
  if (hit.isReactCopyAtOwnedStop)
    return { action: 'resume', event: 'breakpoint.react-copy' }
  if (hit.stopAlreadyPaused)
    return { action: 'resume', event: 'breakpoint.repeat-hit' }
  const { renderedRoute } = hit
  if (renderedRoute.state === 'read' && hit.entryPattern !== undefined)
    return renderedRoute.route === hit.entryPattern
      ? {
          action: 'pause',
          attribution: hit.group === 0 ? 'entry-load' : 'after-operation',
        }
      : {
          action: 'resume',
          event: 'breakpoint.other-route',
          route: renderedRoute.route,
        }
  // An unreadable route pauses only while the browser shows the entry route; a cached function of another route's render must not pause the learner.
  return hit.browserOnEntryRoute
    ? { action: 'pause', attribution: 'unconfirmed' }
    : { action: 'resume', event: 'breakpoint.unattributed-resumed' }
}

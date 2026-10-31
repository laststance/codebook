import { z } from 'zod'

import { REPOSITORY_PATH_LIMIT_CHARS } from '../constants'
import type { Cdp } from '../runtimeSupport/cdp'

/**
 * The page expression a Pages run evaluates for the page's path and Next router: `location.pathname`, whether `window.next.router` exists, whether it is ready, and its route. The page is untrusted, so the strings are cut in the page and only plain values come back.
 * Exported so a test's stand-in page can answer it.
 */
export const NEXT_PAGES_STATE_EXPRESSION = `(() => { const limit = ${REPOSITORY_PATH_LIMIT_CHARS}; const router = globalThis.next && globalThis.next.router; return { pathname: String(location.pathname).slice(0, limit), routerSeen: Boolean(router), isReady: Boolean(router) && router.isReady === true, route: router && typeof router.route === 'string' ? router.route.slice(0, limit) : undefined } })()`

const nextPagesStateSchema = z.object({
  pathname: z.string().max(REPOSITORY_PATH_LIMIT_CHARS),
  routerSeen: z.boolean(),
  isReady: z.boolean(),
  route: z.string().max(REPOSITORY_PATH_LIMIT_CHARS).optional(),
})

/** What one read of a Pages page found: its pathname and its Next router's presence, readiness and route. */
export type NextPagesState = z.infer<typeof nextPagesStateSchema>

/**
 * Reads the page's pathname and Next router once, for the Pages run's checks after the page loaded: the final path, the router-ready wait, the route match and the pathname check before the first input.
 *
 * Why it exists: a Pages page that redirected on the client, or whose router never became ready, must be refused before any input; `window.next.router` exposes `isReady` and `route` on a Pages page (Task 0). Called by the configured browser run; the expression is {@link NEXT_PAGES_STATE_EXPRESSION}.
 * @param cdp - The owned page's protocol channel.
 * @returns The page's state.
 * @throws When the page throws while it is read (a page script can make `window.next` throw) or answers another shape.
 * @example
 * await readNextPagesState(cdp) // => { pathname: '/', routerSeen: true, isReady: true, route: '/' }
 */
export async function readNextPagesState(
  cdp: Pick<Cdp, 'request'>,
): Promise<NextPagesState> {
  const response = await cdp.request('Runtime.evaluate', {
    expression: NEXT_PAGES_STATE_EXPRESSION,
    returnByValue: true,
  })
  const parsed = nextPagesStateSchema.safeParse(response.result.value)
  if (response.exceptionDetails || !parsed.success)
    throw new Error('The page path and Next router could not be read')
  return parsed.data
}

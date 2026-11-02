import type { ConfiguredRuntimeSnapshot } from '../runtime'

/** The attribution fields a server-render pause carries. */
export type ServerRenderAttribution = Pick<
  ConfiguredRuntimeSnapshot,
  'attribution' | 'operationIndex'
>

/**
 * Gives the attribution fields of a server-render pause from the group of its stop.
 * Why it exists: the page-load pause (group 0) carries no operation, every pause of group k >= 1 carries `operationIndex: k` (also when the rendered route could not be read), so the namer, the status and the validator never read a pause after an operation as a page load. Called by {@link ConfiguredBrowserRun} when it labels a pause.
 * @param group - The stop's `afterOperation` (0 for the entry render).
 * @param isUnconfirmed - True when the rendered route could not be read.
 * @returns `entry-load` for group 0, `after-operation` with the group for k >= 1, `unconfirmed` (with the group when k >= 1) when the route is unread.
 * @example
 * serverRenderAttributionOf(0, false) // => { attribution: 'entry-load' }
 * serverRenderAttributionOf(2, true) // => { attribution: 'unconfirmed', operationIndex: 2 }
 */
export function serverRenderAttributionOf(
  group: number,
  isUnconfirmed: boolean,
): ServerRenderAttribution {
  if (group === 0)
    return { attribution: isUnconfirmed ? 'unconfirmed' : 'entry-load' }
  return {
    attribution: isUnconfirmed ? 'unconfirmed' : 'after-operation',
    operationIndex: group,
  }
}

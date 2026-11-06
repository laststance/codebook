import type { ExtensionStopContext } from '../chromeExtensionContracts'

/**
 * Wraps a per-context discovery so each context is discovered once per run, however many of its stops are resolved.
 * Called by the extension source for the static loads (unpacked) and the mapped sources (`wxt-build`).
 * @param discover - Reads what one context loads.
 * @returns A function with the same answers that shares one promise per context.
 * @example
 * const loadsOf = memoizeByStopContext(discoverFor)
 * await loadsOf('page') === await loadsOf('page') // one discovery
 */
export function memoizeByStopContext<Value>(
  discover: (context: ExtensionStopContext) => Promise<Value>,
): (context: ExtensionStopContext) => Promise<Value> {
  const memo = new Map<ExtensionStopContext, Promise<Value>>()
  return (context) => {
    const known = memo.get(context)
    if (known) return known
    const discovered = discover(context)
    memo.set(context, discovered)
    return discovered
  }
}

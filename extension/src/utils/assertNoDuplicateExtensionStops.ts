import { posix } from 'node:path'

import type { ChromeExtensionConfiguration } from '../chromeExtensionConfigSchemas'
import { StudyError } from '../errors'

/**
 * Refuses two stops at the same path, line and context (SR5); a line may be declared once per context (ER21).
 * Called first by the extension source, so a duplicate is refused before any build starts.
 * @param stops - The declared stops, in declaration order.
 * @throws `STOP_DUPLICATE` with the 1-based indexes.
 * @example
 * assertNoDuplicateExtensionStops([stop, stop]) // throws 'Stops 1 and 2 are the same.'
 */
export function assertNoDuplicateExtensionStops(
  stops: ChromeExtensionConfiguration['stops'],
): void {
  const firstSeen = new Map<string, number>()
  stops.forEach((stop, position) => {
    const key = `${stop.context}\u0000${stop.line}\u0000${posix.normalize(stop.path)}`
    const earlier = firstSeen.get(key)
    if (earlier !== undefined)
      throw new StudyError(
        'STOP_DUPLICATE',
        `Stops ${earlier} and ${position + 1} are the same.`,
      )
    firstSeen.set(key, position + 1)
  })
}

import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas'

/**
 * Names the configuration fields that hold one declared stop's position and its anchor index, so every refusal an agent reads points at the field to change. Called by {@link describeCitationMismatch} and {@link describeColumnPastLineEnd} for the stop they refuse.
 * @param version - The configuration's version; a later stop is written differently in each.
 * @param stopIndex - Zero-based place of the stop in the order {@link configuredStops} gives.
 * @returns
 * - The first stop: `configuration.source` and `configuration.book.anchorIndex`
 * - A later stop of version 1: the entry `configuration.additionalStops[n]` itself, which holds its line and column, and the first stop's `configuration.book.anchorIndex`, which it shares
 * - A later stop of version 2: `configuration.additionalStops[n].source` and `configuration.additionalStops[n].anchorIndex`
 * @example
 * configuredStopFields(1, 0) // => { source: 'configuration.source', anchorIndex: 'configuration.book.anchorIndex' }
 * configuredStopFields(1, 2) // => { source: 'configuration.additionalStops[1]', anchorIndex: 'configuration.book.anchorIndex' }
 * configuredStopFields(2, 1) // => { source: 'configuration.additionalStops[0].source', anchorIndex: 'configuration.additionalStops[0].anchorIndex' }
 */
export function configuredStopFields(
  version: RetainedRepositoryConfiguration['version'],
  stopIndex: number,
): { source: string; anchorIndex: string } {
  const firstStop = {
    source: 'configuration.source',
    anchorIndex: 'configuration.book.anchorIndex',
  }
  if (stopIndex === 0) return firstStop
  // Later stops are named by their position in additionalStops.
  const additional = `configuration.additionalStops[${stopIndex - 1}]`
  if (version !== 2)
    return { source: additional, anchorIndex: firstStop.anchorIndex }
  return {
    source: `${additional}.source`,
    anchorIndex: `${additional}.anchorIndex`,
  }
}

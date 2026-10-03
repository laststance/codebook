import type { ConfiguredDescriptor } from '../configuredStudySchemas'
import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas'

import { configuredStops } from './configuredStops'

/**
 * Names the first declared stop whose anchor index does not select a citation containing its source line, so an agent can correct the index instead of guessing.
 * Called by {@link prepareRepositoryStudy} when {@link assertConfiguredDescriptor} refuses a start.
 * @param configuration - The start's configuration; its stops are expanded by {@link configuredStops}.
 * @param anchors - The selected node's citations, in the order `anchorIndex` counts them.
 * @returns
 * - A stop whose index is outside the node or selects a citation without its path:line: one sentence naming the field, the node's valid range 0..n-1 and the index whose citation covers that path:line (or that none does)
 * - Every stop inside its selected citation: undefined (the refusal has another cause)
 * @example
 * describeCitationMismatch(configuration, anchors)
 * // => 'configuration.book.anchorIndex 1 selects citation src/mode.ts:1-1, which does not contain configuration.source src/theme.ts:1. Node "theme" has citations 0..1; index 0 (src/theme.ts:1-1) covers src/theme.ts:1.'
 */
export function describeCitationMismatch(
  configuration: RetainedRepositoryConfiguration,
  anchors: ConfiguredDescriptor['anchors'],
): string | undefined {
  const stops = configuredStops(configuration)
  for (const [stopIndex, stop] of stops.entries()) {
    const { path, line } = stop.source
    const contains = (anchor: (typeof anchors)[number]): boolean =>
      anchor.path === path && line >= anchor.startLine && line <= anchor.endLine
    const selected = anchors[stop.anchorIndex]
    if (selected && contains(selected)) continue
    // The first stop is the top-level source; later stops are named by their position in additionalStops.
    const additional = `configuration.additionalStops[${stopIndex - 1}]`
    const sourceField =
      stopIndex === 0
        ? 'configuration.source'
        : configuration.version === 2
          ? `${additional}.source`
          : additional
    const indexField =
      stopIndex > 0 && configuration.version === 2
        ? `${additional}.anchorIndex`
        : 'configuration.book.anchorIndex'
    const position = `${path}:${line}`
    const selection = selected
      ? `${indexField} ${stop.anchorIndex} selects citation ${selected.path}:${selected.startLine}-${selected.endLine}, which does not contain ${sourceField} ${position}.`
      : `${indexField} ${stop.anchorIndex} is outside the selected node's citations.`
    const coveringIndex = anchors.findIndex(contains)
    const covering = anchors[coveringIndex]
    const remedy = covering
      ? `index ${coveringIndex} (${covering.path}:${covering.startLine}-${covering.endLine}) covers ${position}.`
      : `no citation covers ${position}; publish a revision that cites it or choose a cited line.`
    return `${selection} Node "${configuration.book.nodeId}" has citations 0..${anchors.length - 1}; ${remedy}`
  }
  return undefined
}

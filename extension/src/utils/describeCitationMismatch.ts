import type { ConfiguredDescriptor } from '../configuredStudySchemas'
import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas'

import { configuredStopFields } from './configuredStopFields'
import { configuredStops } from './configuredStops'

/**
 * Says whether a citation contains a source line; called by {@link describeCitationMismatch} for the citation a stop selects and by {@link describeStopOutsideCitation} to find the citation that covers the stop instead.
 * @param anchor - One citation of the selected node.
 * @param path - Repository path of the stop's source file.
 * @param line - The stop's declared line.
 * @returns
 * - `true` when the citation is of that file and its line range includes the line
 * - `false` otherwise
 * @example
 * isLineInCitation({ path: 'src/theme.ts', startLine: 1, endLine: 3 }, 'src/theme.ts', 2) // => true
 */
function isLineInCitation(
  anchor: ConfiguredDescriptor['anchors'][number],
  path: string,
  line: number,
): boolean {
  return (
    anchor.path === path && line >= anchor.startLine && line <= anchor.endLine
  )
}

/**
 * Words the sentence for one declared stop that lies outside the citation its anchor index selects; called by {@link describeCitationMismatch} for the first such stop.
 * @param configuration - The start's configuration; it gives the field names of the stop and the node's id.
 * @param anchors - The selected node's citations, in the order `anchorIndex` counts them.
 * @param stopIndex - The stop's place among the configured stops, by which {@link configuredStopFields} names its fields.
 * @param stop - The declared stop.
 * @returns One sentence naming the field, what the index selects (or that it is outside the node's citations), the node's valid range 0..n-1 and the index whose citation covers the stop's path:line (or that none does).
 * @example
 * describeStopOutsideCitation(configuration, anchors, 0, stop)
 * // => 'configuration.book.anchorIndex 1 selects citation src/mode.ts:1-1, which does not contain configuration.source src/theme.ts:1. Node "theme" has citations 0..1; index 0 (src/theme.ts:1-1) covers src/theme.ts:1.'
 */
function describeStopOutsideCitation(
  configuration: RetainedRepositoryConfiguration,
  anchors: ConfiguredDescriptor['anchors'],
  stopIndex: number,
  stop: ReturnType<typeof configuredStops>[number],
): string {
  const { path, line } = stop.source
  const selected = anchors[stop.anchorIndex]
  const { source: sourceField, anchorIndex: indexField } = configuredStopFields(
    configuration.version,
    stopIndex,
  )
  const position = `${path}:${line}`
  const selection = selected
    ? `${indexField} ${stop.anchorIndex} selects citation ${selected.path}:${selected.startLine}-${selected.endLine}, which does not contain ${sourceField} ${position}.`
    : `${indexField} ${stop.anchorIndex} is outside the selected node's citations.`
  const coveringIndex = anchors.findIndex((anchor) =>
    isLineInCitation(anchor, path, line),
  )
  const covering = anchors[coveringIndex]
  const remedy = covering
    ? `index ${coveringIndex} (${covering.path}:${covering.startLine}-${covering.endLine}) covers ${position}.`
    : `no citation covers ${position}; publish a revision that cites it or choose a cited line.`
  return `${selection} Node "${configuration.book.nodeId}" has citations 0..${anchors.length - 1}; ${remedy}`
}

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
    const selected = anchors[stop.anchorIndex]
    if (selected && isLineInCitation(selected, path, line)) continue
    return describeStopOutsideCitation(configuration, anchors, stopIndex, stop)
  }
  return undefined
}

import type { ConfiguredDescriptor } from '../configuredStudySchemas'

import type { CitedStopMismatch } from './assertConfiguredDescriptor'

/**
 * Words the refusal of a node-test stop whose declared position does not fit its retained citation: which stop, which anchor, the cited path and lines, which condition failed, and what to send instead; called by {@link prepareNodeTestStudy} with the condition {@link assertCitedSourceStops} found, so the chat does not have to guess among them.
 * @param label - The stop as the configuration names it: `source`, or `additionalStops[n]`.
 * @param mismatch - The condition that failed.
 * @param position - What the stop sent.
 * @param anchorIndex - The anchor the stop selected.
 * @param descriptor - The article node's retained citations and sources.
 * @returns The sentence, which starts with `node-test preparation refused:` as the other preparation refusals do.
 * @example
 * describeCitedStopMismatch('source', 'line', { path: 'src/theme.ts', hash, line: 2, column: 1 }, 0, descriptor)
 * // => 'node-test preparation refused: source sends line 2, but anchorIndex 0 cites src/theme.ts lines 1 to 1 only. Send a line from 1 to 1.'
 */
export function describeCitedStopMismatch(
  label: string,
  mismatch: CitedStopMismatch,
  position: { path: string; hash: string; line: number; column: number },
  anchorIndex: number,
  descriptor: Pick<ConfiguredDescriptor, 'anchors' | 'sources'>,
): string {
  const opening = `node-test preparation refused: ${label}`
  const anchor = descriptor.anchors[anchorIndex]
  if (mismatch === 'anchor' || !anchor) {
    return `${opening} uses anchorIndex ${anchorIndex}, but the article node cites ${citedRanges(descriptor.anchors.length)}. Send the anchorIndex of the citation that covers the stop.`
  }
  const cited = `anchorIndex ${anchorIndex} cites ${anchor.path} lines ${anchor.startLine} to ${anchor.endLine}`
  switch (mismatch) {
    case 'path':
      return `${opening} cites ${position.path}, but ${cited}. Send ${anchor.path}, or the anchorIndex of the citation of ${position.path}.`
    case 'hash':
      return `${opening} sends SHA-256 ${position.hash} for ${position.path}, but ${cited} with SHA-256 ${anchor.hash}. Read the file with codebook_source and send its current hash; publish the article again if the file changed.`
    case 'line':
      return `${opening} sends line ${position.line}, but ${cited} only. Send a line from ${anchor.startLine} to ${anchor.endLine}.`
    case 'column': {
      const text = descriptor.sources.find(
        (source) => source.path === anchor.path,
      )?.text
      const length = text?.split(/\r\n|\r|\n/)[position.line - 1]?.length ?? 0
      return `${opening} sends column ${position.column} on line ${position.line} of ${anchor.path}, but that line has ${length} characters, so the last column is ${length + 1}. Send a column from 1 to ${length + 1}.`
    }
  }
}

/**
 * Names how many source ranges an article node cites, for the anchorIndex refusal of {@link describeCitedStopMismatch}: none, one, or a count with its index range (F242).
 * @param count - The number of the node's citations.
 * @returns The phrase that follows "the article node cites".
 * @example citedRanges(1) // => 'one source range (anchorIndex 0)'
 */
function citedRanges(count: number): string {
  if (count === 0) return 'no source range'
  if (count === 1) return 'one source range (anchorIndex 0)'
  return `${count} source ranges (anchorIndex 0 to ${count - 1})`
}

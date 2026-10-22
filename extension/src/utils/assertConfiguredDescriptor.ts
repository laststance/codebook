import type { ConfiguredDescriptor } from '../configuredStudySchemas'
import { REPOSITORY_SOURCE_LIMIT_BYTES } from '../constants'
import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { citationContext } from './citationContext'
import { configuredStops } from './configuredStops'
import { takenStopPosition } from './takenStopPosition'

/**
 * Pins all copied citations and selected coordinates of a repository-browser start for preparation ({@link prepareRepositoryStudy}), the run ({@link ConfiguredBrowserRun}) and retained evidence readers.
 * A stop declared on a blank line is checked at the position it is taken at ({@link takenStopPosition}): any column there means the line, so only a column past the end of a line with characters is refused.
 * @param configuration - The start's configuration.
 * @param descriptor - The selected node's citations and retained sources.
 * @throws When the learning item, a citation, a source or a stop's position does not match; the message names the rule, and the caller words the agent's sentence.
 * @example
 * assertConfiguredDescriptor(configuration, descriptor) // rejects an out-of-citation position
 */
export function assertConfiguredDescriptor(
  configuration: RetainedRepositoryConfiguration,
  descriptor: ConfiguredDescriptor,
): void {
  if (
    descriptor.itemId !==
    `repository/${configuration.book.bookId}/${configuration.book.nodeId}`
  )
    throw new Error('Configured learning item changed.')
  assertCitedSourceStops(
    descriptor,
    configuredStops(configuration).map((stop) => ({
      ...stop,
      source: takenStopPosition(stop.source, descriptor.sources),
    })),
  )
}

/** The condition of a stop's position that failed against its selected citation: the anchor does not exist, the path or the hash differs from the anchor's, the line lies outside its range, or the column lies past the line's end. */
export type CitedStopMismatch = 'anchor' | 'path' | 'hash' | 'line' | 'column'

/**
 * Marks a stop whose position differs from its selected citation, with the stop and the condition that failed; {@link assertCitedSourceStops} throws it with the browser profile's unchanged message, and {@link prepareNodeTestStudy} words it for the test agent through {@link describeCitedStopMismatch}.
 * @example throw new CitedStopMismatchError(1, 'column') // stop 1 of the stops that were checked
 */
export class CitedStopMismatchError extends Error {
  constructor(
    readonly stopIndex: number,
    readonly mismatch: CitedStopMismatch,
  ) {
    super('Configured position differs from its selected citation.')
  }
}

/** Validates immutable article source bytes and every stop against its selected citation across runtime adapters. Called by {@link assertConfiguredDescriptor} and Node preparation. @example assertCitedSourceStops(descriptor, [{source,anchorIndex:0}]) */
export function assertCitedSourceStops(
  descriptor: ConfiguredDescriptor,
  stops: ReadonlyArray<{
    source: { path: string; hash: string; line: number; column: number }
    anchorIndex: number
  }>,
): void {
  if (
    JSON.stringify(descriptor.citationContext) !==
    JSON.stringify(citationContext(descriptor.anchors))
  )
    throw new Error('Configured complete citation context changed.')
  const sources = new Map(
      descriptor.sources.map((source) => [source.path, source]),
    ),
    cited = new Set<string>()
  if (sources.size !== descriptor.sources.length)
    throw new Error('Configured descriptor has duplicate source paths.')
  for (const source of sources.values()) {
    if (
      Buffer.byteLength(source.text) > REPOSITORY_SOURCE_LIMIT_BYTES ||
      sha256(source.text) !== source.hash ||
      source.text.split(/\r\n|\r|\n/).length !== source.lineCount
    )
      throw new Error('Configured descriptor source bytes changed.')
  }
  for (const anchor of descriptor.anchors) {
    const source = sources.get(anchor.path)
    if (
      !source ||
      source.hash !== anchor.hash ||
      anchor.endLine > source.lineCount
    )
      throw new Error('Configured citation has no exact retained source.')
    cited.add(anchor.path)
  }
  if (cited.size !== sources.size)
    throw new Error('Configured descriptor has uncited sources.')
  for (const [stopIndex, stop] of stops.entries()) {
    const mismatch = citedStopMismatch(
      stop.source,
      descriptor.anchors[stop.anchorIndex],
      sources.get(stop.source.path),
    )
    if (mismatch) throw new CitedStopMismatchError(stopIndex, mismatch)
  }
}

/**
 * Finds the first condition a stop's position fails against its selected citation, in the order an agent fixes them: anchor, path, hash, line, column; called by {@link assertCitedSourceStops} for each stop.
 * @param position - What the stop sent.
 * @param anchor - The citation the stop selected; `undefined` when its `anchorIndex` names none.
 * @param source - The retained source at the stop's path; `undefined` when the article keeps none.
 * @returns The failed condition, or `undefined` when the position fits its citation.
 * @example citedStopMismatch({ path: 'a.ts', hash, line: 9, column: 1 }, anchorOfLines1To3, source) // => 'line'
 */
function citedStopMismatch(
  position: { path: string; hash: string; line: number; column: number },
  anchor: ConfiguredDescriptor['anchors'][number] | undefined,
  source: ConfiguredDescriptor['sources'][number] | undefined,
): CitedStopMismatch | undefined {
  if (!anchor) return 'anchor'
  if (!source || anchor.path !== position.path) return 'path'
  if (source.hash !== position.hash || anchor.hash !== position.hash)
    return 'hash'
  const selectedLine = source.text.split(/\r\n|\r|\n/)[position.line - 1]
  if (
    position.line < anchor.startLine ||
    position.line > anchor.endLine ||
    selectedLine === undefined
  )
    return 'line'
  return position.column > selectedLine.length + 1 ? 'column' : undefined
}

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
  for (const stop of stops) {
    const position = stop.source
    const anchor = descriptor.anchors[stop.anchorIndex],
      source = sources.get(position.path)
    const selectedLine = source?.text.split(/\r\n|\r|\n/)[position.line - 1]
    if (
      !anchor ||
      !source ||
      source.hash !== position.hash ||
      anchor.path !== position.path ||
      anchor.hash !== position.hash ||
      position.line < anchor.startLine ||
      position.line > anchor.endLine ||
      selectedLine === undefined ||
      position.column > selectedLine.length + 1
    )
      throw new Error('Configured position differs from its selected citation.')
  }
}

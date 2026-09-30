import { configuredStops } from './configuredStops'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { REPOSITORY_SOURCE_LIMIT_BYTES } from '../constants'
import type { ConfiguredDescriptor } from '../configuredStudySchemas'
import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas'
import { citationContext } from './citationContext'

/** Pins all copied citations and selected coordinates for preparation and retained evidence readers. @example assertConfiguredDescriptor(configuration, descriptor) // rejects an out-of-citation position */
export function assertConfiguredDescriptor(
  configuration: RetainedRepositoryConfiguration,
  descriptor: ConfiguredDescriptor,
): void {
  if (
    descriptor.itemId !==
    `repository/${configuration.book.bookId}/${configuration.book.nodeId}`
  )
    throw new Error('Configured learning item changed.')
  assertCitedSourceStops(descriptor, configuredStops(configuration))
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

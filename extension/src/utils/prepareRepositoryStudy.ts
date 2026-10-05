import {
  configuredDefinitionSchema,
  type ConfiguredDefinition,
  type ConfiguredDescriptor,
} from '../configuredStudySchemas'
import { StudyError } from '../errors'
import type { RepositoryBookStore } from '../repositoryBook'
import {
  retainedRepositoryConfigSchema,
  type RetainedRepositoryConfiguration,
} from '../repositoryConfigSchemas'
import type { RepositorySourceService } from '../repositorySource'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { assertConfiguredDescriptor } from './assertConfiguredDescriptor'
import { citationContext } from './citationContext'
import { describeCitationMismatch } from './describeCitationMismatch'
import { describeColumnPastLineEnd } from './describeColumnPastLineEnd'
import { describeMissingBookNode } from './describeMissingBookNode'

/**
 * Words why a start's declared stops were refused, so an agent can correct the one field that is wrong; called by {@link prepareRepositoryStudy} when {@link assertConfiguredDescriptor} refuses a start.
 * @param configuration - The start's configuration.
 * @param anchors - The selected node's citations, in the order `anchorIndex` counts them.
 * @param sources - The selected node's retained sources.
 * @returns
 * - An index that selects the wrong citation: the sentence of {@link describeCitationMismatch}, with the valid range and the covering index
 * - Otherwise a column past its line's end: the sentence of {@link describeColumnPastLineEnd}, with the line's length
 * - Any other refusal: the rule text
 * @example
 * describeDescriptorRefusal(configuration, anchors, sources)
 * // => 'configuration.source.column 100 lies past the end of its line: src/theme.ts:1 has a length of 25, so the highest column accepted is 26. Declare a column from 1 to 26.'
 */
function describeDescriptorRefusal(
  configuration: RetainedRepositoryConfiguration,
  anchors: ConfiguredDescriptor['anchors'],
  sources: ConfiguredDescriptor['sources'],
): string {
  return (
    describeCitationMismatch(configuration, anchors) ??
    describeColumnPastLineEnd(configuration, sources) ??
    'configuration.source and configuration.book.anchorIndex must identify a valid position in the same captured citation.'
  )
}

/** Binds an already reserved start to immutable article/source identity before a runtime can acquire or dispatch input. @example await prepareRepositoryStudy(configuration, books, { signal, deadlineAt }) */
export async function prepareRepositoryStudy(
  input: RetainedRepositoryConfiguration,
  books: RepositoryBookStore,
  control: Required<
    NonNullable<Parameters<RepositorySourceService['prepare']>[1]>
  >,
  now = Date.now,
): Promise<ConfiguredDefinition> {
  const assertActive = (): void => {
    if (control.signal.aborted || now() >= control.deadlineAt)
      throw new StudyError(
        'RUNTIME_FAILED',
        'Repository preparation expired or was cancelled before application input.',
      )
  }
  assertActive()
  const configuration = retainedRepositoryConfigSchema.parse(input),
    selected = await books.readDefinition(
      configuration.book.bookId,
      configuration.book.revision,
    )
  assertActive()
  const node = selected.revision.document.nodes.find(
    (node) => node.id === configuration.book.nodeId,
  )
  if (!node)
    throw new StudyError(
      'BOOK_UNAVAILABLE',
      describeMissingBookNode(
        configuration.book,
        selected.revision.document.nodes.map((candidate) => candidate.id),
      ),
    )
  if (node.learningItemId !== undefined)
    throw new StudyError(
      'INVALID_CONFIGURATION',
      'configuration.book.nodeId must retain its default repository identity; a foreign learning identity cannot become a configured study.',
    )
  const paths = new Set(node.anchors.map((anchor) => anchor.path))
  const definition = configuredDefinitionSchema.parse({
    configuration,
    configurationHash: sha256(JSON.stringify(configuration)),
    descriptor: {
      itemId: `repository/${configuration.book.bookId}/${node.id}`,
      bookTitle: selected.revision.document.title,
      nodeTitle: node.title,
      anchors: node.anchors,
      citationContext: citationContext(node.anchors),
      sources: selected.revision.sources.filter((source) =>
        paths.has(source.path),
      ),
    },
  })
  try {
    assertConfiguredDescriptor(configuration, definition.descriptor)
  } catch (error) {
    // An index that selects the wrong citation is named with the valid range and the covering index, and a column past its line's end with the line's length; other refusals keep the rule text.
    throw new StudyError(
      'INVALID_CONFIGURATION',
      describeDescriptorRefusal(
        configuration,
        node.anchors,
        definition.descriptor.sources,
      ),
      String(error),
    )
  }
  // All citations must still match their retained bytes; checking only the selected file would lose article understanding identity.
  const prepared = await books.sources.prepare(node.anchors, control)
  await prepared.revalidate()
  await prepared.verifyIdentities()
  assertActive()
  return definition
}

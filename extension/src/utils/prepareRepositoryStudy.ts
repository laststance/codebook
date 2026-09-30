import { sha256 } from '../runtimeSupport/utils/sha256'
import {
  configuredDefinitionSchema,
  type ConfiguredDefinition,
} from '../configuredStudySchemas'
import {
  retainedRepositoryConfigSchema,
  type RetainedRepositoryConfiguration,
} from '../repositoryConfigSchemas'
import type { RepositoryBookStore } from '../repositoryBook'
import type { RepositorySourceService } from '../repositorySource'
import { StudyError } from '../errors'
import { assertConfiguredDescriptor } from './assertConfiguredDescriptor'
import { citationContext } from './citationContext'

/** Binds an already reserved start to immutable article/source identity before a runtime can acquire or dispatch input. @example await prepareRepositoryStudy(configuration, books, { signal, deadlineAt }) */
export async function prepareRepositoryStudy(
  input: RetainedRepositoryConfiguration,
  books: RepositoryBookStore,
  control: Required<
    NonNullable<Parameters<RepositorySourceService['prepare']>[1]>
  >,
  now = Date.now,
): Promise<ConfiguredDefinition> {
  const assertActive = () => {
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
      'configuration.book.nodeId does not exist in the exact selected revision.',
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
    throw new StudyError(
      'INVALID_CONFIGURATION',
      'configuration.source and configuration.book.anchorIndex must identify a valid position in the same captured citation.',
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

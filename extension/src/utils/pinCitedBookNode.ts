import { configuredDescriptorSchema } from '../configuredStudySchemas'
import { StudyError } from '../errors'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'
import type { RepositoryBookStore } from '../repositoryBook'
import type { RepositorySourceService } from '../repositorySource'

import {
  assertCitedSourceStops,
  CitedStopMismatchError,
} from './assertConfiguredDescriptor'
import { citationContext } from './citationContext'
import { describeCitedStopMismatch } from './describeCitedStopMismatch'
import { describeMissingBookNode } from './describeMissingBookNode'

/** What a profile that stops in cited source declares of its book and stops: the shape node-test and node-server share. */
export type CitedStopDeclaration = Pick<
  NodeTestConfiguration,
  'book' | 'source' | 'additionalStops'
>

/**
 * Pins the declared stops of a Node run to the exact retained article revision before anything is launched: reads the book node, checks that every stop identifies an exact position in a citation of that node, and verifies the cited files still have the retained hashes.
 * Called by {@link prepareNodeTestStudy} and {@link prepareNodeServerStudy} during their profile's preparation.
 * @param configuration - The validated declaration of the run.
 * @param books - The workspace's retained articles.
 * @param control - Shared cancellation and preparation deadline.
 * @param subject - How the profile's refusals name the run, `Node test` or `Node server`.
 * @param assertActive - Throws when the preparation expired or was cancelled; called after each awaited read.
 * @returns The article node's descriptor with its cited sources at the retained revision.
 * @throws `BOOK_UNAVAILABLE` for a missing node, `INVALID_CONFIGURATION` for a node with another identity or a stop that is no exact position of a citation, the source service's refusals for a changed file.
 * @example
 * const descriptor = await pinCitedBookNode(config, books, control, 'Node server', assertActive)
 */
export async function pinCitedBookNode(
  configuration: CitedStopDeclaration,
  books: RepositoryBookStore,
  control: Required<
    NonNullable<Parameters<RepositorySourceService['prepare']>[1]>
  >,
  subject: 'Node test' | 'Node server',
  assertActive: () => void,
) {
  const selected = await books.readDefinition(
    configuration.book.bookId,
    configuration.book.revision,
  )
  assertActive()
  const node = selected.revision.document.nodes.find(
    (candidate) => candidate.id === configuration.book.nodeId,
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
      `${subject} book node must retain its default repository identity.`,
    )
  const paths = new Set(node.anchors.map((anchor) => anchor.path))
  const descriptor = configuredDescriptorSchema.parse({
    itemId: `repository/${configuration.book.bookId}/${node.id}`,
    bookTitle: selected.revision.document.title,
    nodeTitle: node.title,
    anchors: node.anchors,
    citationContext: citationContext(node.anchors),
    sources: selected.revision.sources.filter((source) =>
      paths.has(source.path),
    ),
  })
  const declaredStops = [
    {
      label: 'source',
      source: configuration.source,
      anchorIndex: configuration.book.anchorIndex,
    },
    ...(configuration.additionalStops ?? []).map((stop, index) => ({
      label: `additionalStops[${index}]`,
      source: stop,
      anchorIndex: stop.anchorIndex,
    })),
  ]
  try {
    assertCitedSourceStops(descriptor, declaredStops)
  } catch (error) {
    const declared =
      error instanceof CitedStopMismatchError
        ? declaredStops[error.stopIndex]
        : undefined
    // Name the stop, its anchor and the failed condition, so the chat does not guess among them (inventory row 14, D17).
    throw new StudyError(
      'INVALID_CONFIGURATION',
      error instanceof CitedStopMismatchError && declared
        ? describeCitedStopMismatch(
            declared.label,
            error.mismatch,
            declared.source,
            declared.anchorIndex,
            descriptor,
          )
        : `${subject} stops must identify exact positions in their retained citations.`,
      String(error),
    )
  }
  const prepared = await books.sources.prepare(node.anchors, control)
  await prepared.revalidate()
  await prepared.verifyIdentities()
  assertActive()
  return descriptor
}

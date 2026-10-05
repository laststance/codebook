import { MISSING_BOOK_NODE_IDS_NAMED_LIMIT } from '../constants'

/**
 * Words the refusal of a start whose `configuration.book.nodeId` is not a node of the book revision it selected, so an agent sees which nodes that revision has and the two ways on; called by {@link StudyService.startOnStoredBook} before a run is accepted, and by {@link prepareRepositoryStudy} and {@link prepareNodeTestStudy} for a run that reaches preparation.
 * @param book - The start's book selection: the book id, the revision and the node id it named.
 * @param nodeIds - The ids of the nodes of that revision, in document order (a revision holds at least one).
 * @returns The sentence: the field with the node id, the revision and the book, the revision's node ids (at most {@link MISSING_BOOK_NODE_IDS_NAMED_LIMIT}, then how many it has), and the next step.
 * @example
 * describeMissingBookNode({ bookId: 'interface', revision: 2, nodeId: 'mode' }, ['theme'])
 * // => 'configuration.book.nodeId mode does not exist in revision 2 of book interface, which has the node: theme. Use it, or publish your own document under its own book id and start on that revision.'
 */
export function describeMissingBookNode(
  book: { bookId: string; revision: number; nodeId: string },
  nodeIds: readonly string[],
): string {
  const named = nodeIds.slice(0, MISSING_BOOK_NODE_IDS_NAMED_LIMIT).join(', ')
  // One node is named as such, a few are listed, and a longer list is cut and counted.
  const nodes =
    nodeIds.length === 1
      ? `the node: ${named}. Use it`
      : nodeIds.length <= MISSING_BOOK_NODE_IDS_NAMED_LIMIT
        ? `the nodes: ${named}. Use one of them`
        : `${nodeIds.length} nodes, among them: ${named}. Use one of them`
  return `configuration.book.nodeId ${book.nodeId} does not exist in revision ${book.revision} of book ${book.bookId}, which has ${nodes}, or publish your own document under its own book id and start on that revision.`
}

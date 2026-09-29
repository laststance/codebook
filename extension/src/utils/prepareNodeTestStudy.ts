import { configuredDescriptorSchema } from '../configuredStudySchemas';
import { nodeTestConfigSchema, type NodeTestConfiguration } from '../nodeTestConfigSchemas';
import type { RepositoryBookStore } from '../repositoryBook';
import type { RepositorySourceService } from '../repositorySource';
import { sha256 } from '../runtimeSupport/utils/sha256';
import { StudyError } from '../errors';
import { assertCitedSourceStops } from './assertConfiguredDescriptor';
import { citationContext } from './citationContext';

/** Pins a Node test's checked source stops to the exact retained article revision before an owned test can launch. Called during Node profile preparation. @param input - Validated test and citation intent. @param books - Current workspace's retained articles. @param control - Shared cancellation and preparation deadline. @example await prepareNodeTestStudy(config, books, { signal, deadlineAt }) */
export async function prepareNodeTestStudy(input: NodeTestConfiguration, books: RepositoryBookStore,
  control: Required<NonNullable<Parameters<RepositorySourceService['prepare']>[1]>>, now = Date.now) {
  const assertActive = () => {
    if (control.signal.aborted || now() >= control.deadlineAt) throw new StudyError('RUNTIME_FAILED', 'Node test preparation expired or was cancelled before test input.');
  };
  assertActive();
  const configuration = nodeTestConfigSchema.parse(input);
  const selected = await books.readDefinition(configuration.book.bookId, configuration.book.revision);
  assertActive();
  const node = selected.revision.document.nodes.find(candidate => candidate.id === configuration.book.nodeId);
  if (!node) throw new StudyError('BOOK_UNAVAILABLE', 'configuration.book.nodeId does not exist in the exact selected revision.');
  if (node.learningItemId !== undefined) throw new StudyError('INVALID_CONFIGURATION', 'Node test book node must retain its default repository identity.');
  const paths = new Set(node.anchors.map(anchor => anchor.path));
  const descriptor = configuredDescriptorSchema.parse({
    itemId: `repository/${configuration.book.bookId}/${node.id}`,
    bookTitle: selected.revision.document.title, nodeTitle: node.title,
    anchors: node.anchors, citationContext: citationContext(node.anchors),
    sources: selected.revision.sources.filter(source => paths.has(source.path)),
  });
  try {
    assertCitedSourceStops(descriptor, [
      { source: configuration.source, anchorIndex: configuration.book.anchorIndex },
      ...(configuration.additionalStops ?? []).map(stop => ({ source: stop, anchorIndex: stop.anchorIndex })),
    ]);
  } catch (error) {
    throw new StudyError('INVALID_CONFIGURATION', 'Node test stops must identify exact positions in their retained citations.', String(error));
  }
  const prepared = await books.sources.prepare(node.anchors, control);
  await prepared.revalidate(); await prepared.verifyIdentities(); assertActive();
  return { configuration, configurationHash: sha256(JSON.stringify(configuration)), descriptor };
}

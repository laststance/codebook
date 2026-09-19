import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { REPOSITORY_SOURCE_LIMIT_BYTES } from '../constants';
import type { ConfiguredDescriptor } from '../configuredStudySchemas';
import type { RepositoryConfiguration } from '../repositoryConfigSchemas';
import { citationContext } from './citationContext';

/** Pins all copied citations and selected coordinates for preparation and retained evidence readers. @example assertConfiguredDescriptor(configuration, descriptor) // rejects an out-of-citation position */
export function assertConfiguredDescriptor(configuration: RepositoryConfiguration, descriptor: ConfiguredDescriptor): void {
  if (descriptor.itemId !== `repository/${configuration.book.bookId}/${configuration.book.nodeId}`) throw new Error('Configured learning item changed.');
  if (JSON.stringify(descriptor.citationContext) !== JSON.stringify(citationContext(descriptor.anchors))) throw new Error('Configured complete citation context changed.');
  const sources = new Map(descriptor.sources.map(source => [source.path, source])), cited = new Set<string>();
  if (sources.size !== descriptor.sources.length) throw new Error('Configured descriptor has duplicate source paths.');
  for (const source of sources.values()) {
    if (Buffer.byteLength(source.text) > REPOSITORY_SOURCE_LIMIT_BYTES || sha256(source.text) !== source.hash || source.text.split(/\r\n|\r|\n/).length !== source.lineCount) throw new Error('Configured descriptor source bytes changed.');
  }
  for (const anchor of descriptor.anchors) {
    const source = sources.get(anchor.path);
    if (!source || source.hash !== anchor.hash || anchor.endLine > source.lineCount) throw new Error('Configured citation has no exact retained source.');
    cited.add(anchor.path);
  }
  if (cited.size !== sources.size) throw new Error('Configured descriptor has uncited sources.');
  const anchor = descriptor.anchors[configuration.book.anchorIndex], source = sources.get(configuration.source.path);
  const selectedLine = source?.text.split(/\r\n|\r|\n/)[configuration.source.line - 1];
  if (!anchor || !source || source.hash !== configuration.source.hash || anchor.path !== configuration.source.path || anchor.hash !== configuration.source.hash || configuration.source.line < anchor.startLine || configuration.source.line > anchor.endLine || selectedLine === undefined || configuration.source.column > selectedLine.length + 1) throw new Error('Configured position differs from its selected citation.');
}

import { StudyError } from '../errors';
import type { StudyService } from '../service';
import type { ResourceContent } from '../resources';

/** Resolves canonical instance-owned book history and copied source without substituting current or latest content. @example await readRepositoryResource(service, bookUri) */
export async function readRepositoryResource(service: StudyService, uri: string): Promise<ResourceContent> {
  const url = new URL(uri), store = service.repositoryStore(url.hostname);
  if (url.toString() !== uri || url.protocol !== 'codebook:' || url.search || url.hash || url.username || url.password || url.port) throw new StudyError('INVALID_REFERENCE', 'Use a returned canonical repository URI.');
  const json = (value: unknown): ResourceContent => ({ uri, mimeType: 'application/json', text: JSON.stringify(value) });
  const bookUri = (bookId: string, revision: number) => `codebook://${service.instanceId}/books/${bookId}/${revision}`;
  if (url.pathname === '/repository') return json({ instanceId: service.instanceId, workspaceKey: store.library.workspaceKey,
    books: (await store.list()).map(book => ({ ...book, uri: book.revision ? bookUri(book.bookId, book.revision) : undefined, revisions: book.revisions?.map(revision => ({ revision, uri: bookUri(book.bookId, revision) })) })),
    helpUri: 'codebook://help/repository', qualification: 'Storage validation only; read the exact revision to verify each retained observation link. Authored relationships are source interpretation, never observed execution.' });
  const match = /^\/books\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\/([1-9]\d*)(?:\/sources\/(0|[1-9]\d*))?$/.exec(url.pathname);
  if (!match?.[1] || !match[2] || !Number.isSafeInteger(Number(match[2])) || (match[3] !== undefined && !Number.isSafeInteger(Number(match[3])))) throw new StudyError('INVALID_REFERENCE', 'Unknown repository resource; copy a returned URI.');
  const book = await store.read(match[1], Number(match[2])); service.repositoryStore(url.hostname);
  if (match[3] !== undefined) {
    const source = book.revision.sources[Number(match[3])];
    if (!source) throw new StudyError('INVALID_REFERENCE', 'No cited source with this index in the selected revision.');
    return { uri, mimeType: 'text/plain', text: source.text };
  }
  return json({ ...book, revision: { ...book.revision, sources: book.revision.sources.map(({ text: _text, ...source }, index) => ({ ...source, uri: `${bookUri(book.bookId, book.revision.revision)}/sources/${index}` })) },
    interpretation: 'Source-derived · Agent interpretation', sourceCheckScope: 'Per-file acquisition/check times; never an atomic whole-workspace snapshot.' });
}

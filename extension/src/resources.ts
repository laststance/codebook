import { join } from 'node:path';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { CAPTURE_PHASES, EVENT_DETAIL_LIMIT_BYTES, EVENT_PAGE_SIZE, IMAGE_LIMIT_BYTES, SOURCE_LIMIT_BYTES } from './constants';
import { ERROR_RECOVERY, StudyError } from './errors';
import type { StudyService } from './service';
import { omittedDetail } from './utils/omittedDetail';
import { readBoundedFile } from './utils/readBoundedFile';

export type ResourceContent = { uri: string; mimeType: string; text: string } | { uri: string; mimeType: string; blob: string };

/** Resolves only canonical instance/run resources, preserving historical captured bytes after runtime exit. @example await readResource(service, runUri) */
export async function readResource(service: StudyService, uri: string): Promise<ResourceContent> {
  const json = (value: unknown): ResourceContent => ({ uri, mimeType: 'application/json', text: JSON.stringify(value) });
  if (uri === 'codebook://help/errors') return json(ERROR_RECOVERY);
  const url = new URL(uri);
  if (url.protocol !== 'codebook:' || url.search || url.hash || url.username || url.password || url.port) throw new StudyError('INVALID_REFERENCE', 'Use a canonical resource URI.');
  const match = /^\/runs\/([a-f0-9-]+)(?:\/(.*))?$/.exec(url.pathname);
  if (!match?.[1]) throw new StudyError('NOT_FOUND', 'Unknown resource.');
  const record = service.record({ instanceId: url.hostname, runId: match[1] }); const suffix = match[2];
  if (!suffix) return json(service.state(record));
  if (suffix.startsWith('events/')) {
    const cursorText = suffix.slice('events/'.length);
    if (!/^(0|[1-9]\d*)$/.test(cursorText) || !Number.isSafeInteger(Number(cursorText))) throw new StudyError('INVALID_REFERENCE', 'Event cursor must be a nonnegative sequence number.');
    const cursor = Number(cursorText), events = record.runtime?.view().events ?? [];
    const page = events.filter(event => event.sequence > cursor).slice(0, EVENT_PAGE_SIZE);
    const last = page.at(-1)?.sequence ?? cursor;
    return json({ events: page.map(event => ({ ...event, detail: Buffer.byteLength(JSON.stringify(event.detail)) > EVENT_DETAIL_LIMIT_BYTES ? omittedDetail(event.detail) : event.detail })),
      nextUri: events.some(event => event.sequence > last) ? service.uri(record.id, `events/${last}`) : undefined, afterSequence: cursor, lastSequence: last });
  }
  if (suffix.startsWith('explanations/')) {
    const explanation = record.explanations.get(suffix.slice('explanations/'.length));
    if (!explanation) throw new StudyError('NOT_FOUND', 'No committed explanation with that ID.');
    return json(explanation);
  }
  if (suffix.startsWith('images/')) {
    const phase = CAPTURE_PHASES.find(value => `images/${value}` === suffix);
    if (!phase || !record.runtime || record.runtime.view().captures[phase]?.status !== 'captured') throw new StudyError('EVIDENCE_UNAVAILABLE', 'The requested phase has no confirmed image.');
    const bytes = await readBoundedFile(join(record.runtime.evidence.directory, `${phase}.png`), IMAGE_LIMIT_BYTES);
    return { uri, mimeType: 'image/png', blob: bytes.toString('base64') };
  }
  const sourceMatch = /^(snapshots\/[^/]+)(?:\/source\/(typescript|javascript|map))?$/.exec(suffix);
  if (sourceMatch?.[1]) {
    const snapshotUri = service.uri(record.id, sourceMatch[1]); const snapshot = service.snapshot(record, snapshotUri);
    if (!sourceMatch[2]) return json({ ...snapshot, snapshotUri, historical: true, sourceUri: `${snapshotUri}/source/typescript` });
    const source = record.runtime?.source(snapshot.participant);
    if (!source) throw new StudyError('EVIDENCE_UNAVAILABLE', 'The sealed source is unavailable.');
    const selection = sourceMatch[2] === 'typescript' ? { text: source.source, hash: snapshot.source.typescriptHash, mimeType: 'text/typescript' }
      : sourceMatch[2] === 'javascript' ? { text: source.javascript, hash: snapshot.source.javascriptHash, mimeType: 'text/javascript' }
      : { text: source.sourceMap, hash: snapshot.source.sourceMapHash, mimeType: 'application/json' };
    if (Buffer.byteLength(selection.text) > SOURCE_LIMIT_BYTES || sha256(selection.text) !== selection.hash) throw new StudyError('EVIDENCE_UNAVAILABLE', 'Captured source exceeds limits or its sealed hash changed.');
    return { uri, mimeType: selection.mimeType, text: selection.text };
  }
  throw new StudyError('NOT_FOUND', 'Unknown resource kind.');
}

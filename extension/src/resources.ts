import { join } from 'node:path';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { EVENT_DETAIL_LIMIT_BYTES, EVENT_PAGE_SIZE, IMAGE_LIMIT_BYTES, SOURCE_LIMIT_BYTES } from './constants';
import { CAPTURE_PHASES } from 'codebook-cycle-0004/dist/constants';
import { ERROR_RECOVERY, StudyError } from './errors';
import type { StudyService } from './service';
import { omittedDetail } from './utils/omittedDetail';
import { readBoundedFile } from './utils/readBoundedFile';
import { readRecordingResource } from './utils/readRecordingResource';
import { readRepositoryResource } from './utils/readRepositoryResource';
import { BOOK_INPUT_LIMIT_BYTES, HTTP_BODY_LIMIT_BYTES, REPOSITORY_SOURCE_LIMIT_BYTES, REPOSITORY_SOURCE_EXTENSIONS, REPOSITORY_EXCLUDED_DIRECTORIES } from './constants';

export type ResourceContent = { uri: string; mimeType: string; text: string } | { uri: string; mimeType: string; blob: string };

/** Resolves only canonical instance/run resources, preserving historical captured bytes after runtime exit. @example await readResource(service, runUri) */
export async function readResource(service: StudyService, uri: string): Promise<ResourceContent> {
  const json = (value: unknown): ResourceContent => ({ uri, mimeType: 'application/json', text: JSON.stringify(value) });
  if (uri === 'codebook://help/errors') return json(ERROR_RECOVERY);
  if (uri === 'codebook://help/repository') return json({
    entry: 'Read codebook_status.repository, then codebook_sources and exact codebook_source paths. Author structured plain-text sections, verified path/hash/inclusive line citations and source-derived relations. Publish a complete document with expectedRevision and a stable key; open only the returned retained revision.',
    boundaries: { sourceBytes: REPOSITORY_SOURCE_LIMIT_BYTES, documentBytes: BOOK_INPUT_LIMIT_BYTES, httpEnvelopeBytes: HTTP_BODY_LIMIT_BYTES, extensions: REPOSITORY_SOURCE_EXTENSIONS, excludedDirectories: REPOSITORY_EXCLUDED_DIRECTORIES,
      rules: 'Trusted local selected Git root. Tracked regular UTF-8 files; no symlinks, hidden paths, secret/key names or lockfiles. This is not a secret-content detector. Nothing runs and no remote repository is fetched.' },
    recovery: 'Source mismatch: reread the exact path and update citations explicitly. Revision conflict: read the current book. Lost response: reuse identical key/input to recover the original receipt even after source changes. Missing history: discover saved studies in the library; never run application input as recovery.',
    understanding: 'Only an explicit learner action changes understanding. v3 progress retains typed runtime source decisions and complete canonical citation contexts; old v1/v2 bytes remain. Older builds cannot overwrite v3, and their later old-format writes are not merged automatically.',
    evidence: 'Agent text and relations are interpretation. Optional observation links must name exact saved study/observation/source identities; partial or unavailable evidence stays visible. Source reading does not prove this repository has a runtime adapter.',
    tutorial: 'extension/README.md: Learn this repository',
  });
  if (uri === 'codebook://help/studies') return json({
    entry: 'Call codebook_status, select a returned profile, then start with a stable key. checkout-demo is one local product and confirmation, without payment or arbitrary repository setup.',
    sequence: ['Read the returned manifestUri once ready; it freezes source hashes and expected actions/stops.', 'Send only the action named in nextActions, with a stable key unique to that action.', 'For each current pause, read its snapshotUri and sourceUri, save an interpretation using only present captured value paths, then copy its exact continueArguments.', 'After cart completion, use nextActions to submit checkout. Repeat evidence reading at order creation and purchase confirmation.', 'Read the terminal state and stop result. Separate runtime/capture evidence from saved learning history and personal understanding.'],
    recording: { discovery: 'API 1.2: follow codebook_status.recording.libraryUri, select a saved study recordingUri, then follow framesUri/nextUri and its hash-bound contextUri. Catalog entries are not verified playback.', controls: 'Read playbackUri and call codebook_playback with the current instanceId, studyId, action open/play/pause/seek and expectedRevision. Seek additionally requires positionMs. Poll readiness; requestedMs is not presentedMs. Stale revisions reject without executing application code.', recovery: 'After restart copy new credentials and rediscover. Saved study IDs persist, instance URIs do not. No live run is needed for playback. A changed context hash needs explicit rediscovery/reload. Missing or corrupt recording data remains unavailable; never retry input to repair history.', timing: 'Only facts available at the selected recorded time appear in the main projection. Later annotations remain labeled separately. Playback does not mark understanding.' },
    identity: 'Observations are historical item/action references. A later stop on the same participant does not replace them. Follow current continuation arguments, never an old observation.',
    recovery: 'On a lost action response, repeat identical action/key. Wrong order or a new key for an accepted action dispatches nothing. Missing values/images stay unavailable; never fill them from a later stop.',
    limits: 'Discovery gives profile-specific limits. Paused time is excluded from active progress time; the whole-run deadline remains. The old paired-cart-demo stays available.',
    outcomes: 'finalOutcome is the compatibility runtime/capture evidence result. historyOutcome qualifies the latest materialSignature/checkpointRevision as unavailable, pending, saved or failed. Only a terminal matching saved checkpoint and demonstrated runtime evidence yield studyOutcome demonstrated. An explanation added after Stop requires a newer saved checkpoint. Read the same run again while history is pending; never replay input to recover storage. recordedStudyOutcome separately qualifies the complete recording and its exact saved context; studyOutcome alone does not certify recording.',
  });
  const url = new URL(uri);
  if (url.protocol !== 'codebook:' || url.search || url.hash || url.username || url.password || url.port) throw new StudyError('INVALID_REFERENCE', 'Use a canonical resource URI.');
  if (url.pathname === '/repository' || url.pathname.startsWith('/books/')) return readRepositoryResource(service, uri);
  if (url.pathname === '/library' || url.pathname === '/playback' || url.pathname.startsWith('/studies/')) return readRecordingResource(service, uri);
  const match = /^\/runs\/([a-f0-9-]+)(?:\/(.*))?$/.exec(url.pathname);
  if (!match?.[1]) throw new StudyError('NOT_FOUND', 'Unknown resource.');
  const record = service.record({ instanceId: url.hostname, runId: match[1] }); const suffix = match[2];
  if (!suffix) return json(service.state(record));
  if (suffix === 'manifest') {
    const manifest = record.runtime?.view().manifest;
    if (!manifest) throw new StudyError('EVIDENCE_UNAVAILABLE', 'The run has not frozen its source and scenario manifest.');
    return json(manifest);
  }
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
    const capture = phase && record.runtime?.view().captures[phase];
    if (!phase || !record.runtime || capture?.status !== 'captured' || !capture.renderer) throw new StudyError('EVIDENCE_UNAVAILABLE', 'The requested phase has no confirmed image.');
    const bytes = await readBoundedFile(join(record.runtime.evidence.directory, `${phase}.png`), IMAGE_LIMIT_BYTES);
    if (sha256(bytes) !== capture.renderer.hash) throw new StudyError('EVIDENCE_UNAVAILABLE', 'Captured image no longer matches its sealed hash.');
    return { uri, mimeType: 'image/png', blob: bytes.toString('base64') };
  }
  const sourceMatch = /^(snapshots\/[^/]+)(?:\/source\/(typescript|javascript|map))?$/.exec(suffix);
  if (sourceMatch?.[1]) {
    const snapshotUri = service.uri(record.id, sourceMatch[1]); const snapshot = service.snapshot(record, snapshotUri);
    if (!sourceMatch[2]) return json({ ...snapshot, snapshotUri, historical: true, sourceUri: `${snapshotUri}/source/typescript` });
    const source = record.runtime?.source(snapshot.itemId);
    if (!source) throw new StudyError('EVIDENCE_UNAVAILABLE', 'The sealed source is unavailable.');
    const selection = sourceMatch[2] === 'typescript' ? { text: source.source, hash: snapshot.source.typescriptHash, mimeType: 'text/typescript' }
      : sourceMatch[2] === 'javascript' ? { text: source.javascript, hash: snapshot.source.javascriptHash, mimeType: 'text/javascript' }
      : { text: source.sourceMap, hash: snapshot.source.sourceMapHash, mimeType: 'application/json' };
    if (Buffer.byteLength(selection.text) > SOURCE_LIMIT_BYTES || sha256(selection.text) !== selection.hash) throw new StudyError('EVIDENCE_UNAVAILABLE', 'Captured source exceeds limits or its sealed hash changed.');
    return { uri, mimeType: selection.mimeType, text: selection.text };
  }
  throw new StudyError('NOT_FOUND', 'Unknown resource kind.');
}

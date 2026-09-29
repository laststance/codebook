import { readJsonPage } from './readJsonPage';
import { RECORDING_FRAME_PAGE_SIZE } from '../constants';
import { LearningLibrary } from '../learningLibrary';
import { StudyError } from '../errors';
import type { StudyService } from '../service';
import type { ResourceContent } from '../resources';

/** Resolves only current-instance canonical library/recording resources, using bounded pages and pinned context hashes. @example await readRecordingResource(service, recordingUri) */
export async function readRecordingResource(service: StudyService, uri: string): Promise<ResourceContent> {
  const url = new URL(uri), store = service.recordings;
  if (url.hostname !== service.instanceId) throw new StudyError('STALE_INSTANCE', 'Recording discovery belongs to a different server instance.');
  if (url.toString() !== uri || url.protocol !== 'codebook:' || url.search || url.hash || url.username || url.password || url.port) throw new StudyError('INVALID_REFERENCE', 'Use a returned canonical recording URI.');
  if (!store) throw new StudyError('EVIDENCE_UNAVAILABLE', 'Recording storage is unavailable in this workspace.');
  const json = (value: unknown): ResourceContent => ({ uri, mimeType: 'application/json', text: JSON.stringify(value) });
  const recordingUri = (studyId: string) => `codebook://${service.instanceId}/studies/${studyId}/recording`;
  if (url.pathname === '/library') {
    const [studies, recordings] = await Promise.all([new LearningLibrary(store.learningDirectory, store.workspaceKey).list(), store.list()]);
    const entries = new Map(studies.map(study => [study.id, { studyId: study.id, study, recording: recordings.find(value => value.studyId === study.id), recordingUri: recordingUri(study.id) }]));
    return json({ instanceId: service.instanceId, workspaceKey: store.workspaceKey, verification: 'Catalog metadata only; read a recording to verify its journal and frame hashes.',
      entries: [...entries.values(), ...recordings.filter(recording => !entries.has(recording.studyId)).map(recording => ({ studyId: recording.studyId, recording, recordingUri: recordingUri(recording.studyId) }))], playbackUri: `codebook://${service.instanceId}/playback` });
  }
  if (url.pathname === '/playback') return json({ instanceId: service.instanceId, ...service.playbackController?.state(), available: Boolean(service.playbackController), uri, libraryUri: `codebook://${service.instanceId}/library` });
  const match = /^\/studies\/([a-f0-9-]{36}_[a-f0-9-]{36})\/recording(?:\/(frames\/(?:0|[1-9]\d*)|frame\/[a-f0-9]{64}|context\/[a-f0-9]{64}(?:\/learning(?:\/pages\/[a-f0-9]{64}\/(?:0|[1-9]\d*))?)?))?$/.exec(url.pathname);
  if (!match?.[1]) throw new StudyError('INVALID_REFERENCE', 'Unknown recording resource; copy a returned canonical URI.');
  const studyId = match[1], suffix = match[2], base = recordingUri(studyId);
  try {
    if (suffix?.startsWith('context/')) {
      const [, contextHash, selection, ...page] = suffix.split('/');
      const { context } = await store.readContext(studyId, contextHash);
      if (!selection) return json(context);
      return readJsonPage(`${base}/context/${contextHash}/learning`, { studyId, contextHash, historyRevision: context.historyRevision,
        studyHash: context.studyHash, materialSignature: context.materialSignature, historical: true,
        learningSummary: 'learningSummary' in context.study ? context.study.learningSummary : undefined,
        observations: context.study.observations.map(observation => ({ id: observation.id, elapsedMs: observation.elapsedMs,
          source: { hash: observation.source.hash, line: observation.source.line }, values: observation.values,
          unavailableValues: 'unavailableValues' in observation ? observation.unavailableValues : undefined, interpretations: observation.interpretations })),
        interpretationAvailability: context.interpretationAvailability, pausedIntervals: context.pausedIntervals,
      }, page.length ? page.join('/') : undefined);
    }
    const index = await (suffix ? store.readResourceIndex(studyId) : store.read(studyId));
    if (!suffix) {
      let contextHash: string | undefined, contextReason: string | undefined;
      try { contextHash = (await store.readContext(studyId)).hash; } catch (error) { contextReason = String(error); }
      return json({ header: index.header, status: index.status, reason: index.reason, endMs: index.endMs, lastVerifiedMs: index.lastVerifiedMs,
        frameCount: index.entries.filter(entry => entry.type === 'frame').length, lastSequence: index.entries.at(-1)?.sequence ?? 0, framesUri: `${base}/frames/0`,
        contextUri: contextHash ? `${base}/context/${contextHash}` : undefined, learningUri: contextHash ? `${base}/context/${contextHash}/learning` : undefined, contextReason, playbackUri: `codebook://${service.instanceId}/playback`, historical: true });
    }
    if (suffix.startsWith('frames/')) {
      const cursor = Number(suffix.slice('frames/'.length));
      if (!Number.isSafeInteger(cursor)) throw new StudyError('INVALID_REFERENCE', 'Frame cursor is outside its integer range.');
      const entries = index.entries.filter(entry => entry.sequence > cursor).slice(0, RECORDING_FRAME_PAGE_SIZE), last = entries.at(-1)?.sequence ?? cursor;
      return json({ entries: entries.map(entry => entry.type === 'frame' ? { ...entry, uri: `${base}/frame/${entry.hash}` } : entry), afterSequence: cursor, lastSequence: last,
        verification: 'Current sealed journal identity with a pinned verified index; individual PNG bytes are reverified when fetched. Recording metadata and playback Open perform fresh full verification.',
        nextUri: index.entries.some(entry => entry.sequence > last) ? `${base}/frames/${last}` : undefined, status: index.status, endMs: index.endMs });
    }
    const hash = suffix.slice('frame/'.length);
    if (!index.entries.some(entry => entry.type === 'frame' && entry.hash === hash)) throw new StudyError('INVALID_REFERENCE', 'This frame does not belong to the recording journal.');
    return { uri, mimeType: 'image/png', blob: (await store.readFrame(studyId, hash)).toString('base64') };
  } catch (error) {
    if (error instanceof StudyError) throw error;
    throw new StudyError('EVIDENCE_UNAVAILABLE', String(error), `Read ${base} or codebook://${service.instanceId}/library for current recording/context references. No execution was started.`);
  }
}

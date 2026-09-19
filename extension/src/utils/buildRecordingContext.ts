import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import type { RecordedEvent } from 'codebook-cycle-0001/dist/evidence';
import { STUDY_PROFILES } from 'codebook-cycle-0004/dist/profiles';
import { RECORDING_REASON_LIMIT_CHARS, RECORDING_VERSION } from '../constants';
import { recordingContextSchema, recordingHashSchema, type RecordingContext } from '../recordingSchemas';
import type { StudyArchive } from '../studySchemas';
import { decodeStudyArchive } from './decodeStudyArchive';

const phaseDetailSchema = z.object({ phase: z.string(), hash: recordingHashSchema.optional(), pause: z.unknown().optional(), renderer: z.object({ hash: recordingHashSchema }).optional(), reason: z.string().optional() });
const interpretationDetailSchema = z.object({ id: z.uuid(), snapshotId: z.string() });

/** Joins committed study facts to their own receipt times for {@link RecordingStore}; later interpretations never backdate. @example buildRecordingContext(study, events, 3).historyRevision // 3 */
export function buildRecordingContext(input: StudyArchive, events: readonly RecordedEvent[], historyRevision: number): RecordingContext {
  const study = decodeStudyArchive(input, input.workspaceKey), { captures: _captures, ...compact } = study;
  const phases: RecordingContext['phases'] = [];
  for (const phase of STUDY_PROFILES[study.profile].capturePhases) {
    const records = events.flatMap(event => { const parsed = phaseDetailSchema.safeParse(event.detail); return parsed.success && parsed.data.phase === phase ? [{ ...event, detail: parsed.data }] : []; });
    const request = records.find(event => event.type === 'capture.requested'), pixels = records.find(event => event.type === 'capture.response-received');
    const confirmed = records.find(event => event.type === 'capture.received'), failed = records.find(event => event.type === 'capture.failed');
    const observation = study.observations.find(observation => observation.capturePhase === phase);
    const pauseMatches = observation && pixels && isDeepStrictEqual(observation.pause, pixels.detail.pause);
    phases.push({ phase, requestedMs: request?.elapsedMs, pixelsMs: pixels?.elapsedMs, hash: pixels?.detail.hash, snapshotId: observation?.id,
      pauseVerifiedMs: pauseMatches ? Math.max(pixels.elapsedMs, observation.elapsedMs) : undefined,
      rendererConfirmedMs: pixels?.detail.hash && confirmed?.detail.renderer?.hash === pixels.detail.hash ? confirmed.elapsedMs : undefined,
      failedMs: failed?.elapsedMs, reason: failed?.detail.reason?.slice(0, RECORDING_REASON_LIMIT_CHARS) });
  }
  const interpretationAvailability = study.observations.flatMap(observation => observation.interpretations.map(interpretation => {
    const saved = events.find(event => {
      const parsed = interpretationDetailSchema.safeParse(event.detail);
      return event.type === 'agent.explanation-saved' && parsed.success && parsed.data.id === interpretation.id && parsed.data.snapshotId === observation.id;
    });
    return { id: interpretation.id, snapshotId: observation.id, elapsedMs: saved?.elapsedMs ?? null };
  }));
  return recordingContextSchema.parse({ version: RECORDING_VERSION, workspaceKey: study.workspaceKey, studyId: study.id, historyRevision, studyHash: sha256(JSON.stringify(study)), materialSignature: study.materialSignature, study: compact, interpretationAvailability, phases });
}

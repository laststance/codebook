import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { sha256 } from '../runtimeSupport/utils/sha256';
import type { RecordedEvent } from '../runtimeSupport/evidence';
import { CONFIGURED_RECORDING_VERSION, CROSS_RUNTIME_RECORDING_VERSION, CROSS_RUNTIME_STUDY_VERSION, RECORDING_REASON_LIMIT_CHARS } from '../constants';
import { retainedRecordingContextSchema, recordingHashSchema, type RecordingContext } from '../recordingSchemas';
import type { RetainedStudy } from '../retainedStudySchemas';
import { decodeRetainedStudy } from './decodeRetainedStudy';
import { describeStudy } from './describeStudy';

const phaseDetailSchema = z.object({ phase: z.string(), hash: recordingHashSchema.optional(), pause: z.unknown().optional(), renderer: z.object({ hash: recordingHashSchema }).optional(), reason: z.string().optional() });
const interpretationDetailSchema = z.object({ id: z.uuid(), snapshotId: z.string() });

/** Joins committed study facts to their own receipt times for {@link RecordingStore}; later interpretations never backdate. @example buildRecordingContext(study, events, 3).historyRevision // 3 */
export function buildRecordingContext(input: RetainedStudy, events: readonly RecordedEvent[], historyRevision: number): RecordingContext {
  const study = decodeRetainedStudy(input, input.workspaceKey), { captures: _captures, ...compact } = study;
  const phases: RecordingContext['phases'][number][] = [];
  for (const phase of describeStudy(study).capturePhases) {
    const observations = study.observations.filter(observation => observation.capturePhase === phase);
    // A repeated phase has one receipt per captured pause; never borrow the first pause's pixels.
    for (const observation of observations.length ? observations : [undefined]) {
      const records = events.flatMap(event => { const parsed = phaseDetailSchema.safeParse(event.detail); return parsed.success && parsed.data.phase === phase && (!observation || isDeepStrictEqual(observation.pause, parsed.data.pause) || observations.length === 1 && parsed.data.pause === undefined) ? [{ ...event, detail: parsed.data }] : []; });
      const request = records.find(event => event.type === 'capture.requested'), pixels = records.find(event => event.type === 'capture.response-received');
      const confirmed = records.find(event => event.type === 'capture.received'), failed = records.find(event => event.type === 'capture.failed');
      const pauseMatches = observation && pixels && isDeepStrictEqual(observation.pause, pixels.detail.pause);
      phases.push({ phase, requestedMs: request?.elapsedMs, pixelsMs: pixels?.elapsedMs, hash: pixels?.detail.hash, snapshotId: observation?.id,
        pauseVerifiedMs: pauseMatches ? Math.max(pixels.elapsedMs, observation.elapsedMs) : undefined,
        rendererConfirmedMs: pixels?.detail.hash && confirmed?.detail.renderer?.hash === pixels.detail.hash ? confirmed.elapsedMs : undefined,
        failedMs: failed?.elapsedMs, reason: failed?.detail.reason?.slice(0, RECORDING_REASON_LIMIT_CHARS) });
    }
  }

  const interpretationAvailability = study.observations.flatMap(observation => observation.interpretations.map(interpretation => {
    const saved = events.find(event => {
      const parsed = interpretationDetailSchema.safeParse(event.detail);
      return event.type === 'agent.explanation-saved' && parsed.success && parsed.data.id === interpretation.id && parsed.data.snapshotId === observation.id;
    });
    return { id: interpretation.id, snapshotId: observation.id, elapsedMs: saved?.elapsedMs ?? null };
  }));
  // Seal only intervals with an observed retirement; an open pause supplies its exact receipt point only.
  const pausedIntervals = study.observations.flatMap(observation => {
    if (!observation.debugger) return [];
    const boundary = events.filter(event => event.elapsedMs >= observation.elapsedMs && ['continue.accepted', 'cdp.resumed', 'session.terminated', 'run.failed', 'cleanup.started'].includes(event.type))
      .sort((left, right) => left.elapsedMs - right.elapsedMs)[0];
    return boundary ? [{ snapshotId: observation.id, startMs: observation.elapsedMs, endMs: boundary.elapsedMs }] : [];
  });
  return retainedRecordingContextSchema.parse({ version: study.version === CROSS_RUNTIME_STUDY_VERSION ? CROSS_RUNTIME_RECORDING_VERSION : CONFIGURED_RECORDING_VERSION, workspaceKey: study.workspaceKey, studyId: study.id, historyRevision, studyHash: sha256(JSON.stringify(study)), materialSignature: study.materialSignature, study: compact, interpretationAvailability, phases, pausedIntervals });
}

import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { IMAGE_LIMIT_BYTES, SOURCE_LIMIT_BYTES } from '../constants';
import { studyArchiveSchema, type StudyArchive } from '../studyModel';

/** Validates persisted bytes and cross-field identity before {@link LearningLibrary} exposes history. @example validateStudy(json, workspaceKey) */
export function validateStudy(value: unknown, workspaceKey: string): StudyArchive {
  const study = studyArchiveSchema.parse(value);
  if (study.workspaceKey !== workspaceKey || study.id !== `${study.instanceId}_${study.runId}`) throw new Error('Study belongs to a different workspace or run.');
  const observed = new Set<string>();
  for (const observation of study.observations) {
    if (observed.has(observation.participant)) throw new Error('Study contains duplicate participant observations.');
    observed.add(observation.participant);
    if (observation.snapshotUri !== `codebook://${study.instanceId}/runs/${study.runId}/snapshots/${encodeURIComponent(observation.id)}` || observation.id !== `${observation.pause.sessionId}:${observation.pause.generation}`) throw new Error('Captured observation identity changed.');
    if (Buffer.byteLength(observation.source.text) > SOURCE_LIMIT_BYTES || sha256(observation.source.text) !== observation.source.hash || observation.source.line > observation.source.text.split('\n').length) throw new Error('Captured source is incomplete or changed.');
  }
  const phases = new Set<string>();
  for (const capture of study.captures) {
    if (phases.has(capture.phase)) throw new Error('Study contains duplicate image phases.');
    phases.add(capture.phase);
    if (capture.status !== 'captured') continue;
    const bytes = Buffer.from(capture.base64, 'base64');
    if (bytes.length > IMAGE_LIMIT_BYTES || bytes.toString('base64') !== capture.base64 || sha256(bytes) !== capture.hash) throw new Error('Captured image is incomplete or changed.');
  }
  return study;
}

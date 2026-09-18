import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { CAPTURE_PHASES, LEARNING_SCHEMA_VERSION, PROFILE_ID } from '../constants';
import { readResource } from '../resources';
import type { StudyRecord, StudyService } from '../service';
import { LEARNING_ITEMS, observationSchema, type StudyArchive } from '../studyModel';
import { validateStudy } from './validateStudy';

/** Copies only committed canonical evidence for {@link StudyWorkspace}; a changed read is discarded. @example await captureStudy(service, record, workspaceKey) */
export async function captureStudy(service: StudyService, record: StudyRecord, workspaceKey: string): Promise<StudyArchive | undefined> {
  const state = service.state(record), signature = JSON.stringify(state), runtime = record.runtime?.view();
  const observations: StudyArchive['observations'] = [];
  const captures: StudyArchive['captures'] = [];
  for (const item of LEARNING_ITEMS) {
    const snapshotUri = state.participants[item.participant].snapshotUri;
    if (!snapshotUri) continue;
    const snapshot = service.snapshot(record, snapshotUri);
    const source = await readResource(service, `${snapshotUri}/source/typescript`);
    if (!('text' in source)) throw new Error('Captured TypeScript is unavailable.');
    const committed = runtime?.events.find(event => event.type === 'snapshot.committed' && event.detail && typeof event.detail === 'object' && 'snapshotId' in event.detail && event.detail.snapshotId === snapshot.id);
    if (!committed) throw new Error('The snapshot has no committed receipt time.');
    observations.push(observationSchema.parse({ id: snapshot.id, snapshotUri, participant: item.participant, capturedAt: committed.wallTime, elapsedMs: committed.elapsedMs,
      pause: snapshot.pause, source: { text: source.text, hash: snapshot.source.typescriptHash, line: snapshot.frame.line }, values: snapshot.values,
      interpretations: [...record.explanations.values()].filter(value => value.snapshotUri === snapshotUri).map(value => ({ id: value.id, text: value.agentInterpretation, createdAt: value.createdAt, facts: value.capturedFacts })) }));
  }
  for (const phase of CAPTURE_PHASES) {
    const capture = state.captures.find(value => value.phase === phase);
    if (capture?.status === 'captured') {
      if (!capture.uri) throw new Error('Confirmed image has no canonical resource.');
      const image = await readResource(service, capture.uri);
      if (!('blob' in image)) throw new Error('Captured image is unavailable.');
      captures.push({ phase, status: 'captured', base64: image.blob, hash: sha256(Buffer.from(image.blob, 'base64')) });
    } else captures.push({ phase, status: capture?.status ?? 'absent', reason: capture?.error ?? (capture?.status === 'pending' ? 'Capturing this observation…' : 'No confirmed image for this phase.') });
  }
  // Never combine a completed control state with evidence gathered across a different transition.
  if (JSON.stringify(service.state(record)) !== signature) return undefined;
  return validateStudy({ version: LEARNING_SCHEMA_VERSION, workspaceKey, id: `${service.instanceId}_${record.id}`, instanceId: service.instanceId, runId: record.id, profile: PROFILE_ID,
    createdAt: state.createdAt, savedAt: new Date().toISOString(), state: state.state, terminal: record.stopped || state.resourcesReleased, finalOutcome: state.finalOutcome,
    reason: state.terminalReason ?? state.cleanupError?.message, observations, captures, links: (state.links ?? []).map(link => ({ id: link.id, status: link.status })) }, workspaceKey);
}

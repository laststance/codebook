import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { LEARNING_SCHEMA_VERSION_V2, REPOSITORY_BROWSER_ACTION, REPOSITORY_BROWSER_PROFILE } from '../constants';
import { STUDY_PROFILES } from 'codebook-cycle-0004/dist/profiles';
import { readResource } from '../resources';
import type { StudyRecord, StudyService } from '../service';
import { observationSchema, type StudyArchive } from '../studyModel';
import { validateStudy } from './validateStudy';

/** Copies only committed canonical evidence for {@link StudyWorkspace}; a changed read is discarded. @example await captureStudy(service, record, workspaceKey) */
export async function captureStudy(service: StudyService, record: StudyRecord, workspaceKey: string): Promise<StudyArchive | undefined> {
  if (record.profile === REPOSITORY_BROWSER_PROFILE) throw new Error('Configured Study presentation is not available in this build yet.');
  const state = service.state(record), signature = state.materialSignature, runtime = record.runtime?.view();
  const observations: StudyArchive['observations'] = [];
  const captures: StudyArchive['captures'] = [];
  for (const reference of state.observations) {
    const snapshotUri = reference.snapshotUri;
    const snapshot = service.snapshot(record, snapshotUri);
    if (snapshot.actionId === REPOSITORY_BROWSER_ACTION) throw new Error('Repository evidence cannot belong to a demo archive.');
    const source = await readResource(service, `${snapshotUri}/source/typescript`);
    if (!('text' in source)) throw new Error('Captured TypeScript is unavailable.');
    const committed = runtime?.events.find(event => event.type === 'snapshot.committed' && event.detail && typeof event.detail === 'object' && 'snapshotId' in event.detail && event.detail.snapshotId === snapshot.id);
    if (!committed) throw new Error('The snapshot has no committed receipt time.');
    observations.push(observationSchema.parse({ id: snapshot.id, snapshotUri, participant: snapshot.participant, itemId: snapshot.itemId, actionId: snapshot.actionId, capturePhase: snapshot.capturePhase, capturedAt: committed.wallTime, elapsedMs: committed.elapsedMs,
      pause: snapshot.pause, source: { text: source.text, hash: snapshot.source.typescriptHash, line: snapshot.frame.line }, values: snapshot.values,
      interpretations: [...record.explanations.values()].filter(value => value.snapshotUri === snapshotUri).map(value => ({ id: value.id, text: value.agentInterpretation, createdAt: value.createdAt, facts: value.capturedFacts })) }));
  }
  for (const phase of STUDY_PROFILES[record.profile].capturePhases) {
    const capture = state.captures.find(value => value.phase === phase);
    if (capture?.status === 'captured') {
      if (!capture.uri) throw new Error('Confirmed image has no canonical resource.');
      const image = await readResource(service, capture.uri);
      if (!('blob' in image)) throw new Error('Captured image is unavailable.');
      captures.push({ phase, status: 'captured', base64: image.blob, hash: sha256(Buffer.from(image.blob, 'base64')) });
    } else captures.push({ phase, status: capture?.status ?? 'absent', reason: capture?.error ?? (capture?.status === 'pending' ? 'Capturing this observation…' : 'No confirmed image for this phase.') });
  }
  // Never combine a completed control state with evidence gathered across a different transition.
  if (service.state(record).materialSignature !== signature) return undefined;
  return validateStudy({ version: LEARNING_SCHEMA_VERSION_V2, workspaceKey, id: `${service.instanceId}_${record.id}`, instanceId: service.instanceId, runId: record.id, profile: record.profile,
    createdAt: state.createdAt, savedAt: new Date().toISOString(), state: state.state, terminal: record.stopped || state.resourcesReleased, finalOutcome: state.finalOutcome,
    materialSignature: signature, reason: state.terminalReason ?? state.cleanupError?.message, observations, captures, links: (state.links ?? []).map(link => ({ id: link.id, status: link.status })) }, workspaceKey);
}

import { retainedRecordingContextSchema, type RecordingContext } from '../recordingSchemas';
import { decodeStudyArchive } from './decodeStudyArchive';
import { validateConfiguredStudyEvidence } from './validateConfiguredStudyEvidence';
import { recordingPhases } from './recordingPhases';
import { CONFIGURED_STUDY_VERSION } from '../constants';

/** Rejects mismatched identities, source hashes and impossible availability before recording context reaches playback. @example validateRecordingContext(value, key).studyId */
export function validateRecordingContext(value: unknown, workspaceKey: string): RecordingContext {
  const context = retainedRecordingContextSchema.parse(value), study = context.study;
  if (study.version === CONFIGURED_STUDY_VERSION) validateConfiguredStudyEvidence(study, workspaceKey);
  else decodeStudyArchive({ ...study, captures: [] }, workspaceKey);
  if (context.workspaceKey !== workspaceKey || context.studyId !== study.id || context.materialSignature !== study.materialSignature) throw new Error('Recording context belongs to another checkpoint.');
  const interpretations = study.observations.flatMap(observation => observation.interpretations.map(interpretation => ({ observation, interpretation })));
  if (new Set(interpretations.map(value => value.interpretation.id)).size !== interpretations.length || context.interpretationAvailability.length !== interpretations.length || new Set(context.interpretationAvailability.map(value => value.id)).size !== interpretations.length) throw new Error('Recording context has duplicate or missing interpretation times.');
  for (const availability of context.interpretationAvailability) {
    const match = interpretations.find(value => value.interpretation.id === availability.id && value.observation.id === availability.snapshotId);
    if (!match || (availability.elapsedMs !== null && availability.elapsedMs < match.observation.elapsedMs)) throw new Error('Interpretation availability precedes or mismatches its observation.');
  }
  if (new Set(context.phases.map(value => value.phase)).size !== context.phases.length) throw new Error('Recording context repeats a phase.');
  for (const phase of context.phases) {
    if (!recordingPhases(study.profile).some(allowed => allowed === phase.phase)) throw new Error('Recording context contains a foreign phase.');
    const observation = study.observations.find(value => value.id === phase.snapshotId);
    if (phase.snapshotId && (!observation || observation.capturePhase !== phase.phase)) throw new Error('Recording phase points to another observation.');
    if (phase.pixelsMs !== undefined && (!phase.hash || phase.requestedMs === undefined || phase.requestedMs > phase.pixelsMs)) throw new Error('Recording pixels lack their earlier request.');
    if (phase.pauseVerifiedMs !== undefined && (!observation || phase.pixelsMs === undefined || phase.pauseVerifiedMs < Math.max(phase.pixelsMs, observation.elapsedMs))) throw new Error('Pause confirmation precedes its pixels or observation.');
    if (phase.rendererConfirmedMs !== undefined && (phase.pixelsMs === undefined || phase.rendererConfirmedMs < phase.pixelsMs)) throw new Error('Renderer confirmation precedes its pixels.');
  }
  return context;
}

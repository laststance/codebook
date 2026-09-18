import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { STUDY_PROFILES } from 'codebook-cycle-0004/dist/profiles';
import { IMAGE_LIMIT_BYTES, LEARNING_SCHEMA_VERSION_V2, SOURCE_LIMIT_BYTES } from '../constants';
import { studyArchiveSchema as legacyArchiveSchema } from '../legacyStudySchemas';
import { studyArchiveSchema, type StudyArchive } from '../studySchemas';

/** Validates source/image/item integrity and normalizes old bytes for {@link LearningLibrary}, never mutating input files. @example decodeStudyArchive(legacyJson, workspaceKey).version // 2 */
export function decodeStudyArchive(value: unknown, workspaceKey: string): StudyArchive {
  let normalized = value;
  if (value && typeof value === 'object' && 'version' in value && value.version === 1) {
    const legacy = legacyArchiveSchema.parse(value);
    normalized = { ...legacy, materialSignature: sha256(JSON.stringify(legacy)), version: LEARNING_SCHEMA_VERSION_V2, observations: legacy.observations.map(observation => ({ ...observation, itemId: `paired-cart-demo/${observation.participant}`, actionId: 'add-to-cart', capturePhase: `paused-${observation.participant}` })) };
  }
  const study = studyArchiveSchema.parse(normalized);
  if (study.workspaceKey !== workspaceKey || study.id !== `${study.instanceId}_${study.runId}`) throw new Error('Study belongs to a different workspace or run.');
  const profile = STUDY_PROFILES[study.profile], items = new Set<string>(), observations = new Set<string>();
  for (const observation of study.observations) {
    const item = profile.items.find(item => item.id === observation.itemId);
    if (!item || item.action !== observation.actionId || item.participant !== observation.participant || item.capturePhase !== observation.capturePhase) throw new Error('Captured observation does not match its declared learning item.');
    if (items.has(item.id) || observations.has(observation.id)) throw new Error('Study contains duplicate observation identities.');
    items.add(item.id); observations.add(observation.id);
    if (observation.snapshotUri !== `codebook://${study.instanceId}/runs/${study.runId}/snapshots/${encodeURIComponent(observation.id)}` || observation.id !== `${observation.pause.sessionId}:${observation.pause.generation}`) throw new Error('Captured observation identity changed.');
    if (Buffer.byteLength(observation.source.text) > SOURCE_LIMIT_BYTES || sha256(observation.source.text) !== observation.source.hash || observation.source.line > observation.source.text.split('\n').length) throw new Error('Captured source is incomplete or changed.');
    const values = new Map(Object.entries(observation.values));
    for (const interpretation of observation.interpretations) {
      if (new Set(interpretation.facts.map(fact => fact.path)).size !== interpretation.facts.length || interpretation.facts.some(fact => values.get(fact.path) !== fact.value)) throw new Error('Interpretation facts differ from the selected captured observation.');
    }
  }
  const phases = new Set<string>();
  for (const capture of study.captures) {
    if (!profile.capturePhases.includes(capture.phase) || phases.has(capture.phase)) throw new Error('Study contains a duplicate or foreign image phase.');
    phases.add(capture.phase);
    if (capture.status !== 'captured') continue;
    const bytes = Buffer.from(capture.base64, 'base64');
    if (bytes.length > IMAGE_LIMIT_BYTES || bytes.toString('base64') !== capture.base64 || sha256(bytes) !== capture.hash) throw new Error('Captured image is incomplete or changed.');
  }
  if (new Set(study.links.map(link => link.id)).size !== study.links.length || study.links.some(link => !profile.requiredLinks.includes(link.id))) throw new Error('Study contains a duplicate or foreign causal link.');
  return study;
}

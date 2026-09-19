import { progressSchema as legacyProgressSchema } from '../legacyStudySchemas';
import { progressSchema as progressV2Schema } from '../studySchemas';
import { progressV3Schema, progressV4Schema, type LearnerProgress } from '../learnerSchemas';
import { LEARNING_SCHEMA_VERSION_V2, LEARNING_SCHEMA_VERSION_V3, LEARNING_SCHEMA_VERSION_V4 } from '../constants';

/** Normalizes validated legacy choices for {@link LearningLibrary} reads without writing or changing their ownership. @example decodeLearnerProgress(v1, workspaceKey).decisions[0]?.item // 'paired-cart-demo/server' */
export function decodeLearnerProgress(value: unknown, workspaceKey: string): LearnerProgress {
  let normalized = value;
  if (value && typeof value === 'object' && 'version' in value && value.version === 1) {
    const legacy = legacyProgressSchema.parse(value);
    normalized = { ...legacy, version: LEARNING_SCHEMA_VERSION_V2,
      decisions: legacy.decisions.map(decision => ({ ...decision, item: `paired-cart-demo/${decision.item}` })),
      selection: legacy.selection && { studyId: legacy.selection.studyId, profile: 'paired-cart-demo', itemId: `paired-cart-demo/${legacy.selection.participant}`, follow: false, tab: legacy.selection.tab } };
  }
  // Only validated older formats receive explicit single-source meaning; future/corrupt data never falls back.
  if (normalized && typeof normalized === 'object' && 'version' in normalized && normalized.version === LEARNING_SCHEMA_VERSION_V2) {
    const legacy = progressV2Schema.parse(normalized);
    normalized = { ...legacy, version: LEARNING_SCHEMA_VERSION_V3, decisions: legacy.decisions.map(decision => ({ ...decision, context: { kind: 'source' } })) };
  }
  if (normalized && typeof normalized === 'object' && 'version' in normalized && normalized.version === LEARNING_SCHEMA_VERSION_V3) {
    const legacy = progressV3Schema.parse(normalized);
    normalized = { ...legacy, version: LEARNING_SCHEMA_VERSION_V4 };
  }
  const progress = progressV4Schema.parse(normalized);
  if (progress.workspaceKey !== workspaceKey) throw new Error('Progress belongs to another workspace.');
  if (new Set(progress.decisions.map(decision => decision.id)).size !== progress.decisions.length) throw new Error('Progress contains duplicate learner decision identities.');
  return progress;
}

import { z } from 'zod';
import { KEY_LENGTH_LIMIT, LEARNING_SCHEMA_VERSION, LEARNING_SCHEMA_VERSION_V2, LEARNING_SCHEMA_VERSION_V3, LEARNING_SCHEMA_VERSION_V4, MAX_LEARNER_DECISIONS } from '../constants';
import { learnerDecisionSchema } from '../studySchemas';
import { learnerDecisionV3Schema, progressV4Schema, type LearnerProgress } from '../learnerSchemas';
import { decodeLearnerProgress } from './decodeLearnerProgress';
import { repositoryItemSchema } from '../identitySchemas';

// Retired entries remain in their original file; this envelope grants none of them live authority.
const historicalProgressSchema = progressV4Schema.extend({
  version: z.union([z.literal(LEARNING_SCHEMA_VERSION), z.literal(LEARNING_SCHEMA_VERSION_V2), z.literal(LEARNING_SCHEMA_VERSION_V3), z.literal(LEARNING_SCHEMA_VERSION_V4)]),
  decisions: z.array(learnerDecisionSchema.extend({ item: repositoryItemSchema.or(z.string().min(1).max(KEY_LENGTH_LIMIT)), context: z.unknown().optional() })).max(MAX_LEARNER_DECISIONS),
  selection: z.record(z.string(), z.unknown()).optional(),
});

/** Projects repository choices from read-only historical files for {@link LearningLibrary}; retired intent bytes stay untouched. @example projectHistoricalProgress(value, workspaceKey).version // 4 */
export function projectHistoricalProgress(value: unknown, workspaceKey: string): LearnerProgress {
  const historical = historicalProgressSchema.parse(value);
  if (historical.workspaceKey !== workspaceKey) throw new Error('Progress belongs to another workspace.');
  if (new Set(historical.decisions.map(decision => decision.id)).size !== historical.decisions.length) throw new Error('Progress contains duplicate learner decision identities.');
  // Validate every retained repository choice; corruption must never disappear through filtering.
  const repositoryDecisions = historical.decisions.filter(decision => decision.item.startsWith('repository/'));
  if (historical.version < LEARNING_SCHEMA_VERSION_V3 && repositoryDecisions.length) throw new Error('Historical progress contains newer repository choices.');
  const decisions = repositoryDecisions.map(decision => learnerDecisionV3Schema.parse(decision));
  const selection = historical.selection;
  const isRepositorySelection = selection?.profile === 'repository-browser' || typeof selection?.itemId === 'string' && selection.itemId.startsWith('repository/');
  // Later fields must not lend newer schema meaning to an older file.
  if (historical.version < LEARNING_SCHEMA_VERSION_V4 && (isRepositorySelection || historical.repositoryReturn)) throw new Error('Historical progress contains a newer selection format.');
  if (historical.version < LEARNING_SCHEMA_VERSION_V3 && historical.repositorySelection) throw new Error('Historical progress contains newer repository navigation.');
  return decodeLearnerProgress({ ...historical, version: LEARNING_SCHEMA_VERSION_V4, decisions, selection: isRepositorySelection ? selection : undefined }, workspaceKey);
}

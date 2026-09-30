import {
  LEARNING_SCHEMA_VERSION_V3,
  LEARNING_SCHEMA_VERSION_V4,
} from '../constants'
import {
  progressV3Schema,
  progressV4Schema,
  type LearnerProgress,
} from '../learnerSchemas'

/** Validates current repository choices on {@link LearningLibrary} reads without restoring runtime authority. @example decodeLearnerProgress(value, workspaceKey).version // 4 */
export function decodeLearnerProgress(
  value: unknown,
  workspaceKey: string,
): LearnerProgress {
  let normalized = value
  if (
    normalized &&
    typeof normalized === 'object' &&
    'version' in normalized &&
    normalized.version === LEARNING_SCHEMA_VERSION_V3
  ) {
    const legacy = progressV3Schema.parse(normalized)
    normalized = { ...legacy, version: LEARNING_SCHEMA_VERSION_V4 }
  }
  const progress = progressV4Schema.parse(normalized)
  if (progress.workspaceKey !== workspaceKey)
    throw new Error('Progress belongs to another workspace.')
  if (
    new Set(progress.decisions.map((decision) => decision.id)).size !==
    progress.decisions.length
  )
    throw new Error('Progress contains duplicate learner decision identities.')
  return progress
}

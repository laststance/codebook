import type { ConfiguredOperationRecord } from '../configuredStudySchemas'

const STATE_RANK = {
  'not-run': 0,
  sending: 1,
  paused: 2,
  done: 3,
  failed: 3,
} as const
const EFFECT_RANK = { pending: 0, dispatched: 1, 'after-verified': 2 } as const

/**
 * Checks that a later checkpoint of a saved study only moves its operation records forward (`not-run`, `sending`, `paused`, then `done` or `failed`), never rewrites a sent time, and never takes back an acknowledgement or a check.
 * Called by {@link assertStudyCheckpoint} for every checkpoint of a study that keeps operations.
 * @param prior - The records of the accepted checkpoint, if it had any.
 * @param next - The records of the new checkpoint.
 * @throws When a record went back, changed its final state or its time, or the list lost or gained a record.
 * @example assertOperationRecordsAdvance(prior.operations, study.operations)
 */
export function assertOperationRecordsAdvance(
  prior: readonly ConfiguredOperationRecord[] | undefined,
  next: readonly ConfiguredOperationRecord[] | undefined,
): void {
  if (!prior) return
  if (!next || next.length !== prior.length)
    throw new Error('Configured operation records changed after acceptance.')
  for (const [position, before] of prior.entries()) {
    const after = next[position]!
    if (
      after.index !== before.index ||
      after.kind !== before.kind ||
      after.title !== before.title ||
      // A finished operation stays as it ended.
      ((before.state === 'done' || before.state === 'failed') &&
        after.state !== before.state) ||
      STATE_RANK[after.state] < STATE_RANK[before.state] ||
      EFFECT_RANK[after.effect] < EFFECT_RANK[before.effect] ||
      (before.atMs !== undefined && after.atMs !== before.atMs) ||
      (before.ack === 'yes' && after.ack !== 'yes') ||
      (before.valueCheck !== 'pending' &&
        after.valueCheck !== before.valueCheck)
    )
      throw new Error(
        `Operation ${before.index} moved backwards or changed after it was accepted.`,
      )
  }
}

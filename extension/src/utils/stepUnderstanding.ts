import { createHash } from 'node:crypto'

import {
  STEP_UNDERSTANDING_LIMIT_BYTES,
  STEP_UNDERSTANDING_MAX_DECISIONS,
} from '../constants'
import {
  stepUnderstandingFileSchema,
  type StepUnderstandingDecision,
  type StepUnderstandingFile,
} from '../stepUnderstandingSchemas'

/** A step of a replay's current material, named by its id and the hash of its saved content. */
export type CurrentStepHash = { stepId: string; stepHash: string }

/** What the Study pane draws for one step: the learner's decision on the step's current content, and whether an earlier version of the step was marked understood. */
export type StepUnderstandingState = {
  understood: boolean
  at?: string
  reviewNeeded: boolean
  reviewAt?: string
}

/**
 * Hashes a step as its schema parsed it, so any change to its label, explanation, evidence, reference or operation changes the hash; called by the Study workspace for every step of the shown material and by {@link hashSteps} for each step.
 * @param step - The step as parsed from the saved material (key order is the schema's).
 * @returns The SHA-256 of the step's JSON, in lowercase hex.
 * @example stepHash({ id: 'a', from: 'ui', to: 'api', label: 'A', explanation: 'x', evidence: 'observed' }) // => 64 hex digits
 */
export function stepHash(step: unknown): string {
  return createHash('sha256').update(JSON.stringify(step)).digest('hex')
}

/** Epoch milliseconds of an ISO `at`, so values of different fractional precision compare by time, not by text. */
function atMs(at: string): number {
  return Date.parse(at)
}

const hashedSteps = new WeakMap<readonly unknown[], CurrentStepHash[]>()

/**
 * Hashes every step of a replay's material, once for each array of steps: the Study workspace builds a message at every move, and the same material is hashed again only when it is another object; called by the Study workspace's message.
 * @param steps - The material's steps as parsed, in order.
 * @returns Each step's id and {@link stepHash}, in the given order.
 * @example hashSteps(material.content.steps) // => [{ stepId: 'a', stepHash: '…' }]
 */
export function hashSteps(steps: readonly { id: string }[]): CurrentStepHash[] {
  const known = hashedSteps.get(steps)
  if (known) return known
  const hashes = steps.map((step) => ({
    stepId: step.id,
    stepHash: stepHash(step),
  }))
  hashedSteps.set(steps, hashes)
  return hashes
}

/**
 * Keeps one decision for each `(stepId, stepHash)` pair, the latest by `at` (equal `at`: the later entry in the array); called by {@link stepUnderstandingState} and {@link applyStepDecision}.
 * @param decisions - The stored decisions.
 * @returns The decisions without duplicate pairs, in their stored order.
 * @example normalizeStepDecisions([older, newer]) // => [newer]
 */
export function normalizeStepDecisions(
  decisions: readonly StepUnderstandingDecision[],
): StepUnderstandingDecision[] {
  const winners = new Map<string, number>()
  decisions.forEach((decision, index) => {
    const key = pairKey(decision)
    const held = winners.get(key)
    // A later entry wins over an earlier one with the same or an older time.
    if (held === undefined || atMs(decisions[held]!.at) <= atMs(decision.at))
      winners.set(key, index)
  })
  return decisions.filter((decision, index) => {
    return winners.get(pairKey(decision)) === index
  })
}

function pairKey(pair: CurrentStepHash): string {
  return `${pair.stepId}\u0000${pair.stepHash}`
}

/**
 * Works out, for each current step, what the learner decided about its current content and whether an earlier version of it was marked understood; called by the Study workspace for every Study message of a replay whose decisions were read.
 * A decision for the current hash, checked or not, ends review: the learner has decided on this version. Decisions of removed steps stay in the file and are not shown.
 * @param file - The replay's step-understanding file, or `undefined` when none exists (no decision for any step).
 * @param steps - The current steps with their hashes.
 * @returns One state per given step, in the given order.
 * @example stepUnderstandingState(undefined, [{ stepId: 'a', stepHash }]) // => [{ understood: false, reviewNeeded: false }]
 */
export function stepUnderstandingState(
  file: Pick<StepUnderstandingFile, 'decisions'> | undefined,
  steps: readonly CurrentStepHash[],
): StepUnderstandingState[] {
  const decisions = normalizeStepDecisions(file?.decisions ?? [])
  return steps.map((step) => {
    const current = decisions.find(
      (decision) =>
        decision.stepId === step.stepId && decision.stepHash === step.stepHash,
    )
    if (current)
      return {
        understood: current.understood,
        at: current.at,
        reviewNeeded: false,
      }
    // No decision for this version: an earlier version marked understood asks for a review.
    const earlierDecision = decisions
      .filter(
        (decision) =>
          decision.stepId === step.stepId &&
          decision.stepHash !== step.stepHash &&
          decision.understood,
      )
      .reduce<StepUnderstandingDecision | undefined>(
        (best, decision) =>
          best === undefined || atMs(decision.at) > atMs(best.at)
            ? decision
            : best,
        undefined,
      )
    return earlierDecision === undefined
      ? { understood: false, reviewNeeded: false }
      : { understood: false, reviewNeeded: true, reviewAt: earlierDecision.at }
  })
}

/**
 * Applies one learner decision to a replay's decisions: every entry of the same `(stepId, stepHash)` is replaced by the new one, every other entry is kept, and past {@link STEP_UNDERSTANDING_MAX_DECISIONS} the oldest decisions go first; called under the storage lock by {@link updateStepUnderstandingFile}.
 * The cap drops, oldest by `at` first, a decision whose pair is not a current step's; when every stored decision is a current step's, the oldest overall. Equal `at`: the earlier entry in the array goes first.
 * @param decisions - The stored decisions.
 * @param change - The new decision.
 * @param currentSteps - The steps of the material current when the learner pressed.
 * @param maxDecisions - The cap; defaults to {@link STEP_UNDERSTANDING_MAX_DECISIONS}.
 * @returns The decisions to store, the new one last.
 * @example applyStepDecision([], { stepId: 'a', stepHash, understood: true, at }, [{ stepId: 'a', stepHash }]) // => [{ stepId: 'a', … }]
 */
export function applyStepDecision(
  decisions: readonly StepUnderstandingDecision[],
  change: StepUnderstandingDecision,
  currentSteps: readonly CurrentStepHash[],
  maxDecisions: number = STEP_UNDERSTANDING_MAX_DECISIONS,
): StepUnderstandingDecision[] {
  const currentKeys = new Set(currentSteps.map(pairKey))
  const kept = normalizeStepDecisions(decisions).filter(
    (decision) => pairKey(decision) !== pairKey(change),
  )
  const next = [...kept, change]
  // Drop from the front of a stable order: not-current decisions before current ones, older before newer, array order on ties.
  while (next.length > maxDecisions) {
    const candidates = next
      .slice(0, -1)
      .map((decision, index) => ({ decision, index }))
    const stale = candidates.filter(
      ({ decision }) => !currentKeys.has(pairKey(decision)),
    )
    const pool = stale.length ? stale : candidates
    const oldest = pool.reduce((best, entry) =>
      atMs(entry.decision.at) < atMs(best.decision.at) ? entry : best,
    )
    next.splice(oldest.index, 1)
  }
  return next
}

/**
 * Serializes a step-understanding file after checking it against the schema and a size limit; called by the stores right before the atomic write, so a file over the limit never replaces the previous bytes.
 * @param file - The file to write.
 * @param limitBytes - The largest allowed size; defaults to {@link STEP_UNDERSTANDING_LIMIT_BYTES}.
 * @returns The JSON text.
 * @throws When the file does not match the schema or its JSON exceeds `limitBytes`.
 * @example serializeStepUnderstanding({ version: 1, studyId, decisions: [] }, 4096)
 */
export function serializeStepUnderstanding(
  file: StepUnderstandingFile,
  limitBytes: number = STEP_UNDERSTANDING_LIMIT_BYTES,
): string {
  const bytes = JSON.stringify(stepUnderstandingFileSchema.parse(file))
  if (Buffer.byteLength(bytes) > limitBytes)
    throw new Error(
      `Storage limit exceeded (${limitBytes} bytes); existing data was retained.`,
    )
  return bytes
}

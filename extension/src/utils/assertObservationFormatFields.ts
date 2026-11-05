import type { ConfiguredStudy } from '../configuredStudySchemas'
import { MODULE_EVALUATION_STUDY_VERSION } from '../constants'

import { afterOperationOf } from './afterOperationOf'
import type { configuredStops } from './configuredStops'
import {
  isModuleEvaluationObservation,
  usesServerRenderEvidence,
} from './studyFormatOfConfiguration'

type Observation = ConfiguredStudy['observations'][number]

/**
 * Checks one format 8 observation against its declared stop: the three required fields, the execution that fits the stop's participant, and the attribution fields that only a server render carries.
 * @param observation - The observation.
 * @param position - Its position in the study, which is the order the run paused it.
 * @param stops - The declared stops.
 * @param seenStops - The declared indexes earlier observations used; this call adds its own.
 * @throws When a field is missing or contradicts the stop, or a stop is observed twice.
 * @example assertFormat8Observation(observation, 0, stops, new Set())
 */
function assertFormat8Observation(
  observation: Observation,
  position: number,
  stops: ReturnType<typeof configuredStops>,
  seenStops: Set<number>,
): void {
  const { declaredIndex, executionIndex, execution } = observation
  if (
    declaredIndex === undefined ||
    executionIndex === undefined ||
    execution === undefined
  )
    throw new Error(
      'Configured observation of format 8 lacks execution, declaredIndex or executionIndex.',
    )
  const stop = stops[declaredIndex]
  if (!stop || seenStops.has(declaredIndex))
    throw new Error(
      'Configured observation names a stop that is not declared or already observed.',
    )
  seenStops.add(declaredIndex)
  if (executionIndex !== position)
    throw new Error('Configured observation executionIndex is out of order.')
  if ((execution === 'browser') !== (stop.participant === 'browser'))
    throw new Error('Configured observation execution differs from its stop.')
  assertAttributionFitsGroup(observation, afterOperationOf(stop) ?? 1)
}

/**
 * Ties a format 8 observation's execution and attribution to the group of its stop: an entry-render stop (`afterOperation: 0`) is a page-load render, so only it reads `entry-load` and it carries no operation; a later stop's render is attributed to its own operation.
 * @param observation - The observation, whose `execution`, `declaredIndex` and `executionIndex` exist.
 * @param group - The stop's `afterOperation`.
 * @throws When the execution, the attribution or the operation index contradicts the group.
 * @example assertAttributionFitsGroup({ execution: 'server-render', attribution: 'entry-load' }, 0)
 */
function assertAttributionFitsGroup(
  observation: Observation,
  group: number,
): void {
  const { attribution, operationIndex, execution, scope } = observation
  if (attribution !== undefined && execution !== 'server-render')
    throw new Error('Only a server render observation has an attribution.')
  if (scope !== undefined && execution !== 'server-render')
    throw new Error('Only a server render observation has a scope.')
  if (execution !== 'server-render') {
    if (group === 0)
      throw new Error('Configured entry-render observation is not a render.')
    if (operationIndex !== undefined)
      throw new Error(
        'Configured observation operationIndex belongs to a server render only.',
      )
    return
  }
  if (attribution === undefined)
    throw new Error('A server render observation needs an attribution.')
  // Codebook's own preparation request runs before any operation, so only an entry-render stop can pause in it.
  if (
    (attribution === 'entry-load' || attribution === 'preparation') !==
      (group === 0) &&
    attribution !== 'unconfirmed'
  )
    throw new Error('Configured observation attribution differs from its stop.')
  // The operation is the stop's own; a page-load render has none.
  if (operationIndex !== (group === 0 ? undefined : group))
    throw new Error(
      'Configured observation operationIndex differs from its stop.',
    )
}

/**
 * Checks the fields that exist in one study format only: format 8 observations carry `execution`, `declaredIndex` and `executionIndex` (and the study may say `firstExecutionObserved: false`), format 7 and earlier carry none of them, so a format 7 study stays the strict 0.2.72.0 shape.
 * Called by {@link validateConfiguredStudyEvidence} before it matches observations to stops.
 * @param study - The saved study, without its images.
 * @param stops - The declared stops as {@link configuredStops} gives them.
 * @throws When format 7 or earlier carries a format 8 field, or a format 8 observation breaks the rules of {@link assertFormat8Observation}.
 * @example assertObservationFormatFields(study, configuredStops(study.configuration))
 */
export function assertObservationFormatFields(
  study: Omit<ConfiguredStudy, 'captures'>,
  stops: ReturnType<typeof configuredStops>,
): void {
  if (!usesServerRenderEvidence(study)) {
    const hasNewField =
      study.firstExecutionObserved !== undefined ||
      study.observations.some(
        (observation) =>
          observation.scope !== undefined ||
          observation.execution !== undefined ||
          observation.attribution !== undefined ||
          observation.operationIndex !== undefined ||
          observation.declaredIndex !== undefined ||
          observation.executionIndex !== undefined,
      )
    if (hasNewField)
      throw new Error('Only a study of format 8 keeps execution fields.')
    return
  }
  // The scope and the preparation attribution belong to format 12, and format 12 is written only for a study that holds one.
  const holdsModuleEvaluation = study.observations.some(
    isModuleEvaluationObservation,
  )
  if (
    holdsModuleEvaluation !==
    (study.version === MODULE_EVALUATION_STUDY_VERSION)
  )
    throw new Error(
      holdsModuleEvaluation
        ? 'Only a study of format 12 keeps a module scope or a preparation attribution.'
        : 'A study of format 12 holds a module-evaluation or preparation observation.',
    )
  const seenStops = new Set<number>()
  for (const [position, observation] of study.observations.entries())
    assertFormat8Observation(observation, position, stops, seenStops)
}

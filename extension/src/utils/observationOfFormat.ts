import type { ConfiguredObservation } from '../configuredStudySchemas'
import { SERVER_RENDER_STUDY_VERSION } from '../constants'

/**
 * Shapes a pause snapshot's observation for the study format being written: format 8 keeps `execution`, `attribution`, `operationIndex`, `declaredIndex` and `executionIndex`, every earlier format drops them so a browser-only study stays the 0.2.72.0 shape.
 * Called by {@link captureStudy} for every observation, because the runtime puts those fields on every pause of every run.
 * @param observation - The observation built from a pause snapshot.
 * @param version - The study format being written, from {@link studyFormatOfConfiguration}.
 * @returns The observation itself for format 8, else a copy without the format 8 fields.
 * @example observationOfFormat({ ...observation, declaredIndex: 0 }, 7).declaredIndex // => undefined
 */
export function observationOfFormat(
  observation: ConfiguredObservation,
  version: number,
): ConfiguredObservation {
  if (version === SERVER_RENDER_STUDY_VERSION) return observation
  const {
    execution: _execution,
    attribution: _attribution,
    operationIndex: _operationIndex,
    declaredIndex: _declaredIndex,
    executionIndex: _executionIndex,
    ...earlier
  } = observation
  return earlier
}

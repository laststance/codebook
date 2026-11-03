import type {
  ConfiguredObservation,
  ConfiguredStudy,
} from '../configuredStudySchemas'

import { usesServerRenderEvidence } from './studyFormatOfConfiguration'

/**
 * Shapes a pause snapshot's observation for the study format being written: format 8 keeps `execution`, `attribution`, `operationIndex`, `declaredIndex` and `executionIndex`, every earlier format drops them so a browser-only study stays the 0.2.72.0 shape.
 * Called by {@link captureStudy} for every observation, because the runtime puts those fields on every pause of every run.
 * @param observation - The observation built from a pause snapshot.
 * @param study - The study being written: its `version` from {@link studyFormatOfConfiguration} and its sealed `configuration`.
 * @returns The observation itself for format 8 rules (format 8, or format 9 with a server stop), else a copy without the format 8 fields.
 * @example observationOfFormat({ ...observation, declaredIndex: 0 }, { version: 7, configuration }).declaredIndex // => undefined
 */
export function observationOfFormat(
  observation: ConfiguredObservation,
  study: Pick<ConfiguredStudy, 'version' | 'configuration'>,
): ConfiguredObservation {
  if (usesServerRenderEvidence(study)) return observation
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

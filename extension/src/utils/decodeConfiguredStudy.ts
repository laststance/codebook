import { sha256 } from '../runtimeSupport/utils/sha256'
import {
  CONFIGURED_CAPTURE_PHASES,
  CROSS_RUNTIME_STUDY_VERSION,
  IMAGE_LIMIT_BYTES,
} from '../constants'
import {
  configuredStudySchema,
  type ConfiguredStudy,
} from '../configuredStudySchemas'
import { validateConfiguredStudyEvidence } from './validateConfiguredStudyEvidence'

/** Validates configured history for storage/replay without consulting current files or granting live pause authority. @example decodeConfiguredStudy(archive, workspaceKey).profile // 'repository-browser' */
export function decodeConfiguredStudy(
  value: unknown,
  workspaceKey: string,
): ConfiguredStudy {
  const study = configuredStudySchema.parse(value)
  validateConfiguredStudyEvidence(study, workspaceKey)
  if (!study.descriptor && study.captures.length)
    throw new Error('Configured evidence has no bound descriptor.')
  const phases = new Set<string>()
  for (const capture of study.captures) {
    if (
      study.version !== CROSS_RUNTIME_STUDY_VERSION &&
      capture.phase === 'paused-server'
    )
      throw new Error('Browser archive cannot contain server captures.')
    const identity = `${capture.phase}:${capture.snapshotId ?? ''}`
    if (
      capture.snapshotId &&
      !study.observations.some(
        (observation) =>
          observation.id === capture.snapshotId &&
          observation.capturePhase === capture.phase,
      )
    )
      throw new Error('Configured image belongs to another observation.')
    if (
      study.version === CROSS_RUNTIME_STUDY_VERSION &&
      capture.phase.startsWith('paused-') &&
      capture.status === 'captured' &&
      !capture.snapshotId
    )
      throw new Error(
        'Cross-runtime pause image needs an exact snapshot identity.',
      )
    if (
      capture.phase.startsWith('paused-') &&
      !capture.snapshotId &&
      study.captures.some((value) => value.snapshotId)
    )
      throw new Error(
        'Configured image phase mixes legacy and snapshot identities.',
      )
    if (phases.has(identity))
      throw new Error('Configured study has duplicate image phases.')
    phases.add(identity)
    if (capture.status !== 'captured') continue
    const bytes = Buffer.from(capture.base64, 'base64')
    if (
      bytes.length > IMAGE_LIMIT_BYTES ||
      bytes.toString('base64') !== capture.base64 ||
      sha256(bytes) !== capture.hash
    )
      throw new Error('Configured captured image changed.')
  }
  for (const step of study.learningSummary?.content.steps ?? []) {
    const reference = step.reference
    if (!reference || !('captureHash' in reference)) continue
    if (
      !study.captures.some(
        (capture) =>
          capture.phase === 'after' &&
          capture.status === 'captured' &&
          capture.hash === reference.captureHash,
      )
    )
      throw new Error('Learning summary result frame changed.')
  }
  // Archive success retains all images; recording contexts reference their independently verified journal instead.
  if (study.finalOutcome === 'demonstrated') {
    const requiredPhases = [
      'before',
      'after',
      ...new Set(
        study.observations.map((observation) => observation.capturePhase),
      ),
    ]
    const requiredImages =
      CONFIGURED_CAPTURE_PHASES.length - 1 + study.observations.length
    if (
      study.captures.length !== requiredImages ||
      study.captures.some((capture) => capture.status !== 'captured') ||
      !requiredPhases.every((phase) =>
        study.captures.some((capture) => capture.phase === phase),
      ) ||
      study.observations.some(
        (observation) =>
          !study.captures.some(
            (capture) =>
              capture.phase === observation.capturePhase &&
              (capture.snapshotId === observation.id ||
                (study.observations.length === 1 && !capture.snapshotId)),
          ),
      )
    )
      throw new Error(
        'Configured completed study is missing required evidence.',
      )
  }
  return study
}

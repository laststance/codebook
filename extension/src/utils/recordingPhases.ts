import {
  CROSS_RUNTIME_CAPTURE_PHASES,
  CONFIGURED_CAPTURE_PHASES,
  CONFIGURED_RECORDING_VERSION,
  CROSS_RUNTIME_RECORDING_VERSION,
} from '../constants'
import type { RecordingBinding, RecordingHeader } from '../recordingSchemas'

/** Supplies repository capture phases to recording admission and playback validation. @example recordingPhases('repository-browser', 3) // ['before', 'paused-browser', 'paused-server', 'after'] */
export function recordingPhases(
  _profile: RecordingBinding['profile'],
  version: RecordingHeader['version'] = CONFIGURED_RECORDING_VERSION,
) {
  return version === CROSS_RUNTIME_RECORDING_VERSION
    ? CROSS_RUNTIME_CAPTURE_PHASES
    : CONFIGURED_CAPTURE_PHASES
}

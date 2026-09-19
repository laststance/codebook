import { STUDY_PROFILES } from 'codebook-cycle-0004/dist/profiles';
import { CONFIGURED_CAPTURE_PHASES, REPOSITORY_BROWSER_PROFILE } from '../constants';
import type { RecordingBinding } from '../recordingSchemas';

/** Restricts phase identity by recorded profile for frame admission, context and playback validation. @example recordingPhases('repository-browser') // ['before', 'paused-browser', 'after'] */
export function recordingPhases(profile: RecordingBinding['profile']) {
  return profile === REPOSITORY_BROWSER_PROFILE ? CONFIGURED_CAPTURE_PHASES : STUDY_PROFILES[profile].capturePhases;
}

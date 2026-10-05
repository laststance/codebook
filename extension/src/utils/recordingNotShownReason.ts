import { withoutErrorName } from './withoutErrorName'

/**
 * Words the reason a presentation state gives while the recording the reader holds failed to load, for {@link StudyWorkspace.presentationState}: the sentence about a captured source that is "not ready" would send the reader to Return to current, which loads no recording.
 * @param failure - The playback controller's reason for the failed load, as it reports it (`Error: …`), or `undefined` when it gave none.
 * @returns One line: what is not shown, why, and the step that loads the recording again.
 * @example
 * recordingNotShownReason('Error: Configured recording article context is unavailable. Reload its saved context.')
 * // => 'The recording is not shown: it could not be loaded (Configured recording article context is unavailable. Reload its saved context.). Open the recording again, then restore the layout.'
 */
export function recordingNotShownReason(failure: string | undefined): string {
  const cause = failure === undefined ? undefined : withoutErrorName(failure)
  return `The recording is not shown: it could not be loaded${cause ? ` (${cause})` : ''}. Open the recording again, then restore the layout.`
}

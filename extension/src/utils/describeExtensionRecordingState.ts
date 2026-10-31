import type { ExtensionRecordingState } from '../chromeExtensionContracts'
import {
  EXTENSION_VIEW_REASON_LIMIT_CHARS,
  EXTENSION_VIEW_RECORDING_TEXT,
} from '../constants'

/**
 * Shortens the cause a history could not start with to the reason the header names: its first sentence without the closing period, cut at a word when it is longer than {@link EXTENSION_VIEW_REASON_LIMIT_CHARS}. The full sentence (with the learner's remedy) stays in the run resource's `historyIssue`.
 * Called by {@link describeExtensionRecordingState} for a run that goes on unrecorded.
 * @param cause - The cause as the run resource words it.
 * @returns The short reason; `history did not start` for an empty cause.
 * @example shortenExtensionNotRecordedReason('Study library is full. Increase the limit in Settings.') // => 'Study library is full'
 */
function shortenExtensionNotRecordedReason(cause: string): string {
  const first = (cause.split(/(?<=[.!?])\s/u)[0] ?? '')
    .replace(/[.!?]+$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (first.length === 0) return 'history did not start'
  if (first.length <= EXTENSION_VIEW_REASON_LIMIT_CHARS) return first
  const cut = first.slice(0, EXTENSION_VIEW_REASON_LIMIT_CHARS - 1)
  const atWord = cut.slice(0, Math.max(cut.lastIndexOf(' '), 1))
  return `${atWord}…`
}

/**
 * Words the recording state at the end of the Application view's provenance line.
 * Called by the extension view on every publish once the run told its state.
 * @param state - Whether the history records, is partial or never started.
 * @returns `Recording for replay`, `Recording partial · <code>` or `Not recorded · <reason>`.
 * @example describeExtensionRecordingState({ kind: 'partial', code: 'EXTENSION_HISTORY_SURFACE_ENDED' }) // => 'Recording partial · EXTENSION_HISTORY_SURFACE_ENDED'
 */
export function describeExtensionRecordingState(
  state: ExtensionRecordingState,
): string {
  switch (state.kind) {
    case 'recording':
      return EXTENSION_VIEW_RECORDING_TEXT.recording
    case 'partial':
      return `${EXTENSION_VIEW_RECORDING_TEXT.partial} · ${state.code}`
    case 'not-recorded':
      return `${EXTENSION_VIEW_RECORDING_TEXT.notRecorded} · ${shortenExtensionNotRecordedReason(state.reason)}`
  }
}

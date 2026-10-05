import { randomUUID } from 'node:crypto'

import { installWebviewFocus } from '../runtimeSupport/utils/installWebviewFocus'
import { STUDY_STYLES, STUDY_UI_OPTIONS } from '../ui/constants'
import type { StudyViewMessage } from '../ui/studyHtml'

import { escapeHtml } from './escapeHtml'

/** Renders a labeled historical PNG or explicit absence without granting a runtime paint receipt. @example capturedAppHtml(message) */
export function capturedAppHtml(message: StudyViewMessage): string {
  const nonce = randomUUID(),
    image = message.model.image,
    observation = message.model.observation
  const failedRecording = message.recording?.readiness === 'failed'
  const nodeHistorySelected = Boolean(message.nodeHistory)
  const label = nodeHistorySelected
    ? 'Node test history · application video unavailable'
    : failedRecording
      ? 'Recorded playback unavailable'
      : message.loading
        ? 'Loading selected observation…'
        : observation
          ? `Captured ${message.model.selectedItem.title} observation · ${observation.capturedAt}`
          : 'No application observation yet'
  // Lead with recovery; retain escaped diagnostics behind an explicit disclosure for the learner's agent.
  const content = nodeHistorySelected
    ? '<p>This saved test history has recorded output, source and debugger stops, but no application video. Select an event in Study to inspect its recorded evidence.</p>'
    : failedRecording
      ? `<p>${STUDY_UI_OPTIONS.playbackFailureRecovery}</p><details><summary>Recording error details</summary><p>${escapeHtml(message.recording?.reason ?? 'The selected recording could not be read.')}</p></details>`
      : !message.loading && image?.status === 'captured'
        ? `<img alt="Application pixels captured at the selected ${escapeHtml(message.model.selectedItem.title)} pause" src="data:image/png;base64,${image.base64}">`
        : `<p>${escapeHtml(message.loading ? 'Waiting for the matching source and observation.' : image?.status === 'captured' ? 'Image unavailable' : (image?.reason ?? 'Run the selected scenario to observe this item.'))}</p>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">${STUDY_STYLES}</style></head><body><p class="status">${escapeHtml(label)}</p>${content}<p class="muted">${nodeHistorySelected ? 'Historical test output. Reading it does not rerun the target.' : 'Historical observation. Reading it does not resume execution.'}</p><script nonce="${nonce}">(${installWebviewFocus.toString()})(acquireVsCodeApi())</script></body></html>`
}

import { randomUUID } from 'node:crypto';
import type { StudyViewMessage } from '../ui/studyHtml';
import { STUDY_STYLES, STUDY_UI_OPTIONS } from '../ui/constants';

/** Renders a labeled historical PNG or explicit absence without granting a runtime paint receipt. @example capturedAppHtml(message) */
export function capturedAppHtml(message: StudyViewMessage): string {
  const nonce = randomUUID(), image = message.model.image, observation = message.model.observation;
  const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  const failedRecording = message.recording?.readiness === 'failed';
  const label = failedRecording ? 'Recorded playback unavailable' : message.loading ? 'Loading selected observation…' : observation ? `Captured ${message.model.selectedItem.title} observation · ${observation.capturedAt}` : 'No application observation yet';
  // Lead with recovery; retain escaped diagnostics behind an explicit disclosure for the learner's agent.
  const content = failedRecording ? `<p>${STUDY_UI_OPTIONS.playbackFailureRecovery}</p><details><summary>Recording error details</summary><p>${escape(message.recording?.reason ?? 'The selected recording could not be read.')}</p></details>`
    : !message.loading && image?.status === 'captured' ? `<img alt="Application pixels captured at the selected ${escape(message.model.selectedItem.title)} pause" src="data:image/png;base64,${image.base64}">` : `<p>${escape(message.loading ? 'Waiting for the matching source and observation.' : image?.status === 'captured' ? 'Image unavailable' : image?.reason ?? 'Run the selected scenario to observe this item.')}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'"><style nonce="${nonce}">${STUDY_STYLES}</style></head><body><p class="status">${escape(label)}</p>${content}<p class="muted">Historical observation. Reading it does not resume execution.</p></body></html>`;
}

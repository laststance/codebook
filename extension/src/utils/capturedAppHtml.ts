import { randomUUID } from 'node:crypto';
import type { StudyViewMessage } from '../ui/studyHtml';
import { STUDY_STYLES } from '../ui/constants';

/** Renders a labeled historical PNG or explicit absence without granting a runtime paint receipt. @example capturedAppHtml(message) */
export function capturedAppHtml(message: StudyViewMessage): string {
  const nonce = randomUUID(), image = message.model.image, observation = message.model.observation;
  const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  const label = message.loading ? 'Loading selected observation…' : observation ? `Captured ${message.model.selectedItem.title} observation · ${observation.capturedAt}` : 'No application observation yet';
  const content = !message.loading && image?.status === 'captured' ? `<img alt="Application pixels captured at the selected ${message.model.selectedItem.title} pause" src="data:image/png;base64,${image.base64}">` : `<p>${escape(message.loading ? 'Waiting for the matching source and observation.' : image?.status === 'captured' ? 'Image unavailable' : image?.reason ?? 'Run the selected scenario to observe this item.')}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'"><style nonce="${nonce}">${STUDY_STYLES}</style></head><body><p class="status">${escape(label)}</p>${content}<p class="muted">Historical observation. Reading it does not resume execution.</p></body></html>`;
}

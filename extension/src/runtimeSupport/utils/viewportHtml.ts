import { randomUUID } from 'node:crypto'

import { INJECTED_DELAY_MS } from '../constants'

import { installWebviewFocus } from './installWebviewFocus'

/**
 * What a chrome-extension run's Application pane shows besides its frame (DR1, DR4, DR8); {@link BrowserViewport.setExtensionPane} sends it whole and the document renders exactly this.
 * Only text the extension host composed; the document writes every field as text, never as HTML.
 */
export interface ExtensionPaneState {
  /** Which document the pane needs: a popup scrolls at its CSS size, a page fits. */
  surface: 'popup' | 'page'
  /** Header line 1, before the phase: `codebook · <name> · Extension popup`. */
  title: string
  /** The status element's text; announced politely when it changes. */
  phase: string
  /** Header line 2: who operates, which profile, the data's origin and that replay is unavailable. */
  provenance: string
  /** A line between the header and the frame: the preparing step, a refusal, or the ended result. Empty hides it. */
  message: string
  /** The frame's image description. */
  imageAlt: string
  /** Visually hidden text after the frame. */
  detail: string
  /** Dims the frame (static opacity) after the surface was lost. */
  dimmed: boolean
}

/**
 * Creates {@link BrowserViewport}'s isolated image renderer; app data enters only through messages, never HTML.
 * @param mode - `recording` renders history pixels; `live` renders the owned browser's stream.
 * @param extensionSurface - Set for a chrome-extension run: its two-line header, status element, scroll container and hidden text. `popup` shows the frame at its own CSS size, scrolled when the pane is smaller (DR7); `page` fits the frame like a repository page. Unset for every other profile.
 * @example viewportHtml() // the repository browser's document
 * @example viewportHtml('live', 'popup') // an extension popup's document
 */
export function viewportHtml(
  mode: 'live' | 'recording' = 'live',
  extensionSurface?: 'popup' | 'page',
): string {
  const nonce = randomUUID()
  const isExtension = extensionSurface !== undefined
  const isPopup = extensionSurface === 'popup'
  const headerMarkup = isExtension
    ? '<header><span id="title"></span><span id="phase" role="status" aria-live="polite">Connecting…</span><div id="provenance"></div></header><div id="message" hidden></div>'
    : `<header>codebook · ${mode === 'recording' ? 'recorded application' : 'actual page stream'} <span id="phase">Connecting…</span></header>`
  const imageAlt =
    mode === 'recording'
      ? 'Historical application pixels from the selected recording'
      : 'Application page from the owned browser'
  const imageMarkup = `<img id="page" hidden alt="${imageAlt}">`
  const bodyMarkup = isExtension
    ? `<div id="scroller"${isPopup ? ' tabindex="0" role="region" aria-label="Extension popup view"' : ''}>${imageMarkup}</div><div id="detail" class="visually-hidden"></div>`
    : imageMarkup
  const popupStyle = isPopup
    ? '#page{flex:none;width:auto;margin:0 auto;object-fit:none;outline:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background)}'
    : ''
  const extensionStyle = isExtension
    ? `#title,#provenance{flex:0 0 auto}#provenance{flex-basis:100%;color:var(--vscode-descriptionForeground)}header{justify-content:flex-start}#message{flex:0 0 auto;padding:8px 12px;white-space:pre-line}#scroller{flex:1;min-height:0;display:flex;flex-direction:column;overflow:${isPopup ? 'auto' : 'hidden'}}#scroller:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}.dimmed #page{opacity:.45}.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}${popupStyle}`
    : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style nonce="${nonce}">html,body{height:100%;overflow:hidden}body{display:flex;flex-direction:column;margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground,var(--vscode-editor-foreground));font:var(--vscode-font-size,13px)/1.5 var(--vscode-font-family,sans-serif)}header{flex:0 0 auto;padding:12px;border-bottom:1px solid var(--vscode-panel-border);display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;overflow-wrap:anywhere}#page{display:block;flex:1;min-height:0;width:100%;object-fit:contain}[hidden]{display:none!important}${extensionStyle}</style></head>
<body>${headerMarkup}${bodyMarkup}
<script nonce="${nonce}">
const api = acquireVsCodeApi();
(${installWebviewFocus.toString()})(api);
const epoch = crypto.randomUUID();
const isExtension = ${isExtension};
const isPopup = ${isPopup};
const page = document.getElementById('page');
const phase = document.getElementById('phase');
let renderRevision = 0;
// A status element announces on a change of its text only, never when a frame repaints.
const showPhase = text => { if (phase.textContent !== text) phase.textContent = text; };
// Writes the extension pane's own text; each field is text, never markup.
const showExtensionPane = pane => {
  document.getElementById('title').textContent = pane.title;
  showPhase(pane.phase);
  document.getElementById('provenance').textContent = pane.provenance;
  const message = document.getElementById('message');
  message.textContent = pane.message;
  message.hidden = pane.message === '';
  page.alt = pane.imageAlt;
  document.getElementById('detail').textContent = pane.detail;
  document.body.classList.toggle('dimmed', pane.dimmed);
};
// Report actual document availability; a selected native tab may still be occluded on macOS.
document.addEventListener('visibilitychange', () => api.postMessage({type:'visibility',epoch,visibility:document.visibilityState}));
window.addEventListener('message', async event => {
  const message = event.data;
  if (message?.type === 'requestReady') { api.postMessage({type:'ready',epoch,requestId:message.requestId,visibility:document.visibilityState}); return; }
  if (!message || message.epoch !== epoch) return;
  if (message.type === 'extension') { if (isExtension) showExtensionPane(message.pane); return; }
  if (message.type === 'reset') { renderRevision++; if (message.clear) { page.hidden = true; page.removeAttribute('src'); } if (!isExtension) phase.textContent = message.clear ? 'Loading recorded position…' : 'Waiting for live frame'; return; }
  if (message.type === 'missing') {
    const revision = ++renderRevision; page.hidden = true; page.removeAttribute('src'); phase.textContent = message.reason;
    requestAnimationFrame(() => requestAnimationFrame(() => { if (revision === renderRevision) api.postMessage({type:'missing-painted',epoch,id:message.id}); })); return;
  }
  if (message.type !== 'frame') return;
  const reportRequiredStage = stage => {
    if (message.required) api.postMessage({type:'frame-stage',epoch,id:message.id,stage,visibility:document.visibilityState,hasArea:document.body.clientWidth > 0 && document.body.clientHeight > 0});
  };
  reportRequiredStage('received');
  const revision = ++renderRevision;
  const decoded = new Image();
  decoded.src = 'data:image/png;base64,' + message.data;
  try { await decoded.decode(); } catch { reportRequiredStage('decode-failed'); return; }
  reportRequiredStage('decoded');
  // Ignore a decode overtaken by a newer frame or pause invalidation.
  if (revision !== renderRevision) return;
  page.src = decoded.src;
  // A popup frame shows at its CSS size: the browser's reported size, else the device pixel ratio turns the frame's pixels back into CSS pixels.
  if (isPopup) {
    const hasCssSize = message.cssWidth > 0 && message.cssHeight > 0;
    page.style.width = (hasCssSize ? message.cssWidth : decoded.naturalWidth / window.devicePixelRatio) + 'px';
    page.style.height = (hasCssSize ? message.cssHeight : decoded.naturalHeight / window.devicePixelRatio) + 'px';
  }
  page.hidden = false;
  // An extension pane's phase comes from its own state, not from the frame.
  if (!isExtension) phase.textContent = message.phase;
  reportRequiredStage('paint-queued');
  requestAnimationFrame(() => { reportRequiredStage('first-frame'); requestAnimationFrame(() => {
    if (revision !== renderRevision) return;
    const acknowledge = () => api.postMessage({type:'painted',epoch,id:message.id});
    if (message.delayAck) setTimeout(acknowledge, ${INJECTED_DELAY_MS}); else acknowledge();
  }); });
});
api.postMessage({type:'ready',epoch});
</script></body></html>`
}

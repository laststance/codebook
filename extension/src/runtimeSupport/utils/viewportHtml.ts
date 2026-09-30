import { randomUUID } from 'node:crypto'

import { INJECTED_DELAY_MS } from '../constants'

import { installWebviewFocus } from './installWebviewFocus'

/** Creates {@link BrowserViewport}'s isolated image renderer; app data enters only through messages, never HTML. @example viewportHtml() */
export function viewportHtml(mode: 'live' | 'recording' = 'live'): string {
  const nonce = randomUUID()
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style nonce="${nonce}">html,body{height:100%;overflow:hidden}body{display:flex;flex-direction:column;margin:0;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font:16px/1.5 system-ui}header{flex:0 0 auto;padding:12px;border-bottom:1px solid var(--vscode-panel-border);display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;overflow-wrap:anywhere}#page{display:block;flex:1;min-height:0;width:100%;object-fit:contain}[hidden]{display:none!important}</style></head>
<body><header>codebook · ${mode === 'recording' ? 'recorded application' : 'actual page stream'} <span id="phase">Connecting…</span></header><img id="page" hidden alt="${mode === 'recording' ? 'Historical application pixels from the selected recording' : 'Application page from the owned browser'}">
<script nonce="${nonce}">
const api = acquireVsCodeApi();
(${installWebviewFocus.toString()})(api);
const epoch = crypto.randomUUID();
const page = document.getElementById('page');
const phase = document.getElementById('phase');
let renderRevision = 0;
// Report actual document availability; a selected native tab may still be occluded on macOS.
document.addEventListener('visibilitychange', () => api.postMessage({type:'visibility',epoch,visibility:document.visibilityState}));
window.addEventListener('message', async event => {
  const message = event.data;
  if (message?.type === 'requestReady') { api.postMessage({type:'ready',epoch,requestId:message.requestId,visibility:document.visibilityState}); return; }
  if (!message || message.epoch !== epoch) return;
  if (message.type === 'reset') { renderRevision++; if (message.clear) { page.hidden = true; page.removeAttribute('src'); } phase.textContent = message.clear ? 'Loading recorded position…' : 'Waiting for live frame'; return; }
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
  page.hidden = false;
  phase.textContent = message.phase;
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

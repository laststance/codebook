import { randomUUID } from 'node:crypto';
import type { projectStudy, StudyArchive } from '../studyModel';
import { STUDY_STYLES, STUDY_UI_OPTIONS } from './constants';

export interface StudyViewMessage {
  type: 'study'; revision: number; model: ReturnType<typeof projectStudy>; study?: Pick<StudyArchive, 'id' | 'state' | 'terminal' | 'createdAt' | 'reason' | 'finalOutcome' | 'links'>;
  liveState?: string; deadlineAt?: string; busy: boolean; saving: boolean; loading: boolean; errors: string[]; canClick: boolean; canRun: boolean;
  moments: { participant: string; title: string; at: string }[]; studies: { id: string; savedAt: string }[];
}
declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): { visited?: string[] } | undefined; setState(state: unknown): void };

/** Supplies a nonce-scoped thin reader; {@link StudyWorkspace} posts typed snapshots separately from HTML. @example studyHtml('context') */
export function studyHtml(kind: 'context' | 'moments'): string {
  const nonce = randomUUID();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src data:;"><style nonce="${nonce}">${STUDY_STYLES}</style></head><body class="${kind === 'moments' ? 'moments-only' : ''}">
<div class="live-strip"><div id="runtime" role="status" aria-live="polite">No running study</div><div class="row"><button data-action="return-current">Return to current pause</button><button class="primary" data-action="continue">Continue inspected pause</button><button data-action="stop">Stop</button></div><small class="muted" id="deadline"></small></div>
<p id="study-state" class="status" hidden></p>
<p id="errors" class="error" role="status" aria-live="polite"></p><button data-action="retry" hidden>Retry storage / refresh</button>
<div ${kind === 'moments' ? 'hidden' : ''}><h1 id="title">Study the cart update</h1><div class="row"><button class="primary" data-action="run">Run paired cart demo</button><button data-action="click">Add to cart once</button><button data-action="connect">Connect your agent</button></div><p class="muted">One explicit click, two real stops: server cart mutation, then browser display update.</p>
<div role="tablist" aria-label="Study content"><button id="overview-tab" role="tab" data-tab="overview" aria-controls="overview" aria-selected="true">Overview</button><button id="live-tab" role="tab" data-tab="live" aria-controls="live-content" aria-selected="false" tabindex="-1">Live</button><button role="tab" disabled aria-disabled="true" title="Recording and replay are not available in this cycle">Recording — later</button></div>
<div id="loading" class="status" hidden>Loading the selected observation…</div><div id="selected"><div class="status" id="observation"></div><div id="overview" role="tabpanel" aria-labelledby="overview-tab"><h2>Source-derived overview</h2><p id="overview-text"></p><button class="link" data-action="source">Read the linked source</button></div><div id="live-content" role="tabpanel" aria-labelledby="live-tab"><section><h2>Agent interpretation</h2><div id="interpretations"></div></section><section><h2>Captured values</h2><p class="muted" id="value-caption"></p><div class="table-scroll"><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody id="values"></tbody></table></div></section></div>
<section><div class="row"><button class="link" data-action="source">Captured / source-derived document</button><button class="link" data-action="current-file">Open current file</button></div><p id="source-version" class="muted"></p><p id="source-drift" class="error"></p><label><input id="understood" type="checkbox"><span>I understand this source revision<span id="save-state" class="muted"></span></span></label><p id="progress" class="muted"></p></section></div>
<section><h2>Source-linked flow</h2><div id="flow"></div><p id="correspondence" class="muted"></p></section>
<section><h2>Workspace panes</h2><div class="row"><button data-action="focus-app">Focus application</button><button data-action="source">Focus source</button><button data-action="focus-context">Focus explanation</button><button data-action="outline">Show learning outline</button><button data-action="arrange">Restore Study arrangement</button></div></section></div>
<section><h2>Observed moments</h2><p class="muted">Captured observations, not video playback.</p><div id="moments" class="moments"></div><label for="studies">Saved studies</label><select id="studies" aria-label="Saved study"><option value="">No saved study yet</option></select></section>
<script nonce="${nonce}">(${studyClient.toString()})(${JSON.stringify(STUDY_UI_OPTIONS)})</script></body></html>`;
}

/** Keeps control DOM stable on state updates so native webview messages do not discard keyboard focus. @example studyClient() */
function studyClient(options: typeof STUDY_UI_OPTIONS): void {
  const api = acquireVsCodeApi(), visited = new Set(api.getState()?.visited ?? []);
  let current: StudyViewMessage | undefined;
  const element = (id: string) => { const found = document.getElementById(id); if (!found) throw new Error(`Missing reader element ${id}`); return found; };
  const send = (message: object) => api.postMessage({ ...message, revision: current?.revision });
  const button = (action: string) => document.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`);
  const text = (id: string, value: string) => { element(id).textContent = value; };
  const strip = document.querySelector<HTMLElement>('.live-strip');
  // Oversized sticky controls must not hide keyboard focus at narrow widths or enlarged text.
  const adaptStrip = () => { if (strip) strip.classList.toggle('flowing', strip.getBoundingClientRect().height > window.innerHeight * options.maxStickyFraction); };
  if (strip) new ResizeObserver(adaptStrip).observe(strip);
  window.addEventListener('resize', adaptStrip);
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button') : null;
    if (!target || target instanceof HTMLButtonElement && target.disabled) return;
    if (target.dataset.action) {
      if (target.classList.contains('link')) { visited.add(target.dataset.action); target.classList.add('visited'); api.setState({ visited: [...visited] }); }
      send({ type: 'action', action: target.dataset.action });
    } else if (target.dataset.tab) send({ type: 'tab', tab: target.dataset.tab });
    else if (target.dataset.item) send({ type: 'select', participant: target.dataset.item });
  });
  element('understood').addEventListener('change', event => {
    if (event.target instanceof HTMLInputElement) { const understood = event.target.checked; event.target.checked = current?.model.selectedUnderstanding.understood ?? false; send({ type: 'understanding', understood }); }
  });
  element('studies').addEventListener('change', event => { if (event.target instanceof HTMLSelectElement && event.target.value) send({ type: 'history', studyId: event.target.value }); });
  document.querySelector('[role="tablist"]')?.addEventListener('keydown', event => {
    if (!(event instanceof KeyboardEvent) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const tab = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'live' : current?.model.selection.tab === 'overview' ? 'live' : 'overview';
    document.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)?.focus(); send({ type: 'tab', tab });
  });
  window.addEventListener('message', event => {
    const message: StudyViewMessage = event.data;
    if (message?.type !== 'study') return;
    current = message; const { model } = message;
    const item = model.progressByItem.find(value => value.participant === model.selection.participant);
    text('title', item?.title ?? 'Study the cart update');
    text('runtime', model.currentParticipant ? `Live paused — ${model.currentParticipant === 'server' ? 'Server cart mutation' : 'Browser display update'}` : `Runtime — ${message.liveState ?? 'not running'}`);
    text('deadline', message.deadlineAt && !message.study?.terminal ? `Demo wall limit: ${new Date(message.deadlineAt).toLocaleTimeString()}. History remains readable after expiry.` : 'Reading history does not restart execution.');
    const outcome = message.study?.finalOutcome;
    const outcomeLabel = outcome === 'demonstrated' ? 'Evidence complete' : outcome === 'partial' ? 'Partial evidence' : outcome === 'not-demonstrated' ? 'Evidence not demonstrated' : 'Evidence checks pending';
    element('study-state').hidden = !message.study;
    text('study-state', message.study ? `${message.study.terminal ? 'Study ended' : 'Study in progress'} — ${outcomeLabel}${message.study.reason ? `. ${message.study.reason}` : ''}` : '');
    text('errors', message.errors.join('\n')); button('retry')!.hidden = !message.errors.length;
    button('continue')!.disabled = message.busy || message.loading || !model.continueArguments;
    button('return-current')!.disabled = !model.currentParticipant || model.matching && model.selection.follow;
    button('stop')!.disabled = message.busy || !message.liveState || message.liveState === 'stopped';
    button('run')!.disabled = message.busy || !message.canRun; button('click')!.disabled = message.busy || !message.canClick;
    element('loading').hidden = !message.loading; element('selected').hidden = message.loading;
    for (const tab of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tab]'))) {
      const selected = tab.dataset.tab === model.selection.tab;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    element('overview').hidden = model.selection.tab !== 'overview'; element('live-content').hidden = model.selection.tab !== 'live';
    text('overview-text', item?.overview ?? 'Source unavailable.');
    text('observation', !model.observation && !model.currentSourceAvailable ? 'Current source unavailable — read a captured observation or retry.' : model.observation ? `${model.matching ? 'Observed in this run — current inspected pause' : 'Captured observation — history'} · ${new Date(model.observation.capturedAt).toLocaleString()}` : 'Not observed — source-derived material only');
    text('source-version', !model.observation && !model.currentSourceAvailable ? 'No current source version could be verified.' : `${model.observation ? 'Captured source' : 'Source-derived document'} · line ${model.source.line} · ${model.source.hash.slice(0, 12)}`);
    text('source-drift', !model.currentSourceAvailable ? 'Current source unavailable. Historical source and understanding are retained.' : model.sourceChanged ? 'Review needed — source changed. This is the captured older revision.' : '');
    const checkbox = element('understood');
    if (checkbox instanceof HTMLInputElement) { checkbox.checked = model.selectedUnderstanding.understood; checkbox.disabled = message.saving || message.loading || !model.selectedUnderstanding.known; }
    text('save-state', message.saving ? 'Saving…' : !model.selectedUnderstanding.known ? 'Understanding storage unavailable' : model.selectedUnderstanding.understood ? `Learner marked understood · ${model.selectedUnderstanding.at ?? ''}` : 'Checked only by you; execution never changes this.');
    text('progress', !model.currentSourceAvailable ? 'Current source unavailable — historical understanding retained.' : `${model.understoodCount} of 2 understood for current source · ${model.reviewCount} needs review`);
    text('value-caption', model.observation ? 'Actual primitive values captured at this stop.' : 'No values captured for this item.');
    element('values').replaceChildren(...Object.entries(model.observation?.values ?? {}).map(([name, value]) => { const row = document.createElement('tr'); for (const content of [name, String(value)]) { const cell = document.createElement('td'); cell.textContent = content; row.append(cell); } return row; }));
    const interpretations = model.observation?.interpretations ?? [];
    element('interpretations').replaceChildren(...(interpretations.length ? interpretations.map(value => { const paragraph = document.createElement('p'); paragraph.className = 'interpretation'; paragraph.textContent = value.text; return paragraph; }) : [document.createTextNode('No agent explanation attached. Captured facts remain available below.')]));
    const focusedItem = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.item : undefined;
    const focusedRegion = document.activeElement?.parentElement?.id;
    element('flow').replaceChildren(...model.progressByItem.map(value => { const link = document.createElement('button'); link.className = 'link'; link.dataset.item = value.participant; link.textContent = value.title; return link; }));
    text('correspondence', message.study?.links.length ? `Runtime correspondence: ${message.study.links.map(link => `${link.id}: ${link.status}`).join(' · ')}` : 'Source-derived link; execution correspondence has not been observed.');
    element('moments').replaceChildren(...message.moments.map(moment => { const control = document.createElement('button'); control.dataset.item = moment.participant; control.textContent = `${moment.title} · ${new Date(moment.at).toLocaleTimeString()}`; control.setAttribute('aria-current', String(moment.participant === model.selection.participant)); return control; }));
    if (!message.moments.length) text('moments', 'No observed moments yet.');
    if (focusedItem && (focusedRegion === 'flow' || focusedRegion === 'moments')) element(focusedRegion).querySelector<HTMLButtonElement>(`[data-item="${focusedItem}"]`)?.focus({ preventScroll: true });
    const studies = element('studies');
    if (studies instanceof HTMLSelectElement) {
      const previous = studies.value;
      studies.replaceChildren(...message.studies.map(study => { const option = document.createElement('option'); option.value = study.id; option.textContent = `Study ${study.id.slice(-8)} · ${new Date(study.savedAt).toLocaleString()}`; return option; }));
      studies.value = model.selection.studyId ?? previous;
    }
    for (const link of Array.from(document.querySelectorAll<HTMLButtonElement>('.link[data-action]'))) link.classList.toggle('visited', visited.has(link.dataset.action ?? ''));
    api.postMessage({ type: 'rendered', revision: message.revision, participant: model.selection.participant, snapshotUri: model.observation?.snapshotUri });
  });
  api.postMessage({ type: 'ready' });
}

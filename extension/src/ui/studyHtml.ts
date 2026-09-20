import { randomUUID } from 'node:crypto';
import type { StudyCatalogEntry } from '../studySchemas';
import type { LiveStudy, projectStudy } from '../studyModel';
import type { RetainedStudy } from '../retainedStudySchemas';
import type { StudyDescriptor } from '../utils/describeStudy';
import type { PlaybackState, PlaybackBundle } from '../playbackController';
import { STUDY_STYLES, STUDY_UI_OPTIONS } from './constants';

export interface StudyViewMessage {
  type: 'study'; revision: number; model: ReturnType<typeof projectStudy>; study?: Pick<RetainedStudy, 'id' | 'state' | 'terminal' | 'createdAt' | 'reason' | 'profile' | 'finalOutcome' | 'links'> & { historyOutcome: string; studyOutcome: string; recordingSave?: Pick<LiveStudy['recording'], 'status' | 'contextStatus' | 'reason' | 'contextReason'> };
  liveState?: string; deadlineAt?: string; busy: boolean; saving: boolean; loading: boolean; errors: string[]; canClick: boolean; canRun: boolean;
  nextAction?: StudyDescriptor['actions'][number]; liveProfile?: RetainedStudy['profile']; liveTitle?: string; profiles: Pick<StudyDescriptor, 'id' | 'title' | 'description'>[];
  moments: { id: string; itemId: string; title: string; at: string; elapsedMs?: number }[]; studies: StudyCatalogEntry[];
  contentTab?: 'overview' | 'live' | 'recording';
  repositoryReturnAvailable?: boolean;
  repositoryArticleAvailable?: boolean;
  recording?: PlaybackState & Pick<PlaybackBundle['projection'], 'pauseConfirmed' | 'rendererConfirmed' | 'laterInterpretations'>;
}
declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): { visited?: string[] } | undefined; setState(state: unknown): void };

/** Supplies a nonce-scoped thin reader; {@link StudyWorkspace} posts typed snapshots separately from HTML. @example studyHtml('context') */
export function studyHtml(kind: 'context' | 'moments'): string {
  const nonce = randomUUID();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src data:;"><style nonce="${nonce}">${STUDY_STYLES}</style></head><body class="${kind === 'moments' ? 'moments-only' : ''}">
<button data-action="return-wiki" hidden>← Return to Wiki</button><button data-action="open-article" hidden>Open article</button><div class="live-strip"><div id="runtime" role="status" aria-live="polite">No running study</div><div class="row"><button data-action="return-current">Return to current pause</button><button class="primary" data-action="continue">Continue inspected pause</button><button data-action="stop">Stop</button></div><small class="muted" id="deadline"></small></div>
<p id="study-state" class="status" hidden></p><p id="recording-save-state" class="status" role="status" aria-live="polite" hidden></p>
<p id="errors" class="error" role="status" aria-live="polite"></p><button data-action="retry" hidden>Retry storage / refresh</button>
<section id="recording-transport" aria-label="Recorded playback" hidden><h2>Recorded walkthrough</h2><p id="recording-status" role="status" aria-live="polite"></p><div class="row"><button class="primary" id="playback-toggle" data-playback="play">Play recording</button><button data-playback="start">Replay from start</button><button data-action="reload-recording">Reload saved recording</button></div><label for="playhead">Recorded position</label><input id="playhead" type="range" min="0" max="0" step="1" value="0"><p id="playback-position"></p><p id="playback-pending" class="muted"></p><p id="playback-reason" class="error"></p><details id="playback-diagnostics" hidden><summary>Recording error details</summary><p id="playback-diagnostic" class="error"></p></details><p class="muted">Playback changes this reader only. It does not run application code or mark understanding.</p></section>
<div ${kind === 'moments' ? 'hidden' : ''}><h1 id="title">Study the checkout flow</h1><div id="next-scenario"><label for="profiles">Scenario for the next run</label><select id="profiles" aria-label="Study scenario"><option value="checkout-demo">Checkout demo</option><option value="paired-cart-demo">Paired cart demo</option></select><div class="row"><button class="primary" data-action="run">Run selected scenario</button><button data-action="click">Add to cart once</button><button data-action="connect">Connect your agent</button></div><p class="muted" id="profile-description">Choose a local demo to connect the screen with its actual source and values.</p></div>
<div role="tablist" aria-label="Study content"><button id="overview-tab" role="tab" data-tab="overview" aria-controls="overview" aria-selected="true">Overview</button><button id="live-tab" role="tab" data-tab="live" aria-controls="live-content" aria-selected="false" tabindex="-1">Live</button><button id="recording-tab" role="tab" data-tab="recording" aria-controls="live-content" aria-selected="false" tabindex="-1">Recording</button></div>
<div id="loading" class="status" hidden>Loading the selected observation…</div><div id="selected"><div class="status" id="observation"></div><div id="overview" role="tabpanel" aria-labelledby="overview-tab"><h2>Source-derived overview</h2><p id="overview-text"></p><button class="link" data-action="source">Read the linked source</button></div><div id="live-content" role="tabpanel" aria-labelledby="live-tab"><section><h2>Agent interpretation</h2><div id="interpretations"></div></section><section><h2 id="captured-values-heading">Captured values</h2><p class="muted" id="value-caption"></p><div class="table-scroll"><table aria-labelledby="captured-values-heading" aria-describedby="value-caption"><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody id="values"></tbody></table></div></section></div>
<details id="later-annotations" hidden><summary>Later annotations — not available at this recorded time</summary><p class="muted">These explanations were added later. They do not change what was observed in the recording.</p><div id="later-interpretations"></div></details>
<section><div class="row"><button class="link" data-action="source">Captured / source-derived document</button><button class="link" data-action="current-file">Open current file</button></div><p id="source-version" class="muted"></p><p id="source-drift" class="error"></p><label><input id="understood" type="checkbox" aria-describedby="understanding-description"><span><span id="understanding-label">I understand this source revision</span><span id="save-state" class="muted"></span></span></label><p id="understanding-description" class="muted" hidden>Applies to this article and every captured citation shown here.</p><p id="progress" class="muted"></p></section></div>
<section><h2>Source-linked flow</h2><div id="flow"></div><p id="correspondence" class="muted"></p></section>
<section><h2>Workspace panes</h2><div class="row"><button data-action="focus-app">Focus application</button><button data-action="source">Focus source</button><button data-action="focus-context">Focus explanation</button><button data-action="outline">Show learning outline</button><button data-action="arrange">Restore Study arrangement</button></div></section></div>
<section><h2>Observed moments</h2><p class="muted" id="moments-caption">Select a captured observation or open Recording to follow its time.</p><div id="moments" class="moments"></div><label for="studies">Saved studies</label><select id="studies" aria-label="Saved study"><option value="">No saved study yet</option></select></section>
<script nonce="${nonce}">(${studyClient.toString()})(${JSON.stringify(STUDY_UI_OPTIONS)})</script></body></html>`;
}

/** Keeps control DOM stable on state updates so native webview messages do not discard keyboard focus. @example studyClient() */
function studyClient(options: typeof STUDY_UI_OPTIONS): void {
  const api = acquireVsCodeApi(), visited = new Set(api.getState()?.visited ?? []);
  let current: StudyViewMessage | undefined;
  let scrubbing = false;
  const element = (id: string) => { const found = document.getElementById(id); if (!found) throw new Error(`Missing reader element ${id}`); return found; };
  const send = (message: object) => api.postMessage({ ...message, revision: current?.revision });
  const button = (action: string) => document.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`);
  const text = (id: string, value: string) => { const target = element(id); if (target.textContent !== value) target.textContent = value; };
  const renderKeys = new Map<string, string>();
  const replace = (id: string, data: unknown, children: () => Node[]) => { const key = JSON.stringify(data); if (renderKeys.get(id) !== key) { renderKeys.set(id, key); element(id).replaceChildren(...children()); } };
  const seconds = (elapsed: number) => `${(elapsed / options.secondMs).toFixed(2)} s`;
  const playback = (action: 'play' | 'pause' | 'seek', positionMs?: number) => { if (current?.recording) send({ type: 'playback', action, expectedRevision: current.recording.revision, ...(positionMs === undefined ? {} : { positionMs }) }); };
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
    } else if (target.dataset.playback) {
      if (target.dataset.playback === 'start' && current?.recording?.range) playback('seek', current.recording.range.startMs);
      else if (target.dataset.playback === 'play' || target.dataset.playback === 'pause') playback(target.dataset.playback);
    } else if (target.dataset.tab) send({ type: 'tab', tab: target.dataset.tab });
    else if (target.dataset.item) send({ type: 'select', itemId: target.dataset.item });
  });
  element('understood').addEventListener('change', event => {
    if (event.target instanceof HTMLInputElement) { const understood = event.target.checked; event.target.checked = current?.model.selectedUnderstanding.understood ?? false; send({ type: 'understanding', understood }); }
  });
  element('profiles').addEventListener('change', event => { if (event.target instanceof HTMLSelectElement) send({ type: 'profile', profile: event.target.value }); });
  element('studies').addEventListener('change', event => { if (event.target instanceof HTMLSelectElement && event.target.value) send({ type: 'history', studyId: event.target.value }); });
  element('playhead').addEventListener('pointerdown', () => { scrubbing = true; });
  element('playhead').addEventListener('blur', () => { scrubbing = false; });
  element('playhead').addEventListener('change', event => { scrubbing = false; if (event.target instanceof HTMLInputElement) playback('seek', Number(event.target.value)); });
  element('playhead').addEventListener('keydown', event => {
    if (!(event instanceof KeyboardEvent) || !current?.recording?.range || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const { startMs, endMs } = current.recording.range, position = current.recording.presentedMs ?? startMs;
    const distance = event.key.startsWith('Page') ? options.pageStepMs : options.secondMs;
    const forward = ['ArrowRight', 'ArrowUp', 'PageUp'].includes(event.key);
    playback('seek', event.key === 'Home' ? startMs : event.key === 'End' ? endMs : Math.min(endMs, Math.max(startMs, position + (forward ? distance : -distance))));
  });
  document.querySelector('[role="tablist"]')?.addEventListener('keydown', event => {
    if (!(event instanceof KeyboardEvent) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const tabs = ['overview', 'live', 'recording'], selected = tabs.indexOf(current?.contentTab ?? current?.model.selection.tab ?? 'overview');
    const tab = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(selected + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    document.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)?.focus(); send({ type: 'tab', tab });
  });
  window.addEventListener('message', event => {
    const message: StudyViewMessage = event.data;
    if (message?.type !== 'study') return;
    current = message; const { model, recording } = message, contentTab = message.contentTab ?? model.selection.tab;
    button('return-wiki')!.hidden = !message.repositoryReturnAvailable;
    button('open-article')!.hidden = !message.repositoryArticleAvailable || Boolean(message.repositoryReturnAvailable);
    // Offline replay prioritizes its own controls; an independently active runtime keeps its explicit stop/return strip.
    if (strip) strip.hidden = Boolean(recording && (!message.liveState || message.liveState === 'stopped'));
    element('next-scenario').hidden = Boolean(recording);
    element('recording-transport').hidden = !recording;
    if (recording) {
      const range = recording.range, pending = recording.cleared && recording.readiness === 'loading';
      text('recording-status', recording.readiness === 'failed' ? 'Playback stopped — presentation unavailable' : pending ? 'Loading matching image, source and values…' : `${recording.mode === 'playing' ? 'Playing' : 'Paused'} · ${recording.recordingStatus ?? 'Loading recording'}`);
      text('playback-position', `${recording.presentedMs === undefined ? 'No position presented' : `Presented ${seconds(recording.presentedMs)}`}${range ? ` / ${seconds(range.endMs)}${range.endKnown ? '' : ' — last verified time; end unknown'}` : ''}`);
      text('playback-pending', pending ? `Requested ${recording.requestedMs === undefined ? 'saved position' : seconds(recording.requestedMs)}. Waiting for a matching presentation.` : '');
      const failed = recording.readiness === 'failed', diagnostic = [recording.reason, recording.recordingReason, recording.contextReason, recording.missing].filter(Boolean).join('\n');
      // Keep recovery readable while preserving copyable technical detail and nonfailed partial-recording warnings.
      text('playback-reason', failed ? options.playbackFailureRecovery : diagnostic);
      text('playback-diagnostic', failed ? diagnostic : '');
      element('playback-diagnostics').hidden = !failed || !diagnostic;
      const toggle = element('playback-toggle');
      if (toggle instanceof HTMLButtonElement) { const pause = recording.mode === 'playing' || pending; toggle.dataset.playback = pause ? 'pause' : 'play'; toggle.textContent = pause ? 'Pause playback' : 'Play recording'; toggle.disabled = !pause && (recording.readiness !== 'ready' || !range || recording.presentedMs === range.endMs); }
      const start = document.querySelector<HTMLButtonElement>('[data-playback="start"]'); if (start) start.disabled = !range;
      const playhead = element('playhead');
      if (playhead instanceof HTMLInputElement) {
        playhead.disabled = !range; playhead.min = String(range?.startMs ?? 0); playhead.max = String(range?.endMs ?? 0);
        if (!scrubbing) playhead.value = String(recording.presentedMs ?? range?.startMs ?? 0);
        playhead.setAttribute('aria-valuetext', recording.presentedMs === undefined ? 'No recorded position presented' : `${seconds(recording.presentedMs)} presented${range?.endKnown === false ? '; recording end unknown' : ''}`);
      }
    }
    const item = model.progressByItem.find(value => value.id === model.selection.itemId);
    text('title', item?.title ?? 'Study the checkout flow');
    const selectedProfile = message.profiles.find(profile => profile.id === model.selection.profile), liveProfile = message.profiles.find(profile => profile.id === message.liveProfile);
    const profiles = element('profiles');
    if (profiles instanceof HTMLSelectElement) { replace('profiles', message.profiles, () => message.profiles.map(profile => { const option = document.createElement('option'); option.value = profile.id; option.textContent = profile.title; return option; })); profiles.value = model.selection.profile; profiles.disabled = message.busy || Boolean(message.liveState && message.liveState !== 'stopped'); }
    text('profile-description', model.selection.profile === 'repository-browser' ? 'Ask your agent to prepare a new operation in this article. Reading saved configuration never starts it. You can choose a demo separately.' : selectedProfile?.description ?? 'Scenario unavailable.');
    text('runtime', model.currentItemId ? `${message.liveTitle ?? liveProfile?.title ?? 'Live study'} — paused at ${model.currentItemTitle}` : `${message.liveTitle ?? liveProfile?.title ?? 'Runtime'} — ${message.nextAction?.id === 'checkout' ? 'Cart updated — checkout available' : message.liveState ?? 'not running'}`);
    text('deadline', message.deadlineAt && !message.study?.terminal ? `Study wall limit: ${new Date(message.deadlineAt).toLocaleTimeString()}. History remains readable after expiry.` : 'Reading history does not restart execution.');
    const outcome = message.study?.studyOutcome;
    const scenario = model.scenarioProgress;
    const outcomeLabel = outcome === 'demonstrated' ? message.study?.profile === 'checkout-demo' ? 'Purchase confirmed — observation saved' : 'Observation saved'
      : outcome === 'partial' ? scenario?.purchaseObserved ? 'Purchase observed — partial evidence' : 'Partial evidence'
      : outcome === 'not-demonstrated' ? 'Evidence not demonstrated' : scenario?.purchaseObserved && message.study?.terminal ? 'Purchase observed — evidence checks pending' : 'Evidence checks pending';
    const endedProgress = message.study?.terminal && !recording ? ` Last observed stop: ${scenario?.lastObservedTitle ?? 'none'}.${message.study.profile === 'checkout-demo' && !scenario?.purchaseObserved ? ' Purchase confirmation screen was not observed.' : ''}` : '';
    const missingEvidence = message.study?.terminal && scenario ? [scenario.missingImageTitles.length ? `Missing images: ${scenario.missingImageTitles.join(', ')}.` : '', scenario.unverifiedLinkCount ? `${scenario.unverifiedLinkCount} runtime connections unverified.` : ''].filter(Boolean).join(' ') : '';
    element('study-state').hidden = !message.study || Boolean(recording && document.body.classList.contains('moments-only'));
    text('study-state', message.study ? `${recording ? 'Recorded study (whole run)' : message.study.terminal ? 'Study ended' : 'Study in progress'} — ${outcomeLabel} · runtime: ${message.study.finalOutcome} · history: ${message.study.historyOutcome}.${endedProgress}${missingEvidence ? ` ${missingEvidence}` : ''}${message.study.reason ? ` ${message.study.reason}` : ''}` : '');
    const savedRecording = message.study?.recordingSave;
    const recordingLabel = !savedRecording ? 'Recording not verified in this reader. Open Recording to inspect its saved evidence.'
      : savedRecording.status === 'partial' || savedRecording.status === 'failed' || savedRecording.contextStatus === 'failed' ? `Recording incomplete: ${savedRecording.reason ?? savedRecording.contextReason ?? 'Matching recording evidence is unavailable.'} Use Retry storage / refresh or open Recording to inspect retained evidence.`
      : savedRecording.status === 'finalized' && savedRecording.contextStatus === 'saved' ? 'Recording saved.'
      : savedRecording.status === 'recording' ? 'Recording in progress; saving is not complete.'
      : savedRecording.status === 'finalized' ? 'Recording frames saved; matching source and explanation context is pending.' : 'Recording unavailable for this study.';
    text('recording-save-state', message.study ? recordingLabel : ''); element('recording-save-state').hidden = !message.study;
    text('errors', message.errors.join('\n')); button('retry')!.hidden = !message.errors.length && savedRecording?.contextStatus !== 'failed' && savedRecording?.status !== 'failed' && savedRecording?.status !== 'partial';
    button('continue')!.disabled = message.busy || message.loading || !model.continueArguments;
    button('return-current')!.disabled = !model.currentParticipant || model.matching && model.selection.follow;
    button('stop')!.disabled = message.busy || !message.liveState || message.liveState === 'stopped';
    button('run')!.hidden = model.selection.profile === 'repository-browser'; button('run')!.disabled = message.busy || !message.canRun; button('click')!.disabled = message.busy || !message.canClick;
    button('run')!.textContent = `Run ${selectedProfile?.title ?? 'selected scenario'}`;
    button('click')!.textContent = message.nextAction ? `${message.nextAction.title} once` : 'No action available';
    button('stop')!.textContent = liveProfile ? `Stop ${message.liveTitle ?? liveProfile.title}` : 'Stop';
    element('loading').hidden = !message.loading;
    text('loading', recording?.readiness === 'failed' ? 'Recorded context unavailable. Reload after resolving the reported problem.' : 'Loading the selected observation…'); element('selected').hidden = message.loading;
    for (const tab of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tab]'))) {
      const selected = tab.dataset.tab === contentTab;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    element('overview').hidden = contentTab !== 'overview'; element('live-content').hidden = contentTab === 'overview';
    element('live-content').setAttribute('aria-labelledby', contentTab === 'recording' ? 'recording-tab' : 'live-tab');
    text('overview-text', item?.overview ?? 'Source unavailable.');
    text('observation', recording ? model.observation ? `Recorded observation · ${seconds(model.observation.elapsedMs)}${recording.pauseConfirmed ? ' · pause verified' : ''}${recording.rendererConfirmed ? ' · original renderer receipt available' : ''}` : 'No source or values were observed by this recorded position.' : !model.observation && !model.currentSourceAvailable ? 'Current source unavailable — read a captured observation or retry.' : model.observation ? `${model.matching ? 'Observed in this run — current inspected pause' : 'Captured observation — history'} · ${new Date(model.observation.capturedAt).toLocaleString()}` : message.study?.terminal ? 'Not observed before this study ended — source-derived material only' : 'Not observed — source-derived material only');
    text('source-version', recording && !model.observation ? 'No captured source at this time. The source pane shows an explicit placeholder.' : !model.observation && !model.currentSourceAvailable ? 'No current source version could be verified.' : `${model.observation ? 'Captured source' : 'Source-derived document'} · line ${model.source.line} · ${model.source.hash.slice(0, 12)}`);
    text('understanding-label', model.selection.profile === 'repository-browser' ? 'understand' : 'I understand this source revision');
    element('understanding-description').hidden = model.selection.profile !== 'repository-browser';
    text('source-drift', !model.currentSourceAvailable ? 'Current source unavailable. Historical source and understanding are retained.' : model.sourceChanged ? model.selection.profile === 'repository-browser' ? 'Review needed — a cited source changed. Historical understanding still refers to the complete captured citation set.' : 'Review needed — source changed. This is the captured older revision.' : '');
    const checkbox = element('understood');
    if (checkbox instanceof HTMLInputElement) { checkbox.checked = model.selectedUnderstanding.understood; checkbox.disabled = message.saving || message.loading || !model.selectedUnderstanding.known; }
    text('save-state', message.saving ? 'Saving…' : !model.selectedUnderstanding.known ? 'Understanding storage unavailable' : model.selectedUnderstanding.understood ? `Learner marked understood · ${model.selectedUnderstanding.at ?? ''}` : 'Checked only by you; execution never changes this.');
    text('progress', !model.currentSourceAvailable ? 'Current source unavailable — historical understanding retained.' : `${model.understoodCount} of ${model.progressByItem.length} understood for current source · ${model.reviewCount} needs review`);
    text('value-caption', model.observation ? 'Actual primitive values captured at this stop.' : 'No values captured for this item.');
    const unavailable = model.observation?.actionId === 'repository-click' ? model.observation.unavailableValues : [];
    replace('values', [model.observation?.values, unavailable], () => [...Object.entries(model.observation?.values ?? {}).map(([name, value]) => [name, String(value)]), ...unavailable.map(value => [value.path, `Unavailable: ${value.reason}`])].map(contents => { const row = document.createElement('tr'); for (const content of contents) { const cell = document.createElement('td'); cell.textContent = content; row.append(cell); } return row; }));
    const interpretations = model.observation?.interpretations ?? [];
    replace('interpretations', [Boolean(recording), interpretations], () => interpretations.length ? interpretations.map(value => { const paragraph = document.createElement('p'); paragraph.className = 'interpretation'; paragraph.textContent = value.text; return paragraph; }) : [document.createTextNode(recording ? 'No explanation was available by this recorded time.' : 'No agent explanation attached. Captured facts remain available below.')]);
    const later = recording?.laterInterpretations ?? []; element('later-annotations').hidden = !later.length;
    replace('later-interpretations', later, () => later.map(value => { const paragraph = document.createElement('p'); paragraph.className = 'interpretation'; paragraph.textContent = `${value.availableMs === null ? 'Availability time unknown' : `Added at ${seconds(value.availableMs)}${recording?.range && value.availableMs > recording.range.endMs ? ' — after recording ended' : ''}`} · ${value.text}`; return paragraph; }));
    const focusedItem = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.item : undefined;
    const focusedRegion = document.activeElement?.parentElement?.id;
    replace('flow', model.progressByItem.map(value => [value.id, value.title]), () => model.progressByItem.map(value => { const link = document.createElement('button'); link.className = 'link'; link.dataset.item = value.id; link.textContent = value.title; return link; }));
    text('correspondence', recording ? 'Select an observed moment to seek. Source relationships are not inferred from video frames.' : message.study?.profile === 'repository-browser' ? 'One browser action is declared. Article relationships remain source-derived interpretations.' : message.study?.links.length ? `Runtime correspondence: ${message.study.links.map(link => `${link.id}: ${link.status}`).join(' · ')}` : 'Source-derived link; execution correspondence has not been observed.');
    replace('moments', [message.moments, model.observation?.id, Boolean(recording)], () => message.moments.map(moment => { const control = document.createElement('button'); control.dataset.item = moment.itemId; control.dataset.observation = moment.id; control.textContent = `${moment.title} · ${recording && moment.elapsedMs !== undefined ? seconds(moment.elapsedMs) : new Date(moment.at).toLocaleTimeString()}`; control.setAttribute('aria-current', String(moment.id === model.observation?.id)); return control; }));
    if (!message.moments.length) text('moments', 'No observed moments yet.');
    if (focusedItem && (focusedRegion === 'flow' || focusedRegion === 'moments')) element(focusedRegion).querySelector<HTMLButtonElement>(`[data-item="${focusedItem}"]`)?.focus({ preventScroll: true });
    const studies = element('studies');
    if (studies instanceof HTMLSelectElement) {
      const previous = studies.value;
      // Unloaded configured entries must not borrow the selected article's title through a shared profile ID.
      replace('studies', message.studies, () => message.studies.map(study => { const option = document.createElement('option'); option.value = study.id; option.textContent = `${study.profile === 'repository-browser' ? 'Repository browser study' : message.profiles.find(profile => profile.id === study.profile)?.title ?? 'Unknown scenario'}${study.format === 'legacy-v1' ? ' (legacy)' : ''} · ${new Date(study.savedAt).toLocaleString()} · ${study.outcome} · ${study.id.slice(-8)}`; return option; }));
      studies.value = model.selection.studyId ?? previous;
    }
    for (const link of Array.from(document.querySelectorAll<HTMLButtonElement>('.link[data-action]'))) link.classList.toggle('visited', visited.has(link.dataset.action ?? ''));
    api.postMessage({ type: 'rendered', revision: message.revision, itemId: model.selection.itemId, snapshotUri: model.observation?.snapshotUri, ...(recording ? { presentationRevision: recording.presentationRevision } : {}) });
  });
  api.postMessage({ type: 'ready' });
}

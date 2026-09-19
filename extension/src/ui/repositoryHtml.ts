import { randomUUID } from 'node:crypto';
import { REPOSITORY_NARROW_WIDTH_PX, REPOSITORY_READER_DEBOUNCE_MS, REPOSITORY_VISITED_CITATIONS_LIMIT } from '../constants';
import type { RepositorySelection } from '../learnerSchemas';
import type { RepositoryViewMessage } from '../repositoryView';
import { STUDY_STYLES } from './constants';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): { key?: string; location?: RepositorySelection['location']; visited?: string[] } | undefined; setState(state: unknown): void };

/** Renders the approved compact article shell; {@link RepositoryReader} supplies escaped-by-DOM typed content separately. @example repositoryHtml() */
export function repositoryHtml(): string {
  const nonce = randomUUID();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Repository Wiki · codebook</title><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">${STUDY_STYLES}
body{padding:20px 24px;font-size:16px;line-height:1.5}button,select{font:inherit}button{min-height:44px}h1{font-size:20px;line-height:1.3;margin:12px 0}h2{font-size:16px}.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:12px}.toolbar select{max-width:100%;min-height:44px}.layout{display:grid;grid-template-columns:minmax(0,72ch) minmax(210px,30ch);gap:24px}.article{min-width:0}.article section{border-top:1px solid var(--vscode-panel-border);padding:16px 0;margin:0}.article p{white-space:pre-wrap;overflow-wrap:anywhere}.badges{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.badge{font-size:13px;padding:2px 6px;border:1px solid var(--vscode-panel-border);border-radius:3px}.interpretation{border-left:3px solid var(--vscode-textLink-foreground);padding-left:12px}.context{min-width:0;border-left:1px solid var(--vscode-panel-border);padding-left:16px}.context button{display:block;text-align:left;width:100%;margin-bottom:4px;overflow-wrap:anywhere}.context h2{margin-top:20px}.context p,.context li{font-size:14px;overflow-wrap:anywhere}.context ol{padding-left:20px}.understanding{display:flex;align-items:center;min-height:44px;gap:10px}.understanding input{width:16px;height:16px;margin:0}.history{font-size:13px;overflow-wrap:anywhere}.source-link{max-width:100%;text-align:left;overflow-wrap:anywhere}.contents-compact{display:none}#state{min-height:24px}#errors:empty{display:none}#latest{margin:12px 0}#article-title:focus{outline:1px solid var(--vscode-focusBorder)}
.visually-hidden{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media(max-width:${REPOSITORY_NARROW_WIDTH_PX - 1}px){body{padding:16px}.layout{display:block}.context{border-left:0;border-top:1px solid var(--vscode-panel-border);padding:0}.contents-wide{display:none}.contents-compact{display:block}.toolbar{align-items:stretch}.toolbar select{width:100%}}
</style></head><body><header class="toolbar"><strong>Repository Wiki</strong><label for="books">Book</label><select id="books"></select><label for="versions">Revision</label><select id="versions"></select><button id="refresh" data-action="refresh">Refresh</button><button id="connect" data-action="connect">Connect agent</button></header>
<p id="state" role="status" aria-live="polite">Loading repository library…</p><p id="errors" class="error" role="status" aria-live="polite"></p><button id="retry" data-action="retry" hidden>Retry storage / refresh</button><div id="latest" hidden><span id="latest-text"></span> <button id="load-latest" data-action="latest">Load latest</button></div>
<div id="empty" hidden><h1>Your repository learning book</h1><p>Connect your agent, ask it to read repository sources and publish a learning book. Source reading and articles work without starting an application.</p></div>
<div id="reader" class="layout" hidden><article class="article"><header data-reading-region><nav aria-label="Wiki articles"><label for="nodes">Article</label><select id="nodes"></select></nav><h1 id="article-title" tabindex="-1"></h1><div class="badges"><span class="badge">Source-derived</span><span class="badge">Agent interpretation</span></div><p id="summary" class="muted"></p><details class="contents-compact"><summary>Contents</summary><nav id="contents-compact" aria-label="Article contents"></nav></details></header><div id="sections"></div><section data-reading-region><h2>Cited source</h2><div id="anchors"></div><button id="current-file" data-action="current-file">Open verified current file</button><p id="source-status" class="muted"></p></section><section data-reading-region><h2>Related observations</h2><div id="observations"></div></section><section data-reading-region><label class="understanding" for="understand"><input id="understand" type="checkbox" aria-describedby="progress-description"><span>understand</span><span id="save-state" class="muted"></span></label><span id="progress-description" class="visually-hidden">Your understanding applies to every citation in this article.</span><p id="progress-status" class="muted"></p><details><summary>Understanding history</summary><div id="history" class="history"></div></details></section></article><aside class="context" aria-label="Article context"><div class="contents-wide"><h2>Article navigation</h2><nav id="contents-wide"></nav></div><h2>Source-derived relationships</h2><p class="muted">Agent interpretation of cited code; runtime order requires linked observations.</p><div id="relations"></div><button id="back-top">Back to top ↑</button></aside></div>
<script nonce="${nonce}">(${repositoryClient.toString()})(${REPOSITORY_READER_DEBOUNCE_MS},${REPOSITORY_VISITED_CITATIONS_LIMIT})</script></body></html>`;
}

/** Keeps article DOM stable during status updates and restores section-relative reading context after width changes. @example repositoryClient(150, 512) */
function repositoryClient(debounceMs: number, visitedLimit: number): void {
  const api = acquireVsCodeApi(); let saved = api.getState(); const visited = new Set(saved?.visited ?? []);
  let current: RepositoryViewMessage | undefined, contentKey = '', presentedRevision = -1, location: RepositorySelection['location'], restoring = false, timer: ReturnType<typeof setTimeout> | undefined;
  const element = (id: string) => document.getElementById(id)!;
  const text = (id: string, value: string) => { element(id).textContent = value; };
  const send = (value: object) => api.postMessage({ ...value, revision: current?.revision });
  const button = (label: string, id: string, action: () => void) => { const value = document.createElement('button'); value.textContent = label; value.id = id; value.onclick = action; return value; };
  const choose = (target: HTMLElement, entries: { value: string; label: string }[], selected: string) => {
    if (!(target instanceof HTMLSelectElement)) return;
    const signature = JSON.stringify(entries);
    if (target.dataset.options !== signature) { target.replaceChildren(...entries.map(entry => { const option = document.createElement('option'); option.value = entry.value; option.textContent = entry.label; return option; })); target.dataset.options = signature; }
    target.value = selected;
  };
  const capture = () => {
    if (!current?.selection) return undefined;
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-section]'));
    let sectionIndex = 0;
    sections.forEach((section, index) => { if (section.getBoundingClientRect().top <= 1) sectionIndex = index; });
    const section = sections[sectionIndex], top = section?.getBoundingClientRect().top ?? 0;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
    return { sectionIndex, fraction: section ? Math.min(1, Math.max(0, -top / Math.max(1, section.offsetHeight))) : 0, focusId: active || location?.focusId || 'article-title' };
  };
  const persist = () => {
    if (restoring || !current?.selection || current.loading) return;
    location = capture(); api.setState({ key: contentKey, location, visited: [...visited] });
    send({ type: 'location', selection: { ...current.selection, location } });
  };
  const restore = (focus: boolean) => {
    if (!location) return;
    restoring = true;
    const section = document.querySelector<HTMLElement>(`[data-section="${location.sectionIndex}"]`);
    if (section) window.scrollTo(0, window.scrollY + section.getBoundingClientRect().top + section.offsetHeight * location.fraction);
    if (focus) element(location.focusId)?.focus({ preventScroll: true });
    requestAnimationFrame(() => { restoring = false; });
  };
  const select = (selection: RepositorySelection) => { persist(); send({ type: 'select', selection }); };
  document.addEventListener('click', event => { const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null; if (target?.dataset.action) { persist(); send({ type: 'action', action: target.dataset.action }); } });
  element('books').onchange = event => {
    const id = event.target instanceof HTMLSelectElement ? event.target.value : '', book = current?.catalog.find(value => value.bookId === id);
    if (book?.revision && book.firstNodeId) select({ bookId: book.bookId, revision: book.revision, nodeId: book.firstNodeId, anchorIndex: 0 });
  };
  element('versions').onchange = event => { if (current?.selection && event.target instanceof HTMLSelectElement) select({ ...current.selection, revision: Number(event.target.value), anchorIndex: 0, location: undefined }); };
  element('nodes').onchange = event => { if (current?.selection && event.target instanceof HTMLSelectElement) select({ ...current.selection, nodeId: event.target.value, anchorIndex: 0, location: undefined }); };
  element('understand').onchange = event => { if (event.target instanceof HTMLInputElement) { const understood = event.target.checked; event.target.checked = current?.understanding?.understood ?? false; send({ type: 'understanding', understood }); } };
  element('back-top').onclick = () => { window.scrollTo(0, 0); element('article-title').focus({ preventScroll: true }); persist(); };
  window.addEventListener('scroll', () => { if (!restoring) { clearTimeout(timer); timer = setTimeout(persist, debounceMs); } });
  document.addEventListener('focusin', () => { if (!restoring) { clearTimeout(timer); timer = setTimeout(persist, debounceMs); } });
  window.addEventListener('resize', () => restore(false));
  window.addEventListener('pagehide', persist);
  window.addEventListener('message', event => {
    const message: RepositoryViewMessage = event.data;
    if (message?.type !== 'repository') return;
    current = message; const { book, selection, understanding } = message, node = book?.revision.document.nodes.find(value => value.id === selection?.nodeId);
    text('errors', message.error ?? ''); element('retry').hidden = !message.error;
    text('state', message.loading ? 'Loading selected article…' : selection && book ? `Revision ${selection.revision} · ${new Date(book.revision.publishedAt).toLocaleString()}` : 'Repository library');
    element('empty').hidden = Boolean(book) || message.loading || message.catalog.length > 0; element('reader').hidden = !node;
    choose(element('books'), message.catalog.filter(entry => entry.status === 'available').map(entry => ({ value: entry.bookId, label: entry.title ?? entry.bookId })), selection?.bookId ?? '');
    choose(element('versions'), (message.catalog.find(entry => entry.bookId === selection?.bookId)?.revisions ?? []).map(revision => ({ value: String(revision), label: `Revision ${revision}` })), String(selection?.revision ?? ''));
    element('latest').hidden = !book || book.latestRevision === selection?.revision;
    text('latest-text', book ? `You are reading a historical revision. Revision ${book.latestRevision} is available.` : '');
    if (!book || !node || !selection) return;
    choose(element('nodes'), book.revision.document.nodes.map(value => ({ value: value.id, label: value.title })), node.id);
    const key = `${selection.bookId}/${selection.revision}/${node.id}`, changed = key !== contentKey;
    if (changed) {
      contentKey = key; location = saved?.key === key && saved.location ? saved.location : selection.location; saved = undefined;
      text('article-title', node.title); text('summary', book.revision.document.summary);
      element('sections').replaceChildren(...node.sections.map((part, index) => { const section = document.createElement('section'); section.dataset.readingRegion = ''; section.id = `section-${index}`; section.tabIndex = -1; const heading = document.createElement('h2'); heading.textContent = `${index + 1}. ${part.title}`; const paragraph = document.createElement('p'); paragraph.className = 'interpretation'; paragraph.textContent = part.text; section.append(heading, paragraph); return section; }));
      document.querySelectorAll<HTMLElement>('[data-reading-region]').forEach((region, index) => { region.dataset.section = String(index); });
      for (const id of ['contents-wide', 'contents-compact']) element(id).replaceChildren(...node.sections.map((part, index) => button(`${index + 1}. ${part.title}`, `${id}-${index}`, () => { element(`section-${index}`).scrollIntoView(); element(`section-${index}`).focus({ preventScroll: true }); persist(); })));
      element('relations').replaceChildren(...book.revision.document.edges.filter(edge => edge.from === node.id || edge.to === node.id).map((edge, index) => { const otherId = edge.from === node.id ? edge.to : edge.from, other = book.revision.document.nodes.find(value => value.id === otherId)!; const container = document.createElement('div'); const paragraph = document.createElement('p'); paragraph.textContent = `${edge.relationship}: ${edge.explanation}`; container.append(button(other.title, `relation-${index}`, () => select({ ...selection, nodeId: otherId, anchorIndex: 0, location: undefined })), paragraph); return container; }));
      if (!element('relations').childElementCount) text('relations', 'No relationships authored for this article.');
      if (!location) { window.scrollTo(0, 0); element('article-title').focus({ preventScroll: true }); }
    }
    // Citation status changes update labels in place, without replacing the learner's focused control.
    if (element('anchors').dataset.key !== key) {
      element('anchors').dataset.key = key;
      element('anchors').replaceChildren(...node.anchors.map((_anchor, index) => { const source = button('', `anchor-${index}`, () => { if (current?.selection) select({ ...current.selection, anchorIndex: index, location: capture() }); }); source.className = 'source-link'; return source; }));
    }
    // A completed native citation selection is visited independently of the currently selected citation.
    if (!message.loading && node.anchors[selection.anchorIndex]) {
      const citationKey = JSON.stringify(node.anchors[selection.anchorIndex]);
      if (!visited.has(citationKey)) {
        visited.add(citationKey);
        // Bound presentation-only link history; learner understanding is stored independently in the host ledger.
        while (visited.size > visitedLimit) visited.delete(visited.values().next().value!);
        api.setState({ key: contentKey, location, visited: [...visited] });
      }
    }
    node.anchors.forEach((anchor, index) => { const state = message.sources.find(value => value.path === anchor.path && value.hash === anchor.hash), wasVisited = visited.has(JSON.stringify(anchor)), control = element(`anchor-${index}`); control.className = `source-link link${wasVisited ? ' visited' : ''}`; control.setAttribute('aria-current', String(selection.anchorIndex === index)); text(`anchor-${index}`, `${anchor.path}:${anchor.startLine}–${anchor.endLine} · ${state?.status ?? 'unverified'}${wasVisited ? ' · visited' : ''}${selection.anchorIndex === index ? ' · selected' : ''}`); });
    // Observation identity is independent of current citation status and selected citation index.
    const links = book.links.filter(link => link.nodeId === node.id), evidenceKey = JSON.stringify([key, links]);
    if (element('observations').dataset.key !== evidenceKey) {
      element('observations').dataset.key = evidenceKey;
      const focusedId = element('observations').contains(document.activeElement) && document.activeElement instanceof HTMLElement ? document.activeElement.id : undefined;
      element('observations').replaceChildren(...links.map(link => { const container = document.createElement('div'), caption = document.createElement('p'); caption.textContent = `${link.outcome} saved study · ${link.studyId} · ${(link.elapsedMs / 1000).toFixed(2)} s${link.status === 'unavailable' ? ` · ${link.reason}` : ''}`; container.append(caption); for (const recording of [false, true]) { const control = button(recording ? 'View recording' : 'View observation', `evidence-${link.linkIndex}-${recording ? 'recording' : 'observation'}`, () => { persist(); send({ type: 'evidence', linkIndex: link.linkIndex, recording, selection: { ...current?.selection, location } }); }); control.disabled = link.status !== 'available' || recording && link.recording.status !== 'available'; container.append(control); } if (link.recording.status !== 'available') { const reason = document.createElement('p'); reason.className = 'muted'; reason.textContent = link.recording.reason ?? 'No verified recording for this observation.'; container.append(reason); } return container; }));
      if (!element('observations').childElementCount) text('observations', 'No runtime observation linked. This article explains source-derived behavior.');
      if (focusedId) element(focusedId)?.focus({ preventScroll: true });
    }
    const changedSource = message.sources.some(source => source.status === 'changed'), unavailable = message.sources.some(source => source.status === 'unavailable');
    text('source-status', !message.sources.length ? 'Checking current citations…' : changedSource ? 'Review needed — cited source changed. Retained source and earlier understanding remain available.' : unavailable ? 'Current source unverified — retained source remains available.' : 'All cited source hashes match the current files.');
    text('save-state', message.saving ? 'Saving…' : '');
    // Keep old article actions inert until the selected article/source has finished loading.
    document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('#reader button, #reader select, #books, #versions, #load-latest').forEach(control => { control.disabled = message.loading; });
    for (const link of links) for (const recording of [false, true]) { const control = element(`evidence-${link.linkIndex}-${recording ? 'recording' : 'observation'}`); if (control instanceof HTMLButtonElement) control.disabled = message.loading || link.status !== 'available' || recording && link.recording.status !== 'available'; }
    const selectedAnchor = node.anchors[selection.anchorIndex], currentFile = element('current-file');
    if (currentFile instanceof HTMLButtonElement) currentFile.disabled = message.loading || !message.sources.some(source => source.path === selectedAnchor?.path && source.hash === selectedAnchor.hash && source.status === 'current');
    const checkbox = element('understand'); if (checkbox instanceof HTMLInputElement) { checkbox.checked = understanding?.understood ?? false; checkbox.disabled = message.saving || message.loading || !understanding?.known; }
    if (!message.loading) text('state', `Revision ${selection.revision} · ${new Date(book.revision.publishedAt).toLocaleString()}${changedSource ? ' · Review needed' : unavailable ? ' · Current source unverified' : ''}`);
    text('progress-status', changedSource || unavailable ? `${changedSource ? 'Review needed' : 'Current source unverified'}${understanding?.understood ? ' · historical understanding retained' : ''}` : understanding?.reviewNeeded ? 'Review needed' : '');
    element('progress-status').hidden = !element('progress-status').textContent;
    text('history', understanding?.history.map(decision => `${decision.understood ? 'Understood' : 'Unchecked'} · ${new Date(decision.at).toLocaleString()} · ${decision.context.kind === 'citations' ? decision.context.hash.slice(0, 12) : decision.sourceHash.slice(0, 12)}`).join('\n') || 'No understanding decision yet.');
    // Restore explicit return/navigation even when the article DOM already exists; status-only updates leave focus alone.
    if (!message.loading && presentedRevision !== message.revision) {
      presentedRevision = message.revision; if (!changed) location = selection.location ?? location;
      if (location) requestAnimationFrame(() => restore(true));
    }
    api.postMessage({ type: 'rendered', revision: message.revision, selection: { ...selection, location }, width: window.innerWidth });
  });
  api.postMessage({ type: 'ready' });
}

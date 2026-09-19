import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { LearningLibrary } from '../dist/learningLibrary.js';
import { decodeStudyArchive } from '../dist/utils/decodeStudyArchive.js';
import { loadModule } from '../dist/tests/utils/loadModule.js';

// This bounded browser adapter exercises the real reader/store. Native editor and evidence destinations remain mocked.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = await realpath(await mkdtemp(join(tmpdir(), 'codebook-repository-qa-'))), execute = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const library = new LearningLibrary(join(directory, '.learning'), hash(directory));
await execute('git', ['init', '--quiet', directory]); await mkdir(join(directory, 'src'));
const raw = JSON.parse(await readFile(join(packageRoot, 'src/tests/fixtures/cycle-0006-legacy/study.v1.json'), 'utf8'));
const study = { ...decodeStudyArchive(raw, '67bf38abd3f309bf29b1eed73e4f3ea88863995c0f207b70a50eec48d36f8743'), workspaceKey: library.workspaceKey }, observation = study.observations[0];
await library.saveStudy(study);
await writeFile(join(directory, 'src/server.mts'), observation.source.text); await writeFile(join(directory, 'src/order.ts'), 'export const total = 24;\n');
await execute('git', ['add', 'src'], { cwd: directory });
let html = '', receive, latest, enteredEvidence;
const messages = [], shown = [], disposable = () => ({ dispose() {} });
class Uri {
  constructor(value) { Object.assign(this, { scheme: '', authority: '', path: '', query: '', fragment: '', ...value }); this.fsPath = this.path; }
  static from(value) { return new Uri(value); }
  static file(path) { return new Uri({ scheme: 'file', path }); }
  toString() { return `${this.scheme}://${this.authority}${this.path}?${this.query}`; }
}
let provider;
const module = await loadModule(join(packageRoot, 'dist/repositoryReader.js'), {
  './environment': { requireWorkspace: () => directory },
  vscode: { Uri, ViewColumn: { One: 1, Two: 2 }, Range: class {}, RelativePattern: class {}, EventEmitter: class { event = () => disposable(); fire() {} dispose() {} },
    workspace: { textDocuments: [], registerTextDocumentContentProvider: (_scheme, value) => { provider = value; return disposable(); }, onDidChangeTextDocument: disposable,
      createFileSystemWatcher: () => ({ dispose() {}, onDidChange: disposable, onDidCreate: disposable, onDidDelete: disposable }),
      openTextDocument: async uri => { const text = uri.scheme === 'file' ? await readFile(uri.fsPath, 'utf8') : await provider.provideTextDocumentContent(uri); return { uri, getText: () => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), text }; } },
    window: { registerTreeDataProvider: disposable, showTextDocument: async document => { shown.push({ uri: document.uri.toString(), hash: hash(document.text) }); },
      createWebviewPanel: () => ({ reveal() {}, dispose() {}, onDidDispose: disposable,
        webview: { set html(value) { html = value; }, postMessage: async value => { latest = value; return true; }, onDidReceiveMessage: callback => { receive = callback; return disposable(); } } }) } },
});
const reader = new module.RepositoryReader({ storage: async () => library, connect: async () => {}, evidence: async (binding, recording) => { enteredEvidence = { binding, recording }; } });
const store = await reader.storage(), first = await store.sources.read('src/server.mts'), second = await store.sources.read('src/order.ts');
const sections = [
  { title: 'An agent requests an application action', text: 'The selected action enters the extension-owned service. The service identifies its workspace and run before the application receives input. A repeated request key recovers the original accepted result.\n\nSource-derived explanations describe this contract. They do not prove that a particular request executed or that a runtime pause belongs to it.' },
  { title: 'Captured facts stay tied to source', text: 'The paused observation retains the executed source hash, captured values and pause identity. Here the retained server observation describes price 24 before the selected mutation.\n\nLater annotations can explain those facts. They cannot change the captured code or values, and a missing checkpoint makes the evidence destination unavailable.' },
  { title: 'A book preserves the reading context', text: 'The article cites both the server and the order module. Understanding belongs to their complete citation context. A change to either source requests review while preserving the learner’s previous decision.\n\nThe reader keeps the exact book revision, article, selected citation and position within the section. Returning from an observation or recording therefore restores the original passage, even when the window becomes narrower.' },
  { title: 'Recorded evidence has a separate outcome', text: 'The related study is partial. The observation remains readable, but partial evidence never becomes a demonstrated application path. Recording playback uses saved time and captured source; opening it does not operate the application.\n\nThis local browser adapter verifies the article and its messages. Actual VS Code and Cursor validation is recorded separately.' },
];
const document = { title: 'Codebook architecture', summary: 'Follow the connection between agent requests, immutable evidence and the learner’s reading history.', nodes: [
  { id: 'agent-service', title: 'From agent request to study evidence', sections, anchors: [first, second].map(source => ({ path: source.path, hash: source.hash, startLine: 1, endLine: 2 })), observations: [{ studyId: study.id, observationId: observation.id, sourceHash: observation.source.hash }], learningItemId: observation.itemId },
  { id: 'storage', title: 'Retained source and shared progress', sections: [sections[2]], anchors: [{ path: second.path, hash: second.hash, startLine: 1, endLine: 2 }], observations: [] },
  { id: 'recording', title: 'Reading partial recordings', sections: [sections[3]], anchors: [{ path: first.path, hash: first.hash, startLine: 1, endLine: 2 }], observations: [] },
], edges: [{ from: 'agent-service', to: 'storage', relationship: 'uses', explanation: 'The article stores citations and learning decisions independently.' }, { from: 'agent-service', to: 'recording', relationship: 'related', explanation: 'An exact saved observation connects the article with recorded time.' }] };
await store.publish({ bookId: 'architecture', key: 'initial', expectedRevision: 0, document });
await store.publish({ bookId: 'architecture', key: 'prose', expectedRevision: 1, document: { ...document, summary: `${document.summary} Revision two clarifies prose only.` } });
await reader.open({ bookId: 'architecture', revision: 1, nodeId: 'agent-service', anchorIndex: 0 });
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/model') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(latest)); return; }
    if (url.pathname === '/evidence') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ messages, shown, enteredEvidence, progress: await library.readProgress() })); return; }
    if (url.pathname === '/message' && request.method === 'POST') {
      let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 8192) throw new Error('Message too large.'); }
      const message = JSON.parse(body); messages.push(message); receive(message); response.end('{}'); return;
    }
    if (url.pathname !== '/') { response.writeHead(404).end(); return; }
    const nonce = html.match(/<script nonce="([^"]+)"/)[1];
    const bridge = `<script nonce="${nonce}">let previous='';window.acquireVsCodeApi=()=>({getState:()=>JSON.parse(sessionStorage.getItem('reader')||'null'),setState:value=>sessionStorage.setItem('reader',JSON.stringify(value)),postMessage:value=>fetch('/message',{method:'POST',body:JSON.stringify(value)})});setInterval(async()=>{const data=await(await fetch('/model')).text();if(data!==previous){previous=data;window.dispatchEvent(new MessageEvent('message',{data:JSON.parse(data)}))}},100);</script>`;
    response.setHeader('Content-Type', 'text/html'); response.end(html.replace("default-src 'none';", "default-src 'none'; connect-src 'self';").replace('</head>', `${bridge}</head>`));
  } catch (error) { response.writeHead(500).end(String(error)); }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, directory, qualification: 'Actual compiled reader + real storage; mocked native presentation/evidence destination' })));
process.on('SIGTERM', () => { server.close(); void reader.dispose().then(() => process.exit(0)); });

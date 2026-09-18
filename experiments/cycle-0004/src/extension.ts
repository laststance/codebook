import * as vscode from 'vscode';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { HTTP_BODY_LIMIT_BYTES, KEY_LENGTH_LIMIT, SCENARIOS, PARTICIPANTS, ACTION_IDS } from './constants';
import { PairedRun, type HarnessConfig } from './run';

/** Reads only bounded JSON objects for fixed experiment operations; arbitrary expressions are never accepted. @example await readBody(request) */
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) { bytes += chunk.length; if (bytes > HTTP_BODY_LIMIT_BYTES) throw new Error('Control body too large'); chunks.push(chunk); }
  const value = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected JSON object');
  return value;
}

/** Emits control results without leaking the bootstrap token into run evidence. @example respond(response, 202, { runId }) */
function respond(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value));
}

/** Installs trackers before launch and exposes a private loopback harness only in an explicitly configured development workspace. @example VS Code calls activate(context) */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspace) return;
  let configuration: HarnessConfig;
  try { configuration = JSON.parse(await readFile(join(workspace, 'paired-harness.json'), 'utf8')); } catch { return; }
  const runs = new Map<string, PairedRun>(); const tokens = new Map<string, string>();
  const bootstrapToken = randomBytes(32).toString('hex');
  context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('*', {
    createDebugAdapterTracker(session) {
      const run = [...runs.values()].find(candidate => candidate.owner(session));
      if (!run) return;
      run.addSession(session);
      return { onWillReceiveMessage: message => { if (message.type === 'request') run.onRequest(session, message); }, onDidSendMessage: message => { if (message.type === 'event') run.onEvent(session, message); }, onError: error => run.fail(`Debug adapter error: ${error.message}`) };
    },
  }));
  context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(session => { for (const run of runs.values()) if (run.owner(session)) run.terminated(session); }));
  context.subscriptions.push(vscode.debug.onDidChangeActiveDebugSession(session => { for (const run of runs.values()) run.evidence.record('focus.changed', { sessionId: session?.id }); }));
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const match = /^\/runs\/([^/]+)(?:\/(actions|continue))?$/.exec(path);
      const token = path === '/runs' ? bootstrapToken : tokens.get(match?.[1] ?? '');
      const expected = Buffer.from(`Bearer ${token}`), supplied = Buffer.from(request.headers.authorization ?? '');
      if (!token || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) { respond(response, 401, { error: 'Unauthorized' }); return; }
      if (path === '/runs' && request.method === 'POST') {
        const body = await readBody(request); const scenario = SCENARIOS.find(scenario => scenario === body.scenario);
        if (!scenario) { respond(response, 400, { error: 'Unknown fixed scenario' }); return; }
        const run = new PairedRun(configuration, scenario), token = randomBytes(32).toString('hex'); runs.set(run.id, run); tokens.set(run.id, token);
        void run.prepare().catch(error => run.fail(String(error))); respond(response, 202, { runId: run.id, token }); return;
      }
      const run = runs.get(match?.[1] ?? '');
      if (!run) { respond(response, 404, { error: 'Unknown run' }); return; }
      if (request.method === 'GET' && !match?.[2]) respond(response, 200, run.view());
      else if (request.method === 'DELETE' && !match?.[2]) { await run.cleanup(); respond(response, 200, run.view()); }
      else if (request.method === 'POST' && match?.[2] === 'actions') {
        const body = await readBody(request);
        if (typeof body.key !== 'string' || !body.key || body.key.length > KEY_LENGTH_LIMIT) throw new Error('Expected bounded action key');
        const actionId = body.action === undefined ? 'add-to-cart' : ACTION_IDS.find(action => action === body.action);
        if (!actionId) throw new Error('Expected a declared fixture action');
        respond(response, 202, { operation: run.acceptAction(body.key, actionId) });
      } else if (request.method === 'POST' && match?.[2] === 'continue') {
        const body = await readBody(request); const participant = PARTICIPANTS.find(name => name === body.participant);
        if (!participant || typeof body.sessionId !== 'string' || typeof body.threadId !== 'number' || !Number.isInteger(body.threadId) || typeof body.generation !== 'number' || !Number.isInteger(body.generation)) throw new Error('Expected exact participant/session/thread/generation');
        await run.continue(participant, { sessionId: body.sessionId, threadId: body.threadId, generation: body.generation }); respond(response, 202, { accepted: true });
      } else respond(response, 405, { error: 'Unsupported operation' });
    })().catch(error => respond(response, String(error).includes('conflict:') ? 409 : 400, { error: String(error) }));
  });
  server.listen(0, '127.0.0.1', () => {
    const address = server.address(); if (!address || typeof address === 'string') return;
    void writeFile(configuration.descriptorPath, JSON.stringify({ origin: `http://127.0.0.1:${address.port}`, token: bootstrapToken }), { mode: 0o600 });
  });
  context.subscriptions.push({ dispose: () => { server.close(); for (const run of runs.values()) void run.cleanup().catch(error => console.error('Paired cleanup incomplete', error)); } });
}

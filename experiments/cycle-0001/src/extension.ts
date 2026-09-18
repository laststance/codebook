import * as vscode from 'vscode';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { HTTP_BODY_LIMIT_BYTES, SCENARIOS } from './constants';
import { ExperimentRun, type HarnessConfig } from './run';
import type { PauseIdentity } from './pauseGate';

/** Parses only small JSON control messages for the disposable HTTP bridge. @example await readBody(request) // { key: 'one-click' } */
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > HTTP_BODY_LIMIT_BYTES) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected JSON object');
  return parsed as Record<string, unknown>;
}

/** Serializes bounded control results without exposing launch credentials. @example respond(response, 202, { runId }) */
function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

/** Registers trackers before any owned launch, then publishes an authenticated loopback descriptor for the runner. @example VS Code calls activate(context) on startup */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspace) return;
  let config: HarnessConfig;
  try { config = JSON.parse(await readFile(join(workspace, 'harness.json'), 'utf8')); }
  catch { return; }
  const runs = new Map<string, ExperimentRun>();
  const runTokens = new Map<string, string>();
  const token = randomBytes(32).toString('hex');
  context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('*', {
    createDebugAdapterTracker(session) {
      const run = [...runs.values()].find(candidate => candidate.owns(session));
      if (!run) return;
      run.addSession(session);
      return {
        onWillReceiveMessage: message => { if (message.type === 'request') run.onRequest(session, message); },
        onDidSendMessage: message => { if (message.type === 'event') run.onEvent(session, message); },
        onError: error => run.fail(`Debug adapter error: ${error.message}`),
      };
    },
  }));
  context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(session => {
    for (const run of runs.values()) if (run.owns(session)) run.terminated(session);
  }));
  context.subscriptions.push(vscode.debug.onDidChangeActiveDebugSession(session => {
    for (const run of runs.values()) run.evidence.record('focus.changed', { sessionId: session?.id });
  }));
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const match = /^\/runs\/([^/]+)(?:\/(actions|continue))?$/.exec(path);
      const requiredToken = path === '/runs' ? token : runTokens.get(match?.[1] ?? '');
      const supplied = Buffer.from(request.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${requiredToken}`);
      if (!requiredToken || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { respond(response, 401, { error: 'Unauthorized' }); return; }
      if (request.method === 'POST' && path === '/runs') {
        const body = await readBody(request);
        const scenario = SCENARIOS.find(value => value === body.scenario);
        if (!scenario) { respond(response, 400, { error: 'Unknown fixed scenario' }); return; }
        const run = new ExperimentRun(config, scenario);
        const runToken = randomBytes(32).toString('hex');
        runs.set(run.id, run);
        runTokens.set(run.id, runToken);
        // Setup runs outside the request lifetime, just as input dispatch does.
        void run.prepare().catch(error => run.fail(String(error)));
        respond(response, 202, { runId: run.id, token: runToken });
        return;
      }
      const run = match?.[1] && runs.get(match[1]);
      if (!run) { respond(response, 404, { error: 'Run not found' }); return; }
      if (request.method === 'GET' && !match![2]) respond(response, 200, run.view());
      else if (request.method === 'DELETE' && !match![2]) { await run.cleanup(); respond(response, 200, run.view()); }
      else if (request.method === 'POST' && match![2] === 'actions') {
        const body = await readBody(request);
        if (typeof body.key !== 'string' || !body.key || body.key.length > 128) { respond(response, 400, { error: 'Expected bounded nonempty key' }); return; }
        respond(response, 202, run.acceptAction(body.key));
      } else if (request.method === 'POST' && match![2] === 'continue') {
        const body = await readBody(request);
        if (typeof body.sessionId !== 'string' || !Number.isInteger(body.threadId) || !Number.isInteger(body.generation)) { respond(response, 400, { error: 'Expected sessionId, threadId, generation' }); return; }
        const identity: PauseIdentity = { sessionId: body.sessionId, threadId: Number(body.threadId), generation: Number(body.generation) };
        await run.continue(identity);
        respond(response, 202, { accepted: true });
      } else respond(response, 405, { error: 'Unsupported fixed operation' });
    })().catch(error => respond(response, String(error).includes('conflict:') ? 409 : 400, { error: String(error) }));
  });
  server.listen(0, '127.0.0.1', async () => {
    const address = server.address();
    if (!address || typeof address === 'string') return;
    await writeFile(config.descriptorPath, JSON.stringify({ origin: `http://127.0.0.1:${address.port}`, token }), { mode: 0o600 });
  });
  context.subscriptions.push({ dispose: () => { server.close(); for (const run of runs.values()) void run.cleanup().catch(error => console.error('codebook cleanup incomplete', error)); } });
}

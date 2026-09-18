import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import type { PairedRun } from '../run';
import type { Scenario } from '../constants';

type RunView = ReturnType<PairedRun['view']>;
type FinalState = Pick<RunView, 'status' | 'finalOutcome' | 'failures'> & Partial<Pick<RunView, 'captures'>>;
interface RunnerExports {
  exercise?: (descriptor: { origin: string; token: string }, scenario: Scenario) => Promise<{ passed: boolean; error?: string; final?: RunView }>;
}

/** Loads compiled runner control flow for verdict regressions, replacing only native/HTTP boundaries and its automatic launch. @example const runner = await loadRunner(finalState) */
async function loadRunner(finalState: FinalState) {
  const filename = join(__dirname, '../runner.js'), nativeRequire = createRequire(filename);
  const source = await readFile(filename, 'utf8');
  const automaticMain = /^void main\(\)\.catch\(.*\);$/gm;
  assert.equal(source.match(automaticMain)?.length, 1, 'Disable exactly the runner automatic launch');
  const exports: RunnerExports = {};
  const events = [{ type: 'breakpoint.bound' }, { type: 'breakpoint.bound' }];
  let phase = 'ready', candidateObserved = false, cleanupCalls = 0;
  const participants = {
    server: { sessionId: 'server-session', pause: { sessionId: 'server-session', threadId: 1, generation: 1 }, snapshot: { values: { operationId: 'owned-run', cartId: 'selected', productId: 'tote-01', price: 24, cartCount: 0, admittedCount: 2 }, frame: { source: { path: '/fixture/server.mts' } } } },
    browser: { sessionId: 'browser-session', pause: { sessionId: 'browser-session', threadId: 2, generation: 1 }, snapshot: { values: { operationId: 'owned-run', cartId: 'selected', productId: 'tote-01', price: 24, cartCount: 1, admittedCount: 2 }, frame: { source: { path: '/fixture/client.mts' } } } },
  };
  const view = () => ({
    runId: 'owned-run', status: phase, cleaned: false, failures: [], participants, events: [...events],
    activeSessionIds: ['server-session', 'browser-session'], finalOutcome: 'pending-teardown',
    network: { requests: [{ requestId: 'selected' }, { requestId: 'background' }], closed: true },
    observed: { cartCount: 1, completedClicks: 1 },
    links: [{ status: 'observed' }, { status: 'observed' }, { status: 'observed' }, { status: 'observed' }, { status: 'observed' }],
    captures: { before: { status: 'captured' }, 'paused-server': { status: 'captured' }, 'paused-browser': { status: 'captured' }, after: { status: 'captured' } },
  });
  const exchange = async (url: string, options: RequestInit) => {
    const pathname = new URL(url).pathname;
    const body: { participant?: string; sessionId?: string } = JSON.parse(String(options.body ?? '{}'));
    let status = 200, value: unknown;
    // Model the runner's fixed normal sequence; unexpected native or HTTP activity fails the test.
    if (pathname === '/runs' && options.method === 'POST') { status = 202; value = { runId: 'owned-run', token: 'run-token' }; }
    else if (new Headers(options.headers).get('authorization') === 'Bearer bootstrap-token') { status = 401; value = { error: 'Unauthorized' }; }
    else if (pathname === '/runs/owned-run' && options.method === 'DELETE') { cleanupCalls++; value = { ...view(), ...finalState, cleaned: true, activeSessionIds: [] }; }
    else if (pathname === '/runs/owned-run/actions' && options.method === 'POST') { phase = 'paused-server'; events.push({ type: 'input.dispatched' }); status = 202; value = { operation: { id: 'one-operation' } }; }
    else if (pathname === '/runs/owned-run/continue' && options.method === 'POST') {
      if (body.participant === 'server' && body.sessionId === 'server-session' && phase === 'paused-server') { phase = 'paused-browser'; events.push({ type: 'continue.accepted' }); status = 202; }
      else if (body.participant === 'browser' && body.sessionId === 'browser-session' && phase === 'paused-browser') { phase = 'completed'; events.push({ type: 'continue.accepted' }); status = 202; }
      else status = 409;
      value = {};
    } else if (pathname === '/runs/owned-run' && options.method === 'GET') { candidateObserved ||= phase === 'completed'; value = view(); }
    else throw new Error(`Unexpected runner request: ${options.method} ${pathname}`);
    return { status, body: JSON.stringify(value) };
  };
  const modules = new Map<string, Record<string, unknown>>();
  const context = createContext({ exports, __dirname: join(__dirname, '..'), AbortSignal, performance, exchange,
    process: { argv: ['node', filename], env: {} }, console: { log() {}, error() {} },
    require: (name: string) => {
      if (name === 'node:child_process') return { spawn() { throw new Error('Unexpected native launch'); }, execFileSync() { throw new Error('Unexpected native command'); } };
      return modules.get(name) ?? nativeRequire(name);
    },
  });
  // Keep JSON and local assertion fixtures in the same VM realm as the actual runner.
  runInContext('globalThis.fetch = async (url, options) => { const response = await exchange(url, options); return { status: response.status, json: async () => JSON.parse(response.body), body: { cancel: async () => undefined } }; };', context);
  for (const name of ['./constants', './utils/assertFinalScenario']) {
    const moduleExports: Record<string, unknown> = {};
    const initialize: (require: NodeRequire, exports: Record<string, unknown>) => void = runInContext(`(function(require, exports) {\n${await readFile(join(__dirname, '..', `${name}.js`), 'utf8')}\n})`, context);
    initialize(nativeRequire, moduleExports); modules.set(name, moduleExports);
  }
  runInContext(source.replace(automaticMain, 'exports.exercise = exercise;'), context, { filename });
  assert.ok(exports.exercise);
  return { exercise: exports.exercise, get candidateObserved() { return candidateObserved; }, get cleanupCalls() { return cleanupCalls; } };
}

test('the actual runner fails a normal candidate revoked after successful owned teardown', async () => {
  // Arrange
  const runner = await loadRunner({ status: 'failed', finalOutcome: 'not-demonstrated', failures: ['Request appeared after the expected observation set closed'] });
  // Act
  const result = await runner.exercise({ origin: 'http://127.0.0.1:5000', token: 'bootstrap-token' }, 'normal');
  // Assert
  assert.equal(runner.candidateObserved, true); assert.equal(runner.cleanupCalls, 1);
  assert.equal(result.final?.cleaned, true); assert.equal(result.final?.status, 'failed');
  assert.equal(result.passed, false); assert.match(result.error ?? '', /Cleanup:.*after the expected observation set closed/s);
});

test('the actual runner fails a normal candidate whose final image evidence is partial', async () => {
  // Arrange
  const runner = await loadRunner({ status: 'completed', finalOutcome: 'partial', failures: [], captures: { 'paused-server': { status: 'failed', error: 'Screenshot timed out' } } });
  // Act
  const result = await runner.exercise({ origin: 'http://127.0.0.1:5000', token: 'bootstrap-token' }, 'normal');
  // Assert
  assert.equal(runner.candidateObserved, true); assert.equal(runner.cleanupCalls, 1);
  assert.equal(result.final?.cleaned, true); assert.equal(result.final?.finalOutcome, 'partial');
  assert.equal(result.passed, false); assert.match(result.error ?? '', /Cleanup:.*partial/s);
});

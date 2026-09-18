import { createServer } from 'node:http';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { CONTROL_RESPONSE_LIMIT_MS, EXPECTED_VALUES, HOLD_DURATION_MS, RUN_TIMEOUT_MS, SCENARIOS, type Scenario } from './constants';
import type { ExperimentRun, HarnessConfig } from './run';
import { sha256 } from './utils/sha256';
import { waitUntil } from './utils/waitUntil';
import { selectHost } from './utils/selectHost';
import { awaitResponse } from './utils/awaitResponse';
import { isEndpointClosed } from './utils/isEndpointClosed';
import { readHostInstallation } from './utils/readHostInstallation';

type RunView = ReturnType<ExperimentRun['view']>;
type Descriptor = { origin: string; token: string; runTokens?: Map<string, string> };
const packageRoot = resolve(__dirname, '..');
const repoRoot = resolve(packageRoot, '../..');
const hostId = selectHost(process.env.CODEBOOK_HOST);
const artifactRoot = join(repoRoot, 'artifacts/cycle-0002', hostId);
const suiteId = `suite-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
const suiteDirectory = join(artifactRoot, suiteId);
const workspace = join(suiteDirectory, 'workspace');
const descriptorPath = join(suiteDirectory, 'connection.json');
const requested = process.argv.slice(2);
const scenarios = requested.length ? requested.map(argument => {
  const scenario = SCENARIOS.find(value => value === argument);
  if (!scenario) throw new Error(`Unknown scenario ${argument}`);
  return scenario;
}) : ['normal'] satisfies Scenario[];

interface ScenarioResult {
  scenario: Scenario;
  runId: string;
  passed: boolean;
  checks: Record<string, unknown>;
  final?: RunView;
  error?: string;
}

/** Sends one authenticated control request, keeping latency evidence outside the extension. @example await control('/runs/id', 'GET') */
async function control(descriptor: Descriptor, path: string, method = 'GET', body?: unknown) {
  const startedMs = performance.now();
  const token = descriptor.runTokens?.get(path.split('/')[2] ?? '') ?? descriptor.token;
  const response = await fetch(`${descriptor.origin}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(RUN_TIMEOUT_MS) });
  const result = await response.json();
  if (path === '/runs' && response.status === 202) {
    descriptor.runTokens ??= new Map();
    descriptor.runTokens.set(result.runId, result.token);
  }
  return { status: response.status, body: result, durationMs: performance.now() - startedMs };
}

/** Reads the explicit run, never a focused editor session. @example await state(descriptor, runId) */
async function state(descriptor: Descriptor, runId: string): Promise<RunView> {
  return (await control(descriptor, `/runs/${runId}`)).body;
}

/** Holds optional native-UI evidence checkpoints for the observer without changing extension control semantics. @example await nativeCheckpoint(run, 'paused') */
async function nativeCheckpoint(run: RunView, phase: 'before' | 'paused' | 'after'): Promise<void> {
  if (process.env.CODEBOOK_NATIVE_CAPTURE !== '1') return;
  const releasePath = join(suiteDirectory, `native-${phase}.release`);
  await writeFile(join(suiteDirectory, 'native-stage.json'), JSON.stringify({ runId: run.runId, phase, artifactDirectory: run.artifactDirectory, pause: run.pause, recordedAt: new Date().toISOString(), releasePath }));
  console.log(`NATIVE_CAPTURE: ${phase} ${run.runId}`);
  await waitUntil(async () => { try { await readFile(releasePath); return true; } catch { return false; } }, `native ${phase} screenshot`);
}

/** Checks observable live behavior; expected safety rejections pass without becoming successful walkthroughs. @example await exercise(descriptor, 'continue-race', ownedRunIds) */
async function exercise(descriptor: Descriptor, scenario: Scenario, ownedRunIds: string[]): Promise<ScenarioResult> {
  const created = await control(descriptor, '/runs', 'POST', { scenario });
  const runId: string = created.body.runId;
  ownedRunIds.push(runId);
  const result: ScenarioResult = { scenario, runId, passed: false, checks: {} };
  const caseRunIds = [runId];
  const path = `/runs/${runId}`;
  console.log(`${scenario}: ${runId}`);
  try {
    assert.equal(created.status, 202);
    const wrongToken = await fetch(`${descriptor.origin}${path}`, { headers: { authorization: `Bearer ${descriptor.token}` } });
    assert.equal(wrongToken.status, 401);
    await wrongToken.body?.cancel();
    result.checks.runTokenRequired = true;
    if (scenario === 'cancel-prepare' || scenario === 'cancel-browser' || scenario === 'cancel-attach') {
      const barrier = scenario === 'cancel-prepare' ? 'fault.preparation-held' : scenario === 'cancel-browser' ? 'fault.browser-acquisition-held' : 'fault.attach-acquisition-held';
      await waitUntil(async () => (await state(descriptor, runId)).events.some(event => event.type === barrier), 'preparation barrier');
      const removed = await control(descriptor, path, 'DELETE');
      assert.equal(removed.status, 200);
      assert.equal(removed.body.status, 'cancelled');
      assert.deepEqual(removed.body.resources, { activeSessionIds: [], breakpointPresent: false, cdpOpen: false });
      if (scenario === 'cancel-prepare') assert.equal(removed.body.events.filter((event: RunView['events'][number]) => event.type === 'session.started').length, 0);
      result.checks.cleanupDurationMs = removed.durationMs;
      result.passed = true;
      return result;
    }
    const prepared = await waitUntil(async () => { const current = await state(descriptor, runId); return ['ready', 'failed'].includes(current.status) ? current : undefined; }, 'prepared run', RUN_TIMEOUT_MS);
    if (['missing-capability', 'missing-endpoint', 'ambiguous-target'].includes(scenario)) {
      assert.equal(prepared.status, 'failed');
      assert.match(prepared.failures.join('\n'), scenario === 'missing-capability' ? /Missing Cursor browser capability/ : scenario === 'missing-endpoint' ? /endpoint descriptor is missing/ : /Ambiguous fixture browser targets/);
      assert.equal(prepared.events.filter(event => event.type === 'input.dispatched').length, 0);
    } else if (scenario === 'unbound') {
      assert.equal(prepared.status, 'failed');
      assert.match(prepared.failures.join('\n'), /verified breakpoint/);
      assert.equal(prepared.events.filter(event => event.type === 'input.dispatched').length, 0);
    } else {
      assert.equal(prepared.status, 'ready', prepared.failures.join('\n'));
      await nativeCheckpoint(prepared, 'before');
      const action = await control(descriptor, `${path}/actions`, 'POST', { key: 'one-cart-add' });
      result.checks.actionStatus = action.status;
      result.checks.actionDurationMs = action.durationMs;
      assert.equal(action.status, 202);
      assert.ok(action.durationMs < CONTROL_RESPONSE_LIMIT_MS);
      const stopped = await waitUntil(async () => {
        const current = await state(descriptor, runId);
        return current.status === 'failed' || (current.snapshot && current.captures['paused-1']?.status !== 'pending') ? current : undefined;
      }, 'snapshot or failure', RUN_TIMEOUT_MS);

      if (scenario === 'stale-script' || scenario === 'source-drift') {
        assert.equal(stopped.status, 'failed');
        assert.match(stopped.failures.join('\n'), scenario === 'stale-script' ? /Executed JavaScript does not match/ : /Local TypeScript changed/);
        assert.equal(stopped.snapshot, undefined);
        assert.equal(stopped.events.filter(event => event.type === 'continue.accepted').length, 0);
      } else {
        assert.deepEqual(stopped.snapshot?.values, EXPECTED_VALUES);
        assert.ok(stopped.pause);
        assert.equal(stopped.operation?.completed, false);
        await nativeCheckpoint(stopped, 'paused');
        if (scenario === 'hold') {
          const holdStartedMs = performance.now();
          await setTimeout(HOLD_DURATION_MS);
          const probe = await control(descriptor, path);
          result.checks.holdDurationMs = performance.now() - holdStartedMs;
          result.checks.stateDurationMs = probe.durationMs;
          assert.equal(probe.body.status, 'paused');
          assert.deepEqual(probe.body.snapshot.values, { productId: 'tote-01', price: 24, cartCount: 0 });
          assert.ok(probe.durationMs < CONTROL_RESPONSE_LIMIT_MS);
          assert.equal(probe.body.operation.completed, false);
          assert.equal(probe.body.events.filter((event: RunView['events'][number]) => event.type === 'input.dispatched').length, 1);
        }
        if (scenario === 'duplicate') {
          const sameKey = await control(descriptor, `${path}/actions`, 'POST', { key: 'one-cart-add' });
          const differentKey = await control(descriptor, `${path}/actions`, 'POST', { key: 'second-click' });
          result.checks.idempotency = { sameKeyStatus: sameKey.status, operationId: sameKey.body.operation.id, differentKeyStatus: differentKey.status };
          assert.equal(sameKey.status, 202);
          assert.equal(sameKey.body.operation.id, action.body.operation.id);
          assert.equal(differentKey.status, 409);
        }
        if (['manual-race', 'cdp-resume', 'disconnect', 'terminate'].includes(scenario)) {
          const failed = await waitUntil(async () => {
            const current = await state(descriptor, runId);
            const restopped = scenario !== 'manual-race' || current.events.filter(event => event.type === 'dap.stopped').length === 2;
            return current.status === 'failed' && restopped ? current : undefined;
          }, 'interference detected', RUN_TIMEOUT_MS);
          assert.equal(failed.events.filter(event => event.type === 'continue.accepted').length, 0);
          assert.equal(failed.events.filter(event => event.type === 'input.dispatched').length, 1);
          assert.equal(failed.events.filter(event => event.type === 'run.completed').length, 0);
          assert.match(failed.failures.join('\n'), scenario === 'manual-race' ? /Manual or competing DAP resume/ : scenario === 'cdp-resume' ? /Continued without an owned continuation/ : scenario === 'disconnect' ? /CDP connection closed/ : /terminated|connection closed/);
          if (scenario === 'manual-race') {
            assert.equal(failed.conflict, true);
            assert.equal(failed.snapshot?.pause.generation, 1);
            result.checks.staleContinueStatus = (await control(descriptor, `${path}/continue`, 'POST', stopped.pause)).status;
            assert.equal(result.checks.staleContinueStatus, 409);
          }
        } else {
          let decoyId: string | undefined;
          let decoyPause: RunView['pause'];
          if (scenario === 'decoy') {
            const other = await control(descriptor, '/runs', 'POST', { scenario: 'decoy' });
            decoyId = other.body.runId;
            ownedRunIds.push(decoyId!);
            caseRunIds.push(decoyId!);
            await waitUntil(async () => (await state(descriptor, decoyId!)).status === 'ready', 'decoy ready');
            await control(descriptor, `/runs/${decoyId}/actions`, 'POST', { key: 'decoy-click' });
            const otherStop = await waitUntil(async () => { const current = await state(descriptor, decoyId!); return current.snapshot ? current : undefined; }, 'decoy stop');
            decoyPause = otherStop.pause;
            result.checks.decoy = { runId: decoyId, selectedSession: stopped.sessionId, decoySession: otherStop.sessionId };
            assert.notEqual(otherStop.sessionId, stopped.sessionId);
            const foreign = await control(descriptor, `${path}/continue`, 'POST', otherStop.pause);
            assert.equal(foreign.status, 409);
            const afterFocus = await waitUntil(async () => {
              const current = await state(descriptor, runId);
              return current.events.some(event => event.type === 'focus.changed' && otherStop.resources.activeSessionIds.some(sessionId => JSON.stringify(event.detail).includes(sessionId))) ? current : undefined;
            }, 'decoy focus notification');
            assert.equal(afterFocus.snapshot?.id, stopped.snapshot?.id);
          }
          if (scenario === 'continue-race') {
            const concurrent = await Promise.all([control(descriptor, `${path}/continue`, 'POST', stopped.pause), control(descriptor, `${path}/continue`, 'POST', stopped.pause)]);
            result.checks.concurrentStatuses = concurrent.map(response => response.status).sort();
            assert.deepEqual(result.checks.concurrentStatuses, [202, 409]);
          } else {
            const resume = await control(descriptor, `${path}/continue`, 'POST', stopped.pause);
            result.checks.continueStatus = resume.status;
            result.checks.continueDurationMs = resume.durationMs;
            assert.equal(resume.status, 202);
            assert.ok(resume.durationMs < CONTROL_RESPONSE_LIMIT_MS);
          }
          const completed = await waitUntil(async () => { const current = await state(descriptor, runId); return ['completed', 'failed'].includes(current.status) ? current : undefined; }, 'application completion');
          if (scenario === 'disconnect-after') {
            assert.equal(completed.status, 'failed');
            assert.match(completed.failures.join('\n'), /CDP connection closed/);
            assert.deepEqual(completed.observed, { cartCount: 1, completedClicks: 1 });
            assert.equal(completed.events.filter(event => event.type === 'run.completed').length, 0);
            assert.equal(completed.events.filter(event => event.type === 'input.dispatched').length, 1);
            assert.equal(completed.events.filter(event => event.type === 'continue.accepted').length, 1);
            result.checks.terminalFailureRetained = true;
            result.passed = true;
            return result;
          }
          assert.equal(completed.status, 'completed', completed.failures.join('\n'));
          await nativeCheckpoint(completed, 'after');
          assert.deepEqual(completed.observed, { cartCount: 1, completedClicks: 1 });
          assert.equal(completed.events.filter(event => event.type === 'input.dispatched').length, 1);
          assert.equal(completed.events.filter(event => event.type === 'continue.accepted').length, 1);
          if (scenario === 'capture-timeout') {
            await waitUntil(async () => (await state(descriptor, runId)).events.some(event => event.type === 'cdp.late-response-ignored'), 'late screenshot ignored');
            assert.equal(completed.captures['paused-1']?.status, 'failed');
            assert.equal(completed.captures['paused-1']?.file, undefined);
            const captureEvent = completed.events.find(event => event.type === 'capture.requested' && JSON.stringify(event.detail).includes('paused'));
            assert.ok(captureEvent && JSON.stringify(captureEvent.detail).includes('"inputAcknowledged":false'));
          } else {
            assert.deepEqual(Object.values(completed.captures).map(capture => capture.status), ['captured', 'captured', 'captured']);
          }
          if (scenario === 'continue-race') {
            const stale = await control(descriptor, `${path}/continue`, 'POST', stopped.pause);
            result.checks.staleContinueStatus = stale.status;
            assert.equal(stale.status, 409);
          }
          if (decoyId) {
            const other = await state(descriptor, decoyId);
            assert.deepEqual(other.pause, decoyPause);
            assert.equal(other.status, 'paused');
            await control(descriptor, path, 'DELETE');
            assert.equal((await state(descriptor, decoyId)).status, 'paused');
            const decoyResume = await control(descriptor, `/runs/${decoyId}/continue`, 'POST', decoyPause);
            assert.equal(decoyResume.status, 202);
            const decoyCompleted = await waitUntil(async () => { const current = await state(descriptor, decoyId); return current.status === 'completed' ? current : undefined; }, 'decoy remains usable after primary cleanup');
            assert.deepEqual(decoyCompleted.observed, { cartCount: 1, completedClicks: 1 });
            result.checks.decoyUnaffectedByContinueAndCleanup = true;
            await control(descriptor, `/runs/${decoyId}`, 'DELETE');
          }
        }
      }
    }
    result.passed = true;
  } catch (error) { result.error = String(error); }
  finally {
    try {
      result.final = await state(descriptor, runId);
    } catch (error) { result.passed = false; result.error = `${result.error ?? ''} Final state: ${String(error)}`; }
    result.checks.ownedResourcesReleased = true;
    for (const ownedId of caseRunIds) {
      try {
        const cleaned = await control(descriptor, `/runs/${ownedId}`, 'DELETE');
        assert.equal(cleaned.status, 200, JSON.stringify(cleaned.body));
        assert.deepEqual(cleaned.body.resources, { activeSessionIds: [], breakpointPresent: false, cdpOpen: false });
        const manifest = JSON.parse(await readFile(join(cleaned.body.artifactDirectory, 'manifest.json'), 'utf8'));
        assert.deepEqual(manifest.captures, cleaned.body.captures);
        assert.equal(manifest.cleaned, true);
        assert.ok(cleaned.body.events.some((event: RunView['events'][number]) => event.type === 'browser.cleanup-verified'));
      } catch (error) {
        result.passed = false;
        result.checks.ownedResourcesReleased = false;
        result.error = `${result.error ?? ''} Cleanup: ${String(error)}`;
      }
    }
    console.log(JSON.stringify({ scenario, passed: result.passed, status: result.final?.status, checks: result.checks, error: result.error, failures: result.final?.failures }));
  }
  return result;
}

awaitMain().catch(error => { console.error(error); process.exitCode = 1; });

/** Launches an isolated real Extension Host and executes only the requested fixed scenarios. @example node dist/runner.js normal hold */
async function awaitMain(): Promise<void> {
  await mkdir(workspace, { recursive: true });
  await mkdir(join(workspace, '.vscode'));
  await writeFile(join(workspace, '.vscode/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'debug.openDebug': 'neverOpen', 'window.commandCenter': false, 'workbench.enableExperiments': false }));
  const server = createServer((request, response) => {
    void (async () => {
      const match = /^\/runs\/([\da-f-]+)\/(index\.html|cart\.js|cart\.js\.map)$/.exec(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      if (!match) { response.writeHead(404); response.end(); return; }
      const file = match[2] === 'index.html' ? 'index.html' : match[2] === 'cart.js' ? 'build/served.js' : 'build/cart.js.map';
      const bytes = await readFile(join(artifactRoot, match[1]!, file));
      response.writeHead(200, { 'content-type': match[2] === 'index.html' ? 'text/html' : match[2] === 'cart.js' ? 'text/javascript' : 'application/json', 'cache-control': 'no-store, max-age=0' });
      response.end(bytes);
    })().catch(error => { response.writeHead(500); response.end(String(error)); });
  });
  const results: ScenarioResult[] = [];
  let descriptor: Descriptor | undefined;
  let child: ChildProcess | undefined;
  let debugOrigin: string | undefined;
  let processExited: Promise<void> | undefined;
  const ownedRunIds: string[] = [];
  try {
    await new Promise<void>(resolveListening => server.listen(0, '127.0.0.1', resolveListening));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture address');
    const installation = await readHostInstallation(hostId, process.env.CODEBOOK_VSCODE_BINARY, process.env.CODEBOOK_VSCODE_CLI);
    const vscodeVersion = installation.cliVersion;
    const host = { ...installation.host, endpointPath: hostId === 'cursor' ? join(suiteDirectory, 'debug-endpoint.json') : undefined };
    const compiledFiles = (await readdir(join(packageRoot, 'dist'), { recursive: true })).filter(file => file.endsWith('.js')).sort();
    const compiledHashes = await Promise.all(compiledFiles.map(async file => `${file}:${sha256(await readFile(join(packageRoot, 'dist', file)))}`));
    const sourceFiles = [...(await readdir(join(packageRoot, 'src'), { recursive: true })).filter(file => file.endsWith('.ts')).map(file => `src/${file}`), 'fixture/cart.ts', 'fixture/index.html', 'fixture/tsconfig.json', 'tsconfig.json', 'package.json', 'pnpm-lock.yaml'].sort();
    const sourceHashes = await Promise.all(sourceFiles.map(async file => `${file}:${sha256(await readFile(join(packageRoot, file)))}`));
    const config: HarnessConfig = { artifactRoot, templateRoot: packageRoot, descriptorPath, fixtureOrigin: `http://127.0.0.1:${address.port}`, revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(), workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim()), sourceHash: sha256(sourceHashes.join('\n')), extensionHash: sha256(compiledHashes.join('\n')), host };
    await writeFile(join(workspace, 'harness.json'), JSON.stringify(config, null, 2));
    await writeFile(join(suiteDirectory, 'environment.json'), JSON.stringify({ host, executable: installation.binaryPath, cli: installation.cliPath, vscodeVersion, node: process.version, revision: config.revision, workingTreeDirty: config.workingTreeDirty, sourceHash: config.sourceHash, sourceHashes, extensionHash: config.extensionHash, compiledHashes, scenarios }, null, 2));
    const log = await import('node:fs');
    const outputPath = join(suiteDirectory, 'editor.log');
    const output = log.openSync(outputPath, 'w');
    // macOS Unix sockets reject long user-data paths; the evidence directory stays durable.
    const runtimeDirectory = await mkdtemp('/tmp/codebook-');
    await writeFile(join(suiteDirectory, 'runtime.json'), JSON.stringify({ runtimeDirectory }));
    child = spawn(installation.binaryPath, ['--new-window', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', ...(hostId === 'cursor' ? ['--remote-debugging-port=0', '--skip-onboarding'] : []), '--user-data-dir', join(runtimeDirectory, 'profile'), '--extensions-dir', join(runtimeDirectory, 'extensions'), '--extensionDevelopmentPath', packageRoot, workspace], { env: { ...process.env, VSCODE_CLI: '1' }, stdio: ['ignore', output, output] });
    log.closeSync(output);
    const launchAbort = new AbortController();
    child.once('error', error => launchAbort.abort(error));
    child.once('exit', (code, signal) => launchAbort.abort(new Error(`VS Code exited before the harness finished: ${code ?? signal}`)));
    processExited = new Promise(resolveExit => { child!.once('exit', () => resolveExit()); child!.once('error', () => resolveExit()); });
    if (host.endpointPath) {
      // This freshly opened file receives only the owned process's stderr; never adopt a pre-existing endpoint.
      const endpoint = await waitUntil(async () => {
        const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/.exec(await readFile(outputPath, 'utf8'));
        return match?.[1] ? new URL(match[1]) : undefined;
      }, 'owned Cursor Chromium endpoint', RUN_TIMEOUT_MS, launchAbort.signal);
      debugOrigin = `http://127.0.0.1:${endpoint.port}`;
      await writeFile(host.endpointPath, JSON.stringify({ port: Number(endpoint.port) }), { mode: 0o600 });
    }
    descriptor = await waitUntil(async () => {
      try { return JSON.parse(await readFile(descriptorPath, 'utf8')) as Descriptor; } catch { return undefined; }
    }, 'extension HTTP descriptor', RUN_TIMEOUT_MS, launchAbort.signal);
    console.log(`Suite: ${suiteDirectory}`);
    for (const scenario of scenarios) results.push(await exercise(descriptor, scenario, ownedRunIds));
    if (results.some(result => !result.passed)) process.exitCode = 1;
  } finally {
    if (descriptor) for (const runId of ownedRunIds) await control(descriptor, `/runs/${runId}`, 'DELETE').catch(() => undefined);
    server.closeAllConnections();
    server.close();
    child?.kill();
    try {
      if (processExited) await awaitResponse(processExited, 'owned editor process exit');
      if (debugOrigin) {
        const ownedOrigin = debugOrigin;
        await waitUntil(() => isEndpointClosed(ownedOrigin), 'owned debugging endpoint closed', CONTROL_RESPONSE_LIMIT_MS);
      }
      await writeFile(join(suiteDirectory, 'teardown.json'), JSON.stringify({ ownedProcessExited: Boolean(child?.pid), debuggingEndpointClosed: debugOrigin ? true : null }));
    } catch (error) {
      process.exitCode = 1;
      await writeFile(join(suiteDirectory, 'teardown.json'), JSON.stringify({ error: String(error) }));
    } finally {
      await writeFile(join(suiteDirectory, 'results.json'), JSON.stringify(results, null, 2));
      console.log(`Evidence: ${join(suiteDirectory, 'results.json')}`);
    }
  }
}

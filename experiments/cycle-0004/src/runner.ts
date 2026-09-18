import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { readHostInstallation } from 'codebook-cycle-0001/dist/utils/readHostInstallation';
import { selectHost } from 'codebook-cycle-0001/dist/utils/selectHost';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { awaitResponse } from 'codebook-cycle-0001/dist/utils/awaitResponse';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { SCENARIOS, RUN_TIMEOUT_MS, HOLD_DURATION_MS, CONTROL_RESPONSE_LIMIT_MS, REQUIRED_CAPTURE_PHASES, type Scenario, type ParticipantName } from './constants';
import type { PairedRun, HarnessConfig } from './run';
import { assertFinalScenario } from './utils/assertFinalScenario';

type RunView = ReturnType<PairedRun['view']>;
interface Descriptor { origin: string; token: string }
interface CaseResult { scenario: Scenario; runId?: string; passed: boolean; checks: Record<string, unknown>; final?: RunView; error?: string }
const packageRoot = resolve(__dirname, '..'), repoRoot = resolve(packageRoot, '../..');
const hostId = selectHost(process.env.CODEBOOK_HOST);
const artifactRoot = join(repoRoot, 'artifacts/cycle-0004', hostId);
const suiteDirectory = join(artifactRoot, `suite-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
const tokens = new Map<string, string>();
const requested = process.argv.slice(2);
const scenarios = requested.length ? requested.map(argument => { const scenario = SCENARIOS.find(value => value === argument); if (!scenario) throw new Error(`Unknown scenario ${argument}`); return scenario; }) : ['normal'] satisfies Scenario[];

/** Measures an authenticated control call outside the extension without saving credentials in evidence. @example await control(descriptor, '/runs/id') */
async function control(descriptor: Descriptor, path: string, method = 'GET', body?: unknown) {
  const startedMs = performance.now();
  const response = await fetch(`${descriptor.origin}${path}`, { method, headers: { authorization: `Bearer ${tokens.get(path.split('/')[2] ?? '') ?? descriptor.token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(RUN_TIMEOUT_MS) });
  const value = await response.json();
  if (path === '/runs' && response.status === 202) tokens.set(value.runId, value.token);
  return { status: response.status, body: value, durationMs: performance.now() - startedMs };
}

/** Reads one explicit run for matrix assertions; debug focus never selects a participant. @example await state(descriptor, id) */
async function state(descriptor: Descriptor, id: string): Promise<RunView> { return (await control(descriptor, `/runs/${id}`)).body; }

/** Runs real-host assertions with safety-negative cases reported separately from demonstrated chains. @example await exercise(descriptor, 'normal') */
async function exercise(descriptor: Descriptor, scenario: Scenario): Promise<CaseResult> {
  const result: CaseResult = { scenario, passed: false, checks: {} };
  let id: string | undefined;
  let decoyId: string | undefined;
  let decoyStop: RunView | undefined;
  try {
    const created = await control(descriptor, '/runs', 'POST', { scenario }); assert.equal(created.status, 202);
    id = created.body.runId; if (!id) throw new Error('Missing run ID'); result.runId = id; const runId = id;
    console.log(`${scenario}: ${id}`);
    const denied = await fetch(`${descriptor.origin}/runs/${id}`, { headers: { authorization: `Bearer ${descriptor.token}` } });
    assert.equal(denied.status, 401); await denied.body?.cancel(); result.checks.bootstrapCannotControlRun = true;
    if (scenario === 'cancel-launch') {
      await waitUntil(async () => (await state(descriptor, runId)).events.some(event => event.type === 'fault.launch-held'), 'launch barrier', RUN_TIMEOUT_MS);
      const removed = await control(descriptor, `/runs/${id}`, 'DELETE'); assert.equal(removed.status, 200); assert.equal(removed.body.cleaned, true); assert.equal(removed.body.status, 'cancelled');
      assert.equal(removed.body.events.some((event: RunView['events'][number]) => event.type === 'backend.program-absent'), true);
      const cleanup = removed.body.events.find((event: RunView['events'][number]) => event.type === 'cleanup.completed');
      assert.equal(cleanup.detail.backendProcessAbsent, true);
      if (!removed.body.backend) { assert.equal(cleanup.detail.backendObservation, 'program-verified-endpoint-unpublished'); assert.equal(cleanup.detail.backendListenerRefused, undefined); }
      result.passed = true; return result;
    }
    const ready = await waitUntil(async () => { const current = await state(descriptor, runId); return ['ready', 'failed'].includes(current.status) ? current : undefined; }, 'run ready', RUN_TIMEOUT_MS);
    assert.equal(ready.status, 'ready', ready.failures.join('\n'));
    assert.equal(ready.events.filter(event => event.type === 'breakpoint.bound').length, 2, 'Both actual TypeScript breakpoints must bind before input');
    const action = await control(descriptor, `/runs/${id}/actions`, 'POST', { key: 'one-click' }); assert.equal(action.status, 202); assert.ok(action.durationMs < CONTROL_RESPONSE_LIMIT_MS); result.checks.acceptanceMs = action.durationMs;
    const serverStop = await waitUntil(async () => { const current = await state(descriptor, runId); return current.status === 'failed' || (current.participants.server.snapshot && current.captures['paused-server']?.status !== 'pending') ? current : undefined; }, 'server snapshot', RUN_TIMEOUT_MS);
    if (['missing-id', 'duplicate-id', 'stale-server', 'redirect'].includes(scenario)) {
      assert.equal(serverStop.status, 'failed');
      const expected = scenario === 'missing-id' ? /Missing operation identity|Paused identity/ : scenario === 'duplicate-id' ? /Ambiguous duplicate/ : scenario === 'stale-server' ? /Executed JavaScript/ : /Redirect|redirect|Unexpected cart/;
      assert.match(serverStop.failures.join('\n'), expected); assert.equal(serverStop.events.filter(event => event.type === 'continue.accepted').length, 0);
      if (scenario === 'missing-id') {
        // Observe extension-owned failure cleanup before this client sends any DELETE.
        const automatic = await waitUntil(async () => { const current = await state(descriptor, runId); return current.cleaned ? current : undefined; }, 'automatic failed-run cleanup', RUN_TIMEOUT_MS);
        assertFinalScenario(scenario, automatic); assert.equal(automatic.events.some(event => event.type === 'cleanup.auto-requested'), true);
        result.checks.automaticCleanupWithoutDelete = true;
      }
      result.passed = true; return result;
    }
    assert.notEqual(serverStop.status, 'failed', serverStop.failures.join('\n'));
    assert.deepEqual(serverStop.participants.server.snapshot?.values, { operationId: id, cartId: 'selected', productId: 'tote-01', price: 24, cartCount: 0, admittedCount: 2 });
    assert.equal(serverStop.network?.requests.length, 2);
    if (scenario === 'cancel-pause') { const removed = await control(descriptor, `/runs/${id}`, 'DELETE'); assert.equal(removed.status, 200); assert.equal(removed.body.cleaned, true); assert.equal(removed.body.status, 'cancelled'); result.passed = true; return result; }
    if (scenario === 'manual-resume') {
      const failed = await waitUntil(async () => { const current = await state(descriptor, runId); return current.status === 'failed' ? current : undefined; }, 'manual interference', RUN_TIMEOUT_MS);
      assert.match(failed.failures.join('\n'), /Manual|outside its owned|reservation/); assert.equal(failed.events.filter(event => event.type === 'continue.accepted').length, 0); result.passed = true; return result;
    }
    if (scenario === 'hold') {
      const started = performance.now(); await delay(HOLD_DURATION_MS); const probe = await control(descriptor, `/runs/${id}`);
      result.checks.holdMs = performance.now() - started; result.checks.controlMs = probe.durationMs;
      assert.equal(probe.body.status, 'paused-server'); assert.ok(probe.durationMs < CONTROL_RESPONSE_LIMIT_MS); assert.equal(probe.body.network.requests.length, 2);
    }
    if (scenario === 'duplicate') {
      const same = await control(descriptor, `/runs/${id}/actions`, 'POST', { key: 'one-click' }); const other = await control(descriptor, `/runs/${id}/actions`, 'POST', { key: 'second-click' });
      assert.equal(same.status, 202); assert.equal(same.body.operation.id, action.body.operation.id); assert.equal(other.status, 409);
    }
    if (scenario === 'decoy') {
      const other = await control(descriptor, '/runs', 'POST', { scenario: 'decoy' }); assert.equal(other.status, 202);
      decoyId = other.body.runId; assert.ok(decoyId); const otherId = decoyId;
      const foreignToken = await fetch(`${descriptor.origin}/runs/${otherId}`, { headers: { authorization: `Bearer ${tokens.get(runId)}` } });
      assert.equal(foreignToken.status, 401); await foreignToken.body?.cancel(); result.checks.foreignRunTokenRejected = true;
      const ready = await waitUntil(async () => { const current = await state(descriptor, otherId); return ['ready', 'failed'].includes(current.status) ? current : undefined; }, 'decoy ready', RUN_TIMEOUT_MS);
      assert.equal(ready.status, 'ready', ready.failures.join('\n'));
      assert.equal((await control(descriptor, `/runs/${otherId}/actions`, 'POST', { key: 'decoy-click' })).status, 202);
      decoyStop = await waitUntil(async () => { const current = await state(descriptor, otherId); return current.status === 'failed' || (current.participants.server.snapshot && current.captures['paused-server']?.status !== 'pending' && current.events.some(event => event.type === 'focus.verified')) ? current : undefined; }, 'decoy server stop and native focus', RUN_TIMEOUT_MS);
      assert.notEqual(decoyStop.status, 'failed', decoyStop.failures.join('\n'));
      const primary = await state(descriptor, runId);
      assert.notEqual(primary.participants.server.sessionId, decoyStop.participants.server.sessionId);
      assert.equal(primary.participants.server.snapshot?.id, serverStop.participants.server.snapshot?.id);
      assert.equal(primary.events.some(event => event.type === 'focus.changed' && decoyStop!.activeSessionIds.some(sessionId => JSON.stringify(event.detail).includes(sessionId))), true, 'Real focus must have changed to another owned run');
      assert.equal((await control(descriptor, `/runs/${runId}/continue`, 'POST', { participant: 'server', ...decoyStop.participants.server.pause })).status, 409);
      result.checks.decoy = { runId: otherId, sessionId: decoyStop.participants.server.sessionId, snapshotId: decoyStop.participants.server.snapshot?.id };
    }
    for (const name of ['server', 'browser'] satisfies ParticipantName[]) {
      const stop = name === 'server' ? serverStop : await waitUntil(async () => { const current = await state(descriptor, runId); return current.status === 'failed' || (current.participants.browser.snapshot && current.captures['paused-browser']?.status !== 'pending') ? current : undefined; }, 'browser snapshot', RUN_TIMEOUT_MS);
      if (name === 'browser' && ['wrong-response-id', 'wrong-response-value', 'backend-exit', 'absent-response'].includes(scenario)) { assert.equal(stop.status, 'failed'); assert.match(stop.failures.join('\n'), /Response identity|Paused identity|terminated|disconnected|deadline/); result.passed = true; return result; }
      assert.notEqual(stop.status, 'failed', stop.failures.join('\n')); const pause = stop.participants[name].pause; assert.ok(pause);
      assert.deepEqual(stop.participants[name].snapshot?.values, { operationId: id, cartId: 'selected', productId: 'tote-01', price: 24, cartCount: name === 'server' ? 0 : 1, admittedCount: 2 });
      assert.ok(stop.participants[name].snapshot?.frame.source?.path?.endsWith(name === 'server' ? '/fixture/server.mts' : '/fixture/client.mts'));
      const wrong = await control(descriptor, `/runs/${id}/continue`, 'POST', { participant: name === 'server' ? 'browser' : 'server', ...pause }); assert.equal(wrong.status, 409);
      if (scenario === 'continue-race') {
        const responses: Awaited<ReturnType<typeof control>>[] = await Promise.all([control(descriptor, `/runs/${id}/continue`, 'POST', { participant: name, ...pause }), control(descriptor, `/runs/${id}/continue`, 'POST', { participant: name, ...pause })]);
        assert.deepEqual(responses.map(response => response.status).sort(), [202, 409]); result.checks[`${name}Concurrent`] = responses.map(response => response.status).sort();
      } else {
        const response = await control(descriptor, `/runs/${id}/continue`, 'POST', { participant: name, ...pause });
        // Exiting Node may terminate DAP before its continue reply; the safety outcome is the explicit failed run.
        if (scenario === 'backend-exit' && name === 'server' && response.status === 400) assert.match(response.body.error, /Cancelled participant continuation|terminated|closed/);
        else assert.equal(response.status, 202, JSON.stringify(response.body));
        assert.ok(response.durationMs < CONTROL_RESPONSE_LIMIT_MS); result.checks[`${name}ContinueMs`] = response.durationMs;
      }
      assert.equal((await control(descriptor, `/runs/${id}/continue`, 'POST', { participant: name, ...pause })).status, 409);
    }
    const completed = await waitUntil(async () => { const current = await state(descriptor, runId); return ['completed', 'failed'].includes(current.status) ? current : undefined; }, 'observed complete chain', RUN_TIMEOUT_MS);
    assert.equal(completed.status, 'completed', completed.failures.join('\n')); assert.deepEqual(completed.observed, { cartCount: 1, completedClicks: 1 }); assert.deepEqual(completed.links.map(link => link.status), ['observed', 'observed', 'observed', 'observed', 'observed']);
    assert.equal(completed.network?.closed, true); assert.equal(completed.events.filter(event => event.type === 'input.dispatched').length, 1); assert.equal(completed.events.filter(event => event.type === 'continue.accepted').length, 2);
    assert.deepEqual(REQUIRED_CAPTURE_PHASES.map(phase => completed.captures[phase]?.status), scenario === 'capture-timeout' ? ['captured', 'failed', 'captured', 'captured'] : ['captured', 'captured', 'captured', 'captured'], 'Both code reveals must preserve the owned browser viewport unless that exact capture fault is injected');
    if (scenario === 'capture-timeout') { assert.match(completed.captures['paused-server']!.error!, /timed out/); assert.equal(completed.captures['paused-server']!.file, undefined); }
    if (decoyId && decoyStop) {
      const removed = await control(descriptor, `/runs/${runId}`, 'DELETE'); assert.equal(removed.status, 200);
      const surviving = await state(descriptor, decoyId);
      assert.equal(surviving.status, 'paused-server'); assert.deepEqual(surviving.participants.server.pause, decoyStop.participants.server.pause);
      assert.equal(surviving.events.filter(event => event.type === 'continue.accepted').length, 0); assert.ok(surviving.activeSessionIds.length > 0);
      result.checks.decoySurvivedPrimaryCleanup = true;
    }
    result.passed = true;
  } catch (error) { result.error = String(error); console.error(`${scenario}: ${result.error}`); }
  finally {
    if (id) {
      try { const removed = await control(descriptor, `/runs/${id}`, 'DELETE'); result.final = removed.body; assert.equal(removed.status, 200); assertFinalScenario(scenario, removed.body); }
      catch (error) { result.passed = false; result.error = `${result.error ?? ''}\nCleanup: ${String(error)}`; }
    }
    if (decoyId) {
      try { const removed = await control(descriptor, `/runs/${decoyId}`, 'DELETE'); assert.equal(removed.status, 200); assert.equal(removed.body.cleaned, true); }
      catch (error) { result.passed = false; result.error = `${result.error ?? ''}\nDecoy cleanup: ${String(error)}`; }
    }
  }
  return result;
}

/** Starts one isolated development editor per matrix and always records process teardown. @example node dist/runner.js normal hold */
async function main(): Promise<void> {
  const workspace = join(suiteDirectory, 'workspace'); await mkdir(join(workspace, '.vscode'), { recursive: true });
  await writeFile(join(workspace, '.vscode/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'debug.openDebug': 'neverOpen', 'workbench.enableExperiments': false }));
  let child: ChildProcess | undefined; let exited: Promise<void> | undefined;
  const results: CaseResult[] = [];
  try {
    const installation = await readHostInstallation(hostId, process.env.CODEBOOK_VSCODE_BINARY, process.env.CODEBOOK_VSCODE_CLI);
    const chromeBinary = await realpath(process.env.CODEBOOK_CHROME_BINARY ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    const sourceHashes: string[] = [];
    for (const name of ['cycle-0001', 'cycle-0004']) {
      const root = resolve(packageRoot, '..', name);
      const files = ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', ...(await readdir(join(root, 'src'), { recursive: true })).filter(file => file.endsWith('.ts')).map(file => `src/${file}`), ...(await readdir(join(root, 'fixture'), { recursive: true })).map(file => `fixture/${file}`)].sort();
      for (const file of files) sourceHashes.push(`${name}/${file}:${sha256(await readFile(join(root, file)))}`);
    }
    const configuration: HarnessConfig = { artifactRoot, templateRoot: packageRoot, descriptorPath: join(suiteDirectory, 'connection.json'), nodeExecutable: process.execPath,
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()), sourceHash: sha256(sourceHashes.join('\n')),
      host: { ...installation.host, browserBackend: 'managed', chrome: { binary: chromeBinary, version: execFileSync(chromeBinary, ['--version'], { encoding: 'utf8' }).trim() } } };
    await writeFile(join(workspace, 'paired-harness.json'), JSON.stringify(configuration));
    await writeFile(join(suiteDirectory, 'environment.json'), JSON.stringify({ ...configuration, sourceHashes, runnerNode: process.version, scenarios, editorRemoteDebugging: false }, null, 2));
    const runtime = await mkdtemp('/tmp/codebook-paired-');
    const arguments_ = ['--new-window', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', ...(hostId === 'cursor' ? ['--skip-onboarding'] : []), '--user-data-dir', join(runtime, 'profile'), '--extensions-dir', join(runtime, 'extensions'), '--extensionDevelopmentPath', packageRoot, workspace];
    await writeFile(join(suiteDirectory, 'editor-launch.json'), JSON.stringify({ executable: installation.binaryPath, arguments: arguments_ }));
    const output = openSync(join(suiteDirectory, 'editor.log'), 'w');
    child = spawn(installation.binaryPath, arguments_, { env: { ...process.env, VSCODE_CLI: '1' }, stdio: ['ignore', output, output] }); closeSync(output);
    const launchAbort = new AbortController();
    child.once('error', error => launchAbort.abort(error)); child.once('exit', () => launchAbort.abort(new Error('Owned editor exited')));
    exited = new Promise(resolveExit => { child!.once('exit', () => resolveExit()); child!.once('error', () => resolveExit()); });
    const descriptor = await waitUntil(async () => { try { return JSON.parse(await readFile(configuration.descriptorPath, 'utf8')) as Descriptor; } catch { return undefined; } }, 'paired extension descriptor', RUN_TIMEOUT_MS, launchAbort.signal);
    console.log(`Suite: ${suiteDirectory}`);
    for (const scenario of scenarios) results.push(await exercise(descriptor, scenario));
    if (results.some(result => !result.passed)) process.exitCode = 1;
  } finally {
    child?.kill();
    if (exited) await awaitResponse(exited, 'owned editor exit');
    await writeFile(join(suiteDirectory, 'results.json'), JSON.stringify(results, null, 2));
    await writeFile(join(suiteDirectory, 'teardown.json'), JSON.stringify({ editorExited: Boolean(child?.pid) }));
    console.log(`Evidence: ${suiteDirectory}`);
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

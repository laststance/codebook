import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { access, chmod, cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { readHostInstallation } from 'codebook-cycle-0001/dist/utils/readHostInstallation';
import { selectHost } from 'codebook-cycle-0001/dist/utils/selectHost';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { awaitResponse } from 'codebook-cycle-0001/dist/utils/awaitResponse';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { StudyClient, connectionSchema } from './client';
import { createNativeProfile } from './utils/createNativeProfile';
import { omittedDetail } from './utils/omittedDetail';
import { bootstrapSchema, eventsSchema, receiptSchema, snapshotSchema, stateSchema, statusSchema } from './nativeSchemas';
import { CAPTURE_PHASES, CONTROL_RESPONSE_LIMIT_MS, EVENT_DETAIL_LIMIT_BYTES, HOLD_DURATION_MS, NATIVE_AGENT_WINDOW_MS, NATIVE_EDITOR_START_TIMEOUT_MS, NATIVE_EXPIRY_MARGIN_MS, NATIVE_OBSERVATION_TIMEOUT_MS, PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE, PROFILE_ID } from './constants';

const packageRoot = resolve(__dirname, '..'), repositoryRoot = resolve(packageRoot, '..');
const hostId = selectHost(process.env.CODEBOOK_HOST);
const suiteDirectory = join(repositoryRoot, 'artifacts/cycle-0005', hostId, `suite-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
const scenarioSchema = z.enum(['normal', 'hold', 'reconnect', 'expiry', 'source-drift', 'restart']);
type Scenario = z.infer<typeof scenarioSchema>;
type State = z.infer<typeof stateSchema>;
interface CaseResult { scenario: Scenario; passed: boolean; runId?: string; firstSnapshotMs?: number; checks: Record<string, unknown>; final?: State; error?: string }
const agentDriven = process.argv.includes('--agent');
const scenarios = (agentDriven ? [] : process.argv.length > 2 ? process.argv.slice(2) : ['normal']).map(argument => scenarioSchema.parse(argument));
let lifecycleSequence = 0;
const storageInstances = new Map<string, string>();

/** Observes lifecycle bridge results without giving it study operations. @example await lifecycle('restart') */
async function lifecycle(action: 'restart' | 'finish') {
  lifecycleSequence += 1;
  await writeFile(join(suiteDirectory, 'native-command.json'), JSON.stringify({ sequence: lifecycleSequence, action }));
  const result = await waitUntil(async () => { try { return bootstrapSchema.parse(JSON.parse(await readFile(join(suiteDirectory, `bootstrap-${lifecycleSequence}.json`), 'utf8'))); } catch { return undefined; } }, 'native lifecycle result', NATIVE_EDITOR_START_TIMEOUT_MS);
  if (result.error) throw new Error(result.error); return result;
}

/** Polls documented run readiness and fails promptly on a terminal error instead of sending another click. @example await observed(agent, uri, state => state.nextActions.includes('add-to-cart')) */
async function observed(agent: StudyClient, uri: string, predicate: (state: State) => boolean): Promise<State> {
  return waitUntil(async () => {
    const state = await agent.json(uri, stateSchema);
    if (predicate(state)) return state;
    if (state.terminalReason || state.state === 'stopped') throw new Error(`Unexpected terminal state: ${JSON.stringify(state)}`);
    return undefined;
  }, 'MCP run state', NATIVE_OBSERVATION_TIMEOUT_MS);
}

/** Retrieves every bounded event page for exact effect/teardown assertions. @example await events(agent, final.eventsUri) */
async function events(agent: StudyClient, firstUri: string) {
  const result: z.infer<typeof eventsSchema>['events'] = []; let uri: string | undefined = firstUri;
  while (uri) { const page: z.infer<typeof eventsSchema> = await agent.json(uri, eventsSchema); result.push(...page.events); uri = page.nextUri; }
  return result;
}

/** Executes the fixed demonstrator through a real external SDK client, keeping all credentials private. @example await exercise(descriptorPath, 'normal') */
async function exercise(descriptorPath: string, scenario: Scenario): Promise<{ result: CaseResult; descriptorPath: string }> {
  const descriptor = connectionSchema.parse(JSON.parse(await readFile(descriptorPath, 'utf8')));
  storageInstances.set(descriptor.instanceId, join(dirname(descriptorPath), descriptor.instanceId));
  const result: CaseResult = { scenario, passed: false, checks: {} };
  const clients: StudyClient[] = [], startedMs = performance.now();
  let agent = await StudyClient.connect(descriptor); clients.push(agent);
  let receipt: z.infer<typeof receiptSchema> | undefined;
  const directory = join(suiteDirectory, scenario); await mkdir(directory, { recursive: true });
  try {
    const discovery = await agent.discover(); assert.equal(discovery.tools.tools.length, 15); assert.equal(discovery.resources.resourceTemplates.length, 17);
    const status = await agent.tool('codebook_status', {}, statusSchema);
    assert.equal(status.host.id, hostId); assert.equal(status.prerequisites.ready, true, status.prerequisites.missing.join('; '));
    await writeFile(join(directory, 'environment.json'), JSON.stringify(status, null, 2));
    const starts = await Promise.all([agent.tool('codebook_start', { instanceId: status.instanceId, profile: PROFILE_ID, key: scenario }, receiptSchema), agent.tool('codebook_start', { instanceId: status.instanceId, profile: PROFILE_ID, key: scenario }, receiptSchema)]);
    assert.deepEqual(starts[0], starts[1]); receipt = starts[0]; result.runId = receipt.runId;
    const identity = { instanceId: receipt.instanceId, runId: receipt.runId };
    await observed(agent, receipt.runUri, state => state.nextActions.includes('add-to-cart'));
    const action = { ...identity, key: 'one-click', action: 'add-to-cart' };
    const actions = await Promise.all([agent.tool('codebook_action', action, z.unknown()), agent.tool('codebook_action', action, z.unknown())]); assert.deepEqual(actions[0], actions[1]);
    await assert.rejects(agent.tool('codebook_action', { ...action, key: 'second-click' }, z.unknown()), /BUSY/);
    let serverState = await observed(agent, receipt.runUri, state => state.participants.server.resumable && state.captures.some(capture => capture.phase === 'paused-server' && capture.status !== 'pending'));
    result.firstSnapshotMs = performance.now() - startedMs;
    const serverSnapshot = await agent.json(serverState.participants.server.snapshotUri!, snapshotSchema);
    assert.deepEqual(serverSnapshot.values, { operationId: serverState.runtimeRunId, cartId: 'selected', productId: 'tote-01', price: 24, cartCount: 0, admittedCount: 2 });
    assert.equal(serverSnapshot.frame.line, 23);
    await assert.rejects(agent.tool('codebook_continue', { ...serverState.participants.server.continueArguments!, instanceId: randomUUID() }, z.unknown()), /STALE_INSTANCE/);
    await assert.rejects(agent.tool('codebook_continue', { ...serverState.participants.server.continueArguments!, runId: randomUUID() }, z.unknown()), /NOT_FOUND/);
    await assert.rejects(agent.tool('codebook_explain', { ...identity, key: 'bad-source', snapshotUri: serverState.participants.server.snapshotUri, sourceHash: '0'.repeat(64), valuePaths: ['price'], interpretation: 'Not committed.' }, z.unknown()), /INVALID_REFERENCE/);
    if (scenario === 'hold') {
      const holdStart = performance.now(); await delay(HOLD_DURATION_MS);
      const probeStart = performance.now(); serverState = await agent.json(receipt.runUri, stateSchema);
      const controlMs = performance.now() - probeStart;
      result.checks.holdMs = performance.now() - holdStart; result.checks.controlMs = controlMs;
      assert.equal(serverState.participants.server.resumable, true); assert.ok(controlMs < CONTROL_RESPONSE_LIMIT_MS);
    }
    if (scenario === 'reconnect' || scenario === 'expiry') {
      await agent.disconnect();
      if (scenario === 'expiry') await delay(Math.max(0, Date.parse(receipt.deadlineAt) - Date.now()) + NATIVE_EXPIRY_MARGIN_MS);
      agent = await StudyClient.connect(descriptor); clients.push(agent);
      if (scenario === 'reconnect') assert.deepEqual(await agent.tool('codebook_action', action, z.unknown()), actions[0]);
      else {
        const expired = await agent.json(receipt.runUri, stateSchema); assert.equal(expired.cleaned, true); assert.equal(expired.finalOutcome, 'not-demonstrated');
        await assert.rejects(agent.tool('codebook_continue', serverState.participants.server.continueArguments!, z.unknown()), /STALE_PAUSE/);
        await agent.json(serverState.participants.server.snapshotUri!, snapshotSchema); result.checks.historyAfterExpiry = true;
        result.final = expired; result.passed = true; return { result, descriptorPath };
      }
    }
    if (scenario === 'source-drift') {
      const path = serverSnapshot.frame.source.path, original = await readFile(path, 'utf8');
      assert.ok(path.startsWith(`${dirname(descriptorPath)}/`), 'Fault must be confined to this harness instance storage');
      try {
        await writeFile(path, `${original}\n// Native source drift probe.\n`);
        await assert.rejects(agent.tool('codebook_reveal', { ...identity, snapshotUri: serverState.participants.server.snapshotUri }, z.unknown()), /SOURCE_CHANGED/);
        const historical = (await agent.read(serverSnapshot.sourceUri)).contents[0]; assert.ok(historical && 'text' in historical); assert.equal(historical.text, original);
      } finally { await writeFile(path, original); }
      result.checks.sourceDriftRejected = true; result.passed = true; return { result, descriptorPath };
    }
    if (scenario === 'restart') {
      const restarted = await lifecycle('restart'); assert.ok(restarted.descriptorPath);
      await assert.rejects(access(descriptorPath));
      const fresh = connectionSchema.parse(JSON.parse(await readFile(restarted.descriptorPath, 'utf8')));
      assert.notEqual(fresh.token, descriptor.token); assert.notEqual(fresh.instanceId, descriptor.instanceId);
      await assert.rejects(agent.tool('codebook_status', {}, z.unknown()));
      const unauthorized = await fetch(fresh.url, { headers: { Authorization: `Bearer ${descriptor.token}` } }); assert.equal(unauthorized.status, 401);
      await unauthorized.body?.cancel();
      const reconnected = await StudyClient.connect(fresh); clients.push(reconnected);
      await assert.rejects(reconnected.tool('codebook_stop', identity, z.unknown()), /STALE_INSTANCE/);
      const historicalDirectory = resolve(serverSnapshot.frame.source.path, '../..');
      const manifest = z.object({ cleaned: z.boolean(), activeSessionIds: z.array(z.string()), finalOutcome: z.string() }).parse(JSON.parse(await readFile(join(historicalDirectory, 'manifest.json'), 'utf8')));
      assert.equal(manifest.cleaned, true); assert.deepEqual(manifest.activeSessionIds, []); assert.equal(manifest.finalOutcome, 'not-demonstrated');
      result.checks = { credentialsRotated: true, oldDescriptorRemoved: true, ownedPausedRunReleased: true, oldIdRejectedWithNewCredentials: true };
      receipt = undefined; descriptorPath = restarted.descriptorPath; result.passed = true; return { result, descriptorPath };
    }
    for (const participant of ['server', 'browser'] as const) {
      const paused: State = participant === 'server' ? serverState : await observed(agent, receipt.runUri, state => state.participants.browser.resumable && state.captures.some(capture => capture.phase === 'paused-browser' && capture.status !== 'pending'));
      const snapshotUri = paused.participants[participant].snapshotUri!, snapshot = await agent.json(snapshotUri, snapshotSchema);
      assert.equal(snapshot.values.price, 24); assert.equal(snapshot.values.productId, 'tote-01'); assert.equal(snapshot.values.cartCount, participant === 'server' ? 0 : 1); assert.equal(snapshot.frame.line, participant === 'server' ? 23 : 29);
      for (const kind of ['typescript', 'javascript', 'map'] as const) {
        const content = (await agent.read(`${snapshotUri}/source/${kind}`)).contents[0]; assert.ok(content && 'text' in content && typeof content.text === 'string');
        const expected = kind === 'typescript' ? snapshot.source.typescriptHash : kind === 'javascript' ? snapshot.source.javascriptHash : snapshot.source.sourceMapHash;
        assert.equal(sha256(content.text), expected); await writeFile(join(directory, `${participant}.${kind}`), content.text);
      }
      const input = { ...identity, key: `explain-${participant}`, snapshotUri, sourceHash: snapshot.source.typescriptHash, valuePaths: ['productId', 'price', 'cartCount'], interpretation: participant === 'server' ? 'At this captured server statement the selected tote costs 24 and the cart still has zero items. The next statement adds the product.' : 'The response contains one item; this client statement is paused before rendering the returned cart count.' };
      const explanations = await Promise.all([agent.tool('codebook_explain', input, z.object({ explanationUri: z.string() })), agent.tool('codebook_explain', input, z.object({ explanationUri: z.string() }))]); assert.deepEqual(explanations[0], explanations[1]);
      const explanation = await agent.json(explanations[0].explanationUri, z.object({ capturedFacts: z.array(z.object({ path: z.string(), value: z.union([z.string(), z.number()]) })), learnerUnderstandingChanged: z.literal(false) }));
      assert.deepEqual(explanation.capturedFacts, [{ path: 'productId', value: 'tote-01' }, { path: 'price', value: 24 }, { path: 'cartCount', value: participant === 'server' ? 0 : 1 }]);
      await agent.tool('codebook_reveal', { ...identity, snapshotUri }, z.unknown());
      const continuation = paused.participants[participant].continueArguments!;
      const continuations = await Promise.allSettled([agent.tool('codebook_continue', continuation, z.unknown()), agent.tool('codebook_continue', continuation, z.unknown())]);
      assert.equal(continuations.filter(value => value.status === 'fulfilled').length, 1);
      assert.match(String(continuations.find(value => value.status === 'rejected')?.reason), /STALE_PAUSE/);
    }
    // No stop request: completion must release resources on its own, including after client loss.
    await observed(agent, receipt.runUri, state => state.runtimeState === 'completed');
    await agent.disconnect(); await delay(NATIVE_EXPIRY_MARGIN_MS); agent = await StudyClient.connect(descriptor); clients.push(agent);
    const final = await observed(agent, receipt.runUri, state => state.cleaned);
    assert.equal(final.finalOutcome, 'demonstrated', final.terminalReason); assert.deepEqual(final.observed, { cartCount: 1, completedClicks: 1 }); assert.deepEqual(final.activeSessionIds, []); assert.equal(final.explanations.length, 2);
    for (const phase of CAPTURE_PHASES) {
      const capture = final.captures.find(capture => capture.phase === phase); assert.equal(capture?.status, 'captured'); assert.ok(capture.uri);
      const content = (await agent.read(capture.uri)).contents[0]; assert.ok(content && 'blob' in content && typeof content.blob === 'string'); await writeFile(join(directory, `${phase}.png`), Buffer.from(content.blob, 'base64'));
    }
    const recorded = await events(agent, final.eventsUri);
    assert.equal(recorded.filter(event => event.type === 'input.dispatched').length, 1); assert.equal(recorded.filter(event => event.type === 'continue.accepted').length, 2); assert.equal(recorded.filter(event => event.type === 'agent.explanation-saved').length, 2);
    assert.equal(recorded.some(event => event.type === 'browser.cleanup-verified'), true); assert.equal(recorded.some(event => event.type === 'cleanup.completed'), true);
    const cleanup = z.object({ backendProcessAbsent: z.literal(true), backendListenerRefused: z.literal(true) }).parse(recorded.find(event => event.type === 'cleanup.completed')?.detail);
    result.checks = { ...result.checks, cleanup, oneClick: true, groundedExplanations: 2, autoCleanupAfterClientLoss: true, fourCapturedImages: true };
    result.final = final; result.passed = true;
  } catch (error) { result.error = String(error); }
  finally {
    if (receipt) {
      try {
        result.final = await agent.tool('codebook_stop', { instanceId: receipt.instanceId, runId: receipt.runId }, stateSchema); assert.equal(result.final.cleaned, true);
        const history = await events(agent, result.final.eventsUri);
        result.checks.closedEventCount = history.length; result.checks.closedEventHash = sha256(JSON.stringify(history));
      }
      catch (error) { result.passed = false; result.error = `${result.error ?? ''}\nCleanup: ${String(error)}`; }
    }
    await Promise.allSettled(clients.map(client => client.close()));
    await writeFile(join(directory, 'transcript.json'), JSON.stringify(clients.flatMap(client => client.transcript), null, 2));
    await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2));
    console.log(`${scenario}: ${result.passed ? 'PASS' : result.error}`);
  }
  return { result, descriptorPath };
}

/** Starts isolated real editors with the production commands and keeps process setup outside the MCP control path. @example CODEBOOK_HOST=cursor node dist/nativeRunner.js normal */
async function main(): Promise<void> {
  await mkdir(suiteDirectory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE }); await chmod(suiteDirectory, PRIVATE_DIRECTORY_MODE);
  const workspace = join(suiteDirectory, 'workspace'), profile = await createNativeProfile();
  await mkdir(workspace); await mkdir(join(profile, 'User'), { recursive: true });
  await writeFile(join(profile, 'User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'debug.openDebug': 'neverOpen', 'workbench.enableExperiments': false, 'codebook.nodeExecutable': process.execPath, 'codebook.chromeExecutable': process.env.CODEBOOK_CHROME_BINARY ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }));
  const installation = await readHostInstallation(hostId), results: CaseResult[] = []; let child: ChildProcess | undefined, exited: Promise<void> | undefined, descriptorPath: string | undefined;
  try {
    const arguments_ = ['--new-window', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', ...(hostId === 'cursor' ? ['--skip-onboarding'] : []), '--user-data-dir', profile, '--extensions-dir', join(suiteDirectory, 'extensions'), '--extensionDevelopmentPath', packageRoot, '--extensionTestsPath', join(packageRoot, 'dist/nativeBootstrap.js'), workspace];
    await writeFile(join(suiteDirectory, 'launch.json'), JSON.stringify({ executable: installation.binaryPath, arguments: arguments_, runnerNode: process.version, host: installation.host, expectedScenarios: scenarios, agentDriven, editorRemoteDebugging: false }, null, 2));
    const output = openSync(join(suiteDirectory, 'editor.log'), 'w', PRIVATE_FILE_MODE);
    child = spawn(installation.binaryPath, arguments_, { env: { ...process.env, VSCODE_CLI: '1', CODEBOOK_NATIVE_SUITE: suiteDirectory }, stdio: ['ignore', output, output] }); closeSync(output);
    const aborted = new AbortController(); child.once('error', error => aborted.abort(error)); child.once('exit', () => aborted.abort(new Error('Owned editor exited')));
    exited = new Promise(resolveExit => { child!.once('exit', () => resolveExit()); child!.once('error', () => resolveExit()); });
    console.log(`Suite: ${suiteDirectory}`);
    const ready = await waitUntil(async () => { try { return bootstrapSchema.parse(JSON.parse(await readFile(join(suiteDirectory, 'bootstrap-0.json'), 'utf8'))); } catch { return undefined; } }, 'native bootstrap', NATIVE_EDITOR_START_TIMEOUT_MS, aborted.signal);
    if (ready.error) throw new Error(ready.error); descriptorPath = ready.descriptorPath; assert.ok(descriptorPath);
    assert.equal((await stat(descriptorPath)).mode & 0o777, PRIVATE_FILE_MODE);
    if (agentDriven) {
      const descriptor = connectionSchema.parse(JSON.parse(await readFile(descriptorPath, 'utf8')));
      storageInstances.set(descriptor.instanceId, join(dirname(descriptorPath), descriptor.instanceId));
      console.log(`Agent connection file: ${descriptorPath}`);
      // The driving agent chooses every study action through the external console; no scripted walkthrough runs here.
      await waitUntil(async () => { try { await access(join(suiteDirectory, 'agent-finished.json')); return true; } catch { return false; } }, 'agent-use smoke completion', NATIVE_AGENT_WINDOW_MS, aborted.signal);
    }
    for (const scenario of scenarios) { const completed = await exercise(descriptorPath, scenario); descriptorPath = completed.descriptorPath; results.push(completed.result); }
    const finished = await lifecycle('finish'); assert.equal(finished.observations?.breakpointsRestored, true); assert.deepEqual(finished.observations.activeSessions, []);
    await assert.rejects(access(descriptorPath));
    if (results.some(result => !result.passed)) process.exitCode = 1;
  } finally {
    child?.kill(); if (exited) await awaitResponse(exited, 'owned editor exit');
    // Preserve instance evidence only; sibling connection descriptors contain credentials and are excluded.
    for (const [instance, source] of storageInstances) await cp(source, join(suiteDirectory, 'instances', instance), { recursive: true }).catch(error => { console.error(`Evidence copy failed: ${String(error)}`); process.exitCode = 1; });
    // Later runs deliberately change native debug focus; already closed event histories must stay fixed.
    for (const result of results) {
      const final = result.final;
      if (!final?.runtimeRunId || result.checks.closedEventCount === undefined) continue;
      const path = join(suiteDirectory, 'instances', final.instanceId, final.runId, final.runtimeRunId, 'events.jsonl');
      const persisted = eventsSchema.parse({ events: (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) }).events;
      const persistedCount = persisted.length;
      if (persistedCount !== result.checks.closedEventCount) { result.passed = false; result.error = 'Closed history changed after teardown'; process.exitCode = 1; }
      result.checks.closedHistoryStable = persistedCount === result.checks.closedEventCount;
      const projected = persisted.map(event => ({ ...event, detail: Buffer.byteLength(JSON.stringify(event.detail)) > EVENT_DETAIL_LIMIT_BYTES ? omittedDetail(event.detail) : event.detail }));
      result.checks.closedHistoryMatchesDisk = sha256(JSON.stringify(projected)) === result.checks.closedEventHash;
      if (!result.checks.closedHistoryMatchesDisk) { result.passed = false; result.error = 'MCP history differs from recorded disk observations'; process.exitCode = 1; }
    }
    await writeFile(join(suiteDirectory, 'results.json'), JSON.stringify(results, null, 2));
    await writeFile(join(suiteDirectory, 'teardown.json'), JSON.stringify({ editorExited: Boolean(child?.pid), descriptorPath, noIndependentNativeUiInspection: true }, null, 2));
    console.log(`Evidence: ${suiteDirectory}`);
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

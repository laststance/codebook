import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { profileSchema } from './studySchemas';
import type { StudyItemId } from 'codebook-cycle-0004/dist/constants';
import { readHostInstallation } from 'codebook-cycle-0001/dist/utils/readHostInstallation';
import { selectHost } from 'codebook-cycle-0001/dist/utils/selectHost';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { awaitResponse } from 'codebook-cycle-0001/dist/utils/awaitResponse';
import { StudyClient, connectionSchema } from './client';
import { createNativeProfile } from './utils/createNativeProfile';
import { exerciseNativeRecording } from './utils/exerciseNativeRecording';
import { eventsSchema, receiptSchema, snapshotSchema, stateSchema, statusSchema } from './nativeSchemas';
import { nativeStudyResultSchema, type NativeStudyAction } from './nativeStudySchemas';
import { CONTROL_RESPONSE_LIMIT_MS, HOLD_DURATION_MS, NATIVE_EDITOR_START_TIMEOUT_MS, NATIVE_OBSERVATION_TIMEOUT_MS, PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE, PROFILE_ID } from './constants';

const packageRoot = resolve(__dirname, '..'), hostId = selectHost(process.env.CODEBOOK_HOST);
const selectedProfile = profileSchema.parse(process.env.CODEBOOK_PROFILE ?? PROFILE_ID), checkout = selectedProfile === 'checkout-demo';
const scenario = z.enum(['normal', 'history', 'recording']).parse(process.argv[2] ?? 'normal');
const suiteDirectory = join(packageRoot, scenario === 'recording' ? '../artifacts/cycle-0008/product' : '../artifacts/cycle-0007/product', hostId, selectedProfile, `${scenario}-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
type State = z.infer<typeof stateSchema>;

/** Runs actual MCP execution and native learner command assertions in one isolated profile, then reloads saved history. @example CODEBOOK_HOST=cursor node dist/nativeStudyRunner.js history */
async function main(): Promise<void> {
  await mkdir(suiteDirectory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const profile = await createNativeProfile(), workspace = join(suiteDirectory, 'workspace'), installation = await readHostInstallation(hostId);
  await mkdir(workspace); await mkdir(join(profile, 'User'), { recursive: true });
  await writeFile(join(profile, 'User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'debug.openDebug': 'neverOpen', 'workbench.enableExperiments': false, 'codebook.nodeExecutable': process.execPath, 'codebook.chromeExecutable': process.env.CODEBOOK_CHROME_BINARY ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }));
  const results: { passed: boolean; scenario: string; checks: Record<string, unknown>; error?: string } = { passed: false, scenario, checks: {} };
  const launch = (reload: boolean) => {
    const arguments_ = ['--new-window', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', ...(hostId === 'cursor' ? ['--skip-onboarding'] : []), '--user-data-dir', profile, '--extensions-dir', join(suiteDirectory, 'extensions'), '--extensionDevelopmentPath', packageRoot, '--extensionTestsPath', join(packageRoot, 'dist/nativeStudyBootstrap.js'), workspace];
    const output = openSync(join(suiteDirectory, reload ? 'reload.log' : 'live.log'), 'w', PRIVATE_FILE_MODE);
    const child = spawn(installation.binaryPath, arguments_, { env: { ...process.env, VSCODE_CLI: '1', CODEBOOK_STUDY_SUITE: suiteDirectory, CODEBOOK_STUDY_RELOAD: reload ? '1' : '0', CODEBOOK_STUDY_CASE: scenario }, stdio: ['ignore', output, output] }); closeSync(output);
    const exit = new Promise<void>((resolveExit, reject) => { child.once('exit', () => resolveExit()); child.once('error', reject); });
    return { child, exit, arguments_ };
  };
  let editor = launch(false), sequence = 0, bridgePrefix = 'live', agent: StudyClient | undefined, activeIdentity: { instanceId: string; runId: string } | undefined;
  const bridge = async (action?: NativeStudyAction, itemId?: StudyItemId) => {
    if (action) { sequence++; await writeFile(join(suiteDirectory, 'study-command.json'), JSON.stringify({ sequence, action, itemId })); }
    const result = await waitUntil(async () => { try { return nativeStudyResultSchema.parse(JSON.parse(await readFile(join(suiteDirectory, `${bridgePrefix}-${sequence}.json`), 'utf8'))); } catch { return undefined; } }, 'native learner assertion', NATIVE_EDITOR_START_TIMEOUT_MS);
    if (result.error) throw new Error(result.error); return result;
  };
  const observe = async (uri: string, predicate: (state: State) => boolean) => waitUntil(async () => {
    const state = await agent!.json(uri, stateSchema); if (predicate(state)) return state;
    if (state.terminalReason || state.state === 'stopped') throw new Error(`Unexpected terminal state: ${JSON.stringify(state)}`); return undefined;
  }, 'learner run observation', NATIVE_OBSERVATION_TIMEOUT_MS);
  try {
    console.log(`Learner suite: ${suiteDirectory}`);
    await writeFile(join(suiteDirectory, 'launch.json'), JSON.stringify({ host: installation.host, executable: installation.binaryPath, arguments: editor.arguments_, runnerNode: process.version, independentNativeVisualInspection: false }, null, 2));
    const ready = await bridge(); assert.ok(ready.descriptorPath);
    agent = await StudyClient.connect(connectionSchema.parse(JSON.parse(await readFile(ready.descriptorPath, 'utf8'))));
    const status = await agent.tool('codebook_status', {}, statusSchema); assert.equal(status.prerequisites.ready, true);
    results.checks.environment = status;
    const receipt = await agent.tool('codebook_start', { instanceId: status.instanceId, profile: selectedProfile, key: scenario }, receiptSchema);
    const identity = { instanceId: receipt.instanceId, runId: receipt.runId };
    activeIdentity = identity;
    const readyState = await observe(receipt.runUri, state => state.nextActions.includes('add-to-cart'));
    assert.ok(readyState.manifestUri); const manifest = await agent.read(readyState.manifestUri);
    results.checks.manifest = manifest;
    if (checkout) await assert.rejects(agent.tool('codebook_action', { ...identity, key: 'too-early', action: 'checkout' }, z.unknown()), /BUSY/);
    const originalAction = await agent.tool('codebook_action', { ...identity, key: 'single-input', action: 'add-to-cart' }, z.unknown());
    const steps: { itemId: StudyItemId; participant: 'server' | 'browser'; phase: string; cartCount: number; line: number; orderCount?: number }[] = checkout ? [
      { itemId: 'checkout-demo/cart-mutation', participant: 'server', phase: 'paused-cart-mutation', cartCount: 0, line: 23 },
      { itemId: 'checkout-demo/cart-update', participant: 'browser', phase: 'paused-cart-update', cartCount: 1, line: 29 },
      { itemId: 'checkout-demo/order-creation', participant: 'server', phase: 'paused-order-creation', cartCount: 1, line: 38, orderCount: 0 },
      { itemId: 'checkout-demo/purchase-confirmation', participant: 'browser', phase: 'paused-purchase-confirmation', cartCount: 1, line: 54, orderCount: 1 },
    ] : [
      { itemId: 'paired-cart-demo/server', participant: 'server', phase: 'paused-server', cartCount: 0, line: 23 },
      { itemId: 'paired-cart-demo/browser', participant: 'browser', phase: 'paused-browser', cartCount: 1, line: 29 },
    ];
    const originals: { uri: string; value: unknown }[] = [];
    let initialPause: State['participants']['server']['continueArguments'];
    for (const [index, step] of steps.entries()) {
      if (checkout && index === 2) {
        const ready = await observe(receipt.runUri, state => state.nextActions.includes('checkout'));
        assert.deepEqual(ready.observed, { cartCount: 1, completedClicks: 1 });
        await agent.tool('codebook_action', { ...identity, key: 'checkout-input', action: 'checkout' }, z.unknown());
        assert.deepEqual(await agent.tool('codebook_action', { ...identity, key: 'single-input', action: 'add-to-cart' }, z.unknown()), originalAction);
      }
      const paused = await observe(receipt.runUri, state => state.participants[step.participant].resumable && state.participants[step.participant].itemId === step.itemId && state.captures.some(capture => capture.phase === step.phase && capture.status !== 'pending'));
      const snapshotUri = paused.participants[step.participant].snapshotUri!;
      const snapshot: z.infer<typeof snapshotSchema> = await agent.json(snapshotUri, snapshotSchema);
      assert.equal(snapshot.itemId, step.itemId); assert.equal(snapshot.frame.line, step.line);
      const cart = { operationId: paused.runtimeRunId, cartId: 'selected', productId: 'tote-01', price: 24, cartCount: step.cartCount, admittedCount: 2 };
      assert.deepEqual(snapshot.values, step.orderCount === undefined ? cart : { ...cart, operationId: `${paused.runtimeRunId}-checkout`, cartOperationId: paused.runtimeRunId, orderId: `order-${paused.runtimeRunId}`, total: 24, orderCount: step.orderCount });
      if (index === 0) {
        initialPause = paused.participants.server.continueArguments;
        await bridge('open-paused');
        if (scenario === 'history') await bridge('select-history'); else await bridge('move-source');
        if (scenario === 'recording') {
          const held = performance.now(); await delay(HOLD_DURATION_MS); const probe = performance.now();
          const waiting: State = await agent.json(receipt.runUri, stateSchema), controlMs = performance.now() - probe;
          assert.equal(waiting.participants.server.resumable, true); assert.ok(controlMs < CONTROL_RESPONSE_LIMIT_MS);
          results.checks.hold = { durationMs: performance.now() - held, controlMs };
        }
      } else if (scenario === 'history' && (checkout ? index <= 2 : index === 1)) {
        await bridge('assert-history', step.itemId);
        await assert.rejects(agent.tool('codebook_reveal', { ...identity, snapshotUri }, z.unknown()), /BUSY/);
        assert.equal(paused.captures.find(capture => capture.phase === step.phase)?.status, 'failed', 'A hidden live viewport cannot use the historical image as a receipt');
        if (!checkout || index === 2) await bridge('return-current', step.itemId);
      } else await bridge('assert-current', step.itemId);
      if (checkout && index === 2) await assert.rejects(agent.tool('codebook_continue', initialPause!, z.unknown()), /STALE_PAUSE/);
      const interpretation = step.orderCount === undefined
        ? `${step.itemId}: captured tote-01 price 24, cart count ${step.cartCount}, immediately before the selected mutation or display update.`
        : `${step.itemId}: the selected order total is 24 and its captured order count is ${step.orderCount}; this source line is before the selected order mutation or confirmation display.`;
      await agent.tool('codebook_explain', { ...identity, key: `explain-${step.itemId}`, snapshotUri, sourceHash: snapshot.source.typescriptHash, valuePaths: step.orderCount === undefined ? ['productId', 'price', 'cartCount'] : ['orderId', 'total', 'orderCount', 'cartOperationId'], interpretation }, z.unknown());
      // History intentionally stays on the earlier cart item until the later same-server stop is inspected.
      if (!(scenario === 'history' && checkout && index === 1)) await agent.tool('codebook_reveal', { ...identity, snapshotUri }, z.unknown());
      originals.push({ uri: snapshotUri, value: await agent.read(snapshotUri) }, { uri: snapshot.sourceUri, value: await agent.read(snapshot.sourceUri) });
      if (scenario === 'history' && index === steps.length - 1) await bridge('continue-current', step.itemId);
      else await agent.tool('codebook_continue', paused.participants[step.participant].continueArguments!, z.unknown());
    }
    const final = await waitUntil(async () => {
      const state = await agent!.json(receipt.runUri, stateSchema);
      return state.cleaned && ['saved', 'failed'].includes(state.historyOutcome.status) ? state : undefined;
    }, 'terminal runtime and reader checkpoint', NATIVE_OBSERVATION_TIMEOUT_MS);
    assert.deepEqual(final.observed, checkout ? { cartCount: 1, completedClicks: 1, orderId: `order-${final.runtimeRunId}`, total: 24, status: 'confirmed', completedCheckouts: 1 } : { cartCount: 1, completedClicks: 1 });
    assert.deepEqual(final.activeSessionIds, []); assert.equal(final.finalOutcome, scenario === 'history' ? 'partial' : 'demonstrated');
    assert.equal(final.historyOutcome.status, 'saved'); assert.equal(final.studyOutcome, scenario === 'history' ? 'partial' : 'demonstrated');
    assert.equal(final.observations.length, checkout ? 4 : 2); assert.equal(final.links?.length, checkout ? 11 : 5);
    for (const original of originals) assert.deepEqual(await agent.read(original.uri), original.value, 'Earlier evidence remains immutable after later stops and cleanup');
    const recorded: z.infer<typeof eventsSchema>['events'] = []; let eventsUri: string | undefined = final.eventsUri;
    while (eventsUri) { const page: z.infer<typeof eventsSchema> = await agent.json(eventsUri, eventsSchema); recorded.push(...page.events); eventsUri = page.nextUri; }
    assert.equal(recorded.filter(event => event.type === 'input.dispatched').length, checkout ? 2 : 1);
    assert.equal(recorded.filter(event => event.type === 'continue.accepted').length, checkout ? 4 : 2);
    results.checks.final = final; results.checks.exactDeclaredInputs = true;
    const studyId = `${identity.instanceId}_${identity.runId}`;
    if (scenario === 'recording') results.checks.recording = await exerciseNativeRecording(agent, studyId, join(suiteDirectory, 'recording'), bridge);
    await bridge('close-reader');
    await writeFile(join(suiteDirectory, 'transcript.json'), JSON.stringify(agent.transcript, null, 2));
    await agent.close(); agent = undefined;
    results.checks.native = (await bridge('finish')).checks;
    editor.child.kill(); await awaitResponse(editor.exit, 'first owned learner editor exit');
    editor = launch(true);
    bridgePrefix = 'reload'; sequence = 0;
    const reloaded = await waitUntil(async () => { try { return nativeStudyResultSchema.parse(JSON.parse(await readFile(join(suiteDirectory, 'reload-0.json'), 'utf8'))); } catch { return undefined; } }, 'native learner reload', NATIVE_EDITOR_START_TIMEOUT_MS);
    if (reloaded.error) throw new Error(reloaded.error); assert.equal(reloaded.checks.reloadedWithoutExecution, true);
    results.checks.reload = reloaded.checks;
    if (scenario === 'recording') {
      assert.ok(reloaded.descriptorPath); activeIdentity = undefined;
      const fresh = connectionSchema.parse(JSON.parse(await readFile(reloaded.descriptorPath, 'utf8')));
      assert.notEqual(fresh.instanceId, identity.instanceId);
      agent = await StudyClient.connect(fresh);
      await assert.rejects(agent.read(`codebook://${identity.instanceId}/library`), /STALE_INSTANCE/);
      results.checks.recordingReload = await exerciseNativeRecording(agent, studyId, join(suiteDirectory, 'recording-reloaded'), bridge, true);
      await bridge('close-reader');
      await writeFile(join(suiteDirectory, 'reload-transcript.json'), JSON.stringify(agent.transcript, null, 2)); await agent.close(); agent = undefined;
      await bridge('finish');
    }
    results.passed = true;
  } catch (error) { results.error = String(error); process.exitCode = 1; }
  finally {
    if (agent) {
      if (activeIdentity) await agent.tool('codebook_stop', activeIdentity, stateSchema).catch(error => { results.error = `${results.error ?? ''}\nCleanup: ${String(error)}`; });
      await writeFile(join(suiteDirectory, 'transcript.json'), JSON.stringify(agent.transcript, null, 2)); await agent.close().catch(() => undefined);
    }
    // Stop only this isolated editor; its extension teardown owns its runtime and browser.
    editor.child.kill(); await awaitResponse(editor.exit, 'owned learner editor exit').catch(error => { results.passed = false; results.error = `${results.error ?? ''}\n${String(error)}`; process.exitCode = 1; });
    await writeFile(join(suiteDirectory, 'result.json'), JSON.stringify(results, null, 2));
    console.log(`${scenario}: ${results.passed ? 'PASS' : results.error}`); console.log(`Evidence: ${suiteDirectory}`);
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

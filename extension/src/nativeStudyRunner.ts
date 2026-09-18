import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readHostInstallation } from 'codebook-cycle-0001/dist/utils/readHostInstallation';
import { selectHost } from 'codebook-cycle-0001/dist/utils/selectHost';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { awaitResponse } from 'codebook-cycle-0001/dist/utils/awaitResponse';
import { StudyClient, connectionSchema } from './client';
import { createNativeProfile } from './utils/createNativeProfile';
import { eventsSchema, receiptSchema, snapshotSchema, stateSchema, statusSchema } from './nativeSchemas';
import { nativeStudyResultSchema, type NativeStudyAction } from './nativeStudySchemas';
import { NATIVE_EDITOR_START_TIMEOUT_MS, NATIVE_OBSERVATION_TIMEOUT_MS, PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE, PROFILE_ID } from './constants';

const packageRoot = resolve(__dirname, '..'), hostId = selectHost(process.env.CODEBOOK_HOST);
const scenario = z.enum(['normal', 'history']).parse(process.argv[2] ?? 'normal');
const suiteDirectory = join(packageRoot, '../artifacts/cycle-0006', hostId, `${scenario}-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
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
  let editor = launch(false), sequence = 0, agent: StudyClient | undefined, activeIdentity: { instanceId: string; runId: string } | undefined;
  const bridge = async (action?: NativeStudyAction) => {
    if (action) { sequence++; await writeFile(join(suiteDirectory, 'study-command.json'), JSON.stringify({ sequence, action })); }
    const result = await waitUntil(async () => { try { return nativeStudyResultSchema.parse(JSON.parse(await readFile(join(suiteDirectory, `live-${sequence}.json`), 'utf8'))); } catch { return undefined; } }, 'native learner assertion', NATIVE_EDITOR_START_TIMEOUT_MS);
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
    const receipt = await agent.tool('codebook_start', { instanceId: status.instanceId, profile: PROFILE_ID, key: scenario }, receiptSchema);
    const identity = { instanceId: receipt.instanceId, runId: receipt.runId };
    activeIdentity = identity;
    await observe(receipt.runUri, state => state.nextActions.includes('add-to-cart'));
    await agent.tool('codebook_action', { ...identity, key: 'single-input', action: 'add-to-cart' }, z.unknown());
    const server = await observe(receipt.runUri, state => state.participants.server.resumable && state.captures.some(capture => capture.phase === 'paused-server' && capture.status === 'captured'));
    await bridge('open-paused');
    if (scenario === 'history') await bridge('select-history');
    else await bridge('move-source');
    for (const participant of ['server', 'browser'] as const) {
      const paused = participant === 'server' ? server : await observe(receipt.runUri, state => state.participants.browser.resumable && state.captures.some(capture => capture.phase === 'paused-browser' && capture.status !== 'pending'));
      const snapshotUri = paused.participants[participant].snapshotUri!;
      const snapshot: z.infer<typeof snapshotSchema> = await agent.json(snapshotUri, snapshotSchema);
      assert.equal(snapshot.values.cartCount, participant === 'server' ? 0 : 1);
      if (participant === 'browser') {
        if (scenario === 'history') {
          await bridge('assert-history');
          await assert.rejects(agent.tool('codebook_reveal', { ...identity, snapshotUri }, z.unknown()), /BUSY/);
          results.checks.historyCapture = paused.captures.find(capture => capture.phase === 'paused-browser');
          assert.equal(paused.captures.find(capture => capture.phase === 'paused-browser')?.status, 'failed', 'Hidden live pixels never qualify a historical reader receipt');
          await bridge('return-current');
        } else await bridge('assert-current');
      }
      await agent.tool('codebook_explain', { ...identity, key: `explain-${participant}`, snapshotUri, sourceHash: snapshot.source.typescriptHash, valuePaths: ['productId', 'price', 'cartCount'], interpretation: participant === 'server' ? 'This captured server statement is before cart mutation. The tote costs 24 and the cart count is zero.' : 'This captured browser statement has received cart count one and is before the DOM update.' }, z.unknown());
      await agent.tool('codebook_reveal', { ...identity, snapshotUri }, z.unknown());
      if (participant === 'browser' && scenario === 'history') await bridge('continue-current');
      else await agent.tool('codebook_continue', paused.participants[participant].continueArguments!, z.unknown());
    }
    const final = await observe(receipt.runUri, state => state.cleaned);
    assert.deepEqual(final.observed, { cartCount: 1, completedClicks: 1 }); assert.deepEqual(final.activeSessionIds, []);
    assert.equal(final.finalOutcome, scenario === 'normal' ? 'demonstrated' : 'partial');
    const recorded: z.infer<typeof eventsSchema>['events'] = []; let eventsUri: string | undefined = final.eventsUri;
    while (eventsUri) { const page: z.infer<typeof eventsSchema> = await agent.json(eventsUri, eventsSchema); recorded.push(...page.events); eventsUri = page.nextUri; }
    assert.equal(recorded.filter(event => event.type === 'input.dispatched').length, 1);
    assert.equal(recorded.filter(event => event.type === 'continue.accepted').length, 2);
    results.checks.final = final; results.checks.oneInput = true;
    await bridge('close-reader');
    await writeFile(join(suiteDirectory, 'transcript.json'), JSON.stringify(agent.transcript, null, 2));
    await agent.close(); agent = undefined;
    results.checks.native = (await bridge('finish')).checks;
    editor.child.kill(); await awaitResponse(editor.exit, 'first owned learner editor exit');
    editor = launch(true);
    const reloaded = await waitUntil(async () => { try { return nativeStudyResultSchema.parse(JSON.parse(await readFile(join(suiteDirectory, 'reload-0.json'), 'utf8'))); } catch { return undefined; } }, 'native learner reload', NATIVE_EDITOR_START_TIMEOUT_MS);
    if (reloaded.error) throw new Error(reloaded.error); assert.equal(reloaded.checks.reloadedWithoutExecution, true);
    results.checks.reload = reloaded.checks; results.passed = true;
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

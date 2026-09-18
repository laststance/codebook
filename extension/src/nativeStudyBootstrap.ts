import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import type { StudyItemId } from 'codebook-cycle-0004/dist/constants';
import type { activate } from './extension';
import { LearningLibrary } from './learningLibrary';
import { nativeStudyCommandSchema, type NativeStudyAction } from './nativeStudySchemas';
import { NATIVE_COMMAND_POLL_MS, NATIVE_OBSERVATION_TIMEOUT_MS, PRIVATE_FILE_MODE, STUDY_SOURCE_SCHEME } from './constants';

/** Exercises the real learner commands and native URI ownership while an external client drives MCP. @example --extensionTestsPath dist/nativeStudyBootstrap.js */
export async function run(): Promise<void> {
  const directory = process.env.CODEBOOK_STUDY_SUITE;
  if (!directory) throw new Error('Missing learner native suite');
  const checkout = process.env.CODEBOOK_PROFILE === 'checkout-demo', firstItem = checkout ? 'checkout-demo/cart-mutation' : 'paired-cart-demo/server';
  const reload = process.env.CODEBOOK_STUDY_RELOAD === '1', prefix = reload ? 'reload' : 'live';
  const extension = vscode.extensions.getExtension<ReturnType<typeof activate>>('laststance.codebook');
  assert.ok(extension); const api = await extension.activate();
  const checks: Record<string, unknown> = { host: vscode.env.appName, apiVersion: vscode.version, node: process.versions.node, independentVisualInspection: false };
  let sequence = 0, descriptorPath: string | undefined, historyUri: string | undefined, movedSourceUri: string | undefined;
  const foreign = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'Keep my unrelated learning notes.\n' });
  const foreignEditor = await vscode.window.showTextDocument(foreign, { preview: false });
  await foreignEditor.edit(edit => edit.insert(new vscode.Position(1, 0), 'Uncommitted draft.\n'));
  const foreignText = foreign.getText();
  const publish = async (error?: unknown) => {
    await writeFile(join(directory, `${prefix}-${sequence}.json`), JSON.stringify({ sequence, descriptorPath, error: error ? String(error) : undefined, checks }, null, 2), { mode: PRIVATE_FILE_MODE });
  };
  const inspect = () => { const state = api.inspectStudy(); assert.ok(state); assert.ok(state.view); return state; };
  const rendered = async (itemId: StudyItemId, current?: boolean) => waitUntil(async () => {
    const state = inspect(), view = state.view!;
    if (view.loading || view.model.selection.itemId !== itemId || state.outlineSelection?.[0] !== itemId || state.rendered?.revision !== view.revision || state.rendered.snapshotUri !== view.model.observation?.snapshotUri || (current !== undefined && view.model.matching !== current)) return undefined;
    assert.ok(state.sourceUri); const uri = vscode.Uri.parse(state.sourceUri);
    assert.equal(uri.scheme, STUDY_SOURCE_SCHEME);
    const source = await vscode.workspace.openTextDocument(uri);
    assert.equal(sha256(source.getText()), view.model.source.hash);
    const group = vscode.window.tabGroups.all.find(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString()));
    assert.ok(group, 'Selected captured source has an actual native tab');
    return { state, view, source, group };
  }, 'matching learner source and context renderer', NATIVE_OBSERVATION_TIMEOUT_MS);
  const preserveForeign = () => {
    assert.equal(foreign.isDirty, true); assert.equal(foreign.getText(), foreignText);
    assert.ok(vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === foreign.uri.toString())));
  };
  const record = () => {
    const state = inspect();
    checks.presentation = { revision: state.view!.revision, selection: state.view!.model.selection, outlineSelection: state.outlineSelection, observation: state.view!.model.observation, currentParticipant: state.view!.model.currentParticipant, matching: state.view!.model.matching, loading: state.view!.loading, errors: state.view!.errors, sourceUri: state.sourceUri, rendered: state.rendered, opened: state.opened, leaseId: state.leaseId };
    checks.groups = vscode.window.tabGroups.all.map(group => ({ column: group.viewColumn, active: group.activeTab?.label, tabs: group.tabs.map(tab => ({ label: tab.label, dirty: tab.isDirty, active: tab.isActive, uri: tab.input instanceof vscode.TabInputText ? tab.input.uri.toString() : undefined })) }));
  };
  const exercise = async (action: NativeStudyAction, expectedItem?: StudyItemId) => {
    if (action === 'open-paused') {
      const leaseId = inspect().leaseId; assert.ok(leaseId);
      await vscode.commands.executeCommand('codebook.openStudyWorkspace');
      const { state, view } = await rendered(firstItem, true);
      assert.equal(state.leaseId, leaseId, 'Opening adopts the existing runtime viewport');
      assert.equal(view.model.observation?.values.cartCount, 0); assert.equal(view.model.observation?.values.price, 24);
      assert.equal(view.model.understoodCount, 0, 'Execution never marks understanding');
      checks.mcpFirstLeaseRetained = true; checks.layout = await vscode.commands.executeCommand('vscode.getEditorLayout');
    }
    if (action === 'select-history') {
      await vscode.commands.executeCommand('codebook.markUnderstanding', true);
      await vscode.commands.executeCommand('codebook.selectLearningItem', firstItem);
      const { state, view } = await rendered(firstItem, true); historyUri = state.sourceUri;
      assert.equal(view.model.selection.follow, false); assert.equal(view.model.understoodCount, 1);
      checks.explicitLearnerDecision = true;
    }
    if (action === 'assert-history') {
      const { state, view } = await rendered(firstItem, false);
      assert.equal(view.model.currentItemId, expectedItem ?? 'paired-cart-demo/browser'); assert.equal(state.sourceUri, historyUri);
      assert.equal(view.model.observation?.values.cartCount, 0); assert.equal(view.model.continueArguments, undefined);
      await assert.rejects(Promise.resolve(vscode.commands.executeCommand('codebook.study.continue')), /Inspect the current pause/);
      checks.historyStayedOnServer = true; checks.historicalContinueRejected = true;
    }
    if (action === 'return-current') {
      await vscode.commands.executeCommand('codebook.study.return-current');
      const { view } = await rendered(expectedItem ?? 'paired-cart-demo/browser', true);
      assert.equal(view.model.observation?.values.cartCount, 1); assert.equal(view.model.selection.follow, true);
      checks.returnedToBrowserPause = true;
    }
    if (action === 'continue-current') {
      await rendered(expectedItem ?? 'paired-cart-demo/browser', true); await vscode.commands.executeCommand('codebook.study.continue');
      checks.learnerContinuedInspectedBrowser = true;
    }
    if (action === 'move-source') {
      await vscode.commands.executeCommand('codebook.study.source');
      await vscode.commands.executeCommand('workbench.action.moveEditorToNextGroup');
      const state = inspect();
      const movedGroup = vscode.window.tabGroups.all.find(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === state.sourceUri));
      assert.ok(movedGroup); checks.movedSourceColumn = movedGroup.viewColumn;
      movedSourceUri = state.sourceUri;
    }
    if (action === 'assert-current') {
      const { state, view, group } = await rendered(expectedItem ?? 'paired-cart-demo/browser', true);
      assert.equal(view.model.observation?.values.cartCount, 1);
      // Cursor may replace API wrapper objects; the owned URI remains the group identity anchor.
      if (movedSourceUri) assert.ok(group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === movedSourceUri), 'Background pause follows the group containing the manually moved source');
      assert.ok(group.activeTab?.input instanceof vscode.TabInputText);
      assert.equal(group.activeTab.input.uri.toString(), state.sourceUri, 'Debugger raw source cannot replace the captured reader');
      checks.nativeCapturedTabActive = true;
    }
    if (action === 'close-reader') {
      await vscode.commands.executeCommand('codebook.closeStudyWorkspace');
      assert.equal(inspect().opened, false); preserveForeign();
      assert.equal(vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === STUDY_SOURCE_SCHEME)), false);
      checks.foreignDraftSurvivesClose = true;
    }
    if (action === 'finish') {
      await vscode.commands.executeCommand('codebook.stopAgentServer');
      const state = inspect(); assert.ok(state.libraryDirectory); const workspaceKey = state.libraryDirectory.split('/').at(-1)!;
      const library = new LearningLibrary(state.libraryDirectory, workspaceKey), catalog = await library.list();
      assert.equal(catalog.length, 1); const archive = await library.readStudy(catalog[0]!.id);
      assert.equal(archive.terminal, true); assert.equal(archive.observations.length, checkout ? 4 : 2);
      assert.equal(catalog[0]!.metadata, 'validated');
      assert.equal(archive.profile, checkout ? 'checkout-demo' : 'paired-cart-demo');
      assert.equal(archive.observations.flatMap(observation => observation.interpretations).length, checkout ? 4 : 2, 'Shutdown takes an explicit final checkpoint');
      checks.finalArchive = archive; checks.finalProgress = await library.readProgress();
      checks.finalCheckpoint = true;
    }
    preserveForeign(); record();
  };
  try {
    if (reload) {
      assert.equal(api.inspectStudy()?.leaseId, undefined);
      await vscode.commands.executeCommand('codebook.openStudyWorkspace');
      const state = inspect(), selected = state.view!.model.selection.itemId;
      const { view } = await rendered(selected, false);
      assert.equal(view.model.understoodCount, process.env.CODEBOOK_STUDY_CASE === 'history' ? 1 : 0);
      assert.equal(view.study?.terminal, true); assert.equal(view.model.currentParticipant, undefined); assert.equal(view.model.continueArguments, undefined);
      assert.equal(inspect().leaseId, undefined); preserveForeign(); record(); checks.reloadedWithoutExecution = true;
      await vscode.commands.executeCommand('codebook.closeStudyWorkspace'); await publish(); return;
    }
    descriptorPath = await vscode.commands.executeCommand<string>('codebook.startAgentServer'); assert.ok(descriptorPath); await publish();
    while (true) {
      let command;
      try { command = nativeStudyCommandSchema.parse(JSON.parse(await readFile(join(directory, 'study-command.json'), 'utf8'))); }
      catch { await delay(NATIVE_COMMAND_POLL_MS); continue; }
      if (command.sequence <= sequence) { await delay(NATIVE_COMMAND_POLL_MS); continue; }
      sequence = command.sequence;
      try { await exercise(command.action, command.itemId); await publish(); if (command.action === 'finish') return; }
      catch (error) { record(); await publish(error); }
    }
  } catch (error) { await publish(error); throw error; }
  finally { await vscode.commands.executeCommand('codebook.stopAgentServer'); }
}

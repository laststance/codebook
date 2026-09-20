import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import type { activate } from './extension';
import { repositorySelectionSchema } from './learnerSchemas';
import { LearningLibrary } from './learningLibrary';
import { NATIVE_COMMAND_POLL_MS, NATIVE_OBSERVATION_TIMEOUT_MS, PRIVATE_FILE_MODE, REPOSITORY_SOURCE_SCHEME } from './constants';

// Only finite learner/lifecycle operations cross this private QA boundary; authors use public MCP separately.
const commandSchema = z.strictObject({ sequence: z.number().int().positive(), action: z.enum(['inspect', 'open-saved', 'select', 'understand', 'return-wiki', 'close-wiki', 'stop-server', 'finish']), selection: repositorySelectionSchema.optional(), understood: z.boolean().optional() });

/** Reports real editor source/renderer receipts while the driving agent independently authors through MCP. @example --extensionTestsPath dist/nativeRepositoryBootstrap.js */
export async function run(): Promise<void> {
  const directory = process.env.CODEBOOK_REPOSITORY_SUITE;
  if (!directory) throw new Error('Missing repository native evidence directory.');
  const extension = vscode.extensions.getExtension<ReturnType<typeof activate>>('laststance.codebook'); assert.ok(extension);
  const api = await extension.activate(), prefix = process.env.CODEBOOK_REPOSITORY_RELOAD === '1' ? 'reload' : 'live';
  let sequence = 0, descriptorPath: string | undefined;
  const foreign = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'Unrelated Codebook QA notes.\n' });
  const foreignEditor = await vscode.window.showTextDocument(foreign, { preview: false });
  await foreignEditor.edit(edit => edit.insert(new vscode.Position(1, 0), 'Preserve this unsaved draft.\n')); const foreignText = foreign.getText();
  const nativeSource = async () => {
    const state = api.inspectRepository();
    if (!state?.opened || !state.sourceUri) return undefined;
    const selection = state.view.selection, node = state.view.book?.revision.document.nodes.find(node => node.id === selection?.nodeId), anchor = node?.anchors[selection?.anchorIndex ?? 0];
    assert.ok(anchor); const uri = vscode.Uri.parse(state.sourceUri); assert.equal(uri.scheme, REPOSITORY_SOURCE_SCHEME);
    const document = await vscode.workspace.openTextDocument(uri), editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === state.sourceUri);
    const group = vscode.window.tabGroups.all.find(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === state.sourceUri));
    assert.ok(group, 'Captured repository source owns a native tab.');
    return { uri: state.sourceUri, hash: sha256(document.getText()), expectedHash: anchor.hash, nativeTextMatches: sha256(document.getText()) === anchor.hash,
      expectedStartLine: anchor.startLine, expectedEndLine: anchor.endLine, visible: Boolean(editor), readOnlyScheme: uri.scheme,
      selectedStartLine: editor ? editor.selection.start.line + 1 : undefined, selectedEndLine: editor ? editor.selection.end.line + 1 : undefined, column: group.viewColumn };
  };
  const publish = async (error?: unknown) => {
    const study = api.inspectStudy(), repository = api.inspectRepository();
    assert.equal(foreign.isDirty, true); assert.equal(foreign.getText(), foreignText);
    const library = study?.libraryDirectory ? new LearningLibrary(study.libraryDirectory, study.libraryDirectory.split('/').at(-1)!) : undefined;
    const report = { sequence, descriptorPath, error: error ? String(error) : undefined,
      host: { appName: vscode.env.appName, apiVersion: vscode.version, node: process.versions.node, electron: process.versions.electron, debugger: vscode.extensions.getExtension('ms-vscode.js-debug')?.packageJSON.version },
      workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, repository, study, nativeSource: await nativeSource(), progress: await library?.readProgress(),
      unrelatedDraftPreserved: true, nativePixelsInspected: false, activeDebugSession: vscode.debug.activeDebugSession?.name,
      layout: await vscode.commands.executeCommand('vscode.getEditorLayout'),
      groups: vscode.window.tabGroups.all.map(group => ({ column: group.viewColumn, tabs: group.tabs.map(tab => ({ label: tab.label, dirty: tab.isDirty, active: tab.isActive, uri: tab.input instanceof vscode.TabInputText ? tab.input.uri.toString() : undefined })) })) };
    await writeFile(join(directory, `${prefix}-${sequence}.json`), JSON.stringify(report, null, 2), { mode: PRIVATE_FILE_MODE });
  };
  const waitForReader = async () => waitUntil(() => {
    const state = api.inspectRepository();
    return state?.opened && !state.view.loading && state.view.selection && state.rendered?.revision === state.view.revision ? state : undefined;
  }, 'repository native renderer acknowledgement', NATIVE_OBSERVATION_TIMEOUT_MS);
  try {
    descriptorPath = await vscode.commands.executeCommand<string>('codebook.startAgentServer'); assert.ok(descriptorPath); await publish();
    while (true) {
      let command;
      try { command = commandSchema.parse(JSON.parse(await readFile(join(directory, 'repository-command.json'), 'utf8'))); }
      catch { await delay(NATIVE_COMMAND_POLL_MS); continue; }
      if (command.sequence <= sequence) { await delay(NATIVE_COMMAND_POLL_MS); continue; }
      sequence = command.sequence;
      try {
        if (command.action === 'open-saved') await vscode.commands.executeCommand('codebook.openRepositoryWiki');
        if (command.action === 'select') { assert.ok(command.selection); await vscode.commands.executeCommand('codebook.openRepositoryWiki', command.selection); }
        if (command.action === 'understand') { assert.equal(typeof command.understood, 'boolean'); await vscode.commands.executeCommand('codebook.repository.understand', command.understood); }
        if (command.action === 'return-wiki') await vscode.commands.executeCommand('codebook.study.return-wiki');
        if (['open-saved', 'select', 'understand', 'return-wiki'].includes(command.action)) await waitForReader();
        if (command.action === 'close-wiki') await vscode.commands.executeCommand('codebook.closeRepositoryWiki');
        if (command.action === 'stop-server' || command.action === 'finish') { await vscode.commands.executeCommand('codebook.stopAgentServer'); descriptorPath = undefined; }
        await publish();
        if (command.action === 'finish') return;
      } catch (error) { await publish(error); }
    }
  } catch (error) { await publish(error); throw error; }
  finally { await vscode.commands.executeCommand('codebook.stopAgentServer'); }
}

import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { commandSchema } from './config';
import { COMMAND_POLL_MS, COMMAND_TIMEOUT_MS, PRIVATE_FILE_MODE } from './constants';
import type { activate } from './extension';
import { createNativeDecoy } from './utils/createNativeDecoy';

/** Keeps a private command loop responsive while preparation/input runs independently, reporting actual native state. @example --extensionTestsPath dist/nativeBootstrap.js */
export async function run(): Promise<void> {
  const directory = process.env.CODEBOOK_REAL_REPOSITORY_SESSION; assert.ok(directory);
  const extension = vscode.extensions.getExtension<Awaited<ReturnType<typeof activate>>>('laststance.codebook-cycle-0010'); assert.ok(extension);
  const experiment = await extension.activate(); assert.ok(experiment);
  const decoy = createNativeDecoy(directory, experiment.config.node);
  const foreign = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'Unrelated repository experiment notes.\n' });
  const editor = await vscode.window.showTextDocument(foreign, { preview: false });
  await editor.edit(edit => edit.insert(new vscode.Position(1, 0), 'Keep this unsaved draft.\n'));
  const foreignText = foreign.getText(), deadline = Date.now() + COMMAND_TIMEOUT_MS;
  let sequence = -1;
  const publish = async (error?: unknown, result?: unknown) => {
    assert.equal(foreign.isDirty, true); assert.equal(foreign.getText(), foreignText);
    const report = { sequence, error: error ? String(error) : undefined, result, state: experiment.view(), decoy: decoy.view(), unrelatedDraftPreserved: true,
      groups: vscode.window.tabGroups.all.map(group => ({ column: group.viewColumn, tabs: group.tabs.map(tab => ({ label: tab.label, dirty: tab.isDirty, active: tab.isActive })) })),
      sources: vscode.window.visibleTextEditors.map(value => ({ path: value.document.uri.fsPath, line: value.selection.start.line + 1, column: value.selection.start.character + 1, visible: true })),
      host: { appName: vscode.env.appName, apiVersion: vscode.version, node: process.versions.node, electron: process.versions.electron, debugger: vscode.extensions.getExtension('ms-vscode.js-debug')?.packageJSON.version } };
    const temporary = join(directory, 'receipt.tmp'); await writeFile(temporary, JSON.stringify(report, null, 2), { mode: PRIVATE_FILE_MODE });
    await rename(temporary, join(directory, 'receipt.json')); await writeFile(join(directory, `receipt-${sequence}.json`), JSON.stringify(report, null, 2), { mode: PRIVATE_FILE_MODE });
  };
  try {
    await publish();
    while (Date.now() < deadline) {
      let command;
      try { command = commandSchema.parse(JSON.parse(await readFile(join(directory, 'command.json'), 'utf8'))); }
      catch { await delay(COMMAND_POLL_MS); continue; }
      if (command.sequence <= sequence) { await delay(COMMAND_POLL_MS); continue; }
      sequence = command.sequence;
      try {
        let result: unknown;
        if (command.action === 'prepare') void experiment.prepare().catch(error => experiment.fail(String(error)));
        if (command.action === 'prepare-decoy') await decoy.prepare();
        if (command.action === 'inspect-decoy') result = await decoy.inspect();
        if (command.action === 'click') result = experiment.click(command.key ?? 'toggle-once');
        if (command.action === 'continue') { assert.ok(command.pause); await experiment.continue(command.pause); }
        if (command.action === 'manual-resume' || command.action === 'cdp-resume' || command.action === 'source-drift') await experiment.interfere(command.action);
        if (command.action === 'stop' || command.action === 'finish') await experiment.cleanup();
        await publish(undefined, result);
        if (command.action === 'finish') return;
      } catch (error) { await publish(error); }
    }
    throw new Error('Private native command deadline exceeded');
  } finally {
    // The unrelated QA target outlives primary cleanup, then its own owner releases it explicitly.
    try { await experiment.cleanup(); } finally { await decoy.close(); }
    await writeFile(join(directory, 'decoy-cleanup.json'), JSON.stringify(decoy.view()), { mode: PRIVATE_FILE_MODE });
  }
}

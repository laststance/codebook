import * as vscode from 'vscode';
import { chmod, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createEnvironment, requireWorkspace } from './environment';
import { StudyService } from './service';
import { startServer } from './server';
import { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from './constants';
import { StudyWorkspace } from './studyWorkspace';
import { participantSchema } from './studyModel';

let stopExtension: (() => Promise<void>) | undefined;

/** Registers explicit trusted commands without reading auto-run instructions from repository files. @example VS Code calls activate(context) */
export function activate(context: Pick<vscode.ExtensionContext, 'extensionPath' | 'subscriptions'> & { globalStorageUri: Pick<vscode.Uri, 'fsPath'> }) {
  type Running = { endpoint: Awaited<ReturnType<typeof startServer>>; environment: Awaited<ReturnType<typeof createEnvironment>>; descriptorPath: string; service: StudyService };
  let starting: Promise<Running> | undefined, running: Running | undefined, stopping: Promise<void> | undefined;
  let reader: StudyWorkspace | undefined;
  const workspace = () => reader ??= new StudyWorkspace(context, { start: async () => { await start(); if (!running) throw new Error('Study server did not start.'); return running.service; }, connect });
  const start = async () => {
    requireWorkspace();
    if (stopping) throw new Error('Codebook server is stopping; wait for cleanup before starting.');
    if (running) {
      if (!running.endpoint.listening) throw new Error('Previous server shutdown is incomplete. Retry Codebook: Stop Agent Server before starting a new instance.');
      return running.descriptorPath;
    }
    const attempt = starting ??= (async () => {
      const environment = await createEnvironment(context, workspace().presentation);
      const directory = join(context.globalStorageUri.fsPath, 'agent');
      let endpoint: Awaited<ReturnType<typeof startServer>> | undefined;
      let service: StudyService | undefined;
      try {
        await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE }); await chmod(directory, PRIVATE_DIRECTORY_MODE);
        // js-debug canonicalizes executed paths; source-map allowlists and seals must use the same identity.
        const storageRoot = await realpath(directory);
        service = new StudyService(environment, storageRoot); await workspace().attach(service); endpoint = await startServer(service);
        const descriptorPath = join(storageRoot, `${service.instanceId}.connection.json`);
        await writeFile(descriptorPath, JSON.stringify(endpoint.descriptor), { mode: PRIVATE_FILE_MODE, flag: 'wx' });
        return { endpoint, environment, descriptorPath, service };
      } catch (error) {
        try { if (endpoint) await endpoint.close(); else await service?.shutdown(); if (service) await reader?.retire(service); }
        finally { environment.dispose(); }
        throw error;
      }
    })();
    try { running = await attempt; return running.descriptorPath; }
    finally { if (starting === attempt) starting = undefined; }
  };
  const stop = async () => {
    const attempt = stopping ??= (async () => {
      const target = running ?? await starting?.catch(() => undefined);
      if (!target) return;
      let finalizationError: unknown;
      try { await target.endpoint.close(); }
      catch (error) {
        // Keep ownership when physical release failed; a persistence-only failure can retire the closed endpoint.
        if (!target.endpoint.resourcesReleased) throw error;
        finalizationError = error;
      }
      // The final reader checkpoint must be taken after runtime/explanation shutdown, not the last polling tick.
      try { await reader?.retire(target.service); } catch (error) { finalizationError ??= error; }
      // This unique descriptor belongs only to the stopped instance, never to another window.
      await unlink(target.descriptorPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
      target.environment.dispose(); if (running === target) running = undefined;
      if (finalizationError) throw finalizationError;
    })();
    try { await attempt; } finally { if (stopping === attempt) stopping = undefined; }
  };
  const connect = async () => {
    const descriptorPath = await start(); const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
    await vscode.env.clipboard.writeText(JSON.stringify({ mcpServers: { codebook: { type: 'http', url: descriptor.url, headers: { Authorization: `Bearer ${descriptor.token}` } } } }, null, 2));
    void vscode.window.showInformationMessage('Codebook connection copied. This credential grants access to the selected workspace; recopy after restart.');
  };
  stopExtension = async () => { await stop(); await reader?.dispose(); };
  context.subscriptions.push(vscode.commands.registerCommand('codebook.startAgentServer', start),
    vscode.commands.registerCommand('codebook.stopAgentServer', stop),
    vscode.commands.registerCommand('codebook.copyAgentConnection', connect),
    vscode.commands.registerCommand('codebook.openStudyWorkspace', () => workspace().open()),
    vscode.commands.registerCommand('codebook.closeStudyWorkspace', () => reader?.close()),
    vscode.commands.registerCommand('codebook.selectLearningItem', participant => workspace().select(participantSchema.parse(participant))),
    vscode.commands.registerCommand('codebook.markUnderstanding', understood => { if (understood !== undefined && typeof understood !== 'boolean') throw new Error('Understanding requires a boolean learner choice.'); return workspace().understand(understood); }),
    ...(['run', 'click', 'continue', 'stop', 'return-current', 'source', 'current-file', 'focus-app', 'focus-context', 'outline', 'arrange', 'retry'] as const).map(action => vscode.commands.registerCommand(`codebook.study.${action}`, () => workspace().action(action))),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void stop().then(async () => { await reader?.dispose(); reader = undefined; }).catch(error => vscode.window.showErrorMessage(`Codebook cleanup incomplete: ${String(error)}`)); }));
  // Register lazy readers before restored captured documents or contributed views request their providers.
  workspace();
  return { inspectStudy: () => reader?.inspect() };
}

/** Lets the editor await owned cleanup instead of fire-and-forget disposal during extension shutdown. @example await deactivate() */
export async function deactivate(): Promise<void> { await stopExtension?.(); }

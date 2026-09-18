import * as vscode from 'vscode';
import { chmod, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createEnvironment, requireWorkspace } from './environment';
import { StudyService } from './service';
import { startServer } from './server';
import { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from './constants';

let stopExtension: (() => Promise<void>) | undefined;

/** Registers explicit trusted commands without reading auto-run instructions from repository files. @example VS Code calls activate(context) */
export function activate(context: vscode.ExtensionContext): void {
  type Running = { endpoint: Awaited<ReturnType<typeof startServer>>; environment: Awaited<ReturnType<typeof createEnvironment>>; descriptorPath: string };
  let starting: Promise<Running> | undefined, running: Running | undefined, stopping: Promise<void> | undefined;
  const start = async () => {
    requireWorkspace();
    if (stopping) throw new Error('Codebook server is stopping; wait for cleanup before starting.');
    if (running) return running.descriptorPath;
    const attempt = starting ??= (async () => {
      const environment = await createEnvironment(context);
      const directory = join(context.globalStorageUri.fsPath, 'agent');
      let endpoint: Awaited<ReturnType<typeof startServer>> | undefined;
      let service: StudyService | undefined;
      try {
        await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE }); await chmod(directory, PRIVATE_DIRECTORY_MODE);
        // js-debug canonicalizes executed paths; source-map allowlists and seals must use the same identity.
        const storageRoot = await realpath(directory);
        service = new StudyService(environment, storageRoot); endpoint = await startServer(service);
        const descriptorPath = join(storageRoot, `${service.instanceId}.connection.json`);
        await writeFile(descriptorPath, JSON.stringify(endpoint.descriptor), { mode: PRIVATE_FILE_MODE, flag: 'wx' });
        return { endpoint, environment, descriptorPath };
      } catch (error) { try { if (endpoint) await endpoint.close(); else await service?.shutdown(); } finally { environment.dispose(); } throw error; }
    })();
    try { running = await attempt; return running.descriptorPath; }
    finally { if (starting === attempt) starting = undefined; }
  };
  const stop = async () => {
    const attempt = stopping ??= (async () => {
      const target = running ?? await starting?.catch(() => undefined);
      if (!target) return;
      await target.endpoint.close();
      // This unique descriptor belongs only to the stopped instance, never to another window.
      await unlink(target.descriptorPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
      target.environment.dispose(); if (running === target) running = undefined;
    })();
    try { await attempt; } finally { if (stopping === attempt) stopping = undefined; }
  };
  stopExtension = stop;
  context.subscriptions.push(vscode.commands.registerCommand('codebook.startAgentServer', start),
    vscode.commands.registerCommand('codebook.stopAgentServer', stop),
    vscode.commands.registerCommand('codebook.copyAgentConnection', async () => {
      const descriptorPath = await start(); const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
      await vscode.env.clipboard.writeText(JSON.stringify({ mcpServers: { codebook: { type: 'http', url: descriptor.url, headers: { Authorization: `Bearer ${descriptor.token}` } } } }, null, 2));
      void vscode.window.showInformationMessage('Codebook connection copied. This credential grants access to the selected workspace; recopy after restart.');
    }), vscode.workspace.onDidChangeWorkspaceFolders(() => { void stop().catch(error => vscode.window.showErrorMessage(`Codebook cleanup incomplete: ${String(error)}`)); }));
}

/** Lets the editor await owned cleanup instead of fire-and-forget disposal during extension shutdown. @example await deactivate() */
export async function deactivate(): Promise<void> { await stopExtension?.(); }

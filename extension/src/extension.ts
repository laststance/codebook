import * as vscode from 'vscode';
import { chmod, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createEnvironment, requireWorkspace } from './environment';
import { StudyService } from './service';
import { startServer } from './server';
import { EXTENSION_VERSION, PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from './constants';
import { deployCursorSkill, removeManagedCursorSkill, verifyManagedCursorSkill } from './cursorSkillDeployment';
import { StudyWorkspace } from './studyWorkspace';
import { profileSchema } from './studySchemas';
import { learningItemSchema } from './identitySchemas';
import { RepositoryReader } from './repositoryReader';
import { repositorySelectionSchema } from './learnerSchemas';
import { repositoryActionSchema } from './repositoryView';

let stopExtension: (() => Promise<void>) | undefined;

/** Registers explicit trusted commands without reading auto-run instructions from repository files. @example VS Code calls activate(context) */
export function activate(context: Pick<vscode.ExtensionContext, 'extensionPath' | 'subscriptions'> & { globalStorageUri: Pick<vscode.Uri, 'fsPath'>; workspaceState: Pick<vscode.Memento, 'get' | 'update'> }) {
  type Running = { endpoint: Awaited<ReturnType<typeof startServer>>; environment: Awaited<ReturnType<typeof createEnvironment>>; descriptorPath: string; service: StudyService };
  let starting: Promise<Running> | undefined, running: Running | undefined, stopping: Promise<void> | undefined;
  let registeredCursorServer: string | undefined;
  let notifyMcpDefinitions: () => void = () => {};
  const isCursorHost = vscode.env?.appName?.toLowerCase().includes('cursor') ?? false;
  const setupMatchesCurrentWorkspace = () => {
    try { return context.workspaceState.get<{ workspace: string }>('codebook.aiChatSetup')?.workspace === requireWorkspace(); }
    catch { return false; }
  };
  let reader: StudyWorkspace | undefined;
  let repositoryReader: RepositoryReader | undefined;
  const workspace = (): StudyWorkspace => reader ??= new StudyWorkspace(context, { start: async () => { await start(); if (!running) throw new Error('Study server did not start.'); return running.service; }, connect, returnToRepository: selection => repository().open(selection, undefined, true), openArticle: selection => repository().open(selection) });
  const repository = (): RepositoryReader => repositoryReader ??= new RepositoryReader({ storage: () => workspace().learningStorage(), connect, arrange: (signal, returnSelection, focus) => workspace().arrangeRepository(signal, returnSelection, focus), evidence: (binding, recording, signal, origin) => workspace().openRepositoryEvidence(binding, recording, signal, origin) });
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
        service = new StudyService(environment, storageRoot); await workspace().attach(service);
        service.repository = await repository().storage(); service.repositoryReader = (input, signal) => repository().openFromAgent(input, signal); service.repositoryPublished = () => repository().published();
        endpoint = await startServer(service);
        const descriptorPath = join(storageRoot, `${service.instanceId}.connection.json`);
        await writeFile(descriptorPath, JSON.stringify(endpoint.descriptor), { mode: PRIVATE_FILE_MODE, flag: 'wx' });
        return { endpoint, environment, descriptorPath, service };
      } catch (error) {
        try { if (endpoint) await endpoint.close(); else await service?.shutdown(); if (service) await reader?.retire(service); }
        finally { environment.dispose(); }
        throw error;
      }
    })();
    try { running = await attempt; notifyMcpDefinitions(); return running.descriptorPath; }
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
      if (registeredCursorServer) { vscode.cursor?.mcp?.unregisterServer(registeredCursorServer); registeredCursorServer = undefined; }
      notifyMcpDefinitions();
      if (finalizationError) throw finalizationError;
    })();
    try { await attempt; } finally { if (stopping === attempt) stopping = undefined; }
  };
  const connect = async () => {
    const descriptorPath = await start(); const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
    await vscode.env.clipboard.writeText(JSON.stringify({ mcpServers: { codebook: { type: 'http', url: descriptor.url, headers: { Authorization: `Bearer ${descriptor.token}` } } } }, null, 2));
    void vscode.window.showInformationMessage('Codebook connection copied. This credential grants access to the selected workspace; recopy after restart.');
  };
  const registerCursorConnection = () => {
    if (!running) throw new Error('Codebook server is not running. Run Codebook: Set Up AI Chat again.');
    if (!vscode.cursor?.mcp?.registerServer) throw new Error('This Cursor version does not expose MCP registration to Codebook. Update Cursor or use the public manual connection setup.');
    if (registeredCursorServer) vscode.cursor.mcp.unregisterServer(registeredCursorServer);
    const name = `codebook-${running.service.instanceId}`;
    vscode.cursor.mcp.registerServer({ name, server: { url: running.endpoint.descriptor.url,
      headers: { Authorization: `Bearer ${running.endpoint.descriptor.token}` } } });
    registeredCursorServer = name;
  };
  const setupAiChat = async () => {
    requireWorkspace();
    if (isCursorHost) await deployCursorSkill(context.extensionPath, context.globalStorageUri.fsPath);
    else if (!vscode.lm?.registerMcpServerDefinitionProvider) throw new Error('This VS Code version cannot register the Codebook MCP provider. Update VS Code.');
    await start();
    if (isCursorHost) registerCursorConnection();
    if (!running) throw new Error('Codebook server did not start.');
    await context.workspaceState.update('codebook.aiChatSetup', { workspace: running.endpoint.descriptor.workspace });
    notifyMcpDefinitions();
    void vscode.window.showInformationMessage('Codebook AI chat is ready for this workspace. Open a new chat and choose /codebook.');
  };
  if (!isCursorHost && vscode.lm?.registerMcpServerDefinitionProvider && vscode.EventEmitter && vscode.McpHttpServerDefinition && vscode.Uri) {
    const changes = new vscode.EventEmitter<void>();
    notifyMcpDefinitions = () => changes.fire();
    context.subscriptions.push(changes, vscode.lm.registerMcpServerDefinitionProvider('laststance.codebook.currentWorkspace', {
      onDidChangeMcpServerDefinitions: changes.event,
      provideMcpServerDefinitions: () => {
        if (!running || !setupMatchesCurrentWorkspace()) return [];
        const descriptor = running.endpoint.descriptor;
        return [new vscode.McpHttpServerDefinition('Codebook', vscode.Uri.parse(descriptor.url),
          { Authorization: `Bearer ${descriptor.token}` }, `${EXTENSION_VERSION}-${running.service.instanceId}`)];
      },
      resolveMcpServerDefinition: async definition => {
        if (!setupMatchesCurrentWorkspace()) throw new Error('Run Codebook: Set Up AI Chat for this workspace.');
        if (!(definition instanceof vscode.McpHttpServerDefinition)) throw new Error('Codebook requires an HTTP MCP definition.');
        await start();
        if (!running) throw new Error('Codebook server did not start.');
        const descriptor = running.endpoint.descriptor;
        definition.uri = vscode.Uri.parse(descriptor.url);
        definition.headers = { Authorization: `Bearer ${descriptor.token}` };
        definition.version = `${EXTENSION_VERSION}-${running.service.instanceId}`;
        return definition;
      },
    }));
  }
  stopExtension = async () => { await stop(); await repositoryReader?.dispose(); await reader?.dispose(); };
  context.subscriptions.push(vscode.commands.registerCommand('codebook.startAgentServer', start),
    vscode.commands.registerCommand('codebook.stopAgentServer', stop),
    vscode.commands.registerCommand('codebook.copyAgentConnection', connect),
    vscode.commands.registerCommand('codebook.setupAiChat', setupAiChat),
    vscode.commands.registerCommand('codebook.removeManagedCursorSkill', async () => {
      if (!isCursorHost) throw new Error('This command is available in Cursor only.');
      const choice = await vscode.window.showWarningMessage('Remove the Codebook-owned user skill from Cursor? Other Cursor windows share this skill.', { modal: true }, 'Remove managed skill');
      if (choice !== 'Remove managed skill') return;
      await removeManagedCursorSkill(context.globalStorageUri.fsPath);
      await context.workspaceState.update('codebook.aiChatSetup', undefined);
      if (registeredCursorServer) { vscode.cursor?.mcp?.unregisterServer(registeredCursorServer); registeredCursorServer = undefined; }
      void vscode.window.showInformationMessage('Managed Cursor skill removed. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.');
    }),
    vscode.commands.registerCommand('codebook.restoreManagedCursorSkill', async () => {
      if (!isCursorHost) throw new Error('This command is available in Cursor only.');
      await setupAiChat();
    }),
    vscode.commands.registerCommand('codebook.openStudyWorkspace', () => workspace().open()),
    vscode.commands.registerCommand('codebook.selectPresentation', () => workspace().selectPresentation()),
    vscode.commands.registerCommand('codebook.closeStudyWorkspace', () => reader?.close()),
    vscode.commands.registerCommand('codebook.openRepositoryWiki', async (input?: unknown) => {
      try { await repository().open(input === undefined ? undefined : repositorySelectionSchema.parse(input)); }
      catch (error) {
        // Cold failures have no Wiki panel; report them without waiting for notification dismissal or swallowing rejection.
        void vscode.window.showErrorMessage(`Codebook could not open Repository Wiki: ${String(error)}`); throw error;
      }
    }),
    vscode.commands.registerCommand('codebook.closeRepositoryWiki', () => repositoryReader?.close()),
    vscode.commands.registerCommand('codebook.repository.action', (action: unknown) => repository().action(repositoryActionSchema.parse(action))),
    vscode.commands.registerCommand('codebook.repository.understand', (understood: unknown) => { if (typeof understood !== 'boolean') throw new Error('Understanding requires a boolean learner choice.'); return repository().understand(understood); }),
    vscode.commands.registerCommand('codebook.selectLearningItem', itemId => workspace().select(learningItemSchema.parse(itemId))),
    vscode.commands.registerCommand('codebook.selectStudyProfile', profile => workspace().selectProfile(profileSchema.parse(profile))),
    vscode.commands.registerCommand('codebook.markUnderstanding', understood => { if (understood !== undefined && typeof understood !== 'boolean') throw new Error('Understanding requires a boolean learner choice.'); return workspace().understand(understood); }),
    ...(['run', 'click', 'continue', 'stop', 'return-current', 'return-wiki', 'source', 'current-file', 'focus-app', 'focus-context', 'outline', 'arrange', 'retry'] as const).map(action => vscode.commands.registerCommand(`codebook.study.${action}`, () => workspace().action(action))),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void (async () => {
        try { await context.workspaceState.update('codebook.aiChatSetup', undefined); }
        finally { await stop(); await repositoryReader?.dispose(); repositoryReader = undefined; await reader?.dispose(); reader = undefined; repository(); }
      })().catch(error => vscode.window.showErrorMessage(`Codebook cleanup incomplete: ${String(error)}`));
    }));
  // Register lazy readers before restored captured documents or contributed views request their providers.
  workspace(); repository();
  if (context.workspaceState.get<{ workspace: string }>('codebook.aiChatSetup')) {
    void (async () => {
      if (!setupMatchesCurrentWorkspace()) throw new Error('The selected workspace changed after setup');
      if (isCursorHost) await verifyManagedCursorSkill(context.extensionPath, context.globalStorageUri.fsPath);
      await start();
      if (isCursorHost) registerCursorConnection();
      notifyMcpDefinitions();
    })().catch(error => { void vscode.window.showWarningMessage(`Codebook AI chat did not reconnect: ${String(error)}. Run Codebook: Set Up AI Chat.`); });
  }
  return { inspectStudy: () => reader?.inspect(), inspectRepository: () => repositoryReader?.inspect() };
}

/** Lets the editor await owned cleanup instead of fire-and-forget disposal during extension shutdown. @example await deactivate() */
export async function deactivate(): Promise<void> { await stopExtension?.(); }

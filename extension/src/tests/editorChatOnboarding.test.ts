import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadModule } from './utils/loadModule';

type Command = () => Promise<unknown>;
type Definition = { label: string; uri: string; headers: Record<string, string>; version?: string };
type Provider = { provideMcpServerDefinitions: () => Definition[]; resolveMcpServerDefinition: (definition: Definition) => Promise<Definition> };

/** Loads the real activation boundary with isolated editor/server effects so chat setup cannot touch a user profile. @example await boundary(t, 'Cursor') */
async function boundary(context: { after: (callback: () => Promise<void>) => void }, appName: 'Cursor' | 'Visual Studio Code') {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-chat-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const commands = new Map<string, Command>(), state = new Map<string, unknown>();
  const registrations: { name: string; server: { command: string; args: string[]; env: Record<string, string> } }[] = [], removals: string[] = [];
  let provider: Provider | undefined, instance = 0, notices = 0, skillDeployments = 0;
  class Emitter { event = () => {}; fire() { notices += 1; } dispose() {} }
  class HttpDefinition implements Definition {
    constructor(public label: string, public uri: string, public headers: Record<string, string>, public version?: string) {}
  }
  class Service {
    instanceId = `instance-${++instance}`;
    repository: unknown; repositoryReader: unknown; repositoryPublished: unknown;
    constructor(public environment: { workspace: string; dispose: () => void }) {}
  }
  const vscode = {
    env: { appName },
    commands: { registerCommand(name: string, action: Command) { commands.set(name, action); return { dispose() {} }; } },
    workspace: { onDidChangeWorkspaceFolders: () => ({ dispose() {} }), getConfiguration: () => ({ get: (_name: string, fallback: string) => fallback }) },
    window: { showInformationMessage() { return Promise.resolve(undefined); }, showWarningMessage() { return Promise.resolve(undefined); } },
    EventEmitter: Emitter, McpHttpServerDefinition: HttpDefinition, Uri: { parse: (value: string) => value },
    lm: { registerMcpServerDefinitionProvider(_id: string, received: Provider) { provider = received; return { dispose() {} }; } },
    cursor: { mcp: { registerServer(config: typeof registrations[number]) { registrations.push(config); }, unregisterServer(name: string) { removals.push(name); } } },
  };
  const loaded = await loadModule<typeof import('../extension')>(resolve(__dirname, '../extension.js'), {
    vscode,
    './service': { StudyService: Service },
    './environment': { requireWorkspace: () => directory, createEnvironment: async () => ({ workspace: directory, dispose() {} }) },
    './server': { startServer: async (service: Service) => ({ listening: true, resourcesReleased: true,
      descriptor: { url: `http://127.0.0.1/${service.instanceId}/mcp`, token: `token-${service.instanceId}`, instanceId: service.instanceId, workspace: directory, apiVersion: '1.5' },
      close: async () => {} }) },
    './studyWorkspace': { StudyWorkspace: class { presentation = undefined; async attach() {} async retire() {} async dispose() {} } },
    './repositoryReader': { RepositoryReader: class { async storage() {} async dispose() {} } },
    './cursorSkillDeployment': { deployCursorSkill: async () => { skillDeployments += 1; return { status: 'installed' }; }, verifyManagedCursorSkill: async () => ({ status: 'current' }) },
  });
  loaded.activate({ extensionPath: directory, globalStorageUri: { fsPath: directory }, subscriptions: [],
    workspaceState: { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => { state.set(key, value); } } });
  return { loaded, commands, state, registrations, removals, directory, provider: () => provider, notices: () => notices, skillDeployments: () => skillDeployments };
}

test('VS Code setup exposes only the current workspace MCP credentials and refreshes them after stop', async context => {
  // Arrange
  const editor = await boundary(context, 'Visual Studio Code'), provider = editor.provider();
  assert.ok(provider); assert.equal(provider.provideMcpServerDefinitions().length, 0);
  try {
    // Act
    await editor.commands.get('codebook.setupAiChat')!();
    const initial = provider.provideMcpServerDefinitions()[0]!;
    await editor.commands.get('codebook.stopAgentServer')!();
    const afterStop = provider.provideMcpServerDefinitions();
    const refreshed = await provider.resolveMcpServerDefinition(initial);
    // Assert
    assert.equal(initial.label, 'Codebook'); assert.equal(afterStop.length, 0);
    assert.equal(refreshed.uri, 'http://127.0.0.1/instance-2/mcp');
    assert.equal(refreshed.headers.Authorization, 'Bearer token-instance-2');
    const setup = editor.state.get('codebook.aiChatSetup');
    assert.equal(editor.skillDeployments(), 0);
    assert.equal(typeof setup === 'object' && setup !== null && 'workspace' in setup && typeof setup.workspace === 'string' && setup.workspace.length > 0, true);
    assert.ok(editor.notices() >= 3);
  } finally { await editor.loaded.deactivate(); }
});

test('repeating Cursor setup keeps the active MCP bridge, while stop and setup register a fresh instance', async context => {
  // Arrange
  const editor = await boundary(context, 'Cursor');
  assert.equal(editor.provider(), undefined);
  try {
    // Act
    await editor.commands.get('codebook.setupAiChat')!();
    const registration = editor.registrations[0]!;
    await editor.commands.get('codebook.setupAiChat')!();
    const registrationsBeforeStop = editor.registrations.length, removalsBeforeStop = editor.removals.length;
    await editor.commands.get('codebook.stopAgentServer')!();
    await editor.commands.get('codebook.setupAiChat')!();
    const nextRegistration = editor.registrations[1]!;
    await editor.commands.get('codebook.stopAgentServer')!();
    // Assert
    assert.equal(editor.skillDeployments(), 3);
    assert.equal(registrationsBeforeStop, 1);
    assert.equal(removalsBeforeStop, 0);
    assert.equal(registration.name, 'codebook-instance-1');
    assert.equal(registration.server.command, 'node');
    assert.equal(registration.server.args[0], join(editor.directory, 'dist/cursorMcpBridge.js'));
    assert.equal(registration.server.args[1], join(await realpath(join(editor.directory, 'agent')), 'instance-1.connection.json'));
    assert.equal(Object.keys(registration.server.env).length, 0);
    assert.doesNotMatch(JSON.stringify(registration), /token-instance-1/);
    assert.equal(nextRegistration.name, 'codebook-instance-2');
    assert.deepEqual(editor.removals, ['codebook-instance-1', 'codebook-instance-2']);
  } finally { await editor.loaded.deactivate(); }
});

test('starting an already configured Cursor workspace after stop restores its MCP connection without rerunning setup', async context => {
  // Arrange
  const editor = await boundary(context, 'Cursor');
  try {
    await editor.commands.get('codebook.setupAiChat')!();
    await editor.commands.get('codebook.stopAgentServer')!();
    // Act
    await editor.commands.get('codebook.startAgentServer')!();
    // Assert
    assert.equal(editor.registrations.length, 2);
    assert.equal(editor.registrations[1]?.name, 'codebook-instance-2');
    assert.equal(editor.skillDeployments(), 1);
    assert.deepEqual(editor.removals, ['codebook-instance-1']);
  } finally { await editor.loaded.deactivate(); }
});

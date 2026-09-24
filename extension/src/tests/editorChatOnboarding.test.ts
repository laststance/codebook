import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadModule } from './utils/loadModule';

type Command = () => Promise<unknown>;
type Definition = { label: string; uri: string; headers: Record<string, string>; version?: string };
type Provider = { provideMcpServerDefinitions: () => Definition[]; resolveMcpServerDefinition: (definition: Definition) => Promise<Definition> };

/** Loads the real activation boundary with isolated editor/server effects so chat setup cannot touch a user profile. @example await boundary(t, 'Cursor') */
async function boundary(context: { after: (callback: () => Promise<void>) => void }, appName: 'Cursor' | 'Visual Studio Code', nodeReady = true, confirmRemoval = false) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-chat-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const commands = new Map<string, Command>(), state = new Map<string, unknown>();
  const registrations: { name: string; server: { command: string; args: string[]; env: Record<string, string> } }[] = [], removals: string[] = [];
  let provider: Provider | undefined, instance = 0, notices = 0, skillDeployments = 0, skillRemovals = 0, catalogRefreshes = 0, catalogRemovals = 0, failCatalogRefresh = false;
  const warnings: string[] = [];
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
    window: { showInformationMessage() { return Promise.resolve(undefined); }, showWarningMessage(message: string) { warnings.push(message); return Promise.resolve(confirmRemoval ? 'Remove managed skill' : undefined); } },
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
    './cursorSkillDeployment': { deployCursorSkill: async () => { skillDeployments += 1; return { status: 'installed' }; },
      removeManagedCursorSkill: async () => { skillRemovals += 1; return { status: 'removed' }; }, verifyManagedCursorSkill: async () => ({ status: 'current' }) },
    './utils/resolveExternalNodeExecutable': { resolveExternalNodeExecutable: async () => {
      if (!nodeReady) throw new Error('Expected an absolute external Node.js >=24 executable, not Electron.');
      return '/external/node';
    } },
    './utils/refreshCursorMcpCatalog': { refreshCursorMcpCatalog: async () => { catalogRefreshes += 1; if (failCatalogRefresh) { failCatalogRefresh = false; throw new Error('Injected Cursor catalog refresh failure'); } },
      removeOwnedCursorMcpCatalog: async () => { catalogRemovals += 1; return 'removed'; } },
  });
  loaded.activate({ extensionPath: directory, globalStorageUri: { fsPath: directory }, subscriptions: [],
    workspaceState: { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => { state.set(key, value); } } });
  return { loaded, commands, state, registrations, removals, directory, provider: () => provider, notices: () => notices,
    skillDeployments: () => skillDeployments, skillRemovals: () => skillRemovals,
    catalogRefreshes: () => catalogRefreshes, catalogRemovals: () => catalogRemovals,
    failNextCatalogRefresh() { failCatalogRefresh = true; }, warnings: () => warnings };
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
    assert.equal(editor.catalogRefreshes(), 4);
    assert.equal(removalsBeforeStop, 0);
    assert.equal(registration.name, 'codebook-instance-1');
    assert.equal(registration.server.command, '/external/node');
    assert.equal(registration.server.args[0], join(editor.directory, 'dist/cursorMcpBridge.js'));
    assert.equal(registration.server.args[1], join(await realpath(join(editor.directory, 'agent')), 'instance-1.connection.json'));
    assert.equal(Object.keys(registration.server.env).length, 0);
    assert.doesNotMatch(JSON.stringify(registration), /token-instance-1/);
    assert.equal(nextRegistration.name, 'codebook-instance-2');
    assert.deepEqual(editor.removals, ['codebook-instance-1', 'codebook-instance-2']);
  } finally { await editor.loaded.deactivate(); }
});

test('Cursor setup rejects an invalid Node before deploying the skill or reporting chat ready', async context => {
  // Arrange
  const editor = await boundary(context, 'Cursor', false);
  try {
    // Act / Assert
    await assert.rejects(editor.commands.get('codebook.setupAiChat')!(), /external Node.js >=24/);
    assert.equal(editor.skillDeployments(), 0);
    assert.equal(editor.registrations.length, 0);
    assert.equal(editor.state.has('codebook.aiChatSetup'), false);
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

test('a failed Cursor MCP registration after server start keeps its descriptor available and warns the learner', async context => {
  // Arrange
  const editor = await boundary(context, 'Cursor');
  try {
    await editor.commands.get('codebook.setupAiChat')!();
    await editor.commands.get('codebook.stopAgentServer')!();
    editor.failNextCatalogRefresh();

    // Act
    const descriptorPath = await editor.commands.get('codebook.startAgentServer')!();

    // Assert
    assert.ok(typeof descriptorPath === 'string');
    assert.match(descriptorPath, /instance-2\.connection\.json$/);
    assert.equal(JSON.parse(await readFile(descriptorPath, 'utf8')).instanceId, 'instance-2');
    assert.match(editor.warnings().at(-1) ?? '', /Cursor MCP.*failed.*Set Up AI Chat/);
    assert.equal(editor.registrations.at(-1)?.name, 'codebook-instance-2');
    await editor.commands.get('codebook.stopAgentServer')!();
  } finally { await editor.loaded.deactivate(); }
});

test('removing the managed Cursor skill also retires an unchanged Codebook-owned catalog config', async context => {
  // Arrange
  const editor = await boundary(context, 'Cursor', true, true);
  try {
    await editor.commands.get('codebook.setupAiChat')!();
    // Act
    await editor.commands.get('codebook.removeManagedCursorSkill')!();
    // Assert
    assert.equal(editor.skillRemovals(), 1);
    assert.equal(editor.catalogRemovals(), 1);
    assert.equal(editor.state.get('codebook.aiChatSetup'), undefined);
    assert.deepEqual(editor.removals, ['codebook-instance-1']);
  } finally { await editor.loaded.deactivate(); }
});

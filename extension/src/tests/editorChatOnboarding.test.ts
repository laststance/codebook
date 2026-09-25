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
  let provider: Provider | undefined, instance = 0, notices = 0, skillDeployments = 0, skillRemovals = 0, catalogRefreshes = 0, catalogRemovals = 0, failCatalogRefresh = false, skillPresent = false, catalogPresent = false, catalogGeneration = '';
  let deferredNode: { entered(): void; wait: Promise<void> } | undefined;
  let deferredServer: { entered(): void; wait: Promise<void> } | undefined;
  let deferredSetupSave: { entered(): void; wait: Promise<void> } | undefined;
  let deferredCatalog: { entered(): void; wait: Promise<void> } | undefined;
  let deferredCatalogRemoval: { entered(): void; wait: Promise<void> } | undefined;
  let deferredSkillRemoval: { entered(): void; wait: Promise<void> } | undefined;
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
    './server': { startServer: async (service: Service) => {
      const deferred = deferredServer; deferredServer = undefined;
      if (deferred) { deferred.entered(); await deferred.wait; }
      return { listening: true, resourcesReleased: true,
      descriptor: { url: `http://127.0.0.1/${service.instanceId}/mcp`, token: `token-${service.instanceId}`, instanceId: service.instanceId, workspace: directory, apiVersion: '1.5' },
      close: async () => {} };
    } },
    './studyWorkspace': { StudyWorkspace: class { presentation = undefined; async attach() {} async retire() {} async dispose() {} } },
    './repositoryReader': { RepositoryReader: class { async storage() {} async dispose() {} } },
    './cursorSkillDeployment': { deployCursorSkill: async () => { skillDeployments += 1; skillPresent = true; return { status: 'installed' }; },
      removeManagedCursorSkill: async () => {
        skillRemovals += 1; skillPresent = false;
        const deferred = deferredSkillRemoval; deferredSkillRemoval = undefined;
        if (deferred) { deferred.entered(); await deferred.wait; }
        return { status: 'removed' };
      },
      verifyManagedCursorSkill: async () => { if (!skillPresent) throw new Error('Cursor skill is missing, changed or outdated.'); return { status: 'current' }; } },
    './utils/resolveExternalNodeExecutable': { resolveExternalNodeExecutable: async () => {
      const deferred = deferredNode; deferredNode = undefined;
      if (deferred) { deferred.entered(); await deferred.wait; }
      if (!nodeReady) throw new Error('Expected an absolute external Node.js >=24 executable, not Electron.');
      return '/external/node';
    } },
    './utils/refreshCursorMcpCatalog': { refreshCursorMcpCatalog: async () => {
      const deferred = deferredCatalog; deferredCatalog = undefined;
      if (deferred) { deferred.entered(); await deferred.wait; }
      catalogRefreshes += 1;
      if (failCatalogRefresh) { failCatalogRefresh = false; throw new Error('Injected Cursor catalog refresh failure'); }
      catalogPresent = true;
      catalogGeneration = `refresh-${catalogRefreshes}`;
      return catalogGeneration;
    },
      captureOwnedCursorMcpCatalogGeneration: async () => {
        if (!catalogPresent) return undefined;
        catalogGeneration = `captured-${catalogRefreshes}`;
        return catalogGeneration;
      },
      removeOwnedCursorMcpCatalog: async (_storageRoot: string, _cursorDirectory?: string, expectedRefreshId?: string) => {
        const deferred = deferredCatalogRemoval; deferredCatalogRemoval = undefined;
        if (deferred) { deferred.entered(); await deferred.wait; }
        catalogRemovals += 1;
        if (expectedRefreshId !== undefined && expectedRefreshId !== catalogGeneration) return 'preserved';
        catalogPresent = false;
        return 'removed';
      } },
  });
  loaded.activate({ extensionPath: directory, globalStorageUri: { fsPath: directory }, subscriptions: [],
    workspaceState: { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => {
      const deferred = key === 'codebook.aiChatSetup' && value !== undefined ? deferredSetupSave : undefined;
      if (deferred) { deferredSetupSave = undefined; deferred.entered(); await deferred.wait; }
      state.set(key, value);
    } } });
  return { loaded, commands, state, registrations, removals, directory, provider: () => provider, notices: () => notices,
    skillDeployments: () => skillDeployments, skillRemovals: () => skillRemovals,
    catalogRefreshes: () => catalogRefreshes, catalogRemovals: () => catalogRemovals,
    holdNextNodeResolution() {
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const wait = new Promise<void>(resolve => { release = resolve; });
      deferredNode = { entered, wait };
      return { started, release };
    },
    holdNextServerStart() {
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const wait = new Promise<void>(resolve => { release = resolve; });
      deferredServer = { entered, wait };
      return { started, release };
    },
    holdNextSetupSave() {
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const wait = new Promise<void>(resolve => { release = resolve; });
      deferredSetupSave = { entered, wait };
      return { started, release };
    },
    holdNextCatalogRefresh() {
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const wait = new Promise<void>(resolve => { release = resolve; });
      deferredCatalog = { entered, wait };
      return { started, release };
    },
    holdNextCatalogRemoval() {
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const wait = new Promise<void>(resolve => { release = resolve; });
      deferredCatalogRemoval = { entered, wait };
      return { started, release };
    },
    holdNextSkillRemoval() {
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const wait = new Promise<void>(resolve => { release = resolve; });
      deferredSkillRemoval = { entered, wait };
      return { started, release };
    },
    removeSkillFromAnotherWindow() { skillPresent = false; catalogPresent = false; },
    restoreSkillInAnotherWindow() { skillPresent = true; catalogPresent = true; catalogGeneration = 'restored-in-another-window'; },
    catalogPresent: () => catalogPresent,
    failNextCatalogRefresh() { failCatalogRefresh = true; }, warnings: () => warnings };
}

test('VS Code discovers Codebook without credentials and supplies the current token only when starting it', async context => {
  // Arrange
  const editor = await boundary(context, 'Visual Studio Code'), provider = editor.provider();
  assert.ok(provider); assert.equal(provider.provideMcpServerDefinitions().length, 0);
  try {
    // Act
    await editor.commands.get('codebook.setupAiChat')!();
    const initial = provider.provideMcpServerDefinitions()[0]!;
    assert.equal(Object.keys(initial.headers).length, 0);
    assert.equal(JSON.stringify(initial).includes('token-instance-1'), false);
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

test('two rapid Cursor setup commands install one skill and register one MCP connection', async context => {
  // Arrange
  const editor = await boundary(context, 'Cursor');
  const held = editor.holdNextServerStart();
  try {
    const firstSetup = editor.commands.get('codebook.setupAiChat')!();
    await held.started;

    // Act
    const secondSetup = editor.commands.get('codebook.setupAiChat')!();
    held.release();
    await Promise.all([firstSetup, secondSetup]);

    // Assert
    assert.equal(editor.skillDeployments(), 1);
    assert.equal(editor.registrations.length, 1);
    assert.equal(editor.catalogRefreshes(), 1);
    assert.equal(editor.state.has('codebook.aiChatSetup'), true);
  } finally { held.release(); await editor.loaded.deactivate(); }
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

test('concurrent Cursor starts register one MCP bridge for the restarted server', async context => {
  // Arrange
  const editor = await boundary(context, 'Cursor');
  try {
    await editor.commands.get('codebook.setupAiChat')!();
    await editor.commands.get('codebook.stopAgentServer')!();
    // Act
    await Promise.all([editor.commands.get('codebook.startAgentServer')!(), editor.commands.get('codebook.startAgentServer')!()]);
    // Assert
    assert.equal(editor.registrations.length, 2);
    assert.equal(editor.registrations[1]?.name, 'codebook-instance-2');
    assert.deepEqual(editor.removals, ['codebook-instance-1']);
  } finally { await editor.loaded.deactivate(); }
});

test('stopping Cursor while its Node resolves never registers a retired server descriptor', async context => {
  // Arrange
  const editor = await boundary(context, 'Cursor');
  let release = () => {};
  try {
    await editor.commands.get('codebook.setupAiChat')!();
    await editor.commands.get('codebook.stopAgentServer')!();
    const deferred = editor.holdNextNodeResolution(); release = deferred.release;
    const starting = editor.commands.get('codebook.startAgentServer')!();
    await deferred.started;
    // Act
    await editor.commands.get('codebook.stopAgentServer')!();
    deferred.release();
    await assert.rejects(starting, /Codebook server changed|Codebook server stopped/);
    // Assert
    assert.equal(editor.registrations.length, 1);
    assert.deepEqual(editor.removals, ['codebook-instance-1']);
  } finally { release(); await editor.loaded.deactivate(); }
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

test('removing Cursor setup while its server starts cannot save a deleted skill as ready', async context => {
  // Arrange
  const editor = await boundary(context, 'Cursor', true, true);
  const held = editor.holdNextServerStart();
  try {
    const setup = editor.commands.get('codebook.setupAiChat')!();
    await held.started;
    // Act
    const removal = editor.commands.get('codebook.removeManagedCursorSkill')!();
    held.release();
    const [setupResult, removalResult] = await Promise.allSettled([setup, removal]);
    // Assert
    assert.equal(removalResult.status, 'fulfilled');
    assert.equal(setupResult.status, 'rejected');
    assert.equal(editor.state.get('codebook.aiChatSetup'), undefined);
    assert.equal(editor.skillRemovals(), 1);
    assert.equal(editor.registrations.length, 0);
  } finally { held.release(); await editor.loaded.deactivate(); }
});

test('removing Cursor setup while reconnecting cannot restore its MCP registration', async context => {
  // Arrange
  const editor = await boundary(context, 'Cursor', true, true);
  let release = () => {};
  try {
    await editor.commands.get('codebook.setupAiChat')!();
    await editor.commands.get('codebook.stopAgentServer')!();
    const held = editor.holdNextNodeResolution(); release = held.release;
    const reconnecting = editor.commands.get('codebook.startAgentServer')!();
    await held.started;
    // Act
    const removal = editor.commands.get('codebook.removeManagedCursorSkill')!();
    held.release();
    const [, removalResult] = await Promise.allSettled([reconnecting, removal]);
    // Assert
    assert.equal(removalResult.status, 'fulfilled');
    assert.equal(editor.state.get('codebook.aiChatSetup'), undefined);
    assert.equal(editor.registrations.length, 1);
    assert.equal(editor.catalogRefreshes(), 1);
    assert.equal(editor.catalogRemovals(), 1);
  } finally { release(); await editor.loaded.deactivate(); }
});

test('Cursor setup does not report ready when another window removes its shared skill during server start', async context => {
  // Arrange
  const editor = await boundary(context, 'Cursor');
  const held = editor.holdNextServerStart();
  try {
    const setup = editor.commands.get('codebook.setupAiChat')!();
    await held.started;
    // Act
    editor.removeSkillFromAnotherWindow();
    held.release();
    const result = await Promise.allSettled([setup]);
    // Assert
    assert.equal(result[0]?.status, 'rejected');
    assert.equal(editor.registrations.length, 0);
    assert.equal(editor.state.get('codebook.aiChatSetup'), undefined);
  } finally { held.release(); await editor.loaded.deactivate(); }
});

test('Cursor setup clears ready state when another window removes its skill during the saved setup write', async context => {
  // Arrange
  const editor = await boundary(context, 'Cursor');
  const held = editor.holdNextSetupSave();
  try {
    const setup = editor.commands.get('codebook.setupAiChat')!();
    await held.started;
    // Act
    editor.removeSkillFromAnotherWindow();
    held.release();
    const result = await Promise.allSettled([setup]);
    // Assert
    assert.equal(result[0]?.status, 'rejected');
    assert.equal(editor.state.get('codebook.aiChatSetup'), undefined);
    assert.deepEqual(editor.removals, ['codebook-instance-1']);
  } finally { held.release(); await editor.loaded.deactivate(); }
});

test('Cursor setup retires its empty catalog when another window removes the skill during refresh', async context => {
  // Arrange
  const editor = await boundary(context, 'Cursor');
  const held = editor.holdNextCatalogRefresh();
  try {
    const setup = editor.commands.get('codebook.setupAiChat')!();
    await held.started;
    // Act
    editor.removeSkillFromAnotherWindow();
    held.release();
    const result = await Promise.allSettled([setup]);
    // Assert
    assert.equal(result[0]?.status, 'rejected');
    assert.equal(editor.catalogPresent(), false);
    assert.equal(editor.catalogRemovals(), 1);
    assert.equal(editor.state.get('codebook.aiChatSetup'), undefined);
    assert.deepEqual(editor.removals, ['codebook-instance-1']);
  } finally { held.release(); await editor.loaded.deactivate(); }
});

test('failed Cursor setup preserves a newer window catalog restored before its cleanup', async context => {
  // Arrange
  const editor = await boundary(context, 'Cursor');
  const heldRefresh = editor.holdNextCatalogRefresh(), heldRemoval = editor.holdNextCatalogRemoval();
  try {
    const setup = editor.commands.get('codebook.setupAiChat')!();
    await heldRefresh.started;
    editor.removeSkillFromAnotherWindow();
    heldRefresh.release();
    await heldRemoval.started;
    // Act
    editor.restoreSkillInAnotherWindow();
    heldRemoval.release();
    const result = await Promise.allSettled([setup]);
    // Assert
    assert.equal(result[0]?.status, 'rejected');
    assert.equal(editor.catalogPresent(), true);
    assert.equal(editor.catalogRemovals(), 1);
    assert.equal(editor.state.get('codebook.aiChatSetup'), undefined);
  } finally { heldRefresh.release(); heldRemoval.release(); await editor.loaded.deactivate(); }
});

test('explicit Cursor removal preserves a catalog restored by another window after skill deletion', async context => {
  // Arrange
  const editor = await boundary(context, 'Cursor', true, true);
  const held = editor.holdNextSkillRemoval();
  try {
    await editor.commands.get('codebook.setupAiChat')!();
    const removal = editor.commands.get('codebook.removeManagedCursorSkill')!();
    await held.started;
    // Act
    editor.restoreSkillInAnotherWindow();
    held.release();
    await removal;
    // Assert
    assert.equal(editor.catalogPresent(), true);
    assert.equal(editor.catalogRemovals(), 1);
    assert.equal(editor.skillRemovals(), 1);
  } finally { held.release(); await editor.loaded.deactivate(); }
});

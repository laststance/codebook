import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type * as ExtensionModule from '../extension'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

type Command = () => Promise<unknown>
type Notice = {
  severity: 'information' | 'warning' | 'error'
  message: string
  actions: string[]
}
type DevinEntry = {
  command: string
  args: string[]
  env: Record<string, string>
}
type EntryRefreshStatus = 'refreshed' | 'current' | 'not-managed' | 'changed'

/**
 * Loads the real activation boundary as Devin Desktop (`uriScheme` `devin`) with every skill, MCP config, Node and server effect replaced, so a test reads which setup steps ran, in which order, without touching a user profile.
 * @param context - The test, which removes the temporary folder afterwards.
 * @param options - `platform` the window's system (macOS when left out); `savedSetup` a setup saved for this workspace before the window opened; `skillManaged` whether the Devin skill still has its receipt; `entryRefresh` what the MCP entry's refresh answers; `noticeChoice` the button every information notice answers; `confirmRemoval` whether the removal's modal question is confirmed; `holdRefresh` holds the entry's refresh until the test releases it; `failSetupClear` makes clearing the saved setup fail; `entryWrite` what the entry's write answers (`installed` when left out).
 * @returns The window's commands, saved state, recorded steps, notices, Output lines and executed editor commands.
 * @example const window = await devinWindow(context, { savedSetup: true, entryRefresh: 'refreshed' })
 */
async function devinWindow(
  context: { after: (callback: () => Promise<void>) => void },
  options: {
    platform?: NodeJS.Platform
    savedSetup?: boolean
    skillManaged?: boolean
    entryRefresh?: EntryRefreshStatus
    noticeChoice?: string
    confirmRemoval?: boolean
    holdRefresh?: boolean
    failSetupClear?: boolean
    entryWrite?: 'installed' | 'current'
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(directory))
  const configPath = join(directory, 'home/.config/devin/mcp_config.json')
  const commands = new Map<string, Command>(),
    state = new Map<string, unknown>()
  const steps: string[] = [],
    notices: Notice[] = [],
    modalQuestions: string[] = [],
    outputLines: string[] = [],
    executedCommands: string[] = [],
    writtenEntries: DevinEntry[] = [],
    refreshedEntries: DevinEntry[] = [],
    entryRemovals: unknown[] = []
  let instance = 0
  // The refresh waits here when a test holds it; `refreshEntered` tells the test it is waiting.
  let releaseRefresh!: () => void, refreshEntered!: () => void
  const refreshHeld = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })
  const refreshReached = new Promise<void>((resolve) => {
    refreshEntered = resolve
  })
  // A setup saved by an earlier window names the workspace this window opens.
  if (options.savedSetup)
    state.set('codebook.aiChatSetup', { workspace: directory })
  class Emitter {
    event = (): void => {}
    fire(): void {}
    dispose(): void {}
  }
  class HttpDefinition {
    constructor(
      public label: string,
      public uri: string,
    ) {}
  }
  class Service {
    instanceId = `instance-${++instance}`
    repository: unknown
    repositoryReader: unknown
    repositoryPublished: unknown
    constructor(
      public environment: { workspace: string; dispose: () => void },
    ) {}
  }
  const vscode = {
    env: {
      appName: 'Devin',
      uriScheme: 'devin',
      machineId: 'machine-of-this-editor',
    },
    commands: {
      registerCommand(name: string, action: Command) {
        commands.set(name, action)
        return { dispose(): void {} }
      },
      executeCommand(name: string) {
        executedCommands.push(name)
        return Promise.resolve(undefined)
      },
    },
    workspace: {
      onDidChangeWorkspaceFolders: () => ({ dispose(): void {} }),
      getConfiguration: () => ({
        get: (_name: string, fallback: string) => fallback,
      }),
    },
    window: {
      createOutputChannel: () => ({
        info(line: string): void {
          outputLines.push(line)
        },
        error(): void {},
        dispose(): void {},
      }),
      showInformationMessage(message: string, ...actions: string[]) {
        notices.push({ severity: 'information', message, actions })
        return Promise.resolve(options.noticeChoice)
      },
      showWarningMessage(message: string, ...rest: unknown[]) {
        // A modal confirmation passes its options object before its buttons.
        if (typeof rest[0] === 'object') {
          modalQuestions.push(message)
          return Promise.resolve(
            options.confirmRemoval ? 'Remove Devin setup' : undefined,
          )
        }
        notices.push({
          severity: 'warning',
          message,
          actions: rest.filter((action) => typeof action === 'string'),
        })
        return Promise.resolve(undefined)
      },
      showErrorMessage(message: string, ...actions: string[]) {
        notices.push({ severity: 'error', message, actions })
        return Promise.resolve(undefined)
      },
    },
    EventEmitter: Emitter,
    McpHttpServerDefinition: HttpDefinition,
    Uri: { parse: (value: string) => value },
    lm: {
      registerMcpServerDefinitionProvider: () => ({ dispose(): void {} }),
    },
  }
  const loaded = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode,
      './service': { StudyService: Service },
      './environment': {
        requireWorkspace: () => directory,
        createEnvironment: async () => ({
          workspace: directory,
          dispose(): void {},
        }),
      },
      './server': {
        startServer: async (service: Service) => {
          steps.push('start server')
          return {
            listening: true,
            resourcesReleased: true,
            descriptor: {
              url: `http://127.0.0.1/${service.instanceId}/mcp`,
              token: 'test-token',
              instanceId: service.instanceId,
              workspace: directory,
              apiVersion: '1.6',
            },
            close: async (): Promise<void> => {},
          }
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          presentation = undefined
          async attach(): Promise<void> {}
          async retire(): Promise<void> {}
          async dispose(): Promise<void> {}
        },
      },
      './repositoryReader': {
        RepositoryReader: class {
          async storage(): Promise<void> {}
          async dispose(): Promise<void> {}
        },
      },
      './cursorSkillDeployment': {
        deployCursorSkill: async () => {
          steps.push('deploy Cursor skill')
          return { status: 'installed' }
        },
        verifyManagedCursorSkill: async () => {
          steps.push('verify Cursor skill')
          return { status: 'current' }
        },
        removeManagedCursorSkill: async () => {
          steps.push('remove Cursor skill')
          return { status: 'removed' }
        },
        deployDevinSkill: async () => {
          steps.push('deploy Devin skill')
          return { status: 'installed' }
        },
        verifyManagedDevinSkill: async () => {
          steps.push('verify Devin skill')
          // A skill whose receipt is gone was removed by another window.
          if (options.skillManaged === false)
            throw new Error(
              'Devin Desktop skill is missing or was changed: /home/user/.config/devin/skills/codebook/SKILL.md. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
            )
          return { status: 'current' }
        },
        removeManagedDevinSkill: async () => {
          steps.push('remove Devin skill')
          return { status: 'removed' }
        },
      },
      './devinMcpConfig': {
        writeManagedDevinMcpEntry: async (
          _storageRoot: string,
          entry: DevinEntry,
        ) => {
          steps.push('write MCP entry')
          // The entry comes from the loaded module's own realm; a copy of this realm compares by value.
          writtenEntries.push(structuredClone(entry))
          return {
            status: options.entryWrite ?? 'installed',
            path: configPath,
            generation: 'generation-of-this-setup',
          }
        },
        refreshManagedDevinMcpEntry: async (
          _storageRoot: string,
          entry: DevinEntry,
        ) => {
          steps.push('refresh MCP entry')
          refreshedEntries.push(structuredClone(entry))
          if (options.holdRefresh) {
            refreshEntered()
            await refreshHeld
          }
          return { status: options.entryRefresh ?? 'current', path: configPath }
        },
        removeManagedDevinMcpEntry: async (
          _storageRoot: string,
          _homeRoot?: string,
          _seam?: unknown,
          removalOptions?: unknown,
        ) => {
          steps.push('remove MCP entry')
          entryRemovals.push(structuredClone(removalOptions))
          return { status: 'removed', path: configPath }
        },
      },
      './utils/resolveExternalNodeExecutable': {
        resolveExternalNodeExecutable: async () => {
          steps.push('resolve Node')
          return '/external/node'
        },
      },
    },
    // The window runs on macOS unless a test names another system, which the setup reads as `process.platform`: the suite also runs on Windows, where Devin Desktop setup refuses.
    {
      process: new Proxy(process, {
        get: (target, key) =>
          key === 'platform'
            ? (options.platform ?? 'darwin')
            : Reflect.get(target, key, target),
      }),
    },
  )
  loaded.activate({
    extensionPath: directory,
    globalStorageUri: { fsPath: directory },
    subscriptions: [],
    workspaceState: {
      get: (key: string) => state.get(key),
      // A copy of this realm, so the saved setup compares by value.
      update: async (key: string, value: unknown) => {
        // A storage failure of the editor when the saved setup is cleared.
        if (
          options.failSetupClear &&
          key === 'codebook.aiChatSetup' &&
          value === undefined
        )
          throw new Error('Injected workspace state write failure')
        state.set(key, structuredClone(value))
      },
    },
  })
  return {
    loaded,
    commands,
    state,
    steps,
    notices,
    modalQuestions,
    outputLines,
    executedCommands,
    writtenEntries,
    refreshedEntries,
    entryRemovals,
    directory,
    configPath,
    refreshReached,
    releaseRefresh,
  }
}

// Value: protects=Set Up AI Chat in Devin Desktop leaves Devin Local able to reach this window's Codebook: the skill in Devin's folder, a running server, then one MCP entry naming this installation's bridge and the descriptor folder, with the setup saved and a reload offered; fails_when=Devin Desktop runs the VS Code path (no skill, no entry, Cycle 0142 O8), the entry is written before the server exists, it carries the token, or no reload is offered so Devin Local never loads the entry; why_new=Devin Desktop setup (Cycle 0143); seam=module stand-ins of the skill, config, Node and server
test('Set Up AI Chat in Devin Desktop installs the skill, starts the server, writes the MCP entry and offers a reload', async (context) => {
  // Arrange
  const window = await devinWindow(context, { noticeChoice: 'Reload Window' })
  try {
    // Act
    await window.commands.get('codebook.setupAiChat')!()
    await waitUntil(
      () => window.executedCommands.length > 0,
      'the reload the notice offered',
    )
    // Assert
    assert.deepEqual(window.steps, [
      'resolve Node',
      'deploy Devin skill',
      'start server',
      'write MCP entry',
      'verify Devin skill',
    ])
    assert.deepEqual(window.writtenEntries, [
      {
        command: '/external/node',
        args: [
          join(window.directory, 'dist/devinMcpBridge.js'),
          join(window.directory, 'agent'),
        ],
        env: {},
      },
    ])
    assert.doesNotMatch(JSON.stringify(window.writtenEntries), /test-token/)
    assert.deepEqual(window.state.get('codebook.aiChatSetup'), {
      workspace: window.directory,
    })
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          "Codebook skill and MCP server saved for Devin Local. Reload this window so Devin Local loads Codebook's MCP server, then type /devin:codebook in a Local session.",
        actions: ['Reload Window'],
      },
    ])
    assert.deepEqual(window.executedCommands, ['workbench.action.reloadWindow'])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Windows Devin Desktop learner gets one plain refusal and no file is written; fails_when=setup writes a skill into an unverified Windows folder or an MCP entry Devin may never read (Cycle 0143 decision D6); why_new=Devin Desktop setup (Cycle 0143); seam=process.platform of the loaded module
test('Set Up AI Chat in a Windows Devin Desktop window refuses before it writes anything', async (context) => {
  // Arrange
  const window = await devinWindow(context, { platform: 'win32' })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup, {
      message: 'Devin Desktop setup on Windows is not supported yet.',
    })
    assert.deepEqual(window.steps, [])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=after an extension update a Devin Desktop window brings Codebook's entry to the new bridge before the server starts and asks for the reload Devin Local needs; fails_when=the entry keeps naming the removed version's bridge, so Devin Local fails to start Codebook's MCP server after the update; why_new=Devin Desktop activation refresh (Cycle 0143); seam=module stand-ins of the skill, config, Node and server
test('a Devin Desktop window that opens on a set-up workspace refreshes a moved MCP entry, starts the server and offers a reload', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    entryRefresh: 'refreshed',
  })
  try {
    // Act
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    // Assert
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'refresh MCP entry',
      'start server',
    ])
    assert.deepEqual(window.refreshedEntries, [
      {
        command: '/external/node',
        args: [
          join(window.directory, 'dist/devinMcpBridge.js'),
          join(window.directory, 'agent'),
        ],
        env: {},
      },
    ])
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          'Codebook updated its MCP server entry for Devin Local to this installation. Reload this window so Devin Local starts the updated server.',
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window whose setup was removed (in another window) writes no file and starts nothing, and says so in the Output; fails_when=activation writes the skill or the entry back, or starts a server for a setup the learner removed; why_new=Devin Desktop activation refresh (Cycle 0143); seam=module stand-ins of the skill, config, Node and server
test('a Devin Desktop window whose setup was removed elsewhere reconnects nothing and writes one Output line', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    skillManaged: false,
    entryRefresh: 'not-managed',
  })
  try {
    // Act
    await waitUntil(
      () =>
        window.outputLines.includes(
          "Codebook's Devin Desktop setup was removed, so this window did not reconnect Devin Local. Run Codebook: Set Up AI Chat to set it up again.",
        ),
      'the Output line of the removed setup',
    )
    // Assert
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'refresh MCP entry',
    ])
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=Remove Devin Desktop Setup removes Codebook's skill and entry after the learner confirms, clears this window's setup and offers the reload that stops the bridge; fails_when=the removal leaves the entry, keeps the setup saved so the next window writes everything back, or never asks before touching files shared by every Devin Desktop window; why_new=Devin Desktop removal command (Cycle 0143); seam=module stand-ins of the skill, config, Node and server
test('Remove Devin Desktop Setup removes the skill and the MCP entry, clears the setup and offers a reload', async (context) => {
  // Arrange
  const window = await devinWindow(context, { confirmRemoval: true })
  try {
    await window.commands.get('codebook.setupAiChat')!()
    window.steps.length = 0
    window.notices.length = 0
    // Act
    await window.commands.get('codebook.removeManagedDevinSetup')!()
    // Assert
    assert.deepEqual(window.modalQuestions, [
      "Remove the Codebook-owned Devin Desktop skill and Codebook's entry in Devin's MCP config? Every Devin Desktop window of this user shares them.",
    ])
    assert.deepEqual(window.steps, ['remove Devin skill', 'remove MCP entry'])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message: `Codebook removed its Devin Desktop skill. Codebook removed its codebook entry from ${window.configPath} and kept the file's other entries. Reload this window so Devin Local stops Codebook's MCP server. Codebook: Set Up AI Chat installs the skill and the entry again.`,
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Windows Devin Desktop learner who runs the removal is told setup is not supported there, and nothing at the macOS and Linux paths is touched; fails_when=the removal reaches the skill and config helpers on Windows after the confirmation; why_new=review round (CodeRabbit, the Windows guard covered only setup); seam=process.platform of the loaded module
test('Remove Devin Desktop Setup in a Windows Devin Desktop window refuses before it touches any file', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    platform: 'win32',
    confirmRemoval: true,
  })
  try {
    // Act
    const removal = window.commands.get('codebook.removeManagedDevinSetup')!()
    // Assert
    await assert.rejects(removal, {
      message: 'Devin Desktop setup on Windows is not supported yet.',
    })
    assert.deepEqual(window.steps, [])
    assert.deepEqual(window.modalQuestions, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Windows Devin Desktop window whose workspace has a saved setup (an older Codebook's VS Code path) reconnects nothing and touches no skill or config; fails_when=activation refreshes the macOS and Linux paths or starts a server for Devin Local on Windows; why_new=review round (CodeRabbit, the Windows guard covered only setup); seam=process.platform of the loaded module
test('a Windows Devin Desktop window with a saved setup reconnects nothing and writes the refusal to the Output', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    platform: 'win32',
    savedSetup: true,
  })
  try {
    // Act
    await waitUntil(
      () =>
        window.outputLines.includes(
          'Devin Desktop setup on Windows is not supported yet.',
        ),
      'the Output line of the Windows refusal',
    )
    // Assert
    assert.deepEqual(window.steps, [])
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a removal confirmed while the reconnect refreshed the entry stops that reconnect: no server starts for a setup the learner removed; fails_when=activation goes on to start() after its earlier skill check, so a removed setup's server runs until the window closes; why_new=review round (CodeRabbit, an activation check before the removal's state change); seam=a held entry refresh
test('a reconnect whose refresh is passed by a confirmed removal starts no server', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    confirmRemoval: true,
    holdRefresh: true,
  })
  try {
    await window.refreshReached
    // Act
    await window.commands.get('codebook.removeManagedDevinSetup')!()
    window.releaseRefresh()
    // Assert
    // Without the check a server start follows within milliseconds; one second without it shows the reconnect stopped.
    await assert.rejects(
      waitUntil(
        () => window.steps.includes('start server'),
        'a server start after the removal',
        1_000,
      ),
      { message: 'Timed out waiting for a server start after the removal' },
    )
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'refresh MCP entry',
      'remove Devin skill',
      'remove MCP entry',
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed write of the saved setup never stops the removal before Codebook's entry is taken out of the shared config, and the learner still gets the notice; fails_when=the state write rejects first and the entry stays in Devin's config with no notice; why_new=review round (CodeRabbit, the state write came before the entry cleanup); seam=a workspace state stand-in that rejects the clear
test('Remove Devin Desktop Setup removes the MCP entry and shows its notice even when clearing the saved setup fails', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    confirmRemoval: true,
    failSetupClear: true,
  })
  try {
    await window.commands.get('codebook.setupAiChat')!()
    window.steps.length = 0
    window.notices.length = 0
    // Act
    await window.commands.get('codebook.removeManagedDevinSetup')!()
    // Assert
    assert.deepEqual(window.steps, ['remove Devin skill', 'remove MCP entry'])
    assert.equal(
      window.outputLines.includes(
        "Codebook could not clear this window's saved Devin Desktop setup: Injected workspace state write failure",
      ),
      true,
    )
    assert.equal(window.notices.length, 1)
    assert.equal(window.notices[0]!.severity, 'information')
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a setup that loses its skill to another window's removal takes back only the entry it wrote, so no MCP entry is left that no window will serve; fails_when=the entry stays after the final check fails (Devin launches a bridge with no saved setup behind it), or the rollback removes without naming this setup's generation and so could take a newer setup's entry; why_new=review round (CodeRabbit major, an entry left after another window removes the setup); seam=module stand-ins of the skill, config, Node and server
test('a Devin setup whose skill another window removed takes back the entry it wrote and saves no setup', async (context) => {
  // Arrange
  const window = await devinWindow(context, { skillManaged: false })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup, {
      message:
        'Devin Desktop skill is missing or was changed: /home/user/.config/devin/skills/codebook/SKILL.md. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
    })
    assert.deepEqual(window.steps, [
      'resolve Node',
      'deploy Devin skill',
      'start server',
      'write MCP entry',
      'verify Devin skill',
      'remove MCP entry',
    ])
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-this-setup' },
    ])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed setup that found Codebook's entry already in place leaves that shared entry for the windows that use it; fails_when=the rollback removes an entry this setup did not write, cutting other Devin Desktop windows off from Codebook; why_new=review round (CodeRabbit major, roll back only this setup's write); seam=module stand-ins of the skill, config, Node and server
test('a failed Devin setup that found the entry already in place leaves it', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    skillManaged: false,
    entryWrite: 'current',
  })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup)
    assert.deepEqual(window.steps, [
      'resolve Node',
      'deploy Devin skill',
      'start server',
      'write MCP entry',
      'verify Devin skill',
    ])
    assert.deepEqual(window.entryRemovals, [])
  } finally {
    await window.loaded.deactivate()
  }
})

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import {
  CONNECTION_DESCRIPTOR_SUFFIX,
  DEVIN_SETUP_LOCK_RETRY_DELAY_MS,
  DEVIN_SETUP_LOCK_WAIT_ATTEMPTS,
} from '../constants'
import type * as ExtensionModule from '../extension'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { atomicPrivateWrite } from '../utils/atomicPrivateWrite'
import { hasDevinSetupReceipts } from '../utils/hasDevinSetupReceipts'
import { StorageLockHeldError } from '../utils/storageLockHeldError'
import { withDevinSetupLock } from '../utils/withDevinSetupLock'

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
 * Finds the connection descriptor a Devin Desktop window wrote in its storage.
 * @param directory - The window's global storage folder.
 * @returns The path of the one `<instance>.connection.json` in its agent folder.
 * @example await descriptorPath(window.directory) // => '/tmp/codebook-devin-x/agent/instance-1.connection.json'
 */
async function descriptorPath(directory: string): Promise<string> {
  const names = await readdir(join(directory, 'agent'))
  return join(
    directory,
    'agent',
    names.find((entry) => entry.endsWith(CONNECTION_DESCRIPTOR_SUFFIX))!,
  )
}

/**
 * Holds the setup lock of a Devin Desktop window from a separate Node process, as another Devin Desktop window (another extension host) holds it.
 * The process says so when it holds the lock and releases it only when the test asks, so no run depends on how long a timer takes.
 * @param context - The test, which ends the process afterwards, also when the test failed before it released the lock.
 * @param storageDirectory - The global storage folder the window shares.
 * @returns Resolves once the process holds the lock, with `release`, which lets the process release the lock and resolves when it has ended.
 * @example const holder = await holdSetupLockInOtherProcess(context, directory); await holder.release()
 */
async function holdSetupLockInOtherProcess(
  context: { after: (callback: () => Promise<void>) => void },
  storageDirectory: string,
): Promise<{ release: () => Promise<void> }> {
  const script = `
    const { withStorageLock } = require(process.argv[1])
    withStorageLock(process.argv[2], async () => {
      console.log('held')
      // The lock stays until the parent writes to stdin, or ends it by exiting.
      await new Promise((release) => {
        process.stdin.once('data', release)
        process.stdin.once('end', release)
      })
    }).then(() => process.exit(0))
  `
  const child = spawn(
    process.execPath,
    [
      '-e',
      script,
      resolve(__dirname, '../utils/withStorageLock.js'),
      join(storageDirectory, 'devin-setup'),
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  )
  // `close` also fires after a failed spawn (`error`), where `exit` may never fire.
  const ended = new Promise<void>((resolveEnded) => {
    child.once('close', () => resolveEnded())
  })
  // The process ends with the test, whatever the test's outcome.
  context.after(async () => {
    child.kill()
    await ended
  })
  await new Promise<void>((resolveHeld, rejectHeld) => {
    child.stdout.once('data', () => resolveHeld())
    child.once('error', rejectHeld)
    child.once('exit', () => rejectHeld(new Error('the lock holder ended')))
  })
  return {
    release: async (): Promise<void> => {
      child.stdin.end('release\n')
      await ended
    },
  }
}

/**
 * Loads the real activation boundary as Devin Desktop (`uriScheme` `devin`) with every skill, MCP config, Node and server effect replaced, so a test reads which setup steps ran, in which order, without touching a user profile.
 * @param context - The test, which removes the temporary folder afterwards.
 * @param options - `platform` the window's system (macOS when left out); `savedSetup` a setup saved for this workspace before the window opened; `skillManaged` whether the Devin skill still has its receipt; `entryRefresh` what the MCP entry's refresh answers; `noticeChoice` the button every information notice answers; `confirmRemoval` whether the removal's modal question is confirmed; `holdRefresh` holds the entry's refresh until the test releases it; `failSetupClear` makes clearing the saved setup fail; `entryWrite` what the entry's write answers (`installed` when left out); `remoteName` the editor's `env.remoteName`; `entryReceipt` whether Codebook's entry receipt is left for a saved setup (it is when left out); `nodeFailure` makes resolving Node fail with raw text; `entryRefreshBusy` how many times the entry's refresh meets a held storage lock first; `failSetupSave` makes saving the setup fail; `storageDirectory` an existing folder shared as global storage with another window; `holdDeploy` holds the skill deployment until the test releases it; `cleanupFailure` the sentence the entry's write and refresh answer for a kept copy that could not be deleted; `skillReceipt` whether Codebook's skill record is left for a saved setup (it is when left out); `afterRefresh` runs inside the entry's refresh, before it answers; `holdDescriptorRewrite` makes the descriptor rewrite wait, after it read the file, until the test releases it; `entryDisabled` makes the entry's write answer that the entry stays turned off in Devin's Customize. The window also returns `armReceiptsHold`, which makes the next read of the setup records answer what it read and then wait until `releaseReceipts` (`receiptsReached` says it waits).
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
    entryWrite?: 'installed' | 'updated' | 'current'
    remoteName?: string
    entryReceipt?: boolean
    nodeFailure?: boolean
    entryRefreshBusy?: number
    failSetupSave?: boolean
    storageDirectory?: string
    holdDeploy?: boolean
    cleanupFailure?: string
    skillReceipt?: boolean
    afterRefresh?: () => Promise<void>
    holdDescriptorRewrite?: boolean
    entryDisabled?: boolean
  } = {},
) {
  const directory =
    options.storageDirectory ??
    (await mkdtemp(join(tmpdir(), 'codebook-devin-')))
  if (!options.storageDirectory)
    context.after(() => removeTestFolder(directory))
  const configPath = join(directory, 'home/.config/devin/mcp_config.json')
  const commands = new Map<string, Command>(),
    state = new Map<string, unknown>()
  const steps: string[] = [],
    notices: Notice[] = [],
    modalQuestions: string[] = [],
    outputLines: string[] = [],
    executedCommands: string[] = [],
    contextKeys = new Map<string, unknown>(),
    writtenEntries: DevinEntry[] = [],
    refreshedEntries: DevinEntry[] = [],
    entryRemovals: unknown[] = []
  let instance = 0,
    busyRefreshes = options.entryRefreshBusy ?? 0
  // The skill deployment waits here when a test holds it; `deployEntered` tells the test it is waiting.
  let releaseDeploy!: () => void, deployEntered!: () => void
  const deployHeld = new Promise<void>((resolve) => {
    releaseDeploy = resolve
  })
  const deployReached = new Promise<void>((resolve) => {
    deployEntered = resolve
  })
  // The refresh waits here when a test holds it; `refreshEntered` tells the test it is waiting.
  let releaseRefresh!: () => void, refreshEntered!: () => void
  const refreshHeld = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })
  const refreshReached = new Promise<void>((resolve) => {
    refreshEntered = resolve
  })
  // The descriptor rewrite waits here when a test holds it; `rewriteEntered` tells the test it read the file.
  let releaseRewrite!: () => void, rewriteEntered!: () => void
  const rewriteHeld = new Promise<void>((resolve) => {
    releaseRewrite = resolve
  })
  const rewriteReached = new Promise<void>((resolve) => {
    rewriteEntered = resolve
  })
  // The next read of the setup records waits here once a test armed it; `receiptsEntered` tells the test it is waiting.
  let isReceiptsHoldArmed = false,
    releaseReceipts!: () => void,
    receiptsEntered!: () => void
  const receiptsHeld = new Promise<void>((resolve) => {
    releaseReceipts = resolve
  })
  const receiptsReached = new Promise<void>((resolve) => {
    receiptsEntered = resolve
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
      remoteName: options.remoteName,
    },
    commands: {
      registerCommand(name: string, action: Command) {
        commands.set(name, action)
        return { dispose(): void {} }
      },
      executeCommand(name: string, ...values: unknown[]) {
        // A context key is the editor's own bookkeeping, not a command the learner or a notice ran.
        if (name === 'setContext') contextKeys.set(String(values[0]), values[1])
        else executedCommands.push(name)
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
          // The real deployment leaves its record in the storage.
          await mkdir(join(directory, 'devin-skill'), { recursive: true })
          await writeFile(
            join(directory, 'devin-skill/receipt.json'),
            '{"installed":true}',
          )
          if (options.holdDeploy) {
            deployEntered()
            await deployHeld
          }
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
          // The real write leaves its record in the storage.
          await mkdir(join(directory, 'devin-mcp'), { recursive: true })
          await writeFile(join(directory, 'devin-mcp/receipt.json'), '{}')
          // The entry comes from the loaded module's own realm; a copy of this realm compares by value.
          writtenEntries.push(structuredClone(entry))
          return {
            status: options.entryWrite ?? 'installed',
            path: configPath,
            generation: 'generation-of-this-setup',
            ...(options.cleanupFailure && {
              cleanupFailure: options.cleanupFailure,
            }),
            ...(options.entryDisabled && { disabled: true }),
          }
        },
        refreshManagedDevinMcpEntry: async (
          _storageRoot: string,
          entry: DevinEntry,
        ) => {
          steps.push('refresh MCP entry')
          if (busyRefreshes > 0) {
            busyRefreshes -= 1
            throw new StorageLockHeldError('Learning storage is locked')
          }
          refreshedEntries.push(structuredClone(entry))
          if (options.holdRefresh) {
            refreshEntered()
            await refreshHeld
          }
          await options.afterRefresh?.()
          return {
            status: options.entryRefresh ?? 'current',
            path: configPath,
            ...(options.cleanupFailure && {
              cleanupFailure: options.cleanupFailure,
            }),
            ...(options.entryDisabled && { disabled: true }),
          }
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
      // A rewrite that has read the descriptor waits before it writes, as a stop that comes in between would find it.
      ...(options.holdDescriptorRewrite && {
        './utils/setDescriptorDevinChat': {
          setDescriptorDevinChat: async (
            path: string,
            enabled: boolean,
          ): Promise<void> => {
            const fields = JSON.parse(await readFile(path, 'utf8'))
            rewriteEntered()
            await rewriteHeld
            await atomicPrivateWrite(
              path,
              enabled ? { ...fields, devinChat: true } : fields,
              65_536,
            )
          },
        },
      }),
      // Reads the real records; an armed hold makes the next read wait after it read, as a removal that lands in between would find it.
      './utils/hasDevinSetupReceipts': {
        hasDevinSetupReceipts: async (storageRoot: string) => {
          const stands = await hasDevinSetupReceipts(storageRoot)
          if (isReceiptsHoldArmed) {
            isReceiptsHoldArmed = false
            receiptsEntered()
            await receiptsHeld
          }
          return stands
        },
      },
      './utils/resolveExternalNodeExecutable': {
        resolveExternalNodeExecutable: async () => {
          steps.push('resolve Node')
          if (options.nodeFailure)
            throw new Error(
              'Raw failure of /private/path/node: stderr: TOKEN-LIKE-TEXT',
            )
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
  // Codebook's record of the entry is left for a window that opens on a set-up workspace.
  if (options.savedSetup && options.entryReceipt !== false) {
    await mkdir(join(directory, 'devin-mcp'), { recursive: true })
    await writeFile(join(directory, 'devin-mcp/receipt.json'), '{}')
  }
  if (options.savedSetup && options.skillReceipt !== false) {
    await mkdir(join(directory, 'devin-skill'), { recursive: true })
    await writeFile(
      join(directory, 'devin-skill/receipt.json'),
      '{"installed":true}',
    )
  }
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
        if (
          options.failSetupSave &&
          key === 'codebook.aiChatSetup' &&
          value !== undefined
        )
          throw new Error('Injected workspace state save failure')
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
    contextKeys,
    refreshReached,
    releaseRefresh,
    deployReached,
    releaseDeploy,
    rewriteReached,
    releaseRewrite,
    receiptsReached,
    releaseReceipts,
    /** Makes the next read of the setup records wait after it read them, until {@link releaseReceipts}. */
    armReceiptsHold: (): void => {
      isReceiptsHoldArmed = true
    },
    /** Whether this window's connection descriptor is written completely: it exists and parses. */
    descriptorReadable: async (): Promise<boolean> => {
      try {
        JSON.parse(await readFile(await descriptorPath(directory), 'utf8'))
        return true
      } catch {
        // Not written yet, or half written: the poll asks again.
        return false
      }
    },
    /** The `devinChat` field of this window's connection descriptor, or `undefined` when it is absent. */
    readDescriptorField: async (): Promise<unknown> => {
      const descriptor = JSON.parse(
        await readFile(await descriptorPath(directory), 'utf8'),
      )
      return descriptor.devinChat
    },
    /** The path of this window's connection descriptor. */
    descriptorPath: () => descriptorPath(directory),
    /** The names of the connection descriptors now in the agent folder. */
    descriptorNames: async (): Promise<string[]> =>
      (await readdir(join(directory, 'agent'))).filter((entry) =>
        entry.endsWith(CONNECTION_DESCRIPTOR_SUFFIX),
      ),
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

// protects: a learner who turned Codebook's Devin entry off in Customize is told to turn it on before the reload / fails_when: the activation notice promises that a reload starts the updated server while the entry stays off / no_claim: the entry's own refresh (devinMcpConfig tests)
test('a Devin Desktop window whose refreshed MCP entry is turned off in Customize asks to turn it on before the reload', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    entryRefresh: 'refreshed',
    entryDisabled: true,
  })
  try {
    // Act
    await waitUntil(
      () => window.notices.length > 0,
      'the refreshed entry notice',
    )
    // Assert
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          "Codebook updated its MCP server entry for Devin Local to this installation, but the codebook server is turned off in Devin's Customize. Turn it on there, then reload this window so Devin Local starts the updated server.",
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window whose setup was removed (in another window) writes no file and starts nothing, and says so in the Output; fails_when=activation writes the skill or the entry back, or starts a server for a setup the learner removed; why_new=Devin Desktop activation refresh (Cycle 0143); seam=module stand-ins of the skill, config, Node and server
test('a Devin Desktop window whose setup was removed elsewhere reconnects nothing, reads neither Node nor the config, and writes one Output line', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    skillManaged: false,
    entryReceipt: false,
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
    assert.deepEqual(window.steps, ['verify Devin skill'])
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

// Value: protects=a Devin Desktop window in WSL, SSH or a container gets one plain refusal from setup and writes nothing; fails_when=setup writes Devin's skill and config on the remote machine, where nothing was checked; why_new=review finding C3 (remote windows); seam=env.remoteName of the editor stand-in
test('Set Up AI Chat in a remote Devin Desktop window refuses before it writes anything', async (context) => {
  // Arrange
  const window = await devinWindow(context, { remoteName: 'wsl' })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup, {
      message: 'Devin Desktop setup in a remote window is not supported yet.',
    })
    assert.deepEqual(window.steps, [])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=the removal in a remote Devin Desktop window asks nothing and touches no file; fails_when=the removal confirms and reaches the skill and config helpers of a remote machine; why_new=review finding C3 (remote windows); seam=env.remoteName of the editor stand-in
test('Remove Devin Desktop Setup in a remote Devin Desktop window refuses before it asks or touches any file', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    remoteName: 'ssh-remote',
    confirmRemoval: true,
  })
  try {
    // Act
    const removal = window.commands.get('codebook.removeManagedDevinSetup')!()
    // Assert
    await assert.rejects(removal, {
      message: 'Devin Desktop setup in a remote window is not supported yet.',
    })
    assert.deepEqual(window.steps, [])
    assert.deepEqual(window.modalQuestions, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a remote Devin Desktop window with a saved setup reconnects nothing and says why in the Output; fails_when=activation refreshes the remote machine's config or starts a server Devin Local cannot use there; why_new=review finding C3 (remote windows); seam=env.remoteName of the editor stand-in
test('a remote Devin Desktop window with a saved setup reconnects nothing and writes the refusal to the Output', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    remoteName: 'dev-container',
    savedSetup: true,
  })
  try {
    // Act
    await waitUntil(
      () =>
        window.outputLines.includes(
          'Devin Desktop setup in a remote window is not supported yet.',
        ),
      'the Output line of the remote refusal',
    )
    // Assert
    assert.deepEqual(window.steps, [])
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed setup that only updated an entry other windows use leaves that entry; fails_when=the rollback removes an updated entry and cuts the other windows off from Codebook; why_new=review finding C2 (roll back only an installed entry); seam=module stand-ins of the skill, config, Node and server
test('a failed Devin setup that only updated the entry leaves it', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    skillManaged: false,
    entryWrite: 'updated',
  })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup)
    assert.deepEqual(window.entryRemovals, [])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a setup whose saved state cannot be written takes back the entry it installed; fails_when=the save sits outside the rollback, so the entry stays with no setup behind it; why_new=review finding C5 (save inside the rollback); seam=a workspace state stand-in that rejects the save
test('a Devin setup whose saved setup cannot be written takes back the entry it installed', async (context) => {
  // Arrange
  const window = await devinWindow(context, { failSetupSave: true })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup, {
      message: 'Injected workspace state save failure',
    })
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-this-setup' },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a rollback whose clearing of the saved setup fails still takes the installed entry back; fails_when=the failed clear ends the rollback and leaves the entry; why_new=review finding C5 (clear failure during a rollback); seam=a workspace state stand-in that rejects the clear
test('a Devin setup rollback removes the installed entry even when clearing the saved setup fails', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    skillManaged: false,
    failSetupClear: true,
  })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup, { message: /Devin Desktop skill is missing/ })
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-this-setup' },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Node the configuration names that cannot be used never puts its raw failure text in the Output, and the window still reconnects; fails_when=the Output line carries the resolver's path or process text; why_new=review finding C4 (fixed line for a Node failure); seam=a Node resolver stand-in that throws raw text
test('a Devin Desktop refresh whose Node cannot be used writes one fixed Output line and still reconnects', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    nodeFailure: true,
  })
  try {
    // Act
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    // Assert
    assert.deepEqual(window.outputLines, [
      'Codebook could not use the Node.js named by codebook.nodeExecutable, so it did not refresh its Devin Desktop MCP entry.',
    ])
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'start server',
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a skill check that fails while the entry's receipt is left is told as its own Output line, not as a removed setup, and the window reconnects; fails_when=any skill failure is read as a removal; why_new=review finding C10 (removed only when both receipts are gone); seam=module stand-ins of the skill, config, Node and server
test('a Devin Desktop window whose skill check fails but whose entry receipt is left writes the skill line and reconnects', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    skillManaged: false,
  })
  try {
    // Act
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    // Assert
    assert.deepEqual(window.outputLines, [
      'Codebook did not refresh its Devin Desktop skill: Devin Desktop skill is missing or was changed: /home/user/.config/devin/skills/codebook/SKILL.md. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=windows opened together wait for each other's lock on the entry instead of giving up with an Output line; fails_when=the first held-lock refusal ends the refresh and the entry stays on the old bridge; why_new=review finding C9 (retry a held lock); seam=an entry refresh stand-in that meets a held lock twice
test('a Devin Desktop refresh retries a held storage lock and then refreshes the entry', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    entryRefresh: 'refreshed',
    entryRefreshBusy: 2,
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
      'refresh MCP entry',
      'refresh MCP entry',
      'start server',
    ])
    assert.deepEqual(window.outputLines, [])
    assert.equal(window.notices.length, 1)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a removal from a second Devin Desktop window of the same extension host queues behind a setup that is deploying the skill, so it never lands between that setup's skill deployment and entry write; fails_when=the removal runs while the other window's setup is mid-way and leaves an entry with no skill; why_new=review finding C1 (one lock for setup and removal), renamed in Cycle 0143 /ship pass 2 because both windows run in one process here and the cross-process wait has its own tests below; seam=two windows on one storage folder, a held skill deployment
test('a removal from a second Devin Desktop window in the same extension host queues behind a running setup', async (context) => {
  // Arrange
  const first = await devinWindow(context, { holdDeploy: true })
  const second = await devinWindow(context, {
    storageDirectory: first.directory,
    confirmRemoval: true,
  })
  try {
    const setup = first.commands.get('codebook.setupAiChat')!()
    await first.deployReached
    // Act
    const removal = second.commands.get('codebook.removeManagedDevinSetup')!()
    // Assert
    // Without the lock the removal's first step follows within milliseconds; half a second without it shows it waits.
    await assert.rejects(
      waitUntil(
        () => second.steps.includes('remove Devin skill'),
        'the removal to run during the setup',
        500,
      ),
      { message: 'Timed out waiting for the removal to run during the setup' },
    )
    first.releaseDeploy()
    await setup
    await removal
    assert.deepEqual(second.steps, ['remove Devin skill', 'remove MCP entry'])
    assert.deepEqual(first.steps.slice(-1), ['verify Devin skill'])
  } finally {
    first.releaseDeploy()
    await first.loaded.deactivate()
    await second.loaded.deactivate()
  }
})

// Value: protects=the Devin bridge can tell a window where Set Up AI Chat ran: the descriptor carries devinChat after setup and loses it after the removal, and a window without setup has none; fails_when=the descriptor never carries the mark (the bridge refuses every window) or keeps it after the removal; why_new=review finding C8 (descriptor mark); seam=the real descriptor file in the temporary storage
test('Devin Desktop marks the connection descriptor after setup and unmarks it after the removal', async (context) => {
  // Arrange
  const window = await devinWindow(context, { confirmRemoval: true })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    const beforeSetup = await window.readDescriptorField()
    // Act
    await window.commands.get('codebook.setupAiChat')!()
    const afterSetup = await window.readDescriptorField()
    await window.commands.get('codebook.removeManagedDevinSetup')!()
    const afterRemoval = await window.readDescriptorField()
    // Assert
    assert.deepEqual(
      [beforeSetup, afterSetup, afterRemoval],
      [undefined, true, undefined],
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a window that opens on a set-up workspace writes its descriptor already marked; fails_when=the descriptor written at the server start lacks devinChat, so Devin Local's bridge refuses the window after every reload; why_new=review finding C8 (descriptor decided before the start); seam=the real descriptor file in the temporary storage
test('a Devin Desktop window that opens on a set-up workspace writes a marked connection descriptor', async (context) => {
  // Arrange
  const window = await devinWindow(context, { savedSetup: true })
  try {
    // Act
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
    )
    // Assert
    assert.equal(await window.readDescriptorField(), true)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=after Stop and Start Agent Server a set-up Devin Desktop window offers the reload Devin Local needs to reach the new server, and not at the first start; fails_when=no reload is offered and the bridge stays on the stopped server, or the first start already asks for one; why_new=review finding C7 (reload after a restart); seam=module stand-ins of the skill, config, Node and server
test('a set-up Devin Desktop window offers Reload Window after its agent server was stopped and started again', async (context) => {
  // Arrange
  const window = await devinWindow(context, { savedSetup: true })
  try {
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    const noticesAtActivation = window.notices.length
    // Act
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    // Assert
    assert.equal(noticesAtActivation, 0)
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          'Codebook restarted its agent server. Reload this window so Devin Local connects to the new server.',
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=the Devin removal shows in the Command Palette only in Devin Desktop; fails_when=activation never sets codebook.isDevinDesktop or the manifest lists the command for every editor; why_new=review finding C11 (palette entry only in Devin Desktop); seam=the editor's setContext call and package.json
test('Devin Desktop sets the context key that shows Remove Devin Desktop Setup in the Command Palette', async (context) => {
  // Arrange
  const window = await devinWindow(context)
  const manifest: {
    contributes: {
      menus: { commandPalette: Array<{ command: string; when?: string }> }
    }
  } = JSON.parse(
    await readFile(resolve(__dirname, '../../package.json'), 'utf8'),
  )
  try {
    // Act
    await waitUntil(
      () => window.contextKeys.has('codebook.isDevinDesktop'),
      'the context key of Devin Desktop',
    )
    // Assert
    assert.equal(window.contextKeys.get('codebook.isDevinDesktop'), true)
    assert.deepEqual(
      manifest.contributes.menus.commandPalette.filter(
        (entry) => entry.command === 'codebook.removeManagedDevinSetup',
      ),
      [
        {
          command: 'codebook.removeManagedDevinSetup',
          when: 'codebook.isDevinDesktop',
        },
      ],
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Node the configuration names that cannot be used shows one fixed sentence in Set Up AI Chat and logs nothing of its stderr, and no file is written; fails_when=the resolver's raw text (stderr of the executable) reaches the error, a notice or the Output; why_new=review finding (Codex P1, setup path of the Node failure); seam=a Node resolver stand-in that throws secret-like text
test('Set Up AI Chat in Devin Desktop with an unusable Node shows a fixed sentence and never the failure text', async (context) => {
  // Arrange
  const window = await devinWindow(context, { nodeFailure: true })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup, {
      message:
        'Codebook could not use the Node.js named by codebook.nodeExecutable, so it did not set up Devin Desktop. Check that setting, then run Codebook: Set Up AI Chat again.',
    })
    assert.deepEqual(window.steps, ['resolve Node'])
    assert.doesNotMatch(
      JSON.stringify([window.notices, window.outputLines]),
      /TOKEN-LIKE-TEXT/,
    )
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a connection descriptor that does not parse never puts any of its content, which includes the bearer token, into the setup error or the Output; fails_when=the JSON parser's own message (it quotes part of the input) reaches the learner's error or the removal's Output line; why_new=review finding F1 (Cycle 0143 /ship pass 2, descriptor content in an error); seam=a real descriptor file overwritten with token-like text
test('a Devin Desktop setup and removal never show the content of a connection descriptor that does not parse', async (context) => {
  // Arrange
  const window = await devinWindow(context, { confirmRemoval: true })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    await writeFile(await window.descriptorPath(), 'TOKEN-LIKE-TEXT {')
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    await assert.rejects(setup, {
      message:
        "Codebook could not read this window's connection descriptor. Run Codebook: Stop Agent Server and Codebook: Start Agent Server, then try again.",
    })
    await window.commands.get('codebook.removeManagedDevinSetup')!()
    // Assert
    assert.equal(
      window.outputLines.includes(
        "Codebook could not update this window's connection descriptor: Codebook could not read this window's connection descriptor. Run Codebook: Stop Agent Server and Codebook: Start Agent Server, then try again.",
      ),
      true,
    )
    assert.doesNotMatch(
      JSON.stringify([window.notices, window.outputLines]),
      /TOKEN-LIKE-TEXT/,
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a kept copy of the previous Devin config, which holds other servers' settings, is named in the setup notice; fails_when=the write's cleanupFailure sentence is dropped and the copy stays on disk unreported; why_new=review finding F2 (Cycle 0143 /ship pass 2); seam=an entry write stand-in that answers a cleanupFailure
test('Set Up AI Chat in Devin Desktop names a kept copy of the previous config in its notice', async (context) => {
  // Arrange
  const sentence =
    'Codebook could not delete its private copy of your config at /home/user/.config/devin/mcp_config.json.bak; delete that copy by hand.'
  const window = await devinWindow(context, { cleanupFailure: sentence })
  try {
    // Act
    await window.commands.get('codebook.setupAiChat')!()
    // Assert
    assert.deepEqual(
      window.notices.map((notice) => notice.message),
      [
        `Codebook skill and MCP server saved for Devin Local. Reload this window so Devin Local loads Codebook's MCP server, then type /devin:codebook in a Local session. ${sentence}`,
      ],
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=the activation refresh writes the sentence of a kept copy of the previous Devin config to the Output; fails_when=the refresh drops the cleanupFailure of the config module and the copy stays unreported; why_new=review finding F2 (Cycle 0143 /ship pass 2); seam=an entry refresh stand-in that answers a cleanupFailure
test('a Devin Desktop refresh that moved the entry names a kept copy of the previous config in the Output', async (context) => {
  // Arrange
  const sentence =
    'Codebook could not delete its private copy of your config at /home/user/.config/devin/mcp_config.json.bak; delete that copy by hand.'
  const window = await devinWindow(context, {
    savedSetup: true,
    entryRefresh: 'refreshed',
    cleanupFailure: sentence,
  })
  try {
    // Act
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    // Assert
    assert.deepEqual(window.outputLines, [sentence])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop setup started while another Devin Desktop window (another process) changes the setup waits for it and then runs; fails_when=the setup gives up at the first held-lock refusal, or runs before the other window has finished; why_new=review finding F3 (Cycle 0143 /ship pass 2, cross-process wait); seam=a separate Node process that holds the real setup lock
test('a Devin Desktop setup waits for the setup lock another process holds and then runs', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  const window = await devinWindow(context, { storageDirectory })
  try {
    const holder = await holdSetupLockInOtherProcess(context, storageDirectory)
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // gstack-timing-ok: the setup must show it ran nothing while another process holds the lock, which only elapsed time can show; three retry pauses of the wait
    await delay(DEVIN_SETUP_LOCK_RETRY_DELAY_MS * 3)
    const stepsWhileHeld = [...window.steps]
    await holder.release()
    await setup
    // Assert
    assert.deepEqual(stepsWhileHeld, [])
    assert.deepEqual(window.steps, [
      'resolve Node',
      'deploy Devin skill',
      'start server',
      'write MCP entry',
      'verify Devin skill',
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop removal started while another Devin Desktop window (another process) changes the setup waits for it and then runs; fails_when=the removal refuses at the first held-lock refusal; why_new=review finding F3 (Cycle 0143 /ship pass 2, cross-process wait); seam=a separate Node process that holds the real setup lock
test('a Devin Desktop removal waits for the setup lock another process holds and then runs', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  const window = await devinWindow(context, {
    storageDirectory,
    confirmRemoval: true,
  })
  try {
    const holder = await holdSetupLockInOtherProcess(context, storageDirectory)
    // Act
    const removal = window.commands.get('codebook.removeManagedDevinSetup')!()
    // gstack-timing-ok: the removal must show it ran nothing while another process holds the lock, which only elapsed time can show; three retry pauses of the wait
    await delay(DEVIN_SETUP_LOCK_RETRY_DELAY_MS * 3)
    const stepsWhileHeld = [...window.steps]
    await holder.release()
    await removal
    // Assert
    assert.deepEqual(stepsWhileHeld, [])
    assert.deepEqual(window.steps, ['remove Devin skill', 'remove MCP entry'])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a setup lock that another process never frees ends the Devin Desktop setup or removal with one fixed sentence after the wait, with no step run and never the learning-storage message; fails_when=the refusal is the lock's own Learning storage sentence, or the operation runs without the lock; why_new=review finding F3 (Cycle 0143 /ship pass 2, refusal sentence); seam=a separate Node process that holds the real setup lock, a wait of three short attempts
test('a Devin Desktop setup lock that stays held refuses with a try-again sentence and runs nothing', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  const holder = await holdSetupLockInOtherProcess(context, storageDirectory)
  let operationRuns = 0
  // Act
  const refused = withDevinSetupLock(
    join(storageDirectory, 'devin-setup'),
    async () => {
      operationRuns += 1
    },
    { attempts: 3, delayMs: 10 },
  )
  // Assert
  try {
    await assert.rejects(refused, {
      message:
        'Another Codebook window is changing the Devin Desktop setup. Try again in a moment.',
    })
    assert.equal(operationRuns, 0)
  } finally {
    await holder.release()
  }
})

// Value: protects=a held-lock refusal of a lock the operation itself takes (the MCP config's) reaches the learner as it is and the setup steps run once; fails_when=the setup lock's retry reruns a half-done setup, or rewrites that refusal as the other window's sentence; why_new=review finding F3 (Cycle 0143 /ship pass 2, only the taking of the lock is waited for); seam=an operation stand-in that throws the held-lock error
test('a held-lock refusal thrown inside a Devin Desktop setup is not retried and keeps its own sentence', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  let operationRuns = 0
  // Act
  const refused = withDevinSetupLock(
    join(storageDirectory, 'devin-setup'),
    async () => {
      operationRuns += 1
      throw new StorageLockHeldError('Learning storage is locked: config')
    },
    { attempts: 3, delayMs: 10 },
  )
  // Assert
  await assert.rejects(refused, {
    message: 'Learning storage is locked: config',
  })
  assert.equal(operationRuns, 1)
})

// Value: protects=the wait for another window's setup lasts about ten seconds, not the Cursor reconnect's two; fails_when=the attempts or the pause shrink so that a setup running in another window ends the second one with a refusal; why_new=review finding F3 (Cycle 0143 /ship pass 2, bounded wait of about ten seconds); seam=the constants of the wait
test('the Devin Desktop setup lock wait lasts between seven and fourteen seconds', () => {
  // Arrange
  const pauses = DEVIN_SETUP_LOCK_WAIT_ATTEMPTS - 1
  // Act
  // Each pause is the delay plus a random share of up to the same delay.
  const waitRangeMs = [
    pauses * DEVIN_SETUP_LOCK_RETRY_DELAY_MS,
    pauses * DEVIN_SETUP_LOCK_RETRY_DELAY_MS * 2,
  ]
  // Assert
  assert.deepEqual(waitRangeMs, [6_900, 13_800])
})

// Value: protects=a removal finished in another window while this window's refresh ran leaves this window reconnecting nothing: no server start, and the removed line in the Output; fails_when=the refresh answers not-managed for a gone entry receipt and activation goes on to start a server for a removed setup; why_new=review finding F4 (Cycle 0143 /ship pass 2, removal during the refresh); seam=an entry refresh stand-in that removes the entry's record and answers not-managed
test('a Devin Desktop window whose setup another window removed during the refresh reconnects nothing', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  const window = await devinWindow(context, {
    storageDirectory,
    savedSetup: true,
    entryRefresh: 'not-managed',
    afterRefresh: () =>
      rm(join(storageDirectory, 'devin-mcp/receipt.json'), { force: true }),
  })
  try {
    // Act
    await waitUntil(
      () =>
        window.outputLines.includes(
          "Codebook's Devin Desktop setup was removed, so this window did not reconnect Devin Local. Run Codebook: Set Up AI Chat to set it up again.",
        ),
      'the removed line in the Output',
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

// Value: protects=a connection descriptor written after another window removed the skill is not marked for the Devin bridge, also when that removal's MCP-entry removal failed and left the entry's record; fails_when=the skill's record left with installed false still counts, so the bridge connects for a removed skill; why_new=review finding I1 (Cycle 0143 /ship cycle 3, installed receipts only); seam=the real descriptor file, the skill's record rewritten as a skill removal leaves it
test('a Devin Desktop descriptor written after another window removed the skill but kept the entry record is not marked', async (context) => {
  // Arrange
  const window = await devinWindow(context, { savedSetup: true })
  try {
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    // A skill removal leaves its record with installed false.
    await writeFile(
      join(window.directory, 'devin-skill/receipt.json'),
      '{"installed":false}',
    )
    // Act
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    // Assert
    assert.equal(await window.readDescriptorField(), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a connection descriptor is marked for the Devin bridge only while the entry's record is left; fails_when=the descriptor written at a restart carries devinChat although another window removed the entry, so the bridge connects for a removed setup; why_new=review finding F4 (Cycle 0143 /ship pass 2, mark decided at the write), moved to a restart by finding I2 (the reconnect starts nothing without both records); seam=the real descriptor file, the entry's record deleted after the start
test('a Devin Desktop descriptor written after another window removed the entry record is not marked', async (context) => {
  // Arrange
  const window = await devinWindow(context, { savedSetup: true })
  try {
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    await rm(join(window.directory, 'devin-mcp/receipt.json'), { force: true })
    // Act
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    // Assert
    assert.equal(await window.readDescriptorField(), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=the skill's record counts only while it parses and says installed true; fails_when=a missing, unparsable or uninstalled skill record still reads as a standing setup; why_new=review finding I1 (Cycle 0143 /ship cycle 3); seam=the real records in a temporary storage
test('a Devin setup stands only while the skill record says installed and the entry record is left', async (context) => {
  // Arrange
  const storage = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storage))
  await mkdir(join(storage, 'devin-skill'), { recursive: true })
  await mkdir(join(storage, 'devin-mcp'), { recursive: true })
  await writeFile(join(storage, 'devin-mcp/receipt.json'), '{}')
  const skillReceipt = join(storage, 'devin-skill/receipt.json')
  const outcomes: boolean[] = []
  // Act
  await writeFile(skillReceipt, '{"installed":true}')
  outcomes.push(await hasDevinSetupReceipts(storage))
  await writeFile(skillReceipt, '{"installed":false}')
  outcomes.push(await hasDevinSetupReceipts(storage))
  await writeFile(skillReceipt, 'not json')
  outcomes.push(await hasDevinSetupReceipts(storage))
  await rm(skillReceipt)
  outcomes.push(await hasDevinSetupReceipts(storage))
  // Assert
  assert.deepEqual(outcomes, [true, false, false, false])
})

// Value: protects=a reconnect starts no server once a removal finished in another window after the entry refresh answered current; fails_when=only the entry's record is read again, so a skill record taken meanwhile still lets the server start for a removed setup; why_new=review finding I2 (Cycle 0143 /ship cycle 3, both records read before the start); seam=an entry refresh stand-in that removes the skill's record before it answers
test('a Devin Desktop reconnect starts no server when the skill record disappears after the entry refresh', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  const window = await devinWindow(context, {
    storageDirectory,
    savedSetup: true,
    entryRefresh: 'current',
    afterRefresh: () =>
      rm(join(storageDirectory, 'devin-skill/receipt.json'), { force: true }),
  })
  try {
    // Act
    await waitUntil(
      () =>
        window.outputLines.includes(
          "Codebook's Devin Desktop setup was removed, so this window did not reconnect Devin Local. Run Codebook: Set Up AI Chat to set it up again.",
        ),
      'the removed line in the Output',
    )
    // Assert
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'refresh MCP entry',
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Stop Agent Server between the read and the write of a descriptor rewrite never leaves a descriptor for the stopped instance; fails_when=the rewrite's atomic write recreates the descriptor the stop removed, so the bridge finds a file whose server is gone; why_new=review finding F5 (Cycle 0143 /ship pass 2, rewrite and stop in one queue); seam=a descriptor rewrite stand-in that waits after its read
test('a Stop Agent Server that comes while a Devin descriptor rewrite is pending leaves no descriptor', async (context) => {
  // Arrange
  const window = await devinWindow(context, { holdDescriptorRewrite: true })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    const setup = window.commands.get('codebook.setupAiChat')!()
    await window.rewriteReached
    // Act
    const stop = window.commands.get('codebook.stopAgentServer')!()
    // gstack-timing-ok: an unqueued stop needs a real moment to remove the file first; the checked outcome is the missing descriptor
    await delay(100)
    window.releaseRewrite()
    // The setup now ends with a retry sentence, because the server it checked was stopped meanwhile; this test reads only the descriptor.
    await Promise.allSettled([setup, stop])
    // Assert
    assert.deepEqual(await window.descriptorNames(), [])
  } finally {
    window.releaseRewrite()
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed re-run of Set Up AI Chat on a workspace already set up keeps the saved setup, so the shared entry that stays current still reconnects at the next window load; fails_when=the rollback clears the setup the earlier run saved; why_new=review finding F6 (Cycle 0143 /ship pass 2, restore the previous setup); seam=a saved setup, a skill check that fails
test('a failed Devin setup re-run keeps the setup saved before it', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    skillManaged: false,
    entryWrite: 'current',
  })
  try {
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup)
    assert.deepEqual(window.state.get('codebook.aiChatSetup'), {
      workspace: window.directory,
    })
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Remove Devin Desktop Setup that comes while a restarted server is deciding its descriptor mark leaves the descriptor unmarked, so the Devin bridge never connects for a removed setup; fails_when=the mark decision and the descriptor write are outside the queue of the removal's unmark, so a decision made before the removal is written after its unmark found no running server; why_new=review finding M1 (Cycle 0143 /ship cycle 3 final range, first mark serialized with the removal); seam=a stand-in of the setup records that waits after it read them, the real descriptor file
test('a removal that comes while a restarted Devin Desktop server decides its descriptor mark leaves the descriptor unmarked', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    confirmRemoval: true,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
    )
    await window.commands.get('codebook.stopAgentServer')!()
    window.armReceiptsHold()
    const restart = window.commands.get('codebook.startAgentServer')!()
    // The restart has read that the setup stands and waits before it writes the descriptor.
    await window.receiptsReached
    // Act
    const removal = window.commands.get('codebook.removeManagedDevinSetup')!()
    await waitUntil(
      () => window.state.get('codebook.aiChatSetup') === undefined,
      'the removal to clear the saved setup',
    )
    window.releaseReceipts()
    await Promise.all([restart, removal])
    // Assert
    assert.equal(await window.readDescriptorField(), undefined)
  } finally {
    window.releaseReceipts()
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop setup whose agent server was stopped before it finished ends with a retry sentence, takes back the entry it wrote and offers no reload; fails_when=the setup reports success and offers a reload for a server that no longer runs, so the learner reloads into a bridge with nothing to reach; why_new=review finding M2 (Cycle 0143 /ship cycle 3 final range, target checked after the mark); seam=a descriptor rewrite stand-in that waits after its read, a Stop Agent Server that comes meanwhile
test('a Devin Desktop setup whose server was stopped while it finished takes the entry back and offers no reload', async (context) => {
  // Arrange
  const window = await devinWindow(context, { holdDescriptorRewrite: true })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    const setup = window.commands.get('codebook.setupAiChat')!()
    await window.rewriteReached
    // Act
    const stop = window.commands.get('codebook.stopAgentServer')!()
    window.releaseRewrite()
    const [setupOutcome] = await Promise.allSettled([setup, stop])
    // Assert
    assert.equal(setupOutcome.status, 'rejected')
    assert.equal(
      setupOutcome.reason.message,
      'Codebook server stopped or changed workspace while Devin Desktop setup was finishing, so the setup was taken back. Run Codebook: Set Up AI Chat again.',
    )
    assert.deepEqual(window.notices, [])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-this-setup' },
    ])
  } finally {
    window.releaseRewrite()
    await window.loaded.deactivate()
  }
})

// Value: protects=a window whose setup records stand but whose Devin MCP config no longer holds Codebook's entry (the learner deleted mcp_config.json) reconnects nothing and the Output tells the learner to run Set Up AI Chat again; fails_when=the reconnect starts a server for an entry that is gone, so Devin Local has nothing to connect to and no line says why; why_new=review finding M3 (Cycle 0143 /ship cycle 3 final range, not-managed refresh with both receipts left); seam=an entry refresh stand-in that answers not-managed while both records stay
test('a Devin Desktop window whose config lost the codebook entry reconnects nothing and tells the learner to run setup again', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    entryRefresh: 'not-managed',
  })
  try {
    // Act
    await waitUntil(
      () =>
        window.outputLines.includes(
          "Codebook found no codebook entry of its own in Devin Desktop's MCP config, so this window did not reconnect Devin Local. Run Codebook: Set Up AI Chat again.",
        ),
      'the missing entry line in the Output',
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

// Value: protects=an entry the learner edited after setup stays as it is, the Output says so with its own line, and the window still reconnects to the bridge that entry names; fails_when=the edited entry is treated as a missing one and the reconnect stops, or no line names it; why_new=review finding M3 (Cycle 0143 /ship cycle 3 final range, changed apart from not-managed); seam=an entry refresh stand-in that answers changed
test('a Devin Desktop window whose codebook entry was edited keeps it, says so in the Output and still reconnects', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    entryRefresh: 'changed',
  })
  try {
    // Act
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    // Assert
    assert.deepEqual(window.outputLines, [
      `Codebook left the codebook entry in ${window.configPath} as it is: it was edited after setup.`,
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=after Stop and Start Agent Server no reload is offered when the new instance's descriptor carries no devinChat mark, although the saved setup still matches the workspace; fails_when=the offer is decided from the saved workspace state alone, so the learner reloads for a bridge that the unmarked descriptor refuses anyway; why_new=review finding M4 (Cycle 0143 /ship cycle 3 final range, offer follows the mark); seam=the real descriptor file, the entry's record deleted before the restart
test('a Devin Desktop window offers no reload after a restart whose new descriptor is unmarked', async (context) => {
  // Arrange
  const window = await devinWindow(context, { savedSetup: true })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
    )
    await rm(join(window.directory, 'devin-mcp/receipt.json'), { force: true })
    // Act
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    // Assert
    assert.equal(await window.readDescriptorField(), undefined)
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop learner whose codebook entry stays turned off in Devin's Customize is told to turn it on there instead of being promised that the reload loads the server; fails_when=the setup notice still says the reload loads Codebook's MCP server for a disabled entry; why_new=review finding M6 (Cycle 0143 /ship cycle 3 final range, disabled entry); seam=an entry write stand-in that answers disabled
test('Set Up AI Chat in Devin Desktop with a turned-off entry tells the learner to turn it on in Customize', async (context) => {
  // Arrange
  const window = await devinWindow(context, { entryDisabled: true })
  try {
    // Act
    await window.commands.get('codebook.setupAiChat')!()
    // Assert
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          "Codebook skill and MCP server saved for Devin Local, but the codebook server is turned off in Devin's Customize. Turn it on there, reload this window, then type /devin:codebook in a Local session.",
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

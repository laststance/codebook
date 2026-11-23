import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import * as fsPromises from 'node:fs/promises'
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import {
  CONNECTION_DESCRIPTOR_SUFFIX,
  DEVIN_MARK_READ_RETRY_BUDGET_MS,
  DEVIN_SETUP_LOCK_RETRY_DELAY_MS,
  DEVIN_SETUP_LOCK_WAIT_ATTEMPTS,
} from '../constants'
import type * as ExtensionModule from '../extension'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { startServer as startRealServer } from '../server'
import { atomicPrivateWrite } from '../utils/atomicPrivateWrite'
import { checkDevinBridgeReceipts } from '../utils/checkDevinBridgeReceipts'
import { continueAfterLateRead } from '../utils/continueAfterLateRead'
import { hasDevinSetupReceipts } from '../utils/hasDevinSetupReceipts'
import type * as OwedDevinTakeBackModule from '../utils/owedDevinTakeBack'
import {
  clearOwedDevinTakeBack,
  recordOwedDevinTakeBack,
} from '../utils/owedDevinTakeBack'
import { readDevinInstallationId } from '../utils/readDevinInstallationId'
import { readPrivateJsonState } from '../utils/readPrivateJsonState'
import { readStandingDevinInstallationId } from '../utils/readStandingDevinInstallationId'
import { setDescriptorDevinChat } from '../utils/setDescriptorDevinChat'
import { StorageLockHeldError } from '../utils/storageLockHeldError'
import { withDevinSetupLock } from '../utils/withDevinSetupLock'

import { createHarness } from './helpers'
import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'
import { within } from './utils/within'

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

/** What the stand-in MCP receipt says: installed, with the installation id the descriptor mark must carry. */
const MCP_RECEIPT_TEXT = JSON.stringify({
  installed: true,
  installationId: 'installation-test',
})

/**
 * Finds the connection descriptor a Devin Desktop window wrote in its storage.
 * @param directory - The window's global storage folder.
 * @param instanceLabel - The prefix of the window's instance ids, so the descriptor of another window that shares the folder is never picked.
 * @returns The path of the window's one `<instance>.connection.json` in its agent folder.
 * @example await descriptorPath(window.directory, 'instance') // => '/tmp/codebook-devin-x/agent/instance-1.connection.json'
 */
async function descriptorPath(
  directory: string,
  instanceLabel: string,
): Promise<string> {
  const names = await readdir(join(directory, 'agent'))
  return join(
    directory,
    'agent',
    names.find(
      (entry) =>
        entry.startsWith(`${instanceLabel}-`) &&
        entry.endsWith(CONNECTION_DESCRIPTOR_SUFFIX),
    )!,
  )
}

/**
 * Reads the record of an owed Devin Desktop take-back as a window that loads would find it.
 * @param directory - The window's global storage folder.
 * @returns The parsed `devin-setup/take-back.json`, or `undefined` when there is none.
 * @example await owedTakeBackRecord(window.directory) // => { schemaVersion: 1, generation: 'generation-of-this-setup' }
 */
async function owedTakeBackRecord(directory: string): Promise<unknown> {
  return readFile(join(directory, 'devin-setup/take-back.json'), 'utf8').then(
    (text) => JSON.parse(text),
    () => undefined,
  )
}

/**
 * Leaves the record of an owed Devin Desktop take-back in a storage folder, as a window that a reload stopped during a failed setup's take-back leaves it.
 * @param directory - The global storage folder.
 * @param generation - The generation of the failed setup's entry.
 * @example await leaveOwedTakeBack(directory, 'generation-of-a-failed-setup')
 */
async function leaveOwedTakeBack(
  directory: string,
  generation: string,
): Promise<void> {
  await mkdir(join(directory, 'devin-setup'), { recursive: true })
  await writeFile(
    join(directory, 'devin-setup/take-back.json'),
    JSON.stringify({ schemaVersion: 1, generation }),
    { mode: 0o600 },
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
 * @param options - `platform` the window's system (macOS when left out); `savedSetup` a setup saved for this workspace before the window opened; `skillManaged` whether the Devin skill still has its receipt; `entryRefresh` what the MCP entry's refresh answers; `noticeChoice` the button every information notice answers; `confirmRemoval` whether the removal's modal question is confirmed; `holdRefresh` holds the entry's refresh until the test releases it; `failSetupClear` makes clearing the saved setup fail; `entryWrite` what the entry's write answers (`installed` when left out); `remoteName` the editor's `env.remoteName`; `receiptMode` the mode the entry write leaves its receipt with (private when left out); `entryReceipt` whether Codebook's entry receipt is left for a saved setup (it is when left out); `nodeFailure` makes resolving Node fail with raw text; `entryRefreshBusy` how many times the entry's refresh meets a held storage lock first; `failSetupSave` makes saving the setup fail; `storageDirectory` an existing folder shared as global storage with another window; `holdDeploy` holds the skill deployment until the test releases it; `cleanupFailure` the sentence the entry's write and refresh answer for a kept copy that could not be deleted; `skillReceipt` whether Codebook's skill record is left for a saved setup (it is when left out); `afterRefresh` runs inside the entry's refresh, before it answers; `holdDescriptorRewrite` makes the descriptor rewrite wait, after it read the file, until the test releases it; `entryDisabled` makes the entry's write answer that the entry stays turned off in Devin's Customize; `onSkillCheck` runs inside the setup's final skill check, before it answers; `failEntryRemoval` makes removing the entry fail; `realServer` runs the real MCP server (with the window's mark as its gate) instead of the descriptor stand-in; `failDescriptorUnmark` makes the descriptor rewrite that removes the mark fail (the other rewrites run the real one); `afterInstallationRead` runs once right after the first read of the receipt's installation id (test seam); `removalResult` what the entry removal resolves with (a plain removal when left out); `onSetupCommit` runs inside the write of the committed setup, before it lands (test seam); `failSetupCommit` makes a write of a setup value (not a clearing) that follows a provisional one fail; `failSetupRestore` makes every write that follows a provisional one fail (the commit and the restore); `skillReceiptMode` the mode the skill deployment leaves its receipt with (private when left out). The window also returns `armReceiptsHold`, which makes the next read of the setup records answer what it read and then wait until `releaseReceipts` (`hasReceiptsReached` says it waits).
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
    receiptMode?: number
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
    onSkillCheck?: () => Promise<void>
    failEntryRemoval?: boolean
    realServer?: boolean
    failDescriptorUnmark?: boolean
    afterInstallationRead?: () => Promise<void>
    removalResult?: { status: 'removed'; path: string; cleanupFailure?: string }
    failSetupCommit?: boolean
    onSetupCommit?: (window: {
      changeWorkspace: (folder: string) => void
      changeFolder: (folder: string) => void
    }) => Promise<void>
    hangFinalReceiptsCheck?: boolean
    failSetupRestore?: boolean
    skillReceiptMode?: number
    /** How many of the first reads of the setup receipts get no answer (descriptor exhaustion), as `null`. */
    receiptReadsWithoutAnswer?: number
    /** Whether every read of the setup receipts waits, as a read stuck on a failing disk, until `releaseHungReceiptReads` or the window's `deactivate` opens its gate, and then answers with no answer (`null`). */
    receiptReadsHang?: boolean
    failFirstInstallationRead?: boolean
    removalDeletesReceipt?: boolean
    /** How long each of the first reads of the setup receipts waits before it answers with no answer (`null`), by the read's position; a read past the list, or at an `undefined` position, is the real one. */
    receiptReadDelaysMs?: (number | undefined)[]
    /** Runs once, right after the setup lock's release was awaited and before the setup's success notice (test seam for a folder change in that gap). */
    afterSetupLockRelease?: (window: {
      changeFolder: (folder: string) => void
    }) => Promise<void>
    /** Holds every removal of the MCP entry (the removal's and a take-back's) until `holds.entryRemoval` is released, as a storage that stops answering. */
    holdEntryRemoval?: boolean
    /** Holds every removal of the skill until `holds.skillRemoval` is released. */
    holdSkillRemoval?: boolean
    /** Makes every removal of the skill fail (after its hold, when one is set), as a storage that answers late with a refusal. */
    failSkillRemoval?: boolean
    /** Holds the first write of the saved setup that is not a provisional one (a take-back's restore, a removal's clear) until `holds.savedSetupWrite` is released; the writes after it are not held. */
    holdSavedSetupWrite?: boolean
    /** Makes the write held by `holdSavedSetupWrite` fail once it is released, as a storage that answers late with a failure. */
    failHeldSavedSetupWrite?: boolean
    /** Holds every descriptor rewrite that removes the mark (a take-back's sync, a removal's unmark) until `holds.descriptorUnmark` is released, then runs the real rewrite. */
    holdDescriptorUnmark?: boolean
    /** Holds every descriptor rewrite that sets the mark (a setup's mark, a sync that keeps a mark) until `holds.descriptorMark` is released, then runs the real rewrite. */
    holdDescriptorMark?: boolean
    /** The prefix of the window's instance ids (`instance` when left out), so two windows that share one storage folder write descriptors of different names. */
    instanceLabel?: string
    /** Runs when the setup resolves Node, its first step under the setup lock. */
    onResolveNode?: () => void
    /** Holds the first read of the MCP receipt's installation id until `holds.firstInstallationRead` is released, then reads the real receipt. */
    hangFirstInstallationRead?: boolean
    /** The position (1 for the first) of the one read of the setup receipts that reads the real records and then waits at `holds.receiptRead` until the test releases it, answering what it read before it waited, as a slow storage whose answer comes after the start budget. */
    holdReceiptReadAt?: number
    /** Holds every write of the MCP entry until `holds.entryWrite` is released, then writes it as the stand-in does. */
    holdEntryWrite?: boolean
    /** Holds every provisional write of the saved setup until `holds.provisionalSave` is released, then saves it. */
    holdProvisionalSave?: boolean
    /** Holds every check of the managed Devin skill until `holds.skillCheck` is released, then answers as the stand-in does. */
    holdSkillCheck?: boolean
    /** Holds every publish of a connection descriptor (the server start's own write of the file) until `holds.descriptorPublish` is released, then runs the real write. */
    holdDescriptorPublish?: boolean
    /** Makes every descriptor rewrite that sets the mark fail (the other rewrites run the real one), as a descriptor that cannot be replaced. */
    failDescriptorMark?: boolean
    /** Makes the first dispose of the Study reader throw, as a reader whose panes could not be closed. */
    failStudyReaderDispose?: boolean
    /** Holds every late mark's continuation, once its late read settled and before it reads afresh, until `holds.lateMark` is released. */
    holdLateMark?: boolean
    /** Makes a server that starts serve the folder the window serves at that moment (`changeFolder` changes it), in its environment and its descriptor, as the real environment does; when left out, every server serves the window's first folder. */
    serverFollowsFolder?: boolean
    /** How many of the first looks for an owed take-back get no answer from their read of the record (descriptor exhaustion, `EIO`), whatever the record holds; `failNextOwedTakeBackLooks` arms more later. */
    owedTakeBackLooksWithoutAnswer?: number
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
  const instanceLabel = options.instanceLabel ?? 'instance'
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
  // The next read of the setup records waits here once a test armed it; `isReceiptsReached` tells the test it is waiting.
  let isReceiptsHoldArmed = false,
    releaseReceipts!: () => void,
    isReceiptsReached = false
  const receiptsHeld = new Promise<void>((resolve) => {
    releaseReceipts = resolve
  })
  // Every gate's release, opened by the window's `deactivate` before the real one runs, so a test that failed while a stand-in still waits ends instead of hanging the runner.
  const gateReleases: Array<() => void> = []
  /**
   * Makes one gate a stand-in waits at until the test, or the window's `deactivate`, opens it.
   * @returns `wait`, which a stand-in awaits and which records the moment it was first reached; `release`, which opens the gate; `reachedAtMs`, which reads that moment (`performance.now()`), or `undefined` while no stand-in reached the gate.
   * @example const gate = createGate(); await gate.wait() // resolves once gate.release() ran
   */
  const createGate = () => {
    let release!: () => void
    const opened = new Promise<void>((resolve) => {
      release = resolve
    })
    gateReleases.push(release)
    let firstReachedAtMs: number | undefined
    return {
      wait: (): Promise<void> => {
        firstReachedAtMs ??= performance.now()
        return opened
      },
      release: (): void => release(),
      reachedAtMs: (): number | undefined => firstReachedAtMs,
    }
  }
  // Every read of the setup receipts waits here while `receiptReadsHang` is set, as a read stuck on a failing disk, and then answers with no answer.
  const hungReceiptReads = createGate()
  // The storage steps a test holds, as a storage that stops answering: each waits here while its option is set.
  const holds = {
    entryRemoval: createGate(),
    skillRemoval: createGate(),
    savedSetupWrite: createGate(),
    descriptorUnmark: createGate(),
    descriptorMark: createGate(),
    firstInstallationRead: createGate(),
    receiptRead: createGate(),
    entryWrite: createGate(),
    provisionalSave: createGate(),
    skillCheck: createGate(),
    descriptorPublish: createGate(),
    lateMark: createGate(),
  }
  // Whether the one held write of the saved setup was reached; the writes after it are not held.
  let isSavedSetupWriteHeld = false
  // The folder the window serves now; a test seam changes it as a folder switch would.
  let currentWorkspace = directory
  // The listeners the window registered for a change of the workspace's folders; {@link changeFolder} fires them as the editor does.
  const folderListeners: Array<() => void> = []
  /** Switches the folder the window serves and fires the window's registered folder-change listeners, as the editor does. */
  const changeFolder = (folder: string): void => {
    currentWorkspace = folder
    for (const listener of folderListeners) listener()
  }
  // How many reads of the setup receipts the window started; a test reads it to see that a hung read is not asked again.
  let receiptReadCount = 0
  // What each late mark's continuation answered once it settled (whether it marked, or its failure's message), in order; a test waits for it instead of for the start of the fresh read.
  const lateMarkDecisions: unknown[] = []
  // How many looks for an owed take-back have answered; the window's load makes the first.
  let owedTakeBackReads = 0
  // Whether a provisional setup value was written; the failing writes of {@link devinWindow}'s options start after it.
  let hasWrittenProvisional = false
  // A setup saved by an earlier window names the workspace this window opens.
  if (options.savedSetup)
    state.set('codebook.aiChatSetup', { workspace: directory })
  // How often the window told the editor that its MCP definitions changed, and the provider it registered.
  let changeEventCount = 0
  let mcpProvider:
    | {
        provideMcpServerDefinitions: () => { version?: string }[]
      }
    | undefined
  class Emitter {
    event = (): void => {}
    fire(): void {
      changeEventCount += 1
    }
    dispose(): void {}
  }
  class HttpDefinition {
    constructor(
      public label: string,
      public uri: string,
      public headers: unknown,
      public version?: string,
    ) {}
  }
  class Service {
    instanceId = `${instanceLabel}-${++instance}`
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
      onDidChangeWorkspaceFolders: (listener: () => void) => {
        folderListeners.push(listener)
        return { dispose(): void {} }
      },
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
      registerMcpServerDefinitionProvider: (
        _id: string,
        received: NonNullable<typeof mcpProvider>,
      ) => {
        mcpProvider = received
        return { dispose(): void {} }
      },
    },
  }
  // How many of the next looks for an owed take-back get no answer from their read of the record.
  let owedLooksWithoutAnswer = options.owedTakeBackLooksWithoutAnswer ?? 0
  // The real record module, whose own read of the record gets no answer while a test asks for it; every other read is the real one.
  const owedTakeBack = await loadModule<typeof OwedDevinTakeBackModule>(
    resolve(__dirname, '../utils/owedDevinTakeBack.js'),
    {
      './readPrivateJsonState': {
        readPrivateJsonState: async (
          ...parameters: Parameters<typeof readPrivateJsonState>
        ): ReturnType<typeof readPrivateJsonState> => {
          if (owedLooksWithoutAnswer === 0)
            return readPrivateJsonState(...parameters)
          owedLooksWithoutAnswer -= 1
          return { state: 'no-answer' }
        },
      },
    },
  )
  const loaded = await loadModule<typeof ExtensionModule>(
    resolve(__dirname, '../extension.js'),
    {
      vscode,
      './service': { StudyService: Service },
      // The server start's own write of the descriptor waits until the test releases it; every other file call is the real one.
      ...(options.holdDescriptorPublish && {
        'node:fs/promises': {
          ...fsPromises,
          writeFile: async (
            ...parameters: Parameters<typeof writeFile>
          ): Promise<void> => {
            if (String(parameters[0]).endsWith(CONNECTION_DESCRIPTOR_SUFFIX))
              await holds.descriptorPublish.wait()
            return writeFile(...parameters)
          },
        },
      }),
      './environment': {
        requireWorkspace: () => currentWorkspace,
        createEnvironment: async () => ({
          workspace: options.serverFollowsFolder ? currentWorkspace : directory,
          dispose(): void {},
        }),
      },
      './server': {
        startServer: async (
          service: Service,
          now?: () => number,
          isDevinChatEnabled?: () => boolean,
        ) => {
          steps.push('start server')
          if (options.realServer) {
            // The real server runs a real study service; the window's own stand-in service only names the instance.
            const harness = await createHarness()
            context.after(() => harness.close())
            const realEndpoint = await startRealServer(
              harness.service,
              now,
              isDevinChatEnabled,
            )
            // The window's setup names the workspace it opened, not the harness's repository; the same descriptor object stays shared, so a token rotation reaches the window's copy too.
            realEndpoint.descriptor.workspace = directory
            return realEndpoint
          }
          return {
            listening: true,
            resourcesReleased: true,
            descriptor: {
              url: `http://127.0.0.1/${service.instanceId}/mcp`,
              token: 'test-token',
              instanceId: service.instanceId,
              workspace: options.serverFollowsFolder
                ? service.environment.workspace
                : directory,
              apiVersion: '1.6',
            },
            close: async (): Promise<void> => {},
            prepareTokenRotation: () => ({
              token: 'rotated-test-token',
              commit: (): void => {},
            }),
            tokenGeneration: 0,
          }
        },
      },
      './studyWorkspace': {
        StudyWorkspace: class {
          presentation = undefined
          async attach(): Promise<void> {}
          async retire(): Promise<void> {}
          releaseUnsavedStudies(): [] {
            return []
          }
          async dispose(): Promise<void> {
            // Only the first dispose fails, so the window's own deactivate disposes the reader made afterwards.
            if (options.failStudyReaderDispose) {
              options.failStudyReaderDispose = false
              throw new Error('Injected Study reader dispose failure')
            }
          }
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
            { mode: 0o600 },
          )
          // A receipt restored with another mode (a backup, a copy) is not private.
          if (options.skillReceiptMode !== undefined) {
            await chmod(
              join(directory, 'devin-skill/receipt.json'),
              options.skillReceiptMode,
            )
            // Only the first deployment restores the receipt with another mode.
            options.skillReceiptMode = undefined
          }
          if (options.holdDeploy) {
            deployEntered()
            await deployHeld
          }
          return { status: 'installed' }
        },
        verifyManagedDevinSkill: async () => {
          steps.push('verify Devin skill')
          if (options.holdSkillCheck) await holds.skillCheck.wait()
          await options.onSkillCheck?.()
          // A skill whose receipt is gone was removed by another window.
          if (options.skillManaged === false)
            throw new Error(
              'Devin Desktop skill is missing or was changed: /home/user/.config/devin/skills/codebook/SKILL.md. Run Codebook: Set Up AI Chat; Codebook will not overwrite another edit.',
            )
          return { status: 'current' }
        },
        removeManagedDevinSkill: async () => {
          steps.push('remove Devin skill')
          if (options.holdSkillRemoval) await holds.skillRemoval.wait()
          if (options.failSkillRemoval)
            throw new Error('Injected skill removal failure')
          return { status: 'removed' }
        },
      },
      './devinMcpConfig': {
        writeManagedDevinMcpEntry: async (
          _storageRoot: string,
          entry: DevinEntry,
        ) => {
          steps.push('write MCP entry')
          if (options.holdEntryWrite) await holds.entryWrite.wait()
          // The real write leaves its record in the storage.
          await mkdir(join(directory, 'devin-mcp'), { recursive: true })
          await writeFile(
            join(directory, 'devin-mcp/receipt.json'),
            MCP_RECEIPT_TEXT,
            { mode: 0o600 },
          )
          // A receipt restored with another mode (a backup, a copy) is not private.
          if (options.receiptMode !== undefined)
            await chmod(
              join(directory, 'devin-mcp/receipt.json'),
              options.receiptMode,
            )
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
          if (options.holdEntryRemoval) await holds.entryRemoval.wait()
          if (options.failEntryRemoval)
            throw new Error('Injected entry removal failure')
          // The real removal deletes its own record of the entry.
          if (options.removalDeletesReceipt)
            await rm(join(directory, 'devin-mcp/receipt.json'), { force: true })
          return (
            options.removalResult ?? { status: 'removed', path: configPath }
          )
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
      // The rewrite that removes the mark fails, or waits until the test releases it and then runs the real one; a rewrite that sets the mark fails or waits likewise when a test asks for it; every other rewrite is the real one.
      ...((options.failDescriptorUnmark ||
        options.holdDescriptorUnmark ||
        options.holdDescriptorMark ||
        options.failDescriptorMark) && {
        './utils/setDescriptorDevinChat': {
          setDescriptorDevinChat: async (
            path: string,
            enabled: boolean,
            installationId?: string,
            token?: string,
          ): Promise<boolean> => {
            if (!enabled && options.failDescriptorUnmark)
              throw new Error('Injected descriptor unmark failure')
            if (enabled && options.failDescriptorMark)
              throw new Error('Injected descriptor mark failure')
            if (!enabled && options.holdDescriptorUnmark)
              await holds.descriptorUnmark.wait()
            if (enabled && options.holdDescriptorMark)
              await holds.descriptorMark.wait()
            return setDescriptorDevinChat(path, enabled, installationId, token)
          },
        },
      }),
      // Reads the real records; an armed hold makes the next read wait after it read, as a removal that lands in between would find it.
      './utils/readStandingDevinInstallationId': {
        readStandingDevinInstallationId: async (storageRoot: string) => {
          receiptReadCount += 1
          // The held read answers what it read before it waited, so a continuation that trusted it would see the setup standing.
          if (receiptReadCount === options.holdReceiptReadAt) {
            const standsBeforeHold =
              await readStandingDevinInstallationId(storageRoot)
            await holds.receiptRead.wait()
            return standsBeforeHold
          }
          // A read that answers late with no answer, as a slow storage that then fails.
          const delayMs = options.receiptReadDelaysMs?.[receiptReadCount - 1]
          if (delayMs !== undefined) {
            await delay(delayMs)
            return null
          }
          // A read that does not return until the test or the window's deactivate opens the gate, and then has no answer.
          if (options.receiptReadsHang) {
            await hungReceiptReads.wait()
            return null
          }
          // A read that gets no answer, as under descriptor exhaustion.
          if ((options.receiptReadsWithoutAnswer ?? 0) > 0) {
            options.receiptReadsWithoutAnswer =
              (options.receiptReadsWithoutAnswer ?? 0) - 1
            return null
          }
          const stands = await readStandingDevinInstallationId(storageRoot)
          if (isReceiptsHoldArmed) {
            isReceiptsHoldArmed = false
            isReceiptsReached = true
            await receiptsHeld
          }
          return stands
        },
      },
      // The real record of an owed take-back; each look that answered is counted, so a test knows the window's load has looked.
      './utils/owedDevinTakeBack': {
        recordOwedDevinTakeBack,
        clearOwedDevinTakeBack,
        readOwedDevinTakeBack: async (storageRoot: string) => {
          const look = await owedTakeBack.readOwedDevinTakeBack(storageRoot)
          owedTakeBackReads += 1
          return look
        },
      },
      // The real continuation of a late mark, held at `holds.lateMark` before it runs when a test asks for it; each decision it settles with is recorded, before the window's own handler runs.
      './utils/continueAfterLateRead': {
        continueAfterLateRead: (
          ...[lateRead, apply]: Parameters<typeof continueAfterLateRead>
        ) => {
          const decision = continueAfterLateRead(lateRead, async () => {
            if (options.holdLateMark) await holds.lateMark.wait()
            return apply()
          })
          void decision.then(
            (isMarked) => lateMarkDecisions.push(isMarked),
            (error: Error) => lateMarkDecisions.push(error.message),
          )
          return decision
        },
      },
      // Reads the real receipt; `afterInstallationRead` runs once, right after the first read answered, as a receipt that becomes unreadable between the setup's check and its mark write.
      // The setup's final receipts check: a test makes it never settle, as a skill receipt read that hangs.
      './utils/checkDevinBridgeReceipts': {
        checkDevinBridgeReceipts: (
          ...parameters: Parameters<typeof checkDevinBridgeReceipts>
        ) =>
          options.hangFinalReceiptsCheck
            ? new Promise<never>(() => {})
            : checkDevinBridgeReceipts(...parameters),
      },
      './utils/readDevinInstallationId': {
        readDevinInstallationId: async (storageRoot: string) => {
          // A first read that does not return until the test or the window's deactivate releases it, as a read stuck on a failing disk.
          if (options.hangFirstInstallationRead) {
            options.hangFirstInstallationRead = false
            await holds.firstInstallationRead.wait()
          }
          const installationRead = await readDevinInstallationId(storageRoot)
          // A first read that failed to look (for example EMFILE) classifies as no answer, whatever the receipt holds.
          if (options.failFirstInstallationRead) {
            options.failFirstInstallationRead = false
            return {
              installationId: undefined,
              state: {
                state: 'no-answer' as const,
                receiptPath: join(storageRoot, 'devin-mcp', 'receipt.json'),
              },
            }
          }
          const afterRead = options.afterInstallationRead
          if (afterRead) {
            options.afterInstallationRead = undefined
            await afterRead()
          }
          return installationRead
        },
      },
      // The real lock; a test seam runs once right after its release was awaited.
      './utils/withDevinSetupLock': {
        withDevinSetupLock: async (
          ...parameters: Parameters<typeof withDevinSetupLock>
        ) => {
          const result = await withDevinSetupLock(...parameters)
          const afterRelease = options.afterSetupLockRelease
          if (afterRelease) {
            options.afterSetupLockRelease = undefined
            await afterRelease({ changeFolder })
          }
          return result
        },
      },
      './utils/resolveExternalNodeExecutable': {
        resolveExternalNodeExecutable: async () => {
          steps.push('resolve Node')
          options.onResolveNode?.()
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
    await writeFile(
      join(directory, 'devin-mcp/receipt.json'),
      MCP_RECEIPT_TEXT,
      { mode: 0o600 },
    )
  }
  if (options.savedSetup && options.skillReceipt !== false) {
    await mkdir(join(directory, 'devin-skill'), { recursive: true })
    await writeFile(
      join(directory, 'devin-skill/receipt.json'),
      '{"installed":true}',
      { mode: 0o600 },
    )
  }
  const activated = loaded.activate({
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
        // Once a provisional value was written, the writes that follow can be made to fail.
        if (key === 'codebook.aiChatSetup') {
          const isProvisional =
            typeof value === 'object' &&
            value !== null &&
            'provisional' in value
          if (
            hasWrittenProvisional &&
            !isProvisional &&
            (options.failSetupRestore ||
              (options.failSetupCommit && value !== undefined))
          )
            throw new Error('Injected workspace state commit failure')
          hasWrittenProvisional ||= isProvisional
          if (options.holdProvisionalSave && isProvisional)
            await holds.provisionalSave.wait()
          // The first write that is not a provisional one waits, as a storage that stops answering; the writes after it go through.
          if (
            options.holdSavedSetupWrite &&
            !isProvisional &&
            !isSavedSetupWriteHeld
          ) {
            isSavedSetupWriteHeld = true
            await holds.savedSetupWrite.wait()
            if (options.failHeldSavedSetupWrite)
              throw new Error('Injected late workspace state write failure')
          }
        }
        // The committed value is written last: a test seam runs just before it lands.
        if (
          options.onSetupCommit &&
          key === 'codebook.aiChatSetup' &&
          hasWrittenProvisional &&
          typeof value === 'object' &&
          value !== null &&
          !('provisional' in value)
        )
          await options.onSetupCommit({
            changeWorkspace: (folder: string): void => {
              currentWorkspace = folder
            },
            changeFolder,
          })
        state.set(key, structuredClone(value))
      },
    },
  })
  return {
    /** The loaded module; its `deactivate` first opens every gate and hold of this window (a hung read, a held step), then runs the real one, so a test's cleanup ends although a regression left a stand-in waiting. */
    loaded: {
      ...loaded,
      deactivate: async (): Promise<void> => {
        for (const release of gateReleases) release()
        releaseDeploy()
        releaseRefresh()
        releaseRewrite()
        releaseReceipts()
        await loaded.deactivate()
      },
    },
    /** Opens the gate every hung read of the setup receipts waits at (`receiptReadsHang`): the reads waiting there, and every later one, answer with no answer. */
    releaseHungReceiptReads: hungReceiptReads.release,
    /** The held storage steps (`holdEntryRemoval`, `holdSkillRemoval`, `holdSavedSetupWrite`, `holdDescriptorUnmark`, `holdDescriptorMark`, `hangFirstInstallationRead`, `holdReceiptReadAt`, `holdEntryWrite`, `holdProvisionalSave`, `holdSkillCheck`, `holdDescriptorPublish`, `holdLateMark`): each `reachedAtMs()` reads when a step first waited there, and `release()` lets it go on. */
    holds,
    /** Settles when the reconnect at activation ended, with or without a server start. */
    whenReconnected: activated.whenReconnected,
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
    /** Switches the folder the window serves and fires the registered folder-change listeners. */
    changeFolder,
    /** How many reads of the setup receipts the window started. */
    receiptReadCount: (): number => receiptReadCount,
    /** What each late mark's continuation settled with, in order: `true` when it marked the descriptor, `false` when it left it as it was, or its failure's message. */
    lateMarkDecisions,
    /** How many looks for an owed take-back have answered; the window's load makes the first. */
    owedTakeBackReads: (): number => owedTakeBackReads,
    /** Makes the next `count` looks for an owed take-back get no answer from their read of the record, as under descriptor exhaustion. */
    failNextOwedTakeBackLooks: (count: number): void => {
      owedLooksWithoutAnswer = count
    },
    /** Whether a read of the setup records is waiting for {@link releaseReceipts}; a test polls it with a time budget, so a hold that is never reached fails instead of hanging. */
    hasReceiptsReached: (): boolean => isReceiptsReached,
    releaseReceipts,
    /** How often the window told the editor that its MCP definitions changed. */
    changeEvents: (): number => changeEventCount,
    /** The version the window's MCP provider gives its definition now, or `undefined` when it gives none. */
    definitionVersion: (): string | undefined =>
      mcpProvider?.provideMcpServerDefinitions()[0]?.version,
    /** Makes the next read of the setup records wait after it read them, until {@link releaseReceipts}. */
    armReceiptsHold: (): void => {
      isReceiptsHoldArmed = true
    },
    /** Whether this window's connection descriptor is written completely: it exists and parses. */
    descriptorReadable: async (): Promise<boolean> => {
      try {
        JSON.parse(
          await readFile(
            await descriptorPath(directory, instanceLabel),
            'utf8',
          ),
        )
        return true
      } catch {
        // Not written yet, or half written: the poll asks again.
        return false
      }
    },
    /** The `devinChat` field of this window's connection descriptor, or `undefined` when it is absent. */
    readDescriptorField: async (): Promise<unknown> => {
      const descriptor = JSON.parse(
        await readFile(await descriptorPath(directory, instanceLabel), 'utf8'),
      )
      return descriptor.devinChat
    },
    /** The `devinSetupInstallation` field of this window's connection descriptor, or `undefined` when it is absent. */
    readDescriptorInstallation: async (): Promise<unknown> => {
      const descriptor = JSON.parse(
        await readFile(await descriptorPath(directory, instanceLabel), 'utf8'),
      )
      return descriptor.devinSetupInstallation
    },
    /** The path of this window's connection descriptor. */
    descriptorPath: () => descriptorPath(directory, instanceLabel),
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
    // The removal waits for the setup lock the held refresh holds, so it is confirmed first and the refresh then goes on.
    const removal = window.commands.get('codebook.removeManagedDevinSetup')!()
    await waitUntil(
      () => window.modalQuestions.length === 1,
      "the removal's confirmed question",
    )
    window.releaseRefresh()
    await removal
    // Assert
    // The reconnect has ended; a start would show in the steps.
    await window.whenReconnected()
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

// Value: protects=a Stop Agent Server run while the reconnect refreshed the entry is not undone by the automatic start (Cycle 0144 task 12); fails_when=activation goes on to start() after the learner's stop, so a server runs and writes a descriptor after the stop; no_claim=a start the learner asks for later; seam=a held entry refresh
test('a reconnect whose refresh is passed by Stop Agent Server starts no server and writes no descriptor', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    holdRefresh: true,
  })
  try {
    await window.refreshReached
    // Act
    await window.commands.get('codebook.stopAgentServer')!()
    window.releaseRefresh()
    // Assert
    // The reconnect has ended; a start would show in the steps.
    await window.whenReconnected()
    assert.equal(window.steps.includes('start server'), false)
    // No server ever started, so not even the agent folder with the descriptors exists.
    await assert.rejects(window.descriptorNames(), { code: 'ENOENT' })
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

// Value: protects=a Devin Desktop window that opens on a set-up workspace while another window's setup holds the setup lock refreshes the MCP entry only once that setup ended, so the refresh never rewrites the entry between that setup's entry write and its end or take-back; fails_when=the activation refresh rewrites the entry while the other window's setup still runs, so a failed first setup's take-back finds a newer generation, answers superseded and leaves its failed entry installed (Cycle 0146 /ship pass 1, codex-structured extension.ts:1626); why_new=only setups and removals took the setup lock; seam=two windows on one storage folder in one extension host, a held final skill check of the first window's setup; no_claim=a window of another extension host (the lock's cross-process wait has its own tests) and a refresh refused after the lock's wait (it goes to the Output like any refused refresh)
test("a Devin Desktop window's activation refresh waits for another window's setup that holds the setup lock", async (context) => {
  // Arrange
  const first = await devinWindow(context, { holdSkillCheck: true })
  try {
    const setup = first.commands.get('codebook.setupAiChat')!()
    await waitUntil(
      () => first.holds.skillCheck.reachedAtMs(),
      "the first window's final skill check",
    )
    // Act
    const second = await devinWindow(context, {
      storageDirectory: first.directory,
      instanceLabel: 'second',
      savedSetup: true,
    })
    try {
      // Without the lock the refresh follows the skill check and Node within milliseconds; half a second without it shows it waits.
      await assert.rejects(
        waitUntil(
          () => second.steps.includes('refresh MCP entry'),
          "the second window's refresh to run during the first window's setup",
          500,
        ),
        {
          message:
            "Timed out waiting for the second window's refresh to run during the first window's setup",
        },
      )
      first.holds.skillCheck.release()
      await setup
      await second.whenReconnected()
      // Assert
      assert.deepEqual(second.steps, [
        'verify Devin skill',
        'resolve Node',
        'refresh MCP entry',
        'start server',
      ])
    } finally {
      await second.loaded.deactivate()
    }
  } finally {
    first.holds.skillCheck.release()
    await first.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window that loads on a set-up workspace while another window holds the setup lock for about 14 seconds (a long setup, or a take-back on slow storage) gives up on that lock within seconds, says so in the Output and publishes its server's descriptor within 6 seconds of its load, well inside the 15 seconds the Devin bridge waits for it (Cycle 0146 /ship pass 2, red-team 2); fails_when=the activation refresh waits a setup's 7 to 14 seconds (up to 15) for the lock before the server starts, so the bridge Devin Local started at the window load gives up and the window's chat has no Codebook until a reload; no_claim=the bridge's own wait (its tests) and a lock this window's own take-back holds while storage stalls (the same acquisition budget bounds it, not run here); a separate Node process holds the real setup lock
test("a Devin Desktop window's activation refresh gives up within seconds on a setup lock another window holds and still publishes its descriptor", async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  const holder = await holdSetupLockInOtherProcess(context, storageDirectory)
  try {
    const loadedAtMs = performance.now()
    // Act
    const window = await devinWindow(context, {
      storageDirectory,
      savedSetup: true,
    })
    try {
      // The other window keeps the lock for up to 14 seconds, past the bridge's wait: only a refresh that gives up first publishes in time.
      const publishedAtMs = await waitUntil(
        async () =>
          (await window.descriptorReadable()) ? performance.now() : undefined,
        "the reconnected server's descriptor while the other window holds the setup lock",
        14_000,
      )
      await window.whenReconnected()
      // Assert
      const publishedAfterMs = publishedAtMs - loadedAtMs
      assert.ok(
        publishedAfterMs < 6_000,
        `the descriptor was published ${Math.round(publishedAfterMs)} ms after the window loaded`,
      )
      assert.deepEqual(window.steps, [
        'verify Devin skill',
        'resolve Node',
        'start server',
      ])
      assert.deepEqual(window.outputLines, [
        'Codebook did not refresh its Devin Desktop MCP entry: Another Codebook window is changing the Devin Desktop setup. Try again in a moment.',
      ])
    } finally {
      await window.loaded.deactivate()
    }
  } finally {
    await holder.release()
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

// Value: protects=the descriptor mark names the installation of the MCP receipt, so a bridge can tell a removed setup from an updated one (Cycle 0144 task 1); fails_when=the mark carries no installation id or another one than the receipt's, so the bridge refuses every window or accepts a removed setup; no_claim=the bridge's comparison of the id with the receipt; why_new=Cycle 0144 task 1; seam=the real descriptor file in the temporary storage
test(
  'Devin Desktop writes the installation id of the MCP receipt beside devinChat and drops it with the mark',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, { confirmRemoval: true })
    try {
      await window.commands.get('codebook.startAgentServer')!()
      // Act
      await window.commands.get('codebook.setupAiChat')!()
      const afterSetup = await window.readDescriptorInstallation()
      await window.commands.get('codebook.removeManagedDevinSetup')!()
      const afterRemoval = await window.readDescriptorInstallation()
      // Assert
      assert.deepEqual(
        [afterSetup, afterRemoval],
        ['installation-test', undefined],
      )
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// Value: protects=Set Up AI Chat does not report success for a window whose bridge could never connect because the MCP receipt's installation id cannot be read (Cycle 0144 F12); fails_when=the window is marked and the reload is offered although the receipt (mode 0644) is unreadable, so rerunning setup repeats it; no_claim=the wording of the repair beyond naming the receipt file; why_new=Cycle 0144 F12; seam=the real descriptor and receipt files in the temporary storage
test(
  'Devin Desktop setup refuses with the receipt file to repair when the receipt is not private, and leaves the descriptor unmarked',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, { receiptMode: 0o644 })
    try {
      await window.commands.get('codebook.startAgentServer')!()
      // Act
      const setupOutcome = await window.commands.get(
        'codebook.setupAiChat',
      )!().then(
        () => 'resolved',
        (error: Error) => error.message,
      )
      // Assert
      assert.equal(
        setupOutcome,
        `Codebook could not read the installation id in ${join(window.directory, 'devin-mcp', 'receipt.json')}, so Devin Local could not connect. Make that file readable only by you (mode 600), then run Codebook: Set Up AI Chat again.`,
      )
      assert.equal(await window.readDescriptorField(), undefined)
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// protects=a skill receipt that others can read ends setup in a refusal that names devin-skill/receipt.json with the mode repair, rolls back, offers no reload and leaves the window unmarked, because the bridge would refuse that receipt; fails_when=setup marks the window and offers Reload Window while Devin Local could never connect; no_claim=the wording beyond naming the file and the mode; seam=the real descriptor and receipt files, the skill deployment leaves its receipt with mode 0644
test(
  'Devin Desktop setup refuses with the skill receipt to repair when others can read it, offering no reload',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, { skillReceiptMode: 0o644 })
    try {
      await window.commands.get('codebook.startAgentServer')!()
      // Act
      const setupOutcome = await window.commands.get(
        'codebook.setupAiChat',
      )!().then(
        () => 'resolved',
        (error: Error) => error.message,
      )
      // Assert
      assert.equal(
        setupOutcome,
        `Codebook could not use its record at ${join(await realpath(window.directory), 'devin-skill', 'receipt.json')}, so Devin Local could not connect. Make that file readable only by you (mode 600), then run Codebook: Set Up AI Chat again.`,
      )
      assert.equal(await window.readDescriptorField(), undefined)
      assert.deepEqual(window.notices, [])
      assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// protects=a re-run of setup whose skill receipt others can read unmarks a window that carried the mark of its earlier setup, so the rollback never marks what the bridge refuses; fails_when=the rollback's sync keeps the mark because the looser receipts check says the setup stands; no_claim=the wording of the refusal
test(
  'a Devin Desktop window with an earlier setup is unmarked after a setup re-run refused for a skill receipt others can read',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, {
      savedSetup: true,
      entryWrite: 'current',
      skillReceiptMode: 0o644,
    })
    try {
      await waitUntil(window.descriptorReadable, 'the reconnect descriptor')
      await waitUntil(
        async () => (await window.readDescriptorField()) === true,
        'the earlier setup mark',
      )
      // Act
      await window.commands.get('codebook.setupAiChat')!().catch(
        () => undefined,
      )
      // Assert
      assert.equal(await window.readDescriptorField(), undefined)
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// protects=once the skill receipt is private again, setup succeeds and marks the window; fails_when=the new check refuses a setup whose records the bridge accepts; no_claim=the reload notice wording
test(
  'Devin Desktop setup succeeds after the skill receipt was made private again',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, { skillReceiptMode: 0o644 })
    try {
      await window.commands.get('codebook.startAgentServer')!()
      await window.commands.get('codebook.setupAiChat')!().catch(
        () => undefined,
      )
      await chmod(join(window.directory, 'devin-skill', 'receipt.json'), 0o600)
      // Act
      const setupOutcome = await window.commands.get(
        'codebook.setupAiChat',
      )!().then(
        () => 'resolved',
        (error: Error) => error.message,
      )
      // Assert
      assert.equal(setupOutcome, 'resolved')
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// protects=Set Up AI Chat never reports success when the MCP receipt became readable by others right after its installation id was read: the bridge's own check refuses it, the setup rolls back, the window ends unmarked and no reload is offered (Cycle 0145 task 9, was Cycle 0144 CR12); fails_when=setup resolves with a mark the bridge refuses; no_claim=the activation reconnect and the rollback sync; seam=afterInstallationRead makes the receipt mode 0644 after the check
test(
  'Devin Desktop setup rolls back and offers no reload when the receipt becomes readable by others right after the installation id check',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, {
      afterInstallationRead: async (): Promise<void> => {
        await chmod(join(window.directory, 'devin-mcp', 'receipt.json'), 0o644)
      },
    })
    try {
      await window.commands.get('codebook.startAgentServer')!()
      // Act
      const setupOutcome = await window.commands.get(
        'codebook.setupAiChat',
      )!().then(
        () => 'resolved',
        (error: Error) => error.message,
      )
      // Assert
      assert.equal(
        setupOutcome,
        `Codebook could not use its record at ${join(await realpath(window.directory), 'devin-mcp', 'receipt.json')}, so Devin Local could not connect. Make that file readable only by you (mode 600), then run Codebook: Set Up AI Chat again.`,
      )
      assert.equal(await window.readDescriptorField(), undefined)
      assert.deepEqual(window.notices, [])
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// protects=Set Up AI Chat does not report success for a descriptor that names another server than the one it checked; fails_when=the final check accepts a descriptor of another instance, so the reload is offered for a window whose bridge cannot select this server; why_new=Cycle 0145 /ship pass 1 finding (false success, final check without server identity); seam=the descriptor is replaced right after the installation id was read; no_claim=the wording of the rollback's Output lines
test(
  'Devin Desktop setup rolls back with the changed-meanwhile sentence and offers no reload when the descriptor names another instance at the final check',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, {
      afterInstallationRead: async (): Promise<void> => {
        await writeFile(
          await window.descriptorPath(),
          JSON.stringify({
            instanceId: 'instance-other',
            url: 'http://127.0.0.1/instance-other/mcp',
            token: 'test-token',
            workspace: window.directory,
            apiVersion: '1.6',
            pid: process.pid,
          }),
          { mode: 0o600 },
        )
      },
    })
    try {
      await window.commands.get('codebook.startAgentServer')!()
      // Act
      const setupOutcome = await window.commands.get(
        'codebook.setupAiChat',
      )!().then(
        () => 'resolved',
        (error: Error) => error.message,
      )
      // Assert
      assert.equal(
        setupOutcome,
        'The Devin Desktop setup changed while this setup ran; run Codebook: Stop Agent Server, then Codebook: Set Up AI Chat again.',
      )
      assert.deepEqual(window.notices, [])
      assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// protects=Set Up AI Chat does not report success for a descriptor rewritten to an empty object, which gains only the mark; fails_when=the final check accepts a descriptor that names no instance, url, workspace or host; why_new=Cycle 0145 /ship pass 1 finding (false success, final check without server identity); seam=the descriptor is replaced by {} right after the installation id was read; no_claim=the wording of the rollback's Output lines
test(
  'Devin Desktop setup rolls back and offers no reload when the descriptor was rewritten to an empty object before the final check',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, {
      afterInstallationRead: async (): Promise<void> => {
        await writeFile(await window.descriptorPath(), '{}', { mode: 0o600 })
      },
    })
    try {
      await window.commands.get('codebook.startAgentServer')!()
      // Act
      const setupOutcome = await window.commands.get(
        'codebook.setupAiChat',
      )!().then(
        () => 'resolved',
        (error: Error) => error.message,
      )
      // Assert
      assert.equal(
        setupOutcome,
        'The Devin Desktop setup changed while this setup ran; run Codebook: Stop Agent Server, then Codebook: Set Up AI Chat again.',
      )
      assert.deepEqual(window.notices, [])
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// protects=a first setup whose MCP receipt others can read and whose rollback deletes that receipt asks only for a setup retry, not for a mode repair of a file that is gone; fails_when=the sentence is chosen before the rollback and names the deleted receipt with the mode-600 instruction; why_new=Cycle 0145 /ship pass 1 finding (false success, chmod for a deleted receipt); seam=a removal stand-in that deletes the receipt as the real one does; no_claim=a receipt that stays (the sibling test above)
test(
  'Devin Desktop setup asks only for a retry when its rollback deleted the receipt others could read',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, {
      receiptMode: 0o644,
      removalDeletesReceipt: true,
    })
    try {
      await window.commands.get('codebook.startAgentServer')!()
      // Act
      const setupOutcome = await window.commands.get(
        'codebook.setupAiChat',
      )!().then(
        () => 'resolved',
        (error: Error) => error.message,
      )
      // Assert
      assert.equal(
        setupOutcome,
        'The Devin Desktop setup changed while this setup ran; run Codebook: Set Up AI Chat again.',
      )
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// protects=a first read of the installation id that failed to look (EMFILE) asks for a retry and offers no mode repair for a private receipt that holds a valid id; fails_when=the refusal reads the receipt again, finds it fine and asks the learner to chmod a file that needs nothing; why_new=Cycle 0145 /ship pass 1 finding (error handling, EMFILE then reread); seam=the first installation id read answers no answer; no_claim=a receipt others can read (the sibling test above)
test(
  'Devin Desktop setup asks for a retry without a mode repair when the first read of the installation id gave no answer',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, {
      failFirstInstallationRead: true,
    })
    try {
      await window.commands.get('codebook.startAgentServer')!()
      // Act
      const setupOutcome = await window.commands.get(
        'codebook.setupAiChat',
      )!().then(
        () => 'resolved',
        (error: Error) => error.message,
      )
      // Assert
      assert.equal(
        setupOutcome,
        'Codebook could not read its setup records just now; run Codebook: Set Up AI Chat again.',
      )
    } finally {
      await window.loaded.deactivate()
    }
  },
)

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

// protects=a moment of descriptor exhaustion at server start does not leave the descriptor of a set-up window unmarked for the whole run; fails_when=the first read gets no answer and the descriptor is published without the mark, so the bridge exits as not set up; no_claim=a receipt that is observed removed, which stays unmarked
test('a Devin Desktop window whose first receipt read at server start gets no answer ends with a marked descriptor', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    receiptReadsWithoutAnswer: 1,
  })
  try {
    // Act
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
    )
    const isMarked = async (): Promise<boolean> =>
      (await window.readDescriptorField()) === true
    await waitUntil(isMarked, 'the mark after the receipts read answered')
    // Assert
    assert.equal(await window.readDescriptorField(), true)
    assert.equal(await window.readDescriptorInstallation(), 'installation-test')
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a read that never returns at server start does not keep the descriptor from being published: the descriptor appears, unmarked, within the read budget (Cycle 0145 final-range F7); fails_when=the start waits on the first read inside the descriptor queue, so no descriptor is published and a later stop cannot remove it; no_claim=a read that settles after the deadline (it changes nothing, but the test does not observe it)
test('a Devin Desktop window whose receipt read never returns at server start publishes an unmarked descriptor within the budget', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    receiptReadsHang: true,
  })
  try {
    // Act
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    // Assert
    assert.equal(await window.readDescriptorField(), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=server restarts while the receipt reads hang start the reads once, so they never pile up until the editor's file pool is held (Cycle 0145 last-round O4); fails_when=each start begins two more reads that never return; no_claim=the descriptor's mark (unmarked here)
test('a Devin Desktop window whose receipt reads hang asks for them once however often its server starts', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    receiptReadsHang: true,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the first start's connection descriptor",
      15_000,
    )
    // Act
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    await waitUntil(
      window.descriptorReadable,
      "the second start's connection descriptor",
      15_000,
    )
    // Assert
    assert.equal(window.receiptReadCount(), 1)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a read that answered nothing just before the deadline is not asked again after the descriptor was published unmarked (Cycle 0145 last-round G9); fails_when=the retry wait outlives the deadline and a second read starts; no_claim=a retry that falls within the budget (the exhaustion test above)
test('a Devin Desktop window starts no receipt read after its unmarked descriptor was published at the deadline', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    // The first read answers nothing 100 ms before the 5 s deadline.
    receiptReadDelaysMs: [4_900],
  })
  try {
    // Act
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    // gstack-timing-ok: proving that no read starts after the deadline needs a window past the 500 ms retry wait; a slow runner can only hide the defect, never fail a correct build.
    await delay(1_200)
    // Assert
    assert.equal(window.receiptReadCount(), 1)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a receipt read that never returns does not hold the removal, the descriptor queue or later writes of a window whose saved setup could not be cleared (Cycle 0145 last-round G11); fails_when=the mark decision waits on the read for ever, so the removal never ends; no_claim=the wording of the removal notice
test('a Devin Desktop removal ends and unmarks the descriptor although the receipt read never returns', async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {
    savedSetup: true,
    confirmRemoval: true,
    failSetupClear: true,
  }
  const window = await devinWindow(context, options)
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    // The storage stops answering after the start.
    options.receiptReadsHang = true
    // Act
    const removal = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!(),
      15_000,
    )
    // Assert
    assert.notEqual(removal, 'still waiting')
    assert.equal(await window.readDescriptorField(), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a failed re-run of a valid setup whose rollback sync gets one read without an answer keeps the earlier mark and the server's token (Cycle 0145 final-range F12); fails_when=the sync turns the missing answer into not set up, removes the mark and rotates the token, and nothing marks again when the receipts read; no_claim=a receipt observed removed (it unmarks at once, the rotation test above)
test('a failed Devin setup re-run whose rollback sync reads no answer once keeps the earlier setup marked with the same token', async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {
    realServer: true,
    savedSetup: true,
    entryWrite: 'current',
    skillManaged: false,
  }
  let tokenBefore: string | undefined
  let readsBeforeFailure = 0
  options.onSkillCheck = async (): Promise<void> => {
    // The restarted server is marked; the next read of the receipts (the rollback's sync) gets no answer once.
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    tokenBefore = JSON.parse(
      await readFile(await window.descriptorPath(), 'utf8'),
    ).token
    options.receiptReadsWithoutAnswer = 1
    readsBeforeFailure = window.receiptReadCount()
    throw new Error('Injected skill check failure')
  }
  const window = await devinWindow(context, options)
  try {
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    const descriptorFile = await window.descriptorPath()
    const tokenAfter = JSON.parse(await readFile(descriptorFile, 'utf8')).token
    // Assert
    // The injected failure is what ended the setup.
    assert.equal(setupOutcome, 'Injected skill check failure')
    // The rollback's sync read without an answer (the stand-in used its one), and a retry read followed it.
    assert.equal(options.receiptReadsWithoutAnswer, 0)
    assert.equal(window.receiptReadCount() - readsBeforeFailure >= 2, true)
    assert.equal(await window.readDescriptorField(), true)
    assert.equal(typeof tokenBefore, 'string')
    assert.equal(tokenAfter, tokenBefore)
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
    // The unmark of the rollback fails on the same descriptor, so the rollback says it is incomplete.
    await assert.rejects(setup, {
      message:
        "Codebook could not read this window's connection descriptor. Run Codebook: Stop Agent Server and Codebook: Start Agent Server, then try again. Codebook could not take back everything the setup saved; see Codebook's Output for details.",
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
    await waitUntil(
      window.hasReceiptsReached,
      'the restart to read the setup records',
    )
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
      'Codebook server stopped or changed workspace while Devin Desktop setup was finishing, so the setup did not complete. Run Codebook: Set Up AI Chat again.',
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

// protects: a Devin Desktop setup whose server is stopped while its committed setup is being saved ends in success with the committed setup and no rollback; fails_when=the setup checks the server after the commit write and rolls back, so a failing restore write leaves a committed value that the next start marks as a failed setup; no_claim=a server stopped before the receipts read (the sibling test above), the restart itself (a window load starts the server of a saved setup)
test('a Devin Desktop setup whose server was stopped while its commit was written keeps the committed setup and takes nothing back', async (context) => {
  // Arrange
  const stopServer = async (): Promise<void> => {
    await window.commands.get('codebook.stopAgentServer')!()
  }
  const window = await devinWindow(context, {
    onSetupCommit: stopServer,
  })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(setupOutcome, 'resolved')
    assert.deepEqual(window.state.get('codebook.aiChatSetup'), {
      workspace: window.directory,
    })
    assert.deepEqual(window.entryRemovals, [])
    assert.equal(window.notices.length, 1)
    assert.deepEqual(window.notices[0]?.actions, ['Reload Window'])
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a Devin Desktop setup whose window switched to another folder while its commit was written reports that it did not complete, offers no reload and leaves no saved setup of the old folder; fails_when=the setup reports success and offers a reload that cannot connect the folder now open, or the commit lands after the folder change cleared the saved value and the old folder's setup stays saved; no_claim=the wording of the folder-change handling's own notices
test('a Devin Desktop setup whose folder changed while its commit was written offers no reload and says it did not complete', async (context) => {
  // Arrange
  const switchFolder = async (seam: {
    changeFolder: (folder: string) => void
  }): Promise<void> => {
    // The registered folder-change listeners run against the held commit write.
    seam.changeFolder('/other/folder')
  }
  const window = await devinWindow(context, { onSetupCommit: switchFolder })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // The folder-change handling stops the old folder's server; both processes have settled when no descriptor is left.
    await waitUntil(
      async () => (await window.descriptorNames()).length === 0,
      "the stop of the old folder's server",
    )
    // Assert
    assert.equal(
      setupOutcome,
      'The workspace folder changed while Devin Desktop setup was finishing, so the setup did not complete for this folder. Run Codebook: Set Up AI Chat again.',
    )
    assert.deepEqual(window.notices, [])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a Devin Desktop setup whose window switched to another folder while the setup lock was released reports that it did not complete and offers no reload; fails_when=the success notice and its Reload Window button come for the folder that just closed, because the folder is compared only inside the lock; no_claim=the old folder's saved value (the folder-change handling clears it)
test('a Devin Desktop setup whose folder changed while its lock was released offers no reload and says it did not complete', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    afterSetupLockRelease: async (seam) => {
      seam.changeFolder('/other/folder')
    },
  })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(
      setupOutcome,
      'The workspace folder changed while Devin Desktop setup was finishing, so the setup did not complete for this folder. Run Codebook: Set Up AI Chat again.',
    )
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a Devin Desktop setup whose final receipts check never answers takes its records back within a bound and offers no reload; fails_when=the setup waits for ever on a skill receipt read that hangs, never rolls back, and a removal queued behind it waits too; no_claim=a check that answers late (it is no answer once the bound passed)
test('a Devin Desktop setup whose final receipts check never answers takes the entry back and offers no reload', async (context) => {
  // Arrange
  const window = await devinWindow(context, { hangFinalReceiptsCheck: true })
  try {
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(
      setupOutcome,
      'Codebook could not read its setup records just now; run Codebook: Set Up AI Chat again.',
    )
    assert.deepEqual(window.notices, [])
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-this-setup' },
    ])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a failed Devin setup leaves no mark on a server that started during it and read the half-saved setup / fails_when: the new server keeps `devinChat: true` after the rollback, so the bridge connects to a workspace whose setup was taken back / no_claim: the shared MCP entry of another window
test('a Devin Desktop setup that fails after a server restart unmarks the new server it never checked', async (context) => {
  // Arrange
  const stopAndStart = async (): Promise<void> => {
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
  }
  const window = await devinWindow(context, { onSkillCheck: stopAndStart })
  try {
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(await window.readDescriptorField(), undefined)
    assert.equal(
      setupOutcome,
      'Codebook server stopped or changed workspace while Devin Desktop setup was finishing, so the setup did not complete. Run Codebook: Set Up AI Chat again.',
    )
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

/**
 * Posts an MCP initialize to the server a Devin Desktop window runs, as the Devin bridge (or any other client) would.
 * @param descriptorFile - The path of the window's connection descriptor.
 * @param isDevinBridge - Whether the request carries `x-codebook-bridge: devin`.
 * @param token - The bearer token to send instead of the descriptor's current one (a client that connected earlier).
 * @returns The HTTP status of the answer.
 * @example await postInitialize(await window.descriptorPath(), true) // => 403 while the window's mark is off
 */
async function postInitialize(
  descriptorFile: string,
  isDevinBridge: boolean,
  token?: string,
): Promise<number> {
  const descriptor = JSON.parse(await readFile(descriptorFile, 'utf8'))
  const answer = await fetch(descriptor.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token ?? descriptor.token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(isDevinBridge && { 'x-codebook-bridge': 'devin' }),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'onboarding-test', version: '1.0' },
      },
    }),
  })
  await answer.text()
  return answer.status
}

// protects: activate gives the running server its in-memory mark, and a failed setup's rollback turns it off before the descriptor is rewritten, so a bridge that connected meanwhile is refused (Cycle 0144 tasks 1 and 4) / fails_when: the server is started without the window's mark as its gate, or the rollback leaves the mark on, so the Devin bridge is served for a setup that was taken back / no_claim: the descriptor file's content or the order of the two writes
test('a Devin bridge request is served while the setup stands and refused after a failed setup took it back, while other clients stay served', async (context) => {
  // Arrange
  let statusBeforeFailure: number | undefined
  const stopAndStart = async (): Promise<void> => {
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    // The restarted server read the half-saved setup, so it is marked now.
    statusBeforeFailure = await postInitialize(
      await window.descriptorPath(),
      true,
    )
  }
  const window = await devinWindow(context, {
    realServer: true,
    onSkillCheck: stopAndStart,
  })
  try {
    // Act
    await window.commands.get('codebook.setupAiChat')!().catch(() => undefined)
    const descriptorFile = await window.descriptorPath()
    const bridgeStatus = await postInitialize(descriptorFile, true)
    const otherClientStatus = await postInitialize(descriptorFile, false)
    // Assert
    assert.deepEqual(
      [statusBeforeFailure, bridgeStatus, otherClientStatus],
      [200, 403, 200],
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a failed Devin setup's rollback rotates the server's token and writes the new one into the descriptor, so a bridge of an earlier build (it sends no Devin header) is refused too (Cycle 0144 F6) / fails_when: the old token still works after the rollback, or the descriptor's new token is refused / no_claim: the bridge's own reconnect
test('a Devin bridge without the Devin header that holds the old token is refused after a failed setup took the setup back, and the descriptor token is served', async (context) => {
  // Arrange
  let oldToken: string | undefined
  let statusBeforeFailure: number | undefined
  const restartAndRememberToken = async (): Promise<void> => {
    // The restarted server read the half-saved setup, so it is marked and the bridge connects with its token.
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    oldToken = JSON.parse(
      await readFile(await window.descriptorPath(), 'utf8'),
    ).token
    statusBeforeFailure = await postInitialize(
      await window.descriptorPath(),
      false,
      oldToken,
    )
  }
  const window = await devinWindow(context, {
    realServer: true,
    onSkillCheck: restartAndRememberToken,
  })
  try {
    // Act
    await window.commands.get('codebook.setupAiChat')!().catch(() => undefined)
    const descriptorFile = await window.descriptorPath()
    const newToken = JSON.parse(await readFile(descriptorFile, 'utf8')).token
    const withOldToken = await postInitialize(descriptorFile, false, oldToken)
    const withNewToken = await postInitialize(descriptorFile, false)
    // Assert
    assert.equal(typeof oldToken, 'string')
    assert.notEqual(newToken, oldToken)
    assert.deepEqual(
      [statusBeforeFailure, withOldToken, withNewToken],
      [200, 401, 200],
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a failed setup's rollback in a window whose descriptor was never marked keeps the token, so no client of that window loses its connection for no reason (Cycle 0144 F15) / fails_when: the rollback rotates the token of a window that never carried the Devin mark, so the old token answers 401 / no_claim: a window whose mark was removed
test('a failed Devin setup in a window whose descriptor was never marked keeps the token it serves', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    realServer: true,
    skillManaged: false,
  })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    const descriptorFile = await window.descriptorPath()
    const tokenBefore = JSON.parse(await readFile(descriptorFile, 'utf8')).token
    // Act
    await window.commands.get('codebook.setupAiChat')!().catch(() => undefined)
    const tokenAfter = JSON.parse(await readFile(descriptorFile, 'utf8')).token
    const withOldToken = await postInitialize(
      descriptorFile,
      false,
      tokenBefore,
    )
    // Assert
    assert.equal(tokenAfter, tokenBefore)
    assert.equal(withOldToken, 200)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a rollback whose descriptor rewrite fails leaves the server on the token the descriptor still holds, so clients that read the file keep their connection (Cycle 0144 F15) / fails_when: the server switches to the new token before the descriptor carries it, so the file's token answers 401 / no_claim: the learner's wording beyond the incomplete take-back
test('a Devin setup whose rollback cannot write the descriptor keeps serving the token the descriptor holds and reports the take-back incomplete', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    realServer: true,
    failDescriptorUnmark: true,
    onSkillCheck: async (): Promise<void> => {
      // The restarted server read the half-saved setup, so its descriptor is marked.
      await window.commands.get('codebook.stopAgentServer')!()
      await window.commands.get('codebook.startAgentServer')!()
    },
  })
  try {
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    const descriptorFile = await window.descriptorPath()
    const status = await postInitialize(descriptorFile, false)
    // Assert
    assert.equal(status, 200)
    assert.equal(setupOutcome.includes('could not take back everything'), true)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a committed token rotation changes the MCP definition's version and tells the editor, so a VS Code MCP client resolves the definition again with the new bearer (Cycle 0144 F15) / fails_when: the version stays the same or no change event fires after the switch / no_claim: the editor's own re-resolve
test('a committed token rotation changes the MCP definition version and fires the definitions change event', async (context) => {
  // Arrange
  let versionBefore: string | undefined
  let eventsBefore = 0
  const window = await devinWindow(context, {
    realServer: true,
    savedSetup: true,
    entryWrite: 'current',
    skillManaged: false,
    onSkillCheck: async (): Promise<void> => {
      // The restarted server is marked; another window's removal then takes the skill record, so the rollback leaves the window unmarked while its earlier setup stays saved.
      await window.commands.get('codebook.stopAgentServer')!()
      await window.commands.get('codebook.startAgentServer')!()
      await rm(join(window.directory, 'devin-skill/receipt.json'))
      versionBefore = window.definitionVersion()
      eventsBefore = window.changeEvents()
    },
  })
  try {
    // Act
    await window.commands.get('codebook.setupAiChat')!().catch(() => undefined)
    // Assert
    assert.equal(typeof versionBefore, 'string')
    assert.notEqual(window.definitionVersion(), versionBefore)
    assert.equal(window.changeEvents(), eventsBefore + 1)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a failed Devin setup whose restore of the saved setup also fails leaves no mark: the provisional value reads as no setup, so the rollback unmarks the window and a restarted server stays unmarked; fails_when=the half-saved value still counts as a setup while the receipts stand, so the rollback's sync keeps the Devin mark and the server serves a bridge for a failed setup; no_claim=the wording of the Output lines
test('a Devin setup whose restore of the saved setup fails leaves the window unmarked, also after a server restart', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    failSetupClear: true,
    afterInstallationRead: async (): Promise<void> => {
      throw new Error('Injected failure after the saved setup')
    },
  })
  try {
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    const markAfterRollback = await window.readDescriptorField()
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    const markAfterRestart = await window.readDescriptorField()
    // Assert
    assert.equal(setupOutcome.includes('could not take back everything'), true)
    assert.equal(markAfterRollback, undefined)
    assert.equal(markAfterRestart, undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a failed re-run whose commit and restore writes both fail keeps the earlier valid setup working: the provisional value reads as the setup before the run, so the window stays marked after a server restart; fails_when=the provisional value replaces the earlier setup, or vetoes it, so a valid setup stops working; no_claim=the rollback's wording
test('a failed Devin setup re-run whose saved setup cannot be restored keeps the earlier setup marked after a restart', async (context) => {
  // Arrange
  let isSkillCheckFailing = false
  const window = await devinWindow(context, {
    savedSetup: true,
    entryWrite: 'current',
    failSetupRestore: true,
    onSkillCheck: async (): Promise<void> => {
      if (isSkillCheckFailing) throw new Error('Injected skill check failure')
    },
  })
  try {
    await waitUntil(window.descriptorReadable, 'the reconnect descriptor')
    isSkillCheckFailing = true
    // Act
    await window.commands.get('codebook.setupAiChat')!().catch(() => undefined)
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    // Assert
    assert.equal(await window.readDescriptorField(), true)
    assert.deepEqual(window.state.get('codebook.aiChatSetup'), {
      workspace: window.directory,
      provisional: true,
      previous: { workspace: window.directory },
    })
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a Devin setup whose final write of the committed setup fails rolls back instead of reporting success; fails_when=the setup reports success while the saved value is still provisional; no_claim=which sentence the refusal carries
test('a Devin setup whose final commit write fails rolls back and saves no setup', async (context) => {
  // Arrange
  const window = await devinWindow(context, { failSetupCommit: true })
  try {
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup, {
      message: 'Injected workspace state commit failure',
    })
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-this-setup' },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a Devin setup that succeeds saves the committed value {workspace} without the provisional fields; fails_when=the committed value keeps provisional fields, so every reader treats a finished setup as one that failed; no_claim=the reload notice
test('a successful Devin setup saves the committed setup without provisional fields', async (context) => {
  // Arrange
  const window = await devinWindow(context, {})
  try {
    // Act
    await window.commands.get('codebook.setupAiChat')!()
    // Assert
    assert.deepEqual(window.state.get('codebook.aiChatSetup'), {
      workspace: window.directory,
    })
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a rollback whose entry removal resolved with a kept receipt or copy reports itself incomplete and names the file in the Output; fails_when=only a rejected removal counts, so the learner is told the setup was taken back while a record stays; no_claim=the wording of the Output line beyond the named file
test('a Devin setup rollback whose entry removal left a file behind tells the learner the take-back is incomplete and names the file', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    skillManaged: false,
    removalResult: {
      status: 'removed',
      path: '/config/mcp_config.json',
      cleanupFailure:
        'Codebook could not delete its own record of that entry at /storage/devin-mcp/receipt.json; delete that record by hand.',
    },
  })
  try {
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(setupOutcome.includes('could not take back everything'), true)
    assert.equal(
      window.outputLines.some((line) =>
        line.includes('/storage/devin-mcp/receipt.json'),
      ),
      true,
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a failed unmark makes the rollback of a Devin setup incomplete and says so to the learner and the Output / fails_when: the rollback ends complete although the descriptor could not be rewritten, so the learner is told the setup was taken back while a mark may stay / no_claim: the wording of the Output line beyond its cause
test('a Devin Desktop setup whose rollback cannot rewrite the descriptor tells the learner the take-back is incomplete', async (context) => {
  // Arrange
  const window = await devinWindow(context, {})
  try {
    await window.commands.get('codebook.startAgentServer')!()
    await writeFile(await window.descriptorPath(), 'not a descriptor {')
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(
      setupOutcome,
      "Codebook could not read this window's connection descriptor. Run Codebook: Stop Agent Server and Codebook: Start Agent Server, then try again. Codebook could not take back everything the setup saved; see Codebook's Output for details.",
    )
    assert.equal(
      window.outputLines.includes(
        "Codebook could not update this window's connection descriptor: Codebook could not read this window's connection descriptor. Run Codebook: Stop Agent Server and Codebook: Start Agent Server, then try again.",
      ),
      true,
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a Devin setup stopped mid-way whose take-back also failed points the learner to Codebook's Output / fails_when: the notice claims only that the setup did not complete, so the learner never learns that part of it stays saved / no_claim: the Output line's wording
test('a Devin Desktop setup whose take-back failed points to the Codebook Output', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    holdDescriptorRewrite: true,
    failEntryRemoval: true,
  })
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
      "Codebook server stopped or changed workspace while Devin Desktop setup was finishing, so the setup did not complete. Run Codebook: Set Up AI Chat again. Codebook could not take back everything the setup saved; see Codebook's Output for details.",
    )
    assert.deepEqual(
      window.outputLines.filter((line) => line.includes('MCP entry')),
      [
        'Codebook could not take back the Devin Desktop MCP entry this setup wrote: Injected entry removal failure',
      ],
    )
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

// Value: protects=a failed Devin setup whose take-back waits on a storage that stops answering still answers its command within the take-back budget, with the failure and the step that waits, while the take-back keeps the setup lock until storage answers, so another window's setup changes nothing meanwhile (Cycle 0146 task 1a); fails_when=the command waits for the take-back for ever, answers before the budget, or the lock is released before the take-back ended, so the other window's setup starts while the entry removal is still held; no_claim=the refusal of this window's own setup and removal (the next test); a stand-in entry removal held at a gate stands for the stalled storage, and both windows share one extension host and one storage folder
test('a failed Devin setup whose take-back waits on storage answers within the budget naming the waiting step and keeps the setup lock until storage answers', async (context) => {
  // Arrange
  const first = await devinWindow(context, {
    failSetupCommit: true,
    holdEntryRemoval: true,
  })
  let hadFirstEndedWhenSecondStarted: boolean | undefined
  const second = await devinWindow(context, {
    storageDirectory: first.directory,
    instanceLabel: 'second',
    onResolveNode: (): void => {
      hadFirstEndedWhenSecondStarted = first.outputLines.includes(
        "Codebook's take-back of this Devin Desktop setup ended now that storage answered, so Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup run again in this window.",
      )
    },
  })
  try {
    // Act
    const setupEnd = first.commands.get('codebook.setupAiChat')!().then(
      () => ({ atMs: performance.now(), message: 'resolved' }),
      (error: Error) => ({ atMs: performance.now(), message: error.message }),
    )
    const removalReachedAtMs = await waitUntil(
      () => first.holds.entryRemoval.reachedAtMs(),
      "the take-back's entry removal",
    )
    const setupOutcome = await within(setupEnd, 16_000)
    const secondSetup = second.commands.get('codebook.setupAiChat')!()
    // Assert
    assert.ok(setupOutcome !== 'still waiting', 'the setup command answered')
    const answeredAfterMs = setupOutcome.atMs - removalReachedAtMs
    assert.ok(
      answeredAfterMs >= 9_000 && answeredAfterMs <= 15_000,
      `the setup command answered ${answeredAfterMs} ms after the entry removal was reached`,
    )
    assert.equal(
      setupOutcome.message,
      "Injected workspace state commit failure Codebook's take-back of this Devin Desktop setup is still waiting on storage (MCP entry) after 10 seconds; it finishes when storage answers, and Codebook's Output says when. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
    )
    // Without the lock the second window's first step follows within milliseconds; half a second without it shows it waits.
    await assert.rejects(
      waitUntil(
        () => second.steps.length > 0,
        "the second window's setup to start while the take-back holds the lock",
        500,
      ),
      {
        message:
          "Timed out waiting for the second window's setup to start while the take-back holds the lock",
      },
    )
    first.holds.entryRemoval.release()
    await secondSetup
    assert.deepEqual(second.steps, [
      'resolve Node',
      'deploy Devin skill',
      'start server',
      'write MCP entry',
      'verify Devin skill',
    ])
    assert.equal(hadFirstEndedWhenSecondStarted, true)
  } finally {
    await first.loaded.deactivate()
    await second.loaded.deactivate()
  }
})

// Value: protects=while a failed setup's take-back still waits on storage after its command answered, a new Set Up AI Chat and a Remove Devin Desktop Setup of that window refuse at once with the sentence that names the take-back, and the removal asks no question (Cycle 0146 task 1a); fails_when=the first command never answers, or a later command joins the pending take-back, waits for the lock, or asks its modal question first; no_claim=the lock seen from another window (the test above); the held stand-in entry removal stands for the stalled storage
test('a Devin setup and a removal refuse at once while an earlier take-back still waits on storage', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    failSetupCommit: true,
    holdEntryRemoval: true,
    confirmRemoval: true,
  })
  try {
    const firstOutcome = await within(
      window.commands.get('codebook.setupAiChat')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      16_000,
    )
    // Act
    // Each answer is waited for 2 seconds at most: a command that joins the pending take-back or waits for the lock answers 'still waiting'.
    const setupRefusal = await within(
      window.commands.get('codebook.setupAiChat')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      2_000,
    )
    const removalRefusal = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      2_000,
    )
    // Assert
    assert.notEqual(firstOutcome, 'still waiting')
    assert.equal(
      setupRefusal,
      'Codebook is still taking back an earlier Devin Desktop setup because storage does not answer. Run Codebook: Set Up AI Chat again once it finishes, or reload the window, which finishes that take-back when it loads again.',
    )
    assert.equal(
      removalRefusal,
      'Codebook is still taking back an earlier Devin Desktop setup because storage does not answer. Run Codebook: Remove Devin Desktop Setup again once it finishes, or reload the window, which finishes that take-back when it loads again.',
    )
    assert.deepEqual(window.modalQuestions, [])
    assert.equal(
      window.steps.filter((step) => step === 'resolve Node').length,
      1,
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed first Devin setup records that its entry is still to be taken back before its take-back's first step waits on storage, and drops that record once its entry step answered, so a reload or a closed window during the take-back leaves the entry to the next run (Cycle 0146 /ship pass 1, outside-voice 4 and red-team 1); fails_when=only the window's memory knows the take-back is owed, so a reload while the saved setup's restore waits drops the entry step and the failed setup's entry and receipt stay installed; why_new=the take-back's steps were tested only within one window's life; seam=a held take-back restore of the saved setup; no_claim=what the next window does with the record (the next tests); the held stand-in write stands for the stalled editor storage, and the record is the real file
test('a failed first Devin setup records its owed take-back before its first step waits on storage and drops it once the entry step answered', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    failSetupCommit: true,
    holdSavedSetupWrite: true,
  })
  try {
    const setup = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      "the take-back's restore of the saved setup",
    )
    // Act
    const recordWhileRestoreHeld = await owedTakeBackRecord(window.directory)
    window.holds.savedSetupWrite.release()
    const setupOutcome = await within(setup, 9_000)
    // Assert
    assert.deepEqual(recordWhileRestoreHeld, {
      schemaVersion: 1,
      generation: 'generation-of-this-setup',
    })
    assert.equal(setupOutcome, 'Injected workspace state commit failure')
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-this-setup' },
    ])
    assert.equal(await owedTakeBackRecord(window.directory), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window that loads on a storage with an owed take-back (a reload stopped a failed setup's take-back) takes that entry back by the failed setup's generation, says so in the Output and drops the record, also without a setup of its own to reconnect (Cycle 0146 /ship pass 1, outside-voice 4 and red-team 1); fails_when=nothing reads the record, so the failed first setup's entry and receipt stay installed until the learner runs setup or removal again; why_new=no run finished a take-back that a reload stopped; seam=none; no_claim=a record whose generation a newer setup replaced (the removal by generation then touches nothing, the config module's own tests); the record is the real file, left as a stopped take-back leaves it
test('a Devin Desktop window that loads with an owed take-back takes that entry back by its generation and drops the record', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  await leaveOwedTakeBack(storageDirectory, 'generation-of-a-failed-setup')
  // Act
  const window = await devinWindow(context, { storageDirectory })
  try {
    await waitUntil(
      async () =>
        window.steps.includes('remove MCP entry') &&
        (await owedTakeBackRecord(storageDirectory)) === undefined,
      "the window load's take-back of the owed entry",
      5_000,
    )
    // Assert
    assert.deepEqual(window.steps, ['remove MCP entry'])
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-a-failed-setup' },
    ])
    assert.deepEqual(window.outputLines, [
      "Codebook is finishing the take-back of a failed Devin Desktop setup that a reload or a closed window stopped: it takes the codebook entry that setup wrote out of Devin Desktop's MCP config.",
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Set Up AI Chat that runs while a take-back is owed takes that failed setup's entry back by its generation before it writes its own entry, so it never adopts the failed entry as current and no later run takes back the entry this setup reported ready (Cycle 0146 /ship pass 1, outside-voice 4); fails_when=the setup writes its entry over the owed record, keeps the failed setup's generation, and the record later removes the new setup's entry; why_new=no run finished a take-back that a reload stopped; seam=a count of the looks for an owed take-back, so the record is left only after the window's own load looked; no_claim=the removal and the activation refresh, which finish it the same way first; the record is the real file
test('a Devin setup that runs while a take-back is owed takes that entry back before it writes its own', async (context) => {
  // Arrange
  const window = await devinWindow(context)
  try {
    await waitUntil(
      () => window.owedTakeBackReads() >= 1,
      "the window load's look for an owed take-back",
    )
    await leaveOwedTakeBack(window.directory, 'generation-of-a-failed-setup')
    // Act
    await window.commands.get('codebook.setupAiChat')!()
    // Assert
    assert.deepEqual(window.steps.slice(0, 3), [
      'remove MCP entry',
      'resolve Node',
      'deploy Devin skill',
    ])
    assert.equal(window.steps.includes('write MCP entry'), true)
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-a-failed-setup' },
    ])
    assert.equal(await owedTakeBackRecord(window.directory), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Set Up AI Chat whose take-back of an owed entry fails (its removal throws, for example on a full disk) writes no entry, reports no ready setup and keeps the record, so no later run takes out an entry this setup reported ready (Cycle 0146 /ship pass 2, specialist-batched 1); fails_when=the setup goes on after the failed take-back, adopts the failed setup's entry as current with the same generation and reports ready while the record still names that generation; no_claim=the activation refresh and the removal (their own tests); a stand-in entry removal that throws stands for the full disk, and the record is the real file
test('a Devin setup whose owed take-back fails writes no entry, reports no ready setup and keeps the record', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    failEntryRemoval: true,
    entryWrite: 'current',
  })
  try {
    await waitUntil(
      () => window.owedTakeBackReads() >= 1,
      "the window load's look for an owed take-back",
    )
    await leaveOwedTakeBack(window.directory, 'generation-of-this-setup')
    // Act
    const outcome = await window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(
      outcome,
      "Codebook could not confirm that the take-back of an earlier failed Devin Desktop setup has finished, so it did not set up Devin Desktop; see Codebook's Output for details, then run Codebook: Set Up AI Chat again.",
    )
    assert.deepEqual(window.steps, ['remove MCP entry'])
    assert.deepEqual(window.notices, [])
    assert.deepEqual(await owedTakeBackRecord(window.directory), {
      schemaVersion: 1,
      generation: 'generation-of-this-setup',
    })
    assert.deepEqual(window.outputLines, [
      "Codebook is finishing the take-back of a failed Devin Desktop setup that a reload or a closed window stopped: it takes the codebook entry that setup wrote out of Devin Desktop's MCP config.",
      'Codebook could not take back the Devin Desktop MCP entry this setup wrote: Injected entry removal failure',
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Set Up AI Chat whose look for an owed take-back gets no answer (descriptor exhaustion, EIO) writes no entry and reports no ready setup, and the Output names the record, because that record may name the entry the setup would adopt (Cycle 0146 /ship pass 2, red-team 1); fails_when=a look without answer reads as nothing owed, so the setup adopts the failed setup's entry as current and reports ready, and the next look that answers takes that entry out; no_claim=a record that cannot be used for good (the same refusal; the Output line asks to delete it when this repeats); the stand-in read of the record answers no-answer once, and the record is the real file
test('a Devin setup whose look for an owed take-back gets no answer writes no entry and reports no ready setup', async (context) => {
  // Arrange
  const window = await devinWindow(context, { entryWrite: 'current' })
  try {
    await waitUntil(
      () => window.owedTakeBackReads() >= 1,
      "the window load's look for an owed take-back",
    )
    await leaveOwedTakeBack(window.directory, 'generation-of-this-setup')
    window.failNextOwedTakeBackLooks(1)
    // Act
    const outcome = await window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(
      outcome,
      "Codebook could not confirm that the take-back of an earlier failed Devin Desktop setup has finished, so it did not set up Devin Desktop; see Codebook's Output for details, then run Codebook: Set Up AI Chat again.",
    )
    assert.deepEqual(window.steps, [])
    assert.deepEqual(window.notices, [])
    assert.deepEqual(await owedTakeBackRecord(window.directory), {
      schemaVersion: 1,
      generation: 'generation-of-this-setup',
    })
    assert.deepEqual(window.outputLines, [
      `Codebook could not read ${join(window.directory, 'devin-setup', 'take-back.json')}, its record of a failed Devin Desktop setup's take-back, so it cannot tell whether that take-back has finished. If this repeats, delete that file, then run Codebook: Set Up AI Chat again.`,
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window that loads on a set-up workspace while an owed take-back cannot finish (its removal throws) leaves the entry unrefreshed and reconnects nothing, so it never serves the failed setup's entry that a later run takes out, and the Output says what to do (Cycle 0146 /ship pass 2, red-team 1); fails_when=the refresh keeps the failed setup's entry and the window starts its server marked for it; no_claim=a look without answer (the next test: the window still reconnects) and a server the learner starts by hand; a stand-in entry removal that throws stands for the full disk, and the record is the real file
test('a Devin Desktop window whose owed take-back fails leaves the entry unrefreshed and reconnects nothing', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  await leaveOwedTakeBack(storageDirectory, 'generation-of-a-failed-setup')
  // Act
  const window = await devinWindow(context, {
    storageDirectory,
    savedSetup: true,
    failEntryRemoval: true,
  })
  try {
    await window.whenReconnected()
    // Assert
    assert.deepEqual(
      window.steps.filter(
        (step) => step === 'refresh MCP entry' || step === 'start server',
      ),
      [],
    )
    assert.equal(
      window.outputLines.filter(
        (line) =>
          line ===
          'Codebook did not refresh its Devin Desktop MCP entry or reconnect this window because the take-back of the failed Devin Desktop setup that wrote that entry has not finished; run Codebook: Set Up AI Chat again once storage answers.',
      ).length,
      1,
    )
    assert.deepEqual(await owedTakeBackRecord(storageDirectory), {
      schemaVersion: 1,
      generation: 'generation-of-a-failed-setup',
    })
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window whose looks for an owed take-back get no answer at load leaves the entry unrefreshed and says so in the Output, and still reconnects, so one moment of descriptor exhaustion neither refreshes an entry a record may name nor leaves a set-up window without its server (Cycle 0146 /ship pass 2, red-team 1); fails_when=a look without answer reads as nothing owed and the refresh rewrites or keeps the entry as installed, or the window stops reconnecting for a read that only failed to look; no_claim=a record that stands after a failed removal (the test above: nothing reconnects); the stand-in read of the record answers no-answer twice (the load's look and the refresh's), and the record is the real file
test('a Devin Desktop window whose look for an owed take-back gets no answer leaves the entry unrefreshed and still reconnects', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  await leaveOwedTakeBack(storageDirectory, 'generation-of-a-failed-setup')
  // Act
  const window = await devinWindow(context, {
    storageDirectory,
    savedSetup: true,
    owedTakeBackLooksWithoutAnswer: 2,
  })
  try {
    await window.whenReconnected()
    // Assert
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'start server',
    ])
    assert.deepEqual(window.outputLines, [
      `Codebook could not read ${join(storageDirectory, 'devin-setup', 'take-back.json')}, its record of a failed Devin Desktop setup's take-back, so it cannot tell whether that take-back has finished. If this repeats, delete that file, then run Codebook: Set Up AI Chat again.`,
      'Codebook did not refresh its Devin Desktop MCP entry: Codebook could not confirm that the take-back of an earlier failed Devin Desktop setup has finished.',
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed first Devin setup stops serving the Devin bridge as soon as its take-back starts, also while the take-back's entry removal waits on storage (Cycle 0146 task 1a, v2 finding 5); fails_when=the window's mark stays on until the take-back's last step, so the bridge is served for a setup that is being taken back; no_claim=the descriptor file's content; the held stand-in entry removal stands for the stalled storage, the server is the real one
test("a failed first Devin setup's bridge request is refused while its take-back waits on storage", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    realServer: true,
    failSetupCommit: true,
    holdEntryRemoval: true,
  })
  try {
    const setup = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.entryRemoval.reachedAtMs(),
      "the take-back's entry removal",
    )
    // Act
    const statusWhileHeld = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    window.holds.entryRemoval.release()
    const setupOutcome = await within(setup, 15_000)
    // Assert
    assert.equal(statusWhileHeld, 403)
    assert.equal(setupOutcome, 'Injected workspace state commit failure')
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a server started by Start Agent Server while a failed Devin setup's take-back still waits on storage after its command answered is not marked from the receipts that held take-back has not removed yet, so it refuses the Devin bridge until the take-back's own descriptor step decides; fails_when=the start's queue turn sets the in-memory mark from its read of the receipts (the take-back is not counted as taking the mark off), so the Devin bridge is served for a setup that is being taken back; why_new=only a removal is covered as the run that takes the mark off at a server start; seam=none; no_claim=the descriptor file's content while the take-back is held (its descriptor step rewrites it later); the earlier setup is put back first, the held stand-in entry removal stands for the stalled storage and deletes the receipt as the real one does, the server is the real one
test("Start Agent Server while a failed setup's take-back waits on storage starts a server that refuses the Devin bridge", async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {
    savedSetup: true,
    realServer: true,
    holdEntryRemoval: true,
    removalDeletesReceipt: true,
  }
  const window = await devinWindow(context, options)
  try {
    await window.whenReconnected()
    // Armed after the reconnect's own skill check, so the re-run fails after its entry write and takes itself back.
    options.onSkillCheck = async (): Promise<void> => {
      options.onSkillCheck = undefined
      throw new Error('Injected skill check failure')
    }
    const setupOutcome = await within(
      window.commands.get('codebook.setupAiChat')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      16_000,
    )
    await window.commands.get('codebook.stopAgentServer')!()
    // Act
    const startOutcome = await within(
      window.commands.get('codebook.startAgentServer')!().then(
        () => 'started',
        (error: Error) => error.message,
      ),
      5_000,
    )
    const statusWhileHeld = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    window.holds.entryRemoval.release()
    await waitUntil(
      () =>
        window.outputLines.includes(
          "Codebook's take-back of this Devin Desktop setup ended now that storage answered, so Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup run again in this window.",
        ),
      "the take-back's end",
    )
    // Assert
    assert.equal(
      setupOutcome,
      "Injected skill check failure Codebook's take-back of this Devin Desktop setup is still waiting on storage (MCP entry) after 10 seconds; it finishes when storage answers, and Codebook's Output says when. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
    )
    assert.equal(startOutcome, 'started')
    assert.equal(statusWhileHeld, 403)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed first Devin setup whose descriptor rewrite waits on storage answers within the budget, refuses the Devin bridge meanwhile and leaves the descriptor and the served token as they are until the write lands, then rotates the token, so a bridge with the old token is refused (Cycle 0146 task 1a, v2 finding 12); fails_when=the command waits for the write for ever, the server switches token before the descriptor carries the new one, or the old token is still served afterwards; no_claim=a removal's unmark (the removal tests); the held stand-in rewrite runs the real one once released, the server is the real one
test('a failed first Devin setup whose descriptor unmark waits on storage keeps the old token until the write lands, then rotates it', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    realServer: true,
    failSetupCommit: true,
    holdDescriptorUnmark: true,
  })
  try {
    const setup = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.descriptorUnmark.reachedAtMs(),
      "the take-back's descriptor unmark",
    )
    const descriptorFile = await window.descriptorPath()
    const descriptorWhileHeld = await readFile(descriptorFile, 'utf8')
    const oldToken: string = JSON.parse(descriptorWhileHeld).token
    const setupOutcome = await within(setup, 16_000)
    const statusAfterAnswer = await postInitialize(descriptorFile, true)
    const descriptorAfterAnswer = await readFile(descriptorFile, 'utf8')
    // Act
    window.holds.descriptorUnmark.release()
    await waitUntil(
      async () =>
        JSON.parse(await readFile(descriptorFile, 'utf8')).token !== oldToken,
      'the rotated token in the descriptor',
    )
    const rotatedDescriptor = JSON.parse(await readFile(descriptorFile, 'utf8'))
    const withOldToken = await postInitialize(descriptorFile, false, oldToken)
    const withNewToken = await postInitialize(descriptorFile, false)
    // Assert
    assert.equal(
      setupOutcome,
      "Injected workspace state commit failure Codebook's take-back of this Devin Desktop setup is still waiting on storage (descriptor) after 10 seconds; it finishes when storage answers, and Codebook's Output says when. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
    )
    assert.equal(statusAfterAnswer, 403)
    assert.equal(descriptorAfterAnswer, descriptorWhileHeld)
    assert.equal(rotatedDescriptor.devinChat, undefined)
    assert.deepEqual([withOldToken, withNewToken], [401, 200])
  } finally {
    await window.loaded.deactivate()
  }
})

/** The removal steps a test holds, with the harness option and hold of each and what the removal's warning names as done while that step waits. */
const REMOVAL_HOLD_CASES = [
  {
    step: 'skill',
    option: 'holdSkillRemoval',
    hold: 'skillRemoval',
    doneSentences: (): string[] => [],
  },
  {
    step: 'MCP entry',
    option: 'holdEntryRemoval',
    hold: 'entryRemoval',
    doneSentences: (): string[] => [
      'Codebook removed its Devin Desktop skill.',
    ],
  },
  {
    step: 'saved setup',
    option: 'holdSavedSetupWrite',
    hold: 'savedSetupWrite',
    doneSentences: (configPath: string): string[] => [
      'Codebook removed its Devin Desktop skill.',
      `Codebook removed its codebook entry from ${configPath} and kept the file's other entries.`,
    ],
  },
  {
    step: 'descriptor',
    option: 'holdDescriptorUnmark',
    hold: 'descriptorUnmark',
    doneSentences: (configPath: string): string[] => [
      'Codebook removed its Devin Desktop skill.',
      `Codebook removed its codebook entry from ${configPath} and kept the file's other entries.`,
    ],
  },
] as const

for (const holdCase of REMOVAL_HOLD_CASES) {
  // Value: protects=a Remove Devin Desktop Setup whose step waits on storage answers within the removal budget with a warning that names only the changes made so far and the step that waits, offers no reload, refuses a setup and a second removal meanwhile (the second removal before its question), holds the setup lock until its last step, and shows its own notice with Reload Window once storage answers (Cycle 0146 task 1a, v2 finding 11; /ship pass 1, specialist testing 3); fails_when=the removal waits for ever, its warning claims a change that has not happened (the skill case names no entry), it offers a reload too early, a setup joins it, a second removal asks its question again, or another window's setup runs before the removal's last step; no_claim=a removal whose step fails (a refusal); a stand-in step held at a gate stands for the stalled storage, and both windows share one extension host and one storage folder
  test(`a Devin removal whose ${holdCase.step} step waits on storage answers within the budget with only the changes made so far, then shows its own notice once storage answers`, async (context) => {
    // Arrange
    const first = await devinWindow(context, {
      savedSetup: true,
      confirmRemoval: true,
      [holdCase.option]: true,
    })
    let hadRemovalEndedWhenSecondStarted: boolean | undefined
    const second = await devinWindow(context, {
      storageDirectory: first.directory,
      instanceLabel: 'second',
      onResolveNode: (): void => {
        hadRemovalEndedWhenSecondStarted = first.notices.some((notice) =>
          notice.actions.includes('Reload Window'),
        )
      },
    })
    try {
      await first.whenReconnected()
      await waitUntil(
        async () => (await first.readDescriptorField()) === true,
        "the reconnect's marked descriptor",
      )
      // Act
      const removalAnswer = await within(
        first.commands.get('codebook.removeManagedDevinSetup')!().then(() =>
          performance.now(),
        ),
        16_000,
      )
      const stepReachedAtMs = first.holds[holdCase.hold].reachedAtMs()
      const noticesWhileWaiting = structuredClone(first.notices)
      const setupRefusal = await within(
        first.commands.get('codebook.setupAiChat')!().then(
          () => 'resolved',
          (error: Error) => error.message,
        ),
        2_000,
      )
      const secondRemovalRefusal = await within(
        first.commands.get('codebook.removeManagedDevinSetup')!().then(
          () => 'resolved',
          (error: Error) => error.message,
        ),
        2_000,
      )
      const secondSetup = second.commands.get('codebook.setupAiChat')!()
      // Without the lock the second window's first step follows within milliseconds; half a second without it shows it waits.
      await assert.rejects(
        waitUntil(
          () => second.steps.length > 0,
          "the second window's setup to start while the removal holds the lock",
          500,
        ),
        {
          message:
            "Timed out waiting for the second window's setup to start while the removal holds the lock",
        },
      )
      first.holds[holdCase.hold].release()
      await waitUntil(
        () => first.notices.length === 2,
        "the removal's own notice",
      )
      await secondSetup
      // Assert
      assert.ok(removalAnswer !== 'still waiting', 'the removal answered')
      assert.ok(stepReachedAtMs !== undefined, 'the held step was reached')
      const answeredAfterMs = removalAnswer - stepReachedAtMs
      assert.ok(
        answeredAfterMs >= 9_000 && answeredAfterMs <= 15_000,
        `the removal answered ${answeredAfterMs} ms after its ${holdCase.step} step was reached`,
      )
      assert.deepEqual(noticesWhileWaiting, [
        {
          severity: 'warning',
          message: [
            ...holdCase.doneSentences(first.configPath),
            `Codebook's removal of the Devin Desktop setup is still waiting on storage (${holdCase.step}) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.`,
          ].join(' '),
          actions: [],
        },
      ])
      assert.equal(
        setupRefusal,
        'Codebook is still removing the Devin Desktop setup because storage does not answer. Run Codebook: Set Up AI Chat again once it finishes, or reload the window.',
      )
      // The second removal refuses before its question: only the first one asked.
      assert.equal(
        secondRemovalRefusal,
        'Codebook is still removing the Devin Desktop setup because storage does not answer. Run Codebook: Remove Devin Desktop Setup again once it finishes, or reload the window.',
      )
      assert.equal(first.modalQuestions.length, 1)
      assert.deepEqual(first.notices[1], {
        severity: 'information',
        message: `Codebook removed its Devin Desktop skill. Codebook removed its codebook entry from ${first.configPath} and kept the file's other entries. Reload this window so Devin Local stops Codebook's MCP server. Codebook: Set Up AI Chat installs the skill and the entry again.`,
        actions: ['Reload Window'],
      })
      assert.equal(first.state.get('codebook.aiChatSetup'), undefined)
      assert.equal(await first.readDescriptorField(), undefined)
      assert.equal(hadRemovalEndedWhenSecondStarted, true)
      assert.deepEqual(second.steps, [
        'resolve Node',
        'deploy Devin skill',
        'start server',
        'write MCP entry',
        'verify Devin skill',
      ])
    } finally {
      await first.loaded.deactivate()
      await second.loaded.deactivate()
    }
  })
}

// Value: protects=a Devin setup whose first read of the installation id never returns ends 3 seconds after that read started with the retry sentence, and takes back what it saved (the saved setup and the entry it installed), so a stalled disk never holds the setup lock before the commit (Cycle 0146 task 1b); fails_when=the setup waits on that read for ever, or ends without taking the entry and the saved setup back; no_claim=a read that answers late (it is not waited for); a stand-in read held at a gate stands for the stalled disk
test('a Devin setup whose first installation-id read never returns ends within 3 s and takes back what it saved', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    hangFirstInstallationRead: true,
  })
  try {
    // Act
    const setupEnd = window.commands.get('codebook.setupAiChat')!().then(
      () => ({ atMs: performance.now(), message: 'resolved' }),
      (error: Error) => ({ atMs: performance.now(), message: error.message }),
    )
    const readStartedAtMs = await waitUntil(
      () => window.holds.firstInstallationRead.reachedAtMs(),
      'the first read of the installation id',
    )
    const setupOutcome = await within(setupEnd, 8_000)
    // Assert
    assert.ok(setupOutcome !== 'still waiting', 'the setup command answered')
    const answeredAfterMs = setupOutcome.atMs - readStartedAtMs
    assert.ok(
      answeredAfterMs >= 2_900 && answeredAfterMs <= 5_000,
      `the setup answered ${answeredAfterMs} ms after the read started`,
    )
    assert.equal(
      setupOutcome.message,
      'Codebook could not read its setup records just now; run Codebook: Set Up AI Chat again.',
    )
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    assert.deepEqual(window.steps.slice(-1), ['remove MCP entry'])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window whose receipts read at its first server start answers only after the start's 5-second budget publishes its descriptor unmarked, then marks it once that read settled and a fresh read finds the setup standing, and offers Reload Window once (Cycle 0146 task 1c); fails_when=the late answer changes nothing, so the descriptor stays unmarked and Devin Local never connects, or the reload is offered twice; no_claim=a read that is between two retries at the deadline (no read to wait for, unchanged); the stand-in read waits at its gate until the test saw the unmarked descriptor, the next read is the real one
test('a Devin Desktop window whose first receipts read answers after the start budget marks its descriptor then and offers Reload Window once', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    holdReceiptReadAt: 1,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    const fieldAtPublication = await window.readDescriptorField()
    // Act
    window.holds.receiptRead.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision",
      15_000,
    )
    const fieldAfterLateMark = await window.readDescriptorField()
    // A stop queues behind every descriptor change, so a second offer would be shown before it ends.
    await window.commands.get('codebook.stopAgentServer')!()
    // Assert
    assert.equal(fieldAtPublication, undefined)
    assert.deepEqual(window.lateMarkDecisions, [true])
    assert.equal(fieldAfterLateMark, true)
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          'Codebook marked this window for Devin Desktop after storage answered late. Reload this window so Devin Local connects.',
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=after Stop and Start Agent Server, a restarted Devin Desktop server whose receipts read answers only after the start budget is marked once that read settled, and the window offers Reload Window once, although no restart offer came for the unmarked descriptor (Cycle 0146 task 1c); fails_when=the restarted window stays unmarked and offers no reload, or offers two; no_claim=the first start (the test above); the second read waits at its gate until the test saw the unmarked descriptor, the other reads are the real ones
test('a restarted Devin Desktop server whose receipts read answers after the start budget is marked then and offers Reload Window once', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    holdReceiptReadAt: 2,
  })
  try {
    await waitUntil(
      async () =>
        (await window.descriptorReadable()) &&
        (await window.readDescriptorField()) === true,
      "the reconnect's marked descriptor",
    )
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    const fieldAtRestart = await window.readDescriptorField()
    // Act
    window.holds.receiptRead.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the restarted server's late mark decision",
      15_000,
    )
    const fieldAfterLateMark = await window.readDescriptorField()
    // A stop queues behind every descriptor change, so a second offer would be shown before it ends.
    await window.commands.get('codebook.stopAgentServer')!()
    // Assert
    assert.equal(fieldAtRestart, undefined)
    assert.deepEqual(window.lateMarkDecisions, [true])
    assert.equal(fieldAfterLateMark, true)
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          'Codebook marked this window for Devin Desktop after storage answered late. Reload this window so Devin Local connects.',
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a late receipts read that saw the setup standing, whose fresh read finds the setup removed (another window removed the entry record meanwhile), leaves the running window unmarked and shows no notice (Cycle 0146 task 1c); fails_when=the late mark trusts the old read, or offers a reload for a removed setup; no_claim=the removal command of this window; the stand-in read reads the installed records, waits at its gate until the test removed the receipt, then answers what it read; the fresh read is the real one, and the decision is read while the server still runs
test('a Devin Desktop window whose late receipts read finds the setup removed stays unmarked and offers nothing', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    holdReceiptReadAt: 1,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    await waitUntil(
      () => window.holds.receiptRead.reachedAtMs(),
      'the late receipts read',
    )
    // Act
    await rm(join(window.directory, 'devin-mcp/receipt.json'))
    window.holds.receiptRead.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision",
      15_000,
    )
    const fieldAfterDecision = await window.readDescriptorField()
    // Assert
    assert.deepEqual(window.lateMarkDecisions, [false])
    assert.equal(fieldAfterDecision, undefined)
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a late Devin mark whose descriptor rewrite fails is handled: one Output line says the window could not be marked, the window stays unmarked (its server refuses the Devin bridge, the descriptor carries no mark) and no Reload Window is offered; fails_when=the rejection escapes unhandled, or the window is marked in memory or offered a reload for a descriptor that was never marked; why_new=no test makes the late mark's write fail; seam=none; no_claim=the line's wording past its prefix; the first receipts read waits at its gate until the unmarked descriptor is published, the stand-in rewrite that sets the mark throws, the server is the real one
test('a late Devin mark whose descriptor rewrite fails writes one Output line, stays unmarked and offers no reload', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    realServer: true,
    holdReceiptReadAt: 1,
    failDescriptorMark: true,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    // Act
    window.holds.receiptRead.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision",
      15_000,
    )
    const statusAfterDecision = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    // Assert
    assert.deepEqual(window.lateMarkDecisions, [
      'Injected descriptor mark failure',
    ])
    assert.equal(
      window.outputLines.filter((line) =>
        line.startsWith(
          'Codebook could not mark this window for Devin Desktop after storage answered late: ',
        ),
      ).length,
      1,
    )
    assert.equal(await window.readDescriptorField(), undefined)
    assert.equal(statusAfterDecision, 403)
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a late receipts read of a server that was stopped and replaced before the read settled leaves the new server's descriptor and notices as they are: its continuation, held until the new server's marked descriptor was captured, writes nothing (the file keeps its bytes and its inode) and decides `false`, and only the new server's restart offer is shown (Cycle 0146 task 1c; /ship pass 1, specialist testing 2 and Codex structured P2 at this test); fails_when=the late continuation marks or rewrites the new server's descriptor (also with identical bytes, which the rename of a rewrite gives a new inode), offers a second reload, or decides only after the assertions ran; no_claim=the new server's own late read (none here); the stand-in first read waits 5.5 s and then has no answer, the held continuation runs the real one once released, the other reads are the real ones
test("a late receipts read of a replaced Devin Desktop server leaves the new server's mark and notices as they are", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    receiptReadDelaysMs: [5_500],
    holdLateMark: true,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    const newDescriptorFile = await window.descriptorPath()
    const newDescriptorText = await readFile(newDescriptorFile, 'utf8')
    const { ino: newDescriptorInode } = await stat(newDescriptorFile, {
      bigint: true,
    })
    await waitUntil(
      () => window.notices.length > 0,
      "the new server's restart offer",
    )
    await waitUntil(
      () => window.holds.lateMark.reachedAtMs(),
      "the first server's late continuation, held before it reads afresh",
    )
    // Act
    window.holds.lateMark.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the first server's late mark decision",
    )
    const descriptorTextAfterDecision = await readFile(
      newDescriptorFile,
      'utf8',
    )
    const { ino: inodeAfterDecision } = await stat(newDescriptorFile, {
      bigint: true,
    })
    // A stop queues behind every descriptor change, so a second offer would be shown before it ends.
    await window.commands.get('codebook.stopAgentServer')!()
    // Assert
    assert.equal(JSON.parse(newDescriptorText).devinChat, true)
    assert.deepEqual(window.lateMarkDecisions, [false])
    assert.equal(descriptorTextAfterDecision, newDescriptorText)
    assert.equal(inodeAfterDecision, newDescriptorInode)
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

// Value: protects=a late mark whose descriptor write lands after this window's removal took the in-memory mark off leaves the mark off, so the server keeps refusing the Devin bridge while the removal still waits on storage, and the late mark offers no Reload Window (Cycle 0146 task 17); fails_when=the late mark turns the in-memory mark back on once its write lands, so the Devin bridge is served for a setup that is being removed; no_claim=the descriptor file while the removal waits (the removal's own unmark rewrites it later) and a take-back that takes the mark off; the late read, the late mark's rewrite and the removal's saved-setup clear wait at gates the test opens, the server is the real one
test("a late Devin mark whose descriptor write lands after this window's removal began keeps refusing the Devin bridge and offers no reload", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    realServer: true,
    confirmRemoval: true,
    holdReceiptReadAt: 1,
    holdDescriptorRewrite: true,
    holdSavedSetupWrite: true,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    window.holds.receiptRead.release()
    const lateRewrite = await within(window.rewriteReached, 15_000)
    // Act
    const removal = window.commands.get(
      'codebook.removeManagedDevinSetup',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      "the removal's saved-setup clear, after its entry step",
    )
    window.releaseRewrite()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision",
    )
    const statusWhileRemoving = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    window.holds.savedSetupWrite.release()
    const removalOutcome = await within(removal, 15_000)
    // Assert
    assert.notEqual(lateRewrite, 'still waiting')
    assert.equal(statusWhileRemoving, 403)
    assert.deepEqual(window.lateMarkDecisions, [false])
    assert.equal(removalOutcome, 'resolved')
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

// Value: protects=a Devin server start whose mark was decided before this window's removal took the in-memory mark off leaves the mark off once its descriptor is written, so the restarted server refuses the Devin bridge while the removal still waits on storage (Cycle 0146 task 17); fails_when=the start's queue turn sets the in-memory mark from its earlier decision, so the Devin bridge is served for a setup that is being removed; no_claim=the descriptor file while the removal waits (the removal's own unmark rewrites it later); the restart's receipts read reads the installed records and waits until the removal's entry step ran, the removal's saved-setup clear waits at its gate, the server is the real one
test("a Devin server start whose mark was decided before this window's removal took it off keeps refusing the Devin bridge", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    realServer: true,
    confirmRemoval: true,
    holdSavedSetupWrite: true,
  })
  try {
    await window.whenReconnected()
    await window.commands.get('codebook.stopAgentServer')!()
    window.armReceiptsHold()
    const restart = window.commands.get('codebook.startAgentServer')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.hasReceiptsReached(),
      "the restart's receipts read",
    )
    // Act
    const removal = window.commands.get(
      'codebook.removeManagedDevinSetup',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      "the removal's saved-setup clear, after its entry step",
    )
    window.releaseReceipts()
    const restartOutcome = await within(restart, 15_000)
    const statusWhileRemoving = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    window.holds.savedSetupWrite.release()
    const removalOutcome = await within(removal, 15_000)
    // Assert
    assert.equal(restartOutcome, 'resolved')
    assert.equal(statusWhileRemoving, 403)
    assert.equal(removalOutcome, 'resolved')
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=Devin Local is refused (403) while the removal's saved-setup or descriptor step waits: Remove Devin Desktop Setup takes the window's in-memory mark off right after its entry step, before the steps that wait on storage; fails_when=the in-memory mark stays on until the descriptor step, so a removed entry is still served (200); why_new=the removal hold cases use no real server, and the late-mark and server-start tests get their 403 from other checks; seam=none; no_claim=the descriptor file while the clear waits; the removal's saved-setup clear waits at its gate, the server is the real one
test('a Devin removal whose saved-setup clear waits on storage refuses the Devin bridge once its entry step ended', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    realServer: true,
    confirmRemoval: true,
    holdSavedSetupWrite: true,
  })
  try {
    await window.whenReconnected()
    await waitUntil(
      async () => (await window.readDescriptorField()) === true,
      "the reconnect's marked descriptor",
    )
    const statusBeforeRemoval = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    // Act
    const removal = window.commands.get(
      'codebook.removeManagedDevinSetup',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      "the removal's saved-setup clear, after its entry step",
    )
    const statusWhileClearWaits = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    window.holds.savedSetupWrite.release()
    const removalOutcome = await within(removal, 15_000)
    // Assert
    assert.deepEqual([statusBeforeRemoval, statusWhileClearWaits], [200, 403])
    assert.equal(removalOutcome, 'resolved')
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=Remove Devin Desktop Setup takes the window's in-memory mark off as soon as it begins, so Devin Local is refused (403) while the removal's entry step still waits on storage, before or after the config change that step makes (/ship pass 1, Codex structured P1 at extension.ts:2074); fails_when=the mark stays on until the entry removal returned, so a connected bridge keeps using the server while the removal takes its entry out of the config; no_claim=the later steps (the saved-setup clear test above) and the descriptor file while the entry step waits; the held stand-in entry removal stands for the stalled storage, the server is the real one
test('a Devin removal whose entry removal waits on storage refuses the Devin bridge while it waits', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    realServer: true,
    confirmRemoval: true,
    holdEntryRemoval: true,
  })
  try {
    await window.whenReconnected()
    await waitUntil(
      async () => (await window.readDescriptorField()) === true,
      "the reconnect's marked descriptor",
    )
    const statusBeforeRemoval = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    // Act
    const removal = window.commands.get(
      'codebook.removeManagedDevinSetup',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.entryRemoval.reachedAtMs(),
      "the removal's entry step",
    )
    const statusWhileEntryWaits = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    window.holds.entryRemoval.release()
    const removalOutcome = await within(removal, 15_000)
    // Assert
    assert.deepEqual([statusBeforeRemoval, statusWhileEntryWaits], [200, 403])
    assert.equal(removalOutcome, 'resolved')
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a server started by Start Agent Server while this window's removal waits on storage, whose removal then refuses before it changed the setup (an edited skill), serves the Devin bridge again once the removal ended: the window syncs its mark again from the receipts that still stand (/ship pass 1, native adversarial 1 and Codex outside voice 3); fails_when=the start's queue turn leaves the in-memory mark off for the removal and nothing restores it once the removal ends before its own descriptor step, so Devin Local is refused (403) for a setup that stands until the next restart; no_claim=a removal refused by another window's lock or by a setup's background work (the same end before the descriptor step, not run here) and a Reload Window offer for the restarted server (none while the removal runs); the held stand-in skill removal stands for the stalled storage and then throws, the server is the real one
test('a Devin server started while a removal waits serves the Devin bridge again once that removal refused without changing the setup', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    realServer: true,
    confirmRemoval: true,
    holdSkillRemoval: true,
    failSkillRemoval: true,
  })
  try {
    await window.whenReconnected()
    await window.commands.get('codebook.stopAgentServer')!()
    const removal = window.commands.get(
      'codebook.removeManagedDevinSetup',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.skillRemoval.reachedAtMs(),
      "the removal's skill step",
    )
    const startOutcome = await within(
      window.commands.get('codebook.startAgentServer')!().then(
        () => 'started',
        (error: Error) => error.message,
      ),
      5_000,
    )
    const descriptorFile = await window.descriptorPath()
    const statusWhileRemoving = await postInitialize(descriptorFile, true)
    // Act
    window.holds.skillRemoval.release()
    const removalOutcome = await within(removal, 15_000)
    // The window's new sync is queued once the removal ended; its read is bounded by the mark read's budget, which this wait outlasts.
    const isServedAgain = await waitUntil(
      async () => (await postInitialize(descriptorFile, true)) === 200,
      'the Devin bridge served again after the refused removal',
      8_000,
    ).then(
      () => true,
      () => false,
    )
    // Assert
    assert.equal(startOutcome, 'started')
    assert.equal(statusWhileRemoving, 403)
    assert.equal(removalOutcome, 'Injected skill removal failure')
    assert.equal(isServedAgain, true)
    assert.equal(await window.readDescriptorField(), true)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a server started by Stop and Start Agent Server in the first seconds of a failed setup's take-back, before that take-back's command answered, refuses the Devin bridge and offers no Reload Window, although the earlier setup was put back first and the receipts the take-back is removing still stand (/ship pass 1, Codex outside voice 3 and Codex structured P1 at extension.ts:1380); fails_when=only a take-back whose command already answered counts as taking the mark off, so the start marks the window from those receipts and the Devin bridge is served (200) for an entry that is being taken back, or the restart offers a reload for it; no_claim=a start after the take-back's 10-second lapse (the Start Agent Server test above) and the descriptor file while the take-back is held (its descriptor step rewrites it later); the held stand-in entry removal stands for the stalled storage and deletes the receipt as the real one does, the server is the real one
test("Stop and Start Agent Server in a failed setup take-back's first seconds start a server that refuses the Devin bridge and offers no reload", async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {
    savedSetup: true,
    realServer: true,
    holdEntryRemoval: true,
    removalDeletesReceipt: true,
  }
  const window = await devinWindow(context, options)
  try {
    await window.whenReconnected()
    // Armed after the reconnect's own skill check, so the re-run fails after its entry write and takes itself back.
    options.onSkillCheck = async (): Promise<void> => {
      options.onSkillCheck = undefined
      throw new Error('Injected skill check failure')
    }
    let hasSetupAnswered = false
    const setup = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    void setup.then(() => {
      hasSetupAnswered = true
    })
    await waitUntil(
      () => window.holds.entryRemoval.reachedAtMs(),
      "the take-back's entry removal",
    )
    // Act
    await window.commands.get('codebook.stopAgentServer')!()
    const startOutcome = await within(
      window.commands.get('codebook.startAgentServer')!().then(
        () => 'started',
        (error: Error) => error.message,
      ),
      5_000,
    )
    const statusWhileTakingBack = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    const hadSetupAnsweredAtRequest = hasSetupAnswered
    window.holds.entryRemoval.release()
    const setupOutcome = await within(setup, 15_000)
    // Assert
    assert.equal(startOutcome, 'started')
    assert.equal(hadSetupAnsweredAtRequest, false)
    assert.equal(statusWhileTakingBack, 403)
    assert.equal(setupOutcome, 'Injected skill check failure')
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a late Devin mark whose fresh read is itself still in flight at its own start budget waits for that read too and reads afresh once it settled, so a window whose storage answers only after two budgets is still marked and offers Reload Window once (/ship pass 1, Codex outside voice 10); fails_when=the late mark takes the fresh read's missed deadline for an unmarked setup, so the window stays unmarked for the rest of its server's run although its setup stands; no_claim=a fresh read that gets no answer at all within its budget (no read is in flight then, and the mark gives up as before) and a stop meanwhile; the first stand-in read waits 5.5 s and then has no answer, the second reads the real records and waits at its gate until the test released it after that read's own budget passed, the later reads are the real ones
test('a late Devin mark whose fresh read also outlasts the start budget marks the window once that read answers and offers Reload Window once', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    receiptReadDelaysMs: [5_500],
    holdReceiptReadAt: 2,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    const fieldAtPublication = await window.readDescriptorField()
    const freshReadStartedAtMs = await waitUntil(
      () => window.holds.receiptRead.reachedAtMs(),
      "the late mark's fresh read",
      15_000,
    )
    // The fresh read's own budget is a production deadline; it has to pass before the read answers.
    await waitUntil(
      () =>
        performance.now() - freshReadStartedAtMs >=
        DEVIN_MARK_READ_RETRY_BUDGET_MS + 500,
      "the fresh read's own start budget",
      15_000,
    )
    // Act
    window.holds.receiptRead.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision",
      15_000,
    )
    const fieldAfterLateMark = await window.readDescriptorField()
    // A stop queues behind every descriptor change, so a second offer would be shown before it ends.
    await window.commands.get('codebook.stopAgentServer')!()
    // Assert
    assert.equal(fieldAtPublication, undefined)
    assert.deepEqual(window.lateMarkDecisions, [true])
    assert.equal(fieldAfterLateMark, true)
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          'Codebook marked this window for Devin Desktop after storage answered late. Reload this window so Devin Local connects.',
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin re-setup after Stop Agent Server whose own server start read answered after the start budget ends with one Reload Window, its own: the late mark finds the window already marked by the setup and writes and offers nothing (Cycle 0146 review round, ocr-lens1 P3); fails_when=the late mark rewrites the descriptor the setup marked and offers a second Reload Window; no_claim=a late read that settles while the setup still runs (the next test); the setup's server start read reads the real records and waits at its gate until the setup answered
test('a Devin re-setup whose server start read answers after the setup offers only its own Reload Window', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    holdReceiptReadAt: 2,
  })
  try {
    await window.whenReconnected()
    await window.commands.get('codebook.stopAgentServer')!()
    // Act
    const setupOutcome = await within(
      window.commands.get('codebook.setupAiChat')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      15_000,
    )
    window.holds.receiptRead.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision",
      15_000,
    )
    // Assert
    assert.equal(setupOutcome, 'resolved')
    assert.deepEqual(window.lateMarkDecisions, [false])
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          "Codebook skill and MCP server saved for Devin Local. Reload this window so Devin Local loads Codebook's MCP server, then type /devin:codebook in a Local session.",
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a late mark whose read settles while a Devin re-setup of this window still runs gives way to that setup: it writes and offers nothing, and the setup ends with one Reload Window, its own (Cycle 0146 review round, ocr-lens1 P3); fails_when=the late mark marks the descriptor in the middle of the setup and offers a second Reload Window; no_claim=a take-back of the setup (the setup succeeds here); the setup's server start read waits at its gate, which the skill check stand-in opens, and the stand-in waits for the late mark's decision before the setup goes on
test('a late Devin mark whose read settles while a re-setup still runs leaves the mark to the setup and offers no second reload', async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {
    savedSetup: true,
    holdReceiptReadAt: 2,
  }
  const window = await devinWindow(context, options)
  try {
    await window.whenReconnected()
    await window.commands.get('codebook.stopAgentServer')!()
    options.onSkillCheck = async (): Promise<void> => {
      options.onSkillCheck = undefined
      window.holds.receiptRead.release()
      await waitUntil(
        () => window.lateMarkDecisions.length > 0,
        "the late mark's decision during the setup",
      )
    }
    // Act
    const setupOutcome = await within(
      window.commands.get('codebook.setupAiChat')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      20_000,
    )
    // Assert
    assert.equal(setupOutcome, 'resolved')
    assert.deepEqual(window.lateMarkDecisions, [false])
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          "Codebook skill and MCP server saved for Devin Local. Reload this window so Devin Local loads Codebook's MCP server, then type /devin:codebook in a Local session.",
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed Devin setup re-run whose window changed its workspace folder after the run began, and before the failure, leaves no saved setup of the folder that closed, and the Output says why (Cycle 0146 task 6); fails_when=the take-back writes the old folder's setup back over the folder change's clear; no_claim=a folder change after the take-back's restore started (the next test); the skill check stand-in, armed after the reconnect at activation, changes the folder as the editor does and then fails
test('a failed Devin setup re-run whose folder changed after it began leaves no saved setup of the old folder', async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = { savedSetup: true }
  const window = await devinWindow(context, options)
  try {
    await window.whenReconnected()
    let savedWhenFolderChanged: unknown
    options.onSkillCheck = async (): Promise<void> => {
      options.onSkillCheck = undefined
      savedWhenFolderChanged = window.state.get('codebook.aiChatSetup')
      window.changeFolder('/other/folder')
      throw new Error('Injected skill check failure')
    }
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(setupOutcome, 'Injected skill check failure')
    assert.deepEqual(savedWhenFolderChanged, {
      workspace: window.directory,
      provisional: true,
      previous: { workspace: window.directory },
    })
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    assert.equal(
      window.outputLines.includes(
        "Codebook did not put back this window's earlier Devin Desktop setup because the folder changed.",
      ),
      true,
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a folder change that comes while a failed Devin setup's restore of the earlier saved setup is being written still ends with no saved setup, because the folder change's clear lands after that restore (Cycle 0146 task 6, v2 finding 8); fails_when=the clear lands first and the held restore writes the old folder's setup back last; no_claim=a folder change before the restore started (the test above); the held stand-in write stands for a slow editor storage
test("a folder change while a failed Devin setup's restore is written leaves no saved setup", async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {
    savedSetup: true,
    holdSavedSetupWrite: true,
  }
  const window = await devinWindow(context, options)
  try {
    await window.whenReconnected()
    options.onSkillCheck = async (): Promise<void> => {
      options.onSkillCheck = undefined
      throw new Error('Injected skill check failure')
    }
    const setup = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      "the take-back's restore of the saved setup",
    )
    // Act
    window.changeFolder('/other/folder')
    window.holds.savedSetupWrite.release()
    const setupOutcome = await within(setup, 15_000)
    // Assert
    assert.equal(setupOutcome, 'Injected skill check failure')
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed Devin setup re-run in the same folder, whose entry write found the earlier setup's entry unchanged, still puts back the setup saved before it, keeps that entry and writes no folder line (Cycle 0146 task 6 guard); fails_when=the folder check clears the earlier setup although no folder changed, or the take-back removes an entry it did not install; no_claim=the folder change cases above; the skill check stand-in is armed after the reconnect at activation
test('a failed Devin setup re-run without a folder change puts back the setup saved before it', async (context) => {
  // Arrange
  // The re-run finds the entry of the earlier setup unchanged, as a re-run in the same folder does.
  const options: Parameters<typeof devinWindow>[1] = {
    savedSetup: true,
    entryWrite: 'current',
  }
  const window = await devinWindow(context, options)
  try {
    await window.whenReconnected()
    options.onSkillCheck = async (): Promise<void> => {
      options.onSkillCheck = undefined
      throw new Error('Injected skill check failure')
    }
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(setupOutcome, 'Injected skill check failure')
    assert.deepEqual(window.state.get('codebook.aiChatSetup'), {
      workspace: window.directory,
    })
    assert.equal(window.steps.includes('remove MCP entry'), false)
    assert.equal(
      window.outputLines.includes(
        "Codebook did not put back this window's earlier Devin Desktop setup because the folder changed.",
      ),
      false,
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin setup whose skill deployment never returns answers within the setup budget with the step that waits, a Remove Devin Desktop Setup issued meanwhile refuses at once without its question, and the setup's own notice with Reload Window follows once storage answers (Cycle 0146 task 13); fails_when=the command waits for the deployment for ever, the removal waits for the setup or asks its question, or the setup's end is never shown; no_claim=a forward step that fails after it answered (its warning); the held stand-in deployment stands for the stalled storage
test('a Devin setup whose skill deployment never returns answers within the budget, a removal meanwhile refuses, and its own notice follows once storage answers', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    holdDeploy: true,
    confirmRemoval: true,
  })
  try {
    // Act
    const setupEnd = window.commands.get('codebook.setupAiChat')!().then(
      () => ({ atMs: performance.now(), message: 'resolved' }),
      (error: Error) => ({ atMs: performance.now(), message: error.message }),
    )
    // A setup that fails before its deployment ends the race too, so the test fails in its assertion instead of waiting.
    const deployReachedAtMs = await within(
      Promise.race([
        window.deployReached.then(() => performance.now()),
        setupEnd.then(() => 'setup ended first'),
      ]),
      5_000,
    )
    const setupOutcome = await within(setupEnd, 16_000)
    const removalRefusal = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      2_000,
    )
    window.releaseDeploy()
    await waitUntil(() => window.notices.length > 0, "the setup's own notice")
    // Assert
    assert.ok(
      typeof deployReachedAtMs === 'number',
      'the setup reached its deployment',
    )
    assert.ok(setupOutcome !== 'still waiting', 'the setup command answered')
    const answeredAfterMs = setupOutcome.atMs - deployReachedAtMs
    assert.ok(
      answeredAfterMs >= 9_000 && answeredAfterMs <= 15_000,
      `the setup command answered ${answeredAfterMs} ms after the deployment was reached`,
    )
    assert.equal(
      setupOutcome.message,
      "Codebook's Devin Desktop setup is still waiting on storage (skill) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
    )
    assert.equal(
      removalRefusal,
      'Codebook is still setting up Devin Desktop because storage does not answer. Run Codebook: Remove Devin Desktop Setup again once it finishes, or reload the window.',
    )
    assert.deepEqual(window.modalQuestions, [])
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          "Codebook skill and MCP server saved for Devin Local. Reload this window so Devin Local loads Codebook's MCP server, then type /devin:codebook in a Local session.",
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

/** The forward setup steps a test holds on storage, with the name the test's title gives the held step, the harness option and hold of each and the sentence the setup command answers while it waits. */
const FORWARD_WRITE_HOLD_CASES = [
  {
    name: 'saved setup write',
    option: 'holdSavedSetupWrite',
    hold: 'savedSetupWrite',
    pendingSentence:
      "Codebook's Devin Desktop setup is still waiting on storage (saved setup) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
  },
  {
    name: 'descriptor write',
    option: 'holdDescriptorMark',
    hold: 'descriptorMark',
    pendingSentence:
      "Codebook's Devin Desktop setup is still waiting on storage (descriptor) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
  },
  {
    name: 'MCP entry write',
    option: 'holdEntryWrite',
    hold: 'entryWrite',
    pendingSentence:
      "Codebook's Devin Desktop setup is still waiting on storage (MCP entry) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
  },
  {
    name: 'provisional saved setup write',
    option: 'holdProvisionalSave',
    hold: 'provisionalSave',
    pendingSentence:
      "Codebook's Devin Desktop setup is still waiting on storage (saved setup) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
  },
  {
    name: 'final skill check',
    option: 'holdSkillCheck',
    hold: 'skillCheck',
    pendingSentence:
      "Codebook's Devin Desktop setup is still waiting on storage (skill) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
  },
  {
    name: "server start's descriptor publish",
    option: 'holdDescriptorPublish',
    hold: 'descriptorPublish',
    pendingSentence:
      "Codebook's Devin Desktop setup is still waiting on storage (descriptor) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
  },
] as const

for (const holdCase of FORWARD_WRITE_HOLD_CASES) {
  // Value: protects=a Devin setup whose forward step never returns (the server start's descriptor publish, the entry write, the provisional save, the final skill check, the descriptor's mark or the committed saved setup) answers within the setup budget naming that step, goes on under the setup lock, and shows its own notice with Reload Window once storage answers, with the setup saved and the descriptor marked (Cycle 0146 task 14; the publish, entry, provisional and skill check cases Cycle 0146 /ship Step 7); fails_when=a step runs outside its budget, so the command waits for that step for ever and the setup lock and a removal queued behind it wait with it; why_new=only the committed saved setup and the descriptor mark were held before; seam=none; no_claim=the skill deployment (its own test above) and the clear after a folder change (the folder tests below); a stand-in step held at a gate stands for the stalled storage, and the publish is the real write, held by a stand-in of the file module
  test(`a Devin setup whose ${holdCase.name} never returns answers within the budget and shows its own notice once storage answers`, async (context) => {
    // Arrange
    const window = await devinWindow(context, { [holdCase.option]: true })
    try {
      // Act
      const setupEnd = window.commands.get('codebook.setupAiChat')!().then(
        () => ({ atMs: performance.now(), message: 'resolved' }),
        (error: Error) => ({ atMs: performance.now(), message: error.message }),
      )
      const writeReachedAtMs = await waitUntil(
        () => window.holds[holdCase.hold].reachedAtMs(),
        `the setup's held ${holdCase.name}`,
      )
      const setupOutcome = await within(setupEnd, 16_000)
      window.holds[holdCase.hold].release()
      await waitUntil(() => window.notices.length > 0, "the setup's own notice")
      // Assert
      assert.ok(setupOutcome !== 'still waiting', 'the setup command answered')
      const answeredAfterMs = setupOutcome.atMs - writeReachedAtMs
      assert.ok(
        answeredAfterMs >= 9_000 && answeredAfterMs <= 15_000,
        `the setup command answered ${answeredAfterMs} ms after its ${holdCase.name} was reached`,
      )
      assert.equal(setupOutcome.message, holdCase.pendingSentence)
      assert.deepEqual(window.notices, [
        {
          severity: 'information',
          message:
            "Codebook skill and MCP server saved for Devin Local. Reload this window so Devin Local loads Codebook's MCP server, then type /devin:codebook in a Local session.",
          actions: ['Reload Window'],
        },
      ])
      assert.deepEqual(window.state.get('codebook.aiChatSetup'), {
        workspace: window.directory,
      })
      assert.equal(await window.readDescriptorField(), true)
    } finally {
      await window.loaded.deactivate()
    }
  })
}

// Value: protects=a Devin setup whose window changed its workspace folder while the setup's skill deployment waited starts no server, writes no entry and saves no setup for the folder now open, and answers that the setup did not complete for this folder; fails_when=the setup reads the folder only when its server starts, so the server, the entry, the descriptor's mark and the commit set up the folder the learner switched to and end with a ready notice (Cycle 0146 /ship pass 1, codex-structured extension.ts:1741); why_new=only folder changes during the commit and the lock's release were tested, after the server already served the folder the command ran in; seam=serverFollowsFolder, so the server serves the folder open when it starts; no_claim=a folder change during the lock's wait (the same check runs before the server start) and after the entry write (that check takes back what the setup saved); the held stand-in deployment stands for a slow storage
test('a Devin setup whose window changed its folder while the skill deployment waited sets up nothing for the folder now open', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    holdDeploy: true,
    serverFollowsFolder: true,
  })
  try {
    const setup = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await window.deployReached
    // Act
    window.changeFolder('/other/folder')
    window.releaseDeploy()
    const setupOutcome = await within(setup, 9_000)
    // Assert
    assert.equal(
      setupOutcome,
      'The workspace folder changed while Devin Desktop setup was finishing, so the setup did not complete for this folder. Run Codebook: Set Up AI Chat again.',
    )
    assert.deepEqual(window.steps, ['resolve Node', 'deploy Devin skill'])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin setup whose window changed its workspace folder while its commit was written, and whose clear of the saved setup for that change then never returns, answers within the setup budget naming the saved setup step, and once storage answers ends with the folder-change warning and no saved setup (Cycle 0146 task 28); fails_when=the folder check after the commit waits for that clear for ever, so the command never answers and the setup lock stays held; no_claim=the same check after the lock's release (it runs its clear under the same budget, not held here) and a clear that fails late; the hold, armed while the commit is written, stands for a storage that stops answering at the first clear after the commit (the folder change's own clear, which the setup's clear queues behind)
test('a Devin setup whose folder changed during its commit answers within the budget although clearing the saved setup never returns', async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {}
  options.onSetupCommit = async (window): Promise<void> => {
    options.onSetupCommit = undefined
    window.changeFolder('/other/folder')
    // Armed after the commit write passed its own hold check, so the first write held is a clear that comes after the commit.
    options.holdSavedSetupWrite = true
  }
  const window = await devinWindow(context, options)
  try {
    // Act
    const setupEnd = window.commands.get('codebook.setupAiChat')!().then(
      () => ({ atMs: performance.now(), message: 'resolved' }),
      (error: Error) => ({ atMs: performance.now(), message: error.message }),
    )
    const clearReachedAtMs = await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      'the held clear of the saved setup after the folder change',
    )
    const setupOutcome = await within(setupEnd, 16_000)
    window.holds.savedSetupWrite.release()
    // A command that never answered shows no late warning: the wait ends at once, and the first assertion says why.
    await waitUntil(
      () => setupOutcome === 'still waiting' || window.notices.length > 0,
      "the setup's late failure warning",
    )
    // Assert
    assert.ok(setupOutcome !== 'still waiting', 'the setup command answered')
    const answeredAfterMs = setupOutcome.atMs - clearReachedAtMs
    assert.ok(
      answeredAfterMs >= 9_000 && answeredAfterMs <= 15_000,
      `the setup command answered ${answeredAfterMs} ms after the clear of the saved setup was reached`,
    )
    assert.equal(
      setupOutcome.message,
      "Codebook's Devin Desktop setup is still waiting on storage (saved setup) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
    )
    assert.deepEqual(window.notices, [
      {
        severity: 'warning',
        message:
          'The workspace folder changed while Devin Desktop setup was finishing, so the setup did not complete for this folder. Run Codebook: Set Up AI Chat again.',
        actions: [],
      },
    ])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Remove Devin Desktop Setup confirmed while a setup's skill deployment still waits, before that step's 10-second lapse, answers within about 12 seconds that Codebook is still setting up Devin Desktop, removes nothing, and the setup still ends with its own ready notice once storage answers (Cycle 0146 task 15); fails_when=the removal goes on to the setup lock once the setup's command answered early, so it waits behind that setup and ends after about 25 seconds with the sentence that another window is changing the setup, or its removal flag makes the background setup fail; no_claim=a removal whose question is still open at the lapse (the same check runs after the question; the harness answers the question at once); the held stand-in deployment stands for the stalled storage
test("a Devin removal confirmed while a setup's step still waits refuses with the setting-up sentence once that step waited 10 seconds", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    holdDeploy: true,
    confirmRemoval: true,
  })
  try {
    const setupEnd = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // A setup that fails before its deployment ends the race too, so the test fails in its assertion instead of waiting.
    const deployOutcome = await within(
      Promise.race([window.deployReached.then(() => 'reached'), setupEnd]),
      5_000,
    )
    // Act
    const removalStartedAtMs = performance.now()
    const removalOutcome = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => ({ atMs: performance.now(), message: 'resolved' }),
        (error: Error) => ({ atMs: performance.now(), message: error.message }),
      ),
      16_000,
    )
    const setupOutcome = await within(setupEnd, 1_000)
    window.releaseDeploy()
    await waitUntil(() => window.notices.length > 0, "the setup's own notice")
    // Assert
    assert.equal(deployOutcome, 'reached')
    assert.ok(removalOutcome !== 'still waiting', 'the removal answered')
    const answeredAfterMs = removalOutcome.atMs - removalStartedAtMs
    assert.ok(
      answeredAfterMs <= 12_000,
      `the removal answered ${answeredAfterMs} ms after it was confirmed`,
    )
    assert.equal(
      removalOutcome.message,
      'Codebook is still setting up Devin Desktop because storage does not answer. Run Codebook: Remove Devin Desktop Setup again once it finishes, or reload the window.',
    )
    assert.equal(
      setupOutcome,
      "Codebook's Devin Desktop setup is still waiting on storage (skill) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
    )
    assert.deepEqual(window.modalQuestions, [
      "Remove the Codebook-owned Devin Desktop skill and Codebook's entry in Devin's MCP config? Every Devin Desktop window of this user shares them.",
    ])
    assert.equal(window.steps.includes('remove Devin skill'), false)
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          "Codebook skill and MCP server saved for Devin Local. Reload this window so Devin Local loads Codebook's MCP server, then type /devin:codebook in a Local session.",
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=after a removal refused because a setup of this window answered early while its skill deployment still waits, that setup's background state stands: Set Up AI Chat and a second Remove Devin Desktop Setup still refuse at once with the setting-up sentence, the second asks no question, and the Output says the setup ended only once storage answered (Cycle 0146 task 15); fails_when=the removal's own end clears the setup's background state and writes its end line, so a later command waits for the setup lock instead of refusing; no_claim=the removal's own answer (the test above); the held stand-in deployment stands for the stalled storage
test("a Devin removal that refused while a setup still runs leaves that setup's refusal of further commands in place", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    holdDeploy: true,
    confirmRemoval: true,
  })
  const setupEndedLine =
    "Codebook's Devin Desktop setup ended now that storage answered, so Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup run again in this window."
  try {
    const setupEnd = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    const deployOutcome = await within(
      Promise.race([window.deployReached.then(() => 'reached'), setupEnd]),
      5_000,
    )
    // A removal that waits for the setup lock ends after about 25 seconds, so it is waited for that long before the commands below.
    const removalOutcome = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      30_000,
    )
    // Act
    // Each answer is waited for 2 seconds at most: a command that waits for the setup lock answers 'still waiting'.
    const setupRefusal = await within(
      window.commands.get('codebook.setupAiChat')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      2_000,
    )
    const secondRemovalRefusal = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      2_000,
    )
    const hadEndedLineWhileRunning = window.outputLines.includes(setupEndedLine)
    window.releaseDeploy()
    await waitUntil(() => window.notices.length > 0, "the setup's own notice")
    // Assert
    assert.equal(deployOutcome, 'reached')
    assert.equal(
      setupRefusal,
      'Codebook is still setting up Devin Desktop because storage does not answer. Run Codebook: Set Up AI Chat again once it finishes, or reload the window.',
    )
    assert.equal(
      secondRemovalRefusal,
      'Codebook is still setting up Devin Desktop because storage does not answer. Run Codebook: Remove Devin Desktop Setup again once it finishes, or reload the window.',
    )
    assert.equal(window.modalQuestions.length, 1)
    assert.equal(hadEndedLineWhileRunning, false)
    assert.equal(window.outputLines.includes(setupEndedLine), true)
    assert.equal(
      removalOutcome,
      'Codebook is still setting up Devin Desktop because storage does not answer. Run Codebook: Remove Devin Desktop Setup again once it finishes, or reload the window.',
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a change of the workspace's folders whose clear of the saved Devin setup waits on a storage that stops answering still stops the old folder's server and lets Codebook: Start Agent Server start one for the new folder, and the clear still lands once storage answers (Cycle 0146 task 16); fails_when=the handling of the folder change waits for that clear, so the old server keeps running and the new folder's start waits for ever; no_claim=the order of the clear after a take-back's restore (the restore test above) and the notice of a clear that fails (the next test); the held stand-in write stands for the stalled storage
test("a folder change whose clear of the saved Devin setup waits on storage still stops the old server and lets the new folder's server start", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    holdSavedSetupWrite: true,
  })
  try {
    await window.whenReconnected()
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
    )
    // Act
    window.changeFolder('/other/folder')
    await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      "the folder change's clear of the saved setup",
    )
    const startOutcome = await within(
      window.commands.get('codebook.startAgentServer')!().then(
        () => 'started',
        (error: Error) => error.message,
      ),
      5_000,
    )
    const descriptorsWhileHeld = await window.descriptorNames()
    const savedWhileHeld = window.state.get('codebook.aiChatSetup')
    window.holds.savedSetupWrite.release()
    await waitUntil(
      () => window.state.get('codebook.aiChatSetup') === undefined,
      "the folder change's clear of the saved setup to land",
    )
    // Assert
    assert.equal(startOutcome, 'started')
    assert.deepEqual(descriptorsWhileHeld, [
      `instance-2${CONNECTION_DESCRIPTOR_SUFFIX}`,
    ])
    assert.deepEqual(savedWhileHeld, { workspace: window.directory })
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a folder change whose clear of the saved Devin setup waits on storage and then fails still lets the new folder's server start meanwhile, and tells that late failure in a cleanup notice of its own once storage answered (Cycle 0146 task 16); fails_when=the late failure is lost because the handling's notice was already decided, or the handling waits for the clear; no_claim=a clear that fails at once (it joins the handling's one notice); the held stand-in write stands for the stalled storage, then fails
test('a folder change whose clear of the saved Devin setup fails after storage answered late tells that failure in its own notice', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    holdSavedSetupWrite: true,
    failHeldSavedSetupWrite: true,
  })
  try {
    await window.whenReconnected()
    window.changeFolder('/other/folder')
    await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      "the folder change's clear of the saved setup",
    )
    const startOutcome = await within(
      window.commands.get('codebook.startAgentServer')!().then(
        () => 'started',
        (error: Error) => error.message,
      ),
      5_000,
    )
    const noticesWhileHeld = structuredClone(window.notices)
    // Act
    window.holds.savedSetupWrite.release()
    await waitUntil(
      () => window.notices.length > 0,
      "the notice of the clear's late failure",
    )
    // Assert
    assert.equal(startOutcome, 'started')
    assert.deepEqual(noticesWhileHeld, [])
    assert.deepEqual(window.notices, [
      {
        severity: 'error',
        message:
          "Codebook did not finish its cleanup after the workspace's folders changed. The saved AI chat setup could not be cleared: Injected late workspace state write failure. It is still in use; run Codebook: Set Up AI Chat to replace it. Codebook goes on with new readers.",
        actions: [],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a folder change whose clear of the saved Devin setup fails at once tells that failure in the handling's one cleanup notice, first, before the failure of a step that ran after it; fails_when=the failure is dropped, it is told after the later step's failure, or it gets a notice of its own beside the handling's (two notices); why_new=only the late failure and the notice wording are tested; seam=none; no_claim=VS Code and Cursor windows, which share this path; the stand-in storage refuses the clear at once, and the stand-in Study reader's first dispose throws as the later failure
test('a folder change whose saved-setup clear fails at once tells it first in the one cleanup notice', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    failSetupClear: true,
    failStudyReaderDispose: true,
  })
  try {
    await window.whenReconnected()
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
    )
    // Act
    window.changeFolder('/other/folder')
    // Only the handling's own notice names the Study reader, and it is shown last: a notice of the clear alone would already be there.
    await waitUntil(
      () =>
        window.notices.some(({ message }) =>
          message.includes('The Study workspace could not be closed'),
        ),
      "the folder change's cleanup notice",
    )
    // Assert
    assert.deepEqual(window.notices, [
      {
        severity: 'error',
        message:
          "Codebook did not finish its cleanup after the workspace's folders changed. The saved AI chat setup could not be cleared: Injected workspace state write failure. It is still in use; run Codebook: Set Up AI Chat to replace it. The Study workspace could not be closed: Injected Study reader dispose failure. Codebook goes on with new readers. If a Codebook pane stayed open, close it by hand.",
        actions: [],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a folder removed and added again at the same path, while the folder change's clear of the saved Devin setup still waits on storage, starts its next server unmarked and offers no Reload Window, because the setup that clear takes away no longer counts for the folder now open; fails_when=the window reads the old folder's saved setup, which the editor still holds until the queued clear's turn, as the setup of the folder now open, so the new server is marked for Devin Local and offers a reload for a setup that is being cleared (Cycle 0146 /ship pass 1, adversarial-native P3 3); why_new=only a folder change to another path was held, where the saved workspace differs anyway; seam=none; no_claim=a clear that failed (the setup it could not clear then counts again, as the cleanup notice says); the held stand-in write stands for the stalled storage
test('a folder added again at the same path while its saved Devin setup is still being cleared starts its server unmarked and offers no reload', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    holdSavedSetupWrite: true,
  })
  try {
    await window.whenReconnected()
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
    )
    // The reconnect offered no notice; the window's notices start empty here.
    const noticesBefore = structuredClone(window.notices)
    window.changeFolder(window.directory)
    await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      "the folder change's clear of the saved setup",
    )
    // Act
    await window.commands.get('codebook.startAgentServer')!()
    // Assert
    assert.deepEqual(noticesBefore, [])
    assert.equal(await window.readDescriptorField(), undefined)
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Remove Devin Desktop Setup whose skill step waits on storage and then fails shows that failure as a warning once storage answers, as its pending warning promised that it shows its result, and the Output keeps its line (Cycle 0146 task 26); fails_when=the late failure only reaches the Output, so the learner never learns that the removal ended without removing anything; no_claim=a late success (the hold cases above) and a setup's late failure (its own warning); the held stand-in skill removal stands for the stalled storage, then throws
test('a Devin removal whose skill step waits on storage and then fails shows that failure as a warning once storage answers', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    confirmRemoval: true,
    holdSkillRemoval: true,
    failSkillRemoval: true,
  })
  try {
    await window.whenReconnected()
    const removalOutcome = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      16_000,
    )
    // Act
    window.holds.skillRemoval.release()
    await waitUntil(
      () => window.notices.length === 2,
      "the removal's late failure warning",
    )
    // Assert
    assert.equal(removalOutcome, 'resolved')
    assert.deepEqual(window.notices, [
      {
        severity: 'warning',
        message:
          "Codebook's removal of the Devin Desktop setup is still waiting on storage (skill) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
        actions: [],
      },
      {
        severity: 'warning',
        message: 'Injected skill removal failure',
        actions: [],
      },
    ])
    assert.equal(
      window.outputLines.includes(
        "Codebook's removal of the Devin Desktop setup ended after storage answered: Injected skill removal failure",
      ),
      true,
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin setup whose skill deployment waited on storage (its command answered) and whose later failure names an MCP receipt others can read, which its take-back then deletes while that take-back also waits on storage, ends with a warning that asks only for a setup retry (Cycle 0146 review round, CodeRabbit extension.ts:1629-1632); fails_when=the late warning asks the learner to make a deleted receipt private (mode 600); no_claim=a receipt that stays (the mode repair then stands), and Windows, where file modes do not apply; held stand-ins of the deployment and of the entry removal stand for the stalled storage, and the entry removal deletes the receipt as the real one does
test(
  'a Devin setup whose step and take-back both waited on storage asks only for a retry once that take-back deleted the receipt its failure named',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, {
      holdDeploy: true,
      receiptMode: 0o644,
      removalDeletesReceipt: true,
      holdEntryRemoval: true,
    })
    try {
      const setupOutcome = await within(
        window.commands.get('codebook.setupAiChat')!().then(
          () => 'resolved',
          (error: Error) => error.message,
        ),
        16_000,
      )
      // Act
      window.releaseDeploy()
      await waitUntil(
        () =>
          window.outputLines.includes(
            "Codebook's take-back of this Devin Desktop setup is still waiting on storage (MCP entry) after 10 seconds; it finishes when storage answers, and Codebook's Output says when. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
          ),
        "the take-back's lapse",
      )
      window.holds.entryRemoval.release()
      await waitUntil(
        () => window.notices.length > 0,
        "the setup's late failure warning",
      )
      // Assert
      assert.equal(
        setupOutcome,
        "Codebook's Devin Desktop setup is still waiting on storage (skill) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
      )
      assert.deepEqual(window.notices, [
        {
          severity: 'warning',
          message:
            'The Devin Desktop setup changed while this setup ran; run Codebook: Set Up AI Chat again.',
          actions: [],
        },
      ])
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// Value: protects=a failed Devin setup whose failure names an MCP receipt others can read, and whose take-back waits on storage, answers without that failure (the take-back deletes the receipt), and once storage answered shows a warning with what to do now: a setup retry, since the take-back deleted the receipt (Cycle 0146 review round, CodeRabbit extension.ts:1863); fails_when=the setup's end only reaches the Output, so the learner never reads why the setup failed; no_claim=a take-back whose answer named the failure (it only goes to the Output, the take-back tests above), and Windows, where file modes do not apply; the held stand-in entry removal stands for the stalled storage and deletes the receipt as the real one does
test(
  'a failed Devin setup whose take-back answered without its failure shows a retry warning once storage answers',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, {
      receiptMode: 0o644,
      removalDeletesReceipt: true,
      holdEntryRemoval: true,
    })
    try {
      const setupOutcome = await within(
        window.commands.get('codebook.setupAiChat')!().then(
          () => 'resolved',
          (error: Error) => error.message,
        ),
        16_000,
      )
      // Act
      window.holds.entryRemoval.release()
      await waitUntil(
        () => window.notices.length > 0,
        "the setup's late failure warning",
      )
      // Assert
      assert.equal(
        setupOutcome,
        "Codebook's take-back of this Devin Desktop setup is still waiting on storage (MCP entry) after 10 seconds; it finishes when storage answers, and Codebook's Output says when. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
      )
      assert.deepEqual(window.notices, [
        {
          severity: 'warning',
          message:
            'The Devin Desktop setup changed while this setup ran; run Codebook: Set Up AI Chat again.',
          actions: [],
        },
      ])
    } finally {
      await window.loaded.deactivate()
    }
  },
)

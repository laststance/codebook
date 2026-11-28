// Fixtures of the devinChatOnboarding*.test.ts files: the Devin Desktop window stand-in, its descriptor and setup-record readers, and the MCP initialize the Devin bridge posts.

import * as fsPromises from 'node:fs/promises'
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { CONNECTION_DESCRIPTOR_SUFFIX } from '../../constants'
import type * as ExtensionModule from '../../extension'
import { startServer as startRealServer } from '../../server'
import { atomicPrivateWrite } from '../../utils/atomicPrivateWrite'
import { checkDevinBridgeReceipts } from '../../utils/checkDevinBridgeReceipts'
import { continueAfterLateRead } from '../../utils/continueAfterLateRead'
import type * as OwedDevinTakeBackModule from '../../utils/owedDevinTakeBack'
import {
  clearOwedDevinTakeBack,
  recordOwedDevinTakeBack,
} from '../../utils/owedDevinTakeBack'
import { readDevinInstallationId } from '../../utils/readDevinInstallationId'
import { readPrivateJsonState } from '../../utils/readPrivateJsonState'
import { readStandingDevinInstallationId } from '../../utils/readStandingDevinInstallationId'
import { setDescriptorDevinChat } from '../../utils/setDescriptorDevinChat'
import { StorageLockHeldError } from '../../utils/storageLockHeldError'
import { withDevinSetupLock } from '../../utils/withDevinSetupLock'
import { createHarness } from '../helpers'

import { loadModule } from './loadModule'
import { removeTestFolder } from './removeTestFolder'

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
export const MCP_RECEIPT_TEXT = JSON.stringify({
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
export async function descriptorPath(
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
export async function owedTakeBackRecord(directory: string): Promise<unknown> {
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
export async function leaveOwedTakeBack(
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
 * Whether the Devin Desktop setup lock is held now: its `writer.lock` file stands in the window's storage.
 * @param directory - The window's global storage folder.
 * @returns `true` while a hold of the setup lock has not released it.
 * @example await isSetupLockHeld(window.directory) // => true while a refresh holds the lock
 */
export async function isSetupLockHeld(directory: string): Promise<boolean> {
  return stat(join(directory, 'devin-setup/writer.lock')).then(
    () => true,
    () => false,
  )
}

/**
 * Loads the real activation boundary as Devin Desktop (`uriScheme` `devin`) with every skill, MCP config, Node and server effect replaced, so a test reads which setup steps ran, in which order, without touching a user profile.
 * @param context - The test, which removes the temporary folder afterwards.
 * @param options - `platform` the window's system (macOS when left out); `savedSetup` a setup saved for this workspace before the window opened; `skillManaged` whether the Devin skill still has its receipt; `entryRefresh` what the MCP entry's refresh answers; `noticeChoice` the button every information notice answers; `confirmRemoval` whether the removal's modal question is confirmed; `holdRefresh` holds the entry's refresh until the test releases it; `failSetupClear` makes clearing the saved setup fail; `entryWrite` what the entry's write answers (`installed` when left out); `remoteName` the editor's `env.remoteName`; `receiptMode` the mode the entry write leaves its receipt with (private when left out); `entryReceipt` whether Codebook's entry receipt is left for a saved setup (it is when left out); `nodeFailure` makes resolving Node fail with raw text; `entryRefreshBusy` how many times the entry's refresh meets a held storage lock first; `failSetupSave` makes saving the setup fail; `storageDirectory` an existing folder shared as global storage with another window; `holdDeploy` holds the skill deployment until the test releases it; `cleanupFailure` the sentence the entry's write and refresh answer for a kept copy that could not be deleted; `skillReceipt` whether Codebook's skill record is left for a saved setup (it is when left out); `afterRefresh` runs inside the entry's refresh, before it answers; `holdDescriptorRewrite` makes the descriptor rewrite wait, after it read the file, until the test releases it; `entryDisabled` makes the entry's write answer that the entry stays turned off in Devin's Customize; `onSkillCheck` runs inside the setup's final skill check, before it answers; `failEntryRemoval` makes removing the entry fail; `realServer` runs the real MCP server (with the window's mark as its gate) instead of the descriptor stand-in; `failDescriptorUnmark` makes the descriptor rewrite that removes the mark fail (the other rewrites run the real one); `afterInstallationRead` runs once right after the first read of the receipt's installation id (test seam); `removalResult` what the entry removal resolves with (a plain removal when left out); `onSetupCommit` runs inside the write of the committed setup, before it lands (test seam); `failSetupCommit` makes a write of a setup value (not a clearing) that follows a provisional one fail; `failSetupRestore` makes every write that follows a provisional one fail (the commit and the restore); `skillReceiptMode` the mode the skill deployment leaves its receipt with (private when left out); `receiptReadAnswerDelaysMs` how long each of the first reads of the setup receipts waits, after it read the real records, before it answers what it read. The window also returns `armReceiptsHold`, which makes the next read of the setup records answer what it read and then wait until `releaseReceipts` (`hasReceiptsReached` says it waits).
 * @returns The window's commands, saved state, recorded steps, notices, Output lines and executed editor commands.
 * @example const window = await devinWindow(context, { savedSetup: true, entryRefresh: 'refreshed' })
 */
export async function devinWindow(
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
    /** Whether every read of the setup receipts that `holdReceiptReadAt`, `receiptReadAnswerDelaysMs` and `receiptReadDelaysMs` leave to the real one waits, as a read stuck on a failing disk, until `releaseHungReceiptReads` or the window's `deactivate` opens its gate, and then answers with no answer (`null`). */
    receiptReadsHang?: boolean
    failFirstInstallationRead?: boolean
    removalDeletesReceipt?: boolean
    /** How long each of the first reads of the setup receipts waits before it answers with no answer (`null`), by the read's position; a read past the list, or at an `undefined` position, is the real one. */
    receiptReadDelaysMs?: (number | undefined)[]
    /** How long each of the first reads of the setup receipts waits after it read the real records before it answers what it read, by the read's position; a read past the list, or at an `undefined` position, is the real one. */
    receiptReadAnswerDelaysMs?: (number | undefined)[]
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
    /** Holds every check of the bridge's records (a late mark's check after its mark, a setup's final check) once it read them, until `holds.bridgeCheck` is released, and then answers what it read before it waited, as a slow storage whose answer comes after the window moved on. */
    holdBridgeCheck?: boolean
    /** The position (1 for the first) of the one check of the bridge's records that `holdBridgeCheck` would hold: it reads them, waits at `holds.bridgeCheck` and answers what it read before it waited; every other check is the real one. */
    holdBridgeCheckAt?: number
    /** Makes a server that starts serve the folder the window serves at that moment (`changeFolder` changes it), in its environment and its descriptor, as the real environment does; when left out, every server serves the window's first folder. */
    serverFollowsFolder?: boolean
    /** How many of the first looks for an owed take-back get no answer from their read of the record (descriptor exhaustion, `EIO`), whatever the record holds; `failNextOwedTakeBackLooks` arms more later. */
    owedTakeBackLooksWithoutAnswer?: number
    /** Makes every write of the record of an owed take-back fail, as on a full disk; the record's reads and deletes are the real ones. */
    failTakeBackRecord?: boolean
    /** The position (1 for the window load's own) of the one look for an owed take-back that waits at `holds.owedTakeBackLook` before it reads the real record, as a read stuck on a failing disk until the test releases it. */
    holdOwedTakeBackLookAt?: number
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
    outputErrorLines: string[] = [],
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
    owedTakeBackLook: createGate(),
    bridgeCheck: createGate(),
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
  // When each read of the setup receipts started (`performance.now()`), in order; a test measures a late mark's fresh read from its first attempt.
  const receiptReadStartsMs: number[] = []
  // What each late mark's continuation answered once it settled (whether it marked, or its failure's message), in order; a test waits for it instead of for the start of the fresh read.
  const lateMarkDecisions: unknown[] = []
  // When each of those answers settled (`performance.now()`), in the same order.
  const lateMarkDecisionTimesMs: number[] = []
  // How many looks for an owed take-back have answered; the window's load makes the first.
  let owedTakeBackReads = 0
  // How many looks for an owed take-back have started, so `holdOwedTakeBackLookAt` holds the one at its position.
  let owedTakeBackLooksStarted = 0
  // How many checks of the bridge's records have started, so `holdBridgeCheckAt` holds the one at its position.
  let bridgeChecksStarted = 0
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
        error(line: string): void {
          outputErrorLines.push(line)
        },
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
    resolve(__dirname, '../../utils/owedDevinTakeBack.js'),
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
    resolve(__dirname, '../../extension.js'),
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
          receiptReadStartsMs.push(performance.now())
          // The held read answers what it read before it waited, so a continuation that trusted it would see the setup standing.
          if (receiptReadCount === options.holdReceiptReadAt) {
            const standsBeforeHold =
              await readStandingDevinInstallationId(storageRoot)
            await holds.receiptRead.wait()
            return standsBeforeHold
          }
          // A read that answers late with what it read, as a slow storage whose every answer comes after the start budget.
          const answerDelayMs =
            options.receiptReadAnswerDelaysMs?.[receiptReadCount - 1]
          if (answerDelayMs !== undefined) {
            const stands = await readStandingDevinInstallationId(storageRoot)
            await delay(answerDelayMs)
            return stands
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
        recordOwedDevinTakeBack: async (
          ...parameters: Parameters<typeof recordOwedDevinTakeBack>
        ): Promise<void> => {
          if (options.failTakeBackRecord)
            throw new Error('Injected take-back record failure')
          return recordOwedDevinTakeBack(...parameters)
        },
        clearOwedDevinTakeBack,
        readOwedDevinTakeBack: async (storageRoot: string) => {
          owedTakeBackLooksStarted += 1
          // The held look waits before it reads, as a read stuck on a failing disk.
          if (owedTakeBackLooksStarted === options.holdOwedTakeBackLookAt)
            await holds.owedTakeBackLook.wait()
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
            (isMarked) => {
              lateMarkDecisionTimesMs.push(performance.now())
              lateMarkDecisions.push(isMarked)
            },
            (error: Error) => {
              lateMarkDecisionTimesMs.push(performance.now())
              lateMarkDecisions.push(error.message)
            },
          )
          return decision
        },
      },
      // Reads the real receipt; `afterInstallationRead` runs once, right after the first read answered, as a receipt that becomes unreadable between the setup's check and its mark write.
      // The bridge's check of the records: a test makes it never settle, as a skill receipt read that hangs, or holds its answer after it read them.
      './utils/checkDevinBridgeReceipts': {
        checkDevinBridgeReceipts: (
          ...parameters: Parameters<typeof checkDevinBridgeReceipts>
        ) => {
          if (options.hangFinalReceiptsCheck)
            return new Promise<never>(() => {})
          bridgeChecksStarted += 1
          const check = checkDevinBridgeReceipts(...parameters)
          const isHeld =
            options.holdBridgeCheck ||
            bridgeChecksStarted === options.holdBridgeCheckAt
          if (!isHeld) return check
          // The held check answers what it read before it waited, so a continuation that trusted it would see the window as it was then.
          return check.then(async (answer) => {
            await holds.bridgeCheck.wait()
            return answer
          })
        },
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
    /** When a read of the setup receipts first waited at the gate of `receiptReadsHang` (`performance.now()`), or `undefined` while none did. */
    hungReceiptReadReachedAtMs: hungReceiptReads.reachedAtMs,
    /** The held storage steps (`holdEntryRemoval`, `holdSkillRemoval`, `holdSavedSetupWrite`, `holdDescriptorUnmark`, `holdDescriptorMark`, `hangFirstInstallationRead`, `holdReceiptReadAt`, `holdEntryWrite`, `holdProvisionalSave`, `holdSkillCheck`, `holdDescriptorPublish`, `holdLateMark`, `holdOwedTakeBackLookAt`, `holdBridgeCheck`, `holdBridgeCheckAt`): each `reachedAtMs()` reads when a step first waited there, and `release()` lets it go on. */
    holds,
    /** Settles when the reconnect at activation ended, with or without a server start. */
    whenReconnected: activated.whenReconnected,
    commands,
    state,
    steps,
    notices,
    modalQuestions,
    outputLines,
    outputErrorLines,
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
    /** When each read of the setup receipts started (`performance.now()`), in order. */
    receiptReadStartsMs,
    /** What each late mark's continuation settled with, in order: `true` when it marked the descriptor, `false` when it left it as it was, or its failure's message. */
    lateMarkDecisions,
    /** When each answer of {@link lateMarkDecisions} settled (`performance.now()`), in the same order. */
    lateMarkDecisionTimesMs,
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

/**
 * Posts an MCP initialize to the server a Devin Desktop window runs, as the Devin bridge (or any other client) would.
 * @param descriptorFile - The path of the window's connection descriptor.
 * @param isDevinBridge - Whether the request carries `x-codebook-bridge: devin`.
 * @param token - The bearer token to send instead of the descriptor's current one (a client that connected earlier).
 * @returns The HTTP status of the answer.
 * @example await postInitialize(await window.descriptorPath(), true) // => 403 while the window's mark is off
 */
export async function postInitialize(
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

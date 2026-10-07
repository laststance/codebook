import { randomUUID } from 'node:crypto'
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { URLSearchParams } from 'node:url'

import * as vscode from 'vscode'

import {
  AGENT_STORAGE_DIRECTORY,
  CONNECTION_DESCRIPTOR_SUFFIX,
  EXTENSION_VERSION,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
  WIKI_CHAT_OPEN_TIMEOUT_MS,
  WIKI_CHAT_SESSION_START_TIMEOUT_MS,
  WIKI_CHAT_WITHDRAW_SETTLE_MS,
  WIKI_CURSOR_TERMINATION_GRACE_MS,
  WIKI_CURSOR_UPDATE_TIMEOUT_MS,
  WIKI_ENTRY_FILE,
  WIKI_MANIFEST_FILE,
  WIKI_OUTSIDE_OUTPUT_APPROVALS_NOTE,
  WIKI_UPDATE_LAST_RUN_STATE_KEY,
  WIKI_UPDATE_UNREADABLE_MANIFEST_GRACE_MS,
  WIKI_UPDATE_WATCH_POLL_MS,
  WIKI_UPDATE_WATCH_TIMEOUT_MS,
  WIKI_UPDATE_WINDOW_CLOSING_ABORT_REASON,
} from './constants'
import {
  deployCursorSkill,
  removeManagedCursorSkill,
  verifyManagedCursorSkill,
} from './cursorSkillDeployment'
import {
  readDeepWikiManifest,
  startDeepWikiReader,
  type DeepWikiReader,
} from './deepWikiReader'
import { createEnvironment, requireWorkspace } from './environment'
import { learningItemSchema } from './identitySchemas'
import { repositorySelectionSchema } from './learnerSchemas'
import { RepositoryReader } from './repositoryReader'
import { repositoryActionSchema } from './repositoryView'
import { startServer } from './server'
import { StudyService } from './service'
import { StudyWorkspace } from './studyWorkspace'
import { aiChatReadyMessage } from './utils/aiChatReadyMessage'
import {
  answerDeepWikiQuestion,
  answerDeepWikiQuestionWithPrompt,
} from './utils/answerDeepWikiQuestion'
import { buildWikiUpdatePrompt } from './utils/buildWikiUpdatePrompt'
import {
  claimWikiUpdateMarker,
  type WikiUpdateMarkerClaim,
} from './utils/claimWikiUpdateMarker'
import {
  classifyWikiUpdateEnd,
  type WikiUpdateEndFacts,
} from './utils/classifyWikiUpdateEnd'
import {
  currentStorageOwner,
  useEditorMachineId,
} from './utils/currentStorageOwner'
import { describeWikiChatHandOver } from './utils/describeWikiChatHandOver'
import { detectWikiPublishConflicts } from './utils/detectWikiPublishConflicts'
import { endOfWikiChatStart } from './utils/endOfWikiChatStart'
import { failureOfWikiChatReplyEnd } from './utils/failureOfWikiChatReplyEnd'
import { findWikiUpdateStartBlock } from './utils/findWikiUpdateStartBlock'
import { formatClockTime } from './utils/formatClockTime'
import { inspectDeepWikiFreshness } from './utils/inspectDeepWikiFreshness'
import {
  isAcknowledgedWikiLeftover,
  type WikiLeftover,
} from './utils/isAcknowledgedWikiLeftover'
import { isWikiManifestOf } from './utils/isWikiManifestOf'
import { joinInFlight } from './utils/joinInFlight'
import { listWikiCandidates } from './utils/listWikiCandidates'
import { mayWikiChatStillPublish } from './utils/mayWikiChatStillPublish'
import { noticeWithSetupStep } from './utils/noticeWithSetupStep'
import { readLiveWikiUpdateMarker } from './utils/readLiveWikiUpdateMarker'
import { readWikiPublicationIdentity } from './utils/readWikiPublicationIdentity'
import { readWikiPublishToken } from './utils/readWikiPublishToken'
import { readWikiWatchStamp } from './utils/readWikiWatchStamp'
import {
  captureOwnedCursorMcpCatalogGeneration,
  refreshCursorMcpCatalog,
  removeOwnedCursorMcpCatalog,
} from './utils/refreshCursorMcpCatalog'
import { registerPlainCommand } from './utils/registerPlainCommand'
import { requestCursorWikiText } from './utils/requestCursorWikiText'
import { resolveDeepWikiDirectory } from './utils/resolveDeepWikiDirectory'
import { resolveDeepWikiSource } from './utils/resolveDeepWikiSource'
import { resolveExternalNodeExecutable } from './utils/resolveExternalNodeExecutable'
import { runCursorWikiUpdate } from './utils/runCursorWikiUpdate'
import {
  selectActiveWikiCandidate,
  wikiLastRunSchema,
  type WikiLastRun,
} from './utils/selectActiveWikiCandidate'
import { settledWithin } from './utils/settledWithin'
import { showPlainNotice, type NoticeSeverity } from './utils/showPlainNotice'
import { startWikiChatUpdate } from './utils/startWikiChatUpdate'
import { thrownMessage } from './utils/thrownMessage'
import { waitForWikiPublish } from './utils/waitForWikiPublish'
import type { WikiChatReplyWatch } from './utils/watchWikiChatReply'
import { watchWikiUpdateSigns } from './utils/watchWikiUpdateSigns'
import { wikiManifestIdentity } from './utils/wikiManifestIdentity'
import { wikiOutputLabel } from './utils/wikiOutputLabel'
import { OPEN_WIKI_ACTION, wikiUpdateNotice } from './utils/wikiUpdateNotice'
import {
  WikiUpdateRun,
  type WikiUpdateHost,
  type WikiUpdateOutput,
} from './utils/wikiUpdateRun'
import { WikiUpdateTimeoutError } from './utils/wikiUpdateTimeoutError'

let stopExtension: (() => Promise<void>) | undefined

/** Registers explicit trusted commands without reading auto-run instructions from repository files. @example VS Code calls activate(context) */
export function activate(
  context: Pick<vscode.ExtensionContext, 'extensionPath' | 'subscriptions'> & {
    globalStorageUri: Pick<vscode.Uri, 'fsPath'>
    workspaceState: Pick<vscode.Memento, 'get' | 'update'>
  },
) {
  // Before anything takes a storage lock: locks and the connection descriptor name this machine by the editor's id.
  useEditorMachineId(vscode.env?.machineId, vscode.env?.remoteName)
  // The read of this process's start (a spawned query on macOS and Windows) begins now and is kept, so the first storage lock does not wait for it.
  void currentStorageOwner().catch(() => undefined)
  type Running = {
    endpoint: Awaited<ReturnType<typeof startServer>>
    environment: Awaited<ReturnType<typeof createEnvironment>>
    descriptorPath: string
    service: StudyService
  }
  let starting: Promise<Running> | undefined,
    running: Running | undefined,
    stopping: Promise<void> | undefined
  let registeredCursorServer: string | undefined
  let cursorRegistration:
    { server: Running; attempt: Promise<void> } | undefined
  let cursorSetup: Promise<void> | undefined,
    cursorRemoval: Promise<void> | undefined,
    cursorRemoving = false
  let notifyMcpDefinitions: () => void = () => {}
  /** Shows every non-modal notification of this window through {@link showPlainNotice}, so no outside text in it becomes a link; `actions` are its buttons and the pressed one is returned. @example void showNotice('error', `Codebook could not open DeepWiki: ${String(error)}`) */
  const showNotice = <Action extends string>(
    severity: NoticeSeverity,
    message: string,
    ...actions: Action[]
  ): Thenable<Action | undefined> =>
    showPlainNotice(vscode.window, severity, message, ...actions)
  /** Registers every command of this window through {@link registerPlainCommand}, so a failed command rejects with a message the editor cannot turn into a link. @example registerCommand('codebook.stopAgentServer', stop) */
  const registerCommand = (
    command: string,
    handler: Parameters<typeof registerPlainCommand>[2],
  ): vscode.Disposable =>
    registerPlainCommand(vscode.commands, command, handler)
  const isCursorHost =
    vscode.env?.appName?.toLowerCase().includes('cursor') ?? false
  const setupMatchesCurrentWorkspace = () => {
    try {
      return (
        context.workspaceState.get<{ workspace: string }>(
          'codebook.aiChatSetup',
        )?.workspace === requireWorkspace()
      )
    } catch {
      return false
    }
  }
  let reader: StudyWorkspace | undefined
  let repositoryReader: RepositoryReader | undefined
  let deepWikiReader: DeepWikiReader | undefined
  let wikiUpdate: Promise<void> | undefined
  // One update run per window, shared by the command, the `/update` link and the browser button.
  const wikiUpdateRun = new WikiUpdateRun()
  // The active run of either host: its one abort, and a promise that settles once its watch or its agent has stopped.
  let activeWikiRun:
    { controller: AbortController; settled: Promise<void> } | undefined
  // How this window's last run ended, also across a reload: a candidate written while it lasted is this window's own leftover.
  let lastWikiRun: WikiLastRun | undefined = wikiLastRunSchema.safeParse(
    context.workspaceState.get(WIKI_UPDATE_LAST_RUN_STATE_KEY),
  ).data
  // This window's id in the marker of a running update; another window's live marker refuses a start here.
  const wikiWindowId = randomUUID()
  // The reservation this window's stopped VS Code watch left on disk for other windows, with the timer that removes it at the watch bound.
  let wikiReservation:
    { release: () => Promise<void>; timer: NodeJS.Timeout } | undefined
  /** Removes this window's reservation from the disk: at the watch bound and when the window closes, where the chat it stood for is gone. A marker another window wrote since is left alone. @example await dropWikiReservation() */
  const dropWikiReservation = async (): Promise<void> => {
    const reservation = wikiReservation
    wikiReservation = undefined
    if (!reservation) return
    clearTimeout(reservation.timer)
    await reservation.release().catch(() => undefined)
  }
  /** The button of a refusal that names an earlier chat's leftover: it starts the update with that leftover ignored. */
  const UPDATE_ANYWAY_ACTION = 'Update anyway'
  // A window that is closing has nobody to notify of the run its shutdown stops, and starts no run.
  let isExtensionStopping = false
  /** What one Wiki update run carries from its start to its end. */
  type WikiRun = {
    projectRoot: string
    outputDirectory: string
    host: WikiUpdateHost
    /** Publish token of the site the run started from; the end compares against it to say kept or replaced. */
    tokenAtStart: string | undefined
    /** Publication identity the run started from; only another one at the end is a publish. */
    publicationAtStart: string | undefined
    /** Added source files that were neither indexed nor excluded when the run started; the end does not call them changed during the run. */
    uncoveredAtStart: string[]
    /** Whether the Wiki folder lies outside the opened project, where VS Code's chat asks to approve each step. */
    isOutputOutsideProject: boolean
    /** Removes this run's marker beside the Wiki, so another window may start. */
    releaseMarker: () => Promise<void>
    /** Leaves the marker as the reservation of a watch that was stopped while its chat may still work, for other windows to read. */
    reserveMarker: (watchEndedAtMs: number) => Promise<void>
    startedAtMs: number
    /** The bound the run announces on the page and in its request, and the one it is stopped at. */
    timeoutMs: number
    /** Stops the run: the learner's Cancel and the closing window both abort it. */
    controller: AbortController
  }
  const workspace = (): StudyWorkspace =>
    (reader ??= new StudyWorkspace(context, {
      start: async () => {
        await start()
        if (!running) throw new Error('Study server did not start.')
        return running.service
      },
      connect,
      returnToRepository: (selection) =>
        repository().open(selection, undefined, true),
      openArticle: (selection) => repository().open(selection),
      repositoryWikiOpen: () => Boolean(repositoryReader?.panelOpen()),
    }))
  const repository = (): RepositoryReader =>
    (repositoryReader ??= new RepositoryReader({
      storage: () => workspace().learningStorage(),
      connect,
      arrange: (signal, returnSelection, focus) =>
        workspace().arrangeRepository(signal, returnSelection, focus),
      evidence: (binding, recording, signal, origin) =>
        workspace().openRepositoryEvidence(binding, recording, signal, origin),
    }))
  const start = async () => {
    requireWorkspace()
    if (stopping)
      throw new Error(
        'Codebook server is stopping; wait for cleanup before starting.',
      )
    if (running) {
      if (!running.endpoint.listening)
        throw new Error(
          'Previous server shutdown is incomplete. Retry Codebook: Stop Agent Server before starting a new instance.',
        )
      return running.descriptorPath
    }
    const attempt = (starting ??= (async () => {
      const environment = await createEnvironment(
        context,
        workspace().presentation,
      )
      const directory = join(
        context.globalStorageUri.fsPath,
        AGENT_STORAGE_DIRECTORY,
      )
      let endpoint: Awaited<ReturnType<typeof startServer>> | undefined
      let service: StudyService | undefined
      try {
        await mkdir(directory, {
          recursive: true,
          mode: PRIVATE_DIRECTORY_MODE,
        })
        await chmod(directory, PRIVATE_DIRECTORY_MODE)
        // js-debug canonicalizes executed paths; source-map allowlists and seals must use the same identity.
        const storageRoot = await realpath(directory)
        service = new StudyService(environment, storageRoot)
        await workspace().attach(service)
        service.repository = await repository().storage()
        service.repositoryReader = (input, signal) =>
          repository().openFromAgent(input, signal)
        service.repositoryPublished = (): Promise<void> =>
          repository().published()
        endpoint = await startServer(service)
        const descriptorPath = join(
          storageRoot,
          `${service.instanceId}${CONNECTION_DESCRIPTOR_SUFFIX}`,
        )
        // The process id, with its machine and boot, lets another window tell a descriptor left by a crashed window from a running one.
        await writeFile(
          descriptorPath,
          JSON.stringify({
            ...endpoint.descriptor,
            pid: process.pid,
            ...(await currentStorageOwner()),
          }),
          {
            mode: PRIVATE_FILE_MODE,
            flag: 'wx',
          },
        )
        return { endpoint, environment, descriptorPath, service }
      } catch (error) {
        try {
          if (endpoint) await endpoint.close()
          else await service?.shutdown()
          if (service) await reader?.retire(service)
        } finally {
          environment.dispose()
        }
        throw error
      }
    })())
    try {
      const server = await attempt
      // A concurrent Stop can retire the shared preparation before another Start caller resumes.
      if (stopping || !server.endpoint.listening)
        throw new Error(
          'Codebook server stopped while starting its chat connection.',
        )
      running = server
      // A normal Stop then Start must restore an already configured Cursor chat connection.
      if (isCursorHost && setupMatchesCurrentWorkspace()) {
        try {
          await registerCursorConnection()
        } catch (error) {
          if (!stopping && !cursorRemoving && running === server)
            void showNotice(
              'warning',
              noticeWithSetupStep(
                'Codebook agent server started, but Cursor MCP registration failed',
                error,
                'Run Codebook: Set Up AI Chat to repair the connection.',
              ),
            )
        }
      }
      if (running !== server || stopping || !server.endpoint.listening)
        throw new Error(
          'Codebook server stopped while starting its chat connection.',
        )
      notifyMcpDefinitions()
      return server.descriptorPath
    } finally {
      if (starting === attempt) starting = undefined
    }
  }
  const stop = async (): Promise<void> => {
    const attempt = (stopping ??= (async () => {
      const target = running ?? (await starting?.catch(() => undefined))
      if (!target) return
      let finalizationError: unknown
      try {
        await target.endpoint.close()
      } catch (error) {
        // Keep ownership when physical release failed; a persistence-only failure can retire the closed endpoint.
        if (!target.endpoint.resourcesReleased) throw error
        finalizationError = error
      }
      // The final reader checkpoint must be taken after runtime/explanation shutdown, not the last polling tick.
      try {
        await reader?.retire(target.service)
      } catch (error) {
        finalizationError ??= error
      }
      if (registeredCursorServer) {
        vscode.cursor?.mcp?.unregisterServer(registeredCursorServer)
        registeredCursorServer = undefined
      }
      // This unique descriptor belongs only to the stopped instance, never to another window.
      await unlink(target.descriptorPath).catch((error) => {
        if (error.code !== 'ENOENT') throw error
      })
      target.environment.dispose()
      if (running === target) running = undefined
      notifyMcpDefinitions()
      if (finalizationError) throw finalizationError
    })())
    try {
      await attempt
    } finally {
      if (stopping === attempt) stopping = undefined
    }
  }
  const connect = async (): Promise<void> => {
    const descriptorPath = await start()
    const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'))
    await vscode.env.clipboard.writeText(
      JSON.stringify(
        {
          mcpServers: {
            codebook: {
              type: 'http',
              url: descriptor.url,
              headers: { Authorization: `Bearer ${descriptor.token}` },
            },
          },
        },
        null,
        2,
      ),
    )
    void showNotice(
      'information',
      'Codebook connection copied. This credential grants access to the selected workspace; recopy after restart.',
    )
  }
  /** Shares a current-server registration across simultaneous starts and refuses a retired descriptor after Node validation. @example await registerCursorConnection() */
  const registerCursorConnection = (
    validatedNodeExecutable?: string,
  ): Promise<void> => {
    if (cursorRemoving)
      throw new Error(
        'Codebook Cursor setup was removed while its connection was starting. Run Codebook: Set Up AI Chat again.',
      )
    const server = running
    if (!server)
      throw new Error(
        'Codebook server is not running. Run Codebook: Set Up AI Chat again.',
      )
    const cursorMcp = vscode.cursor?.mcp
    if (!cursorMcp?.registerServer)
      throw new Error(
        'This Cursor version does not expose MCP registration to Codebook. Update Cursor or use the public manual connection setup.',
      )
    const previous = cursorRegistration
    if (previous?.server === server) return previous.attempt
    const attempt = (async () => {
      // A newer server waits for any older registration to finish before touching Cursor's shared catalog.
      if (previous) await previous.attempt.catch(() => {})
      if (running !== server || stopping || cursorRemoving)
        throw new Error(
          'Codebook server or Cursor setup changed before MCP registration. Run Codebook: Set Up AI Chat again.',
        )
      // Another Cursor window may remove the shared skill while this window starts its server.
      await verifyManagedCursorSkill(
        context.extensionPath,
        context.globalStorageUri.fsPath,
      )
      if (running !== server || stopping || cursorRemoving)
        throw new Error(
          'Codebook server or Cursor setup changed before MCP registration. Run Codebook: Set Up AI Chat again.',
        )
      const name = `codebook-${server.service.instanceId}`
      if (registeredCursorServer !== name) {
        const nodeExecutable =
          validatedNodeExecutable ??
          (await resolveExternalNodeExecutable(
            vscode.workspace
              .getConfiguration('codebook')
              .get<string>('nodeExecutable', 'node'),
          ))
        await verifyManagedCursorSkill(
          context.extensionPath,
          context.globalStorageUri.fsPath,
        )
        if (running !== server || stopping || cursorRemoving)
          throw new Error(
            'Codebook server or Cursor setup changed before MCP registration. Run Codebook: Set Up AI Chat again.',
          )
        if (registeredCursorServer)
          cursorMcp.unregisterServer(registeredCursorServer)
        // Cursor's installed HTTP integration omits configured headers; a local stdio child reads only this window's private descriptor.
        cursorMcp.registerServer({
          name,
          server: {
            command: nodeExecutable,
            args: [
              join(context.extensionPath, 'dist/cursorMcpBridge.js'),
              server.descriptorPath,
            ],
            env: {},
          },
        })
        registeredCursorServer = name
      }
      const refreshId = await refreshCursorMcpCatalog(
        context.globalStorageUri.fsPath,
      )
      try {
        await verifyManagedCursorSkill(
          context.extensionPath,
          context.globalStorageUri.fsPath,
        )
      } catch (error) {
        if (registeredCursorServer === name) {
          cursorMcp.unregisterServer(name)
          registeredCursorServer = undefined
        }
        // A different window may have removed the skill and catalog before this refresh recreated the empty file.
        try {
          await verifyManagedCursorSkill(
            context.extensionPath,
            context.globalStorageUri.fsPath,
          )
        } catch {
          // A newer setup changes the receipt generation, so only this failed refresh may be retired.
          try {
            if (refreshId)
              await removeOwnedCursorMcpCatalog(
                context.globalStorageUri.fsPath,
                undefined,
                refreshId,
              )
          } catch (cleanupError) {
            throw new Error(
              'Cursor skill changed and its owned MCP catalog cleanup is incomplete. Run Codebook: Set Up AI Chat to repair the connection.',
              { cause: cleanupError },
            )
          }
        }
        throw error
      }
    })()
    cursorRegistration = { server, attempt }
    return attempt.finally(() => {
      if (cursorRegistration?.attempt === attempt)
        cursorRegistration = undefined
    })
  }
  /** Refuses a setup after explicit removal begins, including when an awaited deployment or server start resumes. @example assertCursorSetupAvailable() */
  const assertCursorSetupAvailable = (): void => {
    if (cursorRemoving)
      throw new Error(
        'Codebook Cursor setup was removed while starting. Run Codebook: Set Up AI Chat again.',
      )
  }
  const performSetupAiChat = async (): Promise<void> => {
    requireWorkspace()
    const cursorNodeExecutable = isCursorHost
      ? await resolveExternalNodeExecutable(
          vscode.workspace
            .getConfiguration('codebook')
            .get<string>('nodeExecutable', 'node'),
        )
      : undefined
    if (isCursorHost) {
      assertCursorSetupAvailable()
      await deployCursorSkill(
        context.extensionPath,
        context.globalStorageUri.fsPath,
      )
      assertCursorSetupAvailable()
    } else if (!vscode.lm?.registerMcpServerDefinitionProvider)
      throw new Error(
        'This VS Code version cannot register the Codebook MCP provider. Update VS Code.',
      )
    await start()
    if (isCursorHost) {
      assertCursorSetupAvailable()
      await registerCursorConnection(cursorNodeExecutable)
      assertCursorSetupAvailable()
    }
    if (!running) throw new Error('Codebook server did not start.')
    const setupCursorServer = isCursorHost ? registeredCursorServer : undefined
    await context.workspaceState.update('codebook.aiChatSetup', {
      workspace: running.endpoint.descriptor.workspace,
    })
    if (isCursorHost) {
      try {
        assertCursorSetupAvailable()
        await verifyManagedCursorSkill(
          context.extensionPath,
          context.globalStorageUri.fsPath,
        )
        assertCursorSetupAvailable()
      } catch (error) {
        // A different Cursor window may have removed the shared skill during the persisted setup write.
        await context.workspaceState.update('codebook.aiChatSetup', undefined)
        if (setupCursorServer && registeredCursorServer === setupCursorServer) {
          vscode.cursor?.mcp?.unregisterServer(setupCursorServer)
          registeredCursorServer = undefined
        }
        throw error
      }
    }
    notifyMcpDefinitions()
    void showNotice('information', aiChatReadyMessage(isCursorHost))
  }
  /** Coalesces overlapping Cursor setup commands so removal can await the whole deployment and saved state. @example await setupAiChat() */
  const setupAiChat = (): Promise<void> => {
    if (!isCursorHost) return performSetupAiChat()
    assertCursorSetupAvailable()
    if (cursorSetup) return cursorSetup
    const attempt = performSetupAiChat()
    const tracked = attempt.finally(() => {
      if (cursorSetup === tracked) cursorSetup = undefined
    })
    cursorSetup = tracked
    return tracked
  }
  if (
    !isCursorHost &&
    vscode.lm?.registerMcpServerDefinitionProvider &&
    vscode.EventEmitter &&
    vscode.McpHttpServerDefinition &&
    vscode.Uri
  ) {
    const changes = new vscode.EventEmitter<void>()
    notifyMcpDefinitions = (): void => changes.fire()
    context.subscriptions.push(
      changes,
      vscode.lm.registerMcpServerDefinitionProvider(
        'laststance.codebook.currentWorkspace',
        {
          onDidChangeMcpServerDefinitions: changes.event,
          provideMcpServerDefinitions: () => {
            if (!running || !setupMatchesCurrentWorkspace()) return []
            const descriptor = running.endpoint.descriptor
            // Discovery runs eagerly; only the start-time resolver may receive the short-lived bearer.
            return [
              new vscode.McpHttpServerDefinition(
                'Codebook',
                vscode.Uri.parse(descriptor.url),
                {},
                `${EXTENSION_VERSION}-${running.service.instanceId}`,
              ),
            ]
          },
          resolveMcpServerDefinition: async (definition) => {
            if (!setupMatchesCurrentWorkspace())
              throw new Error(
                'Run Codebook: Set Up AI Chat for this workspace.',
              )
            if (!(definition instanceof vscode.McpHttpServerDefinition))
              throw new Error('Codebook requires an HTTP MCP definition.')
            await start()
            if (!running) throw new Error('Codebook server did not start.')
            const descriptor = running.endpoint.descriptor
            definition.uri = vscode.Uri.parse(descriptor.url)
            definition.headers = { Authorization: `Bearer ${descriptor.token}` }
            definition.version = `${EXTENSION_VERSION}-${running.service.instanceId}`
            return definition
          },
        },
      ),
    )
  }
  // Owned runtimes are released first; an in-flight or failing browser reader close cannot strand them.
  stopExtension = async (): Promise<void> => {
    isExtensionStopping = true
    // A closing window must not leave a watch or an unattended agent behind.
    const stoppedWikiRun = activeWikiRun
    stoppedWikiRun?.controller.abort(WIKI_UPDATE_WINDOW_CLOSING_ABORT_REASON)
    try {
      await stop()
      await repositoryReader?.dispose()
      await reader?.dispose()
    } finally {
      try {
        // The Cursor agent gets its termination grace to close; an agent that does not is not waited for longer.
        if (stoppedWikiRun)
          await settledWithin(
            // How the run ended is recorded by the run itself; shutdown only waits for it.
            stoppedWikiRun.settled.catch(() => undefined),
            WIKI_CURSOR_TERMINATION_GRACE_MS,
          )
      } finally {
        try {
          await dropWikiReservation()
        } finally {
          await deepWikiReader?.close()
        }
      }
    }
  }
  /** Resolves the opened project and the Wiki folder its setting names, without reading the folder. @example await wikiLocation() // => { projectRoot: '/repo', outputDirectory: '/repo/.codebook/wiki' } */
  const wikiLocation = async (): Promise<{
    projectRoot: string
    outputDirectory: string
  }> => {
    const projectRoot = await realpath(requireWorkspace())
    const setting = vscode.workspace
      .getConfiguration('codebook')
      .get<string>('wikiOutputDirectory', '.codebook/wiki')
    return {
      projectRoot,
      outputDirectory: resolveDeepWikiDirectory(projectRoot, setting),
    }
  }
  /** Checks that the manifest of the Wiki folder names this opened project, before the browser entry or an update uses the folder. @throws When the manifest is no JSON object of this schema or names another checkout. @example await assertWikiOwner('/repo', '/repo/.codebook/wiki') */
  const assertWikiOwner = async (
    projectRoot: string,
    outputDirectory: string,
  ): Promise<void> => {
    const manifest: unknown = JSON.parse(
      await readFile(join(outputDirectory, WIKI_MANIFEST_FILE), 'utf8'),
    )
    // A generated page from another checkout must not masquerade as this project's Wiki.
    if (!isWikiManifestOf(manifest, projectRoot))
      throw new Error(
        'The DeepWiki manifest does not identify this opened project.',
      )
  }
  /** Checks the generated Wiki's owner and its entry page before the browser entry opens it; an update checks the owner alone, so a deleted entry page reaches its start check. @example await currentDeepWiki() // => { projectRoot, outputDirectory, entry } */
  const currentDeepWiki = async () => {
    const { projectRoot, outputDirectory } = await wikiLocation()
    await assertWikiOwner(projectRoot, outputDirectory)
    const entry = join(outputDirectory, WIKI_ENTRY_FILE)
    await readFile(entry)
    return { projectRoot, outputDirectory, entry }
  }
  /** Reads the published manifest's identity and its freshness against the project; undefined while it is missing, mid-replacement or invalid. @example await inspectPublishedWiki('/repo', '/repo/.codebook/wiki') // => { identity: 'a1b2c3d4e5f6+0f9e8d7c', revision: 'a1b2c3d4e5f6', index: '0f9e8d7c', freshness: { status: 'current', changedPaths: [], addedPaths: [] } } */
  const inspectPublishedWiki = async (
    projectRoot: string,
    outputDirectory: string,
  ): Promise<WikiUpdateEndFacts['published']> => {
    try {
      const published = await readDeepWikiManifest(outputDirectory, projectRoot)
      return {
        ...wikiManifestIdentity(published.sources, published.revision),
        freshness: await inspectDeepWikiFreshness(
          projectRoot,
          published.sources,
          published.revision,
          published.excludedPaths,
          { outputDirectory },
        ),
      }
    } catch {
      return undefined
    }
  }
  /** Tells the learner in the editor how the update just ended, in the page's own sentence; called after every recorded ending, also a refused start and "already current". An ending that asks for a step offers to open the Wiki; `onUpdateAnyway` adds the button that starts the update although an earlier chat's leftover is in the way. @example showWikiUpdateNotice() */
  const showWikiUpdateNotice = (onUpdateAnyway?: () => void): void => {
    if (isExtensionStopping) return
    const notice = wikiUpdateNotice(wikiUpdateRun.status())
    if (!notice) return
    void showNotice(
      notice.severity,
      notice.message,
      ...(onUpdateAnyway ? [UPDATE_ANYWAY_ACTION] : []),
      ...notice.actions,
    ).then(
      (choice) => {
        if (choice === UPDATE_ANYWAY_ACTION) onUpdateAnyway?.()
        else if (choice === OPEN_WIKI_ACTION)
          // The command's own handler tells the learner why the Wiki did not open; its rejection has nobody else to go to.
          void vscode.commands
            .executeCommand('codebook.openDeepWiki')
            .then(undefined, () => undefined)
      },
      // A notification the editor could not show has nobody to report to either.
      () => undefined,
    )
  }
  /** Tells the learner that a second start was refused and where the first run's progress is. @example showWikiUpdateRunning() */
  const showWikiUpdateRunning = (): void => {
    void showNotice(
      'information',
      'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader and in the notification here.',
    )
  }
  /** Records how a run of either host ended: reads the publish token and the publication identity again, lets {@link classifyWikiUpdateEnd} decide, stores its answer for the reader, frees the Wiki for other windows and keeps how the run ended for this window's next start. @example await finishWikiUpdate(run, { cancelled: true }) */
  const finishWikiUpdate = async (
    run: WikiRun,
    observed: Partial<
      Pick<
        WikiUpdateEndFacts,
        | 'cancelled'
        | 'timedOut'
        | 'blockingPaths'
        | 'failure'
        | 'isFailureCodebookSentence'
      >
    > & {
      publish?: { token: string; published: WikiUpdateEndFacts['published'] }
    },
  ): Promise<void> => {
    const tokenAtEnd = await readWikiPublishToken(run.outputDirectory)
    const end = classifyWikiUpdateEnd({
      host: run.host,
      cancelled: observed.cancelled ?? false,
      timedOut: observed.timedOut ?? false,
      tokenAtStart: run.tokenAtStart,
      tokenAtEnd,
      publicationAtStart: run.publicationAtStart,
      publicationAtEnd:
        observed.publish?.token ??
        (await readWikiPublicationIdentity(run.outputDirectory)),
      // The manifest is read only when the site on disk is not the one the run started from.
      published:
        observed.publish?.published ??
        (tokenAtEnd === run.tokenAtStart
          ? undefined
          : await inspectPublishedWiki(run.projectRoot, run.outputDirectory)),
      uncoveredAtStart: run.uncoveredAtStart,
      blockingPaths: observed.blockingPaths ?? [],
      failure: observed.failure,
      isFailureCodebookSentence: observed.isFailureCodebookSentence,
    })
    wikiUpdateRun.end(end)
    const endedAtMs = Date.now()
    // Stopping a VS Code watch does not stop the chat; a Cursor agent is stopped with its run, and a closing window takes its chat with it.
    const mayAgentStillWork = mayWikiChatStillPublish(
      run.host,
      end.state,
      isExtensionStopping,
    )
    lastWikiRun = {
      outputDirectory: run.outputDirectory,
      startedAtMs: run.startedAtMs,
      endedAtMs,
      mayAgentStillWork,
    }
    void context.workspaceState.update(
      WIKI_UPDATE_LAST_RUN_STATE_KEY,
      lastWikiRun,
    )
    // The editor tells the learner in the same turn the page's status changes; the marker's file work below would put the notice a turn or more behind the page.
    showWikiUpdateNotice()
    if (mayAgentStillWork) {
      // Another window sees neither a run nor, before the chat staged anything, a candidate: the marker stays as a reservation until the watch bound.
      await run.reserveMarker(endedAtMs).catch(() => undefined)
      wikiReservation = {
        release: run.releaseMarker,
        timer: setTimeout(() => {
          void dropWikiReservation()
        }, WIKI_UPDATE_WATCH_TIMEOUT_MS).unref(),
      }
    } else await run.releaseMarker().catch(() => undefined)
  }
  /** Looks at this run's candidates: notes on the run state that the agent staged one, and names the learner files it would overwrite. @example await probeWikiCandidates(run) // => ['pages/notes.html'] */
  const probeWikiCandidates = async (run: WikiRun): Promise<string[]> => {
    const candidates = await listWikiCandidates(run.outputDirectory)
    // A look that returns after its run ended must not mark the next run.
    if (
      activeWikiRun?.controller === run.controller &&
      candidates.some((candidate) => candidate.writtenAtMs >= run.startedAtMs)
    )
      wikiUpdateRun.markCandidateStaged()
    return detectWikiPublishConflicts(
      run.outputDirectory,
      run.startedAtMs,
      candidates,
    )
  }
  /** Shows the one progress notification of a run and aborts the run when the learner presses its Cancel; both hosts' updates work inside it. @example await withCancellableProgress('Updating LLM Wiki with Cursor Agent', run, update) */
  const withCancellableProgress = async (
    title: string,
    run: WikiRun,
    work: () => Promise<void>,
  ): Promise<void> => {
    // An editor without the progress API still runs the update, without a Cancel.
    if (!vscode.window.withProgress) return work()
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true,
      },
      async (_, token) => {
        token.onCancellationRequested(() => run.controller.abort())
        await work()
      },
    )
  }
  /** Watches for the editor agent's publish after VS Code's chat took up the request, then records the run's result for the reader; settles when the watch has stopped. @param reply - The watch of the chat's reply: when the reply ends, one more look decides and the run ends at once. @example await watchVsCodeWikiUpdate(run, chatStart.reply) */
  const watchVsCodeWikiUpdate = (
    run: WikiRun,
    reply: WikiChatReplyWatch,
  ): Promise<void> =>
    withCancellableProgress(
      `Watching for the LLM Wiki update from the editor chat (Cancel stops watching, not the chat)${run.isOutputOutsideProject ? `. ${WIKI_OUTSIDE_OUTPUT_APPROVALS_NOTE}` : ''}`,
      run,
      async () => {
        try {
          const result = await waitForWikiPublish({
            // Only a new publication counts as the publish; a manifest rewritten by anything else does not.
            startToken: run.publicationAtStart,
            readStamp: () => readWikiWatchStamp(run.outputDirectory),
            readToken: () => readWikiPublicationIdentity(run.outputDirectory),
            readPublished: () =>
              inspectPublishedWiki(run.projectRoot, run.outputDirectory),
            unreadableGraceMs: WIKI_UPDATE_UNREADABLE_MANIFEST_GRACE_MS,
            findBlockingFiles: () => probeWikiCandidates(run),
            // A chat whose reply ended has said its last word: the look after it decides, and the bound is not waited out.
            replyEnded: reply.ended,
            signal: run.controller.signal,
            timeoutMs: run.timeoutMs,
            pollMs: WIKI_UPDATE_WATCH_POLL_MS,
          })
          await finishWikiUpdate(run, {
            cancelled: result.outcome === 'cancelled',
            timedOut: result.outcome === 'timed-out',
            blockingPaths: result.outcome === 'blocked' ? result.paths : [],
            publish: result.outcome === 'published' ? result : undefined,
            ...failureOfWikiChatReplyEnd(result.outcome, reply.end()),
          })
        } catch (error) {
          await finishWikiUpdate(run, { failure: thrownMessage(error) })
        }
      },
    )
  /** Runs the Cursor Agent CLI for one update and records the run's result for the reader; settles when the agent process has closed. @example await runCursorWikiAgent(run, '/codebook Update LLM Wiki …') */
  const runCursorWikiAgent = async (
    run: WikiRun,
    query: string,
  ): Promise<void> => {
    let agentError: unknown
    let didAgentFail = false
    // The CLI reports nothing until it exits, so the staged candidate is looked for beside it.
    let lookedAtStamp: string | undefined
    const stagedLook = setInterval(() => {
      void (async () => {
        const stamp = await readWikiWatchStamp(run.outputDirectory)
        // Candidates are parsed again only when something was written since the last look.
        if (stamp === lookedAtStamp) return
        lookedAtStamp = stamp
        await probeWikiCandidates(run)
      })().catch(() => undefined)
    }, WIKI_UPDATE_WATCH_POLL_MS)
    stagedLook.unref()
    try {
      await withCancellableProgress(
        'Updating LLM Wiki with Cursor Agent',
        run,
        async () => {
          await runCursorWikiUpdate(
            run.projectRoot,
            query,
            run.controller.signal,
            run.timeoutMs,
          )
          // A successful CLI exit alone does not prove that the correct project's site is readable.
          if ((await realpath(requireWorkspace())) !== run.projectRoot)
            throw new Error(
              'The opened repository changed during the Wiki update. Reopen its Wiki to see the result.',
            )
        },
      )
    } catch (error) {
      agentError = error
      didAgentFail = true
    } finally {
      clearInterval(stagedLook)
    }
    await finishWikiUpdate(run, {
      cancelled: run.controller.signal.aborted,
      timedOut: agentError instanceof WikiUpdateTimeoutError,
      // A refused candidate is the learner's file in the way, not a failed agent.
      blockingPaths: await probeWikiCandidates(run).catch(() => []),
      failure: didAgentFail ? thrownMessage(agentError) : undefined,
    })
  }
  /** What the start checks of an update hand to the run they let begin. */
  type WikiUpdateStart = Pick<
    WikiRun,
    | 'tokenAtStart'
    | 'publicationAtStart'
    | 'uncoveredAtStart'
    | 'releaseMarker'
    | 'reserveMarker'
    | 'startedAtMs'
  > & {
    /** Whether the opened folder is inside a Git repository; the request names only the conditions that can hold in it. */
    hasGitRepository: boolean
  }
  /**
   * Makes every check of an update's start in one order and records the refusal when one fails, so no agent is asked for a run that cannot succeed.
   *
   * The order: what makes the publisher refuse (an unfinished publish, a link or special file, a manifest that cannot be read or was edited, an edited or missing page); no Wiki at all; a manifest of another checkout; a Wiki that is already current; another window's running update, which nothing overrides; an earlier chat's leftover, which "Update anyway" overrides only for the leftovers its refusal named; and last the marker that reserves the Wiki for this run. When a publish lands while the checks run, they are made once more, so the token, the manifest and the freshness come from one generation.
   *
   * @param projectRoot - Canonical opened project.
   * @param wikiOutput - Resolved Wiki folder and its label.
   * @param host - Editor host that was asked.
   * @param acknowledgedLeftovers - The leftovers the refusal named when the learner chose "Update anyway" on it; empty for an ordinary press. Only a leftover equal to one of them ({@link isAcknowledgedWikiLeftover}) lets the start go on; a leftover that appeared since refuses it again with a notice of its own.
   * @returns
   * - The start may go ahead: what the run begins with; the Wiki's marker is claimed for it
   * - The start was refused or nothing needs updating: undefined, after the state was recorded and the learner told
   * @throws What a check threw (a manifest of another checkout, a file system error); the caller records it as a failed start.
   * @example
   * const start = await checkWikiUpdateStart('/repo', { outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki' }, 'vscode', [])
   */
  const checkWikiUpdateStart = async (
    projectRoot: string,
    wikiOutput: WikiUpdateOutput,
    host: WikiUpdateHost,
    acknowledgedLeftovers: readonly WikiLeftover[],
  ): Promise<WikiUpdateStart | undefined> => {
    const { outputDirectory } = wikiOutput
    /** Records a refusal in a sentence Codebook wrote and tells the learner; `onUpdateAnyway` offers the override. */
    const refuse = (reason: string, onUpdateAnyway?: () => void): undefined => {
      wikiUpdateRun.refuseStart(host, wikiOutput, {
        kind: 'failed',
        reason,
        isCodebookSentence: true,
      })
      showWikiUpdateNotice(onUpdateAnyway)
      return undefined
    }
    /** Starts the update again when the learner presses "Update anyway", with only the leftovers the refusal named ignored. */
    const updateAnyway = (leftovers: WikiLeftover[]): void => {
      // The refused attempt may still be unwinding when the button is pressed; the override is a start of its own, after it.
      Promise.resolve(wikiUpdate)
        .catch(() => undefined)
        .then(() => updateDeepWiki(leftovers))
        .catch((error: unknown) => {
          void showNotice(
            'error',
            `Codebook could not start the Wiki update: ${thrownMessage(error)}`,
          )
        })
    }
    /** The sentence for another window's running update, for the marker another window is writing at this moment because its update begins, or for the marker another window is removing or replacing at this moment; nothing overrides it. */
    const describeOtherWindow = (
      holder: Extract<WikiUpdateMarkerClaim, { heldBy: unknown }>['heldBy'],
    ): string =>
      'isMarkerInChange' in holder
        ? 'Another editor window is starting or ending an update of this Wiki. Wait a moment and try again.'
        : 'beingWrittenSinceMs' in holder
          ? 'Another editor window is starting an update of this Wiki. Wait a moment and try again.'
          : `Another editor window is updating this Wiki (${holder.host === 'cursor' ? 'Cursor' : 'VS Code'}, started ${formatClockTime(holder.startedAtMs, {})}). Wait for it to finish, then press Update LLM Wiki again.`
    for (const isLastAttempt of [false, true]) {
      // The publisher refuses each of these before it stages anything, so no agent could succeed: say why at once. It runs first: a journal without a folder is an unfinished publish, not a missing Wiki.
      const startBlock = await findWikiUpdateStartBlock(outputDirectory)
      if (startBlock) {
        wikiUpdateRun.refuseStart(host, wikiOutput, {
          kind: 'conflict',
          ...startBlock,
        })
        showWikiUpdateNotice()
        return undefined
      }
      const tokenAtStart = await readWikiPublishToken(outputDirectory)
      // Without a manifest there is nothing to update; the learner needs the generate step, not a file-system error.
      if (tokenAtStart === undefined) {
        const noWiki = `Codebook found no LLM Wiki in ${wikiOutput.outputLabel}. Ask the editor chat "/codebook Generate the LLM Wiki for this project", then update it.`
        // The page records the refusal like any other; there is no site to keep, so neither says one was kept.
        wikiUpdateRun.refuseStart(host, wikiOutput, {
          kind: 'failed',
          reason: noWiki,
          isCodebookSentence: true,
          site: 'missing',
        })
        void showNotice('error', noWiki)
        return undefined
      }
      const publicationAtStart =
        await readWikiPublicationIdentity(outputDirectory)
      // A manifest of another checkout throws here; the caller records the failed start.
      await assertWikiOwner(projectRoot, outputDirectory)
      const before = await inspectPublishedWiki(projectRoot, outputDirectory)
      if (before?.freshness.status === 'current') {
        const { freshness, ...published } = before
        wikiUpdateRun.alreadyCurrent(
          wikiOutput,
          published,
          // In a folder without Git "current" covers the indexed sources only, and the learner is told.
          Boolean(freshness.addedFilesUnchecked),
        )
        showWikiUpdateNotice()
        return undefined
      }
      // Each window holds its own run state; the marker is the trace of another window's run before its agent has staged anything.
      const markerLook = await readLiveWikiUpdateMarker(
        outputDirectory,
        wikiWindowId,
      )
      // A marker another window is writing at this moment is the beginning of its run.
      if (markerLook.kind === 'being-written')
        return refuse(describeOtherWindow(markerLook.heldBy))
      const otherWindow =
        markerLook.kind === 'live' ? markerLook.heldBy : undefined
      // A run that is active in another window refuses the start, and nothing overrides it.
      if (otherWindow && otherWindow.watchEndedAtMs === undefined)
        return refuse(describeOtherWindow(otherWindow))
      const nowMs = Date.now()
      // Every leftover in the way now, each with the sentence that names it; "Update anyway" is bound to all of them.
      const leftovers: Array<{ leftover: WikiLeftover; reason: string }> = []
      // Another window stopped watching its chat, which may still publish until the watch bound; like this window's own stopped watch, the learner may go on.
      if (
        otherWindow?.watchEndedAtMs !== undefined &&
        nowMs < otherWindow.watchEndedAtMs + WIKI_UPDATE_WATCH_TIMEOUT_MS
      )
        leftovers.push({
          leftover: {
            kind: 'reservation',
            windowId: otherWindow.windowId,
            startedAtMs: otherWindow.startedAtMs,
          },
          reason: `The VS Code chat another editor window asked at ${formatClockTime(otherWindow.startedAtMs, {})} may still be updating this Wiki; that window stopped watching it at ${formatClockTime(otherWindow.watchEndedAtMs, {})} and Codebook waits for it until ${formatClockTime(otherWindow.watchEndedAtMs + WIKI_UPDATE_WATCH_TIMEOUT_MS, {})}. If that chat was stopped, choose Update anyway in the editor’s notification.`,
        })
      // The record of another output says nothing about this one's candidates.
      const lastRun =
        lastWikiRun?.outputDirectory === outputDirectory
          ? lastWikiRun
          : undefined
      const activeCandidate = selectActiveWikiCandidate(
        await listWikiCandidates(outputDirectory),
        { nowMs, activeWithinMs: WIKI_UPDATE_WATCH_TIMEOUT_MS, lastRun },
      )
      if (activeCandidate)
        leftovers.push({
          leftover: { kind: 'candidate', name: activeCandidate.name },
          reason: `An earlier chat or another editor window appears to be updating this Wiki (candidate ${activeCandidate.name}, written ${formatClockTime(activeCandidate.writtenAtMs, {})}). Codebook waits for it until ${formatClockTime(activeCandidate.writtenAtMs + WIKI_UPDATE_WATCH_TIMEOUT_MS, {})}. If that chat was stopped, choose Update anyway in the editor’s notification.`,
        })
      // A watch that stopped before the chat staged anything left no candidate, yet the chat may still work.
      if (
        lastRun?.mayAgentStillWork &&
        nowMs < lastRun.endedAtMs + WIKI_UPDATE_WATCH_TIMEOUT_MS
      )
        leftovers.push({
          leftover: { kind: 'last-run', endedAtMs: lastRun.endedAtMs },
          reason: `The VS Code chat this window asked at ${formatClockTime(lastRun.startedAtMs, {})} may still be updating this Wiki; Codebook stopped watching it at ${formatClockTime(lastRun.endedAtMs, {})} and waits for it until ${formatClockTime(lastRun.endedAtMs + WIKI_UPDATE_WATCH_TIMEOUT_MS, {})}. If that chat was stopped, choose Update anyway in the editor’s notification.`,
        })
      // A press of "Update anyway" passes only the leftovers its refusal named; one that appeared since is named in a new refusal.
      const unacknowledged = leftovers.find(
        ({ leftover }) =>
          !isAcknowledgedWikiLeftover(leftover, acknowledgedLeftovers),
      )
      if (unacknowledged)
        return refuse(unacknowledged.reason, () =>
          updateAnyway(leftovers.map(({ leftover }) => leftover)),
        )
      // A publish that landed while the checks ran made them about two generations: check the new one.
      if ((await readWikiPublishToken(outputDirectory)) !== tokenAtStart) {
        if (isLastAttempt)
          return refuse(
            'This Wiki was published again while Codebook checked it. Press Update LLM Wiki again.',
          )
        continue
      }
      const startedAtMs = Date.now()
      const claim = await claimWikiUpdateMarker(outputDirectory, {
        pid: process.pid,
        windowId: wikiWindowId,
        host,
        startedAtMs,
      })
      // Another window began its run between the look at the marker and this write.
      if ('heldBy' in claim) return refuse(describeOtherWindow(claim.heldBy))
      // This window's own reservation, if it left one, is now this run's marker; its timer must not remove it.
      clearTimeout(wikiReservation?.timer)
      wikiReservation = undefined
      return {
        tokenAtStart,
        publicationAtStart,
        uncoveredAtStart: before?.freshness.addedPaths ?? [],
        hasGitRepository: !before?.freshness.addedFilesUnchecked,
        releaseMarker: claim.release,
        reserveMarker: claim.reserve,
        startedAtMs,
      }
    }
    return undefined
  }
  /** Starts a project-bound skill update from the browser or command, coalescing repeated clicks. @param acknowledgedLeftovers - Given when the learner pressed "Update anyway": the leftovers the refusal named, which alone are ignored; another window's running update and a leftover that appeared since still refuse the start. @example await updateDeepWiki() */
  const updateDeepWiki = async (
    acknowledgedLeftovers: readonly WikiLeftover[] = [],
  ): Promise<void> => {
    if (wikiUpdate) {
      // In Cursor the first call lasts the whole run, so a second command arrives here and must be told, as one from the browser link is.
      if (wikiUpdateRun.isRunning()) showWikiUpdateRunning()
      return wikiUpdate
    }
    const attempt = (async () => {
      // A run that outlives this call (the VS Code watch) still blocks a second start from any entry.
      if (wikiUpdateRun.isRunning()) {
        showWikiUpdateRunning()
        return
      }
      const { projectRoot, outputDirectory } = await wikiLocation()
      const outputLabel = wikiOutputLabel(projectRoot, outputDirectory)
      const wikiOutput = { outputDirectory, outputLabel }
      const host: WikiUpdateHost = isCursorHost ? 'cursor' : 'vscode'
      let start: WikiUpdateStart | undefined
      try {
        start = await checkWikiUpdateStart(
          projectRoot,
          wikiOutput,
          host,
          acknowledgedLeftovers,
        )
      } catch (error) {
        // The page waits for this start; a check that threw must reach it as a failed start with the reason, not as silence.
        wikiUpdateRun.refuseStart(host, wikiOutput, {
          kind: 'failed',
          reason: thrownMessage(error),
        })
        throw error
      }
      if (!start) return
      // The checks above take time (the freshness inspection hashes every source). A window that began to close meanwhile has already looked for a run to stop, so it starts none: no watch and no unattended agent.
      if (isExtensionStopping) {
        await start.releaseMarker().catch(() => undefined)
        return
      }
      const run: WikiRun = {
        projectRoot,
        outputDirectory,
        host,
        tokenAtStart: start.tokenAtStart,
        publicationAtStart: start.publicationAtStart,
        uncoveredAtStart: start.uncoveredAtStart,
        // The label is the absolute path exactly when the folder is not inside the project.
        isOutputOutsideProject: outputLabel === outputDirectory,
        releaseMarker: start.releaseMarker,
        reserveMarker: start.reserveMarker,
        startedAtMs: start.startedAtMs,
        timeoutMs: isCursorHost
          ? WIKI_CURSOR_UPDATE_TIMEOUT_MS
          : WIKI_UPDATE_WATCH_TIMEOUT_MS,
        controller: new AbortController(),
      }
      /** Makes the run reachable for the closing window until its watch or agent has stopped. */
      const track = (settled: Promise<void>): Promise<void> => {
        const tracked = { controller: run.controller, settled }
        activeWikiRun = tracked
        return settled.finally(() => {
          if (activeWikiRun === tracked) activeWikiRun = undefined
        })
      }
      // Every step from the run's begin to the hand-over is guarded: one that throws ends the run as failed with what was thrown, so this window does not stay "already updating" with its marker in place.
      try {
        wikiUpdateRun.begin(
          run.host,
          wikiOutput,
          run.timeoutMs,
          // Only VS Code's chat asks for approvals; the Cursor agent runs without prompts.
          !isCursorHost && run.isOutputOutsideProject,
        )
        const query = buildWikiUpdatePrompt({
          manifestPath: join(outputDirectory, WIKI_MANIFEST_FILE),
          timeoutMs: run.timeoutMs,
          // Nothing shows the Cursor CLI's reply to the learner, so its report is not asked for.
          isReplyRead: !isCursorHost,
          hasGitRepository: start.hasGitRepository,
          uncoveredPaths: run.uncoveredAtStart,
        })
        if (isCursorHost) {
          await track(runCursorWikiAgent(run, query))
          return
        }
        // Until the chat answers, the closing window finds this run, aborts it and waits until its end was recorded and its marker removed.
        let reportOpeningEnded = (): void => {}
        const opening = {
          controller: run.controller,
          settled: new Promise<void>((resolveSettled) => {
            reportOpeningEnded = resolveSettled
          }),
        }
        activeWikiRun = opening
        let chatReply: WikiChatReplyWatch
        try {
          // The request gets a chat session of its own; only what the update's own steps name counts as a sign that the chat works on it, and a request without a sign within the bound is taken back.
          const chatStart = await startWikiChatUpdate({
            query,
            // A command without an argument is run without one: the editor reads an argument that is `undefined` as a given one.
            runCommand: (command, ...argument) =>
              vscode.commands.executeCommand(command, ...argument),
            watchSigns: (reportSign) =>
              watchWikiUpdateSigns(
                {
                  onDidOpenTextDocument: vscode.workspace.onDidOpenTextDocument,
                  onDidStartTerminalShellExecution:
                    vscode.window.onDidStartTerminalShellExecution,
                },
                {
                  outputDirectory,
                  skillDirectory: join(
                    context.extensionPath,
                    'skills',
                    'codebook',
                  ),
                },
                reportSign,
              ),
            readOutputStamp: () => readWikiWatchStamp(outputDirectory),
            signal: run.controller.signal,
            bounds: {
              sessionStartMs: WIKI_CHAT_SESSION_START_TIMEOUT_MS,
              answerMs: WIKI_CHAT_OPEN_TIMEOUT_MS,
              withdrawSettleMs: WIKI_CHAT_WITHDRAW_SETTLE_MS,
              outputPollMs: WIKI_UPDATE_WATCH_POLL_MS,
            },
          })
          // Only a chat that works on the request is watched; a window that began to close meanwhile starts no watch that its shutdown no longer finds.
          const startEnd = endOfWikiChatStart(
            chatStart,
            WIKI_CHAT_OPEN_TIMEOUT_MS,
            isExtensionStopping || run.controller.signal.aborted,
          )
          if (startEnd) {
            await finishWikiUpdate(run, startEnd)
            return
          }
          chatReply = chatStart.reply
        } finally {
          if (activeWikiRun === opening) activeWikiRun = undefined
          reportOpeningEnded()
        }
        // A chat that works says nothing more until its reply ends, so the extension watches for the publish itself and for that end; the watch outlives this call.
        void track(watchVsCodeWikiUpdate(run, chatReply))
      } catch (error) {
        // A run whose end was recorded has nothing left to end; what was thrown is the caller's.
        if (!wikiUpdateRun.isRunning()) throw error
        await finishWikiUpdate(run, { failure: thrownMessage(error) })
      }
    })()
    wikiUpdate = attempt
    try {
      await attempt
    } finally {
      if (wikiUpdate === attempt) wikiUpdate = undefined
    }
  }
  if (vscode.window?.registerUriHandler)
    context.subscriptions.push(
      vscode.window.registerUriHandler({
        handleUri: async (incomingUri) => {
          if (
            incomingUri.path !== '/source' &&
            incomingUri.path !== '/update' &&
            incomingUri.path !== '/settings'
          )
            return
          try {
            const parameters = new URLSearchParams(incomingUri.query)
            const projectRoot = await realpath(requireWorkspace())
            const citedRoot = parameters.get('root') ?? ''
            if (incomingUri.path === '/settings') {
              // Settings must open in the editor window that owns this Wiki's project.
              if (citedRoot !== projectRoot)
                throw new Error(
                  'The Wiki settings link belongs to another checkout.',
                )
              await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                '@id:codebook.wikiOutputDirectory',
              )
              return
            }
            if (incomingUri.path === '/update') {
              if (citedRoot !== projectRoot)
                throw new Error(
                  'The Wiki update link belongs to another checkout.',
                )
              // Any page can open this link and the project root is printed in the Wiki, so only an explicit in-editor choice starts the agent.
              const updateChoice = 'Update LLM Wiki'
              const { outputDirectory } = await wikiLocation()
              const isOutputOutsideProject =
                wikiOutputLabel(projectRoot, outputDirectory) ===
                outputDirectory
              // The request starts a new chat where the editor has one, and the chat asks to approve every step outside the workspace; the learner should know both before confirming.
              const agentAccess = isCursorHost
                ? 'Cursor Agent runs without further prompts and can edit files and run commands in this project.'
                : `${describeWikiChatHandOver(await vscode.commands.getCommands(true))}${isOutputOutsideProject ? ` ${WIKI_OUTSIDE_OUTPUT_APPROVALS_NOTE}` : ''}`
              // A learner who confirms must not be told afterwards that nothing will start.
              if (wikiUpdateRun.isRunning()) {
                showWikiUpdateRunning()
                return
              }
              const choice = await vscode.window.showWarningMessage(
                'Update this project’s LLM Wiki with the editor agent?',
                { modal: true, detail: `${projectRoot}\n\n${agentAccess}` },
                updateChoice,
              )
              if (choice !== updateChoice) return
              await updateDeepWiki()
              return
            }
            const citedPath = parameters.get('path') ?? ''
            const citedHash = parameters.get('sha256') ?? undefined
            const lineText = parameters.get('line') ?? '1'
            if (!/^[1-9]\d*$/.test(lineText))
              throw new Error('The Wiki citation has an invalid line number.')
            const { filePath, changed } = await resolveDeepWikiSource(
              projectRoot,
              citedRoot,
              citedPath,
              citedHash,
            )
            const document = await vscode.workspace.openTextDocument(
              vscode.Uri.file(filePath),
            )
            const line = Math.min(
              Number(lineText) - 1,
              Math.max(0, document.lineCount - 1),
            )
            const position = new vscode.Position(line, 0)
            await vscode.window.showTextDocument(document, {
              preview: false,
              selection: new vscode.Range(position, position),
            })
            if (changed)
              void showNotice(
                'warning',
                'This Wiki citation has no matching source hash or its source has changed. The editor opened the current file; verify the cited revision before relying on it.',
              )
          } catch (error) {
            const action =
              incomingUri.path === '/settings'
                ? 'open Wiki output settings'
                : incomingUri.path === '/update'
                  ? 'start the Wiki update'
                  : 'open the Wiki citation'
            // An update that failed before any state was recorded reads without the `Error:` prefix.
            void showNotice(
              'error',
              `Codebook could not ${action}: ${incomingUri.path === '/update' ? thrownMessage(error) : String(error)}`,
            )
          }
        },
      }),
    )
  context.subscriptions.push(
    registerCommand('codebook.startAgentServer', start),
    registerCommand('codebook.stopAgentServer', stop),
    registerCommand('codebook.copyAgentConnection', connect),
    registerCommand('codebook.setupAiChat', setupAiChat),
    registerCommand('codebook.removeManagedCursorSkill', async () => {
      if (!isCursorHost)
        throw new Error('This command is available in Cursor only.')
      if (cursorRemoval) return cursorRemoval
      const choice = await vscode.window.showWarningMessage(
        'Remove the Codebook-owned user skill and its unchanged empty MCP catalog config from Cursor? Other Cursor windows share this skill.',
        { modal: true },
        'Remove managed skill',
      )
      if (choice !== 'Remove managed skill') return
      if (cursorRemoval) return cursorRemoval
      const attempt = (async () => {
        cursorRemoving = true
        try {
          // Setup and auto reconnect must finish before removing their shared skill, registration, and catalog.
          await cursorSetup?.catch(() => {})
          await cursorRegistration?.attempt.catch(() => {})
          const ownedCatalogGeneration =
            await captureOwnedCursorMcpCatalogGeneration(
              context.globalStorageUri.fsPath,
            )
          await removeManagedCursorSkill(context.globalStorageUri.fsPath)
          await context.workspaceState.update('codebook.aiChatSetup', undefined)
          if (registeredCursorServer) {
            vscode.cursor?.mcp?.unregisterServer(registeredCursorServer)
            registeredCursorServer = undefined
          }
          try {
            const catalogCleanup = ownedCatalogGeneration
              ? await removeOwnedCursorMcpCatalog(
                  context.globalStorageUri.fsPath,
                  undefined,
                  ownedCatalogGeneration,
                )
              : 'not-owned'
            void showNotice(
              'information',
              catalogCleanup === 'removed'
                ? 'Managed Cursor skill removed; Codebook-owned empty MCP catalog config retired. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.'
                : 'Managed Cursor skill removed. Existing or changed Cursor MCP config preserved. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
            )
          } catch (error) {
            void showNotice(
              'warning',
              `Managed Cursor skill removed, but its empty MCP catalog config cleanup is incomplete: ${String(error)}. No unverified file was deleted; inspect the private recovery record, restore setup, then retry removal.`,
            )
          }
        } finally {
          cursorRemoving = false
        }
      })()
      cursorRemoval = attempt
      try {
        await attempt
      } finally {
        if (cursorRemoval === attempt) cursorRemoval = undefined
      }
    }),
    registerCommand('codebook.restoreManagedCursorSkill', async () => {
      if (!isCursorHost)
        throw new Error('This command is available in Cursor only.')
      await setupAiChat()
    }),
    registerCommand('codebook.openStudyWorkspace', () => workspace().open()),
    registerCommand('codebook.closeStudyWorkspace', () => reader?.close()),
    registerCommand('codebook.openRepositoryWiki', async (input?: unknown) => {
      try {
        await repository().open(
          input === undefined
            ? undefined
            : repositorySelectionSchema.parse(input),
        )
      } catch (error) {
        // Cold failures have no Wiki panel; report them without waiting for notification dismissal or swallowing rejection.
        void showNotice(
          'error',
          `Codebook could not open Repository Wiki: ${String(error)}`,
        )
        throw error
      }
    }),
    // A second command while the first is still opening joins it: two opens in flight would each start a reader, and the failure of one would close the other's.
    registerCommand(
      'codebook.openDeepWiki',
      joinInFlight(async () => {
        try {
          const { projectRoot, outputDirectory } = await currentDeepWiki()
          await deepWikiReader?.close()
          deepWikiReader = undefined
          const openedReader = await startDeepWikiReader(
            outputDirectory,
            projectRoot,
            async (question, sources, signal) => {
              if ((await realpath(requireWorkspace())) !== projectRoot)
                throw new Error(
                  'The opened repository changed. Reopen its Wiki.',
                )
              const models = vscode.lm?.selectChatModels
                ? await vscode.lm.selectChatModels()
                : []
              // The browser tab may have been closed while the editor listed its models: a question nobody waits for is not sent.
              signal.throwIfAborted()
              if (!models.length) {
                if (isCursorHost) {
                  const cancellation = new vscode.CancellationTokenSource()
                  signal.addEventListener(
                    'abort',
                    () => cancellation.cancel(),
                    {
                      once: true,
                    },
                  )
                  try {
                    return await answerDeepWikiQuestionWithPrompt(
                      (prompt) =>
                        requestCursorWikiText(prompt, cancellation.token),
                      projectRoot,
                      sources,
                      question,
                      'cursor',
                    )
                  } finally {
                    cancellation.dispose()
                  }
                }
                const { outputDirectory } = await currentDeepWiki()
                const query = `/codebook Answer this repository question using the opened project's source and the Wiki at ${JSON.stringify(join(outputDirectory, WIKI_MANIFEST_FILE))}. Cite the supporting file and line for each claim. Do not edit files, start the application or use a debugger. Question: ${JSON.stringify(question)}`
                await vscode.commands.executeCommand(
                  'workbench.action.chat.open',
                  { query, isPartialQuery: true },
                )
                return {
                  handoff:
                    'This editor exposes no model to the Wiki reader. Your question is ready in the editor chat. Send it there for a source-cited answer.',
                }
              }
              const automatic = models.find((model) =>
                /auto/i.test(`${model.id} ${model.name}`),
              )
              const chosen = automatic
                ? undefined
                : await vscode.window.showQuickPick(
                    models.map((model) => ({
                      label: model.name,
                      description: model.vendor,
                      model,
                    })),
                    {
                      placeHolder:
                        'Choose the editor model for this Wiki question',
                    },
                  )
              // The same holds for a tab closed while the learner chose a model.
              signal.throwIfAborted()
              const model = automatic ?? chosen?.model
              if (!model)
                throw new Error(
                  'No editor model was selected for this Wiki question.',
                )
              const cancellation = new vscode.CancellationTokenSource()
              signal.addEventListener('abort', () => cancellation.cancel(), {
                once: true,
              })
              try {
                return await answerDeepWikiQuestion(
                  model,
                  projectRoot,
                  sources,
                  question,
                  isCursorHost ? 'cursor' : 'vscode',
                  cancellation.token,
                )
              } finally {
                cancellation.dispose()
              }
            },
            isCursorHost ? 'cursor' : 'vscode',
            () => wikiUpdateRun.status(),
          )
          // A source also changes without a save in this editor (an agent's CLI and Git write files directly), so the project's files are watched for as long as the reader serves.
          const sourceWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(projectRoot, '**'),
          )
          const noteSourceChange = (file: vscode.Uri): void =>
            openedReader.noteSourceChange(file.fsPath)
          sourceWatcher.onDidChange(noteSourceChange)
          sourceWatcher.onDidCreate(noteSourceChange)
          sourceWatcher.onDidDelete(noteSourceChange)
          deepWikiReader = {
            ...openedReader,
            close: async (): Promise<void> => {
              sourceWatcher.dispose()
              await openedReader.close()
            },
          }
          const readerAddress = vscode.Uri.parse(openedReader.url)
          // In a remote window the editor forwards the reader's port, often to another one, and the page then asks its questions from that address. The browser is still sent to the reader's own address: the editor resolves what it opens by itself.
          openedReader.acceptForwardedOrigin(
            (await vscode.env.asExternalUri(readerAddress)).toString(),
          )
          if (!(await vscode.env.openExternal(readerAddress)))
            throw new Error('The browser did not open the generated DeepWiki.')
        } catch (error) {
          await deepWikiReader?.close()
          deepWikiReader = undefined
          void showNotice(
            'error',
            `Codebook could not open DeepWiki: ${String(error)}. Generate it through /codebook in this project, then retry.`,
          )
          throw error
        }
      }),
    ),
    registerCommand('codebook.updateDeepWiki', async () => {
      try {
        await updateDeepWiki()
      } catch (error) {
        void showNotice(
          'error',
          `Codebook could not start the Wiki update: ${thrownMessage(error)}`,
        )
        throw error
      }
    }),
    registerCommand('codebook.saveLearningReplay', async (studyId?: string) => {
      try {
        await workspace().saveLearningReplay(studyId)
      } catch (error) {
        void showNotice(
          'error',
          `Codebook could not save learning: ${String(error)}`,
        )
        throw error
      }
    }),
    registerCommand('codebook.showLearningSummary', () =>
      workspace().showLearningSummary(),
    ),
    registerCommand('codebook.moveLearningSummary', () =>
      workspace().moveLearningSummary(),
    ),
    registerCommand('codebook.openLearningReplay', (studyId: string) =>
      workspace().openLearningReplay(studyId),
    ),
    registerCommand('codebook.closeRepositoryWiki', () =>
      repositoryReader?.close(),
    ),
    registerCommand('codebook.repository.action', (action: unknown) =>
      repository().action(repositoryActionSchema.parse(action)),
    ),
    registerCommand('codebook.repository.understand', (understood: unknown) => {
      if (typeof understood !== 'boolean')
        throw new Error('Understanding requires a boolean learner choice.')
      return repository().understand(understood)
    }),
    registerCommand('codebook.selectLearningItem', (itemId) =>
      workspace().select(learningItemSchema.parse(itemId)),
    ),
    registerCommand('codebook.markUnderstanding', (understood) => {
      if (understood !== undefined && typeof understood !== 'boolean')
        throw new Error('Understanding requires a boolean learner choice.')
      return workspace().understand(understood)
    }),
    ...(
      [
        'run',
        'click',
        'continue',
        'stop',
        'return-current',
        'return-wiki',
        'source',
        'current-file',
        'focus-app',
        'focus-context',
        'read-app',
        'read-source',
        'read-context',
        'outline',
        'arrange',
        'retry',
      ] as const
    ).map((action) =>
      registerCommand(`codebook.study.${action}`, () =>
        workspace().action(action),
      ),
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void (async () => {
        try {
          await context.workspaceState.update('codebook.aiChatSetup', undefined)
        } finally {
          const closingReader = deepWikiReader
          deepWikiReader = undefined
          try {
            await stop()
            await repositoryReader?.dispose()
            repositoryReader = undefined
            await reader?.dispose()
            reader = undefined
            repository()
          } finally {
            await closingReader?.close()
          }
        }
      })().catch((error) =>
        showNotice('error', `Codebook cleanup incomplete: ${String(error)}`),
      )
    }),
  )
  // Register lazy readers before restored captured documents or contributed views request their providers.
  workspace()
  repository()
  if (
    context.workspaceState.get<{ workspace: string }>('codebook.aiChatSetup')
  ) {
    void (async () => {
      if (!setupMatchesCurrentWorkspace())
        throw new Error('The selected workspace changed after setup')
      if (isCursorHost)
        await verifyManagedCursorSkill(
          context.extensionPath,
          context.globalStorageUri.fsPath,
        )
      await start()
      notifyMcpDefinitions()
    })().catch((error) => {
      void showNotice(
        'warning',
        noticeWithSetupStep(
          'Codebook AI chat did not reconnect',
          error,
          'Run Codebook: Set Up AI Chat.',
        ),
      )
    })
  }
  return {
    inspectStudy: () => reader?.inspect(),
    inspectRepository: () => repositoryReader?.inspect(),
  }
}

/** Lets the editor await owned cleanup instead of fire-and-forget disposal during extension shutdown. @example await deactivate() */
export async function deactivate(): Promise<void> {
  await stopExtension?.()
}

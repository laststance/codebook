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
  WIKI_UPDATE_WATCH_POLL_MS,
  WIKI_UPDATE_WATCH_TIMEOUT_MS,
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
import {
  answerDeepWikiQuestion,
  answerDeepWikiQuestionWithPrompt,
} from './utils/answerDeepWikiQuestion'
import { describeUpdateFailure } from './utils/describeUpdateFailure'
import { detectWikiPublishConflicts } from './utils/detectWikiPublishConflicts'
import { inspectDeepWikiFreshness } from './utils/inspectDeepWikiFreshness'
import {
  captureOwnedCursorMcpCatalogGeneration,
  refreshCursorMcpCatalog,
  removeOwnedCursorMcpCatalog,
} from './utils/refreshCursorMcpCatalog'
import { requestCursorWikiText } from './utils/requestCursorWikiText'
import { resolveDeepWikiDirectory } from './utils/resolveDeepWikiDirectory'
import { resolveDeepWikiSource } from './utils/resolveDeepWikiSource'
import { resolveExternalNodeExecutable } from './utils/resolveExternalNodeExecutable'
import { runCursorWikiUpdate } from './utils/runCursorWikiUpdate'
import { waitForWikiPublish } from './utils/waitForWikiPublish'
import { wikiManifestIdentity } from './utils/wikiManifestIdentity'
import { wikiOutputLabel } from './utils/wikiOutputLabel'
import { WikiUpdateRun } from './utils/wikiUpdateRun'

let stopExtension: (() => Promise<void>) | undefined

/** Registers explicit trusted commands without reading auto-run instructions from repository files. @example VS Code calls activate(context) */
export function activate(
  context: Pick<vscode.ExtensionContext, 'extensionPath' | 'subscriptions'> & {
    globalStorageUri: Pick<vscode.Uri, 'fsPath'>
    workspaceState: Pick<vscode.Memento, 'get' | 'update'>
  },
) {
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
  let wikiWatch: AbortController | undefined
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
        await writeFile(descriptorPath, JSON.stringify(endpoint.descriptor), {
          mode: PRIVATE_FILE_MODE,
          flag: 'wx',
        })
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
            void vscode.window.showWarningMessage(
              `Codebook agent server started, but Cursor MCP registration failed: ${String(error)}. Run Codebook: Set Up AI Chat to repair the connection.`,
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
    void vscode.window.showInformationMessage(
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
    void vscode.window.showInformationMessage(
      isCursorHost
        ? 'Codebook skill and workspace setup saved. Check Cursor Customize > MCPs for Codebook before using /codebook; if absent, close and reopen this work window.'
        : 'Codebook AI chat is ready for this workspace. Open a new chat and choose /codebook.',
    )
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
    wikiWatch?.abort()
    try {
      await stop()
      await repositoryReader?.dispose()
      await reader?.dispose()
    } finally {
      await deepWikiReader?.close()
    }
  }
  /** Checks the generated Wiki's owner before browser or update entry uses it. @example await currentDeepWiki() // => { projectRoot, outputDirectory, entry } */
  const currentDeepWiki = async () => {
    const projectRoot = await realpath(requireWorkspace())
    const setting = vscode.workspace
      .getConfiguration('codebook')
      .get<string>('wikiOutputDirectory', '.codebook/wiki')
    const outputDirectory = resolveDeepWikiDirectory(projectRoot, setting)
    const manifest: unknown = JSON.parse(
      await readFile(join(outputDirectory, 'codebook-wiki.json'), 'utf8'),
    )
    // A generated page from another checkout must not masquerade as this project's Wiki.
    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      !('schemaVersion' in manifest) ||
      manifest.schemaVersion !== 1 ||
      !('repositoryRoot' in manifest) ||
      manifest.repositoryRoot !== projectRoot
    )
      throw new Error(
        'The DeepWiki manifest does not identify this opened project.',
      )
    const entry = join(outputDirectory, 'index.html')
    await readFile(entry)
    return { projectRoot, outputDirectory, entry }
  }
  /** Reads the published manifest's identity and sources; undefined while it is missing, mid-replacement or invalid. @example await readPublishedWiki('/repo', '/repo/.codebook/wiki') // => { identity: 'a1b2c3d4e5f6+0f9e8d7c', ... } */
  const readPublishedWiki = async (
    projectRoot: string,
    outputDirectory: string,
  ) => {
    try {
      const published = await readDeepWikiManifest(outputDirectory, projectRoot)
      return {
        ...published,
        identity: wikiManifestIdentity(published.sources, published.revision),
      }
    } catch {
      return undefined
    }
  }
  /** Whether the published site's sources match the project now. @example await isPublishedWikiCurrent('/repo', published) // => true */
  const isPublishedWikiCurrent = async (
    projectRoot: string,
    published: NonNullable<Awaited<ReturnType<typeof readPublishedWiki>>>,
  ): Promise<boolean> =>
    (
      await inspectDeepWikiFreshness(
        projectRoot,
        published.sources,
        published.revision,
        published.excludedPaths,
      )
    ).status === 'current'
  /** Watches for the editor agent's publish after VS Code's chat opened, then records the run's result for the reader. @example watchVsCodeWikiUpdate('/repo', '/repo/.codebook/wiki', 'a+1') */
  const watchVsCodeWikiUpdate = (
    projectRoot: string,
    outputDirectory: string,
    startIdentity: string | undefined,
    startedAtMs: number,
  ): void => {
    const controller = new AbortController()
    wikiWatch = controller
    const watch = async (token?: vscode.CancellationToken): Promise<void> => {
      token?.onCancellationRequested(() => controller.abort())
      try {
        const result = await waitForWikiPublish({
          startIdentity,
          readIdentity: async () =>
            (await readPublishedWiki(projectRoot, outputDirectory))?.identity,
          isCurrent: async () => {
            const published = await readPublishedWiki(
              projectRoot,
              outputDirectory,
            )
            return published
              ? isPublishedWikiCurrent(projectRoot, published)
              : false
          },
          findBlockingFiles: () =>
            detectWikiPublishConflicts(outputDirectory, startedAtMs),
          signal: controller.signal,
          timeoutMs: WIKI_UPDATE_WATCH_TIMEOUT_MS,
          pollMs: WIKI_UPDATE_WATCH_POLL_MS,
        })
        if (result.outcome === 'published') {
          wikiUpdateRun.succeed(result.identity)
          void vscode.window.showInformationMessage(
            'Codebook found the updated LLM Wiki. Reopen or reload the browser reader to read the new pages.',
          )
        } else if (result.outcome === 'not-current')
          wikiUpdateRun.fail(
            'The editor agent published a Wiki that is not verified current. Inspect its freshness and retry the update.',
            'replaced',
          )
        else if (result.outcome === 'blocked')
          wikiUpdateRun.conflict(result.paths, 'learner-file', 'kept')
        else if (result.outcome === 'cancelled') wikiUpdateRun.cancel('kept')
        else wikiUpdateRun.timeOut('kept')
      } catch (error) {
        wikiUpdateRun.fail(describeUpdateFailure(error), 'kept')
      } finally {
        if (wikiWatch === controller) wikiWatch = undefined
      }
    }
    void (vscode.window.withProgress
      ? vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Waiting for the editor AI to publish the LLM Wiki update',
            cancellable: true,
          },
          async (_, token) => watch(token),
        )
      : watch())
  }
  /** Starts a project-bound skill update from the browser or command, coalescing repeated clicks. @example await updateDeepWiki() */
  const updateDeepWiki = async (): Promise<void> => {
    if (wikiUpdate) return wikiUpdate
    const attempt = (async () => {
      const { projectRoot, outputDirectory } = await currentDeepWiki()
      // A run that outlives this call (the VS Code watch) still blocks a second start from any entry.
      if (wikiUpdateRun.isRunning()) {
        void vscode.window.showInformationMessage(
          'Codebook is already updating this project’s LLM Wiki.',
        )
        return
      }
      const wikiOutput = {
        outputDirectory,
        outputLabel: wikiOutputLabel(projectRoot, outputDirectory),
      }
      const before = await readPublishedWiki(projectRoot, outputDirectory)
      if (before && (await isPublishedWikiCurrent(projectRoot, before))) {
        wikiUpdateRun.alreadyCurrent(wikiOutput, before.identity)
        void vscode.window.showInformationMessage(
          'This project’s LLM Wiki already matches the current source; nothing to update.',
        )
        return
      }
      const startedAtMs = Date.now()
      wikiUpdateRun.begin(
        isCursorHost ? 'cursor' : 'vscode',
        wikiOutput,
        WIKI_UPDATE_WATCH_TIMEOUT_MS,
      )
      const query = `/codebook Update LLM Wiki for this opened repository. Read ${JSON.stringify(join(outputDirectory, 'codebook-wiki.json'))} and the installed Codebook skill. Reinspect current source, preserve manual files and the last usable Wiki on failure, then report changed pages and citations. Do not start a debugger or application.`
      if (!isCursorHost) {
        try {
          await vscode.commands.executeCommand('workbench.action.chat.open', {
            query,
            isPartialQuery: false,
          })
        } catch (error) {
          wikiUpdateRun.fail(describeUpdateFailure(error), 'kept')
          throw error
        }
        // The chat API reports no result, so the extension watches for the publish itself.
        watchVsCodeWikiUpdate(
          projectRoot,
          outputDirectory,
          before?.identity,
          startedAtMs,
        )
        return
      }
      let cursorToken: vscode.CancellationToken | undefined
      const update = async (
        token?: vscode.CancellationToken,
      ): Promise<string> => {
        cursorToken = token
        await runCursorWikiUpdate(projectRoot, query, token)
        // A successful CLI exit alone does not prove that the correct project's site is readable.
        if ((await realpath(requireWorkspace())) !== projectRoot)
          throw new Error(
            'The opened repository changed during the Wiki update. Reopen its Wiki to inspect the result.',
          )
        const current = await currentDeepWiki()
        const published = await readDeepWikiManifest(
          current.outputDirectory,
          projectRoot,
        )
        const freshness = await inspectDeepWikiFreshness(
          projectRoot,
          published.sources,
          published.revision,
          published.excludedPaths,
        )
        if (freshness.status !== 'current')
          throw new Error(
            'Cursor Agent finished, but the published Wiki is not verified current. Inspect its freshness and retry the update.',
          )
        void vscode.window.showInformationMessage(
          'Codebook updated this project’s LLM Wiki. Reopen the browser reader to inspect the published pages.',
        )
        return wikiManifestIdentity(published.sources, published.revision)
      }
      try {
        wikiUpdateRun.succeed(
          vscode.window.withProgress
            ? await vscode.window.withProgress(
                {
                  location: vscode.ProgressLocation.Notification,
                  title: 'Updating LLM Wiki with Cursor Agent',
                  cancellable: true,
                },
                async (_, token) => update(token),
              )
            : await update(),
        )
      } catch (error) {
        // A refused candidate is the learner's file in the way, not a failed agent.
        const blocking = await detectWikiPublishConflicts(
          outputDirectory,
          startedAtMs,
        ).catch(() => [])
        if (cursorToken?.isCancellationRequested) wikiUpdateRun.cancel('kept')
        else if (blocking.length)
          wikiUpdateRun.conflict(blocking, 'learner-file', 'kept')
        else wikiUpdateRun.fail(describeUpdateFailure(error), 'kept')
        throw error
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
              const agentAccess = isCursorHost
                ? 'Cursor Agent runs without further prompts and can edit files and run commands in this project.'
                : 'Copilot Chat receives the update request for this project.'
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
              void vscode.window.showWarningMessage(
                'This Wiki citation has no matching source hash or its source has changed. The editor opened the current file; verify the cited revision before relying on it.',
              )
          } catch (error) {
            const action =
              incomingUri.path === '/settings'
                ? 'open Wiki output settings'
                : incomingUri.path === '/update'
                  ? 'start the Wiki update'
                  : 'open the Wiki citation'
            void vscode.window.showErrorMessage(
              `Codebook could not ${action}: ${String(error)}`,
            )
          }
        },
      }),
    )
  context.subscriptions.push(
    vscode.commands.registerCommand('codebook.startAgentServer', start),
    vscode.commands.registerCommand('codebook.stopAgentServer', stop),
    vscode.commands.registerCommand('codebook.copyAgentConnection', connect),
    vscode.commands.registerCommand('codebook.setupAiChat', setupAiChat),
    vscode.commands.registerCommand(
      'codebook.removeManagedCursorSkill',
      async () => {
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
            await context.workspaceState.update(
              'codebook.aiChatSetup',
              undefined,
            )
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
              void vscode.window.showInformationMessage(
                catalogCleanup === 'removed'
                  ? 'Managed Cursor skill removed; Codebook-owned empty MCP catalog config retired. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.'
                  : 'Managed Cursor skill removed. Existing or changed Cursor MCP config preserved. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.',
              )
            } catch (error) {
              void vscode.window.showWarningMessage(
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
      },
    ),
    vscode.commands.registerCommand(
      'codebook.restoreManagedCursorSkill',
      async () => {
        if (!isCursorHost)
          throw new Error('This command is available in Cursor only.')
        await setupAiChat()
      },
    ),
    vscode.commands.registerCommand('codebook.openStudyWorkspace', () =>
      workspace().open(),
    ),
    vscode.commands.registerCommand('codebook.selectPresentation', () =>
      workspace().selectPresentation(),
    ),
    vscode.commands.registerCommand('codebook.closeStudyWorkspace', () =>
      reader?.close(),
    ),
    vscode.commands.registerCommand(
      'codebook.openRepositoryWiki',
      async (input?: unknown) => {
        try {
          await repository().open(
            input === undefined
              ? undefined
              : repositorySelectionSchema.parse(input),
          )
        } catch (error) {
          // Cold failures have no Wiki panel; report them without waiting for notification dismissal or swallowing rejection.
          void vscode.window.showErrorMessage(
            `Codebook could not open Repository Wiki: ${String(error)}`,
          )
          throw error
        }
      },
    ),
    vscode.commands.registerCommand('codebook.openDeepWiki', async () => {
      try {
        const { projectRoot, outputDirectory } = await currentDeepWiki()
        await deepWikiReader?.close()
        deepWikiReader = undefined
        const openedReader = await startDeepWikiReader(
          outputDirectory,
          projectRoot,
          async (question, sources, signal) => {
            if ((await realpath(requireWorkspace())) !== projectRoot)
              throw new Error('The opened repository changed. Reopen its Wiki.')
            const models = vscode.lm?.selectChatModels
              ? await vscode.lm.selectChatModels()
              : []
            if (!models.length) {
              if (isCursorHost) {
                const cancellation = new vscode.CancellationTokenSource()
                signal.addEventListener('abort', () => cancellation.cancel(), {
                  once: true,
                })
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
              const query = `/codebook Answer this repository question using the opened project's source and the Wiki at ${JSON.stringify(join(outputDirectory, 'codebook-wiki.json'))}. Cite the supporting file and line for each claim. Do not edit files, start the application or use a debugger. Question: ${JSON.stringify(question)}`
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
        deepWikiReader = openedReader
        if (
          !(await vscode.env.openExternal(vscode.Uri.parse(openedReader.url)))
        )
          throw new Error('The browser did not open the generated DeepWiki.')
      } catch (error) {
        await deepWikiReader?.close()
        deepWikiReader = undefined
        void vscode.window.showErrorMessage(
          `Codebook could not open DeepWiki: ${String(error)}. Generate it through /codebook in this project, then retry.`,
        )
        throw error
      }
    }),
    vscode.commands.registerCommand('codebook.updateDeepWiki', async () => {
      try {
        await updateDeepWiki()
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Codebook could not start the Wiki update: ${String(error)}`,
        )
        throw error
      }
    }),
    vscode.commands.registerCommand(
      'codebook.saveLearningReplay',
      async (studyId?: string) => {
        try {
          await workspace().saveLearningReplay(studyId)
        } catch (error) {
          void vscode.window.showErrorMessage(
            `Codebook could not save learning: ${String(error)}`,
          )
          throw error
        }
      },
    ),
    vscode.commands.registerCommand('codebook.showLearningSummary', () =>
      workspace().showLearningSummary(),
    ),
    vscode.commands.registerCommand(
      'codebook.openLearningReplay',
      (studyId: string) => workspace().openRecording(studyId),
    ),
    vscode.commands.registerCommand('codebook.closeRepositoryWiki', () =>
      repositoryReader?.close(),
    ),
    vscode.commands.registerCommand(
      'codebook.repository.action',
      (action: unknown) =>
        repository().action(repositoryActionSchema.parse(action)),
    ),
    vscode.commands.registerCommand(
      'codebook.repository.understand',
      (understood: unknown) => {
        if (typeof understood !== 'boolean')
          throw new Error('Understanding requires a boolean learner choice.')
        return repository().understand(understood)
      },
    ),
    vscode.commands.registerCommand('codebook.selectLearningItem', (itemId) =>
      workspace().select(learningItemSchema.parse(itemId)),
    ),
    vscode.commands.registerCommand(
      'codebook.markUnderstanding',
      (understood) => {
        if (understood !== undefined && typeof understood !== 'boolean')
          throw new Error('Understanding requires a boolean learner choice.')
        return workspace().understand(understood)
      },
    ),
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
      vscode.commands.registerCommand(`codebook.study.${action}`, () =>
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
        vscode.window.showErrorMessage(
          `Codebook cleanup incomplete: ${String(error)}`,
        ),
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
      void vscode.window.showWarningMessage(
        `Codebook AI chat did not reconnect: ${String(error)}. Run Codebook: Set Up AI Chat.`,
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

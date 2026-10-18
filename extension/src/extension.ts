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
  WIKI_CHAT_WATCH_CANCEL_COMMAND,
  WIKI_CHAT_WITHDRAW_SETTLE_MS,
  WIKI_CURSOR_TERMINATION_GRACE_MS,
  WIKI_CURSOR_UPDATE_TIMEOUT_MS,
  WIKI_ENTRY_FILE,
  WIKI_MANIFEST_FILE,
  WIKI_OUTSIDE_OUTPUT_APPROVALS_NOTE,
  WIKI_UPDATE_LAST_RUN_STATE_KEY,
  WIKI_UPDATE_MARKER_CHANGE_RETRIES,
  WIKI_UPDATE_MARKER_CHANGE_RETRY_DELAY_MS,
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
import { StudyWorkspace, type UnsavedStudyArchive } from './studyWorkspace'
import { aiChatReadyMessage } from './utils/aiChatReadyMessage'
import {
  answerDeepWikiQuestion,
  answerDeepWikiQuestionWithPrompt,
} from './utils/answerDeepWikiQuestion'
import { assertNoLinkOnWikiPath } from './utils/assertNoLinkOnWikiPath'
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
import {
  cursorCatalogCleanupNotice,
  REMOVE_MANAGED_CURSOR_SKILL_COMMAND,
} from './utils/cursorCatalogCleanupNotice'
import { cursorRemovalNotice } from './utils/cursorRemovalNotice'
import { deepWikiOpenFailureNotice } from './utils/deepWikiOpenFailureNotice'
import { describeBrokenWikiWatch } from './utils/describeBrokenWikiWatch'
import {
  describeSecondWikiUpdateStart,
  type WikiUpdateProgressPlace,
} from './utils/describeSecondWikiUpdateStart'
import { describeWikiChatHandOver } from './utils/describeWikiChatHandOver'
import { detectWikiPublishConflicts } from './utils/detectWikiPublishConflicts'
import { endOfWikiChatStart } from './utils/endOfWikiChatStart'
import { failureOfWikiChatReplyEnd } from './utils/failureOfWikiChatReplyEnd'
import { findWikiUpdateStartBlock } from './utils/findWikiUpdateStartBlock'
import {
  folderChangeCleanupNotice,
  type FolderChangeCleanupFailure,
  type FolderChangeCleanupStep,
} from './utils/folderChangeCleanupNotice'
import { formatClockTime } from './utils/formatClockTime'
import { hasWikiPublishEndedWait } from './utils/hasWikiPublishEndedWait'
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
import { readWikiFileToOpen } from './utils/readWikiFileToOpen'
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
import { showWikiChatWatchStatus } from './utils/showWikiChatWatchStatus'
import { SET_UP_AI_CHAT_COMMAND } from './utils/startOverBy'
import {
  startWikiChatUpdate,
  type WikiChatStart,
} from './utils/startWikiChatUpdate'
import { thrownMessage } from './utils/thrownMessage'
import { unreadWikiUpdateEnd } from './utils/unreadWikiUpdateEnd'
import { waitForWikiPublish } from './utils/waitForWikiPublish'
import { watchWikiUpdateSigns } from './utils/watchWikiUpdateSigns'
import { wikiManifestIdentity } from './utils/wikiManifestIdentity'
import { wikiOutputLabel } from './utils/wikiOutputLabel'
import { OPEN_WIKI_ACTION, wikiUpdateNotice } from './utils/wikiUpdateNotice'
import {
  WikiUpdateRun,
  type WikiUpdateEnd,
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
  /** The study archives a disposed Study reader could not save, from the moment that reader hands them on until a new reader has taken them: the archive of a run whose service has ended exists nowhere else. */
  const unsavedStudies: UnsavedStudyArchive[] = []
  let repositoryReader: RepositoryReader | undefined
  /** Set while a change of the workspace's folders is handled, and settled when the readers have been replaced; it never rejects. Each change is handled after the one before it, and {@link start} waits for it: a server made meanwhile would be attached to the Study reader that is being disposed. */
  let replacingReaders: Promise<void> | undefined
  /** How often the server was asked to stop from outside the handling of changed folders: by Stop Agent Server and by the closing window ({@link stopOnRequest}). A start that waited for that handling reads it before and after its wait. */
  let stopsAskedFor = 0
  let deepWikiReader: DeepWikiReader | undefined
  let wikiUpdate: Promise<void> | undefined
  // One update run per window, shared by the command, the `/update` link and the browser button.
  const wikiUpdateRun = new WikiUpdateRun()
  // The active run of either host: its one abort, and a promise that settles once its watch or its agent has stopped. `awaitsChat` marks a VS Code update that still waits for the chat's first sign, whose watch is not shown yet.
  let activeWikiRun:
    | { controller: AbortController; settled: Promise<void>; awaitsChat?: true }
    | undefined
  // The Cancel of the VS Code watch whose status bar entry is shown: a press on the entry stops that watch, not the chat; nothing while no entry is shown.
  let cancelShownWikiChatWatch: (() => void) | undefined
  // How this window's last run of each Wiki output ended: a candidate written while it lasted is this window's own leftover, and a chat it left at work holds the next start of that output back. The workspace state keeps the latest run's record, so a reloaded window still has that one.
  const storedWikiRun = wikiLastRunSchema.safeParse(
    context.workspaceState.get(WIKI_UPDATE_LAST_RUN_STATE_KEY),
  ).data
  const lastWikiRuns = new Map<string, WikiLastRun>(
    storedWikiRun ? [[storedWikiRun.outputDirectory, storedWikiRun]] : [],
  )
  /** The output of the latest run's record, and whether the editor stored it; {@link dropWikiReservation} waits for it at shutdown before removing the reload's fallback reservation. */
  let lastWikiRunWrite:
    { outputDirectory: string; written: Promise<boolean> } | undefined
  // This window's id in the marker of a running update; another window's live marker refuses a start here.
  const wikiWindowId = randomUUID()
  // The reservation each of this window's stopped VS Code watches left on disk for other windows, by Wiki output, with the timer that removes it at that watch's bound.
  const wikiReservations = new Map<
    string,
    { release: () => Promise<boolean>; timer: NodeJS.Timeout }
  >()
  // The latest change of this window's own marker on each Wiki output (its removal, or its turn into a stopped watch's reservation), while it runs or waits for its next attempt, with the timer of that attempt.
  const wikiMarkerChanges = new Map<
    string,
    { change: () => Promise<boolean>; timer?: NodeJS.Timeout }
  >()
  /**
   * Makes a change of this window's own marker beside a Wiki (its removal, or its turn into a stopped watch's reservation), and while the change cannot be made asks for it again later; called by {@link settleWikiRunMarker} at a run's end and by {@link dropWikiReservation} at a reservation's bound or at shutdown.
   * Why: the change runs under the claim on the marker, which another window can hold longer than the change waits (a killed window of another machine leaves its claim for {@link WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS}), and the system can refuse the claim or the change. A run's marker left as it stands counts for every other window as a running update, with no Update anyway, until the run's bound has passed. A later change of the same output, and a start that takes the marker over, replace a change that waits: they name what the marker must be now.
   * @param outputDirectory - The Wiki output whose marker changes.
   * @param change - The removal or the turn into a reservation; it answers `true` once nothing of the run is left to change ({@link claimWikiUpdateMarker}).
   * @param retriesLeft - How often the change is asked for again after this attempt.
   * @returns Nothing, and it never rejects: a change still not made after {@link WIKI_UPDATE_MARKER_CHANGE_RETRIES} more attempts, {@link WIKI_UPDATE_MARKER_CHANGE_RETRY_DELAY_MS} apart, leaves the marker to its own expiry, and a closing window makes a waiting change once more at shutdown ({@link retryWikiMarkerChangesNow}).
   * @example await changeWikiMarker('/repo/.codebook/wiki', run.releaseMarker)
   */
  const changeWikiMarker = async (
    outputDirectory: string,
    change: () => Promise<boolean>,
    retriesLeft = WIKI_UPDATE_MARKER_CHANGE_RETRIES,
  ): Promise<void> => {
    clearTimeout(wikiMarkerChanges.get(outputDirectory)?.timer)
    const pending: { change: () => Promise<boolean>; timer?: NodeJS.Timeout } =
      { change }
    wikiMarkerChanges.set(outputDirectory, pending)
    const isChanged = await change().catch(() => false)
    // A later change of this output, or a start that took its marker over, replaced this one meanwhile.
    if (wikiMarkerChanges.get(outputDirectory) !== pending) return
    // A closing window keeps no timer: its shutdown makes the waiting changes once more.
    if (isChanged || retriesLeft === 0 || isExtensionStopping) {
      wikiMarkerChanges.delete(outputDirectory)
      return
    }
    pending.timer = setTimeout(() => {
      void changeWikiMarker(outputDirectory, change, retriesLeft - 1)
    }, WIKI_UPDATE_MARKER_CHANGE_RETRY_DELAY_MS).unref()
  }
  /** Drops the change of an output's marker that runs or waits for its next attempt; called when a start of this window took that marker over, which leaves the earlier run nothing to change. @param outputDirectory - The Wiki output whose marker this window's new run now holds. @example cancelWikiMarkerChange('/repo/.codebook/wiki') */
  const cancelWikiMarkerChange = (outputDirectory: string): void => {
    clearTimeout(wikiMarkerChanges.get(outputDirectory)?.timer)
    wikiMarkerChanges.delete(outputDirectory)
  }
  /** Makes every change of this window's markers that waits for its next attempt once more, now; called by {@link stopExtension} at shutdown, since a closing window keeps no timer and such a marker would otherwise count for other windows until it expires. A change that is running at that moment is not made twice. @example await retryWikiMarkerChangesNow() */
  const retryWikiMarkerChangesNow = async (): Promise<void> => {
    const waiting = [...wikiMarkerChanges.entries()].filter(
      ([, pending]) => pending.timer !== undefined,
    )
    await Promise.all(
      waiting.map(([outputDirectory, pending]) => {
        clearTimeout(pending.timer)
        wikiMarkerChanges.delete(outputDirectory)
        return pending.change().catch(() => false)
      }),
    )
  }
  /** Checks whether a reload needs the stopped watch's disk reservation; called by {@link dropWikiReservation} before releasing it. @param isWindowClosing - Whether this removal is part of shutdown. @param mayAgentStillWork - Whether the last run of the reservation's output left a chat that may publish. @param recordWritten - Whether the workspace state holds that run's record ({@link storedWikiRunWriteOf}), which never rejects. @returns `true` only at shutdown when a chat may still publish and its record could not be stored. @example await doesReloadNeedWikiReservation(true, true, Promise.resolve(false)) // => true */
  const doesReloadNeedWikiReservation = async (
    isWindowClosing: boolean,
    mayAgentStillWork: boolean | undefined,
    recordWritten: Promise<boolean> | undefined,
  ): Promise<boolean> =>
    isWindowClosing &&
    mayAgentStillWork === true &&
    (await recordWritten) === false
  /** Says whether the workspace state holds the record of an output's last run; called by {@link dropWikiReservation} at shutdown. @param outputDirectory - The Wiki output of the reservation. @returns The storage result of the latest write when it was that output's record; `false` when a later run of another output took its place there, so a reloaded window has no record of this output's chat. @example await storedWikiRunWriteOf('/repo/.codebook/wiki') // => false after a later run of '/repo/docs/wiki' */
  const storedWikiRunWriteOf = (outputDirectory: string): Promise<boolean> =>
    lastWikiRunWrite?.outputDirectory === outputDirectory
      ? lastWikiRunWrite.written
      : Promise.resolve(false)
  /** Removes this window's reservation of one Wiki output at its bound or shutdown; called by its timer and by {@link dropWikiReservations}. A record of the stopped watch that the workspace state does not hold (its write failed, or a later run of another output took its place) keeps the reservation for the reloaded window, which otherwise has no record of the chat that may still publish. @param outputDirectory - The Wiki output whose reservation is removed. @param isWindowClosing - Whether shutdown must first check that the record was stored. @example await dropWikiReservation('/repo/.codebook/wiki', true) */
  const dropWikiReservation = async (
    outputDirectory: string,
    isWindowClosing = false,
  ): Promise<void> => {
    const reservation = wikiReservations.get(outputDirectory)
    wikiReservations.delete(outputDirectory)
    if (!reservation) return
    clearTimeout(reservation.timer)
    // The disk marker is the reload's only protection when its stopped-watch record is not in storage.
    if (
      await doesReloadNeedWikiReservation(
        isWindowClosing,
        lastWikiRuns.get(outputDirectory)?.mayAgentStillWork,
        storedWikiRunWriteOf(outputDirectory),
      )
    )
      return
    await changeWikiMarker(outputDirectory, reservation.release)
  }
  /** Removes every reservation this window holds, each by {@link dropWikiReservation}; called by {@link stopExtension} at shutdown. @example await dropWikiReservations() */
  const dropWikiReservations = async (): Promise<void> => {
    await Promise.all(
      [...wikiReservations.keys()].map((outputDirectory) =>
        dropWikiReservation(outputDirectory, true),
      ),
    )
  }
  /** The button of a refusal that names an earlier chat's leftover: it starts the update with that leftover ignored. */
  const UPDATE_ANYWAY_ACTION = 'Update anyway'
  // A window that is closing has nobody to notify of the run its shutdown stops, and starts no run.
  let isExtensionStopping = false
  /** What the watch of a VS Code update takes from the start in the chat: the watch of the chat's reply. */
  type WatchedWikiChat = Pick<WikiChatStart, 'reply'>
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
    /** Removes this run's marker beside the Wiki, so another window may start; `false` while the claim on the marker could not be had and the marker stayed. */
    releaseMarker: () => Promise<boolean>
    /** Leaves the marker as the reservation of a watch that was stopped while its chat may still work, for other windows to read; `false` while the claim on the marker could not be had and the run's marker stayed. */
    reserveMarker: (watchEndedAtMs: number) => Promise<boolean>
    startedAtMs: number
    /** Folder names of the candidates the run's looks saw that were written since its start; a stopped VS Code watch keeps them for the next start, which tells the chat's own publish by them ({@link hasWikiPublishEndedWait}). */
    seenCandidateNames: Set<string>
    /** The bound the run announces on the page and in its request, and the one it is stopped at. */
    timeoutMs: number
    /** Stops the run: the learner's Cancel and the closing window both abort it. */
    controller: AbortController
  }
  /** Answers this window's Study reader and makes it when there is none: at activation, and after a change of the workspace's folders disposed the one before it. A reader that is made is given the study archives the disposed one could not save. @example await workspace().action('retry') */
  const workspace = (): StudyWorkspace => {
    if (reader) return reader
    reader = new StudyWorkspace(
      context,
      {
        connect,
        returnToRepository: (selection, preserveNativeInput) =>
          repository().open(selection, undefined, {
            restoreReadingLayout: true,
            preserveNativeInput,
          }),
        openArticle: (selection) => repository().open(selection),
        repositoryWikiOpen: () => Boolean(repositoryReader?.panelOpen()),
        repositoryWikiActive: () => Boolean(repositoryReader?.panelActive()),
      },
      [...unsavedStudies],
    )
    // Only a reader that was made has taken them: a constructor that throws leaves them for the next reader.
    unsavedStudies.length = 0
    return reader
  }
  const repository = (): RepositoryReader =>
    (repositoryReader ??= new RepositoryReader({
      storage: () => workspace().learningStorage(),
      connect,
      arrange: (signal, returnSelection, focus) =>
        workspace().arrangeRepository(signal, returnSelection, focus),
      evidence: (binding, recording, signal, origin) =>
        workspace().openRepositoryEvidence(binding, recording, signal, origin),
      knowsLearnerTypesInActiveEditor: () =>
        workspace().knowsLearnerTypesInActiveEditor(),
      studyPaneKeyboardColumn: () => workspace().studyPaneKeyboardColumn(),
    }))
  /**
   * Waits for a start until the handling of changed workspace folders has replaced the readers, and ends the start when the server was asked to stop meanwhile; called by {@link start} only while such a handling is under way.
   * A stop asked for during the wait finds nothing running, so it cannot end the start itself: gone on with, the start would bring up a server after the learner stopped it, or in a window that is closing.
   * @throws When Stop Agent Server was run or the window began to close during the wait.
   * @example if (replacingReaders) await awaitReplacedReaders()
   */
  const awaitReplacedReaders = async (): Promise<void> => {
    const stopsAskedBefore = stopsAskedFor
    while (replacingReaders) await replacingReaders
    if (stopsAskedFor !== stopsAskedBefore)
      throw new Error(
        "Codebook server was not started: a stop was asked for while the start waited for the workspace's folders to change. Run Codebook: Start Agent Server to start it.",
      )
  }
  const start = async () => {
    // A start asked for while the readers are replaced waits for the reader that will live; nothing is awaited otherwise, so a stop that follows a start at once still finds it.
    if (replacingReaders) await awaitReplacedReaders()
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
          'Codebook server stopped while starting its chat connection. Run Codebook: Start Agent Server to start it.',
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
                `Run ${SET_UP_AI_CHAT_COMMAND} to repair the connection.`,
              ),
            )
        }
      }
      if (running !== server || stopping || !server.endpoint.listening)
        throw new Error(
          'Codebook server stopped while starting its chat connection. Run Codebook: Start Agent Server to start it.',
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
  /**
   * Handles one change of the workspace's folders: clears the saved AI chat setup, stops the agent server, closes both readers and the DeepWiki reader, and makes both readers anew; called by the folders' listener, one change after the one before it.
   * Every step runs whatever the step before it did. A step that threw used to end the handling: after a stop or a Repository Wiki reader that failed, that reader stayed in its variable, disposed, so every later start failed with "Repository reader is disposed.", and the Study reader of the folders that were left stayed in use. The failures are told together in one notice ({@link folderChangeCleanupNotice}).
   * A server whose resources could not be released is still owned afterwards and keeps waiting for Stop Agent Server, which retires it on the Study reader made here.
   * @returns Nothing, and it does not reject: a failed step is in the notice.
   * @example replacingReaders = (replacingReaders ?? Promise.resolve()).then(replaceReadersAfterFolderChange)
   */
  const replaceReadersAfterFolderChange = async (): Promise<void> => {
    const failures: FolderChangeCleanupFailure[] = []
    /** Runs one step and keeps what it threw for the notice, so that the steps after it run all the same. */
    const attempt = async (
      step: FolderChangeCleanupStep,
      run: () => unknown,
    ): Promise<void> => {
      try {
        await run()
      } catch (thrown) {
        failures.push({ step, thrown })
      }
    }
    await attempt('chat-setup', () =>
      context.workspaceState.update('codebook.aiChatSetup', undefined),
    )
    const closingWikiReader = deepWikiReader
    deepWikiReader = undefined
    try {
      await stop()
    } catch (thrown) {
      // A server that is still owned could not release its resources; any other failure of the stop left no server behind.
      failures.push({
        step: running ? 'server-still-owned' : 'server-stopped',
        thrown,
      })
    }
    const closingRepositoryReader = repositoryReader
    await attempt('repository-reader', () => closingRepositoryReader?.dispose())
    // A reader whose dispose threw is disposed all the same and refuses every use, so it is replaced like one whose dispose ended.
    repositoryReader = undefined
    const closingStudyReader = reader
    await attempt('study-reader', async () => {
      // What the reader could not save is taken before its dispose, so a dispose that throws loses none of it.
      unsavedStudies.push(
        ...(closingStudyReader?.releaseUnsavedStudies() ?? []),
      )
      await closingStudyReader?.dispose()
    })
    reader = undefined
    // The new Study reader is made at once, as at activation: it registers its views again and shows what still waits to be saved.
    await attempt('new-readers', () => {
      workspace()
      repository()
    })
    await attempt('wiki-reader', () => closingWikiReader?.close())
    // The notice stays until the learner closes it, so it is not waited for.
    if (failures.length)
      void showNotice('error', folderChangeCleanupNotice(failures))
  }
  /** Stops the server because the learner or the closing window asked for it, and counts that for a start that waits ({@link awaitReplacedReaders}); the stop a change of the workspace's folders makes on its own way is not counted. Called by Stop Agent Server and by the extension's shutdown. @example registerCommand('codebook.stopAgentServer', stopOnRequest) */
  const stopOnRequest = (): Promise<void> => {
    stopsAskedFor += 1
    return stop()
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
        `Codebook Cursor setup was removed while its connection was starting. Run ${SET_UP_AI_CHAT_COMMAND} again.`,
      )
    const server = running
    if (!server)
      throw new Error(
        `Codebook server is not running. Run ${SET_UP_AI_CHAT_COMMAND} again.`,
      )
    const cursorMcp = vscode.cursor?.mcp
    if (!cursorMcp?.registerServer)
      throw new Error(
        `This Cursor version does not expose MCP registration to Codebook. Update Cursor, then run ${SET_UP_AI_CHAT_COMMAND} again. For an external MCP client, run Codebook: Start Agent Server and Codebook: Copy Agent Connection.`,
      )
    const previous = cursorRegistration
    if (previous?.server === server) return previous.attempt
    const attempt = (async () => {
      // A newer server waits for any older registration to finish before touching Cursor's shared catalog.
      if (previous) await previous.attempt.catch(() => {})
      if (running !== server || stopping || cursorRemoving)
        throw new Error(
          `Codebook server or Cursor setup changed before MCP registration. Run ${SET_UP_AI_CHAT_COMMAND} again.`,
        )
      // Another Cursor window may remove the shared skill while this window starts its server.
      await verifyManagedCursorSkill(
        context.extensionPath,
        context.globalStorageUri.fsPath,
      )
      if (running !== server || stopping || cursorRemoving)
        throw new Error(
          `Codebook server or Cursor setup changed before MCP registration. Run ${SET_UP_AI_CHAT_COMMAND} again.`,
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
            `Codebook server or Cursor setup changed before MCP registration. Run ${SET_UP_AI_CHAT_COMMAND} again.`,
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
              `Cursor skill changed and its owned MCP catalog cleanup is incomplete. Run ${SET_UP_AI_CHAT_COMMAND} to repair the connection.`,
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
        `Codebook Cursor setup was removed while starting. Run ${SET_UP_AI_CHAT_COMMAND} again.`,
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
    if (!running)
      throw new Error(
        `Codebook server is not running. Run ${SET_UP_AI_CHAT_COMMAND} again.`,
      )
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
                `Run ${SET_UP_AI_CHAT_COMMAND} for this workspace.`,
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
  /**
   * Shuts the extension down when the window closes: stops the agent server, disposes both readers, waits for a Wiki update it stopped, settles the Wiki reservations, makes once more each change of its Wiki markers that waits for its next attempt, and closes the DeepWiki reader; called by {@link deactivate}. A stopped watch whose record the workspace state does not hold keeps its bounded reservation for the reloaded window.
   * Every step runs whatever the step before it did. A stop that threw used to end the first three steps, so the Repository Wiki reader's dispose, which waits for accepted publications and learner writes, and the Study reader's dispose, which ends its run and saves the playback position, did not run, and a write under way was not waited for before the extension host ended.
   * It is kept apart from {@link replaceReadersAfterFolderChange}: the two share only "stop, then dispose two readers", and that handling also hands archives over, clears the readers' variables, makes new readers and names each failed step for its notice, none of which a closing window may do.
   * @throws The first failure of its steps, after all of them ran, so that the editor still logs it.
   * @example await stopExtension()
   */
  stopExtension = async (): Promise<void> => {
    isExtensionStopping = true
    // A closing window must not leave a watch or an unattended agent behind.
    const stoppedWikiRun = activeWikiRun
    stoppedWikiRun?.controller.abort(WIKI_UPDATE_WINDOW_CLOSING_ABORT_REASON)
    const failures: unknown[] = []
    for (const step of [
      // Owned runtimes are released first; an in-flight or failing browser reader close cannot strand them.
      (): Promise<void> => stopOnRequest(),
      // Waits for the accepted publications and the learner's writes.
      (): Promise<void> | undefined => repositoryReader?.dispose(),
      // Ends the reader's run and saves the playback position.
      (): Promise<void> | undefined => reader?.dispose(),
      // The Cursor agent gets its termination grace to close; an agent that does not is not waited for longer. How the run ended is recorded by the run itself; shutdown only waits for it.
      (): Promise<unknown> | undefined =>
        stoppedWikiRun &&
        settledWithin(
          stoppedWikiRun.settled.catch(() => undefined),
          WIKI_CURSOR_TERMINATION_GRACE_MS,
        ),
      (): Promise<void> => dropWikiReservations(),
      // A marker whose change waits for its next attempt would otherwise count for other windows until it expires.
      (): Promise<void> => retryWikiMarkerChangesNow(),
      (): Promise<void> | undefined => deepWikiReader?.close(),
    ]) {
      try {
        await step()
      } catch (thrown) {
        failures.push(thrown)
      }
    }
    if (failures.length) throw failures[0]
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
  /** Checks that the manifest of the Wiki folder names this opened project, before the browser entry or an update uses the folder. @throws When the manifest is missing or no regular file ({@link readWikiFileToOpen}), is no JSON object of this schema or names another checkout. @example await assertWikiOwner('/repo', '/repo/.codebook/wiki') */
  const assertWikiOwner = async (
    projectRoot: string,
    outputDirectory: string,
  ): Promise<void> => {
    // The manifest is read as a file of the Wiki folder, never through a link and never past its bound.
    const manifestBytes = await readWikiFileToOpen(
      join(outputDirectory, WIKI_MANIFEST_FILE),
      'manifest',
    )
    const manifest: unknown = JSON.parse(manifestBytes.toString('utf8'))
    // A generated page from another checkout must not masquerade as this project's Wiki.
    if (!isWikiManifestOf(manifest, projectRoot))
      throw new Error(
        'The DeepWiki manifest does not identify this opened project.',
      )
  }
  /** Checks the generated Wiki's owner and its entry page before the browser entry opens it, each read as a file of the Wiki folder and never through a link ({@link readWikiFileToOpen}), and only after none was found at the Wiki folder or on its path in the project (a link, a file, or a folder whose real path leaves the project; {@link assertNoLinkOnWikiPath}); an update checks the owner alone, so a deleted entry page reaches its start check. @example await currentDeepWiki() // => { projectRoot, outputDirectory, entry } */
  const currentDeepWiki = async () => {
    const { projectRoot, outputDirectory } = await wikiLocation()
    // Nothing of the Wiki is read through a link on its folder's path in the project, not even the manifest the owner check reads.
    await assertNoLinkOnWikiPath(outputDirectory, projectRoot)
    await assertWikiOwner(projectRoot, outputDirectory)
    const entry = join(outputDirectory, WIKI_ENTRY_FILE)
    await readWikiFileToOpen(entry, 'entry page')
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
  /** Names where the running update's progress can be read in the editor now, for {@link showWikiUpdateRunning}: none in an editor that cannot show the run; the status bar entry that follows the chat's first sign while a VS Code update still waits for it; otherwise the status bar entry of the VS Code watch or the notification of the Cursor agent's run, which is shown. @example wikiProgressPlace() // => 'awaited-chat' while a VS Code update waits for the chat's first sign */
  const wikiProgressPlace = (): WikiUpdateProgressPlace => {
    // A Cursor run is a progress notification ({@link withCancellableProgress}), which an editor without the progress API does not show.
    if (isCursorHost) {
      if (!vscode.window.withProgress) return 'reader-only'
      return 'notification'
    }
    // A VS Code watch is an entry of the status bar ({@link withWikiChatWatchStatus}), which an editor without the status bar API does not show.
    if (!vscode.window.createStatusBarItem) return 'reader-only'
    return activeWikiRun?.awaitsChat ? 'awaited-chat' : 'status-bar'
  }
  /** Tells the learner that a second start was refused and where the first run's progress is at this moment ({@link describeSecondWikiUpdateStart}). @example showWikiUpdateRunning() */
  const showWikiUpdateRunning = (): void => {
    void showNotice(
      'information',
      describeSecondWikiUpdateStart(wikiProgressPlace()),
    )
  }
  /** Keeps the last Wiki update's record in memory and workspace storage; called by {@link finishWikiUpdate}. The open window does not wait for storage before showing the end. A refusal stays in memory and leaves the reservation as the reload's fallback at shutdown. @param record - The latest run's durable control facts. @returns A non-rejecting promise: `true` when stored, `false` when storage refused it. @example await rememberLastWikiRun({ outputDirectory: '/repo/.codebook/wiki', startedAtMs: 1_000, endedAtMs: 2_000, mayAgentStillWork: true, candidateNames: [] }) // => true */
  const rememberLastWikiRun = (record: WikiLastRun): Promise<boolean> => {
    lastWikiRuns.set(record.outputDirectory, record)
    const written = Promise.resolve()
      .then(() =>
        context.workspaceState.update(WIKI_UPDATE_LAST_RUN_STATE_KEY, record),
      )
      .then(
        () => true,
        () => false,
      )
    lastWikiRunWrite = { outputDirectory: record.outputDirectory, written }
    return written
  }
  /** What a run hands to its end: what it observed itself, without a look at the disk. */
  type ObservedWikiRunEnd = Partial<
    Pick<
      WikiUpdateEndFacts,
      | 'cancelled'
      | 'timedOut'
      | 'blockingPaths'
      | 'failure'
      | 'isFailureCodebookSentence'
      | 'mayBeReplacedLater'
    >
  > & {
    publish?: { token: string; published: WikiUpdateEndFacts['published'] }
  }
  /** Reads the published manifest at a run's end, and only when the site on disk is not the one the run started from; called by {@link readWikiSiteAtEnd}. @example await readPublishedIfReplaced(run, 'a@1') // => undefined for a run that started from 'a@1' */
  const readPublishedIfReplaced = async (
    run: WikiRun,
    tokenAtEnd: string | undefined,
  ): Promise<WikiUpdateEndFacts['published']> =>
    tokenAtEnd === run.tokenAtStart
      ? undefined
      : inspectPublishedWiki(run.projectRoot, run.outputDirectory)
  /** Reads what the disk says of a run that ended: the publish token, the publication identity and the published manifest, the last two as the watch saw them when it saw the publish; called by {@link readWikiUpdateEnd}. @throws What a read of the disk throws. @example await readWikiSiteAtEnd(run, undefined) // => { tokenAtEnd: 'a@1', publicationAtEnd: 'a@7', published: undefined } */
  const readWikiSiteAtEnd = async (
    run: WikiRun,
    seenPublish: ObservedWikiRunEnd['publish'],
  ): Promise<
    Pick<WikiUpdateEndFacts, 'tokenAtEnd' | 'publicationAtEnd' | 'published'>
  > => {
    const tokenAtEnd = await readWikiPublishToken(run.outputDirectory)
    // A publish the watch saw is taken as it saw it.
    if (seenPublish)
      return {
        tokenAtEnd,
        publicationAtEnd: seenPublish.token,
        published:
          seenPublish.published ??
          (await readPublishedIfReplaced(run, tokenAtEnd)),
      }
    return {
      tokenAtEnd,
      publicationAtEnd: await readWikiPublicationIdentity(run.outputDirectory),
      published: await readPublishedIfReplaced(run, tokenAtEnd),
    }
  }
  /** Decides how a run of either host ended from the disk: reads the site again ({@link readWikiSiteAtEnd}) and lets {@link classifyWikiUpdateEnd} decide; called by {@link finishWikiUpdate}. @returns The end, and whether the Wiki has a new publication since the run's start: only the Codebook publisher writes one, so a chat's publish is on disk. @throws What a read of the disk throws; the caller then ends the run without the disk. @example await readWikiUpdateEnd(run, { cancelled: true }) // => { end: { state: 'cancelled', site: 'kept' }, hasNewPublication: false } */
  const readWikiUpdateEnd = async (
    run: WikiRun,
    observed: ObservedWikiRunEnd,
  ): Promise<{ end: WikiUpdateEnd; hasNewPublication: boolean }> => {
    const siteAtEnd = await readWikiSiteAtEnd(run, observed.publish)
    return {
      end: classifyWikiUpdateEnd({
        host: run.host,
        cancelled: observed.cancelled ?? false,
        timedOut: observed.timedOut ?? false,
        tokenAtStart: run.tokenAtStart,
        publicationAtStart: run.publicationAtStart,
        ...siteAtEnd,
        uncoveredAtStart: run.uncoveredAtStart,
        blockingPaths: observed.blockingPaths ?? [],
        failure: observed.failure,
        isFailureCodebookSentence: observed.isFailureCodebookSentence,
        mayBeReplacedLater: observed.mayBeReplacedLater,
      }),
      hasNewPublication:
        siteAtEnd.publicationAtEnd !== undefined &&
        siteAtEnd.publicationAtEnd !== run.publicationAtStart,
    }
  }
  /** Frees the Wiki for other windows at a run's end, or leaves the run's marker as the reservation of a chat that may still work; called by {@link finishWikiUpdate} last. It never rejects: a change of the marker that cannot be made now is asked for again later ({@link changeWikiMarker}), and one that still cannot be made is left to the marker's own expiry. @param endedAtMs - When the run ended, which the reservation names as the end of the watch. @param mayAgentStillWork - Whether the run's chat can still publish ({@link mayWikiChatStillPublish}). @example await settleWikiRunMarker(run, Date.now(), false) */
  const settleWikiRunMarker = async (
    run: WikiRun,
    endedAtMs: number,
    mayAgentStillWork: boolean,
  ): Promise<void> => {
    if (!mayAgentStillWork) {
      await changeWikiMarker(run.outputDirectory, run.releaseMarker)
      return
    }
    // Another window sees neither a run nor, before the chat staged anything, a candidate: the marker stays as a reservation until the watch bound.
    await changeWikiMarker(run.outputDirectory, () =>
      run.reserveMarker(endedAtMs),
    )
    // The reservation of this output only; one this window left on another output keeps its own timer.
    clearTimeout(wikiReservations.get(run.outputDirectory)?.timer)
    wikiReservations.set(run.outputDirectory, {
      release: run.releaseMarker,
      timer: setTimeout(() => {
        void dropWikiReservation(run.outputDirectory)
      }, WIKI_UPDATE_WATCH_TIMEOUT_MS).unref(),
    })
  }
  /** Records how a run of either host ended: lets {@link readWikiUpdateEnd} decide from the disk, stores its answer for the reader, frees the Wiki for other windows and keeps how the run ended for this window's next start. It never rejects: a run whose end cannot be read from the disk is recorded as failed without a word about the site ({@link unreadWikiUpdateEnd}), so no window stays "already updating", and a notice that cannot be shown does not keep the run's marker in place. @example await finishWikiUpdate(run, { cancelled: true }) */
  const finishWikiUpdate = async (
    run: WikiRun,
    observed: ObservedWikiRunEnd,
  ): Promise<void> => {
    // The disk says how the run ended; when it cannot be read, what the run observed itself still says whether its chat goes on.
    const { end, stoppedAs, hasNewPublication } = await readWikiUpdateEnd(
      run,
      observed,
    ).then(
      (read) => ({
        end: read.end,
        stoppedAs: read.end.state,
        hasNewPublication: read.hasNewPublication,
      }),
      (error: unknown) => ({
        ...unreadWikiUpdateEnd(observed, thrownMessage(error)),
        hasNewPublication: false,
      }),
    )
    wikiUpdateRun.end(end)
    const endedAtMs = Date.now()
    // Stopping a VS Code watch does not stop the chat, and neither does a watch that broke off or a request that could not be taken back; a Cursor agent is stopped with its run, and a closing window takes its chat with it. A chat whose publish is on disk has done its work, also when the watch was stopped while it read that publish or just before its next look: it leaves no chat that may still publish and no reservation.
    const mayAgentStillWork =
      !hasNewPublication &&
      mayWikiChatStillPublish(
        run.host,
        stoppedAs,
        isExtensionStopping,
        // An end the run itself marks as one its chat can publish after (a watch that broke off, a request not taken back) leaves the reservation a stopped watch leaves.
        observed.mayBeReplacedLater ?? false,
      )
    const recordWritten = rememberLastWikiRun({
      outputDirectory: run.outputDirectory,
      startedAtMs: run.startedAtMs,
      endedAtMs,
      mayAgentStillWork,
      candidateNames: [...run.seenCandidateNames],
    })
    // The editor tells the learner in the same turn the page's status changes; the marker's file work below would put the notice a turn or more behind the page.
    try {
      showWikiUpdateNotice()
    } catch {
      // A notice the editor cannot show has nobody to report to. The end is recorded and the page shows it; the marker below must still be freed or reserved.
    }
    await settleWikiRunMarker(run, endedAtMs, mayAgentStillWork)
    // A closing window shows no notice, and its record is all its reloaded self gets of this run: the close waits until the editor's storage took it.
    if (isExtensionStopping) await recordWritten
  }
  /** Looks at this run's candidates: notes on the run state that the agent staged one, and names the learner files it would overwrite. @example await probeWikiCandidates(run) // => ['pages/notes.html'] */
  const probeWikiCandidates = async (run: WikiRun): Promise<string[]> => {
    const candidates = await listWikiCandidates(run.outputDirectory)
    const stagedSinceStart = candidates.filter(
      (candidate) => candidate.writtenAtMs >= run.startedAtMs,
    )
    // The run remembers what it saw staged: a publish that leaves one of these beside the Wiki was not this run's chat's.
    stagedSinceStart.forEach((candidate) =>
      run.seenCandidateNames.add(candidate.name),
    )
    // A look that returns after its run ended must not mark the next run.
    if (
      activeWikiRun?.controller === run.controller &&
      stagedSinceStart.length > 0
    )
      wikiUpdateRun.markCandidateStaged()
    return detectWikiPublishConflicts(
      run.outputDirectory,
      run.startedAtMs,
      candidates,
    )
  }
  /** Shows the one progress notification of a Cursor update's run and aborts the run when the learner presses its Cancel; the agent works inside it. A VS Code watch is shown in the status bar instead ({@link withWikiChatWatchStatus}). @example await withCancellableProgress('Updating LLM Wiki with Cursor Agent', run, update) */
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
  /** Shows the status bar entry of a VS Code watch while the watch runs, and aborts the run when the learner presses the entry ({@link WIKI_CHAT_WATCH_CANCEL_COMMAND}), which stops watching, not the chat. It shows no notification: the editor stacks notifications over the Chat view, where any other notification pushes one that lasts the whole watch over the chat's approval buttons. @example await withWikiChatWatchStatus(run, watch) */
  const withWikiChatWatchStatus = async (
    run: WikiRun,
    work: () => Promise<void>,
  ): Promise<void> => {
    // An editor without the status bar API still runs the watch, without a Cancel.
    if (!vscode.window.createStatusBarItem) return work()
    const entry = showWikiChatWatchStatus(
      vscode.window,
      vscode.StatusBarAlignment.Right,
    )
    const cancel = (): void => run.controller.abort()
    cancelShownWikiChatWatch = cancel
    try {
      await work()
    } finally {
      // The entry and its Cancel go with the watch; a Cancel another watch set meanwhile stays.
      if (cancelShownWikiChatWatch === cancel)
        cancelShownWikiChatWatch = undefined
      entry.dispose()
    }
  }
  /** Watches for the editor agent's publish after VS Code's chat took up the request, then records the run's result for the reader; settles when the watch has stopped. For that time the status bar shows the watch and its Cancel, the same for every run ({@link withWikiChatWatchStatus}), and no notification lies over the chat's approval buttons. @param chat - Of the start in the chat: the watch of the chat's reply (when the reply ends, one more look decides and the run ends at once). @example await watchVsCodeWikiUpdate(run, chatStart) */
  const watchVsCodeWikiUpdate = (
    run: WikiRun,
    { reply }: WatchedWikiChat,
  ): Promise<void> =>
    withWikiChatWatchStatus(run, async () =>
      // The end is recorded outside the watch's guard: only what the watch itself threw is a watch that broke off.
      finishWikiUpdate(run, await watchForWikiPublish(run, reply)),
    )
  /** Watches the Wiki's output for the publish of a VS Code update and says what the run observed; called by {@link watchVsCodeWikiUpdate}, which records the end. It never rejects: a watch that throws is answered as a watch that broke off, in whose end the chat goes on. @param reply - The watch of the chat's reply. @example await watchForWikiPublish(run, reply) // => { cancelled: false, timedOut: true, blockingPaths: [], publish: undefined } */
  const watchForWikiPublish = async (
    run: WikiRun,
    reply: WatchedWikiChat['reply'],
  ): Promise<ObservedWikiRunEnd> => {
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
      return {
        cancelled: result.outcome === 'cancelled',
        timedOut: result.outcome === 'timed-out',
        blockingPaths: result.outcome === 'blocked' ? result.paths : [],
        publish: result.outcome === 'published' ? result : undefined,
        ...failureOfWikiChatReplyEnd(result.outcome, reply.end()),
      }
    } catch (error) {
      // The watch broke off, not the chat: the end says so, and the next press is held back as after a stopped watch, so no second chat starts beside the first.
      return {
        failure: describeBrokenWikiWatch(thrownMessage(error)),
        isFailureCodebookSentence: true,
        mayBeReplacedLater: true,
      }
    }
  }
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
   * The order: what makes the publisher refuse (a link or a file on the Wiki folder's path inside the project, a Wiki folder that is itself a link or a file, an unfinished publish, a link or special file, a manifest that cannot be read or was edited, an edited or missing page); no Wiki at all; a manifest of another checkout; a Wiki that is already current; another window's running update, which nothing overrides; an earlier chat's leftover, which "Update anyway" overrides only for the leftovers its refusals named (a refusal names one chat's leftovers: another window's stopped watch, a candidate, or this window's own stopped watch together with the candidate that watch saw; the leftovers of two chats at once are named in two refusals, one after the other), and which no longer counts once that chat's own publish came after its watch's end ({@link hasWikiPublishEndedWait}); and last the marker that reserves the Wiki for this run. When a publish lands while the checks run, they are made once more, so the token, the manifest and the freshness come from one generation.
   *
   * @param projectRoot - Canonical opened project.
   * @param wikiOutput - Resolved Wiki folder and its label.
   * @param host - Editor host that was asked.
   * @param acknowledgedLeftovers - The leftovers named by the refusals on which the learner chose "Update anyway", one press after the other: each press adds what its refusal named (one chat's leftovers); empty for an ordinary press. Only a leftover equal to one of them ({@link isAcknowledgedWikiLeftover}) lets the start go on; every other leftover, there already or appeared since, refuses it with a notice of its own, and another window's running update refuses it whatever was pressed.
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
    /** Records a refusal in a sentence Codebook wrote and tells the learner. `workInProgress` is given when the refusal names somebody who is still updating this Wiki (another window's run, or an earlier chat the start waits for): the site may then be replaced after the refusal, which the recorded state says, and `onUpdateAnyway` in it offers the override. */
    const refuse = (
      reason: string,
      workInProgress?: { onUpdateAnyway?: () => void },
    ): undefined => {
      wikiUpdateRun.refuseStart(host, wikiOutput, {
        kind: 'failed',
        reason,
        isCodebookSentence: true,
        ...(workInProgress ? { mayBeReplacedLater: true } : {}),
      })
      showWikiUpdateNotice(workInProgress?.onUpdateAnyway)
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
    ): string => {
      // A marker another window removes or replaces at this moment names no run.
      if ('isMarkerInChange' in holder)
        return 'Another editor window is starting or ending an update of this Wiki. Wait a moment and try again.'
      // A marker another window is writing names no run yet.
      if ('beingWrittenSinceMs' in holder)
        return 'Another editor window is starting an update of this Wiki. Wait a moment and try again.'
      return `Another editor window is updating this Wiki (${holder.host === 'cursor' ? 'Cursor' : 'VS Code'}, started ${formatClockTime(holder.startedAtMs, {})}). Wait for it to finish, then press Update LLM Wiki again.`
    }
    for (const isLastAttempt of [false, true]) {
      // The publisher refuses each of these before it stages anything, so no agent could succeed: say why at once. It runs first: a journal without a folder is an unfinished publish, not a missing Wiki.
      const startBlock = await findWikiUpdateStartBlock(
        outputDirectory,
        projectRoot,
      )
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
        return refuse(describeOtherWindow(markerLook.heldBy), {})
      const otherWindow =
        markerLook.kind === 'live' ? markerLook.heldBy : undefined
      // A run that is active in another window refuses the start, and nothing overrides it.
      if (otherWindow && otherWindow.watchEndedAtMs === undefined)
        return refuse(describeOtherWindow(otherWindow), {})
      const nowMs = Date.now()
      // Every leftover in the way now, each entry with the sentence that names it; a refusal names one entry, and its "Update anyway" passes only that entry's leftovers.
      const leftovers: Array<{ named: WikiLeftover[]; reason: string }> = []
      // Another window stopped watching its chat, which may still publish until the watch bound; like this window's own stopped watch, the learner may go on. A site published since that watch's end ended the wait: the reservation names no candidate, so this window knows no more of that chat's publish than its time.
      if (
        otherWindow?.watchEndedAtMs !== undefined &&
        nowMs < otherWindow.watchEndedAtMs + WIKI_UPDATE_WATCH_TIMEOUT_MS &&
        !(await hasWikiPublishEndedWait(outputDirectory, {
          watchEndedAtMs: otherWindow.watchEndedAtMs,
          candidateNames: [],
        }))
      )
        leftovers.push({
          named: [
            {
              kind: 'reservation',
              windowId: otherWindow.windowId,
              startedAtMs: otherWindow.startedAtMs,
            },
          ],
          reason: `The VS Code chat another editor window asked at ${formatClockTime(otherWindow.startedAtMs, {})} may still be updating this Wiki; that window stopped watching it at ${formatClockTime(otherWindow.watchEndedAtMs, {})} and Codebook waits for it until ${formatClockTime(otherWindow.watchEndedAtMs + WIKI_UPDATE_WATCH_TIMEOUT_MS, {})}. If that chat was stopped, choose Update anyway in the editor’s notification.`,
        })
      // The record of another output says nothing about this one's candidates.
      const lastRun = lastWikiRuns.get(outputDirectory)
      const activeCandidate = selectActiveWikiCandidate(
        await listWikiCandidates(outputDirectory),
        { nowMs, activeWithinMs: WIKI_UPDATE_WATCH_TIMEOUT_MS, lastRun },
      )
      // This window's own stopped watch, whose chat may still work; a watch that stopped before the chat staged anything left no candidate. Its own publish since the watch's end ended the wait: the page has shown that publish, and nothing is left to wait for.
      const awaitedOwnRun =
        lastRun?.mayAgentStillWork &&
        nowMs < lastRun.endedAtMs + WIKI_UPDATE_WATCH_TIMEOUT_MS &&
        !(await hasWikiPublishEndedWait(outputDirectory, {
          watchEndedAtMs: lastRun.endedAtMs,
          candidateNames: lastRun.candidateNames ?? [],
        }))
          ? lastRun
          : undefined
      const ownRunLeftover: WikiLeftover | undefined = awaitedOwnRun && {
        kind: 'last-run',
        endedAtMs: awaitedOwnRun.endedAtMs,
      }
      // A candidate this window's stopped watch saw is that watch's chat's: one refusal names both, and its "Update anyway" passes both. A candidate the watch never saw is named in a refusal of its own.
      const isCandidateOfOwnRun =
        activeCandidate !== undefined &&
        (awaitedOwnRun?.candidateNames ?? []).includes(activeCandidate.name)
      if (activeCandidate) {
        const candidateLeftover: WikiLeftover = {
          kind: 'candidate',
          name: activeCandidate.name,
        }
        leftovers.push({
          named:
            isCandidateOfOwnRun && ownRunLeftover
              ? [candidateLeftover, ownRunLeftover]
              : [candidateLeftover],
          reason: `An earlier chat or another editor window appears to be updating this Wiki (candidate ${activeCandidate.name}, written ${formatClockTime(activeCandidate.writtenAtMs, {})}). Codebook waits for it until ${formatClockTime(activeCandidate.writtenAtMs + WIKI_UPDATE_WATCH_TIMEOUT_MS, {})}. If that chat was stopped, choose Update anyway in the editor’s notification.`,
        })
      }
      if (awaitedOwnRun && ownRunLeftover && !isCandidateOfOwnRun)
        leftovers.push({
          named: [ownRunLeftover],
          reason: `The VS Code chat this window asked at ${formatClockTime(awaitedOwnRun.startedAtMs, {})} may still be updating this Wiki; Codebook stopped watching it at ${formatClockTime(awaitedOwnRun.endedAtMs, {})} and waits for it until ${formatClockTime(awaitedOwnRun.endedAtMs + WIKI_UPDATE_WATCH_TIMEOUT_MS, {})}. If that chat was stopped, choose Update anyway in the editor’s notification.`,
        })
      // A press of "Update anyway" passes only the leftovers its refusals named; another one, there already or appeared since, is named in a refusal of its own.
      const unacknowledged = leftovers.find(({ named }) =>
        named.some(
          (leftover) =>
            !isAcknowledgedWikiLeftover(leftover, acknowledgedLeftovers),
        ),
      )
      if (unacknowledged)
        return refuse(unacknowledged.reason, {
          onUpdateAnyway: () =>
            updateAnyway([...acknowledgedLeftovers, ...unacknowledged.named]),
        })
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
      if ('heldBy' in claim)
        return refuse(describeOtherWindow(claim.heldBy), {})
      // This window's own reservation of this output, if it left one, is now this run's marker; its timer must not remove it. A reservation of another output shares no marker with this run and keeps its timer.
      clearTimeout(wikiReservations.get(outputDirectory)?.timer)
      wikiReservations.delete(outputDirectory)
      // A change of an earlier run's marker that waits for its next attempt has nothing left to change: this run holds the marker now.
      cancelWikiMarkerChange(outputDirectory)
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
  /** Starts a project-bound skill update from the browser or command, coalescing repeated clicks. @param acknowledgedLeftovers - Given when the learner pressed "Update anyway": the leftovers named by the refusals it was pressed on, one press after the other, which alone are ignored; every other leftover, there already or appeared since, refuses the start with a notice of its own, and another window's running update still refuses it. @example await updateDeepWiki() */
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
        seenCandidateNames: new Set(),
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
      // Ends the opening of a VS Code start: the closing window no longer finds it and stops waiting for it. Nothing to end before the opening began, and for Cursor.
      let endOpening = (): void => {}
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
          // Until the chat's first sign the status bar shows no watch of this run; a second start says so.
          awaitsChat: true as const,
        }
        activeWikiRun = opening
        endOpening = (): void => {
          if (activeWikiRun === opening) activeWikiRun = undefined
          reportOpeningEnded()
        }
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
        // The opening has ended; the watch takes the run over. A chat that works says nothing more until its reply ends, so the extension watches for the publish itself and for that end; the watch outlives this call.
        endOpening()
        void track(watchVsCodeWikiUpdate(run, chatStart))
      } catch (error) {
        // A run whose end was recorded has nothing left to end; what was thrown is the caller's.
        if (!wikiUpdateRun.isRunning()) throw error
        await finishWikiUpdate(run, { failure: thrownMessage(error) })
      } finally {
        // Only now does the run count as settled: a closing window waits until the end was recorded and the marker released, also the failed end of a step that threw.
        endOpening()
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
    registerCommand('codebook.stopAgentServer', stopOnRequest),
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
          // A refusal of the catalog's first step does not end the removal: the skill goes all the same, and the refusal is shown below as the cleanup's warning.
          const catalogCapture = await captureOwnedCursorMcpCatalogGeneration(
            context.globalStorageUri.fsPath,
            undefined,
            REMOVE_MANAGED_CURSOR_SKILL_COMMAND,
          ).catch((refusal: unknown) => ({ refusal }))
          // A skill an earlier removal took away, or none that Codebook knows as its own, is no refusal: this removal goes on to the config.
          const skillRemoval = (
            await removeManagedCursorSkill(context.globalStorageUri.fsPath)
          ).status
          await context.workspaceState.update('codebook.aiChatSetup', undefined)
          if (registeredCursorServer) {
            vscode.cursor?.mcp?.unregisterServer(registeredCursorServer)
            registeredCursorServer = undefined
          }
          try {
            if ('refusal' in catalogCapture) throw catalogCapture.refusal
            // Without a config of Codebook's own nothing is retired, and the notice says why.
            const catalogCleanup =
              'ownedGeneration' in catalogCapture
                ? await removeOwnedCursorMcpCatalog(
                    context.globalStorageUri.fsPath,
                    undefined,
                    catalogCapture.ownedGeneration,
                    REMOVE_MANAGED_CURSOR_SKILL_COMMAND,
                  )
                : catalogCapture.unowned
            void showNotice(
              'information',
              cursorRemovalNotice(skillRemoval, catalogCleanup),
            )
          } catch (error) {
            void showNotice(
              'warning',
              cursorCatalogCleanupNotice(error, skillRemoval),
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
          void showNotice('error', deepWikiOpenFailureNotice(error))
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
    // A press on the watch's status bar entry: it stops the watch it shows, and nothing once that watch has ended.
    registerCommand(WIKI_CHAT_WATCH_CANCEL_COMMAND, () => {
      cancelShownWikiChatWatch?.()
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
      // One change is handled after the one before it: handled at once, the second would clear the readers the first had just made, without disposing them.
      const replacement = (replacingReaders ?? Promise.resolve()).then(
        replaceReadersAfterFolderChange,
      )
      /** Ends the mark of this change, unless a later change has chained itself to it and keeps the mark. */
      const endReplacement = (): void => {
        if (replacingReaders === settled) replacingReaders = undefined
      }
      const settled: Promise<void> = replacement.then(
        endReplacement,
        endReplacement,
      )
      replacingReaders = settled
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
          `Run ${SET_UP_AI_CHAT_COMMAND}.`,
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

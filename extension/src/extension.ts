import { randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { URLSearchParams } from 'node:url'

import * as vscode from 'vscode'

import {
  AGENT_STORAGE_DIRECTORY,
  API_VERSION,
  CANCEL_WIKI_RUN_COMMAND,
  CHANGE_WIKI_LOCATION_ACTION,
  CONNECTION_DESCRIPTOR_SUFFIX,
  EXTENSION_VERSION,
  GENERATE_ANYWAY_ACTION,
  GENERATE_CONFIRM_ACTION,
  GENERATE_DEEP_WIKI_COMMAND,
  GENERATE_WIKI_ACTION,
  LLM_WIKI_POLL_MS,
  LLM_WIKI_REFRESH_DEBOUNCE_MS,
  LLM_WIKI_VIEW_WINDOW_ID,
  OPEN_DEEP_WIKI_COMMAND,
  OPEN_WIKI_IN_BROWSER_ACTION,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
  SHOW_WIKI_OUTPUT_COMMAND,
  UPDATE_DEEP_WIKI_COMMAND,
  UPDATE_WIKI_ACTION,
  WIKI_CHAT_OPEN_TIMEOUT_MS,
  WIKI_CHAT_SESSION_START_TIMEOUT_MS,
  WIKI_CHAT_WATCH_CANCEL_COMMAND,
  WIKI_CURSOR_TERMINATION_GRACE_MS,
  WIKI_CURSOR_UPDATE_TIMEOUT_MS,
  WIKI_ENTRY_FILE,
  WIKI_GENERATE_TIMEOUT_MS,
  WIKI_MANIFEST_FILE,
  WIKI_OUTSIDE_OUTPUT_APPROVALS_NOTE,
  WIKI_RUN_STARTING_SENTENCE,
  WIKI_UPDATE_LAST_RUN_STATE_KEY,
  WIKI_UPDATE_MARKER_CHANGE_RETRIES,
  WIKI_UPDATE_MARKER_CHANGE_RETRY_DELAY_MS,
  WIKI_UPDATE_UNREADABLE_MANIFEST_GRACE_MS,
  WIKI_UPDATE_WATCH_POLL_MS,
  WIKI_UPDATE_WATCH_TIMEOUT_MS,
  WIKI_UPDATE_WINDOW_CLOSING_ABORT_REASON,
  OPEN_LEARNING_REPLAY_COMMAND,
  SAVE_LEARNING_REPLAY_COMMAND,
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
import { agentExitOf, type WikiAgentExit } from './utils/agentExitOf'
import { aiChatReadyMessage } from './utils/aiChatReadyMessage'
import {
  answerDeepWikiQuestion,
  answerDeepWikiQuestionWithPrompt,
} from './utils/answerDeepWikiQuestion'
import { assertNoLinkOnWikiPath } from './utils/assertNoLinkOnWikiPath'
import { buildWikiGeneratePrompt } from './utils/buildWikiGeneratePrompt'
import { buildWikiUpdatePrompt } from './utils/buildWikiUpdatePrompt'
import { claimWikiUpdateMarker } from './utils/claimWikiUpdateMarker'
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
import { describeExistingWiki } from './utils/describeExistingWiki'
import { describeMissingWiki } from './utils/describeMissingWiki'
import { describeOtherWikiWindow } from './utils/describeOtherWikiWindow'
import {
  describeSecondWikiUpdateStart,
  type WikiUpdateProgressPlace,
} from './utils/describeSecondWikiUpdateStart'
import { describeWikiChatHandOver } from './utils/describeWikiChatHandOver'
import { describeWikiGenerateConfirmation } from './utils/describeWikiGenerateConfirmation'
import { detectWikiPublishConflicts } from './utils/detectWikiPublishConflicts'
import { endOfWikiChatStart } from './utils/endOfWikiChatStart'
import { failureOfWikiChatReplyEnd } from './utils/failureOfWikiChatReplyEnd'
import { findGeneratedWikiProblem } from './utils/findGeneratedWikiProblem'
import { findNearestExistingAncestor } from './utils/findNearestExistingAncestor'
import { findUnacknowledgedWikiLeftover } from './utils/findUnacknowledgedWikiLeftover'
import { findWikiUpdateStartBlock } from './utils/findWikiUpdateStartBlock'
import {
  folderChangeCleanupNotice,
  type FolderChangeCleanupFailure,
  type FolderChangeCleanupStep,
} from './utils/folderChangeCleanupNotice'
import {
  formatCodebookDiagnostic,
  type CodebookDiagnostic,
} from './utils/formatCodebookDiagnostic'
import { hasWikiPublishEndedWait } from './utils/hasWikiPublishEndedWait'
import { inspectDeepWikiFreshness } from './utils/inspectDeepWikiFreshness'
import type { WikiLeftover } from './utils/isAcknowledgedWikiLeftover'
import { isWikiManifestOf } from './utils/isWikiManifestOf'
import { joinInFlight } from './utils/joinInFlight'
import { listWikiCandidates } from './utils/listWikiCandidates'
import { createLlmWikiView } from './utils/llmWikiView'
import { mayWikiChatStillPublish } from './utils/mayWikiChatStillPublish'
import { noticeWithSetupStep } from './utils/noticeWithSetupStep'
import { readLiveWikiUpdateMarker } from './utils/readLiveWikiUpdateMarker'
import { readLlmWikiViewFacts } from './utils/readLlmWikiViewFacts'
import { readWikiFileToOpen } from './utils/readWikiFileToOpen'
import { readWikiPublicationIdentity } from './utils/readWikiPublicationIdentity'
import { readWikiPublishToken } from './utils/readWikiPublishToken'
import { readWikiWatchStamp } from './utils/readWikiWatchStamp'
import {
  captureOwnedCursorMcpCatalogGeneration,
  refreshCursorMcpCatalog,
  removeOwnedCursorMcpCatalog,
} from './utils/refreshCursorMcpCatalog'
import { registerLlmWikiCommands } from './utils/registerLlmWikiCommands'
import { registerPlainCommand } from './utils/registerPlainCommand'
import { requestCursorWikiText } from './utils/requestCursorWikiText'
import { resolveDeepWikiDirectory } from './utils/resolveDeepWikiDirectory'
import { resolveDeepWikiSource } from './utils/resolveDeepWikiSource'
import { resolveExternalNodeExecutable } from './utils/resolveExternalNodeExecutable'
import { runCursorWikiUpdate } from './utils/runCursorWikiUpdate'
import {
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
import { startWikiGenerate, type WikiRunInTheWay } from './utils/startWikiRun'
import { thrownMessage } from './utils/thrownMessage'
import { unreadWikiUpdateEnd } from './utils/unreadWikiUpdateEnd'
import { waitForWikiPublish } from './utils/waitForWikiPublish'
import { watchWikiUpdateSigns } from './utils/watchWikiUpdateSigns'
import { wikiGenerateNotice } from './utils/wikiGenerateNotice'
import { wikiManifestIdentity } from './utils/wikiManifestIdentity'
import { wikiOutputLabel } from './utils/wikiOutputLabel'
import { wikiRunBoundMs } from './utils/wikiRunBoundMs'
import { wikiRunRecord } from './utils/wikiRunRecord'
import { OPEN_WIKI_ACTION, wikiUpdateNotice } from './utils/wikiUpdateNotice'
import {
  WikiUpdateRun,
  type WikiRunKind,
  type WikiUpdateEnd,
  type WikiUpdateHost,
  type WikiUpdateOutput,
} from './utils/wikiUpdateRun'
import { WikiUpdateTimeoutError } from './utils/wikiUpdateTimeoutError'

let stopExtension: (() => Promise<void>) | undefined

/** One change of this window's own Wiki update marker (its removal, or its turn into a stopped watch's reservation): the change, the timer of its next attempt while it waits, and the attempt while it runs. */
type WikiMarkerChangeEntry = {
  change: () => Promise<boolean>
  timer?: NodeJS.Timeout
  running?: Promise<boolean>
}

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
  // Unexpected failures on a test replay's paths, which the learner can read and copy (X5): one LogOutputChannel for the window. A host without a window API (a test's stand-in) gets none, as for the URI handler below.
  const output = vscode.window?.createOutputChannel?.('Codebook', {
    log: true,
  })
  if (output) context.subscriptions.push(output)
  const diagnostics = {
    // The channel is disposed with the extension's subscriptions: a failure reported while the window closes must not throw out of the stop that reports it (F99).
    log: (entry: CodebookDiagnostic): void => {
      try {
        output?.error(
          formatCodebookDiagnostic(entry, {
            extensionVersion: EXTENSION_VERSION,
            apiVersion: API_VERSION,
            hostName: vscode.env?.appName ?? 'unknown host',
            hostVersion: vscode.version ?? 'unknown version',
          }),
        )
      } catch {
        // A disposed channel has nowhere to write; the failure is already in the run's own answer.
      }
    },
    show: (): void => {
      try {
        output?.show(true)
      } catch {
        // A disposed channel cannot be shown.
      }
    },
  }
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
  /** How the Cursor agent of this window's last run exited; the LLM Wiki view words a stopped generation's cause from it. */
  let lastWikiAgentExit: WikiAgentExit | undefined
  // This window's id in the marker of a running update; another window's live marker refuses a start here.
  const wikiWindowId = randomUUID()
  // The reservation each of this window's stopped VS Code watches left on disk for other windows, by Wiki output, with the timer that removes it at that watch's bound.
  const wikiReservations = new Map<
    string,
    { release: () => Promise<boolean>; timer: NodeJS.Timeout }
  >()
  // The latest change of this window's own marker on each Wiki output (its removal, or its turn into a stopped watch's reservation), while it runs (`running`) or waits for its next attempt, with the timer of that attempt.
  const wikiMarkerChanges = new Map<string, WikiMarkerChangeEntry>()
  // How many attempts of this window's own marker changes have ended on each Wiki output; a start whose claim met the marker in change compares it ({@link claimWikiMarkerForStart}).
  const endedWikiMarkerChanges = new Map<string, number>()
  /**
   * Makes a change of this window's own marker beside a Wiki (its removal, or its turn into a stopped watch's reservation), and while the change cannot be made asks for it again later; called by {@link settleWikiRunMarker} at a run's end and by {@link dropWikiReservation} at a reservation's bound or at shutdown.
   * Why: the change runs under the claim on the marker, which another window can hold longer than the change waits (a killed window of another machine leaves its claim for {@link WIKI_UPDATE_MARKER_CLAIM_EXPIRY_MS}), and the system can refuse the claim, the read of the marker under it (on Windows a scanner or an indexer can hold the file) or the change. A run's marker left as it stands counts for every other window as a running update, with no Update anyway, until the run's bound has passed. A later change of the same output, and a start that takes the marker over, replace a change that waits: they name what the marker must be now.
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
    const pending: WikiMarkerChangeEntry = { change }
    wikiMarkerChanges.set(outputDirectory, pending)
    pending.running = change().catch(() => false)
    const isChanged = await pending.running
    pending.running = undefined
    endedWikiMarkerChanges.set(
      outputDirectory,
      (endedWikiMarkerChanges.get(outputDirectory) ?? 0) + 1,
    )
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
  /** What one Wiki run, a generation or an update, carries from its start to its end. */
  type WikiRun = {
    /** Whether the run generates the first Wiki or updates one; its bounds, its request and its words follow it. */
    kind: WikiRunKind
    projectRoot: string
    outputDirectory: string
    /** The Wiki folder as the learner reads it, which a generation's sentences name. */
    outputLabel: string
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
    /** The Cursor agent's exit code or signal where its process closed without a clean exit; the run's Output record names it ({@link wikiRunRecord}). */
    agentExit?: WikiAgentExit
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
    reader.diagnostics = diagnostics
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
        service.diagnostics = diagnostics.log
        // Every storage folder of the extension stays out of the causes the learner and the agent read (EN12).
        service.extraStorageRoots = [context.globalStorageUri.fsPath]
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
    // A generated page from another checkout must not masquerade as this project's Wiki.
    if (!(await isWikiOwnedBy(projectRoot, outputDirectory)))
      throw new Error(
        'The DeepWiki manifest does not identify this opened project.',
      )
  }
  /** Says whether the manifest of the Wiki folder names this opened project; called by {@link assertWikiOwner} and by a generation's end, which tells a manifest it cannot read apart from one of another checkout. @throws When the manifest is missing or no regular file ({@link readWikiFileToOpen}), or no JSON. @example await isWikiOwnedBy('/repo', '/repo/.codebook/wiki') // => true */
  const isWikiOwnedBy = async (
    projectRoot: string,
    outputDirectory: string,
  ): Promise<boolean> => {
    // The manifest is read as a file of the Wiki folder, never through a link and never past its bound.
    const manifestBytes = await readWikiFileToOpen(
      join(outputDirectory, WIKI_MANIFEST_FILE),
      'manifest',
    )
    const manifest: unknown = JSON.parse(manifestBytes.toString('utf8'))
    return isWikiManifestOf(manifest, projectRoot)
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
  /** Says whether the Wiki folder holds no Wiki at all: no manifest, and nothing a publish left that a start would refuse (a publish swaps the folder with its journal beside it); called by Open LLM Wiki in Browser before it opens the Wiki. @returns The folder and its label when it holds no Wiki; `undefined` otherwise. @throws The refusal of a link or a file on the folder's path in the project ({@link assertNoLinkOnWikiPath}). @example await findMissingWiki() // => { outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki' } */
  const findMissingWiki = async (): Promise<WikiUpdateOutput | undefined> => {
    const { projectRoot, outputDirectory } = await wikiLocation()
    // Nothing of the Wiki is read through a link on its folder's path in the project.
    await assertNoLinkOnWikiPath(outputDirectory, projectRoot)
    // A manifest that is there, or one that cannot be read at this moment, is no missing Wiki: the open's own checks name what is wrong with it.
    const token = await readWikiPublishToken(outputDirectory).catch(
      () => 'unreadable',
    )
    if (token !== undefined) return undefined
    // A publish in progress or stopped is no missing Wiki: the open's own failure names it.
    if (await findWikiUpdateStartBlock(outputDirectory, projectRoot))
      return undefined
    return {
      outputDirectory,
      outputLabel: wikiOutputLabel(projectRoot, outputDirectory),
    }
  }
  /**
   * Tells the learner that a folder holds no LLM Wiki, with Generate LLM Wiki, unless a generation is under way: this window's own run is told as a second start is ({@link showWikiUpdateRunning}), another window's run that runs or is starting by its own sentence ({@link describeOtherWikiWindow}); called by Open LLM Wiki in Browser and Update LLM Wiki for a folder without a Wiki.
   * Why: while a first generation runs there is no Wiki yet, and a Generate button would only lead to a refusal (/ship review pass 3, Cycle 0055 pt1).
   * @param wikiOutput - The Wiki folder, beside which another window's marker lies, and its label.
   * @param isStartUnderWay - Whether a start of this window is under way that has not begun its run; Update LLM Wiki's own check passes none, since that start is its own.
   * @example await showMissingWikiNotice({ outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki' })
   */
  const showMissingWikiNotice = async (
    wikiOutput: WikiUpdateOutput,
    isStartUnderWay = false,
  ): Promise<void> => {
    // This window's own generation: its progress, as a second start is told.
    if (wikiUpdateRun.isRunning()) {
      showWikiUpdateRunning()
      return
    }
    // A start of this window that has not begun its run yet (its checks, the confirmation, the claim) is told as starting, never offered once more.
    if (isStartUnderWay) {
      void showNotice('information', WIKI_RUN_STARTING_SENTENCE)
      return
    }
    const holder = await findWikiRunHolder(wikiOutput.outputDirectory)
    // Another window's run that runs or starts now: its own sentence, never a Generate it would refuse.
    if (holder) {
      void showNotice(
        'information',
        describeOtherWikiWindow(holder, 'generate'),
      )
      return
    }
    showWikiActionNotice('error', describeMissingWiki(wikiOutput.outputLabel), [
      GENERATE_WIKI_ACTION,
    ])
  }
  /**
   * Names another window's run beside a Wiki folder: a marker that is being written, or one of a run that has not stopped its watch; called by {@link showMissingWikiNotice}.
   * @param outputDirectory - The Wiki folder.
   * @returns The marker's holder; `undefined` for none, a stopped watch's reservation, this window's own marker or a look that failed.
   * @example await findWikiRunHolder('/repo/.codebook/wiki') // => { pid: 4242, windowId: '3f6c', host: 'vscode', startedAtMs: 1_790_000_000_000, runKind: 'generate' }
   */
  const findWikiRunHolder = async (
    outputDirectory: string,
  ): Promise<Parameters<typeof describeOtherWikiWindow>[0] | undefined> => {
    const markerLook = await readLiveWikiUpdateMarker(
      outputDirectory,
      wikiWindowId,
    ).catch(() => undefined)
    if (markerLook?.kind === 'being-written') return markerLook.heldBy
    // A stopped watch's reservation is told by the Generate it refuses, with its override.
    if (
      markerLook?.kind === 'live' &&
      markerLook.heldBy.watchEndedAtMs === undefined
    )
      return markerLook.heldBy
    return undefined
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
  /** Writes the Output › Codebook record of the run that just ended ({@link wikiRunRecord}), from the state just recorded; called by {@link finishWikiUpdate} for a run and by {@link showWikiUpdateNotice} for a refused start and "already current". It never throws: a record the channel cannot take has nobody to report to. @param details - The run's kind, and for a run its start and the Cursor agent's exit. @example writeWikiRunRecord({ runKind: 'update' }) */
  const writeWikiRunRecord = (details: {
    runKind: WikiRunKind
    startedAt?: string
    agentExit?: WikiAgentExit
  }): void => {
    const ended = wikiUpdateRun.status()
    if (ended.state === 'idle' || ended.state === 'running') return
    try {
      output?.info(wikiRunRecord(ended, details))
    } catch {
      // A disposed channel has nowhere to write; the notice still tells the end.
    }
  }
  /** The command each button of a generation's notice runs ({@link wikiGenerateNotice}). */
  const WIKI_NOTICE_ACTION_COMMANDS: Record<string, string> = {
    [OPEN_WIKI_IN_BROWSER_ACTION]: OPEN_DEEP_WIKI_COMMAND,
    [UPDATE_WIKI_ACTION]: UPDATE_DEEP_WIKI_COMMAND,
    [GENERATE_WIKI_ACTION]: GENERATE_DEEP_WIKI_COMMAND,
  }
  /** Shows a notice whose buttons each start a Codebook command ({@link WIKI_NOTICE_ACTION_COMMANDS}); the pressed button's command tells the learner itself what failed. @example showWikiActionNotice('error', 'Codebook found no LLM Wiki in .codebook/wiki.', [GENERATE_WIKI_ACTION]) */
  const showWikiActionNotice = (
    severity: NoticeSeverity,
    message: string,
    actions: readonly string[],
  ): void => {
    void showNotice(severity, message, ...actions).then(
      (choice) => {
        const command = choice && WIKI_NOTICE_ACTION_COMMANDS[choice]
        // The command's own handler tells the learner why it did not run; its rejection has nobody else to go to.
        if (command)
          void vscode.commands
            .executeCommand(command)
            .then(undefined, () => undefined)
      },
      // A notification the editor could not show has nobody to report to either.
      () => undefined,
    )
  }
  /** Tells the learner in the editor how a generation just ended ({@link wikiGenerateNotice}), with the buttons of its next step; called by {@link finishWikiUpdate} for a run of kind `generate`. @example showWikiGenerateNotice() */
  const showWikiGenerateNotice = (): void => {
    if (isExtensionStopping) return
    const notice = wikiGenerateNotice(wikiUpdateRun.status())
    if (notice)
      showWikiActionNotice(notice.severity, notice.message, notice.actions)
  }
  /** Tells the learner in the editor how the update just ended, in the page's own sentence, and writes its record; called after every recorded ending of an update, also a refused start and "already current". An ending that asks for a step offers to open the Wiki; `onUpdateAnyway` adds the button that starts the update although an earlier chat's leftover is in the way. @param run - The run that ended, whose start and agent exit its record names; absent for a refused start and "already current". @example showWikiUpdateNotice() */
  const showWikiUpdateNotice = (
    onUpdateAnyway?: () => void,
    run?: WikiRun,
  ): void => {
    writeWikiRunRecord(
      run ? wikiRunRecordDetails(run) : { runKind: 'update' as const },
    )
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
            .executeCommand(OPEN_DEEP_WIKI_COMMAND)
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
    const running = wikiUpdateRun.status()
    void showNotice(
      'information',
      describeSecondWikiUpdateStart(
        wikiProgressPlace(),
        // A generation's refusal names no browser reader: its project has no Wiki page yet.
        running.state === 'running' ? running.runKind : undefined,
      ),
    )
  }
  /** What a run's Output record names besides its end ({@link wikiRunRecord}): its kind, its start and the Cursor agent's exit. @example wikiRunRecordDetails(run) // => { runKind: 'generate', startedAt: '2026-10-26T04:30:04.000Z', agentExit: undefined } */
  const wikiRunRecordDetails = (
    run: WikiRun,
  ): Parameters<typeof writeWikiRunRecord>[0] => ({
    runKind: run.kind,
    startedAt: new Date(run.startedAtMs).toISOString(),
    agentExit: run.agentExit,
  })
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
    const hasNewPublication =
      siteAtEnd.publicationAtEnd !== undefined &&
      siteAtEnd.publicationAtEnd !== run.publicationAtStart
    return {
      end: classifyWikiUpdateEnd({
        runKind: run.kind,
        outputLabel: run.outputLabel,
        generatedSiteProblem: await findGeneratedSiteProblem(
          run,
          hasNewPublication,
        ),
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
      hasNewPublication,
    }
  }
  /** Checks a generation's new publication for its owner and its entry page ({@link findGeneratedWikiProblem}); called by {@link readWikiUpdateEnd}. @param hasNewPublication - Whether the publisher's receipt names a manifest that was not there at the start. @returns The failed check's sentence; `undefined` for an update, for no new publication and when both checks pass. @example await findGeneratedSiteProblem(run, true) // => undefined */
  const findGeneratedSiteProblem = async (
    run: WikiRun,
    hasNewPublication: boolean,
  ): Promise<string | undefined> =>
    run.kind === 'generate' && hasNewPublication
      ? findGeneratedWikiProblem(
          {
            isOwnedByProject: () =>
              isWikiOwnedBy(run.projectRoot, run.outputDirectory),
            readEntryPage: () =>
              readWikiFileToOpen(
                join(run.outputDirectory, WIKI_ENTRY_FILE),
                'entry page',
              ),
          },
          run.outputLabel,
        )
      : undefined
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
      // A reservation lasts the bound of its run's kind, the one every reader of the marker uses ({@link wikiRunBoundMs}); only a VS Code watch leaves one. The bounds this module reads itself are passed, so a host test that shortens one reaches the timer.
      timer: setTimeout(
        () => {
          void dropWikiReservation(run.outputDirectory)
        },
        wikiRunBoundMs(run.kind, 'vscode', {
          generateMs: WIKI_GENERATE_TIMEOUT_MS,
          cursorUpdateMs: WIKI_CURSOR_UPDATE_TIMEOUT_MS,
          watchedUpdateMs: WIKI_UPDATE_WATCH_TIMEOUT_MS,
        }),
      ).unref(),
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
    lastWikiAgentExit = run.agentExit
    wikiUpdateRun.end(end)
    const endedAtMs = Date.now()
    // Stopping a VS Code watch does not stop the chat, and neither does a watch that broke off or a request Codebook left in the chat at the 30 seconds; a Cursor agent is stopped with its run, and a closing window takes its chat with it. A chat whose publish is on disk has done its work, also when the watch was stopped while it read that publish or just before its next look: it leaves no chat that may still publish and no reservation.
    const mayAgentStillWork =
      !hasNewPublication &&
      mayWikiChatStillPublish(
        run.host,
        stoppedAs,
        isExtensionStopping,
        // An end the run itself marks as one its chat can publish after (a watch that broke off, a request left in the chat) leaves the reservation a stopped watch leaves.
        observed.mayBeReplacedLater ?? false,
      )
    const recordWritten = rememberLastWikiRun({
      outputDirectory: run.outputDirectory,
      startedAtMs: run.startedAtMs,
      endedAtMs,
      mayAgentStillWork,
      candidateNames: [...run.seenCandidateNames],
      // A reload keeps a generation's bound for its stopped watch.
      ...(run.kind === 'generate' ? { runKind: run.kind } : {}),
    })
    // The editor tells the learner in the same turn the page's status changes; the marker's file work below would put the notice a turn or more behind the page.
    try {
      if (run.kind === 'generate') {
        writeWikiRunRecord(wikiRunRecordDetails(run))
        showWikiGenerateNotice()
      } else showWikiUpdateNotice(undefined, run)
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
  /** Shows the status bar entry of a VS Code watch while the watch runs, and aborts the run when the learner presses the entry ({@link WIKI_CHAT_WATCH_CANCEL_COMMAND}), which stops watching, not the chat. It shows no notification: the editor stacks notifications over the Chat view, where any other notification pushes one that lasts the whole watch over the chat's approval buttons. @returns What the watch answered. @example await withWikiChatWatchStatus(run, () => watchForWikiPublish(run, reply)) // => { cancelled: true, … } */
  const withWikiChatWatchStatus = async <Watched>(
    run: WikiRun,
    work: () => Promise<Watched>,
  ): Promise<Watched> => {
    // An editor without the status bar API still runs the watch, without a Cancel.
    if (!vscode.window.createStatusBarItem) return work()
    const entry = showWikiChatWatchStatus(
      vscode.window,
      vscode.StatusBarAlignment.Right,
    )
    const cancel = (): void => run.controller.abort()
    cancelShownWikiChatWatch = cancel
    try {
      return await work()
    } finally {
      // The entry and its Cancel go with the watch; a Cancel another watch set meanwhile stays.
      if (cancelShownWikiChatWatch === cancel)
        cancelShownWikiChatWatch = undefined
      entry.dispose()
    }
  }
  /** Watches for the editor agent's publish after VS Code's chat took up the request, then records the run's result for the reader; settles when the watch has stopped. For that time the status bar shows the watch and its Cancel, the same for every run ({@link withWikiChatWatchStatus}), and no notification lies over the chat's approval buttons. @param chat - Of the start in the chat: the watch of the chat's reply (when the reply ends, one more look decides and the run ends at once). @example await watchVsCodeWikiUpdate(run, chatStart) */
  const watchVsCodeWikiUpdate = async (
    run: WikiRun,
    { reply }: WatchedWikiChat,
  ): Promise<void> => {
    const observed = await withWikiChatWatchStatus(run, () =>
      watchForWikiPublish(run, reply),
    )
    // The end is recorded after the entry is gone, so the page and the notice never tell an end while the entry still offers Cancel; and outside the watch's guard: only what the watch itself threw is a watch that broke off.
    await finishWikiUpdate(run, observed)
  }
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
        ...failureOfWikiChatReplyEnd(result.outcome, reply.end(), run.kind),
      }
    } catch (error) {
      // The watch broke off, not the chat: the end says so, and the next press is held back as after a stopped watch, so no second chat starts beside the first.
      return {
        failure: describeBrokenWikiWatch(thrownMessage(error), run.kind),
        isFailureCodebookSentence: true,
        mayBeReplacedLater: true,
      }
    }
  }
  /** The title of the progress notification a Cursor run shows, by its kind (Cycle 0055, D3, D5). */
  const CURSOR_RUN_PROGRESS_TITLES: Record<WikiRunKind, string> = {
    update: 'Updating LLM Wiki with Cursor Agent',
    generate: 'Generating the LLM Wiki in cursor-agent…',
  }
  /** What a Cursor run says when the opened repository changed while its agent worked, by the run's kind (Cycle 0055, D5). */
  const REPOSITORY_CHANGED_SENTENCES: Record<WikiRunKind, string> = {
    update:
      'The opened repository changed during the Wiki update. Reopen its Wiki to see the result.',
    generate:
      'The opened repository changed during the LLM Wiki generation. Open that repository again, then run Codebook: Open LLM Wiki in Browser to see the result.',
  }
  /** Runs the Cursor Agent CLI for one generation or update and records the run's result for the reader; settles when the agent process has closed. @example await runCursorWikiAgent(run, '/codebook Update LLM Wiki …') */
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
        CURSOR_RUN_PROGRESS_TITLES[run.kind],
        run,
        async () => {
          await runCursorWikiUpdate(
            run.projectRoot,
            query,
            run.controller.signal,
            run.timeoutMs,
            run.kind,
          )
          // A successful CLI exit alone does not prove that the correct project's site is readable.
          if ((await realpath(requireWorkspace())) !== run.projectRoot)
            throw new Error(REPOSITORY_CHANGED_SENTENCES[run.kind])
        },
      )
    } catch (error) {
      agentError = error
      didAgentFail = true
      // The exit code or signal goes into the run's Output record as data, never the sentence around it.
      run.agentExit = agentExitOf(error)
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
   * Records a refused start of a Wiki update in a sentence Codebook wrote and tells the learner; called by {@link lookAtWikiStart} and {@link checkWikiUpdateStart} for each refusal they word themselves.
   * @param host - Editor host that was asked.
   * @param wikiOutput - Resolved Wiki folder and its label.
   * @param reason - The sentence of the refusal.
   * @param workInProgress - Given when the refusal names somebody who is still updating this Wiki (another window's run, or an earlier chat the start waits for): the site may then be replaced after the refusal, which the recorded state says, and `onUpdateAnyway` in it offers the override.
   * @returns `undefined`, the start checks' answer for a start that does not go ahead.
   * @example
   * return refuseWikiStart('vscode', wikiOutput, 'This Wiki was published again while Codebook checked it. Press Update LLM Wiki again.')
   */
  const refuseWikiStart = (
    host: WikiUpdateHost,
    wikiOutput: WikiUpdateOutput,
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
  /**
   * Starts the update again when the learner presses "Update anyway", with only the leftovers the refusals named ignored; called by the button of a refusal {@link lookAtWikiStart} words for an earlier chat's leftover, and by the "Update it instead?" offer of a generation.
   * @param leftovers - The leftovers of the earlier presses and of this refusal ({@link updateDeepWiki}).
   * @param refusedAttempt - The start whose refusal or offer showed the button, which may still be unwinding at the press; another start or run of this window at the press meets the update as any press does ({@link runWikiAttempt}), never queued behind it (/ship review pass 3, Cycle 0055 pt1).
   * @returns Nothing; a start that throws is told in a notice.
   * @example
   * startWikiUpdateAnyway([{ kind: 'last-run', endedAtMs: 1_790_000_000_000 }], refusedAttempt)
   */
  const startWikiUpdateAnyway = (
    leftovers: WikiLeftover[],
    refusedAttempt?: Promise<void>,
  ): void => {
    // The refused attempt may still be unwinding when the button is pressed; the override is a start of its own, after it.
    Promise.resolve(attemptToAwaitBeforeOverride(refusedAttempt))
      .catch(() => undefined)
      .then(() => updateDeepWiki(leftovers))
      .catch((error: unknown) => {
        void showNotice(
          'error',
          `Codebook could not start the Wiki update: ${thrownMessage(error)}`,
        )
      })
  }
  /** What the Wiki looked like to the first checks of a start that may go on: its publish token and publication, and its manifest's identity and freshness (undefined while the manifest cannot be inspected). */
  type WikiToUpdate = Pick<WikiUpdateStart, 'publicationAtStart'> & {
    tokenAtStart: string
    before: WikiUpdateEndFacts['published']
  }
  /**
   * Makes the checks of a start that need nothing but the Wiki folder: what makes the publisher refuse, no Wiki at all, a manifest of another checkout, a Wiki that is already current; called by {@link lookAtWikiStart} first.
   * @param projectRoot - Canonical opened project.
   * @param wikiOutput - Resolved Wiki folder and its label.
   * @param host - Editor host that was asked.
   * @returns What the Wiki looked like, when the start may go on; `undefined` after the refusal or "already current" was recorded and the learner told.
   * @throws What a check threw (a manifest of another checkout, a file system error).
   * @example
   * await inspectWikiToUpdate('/repo', wikiOutput, 'vscode') // => { tokenAtStart: 'a1b2…', publicationAtStart: 'a1b2…+0f9e…', before: { identity, revision, index, freshness } }
   */
  const inspectWikiToUpdate = async (
    projectRoot: string,
    wikiOutput: WikiUpdateOutput,
    host: WikiUpdateHost,
  ): Promise<WikiToUpdate | undefined> => {
    const { outputDirectory } = wikiOutput
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
      const noWiki = describeMissingWiki(wikiOutput.outputLabel)
      // The page records the refusal like any other; there is no site to keep, so neither says one was kept.
      wikiUpdateRun.refuseStart(host, wikiOutput, {
        kind: 'failed',
        reason: noWiki,
        isCodebookSentence: true,
        site: 'missing',
      })
      writeWikiRunRecord({ runKind: 'update' })
      // The notice offers the generation itself instead of a chat request to retype (Cycle 0055, proposed change 3), unless another window generates it now.
      await showMissingWikiNotice(wikiOutput)
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
    return { tokenAtStart, publicationAtStart, before }
  }
  /**
   * Claims the Wiki's marker for a start of this window, and claims it once more after this window's own marker change that held the claim at that moment; called by {@link lookAtWikiStart} last.
   * Why: the end of this window's previous run removes its marker, or turns it into a stopped watch's reservation, under the claim on the marker ({@link settleWikiRunMarker}). A start of this window that claims in that moment (Update anyway chosen right after the run ended, or the change slowed by the disk) meets the marker in change, which is no other window's, and would refuse itself with "Another editor window is starting or ending an update of this Wiki" (Cycle 0052 task 27).
   * @param outputDirectory - The Wiki output the start claims.
   * @param marker - This window's marker for the run ({@link claimWikiUpdateMarker}).
   * @returns What the claim answered; after this window's own change ran meanwhile, what the second claim answered. A marker in change that no change of this window explains stays the first answer.
   * @throws What {@link claimWikiUpdateMarker} throws.
   * @example
   * await claimWikiMarkerForStart('/repo/.codebook/wiki', { pid: process.pid, windowId, host: 'vscode', startedAtMs: Date.now() }) // => { release, reserve }
   */
  const claimWikiMarkerForStart = async (
    outputDirectory: string,
    marker: Parameters<typeof claimWikiUpdateMarker>[1],
  ): Promise<Awaited<ReturnType<typeof claimWikiUpdateMarker>>> => {
    const endedBefore = endedWikiMarkerChanges.get(outputDirectory) ?? 0
    const claim = await claimWikiUpdateMarker(outputDirectory, marker)
    if (!('heldBy' in claim) || !('isMarkerInChange' in claim.heldBy))
      return claim
    const running = wikiMarkerChanges.get(outputDirectory)?.running
    // This window's own change still holds the claim: the start waits until it has ended.
    if (running) await running
    // No change of this window ran meanwhile, so another window changes the marker.
    else if ((endedWikiMarkerChanges.get(outputDirectory) ?? 0) === endedBefore)
      return claim
    return claimWikiUpdateMarker(outputDirectory, marker)
  }
  /**
   * Looks for another run in the way of a new one of this window, generation or update alike: another window's marker that is being written or runs, which nothing overrides, and then the first leftover of an earlier chat that no press of the override passed ({@link findUnacknowledgedWikiLeftover}: another window's stopped watch, a recent candidate, this window's own stopped watch); called by {@link lookAtWikiStart} and by the generation's start ({@link startWikiGenerate}).
   * Why: each window holds its own run state; the marker is the trace of another window's run before its agent has staged anything, and a chat Codebook stopped watching may still publish.
   * @param outputDirectory - The Wiki output a run would claim.
   * @param acknowledgedLeftovers - The leftovers the override passed so far; empty for an ordinary press.
   * @param runKind - The kind of the start: each refusal names its override (`Update anyway` or `Generate anyway`), and a generation's start words a holder that names no run yet as a run.
   * @param startAnyway - Starts the run again with the leftovers given passed; the override of a leftover's refusal calls it with this refusal's leftovers added and the start that was refused.
   * @returns The refusal's sentence, with the override for a leftover; `undefined` when nothing is in the way.
   * @example
   * await findWikiRunInTheWay('/repo/.codebook/wiki', [], 'update', startWikiUpdateAnyway) // => { reason: 'The VS Code chat this window asked at … may still be updating this Wiki; …', override }
   */
  const findWikiRunInTheWay = async (
    outputDirectory: string,
    acknowledgedLeftovers: readonly WikiLeftover[],
    runKind: WikiRunKind,
    startAnyway: (
      leftovers: WikiLeftover[],
      refusedAttempt?: Promise<void>,
    ) => void,
  ): Promise<WikiRunInTheWay | undefined> => {
    // The start this look belongs to, which its override waits for, and only for it.
    const refusedAttempt = wikiUpdate
    const markerLook = await readLiveWikiUpdateMarker(
      outputDirectory,
      wikiWindowId,
    )
    // A marker another window is writing at this moment is the beginning of its run; a marker file that cannot be read may be a running window's marker, and its refusal names the file once it stayed unreadable past a write's time or is dated ahead of the clock.
    if (markerLook.kind === 'being-written')
      return { reason: describeOtherWikiWindow(markerLook.heldBy, runKind) }
    const otherWindow =
      markerLook.kind === 'live' ? markerLook.heldBy : undefined
    // A run that is active in another window refuses the start, and nothing overrides it.
    if (otherWindow && otherWindow.watchEndedAtMs === undefined)
      return { reason: describeOtherWikiWindow(otherWindow, runKind) }
    // The first leftover of an earlier chat in the way that no press of the override passed; a refusal names one chat's leftovers, and its override passes only those.
    const unacknowledged = await findUnacknowledgedWikiLeftover(
      outputDirectory,
      {
        nowMs: Date.now(),
        watchTimeoutMs: WIKI_UPDATE_WATCH_TIMEOUT_MS,
        otherWindow,
        // The record of another output says nothing about this one's candidates.
        lastRun: lastWikiRuns.get(outputDirectory),
        acknowledged: acknowledgedLeftovers,
        listCandidates: listWikiCandidates,
        runKind,
      },
    )
    if (!unacknowledged) return undefined
    return {
      reason: unacknowledged.reason,
      override: (): void =>
        startAnyway(
          [...acknowledgedLeftovers, ...unacknowledged.named],
          refusedAttempt,
        ),
    }
  }
  /**
   * Claims the Wiki's marker for a run of this window ({@link claimWikiMarkerForStart}), with the run's kind in it, and makes the marker this run's own: this window's reservation of that output stops counting down, and a change of an earlier run's marker that waits for its next attempt is dropped; called by {@link lookAtWikiStart} and by the generation's start.
   * @param outputDirectory - The Wiki output the run claims.
   * @param host - The editor host that runs it.
   * @param runKind - The run's kind; a generation's marker records it, so every window reads its bounds ({@link wikiRunBoundMs}).
   * @param startedAtMs - When the run starts.
   * @returns The claim's release and reservation, or the marker of another window that holds it.
   * @throws What {@link claimWikiUpdateMarker} throws.
   * @example await claimWikiRunMarker('/repo/.codebook/wiki', 'vscode', 'generate', Date.now()) // => { release, reserve }
   */
  const claimWikiRunMarker = async (
    outputDirectory: string,
    host: WikiUpdateHost,
    runKind: WikiRunKind,
    startedAtMs: number,
  ): ReturnType<typeof claimWikiMarkerForStart> => {
    const claim = await claimWikiMarkerForStart(outputDirectory, {
      pid: process.pid,
      windowId: wikiWindowId,
      host,
      startedAtMs,
      // An update's marker stays as earlier versions wrote it.
      ...(runKind === 'generate' ? { runKind } : {}),
    })
    if ('heldBy' in claim) return claim
    // This window's own reservation of this output, if it left one, is now this run's marker; its timer must not remove it. A reservation of another output shares no marker with this run and keeps its timer.
    clearTimeout(wikiReservations.get(outputDirectory)?.timer)
    wikiReservations.delete(outputDirectory)
    // A change of an earlier run's marker that waits for its next attempt has nothing left to change: this run holds the marker now.
    cancelWikiMarkerChange(outputDirectory)
    return claim
  }
  /**
   * Makes the checks of a start once, for one generation of the Wiki: those of the Wiki folder ({@link inspectWikiToUpdate}), another window's marker, an earlier chat's leftover ({@link findUnacknowledgedWikiLeftover}), and last the claim of the marker; called by {@link checkWikiUpdateStart}, a second time when a publish landed while the first look ran.
   * @param projectRoot - Canonical opened project.
   * @param wikiOutput - Resolved Wiki folder and its label.
   * @param host - Editor host that was asked.
   * @param acknowledgedLeftovers - The leftovers "Update anyway" passed so far ({@link checkWikiUpdateStart}).
   * @returns
   * - The start may go ahead: what the run begins with; the Wiki's marker is claimed for it
   * - The start was refused or nothing needs updating: `undefined`, after the state was recorded and the learner told
   * - A publish landed while the checks ran: `published-meanwhile`, with nothing recorded and no marker claimed
   * @throws What a check threw (a manifest of another checkout, a file system error).
   * @example
   * await lookAtWikiStart('/repo', wikiOutput, 'vscode', []) // => 'published-meanwhile'
   */
  const lookAtWikiStart = async (
    projectRoot: string,
    wikiOutput: WikiUpdateOutput,
    host: WikiUpdateHost,
    acknowledgedLeftovers: readonly WikiLeftover[],
  ): Promise<WikiUpdateStart | undefined | 'published-meanwhile'> => {
    const { outputDirectory } = wikiOutput
    const wikiToUpdate = await inspectWikiToUpdate(
      projectRoot,
      wikiOutput,
      host,
    )
    // A check of the Wiki folder refused the start or found the Wiki current; it has recorded that and told the learner.
    if (!wikiToUpdate) return undefined
    const { tokenAtStart, publicationAtStart, before } = wikiToUpdate
    const inTheWay = await findWikiRunInTheWay(
      outputDirectory,
      acknowledgedLeftovers,
      'update',
      startWikiUpdateAnyway,
    )
    // Another window's run, which nothing overrides, or an earlier chat's leftover, which "Update anyway" passes.
    if (inTheWay)
      return refuseWikiStart(host, wikiOutput, inTheWay.reason, {
        onUpdateAnyway: inTheWay.override,
      })
    // A publish that landed while the checks ran made them about two generations: check the new one.
    if ((await readWikiPublishToken(outputDirectory)) !== tokenAtStart)
      return 'published-meanwhile'
    const startedAtMs = Date.now()
    const claim = await claimWikiRunMarker(
      outputDirectory,
      host,
      'update',
      startedAtMs,
    )
    // Another window began its run between the look at the marker and this write.
    if ('heldBy' in claim)
      return refuseWikiStart(
        host,
        wikiOutput,
        describeOtherWikiWindow(claim.heldBy),
        {},
      )
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
    for (const isLastAttempt of [false, true]) {
      const look = await lookAtWikiStart(
        projectRoot,
        wikiOutput,
        host,
        acknowledgedLeftovers,
      )
      // A start that may go ahead, or one that was refused or found nothing to update, ends the checks; only a publish that landed meanwhile asks for another look.
      if (look !== 'published-meanwhile') return look
      // A second publish while the checks ran leaves no generation to check.
      if (isLastAttempt)
        return refuseWikiStart(
          host,
          wikiOutput,
          'This Wiki was published again while Codebook checked it. Press Update LLM Wiki again.',
        )
    }
    return undefined
  }
  /**
   * Begins a run whose start checks passed and whose marker is claimed, generation or update alike, and hands its request to the editor agent: VS Code's chat in a session of its own, with a watch for the publish once the chat gives its first sign, or the Cursor agent CLI; called by {@link updateDeepWiki} and {@link generateDeepWiki}.
   * Every step from the run's begin to the hand-over is guarded: one that throws ends the run as failed with what was thrown, so this window does not stay "already running" with its marker in place.
   * @param run - The run, with its kind, its bound and its claimed marker.
   * @param buildQuery - Writes the run's request once the run has begun.
   * @returns Once the Cursor agent closed, or once the VS Code chat's opening ended (the watch outlives this call).
   * @throws What was thrown before the run began; a run that began records its failure instead.
   * @example await launchWikiRun(run, () => buildWikiGeneratePrompt({ … }))
   */
  const launchWikiRun = async (
    run: WikiRun,
    buildQuery: () => string,
  ): Promise<void> => {
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
        { outputDirectory: run.outputDirectory, outputLabel: run.outputLabel },
        run.timeoutMs,
        // Only VS Code's chat asks for approvals; the Cursor agent runs without prompts.
        !isCursorHost && run.isOutputOutsideProject,
        run.kind,
      )
      const query = buildQuery()
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
      // The request gets a chat session of its own; only what the update's own steps name counts as a sign that the chat works on it, and a request without a sign within the bound is left in the chat, whose commands cannot name it.
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
              outputDirectory: run.outputDirectory,
              skillDirectory: join(context.extensionPath, 'skills', 'codebook'),
            },
            reportSign,
          ),
        readOutputStamp: () => readWikiWatchStamp(run.outputDirectory),
        signal: run.controller.signal,
        bounds: {
          sessionStartMs: WIKI_CHAT_SESSION_START_TIMEOUT_MS,
          answerMs: WIKI_CHAT_OPEN_TIMEOUT_MS,
          outputPollMs: WIKI_UPDATE_WATCH_POLL_MS,
        },
      })
      // Only a chat that works on the request is watched; a window that began to close meanwhile starts no watch that its shutdown no longer finds.
      const startEnd = endOfWikiChatStart(
        chatStart,
        WIKI_CHAT_OPEN_TIMEOUT_MS,
        isExtensionStopping || run.controller.signal.aborted,
        run.kind,
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
  }
  /**
   * Runs one start of a Wiki run, generation or update, unless one is under way in this window, coalescing repeated presses; called by {@link updateDeepWiki} and {@link generateDeepWiki}.
   * @param startRun - The run's start: its checks and, when they pass, its launch ({@link launchWikiRun}).
   * @returns The start under way when a press arrives during one (in Cursor the first call lasts the whole run); otherwise once this start settled.
   * @throws What the start threw.
   * @example await runWikiAttempt(async () => { … })
   */
  const runWikiAttempt = async (
    startRun: () => Promise<void>,
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
      await startRun()
    })()
    wikiUpdate = attempt
    try {
      await attempt
    } finally {
      if (wikiUpdate === attempt) wikiUpdate = undefined
    }
  }
  /**
   * Builds the run a start that passed its checks begins with: its kind, folder, host, the start's facts and claimed marker, the bound of its kind ({@link wikiRunBoundMs}) and a fresh abort; called by {@link updateDeepWiki} and {@link generateDeepWiki}.
   * @example newWikiRun('generate', '/repo', { outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki' }, 'cursor', start) // => { kind: 'generate', timeoutMs: 3_300_000, … }
   */
  const newWikiRun = (
    kind: WikiRunKind,
    projectRoot: string,
    wikiOutput: WikiUpdateOutput,
    host: WikiUpdateHost,
    start: Pick<
      WikiRun,
      | 'tokenAtStart'
      | 'publicationAtStart'
      | 'uncoveredAtStart'
      | 'releaseMarker'
      | 'reserveMarker'
      | 'startedAtMs'
    >,
  ): WikiRun => ({
    kind,
    projectRoot,
    outputDirectory: wikiOutput.outputDirectory,
    outputLabel: wikiOutput.outputLabel,
    host,
    tokenAtStart: start.tokenAtStart,
    publicationAtStart: start.publicationAtStart,
    uncoveredAtStart: start.uncoveredAtStart,
    // The label is the absolute path exactly when the folder is not inside the project.
    isOutputOutsideProject:
      wikiOutput.outputLabel === wikiOutput.outputDirectory,
    releaseMarker: start.releaseMarker,
    reserveMarker: start.reserveMarker,
    startedAtMs: start.startedAtMs,
    seenCandidateNames: new Set(),
    // The bounds this module reads itself, so a host test that shortens one reaches the run.
    timeoutMs: wikiRunBoundMs(kind, host, {
      generateMs: WIKI_GENERATE_TIMEOUT_MS,
      cursorUpdateMs: WIKI_CURSOR_UPDATE_TIMEOUT_MS,
      watchedUpdateMs: WIKI_UPDATE_WATCH_TIMEOUT_MS,
    }),
    controller: new AbortController(),
  })
  /** Resolves the opened project, its Wiki folder with the label the learner reads, and the editor host, for a run's start. @example await wikiRunPlace() // => { projectRoot: '/repo', wikiOutput: { outputDirectory: '/repo/.codebook/wiki', outputLabel: '.codebook/wiki' }, host: 'vscode' } */
  const wikiRunPlace = async (): Promise<{
    projectRoot: string
    wikiOutput: WikiUpdateOutput
    host: WikiUpdateHost
  }> => {
    const { projectRoot, outputDirectory } = await wikiLocation()
    return {
      projectRoot,
      wikiOutput: {
        outputDirectory,
        outputLabel: wikiOutputLabel(projectRoot, outputDirectory),
      },
      host: isCursorHost ? 'cursor' : 'vscode',
    }
  }
  /** Starts a project-bound skill update from the browser or command, coalescing repeated clicks. @param acknowledgedLeftovers - Given when the learner pressed "Update anyway": the leftovers named by the refusals it was pressed on, one press after the other, which alone are ignored; every other leftover, there already or appeared since, refuses the start with a notice of its own, and another window's running update still refuses it. @example await updateDeepWiki() */
  const updateDeepWiki = (
    acknowledgedLeftovers: readonly WikiLeftover[] = [],
  ): Promise<void> =>
    runWikiAttempt(async () => {
      const { projectRoot, wikiOutput, host } = await wikiRunPlace()
      let start: WikiUpdateStart | undefined
      try {
        start = await checkWikiUpdateStart(
          projectRoot,
          wikiOutput,
          host,
          acknowledgedLeftovers,
        )
      } catch (error) {
        // The page waits for this start; a check that threw must reach it as a failed start with the reason, not as silence, and the Output record names it as every refused start's does.
        wikiUpdateRun.refuseStart(host, wikiOutput, {
          kind: 'failed',
          reason: thrownMessage(error),
        })
        writeWikiRunRecord({ runKind: 'update' })
        throw error
      }
      if (!start) return
      // The update request names the managed skill's procedure, so Cursor's agent gets the skill once the checks passed, as a generation's does (Eng decision 73).
      if (isCursorHost)
        await prepareCursorSkillForUpdate(start, host, wikiOutput)
      // The checks and the skill take time (the freshness inspection hashes every source). A window that began to close meanwhile has already looked for a run to stop, so it starts none: no watch and no unattended agent.
      if (isExtensionStopping) {
        await start.releaseMarker().catch(() => undefined)
        return
      }
      const { hasGitRepository } = start
      const run = newWikiRun('update', projectRoot, wikiOutput, host, start)
      await launchWikiRun(run, () =>
        buildWikiUpdatePrompt({
          manifestPath: join(wikiOutput.outputDirectory, WIKI_MANIFEST_FILE),
          timeoutMs: run.timeoutMs,
          // Nothing shows the Cursor CLI's reply to the learner, so its report is not asked for.
          isReplyRead: !isCursorHost,
          hasGitRepository,
          uncoveredPaths: run.uncoveredAtStart,
        }),
      )
    })
  /**
   * Tells the learner why a generation did not start, writes its Output record, and offers the override where there is one; called for every refusal of {@link startWikiGenerate} and for a start that threw.
   * A generation's refusal is not recorded as the update's state: the reader page that shows that state exists only for a published Wiki.
   * @param host - The editor host that was asked.
   * @param wikiOutput - The Wiki folder and its label.
   * @param reason - The refusal's sentence.
   * @param override - Starts the generation with the refusal's leftovers passed (Generate anyway).
   * @example refuseWikiGenerate('vscode', wikiOutput, 'Another editor window is generating this Wiki …')
   */
  const refuseWikiGenerate = (
    host: WikiUpdateHost,
    wikiOutput: WikiUpdateOutput,
    reason: string,
    override?: () => void,
  ): void => {
    try {
      output?.info(
        wikiRunRecord(
          {
            state: 'failed',
            runKind: 'generate',
            host,
            finishedAt: new Date().toISOString(),
            reason,
            isCodebookSentence: true,
            site: 'kept',
            ...wikiOutput,
          },
          { runKind: 'generate' },
        ),
      )
    } catch {
      // A disposed channel has nowhere to write; the notice still tells the refusal.
    }
    void showNotice(
      'error',
      `Codebook did not start the LLM Wiki generation: ${reason}`,
      ...(override ? [GENERATE_ANYWAY_ACTION] : []),
    ).then(
      (choice) => {
        if (choice === GENERATE_ANYWAY_ACTION) override?.()
      },
      () => undefined,
    )
  }
  /** Starts the generation again when the learner presses "Generate anyway", with only the leftovers the refusals named passed, after the refused attempt has settled; another start or run of this window at the press meets it as any press does, never queued behind it. A start that throws is told and recorded as a refusal ({@link refuseThrownWikiGenerate}). @param leftovers - The leftovers of the earlier presses and of this refusal. @param refusedAttempt - The start whose refusal showed the button. @example startWikiGenerateAnyway([{ kind: 'last-run', endedAtMs: 1_790_000_000_000 }], refusedAttempt) */
  const startWikiGenerateAnyway = (
    leftovers: WikiLeftover[],
    refusedAttempt?: Promise<void>,
  ): void => {
    Promise.resolve(attemptToAwaitBeforeOverride(refusedAttempt))
      .catch(() => undefined)
      .then(() => generateDeepWiki(leftovers))
      .catch(refuseThrownWikiGenerate)
  }
  /**
   * Tells and records a generation's start that threw (a link on the folder's path, an unwritable folder, the Cursor skill's conflict, a read that failed) as a refusal ({@link refuseWikiGenerate}); called by Codebook: Generate LLM Wiki and by Generate anyway, so both say it in one sentence and both leave the Output record.
   * @param error - What the start threw.
   * @example await refuseThrownWikiGenerate(new Error('EACCES: permission denied'))
   */
  const refuseThrownWikiGenerate = async (error: unknown): Promise<void> => {
    const fallbackHost: WikiUpdateHost = isCursorHost ? 'cursor' : 'vscode'
    const { host, wikiOutput } = await wikiRunPlace().catch(() => ({
      host: fallbackHost,
      wikiOutput: { outputDirectory: '', outputLabel: '' },
    }))
    refuseWikiGenerate(host, wikiOutput, thrownMessage(error))
  }
  /**
   * Names the start an override waits for before it starts its own: the refused one while it still unwinds; none when another start or run of this window holds the attempt, so the override meets that one as any press does ({@link runWikiAttempt}) instead of waiting up to its bound and then starting out of nowhere (/ship review pass 3, Cycle 0055 pt1).
   * @param refusedAttempt - The start whose refusal or offer showed the button.
   * @returns The attempt to await first, or `undefined`.
   * @example attemptToAwaitBeforeOverride(refusedAttempt) // => refusedAttempt while it unwinds
   */
  const attemptToAwaitBeforeOverride = (
    refusedAttempt: Promise<void> | undefined,
  ): Promise<void> | undefined =>
    wikiUpdate === refusedAttempt ? refusedAttempt : undefined
  /** Asks the learner to confirm a generation (Cycle 0055, D2) with the folder, the runner and the bound ({@link describeWikiGenerateConfirmation}). @returns `generate`, `change-location`, or `undefined` for a dismissal. @example await confirmWikiGenerate('/repo', wikiOutput) // => 'generate' */
  const confirmWikiGenerate = async (
    projectRoot: string,
    wikiOutput: WikiUpdateOutput,
  ): Promise<'generate' | 'change-location' | undefined> => {
    const confirmation = describeWikiGenerateConfirmation({
      host: isCursorHost ? 'cursor' : 'vscode',
      projectName: basename(projectRoot),
      outputDirectory: wikiOutput.outputDirectory,
      chatHandOver: isCursorHost
        ? ''
        : describeWikiChatHandOver(
            await vscode.commands.getCommands(true),
            'generate',
          ),
      timeoutMs: WIKI_GENERATE_TIMEOUT_MS,
    })
    const choice = await vscode.window.showWarningMessage(
      confirmation.title,
      { modal: true, detail: confirmation.detail },
      GENERATE_CONFIRM_ACTION,
      CHANGE_WIKI_LOCATION_ACTION,
    )
    if (choice === GENERATE_CONFIRM_ACTION) return 'generate'
    return choice === CHANGE_WIKI_LOCATION_ACTION
      ? 'change-location'
      : undefined
  }
  /** Readies the managed Cursor skill the generate request names, without starting the runtime MCP connection (Cycle 0055, Eng decision 73): an installed current skill is kept; a missing or outdated one is deployed alone ({@link deployCursorSkill}), which keeps a learner's own or edited same-name skill and throws its conflict. @throws The deployment's refusal. @example await prepareCursorWikiSkill() */
  const prepareCursorWikiSkill = async (): Promise<void> => {
    try {
      await verifyManagedCursorSkill(
        context.extensionPath,
        context.globalStorageUri.fsPath,
      )
    } catch {
      // A missing or outdated skill is deployed; another skill in the way refuses the start with the deployment's own sentence.
      await deployCursorSkill(
        context.extensionPath,
        context.globalStorageUri.fsPath,
      )
    }
  }
  /**
   * Readies the managed Cursor skill for an update whose start checks passed and whose marker is claimed ({@link prepareCursorWikiSkill}); called by {@link updateDeepWiki} in Cursor right before the agent's launch.
   * Why: a press that starts no agent (no Wiki, a current Wiki, another window's run) writes no skill, and a skill in the learner's way never hides what the checks found.
   * @param start - The passed start, whose marker is released when the skill cannot be readied.
   * @param host - The editor host that was asked.
   * @param wikiOutput - The Wiki folder and its label, which the refused start records.
   * @throws The deployment's refusal, after the marker was released and the refused start recorded.
   * @example await prepareCursorSkillForUpdate(start, 'cursor', wikiOutput)
   */
  const prepareCursorSkillForUpdate = async (
    start: WikiUpdateStart,
    host: WikiUpdateHost,
    wikiOutput: WikiUpdateOutput,
  ): Promise<void> => {
    try {
      await prepareCursorWikiSkill()
    } catch (error) {
      // A skill in the learner's way refuses the update, frees the marker the checks claimed, and leaves the refused start's Output record.
      await start.releaseMarker().catch(() => undefined)
      wikiUpdateRun.refuseStart(host, wikiOutput, {
        kind: 'failed',
        reason: thrownMessage(error),
      })
      writeWikiRunRecord({ runKind: 'update' })
      throw error
    }
  }
  /** Says whether the opened folder is inside a Git repository, by the freshness check's own Git look with no sources ({@link inspectDeepWikiFreshness}); the generate request names only the conditions that can hold in it. @example await isInGitRepository('/repo', '/repo/.codebook/wiki') // => true */
  const isInGitRepository = async (
    projectRoot: string,
    outputDirectory: string,
  ): Promise<boolean | undefined> => {
    const look = await inspectDeepWikiFreshness(
      projectRoot,
      [],
      undefined,
      [],
      { outputDirectory },
    )
    // Git that is missing or did not answer leaves the question open: the request then asks for a revision only where Git answers (/ship review, Cycle 0055 pt1).
    if (look.status === 'unknown') return undefined
    return !look.addedFilesUnchecked
  }
  /**
   * Starts a first LLM Wiki generation from Codebook's entry (Codebook: Generate LLM Wiki), coalescing repeated presses: the start's checks, the confirmation, the folder, the agent and the marker ({@link startWikiGenerate}), then the run of kind `generate` ({@link launchWikiRun}) with the generate request ({@link buildWikiGeneratePrompt}).
   * @param acknowledgedLeftovers - Given when the learner pressed "Generate anyway": the leftovers named by the refusals it was pressed on, which alone are ignored.
   * @throws What a start threw (a link on the folder's path, an unwritable parent folder, the Cursor skill's conflict); no marker is left.
   * @example await generateDeepWiki()
   */
  const generateDeepWiki = (
    acknowledgedLeftovers: readonly WikiLeftover[] = [],
  ): Promise<void> =>
    runWikiAttempt(async () => {
      const { projectRoot, wikiOutput, host } = await wikiRunPlace()
      const { outputDirectory } = wikiOutput
      const start = await startWikiGenerate({
        wikiOutput,
        assertPathHeld: () =>
          assertNoLinkOnWikiPath(outputDirectory, projectRoot),
        readPublishToken: () => readWikiPublishToken(outputDirectory),
        findStartBlock: () =>
          findWikiUpdateStartBlock(outputDirectory, projectRoot),
        findRunInTheWay: () =>
          findWikiRunInTheWay(
            outputDirectory,
            acknowledgedLeftovers,
            'generate',
            startWikiGenerateAnyway,
          ),
        confirm: () => confirmWikiGenerate(projectRoot, wikiOutput),
        openLocationSetting: async () =>
          vscode.commands.executeCommand(
            'workbench.action.openSettings',
            '@id:codebook.wikiOutputDirectory',
          ),
        // The marker lies beside the output folder, in a folder a fresh project lacks; the output folder itself is the publisher's to make.
        makeOutputParent: async () => {
          await mkdir(dirname(outputDirectory), { recursive: true })
        },
        prepareAgent: () =>
          isCursorHost ? prepareCursorWikiSkill() : Promise.resolve(),
        claimMarker: (startedAtMs) =>
          claimWikiRunMarker(outputDirectory, host, 'generate', startedAtMs),
        describeHolder: (holder) => describeOtherWikiWindow(holder, 'generate'),
        readPublicationIdentity: () =>
          readWikiPublicationIdentity(outputDirectory),
        hasGitRepository: () => isInGitRepository(projectRoot, outputDirectory),
        // A link or a file there was refused by the path check; only a folder of its own without a manifest counts, and one that holds a Wiki gets the update's offer.
        hasOutputFolderWithoutWiki: async () =>
          (await lstat(outputDirectory).then(
            (stat) => stat.isDirectory(),
            () => false,
          )) &&
          (await readWikiPublishToken(outputDirectory).catch(
            () => 'unreadable',
          )) === undefined,
        offerUpdate: () => {
          // The generation that offers the update, which the update waits for, and only for it.
          const offeringAttempt = wikiUpdate
          void showNotice(
            'information',
            describeExistingWiki(wikiOutput.outputLabel),
            UPDATE_WIKI_ACTION,
          ).then(
            (choice) => {
              if (choice === UPDATE_WIKI_ACTION)
                startWikiUpdateAnyway([], offeringAttempt)
            },
            () => undefined,
          )
        },
        refuse: (reason, override) =>
          refuseWikiGenerate(host, wikiOutput, reason, override),
        now: Date.now,
      })
      if (!start) return
      // A window that began to close while the learner confirmed starts no run its shutdown no longer finds.
      if (isExtensionStopping) {
        await start.releaseMarker().catch(() => undefined)
        return
      }
      const run = newWikiRun('generate', projectRoot, wikiOutput, host, {
        ...start,
        tokenAtStart: undefined,
        uncoveredAtStart: [],
      })
      await launchWikiRun(run, () =>
        buildWikiGeneratePrompt({
          outputDirectory,
          timeoutMs: run.timeoutMs,
          // Nothing shows the Cursor CLI's reply to the learner, so its report is not asked for.
          isReplyRead: !isCursorHost,
          hasGitRepository: start.hasGitRepository,
        }),
      )
    })
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
  /** Stops this window's run, or tells the learner why there is nothing to stop; called by Stop LLM Wiki Run and by the LLM Wiki view's Stop watching and Cancel. @example cancelWikiRun() */
  const cancelWikiRun = (): void => {
    if (activeWikiRun) {
      activeWikiRun.controller.abort()
      return
    }
    // A run that is still starting has nothing to stop yet; the learner is told so instead of "nothing is running".
    if (wikiUpdate) {
      void showNotice('information', WIKI_RUN_STARTING_SENTENCE)
      return
    }
    void showNotice(
      'information',
      'No LLM Wiki generation or update is running in this window.',
    )
  }
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
      OPEN_DEEP_WIKI_COMMAND,
      joinInFlight(async () => {
        try {
          // A folder without a Wiki offers its generation instead of an error about a missing manifest (Cycle 0055, proposed change 3).
          const missingWiki = await findMissingWiki()
          if (missingWiki) {
            await showMissingWikiNotice(missingWiki, wikiUpdate !== undefined)
            return
          }
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
    registerCommand(UPDATE_DEEP_WIKI_COMMAND, async () => {
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
    registerCommand(GENERATE_DEEP_WIKI_COMMAND, async () => {
      try {
        await generateDeepWiki()
      } catch (error) {
        // A start that threw (a link on the folder's path, an unwritable folder, the Cursor skill's conflict) is told like a refusal, with its record.
        await refuseThrownWikiGenerate(error)
        throw error
      }
    }),
    // Stops this window's run, generation or update: a VS Code watch, also while it still waits for the chat's first sign, or the Cursor agent. The chat itself is not stopped.
    registerCommand(CANCEL_WIKI_RUN_COMMAND, cancelWikiRun),
    registerCommand(SHOW_WIKI_OUTPUT_COMMAND, () => {
      diagnostics.show()
    }),
    registerCommand(SAVE_LEARNING_REPLAY_COMMAND, async (studyId?: string) => {
      try {
        await workspace().saveLearningReplay(studyId)
      } catch (error) {
        // The learner reads the notice: a storage failure names the folder, which it shows as <storage> (F264).
        void showNotice(
          'error',
          `Codebook could not save learning: ${workspace().describeFailure(error)}`,
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
    registerCommand(OPEN_LEARNING_REPLAY_COMMAND, (studyId: string) =>
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
  // The LLM Wiki view: rows from the Wiki folder, the run state and the markers; an editor without tree views shows none.
  if (Reflect.has(vscode.window ?? {}, 'createTreeView')) {
    const llmWikiView = createLlmWikiView({
      editor: vscode,
      host: isCursorHost ? 'cursor' : 'vscode',
      debounceMs: LLM_WIKI_REFRESH_DEBOUNCE_MS,
      pollMs: LLM_WIKI_POLL_MS,
      readFacts: () =>
        readLlmWikiViewFacts({
          host: isCursorHost ? 'cursor' : 'vscode',
          isFolderOpen: () =>
            Boolean(vscode.workspace.workspaceFolders?.length),
          isTrusted: () => vscode.workspace.isTrusted,
          wikiLocation,
          readPublishToken: readWikiPublishToken,
          readPublication: readWikiPublicationIdentity,
          findStartBlock: findWikiUpdateStartBlock,
          readGeneration: async (projectRoot, outputDirectory) => {
            const manifest = await readDeepWikiManifest(
              outputDirectory,
              projectRoot,
            )
            const manifestStat = await lstat(
              join(outputDirectory, WIKI_MANIFEST_FILE),
            ).catch(() => undefined)
            return {
              revision: manifest.revision,
              publishedAtMs: manifestStat?.mtimeMs,
            }
          },
          isWikiOwnedBy,
          // A window id nobody has: this window's own reservation is seen as the stopped watch's too.
          readMarker: (outputDirectory) =>
            readLiveWikiUpdateMarker(outputDirectory, LLM_WIKI_VIEW_WINDOW_ID),
          ownWindowId: wikiWindowId,
          isStartUnderWay: () => wikiUpdate !== undefined,
          hasPublishEndedWait: hasWikiPublishEndedWait,
          runStatus: () => wikiUpdateRun.status(),
          isAwaitingChat: () => activeWikiRun?.awaitsChat === true,
          lastAgentExit: () => lastWikiAgentExit,
          now: () => Date.now(),
        }),
      // The facts the rows show name the project and folder to inspect, so a setting changed meanwhile cannot make the check read another Wiki.
      readFreshness: async ({ projectRoot, outputDirectory }) => {
        const published = await inspectPublishedWiki(
          projectRoot,
          outputDirectory,
        )
        if (!published)
          return {
            status: 'unknown',
            reason: 'The manifest could not be read.',
          }
        return {
          status: published.freshness.status,
          reason: published.freshness.reason,
          isAdditionUnchecked: published.freshness.addedFilesUnchecked === true,
        }
      },
      findWatchedFolder: findNearestExistingAncestor,
      onRunChange: (listener) => wikiUpdateRun.onDidChange(listener),
      tellPublished: (outputLabel) =>
        showWikiActionNotice(
          'information',
          `An LLM Wiki was published in ${outputLabel}.`,
          [OPEN_WIKI_IN_BROWSER_ACTION],
        ),
      recordFailure: (message, cause) => {
        try {
          output?.error(`${message}: ${thrownMessage(cause)}`)
        } catch {
          // A disposed channel has nowhere to write.
        }
      },
    })
    context.subscriptions.push(
      { dispose: () => llmWikiView.dispose() },
      ...registerLlmWikiCommands({
        editor: vscode,
        register: registerCommand,
        showNotice,
        view: llmWikiView,
        cancelRun: cancelWikiRun,
        findOutputDirectory: async () => (await wikiLocation()).outputDirectory,
      }),
    )
  }
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

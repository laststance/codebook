import * as vscode from 'vscode'

import type { ExtensionHistoryTypes } from '../chromeExtensionHistoryTypes'
import {
  CHROME_EXTENSION_PROFILE,
  NODE_SCRIPT_PROFILE,
  NODE_SERVER_PROFILE,
  NODE_TEST_PROFILE,
  MILLISECONDS_PER_SECOND,
  OPEN_REPLAY_RESULT_WAIT_MS,
  RECORDED_APPLICATION_PANE_TITLE,
  REPLAY_VIEWPORT_RECEIPT_LIMIT,
  REPOSITORY_BROWSER_PROFILE,
  FOREIGN_PREVIEW_ACTION,
} from '../constants'
import { UnreportedEditorFocusError } from '../errors'
import { ExtensionReplayFrameCache } from '../extensionReplayFrameCache'
import type { HistoryIndexOf, HistoryTypes } from '../historyStorageDescriptor'
import type { NodeScriptHistoryTypes } from '../nodeScriptHistoryTypes'
import type { NodeServerHistoryTypes } from '../nodeServerHistoryTypes'
import {
  type NodeTestHistoryIndex,
  type NodeTestHistoryLearningDecision,
} from '../nodeTestHistorySchemas'
import type { NodeHistoryStore } from '../nodeTestHistoryStore'
import { type PlaybackBundle, type PlaybackData } from '../playbackController'
import { type ReplayInspection } from '../replayDebugger'
import { retainedStudySelectionSchema } from '../retainedStudySchemas'
import { BrowserViewport } from '../runtimeSupport/browserViewport'
import {
  CAPTURE_TIMEOUT_MS,
  VIEWPORT_ACK_TIMEOUT_REASON,
} from '../runtimeSupport/constants'
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { ViewportAckTimeoutError } from '../runtimeSupport/utils/viewportAckTimeoutError'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { studyIdSchema } from '../studyModel'
import {
  adaptExtensionReplay,
  type ExtensionReplayPresentation,
} from '../utils/adaptExtensionReplay'
import type { ServerReplayPresentation } from '../utils/adaptServerReplay'
import {
  openingExtensionEvent,
  restoreExtensionPlayhead,
} from '../utils/buildExtensionReplayModel'
import {
  openingServerEvent,
  restoreServerPlayhead,
} from '../utils/buildServerReplayModel'
import { NODE_EXTENSION_REPLAY_TEXT } from '../utils/describeExtensionReplay'
import {
  describeNodeLearningSave,
  NODE_LEARNING_SAVE_ACTION,
} from '../utils/describeNodeLearningSave'
import {
  describeScriptSummaryFailure,
  NODE_SCRIPT_REPLAY_TEXT,
} from '../utils/describeNodeScriptReplay'
import {
  describeServerSummaryFailure,
  NODE_SERVER_REPLAY_TEXT,
} from '../utils/describeNodeServerReplay'
import {
  describeViewportDelivery,
  type ViewportDeliveryLog,
} from '../utils/describeViewportDelivery'
import { firstVerifiedStopSequence } from '../utils/firstVerifiedStopSequence'
import { focusEditorGroupCommand } from '../utils/focusEditorGroupCommand'
import { parseForeignPreviewObstacle } from '../utils/foreignPreviewObstacle'
import { NodeHistoryPlaybackController } from '../utils/nodeHistoryPlaybackController'
import {
  presentScriptHistory,
  presentServerHistory,
} from '../utils/presentServerHistory'
import { type NodeLearningMaterialOfHistory } from '../utils/projectNodeLearningSummary'
import { sanitizeCause } from '../utils/sanitizeCause'
import { sanitizedStack } from '../utils/sanitizedStack'
import { selectStudy } from '../utils/selectStudy'
import { showPlainNotice } from '../utils/showPlainNotice'
import { untilAborted } from '../utils/untilAborted'
import { withoutErrorName } from '../utils/withoutErrorName'

import type { ReplayOpeningHost } from './replayOpeningHost'
import { type NodeHistoryOpening, recordedFrameLabel } from './support'

/**
 * Opens recordings, learning replays and node histories and loads and presents their playback, so the replay opening path is read apart from the rest of {@link StudyWorkspace}.
 *
 * The workspace builds one in a field initialiser with a host from {@link createReplayOpeningHost}; every member other code calls stays on the workspace as a one-line delegate with the same name and signature.
 *
 * @example
 * private readonly replayOpening = new ReplayOpening(createReplayOpeningHost(this))
 */
export class ReplayOpening {
  constructor(private readonly host: ReplayOpeningHost) {}

  private replayDelivery: ViewportDeliveryLog = { receipts: [], omitted: 0 }

  /** How many test replay entries ({@link openNodeHistoryFromHost}) are under way, the waiting ones included; the last superseded entry to end leaves the empty summary composition an earlier one built only when none is under way to fill it (Cycle 0052 task 12). */
  private nodeHistoryEntriesUnderWay = 0

  /** Settles when the test replay entry in front has entered its composition: entries take turns there, so two entries never run {@link open} at once (one would be refused as busy and leave no replay shown). */
  private nodeHistoryEntryTurn: Promise<void> = Promise.resolve()

  /** How many test replay entries ({@link openNodeHistoryFromHost}) have not ended yet, from the turn they wait for to their open's end; the held-back replay is released when the last one ends. */
  private nodeHistoryEntriesInProgress = 0

  /** The recording open an agent asked for through codebook_playback ({@link markAgentRecordingOpen}), by its study and the playback revision its load runs at; {@link loadPlayback} takes it for that load only (row 613). */
  private agentRecordingOpen?: { studyId: string; revision: number }

  /**
   * Loads the shown browser replay's recording again (a same-study Reload): the Summary keeps its document, so a failed read can publish its recovery there, and the Reload's mark keeps the replay shown until the recording is active again ({@link loadPlayback}) or a departure supersedes it; a failed load keeps it. Called by the Reload action and by Retry while a Reload's recording has not loaded (Cycle 0052 tasks 18 and 31).
   * @returns Once the recording's open is accepted; the load itself continues in the playback controller.
   * @throws When no browser replay is shown, or it names no study; {@link openRecording}'s refusals of a pending presentation change and of a study on its way to the Trash, before anything changes.
   * @example await this.reloadShownRecording()
   */
  async reloadShownRecording(): Promise<void> {
    // A Reload whose recording has not loaded (still loading, or failed) retries the recording the replay last asked for.
    const studyId = this.host.recordingActive
      ? this.host.selection.studyId
      : (this.host.playback?.state().studyId ?? this.host.selection.studyId)
    if (!this.host.browserReplayShown() || !studyId)
      throw new Error('Select a recording first.')
    // What openRecording would refuse is refused before the replay is left, so a refused Reload changes nothing: a presentation change that began while Retry read the storage keeps the replay and its failure as they were (Cycle 0052 task 39). After these checks openRecording only awaits the reader's finished initialization.
    this.host.assertPresentationIdle()
    this.host.assertStudyNotMoving(studyId)
    // The controller keeps a pending load of the same study and would start none: a Reload whose recording has not loaded cancels that load first, so the recording loads again (Cycle 0052 task 35).
    if (!this.host.recordingActive) this.host.playback?.leave()
    this.host.leavePlayback(true)
    this.host.recordingReloadStudyId = studyId
    await this.host.openRecording(studyId)
  }

  /** Opens a validated local recording through the same revisioned controller used by MCP; no application operation is dispatched. @example await workspace.openRecording(studyId) */
  async openRecording(
    studyId: string,
    signal?: AbortSignal,
    origin: 'study' | 'repository' = 'study',
  ): Promise<void> {
    this.host.assertPresentationIdle()
    signal?.throwIfAborted()
    const lifetime = this.host.lifetime
    await this.host.initialize()
    this.host.assertLifetime(lifetime)
    signal?.throwIfAborted()
    const id = studyIdSchema.parse(studyId)
    // The recording of a study on its way to the Trash moves first; it cannot be opened any more.
    this.host.assertStudyNotMoving(id)
    // Once admitted, browser replay takes over the shared historical debugger; a Node stop still loading its values no longer owns it.
    this.host.selectedNodeHistoryRequest++
    // The cut-off selection no longer clears its requested moment (its token is gone), so the bump gives it back.
    this.host.requestedNodeHistorySequence = undefined
    this.host.nodeHistoryLeftFor = undefined
    this.host.nodeHistoryPlaybackController?.abandon()
    // The Node stop no longer owns Run and Debug: its hint goes, and Inspect restarts the debugger for it.
    this.host.selectedNodeHistoryValuesUninspected = false
    this.host.selectedNodeHistoryDebugAvailable = false
    // A closed reader has no native panes; reload its saved position instead of accepting a loaded-controller no-op.
    if (!this.host.opened) this.host.playback!.leave()
    const revision = this.host.playback!.state().revision
    // Bind chrome preservation to this exact open, including a load queued behind cancelled playback work.
    this.host.repositoryRecordingOpen =
      origin === 'repository'
        ? { studyId: id, revision: revision + 1 }
        : undefined
    this.host.playback!.command({
      studyId: id,
      action: 'open',
      expectedRevision: revision,
    })
    // The open was accepted, so an earlier refused replay control no longer describes the replay.
    if (this.host.errors.delete('replay-control')) this.host.publish()
  }

  /**
   * Opens a saved recording for the status bar's Open replay entry and tells the learner when its load failed; the command `codebook.openLearningReplay` calls it.
   *
   * {@link openRecording} returns once the load is admitted, and a load that fails later leaves its reason only in the playback state,
   * which no pane shows while the reader could not open (another window keeps the desktop focus). So this waits, bounded by
   * {@link OPEN_REPLAY_RESULT_WAIT_MS}, for the load to end and shows a failed load's reason as an editor notification, which the
   * editor keeps on screen until its window has the focus again.
   *
   * A study id that names a test replay (a sealed test history, or a test run of this window) takes the other branch: the Study pane opens when it is closed and {@link openNodeHistoryFromHost} opens the replay, with its own refusal during a browser replay and its own failure notification; the bounded wait above belongs to the browser path only.
   *
   * @param studyId - The saved study whose recording the entry names, or a test replay's study id.
   * @returns Once the recording is presented and its study's selection written to the ledger, its load failed and the notification was shown, another recording took its place, or the bound passed (a ledger write still pending then goes on in the background); for a test replay, once it is shown, the learner declined to close a browser replay, or its failure was told.
   * @throws Whatever {@link openRecording} throws before the load is admitted.
   * @example await workspace.openLearningReplay(studyId)
   */
  async openLearningReplay(studyId: string): Promise<void> {
    // A test replay opens in its summary composition through its own entry, not through the browser replay's controller (Cycle 0051, DS-A).
    if (this.isTestReplayStudy(studyId))
      return this.host.openNodeHistoryFromHost(studyId)
    await this.host.openRecording(studyId)
    const playback = this.host.playback!
    const resultWaitEndsAtMs = performance.now() + OPEN_REPLAY_RESULT_WAIT_MS
    // A load that outlasts the bound is still running and has nothing to report yet.
    await playback
      .settle(undefined, OPEN_REPLAY_RESULT_WAIT_MS)
      .catch(() => undefined)
    // A bounded settle leaves the saves out; the selection write that the shown recording started is awaited here, so the command ends with the ledger naming it. It can wait behind this window's queued library writes and another window's storage lock, so it gets only what is left of the same bound, and a failed load's notice never waits longer.
    await awaitResponse(
      this.host.shownRecordingSelectionSaved,
      'the ledger write of the shown recording',
      undefined,
      resultWaitEndsAtMs - performance.now(),
    ).catch(() => undefined)
    const state = playback.state()
    if (
      state.studyId !== studyId ||
      state.readiness !== 'failed' ||
      !state.reason
    )
      return
    // A learner's preview tab that blocks the open is answered with a choice and a retry, not a toast (F158).
    const answer = await this.resolveForeignPreviewRefusal(state.reason)
    if (answer === 'retry') return this.host.openLearningReplay(studyId)
    // The failure also goes to Output › Codebook, as a test replay's failed open does, so the learner can copy it into a report (Cycle 0052 task 59), also after the keep-open refusal told it (task 81).
    this.host.diagnostics?.log({
      surface: 'open:recording',
      studyId,
      profile: REPOSITORY_BROWSER_PROFILE,
      cause: sanitizeCause(state.reason, this.host.privateRoots()),
    })
    // The keep-open refusal has told the learner already; a second notice would repeat it.
    if (answer === 'told') return
    // The controller keeps a failure as its string form, which starts with the error's name.
    void showPlainNotice(
      vscode.window,
      'error',
      `Codebook could not open the learning replay: ${withoutErrorName(state.reason)}`,
    )
  }

  /**
   * Answers an Open replay that a learner's preview tab refused with a modal warning that names the file, in both hosts (a toast is cut to one line in Cursor), and carries out the learner's choice; called by {@link openLearningReplay} and {@link openNodeHistoryFromHost} before they tell a failure (F158, D33).
   * Keep Tab Open pins the tab (it stops being a preview) and Close Tab closes it; each is followed by a retry of the open.
   * @param cause - The failure's words; only a {@link foreignPreviewObstacle} sentence in it is answered here.
   * @returns `retry` when the learner chose a way out and the open is to be retried; `told` when Keep Tab Open could not keep a non-text tab and has shown its own notice, so the caller adds none (F394); `unhandled` when the cause is another failure or the dialog was dismissed.
   * @example if ((await this.resolveForeignPreviewRefusal(cause)) === 'retry') return this.openLearningReplay(studyId)
   */
  private async resolveForeignPreviewRefusal(
    cause: string,
  ): Promise<'retry' | 'told' | 'unhandled'> {
    const obstacle = parseForeignPreviewObstacle(cause)
    if (!obstacle) return 'unhandled'
    const choice = await vscode.window.showWarningMessage(
      `Codebook cannot open the replay: "${obstacle.tabName}" is open as a preview tab in editor group ${obstacle.viewColumn}.`,
      {
        modal: true,
        detail: `The replay needs that group, and a preview tab would be replaced. Keep Tab Open keeps "${obstacle.tabName}" as a normal tab; Close Tab closes it. The replay opens again after either.`,
      },
      FOREIGN_PREVIEW_ACTION.keepOpen,
      FOREIGN_PREVIEW_ACTION.close,
    )
    if (!choice) return 'unhandled'
    const group = vscode.window.tabGroups.all.find(
      (candidate) =>
        candidate.viewColumn === obstacle.viewColumn &&
        candidate.tabs.some((tab) =>
          this.isNamedPreview(tab, obstacle.tabName),
        ),
    )
    const tab = group?.tabs.find((candidate) =>
      this.isNamedPreview(candidate, obstacle.tabName),
    )
    // The tab may be gone by now; the retry then decides.
    if (!group || !tab) return 'retry'
    // Only Close Tab closes the learner's tab; Keep Tab Open never does (F363).
    if (choice === FOREIGN_PREVIEW_ACTION.close) {
      await vscode.window.tabGroups.close([tab])
      return 'retry'
    }
    if (tab.input instanceof vscode.TabInputText) {
      await this.host.showTextDocumentNoted(tab.input.uri, {
        viewColumn: obstacle.viewColumn,
        preview: false,
        preserveFocus: true,
      })
      return 'retry'
    }
    return this.keepNonTextPreview(group, tab, obstacle.tabName)
  }

  /**
   * Tells whether a tab is the preview tab that a foreign-preview refusal names; used by {@link resolveForeignPreviewRefusal} to find the tab again after the dialog.
   * @param tab - A tab of the refused group.
   * @param tabName - The name the refusal gave ({@link editorTabName}).
   * @returns `true` for a preview tab of that name.
   * @example this.isNamedPreview(tab, 'login-form.tsx') // => true
   */
  private isNamedPreview(tab: vscode.Tab, tabName: string): boolean {
    return tab.isPreview && this.host.editorTabName(tab) === tabName
  }

  /**
   * Keeps a learner's non-text preview tab (an image, a custom editor) open with the editor's own Keep Open command, which acts on the active tab of the focused group; called by {@link resolveForeignPreviewRefusal} for Keep Tab Open.
   * The extension API cannot pin such a tab, so its group takes the focus and the command runs only when the tab is that group's front tab. Otherwise the tab stays a preview, the open is not retried and the learner is told how to keep it.
   * @param group - The tab's group.
   * @param tab - The preview tab.
   * @param tabName - The tab's name, for the notice.
   * @returns `retry` when the tab is no longer a preview and the open is to be retried; `told` when it is still one and the learner has been told how to keep it.
   * @example if ((await this.keepNonTextPreview(group, tab, 'diagram.png')) === 'retry') retry()
   */
  private async keepNonTextPreview(
    group: vscode.TabGroup,
    tab: vscode.Tab,
    tabName: string,
  ): Promise<'retry' | 'told'> {
    const focusCommand = focusEditorGroupCommand(group.viewColumn)
    if (focusCommand && group.activeTab === tab) {
      await this.host.executeEditorCommand(focusCommand)
      // The command keeps the tab that is in front of the group the focus moved to; the tab is re-read after it.
      const focused = vscode.window.tabGroups.activeTabGroup
      if (focused.viewColumn === group.viewColumn && focused.activeTab === tab)
        await this.host.executeEditorCommand('workbench.action.keepEditor')
    }
    const stillPreview = vscode.window.tabGroups.all
      .filter((candidate) => candidate.viewColumn === group.viewColumn)
      .flatMap((candidate) => candidate.tabs)
      .some((candidate) => this.isNamedPreview(candidate, tabName))
    if (!stillPreview) return 'retry'
    void showPlainNotice(
      vscode.window,
      'warning',
      `Codebook could not keep "${tabName}" open. Double-click its tab to keep it, then choose Open replay again.`,
    )
    return 'told'
  }

  /**
   * Says whether a study id names a test replay: a test history the last refresh listed, or a node-test run of this window's service; read by {@link openLearningReplay}.
   * @param studyId - The study id the status item or a command names.
   * @returns `true` for a test replay.
   * @example this.isTestReplayStudy(studyId) // => true for a sealed test history
   */
  private isTestReplayStudy(studyId: string): boolean {
    return (
      this.host.nodeHistoryCatalog.some(
        (history) => history.studyId === studyId,
      ) ||
      this.host.nodeServerHistoryCatalog.some(
        (history) => history.studyId === studyId,
      ) ||
      this.host.nodeScriptHistoryCatalog.some(
        (history) => history.studyId === studyId,
      ) ||
      this.host.nodeExtensionHistoryCatalog.some(
        (history) => history.studyId === studyId,
      ) ||
      // A node-server or extension run just saved is a replay before the catalog lists it, never an ordinary recording.
      [
        NODE_TEST_PROFILE,
        NODE_SERVER_PROFILE,
        NODE_SCRIPT_PROFILE,
        CHROME_EXTENSION_PROFILE,
      ].some((profile) => this.host.recordOfStudy(studyId)?.profile === profile)
    )
  }

  /**
   * Opens a test replay for the learner's two entries, the status item's Open replay (and Open retained history) and a Saved studies choice: the summary composition is entered first (Cycle 0051, DS-A), then the shared open runs ({@link openNodeHistory}); called by {@link openLearningReplay} and by the reader's `node-history` message.
   * During a browser replay the learner is told that one replay shows at a time and may close it first (DS10). A failed open raises the load-failure notification with Show details and writes one Output › Codebook entry; a reader the open left in the summary composition with no replay shown goes back to the Study composition, so the Study pane stands open on Saved studies (X4, DS-G).
   * @param studyId - The test replay's study id.
   * @param revision - The reader revision a Saved studies choice belongs to, which a newer revision supersedes; omitted for the status item, whose open takes the revision current after the summary composition was entered (and a browser replay closed).
   * @returns Once the replay is shown, the learner declined to close a browser replay, or the failure was told.
   * @example await workspace.openNodeHistoryFromHost(studyId)
   */
  async openNodeHistoryFromHost(
    studyId: string,
    revision?: number,
  ): Promise<void> {
    const entry = this.host.supersedeNodeHistoryEntries(),
      overtaken = this.host.nodeHistoryEntryCancellation.signal
    this.nodeHistoryEntriesInProgress++
    // A control refused while this open is under way is newer than the open and keeps its line.
    const refusalsBefore = this.host.controlRefusals
    try {
      // Entries take turns entering the composition; a newer entry made meanwhile is the learner's latest choice (EN19).
      const previousTurn = this.nodeHistoryEntryTurn
      let releaseTurn!: () => void
      this.nodeHistoryEntryTurn = new Promise<void>((resolve) => {
        releaseTurn = resolve
      })
      this.nodeHistoryEntriesUnderWay++
      let entered = false
      try {
        await previousTurn
        entered = await this.enterCompositionForEntry(studyId, entry, overtaken)
      } finally {
        this.nodeHistoryEntriesUnderWay--
        releaseTurn()
      }
      if (!entered) {
        // The last superseded entry to end leaves the summary composition an earlier one built, when no entry is under way to fill it: a Return or a Close superseded them all (Cycle 0052 task 12).
        if (
          entry !== this.host.nodeHistoryEntryRequest &&
          this.nodeHistoryEntriesUnderWay === 0
        )
          await this.host.leaveEmptySummaryComposition()
        return
      }
      if (entry !== this.host.nodeHistoryEntryRequest) return
      const outcome = await this.host.openNodeHistory(
        studyId,
        revision ?? this.host.revision,
      )
      if (outcome.status === 'superseded') {
        // A superseded open leaves the summary composition it entered when no newer replay stands in it, as a failed open does (Cycle 0052 task 13); an entry still under way fills or leaves that composition itself (task 35).
        if (this.nodeHistoryEntriesUnderWay === 0)
          await this.host.leaveEmptySummaryComposition()
        return
      }
      if (outcome.status !== 'failed') {
        // A replay that opened is a handled choice: the refusal an earlier open of a test or server replay left as a control line (the retry inside the failed entry is refused too) is stale beside it.
        if (
          this.host.controlRefusals === refusalsBefore &&
          this.host.dropChoiceRetiredErrors()
        )
          this.host.publish()
        // The learner's own replay open, after the replay is shown: the summary moves beside the chat once per profile (F209).
        await this.host.moveSummaryBesideChatOnce()
        return
      }
      if (
        (await this.answerFailedTestReplayOpen(studyId, outcome.error)) ===
        'retry'
      )
        return this.host.openNodeHistoryFromHost(studyId)
    } finally {
      // The closed reader's replay held back for the entries is drawn again, by the next Open Study Workspace if no entry replaced it; a newer entry still in progress keeps the hold, so the views never draw the retained replay while it loads (Cycle 0056 task 32).
      this.nodeHistoryEntriesInProgress--
      if (this.nodeHistoryEntriesInProgress === 0 && this.host.heldBackReplay) {
        // Republish only when the held selection is still the selected replay; an entry that adopted a history posted it already.
        const isStillHeld = this.host.isHeldBackSelection()
        this.host.heldBackReplay = undefined
        if (
          isStillHeld &&
          this.host.opened &&
          !this.host.closing &&
          !this.host.disposed
        ) {
          this.host.lastPublished = undefined
          // A failing publish is reported and never replaces the entry's own result.
          try {
            this.host.publish()
          } catch (error) {
            this.host.report('control', error)
          }
        }
      }
    }
  }

  /**
   * Brings a test replay entry into the summary composition in its turn: a browser replay is closed first when the learner agrees, and a refused entry is told like a failed open (F382, F384); called by {@link openNodeHistoryFromHost} while the entry holds its turn.
   * @param studyId - The test replay's study id.
   * @param entry - The entry's ticket ({@link nodeHistoryEntryRequest}).
   * @param overtaken - Aborts when a newer entry, a Return or a Close supersedes the ticket ({@link nodeHistoryEntryCancellation}).
   * @returns `true` when the entry stands in the composition and is still the latest; `false` when a newer entry took over, the browser replay stays open, or the failure was told.
   * @example if (!(await this.enterCompositionForEntry(studyId, entry, overtaken))) return
   */
  private async enterCompositionForEntry(
    studyId: string,
    entry: number,
    overtaken: AbortSignal,
  ): Promise<boolean> {
    if (entry !== this.host.nodeHistoryEntryRequest) return false
    // The learner's test replay supersedes a saved study that waits for the hidden editor area: the slot tabs that waited with it close now, before its own slot shows, so its tab is never closed as an earlier one's and a failed open leaves none behind (Cycle 0052 task 15).
    this.host.studyAwaitingEditorArea = undefined
    await this.host.closeSlotTabsAwaitingArea()
    // A Close, a Return or a newer entry during the slot close owns the reader now: this entry asks nothing more (Cycle 0052 task 35).
    if (entry !== this.host.nodeHistoryEntryRequest) return false
    if (!(await this.closeBrowserReplayForTestReplay(entry, overtaken)))
      return false
    if (entry !== this.host.nodeHistoryEntryRequest) return false
    try {
      await this.host.enterSummaryCompositionForReplay(
        studyId,
        entry,
        overtaken,
      )
    } catch (error) {
      // A newer entry answers for the learner now; an entry whose focus wait its supersession aborted ends here quietly too.
      if (entry !== this.host.nodeHistoryEntryRequest) return false
      // A refused entry is told like a failed replay open: one Output › Codebook entry and the notification, never a bare command failure (F382, F384).
      // A refusal for a main editor that reported no keyboard focus is not followed by a reopen: the reopen would meet the same guard, wait five seconds again and log the same entry a second time (Cycle 0060, N60). The composition is dropped without a measurement instead.
      if (error instanceof UnreportedEditorFocusError)
        this.dropEmptySummaryCompositionUnmeasured(error)
      else await this.host.leaveEmptySummaryComposition()
      this.tellTestReplayOpenFailure(
        studyId,
        error,
        sanitizeCause(error, this.host.privateRoots()),
      )
      return false
    }
    return entry === this.host.nodeHistoryEntryRequest
  }

  /**
   * Answers a test replay entry made during a browser replay: one replay shows at a time, so the learner is told so and may close the browser replay first (DS10); called by {@link enterCompositionForEntry}.
   * The notice is not modal: the browser replay it names is closed only while it is still the one shown and the entry is still the latest, so an answer never closes a replay opened after the notice.
   * The entry stops waiting for the answer once a newer entry, a Return or a Close overtakes it, so an unanswered notice never holds the next entry's turn; the notice stays on screen, and its later answer closes nothing (Cycle 0052 task 11).
   * @param entry - The entry's ticket ({@link nodeHistoryEntryRequest}).
   * @param overtaken - Aborts when the ticket is superseded ({@link nodeHistoryEntryCancellation}).
   * @returns `true` when no browser replay is open, or the learner closed the one named; `false` when it stays open or another replay or entry took over.
   * @example if (!(await this.closeBrowserReplayForTestReplay(entry, overtaken))) return false
   */
  private async closeBrowserReplayForTestReplay(
    entry: number,
    overtaken: AbortSignal,
  ): Promise<boolean> {
    if (!this.host.browserReplayShown()) return true
    const studyId = this.host.selection.studyId,
      revision = this.host.playback?.state().revision
    const refusal = describeNodeLearningSave({ kind: 'open-refused' })
    const action = await untilAborted(
      Promise.resolve(
        showPlainNotice(
          vscode.window,
          'warning',
          refusal.text,
          ...(refusal.actions ?? []),
        ),
      ),
      overtaken,
    ).catch((error: unknown) => {
      // An overtaken entry stops waiting for its answer; the notice's own failure still reaches the caller.
      if (overtaken.aborted) return undefined
      throw error
    })
    if (
      action !== NODE_LEARNING_SAVE_ACTION.closeBrowserReplay ||
      entry !== this.host.nodeHistoryEntryRequest ||
      !this.host.browserReplayShown() ||
      this.host.selection.studyId !== studyId ||
      this.host.playback?.state().revision !== revision
    )
      return false
    await this.host.returnCurrentSelection('learner')
    return !this.host.browserReplayShown()
  }

  /**
   * Answers a test replay open that failed: a learner's preview tab that blocked it gets its choice and a retry (F158), in the composition the open met it in; otherwise the empty summary composition is left and the failure is told once (DS-G), or only recorded when Keep Tab Open has told it already (F407). Called by {@link openNodeHistoryFromHost}.
   * @param studyId - The test replay's study id.
   * @param error - What the open threw.
   * @returns `retry` when the learner chose a way out of a blocking preview; `told` once the failure is answered.
   * @example if ((await this.answerFailedTestReplayOpen(studyId, outcome.error)) === 'retry') return this.openNodeHistoryFromHost(studyId)
   */
  private async answerFailedTestReplayOpen(
    studyId: string,
    error: unknown,
  ): Promise<'retry' | 'told'> {
    const cause = sanitizeCause(error, this.host.privateRoots())
    const answer = await this.resolveForeignPreviewRefusal(cause)
    if (answer === 'retry') return 'retry'
    // A failed open shows no replay in the summary composition: the Study composition comes back, with the failure on its line (DS-G). A newer entry still under way keeps that composition for its own replay (Cycle 0052 task 35).
    if (this.nodeHistoryEntriesUnderWay === 0)
      await this.host.leaveEmptySummaryComposition()
    // The keep-open refusal has told the learner already, so no second notification follows; the refusal is still recorded once in Output › Codebook, where other open refusals are, so a later take can tell why the replay did not open (F407).
    if (answer === 'told')
      this.host.diagnostics?.log({
        ...this.host.replayOpenDiagnosticIdentity(studyId),
        studyId,
        cause,
      })
    else this.tellTestReplayOpenFailure(studyId, error, cause)
    return 'told'
  }

  /**
   * Opens the summary composition for a test replay that is about to open (Cycle 0051, DS-A): a closed reader opens, and the Live composition and the Study composition give way to it, so the Study pane closes and the Learning summary takes the chat's place; called by {@link openNodeHistoryFromHost}.
   * Only a reader that already stands in the summary composition for a test replay (another test replay was shown) is left as it is; an earlier entry that failed after it left the Live composition is opened again, so the Application, the slot and the debugger never show without a transport (F384).
   * A closed reader keeps the replay it showed for the next Open Study Workspace ({@link close}); an entry for another replay holds that selection back ({@link heldBackReplay}) before {@link open} publishes, so the Learning summary never draws the closed reader's replay (its title, result and stop) while the chosen one opens, and a refused entry leaves it selected for the next Open Study Workspace (Cycle 0056 task 32). An entry for the same replay keeps it and shows it at once.
   * @throws What {@link open} throws; the caller tells it.
   * @param studyId - The test replay's study id.
   * @param entry - The entry's ticket ({@link nodeHistoryEntryRequest}); an entry a newer one or a Return overtook while it waited for the work window reveals nothing.
   * @param overtaken - Aborts the waits for the work window and for the Learning summary view, in a standing composition and in {@link open}, when a newer entry, a Return or a Close supersedes the ticket, so the next entry's turn is not held for their bounds (Cycle 0052 tasks 40, 44 and 45).
   * @throws The abort's reason when the wait is overtaken; the caller ends quietly for a superseded ticket.
   * @example await this.enterSummaryCompositionForReplay(studyId, entry, overtaken)
   */
  async enterSummaryCompositionForReplay(
    studyId: string,
    entry: number,
    overtaken: AbortSignal,
  ): Promise<void> {
    if (
      this.host.opened &&
      this.host.summaryComposition &&
      !this.host.liveComposition &&
      !this.host.recordingActive
    ) {
      // The composition stands already, but the learner may have hidden the summary and the bottom panel: the entry shows them again, so Open replay never ends with no visible replay (Cycle 0052 task 14). The reveal waits for the work window as open()'s does, and an entry overtaken meanwhile reveals nothing.
      await this.host.waitForRecordingWindow(overtaken, this.host.lifetime)
      if (entry !== this.host.nodeHistoryEntryRequest) return
      // The reveal's wait for the summary view ends too when the entry is overtaken (Cycle 0052 task 45).
      await this.host.showLearningSummary(overtaken, true)
      return
    }
    this.host.hostOpeningTestReplay = true
    try {
      // A closed reader still holds the replay it showed for the next Open Study Workspace: while another replay's entry opens, no view draws it, and a refused entry leaves it selected (Cycle 0056 task 32).
      if (
        !this.host.opened &&
        this.host.selectedNodeHistory &&
        this.host.selectedNodeHistory.header.studyId !== studyId
      )
        this.host.heldBackReplay = { openToken: this.host.nodeHistoryOpenToken }
      // The open's waits for the work window end too when a newer entry, a Return or a Close supersedes this one (Cycle 0052 task 44).
      await this.host.open(overtaken)
    } finally {
      this.host.hostOpeningTestReplay = false
    }
  }

  /**
   * Returns the reader to the composition its selection asks for after a refused entry, without measuring the main editor: the summary composition and the Learning summary's replay document are withdrawn and the Study pane is created again at its destination, so the refusal shows there and the next selection or Open arranges the panes; called by {@link enterCompositionForEntry} for a refusal whose cause (a main editor that reported no keyboard focus) a second measurement would meet again after another wait.
   * @param refusal - The refusal the entry ended with; its sentence stands on the returned Study pane's control line until the next handled choice.
   * @returns Nothing; a reader that stands in no empty summary composition is left as it is.
   * @example this.dropEmptySummaryCompositionUnmeasured(error)
   */
  private dropEmptySummaryCompositionUnmeasured(
    refusal: UnreportedEditorFocusError,
  ): void {
    if (!this.host.standsInEmptySummaryComposition()) return
    this.host.forgetUnopenedComposition()
    // open() disposed the Study pane before its measurement failed: the pane is created again at its destination without a measurement, so the refusal is told there and the reader never stands with no pane (Cycle 0060 final range, CR2-1).
    this.host.presentationMode = 'study-workspace'
    try {
      this.host.ensureContext()
      // The report publishes the pane with the refusal's line.
      this.host.report('node-history-control', refusal.message)
    } catch (error) {
      this.host.report('control', error)
    }
  }

  /**
   * Names the Output › Codebook entry's surface and profile for a replay that did not open, from the catalogs, as the failure notification's wording does; called by {@link tellTestReplayOpenFailure} and {@link answerFailedTestReplayOpen}.
   * @param studyId - The replay's study id.
   * @returns `open:server-replay` with profile `node-server` for a server replay (listed, or a node-server run of this window not yet listed); `open:extension-replay` with `chrome-extension` for an Extension replay ({@link isExtensionReplay}); `open:test-replay` with `node-test` otherwise.
   * @example this.replayOpenDiagnosticIdentity(studyId) // => { surface: 'open:server-replay', profile: 'node-server' }
   */
  replayOpenDiagnosticIdentity(studyId: string): {
    surface:
      | 'open:server-replay'
      | 'open:script-replay'
      | 'open:extension-replay'
      | 'open:test-replay'
    profile:
      | typeof NODE_SERVER_PROFILE
      | typeof NODE_SCRIPT_PROFILE
      | typeof CHROME_EXTENSION_PROFILE
      | typeof NODE_TEST_PROFILE
  } {
    const isListedTest = this.host.nodeHistoryCatalog.some(
      (history) => history.studyId === studyId,
    )
    const isServer =
      !isListedTest &&
      (this.host.nodeServerHistoryCatalog.some(
        (history) => history.studyId === studyId,
      ) ||
        this.host.recordOfStudy(studyId)?.profile === NODE_SERVER_PROFILE)
    if (isServer)
      return { surface: 'open:server-replay', profile: NODE_SERVER_PROFILE }
    // A script replay, listed or just saved by this window, is logged as its own surface, never as a server or test replay.
    if (
      !isListedTest &&
      (this.host.nodeScriptHistoryCatalog.some(
        (history) => history.studyId === studyId,
      ) ||
        this.host.recordOfStudy(studyId)?.profile === NODE_SCRIPT_PROFILE)
    )
      return { surface: 'open:script-replay', profile: NODE_SCRIPT_PROFILE }
    // An Extension replay is logged as its own surface, never as a test replay.
    if (!isListedTest && this.isExtensionReplay(studyId))
      return {
        surface: 'open:extension-replay',
        profile: CHROME_EXTENSION_PROFILE,
      }
    return { surface: 'open:test-replay', profile: NODE_TEST_PROFILE }
  }

  /** Whether the study is an Extension replay, listed or just saved by this window; worded as one in an open-failure notice. @example this.isExtensionReplay(studyId) // => true */
  private isExtensionReplay(studyId: string): boolean {
    return (
      this.host.nodeExtensionHistoryCatalog.some(
        (history) => history.studyId === studyId,
      ) ||
      this.host.recordOfStudy(studyId)?.profile === CHROME_EXTENSION_PROFILE
    )
  }

  /**
   * Names a replay that did not open for the failure notification, as Saved studies names it: a test by its file and titles, any other replay by its saved title or question; the study id when no catalog lists it.
   * @param studyId - The replay's study id.
   * @returns The name the notification quotes.
   * @example this.replayOpenFailureTitle(studyId) // => 'Creating an item'
   */
  private replayOpenFailureTitle(studyId: string): string {
    const test = this.host.nodeHistoryCatalog.find(
      (history) => history.studyId === studyId,
    )
    if (test) return [test.testFile, ...(test.testTitles ?? [])].join(' › ')
    const titled = [
      ...this.host.nodeServerHistoryCatalog,
      ...this.host.nodeScriptHistoryCatalog,
      ...this.host.nodeExtensionHistoryCatalog,
    ].find((history) => history.studyId === studyId)
    return titled ? (titled.title ?? titled.question) : studyId
  }

  /**
   * Tells the learner that a test replay did not open: one Output › Codebook entry, written before this returns, and the load-failure notification, whose Show details button opens the channel; called by {@link openNodeHistoryFromHost} and {@link enterCompositionForEntry}.
   * The notification's answer is never awaited: an error notification stays on screen until the learner answers it, and the entry that raised it holds the next entry's turn, so waiting would leave every later choice with no notice and no Output entry (N55-F4, Cycle 0056 task 17). The answer opens the channel whenever it comes.
   * @param studyId - The test replay's study id.
   * @param error - What the open threw.
   * @param cause - The sanitized cause of that error.
   * @example this.tellTestReplayOpenFailure(studyId, outcome.error, cause)
   */
  private tellTestReplayOpenFailure(
    studyId: string,
    error: unknown,
    cause: string,
  ): void {
    const stack = sanitizedStack(error, this.host.privateRoots())
    const identity = this.host.replayOpenDiagnosticIdentity(studyId)
    this.host.diagnostics?.log({
      ...identity,
      studyId,
      cause,
      ...(stack ? { stack } : {}),
    })
    const failure = describeNodeLearningSave({
      kind: 'open-failed',
      // A server or script replay that cannot open is worded as one, never as a test replay, also before Saved studies lists it.
      ...(identity.profile === NODE_SERVER_PROFILE ||
      identity.profile === NODE_SCRIPT_PROFILE
        ? { profile: identity.profile }
        : this.isExtensionReplay(studyId)
          ? { profile: CHROME_EXTENSION_PROFILE }
          : {}),
      title: this.replayOpenFailureTitle(studyId),
      cause,
    })
    // The answer is handled whenever it arrives, outside every entry's turn.
    void Promise.resolve(
      showPlainNotice(
        vscode.window,
        'error',
        failure.text,
        ...(failure.actions ?? []),
      ),
    ).then(
      (action) => {
        if (action === NODE_LEARNING_SAVE_ACTION.showDetails)
          this.host.diagnostics?.show()
      },
      (error: unknown) => this.host.report('control', error),
    )
  }

  /**
   * Opens a saved test history in the Study pane, the Application pane and the replay debugger at its saved reader position, or without one on its first stop whose source verifies, or on its first event when none does (DS1); the open the Study pane's `node-history` message and {@link openNodeHistoryFromHost} share.
   * Each open takes a request token from the same counter as the pane's history requests (EN19), so a host open and a pane open never interleave their writes: a later request supersedes this one.
   * @param studyId - The test history's study id.
   * @param revision - The reader revision the open belongs to; a newer revision supersedes it.
   * @returns `opened`, `superseded` by a newer request, revision or close, or `failed` with the error, which the reader also shows.
   * @example await this.openNodeHistory(studyId, this.revision) // => { status: 'opened' }
   */
  async openNodeHistory(
    studyId: string,
    revision: number,
  ): Promise<
    { status: 'opened' | 'superseded' } | { status: 'failed'; error: unknown }
  > {
    const request = ++this.host.historyRequest
    this.host.studyChoices++
    // A test replay that plays stops before another one opens: a failed open leaves it on its last committed moment with no timer running, and a shown replay never moves behind the opening (DS-A, DS-G).
    this.host.nodeHistoryPlaybackController?.pause()
    try {
      // The opening marker is set inside the try, so its finally ends it even when the first publish throws.
      this.host.pendingNodeHistory = request
      this.host.pendingNodeHistoryStudyId = studyId
      this.host.loading = true
      this.host.publish()
      await this.host.replayDebuggers.replaceUnavailable()
      const opening = await this.host.readNodeHistoryOpening(
        studyId,
        request,
        revision,
      )
      if (!opening) return { status: 'superseded' }
      const {
        history,
        learningDecision,
        learningMaterial,
        savedSequence,
        positionError,
        serverReplay,
        extensionReplay,
      } = opening
      this.host.nodeHistoryPlaybackController?.dispose()
      this.host.replayDebuggers.current?.invalidate()
      this.host.selectedNodeHistoryRequest++
      // The reading of another replay is not kept: only the shown replay's is.
      if (
        this.host.selectedNodeHistory?.header.studyId !== history.header.studyId
      )
        this.host.nodeOutputReadings.clear()
      this.host.selectedNodeHistory = history
      this.host.selectedServerReplay = serverReplay
      this.host.selectedExtensionReplay = extensionReplay
      this.host.extensionShownFrame = undefined
      this.host.extensionNativeShown = undefined
      // The frames of the replay shown before are not kept; the new replay reads its own from its folder, by hash.
      this.host.extensionFrames = extensionReplay
        ? new ExtensionReplayFrameCache(
            this.host.nodeHistoryRepository!.extensionHistories.historyDirectory(
              history.header.studyId,
            ),
          )
        : undefined
      this.host.nodeHistoryOpenToken = request
      // The pending close failure of another replay's withdrawn selection is not this replay's (F365).
      this.host.nodeSourceSlotCloseFailure = undefined
      // Admitting another history permanently retires the prior exact Wiki visit; refused reads leave it intact.
      this.host.repositoryObservation = undefined
      this.host.selectedNodeHistoryLearningDecision = learningDecision
      this.host.selectedNodeHistoryLearningMaterial = learningMaterial
      this.host.selectedNodeHistoryPage = 0
      this.host.selectedNodeHistorySequence = undefined
      this.host.nodeSurfacesSequence = undefined
      this.host.requestedNodeHistorySequence = undefined
      this.host.nodeHistoryLeftFor = undefined
      this.host.selectedNodeHistoryStepId = undefined
      this.host.selectedNodeHistoryDebugAvailable = false
      this.host.selectedNodeHistoryValuesUninspected = false
      // A test or server history has no application frames, and an Extension replay's frames load with its first moment: either way the pixels of the prior browser study go at once.
      this.host.presentApplication(this.host.message())
      // Each opened history gets its own controller; the present callback is bound to this study.
      this.host.nodeHistoryPlaybackController =
        new NodeHistoryPlaybackController({
          present: async (sequence, isCurrent) => {
            const selectedHistory = this.host.selectedNodeHistory
            if (!selectedHistory || selectedHistory.header.studyId !== studyId)
              throw new Error(this.host.replayRefusal('changedDuringPlayback'))
            await this.host.requestNodeHistoryEvent(selectedHistory, sequence, {
              publish: false,
              alignPlayback: false,
              isCurrent,
            })
          },
          changed: () => this.host.publish(),
          failed: (error) => this.host.report('control', error),
          replayKind: () => this.host.replayKind(),
        })
      // The saved reader position, else the first stop whose source verifies, else the first event (DS1).
      const initialSequence = this.landingSequence(
        history,
        savedSequence,
        serverReplay,
        extensionReplay,
      )
      this.host.nodeHistoryPlaybackController.open(
        history.entries.map((entry) => ({
          sequence: entry.sequence,
          elapsedMs: entry.elapsedMs,
        })),
        initialSequence,
        // A server recording's timeline ends at its `end` entry, which may come after the last event.
        serverReplay?.model.endedAtMs,
      )
      if (positionError)
        this.host.reportTestReplayFailure('history-position', positionError)
      if (initialSequence !== undefined)
        await this.host.requestNodeHistoryEvent(history, initialSequence, {
          publish: false,
          alignPlayback: false,
          keepOpenWithoutDebugger: true,
        })
      if (this.historyOpenSuperseded(request, revision))
        return { status: 'superseded' }
      this.endNodeHistoryOpening(request)
      this.host.loading = false
      this.host.publish()
      return { status: 'opened' }
    } catch (error) {
      if (this.historyOpenSuperseded(request, revision))
        return { status: 'superseded' }
      this.endNodeHistoryOpening(request)
      this.host.loading = false
      this.host.reportTestReplayFailure('archive', error)
      this.host.publish()
      return { status: 'failed', error }
    } finally {
      const endedHere = this.endNodeHistoryOpening(request)
      // A request discarded only because the reader's revision changed is still the latest; nothing else ends the loading state it set.
      if (this.host.loading && this.host.isLatestHistoryRequest(request)) {
        this.host.loading = false
        this.host.publish()
      } else if (endedHere && !this.host.closing) {
        // A render that ended the loading state meanwhile leaves the panes on this open's loading line until they are published again.
        this.host.publish()
      }
    }
  }

  /**
   * Ends a test replay open's own marker, which alone says that a test replay is opening ({@link nodeHistoryViews}): a render that ends the shared loading state meanwhile never ends it; called by {@link openNodeHistory} before its last publish and in its `finally`.
   * @param request - The open's request token.
   * @returns `true` when this call ended the open's marker; `false` when a newer open owns it or it was already ended.
   * @example this.endNodeHistoryOpening(request) // => true
   */
  private endNodeHistoryOpening(request: number): boolean {
    // A newer Node history request owns the marker by then.
    if (this.host.pendingNodeHistory !== request) return false
    this.host.pendingNodeHistory = undefined
    this.host.pendingNodeHistoryStudyId = undefined
    return true
  }

  /**
   * Reads what opening a test history shows besides its journal (the learner's decision, the learning material and the saved reader position), stopping as soon as a newer request, a newer reader revision or the reader's close supersedes the open; called by {@link openNodeHistory}.
   * A decision or material that cannot be read is reported and left out, and a position that cannot be read is returned as its error, which the open reports once the replay is selected.
   * @param studyId - The test history's study id.
   * @param request - The open's request token.
   * @param revision - The reader revision the open belongs to.
   * @returns The history with what was read, or `undefined` once the open is superseded.
   * @throws When the journal itself cannot be read or verified.
   * @example await this.readNodeHistoryOpening(studyId, request, this.revision) // => { history, learningDecision, learningMaterial, savedSequence, positionError }
   */
  async readNodeHistoryOpening(
    studyId: string,
    request: number,
    revision: number,
  ): Promise<NodeHistoryOpening | undefined> {
    const resolved = this.host.nodeHistoryRepository?.resolve(studyId)
    if (resolved?.profile === 'node-server')
      return this.readServerHistoryOpening(
        resolved.store,
        studyId,
        request,
        revision,
        {
          stillRecording: NODE_SERVER_REPLAY_TEXT.stillRecording,
          summaryFailure: describeServerSummaryFailure,
          present: presentServerHistory,
        },
      )
    // A script replay opens through the same path, dressed with the script's words.
    if (resolved?.profile === 'node-script')
      return this.readServerHistoryOpening(
        resolved.store,
        studyId,
        request,
        revision,
        {
          stillRecording: NODE_SCRIPT_REPLAY_TEXT.stillRecording,
          summaryFailure: describeScriptSummaryFailure,
          present: presentScriptHistory,
        },
      )
    if (resolved?.profile === 'chrome-extension')
      return this.readExtensionHistoryOpening(
        resolved.store,
        studyId,
        request,
        revision,
      )
    const store = this.host.nodeHistoryStore!
    const history = await store.read(studyId)
    if (this.historyOpenSuperseded(request, revision)) return undefined
    const sidecars = await this.readOpeningSidecars(
      store,
      studyId,
      request,
      revision,
    )
    return sidecars && { history, ...sidecars }
  }

  /**
   * Reads a server history for its replay: the journal, the same sidecars a test replay reads, its summary's learning verdict, then the presentation that dresses it in the shared replay path; a history another window is still recording is refused, as it opens only once sealed or interrupted. Called by {@link readNodeHistoryOpening} for a study id the repository resolves to the server store.
   * A saved reader position on a storage-only entry (a source entry or a send mark) restores the nearest earlier learner event.
   * @param store - The server store the repository resolved.
   * @param studyId - The server history's study id.
   * @param request - The open's request token.
   * @param revision - The reader revision the open belongs to.
   * @returns The test-shaped history with the presentation and what was read, or `undefined` once the open is superseded.
   * @throws When the journal cannot be read or verified, or the history is still being recorded.
   * @example await this.readServerHistoryOpening(store, studyId, request, this.revision) // => { history, serverReplay, savedSequence }
   */
  private async readServerHistoryOpening<
    Types extends NodeServerHistoryTypes | NodeScriptHistoryTypes,
  >(
    store: NodeHistoryStore<Types>,
    studyId: string,
    request: number,
    revision: number,
    flavor: {
      stillRecording: string
      summaryFailure: (cause: string) => string
      present: (
        journal: HistoryIndexOf<Types>,
        summary: Types['Summary'] | undefined,
      ) => ServerReplayPresentation
    },
  ): Promise<NodeHistoryOpening | undefined> {
    const journal = await this.readOpenableJournal(
      store,
      studyId,
      request,
      revision,
      flavor.stillRecording,
    )
    if (!journal) return undefined
    const sidecars = await this.readOpeningSidecars(
      store,
      studyId,
      request,
      revision,
    )
    if (!sidecars) return undefined
    // A summary that cannot be read leaves the learning verdict unknown: the open says so on the learning line instead of reading as "explanation not saved".
    const summary = await store.summarize(studyId).catch((error: unknown) => {
      // A read that another open superseded meanwhile has no replay left to say it about.
      if (this.historyOpenSuperseded(request, revision)) return undefined
      this.host.reportTestReplayFailure(
        'history-learning',
        error,
        flavor.summaryFailure,
      )
      return undefined
    })
    if (this.historyOpenSuperseded(request, revision)) return undefined
    const serverReplay = flavor.present(journal, summary)
    const restored =
      sidecars.savedSequence === undefined
        ? undefined
        : restoreServerPlayhead(serverReplay.model, sidecars.savedSequence)
    return {
      history: serverReplay.history,
      serverReplay,
      ...sidecars,
      savedSequence: restored?.sequence,
    }
  }

  /**
   * Reads a history's verified journal for its replay and refuses one another window is still recording, which opens once sealed or interrupted; called by {@link readServerHistoryOpening} and {@link readExtensionHistoryOpening}.
   * @param store - The store the repository resolved.
   * @param studyId - The history's study id.
   * @param request - The open's request token.
   * @param revision - The reader revision the open belongs to.
   * @param stillRecording - The profile's sentence for a history still being recorded.
   * @returns The journal, or `undefined` once the open is superseded.
   * @throws When the journal cannot be read or verified, or the history is still being recorded.
   * @example const journal = await this.readOpenableJournal(store, studyId, request, this.revision, NODE_SERVER_REPLAY_TEXT.stillRecording)
   */
  private async readOpenableJournal<Types extends HistoryTypes>(
    store: NodeHistoryStore<Types>,
    studyId: string,
    request: number,
    revision: number,
    stillRecording: string,
  ): Promise<HistoryIndexOf<Types> | undefined> {
    const journal = await store.read(studyId)
    if (this.historyOpenSuperseded(request, revision)) return undefined
    if (journal.status === 'recording') throw new Error(stillRecording)
    return journal
  }

  /**
   * Reads a chrome-extension history for its replay: the journal dressed in the shared replay path, the learner's decision and the saved reader position restored to the nearest event at or before it; a history another window is still recording is refused, as it opens once sealed or interrupted. Called by {@link readNodeHistoryOpening} for a study id the repository resolves to the extension store.
   * The history's saved learning material is read as a server replay's is; a history without material shows its recording alone.
   * @param store - The extension store the repository resolved.
   * @param studyId - The history's study id.
   * @param request - The open's request token.
   * @param revision - The reader revision the open belongs to.
   * @returns The test-shaped history with the presentation and what was read, or `undefined` once the open is superseded.
   * @throws When the journal cannot be read or verified, or the history is still being recorded.
   * @example await this.readExtensionHistoryOpening(store, studyId, request, this.revision) // => { history, extensionReplay, savedSequence }
   */
  private async readExtensionHistoryOpening(
    store: NodeHistoryStore<ExtensionHistoryTypes>,
    studyId: string,
    request: number,
    revision: number,
  ): Promise<NodeHistoryOpening | undefined> {
    const journal = await this.readOpenableJournal(
      store,
      studyId,
      request,
      revision,
      NODE_EXTENSION_REPLAY_TEXT.stillRecording,
    )
    if (!journal) return undefined
    // The same sidecars a test or server replay reads: the decision, the saved position and the learning material (a material that cannot be read is reported and left out).
    const sidecars = await this.readOpeningSidecars(
      store,
      studyId,
      request,
      revision,
    )
    if (!sidecars) return undefined
    const extensionReplay = adaptExtensionReplay(journal)
    // A saved sequence that names no timeline event (a capture or a pin) restores the nearest earlier event.
    const restored =
      sidecars.savedSequence === undefined
        ? undefined
        : restoreExtensionPlayhead(
            extensionReplay.model,
            sidecars.savedSequence,
          )
    return {
      history: extensionReplay.history,
      extensionReplay,
      ...sidecars,
      savedSequence: restored?.sequence,
    }
  }

  /**
   * Reads what opening a history shows besides its journal (the learner's decision, the learning material and the saved reader position) from either profile's store, stopping as soon as a newer request, a newer reader revision or the reader's close supersedes the open; called by {@link readNodeHistoryOpening}, {@link readServerHistoryOpening} and {@link readExtensionHistoryOpening}.
   * A decision or material that cannot be read is reported and left out, and a position that cannot be read is returned as its error, which the open reports once the replay is selected.
   * @param store - The store that holds the history.
   * @param studyId - The history's study id.
   * @param request - The open's request token.
   * @param revision - The reader revision the open belongs to.
   * @returns What was read, or `undefined` once the open is superseded.
   * @example await this.readOpeningSidecars(store, studyId, request, this.revision) // => { learningDecision, learningMaterial, savedSequence, positionError }
   */
  private async readOpeningSidecars<
    Types extends HistoryTypes & { Material: NodeLearningMaterialOfHistory },
  >(
    store: NodeHistoryStore<Types>,
    studyId: string,
    request: number,
    revision: number,
  ): Promise<
    | {
        learningDecision?: NodeTestHistoryLearningDecision
        learningMaterial?: NodeLearningMaterialOfHistory
        savedSequence?: number
        positionError?: unknown
      }
    | undefined
  > {
    const progress = await this.readOpeningProgress(
      store,
      studyId,
      request,
      revision,
    )
    if (!progress) return undefined
    const learningMaterial = await store
      .readLearningMaterial(studyId)
      .catch((error: unknown) => {
        this.host.reportTestReplayFailure('history-learning', error)
        return undefined
      })
    if (this.historyOpenSuperseded(request, revision)) return undefined
    return { ...progress, learningMaterial }
  }

  /**
   * Reads the part of an open that every profile shares: the learner's decision and the saved reader position, stopping as soon as a newer request, a newer reader revision or the reader's close supersedes the open; called by {@link readOpeningSidecars} and {@link readExtensionHistoryOpening}.
   * A decision that cannot be read is reported and left out, and a position that cannot be read is returned as its error, which the open reports once the replay is selected.
   * @param store - The store that holds the history.
   * @param studyId - The history's study id.
   * @param request - The open's request token.
   * @param revision - The reader revision the open belongs to.
   * @returns The decision and the position, or `undefined` once the open is superseded.
   * @example await this.readOpeningProgress(store, studyId, request, this.revision) // => { learningDecision, savedSequence, positionError }
   */
  private async readOpeningProgress<Types extends HistoryTypes>(
    store: NodeHistoryStore<Types>,
    studyId: string,
    request: number,
    revision: number,
  ): Promise<
    | {
        learningDecision?: NodeTestHistoryLearningDecision
        savedSequence?: number
        positionError?: unknown
      }
    | undefined
  > {
    const learningDecision = await store
      .readLearningDecision(studyId)
      .catch((error: unknown) => {
        this.host.reportTestReplayFailure('progress', error)
        return undefined
      })
    if (this.historyOpenSuperseded(request, revision)) return undefined
    const position = await store.readReaderPosition(studyId).then(
      (savedSequence) => ({ savedSequence, positionError: undefined }),
      (positionError: unknown) => ({ savedSequence: undefined, positionError }),
    )
    if (this.historyOpenSuperseded(request, revision)) return undefined
    return { learningDecision, ...position }
  }

  /**
   * Chooses the moment a replay opens at: its saved reader position, else the first stop whose source verifies (a server replay: its first recorded stop, else its request), else its first event (DS1); called by {@link openNodeHistory}.
   * @param history - The history the replay moves over.
   * @param savedSequence - The saved position, restored to a learner event for a server replay.
   * @param serverReplay - The server presentation, when the replay is one.
   * @returns The journal sequence to select; `undefined` for a history with no event.
   * @example this.landingSequence(history, undefined, undefined) // => 2 for an output, then a verified stop
   */
  private landingSequence(
    history: NodeTestHistoryIndex,
    savedSequence: number | undefined,
    serverReplay: ServerReplayPresentation | undefined,
    extensionReplay?: ExtensionReplayPresentation,
  ): number | undefined {
    if (savedSequence !== undefined) return savedSequence
    if (serverReplay) return openingServerEvent(serverReplay.model)?.sequence
    // An Extension replay without a saved position opens on its first recorded stop, else its first event.
    if (extensionReplay)
      return openingExtensionEvent(extensionReplay.model)?.sequence
    return firstVerifiedStopSequence(history) ?? history.entries[0]?.sequence
  }

  /**
   * Says whether a test history's open lost its place: a newer history request took the reader, the reader's revision changed, or the reader is closing; read by {@link openNodeHistory} and {@link readNodeHistoryOpening} after each await.
   * @param request - The open's request token.
   * @param revision - The reader revision the open belongs to.
   * @returns `true` when the open must leave the reader as it is.
   * @example if (this.historyOpenSuperseded(request, revision)) return { status: 'superseded' }
   */
  private historyOpenSuperseded(request: number, revision: number): boolean {
    return (
      !this.host.isLatestHistoryRequest(request) ||
      revision !== this.host.revision
    )
  }

  /**
   * Marks the recording open an agent is about to ask the playback controller for, so the load it starts enters the reader as the agent's ({@link open} with `forAgent`, row 613); called by {@link StudyService.playback} for codebook_playback's `open`, right before its command.
   * The mark names the study and the revision the controller gives an accepted open; {@link loadPlayback} takes it for that load only.
   * @param studyId - The study the agent opens.
   * @returns The function that forgets the mark again, for an open the controller refused or answered without a load.
   * @example const forget = workspace.markAgentRecordingOpen(input.studyId)
   */
  markAgentRecordingOpen(studyId: string): () => void {
    const mark = {
      studyId,
      revision: (this.host.playback?.state().revision ?? 0) + 1,
    }
    this.agentRecordingOpen = mark
    return (): void => {
      if (this.agentRecordingOpen === mark) this.agentRecordingOpen = undefined
    }
  }

  /**
   * Takes the agent's mark of the recording open that started this load, if any; asked once by {@link loadPlayback} before it arranges the reader.
   * @param studyId - The study whose recording loads.
   * @returns `true` when an agent asked for this open ({@link markAgentRecordingOpen}); `false` for the learner's own open.
   * @example const forAgent = this.takeAgentRecordingOpen(studyId)
   */
  private takeAgentRecordingOpen(studyId: string): boolean {
    const mark = this.agentRecordingOpen
    // A mark for another study or another open belongs to no load of this one.
    if (
      mark?.studyId !== studyId ||
      mark.revision !== this.host.playback?.state().revision
    )
      return false
    this.agentRecordingOpen = undefined
    return true
  }

  /** Loads immutable film/context before arranging its reader, restoring only the separately saved paused position. @example await this.loadPlayback(id, signal) */
  async loadPlayback(
    studyId: string,
    signal: AbortSignal,
  ): Promise<PlaybackData> {
    // Capture the actual existing holder before I/O or composition changes; later learner choices are preserved by native reveal options too.
    const preserveRecordingKeyboard = Boolean(
      vscode.window.state.focused &&
      this.host.moments?.visible &&
      this.host.momentsReportsKeyboard,
    )
    const intent = this.host.repositoryRecordingOpen
    const origin =
      intent?.studyId === studyId &&
      intent.revision === this.host.playback!.state().revision
        ? 'repository'
        : 'study'
    if (origin === 'repository') this.host.repositoryRecordingOpen = undefined
    const forAgent = this.takeAgentRecordingOpen(studyId)
    // An agent's open reaches this loader without openRecording; the same study on its way to the Trash is refused here too.
    this.host.assertStudyNotMoving(studyId)
    this.host.replayLoadAwaitingReady = true
    await this.host.replayDebuggers.replaceUnavailable(signal)
    signal.throwIfAborted()
    // A recording that loads retires a selected test replay, as choosing a browser study does: the pane then shows the recording's own pages (D20).
    // Only a selected replay is retired, so a load with none selected adds no wait before the recording becomes active.
    if (this.host.selectedNodeHistory) {
      await this.host.retireNodeHistorySelection()
      signal.throwIfAborted()
    }
    this.host.recordingActive = true
    // A test replay retired for this recording left the summary its placeholder: the recording's loading, failure and retry need the reader's document there (Cycle 0052 task 35).
    if (this.host.summaryComposition) {
      this.host.giveSummaryItsDocument()
      this.host.lastPublished = undefined
    }
    // The reloaded recording is active again: a same-study Reload's mark has served its turn.
    this.host.recordingReloadStudyId = undefined
    // A browser replay starting ends any earlier record of tabs to close (F474).
    this.host.retiredBrowserReplayTabs = undefined
    this.host.pendingHistory = undefined
    // A study this window still holds (a run of this session) is selected with its own item: paired with the item shown before, every reader update until the recording is read failed with "Selected item belongs to another configured article.", and that line stayed.
    const heldStudy =
      studyId === this.host.activeArchive?.id
        ? this.host.activeArchive
        : this.host.selectedArchive?.id === studyId
          ? this.host.selectedArchive
          : undefined
    this.host.selection = heldStudy
      ? selectStudy(heldStudy, this.host.selection)
      : { ...this.host.selection, studyId, follow: false }
    this.showRecordingLoadingOnLiveViewport()
    const index = await this.host.recordings!.read(studyId)
    signal.throwIfAborted()
    let context: PlaybackData['context'],
      contextHash: string | undefined,
      contextReason: string | undefined,
      preferredPositionMs: number | undefined
    try {
      const saved = await this.host.recordings!.readContext(studyId)
      context = saved.context
      contextHash = saved.hash
    } catch (error) {
      contextReason = `Recorded source/value context unavailable: ${String(error)}`
    }
    signal.throwIfAborted()
    try {
      const saved = await this.host.readSavedArchive(studyId)
      signal.throwIfAborted()
      this.host.selectedArchive = saved
      if (context && sha256(JSON.stringify(saved)) !== context.studyHash)
        this.host.report(
          'playback-context',
          new Error(
            'Saved study changed after this recording context. Reload after its matching context is saved.',
          ),
        )
      else this.host.errors.delete('playback-context')
    } catch (error) {
      this.host.report('playback-context', error)
    }
    signal.throwIfAborted()
    const definition = context
      ? { ...context.study, captures: [] }
      : this.host.selectedArchive?.id === studyId
        ? this.host.selectedArchive
        : undefined
    if (definition)
      this.host.selection = selectStudy(definition, this.host.selection)
    else
      throw new Error(
        'Configured recording article context is unavailable. Reload its saved context.',
      )
    try {
      const saved = await this.host.recordings!.readPreference()
      if (saved?.studyId === studyId) preferredPositionMs = saved.positionMs
      this.host.errors.delete('playback-preference')
    } catch (error) {
      this.host.report('playback-preference', error)
    }
    signal.throwIfAborted()
    // A read that an entry's own reveal restarted (the reader was closed before the recording was read to its end) belongs to that entry, which arranges the recording's panes: opening the reader again from here would be refused by the presentation change that made the entry.
    if (
      this.host.recordingRevealedByEntry !==
      this.host.playback!.state().presentationRevision
    )
      await this.host.open(signal, origin, preserveRecordingKeyboard, forAgent)
    signal.throwIfAborted()
    await this.host.ensureReplayViewport(signal)
    signal.throwIfAborted()
    return { index, context, contextHash, contextReason, preferredPositionMs }
  }

  /**
   * Shows the loading page on a live run's viewport while a recording loads, releasing the recording renderer that page replaces.
   *
   * {@link loadPlayback} calls it before it reads the recording. Without a live viewport nothing is written and the renderer stays;
   * a renderer that still holds the panel is kept, so a reload needs no new renderer handshake.
   *
   * @example this.showRecordingLoadingOnLiveViewport()
   */
  private showRecordingLoadingOnLiveViewport(): void {
    if (!this.host.viewport) return
    // A recording renderer still holding the shared panel is kept: a new renderer's handshake would sit on the 2.0 s recovery path. The playback controller clears its frame, except for a reload of the recording on screen.
    if (this.isRecordingRendererHoldingPanel()) return
    // The live lease's loading page replaces the shared panel's document, so a recording renderer reused across this reload could never acknowledge a frame.
    this.host.dropReplayViewport()
    try {
      this.host.viewport.showHistory(
        this.host.applicationHtml({ ...this.host.message(), loading: true }),
      )
    } catch {
      // A lease whose panel the editor already closed has no document to write; the recording loads into a new panel.
    }
  }

  /**
   * Says whether a recording renderer still holds the shared Application panel; asked by {@link showRecordingLoadingOnLiveViewport} before it would release that renderer for the loading page.
   * @returns `true` when a recording renderer exists and needs no new reveal; `false` when there is none, or when the one there has to reveal the panel again.
   * @example this.isRecordingRendererHoldingPanel() // => true at a reload of the recording on screen
   */
  private isRecordingRendererHoldingPanel(): boolean {
    return Boolean(this.host.replayViewport) && !this.host.replayNeedsReveal
  }

  /**
   * Releases the recording renderer whenever another writer takes over the shared Application panel's document or the recording is left.
   *
   * {@link loadPlayback}, {@link presentation}'s new live lease, a failed load, {@link leavePlayback}, {@link close}, the Application panel's
   * dispose handler and a renderer that never became ready in {@link ensureReplayViewport} call it;
   * {@link ensureReplayViewport} then constructs a new renderer for the next presentation, which performs its own first reveal.
   *
   * @example this.dropReplayViewport()
   */
  dropReplayViewport(): void {
    this.host.replayViewport?.close()
    this.host.replayViewport = undefined
    this.host.replayNeedsReveal = false
  }

  /** Reuses the bounded PNG renderer without CDP, acquiring a fresh lease after replay-panel recreation. @example await this.ensureReplayViewport(signal) */
  async ensureReplayViewport(signal: AbortSignal): Promise<BrowserViewport> {
    if (this.host.replayViewport) {
      if (this.host.replayNeedsReveal) {
        const reused = this.host.replayViewport
        await reused.reveal(signal)
        signal.throwIfAborted()
        // Only a completed handshake retires the owed reveal; an abandoned one leaves it to the next request.
        if (this.host.replayViewport === reused)
          this.host.replayNeedsReveal = false
      }
      return this.host.replayViewport
    }
    const panel = await this.host.prepareApplicationGroup(signal)
    panel.title = RECORDED_APPLICATION_PANE_TITLE
    const viewport = new BrowserViewport(
      this.host.selection.studyId!,
      (type, detail) => this.recordReplayDelivery(type, detail),
      () => this.host.playback?.hide(),
      'normal',
      {
        panel,
        released() {},
        assertCanReveal: (current) =>
          this.host.assertApplicationReveal(current),
      },
      undefined,
      'recording',
    )
    this.host.replayViewport = viewport
    try {
      await viewport.reveal(signal)
      signal.throwIfAborted()
      return viewport
    } catch (error) {
      if (this.host.replayViewport === viewport) {
        // An abandoned request leaves the viewport to the newer one that may already be painting through it; the next presentation finishes its handshake.
        if (signal.aborted) this.host.replayNeedsReveal = true
        else this.host.dropReplayViewport()
      }
      throw error
    }
  }

  /** Confirms the recorded PNG, captured native source and matching context together before the controller commits a playhead. @example await this.presentPlayback(bundle, signal) */
  async presentPlayback(
    bundle: PlaybackBundle,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted()
    // Reading a replay keeps an attached live run's held pause, which would otherwise expire while the learner studies.
    for (const record of this.host.service?.records.values() ?? [])
      record.runtime?.renewPauseHold?.()
    // Retire the previous native Variables tree before publishing another recorded source or frame.
    await this.host.replayDebuggers.current?.retire(
      bundle.projection.debugger,
      signal,
    )
    signal.throwIfAborted()
    this.host.playbackPending = bundle
    this.host.playbackPresentingReady = false
    this.host.selection = retainedStudySelectionSchema.parse({
      ...this.host.selection,
      studyId: bundle.studyId,
      itemId:
        bundle.projection.observation?.itemId ?? this.host.selection.itemId,
      follow: false,
    })
    const viewport = await this.host.ensureReplayViewport(signal)
    signal.throwIfAborted()
    // Opening the workspace may focus context over a manually moved source group; restore only when its native tab is inactive.
    await this.host.renderSelection(
      true,
      !this.host.sourceReady(),
      signal,
      undefined,
      bundle === this.host.playback?.bundle(),
    )
    signal.throwIfAborted()
    if (!this.host.sourceReady())
      throw new Error(
        'Recorded source has not reached the matching native reader.',
      )
    // Keep Application loading until native Run and Debug loads the historical values or its short grace elapses.
    let inspection: ReplayInspection | undefined
    if (
      bundle.context?.study.observations.some(
        (observation) => observation.debugger,
      ) ||
      this.host.replayDebuggers.current
    ) {
      // An owner replaced by an earlier request may still be stopping; this presentation creates the next one only while it is current.
      await this.host.replayDebuggers.retired(signal)
      signal.throwIfAborted()
      inspection = await this.host.replayDebuggers.ensure().present(
        bundle.projection.debugger,
        bundle.projection.debugger
          ? `Recorded pause · ${((bundle.projection.observation?.elapsedMs ?? bundle.projection.positionMs) / MILLISECONDS_PER_SECOND).toFixed(2)} s`
          : 'Not recorded at this moment',
        signal,
        this.host.sourceUri && bundle.projection.observation
          ? {
              uri: this.host.sourceUri.toString(),
              hash: this.host.message().model.source.hash,
            }
          : undefined,
      )
    }
    // Committing without native values stays truthful only with a visible way to load them in Run and Debug; later ticks of this stop keep it.
    this.host.replayUninspectedSnapshot =
      inspection === 'uninspected' ? bundle.projection.debugger : undefined
    // From here the moment is painting; settleOwnedPlayback bounds only this phase by PRESENTATION_READY_TIMEOUT_MS.
    const paint = this.beginReplayPaint()
    // A superseded frame may still wait behind a native placement hold that ignores cancellation; its paint phase must not count against the newer frame's settle.
    const endSupersededPaint = (): void => this.endReplayPaint(paint)
    signal.addEventListener('abort', endSupersededPaint, { once: true })
    try {
      if (bundle.image) {
        const image = bundle.image.toString('base64'),
          label = recordedFrameLabel(bundle.projection.positionMs)
        // Earlier reveal/seek receipts must not be attributed to this frame's first attempt.
        this.replayDelivery = { receipts: [], omitted: 0 }
        try {
          await viewport.present(image, label)
        } catch (error) {
          if (!(error instanceof ViewportAckTimeoutError)) throw error
          signal.throwIfAborted()
          const firstAttempt = this.drainReplayDelivery()
          // A native pane handoff can lose one paint receipt; re-handshake this read-only renderer before retrying the same frame.
          try {
            await viewport.reveal(signal)
          } catch (revealError) {
            if (signal.aborted) throw revealError
            throw new Error(
              `${VIEWPORT_ACK_TIMEOUT_REASON}; the same-frame retry could not re-handshake the renderer: ${String(revealError)}. First attempt: ${firstAttempt}. Re-handshake: ${this.drainReplayDelivery()}.`,
            )
          }
          signal.throwIfAborted()
          try {
            await viewport.present(image, label)
          } catch (retryError) {
            if (signal.aborted) throw retryError
            const retry = this.drainReplayDelivery()
            // Name both attempts so Recording error details separate a second lost receipt from another retry failure.
            throw new Error(
              retryError instanceof ViewportAckTimeoutError
                ? `${VIEWPORT_ACK_TIMEOUT_REASON} again after one same-frame retry. First attempt: ${firstAttempt}. Retry: ${retry}.`
                : `${VIEWPORT_ACK_TIMEOUT_REASON}; the same-frame retry then failed: ${String(retryError)}. First attempt: ${firstAttempt}. Retry: ${retry}.`,
            )
          }
        }
      } else
        await viewport.presentMissing(
          bundle.projection.missing ?? 'No recorded application image.',
          signal,
        )
      signal.throwIfAborted()
      this.host.playbackPresentingReady = true
      this.host.replayApplicationCovered = false
      this.host.lastRendered = undefined
      this.host.lastPublished = undefined
      this.host.publish()
      const revision = this.host.revision,
        presentationRevision = this.host.playback!.state().presentationRevision
      await waitUntil(
        () =>
          (this.host.summaryComposition && !this.host.summaryView?.visible) ||
          (this.host.lastRendered?.revision === revision &&
            this.host.lastRendered.presentationRevision ===
              presentationRevision &&
            this.host.lastRendered.snapshotUri ===
              bundle.projection.observation?.snapshotUri),
        'matching recorded context presentation',
        CAPTURE_TIMEOUT_MS,
        signal,
      )
      signal.throwIfAborted()
    } finally {
      signal.removeEventListener('abort', endSupersededPaint)
      this.endReplayPaint(paint)
    }
  }

  /**
   * Marks the start of a replay frame's paint phase for {@link settleOwnedPlayback}'s paint bound.
   *
   * {@link presentPlayback} calls it after native debugger presentation resolved, just before the viewport delivery.
   *
   * @returns This phase's token; only {@link endReplayPaint} with the same token ends it, so a superseded presentation that finishes late cannot end a newer phase.
   * @example const paint = this.beginReplayPaint()
   */
  private beginReplayPaint(): object {
    const paint = {}
    this.host.replayPaint = { token: paint, startedAt: performance.now() }
    for (const watch of [...this.host.replayPaintWatchers]) watch()
    return paint
  }

  /**
   * Ends the paint phase that {@link beginReplayPaint} started, on every exit of {@link presentPlayback}.
   * @param paint - Token returned when this phase began.
   * @example this.endReplayPaint(paint)
   */
  private endReplayPaint(paint: object): void {
    if (this.host.replayPaint?.token !== paint) return
    this.host.replayPaint = undefined
    for (const watch of [...this.host.replayPaintWatchers]) watch()
  }

  /**
   * Retains the newest replay viewport delivery receipts for {@link presentPlayback}'s failure details.
   *
   * Passed as the recording {@link BrowserViewport}'s record callback; it never affects delivery or paint.
   *
   * @param type - Receipt name emitted by {@link BrowserViewport} or {@link FrameDelivery}.
   * @param detail - Receipt detail; only non-image fields are later summarized.
   *
   * @example
   * ```ts
   * this.recordReplayDelivery('viewport.sent', { id: 3 }) // replayDelivery.receipts ends with that receipt
   * ```
   */
  private recordReplayDelivery(type: string, detail?: unknown): void {
    this.replayDelivery.receipts.push({ type, detail })
    // Keep memory bounded; dropped receipts are counted so the summary never implies completeness.
    if (this.replayDelivery.receipts.length > REPLAY_VIEWPORT_RECEIPT_LIMIT) {
      this.replayDelivery.receipts.shift()
      this.replayDelivery.omitted++
    }
  }

  /**
   * Describes the current replay attempt's receipts plus native panel visibility, then starts a fresh attempt log.
   *
   * Called by {@link presentPlayback} after a recorded frame's paint receipt, re-handshake or retry fails.
   *
   * @returns Summary such as `sent #1; received (hidden, no area); rejected #1: …; panel visible`.
   *
   * @example
   * ```ts
   * const firstAttempt = this.drainReplayDelivery() // => 'no renderer receipts; panel hidden'
   * ```
   */
  private drainReplayDelivery(): string {
    const summary = `${describeViewportDelivery(this.replayDelivery)}; panel ${this.host.app?.visible ? 'visible' : 'hidden'}`
    this.replayDelivery = { receipts: [], omitted: 0 }
    return summary
  }
}

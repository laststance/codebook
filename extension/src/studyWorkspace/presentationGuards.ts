import * as vscode from 'vscode'

import {
  LEARNER_SELECTION_KINDS,
  LEARNER_STARTED_STOP_REASONS,
  PAUSE_FOCUS_LOOKBACK_MS,
  PRESENTATION_READY_TIMEOUT_MS,
  READ_ENDED_FOR_AGENT_KEYBOARD_MESSAGE,
  REPOSITORY_SOURCE_SCHEME,
  OWN_EFFECT_NOISE_WINDOW_MS,
  UNMAXIMIZE_FOCUS_SETTLE_MS,
} from '../constants'
import { StudyError } from '../errors'
import { type PlaybackBundle } from '../playbackController'
import {
  type PresentationIntent,
  type PresentationRequester,
  type PresentationState,
} from '../presentationSchemas'
import type { RepositoryFocusTarget } from '../repositoryReader'
import type { RuntimeParticipant, RuntimeView, StudyRuntime } from '../runtime'
import { codebookStopLedger } from '../runtimeSupport/codebookStopLedger'
import { StoredDebugStops } from '../runtimeSupport/storedDebugStops'
import { debugStopOf } from '../runtimeSupport/utils/debugStopOf'
import { heldStopSessionOf } from '../runtimeSupport/utils/heldStopSessionOf'
import { isDebugResumeMessage } from '../runtimeSupport/utils/isDebugResumeMessage'
import { isDebugStopsInvalidation } from '../runtimeSupport/utils/isDebugStopsInvalidation'
import { isStackFrameItem } from '../runtimeSupport/utils/isStackFrameItem'
import { pausedEditorOfStop } from '../runtimeSupport/utils/pausedEditorOfStop'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { StudyRecord } from '../service'
import type { StudyWorkspace } from '../studyWorkspace'
import { editorLayoutGroupCount } from '../utils/editorLayoutGroupCount'
import { editorShowsDocument } from '../utils/editorShowsDocument'
import { focusEditorGroupCommand } from '../utils/focusEditorGroupCommand'
import { foreignPreviewObstacle } from '../utils/foreignPreviewObstacle'
import { isChatEditorTabInput } from '../utils/isChatEditorTabInput'
import { isCodebookPaneViewType } from '../utils/isCodebookPaneViewType'
import { isEditorUncoveredByMove } from '../utils/isEditorUncoveredByMove'
import { pruneClosedTabRecord } from '../utils/pruneClosedTabRecord'
import { retainEditorReadingPosition } from '../utils/retainEditorReadingPosition'
import {
  type LearnersChoice,
  sameLearnersChoiceTarget,
} from '../utils/sameLearnersChoiceTarget'
import { tabWithoutEditorObstacle } from '../utils/tabWithoutEditorObstacle'
import { textEditorFocusState } from '../utils/textEditorFocusState'

import type { PresentationGuardsHost } from './presentationGuardsHost'
import {
  type LeftoverTabClose,
  type KeyboardPauseOfRecord,
  type ChatKeyboardReturnCause,
  tellKeyboardNoticeOnce,
  STUDY_PANE_KINDS,
} from './support'

/**
 * Guards a presentation (admission, focus, placed evidence, pauses) and watches the learner's own input (keyboard, selections, group moves), so these checks are read apart from the entry and placement code of {@link StudyWorkspace}.
 *
 * The workspace builds one in a field initialiser with a host from {@link createPresentationGuardsHost}; every member other code calls stays on the workspace as a one-line delegate with the same name and signature.
 *
 * @example
 * private readonly presentationGuards = new PresentationGuards(createPresentationGuardsHost(this))
 */
export class PresentationGuards {
  constructor(private readonly host: PresentationGuardsHost) {}

  /** The stops each followed debug session's adapter reported, per thread, as the editors store them for their stop handling ({@link StoredDebugStops}): an `invalidated` event makes the editor handle the stored stops again, its `preserveFocusHint`, thread and reason included, so {@link readAdaptersMessage} notes the stop again from them (Cycle 0046 R5); a thread's stop is dropped as the editors drop it, at its thread's `continued` or a successful resume or step of it (AD12). {@link forgetSession} drops a session's. */
  private readonly storedStops = new StoredDebugStops()

  /** The file and the editor group of the preview tab that was in front of the active group when the editor reported the stack item it shows now, if any; {@link keptPreviewTabOfFrame} reads from it whether the learner has kept that tab open since. The tab is known by its document and view column, never by its object: Cursor's extension host builds every tab object anew whenever the editor sends its whole tab model, and an object taken before then keeps answering what it answered last. */
  private previewTabOfFrame?: { uri: string; column: vscode.ViewColumn }

  private observedEditorGroups: {
    group: vscode.TabGroup
    column: vscode.ViewColumn
    /** How many tabs the group held when it was recorded; an object the editor keeps can change its tabs afterwards. */
    tabCount: number
  }[] = []

  /**
   * Waits until the editor's tab model and its active text editor agree after leftover tabs closed, because the editor reports the two separately; called by {@link selectAfterClosingLeftoverTabs} before the selection is admitted on what remains.
   * A wait that expires or is cancelled ends quietly and leaves the decision to the admission.
   * @param closedSourceUris - Documents of the captured-source tabs that closed; the active text editor may still report one.
   * @param signal - The pending selection's cancellation; a reader close ends the wait.
   * @example
   * ```ts
   * await this.waitForEditorAfterClose(closed.closedSourceUris, transition.cancellation.signal)
   * ```
   */
  private async waitForEditorAfterClose(
    closedSourceUris: string[],
    signal: AbortSignal,
  ): Promise<void> {
    await waitUntil(
      () => {
        const activeInput =
            vscode.window.tabGroups.activeTabGroup.activeTab?.input,
          shownUri = vscode.window.activeTextEditor?.document.uri.toString()
        // A text tab needs its own text editor; any other tab needs the text editor of a tab that just closed to be gone.
        return activeInput instanceof vscode.TabInputText
          ? shownUri === activeInput.uri.toString()
          : shownUri === undefined || !closedSourceUris.includes(shownUri)
      },
      'the active text editor after closing leftover tabs',
      PRESENTATION_READY_TIMEOUT_MS,
      signal,
    ).catch(() => undefined)
  }

  /**
   * Refuses a mode other than the Study workspace while a live explanation or a replay owns the layout; called by {@link admitPresentation} and, before any leftover tab closes, by {@link assertSelectionOutlastsClose}.
   * @param input - The requested change.
   * @throws `PRESENTATION_UNAVAILABLE` for another mode or a preference save during live or replay; nothing otherwise.
   * @example
   * ```ts
   * this.assertCompositionAllows(input) // throws for mode 'living-book' during a live explanation
   * ```
   */
  assertCompositionAllows(input: PresentationIntent): void {
    if (
      this.host.hasComposition() &&
      (input.mode !== 'study-workspace' || input.action === 'save-preference')
    )
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Live and replay use one app/source layout with the chat or learning summary in the sidebar.',
      )
  }

  /**
   * Says whether a tab is one of the tabs {@link leftoverTabs} lists, which are about to close; asked by {@link assertSelectionOutlastsClose} of the focused tab, and only for a selection no composition owns.
   * @param tab - The active tab of the active group, `undefined` when that group shows none.
   * @returns `true` for a leftover tab; `false` for any other tab, and for no tab, for which the leftover tabs are not listed at all.
   * @example
   * ```ts
   * this.isLeftoverTab(vscode.window.tabGroups.activeTabGroup.activeTab) // => true while a dead Application pane has the focus
   * ```
   */
  private isLeftoverTab(tab: vscode.Tab | undefined): boolean {
    return Boolean(tab && this.host.leftoverTabs().includes(tab))
  }

  /**
   * Gives, before any leftover tab closes, the refusals {@link admitPresentation} would give a closed reader's selection after the close; called by {@link selectAfterClosingLeftoverTabs}, so a selection refused for its mode, its runtime state or its focus changes nothing in the window.
   * An open reader is not rehearsed: only dead panes close for it, and its admission has paths that keep no focus.
   * @param input - The `select` request.
   * @throws `PRESENTATION_UNAVAILABLE` as the admission would.
   * @example
   * ```ts
   * this.assertSelectionOutlastsClose(input) // throws while the editor's Settings page has focus
   * ```
   */
  private assertSelectionOutlastsClose(input: PresentationIntent): void {
    if (this.host.opened) return
    this.host.assertCompositionAllows(input)
    this.host.assertPresentationAdmission()
    const focusedTab = vscode.window.tabGroups.activeTabGroup.activeTab
    // Live and replay keep the focused pane by their own rule, and a focused tab that is about to close has no focus to keep; every other closed-reader selection must be able to give the focus back.
    if (!this.host.hasComposition() && !this.isLeftoverTab(focusedTab))
      this.host.capturePresentationFocus(undefined)
  }

  /**
   * Closes the captured-source tabs and dead Codebook panes an earlier host session left behind, then admits the selection once on what remains; called by {@link admitPresentation}.
   * The pending transition refuses other presentation controls while the tabs close, and a reader close ends the wait. When a captured-source tab stays, the ordinary admission reports that the active editor cannot be restored, with this reason as its cause.
   * @param input - The `select` request that met a leftover tab.
   * @param requester - Who asked for the selection ({@link changePresentation}); the admission after the close keeps it.
   * @returns The state of the admitted selection.
   * @throws The admission's own errors, given before any tab closes where {@link assertSelectionOutlastsClose} can decide them; `PRESENTATION_UNAVAILABLE` when the leftover tab is still active, or when a dead pane could not be closed (no panel is created then; the dead and leftover tabs of other groups may already have closed).
   * @example
   * ```ts
   * const state = await this.selectAfterClosingLeftoverTabs(input, 'learner') // state.layoutConfirmed === true
   * ```
   */
  private async selectAfterClosingLeftoverTabs(
    input: PresentationIntent,
    requester: PresentationRequester,
  ): Promise<PresentationState> {
    const lifetime = this.host.lifetime,
      transition = {
        id: this.host.presentationId,
        cancellation: new AbortController(),
      }
    let closed: LeftoverTabClose
    this.host.presentationTransition = transition
    try {
      // The library key exists only after initialization, so ownership is decided here and not by the caller's synchronous check.
      await this.host.initialize()
      this.host.assertLifetime(lifetime)
      this.assertSelectionOutlastsClose(input)
      // Read before the close's proof of the earlier window's groups moves the keyboard: the chat that had it gets it back below.
      const giveKeyboardBack = this.host.retainForeignTabFocus(undefined)
      closed = await this.host.closeLeftoverTabs(transition.cancellation.signal)
      if (this.isEditorSettlingAfter(closed))
        await this.waitForEditorAfterClose(
          closed.closedSourceUris,
          transition.cancellation.signal,
        )
      // The admission below reads the focus again: it finds the chat where the selection found it (row 608), and the learner is told why the chat has it (row 648).
      if (closed.proofTookKeyboard)
        await giveKeyboardBack?.(
          true,
          undefined,
          closed.proofTookKeyboard,
        ).catch(() => false)
    } finally {
      this.host.endPresentationTransition(transition)
    }
    this.host.assertLifetime(lifetime)
    // A dead pane that stays would pass for this reader's own Application or Study tab, so the selection ends here, before any panel exists.
    if (closed.deadPaneKept)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'A Codebook pane left by an earlier extension session is still open. Close the leftover Application, Study and Repository Wiki tabs, then select the presentation again.',
        'A leftover Codebook pane could not be closed.',
      )
    // The transition is released in this same turn, so no other control is admitted between it and this second, final admission.
    try {
      return this.host.admitPresentation(input, closed, requester)
    } catch (error) {
      // Only the synchronous refusal gains the reason; later failures of the admitted change keep their own cause.
      throw this.refusalNamingKeptSource(error, closed)
    }
  }

  /**
   * Says whether the editor still has to bring its tab model and its active text editor into agreement after leftover tabs closed; asked by {@link selectAfterClosingLeftoverTabs} right after the close, before it waits through {@link waitForEditorAfterClose}.
   * @param closed - What {@link closeLeftoverTabs} reported.
   * @returns `true` when a tab closed and no dead pane stayed; `false` when nothing closed, and when a dead pane stayed, because the selection then ends without an admission.
   * @example
   * ```ts
   * this.isEditorSettlingAfter({ closedAny: true, closedSourceUris: [], capturedSourceKept: false, deadPaneKept: false }) // => true
   * ```
   */
  private isEditorSettlingAfter(closed: LeftoverTabClose): boolean {
    return closed.closedAny && !closed.deadPaneKept
  }

  /**
   * Gives the error a selection ends with when its admission after the close refused; called by the failure handler of {@link selectAfterClosingLeftoverTabs} with what {@link admitPresentation} threw.
   * @param error - What the admission threw synchronously.
   * @param closed - What {@link closeLeftoverTabs} reported.
   * @returns A new `PRESENTATION_UNAVAILABLE` refusal with the same message and the kept tab as its cause, when a captured-source tab stayed and the admission refused with that code; otherwise `error` itself.
   * @example
   * ```ts
   * throw this.refusalNamingKeptSource(error, closed) // causeDetail: 'A leftover captured source tab could not be closed.'
   * ```
   */
  private refusalNamingKeptSource(
    error: unknown,
    closed: LeftoverTabClose,
  ): unknown {
    // A refusal met while a captured-source tab stayed open names that tab as its cause.
    if (
      closed.capturedSourceKept &&
      error instanceof StudyError &&
      error.code === 'PRESENTATION_UNAVAILABLE'
    )
      return new StudyError(
        error.code,
        error.message,
        'A leftover captured source tab could not be closed.',
      )
    return error
  }

  /**
   * Admits one presentation change for {@link changePresentation}. Every refusal it decides by itself is thrown before any native effect; only a selection that meets tabs of an earlier host session first closes those tabs through {@link selectAfterClosingLeftoverTabs}, which gives the refusals it can foresee before the close.
   * @param input - The requested change with the reader lifetime and control revision it was made for.
   * @param leftoverTabs - `'pending'` on the first entry; on the single re-entry after {@link selectAfterClosingLeftoverTabs} what {@link closeLeftoverTabs} reported. Only its `closedFocus` changes the admission: the tab the editor activated in place of the closed focused tab is accepted as the place to return to.
   * @param requester - Who asked for the change ({@link changePresentation}); every re-entry of the same request keeps it.
   * @param fromPane - Whether a control of a Study pane or view asked for the change ({@link changePresentation}); an arrangement of the live or recording panes without such a press reads a Study pane's tab named without an active pane as the chat's place ({@link retainForeignTabFocus}, rows 628 and 638).
   * @returns The state after the admitted change.
   * @throws When the request is stale, competes with a pending change, comes from a background window, or cannot keep the learner's focus.
   * @example
   * ```ts
   * return this.admitPresentation(input, 'pending', 'learner')
   * ```
   */
  admitPresentation(
    input: PresentationIntent,
    leftoverTabs: 'pending' | LeftoverTabClose,
    requester: PresentationRequester,
    fromPane = requester === 'learner',
  ): Promise<PresentationState> {
    if (input.presentationId !== this.host.presentationId)
      throw new StudyError(
        'PRESENTATION_INSTANCE_GONE',
        'The named reader lifetime has ended.',
      )
    if (input.expectedRevision !== this.host.presentationControlRevision)
      throw new StudyError(
        'STALE_PRESENTATION',
        'The presentation control revision changed.',
      )
    this.host.assertPresentationIdle()
    this.host.assertLifetime(this.host.lifetime)
    if (input.action !== 'save-preference' && !vscode.window.state.focused)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Focus this Codebook work window before changing its presentation.',
      )
    const activeInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    // A pane an earlier extension host left behind would pass for this reader's own, and a focused captured-source tab that no text editor shows has no focus that could be kept; a selection closes such tabs before it is admitted. Which captured-source tabs are leftovers is decided by {@link leftoverTabs} once the library key is known.
    if (
      leftoverTabs === 'pending' &&
      input.action === 'select' &&
      (this.host.deadPaneTabs().length > 0 ||
        (this.host.isCapturedSourceInput(activeInput) &&
          vscode.window.activeTextEditor?.document.uri.toString() !==
            activeInput.uri.toString()))
    )
      return this.selectAfterClosingLeftoverTabs(input, requester)
    if (input.action === 'focus') return this.focusCurrentPresentation(input)
    // A test replay in the summary composition has no recording to arrange: its Restore shows its slot again, as in the Study composition (Cycle 0051, DS-A; F413).
    if (
      this.host.summaryComposition &&
      this.host.isTestReplayRestore(input, this.host.presentationState())
    )
      return this.host.restoreTestReplayArrangement()
    if (this.host.liveComposition || this.host.summaryComposition) {
      this.host.assertCompositionAllows(input)
      // Selecting the arrangement that is confirmed already changes nothing: it is read once more without taking the focus, and only a layout that no longer holds is arranged again.
      if (
        input.action === 'select' &&
        this.host.presentationState().layoutConfirmed
      )
        return this.host.confirmCompositionNoop(input, requester)
      const transition = {
        id: this.host.presentationId,
        cancellation: new AbortController(),
        runtimeIdentity: this.host.assertPresentationAdmission(),
      }
      const knowsKeyboardPlace = this.host.knowsKeyboardPlaceAtAdmission()
      const focusedPane = this.host.trackFocusedStudyPane(),
        lifetime = this.host.lifetime,
        // A refusal after Codebook focused the main editor's first group is told that nothing was arranged (row 738).
        borrowsBefore = this.host.focusBorrowCount()
      // The arrangement notes its own refusal for the learner's newer input, as a presentation change does (row 738).
      this.host.presentationYieldedToLearner = false
      // A press in a Codebook view (no Study pane is pressed) reads like the command: the view keeps no tab the measurement could give back (row 647).
      const returnForeignFocus = this.host.retainForeignTabFocus(
        undefined,
        !this.isPressInStudyPane(fromPane),
      )
      const recordedBundle = this.host.recordingActive
        ? this.host.playback?.bundle()
        : undefined
      this.host.presentationTransition = transition
      this.host.presentationControlRevision++
      const pending = (async () => {
        try {
          // Read/Enlarge may hide the other main leaf; restore visibility before measuring the two-pane layout. A chat tab that had the keyboard gets it back below.
          await focusedPane.endReadMaximization(() =>
            this.endReadForAdmission(
              requester,
              knowsKeyboardPlace || Boolean(returnForeignFocus),
            ),
          )
          this.host.assertLifetime(lifetime)
          transition.cancellation.signal.throwIfAborted()
          focusedPane.assertCurrent()
          const recoveredCoveredReplay = await this.revealCoveredReplay(
            input.action,
            transition.cancellation.signal,
            focusedPane.beforeScopeFocus,
          )
          this.host.assertLifetime(lifetime)
          focusedPane.assertUndeparted()
          await this.host.arrange(
            transition.cancellation.signal,
            'study',
            false,
            undefined,
            focusedPane.beforeScopeFocus,
          )
          // An arrangement that applied its layout owes no sizes any more; one that arranged nothing (beside a group of the learner's) leaves the groups as an Expand of the reader's left them, and they get their sizes back.
          await this.host.giveGroupSizesBackAfterExpand(() =>
            focusedPane.assertUndeparted(),
          )
          // The measurement may have left the focus in the main editor; the editor part that held the keyboard (an agent chat) gets it back. The editor does not report that return as a change of its tab groups, so the watched focus is checked for a learner's change before it and not for its return after it.
          if (returnForeignFocus) {
            focusedPane.assertUndeparted()
            focusedPane.dispose()
            await returnForeignFocus()
          }
          this.host.assertLifetime(lifetime)
          transition.cancellation.signal.throwIfAborted()
          if (!returnForeignFocus)
            this.assertCompositionFocus(focusedPane, recoveredCoveredReplay)
          this.assertPlacedEvidenceUnchanged(
            transition.runtimeIdentity,
            recordedBundle,
          )
          this.host.confirmCompositionByReceipt()
        } catch (error) {
          this.host.presentationConfirmed = false
          this.host.presentationReason = String(error)
          await this.returnForeignFocusAfterFailure(
            focusedPane,
            returnForeignFocus,
            lifetime,
            borrowsBefore,
          )
          throw error
        } finally {
          focusedPane.dispose()
          this.host.endPresentationTransition(transition)
          this.host.presentationYieldedToLearner = false
          this.host.publish()
        }
        return this.host.confirmedCompositionState()
      })().finally(() => {
        if (this.host.presentationOperation === pending)
          this.host.presentationOperation = undefined
      })
      this.host.presentationOperation = pending
      return pending
    }
    const state = this.host.presentationState()
    // An Enlarge's Restore, and a test replay's (which has no article source for the placement below), are answered by the retained layout itself (F413).
    const retainedRestore = this.host.restoreRetainedLayout(
      input,
      state,
      requester,
    )
    if (retainedRestore) return retainedRestore
    // Selecting the current arrangement repairs geometry without replacing panes or touching foreign previews.
    if (
      (input.action === 'restore' || input.action === 'select') &&
      input.mode === 'study-workspace' &&
      input.mode === state.mode &&
      !state.layoutConfirmed &&
      this.host.hasStudyPaneColumns() &&
      (this.host.app?.active ||
        this.host.contextPanel?.active ||
        vscode.window.activeTextEditor?.document.uri.toString() ===
          this.host.sourceUri?.toString())
    )
      return this.restoreStudyArrangement(input, requester)
    // A restore of the confirmed layout made while no Study pane and no text editor has the keyboard (an agent's call from the chat, right after its own selection) is answered like that selection: nothing is arranged again and the keyboard stays where it is.
    if (
      (input.action === 'select' ||
        (input.action === 'restore' &&
          !this.host.app?.active &&
          !this.host.contextPanel?.active &&
          !vscode.window.activeTextEditor)) &&
      input.mode === state.mode &&
      state.layoutConfirmed &&
      state.preference.status !== 'unknown'
    )
      return this.host.confirmPresentationNoop(input, requester)
    if (
      input.action === 'save-preference' &&
      (input.mode !== state.mode || !state.layoutConfirmed)
    )
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Only the current confirmed layout can save its preference. Restore the layout first.',
      )
    const runtimeIdentity =
      input.action === 'save-preference'
        ? undefined
        : this.host.assertPresentationAdmission()
    const activatedByClose =
      leftoverTabs === 'pending'
        ? undefined
        : leftoverTabs.closedFocus?.activatedTab
    const restoreFocus =
      input.action === 'save-preference'
        ? undefined
        : this.host.capturePresentationFocus(activatedByClose)
    const returnForeignFocus =
      input.action === 'save-preference'
        ? undefined
        : this.host.retainForeignTabFocus(activatedByClose)
    const transition = {
      id: this.host.presentationId,
      cancellation: new AbortController(),
      runtimeIdentity,
    }
    this.host.presentationTransition = transition
    this.host.presentationControlRevision++
    this.host.requestedPresentation = input.mode
    this.host.presentationReason = undefined
    const pending = this.host
      .performPresentation(
        input,
        transition,
        restoreFocus,
        returnForeignFocus,
        requester,
      )
      .finally(() => this.settlePresentation(transition, pending))
    this.host.presentationOperation = pending
    this.host.publish()
    return pending
  }

  /**
   * Clears a finished presentation transition and operation, then publishes, for {@link admitPresentation} and {@link focusCurrentPresentation}.
   * @param transition - The transition the finished operation started; cleared only while it is still current.
   * @param pending - The operation promise; cleared only while it is still current.
   * @example .finally(() => this.settlePresentation(transition, pending))
   */
  private settlePresentation(
    transition: object,
    pending: Promise<unknown>,
  ): void {
    // A newer transition or operation owns the field now: leave it alone.
    if (this.host.presentationTransition === transition)
      this.host.presentationTransition = undefined
    if (this.host.presentationOperation === pending)
      this.host.presentationOperation = undefined
    this.host.publish()
  }

  /** Lets explicit MCP recovery return from another editor to the existing explanation without changing layout or execution. @example await this.focusCurrentPresentation(input) */
  private focusCurrentPresentation(
    input: PresentationIntent,
  ): Promise<PresentationState> {
    const panel =
      this.host.liveComposition || this.host.summaryComposition
        ? this.host.app
        : this.host.contextPanel
    if (
      !this.host.opened ||
      !panel ||
      input.mode !== this.host.presentationState().mode
    )
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Focus requires an open Study and its current mode. Read presentation state first.',
      )
    const transition = {
      id: this.host.presentationId,
      cancellation: new AbortController(),
    }
    this.host.presentationTransition = transition
    this.host.presentationControlRevision++
    // Latch even a temporary window departure; returning does not renew this request.
    const windowFocus = vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused)
        transition.cancellation.abort(
          new Error('The Codebook work window lost focus.'),
        )
    })
    const pending = this.host
      .focusPresentationPanel(panel, transition.cancellation.signal)
      .then(() => this.host.presentationState())
      .catch((error: unknown) => {
        throw new StudyError(
          'PRESENTATION_UNAVAILABLE',
          'Study focus could not be confirmed. Read current presentation state before retrying.',
          String(error),
        )
      })
      .finally(() => {
        windowFocus.dispose()
        this.settlePresentation(transition, pending)
      })
    this.host.presentationOperation = pending
    this.host.publish()
    return pending.then(() => this.host.presentationState())
  }

  /**
   * Recovers covered replay for {@link admitPresentation} before explicit arrangement confirms its source.
   * @param action - Saving a preference must not reveal a pane the learner covered.
   * @param signal - Cancels recovery when the placement loses ownership.
   * @param beforeScopeFocus - Announces this App and its captured source, which native historical debugging may focus during recovery.
   * @returns Whether the arrangement replaced a covering tab with its recorded Application.
   * @throws When visibility or the same recorded frame cannot settle within the existing placement bounds.
   * @example await this.revealCoveredReplay('restore', signal, focusedPane.beforeScopeFocus)
   */
  private async revealCoveredReplay(
    action: PresentationIntent['action'],
    signal: AbortSignal,
    beforeScopeFocus: ReturnType<
      StudyWorkspace['trackFocusedStudyPane']
    >['beforeScopeFocus'],
  ): Promise<boolean> {
    const recordedApplication = this.host.app
    // Other compositions and preference saves retain the learner's current native tab.
    if (!this.mayRevealCoveredReplay(action) || !recordedApplication)
      return false
    const recordedSource = this.host.sourceUri?.toString(),
      recordedSourceColumn = this.host.studyPanePositions().sourceColumn
    // Freeze the captured target before recovery so another source file cannot become the borrow.
    const matchesRecordedEditor = (): boolean =>
      recordedSource !== undefined &&
      vscode.window.activeTextEditor?.viewColumn === recordedSourceColumn &&
      vscode.window.activeTextEditor?.document.uri.toString() === recordedSource
    const matchesRecordedSourceGroup = (): boolean => {
      const group = vscode.window.tabGroups.activeTabGroup,
        input = group.activeTab?.input
      return (
        group.viewColumn === recordedSourceColumn &&
        input instanceof vscode.TabInputText &&
        input.uri.toString() === recordedSource
      )
    }
    const matchesRecordedAppGroup = (): boolean => {
      const group = vscode.window.tabGroups.activeTabGroup
      return (
        group.viewColumn === recordedApplication.viewColumn &&
        this.host.isCodebookPaneInput(
          group.activeTab?.input,
          'codebook.scopedBrowser',
        )
      )
    }
    const retainsRecordedApp = (): boolean =>
      recordedApplication === this.host.app
    beforeScopeFocus({
      matchesEditor: () =>
        recordedApplication.active || matchesRecordedEditor(),
      // The owned tab can precede its visible receipt; source recovery still requires the App to be visible.
      matchesGroup: () =>
        retainsRecordedApp() &&
        (matchesRecordedAppGroup() ||
          (recordedApplication.visible && matchesRecordedSourceGroup())),
    })
    this.host.revealPane(
      recordedApplication,
      recordedApplication.viewColumn,
      true,
    )
    await waitUntil(
      () =>
        recordedApplication === this.host.app && recordedApplication.visible,
      'recorded Application visibility during Restore',
      PRESENTATION_READY_TIMEOUT_MS,
      signal,
    )
    await this.host.settleOwnedPlayback(signal)
    return true
  }

  /**
   * Limits {@link revealCoveredReplay} to explicit arrangement of a covered Summary recording.
   * @param action - A preference save retains the learner's covering tab.
   * @returns Whether the current composition permits visibility recovery.
   * @example this.mayRevealCoveredReplay('restore') // true for a covered saved recording
   */
  private mayRevealCoveredReplay(
    action: PresentationIntent['action'],
  ): boolean {
    return (
      this.host.summaryComposition &&
      this.host.replayApplicationCovered &&
      action !== 'save-preference'
    )
  }

  /**
   * Says whether a presentation change came from a press in the Study pane itself, whose tab the arrangement's measurement gives its focus back; asked by the composition branch of {@link admitPresentation} before it remembers a foreign tab (row 647).
   * A press in a Codebook view of a side bar or the panel (the Learning summary) leaves the editor naming whatever tab it named before, and beside Cursor's chat part, which stays the active editor part after a click into a view (Cursor 3.23.12 `workbench.desktop.main.js` 17501:84373, 17501:88693), that is the tab Cursor's Focus Agent left named: such a press reads like the command run from the Command Palette, whose named Study pane's tab is the chat's place.
   * @param fromPane - Whether a control of a Study pane or view asked for the change ({@link changePresentation}).
   * @returns `true` when a pane or view asked and the Study pane is active or reports the keyboard ({@link reportsKeyboard}); `false` for a command, and for a press in a view.
   * @example this.isPressInStudyPane(true) // => false for the Restore of the Learning summary while Cursor's chat part is the active one
   */
  private isPressInStudyPane(fromPane: boolean): boolean {
    const studyPane = this.host.contextPanel
    return (
      fromPane &&
      studyPane !== undefined &&
      (studyPane.active || this.host.reportsKeyboard(studyPane))
    )
  }

  /**
   * Verifies native focus for {@link admitPresentation} after layout measurement.
   * @param focusedPane - Watches departures throughout the admitted arrangement.
   * @param recoveredReplay - The declared App replacement remains an owned focus borrow.
   * @example this.assertCompositionFocus(focusedPane, false) // requires the original native target
   */
  private assertCompositionFocus(
    focusedPane: ReturnType<StudyWorkspace['trackFocusedStudyPane']>,
    recoveredReplay: boolean,
  ): void {
    // A covering file is intentionally replaced only by the announced recorded Application.
    if (recoveredReplay) focusedPane.assertUndeparted()
    else focusedPane.assertCurrent()
  }

  /**
   * Refuses an arrangement of the live or recording panes when what it shows changed while the panes were placed; called by the composition branch of {@link admitPresentation} once the arrangement and the focus return have ended.
   * @param runtimeIdentity - The identity {@link assertPresentationAdmission} gave when the arrangement was admitted.
   * @param recordedBundle - The recording's moment at admission; `undefined` outside a recording.
   * @throws `PRESENTATION_UNAVAILABLE` when a run's pause is another one now, or the recording shows another moment; and what {@link assertPresentationAdmission} throws for a run that is no longer stable.
   * @example this.assertPlacedEvidenceUnchanged(transition.runtimeIdentity, recordedBundle)
   */
  private assertPlacedEvidenceUnchanged(
    runtimeIdentity: string,
    recordedBundle: PlaybackBundle | undefined,
  ): void {
    if (runtimeIdentity !== this.host.assertPresentationAdmission())
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'The live pause changed during presentation placement.',
      )
    if (recordedBundle && recordedBundle !== this.host.playback?.bundle())
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'The recorded moment changed during presentation placement.',
      )
  }

  /**
   * Gives the keyboard back to the editor part that held it (an agent chat) when an arrangement of the live or recording panes failed; called by the failure path of the composition branch of {@link admitPresentation}, as a failed selection and a failed open do.
   * @param focusedPane - The focus watch of that arrangement: a focus the learner changed since the request stays where it is.
   * @param returnForeignFocus - What {@link retainForeignTabFocus} answered before the arrangement, `undefined` when no foreign tab had the focus.
   * @param lifetime - The reader lifetime the arrangement began in; a reader closed or closing since gives nothing back ({@link assertLifetime}).
   * @param borrowsBefore - {@link focusBorrowCount} when the arrangement was admitted: a chat given its keyboard back after Codebook focused the main editor's first group since is told that nothing was arranged (`'refusedArrangement'` of {@link CHAT_KEYBOARD_RETURNED_MESSAGES}; Cycle 0046 row 738, as rows 718, 731 and 736).
   * @returns Once the focus is given back or left: nothing is thrown, so that the arrangement's own error is the one reported. A refusal for the learner's newer input ({@link presentationYieldedToLearner}) gives nothing back, as a presentation change's does (rows 732 and 738).
   * @example
   * ```ts
   * await this.returnForeignFocusAfterFailure(focusedPane, returnForeignFocus, lifetime, borrowsBefore)
   * throw error
   * ```
   */
  private async returnForeignFocusAfterFailure(
    focusedPane: ReturnType<StudyWorkspace['trackFocusedStudyPane']>,
    returnForeignFocus: ReturnType<StudyWorkspace['retainForeignTabFocus']>,
    lifetime: number,
    borrowsBefore: number,
  ): Promise<void> {
    // The learner's newer input that refused the arrangement keeps the keyboard, untold.
    if (this.host.presentationYieldedToLearner) return
    // Without a borrow since the admission the return's own rule decides its sentence.
    const chatCause =
      this.host.focusBorrowCount() !== borrowsBefore
        ? 'refusedArrangement'
        : undefined
    try {
      this.host.assertLifetime(lifetime)
      focusedPane.assertUndeparted()
      await returnForeignFocus?.(false, undefined, chatCause)
    } catch {
      // A reader that is closed or closing, a newer focus of the learner, or a return the editor refused leaves the keyboard where it is.
    }
  }

  /**
   * Says whether {@link assertPresentationAdmission} would admit a presentation change now, without throwing; asked by {@link restoresDisplacedCapturedSource}.
   * @returns `false` while a control, a save, a source or navigation, or a run's capture or resume is pending.
   * @example if (this.isPresentationAdmissionOpen()) this.returnDisplacedCapturedSourceThenAdmit(…)
   */
  isPresentationAdmissionOpen(): boolean {
    try {
      this.host.assertPresentationAdmission()
      return true
    } catch {
      return false
    }
  }

  /**
   * Starts watching what the learner chooses while the return shows the captured source in its Study column (the first show, and the hand-off that takes the moved copy's keyboard): a text file (the active text editor changes), a tab that is no text file (a Settings page, seen as the front tab of the active group, also when only the group changed), and a switch away from the window. Called by {@link returnDisplacedCapturedSourceThenAdmit}.
   * A diff side reports no view column: its file is not shown again (that would duplicate it in the source column); its group and front tab are the choice. The effects of showing a choice again are the return's own and are not recorded as new picks ({@link ignoreOwnEffectOf}), so a newer pick made while the choice is shown again is the only one that follows it.
   * The captured source's activation in the source column is Codebook's own show and no choice; the same document in any other column is a pick (the learner chose the moved copy). The tab in front of the active group when the watch starts is no pick either, as the editor reports it again (Cursor does) or its tab events fire while the source opens, until a different pick has been recorded: then choosing it again is one.
   * @param sourceUri - The captured source's URI.
   * @param sourceColumn - The Study source column, where the return itself shows the source.
   * @param isRequestsOwnFocus - Whether a tab in front is the request's own focus and no pick (the Study pane after a press in it); none by default.
   * @returns The picks in order, the window-switch latch, the own-effect filter and the disposal of the listeners.
   * @example const watch = this.watchLearnersChoice(sourceUri, 2); try { await show() } finally { watch.dispose() }
   */
  watchLearnersChoice(
    sourceUri: string | undefined,
    sourceColumn: number,
    isRequestsOwnFocus: (tab: vscode.Tab | undefined) => boolean = () => false,
  ): {
    choices: LearnersChoice[]
    windowLeft: () => boolean
    ignoreOwnEffectOf: (choice: LearnersChoice) => void
    dispose: () => void
  } {
    const choices: LearnersChoice[] = []
    let ownEffect: LearnersChoice | undefined,
      windowLeft = false
    // The tab in front of the active group now: what the editor reports again at arming is not the learner's pick.
    const armedGroup = vscode.window.tabGroups.activeTabGroup
    const armedTab = armedGroup.activeTab
    const isArmedFront = (choice: LearnersChoice): boolean => {
      if (!armedTab || armedGroup.viewColumn !== choice.column) return false
      const armedUri = this.host.textTabUri(armedTab)
      // A text file is told by its document, any other tab as {@link sameLearnersChoiceTarget} tells it.
      if (choice.document) return armedUri === choice.document.uri.toString()
      return (
        armedUri === undefined &&
        sameLearnersChoiceTarget(
          { column: armedGroup.viewColumn, tab: armedTab },
          choice,
        )
      )
    }
    const note = (choice: LearnersChoice): void => {
      if (ownEffect && sameLearnersChoiceTarget(ownEffect, choice)) return
      // The request's own focus (a press's Study pane) is no choice of the learner's.
      if (isRequestsOwnFocus(choice.tab)) return
      // Until a different pick is recorded, the tab in front at arming is the place the learner already was in.
      if (choices.length === 0 && isArmedFront(choice)) return
      choices.push(choice)
    }
    const noteNonTextFront = (): void => {
      const group = vscode.window.tabGroups.activeTabGroup
      if (
        group.activeTab &&
        this.host.textTabUri(group.activeTab) === undefined
      )
        note({ column: group.viewColumn, tab: group.activeTab })
    }
    const listeners = [
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor) return
        // Codebook's own show of the source in the source column is no choice; the same document in another column is the moved copy, which the learner can pick.
        if (
          editor.document.uri.toString() === sourceUri &&
          editor.viewColumn === sourceColumn
        )
          return
        if (editor.viewColumn === undefined) noteNonTextFront()
        else note({ column: editor.viewColumn, document: editor.document })
      }),
      vscode.window.tabGroups.onDidChangeTabs(noteNonTextFront),
      vscode.window.tabGroups.onDidChangeTabGroups(noteNonTextFront),
      vscode.window.onDidChangeWindowState((state) => {
        if (!state.focused) windowLeft = true
      }),
    ]
    return {
      choices,
      windowLeft: () => windowLeft,
      ignoreOwnEffectOf: (choice): void => {
        ownEffect = choice
      },
      dispose: (): void => {
        for (const listener of listeners) listener.dispose()
      },
    }
  }

  /**
   * Repairs an existing Study grid without replacing its evidence panes; called by {@link admitPresentation} for a Restore or a selection of the three-pane Study workspace whose layout is not confirmed while one of the reader's panes or the captured source is the active editor, which is the state a Read leaves.
   * The keyboard (row 631): the path keeps the focused tab it was admitted on, and answers only while that tab has the focus again. Before any effect it notes the active tab ({@link trackFocusedStudyPane} with `requireOwned`), which must be the Application pane, the Study pane or the captured source at its own column, the one the Read left focused; {@link capturePresentationFocus} is not asked, since nothing has to be given back to another tab. It ends the Read's maximization with the editor's Expand and shows the side bars the Read hid: their commands give the bar the keyboard, and `workbench.action.focusActiveEditorGroup` gives it to the active editor group, the noted tab's, again ({@link showSideBarsHiddenByRead}); an agent's request whose keyboard place is not known is told once ({@link endReadForAdmission}). It applies the Study layout: in one editor part the grid is read without any focus command; beside another editor part (Cursor's chat tab) a measurement may borrow the main editor's focus and gives it back to the noted pane with its reveal or to the noted text editor ({@link readMainEditorGrid}), and the watch accepts no other focus. After the layout, after the group sizes and before the Study pane is read, the noted tab must be the active one again with no borrow outstanding; otherwise the Restore is refused ("The Study pane did not regain native focus after layout measurement."). So a Restore that answers leaves the keyboard with the pane or the captured source that was read; it reveals no other pane and runs no focus command that names one. The Arrange control gives the Study pane the keyboard before it asks for the Restore, so it ends there. A native observation confirms this when, after Read Application, Read Captured Source and Read Explanation (with a side bar the Read hid), a Restore that answers `layoutConfirmed: true` leaves the editor's active tab group at the column of the pane that was read and a typed key reaches that pane, and the command trace shows no focus command that names another group and no reveal of another pane. Row 325's probe in VS Code 1.140.0 saw this in twelve takes; the first note of that row, the Application pane with the keyboard after a Restore of a Read of the Explanation pane, was not reproduced, and it would contradict the refusal above.
   * @param input - The admitted Restore or selection.
   * @param requester - Who asked for it; an agent's that ends a Read may tell where the keyboard went ({@link endReadForAdmission}).
   * @returns The state after the arrangement, `'open'`.
   * @throws Before any effect, when the active tab is no Study pane and no captured source at its own column ("Focus an owned Study pane before changing its reading layout."). Afterwards, when the window lost the focus, the learner changed the focus or the panes, the noted tab did not get the focus back, or the evidence changed during the Restore; the reason is published as the presentation's reason.
   * @example await this.restoreStudyArrangement(intent, 'learner')
   */
  private restoreStudyArrangement(
    input: PresentationIntent,
    requester: PresentationRequester,
  ): Promise<PresentationState> {
    const runtimeIdentity = this.host.assertPresentationAdmission()
    const knowsKeyboardPlace = this.host.knowsKeyboardPlaceAtAdmission()
    const focusedPane = this.host.trackFocusedStudyPane(true)
    const transition = {
      id: this.host.presentationId,
      cancellation: new AbortController(),
      runtimeIdentity,
    }
    const lifetime = this.host.lifetime
    this.host.presentationTransition = transition
    this.host.presentationControlRevision++
    this.host.requestedPresentation = input.mode
    this.host.presentationReason = undefined
    let pending!: Promise<PresentationState>
    // eslint-disable-next-line prefer-const -- the async body compares the shared transition against its own promise.
    pending = (async () => {
      try {
        // The maximized group can hide the other leaves from getEditorLayout; restore its grid before measuring ratios.
        await focusedPane.endReadMaximization(() =>
          this.endReadForAdmission(requester, knowsKeyboardPlace),
        )
        transition.cancellation.signal.throwIfAborted()
        this.host.assertLifetime(lifetime)
        focusedPane.assertCurrent()
        await this.host.arrange(
          transition.cancellation.signal,
          'study',
          false,
          undefined,
          focusedPane.beforeScopeFocus,
        )
        transition.cancellation.signal.throwIfAborted()
        this.host.assertLifetime(lifetime)
        focusedPane.assertCurrent()
        // An arrangement that applied its layout owes no sizes any more; one that arranged nothing leaves the groups as an Expand of the reader's left them, and they get their sizes back.
        await this.host.giveGroupSizesBackAfterExpand(() =>
          focusedPane.assertCurrent(),
        )
        if (
          !vscode.window.state.focused ||
          transition.runtimeIdentity !==
            this.host.assertPresentationAdmission() ||
          !this.host.hasStudyPaneColumns()
        )
          throw new StudyError(
            'PRESENTATION_UNAVAILABLE',
            'Study focus or evidence changed during Restore. Inspect the current panes before retrying.',
          )
        if (this.host.layoutReceipt && this.host.sourceReady()) {
          this.host.presentationConfirmed = true
          this.host.requestedPresentation = undefined
          this.host.presentationReason = undefined
          this.host.errors.delete('presentation')
          this.host.publish()
          await this.host.savePresentationPreference(input.mode, transition.id)
        } else {
          // A tab the learner keeps in front of the captured source (an image, a settings page) keeps the panes from being confirmed: the Restore names that tab and the step that clears it, and leaves the grid as it arranged it instead of enlarging the Study pane again.
          const coveringTab = this.host.coveredSourceCause()
          if (coveringTab)
            throw new StudyError('PRESENTATION_UNAVAILABLE', coveringTab)
          if (
            !(await this.host.hasRetainedStudyTopology(
              transition.cancellation.signal,
              focusedPane.beforeScopeFocus,
            ))
          )
            throw new StudyError(
              'PRESENTATION_UNAVAILABLE',
              'The Study panes changed during Restore. Existing editor work was preserved.',
            )
          focusedPane.assertCurrent()
          await this.host.readStudyPane(
            'context',
            transition.cancellation.signal,
          )
          this.host.errors.delete('layout')
        }
        return { ...this.host.presentationState(), state: 'open' as const }
      } catch (error) {
        if (transition.id === this.host.presentationId) {
          this.host.presentationConfirmed = false
          this.host.presentationReason = String(error)
          this.host.publish()
        }
        throw error
      } finally {
        focusedPane.dispose()
        if (this.host.presentationTransition === transition)
          this.host.presentationTransition = undefined
        if (this.host.presentationOperation === pending)
          this.host.presentationOperation = undefined
        this.host.publish()
      }
    })()
    this.host.presentationOperation = pending
    this.host.publish()
    return pending
  }

  /** Admits stable live evidence only; capture, resume reservation and source/navigation work cannot be moved underneath. @example const identity = this.assertPresentationAdmission() */
  assertPresentationAdmission(): string {
    if (
      this.host.busy ||
      this.host.saving ||
      this.host.pendingHistory !== undefined ||
      this.host.repositoryNavigation !== undefined ||
      (this.host.loading && !this.host.recordingActive)
    )
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Wait for the current control, source or navigation to settle.',
      )
    const active = [...(this.host.service?.records.values() ?? [])].filter(
      (record) => !record.stopped,
    )
    return JSON.stringify(
      active.map((record) => {
        const view = this.settledRuntimeOf(record).view(),
          participants = Object.values(view.participants)
        this.assertNoCaptureOrResumePending(view, participants)
        this.assertStableOrInspectedPause(view, participants)
        return {
          runId: record.id,
          status: view.status,
          participants: participants.map((participant) => ({
            phase: participant.phase,
            pause: participant.pause,
            snapshotId: participant.snapshot?.id,
          })),
        }
      }),
    )
  }

  /**
   * Says whether a run is still being prepared, is stopping, or has a source reveal under way; the first three conditions {@link settledRuntimeOf} refuses a run for.
   * @param record - A run that has not stopped.
   * @returns `true` while any of the three holds.
   * @example this.isRunInFlux(record) // => true until the run's preparation ended
   */
  private isRunInFlux(record: StudyRecord): boolean {
    return Boolean(
      !record.prepared || record.stopping || record.sourceReveals.size,
    )
  }

  /**
   * Gives the runtime of a run whose preparation, cleanup and source reveals are settled; asked by {@link assertPresentationAdmission} for every run that has not stopped.
   * @param record - A run that has not stopped.
   * @returns The run's runtime.
   * @throws `PRESENTATION_UNAVAILABLE` while {@link isRunInFlux} holds or the run has no runtime yet.
   * @example const view = this.settledRuntimeOf(record).view()
   */
  private settledRuntimeOf(record: StudyRecord): StudyRuntime {
    if (this.isRunInFlux(record) || !record.runtime)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Runtime preparation, cleanup or source reveal is still pending.',
      )
    return record.runtime
  }

  /**
   * Refuses a presentation change while a run captures a phase or was asked to continue; called by {@link assertPresentationAdmission} with each settled run's view.
   * @param view - The run's view.
   * @param participants - The participants of that view.
   * @throws `PRESENTATION_UNAVAILABLE` when a capture is pending or a participant's resume was requested.
   * @example this.assertNoCaptureOrResumePending(view, Object.values(view.participants))
   */
  private assertNoCaptureOrResumePending(
    view: RuntimeView,
    participants: RuntimeParticipant[],
  ): void {
    if (
      Object.values(view.captures).some(
        (capture) => capture.status === 'pending',
      ) ||
      participants.some(
        (participant) => participant.phase === 'resume-requested',
      )
    )
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Wait for the current capture or continue request to settle.',
      )
  }

  /**
   * Says whether a snapshot was taken at another pause than the one its participant is in; asked by {@link isPauseUninspected}.
   * @param snapshotPause - The pause the participant's snapshot names.
   * @param pause - The participant's current pause, if any.
   * @returns `true` when there is no current pause or its generation, session or thread differs.
   * @example this.isSnapshotOfOtherPause(snapshot.pause, participant.pause)
   */
  private isSnapshotOfOtherPause(
    snapshotPause: NonNullable<RuntimeParticipant['pause']>,
    pause: RuntimeParticipant['pause'],
  ): boolean {
    return (
      snapshotPause.generation !== pause?.generation ||
      snapshotPause.sessionId !== pause.sessionId ||
      snapshotPause.threadId !== pause.threadId
    )
  }

  /**
   * Says whether a paused participant's pause is not yet inspected and committed; asked by {@link lacksInspectedPause} for every paused participant.
   * @param participant - A participant whose phase is `paused`.
   * @param view - The run's view.
   * @returns `true` when the participant has no snapshot, its snapshot is of another pause, or the snapshot's phase is neither captured, withheld, failed nor absent (a withheld image, one the paused page drew nothing for in time, and a preparation pause before any page could be drawn still count as inspected: a paused run whose image capture failed in any other way has already failed).
   * @example paused.some((participant) => this.isPauseUninspected(participant, view))
   */
  private isPauseUninspected(
    participant: RuntimeParticipant,
    view: RuntimeView,
  ): boolean {
    const snapshot = participant.snapshot
    return (
      !snapshot ||
      this.isSnapshotOfOtherPause(snapshot.pause, participant.pause) ||
      // A withheld image is inspected: the pause is real and its Application view shows the live page. So is an image the paused page drew nothing for in time: the run keeps the pause, its source and values ({@link STOP_IMAGE_UNAVAILABLE_TEXT}).
      !['captured', 'withheld', 'failed', 'absent'].includes(
        view.captures[snapshot.capturePhase]?.status ?? '',
      )
    )
  }

  /**
   * Says whether a run that is neither ready nor completed is anything but a committed, inspected pause; asked by {@link assertStableOrInspectedPause}.
   * @param view - The run's view.
   * @param paused - The participants of that view whose phase is `paused`.
   * @returns `true` when the status names no pause, no participant is paused, or {@link isPauseUninspected} holds for one of them.
   * @example this.lacksInspectedPause(view, paused)
   */
  private lacksInspectedPause(
    view: RuntimeView,
    paused: RuntimeParticipant[],
  ): boolean {
    return (
      !view.status.startsWith('paused-') ||
      !paused.length ||
      paused.some((participant) => this.isPauseUninspected(participant, view))
    )
  }

  /**
   * Refuses a presentation change unless a run is ready, completed, or paused with every pause inspected and committed; called by {@link assertPresentationAdmission} after {@link assertNoCaptureOrResumePending}.
   * @param view - The run's view.
   * @param participants - The participants of that view.
   * @throws `PRESENTATION_UNAVAILABLE` for a run in any other state.
   * @example this.assertStableOrInspectedPause(view, Object.values(view.participants))
   */
  private assertStableOrInspectedPause(
    view: RuntimeView,
    participants: RuntimeParticipant[],
  ): void {
    const paused = participants.filter(
      (participant) => participant.phase === 'paused',
    )
    if (
      !['ready', 'completed'].includes(view.status) &&
      this.lacksInspectedPause(view, paused)
    )
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Presentation requires a stable ready/completed run or a committed inspected pause.',
      )
  }

  /**
   * Retains the logical reading region for one admitted handoff; foreign editors still require an exact source receipt. Called by {@link admitPresentation} before a selection or restore changes any pane.
   * @param activatedByClose - The tab the editor activated in place of a focused leftover tab this selection just closed; `undefined` when no focused tab closed or its group is now empty. That tab was never the learner's reading position, so only the group focus is kept.
   * @param placesPaneInFocusedGroup - `false` for an Application preparation ({@link captureApplicationPreparationReturn}), whose pane goes into a new group of its own and never replaces a preview tab: a focused preview tab is then kept like any other foreign tab (Cycle 0062 task 1). Left out, a presentation that may place a pane in the focused tab's group.
   * @returns The function that gives focus back once the presentation is placed. Its third argument is `true` only after a confirmed placement: a learner's document that shares the captured source's group then stays open behind that source instead of covering it. For a focused tab that is neither a text editor nor a Study pane (an agent chat, a settings page) the function does nothing: that tab stays where it is, and {@link retainForeignTabFocus} gives its group the focus back.
   * @throws `PRESENTATION_UNAVAILABLE`, naming the tab and how to clear it, when the focused tab is a preview that a pane placed in its group would replace, or a captured source the editor reports no text editor for.
   * @example
   * ```ts
   * const restore = this.capturePresentationFocus(undefined)
   * const restoreAfterPreparation = this.capturePresentationFocus(undefined, false) // beside a focused image preview: no refusal
   * ```
   */
  capturePresentationFocus(
    activatedByClose: vscode.Tab | undefined,
    placesPaneInFocusedGroup = true,
  ): (
    signal?: AbortSignal,
    assertSourceFocus?: () => void,
    placedSourceStays?: boolean,
  ) => Promise<void> {
    const assertOwnedFocus = (assertSourceFocus?: () => void): void => {
      if (this.host.app?.active || this.host.contextPanel?.active) return
      // Placement may finish on its stationary source; only its exact focus/selection receipt permits restoration.
      if (!assertSourceFocus)
        throw new Error(
          'Focus changed outside Codebook during placement; it was preserved.',
        )
      assertSourceFocus()
    }
    if (this.host.app?.active || this.host.contextPanel?.active) {
      const region = this.host.app?.active ? 'app' : 'contextPanel',
        lifetime = this.host.lifetime
      const presentationId = this.host.presentationId,
        revision = this.host.presentationControlRevision
      return async (signal, assertSourceFocus): Promise<void> => {
        signal?.throwIfAborted()
        this.host.assertLifetime(lifetime)
        assertOwnedFocus(assertSourceFocus)
        const panel = this.host[region]
        // A replacement inherits focus only inside the original admitted transition, never after close/reopen.
        if (!panel || this.hasLeftAdmittedTransition(presentationId, revision))
          throw new Error(
            'The focused Codebook presentation was closed or superseded.',
          )
        await this.host.focusPresentationPanel(panel, signal)
      }
    }
    const editor = this.host.activeTextEditorWithKeyboard()
    if (editor) {
      const document = editor.document,
        documentVersion = document.version,
        group = this.host.groupOfKeyboardEditor(editor),
        selections = editor.selections,
        restoreReadingPosition = retainEditorReadingPosition(editor),
        preview = group.activeTab?.isPreview ?? false
      return async (
        signal,
        assertSourceFocus,
        placedSourceStays,
      ): Promise<void> => {
        assertOwnedFocus(assertSourceFocus)
        // Edits can retain the same tab/group while invalidating its captured selections and reading position.
        this.assertDocumentVersion(
          document,
          documentVersion,
          'The previously focused document changed during presentation; its current reading position was preserved.',
        )
        const currentGroup = this.focusReturnGroup(document, group)
        // The learner's document stays open behind a captured source that was placed in its own group.
        if (
          this.staysBehindPlacedSource(
            document,
            currentGroup,
            placedSourceStays,
          )
        )
          return
        // It also stays open behind the Application pane that was placed in its group: the pane is never left behind a learner's tab, and it takes the keyboard focus that document had.
        const placedApplication =
          placedSourceStays &&
          this.applicationSharingGroup(document, currentGroup)
        if (placedApplication) {
          await this.host.focusPresentationPanel(placedApplication, signal)
          return
        }
        const restored = await this.host.showTextDocumentNoted(document, {
          viewColumn: currentGroup.viewColumn,
          preserveFocus: false,
          preview,
        })
        this.assertDocumentVersion(
          document,
          documentVersion,
          'The previously focused document changed during presentation; its current selections were preserved.',
        )
        restored.selections = selections
        await restoreReadingPosition(restored, signal)
      }
    }
    // An empty group has no document to restore, and neither has the page the editor activated when the focused leftover tab was just closed; retain its group focus after an explicit first entry.
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab
    if (!activeTab || activeTab === activatedByClose)
      return async (): Promise<void> => {
        await this.host.executeEditorCommand(
          'workbench.action.focusActiveEditorGroup',
        )
      }
    const activeColumn = vscode.window.tabGroups.activeTabGroup.viewColumn
    // A preview tab would be replaced by a pane placed in its group, so it refuses the arrangement whichever tab has the focus; the refusal names it and how to clear it. An Application preparation places its pane in a new group, so the preview stays as it is.
    if (activeTab.isPreview && placesPaneInFocusedGroup)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        foreignPreviewObstacle(
          this.host.editorTabName(activeTab),
          activeColumn,
        ),
      )
    // A captured source the editor shows without a text editor (a leftover of an earlier session it would not close, or another workspace's) is told by what the tab is: its document is a captured source. It has no reading position to return to. One whose text editor is visible is the reader's own source named beside another editor part that holds the keyboard (Cursor's chat input after a selection made from it): it stays as it is, like a learner's file in that state.
    if (
      this.host.isCapturedSourceInput(activeTab.input) &&
      !this.hasVisibleTextEditor(activeTab.input.uri, activeColumn)
    )
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        tabWithoutEditorObstacle(
          this.host.editorTabName(activeTab),
          activeColumn,
        ),
      )
    // Any other tab stays as it is: an agent chat, a settings page, an image the learner keeps, and a learner's own file that the editor names as the active tab while another part (the chat input) holds the keyboard, so that no text editor is active. {@link retainForeignTabFocus} gives its group the focus back after the last layout read.
    return async (): Promise<void> => {}
  }

  /**
   * Says whether a focused Study pane's handoff is no longer the transition it was admitted in; asked by the focus return {@link capturePresentationFocus} gives for a focused pane, before it focuses the pane's replacement.
   * @param presentationId - The reader's presentation id when the focus was captured.
   * @param revision - The presentation control revision when the focus was captured.
   * @returns `true` when another transition runs, none does, or the control revision is not the one that admission made.
   * @example if (!panel || this.hasLeftAdmittedTransition(presentationId, revision)) throw new Error('The focused Codebook presentation was closed or superseded.')
   */
  private hasLeftAdmittedTransition(
    presentationId: string,
    revision: number,
  ): boolean {
    return (
      this.host.presentationTransition?.id !== presentationId ||
      this.host.presentationControlRevision !== revision + 1
    )
  }

  /**
   * Refuses to return the focus to a document that was edited since its focus was captured; called twice by the focus return {@link capturePresentationFocus} gives for a text editor: before it looks for the document's group, and after the editor showed the document again.
   * @param document - The document that had the focus.
   * @param version - Its version when the focus was captured.
   * @param message - What the refusal says was preserved.
   * @throws An `Error` with `message` when the document's version is another one.
   * @example this.assertDocumentVersion(document, documentVersion, 'The previously focused document changed during presentation; its current selections were preserved.')
   */
  private assertDocumentVersion(
    document: vscode.TextDocument,
    version: number,
    message: string,
  ): void {
    if (document.version !== version) throw new Error(message)
  }

  /**
   * Finds the group that shows a document now, for the focus return {@link capturePresentationFocus} gives for a text editor; asked right after the document was found unedited.
   * @param document - The document that had the focus.
   * @param group - The group it was focused in.
   * @returns The source group for the captured source, otherwise the group that is, or has the identity of, `group`.
   * @throws An `Error` when that group is gone or no longer holds a text tab of the document.
   * @example const currentGroup = this.focusReturnGroup(document, group)
   */
  private focusReturnGroup(
    document: vscode.TextDocument,
    group: vscode.TabGroup,
  ): vscode.TabGroup {
    const currentGroup =
      document.uri.toString() === this.host.sourceUri?.toString()
        ? this.host.studyPanePositions().sourceGroup
        : vscode.window.tabGroups.all.find(
            (candidate) =>
              candidate === group ||
              this.host.editorGroupIdentities.get(candidate) ===
                this.host.editorGroupIdentities.get(group),
          )
    if (
      !currentGroup?.tabs.some(
        (tab) =>
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.toString() === document.uri.toString(),
      )
    )
      throw new Error(
        'The previously focused source group changed; focus was not guessed.',
      )
    return currentGroup
  }

  /**
   * Gives the Application pane when it stands in the group of a learner's document; asked by the focus return {@link capturePresentationFocus} gives for a text editor, after a confirmed placement.
   * @param document - The document that had the focus.
   * @param currentGroup - The group that shows it now.
   * @returns The Application pane when it is in that group's column and the document is not the captured source; otherwise `undefined`.
   * @example const placedApplication = placedSourceStays && this.applicationSharingGroup(document, currentGroup)
   */
  private applicationSharingGroup(
    document: vscode.TextDocument,
    currentGroup: vscode.TabGroup,
  ): vscode.WebviewPanel | undefined {
    return this.host.app &&
      currentGroup.viewColumn === this.host.app.viewColumn &&
      document.uri.toString() !== String(this.host.sourceUri)
      ? this.host.app
      : undefined
  }

  /**
   * Remembers the tab the editor names as active when no text editor and no Study pane has the focus, so a selection or a restore is admitted without closing or moving that tab; called by {@link admitPresentation} for every arrangement and by {@link confirmPresentationNoop}, by {@link sampleKeyboardOutsideEditors} for the record of a pause, and by {@link close} before it ends a Read. Cursor's Agent chat is such a tab of an editor group while it is shown as a tab of another editor part; and while its chat input holds the keyboard there, Cursor can name a learner's own file of the main editor as the active tab without an active text editor. Nobody can focus anything else while the agent works. While Cursor shows that chat as a pane of the secondary side bar, the editor names an active text editor beside it, as VS Code does beside its chat view, and nothing is remembered.
   * @param activatedByClose - The tab the editor activated in place of a focused leftover tab this selection just closed; {@link capturePresentationFocus} keeps that group's focus itself.
   * @param fromWiki - `true` for an entry the Repository Wiki asked for ({@link open} with the origin `repository`: a recording or observation visit): the Wiki's tab in front of the active group has the keyboard although VS Code may still report a text editor of another group as the active one ({@link activeTextEditorWithKeyboard}, row 659), so that report does not end the search for the tab to give the keyboard back to. Another extension's webview in front of the active group is read past for every entry (row 671); the Wiki only for its own entries, since Cursor reports the text editor the Wiki took the keyboard from for a moment after a learner's own entry from it, which keeps its own handoff.
   * @param withoutPanePress - `true` for an arrangement of the live or recording panes that no control of a Study pane or view asked for (the composition branch of {@link admitPresentation}): an agent's (row 628), and the learner's Arrange Study Workspace run from the command palette or a shortcut (row 638). A Study pane's tab the editor names while no Study pane and no text editor is active is then read as the chat input of another editor part over that tab, as a learner's file is, because Cursor's Focus Agent, with which an agent's Return Current gave the chat its keyboard back, changes no tab or group. A press in a Study pane or view keeps its rule: such a tab is no foreign tab to return to.
   * @returns
   * - `undefined` when a Study pane or a text editor has the focus, no tab is active, the active tab is a Study pane's (outside `withoutPanePress`), or the focused tab is one {@link capturePresentationFocus} refuses or handles (a preview, a captured source without a text editor, `activatedByClose`).
   * - Otherwise the function that gives the keyboard back once the panes are arranged, and answers whether it ran a focus command. Its third argument names why a chat gets the keyboard back, where the editor cannot tell that chat's input from a view: a return to a chat then tells the learner the sentence of that cause once ({@link CHAT_KEYBOARD_RETURNED_MESSAGES}, row 648); left out, nothing is told. Called with `true` by {@link returnsKeyboardToChatAtPause} and {@link judgeKeyboardAtPauseEnd}, it gives the keyboard back at a pause without asking the editor where the focus is (the caller knows that a text editor has it: the paused file the editor's debugger opened, or the captured source shown in its place), and then only to the chat through {@link CURSOR_FOCUS_AGENT_COMMAND}: a tab of one of the main editor's groups gets nothing back at a pause, like a learner's file. {@link returnsKeyboardToChatAfterSideBars} calls it with `true` in the same way after a close showed a side bar a Read hid: the caller knows that the bar's command took the keyboard. A tab of one of the main editor's groups gets it through the editor's focus command for that group, while the tab is still the one its group shows. A tab of another editor part (Cursor's Agent chat), and the chat input that held the keyboard while the editor named a learner's file without an active text editor, get it through {@link CURSOR_FOCUS_AGENT_COMMAND} where the host registers it: the numbered focus command of such a group's column would open a new empty group in the main editor, so it is never run for it, and without the host's command the focus stays where the arrangement ended. The keyboard is given back only for a group no Study pane uses and while the focus is where the arrangement left it (a Codebook pane, the captured source, or the file's editor the measurement focused) and, outside a pause's return (the cause `pause`), the learner clicked or typed in no text editor since this capture (row 741); in every other case the focus stays and nothing is guessed.
   * @example
   * ```ts
   * const returnForeignFocus = this.retainForeignTabFocus(undefined)
   * await this.arrange(signal)
   * await returnForeignFocus?.()
   * ```
   */
  retainForeignTabFocus(
    activatedByClose: vscode.Tab | undefined,
    withoutPanePress = false,
    fromWiki = false,
  ):
    | ((
        takenByEditor?: boolean,
        stillCurrent?: () => boolean,
        toldCause?: ChatKeyboardReturnCause,
      ) => Promise<boolean>)
    | undefined {
    // The Wiki that asked for this entry has the keyboard even while VS Code still reports the text editor of another group (row 659).
    const focusedTextEditor = this.host.activeTextEditorWithKeyboard(fromWiki)
    if (this.host.hasActiveStudyPane() || focusedTextEditor) return undefined
    const group = vscode.window.tabGroups.activeTabGroup,
      activeTab = group.activeTab
    const heldUri = this.textTabUriHeldByAnotherPart(activeTab, group)
    // Beside a request no pane's control made a Study pane's tab named without an active pane is held by the chat, as a learner's file is (rows 628, 638); a moved pane's tab may be a preview, which says nothing of the chat. The Repository Wiki's tab named while its panel is not active is held by the chat for every request (row 680).
    const paneHeldByChat =
      (withoutPanePress && this.isStudyPaneInput(activeTab?.input)) ||
      this.isWikiTabWithoutKeyboard(activeTab)
    const heldByAnotherPart = heldUri !== undefined || paneHeldByChat
    const tab = paneHeldByChat
      ? activeTab
      : this.foreignTabToReturnTo(
          activeTab,
          activatedByClose,
          heldByAnotherPart,
        )
    if (!tab) return undefined
    const column = group.viewColumn,
      groupCount = vscode.window.tabGroups.all.length
    /** Names the kind of a tab's input; a tab the editor API has no input kind for (the chat) has none. */
    const inputKind = (input: unknown): unknown =>
      typeof input === 'object' && input !== null
        ? Object.getPrototypeOf(input)
        : undefined
    // The editor may replace its tab objects with every tab change, so the tab is known by its label and its kind of input.
    const showsThatTab = (candidate: vscode.TabGroup): boolean =>
      candidate.activeTab?.label === tab.label &&
      inputKind(candidate.activeTab.input) === inputKind(tab.input)
    const borrowsBefore = this.host.mainEditorFocusBorrows,
      // The learner's last click or key in a text editor before the arrangement (row 741).
      learnerSignBefore = this.host.learnerWorkedInEditorAtMs
    // VS Code's chat opened as an editor tab gets its keyboard back also where the editor took it (row 632).
    const chatEditorTab = isChatEditorTabInput(
      tab.input,
      Reflect.get(vscode, 'TabInputChat'),
    )
    return async (
      takenByEditor = false,
      stillCurrent,
      toldCause,
    ): Promise<boolean> => {
      // Groups the arrangement opened or closed in the main editor shift the column of a group behind them.
      const shownColumn =
        column + vscode.window.tabGroups.all.length - groupCount
      const target = heldByAnotherPart
        ? undefined
        : (vscode.window.tabGroups.all.find(
            (candidate) =>
              candidate.viewColumn === shownColumn && showsThatTab(candidate),
          ) ?? this.onlyGroupShowingAfterLeftoverProof(showsThatTab, toldCause))
      const active = vscode.window.tabGroups.activeTabGroup,
        activeUri =
          active.activeTab?.input instanceof vscode.TabInputText
            ? active.activeTab.input.uri.toString()
            : undefined,
        panes = this.host.studyPanePositions()
      // The focus is given back only from where the arrangement or its measurement left it, and never to a group a Study pane uses or one that is gone. The arrangement leaves it on a Codebook pane, the captured source or the learner's file it focused. The measurement leaves it in the first group, which the editor names then, or still names the group it named before: Cursor reports no focus of a pane beside the chat. Its chat part's group, named since a tab closed during the arrangement, stays named over the first group's text editor the borrow focused (row 723).
      // A learner's other tab in front of the first group since the borrow is the learner's newer place, also under the chat part's name (row 732).
      const leftByMeasurement =
        this.host.mainEditorFocusBorrows !== borrowsBefore &&
        !this.showsLearnersOtherTabInFirstGroup() &&
        (active.viewColumn === vscode.ViewColumn.One ||
          active.viewColumn === target?.viewColumn ||
          this.isFirstGroupEditorUnderAnotherPartsName(active))
      if (
        !vscode.window.state.focused ||
        (!heldByAnotherPart &&
          (!target ||
            [panes.appColumn, panes.sourceColumn, panes.contextColumn].includes(
              target.viewColumn,
            ))) ||
        !(
          leftByMeasurement ||
          takenByEditor ||
          this.host.app?.active ||
          this.host.contextPanel?.active ||
          (activeUri !== undefined &&
            (activeUri === this.host.sourceUri?.toString() ||
              (activeUri === heldUri && active.viewColumn === column))) ||
          this.isCapturedSourceUnderAnotherPartsName(active)
        )
      )
        return false
      const command = await this.host.focusReturnCommand(
        target,
        takenByEditor,
        chatEditorTab,
      )
      // A newer pause, replay or learner choice can revoke a return while native command discovery waits.
      if (stillCurrent && !stillCurrent()) return false
      // A click or key the learner gave in a text editor since this capture, also where the arrangement or its measurement left the keyboard, is the learner's newer place (row 741); a pause's return keeps its own rules for the learner's signs ({@link keepsPauseReturnCurrent}, {@link keepsPauseEndReturnCurrent}).
      if (
        toldCause !== 'pause' &&
        this.host.learnerWorkedInEditorAtMs !== learnerSignBefore
      )
        return false
      // A return after a measurement that borrowed the main editor's focus beside the chat is told with the arrangement's cause, unless the caller names another (rows 647 and 655).
      const borrowedMainEditor =
        this.host.mainEditorFocusBorrows !== borrowsBefore
      return this.host.runFocusReturnCommand(
        command,
        toldCause ?? (borrowedMainEditor ? 'arrangement' : undefined),
        chatEditorTab,
      )
    }
  }

  /**
   * Says whether the captured source the arrangement showed with the keyboard has it while the editor names another editor part's group: Cursor 3.23.12 names its chat part's group after a tab closed while the chat input had the keyboard (C61 c61-702-probe step 6, Cycle 0046 row 702), and a text editor of the main editor that takes the keyboard after that is reported as the active text editor while that name stays until a group event (c58-cu-567, row 674); asked by the function {@link retainForeignTabFocus} answers, before it gives the keyboard back from where the arrangement left it.
   * @param active - The group the editor names as active now.
   * @returns `true` while the named group's front tab has no editor's input (the chat's tab, {@link namesAnotherEditorPartsTab}) and the active text editor is the captured source; `false` otherwise.
   * @example this.isCapturedSourceUnderAnotherPartsName(vscode.window.tabGroups.activeTabGroup) // => true after Return Current showed the captured source with the keyboard beside Cursor's chat part, once its obsolete copy's close named the chat's group
   */
  private isCapturedSourceUnderAnotherPartsName(
    active: vscode.TabGroup,
  ): boolean {
    return (
      this.host.sourceUri !== undefined &&
      this.host.namesAnotherEditorPartsTab(active) &&
      vscode.window.activeTextEditor?.document.uri.toString() ===
        this.host.sourceUri.toString()
    )
  }

  /**
   * Says whether the first group's text editor a layout read's borrow focused has the keyboard while the editor names another editor part's group: after `workbench.action.focusFirstEditorGroup` beside Cursor 3.23.12's chat part, the first group's text editor is reported as the active text editor and the group named before stays named until a group event (row 673), and that is the chat part's group once a tab closed while the chat input had the keyboard (row 702's probe, step 6), as the replay's captured source closes at an agent's Return Current (row 711's order); asked by the function {@link retainForeignTabFocus} answers for its measurement's borrow, so the chat gets its keyboard back as after row 711's borrow through the captured source (Cycle 0046 row 723). That function takes it only while the first group shows in front no learner's tab other than the one the borrow left there ({@link showsLearnersOtherTabInFirstGroup}): a learner's tab of that group, reported as the active text editor under the chat's name, is the learner's newer place (row 732).
   * @param active - The group the editor names as active now.
   * @returns `true` while the named group's front tab has no editor's input (the chat's tab, {@link namesAnotherEditorPartsTab}) and the active text editor is the one in front of the first group ({@link isActiveTextEditorInFrontOfGroup}); `false` otherwise.
   * @example this.isFirstGroupEditorUnderAnotherPartsName(vscode.window.tabGroups.activeTabGroup) // => true after Return Current's measurement focused the learner's login-form.tsx in front of the first group beside Cursor's chat part, once the replay's captured source closed under the chat's name
   */
  private isFirstGroupEditorUnderAnotherPartsName(
    active: vscode.TabGroup,
  ): boolean {
    return (
      this.host.namesAnotherEditorPartsTab(active) &&
      this.host.isActiveTextEditorInFrontOfGroup(vscode.ViewColumn.One)
    )
  }

  /**
   * Finds the group of a remembered tab after a leftover proof, when the column shift the return assumes missed it; asked by the function {@link retainForeignTabFocus} answers once its shifted column shows no such tab (row 648's further finding).
   * A leftover proof places no pane, it only removes groups an earlier window left: a removed group after the remembered tab's group leaves that group's column as it was, which the shift by the group count does not see, so VS Code's chat editor tab in a group before the leftover got nothing back.
   * @param showsThatTab - Tells whether a group shows the remembered tab in front.
   * @param toldCause - The return's cause; only a leftover proof's return, also a refused one's, looks further.
   * @returns The one group that shows the tab after a leftover proof; `undefined` for any other cause, and when no group or several groups show it.
   * @example this.onlyGroupShowingAfterLeftoverProof(showsThatTab, 'leftoverProof') // => the chat tab's group at column 1 after the leftover at column 3 was removed
   */
  private onlyGroupShowingAfterLeftoverProof(
    showsThatTab: (candidate: vscode.TabGroup) => boolean,
    toldCause: ChatKeyboardReturnCause | undefined,
  ): vscode.TabGroup | undefined {
    // A refused proof may have removed a group before the one the editor kept.
    if (
      toldCause !== 'leftoverProof' &&
      toldCause !== 'refusedLeftoverProof' &&
      toldCause !== 'unprovenLeftoverProof'
    )
      return undefined
    const showing = vscode.window.tabGroups.all.filter(showsThatTab)
    return showing.length === 1 ? showing[0] : undefined
  }

  /**
   * Chooses the command that gives a remembered tab's group the keyboard back; asked by the function {@link retainForeignTabFocus} answers, once it knows that the focus may be given back.
   * Cursor's numbered focus commands count the groups of the main editor only: for the column of another editor part's group (Cursor's chat) the command opens a new empty group in the main editor. Only a group that is known to be one of the main editor's is focused by its number, and only a tab that is known to lie outside the main editor gets the host's own command for its chat, or, for VS Code's chat editor tab in a floating window, the number VS Code counts across its editor parts ({@link otherPartFocusCommand}, row 636); while the main editor's group count is not known nothing is run for a group, and the focus stays where it is. Without such a command it stays too. At a pause, and after a close that showed a side bar a Read hid, only the chat gets the keyboard back: Cursor's chat through its command, and VS Code's chat opened as an editor tab of a main group through that group's focus command where the editor moved the keyboard to another group ({@link isChatTabBesideMovedKeyboard}, row 632); another tab of the main editor (a settings page, an image) is treated like a learner's file, which gets nothing back there, because the editor reads the same for such a tab whether the keyboard was in it or in the terminal, a view or a side-view chat.
   * @param target - The group that still shows the remembered tab, `undefined` for a tab another editor part held the keyboard over.
   * @param takenByEditor - Whether the editor itself took the keyboard from the remembered tab, as the caller knows, and it is not given back after an arrangement: at a pause of a live run ({@link settleKeyboardAtPause}), where the editor's debugger opened the paused file with the keyboard, and at a close that ends a Read ({@link returnsKeyboardToChatAfterSideBars}), where the editor's command showed a side bar with the keyboard.
   * @param chatEditorTab - Whether the remembered tab is VS Code's chat editor tab ({@link isChatEditorTabInput}), whose group gets the keyboard back also where the editor took it.
   * @returns
   * - The numbered focus command of a group of the main editor: after an arrangement, and for VS Code's chat editor tab also at a pause, while its group is not the active one.
   * - For a tab of another editor part or one held by another part: {@link CURSOR_FOCUS_AGENT_COMMAND} where the host registers it, and the numbered focus command of the group's column for VS Code's chat editor tab in a floating window ({@link otherPartFocusCommand}).
   * - `undefined` for any other group of the main editor at a pause and after a close that ends a Read, for a group that is not known to be the main editor's or another part's ({@link placeOfRememberedGroup}), and for another part's tab no command focuses.
   * @example
   * ```ts
   * await this.focusReturnCommand(chatGroup, true) // => 'composer.focusComposer' in Cursor
   * await this.focusReturnCommand(vsCodeChatTabGroup, true, true) // => 'workbench.action.focusThirdEditorGroup' for its group at column 3
   * await this.focusReturnCommand(settingsGroup, true) // => undefined
   * ```
   */
  async focusReturnCommand(
    target: vscode.TabGroup | undefined,
    takenByEditor: boolean,
    chatEditorTab = false,
  ): Promise<string | undefined> {
    const place = await this.host.placeOfRememberedGroup(target)
    if (place === 'other')
      return this.otherPartFocusCommand(target, chatEditorTab)
    if (
      place === 'unknown' ||
      (takenByEditor &&
        !this.isChatTabBesideMovedKeyboard(target, chatEditorTab))
    )
      return undefined
    return focusEditorGroupCommand(place)
  }

  /**
   * Says whether VS Code's chat editor tab stands in a group the editor moved the keyboard away from, so that its group's focus command gives the chat input the keyboard back; asked by {@link focusReturnCommand} where the editor itself took the keyboard (row 632).
   * At a pause the debugger activated the paused file's group, another than the chat's. At a close that showed a side bar a Read hid, the chat's group is still the active one, and {@link showSideBarsHiddenByRead} focused it after the bars: the editor's group focus gives its active editor, the chat, the keyboard (VS Code 1.140.0 `workbench.desktop.main.js` 990:4464, 1106:74902, 3129:7546), so nothing more is run and {@link close} says where the keyboard is.
   * @param target - The group that still shows the remembered tab.
   * @param chatEditorTab - Whether the remembered tab is VS Code's chat editor tab ({@link isChatEditorTabInput}).
   * @returns `true` for VS Code's chat editor tab in a group that is not the active one; `false` for any other tab, no group, and the active group.
   * @example this.isChatTabBesideMovedKeyboard(chatGroup, true) // => true at a pause whose file the debugger opened in another group
   */
  private isChatTabBesideMovedKeyboard(
    target: vscode.TabGroup | undefined,
    chatEditorTab: boolean,
  ): boolean {
    return (
      chatEditorTab &&
      target !== undefined &&
      target.viewColumn !== vscode.window.tabGroups.activeTabGroup.viewColumn
    )
  }

  /**
   * Names the command that gives a remembered tab of another editor part the keyboard back; asked by {@link focusReturnCommand} for a group that is known to lie outside the main editor (row 636).
   * Cursor's Agent chat gets {@link CURSOR_FOCUS_AGENT_COMMAND}. VS Code registers no command for its chat, but its numbered group focus commands count the groups of every editor part in the order the extension API numbers the view columns, so VS Code's chat editor tab moved into a floating window gets the command of its group's column: the group's focus gives the chat editor's input the keyboard and raises its window (VS Code 1.140.0 `workbench.desktop.main.js` 987:4284, 1106:181056, 1106:181094, 699:19807, 1106:74902, 3129:7546, 36:2290, 1106:133818). Cursor counts only its main editor's groups (Cursor 3.23.12 11684:4156), so a group's number is never run for its other part.
   * @param target - The group that still shows the remembered tab, `undefined` for a tab another editor part held the keyboard over.
   * @param chatEditorTab - Whether the remembered tab is VS Code's chat editor tab ({@link isChatEditorTabInput}).
   * @returns
   * - {@link CURSOR_FOCUS_AGENT_COMMAND} where the host registers it.
   * - The numbered focus command of the group's column for VS Code's chat editor tab, while the column is one of the first eight.
   * - `undefined` otherwise; where the caller tells where the keyboard is when nothing is given back, it still does.
   * @example await this.otherPartFocusCommand(floatingChatGroup, true) // => 'workbench.action.focusFourthEditorGroup' in VS Code for its group at column 4
   */
  private async otherPartFocusCommand(
    target: vscode.TabGroup | undefined,
    chatEditorTab: boolean,
  ): Promise<string | undefined> {
    const chatCommand = await this.host.chatFocusCommand()
    // Only VS Code's chat editor tab of a known group is focused by its column; Cursor's chat keeps its own command.
    if (chatCommand || !chatEditorTab || !target) return chatCommand
    return focusEditorGroupCommand(target.viewColumn)
  }

  /**
   * Starts the record of the keyboard outside the text editors and the Study panes for the whole editor session; called once by {@link installReaders}.
   * The record must exist before a run pauses: when the native focus preference is enabled, the editor's debugger opens the paused file with the keyboard before any code of the reader runs for that pause. With it the reader follows every debug session's stops ({@link followStopsOf}).
   * @example this.watchKeyboardOutsideEditors()
   */
  watchKeyboardOutsideEditors(): void {
    const sample = (): void => this.host.sampleKeyboardOutsideEditors()
    this.host.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        sample()
        this.noteLearnersSignAtFrame(this.keptPreviewTabOfFrame())
        this.forgetClosedRetiredBrowserReplayTabs(event.closed)
      }),
      vscode.window.tabGroups.onDidChangeTabGroups(sample),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.host.placementEvents.record(
          performance.now(),
          `active text editor ${editor ? `column ${editor.viewColumn}` : 'none'}`,
        )
        sample()
        this.noteLearnersSignAtFrame(this.host.isLearnersEditor(editor))
        this.endSourceKeyboardPlacementAtLearnersMove(editor)
      }),
      vscode.window.onDidChangeTextEditorSelection((change) =>
        this.noteLearnersSelection(change),
      ),
      vscode.debug.onDidChangeActiveStackItem(() =>
        this.judgeKeyboardAtStackItemChange(),
      ),
      // The editor reports a stop and a frame the learner selects the same way; only the adapter's own messages tell them apart.
      vscode.debug.registerDebugAdapterTrackerFactory('*', {
        createDebugAdapterTracker: (session) => this.followStopsOf(session),
      }),
    )
    sample()
  }

  /**
   * Follows the stops of one debug session for the reader; called by the editor through the tracker factory of {@link watchKeyboardOutsideEditors} when a session of any debug type starts.
   * The adapter's `stopped` event reaches this tracker in the extension host before the editor opens the paused file and reports the stack frame, so {@link cameWithStop} finds it when that frame arrives. The editor makes a tracker for every adapter it starts, also for the new adapter of a session it restarts under the same id, and tells it when that adapter is stopped or exits.
   * @param session - The session that starts.
   * @returns The tracker, which reads each message of that session's adapter ({@link readAdaptersMessage}), notes when the editor lets the session go on, which puts a noted stop of it in doubt ({@link noteSessionWentOn}), and forgets the session when it ends ({@link forgetSession}).
   * @example vscode.debug.registerDebugAdapterTrackerFactory('*', { createDebugAdapterTracker: (session) => this.followStopsOf(session) })
   */
  private followStopsOf(
    session: vscode.DebugSession,
  ): vscode.DebugAdapterTracker {
    this.host.followedSessions.add(session.id)
    return {
      onDidSendMessage: (message: unknown): void =>
        this.readAdaptersMessage(session.id, message),
      // An adapter need not send `continued` after the editor's own resume or step: the request says it too. The editor's stackTrace requests tell which frame it focuses for a stop.
      onWillReceiveMessage: (message: unknown): void => {
        this.host.stopHandOver.readEditorsMessage(session.id, message)
        this.storedStops.readEditorsMessage(session.id, message)
        if (isDebugResumeMessage(message)) this.noteSessionWentOn(session.id)
      },
      // The editor stops the adapter, or the adapter exits by itself: either is the session's end, and both may come.
      onWillStopSession: (): void => this.forgetSession(session.id),
      onExit: (): void => this.forgetSession(session.id),
    }
  }

  /**
   * Reads one message of a debug adapter for what it says about the session's stops; called by the tracker of {@link followStopsOf} for every message the adapter sends.
   * - A `stopped` event is noted ({@link noteStopOf}).
   * - An `invalidated` event for the session's threads or stacks is noted like a stop ({@link isDebugStopsInvalidation}): both editors then handle stored stops of that session again, which opens the paused file with the keyboard and reports a frame, and no `stopped` event comes with it. The stop noted is the one this editor handles again from the details it stored ({@link StoredDebugStops.stopHandledAgainOf}): VS Code handles every stored stop, Cursor its oldest (Cycle 0046 Q8). So a stop whose adapter asked to keep the focus still arms no keyboard hand-over, and an armed one keeps its thread and reason (Cycle 0046 R5). Without a stored stop it is noted as a stop that does not keep the focus.
   * - A `continued` event is noted as the moment the session went on, which puts its noted stop in doubt ({@link noteSessionWentOn}).
   * - An answer to the editor's `stackTrace` request goes to the stop's keyboard hand-over, which learns from it the frame the editor focuses for the stop ({@link StopKeyboardHandOver}).
   * @param sessionId - The session of the adapter.
   * @param message - The message as the tracker receives it.
   * @example onDidSendMessage: (message) => this.readAdaptersMessage(session.id, message)
   */
  private readAdaptersMessage(sessionId: string, message: unknown): void {
    this.host.stopHandOver.readAdaptersMessage(sessionId, message)
    this.storedStops.readAdaptersMessage(sessionId, message)
    const stop = debugStopOf(message)
    if (stop) {
      // A session that stops runs no longer: its frame is focused until it goes on again.
      this.host.sessionsWentOnAtMs.delete(sessionId)
      this.storedStops.noteStop(sessionId, stop)
      this.noteStopOf(sessionId, stop)
    } else if (isDebugStopsInvalidation(message))
      this.noteStopOf(
        sessionId,
        this.storedStops.stopHandledAgainOf(
          sessionId,
          this.host.isCursorHost() ? 'Cursor' : 'VS Code',
        ) ?? {
          reason: undefined,
          keepsFocus: false,
          threadId: undefined,
        },
      )
    else if (isDebugResumeMessage(message)) this.noteSessionWentOn(sessionId)
  }

  /**
   * Notes that a debug session goes on: the moment is kept for {@link cameBeforeFocusPass}, and a stop of that session the editor has not shown yet is put in doubt ({@link doubtStopOf}); called by {@link readAdaptersMessage} for the adapter's `continued` event and by the tracker of {@link followStopsOf} for the editor's resume and step requests ({@link isDebugResumeMessage}).
   * The last such message counts: the editor starts its pass of the focus anew with each of them, and this tracker reads each before the editor's window does.
   * @param sessionId - The session that goes on.
   * @example if (isDebugResumeMessage(message)) this.noteSessionWentOn(session.id)
   */
  private noteSessionWentOn(sessionId: string): void {
    this.host.sessionsWentOnAtMs.set(sessionId, performance.now())
    this.doubtStopOf(sessionId)
    // A session that goes on ends its stop, so its next stop gets a keyboard hand-over of its own.
    this.host.stopHandOver.disarm(sessionId)
  }

  /**
   * Drops what the reader keeps of a debug session that ended; called by the tracker of {@link followStopsOf} when the editor stops that session's adapter and when the adapter exits.
   * Without it the reader would keep the id of every debug session of the whole editor session, child sessions and every replay's sessions too, and a stop the editor never showed would stay noted for a session that is gone.
   * @param sessionId - The session that ended.
   * @example onWillStopSession: () => this.forgetSession(session.id)
   */
  private forgetSession(sessionId: string): void {
    this.host.followedSessions.delete(sessionId)
    this.host.announcedStops.delete(sessionId)
    this.storedStops.forget(sessionId)
    this.host.sessionsWentOnAtMs.delete(sessionId)
    this.host.stopHandOver.disarm(sessionId)
    codebookStopLedger.forget(sessionId)
  }

  /**
   * Notes a stop a debug adapter reported, for the frame the editor reports next, and ends the chat's record when the learner started that stop from an editor; called by {@link readAdaptersMessage} for every `stopped` event, and for an `invalidated` event that makes the editor handle the session's stops again.
   * A stop after a step ({@link LEARNER_STARTED_STOP_REASONS}) that is reported while a text editor has the keyboard was made by a learner who works in that editor: the keyboard is not to go to the chat at this stop, at a later render of it or when the run goes on, however short a time ago the learner came from the chat. While no text editor is active (the chat has the keyboard, and the step came from the debug toolbar) the record stays.
   * The note says when the stop was read, whether the editor's own handling of it may leave it in the background, and behind which other session's frame it was read ({@link StopNote}): both editors bring a stop to the front, with the keyboard into the paused file, only when the adapter did not ask to keep the focus and no frame of another session has it (VS Code 1.140 and Cursor 3.23, the stop handling of their debug sessions: `if(!p||p.thread.session===this)` for the view model's focused frame `p`).
   * @param sessionId - The session that stopped.
   * @param stop - What {@link debugStopOf} read: the reason the adapter gave, if any, and whether it asked to keep the focus.
   * @example this.noteStopOf(session.id, { reason: 'step', keepsFocus: false })
   */
  private noteStopOf(
    sessionId: string,
    stop: NonNullable<ReturnType<typeof debugStopOf>>,
  ): void {
    this.host.announcedStops.set(sessionId, {
      readAtMs: performance.now(),
      isDoubtful: stop.keepsFocus,
      behindSessionId: this.sessionOfFrameShownBeside(sessionId),
    })
    if (this.isLearnersStopFromEditor(stop.reason))
      this.host.keyboardOutsideEditors = undefined
    // The stop waits for the keyboard hand-over, which the editor's report of its frame resolves; a stop whose adapter asked to keep the focus never does.
    this.host.stopHandOver.arm(sessionId, stop)
  }

  /**
   * Names the other debug session whose frame Run and Debug shows while a given session stops; asked by {@link noteStopOf} when a stop is read.
   * The editor keeps the frame of a session that went on as its focused one for about 200 ms, and that of a session that is still paused for as long as it is: a stop of another session that is read meanwhile is not brought to the front at once by its own handling.
   * @param sessionId - The session that stopped.
   * @returns The id of the session of the active stack item while that item is a frame of another session; `undefined` for a frame of the same session, for a thread and without an item.
   * @example this.sessionOfFrameShownBeside('live-next-server') // => 'live-next-browser' while the browser session's frame is shown
   */
  private sessionOfFrameShownBeside(sessionId: string): string | undefined {
    const item = vscode.debug.activeStackItem
    return isStackFrameItem(item) && item.session.id !== sessionId
      ? item.session.id
      : undefined
  }

  /**
   * Marks the noted stop of a session that goes on as doubtful; called by {@link noteSessionWentOn} for every message that says so.
   * The note is not dropped there: a run that resumes its own stop at once does so before the editor reported that stop's frame, and the frame still arrives, with the keyboard in the paused file. A frame that arrives later than {@link STOP_OWN_FOCUS_BOUND_MS} after the stop was read is none of that stop: the learner selected it (another thread of the session is still paused), and it is not taken for a stop the editor never showed.
   * @param sessionId - The session that goes on.
   * @example this.doubtStopOf(sessionId)
   */
  private doubtStopOf(sessionId: string): void {
    const note = this.host.announcedStops.get(sessionId)
    if (note) note.isDoubtful = true
  }

  /**
   * Says whether a stop was started by the learner with the keyboard in a text editor; asked by {@link noteStopOf} when the adapter reports the stop, before the editor's debugger opens the paused file.
   * @param reason - The reason the adapter gave for the stop, if any.
   * @returns `true` for one of {@link LEARNER_STARTED_STOP_REASONS} while a text editor is the active one; `false` for every other reason, for none, and while no text editor is active.
   * @example this.isLearnersStopFromEditor('step') // => true while the learner steps in "actions.ts"
   */
  private isLearnersStopFromEditor(reason: string | undefined): boolean {
    return (
      reason !== undefined &&
      LEARNER_STARTED_STOP_REASONS.has(reason) &&
      vscode.window.activeTextEditor !== undefined
    )
  }

  /**
   * Says whether a stack frame the editor reports came with a stop of the debugger and not with the learner's choice of a frame in the Call Stack view, and takes the stop's note; asked by {@link judgeKeyboardAtStackItemChange} for every frame.
   * @param sessionId - The session of the frame.
   * @returns `true` when that session's adapter reported a stop since its last frame and the editor's own handling of that stop brought the frame ({@link wasShownByItsStop}), and for a session that started before this reader, whose adapter it does not hear: every frame of such a session counts as a stop, as nothing tells them apart. `false` for a frame without a stop (the learner selected it) and for a frame of a stop the editor brought to the front later and without the keyboard.
   * @example this.frameCameWithStop = this.cameWithStop(item.session.id)
   */
  private cameWithStop(sessionId: string): boolean {
    if (!this.host.followedSessions.has(sessionId)) return true
    const note = this.host.announcedStops.get(sessionId)
    this.host.announcedStops.delete(sessionId)
    return note !== undefined && this.host.wasShownByItsStop(note)
  }

  /**
   * Reads from the editor whether a tab outside the text editors and the Study panes has the keyboard, on every tab, group and active-editor change and on every change of a pane's view state; called by the listeners of {@link watchKeyboardOutsideEditors}, by the view-state listeners of {@link bindApplicationPanel} and {@link bindContextPanel} (a pane's `active` flag is one of the readings, and the editor reports it on its own channel, possibly after the tab events of the same click), and by {@link judgeKeyboardAtPauseEnd} when a pause is over.
   * A foreign tab that has it ({@link retainForeignTabFocus}) is remembered: the record is new, also during a pause, when the learner went to the chat, and keeps only the pause the old one noted. A text editor or a Study pane that becomes active afterwards only marks the moment ({@link markKeyboardLeftForEditors}); a pane's tab the editor merely names says nothing. The record is read all the time, between pauses and during them: the editor reports a pause as a stack frame and the running session as its thread, and no state of that item stops the reading.
   * @example this.sampleKeyboardOutsideEditors()
   */
  sampleKeyboardOutsideEditors(): void {
    const giveBack = this.host.retainForeignTabFocus(undefined)
    // A new reading of the chat keeps the pause the record noted: the chat that got the keyboard back at a pause is read again right after, and the pause is still that one.
    if (giveBack)
      this.host.keyboardOutsideEditors = {
        giveBack,
        pause: this.host.keyboardOutsideEditors?.pause,
      }
    else if (this.host.hasKeyboardInEditors()) this.markKeyboardLeftForEditors()
  }

  /**
   * Marks the moment a text editor or a Study pane became active after a foreign tab had the keyboard; called by {@link sampleKeyboardOutsideEditors} when the editor names no such tab any more and a text editor or Study pane is the active one.
   * The record is not ended there: the editor's debugger opens the paused file that way a moment before it reports the stack frame, also for a stop that follows the reader's return of the stop before, and {@link judgeKeyboardAtPauseBegin} tells that from a learner who went to a file. The first such moment is kept. An editor that has the keyboard because of the pause itself is no such moment ({@link holdsKeyboardByPause}).
   * @example this.markKeyboardLeftForEditors()
   */
  private markKeyboardLeftForEditors(): void {
    const remembered = this.host.keyboardOutsideEditors
    if (!remembered || this.host.holdsKeyboardByPause(remembered.pause)) return
    remembered.leftAtMs ??= performance.now()
  }

  /**
   * Follows the pauses of the editor's debugger, on every change of Run and Debug's active stack item; called by the listener of {@link watchKeyboardOutsideEditors}.
   * - A stack frame that came with a stop of the debugger ({@link cameWithStop}) is a pause: the debugger opened the paused file with the keyboard ({@link judgeKeyboardAtPauseBegin}).
   * - A stack frame without a stop is one the learner selected in the Call Stack view, or one the editor brought to the front without the keyboard: the editor opened its file without the keyboard, which stays where the learner has it. The reader then takes nothing and returns nothing for that pause any more ({@link leavePauseToLearner}), until the learner gives a sign of working in the editor it would cover ({@link noteLearnersSignAtFrame}).
   * - A thread without a frame, which the editor reports once the session runs again, and no item are the time between pauses ({@link judgeKeyboardAtPauseEnd}).
   * @example this.judgeKeyboardAtStackItemChange()
   */
  private judgeKeyboardAtStackItemChange(): void {
    const item = vscode.debug.activeStackItem
    this.host.frameCameWithStop =
      isStackFrameItem(item) && this.cameWithStop(item.session.id)
    // What the learner did before this item says nothing about it: the editor opened the frame's file before it reported the frame.
    this.host.learnerChoseEditorAtFrame = false
    this.previewTabOfFrame = this.previewTabInFront()
    if (this.host.frameCameWithStop) this.judgeKeyboardAtPauseBegin()
    else if (isStackFrameItem(item)) this.host.leavePauseToLearner()
    else this.judgeKeyboardAtPauseEnd()
    // A reported frame resolves its session's hand-over: nothing later in that pause is the paused file.
    this.host.stopHandOver.settle(
      heldStopSessionOf(item, this.host.stopHandOver),
    )
  }

  /**
   * Takes a sign that the learner works in the active text editor, while the editor shows a frame whose file it opened without the keyboard ({@link showsFrameOpenedWithoutKeyboard}); called by the listeners of {@link watchKeyboardOutsideEditors} with what the second or the third sign answered, and by {@link noteLearnersSelection} for the first.
   * For such a frame nothing the editor reports says where the keyboard went afterwards: a click of the mouse into the Call Stack view, a double click or Enter there (which give the file the keyboard) and the editor's "Navigate Up/Down Call Stack" commands (which do too) all report the file's opening and then the frame, in that order. So the reader does not decide by the gesture. It takes what the editor reports after the frame: the learner clicked or typed in the active text editor ({@link isLearnersSelection}), a text editor became the active one ({@link isLearnersEditor}), or the frame's preview tab was kept open ({@link keptPreviewTabOfFrame}). From then on {@link replacesEditorFocusedByPause} and {@link keepsKeyboardFromPane} treat the covered editor as one that has the keyboard. Without a sign the keyboard is taken to be where the learner had it.
   * @param given - Whether the sign was given.
   * @example this.noteLearnersSignAtFrame(this.isLearnersEditor(editor))
   */
  private noteLearnersSignAtFrame(given: boolean): void {
    if (given && this.showsFrameOpenedWithoutKeyboard())
      this.host.learnerChoseEditorAtFrame = true
  }

  /**
   * Takes the first sign, a selection the learner made in the active text editor, wherever the debugger stands; called by the selection listener of {@link watchKeyboardOutsideEditors}.
   * At a frame it counts like the other signs, until the next stack item ({@link noteLearnersSignAtFrame}). While no frame is shown (a session runs, or none exists) it is the only sign, and it counts for a short time only ({@link workedInEditorJustNow}).
   * @param change - The change the editor reports.
   * @example vscode.window.onDidChangeTextEditorSelection((change) => this.noteLearnersSelection(change))
   */
  private noteLearnersSelection(
    change: vscode.TextEditorSelectionChangeEvent,
  ): void {
    if (!this.isLearnersSelection(change)) return
    this.host.learnerWorkedInEditorAtMs = performance.now()
    this.noteLearnersSignAtFrame(true)
  }

  /**
   * Says whether Run and Debug shows a frame whose file the editor opened without giving it the keyboard; asked by {@link noteLearnersSignAtFrame}.
   * @returns `true` for a frame that came without a stop (the learner selected it, or the editor brought it to the front later), and for a frame of a stop while the learner's `debug.focusEditorOnBreak` is off; `false` for a stop's frame whose file the debugger gave the keyboard, for a thread and without an item.
   * @example this.showsFrameOpenedWithoutKeyboard() // => true after a click on a frame in the Call Stack view
   */
  private showsFrameOpenedWithoutKeyboard(): boolean {
    return (
      isStackFrameItem(vscode.debug.activeStackItem) &&
      !this.host.debuggerGaveEditorKeyboard()
    )
  }

  /**
   * Says whether a change of a text editor's selection is the learner's own in the active text editor: the first sign of {@link noteLearnersSignAtFrame}.
   * The editor names how a selection changed: by the keyboard or the mouse for the learner's own typing, cursor keys and clicks, and by a command for everything else, which includes the editor's own jump to a frame's line and a selection an extension sets ({@link LEARNER_SELECTION_KINDS}).
   * @param change - The change the editor reports.
   * @returns `true` for a change by the keyboard or the mouse in the active text editor; `false` for any other kind, for none, and for another editor.
   * @example this.isLearnersSelection(change) // => true after a click into the frame's file
   */
  private isLearnersSelection(
    change: vscode.TextEditorSelectionChangeEvent,
  ): boolean {
    return (
      LEARNER_SELECTION_KINDS.has(change.kind) &&
      change.textEditor === vscode.window.activeTextEditor
    )
  }

  /**
   * Names the file and the group of the tab in front of the active group when it is a preview tab of a text document; read by {@link judgeKeyboardAtStackItemChange} at every stack item, for {@link keptPreviewTabOfFrame}.
   * A frame's file that was not open before is opened as a preview tab by one click in the Call Stack view, and stays one until the learner keeps it.
   * @returns The document's URI and the group's view column, or `undefined` for a tab that is kept open, a tab that shows no text document, and an empty group.
   * @example this.previewTabOfFrame = this.previewTabInFront()
   */
  private previewTabInFront():
    NonNullable<PresentationGuards['previewTabOfFrame']> | undefined {
    const group = vscode.window.tabGroups.activeTabGroup
    const uri = this.host.textTabUri(group.activeTab)
    return group.activeTab?.isPreview && uri !== undefined
      ? { uri, column: group.viewColumn }
      : undefined
  }

  /**
   * Says whether the preview tab the editor showed for the frame was kept open since and is still in front: the third sign of {@link noteLearnersSignAtFrame}.
   * A double click on a frame in the Call Stack view, and Enter there, open the frame's file a second time, with the keyboard and as a tab that is kept: for a frame that is already the selected one, the editor reports nothing else of it (no new frame, no new active editor, and the selection stays on the frame's line). A tab that is kept because its file was changed says nothing about the keyboard, since an agent's edit keeps a preview tab too.
   * The current tab is read by document and view column: Cursor 3.23 rebuilds its tab objects on a whole-model update, leaving a remembered object's preview and dirty values stale. VS Code 1.140 reconciles existing tab IDs, but the third sign must work in both editors.
   * @returns `true` when the tab in front of the active group shows the document noted at the frame in the same view column, is no preview tab and has no unsaved change; `false` otherwise, and when the frame's tab was no preview tab.
   * @example this.noteLearnersSignAtFrame(this.keptPreviewTabOfFrame())
   */
  private keptPreviewTabOfFrame(): boolean {
    const noted = this.previewTabOfFrame
    const group = vscode.window.tabGroups.activeTabGroup
    return (
      noted !== undefined &&
      group.viewColumn === noted.column &&
      this.isKeptTabOf(group.activeTab, noted.uri)
    )
  }

  /**
   * Says whether a tab shows a given document as a kept tab without unsaved changes; asked by {@link keptPreviewTabOfFrame} about the tab in front of the active group.
   * @param tab - The tab, read from the editor now.
   * @param uri - The document's URI as a string.
   * @returns `true` for a text tab of that document that is no preview tab and not dirty; `false` otherwise, and without a tab.
   * @example this.isKeptTabOf(group.activeTab, noted.uri)
   */
  private isKeptTabOf(tab: vscode.Tab | undefined, uri: string): boolean {
    return (
      tab !== undefined &&
      this.host.textTabUri(tab) === uri &&
      !tab.isPreview &&
      !tab.isDirty
    )
  }

  /**
   * Judges the chat's record when the editor reports a stack frame; the first half of {@link judgeKeyboardAtStackItemChange}.
   * Every frame is taken as a stop of its own: a thread that goes on and stops again within the 200 ms the editor waits before it reports a running session is reported as a frame after a frame, with no item between them (two breakpoints of one request). {@link leftChatBeforePause} tells the paused file the debugger opened from a file the learner chose earlier: the learner's choice ends the record. The debugger's own opening leaves it, and the pause is noted on the record with the document the debugger opened, for the reader's one return of that pause. The same holds for a stop that follows a settled one: an editor that became active after the reader's return is the next paused file when its frame follows within that time, and the learner's choice otherwise. A frame the learner selects in the Call Stack view is no stop and does not come here ({@link cameWithStop}).
   * @example this.judgeKeyboardAtPauseBegin()
   */
  private judgeKeyboardAtPauseBegin(): void {
    // A stop Codebook does not own is the learner's: its file gets the keyboard, and no return to the chat is owed for it.
    if (this.holdsStopKeyboard()) {
      this.handOverStopKeyboard()
      this.host.leavePauseToLearner()
      return
    }
    const remembered = this.host.keyboardOutsideEditors
    if (!remembered) return
    if (this.leftChatBeforePause(remembered.leftAtMs)) {
      this.host.keyboardOutsideEditors = undefined
      return
    }
    remembered.leftAtMs = undefined
    remembered.pause = {
      openedByDebugger: this.host.activeTextDocumentUri(),
      state: 'unsettled',
    }
    // Restore known chat ownership before historical capture can delay the first reveal.
    if (this.canReturnKeyboardAtFrame(remembered.pause))
      void this.host.returnsKeyboardToChatAtPause().catch(() => false)
  }

  /**
   * Checks the debugger-owned file before {@link judgeKeyboardAtPauseBegin} returns chat focus early.
   * @param pause - The newly observed pause, before historical capture completes.
   * @returns Whether a live debugger gave its actual stopped file the keyboard.
   * @example if (this.canReturnKeyboardAtFrame(pause)) void this.returnsKeyboardToChatAtPause()
   */
  private canReturnKeyboardAtFrame(pause: KeyboardPauseOfRecord): boolean {
    return (
      this.holdsKeyboardSinceBreak(pause.openedByDebugger) &&
      this.host.debuggerGaveEditorKeyboard()
    )
  }

  /**
   * Ends the pause the chat's record noted, when the editor reports a thread or no item, and reads the record again; the second half of {@link judgeKeyboardAtStackItemChange}.
   * A return that {@link endsPauseOfRecord} started is not followed by a reading: the debugger's file is still the active editor until the chat's command is answered.
   * @example this.judgeKeyboardAtPauseEnd()
   */
  private judgeKeyboardAtPauseEnd(): void {
    if (!this.endsPauseOfRecord()) this.host.sampleKeyboardOutsideEditors()
  }

  /**
   * Removes a pause that is over from the chat's record and settles what it leaves ({@link leavesRecordAfterPause}); the first step of {@link judgeKeyboardAtPauseEnd}.
   * @returns `true` when the chat's focus command was started for a pause the reader had not settled; `false` otherwise, and without a record or a noted pause.
   * @example if (!this.endsPauseOfRecord()) this.sampleKeyboardOutsideEditors()
   */
  private endsPauseOfRecord(): boolean {
    const remembered = this.host.keyboardOutsideEditors
    if (!remembered?.pause) return false
    const pause = remembered.pause
    remembered.pause = undefined
    if (this.leavesRecordAfterPause(pause)) return false
    const learnerSignAtEnd = this.host.learnerWorkedInEditorAtMs
    // A return the editor refuses leaves the keyboard where it is; a learner's click or key, a new stop or a lost window focus while the return looks up its command revokes it (OCR1-10).
    void this.host
      .giveKeyboardBackAtPause(remembered, () =>
        this.keepsPauseEndReturnCurrent(remembered, learnerSignAtEnd),
      )
      .catch(() => false)
    return true
  }

  /**
   * Rechecks, after native command discovery, that the return a pause's end owes the chat is still owed; the `stillCurrent` {@link endsPauseOfRecord} gives {@link giveKeyboardBackAtPause}, as {@link keepsPauseReturnCurrent} is for the return of a reveal.
   * @param remembered - The chat's record the pause's end gave the return to.
   * @param learnerSignAtEnd - The learner's last click or key in a text editor when the pause ended ({@link noteLearnersSelection}).
   * @returns `true` while the window has the focus, the record is still that one, no new pause is noted on it and the learner gave no new sign; `false` otherwise.
   * @example this.keepsPauseEndReturnCurrent(remembered, learnerSignAtEnd) // => false right after the learner clicked into the paused file
   */
  private keepsPauseEndReturnCurrent(
    remembered: NonNullable<StudyWorkspace['keyboardOutsideEditors']>,
    learnerSignAtEnd: number | undefined,
  ): boolean {
    return (
      vscode.window.state.focused &&
      this.host.keyboardOutsideEditors === remembered &&
      remembered.pause === undefined &&
      this.host.learnerWorkedInEditorAtMs === learnerSignAtEnd
    )
  }

  /**
   * Decides what a pause that is over leaves of the chat's record, and ends the record where the learner chose an editor; asked by {@link endsPauseOfRecord}.
   * - Neither a text editor nor a Study pane is active: the chat has the keyboard, and the record stays. So it does while the reader's return of that pause still runs.
   * - The reader settled the pause and a text editor or Study pane is active: the learner chose it after the return, and the record ends.
   * - The pause ended before the reader settled it and another text editor than the debugger's, or a Study pane, is active: it was chosen during the pause, and the record ends.
   * - The pause ended before the reader settled it, and the file the debugger opened for it is still the active text editor beside a live run ({@link holdsKeyboardSinceBreak}): nobody chose that file and nothing of the reader took its place, as when the run resumes a stop by itself. The record stays, and the chat is owed the keyboard now.
   * @param pause - The pause the record noted.
   * @returns `false` only in the last case; `true` when nothing more is to be done.
   * @example if (this.leavesRecordAfterPause(pause)) return false
   */
  private leavesRecordAfterPause(pause: KeyboardPauseOfRecord): boolean {
    if (pause.state === 'settling' || !this.host.hasKeyboardInEditors())
      return true
    if (this.choseEditorAtPause(pause)) {
      this.host.keyboardOutsideEditors = undefined
      return true
    }
    return false
  }

  /**
   * Says whether the editor that is active when a pause is over was the learner's choice; asked by {@link leavesRecordAfterPause} once a text editor or Study pane is known to be active.
   * @param pause - The pause the record noted.
   * @returns `true` for a pause the reader settled (the chat had the keyboard after it), and for an unsettled one unless the debugger's own file is still the active text editor beside a live run ({@link holdsKeyboardSinceBreak}).
   * @example if (this.choseEditorAtPause(pause)) this.keyboardOutsideEditors = undefined
   */
  private choseEditorAtPause(pause: KeyboardPauseOfRecord): boolean {
    return (
      pause.state === 'settled' ||
      !this.holdsKeyboardSinceBreak(pause.openedByDebugger)
    )
  }

  /**
   * Says whether the file the editor's debugger opened at a break still has the keyboard beside a live run; asked by {@link choseEditorAtPause}.
   * Only beside a live run of Codebook ({@link hasLiveRun}): in a debug session of the learner's own the reader moves no keyboard.
   * @param openedByDebugger - The document that was the active text editor when the pause's frame was reported, if any.
   * @returns `true` when a live run's viewport exists and that document is the active text editor now; `false` for another document, for none, and without a live run.
   * @example this.holdsKeyboardSinceBreak(pause.openedByDebugger)
   */
  private holdsKeyboardSinceBreak(
    openedByDebugger: string | undefined,
  ): boolean {
    return (
      this.host.hasLiveRun() &&
      this.host.holdsDebuggersFileOfPause(openedByDebugger)
    )
  }

  /**
   * Says whether a text editor or Study pane that became active before a pause was the learner's own choice; asked by {@link judgeKeyboardAtPauseBegin} when Run and Debug selects a stack item.
   * The editor's debugger awaits the opening of the paused file, with the keyboard, and selects the stack item after it (Cursor 3.23.12, `focusStackFrame` of its workbench), so the extension host sees that file become the active text editor a moment before it sees the pause. An editor that became active within {@link PAUSE_FOCUS_LOOKBACK_MS} before the stack item is taken as that opening. The price: a learner who goes from the chat to a file within that time before a pause is treated as still being in the chat.
   * @param leftAtMs - The moment {@link markKeyboardLeftForEditors} marked, `undefined` when no editor became active since the foreign tab had the keyboard.
   * @returns `true` when an editor became active more than {@link PAUSE_FOCUS_LOOKBACK_MS} ago; `false` within that time and without a marked moment.
   * @example this.leftChatBeforePause(performance.now() - 1_001) // => true
   */
  private leftChatBeforePause(leftAtMs: number | undefined): boolean {
    return (
      leftAtMs !== undefined &&
      performance.now() - leftAtMs > PAUSE_FOCUS_LOOKBACK_MS
    )
  }

  /**
   * Says whether another editor part holds the keyboard over a text tab; asked by {@link textTabUriHeldByAnotherPart} once no Study pane and no text editor is active.
   * A text tab named as the active tab while its text editor is visible and no text editor is active: another editor part (the chat input) holds the keyboard, and the editor does not name that part's group. That holds for a learner's file and for the reader's own captured source. A text tab that has no text editor at all says nothing about another part.
   * @param tab - The active tab, if any.
   * @param group - The group the editor names as active.
   * @returns `true` for a text tab whose text editor is visible in that group; `false` for any other tab, a text tab without a text editor, and no tab.
   * @example this.isTextTabHeldByAnotherPart(group.activeTab, group)
   */
  private isTextTabHeldByAnotherPart(
    tab: vscode.Tab | undefined,
    group: vscode.TabGroup,
  ): boolean {
    return (
      tab?.input instanceof vscode.TabInputText &&
      this.hasVisibleTextEditor(tab.input.uri, group.viewColumn)
    )
  }

  /**
   * Names the document of the active tab when another editor part holds the keyboard over it; read by {@link retainForeignTabFocus} once no Study pane and no text editor is active.
   * @param tab - The active tab, if any.
   * @param group - The group the editor names as active.
   * @returns The document's URI as a string when {@link isTextTabHeldByAnotherPart} holds; otherwise `undefined`.
   * @example const heldUri = this.textTabUriHeldByAnotherPart(group.activeTab, group)
   */
  private textTabUriHeldByAnotherPart(
    tab: vscode.Tab | undefined,
    group: vscode.TabGroup,
  ): string | undefined {
    const namedUri = this.host.textTabUri(tab)
    return this.isTextTabHeldByAnotherPart(tab, group) ? namedUri : undefined
  }

  /**
   * Says whether a tab is Codebook's own and has no focus to give back: a captured source without a text editor, or a Study pane's tab; the last condition of {@link isTabWithoutFocusReturn}.
   * The editor can still name a Study pane's tab as the active one while another editor part has the keyboard: that is no foreign tab to return to (an arrangement of the live panes no pane's control asked for reads it as the chat's place before it asks this, {@link retainForeignTabFocus}'s `withoutPanePress`). A captured source without a text editor has no focus that could be kept.
   * @param tab - The tab the editor names as active.
   * @param heldByAnotherPart - Whether another editor part holds the keyboard over that tab's visible text editor.
   * @returns `true` for a captured source that is not held by another part, and for an Application or Study pane's tab.
   * @example this.isCodebookTabWithoutFocus(tab, false)
   */
  private isCodebookTabWithoutFocus(
    tab: vscode.Tab,
    heldByAnotherPart: boolean,
  ): boolean {
    return (
      (this.host.isCapturedSourceInput(tab.input) && !heldByAnotherPart) ||
      this.isStudyPaneInput(tab.input)
    )
  }

  /**
   * Says whether the tab the editor names is the Repository Wiki's while the Wiki's panel is not the active editor, which is where another editor part's chat input holds the keyboard; asked by {@link retainForeignTabFocus} before it picks the tab to give the keyboard back to (row 680).
   * Cursor's Focus Agent gives its chat input the keyboard and changes no tab or group, so the editor goes on naming the group it named, the Wiki's when the learner read the Wiki last (C59 c59-5-cu-cold: the window's title named the Wiki, the agent's cold select ran `workbench.action.focusFourthEditorGroup` for the Wiki's group and the chat got nothing back for 34.7 s); a pane whose tab is named is then not active, as for the Study panes of rows 628 and 638. The Wiki that has the keyboard is active, and keeps its group's return.
   * @param tab - The tab the editor names as active, if any.
   * @returns `true` for the Repository Wiki's tab while the embedder reports its panel not active; `false` for any other tab, none, and an embedder that does not tell.
   * @example this.isWikiTabWithoutKeyboard(vscode.window.tabGroups.activeTabGroup.activeTab) // => true after Focus Agent while Cursor names the Wiki's group
   */
  private isWikiTabWithoutKeyboard(tab: vscode.Tab | undefined): boolean {
    return (
      this.host.isCodebookPaneInput(tab?.input, 'codebook.repositoryWiki') &&
      this.host.controls.repositoryWikiActive?.() === false
    )
  }

  /**
   * Says whether a tab input is one of the reader's two Study panes, the Application pane or the Study pane; asked by {@link isCodebookTabWithoutFocus} and by {@link retainForeignTabFocus}.
   * @param input - A tab's input, if any.
   * @returns `true` for the webview of `codebook.scopedBrowser` or `codebook.studyContext`; `false` for every other input and none.
   * @example this.isStudyPaneInput(vscode.window.tabGroups.activeTabGroup.activeTab?.input) // => true while the editor names the Application pane's tab
   */
  private isStudyPaneInput(input: unknown): boolean {
    return this.host.isCodebookPaneInput(
      input,
      'codebook.scopedBrowser',
      'codebook.studyContext',
    )
  }

  /**
   * Says whether the active tab is one {@link retainForeignTabFocus} gives no focus back to; asked by {@link foreignTabToReturnTo}.
   * @param tab - The tab the editor names as active.
   * @param activatedByClose - The tab the editor activated in place of a focused leftover tab this selection just closed.
   * @param heldByAnotherPart - Whether another editor part holds the keyboard over that tab's visible text editor.
   * @returns `true` for the tab activated by that close, a preview, and a tab {@link isCodebookTabWithoutFocus} names.
   * @example this.isTabWithoutFocusReturn(tab, undefined, false)
   */
  private isTabWithoutFocusReturn(
    tab: vscode.Tab,
    activatedByClose: vscode.Tab | undefined,
    heldByAnotherPart: boolean,
  ): boolean {
    return (
      tab === activatedByClose ||
      tab.isPreview ||
      this.isCodebookTabWithoutFocus(tab, heldByAnotherPart)
    )
  }

  /**
   * Finds the foreign tab whose group gets the keyboard back after an arrangement; asked by {@link retainForeignTabFocus} about the active tab.
   * @param tab - The tab the editor names as active, if any.
   * @param activatedByClose - The tab the editor activated in place of a focused leftover tab this selection just closed.
   * @param heldByAnotherPart - Whether another editor part holds the keyboard over that tab's visible text editor.
   * @returns The tab, or `undefined` when no tab is active or {@link isTabWithoutFocusReturn} holds for it.
   * @example const tab = this.foreignTabToReturnTo(group.activeTab, activatedByClose, heldByAnotherPart)
   */
  private foreignTabToReturnTo(
    tab: vscode.Tab | undefined,
    activatedByClose: vscode.Tab | undefined,
    heldByAnotherPart: boolean,
  ): vscode.Tab | undefined {
    if (
      !tab ||
      this.isTabWithoutFocusReturn(tab, activatedByClose, heldByAnotherPart)
    )
      return undefined
    return tab
  }

  /**
   * Ends a Read's maximization for an admitted change and shows the side bars the Read hid ({@link showSideBarsHiddenByRead}); run through {@link trackFocusedStudyPane}'s `endReadMaximization` by the live branch of {@link admitPresentation} and by {@link restoreStudyArrangement}.
   * The bars' show commands take the keyboard (VS Code 1.140.0 `workbench.desktop.main.js` 1113:32927, 859:17722; Cursor 3.23.12 18340:22765, 17376:10844) and the active editor group, the pane being read, gets it after them. A Read leaves the bottom panel shown, so for an agent's request the learner may have been typing in its terminal, in a view or in a chat, which Codebook cannot tell: unless the keyboard's place is known, the learner is told once where it is now ({@link READ_ENDED_FOR_AGENT_KEYBOARD_MESSAGE}, row 622).
   * @param requester - Who asked for the change.
   * @param knowsKeyboardPlace - Whether the keyboard was known to be in the editor ({@link knowsKeyboardPlaceAtAdmission}) or goes back to a chat tab after the arrangement.
   * @example await focusedPane.endReadMaximization(() => this.endReadForAdmission('agent', false)) // tells once after the bars were shown
   */
  private async endReadForAdmission(
    requester: PresentationRequester,
    knowsKeyboardPlace: boolean,
  ): Promise<void> {
    await this.host.expandToEndMaximization()
    this.host.maximizedByRead = false
    const shownBars = await this.host.showSideBarsHiddenByRead()
    // The learner's own request comes from the pane being read, which gets the keyboard back.
    if (!shownBars || requester !== 'agent' || knowsKeyboardPlace) return
    tellKeyboardNoticeOnce('readEnded', READ_ENDED_FOR_AGENT_KEYBOARD_MESSAGE)
  }

  /**
   * Tells whether a text editor shows a document in an editor group now, for {@link capturePresentationFocus} and {@link retainForeignTabFocus}: a text tab the editor names as active without an active text editor has its editor visible while another editor part holds the keyboard, and has none when the editor could not load it.
   * @param uri - The document of the named tab.
   * @param column - The view column of the group that shows the tab.
   * @returns `true` when one of the visible text editors shows that document in that column.
   * @example
   * ```ts
   * this.hasVisibleTextEditor(tab.input.uri, group.viewColumn) // => true for "Captured-login-form.tsx" in group 2 while Cursor's chat input has the keyboard
   * ```
   */
  private hasVisibleTextEditor(
    uri: vscode.Uri,
    column: vscode.ViewColumn,
  ): boolean {
    return vscode.window.visibleTextEditors.some(
      (editor) =>
        editor.viewColumn === column &&
        editor.document.uri.toString() === uri.toString(),
    )
  }

  /**
   * Tells the focus restoration of {@link capturePresentationFocus} that a confirmed placement put the captured source into the group of the learner's focused document; fronting that document again would cover the source and leave the layout unconfirmed.
   * @param document - The learner's document that had focus when the presentation change was admitted.
   * @param group - The group that holds that document now.
   * @param placedSourceStays - `true` only when the placement was confirmed; a failed change gives the document its focus back.
   * @returns
   * - `true` when the document shares the placed source's group: it stays open behind the source, in the group that has the focus.
   * - `false` when the change failed, the document is the captured source itself, or it sits in another group.
   * @example
   * ```ts
   * if (this.staysBehindPlacedSource(document, currentGroup, true)) return
   * ```
   */
  private staysBehindPlacedSource(
    document: vscode.TextDocument,
    group: vscode.TabGroup,
    placedSourceStays = false,
  ): boolean {
    return (
      placedSourceStays &&
      group === this.host.studyPanePositions().sourceGroup &&
      document.uri.toString() !== String(this.host.sourceUri)
    )
  }

  /**
   * Resolves Read/Restore's native group when Cursor reports a focused text editor before its chat tab model; called by {@link trackFocusedStudyPane}.
   * @param allowTextEditorFallback - The same opaque tab observed at the start is still named; a new native tab choice always takes precedence.
   * @returns The matching text-editor group behind an opaque chat tab, otherwise the group the editor names.
   * @example const group = this.readingFocusGroup(sameOpaqueTab)
   */
  private readingFocusGroup(allowTextEditorFallback: boolean): vscode.TabGroup {
    const namedGroup = vscode.window.tabGroups.activeTabGroup
    // Never reinterpret a new native tab choice as the old source editor.
    if (!allowTextEditorFallback) return namedGroup
    const editor = vscode.window.activeTextEditor
    // A chat without an active text editor still uses its native tab identity.
    if (!editor) return namedGroup
    return (
      vscode.window.tabGroups.all.find(
        (candidate) =>
          candidate.viewColumn === editor.viewColumn &&
          candidate.activeTab?.input instanceof vscode.TabInputText &&
          candidate.activeTab.input.uri.toString() ===
            editor.document.uri.toString(),
      ) ?? namedGroup
    )
  }

  /**
   * Watches Read and Restore so later learner navigation wins over host commands.
   * @param requireOwned - Require a Codebook pane after Read has focused its requested surface.
   * @param fallbackOrigin - Logical opaque-tab identity captured before Read's focus handoff; a later choice cannot supply this origin.
   * @returns A disposable focus watch that rejects later learner departures and tracks explicitly borrowed native focus.
   * @example const focus = this.trackFocusedStudyPane(); focus.assertCurrent(); focus.dispose()
   */
  trackFocusedStudyPane(
    requireOwned = false,
    fallbackOrigin = this.host.readingFocusOrigin(),
  ): {
    /** Throws when the learner changed the focus since the watch began; a focus the measurement borrowed and has not given back yet is no such change. */
    assertUndeparted(): void
    assertCurrent(): void
    beforeScopeFocus(acquire?: RepositoryFocusTarget): void
    endReadMaximization(end: () => Promise<void>): Promise<void>
    dispose(): void
  } {
    // Wrapper-only updates preserve identity; a different logical group or selected tab revokes it.
    const currentReadingGroup = (): vscode.TabGroup => {
      const current = this.host.readingFocusOrigin()
      return this.readingFocusGroup(
        fallbackOrigin.opaque &&
          fallbackOrigin.groupIdentity !== undefined &&
          fallbackOrigin.groupIdentity === current.groupIdentity &&
          fallbackOrigin.tabKey === current.tabKey,
      )
    }
    const group = currentReadingGroup(),
      input = group.activeTab?.input
    const expectedColumn = group.viewColumn
    const panes = this.host.studyPanePositions(),
      sourceUri = this.host.sourceUri?.toString()
    const webviewKind =
      input instanceof vscode.TabInputWebview ? input.viewType : undefined
    const appKind =
      webviewKind !== undefined &&
      isCodebookPaneViewType(webviewKind, 'codebook.scopedBrowser') &&
      expectedColumn === panes.appColumn
    const contextKind =
      webviewKind !== undefined &&
      isCodebookPaneViewType(webviewKind, 'codebook.studyContext') &&
      expectedColumn === panes.contextColumn
    const sourceKind =
      input instanceof vscode.TabInputText &&
      input.uri.toString() === sourceUri &&
      expectedColumn === panes.sourceColumn
    if (requireOwned && !appKind && !contextKind && !sourceKind)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'Focus an owned Study pane before changing its reading layout.',
      )
    const textUri =
      input instanceof vscode.TabInputText ? input.uri.toString() : undefined
    const retainsFocus = () => {
      const active = currentReadingGroup(),
        current = active.activeTab?.input
      return (
        vscode.window.state.focused &&
        active.viewColumn === expectedColumn &&
        (textUri !== undefined
          ? current instanceof vscode.TabInputText &&
            current.uri.toString() === textUri
          : webviewKind !== undefined
            ? current instanceof vscode.TabInputWebview &&
              current.viewType === webviewKind
            : current === input)
      )
    }
    let departed = false,
      borrowed: RepositoryFocusTarget | undefined,
      pendingBorrow: RepositoryFocusTarget | undefined,
      endingMaximization = false
    const observe = (): void => {
      if (departed) return
      // Leaving the work window revokes Restore even if focus returns before native measurement completes.
      if (!vscode.window.state.focused) {
        departed = true
        return
      }
      // While Codebook's own commands end a Read's maximization, the editor's group events are judged by the focus they leave once they settled.
      if (endingMaximization) return
      if (pendingBorrow?.matchesGroup()) {
        // Only the announced native target can replace the old focus; returning to the original pane ends the borrow.
        borrowed = retainsFocus() ? undefined : pendingBorrow
        pendingBorrow = undefined
      } else if (!(borrowed?.matchesGroup() ?? retainsFocus())) departed = true
    }
    const assertRetained = (): void => {
      observe()
      if (departed)
        throw new StudyError(
          'PRESENTATION_UNAVAILABLE',
          'The learner changed native tab focus while the Study layout command was pending. The newer choice was preserved.',
        )
    }
    const subscriptions = [
      vscode.window.tabGroups.onDidChangeTabs(observe),
      vscode.window.tabGroups.onDidChangeTabGroups(observe),
      vscode.window.onDidChangeActiveTextEditor(observe),
      vscode.window.onDidChangeWindowState(observe),
    ]
    return {
      assertUndeparted: assertRetained,
      assertCurrent(): void {
        assertRetained()
        if (borrowed || pendingBorrow || !retainsFocus())
          throw new StudyError(
            'PRESENTATION_UNAVAILABLE',
            'The Study pane did not regain native focus after layout measurement.',
          )
      },
      beforeScopeFocus(acquire): void {
        assertRetained()
        if (!acquire || pendingBorrow)
          throw new StudyError(
            'PRESENTATION_UNAVAILABLE',
            'The Study scope focus target could not be retained safely.',
          )
        pendingBorrow = acquire
        observe()
      },
      /**
       * Runs Codebook's own commands that end a Read's maximization (the un-maximize and the side bars shown again); called by the live branch of {@link admitPresentation} and by {@link restoreStudyArrangement} before they measure.
       * Cursor names another editor group as the active one for a moment while a maximization ends (Cycle 0045 NF-7b): an active group the editor names while these commands run, and one it names again within {@link UNMAXIMIZE_FOCUS_SETTLE_MS} after them, is their event, not the learner's change. A change that lasts past that moment, and leaving the work window, still count.
       * @param end - The commands that end the maximization.
       * @returns Once the commands answered and the editor names the watched focus again, or the settle time passed.
       * @throws What `end` throws.
       * @example
       * ```ts
       * await focusedPane.endReadMaximization(async () => {
       *   await this.executeEditorCommand('workbench.action.minimizeOtherEditors')
       *   await this.showSideBarsHiddenByRead()
       * })
       * ```
       */
      async endReadMaximization(end): Promise<void> {
        endingMaximization = true
        try {
          await end()
          // A group named for the un-maximize alone gives way to the watched focus within the settle time; a change that lasts is the learner's.
          await waitUntil(
            () => !vscode.window.state.focused || retainsFocus(),
            'the focus after the maximization ended',
            UNMAXIMIZE_FOCUS_SETTLE_MS,
          ).catch(() => undefined)
        } finally {
          endingMaximization = false
        }
        observe()
      },
      dispose(): void {
        for (const subscription of subscriptions) subscription.dispose()
      },
    }
  }

  /**
   * Moves the focus baseline of a placement guard to another own pane when the editor's active group moved from one of Codebook's own panes to another own pane without a change of the learner's text editor; asked by the guard of {@link retainPresentationPlacement} each time it asserts, where Cursor 3.27.22 names the Application's group active again moments after the Study pane took the focus in an entry ({@link open}).
   * @param accepts - Whether the guard began in an entry's arrangement with the focus in an own pane.
   * @param active - The group the editor names active now.
   * @param baseline - What the guard compared against so far.
   * @returns The new baseline for such a report; `baseline` itself for a learner's text tab, a group without an own pane in front, or a guard outside an entry.
   * @example this.adoptOwnPaneFocusReport(true, applicationGroup, baseline) // => a baseline naming the Application's group and tab
   */
  adoptOwnPaneFocusReport<
    Baseline extends {
      nativeGroup: vscode.TabGroup
      focusedGroup: unknown
      retainedFocus: { editor: string; group: unknown }
    },
  >(accepts: boolean, active: vscode.TabGroup, baseline: Baseline): Baseline {
    const input = active.activeTab?.input
    if (
      !accepts ||
      active === baseline.nativeGroup ||
      !(input instanceof vscode.TabInputWebview) ||
      !this.host.isCodebookPaneInput(input, ...STUDY_PANE_KINDS) ||
      // A pane an earlier extension host left behind is no pane of this reader's: the learner's click into it is the learner's.
      !active.activeTab ||
      !this.host.isOwnPaneOrSourceTab(active.activeTab) ||
      textEditorFocusState(vscode.window.activeTextEditor) !==
        baseline.retainedFocus.editor
    )
      return baseline
    const group = this.host.editorGroupIdentities.get(active)
    return {
      ...baseline,
      nativeGroup: active,
      focusedTab: active.activeTab,
      focusedGroup: group,
      focusedWebview: input.viewType,
      focusedWebviewCloseRevision: this.host.webviewCloseRevisions.get(
        input.viewType,
      ),
      appActive: this.host.app?.active,
      contextActive: this.host.contextPanel?.active,
      retainedFocus: { ...baseline.retainedFocus, group },
    }
  }

  /**
   * Says whether the Application's own active report flipped from active to inactive as the editor's noise and not as the learner's input; asked by the guard of {@link retainPresentationPlacement} for its `appActive` comparison, in every host and for every presentation, entry and return.
   * Cursor 3.27.22 reports the Application inactive while its group is still the active one and nothing else changed, moments after Codebook itself moved panes or focus (Cycle 0072 native C72-2, candidate ddc14faa attempt 2: +13 ms after the guard armed, Codebook's effects none since arming). The same state follows a learner's click into the Agent chat, which Cursor does not name as the active group, so the report alone cannot tell them apart: only a flip that comes within {@link OWN_EFFECT_NOISE_WINDOW_MS} of Codebook's own newest native effect counts as noise. The opposite flip (inactive to active) is the learner's click into the Application and stays compared, as does the Study pane's report.
   * @param armedActive - The Application's active report when the guard armed.
   * @returns `true` for an active-to-inactive flip while the active group still shows this reader's Application in front, soon after an effect of Codebook's own; `false` otherwise.
   * @example this.isApplicationInactiveReportNoise(true) // => true 20 ms after Codebook revealed the Application and Cursor reported it inactive
   */
  isApplicationInactiveReportNoise(armedActive: boolean | undefined): boolean {
    const front = vscode.window.tabGroups.activeTabGroup.activeTab,
      latestEffectMs = this.host.placementEffects.latestAtMs()
    return Boolean(
      armedActive === true &&
      this.host.app?.active === false &&
      front &&
      this.host.isCodebookPaneInput(front.input, 'codebook.scopedBrowser') &&
      this.host.isOwnPaneOrSourceTab(front) &&
      latestEffectMs !== undefined &&
      performance.now() - latestEffectMs <= OWN_EFFECT_NOISE_WINDOW_MS,
    )
  }

  /**
   * Ends the note that Codebook's own placement gave the captured source the keyboard ({@link noteSourceKeyboardPlacement}) once the editor reports another active text editor while no presentation change, Return or arrangement of Codebook's runs and no render shows the captured source, and notes whether that move landed on the captured source; called by the active-text-editor listener of {@link watchKeyboardOutsideEditors} (row 654).
   * A render's display ({@link renderSelection}, from its show until it settles, while {@link pendingSourceDisplay} names it) is Codebook's own too: a background render's pause take shows the captured source with the keyboard over the file the debugger focused, and an evidence reentry gives it the keyboard in place of a copy it retires ({@link retireMovedSourceCopies}); neither is the learner's move (row 684). The broader `loading` is not used: it also lasts through a render's wait for its predecessor and a history load, where a reported change is the learner's. So is an Application preparation's focus return, which gives the keyboard back where the preparation took it ({@link returnPreparationFocusAsCodebook}, row 692).
   * Such a change is the learner's move: a click, a key, or a command such as the editor's numbered group focus, which moves no caret and so leaves no sign for {@link noteLearnersSelection}. A copy of the captured source the learner moved to is then the learner's place ({@link knowsLearnersPlace}): an agent's Return gives it the keyboard back and {@link retireMovedSourceCopies} keeps it. The editor reports nothing when the keyboard goes from a file to the terminal or a view and back, so a move it does not report cannot be told.
   * @param editor - The active text editor the editor reports now, `undefined` for none (the chat, a pane).
   * @example this.endSourceKeyboardPlacementAtLearnersMove(vscode.window.activeTextEditor) // after the learner's numbered group focus onto the captured source: the placement is the learner's now
   */
  private endSourceKeyboardPlacementAtLearnersMove(
    editor: vscode.TextEditor | undefined,
  ): void {
    // Codebook's own focus changes while it places or returns, while an Application preparation gives the keyboard back (row 692), or while a render shows the captured source (row 684), are no move of the learner's.
    if (
      this.host.presentationTransition !== undefined ||
      this.host.presentationOperation !== undefined ||
      this.host.returningCurrent !== undefined ||
      this.host.arranging !== undefined ||
      this.host.placingPresentation ||
      this.host.returningPreparationFocus ||
      this.host.pendingSourceDisplay !== undefined
    )
      return
    this.host.sourceKeyboardPlacedAtMs = undefined
    this.host.learnerMovedToSource = editorShowsDocument(
      editor,
      this.host.sourceUri,
    )
  }

  /**
   * Gives the keyboard to the file the editor's debugger opened at a stop Codebook did not cause, once per stop, when the editor reports that stop's frame; called by {@link judgeKeyboardAtPauseBegin} for a frame that came with a stop whose hand-over is due ({@link holdsStopKeyboard}), which also settles the pause to the learner.
   * Under Codebook's contributed `debug.focusEditorOnBreak: false`, VS Code and Cursor open the paused file in the active group preserving the focus, which hides the editor that had the keyboard and leaves it on no element (Cycle 0046 finding 589: a learner's Step Into, an adapter refresh after a palette command). At a stop the run caused the chat keeps the keyboard ({@link returnsKeyboardToChatAtPause}); at any other stop the paused file gets it, as the editor's own default would give it.
   * The editor reports the frame after the paused file's opening, so the active text editor is that file then, also when it was in front already and no active-editor change came for the stop (a step within the file, Cycle 0046 finding 603); see {@link pausedEditorOfStop}. A frame that came without its stop (the editor's pass of the focus, the learner's click in the Call Stack view, both preserving the focus) and a text editor that becomes active later in the pause get no keyboard, as with the editor's default (findings 602 and 603). A paused file whose opening was recognized as such got the keyboard at once ({@link handOverAtPausedFileOpening}), and its stop is done here.
   * @example this.handOverStopKeyboard()
   */
  private handOverStopKeyboard(): void {
    const paused = pausedEditorOfStop({
      activeStackItem: vscode.debug.activeStackItem,
      activeTextEditor: vscode.window.activeTextEditor,
      handOver: this.host.stopHandOver,
    })
    if (paused) this.host.giveStopKeyboard(paused)
  }

  /**
   * Says whether the stop of the frame the editor shows is one whose keyboard Codebook hands, or handed, to the paused file; asked by {@link judgeKeyboardAtPauseBegin}, which owes the chat nothing for it.
   * @returns `true` while that frame's session holds a stop that is armed or handed over ({@link heldStopSessionOf}) and its hand-over is due; `false` otherwise, also when another session's stop is held.
   * @example if (this.holdsStopKeyboard()) this.leavePauseToLearner()
   */
  private holdsStopKeyboard(): boolean {
    const sessionId = heldStopSessionOf(
      vscode.debug.activeStackItem,
      this.host.stopHandOver,
    )
    return sessionId !== undefined && this.host.isStopHandOverDue(sessionId)
  }

  /**
   * Says whether the learner brought another tab of the main editor's first group to its front since the last borrow of that group ({@link firstGroupFrontAtBorrow}); asked by the function {@link retainForeignTabFocus} answers before it takes the keyboard for the one its measurement left, so a learner's tab chosen there keeps the keyboard, whether the editor names that group or still names the chat part's (Cycle 0046 row 732).
   * Codebook's own effects after the borrow bring other tabs to that front without the learner, and are told apart: a Codebook pane, the captured source and the Repository Wiki's cited copy (an agent's cold Wiki shows it there) are Codebook's own tabs, and a tab that comes to the front because the noted tab left the group (a refusal closed the Application pane it had opened there) was not chosen.
   * @returns `true` for a learner's tab in front while the noted tab still stands behind it in that group; `false` for the noted tab, for Codebook's own tabs, once the noted tab left the group, for a first group without a tab, and while no borrow noted its front tab.
   * @example this.showsLearnersOtherTabInFirstGroup() // => true once the learner clicked README.md behind login-form.tsx, the file the borrow focused
   */
  private showsLearnersOtherTabInFirstGroup(): boolean {
    const group = vscode.window.tabGroups.all.find(
        (candidate) => candidate.viewColumn === vscode.ViewColumn.One,
      ),
      front = group?.activeTab,
      noted = this.host.firstGroupFrontAtBorrow
    if (!group || !front || noted === undefined) return false
    // A pane, a captured source and a cited copy in front are Codebook's doing.
    if (
      this.host.isCodebookPaneInput(front.input) ||
      this.host.isCapturedSourceInput(front.input) ||
      (front.input instanceof vscode.TabInputText &&
        front.input.uri.scheme === REPOSITORY_SOURCE_SCHEME)
    )
      return false
    // Only while the noted tab still stands in the group did a tab come to the front by the learner's choice.
    return (
      this.host.tabIdentity(front) !== noted &&
      group.tabs.some((tab) => this.host.tabIdentity(tab) === noted)
    )
  }

  /**
   * Remembers the group the Application pane stands alone in before {@link reserveApplicationGroup} moves it into its new group, because the editor removes the group the move leaves empty: it closes a moved webview's editor in its old group (VS Code 1.140.0 `workbench.desktop.main.js` 4037:7120, Cursor 3.23.12 19764:8061), and that close removes a group whose last editor it was, a locked one too, under `workbench.editor.closeEmptyGroups`, on by default (1106:79878 and 1106:80531, 857:4736; Cursor 17501:42289 and 17501:43016, 17351:4267). Such a group is an earlier window's leftover that no record proved after Developer: Reload Window, which a cold Study select gave the pane (row 626); Codebook itself never unlocks, closes or merges it (row 591).
   * @param panel - The Application pane, before its move.
   * @returns
   * - `identity`: the identity of that group, which {@link followRemovalOfGroupLeftByApplication} waits for the editor to remove; `undefined` when the pane shares its group.
   * - `removedCount`: a count read after the placement's layout reply: `1` when that group is gone, `0` when it stands (`closeEmptyGroups` off), the pane shared its group or did not move.
   * @example const groupsRemovedByMove = this.watchGroupLeftByApplication(panel) // groupsRemovedByMove.removedCount() => 1 once the editor removed the leftover at column 2
   */
  watchGroupLeftByApplication(panel: vscode.WebviewPanel): {
    identity: symbol | undefined
    removedCount: () => number
  } {
    const group = vscode.window.tabGroups.all.find(
      (candidate) => candidate.viewColumn === panel.viewColumn,
    )
    const identity =
      group?.tabs.length === 1
        ? this.host.editorGroupIdentities.get(group)
        : undefined
    return {
      identity,
      removedCount: () =>
        identity !== undefined &&
        !vscode.window.tabGroups.all.some(
          (candidate) =>
            this.host.editorGroupIdentities.get(candidate) === identity,
        )
          ? 1
          : 0,
    }
  }

  /**
   * Watches what the learner sees and works in while the Application pane moves into its group and the editor removes the group the move emptied: the active text editor (document, version, selections and column, {@link textEditorFocusState}) and, for every group that holds a learner's tab, those tabs ({@link learnersTabKeysOf}) and the learner's tab in front; asked by {@link moveApplicationIntoItsGroup} (row 670).
   * The move's own effects change none of these: the pane's tab leaves its old group, which can bring the learner's tab behind it to the front (a group whose front was a Codebook tab is not compared there, and in the active group that file becomes the active text editor, which is taken as the move's), and stands in front of the new group, which holds no learner's tab; the emptied group holds none either. A change is latched when it is reported, so a learner who clicks away and back meanwhile is still seen.
   * @returns `assertUnchanged`, which throws once the active text editor, a learner group's tabs or the learner's tab in front of a group changed since the watch began, and `dispose`, which ends the watch.
   * @example const learnerView = this.watchLearnerViewDuringApplicationMove() // learnerView.assertUnchanged() throws after a click into auth.ts
   */
  watchLearnerViewDuringApplicationMove(): {
    assertUnchanged(): void
    dispose(): void
  } {
    const armed = this.host.armPlacementReport(
      'watchLearnerViewDuringApplicationMove',
    )
    const noEditor = textEditorFocusState(undefined)
    let editorBefore = textEditorFocusState(vscode.window.activeTextEditor)
    // Read once: `editorBefore` follows the move's own reports, so it says nothing about what the learner had at arming.
    const wasNoEditorAtArming = editorBefore === noEditor
    // Each group is kept under its identity and under its column: a group unnamed now and named later, or named now and re-wrapped unnamed later, is still found.
    const groupsBefore = new Map(
      vscode.window.tabGroups.all.flatMap((group) => {
        const view = this.learnerViewOfGroup(group)
        return this.groupKeysOf(group).map((key) => [key, view] as const)
      }),
    )
    const editorAtArming = {
      view: this.host.describeActiveEditor(vscode.window.activeTextEditor),
    }
    // The groups whose front tab was the Application pane at arming, by identity and column: the groups the move can uncover a file in.
    const groupsCoveredByPane = new Set<symbol | string>(
      vscode.window.tabGroups.all
        .filter(
          (group) =>
            group.activeTab &&
            this.host.isCodebookPaneInput(
              group.activeTab.input,
              'codebook.scopedBrowser',
            ) &&
            this.host.isOwnPaneOrSourceTab(group.activeTab),
        )
        .flatMap((group) => this.groupKeysOf(group)),
    )
    // The learner file in front of each covered group since the pane left it: the one file the move uncovered there, noted at the first report that shows the pane no longer in front.
    const frontSincePaneLeft = new Map<symbol | string, string>()
    /** Notes the file in front of every covered group once its front is no longer the Application pane; called first by every check. */
    const noteFrontsSincePaneLeft = (): void => {
      for (const group of vscode.window.tabGroups.all) {
        const keys = this.groupKeysOf(group)
        const front = group.activeTab
        if (
          !keys.some((key) => groupsCoveredByPane.has(key)) ||
          keys.some((key) => frontSincePaneLeft.has(key)) ||
          !front ||
          this.host.isCodebookPaneInput(front.input, 'codebook.scopedBrowser')
        )
          continue
        const learnerFront = this.learnerViewOfGroup(group).front
        if (learnerFront !== undefined)
          for (const key of keys) frontSincePaneLeft.set(key, learnerFront)
      }
    }
    // The file the watch has taken as the move's effect, by group: the move uncovers one file per group. The editor may report that same file again with another column or selection while the move settles (Cursor 3.27.22, native C72-2); another file there, or an edit of it (a new document version or dirty state), is the learner's.
    const uncoveredFileOfGroup = new Map<
      symbol | string,
      { file: string; version: number; isDirty: boolean }
    >()
    /** Names the group whose uncovered learner file is the active text editor: the file in front of the Application's group since the pane left it (whatever the editor reported at arming), or the front file of another group that showed none while no text editor was active; later reports of that same file in that group count too while its content is unchanged, no other file or edit does. */
    const findGroupUncoveredByMove = ():
      { group: vscode.TabGroup; file: string } | undefined => {
      const editor = vscode.window.activeTextEditor
      const group = vscode.window.tabGroups.all.find(
        (candidate) => candidate.viewColumn === editor?.viewColumn,
      )
      if (!editor || !group) return undefined
      const keys = this.groupKeysOf(group)
      const editorFile = editor.document.uri.toString()
      const uncoveredFile = keys
        .map((key) => uncoveredFileOfGroup.get(key))
        .find((file) => file !== undefined)
      if (uncoveredFile !== undefined)
        return uncoveredFile.file === editorFile &&
          uncoveredFile.version === editor.document.version &&
          uncoveredFile.isDirty === editor.document.isDirty
          ? { group, file: editorFile }
          : undefined
      return isEditorUncoveredByMove({
        editorFile,
        frontNow: this.learnerViewOfGroup(group).front,
        wasCoveredByPane: keys.some((key) => groupsCoveredByPane.has(key)),
        uncoveredFile: keys
          .map((key) => frontSincePaneLeft.get(key))
          .find((file) => file !== undefined),
        wasNoEditorAtArming,
        hadLearnerFrontAtArming:
          this.learnerViewBefore(groupsBefore, group)?.front !== undefined,
      })
        ? { group, file: editorFile }
        : undefined
    }
    let changed: string | undefined
    /** Latches the first change of the active text editor, or of a learner group's tabs or of the learner's tab in front of it, by the comparison's name. */
    const check = (isFinal = false): void => {
      noteFrontsSincePaneLeft()
      const editorNow = textEditorFocusState(vscode.window.activeTextEditor)
      // The file the move uncovered in the active group is the active text editor from then on, and its later reports stay the move's; another file there is the learner's; the report of a text editor the new group kept ends with the pane in front of it (row 710).
      if (editorNow !== editorBefore) {
        const uncovered = findGroupUncoveredByMove()
        const document = vscode.window.activeTextEditor?.document
        if (uncovered && document) {
          for (const key of this.groupKeysOf(uncovered.group))
            uncoveredFileOfGroup.set(key, {
              file: uncovered.file,
              version: document.version,
              isDirty: document.isDirty,
            })
          editorBefore = editorNow
        } else if (
          editorNow === noEditor &&
          this.isApplicationInFrontOfActiveGroup()
        )
          editorBefore = editorNow
      }
      changed ??=
        editorNow !== editorBefore
          ? 'active text editor'
          : this.findLearnerGroupChangeSince(groupsBefore, isFinal)
    }
    const subscriptions = [
      vscode.window.tabGroups.onDidChangeTabs(() => check()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => check()),
      vscode.window.onDidChangeActiveTextEditor(() => check()),
    ]
    return {
      assertUnchanged: (): void => {
        check(true)
        if (changed)
          throw this.host.refusePlacement(armed, [changed], editorAtArming)
      },
      dispose: (): void => {
        for (const subscription of subscriptions) subscription.dispose()
      },
    }
  }

  /**
   * Says whether the Application pane's tab stands in front of the active group, its new group at column 1, so that no text editor is active because the pane is; asked by {@link watchLearnerViewDuringApplicationMove} when the active text editor is reported as none during the pane's move.
   * The editor goes on reporting the text editor that was active before `workbench.action.newGroupAbove` while the new group is empty, and reports none only once the moved pane stands in front of it: Cursor 3.23.12 reported none 43 ms after the lock of the Application's group, while the parked Application moved into it, in a Repository Wiki recording visit after the article Return (C61 c61-cu-695c), so the watch refused the visit as if the learner had left that file, and VS Code 1.140.0 refused the same visit (c61-vs-695; Cycle 0046 row 710). That end of the report is the move's own effect.
   * @returns `true` while the active group is at column 1 and the Application pane's tab is the one it shows; `false` otherwise.
   * @example this.isApplicationInFrontOfActiveGroup() // => true once the parked Application stands in front of its new group
   */
  private isApplicationInFrontOfActiveGroup(): boolean {
    const group = vscode.window.tabGroups.activeTabGroup
    return (
      group.viewColumn === vscode.ViewColumn.One &&
      this.host.isCodebookPaneInput(
        group.activeTab?.input,
        'codebook.scopedBrowser',
      )
    )
  }

  /**
   * Names a group for the before-state of {@link watchLearnerViewDuringApplicationMove}: its identity when the editor's group report named it, and always its column.
   * @param group - An editor group.
   * @returns The group's identity (if named) and `column:<n>`, in that order.
   * @example this.groupKeysOf(group) // => [Symbol(), 'column:2'], or ['column:2'] for a group {@link observeEditorGroups} has not named
   */
  private groupKeysOf(group: vscode.TabGroup): (symbol | string)[] {
    const identity = this.host.editorGroupIdentities.get(group)
    return [
      ...(identity === undefined ? [] : [identity]),
      `column:${group.viewColumn}`,
    ]
  }

  /**
   * Finds what a group's learner part was when {@link watchLearnerViewDuringApplicationMove} began: by its identity first, then by its column.
   * @param groupsBefore - The watch's before-state, by {@link groupKeysOf}.
   * @param group - An editor group of now.
   * @returns The group's learner view of the start, or `undefined` for a group that stood in neither.
   * @example this.learnerViewBefore(groupsBefore, group)?.front
   */
  private learnerViewBefore(
    groupsBefore: ReadonlyMap<
      symbol | string,
      ReturnType<PresentationGuards['learnerViewOfGroup']>
    >,
    group: vscode.TabGroup,
  ): ReturnType<PresentationGuards['learnerViewOfGroup']> | undefined {
    for (const key of this.groupKeysOf(group)) {
      const view = groupsBefore.get(key)
      if (view) return view
    }
    return undefined
  }

  /**
   * Names the first comparison that finds a group's learner tabs, or the learner's tab in front of it, changed since {@link watchLearnerViewDuringApplicationMove} began; asked by that watch at every reported change (row 670).
   * @param groupsBefore - Each group's {@link learnerViewOfGroup} when the watch began, by the group's identity. A group {@link observeEditorGroups} has not named yet (Cursor sends a tab report with every group an object anew before the group report) is left out until it is named, or compared by its column at the final assertion.
   * @param isFinal - `true` for the watch's final assertion.
   * @returns `'learner group tabs'` once a group holds other learner tabs than it held (also a group that had none), `'learner group front tab'` once it shows another learner's tab in front than the one it showed; `undefined` otherwise.
   * @example this.findLearnerGroupChangeSince(groupsBefore) // => 'learner group front tab' after the learner brought Release notes to the front of auth.ts's group
   */
  private findLearnerGroupChangeSince(
    groupsBefore: ReadonlyMap<
      symbol | string,
      ReturnType<PresentationGuards['learnerViewOfGroup']>
    >,
    isFinal = false,
  ): string | undefined {
    for (const group of vscode.window.tabGroups.all) {
      const identity = this.host.editorGroupIdentities.get(group)
      // Cursor sends a tab report with every group an object anew before the group report that names them ({@link observeEditorGroups} runs on that one): a group not named yet is compared at the report that names it, and at the watch's final assertion, not read as a new group the learner opened.
      // At the final assertion no report is awaited any more: a group still unnamed then is compared by its column, so a group the learner opened is seen.
      if (identity === undefined && !isFinal) continue
      const now = this.learnerViewOfGroup(group),
        before = this.learnerViewBefore(groupsBefore, group)
      // A group whose front was a Codebook tab or none is compared by its learner tabs alone: the move can uncover a learner's tab there.
      if ((before?.tabs ?? '') !== now.tabs) return 'learner group tabs'
      if (before?.front !== undefined && before.front !== now.front)
        return 'learner group front tab'
    }
    return undefined
  }

  /**
   * Names the learner's part of an editor group, for {@link watchLearnerViewDuringApplicationMove}: its learner tabs and the learner's tab in front of it.
   * @param group - An editor group.
   * @returns `tabs`, the group's learner tabs as one key ({@link learnersTabKeysOf}, empty for a group without one); `front`, the key of the tab in front when it is a learner's tab, else `undefined`.
   * @example this.learnerViewOfGroup(group) // => { tabs: '["file:///work/auth.ts"]', front: 'file:///work/auth.ts' }
   */
  private learnerViewOfGroup(group: vscode.TabGroup): {
    tabs: string
    front: string | undefined
  } {
    const front = group.activeTab
    const learnerTabs = this.host.learnersTabKeysOf(group)
    return {
      tabs: learnerTabs.length ? JSON.stringify(learnerTabs) : '',
      front:
        front && !this.host.isOwnPaneOrSourceTab(front)
          ? this.host.learnerTabKey(front)
          : undefined,
    }
  }

  /** Retains logical ownership across Cursor's wrapper-only tab-model resync, never across moved or replaced groups. @example this.observeEditorGroups(event) */
  observeEditorGroups(event?: vscode.TabGroupChangeEvent): void {
    const current = vscode.window.tabGroups.all,
      previous = this.observedEditorGroups,
      issuedColumnShift = this.issuedApplicationColumnShift(
        event,
        current,
        previous,
      )
    // Actual Return retains verified main scope while its Study receipt is released; later wrapper refreshes must preserve that boundary too.
    const signature =
      this.host.layoutReceipt?.signature ??
      this.host.repositoryLayoutRestored?.signature
    const placementScope = this.host.presentationEditorScope
    // Only this live placement may retain its measured part boundary after releasing the old layout confirmation.
    const placementMainCount =
      placementScope &&
      this.host.placingPresentation &&
      placementScope.lifetime === this.host.lifetime &&
      placementScope.signal ===
        this.host.presentationTransition?.cancellation.signal &&
      !placementScope.signal.aborted
        ? placementScope.mainCount
        : undefined
    const mainCount =
      placementMainCount ??
      (signature === undefined
        ? undefined
        : editorLayoutGroupCount(JSON.parse(signature)))
    // A unique unchanged empty foreign part may refresh its wrapper; main empty groups and lifecycle changes stay unowned.
    const emptyOutsideBefore =
      mainCount === undefined
        ? []
        : previous.filter(
            (entry) => entry.column > mainCount && !entry.group.tabs.length,
          )
    const emptyOutsideAfter =
      mainCount === undefined
        ? []
        : current.filter(
            (group) => group.viewColumn > mainCount && !group.tabs.length,
          )
    const emptyOutsideMatch =
      event &&
      !event.opened.length &&
      !event.closed.length &&
      current.length === previous.length &&
      emptyOutsideBefore.length === 1 &&
      emptyOutsideAfter.length === 1 &&
      emptyOutsideBefore[0]!.column === emptyOutsideAfter[0]!.viewColumn &&
      event.changed.includes(emptyOutsideAfter[0]!)
        ? { before: emptyOutsideBefore[0]!, after: emptyOutsideAfter[0]! }
        : undefined
    // Cursor answers every tab that opened, closed or became active with a model in which each group is a new object: no tab object survives either, so a tab without a known input is known by its label there.
    const everyGroupReplaced = Boolean(
      event &&
      previous.length &&
      previous.every((entry) => !current.includes(entry.group)) &&
      current.every(
        (group) =>
          event.opened.includes(group) || event.changed.includes(group),
      ),
    )
    // Codebook's own removal of a group is under way and the editor reports a tab change that opens and closes no group.
    const isOwnRemovalReport = this.isOwnRemovalTabReport(
      event,
      current,
      previous,
    )
    // Opened/closed groups never inherit identity; only changed replacement wrappers may represent survivors.
    const survivors = event
      ? previous.filter(
          (entry) =>
            !event.closed.includes(entry.group) &&
            !current.includes(entry.group),
        )
      : []
    const replacements = event
      ? current
          .filter(
            (group) =>
              !this.host.editorGroupIdentities.has(group) &&
              !event.opened.includes(group) &&
              event.changed.includes(group),
          )
          .map((group) => ({
            group,
            matches: this.narrowedToColumnDuringOwnRemoval(
              survivors.filter(
                (entry) =>
                  this.retainsEditorTabs(
                    entry.group,
                    group,
                    everyGroupReplaced,
                  ) ||
                  (emptyOutsideMatch?.before === entry &&
                    emptyOutsideMatch.after === group),
              ),
              group,
              isOwnRemovalReport,
            ),
          }))
      : []
    // Exact survivors precede copied contraction tabs; ambiguous exact candidates cannot fall back to a weaker match.
    const exactReplacements = replacements.map(({ group, matches }) => ({
      group,
      matches: matches.filter(
        (entry) => entry.group.tabs.length === group.tabs.length,
      ),
    }))
    const expandedReplacements = replacements.map(({ group, matches }) => ({
      group,
      matches: exactReplacements.some(
        (replacement) =>
          replacement.group === group && replacement.matches.length,
      )
        ? []
        : matches.filter(
            (entry) =>
              !exactReplacements.some((replacement) =>
                replacement.matches.includes(entry),
              ),
          ),
    }))
    /**
     * Says whether the event opened or closed a group or changed how many there are; asked by {@link replacedEveryGroupInPlace}.
     * @returns `true` when the set of groups changed, `false` when the event only changed groups that stay.
     * @example hasGroupSetChanged() // => false for a tab change that replaced three groups by three
     */
    const hasGroupSetChanged = (): boolean =>
      Boolean(event?.opened.length) ||
      Boolean(event?.closed.length) ||
      current.length !== previous.length
    /**
     * Says whether the event replaced every group object while the set of groups stayed; the first condition of {@link emptySurvivor}.
     * @returns `true` when every group was replaced and none was opened or closed.
     * @example replacedEveryGroupInPlace() // => true after Cursor replaced every group object for one opened tab
     */
    const replacedEveryGroupInPlace = (): boolean =>
      everyGroupReplaced && !hasGroupSetChanged()
    /**
     * Says whether another group of the event was recognized by its tabs; the last condition of {@link emptySurvivor}, asked only for a group without tabs.
     * @returns `true` when a replaced group has exactly one match.
     * @example hasRecognizedReplacement()
     */
    const hasRecognizedReplacement = (): boolean =>
      replacements.some(({ matches }) => matches.length === 1)
    /**
     * Finds the group that alone stood in a group's column before the event and had no tabs; the survivor {@link emptySurvivor} names.
     * @param group - The group that is not yet known.
     * @returns The only earlier group of that column when it was empty, otherwise `undefined`.
     * @example soleEmptyGroupBefore(group)
     */
    const soleEmptyGroupBefore = (
      group: vscode.TabGroup,
    ): (typeof previous)[number] | undefined => {
      const sameColumn = previous.filter(
        (entry) => entry.column === group.viewColumn,
      )
      return sameColumn.length === 1 && !sameColumn[0]!.group.tabs.length
        ? sameColumn[0]
        : undefined
    }
    /**
     * Finds the earlier group that a group without tabs still is; asked by the loop below for every group that is neither opened nor known.
     * A group without tabs has nothing to be recognized by; it stays the same group when every group was replaced in its own column and another group of that event was recognized by its tabs.
     * @param group - A group of the editor's current model.
     * @returns The earlier group of the same column, or `undefined` when the group has tabs, the event did not replace every group in place, or no other group was recognized by its tabs.
     * @example const emptyMatch = emptySurvivor(group)
     */
    const emptySurvivor = (
      group: vscode.TabGroup,
    ): (typeof previous)[number] | undefined => {
      // Only this issued insertion may retain an empty survivor through a one-column shift; manual group moves remain unowned.
      if (
        issuedColumnShift !== undefined &&
        !group.tabs.length &&
        hasRecognizedReplacement()
      ) {
        const shifted = previous.filter(
          (entry) =>
            entry.column + issuedColumnShift === group.viewColumn &&
            !entry.group.tabs.length &&
            !event?.closed.includes(entry.group),
        )
        return shifted.length === 1 ? shifted[0] : undefined
      }
      if (
        !replacedEveryGroupInPlace() ||
        group.tabs.length ||
        !hasRecognizedReplacement()
      )
        return undefined
      return soleEmptyGroupBefore(group)
    }
    // With no tab in any group, before or after the event, the groups that stay keep their order (Cycle 0133 D12).
    const orderedEmptyPairs = this.orderedEmptySurvivors(
      event,
      current,
      previous,
    )
    for (const group of current) {
      if (event?.opened.includes(group)) {
        this.host.editorGroupIdentities.set(group, Symbol())
        continue
      }
      if (this.host.editorGroupIdentities.has(group)) continue
      // The issued first source insertion may replace its empty wrapper; a real opened/replaced group was handled above.
      const createdSourceIdentity = this.createdSourceWrapperIdentity(
        group,
        event,
        current,
        previous,
      )
      if (createdSourceIdentity) {
        this.host.editorGroupIdentities.set(group, createdSourceIdentity)
        continue
      }
      const emptyMatch =
        this.groupEmptiedByOwnRemoval(group, previous, isOwnRemovalReport) ??
        emptySurvivor(group) ??
        orderedEmptyPairs?.get(group) ??
        this.emptySurvivorAfterClosedGroups(
          group,
          event,
          current,
          previous,
          everyGroupReplaced && hasRecognizedReplacement(),
        )
      if (emptyMatch) {
        this.host.editorGroupIdentities.set(
          group,
          this.host.editorGroupIdentities.get(emptyMatch.group) ?? Symbol(),
        )
        continue
      }
      const candidates = exactReplacements.some(
        (replacement) =>
          replacement.group === group && replacement.matches.length,
      )
        ? exactReplacements
        : expandedReplacements
      const matches =
          candidates.find((replacement) => replacement.group === group)
            ?.matches ?? [],
        match = matches.length === 1 ? matches[0] : undefined
      // Content must identify one survivor in both directions before column equality can reject a manual move.
      const retained =
        match &&
        candidates.filter((replacement) => replacement.matches.includes(match))
          .length === 1 &&
        (match.column === group.viewColumn ||
          this.movedByIssuedShift(
            issuedColumnShift,
            match.column,
            group.viewColumn,
          ) ||
          this.columnAfterClosedGroups(
            event,
            current,
            previous,
            match.column,
          ) === group.viewColumn)
      this.host.editorGroupIdentities.set(
        group,
        retained
          ? (this.host.editorGroupIdentities.get(match.group) ?? Symbol())
          : Symbol(),
      )
    }
    this.followCreatedSourceGroup(current, issuedColumnShift)
    this.observedEditorGroups = current.map((group) => ({
      group,
      column: group.viewColumn,
      tabCount: group.tabs.length,
    }))
  }

  /**
   * Updates how many tabs each recorded group holds after a tab event, for the groups whose objects the editor kept; called by the reader's `onDidChangeTabs` listener in `StudyWorkspace.installReaders`.
   * Cursor 3.30.14 reports the last tab **View: Close All Editors** closes with a tab event only, after its last group event (Cycle 0133 D12, `/ship` QA journal), so the recorded groups would still count that tab; {@link orderedEmptySurvivors} reads the counts. A tab that leaves without any event changes no count.
   * @example this.noteObservedGroupTabs() // the recorded first group counts 0 tabs once its last tab closed
   */
  noteObservedGroupTabs(): void {
    const current = vscode.window.tabGroups.all
    this.observedEditorGroups = this.observedEditorGroups.map((entry) =>
      current.includes(entry.group)
        ? { ...entry, tabCount: entry.group.tabs.length }
        : entry,
    )
  }

  /**
   * Pairs each group an event replaced with the earlier group it still is, by the groups' order, when no group holds a tab before or after the event; asked by {@link observeEditorGroups} for a group that is neither opened nor recognized otherwise.
   * Cursor 3.30.14 lists its Agent part with no tab after **View: Close All Editors**, so a window whose main groups are empty too has nothing to recognize its groups by, and Cursor answers an insertion, a close or a lock with every group a new object (Cycle 0133 D12, `/ship` QA smoke). The extension host names the groups an event opened and closed; the others keep their order, since inserting or closing a group moves no other group. With no tab anywhere, a wrong pairing could take nothing of the learner's.
   * @param event - The tab-group event the observer runs for, if any.
   * @param current - The editor's groups now.
   * @param previous - The groups the observer recorded last.
   * @returns
   * - The earlier entry of each current group that stayed, by group object, in column order
   * - `undefined` when there is no event, a group holds a tab, the groups that stayed differ in number, or a group object that stayed is not in its own place
   * @example this.orderedEmptySurvivors(event, current, previous)?.get(group) // => the earlier first group, now in column 2 below the group New Group Above added
   */
  private orderedEmptySurvivors(
    event: vscode.TabGroupChangeEvent | undefined,
    current: readonly vscode.TabGroup[],
    previous: PresentationGuards['observedEditorGroups'],
  ):
    | Map<vscode.TabGroup, PresentationGuards['observedEditorGroups'][number]>
    | undefined {
    // The earlier groups count as they were recorded: groups that held Codebook's panes then never pass for empty ones.
    if (
      !event ||
      current.some((group) => group.tabs.length) ||
      previous.some((entry) => entry.tabCount || entry.group.tabs.length)
    )
      return undefined
    const stayedBefore = previous
      .filter((entry) => !event.closed.includes(entry.group))
      .toSorted((left, right) => left.column - right.column)
    const stayedNow = current
      .filter((group) => !event.opened.includes(group))
      .toSorted((left, right) => left.viewColumn - right.viewColumn)
    if (stayedBefore.length !== stayedNow.length) return undefined
    const pairs = new Map<
      vscode.TabGroup,
      PresentationGuards['observedEditorGroups'][number]
    >()
    for (const [index, group] of stayedNow.entries()) {
      const entry = stayedBefore[index]!
      // A group object the event kept must stand in its own place, or the order did not hold.
      if (
        previous.some((candidate) => candidate.group === group) &&
        entry.group !== group
      )
        return undefined
      pairs.set(group, entry)
    }
    return pairs
  }

  /**
   * Says whether a tab report arrived while Codebook's own removal of a group is marked ({@link applicationGroupChange}), the report opening and closing no group; asked by {@link observeEditorGroups} before it names the groups of such a report.
   * Cursor 3.27.22 reports the Application pane's move as its tab opening in the new group and closing in the old one, each time with every group an object anew, and removes the emptied group only after that (Cycle 0064 N64p2-F1: tabs closed +9 ms, group closed +15 ms).
   * @param event - The tab-group event the observer runs for, if any.
   * @param current - The editor's groups now.
   * @param previous - The groups the observer recorded last.
   * @returns `true` while a removal is marked and the report changed tabs only; `false` otherwise.
   * @example this.isOwnRemovalTabReport(event, current, previous) // => true for the close of the Application's tab in the group the move emptied
   */
  private isOwnRemovalTabReport(
    event: vscode.TabGroupChangeEvent | undefined,
    current: readonly vscode.TabGroup[],
    previous: PresentationGuards['observedEditorGroups'],
  ): boolean {
    return Boolean(
      this.host.applicationGroupChange?.kind === 'remove' &&
      event &&
      !event.opened.length &&
      !event.closed.length &&
      current.length === previous.length,
    )
  }

  /**
   * Resolves a content match that two earlier groups share during Codebook's own removal, by the group's column; asked by {@link observeEditorGroups} for each replaced group.
   * Between the open of the moved Application tab in its new group and its close in the old one, both groups hold that tab, so the tab alone names two survivors for the new group and neither keeps its identity. The move changes no column then, so the survivor in the group's own column is the group.
   * @param matches - The earlier groups whose tabs the group still holds.
   * @param group - The group of the editor's current model.
   * @param isOwnRemovalReport - The answer of {@link isOwnRemovalTabReport}.
   * @returns The single match in the group's column when several matched and exactly one stands there, else `matches` as they are.
   * @example this.narrowedToColumnDuringOwnRemoval([atColumn1, atColumn2], groupAtColumn1, true) // => [atColumn1]
   */
  private narrowedToColumnDuringOwnRemoval<
    Entry extends PresentationGuards['observedEditorGroups'][number],
  >(
    matches: readonly Entry[],
    group: vscode.TabGroup,
    isOwnRemovalReport: boolean,
  ): readonly Entry[] {
    if (!isOwnRemovalReport || matches.length < 2) return matches
    const sameColumn = matches.filter(
      (entry) => entry.column === group.viewColumn,
    )
    return sameColumn.length === 1 ? sameColumn : matches
  }

  /**
   * Finds the earlier group that Codebook's marked removal targets when it now stands empty in its own column; asked by {@link observeEditorGroups} for each group without an identity.
   * The close of the Application's tab leaves the group the pane moved out of without tabs, and a group that had one has nothing to be recognized by; the marked identity names it, so its later removal is known as Codebook's own ({@link issuedApplicationColumnShift}).
   * @param group - A group of the editor's current model.
   * @param previous - The groups the observer recorded last.
   * @param isOwnRemovalReport - The answer of {@link isOwnRemovalTabReport}.
   * @returns The earlier entry holding the marked identity in the group's column, when the group has no tabs; `undefined` otherwise.
   * @example this.groupEmptiedByOwnRemoval(emptyGroupAtColumn2, previous, true) // => the entry of the Application's old group
   */
  private groupEmptiedByOwnRemoval(
    group: vscode.TabGroup,
    previous: PresentationGuards['observedEditorGroups'],
    isOwnRemovalReport: boolean,
  ): PresentationGuards['observedEditorGroups'][number] | undefined {
    const change = this.host.applicationGroupChange
    if (!isOwnRemovalReport || change?.kind !== 'remove' || group.tabs.length)
      return undefined
    return previous.find(
      (entry) =>
        entry.column === group.viewColumn &&
        this.host.editorGroupIdentities.get(entry.group) === change.identity,
    )
  }

  /**
   * Names the column shift that Codebook's own App-group insertion or removal caused, the one group move through which {@link observeEditorGroups} keeps identities.
   * @param event - The tab-group event the observer runs for, if any.
   * @param current - The editor's groups now.
   * @param previous - The groups the observer recorded last.
   * @returns
   * - `ViewColumn.One` (one column right) for the issued insertion of the empty App group at the first column
   * - `-ViewColumn.One` (one column left) for the issued removal of the owned App group
   * - `undefined` for every other change, including a learner's own group moves
   * @example this.issuedApplicationColumnShift(event, current, previous) // => 1 while `newGroupAbove` is issued
   */
  private issuedApplicationColumnShift(
    event: vscode.TabGroupChangeEvent | undefined,
    current: readonly vscode.TabGroup[],
    previous: PresentationGuards['observedEditorGroups'],
  ): number | undefined {
    const change = this.host.applicationGroupChange
    const insertsOwnedGroup = Boolean(
      change?.kind === 'insert' &&
      current.length === previous.length + 1 &&
      event?.opened.length === 1 &&
      event.opened[0]?.viewColumn === vscode.ViewColumn.One &&
      event.opened[0].tabs.length === 0,
    )
    const removesOwnedGroup = Boolean(
      change?.kind === 'remove' &&
      current.length === previous.length - 1 &&
      event?.closed.length === 1 &&
      event.closed[0] &&
      this.host.editorGroupIdentities.get(event.closed[0]) === change.identity,
    )
    if (insertsOwnedGroup) return vscode.ViewColumn.One
    return removesOwnedGroup ? -vscode.ViewColumn.One : undefined
  }

  /**
   * Says whether a group moved by exactly the issued column shift; asked by {@link observeEditorGroups} and {@link followCreatedSourceGroup}, which keep an identity or a receipt only through that shift.
   * @param shift - The shift of {@link issuedApplicationColumnShift}, if any.
   * @param from - The group's column before the event.
   * @param to - Its column now.
   * @returns `true` when a shift was issued and it explains the move; `false` without one.
   * @example this.movedByIssuedShift(1, 2, 3) // => true
   */
  private movedByIssuedShift(
    shift: number | undefined,
    from: vscode.ViewColumn,
    to: vscode.ViewColumn,
  ): boolean {
    return shift !== undefined && from + shift === to
  }

  /**
   * Names the column an earlier group stands in after an event that only closed groups: one column to the left for each closed group that stood before it; asked by {@link observeEditorGroups} and {@link emptySurvivorAfterClosedGroups}.
   * Cursor 3.30.14 closes the main editor's emptied only group as soon as New Group Above adds the Application's group above it, so the groups after it move up one column, Cursor's Agent part among them (Cycle 0133 D12, `/ship` native check N2). A close moves no group that stays out of its order; a learner's move closes no group, so it stays unexplained.
   * @param event - The tab-group event the observer runs for, if any.
   * @param current - The editor's groups now.
   * @param previous - The groups the observer recorded last.
   * @param column - The earlier group's column before the event.
   * @returns
   * - The column the closes leave that group in, when the event closed groups, opened none, and the recorded groups it closed account for every group that is gone
   * - `undefined` for every other event
   * @example this.columnAfterClosedGroups(event, current, previous, 3) // => 2 when the event closed the group of column 2
   */
  private columnAfterClosedGroups(
    event: vscode.TabGroupChangeEvent | undefined,
    current: readonly vscode.TabGroup[],
    previous: PresentationGuards['observedEditorGroups'],
    column: vscode.ViewColumn,
  ): number | undefined {
    if (!event?.closed.length || event.opened.length) return undefined
    const closedRecorded = previous.filter((entry) =>
      event.closed.includes(entry.group),
    )
    // A group that left without a close report leaves the columns unexplained.
    if (current.length !== previous.length - closedRecorded.length)
      return undefined
    const closedBefore = closedRecorded.filter(
      (entry) => entry.column < column,
    ).length
    return column - closedBefore
  }

  /**
   * Finds the earlier empty group that a group without tabs still is after an event that only closed groups, an event in which the editor gave every group a new object; asked by {@link observeEditorGroups} for a group nothing else recognized.
   * Cursor answers its close of the emptied group with every group a new object, so the new empty Application group has nothing to be recognized by (Cycle 0133 D12, `/ship` native check N2: after Close All Editors and a new Agent chat). The groups that stay keep their order, so it stands where the closes leave its earlier column.
   * @param group - A group of the editor's current model that is neither opened nor known.
   * @param event - The tab-group event the observer runs for, if any.
   * @param current - The editor's groups now.
   * @param previous - The groups the observer recorded last.
   * @param isRecognizedRebuild - Whether the event gave every group a new object and recognized another group by its tabs.
   * @returns The only earlier empty group that stayed and that the closes move to the group's column; `undefined` when the group has tabs, the event is no recognized rebuild, or that group is not unique.
   * @example this.emptySurvivorAfterClosedGroups(emptyGroupAtColumn1, event, current, previous, true) // => the entry of the Application's empty group, column 1 before and after the close of column 2
   */
  private emptySurvivorAfterClosedGroups(
    group: vscode.TabGroup,
    event: vscode.TabGroupChangeEvent | undefined,
    current: readonly vscode.TabGroup[],
    previous: PresentationGuards['observedEditorGroups'],
    isRecognizedRebuild: boolean,
  ): PresentationGuards['observedEditorGroups'][number] | undefined {
    if (!isRecognizedRebuild || group.tabs.length) return undefined
    // The earlier groups count as they were recorded, as in {@link orderedEmptySurvivors}.
    const survivors = previous.filter(
      (entry) =>
        !entry.tabCount &&
        !entry.group.tabs.length &&
        !event?.closed.includes(entry.group) &&
        this.columnAfterClosedGroups(event, current, previous, entry.column) ===
          group.viewColumn,
    )
    return survivors.length === 1 ? survivors[0] : undefined
  }

  /**
   * Finds the created Source group whose empty wrapper the issued first source insertion replaced; asked by {@link observeEditorGroups} for every group that is neither opened nor known.
   * @param group - The current group that is not yet known.
   * @param event - The tab-group event the observer runs for, if any.
   * @param current - The editor's groups now.
   * @param previous - The groups the observer recorded last.
   * @returns The created Source group's identity when the event only changed groups and `group` stands in that empty group's column holding exactly the pending source document; otherwise `undefined`.
   * @example this.createdSourceWrapperIdentity(group, event, current, previous) // => the receipt's identity after the first source insertion
   */
  private createdSourceWrapperIdentity(
    group: vscode.TabGroup,
    event: vscode.TabGroupChangeEvent | undefined,
    current: readonly vscode.TabGroup[],
    previous: PresentationGuards['observedEditorGroups'],
  ): symbol | undefined {
    const createdSource = this.host.sourceDerivedGroup
    // Only a change of the same groups can replace a wrapper; an opened or closed group never inherits an identity.
    if (
      !createdSource ||
      !event ||
      event.opened.length ||
      event.closed.length ||
      current.length !== previous.length
    )
      return undefined
    const wasEmptySource = previous.some(
      (entry) =>
        this.host.editorGroupIdentities.get(entry.group) ===
          createdSource.identity &&
        entry.column === group.viewColumn &&
        !entry.group.tabs.length,
    )
    const showsPendingSource =
      group.tabs.length === 1 &&
      group.tabs[0]?.input instanceof vscode.TabInputText &&
      group.tabs[0].input.uri.toString() ===
        this.host.pendingSourceDisplay?.uri.toString()
    return wasEmptySource && showsPendingSource
      ? createdSource.identity
      : undefined
  }

  /**
   * Keeps the created Source group's receipt only through the issued column shift; called by {@link observeEditorGroups} after it named every current group. A learner's move and a real replacement retire the receipt.
   * @param current - The editor's groups now, with their identities already named.
   * @param issuedColumnShift - The shift of {@link issuedApplicationColumnShift}, if any.
   * @example this.followCreatedSourceGroup(current, issuedColumnShift)
   */
  private followCreatedSourceGroup(
    current: readonly vscode.TabGroup[],
    issuedColumnShift: number | undefined,
  ): void {
    const createdSource = this.host.sourceDerivedGroup
    if (!createdSource) return
    const sourceGroup = current.find(
      (group) =>
        this.host.editorGroupIdentities.get(group) === createdSource.identity,
    )
    if (sourceGroup?.viewColumn === createdSource.column) return
    if (
      sourceGroup &&
      this.movedByIssuedShift(
        issuedColumnShift,
        createdSource.column,
        sourceGroup.viewColumn,
      )
    )
      createdSource.column = sourceGroup.viewColumn
    else this.host.sourceDerivedGroup = undefined
  }

  /**
   * Recognizes surviving tab order during wrapper replacement, allowing additions from group contraction but rejecting ambiguous inputs; called by {@link observeEditorGroups} for every replaced group object.
   * @param before - The group object the editor replaced, with the tabs it held last.
   * @param after - A new group object of the same event.
   * @param everyGroupReplaced - Whether the event replaced every group object, as Cursor does with each tab change. No tab or input object survives such an event, so a tab without a known input (an agent chat, a settings page) is then recognized by its label, its flags and its place among equal tabs, also in a group that holds no known tab.
   * @returns
   * - `true` when every tab of `before` is in `after`, in the same order
   * - `false` when a tab is gone, reordered or cannot be told apart
   * @example
   * ```ts
   * this.retainsEditorTabs(before, after, false)
   * ```
   */
  private retainsEditorTabs(
    before: vscode.TabGroup,
    after: vscode.TabGroup,
    everyGroupReplaced: boolean,
  ): boolean {
    const knownKey = (tab: vscode.Tab) =>
      tab.input instanceof vscode.TabInputText
        ? `text:${tab.input.uri.toString()}`
        : tab.input instanceof vscode.TabInputWebview &&
            isCodebookPaneViewType(tab.input.viewType)
          ? `webview:${tab.input.viewType}`
          : undefined
    // A known source/pane anchors an unchanged foreign tab only when its native input survives.
    const hasKnownAnchor =
      before.tabs.some((tab) => knownKey(tab) !== undefined) &&
      after.tabs.some((tab) => knownKey(tab) !== undefined)
    /** Names a tab without a known input in an event that replaced every object: equal tabs of one group are told apart by their order. */
    const replacedForeignKey = (
      tab: vscode.Tab,
      tabs: readonly vscode.Tab[],
    ): string | undefined => {
      if (!tab.label) return undefined
      const description = JSON.stringify([
        tab.label,
        tab.isDirty,
        tab.isPreview,
        tab.isPinned,
      ])
      /**
       * Says whether the description of the named tab fits another tab of its group too; the filter of the tabs that precede it.
       * @param candidate - A tab of the same group.
       * @returns `true` for a tab without a known input that has the same label and state.
       * @example tabs.slice(0, tabs.indexOf(tab)).filter(describes).length // => 1 for the second of two equal tabs
       */
      const describes = (candidate: vscode.Tab): boolean =>
        knownKey(candidate) === undefined &&
        this.host.hasSameTabState(candidate, tab)
      return `foreign:${description}:${tabs.slice(0, tabs.indexOf(tab)).filter(describes).length}`
    }
    const foreignKey = (tab: vscode.Tab, tabs: readonly vscode.Tab[]) => {
      if (everyGroupReplaced) return replacedForeignKey(tab, tabs)
      if (!hasKnownAnchor || !tab.label) return undefined
      const matches = before.tabs.filter(
        (original) =>
          knownKey(original) === undefined &&
          (original === tab ||
            (typeof tab.input === 'object' &&
              tab.input !== null &&
              original.input === tab.input)),
      )
      if (matches.length !== 1) return undefined
      const original = matches[0]!
      if (
        original.label !== tab.label ||
        original.isDirty !== tab.isDirty ||
        original.isPreview !== tab.isPreview ||
        original.isPinned !== tab.isPinned
      )
        return undefined
      return `foreign:${before.tabs.indexOf(original)}`
    }
    const key = (tab: vscode.Tab, tabs: readonly vscode.Tab[] = after.tabs) =>
      knownKey(tab) ?? foreignKey(tab, tabs)
    const previous = before.tabs.map((tab) => key(tab, before.tabs)),
      current = after.tabs.map((tab) => key(tab))
    if (
      !previous.length ||
      previous.includes(undefined) ||
      current.includes(undefined)
    )
      return false
    if (
      new Set(previous).size !== previous.length ||
      new Set(current).size !== current.length
    ) {
      const scope = this.host.presentationEditorScope
      // Cursor rebuilds wrappers while predecessor and successor coexist; only an exact owned overlap may survive.
      if (
        !scope ||
        !this.host.placingPresentation ||
        scope.lifetime !== this.host.lifetime ||
        scope.signal !==
          this.host.presentationTransition?.cancellation.signal ||
        scope.signal.aborted ||
        previous.length !== current.length ||
        previous.some((value, index) => value !== current[index])
      )
        return false
      return [...new Set(previous)].every((value) => {
        const count = previous.filter((candidate) => candidate === value).length
        if (count === 1) return true
        const overlap = value && scope.overlappingPanes.get(value)
        return Boolean(
          overlap &&
          before.viewColumn === overlap.column &&
          after.viewColumn === overlap.column &&
          count === overlap.tabCount &&
          before.tabs.filter(
            (tab) => key(tab, before.tabs) === value && tab.isPreview,
          ).length === overlap.previewCount &&
          after.tabs.filter((tab) => key(tab) === value && tab.isPreview)
            .length === overlap.previewCount &&
          vscode.window.tabGroups.all
            .flatMap((group) => group.tabs)
            .filter((tab) => key(tab) === value).length === overlap.tabCount,
        )
      })
    }
    let retained = 0
    // Added tabs may interleave, but deleting or reordering any prior tab releases the old group identity.
    for (const value of current) if (value === previous[retained]) retained++
    return retained === previous.length
  }

  /**
   * Removes tabs the editor closed from the record of the retired browser replay's tabs, so a tab opened later at the same address is not taken for one of them (F485); a close of a tab no entry holds ends the entry of a replaced tab object at that address, unless another tab shows it (F494); called by the tab listener of {@link watchKeyboardOutsideEditors}.
   * @param closed - The tabs the editor reports closed.
   * @example this.forgetClosedRetiredBrowserReplayTabs(event.closed)
   */
  private forgetClosedRetiredBrowserReplayTabs(
    closed: readonly vscode.Tab[],
  ): void {
    if (
      !this.host.retiredBrowserReplayTabs &&
      !this.host.nodeSourceSlotTabsAwaitingArea
    )
      return
    const live = new Set(
      vscode.window.tabGroups.all.flatMap((group) => group.tabs),
    )
    const addressOf = (tab: vscode.Tab): string | undefined =>
      tab.input instanceof vscode.TabInputText
        ? tab.input.uri.toString()
        : undefined
    // A tab the learner closes by hand leaves each record, also as a tab object Cursor rebuilt (F494); a waiting slot tab closed so never takes one opened later at its address (Cycle 0052 task 15).
    if (this.host.retiredBrowserReplayTabs)
      this.host.retiredBrowserReplayTabs = pruneClosedTabRecord(
        this.host.retiredBrowserReplayTabs,
        closed,
        live,
        addressOf,
      )
    if (this.host.nodeSourceSlotTabsAwaitingArea)
      this.host.nodeSourceSlotTabsAwaitingArea = pruneClosedTabRecord(
        this.host.nodeSourceSlotTabsAwaitingArea,
        closed,
        live,
        addressOf,
      )
  }
}

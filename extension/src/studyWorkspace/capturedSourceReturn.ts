import * as vscode from 'vscode'

import {
  EDITOR_NUMBERED_TAB_COMMAND_LIMIT,
  LEARNER_CHOICE_RESHOW_LIMIT,
  MILLISECONDS_PER_SECOND,
  PRESENTATION_READY_TIMEOUT_MS,
  STUDY_EDITOR_GROUP_COUNT,
  STUDY_PRESENTATIONS,
} from '../constants'
import { StudyError } from '../errors'
import {
  type PresentationIntent,
  type PresentationRequester,
  type PresentationState,
} from '../presentationSchemas'
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse'
import { WaitTimeoutError } from '../runtimeSupport/utils/waitTimeoutError'
import type { StudyWorkspace } from '../studyWorkspace'
import { configuredObservationPosition } from '../utils/configuredObservationPosition'
import { editorLayoutGroupCount } from '../utils/editorLayoutGroupCount'
import { focusEditorGroupCommand } from '../utils/focusEditorGroupCommand'
import { isLiveSourceViewUri } from '../utils/isLiveSourceViewUri'
import { retainEditorReadingPosition } from '../utils/retainEditorReadingPosition'
import { sameTabTarget, tabTargetText } from '../utils/sameTabTarget'

import type { CapturedSourceReturnHost } from './capturedSourceReturnHost'

/**
 * Returns a displaced captured source tab to the Study source column and re-admits the pending presentation, so the return path is read apart from the entry and placement code of {@link StudyWorkspace}.
 *
 * The workspace builds one in a field initialiser with a host from {@link createCapturedSourceReturnHost}; the two members other code calls (`restoresDisplacedCapturedSource`, `returnDisplacedCapturedSourceThenAdmit`) stay on the workspace as one-line delegates.
 *
 * @example
 * private readonly capturedSourceReturn = new CapturedSourceReturn(createCapturedSourceReturnHost(this))
 */
export class CapturedSourceReturn {
  constructor(private readonly host: CapturedSourceReturnHost) {}

  /** The layout receipt that {@link returnDisplacedCapturedSourceThenAdmit} confirmed; while it is the current one, a later Restore keeps that confirmation. */
  private capturedSourceReturnReceipt?: StudyWorkspace['layoutReceipt']

  /**
   * Names the stopped line of the selected source as an empty range, which the return shows its editor at; `undefined` for a gap of a recording, which has no stop.
   * @returns The range at the start of the stopped line.
   * @example editor.setDecorations(this.highlight, [this.returnedSourceStop()!])
   */
  private returnedSourceStop(): vscode.Range | undefined {
    const message = this.host.message(true),
      position = new vscode.Position(message.model.source.line - 1, 0)
    return this.host.recordingActive && !message.model.observation
      ? undefined
      : new vscode.Range(position, position)
  }

  /**
   * Draws the stopped line and, for a live source view, the source annotation on the editor the return of a displaced captured source opened: decorations belong to one editor, and the moved copy's editor kept the earlier ones. Called by {@link returnDisplacedCapturedSourceThenAdmit}.
   * @param editor - The editor shown in the Study source column.
   * @example this.decorateReturnedSource(editor)
   */
  private decorateReturnedSource(editor: vscode.TextEditor): void {
    if (!this.host.highlight || !this.host.sourceUri) return
    const message = this.host.message(true),
      source = message.model.source,
      position = new vscode.Position(source.line - 1, 0)
    // A gap in a recording has no stopped line, as in the ordinary render.
    const stop = this.returnedSourceStop()
    editor.setDecorations(this.host.highlight, stop ? [stop] : [])
    if (!this.host.sourceIdentity || !isLiveSourceViewUri(this.host.sourceUri))
      return
    const study = this.host.selectedStudy(true)
    editor.setDecorations(this.host.sourceIdentity, [
      this.host.sourceIdentityDecoration(
        message.model,
        source,
        study &&
          configuredObservationPosition(study, message.model.observation?.id),
        position,
      ),
    ])
  }

  /**
   * Tells whether a Restore or selection of the unconfirmed Study workspace must first bring a displaced captured source back; asked by {@link changePresentation}. A stale, busy or unfocused request is left to {@link admitPresentation}, which refuses it.
   * @param input - The requested change.
   * @returns `true` when {@link displacedCapturedSourceTab} finds a tab to return.
   * @example this.restoresDisplacedCapturedSource(input)
   */
  restoresDisplacedCapturedSource(input: PresentationIntent): boolean {
    const state = this.host.presentationState()
    return (
      (input.action === 'restore' || input.action === 'select') &&
      input.mode === 'study-workspace' &&
      input.mode === state.mode &&
      this.needsMeasuredRestore(state) &&
      // A selected or opening test replay restores its own slots; the article's source stays where it is (F413).
      !this.host.testReplayHoldsComposition() &&
      input.presentationId === this.host.presentationId &&
      input.expectedRevision === this.host.presentationControlRevision &&
      !this.host.presentationOperation &&
      !this.host.presentationTransition &&
      // The idle conditions of {@link assertPresentationIdle} and {@link assertPresentationAdmission}: a control, a Live Return, a close or a pending source or navigation is refused by the admission itself, as before.
      !this.host.busy &&
      !this.host.returningCurrent &&
      !this.host.closing &&
      this.host.isPresentationAdmissionOpen() &&
      vscode.window.state.focused
    )
  }

  /**
   * Tells whether a Restore of the Study workspace is answered from the measured placement because the full placement would refuse the learner's groups; asked by {@link restoresDisplacedCapturedSource}.
   * That holds for a displaced captured source while the layout is unconfirmed; for a layout this return confirmed (its receipt is still the current one), which a later Restore keeps; and for the Study's three panes standing in their columns beside a group of the learner's, confirmed or not, which the full placement refuses with more than three groups.
   * @param state - The presentation state at admission.
   * @returns `true` when the return path owns the request.
   * @example if (this.needsMeasuredRestore(this.presentationState())) …
   */
  private needsMeasuredRestore(state: PresentationState): boolean {
    if (this.displacedCapturedSourceTab() !== undefined)
      return !state.layoutConfirmed
    if (this.host.enlargedLayoutReceipt || !this.host.layoutReceipt)
      return false
    if (
      state.layoutConfirmed &&
      this.host.layoutReceipt === this.capturedSourceReturnReceipt
    )
      return true
    return (
      !this.host.liveComposition &&
      !this.host.summaryComposition &&
      this.host.hasStudyPaneColumns() &&
      // Only a group with a text file of the learner's counts: Cursor's chat part is a group beyond the Study's too, and its Restore keeps the ordinary path.
      vscode.window.tabGroups.all.some(
        (group) =>
          group.viewColumn > STUDY_EDITOR_GROUP_COUNT &&
          group.tabs.some(
            (tab) =>
              tab.input instanceof vscode.TabInputText &&
              !this.host.ownsCapturedSourceTab(tab),
          ),
      )
    )
  }

  /**
   * Says whether the panes stand where the last arrangement's receipt recorded them after the captured source returned, whatever the confirmation flag says; asked by {@link returnDisplacedCapturedSourceThenAdmit}.
   * The Study's own grid must not have changed: with the receipt's group count the measured grid has to equal the receipt's signature, so a resized grid is not confirmed. A grid that gained learner groups beside the Study cannot be compared with that signature and is accepted on the panes' positions.
   * @returns `true` when the state would read confirmed if the flag were set.
   * @example if (await this.placementHoldsAfterReturn()) this.presentationConfirmed = true
   */
  private async placementHoldsAfterReturn(): Promise<boolean> {
    const receipt = this.host.layoutReceipt
    if (!receipt) return false
    // Bounded like the return's other native steps: a layout read the editor never answers must not keep the transition, and a late answer must not rewrite the receipt after the return gave up.
    const layout = await this.awaitReturnStep(
      this.host.readPassivePresentationLayout(),
      'the layout read after the return',
    )
    if (layout === undefined) return false
    if (
      editorLayoutGroupCount(layout) ===
        editorLayoutGroupCount(JSON.parse(receipt.signature)) &&
      JSON.stringify(layout) !== receipt.signature
    )
      return false
    const wasConfirmed = this.host.presentationConfirmed
    this.host.presentationConfirmed = true
    let holds: boolean
    try {
      holds = this.host.presentationState().layoutConfirmed
    } finally {
      this.host.presentationConfirmed = wasConfirmed
    }
    // A confirmation of the measured grid carries the grid it measured: the stale receipt would make the next status read call a benign learner group a changed grid.
    if (holds)
      this.host.layoutReceipt = {
        ...receipt,
        signature: JSON.stringify(layout),
        groups: vscode.window.tabGroups.all.map((group) => ({
          group,
          column: group.viewColumn,
        })),
        panes: this.host.studyPanePositions(),
      }
    return holds
  }

  /**
   * Finds the Codebook-owned tab of the current captured source that stands outside the Study source column while the Application pane (and, outside a run's following composition, the Study pane) holds its column; asked by {@link restoresDisplacedCapturedSource}.
   * It applies where the full placement cannot repair the source: a learner group beyond the three Study columns, or a run's following composition.
   * @returns The displaced tab with its group, otherwise `undefined`.
   * @example const displaced = this.displacedCapturedSourceTab() // => { group, tab } after the learner moved Captured source into their group
   */
  private displacedCapturedSourceTab():
    { group: vscode.TabGroup; tab: vscode.Tab } | undefined {
    const descriptor = STUDY_PRESENTATIONS['study-workspace'],
      panes = this.host.studyPanePositions()
    if (
      !panes.app ||
      !this.host.sourceUri ||
      panes.appColumn !== descriptor.appColumn ||
      panes.sourceColumn === descriptor.sourceColumn ||
      (this.host.liveComposition || this.host.summaryComposition
        ? panes.context
        : panes.contextColumn !== descriptor.contextColumn) ||
      !(
        this.host.liveComposition ||
        this.host.summaryComposition ||
        vscode.window.tabGroups.all.some(
          (group) => group.viewColumn > STUDY_EDITOR_GROUP_COUNT,
        )
      )
    )
      return undefined
    const sourceUri = this.host.sourceUri.toString()
    for (const group of vscode.window.tabGroups.all)
      for (const tab of group.tabs)
        if (
          group.viewColumn !== descriptor.sourceColumn &&
          this.host.ownsCapturedSourceTab(tab) &&
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.toString() === sourceUri
        )
          return { group, tab }
    return undefined
  }

  /**
   * Shows the captured source in its Study column again, closes the Codebook-owned duplicate left in a learner group, and admits the Restore once more; the learner's own tabs are never closed or moved.
   * @param input - The Restore or selection being admitted.
   * @param requester - Passed through to {@link admitPresentation}.
   * @param fromPane - Passed through to {@link admitPresentation}.
   * @returns The state the repeated admission answers.
   * @example return this.returnDisplacedCapturedSourceThenAdmit(input, 'learner', true)
   */
  async returnDisplacedCapturedSourceThenAdmit(
    input: PresentationIntent,
    requester: PresentationRequester,
    fromPane: boolean,
  ): Promise<PresentationState> {
    const displaced = this.displacedCapturedSourceTab(),
      lifetime = this.host.lifetime
    // `undefined` while the return did not run; then the state decides, otherwise only the measured placement does.
    let confirmedByPlacement: boolean | undefined
    // Releases the return's transition; it stays owned until the answer is final, so no control is admitted between the new revision and the saved preference.
    let releaseTransition = (): void => {}
    {
      // The admission conditions of any presentation change hold now and across every native step below.
      const runtimeIdentity = this.host.assertPresentationAdmission()
      // A chat that holds the keyboard gets it back after the placement, as in every other arrangement.
      const giveKeyboardBack = this.host.retainForeignTabFocus(undefined)
      // The return owns the presentation transition before its first await, so no other request starts between its native steps.
      const transition = {
        id: this.host.presentationId,
        cancellation: new AbortController(),
      }
      this.host.presentationTransition = transition
      releaseTransition = (): void => {
        if (this.host.presentationTransition === transition)
          this.host.presentationTransition = undefined
      }
      // Everything after the transition is owned runs inside the try, so a throw in any helper releases it.
      try {
        const assertOwned = (): void => {
          this.host.assertLifetime(lifetime)
          if (
            this.host.presentationTransition !== transition ||
            transition.id !== this.host.presentationId ||
            input.expectedRevision !== this.host.presentationControlRevision ||
            transition.cancellation.signal.aborted ||
            runtimeIdentity !== this.host.assertPresentationAdmission()
          )
            throw new StudyError(
              'PRESENTATION_UNAVAILABLE',
              'The presentation changed while the captured source was returned. Read its state before another control.',
            )
        }
        /** Whether this return still owns the presentation, for a step that must send nothing once the return gave up ({@link reactivateNonTextTab} after the step deadline). */
        const isReturnCurrent = (): boolean => {
          try {
            assertOwned()
            return true
          } catch {
            return false
          }
        }
        const sourceColumn = STUDY_PRESENTATIONS['study-workspace'].sourceColumn
        const sourceUri = this.host.sourceUri?.toString()
        /**
         * Names the front tab of the active group by its document (two files of one name in different folders differ) and the window focus: what a learner's click or leaving the window changes.
         * @param frontDocument - The document to name as the front tab instead of the one in front now, to tell the place the return's own show leaves from the one a learner's input does.
         */
        const keyboardPlace = (frontDocument?: string): string => {
          const front = vscode.window.tabGroups.activeTabGroup.activeTab
          return JSON.stringify([
            vscode.window.tabGroups.activeTabGroup.viewColumn,
            // A tab that is no text file is named by what it shows, so another tab of the same label (a diff of another folder's index.ts) is a change.
            frontDocument ??
              this.host.textTabUri(front) ??
              (front ? tabTargetText(front) : undefined),
            vscode.window.state.focused,
          ])
        }
        /** The place the keyboard names once the show of the source has put it in front of its column: when the keyboard's group is that column, the source replaces the front tab the keyboard names; in any other group nothing changes. */
        const placeWithSourceShown = (): string =>
          keyboardPlace(
            vscode.window.tabGroups.activeTabGroup.viewColumn === sourceColumn
              ? sourceUri
              : undefined,
          )
        // The place the return expects the keyboard at; it moves only where the return itself takes the keyboard.
        let expectedPlace = keyboardPlace()
        /** Stops the return and keeps the learner's own choice of focus; `choiceKept` is `false` when the latest choice could not be brought back to the front (a group with no focus command, a tab no numbered command reaches, a newer pick after the last re-show). */
        const abortForLearner = (choiceKept = true): never => {
          this.host.yieldFocusToLearner()
          throw new StudyError(
            'PRESENTATION_UNAVAILABLE',
            choiceKept
              ? 'The editor focus changed while the captured source was returned; your choice was kept. Choose Restore Study workspace layout again.'
              : 'The editor focus changed while the captured source was returned, and Codebook could not bring your latest choice back to the front. Choose it again, then choose Restore Study workspace layout.',
          )
        }
        /** A learner's own change of focus during the return wins. The return itself takes no keyboard, so any change of the place since its start is the learner's. */
        /** Whether the Study pane's own tab is in front of the active group after a press in a pane: the press puts the keyboard there as part of the request, and the editor can report that after the return began (native C72-1r: VS Code 1.144.0 reports the Study pane's group after the webview's message). */
        const isPressFocusOnStudyPane = (
          tab: vscode.Tab | undefined,
        ): boolean =>
          fromPane &&
          tab !== undefined &&
          this.host.isCodebookPaneInput(tab.input, 'codebook.studyContext') &&
          this.host.isOwnPaneOrSourceTab(tab)
        const assertLearnerKept = (): void => {
          const place = keyboardPlace()
          if (place === expectedPlace) return
          // The press's own focus on the Study pane is the request's, not a choice of the learner's: the return expects the keyboard there from now on.
          if (
            isPressFocusOnStudyPane(
              vscode.window.tabGroups.activeTabGroup.activeTab,
            )
          ) {
            expectedPlace = place
            return
          }
          abortForLearner()
        }
        /** Finds the Codebook-owned copy as the editor lists it now: tab and group objects may be new since the return began. */
        const currentCopy = ():
          { group: vscode.TabGroup; tab: vscode.Tab } | undefined => {
          const group = vscode.window.tabGroups.all.find(
            (candidate) => candidate.viewColumn === displaced?.group.viewColumn,
          )
          const tab = group?.tabs.find(
            (candidate) =>
              this.host.ownsCapturedSourceTab(candidate) &&
              this.host.textTabUri(candidate) === sourceUri,
          )
          return group && tab ? { group, tab } : undefined
        }
        // The copy in front of the learner's keyboard hands that keyboard to the source when it goes.
        const copyHasKeyboard =
          vscode.window.tabGroups.activeTabGroup.activeTab ===
          currentCopy()?.tab
        /**
         * Runs one of the return's two shows of the captured source while it watches what the learner picks: the first show leaves the keyboard where the request put it, the second takes it for the source, so the copy that had the keyboard hands it over before it closes. A pick made while the show is pending is shown again, the latest one, and the return stops with the copy left open.
         * @param show - Sends the show to the editor.
         * @param windowSwitchEndsReturn - Whether a switch to another window while the show is pending ends the return, also when the learner came back (the hand-off); the first show leaves the window to {@link assertLearnerKept}.
         * @returns The editor the show answered with, when the learner picked nothing.
         * @throws The learner's-choice refusal ({@link abortForLearner}) when the learner picked or left the window meanwhile.
         */
        const showWatchingLearnersPicks = async (
          show: () => Thenable<vscode.TextEditor>,
          windowSwitchEndsReturn: boolean,
        ): Promise<vscode.TextEditor> => {
          const watch = this.host.watchLearnersChoice(
            sourceUri,
            sourceColumn,
            isPressFocusOnStudyPane,
          )
          try {
            const shown = await this.awaitReturnStep(
              show(),
              'the show of the captured source',
            )
            assertOwned()
            if (
              windowSwitchEndsReturn &&
              (watch.windowLeft() || !vscode.window.state.focused)
            )
              abortForLearner()
            if (watch.choices.length === 0) return shown
            // The learner's target gets the keyboard back: a file is shown again; any other tab is brought to the front of its group again (the late show may have covered it) and its group is focused. The watch goes on while that is done, so a newer pick wins over the one being shown again.
            let latestChoiceBack = false
            for (let round = 0; round < LEARNER_CHOICE_RESHOW_LIMIT; round++) {
              const choice = watch.choices.at(-1)!
              const seen = watch.choices.length
              watch.ignoreOwnEffectOf(choice)
              let choiceBack = true
              if (choice.document) {
                await this.awaitReturnStep(
                  this.host.showTextDocumentNoted(choice.document, {
                    viewColumn: choice.column,
                    preserveFocus: false,
                    preview: false,
                  }),
                  'the show of your choice',
                )
              } else
                choiceBack = await this.awaitReturnStep(
                  this.reactivateNonTextTab(choice, isReturnCurrent),
                  'the focus command that brings your choice back',
                )
              assertOwned()
              // No newer pick since this re-show: the latest choice is in front again, as far as the editor could bring it back.
              if (watch.choices.length === seen) {
                latestChoiceBack = choiceBack
                break
              }
            }
            // The bound ended the loop with a newer pick recorded after the last re-show: that pick was covered and stays `false`.
            return abortForLearner(latestChoiceBack)
          } finally {
            watch.dispose()
          }
        }
        /** Closes the Codebook-owned copy where the rules above allow it, and keeps a learner's choice of focus made meanwhile. */
        const closeMovedCopy = async (): Promise<void> => {
          const copy = currentCopy()
          if (!copy || copy.tab.isPinned || copy.group.tabs.length <= 1) return
          await this.awaitReturnStep(
            vscode.window.tabGroups.close([copy.tab], true),
            'the close of the moved copy',
          )
          assertOwned()
          // The copy no longer has the keyboard (the source has it, or the request's place does), so the close moves nothing: any change since is the learner's, also a front tab of the copy's own group.
          assertLearnerKept()
        }
        if (displaced && this.host.sourceUri) {
          const document = await this.awaitReturnStep(
            vscode.workspace.openTextDocument(this.host.sourceUri),
            'the open of the captured source',
          )
          assertOwned()
          assertLearnerKept()
          // The show leaves the keyboard where the request put it (the Study pane for Arrange, the learner's file or the chat for an agent); a learner's click while it is pending is therefore never taken back.
          // The reading state of the moved copy (its selections and visible range) travels to the new editor; the stopped line is used only when the copy has none.
          const copyEditor = vscode.window.visibleTextEditors.find(
            (candidate) =>
              candidate.viewColumn === displaced.group.viewColumn &&
              candidate.document.uri.toString() === sourceUri,
          )
          const placeOnceSourceShown = placeWithSourceShown()
          // A file the learner picks while this show is pending is shown again and ends the return: the show puts the source in front of its column, which can cover that pick.
          let editor = await showWatchingLearnersPicks(
            () =>
              this.host.showTextDocumentNoted(document, {
                viewColumn: sourceColumn,
                preserveFocus: true,
                preview: false,
                selection: copyEditor ? undefined : this.returnedSourceStop(),
              }),
            false,
          )
          // The show puts the source in front of its column, and the front tab of the keyboard's group changes with it when that group is the source column (the learner's file there stays open behind it): that is this return's own switch, not input. Anything else that moved the place is the learner's.
          if (keyboardPlace() === placeOnceSourceShown)
            expectedPlace = placeOnceSourceShown
          assertLearnerKept()
          // Read after the waits above, so a selection the learner changed meanwhile travels, not the one from before.
          const carryReadingState = async (): Promise<void> => {
            // The editor may have replaced the returned editor with a new object when the second show took the keyboard: the one listed in the source column now is the target.
            editor =
              vscode.window.visibleTextEditors.find(
                (candidate) =>
                  candidate.viewColumn === sourceColumn &&
                  candidate.document.uri.toString() === sourceUri,
              ) ?? editor
            const copyNow = vscode.window.visibleTextEditors.find(
              (candidate) =>
                candidate.viewColumn === displaced.group.viewColumn &&
                candidate.document.uri.toString() === sourceUri,
            )
            if (copyNow) editor.selections = copyNow.selections
            await retainEditorReadingPosition(copyNow)(
              editor,
              transition.cancellation.signal,
            )
            assertOwned()
          }
          await carryReadingState()
          // A file the learner picked while the reading position was restored keeps the keyboard.
          assertLearnerKept()
          // The copy hands the keyboard over only while it still has it: after a press in the Study pane the keyboard is in the Study pane, and closing the copy moves nothing.
          if (
            copyHasKeyboard &&
            vscode.window.tabGroups.activeTabGroup.activeTab ===
              currentCopy()?.tab
          ) {
            // The copy that had the keyboard hands it to the source before it closes, so the close hands it to no tab behind the copy.
            await showWatchingLearnersPicks(
              () =>
                this.host.showTextDocumentNoted(document, {
                  viewColumn: sourceColumn,
                  preserveFocus: false,
                  preview: false,
                }),
              true,
            )
            expectedPlace = keyboardPlace()
            // The learner may have moved the caret in the original tab while the hand-off was pending; the latest position is taken just before that tab closes.
            await carryReadingState()
            assertLearnerKept()
          }
          this.host.sourceGroup = vscode.window.tabGroups.all.find(
            (group) => group.viewColumn === sourceColumn,
          )
          // The returned editor is a new one: it gets the stopped line and the source annotation the ordinary placement draws.
          this.decorateReturnedSource(editor)
          // The Codebook-owned copy closes only after the new show succeeded, never when the learner pinned it (as {@link retireMovedSourceCopies} keeps pinned copies), and never as the last tab of a learner group, which would leave the editor to close that group; such a copy stays beside the source, which the placement accepts.
          await closeMovedCopy()
        }
        // Decided from the measured placement, not from the confirmation flag a status read may have retired for a benign change (a learner group beside the Study). Measured first: beside a chat part the layout read answers for the focused part, so the keyboard goes back to the chat only afterwards.
        confirmedByPlacement = await this.placementHoldsAfterReturn()
        assertOwned()
        await giveKeyboardBack?.().catch(() => false)
        // A Close during the keyboard's return resets the reader: nothing below may confirm it.
        assertOwned()
      } catch (error) {
        releaseTransition()
        throw error
      }
    }
    // The source standing in its column again can confirm the retained grid by itself; a full placement would refuse the learner groups.
    // A mismatch of the measured placement (resized panes) goes on to the ordinary placement, which restores the sizes.
    if (confirmedByPlacement ?? this.host.presentationState().layoutConfirmed) {
      return this.confirmReturnedLayout(input, releaseTransition, lifetime)
    }
    releaseTransition()
    return this.host.admitPresentation(
      { ...input, expectedRevision: this.host.presentationControlRevision },
      'pending',
      requester,
      fromPane,
    )
  }

  /**
   * Waits for one native call of the captured source's return for at most {@link PRESENTATION_READY_TIMEOUT_MS}, so a call the editor never answers cannot keep the presentation transition, and with it every control and Close, waiting for good; called by {@link returnDisplacedCapturedSourceThenAdmit} for each of its native awaits.
   * The call is neither cancelled nor repeated: it may still finish after the deadline, and the return has stopped by then. The return's catch releases the transition and the control answers the refusal.
   * @param call - The pending native call (an open, a show, a tab close or the editor's numbered or group command).
   * @param description - Names the step in the refusal and the diagnostic, such as `the show of the captured source`.
   * @returns What the call answered.
   * @throws {@link StudyError} `PRESENTATION_UNAVAILABLE` naming the step when the call gave no answer in time (logged as `presentation:source-return-timed-out`); whatever the call itself rejected with otherwise.
   * @example const editor = await this.awaitReturnStep(this.showTextDocumentNoted(document, { viewColumn: 2 }), 'the show of the captured source')
   */
  private async awaitReturnStep<Value>(
    call: PromiseLike<Value>,
    description: string,
  ): Promise<Value> {
    try {
      return await awaitResponse(
        call,
        description,
        undefined,
        PRESENTATION_READY_TIMEOUT_MS,
      )
    } catch (error) {
      // Only the deadline is told apart; the editor's own rejection passes on as it is.
      if (!(error instanceof WaitTimeoutError)) throw error
      const seconds = PRESENTATION_READY_TIMEOUT_MS / MILLISECONDS_PER_SECOND
      this.host.diagnostics?.log({
        surface: 'presentation:source-return-timed-out',
        cause: `${description} gave no answer within ${PRESENTATION_READY_TIMEOUT_MS} ms; the wait ended and the editor may still finish it later.`,
      })
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        `The editor gave no answer to ${description} within ${seconds} seconds, so Codebook stopped returning the captured source; the editor may still finish that step. Choose Restore Study workspace layout again.`,
      )
    }
  }

  /**
   * Brings a tab that is no text file to the front of its group again and focuses that group, so a learner's choice a late show covered is back; called by {@link returnDisplacedCapturedSourceThenAdmit}.
   * The tab is looked up again in its group, since the editor may have replaced its objects: the same object first, then the tab that shows the same thing ({@link sameTabTarget}: kind of input, label and the resource or view it names, so another tab of the same label is not taken for it). The editor's numbered command (first nine tabs of the active group) reveals it.
   * Nothing is run for a group that is gone or that the editor's numbered commands do not count: Cursor's focus commands count the groups of the main editor only and open a new empty group for the column after its last one ({@link placeOfRememberedGroup}). After the focus command the group must be the active one, else the numbered command would switch the front tab of whatever group is active.
   * The return waits for this at most {@link PRESENTATION_READY_TIMEOUT_MS} and then stops without cancelling it, so each native step is sent only while the return still owns the presentation: a late answer of an earlier step sends nothing more after the return gave up, a Close or the next Restore.
   * @param choice - The group's column and the tab the learner chose.
   * @param isReturnCurrent - Whether the return that asked still owns the presentation; read before each editor command.
   * @returns `true` when the tab is in front of its group and the group is focused; `false` when the return no longer owns the presentation, the group is gone, lies outside the main editor or is not known to lie in it, the editor has no focus command for it (a column beyond its eighth), the focus command did not make it the active group, or the tab cannot be revealed by number.
   * @example await this.reactivateNonTextTab({ column: 2, tab }, () => true) // => true
   */
  private async reactivateNonTextTab(
    choice: {
      column: number
      tab?: vscode.Tab
    },
    isReturnCurrent: () => boolean,
  ): Promise<boolean> {
    const focusCommand = focusEditorGroupCommand(choice.column)
    const groupAtColumn = (): vscode.TabGroup | undefined =>
      vscode.window.tabGroups.all.find(
        (candidate) => candidate.viewColumn === choice.column,
      )
    const groupBefore = groupAtColumn()
    // A closed group, or one the numbered focus commands do not count (another editor part's), gets no command: for Cursor's chat group it would open a new empty group in the Study grid.
    if (
      !focusCommand ||
      !choice.tab ||
      !groupBefore ||
      (await this.host.placeOfRememberedGroup(groupBefore)) !== choice.column ||
      // The layout read may answer after the return gave up: nothing more is sent then.
      !isReturnCurrent()
    )
      return false
    await this.host.executeEditorCommand(focusCommand)
    // The numbered tab command acts on the active group: only a group the focus command made active may get it, and only while the return still owns the presentation.
    if (
      !isReturnCurrent() ||
      vscode.window.tabGroups.activeTabGroup.viewColumn !== choice.column
    )
      return false
    const group = groupAtColumn()
    if (!group) return false
    // The very tab while the editor still lists it, so another tab that shows the same thing in front is not taken for it; the tab that shows the same thing only once the editor replaced its objects.
    const isListed = group.tabs.includes(choice.tab)
    if (
      isListed
        ? group.activeTab === choice.tab
        : sameTabTarget(group.activeTab, choice.tab)
    )
      return true
    const index = isListed
      ? group.tabs.indexOf(choice.tab)
      : group.tabs.findIndex((candidate) =>
          sameTabTarget(candidate, choice.tab),
        )
    // The editor numbers the first nine tabs of a group only; a tab is counted from 1.
    const tabNumber = index + 1
    if (tabNumber < 1 || tabNumber > EDITOR_NUMBERED_TAB_COMMAND_LIMIT)
      return false
    await this.host.executeEditorCommand(
      `workbench.action.openEditorAtIndex${tabNumber}`,
    )
    return true
  }

  /**
   * Answers a Restore whose layout the return confirmed: the flags of a confirmed arrangement, a new control revision (a second control holding the old one is refused as stale), the saved preference with the transition still held, and the completed state published only once the transition is released.
   * @param input - The Restore or selection being answered.
   * @param releaseTransition - Releases the return's transition.
   * @param lifetime - The reader lifetime the Restore was admitted in.
   * @returns The confirmed state, `'open'`.
   * @throws When the workspace closed during the save.
   * @example return this.confirmReturnedLayout(input, releaseTransition, lifetime)
   */
  private async confirmReturnedLayout(
    input: PresentationIntent,
    releaseTransition: () => void,
    lifetime: number,
  ): Promise<PresentationState> {
    try {
      // A workspace that closed before this answer is not confirmed, and no preference is written for it.
      this.host.assertLifetime(lifetime)
      this.host.presentationConfirmed = true
      this.capturedSourceReturnReceipt = this.host.layoutReceipt
      this.host.requestedPresentation = undefined
      this.host.presentationReason = undefined
      this.host.errors.delete('presentation')
      this.host.errors.delete('layout')
      this.host.presentationControlRevision++
      await this.host.savePresentationPreference(
        input.mode,
        this.host.presentationId,
      )
    } finally {
      releaseTransition()
    }
    // A workspace that closed during the save answers the closed result, not a confirmed state.
    this.host.assertLifetime(lifetime)
    this.host.publish()
    return { ...this.host.presentationState(), state: 'open' as const }
  }
}

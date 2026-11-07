import * as vscode from 'vscode'

import {
  HORIZONTAL_EDITOR_ORIENTATION,
  LIVE_EDITOR_GROUP_COUNT,
  LIVE_EDITOR_LAYOUT,
  PRESENTATION_PREFERENCE_KEY,
  PRESENTATION_PREFERENCE_VERSION,
  STUDY_EDITOR_GROUP_COUNT,
  STUDY_PRESENTATIONS,
} from '../constants'
import { StudyError } from '../errors'
import {
  presentationPreferenceSchema,
  type PresentationIntent,
  type PresentationMode,
  type PresentationRequester,
  type PresentationState,
} from '../presentationSchemas'
import type { RepositoryFocusTarget } from '../repositoryReader'
import type { StudyWorkspace } from '../studyWorkspace'
import {
  capturedSourceNotShownReason,
  type CapturedSourceStanding,
  type CapturedSourceView,
} from '../utils/capturedSourceNotShownReason'
import { isCollapsedEditorLayout } from '../utils/isCollapsedEditorLayout'
import {
  editorLayoutSchema,
  isProportionalEditorLayout,
} from '../utils/isProportionalEditorLayout'
import { recordingNotShownReason } from '../utils/recordingNotShownReason'
import { sanitizeCause } from '../utils/sanitizeCause'
import { unconfirmedCompositionRefusal } from '../utils/unconfirmedCompositionRefusal'
import {
  type ChangedLayoutPart,
  unconfirmedLayoutReason,
} from '../utils/unconfirmedLayoutReason'

import type { PresentationReceiptsHost } from './presentationStateHost'

/**
 * Holds the presentation state, the layout receipts and the study pane positions that {@link StudyWorkspace} reads for every mode change, so the state and its confirmation are read apart from the entry and placement code.
 *
 * The workspace builds one in a field initialiser with a host from {@link createPresentationReceiptsHost}; every member other code calls stays on the workspace as a one-line delegate with the same name and signature.
 *
 * @example
 * private readonly presentationReceipts = new PresentationReceipts(createPresentationReceiptsHost(this))
 */
export class PresentationReceipts {
  constructor(private readonly host: PresentationReceiptsHost) {}

  /** Which comparison of the layout receipt a status read found changed; it speaks for that receipt only, so a later arrangement retires it. */
  private changedLayoutPart?: {
    receipt: NonNullable<StudyWorkspace['layoutReceipt']>
    part: ChangedLayoutPart
  }

  private presentationPreference: PresentationState['preference'] = {
    status: 'default',
  }

  /**
   * Writes the Output diagnostic that names every marker which refuses a control, with its owner and age; called by {@link assertPresentationIdle} just before it throws the pending sentence.
   * @example this.logPendingRefusal()
   */
  private logPendingRefusal(): void {
    const nowMs = performance.now()
    const describe = (name: string, isSet: boolean, refuses: boolean) => {
      const since = this.host.markerSetAt.get(name)
      return isSet
        ? `${name}${refuses ? '' : ' (not part of the refusal)'}: set by ${since?.owner ?? 'unknown'} ${since ? Math.round(nowMs - since.atMs) : '?'} ms ago`
        : undefined
    }
    const lines = [
      describe(
        'presentationTransition',
        Boolean(this.host.presentationTransition),
        true,
      ),
      describe('closing', this.host.closing, true),
      describe(
        'returningCurrent',
        this.host.returningCurrent !== undefined,
        true,
      ),
      describe(
        'presentationOperation',
        Boolean(this.host.presentationOperation),
        false,
      ),
      this.host.busy ? 'busy: set (not part of the refusal)' : undefined,
      this.host.refreshing
        ? 'refreshing: set (not part of the refusal)'
        : undefined,
      this.host.arranging
        ? 'arranging: set (not part of the refusal)'
        : undefined,
    ].filter((line): line is string => line !== undefined)
    // An owner read from an anonymous stack frame is a file location: each line is sanitized like every other cause before it reaches the Output channel ({@link sanitizeCause} joins lines, so it runs per line to keep one marker a line).
    const roots = this.host.privateRoots()
    this.host.diagnostics?.log({
      surface: 'presentation:pending-refused',
      cause: lines.map((line) => sanitizeCause(line, roots)).join('\n'),
    })
  }

  /**
   * Keeps live explanation in native chat when {@link open} arranges app/source; replay retains its summary.
   * @returns The confirmed Application layout; the live two-group layout only while no Application pane stands in the grid; `undefined` for an Application pane no confirmed receipt describes, which {@link arrange} refuses.
   * @example this.studyLayout()
   */
  studyLayout() {
    if (!this.host.usesPreparedApplicationLayout())
      return STUDY_PRESENTATIONS[this.host.presentationMode].layout
    // An Application pane without a confirmed receipt stands in a populated grid the live layout does not describe (finding 591).
    const layoutWithoutReceipt = this.host.app ? undefined : LIVE_EDITOR_LAYOUT
    return this.host.applicationGroup?.layout ?? layoutWithoutReceipt
  }

  /** Bounds layout effects to the current feature's main panes, never a separate chat part. @example this.studyGroupCount() // 2 during live explanation */
  studyGroupCount(): number {
    return this.host.usesPreparedApplicationLayout()
      ? (this.host.applicationGroup?.count ?? LIVE_EDITOR_GROUP_COUNT)
      : STUDY_EDITOR_GROUP_COUNT
  }

  /**
   * Keeps original groups beside a prepared App during cold Study entry; {@link studyLayout} and {@link studyGroupCount} share this ownership check.
   * @returns Whether native preparation still owns the default Study layout, or the active feature already uses that native composition.
   * @example this.usesPreparedApplicationLayout() // true for an unchanged MCP-first App allocation
   */
  usesPreparedApplicationLayout(): boolean {
    return (
      this.host.liveComposition ||
      this.host.summaryComposition ||
      Boolean(
        this.host.presentationMode === 'study-workspace' &&
        this.host.applicationGroup &&
        this.host.applicationGroup.count >= STUDY_EDITOR_GROUP_COUNT &&
        !this.host.applicationGroup.parked &&
        vscode.window.tabGroups.all.some(
          (group) =>
            this.host.editorGroupIdentities.get(group) ===
              this.host.applicationGroup?.identity &&
            group.viewColumn === this.host.app?.viewColumn,
        ),
      )
    )
  }

  /** Projects mode control independently of content/playback revisions; MCP reads never open the reader. @example workspace.presentationState().presentationId */
  presentationState(): PresentationState {
    const panes = this.host.studyPanePositions(),
      descriptor = STUDY_PRESENTATIONS[this.host.presentationMode]
    // A stable receipt may describe a learner collision; only the mode's distinct destinations qualify as confirmed.
    const matchingColumns =
      panes.appColumn === descriptor.appColumn &&
      // A test replay's source is its slot, whose position {@link layoutSourceReady} checks (F402).
      (this.host.testReplayHoldsComposition() ||
        panes.sourceColumn === descriptor.sourceColumn) &&
      (this.host.liveComposition || this.host.summaryComposition
        ? !panes.context
        : panes.contextColumn === descriptor.contextColumn)
    // A selected or opening test replay does no article source work (D32, F390): its own source is the slot it shows at the source position, not the article's captured source (F402).
    const currentSourceReady = this.layoutSourceReady()
    const matchingLayoutReceipt = Boolean(
      this.host.layoutReceipt?.mode === 'study' &&
      this.host.sameStudyPanePositions(this.host.layoutReceipt.panes),
    )
    const layoutConfirmed =
      this.host.presentationConfirmed &&
      currentSourceReady &&
      matchingColumns &&
      matchingLayoutReceipt
    // A successful Restore can still lack one native receipt; expose that missing condition to the next public recovery step.
    let reason = this.host.presentationReason
    if (!reason && this.host.opened && !this.host.closing && !layoutConfirmed) {
      if (!currentSourceReady) {
        const playback = this.host.playback?.state()
        // The reader's own pending recorded presentation is still placing the source: nothing for the learner to recover. A recording whose load failed shows no source until it is opened again. Otherwise the reason says how the source stands (row 695).
        // A test replay that is only opening has no slot yet: it reads as opening, never as a missing slot (F416).
        if (this.testReplayIsOpening())
          reason = 'The recorded source is opening in its native pane.'
        else if (this.host.testReplayHoldsComposition())
          reason =
            'The recorded source of the test replay is not shown in its pane. Use Focus source to show it again.'
        else if (playback?.readiness === 'loading')
          reason = 'The recorded source is opening in its native pane.'
        else if (
          this.host.browserReplayShown() &&
          playback?.readiness === 'failed'
        )
          reason = recordingNotShownReason(playback.reason)
        else reason = this.capturedSourceReason()
      } else if (!matchingColumns)
        reason =
          'The application or source pane is no longer in its Study destination. Focus the existing Study or Application pane, then restore its layout. Opening Repository Wiki does not repair Study.'
      else if (!matchingLayoutReceipt)
        reason =
          'The native editor layout receipt no longer matches the Study panes. Focus the existing Study or Application pane, then restore its layout. Opening Repository Wiki does not repair Study.'
      else
        reason = unconfirmedLayoutReason(
          this.changedLayoutPart?.receipt === this.host.layoutReceipt
            ? this.changedLayoutPart?.part
            : undefined,
        )
    }
    // A selected Node journal masks the live application, so agents must not read the reader as following the run.
    return {
      presentationId: this.host.presentationId,
      presentationControlRevision: this.host.presentationControlRevision,
      reader: {
        contentRevision: this.host.revision + this.host.readerSelectionRevision,
        // A same-study Reload that is loading or failed still shows its browser replay, so an agent returns to the run before it starts another (Cycle 0052 task 18).
        contentTab: this.host.browserReplayShown()
          ? 'recording'
          : this.host.selection.tab,
        followingCurrentRun:
          this.host.selection.follow &&
          !this.host.browserReplayShown() &&
          !this.host.selectedNodeHistory,
      },
      mode: this.host.presentationMode,
      requestedMode: this.host.requestedPresentation,
      state: this.host.presentationTransition
        ? 'applying'
        : this.host.opened && !this.host.closing
          ? 'open'
          : 'closed',
      layoutConfirmed,
      preference: { ...this.presentationPreference },
      // The reason of an earlier refused change says nothing about a layout that is confirmed now.
      reason: layoutConfirmed ? undefined : reason,
      playbackRevision: this.host.recordingActive
        ? this.host.playback?.state().revision
        : undefined,
      panes: {
        appColumn: panes.appColumn,
        sourceColumn: panes.sourceColumn,
        contextColumn: panes.contextColumn,
      },
    }
  }

  /** Refreshes native confirmation for MCP reads without adopting a manual layout or changing reader identity. @example await workspace.readPresentationState() */
  async readPresentationState(): Promise<PresentationState> {
    const state = this.host.presentationState(),
      receipt = this.host.layoutReceipt
    if (!state.layoutConfirmed || this.host.presentationTransition || !receipt)
      return state
    const layout = await this.host.readPassivePresentationLayout()
    // A hidden editor area (the bottom panel is maximized) reports its groups at their minimum heights: nothing was rearranged, and the editor gives the groups their sizes back with the area.
    if (isCollapsedEditorLayout(layout)) return this.host.presentationState()
    // The first comparison that fails is the one the reason names; a moved pane has its own reason in the state.
    let changedPart: ChangedLayoutPart | undefined
    if (layout !== undefined && JSON.stringify(layout) !== receipt.signature)
      changedPart = 'grid'
    else if (
      !this.host.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all)
    )
      changedPart = 'groups'
    if (
      !this.host.presentationTransition &&
      state.presentationId === this.host.presentationId &&
      state.presentationControlRevision ===
        this.host.presentationControlRevision &&
      receipt === this.host.layoutReceipt &&
      (changedPart || !this.host.sameStudyPanePositions(receipt.panes))
    ) {
      this.host.presentationConfirmed = false
      this.changedLayoutPart = changedPart && { receipt, part: changedPart }
      this.host.publish()
    }
    const current = this.host.presentationState()
    if (layout !== undefined) return current
    // Another editor part (an agent chat) has the keyboard focus and the read must not take it: while no tab or group changed since the last arrangement, its confirmation is answered again, marked as not measured.
    if (current.layoutConfirmed) return { ...current, layoutMeasured: false }
    // An unmeasurable active part qualifies this response only; it cannot invalidate or certify the retained main grid.
    return {
      ...current,
      layoutConfirmed: false,
      reason:
        'Main editor layout could not be checked without changing focus. Focus a Codebook pane or main text editor and read again.',
    }
  }

  /**
   * Retires a refused replay control shown in the Learning replay panel once a later seek, play or pause was accepted.
   *
   * Called by the panel's own playback message and by {@link StudyService.playback} for an agent's control, so the line
   * does not outlive the refusal whichever route moved the replay.
   *
   * @example workspace.replayControlAccepted()
   */
  replayControlAccepted(): void {
    if (this.host.errors.delete('replay-control')) this.host.publish()
  }

  /** Rejects competing input/navigation before effects while preserving Stop/Close/read access. @example workspace.assertPresentationIdle() */
  assertPresentationIdle(): void {
    if (
      this.host.presentationTransition ||
      this.host.returningCurrent ||
      this.host.closing
    ) {
      this.logPendingRefusal()
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        'A presentation change or reader close is pending. Read its state before another control.',
      )
    }
  }

  /**
   * Reserves one current reader intent before asynchronous work; all three entry points share its native/storage receipts.
   * @param input - The requested change with the reader lifetime and control revision it was made for.
   * @param requester - `'agent'` for the codebook_presentation tool's handler ({@link StudyService.selectPresentation}), whose caller may have the learner typing in a chat view: beside such a view the selection gives the keyboard to no place it cannot prove (row 613). The Study pane's control and the commands are the learner's.
   * @param fromPane - `true` (the learner's default) for a control the learner pressed in a Study pane or view, whose focus rule the arrangement keeps; `false` for an agent's request and for the learner's Arrange Study Workspace run from the command palette or a shortcut ({@link action}), which no pane's press focused (row 638).
   * @returns The state after the admitted change.
   * @example await workspace.changePresentation({presentationId,expectedRevision:0,mode:'study-workspace',action:'select'}, 'agent')
   */
  changePresentation(
    input: PresentationIntent,
    requester: PresentationRequester = 'learner',
    fromPane = requester === 'learner',
  ): Promise<PresentationState> {
    // A Codebook-owned captured source that the learner moved into a group of their own goes back to its Study column first; the placement below cannot move it (more than three groups) or never looks at it (a run's following composition).
    if (this.host.restoresDisplacedCapturedSource(input)) {
      // Registered like every presentation path, so Close waits for the return's native steps and a late show cannot reopen an owned tab after the cleanup.
      const pending = this.host.returnDisplacedCapturedSourceThenAdmit(
        input,
        requester,
        fromPane,
      )
      this.host.presentationOperation = pending
      const release = (): void => {
        if (this.host.presentationOperation === pending)
          this.host.presentationOperation = undefined
      }
      pending.then(release, release)
      return pending
    }
    return this.host.admitPresentation(input, 'pending', requester, fromPane)
  }

  /**
   * Confirms the live or recording arrangement when it holds a layout receipt, and then retires the lines of an earlier refusal; called by the composition branch of {@link admitPresentation} after {@link assertPlacedEvidenceUnchanged}.
   * @example this.confirmCompositionByReceipt() // presentationConfirmed === true after a completed arrangement
   */
  confirmCompositionByReceipt(): void {
    this.host.presentationConfirmed = Boolean(this.host.layoutReceipt)
    if (this.host.presentationConfirmed) this.host.retireRefusalLines()
  }

  /**
   * Ends a presentation transition unless a newer one has replaced it; called by the composition branch of {@link admitPresentation} when its arrangement ended, and by {@link selectAfterClosingLeftoverTabs} when its close of the leftover tabs ended, successfully or not.
   * @param transition - The transition that arrangement or close ran in.
   * @example this.endPresentationTransition(transition)
   */
  endPresentationTransition(
    transition: NonNullable<StudyWorkspace['presentationTransition']>,
  ): void {
    if (this.host.presentationTransition === transition)
      this.host.presentationTransition = undefined
  }

  /**
   * Reads the presentation state after the live or recording panes were arranged again and answers with it only when its layout is confirmed; the last step of the composition branch of {@link admitPresentation}.
   * @returns The confirmed state.
   * @throws `PRESENTATION_UNAVAILABLE` with the reason why the layout is not confirmed.
   * @example return this.confirmedCompositionState()
   */
  confirmedCompositionState(): PresentationState {
    const restored = this.host.presentationState()
    // The host can replace a pane wrapper after Arrange; a layout lacking its current receipt is not a successful Restore.
    if (!restored.layoutConfirmed)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        unconfirmedCompositionRefusal(this.host.summaryComposition),
        this.host.coveredSourceCause() ?? restored.reason,
      )
    return restored
  }

  /**
   * Answers a selection of the live or recording arrangement that is confirmed already; called by {@link admitPresentation}. The state is read once more as a status read does, without taking the focus.
   * @param input - The admitted selection.
   * @param requester - Who asked for it; a repeated request keeps it.
   * @returns The confirmed state; or, when the read finds the layout changed, what arranging it again answers.
   * @example
   * ```ts
   * if (input.action === 'select' && this.presentationState().layoutConfirmed) return this.confirmCompositionNoop(input, requester)
   * ```
   */
  confirmCompositionNoop(
    input: PresentationIntent,
    requester: PresentationRequester,
  ): Promise<PresentationState> {
    const lifetime = this.host.lifetime
    const checking: Promise<PresentationState> = this.host
      .readPresentationState()
      .then((state) => {
        this.host.assertLifetime(lifetime)
        if (this.host.presentationOperation === checking)
          this.host.presentationOperation = undefined
        // The read unconfirms a layout that changed, so the repeated request takes the arranging branch.
        if (!state.layoutConfirmed)
          return this.host.changePresentation(input, requester)
        this.host.presentationReason = undefined
        this.host.errors.delete('presentation')
        return { ...state, state: 'open' as const }
      })
      .finally(() => {
        if (this.host.presentationOperation === checking)
          this.host.presentationOperation = undefined
      })
    this.host.presentationOperation = checking
    return checking
  }

  /** Rechecks actual native geometry before a same-mode no-op, retaining the revision only when no repair is needed; a repair keeps the request's `requester`. @example await this.confirmPresentationNoop(input, 'learner') */
  confirmPresentationNoop(
    input: PresentationIntent,
    requester: PresentationRequester,
  ): Promise<PresentationState> {
    const transition = {
        id: this.host.presentationId,
        cancellation: new AbortController(),
      },
      lifetime = this.host.lifetime
    this.host.presentationTransition = transition
    let checking!: Promise<PresentationState>
    // eslint-disable-next-line prefer-const -- the async body compares the shared transition against its own promise.
    checking = (async () => {
      try {
        const layout = await this.host.readPassivePresentationLayout()
        this.host.assertLifetime(lifetime)
        transition.cancellation.signal.throwIfAborted()
        const receipt = this.host.layoutReceipt
        // Another editor part (an agent chat) has the keyboard, so the main grid cannot be measured without taking it: while no tab or group changed since the last arrangement, its confirmation is answered again, marked as not measured, as a status read answers it.
        if (
          layout === undefined &&
          receipt &&
          this.host.presentationState().layoutConfirmed &&
          this.host.sameEditorGroups(
            receipt.groups,
            vscode.window.tabGroups.all,
          ) &&
          this.host.sameStudyPanePositions(receipt.panes)
        ) {
          this.host.errors.delete('presentation')
          this.host.presentationReason = undefined
          this.host.requestedPresentation = undefined
          return {
            ...this.host.presentationState(),
            state: 'open' as const,
            layoutMeasured: false as const,
          }
        }
        // Once a tab or group changed beside a focused tab of another editor part, nobody can focus the main editor first: the panes are arranged again below, which measures it.
        if (layout === undefined && !this.host.retainForeignTabFocus(undefined))
          throw new StudyError(
            'PRESENTATION_UNAVAILABLE',
            'Focus a Codebook pane or main text editor before confirming this presentation; its layout cannot be checked from the current editor part.',
          )
        if (
          this.host.presentationState().layoutConfirmed &&
          isProportionalEditorLayout(
            STUDY_PRESENTATIONS[input.mode].layout,
            layout,
          )
        ) {
          // A verified selection recovers only presentation diagnostics, preserving unrelated failed controls.
          this.host.errors.delete('presentation')
          this.host.presentationReason = undefined
          this.host.requestedPresentation = undefined
          return { ...this.host.presentationState(), state: 'open' as const }
        }
        this.host.presentationTransition = undefined
        this.host.presentationConfirmed = false
        return await this.host.changePresentation(input, requester)
      } finally {
        if (this.host.presentationTransition === transition) {
          this.host.presentationTransition = undefined
          this.host.publish()
        }
        if (this.host.presentationOperation === checking)
          this.host.presentationOperation = undefined
      }
    })()
    this.host.presentationOperation = checking
    return checking
  }

  /** Reconfirms an enlarged Study grid without replacing panes, falling back to normal Restore, for the same `requester`, when geometry changed. @example await this.confirmEnlargedLayout(input, 'learner') */
  confirmEnlargedLayout(
    input: PresentationIntent,
    requester: PresentationRequester,
  ): Promise<PresentationState> {
    const transition = {
        id: this.host.presentationId,
        cancellation: new AbortController(),
      },
      lifetime = this.host.lifetime
    this.host.presentationTransition = transition
    this.host.requestedPresentation = input.mode
    this.host.presentationReason = undefined
    let checking!: Promise<PresentationState>
    // eslint-disable-next-line prefer-const -- the async body compares the shared transition against its own promise.
    checking = (async () => {
      try {
        if (await this.tryConfirmEnlargedLayout(transition))
          return { ...this.host.presentationState(), state: 'open' as const }
        transition.cancellation.signal.throwIfAborted()
        this.host.assertLifetime(lifetime)
        if (this.host.presentationTransition === transition)
          this.host.presentationTransition = undefined
        return await this.host.changePresentation(input, requester)
      } finally {
        if (this.host.presentationTransition === transition)
          this.host.presentationTransition = undefined
        if (this.host.presentationOperation === checking)
          this.host.presentationOperation = undefined
        this.host.publish()
      }
    })()
    this.host.presentationOperation = checking
    this.host.publish()
    return checking
  }

  /** Restores the measured grid after Enlarge through an owned main pane, tolerating a late switch between its panels. @example await this.tryConfirmEnlargedLayout(transition) */
  private async tryConfirmEnlargedLayout(
    transition: NonNullable<StudyWorkspace['presentationTransition']>,
  ): Promise<boolean> {
    const enlarged = this.host.enlargedLayoutReceipt,
      receipt = enlarged?.receipt
    if (
      !receipt ||
      receipt !== this.host.layoutReceipt ||
      receipt.mode !== 'study'
    ) {
      if (this.host.enlargedLayoutReceipt === enlarged)
        this.host.enlargedLayoutReceipt = undefined
      return false
    }
    const lifetime = this.host.lifetime,
      id = this.host.presentationId,
      controlRevision = this.host.presentationControlRevision
    const selection = JSON.stringify(this.host.selection),
      bundle = this.host.recordingActive
        ? this.host.playback?.bundle()
        : undefined
    const runtimeIdentity = this.host.assertPresentationAdmission()
    const retained = () =>
      this.host.lifetime === lifetime &&
      this.host.presentationId === id &&
      this.host.presentationControlRevision === controlRevision &&
      this.host.presentationTransition === transition &&
      !transition.cancellation.signal.aborted &&
      !this.host.closing &&
      vscode.window.state.focused &&
      this.host.layoutReceipt === receipt &&
      this.host.presentationMode === enlarged?.mode &&
      JSON.stringify(this.host.selection) === selection &&
      (!this.host.recordingActive || this.host.playback?.bundle() === bundle) &&
      this.host.sameEditorGroups(receipt.groups, vscode.window.tabGroups.all) &&
      this.host.sameStudyPanePositions(receipt.panes) &&
      this.layoutSourceReady() &&
      Boolean(this.host.app?.visible && this.host.contextPanel?.visible) &&
      this.host.hasMainEditorFocus(STUDY_EDITOR_GROUP_COUNT)
    let confirmed = false
    await this.host.withLayout(
      transition.cancellation.signal,
      async (_layoutLifetime, assertCurrent) => {
        assertCurrent()
        if (this.host.enlargedLayoutReceipt !== enlarged || !retained()) return
        this.host.enlargedLayoutReceipt = undefined
        // A late switch between owned Study and Application changes focus, but leaves the measured main grid intact.
        const layout = await this.host.executeEditorCommand<unknown>(
          'vscode.getEditorLayout',
        )
        assertCurrent()
        if (
          !retained() ||
          JSON.stringify(layout) !== enlarged.expandedSignature ||
          runtimeIdentity !== this.host.assertPresentationAdmission()
        )
          return
        // Editor-layout reads omit maximization, so reapplying the measured grid must clear it before confirmation.
        await this.host.executeEditorCommand(
          'vscode.setEditorLayout',
          JSON.parse(receipt.signature),
        )
        // The measured layout is the one the Enlarge began from: the sizes kept for a Close are given back with it.
        this.host.groupSizesBeforeExpand = undefined
        assertCurrent()
        const restoredLayout = await this.host.executeEditorCommand<unknown>(
          'vscode.getEditorLayout',
        )
        assertCurrent()
        if (
          !retained() ||
          !isProportionalEditorLayout(
            STUDY_PRESENTATIONS[this.host.presentationMode].layout,
            restoredLayout,
          ) ||
          runtimeIdentity !== this.host.assertPresentationAdmission()
        )
          return
        this.host.presentationControlRevision++
        this.host.presentationConfirmed = true
        this.host.requestedPresentation = undefined
        this.host.presentationReason = undefined
        this.host.errors.delete('layout')
        this.host.errors.delete('presentation')
        this.host.publish()
        await this.host.savePresentationPreference(
          this.host.presentationMode,
          id,
        )
        assertCurrent()
        confirmed = true
      },
    )
    if (!confirmed && this.host.enlargedLayoutReceipt === enlarged)
      this.host.enlargedLayoutReceipt = undefined
    return confirmed
  }

  /** Reads only the mode preference and preserves unknown versions until an explicit learner/agent selection. @example this.readPresentationPreference() */
  readPresentationPreference(): void {
    try {
      const stored = this.host.context.workspaceState.get<unknown>(
        PRESENTATION_PREFERENCE_KEY,
      )
      const parsed = presentationPreferenceSchema.safeParse(stored)
      this.host.presentationMode = parsed.success
        ? parsed.data.mode
        : 'study-workspace'
      this.presentationPreference =
        stored === undefined
          ? { status: 'default' }
          : parsed.success
            ? { status: 'saved', mode: parsed.data.mode }
            : {
                status: 'unknown',
                reason:
                  'Saved presentation is not recognized. Study workspace is temporary; select a mode explicitly to replace this preference.',
              }
    } catch (error) {
      this.presentationPreference = {
        status: 'failed',
        reason: `Presentation preference unavailable: ${String(error)}`,
      }
    }
  }

  /** Separates successful native placement from its optional durable preference receipt; Close drains accepted writes. @example await this.savePresentationPreference(mode, id) */
  async savePresentationPreference(
    mode: PresentationMode,
    presentationId: string,
  ): Promise<void> {
    this.presentationPreference = { status: 'saving', mode }
    this.host.publish()
    const write = Promise.resolve().then(() =>
      this.host.context.workspaceState.update(PRESENTATION_PREFERENCE_KEY, {
        version: PRESENTATION_PREFERENCE_VERSION,
        mode,
      }),
    )
    this.host.presentationWrite = write
    try {
      await write
      if (presentationId === this.host.presentationId)
        this.presentationPreference = { status: 'saved', mode }
    } catch (error) {
      if (presentationId === this.host.presentationId)
        this.presentationPreference = {
          status: 'failed',
          mode,
          reason: `Layout applied; preference not saved: ${String(error)}. Retry Save preference.`,
        }
    } finally {
      if (this.host.presentationWrite === write)
        this.host.presentationWrite = undefined
    }
  }

  /**
   * Confirms the actual arrangement {@link open} completed for {@link performPresentation}, including a cold default Study retaining its prepared App and original groups.
   * @param input - The admitted request for the Study workspace.
   * @returns The state of the arranged live or replay panes, confirmed.
   * @throws `PRESENTATION_UNAVAILABLE` for another mode, and when the arrangement the open made holds no layout receipt or its source is not shown.
   * @example
   * ```ts
   * if (this.liveComposition || this.summaryComposition) return this.confirmEnteredComposition(input)
   * ```
   */
  confirmEnteredComposition(input: PresentationIntent): PresentationState {
    this.host.assertCompositionAllows(input)
    this.host.presentationConfirmed = Boolean(this.host.layoutReceipt)
    this.host.requestedPresentation = undefined
    const entered = this.host.presentationState()
    // The open keeps what it could arrange; without its receipt the answer names the missing condition instead of a confirmed layout.
    if (!entered.layoutConfirmed)
      throw new StudyError(
        'PRESENTATION_UNAVAILABLE',
        unconfirmedCompositionRefusal(this.host.summaryComposition),
        this.host.coveredSourceCause() ?? entered.reason,
      )
    this.host.errors.delete('layout')
    this.host.errors.delete('presentation')
    return { ...entered, state: 'open' }
  }

  /**
   * Says whether a test replay is only opening: the host's open or a pane's open is under way, so its recorded-source slot is not committed yet; read by {@link presentationState}, which says "opening" for it and not "not shown" (F416).
   * @returns `true` between the start of a test replay's open and its end.
   * @example if (this.testReplayIsOpening()) reason = 'The recorded source is opening in its native pane.'
   */
  private testReplayIsOpening(): boolean {
    return (
      this.host.hostOpeningTestReplay ||
      this.host.pendingNodeHistory !== undefined
    )
  }

  /**
   * Says whether the source the layout shows is ready: the article's captured source ({@link sourceReady}), or, while a test replay is selected or opening, the replay's own recorded-source slot with its tab in front and its content committed (F402): in any group in the summary composition, as a browser replay's source, else at the source position.
   * Read by {@link presentationState} for `layoutConfirmed` and by {@link confirmEnlargedLayout} before an Enlarge's Restore confirms, so both apply one rule.
   * @returns `true` when the source of the current composition is shown.
   * @example this.layoutSourceReady() // => false while the slot's tab is closed under a selected test replay
   */
  private layoutSourceReady(): boolean {
    if (!this.host.testReplayHoldsComposition()) return this.host.sourceReady()
    const slot = this.host.nodeSourceSlot,
      held = this.host.nodeSourceSlotHeld
    if (
      !this.host.opened ||
      this.host.closing ||
      !slot ||
      held?.text !== slot.text ||
      held.address !== slot.uri.toString()
    )
      return false
    const isSlotInFront = (group: vscode.TabGroup): boolean =>
      group.activeTab?.input instanceof vscode.TabInputText &&
      group.activeTab.input.uri.toString() === slot.uri.toString()
    // The summary composition shows the slot as a browser replay shows its captured source, in front of any group: the learner's own groups may hold the source column there (Cycle 0051, DS-A).
    if (this.host.summaryComposition)
      return vscode.window.tabGroups.all.some(isSlotInFront)
    // The slot shows at the selected mode's source column, as {@link nodeSourceSlotColumn} places it (F424).
    const column = STUDY_PRESENTATIONS[this.host.presentationMode].sourceColumn
    const group = vscode.window.tabGroups.all.find(
      (candidate) => candidate.viewColumn === column,
    )
    return group !== undefined && isSlotInFront(group)
  }

  /**
   * Words the reason of a presentation whose captured source is not in front of its pane while no recording is loading or failed, with the control the learner sees where the reason is shown; called by {@link presentationState} (Cycle 0046 row 695).
   * @returns {@link capturedSourceNotShownReason} of {@link capturedSourceStanding}, for the Learning summary of a recording, the strip of a Live run, or the Study pane.
   * @example this.capturedSourceReason() // => "The Study is set aside since Return to Wiki, so its captured source is not in front of its native pane. Use View recording in the Repository Wiki, or Reload saved recording, to bring the Study back."
   */
  private capturedSourceReason(): string {
    let view: CapturedSourceView = 'study'
    if (this.host.recordingActive) view = 'recording'
    else if (this.host.liveComposition) view = 'live'
    return capturedSourceNotShownReason(this.capturedSourceStanding(), view)
  }

  /**
   * Reads how the captured source stands while {@link sourceReady} is false, for {@link capturedSourceReason}: only the reader's own work under way is something to wait for.
   * @returns
   * - `placing` while the reader's entry, render, source display, presentation change or arrangement is under way
   * - `set-aside` after the learner's Return to Wiki gave the article's groups back ({@link settleArticleReturn}) and no Study arrangement followed
   * - `closed` when no tab of the captured source is open, `covered` when one is open behind another tab
   * - `not-shown` otherwise: no source was shown for the selection, or the tab in front is not its current display
   * @example this.capturedSourceStanding() // => 'closed' right after the learner closed the captured source's tab by hand
   */
  private capturedSourceStanding(): CapturedSourceStanding {
    // The reader's own work places the source: waiting brings it.
    if (
      this.host.loading ||
      this.host.sourceEntryPending ||
      this.host.pendingSourceDisplay !== undefined ||
      this.host.presentationTransition !== undefined ||
      this.host.arranging !== undefined
    )
      return 'placing'
    // The learner's Return to Wiki left the Study open behind the article's groups (row 567's retention).
    if (this.host.repositoryLayoutRestored) return 'set-aside'
    const uri = this.host.sourceUri?.toString()
    // No source was shown for the selection at all.
    if (uri === undefined) return 'not-shown'
    const groups = vscode.window.tabGroups.all
    if (
      !groups.some((group) =>
        group.tabs.some((tab) => this.host.textTabUri(tab) === uri),
      )
    )
      return 'closed'
    // A tab in front that still fails sourceReady is not the selection's current display.
    return groups.some((group) => this.host.textTabUri(group.activeTab) === uri)
      ? 'not-shown'
      : 'covered'
  }

  /** Records real pane positions so {@link restoreRepositoryLayout} distinguishes learner moves from its own group contraction. @example this.studyPanePositions().contextColumn */
  studyPanePositions() {
    const sourceGroups = vscode.window.tabGroups.all.filter((group) =>
      group.tabs.some(
        (tab) =>
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.toString() === this.host.sourceUri?.toString(),
      ),
    )
    const identity =
      this.host.sourceGroup &&
      this.host.editorGroupIdentities.get(this.host.sourceGroup)
    const sourceGroup =
      sourceGroups.find(
        (group) =>
          group === this.host.sourceGroup ||
          (identity && this.host.editorGroupIdentities.get(group) === identity),
      ) ??
      sourceGroups.find(
        (group) => group === vscode.window.tabGroups.activeTabGroup,
      ) ??
      sourceGroups[0]
    return {
      app: this.host.app,
      appColumn: this.host.app?.viewColumn,
      context: this.host.contextPanel,
      contextColumn: this.host.contextPanel?.viewColumn,
      sourceGroup,
      sourceColumn: sourceGroup?.viewColumn,
    }
  }

  /** Checks owned Study destinations before Restore reuses panes instead of replacing the learner's current reader. @example this.hasStudyPaneColumns() */
  hasStudyPaneColumns(): boolean {
    const panes = this.host.studyPanePositions(),
      descriptor = STUDY_PRESENTATIONS['study-workspace']
    return Boolean(
      panes.app &&
      panes.context &&
      this.host.sourceUri &&
      panes.appColumn === descriptor.appColumn &&
      panes.sourceColumn === descriptor.sourceColumn &&
      panes.contextColumn === descriptor.contextColumn,
    )
  }

  /** Accepts a host-clamped Study topology while withholding the proportional layout receipt; cold Open and Restore use this boundary. @example await this.hasRetainedStudyTopology() */
  async hasRetainedStudyTopology(
    signal?: AbortSignal,
    beforeScopeFocus?: (acquire?: RepositoryFocusTarget) => void,
  ): Promise<boolean> {
    const grid = await this.host.readMainEditorGrid(
      signal,
      () => signal?.throwIfAborted(),
      undefined,
      beforeScopeFocus,
    )
    // Everything after the grid read is synchronous, so the group is read once.
    const parsed = editorLayoutSchema.safeParse(grid.layout),
      isNativeComposition = this.host.hasComposition(),
      applicationGroup = this.host.applicationGroup
    if (isNativeComposition && applicationGroup)
      return (
        grid.groups.length === applicationGroup.count &&
        grid.preservesOtherParts(applicationGroup.count) &&
        isProportionalEditorLayout(applicationGroup.layout, grid.layout)
      )
    if (isNativeComposition)
      return (
        grid.groups.length === LIVE_EDITOR_GROUP_COUNT &&
        grid.preservesOtherParts(LIVE_EDITOR_GROUP_COUNT) &&
        parsed.success &&
        parsed.data.orientation === LIVE_EDITOR_LAYOUT.orientation &&
        parsed.data.groups.length === LIVE_EDITOR_GROUP_COUNT &&
        parsed.data.groups.every((group) => !group.groups)
      )
    return (
      grid.groups.length === STUDY_EDITOR_GROUP_COUNT &&
      grid.preservesOtherParts(STUDY_EDITOR_GROUP_COUNT) &&
      parsed.success &&
      parsed.data.orientation === HORIZONTAL_EDITOR_ORIENTATION &&
      parsed.data.groups.length === 2 &&
      parsed.data.groups[0]?.groups?.length === 2 &&
      !parsed.data.groups[1]?.groups
    )
  }

  /** Rejects learner pane moves while allowing wrapper resync and the explicit source relocation owned by a reentry receipt. @example this.sameStudyPanePositions(receipt.panes, receipt.sourceTargetColumn) */
  sameStudyPanePositions(
    previous: ReturnType<StudyWorkspace['studyPanePositions']>,
    sourceTargetColumn?: vscode.ViewColumn,
  ): boolean {
    const current = this.host.studyPanePositions(),
      sourceIdentity =
        previous.sourceGroup &&
        this.host.editorGroupIdentities.get(previous.sourceGroup)
    const sourceRetained =
      previous.sourceColumn === current.sourceColumn &&
      (previous.sourceGroup === current.sourceGroup ||
        Boolean(
          sourceIdentity &&
          current.sourceGroup &&
          sourceIdentity ===
            this.host.editorGroupIdentities.get(current.sourceGroup),
        ))
    const sourceRestored =
      sourceTargetColumn !== undefined &&
      current.sourceColumn === sourceTargetColumn
    return (
      previous.app === current.app &&
      previous.appColumn === current.appColumn &&
      previous.context === current.context &&
      previous.contextColumn === current.contextColumn &&
      (sourceRetained || sourceRestored)
    )
  }
}

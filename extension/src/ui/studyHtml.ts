import { randomUUID } from 'node:crypto'

import type {
  NodeTestHistoryIndex,
  NodeTestHistoryLearningDecision,
  NodeTestLearningMaterial,
} from '../nodeTestHistorySchemas'
import type { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import type { PlaybackState, PlaybackBundle } from '../playbackController'
import type {
  PresentationState,
  PresentationReadingPose,
  PresentationPoseCapture,
  PresentationPoseRestore,
} from '../presentationSchemas'
import type { RetainedStudy } from '../retainedStudySchemas'
import { installWebviewFocus } from '../runtimeSupport/utils/installWebviewFocus'
import type { LiveStudy, projectStudy } from '../studyModel'
import type { StudyCatalogEntry } from '../studySchemas'
import type { StudyDescriptor } from '../utils/describeStudy'
import { installShortcutHelp } from '../utils/installShortcutHelp'
import type { projectLearningSummary } from '../utils/projectLearningSummary'
import type { ShownInterpretation } from '../utils/projectRecording'
import type { OpenRequestSettled } from '../utils/readOpenRequest'
import { savedLaterNote } from '../utils/savedLaterNote'
import { savedStudyLabel } from '../utils/savedStudyLabel'

import { STUDY_STYLES, STUDY_UI_OPTIONS, STUDY_SHORTCUTS } from './constants'

/**
 * The learner's last removal of a saved study, from its confirmation dialog to its outcome.
 * `confirming` and `moving` are in progress; `moved`, `refused` and `failed` carry the sentence shown under the button.
 */
export interface StudyRemovalView {
  status: 'confirming' | 'moving' | 'moved' | 'refused' | 'failed'
  studyId: string
  text?: string
  /** The number the asking pane gave the delete request this state answers (`removalRequest` of its `delete-study` message); absent for a request without a number. */
  request?: number
  /** The files and folders of the study, listed for removal by hand: set on the refusal a window without a Trash answers a delete request with. A `copy-study-files` message copies them to the clipboard. */
  files?: string[]
}

/**
 * The host's answer to the one pane that sent a `copy-study-files` message, posted after the clipboard write settled: how many paths of the study's listed files were copied, or that none was (the clipboard refused, or the host keeps no list for that study).
 * The pane writes its confirmation line from this answer, so it never confirms a copy that did not happen.
 */
export type StudyFilesCopied =
  | {
      type: 'study-files-copied'
      studyId: string
      status: 'copied'
      /** The number of paths written to the clipboard, one a line. */
      count: number
    }
  | { type: 'study-files-copied'; studyId: string; status: 'failed' }

export interface StudyViewMessage {
  type: 'study'
  revision: number
  model: ReturnType<typeof projectStudy>
  study?: Pick<
    RetainedStudy,
    | 'id'
    | 'state'
    | 'terminal'
    | 'createdAt'
    | 'reason'
    | 'profile'
    | 'finalOutcome'
    | 'links'
  > & {
    historyOutcome: string
    studyOutcome: string
    recordingSave?: Pick<
      LiveStudy['recording'],
      'status' | 'contextStatus' | 'reason' | 'contextReason'
    >
  }
  liveState?: string
  deadlineAt?: string
  busy: boolean
  saving: boolean
  loading: boolean
  errors: string[]
  /** How many of `errors` Retry storage / refresh cannot answer (a layout notice, a refused control); the pane offers Retry only for the others. */
  unretryableErrorCount?: number
  canClick: boolean
  canRun: boolean
  nextAction?: StudyDescriptor['actions'][number]
  liveProfile?: RetainedStudy['profile']
  liveTitle?: string
  profiles: Pick<StudyDescriptor, 'id' | 'title' | 'description'>[]
  moments: {
    id: string
    itemId: string
    title: string
    at: string
    elapsedMs?: number
  }[]
  studies: StudyCatalogEntry[]
  studyRemoval?: StudyRemovalView
  /** Set in a window without a Trash (a WSL remote window): a delete request moves nothing there and is answered with the study's files for removal by hand. */
  removalWithoutTrash?: true
  /** The files and folders the host listed for removal by hand in a window without a Trash, by study: every list a pane asked for, so each pane shows the one of the entry it has chosen. */
  studyFiles?: Record<string, string[]>
  /** Why the current run never started; shown first in the error region and no reason to offer Retry storage. */
  runRefusal?: string
  /** The saved study of this window's run that has not stopped, which cannot be deleted. */
  unstoppedStudyId?: string
  nodeHistoryCatalog?: Awaited<ReturnType<NodeTestHistoryStore['list']>>
  nodeHistory?: NodeTestHistoryIndex
  nodeHistoryPage?: number
  nodeHistoryPageCount?: number
  nodeHistoryEventCount?: number
  nodeHistoryLearningDecision?: NodeTestHistoryLearningDecision
  nodeHistoryLearningMaterial?: NodeTestLearningMaterial
  /** Sequences of the shown Node stops whose captured source failed the extension's verification (path, line or text hash); they get no Inspect. */
  nodeHistoryUnverifiedStops?: number[]
  nodeHistoryPlayback?: {
    mode: 'paused' | 'playing'
    sequence?: number
    positionMs?: number
    startMs?: number
    endMs?: number
    loading: boolean
  }
  nodeHistoryPosition?: {
    sequence: number
    type: 'output' | 'stop' | 'result'
    index?: number
    eventIndex: number
    elapsedMs: number
    /** The stop's captured source is verified and matches it; unlike {@link debuggerAvailable}, ending the session never clears it. */
    sourceAvailable?: boolean
    /** The owned native session shows this stop now. */
    debuggerAvailable?: boolean
    nativeValuesUninspected?: boolean
  }
  nodeHistoryOutput?: string
  contentTab?: 'overview' | 'live' | 'recording'
  playbackPanelVisible?: boolean
  presentation?: PresentationState
  repositoryReturnAvailable?: boolean
  repositoryArticleAvailable?: boolean
  recording?: PlaybackState &
    Pick<
      PlaybackBundle['projection'],
      'pauseConfirmed' | 'rendererConfirmed' | 'laterInterpretations'
    > & {
      learningSummary?: ReturnType<typeof projectLearningSummary>
      nativeValuesUninspected?: boolean
      /** Another tab is in front of the recorded application: the moment is recorded and only hidden, and `loading` is not raised for it. */
      applicationCovered?: boolean
    }
}
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
  getState(): { visited?: string[] } | undefined
  setState(state: unknown): void
}

/**
 * Gives a piece of the Study page's markup to one of its two panes only, so {@link studyHtml} names in each place which pane carries the piece.
 * @param kind - The pane the page is built for.
 * @param shownIn - The pane that carries the piece.
 * @param markup - A class name, an attribute or elements.
 * @returns `markup` for that pane, an empty string for the other.
 * @example
 * markupOnlyIn('moments', 'moments', 'hidden') // => 'hidden'
 * markupOnlyIn('context', 'moments', 'hidden') // => ''
 */
function markupOnlyIn(
  kind: 'context' | 'moments',
  shownIn: 'context' | 'moments',
  markup: string,
): string {
  return kind === shownIn ? markup : ''
}

/** Supplies a nonce-scoped thin reader; {@link StudyWorkspace} posts typed snapshots separately from HTML. @example studyHtml('context') */
export function studyHtml(kind: 'context' | 'moments'): string {
  const nonce = randomUUID()
  // The values hint and its button stand where their arrival moves no transport control: above the controls in the summary, whose transport is fixed to the bottom and grows upward, and below them in the bottom panel, whose transport starts at the top.
  const valuesHint =
    '<p id="playback-hint" class="muted" role="status" aria-live="polite"></p><button id="playback-show-variables" type="button" data-action="show-variables" hidden>Show Variables</button>'
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src data:;"><style nonce="${nonce}">${STUDY_STYLES}</style></head><body class="${markupOnlyIn(kind, 'moments', 'moments-only')}">
<p id="bootstrap-status" class="status" role="status" aria-live="polite">Loading study…</p><main id="study-content" hidden inert>
<header class="learning-header"><p id="reader-kind" class="muted">Codebook study</p><h1 id="title">Codebook study</h1><button type="button" data-shortcut-help aria-label="Keyboard shortcuts" aria-keyshortcuts="?">Keyboard shortcuts <kbd>?</kbd></button></header>
<details id="reader-options" open ${markupOnlyIn(kind, 'moments', 'hidden')}><summary>Study view and pane controls</summary><header class="presentation-header"><nav class="row study-read-tools" aria-label="Study pane reading"><button data-action="read-app" aria-label="Read application">App</button><button data-action="read-source" aria-label="Read captured source">Source</button><button data-action="read-context" aria-label="Read explanation">Explanation</button><button data-presentation="restore">Restore</button></nav><details id="presentation-options"><summary>View options</summary><p id="presentation-caption" class="muted mode-caption"></p><div class="row presentation-tools"><button data-action="enlarge-app">Enlarge application</button><button data-action="enlarge-context">Enlarge explanation</button><button data-presentation="save-preference" hidden>Save preference</button></div></details></header></details><p id="presentation-status" class="presentation-status" role="status" aria-live="polite"></p>
<button data-action="return-wiki" hidden>← Return to Wiki</button><button data-action="open-article" hidden>Open article</button><div class="live-strip"><div id="runtime" role="status" aria-live="polite"></div><div class="row"><button data-action="return-current">Return to current pause</button><button class="primary" data-action="continue">Continue inspected pause</button><button data-action="stop">Stop</button></div><small class="muted" id="deadline"></small></div>
<p id="errors" class="error" role="status" aria-live="polite"></p><button data-action="retry" hidden>Retry storage / refresh</button>

<div ${markupOnlyIn(kind, 'moments', 'hidden')}>
<section id="learning-material" hidden><h2 id="learning-title"></h2><p id="learning-question" class="muted"></p><p id="learning-summary"></p><p class="muted">Saved path · links inspect recorded stops. Source-derived and unknown steps do not establish execution.</p><div id="learning-sequence"></div></section><p id="learning-unavailable" class="muted" hidden>No processing summary or sequence was saved with this recording.</p>
<div role="tablist" aria-label="Study content"><button id="overview-tab" role="tab" data-tab="overview" aria-controls="overview" aria-selected="true">Overview</button><button id="live-tab" role="tab" data-tab="live" aria-controls="live-content" aria-selected="false" tabindex="-1">Live</button><button id="recording-tab" role="tab" data-tab="recording" aria-controls="live-content" aria-selected="false" tabindex="-1">Recording</button></div>
<div id="loading" class="status" hidden>Loading the selected observation…</div><div id="selected"><div class="status" id="observation"></div><div id="overview" role="tabpanel" aria-labelledby="overview-tab"><h2>Source-derived overview</h2><p id="overview-text"></p><button class="link" data-action="source">Read the linked source</button></div><div id="live-content" role="tabpanel" aria-labelledby="live-tab"><section><h2>Agent interpretation</h2><div id="interpretations" role="region" aria-label="Agent interpretation" tabindex="0"></div></section></div>
<details id="later-annotations" hidden><summary>Later annotations — not available at this recorded time</summary><p class="muted">These explanations were added later. They do not change what was observed in the recording.</p><div id="later-interpretations"></div></details>
<section><div class="row"><button class="link" data-action="source">Captured / source-derived document</button><button class="link" data-action="current-file">Open current file</button></div><p id="source-version" class="muted"></p><p id="source-drift" class="error"></p><label><input id="understood" type="checkbox" aria-describedby="understanding-description"><span><span id="understanding-label">I understand this source revision</span><span id="save-state" class="muted"></span></span></label><p id="understanding-description" class="muted" hidden>Applies to this article and every captured citation shown here.</p><p id="progress" class="muted"></p></section></div>
<section><h2>Source-linked flow</h2><div id="flow"></div><p id="correspondence" class="muted"></p></section>
<details id="study-controls"><summary>Study controls</summary><div id="next-scenario"><div class="row"><button class="primary" data-action="connect">Connect your editor agent</button><button data-action="click">Perform configured action once</button></div><p class="muted" id="profile-description">Ask your editor agent to explain a code path in the open repository.</p></div></details>
<section><h2>Workspace panes</h2><div class="row"><button data-action="focus-app">Focus application</button><button data-action="source">Focus source</button><button data-action="focus-context">Focus explanation</button><button data-action="outline">Show learning outline</button><button data-action="arrange">Restore Study arrangement</button></div></section></div>
<p id="recording-save-state" class="status" role="status" aria-live="polite"></p><details id="evidence-details" hidden><summary id="evidence-summary">Evidence status</summary><p id="study-state" class="status" hidden></p></details>
<section id="node-history"><h2>Node test history</h2><p class="muted">Step through a saved Node test entry selected in Saved studies. Captured source and native debugger state appear only at verified stops; output and result events clear debugger state. This test has no application video or synchronized application replay.</p><p id="node-history-status" class="status" role="status"></p><p id="node-history-position" class="status" role="status" aria-live="polite"></p><p id="node-history-hint" class="muted" role="status" aria-live="polite"></p><button id="node-history-show-variables" type="button" data-action="show-variables" hidden>Show Variables</button><label><input id="node-history-understood" type="checkbox"><span>I understand this test history <span id="node-history-understanding-state" class="muted"></span></span></label><section id="node-history-learning" hidden><h3 id="node-learning-title"></h3><p id="node-learning-question" class="muted"></p><p id="node-learning-summary"></p><div id="node-learning-sequence" aria-label="Node test learning sequence"></div><p class="muted">This learning material describes the saved test journal; it does not create application video or claim synchronized application replay.</p></section><div class="playback-row"><button id="node-history-playback-toggle" class="primary" type="button" data-node-history-playback="play">Play</button><label for="node-history-playhead" class="visually-hidden">Recorded test time</label><div class="timeline-track"><input id="node-history-playhead" type="range" min="0" max="0" step="any" value="0" disabled></div><span id="node-history-playback-position" class="muted">Test journal playback</span></div><p class="muted">Timeline follows recorded test events; application video is unavailable.</p><pre id="node-history-output" aria-label="Recorded test output through selected event"></pre><div class="row"><button id="node-history-moment-previous" type="button">Previous event</button><button id="node-history-moment-next" type="button">Next event</button><span id="node-history-page" class="muted"></span><button id="node-history-previous" type="button">Previous page</button><button id="node-history-next" type="button">Next page</button></div><div id="node-history-events"></div></section>
<section id="observed-moments"><h2>Observed moments</h2><p class="muted" id="moments-caption">Select a captured observation or open Recording to follow its time.</p><div id="moments" class="moments"></div></section>
<section id="saved-studies"><h2>Saved studies</h2><select id="studies" aria-label="Saved study"><option value="">No saved study yet</option></select><p id="study-unopenable" class="muted" hidden></p><p id="study-newer" class="muted" hidden></p><p id="study-repairable" class="muted" hidden></p><div id="delete-study-row" class="row" hidden><button id="repair-study" class="primary" type="button" data-action="retry" aria-describedby="study-repairable" hidden>Repair saved study</button><button id="delete-study" type="button" aria-describedby="delete-study-reason delete-study-status">Delete saved study…</button></div><p id="delete-study-reason" class="muted" hidden></p><p id="delete-study-status" role="status" aria-live="polite"></p><details id="study-files" hidden><summary>Remove by hand</summary><p id="study-files-note" role="status" aria-live="polite"></p><ul id="study-files-list" class="muted" aria-label="Files of the chosen saved study"></ul><div class="row"><button id="copy-study-files" type="button">Copy paths</button><button type="button" data-action="retry">Retry storage / refresh</button></div><p id="copy-study-files-status" role="status" aria-live="polite"></p></details></section>
<section id="recording-transport">${markupOnlyIn(kind, 'context', valuesHint)}<div class="playback-row"><button type="button" data-shortcut-help aria-label="Keyboard shortcuts" aria-keyshortcuts="?">?</button><button data-playback="start" title="Replay from start" aria-label="Replay from start">↤</button><button id="previous-moment" data-playback="previous" title="Previous recorded stop" aria-label="Previous recorded stop">◀|</button><button class="primary" id="playback-toggle" data-playback="play">Play</button><button id="next-moment" data-playback="next" title="Next recorded stop" aria-label="Next recorded stop">|▶</button><label for="playhead" class="visually-hidden">Recorded position</label><div class="timeline-track"><input id="playhead" type="range" min="0" max="0" step="1" value="0"><div id="history-coverage" role="img" aria-label="Historical source and debugger coverage unknown" hidden></div><span id="history-coverage-label" class="muted">History coverage unknown</span></div><span id="playback-position"></span></div><div class="playback-status-row"><span id="recording-status" role="status" aria-live="polite"></span><span id="application-covered-remedy" class="${markupOnlyIn(kind, 'context', 'visually-hidden')}${markupOnlyIn(kind, 'moments', 'muted')}" role="status" aria-live="polite"></span><details id="playback-options"><summary>Playback details</summary><button data-action="reload-recording">Reload saved recording</button><p>Recorded history only. Playback does not run application code or mark understanding.</p><details id="playback-diagnostics" hidden><summary>Recording error details</summary><p id="playback-diagnostic" class="error"></p></details></details></div><p id="playback-pending" class="muted"></p><p id="playback-reason" class="error"></p>${markupOnlyIn(kind, 'moments', valuesHint)}</section>
</main>
<script nonce="${nonce}">(${installShortcutHelp.toString()})(${JSON.stringify(STUDY_SHORTCUTS)}, '#study-content');(${studyClient.toString()})(${JSON.stringify(STUDY_UI_OPTIONS)}, ${kind === 'context' ? installWebviewFocus.toString() : 'undefined'}, ${savedStudyLabel.toString()}, ${savedLaterNote.toString()})</script></body></html>`
}

/** Keeps control DOM stable on state updates so native webview messages do not discard keyboard focus. @example studyClient() */
function studyClient(
  options: typeof STUDY_UI_OPTIONS,
  installFocus: typeof installWebviewFocus | undefined,
  studyLabel: typeof savedStudyLabel,
  savedNote: typeof savedLaterNote,
): void {
  const api = acquireVsCodeApi(),
    visited = new Set(api.getState()?.visited ?? [])
  installFocus?.(api)
  let current: StudyViewMessage | undefined
  // A saved study that cannot be opened is chosen in this pane only; the host hears of it when the learner deletes it.
  let unopenableChoice: string | undefined
  // The entry this pane asked the host to open and that is not shown yet; the list keeps it chosen and the delete button waits for it. The host answers the request by its number when it ended without showing the entry.
  let openingChoice: { studyId: string; requestId: number } | undefined
  // Counts this pane's open requests; each webview counts its own, and the host answers only the webview that asked. Each document starts from its load time, so a reply to a request of the document before it never names a request of this one.
  let openRequestCount = Date.now()
  // Counts this pane's delete requests the same way: the host echoes the number in every state of the removal, and two panes that each ask never share one.
  let removalRequestCount = Date.now()
  // The removal outcome this pane stopped showing because the learner chose an entry the host is not told about.
  let dismissedRemoval: string | undefined
  // This pane's own delete request by its number, which the host echoes in every state of that removal, so only the pane the learner used moves focus when the request is answered.
  let removalRequest: { request: number; started: boolean } | undefined
  // In a window without a Trash: this pane's last request for the files of the entry its "Remove by hand" disclosure is offered for. The host echoes `request` in the removal state that answers it, and it answers under the revision the request was sent with (its revision changes only with a render, a navigation or a close), so the number says that an answer is this request's, not the revision. `refusal` is the sentence of an answer that listed no files; it is kept here because the next pane's request replaces the host's removal state.
  let filesRequest:
    | { studyId: string; request: number; revision: number; refusal?: string }
    | undefined
  // In a window without a Trash: the entry the "Remove by hand" disclosure is offered for; another entry, or none, closes it.
  let filesDisclosureStudyId: string | undefined
  let scrubbing = false
  let nodeHistoryScrubbing = false
  // A Show Variables button that left while it held this pane's focus, and where that focus goes: paid when the Study message is rendered if this document has the focus, else at its next focus event, so a pane the learner left for Run and Debug takes no focus back.
  let transportFocusOwed:
    | { leaving: HTMLElement; preferred: readonly string[]; section: string }
    | undefined
  // The control at which this pane's keyboard stands, read as each message of the host arrives: the control that holds the focus, and still that control after the page disabled it or took it out under the focus, which hands the browser's focus to the document body (`isTakenByPage`). A holder that left is owed a place for its focus, and one the page disabled is owed its focus back once it can be used again; both are paid like the transport's, when the message is handled if this document has the focus, else at its next focus event.
  let focusHolder: { control: HTMLElement; isTakenByPage: boolean } | undefined
  let inputRevision = 0
  let poseTransaction:
    | {
        request: PresentationPoseCapture
        inputRevision: number
        invalidated: boolean
        restoring: boolean
      }
    | undefined
  // Real input retires the captured pose; native resize/focus events alone are not a new learner reading choice.
  for (const eventName of ['keydown', 'pointerdown', 'wheel', 'touchstart'])
    document.addEventListener(
      eventName,
      (event) => {
        if (!event.isTrusted) return
        inputRevision++
        if (!poseTransaction || poseTransaction.invalidated) return
        poseTransaction.invalidated = true
        api.postMessage({
          type: 'presentation-pose-invalidated',
          captureId: poseTransaction.request.captureId,
        })
      },
      { capture: true, passive: true },
    )
  const element = (id: string) => {
    const found = document.getElementById(id)
    if (!found) throw new Error(`Missing reader element ${id}`)
    return found
  }
  const send = (message: object): void =>
    api.postMessage({ ...message, revision: current?.revision })
  const button = (action: string) =>
    document.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)
  const text = (id: string, value: string): void => {
    const target = element(id)
    if (target.textContent !== value) target.textContent = value
  }
  // A focus one part of the pane owes to a control of its own choice (the Saved studies list, the same item of a list that was rendered again), for a control that left while it held the focus. It is placed like the transport's: at once while this document has the focus, else at its next focus event, so a pane the learner left takes no focus back.
  let partFocusOwed:
    | {
        leaving: Element
        target: () => HTMLElement | null | undefined
        focusOptions: FocusOptions
      }
    | undefined
  /**
   * Places the focus a part of the pane owes, once; called by {@link moveFocusOf} while this document has the focus, and at the document's next focus event otherwise. A learner who put the focus on another control meanwhile keeps it.
   * @example payPartFocus()
   */
  const payPartFocus = (): void => {
    const owed = partFocusOwed
    if (!owed) return
    partFocusOwed = undefined
    if (
      document.activeElement !== document.body &&
      document.activeElement !== owed.leaving
    )
      return
    owed.target()?.focus(owed.focusOptions)
  }
  // Added ahead of the pane's general rule for a focus that lost its control, so a part's own choice comes first.
  window.addEventListener('focus', payPartFocus)
  /**
   * Moves the focus of a control that left to the control its part of the pane names for it; called by the parts that know a better place than the pane's general rule (Saved studies, the lists that are rendered again).
   * Nothing is focused in a pane that does not have the focus: whether a webview's `focus()` takes the window's keyboard from the editor part the learner is in is not known here, so the move is owed to the pane's next focus event.
   * @param leaving - The control that held the focus and left.
   * @param target - Finds the control that takes the focus, when the focus is placed.
   * @param focusOptions - How the control is focused; without scrolling unless the caller says otherwise.
   * @example moveFocusOf(repair, () => element('studies'))
   */
  const moveFocusOf = (
    leaving: Element,
    target: () => HTMLElement | null | undefined,
    focusOptions: FocusOptions = { preventScroll: true },
  ): void => {
    partFocusOwed = { leaving, target, focusOptions }
    if (document.hasFocus()) payPartFocus()
  }
  const renderKeys = new Map<string, string>()
  const replace = (id: string, data: unknown, children: () => Node[]): void => {
    const key = JSON.stringify(data)
    if (renderKeys.get(id) !== key) {
      renderKeys.set(id, key)
      element(id).replaceChildren(...children())
    }
  }
  const seconds = (elapsed: number) =>
    `${(elapsed / options.secondMs).toFixed(2)} s`
  const playback = (
    action: 'play' | 'pause' | 'seek',
    positionMs?: number,
  ): void => {
    if (current?.recording)
      send({
        type: 'playback',
        action,
        expectedRevision: current.recording.revision,
        ...(positionMs === undefined ? {} : { positionMs }),
      })
  }
  const nodeHistoryPlayback = (
    action: 'play' | 'pause' | 'seek',
    positionMs?: number,
  ): void => {
    const history = current?.nodeHistory
    if (history)
      send({
        type: 'node-history-playback',
        studyId: history.header.studyId,
        action,
        ...(positionMs === undefined ? {} : { positionMs }),
      })
  }
  /** Finds a real captured stop for toolbar stepping; never synthesizes runtime state between observations. @example recordedStep('next') */
  const recordedStep = (direction: 'previous' | 'next'): number | undefined => {
    const recording = current?.recording,
      position = recording?.presentedMs,
      range = recording?.range
    if (!range || position === undefined || recording.readiness !== 'ready')
      return
    const times = (current?.moments ?? [])
      .map((moment) => moment.elapsedMs)
      .filter(
        (time): time is number =>
          time !== undefined && time >= range.startMs && time <= range.endMs,
      )
    return direction === 'previous'
      ? times.filter((time) => time < position).sort((a, b) => b - a)[0]
      : times.filter((time) => time > position).sort((a, b) => a - b)[0]
  }
  const presentation = (
    mode: string,
    action: 'select' | 'restore' | 'save-preference',
  ): void => {
    const state = current?.presentation
    if (state && state.state !== 'applying')
      send({
        type: 'presentation',
        mode,
        action,
        presentationId: state.presentationId,
        expectedRevision: state.presentationControlRevision,
      })
  }
  const readerOptions = element('reader-options')
  let selectedContentTab: StudyViewMessage['contentTab']
  let revealedFollowedObservationId: string | undefined
  let readerOptionsOpenedByLearner = false
  readerOptions.querySelector('summary')?.addEventListener('click', () => {
    readerOptionsOpenedByLearner = !readerOptions.hasAttribute('open')
  })
  const transport = element('recording-transport')
  // Reserve the actual footer height, including expanded recovery details, so reading controls remain reachable; a transport this pane does not show is rendered with nothing in it and has no height.
  new ResizeObserver(() =>
    document.documentElement.style.setProperty(
      '--playback-height',
      `${transport.getBoundingClientRect().height}px`,
    ),
  ).observe(transport)
  /**
   * Brings a recovery disclosure of the transport into the transport's visible box at once; called when the learner opens Playback details or Recording error details.
   * The summary's transport scrolls inside itself and is bounded while these details are open, so what opens below its box would look like a press that did nothing. The scroll is instant (reduced motion needs no branch) and moves no focus.
   * @param disclosure - The disclosure that was opened.
   * @param keptInView - A part above the disclosure that must not leave the box for it: when the reveal pushed its top out, it comes back and the end of the disclosure is reached by scrolling.
   * @example revealInTransport(element('playback-options'), transport.querySelector('.playback-row'))
   */
  const revealInTransport = (
    disclosure: HTMLElement,
    keptInView?: Element | null,
  ): void => {
    disclosure.scrollIntoView({ block: 'nearest' })
    if (
      keptInView &&
      keptInView.getBoundingClientRect().top <
        transport.getBoundingClientRect().top
    )
      keptInView.scrollIntoView({ block: 'nearest' })
  }
  // Playback details open right under the controls, so Play and the playhead stay with them; the error details can be longer than the box and are shown from their summary.
  const playbackOptions = element('playback-options'),
    playbackDiagnostics = element('playback-diagnostics')
  playbackOptions.addEventListener('toggle', () => {
    if (playbackOptions.hasAttribute('open'))
      revealInTransport(
        playbackOptions,
        transport.querySelector('.playback-row'),
      )
  })
  playbackDiagnostics.addEventListener('toggle', () => {
    if (playbackDiagnostics.hasAttribute('open'))
      revealInTransport(playbackDiagnostics)
  })
  const strip = document.querySelector<HTMLElement>('.live-strip')
  // Oversized sticky controls must not hide keyboard focus at narrow widths or enlarged text.
  const adaptStrip = (): void => {
    if (!strip) return
    const height = strip.getBoundingClientRect().height
    strip.classList.toggle(
      'flowing',
      height > window.innerHeight * options.maxStickyFraction,
    )
    // Native focus scrolling must leave room for the visible sticky strip and its outline.
    document.documentElement.style.setProperty(
      '--codebook-sticky-height',
      `${getComputedStyle(strip).position === 'sticky' ? height : 0}px`,
    )
  }
  if (strip) new ResizeObserver(adaptStrip).observe(strip)
  window.addEventListener('resize', adaptStrip)
  document.addEventListener('click', (event) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('button')
        : null
    if (!target || (target instanceof HTMLButtonElement && target.disabled))
      return
    // The selected event's control and the Inspect of a stop already shown in the native debugger stay focusable, and send nothing.
    if (
      target.dataset.nodeHistorySequence &&
      target.getAttribute('aria-disabled') === 'true'
    )
      return
    if (target.dataset.nodeHistorySequence && current?.nodeHistory) {
      send({
        type: target.dataset.inspectNodeHistoryStop
          ? 'node-history-stop'
          : 'node-history-event',
        studyId: current.nodeHistory.header.studyId,
        sequence: Number(target.dataset.nodeHistorySequence),
      })
    } else if (target.dataset.nodeHistoryPlayback) {
      nodeHistoryPlayback(
        target.dataset.nodeHistoryPlayback as 'play' | 'pause',
      )
    } else if (target.dataset.summaryStep) {
      const positions = current?.recording?.learningSummary?.positions
      const position = positions?.find(
        (value) => value.stepId === target.dataset.summaryStep,
      )?.elapsedMs
      if (position !== undefined && current?.recording?.readiness === 'ready')
        playback('seek', position)
    } else if (
      target.dataset.presentation === 'restore' ||
      target.dataset.presentation === 'save-preference'
    ) {
      if (current?.presentation)
        presentation(current.presentation.mode, target.dataset.presentation)
    } else if (target.dataset.action) {
      if (target.classList.contains('link')) {
        visited.add(target.dataset.action)
        target.classList.add('visited')
        api.setState({ visited: [...visited] })
      }
      send({ type: 'action', action: target.dataset.action })
    } else if (target.dataset.playback) {
      if (target.dataset.playback === 'start' && current?.recording?.range)
        playback('seek', current.recording.range.startMs)
      else if (
        target.dataset.playback === 'previous' ||
        target.dataset.playback === 'next'
      ) {
        const position = recordedStep(target.dataset.playback)
        if (position !== undefined) playback('seek', position)
      } else if (
        target.dataset.playback === 'play' ||
        target.dataset.playback === 'pause'
      )
        playback(target.dataset.playback)
    } else if (target.dataset.tab)
      send({ type: 'tab', tab: target.dataset.tab })
    else if (target.dataset.item)
      send({ type: 'select', itemId: target.dataset.item })
  })
  element('understood').addEventListener('change', (event) => {
    if (!(event.target instanceof HTMLInputElement)) return
    const understood = event.target.checked
    event.target.checked =
      current?.model.selectedUnderstanding.understood ?? false
    // Keep pending writes focusable while rejecting repeated keyboard/pointer input until the host settles.
    if (
      !current ||
      current.saving ||
      current.loading ||
      !current.model.selectedUnderstanding.known ||
      event.target.getAttribute('aria-disabled') === 'true'
    )
      return
    event.target.setAttribute('aria-disabled', 'true')
    send({ type: 'understanding', understood })
  })
  element('node-history-understood').addEventListener('change', (event) => {
    if (!(event.target instanceof HTMLInputElement)) return
    const understood = event.target.checked
    event.target.checked =
      current?.nodeHistoryLearningDecision?.understood ?? false
    if (
      !current?.nodeHistory ||
      current.loading ||
      event.target.getAttribute('aria-disabled') === 'true'
    )
      return
    event.target.setAttribute('aria-disabled', 'true')
    send({
      type: 'node-history-understanding',
      studyId: current.nodeHistory.header.studyId,
      understood,
    })
  })
  element('studies').addEventListener('change', (event) => {
    if (!(event.target instanceof HTMLSelectElement) || !event.target.value)
      return
    chooseSavedStudy(event.target.value)
  })
  element('delete-study').addEventListener('click', () => {
    const studyId = chosenStudyId()
    // The button stays focusable while it cannot be used, so its reason can be read; it then sends nothing.
    if (
      element('delete-study').getAttribute('aria-disabled') === 'true' ||
      !studyId
    )
      return
    const request = ++removalRequestCount
    removalRequest = { request, started: false }
    send({ type: 'delete-study', studyId, removalRequest: request })
  })
  element('copy-study-files').addEventListener('click', () => {
    const studyId = chosenStudyId()
    if (!studyId) return
    // Emptied at the press: the host's answer then changes the line also when it reads like the answer before, so a second copy is confirmed again.
    showCopyOutcome('', false)
    send({ type: 'copy-study-files', studyId })
  })
  element('study-files').addEventListener('toggle', () => {
    if (!element('study-files').hasAttribute('open')) {
      showCopyOutcome('', false)
      emptyStudyFiles()
      // Closing ends the request, answered or not: a closed disclosure takes no answer in, so a request kept open across the close would still count as owed when the learner opens it again, and nothing would be asked. Opening asks the host again; an earlier refusal does not stand in for the answer.
      filesRequest = undefined
      return
    }
    const studyId = filesDisclosureStudyId
    if (!current || !studyId) return
    followStudyFiles(current, studyId, true)
    showStudyFilesAnswer(current, studyId)
  })
  // Retry storage / refresh beside a refusal asks for the files again with the Study message that follows the press.
  element('study-files').addEventListener('click', (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest('[data-action="retry"]')
    )
      forgetFilesRefusal()
  })
  element('node-history-previous').addEventListener('click', () => {
    if (current?.nodeHistory && (current.nodeHistoryPage ?? 0) > 0)
      send({
        type: 'node-history-page',
        studyId: current.nodeHistory.header.studyId,
        page: current.nodeHistoryPage! - 1,
      })
  })
  element('node-history-next').addEventListener('click', () => {
    if (
      current?.nodeHistory &&
      (current.nodeHistoryPage ?? 0) + 1 < (current.nodeHistoryPageCount ?? 0)
    )
      send({
        type: 'node-history-page',
        studyId: current.nodeHistory.header.studyId,
        page: (current.nodeHistoryPage ?? 0) + 1,
      })
  })
  element('node-history-moment-previous').addEventListener('click', () => {
    if (current?.nodeHistory)
      send({
        type: 'node-history-step',
        studyId: current.nodeHistory.header.studyId,
        direction: 'previous',
      })
  })
  element('node-history-moment-next').addEventListener('click', () => {
    if (current?.nodeHistory)
      send({
        type: 'node-history-step',
        studyId: current.nodeHistory.header.studyId,
        direction: 'next',
      })
  })
  const nodePlayhead = element('node-history-playhead') as HTMLInputElement
  nodePlayhead.addEventListener('input', () => {
    nodeHistoryScrubbing = true
    text(
      'node-history-playback-position',
      `${(Number(nodePlayhead.value) / options.secondMs).toFixed(2)} s`,
    )
    // Assistive technology hears the time under the thumb while it moves, before the host answers the seek.
    nodePlayhead.setAttribute(
      'aria-valuetext',
      `${seconds(Number(nodePlayhead.value))} of recorded test time`,
    )
  })
  nodePlayhead.addEventListener('change', () => {
    nodeHistoryPlayback('seek', Number(nodePlayhead.value))
    nodeHistoryScrubbing = false
  })
  // A scrub that ends without a change event (focus lost, pointer cancelled) must not keep the playhead from following later seeks and steps.
  for (const scrubEnd of ['blur', 'pointercancel'])
    nodePlayhead.addEventListener(scrubEnd, () => {
      nodeHistoryScrubbing = false
    })
  // Only a moved thumb holds the playhead: a press without a drag fires no input and no change, and must not stop it from following later seeks.
  element('playhead').addEventListener('input', () => {
    scrubbing = true
  })
  // A scrub that ends without a change event (focus lost, pointer cancelled) releases the playhead as well.
  for (const scrubEnd of ['blur', 'pointercancel'])
    element('playhead').addEventListener(scrubEnd, () => {
      scrubbing = false
    })
  element('playhead').addEventListener('change', (event) => {
    scrubbing = false
    if (event.target instanceof HTMLInputElement)
      playback('seek', Number(event.target.value))
  })
  element('playhead').addEventListener('keydown', (event) => {
    if (
      !(event instanceof KeyboardEvent) ||
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      !current?.recording?.range ||
      ![
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'PageUp',
        'PageDown',
        'Home',
        'End',
      ].includes(event.key)
    )
      return
    event.preventDefault()
    const { startMs, endMs } = current.recording.range,
      position = current.recording.presentedMs ?? startMs
    const distance = event.key.startsWith('Page')
      ? options.pageStepMs
      : options.secondMs
    const forward = ['ArrowRight', 'ArrowUp', 'PageUp'].includes(event.key)
    playback(
      'seek',
      event.key === 'Home'
        ? startMs
        : event.key === 'End'
          ? endMs
          : Math.min(
              endMs,
              Math.max(startMs, position + (forward ? distance : -distance)),
            ),
    )
  })
  document
    .querySelector('[role="tablist"]')
    ?.addEventListener('keydown', (event) => {
      if (
        !(event instanceof KeyboardEvent) ||
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
      )
        return
      event.preventDefault()
      const tabs = ['overview', 'live', 'recording'],
        selected = tabs.indexOf(
          current?.contentTab ?? current?.model.selection.tab ?? 'overview',
        )
      const tab =
        event.key === 'Home'
          ? tabs[0]
          : event.key === 'End'
            ? tabs.at(-1)
            : tabs[
                (selected +
                  (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) %
                  tabs.length
              ]
      document.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)?.focus()
      send({ type: 'tab', tab })
    })

  /** Names only known controls for panel replacement; captures no HTML or executable selector. @example focusLocator(document.activeElement) */
  const focusLocator = (
    target: Element | null,
  ): PresentationReadingPose['focus'] => {
    if (!(target instanceof HTMLElement) || target === document.body) return
    const id = options.focusIds.find((id) => id === target.id)
    if (id) return { kind: 'id', id }
    const detail = options.readingDetails.find(
      (id) => id === target.parentElement?.id,
    )
    if (target.tagName === 'SUMMARY' && detail)
      return { kind: 'summary', id: detail }
    const action = options.focusActions.find(
      (action) => action === target.dataset.action,
    )
    if (action)
      return {
        kind: 'action',
        action,
        index: Array.from(document.querySelectorAll('[data-action]'))
          .filter(
            (element) =>
              element instanceof HTMLElement &&
              element.dataset.action === action,
          )
          .indexOf(target),
      }
    if (
      target.dataset.presentation === 'restore' ||
      target.dataset.presentation === 'save-preference'
    )
      return { kind: 'presentation', action: target.dataset.presentation }
    if (target.dataset.playback === 'start') return { kind: 'playback-start' }
    if (target.dataset.summaryStep)
      return { kind: 'summary-step', id: target.dataset.summaryStep }
    const region = target.parentElement?.id
    if (target.dataset.item && (region === 'flow' || region === 'moments'))
      return {
        kind: 'item',
        region,
        itemId: target.dataset.item,
        observationId: target.dataset.observation,
      }
  }
  /** Resolves semantic reading controls after model rendering, without interpolating captured selectors. @example resolveFocus(pose.focus) */
  const resolveFocus = (
    focus: PresentationReadingPose['focus'],
  ): HTMLElement | undefined => {
    if (!focus) return
    if (focus.kind === 'id')
      return (
        document.getElementById(
          focus.id === 'presentation-mode' ? 'interpretations' : focus.id,
        ) ?? undefined
      )
    if (focus.kind === 'summary')
      return (
        document.getElementById(focus.id)?.querySelector('summary') ?? undefined
      )
    if (focus.kind === 'action')
      return Array.from(
        document.querySelectorAll<HTMLElement>('[data-action]'),
      ).filter((element) => element.dataset.action === focus.action)[
        focus.index
      ]
    if (focus.kind === 'presentation')
      return Array.from(
        document.querySelectorAll<HTMLElement>('[data-presentation]'),
      ).find((element) => element.dataset.presentation === focus.action)
    if (focus.kind === 'playback-start')
      return (
        document.querySelector<HTMLElement>('[data-playback="start"]') ??
        undefined
      )
    if (focus.kind === 'summary-step')
      return Array.from(
        document.querySelectorAll<HTMLElement>('[data-summary-step]'),
      ).find((element) => element.dataset.summaryStep === focus.id)
    // Old reading poses retain a useful focus destination after the duplicate value surface is removed.
    if (focus.kind === 'values') return element('interpretations')
    return Array.from(
      document
        .getElementById(focus.region)
        ?.querySelectorAll<HTMLElement>('[data-item]') ?? [],
    ).find(
      (element) =>
        element.dataset.item === focus.itemId &&
        element.dataset.observation === focus.observationId,
    )
  }
  /** Binds capture/restore to the currently rendered learning item and admitted mode operation. @example matchesPose(request) */
  const matchesPose = (
    request: PresentationPoseCapture | PresentationPoseRestore,
  ): boolean =>
    Boolean(
      current &&
      current.revision === request.revision &&
      current.model.selection.itemId === request.itemId &&
      current.model.source.hash === request.sourceHash &&
      current.model.selection.studyId === request.studyId &&
      current.model.observation?.id === request.observationId &&
      (current.contentTab ?? current.model.selection.tab) ===
        request.contentTab &&
      current.presentation?.state === 'applying' &&
      current.presentation.presentationId === request.presentationId &&
      current.presentation.presentationControlRevision ===
        request.expectedRevision,
    )
  /** Captures bounded reading data for the host only after its exact model is displayed. @example capturePose(request) */
  const capturePose = (request: PresentationPoseCapture): void => {
    if (!installFocus || !matchesPose(request)) return
    const anchorId = options.readingAnchors.find((id) => {
      const candidate = element(id)
      return (
        candidate.offsetHeight > 0 &&
        candidate.getBoundingClientRect().bottom > 0
      )
    })
    const anchor = anchorId ? element(anchorId) : undefined,
      focus = focusLocator(document.activeElement)
    if (
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body &&
      !focus
    ) {
      api.postMessage({
        type: 'presentation-pose-invalidated',
        captureId: request.captureId,
      })
      return
    }
    const pose: PresentationReadingPose = {
      anchorId,
      fraction: anchor
        ? Math.max(0, -anchor.getBoundingClientRect().top) / anchor.offsetHeight
        : 0,
      leadingOffsetPx: anchor
        ? Math.max(0, anchor.getBoundingClientRect().top)
        : 0,
      scrollY: Math.max(0, window.scrollY),
      valuesScrollLeft: 0,
      expanded: options.readingDetails.filter(
        (id) =>
          element(id) instanceof HTMLDetailsElement &&
          element(id).hasAttribute('open'),
      ),
      visited: options.readingVisited.filter((action) => visited.has(action)),
      focus,
    }
    poseTransaction = {
      request,
      inputRevision,
      invalidated: false,
      restoring: false,
    }
    api.postMessage({ ...request, type: 'presentation-pose', pose })
  }
  /** Restores a same-item pose once after replacement/layout; later learner input invalidates the queued animation frame. @example restorePose(message) */
  const restorePose = (message: PresentationPoseRestore): void => {
    if (!installFocus || !matchesPose(message)) return
    const reject = (): void =>
      api.postMessage({
        type: 'presentation-pose-invalidated',
        captureId: message.captureId,
      })
    if (
      poseTransaction?.restoring &&
      poseTransaction.request.captureId === message.captureId
    )
      return
    // A fresh renderer may adopt one host-owned pose only before any learner input in that document.
    if (
      poseTransaction
        ? poseTransaction.invalidated ||
          poseTransaction.request.captureId !== message.captureId ||
          poseTransaction.inputRevision !== inputRevision
        : inputRevision !== 0
    ) {
      reject()
      return
    }
    poseTransaction ??= {
      request: { ...message, type: 'capture-presentation-pose' },
      inputRevision,
      invalidated: false,
      restoring: false,
    }
    poseTransaction.restoring = true
    const transaction = poseTransaction,
      pose = message.pose
    for (const id of options.readingDetails) {
      const details = element(id)
      if (details instanceof HTMLDetailsElement)
        details.open = pose.expanded.includes(id)
    }
    visited.clear()
    for (const action of pose.visited) visited.add(action)
    api.setState({ visited: [...visited] })
    for (const link of Array.from(
      document.querySelectorAll<HTMLButtonElement>('.link[data-action]'),
    ))
      link.classList.toggle('visited', visited.has(link.dataset.action ?? ''))
    requestAnimationFrame(() => {
      if (
        !matchesPose(message) ||
        transaction !== poseTransaction ||
        transaction.invalidated ||
        transaction.inputRevision !== inputRevision
      ) {
        reject()
        return
      }
      const target = resolveFocus(pose.focus),
        anchor = pose.anchorId ? document.getElementById(pose.anchorId) : null
      if (
        (pose.focus && !target) ||
        (pose.anchorId && (!anchor || !anchor.offsetHeight))
      ) {
        reject()
        return
      }
      // Restoring reading context never focuses a different native pane.
      if (document.hasFocus() && target) {
        target.focus({ preventScroll: true })
        if (document.activeElement !== target) {
          reject()
          return
        }
      }
      window.scrollTo({
        top:
          pose.scrollY === 0
            ? 0
            : anchor
              ? window.scrollY +
                anchor.getBoundingClientRect().top +
                pose.fraction * anchor.offsetHeight -
                pose.leadingOffsetPx
              : pose.scrollY,
        behavior: 'instant',
      })
      api.postMessage({
        type: 'presentation-pose-restored',
        captureId: message.captureId,
      })
    })
  }
  type SavedStudyEntry = StudyViewMessage['studies'][number]
  type StudyRemoval = StudyViewMessage['studyRemoval']
  /** Reads the entry chosen in the Saved studies list; empty when none is. @example chosenStudyId() // => 'window_run' */
  const chosenStudyId = (): string => {
    const studies = element('studies')
    return studies instanceof HTMLSelectElement ? studies.value : ''
  }
  /** Says whether an entry is a configured study that cannot be opened; it can still be chosen and deleted. A Node test history that cannot be opened is not such an entry. @example cannotBeOpened(staleEntry) // => true */
  const cannotBeOpened = (entry: SavedStudyEntry | undefined): boolean =>
    entry?.metadata === 'unavailable' && entry.format !== 'node-test-history'
  /** Says whether an entry that cannot be opened is one Retry storage / refresh may repair: a current-format archive whose catalog checkpoint is missing or stale, which the catalog marks with a reason. An unsupported historical file has none. @example canBeRepaired(staleEntry) // => true */
  const canBeRepaired = (entry: SavedStudyEntry | undefined): boolean =>
    cannotBeOpened(entry) && Boolean(entry?.reason) && entry?.format !== 'newer'
  /** Keeps an entry that cannot be opened as this pane's choice: nothing is loaded, the host is not asked, and the outcome of an earlier removal gives way. @example chooseUnopenable(staleEntry.id) */
  const chooseUnopenable = (studyId: string): void => {
    unopenableChoice = studyId
    dismissedRemoval = JSON.stringify(current?.studyRemoval)
    if (current) renderStudyRemoval(current)
  }
  /** Asks the host to open a chosen entry under a new request number and remembers the choice until the host shows it or answers that number; the delete button waits at once, because until then a delete would name the study shown before. @example askHostToOpen(entry.id, false) */
  const askHostToOpen = (studyId: string, isNodeHistory: boolean): void => {
    const requestId = ++openRequestCount
    openingChoice = { studyId, requestId }
    send({
      type: isNodeHistory ? 'node-history' : 'history',
      studyId,
      openRequest: requestId,
    })
    if (current) renderStudyRemoval(current)
  }
  /** Follows the learner's choice in the Saved studies list: an entry that cannot be opened is only chosen, any other is opened by the host and remembered until the host shows it. @example chooseSavedStudy(entry.id) */
  const chooseSavedStudy = (studyId: string): void => {
    const entry = current?.studies.find((study) => study.id === studyId)
    openingChoice = undefined
    if (cannotBeOpened(entry)) {
      chooseUnopenable(studyId)
      return
    }
    unopenableChoice = undefined
    askHostToOpen(studyId, entry?.format === 'node-test-history')
  }
  /** Names the saved study or Node test history the host shows. @example shownStudyId(message) // => 'window_run' */
  const shownStudyId = (message: StudyViewMessage): string | undefined =>
    message.nodeHistory?.header.studyId ?? message.model.selection.studyId
  /** Says whether a Study message ends the wait for the entry this pane asked for: the host shows it, or the entry left the list. An open that ended without showing the entry is answered by the host's reply instead, which {@link settleOpenRequest} follows. @example openingSettled(choice, message) */
  const openingSettled = (
    choice: NonNullable<typeof openingChoice>,
    message: StudyViewMessage,
  ): boolean =>
    shownStudyId(message) === choice.studyId ||
    !message.studies.some((study) => study.id === choice.studyId)
  /** Keeps or forgets the entry this pane asked the host to open, on every Study message before the list's value is set. @example followOpeningChoice(message) */
  const followOpeningChoice = (message: StudyViewMessage): void => {
    const choice = openingChoice
    if (choice && openingSettled(choice, message)) openingChoice = undefined
  }
  /** Names the entry this pane keeps chosen whatever the host shows: one that cannot be opened, else one the host is still opening, so the list never falls back to the study shown before. @example keptChoice() // => 'window_run' */
  const keptChoice = (): string | undefined =>
    unopenableChoice ?? openingChoice?.studyId
  /** Gives the list's value for an entry: its id while the list holds it, else the empty value, so an entry that left the list shows the placeholder (or no chosen entry) instead of a blank. @example listedOrNone(message, removedStudyId) // => '' */
  const listedOrNone = (message: StudyViewMessage, studyId: string): string =>
    message.studies.some((study) => study.id === studyId) ? studyId : ''
  /**
   * Puts the Saved studies list on the entry this pane keeps chosen, else on the entry the host shows, and renders the delete control for it.
   * Called on every Study message after the list's options are set, and when the host answers this pane's open request.
   * @param message - The current Study message.
   * @param fallback - The list's value to keep when neither this pane nor the host names an entry.
   * @example showChosenEntry(message, studies.value)
   */
  const showChosenEntry = (
    message: StudyViewMessage,
    fallback: string,
  ): void => {
    const studies = element('studies')
    if (!(studies instanceof HTMLSelectElement)) return
    studies.value = listedOrNone(
      message,
      keptChoice() ?? shownStudyId(message) ?? fallback,
    )
    renderStudyRemoval(message)
  }
  /** Follows the host's reply to an open request: when it names the request this pane still waits for, the open ended without showing the entry (refused, discarded or failed), so the list returns to the shown study and the delete button is released. A reply to an earlier request changes nothing. @example settleOpenRequest({ type: 'open-request-settled', openRequest: 3 }) */
  const settleOpenRequest = (reply: OpenRequestSettled): void => {
    if (openingChoice?.requestId !== reply.openRequest) return
    openingChoice = undefined
    if (current) showChosenEntry(current, chosenStudyId())
  }
  /** Names a Saved studies entry by its kind; an unloaded configured entry must not borrow the selected article's title through a shared profile ID. @example studyKindLabel(entry, message.profiles) // => 'Repository browser study' */
  const studyKindLabel = (
    study: SavedStudyEntry,
    profiles: StudyViewMessage['profiles'],
  ): string => {
    if (study.format === 'node-test-history') return 'Node test history'
    if (study.profile === 'repository-browser')
      return 'Repository browser study'
    return (
      profiles.find((profile) => profile.id === study.profile)?.title ??
      'Unknown scenario'
    )
  }
  /** Says whether a removal waits for its confirmation or is moving files. @example removalInProgress(message.studyRemoval) */
  const removalInProgress = (removal: StudyRemoval): boolean => {
    const status = removal?.status
    return status === 'confirming' || status === 'moving'
  }
  /**
   * Gives the sentences that say why a saved study cannot be removed, as this window words them: a window without a Trash deletes nothing, so its sentences speak of removing the study's files by hand. Read by {@link removalReason}, {@link chosenStudyRefusal} and {@link showStudyNote} on every render of the Saved studies section.
   * @param message - The current Study message.
   * @returns
   * - The message says that the window has no Trash: the sentences that name the removal by hand
   * - Otherwise: the sentences that name the delete button
   * @example removalRefusals(message).runNotStopped // => 'Stop the run before deleting its study.'
   */
  const removalRefusals = (
    message: StudyViewMessage,
  ): typeof options.studyRemovalRefusalsWithoutTrash =>
    message.removalWithoutTrash
      ? options.studyRemovalRefusalsWithoutTrash
      : options.studyRemovalRefusals
  /** Says why the chosen entry cannot be removed, first match wins, in the words of this window ({@link removalRefusals}); empty when it can. @example chosenStudyRefusal(message, nodeEntry) // => 'Node test histories cannot be deleted here yet.' */
  const chosenStudyRefusal = (
    message: StudyViewMessage,
    chosen: SavedStudyEntry,
  ): string => {
    const sentences = removalRefusals(message)
    const refusals: [applies: boolean, sentence: string][] = [
      [chosen.format === 'node-test-history', sentences.nodeHistory],
      // The host moves nothing of a study a newer Codebook saved: which files that format keeps is not known here.
      [chosen.format === 'newer', sentences.newerFormat],
      [message.unstoppedStudyId === chosen.id, sentences.runNotStopped],
      [message.contentTab === 'recording', sentences.recordingOpen],
    ]
    return refusals.find(([applies]) => applies)?.[1] ?? ''
  }
  /** Says why the chosen entry cannot be removed now, first match wins: a chosen entry that is still opening, no entry, then the entry's own reason. Empty when it can be removed, and while a removal is in progress, which the status line names instead. A window without a Trash gets its own sentences, none of which speaks of deleting ({@link removalRefusals}). @example removalReason(message, undefined, false) // => 'Choose a saved study to delete.' */
  const removalReason = (
    message: StudyViewMessage,
    chosen: SavedStudyEntry | undefined,
    inProgress: boolean,
  ): string => {
    if (inProgress) return ''
    if (openingChoice) return removalRefusals(message).studyOpening
    if (!chosen) return removalRefusals(message).nothingChosen
    return chosenStudyRefusal(message, chosen)
  }
  /** Shows whether the delete button can be used and the reason beside it; with no saved study there is nothing to delete and nothing to explain. A window without a Trash gets no delete button, so its row stays only for the repair button. @example showRemovalControl(message, '', false) */
  const showRemovalControl = (
    message: StudyViewMessage,
    reason: string,
    inProgress: boolean,
  ): void => {
    const hasStudies = message.studies.length > 0,
      withoutTrash = Boolean(message.removalWithoutTrash)
    element('delete-study').hidden = withoutTrash
    element('delete-study-row').hidden =
      !hasStudies || (withoutTrash && element('repair-study').hidden)
    if (inProgress || reason)
      element('delete-study').setAttribute('aria-disabled', 'true')
    else element('delete-study').removeAttribute('aria-disabled')
    text('delete-study-reason', reason)
    element('delete-study-reason').hidden = !reason || !hasStudies
  }
  /** Gives the removal outcome this pane shows; an outcome the learner dismissed stays hidden only while the host still reports that same outcome. @example visibleRemoval(message.studyRemoval) */
  const visibleRemoval = (removal: StudyRemoval): StudyRemoval => {
    if (dismissedRemoval !== JSON.stringify(removal))
      dismissedRemoval = undefined
    return dismissedRemoval ? undefined : removal
  }
  /**
   * Keeps the bottom panel's pane from taking a removal's status while a replay keeps Saved studies out of it; called by {@link renderStudyRemoval} before the status is chosen.
   * The learner cannot have asked there: the list is not shown. The pane the learner acted in tells the outcome. Here it is put aside like an outcome the learner dismissed ({@link visibleRemoval}), so it stays out when the replay is left as well: written then, a refusal such as "Choose Overview or Live to leave Recording before deleting this study." would appear exactly when it is no longer true, together with its status region.
   * @param message - The current Study message.
   * @example leaveRemovalStatusToAskingPane(message)
   */
  const leaveRemovalStatusToAskingPane = (message: StudyViewMessage): void => {
    if (isReplayInBottomPanel(message))
      dismissedRemoval = JSON.stringify(message.studyRemoval)
  }
  /** Says whether a removal ended without moving the whole study, which the status line shows as an error. @example removalFailed({ status: 'refused', studyId }) // => true */
  const removalFailed = (removal: StudyRemoval): boolean =>
    removal !== undefined && ['refused', 'failed'].includes(removal.status)
  /**
   * Shows the last removal's progress or outcome under the delete button; called by {@link renderStudyRemoval}.
   * A window without a Trash has no delete button and removes nothing: what the host answers there answers a request for a study's files, which the "Remove by hand" disclosure shows ({@link showStudyFilesAnswer}). The line stays empty there, so no sentence appears above the summary the learner pressed and nothing is announced when a study is only chosen.
   * @param message - The current Study message.
   * @param shown - The removal this pane shows, see {@link visibleRemoval}.
   * @example showRemovalStatus(message, visibleRemoval(message.studyRemoval))
   */
  const showRemovalStatus = (
    message: StudyViewMessage,
    shown: StudyRemoval,
  ): void => {
    const outcome = message.removalWithoutTrash ? undefined : shown
    text('delete-study-status', outcome?.text ?? '')
    element('delete-study-status').classList.toggle(
      'error',
      removalFailed(outcome),
    )
  }
  /** Names the note of a chosen entry that cannot be opened: the repair note for a stale catalog checkpoint, the entry's own sentence for a study a newer Codebook saved, else the delete-only note; nothing for an entry that opens. @example studyNoteId(staleEntry) // => 'study-repairable' */
  const studyNoteId = (
    chosen: SavedStudyEntry | undefined,
  ): 'study-unopenable' | 'study-newer' | 'study-repairable' | undefined => {
    if (!cannotBeOpened(chosen)) return undefined
    if (canBeRepaired(chosen)) return 'study-repairable'
    return chosen?.format === 'newer' ? 'study-newer' : 'study-unopenable'
  }
  /** Names which wording of the notes this window gets: the one that ends with the removal by hand in a window without a Trash, else the one that ends with the deletion. Read by {@link showStudyNote}. @example studyNoteWording(message) // => 'withoutTrash' in a WSL remote window */
  const studyNoteWording = (
    message: StudyViewMessage,
  ): keyof typeof options.studyNotes.unopenable =>
    message.removalWithoutTrash ? 'withoutTrash' : 'withTrash'
  /**
   * Shows the one note of the chosen entry, describes the list and the delete button by it, and offers Repair saved study beside the repair note.
   * The notes of an entry that cannot be opened and of one that can be repaired end with what the learner can still do, which a window without a Trash words differently: nothing can be deleted there, so they name the removal by hand.
   * When the repair button leaves while it holds the keyboard focus (the repair succeeded), the focus returns to the Saved studies list instead of falling to the document body.
   * Called by {@link renderStudyRemoval} before the delete control is shown.
   * @param message - The current Study message; it says whether the window has a Trash.
   * @param chosen - The entry chosen in the list, if any.
   * @example showStudyNote(message, staleEntry)
   */
  const showStudyNote = (
    message: StudyViewMessage,
    chosen: SavedStudyEntry | undefined,
  ): void => {
    const shownNote = studyNoteId(chosen),
      wording = studyNoteWording(message)
    for (const noteId of [
      'study-unopenable',
      'study-newer',
      'study-repairable',
    ])
      element(noteId).hidden = noteId !== shownNote
    text('study-unopenable', options.studyNotes.unopenable[wording])
    text('study-repairable', options.studyNotes.repairable[wording])
    // The catalog's own sentence names both format numbers; the refusal stands in for an entry without one.
    text(
      'study-newer',
      shownNote === 'study-newer'
        ? (chosen?.reason ?? removalRefusals(message).newerFormat)
        : '',
    )
    if (shownNote)
      element('studies').setAttribute('aria-describedby', shownNote)
    else element('studies').removeAttribute('aria-describedby')
    element('delete-study').setAttribute(
      'aria-describedby',
      `${shownNote ? `${shownNote} ` : ''}delete-study-reason delete-study-status`,
    )
    const repair = element('repair-study'),
      heldFocus = keyboardControl() === repair
    repair.hidden = shownNote !== 'study-repairable'
    if (heldFocus && repair.hidden)
      moveFocusOf(repair, () => element('studies'))
  }
  /**
   * Gives this pane's files request when it is for one entry; read by the functions that follow a request ({@link settleFilesRequest}, {@link filesRefusalFor}, {@link isFilesRequestOpen}).
   * @param studyId - The entry the disclosure is offered for.
   * @returns The request, or `undefined` when the pane has none or its request is for another entry.
   * @example filesRequestFor(entry.id)?.request // => the number the host echoes in its answer
   */
  const filesRequestFor = (studyId: string): typeof filesRequest =>
    filesRequest?.studyId === studyId ? filesRequest : undefined
  /**
   * Says whether a removal state of the host answers one request of this pane: it echoes the request's number for the request's entry. Read by {@link takeFilesRefusalIn}.
   * @param answer - The removal state of the current Study message.
   * @param request - This pane's request.
   * @example answersFilesRequest(message.studyRemoval, request) // => false for the answer to another pane's request
   */
  const answersFilesRequest = (
    answer: StudyRemovalView,
    request: NonNullable<typeof filesRequest>,
  ): boolean =>
    answer.request === request.request && answer.studyId === request.studyId
  /**
   * Keeps the sentence of the host's refusal with the request it answers; called by {@link settleFilesRequest} for a request no files arrived for.
   * A removal state that echoes the request's number without the entry's files is the host's refusal. It is kept here because the state itself is replaced by the answer to the next pane's request; a state that answers another request changes nothing.
   * @param message - The current Study message.
   * @param request - This pane's request.
   * @example takeFilesRefusalIn(message, request)
   */
  const takeFilesRefusalIn = (
    message: StudyViewMessage,
    request: NonNullable<typeof filesRequest>,
  ): void => {
    const answer = message.studyRemoval
    if (answer && answersFilesRequest(answer, request))
      filesRequest = { ...request, refusal: answer.text ?? '' }
  }
  /**
   * Takes the host's answer to this pane's request for one entry's files in; called by {@link followStudyFiles} before it decides whether to ask.
   * The files are read by study, so their arrival ends the request whichever pane asked; else the host's refusal of this request is kept ({@link takeFilesRefusalIn}).
   * @param message - The current Study message.
   * @param studyId - The entry the disclosure is offered for.
   * @example settleFilesRequest(message, entry.id)
   */
  const settleFilesRequest = (
    message: StudyViewMessage,
    studyId: string,
  ): void => {
    const request = filesRequestFor(studyId)
    if (!request) return
    if (message.studyFiles?.[studyId]) {
      filesRequest = undefined
      return
    }
    takeFilesRefusalIn(message, request)
  }
  /**
   * Gives the sentence the host refused this pane's request for one entry's files with; read by {@link studyFilesView} and {@link awaitsOrHasFilesAnswer}.
   * @param studyId - The entry the disclosure is offered for.
   * @returns The kept sentence, or `undefined` while the pane has no refusal for that entry.
   * @example filesRefusalFor(entry.id) // => "Stop the run before removing its study's files by hand."
   */
  const filesRefusalFor = (studyId: string): string | undefined =>
    filesRequestFor(studyId)?.refusal
  /**
   * Says whether this pane's request for one entry's files is still open: it was sent under the current Study message's revision and has no answer. Read by {@link awaitsOrHasFilesAnswer}.
   * A request sent under an earlier revision no longer counts as open, so the pane asks again. The host answers a request the pane sent by itself whatever its revision (a window without a Trash), but a request the learner made on a view the host has since left is refused with a line and never answered, and the pane cannot tell which of the two happened to its request; a second listing costs little, a request that is never answered would leave the disclosure at "Listing this study's files…".
   * @param message - The current Study message.
   * @param studyId - The entry the disclosure is offered for.
   * @example isFilesRequestOpen(message, entry.id) // => true right after the learner opened the disclosure
   */
  const isFilesRequestOpen = (
    message: StudyViewMessage,
    studyId: string,
  ): boolean => {
    const request = filesRequestFor(studyId)
    return (
      request !== undefined &&
      request.refusal === undefined &&
      request.revision === message.revision
    )
  }
  /**
   * Says whether nothing is to be asked for one entry's files: the host listed them, refused this pane's request, or still owes its answer. Read by {@link followStudyFiles}.
   * @param message - The current Study message.
   * @param studyId - The entry the disclosure is offered for.
   * @example awaitsOrHasFilesAnswer(message, entry.id) // => false after Retry storage / refresh made the host forget its list
   */
  const awaitsOrHasFilesAnswer = (
    message: StudyViewMessage,
    studyId: string,
  ): boolean =>
    Boolean(message.studyFiles?.[studyId]) ||
    filesRefusalFor(studyId) !== undefined ||
    isFilesRequestOpen(message, studyId)
  /**
   * Follows the files of the entry an open "Remove by hand" disclosure is offered for: takes the host's answer in, and asks the host, which names a study's files only in its answer to a delete request, when the pane has neither an answer nor an open request. Called by {@link showStudyFiles} on every Study message while the disclosure is open, and when the learner opens it; never for a study that was only chosen.
   * So nothing is asked twice while an answer is owed, a refusal stands until the learner opens the disclosure again or presses Retry storage / refresh in it, and a list the host forgot (Retry storage / refresh) is asked for again, also when the host's revision did not change.
   * A request the pane sends by itself is marked `unprompted`: it can reach the host after the host rendered again, and the host answers a marked request without the line it tells a learner who pressed a control on a view that has changed.
   * @param message - The current Study message.
   * @param studyId - The entry the disclosure is offered for.
   * @param isAskedByLearner - Whether the learner asked by opening the disclosure; a Study message that makes the pane ask is no such request.
   * @example followStudyFiles(message, entry.id, false)
   */
  const followStudyFiles = (
    message: StudyViewMessage,
    studyId: string,
    isAskedByLearner: boolean,
  ): void => {
    settleFilesRequest(message, studyId)
    if (awaitsOrHasFilesAnswer(message, studyId)) return
    filesRequest = {
      studyId,
      request: ++removalRequestCount,
      revision: message.revision,
    }
    send({
      type: 'delete-study',
      studyId,
      removalRequest: filesRequest.request,
      ...(isAskedByLearner ? {} : { unprompted: true }),
    })
  }
  /**
   * Forgets a refusal the host answered this pane's files request with, so the next look at the entry's files asks the host again; called at a press on Retry storage / refresh inside the disclosure.
   * A request that is still open is kept: its answer is owed, and nothing is asked twice for it while the disclosure stays open.
   * @example forgetFilesRefusal()
   */
  const forgetFilesRefusal = (): void => {
    if (filesRequest?.refusal !== undefined) filesRequest = undefined
  }
  /** What the "Remove by hand" disclosure holds: the sentence above the list, whether that sentence is the host's refusal, the paths to list, and whether Retry storage / refresh is offered (not while the host is still asked). */
  type StudyFilesView = {
    note: string
    isRefusal: boolean
    files: string[]
    offersRetry: boolean
  }
  /**
   * Says what the "Remove by hand" disclosure holds for one entry, from what the host answered so far; read by {@link showStudyFilesAnswer}.
   * The files are read by study, not from the removal state, which answers one pane's request at a time.
   * @param message - The current Study message.
   * @param studyId - The entry the disclosure is offered for.
   * @returns
   * - The host listed files: the sentence that says to remove them, the paths, Retry
   * - The host listed no file: the sentence that none is left, no path, Retry
   * - The host refused this pane's request ({@link filesRefusalFor}): its sentence as a refusal, no path, Retry
   * - Otherwise: the listing sentence, no path, no Retry
   * @example studyFilesView(message, entry.id) // => { note: "Listing this study's files…", isRefusal: false, files: [], offersRetry: false }
   */
  const studyFilesView = (
    message: StudyViewMessage,
    studyId: string,
  ): StudyFilesView => {
    const files = message.studyFiles?.[studyId]
    if (files)
      return {
        note: files.length
          ? options.studyFiles.listed
          : options.studyFiles.noneLeft,
        isRefusal: false,
        files,
        offersRetry: true,
      }
    const refusal = filesRefusalFor(studyId)
    return {
      note: refusal ?? options.studyFiles.listing,
      isRefusal: refusal !== undefined,
      files: [],
      offersRetry: refusal !== undefined,
    }
  }
  /**
   * Writes what the "Remove by hand" disclosure holds: the sentence of its state, the listed paths, Copy paths beside paths only and Retry storage / refresh once the host answered. Called by {@link showStudyFilesAnswer} for an open disclosure and by {@link emptyStudyFiles} for a closed one.
   * @param view - What the disclosure holds.
   * @example fillStudyFiles(studyFilesView(message, entry.id))
   */
  const fillStudyFiles = (view: StudyFilesView): void => {
    text('study-files-note', view.note)
    element('study-files-note').classList.toggle('error', view.isRefusal)
    replace('study-files-list', view.files, () =>
      view.files.map((path) => {
        const item = document.createElement('li')
        item.textContent = path
        return item
      }),
    )
    element('study-files-list').hidden = !view.files.length
    element('copy-study-files').hidden = !view.files.length
    const actions = element('copy-study-files').parentElement
    if (actions) actions.hidden = !view.offersRetry
  }
  /**
   * Fills the open "Remove by hand" disclosure for one entry from what the host answered so far; called by {@link showStudyFiles} on every Study message while the disclosure is open, and when the learner opens it.
   * @param message - The current Study message.
   * @param studyId - The entry the disclosure is offered for.
   * @example showStudyFilesAnswer(message, entry.id)
   */
  const showStudyFilesAnswer = (
    message: StudyViewMessage,
    studyId: string,
  ): void => fillStudyFiles(studyFilesView(message, studyId))
  /**
   * Empties the "Remove by hand" disclosure while it is closed; called when the learner closes it, and by {@link showStudyFiles} on every Study message while it is closed (also the one under which it was handed to another entry).
   * A closed disclosure renders nothing of what it holds, and its note is a status region: a sentence written while it is closed would enter the page together with the region when the learner opens it. The note therefore gets its sentence only after the disclosure opened, as a change of a region that exists, and no path of an earlier look is shown for a moment.
   * @example emptyStudyFiles()
   */
  const emptyStudyFiles = (): void =>
    fillStudyFiles({
      note: '',
      isRefusal: false,
      files: [],
      offersRetry: false,
    })
  /**
   * Writes the line under Copy paths and marks it as an error or not; called with an empty text at a press on Copy paths, when the disclosure closes and when another entry is chosen, and by {@link showStudyFilesCopied} with the host's answer.
   * The line is a status region that stays rendered while empty, so every text is a change of a region that exists.
   * @param sentence - The confirmation or the failure; empty to clear the line.
   * @param isFailure - Whether the copy failed.
   * @example showCopyOutcome('Copied 4 paths.', false)
   */
  const showCopyOutcome = (sentence: string, isFailure: boolean): void => {
    text('copy-study-files-status', sentence)
    element('copy-study-files-status').classList.toggle('error', isFailure)
  }
  /** Words the confirmation of a copy with the number of paths the host wrote to the clipboard; called by {@link showStudyFilesCopied}. @example copiedSentence(1) // => 'Copied 1 path.' @example copiedSentence(4) // => 'Copied 4 paths.' */
  const copiedSentence = (count: number): string =>
    `Copied ${count} path${count === 1 ? '' : 's'}.`
  /**
   * Shows the host's answer to this pane's Copy paths: how many paths the clipboard took, or that it took none. Called for the `study-files-copied` message, which the host posts to the asking pane only after the clipboard write settled; the keyboard focus stays where it is.
   * An answer for another entry than the one the open disclosure lists (the learner chose another meanwhile) changes nothing.
   * @param answer - The host's answer.
   * @example showStudyFilesCopied({ type: 'study-files-copied', studyId, status: 'copied', count: 4 }) // the line reads "Copied 4 paths."
   */
  const showStudyFilesCopied = (answer: StudyFilesCopied): void => {
    if (
      answer.studyId !== filesDisclosureStudyId ||
      !element('study-files').hasAttribute('open')
    )
      return
    if (answer.status === 'failed')
      showCopyOutcome(options.studyFiles.copyFailed, true)
    else showCopyOutcome(copiedSentence(answer.count), false)
  }
  /** Gives the element that holds the keyboard focus when it stands inside the "Remove by hand" disclosure, its summary included; read by {@link showStudyFiles} before it closes or hides the disclosure. @example focusedInStudyFiles() // => the Copy paths button */
  const focusedInStudyFiles = (): Element | undefined => {
    const focused = keyboardControl()
    return focused && element('study-files').contains(focused)
      ? focused
      : undefined
  }
  /** Gives the place in Saved studies the keyboard focus goes to when its control left with the "Remove by hand" disclosure: the disclosure's summary while it is offered, else the Saved studies list. Read by {@link keepFocusInSavedStudies}. @example savedStudiesFocusTarget().focus() */
  const savedStudiesFocusTarget = (): HTMLElement => {
    const disclosure = element('study-files')
    return (
      (disclosure.hidden ? undefined : disclosure.querySelector('summary')) ??
      element('studies')
    )
  }
  /**
   * Keeps the keyboard focus in Saved studies when the control that held it is no longer rendered because the "Remove by hand" disclosure closed (it renders its summary only) or left. Called by {@link showStudyFiles} after it closed or hid the disclosure, so the focus does not fall to the document body after Retry storage / refresh took the study from the list.
   * @param focusedBefore - The control inside the disclosure that held the focus before the disclosure changed, if any.
   * @example keepFocusInSavedStudies(focusedInStudyFiles())
   */
  const keepFocusInSavedStudies = (
    focusedBefore: Element | undefined,
  ): void => {
    if (!focusedBefore || focusedBefore.checkVisibility()) return
    moveFocusOf(focusedBefore, savedStudiesFocusTarget)
  }
  /** Names the entry the "Remove by hand" disclosure is offered for: the chosen entry of a window without a Trash that no reason keeps from being removed. Read by {@link showStudyFiles}. @example filesOfferedFor(message, entry, '') // => entry.id in a WSL remote window */
  const filesOfferedFor = (
    message: StudyViewMessage,
    chosen: SavedStudyEntry | undefined,
    reason: string,
  ): string | undefined =>
    message.removalWithoutTrash && chosen && !reason ? chosen.id : undefined
  /**
   * Hands the "Remove by hand" disclosure over to another entry, or to none: it closes, its copy confirmation is cleared, and the keyboard focus of a control that left with it stays in Saved studies. Called by {@link showStudyFiles} on every render; an unchanged entry changes nothing.
   * @param offeredFor - The entry the disclosure is offered for now, if any.
   * @example offerStudyFilesFor(undefined) // the disclosure is closed and hidden
   */
  const offerStudyFilesFor = (offeredFor: string | undefined): void => {
    const disclosure = element('study-files'),
      focusedBefore = focusedInStudyFiles()
    if (offeredFor !== filesDisclosureStudyId) {
      disclosure.removeAttribute('open')
      showCopyOutcome('', false)
      // A request for the entry before is nobody's any more; its answer, if it still comes, names another entry.
      filesRequest = undefined
    }
    filesDisclosureStudyId = offeredFor
    disclosure.hidden = !offeredFor
    keepFocusInSavedStudies(focusedBefore)
  }
  /**
   * Offers the "Remove by hand" disclosure in a window without a Trash for a chosen entry that no reason keeps from being removed, and fills it for that entry; hidden in a window with a Trash, with no entry chosen and beside a reason. Called by {@link renderStudyRemoval} on every render of the Saved studies section.
   * The disclosure is offered closed and closes again when another entry is chosen: the host is asked for an entry's files only after the learner opened it, never because a study was chosen.
   * @param message - The current Study message.
   * @param chosen - The entry chosen in the list, if any.
   * @param reason - Why the entry cannot be removed now; empty when it can.
   * @example showStudyFiles(message, entry, '')
   */
  const showStudyFiles = (
    message: StudyViewMessage,
    chosen: SavedStudyEntry | undefined,
    reason: string,
  ): void => {
    const offeredFor = filesOfferedFor(message, chosen, reason)
    offerStudyFilesFor(offeredFor)
    // A disclosure that is closed or not offered (beside a reason, as during a replay) asks for nothing and holds nothing; it is filled once the learner has opened it.
    if (!offeredFor || !element('study-files').hasAttribute('open')) {
      emptyStudyFiles()
      return
    }
    // An open disclosure follows the host on every Study message.
    followStudyFiles(message, offeredFor, false)
    const focusedBefore = focusedInStudyFiles()
    showStudyFilesAnswer(message, offeredFor)
    // While the host is asked again (Retry storage / refresh made it forget its list) the disclosure shows no button: a focus that stood on one goes to the summary, not to the document body.
    keepFocusInSavedStudies(focusedBefore)
  }
  /** Says whether focus still rests where the learner left it when asking: on the delete button, or nowhere, in a pane that has focus. @example focusRestsOnDeleteButton() */
  const focusRestsOnDeleteButton = (): boolean =>
    document.hasFocus() &&
    (document.activeElement === element('delete-study') ||
      document.activeElement === document.body)
  /** Moves focus once after this pane's own request was answered: to the list after a removal, to the button after Cancel, a refusal or a failure. @example focusAfterRemoval(true) */
  const focusAfterRemoval = (moved: boolean): void => {
    if (!focusRestsOnDeleteButton()) return
    element(moved ? 'studies' : 'delete-study').focus({ preventScroll: true })
  }
  /**
   * Follows this pane's own delete request by the number the host echoes, so that only the pane the learner used moves focus, once: a removal in progress under that number has started the request, and one under another number means the host did not take it (it takes one removal at a time and never answers the second); the request is answered when a state that is not in progress carries its number, or when Cancel clears the field after it started.
   * A refusal that was shown before, also one with the same words, carries another number and answers nothing.
   * @param removal - The removal the host reports.
   * @param inProgress - Whether that removal is confirming or moving.
   * @example answerRemovalRequest(message.studyRemoval, false)
   */
  const answerRemovalRequest = (
    removal: StudyRemoval,
    inProgress: boolean,
  ): void => {
    const asked = removalRequest
    if (!asked) return
    const isOwn = removal?.request === asked.request
    if (inProgress) {
      removalRequest = isOwn ? { ...asked, started: true } : undefined
      return
    }
    // No state of this request yet: the host has not answered it.
    if (!isOwn && !asked.started) return
    removalRequest = undefined
    focusAfterRemoval(isOwn && removal?.status === 'moved')
  }
  /**
   * Renders the Saved studies section's delete control: the note for an entry that cannot be opened with its repair button, whether the delete button can be used and why not, the last removal's outcome, the "Remove by hand" disclosure a window without a Trash offers in place of the delete button, and the focus after this pane's own request was answered.
   * Called by {@link showChosenEntry} on every Study message and on the host's reply to an open request, by {@link askHostToOpen} when the learner chooses an entry the host opens, and by {@link chooseUnopenable} when the learner chooses an entry that cannot be opened.
   * @param message - The current Study message.
   * @example renderStudyRemoval(message)
   */
  const renderStudyRemoval = (message: StudyViewMessage): void => {
    leaveRemovalStatusToAskingPane(message)
    const chosenId = chosenStudyId(),
      chosen = message.studies.find((study) => study.id === chosenId),
      inProgress = removalInProgress(message.studyRemoval),
      reason = removalReason(message, chosen, inProgress),
      shownRemoval = visibleRemoval(message.studyRemoval)
    showStudyNote(message, chosen)
    showRemovalControl(message, reason, inProgress)
    showRemovalStatus(message, shownRemoval)
    showStudyFiles(message, chosen, reason)
    answerRemovalRequest(message.studyRemoval, inProgress)
  }
  /**
   * Shows or hides a Show Variables button, and remembers where the keyboard focus goes when the button leaves while it holds this pane's focus; called for the replay's and the Node history's button on every Study message.
   * @param buttonId - The Show Variables button.
   * @param isOffered - Whether the selected moment's native values are not loaded, so the button is shown.
   * @param preferred - Selectors of that transport's controls in the order the focus tries them, Play first.
   * @param section - Id of the section whose first usable control takes the focus when none of the preferred ones can.
   * @example offerShowVariables('playback-show-variables', false, options.replayTransportFocus, 'recording-transport')
   */
  const offerShowVariables = (
    buttonId: string,
    isOffered: boolean,
    preferred: readonly string[],
    section: string,
  ): void => {
    const control = element(buttonId)
    // Read before the button is hidden: an element that is no longer rendered loses the focus to the document body.
    if (!isOffered && keyboardControl() === control)
      transportFocusOwed = { leaving: control, preferred, section }
    control.hidden = !isOffered
  }
  /**
   * Finds the control that takes the focus of a Show Variables button that left: the first preferred transport control that is shown and enabled (Play can be disabled at a recording's end or on a history's last event), else the first such control of the section.
   * @param owed - The button that left, the preferred selectors and the section.
   * @returns The control, or nothing when the section shows no enabled control.
   * @example usableTransportControl(transportFocusOwed)?.id // => 'playback-toggle'
   */
  const usableTransportControl = (
    owed: NonNullable<typeof transportFocusOwed>,
  ): HTMLElement | undefined =>
    [
      ...owed.preferred.map((selector) => document.querySelector(selector)),
      ...Array.from(element(owed.section).querySelectorAll('button,input')),
    ].find(
      (control): control is HTMLButtonElement | HTMLInputElement =>
        (control instanceof HTMLButtonElement ||
          control instanceof HTMLInputElement) &&
        control !== owed.leaving &&
        !control.disabled &&
        control.getClientRects().length > 0,
    )
  /** Moves the focus a Show Variables button left behind to its transport, once; called after a Study message was rendered while this document has the focus, and at the document's next focus event otherwise. A learner who already put the focus on another control keeps it. @example payTransportFocus() */
  const payTransportFocus = (): void => {
    const owed = transportFocusOwed
    if (!owed) return
    transportFocusOwed = undefined
    if (
      document.activeElement !== document.body &&
      document.activeElement !== owed.leaving
    )
      return
    usableTransportControl(owed)?.focus({ preventScroll: true })
  }
  window.addEventListener('focus', payTransportFocus)
  // The bottom panel's pane shows the replay transport and the moments only.
  const isBottomPanel = document.body.classList.contains('moments-only')
  /**
   * Lists the disclosures around a control, the nearest first; read by {@link disclosureSummaryAround}.
   * @param control - The control; a summary's own disclosure is the first of the list.
   * @returns The disclosures, empty for a control in none and for one that was taken out of the page.
   * @example disclosuresAround(button('read-app')!).map((disclosure) => disclosure.id) // => ['reader-options']
   */
  const disclosuresAround = (control: Element): HTMLDetailsElement[] => {
    const around: HTMLDetailsElement[] = []
    for (
      let disclosure = control.closest('details');
      disclosure;
      disclosure = disclosure.parentElement?.closest('details') ?? null
    )
      around.push(disclosure)
    return around
  }
  /**
   * Finds the summary a lost focus goes to first: the one of the nearest disclosure around the control that left which is still shown. Read by {@link focusTargetFor}.
   * A disclosure that closed under the focus, and a control that left inside an open one, both keep the focus beside the place the learner was at.
   * @param leaving - The control that left while it held the focus.
   * @returns
   * - A disclosure around the control still shows its summary: that summary (never the control itself)
   * - Otherwise: `undefined`
   * @example disclosureSummaryAround(button('read-app')!)?.textContent // => 'Study view and pane controls'
   */
  const disclosureSummaryAround = (leaving: Element): HTMLElement | undefined =>
    disclosuresAround(leaving)
      .map((disclosure) =>
        disclosure.querySelector<HTMLElement>(':scope > summary'),
      )
      .find(
        (summary): summary is HTMLElement =>
          summary !== null && summary !== leaving && summary.checkVisibility(),
      )
  /**
   * Gives the control of the pane that stays and takes a lost focus when no disclosure around the control that left is shown; read by {@link focusTargetFor}.
   * @param leaving - The control that left while it held the focus.
   * @returns
   * - In the Study pane: the selected content tab
   * - In the bottom panel's pane, which has no content tabs: Play or the next transport control that can be used while the transport is shown, else the first control the pane shows
   * @example stayingControl(button('stop')!)?.id // => 'live-tab'
   */
  const stayingControl = (leaving: HTMLElement): HTMLElement | undefined => {
    if (isBottomPanel)
      return usableTransportControl({
        leaving,
        preferred: options.replayTransportFocus,
        section: 'study-content',
      })
    return (
      document.querySelector<HTMLElement>('[role=tab][aria-selected=true]') ??
      undefined
    )
  }
  /**
   * Gives the control that holds the keyboard focus now; read by {@link readFocusHolder}.
   * @returns The focused element, or `undefined` while the focus stands on the document body.
   * @example focusedControl()?.id // => 'playback-toggle'
   */
  const focusedControl = (): HTMLElement | undefined => {
    const active = document.activeElement
    return active instanceof HTMLElement && active !== document.body
      ? active
      : undefined
  }
  // The control at which the keyboard stood when the learner left the pane for another part of the editor. The editor's webview takes the focus from that control as the pane is left (a focusout without a related target, after which the active element is the page body) and does not give it back on return, so the pane keeps the control itself: while it is away it is the control the parts ask about ({@link keyboardControl}), and on return it takes the focus again when it is still shown, or the place its part or the pane's general rule gives it when it left. Cleared once any control has the focus.
  let leftControl: HTMLElement | undefined
  // The control that just lost the focus with no control taking it. It becomes {@link leftControl} when the window's blur follows; a focus on any control ends it.
  let focusLostWithoutTarget: HTMLElement | undefined
  // Whether a pointer press inside the pane is under way, from its pointerdown to its release: a focus it takes off a control is the learner's own doing and not a leaving.
  let isPressUnderWay = false
  // Whether the press that is under way is the one the learner returned to the pane with: its release puts back the focus the pane settled for the return, which a press on the pane's background takes off again.
  let isPressOfReturn = false
  // The learner's last return to the pane: when the window's focus event came and which control had the focus once the pane had settled it ({@link repayReturnFocus}).
  let paneReturn: { atMs: number; control: HTMLElement | undefined } | undefined
  /**
   * Gives the control at which the keyboard stands: the focused one, and while this document does not have the focus the one the learner left the pane at. Read by every part of the pane that asks which control holds the focus before it changes the page (the Show Variables buttons, Saved studies, the lists that are rendered again) and by {@link readFocusHolder}'s kept holder.
   * @returns The control, or `undefined` when the keyboard stands on no control of the pane.
   * @example keyboardControl()?.id // => 'playback-toggle' while the learner, who left the pane at Play, works in the editor
   */
  const keyboardControl = (): HTMLElement | undefined =>
    focusedControl() ?? (document.hasFocus() ? undefined : leftControl)
  document.addEventListener('focusout', (event) => {
    // A press on the pane's background takes the focus off a control too; that is no leaving.
    focusLostWithoutTarget =
      event.relatedTarget === null &&
      !isPressUnderWay &&
      event.target instanceof HTMLElement
        ? event.target
        : undefined
  })
  document.addEventListener('focusin', () => {
    focusLostWithoutTarget = undefined
    leftControl = undefined
  })
  window.addEventListener('blur', () => {
    // A browser that leaves the focus on the control when its window is left names it still; the editor's webview has taken it by now.
    leftControl = focusedControl() ?? focusLostWithoutTarget
    focusLostWithoutTarget = undefined
    paneReturn = undefined
    // A press whose release went to another part of the editor is over.
    isPressUnderWay = false
    isPressOfReturn = false
    // The control stays the holder of the pane's focus while the learner is away: the editor took the focus from it, as the page does from a control it disables.
    if (leftControl) focusHolder = { control: leftControl, isTakenByPage: true }
  })
  /**
   * Puts the focus back that the pane settled at the learner's return when the press the learner returned with took it off again, which a press on the pane's background does; called at the release of that press.
   * A press on another control leaves the focus on that control, and a pane that was left again takes none.
   * @example repayReturnFocus()
   */
  const repayReturnFocus = (): void => {
    const settled = paneReturn?.control
    paneReturn = undefined
    if (settled && isFocusOpenFor(settled) && canTakeFocus(settled))
      settled.focus({ preventScroll: true })
  }
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.isTrusted) return
      isPressUnderWay = true
      // The press of the click the learner returned with can reach the page after the window's focus event. Its time is the click's own, so it is not later than that event by more than the editor's delay between the two.
      isPressOfReturn = Boolean(
        paneReturn &&
        event.timeStamp - paneReturn.atMs <= options.returnPressWindowMs,
      )
    },
    { capture: true, passive: true },
  )
  /** Ends the press that is under way and, when the learner returned to the pane with it, puts back the focus it took off; called at the release of every pointer press in the pane. By then the browser's own handling of the press is over. @example document.addEventListener('pointerup', endPress, { capture: true, passive: true }) */
  const endPress = (event: Event): void => {
    if (!event.isTrusted) return
    if (isPressOfReturn) repayReturnFocus()
    isPressUnderWay = false
    isPressOfReturn = false
  }
  document.addEventListener('pointerup', endPress, {
    capture: true,
    passive: true,
  })
  document.addEventListener('pointercancel', endPress, {
    capture: true,
    passive: true,
  })
  /** Says whether a control is shown and can be used, so that it can take the focus; read by {@link repayReturnFocus}. @example canTakeFocus(element('playback-toggle')) // => false for Play at a recording's end */
  const canTakeFocus = (control: HTMLElement): boolean =>
    control.checkVisibility() && !control.matches(':disabled')
  /**
   * Says whether a control lost the focus without the learner taking it off inside the pane: the editor took it when the learner left the pane at that control, or the page took it by disabling the control or by taking it out. Read by {@link keptFocusHolder}.
   * @param control - The control that held the focus.
   * @example isFocusTakenFrom(button('stop')!) // => true while Stop is disabled for a pending request
   */
  const isFocusTakenFrom = (control: HTMLElement): boolean =>
    control === leftControl || !canTakeFocus(control)
  /**
   * Gives the holder of the focus that stays the holder although the document body has the focus: one the page took the focus from, by disabling it or by taking it out, and the one the editor took it from when the learner left the pane. Read by {@link readFocusHolder}.
   * A control that is shown and enabled and lost the focus inside the pane lost it by the learner's doing and is no holder any more.
   * @returns The holder {@link focusHolder} names, marked as taken by the page, when its control is the one the learner left the pane at, is disabled or is no longer shown; else `undefined`.
   * @example keptFocusHolder()?.control.dataset.action // => 'stop' while Stop is disabled for a pending request
   */
  const keptFocusHolder = (): typeof focusHolder =>
    focusHolder && isFocusTakenFrom(focusHolder.control)
      ? { control: focusHolder.control, isTakenByPage: true }
      : undefined
  /**
   * Reads at which control the keyboard stands, before a message of the host changes the page; called by the listener that is added ahead of the one that handles the message.
   * @example readFocusHolder()
   */
  const readFocusHolder = (): void => {
    const focused = focusedControl()
    focusHolder = focused
      ? { control: focused, isTakenByPage: false }
      : keptFocusHolder()
  }
  /**
   * Says whether the pane may place the focus for a holder now: this document has the focus, and the focus stands on the document body or on the holder itself. Read by {@link settleFocus}.
   * A pane the learner left takes no focus back, and a learner who put the focus on another control keeps it.
   * @param control - The control at which the keyboard stood.
   * @example isFocusOpenFor(button('stop')!) // => true after the run stopped under a focused Stop
   */
  const isFocusOpenFor = (control: HTMLElement): boolean =>
    document.hasFocus() &&
    (document.activeElement === document.body ||
      document.activeElement === control)
  /**
   * Gives a holder that is shown its own control back when the page had taken the focus from it by disabling it and it can be used again; read by {@link focusTargetFor}.
   * Pressing a control that the host disables while it works (Stop, a recorded step, Restore) therefore leaves the keyboard on that control. A control the learner took the focus from gets nothing back.
   * @param holder - The holder, whose control is shown.
   * @returns The control when the page took its focus and it is enabled again, else `undefined` (a disabled control waits).
   * @example returningControl({ control: element('next-moment'), isTakenByPage: true })?.id // => 'next-moment' once the requested moment is shown
   */
  const returningControl = (
    holder: NonNullable<typeof focusHolder>,
  ): HTMLElement | undefined =>
    holder.isTakenByPage && !holder.control.matches(':disabled')
      ? holder.control
      : undefined
  /**
   * Gives the control that takes the focus of a holder; read by {@link settleFocus}.
   * @param holder - The control at which the keyboard stood, and whether the page took the focus from it.
   * @returns
   * - The control left the page: the summary of the nearest disclosure around it that is still shown, else {@link stayingControl}
   * - The control is shown: what {@link returningControl} gives
   * @example focusTargetFor({ control: button('stop')!, isTakenByPage: false })?.id // => 'live-tab' once the live strip has left
   */
  const focusTargetFor = (
    holder: NonNullable<typeof focusHolder>,
  ): HTMLElement | undefined => {
    if (holder.control.checkVisibility()) return returningControl(holder)
    return (
      disclosureSummaryAround(holder.control) ?? stayingControl(holder.control)
    )
  }
  /**
   * Gives the focus of a control that left the page a control that stays, and gives a control the page had disabled its focus back, so the focus does not rest on the document body. Called after every message of the host, by a listener added after the one that handles the message, and at this document's focus event. A focus that was placed is owed no more.
   * A part with a rule of its own (the Show Variables buttons, Saved studies) has moved its focus before, and that focus is kept.
   * @example settleFocus()
   */
  const settleFocus = (): void => {
    const holder = focusHolder
    if (!holder || !isFocusOpenFor(holder.control)) return
    const target = focusTargetFor(holder)
    if (!target) return
    focusHolder = undefined
    target.focus({ preventScroll: true })
  }
  window.addEventListener('focus', settleFocus)
  // Added after every listener that places a focus at the window's focus event: what has the focus now is what the pane settled for this return. A press that is under way brought the return about, and the browser handles it after this event; the focus it may take off is put back at its release.
  window.addEventListener('focus', (event) => {
    paneReturn = { atMs: event.timeStamp, control: focusedControl() }
    if (isPressUnderWay) isPressOfReturn = true
  })
  /** Says whether the transport's status describes a shown moment, which is when it carries the covered label: not while the replay failed, nor while a requested moment is pending. Read by {@link coveredAnnouncement}. @example showsMomentStatus(recording) // => false for a failed replay */
  const showsMomentStatus = (
    recording: NonNullable<StudyViewMessage['recording']>,
  ): boolean =>
    recording.readiness !== 'failed' &&
    !(recording.cleared && recording.readiness === 'loading')
  /**
   * Gives what the transport's second status region says for a replay: the remedy for a recorded application another tab covers, exactly while the transport's status carries the covered label for a moment that is shown (the observation is not loading, the moment is neither failed nor pending).
   * The region is written with {@link text} on every Study message that carries a recording, in the pane that shows the transport, so a screen reader hears the remedy once, when the cover begins, after the status that names the label; the summary's visible line stays in `#loading`, which is no live region.
   * @param recording - The replay of the current Study message.
   * @param isLoading - Whether the selected observation is loading.
   * @returns
   * - A covered recording whose moment is shown: the remedy sentence
   * - A recording that is not covered, an observation that is loading, a failed or a pending moment: an empty text
   * @example coveredAnnouncement(recording, false) // => 'Bring the Recorded application tab to the front to show this moment again.'
   */
  const coveredAnnouncement = (
    recording: NonNullable<StudyViewMessage['recording']>,
    isLoading: boolean,
  ): string =>
    recording.applicationCovered && !isLoading && showsMomentStatus(recording)
      ? options.applicationCovered.announcement
      : ''
  /**
   * Gives what a presentation that is neither being saved nor changing has to report; read by {@link presentationStatus}.
   * @param presentation - The presentation of the current Study message.
   * @returns
   * - The host gave a reason for the presentation or for its preference: that reason
   * - The layout is not confirmed: what the learner does about it
   * - Otherwise: an empty text
   * @example presentationNotice(message.presentation) // => 'Layout not confirmed. Restore it or focus a pane below.'
   */
  const presentationNotice = (presentation: PresentationState): string =>
    presentation.reason ??
    presentation.preference.reason ??
    (presentation.layoutConfirmed
      ? ''
      : 'Layout not confirmed. Restore it or focus a pane below.')
  /**
   * Gives what the status line under "Study view and pane controls" says about the presentation; read on every Study message that carries a presentation.
   * The line stands outside that disclosure, so it is rendered while the Recording tab keeps the disclosure closed, and its first text changes a status region that exists. The bottom panel's pane has no pane controls: its line stays empty, as it never showed one, and the Study pane alone announces the status.
   * @param presentation - The presentation of the current Study message.
   * @returns
   * - In the bottom panel's pane: an empty text
   * - The preference is being saved, or the presentation is changing: that progress
   * - Otherwise: what {@link presentationNotice} gives
   * @example presentationStatus(message.presentation) // => 'Changing presentation…'
   */
  const presentationStatus = (presentation: PresentationState): string => {
    if (isBottomPanel) return ''
    if (presentation.preference.status === 'saving')
      return 'Layout applied · saving preference…'
    if (presentation.state === 'applying') return 'Changing presentation…'
    return presentationNotice(presentation)
  }
  /**
   * Names the live run in the strip's status; read by {@link liveStripStatus}.
   * @param message - The current Study message.
   * @param profileTitle - The title of the live run's profile, when the message lists that profile.
   * @param generalName - What the run is called when neither names it.
   * @returns The title the host gives the run, else its profile's title, else `generalName`.
   * @example liveRunName(message, undefined, 'Runtime') // => 'Runtime'
   */
  const liveRunName = (
    message: StudyViewMessage,
    profileTitle: string | undefined,
    generalName: string,
  ): string => message.liveTitle ?? profileTitle ?? generalName
  /**
   * Says whether a Study message shows a replay in the bottom panel's pane, which shows the transport alone then; read by {@link showsLiveStrip} and before the recording's save state is written.
   * The live strip and the save state are left out there by keeping their status regions empty, not by taking them from the page: when the replay is left, the run's state and the save state are written into regions that exist. Both say how things stand at that moment, so their announcement then is no old news.
   * @param message - The current Study message.
   * @example isReplayInBottomPanel(message) // => false in the Study pane, which shows the strip beside a replay
   */
  const isReplayInBottomPanel = (message: StudyViewMessage): boolean =>
    isBottomPanel && Boolean(message.recording)
  /**
   * Says whether this pane shows the live strip for a Study message; read by {@link liveStripStatus}.
   * @param message - The current Study message.
   * @returns `true` while a run of this window has not stopped, except in the bottom panel during a replay ({@link isReplayInBottomPanel}).
   * @example showsLiveStrip(message) // => false once the run stopped
   */
  const showsLiveStrip = (message: StudyViewMessage): boolean =>
    Boolean(message.liveState) &&
    message.liveState !== 'stopped' &&
    !isReplayInBottomPanel(message)
  /**
   * Gives what the live strip's status says; read on every Study message.
   * The strip is never taken from the page: its status is empty while this pane does not show the strip ({@link showsLiveStrip}), and the stylesheet shows nothing of a strip whose status is empty. The first state of a run therefore changes a status region that exists.
   * @param message - The current Study message.
   * @param profileTitle - The title of the live run's profile, when the message lists that profile.
   * @returns
   * - The pane does not show the strip (no run of this window is live, or the bottom panel shows a replay): an empty text
   * - The run is paused at an item of the study: its title and that item
   * - Otherwise: its title and its state
   * @example liveStripStatus(message, 'Repository operation') // => 'Repository operation — paused at Theme'
   */
  const liveStripStatus = (
    message: StudyViewMessage,
    profileTitle: string | undefined,
  ): string => {
    if (!showsLiveStrip(message)) return ''
    return message.model.currentItemId
      ? `${liveRunName(message, profileTitle, 'Live study')} — paused at ${message.model.currentItemTitle}`
      : `${liveRunName(message, profileTitle, 'Runtime')} — ${message.liveState}`
  }
  /**
   * Says whether this pane shows the replay transport for a Study message; read on every Study message before the transport is written.
   * @param message - The current Study message.
   * @returns
   * - No recording is open: `false`
   * - The Study pane while the bottom panel is visible, which owns the transport then: `false`
   * - Otherwise: `true`
   * @example showsTransport(message) // => true in the bottom panel's pane during a replay
   */
  const showsTransport = (message: StudyViewMessage): boolean =>
    Boolean(message.recording) &&
    !(message.playbackPanelVisible && !isBottomPanel)
  /**
   * Shows the replay transport or leaves it out without taking it from the page; called on every Study message before the transport's parts are written.
   * The section stays rendered, so its status regions exist before their first text. A transport this pane does not show has empty status regions, which is what the stylesheet reads to show nothing of it, and no name, so it is no empty landmark; a shown transport is the landmark its name makes.
   * @param isShown - Whether this pane shows the transport, see {@link showsTransport}.
   * @example offerTransport(showsTransport(message))
   */
  const offerTransport = (isShown: boolean): void => {
    if (isShown) {
      transport.setAttribute('aria-label', options.replayTransportLabel)
      return
    }
    transport.removeAttribute('aria-label')
    for (const regionId of [
      'recording-status',
      'application-covered-remedy',
      'playback-hint',
    ])
      text(regionId, '')
  }
  /**
   * Makes each title that its two-line clamp cuts a tab stop, so the keyboard can open it (a focused title is shown whole), and takes the tab stop from a title that fits; called after every Study message and when the pane is resized.
   * A focused title is not measured: it is shown whole and would read as fitting.
   * @example offerClampedTitles()
   */
  const offerClampedTitles = (): void => {
    for (const heading of [element('title'), element('learning-title')]) {
      if (document.activeElement === heading) continue
      if (heading.scrollHeight > heading.clientHeight) heading.tabIndex = 0
      else heading.removeAttribute('tabindex')
    }
  }
  window.addEventListener('resize', offerClampedTitles)
  // Listeners of one event run in the order they were added: this one reads the focus before the message changes the page.
  window.addEventListener('message', readFocusHolder)
  window.addEventListener('message', (event) => {
    const message:
      | StudyViewMessage
      | PresentationPoseCapture
      | PresentationPoseRestore
      | OpenRequestSettled
      | StudyFilesCopied = event.data
    if (message?.type === 'open-request-settled') {
      settleOpenRequest(message)
      return
    }
    if (message?.type === 'study-files-copied') {
      showStudyFilesCopied(message)
      return
    }
    if (message?.type === 'capture-presentation-pose') {
      capturePose(message)
      return
    }
    if (message?.type === 'restore-presentation-pose') {
      restorePose(message)
      return
    }
    if (message?.type !== 'study') return
    const incoming = message.presentation
    if (
      poseTransaction &&
      (incoming?.state !== 'applying' ||
        incoming.presentationId !== poseTransaction.request.presentationId ||
        incoming.presentationControlRevision !==
          poseTransaction.request.expectedRevision)
    )
      poseTransaction = undefined
    current = message
    const { model, recording } = message,
      contentTab = message.contentTab ?? model.selection.tab
    document.body.dataset.contentTab = contentTab
    document.body.dataset.replay = String(Boolean(recording))
    text('reader-kind', recording ? 'Learning summary' : 'Codebook study')
    const shouldRevealFollowedPause =
      contentTab === 'live' &&
      !recording &&
      model.selection.follow &&
      Boolean(model.observation) &&
      model.observation?.id !== revealedFollowedObservationId &&
      window.innerWidth <= options.compactReaderMaxWidthPx
    // On a narrow Live reader, make captured evidence the first visible content without hiding pane controls from the learner.
    if (contentTab !== selectedContentTab) {
      if (
        (contentTab === 'recording' ||
          (contentTab === 'live' &&
            window.innerWidth <= options.compactReaderMaxWidthPx)) &&
        !readerOptionsOpenedByLearner
      )
        readerOptions.removeAttribute('open')
      if (contentTab === 'overview' && selectedContentTab === 'live')
        readerOptions.setAttribute('open', '')
      selectedContentTab = contentTab
      readerOptionsOpenedByLearner = false
    }
    const mode = message.presentation,
      applying = mode?.state === 'applying'
    if (mode) {
      document.body.dataset.presentation = mode.mode
      const descriptor = options.presentations.find(
        (descriptor) => descriptor.mode === mode.mode,
      )
      text(
        'presentation-caption',
        recording
          ? 'Recorded application and source stay in the editor; learning summary stays in the sidebar.'
          : (descriptor?.description ?? ''),
      )
      text('presentation-status', presentationStatus(mode))
      for (const control of Array.from(
        document.querySelectorAll<HTMLButtonElement>('[data-presentation]'),
      )) {
        control.disabled = applying
        if (control.dataset.presentation === 'save-preference')
          control.hidden =
            Boolean(recording) ||
            mode.preference.status !== 'failed' ||
            !mode.layoutConfirmed
      }
      button('arrange')!.textContent =
        `Restore ${descriptor?.title ?? 'presentation'} layout`
    }
    // A native sidebar cannot use the retired central explanation pane's enlargement action.
    button('enlarge-context')!.hidden = Boolean(recording)
    button('read-context')!.textContent = recording ? 'Summary' : 'Explanation'
    button('read-context')!.setAttribute(
      'aria-label',
      recording ? 'Read learning summary' : 'Read explanation',
    )
    button('focus-context')!.textContent = recording
      ? 'Focus learning summary'
      : 'Focus explanation'
    button('return-wiki')!.hidden = !message.repositoryReturnAvailable
    button('open-article')!.hidden =
      !message.repositoryArticleAvailable ||
      Boolean(message.repositoryReturnAvailable)
    element('next-scenario').hidden = Boolean(recording)
    element('study-controls').hidden = Boolean(recording)
    // A visible bottom panel owns transport; closing it restores the summary fallback.
    const isTransportShown = showsTransport(message)
    offerTransport(isTransportShown)
    if (recording) {
      const range = recording.range,
        pending = recording.cleared && recording.readiness === 'loading'
      const timeline = recording.historyTimeline ?? {
        status: 'unknown' as const,
      }
      const presentedMs = recording.presentedMs
      const selectedHistoryGap =
        timeline.status === 'mapped' &&
        presentedMs !== undefined &&
        !timeline.recordedPoints.includes(presentedMs) &&
        timeline.gaps.some(
          (gap) => presentedMs >= gap.startMs && presentedMs < gap.endMs,
        )
      // The transport's status regions carry text only in the pane that shows the transport; in the other pane they stay as empty as {@link offerTransport} left them.
      if (isTransportShown) {
        text(
          'recording-status',
          recording.readiness === 'failed'
            ? 'Playback stopped — presentation unavailable'
            : pending
              ? 'Loading matching image, source and values…'
              : `${recording.mode === 'playing' ? 'Playing' : 'Paused'} · ${recording.recordingStatus ?? 'Loading recording'}${selectedHistoryGap ? ' · Not recorded at this moment' : ''}${recording.applicationCovered ? ` · ${options.applicationCovered.label}` : ''}`,
        )
        text(
          'application-covered-remedy',
          coveredAnnouncement(recording, message.loading),
        )
      }
      text(
        'playback-position',
        `${recording.presentedMs === undefined ? 'No position presented' : `Presented ${seconds(recording.presentedMs)}`}${range ? ` / ${seconds(range.endMs)}${range.endKnown ? '' : ' — last verified time; end unknown'}` : ''}`,
      )
      text(
        'playback-pending',
        pending
          ? `Requested ${recording.requestedMs === undefined ? 'saved position' : seconds(recording.requestedMs)}. Waiting for a matching presentation.`
          : '',
      )
      const failed = recording.readiness === 'failed',
        diagnostic = [
          recording.reason,
          recording.recordingReason,
          recording.contextReason,
          recording.missing,
        ]
          .filter(Boolean)
          .join('\n')
      // Keep recovery readable while preserving copyable technical detail and nonfailed partial-recording warnings.
      text(
        'playback-reason',
        failed ? options.playbackFailureRecovery : diagnostic,
      )
      // Unloaded native values are guidance, not an error; a failed moment shows only its recovery.
      if (isTransportShown)
        text(
          'playback-hint',
          !failed && recording.nativeValuesUninspected
            ? options.nativeValuesHint
            : '',
        )
      // The hint comes with a control that opens Run and Debug and expands Variables in one click.
      offerShowVariables(
        'playback-show-variables',
        !failed && Boolean(recording.nativeValuesUninspected),
        options.replayTransportFocus,
        'recording-transport',
      )
      text('playback-diagnostic', failed ? diagnostic : '')
      element('playback-diagnostics').hidden = !failed || !diagnostic
      const toggle = element('playback-toggle')
      if (toggle instanceof HTMLButtonElement) {
        const pause = recording.mode === 'playing' || pending
        toggle.dataset.playback = pause ? 'pause' : 'play'
        toggle.textContent = pause ? 'Pause' : 'Play'
        toggle.setAttribute(
          'aria-label',
          pause ? 'Pause playback' : 'Play recording',
        )
        toggle.title = pause ? 'Pause playback' : 'Play recording'
        toggle.disabled =
          !pause &&
          (recording.readiness !== 'ready' ||
            !range ||
            recording.presentedMs === range.endMs)
      }
      for (const direction of ['previous', 'next'] as const) {
        const control = element(`${direction}-moment`)
        if (control instanceof HTMLButtonElement)
          control.disabled = recordedStep(direction) === undefined
      }
      const start = document.querySelector<HTMLButtonElement>(
        '[data-playback="start"]',
      )
      if (start) start.disabled = !range
      const playhead = element('playhead')
      if (playhead instanceof HTMLInputElement) {
        playhead.disabled = !range
        playhead.min = String(range?.startMs ?? 0)
        playhead.max = String(range?.endMs ?? 0)
        if (!scrubbing)
          playhead.value = String(recording.presentedMs ?? range?.startMs ?? 0)
        playhead.setAttribute(
          'aria-valuetext',
          recording.presentedMs === undefined
            ? 'No recorded position presented'
            : `${seconds(recording.presentedMs)} presented${range?.endKnown === false ? '; recording end unknown' : ''}`,
        )
      }
      const coverage = element('history-coverage')
      const mapped =
        timeline.status === 'mapped' && range && range.endMs > range.startMs
      coverage.hidden = !mapped
      text(
        'history-coverage-label',
        mapped
          ? timeline.gaps.length
            ? 'Striped: source/debugger not recorded · ticks: recorded stops'
            : 'Source/debugger history recorded across this range'
          : 'Historical source/debugger coverage unknown',
      )
      if (mapped) {
        const signature = JSON.stringify([
          range.startMs,
          range.endMs,
          timeline.gaps,
          timeline.recordedPoints,
        ])
        const gapTimes = timeline.gaps
          .map((gap) => `${seconds(gap.startMs)}–${seconds(gap.endMs)}`)
          .join(', ')
        const stopTimes = timeline.recordedPoints.map(seconds).join(', ')
        coverage.setAttribute(
          'aria-label',
          `${timeline.gaps.length} source/debugger history gap${timeline.gaps.length === 1 ? '' : 's'}${gapTimes ? `: ${gapTimes}` : ''}; ${timeline.recordedPoints.length} recorded stop${timeline.recordedPoints.length === 1 ? '' : 's'}${stopTimes ? `: ${stopTimes}` : ''}`,
        )
        if (coverage.dataset.signature !== signature) {
          coverage.replaceChildren()
          coverage.dataset.signature = signature
          const durationMs = range.endMs - range.startMs
          // Draw sealed-history gaps and exact recorded stops without changing the range input's seek semantics.
          for (const gap of timeline.gaps) {
            const mark = document.createElement('span')
            mark.className = 'history-gap'
            mark.setAttribute('aria-hidden', 'true')
            mark.style.left = `${((gap.startMs - range.startMs) / durationMs) * options.timelineFullWidthPercent}%`
            mark.style.width = `${((gap.endMs - gap.startMs) / durationMs) * options.timelineFullWidthPercent}%`
            mark.title = `Not recorded at this moment · ${seconds(gap.startMs)}–${seconds(gap.endMs)}`
            coverage.append(mark)
          }
          for (const positionMs of timeline.recordedPoints) {
            const mark = document.createElement('span')
            mark.className = 'history-stop'
            mark.setAttribute('aria-hidden', 'true')
            mark.style.left = `${((positionMs - range.startMs) / durationMs) * options.timelineFullWidthPercent}%`
            mark.title = `Recorded source and debugger · ${seconds(positionMs)}`
            coverage.append(mark)
          }
        }
      } else {
        coverage.replaceChildren()
        delete coverage.dataset.signature
        coverage.setAttribute(
          'aria-label',
          'Historical source and debugger coverage unknown',
        )
      }
    }
    const item = model.progressByItem.find(
      (value) => value.id === model.selection.itemId,
    )
    text('title', item?.title ?? 'Codebook study')
    // The heading is clamped to two lines in a narrow replay; its tooltip keeps the whole title for the pointer.
    element('title').title = item?.title ?? 'Codebook study'
    const selectedProfile = message.profiles.find(
        (profile) => profile.id === model.selection.profile,
      ),
      liveProfile = message.profiles.find(
        (profile) => profile.id === message.liveProfile,
      )
    text(
      'profile-description',
      model.selection.profile === 'repository-browser'
        ? 'Ask your agent to prepare a new operation in this article. Reading saved configuration never starts it.'
        : (selectedProfile?.description ?? 'Scenario unavailable.'),
    )
    // Offline replay prioritizes its own controls; an independently active runtime keeps its explicit stop/return strip.
    text('runtime', liveStripStatus(message, liveProfile?.title))
    text(
      'deadline',
      message.deadlineAt && !message.study?.terminal
        ? `Study wall limit: ${new Date(message.deadlineAt).toLocaleTimeString()}. History remains readable after expiry.`
        : 'Reading history does not restart execution.',
    )
    const outcome = message.study?.studyOutcome
    const scenario = model.scenarioProgress
    const outcomeLabel =
      outcome === 'demonstrated'
        ? 'Observation saved'
        : outcome === 'partial'
          ? 'Partial evidence'
          : outcome === 'not-demonstrated'
            ? 'Evidence not demonstrated'
            : 'Evidence checks pending'
    const endedProgress =
      message.study?.terminal && !recording
        ? ` Last observed stop: ${scenario?.lastObservedTitle ?? 'none'}.`
        : ''
    const missingEvidence =
      message.study?.terminal && scenario
        ? [
            scenario.missingImageTitles.length
              ? `Missing images: ${scenario.missingImageTitles.join(', ')}.`
              : '',
            scenario.unverifiedLinkCount
              ? `${scenario.unverifiedLinkCount} runtime connections unverified.`
              : '',
          ]
            .filter(Boolean)
            .join(' ')
        : ''
    element('study-state').hidden =
      !message.study ||
      Boolean(recording && document.body.classList.contains('moments-only'))
    text(
      'study-state',
      message.study
        ? `${recording ? 'Recorded study (whole run)' : message.study.terminal ? 'Study ended' : 'Study in progress'} — ${outcomeLabel} · runtime: ${message.study.finalOutcome} · history: ${message.study.historyOutcome}.${endedProgress}${missingEvidence ? ` ${missingEvidence}` : ''}${message.study.reason ? ` ${message.study.reason}` : ''}`
        : '',
    )
    const savedRecording = message.study?.recordingSave
    const recordingLabel = !savedRecording
      ? 'Recording not verified in this reader. Open Recording to inspect its saved evidence.'
      : savedRecording.status === 'partial' ||
          savedRecording.status === 'failed' ||
          savedRecording.contextStatus === 'failed'
        ? `Recording incomplete: ${savedRecording.reason ?? savedRecording.contextReason ?? 'Matching recording evidence is unavailable.'} Use Retry storage / refresh or open Recording to inspect retained evidence.`
        : savedRecording.status === 'finalized' &&
            savedRecording.contextStatus === 'saved'
          ? 'Recording saved.'
          : savedRecording.status === 'recording'
            ? 'Recording in progress; saving is not complete.'
            : savedRecording.status === 'finalized'
              ? 'Recording frames saved; matching source and explanation context is pending.'
              : 'Recording unavailable for this study.'
    // Without a study, and in the bottom panel during a replay, the line is empty and takes no room; it stays rendered, so the first label is a change of a status region that exists.
    text(
      'recording-save-state',
      message.study && !isReplayInBottomPanel(message) ? recordingLabel : '',
    )
    element('evidence-details').hidden = !message.study
    text('evidence-summary', `Evidence status · ${outcomeLabel}`)
    // Why the last run did not start comes first; Retry storage / refresh cannot fix it, so it does not count for that button.
    text(
      'errors',
      (message.runRefusal
        ? [message.runRefusal, ...message.errors]
        : message.errors
      ).join('\n'),
    )
    // A layout notice or a refused control is nothing Retry storage can answer.
    button('retry')!.hidden =
      message.errors.length <= (message.unretryableErrorCount ?? 0) &&
      savedRecording?.contextStatus !== 'failed' &&
      savedRecording?.status !== 'failed' &&
      savedRecording?.status !== 'partial'
    button('continue')!.disabled =
      applying || message.busy || message.loading || !model.continueArguments
    // A selected Node history masks the live application even while following, so leaving it is always available.
    button('return-current')!.disabled =
      !message.nodeHistory &&
      (!model.currentParticipant || (model.matching && model.selection.follow))
    button('stop')!.disabled =
      message.busy || !message.liveState || message.liveState === 'stopped'
    button('click')!.disabled = applying || message.busy || !message.canClick
    button('click')!.textContent = message.nextAction
      ? `${message.nextAction.title} once`
      : 'No action available'
    button('stop')!.textContent = liveProfile
      ? `Stop ${message.liveTitle ?? liveProfile.title}`
      : 'Stop'
    // A recorded moment another tab covers is recorded and only hidden: the line says that and what brings it back, and the selected observation stays readable.
    const isApplicationCovered =
      Boolean(recording?.applicationCovered) && !message.loading
    element('loading').hidden = !message.loading && !isApplicationCovered
    text(
      'loading',
      recording?.readiness === 'failed'
        ? 'Recorded context unavailable. Reload after resolving the reported problem.'
        : isApplicationCovered
          ? options.applicationCovered.remedy
          : 'Loading the selected observation…',
    )
    element('selected').hidden = message.loading
    for (const tab of Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-tab]'),
    )) {
      const selected = tab.dataset.tab === contentTab
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
    }
    element('overview').hidden = contentTab !== 'overview'
    element('live-content').hidden = contentTab === 'overview'
    element('live-content').setAttribute(
      'aria-labelledby',
      contentTab === 'recording' ? 'recording-tab' : 'live-tab',
    )
    text('overview-text', item?.overview ?? 'Source unavailable.')
    text(
      'observation',
      recording
        ? model.observation
          ? `Recorded observation · ${seconds(model.observation.elapsedMs)}${recording.pauseConfirmed ? ' · pause verified' : ''}${recording.rendererConfirmed ? ' · original renderer receipt available' : ''}`
          : 'No source or values were observed by this recorded position.'
        : !model.observation && !model.currentSourceAvailable
          ? 'Current source unavailable — read a captured observation or retry.'
          : model.observation
            ? `${model.matching ? 'Observed in this run — current inspected pause' : 'Captured observation — history'} · ${new Date(model.observation.capturedAt).toLocaleString()}`
            : message.study?.terminal
              ? 'Not observed before this study ended — source-derived material only'
              : 'Not observed — source-derived material only',
    )
    text(
      'source-version',
      recording && !model.observation
        ? 'No captured source at this time. The source pane shows an explicit placeholder.'
        : !model.observation && !model.currentSourceAvailable
          ? 'No current source version could be verified.'
          : // A stop the debugger moved names the line it paused on and the line it was declared on.
            `${model.observation ? 'Captured source' : 'Source-derived document'} · line ${model.source.line}${model.sourceDeclaredLine === undefined ? '' : ` (declared on line ${model.sourceDeclaredLine})`} · ${model.source.hash.slice(0, 12)}`,
    )
    text(
      'understanding-label',
      model.selection.profile === 'repository-browser'
        ? 'understand'
        : 'I understand this source revision',
    )
    element('understanding-description').hidden =
      model.selection.profile !== 'repository-browser'
    text(
      'source-drift',
      !model.currentSourceAvailable
        ? 'Current source unavailable. Historical source and understanding are retained.'
        : model.sourceChanged
          ? model.selection.profile === 'repository-browser'
            ? 'Review needed — a cited source changed. Historical understanding still refers to the complete captured citation set.'
            : 'Review needed — source changed. This is the captured older revision.'
          : '',
    )
    const checkbox = element('understood')
    // Native disabled blurs a focused checkbox; saving retains its focus and exposes the temporary ARIA state.
    if (checkbox instanceof HTMLInputElement) {
      checkbox.checked = model.selectedUnderstanding.understood
      checkbox.disabled = message.loading || !model.selectedUnderstanding.known
      checkbox.setAttribute(
        'aria-disabled',
        String(message.saving || checkbox.disabled),
      )
    }
    text(
      'save-state',
      message.saving
        ? 'Saving…'
        : recording && !model.observation
          ? 'Seek to an observed moment to check understanding.'
          : !model.selectedUnderstanding.known
            ? 'Understanding storage unavailable'
            : model.selectedUnderstanding.understood
              ? `Learner marked understood · ${model.selectedUnderstanding.at ?? ''}`
              : 'Checked only by you; execution never changes this.',
    )
    text(
      'progress',
      !model.currentSourceAvailable
        ? 'Current source unavailable — historical understanding retained.'
        : `${model.understoodCount} of ${model.progressByItem.length} understood for current source · ${model.reviewCount} needs review`,
    )
    // In a replay the selected observation is the projection's: an explanation shown before its saved time says when it was saved.
    const interpretations: ShownInterpretation[] =
      model.observation?.interpretations ?? []
    replace('interpretations', [Boolean(recording), interpretations], () =>
      interpretations.length
        ? interpretations.flatMap((value) => {
            const paragraph = document.createElement('p')
            paragraph.className = 'interpretation'
            paragraph.textContent = value.text
            if (!value.savedLater) return [paragraph]
            const note = document.createElement('p')
            note.className = 'muted'
            note.textContent = savedNote(value.savedLater)
            return [paragraph, note]
          })
        : [
            document.createTextNode(
              recording
                ? 'No explanation was available by this recorded time.'
                : 'No agent explanation attached. Inspect captured state in the editor debugger.',
            ),
          ],
    )
    const later = recording?.laterInterpretations ?? []
    element('later-annotations').hidden = !later.length
    replace('later-interpretations', later, () =>
      later.map((value) => {
        const paragraph = document.createElement('p')
        paragraph.className = 'interpretation'
        paragraph.textContent = `${value.availableMs === null ? 'Availability time unknown' : `Added at ${seconds(value.availableMs)}${recording?.range && value.availableMs > recording.range.endMs ? ' — after recording ended' : ''}`} · ${value.text}`
        return paragraph
      }),
    )
    const learning = recording?.learningSummary
    element('learning-material').hidden = !learning
    element('learning-unavailable').hidden = !recording || Boolean(learning)
    if (learning) {
      text('learning-title', learning.content.title)
      // The title is clamped to two lines in a narrow summary; its tooltip keeps the whole sentence.
      element('learning-title').title = learning.content.title
      text('learning-question', `Question: ${learning.content.question}`)
      text('learning-summary', learning.content.summary)
      replace('learning-sequence', learning, () => {
        const namespace = 'http://www.w3.org/2000/svg',
          diagram = document.createElementNS(namespace, 'svg')
        const layout = options.sequence,
          width = Math.max(
            layout.minWidthPx,
            learning.content.participants.length * layout.columnWidthPx,
          ),
          height =
            layout.topPaddingPx +
            learning.content.steps.length * layout.rowHeightPx
        diagram.setAttribute('viewBox', `0 0 ${width} ${height}`)
        diagram.setAttribute('width', String(width))
        diagram.setAttribute('height', String(height))
        diagram.setAttribute('role', 'img')
        diagram.setAttribute(
          'aria-label',
          `Sequence for ${learning.content.title}. Numbered interactions are described below.`,
        )
        const column = (id: string) =>
          layout.columnWidthPx / 2 +
          learning.content.participants.findIndex((value) => value.id === id) *
            layout.columnWidthPx
        for (const participant of learning.content.participants) {
          const x = column(participant.id),
            name = document.createElementNS(namespace, 'text'),
            line = document.createElementNS(namespace, 'line')
          name.setAttribute('x', String(x))
          name.setAttribute('y', String(layout.nameYpx))
          name.setAttribute('text-anchor', 'middle')
          // Participant names and explanations are text nodes; agent-authored markup never becomes executable content.
          for (
            let offset = 0;
            offset < participant.label.length;
            offset += layout.nameChunkChars
          ) {
            const span = document.createElementNS(namespace, 'tspan')
            span.setAttribute('x', String(x))
            span.setAttribute(
              'dy',
              String(offset ? layout.nameLineHeightPx : 0),
            )
            span.textContent = participant.label.slice(
              offset,
              offset + layout.nameChunkChars,
            )
            name.append(span)
          }
          line.setAttribute('x1', String(x))
          line.setAttribute('x2', String(x))
          line.setAttribute('y1', String(layout.lifelineYpx))
          line.setAttribute('y2', String(height))
          line.setAttribute('class', 'sequence-lifeline')
          diagram.append(name, line)
        }
        const list = document.createElement('ol')
        list.className = 'sequence-steps'
        learning.content.steps.forEach((step, index) => {
          const x1 = column(step.from),
            x2 = column(step.to),
            y = layout.firstArrowYpx + index * layout.rowHeightPx,
            arrow = document.createElementNS(namespace, 'path'),
            number = document.createElementNS(namespace, 'text')
          const direction = x2 >= x1 ? 1 : -1
          arrow.setAttribute(
            'd',
            x1 === x2
              ? `M ${x1} ${y} h ${layout.loopWidthPx} v ${layout.loopHeightPx} h ${-layout.loopWidthPx} m ${layout.arrowWidthPx} ${-layout.arrowHeightPx} l ${-layout.arrowWidthPx} ${layout.arrowHeightPx} l ${layout.arrowWidthPx} ${layout.arrowHeightPx}`
              : `M ${x1} ${y} H ${x2} m ${-layout.arrowWidthPx * direction} ${-layout.arrowHeightPx} l ${layout.arrowWidthPx * direction} ${layout.arrowHeightPx} l ${-layout.arrowWidthPx * direction} ${layout.arrowHeightPx}`,
          )
          arrow.setAttribute('class', `sequence-arrow ${step.evidence}`)
          number.setAttribute(
            'x',
            String((x1 + x2) / 2 + (x1 === x2 ? layout.loopHeightPx : 0)),
          )
          number.setAttribute('y', String(y - layout.numberGapPx))
          number.setAttribute('text-anchor', 'middle')
          number.textContent = `${index + 1}. ${step.label.slice(0, layout.nameChunkChars)}${step.label.length > layout.nameChunkChars ? '…' : ''}`
          diagram.append(arrow, number)
          const row = document.createElement('li'),
            label = document.createElement('strong'),
            detail = document.createElement('p')
          label.textContent = `${step.label} · ${step.evidence}`
          detail.textContent = step.explanation
          row.append(label, detail)
          const position = learning.positions.find(
            (value) => value.stepId === step.id,
          )?.elapsedMs
          if (position !== undefined) {
            const link = document.createElement('button')
            link.className = 'link'
            link.dataset.summaryStep = step.id
            link.textContent = `${step.reference && 'captureHash' in step.reference ? 'Inspect verified result' : 'Inspect referenced stop'} · ${seconds(position)}`
            row.append(link)
          } else {
            const missing = document.createElement('p')
            missing.className = 'muted'
            missing.textContent = 'No recorded evidence is linked to this step.'
            row.append(missing)
          }
          list.append(row)
        })
        const visual = document.createElement('div')
        visual.className = 'sequence-diagram'
        visual.append(diagram)
        return [visual, list]
      })
      for (const control of Array.from(
        element('learning-sequence').querySelectorAll<HTMLButtonElement>(
          '[data-summary-step]',
        ),
      )) {
        control.disabled = recording?.readiness !== 'ready'
        const step = learning.content.steps.find(
          (value) => value.id === control.dataset.summaryStep,
        )
        control.setAttribute(
          'aria-current',
          String(
            Boolean(
              step?.reference &&
              'snapshotUri' in step.reference &&
              step.reference.snapshotUri === model.observation?.snapshotUri,
            ),
          ),
        )
      }
    }
    const focusedListControl = keyboardControl()
    const focusedItem = focusedListControl?.dataset.item
    const focusedRegion = focusedListControl?.parentElement?.id
    replace(
      'flow',
      model.progressByItem.map((value) => [value.id, value.title]),
      () =>
        model.progressByItem.map((value) => {
          const link = document.createElement('button')
          link.className = 'link'
          link.dataset.item = value.id
          link.textContent = value.title
          return link
        }),
    )
    text(
      'correspondence',
      recording
        ? 'Select an observed moment to seek. Source relationships are not inferred from video frames.'
        : message.study?.profile === 'repository-browser'
          ? 'One browser action is declared. Article relationships remain source-derived interpretations.'
          : 'Source-derived link; execution correspondence has not been observed.',
    )
    replace(
      'moments',
      [message.moments, model.observation?.id, Boolean(recording)],
      () =>
        message.moments.map((moment) => {
          const control = document.createElement('button')
          control.dataset.item = moment.itemId
          control.dataset.observation = moment.id
          control.textContent = `${moment.title} · ${recording && moment.elapsedMs !== undefined ? seconds(moment.elapsedMs) : new Date(moment.at).toLocaleTimeString()}`
          control.setAttribute(
            'aria-current',
            String(moment.id === model.observation?.id),
          )
          return control
        }),
    )
    if (!message.moments.length) text('moments', 'No observed moments yet.')
    // The same item's control of a list that was rendered again takes the focus its old control held.
    if (
      focusedListControl &&
      focusedItem &&
      (focusedRegion === 'flow' || focusedRegion === 'moments')
    )
      moveFocusOf(focusedListControl, () =>
        element(focusedRegion).querySelector<HTMLButtonElement>(
          `[data-item="${focusedItem}"]`,
        ),
      )
    const studies = element('studies')
    if (studies instanceof HTMLSelectElement) {
      const previous = studies.value
      replace('studies', message.studies, () => {
        if (!message.studies.length) {
          const placeholder = document.createElement('option')
          placeholder.value = ''
          placeholder.textContent = 'No saved study yet'
          return [placeholder]
        }
        // With studies listed and none chosen (after a removal) the list reads this prompt instead of a blank; it cannot be picked and is left out of the open list.
        const prompt = document.createElement('option')
        prompt.value = ''
        prompt.textContent = 'Choose a saved study'
        prompt.disabled = true
        prompt.hidden = true
        return [
          prompt,
          ...message.studies.map((study) => {
            const option = document.createElement('option')
            option.value = study.id
            option.textContent = studyLabel(
              study,
              studyKindLabel(study, message.profiles),
            )
            // A configured study that cannot be opened can still be chosen for deletion; a Node test history cannot be deleted here.
            option.disabled =
              study.metadata === 'unavailable' &&
              study.format === 'node-test-history'
            return option
          }),
        ]
      })
      // An entry that cannot be opened stays chosen until the learner chooses another or it leaves the list.
      if (
        unopenableChoice &&
        !message.studies.some((study) => study.id === unopenableChoice)
      )
        unopenableChoice = undefined
      followOpeningChoice(message)
      showChosenEntry(message, previous)
      const nodeHistories = message.nodeHistoryCatalog ?? []
      const nodeHistory = message.nodeHistory
      text(
        'node-history-status',
        nodeHistory
          ? `${nodeHistory.status}${nodeHistory.reason ? ` · ${nodeHistory.reason}` : ''} · ${nodeHistory.entries.length} verified events. Test output is the recorded surface; application video and synchronized application replay are unavailable.`
          : nodeHistories.length
            ? 'Choose a Node test history from Saved studies to inspect its verified output and debugger stops.'
            : 'No Node test history has been saved in this workspace.',
      )
      const nodeHistoryUnderstanding = element(
        'node-history-understood',
      ) as HTMLInputElement
      nodeHistoryUnderstanding.checked =
        message.nodeHistoryLearningDecision?.understood ?? false
      nodeHistoryUnderstanding.disabled =
        !nodeHistory || message.loading || Boolean(recording)
      nodeHistoryUnderstanding.setAttribute(
        'aria-disabled',
        String(nodeHistoryUnderstanding.disabled),
      )
      text(
        'node-history-understanding-state',
        message.nodeHistoryLearningDecision
          ? message.nodeHistoryLearningDecision.understood
            ? `Learner marked understood · ${message.nodeHistoryLearningDecision.at}`
            : `Learner marked for review · ${message.nodeHistoryLearningDecision.at}`
          : 'Only your explicit choice is saved; test success never marks understanding.',
      )
      const nodeLearning = message.nodeHistoryLearningMaterial
      element('node-history-learning').hidden = !nodeLearning
      if (nodeLearning) {
        text('node-learning-title', nodeLearning.content.title)
        text(
          'node-learning-question',
          `Question: ${nodeLearning.content.question}`,
        )
        text('node-learning-summary', nodeLearning.content.summary)
        replace('node-learning-sequence', nodeLearning, () => {
          const namespace = 'http://www.w3.org/2000/svg',
            diagram = document.createElementNS(namespace, 'svg')
          const layout = options.sequence,
            width = Math.max(
              layout.minWidthPx,
              nodeLearning.content.participants.length * layout.columnWidthPx,
            ),
            height =
              layout.topPaddingPx +
              nodeLearning.content.steps.length * layout.rowHeightPx
          diagram.setAttribute('viewBox', `0 0 ${width} ${height}`)
          diagram.setAttribute('width', String(width))
          diagram.setAttribute('height', String(height))
          diagram.setAttribute('role', 'img')
          diagram.setAttribute(
            'aria-label',
            `Sequence diagram for ${nodeLearning.content.title}; a numbered text description follows.`,
          )
          const column = (id: string) =>
            layout.columnWidthPx / 2 +
            nodeLearning.content.participants.findIndex(
              (participant) => participant.id === id,
            ) *
              layout.columnWidthPx
          for (const participant of nodeLearning.content.participants) {
            const x = column(participant.id),
              name = document.createElementNS(namespace, 'text'),
              lifeline = document.createElementNS(namespace, 'line')
            name.setAttribute('x', String(x))
            name.setAttribute('y', String(layout.nameYpx))
            name.setAttribute('text-anchor', 'middle')
            name.textContent = participant.label
            lifeline.setAttribute('x1', String(x))
            lifeline.setAttribute('x2', String(x))
            lifeline.setAttribute('y1', String(layout.lifelineYpx))
            lifeline.setAttribute('y2', String(height))
            lifeline.setAttribute('class', 'sequence-lifeline')
            diagram.append(name, lifeline)
          }
          const list = document.createElement('ol')
          list.className = 'sequence-steps'
          nodeLearning.content.steps.forEach((step, index) => {
            const from = column(step.from),
              to = column(step.to),
              y = layout.firstArrowYpx + index * layout.rowHeightPx,
              direction = to >= from ? 1 : -1
            const arrow = document.createElementNS(namespace, 'path'),
              label = document.createElementNS(namespace, 'text')
            arrow.setAttribute(
              'd',
              from === to
                ? `M ${from} ${y} h ${layout.loopWidthPx} v ${layout.loopHeightPx} h ${-layout.loopWidthPx} m ${layout.arrowWidthPx} ${-layout.arrowHeightPx} l ${-layout.arrowWidthPx} ${layout.arrowHeightPx} l ${layout.arrowWidthPx} ${layout.arrowHeightPx}`
                : `M ${from} ${y} H ${to} m ${-layout.arrowWidthPx * direction} ${-layout.arrowHeightPx} l ${layout.arrowWidthPx * direction} ${layout.arrowHeightPx} l ${-layout.arrowWidthPx * direction} ${layout.arrowHeightPx}`,
            )
            arrow.setAttribute('class', `sequence-arrow ${step.evidence}`)
            label.setAttribute('x', String((from + to) / 2))
            label.setAttribute('y', String(y - layout.numberGapPx))
            label.setAttribute('text-anchor', 'middle')
            label.textContent = `${index + 1}. ${step.label.slice(0, layout.nameChunkChars)}${step.label.length > layout.nameChunkChars ? '…' : ''}`
            diagram.append(arrow, label)
            const row = document.createElement('li'),
              heading = document.createElement('strong'),
              explanation = document.createElement('p')
            heading.textContent = `${step.label} · ${step.evidence}`
            explanation.textContent = step.explanation
            row.append(heading, explanation)
            const reference = step.reference
            if (reference) {
              const control = document.createElement('button')
              control.type = 'button'
              control.dataset.nodeHistorySequence = String(reference.sequence)
              control.textContent = `Inspect ${reference.type} event ${reference.sequence}`
              row.append(control)
            } else {
              const unavailable = document.createElement('p')
              unavailable.className = 'muted'
              unavailable.textContent =
                'No recorded event is linked to this step.'
              row.append(unavailable)
            }
            list.append(row)
          })
          const visual = document.createElement('div')
          visual.className = 'sequence-diagram'
          visual.append(diagram)
          return [visual, list]
        })
      }
      const position = message.nodeHistoryPosition
      const playbackState = message.nodeHistoryPlayback
      const nodeHistoryToggle = element(
        'node-history-playback-toggle',
      ) as HTMLButtonElement
      nodeHistoryToggle.dataset.nodeHistoryPlayback =
        playbackState?.mode === 'playing' ? 'pause' : 'play'
      nodeHistoryToggle.textContent =
        playbackState?.mode === 'playing' ? 'Pause' : 'Play'
      nodeHistoryToggle.disabled =
        !nodeHistory ||
        !playbackState?.sequence ||
        playbackState.loading ||
        (playbackState.mode === 'paused' &&
          (message.nodeHistoryEventCount ?? 0) > 0 &&
          (position?.eventIndex ?? -1) ===
            (message.nodeHistoryEventCount ?? 0) - 1)
      nodePlayhead.disabled =
        !nodeHistory ||
        playbackState?.startMs === undefined ||
        playbackState.endMs === undefined ||
        playbackState.startMs === playbackState.endMs ||
        playbackState.loading ||
        Boolean(recording)
      if (
        playbackState?.startMs !== undefined &&
        playbackState.endMs !== undefined
      ) {
        nodePlayhead.min = String(playbackState.startMs)
        nodePlayhead.max = String(playbackState.endMs)
        // A disabled playhead cannot be scrubbed, so a scrub interrupted by loading ends here.
        if (nodePlayhead.disabled) nodeHistoryScrubbing = false
        if (!nodeHistoryScrubbing)
          nodePlayhead.value = String(
            playbackState.positionMs ?? playbackState.startMs,
          )
      } else {
        nodeHistoryScrubbing = false
        nodePlayhead.min = '0'
        nodePlayhead.max = '0'
        nodePlayhead.value = '0'
      }
      // Assistive technology reads the selected test time, not the raw millisecond value; during a scrub the thumb's own time stays.
      if (!nodeHistoryScrubbing)
        nodePlayhead.setAttribute(
          'aria-valuetext',
          playbackState?.positionMs === undefined
            ? 'No recorded test time selected'
            : `${seconds(playbackState.positionMs)} of recorded test time`,
        )
      if (!nodeHistoryScrubbing)
        text(
          'node-history-playback-position',
          playbackState?.positionMs === undefined
            ? 'Test journal playback'
            : `Recorded test time · ${(playbackState.positionMs / options.secondMs).toFixed(2)} s`,
        )
      const momentDescription =
        position?.type === 'stop'
          ? `Debugger stop ${(position.index ?? 0) + 1}${position.sourceAvailable ? '' : ' · captured source unavailable'}`
          : position?.type === 'result'
            ? 'Test result · debugger not recorded at this moment'
            : position?.type === 'output'
              ? 'Test output · debugger not recorded at this moment'
              : 'Select an event to move through the recorded test history.'
      text(
        'node-history-position',
        position
          ? `${momentDescription} · ${(position.elapsedMs / 1000).toFixed(2)} s · output shown through this event.`
          : momentDescription,
      )
      // A saved stop committed without native values keeps the same muted guidance row as replay, separate from the position facts.
      text(
        'node-history-hint',
        position?.nativeValuesUninspected ? options.nativeValuesHint : '',
      )
      offerShowVariables(
        'node-history-show-variables',
        Boolean(position?.nativeValuesUninspected),
        options.nodeTransportFocus,
        'node-history',
      )
      text(
        'node-history-output',
        message.nodeHistoryOutput ??
          'Select an event to view test output recorded through that moment.',
      )
      text(
        'node-history-page',
        nodeHistory
          ? `Page ${(message.nodeHistoryPage ?? 0) + 1} of ${message.nodeHistoryPageCount ?? 1}`
          : '',
      )
      ;(element('node-history-previous') as HTMLButtonElement).disabled =
        !nodeHistory || (message.nodeHistoryPage ?? 0) === 0
      ;(element('node-history-next') as HTMLButtonElement).disabled =
        !nodeHistory ||
        (message.nodeHistoryPage ?? 0) + 1 >=
          (message.nodeHistoryPageCount ?? 0)
      const selectedSequence = position?.sequence
      const selectedIndex = position?.eventIndex ?? -1
      const eventCount = message.nodeHistoryEventCount ?? 0
      ;(element('node-history-moment-previous') as HTMLButtonElement).disabled =
        !nodeHistory || eventCount === 0 || selectedIndex === 0
      ;(element('node-history-moment-next') as HTMLButtonElement).disabled =
        !nodeHistory || eventCount === 0 || selectedIndex === eventCount - 1
      const unverifiedStops = message.nodeHistoryUnverifiedStops ?? []
      // Rendering the list again replaces its buttons; remember which stop control had keyboard focus.
      const nodeEvents = element('node-history-events'),
        keyboardStandsAt = keyboardControl(),
        focusedControl =
          keyboardStandsAt instanceof HTMLButtonElement &&
          nodeEvents.contains(keyboardStandsAt)
            ? keyboardStandsAt
            : undefined,
        focusedStop = focusedControl && {
          sequence: focusedControl.dataset.nodeHistorySequence,
          inspect: focusedControl.dataset.inspectNodeHistoryStop === 'true',
        }
      replace(
        'node-history-events',
        // The selected stop's Inspect follows the native session and the captured source, so a change in either must render the list again.
        [
          nodeHistory?.entries ?? [],
          Boolean(recording),
          selectedSequence,
          Boolean(position?.debuggerAvailable),
          position?.sourceAvailable,
          unverifiedStops,
        ],
        () =>
          (nodeHistory?.entries ?? []).map((entry) => {
            const article = document.createElement('article')
            article.className = 'node-history-event'
            const heading = document.createElement('h3')
            heading.textContent =
              entry.type === 'output'
                ? `${entry.channel} · ${(entry.elapsedMs / 1000).toFixed(2)} s`
                : entry.type === 'stop'
                  ? `Debugger stop ${entry.index + 1} · ${entry.source.path}:${entry.source.line}:${entry.source.column}`
                  : `Test result · ${(entry.elapsedMs / 1000).toFixed(2)} s`
            const body = document.createElement('pre')
            body.textContent =
              entry.type === 'output'
                ? entry.text
                : entry.type === 'stop'
                  ? `${entry.frame.name}\n${entry.facts.map((fact) => `${fact.path}: ${fact.display}`).join('\n')}\nHistorical debugger snapshot: ${entry.debuggerSnapshot.frames.length} frames, ${entry.debuggerSnapshot.variables.length} values`
                  : `exitCode=${entry.exitCode ?? 'unknown'} signal=${entry.signal ?? 'none'}\n${entry.outputTail}`
            article.append(heading, body)
            const isSelected = entry.sequence === selectedSequence
            const select = document.createElement('button')
            select.type = 'button'
            select.dataset.nodeHistorySequence = String(entry.sequence)
            select.textContent = isSelected ? 'Selected event' : 'Select event'
            // The selected control stays focusable so keyboard focus survives the press; it then sends nothing.
            select.disabled = Boolean(recording)
            if (isSelected) select.setAttribute('aria-disabled', 'true')
            select.setAttribute('aria-pressed', String(isSelected))
            article.append(select)
            if (entry.type === 'stop') {
              const source = entry.debuggerSnapshot.frames[0]?.source
              if (
                source &&
                source.name === entry.source.path &&
                source.hash === entry.source.hash &&
                source.line === entry.source.line &&
                entry.frame.line === entry.source.line &&
                entry.frame.column === entry.source.column &&
                entry.debuggerSnapshot.frames[0]?.line === entry.frame.line &&
                entry.debuggerSnapshot.frames[0]?.column ===
                  entry.frame.column &&
                // The extension hashed every shown stop's captured text; a mismatch there cannot be inspected either.
                !unverifiedStops.includes(entry.sequence) &&
                !(isSelected && position?.sourceAvailable === false)
              ) {
                const inspect = document.createElement('button')
                inspect.type = 'button'
                inspect.dataset.nodeHistorySequence = String(entry.sequence)
                inspect.dataset.inspectNodeHistoryStop = 'true'
                inspect.textContent =
                  isSelected && position?.debuggerAvailable
                    ? 'Debugger stop selected'
                    : 'Inspect in native debugger'
                // The pressed Inspect stays focusable so keyboard focus survives the press; it then sends nothing.
                inspect.disabled = Boolean(recording)
                if (isSelected && position?.debuggerAvailable)
                  inspect.setAttribute('aria-disabled', 'true')
                inspect.setAttribute(
                  'aria-pressed',
                  String(isSelected && position?.debuggerAvailable),
                )
                article.append(inspect)
              } else {
                const unavailable = document.createElement('p')
                unavailable.className = 'muted'
                unavailable.textContent =
                  'Matching captured source is unavailable for native debugging.'
                article.append(unavailable)
              }
            }
            return article
          }),
      )
      // Keyboard focus returns to the same stop's control after the list was rendered again.
      if (
        focusedControl &&
        focusedStop &&
        !nodeEvents.contains(document.activeElement)
      )
        moveFocusOf(
          focusedControl,
          () =>
            Array.from(
              nodeEvents.querySelectorAll<HTMLButtonElement>(
                'button[data-node-history-sequence]',
              ),
            ).find(
              (control) =>
                control.dataset.nodeHistorySequence === focusedStop.sequence &&
                (control.dataset.inspectNodeHistoryStop === 'true') ===
                  focusedStop.inspect,
            ),
          // As before this rule: the stop's control is brought into view with the focus.
          {},
        )
    }
    for (const link of Array.from(
      document.querySelectorAll<HTMLButtonElement>('.link[data-action]'),
    ))
      link.classList.toggle('visited', visited.has(link.dataset.action ?? ''))
    // A replacement must not expose placeholder facts or actions before its complete host snapshot.
    element('study-content').inert = false
    element('study-content').hidden = false
    element('bootstrap-status').hidden = true
    // Every control is in its state for this message now; a pane without the focus (the learner is in Run and Debug) waits for its next focus event.
    if (document.hasFocus()) payTransportFocus()
    offerClampedTitles()
    // A newly followed pause should reveal its interpretation and facts without requiring a learner scroll past run controls.
    if (shouldRevealFollowedPause && !message.loading) {
      element('live-content').scrollIntoView({
        block: 'start',
        inline: 'nearest',
        behavior: 'instant',
      })
      revealedFollowedObservationId = model.observation?.id
    }
    api.postMessage({
      type: 'rendered',
      revision: message.revision,
      itemId: model.selection.itemId,
      snapshotUri: model.observation?.snapshotUri,
      ...(recording
        ? { presentationRevision: recording.presentationRevision }
        : {}),
      ...(message.presentation
        ? {
            presentationControlRevision:
              message.presentation.presentationControlRevision,
            presentationMode: message.presentation.mode,
          }
        : {}),
    })
  })
  // Added after the listener that handles the message, so every part of the page is in its state for the message.
  window.addEventListener('message', settleFocus)
  /** Tells the host whether this document holds the keyboard focus, which the host cannot ask a webview view; called at the window's focus and blur events and once at load. The host reads the Learning summary's last report when that view is hidden. @example reportFocus(true) */
  const reportFocus = (focused: boolean): void =>
    api.postMessage({ type: 'pane-focus', focused })
  window.addEventListener('focus', () => reportFocus(true))
  window.addEventListener('blur', () => reportFocus(false))
  api.postMessage({ type: 'ready' })
  // A document loaded into a pane that already has the focus gets no focus event.
  if (document.hasFocus()) reportFocus(true)
}

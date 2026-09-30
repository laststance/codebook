import type { projectLearningSummary } from '../utils/projectLearningSummary'
import { randomUUID } from 'node:crypto'
import { installWebviewFocus } from '../runtimeSupport/utils/installWebviewFocus'
import type { StudyCatalogEntry } from '../studySchemas'
import type { LiveStudy, projectStudy } from '../studyModel'
import type { RetainedStudy } from '../retainedStudySchemas'
import type { StudyDescriptor } from '../utils/describeStudy'
import type { PlaybackState, PlaybackBundle } from '../playbackController'
import type {
  NodeTestHistoryIndex,
  NodeTestHistoryLearningDecision,
  NodeTestLearningMaterial,
} from '../nodeTestHistorySchemas'
import type { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import { installShortcutHelp } from '../utils/installShortcutHelp'
import { STUDY_STYLES, STUDY_UI_OPTIONS, STUDY_SHORTCUTS } from './constants'
import type {
  PresentationState,
  PresentationReadingPose,
  PresentationPoseCapture,
  PresentationPoseRestore,
} from '../presentationSchemas'

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
  nodeHistoryCatalog?: Awaited<ReturnType<NodeTestHistoryStore['list']>>
  nodeHistory?: NodeTestHistoryIndex
  nodeHistoryPage?: number
  nodeHistoryPageCount?: number
  nodeHistoryEventCount?: number
  nodeHistoryLearningDecision?: NodeTestHistoryLearningDecision
  nodeHistoryLearningMaterial?: NodeTestLearningMaterial
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
    }
}
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
  getState(): { visited?: string[] } | undefined
  setState(state: unknown): void
}

/** Supplies a nonce-scoped thin reader; {@link StudyWorkspace} posts typed snapshots separately from HTML. @example studyHtml('context') */
export function studyHtml(kind: 'context' | 'moments'): string {
  const nonce = randomUUID()
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src data:;"><style nonce="${nonce}">${STUDY_STYLES}</style></head><body class="${kind === 'moments' ? 'moments-only' : ''}">
<p id="bootstrap-status" class="status" role="status" aria-live="polite">Loading study…</p><main id="study-content" hidden inert>
<header class="learning-header"><p id="reader-kind" class="muted">Codebook study</p><h1 id="title">Codebook study</h1><button type="button" data-shortcut-help aria-label="Keyboard shortcuts" aria-keyshortcuts="?">Keyboard shortcuts <kbd>?</kbd></button></header>
<details id="reader-options" open ${kind === 'moments' ? 'hidden' : ''}><summary>Study view and pane controls</summary><header class="presentation-header"><nav class="row study-read-tools" aria-label="Study pane reading"><button data-action="read-app" aria-label="Read application">App</button><button data-action="read-source" aria-label="Read captured source">Source</button><button data-action="read-context" aria-label="Read explanation">Explanation</button><button data-presentation="restore">Restore</button></nav><details id="presentation-options"><summary>View options</summary><p id="presentation-caption" class="muted mode-caption"></p><div class="row presentation-tools"><button data-action="enlarge-app">Enlarge application</button><button data-action="enlarge-context">Enlarge explanation</button><button data-presentation="save-preference" hidden>Save preference</button></div></details><p id="presentation-status" class="presentation-status" role="status" aria-live="polite"></p></header></details>
<button data-action="return-wiki" hidden>← Return to Wiki</button><button data-action="open-article" hidden>Open article</button><div class="live-strip"><div id="runtime" role="status" aria-live="polite">No running study</div><div class="row"><button data-action="return-current">Return to current pause</button><button class="primary" data-action="continue">Continue inspected pause</button><button data-action="stop">Stop</button></div><small class="muted" id="deadline"></small></div>
<p id="errors" class="error" role="status" aria-live="polite"></p><button data-action="retry" hidden>Retry storage / refresh</button>

<div ${kind === 'moments' ? 'hidden' : ''}>
<section id="learning-material" hidden><h2 id="learning-title"></h2><p id="learning-question" class="muted"></p><p id="learning-summary"></p><p class="muted">Saved path · links inspect recorded stops. Source-derived and unknown steps do not establish execution.</p><div id="learning-sequence"></div></section><p id="learning-unavailable" class="muted" hidden>No processing summary or sequence was saved with this recording.</p>
<div role="tablist" aria-label="Study content"><button id="overview-tab" role="tab" data-tab="overview" aria-controls="overview" aria-selected="true">Overview</button><button id="live-tab" role="tab" data-tab="live" aria-controls="live-content" aria-selected="false" tabindex="-1">Live</button><button id="recording-tab" role="tab" data-tab="recording" aria-controls="live-content" aria-selected="false" tabindex="-1">Recording</button></div>
<div id="loading" class="status" hidden>Loading the selected observation…</div><div id="selected"><div class="status" id="observation"></div><div id="overview" role="tabpanel" aria-labelledby="overview-tab"><h2>Source-derived overview</h2><p id="overview-text"></p><button class="link" data-action="source">Read the linked source</button></div><div id="live-content" role="tabpanel" aria-labelledby="live-tab"><section><h2>Agent interpretation</h2><div id="interpretations" role="region" aria-label="Agent interpretation" tabindex="0"></div></section></div>
<details id="later-annotations" hidden><summary>Later annotations — not available at this recorded time</summary><p class="muted">These explanations were added later. They do not change what was observed in the recording.</p><div id="later-interpretations"></div></details>
<section><div class="row"><button class="link" data-action="source">Captured / source-derived document</button><button class="link" data-action="current-file">Open current file</button></div><p id="source-version" class="muted"></p><p id="source-drift" class="error"></p><label><input id="understood" type="checkbox" aria-describedby="understanding-description"><span><span id="understanding-label">I understand this source revision</span><span id="save-state" class="muted"></span></span></label><p id="understanding-description" class="muted" hidden>Applies to this article and every captured citation shown here.</p><p id="progress" class="muted"></p></section></div>
<section><h2>Source-linked flow</h2><div id="flow"></div><p id="correspondence" class="muted"></p></section>
<details id="study-controls"><summary>Study controls</summary><div id="next-scenario"><div class="row"><button class="primary" data-action="connect">Connect your editor agent</button><button data-action="click">Perform configured action once</button></div><p class="muted" id="profile-description">Ask your editor agent to explain a code path in the open repository.</p></div></details>
<section><h2>Workspace panes</h2><div class="row"><button data-action="focus-app">Focus application</button><button data-action="source">Focus source</button><button data-action="focus-context">Focus explanation</button><button data-action="outline">Show learning outline</button><button data-action="arrange">Restore Study arrangement</button></div></section></div>
<p id="recording-save-state" class="status" role="status" aria-live="polite" hidden></p><details id="evidence-details" hidden><summary id="evidence-summary">Evidence status</summary><p id="study-state" class="status" hidden></p></details>
<section id="node-history"><h2>Node test history</h2><p class="muted">Step through a saved Node test entry selected in Saved studies above. Captured source and native debugger state appear only at verified stops; output and result events clear debugger state. This test has no application video or synchronized application replay.</p><p id="node-history-status" class="status" role="status"></p><p id="node-history-position" class="status" role="status" aria-live="polite"></p><p id="node-history-hint" class="muted" role="status" aria-live="polite"></p><label><input id="node-history-understood" type="checkbox"><span>I understand this test history <span id="node-history-understanding-state" class="muted"></span></span></label><section id="node-history-learning" hidden><h3 id="node-learning-title"></h3><p id="node-learning-question" class="muted"></p><p id="node-learning-summary"></p><div id="node-learning-sequence" aria-label="Node test learning sequence"></div><p class="muted">This learning material describes the saved test journal; it does not create application video or claim synchronized application replay.</p></section><div class="playback-row"><button id="node-history-playback-toggle" class="primary" type="button" data-node-history-playback="play">Play</button><label for="node-history-playhead" class="visually-hidden">Recorded test time</label><div class="timeline-track"><input id="node-history-playhead" type="range" min="0" max="0" step="any" value="0" disabled></div><span id="node-history-playback-position" class="muted">Test journal playback</span></div><p class="muted">Timeline follows recorded test events; application video is unavailable.</p><pre id="node-history-output" aria-label="Recorded test output through selected event"></pre><div class="row"><button id="node-history-moment-previous" type="button">Previous event</button><button id="node-history-moment-next" type="button">Next event</button><span id="node-history-page" class="muted"></span><button id="node-history-previous" type="button">Previous page</button><button id="node-history-next" type="button">Next page</button></div><div id="node-history-events"></div></section>
<section id="observed-moments"><h2>Observed moments</h2><p class="muted" id="moments-caption">Select a captured observation or open Recording to follow its time.</p><div id="moments" class="moments"></div><label for="studies">Saved studies</label><select id="studies" aria-label="Saved study"><option value="">No saved study yet</option></select></section>
<section id="recording-transport" aria-label="Recorded playback" hidden><div class="playback-row"><button type="button" data-shortcut-help aria-label="Keyboard shortcuts" aria-keyshortcuts="?">?</button><button data-playback="start" title="Replay from start" aria-label="Replay from start">↤</button><button id="previous-moment" data-playback="previous" title="Previous recorded stop" aria-label="Previous recorded stop">◀|</button><button class="primary" id="playback-toggle" data-playback="play">Play</button><button id="next-moment" data-playback="next" title="Next recorded stop" aria-label="Next recorded stop">|▶</button><label for="playhead" class="visually-hidden">Recorded position</label><div class="timeline-track"><input id="playhead" type="range" min="0" max="0" step="1" value="0"><div id="history-coverage" role="img" aria-label="Historical source and debugger coverage unknown" hidden></div><span id="history-coverage-label" class="muted">History coverage unknown</span></div><span id="playback-position"></span></div><div class="playback-status-row"><span id="recording-status" role="status" aria-live="polite"></span><details id="playback-options"><summary>Playback details</summary><button data-action="reload-recording">Reload saved recording</button><p>Recorded history only. Playback does not run application code or mark understanding.</p><details id="playback-diagnostics" hidden><summary>Recording error details</summary><p id="playback-diagnostic" class="error"></p></details></details></div><p id="playback-pending" class="muted"></p><p id="playback-reason" class="error"></p><p id="playback-hint" class="muted" role="status" aria-live="polite"></p></section>
</main>
<script nonce="${nonce}">(${installShortcutHelp.toString()})(${JSON.stringify(STUDY_SHORTCUTS)}, '#study-content');(${studyClient.toString()})(${JSON.stringify(STUDY_UI_OPTIONS)}, ${kind === 'context' ? installWebviewFocus.toString() : 'undefined'})</script></body></html>`
}

/** Keeps control DOM stable on state updates so native webview messages do not discard keyboard focus. @example studyClient() */
function studyClient(
  options: typeof STUDY_UI_OPTIONS,
  installFocus?: typeof installWebviewFocus,
): void {
  const api = acquireVsCodeApi(),
    visited = new Set(api.getState()?.visited ?? [])
  installFocus?.(api)
  let current: StudyViewMessage | undefined
  let scrubbing = false
  let nodeHistoryScrubbing = false
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
  const send = (message: object) =>
    api.postMessage({ ...message, revision: current?.revision })
  const button = (action: string) =>
    document.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)
  const text = (id: string, value: string) => {
    const target = element(id)
    if (target.textContent !== value) target.textContent = value
  }
  const renderKeys = new Map<string, string>()
  const replace = (id: string, data: unknown, children: () => Node[]) => {
    const key = JSON.stringify(data)
    if (renderKeys.get(id) !== key) {
      renderKeys.set(id, key)
      element(id).replaceChildren(...children())
    }
  }
  const seconds = (elapsed: number) =>
    `${(elapsed / options.secondMs).toFixed(2)} s`
  const playback = (action: 'play' | 'pause' | 'seek', positionMs?: number) => {
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
  ) => {
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
  ) => {
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
  // Reserve the actual footer height, including expanded recovery details, so reading controls remain reachable.
  new ResizeObserver(() =>
    document.documentElement.style.setProperty(
      '--playback-height',
      `${transport.hidden ? 0 : transport.getBoundingClientRect().height}px`,
    ),
  ).observe(transport)
  const strip = document.querySelector<HTMLElement>('.live-strip')
  // Oversized sticky controls must not hide keyboard focus at narrow widths or enlarged text.
  const adaptStrip = () => {
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
    const selectedStudyId = event.target.value
    const entry = current?.studies.find((study) => study.id === selectedStudyId)
    if (entry?.format === 'node-test-history')
      send({ type: 'node-history', studyId: entry.id })
    else send({ type: 'history', studyId: selectedStudyId })
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
  })
  nodePlayhead.addEventListener('change', () => {
    nodeHistoryPlayback('seek', Number(nodePlayhead.value))
    nodeHistoryScrubbing = false
  })
  element('playhead').addEventListener('pointerdown', () => {
    scrubbing = true
  })
  element('playhead').addEventListener('blur', () => {
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
  const capturePose = (request: PresentationPoseCapture) => {
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
  const restorePose = (message: PresentationPoseRestore) => {
    if (!installFocus || !matchesPose(message)) return
    const reject = () =>
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
  window.addEventListener('message', (event) => {
    const message:
      StudyViewMessage | PresentationPoseCapture | PresentationPoseRestore =
      event.data
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
      text(
        'presentation-status',
        mode.preference.status === 'saving'
          ? 'Layout applied · saving preference…'
          : applying
            ? 'Changing presentation…'
            : (mode.reason ??
              mode.preference.reason ??
              (!mode.layoutConfirmed
                ? 'Layout not confirmed. Restore it or focus a pane below.'
                : '')),
      )
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
    // Offline replay prioritizes its own controls; an independently active runtime keeps its explicit stop/return strip.
    if (strip)
      strip.hidden = !message.liveState || message.liveState === 'stopped'
    element('next-scenario').hidden = Boolean(recording)
    element('study-controls').hidden = Boolean(recording)
    // A visible bottom panel owns transport; closing it restores the summary fallback.
    element('recording-transport').hidden =
      !recording ||
      Boolean(
        message.playbackPanelVisible &&
        !document.body.classList.contains('moments-only'),
      )
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
      text(
        'recording-status',
        recording.readiness === 'failed'
          ? 'Playback stopped — presentation unavailable'
          : pending
            ? 'Loading matching image, source and values…'
            : `${recording.mode === 'playing' ? 'Playing' : 'Paused'} · ${recording.recordingStatus ?? 'Loading recording'}${selectedHistoryGap ? ' · Not recorded at this moment' : ''}`,
      )
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
      text(
        'playback-hint',
        !failed && recording.nativeValuesUninspected
          ? options.nativeValuesHint
          : '',
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
    text(
      'runtime',
      model.currentItemId
        ? `${message.liveTitle ?? liveProfile?.title ?? 'Live study'} — paused at ${model.currentItemTitle}`
        : `${message.liveTitle ?? liveProfile?.title ?? 'Runtime'} — ${message.liveState ?? 'not running'}`,
    )
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
    text('recording-save-state', message.study ? recordingLabel : '')
    element('recording-save-state').hidden = !message.study
    element('evidence-details').hidden = !message.study
    text('evidence-summary', `Evidence status · ${outcomeLabel}`)
    text('errors', message.errors.join('\n'))
    button('retry')!.hidden =
      !message.errors.length &&
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
    element('loading').hidden = !message.loading
    text(
      'loading',
      recording?.readiness === 'failed'
        ? 'Recorded context unavailable. Reload after resolving the reported problem.'
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
          : `${model.observation ? 'Captured source' : 'Source-derived document'} · line ${model.source.line} · ${model.source.hash.slice(0, 12)}`,
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
    const interpretations = model.observation?.interpretations ?? []
    replace('interpretations', [Boolean(recording), interpretations], () =>
      interpretations.length
        ? interpretations.map((value) => {
            const paragraph = document.createElement('p')
            paragraph.className = 'interpretation'
            paragraph.textContent = value.text
            return paragraph
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
    const focusedItem =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset.item
        : undefined
    const focusedRegion = document.activeElement?.parentElement?.id
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
    if (
      focusedItem &&
      (focusedRegion === 'flow' || focusedRegion === 'moments')
    )
      element(focusedRegion)
        .querySelector<HTMLButtonElement>(`[data-item="${focusedItem}"]`)
        ?.focus({ preventScroll: true })
    const studies = element('studies')
    if (studies instanceof HTMLSelectElement) {
      const previous = studies.value
      // Unloaded configured entries must not borrow the selected article's title through a shared profile ID.
      replace('studies', message.studies, () =>
        message.studies.map((study) => {
          const option = document.createElement('option')
          option.value = study.id
          const label =
            study.format === 'node-test-history'
              ? 'Node test history'
              : study.profile === 'repository-browser'
                ? 'Repository browser study'
                : (message.profiles.find(
                    (profile) => profile.id === study.profile,
                  )?.title ?? 'Unknown scenario')
          option.textContent = `${label}${study.format === 'legacy-v1' ? ' (legacy)' : ''} · ${new Date(study.savedAt).toLocaleString()} · ${study.outcome} · ${study.id.slice(-8)}`
          option.disabled = study.metadata === 'unavailable'
          return option
        }),
      )
      studies.value =
        message.nodeHistory?.header.studyId ??
        model.selection.studyId ??
        previous
      const nodeHistories = message.nodeHistoryCatalog ?? []
      const nodeHistory = message.nodeHistory
      text(
        'node-history-status',
        nodeHistory
          ? `${nodeHistory.status}${nodeHistory.reason ? ` · ${nodeHistory.reason}` : ''} · ${nodeHistory.entries.length} verified events. Test output is the recorded surface; application video and synchronized application replay are unavailable.`
          : nodeHistories.length
            ? 'Choose a Node test history from Saved studies above to inspect its verified output and debugger stops.'
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
        if (!nodeHistoryScrubbing)
          nodePlayhead.value = String(
            playbackState.positionMs ?? playbackState.startMs,
          )
      } else {
        nodePlayhead.min = '0'
        nodePlayhead.max = '0'
        nodePlayhead.value = '0'
      }
      if (!nodeHistoryScrubbing)
        text(
          'node-history-playback-position',
          playbackState?.positionMs === undefined
            ? 'Test journal playback'
            : `Recorded test time · ${(playbackState.positionMs / options.secondMs).toFixed(2)} s`,
        )
      const momentDescription =
        position?.type === 'stop'
          ? `Debugger stop ${(position.index ?? 0) + 1}${position.debuggerAvailable ? '' : ' · captured source unavailable'}`
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
      replace(
        'node-history-events',
        [nodeHistory?.entries ?? [], Boolean(recording), selectedSequence],
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
            select.disabled = Boolean(recording || isSelected)
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
                entry.debuggerSnapshot.frames[0]?.column === entry.frame.column
              ) {
                const inspect = document.createElement('button')
                inspect.type = 'button'
                inspect.dataset.nodeHistorySequence = String(entry.sequence)
                inspect.dataset.inspectNodeHistoryStop = 'true'
                inspect.textContent =
                  isSelected && position?.debuggerAvailable
                    ? 'Debugger stop selected'
                    : 'Inspect in native debugger'
                inspect.disabled = Boolean(
                  recording || (isSelected && position?.debuggerAvailable),
                )
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
    }
    for (const link of Array.from(
      document.querySelectorAll<HTMLButtonElement>('.link[data-action]'),
    ))
      link.classList.toggle('visited', visited.has(link.dataset.action ?? ''))
    // A replacement must not expose placeholder facts or actions before its complete host snapshot.
    element('study-content').inert = false
    element('study-content').hidden = false
    element('bootstrap-status').hidden = true
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
  api.postMessage({ type: 'ready' })
}

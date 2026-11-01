import {
  PANE_RETURN_PRESS_WINDOW_MS,
  PLAYBACK_PAGE_STEP_MS,
  MILLISECONDS_PER_SECOND,
  REPLAY_COVERED_LABEL,
  REPLAY_DEBUG_SESSION_NAME,
  PRESENTATION_MODE_IDS,
  STUDY_PRESENTATIONS,
  PRESENTATION_READING_ANCHORS,
  PRESENTATION_READING_DETAILS,
  PRESENTATION_READING_VISITED,
  PRESENTATION_FOCUS_IDS,
  PRESENTATION_FOCUS_ACTIONS,
  STUDY_REMOVAL_REFUSALS,
  STUDY_REMOVAL_REFUSALS_WITHOUT_TRASH,
  STUDY_REMOVAL_EXTENSION_HISTORY_REFUSAL,
  STUDY_REMOVAL_SERVER_HISTORY_REFUSAL,
  STUDY_REMOVAL_WITHOUT_TRASH_MESSAGE,
} from '../constants'
import { NODE_EXTENSION_REPLAY_TEXT } from '../utils/describeExtensionReplay'
import { NODE_SERVER_REPLAY_TEXT } from '../utils/describeNodeServerReplay'
import { NODE_TEST_REPLAY_TEXT } from '../utils/describeNodeTestReplay'
import type { ShortcutHelpEntry } from '../utils/installShortcutHelp'
const STUDY_FOCUS_MARGIN_PX = 4
const STUDY_COMPACT_READER_MAX_WIDTH_PX = 759
/** The height a test replay's sequence diagram takes in its Learning summary before its own area scrolls (DS-B), so the moment block starts in the first viewport at the measured summary sizes (VS Code 298 × 885 px, Cursor 440 × 965 px); the whole drawing stays reachable by that area's scroll. */
const TEST_REPLAY_DIAGRAM_MAX_HEIGHT_PX = 150
const STUDY_SEQUENCE_LAYOUT = {
  minWidthPx: 320,
  columnWidthPx: 160,
  topPaddingPx: 72,
  rowHeightPx: 64,
  nameYpx: 24,
  // The width of one character of the diagram's 12 px text by kind and the room a name or label leaves at both sides of its box; a line holds the characters whose widths fit in (box width - padding) (F206, F293); the widths below estimate a diagram that cannot measure its text. A Japanese, Chinese or Korean glyph and a full-width form is about one em wide, an upper-case Latin letter wider than a lower-case one.
  fontSizePx: 12,
  charWidthPx: 6.5,
  wideCharWidthPx: 13,
  upperCharWidthPx: 8.5,
  columnPaddingPx: 16,
  nameLineHeightPx: 14,
  lifelineYpx: 66,
  firstArrowYpx: 92,
  loopWidthPx: 36,
  loopHeightPx: 20,
  arrowWidthPx: 7,
  arrowHeightPx: 5,
  numberGapPx: 8,
}
/** The shared slider while it shows a browser recording: the page marks it `data-replay-family="test"` during a test replay (DS-C), so each family's shortcut entries name only its own slider. */
const BROWSER_PLAYHEAD_SELECTOR = '#playhead:not([data-replay-family="test"])'
/** The shared slider while it shows a test replay. */
const TEST_PLAYHEAD_SELECTOR =
  '#playhead[data-replay-family="test"]:not([data-replay-profile="node-server"])'
/** The shared slider while it shows a server replay: the page marks it with its profile, so a server replay's shortcut entries name a server replay and never a test. */
const SERVER_PLAYHEAD_SELECTOR =
  '#playhead[data-replay-family="test"][data-replay-profile="node-server"]'
/** The test replay timeline's keys (C2 and DS-C): arrows step by event, Page keys by stop (Page Up forward, as for a recording), Home and End select the first and last event. */
const TEST_REPLAY_TIMELINE_SHORTCUTS: ShortcutHelpEntry[] = (
  [
    ['Previous event', '← / ↓'],
    ['Next event', '→ / ↑'],
    ['Previous stop', 'Page Down'],
    ['Next stop', 'Page Up'],
    ['First event', 'Home'],
    ['Last event', 'End'],
  ] as const
).map(([action, keys]) => ({
  action,
  keys,
  context: 'Focused test replay timeline',
  selector: TEST_PLAYHEAD_SELECTOR,
}))
/** The server replay timeline's keys: the test replay's, under the server replay's own name and slider. */
const SERVER_REPLAY_TIMELINE_SHORTCUTS: ShortcutHelpEntry[] =
  TEST_REPLAY_TIMELINE_SHORTCUTS.map((entry) => ({
    ...entry,
    context: 'Focused server replay timeline',
    selector: SERVER_PLAYHEAD_SELECTOR,
  }))
export const STUDY_SHORTCUTS: ShortcutHelpEntry[] = [
  {
    action: 'Keyboard shortcuts',
    keys: '?',
    context: 'Codebook, outside text inputs',
    selector: '[data-shortcut-help]',
  },
  {
    action: 'Close keyboard shortcuts',
    keys: 'Esc',
    context: 'Keyboard shortcuts dialog',
  },
  {
    action: 'Seek backward one second',
    keys: '← / ↓',
    context: 'Focused recording timeline',
    selector: BROWSER_PLAYHEAD_SELECTOR,
  },
  {
    action: 'Seek forward one second',
    keys: '→ / ↑',
    context: 'Focused recording timeline',
    selector: BROWSER_PLAYHEAD_SELECTOR,
  },
  {
    action: `Seek backward ${PLAYBACK_PAGE_STEP_MS / MILLISECONDS_PER_SECOND} seconds`,
    keys: 'Page Down',
    context: 'Focused recording timeline',
    selector: BROWSER_PLAYHEAD_SELECTOR,
  },
  {
    action: `Seek forward ${PLAYBACK_PAGE_STEP_MS / MILLISECONDS_PER_SECOND} seconds`,
    keys: 'Page Up',
    context: 'Focused recording timeline',
    selector: BROWSER_PLAYHEAD_SELECTOR,
  },
  {
    action: 'Seek recording start',
    keys: 'Home',
    context: 'Focused recording timeline',
    selector: BROWSER_PLAYHEAD_SELECTOR,
  },
  {
    action: 'Seek recording end',
    keys: 'End',
    context: 'Focused recording timeline',
    selector: BROWSER_PLAYHEAD_SELECTOR,
  },
  ...TEST_REPLAY_TIMELINE_SHORTCUTS,
  ...SERVER_REPLAY_TIMELINE_SHORTCUTS,
  {
    action: 'Previous / next content tab',
    keys: '← / →',
    context: 'Focused content tabs',
    selector: '[role="tab"]',
  },
  {
    action: 'First / last content tab',
    keys: 'Home / End',
    context: 'Focused content tabs',
    selector: '[role="tab"]',
  },
]
const TIMELINE_FULL_WIDTH_PERCENT = 100
// What brings a recorded moment back while another tab is in front of the recorded application: the second sentence of the summary's line, and alone what a screen reader hears after the transport's status has said the label.
const APPLICATION_COVERED_ANNOUNCEMENT =
  'Bring the Recorded application tab to the front to show this moment again.'
/**
 * The words of a timeline coverage strip's accessible name and marks, shared by the browser transport and the test replay transport (the String catalog); the pane's client code imports nothing, so they arrive through {@link STUDY_UI_OPTIONS}.
 * The client words a name from them: `<n> <gap or gaps>: <times>; <n> <stop or stops>: <times>`.
 */
const TIMELINE_COVERAGE_TEXT = {
  /** The strip's accessible name when no coverage is known. */
  unknownName: 'Historical source and debugger coverage unknown',
  gapSingular: 'source/debugger history gap',
  gapPlural: 'source/debugger history gaps',
  stopSingular: 'recorded stop',
  stopPlural: 'recorded stops',
  /** The tooltip of a gap span, before its times. */
  gapTitle: 'Not recorded at this moment',
  /** The tooltip of a recorded stop tick, before its time. */
  stopTitle: 'Recorded source and debugger',
} as const
export const STUDY_UI_OPTIONS = {
  /** A test replay's fixed words (the String catalog); the pane's client code imports nothing, so they arrive here. */
  testReplay: NODE_TEST_REPLAY_TEXT,
  /** A server replay's fixed words, with the same keys; the pane switches to them while a server replay is shown. */
  serverReplay: NODE_SERVER_REPLAY_TEXT,
  /** An Extension replay's fixed words, with the same keys; the pane switches to them while an Extension replay is shown. */
  extensionReplay: NODE_EXTENSION_REPLAY_TEXT,
  /** The words of both transports' coverage strips. */
  coverage: TIMELINE_COVERAGE_TEXT,
  sequence: STUDY_SEQUENCE_LAYOUT,
  maxStickyFraction: 0.35,
  compactReaderMaxWidthPx: STUDY_COMPACT_READER_MAX_WIDTH_PX,
  secondMs: MILLISECONDS_PER_SECOND,
  pageStepMs: PLAYBACK_PAGE_STEP_MS,
  timelineFullWidthPercent: TIMELINE_FULL_WIDTH_PERCENT,
  readingAnchors: PRESENTATION_READING_ANCHORS,
  readingDetails: PRESENTATION_READING_DETAILS,
  readingVisited: PRESENTATION_READING_VISITED,
  focusIds: PRESENTATION_FOCUS_IDS,
  focusActions: PRESENTATION_FOCUS_ACTIONS,
  presentations: PRESENTATION_MODE_IDS.map((mode) => ({
    mode,
    title: STUDY_PRESENTATIONS[mode].title,
    description: STUDY_PRESENTATIONS[mode].description,
  })),
  studyRemovalRefusals: STUDY_REMOVAL_REFUSALS,
  // Stand where the reasons above stand in a window with a Trash: a window without one deletes nothing and lists the chosen study's files under "Remove by hand".
  studyRemovalRefusalsWithoutTrash: STUDY_REMOVAL_REFUSALS_WITHOUT_TRASH,
  // Why a server replay cannot be deleted, in the words of a window with a Trash and of one without.
  serverHistoryRefusal: STUDY_REMOVAL_SERVER_HISTORY_REFUSAL,
  // The note under the Saved studies list for a chosen entry that cannot be opened, and for one whose catalog checkpoint can be repaired: each says what is wrong and what the learner can still do in a window with a Trash and in one without.
  studyNotes: {
    unopenable: {
      withTrash: 'This saved study cannot be opened. It can still be deleted.',
      withoutTrash:
        'This saved study cannot be opened. This window has no Trash, so it can only be removed by hand.',
    },
    repairable: {
      withTrash:
        "This saved study's catalog checkpoint is missing or out of date. Repair it, or delete the study.",
      withoutTrash:
        "This saved study's catalog checkpoint is missing or out of date. Repair it, or remove its files by hand.",
    },
  },
  // What the "Remove by hand" disclosure says inside: while the host is asked for the chosen study's files, above the files it listed, when it listed none, and under Copy paths when the clipboard took nothing.
  studyFiles: {
    listing: "Listing this study's files…",
    listed: STUDY_REMOVAL_WITHOUT_TRASH_MESSAGE,
    noneLeft:
      'No file of this study is left. Press Retry storage / refresh to update the list.',
    copyFailed:
      'Could not copy the paths. Select them in the list above and copy them by hand.',
  },
  // The name that makes the replay transport's section a landmark. The pane gives it only while it shows the transport: the section stays rendered and empty otherwise, and an unnamed section is no landmark.
  replayTransportLabel: 'Recorded playback',
  // The 5A button of the transport's status row (Cycle 0051, DS-E): its visible label is the name PRODUCT_GOAL.md gives it, and its accessible name and tooltip say what pressing it does, containing the label (WCAG 2.5.3).
  learningSummaryButton: 'Learning summary',
  showLearningSummary: 'Show learning summary',
  // The shared slider's tooltip while it shows a test replay, in the format of the recording timeline's tooltip, so the tooltip, the shortcut list and the keys agree (D035).
  testReplayTimelineTitle: TEST_REPLAY_TIMELINE_SHORTCUTS.map(
    (entry) => `${entry.action} — ${entry.keys} (${entry.context})`,
  ).join('; '),
  // The same tooltip while the slider shows a server replay: its own name for the context, never `test`.
  serverReplayTimelineTitle: SERVER_REPLAY_TIMELINE_SHORTCUTS.map(
    (entry) => `${entry.action} — ${entry.keys} (${entry.context})`,
  ).join('; '),
  // The same tooltip while the slider shows an Extension replay: its own name for the context.
  extensionReplayTimelineTitle: TEST_REPLAY_TIMELINE_SHORTCUTS.map(
    (entry) =>
      `${entry.action} — ${entry.keys} (Focused Extension replay timeline)`,
  ).join('; '),
  // Why an Extension replay cannot be deleted yet, in the words of a window with a Trash and of one without.
  extensionHistoryRefusal: STUDY_REMOVAL_EXTENSION_HISTORY_REFUSAL,
  // The shared slider's keyboard shortcuts while it shows a test replay, for its `aria-keyshortcuts`.
  testReplayTimelineKeys:
    'ArrowLeft ArrowRight ArrowUp ArrowDown PageUp PageDown Home End',
  playbackFailureRecovery:
    'Reload the saved recording to try again. If it still fails, ask your agent for a new recording.',
  nativeValuesHint: `Recorded values for this moment are not loaded yet. Show Variables opens Run and Debug and expands them; if the first scope stays closed, expand it. If Call Stack lists several sessions, select “${REPLAY_DEBUG_SESSION_NAME}” first.`,
  // While another tab is in front of the recorded application: Run and Debug's own label in the transport's status, the summary's sentence with what brings the moment back, and that remedy alone for the transport's second status region, so a screen reader hears the label once.
  applicationCovered: {
    label: REPLAY_COVERED_LABEL,
    remedy: `${REPLAY_COVERED_LABEL}. ${APPLICATION_COVERED_ANNOUNCEMENT}`,
    announcement: APPLICATION_COVERED_ANNOUNCEMENT,
  },
  // How long after the window's focus event a press still counts as the press the learner returned to the pane with.
  returnPressWindowMs: PANE_RETURN_PRESS_WINDOW_MS,
  // Where the keyboard focus goes when a Show Variables button leaves while it holds the focus: Play, else the first of these that is shown and enabled.
  replayTransportFocus: [
    '#playback-toggle',
    '[data-playback="start"]',
    '#previous-moment',
    '#next-moment',
    '#playhead',
    // A test replay's event steps, shown for that family only.
    '#previous-event',
    '#next-event',
  ],
  // Where a lost focus goes in a test replay's Learning summary when no disclosure around the control that left is shown (DS-E): the moment block's step heading, else the summary's title heading, both focusable by script only.
  summaryFocusFallback: ['#node-history-step-heading', '#title'],
}
export const STUDY_STYLES = `
.shortcut-dialog{width:min(640px,90vw);max-height:85vh;overflow:auto;background:var(--vscode-editor-background,#181818);color:var(--vscode-foreground,#ddd);border:1px solid var(--vscode-panel-border,#777);border-radius:8px;padding:20px}.shortcut-dialog::backdrop{background:rgb(0 0 0 / .5)}.shortcut-dialog input{display:block;width:100%;padding:10px;margin:16px 0;background:var(--vscode-input-background,#333);color:var(--vscode-input-foreground,#fff);border:1px solid var(--vscode-input-border,#777)}.shortcut-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid var(--vscode-panel-border,#444)}.shortcut-list section{padding:12px 0;border:0}.shortcut-list h3{font-size:13px;color:var(--vscode-descriptionForeground,#aaa);margin:0 0 8px}kbd{font:inherit;white-space:nowrap;border:1px solid var(--vscode-panel-border,#777);border-radius:4px;padding:2px 6px}.shortcut-tooltip{position:fixed;z-index:10;left:16px;right:16px;bottom:12px;max-height:40vh;overflow:auto;padding:8px 12px;background:var(--vscode-editorHoverWidget-background,#333);color:var(--vscode-editorHoverWidget-foreground,#fff);border:1px solid var(--vscode-editorHoverWidget-border,#777);pointer-events:none}

/* The presentation status stands under the "Study view and pane controls" disclosure, not inside it: a closed disclosure renders nothing of what it holds, and a status region must exist before its first text. */
.presentation-header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:8px 12px;padding-bottom:12px;border-bottom:1px solid var(--vscode-panel-border,#444)}#reader-options{margin-bottom:8px}#reader-options>summary{font-weight:600}.study-read-tools{grid-column:1/-1}.presentation-header h1{grid-column:1/-1;margin:0}.presentation-header label{margin:0;align-items:center;min-width:0}.presentation-header select{width:100%;min-width:0}.presentation-status{margin:0 0 8px}.presentation-tools{gap:8px}.mode-caption{margin:4px 0 8px}#presentation-options{min-width:0}#presentation-options>summary{white-space:nowrap}#presentation-options[open]{grid-column:1/-1;grid-row:4}.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}#evidence-details{margin:12px 0}@media(min-width:760px){.presentation-header{grid-template-columns:minmax(12ch,1fr) minmax(220px,auto) auto;align-items:center}.presentation-header h1{grid-column:auto}#presentation-options[open]{grid-row:3}}body[data-presentation=living-book] #selected{max-width:72ch;margin-inline:auto}body[data-presentation=living-book] #overview-text{font-size:18px;line-height:1.6}body[data-presentation=guided-walkthrough] #flow{gap:8px}body[data-presentation=guided-walkthrough] #flow button{padding:8px 12px;border:1px solid var(--vscode-panel-border,#444)}@media(min-width:760px){body[data-presentation=guided-walkthrough] #live-content{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:24px}}#study-controls{margin:12px 0}#study-controls>summary{font-weight:600}
#playhead{width:100%;min-height:44px;accent-color:var(--vscode-focusBorder,#007fd4)}#recording-transport{padding:12px 0}#playback-position{font-variant-numeric:tabular-nums}button,select,summary{min-height:44px}summary{cursor:pointer;padding:10px 0}summary:focus-visible,#interpretations:focus-visible{outline:2px solid var(--vscode-focusBorder,#007fd4)}details[open]{padding-bottom:12px}@media(max-width:${STUDY_COMPACT_READER_MAX_WIDTH_PX}px){body[data-content-tab=live] .live-strip{position:static}body[data-content-tab=live] #interpretations{max-height:30vh;overflow:auto;overscroll-behavior:contain}}
/* A status region stays rendered while it is empty and takes no room, so its first text changes a region assistive technology already knows; only lines that are no status region leave the page while empty. */
.error:empty:not([role=status]){display:none}[role=status]:empty{margin:0;padding:0;border:0}#observation{border:0;padding:0;margin:8px 0 12px;color:var(--vscode-descriptionForeground,#aaa)}@media(min-width:900px){.live-strip{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:4px 12px}.live-strip>.row{justify-content:flex-end}.live-strip>#deadline{grid-column:1/-1}}
:root{color-scheme:light dark;font-family:var(--vscode-font-family,system-ui);color:var(--vscode-foreground,#d4d4d4);background:var(--vscode-editor-background,#181818);font-size:16px;line-height:1.5;scroll-padding-top:calc(var(--codebook-sticky-height,0px) + ${STUDY_FOCUS_MARGIN_PX}px);scroll-padding-bottom:calc(var(--playback-height,0px) + ${STUDY_FOCUS_MARGIN_PX}px)}
#save-state{display:block;margin-top:4px}#flow{display:flex;flex-wrap:wrap;gap:8px 16px}.live-strip.flowing{position:static}[role=tablist]{flex-wrap:wrap}[role=tab]{overflow-wrap:normal}
/* The host styles body directly; inherit the reading scale explicitly. */
/* Titles keep twelve characters per line: body wraps anywhere, and a pane squeezed during arrangement would show them one character per line. */
*{box-sizing:border-box}body{margin:0;padding:16px;overflow-wrap:anywhere;font-size:inherit;line-height:inherit}h1{font-size:20px;line-height:1.25;margin:16px 0 8px;min-width:12ch}h2{font-size:16px;margin:0 0 12px}p{margin:8px 0 16px}button,input,select{font:inherit}button{cursor:pointer;padding:6px 10px;border:1px solid var(--vscode-button-border,var(--vscode-contrastBorder,transparent));border-radius:4px;background:var(--vscode-button-secondaryBackground,#333);color:var(--vscode-button-secondaryForeground,#eee)}button.primary{background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff)}button:hover:not(:disabled):not([aria-disabled=true]){filter:brightness(1.12)}button:disabled,button[aria-disabled=true]{opacity:.6;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--vscode-focusBorder,#007fd4);outline-offset:2px}.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.muted{color:var(--vscode-descriptionForeground,#aaa)}.status{border:1px solid var(--vscode-contrastBorder,var(--vscode-panel-border,#555));padding:8px 12px;margin:12px 0}.error{color:var(--vscode-editorError-foreground,var(--vscode-foreground,#d4d4d4));white-space:pre-wrap}section{padding:20px 0;border-bottom:1px solid var(--vscode-panel-border,#444)}[role=tablist]{display:flex;gap:8px;border-bottom:1px solid var(--vscode-panel-border,#444);padding-bottom:12px}[role=tab][aria-selected=true]{border-bottom:3px solid var(--vscode-focusBorder,#007fd4)}.link{background:none;border:0;color:var(--vscode-textLink-foreground,#4daafc);text-decoration:underline;padding:4px 0}.link.visited{color:var(--vscode-textLink-activeForeground,#9b8cdd)}label{display:flex;align-items:flex-start;gap:12px;margin:12px 0}input[type=checkbox]{width:20px;height:20px;accent-color:var(--vscode-focusBorder,#007fd4)}.interpretation{white-space:pre-wrap}img{display:block;max-width:100%;height:auto;border:1px solid var(--vscode-panel-border,#444)}.moments{display:flex;gap:8px;flex-wrap:wrap}.moments button[aria-current=true]{outline:2px solid var(--vscode-focusBorder,#007fd4)}.live-strip{position:sticky;top:0;z-index:1;padding:12px;background:var(--vscode-editor-background,#181818);border-bottom:1px solid var(--vscode-panel-border,#444)}body.moments-only{padding:8px 16px}body.moments-only .live-strip{position:static;padding:0 0 8px}body.moments-only section{padding:8px 0}select{max-width:100%;padding:6px;background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);border:1px solid var(--vscode-dropdown-border,#666)}[hidden]{display:none!important}@media(max-width:360px){body{padding:12px}.row{gap:8px}}body.vscode-high-contrast button,body.vscode-high-contrast-light button{border-color:var(--vscode-contrastBorder)}
.learning-header{margin-bottom:12px}.learning-header p{margin:0}.learning-header h1{margin:4px 0 8px}
/* During a replay the bottom panel shows the transport alone. The live strip and the recording's save state are left out there by their own emptiness, not by this rule: both are status regions, which stay rendered so that their text, written when the replay is left, changes a region that exists. */
body.moments-only[data-replay=true] .learning-header,body.moments-only[data-replay=true] #observed-moments,body.moments-only[data-replay=true] #saved-studies,body.moments-only[data-replay=true] [data-action="open-article"],body.moments-only[data-replay=true] [data-action="return-wiki"],body.moments-only[data-replay=true] #evidence-details{display:none}
/* Application replay owns the bottom transport; unrelated Node controls leave while their empty status regions remain rendered. */
body.moments-only[data-replay=true] #node-history{padding:0;margin:0;border:0}body.moments-only[data-replay=true] #node-history>:not([role=status]){display:none}
body[data-replay=true]{padding-bottom:calc(var(--playback-height,150px) + 20px)}
body[data-replay=true] #recording-transport{position:fixed;z-index:3;bottom:0;left:0;right:0;margin:0;padding:10px 16px;border-top:1px solid var(--vscode-panel-border,#444);background:var(--vscode-editor-background,#181818);max-height:60vh;overflow:auto}
/* While the recovery details are open the summary above keeps at least 60% of the pane; the closed footer may grow to 60vh, so the values hint never makes it scroll. The bottom panel's transport is not bounded. */
body[data-replay=true]:not(.moments-only) #recording-transport:has(#playback-options[open]){max-height:40vh}
body.moments-only[data-replay=true] #study-content{display:flex;flex-direction:column}
body.moments-only[data-replay=true] #recording-transport{order:-1;position:sticky;top:0;max-height:none;overflow:visible;padding:0;border-top:0}
/* The bottom panel is wide and short: the values hint and its button share one row there, so the button, 44 px high like the status row above it, stays inside a panel 180 px high. Every other part of the transport keeps a row of its own. */
body.moments-only #recording-transport{display:flex;flex-wrap:wrap;align-items:center}body.moments-only #recording-transport>*{flex:0 0 100%;min-width:0}body.moments-only #recording-transport>#playback-hint{flex:1 1 60%}body.moments-only #recording-transport>#playback-show-variables{flex:none;margin-left:12px}
.playback-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.playback-row button{min-height:32px;padding:4px 8px}.playback-row #playhead{flex:1;min-width:80px;width:auto;min-height:32px}.playback-row #playback-position{font-size:12px;white-space:nowrap}#playback-show-variables{margin:6px 0}
.timeline-track{position:relative;flex:1;min-width:100px;display:flex;flex-direction:column;align-items:stretch}.timeline-track #playhead{width:100%;flex:none}.timeline-track #history-coverage,.timeline-track .history-coverage{position:relative;height:6px;margin:0 8px;overflow:hidden;background:var(--vscode-panel-border,#555)}.timeline-track .history-gap{position:absolute;top:0;bottom:0;background:repeating-linear-gradient(135deg,var(--vscode-editorWarning-foreground,#d7ba7d) 0 3px,transparent 3px 6px)}.timeline-track .history-stop{position:absolute;top:0;bottom:0;width:3px;background:var(--vscode-focusBorder,#007fd4)}#history-coverage-label,.history-coverage-label{font-size:11px;line-height:1.2}
.playback-status-row{display:flex;justify-content:space-between;gap:12px;align-items:start;font-size:12px}.playback-status-row summary{padding:13px 0}.playback-status-row>#recording-status{margin-top:13px}body.moments-only .playback-status-row{flex-wrap:wrap;row-gap:0}body.moments-only #application-covered-remedy{order:1;flex-basis:100%}.playback-status-row p{margin:8px 0}#playback-pending:empty,#playback-reason:empty{display:none}#playback-hint:empty,#node-history-hint:empty{margin:0}#playback-pending,#playback-reason,#playback-hint,#node-history-hint{margin:6px 0 0;font-size:12px}
/* The live strip and the replay transport stay in the page while this pane does not show them, so the status regions inside exist before their first text. Each shows nothing and takes no room exactly while its own status is empty: #runtime for the strip, #recording-status for the transport. */
.live-strip:has(>#runtime:empty),#recording-transport:has(#recording-status:empty){padding:0;border:0}.live-strip:has(>#runtime:empty)>:not(#runtime),#recording-transport:has(#recording-status:empty)>:not(.playback-status-row,[role=status]),#recording-transport:has(#recording-status:empty) #playback-options,#recording-transport:has(#recording-status:empty) #show-learning-summary{display:none}.playback-status-row>#recording-status:empty{margin:0}

#saved-studies select{width:100%}#delete-study-row,#study-unopenable,#study-newer,#study-repairable,#delete-study-reason,#delete-study-status,#study-files{margin:8px 0 0}#delete-study-reason:empty{display:none}#delete-study-status:empty{margin:0}#study-files-list{margin:0 0 8px;padding-left:20px}#study-files-note{margin:0 0 8px}#copy-study-files-status{margin:8px 0 0}#copy-study-files-status:empty{margin:0}
#learning-summary,.sequence-steps p{white-space:pre-wrap}.sequence-diagram{overflow:auto;max-height:420px;border:1px solid var(--vscode-panel-border,#444);padding:8px}.sequence-diagram svg{display:block;max-width:none;font-size:12px}.sequence-diagram text{fill:var(--vscode-foreground,#ddd)}.sequence-lifeline{stroke:var(--vscode-descriptionForeground,#aaa);stroke-dasharray:4 4}.sequence-arrow{fill:none;stroke:var(--vscode-textLink-foreground,#4daafc);stroke-width:2}.sequence-arrow.source-derived{stroke-dasharray:6 4}.sequence-arrow.unknown{stroke-dasharray:2 5;stroke:var(--vscode-descriptionForeground,#aaa)}.sequence-steps{padding-left:24px}.sequence-steps li{padding:10px 0}.sequence-steps p{margin:6px 0}.sequence-steps [aria-current=true]{font-weight:bold}
/* Each event card's text wraps inside the reader, and scrolls there if a line still cannot, instead of widening the page (Cycle 0044, 0031-W1 and 0038-W). */
.node-history-event pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;overflow:auto}
/* A test replay's transport stays in view while its summary and steps scroll under it (DS16); Previous stop and Next stop lead it (DS12). */
#node-history-moment p{margin:4px 0}#node-history-explanation:empty,#node-history-not-recorded:empty,#node-history-unverified:empty,#node-history-capture-reason:empty{display:none}.same-moment{color:var(--vscode-descriptionForeground,#aaa);font-size:12px}
#node-history-moment>p:empty{margin:0;padding:0;border:0}
#node-learning-title{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}#node-learning-title:focus{display:block;overflow:visible}#node-learning-title:focus-visible,#test-output-test:focus-visible,#test-output-request-line:focus-visible{outline:2px solid var(--vscode-focusBorder,#007fd4);outline-offset:2px}
/* A test replay's Learning summary (Cycle 0051, DS-B, DS-E): long texts clamped to three lines with Show more, a capped diagram, the moment's step heading, the drawing's step mark (not color alone) and the summary's focusable headings. */
.clamp{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}.clamped-text>p{margin:4px 0}.clamped-text>.show-more{min-height:24px;padding:0;margin:0 0 8px}#node-learning-sequence .sequence-diagram{max-height:${TEST_REPLAY_DIAGRAM_MAX_HEIGHT_PX}px}.sequence-diagram text.current-step{fill:var(--vscode-textLink-foreground,#4daafc);font-weight:600;text-decoration:underline}.sequence-arrow.current-step{stroke-width:3}#node-history-step-heading{font-size:14px;margin:8px 0 4px}#node-history-step-heading:focus-visible,#title:focus-visible{outline:2px solid var(--vscode-focusBorder,#007fd4);outline-offset:2px}body[data-replay=true] #node-history-heading{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
/* A test replay's summary leads with its own content (DS-B): the learning title has no section padding of its own, and the article's pane controls follow the summary instead of standing above it. */
#node-history-learning{padding:0;border:0}body[data-replay-family=test] #node-history{padding-top:0}#node-learning-title{margin-top:0}body[data-replay-family=test] .learning-header{display:flex;flex-wrap:wrap;align-items:start;gap:0 8px}body[data-replay-family=test] #reader-kind{flex-basis:100%}body[data-replay-family=test] .learning-header h1{flex:1}body[data-replay-family=test] .learning-header [data-shortcut-help]{flex:none}body[data-replay-family=test] #study-content{display:flex;flex-direction:column}body[data-replay-family=test] #study-content>div:has(>#content-tabs){order:1}
/* The shared transport's event group wraps as one: it takes its own line before the slider shrinks below its minimum width (DS-C); the 5A button ends the status row, apart from the move controls. */
.playback-events{display:inline-flex;gap:6px;flex:none}.playback-status-row #show-learning-summary{flex:none;margin-left:auto;min-height:32px;padding:4px 8px}
/* A test replay's Application pane: the header and footer stay pinned and the output region is the only scroller (DS4); a standard-error line starts with a mark in the terminal's red, and the mark, never the color alone, says so. */
body.test-output{height:100vh;padding:0;overflow:hidden}body.test-output main{display:flex;flex-direction:column;height:100%;min-height:0;padding:12px 16px}#test-output-test,#test-output-request-line{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}#test-output-test:focus,#test-output-request-line:focus{display:block;overflow:visible}.server-region{flex:none;margin:4px 0;padding:8px 0}#test-output-response-body{max-height:30vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0;padding:8px;border:1px solid var(--vscode-panel-border,#444)}#test-output-response-body:focus-visible{outline:2px solid var(--vscode-focusBorder,#007fd4)}#test-output-response-state{overflow-wrap:anywhere}#test-output{flex:1;min-height:0;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0;padding:8px;border:1px solid var(--vscode-panel-border,#444)}#test-output:focus-visible{outline:2px solid var(--vscode-focusBorder,#007fd4)}.stderr-mark{color:var(--vscode-terminal-ansiRed,#f14c4c)}#test-output-jump{align-self:flex-start}body.test-output p{margin:4px 0}
/* A Learning summary in a narrow side bar keeps a long title to two lines and its sequence in view; the full title stays in its tooltip, and a title the clamp cuts is a tab stop that is shown whole while it has the keyboard focus. A wider summary shows the title whole. */
#title:focus-visible,#learning-title:focus-visible{outline:2px solid var(--vscode-focusBorder,#007fd4);outline-offset:2px}
/* Compact replay keeps its empty header spacing; a disclosed layout notice uses the shared gap. */
@media(max-width:420px){#learning-title{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}#learning-title:focus,body[data-replay=true] .learning-header h1:focus{display:block;overflow:visible}body[data-replay=true]{padding-top:8px;padding-left:12px;padding-right:12px}body[data-replay=true] .learning-header{margin-bottom:4px}body[data-replay=true] #reader-kind{display:none}body[data-replay=true] .learning-header h1{font-size:16px;margin:0 0 4px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}body[data-replay=true] #reader-options{margin-bottom:4px}body[data-replay=true] #reader-options:has(+ #presentation-status:not(:empty)){margin-bottom:8px}body[data-replay=true] #reader-options>summary{font-size:13px}body[data-replay=true] #learning-material h2{margin:0 0 4px}body[data-replay=true] #learning-material p{margin:4px 0 8px}body[data-replay=true] #learning-material p.muted{font-size:12px;line-height:1.35}}
`

/**
 * The Application pane's layout of an Extension replay's recorded frame, added to {@link STUDY_STYLES} for that profile only.
 * Why: the pane's body never scrolls and a short pane (about 255 px in a side bar) must leave the image the height, so the header is one line (time and surface side by side, the surface cut with an ellipsis and whole in its tooltip), the caption is one line, the footer sentence shows only in a pane taller than 360 px, and the figure takes the height left while the image shrinks into it (contain, no stretch); the pane's script sets the image's recorded size, which this never upscales.
 * Used by {@link testOutputHtml}.
 */
export const EXTENSION_FRAME_STYLES =
  '.extension-frame{flex:1 1 auto;min-height:0;min-width:0;margin:4px 0;display:flex;flex-direction:column;align-items:flex-start;overflow:hidden}.extension-frame img{flex:0 1 auto;min-height:0;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;object-position:left top}.extension-frame figcaption{flex:none;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}body.test-output main{padding:6px 12px}body.test-output p{margin:2px 0}body.test-output .status{padding:2px 8px;margin:2px 0}.test-output-header{flex:none;display:flex;align-items:baseline;gap:4px 12px;min-width:0}.test-output-header>#test-output-time{flex:none;white-space:nowrap}.test-output-header>#test-output-test{flex:1 1 auto;min-width:0;display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.test-output-header>#test-output-test:focus{white-space:normal;overflow:visible}.extension-frame{margin:2px 0}@media(max-height:360px){.test-output-footer{display:none}}'

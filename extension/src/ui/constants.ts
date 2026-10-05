import {
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
  STUDY_REMOVAL_WITHOUT_TRASH_MESSAGE,
} from '../constants'
import type { ShortcutHelpEntry } from '../utils/installShortcutHelp'
const STUDY_FOCUS_MARGIN_PX = 4
const STUDY_COMPACT_READER_MAX_WIDTH_PX = 759
const STUDY_SEQUENCE_LAYOUT = {
  minWidthPx: 320,
  columnWidthPx: 160,
  topPaddingPx: 72,
  rowHeightPx: 64,
  nameYpx: 24,
  nameChunkChars: 20,
  nameLineHeightPx: 14,
  lifelineYpx: 66,
  firstArrowYpx: 92,
  loopWidthPx: 36,
  loopHeightPx: 20,
  arrowWidthPx: 7,
  arrowHeightPx: 5,
  numberGapPx: 8,
}
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
    selector: '#playhead',
  },
  {
    action: 'Seek forward one second',
    keys: '→ / ↑',
    context: 'Focused recording timeline',
    selector: '#playhead',
  },
  {
    action: `Seek backward ${PLAYBACK_PAGE_STEP_MS / MILLISECONDS_PER_SECOND} seconds`,
    keys: 'Page Down',
    context: 'Focused recording timeline',
    selector: '#playhead',
  },
  {
    action: `Seek forward ${PLAYBACK_PAGE_STEP_MS / MILLISECONDS_PER_SECOND} seconds`,
    keys: 'Page Up',
    context: 'Focused recording timeline',
    selector: '#playhead',
  },
  {
    action: 'Seek recording start',
    keys: 'Home',
    context: 'Focused recording timeline',
    selector: '#playhead',
  },
  {
    action: 'Seek recording end',
    keys: 'End',
    context: 'Focused recording timeline',
    selector: '#playhead',
  },
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
export const STUDY_UI_OPTIONS = {
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
  playbackFailureRecovery:
    'Reload the saved recording to try again. If it still fails, ask your agent for a new recording.',
  nativeValuesHint: `Recorded values for this moment are not loaded yet. Show Variables opens Run and Debug and expands them; if the first scope stays closed, expand it. If Call Stack lists several sessions, select “${REPLAY_DEBUG_SESSION_NAME}” first.`,
  // While another tab is in front of the recorded application: Run and Debug's own label in the transport's status, the summary's sentence with what brings the moment back, and that remedy alone for the transport's second status region, so a screen reader hears the label once.
  applicationCovered: {
    label: REPLAY_COVERED_LABEL,
    remedy: `${REPLAY_COVERED_LABEL}. ${APPLICATION_COVERED_ANNOUNCEMENT}`,
    announcement: APPLICATION_COVERED_ANNOUNCEMENT,
  },
  // Where the keyboard focus goes when a Show Variables button leaves while it holds the focus: Play, else the first of these that is shown and enabled.
  replayTransportFocus: [
    '#playback-toggle',
    '[data-playback="start"]',
    '#previous-moment',
    '#next-moment',
    '#playhead',
  ],
  nodeTransportFocus: [
    '#node-history-playback-toggle',
    '#node-history-playhead',
    '#node-history-moment-previous',
    '#node-history-moment-next',
    // A history with a single event has no usable transport control: its selected event's own control takes the focus, which sends nothing when pressed.
    '#node-history-events [aria-pressed="true"]',
  ],
}
export const STUDY_STYLES = `
.shortcut-dialog{width:min(640px,90vw);max-height:85vh;overflow:auto;background:var(--vscode-editor-background,#181818);color:var(--vscode-foreground,#ddd);border:1px solid var(--vscode-panel-border,#777);border-radius:8px;padding:20px}.shortcut-dialog::backdrop{background:rgb(0 0 0 / .5)}.shortcut-dialog input{display:block;width:100%;padding:10px;margin:16px 0;background:var(--vscode-input-background,#333);color:var(--vscode-input-foreground,#fff);border:1px solid var(--vscode-input-border,#777)}.shortcut-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid var(--vscode-panel-border,#444)}.shortcut-list section{padding:12px 0;border:0}.shortcut-list h3{font-size:13px;color:var(--vscode-descriptionForeground,#aaa);margin:0 0 8px}kbd{font:inherit;white-space:nowrap;border:1px solid var(--vscode-panel-border,#777);border-radius:4px;padding:2px 6px}.shortcut-tooltip{position:fixed;z-index:10;left:16px;right:16px;bottom:12px;max-height:40vh;overflow:auto;padding:8px 12px;background:var(--vscode-editorHoverWidget-background,#333);color:var(--vscode-editorHoverWidget-foreground,#fff);border:1px solid var(--vscode-editorHoverWidget-border,#777);pointer-events:none}

.presentation-header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:8px 12px;padding-bottom:12px;border-bottom:1px solid var(--vscode-panel-border,#444)}.study-read-tools{grid-column:1/-1}.presentation-header h1{grid-column:1/-1;margin:0}.presentation-header label{margin:0;align-items:center;min-width:0}.presentation-header select{width:100%;min-width:0}.presentation-status:empty{position:absolute}.presentation-status{grid-column:1/-1;margin:0}.presentation-tools{gap:8px}.mode-caption{margin:4px 0 8px}#presentation-options{min-width:0}#presentation-options>summary{white-space:nowrap}#presentation-options[open]{grid-column:1/-1;grid-row:4}.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}#evidence-details{margin:12px 0}@media(min-width:760px){.presentation-header{grid-template-columns:minmax(12ch,1fr) minmax(220px,auto) auto;align-items:center}.presentation-header h1{grid-column:auto}#presentation-options[open]{grid-row:3}}body[data-presentation=living-book] #selected{max-width:72ch;margin-inline:auto}body[data-presentation=living-book] #overview-text{font-size:18px;line-height:1.6}body[data-presentation=guided-walkthrough] #flow{gap:8px}body[data-presentation=guided-walkthrough] #flow button{padding:8px 12px;border:1px solid var(--vscode-panel-border,#444)}@media(min-width:760px){body[data-presentation=guided-walkthrough] #live-content{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:24px}}#study-controls{margin:12px 0}#study-controls>summary{font-weight:600}
.presentation-header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:8px 12px;padding-bottom:12px;border-bottom:1px solid var(--vscode-panel-border,#444)}#reader-options{margin-bottom:8px}#reader-options>summary{font-weight:600}.study-read-tools{grid-column:1/-1}.presentation-header h1{grid-column:1/-1;margin:0}.presentation-header label{margin:0;align-items:center;min-width:0}.presentation-header select{width:100%;min-width:0}.presentation-status:empty{position:absolute}.presentation-status{grid-column:1/-1;margin:0}.presentation-tools{gap:8px}.mode-caption{margin:4px 0 8px}#presentation-options{min-width:0}#presentation-options>summary{white-space:nowrap}#presentation-options[open]{grid-column:1/-1;grid-row:4}.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}#evidence-details{margin:12px 0}@media(min-width:760px){.presentation-header{grid-template-columns:minmax(12ch,1fr) minmax(220px,auto) auto;align-items:center}.presentation-header h1{grid-column:auto}#presentation-options[open]{grid-row:3}}body[data-presentation=living-book] #selected{max-width:72ch;margin-inline:auto}body[data-presentation=living-book] #overview-text{font-size:18px;line-height:1.6}body[data-presentation=guided-walkthrough] #flow{gap:8px}body[data-presentation=guided-walkthrough] #flow button{padding:8px 12px;border:1px solid var(--vscode-panel-border,#444)}@media(min-width:760px){body[data-presentation=guided-walkthrough] #live-content{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:24px}}#study-controls{margin:12px 0}#study-controls>summary{font-weight:600}
#playhead{width:100%;min-height:44px;accent-color:var(--vscode-focusBorder,#007fd4)}#recording-transport{padding:12px 0}#playback-position{font-variant-numeric:tabular-nums}button,select,summary{min-height:44px}summary{cursor:pointer;padding:10px 0}summary:focus-visible,#interpretations:focus-visible{outline:2px solid var(--vscode-focusBorder,#007fd4)}details[open]{padding-bottom:12px}@media(max-width:${STUDY_COMPACT_READER_MAX_WIDTH_PX}px){body[data-content-tab=live] .live-strip{position:static}body[data-content-tab=live] #interpretations{max-height:30vh;overflow:auto;overscroll-behavior:contain}}
/* A status region stays rendered while it is empty and takes no room, so its first text changes a region assistive technology already knows; only lines that are no status region leave the page while empty. */
.error:empty:not([role=status]){display:none}[role=status]:empty{margin:0;padding:0;border:0}#observation{border:0;padding:0;margin:8px 0 12px;color:var(--vscode-descriptionForeground,#aaa)}@media(min-width:900px){.live-strip{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:4px 12px}.live-strip>.row{justify-content:flex-end}.live-strip>#deadline{grid-column:1/-1}}
:root{color-scheme:light dark;font-family:var(--vscode-font-family,system-ui);color:var(--vscode-foreground,#d4d4d4);background:var(--vscode-editor-background,#181818);font-size:16px;line-height:1.5;scroll-padding-top:calc(var(--codebook-sticky-height,0px) + ${STUDY_FOCUS_MARGIN_PX}px);scroll-padding-bottom:calc(var(--playback-height,0px) + ${STUDY_FOCUS_MARGIN_PX}px)}
#save-state{display:block;margin-top:4px}#flow{display:flex;flex-wrap:wrap;gap:8px 16px}.live-strip.flowing{position:static}[role=tablist]{flex-wrap:wrap}[role=tab]{overflow-wrap:normal}
/* The host styles body directly; inherit the reading scale explicitly. */
/* Titles keep twelve characters per line: body wraps anywhere, and a pane squeezed during arrangement would show them one character per line. */
*{box-sizing:border-box}body{margin:0;padding:16px;overflow-wrap:anywhere;font-size:inherit;line-height:inherit}h1{font-size:20px;line-height:1.25;margin:16px 0 8px;min-width:12ch}h2{font-size:16px;margin:0 0 12px}p{margin:8px 0 16px}button,input,select{font:inherit}button{cursor:pointer;padding:6px 10px;border:1px solid var(--vscode-button-border,var(--vscode-contrastBorder,transparent));border-radius:4px;background:var(--vscode-button-secondaryBackground,#333);color:var(--vscode-button-secondaryForeground,#eee)}button.primary{background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff)}button:hover:not(:disabled):not([aria-disabled=true]){filter:brightness(1.12)}button:disabled,button[aria-disabled=true]{opacity:.6;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--vscode-focusBorder,#007fd4);outline-offset:2px}.row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.muted{color:var(--vscode-descriptionForeground,#aaa)}.status{border:1px solid var(--vscode-contrastBorder,var(--vscode-panel-border,#555));padding:8px 12px;margin:12px 0}.error{color:var(--vscode-editorError-foreground,var(--vscode-foreground,#d4d4d4));white-space:pre-wrap}section{padding:20px 0;border-bottom:1px solid var(--vscode-panel-border,#444)}[role=tablist]{display:flex;gap:8px;border-bottom:1px solid var(--vscode-panel-border,#444);padding-bottom:12px}[role=tab][aria-selected=true]{border-bottom:3px solid var(--vscode-focusBorder,#007fd4)}.link{background:none;border:0;color:var(--vscode-textLink-foreground,#4daafc);text-decoration:underline;padding:4px 0}.link.visited{color:var(--vscode-textLink-activeForeground,#9b8cdd)}label{display:flex;align-items:flex-start;gap:12px;margin:12px 0}input[type=checkbox]{width:20px;height:20px;accent-color:var(--vscode-focusBorder,#007fd4)}.interpretation{white-space:pre-wrap}img{display:block;max-width:100%;height:auto;border:1px solid var(--vscode-panel-border,#444)}.moments{display:flex;gap:8px;flex-wrap:wrap}.moments button[aria-current=true]{outline:2px solid var(--vscode-focusBorder,#007fd4)}.live-strip{position:sticky;top:0;z-index:1;padding:12px;background:var(--vscode-editor-background,#181818);border-bottom:1px solid var(--vscode-panel-border,#444)}body.moments-only{padding:8px 16px}body.moments-only .live-strip{position:static;padding:0 0 8px}body.moments-only section{padding:8px 0}select{max-width:100%;padding:6px;background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);border:1px solid var(--vscode-dropdown-border,#666)}[hidden]{display:none!important}@media(max-width:360px){body{padding:12px}.row{gap:8px}}body.vscode-high-contrast button,body.vscode-high-contrast-light button{border-color:var(--vscode-contrastBorder)}
.learning-header{margin-bottom:12px}.learning-header p{margin:0}.learning-header h1{margin:4px 0 8px}
body.moments-only[data-replay=true] .learning-header,body.moments-only[data-replay=true] #observed-moments,body.moments-only[data-replay=true] #saved-studies,body.moments-only[data-replay=true] .live-strip,body.moments-only[data-replay=true] [data-action="open-article"],body.moments-only[data-replay=true] [data-action="return-wiki"],body.moments-only[data-replay=true] #recording-save-state,body.moments-only[data-replay=true] #evidence-details{display:none}
body[data-replay=true]{padding-bottom:calc(var(--playback-height,150px) + 20px)}
body[data-replay=true] #recording-transport{position:fixed;z-index:3;bottom:0;left:0;right:0;margin:0;padding:10px 16px;border-top:1px solid var(--vscode-panel-border,#444);background:var(--vscode-editor-background,#181818);max-height:60vh;overflow:auto}
/* While the recovery details are open the summary above keeps at least 60% of the pane; the closed footer may grow to 60vh, so the values hint never makes it scroll. The bottom panel's transport is not bounded. */
body[data-replay=true]:not(.moments-only) #recording-transport:has(#playback-options[open]){max-height:40vh}
body.moments-only[data-replay=true] #study-content{display:flex;flex-direction:column}
body.moments-only[data-replay=true] #recording-transport{order:-1;position:sticky;top:0;max-height:none;overflow:visible;padding:0;border-top:0}
.playback-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.playback-row button{min-height:32px;padding:4px 8px}.playback-row #playhead{flex:1;min-width:80px;width:auto;min-height:32px}.playback-row #playback-position{font-size:12px;white-space:nowrap}#playback-show-variables{margin:6px 0}
.timeline-track{position:relative;flex:1;min-width:100px;display:flex;flex-direction:column;align-items:stretch}.timeline-track #playhead{width:100%;flex:none}.timeline-track #history-coverage{position:relative;height:6px;margin:0 8px;overflow:hidden;background:var(--vscode-panel-border,#555)}.timeline-track .history-gap{position:absolute;top:0;bottom:0;background:repeating-linear-gradient(135deg,var(--vscode-editorWarning-foreground,#d7ba7d) 0 3px,transparent 3px 6px)}.timeline-track .history-stop{position:absolute;top:0;bottom:0;width:3px;background:var(--vscode-focusBorder,#007fd4)}#history-coverage-label{font-size:11px;line-height:1.2}
.playback-status-row{display:flex;justify-content:space-between;gap:12px;align-items:start;font-size:12px}.playback-status-row summary{padding:13px 0}.playback-status-row>#recording-status{margin-top:13px}body.moments-only .playback-status-row{flex-wrap:wrap;row-gap:0}body.moments-only #application-covered-remedy{order:1;flex-basis:100%}.playback-status-row p{margin:8px 0}#playback-pending:empty,#playback-reason:empty{display:none}#playback-hint:empty,#node-history-hint:empty{margin:0}#playback-pending,#playback-reason,#playback-hint,#node-history-hint{margin:6px 0 0;font-size:12px}

#saved-studies select{width:100%}#delete-study-row,#study-unopenable,#study-newer,#study-repairable,#delete-study-reason,#delete-study-status,#study-files{margin:8px 0 0}#delete-study-reason:empty{display:none}#delete-study-status:empty{margin:0}#study-files-list{margin:0 0 8px;padding-left:20px}#study-files-note{margin:0 0 8px}#copy-study-files-status{margin:8px 0 0}#copy-study-files-status:empty{margin:0}
#learning-summary,.sequence-steps p{white-space:pre-wrap}.sequence-diagram{overflow:auto;max-height:420px;border:1px solid var(--vscode-panel-border,#444);padding:8px}.sequence-diagram svg{display:block;max-width:none;font-size:12px}.sequence-diagram text{fill:var(--vscode-foreground,#ddd)}.sequence-lifeline{stroke:var(--vscode-descriptionForeground,#aaa);stroke-dasharray:4 4}.sequence-arrow{fill:none;stroke:var(--vscode-textLink-foreground,#4daafc);stroke-width:2}.sequence-arrow.source-derived{stroke-dasharray:6 4}.sequence-arrow.unknown{stroke-dasharray:2 5;stroke:var(--vscode-descriptionForeground,#aaa)}.sequence-steps{padding-left:24px}.sequence-steps li{padding:10px 0}.sequence-steps p{margin:6px 0}.sequence-steps [aria-current=true]{font-weight:bold}
/* Long recorded test output wraps inside the reader, and scrolls there if a line still cannot, instead of widening the page (Cycle 0044, 0031-W1 and 0038-W); each event card's own text does the same. */
#node-history-output,.node-history-event pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;overflow:auto}
/* A Learning summary in a narrow side bar keeps a long title to two lines and its sequence in view; the full title stays in its tooltip, and a title the clamp cuts is a tab stop that is shown whole while it has the keyboard focus. A wider summary shows the title whole. */
#title:focus-visible,#learning-title:focus-visible{outline:2px solid var(--vscode-focusBorder,#007fd4);outline-offset:2px}
@media(max-width:420px){#learning-title{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}#learning-title:focus,body[data-replay=true] .learning-header h1:focus{display:block;overflow:visible}body[data-replay=true]{padding-top:8px;padding-left:12px;padding-right:12px}body[data-replay=true] .learning-header{margin-bottom:4px}body[data-replay=true] #reader-kind{display:none}body[data-replay=true] .learning-header h1{font-size:16px;margin:0 0 4px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}body[data-replay=true] #reader-options{margin-bottom:4px}body[data-replay=true] #reader-options>summary{font-size:13px}body[data-replay=true] #learning-material h2{margin:0 0 4px}body[data-replay=true] #learning-material p{margin:4px 0 8px}body[data-replay=true] #learning-material p.muted{font-size:12px;line-height:1.35}}
`

import {
  TEST_OUTPUT_END_TOLERANCE_PX,
  TEST_OUTPUT_STATE_REPORT_INTERVAL_MS,
} from '../constants'
import { installWebviewFocus } from '../runtimeSupport/utils/installWebviewFocus'
import { EXTENSION_FRAME_STYLES, STUDY_STYLES } from '../ui/constants'

import { NODE_EXTENSION_REPLAY_TEXT } from './describeExtensionReplay'
import { NODE_SERVER_REPLAY_TEXT } from './describeNodeServerReplay'
import { NODE_TEST_REPLAY_TEXT } from './describeNodeTestReplay'
import { escapeHtml } from './escapeHtml'
import { installClampedTitleStop } from './installClampedTitleStop'
import {
  installNodeTestOutput,
  type NodeTestOutputReading,
} from './installNodeTestOutput'
import type { NodeTestApplicationView } from './projectNodeTestApplication'

/**
 * Writes the Application pane's document for a test replay (Design 3): the two-line header pinned above the output region, the muted lines for what was left out, the verdict or the ended-early line and the footer. The output lines are drawn by {@link installNodeTestOutput} from the first view in its options, so one piece of code draws every line (F136), and it applies each later event in place. Every text from the history is printed escaped, so test output and test titles that hold markup render as text.
 * @param view - What the pane shows ({@link projectNodeTestApplication}).
 * @param nonce - The document's script and style nonce.
 * @param history - The shown test replay's study id, which the learner's reading is filed under (DS20).
 * @param reading - The learner's follow choice and scroll anchor for this replay as the host keeps them; following the output when the host has none yet (D22).
 * @returns The document.
 * Called by {@link capturedAppHtml} for a selected test replay.
 * @example testOutputHtml(view, randomUUID(), 'study_1', { follow: true })
 */
export function testOutputHtml(
  view: NodeTestApplicationView,
  nonce: string,
  history: string,
  reading: NodeTestOutputReading = { follow: true },
): string {
  // The script's options are JSON inside a script element: `<` is written as an escape, so no value can end the element.
  // A server replay words its footer and Jump to latest with the server catalog, and draws its two fixed regions between the header and the output.
  const words =
    view.profile === 'node-server'
      ? NODE_SERVER_REPLAY_TEXT
      : view.profile === 'chrome-extension'
        ? NODE_EXTENSION_REPLAY_TEXT
        : NODE_TEST_REPLAY_TEXT
  const scriptOptions = JSON.stringify({
    stderrMark: words.stderrMark,
    history,
    endTolerancePx: TEST_OUTPUT_END_TOLERANCE_PX,
    stateReportIntervalMs: TEST_OUTPUT_STATE_REPORT_INTERVAL_MS,
    view,
    reading,
  }).replaceAll('<', '\\u003c')
  const muted = (id: string, value: string | undefined): string =>
    `<p id="${id}" class="muted"${value === undefined ? ' hidden' : ''}>${escapeHtml(value ?? '')}</p>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';${view.profile === 'chrome-extension' ? ' img-src data:;' : ''} style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">${STUDY_STYLES}${view.profile === 'chrome-extension' ? EXTENSION_FRAME_STYLES : ''}</style><title>${escapeHtml(view.name)}</title></head><body class="test-output"><main id="test-output-main" aria-label="${escapeHtml(view.name)}"><header class="test-output-header"><p id="test-output-time" class="status">${escapeHtml(view.time)}</p>${view.profile === 'node-server' ? '' : `<p id="test-output-test" class="muted" title="${escapeHtml(view.test)}">${escapeHtml(view.test)}</p>`}</header>${view.profile === 'node-server' ? serverRegions(view) : ''}${view.profile === 'chrome-extension' ? extensionFrameRegion(view) : ''}${muted('test-output-inspector', view.inspector)}${muted('test-output-cut', view.cut)}<pre id="test-output" tabindex="0" role="region" aria-label="${escapeHtml(view.region ?? view.name)}"${view.profile === 'chrome-extension' ? ' hidden' : ''}></pre>${muted('test-output-placeholder', view.placeholder)}<p id="test-output-end" class="status"${view.end === undefined ? ' hidden' : ''}>${escapeHtml(view.end ?? '')}</p><button id="test-output-jump" type="button" hidden>${escapeHtml(words.jumpToLatest)}</button><p class="muted test-output-footer">${escapeHtml(words.applicationFooter)}</p></main><script nonce="${nonce}">const api = acquireVsCodeApi();(${installWebviewFocus.toString()})(api);(${installClampedTitleStop.toString()})('${view.profile === 'node-server' ? 'test-output-request-line' : 'test-output-test'}');(${installNodeTestOutput.toString()})(api, ${scriptOptions})</script></body></html>`
}

/**
 * Writes a server replay's two fixed regions of the Application pane, outside the scrolling output: the request line with the claim the replay may make about it, and the response state with the recorded body in its own scrolling block. Called by {@link testOutputHtml}; {@link installNodeTestOutput} updates them in place.
 * @param view - The server replay's Application view.
 * @returns The markup of both regions, every text escaped.
 * @example serverRegions(view) // => '<section id="test-output-request" class="server-region">…'
 */
function serverRegions(view: NodeTestApplicationView): string {
  const request = view.request
  const response = view.response
  return `<section id="test-output-request" class="server-region"${request ? '' : ' hidden'}><p id="test-output-request-line" class="status" title="${escapeHtml(request?.line ?? '')}">${escapeHtml(request?.line ?? '')}</p><p id="test-output-request-claim" class="muted">${escapeHtml(request?.claim ?? '')}</p></section><section id="test-output-response" class="server-region"${response ? '' : ' hidden'}><p id="test-output-response-state" class="status">${escapeHtml(response?.state ?? '')}</p><pre id="test-output-response-body" tabindex="0" role="region" aria-label="${escapeHtml(NODE_SERVER_REPLAY_TEXT.responseBodyLabel)}"${response?.body === undefined ? ' hidden' : ''}>${escapeHtml(response?.body ?? '')}</pre><p id="test-output-response-note" class="muted"${response?.note === undefined ? ' hidden' : ''}>${escapeHtml(response?.note ?? '')}</p></section>`
}

/**
 * Writes an Extension replay's frame region of the Application pane: the recorded image (or its absence) and the label that says what it is. Called by {@link testOutputHtml}; {@link installNodeTestOutput} updates it in place.
 * @param view - The Extension replay's Application view.
 * @returns The markup, every text escaped; the image source is a `data:` PNG address the host built from verified bytes.
 * @example extensionFrameRegion(view) // => '<figure id="test-output-frame" …'
 */
function extensionFrameRegion(view: NodeTestApplicationView): string {
  const frame = view.frame
  const label = frame?.label ?? ''
  return `<figure id="test-output-frame" class="extension-frame"><img id="test-output-frame-image" alt="${escapeHtml(label)}"${frame?.src ? ` src="${escapeHtml(frame.src)}"` : ' hidden'}${frame?.width ? ` width="${frame.width}"` : ''}${frame?.height ? ` height="${frame.height}"` : ''}><figcaption id="test-output-frame-label" class="status" title="${escapeHtml(frame?.reason ?? label)}">${escapeHtml(label)}</figcaption></figure>`
}

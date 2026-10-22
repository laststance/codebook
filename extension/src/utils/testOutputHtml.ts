import { TEST_OUTPUT_END_TOLERANCE_PX } from '../constants'
import { installWebviewFocus } from '../runtimeSupport/utils/installWebviewFocus'
import { STUDY_STYLES } from '../ui/constants'

import { NODE_TEST_REPLAY_TEXT } from './describeNodeTestReplay'
import { escapeHtml } from './escapeHtml'
import { installNodeTestOutput } from './installNodeTestOutput'
import type { NodeTestApplicationView } from './projectNodeTestApplication'

/**
 * Writes the Application pane's document for a test replay (Design 3): the two-line header pinned above the output region, the output up to the selected event, the lines for what was left out, the verdict or the ended-early line, and the footer; {@link installNodeTestOutput} then applies each later event in place. Every text from the history is printed escaped, so test output and test titles that hold markup render as text.
 * @param view - What the pane shows ({@link projectNodeTestApplication}).
 * @param nonce - The document's script and style nonce.
 * @param history - The shown test replay's study id, which the learner's follow choice belongs to (DS20).
 * @returns The document.
 * Called by {@link capturedAppHtml} for a selected test replay.
 * @example testOutputHtml(view, randomUUID(), 'study_1')
 */
export function testOutputHtml(
  view: NodeTestApplicationView,
  nonce: string,
  history: string,
): string {
  // The script's options are JSON inside a script element: `<` is written as an escape, so no value can end the element.
  const scriptOptions = JSON.stringify({
    stderrMark: NODE_TEST_REPLAY_TEXT.stderrMark,
    history,
    endTolerancePx: TEST_OUTPUT_END_TOLERANCE_PX,
  }).replaceAll('<', '\\u003c')
  const muted = (id: string, value: string | undefined): string =>
    `<p id="${id}" class="muted"${value === undefined ? ' hidden' : ''}>${escapeHtml(value ?? '')}</p>`
  const lines = view.lines
    .map(
      (line) =>
        `<span class="output-line" data-line="${line.number}" data-channel="${line.channel}"${line.cut ? ' data-cut="true"' : ''}>${line.channel === 'stderr' && !line.cut ? `<span class="stderr-mark">${escapeHtml(NODE_TEST_REPLAY_TEXT.stderrMark)}</span>` : ''}<span class="output-text">${escapeHtml(line.text)}</span>\n</span>`,
    )
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">${STUDY_STYLES}</style><title>${escapeHtml(view.name)}</title></head><body class="test-output"><main id="test-output-main" aria-label="${escapeHtml(view.name)}"><header class="test-output-header"><p id="test-output-time" class="status">${escapeHtml(view.time ?? '')}</p><p id="test-output-test" class="muted" title="${escapeHtml(view.test)}">${escapeHtml(view.test)}</p></header>${muted('test-output-inspector', view.inspector)}${muted('test-output-cut', view.cut)}<pre id="test-output" tabindex="0" role="region" aria-label="${escapeHtml(view.region ?? view.name)}">${lines}</pre>${muted('test-output-placeholder', view.placeholder)}<p id="test-output-end" class="status"${view.end === undefined ? ' hidden' : ''}>${escapeHtml(view.end ?? '')}</p><button id="test-output-jump" type="button" hidden>${escapeHtml(NODE_TEST_REPLAY_TEXT.jumpToLatest)}</button><p class="muted test-output-footer">${escapeHtml(NODE_TEST_REPLAY_TEXT.applicationFooter)}</p></main><script nonce="${nonce}">const api = acquireVsCodeApi();(${installWebviewFocus.toString()})(api);(${installNodeTestOutput.toString()})(api, ${view.generation}, ${scriptOptions})</script></body></html>`
}

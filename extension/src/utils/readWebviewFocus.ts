import { randomUUID } from 'node:crypto'

import type * as vscode from 'vscode'

import { webviewFocusReceiptSchema } from '../webviewFocusSchemas'

import { settledWithin } from './settledWithin'

/**
 * Reads actual owned-document keyboard focus before automatic Application retirement; {@link StudyWorkspace.closeApplicationPaneOfEndedRun} calls it without revealing the pane.
 *
 * @param panel - The existing owned pane, whose current document must answer this request.
 * @param timeoutMs - The maximum wait for both delivery and the scoped document receipt.
 * @returns
 * - `true` or `false` when the same visible document confirms its keyboard focus.
 * - `undefined` when delivery, receipt, visibility or document lifetime cannot be confirmed.
 * @example
 * await readWebviewFocus(panel, 1_000) // => false while an outside input holds the keyboard
 */
export async function readWebviewFocus(
  panel: Pick<vscode.WebviewPanel, 'visible' | 'onDidDispose'> & {
    webview: Pick<
      vscode.Webview,
      'html' | 'onDidReceiveMessage' | 'postMessage'
    >
  },
  timeoutMs: number,
): Promise<boolean | undefined> {
  try {
    // A hidden pane supplies no current document observation.
    if (!panel.visible) return undefined
    return await inspectFocusDocument(panel, timeoutMs)
  } catch {
    // Inspection is a courtesy: unavailable transport keeps the caller's established fallback.
    return undefined
  }
}

/**
 * Owns one scoped receipt and its bounded transport lifetime; {@link readWebviewFocus} calls it for a visible pane.
 * @param timeoutMs - The shared budget for delivery and document observation.
 * @returns The confirmed keyboard observation, or `undefined` for an unconfirmed lifecycle.
 * @example await inspectFocusDocument(panel, 1_000) // => true for its focused document
 */
async function inspectFocusDocument(
  panel: Parameters<typeof readWebviewFocus>[0],
  timeoutMs: number,
): Promise<boolean | undefined> {
  const requestId = randomUUID(),
    documentHtml = panel.webview.html
  let focused: boolean | undefined,
    disposed = false,
    delivered = false,
    received = (): void => {}
  const receipt = new Promise<void>((resolve) => {
    received = resolve
  })
  const messages = panel.webview.onDidReceiveMessage((value: unknown) => {
    const parsed = webviewFocusReceiptSchema.safeParse(value)
    // Only this inspection's prepared-shaped receipt is an observation; focus-operation receipts are ignored.
    if (
      !parsed.success ||
      parsed.data.requestId !== requestId ||
      parsed.data.phase !== 'prepared'
    )
      return
    focused = parsed.data.focused
    received()
  })
  let disposal: vscode.Disposable | undefined
  try {
    disposal = panel.onDidDispose(() => {
      disposed = true
      received()
    })
    const delivery = Promise.resolve(
      panel.webview.postMessage({
        type: 'codebook-focus',
        phase: 'inspect',
        requestId,
      }),
    ).then((accepted) => {
      delivered = accepted
      // Refused delivery owes no document receipt.
      if (!accepted) received()
    })
    const observed = await settledWithin(
      Promise.all([delivery, receipt]),
      timeoutMs,
    )
    // A hidden, closed or replaced document cannot authorize retirement keyboard effects.
    if (
      !hasConfirmedInspection(observed, delivered, disposed) ||
      !isCurrentInspectionDocument(panel, documentHtml)
    )
      return undefined
    return focused
  } finally {
    messages.dispose()
    disposal?.dispose()
  }
}

/**
 * Requires a delivered receipt from a surviving pane; {@link inspectFocusDocument} uses it after its wait.
 * @returns `true` only when neither transport nor disposal invalidates the observation.
 * @example hasConfirmedInspection(true, true, false) // => true
 */
function hasConfirmedInspection(
  observed: boolean,
  delivered: boolean,
  disposed: boolean,
): boolean {
  return observed && delivered && !disposed
}

/**
 * Rejects a reply whose visible document was replaced; {@link inspectFocusDocument} checks it before returning focus.
 * @param documentHtml - The exact document at inspection entry.
 * @returns `true` while that same document is visible.
 * @example isCurrentInspectionDocument(panel, oldHtml) // => false after replacement
 */
function isCurrentInspectionDocument(
  panel: Parameters<typeof readWebviewFocus>[0],
  documentHtml: string,
): boolean {
  return panel.visible && panel.webview.html === documentHtml
}

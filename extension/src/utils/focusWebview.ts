import type * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { webviewFocusReceiptSchema } from '../webviewFocusSchemas';

/** Hands owned-pane focus to its current inner document once; presentation callers supply lifetime/native ownership guards. @example await focusWebview(panel, options) */
export async function focusWebview(panel: Pick<vscode.WebviewPanel, 'visible' | 'reveal' | 'onDidDispose'> & { webview: Pick<vscode.Webview, 'onDidReceiveMessage' | 'postMessage'> }, options: {
  signal?: AbortSignal; timeoutMs: number; assertCurrent(): void; assertBeforeCommit(): void; isActive(): boolean;
}): Promise<void> {
  const requestId = randomUUID(), expiresAt = Date.now() + options.timeoutMs;
  let epoch: string | undefined, focused = false, disposed = false, committed = false;
  const assertCurrent = () => {
    options.signal?.throwIfAborted(); options.assertCurrent();
    if (disposed) throw new Error('The presentation focus target was closed.');
  };
  const messages = panel.webview.onDidReceiveMessage((value: unknown) => {
    const parsed = webviewFocusReceiptSchema.safeParse(value);
    if (!parsed.success || parsed.data.requestId !== requestId) return;
    const receipt = parsed.data;
    if (!committed && receipt.phase === 'prepared') epoch = receipt.epoch;
    if (committed && receipt.phase === 'focused' && receipt.epoch === epoch) focused = receipt.focused;
  });
  const disposal = panel.onDidDispose(() => { disposed = true; });
  const wait = <Value>(read: () => Value, description: string) => waitUntil(() => { assertCurrent(); return read(); }, description, Math.max(0, expiresAt - Date.now()), options.signal);
  const post = async (message: object) => {
    assertCurrent();
    if (Date.now() >= expiresAt) throw new Error('The presentation focus request expired before delivery.');
    let delivery: { accepted: boolean } | { error: unknown } | undefined;
    // Observe delivery within the same deadline; a rejected or stalled transport must not hold the presentation forever.
    Promise.resolve(panel.webview.postMessage(message)).then(accepted => { delivery = { accepted }; }, error => { delivery = { error }; });
    const result = await wait(() => delivery, 'presentation focus message delivery');
    if ('error' in result) throw result.error;
    if (!result.accepted) throw new Error('The presentation focus message was not delivered.');
  };
  try {
    // Inner document focus does not reliably select the native editor; request both parts of the owned handoff.
    assertCurrent(); options.assertBeforeCommit(); panel.reveal(undefined, false);
    await wait(() => panel.visible, 'visible presentation focus target');
    options.assertBeforeCommit();
    await post({ type: 'codebook-focus', phase: 'prepare', requestId, expiresAt });
    await wait(() => epoch, 'current presentation focus document');
    assertCurrent(); options.assertBeforeCommit(); committed = true;
    await post({ type: 'codebook-focus', phase: 'commit', requestId, epoch });
    await wait(() => focused && panel.visible && options.isActive(), 'owned presentation inner focus');
    assertCurrent();
  } finally {
    messages.dispose(); disposal.dispose();
    // Release observation/queued authority after either outcome; expiry remains the bound if transport is unavailable.
    if (epoch && !disposed) {
      try { Promise.resolve(panel.webview.postMessage({ type: 'codebook-focus', phase: 'cancel', requestId, epoch })).catch(() => undefined); } catch { /* A disposed or failed transport cannot extend the completed host wait. */ }
    }
  }
}

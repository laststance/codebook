/**
 * Selects the scopes a live pause may copy into durable replay history: only the stopped frame's local and block values.
 * Globals, closures and caller frames can hold credentials such as `process.env` or database clients, and history is served to the editor chat.
 * js-debug translates scope names into the editor's display language, so its language-neutral DAP `locals` hint decides first.
 * Called by {@link captureReplayDebugSnapshot} for every browser, server and Node test stop.
 * @param frameIndex - The recorded stack-frame position.
 * @param scopeName - The debugger's lexical scope label, read only when the adapter sends no presentation hint.
 * @param presentationHint - The DAP scope hint; js-debug marks Local, Block, Catch Block and With Block as `locals`.
 * @returns Whether this scope may be copied into the durable snapshot.
 * @example
 * shouldCaptureReplayScope(0, 'ローカル: fetchInvoiceById', 'locals') // true
 * shouldCaptureReplayScope(0, 'Closure', 'arguments') // false
 * shouldCaptureReplayScope(0, 'Local: fetchInvoiceById') // true
 * shouldCaptureReplayScope(0, 'Global') // false
 */
export function shouldCaptureReplayScope(frameIndex: number, scopeName: string, presentationHint?: string): boolean {
  if (frameIndex !== 0) return false;
  if (presentationHint !== undefined) return presentationHint === 'locals';
  // Adapters without hints still name lexical scopes in English.
  return /^(?:block|locals?)(?::|$)/i.test(scopeName);
}

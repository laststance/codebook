/**
 * Selects the scopes a live pause may copy into durable replay history: only the stopped frame's local and block values.
 * Globals, closures and caller frames can hold credentials such as `process.env` or database clients, and history is served to the editor chat.
 * Called by {@link captureReplayDebugSnapshot} for every browser, server and Node test stop.
 * @param frameIndex - The recorded stack-frame position.
 * @param scopeName - The debugger's lexical scope label.
 * @returns Whether this scope may be copied into the durable snapshot.
 * @example
 * shouldCaptureReplayScope(0, 'Local: fetchInvoiceById') // true
 * shouldCaptureReplayScope(0, 'Global') // false
 */
export function shouldCaptureReplayScope(frameIndex: number, scopeName: string): boolean {
  return frameIndex === 0 && /^(?:block|locals?)(?::|$)/i.test(scopeName);
}

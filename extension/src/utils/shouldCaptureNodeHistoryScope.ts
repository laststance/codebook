/**
 * Selects bounded scopes from the verified Node stop for historical native inspection.
 * Called by {@link captureReplayDebugSnapshot} through the owned Node run.
 * @param frameIndex - The recorded stack-frame position.
 * @param scopeName - The debugger's lexical scope label.
 * @returns Whether this scope may be copied into the durable snapshot.
 * @example
 * shouldCaptureNodeHistoryScope(0, 'Local: fetchInvoiceById') // true
 */
export function shouldCaptureNodeHistoryScope(frameIndex: number, scopeName: string): boolean {
  return frameIndex === 0 && /^(?:block|locals?)(?::|$)/i.test(scopeName);
}

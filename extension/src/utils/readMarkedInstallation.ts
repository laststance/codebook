/**
 * Reads the installation id a parsed connection descriptor's mark names; called by the Devin bridge's descriptor scan, {@link readBridgeDescriptor}'s parse and {@link hasDevinBridgeReceipts}, so all three read the mark the same way.
 * @param raw - The descriptor's parsed JSON.
 * @returns The `devinSetupInstallation` text; `undefined` when the descriptor is no object or names none.
 * @example
 * readMarkedInstallation({ devinSetupInstallation: 'f3b1c0de-…' }) // => 'f3b1c0de-…'
 * readMarkedInstallation({})                                        // => undefined
 */
export function readMarkedInstallation(raw: unknown): string | undefined {
  const marked =
    typeof raw === 'object' && raw !== null && 'devinSetupInstallation' in raw
      ? raw.devinSetupInstallation
      : undefined
  return typeof marked === 'string' ? marked : undefined
}

import type { ExtensionHistoryEntryOf } from '../chromeExtensionHistorySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

/**
 * Tells whether a capture's top frame holds the executed source: the frame's source names the capture's path and line, and its text hashes to the capture's source hash.
 *
 * One predicate for the seal ({@link evaluateExtensionHistoryCapture}) and the replay ({@link buildExtensionReplayModel}), so a seal never calls complete a stop the replay shows without its source.
 * @param capture - The pause's capture.
 * @returns `true` when the stop can show its source at the executed line.
 * @example extensionCaptureHasSource(capture) // => true for a capture whose snapshot carries the executed file
 */
export function extensionCaptureHasSource(
  capture: ExtensionHistoryEntryOf<'capture'>,
): boolean {
  const frame = capture.debuggerSnapshot.frames[0]
  const source = frame?.source
  if (!source) return false
  return [
    source.name === capture.path,
    source.line === capture.line,
    source.hash === capture.sourceHash,
    sha256(source.text) === source.hash,
    frame.line === capture.line,
  ].every(Boolean)
}

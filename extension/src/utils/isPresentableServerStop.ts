import { REPLAY_SCOPE_NOT_CAPTURED_TEXT } from '../constants'
import type { NodeServerStopEntry } from '../nodeServerHistorySchemas'

/**
 * Tells whether a stored server stop can be presented in the replay debugger: the snapshot has frames, the top frame's path, line, column and source hash match the stop, and its scopes were read: at least one read scope, every other one read or left out by the capture's own policy ({@link REPLAY_SCOPE_NOT_CAPTURED_TEXT}); lower frames may lack source.
 * Called by {@link evaluateNodeServerCapture} for every stop, so the live cache, the library, Save and MCP agree on capture completeness; it applies the identity checks of {@link nodeStopSourceMatches} to the server stop's hash-only top frame, whose text the `source` entry already verified against the hash.
 * @param stop - The stored stop entry.
 * @returns `true` when the stop is presentable; `false` for empty frames, a frame at another position, another source, no read scope, or a scope that failed to read.
 * @example isPresentableServerStop(stopWithEmptyFrames) // => false
 */
export function isPresentableServerStop(stop: NodeServerStopEntry): boolean {
  const top = stop.debuggerSnapshot.frames[0]
  if (!top?.source) return false
  return [
    top.source.name === stop.source.path,
    top.source.hash === stop.source.hash,
    top.source.line === stop.source.line,
    top.line === stop.source.line,
    top.column === stop.source.column,
    // At least one scope was read (the stopped frame's local one); the others were read or left out by the capture's own policy, and a scope that failed to read for any other reason is not presentable.
    top.scopes.some((scope) => scope.unavailable === undefined),
    top.scopes.every(
      (scope) =>
        scope.unavailable === undefined ||
        scope.unavailable === REPLAY_SCOPE_NOT_CAPTURED_TEXT,
    ),
    top.unavailable === undefined,
  ].every(Boolean)
}

/**
 * Tells whether a debug session may hold a run's debug target, so a binding loop never asks js-debug's silent attach root.
 *
 * js-debug's `pwa-node` / `pwa-chrome` attach or launch root owns no target and never answers `requestCDPProxy`; a loop that asked it would wait the 20 s {@link ACTIVE_TIMEOUT_MS} bound before it reached the child that holds the process.
 * Called as the candidate filter of the Node server/script binding, the Node test binding and the configured browser run's server and page selection.
 *
 * @param debugSession - Any debug session of the editor that the run knows.
 * @returns `true` when the session has a parent session (a target-holding child); `false` for a root.
 * @example
 * ```ts
 * isDebugTargetSession({ parentSession: rootSession }) // => true
 * isDebugTargetSession({ parentSession: undefined }) // => false
 * ```
 */
export function isDebugTargetSession(debugSession: {
  readonly parentSession?: object
}): boolean {
  return Boolean(debugSession.parentSession)
}

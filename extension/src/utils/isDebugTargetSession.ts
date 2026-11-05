/**
 * Tells whether a debug session is a binding candidate: a session without a parent is treated as js-debug's target-less root and is never asked.
 *
 * js-debug's `pwa-node` / `pwa-chrome` attach or launch root owns no target and never answers `requestCDPProxy`; a loop that asked it would wait the 20 s {@link ACTIVE_TIMEOUT_MS} bound before it reached the child that holds the process. The rule is by parentage alone: a session with a parent is still verified by its caller (ownership, identity), and a parentless session that did hold a target would not be asked.
 * Called as the candidate filter of the Node server/script binding, the Node test binding and the configured browser run's server and page selection.
 *
 * @param debugSession - Any debug session of the editor that the run knows.
 * @returns
 * - `true` when the session has a parent session, so its caller may ask and verify it
 * - `false` for a session without a parent, which is never asked
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

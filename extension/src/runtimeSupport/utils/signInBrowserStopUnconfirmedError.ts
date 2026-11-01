import { thrownMessage } from '../../utils/thrownMessage'

/**
 * The failure of a setup-browser launch whose browser could not be shown stopped afterwards, so the saved-session folder may still be in use.
 * Why it exists: Codex correction 4 keeps the folder's lock until the browser's exit is confirmed by the stop result and a fresh process listing; a launch that failed (a marker write, `Browser.getVersion` past its bound, a cancel) and then could not confirm its stop must not let the setup release the lock and delete the owned-browser marker.
 * Thrown by {@link launchSignInBrowser} in place of the launch's own failure, which stays its `cause` and its message; {@link SavedSessionSetup} tells it apart by type, keeps the lease and offers Retry, which calls {@link SignInBrowserStopUnconfirmedError.retryStop}. The name stays `Error`, so `String(error)` reads as the launch's failure did.
 * @example
 * try {
 *   await launchSignInBrowser(options)
 * } catch (error) {
 *   if (error instanceof SignInBrowserStopUnconfirmedError) await error.retryStop() // => true once nothing names the folder
 * }
 */
export class SignInBrowserStopUnconfirmedError extends Error {
  /**
   * @param failure - What made the launch fail; kept as `cause`, its message reused.
   * @param retryStop - Stops what is left again; resolves `true` once the stop and a fresh listing show nothing on the folder.
   */
  constructor(
    failure: unknown,
    readonly retryStop: () => Promise<boolean>,
  ) {
    super(thrownMessage(failure), { cause: failure })
  }
}

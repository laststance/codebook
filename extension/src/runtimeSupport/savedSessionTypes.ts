import type { SignInRequiredReason } from '../constants'

export type { SignInRequiredReason }

/**
 * Where the saved session of one repository stands, as `codebook_status.savedSession.state` reports it.
 * `none`: no setup was ever finished or begun; `setup-open`: a setup is open in some window; `saved`: the last setup ended with Done; `unconfirmed`: the last setup ended without Done; `unusable`: the folder or its record cannot be used (see {@link SavedSessionUnusableReason}).
 */
export type SavedSessionState =
  'none' | 'setup-open' | 'saved' | 'unconfirmed' | 'unusable'

/**
 * What `codebook_status.savedSession` and a run resource's `savedSession` hold: whether a version 3 run may use the saved session, its state, and when the last setup ended.
 * Read by the chat to decide whether to start a run after `SIGN_IN_REQUIRED`; the store builds it, a run keeps the one it read at admission.
 */
export type SavedSessionStatus = {
  available: boolean
  state: SavedSessionState
  /** ISO time the last setup ended (Done or Close setup); absent while `state` is `none`. */
  setupAt?: string
}

/**
 * What the app's cookies were when a setup ended: `persistent` (kept across a browser restart), `session-only` (dropped when the browser closes), `none` or `unknown`.
 * The store records it; a run that lands on a sign-in path with `session-only` answers `SIGN_IN_REQUIRED` with reason `session-cookie-only`.
 */
export type AppCookieKind = 'persistent' | 'session-only' | 'none' | 'unknown'

/** Why the store cannot use a saved-session folder; `chrome-version` also covers a run Chrome whose major cannot be read. Carried as `details.reason` of `SIGN_IN_PROFILE_UNUSABLE`. */
export type SavedSessionUnusableReason =
  | 'unreadable-record'
  | 'newer-record'
  | 'not-a-session-folder'
  | 'chrome-version'

/**
 * What a version 3 run asks the store for at its start (once, before the development server starts).
 * `session` is `saved-if-available` unless the configuration declares `session: "fresh"`; `signal` ends the wait when the run stops.
 */
export type SavedSessionRunRequest = {
  repositoryRoot: string
  /** The service's run id (`RuntimeControl.runId`), never the run object's own id. */
  runId: string
  session: 'saved-if-available' | 'fresh'
  /** The version text of the run's Chrome; its major is compared with the recorded one by `chromeMajorOf`. */
  chromeVersion: string
  signal: AbortSignal
}

/**
 * The hold a run takes on a saved-session folder, from admission to the exit of its Chrome.
 * `prepareForLaunch` re-runs the fresh process listing, removes stale Singleton entries and a stale `DevToolsActivePort`, and sets the Preferences keys; the run calls it right before `browser.launch`. `recordBrowser` writes the marker that lets a later window stop an orphan run Chrome. `release` frees the folder and is called only after the close saw no process naming it.
 * Neither the store nor a run journals `profile`.
 */
export type SavedSessionRunLease = {
  /** The user-data-dir the run's Chrome opens; never journaled. */
  readonly profile: string
  readonly setupAt: string
  readonly appCookies: AppCookieKind
  recordBrowser(marker: { executable: string; pid: number }): Promise<void>
  prepareForLaunch(): Promise<void>
  release(): Promise<void>
}

/**
 * The store's answer to a run request: the saved session with its lease, or a fresh profile with the reason a `SIGN_IN_REQUIRED` would name.
 * A refusal (setup open, folder in use, folder unusable) is thrown as a coded `StudyError`, not returned.
 */
export type SavedSessionRunAdmission =
  | { session: 'saved'; lease: SavedSessionRunLease }
  | {
      session: 'fresh'
      signInRequiredReason: Extract<
        SignInRequiredReason,
        'no-saved-session' | 'setup-not-finished'
      >
    }

/**
 * The part of the saved-session store that the service, the environment and the runs use.
 * Lane A's store implements it; tests supply stand-ins. `describe` answers `codebook_status.savedSession`; `acquireForRun` decides atomically under the folder's lock.
 * @throws `acquireForRun` throws `SIGN_IN_IN_PROGRESS`, `BUSY` (reason `profile-in-use`), `SIGN_IN_PROFILE_IN_USE` or `SIGN_IN_PROFILE_UNUSABLE`.
 */
export interface SavedSessionStorePort {
  describe(repositoryRoot: string): Promise<SavedSessionStatus>
  acquireForRun(
    request: SavedSessionRunRequest,
  ): Promise<SavedSessionRunAdmission>
  rememberSignInPaths(
    repositoryRoot: string,
    paths: readonly string[],
  ): Promise<void>
}

/**
 * The store bound to the run's repository, as a version 3 run receives it from `createRuntime`.
 * `repositoryName` is the folder name shown in messages; no path ever is.
 */
export interface SavedSessionRunPort {
  readonly repositoryName: string
  acquire(
    runId: string,
    session: SavedSessionRunRequest['session'],
    chromeVersion: string,
    signal: AbortSignal,
  ): Promise<SavedSessionRunAdmission>
  rememberSignInPaths(paths: readonly string[]): Promise<void>
}

/**
 * The development server a setup starts for the sign-in page, on a loopback origin.
 * Returned by `StudyEnvironment.startSavedSessionServer`; `close` stops the server and its forwarder.
 */
export type SavedSessionServer = {
  /** `http://localhost:<port>`. */
  origin: string
  port: number
  close(): Promise<void>
}

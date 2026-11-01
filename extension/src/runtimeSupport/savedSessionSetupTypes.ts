import type {
  AppCookieKind,
  SavedSessionState,
  SavedSessionStatus,
  SavedSessionStorePort,
  SavedSessionUnusableReason,
} from './savedSessionTypes'

/**
 * What a setup writes into `signin.json` when it ends (the store adds `version` and `repositoryRoot`).
 * `confirmed` is true only when the learner chose Done and the browser closed gracefully; every other end writes false.
 */
export type SignInRecordFields = {
  confirmed: boolean
  /** ISO time the setup ended. */
  setupAt: string
  /** The paths the app signs in at (1 to 4), the chosen one first. */
  signInPaths: readonly string[]
  /** The major version of the Chrome that set the session up. */
  chromeMajor: number
  appCookies: AppCookieKind
}

/**
 * The hold a setup takes on one saved-session folder, from `acquireForSetup` to the confirmed exit of its Chrome.
 * The store (lane A1) implements it; `release` is called only after the setup browser's exit was confirmed, so an unconfirmed close keeps the lock and can be retried.
 */
export interface SavedSessionSetupLease {
  /** The user-data-dir the setup browser opens; never journaled or logged. */
  readonly profile: string
  /** The record the folder had before this setup, when it had a readable one. */
  readonly previous?: SignInRecordFields
  recordBrowser(marker: { executable: string; pid: number }): Promise<void>
  writeRecord(fields: SignInRecordFields): Promise<void>
  release(): Promise<void>
}

/** What the UI needs about the workspace repository's saved session beyond {@link SavedSessionStatus}. */
export type SavedSessionView = SavedSessionStatus & {
  repositoryName: string
  confirmed?: boolean
  appCookies?: AppCookieKind
  unusableReason?: Exclude<SavedSessionUnusableReason, 'chrome-version'>
  /** `true` while a setup of this window holds the folder. */
  setupOpenHere: boolean
}

/** One saved session of this host, as Remove Saved Session… lists it. */
export type SavedSessionEntry = {
  hash: string
  repositoryRoot?: string
  repositoryName: string
  state: SavedSessionState
  setupAt?: string
  isCurrent: boolean
}

/** What a removal did. */
export type SavedSessionRemoval =
  | { outcome: 'removed' }
  | { outcome: 'run-in-this-window'; runId: string }
  | { outcome: 'in-use-elsewhere' }
  | { outcome: 'setup-open' }
  | { outcome: 'refused-path'; reason: string }
  | { outcome: 'partly-removed'; cause: string }

/**
 * The store as the setup and the commands use it: lane 0's {@link SavedSessionStorePort} plus setup, listing and removal.
 * Lane A1's `SavedSessionStore` implements it; tests supply a fake.
 */
export interface SavedSessionManagerPort extends SavedSessionStorePort {
  describeForUi(repositoryRoot: string): Promise<SavedSessionView>
  list(currentRepositoryRoot: string): Promise<SavedSessionEntry[]>
  /** @throws `SIGN_IN_IN_PROGRESS` or `SIGN_IN_PROFILE_IN_USE`. */
  acquireForSetup(repositoryRoot: string): Promise<SavedSessionSetupLease>
  remove(entry: SavedSessionEntry): Promise<SavedSessionRemoval>
  /** Resolves when the lock of the folder is released in this window. */
  whenReleased(hash: string): Promise<void>
  lastSignInPaths(repositoryRoot: string): readonly string[]
  onDidChange(listener: (hash: string) => void): () => void
}

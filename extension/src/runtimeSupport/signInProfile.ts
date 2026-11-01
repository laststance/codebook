import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readdir, realpath, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'

import {
  PRIVATE_DIRECTORY_MODE,
  SAVED_SESSION_LAST_PATHS_KEY,
  SIGN_IN_LOCK_FILE,
  SIGN_IN_PATH_LIMIT,
  SIGN_IN_PROFILES_DIRECTORY,
  SIGN_IN_RECORD_FILE,
  SIGN_IN_RECORD_VERSION,
  SIGN_IN_REMOVE_RETRIES,
  SIGN_IN_REMOVE_RETRY_DELAY_MS,
  OWNED_BROWSER_MARKER_FILE,
} from '../constants'
import { atomicPrivateBytes } from '../utils/atomicPrivateBytes'
import { currentStorageOwner } from '../utils/currentStorageOwner'
import { isStaleStorageLock } from '../utils/isStaleStorageLock'
import { passIfMissing } from '../utils/passIfMissing'
import { placeStorageLock } from '../utils/placeStorageLock'
import {
  readProcessStart,
  type ProcessStartReader,
} from '../utils/readProcessStart'
import type { StorageOwnerIdentity } from '../utils/readRecordedOwner'
import { removeStaleStorageLock } from '../utils/removeStaleStorageLock'
import { removeWithoutFollowing } from '../utils/removeWithoutFollowing'
import { retryWhileBusy } from '../utils/retryWhileBusy'
import { SharedAttempt } from '../utils/sharedAttempt'
import { systemErrorCode } from '../utils/systemErrorCode'

import type {
  SavedSessionEntry,
  SavedSessionManagerPort,
  SavedSessionRemoval,
  SavedSessionSetupLease,
  SavedSessionView,
} from './savedSessionSetupTypes'
import type {
  SavedSessionRunAdmission,
  SavedSessionRunLease,
  SavedSessionRunRequest,
  SavedSessionStatus,
} from './savedSessionTypes'
import { chromeMajorOf } from './utils/chromeMajorOf'
import { ensureSignInPreferences } from './utils/ensureSignInPreferences'
import { errorWithPathHidden } from './utils/errorWithPathHidden'
import { hideSavedProfilePath } from './utils/hideSavedProfilePath'
import {
  listProcesses,
  type ListedProcess,
  type ProcessListingInputs,
} from './utils/listProcesses'
import {
  readOwnedBrowserMarker,
  type OwnedBrowserMarker,
} from './utils/ownedBrowserMarker'
import { profileProcesses } from './utils/profileProcesses'
import {
  proveSessionFolder,
  SESSION_FOLDER_NAME,
} from './utils/proveSessionFolder'
import { removeStaleChromeSingletons } from './utils/removeStaleChromeSingletons'
import {
  savedSessionRefusal,
  savedSessionUnusable,
} from './utils/savedSessionRefusal'
import { sha256 } from './utils/sha256'
import {
  lockConflictOf,
  readSignInLock,
  type SignInLockConflict,
  type SignInLockPurpose,
  type SignInLockRecord,
} from './utils/signInLock'
import {
  readSignInRecord,
  writeSignInRecord,
  type SignInRecord,
} from './utils/signInRecord'
import {
  REAL_PROCESS_STOPPER,
  type ProcessStopper,
} from './utils/stopListedProcesses'
import { stopOrphanBrowser } from './utils/stopOrphanBrowser'

/** The Chrome file that exists only while a debugging port is open; a stale one makes the next launch fail. */
const DEVTOOLS_ACTIVE_PORT_FILE = 'DevToolsActivePort'

/** The editor state the store keeps the last sign-in paths in. */
export type SavedSessionMemento = {
  get<Value>(key: string): Value | undefined
  update(key: string, value: unknown): PromiseLike<void>
}

/** What the store is built with; everything but `globalStorage` and `windowSession` is replaced by tests. */
export type SavedSessionStoreOptions = {
  /** The editor's `globalStorageUri` path of this host. */
  globalStorage: string
  /** An id of this editor window (`vscode.env.sessionId`). */
  windowSession: string
  memento?: SavedSessionMemento
  identity?: () => Promise<StorageOwnerIdentity>
  listProcesses?: (inputs: ProcessListingInputs) => Promise<ListedProcess[]>
  stopper?: ProcessStopper
  readStart?: ProcessStartReader
  now?: () => number
  /** Deletes the folder during a removal; a test wraps it to act between the steps. */
  removeFolder?: (folder: string) => Promise<void>
}

/** The folder of one repository and its sibling lock. */
type SessionTarget = {
  realRoot: string
  hash: string
  folder: string
  /** Beside the folder, never inside it (Codex correction 1). */
  lockPath: string
  repositoryName: string
}

/** A lock this store holds. */
type HeldLock = {
  token: string
  /** The process start this hold wrote into the lock (absent while it could not be read); the release compares the lock with it, never with a later read. */
  processStart?: string
}

/** The in-memory view of a hold by this window, for `whenReleased`. */
type WindowHold = {
  holder: SignInLockPurpose
  runId?: string
  released: Promise<void>
  markReleased: () => void
}

/**
 * The saved-session store: one Chrome user-data folder per host and repository root under `<globalStorage>/sign-in-profiles/<sha256 of the real path>` (mode 0700), `signin.json` in it, and a lock file BESIDE it (`<hash>.signin.lock`) so deleting the folder can never race a new owner's lock.
 * Created once per window by the extension; the service reads {@link SavedSessionStore.describe} for `codebook_status`, a version 3 run calls {@link SavedSessionStore.acquireForRun}, and the setup and removal commands use {@link SavedSessionStore.acquireForSetup} and {@link SavedSessionStore.remove}. It prefers refusing (`SIGN_IN_PROFILE_IN_USE`) to any signal or deletion it cannot prove safe: a failed process listing, an unreadable lock or a Chrome without a matching start proof all refuse.
 * @example
 * const store = new SavedSessionStore({ globalStorage, windowSession: vscode.env.sessionId })
 * const admission = await store.acquireForRun({ repositoryRoot, runId, mode: 'saved-if-available', chromeVersion, signal })
 */
export class SavedSessionStore implements SavedSessionManagerPort {
  private readonly root: string
  private readonly holds = new Map<string, WindowHold>()
  /** Holds whose lock a fresh admission could not remove; the next take of the same session tries that release again ({@link SavedSessionStore.retryUnreleased}). */
  private readonly unreleased = new Map<string, HeldLock>()
  private readonly listeners = new Set<(hash: string) => void>()

  constructor(private readonly options: SavedSessionStoreOptions) {
    this.root = join(options.globalStorage, SIGN_IN_PROFILES_DIRECTORY)
  }

  private identity(): Promise<StorageOwnerIdentity> {
    return (this.options.identity ?? currentStorageOwner)()
  }

  private get readStart(): ProcessStartReader {
    return this.options.readStart ?? readProcessStart
  }

  /**
   * Names the folder and lock of a repository root; the root's real path is hashed, so a symlinked workspace path reaches the same session.
   * @param repositoryRoot - The workspace repository root.
   * @returns The target; nothing is created.
   * @example
   * await store.folderOf('/work/app') // => { hash: 'ab12…', repositoryName: 'app', … }
   */
  async folderOf(repositoryRoot: string): Promise<SessionTarget> {
    const realRoot = await realpath(repositoryRoot)
    const hash = sha256(realRoot)
    return this.targetOf(hash, basename(realRoot), realRoot)
  }

  private targetOf(
    hash: string,
    repositoryName: string,
    realRoot = '',
  ): SessionTarget {
    return {
      realRoot,
      hash,
      folder: join(this.root, hash),
      lockPath: join(this.root, `${hash}.${SIGN_IN_LOCK_FILE}`),
      repositoryName,
    }
  }

  /**
   * Answers `codebook_status.savedSession`: whether a run may use the saved session, its state and when the last setup ended; no path, hash or cookie.
   * @param repositoryRoot - The workspace repository root.
   * @returns The status; an unusable folder reads as `unusable`.
   * @example
   * await store.describe('/work/app') // => { available: true, state: 'saved', setupAt: '2026-11-02T12:10:00.000Z' }
   */
  async describe(repositoryRoot: string): Promise<SavedSessionStatus> {
    return (await this.statusOf(await this.folderOf(repositoryRoot))).status
  }

  private async statusOf(target: SessionTarget): Promise<{
    status: SavedSessionStatus
    record?: SignInRecord
    /** The repository a readable record names, in every state, a setup that is open included; the session list reads it. */
    repositoryRoot?: string
    unusableReason?: SavedSessionView['unusableReason']
  }> {
    const proof = await proveSessionFolder(this.root, target.hash)
    if (!proof.ok)
      return {
        status: { available: false, state: 'unusable' },
        unusableReason: 'not-a-session-folder',
      }
    const setupOpen = await this.isSetupOpen(target)
    const read = proof.exists
      ? await readSignInRecord(target.folder)
      : ({ kind: 'absent' } as const)
    if (setupOpen)
      return {
        status: {
          available: false,
          state: 'setup-open',
          ...(read.kind === 'record' && { setupAt: read.record.setupAt }),
        },
        ...(read.kind === 'record' && {
          repositoryRoot: read.record.repositoryRoot,
        }),
      }
    if (read.kind === 'unusable')
      return {
        status: { available: false, state: 'unusable' },
        unusableReason: read.reason,
      }
    if (read.kind === 'absent')
      return { status: { available: false, state: 'none' } }
    const { record } = read
    return {
      record,
      repositoryRoot: record.repositoryRoot,
      status: {
        available: record.confirmed,
        state: record.confirmed ? 'saved' : 'unconfirmed',
        setupAt: record.setupAt,
      },
    }
  }

  /**
   * Answers what the status item and the setup need beyond {@link SavedSessionStore.describe}: the repository name, whether the last setup was confirmed, the app's cookie kind, why a folder is unusable, and whether a setup of this window holds the folder.
   * @param repositoryRoot - The workspace repository root.
   * @returns The view; carries no path, hash or cookie value.
   * @example
   * await store.describeForUi('/work/app') // => { available: true, state: 'saved', repositoryName: 'app', confirmed: true, appCookies: 'persistent', setupOpenHere: false }
   */
  async describeForUi(repositoryRoot: string): Promise<SavedSessionView> {
    const target = await this.folderOf(repositoryRoot)
    const { status, record, unusableReason } = await this.statusOf(target)
    return {
      ...status,
      repositoryName: target.repositoryName,
      ...(record !== undefined && {
        confirmed: record.confirmed,
        appCookies: record.appCookies,
      }),
      ...(unusableReason !== undefined && { unusableReason }),
      setupOpenHere: this.holds.get(target.hash)?.holder === 'setup',
    }
  }

  /** Says whether a live setup holds the lock; a stale or absent lock is no setup. */
  private async isSetupOpen(target: SessionTarget): Promise<boolean> {
    const holder = await readSignInLock(target.lockPath)
    if (holder?.holder !== 'setup') return false
    return !(await isStaleStorageLock(
      target.lockPath,
      await this.identity(),
      this.readStart,
    ))
  }

  /**
   * Lists the saved sessions of this host, the workspace's first; the removal quick pick reads it.
   * @param currentRepositoryRoot - The workspace repository root.
   * @returns One entry per folder named like a session; empty when none exists.
   * @example
   * await store.list('/work/app') // => [{ hash: 'ab12…', repositoryName: 'app', state: 'saved', isCurrent: true }]
   */
  async list(currentRepositoryRoot: string): Promise<SavedSessionEntry[]> {
    const current = await this.folderOf(currentRepositoryRoot)
    const names = await readdir(this.root).catch((error: unknown) => {
      if (systemErrorCode(error) === 'ENOENT') return []
      throw error
    })
    const hashes = names.filter((name) => SESSION_FOLDER_NAME.test(name))
    // The folders are independent of each other, so they are read at once.
    const entries = await Promise.all(
      hashes.map((hash) => this.entryOf(hash, hash === current.hash)),
    )
    return entries.sort(
      (left, right) => Number(right.isCurrent) - Number(left.isCurrent),
    )
  }

  /** One entry of {@link SavedSessionStore.list}: its repository and state come from the same read of `signin.json`. */
  private async entryOf(
    hash: string,
    isCurrent: boolean,
  ): Promise<SavedSessionEntry> {
    const { status, repositoryRoot } = await this.statusOf(
      this.targetOf(hash, ''),
    )
    return {
      hash,
      ...(repositoryRoot !== undefined && { repositoryRoot }),
      repositoryName: repositoryRoot
        ? basename(repositoryRoot)
        : 'unknown repository',
      state: status.state,
      ...(status.setupAt !== undefined && { setupAt: status.setupAt }),
      isCurrent,
    }
  }

  /** Makes `sign-in-profiles` and a session folder with mode 0700 (the explicit chmod beats the umask). */
  private async prepareFolder(target: SessionTarget): Promise<void> {
    for (const directory of [this.root, target.folder]) {
      await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
      await chmod(directory, PRIVATE_DIRECTORY_MODE)
    }
  }

  /**
   * Takes the lock beside the folder with an exclusive create, taking over one whose holder is gone (pid missing or start time differs).
   * @returns The held lock, or the conflict with a live or unreadable holder.
   */
  private async takeLock(
    target: SessionTarget,
    purpose: SignInLockPurpose,
    runId?: string,
  ): Promise<{ held: HeldLock } | { conflict: SignInLockConflict }> {
    await this.retryUnreleased(target)
    await mkdir(this.root, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
    await chmod(this.root, PRIVATE_DIRECTORY_MODE)
    const identity = await this.identity()
    const record: SignInLockRecord = {
      pid: process.pid,
      ...identity,
      holder: purpose,
      ...(runId !== undefined && { runId }),
      windowSession: this.options.windowSession,
      token: randomUUID(),
      createdAt: new Date((this.options.now ?? Date.now)()).toISOString(),
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await placeStorageLock(target.lockPath, record)
        return {
          held: { token: record.token, processStart: record.processStart },
        }
      } catch (error) {
        if (systemErrorCode(error) !== 'EEXIST') throw error
        // A lock of a gone holder is removed under a claim, then the create is tried once more.
        if (attempt === 0)
          await removeStaleStorageLock(
            target.lockPath,
            identity,
            this.readStart,
          )
      }
    }
    return {
      conflict: lockConflictOf(
        await readSignInLock(target.lockPath),
        purpose,
        this.options.windowSession,
        process.pid,
      ),
    }
  }

  /** Takes the lock or throws the coded refusal. */
  private async lockOrThrow(
    target: SessionTarget,
    purpose: SignInLockPurpose,
    runId?: string,
  ): Promise<HeldLock> {
    const taken = await this.takeLock(target, purpose, runId)
    if ('conflict' in taken)
      throw savedSessionRefusal(taken.conflict, target.repositoryName)
    this.registerHold(target.hash, purpose, runId)
    return taken.held
  }

  private registerHold(
    hash: string,
    holder: SignInLockPurpose,
    runId?: string,
  ): void {
    let markReleased = (): void => undefined
    const released = new Promise<void>((resolve) => {
      markReleased = resolve
    })
    this.holds.set(hash, {
      holder,
      ...(runId !== undefined && { runId }),
      released,
      markReleased,
    })
    this.emit(hash)
  }

  /**
   * Removes the lock only while it still names this process, the start this hold wrote and this hold's token, then ends the hold; a lock that is gone already counts as removed.
   * @throws What removing this hold's lock threw for another reason than its absence (`EACCES`, `EPERM`, `EBUSY`); the hold is then kept, so {@link SavedSessionStore.whenReleased} stays pending and a later release tries again.
   */
  private async releaseLock(
    target: SessionTarget,
    held: HeldLock,
  ): Promise<void> {
    const record = await readSignInLock(target.lockPath)
    // The start is compared with the one this hold wrote: a start unreadable at the take and readable now must not disown the lock.
    const isOurs =
      record !== undefined &&
      record.pid === process.pid &&
      record.token === held.token &&
      record.processStart === held.processStart
    if (isOurs) await unlink(target.lockPath).catch(passIfMissing)
    this.holds.get(target.hash)?.markReleased()
    this.holds.delete(target.hash)
    this.emit(target.hash)
  }

  /**
   * Tries again the release of a hold whose lock a fresh admission could not remove; called by {@link SavedSessionStore.takeLock} before every take, so a lock that was only busy for a moment never keeps refusing this window's next run, setup or removal.
   * A release that fails again keeps the hold for the next take; the take then meets this window's own lock as a conflict.
   */
  private async retryUnreleased(target: SessionTarget): Promise<void> {
    const held = this.unreleased.get(target.hash)
    if (held === undefined) return
    await this.releaseLock(target, held).then(
      () => this.unreleased.delete(target.hash),
      () => undefined,
    )
  }

  private emit(hash: string): void {
    for (const listener of this.listeners) listener(hash)
  }

  /**
   * Subscribes to changes of a hold or a record, for the status item.
   * @param listener - Called with the session's hash.
   * @returns The unsubscribe function.
   * @example
   * const stop = store.onDidChange(() => refresh())
   */
  onDidChange(listener: (hash: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Resolves when this window's hold on a session is released (at once when it holds none); the removal waits on it after stopping a run.
   * @param hash - The session's hash.
   * @example
   * await store.whenReleased(target.hash)
   */
  whenReleased(hash: string): Promise<void> {
    return this.holds.get(hash)?.released ?? Promise.resolve()
  }

  private listAgain(): Promise<ListedProcess[]> {
    return (this.options.listProcesses ?? listProcesses)({
      keepsUnconfirmedOwners: true,
      withParentPids: true,
    })
  }

  /**
   * Proves nothing uses the folder, from a fresh listing. A listing that cannot be made proves nothing and refuses. A process that names the folder refuses, except an orphan Chrome that the owned-browser marker proves (pid, executable, the exact folder and the browser's own start, with no stranger naming the folder) and that is stopped.
   * Why an orphan may be stopped whenever the caller just took the lock: every holder releases its lock only after its Chrome's exit was confirmed, so a Chrome the marker proves while this call holds the lock was left by a holder that is gone (an editor that was killed, a recovery that failed to stop it before). The permission comes from that proof, not from whether this very call removed the dead holder's lock, so a recovery that failed once is tried again by the next run, setup or removal.
   * @param mayStopOrphan - `true` when the caller took the lock right before (admission, setup, removal); `false` for a lease's launch preparation, which refuses any process instead.
   * @returns `true` only when no process names the folder at the end.
   */
  private async isUnused(
    target: SessionTarget,
    mayStopOrphan: boolean,
  ): Promise<boolean> {
    try {
      const named = await profileProcesses(
        target.folder,
        await this.listAgain(),
        {
          pathsMayNotResolve: true,
        },
      )
      if (named.length === 0) return true
      const marker = await readOwnedBrowserMarker(target.folder)
      if (!mayStopOrphan || marker === undefined) return false
      return await stopOrphanBrowser(
        target.folder,
        marker,
        {
          stopper: this.options.stopper ?? REAL_PROCESS_STOPPER,
          listAgain: () => this.listAgain(),
        },
        { readStart: this.readStart },
      )
    } catch {
      // A failed listing is not "nobody uses it".
      return false
    }
  }

  /** The fresh proof, then Singleton entries, a stale port file and the Preferences: what every launch on the folder needs. */
  private async prepareLaunch(
    target: SessionTarget,
    mayStopOrphan: boolean,
  ): Promise<void> {
    if (!(await this.isUnused(target, mayStopOrphan)))
      throw savedSessionRefusal(
        { code: 'SIGN_IN_PROFILE_IN_USE' },
        target.repositoryName,
      )
    await removeStaleChromeSingletons(target.folder)
    await unlink(join(target.folder, DEVTOOLS_ACTIVE_PORT_FILE)).catch(
      () => undefined,
    )
    await ensureSignInPreferences(target.folder)
  }

  /**
   * Records the Chrome a lease launched, with its own start, in the folder's owned-browser marker: the proof by which a later run, setup or removal may stop it as an orphan.
   * Published atomically ({@link atomicPrivateBytes}): an editor that dies mid-write leaves the earlier marker or the whole new one, never a truncated file that would leave the orphan unprovable, and a link at the marker's name is replaced, never written through.
   */
  private async writeMarker(
    target: SessionTarget,
    marker: OwnedBrowserMarker & { pid: number },
  ): Promise<void> {
    const processStart = await this.readStart(marker.pid)
    const recorded: OwnedBrowserMarker = {
      ...marker,
      ...(processStart !== undefined && { processStart }),
    }
    await atomicPrivateBytes(
      join(target.folder, OWNED_BROWSER_MARKER_FILE),
      JSON.stringify(recorded),
    )
  }

  /**
   * Runs a step of an admission, a setup or a removal and rethrows its failure without the saved-session folder: a file-system error names the folder (the user's home and the repository's hash), and the run turns it into the chat error and the `run.failed` record.
   * Every spelling is hidden: the folder, the sessions folder, their real paths and the bare hash ({@link hideSavedProfilePath}); a coded refusal that names none stays the very error ({@link errorWithPathHidden}).
   * @param target - The session whose folder is hidden.
   * @param step - The step.
   * @returns What the step returned.
   * @throws The step's failure, its words without the folder.
   */
  private async withFolderHidden<Value>(
    target: SessionTarget,
    step: () => Promise<Value>,
  ): Promise<Value> {
    try {
      return await step()
    } catch (error) {
      const spellings = [target.folder, this.root, target.hash]
      // The real paths differ where a parent is a link (`/var` and `/private/var` on macOS).
      for (const path of [target.folder, this.root])
        spellings.push(await realpath(path).catch(() => path))
      throw errorWithPathHidden(error, (text) =>
        hideSavedProfilePath(text, spellings),
      )
    }
  }

  /**
   * Admits a version 3 run to the saved session, atomically under the folder's lock, or tells it to run with a fresh profile.
   * A repository that never had a setup, and a run whose configuration declared `session: "fresh"` (request `mode: 'fresh'`) whatever the saved session's state, are answered `no-saved-session` without creating a folder, a lock or a record. The Chrome rule (D12): a run Chrome whose major is lower than the recorded one, or unreadable, is refused `chrome-version`; a higher one is accepted and recorded. No error it throws names the folder ({@link SavedSessionStore.withFolderHidden}).
   * @param request - See {@link SavedSessionRunRequest}.
   * @returns The saved session with its lease, or the fresh answer.
   * @throws `SIGN_IN_IN_PROGRESS` (a setup is open, also for `mode: 'fresh'`), `BUSY` (reason profile-in-use), `SIGN_IN_PROFILE_IN_USE`, `SIGN_IN_PROFILE_UNUSABLE`; a file-system failure with the folder hidden.
   * @example
   * const admission = await store.acquireForRun({ repositoryRoot, runId, mode: 'saved-if-available', chromeVersion: 'Google Chrome 154.0.1.2', signal })
   */
  async acquireForRun(
    request: SavedSessionRunRequest,
  ): Promise<SavedSessionRunAdmission> {
    request.signal.throwIfAborted()
    const target = await this.folderOf(request.repositoryRoot)
    return this.withFolderHidden(target, () => this.admit(target, request))
  }

  /** The steps of {@link SavedSessionStore.acquireForRun} once the folder is named. */
  private async admit(
    target: SessionTarget,
    request: SavedSessionRunRequest,
  ): Promise<SavedSessionRunAdmission> {
    // A setup that is open refuses every run, also one that wants a fresh profile (its dev server owns the port).
    if (await this.isSetupOpen(target))
      throw savedSessionRefusal(
        { code: 'SIGN_IN_IN_PROGRESS', heldBy: 'setup' },
        target.repositoryName,
      )
    // A run that declared a fresh profile never uses the saved session, so an unfinished setup is not its reason either.
    if (request.mode === 'fresh')
      return { session: 'fresh', signInRequiredReason: 'no-saved-session' }
    const proof = await proveSessionFolder(this.root, target.hash)
    if (!proof.ok)
      throw savedSessionUnusable('not-a-session-folder', target.repositoryName)
    // Nothing was ever set up here: no folder, lock or record is created.
    if (!proof.exists)
      return { session: 'fresh', signInRequiredReason: 'no-saved-session' }
    const held = await this.lockOrThrow(target, 'run', request.runId)
    const admission = await this.releasingOnFailure(target, held, () =>
      this.admitUnderLock(target, held, request),
    )
    // A fresh answer holds nothing: the lock goes before the run starts.
    if (admission.session === 'fresh') await this.releaseFreshHold(target, held)
    return admission
  }

  /**
   * Releases the lock a fresh admission took. The fresh run needs no lock, so a release that fails (`EBUSY`, `EPERM`) does not fail it: the hold stays, {@link SavedSessionStore.whenReleased} stays pending, and the next take of the session tries the release again ({@link SavedSessionStore.retryUnreleased}).
   */
  private async releaseFreshHold(
    target: SessionTarget,
    held: HeldLock,
  ): Promise<void> {
    await this.releaseLock(target, held).catch(() => {
      this.unreleased.set(target.hash, held)
    })
  }

  /**
   * Runs a step under a lock this call just took; a step that fails releases the lock and throws its own error.
   * A release that fails as well is not what the caller learns: the hold is kept, as the lock still names this window.
   */
  private async releasingOnFailure<Value>(
    target: SessionTarget,
    held: HeldLock,
    step: () => Promise<Value>,
  ): Promise<Value> {
    try {
      return await step()
    } catch (error) {
      await this.releaseLock(target, held).catch(() => undefined)
      throw error
    }
  }

  /** Decides the admission under the run's lock; a fresh answer leaves the release to {@link SavedSessionStore.acquireForRun}. */
  private async admitUnderLock(
    target: SessionTarget,
    held: HeldLock,
    request: SavedSessionRunRequest,
  ): Promise<SavedSessionRunAdmission> {
    const read = await readSignInRecord(target.folder)
    if (read.kind === 'absent')
      return { session: 'fresh', signInRequiredReason: 'no-saved-session' }
    if (read.kind === 'unusable')
      throw savedSessionUnusable(read.reason, target.repositoryName)
    if (!read.record.confirmed)
      return { session: 'fresh', signInRequiredReason: 'setup-not-finished' }
    const major = chromeMajorOf(request.chromeVersion)
    // D12: refuse a downgrade or a Chrome whose major cannot be read.
    if (major === undefined || major < read.record.chromeMajor)
      throw savedSessionUnusable('chrome-version', target.repositoryName)
    await this.prepareLaunch(target, true)
    if (major > read.record.chromeMajor)
      await writeSignInRecord(target.folder, {
        ...read.record,
        chromeMajor: major,
      })
    return { session: 'saved', lease: this.runLease(target, held, read.record) }
  }

  private runLease(
    target: SessionTarget,
    held: HeldLock,
    record: SignInRecord,
  ): SavedSessionRunLease {
    // A release that failed is tried again by the next call (the run's retried Stop).
    const releaser = new SharedAttempt(() => this.finishRunLease(target, held))
    return {
      profile: target.folder,
      setupAt: record.setupAt,
      appCookies: record.appCookies,
      // A run's Chrome is launched through the debugger, so it leads no group of Codebook's.
      recordBrowser: (marker): Promise<void> =>
        this.writeMarker(target, { ...marker, launchKind: 'attached' }),
      prepareForLaunch: (): Promise<void> => this.prepareLaunch(target, false),
      release: (): Promise<void> => releaser.run(),
    }
  }

  private async finishRunLease(
    target: SessionTarget,
    held: HeldLock,
  ): Promise<void> {
    // The marker described a browser that is gone; the lock goes after it.
    await unlink(join(target.folder, OWNED_BROWSER_MARKER_FILE)).catch(
      () => undefined,
    )
    await this.releaseLock(target, held)
  }

  /**
   * Takes the folder for a setup: proves the entry is a real folder of this user inside `sign-in-profiles` (or absent), creates it (0700), refuses an unusable record, runs the launch preparation, and withdraws an earlier Done on disk before the setup browser can change the profile.
   * @param repositoryRoot - The workspace repository root.
   * @returns The setup lease.
   * @throws `SIGN_IN_IN_PROGRESS` (another setup), `SIGN_IN_PROFILE_IN_USE` (a run, a removal or an unprovable Chrome), `SIGN_IN_PROFILE_UNUSABLE` (reason `not-a-session-folder` for a link, a file, a folder that cannot be proven or a record of another repository); a file-system failure with the folder hidden ({@link SavedSessionStore.withFolderHidden}).
   * @example
   * const lease = await store.acquireForSetup('/work/app')
   */
  async acquireForSetup(
    repositoryRoot: string,
  ): Promise<SavedSessionSetupLease> {
    const target = await this.folderOf(repositoryRoot)
    return this.withFolderHidden(target, async () => {
      const held = await this.lockOrThrow(target, 'setup')
      return this.releasingOnFailure(target, held, () =>
        this.prepareSetup(target, held),
      )
    })
  }

  /** The steps of {@link SavedSessionStore.acquireForSetup} under its lock. */
  private async prepareSetup(
    target: SessionTarget,
    held: HeldLock,
  ): Promise<SavedSessionSetupLease> {
    // The entry is proven before anything is created or its mode changed: a link is never followed, so Chrome never writes cookies outside the store.
    const proof = await proveSessionFolder(this.root, target.hash)
    if (!proof.ok)
      throw savedSessionUnusable('not-a-session-folder', target.repositoryName)
    await this.prepareFolder(target)
    const read = await readSignInRecord(target.folder)
    if (read.kind === 'unusable')
      throw savedSessionUnusable(read.reason, target.repositoryName)
    await this.prepareLaunch(target, true)
    const previous = read.kind === 'record' ? read.record : undefined
    // The earlier Done approved the profile as it was, and the setup browser may change it (another account): the approval is withdrawn on disk first, so Close setup, a crash or a failed final write reads setup-not-finished, never the old Done.
    if (previous?.confirmed)
      await writeSignInRecord(target.folder, { ...previous, confirmed: false })
    return this.setupLease(target, held, previous)
  }

  /**
   * The lease of a setup. Its record keeps the highest Chrome major that ever opened the profile (D12), and a setup that ends before its browser was launched gives the earlier record back.
   * Why the major never goes down: Chrome migrates a profile forward, so a setup on an older Chrome that wrote its own major would let a run on that older Chrome open a profile a newer one migrated; keeping the higher major keeps such a run refused (`chrome-version`). Refusing the setup instead is not possible here: its Chrome's version is known only once that Chrome opened the profile.
   * Why the earlier record comes back only without a launch: the setup calls `recordBrowser` right after its browser spawned, so a lease whose `recordBrowser` and `writeRecord` were never called ends with the profile as the earlier Done approved it (a cancel while the app starts, a server that failed to start); once a browser ran, only a new Done confirms the profile.
   */
  private setupLease(
    target: SessionTarget,
    held: HeldLock,
    previous: SignInRecord | undefined,
  ): SavedSessionSetupLease {
    let mayHaveChangedProfile = false
    // A release that failed is tried again by the next call.
    const releaser = new SharedAttempt(async () => {
      if (!mayHaveChangedProfile && previous?.confirmed)
        await this.restoreRecord(target, previous)
      await this.finishRunLease(target, held)
    })
    return {
      profile: target.folder,
      ...(previous !== undefined && { previous }),
      recordBrowser: (marker): Promise<void> => {
        mayHaveChangedProfile = true
        return this.writeMarker(target, marker)
      },
      // A setup's record holds exactly the known fields: nothing else the caller's object carries is written.
      writeRecord: async (fields): Promise<void> => {
        mayHaveChangedProfile = true
        await writeSignInRecord(target.folder, {
          version: SIGN_IN_RECORD_VERSION,
          confirmed: fields.confirmed,
          setupAt: fields.setupAt,
          signInPaths: [...fields.signInPaths],
          chromeMajor: Math.max(
            fields.chromeMajor,
            previous?.chromeMajor ?? fields.chromeMajor,
          ),
          repositoryRoot: target.realRoot,
          appCookies: fields.appCookies,
        })
        this.emit(target.hash)
      },
      release: (): Promise<void> => releaser.run(),
    }
  }

  /** Gives an untouched profile its earlier record back when a setup that never launched a browser releases it; a write that fails leaves the withdrawn Done (the safe side) and does not keep the lock. */
  private async restoreRecord(
    target: SessionTarget,
    previous: SignInRecord,
  ): Promise<void> {
    await writeSignInRecord(target.folder, previous).then(
      () => this.emit(target.hash),
      () => undefined,
    )
  }

  /**
   * Deletes a saved session directly (never to the Trash) after the path proof, holding the lock beside the folder from before the first deletion until after the last, so a second window cannot create files in a folder being deleted.
   * @param entry - A session from {@link SavedSessionStore.list}.
   * @returns What happened; every outcome but `removed` leaves the session as it was or partly deleted. A deletion whose lock cannot be removed afterwards is `partly-removed` with the lock's cause, and this window keeps the hold.
   * @example
   * await store.remove(entry) // => { outcome: 'removed' }
   */
  async remove(
    entry: Pick<SavedSessionEntry, 'hash' | 'repositoryName'>,
  ): Promise<SavedSessionRemoval> {
    const target = this.targetOf(entry.hash, entry.repositoryName)
    const first = await this.proofOf(target)
    if (first !== undefined) return first
    return this.withFolderHidden(target, () => this.removeLocked(target))
  }

  /** The steps of {@link SavedSessionStore.remove} after the first path proof: the lock, the deletion under it, then the lock's release. */
  private async removeLocked(
    target: SessionTarget,
  ): Promise<SavedSessionRemoval> {
    const taken = await this.takeLock(target, 'removal')
    if ('conflict' in taken) return this.removalRefusal(taken.conflict)
    this.registerHold(target.hash, 'removal')
    const removal = await this.releasingOnFailure(target, taken.held, () =>
      this.removeUnderLock(target),
    )
    try {
      await this.releaseLock(target, taken.held)
      return removal
    } catch (error) {
      // The lock outlived the deletion and still names this window, so the removal is not complete.
      return removal.outcome === 'removed'
        ? {
            outcome: 'partly-removed',
            cause: systemErrorCode(error) || 'unknown',
          }
        : removal
    }
  }

  /** The steps of {@link SavedSessionStore.remove} under its lock: the path proof again, the fresh process listing, then the deletion. */
  private async removeUnderLock(
    target: SessionTarget,
  ): Promise<SavedSessionRemoval> {
    // The proof is made again under the lock: the folder may have changed since the first look.
    const again = await this.proofOf(target)
    if (again !== undefined) return again
    if (!(await this.isUnused(target, true)))
      return { outcome: 'in-use-elsewhere' }
    return this.deleteFolder(target)
  }

  /**
   * The removal's path proof: the name is a session hash and the entry a real folder of this user directly inside `sign-in-profiles` ({@link proveSessionFolder}). Nothing in the folder is read before its name is proven, and its record is not read at all: a folder whose record names another repository (copied or edited by hand) reads unusable everywhere else, and removal is the way out of it.
   * @returns `undefined` when the folder may be deleted, else the refusal.
   */
  private async proofOf(
    target: SessionTarget,
  ): Promise<SavedSessionRemoval | undefined> {
    const proof = await proveSessionFolder(this.root, target.hash)
    return proof.ok
      ? undefined
      : { outcome: 'refused-path', reason: proof.reason }
  }

  private removalRefusal(conflict: SignInLockConflict): SavedSessionRemoval {
    if (conflict.code === 'SIGN_IN_IN_PROGRESS')
      return { outcome: 'setup-open' }
    if (conflict.runInThisWindow !== undefined)
      return { outcome: 'run-in-this-window', runId: conflict.runInThisWindow }
    return { outcome: 'in-use-elsewhere' }
  }

  private async deleteFolder(
    target: SessionTarget,
  ): Promise<SavedSessionRemoval> {
    const removeFolder = this.options.removeFolder ?? removeSessionFolder
    // Proven once more right before the first deletion: the listing and an orphan's stop took time since the last proof, and the record goes by its path, which a folder swapped for a link would lead elsewhere.
    const again = await this.proofOf(target)
    if (again !== undefined) return again
    try {
      // The record goes first so a reader never sees a half-deleted session as saved.
      await unlink(join(target.folder, SIGN_IN_RECORD_FILE)).catch(
        () => undefined,
      )
      await removeFolder(target.folder)
      return { outcome: 'removed' }
    } catch (error) {
      return {
        outcome: 'partly-removed',
        cause: systemErrorCode(error) || 'unknown',
      }
    }
  }

  /**
   * Remembers the sign-in paths of the last version 3 run for the next setup's default; creates no folder or record.
   * @param repositoryRoot - The workspace repository root.
   * @param paths - Up to {@link SIGN_IN_PATH_LIMIT} paths.
   * @example
   * await store.rememberSignInPaths('/work/app', ['/login'])
   */
  async rememberSignInPaths(
    repositoryRoot: string,
    paths: readonly string[],
  ): Promise<void> {
    const { hash } = await this.folderOf(repositoryRoot)
    const { memento } = this.options
    if (memento === undefined) return
    const all =
      memento.get<Record<string, string[]>>(SAVED_SESSION_LAST_PATHS_KEY) ?? {}
    await memento.update(SAVED_SESSION_LAST_PATHS_KEY, {
      ...all,
      [hash]: paths.slice(0, SIGN_IN_PATH_LIMIT),
    })
  }

  /**
   * The paths {@link SavedSessionStore.rememberSignInPaths} kept for a repository.
   * @param repositoryRoot - The workspace repository root.
   * @returns The paths, or none.
   * @example
   * await store.lastSignInPaths('/work/app') // => ['/login']
   */
  async lastSignInPaths(repositoryRoot: string): Promise<readonly string[]> {
    const { hash } = await this.folderOf(repositoryRoot)
    return (
      this.options.memento?.get<Record<string, string[]>>(
        SAVED_SESSION_LAST_PATHS_KEY,
      )?.[hash] ?? []
    )
  }
}

/**
 * Deletes a session folder without following links, trying again while the system answers busy; the store's default `removeFolder`.
 * @param folder - The proven session folder.
 * @example
 * await removeSessionFolder('/storage/sign-in-profiles/ab12…')
 */
async function removeSessionFolder(folder: string): Promise<void> {
  await retryWhileBusy(
    () => removeWithoutFollowing(folder),
    SIGN_IN_REMOVE_RETRIES,
    SIGN_IN_REMOVE_RETRY_DELAY_MS,
  )
}

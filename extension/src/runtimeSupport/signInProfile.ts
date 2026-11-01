import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readdir, realpath, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'

import {
  PRIVATE_DIRECTORY_MODE,
  SAVED_SESSION_LAST_PATHS_KEY,
  SIGN_IN_LOCK_FILE,
  SIGN_IN_PATH_LIMIT,
  SIGN_IN_PROFILES_DIRECTORY,
  SIGN_IN_REMOVE_RETRIES,
  SIGN_IN_REMOVE_RETRY_DELAY_MS,
  OWNED_BROWSER_MARKER_FILE,
} from '../constants'
import { currentStorageOwner } from '../utils/currentStorageOwner'
import { isStaleStorageLock } from '../utils/isStaleStorageLock'
import { placeStorageLock } from '../utils/placeStorageLock'
import {
  readProcessStart,
  type ProcessStartReader,
} from '../utils/readProcessStart'
import type { StorageOwnerIdentity } from '../utils/readRecordedOwner'
import { removeStaleStorageLock } from '../utils/removeStaleStorageLock'
import { removeWithoutFollowing } from '../utils/removeWithoutFollowing'
import { retryWhileBusy } from '../utils/retryWhileBusy'
import { systemErrorCode } from '../utils/systemErrorCode'

import type {
  SavedSessionRunAdmission,
  SavedSessionRunLease,
  SavedSessionRunRequest,
  SavedSessionState,
  SavedSessionStatus,
  SavedSessionStorePort,
} from './savedSessionTypes'
import { chromeMajorOf } from './utils/chromeMajorOf'
import { ensureSignInPreferences } from './utils/ensureSignInPreferences'
import {
  listProcesses,
  type ListedProcess,
  type ProcessListingInputs,
} from './utils/listProcesses'
import {
  readOwnedBrowserMarker,
  writeOwnedBrowserMarker,
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

/** One saved session on this host, as the removal list shows it. */
export type SavedSessionEntry = {
  hash: string
  /** The repository's real path when `signin.json` names it; never shown to the learner. */
  repositoryRoot?: string
  /** The repository's folder name for display. */
  repositoryName: string
  state: SavedSessionState
  setupAt?: string
  /** `true` for the workspace repository of the window that asked. */
  isCurrent: boolean
}

/** The hold a setup takes on a saved-session folder while its browser is open. */
export type SavedSessionSetupLease = {
  /** The user-data-dir the setup browser opens; never journaled. */
  readonly profile: string
  /** The record of the earlier setup, if any. */
  readonly previous?: SignInRecord
  /** Records the setup browser for crash recovery; `launchKind` is `detached` when it leads its own process group. */
  recordBrowser(marker: {
    executable: string
    pid: number
    launchKind?: 'detached' | 'attached'
  }): Promise<void>
  /** Writes `signin.json` atomically; `version` and `repositoryRoot` are added. */
  writeRecord(
    fields: Pick<
      SignInRecord,
      'confirmed' | 'setupAt' | 'signInPaths' | 'chromeMajor' | 'appCookies'
    >,
  ): Promise<void>
  release(): Promise<void>
}

/** What a removal did. `partly-removed` keeps whatever the system refused to delete. */
export type SavedSessionRemoval =
  | { outcome: 'removed' }
  | { outcome: 'run-in-this-window'; runId: string }
  | { outcome: 'in-use-elsewhere' }
  | { outcome: 'setup-open' }
  | { outcome: 'refused-path'; reason: string }
  | { outcome: 'partly-removed'; cause: string }

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
  /** `true` when the lock was taken over from a holder that no longer exists. */
  wasStale: boolean
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
 * const admission = await store.acquireForRun({ repositoryRoot, runId, session: 'saved-if-available', chromeVersion, signal })
 */
export class SavedSessionStore implements SavedSessionStorePort {
  private readonly root: string
  private readonly holds = new Map<string, WindowHold>()
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

  private async statusOf(
    target: SessionTarget,
  ): Promise<{ status: SavedSessionStatus; record?: SignInRecord }> {
    const proof = await proveSessionFolder(this.root, target.hash)
    if (!proof.ok) return { status: { available: false, state: 'unusable' } }
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
      }
    if (read.kind === 'unusable')
      return { status: { available: false, state: 'unusable' } }
    if (read.kind === 'absent')
      return { status: { available: false, state: 'none' } }
    const { record } = read
    return {
      record,
      status: {
        available: record.confirmed,
        state: record.confirmed ? 'saved' : 'unconfirmed',
        setupAt: record.setupAt,
      },
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
    const entries: SavedSessionEntry[] = []
    for (const hash of names.filter((name) => SESSION_FOLDER_NAME.test(name)))
      entries.push(await this.entryOf(hash, hash === current.hash))
    return entries.sort(
      (left, right) => Number(right.isCurrent) - Number(left.isCurrent),
    )
  }

  private async entryOf(
    hash: string,
    isCurrent: boolean,
  ): Promise<SavedSessionEntry> {
    const read = await readSignInRecord(join(this.root, hash))
    const repositoryRoot =
      read.kind === 'record' ? read.record.repositoryRoot : undefined
    const { status } = await this.statusOf(this.targetOf(hash, ''))
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
    let wasStale = false
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await placeStorageLock(target.lockPath, record)
        return { held: { token: record.token, wasStale } }
      } catch (error) {
        if (systemErrorCode(error) !== 'EEXIST') throw error
        // A lock of a gone holder is removed under a claim, then the create is tried once more.
        if (
          attempt === 0 &&
          (await removeStaleStorageLock(
            target.lockPath,
            identity,
            this.readStart,
          ))
        )
          wasStale = true
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

  /** Removes the lock only while it still names this process, its start and this hold's token. */
  private async releaseLock(
    target: SessionTarget,
    held: HeldLock,
  ): Promise<void> {
    const record = await readSignInLock(target.lockPath)
    const identity = await this.identity()
    const isOurs =
      record !== undefined &&
      record.pid === process.pid &&
      record.token === held.token &&
      record.processStart === identity.processStart
    if (isOurs) await unlink(target.lockPath).catch(() => undefined)
    this.holds.get(target.hash)?.markReleased()
    this.holds.delete(target.hash)
    this.emit(target.hash)
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
   * Proves nothing uses the folder, from a fresh listing. A listing that cannot be made proves nothing and refuses. A process that names the folder refuses, except the Chrome of a stale holder that the owned-browser marker proves (pid, executable, folder and the browser's own start) and that is stopped.
   * @returns `true` only when no process names the folder at the end.
   */
  private async isUnused(
    target: SessionTarget,
    wasStale: boolean,
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
      if (!wasStale || marker === undefined) return false
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
    wasStale: boolean,
  ): Promise<void> {
    if (!(await this.isUnused(target, wasStale)))
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

  private async writeMarker(
    target: SessionTarget,
    marker: OwnedBrowserMarker & { pid: number },
  ): Promise<void> {
    const processStart = await this.readStart(marker.pid)
    await writeOwnedBrowserMarker(target.folder, {
      ...marker,
      ...(processStart !== undefined && { processStart }),
    })
  }

  /**
   * Admits a version 3 run to the saved session, atomically under the folder's lock, or tells it to run with a fresh profile.
   * A repository that never had a setup is answered `no-saved-session` without creating a folder, a lock or a record. The Chrome rule (D12): a run Chrome whose major is lower than the recorded one, or unreadable, is refused `chrome-version`; a higher one is accepted and recorded.
   * @param request - See {@link SavedSessionRunRequest}.
   * @returns The saved session with its lease, or the fresh answer.
   * @throws `SIGN_IN_IN_PROGRESS` (a setup is open, also for `session: 'fresh'`), `BUSY` (reason profile-in-use), `SIGN_IN_PROFILE_IN_USE`, `SIGN_IN_PROFILE_UNUSABLE`.
   * @example
   * const admission = await store.acquireForRun({ repositoryRoot, runId, session: 'saved-if-available', chromeVersion: 'Google Chrome 154.0.1.2', signal })
   */
  async acquireForRun(
    request: SavedSessionRunRequest,
  ): Promise<SavedSessionRunAdmission> {
    request.signal.throwIfAborted()
    const target = await this.folderOf(request.repositoryRoot)
    // A setup that is open refuses every run, also one that wants a fresh profile (its dev server owns the port).
    if (await this.isSetupOpen(target))
      throw savedSessionRefusal(
        { code: 'SIGN_IN_IN_PROGRESS', heldBy: 'setup' },
        target.repositoryName,
      )
    if (request.session === 'fresh') return this.freshAdmission(target)
    const proof = await proveSessionFolder(this.root, target.hash)
    if (!proof.ok)
      throw savedSessionUnusable('not-a-session-folder', target.repositoryName)
    // Nothing was ever set up here: no folder, lock or record is created.
    if (!proof.exists)
      return { session: 'fresh', signInRequiredReason: 'no-saved-session' }
    const held = await this.lockOrThrow(target, 'run', request.runId)
    try {
      return await this.admitUnderLock(target, held, request)
    } catch (error) {
      await this.releaseLock(target, held)
      throw error
    }
  }

  private async freshAdmission(
    target: SessionTarget,
  ): Promise<SavedSessionRunAdmission> {
    const read = await readSignInRecord(target.folder)
    const unconfirmed = read.kind === 'record' && !read.record.confirmed
    return {
      session: 'fresh',
      signInRequiredReason: unconfirmed
        ? 'setup-not-finished'
        : 'no-saved-session',
    }
  }

  private async admitUnderLock(
    target: SessionTarget,
    held: HeldLock,
    request: SavedSessionRunRequest,
  ): Promise<SavedSessionRunAdmission> {
    const read = await readSignInRecord(target.folder)
    if (read.kind === 'absent') {
      await this.releaseLock(target, held)
      return { session: 'fresh', signInRequiredReason: 'no-saved-session' }
    }
    if (read.kind === 'unusable')
      throw savedSessionUnusable(read.reason, target.repositoryName)
    if (!read.record.confirmed) {
      await this.releaseLock(target, held)
      return { session: 'fresh', signInRequiredReason: 'setup-not-finished' }
    }
    const major = chromeMajorOf(request.chromeVersion)
    // D12: refuse a downgrade or a Chrome whose major cannot be read.
    if (major === undefined || major < read.record.chromeMajor)
      throw savedSessionUnusable('chrome-version', target.repositoryName)
    await this.prepareLaunch(target, held.wasStale)
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
    let released: Promise<void> | undefined
    return {
      profile: target.folder,
      setupAt: record.setupAt,
      appCookies: record.appCookies,
      // A run's Chrome is launched through the debugger, so it leads no group of Codebook's.
      recordBrowser: (marker): Promise<void> =>
        this.writeMarker(target, { ...marker, launchKind: 'attached' }),
      prepareForLaunch: (): Promise<void> => this.prepareLaunch(target, false),
      release: (): Promise<void> =>
        (released ??= this.finishRunLease(target, held)),
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
   * Takes the folder for a setup: creates it (0700), refuses an unusable record, and runs the launch preparation.
   * @param repositoryRoot - The workspace repository root.
   * @returns The setup lease.
   * @throws `SIGN_IN_IN_PROGRESS` (another setup), `SIGN_IN_PROFILE_IN_USE` (a run, a removal or an unprovable Chrome), `SIGN_IN_PROFILE_UNUSABLE`.
   * @example
   * const lease = await store.acquireForSetup('/work/app')
   */
  async acquireForSetup(
    repositoryRoot: string,
  ): Promise<SavedSessionSetupLease> {
    const target = await this.folderOf(repositoryRoot)
    const held = await this.lockOrThrow(target, 'setup')
    try {
      await this.prepareFolder(target)
      const read = await readSignInRecord(target.folder)
      if (read.kind === 'unusable')
        throw savedSessionUnusable(read.reason, target.repositoryName)
      await this.prepareLaunch(target, held.wasStale)
      return this.setupLease(
        target,
        held,
        read.kind === 'record' ? read.record : undefined,
      )
    } catch (error) {
      await this.releaseLock(target, held)
      throw error
    }
  }

  private setupLease(
    target: SessionTarget,
    held: HeldLock,
    previous: SignInRecord | undefined,
  ): SavedSessionSetupLease {
    let released: Promise<void> | undefined
    return {
      profile: target.folder,
      ...(previous !== undefined && { previous }),
      recordBrowser: (marker): Promise<void> =>
        this.writeMarker(target, marker),
      writeRecord: async (fields): Promise<void> => {
        await writeSignInRecord(target.folder, {
          version: 1,
          ...fields,
          repositoryRoot: target.realRoot,
        })
        this.emit(target.hash)
      },
      release: (): Promise<void> =>
        (released ??= this.finishRunLease(target, held)),
    }
  }

  /**
   * Deletes a saved session directly (never to the Trash) after the path proof, holding the lock beside the folder from before the first deletion until after the last, so a second window cannot create files in a folder being deleted.
   * @param entry - A session from {@link SavedSessionStore.list}.
   * @returns What happened; every outcome but `removed` leaves the session as it was or partly deleted.
   * @example
   * await store.remove(entry) // => { outcome: 'removed' }
   */
  async remove(
    entry: Pick<SavedSessionEntry, 'hash' | 'repositoryName'>,
  ): Promise<SavedSessionRemoval> {
    const target = this.targetOf(entry.hash, entry.repositoryName)
    const first = await this.proofOf(target)
    if (first !== undefined) return first
    const taken = await this.takeLock(target, 'removal')
    if ('conflict' in taken) return this.removalRefusal(taken.conflict)
    this.registerHold(target.hash, 'removal')
    try {
      // The proof is made again under the lock: the folder may have changed since the first look.
      const again = await this.proofOf(target)
      if (again !== undefined) return again
      if (!(await this.isUnused(target, taken.held.wasStale)))
        return { outcome: 'in-use-elsewhere' }
      return await this.deleteFolder(target)
    } finally {
      await this.releaseLock(target, taken.held)
    }
  }

  private async proofOf(
    target: SessionTarget,
  ): Promise<SavedSessionRemoval | undefined> {
    const read = await readSignInRecord(target.folder)
    const proof = await proveSessionFolder(
      this.root,
      target.hash,
      read.kind === 'record' ? read.record.repositoryRoot : undefined,
    )
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
    try {
      // The record goes first so a reader never sees a half-deleted session as saved.
      await unlink(join(target.folder, 'signin.json')).catch(() => undefined)
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

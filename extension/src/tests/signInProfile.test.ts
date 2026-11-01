import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import fsPromises, {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { SavedSessionStore } from '../runtimeSupport/signInProfile'
import type { ListedProcess } from '../runtimeSupport/utils/listProcesses'
import { removeAbandonedProfiles } from '../runtimeSupport/utils/removeAbandonedProfiles'
import { sha256 } from '../runtimeSupport/utils/sha256'
import {
  readSignInRecord,
  writeSignInRecord,
} from '../runtimeSupport/utils/signInRecord'
import type { ProcessStopper } from '../runtimeSupport/utils/stopListedProcesses'
import { currentStorageOwner } from '../utils/currentStorageOwner'
import { readProcessStart } from '../utils/readProcessStart'
import { removeWithoutFollowing } from '../utils/removeWithoutFollowing'
import { systemErrorCode } from '../utils/systemErrorCode'

import { endProcessesAfter } from './utils/endProcessesAfter'
import { ID_OF_NO_PROCESS } from './utils/idOfNoProcess'

const RUN_CHROME = 'Google Chrome 154.0.1.2'

/** A storage root and a repository, in temporary folders; the storage path holds a space, as the editor's `Application Support` does. */
async function workspace(
  context: TestContext,
): Promise<{ storage: string; repository: string; hash: string }> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'codebook-saved-')))
  context.after(() => rm(base, { recursive: true, force: true }))
  const storage = join(base, 'Application Support', 'globalStorage')
  const repository = join(base, 'repo-app')
  await mkdir(storage, { recursive: true })
  await mkdir(repository)
  return { storage, repository, hash: sha256(await realpath(repository)) }
}

/** A store of one window; its process listing shows no process unless a test names one. */
function storeOf(
  storage: string,
  windowSession: string,
  extra: Partial<ConstructorParameters<typeof SavedSessionStore>[0]> = {},
): SavedSessionStore {
  return new SavedSessionStore({
    globalStorage: storage,
    windowSession,
    listProcesses: async () => [],
    ...extra,
  })
}

/** Finishes a setup the way Done does. */
async function finishSetup(
  store: SavedSessionStore,
  repository: string,
  fields: { confirmed?: boolean; chromeMajor?: number } = {},
): Promise<void> {
  const lease = await store.acquireForSetup(repository)
  await lease.writeRecord({
    confirmed: fields.confirmed ?? true,
    setupAt: '2026-11-02T12:10:00.000Z',
    signInPaths: ['/login'],
    chromeMajor: fields.chromeMajor ?? 154,
    appCookies: 'persistent',
  })
  await lease.release()
}

/** The request of a saved-if-available run. */
function runRequest(
  repositoryRoot: string,
  runId = 'run-1',
  chromeVersion = RUN_CHROME,
): Parameters<SavedSessionStore['acquireForRun']>[0] {
  return {
    repositoryRoot,
    runId,
    mode: 'saved-if-available',
    chromeVersion,
    signal: new AbortController().signal,
  }
}

/** Says what a rejected promise rejected with. */
async function rejection(promise: Promise<unknown>): Promise<StudyError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  assert.ok(error instanceof StudyError, 'expected a StudyError')
  return error
}

/** Says whether a path exists, links included. */
function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  )
}

/** Writes the lock file of a holder whose process is gone. */
async function writeDeadLock(
  storage: string,
  hash: string,
  holder: 'setup' | 'run',
): Promise<void> {
  const identity = await currentStorageOwner()
  await writeFile(
    join(storage, 'sign-in-profiles', `${hash}.signin.lock`),
    JSON.stringify({
      ...identity,
      processStart: undefined,
      pid: ID_OF_NO_PROCESS,
      holder,
      windowSession: 'killed-window',
      token: 'dead-token',
      createdAt: '2026-11-02T10:00:00.000Z',
    }),
  )
}

/** Starts a stand-in Chrome whose command line names `profile`. */
async function startBrowser(
  context: TestContext,
  profile: string,
): Promise<ChildProcess> {
  const browser = spawn(
    process.execPath,
    [
      '-e',
      'process.stdout.write("ready"); setInterval(() => {}, 1000)',
      'chrome',
      `--user-data-dir=${profile}`,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  endProcessesAfter(
    context,
    () => (browser.pid === undefined ? [] : [browser.pid]),
    { held: () => (browser.pid === undefined ? [] : [browser.pid]) },
  )
  await once(browser.stdout, 'data')
  return browser
}

/** A stopper that records the signals it was asked to send and sends none. */
function silentStopper(): { stopper: ProcessStopper; sent: number[] } {
  const sent: number[] = []
  return {
    sent,
    stopper: {
      platform: 'linux',
      signal: (pid, signal): void => {
        if (signal !== 0) sent.push(pid)
      },
      taskkill: async () => undefined,
      sleep: async () => undefined,
    },
  }
}

/** chmod denies nothing to root or on Windows, so a folder made read-only fails no removal there. */
const PERMISSIONS_DENY_NOTHING =
  process.platform === 'win32' || process.getuid?.() === 0

/** Runs `step` while `folder` has `mode`, and gives the folder 0700 back whatever happens, so the test's cleanup can delete it. */
async function withFolderMode<Value>(
  folder: string,
  mode: number,
  step: () => Promise<Value>,
): Promise<Value> {
  await chmod(folder, mode)
  try {
    return await step()
  } finally {
    await chmod(folder, 0o700)
  }
}

/** Says whether this window still holds the session: `released` once {@link SavedSessionStore.whenReleased} resolved, `held` while it is still pending after every queued callback ran. */
function holdState(
  store: SavedSessionStore,
  hash: string,
): Promise<'released' | 'held'> {
  return Promise.race([
    store.whenReleased(hash).then(() => 'released' as const),
    new Promise<'held'>((resolve) => setImmediate(() => resolve('held'))),
  ])
}

// Value: protects=E7 identity, CEO-R8 and CEO-V3 modes; fails_when=the folder is not named by the hash of the real path under sign-in-profiles, has a mode wider than 0700 (folder or parent), the lock lies inside the folder, or a symlinked workspace path yields a second folder; no_claim=Windows ACLs; the editor's real globalStorage
test('a saved session lives in a 0700 folder named by the hash of the real repository path, with its lock beside it', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const link = join(storage, 'workspace-link')
  await symlink(repository, link)
  const store = storeOf(storage, 'window-a')

  // Act
  const lease = await store.acquireForSetup(link)

  // Assert
  assert.equal(lease.profile, join(storage, 'sign-in-profiles', hash))
  if (process.platform !== 'win32') {
    assert.equal((await stat(lease.profile)).mode & 0o777, 0o700)
    assert.equal(
      (await stat(join(storage, 'sign-in-profiles'))).mode & 0o777,
      0o700,
    )
  }
  assert.deepEqual(await readdir(join(storage, 'sign-in-profiles')), [
    hash,
    `${hash}.signin.lock`,
  ])
  assert.equal(
    (await readdir(lease.profile)).some((name) => name.endsWith('.lock')),
    false,
  )
  await lease.release()
})

// Value: protects=AC2 per-root store; fails_when=two repository roots share one folder or one lock; no_claim=per-host separation (different globalStorage per editor)
test('a second repository root gets its own saved session', async (context) => {
  // Arrange
  const { storage, repository } = await workspace(context)
  const other = join(storage, 'second-repo')
  await mkdir(other)
  const store = storeOf(storage, 'window-a')

  // Act
  const first = await store.acquireForSetup(repository)
  const second = await store.acquireForSetup(other)

  // Assert
  assert.notEqual(first.profile, second.profile)
  await first.release()
  await second.release()
})

// Value: protects=AC2 and CEO-R8 sweep exclusion; fails_when=the orphan sweep of abandoned run profiles removes or touches a saved session whose editor was killed; no_claim=a future sweep of another root
test('the orphan sweep of abandoned run profiles leaves a saved session whose editor was killed', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  await finishSetup(storeOf(storage, 'window-a'), repository)
  await writeDeadLock(storage, hash, 'run')
  const root = join(storage, 'sign-in-profiles')
  const identity = await currentStorageOwner()

  // Act
  const removedInRoot = await removeAbandonedProfiles(
    root,
    identity,
    async () => [],
  )
  const removedInParent = await removeAbandonedProfiles(
    storage,
    identity,
    async () => [],
  )

  // Assert
  assert.deepEqual([removedInRoot, removedInParent], [[], []])
  assert.deepEqual((await readdir(join(root, hash))).sort(), [
    'Default',
    'signin.json',
  ])
})

// Value: protects=ENG-17 atomic write; fails_when=signin.json is written in place or a partial file or temporary file remains; no_claim=power loss on a real disk
test('a record write that fails before it is published leaves the earlier signin.json intact', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  await finishSetup(storeOf(storage, 'window-a'), repository)
  const folder = join(storage, 'sign-in-profiles', hash)
  const before = await readFile(join(folder, 'signin.json'), 'utf8')
  const read = await readSignInRecord(folder)
  assert.equal(read.kind, 'record')

  // Act
  const failing = writeSignInRecord(
    folder,
    {
      ...(read.kind === 'record' ? read.record : (undefined as never)),
      confirmed: false,
    },
    () => {
      throw new Error('stopped before the rename')
    },
  )

  // Assert
  await assert.rejects(failing, /stopped before the rename/)
  assert.equal(await readFile(join(folder, 'signin.json'), 'utf8'), before)
  assert.equal(
    (await readdir(folder)).some((name) => name.endsWith('.tmp')),
    false,
  )
})

// Value: protects=CEO-V5 and DX-6 status fields; fails_when=a state is misread, available is true for anything but saved, an unusable record is rewritten, or the status holds the folder path, the hash or a cookie; no_claim=the MCP transport
test('the saved session reads none, setup-open, saved, unconfirmed or unusable, with its setup time and no path', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  const otherWindow = storeOf(storage, 'window-b')
  const folder = join(storage, 'sign-in-profiles', hash)

  // Act
  const none = await store.describe(repository)
  const lease = await otherWindow.acquireForSetup(repository)
  const setupOpen = await store.describe(repository)
  await lease.writeRecord({
    confirmed: true,
    setupAt: '2026-11-02T12:10:00.000Z',
    signInPaths: ['/login'],
    chromeMajor: 154,
    appCookies: 'persistent',
  })
  await lease.release()
  const saved = await store.describe(repository)
  await finishSetup(store, repository, { confirmed: false })
  const unconfirmed = await store.describe(repository)
  await writeFile(join(folder, 'signin.json'), '{not json')
  const unusable = await store.describe(repository)

  // Assert
  assert.deepEqual(none, { available: false, state: 'none' })
  assert.deepEqual(setupOpen, { available: false, state: 'setup-open' })
  assert.deepEqual(saved, {
    available: true,
    state: 'saved',
    setupAt: '2026-11-02T12:10:00.000Z',
  })
  assert.deepEqual(unconfirmed, {
    available: false,
    state: 'unconfirmed',
    setupAt: '2026-11-02T12:10:00.000Z',
  })
  assert.deepEqual(unusable, { available: false, state: 'unusable' })
  const everything = JSON.stringify([
    none,
    setupOpen,
    saved,
    unconfirmed,
    unusable,
  ])
  assert.equal(everything.includes(storage), false)
  assert.equal(everything.includes(hash), false)
})

// Value: protects=CEO-V5 status and the path proof (OCR 4); fails_when=a saved session whose folder cannot be looked at reads none, or a run on it is told no-saved-session and sent to set one up again; no_claim=ELOOP or EIO
test(
  'a saved session whose folder cannot be looked at reads unusable and refuses the run, never none',
  { skip: PERMISSIONS_DENY_NOTHING },
  async (context) => {
    // Arrange
    const { storage, repository } = await workspace(context)
    const store = storeOf(storage, 'window-a')
    await finishSetup(store, repository)
    const root = join(storage, 'sign-in-profiles')

    // Act
    const { status, refusal } = await withFolderMode(root, 0o000, async () => ({
      status: await store.describe(repository),
      refusal: await rejection(store.acquireForRun(runRequest(repository))),
    }))

    // Assert
    assert.deepEqual(status, { available: false, state: 'unusable' })
    assert.equal(refusal.code, 'SIGN_IN_PROFILE_UNUSABLE')
    assert.equal(refusal.details?.reason, 'not-a-session-folder')
  },
)

// Value: protects=CEO-V5; fails_when=a corrupt or newer-version record is used by a run, reads as saved, or is deleted or rewritten; no_claim=a record written by a real future build
test('a corrupt or newer-version signin.json refuses the run as unusable and is never changed', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository)
  const record = join(storage, 'sign-in-profiles', hash, 'signin.json')

  for (const [bytes, reason] of [
    ['{not json', 'unreadable-record'],
    ['{"version":2}', 'newer-record'],
  ] as const) {
    await writeFile(record, bytes)

    // Act
    const refusal = await rejection(store.acquireForRun(runRequest(repository)))

    // Assert
    assert.equal(refusal.code, 'SIGN_IN_PROFILE_UNUSABLE')
    assert.equal(refusal.details?.reason, reason)
    assert.equal(await readFile(record, 'utf8'), bytes)
  }
})

// Value: protects=E7 and CEO-S35; fails_when=a run starts, saved or fresh, beside an open setup; no_claim=two real editor windows
test('a run start while a setup is open in another window is refused with SIGN_IN_IN_PROGRESS', async (context) => {
  // Arrange
  const { storage, repository } = await workspace(context)
  const setupWindow = storeOf(storage, 'window-a')
  const runWindow = storeOf(storage, 'window-b')
  const setup = await setupWindow.acquireForSetup(repository)

  // Act
  const saved = await rejection(runWindow.acquireForRun(runRequest(repository)))
  const fresh = await rejection(
    runWindow.acquireForRun({ ...runRequest(repository), mode: 'fresh' }),
  )

  // Assert
  assert.equal(saved.code, 'SIGN_IN_IN_PROGRESS')
  assert.equal(fresh.code, 'SIGN_IN_IN_PROGRESS')
  await setup.release()
})

// Value: protects=CEO-S15 and DES-2; fails_when=a run on a repository that never had a setup creates the folder, a lock or a record, or is not told to run fresh; no_claim=lane B's SIGN_IN_REQUIRED
test('a run on a repository without a setup runs fresh and creates nothing', async (context) => {
  // Arrange
  const { storage, repository } = await workspace(context)
  const store = storeOf(storage, 'window-a')

  // Act
  const admission = await store.acquireForRun(runRequest(repository))

  // Assert
  assert.deepEqual(admission, {
    session: 'fresh',
    signInRequiredReason: 'no-saved-session',
  })
  assert.equal(await exists(join(storage, 'sign-in-profiles')), false)
})

// Value: protects=DES-2 Close setup; fails_when=an unconfirmed setup admits a run to the saved session or is reported as no session; no_claim=lane B's refusal text
test('a setup closed without Done makes a run answer setup-not-finished and keeps the profile', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository, { confirmed: false })

  // Act
  const admission = await store.acquireForRun(runRequest(repository))

  // Assert
  assert.deepEqual(admission, {
    session: 'fresh',
    signInRequiredReason: 'setup-not-finished',
  })
  assert.equal(await exists(join(storage, 'sign-in-profiles', hash)), true)
  assert.equal(
    await exists(join(storage, 'sign-in-profiles', `${hash}.signin.lock`)),
    false,
  )
})

// Value: protects=outside voice 2 (a new setup withdraws the earlier Done before its browser can change the profile); fails_when=a setup of a saved session that ends by an editor crash (or by a final record write that fails) leaves the earlier confirmed: true, so a later run uses a profile the learner never approved with Done; no_claim=a real Chrome changing accounts
test('a new setup withdraws the earlier Done before its browser opens, so a setup the editor never finished answers setup-not-finished', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const setupWindow = storeOf(storage, 'window-a')
  await finishSetup(setupWindow, repository)
  const record = join(storage, 'sign-in-profiles', hash, 'signin.json')

  // Act
  const lease = await setupWindow.acquireForSetup(repository)
  const onDiskAtSetupStart: unknown = JSON.parse(await readFile(record, 'utf8'))
  await lease.recordBrowser({
    executable: '/opt/chrome/chrome',
    pid: ID_OF_NO_PROCESS,
  })
  // The editor is killed while the setup browser is open: its lock now names a gone process.
  await writeDeadLock(storage, hash, 'setup')
  const runWindow = storeOf(storage, 'window-b')
  const status = await runWindow.describe(repository)
  const admission = await runWindow.acquireForRun(runRequest(repository))

  // Assert
  assert.deepEqual(onDiskAtSetupStart, {
    version: 1,
    confirmed: false,
    setupAt: '2026-11-02T12:10:00.000Z',
    signInPaths: ['/login'],
    chromeMajor: 154,
    repositoryRoot: repository,
    appCookies: 'persistent',
  })
  assert.deepEqual(status, {
    available: false,
    state: 'unconfirmed',
    setupAt: '2026-11-02T12:10:00.000Z',
  })
  assert.deepEqual(admission, {
    session: 'fresh',
    signInRequiredReason: 'setup-not-finished',
  })
})

// Value: protects=the README's "Close setup while the app is still starting … leaves the saved session as it was" beside the withdrawn Done; fails_when=a setup that ends before its browser was launched (a cancel while the app starts, a server that fails) loses the earlier Done, or one whose browser was launched gets it back without a new Done; no_claim=the setup state machine's own endings (savedSessionSetup tests)
test('a setup released before its browser opened gives the earlier Done back, and one whose browser opened does not', async (context) => {
  // Arrange
  const { storage, repository } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository)

  // Act
  const cancelledBeforeBrowser = await store.acquireForSetup(repository)
  await cancelledBeforeBrowser.release()
  const afterCancel = await store.describe(repository)
  const failedAfterBrowser = await store.acquireForSetup(repository)
  await failedAfterBrowser.recordBrowser({
    executable: '/opt/chrome/chrome',
    pid: ID_OF_NO_PROCESS,
  })
  await failedAfterBrowser.release()
  const afterBrowser = await store.describe(repository)

  // Assert
  assert.deepEqual(afterCancel, {
    available: true,
    state: 'saved',
    setupAt: '2026-11-02T12:10:00.000Z',
  })
  assert.deepEqual(afterBrowser, {
    available: false,
    state: 'unconfirmed',
    setupAt: '2026-11-02T12:10:00.000Z',
  })
})

// Value: protects=DES-3 and the help's no-saved-session for a declared fresh profile (OCR 3); fails_when=a run that declared session: "fresh" is answered setup-not-finished because the last setup was closed without Done, so its SIGN_IN_REQUIRED names a recovery that cannot help it, or the run takes the lock; no_claim=lane B's refusal text
test('a run that declares a fresh profile answers no-saved-session even after a setup was closed without Done', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository, { confirmed: false })

  // Act
  const admission = await store.acquireForRun({
    ...runRequest(repository),
    mode: 'fresh',
  })

  // Assert
  assert.deepEqual(admission, {
    session: 'fresh',
    signInRequiredReason: 'no-saved-session',
  })
  assert.equal(
    await exists(join(storage, 'sign-in-profiles', `${hash}.signin.lock`)),
    false,
  )
})

// Value: protects=CEO-S16 and ENG-16; fails_when=a second admission is granted, or the second run's refusal touches the first run's Singleton files; no_claim=a real second Chrome
test('a second run on the saved session gets BUSY profile-in-use and never reaches a launch', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const first = storeOf(storage, 'window-a')
  const second = storeOf(storage, 'window-b')
  await finishSetup(first, repository)
  const admission = await first.acquireForRun(runRequest(repository))
  assert.equal(admission.session, 'saved')
  const singleton = join(storage, 'sign-in-profiles', hash, 'SingletonLock')
  await symlink('otherhost-99999', singleton)

  // Act
  const refusal = await rejection(
    second.acquireForRun(runRequest(repository, 'run-2')),
  )

  // Assert
  assert.equal(refusal.code, 'BUSY')
  assert.deepEqual(refusal.details, {
    reason: 'profile-in-use',
    heldBy: 'run',
    sent: 'not-sent',
    sideEffects: 'none',
  })
  assert.equal(await exists(singleton), true)
})

// Value: protects=the BUSY wording by holder (OCR 50); fails_when=a run refused because the saved session is being removed is told that another run uses it, while details.heldBy says removal; no_claim=the chat's relay of the message
test('a run that starts while the saved session is being removed is told it is being removed, not that another run uses it', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const runner = storeOf(storage, 'window-b')
  let refusal: StudyError | undefined
  const remover = storeOf(storage, 'window-a', {
    removeFolder: async (folder) => {
      refusal = await rejection(runner.acquireForRun(runRequest(repository)))
      await removeWithoutFollowing(folder)
    },
  })
  await finishSetup(remover, repository)

  // Act
  await remover.remove({ hash, repositoryName: 'repo-app' })

  // Assert
  assert.equal(refusal?.code, 'BUSY')
  assert.equal(
    refusal?.message,
    'The saved session of repo-app is being removed, so this run did not start and no browser opened.',
  )
  assert.deepEqual(refusal?.details, {
    reason: 'profile-in-use',
    heldBy: 'removal',
    sent: 'not-sent',
    sideEffects: 'none',
  })
})

// Value: protects=ENG-12 exclusive create; fails_when=both racing admissions resolve; no_claim=network file systems
test('two windows racing for the saved session: exactly one gets it and the other gets BUSY', async (context) => {
  // Arrange
  const { storage, repository } = await workspace(context)
  const first = storeOf(storage, 'window-a')
  const second = storeOf(storage, 'window-b')
  await finishSetup(first, repository)

  // Act
  const results = await Promise.allSettled([
    first.acquireForRun(runRequest(repository, 'run-a')),
    second.acquireForRun(runRequest(repository, 'run-b')),
  ])

  // Assert
  const codes = results.map((result) =>
    result.status === 'fulfilled'
      ? 'admitted'
      : (result.reason as StudyError).code,
  )
  assert.deepEqual(codes.sort(), ['BUSY', 'admitted'])
})

// Value: protects=ENG-12 stale lock; fails_when=a lock of an editor that was killed blocks the saved session forever; no_claim=a real crashed extension host
test('a lock left by an editor that was killed is taken over and the run starts', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  await finishSetup(storeOf(storage, 'window-a'), repository)
  await writeDeadLock(storage, hash, 'run')

  // Act
  const admission = await storeOf(storage, 'window-b').acquireForRun(
    runRequest(repository),
  )

  // Assert
  assert.equal(admission.session, 'saved')
})

// Value: protects=ENG-12 PID reuse; fails_when=a lock whose pid now belongs to another process keeps the session locked; no_claim=real pid wraparound
test('a lock whose pid now belongs to another process is taken over (PID reuse)', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  await finishSetup(storeOf(storage, 'window-a'), repository)
  const identity = await currentStorageOwner()
  await writeFile(
    join(storage, 'sign-in-profiles', `${hash}.signin.lock`),
    JSON.stringify({
      ...identity,
      pid: process.pid,
      // The same form as this system's start, but another moment: the pid now belongs to another process.
      processStart: `${identity.processStart}-an-earlier-process`,
      holder: 'run',
      windowSession: 'window-before-reboot',
      token: 'old-token',
      createdAt: '2026-11-02T10:00:00.000Z',
    }),
  )

  // Act
  const admission = await storeOf(storage, 'window-b').acquireForRun(
    runRequest(repository),
  )

  // Assert
  assert.equal(admission.session, 'saved')
})

// Value: protects=Codex correction 1 token check; fails_when=a release removes a lock that another hold of the same process now owns; no_claim=a different process
test('releasing a lease leaves a lock that carries another hold token', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository)
  const admission = await store.acquireForRun(runRequest(repository))
  assert.equal(admission.session, 'saved')
  const lockPath = join(storage, 'sign-in-profiles', `${hash}.signin.lock`)
  const lock = JSON.parse(await readFile(lockPath, 'utf8'))
  await writeFile(lockPath, JSON.stringify({ ...lock, token: 'another-hold' }))

  // Act
  if (admission.session === 'saved') await admission.lease.release()

  // Assert
  assert.equal(await exists(lockPath), true)
})

// Value: protects=Codex correction 1 release and OCR 2 (a); fails_when=a lock written while this editor's own start could not be read stays after the release because the start became readable, so every later run gets BUSY until the editor restarts; no_claim=a real start read that fails
test("a run lease taken while the editor's own start was unreadable still frees the saved session on release", async (context) => {
  // Arrange
  const { storage, repository } = await workspace(context)
  await finishSetup(storeOf(storage, 'window-a'), repository)
  let isStartReadable = false
  const store = storeOf(storage, 'window-a', {
    identity: async () => ({
      ...(await currentStorageOwner()),
      processStart: isStartReadable ? 'ps:read-after-the-take' : undefined,
    }),
  })
  const admission = await store.acquireForRun(runRequest(repository))
  assert.ok(admission.session === 'saved')
  isStartReadable = true

  // Act
  await admission.lease.release()
  const next = await storeOf(storage, 'window-b')
    .acquireForRun(runRequest(repository, 'run-2'))
    .then(
      ({ session }) => session,
      (error: unknown) => (error instanceof StudyError ? error.code : error),
    )

  // Assert
  assert.equal(next, 'saved')
})

// Value: protects=OCR 2 (b) and the Codex candidate review (a failed lock removal is no release), and the run's retried Stop; fails_when=a release whose lock removal fails resolves, drops this window's hold while the lock stays, or answers the same failure on every later release so Stop can never free the session; no_claim=EBUSY from a Windows scanner
test(
  'a run release whose lock cannot be removed keeps the hold, and the next release frees the saved session',
  { skip: PERMISSIONS_DENY_NOTHING },
  async (context) => {
    // Arrange
    const { storage, repository, hash } = await workspace(context)
    const store = storeOf(storage, 'window-a')
    await finishSetup(store, repository)
    const admission = await store.acquireForRun(runRequest(repository))
    assert.ok(admission.session === 'saved')
    const root = join(storage, 'sign-in-profiles')
    const lockPath = join(root, `${hash}.signin.lock`)

    // Act
    const whileLocked = await withFolderMode(root, 0o500, async () => ({
      release: await admission.lease.release().then(
        () => 'released',
        (error: unknown) => systemErrorCode(error),
      ),
      isLockKept: await exists(lockPath),
      hold: await holdState(store, hash),
    }))
    await admission.lease.release()

    // Assert
    assert.deepEqual(whileLocked, {
      release: 'EACCES',
      isLockKept: true,
      hold: 'held',
    })
    assert.equal(await exists(lockPath), false)
    assert.equal(await holdState(store, hash), 'released')
  },
)

// Value: protects=probe consequence and ENG-12 (js-debug's "browser is already running" modal); fails_when=SingletonLock, SingletonCookie or SingletonSocket stay after a launch is prepared, or a link target is followed; no_claim=js-debug's own check
test('stale Chrome lock entries are removed before a launch when no process uses the folder, and link targets stay', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository)
  const folder = join(storage, 'sign-in-profiles', hash)
  const decoy = join(storage, 'decoy.txt')
  await writeFile(decoy, 'keep')
  await symlink('otherhost-99999', join(folder, 'SingletonLock'))
  await symlink('1', join(folder, 'SingletonCookie'))
  await symlink(decoy, join(folder, 'SingletonSocket'))
  await writeFile(join(folder, 'DevToolsActivePort'), '9222')

  // Act
  const admission = await store.acquireForRun(runRequest(repository))

  // Assert
  assert.equal(admission.session, 'saved')
  const left = await readdir(folder)
  assert.equal(
    left.some((name) => name.startsWith('Singleton')),
    false,
  )
  assert.equal(left.includes('DevToolsActivePort'), false)
  assert.equal(await readFile(decoy, 'utf8'), 'keep')
})

// Value: protects=ENG-12 "a live one refuses" and cross-check 19; fails_when=a live Chrome whose profile path holds a space is not seen, so Singleton files are removed under it; no_claim=a real Chrome
test('a live process using a folder below a path with a space refuses the run with SIGN_IN_PROFILE_IN_USE and keeps the lock entries', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = new SavedSessionStore({
    globalStorage: storage,
    windowSession: 'window-a',
    listProcesses: async () => [],
  })
  await finishSetup(store, repository)
  const folder = join(storage, 'sign-in-profiles', hash)
  await symlink('otherhost-99999', join(folder, 'SingletonLock'))
  const browser = await startBrowser(context, folder)
  // The default process listing is used: the real `ps` text must show the spaced path.
  const realListing = new SavedSessionStore({
    globalStorage: storage,
    windowSession: 'window-b',
  })

  // Act
  const refusal = await rejection(
    realListing.acquireForRun(runRequest(repository)),
  )

  // Assert
  assert.equal(refusal.code, 'SIGN_IN_PROFILE_IN_USE')
  assert.equal(await exists(join(folder, 'SingletonLock')), true)
  assert.equal(browser.exitCode, null)
})

// Value: protects=cross-check 20 (a failed listing refuses); fails_when=a process listing that fails or times out is read as "nobody uses the folder" and Singleton files are removed; no_claim=the listing's own error text
test('a process listing that fails refuses the run with SIGN_IN_PROFILE_IN_USE and removes nothing', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  await finishSetup(storeOf(storage, 'window-a'), repository)
  const folder = join(storage, 'sign-in-profiles', hash)
  await symlink('otherhost-99999', join(folder, 'SingletonLock'))
  const failing = storeOf(storage, 'window-b', {
    listProcesses: async () => {
      throw new Error('ps timed out')
    },
  })

  // Act
  const refusal = await rejection(failing.acquireForRun(runRequest(repository)))

  // Assert
  assert.equal(refusal.code, 'SIGN_IN_PROFILE_IN_USE')
  assert.equal(await exists(join(folder, 'SingletonLock')), true)
  assert.equal(
    await exists(join(storage, 'sign-in-profiles', `${hash}.signin.lock`)),
    false,
  )
})

// Value: protects=ENG-12 and Codex correction 2; fails_when=lease.prepareForLaunch removes Singleton files under a Chrome that appeared after admission; no_claim=lane B's launch
test('prepareForLaunch refuses when a process names the folder after the admission', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const processes: ListedProcess[] = []
  const store = storeOf(storage, 'window-a', {
    listProcesses: async () => processes,
  })
  await finishSetup(store, repository)
  const admission = await store.acquireForRun(runRequest(repository))
  assert.equal(admission.session, 'saved')
  const folder = join(storage, 'sign-in-profiles', hash)
  await symlink('otherhost-99999', join(folder, 'SingletonLock'))
  processes.push({ pid: 4242, command: `chrome --user-data-dir=${folder}` })

  // Act
  const refusal =
    admission.session === 'saved'
      ? await rejection(admission.lease.prepareForLaunch())
      : undefined

  // Assert
  assert.equal(refusal?.code, 'SIGN_IN_PROFILE_IN_USE')
  assert.equal(await exists(join(folder, 'SingletonLock')), true)
})

/** Says what a rejected promise rejected with, whatever it is. */
async function anyRejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => assert.fail('expected a rejection'),
    (reason: unknown) => reason,
  )
}

// Value: protects=red team A1 (path exposure) and the no-path contract of the chat error and run.failed; fails_when=a file-system failure while a run or a setup takes the saved session (here Default/Preferences cannot be made) rejects with words that name the saved folder or its hash; no_claim=lane B's own hiding after the admission
test('a run or a setup that fails on the saved folder names neither the folder nor its hash, and keeps the system error code', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  await finishSetup(storeOf(storage, 'window-a'), repository)
  const folder = join(storage, 'sign-in-profiles', hash)
  await rm(join(folder, 'Default'), { recursive: true, force: true })
  await writeFile(join(folder, 'Default'), 'a file where Chrome needs a folder')
  const store = storeOf(storage, 'window-b')

  // Act
  const runFailure = await anyRejection(
    store.acquireForRun(runRequest(repository)),
  )
  const setupFailure = await anyRejection(store.acquireForSetup(repository))

  // Assert
  for (const failure of [runFailure, setupFailure]) {
    const words = failure instanceof Error ? failure.message : String(failure)
    assert.equal(words.includes(hash), false)
    assert.equal(words.includes(storage), false)
    assert.equal(words.includes('<saved-session>'), true)
    assert.equal(systemErrorCode(failure), 'EEXIST')
  }
  assert.equal(
    await exists(join(storage, 'sign-in-profiles', `${hash}.signin.lock`)),
    false,
  )
})

// Value: protects=native finding 9 and CodeRabbit's fresh-release note; fails_when=a lock that cannot be removed for a moment after a fresh admission fails the fresh run with an uncoded system error, or the hold it keeps is never released again in this window; no_claim=a real EBUSY from a virus scanner
test('a fresh admission whose lock cannot be removed still runs fresh, and the next run of the window frees the lock', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository, { confirmed: false })
  const lockPath = join(storage, 'sign-in-profiles', `${hash}.signin.lock`)
  const unlink = fsPromises.unlink.bind(fsPromises)
  let refusals = 1
  context.mock.method(
    fsPromises,
    'unlink',
    async (path: Parameters<typeof unlink>[0]) => {
      // The lock refuses its first removal, as a scanner holding it would.
      if (String(path) === lockPath && refusals > 0) {
        refusals -= 1
        throw Object.assign(new Error('EBUSY: resource busy or locked'), {
          code: 'EBUSY',
        })
      }
      return unlink(path)
    },
  )

  // Act
  const first = await store
    .acquireForRun(runRequest(repository))
    .catch((error: unknown) => systemErrorCode(error))
  const whileBusy = await holdState(store, hash)
  const second = await store.acquireForRun(runRequest(repository, 'run-2'))

  // Assert
  assert.deepEqual(first, {
    session: 'fresh',
    signInRequiredReason: 'setup-not-finished',
  })
  assert.equal(whileBusy, 'held')
  assert.deepEqual(second, {
    session: 'fresh',
    signInRequiredReason: 'setup-not-finished',
  })
  assert.equal(await holdState(store, hash), 'released')
  assert.equal(await exists(lockPath), false)
})

/** Prepares a stale-holder scene: a saved session whose editor was killed, and a live stand-in Chrome in its folder with the given marker. */
async function orphanScene(
  context: TestContext,
  marker: (browser: ChildProcess) => Promise<Record<string, unknown>>,
): Promise<{ storage: string; repository: string; browser: ChildProcess }> {
  const { storage, repository, hash } = await workspace(context)
  await finishSetup(storeOf(storage, 'window-a'), repository)
  const folder = join(storage, 'sign-in-profiles', hash)
  const browser = await startBrowser(context, folder)
  await writeFile(
    join(folder, 'codebook-owned-browser'),
    JSON.stringify(await marker(browser)),
  )
  await writeDeadLock(storage, hash, 'setup')
  return { storage, repository, browser }
}

// Value: protects=CEO-R5 crash recovery and Codex correction 2; fails_when=the orphan Chrome of a killed editor is never stopped, or is stopped without the proof; no_claim=Chrome's helper tree
test('an orphan Chrome of a killed editor is stopped on the owned-browser proof, then the session is admitted', async (context) => {
  // Arrange
  const { storage, repository, browser } = await orphanScene(
    context,
    async (child) => ({
      executable: process.execPath,
      pid: child.pid,
      processStart: await readProcessStart(child.pid ?? 0),
      launchKind: 'attached',
    }),
  )
  const exited = once(browser, 'exit')

  // Act
  const admission = await new SavedSessionStore({
    globalStorage: storage,
    windowSession: 'window-b',
  }).acquireForRun(runRequest(repository))
  await exited

  // Assert
  assert.equal(admission.session, 'saved')
  assert.equal(browser.signalCode, 'SIGTERM')
})

// Value: protects=Codex correction 2 (a reused pid is never signalled); fails_when=a Chrome whose own start differs from the marker's, or a marker that records no start, is signalled; no_claim=the real reuse of a pid
test('a Chrome whose start differs from the marker, or a marker without a start, is never signalled and the run is refused', async (context) => {
  for (const marker of [
    (child: ChildProcess) =>
      Promise.resolve({
        executable: process.execPath,
        pid: child.pid,
        processStart: 'ps:Thu Jan  1 00:00:00 1970',
      }),
    (child: ChildProcess) =>
      Promise.resolve({ executable: process.execPath, pid: child.pid }),
  ]) {
    // Arrange
    const { storage, repository, browser } = await orphanScene(context, marker)
    const recorded = silentStopper()
    const store = new SavedSessionStore({
      globalStorage: storage,
      windowSession: 'window-b',
      stopper: recorded.stopper,
    })

    // Act
    const refusal = await rejection(store.acquireForRun(runRequest(repository)))

    // Assert
    assert.equal(refusal.code, 'SIGN_IN_PROFILE_IN_USE')
    assert.deepEqual(recorded.sent, [])
    assert.equal(browser.exitCode, null)
  }
})

// Value: protects=red team A1 (orphan recovery is not one-shot) and CEO-R5; fails_when=the orphan Chrome of a killed editor is stopped only by the call that removed its dead lock, so after one failed recovery (here a process listing that failed) every later run, setup and removal stays refused with no way out; no_claim=the start proof itself (covered above), Chrome's helper tree
test('an orphan Chrome that one recovery failed to stop is stopped by the next run, on the marker proof alone', async (context) => {
  // Arrange
  const { storage, repository, browser } = await orphanScene(
    context,
    async (child) => ({
      executable: process.execPath,
      pid: child.pid,
      processStart: await readProcessStart(child.pid ?? 0),
      launchKind: 'attached',
    }),
  )
  const failedListing = storeOf(storage, 'window-b', {
    listProcesses: async () => {
      throw new Error('ps timed out')
    },
  })
  const firstRefusal = await rejection(
    failedListing.acquireForRun(runRequest(repository)),
  )
  const exited = once(browser, 'exit')

  // Act
  const admission = await new SavedSessionStore({
    globalStorage: storage,
    windowSession: 'window-c',
  }).acquireForRun(runRequest(repository, 'run-2'))
  await exited

  // Assert
  assert.equal(firstRefusal.code, 'SIGN_IN_PROFILE_IN_USE')
  assert.equal(admission.session, 'saved')
  assert.equal(browser.signalCode, 'SIGTERM')
})

// Value: protects=red team A2 (the marker is written atomically); fails_when=a run's browser marker is written in place, so a link at its name leads the write into a file outside the saved session (and an editor that dies mid-write leaves a truncated marker that proves no orphan); no_claim=power loss on a real disk
test("a run's browser marker replaces a link at its name and never writes through it", async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository)
  const folder = join(storage, 'sign-in-profiles', hash)
  const decoy = join(storage, 'decoy-marker.txt')
  await writeFile(decoy, 'keep')
  const admission = await store.acquireForRun(runRequest(repository))
  assert.equal(admission.session, 'saved')
  await symlink(decoy, join(folder, 'codebook-owned-browser'))

  // Act
  if (admission.session === 'saved')
    await admission.lease.recordBrowser({
      executable: '/opt/chrome/chrome',
      pid: ID_OF_NO_PROCESS,
    })

  // Assert
  assert.equal(await readFile(decoy, 'utf8'), 'keep')
  const marker = join(folder, 'codebook-owned-browser')
  assert.equal((await lstat(marker)).isFile(), true)
  assert.deepEqual(JSON.parse(await readFile(marker, 'utf8')), {
    executable: '/opt/chrome/chrome',
    pid: ID_OF_NO_PROCESS,
    launchKind: 'attached',
  })
})

// Value: protects=CEO-R5; fails_when=Singleton files or a lock left by a killed Chrome block the next run; no_claim=lane B's failure handling
test('after Chrome is killed mid-run the lease is released and the next run starts', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository)
  const first = await store.acquireForRun(runRequest(repository))
  assert.equal(first.session, 'saved')
  const folder = join(storage, 'sign-in-profiles', hash)
  await symlink('otherhost-99999', join(folder, 'SingletonLock'))

  // Act
  if (first.session === 'saved') await first.lease.release()
  const second = await store.acquireForRun(runRequest(repository, 'run-2'))

  // Assert
  assert.equal(second.session, 'saved')
  assert.equal(await exists(join(folder, 'SingletonLock')), false)
})

// Value: protects=D12; fails_when=an older Chrome opens the profile, a newer Chrome forces a new setup or is not recorded, or an unreadable version is admitted; no_claim=Chrome's own profile migration
test('a run on an older Chrome than the setup is refused with chrome-version, a newer Chrome is admitted and recorded', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository, { chromeMajor: 154 })

  // Act
  const older = await rejection(
    store.acquireForRun(
      runRequest(repository, 'run-1', 'Google Chrome 153.0.1.2'),
    ),
  )
  const unreadable = await rejection(
    store.acquireForRun(runRequest(repository, 'run-1', 'Chromium')),
  )
  const newer = await store.acquireForRun(
    runRequest(repository, 'run-2', 'Google Chrome 155.0.1.2'),
  )

  // Assert
  assert.equal(older.details?.reason, 'chrome-version')
  assert.equal(unreadable.details?.reason, 'chrome-version')
  assert.equal(newer.session, 'saved')
  const read = await readSignInRecord(join(storage, 'sign-in-profiles', hash))
  assert.equal(read.kind === 'record' ? read.record.chromeMajor : 0, 155)
})

// Value: protects=D12 through a setup (native finding 1); fails_when=a setup on an older Chrome lowers the recorded major, so a run on that older Chrome opens a profile a newer Chrome migrated; no_claim=what Chrome does with such a profile
test('a setup on an older Chrome keeps the newer recorded major, so a run on that older Chrome stays refused', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository, { chromeMajor: 155 })

  // Act
  await finishSetup(store, repository, { chromeMajor: 154 })
  const refusal = await rejection(
    store.acquireForRun(
      runRequest(repository, 'run-1', 'Google Chrome 154.0.1.2'),
    ),
  )

  // Assert
  const read = await readSignInRecord(join(storage, 'sign-in-profiles', hash))
  assert.equal(read.kind === 'record' ? read.record.chromeMajor : 0, 155)
  assert.equal(refusal.code, 'SIGN_IN_PROFILE_UNUSABLE')
  assert.equal(refusal.details?.reason, 'chrome-version')
})

// Value: protects=signin.json forward compatibility (OCR 42); fails_when=an accepted newer Chrome rewrites signin.json without the keys a later Codebook added under version 1; no_claim=a real later build
test('a newer Chrome recorded in signin.json keeps the keys a later Codebook added to it', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository, { chromeMajor: 154 })
  const recordPath = join(storage, 'sign-in-profiles', hash, 'signin.json')
  await writeFile(
    recordPath,
    JSON.stringify({
      version: 1,
      confirmed: true,
      setupAt: '2026-11-02T12:10:00.000Z',
      signInPaths: ['/login'],
      chromeMajor: 154,
      repositoryRoot: repository,
      appCookies: 'persistent',
      addedByLaterBuild: 'kept-by-the-rewrite',
    }),
  )

  // Act
  const admission = await store.acquireForRun(
    runRequest(repository, 'run-1', 'Google Chrome 155.0.1.2'),
  )

  // Assert
  assert.equal(admission.session, 'saved')
  assert.deepEqual(JSON.parse(await readFile(recordPath, 'utf8')), {
    version: 1,
    confirmed: true,
    setupAt: '2026-11-02T12:10:00.000Z',
    signInPaths: ['/login'],
    chromeMajor: 155,
    repositoryRoot: repository,
    appCookies: 'persistent',
    addedByLaterBuild: 'kept-by-the-rewrite',
  })
})

// Value: protects=CEO-S27 and CEO-S15; fails_when=remembering a run's sign-in paths creates the folder or a record, or the paths are lost; no_claim=VS Code's real globalState
test('a fresh run remembers its sign-in paths for the next setup without creating a saved session', async (context) => {
  // Arrange
  const { storage, repository } = await workspace(context)
  const values = new Map<string, unknown>()
  const store = storeOf(storage, 'window-a', {
    memento: {
      get: <Value>(key: string) => values.get(key) as Value | undefined,
      update: async (key, value) => {
        values.set(key, value)
      },
    },
  })

  // Act
  await store.rememberSignInPaths(repository, ['/login', '/sign-in'])

  // Assert
  assert.deepEqual(await store.lastSignInPaths(repository), [
    '/login',
    '/sign-in',
  ])
  assert.equal(await exists(join(storage, 'sign-in-profiles')), false)
})

// Value: protects=the removal quick pick's entries (OCR 7, one read per entry); fails_when=a session whose setup is open in another window is listed as an unknown repository, the workspace's session is not first, or a session is missing; no_claim=the quick pick itself
test("the session list names each repository, also one whose setup is open, with the workspace's first", async (context) => {
  // Arrange
  const { storage, repository } = await workspace(context)
  const other = join(storage, 'second-repo')
  await mkdir(other)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, other)
  await finishSetup(store, repository)
  const setup = await storeOf(storage, 'window-b').acquireForSetup(other)

  // Act
  const entries = await store.list(repository)
  await setup.release()

  // Assert
  assert.deepEqual(
    entries.map(({ repositoryName, state, isCurrent }) => ({
      repositoryName,
      state,
      isCurrent,
    })),
    [
      { repositoryName: 'repo-app', state: 'saved', isCurrent: true },
      { repositoryName: 'second-repo', state: 'setup-open', isCurrent: false },
    ],
  )
})

// Value: protects=ENG-15 path proof for a setup (OCR 5, Codex candidate review); fails_when=a setup follows a link in sign-in-profiles (changing its target's mode or writing Chrome files into it), answers a raw error for a file there, or keeps its lock after the refusal; no_claim=Windows junctions
test('a setup refuses a session entry that is a link or a file, changes nothing behind the link and frees its lock', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  const root = join(storage, 'sign-in-profiles')
  const entry = join(root, hash)
  const decoy = join(storage, 'decoy-folder')
  await mkdir(root, { recursive: true })
  await mkdir(decoy)
  await chmod(decoy, 0o755)
  await writeFile(join(decoy, 'keep.txt'), 'keep')
  await symlink(decoy, entry)

  // Act
  const throughLink = await rejection(store.acquireForSetup(repository))
  await rm(entry)
  await writeFile(entry, 'not a folder')
  const overFile = await rejection(store.acquireForSetup(repository))

  // Assert
  for (const refusal of [throughLink, overFile]) {
    assert.equal(refusal.code, 'SIGN_IN_PROFILE_UNUSABLE')
    assert.equal(refusal.details?.reason, 'not-a-session-folder')
  }
  assert.deepEqual(await readdir(decoy), ['keep.txt'])
  if (process.platform !== 'win32')
    assert.equal((await stat(decoy)).mode & 0o777, 0o755)
  assert.deepEqual(await readdir(root), [hash])
})

// Value: protects=OCR 2 for a removal; fails_when=a removal whose lock cannot be removed after the deletion reads removed (a later setup is then refused with no cause given), or rejects with a raw error that names the lock's path; no_claim=the notice text
test(
  'a removal whose lock cannot be removed after the deletion reads partly-removed with the cause',
  { skip: PERMISSIONS_DENY_NOTHING },
  async (context) => {
    // Arrange
    const { storage, repository, hash } = await workspace(context)
    const root = join(storage, 'sign-in-profiles')
    const remover = storeOf(storage, 'window-a', {
      removeFolder: async (folder) => {
        await removeWithoutFollowing(folder)
        // The folder is gone; from here on its lock can no longer be removed.
        await chmod(root, 0o500)
      },
    })
    await finishSetup(remover, repository)

    // Act
    const outcome = await remover
      .remove({ hash, repositoryName: 'repo-app' })
      .finally(() => chmod(root, 0o700))

    // Assert
    assert.deepEqual(outcome, { outcome: 'partly-removed', cause: 'EACCES' })
    assert.equal(await exists(join(root, `${hash}.signin.lock`)), true)
  },
)

// Value: protects=AC2, CEO-V3 and CEO-V10; fails_when=the folder, the record or the lock survives a removal, or the Trash is used; no_claim=the macOS Trash API (the store has no Trash dependency)
test('removal deletes the saved session directly and leaves no folder and no lock', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository)
  const [entry] = await store.list(repository)
  assert.ok(entry)

  // Act
  const outcome = await store.remove(entry)

  // Assert
  assert.deepEqual(outcome, { outcome: 'removed' })
  assert.deepEqual(await readdir(join(storage, 'sign-in-profiles')), [])
  assert.deepEqual(await store.describe(repository), {
    available: false,
    state: 'none',
  })
  assert.equal(entry.hash, hash)
})

// Value: protects=ENG-15 path proof; fails_when=a link's target or a misnamed folder loses a file; no_claim=Windows junctions
test('removal refuses a link and a misnamed folder, and deletes nothing', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  const root = join(storage, 'sign-in-profiles')
  await mkdir(root, { recursive: true })
  const decoy = join(storage, 'decoy-folder')
  await mkdir(decoy)
  await writeFile(join(decoy, 'keep.txt'), 'keep')
  const linkHash = 'a'.repeat(64)
  await symlink(decoy, join(root, linkHash))
  await mkdir(join(root, 'abc'))
  await finishSetup(store, repository)

  // Act
  const outcomes = await Promise.all(
    [linkHash, 'abc'].map((name) =>
      store.remove({ hash: name, repositoryName: 'x' }),
    ),
  )

  // Assert
  assert.deepEqual(
    outcomes.map(({ outcome }) => outcome),
    ['refused-path', 'refused-path'],
  )
  assert.equal(await readFile(join(decoy, 'keep.txt'), 'utf8'), 'keep')
  assert.equal(await exists(join(root, 'abc')), true)
  assert.equal(await exists(join(root, hash, 'signin.json')), true)
})

// Value: protects=native finding 4 (a record of another repository is no dead end) and the SIGN_IN_PROFILE_UNUSABLE recovery (Remove, then set up again); fails_when=a folder whose signin.json names another repository is used by a run of this one, reads saved, or is refused by every removal so the learner cannot get out of it; no_claim=how such a record came to be (a copy or a hand edit)
test('a saved session whose record names another repository reads unusable, refuses the run, and removal deletes it', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository)
  await writeFile(
    join(storage, 'sign-in-profiles', hash, 'signin.json'),
    JSON.stringify({
      version: 1,
      confirmed: true,
      setupAt: '2026-11-02T12:10:00.000Z',
      signInPaths: ['/login'],
      chromeMajor: 154,
      repositoryRoot: join(storage, 'another-repository'),
      appCookies: 'persistent',
    }),
  )

  // Act
  const status = await store.describe(repository)
  const refusal = await rejection(store.acquireForRun(runRequest(repository)))
  const [entry] = await store.list(repository)
  const removal = entry ? await store.remove(entry) : undefined

  // Assert
  assert.deepEqual(status, { available: false, state: 'unusable' })
  assert.equal(refusal.code, 'SIGN_IN_PROFILE_UNUSABLE')
  assert.equal(refusal.details?.reason, 'not-a-session-folder')
  assert.deepEqual(entry, {
    hash,
    repositoryName: 'unknown repository',
    state: 'unusable',
    isCurrent: true,
  })
  assert.deepEqual(removal, { outcome: 'removed' })
  assert.deepEqual(await readdir(join(storage, 'sign-in-profiles')), [])
})

// Value: protects=native finding 6 (the name is proven before anything is read); fails_when=a removal asked for an entry whose name is no session hash reads a record outside the sessions folder before it refuses; no_claim=what such a read could reveal
test('a removal of a name that is no session hash looks at nothing outside the sessions folder', async (context) => {
  // Arrange
  const { storage, repository } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository)
  const outside = join(storage, 'outside-the-store')
  await mkdir(outside)
  await writeFile(join(outside, 'signin.json'), '{}')
  const looked: string[] = []
  for (const method of ['open', 'lstat'] as const) {
    const original = fsPromises[method].bind(fsPromises)
    context.mock.method(
      fsPromises,
      method,
      (path: Parameters<typeof original>[0], ...rest: unknown[]) => {
        looked.push(String(path))
        return Reflect.apply(original, fsPromises, [path, ...rest])
      },
    )
  }

  // Act
  const outcome = await store.remove({
    hash: '../outside-the-store',
    repositoryName: 'x',
  })

  // Assert
  assert.equal(outcome.outcome, 'refused-path')
  assert.deepEqual(
    looked.filter((path) => path.includes('outside-the-store')),
    [],
  )
})

// Value: protects=native finding 5 (no deletion by path through a swapped folder); fails_when=a session folder swapped for a link after the removal's proof (while it lists the processes) leads the record's deletion into the link's target, or the removal reports removed; no_claim=a swap between the last proof and the unlink (the same limit as the no-follow walk)
test('a session folder swapped for a link during the removal deletes nothing behind the link', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const folder = join(storage, 'sign-in-profiles', hash)
  const decoy = join(storage, 'decoy-folder')
  await mkdir(decoy)
  await writeFile(join(decoy, 'signin.json'), 'keep')
  let didSwap = false
  const remover = storeOf(storage, 'window-a', {
    listProcesses: async () => {
      // The folder is moved away and a link to the decoy takes its name, after the proof under the lock.
      if (!didSwap) {
        didSwap = true
        await rename(folder, join(storage, 'moved-session'))
        await symlink(decoy, folder)
      }
      return []
    },
  })
  await finishSetup(storeOf(storage, 'window-b'), repository)

  // Act
  const outcome = await remover.remove({ hash, repositoryName: 'repo-app' })

  // Assert
  assert.equal(outcome.outcome, 'refused-path')
  assert.equal(await readFile(join(decoy, 'signin.json'), 'utf8'), 'keep')
  assert.equal((await lstat(folder)).isSymbolicLink(), true)
})

// Value: protects=DX-10 Stop run and remove (store part); fails_when=removal deletes under a live run, never names that run, or never proceeds after the release; no_claim=the UI modal
test('removal while a run of this window holds the session reports that run, and removes after the run released it', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository)
  const admission = await store.acquireForRun(runRequest(repository, 'run-77'))
  assert.equal(admission.session, 'saved')
  const entry = { hash, repositoryName: 'repo-app' }

  // Act
  const blocked = await store.remove(entry)
  if (admission.session === 'saved') await admission.lease.release()
  await store.whenReleased(hash)
  const removed = await store.remove(entry)

  // Assert
  assert.deepEqual(blocked, { outcome: 'run-in-this-window', runId: 'run-77' })
  assert.deepEqual(removed, { outcome: 'removed' })
})

// Value: protects=E7 and SIGN_IN_PROFILE_IN_USE; fails_when=another window's run loses its folder, or a setup in another window is deleted; no_claim=two real windows
test('removal while another window runs or has a setup open deletes nothing', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const runner = storeOf(storage, 'window-a')
  const remover = storeOf(storage, 'window-b')
  await finishSetup(runner, repository)
  const admission = await runner.acquireForRun(runRequest(repository))
  const entry = { hash, repositoryName: 'repo-app' }

  // Act
  const whileRunning = await remover.remove(entry)
  if (admission.session === 'saved') await admission.lease.release()
  const setup = await runner.acquireForSetup(repository)
  const whileSetup = await remover.remove(entry)
  await setup.release()

  // Assert
  assert.deepEqual(whileRunning, { outcome: 'in-use-elsewhere' })
  assert.deepEqual(whileSetup, { outcome: 'setup-open' })
  assert.equal(
    await exists(join(storage, 'sign-in-profiles', hash, 'signin.json')),
    true,
  )
})

// Value: protects=Codex correction 1 (the lock lies outside the folder and is held for the whole removal); fails_when=a second window can take a lock, or create anything, between the inner deletion and the folder's removal, and a later retry deletes the new owner's files; no_claim=a different file system
test('a second window that tries to take the session while it is being deleted is refused and creates nothing', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const root = join(storage, 'sign-in-profiles')
  const folder = join(root, hash)
  const second = storeOf(storage, 'window-b')
  const attempts: string[] = []
  let entriesDuringRemoval: string[] = []
  const remover = storeOf(storage, 'window-a', {
    removeFolder: async (target) => {
      // The inner entries go first, then the second window tries before the folder itself is removed.
      await removeWithoutFollowing(join(target, 'Default'))
      const asRun = await rejection(
        second.acquireForRun(runRequest(repository)),
      )
      const asSetup = await rejection(second.acquireForSetup(repository))
      attempts.push(asRun.code, asSetup.code)
      entriesDuringRemoval = (await readdir(target)).sort()
      await removeWithoutFollowing(target)
    },
  })
  await finishSetup(remover, repository)

  // Act
  const outcome = await remover.remove({ hash, repositoryName: 'repo-app' })

  // Assert
  assert.deepEqual(outcome, { outcome: 'removed' })
  assert.deepEqual(attempts, ['BUSY', 'SIGN_IN_PROFILE_IN_USE'])
  assert.deepEqual(entriesDuringRemoval, [])
  assert.deepEqual(await readdir(root), [])
  assert.equal(await exists(folder), false)
})

// Value: protects=Codex correction 1 and ENG-15; fails_when=removal deletes a folder a Chrome still uses; no_claim=the stopping of a stale holder's Chrome (covered above)
test('removal refuses while a process uses the folder', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const folder = join(storage, 'sign-in-profiles', hash)
  const store = storeOf(storage, 'window-a', {
    listProcesses: async () => [
      { pid: 4242, command: `chrome --user-data-dir=${folder}` },
    ],
  })
  await finishSetup(storeOf(storage, 'window-a'), repository)

  // Act
  const outcome = await store.remove({ hash, repositoryName: 'repo-app' })

  // Assert
  assert.deepEqual(outcome, { outcome: 'in-use-elsewhere' })
  assert.equal(await exists(join(folder, 'signin.json')), true)
})

// Value: protects=the status item's refresh (lane A2 subscribes); fails_when=taking or releasing a run lease, or finishing a setup record, does not tell the listener, or an unsubscribed listener is still called; no_claim=the status item itself
test('a listener hears the session change when a run takes and releases it, and not after it unsubscribed', async (context) => {
  // Arrange
  const { storage, repository, hash } = await workspace(context)
  const store = storeOf(storage, 'window-a')
  await finishSetup(store, repository)
  const heard: string[] = []
  const unsubscribe = store.onDidChange((changed) => heard.push(changed))

  // Act
  const admission = await store.acquireForRun(runRequest(repository))
  if (admission.session === 'saved') await admission.lease.release()
  unsubscribe()
  await store.acquireForSetup(repository).then((lease) => lease.release())

  // Assert
  assert.deepEqual(heard, [hash, hash])
})

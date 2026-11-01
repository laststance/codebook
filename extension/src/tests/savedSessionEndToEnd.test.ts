import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { SavedSessionStore } from '../runtimeSupport/signInProfile'
import { sha256 } from '../runtimeSupport/utils/sha256'
import {
  SavedSessionSetup,
  type SavedSessionSetupInput,
} from '../savedSessionSetup'

import { createManualClock } from './utils/createManualClock'

const START_EPOCH_MS = Date.parse('2026-11-02T12:10:00.000Z')

/** A storage root whose path holds a space (as the editor's `Application Support` does) and a repository folder. */
async function workspace(context: TestContext) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'codebook-e2e-')))
  context.after(() => rm(base, { recursive: true, force: true }))
  const storage = join(base, 'Application Support', 'globalStorage')
  const repository = join(base, 'repo-shop')
  await mkdir(storage, { recursive: true })
  await mkdir(repository)
  const hash = sha256(await realpath(repository))
  const input: SavedSessionSetupInput = {
    repositoryRoot: repository,
    repositoryName: 'repo-shop',
    adapter: 'next-dev-webpack',
    signInPath: '/login',
    knownSignInPaths: [],
    chromeExecutable: '/fake/chrome',
  }
  return { storage, repository, hash, input }
}

/** One window: the real store over `storage`, and a setup that drives a fake Chrome and a fake dev server and records what they were asked. */
function window(storage: string, windowSession: string) {
  const store = new SavedSessionStore({
    globalStorage: storage,
    windowSession,
    listProcesses: async () => [],
  })
  const calls: string[] = []
  const notices: { severity: string; message: string }[] = []
  const clock = createManualClock()
  const setup = new SavedSessionSetup({
    store,
    startServer: async () => {
      calls.push('startServer')
      return {
        origin: 'http://localhost:3165',
        port: 3165,
        close: async (): Promise<void> => {
          calls.push('serverClose')
        },
      }
    },
    launchBrowser: async (options) => {
      calls.push(`launch ${options.url}`)
      // The fake Chrome is recorded the way the real one is, so crash recovery would find it.
      await options.recordBrowser({
        executable: '/fake/chrome',
        pid: process.pid,
        launchKind: 'detached',
      })
      return {
        chromeVersion: 'Chrome/154.0.1.2',
        onClosedByLearner: () => () => undefined,
        readAppCookieKind: async () => 'persistent',
        close: async () => {
          calls.push('browserClose')
          return 'graceful'
        },
      }
    },
    ui: {
      showStatus: () => undefined,
      offerDoneOrClose: () => new Promise(() => undefined),
      warnClosingSoon: () => new Promise(() => undefined),
      notify: async (severity, message) => {
        notices.push({ severity, message })
        return undefined
      },
      log: () => undefined,
      showLog: () => undefined,
    },
    clock: {
      now: () => START_EPOCH_MS + clock.now(),
      setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
      clearTimeout: (handle) => clock.clearTimeout(Number(handle)),
    },
  })
  return { store, setup, calls, notices }
}

/** Says whether a path exists, links included. */
function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  )
}

// Value: protects=Cycle 0070 pt2 I1 (A1's store and A2's setup agree on one contract); fails_when=Done writes no confirmed record through the real store, the status does not read saved, or Remove leaves the folder or the outside lock; no_claim=real Chrome, real dev server, run launch (lane B)
test('Set Up then Done writes a confirmed record through the real store, and Remove deletes the folder and the lock beside it', async (context) => {
  // Arrange
  const { storage, repository, hash, input } = await workspace(context)
  const editor = window(storage, 'window-a')
  const folder = join(storage, 'sign-in-profiles', hash)
  const lock = join(storage, 'sign-in-profiles', `${hash}.signin.lock`)

  // Act
  await editor.setup.start(input)
  const whileOpen = await editor.store.describe(repository)
  await editor.setup.done()
  const afterDone = await editor.store.describeForUi(repository)
  const record = JSON.parse(await readFile(join(folder, 'signin.json'), 'utf8'))
  const lockAfterDone = await exists(lock)
  const [entry] = await editor.store.list(repository)
  const removal = await editor.store.remove(entry!)

  // Assert
  assert.deepEqual(editor.calls, [
    'startServer',
    'launch http://localhost:3165/login',
    'browserClose',
    'serverClose',
  ])
  assert.deepEqual(whileOpen, {
    available: false,
    state: 'setup-open',
  })
  assert.deepEqual(afterDone, {
    available: true,
    state: 'saved',
    setupAt: '2026-11-02T12:10:00.000Z',
    repositoryName: 'repo-shop',
    confirmed: true,
    appCookies: 'persistent',
    setupOpenHere: false,
  })
  assert.deepEqual(
    {
      version: record.version,
      confirmed: record.confirmed,
      signInPaths: record.signInPaths,
      chromeMajor: record.chromeMajor,
      appCookies: record.appCookies,
    },
    {
      version: 1,
      confirmed: true,
      signInPaths: ['/login'],
      chromeMajor: 154,
      appCookies: 'persistent',
    },
  )
  assert.equal(lockAfterDone, false)
  assert.deepEqual(removal, { outcome: 'removed' })
  assert.equal(await exists(folder), false)
  assert.equal(await exists(lock), false)
  assert.deepEqual(await editor.store.describe(repository), {
    available: false,
    state: 'none',
  })
})

// Value: protects=E7/E11 refusal codes through the real store and setup; fails_when=a second window's setup or run is admitted while a setup holds the lock, starts a server, or answers another code; no_claim=a run in the same window (lane B)
test('a setup refused while another window holds the lock answers SIGN_IN_IN_PROGRESS, starts no server, and a run answers the same', async (context) => {
  // Arrange
  const { storage, repository, input } = await workspace(context)
  const first = window(storage, 'window-a')
  const second = window(storage, 'window-b')
  await first.setup.start(input)

  // Act
  await second.setup.start(input)
  const refusedSetup = await second.store.acquireForSetup(repository).then(
    () => undefined,
    (reason: unknown) => reason,
  )
  const refusedRun = await second.store
    .acquireForRun({
      repositoryRoot: repository,
      runId: 'run-1',
      session: 'saved-if-available',
      chromeVersion: 'Google Chrome 154.0.1.2',
      signal: new AbortController().signal,
    })
    .then(
      () => undefined,
      (reason: unknown) => reason,
    )

  // Assert
  assert.ok(refusedSetup instanceof StudyError)
  assert.equal(refusedSetup.code, 'SIGN_IN_IN_PROGRESS')
  assert.ok(refusedRun instanceof StudyError)
  assert.equal(refusedRun.code, 'SIGN_IN_IN_PROGRESS')
  assert.deepEqual(second.calls, [])
  assert.equal(second.notices.length, 1)
  assert.equal(second.notices[0]!.severity, 'error')
  await first.setup.done()
})

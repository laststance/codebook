import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { test } from 'node:test'

import {
  launchSignInBrowser,
  signInBrowserArguments,
  type SignInBrowserDependencies,
} from '../runtimeSupport/signInBrowser'
import { SignInBrowserStopUnconfirmedError } from '../runtimeSupport/utils/signInBrowserStopUnconfirmedError'

import { exitOf, fakeSetupChrome } from './utils/fakeSetupChrome'
import { idleChild } from './utils/idleChild'

const URL = 'http://localhost:3165/login'

/** Says whether a child process still runs: neither an exit code nor a signal ended it. */
function isRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

/**
 * The fake's dependencies with a listing that also names the saved-session folder for another process while it runs, as a Chrome the learner opened on that folder by hand (or a reused pid) does.
 * @param dependencies - The fake's dependencies.
 * @param stranger - A running process Codebook did not spawn for the setup.
 */
function withStrangerOnFolder(
  dependencies: SignInBrowserDependencies,
  stranger: ChildProcess,
): SignInBrowserDependencies {
  return {
    ...dependencies,
    listProfileProcesses: async (profile) => [
      ...(await dependencies.listProfileProcesses(profile)),
      ...(isRunning(stranger) && stranger.pid !== undefined
        ? [
            {
              pid: stranger.pid,
              command: 'chrome --user-data-dir=/saved/session',
            },
          ]
        : []),
    ],
  }
}

/** The fake's dependencies with a stopper that records every process it is asked to stop (a signal other than the null probe, or `taskkill`). */
function recordingStops(fake: Awaited<ReturnType<typeof fakeSetupChrome>>): {
  dependencies: SignInBrowserDependencies
  stopped: () => number[]
} {
  const stopped = new Set<number>()
  const { stopper } = fake.dependencies
  return {
    dependencies: {
      ...fake.dependencies,
      stopper: {
        ...stopper,
        signal: (pid, signal): void => {
          if (signal !== 0) stopped.add(Math.abs(pid))
          stopper.signal(pid, signal)
        },
        taskkill: (pid): Promise<void> => {
          stopped.add(pid)
          return stopper.taskkill(pid)
        },
      },
    },
    stopped: () => [...stopped],
  }
}

/** Launches the setup browser on a fake Chrome; the marker writes are collected. `dependencies` replaces the fake's own when a test wraps them. */
async function launch(
  fake: Awaited<ReturnType<typeof fakeSetupChrome>>,
  markers: object[] = [],
  dependencies: SignInBrowserDependencies = fake.dependencies,
) {
  return launchSignInBrowser(
    {
      executable: process.execPath,
      profile: '/saved/session',
      url: URL,
      signal: new AbortController().signal,
      recordBrowser: async (marker) => {
        markers.push(marker)
      },
    },
    dependencies,
  )
}

// protects=CEO-S28, CEO-R3, CEO-R6, AC2 (the learner's own profile is never opened); fails_when=--headless, --remote-debugging-port or a second --user-data-dir appears, or the disk cap is missing; no_claim=Chrome's flag parsing
test('the setup browser starts headed on the saved folder with a debugging pipe, never a debugging port or another profile', () => {
  // Arrange / Act
  const args = signInBrowserArguments('/p', URL)
  // Assert
  assert.deepEqual(args, [
    '--remote-debugging-pipe',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=/p',
    '--disk-cache-size=52428800',
    'http://localhost:3165/login',
  ])
})

// protects=ENG-10 graceful close, Codex 4; fails_when=close returns before the process exited, kills it first, or reports forced; no_claim=Chrome flushing cookies (real-Chrome test and the native check)
test('Done closes the setup browser with Browser.close and waits until it exited before anything is written', async (context) => {
  // Arrange
  const fake = await fakeSetupChrome(context)
  const markers: object[] = []
  const browser = await launch(fake, markers)
  // Act
  const result = await browser.close()
  // Assert
  assert.equal(result, 'graceful')
  assert.notEqual(fake.child().exitCode ?? fake.child().signalCode, null)
  assert.deepEqual(await fake.methods(), [
    'Browser.getVersion',
    'Target.setDiscoverTargets',
    'Browser.close',
  ])
  assert.equal(browser.chromeVersion, 'Chrome/154.0.1.2')
  assert.deepEqual(markers, [
    {
      executable: process.execPath,
      pid: fake.child().pid,
      // The setup browser leads its own process group off Windows, so a later window may signal the group.
      launchKind: process.platform === 'win32' ? 'attached' : 'detached',
    },
  ])
})

// protects=bounded Done, Codex 4; fails_when=Done hangs, reports graceful, or leaves the process running; no_claim=real Chrome hangs
test('a setup browser that ignores Browser.close is ended at the bound and reported as forced', async (context) => {
  // Arrange
  const fake = await fakeSetupChrome(context, 'ignore-close')
  const browser = await launch(fake)
  const bound = new AbortController()
  bound.abort()
  // Act
  const result = await browser.close(bound.signal)
  await exitOf(fake.child())
  // Assert
  assert.equal(result, 'forced')
  assert.ok((await fake.methods()).includes('Browser.close'))
})

// protects=Codex 4 (forced close that cannot be confirmed keeps the lock); fails_when=an unavailable listing reads as a confirmed exit, or a retry cannot succeed; no_claim=real process listings
test('a close whose exit cannot be confirmed answers unconfirmed, and a retry with a working listing confirms it', async (context) => {
  // Arrange
  const fake = await fakeSetupChrome(context)
  const browser = await launch(fake)
  fake.failListing(true)
  const bound = new AbortController()
  // Act
  const closing = browser.close(bound.signal)
  // The fake honours Browser.close and exits by itself; only the listing is missing, so nothing is stopped and the bound then ends the wait.
  await exitOf(fake.child())
  bound.abort()
  const first = await closing
  fake.failListing(false)
  const second = await browser.close()
  // Assert
  assert.equal(first, 'unconfirmed')
  assert.equal(second, 'graceful')
})

// protects=E11/DES-2 closing the browser; fails_when=the macOS last-window case (process stays alive) goes unnoticed or fires twice; no_claim=Chrome's own target events
test('closing the last page of the setup browser reads as Close setup', async (context) => {
  // Arrange
  const fake = await fakeSetupChrome(context)
  const browser = await launch(fake)
  const closed: string[] = []
  const told = new Promise<void>((resolve) =>
    browser.onClosedByLearner(() => {
      closed.push('closed')
      resolve()
    }),
  )
  // Act
  fake.closePage()
  await told
  // Assert
  assert.deepEqual(closed, ['closed'])
})

// protects=task 2 no cookie or token in any sink, ENG-10 cookie kind, Codex 5; fails_when=a cookie value or name is returned, or the kind is misread; no_claim=OAuth provider cookies of other hosts
test('the setup reads only the kind of the app cookies: no cookie value reaches the return value', async (context) => {
  // Arrange
  const fake = await fakeSetupChrome(context, 'honour-close', [
    {
      name: 'authjs.session-token',
      value: 'tok-SECRET-123',
      domain: 'localhost',
      session: false,
    },
    {
      name: 'gh_sess',
      value: 'oauth-SECRET-456',
      domain: '.github.com',
      session: false,
    },
  ])
  const browser = await launch(fake)
  // Act
  const kind = await browser.readAppCookieKind('localhost')
  await browser.close()
  // Assert
  assert.equal(kind, 'persistent')
  assert.equal(JSON.stringify(kind).includes('SECRET'), false)
})

// protects=ENG-10 session-cookie-only; fails_when=only session cookies read as persistent, or none as session-only; no_claim=cookie loss itself
test('the app cookie kind is session-only when every cookie of the host dies with the browser and none when the host has no cookie', async (context) => {
  // Arrange
  const sessionOnly = await fakeSetupChrome(context, 'honour-close', [
    { name: 'a', value: 'v', domain: 'localhost', session: true },
  ])
  const empty = await fakeSetupChrome(context, 'honour-close', [
    { name: 'a', value: 'v', domain: 'example.com', session: false },
  ])
  const first = await launch(sessionOnly)
  const second = await launch(empty)
  // Act
  const kinds = [
    await first.readAppCookieKind('localhost'),
    await second.readAppCookieKind('localhost'),
  ]
  await first.close()
  await second.close()
  // Assert
  assert.deepEqual(kinds, ['session-only', 'none'])
})

// protects=E7, AC6 setup session never recorded; fails_when=any screencast, screenshot, script or other page method is sent; no_claim=OS-level screen recording
test('the setup browser is never screencast or recorded: it sends only the four allowed methods', async (context) => {
  // Arrange
  const fake = await fakeSetupChrome(context)
  const browser = await launch(fake)
  // Act
  await browser.readAppCookieKind('localhost')
  await browser.close()
  // Assert
  assert.deepEqual(await fake.methods(), [
    'Browser.getVersion',
    'Target.setDiscoverTargets',
    'Storage.getCookies',
    'Browser.close',
  ])
})

// protects=CEO-R2 (a failed launch stops what started); fails_when=the spawned browser keeps running after the marker write failed; no_claim=real Chrome
test('a launch whose marker cannot be written stops the browser it started and throws', async (context) => {
  // Arrange
  const fake = await fakeSetupChrome(context)
  // Act
  const failure = launchSignInBrowser(
    {
      executable: process.execPath,
      profile: '/saved/session',
      url: URL,
      signal: new AbortController().signal,
      recordBrowser: async () => {
        throw new Error('marker write failed')
      },
    },
    fake.dependencies,
  )
  // Assert
  await assert.rejects(failure, /marker write failed/)
  await exitOf(fake.child())
})

// protects=OCR 38, OCR 27, Codex 4 (a launch failure whose stop cannot be confirmed tells the caller to keep the lock, and its own running browser is still stopped); fails_when=the failure reads as an ordinary one (the caller releases the lock), the browser keeps running because the listing failed, or a retry cannot confirm the stop; no_claim=real Chrome, real process listings
test('a launch that fails while the process listing is unavailable still stops its browser, reports the stop as unconfirmed, and a retry confirms it', async (context) => {
  // Arrange
  const fake = await fakeSetupChrome(context)
  const stops = recordingStops(fake)
  fake.failListing(true)
  // Act / Assert
  const failure = await launchSignInBrowser(
    {
      executable: process.execPath,
      profile: '/saved/session',
      url: URL,
      signal: new AbortController().signal,
      recordBrowser: async () => {
        throw new Error('marker write failed')
      },
    },
    stops.dependencies,
  ).then(
    () => undefined,
    (error: unknown) => error,
  )
  assert.ok(failure instanceof SignInBrowserStopUnconfirmedError)
  assert.equal(failure.message, 'marker write failed')
  assert.deepEqual(stops.stopped(), [fake.child().pid])
  await exitOf(fake.child())
  fake.failListing(false)
  assert.equal(await failure.retryStop(), true)
})

// protects=OCR 31 (a retry after a close that sent a stop is never graceful, so a Done is saved only for a browser that closed by itself); fails_when=the retry of a force-stopped browser reads as graceful; no_claim=Chrome flushing cookies
test('a retry after a close that had to stop the browser reads as forced, never graceful', async (context) => {
  // Arrange
  const fake = await fakeSetupChrome(context, 'ignore-close')
  const browser = await launch(fake)
  fake.failListing(true)
  const bound = new AbortController()
  bound.abort()
  // Act
  const first = await browser.close(bound.signal)
  await exitOf(fake.child())
  fake.failListing(false)
  const second = await browser.close()
  // Assert
  assert.equal(first, 'unconfirmed')
  assert.equal(second, 'forced')
})

// protects=outside voice 3 (a forced close signals only the browser Codebook spawned), Codex 4 (the lock stays while the folder may be in use); fails_when=a process that merely names the folder after the setup browser exited gets SIGTERM, SIGKILL or taskkill, or the close reads as forced while it runs; no_claim=how a second Chrome came to open the folder
test('after the setup browser exited, a forced close never stops another process that names the saved-session folder and keeps the folder locked', async (context) => {
  // Arrange
  const fake = await fakeSetupChrome(context)
  const stranger = await idleChild(context)
  const stops = recordingStops(fake)
  const browser = await launch(
    fake,
    [],
    withStrangerOnFolder(stops.dependencies, stranger),
  )
  const bound = new AbortController()
  // Act
  const closing = browser.close(bound.signal)
  // The fake honours Browser.close and exits; the stranger keeps naming the folder, so the bound ends the graceful wait.
  await exitOf(fake.child())
  bound.abort()
  const result = await closing
  // Assert
  assert.equal(result, 'unconfirmed')
  assert.deepEqual(stops.stopped(), [])
  assert.equal(isRunning(stranger), true)
})

// protects=outside voice 3 (only the spawned browser and its own group are signalled); fails_when=a process outside the setup browser's group that names the folder is signalled with it, or the close reads as forced while that process runs; no_claim=Chrome helpers that leave the group (they keep the close unconfirmed)
test('a forced close stops the setup browser it started but never another process that names the folder, and stays unconfirmed while that process runs', async (context) => {
  // Arrange
  const fake = await fakeSetupChrome(context, 'ignore-close')
  const stranger = await idleChild(context)
  const stops = recordingStops(fake)
  const browser = await launch(
    fake,
    [],
    withStrangerOnFolder(stops.dependencies, stranger),
  )
  const bound = new AbortController()
  bound.abort()
  // Act
  const result = await browser.close(bound.signal)
  await exitOf(fake.child())
  // Assert
  assert.equal(result, 'unconfirmed')
  assert.deepEqual(stops.stopped(), [fake.child().pid])
  assert.equal(isRunning(stranger), true)
})

// protects=outside voice 3 (a pid that went to another process during the stop is never signalled), lane A1 start proof; fails_when=the stop sends SIGKILL after the browser's pid shows another start, or the close reads as forced; no_claim=the real start reads (readProcessStart tests) and a real pid reuse
test('a forced close sends no SIGKILL once the setup browser pid shows another start than the one it had when the stop began', async (context) => {
  // Arrange
  const fake = await fakeSetupChrome(context, 'ignore-close-and-sigterm')
  const signals: string[] = []
  const { stopper } = fake.dependencies
  let startReads = 0
  const browser = await launch(fake, [], {
    ...fake.dependencies,
    stopper: {
      ...stopper,
      signal: (pid, signal): void => {
        if (signal !== 0) signals.push(`${signal} ${pid}`)
        stopper.signal(pid, signal)
      },
    },
    // The first read proves the spawned browser; every later read finds another process under its pid.
    readStart: async () => {
      startReads += 1
      return startReads === 1
        ? 'ps:Mon Nov  2 10:00:00 2026'
        : 'ps:Mon Nov  2 10:07:00 2026'
    },
  })
  const bound = new AbortController()
  bound.abort()
  // Act
  const result = await browser.close(bound.signal)
  // Assert
  const pid = fake.child().pid
  assert.equal(result, 'unconfirmed')
  // The group signal carries the negated pid; the SIGTERM went out while the start still matched.
  assert.deepEqual(signals, [`SIGTERM -${pid}`])
  assert.equal(isRunning(fake.child()), true)
})

// protects=structured review P2 (a close before the setup subscribes is not lost); fails_when=the learner closes the window while the setup browser still starts and the setup is never told, so the dev server and the lock stay until Close setup or the 10-minute timeout; no_claim=the setup state machine's own handling (savedSessionSetup tests)
test('a setup browser whose last page closed while it was still starting tells the setup once it subscribes', async (context) => {
  // Arrange
  const fake = await fakeSetupChrome(context, 'close-page-before-answer')
  const browser = await launch(fake)
  const closed: string[] = []
  // Act
  browser.onClosedByLearner(() => {
    closed.push('closed')
  })
  const toldDuringSubscription = [...closed]
  await new Promise((resolve) => setImmediate(resolve))
  // Assert
  assert.deepEqual(toldDuringSubscription, [])
  assert.deepEqual(closed, ['closed'])
})

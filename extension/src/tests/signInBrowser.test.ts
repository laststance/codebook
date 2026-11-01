import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  launchSignInBrowser,
  signInBrowserArguments,
} from '../runtimeSupport/signInBrowser'

import { exitOf, fakeSetupChrome } from './utils/fakeSetupChrome'

const URL = 'http://localhost:3165/login'

/** Launches the setup browser on a fake Chrome; the marker writes are collected. */
async function launch(
  fake: Awaited<ReturnType<typeof fakeSetupChrome>>,
  markers: object[] = [],
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
    fake.dependencies,
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
  bound.abort()
  // Act
  const first = await browser.close(bound.signal)
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

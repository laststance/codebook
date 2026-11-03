import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { FlatCdpCommandError } from '../runtimeSupport/flatCdpConnection'
import {
  launchOwnedExtensionBrowser,
  type OwnedBrowserLaunchOptions,
} from '../runtimeSupport/ownedExtensionBrowser'

import {
  fakeOwnedChrome,
  type FakeOwnedChromeBehaviour,
  type RecordedCommand,
} from './utils/fakeOwnedChrome'

const EXTENSION_ID = 'kgdakicbeoenmomkdpkiobphgcknpomd'
const WAKE_BOUND_MS = 5_000

/** A virtual clock: the fake's sleeps and unanswered commands advance it, so a 5 s wait takes no real time. */
function virtualClock() {
  let nowMs = 1_000
  return {
    now: (): number => nowMs,
    advance: (ms: number): void => {
      nowMs += ms
    },
  }
}

/** Makes a profile root of the test's own and removes it afterwards. */
async function profileRoot(context: TestContext): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-owned-start-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/** Launch options of a page-surface run (no popup, so the launch itself never sends `ServiceWorker.startWorker`). */
function pageOptions(
  root: string,
  overrides: Partial<OwnedBrowserLaunchOptions['run']> = {},
): OwnedBrowserLaunchOptions {
  return {
    chromeExecutable: '/chrome/bin/chrome',
    profileRoot: root,
    owner: { hostname: 'workstation' },
    run: {
      root: '/Users/learner/private/project/extension',
      extensionId: EXTENSION_ID,
      surface: { kind: 'page', path: 'page.html' },
      surfaceUrl: `chrome-extension://${EXTENSION_ID}/page.html`,
      workerPath: 'worker.js',
      seed: { bookmarks: [], storage: {} },
      ...overrides,
    },
  }
}

/** A healthy fake Chrome on a virtual clock. */
function behaviourOf(
  clock: ReturnType<typeof virtualClock>,
  overrides: Partial<FakeOwnedChromeBehaviour> = {},
): FakeOwnedChromeBehaviour {
  return { loadedId: EXTENSION_ID, popupOpens: true, clock, ...overrides }
}

/** Counts the `ServiceWorker.startWorker` commands among recorded ones. */
function startsIn(commands: readonly RecordedCommand[]): number {
  return commands.filter(({ method }) => method === 'ServiceWorker.startWorker')
    .length
}

// Value: protects=the worker start that Chrome silently dropped (ServiceWorker.startWorker answers success and discards the start); fails_when=startWorker sends once and waits, so a dropped first start leaves the worker unlisted until the deadline; no_claim=real Chrome dropping a start (E1 showed the command is fire-and-forget, not how often it is dropped)
test('startWorker lists the worker after a re-send when Chrome ignored the first start', async (context) => {
  // Arrange
  const clock = virtualClock()
  const chrome = fakeOwnedChrome(behaviourOf(clock, { ignoredStarts: 1 }))
  const browser = await launchOwnedExtensionBrowser(
    pageOptions(await profileRoot(context)),
    chrome.dependencies,
  )
  const startedAt = clock.now()
  // Act
  const result = await browser.startWorker(startedAt + WAKE_BOUND_MS)
  // Assert
  assert.deepEqual(result, { listed: true, sends: 2 })
  assert.equal(startsIn(chrome.commands), 2)
  // The second send comes one second after the first, not at once.
  assert.equal(clock.now() - startedAt >= 1_000, true)
  await browser.close()
})

// Value: protects=the wake bound when the worker never starts; fails_when=the wait runs past the deadline, never re-sends, or sends without a bound; no_claim=real Chrome timing (virtual clock)
test('startWorker re-sends once a second and returns listed false at the deadline when the worker never appears', async (context) => {
  // Arrange
  const clock = virtualClock()
  const sentAt: number[] = []
  const chrome = fakeOwnedChrome(
    behaviourOf(clock, {
      ignoredStarts: 100,
      onCommand: ({ method }) => {
        if (method === 'ServiceWorker.startWorker') sentAt.push(clock.now())
      },
    }),
  )
  const browser = await launchOwnedExtensionBrowser(
    pageOptions(await profileRoot(context)),
    chrome.dependencies,
  )
  sentAt.length = 0
  const startedAt = clock.now()
  const deadlineAt = startedAt + WAKE_BOUND_MS
  // Act
  const result = await browser.startWorker(deadlineAt)
  const commandsAtEnd = chrome.commands.length
  clock.advance(10_000)
  // Assert
  assert.deepEqual(result, { listed: false, sends: 5 })
  assert.deepEqual(
    sentAt.map((at) => at - startedAt),
    [0, 1_000, 2_000, 3_000, 4_000],
  )
  assert.equal(clock.now() - 10_000 <= deadlineAt, true)
  assert.equal(chrome.commands.length, commandsAtEnd)
  await browser.close()
})

// Value: protects=E14, a Chrome that never answers cannot stretch the wake; fails_when=a request keeps its 10 s default timeout inside the wait, or a re-send leaves after the deadline; no_claim=a real hung Chrome
test('startWorker ends at its deadline and sends nothing after it when Chrome never answers', async (context) => {
  // Arrange
  const clock = virtualClock()
  const sentAt: number[] = []
  let hanging = false
  const chrome = fakeOwnedChrome(
    behaviourOf(clock, {
      neverAnswers: () => hanging,
      onCommand: ({ method }) => {
        if (hanging && method === 'ServiceWorker.startWorker')
          sentAt.push(clock.now())
      },
    }),
  )
  const browser = await launchOwnedExtensionBrowser(
    pageOptions(await profileRoot(context)),
    chrome.dependencies,
  )
  hanging = true
  const deadlineAt = clock.now() + WAKE_BOUND_MS
  // Act
  const result = await browser.startWorker(deadlineAt)
  const endedAt = clock.now()
  const commandsAtEnd = chrome.commands.length
  clock.advance(10_000)
  // Assert
  assert.equal(result.listed, false)
  assert.equal(endedAt, deadlineAt)
  assert.equal(
    sentAt.every((at) => at <= deadlineAt),
    true,
  )
  assert.equal(chrome.commands.length, commandsAtEnd)
  hanging = false
  await browser.close()
})

// Value: protects=E14, a Stop mid-wake ends the wait and the re-sends; fails_when=the wait ignores the signal and runs to the deadline; no_claim=the debugger's own handling of the abort
test('startWorker stops re-sending and rejects with the signal reason when the run is stopped mid-wait', async (context) => {
  // Arrange
  const clock = virtualClock()
  const controller = new AbortController()
  const reason = new Error('stopped by the learner')
  let startsSeen = 0
  let counting = false
  const chrome = fakeOwnedChrome(
    behaviourOf(clock, {
      ignoredStarts: 100,
      onCommand: ({ method }) => {
        if (!counting || method !== 'ServiceWorker.startWorker') return
        startsSeen += 1
        // The Stop arrives together with the second send.
        if (startsSeen === 2) controller.abort(reason)
      },
    }),
  )
  const browser = await launchOwnedExtensionBrowser(
    pageOptions(await profileRoot(context)),
    chrome.dependencies,
  )
  counting = true
  const startedAt = clock.now()
  // Act
  const failure = await browser
    .startWorker(startedAt + WAKE_BOUND_MS, controller.signal)
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  const endedAt = clock.now()
  const commandsAtEnd = chrome.commands.length
  clock.advance(10_000)
  // Assert
  assert.equal(failure, reason)
  assert.equal(endedAt - startedAt, 1_000)
  assert.equal(startsSeen, 2)
  assert.equal(chrome.commands.length, commandsAtEnd)
  await browser.close()
})

// Value: protects=BROWSER_LOST stays distinct from a timeout; fails_when=a lost connection is swallowed as no answer and the wait runs to the deadline; no_claim=how the run reacts to the loss
test('startWorker rejects with BROWSER_LOST when the connection ends while waiting', async (context) => {
  // Arrange
  const clock = virtualClock()
  let lost = false
  const chrome = fakeOwnedChrome(
    behaviourOf(clock, {
      ignoredStarts: 100,
      onCommand: ({ method }) => {
        if (lost)
          throw new FlatCdpCommandError(method, undefined, 'CDP disconnected')
      },
    }),
  )
  const browser = await launchOwnedExtensionBrowser(
    pageOptions(await profileRoot(context)),
    chrome.dependencies,
  )
  lost = true
  // Act
  const failure = await browser.startWorker(clock.now() + WAKE_BOUND_MS).then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'BROWSER_LOST')
  lost = false
  await browser.close()
})

// Value: protects=an extension without a declared worker is never sent a start; fails_when=ServiceWorker.startWorker is sent for it, which Chrome rejects; no_claim=the popup launch path
test('startWorker returns at once with no send for an extension that declares no worker', async (context) => {
  // Arrange
  const clock = virtualClock()
  const chrome = fakeOwnedChrome(behaviourOf(clock))
  const browser = await launchOwnedExtensionBrowser(
    pageOptions(await profileRoot(context), { workerPath: undefined }),
    chrome.dependencies,
  )
  const before = clock.now()
  // Act
  const result = await browser.startWorker(before + WAKE_BOUND_MS)
  // Assert
  assert.deepEqual(result, { listed: false, sends: 0 })
  assert.equal(startsIn(chrome.commands), 0)
  assert.equal(clock.now(), before)
  await browser.close()
})

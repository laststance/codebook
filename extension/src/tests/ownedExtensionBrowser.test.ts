import assert from 'node:assert/strict'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { FlatCdpCommandError } from '../runtimeSupport/flatCdpConnection'
import {
  launchOwnedExtensionBrowser,
  type OwnedBrowserLaunchOptions,
} from '../runtimeSupport/ownedExtensionBrowser'
import { ownedBrowserBookmarks } from '../runtimeSupport/utils/ownedBrowserBookmarks'
import { readDevToolsActivePort } from '../runtimeSupport/utils/readDevToolsActivePort'

import {
  fakeOwnedChrome,
  type FakeOwnedChromeBehaviour,
} from './utils/fakeOwnedChrome'

const EXTENSION_ID = 'kgdakicbeoenmomkdpkiobphgcknpomd'
const EXTENSION_ROOT = '/Users/learner/private/project/extension'

/** Makes a profile root of the test's own and removes it afterwards. */
async function profileRoot(context: TestContext): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-owned-launch-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/** Builds the launch options of a popup run with a seed. */
function launchOptions(
  root: string,
  overrides: Partial<OwnedBrowserLaunchOptions['run']> = {},
  signal?: AbortSignal,
): OwnedBrowserLaunchOptions {
  return {
    chromeExecutable: '/chrome/bin/chrome',
    profileRoot: root,
    owner: { hostname: 'workstation' },
    ...(signal !== undefined && { signal }),
    run: {
      root: EXTENSION_ROOT,
      extensionId: EXTENSION_ID,
      surface: { kind: 'popup', path: 'popup.html' },
      surfaceUrl: `chrome-extension://${EXTENSION_ID}/popup.html`,
      workerPath: 'worker.js',
      seed: {
        bookmarks: [
          {
            title: 'Reading',
            children: [{ title: 'Docs', url: 'https://docs.example/' }],
          },
        ],
        storage: { viewMode: 'popup' },
      },
      ...overrides,
    },
  }
}

/** A healthy fake Chrome that answers the id the launch expects. */
function healthy(
  overrides: Partial<FakeOwnedChromeBehaviour> = {},
): FakeOwnedChromeBehaviour {
  return { loadedId: EXTENSION_ID, popupOpens: true, ...overrides }
}

/** Runs a launch that must fail and returns its error. */
async function failureOf(
  options: OwnedBrowserLaunchOptions,
  chrome: ReturnType<typeof fakeOwnedChrome>,
): Promise<StudyError> {
  try {
    await launchOwnedExtensionBrowser(options, chrome.dependencies)
  } catch (error) {
    assert.ok(error instanceof StudyError, String(error))
    return error
  }
  throw new Error('the launch was expected to fail')
}

// Value: protects=the order of the launch (install, stop, seed, read back, surface, stop again before the debugger attaches); fails_when=a step moves, for example the seed is written before the worker is stopped (the late default of the extension then wins) or the last stop is dropped (a running worker deadlocks the surface at the attach); no_claim=real Chrome (own integration test)
test('launch installs the extension, stops the worker before seeding, reads the seed back, opens the popup and stops the worker again', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  // Act
  const browser = await launchOwnedExtensionBrowser(
    launchOptions(root),
    chrome.dependencies,
  )
  // Assert
  const methods = chrome.commands
    .map(({ method }) => method)
    .filter((method) => method !== 'Target.getTargets')
  assert.deepEqual(methods, [
    'Browser.getVersion',
    'Target.attachToTarget',
    'Extensions.loadUnpacked',
    'ServiceWorker.enable',
    'ServiceWorker.stopAllWorkers',
    'Target.createTarget',
    'Target.attachToTarget',
    'Extensions.setStorageItems',
    'Extensions.getStorageItems',
    'Target.closeTarget',
    'ServiceWorker.startWorker',
    'Extensions.triggerAction',
    'ServiceWorker.stopAllWorkers',
  ])
  assert.equal(browser.port, 45678)
  assert.equal(browser.surfaceTargetId, 'popup-1')
  assert.equal(browser.controlSessionId, 'session-page-1')
  assert.deepEqual(await browser.close(), {
    profileLeft: false,
    exitConfirmed: true,
  })
})

// Value: protects=TZ1 (no flag that opens the debugger's extension surface or loads the extension at start); fails_when=the spawn gains --enable-unsafe-extension-debugging, --load-extension or --disable-extensions-except, or loses the owned profile or the random port; no_claim=Chrome honouring the switches
test('launch starts Chrome with its own profile and a random port, and never with an extension switch', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  // Act
  const browser = await launchOwnedExtensionBrowser(
    launchOptions(root),
    chrome.dependencies,
  )
  // Assert
  assert.equal(chrome.spawned[0]?.executable, '/chrome/bin/chrome')
  assert.deepEqual(chrome.spawned[0]?.args, [
    '--remote-debugging-port=0',
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${browser.profile}`,
    'about:blank',
  ])
  await browser.close()
})

// Value: protects=ER12 and ER18 (the folder is known to the sweep, the seed is in the profile before Chrome starts, and a close removes everything); fails_when=the markers or the Bookmarks file are missing or the folder stays after close; no_claim=a crashed editor
test('launch writes both owner markers and the seeded Bookmarks file before Chrome starts, and close removes the folder', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  // Act
  const browser = await launchOwnedExtensionBrowser(
    launchOptions(root),
    chrome.dependencies,
  )
  const owner = JSON.parse(
    await readFile(join(browser.profile, 'codebook-owner.json'), 'utf8'),
  )
  const bookmarks = JSON.parse(
    await readFile(join(browser.profile, 'Default', 'Bookmarks'), 'utf8'),
  )
  await stat(join(browser.profile, 'codebook-owned-browser'))
  await browser.close()
  // Assert
  assert.equal(owner.pid, process.pid)
  assert.equal(owner.hostname, 'workstation')
  assert.equal(bookmarks.roots.other.children[0].name, 'Reading')
  assert.deepEqual(await readdir(root), [])
})

// Value: protects=ER12's fixed template; fails_when=a root id, a node id order, a date or the checksum changes; no_claim=Chrome loading the file (real-Chrome test)
test('the seeded Bookmarks file has Chrome’s fixed root ids, sequential node ids, zero dates and no checksum', () => {
  // Arrange
  const seed = [
    {
      title: 'Reading',
      children: [{ title: 'Ünï コード', url: 'https://docs.example/' }],
    },
    { title: 'Home', url: 'https://home.example/' },
  ]
  // Act
  const file = JSON.parse(ownedBrowserBookmarks(seed))
  // Assert
  assert.deepEqual(
    [file.roots.bookmark_bar.id, file.roots.other.id, file.roots.synced.id],
    ['1', '2', '3'],
  )
  assert.equal(file.checksum, undefined)
  const other = file.roots.other.children
  assert.deepEqual(
    [other[0].id, other[0].children[0].id, other[1].id],
    ['4', '5', '6'],
  )
  assert.equal(other[0].children[0].name, 'Ünï コード')
  assert.equal(other[1].date_added, '0')
})

// Value: protects=SR28 and the EXTENSION_ID_MISMATCH contract; fails_when=another id is accepted or the message leaks the private part of the root; no_claim=the id rule
test('launch fails with EXTENSION_ID_MISMATCH carrying both ids, the Chrome version and a root without its private part, and closes the browser', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy({ loadedId: 'a'.repeat(32) }))
  // Act
  const error = await failureOf(launchOptions(root), chrome)
  // Assert
  assert.equal(error.code, 'EXTENSION_ID_MISMATCH')
  assert.equal(
    error.causeDetail,
    `expected ${EXTENSION_ID}, returned ${'a'.repeat(32)}, root …/project/extension, Chrome Chrome/156.0.0.1`,
  )
  assert.equal(chrome.closed(), true)
  assert.deepEqual(chrome.signals.includes('SIGTERM'), true)
  assert.deepEqual(await readdir(root), [])
})

// Value: protects=ER4; fails_when=a rejection of loadUnpacked is reported as another code or shows the private part of the root; no_claim=the shapes of real rejections (real-Chrome test)
test('launch fails with EXTENSION_LOAD_FAILED carrying Chrome’s message without the private root, and removes the profile', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(
    healthy({
      loadRejection: 'Manifest file is missing: <root>/manifest.json',
    }),
  )
  // Act
  const error = await failureOf(launchOptions(root), chrome)
  // Assert
  assert.equal(error.code, 'EXTENSION_LOAD_FAILED')
  // The message is the fixed sentence; Chrome's text, with the root hidden, is the cause.
  assert.equal(error.message, 'Chrome did not load the extension.')
  assert.equal(
    error.causeDetail,
    'Manifest file is missing: <workspace>/manifest.json',
  )
  assert.deepEqual(await readdir(root), [])
})

for (const missingMethod of [
  'Extensions.loadUnpacked',
  'ServiceWorker.stopAllWorkers',
  'Extensions.setStorageItems',
  'ServiceWorker.startWorker',
  'Extensions.triggerAction',
]) {
  // Value: protects=CR2; fails_when=a missing command is reported as a generic failure; no_claim=which Chrome lacks it
  test(`launch answers CHROME_COMMAND_UNAVAILABLE when Chrome has no ${missingMethod}`, async (context) => {
    // Arrange
    const root = await profileRoot(context)
    const chrome = fakeOwnedChrome(healthy({ missingMethod }))
    // Act
    const error = await failureOf(launchOptions(root), chrome)
    // Assert
    assert.equal(error.code, 'CHROME_COMMAND_UNAVAILABLE')
    assert.equal(
      error.message,
      'This Chrome (Chrome/156.0.0.1) does not offer the extension commands Codebook uses; set codebook.chromeExecutable to Google Chrome or Chrome for Testing 149 or later.',
    )
    assert.deepEqual(await readdir(root), [])
  })
}

// Value: protects=ER19; fails_when=a stored value that differs from the seed is accepted; no_claim=a late write by the extension (real-Chrome test)
test('launch fails with SEED_NOT_APPLIED naming the key whose stored value differs', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(
    healthy({ storedData: { viewMode: 'fullpage' } }),
  )
  // Act
  const error = await failureOf(launchOptions(root), chrome)
  // Assert
  assert.equal(error.code, 'SEED_NOT_APPLIED')
  assert.equal(error.message, 'The seeded storage was not applied: viewMode.')
  assert.equal(chrome.closed(), true)
})

// Value: protects=TZ4; fails_when=a popup that never opens does not end the launch with POPUP_NOT_OPENED; no_claim=the 5 s bound's duration (the fake has no clock)
test('launch fails with POPUP_NOT_OPENED when the action opens no popup', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy({ popupOpens: false }))
  // Act
  const error = await failureOf(launchOptions(root), chrome)
  // Assert
  assert.equal(error.code, 'POPUP_NOT_OPENED')
  assert.equal(
    error.message,
    "The extension's action opened no popup with the seeded state.",
  )
})

// Value: protects=TZ4 and B6 (the last look after the last pause still decides); fails_when=the last target look is sent with the spent budget's 1 ms timeout, so a real Chrome's answer arrives too late and the launch fails as RUNTIME_FAILED instead of POPUP_NOT_OPENED; no_claim=the 5 s bound's duration (the fake has no clock)
test('a popup that never opens still fails with POPUP_NOT_OPENED when Chrome takes a few milliseconds to answer each command', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(
    healthy({ popupOpens: false, answerLatencyMs: 5 }),
  )
  // Act
  const error = await failureOf(launchOptions(root), chrome)
  // Assert
  assert.equal(error.code, 'POPUP_NOT_OPENED')
  assert.equal(
    error.message,
    "The extension's action opened no popup with the seeded state.",
  )
})

// Value: protects=a page surface and an empty seed; fails_when=a page run sends popup commands or storage commands; no_claim=real Chrome
test('a page surface is opened with createTarget, an empty storage seed sends no storage command, and no popup action is triggered', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  const surfaceUrl = `chrome-extension://${EXTENSION_ID}/page.html`
  // Act
  const browser = await launchOwnedExtensionBrowser(
    launchOptions(root, {
      surface: { kind: 'page', path: 'page.html' },
      surfaceUrl,
      seed: { bookmarks: [], storage: {} },
    }),
    chrome.dependencies,
  )
  // Assert
  const methods = chrome.commands.map(({ method }) => method)
  assert.equal(methods.includes('Extensions.setStorageItems'), false)
  assert.equal(methods.includes('Extensions.triggerAction'), false)
  assert.equal(browser.surfaceTargetId, `created-1-${surfaceUrl}`)
  await browser.close()
})

// Value: protects=CR14; fails_when=a stop accepted during the install lets the sequence go on to the next step; no_claim=the stop's own handling
test('a stop accepted while the extension installs ends the launch before the workers are touched, and closes the browser', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const stop = new AbortController()
  const chrome = fakeOwnedChrome(
    healthy({
      onCommand: ({ method }) => {
        if (method === 'Extensions.loadUnpacked') stop.abort()
      },
    }),
  )
  // Act
  const error = await failureOf(launchOptions(root, {}, stop.signal), chrome)
  // Assert
  assert.equal(error.code, 'RUNTIME_FAILED')
  assert.equal(
    chrome.commands.some(
      ({ method }) => method === 'ServiceWorker.stopAllWorkers',
    ),
    false,
  )
  assert.equal(chrome.closed(), true)
  assert.deepEqual(await readdir(root), [])
})

// Value: protects=CR12; fails_when=a profile that cannot be written leaves a folder or starts a browser; no_claim=Windows locks
test('a profile that cannot be prepared fails the start with no browser started and no folder left', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  // Act
  const error = await failureOf(
    launchOptions(join(root, 'does-not-exist')),
    chrome,
  )
  // Assert
  assert.equal(error.code, 'RUNTIME_FAILED')
  assert.equal(error.message, "The run's test profile could not be prepared.")
  // The system's detail stays in the cause, with the profile root hidden.
  assert.match(error.causeDetail, /ENOENT/)
  assert.equal(error.causeDetail.includes(root), false)
  assert.deepEqual(chrome.spawned, [])
})

// Value: protects=ER18's report; fails_when=a browser that does not end reports a confirmed exit; no_claim=real signals
test('close reports an unconfirmed exit instead of throwing when the browser does not end', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  // A process that ignores every signal.
  const stubborn = { ...chrome.dependencies.stopper, signal: () => undefined }
  const second = await launchOwnedExtensionBrowser(launchOptions(root), {
    ...chrome.dependencies,
    stopper: stubborn,
  })
  // Act
  const closing = await second.close()
  // Assert
  assert.equal(closing.exitConfirmed, false)
  assert.equal(closing.profileLeft, false)
})

test('the debugging endpoint is read only from a complete file of Chrome’s two lines', () => {
  // Arrange
  const complete = '51234\n/devtools/browser/abc-def\n'
  // Act / Assert
  assert.deepEqual(readDevToolsActivePort(complete), {
    port: 51234,
    path: '/devtools/browser/abc-def',
  })
  assert.equal(readDevToolsActivePort('51234'), undefined)
  assert.equal(readDevToolsActivePort(''), undefined)
})

// Value: protects=ER19 and B3 (Chrome answers object keys sorted); fails_when=the read-back compares JSON text, so a seed whose keys are not sorted fails SEED_NOT_APPLIED on a healthy Chrome; no_claim=values Chrome changes
test('launch accepts a nested seed whose keys Chrome answers in sorted order', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  const seed = {
    zebra: { second: 2, first: [{ b: 1, a: 2 }] },
    apple: 'fruit',
  }
  // Act
  const browser = await launchOwnedExtensionBrowser(
    launchOptions(root, { seed: { bookmarks: [], storage: seed } }),
    chrome.dependencies,
  )
  // Assert
  assert.equal(browser.surfaceTargetId, 'popup-1')
  assert.deepEqual(await browser.close(), {
    profileLeft: false,
    exitConfirmed: true,
  })
})

// Value: protects=ER12 and CR-B2 (a seed node without url or children is a folder); fails_when=an empty folder is written as a url node with url ''; no_claim=Chrome loading the file
test('the seeded Bookmarks file writes a node without url or children as an empty folder', () => {
  // Arrange
  const seed = [
    { title: 'Empty' },
    { title: 'Home', url: 'https://home.example/' },
  ]
  // Act
  const file = JSON.parse(ownedBrowserBookmarks(seed))
  // Assert
  const [empty, home] = file.roots.other.children
  assert.deepEqual(
    [empty.type, empty.children, empty.url, home.type, home.url],
    ['folder', [], undefined, 'url', 'https://home.example/'],
  )
})

// Value: protects=B7 (the stop-again branch); fails_when=a worker that starts with the popup is left running when the debugger attaches; no_claim=real worker timing
test('launch stops a worker that starts again when the popup opens, before it returns', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy({ workerStartsWithPopup: true }))
  // Act
  const browser = await launchOwnedExtensionBrowser(
    launchOptions(root),
    chrome.dependencies,
  )
  // Assert
  const methods = chrome.commands.map(({ method }) => method)
  const afterPopup = methods.slice(methods.indexOf('Extensions.triggerAction'))
  assert.equal(
    afterPopup.filter((method) => method === 'ServiceWorker.stopAllWorkers')
      .length >= 1,
    true,
  )
  await browser.close()
})

// Value: protects=TZ3 and the 1 s stop timeout; fails_when=a stop command that times out ends the launch, or is not sent again; no_claim=the real 1 s duration
test('launch sends the worker stop again after the first one times out and still succeeds', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy({ stopTimesOutOnce: true }))
  // Act
  const browser = await launchOwnedExtensionBrowser(
    launchOptions(root),
    chrome.dependencies,
  )
  // Assert
  const stops = chrome.commands.filter(
    ({ method }) => method === 'ServiceWorker.stopAllWorkers',
  )
  assert.equal(stops.length >= 2, true)
  await browser.close()
})

// Value: protects=B6 (the bound counts the whole wait); fails_when=a worker that never stops waits unbounded, or the failure loses its cause; no_claim=the 3 s duration (the fake sleeps instantly, the budget charges the nominal pause)
test('launch fails with RUNTIME_FAILED naming the still-listed worker when no stop ends it in time', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy({ stopLeavesWorker: true }))
  // Act
  const error = await failureOf(launchOptions(root), chrome)
  // Assert
  assert.equal(error.code, 'RUNTIME_FAILED')
  assert.equal(
    error.message,
    'The extension’s service worker did not stop in time.',
  )
  assert.equal(
    error.causeDetail,
    `still listed: chrome-extension://${EXTENSION_ID}/worker.js`,
  )
})

// Value: protects=B6 (the last look after the last pause still decides); fails_when=the last worker look is sent with the spent budget's 1 ms timeout, so a real Chrome's answer arrives too late and the failure loses the still-listed worker; no_claim=the 3 s duration (the fake sleeps instantly, the budget charges the nominal pause)
test('a worker that never stops still fails naming the still-listed worker when Chrome takes a few milliseconds to answer each command', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(
    healthy({ stopLeavesWorker: true, answerLatencyMs: 5 }),
  )
  // Act
  const error = await failureOf(launchOptions(root), chrome)
  // Assert
  assert.equal(error.code, 'RUNTIME_FAILED')
  assert.equal(
    error.message,
    'The extension’s service worker did not stop in time.',
  )
  assert.equal(
    error.causeDetail,
    `still listed: chrome-extension://${EXTENSION_ID}/worker.js`,
  )
})

for (const phase of [
  'Browser.getVersion',
  'ServiceWorker.stopAllWorkers',
  'Extensions.getStorageItems',
  'Extensions.triggerAction',
]) {
  // Value: protects=CR14 and B6 (an accepted stop ends the launch in every phase); fails_when=a phase does not look at the signal, so the launch goes on to the next step; no_claim=the stop's own handling
  test(`a stop accepted at ${phase} ends the launch, ends the browser and removes the profile`, async (context) => {
    // Arrange
    const root = await profileRoot(context)
    const stop = new AbortController()
    let fired = false
    const chrome = fakeOwnedChrome(
      healthy({
        onCommand: ({ method }) => {
          if (method === phase && !fired) {
            fired = true
            stop.abort()
          }
        },
      }),
    )
    // Act
    const error = await failureOf(launchOptions(root, {}, stop.signal), chrome)
    // Assert
    assert.equal(error.code, 'RUNTIME_FAILED')
    assert.equal(
      error.message,
      'The start was stopped before the extension browser was ready.',
    )
    assert.equal(chrome.signals.includes('SIGTERM'), true)
    assert.equal(chrome.closed(), true)
    assert.deepEqual(await readdir(root), [])
  })
}

// Value: protects=CR14 (a stop accepted while Chrome starts); fails_when=the wait for DevToolsActivePort ignores the signal; no_claim=the real file
test('a stop accepted right after the spawn ends the launch before any connection and ends the browser', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const stop = new AbortController()
  const chrome = fakeOwnedChrome(healthy())
  let connected = false
  const dependencies = {
    ...chrome.dependencies,
    spawnBrowser: (executable: string, args: string[]) => {
      const browser = chrome.dependencies.spawnBrowser(executable, args)
      stop.abort()
      return browser
    },
    connect: async (url: string, timeoutMs: number) => {
      connected = true
      return chrome.dependencies.connect(url, timeoutMs)
    },
  }
  // Act
  const error = await launchOwnedExtensionBrowser(
    launchOptions(root, {}, stop.signal),
    dependencies,
  ).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.equal(error instanceof StudyError && error.code, 'RUNTIME_FAILED')
  assert.equal(connected, false)
  assert.equal(chrome.signals.includes('SIGTERM'), true)
  assert.deepEqual(await readdir(root), [])
})

// Value: protects=ER18; fails_when=a connection that cannot be opened leaves the browser or the profile, or throws a raw error; no_claim=real sockets
test('launch fails with RUNTIME_FAILED when the debugging connection cannot be opened, with the profile path hidden in the cause', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  const dependencies = {
    ...chrome.dependencies,
    connect: async (): Promise<never> => {
      throw new Error(`connect ECONNREFUSED near ${root}/codebook-browser-x`)
    },
  }
  // Act
  const error = await launchOwnedExtensionBrowser(
    launchOptions(root),
    dependencies,
  ).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'RUNTIME_FAILED')
  assert.equal(error.message, 'The extension browser could not be started.')
  assert.equal(chrome.signals.includes('SIGTERM'), true)
  assert.deepEqual(await readdir(root), [])
})

// Value: protects=ER18; fails_when=a spawn that ends before it publishes its port is reported as a timeout or leaves the folder; no_claim=Chrome's real startup failures
test('launch fails with RUNTIME_FAILED when Chrome ends before it publishes its debugging port, and removes the profile', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy({ exitsAtSpawn: true }))
  // Act
  const error = await failureOf(launchOptions(root), chrome)
  // Assert
  assert.equal(error.code, 'RUNTIME_FAILED')
  assert.equal(error.message, 'Chrome ended before it was ready.')
  assert.deepEqual(await readdir(root), [])
})

// Value: protects=B4 (every command failure is a StudyError); fails_when=an unmapped command's failure escapes as a raw FlatCdpCommandError, or shows the extension root; no_claim=which commands Chrome fails
test('a failing unmapped command ends the launch as RUNTIME_FAILED with the cause masked and the root hidden', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(
    healthy({
      rejectMethod: {
        method: 'Browser.getVersion',
        error: new FlatCdpCommandError(
          'Browser.getVersion',
          -32000,
          `internal ${EXTENSION_ROOT}/x with Bearer abcdef0123456789`,
        ),
      },
    }),
  )
  // Act
  const error = await failureOf(launchOptions(root), chrome)
  // Assert
  assert.equal(error.code, 'RUNTIME_FAILED')
  assert.equal(error.message, 'The extension browser could not be started.')
  assert.equal(error.causeDetail.includes(EXTENSION_ROOT), false)
  assert.equal(error.causeDetail.includes('abcdef0123456789'), false)
  assert.equal(chrome.closed(), true)
  assert.deepEqual(await readdir(root), [])
})

// Value: protects=B4 and the BROWSER_LOST contract; fails_when=a connection lost outside loadUnpacked is reported as another code; no_claim=the debugger's own loss handling
test('a connection lost during an unmapped command ends the launch as BROWSER_LOST', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(
    healthy({
      rejectMethod: {
        method: 'Target.attachToTarget',
        error: new FlatCdpCommandError(
          'Target.attachToTarget',
          undefined,
          'CDP disconnected',
        ),
      },
    }),
  )
  // Act
  const error = await failureOf(launchOptions(root), chrome)
  // Assert
  assert.equal(error.code, 'BROWSER_LOST')
  assert.equal(error.message, 'Chrome ended during the start.')
  assert.deepEqual(await readdir(root), [])
})

// Value: protects=B8; fails_when=the close signals only the main pid, leaving helpers that keep the profile busy; no_claim=real process groups (real-Chrome test)
test('close signals the browser through its process group first on POSIX', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  const browser = await launchOwnedExtensionBrowser(
    launchOptions(root),
    chrome.dependencies,
  )
  // Act
  await browser.close()
  // Assert
  assert.deepEqual(chrome.signalledIds, [-987_654])
})

// Value: protects=ER18's report (profileLeft); fails_when=a folder that cannot be removed is reported as removed, or close throws; no_claim=Windows locks (POSIX permissions here)
test('close reports profileLeft when the profile folder cannot be removed', async (context) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) {
    context.skip('needs POSIX permissions and a user that is not root')
    return
  }
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  const browser = await launchOwnedExtensionBrowser(
    launchOptions(root),
    chrome.dependencies,
  )
  // A parent that refuses removals keeps the folder.
  await chmod(root, 0o555)
  // Act
  const closing = await browser.close().finally(() => chmod(root, 0o755))
  // Assert
  assert.deepEqual(closing, { profileLeft: true, exitConfirmed: true })
  assert.equal((await readdir(root)).length, 1)
})

// Value: protects=acceptance 4 (Chrome below 149 refused before launch); fails_when=an old Chrome is spawned or the refusal loses its code or sentence; no_claim=the version reader's real process
test('launch refuses Chrome 148 with CHROME_VERSION_UNSUPPORTED before any profile or browser exists', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(
    healthy({ executableVersionText: 'Google Chrome 148.0.7778.96' }),
  )
  // Act
  const error = await failureOf(launchOptions(root), chrome)
  // Assert
  assert.equal(error.code, 'CHROME_VERSION_UNSUPPORTED')
  assert.equal(
    error.message,
    'Chrome 149 or later is needed to load an unpacked extension; found 148.0.7778.96.',
  )
  assert.deepEqual(chrome.versionReads, ['/chrome/bin/chrome'])
  assert.deepEqual(chrome.spawned, [])
  assert.deepEqual(await readdir(root), [])
})

// Value: protects=the unreadable-version decision (refused, naming unknown); fails_when=an executable that prints no version is launched anyway; no_claim=why it printed nothing
test('launch refuses an executable whose version cannot be read, naming unknown, and spawns nothing', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy({ executableVersionText: '' }))
  // Act
  const error = await failureOf(launchOptions(root), chrome)
  // Assert
  assert.equal(error.code, 'CHROME_VERSION_UNSUPPORTED')
  assert.equal(
    error.message,
    'Chrome 149 or later is needed to load an unpacked extension; found unknown.',
  )
  assert.deepEqual(chrome.spawned, [])
})

// Value: protects=the defence after connecting (the spawned browser's own product is judged); fails_when=a browser reporting Chrome 148 through Browser.getVersion is used or left open; no_claim=--version being right
test('launch refuses a connected browser that reports Chrome 148 and closes it', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(
    healthy({ browserProduct: 'HeadlessChrome/148.0.7778.96' }),
  )
  // Act
  const error = await failureOf(launchOptions(root), chrome)
  // Assert
  assert.equal(error.code, 'CHROME_VERSION_UNSUPPORTED')
  assert.equal(
    error.message,
    'Chrome 149 or later is needed to load an unpacked extension; found 148.0.7778.96.',
  )
  assert.equal(chrome.closed(), true)
  assert.deepEqual(await readdir(root), [])
})

// Value: protects=CR15 (the run journals each phase); fails_when=a phase is missing, renamed, reordered or reported with a decreasing time for a popup run; no_claim=the debugger's phases
test('launch reports launching, installing and opening in order with non-decreasing elapsed milliseconds for a popup surface', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  const reported: { name: string; elapsedMs: number }[] = []
  // Act
  const browser = await launchOwnedExtensionBrowser(
    {
      ...launchOptions(root),
      onPhase: (name, elapsedMs) => reported.push({ name, elapsedMs }),
    },
    chrome.dependencies,
  )
  // Assert
  assert.deepEqual(
    reported.map(({ name }) => name),
    ['launching', 'installing', 'opening'],
  )
  const times = reported.map(({ elapsedMs }) => elapsedMs)
  assert.ok((times[0] ?? -1) >= 0)
  assert.deepEqual(
    times,
    [...times].sort((left, right) => left - right),
  )
  await browser.close()
})

// Value: protects=CR15 for a page surface; fails_when=the page path skips or duplicates a phase; no_claim=elapsed accuracy
test('launch reports the same three phases for a page surface', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  const names: string[] = []
  // Act
  const browser = await launchOwnedExtensionBrowser(
    {
      ...launchOptions(root, {
        surface: { kind: 'page', path: 'page.html' },
        surfaceUrl: `chrome-extension://${EXTENSION_ID}/page.html`,
        seed: { bookmarks: [], storage: {} },
      }),
      onPhase: (name) => names.push(name),
    },
    chrome.dependencies,
  )
  // Assert
  assert.deepEqual(names, ['launching', 'installing', 'opening'])
  await browser.close()
})

// Value: protects=the launch surviving a faulty journal; fails_when=a throwing onPhase callback fails or aborts the launch; no_claim=what the callback does
test('a throwing onPhase callback does not break the launch', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  // Act
  const browser = await launchOwnedExtensionBrowser(
    {
      ...launchOptions(root),
      onPhase: () => {
        throw new Error('journal unavailable')
      },
    },
    chrome.dependencies,
  )
  // Assert
  assert.equal(browser.surfaceTargetId, 'popup-1')
  await browser.close()
})

// Value: protects=a popup-only extension (no background.service_worker): the launch opens its popup; fails_when=ServiceWorker.startWorker is sent for an extension without a worker, so the command fails and the launch with it; no_claim=real Chrome's answer to startWorker for a popup-only extension
test('a popup-only extension without a service worker opens its popup and is sent no startWorker', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  const options = launchOptions(root)
  delete options.run.workerPath
  // Act
  const browser = await launchOwnedExtensionBrowser(
    options,
    chrome.dependencies,
  )
  // Assert
  const methods = chrome.commands.map(({ method }) => method)
  assert.equal(browser.surfaceTargetId, 'popup-1')
  assert.equal(methods.includes('ServiceWorker.startWorker'), false)
  assert.equal(methods.includes('Extensions.triggerAction'), true)
  await browser.close()
})

// Value: protects=the unmasked-detail finding: a Windows-style root, a real-path spelling of a linked root and a home path never reach Chrome's refusal message or cause, and a bearer token in Chrome's text is masked; fails_when=only the exact run.root string is replaced, or the detail is placed in the message; no_claim=real Chrome's wording
test('a load refusal never shows a Windows-style root, a real-path spelling or a home path, and masks a bearer token', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const realFolder = join(root, 'real-extension')
  await mkdir(realFolder)
  const linkedFolder = join(root, 'linked-extension')
  await symlink(realFolder, linkedFolder)
  const home = homedir()
  const detailOf = async (runRoot: string, text: string) => {
    const chrome = fakeOwnedChrome(healthy({ loadRejection: text }))
    return failureOf(launchOptions(root, { root: runRoot }), chrome)
  }
  // Act
  const windows = await detailOf(
    'C:\\Users\\ada\\project\\ext',
    'Cannot load C:\\Users\\ada\\project\\ext\\manifest.json with Bearer abcdefgh12345678',
  )
  const realPath = await detailOf(
    linkedFolder,
    `Cannot read ${realFolder}/manifest.json`,
  )
  const homePath = await detailOf(
    EXTENSION_ROOT,
    `Cannot read ${home}/secret/notes.txt`,
  )
  // Assert
  assert.equal(windows.message, 'Chrome did not load the extension.')
  assert.equal(windows.causeDetail.includes('ada'), false)
  assert.equal(windows.causeDetail.includes('abcdefgh12345678'), false)
  assert.match(windows.causeDetail, /Bearer \[masked\]/)
  assert.equal(realPath.causeDetail.includes(realFolder), false)
  assert.equal(realPath.message.includes(root), false)
  assert.equal(homePath.causeDetail, 'Cannot read ~/secret/notes.txt')
})

// Value: protects=the bound on Chrome's text in a cause; fails_when=a very long Chrome message is kept whole; no_claim=where the text is cut
test('a very long Chrome refusal is cut to 4096 characters in the cause', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy({ loadRejection: 'x'.repeat(10_000) }))
  // Act
  const error = await failureOf(launchOptions(root), chrome)
  // Assert
  assert.equal(error.causeDetail.length, 4096)
})

// Value: protects=the browser-lost contract (red team): the run is told once when the CDP socket closes or the process exits after the launch; fails_when=a loss is not announced, is announced twice or is announced after close() began; no_claim=real sockets (flatCdpConnection tests) or real exits
test('onLost fires once when the connection drops, once when the process exits, and never after close began', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const dropped = fakeOwnedChrome(healthy())
  const crashed = fakeOwnedChrome(healthy())
  const closed = fakeOwnedChrome(healthy())
  const droppedBrowser = await launchOwnedExtensionBrowser(
    launchOptions(root),
    dropped.dependencies,
  )
  const crashedBrowser = await launchOwnedExtensionBrowser(
    launchOptions(root),
    crashed.dependencies,
  )
  const closedBrowser = await launchOwnedExtensionBrowser(
    launchOptions(root),
    closed.dependencies,
  )
  const told = { dropped: 0, crashed: 0, closed: 0 }
  droppedBrowser.onLost(() => (told.dropped += 1))
  crashedBrowser.onLost(() => (told.crashed += 1))
  closedBrowser.onLost(() => (told.closed += 1))
  // Act
  dropped.dropConnection()
  dropped.crashProcess()
  crashed.crashProcess()
  await closedBrowser.close()
  closed.crashProcess()
  // Assert
  assert.deepEqual(told, { dropped: 1, crashed: 1, closed: 0 })
  await droppedBrowser.close()
  await crashedBrowser.close()
})

// Value: protects=the surface-session contract (red team): the executor gets a flat session on the surface target with Page and Runtime enabled; fails_when=nothing attaches to the surface or a domain is left disabled; no_claim=real Chrome (real-Chrome test)
test('attachSurface attaches a flat session to the surface and enables Page and Runtime on it', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  const browser = await launchOwnedExtensionBrowser(
    launchOptions(root),
    chrome.dependencies,
  )
  chrome.commands.length = 0
  // Act
  const sessionId = await browser.attachSurface()
  // Assert
  assert.equal(sessionId, 'session-popup-1')
  assert.deepEqual(
    chrome.commands.map(({ method, params, sessionId: session }) => ({
      method,
      params,
      session,
    })),
    [
      {
        method: 'Target.attachToTarget',
        params: { targetId: 'popup-1', flatten: true },
        session: undefined,
      },
      { method: 'Page.enable', params: {}, session: 'session-popup-1' },
      { method: 'Runtime.enable', params: {}, session: 'session-popup-1' },
    ],
  )
  await browser.close()
})

// Value: protects=the CHROME_COMMAND_UNAVAILABLE sentence names the minimum Chrome version from its constant; fails_when=the sentence carries a literal that drifts from the constant; no_claim=the recovery text (errors tests)
test('CHROME_COMMAND_UNAVAILABLE names the minimum Chrome version', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(
    healthy({ missingMethod: 'ServiceWorker.stopAllWorkers' }),
  )
  // Act
  const error = await failureOf(launchOptions(root), chrome)
  // Assert
  assert.match(error.message, /Chrome for Testing 149 or later\.$/)
})

// Value: protects=the pid proof of the orphan sweep (one transient write failure must not fail a launch); fails_when=the first failed pid write fails the launch or is never retried; no_claim=real file errors
test('launch proceeds when the first write of the browser pid fails and the retry succeeds', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  const writtenPids: (number | undefined)[] = []
  let attempts = 0
  const dependencies = {
    ...chrome.dependencies,
    writeBrowserMarker: async (
      _folder: string,
      marker: { executable: string; pid?: number },
    ): Promise<void> => {
      attempts += 1
      if (attempts === 1) throw new Error('EIO: transient')
      writtenPids.push(marker.pid)
    },
  }
  // Act
  const browser = await launchOwnedExtensionBrowser(
    launchOptions(root),
    dependencies,
  )
  // Assert
  assert.equal(attempts, 2)
  assert.deepEqual(writtenPids, [987_654])
  assert.deepEqual(await browser.close(), {
    profileLeft: false,
    exitConfirmed: true,
  })
})

// Value: protects=the pid proof of the orphan sweep (a browser whose pid is not recorded must not run on); fails_when=two failed pid writes are swallowed, or the browser or profile is left behind, or the profile path shows in the cause; no_claim=real file errors
test('launch fails with RUNTIME_FAILED, closes the browser and removes the profile when the browser pid cannot be recorded twice', async (context) => {
  // Arrange
  const root = await profileRoot(context)
  const chrome = fakeOwnedChrome(healthy())
  let attempts = 0
  const dependencies = {
    ...chrome.dependencies,
    writeBrowserMarker: async (folder: string): Promise<void> => {
      attempts += 1
      throw new Error(`EACCES: permission denied, open '${folder}/marker'`)
    },
  }
  // Act
  const error = await launchOwnedExtensionBrowser(
    launchOptions(root),
    dependencies,
  ).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'RUNTIME_FAILED')
  assert.equal(error.message, "The run's test profile could not be prepared.")
  assert.equal(error.causeDetail.includes(root), false)
  assert.equal(attempts, 2)
  assert.equal(chrome.signals.includes('SIGTERM'), true)
  assert.deepEqual(await readdir(root), [])
})

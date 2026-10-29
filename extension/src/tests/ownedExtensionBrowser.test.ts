import assert from 'node:assert/strict'
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
  assert.equal(
    error.message,
    'Chrome did not load the extension: Manifest file is missing: …/project/extension/manifest.json.',
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
  assert.match(error.message, /^The run's test profile could not be prepared: /)
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

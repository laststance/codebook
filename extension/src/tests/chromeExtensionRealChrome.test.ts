// Real-Chrome integration test of the CDP part of a chrome-extension run (SR8, ER11, CR6).
// Runbook: pnpm --dir extension build && node --test extension/dist/tests/chromeExtensionRealChrome.test.js
// Needs Google Chrome 149 or later (macOS: /Applications, Linux: google-chrome on PATH, or codebook.chromeExecutable's value in CODEBOOK_CHROME_EXECUTABLE).
// In CI (CI=true) a missing or older Chrome fails every test; locally it skips them with the same reason.
// no_claim=js-debug attach and native pause (task 0, N61)
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

import type {
  OwnedExtensionBrowser,
  ResolvedExtensionRun,
} from '../chromeExtensionContracts'
import {
  CHROME_EXTENSION_MIN_VERSION,
  EXTENSION_STOP_WORKERS_BOUND_MS,
} from '../constants'
import { StudyError } from '../errors'
import { launchOwnedExtensionBrowser } from '../runtimeSupport/ownedExtensionBrowser'
import { assertSupportedChromeVersion } from '../runtimeSupport/utils/assertSupportedChromeVersion'
import {
  readCdpString,
  readCdpTargets,
} from '../runtimeSupport/utils/cdpFieldReaders'
import { listProcesses } from '../runtimeSupport/utils/listProcesses'
import { readChromeExecutableVersion } from '../runtimeSupport/utils/readChromeExecutableVersion'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { resolveChromeExecutable } from '../utils/resolveChromeExecutable'

const TEST_TIMEOUT_MS = 60_000
/** How long a started worker may take to be listed; the coverage run of the whole suite once needed more than a second. */
const WORKER_LISTED_WAIT_MS = 15_000
const FIXTURE = join(__dirname, '../../src/tests/fixtures/chrome-extension')
const BROKEN_FIXTURE = join(FIXTURE, 'broken-worker')

type FoundChrome = { executable: string; version: string }

/** Finds Chrome and its major version once per file. */
let chromeSearch: Promise<FoundChrome | string> | undefined

/** Says whether a path is an executable file. */
function isExecutable(path: string): Promise<boolean> {
  return stat(path).then(
    (entry) => entry.isFile(),
    () => false,
  )
}

/** Looks for Chrome ≥ the minimum; answers the reason text when there is none. */
async function searchChrome(): Promise<FoundChrome | string> {
  const executable = await resolveChromeExecutable(
    process.env.CODEBOOK_CHROME_EXECUTABLE ?? '',
    process.platform,
    process.env.PATH,
    isExecutable,
  )
  let found = 'none'
  if (executable !== undefined && (await isExecutable(executable))) {
    const printed = await promisify(execFile)(executable, ['--version']).then(
      ({ stdout }) => stdout.trim(),
      () => '',
    )
    found = /(\d+)\.\d+\.\d+\.\d+/.exec(printed)?.[0] ?? 'none'
    if (Number(found.split('.')[0]) >= CHROME_EXTENSION_MIN_VERSION)
      return { executable, version: found }
  }
  return `Google Chrome ${CHROME_EXTENSION_MIN_VERSION} or later is needed on the CI runner; found ${found}.`
}

/** Gives Chrome for a test, fails in CI without one, and skips locally. */
async function requireChrome(
  context: TestContext,
): Promise<FoundChrome | undefined> {
  chromeSearch ??= searchChrome()
  const found = await chromeSearch
  if (typeof found !== 'string') return found
  if (process.env.CI === 'true') throw new Error(found)
  context.skip(found)
  return undefined
}

/** The id Chrome derives from an unpacked extension's absolute path: SHA-256, first 32 hex digits mapped 0-f to a-p. */
function idOfPath(path: string): string {
  const digest = createHash('sha256').update(path).digest('hex').slice(0, 32)
  return [...digest]
    .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
    .join('')
}

/** Builds the resolved run of a fixture folder. */
async function runOf(
  folder: string,
  overrides: Partial<ResolvedExtensionRun> = {},
): Promise<ResolvedExtensionRun> {
  const root = await realpath(folder)
  const extensionId = idOfPath(root)
  return {
    root,
    extensionId,
    manifestName: 'fixture',
    permissions: [],
    hostPermissions: [],
    surface: { kind: 'popup', path: 'popup.html' },
    surfaceUrl: `chrome-extension://${extensionId}/popup.html`,
    stops: [],
    clicks: [],
    seed: { bookmarks: [], storage: {} },
    observe: { kind: 'popup' },
    pinnedHashes: {},
    ...overrides,
  }
}

/** Launches Chrome on a fixture in a profile root of the test's own, and closes it when the test ends. */
async function launch(
  context: TestContext,
  chrome: FoundChrome,
  run: ResolvedExtensionRun,
): Promise<{ browser: OwnedExtensionBrowser; root: string }> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-real-chrome-')),
  )
  const browser = await launchOwnedExtensionBrowser({
    chromeExecutable: chrome.executable,
    profileRoot: root,
    owner: { hostname: 'real-chrome-test' },
    run,
  })
  context.after(async () => {
    await browser.close()
    await rm(root, { recursive: true, force: true })
  })
  return { browser, root }
}

/** Evaluates an expression on an extension page of the browser and returns its JSON value. */
async function evaluateOnPage(
  browser: OwnedExtensionBrowser,
  url: string,
  expression: string,
): Promise<unknown> {
  const created = await browser.cdp.request('Target.createTarget', { url })
  const targetId = readCdpString(created, 'targetId')
  const attached = await browser.cdp.request('Target.attachToTarget', {
    targetId,
    flatten: true,
  })
  const sessionId = readCdpString(attached, 'sessionId')
  // A page that is still loading has no extension API yet: retry a failed evaluation briefly.
  let evaluated: Record<string, unknown> = {}
  for (let attempt = 0; attempt < 20; attempt++) {
    evaluated = await browser.cdp.request(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    )
    if (evaluated.exceptionDetails === undefined) break
    await delay(200)
  }
  await browser.cdp.request('Target.closeTarget', { targetId })
  if (evaluated.exceptionDetails !== undefined)
    throw new Error(
      `evaluation failed: ${JSON.stringify(evaluated.exceptionDetails)}`,
    )
  const result = evaluated.result
  return typeof result === 'object' && result !== null
    ? Reflect.get(result, 'value')
    : undefined
}

/** Lists the targets of the extension by its id. */
async function targetsOf(browser: OwnedExtensionBrowser) {
  const all = readCdpTargets(await browser.cdp.request('Target.getTargets', {}))
  return all.filter((target) =>
    target.url.startsWith(`chrome-extension://${browser.extensionId}/`),
  )
}

/** Reads the extension's local storage on a storage host page. */
function readStorage(browser: OwnedExtensionBrowser): Promise<unknown> {
  return evaluateOnPage(
    browser,
    `chrome-extension://${browser.extensionId}/page.html`,
    'chrome.storage.local.get(null)',
  )
}

// Value: protects=SR28, ER19, TZ3, TZ4 against the real Chrome: install under the derived id, seed that beats the fixture's late onInstalled write, real popup through triggerAction, no worker left for the debugger; fails_when=the id rule, the stop-seed-read-back order, the popup opening or the stop before attach breaks in a Chrome release; no_claim=js-debug attach and native pause (task 0, N61)
test(
  'real Chrome: the fixture installs under its path’s id, the seed survives the extension’s late default, the popup opens and no worker runs',
  { timeout: TEST_TIMEOUT_MS },
  async (context) => {
    const chrome = await requireChrome(context)
    if (!chrome) return
    // Arrange
    const run = await runOf(FIXTURE, {
      seed: { bookmarks: [], storage: { viewMode: 'popup' } },
    })
    // Act
    const { browser } = await launch(context, chrome, run)
    // Wait past the fixture's 700 ms late write, which must never have landed.
    // gstack-timing-ok: asserts the fixture's 700 ms late write never lands, so waiting past it is the contract
    await delay(1_500)
    const targets = await targetsOf(browser)
    const storage = await readStorage(browser)
    // Assert
    assert.equal(browser.extensionId, run.extensionId)
    assert.equal(
      targets.some(({ targetId }) => targetId === browser.surfaceTargetId),
      true,
    )
    assert.equal(
      targets.find(({ targetId }) => targetId === browser.surfaceTargetId)?.url,
      `chrome-extension://${run.extensionId}/popup.html`,
    )
    assert.equal(
      targets.some(({ type }) => type === 'service_worker'),
      false,
    )
    assert.deepEqual(storage, { viewMode: 'popup' })
  },
)

// Value: protects=acceptance 4 against the real Chrome: the installed Chrome's own `--version` output is read and accepted by the pre-launch check; fails_when=the real output spelling is not recognised or the reader returns nothing; no_claim=refusal of an old Chrome (unit tests)
test(
  'real Chrome: the installed executable prints a version the pre-launch check accepts',
  { timeout: TEST_TIMEOUT_MS },
  async (context) => {
    const chrome = await requireChrome(context)
    if (!chrome) return
    // Arrange
    // Act
    const printed = await readChromeExecutableVersion(chrome.executable)
    // Assert
    assert.match(printed, /\d+\.\d+\.\d+\.\d+/)
    assert.doesNotThrow(() => assertSupportedChromeVersion(printed))
  },
)

// Value: protects=ER12 against the real Chrome: nested folders and a Unicode title written to Bookmarks before the start are what the extension API reads; fails_when=the fixed template stops being accepted by Chrome or loses nesting, order or characters; no_claim=sync, the bookmark bar, or the permanent folder's own title (Chrome names it per platform: "Other Bookmarks" on macOS, "Other bookmarks" on Linux)
test(
  'real Chrome: seeded nested bookmark folders and a Unicode title are what chrome.bookmarks reads',
  { timeout: TEST_TIMEOUT_MS },
  async (context) => {
    const chrome = await requireChrome(context)
    if (!chrome) return
    // Arrange
    const run = await runOf(FIXTURE, {
      surface: { kind: 'page', path: 'page.html' },
      seed: {
        bookmarks: [
          {
            title: 'Reading ノート',
            children: [
              {
                title: 'Docs',
                children: [
                  { title: 'Ünïcode ✓', url: 'https://docs.example/a' },
                ],
              },
            ],
          },
          { title: 'Home', url: 'https://home.example/' },
          { title: 'Empty folder' },
        ],
        storage: {},
      },
    })
    const { browser } = await launch(context, chrome, run)
    // Act
    const tree = await evaluateOnPage(
      browser,
      `chrome-extension://${run.extensionId}/page.html`,
      `chrome.bookmarks.getTree().then((roots) => {
      const outline = (node) => ({ title: node.title, url: node.url, children: node.children?.map(outline) })
      return outline(roots[0].children.find((child) => child.folderType === 'other')).children
    })`,
    )
    // Assert
    assert.deepEqual(tree, [
      {
        title: 'Reading ノート',
        children: [
          {
            title: 'Docs',
            children: [{ title: 'Ünïcode ✓', url: 'https://docs.example/a' }],
          },
        ],
      },
      { title: 'Home', url: 'https://home.example/' },
      { title: 'Empty folder', children: [] },
    ])
  },
)

// Value: protects=TZ3 and the page surface: a page surface opens by createTarget, startWorker brings the worker back as a target of this extension only, and stopWorkers waits until it is gone; fails_when=the surface URL, the target filter by id or the stop-and-wait breaks; no_claim=the worker attaching to a debugger
test(
  'real Chrome: a page surface opens, startWorker starts only this extension’s worker and stopWorkers removes it again',
  { timeout: TEST_TIMEOUT_MS },
  async (context) => {
    const chrome = await requireChrome(context)
    if (!chrome) return
    // Arrange
    const run = await runOf(FIXTURE, {
      surface: { kind: 'page', path: 'page.html' },
      surfaceUrl: `chrome-extension://${idOfPath(await realpath(FIXTURE))}/page.html`,
    })
    const { browser } = await launch(context, chrome, run)
    const before = (await targetsOf(browser)).filter(
      ({ type }) => type === 'service_worker',
    )
    // Act
    await browser.startWorker()
    // On a loaded machine (the coverage run of the whole suite) the worker target took longer than a second to appear: poll the target list for it.
    const started = await waitUntil(
      async () => {
        const workers = (await targetsOf(browser)).filter(
          ({ type }) => type === 'service_worker',
        )
        return workers.length > 0 ? workers : undefined
      },
      'the extension’s service worker is listed after startWorker',
      WORKER_LISTED_WAIT_MS,
    )
    await browser.stopWorkers(EXTENSION_STOP_WORKERS_BOUND_MS)
    const after = (await targetsOf(browser)).filter(
      ({ type }) => type === 'service_worker',
    )
    // Assert
    assert.equal(before.length, 0)
    assert.deepEqual(
      started.map(({ url }) => url),
      [`chrome-extension://${run.extensionId}/worker.js`],
    )
    assert.equal(after.length, 0)
  },
)

// Value: protects=the EXTENSION_ID_MISMATCH contract against the real Chrome; fails_when=an id other than Chrome's is accepted; no_claim=a manifest key
test(
  'real Chrome: an expected id that differs from the one Chrome derives fails with EXTENSION_ID_MISMATCH and leaves no folder',
  { timeout: TEST_TIMEOUT_MS },
  async (context) => {
    const chrome = await requireChrome(context)
    if (!chrome) return
    // Arrange
    const root = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-real-chrome-')),
    )
    context.after(() => rm(root, { recursive: true, force: true }))
    const run = await runOf(FIXTURE, { extensionId: 'a'.repeat(32) })
    // Act
    const failure = await launchOwnedExtensionBrowser({
      chromeExecutable: chrome.executable,
      profileRoot: root,
      owner: { hostname: 'real-chrome-test' },
      run,
    }).then(
      () => undefined,
      (error: unknown) => error,
    )
    // Assert
    assert.ok(failure instanceof StudyError)
    assert.equal(failure.code, 'EXTENSION_ID_MISMATCH')
    assert.match(
      failure.causeDetail,
      /^expected a{32}, returned [a-p]{32}, root …\/fixtures\/chrome-extension, Chrome Chrome\/\d+/,
    )
    assert.deepEqual(await readdir(root), [])
  },
)

// Value: protects=ER4 against the real Chrome: the shape of a worker that cannot start (installed, but no worker target ever appears); fails_when=Chrome starts reporting such an extension as not loaded, or the worker target appears; no_claim=the error text of the failed registration
test(
  'real Chrome: an extension whose worker has a syntax error installs and starts no worker target',
  { timeout: TEST_TIMEOUT_MS },
  async (context) => {
    const chrome = await requireChrome(context)
    if (!chrome) return
    // Arrange
    const root = await realpath(BROKEN_FIXTURE)
    const extensionId = idOfPath(root)
    const run = await runOf(BROKEN_FIXTURE, {
      surface: { kind: 'page', path: 'manifest.json' },
      surfaceUrl: `chrome-extension://${extensionId}/manifest.json`,
    })
    // Act
    const { browser } = await launch(context, chrome, run)
    await browser.startWorker().catch(() => undefined)
    await delay(1_000)
    const workers = (await targetsOf(browser)).filter(
      ({ type }) => type === 'service_worker',
    )
    // Assert
    assert.equal(browser.extensionId, extensionId)
    assert.deepEqual(workers, [])
  },
)

// Value: protects=SR35, ER18, CR6 against the real Chrome: close leaves no browser process and no profile folder; fails_when=a Chrome process that names the run's profile survives close, or the folder stays; no_claim=a crashed editor (fake-process sweep tests)
test(
  'real Chrome: close ends every process that names the profile and removes the folder',
  { timeout: TEST_TIMEOUT_MS },
  async (context) => {
    const chrome = await requireChrome(context)
    if (!chrome) return
    // Arrange
    const run = await runOf(FIXTURE)
    const { browser, root } = await launch(context, chrome, run)
    const namesProfile = async () =>
      (await listProcesses()).filter(({ command }) =>
        command.includes(`--user-data-dir=${browser.profile}`),
      )
    const runningBefore = (await namesProfile()).length
    // Act
    const closing = await browser.close()
    // Assert
    assert.equal(runningBefore > 0, true)
    assert.deepEqual(closing, { profileLeft: false, exitConfirmed: true })
    assert.deepEqual(await namesProfile(), [])
    assert.deepEqual(await readdir(root), [])
  },
)

import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import type { FlatCdpConnection } from '../../chromeExtensionContracts'
import { connectFlatCdp } from '../../runtimeSupport/flatCdpConnection'
import { waitUntil } from '../../runtimeSupport/utils/waitUntil'
import { resolveChromeExecutable } from '../../utils/resolveChromeExecutable'

import { removeTestBrowserProfile } from './removeTestBrowserProfile'
import { waitForTestBrowserEndpoint } from './waitForTestBrowserEndpoint'

/** Says whether a path is an executable file. */
function isExecutable(path: string): Promise<boolean> {
  return stat(path).then(
    (entry) => entry.isFile(),
    () => false,
  )
}

/** A real headless page a test drives over the Chrome DevTools protocol. */
export type RealHeadlessPage = {
  /** Evaluates an expression in the page and returns its JSON value. */
  evaluate(expression: string): Promise<unknown>
  /** Replaces the page with this HTML (a data URL document). */
  load(html: string): Promise<void>
  /** Takes a real PNG screenshot of the page and returns its base64 data. */
  screenshot(): Promise<string>
}

/** The test file's one headless Chrome: its process, its profile folder and its browser-level CDP connection. */
type SharedHeadlessChrome = {
  child: ChildProcess
  profile: string
  cdp: FlatCdpConnection
  /** Set when the browser connection ended, so the next page starts a new Chrome. */
  connectionClosed: boolean
}

/** How long the browser-level CDP connection may take to open once Chrome published its endpoint. */
const CDP_CONNECT_BOUND_MS = 10_000

/** How long a killed Chrome may take to report its exit before its stop fails. */
const CHROME_EXIT_BOUND_MS = 5_000

/** The start of the file's Chrome, shared by every page asked for while it runs; `undefined` before the first page and after {@link closeRealHeadlessChrome}. */
let starting: Promise<SharedHeadlessChrome> | undefined

/** Set by {@link closeRealHeadlessChrome}: a page asked for after the file's Chrome was closed (late work of a test that timed out) is refused instead of starting a Chrome nothing would close. */
let closed = false

/**
 * Ends a Chrome this helper started and removes its profile folder; a Chrome that already exited, or never started (no pid), is not waited for, and a killed Chrome that does not report its exit within {@link CHROME_EXIT_BOUND_MS} fails the stop after its profile folder was removed.
 * @param child - The Chrome process.
 * @param profile - Its `--user-data-dir` folder.
 * @throws When the killed Chrome does not exit in time.
 * @example await stopHeadlessChrome(chrome.child, chrome.profile)
 */
async function stopHeadlessChrome(
  child: ChildProcess,
  profile: string,
): Promise<void> {
  try {
    // Only a Chrome that started and still runs is killed and waited for.
    if (
      child.pid !== undefined &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      child.kill('SIGKILL')
      await waitUntil(
        () => child.exitCode !== null || child.signalCode !== null,
        'the killed headless Chrome to exit',
        CHROME_EXIT_BOUND_MS,
      )
    }
  } finally {
    await removeTestBrowserProfile(profile)
  }
}

/**
 * Starts the installed Chrome headless on a fresh profile and connects to its browser endpoint; a start that fails ends the Chrome and removes its profile before it rejects.
 * @param executable - The Chrome found by {@link launchRealHeadlessPage}.
 * @returns The running Chrome with its open browser connection.
 * @throws When Chrome exits early or does not publish its debugging endpoint within {@link waitForTestBrowserEndpoint}'s bound, or the connection does not open.
 * @example const chrome = await startHeadlessChrome('/usr/bin/google-chrome')
 */
async function startHeadlessChrome(
  executable: string,
): Promise<SharedHeadlessChrome> {
  const profile = await mkdtemp(join(tmpdir(), 'codebook-gate-chrome-'))
  const child = spawn(
    executable,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  // A Chrome that cannot be started (an executable that does not run) reports an error event instead of an exit.
  let spawnFailed = false
  child.once('error', () => {
    spawnFailed = true
  })
  try {
    // A cold runner's first Chrome start gets Codebook's own start bound; a Chrome that ended or never started fails at once.
    const endpoint = await waitForTestBrowserEndpoint(profile, {
      hasExited: () =>
        spawnFailed || child.exitCode !== null || child.signalCode !== null,
    })
    const cdp = await connectFlatCdp(
      `ws://127.0.0.1:${endpoint.port}${endpoint.path}`,
      CDP_CONNECT_BOUND_MS,
    )
    const chrome: SharedHeadlessChrome = {
      child,
      profile,
      cdp,
      connectionClosed: false,
    }
    cdp.onClose(() => {
      chrome.connectionClosed = true
    })
    return chrome
  } catch (error) {
    await stopHeadlessChrome(child, profile)
    throw error
  }
}

/**
 * Gives the test file's running Chrome, starting it on the first call; pages asked for while the start runs share it, a start that failed is tried again by the next call, and a Chrome that exited or lost its connection is replaced.
 * @param executable - The Chrome to start when none runs.
 * @returns The running Chrome.
 * @throws What {@link startHeadlessChrome} throws; when {@link closeRealHeadlessChrome} already ran.
 * @example const chrome = await sharedHeadlessChrome(executable)
 */
async function sharedHeadlessChrome(
  executable: string,
): Promise<SharedHeadlessChrome> {
  if (closed)
    throw new Error(
      "The test file's headless Chrome was closed; no page opens after closeRealHeadlessChrome.",
    )
  const pending = (starting ??= startHeadlessChrome(executable))
  let chrome: SharedHeadlessChrome
  try {
    chrome = await pending
  } catch (error) {
    // A failed start already cleaned up after itself; the next page starts again.
    if (starting === pending) starting = undefined
    throw error
  }
  const running =
    chrome.child.exitCode === null &&
    chrome.child.signalCode === null &&
    !chrome.connectionClosed
  if (running) return chrome
  // The Chrome ended between two tests: release what is left of it and start a new one.
  if (starting === pending) starting = undefined
  chrome.cdp.close()
  await stopHeadlessChrome(chrome.child, chrome.profile)
  return sharedHeadlessChrome(executable)
}

/**
 * Ends the test file's headless Chrome, a start still running included, and removes its profile folder; a test file that asks for real headless pages registers it with `after(closeRealHeadlessChrome)`, so no browser outlives the file and the file's process can end.
 * @example after(closeRealHeadlessChrome)
 */
export async function closeRealHeadlessChrome(): Promise<void> {
  closed = true
  const pending = starting
  starting = undefined
  if (!pending) return
  // A start that failed has already ended its Chrome and removed its profile.
  const chrome = await pending.catch(() => undefined)
  if (!chrome) return
  chrome.cdp.close()
  await stopHeadlessChrome(chrome.child, chrome.profile)
}

/**
 * Opens a blank page in a fresh browser context of the test file's one headless Chrome (started on the first call), and disposes of that context when the test ends.
 * Why one Chrome per file: every start under a loaded CI runner is a chance to miss {@link waitForTestBrowserEndpoint}'s bound, and the secret frame gate files started one per test (about 31 per run; Cycle 0112). Each page gets its own browser context, so tests share no cookies, storage or frames, as separate profiles did.
 * Finds Chrome with the resolver {@link openRealChromePage} uses (`CODEBOOK_CHROME_EXECUTABLE`, then the platform's usual places); in CI (`CI=true`) a missing Chrome fails the test, locally the test is skipped with the reason.
 * Called by the secret frame gate tests, which need the page's real MutationObserver and clock; their file registers `after(closeRealHeadlessChrome)`.
 * @param context - The test context; its `after` hook disposes of the page's browser context.
 * @returns The page driver, or `undefined` when the test was skipped.
 * @throws When no Chrome is found in CI, or the browser does not publish its debugging endpoint in time.
 * @example
 * after(closeRealHeadlessChrome)
 * const page = await launchRealHeadlessPage(context)
 * if (!page) return
 * await page.load('<input type=password id=pw>')
 */
export async function launchRealHeadlessPage(
  context: TestContext,
): Promise<RealHeadlessPage | undefined> {
  const chromeExecutable = await resolveChromeExecutable(
    process.env.CODEBOOK_CHROME_EXECUTABLE ?? '',
    process.platform,
    process.env.PATH,
    isExecutable,
  )
  if (
    chromeExecutable === undefined ||
    !(await isExecutable(chromeExecutable))
  ) {
    const reason =
      'no Chrome is installed here; set CODEBOOK_CHROME_EXECUTABLE to run the real-page gate tests'
    if (process.env.CI === 'true') throw new Error(reason)
    context.skip(reason)
    return undefined
  }
  const { cdp } = await sharedHeadlessChrome(chromeExecutable)
  const { browserContextId } = await cdp.request(
    'Target.createBrowserContext',
    {},
  )
  context.after(async () => {
    // The file's Chrome may already be gone (closed or exited); its contexts went with it.
    await cdp
      .request('Target.disposeBrowserContext', { browserContextId })
      .catch(() => undefined)
  })
  const created = await cdp.request('Target.createTarget', {
    url: 'about:blank',
    browserContextId,
  })
  const attached = await cdp.request('Target.attachToTarget', {
    targetId: created.targetId,
    flatten: true,
  })
  const sessionId = String(attached.sessionId)
  await cdp.request('Page.enable', {}, sessionId)
  return {
    async evaluate(expression) {
      const answer = (await cdp.request(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        sessionId,
      )) as { result?: { value?: unknown } }
      return answer.result?.value
    },
    async load(html): Promise<void> {
      await cdp.request(
        'Page.navigate',
        { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` },
        sessionId,
      )
      // The page is ready when its own document answers: the about:blank before it can still read complete until the navigation commits.
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = await cdp
          .request(
            'Runtime.evaluate',
            {
              expression:
                "location.protocol === 'data:' ? document.readyState : 'previous-document'",
              returnByValue: true,
            },
            sessionId,
          )
          .then(
            (answer) =>
              (answer as { result?: { value?: unknown } }).result?.value,
          )
          .catch(() => undefined)
        if (state === 'complete') return
        await delay(20)
      }
      throw new Error('The page did not load.')
    },
    async screenshot() {
      const shot = await cdp.request(
        'Page.captureScreenshot',
        { format: 'png' },
        sessionId,
      )
      return String(shot.data)
    },
  }
}

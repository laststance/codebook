import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

import { CHROME_EXTENSION_MIN_VERSION } from '../../constants'
import { Cdp } from '../../runtimeSupport/cdp'
import { resolveChromeExecutable } from '../../utils/resolveChromeExecutable'

/** A fixture page open in a real headless Chrome, with the channel a run's operations are sent through. */
export type RealChromePage = {
  cdp: Cdp
  /** The loopback origin the fixture page is served from. */
  origin: string
}

/** How long closing a fixture page's target may take before the test moves on. */
const CLOSE_BOUND_MS = 2_000

type FoundChrome = { executable: string }

/** Finds Chrome once per test file. */
let chromeSearch: Promise<FoundChrome | string> | undefined
/** The one Chrome a test file launches, with the profile folder it owns. */
let launched:
  | Promise<{ process: ChildProcess; debuggingPort: number; profile: string }>
  | undefined

/** Says whether a path is an executable file. */
function isExecutable(path: string): Promise<boolean> {
  return stat(path).then(
    (entry) => entry.isFile(),
    () => false,
  )
}

/** Looks for a Chrome new enough for the owned runs; answers the reason text when there is none. */
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
      return { executable }
  }
  return `Google Chrome ${CHROME_EXTENSION_MIN_VERSION} or later is needed; found ${found}.`
}

/**
 * Opens an HTML fixture in a real headless Chrome and connects the run's CDP wrapper to its page, for the tests of the operation engine that must see a real DOM, real events and the real native value setter.
 * In CI (`CI=true`) a missing Chrome fails the test; locally the test is skipped with the reason.
 * One Chrome serves a whole test file; each call opens its own page and local server, and closes both when the test ends.
 * @param context - The test, which owns the page's cleanup.
 * @param html - The page's document.
 * @returns The page's channel and origin, or `undefined` when the test was skipped.
 * @example const page = await openRealChromePage(context, '<input id="a">'); if (!page) return
 */
export async function openRealChromePage(
  context: TestContext,
  html: string,
): Promise<RealChromePage | undefined> {
  chromeSearch ??= searchChrome()
  const found = await chromeSearch
  if (typeof found === 'string') {
    if (process.env.CI === 'true') throw new Error(found)
    context.skip(found)
    return undefined
  }
  launched ??= launchChrome(found.executable)
  const { debuggingPort } = await launched
  const server: Server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(html)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const created = await fetch(
    `http://127.0.0.1:${debuggingPort}/json/new?${origin}/`,
    { method: 'PUT' },
  )
  const target = (await created.json()) as {
    id: string
    webSocketDebuggerUrl: string
  }
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl, () => undefined)
  context.after(async () => {
    cdp.close()
    await fetch(`http://127.0.0.1:${debuggingPort}/json/close/${target.id}`, {
      signal: AbortSignal.timeout(CLOSE_BOUND_MS),
    })
      .then((answer) => answer.text())
      .catch(() => undefined)
    // Chrome keeps its connections to the fixture server open, which would hold the close.
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  // The fixture is ready once its own document finished loading: a new tab's first document is about:blank, which can read complete before the fixture's navigation commits (seen under load).
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await cdp.request('Runtime.evaluate', {
      expression: `location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`,
      returnByValue: true,
    })
    if (state.result.value === true) return { cdp, origin }
    await delay(50)
  }
  throw new Error('The fixture page did not finish loading.')
}

/**
 * Ends the file's Chrome and removes its profile folder; a test file registers it with `after(closeRealChrome)` so no browser outlives the file.
 * @example after(closeRealChrome)
 */
export async function closeRealChrome(): Promise<void> {
  const pending = launched
  launched = undefined
  const chrome = await pending?.catch(() => undefined)
  if (!chrome) return
  // A Chrome that already exited emits no further `exit`, so only a running one is awaited.
  if (chrome.process.exitCode === null && chrome.process.signalCode === null) {
    const exited = new Promise<void>((resolve) =>
      chrome.process.once('exit', () => resolve()),
    )
    chrome.process.kill('SIGKILL')
    await exited
  }
  await rm(chrome.profile, { recursive: true, force: true })
}

/** Starts the file's one headless Chrome on a fresh profile folder and waits for its debugging port. */
async function launchChrome(
  executable: string,
): Promise<{ process: ChildProcess; debuggingPort: number; profile: string }> {
  const profile = await mkdtemp(join(tmpdir(), 'codebook-engine-chrome-'))
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
  for (let attempt = 0; attempt < 200; attempt++) {
    const text = await readFile(
      join(profile, 'DevToolsActivePort'),
      'utf8',
    ).catch(() => undefined)
    const port = Number(text?.split('\n')[0])
    if (port > 0) return { process: child, debuggingPort: port, profile }
    await delay(100)
  }
  child.kill('SIGKILL')
  throw new Error('Chrome did not publish its debugging port.')
}

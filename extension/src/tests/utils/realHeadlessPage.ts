import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { connectFlatCdp } from '../../runtimeSupport/flatCdpConnection'
import { readDevToolsActivePort } from '../../runtimeSupport/utils/readDevToolsActivePort'

/** Where a Chrome that can run a headless page is usually installed; `CODEBOOK_TEST_CHROME` overrides. */
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

/**
 * Finds a Chrome that can run a headless page for a test.
 * @returns The executable path, or `undefined` when none is installed (a test then states it did not run).
 * @example
 * const chrome = findTestChrome() // => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
 */
export function findTestChrome(): string | undefined {
  const fromEnvironment = process.env.CODEBOOK_TEST_CHROME
  if (fromEnvironment && existsSync(fromEnvironment)) return fromEnvironment
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
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

/**
 * Launches the installed Chrome headless on a fresh profile, opens one blank page and removes everything when the test ends.
 * Called by the secret frame gate tests, which need the page's real MutationObserver and clock.
 * @param context - The test context; its `after` hook ends the browser and removes the profile.
 * @param chromeExecutable - The Chrome to run ({@link findTestChrome}).
 * @returns The page driver.
 * @throws When the browser does not publish its debugging endpoint in time.
 * @example
 * const page = await launchRealHeadlessPage(context, chrome)
 * await page.load('<input type=password id=pw>')
 */
export async function launchRealHeadlessPage(
  context: TestContext,
  chromeExecutable: string,
): Promise<RealHeadlessPage> {
  const profile = await mkdtemp(join(tmpdir(), 'codebook-gate-chrome-'))
  const child = spawn(
    chromeExecutable,
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
  context.after(async () => {
    child.kill('SIGKILL')
    await new Promise((resolve) => child.once('exit', resolve))
    await rm(profile, { recursive: true, force: true })
  })
  let endpoint: ReturnType<typeof readDevToolsActivePort>
  for (let attempt = 0; attempt < 100 && !endpoint; attempt++) {
    await delay(100)
    endpoint = await readFile(join(profile, 'DevToolsActivePort'), 'utf8')
      .then(readDevToolsActivePort)
      .catch(() => undefined)
  }
  if (!endpoint) throw new Error('Chrome published no debugging endpoint.')
  const cdp = await connectFlatCdp(
    `ws://127.0.0.1:${endpoint.port}${endpoint.path}`,
    10_000,
  )
  context.after(() => cdp.close())
  const created = await cdp.request('Target.createTarget', {
    url: 'about:blank',
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
      // The page is ready when its document answers.
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = await cdp
          .request(
            'Runtime.evaluate',
            { expression: 'document.readyState', returnByValue: true },
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

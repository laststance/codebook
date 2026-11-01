import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { connectFlatCdp } from '../../runtimeSupport/flatCdpConnection'
import { readDevToolsActivePort } from '../../runtimeSupport/utils/readDevToolsActivePort'
import { resolveChromeExecutable } from '../../utils/resolveChromeExecutable'

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

/**
 * Launches the installed Chrome headless on a fresh profile, opens one blank page and removes everything when the test ends.
 * Finds Chrome with the resolver {@link openRealChromePage} uses (`CODEBOOK_CHROME_EXECUTABLE`, then the platform's usual places); in CI (`CI=true`) a missing Chrome fails the test, locally the test is skipped with the reason.
 * Called by the secret frame gate tests, which need the page's real MutationObserver and clock.
 * @param context - The test context; its `after` hook ends the browser and removes the profile.
 * @returns The page driver, or `undefined` when the test was skipped.
 * @throws When no Chrome is found in CI, or the browser does not publish its debugging endpoint in time.
 * @example
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
    // A Chrome that already exited emits no further `exit`, so only a running one is awaited.
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve))
      child.kill('SIGKILL')
      await exited
    }
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

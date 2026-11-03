import assert from 'node:assert/strict'
import { stat, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { launchSignInBrowser } from '../runtimeSupport/signInBrowser'
import { resolveChromeExecutable } from '../utils/resolveChromeExecutable'

import { removeTestBrowserProfile } from './utils/removeTestBrowserProfile'

/** Bound of the probe launch that warms Chrome and measures its cold start; longer than the product's own start bound so a slow runner is measured, not cut off. */
const REAL_CHROME_PROBE_BOUND_MS = 60_000

const isExecutable = (path: string): Promise<boolean> =>
  stat(path).then(
    (entry) => entry.isFile(),
    () => false,
  )

// protects=route A (after a warm-up launch that logs REAL_CHROME_PROBE_MS, the cold-start time of the runner) mechanics (the pipe transport against the real Chrome); fails_when=Browser.getVersion does not answer over fds 3/4, Browser.close does not end the process, or the exit is not observed; no_claim=a headed window, the keychain, a persistent cookie surviving Done (native check)
test('a real Chrome answers Browser.getVersion over the debugging pipe and exits gracefully on Browser.close', async (context) => {
  // Arrange
  const executable = await resolveChromeExecutable(
    process.env.CODEBOOK_CHROME_EXECUTABLE ?? '',
    process.platform,
    process.env.PATH,
    isExecutable,
  )
  if (executable === undefined || !(await isExecutable(executable))) {
    const reason =
      'no Chrome is installed here; set CODEBOOK_CHROME_EXECUTABLE to run the real-Chrome pipe case'
    if (process.env.CI === 'true') throw new Error(reason)
    context.skip(reason)
    return
  }
  const profile = await mkdtemp(join(tmpdir(), 'codebook-signin-chrome-'))
  context.after(() => removeTestBrowserProfile(profile))
  // Probe and warm-up: one headless launch on its own throwaway profile, so the timed case below does not pay Chrome's first start.
  const probeProfile = await mkdtemp(join(tmpdir(), 'codebook-signin-probe-'))
  context.after(() => removeTestBrowserProfile(probeProfile))
  const probeStartedAt = performance.now()
  const probeSignal = AbortSignal.timeout(REAL_CHROME_PROBE_BOUND_MS)
  let probeBrowser: Awaited<ReturnType<typeof launchSignInBrowser>>
  try {
    probeBrowser = await Promise.race([
      launchSignInBrowser({
        executable,
        profile: probeProfile,
        url: 'about:blank',
        signal: probeSignal,
        headless: true,
        recordBrowser: async () => {},
      }),
      new Promise<never>((_resolve, reject) => {
        probeSignal.addEventListener('abort', () =>
          reject(new Error('probe bound passed')),
        )
      }),
    ])
  } catch (cause) {
    // The line is logged on failure too, so a cold runner's time is read either way.
    console.log(
      `REAL_CHROME_PROBE_MS=${Math.round(performance.now() - probeStartedAt)}`,
    )
    throw new Error(
      `The real-Chrome warm-up launch failed or exceeded ${REAL_CHROME_PROBE_BOUND_MS} ms: ${String(cause)}`,
    )
  }
  // The first Browser.getVersion answer has been read by the time launch returns.
  console.log(
    `REAL_CHROME_PROBE_MS=${Math.round(performance.now() - probeStartedAt)}`,
  )
  const probeClose = await probeBrowser.close()
  assert.equal(
    probeClose,
    'graceful',
    'The real-Chrome warm-up launch did not close gracefully.',
  )
  const markers: object[] = []
  // Act
  const browser = await launchSignInBrowser({
    executable,
    profile,
    url: 'about:blank',
    signal: new AbortController().signal,
    headless: true,
    recordBrowser: async (marker) => {
      markers.push(marker)
    },
  })
  const cookies = await browser.readAppCookieKind('localhost')
  const result = await browser.close()
  // Assert
  assert.match(browser.chromeVersion, /^(Headless)?Chrome\/\d+\.\d+\.\d+\.\d+$/)
  assert.equal(cookies, 'none')
  assert.equal(result, 'graceful')
  assert.equal(markers.length, 1)
})

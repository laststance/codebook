import assert from 'node:assert/strict'
import { stat, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { launchSignInBrowser } from '../runtimeSupport/signInBrowser'
import { resolveChromeExecutable } from '../utils/resolveChromeExecutable'

import { removeTestBrowserProfile } from './utils/removeTestBrowserProfile'

const isExecutable = (path: string): Promise<boolean> =>
  stat(path).then(
    (entry) => entry.isFile(),
    () => false,
  )

// protects=route A mechanics (the pipe transport against the real Chrome); fails_when=Browser.getVersion does not answer over fds 3/4, Browser.close does not end the process, or the exit is not observed; no_claim=a headed window, the keychain, a persistent cookie surviving Done (native check)
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

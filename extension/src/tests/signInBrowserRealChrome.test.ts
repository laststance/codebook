import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { stat, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { launchSignInBrowser } from '../runtimeSupport/signInBrowser'
import { resolveChromeExecutable } from '../utils/resolveChromeExecutable'

import { removeTestBrowserProfile } from './utils/removeTestBrowserProfile'

/** Bound of the warm-up Chrome run that measures the runner's cold start; longer than the product's 20 s start bound so a slow runner is measured, not cut off. */
const REAL_CHROME_PROBE_BOUND_MS = 60_000

const isExecutable = (path: string): Promise<boolean> =>
  stat(path).then(
    (entry) => entry.isFile(),
    () => false,
  )

/**
 * Runs a headless Chrome once on a fresh profile until it exits, to warm it and time its cold start.
 *
 * Why it exists: the product launcher bounds the first `Browser.getVersion` at 20 s, so only a direct spawn can measure a slower cold start. Called by the real-Chrome case below.
 * @param executable - The Chrome binary.
 * @param profile - A throwaway user-data-dir.
 * @returns The outcome and the milliseconds from spawn to exit (or to the kill after {@link REAL_CHROME_PROBE_BOUND_MS}).
 * @example await runChromeProbe('/usr/bin/chrome', '/tmp/p') // => { result: 'exited-0', elapsedMs: 250 }
 */
function runChromeProbe(
  executable: string,
  profile: string,
): Promise<{ result: string; elapsedMs: number }> {
  return new Promise((resolve) => {
    const startedAt = performance.now()
    // Detached (off Windows) so the bound can end Chrome's whole process group.
    const child = spawn(
      executable,
      [
        '--headless=new',
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--dump-dom',
        'about:blank',
      ],
      { stdio: 'ignore', detached: process.platform !== 'win32' },
    )
    let didTimeOut = false
    const timer = setTimeout(() => {
      didTimeOut = true
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
        })
      } else if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
    }, REAL_CHROME_PROBE_BOUND_MS)
    const settle = (result: string): void => {
      clearTimeout(timer)
      resolve({ result, elapsedMs: Math.round(performance.now() - startedAt) })
    }
    child.once('error', (error) => settle(`spawn-error: ${error.message}`))
    child.once('exit', (code, signal) => {
      if (didTimeOut) settle('timed-out')
      else settle(code === 0 ? 'exited-0' : `exit ${code ?? signal}`)
    })
  })
}

// protects=route A mechanics (the pipe transport against the real Chrome), after a direct warm-up run that logs REAL_CHROME_PROBE_MS (the runner's cold-start time); fails_when=Browser.getVersion does not answer over fds 3/4, Browser.close does not end the process, the exit is not observed, or the warm-up run fails or passes 60 s; no_claim=a headed window, the keychain, a persistent cookie surviving Done (native check)
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
  // Probe and warm-up: Chrome itself, not the product launcher, so the product's 20 s start bound does not cut a cold start off.
  const probeProfile = await mkdtemp(join(tmpdir(), 'codebook-signin-probe-'))
  context.after(() => removeTestBrowserProfile(probeProfile))
  const probeOutcome = await runChromeProbe(executable, probeProfile)
  // The line is logged on failure too, so a cold runner's time is read either way.
  console.log(`REAL_CHROME_PROBE_MS=${probeOutcome.elapsedMs}`)
  assert.equal(
    probeOutcome.result,
    'exited-0',
    `The real-Chrome warm-up run failed or exceeded ${REAL_CHROME_PROBE_BOUND_MS} ms (${probeOutcome.result}).`,
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

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
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

/** Longest wait for Chrome's `exit` after the probe's kill attempt; after it the probe settles as a timeout even if Chrome is still alive, so no path waits unbounded. */
const REAL_CHROME_PROBE_EXIT_GRACE_MS = 5_000

/** The part of a child process the probe uses; a fake implements it in the settle-path tests. */
interface ProbeChild {
  pid?: number
  once(event: 'error', listener: (error: Error) => void): unknown
  once(
    event: 'exit',
    listener: (code: number | null, signal: string | null) => void,
  ): unknown
  kill(signal: 'SIGKILL'): unknown
}

/** The seams of {@link runChromeProbe}: real spawn and process groups by default, fakes in the unit tests. */
interface ChromeProbeDeps {
  spawnChild: (
    command: string,
    args: string[],
    options: { stdio: 'ignore'; detached: boolean },
  ) => ProbeChild
  killProcessGroup: (pid: number, signal: 'SIGKILL') => void
  platform: NodeJS.Platform
  boundMs: number
  exitGraceMs: number
}

const realChromeProbeDeps: ChromeProbeDeps = {
  spawnChild: (command, args, options) => spawn(command, args, options),
  killProcessGroup: (pid, signal) => process.kill(pid, signal),
  platform: process.platform,
  boundMs: REAL_CHROME_PROBE_BOUND_MS,
  exitGraceMs: REAL_CHROME_PROBE_EXIT_GRACE_MS,
}

/**
 * Runs a headless Chrome once on a fresh profile until it exits, to warm it and time its cold start.
 *
 * Why it exists: the product launcher bounds the first `Browser.getVersion` at 20 s, so only a direct spawn can measure a slower cold start. Called by the real-Chrome case below.
 * After the bound it tries to kill Chrome's tree, then waits at most `exitGraceMs` for `exit`; a kill that errors or exits non-zero still ends as `timed-out (kill: ...)`, naming the kill outcome.
 * @param executable - The Chrome binary.
 * @param profile - A throwaway user-data-dir.
 * @param deps - Spawn, kill, platform and bounds; defaults to the real ones.
 * @returns The outcome and the milliseconds from spawn to exit (or to the timeout settle after {@link REAL_CHROME_PROBE_BOUND_MS}).
 * @example await runChromeProbe('/usr/bin/chrome', '/tmp/p') // => { result: 'exited-0', elapsedMs: 250 }
 */
function runChromeProbe(
  executable: string,
  profile: string,
  deps: ChromeProbeDeps = realChromeProbeDeps,
): Promise<{ result: string; elapsedMs: number }> {
  return new Promise((resolve) => {
    const startedAt = performance.now()
    // Detached (off Windows) so the bound can end Chrome's whole process group.
    const child = deps.spawnChild(
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
      { stdio: 'ignore', detached: deps.platform !== 'win32' },
    )
    let didTimeOut = false
    let didSettle = false
    let killOutcome = 'no kill attempted'
    let graceTimer: NodeJS.Timeout | undefined
    const timer = setTimeout(() => {
      didTimeOut = true
      // Bounded wait for `exit` whatever the kill does.
      graceTimer = setTimeout(
        () => settle(`timed-out (kill: ${killOutcome}; Chrome still alive)`),
        deps.exitGraceMs,
      )
      if (deps.platform === 'win32') {
        try {
          const killer = deps.spawnChild(
            'taskkill',
            ['/PID', String(child.pid), '/T', '/F'],
            { stdio: 'ignore', detached: false },
          )
          killOutcome = 'taskkill pending'
          // An unhandled `error` event would kill the test process.
          killer.once('error', (error) => {
            killOutcome = `taskkill failed to start: ${error.message}`
          })
          killer.once('exit', (code, signal) => {
            killOutcome =
              code === 0
                ? 'taskkill succeeded'
                : `taskkill exited ${code ?? signal}`
          })
        } catch (error) {
          killOutcome = `taskkill threw: ${String(error)}`
        }
      } else if (child.pid !== undefined) {
        try {
          deps.killProcessGroup(-child.pid, 'SIGKILL')
          killOutcome = 'process group killed'
        } catch {
          try {
            child.kill('SIGKILL')
            killOutcome = 'child killed (group kill threw)'
          } catch (error) {
            killOutcome = `kill threw: ${String(error)}`
          }
        }
      }
    }, deps.boundMs)
    const settle = (result: string): void => {
      if (didSettle) return
      didSettle = true
      clearTimeout(timer)
      clearTimeout(graceTimer)
      resolve({ result, elapsedMs: Math.round(performance.now() - startedAt) })
    }
    child.once('error', (error) => settle(`spawn-error: ${error.message}`))
    child.once('exit', (code, signal) => {
      if (didTimeOut) settle(`timed-out (kill: ${killOutcome})`)
      else settle(code === 0 ? 'exited-0' : `exit ${code ?? signal}`)
    })
  })
}

/** A fake child that never exits unless its emitter is told to. */
function fakeChild(pid: number | undefined): ProbeChild & {
  emitter: EventEmitter
} {
  const emitter = new EventEmitter()
  return {
    pid,
    emitter,
    once: (event: string, listener: (...args: never[]) => void) =>
      emitter.once(event, listener as never),
    kill: () => true,
  }
}

// protects=the real-Chrome probe's 60 s bound on Windows when taskkill cannot start; fails_when=taskkill's error event is unhandled (the process dies) or the probe waits for Chrome's exit forever; no_claim=a real Windows taskkill
test('a probe whose taskkill cannot start still settles as a timeout within the exit grace', async () => {
  // Arrange
  const chrome = fakeChild(4242)
  const deps: ChromeProbeDeps = {
    spawnChild: (command) => {
      if (command !== 'taskkill') return chrome
      const killer = fakeChild(undefined)
      setImmediate(() => killer.emitter.emit('error', new Error('ENOENT')))
      return killer
    },
    killProcessGroup: () => {},
    platform: 'win32',
    boundMs: 20,
    exitGraceMs: 50,
  }
  // Act
  const outcome = await runChromeProbe('chrome', '/tmp/p', deps)
  // Assert
  assert.equal(
    outcome.result,
    'timed-out (kill: taskkill failed to start: ENOENT; Chrome still alive)',
  )
  assert.ok(outcome.elapsedMs < 1_000)
})

// protects=the real-Chrome probe's bound when taskkill exits non-zero and Chrome stays alive; fails_when=the probe waits for Chrome's exit forever; no_claim=a real Windows taskkill
test('a probe whose taskkill exits non-zero with a Chrome that never exits settles as a timeout within the exit grace', async () => {
  // Arrange
  const chrome = fakeChild(4242)
  const deps: ChromeProbeDeps = {
    spawnChild: (command) => {
      if (command !== 'taskkill') return chrome
      const killer = fakeChild(undefined)
      setImmediate(() => killer.emitter.emit('exit', 128, null))
      return killer
    },
    killProcessGroup: () => {},
    platform: 'win32',
    boundMs: 20,
    exitGraceMs: 50,
  }
  // Act
  const outcome = await runChromeProbe('chrome', '/tmp/p', deps)
  // Assert
  assert.equal(
    outcome.result,
    'timed-out (kill: taskkill exited 128; Chrome still alive)',
  )
  assert.ok(outcome.elapsedMs < 1_000)
})

// protects=the probe's bound off Windows when both kills throw; fails_when=the throw escapes the timer (process dies) or the probe waits forever; no_claim=a real process group
test('a probe whose process kills both throw still settles as a timeout within the exit grace', async () => {
  // Arrange
  const chrome = fakeChild(4242)
  chrome.kill = () => {
    throw new Error('EPERM')
  }
  const deps: ChromeProbeDeps = {
    spawnChild: () => chrome,
    killProcessGroup: () => {
      throw new Error('ESRCH')
    },
    platform: 'linux',
    boundMs: 20,
    exitGraceMs: 50,
  }
  // Act
  const outcome = await runChromeProbe('chrome', '/tmp/p', deps)
  // Assert
  assert.equal(
    outcome.result,
    'timed-out (kill: kill threw: Error: EPERM; Chrome still alive)',
  )
})

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

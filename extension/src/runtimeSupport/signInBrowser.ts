import { spawn } from 'node:child_process'
import { Duplex } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'

import {
  SIGN_IN_BROWSER_CLOSE_BOUND_MS,
  SIGN_IN_BROWSER_START_BOUND_MS,
  SIGN_IN_PROFILE_DISK_CACHE_BYTES,
  SIGN_IN_PROFILE_POLL_MS,
} from '../constants'

import { WebSocketFlatCdp, type FlatCdpTransport } from './flatCdpConnection'
import type { BrowserProcess } from './ownedExtensionBrowser'
import { createPipeCdpTransport } from './pipeCdpTransport'
import type { AppCookieKind } from './savedSessionTypes'
import { appCookieKindOf } from './utils/appCookieKindOf'
import { browserProcessOf } from './utils/browserProcessOf'
import { readCdpString } from './utils/cdpFieldReaders'
import type { ListedProcess } from './utils/listProcesses'
import { listProcesses } from './utils/listProcesses'
import { ownedChromeArguments } from './utils/ownedChromeArguments'
import { profileProcesses } from './utils/profileProcesses'
import { SignInBrowserStopUnconfirmedError } from './utils/signInBrowserStopUnconfirmedError'
import {
  REAL_PROCESS_STOPPER,
  stopListedProcesses,
  type ProcessStopper,
} from './utils/stopListedProcesses'

/** A browser Codebook spawned with a debugging pipe: its process and the transport to its commands. */
export type PipedBrowserProcess = BrowserProcess & {
  transport: FlatCdpTransport
}

/** What the setup browser acts through; each is the real one unless a test names its own. */
export interface SignInBrowserDependencies {
  spawnBrowser(executable: string, args: readonly string[]): PipedBrowserProcess
  /** Lists the processes whose command line names the profile folder; rejects when the listing cannot be made (then no exit is confirmed). */
  listProfileProcesses(profile: string): Promise<ListedProcess[]>
  stopper: ProcessStopper
  /** Waits between two looks at the process listing. */
  sleep(ms: number): Promise<void>
}

/**
 * How a close ended.
 * `graceful`: Browser.close was honoured, the process exited and no process names the folder, and no earlier attempt had to stop it; `forced`: the bound passed, the group was stopped and a fresh listing shows no process on the folder (also a retry after an attempt that sent a stop, since that browser may not have saved its cookies); `unconfirmed`: neither could be shown, so the folder may still be in use and the caller keeps its lock and may retry.
 */
export type SignInBrowserCloseResult = 'graceful' | 'forced' | 'unconfirmed'

/** The headed Codebook-owned browser of a saved-session setup. */
export interface SignInBrowser {
  /** The browser's `product` text from `Browser.getVersion`, for example `Chrome/154.0.1.2`. */
  readonly chromeVersion: string
  /** Calls the listener once when the learner closes the last page or the browser exits without a close having been asked; returns the unsubscribe. */
  onClosedByLearner(listener: () => void): () => void
  /** Reads only the kind of the host's cookies; any failure answers `unknown`. No cookie value ever leaves this call. */
  readAppCookieKind(host: string): Promise<AppCookieKind>
  /**
   * Closes the browser gracefully and waits until it exited and nothing names its folder.
   * Calling it again after `unconfirmed` retries.
   * @param bound - Ends the graceful wait early (a test, or the setup's own deadline); the default is {@link SIGN_IN_BROWSER_CLOSE_BOUND_MS}.
   */
  close(bound?: AbortSignal): Promise<SignInBrowserCloseResult>
}

/** What {@link launchSignInBrowser} needs from the setup. */
export interface SignInBrowserOptions {
  executable: string
  /** The saved-session folder; Chrome's user-data-dir. */
  profile: string
  /** The sign-in page to open first. */
  url: string
  signal: AbortSignal
  /** Test seam: opens the browser headless so a CI machine without a display can run the real-Chrome case; the product never sets it. */
  headless?: boolean
  /** Records the spawned browser so a later window can stop it if this one dies (the store's lease does the write). */
  recordBrowser(marker: {
    executable: string
    pid: number
    launchKind?: 'detached' | 'attached'
  }): Promise<void>
}

/**
 * Lists the switches of the setup browser: headed, a debugging pipe and never a port, the saved-session folder, a capped disk cache.
 * @param profile - The saved-session folder.
 * @param url - The sign-in page.
 * @param headless - Test seam only; the product opens a window the learner can see.
 * @example
 * signInBrowserArguments('/p', 'http://localhost:3165/login') // => ['--remote-debugging-pipe', '--no-first-run', …, 'http://localhost:3165/login']
 */
export function signInBrowserArguments(
  profile: string,
  url: string,
  headless = false,
): string[] {
  return ownedChromeArguments({
    profile,
    debugging: 'pipe',
    headless,
    startUrl: url,
    diskCacheBytes: SIGN_IN_PROFILE_DISK_CACHE_BYTES,
  })
}

/** Starts the real Chrome with pipes on descriptors 3 and 4, leading its own process group on POSIX so one signal ends its helpers too. */
function spawnPipedBrowser(
  executable: string,
  args: readonly string[],
): PipedBrowserProcess {
  const child = spawn(executable, [...args], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  // fd 3 is what Chrome reads (our write end); fd 4 is what Chrome writes (our read end).
  const toBrowser = child.stdio[3]
  const fromBrowser = child.stdio[4]
  if (!(toBrowser instanceof Duplex) || !(fromBrowser instanceof Duplex)) {
    child.kill()
    throw new Error('Chrome did not open its debugging pipe.')
  }
  return {
    ...browserProcessOf(child),
    transport: createPipeCdpTransport(toBrowser, fromBrowser),
  }
}

/** The real process, listing, signals and timer. */
const REAL_SIGN_IN_BROWSER_DEPENDENCIES: SignInBrowserDependencies = {
  spawnBrowser: spawnPipedBrowser,
  listProfileProcesses: async (profile) =>
    profileProcesses(profile, await listProcesses()),
  stopper: REAL_PROCESS_STOPPER,
  sleep: (ms) => delay(ms),
}

/** One look: the processes that name the folder, or `undefined` when the listing cannot be made. */
async function lookAtProfile(
  dependencies: SignInBrowserDependencies,
  profile: string,
): Promise<ListedProcess[] | undefined> {
  return dependencies.listProfileProcesses(profile).catch(() => undefined)
}

/** Waits until the process exited and a listing shows nothing on the folder; resolves `false` when `bound` ends first. A listing that cannot be made is not "nothing". */
async function waitForEmptyProfile(
  browser: PipedBrowserProcess,
  dependencies: SignInBrowserDependencies,
  profile: string,
  bound: AbortSignal,
): Promise<boolean> {
  while (!bound.aborted) {
    if (browser.hasExited()) {
      const listing = await lookAtProfile(dependencies, profile)
      if (listing?.length === 0) return true
    }
    await dependencies.sleep(SIGN_IN_PROFILE_POLL_MS)
  }
  return false
}

/** What one forced stop did: whether it sent a stop to any process, and whether the stop result and a fresh listing then agree that nothing runs on the folder. */
type ForceStopResult = { hasSentStop: boolean; isStopConfirmed: boolean }

/**
 * Stops the browser's processes and says whether a fresh listing then shows nothing on the folder.
 * Why: a forced close is only a close once both the stop result and a fresh listing agree (Codex correction 4). While the main process runs it is Codebook's own unreaped child leading its own group, so neither its id nor its group can name another process: it is stopped even when the first listing cannot be made, so a failed listing never leaves it running on the folder. After it exited only the listed helpers are signalled, never a recycled pid; without a fresh listing nothing is confirmed.
 * Called by the setup browser's close after the graceful bound, and by a failed launch (again on each retry).
 */
async function forceStop(
  browser: PipedBrowserProcess,
  dependencies: SignInBrowserDependencies,
  profile: string,
): Promise<ForceStopResult> {
  // An unavailable listing names no helper; the main process is still stopped, and the fresh listing below decides.
  const listing = (await lookAtProfile(dependencies, profile)) ?? []
  const mainPid = browser.hasExited() ? undefined : browser.pid
  const pids = [
    ...new Set([
      ...(mainPid === undefined ? [] : [mainPid]),
      ...listing.map((entry) => entry.pid),
    ]),
  ]
  const didStop = await stopListedProcesses(pids, dependencies.stopper, {
    groupLeaders: mainPid === undefined ? [] : [mainPid],
  })
  const after = await lookAtProfile(dependencies, profile)
  return {
    hasSentStop: pids.length > 0,
    isStopConfirmed: didStop && after?.length === 0,
  }
}

/**
 * Opens the setup browser on the saved-session folder over a debugging pipe and tracks its pages.
 * Called by the setup state machine after the sign-in server answered. Sends only `Browser.getVersion`, `Target.setDiscoverTargets`, `Storage.getCookies` (reduced to a kind) and `Browser.close`: no screencast, screenshot or script evaluation, so nothing of the page is ever recorded.
 * @param options - The Chrome executable, the folder, the sign-in URL, a signal and the marker writer.
 * @param dependencies - The process, listing, signals and timer; the real ones in the product.
 * @returns The running browser.
 * @throws When the browser cannot start or does not answer within {@link SIGN_IN_BROWSER_START_BOUND_MS}; whatever started has been stopped first. When that stop could not be confirmed, a {@link SignInBrowserStopUnconfirmedError} carrying the failure and a retry, so the caller keeps the folder's lock.
 * @example
 * const browser = await launchSignInBrowser({ executable, profile, url, signal, recordBrowser })
 * await browser.close() // => 'graceful'
 */
export async function launchSignInBrowser(
  options: SignInBrowserOptions,
  dependencies: SignInBrowserDependencies = REAL_SIGN_IN_BROWSER_DEPENDENCIES,
): Promise<SignInBrowser> {
  options.signal.throwIfAborted()
  const browser = dependencies.spawnBrowser(
    options.executable,
    signInBrowserArguments(options.profile, options.url, options.headless),
  )
  const cdp = new WebSocketFlatCdp(browser.transport)
  const pages = new Set<string>()
  const closedListeners = new Set<() => void>()
  let hasHadPage = false
  let didAskClose = false
  // Set once a close attempt sent a stop: that browser may not have saved its cookies, so no later attempt reads as graceful.
  let hasForcedStop = false
  let didTellLearnerClosed = false
  const tellClosedByLearner = (): void => {
    if (didAskClose || didTellLearnerClosed) return
    didTellLearnerClosed = true
    for (const listener of [...closedListeners]) listener()
  }
  try {
    if (browser.pid === undefined) throw new Error('Chrome did not start.')
    await options.recordBrowser({
      executable: options.executable,
      pid: browser.pid,
      // The setup browser leads its own process group (spawned detached off Windows), so a later window may signal the group.
      launchKind: process.platform === 'win32' ? 'attached' : 'detached',
    })
    trackPages(cdp, pages, () => {
      if (pages.size > 0) hasHadPage = true
      // The last page closed after one was open: on macOS the process stays alive, so this is the signal.
      else if (hasHadPage) tellClosedByLearner()
    })
    browser.onExit(tellClosedByLearner)
    const version = await cdp.request(
      'Browser.getVersion',
      {},
      undefined,
      SIGN_IN_BROWSER_START_BOUND_MS,
    )
    await cdp.request('Target.setDiscoverTargets', { discover: true })
    options.signal.throwIfAborted()
    const chromeVersion = readCdpString(version, 'product')
    return {
      chromeVersion,
      onClosedByLearner: (listener) => {
        closedListeners.add(listener)
        return (): void => {
          closedListeners.delete(listener)
        }
      },
      readAppCookieKind: (host) =>
        cdp
          .requestReduced('Storage.getCookies', {}, (result) =>
            appCookieKindOf(result, host),
          )
          .catch((): AppCookieKind => 'unknown'),
      close: async (bound) => {
        didAskClose = true
        // The browser may drop the pipe while it answers; the exit wait below is the real proof.
        await cdp.request('Browser.close', {}).catch(() => undefined)
        const graceBound = AbortSignal.any([
          bound ?? new AbortController().signal,
          AbortSignal.timeout(SIGN_IN_BROWSER_CLOSE_BOUND_MS),
        ])
        if (
          await waitForEmptyProfile(
            browser,
            dependencies,
            options.profile,
            graceBound,
          )
        ) {
          cdp.close()
          return hasForcedStop ? 'forced' : 'graceful'
        }
        const stop = await forceStop(browser, dependencies, options.profile)
        hasForcedStop ||= stop.hasSentStop
        cdp.close()
        return stop.isStopConfirmed ? 'forced' : 'unconfirmed'
      },
    }
  } catch (error) {
    // Whatever started is stopped before the failure is thrown; a stop that cannot be confirmed is thrown as such, so the caller keeps the folder's lock and retries (Codex correction 4).
    didAskClose = true
    cdp.close()
    const stopAgain = (): Promise<boolean> =>
      forceStop(browser, dependencies, options.profile).then(
        (stop) => stop.isStopConfirmed,
        () => false,
      )
    if (!(await stopAgain()))
      throw new SignInBrowserStopUnconfirmedError(error, stopAgain)
    throw error
  }
}

/** Keeps `pages` equal to the set of open page targets, calling `changed` after each change. */
function trackPages(
  cdp: WebSocketFlatCdp,
  pages: Set<string>,
  changed: () => void,
): void {
  const remember = (params: Record<string, unknown>): void => {
    const info = params.targetInfo
    if (typeof info !== 'object' || info === null) return
    const targetId = Reflect.get(info, 'targetId')
    if (typeof targetId !== 'string') return
    if (Reflect.get(info, 'type') === 'page') pages.add(targetId)
    else pages.delete(targetId)
    changed()
  }
  cdp.on('Target.targetCreated', remember)
  cdp.on('Target.targetInfoChanged', remember)
  cdp.on('Target.targetDestroyed', (params) => {
    if (typeof params.targetId === 'string') pages.delete(params.targetId)
    changed()
  })
}

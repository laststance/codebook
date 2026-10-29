import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'

import type {
  FlatCdpConnection,
  OwnedExtensionBrowser,
  ResolvedExtensionRun,
} from '../chromeExtensionContracts'
import {
  EXTENSION_BROWSER_POLL_MS,
  EXTENSION_BROWSER_START_BOUND_MS,
  EXTENSION_CDP_COMMAND_TIMEOUT_MS,
  EXTENSION_OPEN_BOUND_MS,
  EXTENSION_POPUP_WORKER_SETTLE_MS,
  EXTENSION_STOP_COMMAND_TIMEOUT_MS,
  EXTENSION_STOP_WORKERS_BOUND_MS,
  EXTENSION_WORKER_QUIET_MS,
  MANAGED_PROFILE_OWNER_FILE,
  MANAGED_PROFILE_PREFIX,
  MANAGED_PROFILE_REMOVAL_RETRIES,
  MANAGED_PROFILE_REMOVAL_RETRY_DELAY_MS,
} from '../constants'
import { StudyError } from '../errors'
import type { StorageOwnerIdentity } from '../utils/readRecordedOwner'
import { redactSecretText } from '../utils/redactSecretText'
import { removeWithoutFollowing } from '../utils/removeWithoutFollowing'
import { retryWhileBusy } from '../utils/retryWhileBusy'
import { hidePrivateRoots } from '../utils/sanitizeCause'

import {
  connectFlatCdp,
  FlatCdpCommandError,
  isMethodNotFound,
} from './flatCdpConnection'
import {
  readCdpString,
  readCdpTargets,
  type CdpTargetInfo,
} from './utils/cdpFieldReaders'
import { ownedBrowserBookmarks } from './utils/ownedBrowserBookmarks'
import { writeOwnedBrowserMarker } from './utils/ownedBrowserMarker'
import { PollBudget } from './utils/pollBudget'
import { readDevToolsActivePort } from './utils/readDevToolsActivePort'
import { removeAbandonedProfiles } from './utils/removeAbandonedProfiles'
import {
  REAL_PROCESS_STOPPER,
  stopListedProcesses,
  type ProcessStopper,
} from './utils/stopListedProcesses'
import { writeOwnedProfileMarkers } from './utils/writeOwnedProfileMarkers'

/** The browser process of an owned run as the launch sees it. */
export interface BrowserProcess {
  pid: number | undefined
  /** `true` once the process ended or could not be started. */
  hasExited(): boolean
}

/** What the launch acts through; each is the real one unless a test names its own. */
export interface OwnedBrowserDependencies {
  spawnBrowser(executable: string, args: string[]): BrowserProcess
  connect(url: string, timeoutMs: number): Promise<FlatCdpConnection>
  sleep(ms: number): Promise<void>
  stopper: ProcessStopper
  /** Starts the sweep of abandoned profile folders beside the launch; never rejects. */
  startSweep(root: string, owner: StorageOwnerIdentity): void
}

/** Everything one owned launch needs from the pre-launch checks and the environment. */
export interface OwnedBrowserLaunchOptions {
  /** The resolved Chrome executable ({@link resolveChromeExecutable}). */
  chromeExecutable: string
  run: Pick<
    ResolvedExtensionRun,
    'root' | 'extensionId' | 'surface' | 'surfaceUrl' | 'seed'
  >
  /** The directory that holds the profile folder ({@link managedProfileRoot}); a test names its own. */
  profileRoot: string
  owner: StorageOwnerIdentity
  /** Set once a stop, the deadline or a debug-session end was accepted: no further step starts (CR14). */
  signal?: AbortSignal
}

/** The real process, socket, timer, signals and sweep. */
const REAL_OWNED_BROWSER_DEPENDENCIES: OwnedBrowserDependencies = {
  spawnBrowser: (executable, args) => {
    // On POSIX the browser leads its own process group, so one signal ends its helpers too (B8); Windows ends the tree with `taskkill /T`.
    const child = spawn(executable, args, {
      stdio: 'ignore',
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    let exited = false
    child.once('exit', () => {
      exited = true
    })
    child.once('error', () => {
      exited = true
    })
    return { pid: child.pid, hasExited: () => exited }
  },
  connect: connectFlatCdp,
  sleep: (ms) => delay(ms),
  stopper: REAL_PROCESS_STOPPER,
  startSweep: (root, owner) => {
    void removeAbandonedProfiles(root, owner).catch(() => undefined)
  },
}

/**
 * Lists the command-line switches of the owned browser (task 0, TZ1): a random debugging port, headless, no first-run pages, the owned profile and a blank page.
 * Never `--enable-unsafe-extension-debugging`, `--load-extension` or `--disable-extensions-except`.
 * @param profile - The owned profile folder.
 * @returns The arguments after the executable.
 * @example
 * browserArguments('/tmp/codebook-browser-a1b2c3') // => ['--remote-debugging-port=0', '--headless=new', …, 'about:blank']
 */
function browserArguments(profile: string): string[] {
  return [
    '--remote-debugging-port=0',
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    'about:blank',
  ]
}

/** Shortens a path to its last two segments, so a message never carries the private part of an extension root. */
function rootWithoutPrivatePart(root: string): string {
  return `…/${basename(dirname(root))}/${basename(root)}`
}

/** Fails with the stop sentence when the signal says a stop was accepted; called before each step (CR14). */
function assertNotStopped(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw new StudyError(
      'RUNTIME_FAILED',
      'The start was stopped before the extension browser was ready.',
    )
}

/**
 * Makes the owned profile folder with its markers and the seeded Bookmarks file (ER12, ER18).
 * @param options - The launch options.
 * @returns The folder's real path.
 * @throws {@link StudyError} `RUNTIME_FAILED` when anything could not be written; the folder is removed first (CR12).
 */
async function prepareProfile(
  options: OwnedBrowserLaunchOptions,
): Promise<string> {
  let made: string | undefined
  try {
    made = await mkdtemp(join(options.profileRoot, MANAGED_PROFILE_PREFIX))
    const profile = await realpath(made)
    made = profile
    await mkdir(join(profile, 'Default'))
    await writeFile(
      join(profile, 'Default', 'Bookmarks'),
      ownedBrowserBookmarks(options.run.seed.bookmarks),
    )
    await writeOwnedProfileMarkers(
      profile,
      options.owner,
      options.chromeExecutable,
    )
    return profile
  } catch (error) {
    if (made !== undefined)
      await removeWithoutFollowing(made, {
        lastEntry: MANAGED_PROFILE_OWNER_FILE,
      }).catch(() => undefined)
    throw new StudyError(
      'RUNTIME_FAILED',
      `The run's test profile could not be prepared: ${String(error)}.`,
    )
  }
}

/** Waits for the spawned browser's `DevToolsActivePort` and gives its WebSocket address. */
async function waitForEndpoint(
  profile: string,
  browser: BrowserProcess,
  dependencies: OwnedBrowserDependencies,
  signal: AbortSignal | undefined,
): Promise<string> {
  const file = join(profile, 'DevToolsActivePort')
  const budget = new PollBudget(EXTENSION_BROWSER_START_BOUND_MS)
  // Poll until the file is complete, the browser ended or the bound passed; the last look comes after the last pause.
  for (;;) {
    assertNotStopped(signal)
    if (browser.hasExited())
      throw new StudyError(
        'RUNTIME_FAILED',
        'Chrome ended before it was ready.',
      )
    const endpoint = readDevToolsActivePort(
      await budget.measure(() => readFile(file, 'utf8').catch(() => '')),
    )
    if (endpoint) return `ws://127.0.0.1:${endpoint.port}${endpoint.path}`
    if (budget.isSpent()) break
    await budget.pause(dependencies.sleep, EXTENSION_BROWSER_POLL_MS)
  }
  throw new StudyError('RUNTIME_FAILED', 'Chrome did not become ready in time.')
}

/** Sends an `Extensions.*` or `ServiceWorker.*` command; a missing method becomes `CHROME_COMMAND_UNAVAILABLE` (CR2). */
async function extensionCommand(
  cdp: FlatCdpConnection,
  chromeVersion: string,
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
  timeoutMs?: number,
): Promise<Record<string, unknown>> {
  try {
    return await cdp.request(method, params, sessionId, timeoutMs)
  } catch (error) {
    if (isMethodNotFound(error))
      throw new StudyError(
        'CHROME_COMMAND_UNAVAILABLE',
        `This Chrome (${chromeVersion}) does not offer the extension commands Codebook uses; set codebook.chromeExecutable to Google Chrome or Chrome for Testing 149 or later.`,
      )
    throw error
  }
}

/**
 * Sends one command inside a poll loop: its time counts against the budget and its own timeout never exceeds what is left of it (B6).
 * @param cdp - The connection.
 * @param budget - The loop's budget.
 * @param method - The command.
 * @param params - Its parameters.
 * @param sessionId - The target session, when the command goes to one.
 * @returns The command's answer.
 */
function requestWithin(
  cdp: FlatCdpConnection,
  budget: PollBudget,
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
): Promise<Record<string, unknown>> {
  return budget.measure(() =>
    cdp.request(
      method,
      params,
      sessionId,
      Math.max(
        1,
        Math.min(EXTENSION_CDP_COMMAND_TIMEOUT_MS, budget.remainingMs()),
      ),
    ),
  )
}

/** The service-worker targets of one extension. */
async function workerTargets(
  cdp: FlatCdpConnection,
  extensionId: string,
  budget?: PollBudget,
): Promise<CdpTargetInfo[]> {
  const targets = readCdpTargets(
    budget
      ? await requestWithin(cdp, budget, 'Target.getTargets', {})
      : await cdp.request('Target.getTargets', {}),
  )
  return targets.filter(
    (target) =>
      target.type === 'service_worker' &&
      target.url.startsWith(`chrome-extension://${extensionId}/`),
  )
}

/** Everything the steps after the connection share. */
type Session = {
  cdp: FlatCdpConnection
  chromeVersion: string
  extensionId: string
  controlSessionId: string
  dependencies: OwnedBrowserDependencies
  signal: AbortSignal | undefined
}

/**
 * Stops every service worker of the extension and waits until none has run for a quiet period (TZ3).
 * A worker that runs when the debugger attaches leaves the surface blocked, so the launch ends with this and the debugger attaches only after it. Chrome starts the worker of a freshly installed extension a moment after `loadUnpacked` answers, so one stop can come before the worker exists: the stop is sent again whenever a worker is listed, and the wait ends only after {@link EXTENSION_WORKER_QUIET_MS} without one.
 * @param session - The launch's connection and ids.
 * @param boundMs - The longest wait.
 * @throws {@link StudyError} `RUNTIME_FAILED` when a worker is still listed after the bound.
 */
async function stopExtensionWorkers(
  session: Session,
  boundMs: number,
): Promise<void> {
  const budget = new PollBudget(boundMs)
  // Chrome may leave a stop unanswered while a worker that cannot start is being registered; the target list below decides, so a stop that times out is not an error.
  const stop = () =>
    budget
      .measure(() =>
        extensionCommand(
          session.cdp,
          session.chromeVersion,
          'ServiceWorker.stopAllWorkers',
          {},
          session.controlSessionId,
          Math.max(
            1,
            Math.min(EXTENSION_STOP_COMMAND_TIMEOUT_MS, budget.remainingMs()),
          ),
        ),
      )
      .catch((error: unknown) => {
        const isTimeout =
          error instanceof FlatCdpCommandError && error.detail === 'timed out'
        if (!isTimeout) throw error
        return {}
      })
  assertNotStopped(session.signal)
  await stop()
  let quietMs = 0
  // Poll the target list until the extension has had no worker for the quiet period; the last look comes after the last pause.
  for (;;) {
    assertNotStopped(session.signal)
    const running = await workerTargets(
      session.cdp,
      session.extensionId,
      budget,
    )
    if (running.length === 0) {
      quietMs += EXTENSION_BROWSER_POLL_MS
      if (quietMs >= EXTENSION_WORKER_QUIET_MS) return
    } else {
      // A worker started after the stop: stop it again and restart the quiet period.
      quietMs = 0
      await stop()
    }
    if (budget.isSpent()) break
    await budget.pause(session.dependencies.sleep, EXTENSION_BROWSER_POLL_MS)
  }
  const remaining = await workerTargets(session.cdp, session.extensionId)
  throw new StudyError(
    'RUNTIME_FAILED',
    'The extension’s service worker did not stop in time.',
    `still listed: ${remaining.map(({ url }) => url).join(', ')}`,
  )
}

/** Opens `chrome-extension://<id>/manifest.json`, the page on which the storage commands answer (TZ2), and attaches to it. */
async function openStorageHostPage(
  session: Session,
): Promise<{ targetId: string; sessionId: string }> {
  const created = await session.cdp.request('Target.createTarget', {
    url: `chrome-extension://${session.extensionId}/manifest.json`,
  })
  const targetId = readCdpString(created, 'targetId')
  const attached = await session.cdp.request('Target.attachToTarget', {
    targetId,
    flatten: true,
  })
  return { targetId, sessionId: readCdpString(attached, 'sessionId') }
}

/**
 * Seeds the extension's local storage and reads it back (ER19: stop, seed, read-back).
 * @param session - The launch's connection and ids.
 * @param storage - The seeded keys and values; nothing is done for an empty seed.
 * @throws {@link StudyError} `SEED_NOT_APPLIED` naming the first key whose stored value differs.
 */
async function seedStorage(
  session: Session,
  storage: Readonly<Record<string, unknown>>,
): Promise<void> {
  const keys = Object.keys(storage)
  if (keys.length === 0) return
  const host = await openStorageHostPage(session)
  try {
    await extensionCommand(
      session.cdp,
      session.chromeVersion,
      'Extensions.setStorageItems',
      { id: session.extensionId, storageArea: 'local', values: storage },
      host.sessionId,
    )
    const stored = await extensionCommand(
      session.cdp,
      session.chromeVersion,
      'Extensions.getStorageItems',
      { id: session.extensionId, storageArea: 'local', keys },
      host.sessionId,
    )
    const data = stored.data
    const readBack =
      typeof data === 'object' && data !== null ? data : Object.create(null)
    // Chrome answers object keys sorted, so the comparison ignores key order.
    const differing = keys.find(
      (key) => !isDeepStrictEqual(Reflect.get(readBack, key), storage[key]),
    )
    if (differing !== undefined)
      throw new StudyError(
        'SEED_NOT_APPLIED',
        `The seeded storage was not applied: ${differing}.`,
      )
  } finally {
    await session.cdp
      .request('Target.closeTarget', { targetId: host.targetId })
      .catch(() => undefined)
  }
}

/** Opens the popup through the toolbar action on the initial tab (TZ4) and waits for its page target. */
async function openPopup(
  session: Session,
  surfaceUrl: string,
): Promise<string> {
  await extensionCommand(
    session.cdp,
    session.chromeVersion,
    'ServiceWorker.startWorker',
    { scopeURL: `chrome-extension://${session.extensionId}/` },
    session.controlSessionId,
  )
  // The worker applies the extension's own state first (task 0).
  await session.dependencies.sleep(EXTENSION_POPUP_WORKER_SETTLE_MS)
  const tabs = readCdpTargets(
    await session.cdp.request('Target.getTargets', {
      filter: [{ type: 'tab' }],
    }),
  )
  const initialTab = tabs.find((tab) => tab.url === 'about:blank')
  if (!initialTab)
    throw new StudyError('POPUP_NOT_OPENED', popupNotOpenedSentence())
  await extensionCommand(
    session.cdp,
    session.chromeVersion,
    'Extensions.triggerAction',
    { id: session.extensionId, targetId: initialTab.targetId },
  )
  const budget = new PollBudget(EXTENSION_OPEN_BOUND_MS)
  // Poll for the popup page up to the open bound; the last look comes after the last pause.
  for (;;) {
    assertNotStopped(session.signal)
    const popup = readCdpTargets(
      await requestWithin(session.cdp, budget, 'Target.getTargets', {}),
    ).find((target) => target.type === 'page' && target.url === surfaceUrl)
    if (popup) return popup.targetId
    if (budget.isSpent()) break
    await budget.pause(session.dependencies.sleep, EXTENSION_BROWSER_POLL_MS)
  }
  throw new StudyError('POPUP_NOT_OPENED', popupNotOpenedSentence())
}

/** The fixed sentence of `POPUP_NOT_OPENED`. */
function popupNotOpenedSentence(): string {
  return "The extension's action opened no popup with the seeded state."
}

/** Installs the unpacked extension and checks the id Chrome answers (SR28, ER4). */
async function installExtension(
  cdp: FlatCdpConnection,
  chromeVersion: string,
  run: OwnedBrowserLaunchOptions['run'],
): Promise<void> {
  let returnedId: string
  try {
    const loaded = await extensionCommand(
      cdp,
      chromeVersion,
      'Extensions.loadUnpacked',
      { path: run.root },
    )
    returnedId = readCdpString(loaded, 'id')
  } catch (error) {
    if (error instanceof StudyError) throw error
    const chromeMessage = (
      error instanceof FlatCdpCommandError ? error.detail : String(error)
    ).replaceAll(run.root, rootWithoutPrivatePart(run.root))
    throw new StudyError(
      'EXTENSION_LOAD_FAILED',
      `Chrome did not load the extension: ${chromeMessage}.`,
    )
  }
  if (returnedId !== run.extensionId)
    throw new StudyError(
      'EXTENSION_ID_MISMATCH',
      'Chrome loaded the extension under another id than expected.',
      `expected ${run.extensionId}, returned ${returnedId}, root ${rootWithoutPrivatePart(run.root)}, Chrome ${chromeVersion}`,
    )
}

/** Attaches a flat session to the initial about:blank page, for the `ServiceWorker.*` commands. */
async function attachControlSession(
  cdp: FlatCdpConnection,
  dependencies: OwnedBrowserDependencies,
  signal: AbortSignal | undefined,
): Promise<string> {
  const budget = new PollBudget(EXTENSION_BROWSER_START_BOUND_MS)
  // The initial page may need a moment to appear after the endpoint is published; the last look comes after the last pause.
  for (;;) {
    assertNotStopped(signal)
    const page = readCdpTargets(
      await requestWithin(cdp, budget, 'Target.getTargets', {}),
    ).find((target) => target.type === 'page' && target.url === 'about:blank')
    if (page) {
      const attached = await requestWithin(
        cdp,
        budget,
        'Target.attachToTarget',
        {
          targetId: page.targetId,
          flatten: true,
        },
      )
      return readCdpString(attached, 'sessionId')
    }
    if (budget.isSpent()) break
    await budget.pause(dependencies.sleep, EXTENSION_BROWSER_POLL_MS)
  }
  throw new StudyError('RUNTIME_FAILED', 'Chrome opened no blank page.')
}

/** Reads the browser's version text from `Browser.getVersion`, for example `Chrome/156.0.8078.74`. */
async function readChromeVersion(cdp: FlatCdpConnection): Promise<string> {
  return readCdpString(await cdp.request('Browser.getVersion', {}), 'product')
}

/**
 * Ends the owned browser and removes its profile; never throws (ER18).
 * @param started - What the launch had started so far.
 * @returns What could not be confirmed.
 */
async function closeOwnedBrowser(
  started: {
    cdp?: FlatCdpConnection
    browser?: BrowserProcess
    profile?: string
  },
  dependencies: OwnedBrowserDependencies,
): Promise<{ profileLeft: boolean; exitConfirmed: boolean }> {
  started.cdp?.close()
  let exitConfirmed = true
  const pid = started.browser?.pid
  if (pid !== undefined && !started.browser?.hasExited())
    // The browser leads its own group on POSIX (B8), so its helpers end with it.
    exitConfirmed = await stopListedProcesses([pid], dependencies.stopper, {
      groupLeaders: [pid],
    })
  let profileLeft = false
  if (started.profile !== undefined) {
    const profile = started.profile
    // The marker goes last, so a folder that stays is still known to the sweep.
    profileLeft = await retryWhileBusy(
      () =>
        removeWithoutFollowing(profile, {
          lastEntry: MANAGED_PROFILE_OWNER_FILE,
        }),
      MANAGED_PROFILE_REMOVAL_RETRIES,
      MANAGED_PROFILE_REMOVAL_RETRY_DELAY_MS,
    ).then(
      () => false,
      () => true,
    )
  }
  return { profileLeft, exitConfirmed }
}

/**
 * Gives any failure of the launch the {@link StudyError} contract (B4): a {@link StudyError} passes unchanged; a lost connection or a browser that ended is `BROWSER_LOST`; anything else is `RUNTIME_FAILED`.
 * Called by {@link launchOwnedExtensionBrowser}'s outer catch, after the browser was closed. The raw CDP detail stays as the cause, with secrets masked and the extension root, the profile folder and the home directory hidden.
 * @param error - What the launch threw.
 * @param browserHadExited - Whether the browser process had ended before the close.
 * @param extensionRoot - The extension's root, hidden in the cause.
 * @param profile - The profile folder, when one was made; hidden in the cause.
 * @returns The error to throw.
 * @example
 * asLaunchFailure(new FlatCdpCommandError('Browser.getVersion', undefined, 'CDP disconnected'), false, '/work/ext', undefined).code // => 'BROWSER_LOST'
 */
function asLaunchFailure(
  error: unknown,
  browserHadExited: boolean,
  extensionRoot: string,
  profile: string | undefined,
): StudyError {
  if (error instanceof StudyError) return error
  const detail =
    error instanceof FlatCdpCommandError ? error.detail : String(error)
  const isConnectionLost =
    error instanceof FlatCdpCommandError &&
    error.code === undefined &&
    (error.detail === 'CDP disconnected' || error.detail === 'send failed')
  const cause = hidePrivateRoots(redactSecretText(detail), {
    storage: profile === undefined ? [] : [profile],
    workspace: extensionRoot,
    home: homedir(),
  })
  if (browserHadExited || isConnectionLost)
    return new StudyError(
      'BROWSER_LOST',
      'Chrome ended during the start.',
      cause,
    )
  return new StudyError(
    'RUNTIME_FAILED',
    'The extension browser could not be started.',
    cause,
  )
}

/**
 * Launches the browser a chrome-extension run owns, installs the extension, applies the seed and opens the surface, leaving every worker stopped for the debugger's attach (TZ1–TZ4).
 * Called when a chrome-extension run passes its pre-launch checks, in the phases `launching` to `attaching`; any failure closes what was started and removes the profile before it is thrown (CR12), and a stop accepted through `options.signal` ends the sequence before the next step (CR14).
 * @param options - The resolved run, the Chrome path, the profile root, the owner identity and an optional abort signal.
 * @param dependencies - The process, socket, timer, signals and sweep; the real ones in the product.
 * @returns The {@link OwnedExtensionBrowser} contract.
 * @throws {@link StudyError} with `CHROME_COMMAND_UNAVAILABLE`, `EXTENSION_LOAD_FAILED`, `EXTENSION_ID_MISMATCH`, `SEED_NOT_APPLIED`, `POPUP_NOT_OPENED` or `RUNTIME_FAILED`.
 * @example
 * const browser = await launchOwnedExtensionBrowser({ chromeExecutable, run, profileRoot: '/tmp', owner })
 * await browser.startWorker()
 * await browser.close() // => { profileLeft: false, exitConfirmed: true }
 */
export async function launchOwnedExtensionBrowser(
  options: OwnedBrowserLaunchOptions,
  dependencies: OwnedBrowserDependencies = REAL_OWNED_BROWSER_DEPENDENCIES,
): Promise<OwnedExtensionBrowser> {
  const started: {
    cdp?: FlatCdpConnection
    browser?: BrowserProcess
    profile?: string
  } = {}
  let closing:
    Promise<{ profileLeft: boolean; exitConfirmed: boolean }> | undefined
  const close = () => (closing ??= closeOwnedBrowser(started, dependencies))
  try {
    assertNotStopped(options.signal)
    dependencies.startSweep(options.profileRoot, options.owner)
    started.profile = await prepareProfile(options)
    const profile = started.profile
    assertNotStopped(options.signal)
    started.browser = dependencies.spawnBrowser(
      options.chromeExecutable,
      browserArguments(profile),
    )
    // Record the pid beside the executable: the sweep's proof of which browser is this run's. The executable alone already proves it, so a failed write changes nothing.
    if (started.browser.pid !== undefined)
      await writeOwnedBrowserMarker(profile, {
        executable: options.chromeExecutable,
        pid: started.browser.pid,
      }).catch(() => undefined)
    const endpoint = await waitForEndpoint(
      profile,
      started.browser,
      dependencies,
      options.signal,
    )
    const cdp = await dependencies.connect(
      endpoint,
      EXTENSION_CDP_COMMAND_TIMEOUT_MS,
    )
    started.cdp = cdp
    const chromeVersion = await readChromeVersion(cdp)
    const controlSessionId = await attachControlSession(
      cdp,
      dependencies,
      options.signal,
    )
    const { extensionId } = options.run
    const session: Session = {
      cdp,
      chromeVersion,
      extensionId,
      controlSessionId,
      dependencies,
      signal: options.signal,
    }
    assertNotStopped(options.signal)
    await installExtension(cdp, chromeVersion, options.run)
    await extensionCommand(
      cdp,
      chromeVersion,
      'ServiceWorker.enable',
      {},
      controlSessionId,
    )
    // ER19 order: stop the worker, seed, read back.
    assertNotStopped(options.signal)
    await stopExtensionWorkers(session, EXTENSION_STOP_WORKERS_BOUND_MS)
    await seedStorage(session, options.run.seed.storage)
    assertNotStopped(options.signal)
    const surfaceTargetId =
      options.run.surface.kind === 'popup'
        ? await openPopup(session, options.run.surfaceUrl)
        : readCdpString(
            await cdp.request('Target.createTarget', {
              url: options.run.surfaceUrl,
            }),
            'targetId',
          )
    // The debugger attaches to a surface whose worker is stopped (TZ3).
    await stopExtensionWorkers(session, EXTENSION_STOP_WORKERS_BOUND_MS)
    assertNotStopped(options.signal)
    return {
      port: Number(new URL(endpoint).port),
      extensionId,
      cdp,
      surfaceTargetId,
      controlSessionId,
      profile,
      startWorker: async (): Promise<void> => {
        await extensionCommand(
          cdp,
          chromeVersion,
          'ServiceWorker.startWorker',
          { scopeURL: `chrome-extension://${extensionId}/` },
          controlSessionId,
        )
      },
      stopWorkers: (boundMs): Promise<void> =>
        stopExtensionWorkers(session, boundMs),
      close,
    }
  } catch (error) {
    // Judge whether the browser was already gone before the close below ends it.
    const hadExited = Boolean(started.browser?.hasExited())
    const { profile } = started
    await close()
    throw asLaunchFailure(error, hadExited, options.run.root, profile)
  }
}

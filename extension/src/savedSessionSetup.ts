import {
  SIGN_IN_PATH_LIMIT,
  SIGN_IN_PROFILES_DIRECTORY,
  SIGN_IN_SETUP_TIMEOUT_MS,
  SIGN_IN_SETUP_WARNING_MS,
} from './constants'
import type { DevelopmentServerAdapterName } from './developmentServerAdapter'
import { StudyError, type ErrorCode } from './errors'
import type {
  SavedSessionManagerPort,
  SavedSessionSetupLease,
  SignInRecordFields,
} from './runtimeSupport/savedSessionSetupTypes'
import type { SavedSessionServer } from './runtimeSupport/savedSessionTypes'
import type {
  SignInBrowser,
  SignInBrowserOptions,
} from './runtimeSupport/signInBrowser'
import { chromeMajorOf } from './runtimeSupport/utils/chromeMajorOf'
import { hideSavedProfilePath } from './runtimeSupport/utils/hideSavedProfilePath'
import { SignInBrowserStopUnconfirmedError } from './runtimeSupport/utils/signInBrowserStopUnconfirmedError'
import { thrownMessage } from './utils/thrownMessage'

/** Where a setup stands (DES-2). `stuck`: the browser's exit could not be confirmed, so the lock is kept and a retry (Retry, Done or Close setup) finishes the setup the way it was first ended. */
export type SetupPhase = {
  phase: 'starting' | 'open' | 'finishing' | 'stuck' | 'ended'
  repositoryName: string
}

/** How a setup is being ended. */
export type SetupEnding = 'done' | 'closed' | 'timed-out' | 'window-closing'

/** The editor surface of a setup: status item, notices and Output lines. Implemented by {@link installSavedSessions}; tests record the calls. */
export interface SavedSessionSetupUi {
  showStatus(phase: SetupPhase | undefined): void
  offerDoneOrClose(
    repositoryName: string,
  ): PromiseLike<'Done' | 'Close setup' | undefined>
  warnClosingSoon(): PromiseLike<'Done' | undefined>
  /** Shows a non-modal notice; returns the pressed button. */
  notify(
    severity: 'information' | 'warning' | 'error',
    message: string,
    ...actions: string[]
  ): PromiseLike<string | undefined>
  log(level: 'info' | 'error', line: string): void
  showLog(): void
}

/** Everything a setup acts through. */
export interface SavedSessionSetupPorts {
  store: Pick<SavedSessionManagerPort, 'acquireForSetup'>
  startServer(
    adapter: DevelopmentServerAdapterName,
    signInPath: string,
    signal: AbortSignal,
  ): Promise<SavedSessionServer>
  launchBrowser(options: SignInBrowserOptions): Promise<SignInBrowser>
  ui: SavedSessionSetupUi
  clock: {
    /** Epoch milliseconds. */
    now(): number
    setTimeout(callback: () => void, delayMs: number): unknown
    clearTimeout(handle: unknown): void
  }
}

/** What one setup is started with. */
export interface SavedSessionSetupInput {
  repositoryRoot: string
  /** The folder name shown in messages; never a path. */
  repositoryName: string
  adapter: DevelopmentServerAdapterName
  signInPath: string
  /** Other sign-in paths known for the repository, kept in the record after the chosen one. */
  knownSignInPaths: readonly string[]
  chromeExecutable: string
}

/** How the first finishing attempt ended a setup, with the cookie kind it read then; a retry after `stuck` finishes the same way, so a Done stays a Done. */
type FirstEnding = {
  ending: SetupEnding
  appCookies: SignInRecordFields['appCookies']
}

/** Everything one open setup holds until it ends. */
type OpenSetup = {
  input: SavedSessionSetupInput
  lease: SavedSessionSetupLease
  browser: SignInBrowser
  /** Cleared by the first finishing attempt; absent once the server was closed. */
  server: SavedSessionServer | undefined
  timers: unknown[]
  unsubscribeClosed: () => void
  /** Set by the first finishing attempt and kept for a retry after `stuck`. */
  first?: FirstEnding
}

/** A start that ended (failed or cancelled) before the browser it opened was confirmed stopped: the lock is kept, no record is written, and a retry stops the browser again. */
type StuckStart = {
  repositoryName: string
  lease: SavedSessionSetupLease
  /** Stops the browser again; `true` once its exit is confirmed. */
  retryStop: () => Promise<boolean>
}

/** What a failed or cancelled start had brought up before it ended. */
type StartedParts = {
  server: SavedSessionServer | undefined
  browser: SignInBrowser | undefined
}

const DONE_NOTICE = (name: string): string =>
  `Saved session for ${name}. Runs can now start with it; a run still checks the page before it acts.`
const CLOSED_NOTICE =
  'Setup closed. Anything the browser saved stays in the saved session, but runs will not use it until you finish setup with Done.'
const FORCED_NOTICE =
  'Setup could not save the session: the Codebook browser did not close in time. Set it up again.'
const CANCELLED_NOTICE =
  'Setup closed while it was starting, so the saved session was not changed.'
const STOPPED_NOTICE =
  'The Codebook browser of the setup has stopped, so the saved session is free again. Set it up again when you are ready.'

/** The learner's next step after a coded refusal at setup start; the refusal's own message says only what happened (the chat reads the recovery instead). */
const START_REFUSAL_STEPS: Partial<Record<ErrorCode, string>> = {
  SIGN_IN_IN_PROGRESS:
    'Finish that setup with Done or close it with Close setup, then try again.',
  SIGN_IN_PROFILE_IN_USE:
    'Stop the run that uses it or quit the Chrome that has it open, then try again.',
  SIGN_IN_PROFILE_UNUSABLE:
    'Run Codebook: Remove Saved Session…, then set it up again.',
}

/**
 * Words a failure for a notice or an Output line: the error's own message with every spelling of the saved-session folder hidden (CEO-R7).
 * A file-system error names its path in its message; a path inside the store (`sign-in-profiles`) is hidden too, so a failure before any lease was held (a full disk while the folder is prepared) names neither the home folder nor the repository hash.
 * @param error - What was thrown.
 * @param profile - The folder, when one was held.
 * @example
 * causeOf(new Error('boom at /p/x'), '/p/x') // => 'boom at <saved-session>'
 */
function causeOf(error: unknown, profile: string | undefined): string {
  const storePaths = ['path', 'dest'].flatMap((key) => {
    const value: unknown =
      typeof error === 'object' && error !== null
        ? Reflect.get(error, key)
        : undefined
    return typeof value === 'string' &&
      value.includes(SIGN_IN_PROFILES_DIRECTORY)
      ? [value]
      : []
  })
  return hideSavedProfilePath(thrownMessage(error), [
    ...(profile === undefined ? [] : [profile]),
    ...storePaths,
  ])
}

/**
 * Stops the browser a failed or cancelled start opened, and gives the retry of that stop when its exit could not be confirmed (Codex correction 4).
 * @param browser - The browser, when the launch had returned one (a cancel right after it opened).
 * @param error - The start's failure; {@link launchSignInBrowser} throws {@link SignInBrowserStopUnconfirmedError} when its own stop was not confirmed.
 * @returns `undefined` when nothing is left on the folder; else the retry, which resolves `true` once the exit is confirmed.
 * @example
 * await unconfirmedStopOf(undefined, new Error('boom')) // => undefined
 */
async function unconfirmedStopOf(
  browser: SignInBrowser | undefined,
  error: unknown,
): Promise<(() => Promise<boolean>) | undefined> {
  if (error instanceof SignInBrowserStopUnconfirmedError) return error.retryStop
  if (browser === undefined) return undefined
  const stopAgain = (): Promise<boolean> =>
    browser.close().then(
      (result) => result !== 'unconfirmed',
      () => false,
    )
  return (await stopAgain()) ? undefined : stopAgain
}

/**
 * Says how a first finishing attempt ends the setup: the ending asked for and, for Done, the kind of the app's cookies (read while the browser still runs).
 * @param browser - The open setup browser.
 * @param ending - The ending asked for.
 * @example
 * await firstEndingOf(browser, 'closed') // => { ending: 'closed', appCookies: 'unknown' }
 */
async function firstEndingOf(
  browser: SignInBrowser,
  ending: SetupEnding,
): Promise<FirstEnding> {
  const appCookies =
    ending === 'done' ? await browser.readAppCookieKind('localhost') : 'unknown'
  return { ending, appCookies }
}

/**
 * Orders the sign-in paths a record keeps: the chosen one first, then the known ones, no repeats, at most {@link SIGN_IN_PATH_LIMIT}.
 * @example
 * recordedPaths('/login', ['/signin', '/login']) // => ['/login', '/signin']
 */
function recordedPaths(chosen: string, known: readonly string[]): string[] {
  return [...new Set([chosen, ...known])].slice(0, SIGN_IN_PATH_LIMIT)
}

/**
 * The setup of one saved session (DES-2): takes the folder's lock, starts the app, opens the Codebook browser at the sign-in page, and ends on Done, Close setup, the closed last page, the 10-minute limit or the window closing.
 * Why it exists: the learner signs in by hand in a browser that is never recorded; this class keeps the order that makes the saved session honest (close the browser, wait for its exit, only then write the record, then release the lock).
 * Created once per window by {@link installSavedSessions}; vscode-free so a test drives it with fakes and a manual clock.
 * The setup dev server stops in its own `finally` on every exit path. An unconfirmed browser exit keeps the lock and leaves the setup `stuck`, and a retry finishes it the way it was first ended; a failed or cancelled start whose browser could not be confirmed stopped is `stuck` the same way and writes no record. Close setup or the window closing while the setup starts cancels the start.
 * @example
 * const setup = new SavedSessionSetup(ports)
 * await setup.start({ repositoryRoot, repositoryName: 'shop', adapter: 'next-dev-webpack', signInPath: '/login', knownSignInPaths: [], chromeExecutable })
 * await setup.done()
 */
export class SavedSessionSetup {
  private open: OpenSetup | undefined
  private stuckStart: StuckStart | undefined
  private current: SetupPhase | undefined
  private finishing: Promise<void> | undefined
  private startAbort: AbortController | undefined
  private starting: Promise<void> | undefined

  constructor(private readonly ports: SavedSessionSetupPorts) {}

  /** The phase of the setup of this window; `undefined` before one was started. */
  get phase(): SetupPhase | undefined {
    return this.current
  }

  /** Says whether a setup of this window is starting, open, finishing or stuck. */
  get isActive(): boolean {
    return this.current !== undefined && this.current.phase !== 'ended'
  }

  /**
   * Starts a setup; resolves once the browser is open, or once a failed or cancelled start closed what it started and was reported.
   * @param input - The repository, adapter, sign-in path and Chrome.
   */
  start(input: SavedSessionSetupInput): Promise<void> {
    if (this.isActive) return Promise.resolve()
    // The cancel exists before the folder is taken, so Close setup or a closing window during the acquire still stops the start.
    const abort = new AbortController()
    this.startAbort = abort
    const starting = this.runStart(input, abort.signal).finally(() => {
      if (this.startAbort === abort) this.startAbort = undefined
      if (this.starting === starting) this.starting = undefined
    })
    this.starting = starting
    return starting
  }

  /** Ends the setup with Done: reads the cookie kind, closes the browser, and saves the session only when it closed gracefully. */
  done(): Promise<void> {
    return this.finish('done')
  }

  /**
   * Ends the setup without Done; the record is written with `confirmed: false`. While the setup is still starting, it cancels the start instead: nothing is written and the saved session stays as it was.
   * @param reason - Why: the learner, the 10-minute limit or the window closing (no notice).
   */
  closeSetup(reason: Exclude<SetupEnding, 'done'>): Promise<void> {
    return this.finish(reason)
  }

  /** Ends the setup of this window as the window closes: cancels a start under way and waits until it closed what it started, or closes an open setup without a notice. */
  async dispose(): Promise<void> {
    await this.finish('window-closing')
  }

  /** Takes the folder, then opens the browser; every failure is reported and leaves nothing started. */
  private async runStart(
    input: SavedSessionSetupInput,
    signal: AbortSignal,
  ): Promise<void> {
    this.setPhase({ phase: 'starting', repositoryName: input.repositoryName })
    this.ports.ui.log(
      'info',
      `Saved session setup: starting for ${input.repositoryName}.`,
    )
    let lease: SavedSessionSetupLease
    try {
      lease = await this.ports.store.acquireForSetup(input.repositoryRoot)
    } catch (error) {
      this.setPhase({ phase: 'ended', repositoryName: input.repositoryName })
      this.reportStartEnd(input, error, undefined, signal)
      return
    }
    await this.openBrowser(input, lease, signal)
  }

  /** Starts the server and the browser, then holds the open setup; a failure or a cancel closes what started and releases the lock once the browser's exit is confirmed. */
  private async openBrowser(
    input: SavedSessionSetupInput,
    lease: SavedSessionSetupLease,
    signal: AbortSignal,
  ): Promise<void> {
    let server: SavedSessionServer | undefined
    let browser: SignInBrowser | undefined
    try {
      // A start cancelled while the folder was being taken starts nothing.
      signal.throwIfAborted()
      server = await this.ports.startServer(
        input.adapter,
        input.signInPath,
        signal,
      )
      browser = await this.ports.launchBrowser({
        executable: input.chromeExecutable,
        profile: lease.profile,
        url: `${server.origin}${input.signInPath}`,
        signal,
        recordBrowser: (marker) => lease.recordBrowser(marker),
      })
      // A cancel that came while the browser opened closes it like any failed start.
      signal.throwIfAborted()
    } catch (error) {
      await this.failStart(input, lease, { server, browser }, error, signal)
      return
    }
    this.holdOpenSetup(input, lease, browser, server)
  }

  /** Holds the open setup, arms its timers and offers Done or Close setup; every answer acts only on this setup. */
  private holdOpenSetup(
    input: SavedSessionSetupInput,
    lease: SavedSessionSetupLease,
    browser: SignInBrowser,
    server: SavedSessionServer,
  ): void {
    const open: OpenSetup = {
      input,
      lease,
      browser,
      server,
      timers: [],
      unsubscribeClosed: () => undefined,
    }
    open.unsubscribeClosed = browser.onClosedByLearner(() => {
      if (this.open === open) void this.finish('closed')
    })
    this.open = open
    this.setPhase({ phase: 'open', repositoryName: input.repositoryName })
    this.ports.ui.log(
      'info',
      `Saved session setup: open at ${input.signInPath}.`,
    )
    this.armTimers(open)
    void this.ports.ui.offerDoneOrClose(input.repositoryName).then((choice) => {
      // A notice can be answered long after its setup ended; an answer never ends a later setup.
      if (this.open !== open) return
      if (choice === 'Done') void this.done()
      else if (choice === 'Close setup') void this.finish('closed')
    })
  }

  private armTimers(open: OpenSetup): void {
    const { clock, ui } = this.ports
    open.timers.push(
      clock.setTimeout(() => {
        void ui.warnClosingSoon().then((choice) => {
          // A late answer to an earlier setup's warning is ignored.
          if (choice === 'Done' && this.open === open) void this.done()
        })
      }, SIGN_IN_SETUP_WARNING_MS),
      clock.setTimeout(() => {
        void this.finish('timed-out')
      }, SIGN_IN_SETUP_TIMEOUT_MS),
    )
  }

  /**
   * Ends a start that failed or was cancelled: stops the browser it opened and closes the server in its own finally, then releases the lock only once the browser's exit was confirmed (Codex correction 4).
   * An unconfirmed exit keeps the lock and leaves the setup `stuck`; no record is written either way, so the previous saved session stays.
   */
  private async failStart(
    input: SavedSessionSetupInput,
    lease: SavedSessionSetupLease,
    started: StartedParts,
    error: unknown,
    signal: AbortSignal,
  ): Promise<void> {
    const name = input.repositoryName
    let retryStop: (() => Promise<boolean>) | undefined
    try {
      retryStop = await unconfirmedStopOf(started.browser, error)
    } finally {
      await this.closeServer(started.server, lease.profile)
    }
    if (retryStop !== undefined) {
      const stuck: StuckStart = { repositoryName: name, lease, retryStop }
      this.stuckStart = stuck
      this.reportStartEnd(input, error, lease.profile, signal)
      this.reportStuck(name, stuck)
      return
    }
    await this.releaseLease(lease)
    this.setPhase({ phase: 'ended', repositoryName: name })
    this.reportStartEnd(input, error, lease.profile, signal)
  }

  /** Tells how a start ended before it opened: a cancel only in the log (the canceller tells the learner), a failure in the log and a notice. */
  private reportStartEnd(
    input: SavedSessionSetupInput,
    error: unknown,
    profile: string | undefined,
    signal: AbortSignal,
  ): void {
    if (signal.aborted)
      this.ports.ui.log(
        'info',
        `Saved session setup: cancelled for ${input.repositoryName}.`,
      )
    else this.reportStartFailure(input, error, profile)
  }

  private reportStartFailure(
    input: SavedSessionSetupInput,
    error: unknown,
    profile: string | undefined,
  ): void {
    const { ui } = this.ports
    const cause = causeOf(error, profile)
    ui.log(
      'error',
      `Saved session setup: could not start for ${input.repositoryName}: ${cause}`,
    )
    // A coded refusal (setup open elsewhere, folder in use or unusable) gets the learner's next step instead of the log.
    if (error instanceof StudyError) {
      const step = START_REFUSAL_STEPS[error.code]
      void ui.notify('error', step === undefined ? cause : `${cause} ${step}`)
      return
    }
    void ui
      .notify(
        'error',
        `Setup could not start: ${cause}. See Output › Codebook.`,
        'Show log',
      )
      .then((pressed) => {
        if (pressed === 'Show log') ui.showLog()
      })
  }

  /** Runs one ending at a time; a retry after `stuck` starts a new attempt, and an ending while the setup starts cancels the start. */
  private finish(ending: SetupEnding): Promise<void> {
    if (this.finishing) return this.finishing
    let attempt: Promise<void> | undefined
    if (this.open) attempt = this.runFinish(this.open, ending)
    else if (this.stuckStart)
      attempt = this.retryStuckStart(this.stuckStart, ending)
    if (attempt === undefined) return this.cancelStart(ending)
    this.finishing = attempt.finally(() => {
      this.finishing = undefined
    })
    return this.finishing
  }

  /** Cancels a start under way for any ending but Done (nothing is open to finish yet), waits until it closed what it started, and says so unless the window is closing. */
  private async cancelStart(ending: SetupEnding): Promise<void> {
    const { startAbort, starting } = this
    if (ending === 'done' || !startAbort || !starting) return
    const isFirstCancel = !startAbort.signal.aborted
    startAbort.abort()
    await starting
    // A start whose browser could not be confirmed stopped is `stuck` and has said so already.
    if (
      isFirstCancel &&
      ending !== 'window-closing' &&
      this.current?.phase === 'ended'
    )
      void this.ports.ui.notify('information', CANCELLED_NOTICE)
  }

  private async runFinish(
    open: OpenSetup,
    requested: SetupEnding,
  ): Promise<void> {
    const { ui, clock } = this.ports
    const name = open.input.repositoryName
    for (const timer of open.timers.splice(0)) clock.clearTimeout(timer)
    open.unsubscribeClosed()
    this.setPhase({ phase: 'finishing', repositoryName: name })
    try {
      // A retry after `stuck` finishes the way the first attempt ended the setup, with the cookie kind read then: a Done stays a Done.
      if (open.first === undefined)
        open.first = await firstEndingOf(open.browser, requested)
      const { first } = open
      ui.log('info', `Saved session setup: ${first.ending} for ${name}.`)
      const closeResult = await open.browser.close()
      if (closeResult === 'unconfirmed') {
        this.reportStuck(name, open)
        return
      }
      await this.saveAndRelease(
        open,
        first,
        closeResult,
        requested === 'window-closing',
      )
    } finally {
      // The setup server stops on every exit path, also when the browser could not be confirmed closed.
      const { server } = open
      open.server = undefined
      await this.closeServer(server, open.lease.profile)
    }
  }

  /** Retries the stop of a stuck start's browser; the lock is released only once its exit is confirmed, and no record is written. */
  private async retryStuckStart(
    stuck: StuckStart,
    requested: SetupEnding,
  ): Promise<void> {
    const { ui } = this.ports
    const name = stuck.repositoryName
    this.setPhase({ phase: 'finishing', repositoryName: name })
    const isStopped = await stuck.retryStop().catch(() => false)
    if (!isStopped) {
      this.reportStuck(name, stuck)
      return
    }
    this.stuckStart = undefined
    await this.releaseLease(stuck.lease)
    this.setPhase({ phase: 'ended', repositoryName: name })
    ui.log('info', `Saved session setup: the browser for ${name} stopped.`)
    if (requested !== 'window-closing')
      void ui.notify('information', STOPPED_NOTICE)
  }

  private reportStuck(name: string, owner: OpenSetup | StuckStart): void {
    const { ui } = this.ports
    this.setPhase({ phase: 'stuck', repositoryName: name })
    ui.log(
      'error',
      `Saved session setup: the browser exit for ${name} could not be confirmed.`,
    )
    void ui
      .notify(
        'error',
        'Setup could not confirm that the Codebook browser exited, so the saved session stays locked. Quit that browser, then retry.',
        'Retry',
      )
      .then((pressed) => {
        // A Retry pressed on an earlier setup's notice never ends a later setup.
        if (pressed === 'Retry' && this.isCurrent(owner))
          void this.closeSetup('closed')
      })
  }

  /** Says whether `owner` is still the setup of this window, so a late answer to an older notice is ignored. */
  private isCurrent(owner: OpenSetup | StuckStart): boolean {
    return this.open === owner || this.stuckStart === owner
  }

  private async closeServer(
    server: SavedSessionServer | undefined,
    profile: string,
  ): Promise<void> {
    await server?.close().catch((error: unknown) => {
      this.ports.ui.log(
        'error',
        `Saved session setup: server stop failed: ${causeOf(error, profile)}`,
      )
    })
  }

  /** Releases the folder's lock; a release that fails is logged with the folder hidden and never leaves the setup `finishing`. */
  private async releaseLease(lease: SavedSessionSetupLease): Promise<void> {
    await lease.release().catch((error: unknown) => {
      this.ports.ui.log(
        'error',
        `Saved session setup: the lock was not released: ${causeOf(error, lease.profile)}`,
      )
    })
  }

  /** Writes the record after a confirmed exit, releases the lock and tells the learner how it ended. */
  private async saveAndRelease(
    open: OpenSetup,
    first: FirstEnding,
    closeResult: 'graceful' | 'forced',
    isWindowClosing: boolean,
  ): Promise<void> {
    const { ui } = this.ports
    const name = open.input.repositoryName
    const confirmed = first.ending === 'done' && closeResult === 'graceful'
    const saveFailure = await this.writeRecordOf(
      open,
      confirmed,
      first.appCookies,
    )
    await this.releaseLease(open.lease)
    this.open = undefined
    this.setPhase({ phase: 'ended', repositoryName: name })
    if (saveFailure !== undefined) {
      ui.log(
        'error',
        `Saved session setup: the record was not written: ${causeOf(saveFailure, open.lease.profile)}`,
      )
      void ui.notify(
        'error',
        'Setup could not save the session. Set it up again.',
      )
    } else if (first.ending === 'done' && closeResult === 'forced')
      void ui.notify('warning', FORCED_NOTICE)
    else if (confirmed) void ui.notify('information', DONE_NOTICE(name))
    else if (!isWindowClosing) void ui.notify('information', CLOSED_NOTICE)
  }

  /** Writes the record of a confirmed exit; resolves why it could not be written, or `undefined` once it was. */
  private async writeRecordOf(
    open: OpenSetup,
    confirmed: boolean,
    appCookies: SignInRecordFields['appCookies'],
  ): Promise<unknown> {
    const chromeMajor = chromeMajorOf(open.browser.chromeVersion)
    if (chromeMajor === undefined)
      return new Error('the Chrome version could not be read')
    try {
      await open.lease.writeRecord({
        confirmed,
        setupAt: new Date(this.ports.clock.now()).toISOString(),
        signInPaths: recordedPaths(
          open.input.signInPath,
          open.input.knownSignInPaths,
        ),
        chromeMajor,
        appCookies,
      })
      return undefined
    } catch (error) {
      return error
    }
  }

  private setPhase(phase: SetupPhase): void {
    this.current = phase
    this.ports.ui.showStatus(phase.phase === 'ended' ? undefined : phase)
  }
}

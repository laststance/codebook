import {
  SIGN_IN_PATH_LIMIT,
  SIGN_IN_SETUP_TIMEOUT_MS,
  SIGN_IN_SETUP_WARNING_MS,
} from './constants'
import type { DevelopmentServerAdapterName } from './developmentServerAdapter'
import { StudyError } from './errors'
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

/** Where a setup stands (DES-2). `stuck`: the browser's exit could not be confirmed, so the lock is kept and Done or Close setup can be tried again. */
export type SetupPhase = {
  phase: 'starting' | 'open' | 'finishing' | 'stuck' | 'ended'
  repositoryName: string
  outcome?: 'done' | 'closed' | 'timed-out' | 'failed'
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

/** Everything one open setup holds until it ends. */
type OpenSetup = {
  input: SavedSessionSetupInput
  lease: SavedSessionSetupLease
  browser: SignInBrowser
  /** Cleared by the first finishing attempt; absent once the server was closed. */
  server: SavedSessionServer | undefined
  timers: unknown[]
  unsubscribeClosed: () => void
}

const DONE_NOTICE = (name: string): string =>
  `Saved session for ${name}. Runs can now start with it; a run still checks the page before it acts.`
const CLOSED_NOTICE =
  'Setup closed. Anything the browser saved stays in the saved session, but runs will not use it until you finish setup with Done.'
const FORCED_NOTICE =
  'Setup could not save the session: the Codebook browser did not close in time. Set it up again.'

/**
 * Words a failure for a notice: the error's own message with the saved-session folder hidden.
 * @param error - What was thrown.
 * @param profile - The folder, when one was held.
 * @example
 * causeOf(new Error('boom at /p/x'), '/p/x') // => 'boom at <saved-session>'
 */
function causeOf(error: unknown, profile: string | undefined): string {
  const text = error instanceof Error ? error.message : String(error)
  return profile ? text.split(profile).join('<saved-session>') : text
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
 * The setup dev server stops in its own `finally` on every exit path; an unconfirmed browser exit keeps the lock and leaves the setup `stuck` so Done or Close setup can retry.
 * @example
 * const setup = new SavedSessionSetup(ports)
 * await setup.start({ repositoryRoot, repositoryName: 'shop', adapter: 'next-dev-webpack', signInPath: '/login', knownSignInPaths: [], chromeExecutable })
 * await setup.done()
 */
export class SavedSessionSetup {
  private open: OpenSetup | undefined
  private current: SetupPhase | undefined
  private finishing: Promise<void> | undefined
  private startAbort: AbortController | undefined

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
   * Starts a setup; resolves once the browser is open (or the start failed and was reported).
   * @param input - The repository, adapter, sign-in path and Chrome.
   */
  async start(input: SavedSessionSetupInput): Promise<void> {
    if (this.isActive) return
    const { ui } = this.ports
    this.setPhase({ phase: 'starting', repositoryName: input.repositoryName })
    ui.log('info', `Saved session setup: starting for ${input.repositoryName}.`)
    let lease: SavedSessionSetupLease
    try {
      lease = await this.ports.store.acquireForSetup(input.repositoryRoot)
    } catch (error) {
      this.setPhase({
        phase: 'ended',
        repositoryName: input.repositoryName,
        outcome: 'failed',
      })
      this.reportStartFailure(input, error, undefined)
      return
    }
    await this.openBrowser(input, lease)
  }

  /** Ends the setup with Done: reads the cookie kind, closes the browser, and saves the session only when it closed gracefully. */
  done(): Promise<void> {
    return this.finish('done')
  }

  /**
   * Ends the setup without Done; the record is written with `confirmed: false`.
   * @param reason - Why: the learner, the 10-minute limit or the window closing (no notice).
   */
  closeSetup(reason: Exclude<SetupEnding, 'done'>): Promise<void> {
    return this.finish(reason)
  }

  /** Ends an open setup as the window closes. */
  async dispose(): Promise<void> {
    // A start still waiting for its server or browser is cancelled; its own failure path cleans up.
    this.startAbort?.abort()
    if (this.open) await this.finish('window-closing')
  }

  /** Starts the server and the browser, and arms the timers; every failure closes what started and releases the lock. */
  private async openBrowser(
    input: SavedSessionSetupInput,
    lease: SavedSessionSetupLease,
  ): Promise<void> {
    const abort = (this.startAbort = new AbortController())
    let server: SavedSessionServer | undefined
    let browser: SignInBrowser | undefined
    try {
      server = await this.ports.startServer(
        input.adapter,
        input.signInPath,
        abort.signal,
      )
      browser = await this.ports.launchBrowser({
        executable: input.chromeExecutable,
        profile: lease.profile,
        url: `${server.origin}${input.signInPath}`,
        signal: abort.signal,
        recordBrowser: (marker) => lease.recordBrowser(marker),
      })
    } catch (error) {
      await this.failStart(input, lease, server, error)
      return
    }
    this.startAbort = undefined
    this.open = {
      input,
      lease,
      browser,
      server,
      timers: [],
      unsubscribeClosed: browser.onClosedByLearner(() => {
        void this.finish('closed')
      }),
    }
    this.setPhase({ phase: 'open', repositoryName: input.repositoryName })
    this.ports.ui.log(
      'info',
      `Saved session setup: open at ${input.signInPath}.`,
    )
    this.armTimers(this.open)
    void this.ports.ui.offerDoneOrClose(input.repositoryName).then((choice) => {
      if (choice === 'Done') void this.done()
      else if (choice === 'Close setup') void this.finish('closed')
    })
  }

  private armTimers(open: OpenSetup): void {
    const { clock, ui } = this.ports
    open.timers.push(
      clock.setTimeout(() => {
        void ui.warnClosingSoon().then((choice) => {
          if (choice === 'Done') void this.done()
        })
      }, SIGN_IN_SETUP_WARNING_MS),
      clock.setTimeout(() => {
        void this.finish('timed-out')
      }, SIGN_IN_SETUP_TIMEOUT_MS),
    )
  }

  /** Closes the server of a failed start in its own finally, then releases the lock and says why. */
  private async failStart(
    input: SavedSessionSetupInput,
    lease: SavedSessionSetupLease,
    server: SavedSessionServer | undefined,
    error: unknown,
  ): Promise<void> {
    this.startAbort = undefined
    try {
      await server?.close().catch((closeError: unknown) => {
        this.ports.ui.log(
          'error',
          `Saved session setup: server stop failed: ${causeOf(closeError, lease.profile)}`,
        )
      })
    } finally {
      await lease.release().catch(() => undefined)
    }
    this.setPhase({
      phase: 'ended',
      repositoryName: input.repositoryName,
      outcome: 'failed',
    })
    this.reportStartFailure(input, error, lease.profile)
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
    // A coded refusal (setup open elsewhere, folder in use) already says what to do.
    const text =
      error instanceof StudyError
        ? cause
        : `Setup could not start: ${cause}. See Output › Codebook.`
    void ui
      .notify(
        'error',
        text,
        ...(error instanceof StudyError ? [] : ['Show log']),
      )
      .then((pressed) => {
        if (pressed === 'Show log') ui.showLog()
      })
  }

  /** Runs one ending at a time; a retry after `stuck` starts a new attempt. */
  private finish(ending: SetupEnding): Promise<void> {
    if (!this.open) return this.finishing ?? Promise.resolve()
    this.finishing ??= this.runFinish(this.open, ending).finally(() => {
      this.finishing = undefined
    })
    return this.finishing
  }

  private async runFinish(open: OpenSetup, ending: SetupEnding): Promise<void> {
    const { ui, clock } = this.ports
    const name = open.input.repositoryName
    for (const timer of open.timers.splice(0)) clock.clearTimeout(timer)
    open.unsubscribeClosed()
    this.setPhase({ phase: 'finishing', repositoryName: name })
    ui.log('info', `Saved session setup: ${ending} for ${name}.`)
    try {
      const appCookies =
        ending === 'done'
          ? await open.browser.readAppCookieKind('localhost')
          : 'unknown'
      const closeResult = await open.browser.close()
      if (closeResult === 'unconfirmed') {
        this.reportStuck(name)
        return
      }
      await this.saveAndRelease(open, ending, closeResult, appCookies)
    } finally {
      // The setup server stops on every exit path, also when the browser could not be confirmed closed.
      await this.closeServer(open)
    }
  }

  private reportStuck(name: string): void {
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
        if (pressed === 'Retry') void this.closeSetup('closed')
      })
  }

  private async closeServer(open: OpenSetup): Promise<void> {
    const { server } = open
    open.server = undefined
    await server?.close().catch((error: unknown) => {
      this.ports.ui.log(
        'error',
        `Saved session setup: server stop failed: ${causeOf(error, open.lease.profile)}`,
      )
    })
  }

  /** Writes the record after a confirmed exit, releases the lock and tells the learner how it ended. */
  private async saveAndRelease(
    open: OpenSetup,
    ending: SetupEnding,
    closeResult: 'graceful' | 'forced',
    appCookies: SignInRecordFields['appCookies'],
  ): Promise<void> {
    const { ui, clock } = this.ports
    const name = open.input.repositoryName
    const chromeMajor = chromeMajorOf(open.browser.chromeVersion)
    const confirmed = ending === 'done' && closeResult === 'graceful'
    let saveFailure: unknown
    if (chromeMajor === undefined)
      saveFailure = new Error('the Chrome version could not be read')
    else
      try {
        await open.lease.writeRecord({
          confirmed,
          setupAt: new Date(clock.now()).toISOString(),
          signInPaths: recordedPaths(
            open.input.signInPath,
            open.input.knownSignInPaths,
          ),
          chromeMajor,
          appCookies,
        })
      } catch (error) {
        saveFailure = error
      }
    await open.lease.release()
    this.open = undefined
    const outcome = confirmed
      ? 'done'
      : ending === 'timed-out'
        ? 'timed-out'
        : 'closed'
    this.setPhase({ phase: 'ended', repositoryName: name, outcome })
    if (saveFailure !== undefined) {
      ui.log(
        'error',
        `Saved session setup: the record was not written: ${causeOf(saveFailure, open.lease.profile)}`,
      )
      void ui.notify(
        'error',
        'Setup could not save the session. Set it up again.',
      )
    } else if (ending === 'done' && closeResult === 'forced')
      void ui.notify('warning', FORCED_NOTICE)
    else if (confirmed) void ui.notify('information', DONE_NOTICE(name))
    else if (ending !== 'window-closing')
      void ui.notify('information', CLOSED_NOTICE)
  }

  private setPhase(phase: SetupPhase): void {
    this.current = phase
    this.ports.ui.showStatus(phase.phase === 'ended' ? undefined : phase)
  }
}

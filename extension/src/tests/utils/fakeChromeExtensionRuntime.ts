import type { CapturedExtensionStop } from '../../chromeExtensionContracts'
import type { ExtensionContinueArguments } from '../../chromeExtensionDebugger'
import { StudyError } from '../../errors'
import type {
  ChromeExtensionClickAnswer,
  ChromeExtensionObserved,
  ChromeExtensionRuntime,
  ChromeExtensionView,
} from '../../runtime'

import type { defer } from './defer'

/** The session and thread every fake pause uses, so a test writes the arguments it expects. */
export const FAKE_EXTENSION_SESSION_ID = 'extension-session'
export const FAKE_EXTENSION_THREAD_ID = 3

/** What the fake's manifest declares, as the start answer must name it (CR5). */
export const FAKE_EXTENSION_MANIFEST = {
  name: 'Ping demo',
  permissions: ['storage'],
  hostPermissions: ['https://example.com/*'],
}

/**
 * A stand-in for the chrome-extension run (Cycle 0061 pt2) that a test drives by hand: it reaches every {@link ChromeExtensionView} phase, pauses at declared stops with generations, completes with an observation, fails with a typed error, and fires {@link ChromeExtensionRuntime.onDidChange} after every change, so the service, MCP and resources are tested without Chrome, a debugger or a socket.
 * It enforces the run-side refusals of the contract (`RUN_NOT_READY`, `RUN_PAUSED`, `ACTION_IN_PROGRESS`, `NO_MORE_ACTIONS`, `NO_PAUSE`, `STALE_PAUSE`) the way the real run does, and logs each call in {@link FakeChromeExtensionRuntime.calls}.
 * @example
 * const run = new FakeChromeExtensionRuntime()
 * await run.prepare()
 * await run.click() // => { clickIndex: 1, outcome: 'settled', … }
 */
export class FakeChromeExtensionRuntime implements ChromeExtensionRuntime {
  readonly id = 'fake-extension-run'
  /** Each call the service made, in order, as `prepare`, `click`, `continue:<generation>` and `stop`. */
  readonly calls: string[] = []
  /** Declared clicks of the fake run. */
  clicksDeclared = 2
  /** The outcome the next click answers. */
  nextOutcome: ChromeExtensionClickAnswer['outcome'] = 'settled'
  /** The click's side effect the next answer reports: `unknown` when the press was sent and not answered, as when a stop pauses inside the handler. */
  nextClickEffect: ChromeExtensionClickAnswer['clickEffect'] = 'confirmed'
  /** When set, `prepare()` rejects with it and the run reads `failed`. */
  prepareFailure?: StudyError
  /** When set, `prepare()` reads `installing` and waits for it before it ends (a slow preparation). */
  prepareGate?: ReturnType<typeof defer<void>>
  /** When set, the next `click()` rejects with it; a failed-state code also ends the run `failed`. */
  clickFailure?: StudyError
  /** When set, `click()` waits for it before it answers (a click in flight). */
  clickGate?: ReturnType<typeof defer<void>>
  private current: ChromeExtensionView = {
    phase: 'starting',
    procedure: { clicksDeclared: 2, clicksPerformed: 0 },
    pauses: [],
    captures: [],
    stopsDeclared: 2,
    stopsNotReached: [1, 2],
    claimable: false,
    interventions: [],
    outputs: [],
    outputsDropped: 0,
  }
  private readonly listeners = new Set<() => void>()
  private generation = 0
  private stopped = false

  async prepare(): Promise<void> {
    this.calls.push('prepare')
    if (this.prepareGate) {
      this.change({ phase: 'installing' })
      await this.prepareGate.promise
    }
    if (this.prepareFailure) {
      this.change({ phase: 'failed', runFailure: this.prepareFailure })
      throw this.prepareFailure
    }
    this.change({
      phase: 'ready',
      extension: {
        id: 'abcdefghijklmnopabcdefghijklmnop',
        surface: {
          kind: 'popup',
          path: 'popup.html',
          url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
        },
        manifest: FAKE_EXTENSION_MANIFEST,
      },
      procedure: {
        clicksDeclared: this.clicksDeclared,
        clicksPerformed: 0,
      },
    })
  }

  view(): ChromeExtensionView {
    return { ...this.current }
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  async click(): Promise<ChromeExtensionClickAnswer> {
    this.calls.push('click')
    if (
      this.current.phase === 'completed' ||
      this.current.phase === 'failed' ||
      this.stopped
    )
      this.refuseEndedRun()
    if (this.current.pauses.length > 0)
      throw new StudyError(
        'RUN_PAUSED',
        'A stop is paused; continue it before the next click.',
      )
    if (this.current.phase !== 'ready')
      throw new StudyError('RUN_NOT_READY', 'not ready')
    if (this.current.procedure.clickInFlight !== undefined)
      throw new StudyError(
        'ACTION_IN_PROGRESS',
        'A click is still in progress.',
      )
    if (
      this.current.procedure.clicksPerformed >=
      this.current.procedure.clicksDeclared
    )
      throw new StudyError(
        'NO_MORE_ACTIONS',
        'Every declared click was performed.',
      )
    const clickIndex = this.current.procedure.clicksPerformed + 1
    this.change({
      procedure: { ...this.current.procedure, clickInFlight: clickIndex },
    })
    if (this.clickGate) await this.clickGate.promise
    if (this.clickFailure) {
      const failure = this.clickFailure
      this.clickFailure = undefined
      this.change({
        procedure: { ...this.current.procedure, clickInFlight: undefined },
        ...(failure.code === 'SELECTOR_NOT_FOUND'
          ? {}
          : { phase: 'failed' as const, runFailure: failure }),
      })
      throw failure
    }
    const answer: ChromeExtensionClickAnswer = {
      clickIndex,
      outcome: this.nextOutcome,
      inputsApplied: 0,
      clickDispatched: this.nextClickEffect === 'confirmed',
      inputEffects: [],
      clickEffect: this.nextClickEffect,
    }
    this.change({
      procedure: {
        clicksDeclared: this.current.procedure.clicksDeclared,
        clicksPerformed: clickIndex,
      },
      lastClick: answer,
    })
    return answer
  }

  async continue(args: ExtensionContinueArguments): Promise<void> {
    this.calls.push(`continue:${args.generation}`)
    if (this.current.pauses.length === 0)
      throw new StudyError('NO_PAUSE', 'no pause')
    const remaining = this.current.pauses.filter(
      (pause) => pause.generation !== args.generation,
    )
    if (remaining.length === this.current.pauses.length)
      throw new StudyError('STALE_PAUSE', 'stale')
    this.change({
      pauses: remaining,
      phase: remaining.length > 0 ? 'paused' : 'ready',
    })
  }

  async stop(): Promise<void> {
    this.calls.push('stop')
    if (this.stopped) return
    this.stopped = true
    // A stop before the last click leaves a partial result and no observation (SR22).
    if (this.current.phase !== 'completed' && this.current.phase !== 'failed')
      this.change({
        phase: 'completed',
        result: 'partial',
        observed: null,
        pauses: [],
      })
  }

  /** Pauses the run at declared stop `stopIndex` (1-based) and returns the pause's generation. */
  pauseAt(
    stopIndex: number,
    context: 'page' | 'service-worker' = 'page',
  ): number {
    const generation = ++this.generation
    const capture: CapturedExtensionStop = {
      stopIndex,
      path: context === 'service-worker' ? 'worker.js' : 'popup.js',
      line: 2,
      context,
      workerGeneration: context === 'service-worker' ? 1 : 0,
      targetUrl:
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
      sha256: 'a'.repeat(64),
      capturedAtMs: 10,
      snapshot: {
        version: 1,
        frames: [
          {
            name: 'handleClick',
            line: 2,
            column: 1,
            scopes: [{ name: 'Local', variables: [0] }],
          },
        ],
        variables: [
          { name: 'answer', value: '"pong"', type: 'string', children: [] },
        ],
        limitations: [],
      },
    }
    this.change({
      phase: 'paused',
      captures: [...this.current.captures, capture],
      pauses: [
        ...this.current.pauses,
        {
          generation,
          sessionId: FAKE_EXTENSION_SESSION_ID,
          threadId: FAKE_EXTENSION_THREAD_ID,
          context,
          reason: 'breakpoint',
          kind: 'declared',
          stopIndex,
          status: 'captured',
          captured: capture,
          continueArguments: {
            participant: 'extension',
            sessionId: FAKE_EXTENSION_SESSION_ID,
            threadId: FAKE_EXTENSION_THREAD_ID,
            generation,
          },
          pausedAtMs: 10,
        },
      ],
      stopsNotReached: this.current.stopsNotReached.filter(
        (index) => index !== stopIndex,
      ),
    })
    return generation
  }

  /** Ends the run `completed`: the observation was read (`claimable`), or only failed to be read. */
  complete(
    observed: ChromeExtensionObserved,
    options: { claimable?: boolean } = {},
  ): void {
    this.change({
      phase: 'completed',
      result: this.current.stopsNotReached.length > 0 ? 'partial' : 'complete',
      observed,
      claimable: options.claimable ?? true,
      procedure: {
        clicksDeclared: this.current.procedure.clicksDeclared,
        clicksPerformed: this.current.procedure.clicksDeclared,
      },
    })
  }

  /** Ends the run `failed` with a typed error. */
  fail(failure: StudyError): void {
    this.change({ phase: 'failed', runFailure: failure })
  }

  private refuseEndedRun(): never {
    if (
      this.current.phase === 'completed' &&
      this.current.procedure.clicksPerformed >=
        this.current.procedure.clicksDeclared
    )
      throw new StudyError(
        'NO_MORE_ACTIONS',
        'Every declared click was performed.',
      )
    throw new StudyError('RUN_NOT_READY', 'ended')
  }

  private change(next: Partial<ChromeExtensionView>): void {
    this.current = { ...this.current, ...next }
    for (const listener of [...this.listeners]) listener()
  }
}

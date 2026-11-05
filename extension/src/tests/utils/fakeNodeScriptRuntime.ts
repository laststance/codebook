import { StudyError } from '../../errors'
import type {
  NodeScriptEndView,
  NodeScriptPrepareLimits,
  NodeScriptRuntime,
  NodeScriptView,
} from '../../nodeScriptRuntimeTypes'
import type { PauseIdentity } from '../../runtimeSupport/pauseGate'

import { defer } from './defer'

/** The session and thread every fake script pause uses. */
export const FAKE_SCRIPT_SESSION_ID = 'script-session'
export const FAKE_SCRIPT_THREAD_ID = 3

/**
 * A stand-in for the node-script run that a test drives by hand: it confirms, pauses at declared stops, ends and fails, and fires {@link NodeScriptRuntime.onDidChange} after every change, so the service, resources and status item are tested without a process or a debugger.
 * @example
 * const run = new FakeNodeScriptRuntime()
 * await run.prepare()
 * run.pauseAt(0, { total: 3 }) // run.view().state === 'paused'
 */
export class FakeNodeScriptRuntime implements NodeScriptRuntime {
  readonly id = 'fake-script-run'
  /** Each call the service made, in order. */
  readonly calls: string[] = []
  /** Holds `prepare()` in the learner's confirmation until the test settles it. */
  readonly confirmGate = defer<void>()
  holdsConfirmation = false
  /** The limits the service passed to `prepare()`. */
  prepareLimits?: NodeScriptPrepareLimits
  /** Holds `stop()` until the test settles it, as a process group release that takes time. */
  readonly stopGate = defer<void>()
  holdsStop = false
  /** Makes `stop()` reject once its gate (if held) settled. */
  stopFailure?: Error
  private current: NodeScriptView = {
    state: 'preparing',
    stops: [
      { declaredStopIndex: 0, path: 'src/a.mjs', declaredLine: 2 },
      { declaredStopIndex: 1, path: 'src/a.mjs', declaredLine: 3 },
    ],
    stopsReached: [],
    pauseGeneration: 0,
    captures: [],
    captureBudgetExhausted: false,
    failedStops: 0,
  }
  private readonly listeners = new Set<() => void>()

  async prepare(limits?: NodeScriptPrepareLimits): Promise<void> {
    this.prepareLimits = limits
    this.calls.push('prepare')
    if (this.holdsConfirmation) {
      this.change({ state: 'confirming', confirmation: 'awaiting-learner' })
      await this.confirmGate.promise
    }
    if (this.current.state === 'stopped')
      throw new StudyError('RUNTIME_FAILED', 'Stopped during preparation.')
    this.change({ state: 'running', confirmation: 'confirmed' })
  }

  view(): NodeScriptView {
    return { ...this.current }
  }

  elapsedSinceLaunchMs(): number {
    return 0
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  async continue(pause: PauseIdentity): Promise<void> {
    this.calls.push(`continue:${pause.generation}`)
    if (!this.current.pause) throw new StudyError('NO_PAUSE', 'no pause')
    this.change({ state: 'running', pause: undefined })
  }

  async stop(): Promise<void> {
    this.calls.push('stop')
    this.change({ state: 'stopped', pause: undefined })
    this.confirmGate.resolve()
    if (this.holdsStop) await this.stopGate.promise
    if (this.stopFailure) throw this.stopFailure
  }

  /** Merges a change into the view and tells the listeners. */
  change(patch: Partial<NodeScriptView>): void {
    this.current = { ...this.current, ...patch }
    for (const listener of [...this.listeners]) listener()
  }

  /** The script paused at declared stop `index` with captured facts and a new pause generation. */
  pauseAt(index: number, facts: Record<string, unknown> = {}): void {
    const generation = this.current.pauseGeneration + 1
    this.change({
      state: 'paused',
      pauseGeneration: generation,
      captures: [
        ...this.current.captures,
        {
          declaredStopIndex: index,
          stopNumber: index + 1,
          pauseGeneration: generation,
          path: 'src/a.mjs',
          line: 2 + index,
          sourceHash: 'a'.repeat(64),
          facts,
          unavailable: [],
          capturedAtMs: 10,
          attribution: 'timing',
        },
      ],
      stopsReached: [...this.current.stopsReached, index],
      pause: {
        sessionId: FAKE_SCRIPT_SESSION_ID,
        threadId: FAKE_SCRIPT_THREAD_ID,
        generation,
        declaredStopIndex: index,
        stopNumber: index + 1,
        captureIndex: this.current.captures.length,
      },
    })
  }

  /** The script ended; the run is released with its end. */
  end(end: Partial<NodeScriptEndView> = {}): void {
    this.change({
      state: 'ended',
      pause: undefined,
      end: {
        kind: 'exited',
        exitCode: 0,
        stopsReached: [...new Set(this.current.stopsReached)],
        stopsNeverReached: [],
        output: { tail: 'done\n', truncated: false },
        ...end,
      },
    })
  }
}

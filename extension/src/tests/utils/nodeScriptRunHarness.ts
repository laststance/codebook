import type { StudyError } from '../../errors'
import type { NodeScriptConfiguration } from '../../nodeScriptConfigSchemas'
import type { NodeScriptHistorySink } from '../../nodeScriptHistorySink'
import type { NodeScriptRuntime } from '../../nodeScriptRuntimeTypes'
import {
  createOwnedNodeScriptRun,
  type NodeScriptRunDependencies,
  type NodeScriptRunQuestion,
} from '../../ownedNodeScriptRun'
import type { NodeServerExit } from '../../utils/launchNodeServer'

import { createManualClock } from './createManualClock'
import { defer } from './defer'
import {
  FakeNodeServerDebugger,
  WORKSPACE,
  fakeServer,
  type HarnessOptions,
} from './nodeServerRunHarness'

/** What a test arranges around a script run beyond the happy path. */
export type ScriptHarnessOptions = Omit<HarnessOptions, 'history'> & {
  /** How the learner answers: at once yes (default), at once no, or by hand through `harness.answer`. */
  confirm?: 'yes' | 'no' | 'manual'
  /** The asker never reacts to the abort signal, so only the run itself can end the wait. */
  askerIgnoresAbort?: boolean
  /** Declared stops; three by default so "2 of 3" is expressible. */
  stopCount?: 1 | 2 | 3
  /** Replaces the real-path resolution of the launch. */
  resolveLaunchFails?: StudyError
  /** Stop files by declared index, repository-absolute; each defaults to a file in the package root. */
  stopFiles?: string[]
  /** Replaces the stop resolution. */
  resolveStopsFails?: StudyError
  history?: NodeScriptHistorySink
}

/** The declaration every script run test uses: a script at the repository root with `stopCount` stops in one file. */
function declaration(stopCount: number): NodeScriptConfiguration {
  const hash = 'a'.repeat(64)
  const stop = (index: number) => ({
    path: 'src/routes/users.ts',
    hash,
    line: 14 + index,
    column: 3,
  })
  return {
    version: 1,
    adapter: 'node-script',
    book: {
      bookId: 'script-book',
      revision: 1,
      nodeId: 'script',
      anchorIndex: 0,
    },
    packageRoot: '.',
    entry: 'script.mjs',
    loader: 'node',
    source: stop(0),
    inspections: [{ path: 'user.id', mode: 'value', required: true }],
    additionalStops:
      stopCount === 1
        ? undefined
        : Array.from({ length: stopCount - 1 }, (_, index) => ({
            ...stop(index + 1),
            anchorIndex: index + 1,
            inspections: [{ path: 'user.id', mode: 'value', required: true }],
          })),
  }
}

/** A history sink that remembers what the run told it. */
export function fakeScriptHistory() {
  const told: Array<{ call: string; detail?: unknown }> = []
  const sink: NodeScriptHistorySink = {
    output: (_elapsed, channel, text) =>
      told.push({ call: 'output', detail: { channel, text } }),
    stop: (_elapsed, pause) =>
      told.push({ call: 'stop', detail: pause.declaredStopIndex }),
    libraryPrepared: (_elapsed, facts) =>
      told.push({ call: 'libraryPrepared', detail: facts }),
    libraryObserved: (_elapsed, facts) =>
      told.push({ call: 'libraryObserved', detail: facts }),
    end: (_elapsed, end) => told.push({ call: 'end', detail: end }),
    markCaptureBudgetExhausted: () => told.push({ call: 'budget' }),
    flush: () => undefined,
  }
  return { sink, told }
}

/** Builds a script run against fakes and returns every handle a test needs. */
export function createScriptHarness(options: ScriptHarnessOptions = {}) {
  const { history, ...harnessOptions } = options
  const order: string[] = []
  const events: Array<{ type: string; detail: unknown }> = []
  const clock = createManualClock()
  const stopCount = options.stopCount ?? 3
  const state: { exit?: NodeServerExit; output: string } = { output: '' }
  const base = fakeServer(order, harnessOptions, state)
  const exitEvent = defer<NodeServerExit>()
  let exitFact: NodeServerExit | undefined
  const process = Object.assign(base, {
    exitedEvent: (): NodeServerExit | undefined => exitFact,
    whenExitEvent: (): Promise<NodeServerExit> => exitEvent.promise,
  })
  const signals: Array<[number, string]> = []
  const debuggers: FakeNodeServerDebugger[] = []
  const questions: NodeScriptRunQuestion[] = []
  const answers: Array<ReturnType<typeof defer<boolean>>> = []
  let startReads = 0
  let emitOutput: (text: string, channel?: 'stdout' | 'stderr') => void = () =>
    undefined
  const dependencies: NodeScriptRunDependencies = {
    clock: {
      now: () => clock.now(),
      set: (callback, delayMs) => {
        const id = clock.setTimeout(callback, delayMs)
        return (): void => clock.clearTimeout(id)
      },
    },
    node: { executable: '/usr/bin/node', version: '26.0.0' },
    createDebugger: (input) => {
      const created = new FakeNodeServerDebugger(input, order, harnessOptions)
      debuggers.push(created)
      return created
    },
    resolveLaunch: async () => {
      order.push('resolveLaunch')
      if (options.resolveLaunchFails) throw options.resolveLaunchFails
      return {
        packageRoot: WORKSPACE,
        entry: `${WORKSPACE}/script.mjs`,
        loader: { kind: 'node' },
      }
    },
    resolveStops: async () => {
      order.push('resolveStops')
      if (options.resolveStopsFails) throw options.resolveStopsFails
      return Array.from({ length: stopCount }, (_, index) => ({
        declaredStopIndex: index,
        path: 'src/routes/users.ts',
        file: options.stopFiles?.[index] ?? `${WORKSPACE}/src/routes/users.ts`,
        line: 14 + index,
        column: 3,
        hash: 'a'.repeat(64),
        inspections: [],
      }))
    },
    confirmRun: (question, signal) => {
      order.push('confirmRun')
      questions.push(question)
      const answer = defer<boolean>()
      answers.push(answer)
      if ((options.confirm ?? 'yes') === 'yes') answer.resolve(true)
      if (options.confirm === 'no') answer.resolve(false)
      // As the real asker: an abort answers no.
      if (!options.askerIgnoresAbort)
        signal.addEventListener('abort', () => answer.resolve(false), {
          once: true,
        })
      return answer.promise
    },
    launch: async (_launch, _record, onOutput) => {
      order.push('launch')
      emitOutput = (text, channel = 'stdout') =>
        void onOutput?.({ sequence: 1, elapsedMs: 5, channel, text })
      return process
    },
    signalGroup: (group, signal) => {
      order.push(`signal:${signal}`)
      signals.push([group, signal])
    },
    isGroupGone: () => options.groupGone ?? false,
    // The leader's id is free once it exited, so a group is confirmed as the launched one by its start.
    isProcessGone: () => options.processGone ?? true,
    // The launch reads the leader's start; once it exited the read finds nothing, so only the survivors identify the group.
    readProcessStart: async () => (startReads++ === 0 ? 'start-1' : undefined),
    // After the leader's exit nothing is readable at its id.
    readProcessCwd: async () => undefined,
    readListeningPorts: async () => [],
    rememberProcess: async () => undefined,
    forgetProcess: async () => undefined,
  }
  const run: NodeScriptRuntime = createOwnedNodeScriptRun({
    workspace: WORKSPACE,
    configuration: declaration(stopCount),
    record: (type, detail) => events.push({ type, detail }),
    citedSources: [],
    runId: options.runId ?? 'script-run-1',
    history,
    traceUri: 'codebook://node-history/trace',
    dependencies,
  })
  return {
    run,
    order,
    events,
    clock,
    process,
    signals,
    questions,
    /** The learner answers the n-th dialog. */
    answer: (accepted: boolean, index = 0): void =>
      answers[index]?.resolve(accepted),
    emitOutput: (text: string, channel?: 'stdout' | 'stderr'): void =>
      emitOutput(text, channel),
    get debug(): FakeNodeServerDebugger {
      const [first] = debuggers
      if (!first) throw new Error('The run created no debugger yet.')
      return first
    },
    /** The script exits by itself; `pipesClosed` false leaves a descendant holding stdout. */
    exits(fact: NodeServerExit, pipesClosed = true): void {
      exitFact = fact
      exitEvent.resolve(fact)
      if (pipesClosed) base.exitNow(fact)
    },
    /** The last descendant closed the pipes. */
    closePipes(fact: NodeServerExit): void {
      base.exitNow(fact)
    },
  }
}

export type ScriptHarness = ReturnType<typeof createScriptHarness>

/** Lets the run finish what a fake started in microtasks and timers-free promises. */
export async function settle(times = 3): Promise<void> {
  for (let turn = 0; turn < times; turn++)
    await new Promise<void>((resolve) => setImmediate(resolve))
}

/**
 * Waits until the run's view satisfies a condition, by listening to its changes.
 * @param harness - The harness under test.
 * @param condition - Reads the view.
 * @returns The view that satisfied it.
 * @example await until(harness, (view) => view.state === 'ended')
 */
export function until(
  harness: ScriptHarness,
  condition: (view: ReturnType<NodeScriptRuntime['view']>) => boolean,
): Promise<ReturnType<NodeScriptRuntime['view']>> {
  const current = harness.run.view()
  if (condition(current)) return Promise.resolve(current)
  return new Promise((resolve) => {
    const subscription = harness.run.onDidChange(() => {
      const view = harness.run.view()
      if (!condition(view)) return
      subscription.dispose()
      resolve(view)
    })
  })
}

/** Prepares a confirmed run and returns the harness, running. */
export async function runningHarness(
  options: ScriptHarnessOptions = {},
): Promise<ScriptHarness> {
  const harness = createScriptHarness(options)
  await harness.run.prepare()
  return harness
}

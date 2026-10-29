import type {
  ChromeExtensionActionExecutor,
  ExtensionClickReceipt,
  ExtensionExecutorInput,
} from '../../chromeExtensionActionExecutor'
import type {
  ChromeExtensionViewport,
  OwnedExtensionBrowser,
  ResolvedExtensionRun,
} from '../../chromeExtensionContracts'
import type {
  ChromeExtensionDebugger,
  ExtensionContinueArguments,
  ExtensionDebuggerHandlers,
  ExtensionDebuggerInput,
} from '../../chromeExtensionDebugger'
import { ExtensionPauseSet, viewOfPause } from '../../chromeExtensionPauseSet'
import type { StudyError } from '../../errors'
import {
  createOwnedChromeExtensionRun,
  type ChromeExtensionRunDependencies,
  type ChromeExtensionRunTimings,
} from '../../ownedChromeExtensionRun'
import type { ChromeExtensionRuntime } from '../../runtime'
import type { RunClock } from '../../utils/runningTimeLimit'
import { REAL_DEADLINE_TIMERS } from '../../utils/slotDeadline'

import {
  fakeExtensionSurface,
  type SurfaceAnswers,
} from './fakeExtensionSurface'

/** The configuration every harness run declares: two clicks, one page stop, one worker stop, text observation. */
export const HARNESS_CONFIGURATION = {
  extensionRoot: 'extension',
  surface: { kind: 'popup' },
  clicks: [
    { title: 'Open dialog', selector: '#open' },
    { title: 'Confirm', selector: '#confirm' },
  ],
  stops: [],
  seed: {},
  observe: { kind: 'text', selector: '#result' },
  acknowledgedPermissions: [],
} as never

/** Builds the resolved run of the harness. */
export function resolvedHarnessRun(
  overrides: Partial<ResolvedExtensionRun> = {},
): ResolvedExtensionRun {
  return {
    root: '/repo/extension',
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    manifestName: 'Harness extension',
    permissions: ['storage'],
    hostPermissions: [],
    surface: { kind: 'popup', path: 'popup.html' },
    surfaceUrl:
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
    workerPath: 'worker.js',
    stops: [
      {
        index: 1,
        path: 'popup.js',
        absolutePath: '/repo/extension/popup.js',
        line: 3,
        context: 'page',
        sha256: 'aa',
      },
      {
        index: 2,
        path: 'worker.js',
        absolutePath: '/repo/extension/worker.js',
        line: 5,
        context: 'service-worker',
        sha256: 'bb',
      },
    ],
    clicks: [
      {
        index: 1,
        title: 'Open dialog',
        selector: '#open',
        kind: 'click',
        inputs: [],
      },
      {
        index: 2,
        title: 'Confirm',
        selector: '#confirm',
        kind: 'click',
        inputs: [],
      },
    ],
    seed: { bookmarks: [], storage: {} },
    observe: { kind: 'text', selector: '#result' },
    pinnedHashes: {},
    ...overrides,
  }
}

/** Behaviour a test changes in the fake parts. */
export type HarnessBehaviour = {
  resolved?: ResolvedExtensionRun
  resolveFailure?: StudyError
  launchFailure?: StudyError
  /** Holds the launch until released, to stop the run during a phase step. */
  launchGate?: Promise<void>
  /** Holds the debugger's attach until released, and ignores the run's abort meanwhile (a preparation step that never settles). */
  attachGate?: Promise<void>
  /** Holds the viewport factory until released, and ignores the run's abort meanwhile (the first preparation step never settles). */
  viewportGate?: Promise<void>
  /** Holds the debugger's release until released (a debugger that stops answering at the cleanup). */
  releaseGate?: Promise<void>
  /** Replaces the real clock the run's timers use, so a test fires a bound by hand. */
  clock?: RunClock
  /** Which debugger step throws. */
  debuggerFailure?: {
    step: 'attach' | 'waitForWorker' | 'armStops'
    error: StudyError
  }
  ensureWorkerReadyFailure?: StudyError
  sourceCheckFailure?: StudyError
  closeResult?: { profileLeft: boolean; exitConfirmed: boolean }
  /** How many of the extension's own copies of the surface page the launch closed; default none. */
  closedDuplicateSurfacePages?: number
  /** The receipt a click returns, by 1-based index; default a settled one. */
  receipts?: Record<number, () => Promise<ExtensionClickReceipt>>
  /** What the text observation reads, called per read. */
  readText?: () => { text: string } | { missing: true }
  timings?: ChromeExtensionRunTimings
  /** Answers of the surface connection beyond the text read. */
  surfaceAnswers?: SurfaceAnswers
  /** Starts with no viewport factory. */
  withoutViewport?: boolean
  /** The viewport factory throws this, as the editor's layout guard does when the pane cannot be placed. */
  viewportFailure?: Error
  /** The created viewport cannot show the surface, as when a learner's tab opened in its group makes the editor's lease refuse the reveal. */
  viewportAttachFailure?: Error
}

/** A receipt that settled with no stop. */
export function settledReceipt(
  clickIndex: number,
  completed: Promise<void> = Promise.resolve(),
  outcome: ExtensionClickReceipt['outcome'] = 'settled',
): ExtensionClickReceipt {
  return {
    clickIndex,
    outcome,
    progress: () => ({
      inputsApplied: 0,
      clickDispatched: true,
      inputEffects: [],
      clickEffect: 'confirmed',
    }),
    completed,
  }
}

/**
 * Builds a chrome-extension run over fake parts and the log of everything they were asked, in order.
 * @param behaviour - What differs from a healthy run.
 * @returns The run, the shared log, the journal and handles to every fake.
 * @example
 * const harness = createRunHarness({})
 * await harness.run.prepare()
 */
export function createRunHarness(behaviour: HarnessBehaviour = {}) {
  const log: string[] = []
  const journal: { type: string; detail: unknown }[] = []
  const viewportCalls: [string, ...unknown[]][] = []
  const surface = fakeExtensionSurface({
    'Runtime.evaluate': () => ({
      result: {
        value: behaviour.readText?.() ?? { text: 'value' },
      },
    }),
    ...behaviour.surfaceAnswers,
  })
  const resolveInputs: unknown[] = []
  const pauses = new ExtensionPauseSet()
  const debuggerState: {
    handlers?: ExtensionDebuggerHandlers
    input?: ExtensionDebuggerInput
    notReached: number[]
    released: number
  } = { notReached: [1, 2], released: 0 }
  let loseBrowser: () => void = () => undefined
  let endDebugSession: () => void = () => undefined
  const resolved = behaviour.resolved ?? resolvedHarnessRun()
  const sourceCheckCalls = { count: 0 }

  const browser: OwnedExtensionBrowser = {
    port: 9222,
    extensionId: resolved.extensionId,
    cdp: surface.connection,
    surfaceTargetId: 'surface-target',
    closedDuplicateSurfacePages: behaviour.closedDuplicateSurfacePages ?? 0,
    controlSessionId: 'control-session',
    profile: '/tmp/codebook-browser-fake',
    startWorker: async () => undefined,
    stopWorkers: async () => undefined,
    attachSurface: async () => {
      log.push('browser.attachSurface')
      return 'surface-session'
    },
    onLost: (listener) => {
      loseBrowser = listener
      return () => undefined
    },
    close: async () => {
      log.push('browser.close')
      return (
        behaviour.closeResult ?? { profileLeft: false, exitConfirmed: true }
      )
    },
  }

  const debuggerFake = (
    input: ExtensionDebuggerInput,
  ): ChromeExtensionDebugger => {
    debuggerState.input = input
    const fail = (step: 'attach' | 'waitForWorker' | 'armStops'): void => {
      if (behaviour.debuggerFailure?.step === step)
        throw behaviour.debuggerFailure.error
    }
    return {
      subscribe: (handlers) => {
        debuggerState.handlers = handlers
        const stop = pauses.onChange(() => handlers.onChange())
        return { dispose: stop }
      },
      attach: async (): Promise<void> => {
        input.onPhase?.('attaching', 10)
        log.push('debugger.attach')
        await behaviour.attachGate
        fail('attach')
      },
      waitForWorker: async (): Promise<void> => {
        input.onPhase?.('waking', 20)
        log.push('debugger.waitForWorker')
        fail('waitForWorker')
      },
      armStops: async (): Promise<void> => {
        input.onPhase?.('arming', 30)
        log.push('debugger.armStops')
        fail('armStops')
      },
      markReady: () => log.push('debugger.markReady'),
      ensureWorkerReady: async (): Promise<void> => {
        log.push('debugger.ensureWorkerReady')
        if (behaviour.ensureWorkerReadyFailure)
          throw behaviour.ensureWorkerReadyFailure
      },
      beginAction: () => ({
        assertCurrent: () => undefined,
        end: () => undefined,
      }),
      pauseState: pauses,
      pauses: () => pauses.list().map(viewOfPause),
      resume: async (args: ExtensionContinueArguments): Promise<void> => {
        log.push('debugger.resume')
        const pause = pauses.find(args)
        if (pause) pauses.close(pause.sessionId, pause.threadId)
      },
      stopsNotReached: () => debuggerState.notReached,
      workerGeneration: () => 1,
      interventions: () => [],
      recordIntervention: (kind) => log.push(`intervention:${kind}`),
      browserClosing: () => log.push('debugger.browserClosing'),
      release: async (): Promise<void> => {
        debuggerState.released += 1
        log.push('debugger.release')
        await behaviour.releaseGate
      },
    }
  }

  const executorFake = (
    input: ExtensionExecutorInput,
  ): ChromeExtensionActionExecutor => {
    void input
    return {
      run: async (click) => {
        log.push(`executor.run:${click.index}`)
        const scripted = behaviour.receipts?.[click.index]
        return scripted ? scripted() : settledReceipt(click.index)
      },
      lateDialogRefusal: () => undefined,
      dispose: () => log.push('executor.dispose'),
    }
  }

  const viewport: ChromeExtensionViewport = {
    setIdentity: (identity) => viewportCalls.push(['setIdentity', identity]),
    showPreparing: (step, steps, sentence) =>
      viewportCalls.push(['showPreparing', step, steps, sentence]),
    attachSurface: async () => {
      viewportCalls.push(['attachSurface'])
      if (behaviour.viewportAttachFailure) throw behaviour.viewportAttachFailure
    },
    setPhase: (text) => viewportCalls.push(['setPhase', text]),
    setAccessibleDetail: (detail) =>
      viewportCalls.push(['setAccessibleDetail', detail]),
    pinPause: async (_png, text) => {
      viewportCalls.push(['pinPause', text])
    },
    resumeLive: () => viewportCalls.push(['resumeLive']),
    showFailure: (sentence, nextStep) =>
      viewportCalls.push(['showFailure', sentence, nextStep]),
    surfaceLost: () => viewportCalls.push(['surfaceLost']),
    end: (line) => {
      log.push('viewport.end')
      viewportCalls.push(['end', line])
    },
    close: () => {
      log.push('viewport.close')
      viewportCalls.push(['close'])
    },
  }

  const dependencies: ChromeExtensionRunDependencies = {
    clock: behaviour.clock ?? {
      now: () => performance.now(),
      set: REAL_DEADLINE_TIMERS.set,
    },
    resolveRun: async (options) => {
      resolveInputs.push(options)
      log.push('resolve')
      if (behaviour.resolveFailure) throw behaviour.resolveFailure
      return resolved
    },
    launchBrowser: async (options) => {
      log.push('launch')
      options.onPhase?.('launching', 1)
      options.onPhase?.('installing', 2)
      await (behaviour.launchGate ?? Promise.resolve())
      if (behaviour.launchFailure) throw behaviour.launchFailure
      options.onPhase?.('opening', 3)
      return browser
    },
    createDebugger: debuggerFake,
    createExecutor: executorFake,
    createSourceCheck: () => async (): Promise<void> => {
      sourceCheckCalls.count += 1
      if (behaviour.sourceCheckFailure && sourceCheckCalls.count > 1)
        throw behaviour.sourceCheckFailure
    },
    watchDebugSessionEnd: (_runId, listener) => {
      endDebugSession = listener
      return { dispose: () => undefined }
    },
    chromeExecutable: '/fake/chrome',
    profileRoot: '/tmp',
    readOwner: async () => ({ hostname: 'harness' }),
    timings: {
      settleMs: 20,
      pollMs: 10,
      boundMs: 2_000,
      readTimeoutMs: 500,
      runMs: 20_000,
      setupMs: 20_000,
      ...behaviour.timings,
    },
  }
  const run: ChromeExtensionRuntime = createOwnedChromeExtensionRun({
    runId: 'run-1',
    configuration: HARNESS_CONFIGURATION,
    acknowledgedPermissions: ['storage'],
    record: (type, detail) => journal.push({ type, detail }),
    workspace: '/repo',
    dependencies,
    ...(behaviour.withoutViewport
      ? {}
      : {
          createViewport: async () => {
            await behaviour.viewportGate
            if (behaviour.viewportFailure) throw behaviour.viewportFailure
            return viewport
          },
        }),
  })
  return {
    run,
    log,
    journal,
    resolveInputs,
    viewportCalls,
    surface,
    pauses,
    browser,
    debuggerState,
    loseBrowser: (): void => loseBrowser(),
    endDebugSession: (): void => endDebugSession(),
    /** Opens a declared pause as the debugger would. */
    openDeclaredPause: (
      stopIndex: number,
      context: 'page' | 'service-worker',
    ) =>
      pauses.open({
        sessionId: `session-${context}`,
        threadId: 1,
        context,
        reason: 'breakpoint',
        kind: 'declared',
        stopIndex,
        status: 'captured',
        pausedAtMs: 0,
      }),
  }
}

/**
 * A clock whose timers fire only when a test says so, to cross a production bound (10 s) without waiting.
 * @returns The {@link RunClock}, the delays of the timers still pending, and `fire` that runs and removes every pending timer of one delay.
 * @example
 * const timers = manualClock()
 * timers.fire(10_000)
 */
export function manualClock() {
  const timers = new Set<{ callback: () => void; delayMs: number }>()
  const clock: RunClock = {
    now: () => performance.now(),
    set: (callback, delayMs) => {
      const timer = { callback, delayMs }
      timers.add(timer)
      return (): void => void timers.delete(timer)
    },
  }
  return {
    clock,
    pendingDelays: (): number[] => [...timers].map((timer) => timer.delayMs),
    fire: (delayMs: number): void => {
      for (const timer of [...timers])
        if (timer.delayMs === delayMs) {
          timers.delete(timer)
          timer.callback()
        }
    },
  }
}

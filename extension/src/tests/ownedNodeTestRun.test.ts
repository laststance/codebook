import assert from 'node:assert/strict'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'
import type * as vscode from 'vscode'

import * as constants from '../constants'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'
import type * as OwnedNodeTestRunModule from '../ownedNodeTestRun'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { loadModule } from './utils/loadModule'

/** The adapter's DAP id for Codebook's own breakpoint, as its registration receipt reports it. */
const OWNED_BREAKPOINT_ID = 7
/** A breakpoint the learner set in the editor. */
const LEARNER_BREAKPOINT_ID = 12

/**
 * Drives one owned Node test run through fake editor/process ports, recording the order of breakpoint, continuation and release effects.
 *
 * @param options.declaredStops - Ordered checked stops, all at the same source line as a loop body would declare them.
 * @param options.observedLine - Line the native debugger reports for every breakpoint pause.
 * @param options.duringRetire - Learner action performed while the owned breakpoint is being retired.
 * @param options.exitAfterEntry - The test process exits after the entry pause, as when Vitest skips the cited test.
 * @param options.reportFailure - Error the Vitest report check raises after the process finishes.
 * @param options.reportStatus - Actual assertion result reported by Vitest, independent of the process exit code.
 * @param options.exitCode - The process result, which a repository plugin can reset even after a failed assertion.
 * @param options.firstPause - A pause that is not Codebook's (a learner breakpoint, for example) reached before the first declared stop; `file` is relative to the test repository.
 * @param options.neverReachStop - The test keeps running after the entry pause without reaching a declared stop.
 * @param options.budgetMs - Replaces the 45 s per-phase budget so deadline behavior can be observed quickly.
 * @param options.acknowledgements - Uses the real breakpoint tracker instead of the stand-in: the adapter's registration reply for each owned breakpoint in the order they are armed, passed through the run's own tracker as the editor would send it.
 *
 * @example
 * ```ts
 * const harness = await nodeRunHarness({ declaredStops: 2 }); await harness.run.prepare(); await harness.run.advance();
 * ```
 */
async function nodeRunHarness({
  declaredStops = 1,
  observedLine = 1,
  duringRetire,
  exitAfterEntry,
  reportFailure,
  reportStatus = 'passed',
  exitCode = 0,
  firstPause,
  neverReachStop,
  budgetMs,
  acknowledgements,
}: {
  declaredStops?: number
  observedLine?: number
  duringRetire?: () => void
  exitAfterEntry?: boolean
  reportFailure?: Error
  reportStatus?: 'passed' | 'failed'
  exitCode?: number
  firstPause?: {
    line: number
    file?: string
    reason?: string
    hitBreakpointIds?: number[]
  }
  neverReachStop?: boolean
  budgetMs?: number
  acknowledgements?: Array<{
    verified: boolean
    line?: number
    column?: number
  }>
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-owned-node-run-'))
  const reportDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-owned-node-report-'),
  )
  const sourceText = 'export const nextTheme = "dark";\n',
    sourceFile = join(directory, 'theme.ts')
  await writeFile(sourceFile, sourceText)
  const source = {
    path: 'theme.ts',
    hash: sha256(sourceText),
    line: 1,
    column: 14,
  }
  const testTitles = ['theme', 'loads the dark theme']
  const launch = {
    workspace: directory,
    testFile: join(directory, 'theme.test.ts'),
    sourceFile,
    program: 'vitest',
    args: [],
    testTitles,
    report: {
      directory: reportDirectory,
      file: join(reportDirectory, 'vitest-report.json'),
    },
    stops: Array.from({ length: declaredStops }, () => ({
      file: sourceFile,
      source,
      inspections: [],
    })),
  }
  const calls: string[] = [],
    verified: unknown[][] = [],
    events: Array<{ type: string; detail: unknown }> = []
  let trackerFactory: vscode.DebugAdapterTrackerFactory | undefined,
    tracker: vscode.DebugAdapterTracker | undefined,
    continued = 0,
    pausedLine = observedLine,
    pausedFile = sourceFile
  let terminate: ((session: vscode.DebugSession) => void) | undefined
  const stopped = (reason: string, hitBreakpointIds?: number[]) =>
    tracker?.onDidSendMessage?.({
      type: 'event',
      event: 'stopped',
      body: {
        threadId: 1,
        reason,
        ...(hitBreakpointIds ? { hitBreakpointIds } : {}),
      },
    })
  const clientRequest = (command: string) =>
    tracker?.onWillReceiveMessage?.({
      type: 'request',
      seq: 90,
      command,
      arguments: { threadId: 1 },
    })
  const session = {
    id: 'owned-node-session',
    type: 'pwa-node',
    name: '',
    workspaceFolder: undefined,
    configuration: { type: 'pwa-node', name: '', request: 'attach' },
    getDebugProtocolBreakpoint: async () => undefined,
    async customRequest(command: string): Promise<unknown> {
      // The editor passes Codebook's own requests through the same tracker as the learner's.
      clientRequest(command)
      if (command === 'continue') {
        calls.push('continue')
        // A cited test that Vitest skipped never reaches the source: its process exits and the owned session ends.
        if (exitAfterEntry) {
          queueMicrotask(() => terminate?.(session))
          return {}
        }
        if (neverReachStop) return {}
        // A pause Codebook did not make holds the test before its first declared stop; only the learner releases it.
        if (firstPause && continued === 0) {
          continued++
          pausedLine = firstPause.line
          pausedFile = firstPause.file
            ? join(directory, firstPause.file)
            : sourceFile
          queueMicrotask(() =>
            stopped(
              firstPause.reason ?? 'breakpoint',
              firstPause.hitBreakpointIds,
            ),
          )
          return {}
        }
        // Each continuation before a declared stop reaches the line again; the final one lets the test finish.
        if (++continued <= declaredStops)
          queueMicrotask(() => stopped('breakpoint', [OWNED_BREAKPOINT_ID]))
        return {}
      }
      if (command === 'stackTrace')
        return {
          stackFrames: [
            {
              id: 1,
              name: 'loadTheme',
              line: pausedLine,
              column: source.column,
              source: { path: pausedFile },
            },
          ],
        } satisfies DebugProtocol.StackTraceResponse['body']
      if (command === 'scopes')
        return {
          scopes: [{ name: 'Local', variablesReference: 1, expensive: false }],
        } satisfies DebugProtocol.ScopesResponse['body']
      throw new Error(`Unexpected request ${command}`)
    },
  }
  class Breakpoint {
    constructor() {
      calls.push('arm')
    }
    async registered() {
      return { status: 'bound', breakpointId: OWNED_BREAKPOINT_ID }
    }
    async retire(): Promise<void> {
      calls.push('retire')
      duringRetire?.()
    }
    remove(): void {
      calls.push('remove')
    }
    onRequest(): void {}
    onResponse(): void {}
  }
  class Position {
    constructor(
      readonly line: number,
      readonly character: number,
    ) {}
  }
  class Location {
    readonly range
    constructor(
      readonly uri: { fsPath: string },
      start: Position,
    ) {
      this.range = { start }
    }
  }
  let nextEditorBreakpointId = 0
  class SourceBreakpoint {
    readonly id = String(++nextEditorBreakpointId)
    constructor(readonly location: Location) {}
  }
  const editorBreakpoints: SourceBreakpoint[] = [],
    adapterReplies = new Map<SourceBreakpoint, DebugProtocol.Breakpoint>()
  let setBreakpointsSequence = 100,
    armedBreakpoints = 0
  /** Passes the editor's replacement of this source's breakpoints, and the adapter's reply to it, through the run's tracker. */
  const replaceSourceBreakpoints = (): void => {
    const sequence = ++setBreakpointsSequence
    tracker?.onWillReceiveMessage?.({
      type: 'request',
      seq: sequence,
      command: 'setBreakpoints',
      arguments: {
        source: { path: sourceFile },
        breakpoints: editorBreakpoints.map((breakpoint) => ({
          line: breakpoint.location.range.start.line + 1,
          column: breakpoint.location.range.start.character + 1,
        })),
      },
    })
    tracker?.onDidSendMessage?.({
      type: 'response',
      seq: sequence + 1_000,
      request_seq: sequence,
      command: 'setBreakpoints',
      success: true,
      body: {
        breakpoints: editorBreakpoints.map((breakpoint) =>
          adapterReplies.get(breakpoint)!,
        ),
      },
    })
  }
  class OutputTerminal {
    readonly terminal = { name: 'Codebook · Test output' }
    async ready(): Promise<void> {}
    write(): void {}
    reveal(): void {}
    dispose(): void {}
  }
  const editor = {
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    Position,
    Location,
    SourceBreakpoint,
    workspace: { getWorkspaceFolder: () => undefined },
    debug: {
      breakpoints: editorBreakpoints,
      addBreakpoints(added: SourceBreakpoint[]): void {
        calls.push('arm')
        for (const breakpoint of added) {
          const acknowledgement = acknowledgements![armedBreakpoints++]!
          adapterReplies.set(breakpoint, {
            id: OWNED_BREAKPOINT_ID,
            ...acknowledgement,
            ...(acknowledgement.verified ? {} : { reason: 'pending' }),
          })
          editorBreakpoints.push(breakpoint)
        }
        // Before the session exists the editor only keeps the breakpoint; it is sent when the adapter starts. Afterwards the editor sends the replacement once the caller has returned.
        if (tracker) queueMicrotask(replaceSourceBreakpoints)
      },
      removeBreakpoints(removed: SourceBreakpoint[]): void {
        calls.push('retire')
        for (const breakpoint of removed) {
          const index = editorBreakpoints.indexOf(breakpoint)
          if (index >= 0) editorBreakpoints.splice(index, 1)
        }
        if (tracker) queueMicrotask(replaceSourceBreakpoints)
      },
      registerDebugAdapterTrackerFactory(
        _type: string,
        factory: vscode.DebugAdapterTrackerFactory,
      ) {
        trackerFactory = factory
        return { dispose(): void {} }
      },
      onDidTerminateDebugSession: (
        listener: (session: vscode.DebugSession) => void,
      ) => {
        terminate = listener
        return { dispose(): void {} }
      },
      async startDebugging(
        _folder: unknown,
        configuration: vscode.DebugConfiguration,
      ) {
        // The run recognizes only sessions carrying its own configuration name.
        session.name = configuration.name
        session.configuration = {
          ...session.configuration,
          name: configuration.name,
        }
        const created = await trackerFactory?.createDebugAdapterTracker(session)
        tracker = created ?? undefined
        // The starting adapter receives the breakpoints the editor already holds.
        if (editorBreakpoints.length) replaceSourceBreakpoints()
        queueMicrotask(() => stopped('entry'))
        return true
      },
      async stopDebugging(): Promise<void> {
        calls.push('stop-debugging')
      },
    },
  }
  const trackerModule = acknowledgements
    ? await loadModule<{ OwnedRepositoryBreakpoint: unknown }>(
        resolve(__dirname, '../ownedRepositoryBreakpoint.js'),
        { vscode: editor },
      )
    : { OwnedRepositoryBreakpoint: Breakpoint }
  const module = await loadModule<typeof OwnedNodeTestRunModule>(
    resolve(__dirname, '../ownedNodeTestRun.js'),
    {
      vscode: editor,
      './constants': {
        ...constants,
        NODE_TEST_ATTACH_TIMEOUT_MS:
          budgetMs ?? constants.NODE_TEST_ATTACH_TIMEOUT_MS,
      },
      './ownedRepositoryBreakpoint': trackerModule,
      './nodeTestOutputTerminal': { NodeTestOutputTerminal: OutputTerminal },
      './utils/prepareNodeTestLaunch': {
        prepareNodeTestLaunch: async () => launch,
      },
      './utils/launchNodeTest': {
        launchNodeTest: async () => ({
          processGroup: 4242,
          inspectorEndpoint: async () => 'ws://127.0.0.1:9229/owned',
          elapsedMs: () => 10,
          async result() {
            calls.push('result')
            return {
              exitCode,
              signal: null,
              output:
                reportStatus === 'failed' ? 'Tests 1 failed' : 'Tests 1 passed',
            }
          },
          async waitForExit() {
            return exitAfterEntry ? { exitCode: 0, signal: null } : undefined
          },
          async close(): Promise<void> {},
        }),
      },
      './utils/verifyVitestTestResult': {
        verifyVitestTestResult: async (...request: unknown[]) => {
          calls.push('verify')
          verified.push(request)
          if (reportFailure) throw reportFailure
          return reportStatus
        },
      },
      './utils/bindOwnedNodeTestDebugSession': {
        bindOwnedNodeTestDebugSession: async (value: vscode.DebugSession) => ({
          session: value,
          identity: { pid: 1, processGroup: 4242, workspace: directory },
          cdp: { close(): void {} },
        }),
      },
      './utils/inspectNodeTestVariables': {
        inspectNodeTestVariables: async () => ({ variables: [], facts: [] }),
      },
      './utils/captureReplayDebugSnapshot': {
        captureReplayDebugSnapshot: async () => ({
          version: 1,
          frames: [],
          variables: [],
          limitations: [],
        }),
      },
    },
  )
  const configuration: NodeTestConfiguration = {
    version: 1,
    adapter: 'vitest-node',
    book: { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 0 },
    testFile: 'theme.test.ts',
    testTitles,
    testHash: sha256('test'),
    source,
    inspections: [],
  }
  const run = new module.OwnedNodeTestRun(
    directory,
    configuration,
    process.execPath,
    (type, detail) => {
      events.push({ type, detail })
    },
  )
  return {
    run,
    calls,
    verified,
    events,
    launch,
    reportDirectory,
    sourceFile,
    cleanup: async (): Promise<void> => {
      await rm(directory, { recursive: true, force: true })
      await rm(reportDirectory, { recursive: true, force: true })
    },
    // Another debugger control resumes the accepted source pause outside Codebook.
    resume: () =>
      tracker?.onDidSendMessage?.({
        type: 'event',
        event: 'continued',
        body: { threadId: 1 },
      }),
    // The learner steps in the native debugger: the editor sends `next` and the adapter reports the new pause without a `continued` event.
    stepToLaterPause: (): void => {
      clientRequest('next')
      stopped('step')
    },
    // The native debugger sends a resume request; adapters need not follow it with a `continued` event.
    requestResume: clientRequest,
    // js-debug refreshes the stack (e.g. Toggle Skipping this File) by re-announcing the same pause with no client resume request.
    refreshPause: (): void => {
      tracker?.onDidSendMessage?.({
        type: 'event',
        event: 'continued',
        body: { threadId: 1 },
      })
      stopped('breakpoint')
    },
    // Something outside the editor client moves the paused thread, so the stack reports another position.
    movePausedFrame: (line: number): void => {
      pausedLine = line
    },
    // The learner presses Continue at their own pause; the test then runs for `runningMs` before reaching Codebook's declared stop.
    learnerContinues: (runningMs = 0): void => {
      clientRequest('continue')
      pausedLine = observedLine
      pausedFile = sourceFile
      setTimeout(() => stopped('breakpoint', [OWNED_BREAKPOINT_ID]), runningMs)
    },
  }
}

test('continuing the final declared stop retires its owned breakpoint first so a repeated line cannot pause the finished test again', async () => {
  // Arrange
  const harness = await nodeRunHarness()
  try {
    await harness.run.prepare()
    harness.calls.length = 0

    // Act
    const result = await harness.run.complete()

    // Assert
    assert.deepEqual(harness.calls, ['retire', 'continue', 'result', 'verify'])
    assert.equal(result.exitCode, 0)
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('advancing to the next declared stop retires the captured breakpoint before arming and continuing to the next one', async () => {
  // Arrange
  const harness = await nodeRunHarness({ declaredStops: 2 })
  try {
    await harness.run.prepare()
    harness.calls.length = 0

    // Act
    const next = await harness.run.advance()

    // Assert
    assert.deepEqual(harness.calls, ['retire', 'arm', 'continue'])
    assert.equal(next.index, 1)
    assert.equal(harness.run.hasNextStop(), false)
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('a source pause resumed outside Codebook cannot advance and releases the owned test', async () => {
  // Arrange
  const harness = await nodeRunHarness({ declaredStops: 2 })
  try {
    await harness.run.prepare()
    harness.calls.length = 0

    // Act
    harness.resume()
    const advancing = harness.run.advance()

    // Assert
    await assert.rejects(advancing, /resumed before the next declared stop/)
    assert.deepEqual(harness.calls, ['remove', 'stop-debugging'])
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('a native stop at another line of the declared source fails preparation instead of recording the wrong position', async () => {
  // Arrange
  const harness = await nodeRunHarness({ observedLine: 2 })
  try {
    // Act
    const preparing = harness.run.prepare()

    // Assert
    await assert.rejects(preparing, /stopped at 2:14 instead of declared 1:14/)
    assert.deepEqual(harness.calls, [
      'arm',
      'continue',
      'remove',
      'stop-debugging',
    ])
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('finishing the test is refused while another declared source stop remains uncaptured', async () => {
  // Arrange
  const harness = await nodeRunHarness({ declaredStops: 2 })
  try {
    await harness.run.prepare()
    harness.calls.length = 0

    // Act
    const completing = harness.run.complete()

    // Assert
    await assert.rejects(completing, /no final owned source pause/)
    assert.deepEqual(harness.calls, [])
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('a final Codebook continue is refused after the learner stepped to a later pause, so it cannot resume that unaccepted pause', async () => {
  // Arrange
  const harness = await nodeRunHarness()
  try {
    await harness.run.prepare()
    harness.calls.length = 0
    harness.stepToLaterPause()

    // Act
    const completing = harness.run.complete()

    // Assert
    await assert.rejects(completing, /resumed before the final continuation/)
    assert.deepEqual(
      harness.calls,
      [],
      'neither the owned breakpoint nor the later pause is touched',
    )
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('a final Codebook continue is refused when the learner resumes while the owned breakpoint is being retired', async () => {
  // Arrange
  let requestResume = (_command: string): void => undefined
  const harness = await nodeRunHarness({
    duringRetire: () => requestResume('continue'),
  })
  requestResume = harness.requestResume
  try {
    await harness.run.prepare()
    harness.calls.length = 0

    // Act
    const completing = harness.run.complete()

    // Assert
    await assert.rejects(completing, /resumed before the final continuation/)
    assert.deepEqual(
      harness.calls,
      ['retire'],
      'the stale continue request is never sent',
    )
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('a native step request revokes the accepted pause before Codebook advances to the next declared stop', async () => {
  // Arrange
  const harness = await nodeRunHarness({ declaredStops: 2 })
  try {
    await harness.run.prepare()
    harness.calls.length = 0
    harness.requestResume('next')

    // Act
    const advancing = harness.run.advance()

    // Assert
    await assert.rejects(advancing, /resumed before the next declared stop/)
    assert.deepEqual(harness.calls, ['remove', 'stop-debugging'])
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('advancing refuses a stale Codebook continue when the learner resumes while the previous owned breakpoint is being retired', async () => {
  // Arrange
  let requestResume = (_command: string): void => undefined
  const harness = await nodeRunHarness({
    declaredStops: 2,
    duringRetire: () => requestResume('continue'),
  })
  requestResume = harness.requestResume
  try {
    await harness.run.prepare()
    harness.calls.length = 0

    // Act
    const advancing = harness.run.advance()

    // Assert
    await assert.rejects(advancing, /resumed before the next declared stop/)
    assert.equal(
      harness.calls.includes('continue'),
      false,
      'the stale continue request is never sent',
    )
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('advancing is refused after the learner stepped to a later pause, so it cannot resume that unaccepted pause', async () => {
  // Arrange
  const harness = await nodeRunHarness({ declaredStops: 2 })
  try {
    await harness.run.prepare()
    harness.calls.length = 0
    harness.stepToLaterPause()

    // Act
    const advancing = harness.run.advance()

    // Assert
    await assert.rejects(advancing, /resumed before the next declared stop/)
    assert.deepEqual(harness.calls, ['remove', 'stop-debugging'])
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('Codebook finishes a two-stop Node test even though its own continue requests pass through the pause-revoking tracker', async () => {
  // Arrange
  const harness = await nodeRunHarness({ declaredStops: 2 })
  try {
    await harness.run.prepare()
    harness.calls.length = 0

    // Act
    await harness.run.advance()
    const result = await harness.run.complete()

    // Assert
    assert.deepEqual(harness.calls, [
      'retire',
      'arm',
      'continue',
      'retire',
      'continue',
      'result',
      'verify',
    ])
    assert.equal(result.exitCode, 0)
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('a native stack refresh at the accepted pause (Toggle Skipping this File) still lets Codebook finish the test', async () => {
  // Arrange
  const harness = await nodeRunHarness()
  try {
    await harness.run.prepare()
    harness.calls.length = 0
    harness.refreshPause()

    // Act
    const result = await harness.run.complete()

    // Assert
    assert.deepEqual(harness.calls, ['retire', 'continue', 'result', 'verify'])
    assert.equal(result.exitCode, 0)
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('a native stack refresh while the previous owned breakpoint is being retired still lets Codebook advance to the next declared stop', async () => {
  // Arrange
  let refreshPause = (): void => undefined
  const harness = await nodeRunHarness({
    declaredStops: 2,
    duringRetire: () => refreshPause(),
  })
  refreshPause = harness.refreshPause
  try {
    await harness.run.prepare()
    harness.calls.length = 0

    // Act
    const next = await harness.run.advance()

    // Assert
    assert.deepEqual(harness.calls, ['retire', 'arm', 'continue'])
    assert.equal(next.index, 1)
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('a pause re-announced at another position without a client resume is refused, so Codebook never continues an unaccepted pause', async () => {
  // Arrange
  const harness = await nodeRunHarness()
  try {
    await harness.run.prepare()
    harness.calls.length = 0
    harness.movePausedFrame(5)
    harness.refreshPause()

    // Act
    const completing = harness.run.complete()

    // Assert
    await assert.rejects(completing, /resumed before the final continuation/)
    assert.equal(
      harness.calls.includes('continue'),
      false,
      'the unaccepted pause is never continued',
    )
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test("a finished run is checked against the cited test in Vitest's report before its result is returned", async () => {
  // Arrange
  const harness = await nodeRunHarness()
  try {
    await harness.run.prepare()

    // Act
    await harness.run.complete()

    // Assert
    assert.deepEqual(harness.verified, [
      [
        harness.launch.report.file,
        harness.launch.testFile,
        ['theme', 'loads the dark theme'],
      ],
    ])
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('a finished run whose Vitest report shows another executed test fails instead of returning a result', async () => {
  // Arrange
  const harness = await nodeRunHarness({
    reportFailure: new Error(
      'Vitest ran "theme > loads the light theme" instead of the cited test.',
    ),
  })
  try {
    await harness.run.prepare()

    // Act
    const completing = harness.run.complete()

    // Assert
    await assert.rejects(completing, /instead of the cited test/)
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('a failed cited assertion cannot return a successful result when a plugin resets the process exit code to zero', async () => {
  // Arrange
  const harness = await nodeRunHarness({ reportStatus: 'failed', exitCode: 0 })
  try {
    await harness.run.prepare()

    // Act
    const completing = harness.run.complete()

    // Assert
    await assert.rejects(completing, /cited test failed.*exit code 0/)
    assert.equal(
      harness.events.some((event) => event.type === 'node-test.result'),
      false,
      'a success-shaped result never reaches the history writer',
    )
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('a failed cited assertion with a failing process exit preserves its observed result for partial history', async () => {
  // Arrange
  const harness = await nodeRunHarness({ reportStatus: 'failed', exitCode: 1 })
  try {
    await harness.run.prepare()

    // Act
    const result = await harness.run.complete()

    // Assert
    assert.equal(result.exitCode, 1)
    assert.equal(result.signal, null)
    assert.equal(result.output, 'Tests 1 failed')
    assert.equal(
      harness.events.some((event) => event.type === 'node-test.result'),
      true,
    )
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('a cited test that ends before its first declared stop fails at once with the exit code and the testTitles hint', async () => {
  // Arrange
  const harness = await nodeRunHarness({ exitAfterEntry: true })
  try {
    const startedAt = performance.now()

    // Act
    const preparing = harness.run.prepare()

    // Assert
    await assert.rejects(
      preparing,
      /exited with code 0 before declared stop 1.*testTitles.*codebook:\/\/help\/node-test/s,
    )
    assert.ok(
      performance.now() - startedAt < 5_000,
      'the ended session fails the run instead of waiting for the attach deadline',
    )
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('releasing a run removes its private Vitest report folder', async () => {
  // Arrange
  const harness = await nodeRunHarness()
  await harness.run.prepare()

  // Act
  await harness.run.stop()

  // Assert
  await assert.rejects(stat(harness.reportDirectory), { code: 'ENOENT' })
  await harness.cleanup()
})

test('a learner breakpoint earlier in the declared source holds the run until the learner continues, without failing or being resumed by Codebook', async () => {
  // Arrange: the learner's own breakpoint on line 5 of the cited source pauses the test before Codebook's stop on line 1.
  const harness = await nodeRunHarness({
    firstPause: { line: 5, hitBreakpointIds: [LEARNER_BREAKPOINT_ID] },
  })
  try {
    // Act
    const preparing = harness.run.prepare()
    await waitUntil(
      () =>
        harness.events.some(
          (event) => event.type === 'node-test.learner-paused',
        ),
      'learner pause event',
      2_000,
    )
    harness.learnerContinues()
    const stop = await preparing

    // Assert
    assert.equal(stop.frame.line, 1)
    // Event details are created inside the loaded module's context, so compare their JSON form.
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          harness.events
            .filter((event) => event.type === 'node-test.learner-paused')
            .map((event) => event.detail),
        ),
      ),
      [
        {
          index: 0,
          path: 'theme.ts',
          line: 5,
          column: 14,
          reason: 'breakpoint',
        },
      ],
    )
    assert.equal(
      harness.calls.filter((call) => call === 'continue').length,
      1,
      'Codebook resumed only its own entry pause',
    )
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('a test held at a learner pause longer than the stop budget still reaches its declared stop after the learner continues', async () => {
  // Arrange: a 300 ms budget; a learner breakpoint in another file holds the test for 700 ms, then the test runs 150 ms more to the declared stop.
  const harness = await nodeRunHarness({
    budgetMs: 300,
    firstPause: {
      line: 3,
      file: 'helper.ts',
      hitBreakpointIds: [LEARNER_BREAKPOINT_ID],
    },
  })
  try {
    // Act
    const preparing = harness.run.prepare()
    await waitUntil(
      () =>
        harness.events.some(
          (event) => event.type === 'node-test.learner-paused',
        ),
      'learner pause event',
      2_000,
    )
    await new Promise((resolve) => setTimeout(resolve, 700))
    harness.learnerContinues(150)
    const stop = await preparing

    // Assert
    assert.equal(stop.frame.line, 1)
    assert.equal(
      harness.calls.filter((call) => call === 'continue').length,
      1,
      'Codebook never resumed the learner pause',
    )
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('a declared stop that a freely running test never reaches still fails at the stop budget', async () => {
  // Arrange
  const harness = await nodeRunHarness({ budgetMs: 300, neverReachStop: true })
  try {
    const startedAt = performance.now()

    // Act
    const preparing = harness.run.prepare()

    // Assert
    await assert.rejects(
      preparing,
      /Timed out waiting for checked Node source stop/,
    )
    assert.ok(
      performance.now() - startedAt < 5_000,
      'the running test is bounded by the stop budget',
    )
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test("Codebook's own breakpoint reported hit elsewhere in the declared source still fails at once as a moved stop", async () => {
  // Arrange: the adapter reports the owned breakpoint id for a pause on line 5 instead of the declared line 1.
  const harness = await nodeRunHarness({
    firstPause: { line: 5, hitBreakpointIds: [OWNED_BREAKPOINT_ID] },
  })
  try {
    // Act
    const preparing = harness.run.prepare()

    // Assert
    await assert.rejects(preparing, /stopped at 5:14 instead of declared 1:14/)
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

for (const acknowledged of ['verified', 'pending'] as const)
  test(`a Node test stop whose registration the debugger acknowledges as ${acknowledged} at another column is refused before the test continues`, async () => {
    // Arrange: the stop is declared at 1:14 and the adapter answers 1:1.
    const harness = await nodeRunHarness({
      acknowledgements: [
        { verified: acknowledged === 'verified', line: 1, column: 1 },
      ],
    })
    try {
      // Act / Assert
      await assert.rejects(
        harness.run.prepare(),
        /Selected adapter did not acknowledge the exact breakpoint registration/,
      )
      assert.equal(
        harness.calls.filter((call) => call === 'continue').length,
        0,
      )
    } finally {
      await harness.run.stop()
      await harness.cleanup()
    }
  })

test('a Node test stop whose pending registration names no column yet is accepted and reaches its declared stop', async () => {
  // Arrange: a lazily loaded module: the adapter acknowledges the breakpoint as pending without a position.
  const harness = await nodeRunHarness({
    acknowledgements: [{ verified: false }],
  })
  try {
    // Act
    const stop = await harness.run.prepare()
    // Assert
    assert.equal(stop.source.line, 1)
    assert.equal(stop.source.column, 14)
    assert.equal(harness.calls.filter((call) => call === 'continue').length, 1)
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

test('a second Node test stop acknowledged at another column is refused before the test continues past the first stop', async () => {
  // Arrange: the first stop is acknowledged at its declared 1:14; the next one, armed while the test is paused, is answered at 1:1.
  const harness = await nodeRunHarness({
    declaredStops: 2,
    acknowledgements: [
      { verified: true, line: 1, column: 14 },
      { verified: true, line: 1, column: 1 },
    ],
  })
  try {
    await harness.run.prepare()
    // Act / Assert
    await assert.rejects(
      harness.run.advance(),
      /Selected adapter did not acknowledge the exact breakpoint registration/,
    )
    // Only the continuation from the entry pause to the first stop was sent.
    assert.equal(harness.calls.filter((call) => call === 'continue').length, 1)
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

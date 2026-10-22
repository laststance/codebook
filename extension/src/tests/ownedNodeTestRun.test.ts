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
import type {
  ListVitestTestFilesRequest,
  VitestListingReleaseFailure,
} from '../utils/listVitestTestFiles'

import { loadModule } from './utils/loadModule'
import { sourceBreakpointRequest } from './utils/sourceBreakpointRequest'

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
 * @param options.adapterPauseAfterContinue - After each Codebook continue the debug adapter pauses for a breakpoint of its own and resumes it: no `stopped`, only the `continued` it announces for its own resume, before the next declared stop.
 * @param options.exitAfterEntry - The test process exits after the entry pause, as when Vitest skips the cited test.
 * @param options.reportFailure - Error the Vitest report check raises after the process finishes.
 * @param options.reportStatus - Actual assertion result reported by Vitest, independent of the process exit code.
 * @param options.exitCode - The process result, which a repository plugin can reset even after a failed assertion.
 * @param options.firstPause - A pause that is not Codebook's (a learner breakpoint, for example) reached before the first declared stop; `file` is relative to the test repository.
 * @param options.neverReachStop - The test keeps running after the entry pause without reaching a declared stop.
 * @param options.budgetMs - Replaces the 45 s per-phase budget so deadline behavior can be observed quickly.
 * @param options.acknowledgements - Uses the real breakpoint tracker instead of the stand-in: the adapter's registration reply for each owned breakpoint in the order they are armed, passed through the run's own tracker as the editor would send it.
 * @param options.listingNotReleased - The preparation asks the run for its Vitest listing, as the real one does, and the listing answers that its release failed with this report.
 * @param options.typedWhileRunning - The learner types this text into the cited source right after Codebook's continue request with this number (1 is the continue of the entry pause, 2 the first continuation of a declared stop), while the test runs to its next stop.
 * @param options.openDocumentText - The text the editor holds for the cited source `theme.ts` from the start, whose file and article text is `export const nextTheme = "dark";\n`; without it the editor has no document open until a test types into the source (`typeIntoCitedSource`).
 * @param options.closeFailures - How many first releases of the owned test process fail, each with "process group still running (close <n>)"; the later ones succeed.
 * @param options.stopFailures - How many first stops of a debug session the editor rejects, each with "the debug adapter did not answer the terminate request (stop <n>)", as when the adapter does not answer; the later ones resolve.
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
  adapterPauseAfterContinue,
  exitAfterEntry,
  reportFailure,
  reportStatus = 'passed',
  exitCode = 0,
  exitSignal = null,
  reportRead,
  firstPause,
  neverReachStop,
  budgetMs,
  acknowledgements,
  bindingReportedLater,
  bindingReadUnanswered,
  listingNotReleased,
  declaredColumn = 14,
  verifiedByNews,
  openDocumentText,
  typedWhileRunning,
  closeFailures = 0,
  stopFailures = 0,
  outputRefusesOnceClosed = false,
}: {
  declaredStops?: number
  observedLine?: number
  duringRetire?: () => void
  adapterPauseAfterContinue?: boolean
  exitAfterEntry?: boolean
  reportFailure?: Error
  reportStatus?: 'passed' | 'failed'
  exitCode?: number | null
  /** The signal that ended the test process, as the process's exit reports it. */
  exitSignal?: NodeJS.Signals | null
  /** Holds the check of Vitest's report until it settles, as a slow read of a large report would. */
  reportRead?: Promise<void>
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
  /** What the adapter answers when it is asked where an owned breakpoint is bound, after a pending registration reply. */
  bindingReportedLater?: { verified: boolean; line: number; column: number }
  /** The adapter never answers when it is asked where an owned breakpoint is bound. */
  bindingReadUnanswered?: boolean
  listingNotReleased?: VitestListingReleaseFailure
  /** One-based column every stop is declared at on line 1; at column 1 the editor's breakpoint has no column of its own. */
  declaredColumn?: number
  /** Where the adapter verifies a registration it answered as pending, by a `breakpoint` event with the reason `changed`, and when that news arrives. The editor stand-in then answers the binding from that news and, as VS Code and Cursor do, without its column for a breakpoint that has none of its own. Sent after the continuation, the news stands in for the stop: the bound place does not run. */
  verifiedByNews?: {
    line: number
    column?: number
    when:
      | 'after the reply'
      | 'at the binding read'
      | 'right after the binding read'
      | 'after the continuation'
  }
  openDocumentText?: string
  typedWhileRunning?: { continueRequest: number; text: string }
  closeFailures?: number
  stopFailures?: number
  /** The output terminal refuses a reveal or a write once the run released it or the learner closed it, as the real terminal does ("Owned Node test output terminal was closed."). */
  outputRefusesOnceClosed?: boolean
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
    column: declaredColumn,
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
    events: Array<{ type: string; detail: unknown }> = [],
    // What the run asked of the editor beside the configuration of each debug session it started.
    debugStartOptions: (vscode.DebugSessionOptions | undefined)[] = []
  // How often the run began to check and seal its test, the step that asks Vitest for its files: nothing of the test is listed, launched or attached before it.
  let launchPreparations = 0
  // The text the editor holds for the cited source, and the editor's open documents: the cited source's document once it has a text.
  let documentText = ''
  const textDocuments: Array<{
    uri: { scheme: string; fsPath: string }
    isDirty: boolean
    getText: () => string
  }> = []
  /** Opens the cited source's document with this text, or replaces its text, as a learner who types and does not save. */
  const typeIntoCitedSource = (text: string): void => {
    // The first typing opens the document; later typing only changes what it holds.
    if (!textDocuments.length)
      textDocuments.push({
        uri: { scheme: 'file', fsPath: sourceFile },
        isDirty: true,
        getText: () => documentText,
      })
    documentText = text
  }
  if (openDocumentText !== undefined) typeIntoCitedSource(openDocumentText)
  // How many continue requests Codebook has sent to the session.
  let continueRequests = 0
  // How many times the run asked to release its owned test process.
  let closeRequests = 0
  // How many times the run asked the editor to stop a debug session, and the sessions the editor still lists, as VS Code's debug model does.
  let stopRequests = 0
  // The id of the session each of those requests asks the editor to stop, in order.
  const stoppedSessionIds: string[] = []
  const listedSessions = new Set<string>()
  let trackerFactory: vscode.DebugAdapterTrackerFactory | undefined,
    tracker: vscode.DebugAdapterTracker | undefined,
    continued = 0,
    pausedLine = observedLine,
    pausedFile = sourceFile
  let terminate: ((session: vscode.DebugSession) => void) | undefined
  let bindingReadAsked = (): void => {}
  /** Settles when the run asks an adapter that does not answer where its owned breakpoint is bound. */
  const bindingReadStarted = new Promise<void>((resolve) => {
    bindingReadAsked = resolve
  })
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
    // The adapter knows only breakpoints the editor still holds; a retired one is answered as gone.
    getDebugProtocolBreakpoint: async (breakpoint: unknown) => {
      const kept = editorBreakpoints.find(
        (candidate) => candidate === breakpoint,
      )
      if (!kept) return undefined
      // An adapter that does not answer leaves the read open for as long as the caller waits.
      if (bindingReadUnanswered) {
        bindingReadAsked()
        return new Promise<never>(() => {})
      }
      // The adapter resolved the pending breakpoint between its reply and this read.
      if (verifiedByNews?.when === 'at the binding read') announceVerified()
      // The adapter resolves it only after this read was answered with the pending reply; the news reaches the run before the read's caller goes on.
      if (verifiedByNews?.when === 'right after the binding read') {
        queueMicrotask(announceVerified)
        return adapterReplies.get(kept)
      }
      const news = newsBindings.get(kept)
      if (!news) return bindingReportedLater
      // As VS Code and Cursor do: the editor drops the column of the adapter's news about a breakpoint that has no column of its own.
      const keepsColumn =
        kept.location.range.start.character > 0 && news.column !== undefined
      return {
        id: OWNED_BREAKPOINT_ID,
        verified: true,
        line: news.line,
        ...(keepsColumn ? { column: news.column } : {}),
      }
    },
    async customRequest(command: string): Promise<unknown> {
      // The editor passes Codebook's own requests through the same tracker as the learner's.
      clientRequest(command)
      if (command === 'continue') {
        calls.push('continue')
        // The test runs again: a learner who types now does so between the resume and the next stop.
        if (++continueRequests === typedWhileRunning?.continueRequest)
          typeIntoCitedSource(typedWhileRunning.text)
        // A cited test that Vitest skipped never reaches the source: its process exits and the owned session ends.
        if (exitAfterEntry) {
          queueMicrotask(() => terminate?.(session))
          return {}
        }
        if (neverReachStop) return {}
        // The module loads only now: the adapter verifies the pending breakpoint by news, at a place the test does not run.
        if (
          verifiedByNews?.when === 'after the continuation' &&
          hasPendingBreakpoint()
        ) {
          continued++
          queueMicrotask(announceVerified)
          return {}
        }
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
        // js-debug announces the resume of a pause it made for itself (module entry breakpoint, WebAssembly hook) and never a stop for it.
        if (adapterPauseAfterContinue)
          queueMicrotask(() =>
            tracker?.onDidSendMessage?.({
              type: 'event',
              event: 'continued',
              body: { threadId: 1 },
            }),
          )
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
    onEvent(): void {}
    refusedPlace(): undefined {
      return undefined
    }
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
    adapterReplies = new Map<SourceBreakpoint, DebugProtocol.Breakpoint>(),
    // Where the adapter's news verified a breakpoint it had answered as pending, by editor breakpoint.
    newsBindings = new Map<
      SourceBreakpoint,
      { line: number; column?: number }
    >()
  /** Tells whether the editor holds a breakpoint the adapter answered as pending and has sent no news about. */
  const hasPendingBreakpoint = (): boolean =>
    editorBreakpoints.some(
      (breakpoint) =>
        adapterReplies.get(breakpoint)?.verified === false &&
        !newsBindings.has(breakpoint),
    )
  /** Sends the adapter's `breakpoint` event for every breakpoint it answered as pending: verified at the place of `verifiedByNews`. The run's tracker reads it before the editor stand-in keeps it. */
  const announceVerified = (): void => {
    if (!verifiedByNews) return
    const { line, column } = verifiedByNews
    for (const breakpoint of editorBreakpoints) {
      if (adapterReplies.get(breakpoint)?.verified !== false) continue
      if (newsBindings.has(breakpoint)) continue
      newsBindings.set(breakpoint, { line, column })
      tracker?.onDidSendMessage?.({
        type: 'event',
        event: 'breakpoint',
        body: {
          reason: 'changed',
          breakpoint: {
            id: OWNED_BREAKPOINT_ID,
            verified: true,
            line,
            ...(column === undefined ? {} : { column }),
          },
        },
      })
    }
  }
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
        breakpoints: editorBreakpoints.map((breakpoint) =>
          sourceBreakpointRequest(breakpoint.location.range.start),
        ),
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
    // The adapter resolved the pending breakpoint right after it answered.
    if (verifiedByNews?.when === 'after the reply') announceVerified()
  }
  const outputSurfaces: { closeByLearner(): void }[] = []
  class OutputTerminal {
    readonly terminal = { name: 'Codebook · Test output' }
    private closed = false
    constructor(
      _runId: string,
      _editor: unknown,
      private readonly onUnexpectedClose?: () => void,
    ) {
      outputSurfaces.push(this)
    }
    async ready(): Promise<void> {}
    write(): void {
      this.refuseOnceClosed()
    }
    reveal(): void {
      this.refuseOnceClosed()
    }
    dispose(): void {
      this.closed = true
    }
    /** The learner closes the tab: the real terminal marks itself closed and tells the run, which aborts. */
    closeByLearner(): void {
      this.closed = true
      this.onUnexpectedClose?.()
    }
    private refuseOnceClosed(): void {
      if (outputRefusesOnceClosed && this.closed)
        throw new Error('Owned Node test output terminal was closed.')
    }
  }
  const editor = {
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    Position,
    Location,
    SourceBreakpoint,
    workspace: { getWorkspaceFolder: () => undefined, textDocuments },
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
        // A disposed factory is asked for no tracker of a session that starts later.
        return {
          dispose(): void {
            if (trackerFactory === factory) trackerFactory = undefined
          },
        }
      },
      onDidTerminateDebugSession: (
        listener: (session: vscode.DebugSession) => void,
      ) => {
        terminate = listener
        // A disposed listener hears of no later end of a session.
        return {
          dispose(): void {
            if (terminate === listener) terminate = undefined
          },
        }
      },
      async startDebugging(
        _folder: unknown,
        configuration: vscode.DebugConfiguration,
        startOptions?: vscode.DebugSessionOptions,
      ) {
        debugStartOptions.push(startOptions)
        // The run recognizes only sessions carrying its own configuration name.
        session.name = configuration.name
        session.configuration = {
          ...session.configuration,
          name: configuration.name,
        }
        listedSessions.add(session.id)
        const created = await trackerFactory?.createDebugAdapterTracker(session)
        tracker = created ?? undefined
        // The starting adapter receives the breakpoints the editor already holds.
        if (editorBreakpoints.length) replaceSourceBreakpoints()
        queueMicrotask(() => stopped('entry'))
        return true
      },
      async stopDebugging(stopped?: vscode.DebugSession): Promise<void> {
        calls.push('stop-debugging')
        stopRequests += 1
        stoppedSessionIds.push(stopped?.id ?? 'no session named')
        // As VS Code 1.120 to 1.142 answer for a session their debug model no longer lists; an ended session it still lists is stopped again without a refusal.
        if (stopped && !listedSessions.has(stopped.id))
          throw new Error('debug session not found')
        // The first stops fail as they do when the adapter does not answer.
        if (stopRequests <= stopFailures)
          throw new Error(
            `the debug adapter did not answer the terminate request (stop ${stopRequests})`,
          )
      },
    },
  }
  const trackerModule = acknowledgements
    ? await loadModule<{ OwnedRepositoryBreakpoint: unknown }>(
        resolve(__dirname, '../ownedRepositoryBreakpoint.js'),
        { vscode: editor },
      )
    : {
        OwnedRepositoryBreakpoint: Breakpoint,
        OwnedBreakpointMovedError: class extends Error {},
      }
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
        prepareNodeTestLaunch: async (
          _workspace: string,
          _configuration: NodeTestConfiguration,
          listTestFiles: (request: ListVitestTestFilesRequest) => unknown,
        ) => {
          launchPreparations += 1
          // Only a test of the listing's release asks for the listing; every other test gets its launch at once.
          if (listingNotReleased)
            await listTestFiles({
              program: 'vitest',
              workspace: directory,
              filter: 'theme.test.ts',
              excludes: [],
            })
          return launch
        },
      },
      './utils/listVitestTestFiles': {
        listVitestTestFiles: async (request: {
          onReleaseFailed?: (failure: VitestListingReleaseFailure) => void
        }) => {
          if (listingNotReleased) request.onReleaseFailed?.(listingNotReleased)
          return []
        },
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
              signal: exitSignal,
              output:
                reportStatus === 'failed' ? 'Tests 1 failed' : 'Tests 1 passed',
            }
          },
          async waitForExit() {
            return exitAfterEntry ? { exitCode: 0, signal: null } : undefined
          },
          async close(): Promise<void> {
            closeRequests += 1
            // The first releases fail as a process group that outlives its signal would.
            if (closeRequests <= closeFailures)
              throw new Error(
                `process group still running (close ${closeRequests})`,
              )
          },
        }),
      },
      './utils/verifyVitestTestResult': {
        verifyVitestTestResult: async (...request: unknown[]) => {
          calls.push('verify')
          verified.push(request)
          await reportRead
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
    [{ path: 'theme.ts', hash: source.hash, text: sourceText, lineCount: 2 }],
  )
  return {
    run,
    calls,
    verified,
    /** The learner closes the run's test output tab. */
    closeOutputAsLearner: (): void => outputSurfaces.at(-1)?.closeByLearner(),
    events,
    debugStartOptions,
    launchPreparations: (): number => launchPreparations,
    closeRequests: (): number => closeRequests,
    stopRequests: (): number => stopRequests,
    /** The ids of the sessions the run asked the editor to stop, one entry for each request, in order. */
    stoppedSessionIds: (): string[] => [...stoppedSessionIds],
    /** The owned debug session ends, and the editor drops it from its list, as VS Code does when a newer session of the same name starts: a listener still registered hears of the end, and a later stop of the session is refused with "debug session not found". */
    endSessionAndDropIt: (): void => {
      terminate?.(session)
      listedSessions.delete(session.id)
    },
    /** A child debug session of the owned one starts (js-debug starts one for each worker or child process), and the editor lists it; only a factory still registered hears of it. */
    startChildSession: async (): Promise<void> => {
      const child = {
        ...session,
        id: 'owned-node-child-session',
        parentSession: session,
      }
      listedSessions.add(child.id)
      await trackerFactory?.createDebugAdapterTracker(child)
    },
    typeIntoCitedSource,
    launch,
    reportDirectory,
    sourceFile,
    bindingReadStarted,
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

// Cycle 0044 (0042-ER-limit2): the inspection the review left open. The Node path reads only the debugger's DAP events, where the adapter's own pause shows as one extra `continued` before the next stop; that `continued` finds no accepted pause and drops none.
test('a pause the debugger makes for itself and resumes between two declared Node stops keeps both stops and the test finishes', async () => {
  // Arrange
  const harness = await nodeRunHarness({
    declaredStops: 2,
    adapterPauseAfterContinue: true,
  })
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

// Value: protects=the result of a test that a signal ended after its last stop, kept although Vitest wrote no report, with the report's problem beside it; fails_when=complete() throws before it returns the exit facts, so the run records no result and no verdict; why_new=verifyVitestTestResult throws on a missing report and complete() threw with it (EN5, AC19); seam=the owned launch and the report check are fakes; no_claim=how real Vitest behaves under each signal
test('a test that a signal ended after its last stop keeps its result and names the missing report beside it', async () => {
  // Arrange
  const harness = await nodeRunHarness({
    exitCode: null,
    exitSignal: 'SIGTERM',
    reportFailure: new Error(
      'Vitest wrote no test report, so Codebook cannot confirm that the cited test ran.',
    ),
  })
  try {
    await harness.run.prepare()

    // Act
    const result = await harness.run.complete()

    // Assert
    assert.equal(result.exitCode, null)
    assert.equal(result.signal, 'SIGTERM')
    assert.equal(
      result.reportFailure,
      'Vitest wrote no test report, so Codebook cannot confirm that the cited test ran.',
    )
    assert.equal(
      harness.events.some((event) => event.type === 'node-test.result'),
      true,
    )
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

// Value: protects=a failing exit kept with its report's problem; fails_when=a non-zero exit whose report is missing loses its exit code; why_new=the same branch as the signal, for an exit code (EN5); seam=the owned launch and the report check are fakes; no_claim=none beyond protects
test('a test that exited with a failing code keeps its result when its report is missing', async () => {
  // Arrange
  const harness = await nodeRunHarness({
    exitCode: 1,
    reportFailure: new Error('Vitest wrote an unreadable test report.'),
  })
  try {
    await harness.run.prepare()

    // Act
    const result = await harness.run.complete()

    // Assert
    assert.equal(result.exitCode, 1)
    assert.equal(
      result.reportFailure,
      'Vitest wrote an unreadable test report.',
    )
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

// Value: protects=that an exit 0 without a report confirming the cited test returns no result; fails_when=a passing-shaped result reaches the history although nothing confirmed that the cited test ran; why_new=the exit-facts branch must not cover a passing exit (EN5); seam=the owned launch and the report check are fakes; no_claim=none beyond protects
test('an exit 0 whose report is missing returns no result', async () => {
  // Arrange
  const harness = await nodeRunHarness({
    reportFailure: new Error(
      'Vitest wrote no test report, so Codebook cannot confirm that the cited test ran.',
    ),
  })
  try {
    await harness.run.prepare()

    // Act
    const completing = harness.run.complete()

    // Assert
    await assert.rejects(completing, /Vitest wrote no test report/)
    assert.equal(
      harness.events.some((event) => event.type === 'node-test.result'),
      false,
    )
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

// Value: protects=the private Vitest report while the result check reads it; fails_when=a stop removes the report folder during the check, so the check reports a missing report for a test that passed; why_new=releaseOwned removed the report at once (ownedNodeTestRun.ts:907, EN5, AC19); seam=the report check is held by the test; no_claim=the service's seal (service tests)
test('a stop while the report is being checked removes the report only after the check read it', async () => {
  // Arrange
  let finishRead!: () => void
  const reportRead = new Promise<void>((resolve) => {
    finishRead = resolve
  })
  const harness = await nodeRunHarness({ reportRead })
  try {
    await harness.run.prepare()
    await writeFile(harness.launch.report.file, '{}')
    const completing = harness.run.complete()
    await waitUntil(
      () => harness.calls.includes('verify'),
      'the report check',
      1_000,
    )

    // Act
    const stopping = harness.run.stop()
    await new Promise((resolve) => setTimeout(resolve, 20))
    const reportKeptDuringCheck = await stat(harness.launch.report.file).then(
      () => true,
      () => false,
    )
    finishRead()
    const result = await completing
    await stopping

    // Assert
    assert.equal(reportKeptDuringCheck, true)
    assert.equal(result.exitCode, 0)
    assert.equal(
      await stat(harness.launch.report.file).then(
        () => true,
        () => false,
      ),
      false,
    )
  } finally {
    finishRead()
    await harness.run.stop()
    await harness.cleanup()
  }
})

// Value: protects=a passing test's result when a stop lands while the final continuation checks Vitest's report: the result is returned although the stop disposed the output terminal; fails_when=the end of the check reveals the terminal the stop disposed, so the continuation fails and the run seals partial without its result; why_new=the stop-during-check test's terminal stand-in reveals after its release, and the real terminal refuses (Step 9 pass 2 red team, EN5, AC19); seam=the report check is held by the test; no_claim=the service's seal (service tests) and VS Code's terminal
test('a stop while the report is being checked keeps the passing result although it released the output terminal', async () => {
  // Arrange
  let finishRead!: () => void
  const reportRead = new Promise<void>((resolve) => {
    finishRead = resolve
  })
  const harness = await nodeRunHarness({
    reportRead,
    outputRefusesOnceClosed: true,
  })
  try {
    await harness.run.prepare()
    await writeFile(harness.launch.report.file, '{}')
    const completing = harness.run.complete()
    await waitUntil(
      () => harness.calls.includes('verify'),
      'the report check',
      1_000,
    )

    // Act
    const stopping = harness.run.stop()
    finishRead()
    const outcome = await completing.then(
      (result) => result.exitCode,
      (error: unknown) => (error instanceof Error ? error.message : 'failed'),
    )
    await stopping

    // Assert
    assert.equal(outcome, 0)
  } finally {
    finishRead()
    await harness.run.stop()
    await harness.cleanup()
  }
})

// Value: protects=a passing test's result when the learner closes the test output tab while the final continuation checks Vitest's report: the result is returned although the closed tab aborted the run; fails_when=the end of the check reveals the tab the learner closed, so the continuation fails and the run seals partial without its result; why_new=the stop-during-check test closes the tab by a release only, and a learner's close aborts the run without one (Step 9 pass 3 red team, the sibling of F62); seam=the report check is held by the test; no_claim=VS Code's terminal (a stand-in that refuses a reveal once closed)
test('closing the test output tab while the report is being checked keeps the passing result', async () => {
  // Arrange
  let finishRead!: () => void
  const reportRead = new Promise<void>((resolve) => {
    finishRead = resolve
  })
  const harness = await nodeRunHarness({
    reportRead,
    outputRefusesOnceClosed: true,
  })
  try {
    await harness.run.prepare()
    await writeFile(harness.launch.report.file, '{}')
    const completing = harness.run.complete()
    await waitUntil(
      () => harness.calls.includes('verify'),
      'the report check',
      1_000,
    )

    // Act
    harness.closeOutputAsLearner()
    finishRead()
    const outcome = await completing.then(
      (result) => result.exitCode,
      (error: unknown) => (error instanceof Error ? error.message : 'failed'),
    )

    // Assert
    assert.equal(outcome, 0)
  } finally {
    finishRead()
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

// Cycle 0045 (AD-12, C-L2): red while a failed release of the listing reached nobody.
test('a Vitest listing whose process group could not be released is journaled by the run with the group, the folder it left and the reason', async () => {
  // Arrange
  const harness = await nodeRunHarness({
    listingNotReleased: {
      processGroup: 4141,
      directory: '/tmp/codebook-vitest-list-left',
      reason: 'Error: Timed out waiting for Vitest listing process group exit',
    },
  })
  try {
    // Act
    await harness.run.prepare()
    // Assert
    assert.deepEqual(
      harness.events.filter(
        (event) => event.type === 'node-test.vitest-listing-not-released',
      ),
      [
        {
          type: 'node-test.vitest-listing-not-released',
          detail: {
            processGroup: 4141,
            directory: '/tmp/codebook-vitest-list-left',
            reason:
              'Error: Timed out waiting for Vitest listing process group exit',
          },
        },
      ],
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

// Value: protects=a Node test run whose release failed once (its process group outlived the signal) being released by the next stop, so the service can mark the run stopped and admit the next codebook_start; fails_when=the run keeps the rejected release and answers every later stop with it without asking the process again, so the run is never stopped and every codebook_start answers BUSY until a reload; why_new=Cycle 0047 row 40 (P3RT18); seam=the owned test process's close, which fails the first time; no_claim=a real process group that outlives SIGKILL
test('a Node test run whose release failed once is released by the next stop, which asks the test process again', async () => {
  // Arrange: the first release of the owned test process fails.
  const harness = await nodeRunHarness({ closeFailures: 1 })
  try {
    await harness.run.prepare()
    const firstStop = await harness.run.stop().then(
      () => 'released',
      (error: unknown) => String(error),
    )

    // Act
    const secondStop = await harness.run.stop().then(
      () => 'released',
      (error: unknown) => String(error),
    )

    // Assert
    assert.deepEqual(
      { firstStop, secondStop, closeRequests: harness.closeRequests() },
      {
        firstStop: 'Error: process group still running (close 1)',
        secondStop: 'released',
        closeRequests: 2,
      },
    )
  } finally {
    await harness.cleanup()
  }
})

// Value: protects=the owned test's pause after a release that failed: the run is being released, and nothing resumes, steps or re-arms the test the service is about to stop; fails_when=advance() runs after a failed release, which retires the captured breakpoint, arms the next one and continues the test while its release waits to be run again (row 40's guard dropped); why_new=Cycle 0047 row 95 (TEST-2): the guard of row 40 had no test that a refused continuation stays refused; seam=the owned test process's close, which fails the first time
test('after a failed release of a Node test run, Codebook refuses to advance it to its next declared stop and arms, retires and continues nothing', async () => {
  // Arrange: a run with a next declared stop, whose first release of the owned test process fails.
  const harness = await nodeRunHarness({ declaredStops: 2, closeFailures: 1 })
  try {
    await harness.run.prepare()
    const failedRelease = await harness.run.stop().then(
      () => 'released',
      (error: unknown) => String(error),
    )
    const callsBefore = harness.calls.length

    // Act
    const advance = await harness.run.advance().then(
      () => 'advanced',
      (error: unknown) => String(error),
    )

    // Assert
    assert.deepEqual(
      {
        failedRelease,
        advance,
        callsAfterTheRelease: harness.calls.slice(callsBefore),
      },
      {
        failedRelease: 'Error: process group still running (close 1)',
        advance:
          'Error: Node test has no next declared source stop to capture.',
        callsAfterTheRelease: [],
      },
    )
  } finally {
    await harness.run.stop().catch(() => undefined)
    await harness.cleanup()
  }
})

// Value: protects=the owned test's final pause after a release that failed: the run is being released, and Codebook does not continue the test to its end and check its result while its release waits to be run again; fails_when=complete() runs after a failed release and fails with the abort of the release ("This operation was aborted") instead of its refusal, or continues the paused test (row 40's guard dropped); why_new=Cycle 0047 row 95 (TEST-2): the guard of row 40 had no test that a refused finish stays refused; seam=the owned test process's close, which fails the first time
test('after a failed release of a Node test run, Codebook refuses to finish it and continues nothing', async () => {
  // Arrange: a run at its last declared stop, whose first release of the owned test process fails.
  const harness = await nodeRunHarness({ declaredStops: 1, closeFailures: 1 })
  try {
    await harness.run.prepare()
    const failedRelease = await harness.run.stop().then(
      () => 'released',
      (error: unknown) => String(error),
    )
    const callsBefore = harness.calls.length

    // Act
    const finish = await harness.run.complete().then(
      () => 'finished',
      (error: unknown) => String(error),
    )

    // Assert
    assert.deepEqual(
      {
        failedRelease,
        finish,
        callsAfterTheRelease: harness.calls.slice(callsBefore),
      },
      {
        failedRelease: 'Error: process group still running (close 1)',
        finish: 'Error: Node test has no final owned source pause to continue.',
        callsAfterTheRelease: [],
      },
    )
  } finally {
    await harness.run.stop().catch(() => undefined)
    await harness.cleanup()
  }
})

// Value: protects=the release of a Node test run whose first release failed at the owned test process after its debug session was stopped, when that session then ends and the editor drops it (VS Code 1.120 to 1.142 drop an ended session when a newer session of its name starts); fails_when=the retry stops every session the first attempt stopped again, the editor refuses the one it no longer lists with "debug session not found", every retry fails, and every codebook_start answers BUSY until a reload (row 40 back); why_new=Cycle 0047 row 96 (ADV-4 = CORE-4); seam=the editor's stop of a debug session, which refuses a session it no longer lists, and the owned test process's close, which fails the first time
test('a Node test run whose release failed at its test process after its debug session was stopped is released by the next stop without stopping that session again, after the editor dropped it', async () => {
  // Arrange: the first release stops the session and then fails at the owned test process; the session then ends and the editor drops it.
  const harness = await nodeRunHarness({ closeFailures: 1 })
  try {
    await harness.run.prepare()
    const firstStop = await harness.run.stop().then(
      () => 'released',
      (error: unknown) => String(error),
    )
    harness.endSessionAndDropIt()

    // Act
    const secondStop = await harness.run.stop().then(
      () => 'released',
      (error: unknown) => String(error),
    )

    // Assert
    assert.deepEqual(
      {
        firstStop,
        secondStop,
        stopRequests: harness.stopRequests(),
        closeRequests: harness.closeRequests(),
      },
      {
        firstStop: 'Error: process group still running (close 1)',
        secondStop: 'released',
        stopRequests: 1,
        closeRequests: 2,
      },
    )
  } finally {
    await harness.cleanup()
  }
})

// Value: protects=the release of a Node test run whose debug session the editor could not stop at the first release (the adapter did not answer), when that session ends afterwards and the editor drops it; fails_when=the run stops watching for ended sessions at its first failed release, so the retry stops the ended session, the editor refuses it with "debug session not found", every retry fails, and every codebook_start answers BUSY until a reload (row 40 back); why_new=Cycle 0047 row 96 (ADV-4 = CORE-4); seam=the editor's stop of a debug session, which fails the first time and refuses a session it no longer lists, and its end of the session, which reaches only a listener still registered
test('a Node test run whose debug session could not be stopped at the first release, and which ends afterwards, is released by the next stop without stopping the ended session', async () => {
  // Arrange: the first release cannot stop the session; the session then ends and the editor drops it.
  const harness = await nodeRunHarness({ stopFailures: 1 })
  try {
    await harness.run.prepare()
    const firstStop = await harness.run.stop().then(
      () => 'released',
      (error: unknown) => String(error),
    )
    harness.endSessionAndDropIt()

    // Act
    const secondStop = await harness.run.stop().then(
      () => 'released',
      (error: unknown) => String(error),
    )

    // Assert
    assert.deepEqual(
      {
        firstStop,
        secondStop,
        stopRequests: harness.stopRequests(),
        closeRequests: harness.closeRequests(),
      },
      {
        firstStop:
          'Error: the debug adapter did not answer the terminate request (stop 1)',
        secondStop: 'released',
        stopRequests: 1,
        closeRequests: 2,
      },
    )
  } finally {
    await harness.cleanup()
  }
})

// Value: protects=the release of a Node test run whose first release failed at the owned test process while that process still ran and started a child debug session afterwards (js-debug starts one for each child process); fails_when=the run stops hearing of new debug sessions at its first failed release, so the retry cannot stop the child session, which keeps running under the debugger after the run is reported released; why_new=Cycle 0048 task 23 (S11-N17c); seam=the editor's debug adapter tracker factory, which hears of a new session only while it is registered, and the owned test process's close, which fails the first time; no_claim=a real js-debug child session
test('a Node test run whose release failed at its test process stops a child debug session that started after the failure at the next stop', async () => {
  // Arrange: the first release fails at the owned test process; the process then starts a child debug session.
  const harness = await nodeRunHarness({ closeFailures: 1 })
  try {
    await harness.run.prepare()
    const firstStop = await harness.run.stop().then(
      () => 'released',
      (error: unknown) => String(error),
    )
    await harness.startChildSession()

    // Act
    const secondStop = await harness.run.stop().then(
      () => 'released',
      (error: unknown) => String(error),
    )

    // Assert: the first stop asked for the owned session; the second asked for the owned one again (its release failed) and for the child session that started later, by its id.
    assert.deepEqual(
      {
        firstStop,
        secondStop,
        stopRequests: harness.stopRequests(),
        stoppedSessionIds: harness.stoppedSessionIds(),
      },
      {
        firstStop: 'Error: process group still running (close 1)',
        secondStop: 'released',
        stopRequests: 3,
        stoppedSessionIds: [
          'owned-node-session',
          'owned-node-session',
          'owned-node-child-session',
        ],
      },
    )
  } finally {
    await harness.cleanup()
  }
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
        /Selected adapter did not acknowledge the breakpoint registration/,
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

// Value: protects=a second Node test stop that the adapter first answers as pending and then binds at another column; fails_when=the pending reply is taken as accepted and the other column is found only at the pause, one resume later; why_new=Cycle 0037 D6; seam=the fake session answers getDebugProtocolBreakpoint
test('a second Node test stop answered as pending and then bound at another column is refused before the test continues, naming both positions', async () => {
  // Arrange: the first stop is acknowledged at its declared 1:14; the next one is answered pending without a position and is bound at 1:1.
  const harness = await nodeRunHarness({
    declaredStops: 2,
    acknowledgements: [
      { verified: true, line: 1, column: 14 },
      { verified: false },
    ],
    bindingReportedLater: { verified: true, line: 1, column: 1 },
  })
  try {
    await harness.run.prepare()

    // Act
    const refusal = await harness.run.advance().then(
      () => 'advanced',
      (error: unknown) => String(error),
    )

    // Assert
    assert.equal(
      refusal,
      'Error: Declared breakpoint 1:14 is bound at 1:1; this stop is captured at its declared position, so declare 1:1 or another statement.',
    )
    // Only the continuation from the entry pause to the first stop was sent.
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
      /Selected adapter did not acknowledge the breakpoint registration/,
    )
    // Only the continuation from the entry pause to the first stop was sent.
    assert.equal(harness.calls.filter((call) => call === 'continue').length, 1)
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

// Cycle 0045 (CR-7): red while the read of the next stop's bound place took no cancellation: an adapter that never answered it held the continuation after the run was stopped.
test('a run cancelled while the adapter does not answer the breakpoint read ends at once', async () => {
  // Arrange: the first stop is acknowledged at its declared 1:14; the next one is answered pending, and the adapter never says where it is bound.
  const harness = await nodeRunHarness({
    declaredStops: 2,
    acknowledgements: [
      { verified: true, line: 1, column: 14 },
      { verified: false },
    ],
    bindingReadUnanswered: true,
  })
  try {
    await harness.run.prepare()
    const advancing = harness.run.advance().then(
      () => 'advanced',
      (error: unknown) => String(error),
    )
    // Bounded: a run that never asks where its breakpoint is bound fails this test instead of hanging the file.
    let hasBindingReadStarted = false
    void harness.bindingReadStarted.then(() => {
      hasBindingReadStarted = true
    })
    await waitUntil(
      () => hasBindingReadStarted,
      'the run’s read of its pending breakpoint’s binding',
      2_000,
    )

    // Act
    await harness.run.stop()
    const outcome = await Promise.race([
      advancing,
      new Promise<string>((resolve) =>
        setTimeout(() => resolve('still waiting for the adapter'), 1_000),
      ),
    ])

    // Assert
    assert.equal(outcome, 'Error: Cancelled owned breakpoint binding')
    // Only the continuation from the entry pause to the first stop was sent.
    assert.equal(harness.calls.filter((call) => call === 'continue').length, 1)
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

for (const when of [
  'after the reply',
  'at the binding read',
  'right after the binding read',
] as const)
  // Cycle 0046 (row 130): red while the read of a binding had to name its column and the adapter's news never reached the owned breakpoint: both editors drop the column from the news about a breakpoint requested at column 1, so nothing was refused and the test was resumed towards a stop that could not be captured at its declared position.
  test(`a second Node test stop declared at column 1 that the adapter answers as pending and verifies by news at another column ${when} is refused before the test continues, naming both positions`, async () => {
    // Arrange: both stops are declared at 1:1. The first is acknowledged there; the next one is answered pending and then verified by news at 1:14, and the editor answers its binding without a column.
    const harness = await nodeRunHarness({
      declaredStops: 2,
      declaredColumn: 1,
      acknowledgements: [
        { verified: true, line: 1, column: 1 },
        { verified: false },
      ],
      verifiedByNews: { line: 1, column: 14, when },
    })
    try {
      await harness.run.prepare()

      // Act
      const refusal = await harness.run.advance().then(
        () => 'advanced',
        (error: unknown) => String(error),
      )

      // Assert
      assert.equal(
        refusal,
        'Error: Declared breakpoint 1:1 is bound at 1:14; this stop is captured at its declared position, so declare 1:14 or another statement.',
      )
      // Only the continuation from the entry pause to the first stop was sent.
      assert.equal(
        harness.calls.filter((call) => call === 'continue').length,
        1,
      )
    } finally {
      await harness.run.stop()
      await harness.cleanup()
    }
  })

// Cycle 0046 (row 130): without a column from the editor or from the adapter, the line decides. Red while a binding without a column decided nothing, also on another line.
test('a second Node test stop declared at column 1 whose news names another line and no column is refused before the test continues, naming that line', async () => {
  // Arrange: the next stop is answered pending and then verified by news that names line 2 and no column.
  const harness = await nodeRunHarness({
    declaredStops: 2,
    declaredColumn: 1,
    acknowledgements: [
      { verified: true, line: 1, column: 1 },
      { verified: false },
    ],
    verifiedByNews: { line: 2, when: 'at the binding read' },
  })
  try {
    await harness.run.prepare()

    // Act
    const refusal = await harness.run.advance().then(
      () => 'advanced',
      (error: unknown) => String(error),
    )

    // Assert
    assert.equal(
      refusal,
      'Error: Declared breakpoint 1:1 is bound on line 2; this stop is captured at its declared position, so declare a statement of line 2 or another statement.',
    )
    assert.equal(harness.calls.filter((call) => call === 'continue').length, 1)
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

// Cycle 0046 (row 130): a verified binding on the declared line that names no column names no other column either, so it refuses nothing and the stop's pause is checked at the declared position as before; red if a missing column were read as another column.
test('a second Node test stop declared at column 1 whose news names its declared line and no column is not refused for it and is captured at its pause', async () => {
  // Arrange: the next stop is answered pending and then verified by news that names line 1 and no column; the test then pauses at 1:1.
  const harness = await nodeRunHarness({
    declaredStops: 2,
    declaredColumn: 1,
    acknowledgements: [
      { verified: true, line: 1, column: 1 },
      { verified: false },
    ],
    verifiedByNews: { line: 1, when: 'at the binding read' },
  })
  try {
    await harness.run.prepare()

    // Act
    const next = await harness.run.advance()

    // Assert
    assert.deepEqual(
      [next.index, next.source.line, next.source.column],
      [1, 1, 1],
    )
    assert.equal(harness.calls.filter((call) => call === 'continue').length, 2)
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

// Cycle 0046 (row 130): news that arrives only after the test was resumed ends the wait for the stop at once; red while the adapter's news never reached the owned breakpoint, so a stop bound where the test does not run ended as "Timed out waiting for checked Node source stop".
test('a second Node test stop that the adapter verifies by news at another column after the test was resumed ends the wait for it with the refusal, not with the timeout', async () => {
  // Arrange: the next stop is answered pending and stays so until the test is resumed; then the adapter verifies it at 1:14, which the test does not run. The stop's budget is 300 ms.
  const harness = await nodeRunHarness({
    declaredStops: 2,
    declaredColumn: 1,
    budgetMs: 300,
    acknowledgements: [
      { verified: true, line: 1, column: 1 },
      { verified: false },
    ],
    verifiedByNews: { line: 1, column: 14, when: 'after the continuation' },
  })
  try {
    await harness.run.prepare()

    // Act
    const refusal = await harness.run.advance().then(
      () => 'advanced',
      (error: unknown) => String(error),
    )

    // Assert
    assert.equal(
      refusal,
      'Error: Declared breakpoint 1:1 is bound at 1:14; this stop is captured at its declared position, so declare 1:14 or another statement.',
    )
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

// Cycle 0046 (row 314): red while the run attached to its test process without the option, so the editor saved every modified editor of the learner when a chat request started a test.
test('a Node test run attaches its debugger without making the editor save the learner’s unsaved documents', async () => {
  // Arrange
  const harness = await nodeRunHarness()
  try {
    // Act
    await harness.run.prepare()

    // Assert: one session was started, and it was told not to save.
    assert.deepEqual(
      harness.debugStartOptions.map(
        (startOptions) => startOptions?.suppressSaveBeforeStart,
      ),
      [true],
    )
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

// Cycle 0046 (row 314): red while a Node test run never looked at the editor's documents: the test ran the saved file while the editor's debugger showed the unsaved lines at its pause.
test('a Node test run whose cited source is open in the editor with other text than the article cites is refused before the test is listed, launched or attached, naming the file and what the learner and the agent do', async () => {
  // Arrange
  const harness = await nodeRunHarness({
    openDocumentText: 'export const nextTheme = "light";\n',
  })
  try {
    // Act
    const refusal: unknown = await harness.run
      .prepare()
      .catch((error: unknown) => error)

    // Assert
    assert.deepEqual(
      refusal instanceof Error && 'code' in refusal
        ? { code: refusal.code, message: refusal.message }
        : refusal,
      {
        code: 'SOURCE_CHANGED',
        message:
          'The cited source theme.ts is open in the editor with text that differs from the text the article cites, and Codebook neither saves nor reverts a document of the learner. Ask the learner to save or revert the file: after a save read the source again and publish the article again, after a revert change nothing; then start a new run.',
      },
    )
    assert.equal(harness.launchPreparations(), 0)
    assert.equal(harness.debugStartOptions.length, 0)
    assert.deepEqual(harness.events, [])
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

// Cycle 0046 (row 314): the guard of the refusal above. A document the editor marks as modified while it holds the cited text (here with a byte order mark and other line ends) is no other text.
test('a Node test run whose cited source is marked as modified in the editor with the text the article cites, in other line ends, reaches its declared stop', async () => {
  // Arrange
  const harness = await nodeRunHarness({
    openDocumentText: '\uFEFFexport const nextTheme = "dark";\r\n',
  })
  try {
    // Act
    const firstStop = await harness.run.prepare()

    // Assert
    assert.equal(firstStop.index, 0)
    assert.equal(harness.launchPreparations(), 1)
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

// Cycle 0046 (row 322): red while a Node test run compared the editor's documents at its start only: after a change the learner did not save, the next stop was captured although the editor's debugger marked a line of the unsaved text, not the line the test executed. Since row 324 a change made before the continuation ends the run before the resume (the next test), so this one types after the resume.
test('a Node test run whose cited source the learner changes in the editor without saving while the test runs to its next stop ends at that stop with the sentence that names the file, and that stop is not captured', async () => {
  // Arrange: the learner types right after the continuation of the first stop was requested.
  const harness = await nodeRunHarness({
    declaredStops: 2,
    typedWhileRunning: {
      continueRequest: 2,
      text: '// a line the learner typed\nexport const nextTheme = "dark";\n',
    },
  })
  try {
    await harness.run.prepare()
    harness.calls.length = 0

    // Act
    const refusal: unknown = await harness.run
      .advance()
      .catch((error: unknown) => error)

    // Assert
    assert.deepEqual(
      refusal instanceof Error && 'code' in refusal
        ? { code: refusal.code, message: refusal.message }
        : refusal,
      {
        code: 'SOURCE_CHANGED',
        message:
          'The cited source theme.ts is open in the editor with text that differs from the text the article cites, and Codebook neither saves nor reverts a document of the learner. Ask the learner to save or revert the file: after a save read the source again and publish the article again, after a revert change nothing; then start a new run.',
      },
    )
    assert.equal(
      harness.events.filter(
        (event) => event.type === 'node-test.source-stopped',
      ).length,
      1,
    )
    assert.deepEqual(harness.calls, [
      'retire',
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

// Cycle 0046 (row 324): red while a Node test run compared the editor's documents only when a stop was captured: after a change the learner did not save, the continuation resumed the test once more and the editor's debugger showed the next pause, on a line of the unsaved text, for the moment of a capture that was then thrown away.
test('a Node test run whose cited source the learner changes in the editor without saving between two stops is ended by the continuation with the sentence that names the file, and the test is not resumed', async () => {
  // Arrange
  const harness = await nodeRunHarness({ declaredStops: 2 })
  try {
    await harness.run.prepare()
    harness.calls.length = 0
    harness.typeIntoCitedSource(
      '// a line the learner typed\nexport const nextTheme = "dark";\n',
    )

    // Act
    const refusal: unknown = await harness.run
      .advance()
      .catch((error: unknown) => error)

    // Assert: no continue request was sent, so the test stayed paused until the run released it.
    assert.deepEqual(
      refusal instanceof Error && 'code' in refusal
        ? { code: refusal.code, message: refusal.message }
        : refusal,
      {
        code: 'SOURCE_CHANGED',
        message:
          'The cited source theme.ts is open in the editor with text that differs from the text the article cites, and Codebook neither saves nor reverts a document of the learner. Ask the learner to save or revert the file: after a save read the source again and publish the article again, after a revert change nothing; then start a new run.',
      },
    )
    assert.equal(harness.calls.filter((call) => call === 'continue').length, 0)
    assert.equal(harness.calls.at(-1), 'stop-debugging')
    assert.equal(
      harness.events.filter((event) => event.type === 'node-test.dap-stopped')
        .length,
      2,
    )
  } finally {
    await harness.run.stop()
    await harness.cleanup()
  }
})

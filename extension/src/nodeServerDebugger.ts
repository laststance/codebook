import type { ConfiguredDescriptor } from './configuredStudySchemas'
import type { ReplayDebugSnapshot } from './replayDebugSchemas'
import type { RepositoryInspection } from './repositoryConfigSchemas'
import type { NodeTestFact } from './utils/inspectNodeTestVariables'

/** One declared stop of a node-server run as the debugger arms it: index 0 is the configuration's `source`, then its `additionalStops` in order. */
export type NodeServerStopTarget = {
  declaredStopIndex: number
  /** The declared repository path, as the article and the run's view name it. */
  path: string
  /** The stop's file by real path inside the repository, where the debugger sets the breakpoint. */
  file: string
  line: number
  column: number
  /** SHA-256 of the cited source; a hit captures only while the file still has it. */
  hash: string
  inspections: RepositoryInspection[]
}

/** What arming a stop gave: the adapter's breakpoint id and the line it bound the stop to, once verified. */
export type NodeServerArmedStop = {
  declaredStopIndex: number
  breakpointId?: number
  boundLine?: number
}

/** One native pause the debugger reports to the run, with the verdict whether it is the hit of an armed declared stop (its breakpoint id in `hitBreakpointIds` and the verified location at the top frame). */
export type NodeServerDebuggerPause = {
  /** Identifies this native pause until it is resumed. */
  token: number
  sessionId: string
  threadId: number
  /** The debug adapter's stopped reason, such as `breakpoint`, `exception` or `pause`. */
  reason: string
  /** Set for an owned hit: the declared stop the pause is. */
  declaredStopIndex?: number
  /** The top frame, repository-relative when inside the repository, else the file name alone. */
  location?: { path: string; line: number }
  /**
   * Whether the request-attribution window was open when the adapter's `stopped` arrived. The run takes it as the pause's attribution and never re-derives it from the request state at classification time, so a pause that arrived before the request's bytes (the learner's Pause) is never read as a hit the request caused, on every runtime. Absent when the debugger reports no arrival evidence (a run that does not set {@link NodeServerDebuggerInput.stopsJudgedByArrivalWindow}).
   */
  inRequestWindowAtStop?: boolean
  /**
   * Whether the open request window belonged to the sign-in request when the adapter's `stopped` arrived. The run takes it with {@link inRequestWindowAtStop} and never re-derives the sign-in phase at classification time, so a stop the sign-in caused (code that runs after its response was written) is no hit of the declared request that follows. Absent when the debugger reports no arrival evidence.
   */
  inSignInAtStop?: boolean
}

/** What a captured owned pause reads, already redacted. */
export type NodeServerStopCapture = {
  /** The declared path of the stop. */
  path: string
  /** The line of the paused top frame. */
  line: number
  /** SHA-256 of the file the stop executed. */
  sourceHash: string
  /** The column of the paused top frame; a debugger that does not report it leaves the history to read the snapshot's. */
  column?: number
  /** The function name of the paused top frame. */
  frameName?: string
  facts: NodeTestFact[]
  /** Required inspections the debugger could not read, as `<mode>:<path>`. */
  unavailable: string[]
  snapshot: ReplayDebugSnapshot
}

/** What the run listens to. */
export type NodeServerDebuggerHandlers = {
  /** A pause after the entry pause: a hit of an armed stop or any other pause. */
  onPause(pause: NodeServerDebuggerPause): void
  /** The paused thread ran on, by Codebook's resume or by the learner's own Continue or step. */
  onResume(token: number): void
  /** The debug session ended while the run was live. */
  onEnd(reason: string): void
}

/**
 * The debugger of a node-server run, behind a seam: the product binds the editor's `pwa-node` session ({@link createVscodeNodeServerDebugger}), real-process tests drive a direct inspector connection.
 * The run ({@link createOwnedNodeServerRun}) calls it in a fixed order: attach, subscribe, arm every stop, release the entry pause, then capture and resume pauses, retire the stops when the request ends, release at the stop. A Bun launch has no paused entry, so it attaches, subscribes and releases at once, and arms its stops once the server listens, before any request.
 */
export interface NodeServerDebugger {
  /** Refuses (`SOURCE_CHANGED`) while the editor holds other text for a cited source than the article cites. */
  assertSourcesUnchanged(): void
  /**
   * Attaches to the announced inspector endpoint and verifies that the inspector belongs to the launched process (pid, group, working folder).
   * `runtime` is `bun` for a `loader: "bun"` launch: its scripts carry source maps whose paths start at the package root (`/src/index.ts`), and its function scopes arrive as closures, so the debugger maps the one and reads the other accordingly.
   */
  attach(input: {
    endpoint: string
    packageRoot: string
    pid: number
    processGroup: number
    signal: AbortSignal
    runtime?: 'node' | 'bun'
  }): Promise<void>
  /** Starts the run's listening; called once after {@link attach}. */
  subscribe(handlers: NodeServerDebuggerHandlers): { dispose(): void }
  /** Arms every declared stop at once and waits for each acknowledgement; refuses a stop bound elsewhere. */
  armStops(
    stops: NodeServerStopTarget[],
    signal: AbortSignal,
  ): Promise<NodeServerArmedStop[]>
  /**
   * Re-reads where every armed stop stands now; a stop whose binding was withdrawn after arming has no `boundLine`. Implemented by the editor's debugger, which the run asks right before it marks a Bun launch prepared.
   */
  currentlyBoundStops?(): NodeServerArmedStop[]
  /**
   * Continues the entry pause exactly once; an owned hit that comes first is no entry pause and is reported as a pause instead.
   * With `{ entryPause: false }` (a Bun launch, which has no paused entry) nothing is continued: the debugger only starts reporting stops.
   */
  releaseEntry(
    signal: AbortSignal,
    options?: { entryPause: boolean },
  ): Promise<void>
  /**
   * Opens or closes the causal window of the declared request, so the editor tells a stop of the request from the learner's.
   * `signIn` marks a window that opens for the sign-in request: a stop that arrives in it is reported as arrived during the sign-in ({@link NodeServerDebuggerPause.inSignInAtStop}).
   */
  setRequestWindow(open: boolean, options?: { signIn: boolean }): void
  /** Reads an owned pause's declared inspections, its source hash and the redacted snapshot; refuses a pause that was resumed meanwhile. */
  capture(
    pause: NodeServerDebuggerPause,
    signal: AbortSignal,
  ): Promise<NodeServerStopCapture>
  /** Resumes the paused thread (the run reserved the pause before). */
  resume(pause: NodeServerDebuggerPause, signal: AbortSignal): Promise<void>
  /** Retires every owned breakpoint, one after the other, confirmed by the adapter; the stops that already arrived are classified first, so a stop that hit while the request was out is still known as an owned hit. */
  retireStops(signal: AbortSignal): Promise<void>
  /** Removes the owned breakpoints, ends the session (detach, which resumes the target) and stops listening; safe to call again after a failure. */
  release(): Promise<void>
  /**
   * Whether the learner holds a pause of the bound session: a Pause request still waiting for its answer or its stop, or a pause stop of the learner that has not run on. The run refuses to write a request while it is true (Codebook never writes while the learner holds a pause), and the debugger keeps the request window closed meanwhile. A debugger without the editor's Pause (a direct inspector connection) omits it.
   */
  learnerPausePending?(): boolean
  /**
   * Whether the bound debug session is over for the run (the editor terminated it, or the release began), true from the turn the editor reports it. The run refuses to write a request then, and the debugger never opens the request window of that session again. A debugger without an editor session omits it.
   */
  boundSessionEnded?(): boolean
  /** Whether the target is paused at a stop the run has not been told about yet (its stack is still being read): the stop kills such a server first, since the pause may be inside the request (D14). */
  hasUnreportedPause(): boolean
}

/** The pieces a debugger factory is given. */
export type NodeServerDebuggerInput = {
  runId: string
  workspace: string
  /** The article's text of every source the selected node cites. */
  citedSources: ConfiguredDescriptor['sources']
  stops: NodeServerStopTarget[]
  record: (type: string, detail?: unknown) => unknown
  /**
   * Whether the run judges a declared stop by the request window as it stood when the adapter's `stopped` arrived ({@link NodeServerDebuggerPause.inRequestWindowAtStop}). A node-server run does: its request window is the HTTP exchange, which opens at the first byte. A script run does not: its capture eligibility is its own lifecycle (a stop on the entry's first statement and every later declared stop are captured), so the debugger reports no arrival evidence for it and the stop ledger judges at classification time.
   */
  stopsJudgedByArrivalWindow?: boolean
  /** Masks the run's known secret values (the sign-in secret and session cookies) in every string a stop saves, before it is cut; read at call time, so values learned after the debugger was made still apply. Absent: nothing is masked. */
  maskKnownText?: (text: string) => string
}

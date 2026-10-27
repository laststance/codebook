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
}

/** What a captured owned pause reads, already redacted. */
export type NodeServerStopCapture = {
  /** The declared path of the stop. */
  path: string
  /** The line of the paused top frame. */
  line: number
  /** SHA-256 of the file the stop executed. */
  sourceHash: string
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
 * The run ({@link createOwnedNodeServerRun}) calls it in a fixed order: attach, subscribe, arm every stop, release the entry pause, then capture and resume pauses, retire the stops when the request ends, release at the stop.
 */
export interface NodeServerDebugger {
  /** Refuses (`SOURCE_CHANGED`) while the editor holds other text for a cited source than the article cites. */
  assertSourcesUnchanged(): void
  /** Attaches to the announced inspector endpoint and verifies, at the entry pause, that the inspector belongs to the launched process (pid, group, working folder). */
  attach(input: {
    endpoint: string
    packageRoot: string
    pid: number
    processGroup: number
    signal: AbortSignal
  }): Promise<void>
  /** Starts the run's listening; called once after {@link attach}. */
  subscribe(handlers: NodeServerDebuggerHandlers): { dispose(): void }
  /** Arms every declared stop at once and waits for each acknowledgement; refuses a stop bound elsewhere. */
  armStops(
    stops: NodeServerStopTarget[],
    signal: AbortSignal,
  ): Promise<NodeServerArmedStop[]>
  /** Continues the entry pause exactly once; an owned hit that comes first is no entry pause and is reported as a pause instead. */
  releaseEntry(signal: AbortSignal): Promise<void>
  /** Opens or closes the causal window of the declared request, so the editor tells a stop of the request from the learner's. */
  setRequestWindow(open: boolean): void
  /** Reads an owned pause's declared inspections, its source hash and the redacted snapshot; refuses a pause that was resumed meanwhile. */
  capture(
    pause: NodeServerDebuggerPause,
    signal: AbortSignal,
  ): Promise<NodeServerStopCapture>
  /** Resumes the paused thread (the run reserved the pause before). */
  resume(pause: NodeServerDebuggerPause, signal: AbortSignal): Promise<void>
  /** Retires every owned breakpoint, one after the other, confirmed by the adapter. */
  retireStops(signal: AbortSignal): Promise<void>
  /** Removes the owned breakpoints, ends the session (detach, which resumes the target) and stops listening; safe to call again after a failure. */
  release(): Promise<void>
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
}

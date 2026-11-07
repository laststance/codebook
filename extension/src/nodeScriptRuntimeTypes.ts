import type { StudyError } from './errors'
import type { NodeScriptEnd } from './nodeScriptHistorySchemas'
import type {
  NodeServerCapture,
  NodeServerHeldPause,
  NodeServerPause,
  NodeServerStop,
} from './runtime'
import type { PauseIdentity } from './runtimeSupport/pauseGate'
import type { RepositoryPackageCopy } from './utils/listRepositoryPackageCopies'

/** The learner's answer to the editor's confirmation of a script run, as the run resource's `confirmation` reads: asked, accepted or refused (cancelled, closed or unanswered within the pause hold). */
export type NodeScriptConfirmation =
  'awaiting-learner' | 'confirmed' | 'declined'

/** Where a node-script run stands: asking the learner, building the declared library (only a run with `library`), preparing, running, paused at a declared stop, ended by itself or a limit, being stopped, or stopped by `codebook_stop` (or released without an end). */
export type NodeScriptState =
  | 'confirming'
  | 'building'
  | 'preparing'
  | 'running'
  | 'paused'
  | 'ended'
  | 'stopping'
  | 'stopped'

/** The end of a script run as the run resource shows it: the history's end fields beside the combined output's tail. */
export type NodeScriptEndView = NodeScriptEnd & {
  /** The last part of the combined stdout and stderr, private roots hidden, and whether the output was cut. */
  output: { tail: string; truncated: boolean }
}

/**
 * What the run resource says about the library a run declared, for a `node-script` run and a `vite-dev` library run alike (one vocabulary, API 1.34): the declared identity, the build facts once built and packed, what the script was seen to load once it ended, and what became of the private folder.
 * `loaded`, `loadCount` and `publishedCopyLoaded` are absent until the observation is read (`observation: 'pending'`); an `incomplete` or `unreadable` observation never reads as "not loaded" (its counts are lower bounds).
 */
export type LibraryRunView = {
  /** The library's package name; the declared folder until the name is known. */
  package: string
  /** The declared `library.packageRoot`. */
  packageRoot: string
  /** Whether the library was built and packed. */
  prepared: boolean
  version?: string
  /** The repository's HEAD before the build. */
  revision?: string
  dirty?: boolean
  packageManager?: { name: 'pnpm' | 'npm'; version: string | null }
  buildMs?: number
  packMs?: number
  tarballSha256?: string
  /** The version the Example's own `node_modules` held, or `null`; for disclosure only. */
  installedVersion?: string | null
  observation: 'pending' | 'complete' | 'incomplete' | 'unreadable'
  /** True when a module of the packed copy was loaded (not merely resolved). */
  loaded?: boolean
  loadCount?: number
  /** True when a module of a package with the same name was loaded from any other real path, the Example's installed copy among them. */
  publishedCopyLoaded?: boolean
  /** The first such path, private roots hidden. */
  publishedCopyPath?: string
  /** Whether the private folder is `removed` or its removal is `pending`; absent until the run released it. */
  cleanup?: 'removed' | 'pending'
  /** Only when the Example does not list the library itself (API 1.35): the Example's dependencies whose installed manifest declares it, sorted, at most 16. The declared relation, never an observed importer. */
  reachedThrough?: string[]
  /** The number of all such dependencies, at least the length of `reachedThrough`; present with it. */
  reachedThroughCount?: number
}

/** What a node-script run shows the service: its state, confirmation, stops, current or held pause, captures, failure and (once it ended) its end. */
export type NodeScriptView = {
  state: NodeScriptState
  /** Absent until the learner is asked; a run refused before the dialog never shows one. */
  confirmation?: NodeScriptConfirmation
  /** The launched script's pid (also its process group). */
  pid?: number
  stops: NodeServerStop[]
  /** Zero-based indices of declared stops captured, in hit order (a stop hit twice appears twice). */
  stopsReached: number[]
  /** The run-wide pause generation; it grows with every pause. */
  pauseGeneration: number
  pause?: NodeServerPause
  heldPause?: NodeServerHeldPause
  captures: NodeServerCapture[]
  /** True once a hit beyond the capture limit retired the owned breakpoints. */
  captureBudgetExhausted: boolean
  /** An unexpected failure that ends the run (never a script's own exit or a limit, which are its `end`): the service sets it as the run's error and stops the run. */
  runFailure?: StudyError
  /** How many stops failed so far; the second failure's message names the pid. */
  failedStops: number
  /** Set once the run ended: how, which stops it reached and its output tail. */
  end?: NodeScriptEndView
  /** The declared library's facts and observation; only a run with `library` has it. */
  library?: LibraryRunView
  /** A run without `library`: the installed copies of the opened repository's own packages that the Example runs, with correspondence `unverified`. Absent when none were found or the repository has no `origin` remote. */
  repositoryPackageCopies?: RepositoryPackageCopy[]
}

/**
 * The node-script run the service drives: it asks the learner to confirm one run, launches the repository's script under the debugger, arms the declared stops, captures their hits and ends with the script's own exit, a limit or a stop.
 * Created by {@link StudyEnvironment.createNodeScriptRun}; the service reads {@link NodeScriptRuntime.view} for state and answers.
 */
/** What the service bounds a script run's preparation by. */
export type NodeScriptPrepareLimits = {
  /** Milliseconds left of the service's absolute whole-run deadline; the run's own limit never exceeds it, so a script start cannot outlive the service's bound. */
  readonly runTimeoutMs?: number
}

export interface NodeScriptRuntime {
  readonly id: string
  /** Checks, asks the learner, launches, attaches, arms every declared stop and releases; resolves when the script runs, rejects with the run's typed {@link StudyError} (`NODE_SCRIPT_SOURCE_REFUSED`, `SCRIPT_NOT_CONFIRMED`, `SOURCE_CHANGED`, `RUNTIME_FAILED`, …). */
  prepare(limits?: NodeScriptPrepareLimits): Promise<void>
  view(): NodeScriptView
  /** Milliseconds since the script launched, the clock every history entry carries; `0` before a launch. */
  elapsedSinceLaunchMs(): number
  /** Calls the listener after every change of {@link NodeScriptRuntime.view}. */
  onDidChange(listener: () => void): { dispose(): void }
  /** Continues the current pause: reserves its generation atomically, then resumes. Throws `STALE_PAUSE`, `NO_PAUSE` or `LEARNER_PAUSED`. */
  continue(pause: PauseIdentity): Promise<void>
  /** Ends the run: the whole process group, killed first while paused or running; idempotent, retryable after a failure. */
  stop(): Promise<void>
}

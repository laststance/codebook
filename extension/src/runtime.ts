import type {
  ConfiguredDefinition,
  ConfiguredObservation,
  ConfiguredStudy,
} from './configuredStudySchemas'
import type {
  NODE_TEST_PROFILE,
  REPOSITORY_BROWSER_ACTION,
  REPOSITORY_BROWSER_PROFILE,
} from './constants'
import type { NodeTestConfiguration } from './nodeTestConfigSchemas'
import type { NodeTestSourceStop } from './ownedNodeTestRun'
import type { Evidence, RecordedEvent } from './runtimeSupport/evidence'
import type { HostConfiguration } from './runtimeSupport/hostBrowser'
import type { PauseIdentity, PauseGate } from './runtimeSupport/pauseGate'

export interface NodeTestRuntime {
  readonly id: string
  prepare(): Promise<NodeTestSourceStop>
  hasNextStop(): boolean
  advance(): Promise<NodeTestSourceStop>
  complete(): Promise<{
    exitCode: number | null
    signal: NodeJS.Signals | null
    output: string
    elapsedMs: number
  }>
  stop(): Promise<void>
}

export type ConfiguredRuntimeSnapshot = Omit<
  ConfiguredObservation,
  'snapshotUri' | 'interpretations'
>
export type RuntimeSnapshot = ConfiguredRuntimeSnapshot
export type RuntimeAction = typeof REPOSITORY_BROWSER_ACTION
export type RuntimeDefinition = ConfiguredDefinition
export type RuntimeControl = Readonly<{
  signal: AbortSignal
  deadlineAt: number
  preparationDeadlineAt: number
}>
export type RuntimeSource = {
  source: string
  javascript: string
  sourceMap: string
}
export type Participant = 'server' | 'browser'
export type RuntimeParticipant = {
  sessionId?: string
  pause: PauseIdentity | undefined
  phase: PauseGate['phase']
  snapshot: ConfiguredRuntimeSnapshot | undefined
  continued?: PauseIdentity
  conflict: boolean
}
export type ConfiguredRuntimeView = {
  runId: string
  status: string
  cleaned: boolean
  resourcesReleased: boolean
  runtimeOutcome: 'demonstrated' | 'not-demonstrated'
  captureOutcome: 'complete' | 'incomplete'
  finalOutcome: ConfiguredStudy['finalOutcome']
  captures: Record<
    string,
    {
      status: 'pending' | 'captured' | 'failed'
      file?: string
      error?: string
      renderer?: { epoch: string; id: number; hash: string }
    }
  >
  snapshotCaptures?: Record<string, ConfiguredRuntimeView['captures'][string]>
  failures: string[]
  events: RecordedEvent[]
  artifactDirectory: string
  activeSessionIds: string[]
  profile: typeof REPOSITORY_BROWSER_PROFILE
  definition: ConfiguredDefinition
  manifest?: {
    hash: string
    configurationHash: string
    configuration: ConfiguredDefinition['configuration']
    descriptor: Pick<
      ConfiguredDefinition['descriptor'],
      'itemId' | 'bookTitle' | 'nodeTitle' | 'anchors' | 'citationContext'
    >
    itemId: ConfiguredObservation['itemId']
    sourceHash: string
    javascriptHash: string
    mapHash: string
  }
  participants: { browser: RuntimeParticipant; server?: RuntimeParticipant }
  snapshots: ConfiguredRuntimeSnapshot[]
  operation: ConfiguredStudy['operation']
  nextAction: typeof REPOSITORY_BROWSER_ACTION | undefined
  observed: { afterVerified: true } | undefined
  links: never[]
}
export type RuntimeView = ConfiguredRuntimeView
/** Shares owned repository runtime control with the service and recording pipeline. @example const runtime = await environment.createRuntime(directory, definition) */
export interface StudyRuntime {
  readonly id: string
  readonly evidence: Pick<
    Evidence,
    'save' | 'flush' | 'record' | 'failure' | 'directory' | 'elapsedMs'
  >
  prepare(): Promise<void>
  view(): RuntimeView
  action(key: string, action: RuntimeAction): { id: string }
  continue(participant: Participant, pause: PauseIdentity): Promise<void>
  stop(): Promise<void>
  fail(reason: string): void
  source(item: string, snapshotId?: string): RuntimeSource | undefined
  reveal(snapshot: RuntimeSnapshot): Promise<void>
  /** Restarts a held pause's hold deadline while the learner reads a replay; runtimes without a pause hold omit it. */
  renewPauseHold?(): void
}
export interface StudyEnvironment {
  readonly workspace: string
  readonly host: HostConfiguration
  /** `vscode.env.remoteName` of the window: `wsl` in a WSL remote window, absent in a local one. A remote window has no Trash, so {@link StudyService} starts there with study removal unavailable. */
  readonly remoteName?: string
  readonly build: { revision: string; dirty: boolean; sourceHash: string }
  assertWorkspace?(): void
  prerequisites(): Promise<{
    ready: boolean
    missing: string[]
    profiles?: Partial<
      Record<
        typeof REPOSITORY_BROWSER_PROFILE | typeof NODE_TEST_PROFILE,
        { ready: boolean; missing: string[] }
      >
    >
  }>
  createRuntime(
    directory: string,
    definition: RuntimeDefinition,
    control?: RuntimeControl,
  ): Promise<StudyRuntime>
  createNodeTestRun?(
    configuration: NodeTestConfiguration,
    record: (type: string, detail?: unknown) => unknown,
  ): Promise<NodeTestRuntime>
}

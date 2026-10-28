import type { ConfiguredDescriptor } from '../configuredStudySchemas'
import type { NodeHistoryRepository } from '../nodeHistoryRepository'
import type { NodeServerConfiguration } from '../nodeServerConfigSchemas'
import {
  NodeServerHistoryRecorder,
  type NodeServerHistoryBegun,
} from '../nodeServerHistoryRecorder'

import { buildNodeServerHistoryHeader } from './buildNodeServerHistoryHeader'
import { readRepositoryRevision } from './readRepositoryRevision'

/** What {@link startNodeServerHistory} needs of the run and the service. */
export type StartNodeServerHistoryInput = {
  /** The workspace's history repository; `undefined` when learning storage is unavailable in this editor. */
  repository: NodeHistoryRepository | undefined
  workspace: string
  instanceId: string
  runId: string
  createdAtMs: number
  prepared: {
    configuration: NodeServerConfiguration
    configurationHash: string
    descriptor: ConfiguredDescriptor
  }
  /** Hides the private roots of a recorded text. */
  hideRoots: (text: string) => string
  /** Words a failure for the learner; names a full store with its own message. */
  describeCause: (error: unknown) => string
  /** The start's bound; the default 2 s unless a test names its own. */
  startBoundMs?: number
  /** Told once with the first fault of the run's sink (the service writes it to Output › Codebook); the history is already marked failed. */
  onFault?: (error: unknown) => void
  /** Told once when the history stopped taking entries while the run lives (the service redraws the status item). */
  onAppendFailed?: () => void
}

/**
 * Starts the history of a node-server run before the server launches, within its bound, and never lets a failure refuse the run: storage unavailable, a full store or a refused start come back as the cause the status and Save show.
 * Called by {@link StudyService} once the run's preparation and prerequisites passed.
 * @param input - The run, its pinned article node and how to word a failure.
 * @returns The recorder to hand the run's sink to, or `{ unavailable }` with the cause.
 * @example
 * const begun = await startNodeServerHistory(input)
 * if ('recorder' in begun) begun.recorder.sink // the sink the run feeds
 */
export async function startNodeServerHistory(
  input: StartNodeServerHistoryInput,
): Promise<NodeServerHistoryBegun> {
  const { repository } = input
  if (!repository)
    return { unavailable: 'learning storage is unavailable in this editor.' }
  return NodeServerHistoryRecorder.begin({
    start: async () =>
      repository.serverHistories.start(
        buildNodeServerHistoryHeader({
          workspaceKey: repository.serverHistories.workspaceKey,
          instanceId: input.instanceId,
          runId: input.runId,
          createdAtMs: input.createdAtMs,
          configuration: input.prepared.configuration,
          configurationHash: input.prepared.configurationHash,
          descriptor: input.prepared.descriptor,
          repositoryRevision: await readRepositoryRevision(input.workspace),
        }),
      ),
    describeCause: input.describeCause,
    sink: {
      sanitize: input.hideRoots,
      onFault: input.onFault,
      onAppendFailed: input.onAppendFailed,
    },
    summarize: (studyId) => repository.serverHistories.summarize(studyId),
    startBoundMs: input.startBoundMs,
  })
}

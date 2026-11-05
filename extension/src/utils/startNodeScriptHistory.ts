import type { NodeHistoryRepository } from '../nodeHistoryRepository'
import {
  NodeScriptHistoryRecorder,
  type NodeScriptHistoryBegun,
} from '../nodeScriptHistoryRecorder'

import {
  buildNodeScriptHistoryHeader,
  type NodeScriptHistoryHeaderInput,
} from './buildNodeScriptHistoryHeader'
import { readRepositoryRevision } from './readRepositoryRevision'
import type { CauseRoots } from './sanitizeCause'

/** What {@link startNodeScriptHistory} needs of the run and the service. */
export type StartNodeScriptHistoryInput = {
  /** The workspace's history repository; `undefined` when learning storage is unavailable in this editor. */
  repository: NodeHistoryRepository | undefined
  /** The workspace folder whose repository revision the header pins. */
  workspace: string
  /** The run's identity and prepared script; the workspace key and the revision are filled in here. */
  run: Omit<NodeScriptHistoryHeaderInput, 'workspaceKey' | 'repositoryRevision'>
  /** Hides the private roots of a recorded text; built from the same frozen snapshot as `roots`. */
  hideRoots: (text: string) => string
  /** The private roots behind `hideRoots`, frozen for the run, so a text cut inside a root is hidden by the same set. */
  roots?: CauseRoots
  /** Words a failure for the learner; names a full store with its own message. */
  describeCause: (error: unknown) => string
  /** The start's bound; the default 2 s unless a test names its own. */
  startBoundMs?: number
  /** Told once with the first fault of the run's sink; the history is already marked failed. */
  onFault?: (error: unknown) => void
  /** Told once when the history stopped taking entries while the run lives. */
  onAppendFailed?: () => void
}

/**
 * Starts the history of a node-script run before the script launches, within its bound, and never lets a failure refuse the run: storage unavailable, a full store or a refused start come back as the cause the status and Save show.
 * Called by the script run once its preparation and prerequisites passed; the run feeds `recorder.sink` ({@link NodeScriptHistorySink}).
 * @param input - The run, its prepared script and how to word a failure.
 * @returns The recorder to hand the run's sink to, or `{ unavailable }` with the cause.
 * @example
 * const begun = await startNodeScriptHistory(input)
 * if ('recorder' in begun) begun.recorder.sink.output(10, 'stdout', 'hi\n')
 */
export async function startNodeScriptHistory(
  input: StartNodeScriptHistoryInput,
): Promise<NodeScriptHistoryBegun> {
  const { repository } = input
  if (!repository)
    return { unavailable: 'learning storage is unavailable in this editor.' }
  return NodeScriptHistoryRecorder.begin({
    start: async () =>
      repository.scriptHistories.start(
        buildNodeScriptHistoryHeader({
          ...input.run,
          workspaceKey: repository.scriptHistories.workspaceKey,
          repositoryRevision: await readRepositoryRevision(input.workspace),
        }),
      ),
    describeCause: input.describeCause,
    sink: {
      sanitize: input.hideRoots,
      roots: input.roots,
      onFault: input.onFault,
      onAppendFailed: input.onAppendFailed,
    },
    summarize: (studyId) => repository.scriptHistories.summarize(studyId),
    startBoundMs: input.startBoundMs,
  })
}

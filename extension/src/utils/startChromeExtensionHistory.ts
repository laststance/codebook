import {
  ChromeExtensionHistoryRecorder,
  type ExtensionHistoryBegun,
} from '../chromeExtensionHistoryRecorder'
import type { ExtensionHistoryIdentity } from '../chromeExtensionHistorySink'
import type { NodeHistoryRepository } from '../nodeHistoryRepository'

import { buildExtensionHistoryHeader } from './buildExtensionHistoryHeader'
import { readRepositoryRevision } from './readRepositoryRevision'

/** What {@link startChromeExtensionHistory} needs of the run and the service. */
export type StartChromeExtensionHistoryInput = {
  /** The workspace's history repository; `undefined` when learning storage is unavailable in this editor. */
  repository: NodeHistoryRepository | undefined
  workspace: string
  instanceId: string
  runId: string
  createdAtMs: number
  identity: ExtensionHistoryIdentity
  /** Words a failure for the learner; names a full store with its own message. */
  describeCause: (error: unknown) => string
  /** The start's bound; the default 2 s unless a test names its own. */
  startBoundMs?: number
  /** Told once with the first fault of the history (the service writes it to Output › Codebook). */
  onFault?: (error: unknown) => void
}

/**
 * Starts the history of a chrome-extension run within its bound, and never lets a failure refuse the run: storage unavailable, a full store or a refused start come back as the cause the run resource shows.
 * Called by {@link StudyService} when the run reports its resolved declaration.
 * @param input - The run, what its declaration resolved to and how to word a failure.
 * @returns The recorder to hand the run as its sink, or `{ unavailable }` with the cause.
 * @example
 * const begun = await startChromeExtensionHistory(input)
 * if ('recorder' in begun) begun.recorder.frameObserver // the observer the Application view feeds
 */
export async function startChromeExtensionHistory(
  input: StartChromeExtensionHistoryInput,
): Promise<ExtensionHistoryBegun> {
  const { repository } = input
  if (!repository)
    return { unavailable: 'learning storage is unavailable in this editor.' }
  return ChromeExtensionHistoryRecorder.begin({
    start: async () =>
      repository.extensionHistories.start(
        buildExtensionHistoryHeader({
          workspaceKey: repository.extensionHistories.workspaceKey,
          instanceId: input.instanceId,
          runId: input.runId,
          createdAtMs: input.createdAtMs,
          identity: input.identity,
          repositoryRevision: await readRepositoryRevision(input.workspace),
        }),
      ),
    describeCause: input.describeCause,
    summarize: (studyId) => repository.extensionHistories.summarize(studyId),
    startBoundMs: input.startBoundMs,
    onFault: input.onFault,
  })
}

import type { NodeHistoryRepository } from '../../nodeHistoryRepository'
import { waitUntil } from '../../runtimeSupport/utils/waitUntil'
import type { workspaceHarness } from '../studyWorkspaceHarness'

import { READER_RESULT_BOUND_MS } from './readerResultBound'
import { lastView } from './twoStopNodeHistory'

/** The workspace harness the server workspace tests share. */
export type ServerWorkspaceHarness = Awaited<
  ReturnType<typeof workspaceHarness>
>

/**
 * Reaches the workspace's history repository, over the learning directory the fixture writer shares.
 * @param harness - The workspace harness.
 * @returns The repository the workspace wired.
 * @example await writeServerHistory(repositoryOf(harness), { workspaceKey, header })
 */
export function repositoryOf(
  harness: ServerWorkspaceHarness,
): NodeHistoryRepository {
  return harness.reader['nodeHistoryRepository']!
}

/**
 * Reads the workspace key every history of the harness's workspace carries.
 * @param harness - The workspace harness.
 * @returns The workspace key.
 * @example nodeServerHistoryHeader(workspaceKeyOf(harness))
 */
export function workspaceKeyOf(harness: ServerWorkspaceHarness): string {
  return harness.service.nodeHistoryStore!.workspaceKey
}

/**
 * Finds the address of the replay's recorded-source slot document.
 * @param harness - The workspace harness.
 * @returns The slot's address.
 * @example harness.documentTextOf(slotUri(harness))
 */
export function slotUri(harness: ServerWorkspaceHarness): string {
  return harness.historicalDebugPresentations.find(
    (presentation) => presentation.sourceDocument,
  )!.sourceDocument!.uri
}

/**
 * Opens a saved server replay from the library and waits until the pane shows it settled.
 * @param harness - The workspace harness.
 * @param studyId - The server history's study id.
 * @example await openServerReplay(harness, header.studyId)
 */
export async function openServerReplay(
  harness: ServerWorkspaceHarness,
  studyId: string,
): Promise<void> {
  await harness.reader.action('retry')
  await harness.reader.openLearningReplay(studyId)
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistory?.header.studyId === studyId &&
      !lastView(harness)?.loading,
    'the server replay is shown',
    READER_RESULT_BOUND_MS,
  )
}

/**
 * Presses a transport move as the Study pane's button does and waits until the playhead has committed at `sequence`.
 * @param harness - The workspace harness.
 * @param studyId - The shown history.
 * @param move - Which way and by what unit.
 * @param sequence - The sequence the move must commit.
 * @example await moveTo(harness, studyId, { direction: 'next', unit: 'stop' }, 5)
 */
export async function moveTo(
  harness: ServerWorkspaceHarness,
  studyId: string,
  move: { direction: 'previous' | 'next'; unit: 'event' | 'stop' },
  sequence: number,
): Promise<void> {
  harness.receiveContext({
    type: 'node-history-step',
    revision: lastView(harness)!.revision,
    studyId,
    ...move,
  })
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistoryPosition?.sequence === sequence &&
      !lastView(harness)?.nodeHistoryPosition?.pending,
    `the playhead commits at ${sequence}`,
    READER_RESULT_BOUND_MS,
  )
}

/**
 * Selects one event as a summary step's link or the event list's control does.
 * @param harness - The workspace harness.
 * @param studyId - The shown history.
 * @param sequence - The event to select.
 * @param stepId - The step the link names, when it is a step's.
 * @example await selectEvent(harness, studyId, 6, 'response')
 */
export async function selectEvent(
  harness: ServerWorkspaceHarness,
  studyId: string,
  sequence: number,
  stepId?: string,
): Promise<void> {
  harness.receiveContext({
    type: 'node-history-event',
    revision: lastView(harness)!.revision,
    studyId,
    sequence,
    ...(stepId ? { stepId } : {}),
  })
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistoryPosition?.sequence === sequence &&
      !lastView(harness)?.nodeHistoryPosition?.pending,
    `the playhead commits at ${sequence}`,
    READER_RESULT_BOUND_MS,
  )
}

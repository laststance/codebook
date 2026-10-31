import { dirname } from 'node:path'

import { waitUntil } from '../../runtimeSupport/utils/waitUntil'

import { READER_RESULT_BOUND_MS } from './readerResultBound'
import {
  writeExtensionHistory,
  type ExtensionScriptStep,
  type WrittenExtensionHistory,
} from './sealedExtensionHistory'
import {
  repositoryOf,
  workspaceKeyOf,
  type ServerWorkspaceHarness,
} from './serverWorkspaceHarness'
import { shownApplicationView } from './shownTestOutput'
import { lastView } from './twoStopNodeHistory'

/** A history identity no folder holds, used only to learn where the extension profile's folders live. */
const PLACEHOLDER_STUDY_ID =
  '00000000-0000-4000-8000-000000000000_11111111-1111-4111-8111-111111111111'

/**
 * Writes a scripted extension history into the learning directory the workspace's repository reads.
 * @param harness - The workspace harness.
 * @param script - The scripted run.
 * @param options - Whether to seal, and the question.
 * @returns The written history's identity.
 * @example const history = await writeExtensionHistoryFor(harness, script)
 */
export function writeExtensionHistoryFor(
  harness: ServerWorkspaceHarness,
  script: readonly ExtensionScriptStep[],
  options: { seal?: boolean; question?: string } = {},
): Promise<WrittenExtensionHistory> {
  const profileDirectory = dirname(
    repositoryOf(harness).extensionHistories.historyDirectory(
      PLACEHOLDER_STUDY_ID,
    ),
  )
  return writeExtensionHistory(
    dirname(profileDirectory),
    workspaceKeyOf(harness),
    script,
    options,
  )
}

/**
 * Opens a saved Extension replay from the library and waits until the pane shows it settled.
 * @param harness - The workspace harness.
 * @param studyId - The history's study id.
 * @example await openExtensionReplay(harness, history.studyId)
 */
export async function openExtensionReplay(
  harness: ServerWorkspaceHarness,
  studyId: string,
): Promise<void> {
  await harness.reader.action('retry')
  await harness.reader.openLearningReplay(studyId)
  await waitUntil(
    () =>
      lastView(harness)?.nodeHistory?.header.studyId === studyId &&
      !lastView(harness)?.loading &&
      shownApplicationView(harness)?.frame !== undefined,
    'the Extension replay is shown',
    READER_RESULT_BOUND_MS,
  )
}

/**
 * Selects one event as the event list's control does and waits until the playhead has committed there.
 * @param harness - The workspace harness.
 * @param studyId - The shown history.
 * @param sequence - The event to select.
 * @example await selectExtensionEvent(harness, studyId, 4)
 */
export async function selectExtensionEvent(
  harness: ServerWorkspaceHarness,
  studyId: string,
  sequence: number,
): Promise<void> {
  harness.receiveContext({
    type: 'node-history-event',
    revision: lastView(harness)!.revision,
    studyId,
    sequence,
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
 * Reads what a learner sees of the shown moment: the position line, the frame label and the number of debugger presentations so far.
 * @param harness - The workspace harness.
 * @returns The three facts.
 * @example expect(shown(harness).frameLabel).toBe('Recorded frame captured at this stop')
 */
export function shownExtensionMoment(harness: ServerWorkspaceHarness): {
  position: string | undefined
  frameLabel: string | undefined
  hasFrameImage: boolean
  presentations: number
  lastThread: string | undefined
  /** What the last emptying of the debugger told Run and Debug its session reads: a moment without a stop empties it. */
  emptiedAs: string | undefined
  emptyings: number
} {
  const frame = shownApplicationView(harness)?.frame
  return {
    position: lastView(harness)?.nodeHistorySection?.position,
    frameLabel: frame?.label,
    hasFrameImage: Boolean(frame?.src),
    presentations: harness.historicalDebugPresentations.length,
    lastThread: harness.historicalDebugPresentations.at(-1)?.label,
    emptiedAs: harness.historicalDebugInvalidationLabels().at(-1),
    emptyings: harness.historicalDebugInvalidationLabels().length,
  }
}

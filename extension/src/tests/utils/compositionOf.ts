import type { Harness } from './testReplayCompositionHarness'
import { lastView } from './twoStopNodeHistory'

/**
 * Reads the parts of the composition a test replay's open decides.
 * @param harness - The workspace harness.
 * @returns Whether the Study pane, the Application pane and the Learning summary show, and the family the panes are told.
 * @example compositionOf(harness) // => { studyPane: false, application: true, summary: true, family: 'test' }
 */
export function compositionOf(harness: Harness) {
  return {
    studyPane: harness.panelColumn('codebook.studyContext') !== undefined,
    application: harness.panelColumn('codebook.scopedBrowser') !== undefined,
    summary: harness.summary.visible,
    family: lastView(harness)?.replayFamily,
  }
}

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { NodeTestOutputUpdate } from '../utils/installNodeTestOutput'
import type { NodeTestApplicationView } from '../utils/projectNodeTestApplication'
import { testOutputHtml } from '../utils/testOutputHtml'

import { shownTestOutput } from './utils/shownTestOutput'

/**
 * Makes an Application view of the given generation that shows the given lines.
 * @param generation - The view's generation.
 * @param texts - The lines' texts, written to standard output.
 * @returns The view.
 * @example viewOf(2, ['between stops'])
 */
function viewOf(generation: number, texts: string[]): NodeTestApplicationView {
  return {
    generation,
    time: `Recorded test output · 0.${generation}0 s`,
    test: 'theme › switches',
    name: 'Recorded test output',
    lines: texts.map((text, number) => ({ number, channel: 'stdout', text })),
  }
}

/**
 * Stands in for the Study workspace harness: one Application panel written with a view, and the in-place updates posted into it.
 * @param written - The view the document was written with.
 * @param updates - The updates posted since, oldest first.
 * @returns What {@link shownTestOutput} reads of a harness.
 * @example paneOf(viewOf(1, ['RUN']), [])
 */
function paneOf(
  written: NodeTestApplicationView,
  updates: NodeTestApplicationView[],
) {
  return {
    applicationOutputs: (): NodeTestOutputUpdate[] =>
      updates.map((view) => ({
        type: 'node-history-output',
        generation: view.generation,
        view,
      })),
    nativePanels: () => [
      {
        kind: 'codebook.scopedBrowser',
        webview: { html: testOutputHtml(written, 'nonce', 'study_1') },
      },
    ],
  }
}

// Value: protects=the replay tests read what the Application pane shows: a document written with its first view and never updated shows that view's lines, and a document written after the last update shows its own newer view, not the older update; fails_when=the reader finds no lines in a document that draws them from its script options (it read markup the document no longer writes), so negative assertions such as "the result's verdict is not shown" pass on an empty read, or an older update hides a newer document; why_new=F324 (PR-2 /ship Step 9 pass 2 testing): D22 moved the document's lines into its script options and the helper kept reading the old markup and generation; seam=a stand-in harness with documents from the real testOutputHtml; no_claim=the document's own drawing (the Reader DOM check)
test('the shown test output is the written document’s first view until a newer update reaches it', () => {
  // Arrange
  const neverUpdated = paneOf(viewOf(3, ['RUN src/theme.test.ts', 'ok']), [])
  const writtenAfterTheUpdate = paneOf(viewOf(5, ['Tests 1 passed']), [
    viewOf(4, ['between stops']),
  ])
  const updatedAfterWriting = paneOf(viewOf(3, ['RUN src/theme.test.ts']), [
    viewOf(4, ['between stops']),
  ])

  // Act
  const shown = [neverUpdated, writtenAfterTheUpdate, updatedAfterWriting].map(
    shownTestOutput,
  )

  // Assert
  assert.deepEqual(shown, [
    'RUN src/theme.test.ts\nok',
    'Tests 1 passed',
    'between stops',
  ])
})

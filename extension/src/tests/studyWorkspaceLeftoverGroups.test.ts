import assert from 'node:assert/strict'
import { test } from 'node:test'

import { workspaceHarness, openRetainedStudy } from './studyWorkspaceHarness'

/**
 * Builds the Cycle 0072 window: a confirmed Study layout, a fourth group of the learner's with two unrelated editors, and the captured source's tab moved into that group.
 * @returns The harness with the displaced source (Cycle 0071 N71 VS Code attempts 1-2).
 * @example const harness = await studyBesideLeftoverGroup()
 */
async function studyBesideLeftoverGroup() {
  const harness = await workspaceHarness(false)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  await openRetainedStudy(harness)
  await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
    orientation: 0,
    groups: [{}, {}, {}, {}],
  })
  harness.focusMutableDraft('data.ts', 4)
  harness.focusMutableDraft('search.tsx', 4)
  harness.moveSource(4)
  return harness
}

/** Lists the labels of every open tab in the order of the groups. @example openLabels(harness) // => ['data.ts', 'search.tsx'] */
function openLabels(harness: Awaited<ReturnType<typeof workspaceHarness>>) {
  return harness.groups.flatMap((group) => group.tabs.map((tab) => tab.label))
}

for (const [recovery, run] of [
  [
    'one Arrange Study Workspace',
    async (
      harness: Awaited<ReturnType<typeof workspaceHarness>>,
    ): Promise<void> => {
      await harness.reader.action('arrange')
    },
  ],
  [
    'the Study pane’s Restore Study workspace layout alone',
    async (
      harness: Awaited<ReturnType<typeof workspaceHarness>>,
    ): Promise<void> => {
      // The Study pane's button runs the same action as the pane (fromPane true), without the command's focus step.
      await harness.reader.action('arrange', true)
    },
  ],
  [
    'Codebook: Focus Application followed by Arrange Study Workspace',
    async (
      harness: Awaited<ReturnType<typeof workspaceHarness>>,
    ): Promise<void> => {
      await harness.reader.action('focus-app')
      await harness.reader.action('arrange')
    },
  ],
] as const)
  // Value: protects=a learner whose captured source tab stands in a leftover editor group beside two of their own files gets the Study layout confirmed by the public recovery, with both files still open; fails_when=the Study pane keeps "The application or source pane is no longer in its Study destination" (or Arrange refuses with "More than three editor groups are open") and the source tab never returns to the Study source column; why_new=Cycle 0072 task 1 (N71 VS Code attempts 1-2, N70b); seam=the workspace harness with a fourth editor group, moveSource and the reader's arrange and focus-app actions; no_claim=the failed run itself (INPUT_NOT_ACCEPTED) is not run: the retained Study stands in for the window it leaves, and native VS Code behaviour is C72-1's
  test(`${recovery} confirms the Study layout and keeps the learner's files when the captured source stands in a leftover editor group`, async () => {
    // Arrange: Study panes in columns 1-3, data.ts and search.tsx in a fourth group, the captured source tab moved into that group.
    const harness = await studyBesideLeftoverGroup()
    try {
      assert.equal(
        harness.reader.presentationState().layoutConfirmed,
        false,
        'the setup must start from the refused state',
      )
      // Act
      await run(harness)
      // Assert
      const state = harness.reader.presentationState()
      assert.deepEqual(
        { layoutConfirmed: state.layoutConfirmed, reason: state.reason },
        { layoutConfirmed: true, reason: undefined },
      )
      assert.equal(openLabels(harness).includes('data.ts'), true)
      assert.equal(openLabels(harness).includes('search.tsx'), true)
      assert.equal(harness.sourceColumn(), 2)
    } finally {
      await harness.close()
    }
  })

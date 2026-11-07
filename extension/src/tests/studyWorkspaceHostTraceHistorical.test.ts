import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { openRetainedStudy, workspaceHarness } from './studyWorkspaceHarness'
import { parseHostTrace } from './utils/hostTraceReplay'

/** The sanitized native take of the historical scenario (Cursor 3.29.9, nextjs-dashboard), read from the source tree because the compiled test runs from `dist`. */
const HISTORICAL_TRACE = join(
  __dirname,
  '..',
  '..',
  'src',
  'tests',
  'fixtures',
  'host-traces',
  'historical-fourth-group-arrange-restore-cursor-3.29.9.jsonl',
)

// Value: protects=the historical C72 class (a learner's fourth group beside the Study, then Arrange and Restore) replayed in the order Cursor 3.29.9 really reported it: Open Study Workspace, a learner group with search.tsx and data.ts, Arrange Study Workspace, the Study pane's Restore; fails_when=any step is refused or times out, the fake's final tab groups, active group or layout differ from the take's final snapshot, or a model burst or trace event is left unaligned; why_new=Cycle 0094 task 12 spike (eng review R9); seam=workspaceHarness hostOrder over the sanitized native take, openRetainedStudy, the reader's arrange action; no_claim=the learner's drag gestures (the harness opens the two files in the learner group directly), Cursor's timing beyond the 2 s gap cap
test(
  'the historical fourth-group Arrange and Restore replays in the recorded Cursor order and ends in the recorded window',
  {
    // R9 spike outcome: Open Study Workspace is refused ("Native pane, group or focus changed while presentation waited") before any trace event reaches the workspace, because the replay delivers each burst after the fake's synchronous structure change and the guard of readMainEditorGrid reads the group list in between. The contract needs a revision before this can pass; see the Cycle 0094 part 2 report.
    todo: 'blocked by the host-order delivery contract: events are delivered after the fake has already changed the groups',
  },
  async () => {
    // Arrange: Cursor with data.ts and cards.tsx open in the Application's group and the Agent chat part beside; the replay starts with the take's first Codebook step.
    const harness = await workspaceHarness(false, false, undefined, {
      hostOrder: parseHostTrace(readFileSync(HISTORICAL_TRACE, 'utf8')),
    })
    harness.hostOrder!.bypass(true)
    harness.useNativeLayout({ orientation: 0, groups: [{}] })
    harness.focusMutableDraft('data.ts', 1)
    harness.focusMutableDraft('cards.tsx', 1)
    harness.addSeparateEditorPart()
    harness.hostOrder!.bypass(false)
    try {
      // Act
      await openRetainedStudy(harness)
      // The learner adds a group right of the Study and puts search.tsx, then data.ts into it.
      const learnerColumn = harness.groups.length
      await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
        orientation: 0,
        groups: Array.from({ length: learnerColumn }, () => ({})),
      })
      harness.focusMutableDraft('search.tsx', learnerColumn)
      harness.focusMutableDraft('data.ts', learnerColumn)
      await harness.reader.action('arrange')
      await harness.reader.action('arrange', true)
      await harness.hostOrder!.settled()
      const result = harness.hostOrder!.result()

      // Assert
      assert.deepEqual(result.fakeState, result.traceState)
      assert.equal(result.unmatchedModelBursts, 0)
      assert.equal(result.unreachedTraceBursts, 0)
    } finally {
      await harness.close()
    }
  },
)

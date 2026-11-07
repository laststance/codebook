/**
 * Replays the Arrange window of the historical fourth-group take (Cursor 3.29.9, nextjs-dashboard; Cycle 0094 task 12, R13).
 *
 * The take was recorded before the recorder had a Mark command, so its three marks are reconstructed from the recorded quiet gaps, not typed during the take. Each mark sits 1 ms before the first event that follows its gap, with the snapshot of the state before it:
 * - `open-study` (tMs 12815): the gap after the initial snapshot (tMs 15, 12.8 s of nothing); the first event after it is the empty group 1 becoming active at tMs 12816, the start of the Open Study Workspace bursts.
 * - `learner-group` (tMs 49606): the gap after the Study's captured source settled (tMs 13128, 36.5 s); the first event after it opens the learner's group at tMs 49607.
 * - `arrange` (tMs 95270): the gap after `data.ts` was moved into the learner's group (tMs 83217, 12 s); the first event after it is the Study group becoming active at tMs 95271, the Arrange. The Study pane's Restore that follows produced no event, so the window runs to the take's end.
 * Only `arrange` is replayed here; the other two are recorded for the Open Study Workspace window, whose harness fixture still differs from the take (captured source name, chat tab names).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { openRetainedStudy, workspaceHarness } from './studyWorkspaceHarness'
import {
  hostTraceWindow,
  parseHostTrace,
  roleNormalize,
  startSnapshot,
} from './utils/hostTraceReplay'

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

/** Tabs the harness's fixture adds to Cursor's window that the native take did not have: the article source the native layout opens in column 1. Dropped from both sides. */
const FIXTURE_ONLY_TABS = ['article-source.ts']

// Value: protects=the historical C72 class (a learner's fourth group beside the Study, then Arrange) replayed on the Arrange window of the order Cursor 3.29.9 really reported it; fails_when=the harness's start state differs from the take's at the arrange mark (fixture drift), Arrange is refused or times out, the fake's final role-normalized tab groups, active group or layout differ from the take's end state, or a model burst or trace event is left unaligned; why_new=Cycle 0094 task 12 (eng review R13, windowed replay); seam=workspaceHarness hostOrder in the with-operation delivery over the take's arrange window, openRetainedStudy, the reader's arrange action; no_claim=that the fake itself reports the Arrange's group activation (it reports none, so the take's two reports are delivered as unsolicited trailing events and its layout follows the take's recorded layout), the learner's drag gestures (the harness opens the two files in the learner group directly), Cursor's timing beyond the 2 s gap cap, the Open Study Workspace window (marks open-study and learner-group are recorded for it but its fixture differs from the harness's)
test('the historical fourth-group Arrange window replays in the recorded Cursor order and ends in the recorded window', async () => {
  // Arrange: the take's state at its arrange mark, built with harness helpers while the replay is bypassed.
  const window = hostTraceWindow(
    parseHostTrace(readFileSync(HISTORICAL_TRACE, 'utf8')),
    'arrange',
  )
  const harness = await workspaceHarness(false, false, undefined, {
    hostOrder: window.trace,
    hostOrderDelivery: 'with-operation',
  })
  const replay = harness.hostOrder!
  replay.bypass(true)
  harness.useNativeLayout({ orientation: 0, groups: [{}] })
  harness.focusMutableDraft('data.ts', 1)
  harness.focusMutableDraft('cards.tsx', 1)
  harness.addSeparateEditorPart()
  try {
    await openRetainedStudy(harness)
    // The learner's fourth group right of the Study: search.tsx first, then data.ts in front.
    const learnerColumn = harness.groups.length
    await harness.editor.commands.executeCommand('vscode.setEditorLayout', {
      // The take's layout at the mark: the Application above the captured source in the first column, then the Study and the learner's group.
      orientation: 0,
      groups: [
        { size: 220, groups: [{ size: 339 }, { size: 339 }] },
        { size: 220 },
        { size: 500 },
      ],
    })
    harness.focusMutableDraft('search.tsx', learnerColumn)
    harness.focusMutableDraft('data.ts', learnerColumn)
    replay.bypass(false)
    const options = { dropTabLabels: FIXTURE_ONLY_TABS }
    assert.deepEqual(
      replay.roleNormalizedState(options),
      roleNormalize(startSnapshot(window), options),
      'the harness state at the window start must equal the take at its arrange mark (fixture drift, not a product failure)',
    )

    // Act
    await harness.reader.action('arrange')
    await harness.reader.action('arrange', true)
    await replay.settled()
    await replay.deliverTrailing()
    const result = replay.windowResult(options)

    // Assert
    assert.deepEqual(result.fakeState, result.traceState)
    // The fake reports no listener event for the Arrange's reveal of the Study group, so every model burst is matched (none was made) and the take's two reports (the Study group active, no active text editor) reach the workspace as unsolicited trailing events.
    assert.equal(result.unmatchedModelBursts, 0)
    assert.equal(result.unreachedTraceBursts, 2)
    const presentation = harness.reader.presentationState()
    assert.deepEqual(
      {
        layoutConfirmed: presentation.layoutConfirmed,
        reason: presentation.reason,
      },
      { layoutConfirmed: true, reason: undefined },
    )
  } finally {
    await harness.close()
  }
})

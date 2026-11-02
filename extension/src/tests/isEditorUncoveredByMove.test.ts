import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REFUSAL_REPORT_LABEL_CHARS } from '../constants'
import { isEditorUncoveredByMove } from '../utils/isEditorUncoveredByMove'
import { describePlacementRefusal } from '../utils/placementRefusalReport'

const DATA = 'file:///work/data.ts'
const CARDS = 'file:///work/cards.tsx'

// Value: protects=the move watch's reading of the file that Codebook's own move of the Application uncovers in the learner's group as the move's effect, whatever the editor reported at arming; fails_when=the rule needs "no text editor" at arming, so Cursor's report of another editor before the move makes the uncovered file a learner's choice and the Recording is refused; why_new=Cycle 0072 task 5 native C72-2; seam=isEditorUncoveredByMove called with hand-built group states; no_claim=how the editor reports the file in a native run
test('accepts the file in front of the Application group since the pane left it although another editor was reported at arming', () => {
  // Arrange
  const input = {
    editorFile: CARDS,
    frontNow: CARDS,
    wasCoveredByPane: true,
    uncoveredFile: CARDS,
    wasNoEditorAtArming: false,
    hadLearnerFrontAtArming: false,
  }

  // Act
  const accepted = isEditorUncoveredByMove(input)

  // Assert
  assert.equal(accepted, true)
})

// Value: protects=the learner's pick of another file that the Application's group held behind the pane, with the editor armed on a file elsewhere and no active-editor event for the file the move uncovered: the pick is the learner's, with or without an editor at arming; fails_when=every file held behind the pane is accepted, so a click on the group's other tab is taken as the move's effect and the recording arranges over it; why_new=Cycle 0072 task 5 review round (CodeRabbit r13a, OCR lens B medium 1 and lens C L2); seam=isEditorUncoveredByMove called with hand-built group states; no_claim=how the editor reports the pick in a native run
test("refuses another file the Application's group held behind the pane than the one in front since the pane left", () => {
  // Arrange
  const pickedOtherHeldFile = {
    editorFile: DATA,
    frontNow: DATA,
    wasCoveredByPane: true,
    uncoveredFile: CARDS,
    wasNoEditorAtArming: false,
    hadLearnerFrontAtArming: false,
  }
  const pickedOtherHeldFileWithNoEditorAtArming = {
    ...pickedOtherHeldFile,
    wasNoEditorAtArming: true,
  }

  // Act
  const results = [
    pickedOtherHeldFile,
    pickedOtherHeldFileWithNoEditorAtArming,
  ].map(isEditorUncoveredByMove)

  // Assert
  assert.deepEqual(results, [false, false])
})

// Value: protects=the learner's choice of a file the Application's group never held behind the pane, of a file that is not in front of its group, and of a group whose learner file was already in front at arming; fails_when=the rule accepts any file in front of any group, so a file the learner opened, a hidden file or an editor elsewhere is taken as the move's effect and the recording arranges over it; why_new=Cycle 0072 task 5 native C72-2; seam=isEditorUncoveredByMove called with hand-built group states; no_claim=none
test('refuses a file the group did not hold, a file not in front, and a group that showed a learner file at arming', () => {
  // Arrange
  const openedFile = {
    editorFile: 'file:///work/notes.ts',
    frontNow: 'file:///work/notes.ts',
    wasCoveredByPane: true,
    uncoveredFile: CARDS,
    wasNoEditorAtArming: false,
    hadLearnerFrontAtArming: false,
  }
  // Only hadLearnerFrontAtArming differs from the accepted case below.
  const otherGroupWithLearnerFront = {
    editorFile: CARDS,
    frontNow: CARDS,
    wasCoveredByPane: false,
    uncoveredFile: undefined,
    wasNoEditorAtArming: true,
    hadLearnerFrontAtArming: true,
  }
  const notInFront = {
    editorFile: DATA,
    frontNow: CARDS,
    wasCoveredByPane: true,
    uncoveredFile: CARDS,
    wasNoEditorAtArming: false,
    hadLearnerFrontAtArming: false,
  }

  // Act
  const results = [openedFile, otherGroupWithLearnerFront, notInFront].map(
    isEditorUncoveredByMove,
  )

  // Assert
  assert.deepEqual(results, [false, false, false])
})

// Value: protects=the earlier rule for a group that showed no learner file while no text editor was active; fails_when=the rule drops that case, so the file a move uncovers in a group the pane did not stand in front of is refused again; why_new=Cycle 0072 task 5 native C72-2 (keeps the Cycle 0046 row 710 reading); seam=isEditorUncoveredByMove called with hand-built group states; no_claim=none
test('keeps accepting the front file of a group that showed no learner file while no text editor was active', () => {
  // Arrange
  const input = {
    editorFile: CARDS,
    frontNow: CARDS,
    wasCoveredByPane: false,
    uncoveredFile: undefined,
    wasNoEditorAtArming: true,
    hadLearnerFrontAtArming: false,
  }

  // Act
  const accepted = isEditorUncoveredByMove(input)

  // Assert
  assert.equal(accepted, true)
})

// Value: protects=the refusal entry naming the active text editor at arming and at refusal, so a native failure names its cause; fails_when=the entry leaves the editors out or prints the editors under other labels; why_new=Cycle 0072 task 5 native C72-2; seam=describePlacementRefusal with editors; no_claim=the move watch's own sanitizing of the file name
test('prints the active text editor at arming and at refusal in the refusal entry', () => {
  // Arrange
  const input = {
    guard: 'watchLearnerViewDuringApplicationMove',
    failedChecks: ['active text editor'],
    armedAtMs: 100,
    nowMs: 150,
    before: [],
    after: [],
    editors: {
      atArming: { name: 'data.ts', viewColumn: 2 },
      atRefusal: { name: 'cards.tsx', viewColumn: 2 },
    },
    events: [],
  }

  // Act
  const report = describePlacementRefusal(input)

  // Assert
  assert.ok(report.includes('Failed checks: active text editor'))
  assert.ok(report.includes('Active text editor at arming: data.ts (column 2)'))
  assert.ok(
    report.includes('Active text editor at refusal: cards.tsx (column 2)'),
  )
})

// Value: protects=the bounded refusal entry: a long file name is cut to the label length with its column kept whole, an editor without a column prints no "column undefined", and no editor prints none; fails_when=the entry prints a name of any length, cuts the column suffix off with the name or prints "column undefined"; why_new=Cycle 0072 task 5 review round (cheap items); seam=describePlacementRefusal with editors; no_claim=the file names a native run reports
test('cuts a long editor file name to the label length, keeps the column and omits an absent one', () => {
  // Arrange
  const longName = `${'n'.repeat(REFUSAL_REPORT_LABEL_CHARS + 20)}.ts`
  const input = {
    guard: 'watchLearnerViewDuringApplicationMove',
    armedAtMs: 100,
    nowMs: 150,
    before: [],
    after: [],
    editors: {
      atArming: { name: longName, viewColumn: 3 },
      atRefusal: { name: 'cards.tsx', viewColumn: undefined },
    },
    events: [],
  }
  const withNone = {
    ...input,
    editors: { ...input.editors, atRefusal: undefined },
  }

  // Act
  const report = describePlacementRefusal(input)
  const reportWithNone = describePlacementRefusal(withNone)

  // Assert
  assert.ok(
    report.includes(
      `Active text editor at arming: ${'n'.repeat(REFUSAL_REPORT_LABEL_CHARS)} (column 3)`,
    ),
  )
  assert.ok(report.includes('Active text editor at refusal: cards.tsx\n'))
  assert.ok(reportWithNone.includes('Active text editor at refusal: none\n'))
})

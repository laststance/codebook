import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isEditorUncoveredByMove } from '../utils/isEditorUncoveredByMove'
import { describePlacementRefusal } from '../utils/placementRefusalReport'

const DATA = 'file:///work/data.ts'
const CARDS = 'file:///work/cards.tsx'

// Value: protects=the move watch's reading of the file that Codebook's own move of the Application uncovers in the learner's group as the move's effect, whatever the editor reported at arming; fails_when=the rule needs "no text editor" at arming, so Cursor's report of another editor before the move makes the uncovered file a learner's choice and the Recording is refused; why_new=Cycle 0072 task 5 native C72-2; seam=isEditorUncoveredByMove called with hand-built group states; no_claim=how the editor reports the file in a native run
test('accepts the file that was behind the Application as the move effect although another editor was reported at arming', () => {
  // Arrange
  const input = {
    editorFile: CARDS,
    frontNow: CARDS,
    heldBehindPane: [DATA, CARDS],
    wasNoEditorAtArming: false,
    hadLearnerFrontAtArming: false,
  }

  // Act
  const accepted = isEditorUncoveredByMove(input)

  // Assert
  assert.equal(accepted, true)
})

// Value: protects=the learner's choice of a file the group did not hold behind the Application, and of an editor in a group the Application did not leave; fails_when=the rule accepts any file in front of any group, so a file the learner opened or an editor elsewhere is taken as the move's effect and the recording arranges over it; why_new=Cycle 0072 task 5 native C72-2; seam=isEditorUncoveredByMove called with hand-built group states; no_claim=none
test('refuses a file the group did not hold behind the Application and a group the Application did not leave', () => {
  // Arrange
  const openedFile = {
    editorFile: 'file:///work/notes.ts',
    frontNow: 'file:///work/notes.ts',
    heldBehindPane: [DATA, CARDS],
    wasNoEditorAtArming: false,
    hadLearnerFrontAtArming: false,
  }
  const otherGroup = {
    editorFile: CARDS,
    frontNow: CARDS,
    heldBehindPane: undefined,
    wasNoEditorAtArming: false,
    hadLearnerFrontAtArming: true,
  }
  const notInFront = {
    editorFile: DATA,
    frontNow: CARDS,
    heldBehindPane: [DATA, CARDS],
    wasNoEditorAtArming: false,
    hadLearnerFrontAtArming: false,
  }

  // Act
  const results = [openedFile, otherGroup, notInFront].map(
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
    heldBehindPane: undefined,
    wasNoEditorAtArming: true,
    hadLearnerFrontAtArming: false,
  }

  // Act
  const accepted = isEditorUncoveredByMove(input)

  // Assert
  assert.equal(accepted, true)
})

// Value: protects=the refusal entry naming the active text editor at arming and at refusal, so a native failure names its cause; fails_when=the entry leaves the editors out or prints a full path; why_new=Cycle 0072 task 5 native C72-2; seam=describePlacementRefusal with editors; no_claim=the move watch's own wording of the editor
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
      atArming: 'data.ts (column 2)',
      atRefusal: 'cards.tsx (column 2)',
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

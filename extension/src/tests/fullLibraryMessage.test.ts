import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fullLibraryMessage } from '../utils/fullLibraryMessage'
import { historyExclusionReason } from '../utils/historyExclusionReason'
import { systemTrashName } from '../utils/systemTrashName'

// The product names the system Trash the way the host's operating system does; the expected texts follow it, so the suite also holds on Windows ("Recycle Bin").
const TRASH = systemTrashName()

// Value: protects=each refusal of a full library names a remedy that works at the limit in force; fails_when=a sentence drifts between its three call sites or names the setting at the maximum; why_new=the texts lived in three literals that named the setting only; seam=none
test('a full library below the maximum limit names the setting first and then the removal of a saved study', () => {
  // Arrange / Act / Assert
  assert.equal(
    fullLibraryMessage('run', 64),
    'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study from Saved studies in the Study workspace, before starting another run. Only the learner can do either; an editor agent cannot. Existing learning was kept.',
  )
  assert.equal(
    fullLibraryMessage('save', 255),
    'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study from Saved studies in the Study workspace, then retry storage. Existing learning was kept.',
  )
  assert.equal(
    fullLibraryMessage('recording', 1),
    'Recording library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study that has a recording from Saved studies in the Study workspace, before starting another session. Existing recordings were kept.',
  )
})

test('a full library at the maximum limit of 256 names only the removal of a saved study', () => {
  // Arrange / Act / Assert
  assert.equal(
    fullLibraryMessage('run', 256),
    'Study library is full at its maximum of 256 saved studies. Delete a saved study from Saved studies in the Study workspace before starting another run. Only the learner can delete a saved study; an editor agent cannot. Existing learning was kept.',
  )
  assert.equal(
    fullLibraryMessage('save', 256),
    'Study library is full at its maximum of 256 saved studies. Delete a saved study from Saved studies in the Study workspace, then retry storage. Existing learning was kept.',
  )
  assert.equal(
    fullLibraryMessage('recording', 256),
    'Recording library is full at its maximum of 256 recordings. Delete a saved study that has a recording from Saved studies in the Study workspace before starting another session. Existing recordings were kept.',
  )
})

// Value: protects=texts about a removed study use the word the learner's system uses; fails_when=Windows learners are told about a Trash their system does not have; why_new=removal texts are new; seam=none
test('the system Trash is called Recycle Bin on Windows and Trash elsewhere', () => {
  // Arrange / Act / Assert
  assert.equal(systemTrashName('win32'), 'Recycle Bin')
  assert.equal(systemTrashName('darwin'), 'Trash')
  assert.equal(systemTrashName('linux'), 'Trash')
  assert.equal(
    historyExclusionReason('removed-by-learner', systemTrashName('win32')),
    'The learner moved this saved study to the Recycle Bin.',
  )
})

test('a run that is still awaiting its admission, or is not excluded, has no exclusion reason', () => {
  // Arrange / Act / Assert
  assert.equal(historyExclusionReason('awaiting-admission'), undefined)
  assert.equal(historyExclusionReason(undefined), undefined)
  assert.equal(
    historyExclusionReason('refused-at-admission'),
    'The run was refused before it started; nothing was saved.',
  )
})

// Value: protects=an editor whose Trash cannot move a saved study is never told to delete one; fails_when=the texts at the maximum keep naming a removal that cannot work in that editor (0038-F9, DR19); why_new=the delete remedy was named unconditionally; seam=none
test('a full library in an editor whose Trash refused a removal names no delete remedy, and at the maximum says that nothing can be deleted here', () => {
  // Arrange / Act / Assert
  assert.equal(
    fullLibraryMessage('run', 256, 'trash-refused'),
    `Study library is full at its maximum of 256 saved studies, and this editor could not move a saved study to the ${TRASH} in this session, so no saved study can be deleted here. Existing learning was kept.`,
  )
  assert.equal(
    fullLibraryMessage('save', 64, 'trash-refused'),
    `Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, then retry storage; this editor could not move a saved study to the ${TRASH} in this session. Existing learning was kept.`,
  )
  assert.equal(
    fullLibraryMessage('recording', 256, 'trash-refused'),
    `Recording library is full at its maximum of 256 recordings, and this editor could not move a saved study to the ${TRASH} in this session, so no recording can be deleted here. Existing recordings were kept.`,
  )
})

// Value: protects=a window without a Trash is not told that a removal failed, and at the maximum every refusal names the removal by hand; fails_when=a save or a recording refused there claims a failed attempt, or names no next step at the maximum (RT-7, DX-20, ER-12); why_new=a window without a Trash had no sentences of its own; seam=none
test('a save or a recording refused by a full library in a window without a Trash says that the window has none, and at the maximum names the removal by hand', () => {
  // Arrange / Act / Assert
  assert.equal(
    fullLibraryMessage('save', 64, 'no-trash'),
    'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, then retry storage; this window has no Trash, so Codebook cannot delete a saved study here. Existing learning was kept.',
  )
  assert.equal(
    fullLibraryMessage('save', 256, 'no-trash'),
    'Study library is full at its maximum of 256 saved studies, and this window has no Trash, so Codebook cannot delete a saved study here. Saved studies lists the files of a chosen study for removal by hand; remove them, then retry storage. Existing learning was kept.',
  )
  assert.equal(
    fullLibraryMessage('recording', 64, 'no-trash'),
    'Recording library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings before starting another session; this window has no Trash, so Codebook cannot delete a saved study here. Existing recordings were kept.',
  )
  assert.equal(
    fullLibraryMessage('recording', 256, 'no-trash'),
    'Recording library is full at its maximum of 256 recordings, and this window has no Trash, so Codebook cannot delete a saved study here. Saved studies lists the files of a chosen study that has a recording for removal by hand; remove them before starting another session. Existing recordings were kept.',
  )
})

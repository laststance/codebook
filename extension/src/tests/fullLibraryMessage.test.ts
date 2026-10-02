import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fullLibraryMessage } from '../utils/fullLibraryMessage'
import { historyExclusionReason } from '../utils/historyExclusionReason'
import { systemTrashName } from '../utils/systemTrashName'

// Value: protects=each refusal of a full library names a remedy that works at the limit in force; fails_when=a sentence drifts between its three call sites or names the setting at the maximum; why_new=the texts lived in three literals that named the setting only; seam=none
test('a full library below the maximum limit names the setting first and then the removal of a saved study', () => {
  // Arrange / Act / Assert
  assert.equal(
    fullLibraryMessage('run', 64),
    'Study library is full. Increase Codebook: Saved Study Limit (codebook.savedStudyLimit) in Settings, or delete a saved study from Saved studies in the Study workspace, before starting another run. Existing learning was kept.',
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
    'Study library is full at its maximum of 256 saved studies. Delete a saved study from Saved studies in the Study workspace before starting another run. Existing learning was kept.',
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

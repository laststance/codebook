import assert from 'node:assert/strict'
import { test } from 'node:test'

import { savedStudyIdentityLine } from '../utils/savedStudyIdentityLine'
import { studyRemovalMessages } from '../utils/studyRemovalMessages'

// Value: protects=the dialog, the status line and the failures of a removal say what is true and what to do next; fails_when=a sentence drifts or promises a count the library cannot give; why_new=removal texts are new; seam=none
test('a removal is worded with the Trash, the room it left and the next step when it made room for a refused run', () => {
  // Arrange
  const messages = studyRemovalMessages('Trash')
  // Act / Assert
  assert.equal(messages.confirmTitle, 'Move this saved study to the Trash?')
  assert.equal(messages.confirmButton, 'Move to Trash')
  assert.equal(
    messages.confirmDetail(
      'Repository browser study · 9/20/2026 · demonstrated · 22222222',
    ),
    'Repository browser study · 9/20/2026 · demonstrated · 22222222\n\nAny saved recording moves with it, and so does the raw evidence of its run unless another Codebook window may still be using it. What you marked as understood is kept. Repository Wiki links to this study will show as unavailable.',
  )
  assert.equal(messages.moving, 'Moving the saved study to the Trash…')
  assert.equal(
    messages.moved({ count: 63, limit: 64 }, false),
    'Saved study moved to the Trash. The library now holds 63 of 64 saved studies.',
  )
  assert.equal(
    messages.moved({ count: 255, limit: 256 }, true),
    'Saved study moved to the Trash. The library now holds 255 of 256 saved studies. Ask your editor agent to start the run again.',
  )
  assert.equal(
    messages.moved({ count: 3 }, false),
    'Saved study moved to the Trash.',
  )
  assert.equal(
    messages.moved({ count: 63, limit: 64 }, true, true),
    "Saved study moved to the Trash. The library now holds 63 of 64 saved studies. Ask your editor agent to start the run again. The run's raw evidence was left in place because its Codebook window may still be open.",
  )
  assert.equal(
    messages.nothingMoved('EPERM: operation not permitted'),
    'The saved study could not be moved to the Trash. Nothing was deleted. EPERM: operation not permitted',
  )
  assert.equal(
    messages.partlyMoved('EPERM: operation not permitted'),
    'The saved study was only partly moved to the Trash; delete it again to finish. EPERM: operation not permitted',
  )
  assert.equal(
    messages.lockNotReleased('EPERM: operation not permitted, unlink'),
    'Learning storage lock could not be released after the removal: EPERM: operation not permitted, unlink',
  )
})

// Value: protects=Windows learners read the word their system uses in every removal text; fails_when=one text bypasses the platform word; why_new=removal texts are new; seam=none
test('on Windows every removal text says Recycle Bin', () => {
  // Arrange
  const messages = studyRemovalMessages('Recycle Bin')
  // Act / Assert
  assert.equal(
    messages.confirmTitle,
    'Move this saved study to the Recycle Bin?',
  )
  assert.equal(messages.confirmButton, 'Move to Recycle Bin')
  assert.equal(
    messages.confirmDetail('Repository browser study'),
    'Repository browser study\n\nAny saved recording moves with it, and so does the raw evidence of its run unless another Codebook window may still be using it. What you marked as understood is kept. Repository Wiki links to this study will show as unavailable.',
  )
  assert.equal(messages.moving, 'Moving the saved study to the Recycle Bin…')
  assert.equal(
    messages.moved({ count: 1, limit: 2 }, false),
    'Saved study moved to the Recycle Bin. The library now holds 1 of 2 saved studies.',
  )
  assert.equal(
    messages.nothingMoved('locked'),
    'The saved study could not be moved to the Recycle Bin. Nothing was deleted. locked',
  )
  assert.equal(
    messages.partlyMoved('locked'),
    'The saved study was only partly moved to the Recycle Bin; delete it again to finish. locked',
  )
})

// Value: protects=the confirmation names the study with the same parts its list entry shows; fails_when=the dialog names another label, outcome or id tail than the list; why_new=the host builds this line itself; seam=none
test('the confirmation names a saved study by its label, saved date, outcome and the last eight characters of its id', () => {
  // Arrange
  const savedAt = '2026-09-20T00:00:10.000Z'
  // Act
  const configured = savedStudyIdentityLine({
      id: '11111111-1111-4111-8111-111111111111_22222222-2222-4222-8222-222222222222',
      profile: 'repository-browser',
      format: 'v3',
      savedAt,
      outcome: 'demonstrated',
    }),
    legacy = savedStudyIdentityLine({
      id: '11111111-1111-4111-8111-111111111111_33333333-3333-4333-8333-3333abcdef01',
      profile: undefined,
      format: 'legacy-v1',
      savedAt,
      outcome: 'Unsupported historical format; original file preserved',
    })
  // Assert: only the date's rendering depends on the machine's locale.
  assert.equal(
    configured,
    `Repository browser study · ${new Date(savedAt).toLocaleString()} · demonstrated · 22222222`,
  )
  assert.equal(
    legacy,
    `Unknown scenario (legacy) · ${new Date(savedAt).toLocaleString()} · Unsupported historical format; original file preserved · abcdef01`,
  )
})

// Value: protects=after a removal on a library whose limit was lowered below its stored count, the learner reads how many more studies must go; fails_when=the line reads "holds 69 of 64 saved studies." and names no next step (0038-F16); why_new=the count sentence was only tested below the limit; seam=none
test('the moved line of a library still at or above its limit says that it is still full and how many more studies must be deleted', () => {
  // Arrange
  const messages = studyRemovalMessages('Trash')
  // Act
  const aboveLimit = messages.moved({ count: 69, limit: 64 }, false),
    atLimit = messages.moved({ count: 64, limit: 64 }, false)
  // Assert
  assert.equal(
    aboveLimit,
    'Saved study moved to the Trash. The library now holds 69 of 64 saved studies and is still full; delete 6 more before another study can be saved.',
  )
  assert.equal(
    atLimit,
    'Saved study moved to the Trash. The library now holds 64 of 64 saved studies and is still full; delete 1 more before another study can be saved.',
  )
})

// Value: protects=a removal that stopped at a path it could not look at again says that nobody knows whether the study moved, and what to do; fails_when=the learner reads "Nothing was deleted" or "only partly moved" for a study that may be in the Trash, whole or in part (AD10); why_new=Cycle 0046 adversarial review AD10: the outcome of an unknown move is new; seam=none
test('a removal whose move could not be checked says that Codebook could not tell whether the study moved, in the Trash’s word, with the next step', () => {
  // Arrange
  const onMacAndLinux = studyRemovalMessages('Trash'),
    onWindows = studyRemovalMessages('Recycle Bin')
  // Act
  const lines = {
    trash: onMacAndLinux.moveUnknown('EACCES: permission denied'),
    recycleBin: onWindows.moveUnknown('EACCES: permission denied'),
  }
  // Assert
  assert.deepEqual(lines, {
    trash:
      'Codebook could not tell whether the saved study was moved to the Trash; delete it again to finish. EACCES: permission denied',
    recycleBin:
      'Codebook could not tell whether the saved study was moved to the Recycle Bin; delete it again to finish. EACCES: permission denied',
  })
})

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { savedLaterNote } from '../utils/savedLaterNote'

// Value: protects=the learner reading in plain words when an explanation shown ahead of its saved time was saved; fails_when=one of the three sentences changes or two of them are swapped; why_new=Cycle 0045 cause 10 (rule 3); seam=none
test('an explanation shown before its saved time says whether it was saved while the pause was held, after the pause ended or after the recording ended', () => {
  // Act
  const notes = [
    savedLaterNote('while-pause-held'),
    savedLaterNote('after-pause-ended'),
    savedLaterNote('after-recording-ended'),
  ]

  // Assert
  assert.deepEqual(notes, [
    'This explanation was saved while this pause was held.',
    'This explanation was saved after this pause ended.',
    'This explanation was saved after the recording ended.',
  ])
})

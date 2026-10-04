import assert from 'node:assert/strict'
import { test } from 'node:test'

import { recordingNotShownReason } from '../utils/recordingNotShownReason'
import { withoutErrorName } from '../utils/withoutErrorName'

// Value: protects=the sentences built around a playback failure (the Open replay notice, the presentation reason of a recording that failed to load) naming the cause without the error's class name; fails_when=the name stays in front of the cause ("... could not be loaded (Error: ...)"), or a sentence that carries no error name loses its first words; why_new=Cycle 0045 local review study-1 #8 (the strip was written twice, in the reader and in recordingNotShownReason); seam=none
test('the string form of an error loses its leading error name, and a sentence without one stays as it is', () => {
  // Arrange / Act / Assert
  assert.equal(
    withoutErrorName('Error: The recording is unavailable.'),
    'The recording is unavailable.',
  )
  assert.equal(
    withoutErrorName('StudyError: Focus the Codebook work window.'),
    'Focus the Codebook work window.',
  )
  assert.equal(
    withoutErrorName('The recording is unavailable.'),
    'The recording is unavailable.',
  )
  assert.equal(
    withoutErrorName('Reload it. Error: the second sentence keeps its words.'),
    'Reload it. Error: the second sentence keeps its words.',
  )
})

// Value: protects=the presentation reason of a recording that failed to load naming the load's cause without "Error: "; fails_when=the reason reads "... could not be loaded (Error: ...)"; why_new=Cycle 0045 local review study-1 #8 (recordingNotShownReason now shares the strip and had no test of its own); seam=none
test('the reason of a recording that is not shown names the cause of the failed load without the error name', () => {
  // Arrange
  const failure =
    'Error: Configured recording article context is unavailable. Reload its saved context.'

  // Act
  const named = recordingNotShownReason(failure),
    unnamed = recordingNotShownReason(undefined)

  // Assert
  assert.equal(
    named,
    'The recording is not shown: it could not be loaded (Configured recording article context is unavailable. Reload its saved context.). Open the recording again, then restore the layout.',
  )
  assert.equal(
    unnamed,
    'The recording is not shown: it could not be loaded. Open the recording again, then restore the layout.',
  )
})

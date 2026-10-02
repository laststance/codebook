import assert from 'node:assert/strict'
import { test } from 'node:test'

import { playbackPreferenceNamesStudy } from '../utils/playbackPreferenceNamesStudy'

test('a playback position file that remembers the removed study moves with it', () => {
  // Arrange
  const preference = {
    version: 1,
    studyId: 'window_removed-run',
    positionMs: 2000,
  }
  // Act
  const names = playbackPreferenceNamesStudy(preference, 'window_removed-run')
  // Assert
  assert.equal(names, true)
})

test('a playback position file of another study, or one that holds no object, stays in place', () => {
  // Arrange
  const ofAnotherStudy = { version: 1, studyId: 'window_other-run' }
  // Act
  const answers = [ofAnotherStudy, null, 'window_removed-run', []].map(
    (preference) =>
      playbackPreferenceNamesStudy(preference, 'window_removed-run'),
  )
  // Assert
  assert.deepEqual(answers, [false, false, false, false])
})

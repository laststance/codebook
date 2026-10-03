import assert from 'node:assert/strict'
import { test } from 'node:test'

import { playbackPreferenceNamesStudy } from '../utils/playbackPreferenceNamesStudy'

// Value: protects=the playback position of a removed study goes to the Trash with it; fails_when=the position file keeps naming a study that is gone; why_new=the playback step of a removal; seam=none
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

// Value: protects=a removal leaves the playback position of another study and a file it cannot interpret; fails_when=another study's position is moved to the Trash; why_new=the playback step of a removal; seam=none
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

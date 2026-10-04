import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withoutStudy } from '../utils/withoutStudy'

// Value: protects=the reader lets go of an archive or a save state of a removed study; fails_when=something held under `id` or `studyId` of the removed study stays; why_new=the reader's cleanup after a removal; seam=none
test('what the reader holds for a removed study is let go, whether it names the study by id or by studyId', () => {
  // Arrange
  const archive = { id: 'window_removed-run', state: 'stopped' },
    learningSave = { studyId: 'window_removed-run', signature: 'abc' }
  // Act
  const kept = [
    withoutStudy(archive, 'window_removed-run'),
    withoutStudy(learningSave, 'window_removed-run'),
  ]
  // Assert
  assert.deepEqual(kept, [undefined, undefined])
})

// Value: protects=a removal leaves what the reader holds for other studies; fails_when=another study's archive is dropped, or an empty holder becomes a value; why_new=the reader's cleanup after a removal; seam=none
test('what the reader holds for another study stays, and nothing held stays nothing', () => {
  // Arrange
  const archive = { id: 'window_other-run', state: 'stopped' }
  // Act
  const kept = [
    withoutStudy(archive, 'window_removed-run'),
    withoutStudy(undefined, 'window_removed-run'),
  ]
  // Assert
  assert.deepEqual(kept, [
    { id: 'window_other-run', state: 'stopped' },
    undefined,
  ])
})

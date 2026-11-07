import assert from 'node:assert/strict'
import { test } from 'node:test'

import { STUDY_STYLES } from '../ui/constants'

// protects=the bottom-panel replay hides the library line with the learning header so it cannot push the 180 px transport; fails_when=the hiding rule of the compact replay loses #study-library-line; no_claim=the painted layout (Reader DOM and native checks)
test('the bottom-panel replay hides the library line together with the learning header', () => {
  // Arrange
  const hidingRule = STUDY_STYLES.split('\n').find((line) =>
    line.includes('body.moments-only[data-replay=true] .learning-header'),
  )

  // Act
  const hidesLibraryLine = hidingRule?.includes(
    'body.moments-only[data-replay=true] #study-library-line',
  )

  // Assert
  assert.equal(hidesLibraryLine, true)
})

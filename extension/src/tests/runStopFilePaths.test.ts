import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runStopFilePaths } from '../utils/runStopFilePaths'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { createCrossRuntimeStudy } from './utils/createCrossRuntimeStudy'

// Value: protects=the next Study placement keeps a preview that the run's debugger opened for an additional stop in another file, not only for the first stop; fails_when=only the first stop's file counts as run-owned, so an additional stop's preview ends the placement as a learner's foreign preview; why_new=Cycle 0064 pt2 integration review of task 8; seam=none; no_claim=the tab handling itself, which the Study workspace tests cover
test('a version 2 configuration lists the file of every stop, the additional stops in other files included, once each', () => {
  // Arrange
  const { configuration } = createCrossRuntimeStudy()
  // Act
  const paths = runStopFilePaths([configuration], '/codebook-test-repo')
  // Assert
  assert.deepEqual(
    [...paths],
    ['/codebook-test-repo/src/theme.ts', '/codebook-test-repo/src/mode.ts'],
  )
})

// Value: protects=a version 1 configuration's additional stops share the first stop's file, so its one file is listed once; fails_when=a stop path is resolved against another root or listed twice; why_new=Cycle 0064 pt2 integration review of task 8; seam=none; no_claim=version 2 files
test('a version 1 configuration lists its one stop file once', () => {
  // Arrange
  const { configuration } = createConfiguredStudy()
  // Act
  const paths = runStopFilePaths([configuration], '/codebook-test-repo')
  // Assert
  assert.deepEqual([...paths], ['/codebook-test-repo/src/theme.ts'])
})

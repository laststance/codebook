import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isWorkspaceHostSetterFrame } from '../utils/isWorkspaceHostSetterFrame'

// Value: protects=the pending-refusal Output text names the workspace method on Windows too; fails_when=the host-frame skip matches forward slashes only; why_new=Cycle 0094 part 3 review: noteMarker's regex missed V8's backslash frames; seam=none
test('a host setter frame is recognized with Windows backslashes and with POSIX slashes', () => {
  // Arrange
  const frames = [
    'at set closing (C:\\ext\\dist\\studyWorkspace\\replayOpeningHost.js:10:5)',
    'at set closing (/ext/dist/studyWorkspace/replayOpeningHost.js:10:5)',
    'at StudyWorkspace.open (/ext/dist/studyWorkspace.js:10:5)',
  ]
  // Act
  const recognized = frames.map(isWorkspaceHostSetterFrame)
  // Assert
  assert.deepEqual(recognized, [true, true, false])
})

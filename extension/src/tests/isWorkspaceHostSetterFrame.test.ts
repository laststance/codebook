import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isWorkspaceHostSetterFrame } from '../utils/isWorkspaceHostSetterFrame'

// Value: protects=the pending-refusal Output text names the workspace method on Windows too; fails_when=the host-frame skip matches forward slashes only; why_new=Cycle 0094 part 3 review: noteMarker's regex missed V8's backslash frames; seam=none
test('a host setter frame is recognized with Windows backslashes and with POSIX slashes', () => {
  // Arrange
  const markerSetter = 'at set closing (C:\\ext\\dist\\studyWorkspace.js:5:5)'
  const frames = [
    'at set closing (C:\\ext\\dist\\studyWorkspace\\replayOpeningHost.js:10:5)',
    'at set closing (/ext/dist/studyWorkspace/replayOpeningHost.js:10:5)',
    'at StudyWorkspace.open (/ext/dist/studyWorkspace.js:10:5)',
  ]
  // Act
  const recognized = frames.map((frame) =>
    isWorkspaceHostSetterFrame(frame, markerSetter),
  )
  // Assert
  assert.deepEqual(recognized, [true, true, false])
})

// Value: protects=the packaged extension's pending-refusal Output text names the part method as the workspace method it was, not `set`; fails_when=the skip depends on a `studyWorkspace/<part>Host.js` file name, which the one-file bundle never prints; why_new=Cycle 0094 part 3 Codex outside voice: dist/extension.js frames named the owner `set`; seam=none
test('a host setter frame inside the one-file package bundle is recognized by its accessor name', () => {
  // Arrange: V8's frames as the bundled extension prints them, where every file is dist/extension.js.
  const markerSetter =
    'at set presentationTransition (/ext/dist/extension.js:5100:7)'
  const hostSetter =
    'at set presentationTransition (/ext/dist/extension.js:9200:9)'
  // Act
  const recognized = isWorkspaceHostSetterFrame(hostSetter, markerSetter)
  // Assert
  assert.equal(recognized, true)
})

// Value: protects=a workspace method or another marker's setter that assigns a marker stays its named owner; fails_when=every setter frame is skipped, so the Output names the caller's caller; why_new=Cycle 0094 part 3: the accessor-name rule replaces the file-name rule; seam=none
test('a method frame and a setter of another accessor are not taken for the marker’s host setter', () => {
  // Arrange
  const markerSetter = 'at set closing (/ext/dist/extension.js:5100:7)'
  const frames = [
    'at StudyWorkspace.open (/ext/dist/extension.js:30:5)',
    'at set returningCurrent (/ext/dist/extension.js:40:5)',
  ]
  // Act
  const recognized = frames.map((frame) =>
    isWorkspaceHostSetterFrame(frame, markerSetter),
  )
  // Assert
  assert.deepEqual(recognized, [false, false])
})

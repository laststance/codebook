import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ReplayDebugSnapshot } from '../replayDebugSchemas'
import { resolveServerStopFrame } from '../utils/resolveServerStopFrame'

const SNAPSHOT_WITH_TOP_FRAME: ReplayDebugSnapshot = {
  version: 1,
  frames: [{ name: 'createItem', line: 12, column: 9, scopes: [] }],
  variables: [],
  limitations: [],
}

const SNAPSHOT_WITHOUT_FRAMES: ReplayDebugSnapshot = {
  version: 1,
  frames: [],
  variables: [],
  limitations: [],
}

// protects=a stop the debugger reported its own column and function name for is written at that position; fails_when=the snapshot's top frame overrides what the debugger reported; no_claim=whether the two agree
test('a server stop keeps the column and function name the debugger reported', () => {
  // Arrange
  const capture = {
    column: 4,
    frameName: 'handlePost',
    snapshot: SNAPSHOT_WITH_TOP_FRAME,
  }

  // Act
  const frame = resolveServerStopFrame(capture)

  // Assert
  assert.deepEqual(frame, { column: 4, frameName: 'handlePost' })
})

// protects=a debugger that does not report the column or function name still gives the stop the position of the snapshot's top frame; fails_when=the stop is written at column 1 with no name while the snapshot knows both; no_claim=which debugger omits them
test('a server stop without a reported column or name takes those of the snapshot top frame', () => {
  // Arrange
  const capture = { snapshot: SNAPSHOT_WITH_TOP_FRAME }

  // Act
  const frame = resolveServerStopFrame(capture)

  // Assert
  assert.deepEqual(frame, { column: 9, frameName: 'createItem' })
})

// protects=a stop whose snapshot holds no frame and whose debugger reported no position is still writable; fails_when=the resolution throws or yields an undefined column the journal rules refuse; no_claim=that such a stop is presentable (the seal judges that)
test('a server stop with no reported position and no snapshot frame is written at column 1 with an empty name', () => {
  // Arrange
  const capture = { snapshot: SNAPSHOT_WITHOUT_FRAMES }

  // Act
  const frame = resolveServerStopFrame(capture)

  // Assert
  assert.deepEqual(frame, { column: 1, frameName: '' })
})

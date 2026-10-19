import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeOtherWikiWindow } from '../utils/describeOtherWikiWindow'
import { formatClockTime } from '../utils/formatClockTime'

// Value: protects=the learner refused beside another window's running update, who needs to know which editor runs it, since when, and that only its end lets a press go on; fails_when=the sentence names the wrong editor, no start time or a time without its zone, or offers a way on that the running update does not allow; why_new=Cycle 0047 row 48 (P3dD4: covered through the flow tests only); seam=none; no_claim=when the start checks call it
test('a refusal beside another window’s running update names that window’s editor and start time and asks to press Update LLM Wiki again once it has finished', () => {
  // Arrange: one window runs its update in Cursor, another in VS Code, both since 12:00 UTC.
  const startedAtMs = Date.UTC(2026, 9, 3, 12, 0)
  const startTime = formatClockTime(startedAtMs, {})

  // Act
  const besideCursor = describeOtherWikiWindow({
    pid: 4242,
    windowId: '3f6c2a1e',
    host: 'cursor',
    startedAtMs,
  })
  const besideVsCode = describeOtherWikiWindow({
    pid: 4243,
    windowId: '9b1d7c40',
    host: 'vscode',
    startedAtMs,
  })

  // Assert
  assert.equal(
    besideCursor,
    `Another editor window is updating this Wiki (Cursor, started ${startTime}). Wait for it to finish, then press Update LLM Wiki again.`,
  )
  assert.equal(
    besideVsCode,
    `Another editor window is updating this Wiki (VS Code, started ${startTime}). Wait for it to finish, then press Update LLM Wiki again.`,
  )
})

// Value: protects=the learner who presses Update in the moment another window writes, removes or replaces its marker; fails_when=the sentence names an editor or a start time it cannot know, tells the learner to wait for a run to finish that may not exist, or words a marker being written as one in change; why_new=Cycle 0047 row 48 (P3dD4: covered through the flow tests only); seam=none; no_claim=how long the moment lasts
test('a refusal beside a marker another window is writing, or is removing or replacing, names no run and asks to try again in a moment', () => {
  // Act
  const beingWritten = describeOtherWikiWindow({
    beingWrittenSinceMs: Date.UTC(2026, 9, 3, 12, 0),
  })
  const inChange = describeOtherWikiWindow({ isMarkerInChange: true })

  // Assert
  assert.equal(
    beingWritten,
    'Another editor window is starting an update of this Wiki. Wait a moment and try again.',
  )
  assert.equal(
    inChange,
    'Another editor window is starting or ending an update of this Wiki. Wait a moment and try again.',
  )
})

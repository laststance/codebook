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

// Value: protects=the learner refused beside a marker file that stays unreadable (another user's private marker, or one a Windows program holds open for long), who needs to know which file is in the way, what makes it readable and when the refusal ends; fails_when=the refusal says "Wait a moment and try again" for all the 21 minutes 30 seconds such a file counts, names no file, or names a time at which the start is still refused; why_new=Cycle 0047 row 85 (ADV-8); seam=none; no_claim=how long the file counts and when the look names it (readLiveWikiUpdateMarker.test.ts)
test('a refusal beside a marker file that stayed unreadable longer than a write takes names the file, what can make it readable, and the first whole minute after it stops counting', () => {
  // Arrange: this Wiki's marker file could not be read since 12:00 UTC; one look finds that it counts until 12:21:30 UTC, another until 12:21:00 UTC, a moment at which it still counts.
  const markerPath = '/repo/.codebook/wiki.update-run.json'
  const firstMinuteAfter1221 = formatClockTime(Date.UTC(2026, 9, 3, 12, 22), {})

  // Act
  const countingUntilHalfAMinute = describeOtherWikiWindow({
    beingWrittenSinceMs: Date.UTC(2026, 9, 3, 12, 0),
    unreadableMarkerPath: markerPath,
    countsUntilMs: Date.UTC(2026, 9, 3, 12, 21, 30),
  })
  const countingUntilAWholeMinute = describeOtherWikiWindow({
    beingWrittenSinceMs: Date.UTC(2026, 9, 3, 12, 0),
    unreadableMarkerPath: markerPath,
    countsUntilMs: Date.UTC(2026, 9, 3, 12, 21),
  })

  // Assert: both name 12:22, the first whole minute at which the file no longer counts.
  assert.equal(
    countingUntilHalfAMinute,
    `Another editor window may be updating this Wiki: Codebook cannot read the Wiki’s marker file (/repo/.codebook/wiki.update-run.json), which another program may hold open (as a scanner or an indexer can on Windows) or which this user may not read. Press Update LLM Wiki again once the file can be read; if the file stays as it is, this refusal ends at ${firstMinuteAfter1221}.`,
  )
  assert.equal(
    countingUntilAWholeMinute,
    `Another editor window may be updating this Wiki: Codebook cannot read the Wiki’s marker file (/repo/.codebook/wiki.update-run.json), which another program may hold open (as a scanner or an indexer can on Windows) or which this user may not read. Press Update LLM Wiki again once the file can be read; if the file stays as it is, this refusal ends at ${firstMinuteAfter1221}.`,
  )
})

// Value: protects=D5, another window's running generation; fails_when=the refusal says the other window is updating, or sends the learner to press Update on a Wiki that does not exist yet; no_claim=the update's refusal (tests above); seam=none
test('another window’s running generation is named as generating, with Open LLM Wiki in Browser as the step once it has finished', () => {
  // Act
  const refusal = describeOtherWikiWindow({
    pid: 4242,
    windowId: '3f6c',
    host: 'vscode',
    startedAtMs: Date.UTC(2026, 9, 3, 12, 0),
    runKind: 'generate',
  })

  // Assert
  assert.equal(
    refusal,
    `Another editor window is generating this Wiki (VS Code, started ${formatClockTime(Date.UTC(2026, 9, 3, 12, 0), {})}). Wait for it to finish, then press Open LLM Wiki in Browser.`,
  )
})

// Value: protects=D5, a generation's start refused for a marker that names no run yet; fails_when=the refusal tells the learner another window is updating, or names Update LLM Wiki as the step, for a start that generates; no_claim=the update's refusals (tests above); seam=none
test('a generation’s start refused for a marker in change, one being written or one that cannot be read words the other window’s work as a run and names Generate LLM Wiki', () => {
  // Act
  const refusals = [
    describeOtherWikiWindow({ isMarkerInChange: true }, 'generate'),
    describeOtherWikiWindow(
      { beingWrittenSinceMs: Date.UTC(2026, 9, 3, 12, 0) },
      'generate',
    ),
    describeOtherWikiWindow(
      {
        beingWrittenSinceMs: Date.UTC(2026, 9, 3, 12, 0),
        unreadableMarkerPath: '/repo/.codebook/wiki.update-run.json',
        countsUntilMs: Date.UTC(2026, 9, 3, 13, 1, 30),
      },
      'generate',
    ),
  ]

  // Assert
  assert.deepEqual(refusals.slice(0, 2), [
    'Another editor window is starting or ending a run of this Wiki. Wait a moment and try again.',
    'Another editor window is starting a run of this Wiki. Wait a moment and try again.',
  ])
  assert.equal(
    refusals[2]?.startsWith(
      'Another editor window may be generating or updating this Wiki: Codebook cannot read the Wiki’s marker file (/repo/.codebook/wiki.update-run.json), which another program may hold open (as a scanner or an indexer can on Windows) or which this user may not read. Press Generate LLM Wiki again once the file can be read;',
    ),
    true,
  )
})

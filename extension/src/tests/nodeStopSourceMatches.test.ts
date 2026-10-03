import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'

import type { NodeTestHistoryEntry } from '../nodeTestHistorySchemas'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import * as sha256Module from '../runtimeSupport/utils/sha256'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { nodeStopSourceMatches } from '../utils/nodeStopSourceMatches'

import { saveOneStopNodeHistory } from './studyWorkspaceHarness'

/** Reads the sealed stop that the workspace fixtures save, so each case edits one field of a real journal entry. @example const stop = await savedStop() */
async function savedStop(): Promise<{
  stop: Extract<NodeTestHistoryEntry, { type: 'stop' }>
  cleanup: () => Promise<void>
}> {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-node-stop-'))
  const store = new NodeTestHistoryStore(directory, 'a'.repeat(64))
  const history = await saveOneStopNodeHistory(store)
  const index = await store.read(history.studyId)
  const stop = index.entries.find((entry) => entry.type === 'stop')
  assert.ok(stop?.type === 'stop')
  return {
    stop,
    cleanup: (): Promise<void> =>
      rm(directory, { recursive: true, force: true }),
  }
}

// Value: protects=the Node label and native Inspect agreeing that a sealed stop's captured source is usable; fails_when=a verified stop stops matching; why_new=Cycle 0033 T1/C1 single source match; seam=none
test('a sealed Node stop whose captured source matches where it stopped is available for native debugging', async () => {
  // Arrange
  const { stop, cleanup } = await savedStop()
  try {
    // Act
    const matches = nodeStopSourceMatches(stop)

    // Assert
    assert.equal(matches, true)
  } finally {
    await cleanup()
  }
})

// Value: protects="captured source unavailable" for captured text edited after sealing; fails_when=the text hash check is dropped (the webview predicate never had it); why_new=Cycle 0033 C1; seam=none
test('a Node stop whose captured source text no longer hashes to its sealed hash is unavailable', async () => {
  // Arrange
  const { stop, cleanup } = await savedStop()
  const frame = stop.debuggerSnapshot.frames[0]!
  const edited = {
    ...stop,
    debuggerSnapshot: {
      ...stop.debuggerSnapshot,
      frames: [
        {
          ...frame,
          source: { ...frame.source!, text: 'const nextTheme = "light";\n' },
        },
      ],
    },
  }
  try {
    // Act
    const matches = nodeStopSourceMatches(edited)

    // Assert
    assert.equal(matches, false)
    assert.notEqual(
      sha256(edited.debuggerSnapshot.frames[0]!.source.text),
      stop.source.hash,
    )
  } finally {
    await cleanup()
  }
})

// Value: protects="captured source unavailable" for a snapshot frame from another position; fails_when=frame position is no longer compared; why_new=Cycle 0033 C1; seam=none
test('a Node stop whose debugger frame sits at another column than the stop is unavailable', async () => {
  // Arrange
  const { stop, cleanup } = await savedStop()
  const frame = stop.debuggerSnapshot.frames[0]!
  const shifted = {
    ...stop,
    debuggerSnapshot: {
      ...stop.debuggerSnapshot,
      frames: [{ ...frame, column: frame.column + 4 }],
    },
  }
  try {
    // Act
    const matches = nodeStopSourceMatches(shifted)

    // Assert
    assert.equal(matches, false)
  } finally {
    await cleanup()
  }
})

// Value: protects="captured source unavailable" for a stop recorded without source; fails_when=a missing source counts as a match; why_new=Cycle 0033 C1; seam=none
test('a Node stop recorded without captured source is unavailable', async () => {
  // Arrange
  const { stop, cleanup } = await savedStop()
  const frame = stop.debuggerSnapshot.frames[0]!
  const { source: _source, ...withoutSource } = frame
  const unsourced = {
    ...stop,
    debuggerSnapshot: { ...stop.debuggerSnapshot, frames: [withoutSource] },
  }
  try {
    // Act
    const matches = nodeStopSourceMatches(unsourced)

    // Assert
    assert.equal(matches, false)
  } finally {
    await cleanup()
  }
})

// Value: protects=reader publishes from re-hashing the selected Node stop's captured source; fails_when=every publish hashes the captured text again; why_new=Cycle 0044 (0033-OCR2); seam=sha256 module export
test('the captured source of the selected Node stop is hashed once however often the reader publishes it', async () => {
  // Arrange
  const { stop, cleanup } = await savedStop()
  const hashing = mock.method(sha256Module, 'sha256')
  try {
    // Act: five reader publishes of the same selected stop.
    const verdicts = [1, 2, 3, 4, 5].map(() => nodeStopSourceMatches(stop))

    // Assert
    assert.deepEqual(verdicts, [true, true, true, true, true])
    assert.equal(hashing.mock.callCount(), 1)
  } finally {
    hashing.mock.restore()
    await cleanup()
  }
})

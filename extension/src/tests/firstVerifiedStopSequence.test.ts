import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type { NodeTestHistoryEntry } from '../nodeTestHistorySchemas'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import { firstVerifiedStopSequence } from '../utils/firstVerifiedStopSequence'

import { saveOneStopNodeHistory } from './studyWorkspaceHarness'

type SavedStop = Extract<NodeTestHistoryEntry, { type: 'stop' }>

/**
 * Reads the sealed output and stop that the workspace fixtures save, so each case edits one field of a real journal entry.
 * @returns The history's output entry, its verified stop (sequence 2) and the cleanup of its folder.
 * @example const { output, stop, cleanup } = await savedJournal()
 */
async function savedJournal(): Promise<{
  output: NodeTestHistoryEntry
  stop: SavedStop
  cleanup: () => Promise<void>
}> {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-first-stop-'))
  const store = new NodeTestHistoryStore(directory, 'a'.repeat(64))
  const history = await saveOneStopNodeHistory(store)
  const index = await store.read(history.studyId)
  const output = index.entries.find((entry) => entry.type === 'output')
  const stop = index.entries.find((entry) => entry.type === 'stop')
  assert.ok(output && stop?.type === 'stop')
  return {
    output,
    stop,
    cleanup: (): Promise<void> =>
      rm(directory, { recursive: true, force: true }),
  }
}

/**
 * Edits a stop's captured source text, so it no longer hashes to its sealed hash and does not verify.
 * @param stop - The stop.
 * @param sequence - The sequence the edited stop takes.
 * @returns The stop with unverifiable source.
 * @example unverified(stop, 2).sequence // => 2
 */
function unverified(stop: SavedStop, sequence: number): SavedStop {
  const frame = stop.debuggerSnapshot.frames[0]!
  return {
    ...stop,
    sequence,
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
}

// Value: protects=the landing of a test replay with an unverified earlier stop: the open skips the stop whose captured source does not verify and lands on the first stop that does; fails_when=the first stop is taken whether or not it verifies, so the replay opens on a moment with no recorded source; why_new=the landing helper had no unit test of its own (DS1, F68); seam=a real sealed journal with one stop's source text edited; no_claim=what the open presents at the landing (workspace tests)
test('the landing skips an earlier stop that does not verify and takes the first verified stop', async () => {
  // Arrange
  const { output, stop, cleanup } = await savedJournal()
  try {
    const history = {
      entries: [
        { ...output, sequence: 1 },
        unverified(stop, 2),
        { ...stop, sequence: 3 },
      ],
    }

    // Act
    const landing = firstVerifiedStopSequence(history)

    // Assert
    assert.equal(landing, 3)
  } finally {
    await cleanup()
  }
})

// Value: protects=a test replay with no verified stop: no landing sequence, so the open falls back to the first event; fails_when=an unverified stop is returned, or an output entry is; why_new=the no-verified-stop branch had no test (DS1, F68); seam=a real sealed journal with the only stop's source text edited; no_claim=the fallback itself (studyWorkspaceTestReplay tests)
test('the landing is undefined when no stop verifies', async () => {
  // Arrange
  const { output, stop, cleanup } = await savedJournal()
  try {
    const history = {
      entries: [{ ...output, sequence: 1 }, unverified(stop, 2)],
    }

    // Act
    const landing = firstVerifiedStopSequence(history)

    // Assert
    assert.equal(landing, undefined)
  } finally {
    await cleanup()
  }
})

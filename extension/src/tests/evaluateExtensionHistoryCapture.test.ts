import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import type { ExtensionHistoryEntry } from '../chromeExtensionHistorySchemas'
import { evaluateExtensionHistoryCapture } from '../utils/evaluateExtensionHistoryCapture'

import {
  EXTENSION_WORKSPACE_KEY,
  openExtensionStore,
} from './utils/chromeExtensionHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeExtensionHistory } from './utils/sealedExtensionHistory'

before(async () => {
  await realProcessStart(process.pid)
})

/** Writes one whole stop and returns its verified entries with the capture changed by `change`. */
async function entriesWithCapture(
  context: Parameters<typeof openExtensionStore>[0],
  change: (
    capture: Extract<ExtensionHistoryEntry, { type: 'capture' }>,
  ) => ExtensionHistoryEntry,
) {
  const { store, learningDirectory } = await openExtensionStore(context)
  const written = await writeExtensionHistory(
    learningDirectory,
    EXTENSION_WORKSPACE_KEY,
    [
      { at: 10, type: 'open', pauseId: 'p1', stopIndex: 1, context: 'page' },
      {
        at: 11,
        type: 'capture',
        pauseId: 'p1',
        stopIndex: 1,
        context: 'page',
      },
    ],
  )
  const history = await store.read(written.studyId)
  return history.entries.map((entry) =>
    entry.type === 'capture' ? change(entry) : entry,
  )
}

/** The codes about the stop's capture, without the codes of the ending the script leaves out. */
function stopCodes(entries: readonly ExtensionHistoryEntry[]): string[] {
  return evaluateExtensionHistoryCapture({ declaredStops: [] }, entries, {})
    .map((reason) => reason.code)
    .filter((code) => /SOURCE|SNAPSHOT/.test(code))
}

// protects=a capture whose source text does not hash to its recorded hash is reported without its source, as the replay shows it; fails_when=the seal calls the capture complete while the replay shows the source as not recorded; no_claim=the replay drawing
test('a capture whose source text does not match its recorded hash is reported as source unavailable', async (context) => {
  // Arrange
  const entries = await entriesWithCapture(context, (capture) => ({
    ...capture,
    debuggerSnapshot: {
      ...capture.debuggerSnapshot,
      frames: capture.debuggerSnapshot.frames.map((frame) => ({
        ...frame,
        source: frame.source && { ...frame.source, text: 'edited since' },
      })),
    },
  }))

  // Act
  const codes = stopCodes(entries)

  // Assert
  assert.deepEqual(codes, ['EXTENSION_HISTORY_SOURCE_UNAVAILABLE'])
})

// protects=a capture with no debugger frames is reported as a missing snapshot, not as a missing source; fails_when=the empty snapshot is told as an unavailable source; no_claim=the capture's other fields
test('a capture with no debugger frames is reported as snapshot missing', async (context) => {
  // Arrange
  const entries = await entriesWithCapture(context, (capture) => ({
    ...capture,
    debuggerSnapshot: { ...capture.debuggerSnapshot, frames: [] },
  }))

  // Act
  const codes = stopCodes(entries)

  // Assert
  assert.deepEqual(codes, ['EXTENSION_HISTORY_SNAPSHOT_MISSING'])
})

// protects=a capture whose source matches its hash raises no stop reason; fails_when=a whole stop is reported partial; no_claim=the ending reasons
test('a capture with a matching source raises no stop reason', async (context) => {
  // Arrange
  const entries = await entriesWithCapture(context, (capture) => capture)

  // Act
  const codes = stopCodes(entries)

  // Assert
  assert.deepEqual(codes, [])
})

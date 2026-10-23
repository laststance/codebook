import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NODE_TEST_HISTORY_VERSION } from '../constants'
import type { NodeTestHistoryIndex } from '../nodeTestHistorySchemas'
import { indexNodeTestOutput } from '../utils/indexNodeTestOutput'
import { projectNodeTestApplication } from '../utils/projectNodeTestApplication'

import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

const entries: NodeTestHistoryIndex['entries'] = [
  {
    type: 'output',
    sequence: 1,
    elapsedMs: 100,
    outputSequence: 1,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts\n',
  },
]
const history: Pick<NodeTestHistoryIndex, 'header' | 'entries' | 'status'> = {
  header: {
    version: NODE_TEST_HISTORY_VERSION,
    ...nodeTestHistoryHeader('workspace'),
  },
  entries,
  status: 'complete',
}

// Value: protects=the Application view of a test replay that has entries but no selected event (the replay is opening, or the reader position names none) shows no output lines, names the test with header line 1 reading the surface alone (no time, F116), and says that no output is recorded up to this moment; fails_when=the view prints the first event's output or a time for a moment nobody selected, or says the replay has no entries; why_new=F125: the Application view with entries and no selected event was an untested cell; seam=none; no_claim=when the host leaves an event unselected
test('an Application view with entries and no selected event names the test and shows no output or time', () => {
  // Arrange
  const index = indexNodeTestOutput(history.entries)

  // Act
  const view = projectNodeTestApplication(history, index, undefined, 3, false)

  // Assert
  assert.deepEqual(view.lines, [])
  assert.equal(view.time, 'Recorded test output')
  assert.equal(view.placeholder, 'No test output recorded up to this moment.')
  assert.equal(view.name, 'Recorded test output · src/theme.test.ts')
  assert.equal(view.generation, 3)
})

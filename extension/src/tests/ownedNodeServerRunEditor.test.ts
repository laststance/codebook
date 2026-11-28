import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'

import { defer } from './utils/defer'
import { editorRun, RUN_STOP_FILE } from './utils/nodeServerEditorRunHarness'

/** What a promise rejects with, so a test reads the refusal. */
async function refusalOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call
  } catch (error) {
    return error
  }
  return undefined
}

// protects=a node server run writes no request byte while a stop of the server is still being read: the adapter already knows execution stopped, so the learner's exception must not be followed by a state-changing request; fails_when=the unreported-stop check runs only for a Bun run, so a node run whose exception stop is read while the peer check finishes writes the request and then reports the learner's held exception (Cycle 0153 ship pass 1 S1); seam=the editor's real debugger behind the run, a held stack read and a held peer check; no_claim=the adapter's real message timing
test(
  'a node run writes no request while an exception stop of the server is still being read',
  { timeout: 15_000 },
  async () => {
    // Arrange
    const stackRead = defer<void>()
    const peerCheck = defer<void>()
    const peerCheckEntered = defer<void>()
    const { editor, harness } = await editorRun({
      editor: { stackTraceGate: stackRead.promise },
      run: {
        peerCheckGate: peerCheck.promise,
        onPeerCheckEntered: () => peerCheckEntered.resolve(),
      },
    })
    // Act
    const sending = refusalOf(harness.run.sendRequest('key-1'))
    await peerCheckEntered.promise
    editor.adapter.stop('exception', undefined, {
      file: RUN_STOP_FILE,
      line: 30,
    })
    peerCheck.resolve()
    const refusal = await sending
    // Assert
    assert.ok(refusal instanceof StudyError)
    assert.equal(refusal.code, 'RUN_NOT_READY')
    assert.match(refusal.message, /A pause of the server is still being read/)
    assert.equal(harness.sender.bytesWritten, 0)
    stackRead.resolve()
    await harness.run.stop()
  },
)

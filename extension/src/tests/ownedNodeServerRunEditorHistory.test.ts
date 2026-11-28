import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { NodeServerHistorySinkImpl } from '../nodeServerHistorySink'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { defer } from './utils/defer'
import { editorRun, hitDeclaredStop } from './utils/nodeServerEditorRunHarness'
import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
} from './utils/nodeServerHistoryFixture'
import { RESPONSE_200, until } from './utils/nodeServerRunHarness'
import { realProcessStart } from './utils/realProcessStart'
import { debuggerCapture } from './utils/serverRunCapture'

before(async () => {
  await realProcessStart(process.pid)
})

// protects=a declared stop that arrived inside the request stays in the saved replay when the response is delivered before its stack read finishes: the history keeps the stop before the response entry; fails_when=the response entry is written the moment the response arrives, so the history sink drops the capture that the live run shows (Cycle 0153 ship pass 2 T1, OV3); seam=the editor's real debugger behind the run, a held stack read, the production history sink over a real writer and the response delivered before the read is released; no_claim=the real timing of an adapter's stack read
test(
  'a declared stop captured after the response is still in the saved history before the response',
  { timeout: 15_000 },
  async (context) => {
    // Arrange
    const { repository } = await openServerRepository(context)
    const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
      declaredStops: 2,
    })
    const writer = await repository.serverHistories.start(header)
    const sink = new NodeServerHistorySinkImpl({
      writer,
      sanitize: (text) => text,
    })
    const editorOptions: { stackTraceGate?: Promise<void> } = {}
    const { editor, harness } = await editorRun({
      editor: editorOptions,
      run: { stops: 2, history: sink },
      capture: (pause) =>
        debuggerCapture({ line: 2 + (pause.declaredStopIndex ?? 0) }),
    })
    await harness.run.sendRequest('key-1')
    const stackRead = defer<void>()
    editorOptions.stackTraceGate = stackRead.promise
    hitDeclaredStop(editor, 0)
    // Act
    harness.sender.exchanges[0]?.response.resolve(RESPONSE_200)
    await until(harness, (view) => view.state === 'responded')
    stackRead.resolve()
    await until(harness, (view) => view.captures.length === 1)
    await waitUntil(
      async () =>
        (await repository.serverHistories.read(header.studyId)).entries.some(
          (entry) => entry.type === 'response',
        ),
      'the response entry of the history',
      5_000,
    )
    const entries = (await repository.serverHistories.read(header.studyId))
      .entries
    // Assert
    assert.deepEqual(
      entries.map((entry) => entry.type),
      ['output', 'request', 'request-sent', 'source', 'stop', 'response'],
    )
    await harness.run.stop()
  },
)

import assert from 'node:assert/strict'
import { before, test, type TestContext } from 'node:test'

import type { NodeServerWriterStop } from '../nodeServerHistoryWriter'
import type { ReplayDebugSnapshot } from '../replayDebugSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { captureReplayDebugSnapshot } from '../utils/captureReplayDebugSnapshot'

import {
  HANDLER_SOURCE_TEXT,
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
  serverStopCapture,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

/**
 * Reads a snapshot with the real capture function over a scripted debugger whose stopped frame offers a Local, a Module and a Global scope, the shape a native session answers.
 * @param localVariablesFail - Whether reading the Local scope's variables fails.
 * @returns The snapshot the capture wrote.
 */
async function realCapturedSnapshot(
  localVariablesFail: boolean,
  localScopeFails = false,
): Promise<ReplayDebugSnapshot> {
  return captureReplayDebugSnapshot({
    stack: {
      stackFrames: [{ id: 5, name: 'handler', line: 2, column: 1 }],
      totalFrames: 1,
    },
    verifiedSource: {
      name: 'src/handler.ts',
      text: HANDLER_SOURCE_TEXT,
      hash: sha256(HANDLER_SOURCE_TEXT),
      line: 2,
    },
    assertCurrent() {},
    request(command, arguments_) {
      if (command === 'scopes') {
        if (localScopeFails) return Promise.reject(new Error('scopes failed'))
        return Promise.resolve({
          scopes: [
            {
              name: 'Local',
              presentationHint: 'locals',
              variablesReference: 1,
            },
            { name: 'Module', variablesReference: 2 },
            { name: 'Global', variablesReference: 3 },
          ],
        })
      }
      if (localVariablesFail && arguments_.variablesReference === 1)
        return Promise.reject(new Error('variables failed'))
      return Promise.resolve({
        variables: [
          { name: 'id', value: '7', type: 'string', variablesReference: 0 },
        ],
      })
    },
  })
}

/** Seals a one-stop run whose stop carries `snapshot` and returns what a reader sees. */
async function sealedWith(context: TestContext, snapshot: ReplayDebugSnapshot) {
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY)
  const writer = await repository.serverHistories.start(header)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/x',
    bodyBytes: 0,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  const stop: NodeServerWriterStop = serverStopCapture({
    declaredStopIndex: 0,
    hit: 1,
    line: 2,
    elapsedMs: 10,
    snapshot,
  })
  await writer.appendStop(stop)
  await writer.appendResponse({
    elapsedMs: 30,
    status: 200,
    contentType: 'application/json',
    body: '{}',
    bodyBytes: 2,
    readCut: false,
    location: null,
    requestDurationMs: 5,
  })
  await writer.seal({ elapsedMs: 40, reason: 'stopped' })
  return repository.serverHistories.read(header.studyId)
}

// protects=a stop whose snapshot the real capture wrote (Local read, Module and Global left out by design) is presentable and its history seals complete; fails_when=the by-design scope exclusions make every real capture read as a missing snapshot; no_claim=the native debugger binding
test('a stop captured by the real capture function, with Module and Global left out by design, seals a complete history', async (context) => {
  // Arrange
  const snapshot = await realCapturedSnapshot(false)

  // Act
  const opened = await sealedWith(context, snapshot)

  // Assert
  assert.deepEqual(
    snapshot.frames[0]?.scopes.map((scope) => scope.name),
    ['Local', 'Module', 'Global'],
  )
  assert.equal(opened.status, 'complete')
  assert.deepEqual(opened.seal?.reasons, [])
})

// protects=a stop whose Local scope could not be read is still not presentable; fails_when=the exclusion policy hides a real read failure; no_claim=which failure text the capture words
for (const failure of [
  {
    name: 'its variables failed to read',
    localVariablesFail: true,
    scopeFails: false,
  },
  {
    name: 'its scopes failed to read',
    localVariablesFail: false,
    scopeFails: true,
  },
]) {
  test(`a stop whose Local scope ${failure.name} seals partial with the snapshot-missing reason`, async (context) => {
    // Arrange
    const snapshot = await realCapturedSnapshot(
      failure.localVariablesFail,
      failure.scopeFails,
    )

    // Act
    const opened = await sealedWith(context, snapshot)

    // Assert
    assert.equal(opened.status, 'partial')
    assert.equal(
      opened.seal?.reasons.some(
        (reason) => reason.code === 'SERVER_HISTORY_SNAPSHOT_MISSING',
      ),
      true,
    )
  })
}

// protects=a stop whose Local scope held more variables than the capture keeps (read, then truncated at the count limit and so marked) is presentable and seals complete; fails_when=the truncation text makes a real capture of a handler with many locals read as a missing snapshot; why_new=final-range CodeRabbit (major); seam=none; no_claim=how many variables a native session offers
test('a stop whose Local scope was truncated at the variable count limit seals a complete history', async (context) => {
  // Arrange
  const snapshot = await captureReplayDebugSnapshot({
    stack: {
      stackFrames: [{ id: 5, name: 'handler', line: 2, column: 1 }],
      totalFrames: 1,
    },
    verifiedSource: {
      name: 'src/handler.ts',
      text: HANDLER_SOURCE_TEXT,
      hash: sha256(HANDLER_SOURCE_TEXT),
      line: 2,
    },
    assertCurrent() {},
    limits: { timeoutMs: 5_000, maxFrames: 8, maxVariables: 2, maxDepth: 2 },
    request(command) {
      if (command === 'scopes')
        return Promise.resolve({
          scopes: [
            {
              name: 'Local',
              presentationHint: 'locals',
              variablesReference: 1,
            },
          ],
        })
      return Promise.resolve({
        variables: ['a', 'b', 'c'].map((name) => ({
          name,
          value: '1',
          type: 'number',
          variablesReference: 0,
        })),
      })
    },
  })

  // Act
  const opened = await sealedWith(context, snapshot)

  // Assert
  assert.equal(
    snapshot.frames[0]?.scopes[0]?.unavailable,
    'Historical variable count limit reached.',
  )
  assert.equal(opened.status, 'complete')
  assert.deepEqual(opened.seal?.reasons, [])
})

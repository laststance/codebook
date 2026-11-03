import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { REPLAY_DEBUG_TEXT_LIMIT_CHARS } from '../constants'
import { ReplayDebugAdapter } from '../replayDebugAdapter'
import {
  replayDebugSnapshotSchema,
  type ReplayDebugSnapshot,
} from '../replayDebugSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { captureReplayDebugSnapshot } from '../utils/captureReplayDebugSnapshot'
import { maskSavedDebugSnapshot } from '../utils/maskSavedDebugSnapshot'
import { rehydrateNodeServerEntries } from '../utils/rehydrateServerStopSnapshot'

import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
  serverStopCapture,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

const MASK = '[masked]'
const TRUNCATION_MARKER = '… [truncated]'
const SOURCE_TEXT = 'export function handler(req) {\n  return req\n}\n'
const SOURCE = {
  name: 'src/handler.ts',
  text: SOURCE_TEXT,
  hash: sha256(SOURCE_TEXT),
  line: 2,
}

/**
 * Builds a saved snapshot with one top-level variable, the shape a study saved by 0.2.73.1 or earlier holds.
 * @param variable - The variable's saved fields.
 * @returns A snapshot that passes the snapshot schema.
 */
function snapshotWith(
  variable: ReplayDebugSnapshot['variables'][number],
): ReplayDebugSnapshot {
  return {
    version: 1,
    frames: [
      {
        name: 'handler',
        line: 2,
        column: 1,
        source: SOURCE,
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
    variables: [variable],
    limitations: [],
  }
}

/**
 * Builds a quoted callback URL preview of exactly 4,090 characters whose `code` value is one character, so masking it makes the text seven characters longer.
 * @param codeAt - Where the one-character code value sits in the preview.
 * @returns The preview, quotes included.
 */
function callbackPreview(codeAt: number): string {
  const head = "'https://shop.example/cb?"
  const padding = 'a'.repeat(codeAt - head.length - '&code='.length)
  const tail = `&${'b'.repeat(4_090 - codeAt - 1 - 2)}'`
  return `${head}${padding}&code=x${tail}`
}

// protects=a study saved with a 4,090-character preview that holds a one-character secret query value; fails_when=masking lengthens the preview past the saved text limit so the snapshot schema (and the replay select that re-checks it) rejects the stop; no_claim=which part of the preview the cut keeps
test('a 4,090-character saved preview with a one-character callback code is masked to a value the snapshot schema accepts', () => {
  // Arrange
  const preview = callbackPreview(3_000)
  const snapshot = snapshotWith({
    name: 'callback',
    value: preview,
    type: 'string',
    children: [],
  })

  // Act
  const masked = maskSavedDebugSnapshot(snapshot)

  // Assert
  assert.equal(preview.length, 4_090)
  assert.equal(replayDebugSnapshotSchema.safeParse(masked).success, true)
  assert.equal(
    masked.variables[0]!.value.length <= REPLAY_DEBUG_TEXT_LIMIT_CHARS,
    true,
  )
  assert.equal(masked.variables[0]!.value.includes('code=[masked]&'), true)
  assert.equal(masked.variables[0]!.value.endsWith(TRUNCATION_MARKER), true)
})

// protects=the cut after masking never splits a mask; fails_when=the cut falls inside [masked] and leaves a fragment such as [mas, or the value keeps the one-character secret; no_claim=the exact kept length
test('a masked preview cut inside its mask drops the mask whole and keeps the secret out', () => {
  // Arrange
  // The one-character code sits at 4,080, so the mask spans 4,080–4,087 and the cut at 4,083 would fall inside it.
  const preview = callbackPreview(4_080)
  const snapshot = snapshotWith({
    name: 'callback',
    value: preview,
    type: 'string',
    children: [],
  })

  // Act
  const masked = maskSavedDebugSnapshot(snapshot)

  // Assert
  const value = masked.variables[0]!.value
  assert.equal(replayDebugSnapshotSchema.safeParse(masked).success, true)
  assert.equal(value.endsWith(`&code=${TRUNCATION_MARKER}`), true)
  assert.equal(value.includes('[ma'), false)
  assert.equal(value.includes('code=x'), false)
})

// protects=the capture of a 4,090-character string local whose one-character callback code makes masking longer; fails_when=the capture's cut falls inside the mask and saves a damaged mask such as [ma… [truncated]; no_claim=a capture of values that need no cut
test('a replay snapshot captures a 4,090-character callback string whose mask would be cut in half', async () => {
  // Arrange
  const request = (command: string): Promise<unknown> =>
    Promise.resolve(
      command === 'scopes'
        ? {
            scopes: [
              {
                name: 'Local: handler',
                presentationHint: 'locals',
                variablesReference: 1,
              },
            ],
          }
        : {
            variables: [
              {
                name: 'callback',
                value: callbackPreview(4_080),
                type: 'string',
                variablesReference: 0,
              },
            ],
          },
    )

  // Act
  const snapshot = await captureReplayDebugSnapshot({
    stack: {
      stackFrames: [{ id: 0, name: 'handler', line: 1, column: 1 }],
      totalFrames: 1,
    },
    verifiedSource: SOURCE,
    assertCurrent() {},
    request,
  })

  // Assert
  const value = snapshot.variables[0]!.value
  assert.equal(value.endsWith(`&code=${TRUNCATION_MARKER}`), true)
  assert.equal(value.includes('[ma'), false)
  assert.equal(value.includes('code=x'), false)
})

// protects=a second pass over an already masked and cut value; fails_when=masking the saved result again changes it or lengthens it past the limit; no_claim=the first pass's wording
test('masking a cut preview again keeps it unchanged and inside the saved text limit', () => {
  // Arrange
  const once = maskSavedDebugSnapshot(
    snapshotWith({
      name: 'callback',
      value: callbackPreview(4_080),
      type: 'string',
      children: [],
    }),
  )

  // Act
  const twice = maskSavedDebugSnapshot(once)

  // Assert
  assert.equal(replayDebugSnapshotSchema.safeParse(twice).success, true)
  assert.equal(twice.variables[0]!.value, once.variables[0]!.value)
})

// protects=the replay of a Node server stop whose saved preview masking lengthens; fails_when=rehydrating the stop returns a snapshot ReplayDebugAdapter.select rejects, so the stop cannot be replayed; no_claim=the Variables rows the editor shows
test('a Node server stop saved with a 4,090-character callback preview is rehydrated into a snapshot the replay debugger accepts', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    declaredStops: 1,
  })
  const writer = await repository.serverHistories.start(header)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'GET',
    path: header.declaredRequest.path,
    bodyBytes: 0,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  await writer.appendStop({
    ...serverStopCapture({
      declaredStopIndex: 0,
      hit: 1,
      line: 2,
      elapsedMs: 10,
      text: SOURCE_TEXT,
    }),
    snapshot: snapshotWith({
      name: 'callback',
      value: callbackPreview(3_000),
      type: 'string',
      children: [],
    }),
  })
  await writer.seal({ elapsedMs: 20, reason: 'stopped' })
  const opened = await repository.serverHistories.read(header.studyId)
  const adapter = new ReplayDebugAdapter(
    () => {},
    () => {},
  )

  // Act
  const stop = rehydrateNodeServerEntries(opened.entries).find(
    (entry) => entry.type === 'stop',
  )
  const select = (): void => {
    if (stop?.type !== 'stop') throw new Error('the history holds no stop')
    adapter.select(stop.debuggerSnapshot, 'Recorded')
  }

  // Assert
  assert.doesNotThrow(select)
})

// protects=an old parent whose children were never read (depth or count limit) and whose preview shows a credential; fails_when=such a parent keeps its preview with only the credential value masked instead of its class name; no_claim=a parent with saved children, which the other masking tests cover
test('a saved parent with unread members and a credential-shaped preview is served as its class name', () => {
  // Arrange
  const snapshot = snapshotWith({
    name: 'payload',
    value: "Payload {name: 'sid', value: 'opaque-session-text'}",
    children: [],
    unavailable: 'Historical variable depth limit reached.',
  })

  // Act
  const masked = maskSavedDebugSnapshot(snapshot)

  // Assert
  assert.equal(masked.variables[0]!.value, 'Payload')
  assert.equal(JSON.stringify(masked).includes('opaque-session-text'), false)
  assert.equal(
    masked.variables[0]!.unavailable,
    snapshot.variables[0]!.unavailable,
  )
})

// protects=a leaf is not mistaken for a parent; fails_when=a variable with no members and no unavailable note loses its readable preview; no_claim=how a leaf with a credential is masked, which the other tests cover
test('a saved leaf whose preview shows a credential keeps its readable text with only the credential masked', () => {
  // Arrange
  const snapshot = snapshotWith({
    name: 'pair',
    value: "{name: 'sid', value: 'opaque-session-text', theme: 'dark'}",
    type: 'Object',
    children: [],
  })

  // Act
  const masked = maskSavedDebugSnapshot(snapshot)

  // Assert
  assert.equal(
    masked.variables[0]!.value,
    `{name: 'sid', value: ${MASK}, theme: 'dark'}`,
  )
})

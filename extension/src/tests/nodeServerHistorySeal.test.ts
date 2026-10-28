import assert from 'node:assert/strict'
import { before, test, type TestContext } from 'node:test'

import { NodeHistoryRepository } from '../nodeHistoryRepository'
import type {
  NodeServerHistoryEntry,
  NodeServerHistoryHeader,
} from '../nodeServerHistorySchemas'
import type {
  NodeServerEndInput,
  NodeServerStopCapture,
} from '../nodeServerHistoryWriter'
import { capMissingList } from '../utils/capMissingList'
import { evaluateNodeServerCapture } from '../utils/evaluateNodeServerCapture'
import { evaluateNodeServerLearning } from '../utils/evaluateNodeServerLearning'

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

type Terminal =
  | { kind: 'response'; status: number }
  | { kind: 'request-failed'; code: string }
  | { kind: 'none' }

/** Writes a whole server run to a store and seals it; returns what a reader sees. */
async function sealedServerRun(
  context: TestContext,
  options: {
    declaredStops?: number
    stops?: NodeServerStopCapture[]
    terminal?: Terminal
    end?: NodeServerEndInput
    budgetExhausted?: boolean
  },
) {
  const { repository, learningDirectory } = await openServerRepository(context)
  const header = nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, {
    declaredStops: options.declaredStops ?? 1,
  })
  const writer = await repository.serverHistories.start(header)
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'POST',
    path: '/x',
    bodyBytes: 0,
  })
  await writer.appendRequestSent({ elapsedMs: 2, attempt: 1 })
  for (const stop of options.stops ?? []) await writer.appendStop(stop)
  const terminal = options.terminal ?? { kind: 'response', status: 200 }
  if (terminal.kind === 'response')
    await writer.appendResponse({
      elapsedMs: 30,
      status: terminal.status,
      contentType: 'application/json',
      body: '{}',
      bodyBytes: 2,
      readCut: false,
      location: null,
      requestDurationMs: 5,
    })
  if (terminal.kind === 'request-failed')
    await writer.appendRequestFailed({
      elapsedMs: 30,
      code: terminal.code,
      message: 'Refused.',
    })
  if (options.budgetExhausted) writer.markCaptureBudgetExhausted()
  await writer.seal(options.end ?? { elapsedMs: 40, reason: 'stopped' })
  const opened = await repository.serverHistories.read(header.studyId)
  return { repository, learningDirectory, header, opened }
}

const oneStop = [
  serverStopCapture({ declaredStopIndex: 0, hit: 1, line: 2, elapsedMs: 10 }),
]

/** The `[code, text]` pairs of a sealed history's reasons. */
function reasonsOf(opened: {
  seal?: { reasons: Array<{ code: string; text: string }> }
}) {
  return (opened.seal?.reasons ?? []).map((reason) => [
    reason.code,
    reason.text,
  ])
}

// protects=a recorded 4xx or 5xx answer is a complete capture of what happened; fails_when=a status makes the seal partial; no_claim=the replay never words a status as success
for (const status of [200, 404, 500]) {
  test(`a server run with a ${status} response and every declared stop seals complete`, async (context) => {
    // Arrange
    const options = {
      stops: oneStop,
      terminal: { kind: 'response', status } as const,
    }

    // Act
    const { opened } = await sealedServerRun(context, options)

    // Assert
    assert.equal(opened.status, 'complete')
    assert.deepEqual(opened.seal?.reasons, [])
    assert.equal(opened.seal?.capture, 'complete')
  })
}

// protects=each partial reason of the plan's table, in its words and codes; fails_when=a reason is missing, misworded or recoded; no_claim=the size-limit and append reasons (their own tests)
const REASON_CASES: Array<{
  name: string
  options: Parameters<typeof sealedServerRun>[1]
  expected: string[][]
}> = [
  {
    name: 'a failed request',
    options: {
      stops: oneStop,
      terminal: { kind: 'request-failed', code: 'ECONNRESET' },
    },
    expected: [
      [
        'SERVER_HISTORY_NO_RESPONSE_REQUEST_FAILED',
        'No response was recorded: the request failed with ECONNRESET.',
      ],
    ],
  },
  {
    name: 'a run stopped before the answer',
    options: { stops: oneStop, terminal: { kind: 'none' } },
    expected: [
      [
        'SERVER_HISTORY_NO_RESPONSE_STOPPED',
        'No response was recorded: the run was stopped before the server answered.',
      ],
    ],
  },
  {
    name: 'a server that exited with a code',
    options: {
      stops: oneStop,
      terminal: { kind: 'none' },
      end: { elapsedMs: 40, reason: 'closed', exitCode: 1 },
    },
    expected: [
      [
        'SERVER_HISTORY_NO_RESPONSE_EXITED',
        'No response was recorded: the server exited (exit code 1) before it answered.',
      ],
    ],
  },
  {
    name: 'a server that exited by a signal',
    options: {
      stops: oneStop,
      terminal: { kind: 'none' },
      end: { elapsedMs: 40, reason: 'closed', signal: 'SIGTERM' },
    },
    expected: [
      [
        'SERVER_HISTORY_NO_RESPONSE_EXITED',
        'No response was recorded: the server exited (signal SIGTERM) before it answered.',
      ],
    ],
  },
  {
    name: 'a run that failed',
    options: {
      stops: oneStop,
      terminal: { kind: 'none' },
      end: { elapsedMs: 40, reason: 'failed', code: 'PORT_IN_USE' },
    },
    expected: [
      [
        'SERVER_HISTORY_NO_RESPONSE_RUN_FAILED',
        'No response was recorded: the run failed with PORT_IN_USE.',
      ],
    ],
  },
  {
    name: 'a declared stop that was never reached',
    options: { declaredStops: 2, stops: oneStop },
    expected: [
      ['SERVER_HISTORY_STOP_NOT_REACHED', 'Declared stop 2 was not reached.'],
    ],
  },
  {
    name: 'an unreadable value',
    options: {
      stops: [
        serverStopCapture({
          declaredStopIndex: 0,
          hit: 1,
          line: 2,
          elapsedMs: 10,
          unavailable: [{ path: 'req.user', reason: 'not readable' }],
        }),
      ],
    },
    expected: [
      [
        'SERVER_HISTORY_VALUE_UNAVAILABLE',
        'req.user at stop 1 could not be read.',
      ],
    ],
  },
  {
    name: 'a spent capture budget',
    options: { stops: oneStop, budgetExhausted: true },
    expected: [
      [
        'SERVER_HISTORY_CAPTURE_BUDGET_EXHAUSTED',
        'The capture budget (16 stop hits) was used up; later hits were not recorded.',
      ],
    ],
  },
]

for (const reasonCase of REASON_CASES) {
  test(`a server run with ${reasonCase.name} seals partial with its reason in the plan's words`, async (context) => {
    // Arrange
    const options = reasonCase.options

    // Act
    const { opened } = await sealedServerRun(context, options)

    // Assert
    assert.equal(opened.status, 'partial')
    assert.deepEqual(reasonsOf(opened), reasonCase.expected)
    assert.equal(opened.seal?.capture, 'incomplete')
  })
}

// protects=reasons come in the table's order, the three "No response" rows are exclusive, and the first reason is the one a row shows; fails_when=order or exclusivity changes; no_claim=library wording
test('a run stopped after stop 1 of 2 seals with no response first and the unreached stop second', async (context) => {
  // Arrange
  const options = {
    declaredStops: 2,
    stops: oneStop,
    terminal: { kind: 'none' },
  } as const

  // Act
  const { opened } = await sealedServerRun(context, options)

  // Assert
  assert.deepEqual(reasonsOf(opened), [
    [
      'SERVER_HISTORY_NO_RESPONSE_STOPPED',
      'No response was recorded: the run was stopped before the server answered.',
    ],
    ['SERVER_HISTORY_STOP_NOT_REACHED', 'Declared stop 2 was not reached.'],
  ])
  assert.equal(
    opened.seal?.reason,
    'No response was recorded: the run was stopped before the server answered.',
  )
})

// protects=size-limit and append-failure reasons the writer alone knows; fails_when=they are dropped from the evaluator; no_claim=how the writer notices them
test('the evaluator words the size-limit and append-failure reasons the writer reports', () => {
  // Arrange
  const header = nodeServerHistoryHeader(
    SERVER_WORKSPACE_KEY,
  ) as NodeServerHistoryHeader
  const entries: NodeServerHistoryEntry[] = []

  // Act
  const reasons = evaluateNodeServerCapture(header, entries, {
    appendFailure: { lastEntry: 'stop 2 (entry 14)', cause: 'EIO' },
    sizeLimitReached: true,
  })

  // Assert
  assert.deepEqual(
    reasons.map((reason) => [reason.code, reason.text]),
    [
      ['SERVER_HISTORY_STOP_NOT_REACHED', 'Declared stop 1 was not reached.'],
      [
        'SERVER_HISTORY_APPEND_FAILED',
        'The history could not be written after stop 2 (entry 14): EIO.',
      ],
      [
        'SERVER_HISTORY_SIZE_LIMIT',
        'The history reached its size limit; later events were not recorded.',
      ],
    ],
  )
})

// protects=a snapshot that cannot be presented makes the capture incomplete: empty frames, another position, another source, unread scopes; fails_when=such a stop reads as complete; no_claim=lower frames, which may lack source
const SNAPSHOT_CASES: Array<{
  name: string
  snapshot: NodeServerStopCapture['snapshot']
  /** Whether the writer also finds no executed source text in the snapshot's top frame, which adds the source reason after the debugger-state one. */
  sourceNotCaptured?: boolean
}> = [
  {
    name: 'no frames',
    sourceNotCaptured: true,
    snapshot: { version: 1, frames: [], variables: [], limitations: [] },
  },
  {
    name: 'a top frame on another line',
    snapshot: {
      version: 1,
      frames: [
        {
          name: 'handler',
          line: 9,
          column: 1,
          source: {
            name: 'src/handler.ts',
            text: HANDLER_SOURCE_TEXT,
            hash: serverStopCapture({
              declaredStopIndex: 0,
              hit: 1,
              line: 2,
              elapsedMs: 1,
            }).source.hash,
            line: 9,
          },
          scopes: [{ name: 'Local', variables: [] }],
        },
      ],
      variables: [],
      limitations: [],
    },
  },
  {
    name: 'a top frame from another source',
    sourceNotCaptured: true,
    snapshot: {
      version: 1,
      frames: [
        {
          name: 'handler',
          line: 2,
          column: 1,
          source: {
            name: 'src/handler.ts',
            text: 'other\n',
            hash: '0'.repeat(64),
            line: 2,
          },
          scopes: [{ name: 'Local', variables: [] }],
        },
      ],
      variables: [],
      limitations: [],
    },
  },
  {
    name: 'a scope that was not read',
    snapshot: {
      version: 1,
      frames: [
        {
          name: 'handler',
          line: 2,
          column: 1,
          source: {
            name: 'src/handler.ts',
            text: HANDLER_SOURCE_TEXT,
            hash: serverStopCapture({
              declaredStopIndex: 0,
              hit: 1,
              line: 2,
              elapsedMs: 1,
            }).source.hash,
            line: 2,
          },
          scopes: [
            {
              name: 'Local',
              variables: [],
              unavailable: 'The debugger refused.',
            },
          ],
        },
      ],
      variables: [],
      limitations: [],
    },
  },
]

for (const snapshotCase of SNAPSHOT_CASES) {
  test(`a stop with ${snapshotCase.name} makes the capture incomplete with the debugger-state reason`, async (context) => {
    // Arrange
    const stop = serverStopCapture({
      declaredStopIndex: 0,
      hit: 1,
      line: 2,
      elapsedMs: 10,
      snapshot: snapshotCase.snapshot,
    })

    // Act
    const { opened } = await sealedServerRun(context, { stops: [stop] })

    // Assert
    assert.deepEqual(reasonsOf(opened), [
      [
        'SERVER_HISTORY_SNAPSHOT_MISSING',
        'The debugger state at stop 1 was not recorded.',
      ],
      ...(snapshotCase.sourceNotCaptured
        ? [
            [
              'SERVER_HISTORY_SOURCE_UNAVAILABLE',
              'The source at stop 1 was not recorded (not captured).',
            ],
          ]
        : []),
    ])
  })
}

// protects=one source hash reused by stops on different lines stays presentable per stop; fails_when=dedupe merges the stops' lines or the second stop loses its source; no_claim=the replay's slot behavior
test('two stops that share one source hash on different lines are both presentable and the run seals complete', async (context) => {
  // Arrange
  const stops = [
    serverStopCapture({ declaredStopIndex: 0, hit: 1, line: 2, elapsedMs: 10 }),
    serverStopCapture({ declaredStopIndex: 1, hit: 1, line: 4, elapsedMs: 11 }),
  ]

  // Act
  const { opened } = await sealedServerRun(context, { declaredStops: 2, stops })

  // Assert
  assert.equal(opened.status, 'complete')
  assert.equal(
    opened.entries.filter((entry) => entry.type === 'source').length,
    1,
  )
})

// protects=thirty unreadable values keep every reason in the seal and answer with twenty and a count; fails_when=the seal cuts reasons or an answer lists more than twenty; no_claim=the library row text
test('thirty unavailable values keep thirty reasons in the seal and twenty plus a count in the summary', async (context) => {
  // Arrange: three stops of ten unreadable values each, the most one stop can hold.
  const stops = [0, 1, 2].map((declaredStopIndex) =>
    serverStopCapture({
      declaredStopIndex,
      hit: 1,
      line: 2,
      elapsedMs: 10 + declaredStopIndex,
      unavailable: Array.from({ length: 10 }, (_, index) => ({
        path: `value${declaredStopIndex * 10 + index}`,
        reason: 'not readable',
      })),
    }),
  )

  // Act
  const { repository, opened, header } = await sealedServerRun(context, {
    declaredStops: 3,
    stops,
  })
  const summary = await repository.serverHistories.summarize(header.studyId)

  // Assert
  assert.equal(opened.seal?.reasons.length, 30)
  assert.equal(summary?.captureMissing.length, 20)
  assert.equal(summary?.captureMissingCount, 30)
  assert.equal(
    summary?.captureMissing[0]?.text,
    'value0 at stop 1 could not be read.',
  )
})

// protects=the largest legal capture (16 stop hits of 10 unreadable values with maximum-length paths) seals with every reason uncut and reads back; fails_when=the seal exceeds its size limit so it can never be written, or a reason is cut; no_claim=paths that JSON escapes
test('sixteen stop hits with ten unreadable values of the longest path keep all 160 reasons in a seal that reads back', async (context) => {
  // Arrange
  const longPath = (index: number): string =>
    `${'p'.repeat(500)}${String(index).padStart(12, '0')}`
  // Eight declared stops, two hits each: sixteen hits, the run's capture limit.
  const stops = Array.from({ length: 16 }, (_, hitNumber) =>
    serverStopCapture({
      declaredStopIndex: hitNumber % 8,
      hit: Math.floor(hitNumber / 8) + 1,
      line: 2,
      elapsedMs: 10 + hitNumber,
      unavailable: Array.from({ length: 10 }, (_, index) => ({
        path: longPath(hitNumber * 10 + index),
        reason: 'r'.repeat(1_024),
      })),
    }),
  )

  // Act
  const { opened } = await sealedServerRun(context, {
    declaredStops: 8,
    stops,
  })

  // Assert
  assert.equal(opened.seal?.reasons.length, 160)
  assert.equal(opened.status, 'partial')
  assert.equal(
    opened.seal?.reasons[159]?.text,
    `${longPath(159)} at stop 8 could not be read.`,
  )
})

// protects=a stop lists at most as many unreadable values as the declaration may inspect (10); fails_when=the writer accepts an eleventh value, which would let the seal outgrow its size limit; no_claim=the run's own inspection bound
test('the server writer refuses a stop with more unreadable values than a stop may inspect', async (context) => {
  // Arrange
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

  // Act
  const refused = writer.appendStop(
    serverStopCapture({
      declaredStopIndex: 0,
      hit: 1,
      line: 2,
      elapsedMs: 3,
      unavailable: Array.from({ length: 11 }, (_, index) => ({
        path: `value${index}`,
        reason: 'not readable',
      })),
    }),
  )

  // Assert
  await assert.rejects(refused, /<=10 items/)
})

// protects=a stop whose executed source was not stored cannot read as a complete capture, because the replay would not show the code that ran; fails_when=a stop with a too-large or uncaptured source seals complete or words another reason; no_claim=which stops of a run have the same source
for (const sourceCase of [
  {
    name: 'is larger than 512 KiB (stored as its hash only)',
    reason: 'too large',
    capture: () =>
      serverStopCapture({
        declaredStopIndex: 0,
        hit: 1,
        line: 2,
        elapsedMs: 10,
        text: `${'// padding\n'.repeat(60_000)}export const a = 1\n`,
      }),
  },
  {
    name: 'text was not captured',
    reason: 'not captured',
    capture: () => {
      const base = serverStopCapture({
        declaredStopIndex: 0,
        hit: 1,
        line: 2,
        elapsedMs: 10,
      })
      const [top] = base.snapshot.frames
      return {
        ...base,
        snapshot: {
          ...base.snapshot,
          frames: [
            {
              ...top!,
              source: { ...top!.source!, text: 'not the executed text' },
            },
          ],
        },
      }
    },
  },
]) {
  test(`a stop whose source ${sourceCase.name} seals partial with the source-unavailable reason`, async (context) => {
    // Arrange
    const stop = sourceCase.capture()

    // Act
    const { opened } = await sealedServerRun(context, { stops: [stop] })

    // Assert
    assert.equal(opened.status, 'partial')
    assert.deepEqual(reasonsOf(opened), [
      [
        'SERVER_HISTORY_SOURCE_UNAVAILABLE',
        `The source at stop 1 was not recorded (${sourceCase.reason}).`,
      ],
    ])
    assert.deepEqual(opened.seal?.reasons[0]?.params, {
      stop: 1,
      reason: sourceCase.reason,
    })
  })
}

// protects=reasons, codes and params read the same before and after a restart; fails_when=a fresh store recomputes or reorders them; no_claim=other windows
test('a sealed server history reads the same reasons, codes and params after a restart', async (context) => {
  // Arrange
  const unavailable = [{ path: 'req.user', reason: 'not readable' }]
  const stop = serverStopCapture({
    declaredStopIndex: 0,
    hit: 1,
    line: 2,
    elapsedMs: 10,
    unavailable,
  })
  const { repository, learningDirectory, opened, header } =
    await sealedServerRun(context, {
      stops: [stop],
      terminal: { kind: 'none' },
      declaredStops: 2,
    })
  const before = await repository.serverHistories.summarize(header.studyId)

  // Act
  const restarted = new NodeHistoryRepository(
    learningDirectory,
    SERVER_WORKSPACE_KEY,
    () => 64,
    async () => 0,
  )
  const after = await restarted.serverHistories.summarize(header.studyId)
  const reopened = await restarted.serverHistories.read(header.studyId)

  // Assert
  assert.deepEqual(reopened.seal?.reasons, opened.seal?.reasons)
  assert.deepEqual(after?.captureMissing, before?.captureMissing)
  assert.deepEqual(
    reopened.seal?.reasons.map((reason) => [reason.code, reason.params]),
    [
      ['SERVER_HISTORY_NO_RESPONSE_STOPPED', {}],
      ['SERVER_HISTORY_STOP_NOT_REACHED', { stop: 2 }],
      [
        'SERVER_HISTORY_VALUE_UNAVAILABLE',
        { path: 'req.user', stop: 1, hit: 1 },
      ],
    ],
  )
})

// protects=learning complete needs the request, one hit of every reached stop and the terminal, nothing more; fails_when=an uncited second hit, output or end blocks complete, or a missing request does not; no_claim=the saved material's schema (arrives with MCP 1.9)
test('learning is complete when the request, one hit of each reached stop and the response are cited, even with a second hit and output uncited', async (context) => {
  // Arrange
  const stops = [
    serverStopCapture({ declaredStopIndex: 0, hit: 1, line: 2, elapsedMs: 10 }),
    serverStopCapture({ declaredStopIndex: 0, hit: 2, line: 2, elapsedMs: 11 }),
  ]
  const { opened } = await sealedServerRun(context, { stops })
  const sequenceOf = (type: string, hit?: number) =>
    opened.entries.find(
      (entry) =>
        entry.type === type &&
        (hit === undefined || (entry.type === 'stop' && entry.hit === hit)),
    )!.sequence

  // Act
  const complete = evaluateNodeServerLearning(
    opened.entries,
    new Set([
      sequenceOf('request'),
      sequenceOf('stop', 1),
      sequenceOf('response'),
    ]),
  )
  const missingRequest = evaluateNodeServerLearning(
    opened.entries,
    new Set([sequenceOf('stop', 1), sequenceOf('response')]),
  )
  const nothing = evaluateNodeServerLearning(opened.entries, undefined)

  // Assert
  assert.deepEqual(complete, { coverage: 'complete', missing: [] })
  assert.deepEqual(
    missingRequest.missing.map((part) => part.type),
    ['request'],
  )
  assert.equal(missingRequest.coverage, 'partial')
  assert.equal(nothing.coverage, 'none')
  assert.deepEqual(
    nothing.missing.map((part) => part.type),
    ['request', 'stop', 'response'],
  )
})

// protects=the missing-list cap is twenty plus the whole count; fails_when=a long list is returned whole or the count is lost; no_claim=which lists use it
test('a missing list of thirty is capped to twenty with the count of thirty', () => {
  // Arrange
  const thirty = Array.from({ length: 30 }, (_, index) => index)

  // Act
  const capped = capMissingList(thirty)

  // Assert
  assert.equal(capped.items.length, 20)
  assert.equal(capped.count, 30)
})

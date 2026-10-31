import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'
import type { ExplainNodeHistoryInput } from '../schemas'

import { createHarness } from './helpers'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

type ExplainNodeHistoryStep =
  ExplainNodeHistoryInput['content']['steps'][number]

const LARGE_SOURCE_TEXT = `${'const filler = "x".repeat(10)\n'.repeat(6_000)}export const nextTheme = "dark"\n`

/** A service over a store holding a sealed history: one output, one stop whose top frame carries a ~190 KB source text, and a passing result (sequences 1, 2 and 3). */
async function serviceWithLargeStopHistory() {
  const harness = await createHarness()
  const workspaceKey = '0'.repeat(64)
  const store = new NodeTestHistoryStore(
    join(harness.directory, '.learning'),
    workspaceKey,
  )
  const header = nodeTestHistoryHeader(workspaceKey)
  const writer = await store.start(header)
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 3,
    channel: 'stdout',
    text: 'RUN src/theme.test.ts',
  })
  await writer.appendStop({
    index: 0,
    runId: 'test-run',
    sessionId: 'test-session',
    threadId: 1,
    elapsedMs: 5,
    worker: { pid: 1, processGroup: 1, workspace: '/private/test' },
    source: header.configuration.source,
    frame: { id: 1, name: 'applyTheme', line: 1, column: 1 },
    variables: [{ name: 'nextTheme', value: 'dark', variablesReference: 0 }],
    facts: [
      { path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' },
    ],
    debuggerSnapshot: {
      version: 1,
      frames: [
        {
          name: 'applyTheme',
          line: 1,
          column: 1,
          source: {
            name: header.configuration.source.path,
            text: LARGE_SOURCE_TEXT,
            hash: sha256(LARGE_SOURCE_TEXT),
            line: 1,
          },
          scopes: [{ name: 'Local', variables: [0] }],
        },
      ],
      variables: [
        { name: 'nextTheme', value: 'dark', type: 'string', children: [] },
      ],
      limitations: [],
    },
  })
  await writer.appendResult(
    { exitCode: 0, signal: null, output: 'Tests 1 passed' },
    9,
  )
  await writer.finish('complete')
  harness.service.nodeHistoryStore = store
  return { harness, header, studyId: header.studyId }
}

// Value: protects=an agent saving a test run of a large file: the events list it must read before it can cite a sequence stays within one page; fails_when=a stop entry carries the executed source text or snapshot in the events list, so a 190 KB source makes dozens of pages before the save can cite one sequence (Cycle 0067 F4); why_new=the test events list returned every entry in full; seam=a real store over a temporary folder; no_claim=the replay, which reads the store
test('a test history whose stop executed a 190 KB source answers a one-page events list of citable sequences without the source text', async () => {
  // Arrange
  const { harness, header, studyId } = await serviceWithLargeStopHistory()
  try {
    // Act
    const resource = await readResource(
      harness.service,
      `codebook://node-history/${studyId}/events`,
    )
    if (!('text' in resource)) throw new Error('events did not return JSON.')
    const page = JSON.parse(resource.text)

    // Assert
    assert.equal(page.nextUri, undefined)
    assert.deepEqual(JSON.parse(page.content), [
      {
        sequence: 1,
        type: 'output',
        elapsedMs: 3,
        channel: 'stdout',
        text: 'RUN src/theme.test.ts',
      },
      {
        sequence: 2,
        type: 'stop',
        elapsedMs: 5,
        index: 0,
        path: 'src/theme.ts',
        line: 1,
        sourceHash: header.configuration.source.hash,
        facts: [
          { path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' },
        ],
      },
      { sequence: 3, type: 'result', elapsedMs: 9, exitCode: 0, signal: null },
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent that needs one test entry in full after the lean list: events/<sequence> answers the stop with its debugger snapshot; fails_when=the route answers NOT_FOUND or a stop without its snapshot; why_new=the lean list moved the whole entry to its own resource (Cycle 0067 F4); seam=a real store over a temporary folder; no_claim=the paging of an entry larger than a page (readJsonPage tests)
test('a test history’s events/<sequence> resource answers that stop in full with its debugger snapshot', async () => {
  // Arrange
  const { harness, studyId } = await serviceWithLargeStopHistory()
  try {
    // Act
    const resource = await readResource(
      harness.service,
      `codebook://node-history/${studyId}/events/2`,
    )
    if (!('text' in resource)) throw new Error('detail did not return JSON.')
    const page = JSON.parse(resource.text)

    // Assert
    assert.ok(page.nextUri, 'the 190 KB stop spans pages')
    assert.match(page.content, /"type":"stop"/)
    assert.match(page.content, /"sequence":2/)
    assert.match(page.content, /debuggerSnapshot/)
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent that names a sequence the test history does not hold; fails_when=it answers a page or another code than NOT_FOUND; why_new=events/<sequence> is new for test histories (Cycle 0067 F4); seam=a real store over a temporary folder; no_claim=server histories' own routes
test('a test history’s events/<sequence> resource for a sequence the history does not hold is refused as NOT_FOUND', async () => {
  // Arrange
  const { harness, studyId } = await serviceWithLargeStopHistory()
  try {
    // Act
    const answer = await readResource(
      harness.service,
      `codebook://node-history/${studyId}/events/99`,
    ).then(
      () => 'answered',
      (error: unknown) =>
        error instanceof StudyError
          ? { code: error.code, message: error.message }
          : String(error),
    )

    // Assert
    assert.deepEqual(answer, {
      code: 'NOT_FOUND',
      message: `The history ${studyId} has no entry with sequence 99. Read codebook://node-history/${studyId}/events for the sequences it holds.`,
    })
  } finally {
    await harness.close()
  }
})

// protects=a test history's events/<sequence> names an entry only by its canonical sequence, so events/002 never answers as events/2 and a digit run beyond 2^53 never rounds onto another sequence; fails_when=a zero-padded or unsafe-integer sequence is answered with an entry; no_claim=the server history's own routes
test('a test history refuses a zero-padded or beyond-2^53 events sequence as an unknown resource', async () => {
  // Arrange
  const { harness, studyId } = await serviceWithLargeStopHistory()
  try {
    // Act
    const answers = []
    for (const sequence of ['002', '00', '9007199254740993']) {
      answers.push(
        await readResource(
          harness.service,
          `codebook://node-history/${studyId}/events/${sequence}`,
        ).then(
          () => 'answered',
          (error: unknown) =>
            error instanceof StudyError
              ? { code: error.code, message: error.message }
              : String(error),
        ),
      )
    }

    // Assert
    const refused = { code: 'NOT_FOUND', message: 'Unknown resource.' }
    assert.deepEqual(answers, [refused, refused, refused])
  } finally {
    await harness.close()
  }
})

// Value: protects=a save that cites the lean list's sequences, as an agent does after reading it; fails_when=the save refuses the stop, output or result sequence the lean list shows; why_new=the lean list is what the agent now reads before saving (Cycle 0067 F4); seam=a real store over a temporary folder; no_claim=the save's other refusals (lifecycle tests)
test('a save citing the sequences of the lean events list is accepted', async () => {
  // Arrange
  const { harness, header, studyId } = await serviceWithLargeStopHistory()
  try {
    const step = (
      id: string,
      reference: NonNullable<ExplainNodeHistoryStep['reference']>,
    ) => ({
      id,
      from: 'test',
      to: 'theme',
      label: 'Step',
      explanation: 'Observed at this event.',
      evidence: 'observed' as const,
      reference,
    })

    // Act
    const saved = await harness.service.explainNodeHistory({
      studyId,
      expectedRevision: 0,
      content: {
        question: 'Why did the selected theme become dark?',
        title: 'Theme update',
        summary: 'The captured stop shows the dark value.',
        participants: [
          { id: 'test', label: 'Test' },
          { id: 'theme', label: 'Theme' },
        ],
        steps: [
          step('step-1', { type: 'output', sequence: 1, channel: 'stdout' }),
          step('step-2', {
            type: 'stop',
            sequence: 2,
            sourceHash: header.configuration.source.hash,
          }),
          step('step-3', { type: 'result', sequence: 3 }),
        ],
      },
    })

    // Assert
    assert.equal(saved.revision, 1)
  } finally {
    await harness.close()
  }
})

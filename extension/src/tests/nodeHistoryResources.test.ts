import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import { readResource } from '../resources'

import { createHarness } from './helpers'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'

/** A store that counts how often a summary is read, so a test can tell which resources read it. */
class CountingStore extends NodeTestHistoryStore {
  summarizeCalls = 0

  override summarize(
    ...input: Parameters<NodeTestHistoryStore['summarize']>
  ): ReturnType<NodeTestHistoryStore['summarize']> {
    this.summarizeCalls++
    return super.summarize(...input)
  }
}

/** Reads a resource and returns the JSON its first page holds. */
async function jsonOf(
  service: Parameters<typeof readResource>[0],
  uri: string,
): Promise<unknown> {
  const resource = await readResource(service, uri)
  if (!('text' in resource)) throw new Error(`${uri} did not return JSON.`)
  return JSON.parse(JSON.parse(resource.text).content)
}

/** A service over a store that holds one history sealed as the learner's stop after one output. */
async function serviceWithOneHistory() {
  const harness = await createHarness()
  const workspaceKey = '0'.repeat(64)
  const store = new CountingStore(
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
  await writer.finish('partial', 'The learner stopped this run.')
  harness.service.nodeHistoryStore = store
  return { harness, store, studyId: header.studyId }
}

// Value: protects=the members of a test history's entry in the node-history catalog, the widened summary contract agents read; fails_when=a member is dropped, renamed or added without this test noticing; why_new=the summary members were asserted nowhere (F35); seam=a real store over a temporary folder; no_claim=the catalog's paging (nodeTestService tests)
test('the node-history catalog entry of a stopped test run carries the summary members and the three resource links', async () => {
  // Arrange
  const { harness, studyId } = await serviceWithOneHistory()
  try {
    // Act
    const catalog = await jsonOf(harness.service, 'codebook://node-history')

    // Assert
    assert.deepEqual(catalog, [
      {
        studyId,
        createdAt: '2026-09-28T00:00:00.000Z',
        profile: 'node-test',
        status: 'partial',
        reason: 'The learner stopped this run.',
        verification: 'verified',
        testFile: 'src/theme.test.ts',
        verdict: 'No result recorded',
        testResult: 'none',
        stopCount: 0,
        explainedStopCount: 0,
        learningCoverage: 'none',
        learningMissing: [{ kind: 'summary' }],
        captureMissing: [{ kind: 'execution' }],
        materialRevision: 0,
        historyUri: `codebook://node-history/${studyId}`,
        eventsUri: `codebook://node-history/${studyId}/events`,
        learningMaterialUri: `codebook://node-history/${studyId}/learning-material`,
      },
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=the cost of reading a history's events and learning-material pages; fails_when=those pages read the history's summary, which only the history body shows; why_new=the summary was read for every page of the history resource (F14); seam=the store counts its summary reads; no_claim=the body's content (other test)
test('a history’s events and learning-material pages read no summary, and its body reads it once', async () => {
  // Arrange
  const { harness, store, studyId } = await serviceWithOneHistory()
  try {
    const base = `codebook://node-history/${studyId}`

    // Act
    await jsonOf(harness.service, `${base}/events`)
    await jsonOf(harness.service, `${base}/learning-material`)
    const callsAfterPages = store.summarizeCalls
    const body = await jsonOf(harness.service, base)

    // Assert
    assert.equal(callsAfterPages, 0)
    assert.equal(store.summarizeCalls, 1)
    assert.deepEqual(
      Object.entries(body as Record<string, unknown>)
        .filter(([key]) => key.startsWith('learning') || key === 'testResult')
        .map(([key, value]) => [key, value]),
      [
        ['testResult', 'none'],
        ['learningCoverage', 'none'],
        ['learningMissing', [{ kind: 'summary' }]],
      ],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent that mistypes one character of a history's study id: the history's resources and codebook_explain_node_history refuse it as NOT_FOUND, naming the id and the catalog to copy a valid one from; fails_when=the store's raw ENOENT reaches the agent as RUNTIME_FAILED "The study operation failed." with a recovery about owned resources and clicks, as N52 saw in VS Code (Copilot Chat read 4735 for 473e in a history's id); why_new=Cycle 0052 task 60 (N52 pt3, VS Code); seam=a real store over a temporary folder that holds one other history; no_claim=a malformed id, which the URI pattern and the input schema refuse first
test('a history resource or an explanation that names a study id this workspace holds no history for is refused as NOT_FOUND, naming the id and the catalog', async () => {
  // Arrange: the workspace holds one history; the agent names an id of the same form that no history has.
  const { harness } = await serviceWithOneHistory()
  const unknownStudyId =
    '11111111-1111-4111-8111-111111111111_22222222-2222-4222-8222-222222222222'
  try {
    // Act
    const answers = await Promise.all(
      [
        readResource(
          harness.service,
          `codebook://node-history/${unknownStudyId}`,
        ),
        readResource(
          harness.service,
          `codebook://node-history/${unknownStudyId}/learning-material`,
        ),
        harness.service.explainNodeHistory({
          studyId: unknownStudyId,
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
              {
                id: 'step-1',
                from: 'test',
                to: 'theme',
                label: 'Reads the theme',
                explanation: 'Observed at this event.',
                evidence: 'observed',
                reference: { type: 'output', sequence: 1, channel: 'stdout' },
              },
            ],
          },
        }),
      ].map((answer) =>
        answer.then(
          () => 'answered',
          (error: unknown) =>
            error instanceof StudyError
              ? { code: error.code, message: error.message }
              : String(error),
        ),
      ),
    )

    // Assert
    const refusal = {
      code: 'NOT_FOUND',
      message:
        'No Node test history 11111111-1111-4111-8111-111111111111_22222222-2222-4222-8222-222222222222 is saved in this workspace. Read codebook://node-history and copy the studyId or historyUri of the history you mean.',
    }
    assert.deepEqual(answers, [refusal, refusal, refusal])
  } finally {
    await harness.close()
  }
})

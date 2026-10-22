import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

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

import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { SEAL_RETRY_DELAY_MS } from '../constants'
import { NodeServerHistoryRecorder } from '../nodeServerHistoryRecorder'

import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
} from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

/** Begins a recorder over a real writer whose first seal fails with the given system code. */
async function recorderWhoseFirstSealFails(
  context: Parameters<typeof openServerRepository>[0],
  code: string,
) {
  const { repository } = await openServerRepository(context)
  const writer = await repository.serverHistories.start(
    nodeServerHistoryHeader(SERVER_WORKSPACE_KEY),
  )
  await writer.appendRequest({
    elapsedMs: 1,
    attempt: 1,
    method: 'GET',
    path: '/x',
    bodyBytes: 0,
  })
  const realSeal = writer.seal.bind(writer)
  let sealCalls = 0
  writer.seal = (end) => {
    sealCalls += 1
    if (sealCalls === 1)
      return Promise.reject(Object.assign(new Error(code), { code }))
    return realSeal(end)
  }
  const waits: number[] = []
  const begun = await NodeServerHistoryRecorder.begin({
    start: async () => writer,
    describeCause: (error) => (error instanceof Error ? error.message : ''),
    sink: { sanitize: (text) => text },
    summarize: async () => undefined,
    retryDelay: async (milliseconds) => {
      waits.push(milliseconds)
    },
  })
  assert.ok('recorder' in begun)
  return { recorder: begun.recorder, waits, sealCalls: () => sealCalls }
}

// protects=a seal that fails once with a transient EBUSY is tried again once after one retry delay and seals; fails_when=the first failure abandons the history, the retry waits another time or never happens; no_claim=real file locking
test('a transient EBUSY seal failure is retried once after one retry delay and seals', async (context) => {
  // Arrange
  const { recorder, waits, sealCalls } = await recorderWhoseFirstSealFails(
    context,
    'EBUSY',
  )

  // Act
  await recorder.seal({ elapsedMs: 5, reason: 'stopped' }, 10_000)

  // Assert
  assert.equal(recorder.status, 'sealed')
  assert.deepEqual(waits, [SEAL_RETRY_DELAY_MS])
  assert.equal(sealCalls(), 2)
})

// protects=a seal that fails with a non-transient code fails at once, with no wait and no second attempt; fails_when=EACCES is retried or the history reads sealed; no_claim=which codes the retry list holds besides EBUSY
test('a non-transient seal failure abandons the history at once without a retry', async (context) => {
  // Arrange
  const { recorder, waits, sealCalls } = await recorderWhoseFirstSealFails(
    context,
    'EACCES',
  )

  // Act
  await recorder.seal({ elapsedMs: 5, reason: 'stopped' }, 10_000)

  // Assert
  assert.equal(recorder.status, 'failed')
  assert.deepEqual(waits, [])
  assert.equal(sealCalls(), 1)
})

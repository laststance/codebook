import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { readResource } from '../resources'

import { realProcessStart } from './utils/realProcessStart'
import {
  recordTwoStops,
  startRecordedExtensionRun,
} from './utils/startRecordedExtensionRun'

before(async () => {
  await realProcessStart(process.pid)
})

// protects=an Extension run resource read answers within the seal bound and starts one stored summary read while it is stalled; fails_when=the read waits on the summary forever or every read queues another summarize; no_claim=which store stalls
test('three run resource reads while the Extension summary read never settles answer within the bound and start one summarize', async (context) => {
  // Arrange
  const { service, run, record, repository } =
    await startRecordedExtensionRun(context)
  recordTwoStops(run, record)
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  let startedReads = 0
  repository.extensionHistories.summarize = () => {
    startedReads += 1
    return new Promise<never>(() => undefined)
  }
  service.chromeExtensionHistorySealBoundMs = 50
  const readOnce = async () => {
    let guard: ReturnType<typeof setTimeout> | undefined
    // gstack-timing-ok: the bound is the contract; a read still pending 5 s after a 50 ms bound waits on the summary read
    const guarded = new Promise<string>((resolve) => {
      guard = setTimeout(() => resolve('pending'), 5_000)
    })
    return Promise.race([
      readResource(service, service.uri(record.id)).then(() => 'answered'),
      guarded,
    ]).finally(() => clearTimeout(guard))
  }

  // Act
  const answers = [await readOnce(), await readOnce(), await readOnce()]

  // Assert
  assert.deepEqual(answers, ['answered', 'answered', 'answered'])
  assert.equal(startedReads, 1)
})

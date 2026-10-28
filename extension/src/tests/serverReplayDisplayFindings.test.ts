import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { presentServerHistory } from '../utils/presentServerHistory'
import { stripNodeHistorySummaryTexts } from '../utils/stripNodeHistorySummaryTexts'
import { wordNodeCaptureReason } from '../utils/wordNodeCaptureReason'

import { openServerRepository } from './utils/nodeServerHistoryFixture'
import { realProcessStart } from './utils/realProcessStart'
import { writeServerHistory } from './utils/sealedServerHistory'

before(async () => {
  await realProcessStart(process.pid)
})

// protects=an interrupted server history's capture-reason line carries the evaluated reasons of its verified prefix (a declared stop never reached), not only the generic no-seal reason; fails_when=the line drops the evaluator's reasons; no_claim=the library row
test('an interrupted server history lists the unreached stop beside the store reason', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const { header } = await writeServerHistory(repository, {
    declaredStops: 2,
    seal: false,
  })
  const history = await repository.serverHistories.read(header.studyId)
  const summary = await repository.serverHistories.summarize(header.studyId)

  // Act
  const presentation = presentServerHistory(history, summary)

  // Assert
  assert.equal(history.status, 'interrupted')
  assert.ok(
    presentation.captureReasons.includes('Declared stop 2 was not reached.'),
    presentation.captureReasons.join(' | '),
  )
})

// protects=a server replay's capture reason is cut to one bounded line like a test replay's, in server words; fails_when=a long reason is shown whole or says test replay; no_claim=the wording of the reasons themselves
test('a server capture reason is one bounded line in server words', () => {
  // Arrange
  const reason = `Interrupted Node server history after its verified prefix: ${'x'.repeat(400)}\nnext line`

  // Act
  const words = wordNodeCaptureReason(reason, 'node-server')

  // Assert
  assert.match(
    words ?? '',
    /^Interrupted server replay after its verified prefix/,
  )
  assert.ok((words ?? '').length <= 240)
  assert.doesNotMatch(words ?? '', /\n|test replay/)
})

// protects=a recorded request failure code in a Saved studies row is free of terminal and bidirectional controls; fails_when=a control in the code reaches the row; no_claim=other recorded texts (covered beside it)
test('a request failure code with a bidirectional control reaches the library row without it', async (context) => {
  // Arrange
  const { repository } = await openServerRepository(context)
  const { header } = await writeServerHistory(repository, { response: null })
  const summary = await repository.serverHistories.summarize(header.studyId)
  assert.ok(summary)

  // Act
  const shown = stripNodeHistorySummaryTexts({
    ...summary,
    requestFailureCode: 'REQUEST‮FAILED',
  })

  // Assert
  assert.equal(shown.requestFailureCode, 'REQUESTFAILED')
})

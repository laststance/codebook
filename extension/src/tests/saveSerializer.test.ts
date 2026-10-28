import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SaveSerializer } from '../utils/SaveSerializer'

import { defer } from './utils/defer'

const SERVICE = { instanceId: 'instance-1' }

// protects=a second Save of the same run while one is running joins it: one promise, one unit of work; fails_when=the second call starts its own work or returns another promise; no_claim=what the work saves
test('a second Save of the same run joins the Save in flight and does the work once', async () => {
  // Arrange
  const saves = new SaveSerializer()
  const gate = defer<void>()
  const workedFor: string[] = []
  const work = async (studyId: string): Promise<void> => {
    workedFor.push(studyId)
    await gate.promise
  }

  // Act
  const first = saves.runFor(SERVICE, { id: 'run-1' }, work, () => undefined)
  const second = saves.runFor(SERVICE, { id: 'run-1' }, work, () => undefined)
  gate.resolve()
  await first

  // Assert
  assert.equal(first, second)
  assert.deepEqual(workedFor, ['instance-1_run-1'])
})

// protects=a Save of another run while one is running is refused in the learner's words; fails_when=the other run's Save starts or the refusal text changes; no_claim=that the first Save still finishes (the next test)
test('a Save of another run while one runs is refused with "Another learning session is being saved"', async () => {
  // Arrange
  const saves = new SaveSerializer()
  const gate = defer<void>()
  const running = saves.runFor(
    SERVICE,
    { id: 'run-1' },
    () => gate.promise,
    () => undefined,
  )
  let otherWorkStarted = false

  // Act
  const attempt = (): Promise<void> =>
    saves.runFor(
      SERVICE,
      { id: 'run-2' },
      async () => {
        otherWorkStarted = true
      },
      () => undefined,
    )

  // Assert
  assert.throws(attempt, {
    message: 'Another learning session is being saved. Wait for its result.',
  })
  assert.equal(otherWorkStarted, false)
  gate.resolve()
  await running
})

// protects=the settled callback fires exactly once per Save however many callers joined it, and a later Save of another run is accepted once the first ended; fails_when=settled fires per joiner or never, or the serializer stays occupied after the work ended; no_claim=the draw of the status item
test('settled fires once for a joined Save and the next run can be saved afterwards', async () => {
  // Arrange
  const saves = new SaveSerializer()
  const gate = defer<void>()
  let settledCount = 0
  const settled = (): void => {
    settledCount++
  }
  const first = saves.runFor(
    SERVICE,
    { id: 'run-1' },
    () => gate.promise,
    settled,
  )
  saves.runFor(SERVICE, { id: 'run-1' }, () => gate.promise, settled)

  // Act
  gate.resolve()
  await first
  const countAfterFirst = settledCount
  const workedFor: string[] = []
  await saves.runFor(
    SERVICE,
    { id: 'run-2' },
    async (studyId) => {
      workedFor.push(studyId)
    },
    settled,
  )

  // Assert
  assert.equal(countAfterFirst, 1)
  assert.equal(settledCount, 2)
  assert.deepEqual(workedFor, ['instance-1_run-2'])
})

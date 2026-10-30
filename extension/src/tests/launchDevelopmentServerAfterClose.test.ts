import assert from 'node:assert/strict'
import { test } from 'node:test'

import { launchDevelopmentServer } from '../utils/launchDevelopmentServer'
import * as signalProcessGroupModule from '../utils/signalProcessGroup'

/** Launches a Node process that only waits, with an `afterClose` the test observes. */
function launchWaiting(afterClose: () => Promise<void>) {
  return launchDevelopmentServer(
    process.cwd(),
    process.execPath,
    () => undefined,
    false,
    0,
    {
      arguments: ['-e', 'setInterval(() => {}, 1000)'],
      environment: { PATH: process.env.PATH },
      name: 'Stub',
      afterClose,
    },
  )
}

test('a failed stop still removes the files the server left behind and reports the stop failure', async (context) => {
  // Arrange
  let afterCloseCalls = 0
  const app = launchWaiting(async () => {
    afterCloseCalls += 1
    throw new Error('cleanup failed too')
  })
  const realSignal = signalProcessGroupModule.signalProcessGroup
  const signalMock = context.mock.method(
    signalProcessGroupModule,
    'signalProcessGroup',
    () => {
      throw new Error('signal delivery failed')
    },
  )
  // Act
  const outcome = await app.close().then(
    () => undefined,
    (cause: unknown) => cause,
  )
  signalMock.mock.restore()
  // The process is still owned: release it for real so the test leaves nothing behind.
  realSignal(app.pid!, 'SIGKILL')
  // Assert
  assert.ok(outcome instanceof Error)
  assert.equal(outcome.message, 'signal delivery failed')
  assert.equal(afterCloseCalls, 1)
})

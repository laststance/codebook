import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { test } from 'node:test'

import { watchOwnedProcess } from '../utils/watchOwnedProcess'

// protects=a waiter on the process's own exit event does not hang when the launch fails to spawn; fails_when=the exit-event promise stays pending after an `error` with no `exit`; no_claim=real executables that start (other tests cover them)
test('a spawn of a missing executable settles the exit event with no code and no signal', async () => {
  // Arrange
  const child = spawn('/nonexistent/codebook-missing-executable', [])
  const watched = watchOwnedProcess(child, {
    startedAt: process.hrtime.bigint(),
    pendingLimitBytes: 1_024,
    overflowMessage: 'overflow',
    failurePrefix: 'failed',
  })

  // Act
  const fact = await Promise.race([
    watched.exitEvent,
    new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 5_000)),
  ])

  // Assert
  assert.deepEqual(fact, { exitCode: null, signal: null })
  assert.equal(watched.failure()?.message.includes('ENOENT'), true)
  assert.equal(watched.exitFact(), undefined)
})

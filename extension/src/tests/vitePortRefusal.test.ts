import assert from 'node:assert/strict'
import { test } from 'node:test'

import { vitePortRefusal } from '../utils/vitePortRefusal'

const SOURCE = 'the Vite config (vite.config.ts)'

// Value: protects=a port the system forbids is worded as not permitted and names the first usable port; fails_when=the reason falls through to the "in use" sentence or the 1024 floor is lost
test('a not-permitted port is refused as VITE_PORT_UNAVAILABLE asking for a port from 1024 up', () => {
  // Arrange
  const refusal = { port: 80, reason: 'not-permitted' } as const
  // Act
  const error = vitePortRefusal(refusal, SOURCE)
  // Assert
  assert.equal(error.code, 'VITE_PORT_UNAVAILABLE')
  assert.equal(
    error.message,
    'Port 80 (the Vite config (vite.config.ts)) is not permitted for Codebook on this machine (the operating system refuses to let this program listen on it). Ask the learner to use a port from 1024 up.',
  )
})

// Value: protects=a port that could not be probed says so with the operating-system code; fails_when=an unreadable port is reported as busy
test('an unreadable port is refused as VITE_PORT_UNAVAILABLE naming the error code and that Vite did not start', () => {
  // Arrange
  const refusal = {
    port: 3010,
    reason: 'unreadable',
    errorCode: 'EACCES',
  } as const
  // Act
  const error = vitePortRefusal(refusal, SOURCE)
  // Assert
  assert.equal(error.code, 'VITE_PORT_UNAVAILABLE')
  assert.equal(
    error.message,
    'Codebook could not check whether Port 3010 (the Vite config (vite.config.ts)) is free (EACCES), so it did not start Vite.',
  )
})

// Value: protects=an unreadable port without a code still words the refusal; fails_when=the message prints "undefined"
test('an unreadable port without an error code is refused as an unknown error', () => {
  // Arrange
  const refusal = { port: 3010, reason: 'unreadable' } as const
  // Act
  const error = vitePortRefusal(refusal, SOURCE)
  // Assert
  assert.match(error.message, /\(unknown error\), so it did not start Vite\.$/)
})

// Value: protects=a port held by an earlier Codebook run tells the agent to stop it and wait, in the running and the stopping state; fails_when=either state reads as a foreign process
test('a port held by an earlier Codebook run is refused with the stop-and-wait recovery for both states', () => {
  // Arrange
  const running = {
    port: 3010,
    reason: 'held-by-codebook',
    heldBy: 'running',
  } as const
  const stopping = {
    port: 3010,
    reason: 'held-by-codebook',
    heldBy: 'stopping',
  } as const
  // Act
  const runningError = vitePortRefusal(running, SOURCE)
  const stoppingError = vitePortRefusal(stopping, SOURCE)
  // Assert
  assert.equal(
    runningError.message,
    'Port 3010 (the Vite config (vite.config.ts)) is still held by an earlier Codebook run that is still running. Stop that run (codebook_stop) and wait for it to finish, then start again.',
  )
  assert.equal(
    stoppingError.message,
    'Port 3010 (the Vite config (vite.config.ts)) is still held by an earlier Codebook run that has not finished stopping. Stop that run (codebook_stop) and wait for it to finish, then start again.',
  )
})

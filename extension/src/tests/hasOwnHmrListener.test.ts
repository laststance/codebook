import assert from 'node:assert/strict'
import test from 'node:test'

import { hasOwnHmrListener } from '../utils/hasOwnHmrListener'

test('a Vite 8 default hmr whose listener keys are present but undefined is not refused as its own listener', () => {
  // Arrange: the shape Vite 8.3.5 resolves for a config without server.hmr (observed on P07 nsx).
  const resolvedDefault = {
    protocol: undefined,
    host: undefined,
    port: undefined,
    clientPort: undefined,
    path: undefined,
    timeout: undefined,
    server: undefined,
  }
  // Act
  const ownListener = hasOwnHmrListener(resolvedDefault)
  // Assert
  assert.equal(ownListener, false)
})

test('an hmr with its own port is refused as a second listener', () => {
  // Arrange
  const ownPort = { port: 24678, overlay: true }
  // Act
  const ownListener = hasOwnHmrListener(ownPort)
  // Assert
  assert.equal(ownListener, true)
})

test('an hmr with its own host is refused as a second listener', () => {
  // Arrange
  const ownHost = { host: '0.0.0.0' }
  // Act
  const ownListener = hasOwnHmrListener(ownHost)
  // Assert
  assert.equal(ownListener, true)
})

test('a boolean or absent hmr keeps the websocket on the dev server and is not refused', () => {
  // Arrange
  const values = [true, false, undefined]
  // Act
  const results = values.map((value) => hasOwnHmrListener(value))
  // Assert
  assert.deepEqual(results, [false, false, false])
})

test('an hmr that only sets the client port or overlay is not refused', () => {
  // Arrange
  const clientOnly = { clientPort: 443, overlay: false }
  // Act
  const ownListener = hasOwnHmrListener(clientOnly)
  // Assert
  assert.equal(ownListener, false)
})

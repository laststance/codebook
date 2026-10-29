import assert from 'node:assert/strict'
import { createServer, type Socket } from 'node:net'
import { test } from 'node:test'

import { WebSocketServer } from 'ws'

import { openWebSocket } from '../runtimeSupport/utils/openWebSocket'

// protects=a CDP client gets an open socket from a live endpoint; fails_when=openWebSocket resolves before open or never resolves; why_new=Cdp.connect lost its inline connect code to this helper and no test calls it directly; seam=none; no_claim=a real Chrome endpoint (local ws server)
test('resolves with an open socket once the endpoint accepts', async () => {
  // Arrange
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address() as { port: number }

  // Act
  const socket = await openWebSocket(`ws://127.0.0.1:${port}`, 2_000)

  // Assert
  assert.equal(socket.readyState, WebSocket.OPEN)
  socket.close()
  await new Promise((resolve) => server.close(resolve))
})

// protects=a refused connection is reported as "CDP connection failed"; fails_when=the error is swallowed, hangs until the timeout or carries another message; why_new=same helper, error path; seam=none; no_claim=other network failures
test('rejects with "CDP connection failed" when nothing listens', async () => {
  // Arrange
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as { port: number }
  await new Promise((resolve) => probe.close(resolve))

  // Act
  const opening = openWebSocket(`ws://127.0.0.1:${port}`, 2_000)

  // Assert
  await assert.rejects(opening, { message: 'CDP connection failed' })
})

// protects=an endpoint that accepts the connection and never answers the upgrade is reported as "CDP connection timed out"; fails_when=closing the connecting socket reports "CDP connection failed" first or the call never settles; why_new=the timeout path had no test and its message was unreachable; seam=none; no_claim=real Chrome stalls (a silent local TCP server)
test('rejects with "CDP connection timed out" when the endpoint never answers the upgrade', async () => {
  // Arrange
  const held: Socket[] = []
  const silent = createServer((connection) => held.push(connection))
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
  const { port } = silent.address() as { port: number }

  // Act
  const opening = openWebSocket(`ws://127.0.0.1:${port}`, 200)

  // Assert
  await assert.rejects(opening, { message: 'CDP connection timed out' })
  for (const connection of held) connection.destroy()
  await new Promise((resolve) => silent.close(resolve))
})

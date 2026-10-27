import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, type Server } from 'node:net'
import { test, type TestContext } from 'node:test'

import { waitForServerReadiness } from '../utils/waitForServerReadiness'

import { freeLoopbackPort } from './utils/freeLoopbackPort'

/**
 * Listens on one loopback address until the test ends.
 * @param context - The test.
 * @param host - The address.
 * @param port - The port.
 * @returns The listener.
 * @example await listenOn(t, '::1', 4100)
 */
async function listenOn(
  context: TestContext,
  host: string,
  port: number,
): Promise<Server> {
  const listener = createServer((socket) => socket.destroy())
  listener.listen(port, host)
  await once(listener, 'listening')
  context.after(async () => {
    listener.close()
    await once(listener, 'close')
  })
  return listener
}

/**
 * Says whether the machine can bind `::1`, so IPv6 cases can be skipped where it cannot.
 * @returns `true` when `::1` can be bound.
 * @example await hasIpv6Loopback() // => true
 */
async function hasIpv6Loopback(): Promise<boolean> {
  const probe = createServer()
  probe.listen(0, '::1')
  try {
    await once(probe, 'listening')
    probe.close()
    await once(probe, 'close')
    return true
  } catch {
    return false
  }
}

// protects=a server listening on IPv4 only is found and requests go to 127.0.0.1; fails_when=IPv4 is not probed or the host is reported wrong; no_claim=who owns the listener
test('a server listening on 127.0.0.1 only is ready on 127.0.0.1 and not on both addresses', async (t) => {
  // Arrange
  const port = await freeLoopbackPort()
  await listenOn(t, '127.0.0.1', port)
  // Act
  const ready = await waitForServerReadiness({
    port,
    hasTimeLeft: () => true,
    signal: new AbortController().signal,
  })
  // Assert
  assert.deepEqual(ready, { host: '127.0.0.1', bothAccept: false })
})

// protects=a server that listens on ::1 only is found; fails_when=IPv6 is never probed; no_claim=IPv4 behaviour
test('a server listening on ::1 only is ready on ::1', async (t) => {
  // Arrange
  if (!(await hasIpv6Loopback())) return t.skip('this machine has no ::1')
  const port = await freeLoopbackPort()
  await listenOn(t, '::1', port)
  // Act
  const ready = await waitForServerReadiness({
    port,
    hasTimeLeft: () => true,
    signal: new AbortController().signal,
  })
  // Assert
  assert.deepEqual(ready, { host: '::1', bothAccept: false })
})

// protects=127.0.0.1 is preferred when both accept and the run learns both did; fails_when=IPv6 wins or bothAccept stays false; no_claim=dual-stack wildcard semantics
test('a server accepting on both loopback addresses is ready on 127.0.0.1 with both reported', async (t) => {
  // Arrange
  if (!(await hasIpv6Loopback())) return t.skip('this machine has no ::1')
  const port = await freeLoopbackPort()
  await listenOn(t, '127.0.0.1', port)
  await listenOn(t, '::1', port)
  // Act
  const ready = await waitForServerReadiness({
    port,
    hasTimeLeft: () => true,
    signal: new AbortController().signal,
  })
  // Assert
  assert.deepEqual(ready, { host: '127.0.0.1', bothAccept: true })
})

// protects=a port nobody listens on ends at the run's budget instead of waiting forever; fails_when=the wait ignores hasTimeLeft; no_claim=the 30 s value
test('a port nobody listens on is reported not ready once the budget is spent', async () => {
  // Arrange
  const port = await freeLoopbackPort()
  const deadline = performance.now() + 300
  // Act
  const ready = await waitForServerReadiness({
    port,
    hasTimeLeft: () => performance.now() < deadline,
    signal: new AbortController().signal,
    pollIntervalMs: 20,
  })
  // Assert
  assert.equal(ready, undefined)
})

// protects=a server that starts listening during the wait is found by a later round; fails_when=only the first round probes; no_claim=none
test('a server that starts listening after the first round is found by a later round', async (t) => {
  // Arrange
  const port = await freeLoopbackPort()
  const wait = waitForServerReadiness({
    port,
    hasTimeLeft: () => true,
    signal: new AbortController().signal,
    pollIntervalMs: 20,
  })
  // Act
  // gstack-timing-ok: the pause only lets the first refused rounds pass before the server starts; the wait has no deadline (hasTimeLeft stays true), so a slower start still ends ready and the assertion never depends on the timing.
  await new Promise((resolve) => setTimeout(resolve, 100))
  await listenOn(t, '127.0.0.1', port)
  // Assert
  assert.deepEqual(await wait, { host: '127.0.0.1', bothAccept: false })
})

// protects=a stopping run ends the readiness wait; fails_when=abort does not reject; no_claim=the abort reason's type
test('aborting the signal ends the readiness wait with the abort reason', async () => {
  // Arrange
  const port = await freeLoopbackPort()
  const controller = new AbortController()
  const wait = waitForServerReadiness({
    port,
    hasTimeLeft: () => true,
    signal: controller.signal,
    pollIntervalMs: 20,
  })
  // Act
  controller.abort(new Error('run stopped'))
  // Assert
  await assert.rejects(wait, /run stopped/)
})

// protects=a run stopped during the poll pause fails with its own reason (not an AbortError); fails_when=the pause rejects with a generic AbortError; no_claim=abort during a probe (covered above)
test('aborting during the pause between rounds rejects with the signal reason itself', async () => {
  // Arrange
  const port = await freeLoopbackPort()
  const controller = new AbortController()
  const reason = new Error('pause hold expired')
  const wait = waitForServerReadiness({
    port,
    hasTimeLeft: () => true,
    signal: controller.signal,
    pollIntervalMs: 60_000,
  })
  // Act: the refused probes end in milliseconds, so the wait is inside its 60 s pause
  // gstack-timing-ok: refused loopback probes end in milliseconds, far within the 150 ms before the abort, and the 60 s pause keeps the wait in its pause for any slower machine.
  await new Promise((resolve) => setTimeout(resolve, 150))
  controller.abort(reason)
  // Assert
  await assert.rejects(wait, (error: unknown) => error === reason)
})

import assert from 'node:assert/strict'
import type { LookupAddress } from 'node:dns'
import { test } from 'node:test'

import { resolveReverseProxyHost } from '../utils/resolveReverseProxyHost'

/** A stand-in resolver that answers with the given addresses. */
function answering(...answers: LookupAddress[]) {
  return { lookup: async () => answers }
}

const neverCancelled = new AbortController().signal

// Value: protects=a host with no answer is never trusted; fails_when=an empty answer is read as a loopback address or throws; no_claim=the real resolver
test('an empty resolver answer is refused as not-resolved', async () => {
  // Arrange
  const dependencies = answering()
  // Act
  const result = await resolveReverseProxyHost(
    'app.example.test',
    dependencies,
    neverCancelled,
  )
  // Assert
  assert.deepEqual(result, { ok: false, reason: 'not-resolved' })
})

// Value: protects=a resolver failure ends in a refusal instead of an unhandled rejection; fails_when=a rejected lookup escapes; no_claim=which error the resolver raised
test('a failing resolver is refused as not-resolved', async () => {
  // Arrange
  const dependencies = {
    lookup: async (): Promise<LookupAddress[]> => {
      throw new Error('ENOTFOUND')
    },
  }
  // Act
  const result = await resolveReverseProxyHost(
    'app.example.test',
    dependencies,
    neverCancelled,
  )
  // Assert
  assert.deepEqual(result, { ok: false, reason: 'not-resolved' })
})

// Value: protects=a stalled getaddrinfo cannot hold the run beyond 5 s; fails_when=the timeout is removed or longer than 5000 ms; no_claim=the late answer (it is dropped)
test('a resolver that never answers is refused as not-resolved after 5 seconds', async (context) => {
  // Arrange
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const dependencies = {
    lookup: () => new Promise<LookupAddress[]>(() => {}),
  }
  // Act
  const pending = resolveReverseProxyHost(
    'app.example.test',
    dependencies,
    neverCancelled,
  )
  context.mock.timers.tick(4_999)
  context.mock.timers.tick(1)
  const result = await pending
  // Assert
  assert.deepEqual(result, { ok: false, reason: 'not-resolved' })
})

// Value: protects=a cancelled run stops waiting for the resolver; fails_when=the signal is not part of the race; no_claim=the lookup itself is cancelled (it cannot be)
test('a cancelled run rejects with the signal reason while the resolver is pending', async () => {
  // Arrange
  const controller = new AbortController()
  const dependencies = {
    lookup: () => new Promise<LookupAddress[]>(() => {}),
  }
  // Act
  const pending = resolveReverseProxyHost(
    'app.example.test',
    dependencies,
    controller.signal,
  )
  controller.abort(new Error('run cancelled'))
  // Assert
  await assert.rejects(pending, { message: 'run cancelled' })
})

// Value: protects=every loopback form of the 127.0.0.0/8 block and ::1 is accepted with its family; fails_when=127.0.0.2 or ::1 is refused; no_claim=addresses outside the block
for (const [address, family] of [
  ['127.0.0.1', 4],
  ['127.0.0.2', 4],
  ['::1', 6],
] as const) {
  test(`${address} is accepted as the validated loopback address`, async () => {
    // Arrange
    const dependencies = answering({ address, family })
    // Act
    const result = await resolveReverseProxyHost(
      'app.example.test',
      dependencies,
      neverCancelled,
    )
    // Assert
    assert.deepEqual(result, { ok: true, address, family })
  })
}

// Value: protects=one non-loopback answer makes the whole host untrusted and is named; fails_when=only the first answer is checked; no_claim=which address a browser would pick
test('a mixed answer is refused as not-loopback naming the first outside address', async () => {
  // Arrange
  const dependencies = answering(
    { address: '127.0.0.1', family: 4 },
    { address: '192.0.2.10', family: 4 },
    { address: '198.51.100.7', family: 4 },
  )
  // Act
  const result = await resolveReverseProxyHost(
    'app.example.test',
    dependencies,
    neverCancelled,
  )
  // Assert
  assert.deepEqual(result, {
    ok: false,
    reason: 'not-loopback',
    address: '192.0.2.10',
  })
})

// Value: protects=an IPv4-mapped loopback and an unspecified address are not trusted; fails_when=::ffff:127.0.0.1 or 0.0.0.0 passes the block list; no_claim=how the browser treats them
for (const [address, family] of [
  ['::ffff:127.0.0.1', 6],
  ['0.0.0.0', 4],
] as const) {
  test(`${address} is refused as not-loopback`, async () => {
    // Arrange
    const dependencies = answering({ address, family })
    // Act
    const result = await resolveReverseProxyHost(
      'app.example.test',
      dependencies,
      neverCancelled,
    )
    // Assert
    assert.deepEqual(result, { ok: false, reason: 'not-loopback', address })
  })
}

// Value: protects=the validated address is the resolver's first answer; fails_when=the list is sorted or the last answer is used; no_claim=any preference between IPv4 and IPv6
test('the first resolver answer is the validated address', async () => {
  // Arrange
  const dependencies = answering(
    { address: '::1', family: 6 },
    { address: '127.0.0.1', family: 4 },
  )
  // Act
  const result = await resolveReverseProxyHost(
    'app.example.test',
    dependencies,
    neverCancelled,
  )
  // Assert
  assert.deepEqual(result, { ok: true, address: '::1', family: 6 })
})

// Value: protects=Codebook's own dev-server sockets cannot be the proxy; fails_when=127.0.0.1 or ::1 at the upstream port is accepted; no_claim=a different port or a different loopback address
for (const [address, family] of [
  ['127.0.0.1', 4],
  ['::1', 6],
] as const) {
  test(`${address} at the upstream port is refused as same-socket`, async () => {
    // Arrange
    const dependencies = answering({ address, family })
    // Act
    const result = await resolveReverseProxyHost(
      'app.example.test',
      dependencies,
      neverCancelled,
      { effectivePort: 4310, upstreamPort: 4310 },
    )
    // Assert
    assert.deepEqual(result, { ok: false, reason: 'same-socket', address })
  })
}

// Value: protects=127.0.0.2 at the upstream port can coexist with the dev server's 127.0.0.1 and stays allowed; fails_when=same-socket fires for any loopback address; no_claim=that the proxy really listens there
test("127.0.0.2 at the upstream port is accepted because it is not Codebook's own socket", async () => {
  // Arrange
  const dependencies = answering({ address: '127.0.0.2', family: 4 })
  // Act
  const result = await resolveReverseProxyHost(
    'app.example.test',
    dependencies,
    neverCancelled,
    { effectivePort: 4310, upstreamPort: 4310 },
  )
  // Assert
  assert.deepEqual(result, { ok: true, address: '127.0.0.2', family: 4 })
})

// Value: protects=a proxy on the origin's own port (443) differs from the dev server and stays allowed; fails_when=same-socket ignores the port; no_claim=the origin port is reachable
test('127.0.0.1 at a different port than the upstream port is accepted', async () => {
  // Arrange
  const dependencies = answering({ address: '127.0.0.1', family: 4 })
  // Act
  const result = await resolveReverseProxyHost(
    'app.example.test',
    dependencies,
    neverCancelled,
    { effectivePort: 443, upstreamPort: 4310 },
  )
  // Assert
  assert.deepEqual(result, { ok: true, address: '127.0.0.1', family: 4 })
})

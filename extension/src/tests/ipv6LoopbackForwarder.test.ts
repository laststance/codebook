import assert from 'node:assert/strict'
import { createConnection, createServer, type Socket } from 'node:net'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { startIpv6LoopbackForwarder } from '../utils/startIpv6LoopbackForwarder'

/** Starts a stand-in for the owned `next dev` on 127.0.0.1 that answers `echo:` plus what it receives; the port is the OS's choice. */
async function startEchoServer(context: TestContext) {
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('data', (data) => socket.write(`echo:${data}`))
  })
  await new Promise<void>((resolve) =>
    server.listen({ host: '127.0.0.1', port: 0 }, resolve),
  )
  context.after(() => {
    for (const socket of sockets) socket.destroy()
    return new Promise((resolve) => server.close(resolve))
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return address.port
}

/** Longest wait for a reply; a broken forwarder then fails the test as 'TIMEOUT' instead of hanging it. */
const EXCHANGE_TIMEOUT_MS = 3000

/** Sends one message to `[::1]:port` and returns the reply, the connect error code, or 'TIMEOUT'. */
function exchange(port: number, message: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '::1', port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve('TIMEOUT')
    }, EXCHANGE_TIMEOUT_MS)
    socket.once('close', () => clearTimeout(timer))
    socket.once('data', (data) => {
      socket.destroy()
      resolve(String(data))
    })
    socket.once('error', (error: NodeJS.ErrnoException) =>
      resolve(error.code ?? 'error'),
    )
    socket.once('connect', () => socket.write(message))
  })
}

// Value: protects=Codebook owns [::1]:<port> for the run and carries the browser's bytes to its own server and back (D66, F427); fails_when=the forwarder is missing while the run lives, drops bytes in either direction, or stays after close; why_new=a process that takes [::1] after the pre-check would be treated as the owned app; seam=a real forwarder on an OS-chosen port and an echo server on 127.0.0.1; no_claim=a real browser
test('the [::1] forwarder carries bytes both ways while open and refuses connections after close', async (context) => {
  // Arrange
  const port = await startEchoServer(context)
  const forwarder = await startIpv6LoopbackForwarder(port)
  if (!forwarder) return context.skip('[::1] is not available on this host')

  // Act
  const reply = await exchange(port, 'ping')
  await forwarder.close()
  const afterClose = await exchange(port, 'ping')

  // Assert
  assert.equal(reply, 'echo:ping')
  assert.equal(afterClose, 'ECONNREFUSED')
})

// Value: protects=a process that already holds [::1]:<port> refuses the start as a busy port naming [::1] (D66); fails_when=the start passes, or the refusal names no [::1]; why_new=F427; seam=a real listener on [::1] at an OS-chosen port; no_claim=the learner's actual process
test('a process already holding [::1] at the port refuses the start naming [::1]', async (context) => {
  // Arrange
  const holder = createServer()
  const bound = await new Promise<boolean>((resolve) => {
    holder.once('error', () => resolve(false))
    holder.listen({ host: '::1', port: 0 }, () => resolve(true))
  })
  if (!bound) return context.skip('[::1] is not available on this host')
  context.after(() => new Promise((resolve) => holder.close(resolve)))
  const address = holder.address()
  assert.ok(address && typeof address === 'object')

  // Act
  const refusal = await startIpv6LoopbackForwarder(address.port).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'PREREQUISITE_MISSING')
  assert.match(refusal.message, /\[::1\]/)
  assert.match(refusal.message, /in use on this machine at \[::1\]/)
})

// Value: protects=a host without IPv6 loopback skips the forwarder instead of failing the run (D66); fails_when=EADDRNOTAVAIL aborts the start; why_new=F427; seam=an IPv6 address no host owns; no_claim=a host that really lacks IPv6
test('a host without the IPv6 address starts no forwarder', async () => {
  // Arrange
  const port = 54002

  // Act
  const forwarder = await startIpv6LoopbackForwarder(port, {
    bindHost: '2001:db8::dead:beef',
  })

  // Assert
  assert.equal(forwarder, undefined)
})

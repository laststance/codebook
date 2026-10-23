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

/** Returns a port nothing listens on right now (the OS's choice, released at once). */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) =>
    probe.listen({ host: '127.0.0.1', port: 0 }, resolve),
  )
  const address = probe.address()
  assert.ok(address && typeof address === 'object')
  await new Promise((resolve) => probe.close(resolve))
  return address.port
}

// Value: protects=a host without IPv6 loopback skips the forwarder instead of failing the run (D66); fails_when=EADDRNOTAVAIL aborts the start; why_new=F427, F455 (a free port, and a forwarder a host with non-local binds starts is closed); seam=an IPv6 address no host owns on an OS-chosen free port; no_claim=a host that really lacks IPv6
test('a host without the IPv6 address starts no forwarder', async () => {
  // Arrange
  const port = await freePort()
  let forwarder: Awaited<ReturnType<typeof startIpv6LoopbackForwarder>>

  try {
    // Act
    forwarder = await startIpv6LoopbackForwarder(port, {
      bindHost: '2001:db8::dead:beef',
    })

    // Assert
    assert.equal(forwarder, undefined)
  } finally {
    // A host with non-local binds would start one; it must not outlive the test.
    await forwarder?.close()
  }
})

/** Longest wait for an event a broken forwarder never delivers; the test then fails as 'TIMEOUT' instead of hanging. */
const EVENT_TIMEOUT_MS = 3000

/** Resolves with the outcome of `promise`, or 'TIMEOUT' when it does not settle in {@link EVENT_TIMEOUT_MS}. */
function withinTimeout<T>(promise: Promise<T>): Promise<T | 'TIMEOUT'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('TIMEOUT'), EVENT_TIMEOUT_MS)
    void promise.then((value) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

/** Starts a stand-in upstream on 127.0.0.1 (OS-chosen port) that keeps half-open connections and runs `onConnection` for each. */
async function startUpstream(
  context: TestContext,
  onConnection: (socket: Socket) => void,
) {
  const sockets = new Set<Socket>()
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket)
    socket.on('error', () => undefined)
    onConnection(socket)
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

/** Opens a connection to `[::1]:port` that tolerates a half-close and collects everything it receives until it closes. */
function connectIpv6(context: TestContext, port: number) {
  const socket = createConnection({ host: '::1', port, allowHalfOpen: true })
  // A client left open would keep the test process alive after a failure.
  context.after(() => socket.destroy())
  const chunks: Buffer[] = []
  socket.on('data', (chunk: Buffer) => chunks.push(chunk))
  // A half-open client must end its own side once the peer has ended, or it never closes.
  socket.on('end', () => socket.end())
  const closed = new Promise<void>((resolve) => {
    socket.once('close', () => resolve())
    socket.once('error', () => resolve())
  })
  const connected = new Promise<void>((resolve) =>
    socket.once('connect', () => resolve()),
  )
  return { socket, chunks, closed, connected }
}

// Value: protects=a client that half-closes after sending still receives the whole reply through [::1] (F448: the forwarder destroyed the pair on the client's FIN); fails_when=the upstream reply sent after the client's FIN is lost; why_new=OCR medium of the review of 944a4d25..6bc9eab2, reproduced with end('hi'); seam=a real forwarder and an upstream on 127.0.0.1 that answers only after the client's FIN; no_claim=a real browser
test('a client that half-closes after sending still gets the reply through [::1]', async (context) => {
  // Arrange
  const port = await startUpstream(context, (socket) => {
    const received: Buffer[] = []
    socket.on('data', (chunk: Buffer) => received.push(chunk))
    socket.on('end', () => socket.end(`reply:${Buffer.concat(received)}`))
  })
  const forwarder = await startIpv6LoopbackForwarder(port)
  if (!forwarder) return context.skip('[::1] is not available on this host')
  context.after(() => forwarder.close())
  const client = connectIpv6(context, port)

  // Act
  await client.connected
  client.socket.end('hi')
  const outcome = await withinTimeout(client.closed)

  // Assert
  assert.equal(outcome, undefined)
  assert.equal(Buffer.concat(client.chunks).toString(), 'reply:hi')
})

/** The size of the reply that the large-reply test sends (16 MiB): more than the send and receive buffers of a loopback pair hold together (a few MiB at most), yet small enough to allocate once without memory pressure on CI. */
const LARGE_REPLY_BYTES = 16_777_216

// Value: protects=a large reply that the upstream sends and then closes arrives whole at a slow client (F448: a socket's close destroyed the other and dropped the buffered tail); fails_when=the client receives fewer bytes than the upstream wrote; why_new=OCR medium of the review of 944a4d25..6bc9eab2; seam=a real forwarder, an upstream that writes one 16 MiB buffer and ends, and a client that pauses reading for 300 ms; no_claim=a real browser
test('a large reply that the upstream closes right after sending arrives whole through [::1]', async (context) => {
  // Arrange
  const reply = Buffer.alloc(LARGE_REPLY_BYTES, 'x')
  const port = await startUpstream(context, (socket) => socket.end(reply))
  const forwarder = await startIpv6LoopbackForwarder(port)
  if (!forwarder) return context.skip('[::1] is not available on this host')
  context.after(() => forwarder.close())
  const client = connectIpv6(context, port)
  client.socket.pause()

  // Act
  await client.connected
  await new Promise((resolve) => setTimeout(resolve, 300))
  client.socket.resume()
  const outcome = await withinTimeout(client.closed)

  // Assert
  assert.equal(outcome, undefined)
  // The lengths are summed, so the 16 MiB reply is not copied again into one buffer.
  assert.equal(
    client.chunks.reduce((total, chunk) => total + chunk.length, 0),
    LARGE_REPLY_BYTES,
  )
})

// Value: protects=closing the forwarder while a connection is open resolves and ends that connection, so the run's cleanup never hangs on a browser connection (D66); fails_when=close never resolves, the open client stays connected, or the first reply never arrives (bounded by 3 s, no hang until the runner's silence limit); why_new=F455 (close with open connections was untested); seam=a real forwarder with one idle connection through to an echo upstream; no_claim=a real browser
test('closing the forwarder while a connection is open ends that connection', async (context) => {
  // Arrange
  const port = await startUpstream(context, (socket) =>
    socket.on('data', (data) => socket.write(`echo:${data}`)),
  )
  const forwarder = await startIpv6LoopbackForwarder(port)
  if (!forwarder) return context.skip('[::1] is not available on this host')
  context.after(() => forwarder.close())
  const client = connectIpv6(context, port)
  await client.connected
  client.socket.write('ping')
  // The first reply is awaited within a bound, so a forwarder that carries nothing fails here and not at the runner's silence limit.
  const firstReply = await withinTimeout(
    new Promise<void>((resolve) => client.socket.once('data', () => resolve())),
  )

  // Act
  const closing = await withinTimeout(forwarder.close())
  const clientEnd = await withinTimeout(client.closed)

  // Assert
  assert.equal(firstReply, undefined)
  assert.equal(closing, undefined)
  assert.equal(clientEnd, undefined)
})

// Value: protects=a refused upstream connection closes the client's connection instead of leaving it open for ever (F455); fails_when=the client stays connected after the upstream refuses; why_new=the refusal path was untested; seam=a real forwarder to a free port nothing listens on; no_claim=a real browser
test('a refused upstream connection closes the client connection', async (context) => {
  // Arrange
  const port = await freePort()
  const forwarder = await startIpv6LoopbackForwarder(port)
  if (!forwarder) return context.skip('[::1] is not available on this host')
  context.after(() => forwarder.close())
  const client = connectIpv6(context, port)

  // Act
  const outcome = await withinTimeout(client.closed)

  // Assert
  assert.equal(outcome, undefined)
})

/** A server whose listen fails with the given system error, as a host does for a port it does not permit (EACCES). */
function failingListenServer(
  code: string,
  message: string,
): typeof createServer {
  return () => {
    const server = createServer()
    server.listen = (() => {
      setImmediate(() =>
        server.emit('error', Object.assign(new Error(message), { code })),
      )
      return server
    }) as typeof server.listen
    return server
  }
}

// Value: protects=EACCES on [::1] is told as not permitted for Codebook, not as another process listening there (F453); fails_when=the message tells the learner to stop a process or omits [::1]; why_new=OCR low of the review of 944a4d25..6bc9eab2; seam=a server whose listen fails with EACCES (the host raises it only for privileged ports); no_claim=a real privileged port
test('a [::1] port the system does not permit is refused as not permitted', async () => {
  // Arrange
  const port = 54010
  const failing = failingListenServer('EACCES', 'listen EACCES')

  // Act
  const refusal = await startIpv6LoopbackForwarder(port, {
    createServer: failing,
  }).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'PREREQUISITE_MISSING')
  assert.match(
    refusal.message,
    /^Port 54010 is not permitted for Codebook at \[::1\] on this machine/,
  )
  assert.doesNotMatch(refusal.message, /stop the process/)
})

// Value: protects=any other listen failure on [::1] is a typed prerequisite error whose cause names the error code and no private text (F453); fails_when=a raw Error without a code escapes, or the cause carries the failure's path; why_new=OCR low of the review of 944a4d25..6bc9eab2; seam=a server whose listen fails with EINVAL and a message holding a private path; no_claim=every errno
test('another listen failure on [::1] is a typed error whose cause names only the code', async () => {
  // Arrange
  const port = 54011
  const failing = failingListenServer(
    'EINVAL',
    'listen EINVAL /Users/ada/private/socket',
  )

  // Act
  const refusal = await startIpv6LoopbackForwarder(port, {
    createServer: failing,
  }).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'PREREQUISITE_MISSING')
  assert.match(
    refusal.message,
    /^Codebook could not listen on \[::1\]:54011 \(EINVAL\), and /,
  )
  assert.equal(refusal.causeDetail, 'listen EINVAL on [::1]:54011')
  assert.doesNotMatch(refusal.message, /ada/)
})

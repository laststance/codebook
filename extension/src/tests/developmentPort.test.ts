import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import type { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { StudyError } from '../errors'
import {
  assertDevelopmentPortFree,
  type ConnectLoopback,
} from '../utils/assertDevelopmentPortFree'
import {
  beginReleaseOfOwnedDevelopmentPort,
  claimOwnedDevelopmentPort,
  ownedDevelopmentPortState,
  releaseOwnedDevelopmentPort,
} from '../utils/ownedDevelopmentPorts'
import { readDeclaredDevelopmentPort } from '../utils/readDeclaredDevelopmentPort'

/** Makes a project folder with the given files, runs the check and removes the folder. */
async function declaredPortOf(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'codebook-port-'))
  try {
    for (const [name, text] of Object.entries(files))
      await writeFile(join(root, name), text)
    return await readDeclaredDevelopmentPort(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const devScript = (script: string): string =>
  JSON.stringify({ scripts: { dev: script } })

// Value: protects=the app starts on the port the dev script declares, in each flag form; fails_when=a form is ignored and the app moves to another port than the one AUTH_URL names; why_new=F411 (N50) started every run on an ephemeral port; seam=temporary project folders; no_claim=that Next accepts every form itself
for (const [script, port] of [
  ['next dev --turbo -p 3165', 3165],
  ['next dev --port 4100', 4100],
  ['next dev -p=4200', 4200],
  ['next dev --port=4300', 4300],
  ['next dev -p4400 --turbo', 4400],
  ['mkdir -p 5 && next dev -p 4500', 4500],
] as const)
  test(`the dev script "${script}" declares port ${port}`, async () => {
    // Arrange
    const files = { 'package.json': devScript(script) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, {
      port,
      source: 'the dev script in package.json',
    })
  })

/** A package.json with the given scripts. */
const packageScripts = (scripts: Record<string, string>): string =>
  JSON.stringify({ scripts })

// Value: protects=the port is the one the project's own `next dev` command would use, in each shell form D67 names (F430); fails_when=a form is misread and the app starts on another port than the project's AUTH_URL names; why_new=OCR M2-M5, L2, L9 of the review of e638c1b..7139a69e; seam=temporary project folders; no_claim=Next honoring PORT itself
for (const [name, scripts, expected] of [
  ['an env prefix', { dev: 'PORT=4401 next dev' }, 4401],
  [
    'cross-env',
    { dev: 'cross-env NODE_ENV=x PORT=4402 next dev --turbo' },
    4402,
  ],
  ['an export before the chain', { dev: 'export PORT=4403 && next dev' }, 4403],
  [
    'a Windows set before the chain',
    { dev: 'set "PORT=4412" && next dev' },
    4412,
  ],
  ['a flag over the prefix', { dev: 'PORT=4404 next dev -p 4405' }, 4405],
  ['a quoted flag value', { dev: 'next dev -p "4413"' }, 4413],
  [
    'concurrently quoted commands',
    { dev: 'concurrently "next dev -p 4414" "tsc -w"' },
    4414,
  ],
  ['npx', { dev: 'npx next dev --port 4415' }, 4415],
  ['pnpm exec', { dev: 'pnpm exec next dev -p 4416' }, 4416],
  [
    'a script name that contains next',
    { dev: 'npm run dev:next', 'dev:next': 'next dev -p 4417' },
    4417,
  ],
  [
    'a script named next-dev',
    { dev: 'pnpm next-dev', 'next-dev': 'next dev -p 4418' },
    4418,
  ],
  [
    'a background separator',
    { dev: 'node api.js -p 5000 & next dev -p 4419' },
    4419,
  ],
  [
    'a background separator with an assignment before the other command',
    { dev: 'PORT=5000 node api.js & next dev -p 4420' },
    4420,
  ],
  ['a shell default', { dev: 'PORT=${PORT:-4421} next dev' }, 4421],
  ['npm run', { dev: 'npm run web', web: 'next dev -p 4406' }, 4406],
  ['pnpm run', { dev: 'pnpm run web', web: 'next dev -p 4407' }, 4407],
  ['pnpm name', { dev: 'pnpm web', web: 'PORT=4408 next dev' }, 4408],
  ['yarn name', { dev: 'yarn web', web: 'next dev --port=4409' }, 4409],
  ['bun run', { dev: 'bun run web', web: 'next dev -p 4422' }, 4422],
  [
    'arguments passed on',
    { dev: 'pnpm web -- -p 4410', web: 'next dev' },
    4410,
  ],
  [
    'an assignment before a delegation',
    { dev: 'PORT=4423 pnpm web', web: 'next dev' },
    4423,
  ],
  [
    'cross-env before a delegation',
    { dev: 'cross-env PORT=4424 npm run web', web: 'next dev' },
    4424,
  ],
  [
    'a delegated script that assigns its own',
    { dev: 'PORT=4425 pnpm web', web: 'PORT=4426 next dev' },
    4426,
  ],
] as const)
  test(`the dev script declares its port through ${name}`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.equal(declared.port, expected)
  })

// Value: protects=only `next dev` (or a bare `next`) counts, and an unrelated command's port is never taken (F430 L2); fails_when=`next build -p`, a helper script or another program's -p moves the app; why_new=OCR L2; seam=temporary project folders; no_claim=every runner syntax
for (const [name, scripts] of [
  ['next build', { dev: 'next build -p 4431 && next dev' }],
  [
    'a delegated helper that builds',
    { dev: 'pnpm gen && next dev', gen: 'next build -p 4432' },
  ],
  ['a program that is not next', { dev: 'node server.js -p 4433' }],
  [
    'a delegation two levels deep',
    { dev: 'npm run a', a: 'npm run b', b: 'next dev -p 4434' },
  ],
] as const)
  test(`${name} does not decide the port and the default is reported`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, { port: 3000, source: "Next's default port" })
  })

// Value: protects=applicationPortSource names the step that gave the port (D67); fails_when=a flag, an assignment or a delegation is reported as another step; why_new=D67 asks for the step in the source; seam=temporary project folders; no_claim=wording of the refusal
for (const [name, scripts, source] of [
  ['a flag', { dev: 'next dev -p 4441' }, 'the dev script in package.json'],
  [
    'an assignment',
    { dev: 'PORT=4442 next dev' },
    'a PORT assignment in the dev script in package.json',
  ],
  [
    'a delegated flag',
    { dev: 'pnpm web', web: 'next dev -p 4443' },
    'the "web" script that the dev script runs in package.json',
  ],
  [
    'an assignment before a delegation',
    { dev: 'PORT=4444 pnpm web', web: 'next dev' },
    'a PORT assignment in the "web" script that the dev script runs in package.json',
  ],
] as const)
  test(`the port source names ${name}`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.equal(declared.source, source)
  })

// Changed existing tests (D67, F431): the cases "a PORT in .env.development.local wins…" and "only the PORT line of an env file is used…" read PORT from .env files; Next reads PORT before it loads them, so they are replaced by this one.
// Value: protects=a PORT in the project's env files no longer moves the port (Next reads PORT from the command line and the process environment before it loads .env files); fails_when=an env file's PORT is used again and the app starts on a port the project's own `pnpm dev` never uses; why_new=D67/F431; seam=temporary project folders; no_claim=Next's own env loading
test('a PORT in the env files does not move the port', async () => {
  // Arrange
  const files = {
    'package.json': packageScripts({ dev: 'next dev' }),
    '.env': 'PORT=4451\n',
    '.env.local': 'PORT=4452\n',
    '.env.development.local': 'export PORT=4453\n',
  }

  // Act
  const declared = await declaredPortOf(files)

  // Assert
  assert.deepEqual(declared, { port: 3000, source: "Next's default port" })
})

test('a project without any declared port starts on Next default 3000', async () => {
  // Arrange
  const files = { 'package.json': devScript('next dev --turbo') }

  // Act
  const declared = await declaredPortOf(files)

  // Assert
  assert.deepEqual(declared, { port: 3000, source: "Next's default port" })
})

/** Starts a real listener on an OS-chosen port; `undefined` when the host lacks that address family. */
async function listenOn(host: string, port = 0) {
  const server = createServer()
  const failure = await new Promise<NodeJS.ErrnoException | undefined>(
    (resolve) => {
      server.once('error', resolve)
      server.listen({ host, port }, () => resolve(undefined))
    },
  )
  if (failure) return undefined
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return {
    port: address.port,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

// Value: protects=a busy project port refuses the start whichever loopback address the learner's own dev server listens on (D63, F411: a `::` or `::1` listener does not block a bind to 127.0.0.1); fails_when=the check passes while the port is in use, or the message omits the port, the origin reason or the recovery; why_new=the bind-only check missed `next dev -p 3165`'s wildcard listener; seam=real loopback listeners on OS-chosen ports; no_claim=the learner's actual dev server
for (const host of ['127.0.0.1', '::1', '::']) {
  test(`a dev server listening on ${host} refuses the start and names the port, the origin reason and the recovery`, async (context) => {
    // Arrange
    const occupant = await listenOn(host)
    if (!occupant) return context.skip(`${host} is not available on this host`)
    try {
      // Act
      const refusal = await assertDevelopmentPortFree({
        port: occupant.port,
        source: 'the dev script in package.json',
      }).then(
        () => undefined,
        (error: unknown) => error,
      )

      // Assert
      assert.ok(refusal instanceof StudyError)
      assert.equal(refusal.code, 'PREREQUISITE_MISSING')
      assert.equal(
        refusal.message,
        `Port ${occupant.port} is in use on this machine, and the project declares it (the dev script in package.json): the app's own origin, such as AUTH_URL, points there, so Codebook never starts it on another port. Ask the learner to stop the process that listens on port ${occupant.port} (often their own dev server), then start again.`,
      )
    } finally {
      await occupant.close()
    }
  })
}

test('a free project port passes the start check', async () => {
  // Arrange
  const probe = createServer()
  await new Promise<void>((resolve) =>
    probe.listen({ host: '127.0.0.1', port: 0 }, resolve),
  )
  const address = probe.address()
  assert.ok(address && typeof address === 'object')
  const { port } = address
  await new Promise((resolve) => probe.close(resolve))

  // Act
  const outcome = await assertDevelopmentPortFree({ port, source: 'test' })

  // Assert
  assert.equal(outcome, undefined)
})

/** A connect that never answers: it only reports the idle timeout, as a loopback connect does while Windows retries its SYN. */
const silentConnect: ConnectLoopback = () => {
  const socket = new EventEmitter() as unknown as Socket
  Object.assign(socket, {
    setTimeout: () => {
      setImmediate(() => socket.emit('timeout'))
      return socket
    },
    destroy: () => socket,
  })
  return socket
}

/** Returns a port nothing listens on right now. */
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

// Value: protects=a free port is not refused as in use when the loopback connect only times out (F414: Windows reports a refused loopback connect after 1 to 2 s); fails_when=a timed-out connect counts as a listener; why_new=OCR M1; seam=an injected connect that never answers plus the real bind probe on a free OS-chosen port; no_claim=a Windows run
test('a free port passes the start check when the loopback connect only times out', async () => {
  // Arrange
  const port = await freePort()

  // Act
  const outcome = await assertDevelopmentPortFree(
    { port, source: 'test' },
    { connect: silentConnect },
  )

  // Assert
  assert.equal(outcome, undefined)
})

// Value: protects=a timed-out connect does not hide a port that the bind probe finds taken; fails_when=the timeout makes a busy port look free; why_new=F414 fix relies on the bind probe; seam=injected silent connect plus a real listener on 127.0.0.1; no_claim=wildcard listeners (the connect tests above)
test('a port held on 127.0.0.1 is still refused when the loopback connect only times out', async () => {
  // Arrange
  const occupant = await listenOn('127.0.0.1')
  assert.ok(occupant)
  try {
    // Act
    const refusal = await assertDevelopmentPortFree(
      { port: occupant.port, source: 'test' },
      { connect: silentConnect },
    ).then(
      () => undefined,
      (error: unknown) => error,
    )

    // Assert
    assert.ok(refusal instanceof StudyError)
    assert.match(refusal.message, /^Port \d+ is in use on this machine/)
  } finally {
    await occupant.close()
  }
})

// Value: protects=a port the system does not let Codebook listen on is refused as not permitted, not as in use (F422); fails_when=EACCES is worded as another process's listener or passes; why_new=OCR L3; seam=an injected bind that fails with EACCES; no_claim=a real privileged port (platform-dependent)
test('a port the system refuses to let Codebook listen on is refused as not permitted', async () => {
  // Arrange
  const port = await freePort()
  const bind = async () =>
    Object.assign(new Error('listen EACCES'), { code: 'EACCES' })

  // Act
  const refusal = await assertDevelopmentPortFree(
    { port, source: 'the dev script in package.json' },
    { connect: silentConnect, bind },
  ).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.ok(refusal instanceof StudyError)
  assert.equal(refusal.code, 'PREREQUISITE_MISSING')
  assert.equal(
    refusal.message,
    `Port ${port} is not permitted for Codebook on this machine (the operating system refuses to let this program listen on it, as for a port below 1024 without administrator rights or a port range the system reserves), and the project declares it (the dev script in package.json): the app's own origin, such as AUTH_URL, points there, so Codebook never starts it on another port. Ask the learner to declare a port from 1024 up for the project (the -p/--port of next dev or a PORT= in the dev script), or to allow listening on port ${port}, then start again.`,
  )
})

// Value: protects=a port that Codebook's own stopping run releases within the wait does not fail the next start (F422); fails_when=the check refuses at once or blames the learner; why_new=OCR L3; seam=a real listener closed after 150 ms and the recorded owned port; no_claim=the real process-group exit
test('a port that Codebook own stopping run releases within the wait passes the start check', async () => {
  // Arrange
  const occupant = await listenOn('127.0.0.1')
  assert.ok(occupant)
  const claim = claimOwnedDevelopmentPort(occupant.port)
  beginReleaseOfOwnedDevelopmentPort(claim)
  setTimeout(() => void occupant.close(), 150)
  try {
    // Act
    const outcome = await assertDevelopmentPortFree(
      { port: occupant.port, source: 'test' },
      { releaseWaitMs: 3000 },
    )

    // Assert
    assert.equal(outcome, undefined)
  } finally {
    releaseOwnedDevelopmentPort(claim)
  }
})

// Value: protects=a port that Codebook's own run keeps holding is named as that run's, never as the learner's dev server (F422); fails_when=the refusal tells the learner to stop their own dev server; why_new=OCR L3; seam=a real listener plus the recorded owned port; no_claim=the real run
for (const [state, wording] of [
  ['running', 'that is still running'],
  ['stopping', 'that has not finished stopping'],
] as const)
  test(`a port held by Codebook own ${state} run is refused naming that run`, async () => {
    // Arrange
    const occupant = await listenOn('127.0.0.1')
    assert.ok(occupant)
    const claim = claimOwnedDevelopmentPort(occupant.port)
    if (state === 'stopping') beginReleaseOfOwnedDevelopmentPort(claim)
    try {
      // Act
      const refusal = await assertDevelopmentPortFree(
        { port: occupant.port, source: 'test' },
        { releaseWaitMs: 200 },
      ).then(
        () => undefined,
        (error: unknown) => error,
      )

      // Assert
      assert.ok(refusal instanceof StudyError)
      assert.equal(
        refusal.message,
        `Port ${occupant.port} is still held by an earlier Codebook repository-browser run ${wording}, and the project declares it (test): the app's own origin, such as AUTH_URL, points there, so Codebook never starts it on another port. Stop that run (codebook_stop) and wait for it to finish stopping, then start again.`,
      )
    } finally {
      releaseOwnedDevelopmentPort(claim)
      await occupant.close()
    }
  })

/** A connect that fails at once with the given system error code, as a sandbox or firewall does (EPERM) or a stack that gives up (ETIMEDOUT). */
function failingConnect(code: string): ConnectLoopback {
  return () => {
    const socket = new EventEmitter() as unknown as Socket
    Object.assign(socket, {
      setTimeout: () => {
        setImmediate(() =>
          socket.emit('error', Object.assign(new Error(code), { code })),
        )
        return socket
      },
      destroy: () => socket,
    })
    return socket
  }
}

// Value: protects=an unexpected connect error leaves the decision to the bind probe instead of aborting the start with a raw error (F432); fails_when=EPERM, ETIMEDOUT or ECONNRESET rejects a free port, or hides a port the bind refuses; why_new=OCR L4; seam=an injected failing connect plus the real bind probe; no_claim=a sandbox that forbids loopback connects
for (const code of ['EPERM', 'ETIMEDOUT', 'ECONNRESET']) {
  test(`a free port passes the start check when the loopback connect fails with ${code}`, async () => {
    // Arrange
    const port = await freePort()

    // Act
    const outcome = await assertDevelopmentPortFree(
      { port, source: 'test' },
      { connect: failingConnect(code) },
    )

    // Assert
    assert.equal(outcome, undefined)
  })
}

test('a port held on 127.0.0.1 is still refused when the loopback connect fails with EPERM', async () => {
  // Arrange
  const occupant = await listenOn('127.0.0.1')
  assert.ok(occupant)
  try {
    // Act
    const refusal = await assertDevelopmentPortFree(
      { port: occupant.port, source: 'test' },
      { connect: failingConnect('EPERM') },
    ).then(
      () => undefined,
      (error: unknown) => error,
    )

    // Assert
    assert.ok(refusal instanceof StudyError)
    assert.match(refusal.message, /^Port \d+ is in use on this machine/)
  } finally {
    await occupant.close()
  }
})

// Value: protects=a start waits for another run's release even when the port already looks free, so its listener never meets the old run's endpoint check (F429); fails_when=the free-port early return skips the wait; why_new=OCR M1 of the review of e638c1b..7139a69e; seam=two claims of the registry and a free OS-chosen port; no_claim=the real process-group exit
test('a free port is not passed while another run is still releasing it', async () => {
  // Arrange
  const port = await freePort()
  const earlierRun = claimOwnedDevelopmentPort(port)
  beginReleaseOfOwnedDevelopmentPort(earlierRun)
  let released = false
  setTimeout(() => {
    released = true
    releaseOwnedDevelopmentPort(earlierRun)
  }, 150)

  // Act
  await assertDevelopmentPortFree(
    { port, source: 'test' },
    { releaseWaitMs: 3000 },
  )

  // Assert
  assert.equal(released, true)
})

// Value: protects=a claim that never releases does not block a free port for ever (F429 bound); fails_when=the wait throws or exceeds its bound when the port is free; why_new=a failed close leaves its claim stopping; seam=a stuck claim and a free port; no_claim=the claim's later retry
test('a free port passes after the wait when the earlier run never reports its release', async () => {
  // Arrange
  const port = await freePort()
  const stuck = claimOwnedDevelopmentPort(port)
  beginReleaseOfOwnedDevelopmentPort(stuck)

  try {
    // Act
    const outcome = await assertDevelopmentPortFree(
      { port, source: 'test' },
      { releaseWaitMs: 200 },
    )

    // Assert
    assert.equal(outcome, undefined)
  } finally {
    releaseOwnedDevelopmentPort(stuck)
  }
})

// Value: protects=one run's release deletes only its own claim (F429); fails_when=run A's release removes run B's running claim and the next refusal blames the learner; why_new=OCR M1; seam=the registry with two claims on one port; no_claim=the launcher's wiring
test("releasing one run's claim keeps the other run's claim on the same port", () => {
  // Arrange
  const runA = claimOwnedDevelopmentPort(54001)
  const runB = claimOwnedDevelopmentPort(54001)

  // Act
  releaseOwnedDevelopmentPort(runA)

  // Assert
  assert.equal(ownedDevelopmentPortState(54001), 'running')
  releaseOwnedDevelopmentPort(runB)
  assert.equal(ownedDevelopmentPortState(54001), undefined)
})

// Value: protects=a cancelled run does not wait out the release bound (F432); fails_when=the abort is ignored or swallowed and the cancel takes the full wait; why_new=OCR L5; seam=a stuck claim and an abort after 50 ms; no_claim=the run's own cancellation path
test('cancelling during the wait for a stopping run ends the start check at once', async () => {
  // Arrange
  const port = await freePort()
  const stuck = claimOwnedDevelopmentPort(port)
  beginReleaseOfOwnedDevelopmentPort(stuck)
  const controller = new AbortController()
  setTimeout(() => controller.abort(new Error('Run cancelled')), 50)
  const startedAt = performance.now()

  try {
    // Act
    const failure = await assertDevelopmentPortFree(
      { port, source: 'test' },
      { releaseWaitMs: 5000, signal: controller.signal },
    ).then(
      () => undefined,
      (error: unknown) => error,
    )

    // Assert
    assert.equal(String(failure), 'Error: Run cancelled')
    assert.ok(performance.now() - startedAt < 2000)
  } finally {
    releaseOwnedDevelopmentPort(stuck)
  }
})

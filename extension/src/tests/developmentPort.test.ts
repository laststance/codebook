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

// Value: protects=the dev script's port beats an env PORT, and the env files follow Next's precedence; fails_when=a lower file or the env wins over the script or a higher file; why_new=D63's order; seam=temporary project folders; no_claim=Next's own PORT handling
test('the dev script port wins over a PORT in the env files', async () => {
  // Arrange
  const files = {
    'package.json': devScript('next dev -p 3165'),
    '.env.local': 'PORT=4000\n',
  }

  // Act
  const declared = await declaredPortOf(files)

  // Assert
  assert.equal(declared.port, 3165)
})

test('a PORT in .env.development.local wins over .env.local, .env.development and .env', async () => {
  // Arrange
  const files = {
    'package.json': devScript('next dev'),
    '.env': 'PORT=4001\n',
    '.env.development': 'PORT=4002\n',
    '.env.local': 'PORT=4003\n',
    '.env.development.local': 'export PORT="4004" # local\n',
  }

  // Act
  const declared = await declaredPortOf(files)

  // Assert
  assert.deepEqual(declared, {
    port: 4004,
    source: 'PORT in .env.development.local',
  })
})

// Changed existing test (F420): Next keeps the first file's PORT even when it expands to nothing, so a later file no longer rescues it; the old test assumed a heuristic skip.
test('only the PORT line of an env file is used and a PORT that expands to nothing declares no port', async () => {
  // Arrange
  const files = {
    '.env.local': 'AUTH_SECRET=PORT=9999\nPORT=$OTHER\n',
    '.env': 'SECRET=abc\nPORT=4005\n',
  }

  // Act
  const declared = await declaredPortOf(files)

  // Assert
  assert.deepEqual(declared, { port: 3000, source: "Next's default port" })
})

test('a PORT line among other variables is read without the others', async () => {
  // Arrange
  const files = { '.env': 'SECRET=abc\nAUTH_SECRET=PORT=9999\nPORT=4005\n' }

  // Act
  const declared = await declaredPortOf(files)

  // Assert
  assert.deepEqual(declared, { port: 4005, source: 'PORT in .env' })
})

// Value: protects=the port follows Next's dotenv grammar (F419); fails_when=the first duplicate, an inline comment without a space, or a colon form changes the port from the one Next uses; why_new=OCR L1 of the review of 073f6ae..e638c1b; seam=temporary project folders; no_claim=Next itself loading the file
for (const [name, text, port] of [
  [
    'a later duplicate PORT in the same file wins',
    'PORT=4101\nPORT=4102\n',
    4102,
  ],
  [
    'an inline comment without a space ends the value',
    'PORT=4103#note\n',
    4103,
  ],
  ['the colon form PORT: 4104 declares the port', 'PORT: 4104\n', 4104],
  ['a CRLF file declares its port', 'PORT=4105\r\n', 4105],
] as const)
  test(`in an env file ${name}`, async () => {
    // Arrange
    const files = { '.env': text }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, { port, source: 'PORT in .env' })
  })

// Value: protects=$VAR references in PORT expand as Next's dotenv-expand does (F420), across the files in Next's precedence; fails_when=a reference stays unexpanded, a lower file's variable is seen by a higher file, or the fallback is ignored; why_new=CodeRabbit finding on PORT=$APP_PORT; seam=temporary project folders; no_claim=Next itself loading the files
for (const [name, files, expected] of [
  [
    'a $VAR of the same file',
    { '.env': 'APP_PORT=4201\nPORT=$APP_PORT\n' },
    { port: 4201, source: 'PORT in .env' },
  ],
  [
    'a ${VAR} of the same file',
    { '.env': 'PORT=${APP_PORT}\nAPP_PORT=4202\n' },
    { port: 4202, source: 'PORT in .env' },
  ],
  [
    'a variable of a higher-precedence file',
    { '.env.local': 'APP_PORT=4203\n', '.env': 'PORT=${APP_PORT}\n' },
    { port: 4203, source: 'PORT in .env' },
  ],
  [
    'a fallback when the variable is unset',
    { '.env': 'PORT=${APP_PORT:-4204}\n' },
    { port: 4204, source: 'PORT in .env' },
  ],
  [
    'a variable only a lower-precedence file sets (Next sees it empty)',
    { '.env.local': 'PORT=$APP_PORT\n', '.env': 'APP_PORT=4205\n' },
    { port: 3000, source: "Next's default port" },
  ],
  [
    'a self-reference that never settles',
    { '.env': 'PORT=$PORT\n' },
    { port: 3000, source: "Next's default port" },
  ],
] as const)
  test(`PORT expands ${name}`, async () => {
    // Arrange / Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, expected)
  })

// Value: protects=a variable of the extension host that the owned server never inherits is not used to pick the port (F420 decision: Next expands against its own environment, the allow-list); fails_when=process.env leaks into the expansion; why_new=the child env is an allow-list; seam=a process variable set for the test; no_claim=other variables staying secret in the owned process (launch tests)
test('PORT does not expand from a host variable the owned server does not inherit', async () => {
  // Arrange
  process.env.CODEBOOK_TEST_NOT_INHERITED_PORT = '4300'
  try {
    // Act
    const declared = await declaredPortOf({
      '.env': 'PORT=$CODEBOOK_TEST_NOT_INHERITED_PORT\n',
    })

    // Assert
    assert.deepEqual(declared, { port: 3000, source: "Next's default port" })
  } finally {
    delete process.env.CODEBOOK_TEST_NOT_INHERITED_PORT
  }
})

/** A package.json with the given scripts. */
const packageScripts = (scripts: Record<string, string>): string =>
  JSON.stringify({ scripts })

// Value: protects=the dev script's own port is found through an env prefix and through one delegating script (F421); fails_when=the prefix or the delegation is ignored and the app moves to another port; why_new=OCR L2; seam=temporary project folders; no_claim=Next honoring PORT itself
for (const [name, scripts, port] of [
  ['an env prefix', { dev: 'PORT=4401 next dev' }, 4401],
  [
    'cross-env',
    { dev: 'cross-env NODE_ENV=x PORT=4402 next dev --turbo' },
    4402,
  ],
  ['an export before the chain', { dev: 'export PORT=4403 && next dev' }, 4403],
  ['a flag over the prefix', { dev: 'PORT=4404 next dev -p 4405' }, 4405],
  ['npm run', { dev: 'npm run web', web: 'next dev -p 4406' }, 4406],
  ['pnpm run', { dev: 'pnpm run web', web: 'next dev -p 4407' }, 4407],
  ['pnpm name', { dev: 'pnpm web', web: 'PORT=4408 next dev' }, 4408],
  ['yarn name', { dev: 'yarn web', web: 'next dev --port=4409' }, 4409],
  [
    'arguments passed on',
    { dev: 'pnpm web -- -p 4410', web: 'next dev' },
    4410,
  ],
] as const)
  test(`the dev script declares its port through ${name}`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.equal(declared.port, port)
  })

// Value: protects=a delegation is followed one level and an unreadable script falls back to the stated default (F421); fails_when=a second hop or a missing script is invented into a port; why_new=OCR L2 bound; seam=temporary project folders; no_claim=every runner syntax
test('a delegation two levels deep is not followed and the default is reported with its source', async () => {
  // Arrange
  const files = {
    'package.json': packageScripts({
      dev: 'npm run a',
      a: 'npm run b',
      b: 'next dev -p 4411',
    }),
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
    `Port ${port} is not permitted for Codebook on this machine (the operating system refuses to let this program listen on it, as for a port below 1024 without administrator rights or a port range the system reserves), and the project declares it (the dev script in package.json): the app's own origin, such as AUTH_URL, points there, so Codebook never starts it on another port. Ask the learner to declare a port from 1024 up for the project (the dev script's -p/--port or PORT in an env file), or to allow listening on port ${port}, then start again.`,
  )
})

// Value: protects=a port that Codebook's own stopping run releases within the wait does not fail the next start (F422); fails_when=the check refuses at once or blames the learner; why_new=OCR L3; seam=a real listener closed after 150 ms and the recorded owned port; no_claim=the real process-group exit
test('a port that Codebook own stopping run releases within the wait passes the start check', async () => {
  // Arrange
  const occupant = await listenOn('127.0.0.1')
  assert.ok(occupant)
  claimOwnedDevelopmentPort(occupant.port)
  beginReleaseOfOwnedDevelopmentPort(occupant.port)
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
    releaseOwnedDevelopmentPort(occupant.port)
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
    claimOwnedDevelopmentPort(occupant.port)
    if (state === 'stopping') beginReleaseOfOwnedDevelopmentPort(occupant.port)
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
      releaseOwnedDevelopmentPort(occupant.port)
      await occupant.close()
    }
  })

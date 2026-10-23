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
    'a delegation three levels deep',
    {
      dev: 'npm run a',
      a: 'npm run b',
      b: 'npm run c',
      c: 'next dev -p 4434',
    },
  ],
] as const)
  test(`${name} does not decide the port and the default is reported`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.equal(declared.port, 3000)
    assert.match(declared.source, /^Next's default port/)
  })

/** What `applicationPortSource` starts with when the dev script has a form the reader does not read (D68). */
const UNREAD_SOURCE = (segment: string): string =>
  `Next's default port, taken because the dev script has a form Codebook does not read: "${segment}"`

// Value: protects=each form D68 lists is read, so the app starts on the port the project's own dev script uses (F451); fails_when=a form falls back silently to 3000 while the script declares another port; why_new=OCR medium of the review of 944a4d25..6bc9eab2, reproduced for each form; seam=temporary project folders; no_claim=that the shell or Next accepts each form
for (const [name, scripts, expected] of [
  [
    'cmd /c with a set before &&',
    { dev: 'cmd /c "set PORT=4101&& next dev"' },
    {
      port: 4101,
      source: 'a PORT assignment in the dev script in package.json',
    },
  ],
  [
    'cmd.exe with its own flags',
    { dev: 'cmd.exe /d /s /c "next dev -p 4102"' },
    { port: 4102, source: 'the dev script in package.json' },
  ],
  [
    'a next.cmd launcher',
    { dev: 'next.cmd dev -p 4103' },
    { port: 4103, source: 'the dev script in package.json' },
  ],
  [
    'a Windows path to next.cmd',
    { dev: 'node_modules\\.bin\\next.cmd dev -p 4104' },
    { port: 4104, source: 'the dev script in package.json' },
  ],
  [
    'cross-env-shell',
    { dev: 'cross-env-shell "PORT=4105 next dev"' },
    {
      port: 4105,
      source: 'a PORT assignment in the dev script in package.json',
    },
  ],
  [
    'sh -c',
    { dev: "sh -c 'next dev -p 4106'" },
    { port: 4106, source: 'the dev script in package.json' },
  ],
  [
    'bash -c with an assignment',
    { dev: 'bash -c "PORT=4107 next dev"' },
    {
      port: 4107,
      source: 'a PORT assignment in the dev script in package.json',
    },
  ],
  [
    'dotenv before --',
    { dev: 'dotenv -e .env -- next dev -p 4108' },
    { port: 4108, source: 'the dev script in package.json' },
  ],
  [
    'env -u with an assignment',
    { dev: 'env -u X PORT=4109 next dev' },
    {
      port: 4109,
      source: 'a PORT assignment in the dev script in package.json',
    },
  ],
  [
    'node with its own flags and a path to next',
    { dev: 'node --inspect node_modules/.bin/next dev -p 4110' },
    { port: 4110, source: 'the dev script in package.json' },
  ],
  [
    'node with a flag that takes a value',
    {
      dev: 'node --require ./setup.js node_modules/next/dist/bin/next dev -p 4111',
    },
    { port: 4111, source: 'the dev script in package.json' },
  ],
  [
    'yarn next',
    { dev: 'yarn next dev -p 4112' },
    { port: 4112, source: 'the dev script in package.json' },
  ],
  [
    'pnpm next',
    { dev: 'pnpm next dev -p 4113' },
    { port: 4113, source: 'the dev script in package.json' },
  ],
  [
    'bunx next',
    { dev: 'bunx next dev -p 4114' },
    { port: 4114, source: 'the dev script in package.json' },
  ],
  [
    'npm exec --',
    { dev: 'npm exec -- next dev -p 4123' },
    { port: 4123, source: 'the dev script in package.json' },
  ],
  [
    'dotenvx run',
    { dev: 'dotenvx run -- next dev -p 4122' },
    { port: 4122, source: 'the dev script in package.json' },
  ],
  [
    'bun naming a script',
    { dev: 'bun web', web: 'next dev -p 4116' },
    {
      port: 4116,
      source: 'the "web" script that the dev script runs in package.json',
    },
  ],
  [
    'concurrently npm:<script>',
    { dev: 'concurrently npm:dev:web', 'dev:web': 'next dev -p 4117' },
    {
      port: 4117,
      source: 'the "dev:web" script that the dev script runs in package.json',
    },
  ],
  [
    'concurrently pnpm:<script> after another command',
    {
      dev: 'concurrently "tsc -w" pnpm:web',
      web: 'next dev -p 4124',
    },
    {
      port: 4124,
      source: 'the "web" script that the dev script runs in package.json',
    },
  ],
  [
    'a concurrently wildcard that names exactly one script',
    {
      dev: 'concurrently npm:dev:*',
      'dev:web': 'next dev -p 4118',
      lint: 'eslint .',
    },
    {
      port: 4118,
      source: 'the "dev:web" script that the dev script runs in package.json',
    },
  ],
  [
    'a delegation through two scripts',
    { dev: 'npm run a', a: 'npm run b', b: 'next dev -p 4119' },
    {
      port: 4119,
      source: 'the "b" script that the dev script runs in package.json',
    },
  ],
  [
    'a shell default in the port flag',
    { dev: 'next dev -p ${PORT:-4120}' },
    { port: 4120, source: 'the dev script in package.json' },
  ],
  [
    'a quoted shell default in the port flag',
    { dev: 'next dev --port "${PORT:-4121}"' },
    { port: 4121, source: 'the dev script in package.json' },
  ],
  [
    'a subshell followed by the real command',
    { dev: '(echo starting) && next dev -p 4130' },
    { port: 4130, source: 'the dev script in package.json' },
  ],
] as const)
  test(`the dev script form ${name} declares its port`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, expected)
  })

// Value: protects=a dev script segment the reader cannot interpret is told in the port source instead of silently taking 3000 (D68); fails_when=the source says only "Next's default port" for a subshell, an unknown wrapper or an unresolvable variable, or quotes a secret value; why_new=F451; seam=temporary project folders; no_claim=that the learner's script runs on 3000
for (const [name, scripts, segment] of [
  ['a subshell', { dev: '(cd app && next dev -p 4000)' }, '( cd app'],
  [
    'an unknown wrapper',
    { dev: 'turbo-run next dev -p 4000' },
    'turbo-run next dev -p 4000',
  ],
  [
    'a port flag with a variable it cannot resolve',
    { dev: 'next dev -p $APP_PORT' },
    'next dev -p $APP_PORT',
  ],
  [
    'a PORT assignment with a variable it cannot resolve',
    { dev: 'PORT=$APP_PORT next dev' },
    'PORT=$APP_PORT next dev',
  ],
  [
    'a secret assignment before an unknown wrapper',
    { dev: 'API_KEY=secret123 turbo-run next dev' },
    'API_KEY=… turbo-run next dev',
  ],
  [
    'a concurrently wildcard that names two scripts',
    {
      dev: 'concurrently npm:dev:*',
      'dev:web': 'next dev -p 4000',
      'dev:api': 'node api.js',
    },
    'npm:dev:*',
  ],
  ['a delegation cycle', { dev: 'npm run dev' }, 'npm run dev'],
  [
    'a delegation deeper than the nesting limit',
    {
      dev: 'npm run a',
      a: 'npm run b',
      b: 'npm run c',
      c: 'next dev -p 4000',
    },
    'npm run c',
  ],
  [
    'a terminal control sequence in the segment',
    { dev: 'turbo-run \u001b[31m next dev -p 4000' },
    'turbo-run  next dev -p 4000',
  ],
] as const)
  test(`${name} makes the port source say Next's default was taken for a form Codebook does not read`, async () => {
    // Arrange
    const files = { 'package.json': packageScripts(scripts) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, { port: 3000, source: UNREAD_SOURCE(segment) })
  })

test('a long unread segment is cut to 120 characters in the port source', async () => {
  // Arrange
  const files = {
    'package.json': packageScripts({
      dev: `turbo-run next dev ${'x'.repeat(300)}`,
    }),
  }

  // Act
  const declared = await declaredPortOf(files)

  // Assert
  const quoted = declared.source.slice(declared.source.indexOf('"') + 1, -1)
  assert.equal(Array.from(quoted).length, 120)
  assert.ok(quoted.endsWith('… [cut]'))
})

// Value: protects=a delegation chain exactly at the nesting limit is read and one step further is told as unread (F458); fails_when=the limit is checked only for concurrently, so a delegation loop is followed too deep or stops one level early; why_new=CodeRabbit CLI trivial of the review of 944a4d25..6bc9eab2; seam=temporary project folders; no_claim=other depths
test('a delegation chain of exactly the nesting limit is read', async () => {
  // Arrange
  const files = {
    'package.json': packageScripts({
      dev: 'pnpm a',
      a: 'pnpm b',
      b: 'PORT=4132 next dev',
    }),
  }

  // Act
  const declared = await declaredPortOf(files)

  // Assert
  assert.deepEqual(declared, {
    port: 4132,
    source:
      'a PORT assignment in the "b" script that the dev script runs in package.json',
  })
})

// Value: protects=the last -p/--port wins, as in Next's own parser (F452); fails_when=the first value is taken and the app starts on a port its own `next dev` would not use; why_new=OCR low of the review of 944a4d25..6bc9eab2 (`next dev -p 4000 -p 5000` runs on 5000); seam=temporary project folders; no_claim=Next's parser
for (const [script, port] of [
  ['next dev -p 4140 -p 4141', 4141],
  ['next dev --port 4142 -p=4143', 4143],
  ['next dev -p 4144 --port=4145 --turbo', 4145],
] as const)
  test(`the dev script "${script}" declares the last port ${port}`, async () => {
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

// Value: protects=an unquoted # at the start of a word is a shell comment, so a port written after it is not the app's (F450); fails_when=`next dev # -p 4000` reads 4000 while the shell runs 3000; why_new=OCR medium of the review of 944a4d25..6bc9eab2, reproduced; seam=temporary project folders; no_claim=quoted or mid-word # (kept as text)
for (const [name, script, expected] of [
  [
    'a comment after the command',
    'next dev # -p 4000',
    { port: 3000, source: "Next's default port" },
  ],
  [
    'a comment after the port',
    'next dev -p 4150 # -p 5000',
    { port: 4150, source: 'the dev script in package.json' },
  ],
  [
    'a comment that holds a separator',
    'next dev -p 4151 # && next dev -p 5000',
    { port: 4151, source: 'the dev script in package.json' },
  ],
  [
    'a quoted hash',
    'next dev -p 4152 "#" -p 4153',
    { port: 4153, source: 'the dev script in package.json' },
  ],
  [
    'a hash inside a word',
    'next dev -p 4154#x',
    { port: 3000, source: "Next's default port" },
  ],
] as const)
  test(`${name} is read as the shell reads it`, async () => {
    // Arrange
    const files = { 'package.json': devScript(script) }

    // Act
    const declared = await declaredPortOf(files)

    // Assert
    assert.deepEqual(declared, expected)
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

// Value: protects=a start is refused while another run has claimed the port but its server has not bound yet, even when this start's probe reads the port free (F449); fails_when=two parallel starts both pass and launch on one port; why_new=OCR medium of the review of 944a4d25..6bc9eab2; seam=two parallel checks on one free OS-chosen port, run B's bind probe held until run A has claimed; no_claim=the real launch
test('a parallel start is refused once the other run claimed the port, although the probe reads it free', async () => {
  // Arrange
  const port = await freePort()
  let runAClaim: ReturnType<typeof claimOwnedDevelopmentPort> | undefined
  let openGate: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    openGate = resolve
  })
  const bindForB = async () => {
    await gate
    return undefined
  }
  const runB = assertDevelopmentPortFree(
    { port, source: 'test' },
    { connect: silentConnect, bind: bindForB },
  ).then(
    () => undefined,
    (error: unknown) => error,
  )

  try {
    // Act
    await assertDevelopmentPortFree(
      { port, source: 'test' },
      { connect: silentConnect },
    )
    runAClaim = claimOwnedDevelopmentPort(port)
    openGate()
    const refusal = await runB

    // Assert
    assert.ok(refusal instanceof StudyError)
    assert.equal(
      refusal.message,
      `Port ${port} is still held by an earlier Codebook repository-browser run that is still running, and the project declares it (test): the app's own origin, such as AUTH_URL, points there, so Codebook never starts it on another port. Stop that run (codebook_stop) and wait for it to finish stopping, then start again.`,
    )
  } finally {
    if (runAClaim) releaseOwnedDevelopmentPort(runAClaim)
  }
})

// Value: protects=a cancel during the probe's own connect ends the start check at once instead of after the pending connect (F456); fails_when=the abort is honored only after the connect times out and the check goes on; why_new=OCR low of the review of 944a4d25..6bc9eab2; seam=an injected connect that answers only after 400 ms and an abort after 30 ms; no_claim=a real network connect
test('cancelling while the probe waits for a connect ends the start check at once', async () => {
  // Arrange
  const port = await freePort()
  const controller = new AbortController()
  let connects = 0
  let destroyed = false
  const slowConnect: ConnectLoopback = () => {
    connects += 1
    const socket = new EventEmitter() as unknown as Socket
    const timer = setTimeout(() => socket.emit('timeout'), 400)
    Object.assign(socket, {
      setTimeout: () => socket,
      destroy: () => {
        destroyed = true
        clearTimeout(timer)
        return socket
      },
    })
    return socket
  }
  setTimeout(() => controller.abort(new Error('Run cancelled')), 30)

  // Act
  const failure = await assertDevelopmentPortFree(
    { port, source: 'test' },
    { connect: slowConnect, signal: controller.signal },
  ).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(String(failure), 'Error: Run cancelled')
  assert.equal(connects, 1)
  assert.equal(destroyed, true)
})

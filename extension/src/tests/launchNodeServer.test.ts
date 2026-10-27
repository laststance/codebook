import assert from 'node:assert/strict'
import { once } from 'node:events'
import { copyFile, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { get } from 'node:http'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { z } from 'zod'

import { Cdp } from '../runtimeSupport/cdp'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { ProcessOutputEvent } from '../utils/captureProcessOutput'
import type { LaunchedGroupVerdict } from '../utils/confirmLaunchedGroup'
import { isProcessGroupGone } from '../utils/isProcessGroupGone'
import { launchNodeServer } from '../utils/launchNodeServer'
import { resolveNodeServerLaunch } from '../utils/resolveNodeServerLaunch'
import { signalProcessGroup } from '../utils/signalProcessGroup'

/** The test-only HTTP server as compiled beside this test; it never ships. */
const FIXTURE_SERVER = join(__dirname, 'fixtures/node-server/server.js')

/** The start journal entry's facts as the launcher records them. */
const startedDetailSchema = z.looseObject({
  inheritedVariables: z.array(z.string()),
})

/** A loopback port that was free a moment ago, for the fixture server to listen on. */
async function freePort(): Promise<number> {
  const probe = createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const address = probe.address()
  assert.ok(address && typeof address !== 'string')
  probe.close()
  await once(probe, 'close')
  return address.port
}

/** Copies the fixture server into a new repository folder with its own settings file, as a repository's server reads its `.env`. */
async function fixtureRepository(
  t: { after: (cleanup: () => Promise<void>) => void },
  settings: { port: number; host: string; mode?: string },
): Promise<string> {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-node-server-')),
  )
  t.after(() => rm(workspace, { recursive: true, force: true }))
  await copyFile(FIXTURE_SERVER, join(workspace, 'server.cjs'))
  await writeFile(
    join(workspace, 'fixture-server.json'),
    JSON.stringify({ mode: 'listen', ...settings }),
  )
  return workspace
}

/** Says whether something accepts connections on a loopback port now. */
async function accepts(port: number): Promise<boolean> {
  const socket = connect({ host: '127.0.0.1', port })
  return new Promise((resolve) => {
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/** Sends one GET on loopback and reads its status and body. */
async function getText(
  port: number,
  path: string,
): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port, path, agent: false }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => (body += chunk))
      response.on('end', () => resolve({ status: response.statusCode, body }))
    }).once('error', reject)
  })
}

test('an owned server announces its loopback inspector, answers after release and closes its group with the port free', async (t) => {
  // protects: the launcher loop (announced port, release, readiness, a GET, close); fails_when: any step fails or the port stays held; no_claim: pwa-node's attach (ladder level 3).
  // Arrange
  const port = await freePort()
  const workspace = await fixtureRepository(t, { port, host: '127.0.0.1' })
  const launch = await resolveNodeServerLaunch(workspace, {
    packageRoot: '.',
    entry: 'server.cjs',
    loader: 'node',
  })
  const journal: { type: string; detail: unknown }[] = []
  const server = await launchNodeServer(
    {
      ...launch,
      workspace,
      node: { executable: process.execPath, version: process.versions.node },
    },
    (type, detail) => journal.push({ type, detail }),
  )
  let inspector: Cdp | undefined
  try {
    // Act
    const endpoint = await server.inspectorEndpoint(AbortSignal.timeout(10_000))
    inspector = await Cdp.connect(endpoint, () => undefined)
    await inspector.request('Runtime.runIfWaitingForDebugger', undefined)
    await waitUntil(
      async () => ((await accepts(port)) ? true : undefined),
      'fixture readiness',
      10_000,
    )
    const health = await getText(port, '/health')
    const connected = inspector
    const exit = await server.close(async () => connected.close())
    // Assert
    assert.match(endpoint, /^ws:\/\/127\.0\.0\.1:[1-9]\d*\/[a-f\d-]{36}$/)
    assert.deepEqual(health, { status: 200, body: '{"status":"ok"}' })
    assert.deepEqual(exit, { exitCode: 0, signal: null })
    assert.equal(isProcessGroupGone(server.processGroup!), true)
    assert.equal(await accepts(port), false)
    assert.equal(journal[0]?.type, 'node-server.started')
    const { inheritedVariables, ...startFacts } = startedDetailSchema.parse(
      journal[0]?.detail,
    )
    assert.deepEqual(startFacts, {
      pid: server.pid,
      args: ['--inspect-brk=127.0.0.1:0', '<workspace>/server.cjs'],
      cwd: '<workspace>',
      loader: 'node',
      nodeVersion: process.versions.node,
      secretEnvironmentInherited: false,
    })
    assert.ok(inheritedVariables.includes('PATH'))
    // Node itself copies NODE_V8_COVERAGE into a child's environment while this process collects coverage (the health check's c8 run, CI's coverage upload), so the journal then truthfully names it.
    const coverageVariable = process.env.NODE_V8_COVERAGE
      ? ['NODE_V8_COVERAGE']
      : []
    assert.ok(
      inheritedVariables.every((name) =>
        [
          'PATH',
          'HOME',
          'TMPDIR',
          'SHELL',
          'LANG',
          'LC_ALL',
          'PNPM_HOME',
          'USER',
          'LOGNAME',
          'NODE_EXTRA_CA_CERTS',
          'SSL_CERT_FILE',
          'SSL_CERT_DIR',
          ...coverageVariable,
        ].includes(name),
      ),
    )
    assert.deepEqual(journal.at(-1), {
      type: 'node-server.closed',
      detail: { pid: server.pid, exitCode: 0, signal: null, killed: false },
    })
  } finally {
    inspector?.close()
    await server.close()
  }
})

test('an owned server inherits no parent variable outside the allowlist, no proxy and no NODE_ENV, and no event names them', async (t) => {
  // protects: the planted-variable criterion (acceptance 5); fails_when: a planted variable, HTTP_PROXY, NODE_ENV or CI reaches the server or an event; no_claim: what the server's own .env adds.
  // Arrange
  const planted = {
    CODEBOOK_PLANTED_VARIABLE: 'planted-value-7f3a',
    HTTP_PROXY: 'http://proxy.invalid:8080',
    NODE_ENV: 'production',
    CI: 'true',
  }
  const previous = Object.fromEntries(
    Object.keys(planted).map((name) => [name, process.env[name]]),
  )
  Object.assign(process.env, planted)
  t.after(() => {
    for (const [name, value] of Object.entries(previous))
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
  })
  const port = await freePort()
  const workspace = await fixtureRepository(t, { port, host: '127.0.0.1' })
  const launch = await resolveNodeServerLaunch(workspace, {
    packageRoot: '.',
    entry: 'server.cjs',
    loader: 'node',
  })
  const journal: unknown[] = []
  const outputs: ProcessOutputEvent[] = []
  const server = await launchNodeServer(
    {
      ...launch,
      workspace,
      node: { executable: process.execPath, version: process.versions.node },
    },
    (type, detail) => journal.push({ type, detail }),
    (event) => {
      outputs.push(event)
    },
  )
  let inspector: Cdp | undefined
  try {
    const endpoint = await server.inspectorEndpoint(AbortSignal.timeout(10_000))
    inspector = await Cdp.connect(endpoint, () => undefined)
    await inspector.request('Runtime.runIfWaitingForDebugger', undefined)
    await waitUntil(
      async () => ((await accepts(port)) ? true : undefined),
      'fixture readiness',
      10_000,
    )
    // Act
    const environment = await getText(port, '/environment')
    const connected = inspector
    await server.close(async () => connected.close())
    // Assert
    const names: string[] = JSON.parse(environment.body).names
    for (const name of Object.keys(planted))
      assert.equal(names.includes(name), false, name)
    const everything = JSON.stringify([journal, outputs])
    for (const [name, value] of Object.entries(planted)) {
      assert.equal(everything.includes(value), false, value)
      assert.equal(everything.includes(name), false, name)
    }
  } finally {
    inspector?.close()
    await server.close()
  }
})

test('a credential the server prints, even split over two writes, reads [masked] in every output event and the tail', async (t) => {
  // protects: the redaction contract on node-server output (task 8 through the shared capture); fails_when: any part of the token reaches an event or the tail; no_claim: secrets with no known shape.
  // Arrange
  const port = await freePort()
  const workspace = await fixtureRepository(t, { port, host: '127.0.0.1' })
  const launch = await resolveNodeServerLaunch(workspace, {
    packageRoot: '.',
    entry: 'server.cjs',
    loader: 'node',
  })
  const outputs: ProcessOutputEvent[] = []
  const server = await launchNodeServer(
    {
      ...launch,
      workspace,
      node: { executable: process.execPath, version: process.versions.node },
    },
    () => undefined,
    (event) => {
      outputs.push(event)
    },
  )
  let inspector: Cdp | undefined
  try {
    const endpoint = await server.inspectorEndpoint(AbortSignal.timeout(10_000))
    inspector = await Cdp.connect(endpoint, () => undefined)
    await inspector.request('Runtime.runIfWaitingForDebugger', undefined)
    await waitUntil(
      async () => ((await accepts(port)) ? true : undefined),
      'fixture readiness',
      10_000,
    )
    // Act
    await getText(port, '/log-credential')
    await waitUntil(
      () => (server.output().includes('and more') ? true : undefined),
      'logged credential line',
      10_000,
    )
    const connected = inspector
    await server.close(async () => connected.close())
    // Assert
    const printed = outputs.map((event) => event.text).join('')
    assert.match(printed, /fixture using token \[masked\] and more\n/)
    assert.match(server.output(), /fixture using token \[masked\] and more\n/)
    for (const fragment of ['ghp_0123456789', 'abcdefghijKLMNOP'])
      assert.equal(`${printed}${server.output()}`.includes(fragment), false)
  } finally {
    inspector?.close()
    await server.close()
  }
})

test('an owned server that exits before it listens reports its exit code and its last output', async (t) => {
  // protects: SERVER_EXITED's facts (exit code, masked last output); fails_when: the exit or its output is lost; no_claim: the error code (pt2).
  // Arrange
  const port = await freePort()
  const workspace = await fixtureRepository(t, {
    port,
    host: '127.0.0.1',
    mode: 'exit-before-listen',
  })
  const launch = await resolveNodeServerLaunch(workspace, {
    packageRoot: '.',
    entry: 'server.cjs',
    loader: 'node',
  })
  const server = await launchNodeServer(
    {
      ...launch,
      workspace,
      node: { executable: process.execPath, version: process.versions.node },
    },
    () => undefined,
  )
  let inspector: Cdp | undefined
  try {
    const endpoint = await server.inspectorEndpoint(AbortSignal.timeout(10_000))
    inspector = await Cdp.connect(endpoint, () => undefined)
    // Act
    await inspector.request('Runtime.runIfWaitingForDebugger', undefined)
    inspector.close()
    const exit = await server.waitForExit(10_000)
    // Assert
    assert.deepEqual(exit, { exitCode: 3, signal: null })
    assert.deepEqual(server.exited(), { exitCode: 3, signal: null })
    assert.match(server.output(), /fixture cannot start: exit-before-listen\n$/)
  } finally {
    inspector?.close()
    await server.close()
  }
})

test('a server whose Node cannot be started fails its inspector wait with the start error', async (t) => {
  // protects: a failed spawn surfaces at once instead of waiting 45 s; fails_when: the wait times out or succeeds; no_claim: none.
  // Arrange
  const port = await freePort()
  const workspace = await fixtureRepository(t, { port, host: '127.0.0.1' })
  const launch = await resolveNodeServerLaunch(workspace, {
    packageRoot: '.',
    entry: 'server.cjs',
    loader: 'node',
  })
  const server = await launchNodeServer(
    {
      ...launch,
      workspace,
      node: { executable: join(workspace, 'missing-node'), version: '0.0.0' },
    },
    () => undefined,
  )
  // Act
  const failure = await server
    .inspectorEndpoint(AbortSignal.timeout(10_000))
    .catch((error: unknown) => error)
  // Assert
  assert.ok(failure instanceof Error)
  assert.match(failure.message, /ENOENT/)
})

/** Launches the fixture server in a mode and returns it with its folder. */
async function launchFixture(
  t: { after: (cleanup: () => Promise<void>) => void },
  mode: string,
) {
  const port = await freePort()
  const workspace = await fixtureRepository(t, {
    port,
    host: '127.0.0.1',
    mode,
  })
  const launch = await resolveNodeServerLaunch(workspace, {
    packageRoot: '.',
    entry: 'server.cjs',
    loader: 'node',
  })
  const journal: { type: string; detail: unknown }[] = []
  const server = await launchNodeServer(
    {
      ...launch,
      workspace,
      node: { executable: process.execPath, version: process.versions.node },
    },
    (type, detail) => journal.push({ type, detail }),
  )
  // The group is ended when the test ends, also when a step before its own close failed.
  t.after(async () => {
    if (!isProcessGroupGone(server.processGroup!))
      signalProcessGroup(server.processGroup!, 'SIGKILL')
  })
  return { server, port, journal }
}

/** Releases a launched fixture server from its inspector pause and waits until it accepts connections; returns the inspector connection, which the test closes. */
async function releaseFixture(
  server: Awaited<ReturnType<typeof launchFixture>>['server'],
  port: number,
): Promise<Cdp> {
  const inspector = await Cdp.connect(
    await server.inspectorEndpoint(AbortSignal.timeout(10_000)),
    () => undefined,
  )
  await inspector.request('Runtime.runIfWaitingForDebugger', undefined)
  await waitUntil(
    async () => ((await accepts(port)) ? true : undefined),
    'fixture readiness',
    10_000,
  )
  return inspector
}

// protects=a stop's SIGKILL lands by its kill bound counted from the admission, with the debugger detach and the SIGTERM grace inside it, for a server that ignores SIGTERM and a detach that never returns; fails_when=the kill waits for the detach and then a whole grace after it (about 6 s with the product's bounds); no_claim=the product's 5 s and 10 s values (the bounds are named here so the test stays short)
test('a stop sends SIGKILL by its kill bound even when the debugger detach never returns and SIGTERM is ignored', async (t) => {
  // Arrange
  const { server, port } = await launchFixture(t, 'ignore-sigterm')
  const inspector = await Cdp.connect(
    await server.inspectorEndpoint(AbortSignal.timeout(10_000)),
    () => undefined,
  )
  await inspector.request('Runtime.runIfWaitingForDebugger', undefined)
  await waitUntil(
    async () => ((await accepts(port)) ? true : undefined),
    'fixture readiness',
    10_000,
  )
  const admittedAt = performance.now()
  const signals: Array<{ signal: string; atMs: number }> = []
  // Act
  const exit = await server.close(() => new Promise<void>(() => undefined), {
    sinceAdmissionMs: () => performance.now() - admittedAt,
    killByMs: 1_200,
    deadlineMs: 4_000,
    signalGroup: (group, signal) => {
      signals.push({ signal, atMs: performance.now() - admittedAt })
      signalProcessGroup(group, signal)
    },
  })
  inspector.close()
  // Assert
  assert.deepEqual(
    signals.map((entry) => entry.signal),
    ['SIGTERM', 'SIGKILL'],
  )
  const [term, kill] = signals
  // gstack-timing-ok: SIGTERM waits for the detach to be given up on (a lower limit only: a slow event loop can only make it later), and SIGKILL by the kill bound counted from the admission is the contract under test.
  assert.ok(term && term.atMs >= 900, `${term?.atMs}`)
  // gstack-timing-ok: SIGTERM before SIGKILL is the order under test, not a time bound.
  assert.ok(kill && term.atMs < kill.atMs, `${term?.atMs} before ${kill?.atMs}`)
  // gstack-timing-ok: SIGKILL by the kill bound is the contract under test; the upper limit leaves about 700 ms of slack.
  assert.ok(kill && kill.atMs >= 1_150 && kill.atMs < 1_900, `${kill?.atMs}`)
  assert.equal(exit.signal, 'SIGKILL')
  assert.equal(isProcessGroupGone(server.processGroup!), true)
})

/** Closes a fresh fixture server once so that it fails at its deadline (its group never reads as gone), then retries the close with an identity verdict; returns the retry's outcome and the signals each close sent. */
async function retryCloseWith(
  t: { after: (cleanup: () => Promise<void>) => void },
  verdict: LaunchedGroupVerdict,
) {
  const { server } = await launchFixture(t, 'listen')
  const signals: string[] = []
  const quickly = {
    killByMs: 300,
    deadlineMs: 600,
    // Only the first close really signals; the retry's signals are recorded alone, since its group id is gone.
    signalGroup: (group: number, signal: NodeJS.Signals): void => {
      if (signals.length < 2) signalProcessGroup(group, signal)
      signals.push(signal)
    },
  }
  const firstClose = await server
    .close(undefined, { ...quickly, isGroupGone: () => false })
    .catch((error: unknown) => error)
  const signalsOfFirstClose = [...signals]
  const retry = await server
    .close(undefined, {
      ...quickly,
      isGroupGone: () => true,
      confirmGroup: async () => verdict,
    })
    .catch((error: unknown) => error)
  return { firstClose, signalsOfFirstClose, retry, signals }
}

// protects=a retried close signals the group only after the leader's identity was confirmed: a replaced group is left alone, an unverifiable one fails the close, the launched one is signalled again; fails_when=a retry signals a group id another process may hold; no_claim=a real reuse of a process-group id (the verdicts are tested on their own)
test('a retried close signals only a group confirmed as the launched one', async (t) => {
  // Arrange
  // Act
  const replaced = await retryCloseWith(t, 'replaced')
  const unverifiable = await retryCloseWith(t, 'unverifiable')
  const launched = await retryCloseWith(t, 'launched')
  // Assert
  for (const outcome of [replaced, unverifiable, launched]) {
    assert.ok(outcome.firstClose instanceof Error)
    assert.deepEqual(outcome.signalsOfFirstClose, ['SIGTERM', 'SIGKILL'])
  }
  assert.deepEqual(replaced.signals, ['SIGTERM', 'SIGKILL'])
  assert.ok(!(replaced.retry instanceof Error))
  assert.deepEqual(unverifiable.signals, ['SIGTERM', 'SIGKILL'])
  assert.ok(unverifiable.retry instanceof Error)
  assert.match(unverifiable.retry.message, /could not be confirmed/)
  assert.deepEqual(launched.signals, ['SIGTERM', 'SIGKILL', 'SIGTERM'])
  assert.ok(!(launched.retry instanceof Error))
})

// protects=a close told that its stop is a retry confirms the group before it signals even on its own first call, so a group the run found replaced is left alone; fails_when=the first close of a retried stop signals without the identity check; no_claim=the run's count of its stops (the run test)
test('the first close of a retried stop leaves a replaced group alone', async (t) => {
  // Arrange
  const { server } = await launchFixture(t, 'listen')
  const signals: string[] = []
  // Act
  const exit = await server
    .close(undefined, {
      killByMs: 300,
      deadlineMs: 600,
      retried: true,
      confirmGroup: async () => 'replaced',
      signalGroup: (_group, signal) => {
        signals.push(signal)
      },
    })
    .catch((error: unknown) => error)
  // Assert
  assert.deepEqual(signals, [])
  assert.ok(!(exit instanceof Error))
})

// protects=a retried close sends nothing to a group the identity check found gone, so an id another group takes after the check is never signalled, and the close still completes; fails_when=a gone group is signalled again or fails the close; no_claim=a real reuse of a process-group id
test('a retried close sends no signal to a group that is already gone', async (t) => {
  // Arrange
  // Act
  const gone = await retryCloseWith(t, 'gone')
  // Assert
  assert.ok(gone.firstClose instanceof Error)
  assert.deepEqual(gone.signals, ['SIGTERM', 'SIGKILL'])
  assert.ok(!(gone.retry instanceof Error))
})

/** Reads the `killed` flag of the last `node-server.closed` event. */
function killedOf(journal: { type: string; detail: unknown }[]): unknown {
  const closed = journal.filter((entry) => entry.type === 'node-server.closed')
  return z.looseObject({ killed: z.boolean() }).parse(closed.at(-1)?.detail)
    .killed
}

// protects=the close record says what the close sent: a group that ended after SIGTERM records killed false, one that ignored SIGTERM and received SIGKILL records killed true; fails_when=a close that sent no SIGKILL records killed true, or one that sent it records false; no_claim=the product's 5 s bound (a short one is named here)
test('node-server.closed records killed true only when the close sent SIGKILL', async (t) => {
  // Arrange
  const polite = await launchFixture(t, 'listen')
  const stubborn = await launchFixture(t, 'ignore-sigterm')
  const politeInspector = await releaseFixture(polite.server, polite.port)
  const stubbornInspector = await releaseFixture(stubborn.server, stubborn.port)
  // Act
  await polite.server.close(async () => politeInspector.close(), {
    killByMs: 1_200,
    deadlineMs: 4_000,
  })
  await stubborn.server.close(async () => stubbornInspector.close(), {
    killByMs: 1_200,
    deadlineMs: 4_000,
  })
  // Assert
  assert.equal(killedOf(polite.journal), false)
  assert.equal(killedOf(stubborn.journal), true)
})

// protects=a retried close whose group is gone when the kill bound arrives sends no SIGKILL and does not record one; its identity is checked before SIGTERM and again before the kill bound (ship structured review); fails_when=the close sends or records a SIGKILL for a group that ended, or skips the second check; no_claim=a real group that ends exactly at the bound
test('a retried close whose group has ended by the kill bound sends no SIGKILL and records killed false', async (t) => {
  // Arrange
  const { server, journal } = await launchFixture(t, 'listen')
  const signals: string[] = []
  let confirmations = 0
  // Act
  await server.close(undefined, {
    killByMs: 300,
    deadlineMs: 600,
    retried: true,
    confirmGroup: async () => {
      confirmations += 1
      return 'launched'
    },
    // The signals are recorded, not sent: the group is still running when the kill bound arrives, and the probe then answers that it ended.
    signalGroup: (_group, signal) => {
      signals.push(signal)
    },
    isGroupGone: () => true,
  })
  // Assert
  assert.deepEqual(signals, ['SIGTERM'])
  assert.equal(confirmations, 2)
  assert.equal(killedOf(journal), false)
})

// protects=a retried close checks the group's identity before SIGTERM and again before the kill bound, early enough that a slow check does not push SIGKILL past the bound (Cycle 0057 item 5; ship structured review: a group id reused after SIGTERM is never killed unchecked); fails_when=the second check starts at the bound so SIGKILL lands after it, or SIGKILL goes without a second check; no_claim=the product's 5 s value (a shorter one is named here)
test('a retried close with a slow identity check confirms the group again and still sends SIGKILL by its kill bound', async (t) => {
  // Arrange
  const { server, port } = await launchFixture(t, 'ignore-sigterm')
  const inspector = await releaseFixture(server, port)
  const admittedAt = performance.now()
  const sinceAdmissionMs = (): number => performance.now() - admittedAt
  let confirmations = 0
  let killedAtMs: number | undefined
  // Act
  const exit = await server.close(async () => inspector.close(), {
    sinceAdmissionMs,
    killByMs: 1_200,
    deadlineMs: 4_000,
    retried: true,
    confirmGroup: async () => {
      confirmations += 1
      await new Promise((resolve) => setTimeout(resolve, 200))
      return 'launched'
    },
    signalGroup: (group, signal) => {
      if (signal === 'SIGKILL') killedAtMs = sinceAdmissionMs()
      signalProcessGroup(group, signal)
    },
  })
  // Assert
  assert.equal(confirmations, 2)
  // gstack-timing-ok: SIGKILL by the kill bound counted from the admission is the contract under test; the limit leaves 400 ms over the bound.
  assert.ok(killedAtMs !== undefined && killedAtMs < 1_600, `${killedAtMs}`)
  assert.equal(exit.signal, 'SIGKILL')
})

// protects=a probe that cannot tell whether the group has members at the kill bound sends no SIGKILL and fails the close, so the stop fails retryably instead of signalling on a guess; fails_when=the close sends SIGKILL after a probe that threw, or reports success; no_claim=which error the system raised
test('a close whose group probe throws at the kill bound sends no SIGKILL and rejects', async (t) => {
  // Arrange
  const { server, port } = await launchFixture(t, 'ignore-sigterm')
  const inspector = await releaseFixture(server, port)
  const admittedAt = performance.now()
  const sinceAdmissionMs = (): number => performance.now() - admittedAt
  const signals: string[] = []
  // Act
  const outcome = await server
    .close(async () => inspector.close(), {
      sinceAdmissionMs,
      killByMs: 1_200,
      deadlineMs: 4_000,
      retried: true,
      confirmGroup: async () => 'launched',
      signalGroup: (group, signal) => {
        signals.push(signal)
        signalProcessGroup(group, signal)
      },
      // The server ignores SIGTERM, so its exit is never seen and the probe is first asked at the kill bound, where it cannot tell.
      isGroupGone: () => {
        throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
      },
    })
    .catch((error: unknown) => error)
  // Assert
  assert.deepEqual(signals, ['SIGTERM'])
  assert.ok(outcome instanceof Error)
  assert.match(outcome.message, /EPERM/)
})

// protects=a retried close kills only a group its second identity check confirms just before the kill bound (ship structured review, P1): a group whose id another process group took after SIGTERM receives no SIGKILL; fails_when=the close sends SIGKILL at the bound on a group-existence probe alone; no_claim=a real reuse of a process-group id (the check's verdict is named here)
test('a retried close sends no SIGKILL when the check before the kill bound finds the group replaced', async (t) => {
  // Arrange
  const { server, journal } = await launchFixture(t, 'listen')
  const signals: string[] = []
  const verdicts: LaunchedGroupVerdict[] = ['launched', 'replaced']
  // Act
  const outcome = await server
    .close(undefined, {
      killByMs: 300,
      deadlineMs: 600,
      retried: true,
      confirmGroup: async () => verdicts.shift() ?? 'replaced',
      // The signals are recorded, not sent: the group still has members at the kill bound.
      signalGroup: (_group, signal) => {
        signals.push(signal)
      },
      isGroupGone: () => false,
    })
    .catch((error: unknown) => error)
  // Assert
  assert.deepEqual(signals, ['SIGTERM'])
  assert.ok(!(outcome instanceof Error))
  assert.equal(killedOf(journal), false)
})

// protects=the kill bound is never stretched by a second identity check (Cycle 0057 item 5) and SIGKILL never goes unchecked: a check that has not answered by the bound sends nothing and fails the close, so the stop fails retryably; fails_when=the close waits for the check past the bound, or sends SIGKILL without its answer; no_claim=which reader was slow
test('a retried close whose check before the kill bound has not answered sends no SIGKILL and rejects', async (t) => {
  // Arrange
  const { server } = await launchFixture(t, 'listen')
  const signals: string[] = []
  let confirmations = 0
  // Act
  const outcome = await server
    .close(undefined, {
      killByMs: 300,
      deadlineMs: 600,
      retried: true,
      confirmGroup: () => {
        confirmations += 1
        return confirmations === 1
          ? Promise.resolve('launched')
          : new Promise<LaunchedGroupVerdict>(() => {})
      },
      signalGroup: (_group, signal) => {
        signals.push(signal)
      },
      isGroupGone: () => false,
    })
    .catch((error: unknown) => error)
  // Assert
  assert.deepEqual(signals, ['SIGTERM'])
  assert.ok(outcome instanceof Error)
  assert.match(
    outcome.message,
    /could not be confirmed as the launched one by the kill bound/,
  )
})

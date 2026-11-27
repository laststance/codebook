import assert from 'node:assert/strict'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { z } from 'zod'

import { Cdp } from '../runtimeSupport/cdp'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { isProcessGroupGone } from '../utils/isProcessGroupGone'
import { launchNodeServer } from '../utils/launchNodeServer'
import { resolveNodeServerLaunch } from '../utils/resolveNodeServerLaunch'
import { verifyNodeTestInspectorOwnership } from '../utils/verifyNodeTestInspectorOwnership'

import { removeTestFolder } from './utils/removeTestFolder'

/** The facts of a Bun launch's start journal this test pins; the other fields (pid, inherited variables) are left out. */
const bunStartFactsSchema = z.object({
  args: z.array(z.string()),
  cwd: z.string(),
  loader: z.string(),
  bunVersion: z.string(),
})

/** Finds a free loopback port for the fixture server. */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const address = probe.address()
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  if (!address || typeof address === 'string') throw new Error('no port')
  return address.port
}

/** How long the forked helper's reply may take before the test fails; a helper that waits for a debugger never answers. */
const FORKED_HELPER_REPLY_BUDGET_MS = 10_000

/** How long one readiness GET may take before it is abandoned and tried again. */
const HEALTH_REQUEST_TIMEOUT_MS = 2_000

/** Reads one GET answer from the fixture server, or `undefined` while it does not accept or does not answer within {@link HEALTH_REQUEST_TIMEOUT_MS}, so the readiness wait can try again and keep its own deadline. */
async function healthOf(port: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const request = get(
      {
        host: '127.0.0.1',
        port,
        path: '/health',
        signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
      },
      (response) => {
        let body = ''
        response.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
        response.on('end', () => resolve(body))
        response.on('error', () => resolve(undefined))
      },
    )
    request.on('error', () => resolve(undefined))
  })
}

// Value: protects=a `loader: "bun"` launch end to end on a real Bun: the compiled bootstrap opens Bun's node:inspector, the announcement is read, Codebook's own ownership probe (pid, working folder, process group) accepts the Bun process, the release lets the TypeScript server listen, and the close ends the whole group; fails_when=the bootstrap is missing from dist or prints no endpoint, the probe rejects Bun's answers (Bun reports process.version v26), the server never listens after runIfWaitingForDebugger, the group survives the close, or a readiness answer from another program on the port passes for the Bun server; why_new=Cycle 0152 Task 5: the Bun route has no other real-process proof in the suite; seam=a real Bun found as learners' is (resolveBunRuntime) and a raw CDP connection in place of js-debug; no_claim=js-debug's attach, breakpoints and source maps (probes E1-M2 and the native check cover them)
test('a Bun server launch announces its inspector, passes the ownership probe, listens once released and ends with its group', async (t) => {
  // Arrange
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-bun-launch-')),
  )
  t.after(() => removeTestFolder(workspace))
  const port = await freePort()
  await writeFile(
    join(workspace, 'server.ts'),
    [
      "import { createServer } from 'node:http'",
      '',
      // Observable proof that the entry's module body ran, which only happens after the debugger releases the wait.
      "process.stdout.write('entry-started\\n')",
      `const port: number = ${port}`,
      'createServer((_request, response) => {',
      "  const status: string = 'ok'",
      '  response.end(JSON.stringify({ status, pid: process.pid }))',
      "}).listen(port, '127.0.0.1')",
      '',
    ].join('\n'),
  )
  const launch = await resolveNodeServerLaunch(workspace, {
    packageRoot: '.',
    entry: 'server.ts',
    loader: 'bun',
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
    const endpoint = await server.inspectorEndpoint(AbortSignal.timeout(20_000))
    inspector = await Cdp.connect(endpoint, () => undefined)
    const identity = await verifyNodeTestInspectorOwnership(
      inspector,
      workspace,
      server.processGroup!,
      AbortSignal.timeout(10_000),
      () => undefined,
    )
    // The entry must still be held back now that the identity probe is answered: the wait is what the debugger releases.
    const outputBeforeRelease = server.output()
    await inspector.request('Runtime.runIfWaitingForDebugger', undefined)
    const health = await waitUntil(
      () => healthOf(port),
      'Bun fixture readiness',
      20_000,
    )
    const connected = inspector
    const exit = await server.close(async () => connected.close())
    // Assert
    assert.equal(outputBeforeRelease.includes('entry-started'), false)
    assert.match(server.output(), /entry-started/)
    assert.match(endpoint, /^ws:\/\/127\.0\.0\.1:[1-9]\d*\/[a-f\d-]{36}$/)
    assert.deepEqual(identity, {
      pid: server.pid,
      processGroup: server.processGroup,
      workspace,
    })
    // The answer names the launched Bun's pid, so another program on the port cannot pass for it.
    assert.deepEqual(JSON.parse(health), { status: 'ok', pid: server.pid })
    assert.ok(exit.signal !== null || exit.exitCode !== null)
    assert.equal(isProcessGroupGone(server.processGroup!), true)
    assert.equal(journal[0]?.type, 'node-server.started')
    assert.ok(launch.loader.kind === 'bun')
    assert.deepEqual(bunStartFactsSchema.parse(journal[0]?.detail), {
      args: [
        '--no-install',
        '--preload',
        '<inspector-bootstrap>',
        '<workspace>/server.ts',
      ],
      cwd: '<workspace>',
      loader: 'bun',
      bunVersion: launch.loader.version,
    })
  } finally {
    inspector?.close()
    await server.close().catch(() => undefined)
  }
})

// Value: protects=a Bun server that forks a helper still answers: the helper (which inherits the preload on Bun 1.4.5) must not open a second inspector and wait for a debugger nobody answers; fails_when=a forked child waits for a debugger so the request never gets the helper's reply, or a second `Debugger listening on` line appears; why_new=Cycle 0152 /ship pass 1 defect G; seam=a real Bun and `child_process.fork()` with default options; no_claim=js-debug's attach to the launched process
test('a Bun server that forks a helper answers with the helper reply and announces one inspector', async (t) => {
  // Arrange
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-bun-fork-')),
  )
  t.after(() => removeTestFolder(workspace))
  const port = await freePort()
  await writeFile(
    join(workspace, 'helper.ts'),
    [
      "process.on('message', () => {",
      "  process.send?.('helper-reply')",
      '  process.exit(0)',
      '})',
      '',
    ].join('\n'),
  )
  await writeFile(
    join(workspace, 'server.ts'),
    [
      "import { fork } from 'node:child_process'",
      "import { createServer } from 'node:http'",
      "import { join } from 'node:path'",
      '',
      `const port: number = ${port}`,
      'createServer((_request, response) => {',
      "  const helper = fork(join(import.meta.dirname, 'helper.ts'))",
      "  helper.on('message', (reply) => response.end(String(reply)))",
      "  helper.send('go')",
      "}).listen(port, '127.0.0.1')",
      '',
    ].join('\n'),
  )
  const launch = await resolveNodeServerLaunch(workspace, {
    packageRoot: '.',
    entry: 'server.ts',
    loader: 'bun',
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
    // Act
    const endpoint = await server.inspectorEndpoint(AbortSignal.timeout(20_000))
    inspector = await Cdp.connect(endpoint, () => undefined)
    await inspector.request('Runtime.runIfWaitingForDebugger', undefined)
    const reply = await waitUntil(
      () => healthOf(port),
      'forked helper reply',
      FORKED_HELPER_REPLY_BUDGET_MS,
    )
    const connected = inspector
    await server.close(async () => connected.close())
    // Assert
    assert.equal(reply, 'helper-reply')
    // Bun may repeat the one inspector's line itself, so count distinct endpoints, not lines.
    const announcedEndpoints = new Set(
      server.output().match(/Debugger listening on (ws:\/\/\S+)/g),
    )
    assert.equal(announcedEndpoints.size, 1)
  } finally {
    inspector?.close()
    await server.close().catch(() => undefined)
  }
})

/**
 * Real-process tests of the node-server run against the two pinned real repositories (Issue #139, acceptance criterion 2c):
 * P08 `laststance/switch-time` (revision 4f68953, Hono on ESM through the clone's own tsx) and P07 `laststance/nsx` (revision 502545c7, Express on CommonJS through the clone's own tsx).
 * Each test launches the clone's server under the product's real run (CDP debugger stand-in, part U's real utilities), hits the stop Part A recorded with the recorded local readable, observes the response, stops, and asserts the process group is gone and the port free.
 * Development evidence only (ladder level 3): it earns no final-row credit and does not claim the DAP binding or the editor's `pwa-node` attach.
 *
 * Environment (a missing variable skips every test with the reason `pinned clones and their databases are local-only`; a skip never satisfies the criterion):
 * - `CODEBOOK_NODE_SERVER_CLONES`: a JSON object naming both clones, e.g. `{"switch-time":"/abs/switch-time","nsx":"/abs/nsx"}`.
 *   Their local stacks must be up first: in switch-time `docker compose up -d --wait db` then `pnpm db:migrate` in `apps/api`; in nsx `docker compose -f compose.yml -f compose.dev.yml up -d --wait db` then `pnpm exec prisma migrate deploy`.
 * - `CODEBOOK_NODE_SERVER_NODE` (optional): the Node executable the servers run under; default `~/.local/share/mise/installs/node/26.10.0/bin/node` (switch-time needs Node 26).
 *
 * The nsx database-down test stops nsx's `db` container itself (`docker compose ... stop db`) and starts it again afterwards, so it is the last test in this file and needs Docker.
 * Only the `PORT` key of switch-time's `.env` is read (default 4100); no value is printed.
 *
 * @example
 * CODEBOOK_NODE_SERVER_CLONES='{"switch-time":"/Users/me/qa/c57/switch-time","nsx":"/Users/me/qa/c57/nsx"}' node --test dist/tests/ownedNodeServerRun.pinnedClones.test.js
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { promisify } from 'node:util'

import type { NodeServerConfiguration } from '../nodeServerConfigSchemas'
import { createOwnedNodeServerRun } from '../ownedNodeServerRun'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { isProcessGroupGone } from '../utils/isProcessGroupGone'

import {
  accepts,
  realNodeServerDependencies,
  untilView,
} from './utils/realNodeServerDependencies'

const run = promisify(execFile)

/** Why every test is skipped without the clones. */
const LOCAL_ONLY_REASON = 'pinned clones and their databases are local-only'

/** The Node 26 the servers run under unless `CODEBOOK_NODE_SERVER_NODE` names another. */
const DEFAULT_NODE = join(
  homedir(),
  '.local/share/mise/installs/node/26.10.0/bin/node',
)

/** Reads `CODEBOOK_NODE_SERVER_CLONES` (a JSON object of clone paths); undefined when unset. */
function readClones(): Record<string, string> | undefined {
  const text = process.env.CODEBOOK_NODE_SERVER_CLONES
  if (!text) return undefined
  const parsed: unknown = JSON.parse(text)
  assert.ok(
    parsed && typeof parsed === 'object',
    'CODEBOOK_NODE_SERVER_CLONES must be a JSON object',
  )
  return Object.fromEntries(Object.entries(parsed))
}

const clones = readClones()
const skip = clones ? false : LOCAL_ONLY_REASON

/** One pinned clone's run: where its server lives, the request to send and the stop to hit with the local expected readable there. */
type CloneCase = {
  name: 'switch-time' | 'nsx'
  revision: string
  packageRoot: string
  entry: string
  request: NodeServerConfiguration['request']
  /** The stop's file relative to the clone, with its 1-based line and column. */
  stop: { file: string; line: number; column: number }
  /** The expression read at the stop (a fact key is `value:<expression>`). */
  local: string
}

/** Resolves a clone's real path and fails clearly when it is not at the pinned revision. */
async function pinnedClone(testCase: CloneCase): Promise<string> {
  const path = clones?.[testCase.name]
  assert.ok(
    path,
    `CODEBOOK_NODE_SERVER_CLONES names no "${testCase.name}" clone`,
  )
  const { stdout } = await run('git', ['-C', path, 'rev-parse', 'HEAD'])
  assert.ok(
    stdout.trim().startsWith(testCase.revision),
    `${testCase.name} must be at revision ${testCase.revision}, found ${stdout.trim().slice(0, 8)}`,
  )
  return realpath(path)
}

/** The port switch-time's server listens on: `PORT` from its `.env`, else its default 4100. */
async function switchTimePort(clone: string): Promise<number> {
  const env = await readFile(join(clone, '.env'), 'utf8').catch(() => '')
  return Number(/^PORT=(\d+)\s*$/m.exec(env)?.[1] ?? 4100)
}

/** Builds the real run of one clone's server; the run is stopped after the test even when it failed. */
async function cloneRun(t: TestContext, testCase: CloneCase, port: number) {
  const clone = await pinnedClone(testCase)
  const text = await readFile(join(clone, testCase.stop.file), 'utf8')
  const configuration: NodeServerConfiguration = {
    version: 1,
    adapter: 'node-server',
    book: {
      bookId: `${testCase.name}-api`,
      revision: 1,
      nodeId: 'handler',
      anchorIndex: 0,
    },
    packageRoot: testCase.packageRoot,
    entry: testCase.entry,
    loader: 'tsx',
    port,
    request: testCase.request,
    source: {
      path: testCase.stop.file,
      hash: sha256(text),
      line: testCase.stop.line,
      column: testCase.stop.column,
    },
    inspections: [{ path: testCase.local, mode: 'value', required: true }],
    additionalStops: undefined,
  }
  const executable = process.env.CODEBOOK_NODE_SERVER_NODE ?? DEFAULT_NODE
  const version = (
    await run(executable, ['-p', 'process.versions.node'])
  ).stdout.trim()
  let launchedPid: number | undefined
  const owned = createOwnedNodeServerRun({
    workspace: clone,
    configuration,
    record: (type, detail) => {
      if (
        type === 'node-server.started' &&
        detail &&
        typeof detail === 'object'
      )
        launchedPid = Reflect.get(detail, 'pid')
    },
    citedSources: [],
    runId: 'pinned-clone-run',
    dependencies: realNodeServerDependencies(
      { executable, version },
      20_000,
      new Map(),
    ),
  })
  t.after(() => owned.stop().catch(() => undefined))
  return { owned, pid: () => launchedPid }
}

/** Rejects when a wait on the run passes its bound, so a hung run fails the test instead of the whole file. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${what}`)),
      ms,
    )
  })
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer))
}

/**
 * Runs the loop of one clone: start, ready, send the declared request, the stop pauses with the local readable, continue, the response, stop.
 * @param responseWaitMs - How long the response may take after the pause continues (the nsx database-down answer takes about 20 s).
 * @returns What the test asserts on: the pause, the answered view, the stop's fact, and whether the group and port are free after the stop.
 */
async function loopOf(
  t: TestContext,
  testCase: CloneCase,
  port: number,
  responseWaitMs = 30_000,
) {
  const { owned, pid } = await cloneRun(t, testCase, port)
  await owned.prepare()
  await owned.sendRequest('key-1')
  const paused = await within(
    untilView(owned, (view) => view.state === 'paused'),
    30_000,
    'the stop to pause',
  )
  assert.ok(paused.pause)
  await owned.continue(paused.pause)
  const answered = await within(
    untilView(owned, (view) => view.state === 'responded'),
    responseWaitMs,
    'the response',
  )
  const group = pid()
  assert.ok(group)
  await owned.stop()
  return {
    paused,
    answered,
    local: paused.captures[0]?.facts[`value:${testCase.local}`],
    stoppedState: owned.view().state,
    groupGone: isProcessGroupGone(group),
    portAccepts: await accepts(port),
  }
}

const HEALTHZ: CloneCase = {
  name: 'switch-time',
  revision: '4f68953',
  packageRoot: 'apps/api',
  entry: 'src/server.ts',
  request: { method: 'GET', path: '/api/healthz' },
  stop: { file: 'apps/api/src/app.ts', line: 54, column: 32 },
  local: 'c.req.path',
}

const SIGN_IN: CloneCase = {
  ...HEALTHZ,
  request: {
    method: 'POST',
    path: '/api/auth/sign-in/email',
    contentType: 'application/json',
    body: '{"email": "nobody@example.com", "password": "not-the-password-123"}',
  },
  stop: { file: 'apps/api/src/db/client.ts', line: 254, column: 3 },
  local: 'values',
}

const NSX_HEALTH: CloneCase = {
  name: 'nsx',
  revision: '502545c7',
  packageRoot: '.',
  entry: 'server/index.ts',
  request: { method: 'GET', path: '/api/health' },
  stop: { file: 'server/routes/health.ts', line: 60, column: 5 },
  local: '_req.path',
}

// protects=switch-time's health route runs under the product's run: the stop at app.ts:54 pauses with the request path readable, the answer is 200 ok, and Stop frees the group and port; fails_when=the TypeScript stop does not bind, the local is unreadable, the answer differs or a process or the port is left; no_claim=the DAP binding and pwa-node attach
test(
  'switch-time GET /api/healthz pauses at app.ts:54 with the path readable, answers 200 ok, and stops with the port free',
  { skip },
  async (t) => {
    // Arrange
    const port = await switchTimePort(await pinnedClone(HEALTHZ))
    // Act
    const result = await loopOf(t, HEALTHZ, port)
    // Assert
    assert.deepEqual(result.paused.stopsReached, [0])
    assert.equal(result.local, '/api/healthz')
    assert.equal(result.answered.response?.status, 200)
    assert.equal(result.answered.response?.body, '{"status":"ok"}')
    assert.equal(result.stoppedState, 'stopped')
    assert.equal(result.groupGone, true)
    assert.equal(result.portAccepts, false)
  },
)

// protects=Part A's switch-time path: the unknown-user sign-in pauses under the database client at client.ts:254 with the query values readable, answers 401 INVALID_EMAIL_OR_PASSWORD, and Stop frees the group and port; fails_when=the stop in the Drizzle client does not bind or read, the answer differs, or a process or the port is left; no_claim=the database-down 500 and the DAP binding
test(
  'switch-time sign-in of an unknown user pauses at client.ts:254 with the e-mail value readable and answers 401 INVALID_EMAIL_OR_PASSWORD',
  { skip },
  async (t) => {
    // Arrange
    const port = await switchTimePort(await pinnedClone(SIGN_IN))
    // Act
    const result = await loopOf(t, SIGN_IN, port)
    // Assert
    assert.deepEqual(result.paused.stopsReached, [0])
    assert.equal(result.local, '["nobody@example.com"]')
    assert.equal(result.answered.response?.status, 401)
    assert.match(
      result.answered.response?.body ?? '',
      /"code":"INVALID_EMAIL_OR_PASSWORD"/,
    )
    assert.equal(result.stoppedState, 'stopped')
    assert.equal(result.groupGone, true)
    assert.equal(result.portAccepts, false)
  },
)

// protects=nsx's CommonJS health route with MySQL up: the stop at health.ts:60 pauses with the request path readable, the answer is 200 with database ok, and Stop frees the group and port; fails_when=the CommonJS TypeScript stop does not bind, the local is unreadable, the answer differs or a process or the port is left; no_claim=top-level CommonJS lines and the DAP binding
test(
  'nsx GET /api/health with the database up pauses at health.ts:60 with the path readable and answers 200 database ok',
  { skip },
  async (t) => {
    // Arrange
    await pinnedClone(NSX_HEALTH)
    // Act
    const result = await loopOf(t, NSX_HEALTH, 4000)
    // Assert
    assert.deepEqual(result.paused.stopsReached, [0])
    assert.equal(result.local, '/health')
    assert.equal(result.answered.response?.status, 200)
    assert.match(result.answered.response?.body ?? '', /"database":"ok"/)
    assert.equal(result.stoppedState, 'stopped')
    assert.equal(result.groupGone, true)
    assert.equal(result.portAccepts, false)
  },
)

// protects=nsx's health route with MySQL stopped: the same stop pauses, the answer after Prisma's connect timeout (about 20 s) is 503 Database unreachable, and Stop frees the group and port; fails_when=the stop is missed, the answer differs, the 20 s wait breaks the run, or a process or the port is left; no_claim=the database container restart beyond this test
test(
  'nsx GET /api/health with the database down answers 503 Database unreachable after the connect timeout',
  { skip, timeout: 180_000 },
  async (t) => {
    // Arrange
    const clone = await pinnedClone(NSX_HEALTH)
    const compose = ['compose', '-f', 'compose.yml', '-f', 'compose.dev.yml']
    await run('docker', [...compose, 'stop', 'db'], { cwd: clone })
    // The database is started and healthy again afterwards, even when the test failed.
    t.after(() =>
      run('docker', [...compose, 'up', '-d', '--wait', 'db'], { cwd: clone }),
    )
    // Act
    const result = await loopOf(t, NSX_HEALTH, 4000, 60_000)
    // Assert
    assert.deepEqual(result.paused.stopsReached, [0])
    assert.equal(result.local, '/health')
    assert.equal(result.answered.response?.status, 503)
    assert.match(
      result.answered.response?.body ?? '',
      /"error":"Database unreachable"/,
    )
    assert.equal(result.stoppedState, 'stopped')
    assert.equal(result.groupGone, true)
    assert.equal(result.portAccepts, false)
  },
)

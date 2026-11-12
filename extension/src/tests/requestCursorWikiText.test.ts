import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  WIKI_CURSOR_QUESTION_PERMISSIONS,
  WIKI_CURSOR_REQUEST_TIMEOUT_MS,
} from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import {
  parseCursorWikiCliResult,
  requestCursorWikiText,
} from '../utils/requestCursorWikiText'
import type * as RequestCursorWikiTextModule from '../utils/requestCursorWikiText'

import { loadModule } from './utils/loadModule'
import { removeTestFolder } from './utils/removeTestFolder'

test('Cursor Wiki provider accepts only a successful bounded CLI response', () => {
  // Arrange
  const response = JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: '{"answer":"No","citations":[{"id":"S1","line":2}]}',
  })
  // Act
  const result = parseCursorWikiCliResult(response)
  // Assert
  assert.equal(result, '{"answer":"No","citations":[{"id":"S1","line":2}]}')
})

test('Cursor Wiki provider rejects errors and oversized model text before citation rendering', () => {
  // Arrange
  const failed = JSON.stringify({
    type: 'result',
    subtype: 'error',
    is_error: true,
    result: 'Authentication failed',
  })
  const oversized = JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'x'.repeat(12_001),
  })
  // Act / Assert
  assert.throws(() => parseCursorWikiCliResult(failed), /could not answer/)
  assert.throws(() => parseCursorWikiCliResult(oversized), /oversized/)
  assert.throws(() => parseCursorWikiCliResult('null'), /could not answer/)
  assert.throws(() => parseCursorWikiCliResult('not json'), /unreadable/)
})

test('a cancelled or oversized Cursor Wiki question starts no model request', async () => {
  // Arrange
  const cancelled = {
    isCancellationRequested: true,
    onCancellationRequested: () => ({ dispose(): void {} }),
  }
  const oversizedPrompt = 'x'.repeat(131_073)
  // Act / Assert
  await assert.rejects(
    requestCursorWikiText('Question: test', cancelled),
    /cancelled/,
  )
  await assert.rejects(requestCursorWikiText(oversizedPrompt), /too large/)
})

test('a failed Cursor Agent response leaves the browser without a fabricated Wiki answer', async () => {
  // Arrange
  const fakeHome = await mkdtemp(join(tmpdir(), 'codebook-failed-agent-'))
  const binaryDirectory = join(fakeHome, '.local', 'bin')
  await mkdir(binaryDirectory, { recursive: true })
  await writeFile(
    join(binaryDirectory, 'cursor-agent'),
    `#!${process.execPath}\nprocess.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify({type:'result',subtype:'error',is_error:true,result:'Authentication failed'})));\n`,
    { mode: 0o755 },
  )
  const previousHome = process.env.HOME
  process.env.HOME = fakeHome
  try {
    // Act / Assert
    await assert.rejects(
      requestCursorWikiText('Question: test'),
      /could not answer/,
    )
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    await removeTestFolder(fakeHome)
  }
})

test('excess Cursor Agent output terminates the isolated Wiki request', async () => {
  // Arrange
  const fakeHome = await mkdtemp(join(tmpdir(), 'codebook-large-agent-'))
  const binaryDirectory = join(fakeHome, '.local', 'bin')
  await mkdir(binaryDirectory, { recursive: true })
  await writeFile(
    join(binaryDirectory, 'cursor-agent'),
    `#!${process.execPath}\nprocess.stdin.resume(); process.stdin.on('end', () => { process.stdout.write('x'.repeat(65537)); setInterval(() => {}, 1000); });\n`,
    { mode: 0o755 },
  )
  const previousHome = process.env.HOME
  process.env.HOME = fakeHome
  const started = Date.now()
  try {
    // Act / Assert
    await assert.rejects(
      requestCursorWikiText('Question: test'),
      /response limit/,
    )
    assert.ok(Date.now() - started < 5_000)
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    await removeTestFolder(fakeHome)
  }
})

/**
 * Creates a Wiki request cancellation token that keeps VS Code's promise for late listeners.
 *
 * VS Code calls a listener registered on an already-cancelled token on the next tick, so a cancellation that lands
 * while {@link requestCursorWikiText} is still preparing (before it subscribes) stops the request all the same.
 * Used by the cancellation tests below in place of `vscode.CancellationTokenSource`, which the extension passes.
 *
 * @returns The token to pass to the request and the `cancel` the test calls.
 * @example
 * const { token, cancel } = cancellationTokenLikeVsCode()
 * cancel() // later listeners run on the next tick
 */
function cancellationTokenLikeVsCode() {
  const listeners = new Set<(event: unknown) => unknown>()
  const token = {
    isCancellationRequested: false,
    onCancellationRequested(listener: (event: unknown) => unknown) {
      // A cancelled token answers a late listener on the next tick, as VS Code's shortcut event does
      if (token.isCancellationRequested) {
        const handle = setTimeout(() => listener(undefined), 0)
        return { dispose: (): void => clearTimeout(handle) }
      }
      listeners.add(listener)
      return {
        dispose(): void {
          listeners.delete(listener)
        },
      }
    },
  }
  const cancel = (): void => {
    token.isCancellationRequested = true
    for (const listener of listeners) listener(undefined)
  }
  return { token, cancel }
}

/**
 * Installs a fake Cursor Agent CLI that marks its start and never answers, under a temporary HOME.
 *
 * Lets a cancellation test choose whether it cancels before or after the agent process started.
 *
 * @returns The marker file the agent writes when it starts, and `restore`, which puts HOME back and removes the fake home.
 * @example
 * const agent = await installHangingCursorAgent()
 * await agent.restore()
 */
async function installHangingCursorAgent() {
  const fakeHome = await mkdtemp(join(tmpdir(), 'codebook-hanging-agent-'))
  const binaryDirectory = join(fakeHome, '.local', 'bin')
  const startedMarker = join(fakeHome, 'agent-started')
  await mkdir(binaryDirectory, { recursive: true })
  await writeFile(
    join(binaryDirectory, 'cursor-agent'),
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(startedMarker)}, ''); process.stdin.resume(); setInterval(() => {}, 1000);\n`,
    { mode: 0o755 },
  )
  const previousHome = process.env.HOME
  process.env.HOME = fakeHome
  const restore = async (): Promise<void> => {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    await removeTestFolder(fakeHome)
  }
  return { startedMarker, restore }
}

const questionWorkspaces = async () =>
  (await readdir(tmpdir()))
    .filter((name) => name.startsWith('codebook-wiki-question-'))
    .sort()

const DENY_RULES =
  '{"permissions":{"allow":[],"deny":["Read(**)","Read(/**)","Write(**)","Write(/**)","Shell(*)","WebFetch(*)","Mcp(*)"]}}'

/** Installs a fake `cursor-agent` that records the permissions file it finds at start, then answers with a valid result envelope. */
async function installRecordingCursorAgent() {
  const fakeHome = await mkdtemp(join(tmpdir(), 'codebook-config-agent-'))
  const binaryDirectory = join(fakeHome, '.local', 'bin')
  await mkdir(binaryDirectory, { recursive: true })
  const startedMarker = join(fakeHome, 'started')
  const seenConfig = join(fakeHome, 'seen-cli.json')
  await writeFile(
    join(binaryDirectory, 'cursor-agent'),
    `#!${process.execPath}\nconst fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(startedMarker)}, 'started'); let seen; try { seen = fs.readFileSync(require('node:path').join(process.cwd(), '.cursor', 'cli.json'), 'utf8') } catch { seen = 'MISSING' } fs.writeFileSync(${JSON.stringify(seenConfig)}, seen); process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'ok'})));\n`,
    { mode: 0o755 },
  )
  const previousHome = process.env.HOME
  process.env.HOME = fakeHome
  return {
    startedMarker,
    seenConfig,
    async restore(): Promise<void> {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      await removeTestFolder(fakeHome)
    },
  }
}

// protects=a Wiki question's Cursor Agent starts only with every read, write, shell, fetch and MCP tool denied by the workspace's .cursor/cli.json, so it cannot read other checkouts or the installed skill (Cycle 0124 C1); fails_when=the agent starts before the file exists or the file lacks a rule, or the workspace stays behind after the answer; why_new=Cycle 0125 C1 (Issue #320 E0); seam=a node script stands in for cursor-agent; no_claim=that a real Cursor Agent enforces the rules (bounded experiment E0 observed that)
test('a Cursor Wiki question agent finds the deny-every-tool permissions in its workspace when it starts, and the workspace is removed after the answer', async () => {
  // Arrange
  const agent = await installRecordingCursorAgent()
  const before = await questionWorkspaces()
  try {
    // Act
    const answer = await requestCursorWikiText('Question: test')
    // Assert
    assert.equal(answer, 'ok')
    assert.deepEqual(
      JSON.parse(await readFile(agent.seenConfig, 'utf8')),
      JSON.parse(DENY_RULES),
    )
    assert.equal(JSON.stringify(WIKI_CURSOR_QUESTION_PERMISSIONS), DENY_RULES)
    assert.deepEqual(await questionWorkspaces(), before)
  } finally {
    await agent.restore()
  }
})

// protects=a Wiki question whose permissions file cannot be written never starts the agent and says so; fails_when=the agent starts anyway with its tools open, the learner sees no clear error, or the temporary workspace stays behind; why_new=Cycle 0125 C1 (Issue #320); seam=loadModule stands in a node:fs/promises whose writeFile rejects; no_claim=which real disk failure happens
test('a Cursor Wiki question whose permissions file cannot be written starts no agent and removes its workspace', async () => {
  // Arrange
  const agent = await installRecordingCursorAgent()
  const before = await questionWorkspaces()
  const boundary = await loadModule<typeof RequestCursorWikiTextModule>(
    join(__dirname, '../utils/requestCursorWikiText.js'),
    {
      'node:fs/promises': {
        ...fsPromises,
        writeFile: () => Promise.reject(new Error('EACCES: disk is read-only')),
      },
    },
  )
  try {
    // Act / Assert
    await assert.rejects(
      boundary.requestCursorWikiText('Question: test'),
      /could not restrict the Cursor Agent/,
    )
    assert.equal(existsSync(agent.startedMarker), false)
    assert.deepEqual(await questionWorkspaces(), before)
  } finally {
    await agent.restore()
  }
})

// protects=a failed Cursor Agent run removes the Wiki question's temporary workspace with its permissions file; fails_when=the workspace stays behind after the agent exits with an error; why_new=Cycle 0125 C1 (the file now lives in the workspace); seam=a node script stands in for cursor-agent; no_claim=a real Cursor Agent
test('a failed Cursor Agent run leaves no Wiki question workspace behind', async () => {
  // Arrange
  const fakeHome = await mkdtemp(join(tmpdir(), 'codebook-failed-clean-'))
  const binaryDirectory = join(fakeHome, '.local', 'bin')
  await mkdir(binaryDirectory, { recursive: true })
  await writeFile(
    join(binaryDirectory, 'cursor-agent'),
    `#!${process.execPath}\nprocess.stdin.resume(); process.stdin.on('end', () => process.exit(1));\n`,
    { mode: 0o755 },
  )
  const previousHome = process.env.HOME
  process.env.HOME = fakeHome
  const before = await questionWorkspaces()
  try {
    // Act
    await assert.rejects(
      requestCursorWikiText('Question: test'),
      /could not answer/,
    )
    // Assert
    assert.deepEqual(await questionWorkspaces(), before)
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    await removeTestFolder(fakeHome)
  }
})

// protects=a Wiki question cancelled while Cursor Agent runs stops it and removes the temporary workspace; fails_when=the cancellation is ignored until the request times out, or the workspace stays behind; no_claim=a real Cursor Agent: a node script stands in for the CLI and a VS Code-like token for the editor's
test('cancelling an active Cursor Agent request removes its temporary workspace', async () => {
  // Arrange
  const agent = await installHangingCursorAgent()
  const before = await questionWorkspaces()
  const { token, cancel } = cancellationTokenLikeVsCode()
  try {
    // Act
    const request = requestCursorWikiText('Question: test', token)
    const outcome = request.then(
      () => 'answered',
      (error: unknown) => String(error),
    )
    await waitUntil(
      () => existsSync(agent.startedMarker),
      'the Cursor Agent process to start',
    )
    cancel()
    // Assert
    assert.match(await outcome, /cancelled/)
    assert.deepEqual(await questionWorkspaces(), before)
  } finally {
    await agent.restore()
  }
})

// protects=a Wiki question cancelled while the request still prepares (before it subscribes to the token) stops at once; fails_when=the request waits for its 120 s timeout or leaves its temporary workspace; no_claim=a real Cursor Agent: a node script stands in for the CLI and a VS Code-like token for the editor's
test('cancelling a Cursor Agent request before the agent starts stops it without waiting for the timeout', async () => {
  // Arrange
  const agent = await installHangingCursorAgent()
  const before = await questionWorkspaces()
  const { token, cancel } = cancellationTokenLikeVsCode()
  const startedMs = performance.now()
  try {
    // Act
    const request = requestCursorWikiText('Question: test', token)
    cancel()
    // Assert
    await assert.rejects(request, /cancelled/)
    assert.ok(performance.now() - startedMs < 5_000)
    assert.deepEqual(await questionWorkspaces(), before)
  } finally {
    await agent.restore()
  }
})

test('a missing Cursor Agent CLI reports the prerequisite without starting Wiki Q&A', async () => {
  // Arrange
  const fakeHome = await mkdtemp(join(tmpdir(), 'codebook-missing-agent-'))
  const emptyPath = join(fakeHome, 'bin')
  await mkdir(emptyPath)
  const previousHome = process.env.HOME
  const previousPath = process.env.PATH
  process.env.HOME = fakeHome
  process.env.PATH = emptyPath
  try {
    // Act / Assert
    await assert.rejects(
      requestCursorWikiText('Question: test'),
      /CLI is not installed/,
    )
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    await removeTestFolder(fakeHome)
  }
})

test('a stalled Cursor Agent request times out and leaves no Wiki workspace', async () => {
  // Arrange
  const fakeHome = await mkdtemp(join(tmpdir(), 'codebook-timeout-agent-'))
  const binaryDirectory = join(fakeHome, '.local', 'bin')
  await mkdir(binaryDirectory, { recursive: true })
  await writeFile(
    join(binaryDirectory, 'cursor-agent'),
    `#!${process.execPath}\nprocess.stdin.resume(); setInterval(() => {}, 1000);\n`,
    { mode: 0o755 },
  )
  const previousHome = process.env.HOME
  process.env.HOME = fakeHome
  const questionWorkspaces = async () =>
    (await readdir(tmpdir()))
      .filter((name) => name.startsWith('codebook-wiki-question-'))
      .sort()
  const before = await questionWorkspaces()
  const boundary = await loadModule<typeof RequestCursorWikiTextModule>(
    join(__dirname, '../utils/requestCursorWikiText.js'),
    {
      '../constants': {
        WIKI_CURSOR_PROCESS_OUTPUT_LIMIT_BYTES: 65_536,
        WIKI_CURSOR_PROMPT_LIMIT_BYTES: 131_072,
        WIKI_CURSOR_QUESTION_PERMISSIONS,
        WIKI_CURSOR_REQUEST_TIMEOUT_MS: 100,
        WIKI_CURSOR_TERMINATION_GRACE_MS: 100,
        WIKI_ANSWER_LIMIT_CHARS: 12_000,
      },
    },
  )
  try {
    // Act / Assert
    await assert.rejects(
      boundary.requestCursorWikiText('Question: test'),
      /timed out/,
    )
    assert.deepEqual(await questionWorkspaces(), before)
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    await removeTestFolder(fakeHome)
  }
})

// Value: protects=a Cursor reader question on a large Wiki gets its answer: Cycle 0119 measured the route request of a question on TanStack/query's Wiki at 148.5 s with Grok 4.6 High, and each Cursor Agent request may run 300 s, twice that; fails_when=the per-request bound goes back to 120 s or below the measured time, so the reader shows "Cursor Agent timed out" for a request that would have answered (Cycle 0119 F1); why_new=Cycle 0119 (H1 E2 step 6, F1); seam=none (the shipped constant the request's timer uses); no_claim=that 300 s suffices for every repository, model or machine
test('a Cursor Agent Wiki request may run 300 seconds, twice the route request measured on the largest required repository', () => {
  // Arrange
  const measuredRouteRequestMs = 148_500

  // Act
  const requestBoundMs = WIKI_CURSOR_REQUEST_TIMEOUT_MS

  // Assert
  assert.equal(requestBoundMs, 300_000)
  // gstack-timing-ok: compares the shipped bound with the route time Cycle 0119 measured; no clock is read
  assert.ok(requestBoundMs >= 2 * measuredRouteRequestMs)
})
